#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIMIT = 81920, ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models", JOURNAL = "docs/journal/gemini_review_log.md";
const INVARIANTS = ["core/INVARIANTS.md", "core/REPO_INVARIANTS.md"], HEX = /^[0-9a-f]{40}$/, SHA256 = /^[0-9a-f]{64}$/, MODEL = /^[A-Za-z0-9._-]+$/, RIG = /^[A-Za-z0-9._:-]{1,120}$/;
const MODES = new Set(["100644", "100755"]), BOUNDARIES = ["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"];
const GIT_LOCATION_OVERRIDES = ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];
const CREDENTIAL_LIKE = /(?:AIza[\w-]{35}|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:api[_-]?key|secret|token|password|passphrase)\s*[:=]\s*(?!["']?(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$\([^\)\r\n]+\)|<[^>\r\n]+>|(?:CHANGEME|REDACTED)(?:["']?(?:\s|$))))(?:["'][^"']{1,}|[A-Za-z0-9][^\s#]{7,})|\bauthorization\s*[:=]\s*(?!["']?(?:(?:bearer|basic)\s+)?(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$\([^\)\r\n]+\)|<[^>\r\n]+>|(?:CHANGEME|REDACTED)(?:["']?(?:\s|$))))(?:(?:bearer|basic)\s+)?(?:["'][^"']{1,}|[A-Za-z0-9][^\s#]{7,})|\bbearer\s+[A-Za-z0-9._~+/=-]{8,})/i;
function lexical(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function die(message, exitCode = 2) { throw Object.assign(new Error(message), { exitCode }); }
function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function random(label) { return `${label}-${crypto.randomBytes(12).toString("hex")}`; }
function git(repo, args, encoding = "utf8") {
  try { return execFileSync("git", ["--no-replace-objects", "-C", repo, "-c", "diff.external=", ...args], { encoding, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) { die(`git ${args.join(" ")} failed: ${String(error.stderr || error.message).trim()}`); }
}
function relative(value, label) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.includes("\0") || value.split(/[\\/]/).includes("..")) die(`${label} must be a nonempty repository-relative path`);
  return value.split(path.sep).join("/");
}
function paths(values, label) {
  if (!Array.isArray(values)) die(`${label} must be an array`);
  const out = values.map(value => relative(value, label));
  if (new Set(out).size !== out.length) die(`${label} contains duplicate paths`);
  return out.sort(lexical);
}
function blob(repo, commit, file) {
  file = relative(file, "artifact path");
  const bytes = git(repo, ["show", `${commit}:${file}`], "buffer");
  let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { die(`non-UTF-8 artifact is unsupported: ${file}`); }
  if (/\0/.test(text)) die(`binary artifact is unsupported: ${file}`);
  return text;
}
function regularTreeBlob(repo, commit, file, label) {
  file = relative(file, label);
  const entry = git(repo, ["ls-tree", commit, "--", file]).trim();
  const match = entry.match(/^(100644|100755) blob [0-9a-f]{40}\t(.+)$/);
  if (!match || match[2] !== file) die(`${label} must be a regular blob in the candidate tree: ${file}`, 3);
}
function journalPath(repo) {
  const target = path.resolve(repo, JOURNAL), relativeTarget = path.relative(repo, target);
  if (!relativeTarget || relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`)) die("journal path escapes the repository", 3);
  const parent = path.dirname(target);
  for (let current = repo;;) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false }); if (stat?.isSymbolicLink()) die("journal parent must not be a symlink", 3);
    if (current === parent) break;
    current = path.join(current, path.relative(current, parent).split(path.sep)[0]);
  }
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) die("journal must be a regular non-symlink file", 3);
  return target;
}
function parse(argv) {
  for (const key of GIT_LOCATION_OVERRIDES) if (process.env[key]) die(`ambient ${key} is not allowed for a frozen review`, 3);
  const o = { repo: process.cwd(), model: "gemini-2.5-pro", dryRun: false, noLog: false, runSlices: false, fingerprint: false };
  const flags = new Set(["--dry-run", "--no-log", "--run-slices", "--fingerprint"]), valueOptions = new Set(["repo", "model", "base", "candidate", "tree", "rigId", "context", "sliceManifest", "sharedLockDir", "lockOwnerPid"]);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (flags.has(key)) { o[{ "--dry-run": "dryRun", "--no-log": "noLog", "--run-slices": "runSlices", "--fingerprint": "fingerprint" }[key]] = true; continue; }
    if (!key?.startsWith("--")) die(`invalid argument near ${key}`);
    const name = key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!valueOptions.has(name)) die(`unknown option ${key}`);
    const value = argv[++i]; if (value === undefined || value === "" || value.startsWith("--")) die(`missing or option-shaped value for ${key}`);
    o[name] = value;
  }
  for (const key of ["base", "candidate", "tree", "rigId"]) if (!o[key]) die(`missing --${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`);
  if (![o.base, o.candidate, o.tree].every(value => HEX.test(value))) die("base, candidate, and tree must be exact lowercase 40-hex IDs");
  if (!RIG.test(o.rigId) || !MODEL.test(o.model)) die("invalid nonsecret rig ID or Gemini model ID");
  if (o.sliceManifest ? ((!o.runSlices && !o.fingerprint) || o.context) : (o.runSlices || o.fingerprint || !o.context)) die("use --context for one full review, or --slice-manifest with --run-slices/--fingerprint");
  if (o.context) o.context = relative(o.context, "--context"); if (o.sliceManifest) o.sliceManifest = relative(o.sliceManifest, "--slice-manifest");
  if (o.noLog && !o.dryRun && !o.fingerprint) die("--no-log is only allowed with --dry-run or --fingerprint; live reviews require a durable receipt", 3);
  if (Boolean(o.sharedLockDir) !== Boolean(o.lockOwnerPid)) die("--shared-lock-dir and --lock-owner-pid must be supplied together", 3);
  return o;
}
function endpoint(repo, o) {
  const sanctioned = file => {
    if (file === JOURNAL || file === o.sliceManifest || file.startsWith(".gemini-gate/")) return true;
    if (file !== "docs/journal/") return false;
    try { return fs.readdirSync(path.join(repo, "docs/journal")).every(entry => entry === "gemini_review_log.md"); } catch { return false; }
  };
  const dirt = git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean).map(row => row.slice(3)).filter(file => !sanctioned(file));
  if (dirt.length) die(`source checkout is dirty outside sanctioned artifacts: ${dirt.join(", ")}`, 3);
  if (git(repo, ["rev-parse", "HEAD"]).trim() !== o.candidate) die("checkout HEAD does not equal --candidate", 3);
  if (git(repo, ["rev-parse", "HEAD^{tree}"]).trim() !== o.tree) die("checkout HEAD tree does not equal --tree", 3);
}
function validate(repo, o) {
  repo = fs.realpathSync(repo); endpoint(repo, o);
  for (const [id, type] of [[o.base, "commit"], [o.candidate, "commit"], [o.tree, "tree"]]) if (git(repo, ["cat-file", "-t", id]).trim() !== type) die(`${id} is not a ${type}`);
  if (git(repo, ["rev-parse", `${o.candidate}^{tree}`]).trim() !== o.tree) die("candidate tree does not equal --tree");
  try { execFileSync("git", ["--no-replace-objects", "-C", repo, "merge-base", "--is-ancestor", o.base, o.candidate], { stdio: "ignore" }); } catch { die("--base is not an ancestor of --candidate"); }
  return repo;
}
function changed(repo, o) {
  const values = git(repo, ["diff", "--raw", "--no-abbrev", "-z", "--no-ext-diff", "--no-textconv", "--find-renames=100%", o.base, o.candidate]).split("\0").filter(Boolean), rows = [];
  for (let i = 0; i < values.length;) {
    const header = values[i++], match = header.match(/^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z][0-9]*)$/), file = values[i++];
    if (!match || !file) die(`unsupported changed entry: ${header || "missing"}`);
    const [, oldMode, newMode, oldId, newId, status] = match; relative(file, "changed path");
    if (!["A", "M", "D"].includes(status)) die(`rename, copy, or type-changed entry is unsupported: ${file}`);
    const valid = (status === "A" && oldMode === "000000" && MODES.has(newMode)) || (status === "M" && MODES.has(oldMode) && MODES.has(newMode)) || (status === "D" && MODES.has(oldMode) && newMode === "000000");
    if (!valid) die(`non-regular, symlink, gitlink, or type-changed entry is unsupported: ${file}`);
    const commit = status === "D" ? o.base : o.candidate, object = status === "D" ? oldId : newId;
    if (git(repo, ["cat-file", "-t", object]).trim() !== "blob" || git(repo, ["rev-parse", `${commit}:${file}`]).trim() !== object) die(`changed entry is not the expected regular blob: ${file}`);
    rows.push({ status, file });
  }
  if (!rows.length || new Set(rows.map(row => row.file)).size !== rows.length) die("candidate must contain one or more unique regular-file changes");
  return rows.sort((a, b) => lexical(a.file, b.file));
}
function readManifest(repo, rel) {
  const input = path.resolve(repo, relative(rel, "--slice-manifest")), stat = fs.lstatSync(input, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) die("slice manifest must be an existing regular non-symlink file", 3);
  const real = fs.realpathSync(input), inside = path.relative(repo, real);
  if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`)) die("slice manifest must resolve inside the repository", 3);
  try { return JSON.parse(fs.readFileSync(real, "utf8")); } catch (error) { die(`invalid slice manifest: ${error.message}`, 3); }
}
function slice(raw, actual) {
  if (!raw || typeof raw.name !== "string" || !raw.name || /[\r\n\t]/.test(raw.name) || !["coverage", "cross_boundary"].includes(raw.kind)) die("slice requires a valid name and kind");
  const files = paths(raw.files, `slice ${raw.name}.files`), contract_context = paths(raw.contract_context, `slice ${raw.name}.contract_context`);
  if (!files.length || !contract_context.length) die(`slice ${raw.name} requires nonempty files and contract_context`);
  for (const file of files) if (!actual.has(file)) die(`slice ${raw.name} names a file outside the candidate: ${file}`);
  return { name: raw.name, kind: raw.kind, files, contract_context, raw };
}
function verifyManifest(repo, o, rows) {
  const manifest = readManifest(repo, o.sliceManifest), actualFiles = rows.map(row => row.file), actual = new Set(actualFiles);
  if (manifest.version !== 2 || manifest.scope?.base_commit !== o.base || manifest.scope?.candidate_commit !== o.candidate || manifest.scope?.candidate_tree !== o.tree) die("slice manifest does not bind the exact frozen base/candidate/tree");
  if (!manifest.approval?.by || typeof manifest.approval.by !== "string" || (!o.fingerprint && (manifest.approval.status !== "APPROVED" || !SHA256.test(manifest.approval.expected_plan_id || "")))) die("slice manifest is not PM-approved");
  const declared = paths(manifest.scope.files, "manifest scope.files");
  if (declared.join("\0") !== actualFiles.join("\0") || !Array.isArray(manifest.uncovered) || manifest.uncovered.length) die("manifest scope is not complete for the committed candidate");
  if (!Array.isArray(manifest.slices) || manifest.slices.length < 2) die("manifest requires coverage slices plus final cross_boundary slice");
  const slices = manifest.slices.map(raw => slice(raw, actual));
  if (new Set(slices.map(item => item.name)).size !== slices.length) die("slice names must be unique");
  const coverage = slices.filter(item => item.kind === "coverage"), cross = slices.filter(item => item.kind === "cross_boundary");
  if (!coverage.length || cross.length !== 1 || slices.at(-1) !== cross[0]) die("manifest requires exactly one final cross_boundary slice");
  const covered = new Set(); for (const item of coverage) for (const file of item.files) { if (covered.has(file)) die(`coverage slices overlap: ${file}`); covered.add(file); }
  if ([...covered].sort(lexical).join("\0") !== actualFiles.join("\0")) die("coverage slices do not exactly and disjointly cover the candidate");
  const boundaries = {}, final = cross[0];
  for (const name of BOUNDARIES) {
    const claim = final.raw.boundaries?.[name];
    if (!claim || !["covered", "not_applicable"].includes(claim.status) || typeof claim.rationale !== "string" || !claim.rationale.trim()) die(`cross_boundary ${name} requires a status and rationale`);
    const scope_files = paths(claim.scope_files ?? [], `cross_boundary.${name}.scope_files`), contract_context = paths(claim.contract_context ?? [], `cross_boundary.${name}.contract_context`);
    for (const file of scope_files) if (!covered.has(file) || !final.files.includes(file)) die(`cross_boundary ${name} refers to an uncovered file: ${file}`);
    for (const context of contract_context) if (!final.contract_context.includes(context)) die(`cross_boundary ${name} refers to an unselected context: ${context}`);
    if ((claim.status === "covered" && !scope_files.length) || (claim.status === "not_applicable" && !contract_context.length)) die(`cross_boundary ${name} lacks required evidence`);
    boundaries[name] = { status: claim.status, scope_files, contract_context, rationale: claim.rationale.trim() };
  }
  const normalized = { version: 2, scope: { base_commit: o.base, candidate_commit: o.candidate, candidate_tree: o.tree, files: declared }, slices: slices.map(item => ({ name: item.name, kind: item.kind, files: item.files, contract_context: item.contract_context, ...(item.kind === "cross_boundary" ? { boundaries } : {}) })), approval: { by: manifest.approval.by } };
  const planId = sha(JSON.stringify(normalized)); if (!o.fingerprint && planId !== manifest.approval.expected_plan_id) die("manifest expected_plan_id mismatch");
  return { planId, slices: normalized.slices };
}
function envelope(repo, o, rows, contexts, name) {
  const material = [];
  for (const file of INVARIANTS) { regularTreeBlob(repo, o.candidate, file, "invariant"); material.push(`=== INVARIANT ${file} ===\n${blob(repo, o.candidate, file)}`); }
  for (const file of contexts) { regularTreeBlob(repo, o.candidate, file, "contract context"); material.push(`=== CONTRACT ${file} ===\n${blob(repo, o.candidate, file)}`); }
  for (const row of rows) material.push(`=== ${row.status === "D" ? "DELETED OLD" : "CURRENT"} FILE ${row.file} ===\n${blob(repo, row.status === "D" ? o.base : o.candidate, row.file)}`);
  const files = rows.map(row => row.file); material.push(`=== DIFF ${o.base}..${o.candidate} ===\n${git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--unified=80", o.base, o.candidate, "--", ...files])}`);
  const materialId = sha(JSON.stringify({ tuple: [o.base, o.candidate, o.tree], slice: name, material }));
  const markers = ["HEAD", "MIDDLE", "EOF"].map(position => `PIL-INGEST-${position}-${sha(`${materialId}|${position}`).slice(0, 24)}`);
  const done = `PIL-DONE-${sha(`${materialId}|DONE`).slice(0, 24)}`;
  const scope = JSON.stringify({ slice: name, base: o.base, candidate: o.candidate, tree: o.tree, files, contract_context: [...contexts].sort(lexical), invariants: INVARIANTS, material_sha256: materialId });
  const middle = Math.ceil(material.length / 2), supplied = [`=== INGESTION MARKER 1 OF 3 ===\n${markers[0]}`, ...material.slice(0, middle), `=== INGESTION MARKER 2 OF 3 ===\n${markers[1]}`, ...material.slice(middle), `=== NORMALIZED INSPECTED SCOPE ===\n${scope}`, `=== RESPONSE COMPLETION TOKEN ===\n${done}`, "=== END OF SUPPLIED MATERIAL ===", `=== EOF-ONLY INGESTION RECEIPT 3 OF 3 ===\n${markers[2]}`].join("\n\n");
  if (CREDENTIAL_LIKE.test(supplied)) die("possible credential-like value in final supplied review material", 3);
  const prompt = "Review this exact frozen committed artifact using only supplied material. Return findings, exactly one `VERDICT: GO` or `VERDICT: NO-GO` line, exactly one `INSPECTED SCOPE:` line copied exactly from supplied material, and exactly one `INGESTION PROOF:` line that contains the three supplied ingestion markers in encountered order, separated by ` | `. End the reply with the supplied response-completion token as its final nonblank line.";
  const request = { contents: [{ role: "user", parts: [{ text: `${prompt}\n\n${supplied}` }] }], generationConfig: { candidateCount: 1 } }, serialized = JSON.stringify(request);
  return { request, bytes: Buffer.byteLength(serialized), materialId, envelopeSha: sha(serialized), markers, done, scope, name };
}
export function verifyResponse(body, e) {
  if (!body || !Array.isArray(body.candidates) || body.candidates.length !== 1) die("provider response must contain exactly one candidate", 3);
  const candidate = body.candidates[0], parts = candidate.content?.parts;
  if (candidate.finishReason !== "STOP") die("provider response was not STOP", 3);
  if (!Array.isArray(parts) || !parts.length || parts.some(part => !part || !Object.hasOwn(part, "text") || typeof part.text !== "string" || Object.keys(part).some(key => key !== "text" && key !== "thoughtSignature") || (Object.hasOwn(part, "thoughtSignature") && typeof part.thoughtSignature !== "string"))) die("provider response parts must contain text and optional thoughtSignature only", 3);
  const reply = parts.map(part => part.text).join(""), verdicts = [...reply.matchAll(/^VERDICT:\s*(GO|NO-GO)\s*$/gm)].map(match => match[1]), scopes = [...reply.matchAll(/^INSPECTED SCOPE:\s*(.*)$/gm)].map(match => match[1]), proofs = [...reply.matchAll(/^INGESTION PROOF:\s*(.*)$/gm)].map(match => match[1]);
  if (verdicts.length !== 1) die("response must contain exactly one verdict", 3);
  if (scopes.length !== 1 || scopes[0] !== e.scope) die("response inspected scope does not exactly bind this frozen unit", 3);
  if (proofs.length !== 1 || proofs[0] !== e.markers.join(" | ")) die("response did not prove ordered ingestion through the EOF receipt", 3);
  if (reply.trimEnd().split(/\r?\n/).at(-1) !== e.done) die("response completion token is missing, misplaced, or not final", 3);
  return { reply, verdict: verdicts[0], replySha: sha(reply), completionSha: sha(e.done) };
}
function clean(value) { return String(value ?? "").replace(/[\r\n`]/g, " "); }
function recordBody(record) {
  const fields = [["Status", record.status], ["Record-Kind", record.kind], ["Release-Gate", record.release], ["Transport", "direct-gemini-rest-v1"], ["Attempt-ID", record.attemptId], ["Rig-ID", record.rigId], ["Rig-Key", record.rigKey], ["Failure-Class", record.failureClass || "(none)"], ["Base", record.base], ["Candidate", record.candidate], ["Tree", record.tree], ["Plan-ID", record.planId || "(none)"], ["Slice", record.slice], ["Material-SHA256", record.materialId || "(aggregate)"], ["Envelope-SHA256", record.envelopeSha], ["Envelope-Bytes", record.bytes], ["Ordered-Contributors", (record.contributors || []).join(",") || "(none)"]];
  if (record.verdict) {
    fields.push(["Gate-Verdict", record.verdict], ["Inspected-Scope", record.scope]);
    if (typeof record.reply === "string") fields.push(["Reply-SHA256", record.replySha], ["Completion-Token-SHA256", record.completionSha], ["Reply-UTF8-Base64", Buffer.from(record.reply, "utf8").toString("base64")]);
    else fields.push(["Aggregate-Result-SHA256", record.resultSha], ["Aggregate-Result", "assembled verified slice results; no model reply"]);
  }
  if (record.detail) fields.push(["Diagnostic", record.detail]);
  return `\n## Gemini frozen gate attempt — ${clean(record.status)} — ${new Date().toISOString()}\n\n${fields.map(([key, value]) => `- ${key}: \`${clean(value)}\``).join("\n")}\n`;
}
function append(repo, record) {
  const body = recordBody(record), complete = `${body}- Record-SHA256: \`${sha(body)}\`\n- Complete-Record: \`YES\`\n`, fd = fs.openSync(journalPath(repo), "a");
  try { fs.writeSync(fd, complete); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function preflightJournal(repo) { const file = journalPath(repo); fs.mkdirSync(path.dirname(file), { recursive: true }); const safe = journalPath(repo), fd = fs.openSync(safe, "a"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function sharedLock(repo, o) {
  const commonValue = git(repo, ["rev-parse", "--git-common-dir"]).trim(), common = path.resolve(repo, commonValue), lock = path.join(common, "cold-review-gemini.lock");
  if (o.sharedLockDir) {
    if (path.resolve(o.sharedLockDir) !== lock || String(process.pid) !== o.lockOwnerPid) die("wrapper shared lock ownership does not match this direct runner", 3);
    if (!fs.readFileSync(path.join(lock, "owner"), "utf8").match(new RegExp(`^pid=${process.pid}$`, "m"))) die("wrapper shared lock owner is not this direct runner", 3);
    return lock;
  }
  try { fs.mkdirSync(lock); } catch { die("another frozen Gemini gate owns this repository", 4); }
  try {
    fs.writeFileSync(path.join(lock, "owner"), `pid=${process.pid}\nrepo=${common}\nkind=direct\nscript=${fileURLToPath(import.meta.url)}\ncommand=${process.argv.join(" ")}\n`, { flag: "wx" });
  } catch (error) { fs.rmSync(lock, { recursive: true, force: true }); die(`cannot publish direct shared lock owner: ${error.message}`, 3); }
  return lock;
}
function complete(block) { const candidate = block.startsWith("## Gemini frozen gate attempt — ") ? `\n${block}` : block, match = candidate.match(/^([\s\S]*?)- Record-SHA256: `([0-9a-f]{64})`\n- Complete-Record: `YES`\n?$/); return Boolean(match && sha(match[1]) === match[2]); }
function rigKey(o) { return sha(`direct-gemini-rest-v1|${ENDPOINT}|${o.model}|${o.rigId}`); }
function cachedFailure(repo, key) {
  let journal = ""; try { journal = fs.readFileSync(path.join(repo, JOURNAL), "utf8"); } catch { return null; }
  for (const block of journal.split(/(?=^## Gemini frozen gate attempt — )/m).reverse()) {
    if (!complete(block) || !block.includes(`- Rig-Key: \`${key}\``)) continue;
    const status = block.match(/^- Status: `([^`]*)`$/m)?.[1], failure = block.match(/^- Failure-Class: `([^`]*)`$/m)?.[1];
    if (status === "FAILED_TRANSPORT" && ["AUTH", "PROVIDER", "TRANSPORT", "TIMEOUT"].includes(failure)) return failure;
  } return null;
}
function failureClass(error) { const message = String(error.message || ""); if (/HTTP 401|HTTP 403/.test(message)) return "AUTH"; if (/HTTP \d+/.test(message)) return "PROVIDER"; if (/timed out/.test(message)) return "TIMEOUT"; if (/response|ingestion|verdict|scope|text field/.test(message)) return "CANDIDATE_RESPONSE"; return "TRANSPORT"; }
async function call(o, e) {
  const key = process.env.GEMINI_API_KEY; if (!key) die("GEMINI_API_KEY is required only for a live direct API invocation", 3);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 600000);
  try { const response = await fetch(`${ENDPOINT}/${o.model}:generateContent`, { method: "POST", redirect: "error", signal: controller.signal, headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(e.request) }); if (!response.ok) die(`Gemini provider returned HTTP ${response.status}`, 3); return verifyResponse(await response.json(), e); }
  catch (error) { if (error.name === "AbortError") die("Gemini provider timed out", 3); throw error; } finally { clearTimeout(timer); }
}
export async function run(argv = process.argv.slice(2)) {
  const o = parse(argv), repo = validate(o.repo, o), rows = changed(repo, o), plan = o.sliceManifest ? verifyManifest(repo, o, rows) : null;
  const units = plan ? plan.slices.map(item => ({ name: item.name, rows: rows.filter(row => item.files.includes(row.file)), contexts: item.contract_context })) : [{ name: "full", rows, contexts: [o.context] }], prepared = units.map(unit => envelope(repo, o, unit.rows, unit.contexts, unit.name));
  for (const item of prepared) if (item.bytes >= LIMIT) die(`complete ${item.name} envelope is ${item.bytes} bytes; must be below ${LIMIT}`, 3);
  const identities = prepared.map(item => ({ slice: item.name, bytes: item.bytes, material_sha256: item.materialId, request_sha256: item.envelopeSha }));
  if (o.fingerprint) { process.stdout.write(JSON.stringify({ plan_id: plan.planId, envelopes: identities, next: "Set approval.status=APPROVED and approval.expected_plan_id to plan_id after PM review." }, null, 2) + "\n"); return; }
  if (o.dryRun) { process.stdout.write(JSON.stringify({ frozen: { base: o.base, candidate: o.candidate, tree: o.tree }, plan_id: plan?.planId || null, envelopes: identities }, null, 2) + "\n"); return; }
  preflightJournal(repo); const lock = sharedLock(repo, o);
  try {
    const key = rigKey(o), contributors = [], results = []; let allGo = true;
    for (const item of prepared) {
      if (cachedFailure(repo, key)) die(`cached transport rig failure for --rig-id ${o.rigId}; change the nonsecret rig declaration after a real recovery`, 3);
      const attemptId = random("PIL-FROZEN-ATTEMPT");
      try {
        endpoint(repo, o); const result = await call(o, item); endpoint(repo, o);
        append(repo, { status: result.verdict === "GO" ? "PASS_VERDICT" : "NO_GO", kind: plan ? "SLICE_RESULT" : "FULL_REVIEW", release: result.verdict === "GO" && !plan ? "YES" : "NO", attemptId, rigId: o.rigId, rigKey: key, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan?.planId, slice: item.name, materialId: item.materialId, envelopeSha: item.envelopeSha, bytes: item.bytes, verdict: result.verdict, scope: item.scope, replySha: result.replySha, completionSha: result.completionSha, reply: result.reply });
        contributors.push(attemptId); results.push({ attempt_id: attemptId, slice: item.name, verdict: result.verdict, material_sha256: item.materialId, reply_sha256: result.replySha, inspected_scope_sha256: sha(item.scope) }); allGo &&= result.verdict === "GO"; process.stdout.write(`${result.reply}\n`);
      } catch (error) { const failure = failureClass(error); append(repo, { status: failure === "CANDIDATE_RESPONSE" ? "FAILED_CANDIDATE_RESPONSE" : "FAILED_TRANSPORT", kind: plan ? "SLICE_RESULT" : "FULL_REVIEW", release: "NO", attemptId, rigId: o.rigId, rigKey: key, failureClass: failure, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan?.planId, slice: item.name, materialId: item.materialId, envelopeSha: item.envelopeSha, bytes: item.bytes, detail: error.message }); throw error; }
    }
    if (plan) {
      endpoint(repo, o);
      const aggregateMaterialId = sha(JSON.stringify({ plan_id: plan.planId, envelopes: prepared.map(item => ({ slice: item.name, material_sha256: item.materialId, request_sha256: item.envelopeSha })), contributors: results }));
      const scope = JSON.stringify({ slice: "aggregate", base: o.base, candidate: o.candidate, tree: o.tree, plan_id: plan.planId, material_sha256: aggregateMaterialId, contributors: results });
      const verdict = allGo ? "GO" : "NO-GO", resultSha = sha(JSON.stringify({ verdict, scope }));
      append(repo, { status: allGo ? "PASS_VERDICT" : "NO_GO", kind: "SLICE_SET", release: allGo ? "YES" : "NO", attemptId: random("PIL-FROZEN-AGGREGATE"), rigId: o.rigId, rigKey: key, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan.planId, slice: "aggregate", materialId: aggregateMaterialId, envelopeSha: sha(prepared.map(item => item.envelopeSha).join("")), bytes: prepared.reduce((sum, item) => sum + item.bytes, 0), contributors, verdict, scope, resultSha });
    }
    if (!allGo) process.exitCode = 3;
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch(error => { process.stderr.write(`gemini-frozen-gate: ${error.message}\n`); process.exit(error.exitCode || 3); });
