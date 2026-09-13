#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIMIT = 81920, JOURNAL = "docs/journal/gemini_review_log.md", SUBSCRIPTION_MODEL = "gemini-3.1-pro-high", SUBSCRIPTION_EFFORT = "high", SUBSCRIPTION_TIMEOUT_SECONDS = 600, SUBSCRIPTION_STDOUT_LIMIT = 4 * 1024 * 1024, SUBSCRIPTION_STDERR_LIMIT = 1024 * 1024, MANUAL_TRANSPORT = "operator-attested-manual-gemini-subscription-v1";
const INVARIANTS = ["core/INVARIANTS.md", "core/REPO_INVARIANTS.md"], HEX = /^[0-9a-f]{40}$/, SHA256 = /^[0-9a-f]{64}$/, MODEL = /^[A-Za-z0-9._-]+$/, RIG = /^[A-Za-z0-9._:-]{1,120}$/;
const MODES = new Set(["100644", "100755"]), BOUNDARIES = ["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"];
const FRAGMENT_KINDS = new Set(["frozen_source", "deleted_source", "per_file_diff"]);
const GIT_LOCATION_OVERRIDES = ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];
const CREDENTIAL_LIKE = /(?:AIza[\w-]{35}|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:api[_-]?key|secret|token|password|passphrase)\s*[:=]\s*(?!["']?(?:\$\{[^}\r\n]+\}|\$\([^\)\r\n]+\)|\$\d+|<[^>\r\n]+>|(?:CHANGEME|REDACTED)(?:["']?(?:\s|$))))(?:["'][^"']{1,}|[A-Za-z0-9][^\s#]{7,})|\bauthorization\s*[:=]\s*(?!["']?[!#$%&'*+\-.^_`|~0-9A-Za-z]+\s+(?:\$\{[^}\r\n]+\}|\$\([^\)\r\n]+\)|\$\d+|<[^>\r\n]+>|(?:CHANGEME|REDACTED)(?:["']?(?:\s|$))))["']?[!#$%&'*+\-.^_`|~0-9A-Za-z]+\s+(?:["'][^"']{1,}|[^\s#"']+)|\bbearer\s+[A-Za-z0-9._~+/=-]{8,})/i;
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
function artifactBytes(repo, commit, file, label = "artifact") {
  file = relative(file, "artifact path");
  const bytes = git(repo, ["show", `${commit}:${file}`], "buffer");
  let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { die(`non-UTF-8 ${label} is unsupported: ${file}`); }
  if (/\0/.test(text)) die(`binary ${label} is unsupported: ${file}`);
  return bytes;
}
function blob(repo, commit, file) {
  return artifactBytes(repo, commit, file).toString("utf8");
}
function diffBytes(repo, base, candidate, file) {
  const bytes = git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--unified=80", base, candidate, "--", file], "buffer");
  let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { die(`non-UTF-8 per-file diff is unsupported: ${file}`); }
  if (/\0/.test(text)) die(`binary per-file diff is unsupported: ${file}`);
  return bytes;
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
  const o = { repo: process.cwd(), model: SUBSCRIPTION_MODEL, effort: SUBSCRIPTION_EFFORT, timeoutSeconds: SUBSCRIPTION_TIMEOUT_SECONDS, dryRun: false, noLog: false, runSlices: false, fingerprint: false, generateSlicePlan: undefined, handoffExport: undefined, handoffImport: undefined };
  const flags = new Set(["--dry-run", "--no-log", "--run-slices", "--fingerprint"]), valueOptions = new Set(["repo", "model", "effort", "agyBin", "timeoutSeconds", "base", "candidate", "tree", "rigId", "context", "sliceManifest", "generateSlicePlan", "handoffExport", "handoffImport", "sharedLockDir", "lockOwnerPid"]);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--transport") die("frozen Gemini transport is subscription-only; REST/API transport is unavailable", 3);
    if (flags.has(key)) { o[{ "--dry-run": "dryRun", "--no-log": "noLog", "--run-slices": "runSlices", "--fingerprint": "fingerprint" }[key]] = true; continue; }
    if (!key?.startsWith("--")) die(`invalid argument near ${key}`);
    const name = key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!valueOptions.has(name)) die(`unknown option ${key}`);
    const value = argv[++i]; if (value === undefined || value === "" || value.startsWith("--")) die(`missing or option-shaped value for ${key}`);
    o[name] = value;
  }
  for (const key of ["base", "candidate", "tree", "rigId"]) if (!o[key]) die(`missing --${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`);
  if (![o.base, o.candidate, o.tree].every(value => HEX.test(value))) die("base, candidate, and tree must be exact lowercase 40-hex IDs");
  if (!RIG.test(o.rigId) || !MODEL.test(o.model) || o.effort !== SUBSCRIPTION_EFFORT) die(`frozen subscription transport requires model ${SUBSCRIPTION_MODEL} and effort ${SUBSCRIPTION_EFFORT}`);
  if (o.model !== SUBSCRIPTION_MODEL) die(`frozen subscription transport requires --model ${SUBSCRIPTION_MODEL}`);  // gate-binding-ok: out-of-matrix — the Gemini cross-family seat, pinned to the operator's subscription model by core/GATES.md § Gemini cross-family gate; § Model · effort matrix binds the Codex and Claude gate columns only. Read by an adopting repo's seat-binding checker; the kit ships none.
  if (o.agyBin && !path.isAbsolute(o.agyBin)) die("--agy-bin must be an absolute executable path", 3);
  if (!/^\d+$/.test(String(o.timeoutSeconds)) || Number(o.timeoutSeconds) < 1 || Number(o.timeoutSeconds) > SUBSCRIPTION_TIMEOUT_SECONDS) die(`--timeout-seconds must be a whole number from 1 through ${SUBSCRIPTION_TIMEOUT_SECONDS}`, 3);
  o.timeoutSeconds = Number(o.timeoutSeconds);
  if (o.generateSlicePlan) {
    if (o.sliceManifest || o.handoffExport || o.handoffImport || o.runSlices || o.fingerprint || o.dryRun || o.noLog || !o.context) die("--generate-slice-plan requires --context and forbids handoff, run, fingerprint, and logging flags");
    o.generateSlicePlan = relative(o.generateSlicePlan, "--generate-slice-plan");
    if (!o.generateSlicePlan.startsWith(".gemini-gate/")) die("--generate-slice-plan must name a repository-relative .gemini-gate/ manifest");
  } else if (o.handoffExport || o.handoffImport) {
    if (Boolean(o.handoffExport) === Boolean(o.handoffImport) || !o.sliceManifest || o.context || o.fingerprint || o.dryRun || o.noLog) die("a strict manual handoff requires exactly one of --handoff-export/--handoff-import with --slice-manifest only", 3);
    const key = o.handoffExport ? "handoffExport" : "handoffImport", label = o.handoffExport ? "--handoff-export" : "--handoff-import";
    o[key] = relative(o[key], label); if (!o[key].startsWith(".gemini-gate/")) die(`${label} must name a repository-relative .gemini-gate directory`, 3);
  } else if (o.sliceManifest ? ((!o.runSlices && !o.fingerprint) || o.context) : (!o.context || o.runSlices || o.fingerprint)) die("use --context for an automated full review, --slice-manifest --run-slices, --fingerprint, or strict manual handoff", 3);
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
  if (manifest.slices?.some(item => item?.draft?.state === "NEEDS_HUMAN_CROSS_BOUNDARY")) die("generated DRAFT cross-boundary placeholder requires human fragment selections and all five boundary rationales before fingerprint or run", 3);
  if (!manifest.approval?.by || typeof manifest.approval.by !== "string" || (!o.fingerprint && (manifest.approval.status !== "APPROVED" || !SHA256.test(manifest.approval.expected_plan_id || "")))) die("slice manifest is not PM-approved");
  const declared = paths(manifest.scope.files, "manifest scope.files");
  if (declared.join("\0") !== actualFiles.join("\0") || !Array.isArray(manifest.uncovered) || manifest.uncovered.length) die("manifest scope is not complete for the committed candidate");
  if (!Array.isArray(manifest.slices) || manifest.slices.length < 2) die("manifest requires coverage slices plus final cross_boundary slice");
  const slices = manifest.slices.map(raw => slice(raw, actual));
  if (new Set(slices.map(item => item.name)).size !== slices.length) die("slice names must be unique");
  const coverage = slices.filter(item => item.kind === "coverage"), cross = slices.filter(item => item.kind === "cross_boundary");
  if (!coverage.length || cross.length !== 1 || slices.at(-1) !== cross[0]) die("manifest requires exactly one final cross_boundary slice");
  const covered = new Set(); for (const item of coverage) for (const file of item.files) { if (covered.has(file) && item.raw.fragments === undefined && !coverage.some(other => other !== item && other.files.includes(file) && other.raw.fragments !== undefined)) die(`coverage slices overlap: ${file}`); covered.add(file); }
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
  const normalized = { version: 2, scope: { base_commit: o.base, candidate_commit: o.candidate, candidate_tree: o.tree, files: declared }, slices: slices.map(item => ({ name: item.name, kind: item.kind, files: item.files, contract_context: item.contract_context, ...(item.raw.fragments !== undefined ? { fragments: item.raw.fragments } : {}), ...(item.kind === "cross_boundary" ? { boundaries } : {}) })), approval: { by: manifest.approval.by } };
  const planId = sha(JSON.stringify(normalized)); if (!o.fingerprint && planId !== manifest.approval.expected_plan_id) die("manifest expected_plan_id mismatch");
  return { planId, slices: normalized.slices };
}
function component(repo, o, row, kind) {
  if (kind === "frozen_source") return { path: row.file, kind, bytes: artifactBytes(repo, o.candidate, row.file, "source") };
  if (kind === "deleted_source") return { path: row.file, kind, bytes: artifactBytes(repo, o.base, row.file, "deleted source") };
  if (kind === "per_file_diff") return { path: row.file, kind, bytes: diffBytes(repo, o.base, o.candidate, row.file) };
  die(`unknown fragment component kind: ${kind}`);
}
function componentKey(pathname, kind) { return `${pathname}\0${kind}`; }
function fragmentKey(fragment) { return `${fragment.path}\0${fragment.component_kind}\0${String(fragment.byte_start).padStart(20, "0")}`; }
function validateFragments(repo, o, rows, rawFragments, complete, coveredComponents = new Set(), enforceCovered = !complete) {
  if (rawFragments === undefined) return null;
  if (!Array.isArray(rawFragments) || !rawFragments.length) die("fragmented slice requires a nonempty fragments array");
  const rowMap = new Map(rows.map(row => [row.file, row])), components = new Map();
  for (const row of rows) {
    const sourceKind = row.status === "D" ? "deleted_source" : "frozen_source";
    for (const kind of [sourceKind, "per_file_diff"]) components.set(componentKey(row.file, kind), component(repo, o, row, kind));
  }
  const normalized = [];
  for (const [index, raw] of rawFragments.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) die(`fragments[${index}] must be an object`);
    if (raw.base_commit !== o.base || raw.candidate_commit !== o.candidate || raw.candidate_tree !== o.tree) die(`fragments[${index}] does not bind the exact frozen tuple`);
    if (typeof raw.path !== "string" || !rowMap.has(raw.path)) die(`fragments[${index}] names an unknown path`);
    if (!FRAGMENT_KINDS.has(raw.component_kind)) die(`fragments[${index}] has an unknown component kind`);
    const row = rowMap.get(raw.path), expectedKind = row.status === "D" ? "deleted_source" : "frozen_source";
    if (raw.component_kind !== expectedKind && raw.component_kind !== "per_file_diff") die(`fragments[${index}] has the wrong component kind for ${raw.path}`);
    const key = componentKey(raw.path, raw.component_kind), original = components.get(key);
    if (!original) die(`fragments[${index}] names an unavailable component`);
    if (!["component_byte_length", "byte_start", "byte_end"].every(field => Number.isSafeInteger(raw[field]) && raw[field] >= 0)) die(`fragments[${index}] has invalid byte offsets or component length`);
    if (raw.component_byte_length !== original.bytes.length || raw.component_sha256 !== sha(original.bytes)) die(`fragments[${index}] component length/hash does not match original bytes`);
    if (raw.byte_start > raw.byte_end || raw.byte_end > original.bytes.length) die(`fragments[${index}] byte range is outside its component`);
    if (raw.byte_start === raw.byte_end && original.bytes.length > 0) die(`fragments[${index}] must contribute bytes for a nonempty component`);
    if (typeof raw.fragment_sha256 !== "string" || !SHA256.test(raw.fragment_sha256)) die(`fragments[${index}] requires fragment_sha256`);
    const bytes = original.bytes.subarray(raw.byte_start, raw.byte_end);
    try { new TextDecoder("utf-8", { fatal: true }).decode(original.bytes.subarray(0, raw.byte_start)); new TextDecoder("utf-8", { fatal: true }).decode(original.bytes.subarray(raw.byte_end)); } catch { die(`fragments[${index}] offsets must align to UTF-8 boundaries`); }
    if (sha(bytes) !== raw.fragment_sha256) die(`fragments[${index}] bytes do not match fragment_sha256`);
    if (enforceCovered && !coveredComponents.has(key)) die(`cross_boundary fragment ${raw.path}/${raw.component_kind} is not drawn from covered material`);
    normalized.push({ base_commit: raw.base_commit, candidate_commit: raw.candidate_commit, candidate_tree: raw.candidate_tree, path: raw.path, component_kind: raw.component_kind, component_byte_length: raw.component_byte_length, component_sha256: raw.component_sha256, byte_start: raw.byte_start, byte_end: raw.byte_end, fragment_sha256: raw.fragment_sha256, bytes });
  }
  const ordered = [...normalized].sort((a, b) => lexical(fragmentKey(a), fragmentKey(b)));
  if (ordered.some((fragment, index) => fragment !== normalized[index])) die("fragments must be in deterministic path/kind/byte-start order");
  const groups = new Map();
  for (const fragment of normalized) { const key = componentKey(fragment.path, fragment.component_kind); const list = groups.get(key) || []; list.push(fragment); groups.set(key, list); }
  if (complete) {
    for (const [key, original] of components) {
      const list = groups.get(key) || [];
      let offset = 0;
      for (const fragment of list) { if (fragment.byte_start !== offset) die(`fragment partition for ${key.replace("\0", "/")} has a gap, overlap, duplicate, or reorder`); offset = fragment.byte_end; }
      if (offset !== original.bytes.length) die(`fragment partition for ${key.replace("\0", "/")} does not cover the complete component`);
    }
  }
  return normalized;
}
function validateCoveragePartitions(repo, o, rows, units) {
  const coverage = units.filter(unit => unit.kind === "coverage"), all = [], perFile = new Map();
  for (const unit of coverage) {
    const unitRows = unit.rows;
    if (unit.fragments === undefined) {
      for (const row of unitRows) {
        const key = row.file, entries = perFile.get(key) || [];
        entries.push({ implicit: true, unit }); perFile.set(key, entries);
      }
      continue;
    }
    const normalized = validateFragments(repo, o, unitRows, unit.fragments, false, new Set(), false) || [];
    all.push(...normalized);
    for (const row of unitRows) {
      const key = row.file, entries = perFile.get(key) || [];
      entries.push({ implicit: false, unit }); perFile.set(key, entries);
    }
  }
  for (const [file, entries] of perFile) {
    if (entries.length > 1 && entries.some(entry => entry.implicit)) die(`coverage file ${file} mixes whole-file and fragment evidence`);
  }
  const componentRows = new Map(rows.map(row => [row.file, row]));
  for (const [file, row] of componentRows) {
    const sourceKind = row.status === "D" ? "deleted_source" : "frozen_source";
    const explicit = all.filter(fragment => fragment.path === file);
    if (!perFile.get(file)?.some(entry => !entry.implicit)) continue;
    if (!explicit.length) die(`fragmented coverage file ${file} contributes no fragments`);
    for (const kind of [sourceKind, "per_file_diff"]) {
      const original = component(repo, o, row, kind).bytes;
      // Coverage is executed in manifest order.  Preserve that order here so
      // a plan cannot hide an out-of-order range by sorting it back into place.
      const list = all.filter(fragment => fragment.path === file && fragment.component_kind === kind);
      let offset = 0;
      for (const fragment of list) { if (fragment.byte_start !== offset) die(`fragment partition for ${file}/${kind} has a gap, overlap, duplicate, or reorder`); offset = fragment.byte_end; }
      if (offset !== original.length) die(`fragment partition for ${file}/${kind} does not cover the complete component`);
    }
  }
}
function fragmentDescriptor(fragment) {
  const range_status = fragment.byte_start === 0 && fragment.byte_end === fragment.component_byte_length ? "whole" : "partial";
  return { path: fragment.path, component_kind: fragment.component_kind, component_byte_length: fragment.component_byte_length, component_sha256: fragment.component_sha256, byte_start: fragment.byte_start, byte_end: fragment.byte_end, fragment_sha256: fragment.fragment_sha256, range_status };
}
function envelope(repo, o, rows, contexts, name, rawFragments, complete, coveredComponents, sliceKind = "full") {
  const material = [];
  const files = rows.map(row => row.file);
  for (const file of INVARIANTS) { regularTreeBlob(repo, o.candidate, file, "invariant"); material.push(`=== INVARIANT ${file} ===\n${blob(repo, o.candidate, file)}`); }
  for (const file of contexts) { regularTreeBlob(repo, o.candidate, file, "contract context"); material.push(`=== CONTRACT ${file} ===\n${blob(repo, o.candidate, file)}`); }
  const completeComponents = rows.flatMap(row => [component(repo, o, row, row.status === "D" ? "deleted_source" : "frozen_source"), component(repo, o, row, "per_file_diff")]);
  const completeScan = Buffer.concat([...material.map(value => Buffer.from(value)), ...completeComponents.map(item => item.bytes)]).toString("utf8");
  if (CREDENTIAL_LIKE.test(completeScan)) die("possible credential-like value in complete unpartitioned review material", 3);
  const fragments = validateFragments(repo, o, rows, rawFragments, false, coveredComponents, complete);
  if (fragments) {
    if (complete) for (const row of rows) if (!fragments.some(fragment => fragment.path === row.file && fragment.bytes.length > 0)) die(`cross_boundary final file ${row.file} contributes no bytes`);
    const byKey = new Map(); for (const fragment of fragments) { const key = componentKey(fragment.path, fragment.component_kind); const list = byKey.get(key) || []; list.push(fragment); byKey.set(key, list); }
    for (const row of rows) {
      const sourceKind = row.status === "D" ? "deleted_source" : "frozen_source";
      for (const kind of [sourceKind, "per_file_diff"]) for (const fragment of byKey.get(componentKey(row.file, kind)) || []) {
        const descriptor = fragmentDescriptor(fragment), missing = descriptor.range_status === "partial" ? "Bytes outside this declared range are intentionally absent from this slice and are covered by ordered companion slices." : "This verified range is the complete component.";
        material.push(`=== VERIFIED ${descriptor.range_status.toUpperCase()} FRAGMENT ===\nThis block is an intentional verified half-open byte range of a larger frozen source or diff component.\nPath: ${descriptor.path}\nComponent kind: ${descriptor.component_kind}\nComponent byte length: ${descriptor.component_byte_length}\nComponent SHA-256: ${descriptor.component_sha256}\nVerified half-open byte range: [${descriptor.byte_start}, ${descriptor.byte_end})\nFragment SHA-256: ${descriptor.fragment_sha256}\n${missing}\n=== FRAGMENT BYTES ===\n${fragment.bytes.toString("utf8")}`);
      }
    }
  } else {
    for (const row of rows) material.push(`=== ${row.status === "D" ? "DELETED OLD" : "CURRENT"} FILE ${row.file} ===\n${blob(repo, row.status === "D" ? o.base : o.candidate, row.file)}`);
    material.push(`=== DIFF ${o.base}..${o.candidate} ===\n${git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--unified=80", o.base, o.candidate, "--", ...files])}`);
  }
  const materialId = sha(JSON.stringify({ tuple: [o.base, o.candidate, o.tree], slice: name, material }));
  const markers = ["HEAD", "MIDDLE", "EOF"].map(position => `PIL-INGEST-${position}-${sha(`${materialId}|${position}`).slice(0, 24)}`);
  const done = `PIL-DONE-${sha(`${materialId}|DONE`).slice(0, 24)}`;
  const scopePayload = { slice: name, gate_kind: "base..candidate_change", base: o.base, candidate: o.candidate, tree: o.tree, files, contract_context: [...contexts].sort(lexical), invariants: INVARIANTS, material_sha256: materialId };
  if (fragments) Object.assign(scopePayload, { slice_kind: sliceKind, material_mode: fragments.every(fragment => fragment.byte_start === 0 && fragment.byte_end === fragment.component_byte_length) ? "whole_components" : "verified_fragments", exact_per_file_diff_transition_evidence: fragments.some(fragment => fragment.component_kind === "per_file_diff" && fragment.bytes.length > 0), fragments: fragments.map(fragmentDescriptor) });
  const scope = JSON.stringify(scopePayload);
  const middle = Math.ceil(material.length / 2), supplied = [`=== INGESTION MARKER 1 OF 3 ===\n${markers[0]}`, ...material.slice(0, middle), `=== INGESTION MARKER 2 OF 3 ===\n${markers[1]}`, ...material.slice(middle), `=== NORMALIZED INSPECTED SCOPE ===\n${scope}`, `=== RESPONSE COMPLETION TOKEN ===\n${done}`, "=== END OF SUPPLIED MATERIAL ===", `=== EOF-ONLY INGESTION RECEIPT 3 OF 3 ===\n${markers[2]}`].join("\n\n");
  if (CREDENTIAL_LIKE.test(supplied)) die("possible credential-like value in final supplied review material", 3);
  const attributionInstruction = " This is a base..candidate change gate, not a general code-quality audit. A valid NO-GO requires concrete reachable harm introduced or worsened by changed diff evidence, newly exposed or relied upon by the candidate, or a false mitigation or public claim made by the candidate. An unchanged inherited limitation may be reported as PREEXISTING/NONBLOCKING but cannot alone produce NO-GO. Age alone never excuses a harm that the candidate exposes, worsens, relies upon, or falsely claims to fix.";
  const fragmentInstruction = fragments ? ` This unit is one complete approved fragment slice. Every VERIFIED FRAGMENT block declares an intentional, hash-verified half-open byte range of a larger frozen source or diff component. Missing bytes outside declared ranges are expected and covered by other ordered slices. Do not issue NO-GO solely because a range boundary cuts a file, line, word, or diff hunk. Still report substantive findings and apply the change-attribution rule. ${scopePayload.exact_per_file_diff_transition_evidence ? "This scope includes exact per_file_diff transition evidence." : "This source-only scope has no exact per_file_diff transition evidence and cannot by itself establish change attribution; later diff or final slices may still produce a valid NO-GO."}` : "";
  const prompt = `Review this exact frozen committed artifact using only supplied material.${attributionInstruction}${fragmentInstruction} Return findings, exactly one \`VERDICT: GO\` or \`VERDICT: NO-GO\` line, exactly one \`INSPECTED SCOPE:\` line copied exactly from supplied material, and exactly one \`INGESTION PROOF:\` line that contains the three supplied ingestion markers in encountered order, separated by \` | \`. End the reply with the supplied response-completion token as its final nonblank line.`;
  const request = { contents: [{ role: "user", parts: [{ text: `${prompt}\n\n${supplied}` }] }], generationConfig: { candidateCount: 1 } }, serialized = JSON.stringify(request);
  return { request, prompt: `${prompt}\n\n${supplied}`, bytes: Buffer.byteLength(serialized), materialId, envelopeSha: sha(serialized), markers, done, scope, name, exactPerFileDiffTransitionEvidence: scopePayload.exact_per_file_diff_transition_evidence };
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
  return { reply, verdict: verdicts[0], replySha: sha(reply), completionSha: sha(e.done), unresolvedAttribution: verdicts[0] === "NO-GO" && e.exactPerFileDiffTransitionEvidence === false };
}
function rawFragment(o, item, byte_start, byte_end) {
  const bytes = item.bytes.subarray(byte_start, byte_end);
  return { base_commit: o.base, candidate_commit: o.candidate, candidate_tree: o.tree, path: item.path, component_kind: item.kind, component_byte_length: item.bytes.length, component_sha256: sha(item.bytes), byte_start, byte_end, fragment_sha256: sha(bytes) };
}
function sortFragments(items) { return [...items].sort((a, b) => lexical(fragmentKey(a), fragmentKey(b))); }
function diffAtoms(bytes) {
  const hunkStarts = [];
  for (let start = 0; start < bytes.length;) {
    const newline = bytes.indexOf(0x0a, start), end = newline === -1 ? bytes.length : newline + 1;
    if (bytes.subarray(start, Math.min(end, start + 3)).toString("utf8") === "@@ ") hunkStarts.push(start);
    start = end;
  }
  if (!hunkStarts.length) return [[0, bytes.length]];
  return [[0, hunkStarts[0]], ...hunkStarts.map((start, index) => [start, index + 1 < hunkStarts.length ? hunkStarts[index + 1] : bytes.length])].filter(([start, end]) => start !== end);
}
function utf8Offsets(bytes, start, end) {
  const offsets = [];
  for (let index = start + 1; index <= end; index++) if (index === end || (bytes[index] & 0xc0) !== 0x80) offsets.push(index);
  return offsets;
}
function generatedManifestPath(repo, rel) {
  const output = path.resolve(repo, rel), inside = path.relative(repo, output);
  if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`) || !inside.split(path.sep).join("/").startsWith(".gemini-gate/")) die("generated slice manifest escapes .gemini-gate", 3);
  for (let current = repo, next; current !== path.dirname(output); current = next) {
    next = path.join(current, path.relative(current, path.dirname(output)).split(path.sep)[0]);
    const stat = fs.lstatSync(next, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) die("generated slice manifest parent must not be a symlink", 3);
    if (!stat) fs.mkdirSync(next);
  }
  const existing = fs.lstatSync(output, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) die("generated slice manifest must be a regular non-symlink file", 3);
  return output;
}
function generateSlicePlan(repo, o, rows) {
  const components = rows.flatMap(row => {
    const sourceKind = row.status === "D" ? "deleted_source" : "frozen_source";
    return [component(repo, o, row, sourceKind), component(repo, o, row, "per_file_diff")];
  });
  const coverage = [], forced_splits = [];
  let pending = [];
  const coverageName = () => `coverage-${String(coverage.length + 1).padStart(3, "0")}`;
  const measure = fragments => {
    const files = new Set(fragments.map(fragment => fragment.path)), unitRows = rows.filter(row => files.has(row.file));
    return envelope(repo, o, unitRows, [o.context], coverageName(), sortFragments(fragments), false, new Set(), "coverage");
  };
  const fits = fragments => measure(fragments).bytes < LIMIT;
  const finish = () => {
    if (!pending.length) return;
    const fragments = sortFragments(pending), e = measure(fragments), files = [...new Set(fragments.map(fragment => fragment.path))].sort(lexical);
    coverage.push({ name: coverageName(), kind: "coverage", files, contract_context: [o.context], fragments, _bytes: e.bytes });
    pending = [];
  };
  const splitOversizeAtom = (item, start, end) => {
    let offset = start;
    while (offset < end) {
      const newlineEnds = [];
      for (let index = offset; index < end; index++) if (item.bytes[index] === 0x0a) newlineEnds.push(index + 1);
      const choose = values => {
        let low = 0, high = values.length - 1, picked = -1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2), fragment = rawFragment(o, item, offset, values[middle]);
          if (fits([fragment])) { picked = middle; low = middle + 1; } else high = middle - 1;
        }
        return picked === -1 ? null : values[picked];
      };
      let next = choose(newlineEnds), forced = false;
      if (next === null) { next = choose(utf8Offsets(item.bytes, offset, end)); forced = true; }
      if (next === null || next <= offset) die(`cannot fit even one UTF-8-safe byte of ${item.path}/${item.kind} below ${LIMIT}`, 3);
      const fragment = rawFragment(o, item, offset, next);
      if (forced) forced_splits.push({ path: item.path, component_kind: item.kind, byte_start: offset, byte_end: next, reason: "single_oversized_line_utf8_boundary" });
      pending.push(fragment);
      if (next < end) finish();
      offset = next;
    }
  };
  for (const item of components) {
    const atoms = item.kind === "per_file_diff" ? diffAtoms(item.bytes) : [[0, item.bytes.length]];
    for (const [start, end] of atoms) {
      const fragment = rawFragment(o, item, start, end);
      if (fits([...pending, fragment])) { pending.push(fragment); continue; }
      finish();
      if (fits([fragment])) { pending.push(fragment); continue; }
      splitOversizeAtom(item, start, end);
    }
  }
  finish();
  const summary = coverage.map(slice => ({ name: slice.name, envelope_bytes: slice._bytes, material_bytes: slice.fragments.reduce((sum, fragment) => sum + fragment.byte_end - fragment.byte_start, 0) }));
  const slices = coverage.map(({ _bytes, ...slice }) => slice);
  const plan = {
    version: 2,
    approval: { status: "DRAFT", by: "PM_REQUIRED", expected_plan_id: "" },
    scope: { base_commit: o.base, candidate_commit: o.candidate, candidate_tree: o.tree, files: rows.map(row => row.file) },
    uncovered: [],
    generation: { method: "native-mechanical-v1", coverage_call_count: slices.length, coverage_envelope_bytes: summary, forced_splits },
    slices: [...slices, { name: "cross-boundary-DRAFT", kind: "cross_boundary", files: [], contract_context: [o.context], fragments: [], boundaries: {}, draft: { state: "NEEDS_HUMAN_CROSS_BOUNDARY", required: ["select cross-boundary fragments", ...BOUNDARIES.map(name => `write ${name} status, evidence, and rationale`)] } }],
  };
  return { plan, summary };
}
function writeGeneratedPlan(repo, o, generated) {
  const output = generatedManifestPath(repo, o.generateSlicePlan), text = `${JSON.stringify(generated.plan, null, 2)}\n`;
  if (fs.existsSync(output)) {
    if (fs.readFileSync(output, "utf8") !== text) die("generated slice manifest already exists with different bytes; choose a new .gemini-gate path", 3);
  } else fs.writeFileSync(output, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { manifest: o.generateSlicePlan, coverage_call_count: generated.summary.length, coverage_bytes: generated.summary.reduce((sum, entry) => sum + entry.envelope_bytes, 0), envelopes: generated.summary, forced_splits: generated.plan.generation.forced_splits, next: "Inspect the DRAFT, select cross-boundary fragments and all five semantic rationales, remove its draft marker, fingerprint, approve the exact plan ID, then run." };
}
function clean(value) { return String(value ?? "").replace(/[\r\n`]/g, " "); }
function recordFields(record) {
  const fields = [["Status", record.status], ["Record-Kind", record.kind], ["Release-Gate", record.release], ["Transport", record.transport], ["Transport-Identity", record.transportIdentity], ["Model", record.model], ["Handoff-ID", record.handoffId || "(none)"], ["Attempt-ID", record.attemptId], ["Rig-ID", record.rigId], ["Rig-Key", record.rigKey], ["Failure-Class", record.failureClass || "(none)"], ["Base", record.base], ["Candidate", record.candidate], ["Tree", record.tree], ["Plan-ID", record.planId || "(none)"], ["Slice", record.slice], ["Material-SHA256", record.materialId || "(aggregate)"], ["Envelope-SHA256", record.envelopeSha], ["Envelope-Bytes", record.bytes], ["Ordered-Contributors", (record.contributors || []).join(",") || "(none)"]];
  if (record.verdict) fields.push(["Gate-Verdict", record.verdict]);
  if (record.providerVerdict) fields.push(["Provider-Verdict", record.providerVerdict]);
  if (record.scope && (record.verdict || record.providerVerdict)) fields.push(["Inspected-Scope", record.scope]);
  if (typeof record.reply === "string") fields.push(["Reply-SHA256", record.replySha], ["Completion-Token-SHA256", record.completionSha], ["Reply-UTF8-Base64", Buffer.from(record.reply, "utf8").toString("base64")]);
  else if (record.resultSha) fields.push(["Aggregate-Result-SHA256", record.resultSha], ["Aggregate-Result", record.aggregateResult || "assembled verified slice results; no model reply"]);
  if (record.unresolvedAttempts?.length) fields.push(["Unresolved-Attribution-Attempts", record.unresolvedAttempts.join(",")]);
  if (record.detail) fields.push(["Diagnostic", record.detail]);
  return fields;
}
function canonicalRecordFields(record) { return recordFields(record).map(([key, value]) => [key, clean(value)]); }
function recordBody(record) {
  return `\n## Gemini frozen gate attempt — ${clean(record.status)} — ${new Date().toISOString()}\n\n${canonicalRecordFields(record).map(([key, value]) => `- ${key}: \`${value}\``).join("\n")}\n`;
}
function append(repo, record) {
  const body = recordBody(record), complete = `${body}- Record-SHA256: \`${sha(body)}\`\n- Complete-Record: \`YES\`\n`, fd = fs.openSync(journalPath(repo), "a");
  try { if (fs.writeSync(fd, complete) !== Buffer.byteLength(complete)) die("journal receipt write was partial", 3); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
function rigKey(o, transport) { return sha(`${transport.name}|${transport.identity}|${o.model}|${o.rigId}`); }
function plainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function onlyKeys(value, keys) { return Object.keys(value).every(key => keys.has(key)); }
function toolLikeKey(key) { return /(?:tool|subagent|function|command|action|output)/i.test(key); }
function nonnegativeNumber(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function boundedCapture(limit) {
  const chunks = []; let bytes = 0, overflow = false;
  return { append(chunk) { if (overflow) return true; bytes += chunk.length; if (bytes > limit) { overflow = true; return true; } chunks.push(Buffer.from(chunk)); return false; }, get overflow() { return overflow; }, text() { return Buffer.concat(chunks).toString("utf8"); } };
}
function subscriptionEnv() {
  const allowed = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG"]), env = {};
  for (const [key, value] of Object.entries(process.env)) if ((allowed.has(key) || key.startsWith("LC_")) && typeof value === "string") env[key] = value;
  return env;
}
export function preflightSubscriptionSettings(settingsPath = process.env.GEMINI_AGY_SETTINGS || path.join(os.homedir(), ".gemini", "antigravity-cli", "settings.json")) {
  let bytes; try { bytes = fs.readFileSync(settingsPath); } catch (error) { die(`cannot read agy settings: ${error.message}`, 3); }
  let settings; try { settings = JSON.parse(bytes); } catch { die("agy settings are malformed JSON", 3); }
  if (!plainObject(settings) || settings.toolPermission !== "request-review") die("agy settings must require request-review", 3);
  if (settings.allowNonWorkspaceAccess !== undefined && settings.allowNonWorkspaceAccess !== false) die("agy settings must not allow non-workspace access", 3);
  if (settings.permissions !== undefined && (!plainObject(settings.permissions) || (settings.permissions.allow !== undefined && (!Array.isArray(settings.permissions.allow) || settings.permissions.allow.length)))) die("agy settings must not contain a permission allow-list", 3);
  return { identity: `settings-sha256:${sha(bytes)}` };
}
function resolveSubscriptionTransport(o) {
  const fromPath = () => (process.env.PATH || "").split(path.delimiter).filter(Boolean).map(directory => path.join(directory, "agy")).find(candidate => {
    const stat = fs.statSync(candidate, { throwIfNoEntry: false }); return Boolean(stat?.isFile() && (stat.mode & 0o111));
  });
  const requested = o.agyBin || fromPath(), stat = requested && fs.statSync(requested, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || !(stat.mode & 0o111)) die(`agy binary is not a regular executable: ${requested || "agy"}`, 127);
  const binary = fs.realpathSync(requested); let version;
  try { version = String(execFileSync(binary, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000, env: subscriptionEnv() })).trim(); }
  catch (error) { die(`agy --version failed: ${String(error.stderr || error.message).trim()}`, 3); }
  if (!/^1\.2\.2(?:\s|$)/.test(version)) die(`unsupported agy version: ${version}`, 3);
  const settings = preflightSubscriptionSettings();
  return { name: "antigravity-agy-subscription-stream-v2", identity: `${version}|${settings.identity}|${SUBSCRIPTION_EFFORT}`, binary };
}
function parseSubscriptionStream(stdout, workspace, o, e) {
  const lines = stdout.split(/\r?\n/); if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.some(line => !line)) die("agy stream-json output is empty or contains a blank event", 3);
  let initCount = 0, resultCount = 0, result, conversation, lastIndex = -1; const stepStates = new Map();
  for (const [index, line] of lines.entries()) {
    let event; try { event = JSON.parse(line); } catch { die("agy stream-json output contains malformed JSON", 3); }
    if (!plainObject(event) || typeof event.event !== "string" || Object.keys(event).some(toolLikeKey)) die("agy stream-json output contains an unrecognized or execution-like event", 3);
    if (event.event === "init") {
      const init = event.init;
      if (index !== 0 || ++initCount !== 1 || !onlyKeys(event, new Set(["event", "conversation_id", "init"])) || typeof event.conversation_id !== "string" || !plainObject(init) || !onlyKeys(init, new Set(["cwd", "tools", "permission_mode", "model", "effort"])) || !Array.isArray(init.tools) || init.tools.some(tool => typeof tool !== "string") || init.permission_mode !== "request-review" || init.model !== o.model || (Object.hasOwn(init, "effort") && init.effort !== o.effort) || fs.realpathSync(init.cwd) !== workspace) die("agy init does not prove the required disposable request-review rig", 3);
      conversation = event.conversation_id; continue;
    }
    if (event.event === "step_update") {
      const step = event.step_update;
      const allowed = new Set(["conversation_id", "step_index", "state", "step_type", "text_delta", "duration_seconds", "usage"]), usageOk = !Object.hasOwn(step || {}, "usage") || (plainObject(step.usage) && Object.keys(step.usage).length <= 8 && Object.values(step.usage).every(nonnegativeNumber));
      if (!onlyKeys(event, new Set(["event", "step_update"])) || !plainObject(step) || !onlyKeys(step, allowed) || Object.keys(step).some(toolLikeKey) || !["user_input", "agent_response", "checkpoint"].includes(step.step_type) || !["ACTIVE", "DONE"].includes(step.state) || step.conversation_id !== conversation || !Number.isSafeInteger(step.step_index) || step.step_index < 0 || (Object.hasOwn(step, "text_delta") && typeof step.text_delta !== "string") || (Object.hasOwn(step, "duration_seconds") && !nonnegativeNumber(step.duration_seconds)) || !usageOk) die("agy stream recorded a tool, subagent, denied action, or unrecognized step", 3);
      const prior = stepStates.get(step.step_index);
      if (step.step_index < lastIndex || step.step_index > lastIndex + 1 || (prior && (prior.type !== step.step_type || prior.state !== "ACTIVE" || !["ACTIVE", "DONE"].includes(step.state))) || (!prior && step.step_index === lastIndex && step.state !== "DONE")) die("agy stream has an invalid step lifecycle", 3);
      stepStates.set(step.step_index, { state: step.state, type: step.step_type }); if (step.step_index > lastIndex) lastIndex = step.step_index;
      continue;
    }
    if (event.event === "result") {
      const terminal = event.result;
      if (index !== lines.length - 1 || ++resultCount !== 1 || !onlyKeys(event, new Set(["event", "result"])) || !plainObject(terminal) || !onlyKeys(terminal, new Set(["conversation_id", "status", "response", "duration_seconds", "num_turns", "usage", "error", "denied_actions"])) || terminal.conversation_id !== conversation || terminal.status !== "SUCCESS" || typeof terminal.response !== "string" || !terminal.response.trim() || Object.hasOwn(terminal, "error") || Object.hasOwn(terminal, "denied_actions") || !nonnegativeNumber(terminal.duration_seconds) || !Number.isSafeInteger(terminal.num_turns) || terminal.num_turns < 0) die("agy subscription response is not one clean successful result", 3);
      result = terminal; continue;
    }
    die("agy stream-json output contains an unrecognized event", 3);
  }
  if (initCount !== 1 || resultCount !== 1 || !result) die("agy stream lacks one complete init/result sequence", 3);
  return verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: result.response }] } }] }, e);
}
async function callSubscription(o, transport, e, lock) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gemini-subscription-"))), capture = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-subscription-capture-")), stdoutPath = path.join(capture, "stdout"), stderrPath = path.join(capture, "stderr"), pidPath = path.join(capture, "agy.pid"), metaPath = path.join(capture, "parent-loss.meta"), heartbeatPath = path.join(capture, "parent-heartbeat");
  try {
    if (fs.readdirSync(workspace).length) die("subscription workspace is not empty", 3);
    fs.writeFileSync(metaPath, `attempt_id=${random("PIL-FROZEN-ATTEMPT")}\nrecord_kind=FULL_REVIEW\ndo_log=1\n`, { mode: 0o600 }); fs.writeFileSync(heartbeatPath, "alive\n", { mode: 0o600 });
    const heartbeat = setInterval(() => { try { fs.utimesSync(heartbeatPath, new Date(), new Date()); } catch {} }, 250);
    const supervisor = path.join(path.dirname(fileURLToPath(import.meta.url)), "gemini-gate-supervisor.mjs"), args = [supervisor, "--timeout-seconds", String(o.timeoutSeconds), "--grace-seconds", "2", "--stdin", "forward", "--cwd", workspace, "--stdout", stdoutPath, "--stderr", stderrPath, "--stdout-limit", String(SUBSCRIPTION_STDOUT_LIMIT), "--stderr-limit", String(SUBSCRIPTION_STDERR_LIMIT), "--capture-dir", capture, "--pid-file", pidPath, "--parent-pid", String(process.pid), "--parent-heartbeat", heartbeatPath, "--temp-dir", workspace, "--lock-dir", lock, "--attempt-log", journalPath(o.repo), "--parent-loss-meta", metaPath, "--", transport.binary, "--model", o.model, "--effort", o.effort, "--sandbox", "--disable-slash-commands", "--input-format", "stream-json", "--output-format", "stream-json", "--print-timeout", `${o.timeoutSeconds}s`];
    const child = spawn(process.execPath, args, { stdio: ["pipe", "ignore", "ignore"], shell: false, detached: true, env: subscriptionEnv() });
    const outcome = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); child.stdin.once("error", reject); child.stdin.end(`${JSON.stringify({ event: "user", message: { content: e.prompt } })}\n`); }).finally(() => clearInterval(heartbeat));
    const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath) : Buffer.alloc(0), stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath) : Buffer.alloc(0);
    if (stdout.length > SUBSCRIPTION_STDOUT_LIMIT || stderr.length > SUBSCRIPTION_STDERR_LIMIT) die("agy subscription transport exceeded its bounded output limit", 3);
    if (outcome.signal || outcome.code !== 0) die(`agy subscription transport exited ${outcome.signal || outcome.code}: ${stderr.toString("utf8").trim() || "no supervisor diagnostic"}`, 3);
    if (stderr.toString("utf8").trim()) die("agy subscription transport emitted stderr diagnostics or a permission notice", 3);
    if (fs.readdirSync(workspace).length) die("agy subscription transport mutated its disposable workspace", 3);
    return parseSubscriptionStream(stdout.toString("utf8"), workspace, o, e);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); fs.rmSync(capture, { recursive: true, force: true }); }
}
function handoffDirectory(repo, rel, create = false) {
  rel = relative(rel, "handoff directory"); if (!rel.startsWith(".gemini-gate/")) die("handoff directory must be inside .gemini-gate", 3);
  const parts = rel.split("/"), target = path.resolve(repo, rel); let current = repo;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part); const stat = fs.lstatSync(current, { throwIfNoEntry: false }), leaf = index === parts.length - 1;
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) die("handoff path must contain only real directories", 3);
    if (!stat) { if (!create) die("handoff directory does not exist", 3); fs.mkdirSync(current, { mode: 0o700 }); }
    if (leaf && stat && create) die("handoff export directory already exists", 3);
  }
  if (path.relative(repo, target).startsWith("..")) die("handoff directory escapes repository", 3);
  return target;
}
function handoffChild(root, name, directory = false) {
  const file = path.join(root, name), stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) die(`handoff ${name} must be a regular non-symlink ${directory ? "directory" : "file"}`, 3);
  return file;
}
function packetName(index) { return `${String(index + 1).padStart(4, "0")}.txt`; }
function packetIdentity(item, index) {
  return { ordinal: index + 1, filename: packetName(index), slice: item.name, kind: item.kind, prompt_bytes: Buffer.byteLength(item.prompt), prompt_sha256: sha(item.prompt), material_sha256: item.materialId, envelope_sha256: item.envelopeSha, inspected_scope_sha256: sha(item.scope), ingestion_markers: item.markers, completion_marker: item.done };
}
function writeHandoff(repo, o, plan, prepared) {
  const root = handoffDirectory(repo, o.handoffExport, true), packets = path.join(root, "packets"), replies = path.join(root, "replies");
  fs.mkdirSync(packets, { mode: 0o700 }); fs.mkdirSync(replies, { mode: 0o700 });
  const identities = prepared.map(packetIdentity), handoff = { version: 1, handoff_id: random("PIL-GEMINI-HANDOFF"), tuple: { base: o.base, candidate: o.candidate, tree: o.tree }, plan_id: plan.planId, rig_id: o.rigId, manual_transport: { identity: MANUAL_TRANSPORT, model: SUBSCRIPTION_MODEL, attestation: "operator selects this subscription model in the manual UI; runner cannot cryptographically verify UI/provider identity" }, packets: identities };
  for (const [index, item] of prepared.entries()) fs.writeFileSync(path.join(packets, packetName(index)), item.prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(root, "handoff.json"), `${JSON.stringify(handoff, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify({ handoff: o.handoffExport, handoff_id: handoff.handoff_id, packets: identities, next: "Submit packets manually with the attested Gemini subscription model, save exact UTF-8 replies as replies/0001.txt..., then run --handoff-import." }, null, 2) + "\n");
}
function equalObject(actual, expected) { return plainObject(actual) && Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value)); }
function readHandoff(repo, o, plan, prepared) {
  const root = handoffDirectory(repo, o.handoffImport), rootEntries = fs.readdirSync(root).sort(lexical);
  if (rootEntries.join("\0") !== ["handoff.json", "packets", "replies"].join("\0")) die("handoff directory must contain exactly handoff.json, packets, and replies", 3);
  const json = handoffChild(root, "handoff.json"); let handoff;
  try { handoff = JSON.parse(fs.readFileSync(json, "utf8")); } catch { die("handoff.json must be valid UTF-8 JSON", 3); }
  const expectedPackets = prepared.map(packetIdentity), expectedTransport = { identity: MANUAL_TRANSPORT, model: SUBSCRIPTION_MODEL, attestation: "operator selects this subscription model in the manual UI; runner cannot cryptographically verify UI/provider identity" };
  const handoffKeys = ["version", "handoff_id", "tuple", "plan_id", "rig_id", "manual_transport", "packets"];
  if (!plainObject(handoff) || Object.keys(handoff).length !== handoffKeys.length || handoffKeys.some(key => !(key in handoff)) || handoff.version !== 1 || !/^PIL-GEMINI-HANDOFF-[0-9a-f]{24}$/.test(handoff.handoff_id || "") || !equalObject(handoff.tuple, { base: o.base, candidate: o.candidate, tree: o.tree }) || handoff.plan_id !== plan.planId || handoff.rig_id !== o.rigId || !equalObject(handoff.manual_transport, expectedTransport) || !Array.isArray(handoff.packets) || handoff.packets.length !== expectedPackets.length || handoff.packets.some((packet, index) => !equalObject(packet, expectedPackets[index]))) die("handoff.json does not exactly bind this frozen tuple, plan, rig, manual model, and packets", 3);
  const packets = handoffChild(root, "packets", true), packetFiles = fs.readdirSync(packets).sort(lexical);
  if (packetFiles.join("\0") !== expectedPackets.map(packet => packet.filename).join("\0")) die("handoff packets must be exactly ordered numeric files", 3);
  for (const [index, item] of prepared.entries()) {
    const file = handoffChild(packets, packetName(index)); let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file)); } catch { die("handoff packet is not UTF-8", 3); }
    if (text !== item.prompt) die("handoff packet bytes do not match the recomputed frozen prompt", 3);
  }
  const replies = handoffChild(root, "replies", true), files = fs.readdirSync(replies).sort(lexical);
  if (files.some(file => !/^\d{4}\.txt$/.test(file))) die("handoff replies may contain numeric .txt files only", 3);
  const replyIndexes = files.map(file => Number(file.slice(0, 4)) - 1);
  if (replyIndexes.some((index, position) => index !== position || index >= prepared.length)) die("handoff replies contain a gap, duplicate, or extra ordinal", 3);
  const repliesText = files.map(file => { const value = handoffChild(replies, file); try { return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(value)); } catch { die("handoff reply is not UTF-8", 3); } });
  const results = repliesText.map((reply, index) => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: reply }] } }] }, prepared[index]));
  const terminals = results.map((result, index) => result.verdict === "NO-GO" && !result.unresolvedAttribution ? index : -1).filter(index => index >= 0);
  if (terminals.length > 1 || (terminals.length && terminals[0] !== results.length - 1)) die("a verified terminal NO-GO must be the final supplied reply", 3);
  if (!terminals.length && results.length !== prepared.length) die("strict manual import requires every ordered reply unless its final supplied reply is a verified terminal NO-GO", 3);
  return { handoff, results };
}
function completeHandoffRecord(block) { return complete(block.replace(/\n$/, "")); }
function receiptFields(block) {
  return [...block.matchAll(/^- ([^:\n]+): `([^\n`]*)`$/gm)].filter(([, key]) => key !== "Record-SHA256" && key !== "Complete-Record").map(([, key, value]) => [key, value]);
}
function durableHandoffPrefix(repo, handoffId) {
  let text = ""; try { text = fs.readFileSync(journalPath(repo), "utf8"); } catch { return []; }
  const marker = `- Handoff-ID: \`${handoffId}\``;
  const blocks = text.split(/(?=^## Gemini frozen gate attempt — )/m);
  for (const block of blocks) if (block.startsWith("## Gemini frozen gate attempt — ") && !completeHandoffRecord(block)) die("journal has an incomplete receipt; refusing unsafe replay", 3);
  return blocks.filter(block => block.includes(marker)).map(block => {
    if (!completeHandoffRecord(block)) die("Handoff-ID has an incomplete durable receipt; refusing unsafe replay", 3);
    return receiptFields(block);
  });
}
function manualTransport() { return { name: MANUAL_TRANSPORT, identity: `${MANUAL_TRANSPORT}|${SUBSCRIPTION_MODEL}` }; }
function importedReceiptSet(o, plan, prepared, imported) {
  const transport = manualTransport(), key = rigKey(o, transport), contributors = [], results = [], unresolved = [];
  const records = [];
  for (const [index, result] of imported.results.entries()) {
    const item = prepared[index], attemptId = `PIL-MANUAL-${imported.handoff.handoff_id.slice(-24)}-${String(index + 1).padStart(4, "0")}`;
    const common = { transport: transport.name, transportIdentity: transport.identity, model: o.model, handoffId: imported.handoff.handoff_id, attemptId, rigId: o.rigId, rigKey: key, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan.planId, slice: item.name, materialId: item.materialId, envelopeSha: item.envelopeSha, bytes: item.bytes };
    if (result.unresolvedAttribution) {
      const observation = { attempt_id: attemptId, slice: item.name, provider_verdict: result.verdict, material_sha256: item.materialId, reply_sha256: result.replySha, inspected_scope_sha256: sha(item.scope) };
      records.push({ ...common, status: "UNRESOLVED_ATTRIBUTION", kind: "SLICE_RESULT", release: "NO", providerVerdict: result.verdict, scope: item.scope, replySha: result.replySha, completionSha: result.completionSha, reply: result.reply }); contributors.push(attemptId); results.push({ status: "UNRESOLVED_ATTRIBUTION", ...observation }); unresolved.push(observation); continue;
    }
    records.push({ ...common, status: result.verdict === "GO" ? "PASS_VERDICT" : "NO_GO", kind: "SLICE_RESULT", release: "NO", verdict: result.verdict, scope: item.scope, replySha: result.replySha, completionSha: result.completionSha, reply: result.reply });
    contributors.push(attemptId); results.push({ attempt_id: attemptId, slice: item.name, verdict: result.verdict, material_sha256: item.materialId, reply_sha256: result.replySha, inspected_scope_sha256: sha(item.scope) });
    if (result.verdict === "NO-GO") return { records, exitCode: 3 };
  }
  const materialId = sha(JSON.stringify({ plan_id: plan.planId, contributors: results, unresolved_attribution: unresolved })), scope = JSON.stringify({ slice: "aggregate", base: o.base, candidate: o.candidate, tree: o.tree, plan_id: plan.planId, material_sha256: materialId, contributors: results, unresolved_attribution: unresolved }), resultSha = sha(JSON.stringify({ status: unresolved.length ? "ATTRIBUTION_HOLD" : "GO", scope }));
  records.push({ status: unresolved.length ? "ATTRIBUTION_HOLD" : "PASS_VERDICT", kind: "SLICE_SET", release: unresolved.length ? "NO" : "YES", transport: transport.name, transportIdentity: transport.identity, model: o.model, handoffId: imported.handoff.handoff_id, attemptId: `PIL-MANUAL-AGGREGATE-${imported.handoff.handoff_id.slice(-24)}`, rigId: o.rigId, rigKey: key, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan.planId, slice: "aggregate", materialId, envelopeSha: sha(prepared.map(item => item.envelopeSha).join("")), bytes: prepared.reduce((sum, item) => sum + item.bytes, 0), contributors, verdict: unresolved.length ? undefined : "GO", scope: unresolved.length ? undefined : scope, resultSha, aggregateResult: unresolved.length ? "assembled verified manual replies; unresolved source-only attribution requires PM adjudication" : undefined, unresolvedAttempts: unresolved.map(item => item.attempt_id) });
  return { records, exitCode: unresolved.length ? 3 : 0 };
}
function writeImportedReceipts(repo, o, plan, prepared, imported, afterSliceReceipts) {
  const expected = importedReceiptSet(o, plan, prepared, imported), prefix = durableHandoffPrefix(repo, imported.handoff.handoff_id);
  if (prefix.length > expected.records.length) die("Handoff-ID has extra durable receipts; refusing unsafe replay", 3);
  for (const [index, actual] of prefix.entries()) if (JSON.stringify(actual) !== JSON.stringify(canonicalRecordFields(expected.records[index]))) die("Handoff-ID durable prefix is mismatched or out of order; refusing unsafe replay", 3);
  if (prefix.length === expected.records.length) die("Handoff-ID already has a complete durable receipt", 3);
  const remaining = expected.records.slice(prefix.length), aggregate = remaining.at(-1)?.kind === "SLICE_SET" ? remaining.pop() : undefined;
  endpoint(repo, o); preflightJournal(repo); endpoint(repo, o);
  for (const record of remaining) append(repo, record);
  if (aggregate) { afterSliceReceipts?.(); endpoint(repo, o); append(repo, aggregate); }
  if (expected.exitCode) process.exitCode = expected.exitCode;
}
async function writeAutomatedReceipts(repo, o, plan, prepared, hooks, lock) {
  const transport = resolveSubscriptionTransport(o), key = rigKey(o, transport), contributors = [], results = [], unresolved = [];
  for (const item of prepared) {
    const attemptId = random("PIL-FROZEN-ATTEMPT");
    try {
      endpoint(repo, o);
      const result = await callSubscription(o, transport, item, lock);
      hooks.afterProviderResponse?.(item);
      endpoint(repo, o);
      const common = { transport: transport.name, transportIdentity: transport.identity, model: o.model, attemptId, rigId: o.rigId, rigKey: key, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan?.planId, slice: item.name, materialId: item.materialId, envelopeSha: item.envelopeSha, bytes: item.bytes };
      if (result.unresolvedAttribution) {
        const observation = { attempt_id: attemptId, slice: item.name, provider_verdict: result.verdict, material_sha256: item.materialId, reply_sha256: result.replySha, inspected_scope_sha256: sha(item.scope) };
        append(repo, { ...common, status: "UNRESOLVED_ATTRIBUTION", kind: "SLICE_RESULT", release: "NO", providerVerdict: result.verdict, scope: item.scope, replySha: result.replySha, completionSha: result.completionSha, reply: result.reply });
        contributors.push(attemptId); results.push({ status: "UNRESOLVED_ATTRIBUTION", ...observation }); unresolved.push(observation); process.stdout.write(`${result.reply}\n`); continue;
      }
      append(repo, { ...common, status: result.verdict === "GO" ? "PASS_VERDICT" : "NO_GO", kind: plan ? "SLICE_RESULT" : "FULL_REVIEW", release: result.verdict === "GO" && !plan ? "YES" : "NO", verdict: result.verdict, scope: item.scope, replySha: result.replySha, completionSha: result.completionSha, reply: result.reply });
      contributors.push(attemptId); results.push({ attempt_id: attemptId, slice: item.name, verdict: result.verdict, material_sha256: item.materialId, reply_sha256: result.replySha, inspected_scope_sha256: sha(item.scope) }); process.stdout.write(`${result.reply}\n`);
      if (result.verdict === "NO-GO") { process.exitCode = 3; return; }
    } catch (error) {
      let detail = String(error.message || error);
      try { endpoint(repo, o); } catch (postflight) { detail += `; post-flight endpoint: ${String(postflight.message || postflight)}`; }
      append(repo, { status: "FAILED_TRANSPORT", kind: plan ? "SLICE_RESULT" : "FULL_REVIEW", release: "NO", transport: transport.name, transportIdentity: transport.identity, model: o.model, attemptId, rigId: o.rigId, rigKey: key, failureClass: "TRANSPORT", base: o.base, candidate: o.candidate, tree: o.tree, planId: plan?.planId, slice: item.name, materialId: item.materialId, envelopeSha: item.envelopeSha, bytes: item.bytes, detail });
      throw error;
    }
  }
  if (!plan) return;
  endpoint(repo, o); hooks.beforeAggregate?.(); endpoint(repo, o);
  const materialId = sha(JSON.stringify({ plan_id: plan.planId, contributors: results, unresolved_attribution: unresolved })), scope = JSON.stringify({ slice: "aggregate", base: o.base, candidate: o.candidate, tree: o.tree, plan_id: plan.planId, material_sha256: materialId, contributors: results, unresolved_attribution: unresolved }), resultSha = sha(JSON.stringify({ status: unresolved.length ? "ATTRIBUTION_HOLD" : "GO", scope }));
  append(repo, { status: unresolved.length ? "ATTRIBUTION_HOLD" : "PASS_VERDICT", kind: "SLICE_SET", release: unresolved.length ? "NO" : "YES", transport: transport.name, transportIdentity: transport.identity, model: o.model, attemptId: random("PIL-FROZEN-AGGREGATE"), rigId: o.rigId, rigKey: key, base: o.base, candidate: o.candidate, tree: o.tree, planId: plan.planId, slice: "aggregate", materialId, envelopeSha: sha(prepared.map(item => item.envelopeSha).join("")), bytes: prepared.reduce((sum, item) => sum + item.bytes, 0), contributors, verdict: unresolved.length ? undefined : "GO", scope: unresolved.length ? undefined : scope, resultSha, aggregateResult: unresolved.length ? "assembled verified subscription replies; unresolved source-only attribution requires PM adjudication" : undefined, unresolvedAttempts: unresolved.map(item => item.attempt_id) });
  if (unresolved.length) process.exitCode = 3;
}
export async function run(argv = process.argv.slice(2), hooks = {}) {
  const o = parse(argv), repo = validate(o.repo, o), rows = changed(repo, o);
  if (o.generateSlicePlan) {
    const generated = generateSlicePlan(repo, o, rows);
    process.stdout.write(JSON.stringify(writeGeneratedPlan(repo, o, generated), null, 2) + "\n");
    return;
  }
  const plan = o.sliceManifest ? verifyManifest(repo, o, rows) : null;
  const coveredComponents = new Set();
  if (plan) for (const item of plan.slices.filter(slice => slice.kind === "coverage")) for (const row of rows.filter(row => item.files.includes(row.file))) {
    coveredComponents.add(componentKey(row.file, row.status === "D" ? "deleted_source" : "frozen_source")); coveredComponents.add(componentKey(row.file, "per_file_diff"));
  }
  const units = plan ? plan.slices.map(item => ({ name: item.name, kind: item.kind, rows: rows.filter(row => item.files.includes(row.file)), contexts: item.contract_context, fragments: item.fragments })) : [{ name: "full", kind: "full", rows, contexts: [o.context] }];
  if (plan) validateCoveragePartitions(repo, o, rows, units);
  const prepared = units.map(unit => ({ ...envelope(repo, o, unit.rows, unit.contexts, unit.name, unit.fragments, unit.kind === "cross_boundary", coveredComponents, unit.kind), kind: unit.kind }));
  for (const item of prepared) if (item.bytes >= LIMIT) die(`complete ${item.name} envelope is ${item.bytes} bytes; must be below ${LIMIT}`, 3);
  const identities = prepared.map(item => ({ slice: item.name, bytes: item.bytes, material_sha256: item.materialId, request_sha256: item.envelopeSha }));
  if (o.fingerprint) { process.stdout.write(JSON.stringify({ plan_id: plan.planId, envelopes: identities, next: "Set approval.status=APPROVED and approval.expected_plan_id to plan_id after PM review." }, null, 2) + "\n"); return; }
  if (o.dryRun) { process.stdout.write(JSON.stringify({ frozen: { base: o.base, candidate: o.candidate, tree: o.tree }, plan_id: plan?.planId || null, envelopes: identities }, null, 2) + "\n"); return; }
  if (o.handoffExport) { writeHandoff(repo, o, plan, prepared); return; }
  const lock = sharedLock(repo, o);
  try {
    if (o.handoffImport) writeImportedReceipts(repo, o, plan, prepared, readHandoff(repo, o, plan, prepared), hooks.afterSliceReceipts);
    else { preflightJournal(repo); endpoint(repo, o); await writeAutomatedReceipts(repo, o, plan, prepared, hooks, lock); }
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch(error => { process.stderr.write(`gemini-frozen-gate: ${error.message}\n`); process.exit(error.exitCode || 3); });
