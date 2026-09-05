#!/usr/bin/env node
// A committed-artifact Gemini gate.  Unlike the legacy agy runner this sends one text request and
// has no agent/tool loop: all repository reads finish before fetch is called.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIMIT = 81920;
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const JOURNAL = "docs/journal/gemini_review_log.md";
const INVARIANTS = ["core/INVARIANTS.md", "core/REPO_INVARIANTS.md"];
const HEX = /^[0-9a-f]{40}$/;
const MODEL = /^[A-Za-z0-9._-]+$/;
const RIG = /^[A-Za-z0-9._:-]{1,120}$/;

function die(message, code = 2) { throw Object.assign(new Error(message), { exitCode: code }); }
function git(repo, args, encoding = "utf8") {
  try { return execFileSync("git", ["-C", repo, "-c", "diff.external=", ...args], { encoding, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) { die(`git ${args.join(" ")} failed: ${String(error.stderr || error.message).trim()}`); }
}
function blob(repo, commit, rel) {
  if (!rel || path.isAbsolute(rel) || rel.split("/").includes("..") || rel.includes("\0")) die(`invalid candidate-relative path: ${rel}`);
  const bytes = git(repo, ["show", `${commit}:${rel}`], "buffer");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { die(`non-UTF-8 artifact is unsupported: ${rel}`); }
  if (/\0/.test(text)) die(`binary artifact is unsupported: ${rel}`);
  if (/(?:AIza[\w-]{35}|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{8,})/i.test(text)) die(`possible secret in review artifact: ${rel}`);
  return text;
}
function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function random(label) { return `${label}-${crypto.randomBytes(12).toString("hex")}`; }
function parse(argv) {
  const out = { repo: process.cwd(), model: "gemini-2.5-pro", dryRun: false, noLog: false, runSlices: false, fingerprint: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--dry-run") { out.dryRun = true; continue; }
    if (k === "--no-log") { out.noLog = true; continue; }
    if (k === "--run-slices") { out.runSlices = true; continue; }
    if (k === "--fingerprint") { out.fingerprint = true; continue; }
    const v = argv[++i]; if (!k.startsWith("--") || !v) die(`invalid argument near ${k}`);
    out[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  for (const key of ["base", "candidate", "tree", "rigId"]) if (!out[key]) die(`missing --${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`);
  if (![out.base, out.candidate, out.tree].every(v => HEX.test(v))) die("base, candidate, and tree must be exact lowercase 40-hex IDs");
  if (!RIG.test(out.rigId)) die("--rig-id must be a nonsecret [A-Za-z0-9._:-] identifier");
  if (!MODEL.test(out.model)) die("--model is not a supported Gemini model identifier");
  if (out.sliceManifest ? ((!out.runSlices && !out.fingerprint) || out.context) : (out.runSlices || out.fingerprint || !out.context)) die("use --context for one full review, or --slice-manifest with --run-slices/--fingerprint");
  return out;
}
function validate(repo, o) {
  repo = fs.realpathSync(repo);
  const status = git(repo, ["status", "--porcelain=v1", "-z"]);
  const dirty = status.split("\0").filter(Boolean).map(s => s.slice(3)).filter(p => p !== JOURNAL && !p.startsWith(".gemini-gate/"));
  if (dirty.length) die(`source checkout is dirty outside sanctioned artifacts: ${dirty.join(", ")}`);
  for (const [id, type] of [[o.base, "commit"], [o.candidate, "commit"], [o.tree, "tree"]]) {
    if (git(repo, ["cat-file", "-t", id]).trim() !== type) die(`${id} is not a ${type}`);
  }
  if (git(repo, ["rev-parse", `${o.candidate}^{tree}`]).trim() !== o.tree) die("candidate tree does not equal --tree");
  try { execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", o.base, o.candidate], { stdio: "ignore" }); } catch { die("--base is not an ancestor of --candidate"); }
  return repo;
}
function changed(repo, o) {
  const raw = git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", o.base, o.candidate]);
  const values = raw.split("\0").filter(Boolean); const rows = [];
  for (let i = 0; i < values.length; i += 2) {
    const status = values[i]; const file = values[i + 1];
    if (!file || !["A", "M", "D"].includes(status)) die(`unsupported changed entry: ${status || "missing"}`);
    rows.push({ status, file });
  }
  if (!rows.length) die("candidate has no committed changes against base");
  return rows;
}
function verifyManifest(repo, o, rows) {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(repo, o.sliceManifest), "utf8"));
  if (manifest.version !== 2 || manifest.scope?.base_commit !== o.base || manifest.scope?.candidate_commit !== o.candidate || manifest.scope?.candidate_tree !== o.tree) die("slice manifest does not bind the exact frozen base/candidate/tree");
  if (!manifest.approval?.by || (!o.fingerprint && (manifest.approval.status !== "APPROVED" || !manifest.approval.expected_plan_id))) die("slice manifest is not PM-approved");
  const actual = rows.map(r => r.file).sort(); const declared = [...new Set(manifest.scope.files || [])].sort();
  if (actual.join("\0") !== declared.join("\0") || (manifest.uncovered || []).length) die("manifest scope is not complete for the committed candidate");
  const slices = manifest.slices || []; if (slices.length < 2 || slices.at(-1)?.kind !== "cross_boundary") die("manifest needs coverage slices followed by one final cross_boundary slice");
  const names = new Set(); const coverage = [];
  for (const slice of slices) {
    if (!slice?.name || names.has(slice.name) || !Array.isArray(slice.files) || !Array.isArray(slice.contract_context)) die("slice names/files/context are malformed or duplicate");
    names.add(slice.name); if (slice.kind === "coverage") coverage.push(...slice.files); else if (slice.kind !== "cross_boundary") die(`invalid slice kind: ${slice.kind}`);
  }
  if ([...new Set(coverage)].sort().join("\0") !== actual.join("\0")) die("coverage slices do not cover the exact committed surface");
  const identity = JSON.stringify({ version: 2, scope: manifest.scope, slices: manifest.slices, approval: { by: manifest.approval.by || "" } });
  const planId = sha(identity); if (!o.fingerprint && planId !== manifest.approval.expected_plan_id) die("manifest expected_plan_id mismatch");
  return { manifest, planId, slices };
}
function envelope(repo, o, rows, contexts, name = "full") {
  const selection = new Set(rows.map(r => r.file));
  const material = [];
  for (const f of INVARIANTS) material.push(`=== INVARIANT ${f} ===\n${blob(repo, o.candidate, f)}`);
  for (const c of contexts) material.push(`=== CONTRACT ${c} ===\n${blob(repo, o.candidate, c)}`);
  for (const row of rows) if (selection.has(row.file)) {
    const at = row.status === "D" ? o.base : o.candidate;
    material.push(`=== ${row.status === "D" ? "DELETED OLD" : "CURRENT"} FILE ${row.file} ===\n${blob(repo, at, row.file)}`);
  }
  const files = rows.map(r => r.file);
  const diff = git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--unified=80", o.base, o.candidate, "--", ...files]);
  material.push(`=== DIFF ${o.base}..${o.candidate} ===\n${diff}`);
  const receipt = random("PIL-RCPT"), done = random("PIL-DONE"), canary = random("PIL-INGEST");
  const prompt = `Review this exact frozen committed artifact. Use only supplied text. Return findings, then exactly one VERDICT: GO or VERDICT: NO-GO and INSPECTED SCOPE: ${name} including every supplied file/context. Begin with ${receipt}; include ${canary}; end with ${done}.`;
  const text = `${prompt}\n\n[[${canary}]]\n${material.join("\n\n")}\n\n=== END ===\nRECEIPT: ${receipt}`;
  const request = { contents: [{ role: "user", parts: [{ text }] }], generationConfig: { candidateCount: 1 } };
  const serialized = JSON.stringify(request);
  return { request, bytes: Buffer.byteLength(serialized), receipt, done, canary, files, envelopeSha: sha(serialized), name };
}
export function verifyResponse(body, e) {
  if (!body || !Array.isArray(body.candidates) || body.candidates.length !== 1) die("provider response must contain exactly one candidate", 3);
  const c = body.candidates[0]; if (c.finishReason !== "STOP") die("provider response was not STOP", 3);
  if (!Array.isArray(c.content?.parts) || !c.content.parts.length || c.content.parts.some(p => typeof p.text !== "string" || p.functionCall)) die("provider response contains non-text or function-call parts", 3);
  const reply = c.content.parts.map(p => p.text).join("");
  if (!reply.trim() || !reply.includes(e.receipt) || !reply.includes(e.canary) || !reply.trimEnd().endsWith(e.done)) die("response failed receipt/canary/completion verification", 3);
  const verdicts = [...reply.matchAll(/^\s*(?:VERDICT:\s*)?(GO|NO-GO)\s*$/gmi)].map(m => m[1].toUpperCase());
  if (verdicts.length !== 1 || !/^INSPECTED SCOPE:\s*.+/mi.test(reply)) die("response lacks one explicit verdict or inspected scope", 3);
  if (!reply.includes(`INSPECTED SCOPE: ${e.name}`)) die("inspected scope is not bound to this artifact/slice", 3);
  return { reply, verdict: verdicts[0] };
}
function rigKey(o) { return sha(`direct-gemini-rest-v1|${ENDPOINT}|${o.model}|${o.rigId}`); }
function append(repo, record) {
  fs.appendFileSync(path.join(repo, JOURNAL), `\n## Gemini gate attempt — ${record.status} — ${new Date().toISOString()}\n\n- Status: \`${record.status}\`\n- Record-Kind: \`${record.kind}\`\n- Release-Gate: \`${record.release}\`\n- Transport: \`direct-gemini-rest-v1\`\n- Rig-ID: \`${record.rigId}\`\n- Rig-Key: \`${record.rigKey}\`\n- Failure-Class: \`${record.failureClass || "(none)"}\`\n- Base: \`${record.base}\`\n- Candidate: \`${record.candidate}\`\n- Tree: \`${record.tree}\`\n- Plan-ID: \`${record.planId || "(none)"}\`\n- Slice: \`${record.slice}\`\n- Envelope-SHA: \`${record.envelopeSha}\`\n- Envelope-Bytes: \`${record.bytes}\`\n${record.verdict ? `- Gate-Verdict: \`${record.verdict}\`\n` : ""}${record.detail ? `\n### Diagnostic output — NOT A VERDICT\n\n    ${String(record.detail).replace(/[\r\n]+/g, " ")}\n` : ""}`);
}
function failureClass(error) {
  const message = String(error.message || "");
  if (/HTTP 401|HTTP 403/.test(message)) return "AUTH";
  if (/HTTP \d+/.test(message)) return "PROVIDER";
  if (/timed out/.test(message)) return "TIMEOUT";
  if (/response|receipt|canary|verdict|scope|function-call|non-text/.test(message)) return "CANDIDATE_RESPONSE";
  return "TRANSPORT";
}
function cachedRigFailure(repo, key) {
  let journal = ""; try { journal = fs.readFileSync(path.join(repo, JOURNAL), "utf8"); } catch { return null; }
  const blocks = journal.split(/(?=^## Gemini gate attempt — )/m);
  for (const block of blocks.reverse()) {
    if (!block.includes("- Transport: `direct-gemini-rest-v1`") || !block.includes(`- Rig-Key: \`${key}\``)) continue;
    const matched = block.match(/- Failure-Class: `([^`]*)`/);
    if (matched && ["AUTH", "PROVIDER", "TRANSPORT", "TIMEOUT"].includes(matched[1])) return matched[1];
  }
  return null;
}
async function call(o, e) {
  const key = process.env.GEMINI_API_KEY; if (!key) die("GEMINI_API_KEY is required only for a live direct API invocation", 3);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 600000);
  try {
    const response = await fetch(`${ENDPOINT}/${o.model}:generateContent`, { method: "POST", redirect: "error", signal: controller.signal, headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(e.request) });
    if (!response.ok) die(`Gemini provider returned HTTP ${response.status}`, 3);
    return verifyResponse(await response.json(), e);
  } catch (error) { if (error.name === "AbortError") die("Gemini provider timed out", 3); throw error; } finally { clearTimeout(timer); }
}
async function main() {
  const o = parse(process.argv.slice(2)); const repo = validate(o.repo, o); const rows = changed(repo, o);
  const plan = o.sliceManifest ? verifyManifest(repo, o, rows) : null;
  const units = plan ? plan.slices.map(s => ({ name: s.name, rows: rows.filter(r => s.files.includes(r.file)), contexts: s.contract_context })) : [{ name: "full", rows, contexts: [o.context] }];
  const prepared = units.map(u => envelope(repo, o, u.rows, u.contexts, u.name));
  for (const e of prepared) if (e.bytes >= LIMIT) die(`complete ${e.name} envelope is ${e.bytes} bytes; must be below ${LIMIT}`, 3);
  if (o.fingerprint) { process.stdout.write(JSON.stringify({ plan_id: plan.planId, envelopes: prepared.map(e => ({ slice: e.name, bytes: e.bytes, sha256: e.envelopeSha })), next: "Set approval.status=APPROVED and approval.expected_plan_id to plan_id after PM review." }, null, 2) + "\n"); return; }
  if (o.dryRun) { process.stdout.write(JSON.stringify({ frozen: { base: o.base, candidate: o.candidate, tree: o.tree }, plan_id: plan?.planId || null, envelopes: prepared.map(e => ({ slice: e.name, bytes: e.bytes, sha256: e.envelopeSha })) }, null, 2) + "\n"); return; }
  const lock = path.join(git(repo, ["rev-parse", "--git-common-dir"]).trim(), "gemini-frozen-gate.lock");
  try { fs.mkdirSync(lock); } catch { die("another frozen Gemini gate owns this repository", 4); }
  try {
    let allGo = true;
    const effectiveRigKey = rigKey(o);
    for (const e of prepared) {
      const cached = cachedRigFailure(repo, effectiveRigKey);
      if (cached) die(`cached ${cached} rig failure for --rig-id ${o.rigId}; change the nonsecret rig declaration after a real recovery`, 3);
      let result; try { result = await call(o, e); } catch (error) { if (!o.noLog) append(repo, { status: "FAILED_TOOL", kind: plan ? "SLICE_RESULT" : "FULL_REVIEW", release: "NO", rigId: o.rigId, rigKey: effectiveRigKey, failureClass: failureClass(error), base: o.base, candidate: o.candidate, tree: o.tree, planId: plan?.planId, slice: e.name, envelopeSha: e.envelopeSha, bytes: e.bytes, detail: error.message }); throw error; }
      allGo &&= result.verdict === "GO";
      if (!o.noLog) append(repo, { status: "PASS_VERDICT", kind: plan ? "SLICE_RESULT" : "FULL_REVIEW", release: result.verdict === "GO" && !plan ? "YES" : "NO", rigId: o.rigId, rigKey: effectiveRigKey, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan?.planId, slice: e.name, envelopeSha: e.envelopeSha, bytes: e.bytes, verdict: result.verdict });
    }
    if (plan && !o.noLog) append(repo, { status: allGo ? "PASS_VERDICT" : "NO_GO", kind: "SLICE_SET", release: allGo ? "YES" : "NO", rigId: o.rigId, rigKey: effectiveRigKey, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan.planId, slice: "aggregate", envelopeSha: sha(prepared.map(e => e.envelopeSha).join("")), bytes: prepared.reduce((n, e) => n + e.bytes, 0), verdict: allGo ? "GO" : "NO-GO" });
    if (!allGo) process.exitCode = 3;
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`gemini-frozen-gate: ${error.message}\n`); process.exit(error.exitCode || 3); });
