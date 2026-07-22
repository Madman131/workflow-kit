#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

function fail(message) {
  process.stderr.write(`gemini-gate-slices: ${message}\n`);
  process.exit(2);
}

function git(repo, args, { throwOnError = false } = {}) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const message = `git ${args.join(" ")} failed: ${String(error.stderr || error.message).trim()}`;
    if (throwOnError) throw new Error(message);
    fail(message);
  }
}

function gitNoIndex(repo, absolutePath) {
  try {
    return execFileSync("git", ["-C", repo, "diff", "--no-index", "/dev/null", absolutePath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (error.status === 1) return String(error.stdout || "");
    fail(`git diff --no-index failed: ${String(error.stderr || error.message).trim()}`);
  }
}

function sortedUnique(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array`);
  for (const value of values) {
    if (typeof value !== "string" || !value || /[\n\r\t]/.test(value)) fail(`${label} contains an invalid path/value`);
  }
  return [...new Set(values)].sort();
}

function sameArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function relativeIfInside(repo, candidate) {
  const rel = path.relative(repo, path.resolve(candidate));
  return rel && !rel.startsWith(`..${path.sep}`) && rel !== ".." ? rel.split(path.sep).join("/") : null;
}

function repoContextPath(repo, context) {
  if (path.isAbsolute(context)) fail(`contract context must be repository-relative: ${context}`);
  let canonical;
  try {
    canonical = fs.realpathSync(path.join(repo, context));
  } catch (error) {
    fail(`cannot read contract context ${context}: ${error.message}`);
  }
  const relative = relativeIfInside(repo, canonical);
  if (!relative) fail(`contract context must resolve inside the frozen repository: ${context}`);
  if (relative === "docs/journal/gemini_review_log.md") fail(`the durable Gemini review log is never a slice contract context: ${context}`);
  return { canonical, relative };
}

function repoSourcePath(repo, file) {
  let canonical;
  try {
    canonical = fs.realpathSync(path.join(repo, file));
  } catch (error) {
    fail(`cannot read source file ${file}: ${error.message}`);
  }
  if (!relativeIfInside(repo, canonical)) fail(`source file must resolve inside the frozen repository: ${file}`);
  let stat;
  try {
    stat = fs.statSync(canonical);
  } catch (error) {
    fail(`cannot read source file ${file}: ${error.message}`);
  }
  if (!stat.isFile()) fail(`source file must resolve to a regular file inside the frozen repository: ${file}`);
  return canonical;
}

function fileEvidence(repo, baseCommit, file, untracked, cache) {
  if (cache.has(file)) return cache.get(file).evidence;
  if (untracked.has(file)) {
    // MODEL 1 cannot alter the frozen repo, but MODEL 2 can retarget its symbolic pathname after the
    // containment check. Use the same resolved canonical path for git evidence and bytes.
    const absolute = repoSourcePath(repo, file);
    const bytes = fs.readFileSync(absolute);
    const text = bytes.toString("utf8");
    const diff = gitNoIndex(repo, absolute);
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    const evidence = {
      file,
      diff_ranges: [{ kind: "untracked-full-file", range: lines ? `1-${lines}` : "empty" }],
      diff_sha256: crypto.createHash("sha256").update(diff).digest("hex"),
      full_file_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
    cache.set(file, { evidence, diff, bytes, exists: true });
    return evidence;
  }
  const diff = git(repo, ["diff", "--unified=0", baseCommit, "--", file]);
  const requested = path.join(repo, file);
  let entry;
  try {
    entry = fs.lstatSync(requested, { throwIfNoEntry: false });
  } catch (error) {
    fail(`cannot inspect source file ${file}: ${error.message}`);
  }
  const exists = entry !== undefined;
  const absolute = exists ? repoSourcePath(repo, file) : requested;
  const bytes = exists ? fs.readFileSync(absolute) : Buffer.alloc(0);
  const ranges = [];
  for (const line of diff.split("\n")) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    ranges.push({ kind: count === 0 ? "deletion-anchor" : "changed", range: count === 0 ? `${start}` : `${start}-${start + count - 1}` });
  }
  const evidence = {
    file,
    diff_ranges: ranges.length ? ranges : [{ kind: "metadata-only", range: "none" }],
    diff_sha256: crypto.createHash("sha256").update(diff).digest("hex"),
    full_file_sha256: exists ? crypto.createHash("sha256").update(bytes).digest("hex") : null,
  };
  cache.set(file, { evidence, diff, bytes, exists });
  return evidence;
}

function contextEvidence(repo, context, cache) {
  if (cache.has(context)) return cache.get(context).evidence;
  const { canonical, relative } = repoContextPath(repo, context);
  let bytes;
  try {
    bytes = fs.readFileSync(canonical);
  } catch (error) {
    fail(`cannot read contract context ${context}: ${error.message}`);
  }
  const evidence = { path: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  cache.set(context, { evidence, bytes });
  return evidence;
}

function field(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp("^- " + escaped + ": `([^`]*)`$", "m"))?.[1] ?? "";
}

function gcMain(repo, opts) {
  const ageDaysRaw = opts["age-days"] ?? "14";
  if (!/^\d+$/.test(ageDaysRaw)) fail("gc --age-days must be a whole number of days (zero is allowed)");
  const ageDays = Number(ageDaysRaw);
  if (!Number.isSafeInteger(ageDays)) fail("gc --age-days is outside the supported range");
  const prune = opts.prune === "1";
  const protectedShas = new Set(opts["protect-sha"] ? [opts["protect-sha"]] : []);
  const refs = git(repo, ["for-each-ref", "--format=%(objectname) %(refname)", "refs/pil/gate-artifacts/"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" ");
      return { sha: line.slice(0, separator), refname: line.slice(separator + 1) };
    })
    .filter(({ sha, refname }) => sha && refname);

  let log;
  try {
    log = fs.readFileSync(path.resolve(opts.log), "utf8");
  } catch (error) {
    process.stderr.write(`gc: cannot read durable log; protecting all refs: ${error.message}\n`);
    process.stdout.write(`gc: ${prune ? "reaped" : "would-reap"} 0 reapable, ${refs.length} protected, age-days=${ageDays}\n`);
    return;
  }

  const records = log.split(/(?=^## Gemini gate attempt — )/m).map((block) => {
    const headerTimestamp = block.match(/^## Gemini gate attempt — .+ — (.+)$/m)?.[1];
    const recordTime = headerTimestamp === undefined ? Number.NaN : Date.parse(headerTimestamp);
    return {
      status: field(block, "Status"),
      kind: field(block, "Record-Kind"),
      planId: field(block, "Plan-ID"),
      artifactSha: field(block, "Artifact-SHA"),
      recordTime,
    };
  });
  const finalizedPlans = new Set(records
    .filter((record) => record.status === "PASS_VERDICT" && record.kind === "SLICE_SET" && record.planId)
    .map((record) => record.planId));
  const now = Date.now();
  const maxAgeMs = ageDays * 86400_000;
  for (const record of records) {
    if (record.kind !== "SLICE_RESULT" || !record.planId || !record.artifactSha || finalizedPlans.has(record.planId)) continue;
    // An unparseable receipt timestamp is unprovable age, so retain it rather than risk a pending finalize.
    if (Number.isNaN(record.recordTime) || now - record.recordTime <= maxAgeMs) protectedShas.add(record.artifactSha);
  }

  let reapable = 0;
  let protectedCount = 0;
  for (const { sha, refname } of refs) {
    if (protectedShas.has(sha)) {
      protectedCount += 1;
      continue;
    }
    if (!prune) {
      reapable += 1;
      process.stdout.write(`would-reap ${refname}\n`);
      continue;
    }
    try {
      git(repo, ["update-ref", "-d", refname], { throwOnError: true });
      reapable += 1;
      process.stdout.write(`reaped ${refname}\n`);
    } catch (error) {
      process.stderr.write(`gc-error ${refname}: ${error.message}\n`);
    }
  }
  process.stdout.write(`gc: ${prune ? "reaped" : "would-reap"} ${reapable} reapable, ${protectedCount} protected, age-days=${ageDays}\n`);
}

const argv = process.argv.slice(2);
const command = argv.shift();
if (command !== "fingerprint" && command !== "validate" && command !== "finalize" && command !== "gc") {
  fail("usage: fingerprint|validate|finalize --repo <root> --manifest <json> --out-dir <dir> [--slice <name> | --log <file>] | gc --repo <root> --log <durable-log> [--protect-sha <sha>] [--age-days N] [--prune]");
}
const opts = {};
while (argv.length) {
  const key = argv.shift();
  if (key === "--prune") {
    opts.prune = "1";
    continue;
  }
  const value = argv.shift();
  if (!key?.startsWith("--") || value === undefined) fail(`invalid option near ${key ?? "<end>"}`);
  opts[key.slice(2)] = value;
}
const required = command === "gc" ? ["repo", "log"] : ["repo", "manifest", "out-dir"];
for (const key of required) if (!opts[key]) fail(`missing --${key}`);
if (command === "validate" && !opts.slice) fail("validate requires --slice");
if (command === "finalize" && !opts.log) fail("finalize requires --log");

let repo;
let manifestPath;
try {
  repo = fs.realpathSync(path.resolve(opts.repo));
  if (command !== "gc") manifestPath = fs.realpathSync(path.resolve(opts.manifest));
} catch (error) {
  fail(`cannot resolve repo/manifest: ${error.message}`);
}
if (command === "gc") {
  gcMain(repo, opts);
  process.exit(0);
}
// MODEL 1 mutates only the caller tree; this validator runs in its frozen artifact. MODEL 2 can
// still plant an escaping manifest path there, so containment is checked after realpath before any
// plan/evidence read.
if (!relativeIfInside(repo, manifestPath)) fail(`slice manifest must resolve inside the frozen repository: ${opts.manifest}`);
const outDir = path.resolve(opts["out-dir"]);
let plan;
try {
  plan = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`cannot parse manifest: ${error.message}`);
}

if (plan.version !== 2) fail("manifest version must be 2");
if (!plan.approval || typeof plan.approval.by !== "string" || !plan.approval.by.trim()) fail("manifest requires approval.by");
if (command !== "fingerprint" && plan.approval.status !== "APPROVED") fail("release validation requires approval.status=APPROVED");
if (!Array.isArray(plan.uncovered) || plan.uncovered.length !== 0) fail("a full gate requires uncovered=[]; record uncovered surface and obtain revised PM approval");
if (!plan.scope || typeof plan.scope.base_commit !== "string" || !/^[0-9a-f]{40}$/.test(plan.scope.base_commit)) fail("manifest requires scope.base_commit as an exact lowercase 40-hex commit");
const baseCommit = git(repo, ["rev-parse", "--verify", `${plan.scope.base_commit}^{commit}`]).trim();
if (baseCommit !== plan.scope.base_commit) fail("scope.base_commit did not resolve to itself");
const liveHead = git(repo, ["rev-parse", "HEAD"]).trim();
// A frozen gate checks out a synthetic snapshot commit so its worktree cannot change while the
// reviewer runs. The PM approved this plan against the snapshot's immutable parent (the caller's
// HEAD), not the synthetic wrapper SHA. The runner alone supplies this internal value and it must
// exactly equal the declared base; any other value would make the plan's identity dishonest.
const artifactParent = process.env.GEMINI_GATE_ARTIFACT_PARENT;
const head = artifactParent ? git(repo, ["rev-parse", "--verify", `${artifactParent}^{commit}`]).trim() : liveHead;
if (artifactParent && head !== baseCommit) fail("frozen artifact parent must equal scope.base_commit");

const declaredScope = sortedUnique(plan.scope.files, "scope.files");
const tracked = git(repo, ["diff", "--name-only", "--diff-filter=ACMRD", baseCommit, "--"]).split("\n").filter(Boolean);
const untrackedList = git(repo, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
const untracked = new Set(untrackedList);
const excluded = new Set(["docs/journal/gemini_review_log.md"]);
const manifestRel = relativeIfInside(repo, manifestPath);
if (manifestRel) excluded.add(manifestRel);
const actualScope = [...new Set([...tracked, ...untrackedList])].filter((file) => !excluded.has(file)).sort();
if (!sameArray(declaredScope, actualScope)) {
  fail(`scope.files does not equal the actual changed surface; declared=${JSON.stringify(declaredScope)} actual=${JSON.stringify(actualScope)}`);
}

if (!Array.isArray(plan.slices) || plan.slices.length < 2) fail("manifest requires at least one coverage slice plus the final cross_boundary slice");
const names = new Set();
const coverageSlices = [];
let crossBoundary = null;
for (const [index, slice] of plan.slices.entries()) {
  if (!slice || typeof slice.name !== "string" || !slice.name || /[\n\r\t]/.test(slice.name)) fail(`slices[${index}] requires a valid name`);
  if (names.has(slice.name)) fail(`duplicate slice name: ${slice.name}`);
  names.add(slice.name);
  if (slice.kind !== "coverage" && slice.kind !== "cross_boundary") fail(`slice ${slice.name} kind must be coverage or cross_boundary`);
  slice.files = sortedUnique(slice.files, `slice ${slice.name}.files`);
  if (!slice.files.length) fail(`slice ${slice.name} must name at least one file`);
  for (const file of slice.files) if (!declaredScope.includes(file)) fail(`slice ${slice.name} names file outside scope: ${file}`);
  slice.contract_context = sortedUnique(slice.contract_context, `slice ${slice.name}.contract_context`);
  if (!slice.contract_context.length) fail(`slice ${slice.name} requires contract_context`);
  for (const context of slice.contract_context) repoContextPath(repo, context);
  if (slice.kind === "coverage") coverageSlices.push(slice);
  else {
    if (crossBoundary) fail("manifest must contain exactly one cross_boundary slice");
    crossBoundary = slice;
  }
}
if (!coverageSlices.length) fail("manifest requires at least one coverage slice");
if (!crossBoundary || plan.slices.at(-1) !== crossBoundary) fail("the final manifest entry must be the cross_boundary slice");

const covered = sortedUnique(coverageSlices.flatMap((slice) => slice.files), "coverage union");
if (!sameArray(covered, declaredScope)) fail(`coverage slices are incomplete or overlapping-only; covered=${JSON.stringify(covered)} scope=${JSON.stringify(declaredScope)}`);
for (const slice of coverageSlices) {
  const otherFiles = new Set(coverageSlices.filter((other) => other !== slice).flatMap((other) => other.files));
  if (coverageSlices.length > 1 && !slice.files.some((file) => !otherFiles.has(file))) fail(`coverage slice ${slice.name} contributes no unique surface (overlapping-only)`);
}

const requiredBoundaries = ["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"];
const normalizedBoundaries = {};
for (const boundary of requiredBoundaries) {
  const claim = crossBoundary.boundaries?.[boundary];
  if (!claim || !["covered", "not_applicable"].includes(claim.status)) fail(`cross_boundary ${boundary} requires status covered or not_applicable`);
  const scopeFiles = sortedUnique(claim.scope_files ?? [], `cross_boundary.${boundary}.scope_files`);
  const contexts = sortedUnique(claim.contract_context ?? [], `cross_boundary.${boundary}.contract_context`);
  if (typeof claim.rationale !== "string" || !claim.rationale.trim()) fail(`cross_boundary ${boundary} requires rationale`);
  for (const file of scopeFiles) if (!crossBoundary.files.includes(file)) fail(`cross_boundary ${boundary} scope file is not selected: ${file}`);
  for (const context of contexts) if (!crossBoundary.contract_context.includes(context)) fail(`cross_boundary ${boundary} context is not selected: ${context}`);
  if (claim.status === "covered" && !scopeFiles.length) fail(`cross_boundary ${boundary} covered claim requires at least one selected scope file`);
  if (claim.status === "not_applicable" && !contexts.length) fail(`cross_boundary ${boundary} not_applicable claim requires contract context`);
  normalizedBoundaries[boundary] = { status: claim.status, scope_files: scopeFiles, contract_context: contexts, rationale: claim.rationale.trim() };
}

const fileCache = new Map();
const contextCache = new Map();
const normalizedSlices = plan.slices.map((slice) => ({
  name: slice.name,
  kind: slice.kind,
  files: slice.files.map((file) => fileEvidence(repo, baseCommit, file, untracked, fileCache)),
  contract_context: slice.contract_context.map((context) => contextEvidence(repo, context, contextCache)),
  ...(slice.kind === "cross_boundary" ? { boundaries: normalizedBoundaries } : {}),
}));
const planCore = {
  version: 2,
  approval: { status: plan.approval.status, by: plan.approval.by.trim(), expected_plan_id: plan.approval.expected_plan_id || "" },
  head,
  scope: { base_commit: baseCommit, files: declaredScope },
  uncovered: [],
  slices: normalizedSlices,
};
const identityCore = { ...planCore, approval: { by: plan.approval.by.trim() } };
const planId = crypto.createHash("sha256").update(JSON.stringify(identityCore)).digest("hex");
if (command !== "fingerprint" && plan.approval.expected_plan_id !== planId) {
  fail(`PM-approved expected_plan_id mismatch; expected=${plan.approval.expected_plan_id || "missing"} actual=${planId}`);
}
const selected = command === "validate" ? normalizedSlices.find((slice) => slice.name === opts.slice) : null;
if (command === "validate" && !selected) fail(`slice not found: ${opts.slice}`);
const normalized = { ...planCore, plan_id: planId, ...(selected ? { selected_slice: selected.name } : {}) };

fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(outDir, "base.txt"), `${baseCommit}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(outDir, "plan-id.txt"), `${planId}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(outDir, "slice-names.txt"), `${normalizedSlices.map((slice) => slice.name).join("\n")}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });

if (command === "fingerprint") {
  process.stdout.write(`candidate immutable plan id: ${planId}\nSet approval.status=APPROVED and approval.expected_plan_id=${planId} only after frontier-PM review.\n`);
  process.exit(0);
}

if (command === "validate") {
  const rawSelected = plan.slices.find((slice) => slice.name === opts.slice);
  const fileLines = [];
  const diffParts = [];
  for (const [index, file] of rawSelected.files.entries()) {
    const snapshot = path.join(outDir, `file-${index}.snapshot`);
    const cached = fileCache.get(file);
    if (cached.exists) fs.writeFileSync(snapshot, cached.bytes, { mode: 0o600 });
    fileLines.push(`${file}\t${cached.exists ? snapshot : ""}\t${cached.exists ? "1" : "0"}`);
    diffParts.push(cached.diff);
  }
  fs.writeFileSync(path.join(outDir, "files.txt"), `${fileLines.join("\n")}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(outDir, "diff.txt"), diffParts.join("\n"), { mode: 0o600 });
  const contextLines = [];
  for (const [index, context] of rawSelected.contract_context.entries()) {
    const cached = contextCache.get(context);
    const snapshot = path.join(outDir, `context-${index}.txt`);
    fs.writeFileSync(snapshot, cached.bytes, { mode: 0o600 });
    contextLines.push(`${cached.evidence.path}\t${snapshot}`);
  }
  fs.writeFileSync(path.join(outDir, "contexts.txt"), `${contextLines.join("\n")}\n`, { mode: 0o600 });
  process.stdout.write(`slice ${selected.name} validated as non-release result under immutable plan ${planId}\n`);
  process.exit(0);
}

let log;
try {
  log = fs.readFileSync(path.resolve(opts.log), "utf8");
} catch (error) {
  fail(`cannot read durable attempt log: ${error.message}`);
}
const records = log.split(/(?=^## Gemini gate attempt — )/m).map((block, index) => ({
  index,
  block,
  status: field(block, "Status"),
  attemptId: field(block, "Attempt-ID"),
  kind: field(block, "Record-Kind"),
  release: field(block, "Release-Gate"),
  gateVerdict: field(block, "Gate-Verdict"),
  recordPlanId: field(block, "Plan-ID"),
  artifactSha: field(block, "Artifact-SHA"),
  artifactRef: field(block, "Artifact-Ref"),
  slice: block.match(/^- Slice: `([^`]*)` from /m)?.[1] ?? "",
}));
const receipts = [];
let latestCoverageIndex = -1;
for (const slice of normalizedSlices) {
  const matches = records.filter((record) => record.recordPlanId === planId && record.slice === slice.name && record.kind === "SLICE_RESULT");
  const latest = matches.at(-1);
  if (!latest || latest.status !== "PASS_VERDICT" || latest.release !== "NO" || !latest.attemptId) {
    fail(`slice set is incomplete: latest durable result for ${slice.name} is ${latest?.status || "missing"}`);
  }
  if (latest.gateVerdict !== "GO") {
    fail(`slice ${slice.name} latest receipt is not a GO verdict (Gate-Verdict=${latest.gateVerdict || "missing"})`);
  }
  if (!/^[0-9a-f]{40}$/.test(latest.artifactSha) || !latest.artifactRef) {
    fail(`slice ${slice.name} lacks a retained frozen artifact SHA/ref`);
  }
  const resolvedArtifact = git(repo, ["rev-parse", "--verify", `${latest.artifactRef}^{commit}`]).trim();
  if (resolvedArtifact !== latest.artifactSha) {
    fail(`slice ${slice.name} retained artifact ref does not resolve to its recorded SHA`);
  }
  if (slice.kind === "coverage") latestCoverageIndex = Math.max(latestCoverageIndex, latest.index);
  if (slice.kind === "cross_boundary" && latest.index <= latestCoverageIndex) fail("final cross-boundary receipt must occur after every coverage-slice receipt");
  receipts.push({ slice: slice.name, attempt_id: latest.attemptId });
}
fs.writeFileSync(path.join(outDir, "aggregate.json"), `${JSON.stringify({ plan_id: planId, head, receipts }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`all ${receipts.length} slices, including final cross-boundary, have durable PASS_VERDICT receipts under immutable plan ${planId}\n`);
