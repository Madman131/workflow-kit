import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run, verifyResponse } from "../scripts/gemini-frozen-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), runner = path.join(root, "scripts", "gemini-frozen-gate.mjs"), wrapper = path.join(root, "scripts", "cold-review-gemini.sh");
const syntheticEnvKey = ["GEMINI", "API", "KEY"].join("_");
function syntheticAssignment(labelParts, valueParts) { return ["export const ", labelParts.join("_"), " = '", valueParts.join(""), "';\n"].join(""); }
function authorizationLabel() { return ["AUTH", "ORIZATION"].join(""); }
function authorizationAssignment(scheme) { return ["export const ", authorizationLabel(), " = ", "'", [scheme, ["really", "secret", "value"].join("")].join(" "), "'\n"].join(""); }
function authorizationHeader(scheme, quoted = false) { const value = [scheme, ["really", "secret", "value"].join("")].join(" "); return [["Auth", "orization"].join(""), ": ", quoted ? `\"${value}\"` : value, "\n"].join(""); }
function git(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim(); }
function fixture({ contextSymlink = false, invariantSymlink = false, noDocs = false, withInstalledWrapper = false, baseSource = "export const before = 1;\n", candidateSource = "export const after = 2;\n" } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-frozen-gate-"));
  git(dir, ["init", "-q"]); git(dir, ["config", "user.email", "test@example.invalid"]); git(dir, ["config", "user.name", "Test"]);
  mkdirSync(path.join(dir, "core"), { recursive: true }); if (!noDocs) mkdirSync(path.join(dir, "docs"), { recursive: true });
  if (invariantSymlink) { writeFileSync(path.join(dir, "invariant-target.md"), "portable invariant\n"); symlinkSync("../invariant-target.md", path.join(dir, "core", "INVARIANTS.md")); } else writeFileSync(path.join(dir, "core", "INVARIANTS.md"), "portable invariant\n");
  writeFileSync(path.join(dir, "core", "REPO_INVARIANTS.md"), "repo invariant\n");
  if (!noDocs) { if (contextSymlink) { writeFileSync(path.join(dir, "contract-target.md"), "acceptance context\n"); symlinkSync("../contract-target.md", path.join(dir, "docs", "contract.md")); } else writeFileSync(path.join(dir, "docs", "contract.md"), "acceptance context\n"); }
  writeFileSync(path.join(dir, "unchanged.md"), "UNRELATED-SENTINEL\n"); writeFileSync(path.join(dir, "src.mjs"), baseSource);
  if (withInstalledWrapper) { mkdirSync(path.join(dir, "scripts"), { recursive: true }); copyFileSync(wrapper, path.join(dir, "scripts", "cold-review-gemini.sh")); copyFileSync(runner, path.join(dir, "scripts", "gemini-frozen-gate.mjs")); chmodSync(path.join(dir, "scripts", "cold-review-gemini.sh"), 0o755); }
  git(dir, ["add", "."]); git(dir, ["commit", "-qm", "base"]); const base = git(dir, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(dir, "src.mjs"), candidateSource); git(dir, ["add", "."]); git(dir, ["commit", "-qm", "candidate"]);
  return { dir, base, candidate: git(dir, ["rev-parse", "HEAD"]), tree: git(dir, ["rev-parse", "HEAD^{tree}"]) };
}
function args(f, extra = []) { return ["--repo", f.dir, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--context", "docs/contract.md", ...extra]; }
function contextArgs(f, context, extra = []) { return ["--repo", f.dir, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--context", context, ...extra]; }
function dry(f, extra = []) { return spawnSync(process.execPath, [runner, ...args(f, ["--dry-run", ...extra])], { encoding: "utf8" }); }
function refreshed(f) { return { ...f, candidate: git(f.dir, ["rev-parse", "HEAD"]), tree: git(f.dir, ["rev-parse", "HEAD^{tree}"]) }; }
function responseFrom(request, verdict = "GO") {
  const text = JSON.parse(request.body).contents[0].parts[0].text;
  const scope = text.match(/=== NORMALIZED INSPECTED SCOPE ===\n([^\n]+)/)[1];
  const markers = [...text.matchAll(/PIL-INGEST-(?:HEAD|MIDDLE|EOF)-[0-9a-f]+/g)].map(match => match[0]);
  const done = text.match(/PIL-DONE-[0-9a-f]+/)[0];
  return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: `findings\nVERDICT: ${verdict}\nINSPECTED SCOPE: ${scope}\nINGESTION PROOF: ${markers.join(" | ")}\n${done}` }] } }] }) };
}
async function withFetch(fn) {
  const previousFetch = globalThis.fetch, previousKey = process.env[syntheticEnvKey]; process.env[syntheticEnvKey] = ["test", "key"].join("-");
  try { return await fn(); } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env[syntheticEnvKey]; else process.env[syntheticEnvKey] = previousKey; process.exitCode = 0; }
}
function plan(f, mutate = {}) {
  const base = { version: 2, approval: { status: "DRAFT", by: "pm", expected_plan_id: "" }, scope: { base_commit: f.base, candidate_commit: f.candidate, candidate_tree: f.tree, files: ["src.mjs"] }, uncovered: [], slices: [{ name: "coverage", kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"] }, { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }])) }] };
  Object.assign(base, mutate); const file = path.join(f.dir, "plan.json"); writeFileSync(file, JSON.stringify(base)); return file;
}
function multiFixture(withInstalledWrapper = false) {
  const f = fixture({ withInstalledWrapper }), files = ["src.mjs"];
  for (let index = 0; index < 3; index++) { const file = `slice-${index}.mjs`; writeFileSync(path.join(f.dir, file), `export const payload = "${"x".repeat(29000)}";\n`); files.push(file); }
  git(f.dir, ["add", "."]); git(f.dir, ["commit", "-qm", "large candidate"]);
  return { ...f, candidate: git(f.dir, ["rev-parse", "HEAD"]), tree: git(f.dir, ["rev-parse", "HEAD^{tree}"]), files };
}
function slicedPlan(f, slices) {
  const coverage = f.files.map(file => ({ name: `coverage-${file}`, kind: "coverage", files: [file], contract_context: ["docs/contract.md"] }));
  const final = { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }])) };
  const value = { version: 2, approval: { status: "DRAFT", by: "pm", expected_plan_id: "" }, scope: { base_commit: f.base, candidate_commit: f.candidate, candidate_tree: f.tree, files: f.files }, uncovered: [], slices: slices || [...coverage, final] };
  writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value)); return value;
}
function sliceArgs(f, action) { return ["--repo", f.dir, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", action]; }
function fingerprint(f) { const r = spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).plan_id; }
function fragment(f, kind, start, end, pathname = "src.mjs") {
  const commit = kind === "deleted_source" ? f.base : f.candidate;
  const bytes = kind === "per_file_diff" ? Buffer.from(execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", pathname])) : Buffer.from(execFileSync("git", ["-C", f.dir, "show", `${commit}:${pathname}` ]));
  const part = bytes.subarray(start, end), digest = value => crypto.createHash("sha256").update(value).digest("hex");
  return { base_commit: f.base, candidate_commit: f.candidate, candidate_tree: f.tree, path: pathname, component_kind: kind, component_byte_length: bytes.length, component_sha256: digest(bytes), byte_start: start, byte_end: end, fragment_sha256: digest(part) };
}

test("frozen dry-run has a stable material/request identity and ignores replace objects", () => {
  const f = fixture(); try {
    const first = dry(f); assert.equal(first.status, 0, first.stderr); const baseline = JSON.parse(first.stdout);
    const second = dry(f); assert.deepEqual(JSON.parse(second.stdout).envelopes, baseline.envelopes);
    git(f.dir, ["replace", f.base, f.candidate]); const replaced = dry(f); assert.equal(replaced.status, 0, replaced.stderr); assert.deepEqual(JSON.parse(replaced.stdout).envelopes, baseline.envelopes);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("exact tuple, clean endpoint, regular files, and non-escaping manifests fail closed", () => {
  const f = fixture(); try {
    assert.notEqual(dry(f, ["--tree", "0".repeat(40)]).status, 0);
    writeFileSync(path.join(f.dir, "unrelated.txt"), "dirty\n"); assert.notEqual(dry(f).status, 0); unlinkSync(path.join(f.dir, "unrelated.txt"));
    const outside = path.join(path.dirname(f.dir), "outside-plan.json"); writeFileSync(outside, "{}");
    const escaped = spawnSync(process.execPath, [runner, "--repo", f.dir, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--slice-manifest", "../outside-plan.json", "--fingerprint"], { encoding: "utf8" }); assert.notEqual(escaped.status, 0); rmSync(outside, { force: true });
    writeFileSync(path.join(f.dir, "real-plan.json"), "{}"); symlinkSync("real-plan.json", path.join(f.dir, "plan.json"));
    const linked = spawnSync(process.execPath, [runner, "--repo", f.dir, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", "--fingerprint"], { encoding: "utf8" }); assert.notEqual(linked.status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("type changes and malformed slice plans refuse before a review", () => {
  const f = fixture(); try {
    unlinkSync(path.join(f.dir, "src.mjs")); symlinkSync("docs/contract.md", path.join(f.dir, "src.mjs")); git(f.dir, ["add", "-A"]); git(f.dir, ["commit", "-qm", "symlink"]);
    const typeChanged = { ...f, candidate: git(f.dir, ["rev-parse", "HEAD"]), tree: git(f.dir, ["rev-parse", "HEAD^{tree}"]) }; assert.notEqual(dry(typeChanged).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
  const g = fixture(); try {
    plan(g, { slices: [{ name: "only", kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"] }, { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], boundaries: {} }] });
    const r = spawnSync(process.execPath, [runner, "--repo", g.dir, "--base", g.base, "--candidate", g.candidate, "--tree", g.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", "--fingerprint"], { encoding: "utf8" }); assert.notEqual(r.status, 0);
  } finally { rmSync(g.dir, { recursive: true, force: true }); }
});
test("committed invariant and context symlinks refuse before fetch", async () => {
  for (const f of [fixture({ invariantSymlink: true }), fixture({ contextSymlink: true })]) try { await withFetch(async () => {
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("must not fetch"); };
    await assert.rejects(run(args(f))); assert.equal(calls, 0);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("bounded credential labels refuse values while placeholder configuration remains reviewable", async () => {
  const f = fixture(), benign = fixture(); try { await withFetch(async () => {
    writeFileSync(path.join(f.dir, "src.mjs"), syntheticAssignment(["DB", "PASSWORD"], ["really", "secret"])); git(f.dir, ["add", "src.mjs"]); git(f.dir, ["commit", "-qm", "credential"]); const credentialCase = refreshed(f);
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("must not fetch"); }; await assert.rejects(run(args(credentialCase))); assert.equal(calls, 0);
    writeFileSync(path.join(benign.dir, "src.mjs"), ["export const ", ["DB", "PASSWORD"].join("_"), " = '${DB_PASSWORD}';\n"].join("")); git(benign.dir, ["add", "src.mjs"]); git(benign.dir, ["commit", "-qm", "placeholder"]); assert.equal(dry(refreshed(benign)).status, 0);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); rmSync(benign.dir, { recursive: true, force: true }); }
});
test("final supplied material refuses deleted credentials before dry-run or fetch", async () => {
  const credentialFixture = fixture({ baseSource: [syntheticAssignment(["API", "KEY"], ["reallysecretvalue"]), syntheticAssignment(["DB", "PASSWORD"], ["alsosecretvalue"])].join(""), candidateSource: "export const removed = true;\n" }), placeholder = fixture({ baseSource: ["export const ", ["DB", "PASSWORD"].join("_"), " = '${DB_PASSWORD}';\n"].join(""), candidateSource: "export const removed = true;\n" }); try { await withFetch(async () => {
    assert.notEqual(dry(credentialFixture).status, 0);
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("must not fetch"); }; await assert.rejects(run(args(credentialFixture))); assert.equal(calls, 0);
    assert.equal(dry(placeholder).status, 0);
  }); } finally { rmSync(credentialFixture.dir, { recursive: true, force: true }); rmSync(placeholder.dir, { recursive: true, force: true }); }
});
test("ordinary additions reach envelope assembly while exact renames refuse", () => {
  const f = fixture(), renamed = fixture(); try {
    writeFileSync(path.join(f.dir, "ordinary-added.mjs"), "export const ordinary = true;\n"); git(f.dir, ["add", "ordinary-added.mjs"]); git(f.dir, ["commit", "-qm", "ordinary add"]); assert.equal(dry(refreshed(f)).status, 0);
    git(renamed.dir, ["mv", "src.mjs", "renamed.mjs"]); writeFileSync(path.join(renamed.dir, "renamed.mjs"), "export const before = 1;\n"); git(renamed.dir, ["add", "renamed.mjs"]); git(renamed.dir, ["commit", "-qm", "exact rename"]); assert.notEqual(dry(refreshed(renamed)).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); rmSync(renamed.dir, { recursive: true, force: true }); }
});
test("journal paths, ambient Git locations, and hidden untracked files refuse before fetch", async () => {
  const f = fixture(), external = path.join(os.tmpdir(), `gemini-external-${process.pid}.md`); try { await withFetch(async () => {
    writeFileSync(external, "outside sentinel\n"); mkdirSync(path.join(f.dir, "docs", "journal"), { recursive: true }); symlinkSync(external, path.join(f.dir, "docs", "journal", "gemini_review_log.md"));
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("must not fetch"); }; await assert.rejects(run(args(f))); assert.equal(calls, 0); assert.equal(readFileSync(external, "utf8"), "outside sentinel\n"); unlinkSync(path.join(f.dir, "docs", "journal", "gemini_review_log.md")); rmSync(path.join(f.dir, "docs", "journal"), { recursive: true, force: true });
    const oldIndex = process.env.GIT_INDEX_FILE; process.env.GIT_INDEX_FILE = path.join(f.dir, "redirected-index"); try { await assert.rejects(run(args(f))); assert.equal(calls, 0); } finally { if (oldIndex === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = oldIndex; }
    git(f.dir, ["config", "status.showUntrackedFiles", "no"]); writeFileSync(path.join(f.dir, "hidden.txt"), "must still be dirt\n"); assert.notEqual(dry(f).status, 0);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); rmSync(external, { force: true }); }
});
test("a new journal directory is sanctioned alone but no sibling dirt is", async () => {
  const f = fixture({ noDocs: true }); try { await withFetch(async () => {
    let calls = 0; globalThis.fetch = async (_url, request) => { calls += 1; return responseFrom(request); }; await run(contextArgs(f, "core/INVARIANTS.md")); assert.equal(calls, 1); assert.ok(existsSync(path.join(f.dir, "docs", "journal", "gemini_review_log.md")));
    writeFileSync(path.join(f.dir, "docs", "journal", "sibling.md"), "unrelated dirt\n"); calls = 0; await assert.rejects(run(contextArgs(f, "core/INVARIANTS.md"))); assert.equal(calls, 0);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("the shared legacy lock refuses direct provider entry before fetch", async () => {
  const f = fixture(); try { await withFetch(async () => {
    const common = path.resolve(f.dir, git(f.dir, ["rev-parse", "--git-common-dir"])), lock = path.join(common, "cold-review-gemini.lock"), wrapperSource = readFileSync(wrapper, "utf8"); mkdirSync(lock); writeFileSync(path.join(lock, "owner"), "pid=999999\nrepo=legacy\n");
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("must not fetch"); }; await assert.rejects(run(args(f))); assert.equal(calls, 0);
    assert.match(wrapperSource, /LOCK_DIR="\$common\/cold-review-gemini\.lock"/); assert.ok(wrapperSource.indexOf("acquire_single_flight; fi") < wrapperSource.indexOf("resolve_agy()"));
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("frozen-only wrapper options refuse before legacy agy discovery", () => {
  const fake = path.join(os.tmpdir(), `gemini-frozen-intent-${process.pid}`), marker = `${fake}.called`; try {
    writeFileSync(fake, `#!/bin/sh\nprintf called > '${marker}'\n`); chmodSync(fake, 0o755);
    for (const argv of [["--fingerprint"], ["--gemini-model", "gemini-3-pro"], ["--base", "a".repeat(40)]]) {
      const result = spawnSync("bash", [wrapper, ...argv], { cwd: root, encoding: "utf8", env: { ...process.env, GEMINI_AGY_BIN: fake, GEMINI_ALLOW_CODE_MODE: "1" } }); assert.equal(result.status, 2, result.stderr); assert.equal(existsSync(marker), false);
    }
  } finally { rmSync(fake, { force: true }); rmSync(marker, { force: true }); }
});
test("public wrapper reaches frozen full dry-run and sliced fingerprint", () => {
  const full = fixture({ withInstalledWrapper: true }), sliced = multiFixture(true); try {
    const fullWrapper = path.join(full.dir, "scripts", "cold-review-gemini.sh"), fullResult = spawnSync("bash", [fullWrapper, "--base", full.base, "--candidate", full.candidate, "--tree", full.tree, "--rig-id", "test-rig", "--context", "docs/contract.md", "--dry-run"], { cwd: full.dir, encoding: "utf8" });
    assert.equal(fullResult.status, 0, fullResult.stderr); assert.equal(JSON.parse(fullResult.stdout).frozen.candidate, full.candidate);
    slicedPlan(sliced); const slicedWrapper = path.join(sliced.dir, "scripts", "cold-review-gemini.sh"), slicedResult = spawnSync("bash", [slicedWrapper, "--base", sliced.base, "--candidate", sliced.candidate, "--tree", sliced.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", "--fingerprint"], { cwd: sliced.dir, encoding: "utf8" });
    assert.equal(slicedResult.status, 0, slicedResult.stderr); assert.match(slicedResult.stdout, /"plan_id"\s*:/);
  } finally { rmSync(full.dir, { recursive: true, force: true }); rmSync(sliced.dir, { recursive: true, force: true }); }
});
test("missing, option-shaped, and unknown entrypoint values refuse before dispatch", () => {
  const fake = path.join(os.tmpdir(), `gemini-frozen-malformed-${process.pid}`), marker = `${fake}.called`;
  try {
    writeFileSync(fake, `#!/bin/sh\nprintf called > '${marker}'\n`); chmodSync(fake, 0o755);
    for (const argv of [["--context"], ["--context", ""], ["--context", "--base"], ["--bogus", "value"]]) {
      const wrapperResult = spawnSync("bash", [wrapper, ...argv], { cwd: root, encoding: "utf8", env: { ...process.env, GEMINI_AGY_BIN: fake, GEMINI_ALLOW_CODE_MODE: "1" } });
      assert.equal(wrapperResult.status, 2, `${argv}: ${wrapperResult.stderr}`); assert.equal(existsSync(marker), false);
    }
    const f = fixture(); try {
      for (const argv of [["--context", "--base"], ["--unknown", "value"]]) {
        const directResult = spawnSync(process.execPath, [runner, ...args(f, argv)], { encoding: "utf8", env: { ...process.env, [syntheticEnvKey]: "unused" } });
        assert.equal(directResult.status, 2, `${argv}: ${directResult.stderr}`);
      }
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  } finally { rmSync(fake, { force: true }); rmSync(marker, { force: true }); }
});
test("response firewall refuses old mixed parts, conflicting verdicts, and incomplete proof", () => {
  const e = { scope: "{\"slice\":\"full\"}", markers: ["PIL-INGEST-HEAD-a", "PIL-INGEST-MIDDLE-b", "PIL-INGEST-EOF-c"], done: "PIL-DONE-test" };
  const text = `VERDICT: GO\nINSPECTED SCOPE: ${e.scope}\nINGESTION PROOF: ${e.markers.join(" | ")}\n${e.done}`;
  assert.equal(verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }, e).verdict, "GO");
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text, thought: "old runner accepted this" }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: `${text}\nVERDICT: NO-GO` }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: text.replace(e.markers[2], "missing") }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: text.replace("VERDICT: GO", "VERDICT: go") }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: text.replace(e.done, "") }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: `${text}\ntrailing` }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: text.replace(e.done, `${e.done}\nfindings`) }] } }] }, e));
  assert.equal(verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text, thoughtSignature: "opaque-provider-signature" }] } }] }, e).verdict, "GO");
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text, executableCode: { code: "x" } }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text, functionCall: { name: "x" } }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text, inlineData: { mimeType: "text/plain", data: "eA==" } }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "" }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text }] } }] }, e));
  assert.doesNotMatch(readFileSync(runner, "utf8"), /\bagy\b/);
});
test("live no-log is refused before fetch", async () => {
  const f = fixture(); try { await withFetch(async () => { let calls = 0; globalThis.fetch = async () => { calls += 1; return responseFrom({ body: "{}" }); }; await assert.rejects(run(args(f, ["--no-log"]))); assert.equal(calls, 0); }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("authorization assignments, deleted forms, and quoted Basic headers refuse while placeholders pass", () => {
  const refused = [
    fixture({ candidateSource: authorizationAssignment("Basic") }),
    fixture({ baseSource: authorizationAssignment("Basic"), candidateSource: "export const removed = true;\n" }),
    fixture({ candidateSource: authorizationHeader("Basic", true) }),
  ];
  const allowed = [
    fixture({ candidateSource: "export const AUTHORIZATION = 'Basic ${BASIC_AUTH}';\n" }),
    fixture({ candidateSource: "Authorization: \"Basic $(read-auth)\"\n" }),
    fixture({ candidateSource: "export const AUTHORIZATION = 'Basic $1';\n" }),
  ];
  try {
    for (const f of refused) assert.notEqual(dry(f).status, 0);
    for (const f of allowed) assert.equal(dry(f).status, 0, dry(f).stderr);
  } finally { for (const f of [...refused, ...allowed]) rmSync(f.dir, { recursive: true, force: true }); }
});
test("ordinary authorization schemes refuse current and deleted material before live fetch", async () => {
  const refused = [
    fixture({ candidateSource: authorizationAssignment("Basic") }),
    fixture({ candidateSource: authorizationAssignment("Token") }),
    fixture({ baseSource: authorizationHeader("Basic"), candidateSource: "export const removed = true;\n" }),
    fixture({ baseSource: authorizationHeader("Token"), candidateSource: "export const removed = true;\n" }),
  ];
  const placeholders = [
    fixture({ candidateSource: "export const AUTHORIZATION = 'Token ${TOKEN_AUTH}';\n" }),
    fixture({ baseSource: "Authorization: Basic ${BASIC_AUTH}\n", candidateSource: "export const removed = true;\n" }),
  ];
  try { await withFetch(async () => {
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("must not fetch"); };
    for (const f of refused) { await assert.rejects(run(args(f))); assert.equal(calls, 0); }
    for (const f of placeholders) assert.equal(dry(f).status, 0, dry(f).stderr);
  }); } finally { for (const f of [...refused, ...placeholders]) rmSync(f.dir, { recursive: true, force: true }); }
});
test("verified GO and NO-GO print and persist complete records", async () => {
  const f = fixture(); try { await withFetch(async () => {
    globalThis.fetch = async (_url, request) => { const body = JSON.parse(request.body); assert.equal(body.tools, undefined); assert.equal(body.functionDeclarations, undefined); assert.doesNotMatch(JSON.stringify(body), /dangerous|functionCall/); assert.doesNotMatch(body.contents[0].parts[0].text, /UNRELATED-SENTINEL/); return responseFrom(request, "GO"); }; let printed = "", write = process.stdout.write; process.stdout.write = value => { printed += value; return true; };
    try { await run(args(f)); } finally { process.stdout.write = write; }
    let log = readFileSync(path.join(f.dir, "docs/journal/gemini_review_log.md"), "utf8"); assert.match(printed, /VERDICT: GO/); assert.match(log, /Reply-UTF8-Base64/); assert.match(log, /Complete-Record: `YES`/);
    globalThis.fetch = async (_url, request) => responseFrom(request, "NO-GO"); await run(args(f)); log = readFileSync(path.join(f.dir, "docs/journal/gemini_review_log.md"), "utf8"); assert.match(log, /Status: `NO_GO`/);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("incomplete journal records do not cache a transport failure and endpoint mutation cannot release", async () => {
  const f = fixture(); try { await withFetch(async () => {
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("Gemini provider returned HTTP 503"); }; await assert.rejects(run(args(f)));
    const journal = path.join(f.dir, "docs/journal/gemini_review_log.md"), size = readFileSync(journal).length; truncateSync(journal, size - 20);
    globalThis.fetch = async (_url, request) => { calls += 1; return responseFrom(request); }; await run(args(f)); assert.equal(calls, 2);
    globalThis.fetch = async (_url, request) => { writeFileSync(path.join(f.dir, "mutated.txt"), "after preflight\n"); return responseFrom(request); }; await assert.rejects(run(args(f))); assert.doesNotMatch(readFileSync(journal, "utf8"), /mutated\.txt[\s\S]*Release-Gate: `YES`/);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("a complete timeout record blocks unchanged-rig retries before fetch", async () => {
  const f = fixture(); try { await withFetch(async () => {
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("Gemini provider timed out"); }; await assert.rejects(run(args(f)));
    globalThis.fetch = async (_url, request) => { calls += 1; return responseFrom(request); }; await assert.rejects(run(args(f))); assert.equal(calls, 1);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("oversized full artifacts refuse while an approved ordered slice set records aggregate GO and NO-GO", async () => {
  const f = multiFixture(); try { await withFetch(async () => {
    assert.notEqual(dry(f).status, 0, "full envelope must exceed the direct cap");
    const draft = slicedPlan(f), planId = fingerprint(f); draft.approval = { status: "APPROVED", by: "pm", expected_plan_id: planId }; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(draft));
    let calls = 0; globalThis.fetch = async (_url, request) => { calls += 1; const body = JSON.parse(request.body); assert.equal(body.tools, undefined); assert.equal(body.functionDeclarations, undefined); assert.doesNotMatch(JSON.stringify(body), /dangerous|functionCall/); return responseFrom(request, "GO"); };
    await run(sliceArgs(f, "--run-slices")); assert.equal(calls, f.files.length + 1); let log = readFileSync(path.join(f.dir, "docs/journal/gemini_review_log.md"), "utf8"); assert.match(log, /Record-Kind: `SLICE_SET`[\s\S]*Release-Gate: `YES`[\s\S]*Gate-Verdict: `GO`[\s\S]*Inspected-Scope: `[\s\S]*Aggregate-Result-SHA256/);
    calls = 0; globalThis.fetch = async (_url, request) => responseFrom(request, calls++ === 0 ? "NO-GO" : "GO"); await run(sliceArgs(f, "--run-slices")); log = readFileSync(path.join(f.dir, "docs/journal/gemini_review_log.md"), "utf8"); assert.match(log, /Record-Kind: `SLICE_SET`[\s\S]*Release-Gate: `NO`[\s\S]*Gate-Verdict: `NO-GO`/);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("one oversized source and diff component reconstruct across bounded fragment slices", async () => {
  const f = fixture({ candidateSource: `export const payload = "${"x".repeat(110000)}";\n` });
  try { await withFetch(async () => {
    assert.notEqual(dry(f).status, 0, "whole-file request must exceed the cap");
    const source = Buffer.from(execFileSync("git", ["-C", f.dir, "show", `${f.candidate}:src.mjs`])), diff = Buffer.from(execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", "src.mjs"]));
    const limit = Math.max(source.length, diff.length), cuts = [0, 30000, 60000, 90000, limit], slices = [];
    for (let i = 0; i < cuts.length - 1; i++) slices.push({ name: `coverage-${i}`, kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", Math.min(cuts[i], source.length), Math.min(cuts[i + 1], source.length)), fragment(f, "per_file_diff", Math.min(cuts[i], diff.length), Math.min(cuts[i + 1], diff.length))] });
    const cross = { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, 1), fragment(f, "per_file_diff", 0, 1)], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }])) };
    const value = { version: 2, approval: { status: "DRAFT", by: "pm", expected_plan_id: "" }, scope: { base_commit: f.base, candidate_commit: f.candidate, candidate_tree: f.tree, files: ["src.mjs"] }, uncovered: [], slices: [...slices, cross] };
    writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value)); const planId = fingerprint(f); value.approval = { status: "APPROVED", by: "pm", expected_plan_id: planId }; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
    let calls = 0; globalThis.fetch = async (_url, request) => { calls++; return responseFrom(request); }; await run(sliceArgs(f, "--run-slices")); assert.equal(calls, slices.length + 1);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("fragmented coverage cannot name an unfragmented second file before fingerprint or fetch", async () => {
  const f = fixture(); try {
    writeFileSync(path.join(f.dir, "other.mjs"), "export const other = true;\n"); git(f.dir, ["add", "other.mjs"]); git(f.dir, ["commit", "-qm", "second changed file"]);
    Object.assign(f, refreshed(f), { files: ["other.mjs", "src.mjs"] });
    const coverage = { name: "coverage", kind: "coverage", files: ["other.mjs", "src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, Buffer.byteLength("export const after = 2;\n")), fragment(f, "per_file_diff", 0, Buffer.byteLength(execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", "src.mjs"])))] };
    const cross = { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, 1), fragment(f, "per_file_diff", 0, 1)], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }])) };
    const value = slicedPlan(f, [coverage, cross]); value.approval = { status: "APPROVED", by: "pm", expected_plan_id: "0".repeat(64) }; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
    const preflight = spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }); assert.notEqual(preflight.status, 0); assert.match(preflight.stderr, /other\.mjs.*no fragments/);
    await withFetch(async () => { let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); }; await assert.rejects(run(sliceArgs(f, "--run-slices"))); assert.equal(calls, 0); });
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("fragmented cross boundary cannot claim a final file without contributing bytes", async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.dir, "package.json"), "{\"name\":\"fixture\"}\n"); git(f.dir, ["add", "package.json"]); git(f.dir, ["commit", "-qm", "second changed file"]); Object.assign(f, refreshed(f), { files: ["package.json", "src.mjs"] });
    const packageBytes = Buffer.byteLength("{\"name\":\"fixture\"}\n"), diffBytes = Buffer.byteLength(execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", "package.json"]));
    const coverage = { name: "coverage-package", kind: "coverage", files: ["package.json"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, packageBytes, "package.json"), fragment(f, "per_file_diff", 0, diffBytes, "package.json")] }, sourceDiffBytes = Buffer.byteLength(execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", "src.mjs"])), sourceCoverage = { name: "coverage-src", kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, Buffer.byteLength("export const after = 2;\n"), "src.mjs"), fragment(f, "per_file_diff", 0, sourceDiffBytes, "src.mjs")] };
    const cross = { name: "cross", kind: "cross_boundary", files: f.files, contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, 1, "src.mjs"), fragment(f, "per_file_diff", 0, 1, "src.mjs")], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: f.files, contract_context: [], rationale: "reviewed" }])) };
    const value = slicedPlan(f, [coverage, sourceCoverage, cross]); value.approval = { status: "APPROVED", by: "pm", expected_plan_id: "0".repeat(64) }; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
    const preflight = spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }); assert.notEqual(preflight.status, 0); assert.match(preflight.stderr, /final file package\.json contributes no bytes/);
    await withFetch(async () => { let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); }; await assert.rejects(run(sliceArgs(f, "--run-slices"))); assert.equal(calls, 0); });
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("installed wrapper fingerprints a complete frozen fragment plan before direct run", async () => {
  const f = fixture({ withInstalledWrapper: true, candidateSource: `export const payload = "${"x".repeat(110000)}";\n` });
  try { await withFetch(async () => {
    const source = Buffer.from(execFileSync("git", ["-C", f.dir, "show", `${f.candidate}:src.mjs`])), diff = Buffer.from(execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", "src.mjs"])), limit = Math.max(source.length, diff.length), cuts = [0, 30000, 60000, 90000, limit];
    const slices = cuts.slice(0, -1).map((start, index) => ({ name: `coverage-${index}`, kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", Math.min(start, source.length), Math.min(cuts[index + 1], source.length)), fragment(f, "per_file_diff", Math.min(start, diff.length), Math.min(cuts[index + 1], diff.length))] }));
    const cross = { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, 1), fragment(f, "per_file_diff", 0, 1)], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }])) };
    const value = slicedPlan({ ...f, files: ["src.mjs"] }, [...slices, cross]); const installed = path.join(f.dir, "scripts", "cold-review-gemini.sh"), wrapperFingerprint = spawnSync("bash", [installed, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", "--fingerprint"], { cwd: f.dir, encoding: "utf8" }); assert.equal(wrapperFingerprint.status, 0, wrapperFingerprint.stderr);
    value.approval = { status: "APPROVED", by: "pm", expected_plan_id: JSON.parse(wrapperFingerprint.stdout).plan_id }; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
    let calls = 0; globalThis.fetch = async (_url, request) => { calls++; return responseFrom(request); }; await run(sliceArgs(f, "--run-slices")); assert.equal(calls, slices.length + 1);
  }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("installed wrapper runs approved fragments through its copied entrypoint and records aggregate GO", () => {
  const f = fixture({ withInstalledWrapper: true, candidateSource: `export const payload = "${"x".repeat(110000)}";\n` }), support = mkdtempSync(path.join(os.tmpdir(), "gemini-installed-wrapper-")), marker = path.join(support, "fetch-order.log"), preload = path.join(support, "fetch-preload.mjs"), psStub = path.join(support, "ps");
  try {
    const preloadSource = [
      'import { appendFileSync } from "node:fs";',
      'const marker = process.env.GEMINI_TEST_FETCH_MARKER;',
      'globalThis.fetch = async (_url, request) => {',
      '  const text = JSON.parse(request.body).contents[0].parts[0].text;',
      '  const scope = text.match(/=== NORMALIZED INSPECTED SCOPE ===\\n([^\\n]+)/)[1];',
      '  appendFileSync(marker, `${JSON.parse(scope).slice}\\n`);',
      '  const markers = [...text.matchAll(/PIL-INGEST-(?:HEAD|MIDDLE|EOF)-[0-9a-f]+/g)].map(match => match[0]);',
      '  const done = text.match(/PIL-DONE-[0-9a-f]+/)[0];',
      '  return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: `findings\\nVERDICT: GO\\nINSPECTED SCOPE: ${scope}\\nINGESTION PROOF: ${markers.join(" | ")}\\n${done}` }] } }] }) };',
      '};',
    ].join("\n");
    writeFileSync(preload, preloadSource);
    writeFileSync(psStub, "#!/bin/sh\nprintf 'Thu Jan 01 00:00:00 1970\\n'\n"); chmodSync(psStub, 0o755);
    const sourceLength = Buffer.byteLength(`export const payload = "${"x".repeat(110000)}";\n`), diffLength = Buffer.byteLength(execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", "src.mjs"])), cuts = [0, 30000, 60000, 90000, Math.max(sourceLength, diffLength)], slices = cuts.slice(0, -1).map((start, index) => ({ name: `coverage-${index}`, kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", Math.min(start, sourceLength), Math.min(cuts[index + 1], sourceLength)), fragment(f, "per_file_diff", Math.min(start, diffLength), Math.min(cuts[index + 1], diffLength))] }));
    const cross = { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, 1), fragment(f, "per_file_diff", 0, 1)], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }])) };
    const value = slicedPlan({ ...f, files: ["src.mjs"] }, [...slices, cross]), installed = path.join(f.dir, "scripts", "cold-review-gemini.sh");
    writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
    const fingerprint = spawnSync("bash", [installed, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", "--fingerprint"], { cwd: f.dir, encoding: "utf8" });
    assert.equal(fingerprint.status, 0, fingerprint.stderr);
    value.approval = { status: "APPROVED", by: "pm", expected_plan_id: JSON.parse(fingerprint.stdout).plan_id }; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
    const result = spawnSync("bash", [installed, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", "--run-slices"], { cwd: f.dir, encoding: "utf8", env: { ...process.env, PATH: `${support}:${process.env.PATH}`, GEMINI_API_KEY: "test-key", GEMINI_TEST_FETCH_MARKER: marker, NODE_OPTIONS: `--import=${preload}` } });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(readFileSync(marker, "utf8").trim().split("\n"), [...slices.map(slice => slice.name), "cross"]);
    const log = readFileSync(path.join(f.dir, "docs/journal/gemini_review_log.md"), "utf8"); assert.match(log, /Record-Kind: `SLICE_SET`[\s\S]*Release-Gate: `YES`[\s\S]*Gate-Verdict: `GO`[\s\S]*Aggregate-Result-SHA256/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); rmSync(support, { recursive: true, force: true }); }
});
test("overlapping installed fragment wrappers honor the live direct single-flight lock", async () => {
  const f = fixture({ withInstalledWrapper: true, candidateSource: `export const payload = "${"x".repeat(110000)}";\n` }), support = mkdtempSync(path.join(os.tmpdir(), "gemini-installed-wrapper-")), marker = path.join(support, "fetch-order.log"), release = path.join(support, "release-fetch"), preload = path.join(support, "fetch-preload.mjs"), psStub = path.join(support, "ps");
  let first = null, firstExit = null;
  try {
    writeFileSync(preload, [
      'import { appendFileSync, existsSync } from "node:fs";',
      'const marker = process.env.GEMINI_TEST_FETCH_MARKER, release = process.env.GEMINI_TEST_RELEASE_FILE;',
      'globalThis.fetch = async (_url, request) => {',
      '  const text = JSON.parse(request.body).contents[0].parts[0].text, scope = text.match(/=== NORMALIZED INSPECTED SCOPE ===\\n([^\\n]+)/)[1];',
      '  appendFileSync(marker, `${JSON.parse(scope).slice}\\n`);',
      '  while (!existsSync(release)) await new Promise(resolve => setTimeout(resolve, 10));',
      '  const markers = [...text.matchAll(/PIL-INGEST-(?:HEAD|MIDDLE|EOF)-[0-9a-f]+/g)].map(match => match[0]), done = text.match(/PIL-DONE-[0-9a-f]+/)[0];',
      '  return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: `findings\\nVERDICT: GO\\nINSPECTED SCOPE: ${scope}\\nINGESTION PROOF: ${markers.join(" | ")}\\n${done}` }] } }] }) };',
      '};',
    ].join("\n"));
    writeFileSync(psStub, "#!/bin/sh\nprintf 'Thu Jan 01 00:00:00 1970\\n'\n"); chmodSync(psStub, 0o755);
    const diffLength = Buffer.byteLength(execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", "src.mjs"])), sourceLength = Buffer.byteLength(`export const payload = "${"x".repeat(110000)}";\n`), cuts = [0, 30000, 60000, 90000, Math.max(sourceLength, diffLength)], slices = cuts.slice(0, -1).map((start, index) => ({ name: `coverage-${index}`, kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", Math.min(start, sourceLength), Math.min(cuts[index + 1], sourceLength)), fragment(f, "per_file_diff", Math.min(start, diffLength), Math.min(cuts[index + 1], diffLength))] }));
    const cross = { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [fragment(f, "frozen_source", 0, 1), fragment(f, "per_file_diff", 0, 1)], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }])) };
    const value = slicedPlan({ ...f, files: ["src.mjs"] }, [...slices, cross]), installed = path.join(f.dir, "scripts", "cold-review-gemini.sh"); writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
    const fingerprint = spawnSync("bash", [installed, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", "--fingerprint"], { cwd: f.dir, encoding: "utf8" }); assert.equal(fingerprint.status, 0, fingerprint.stderr);
    value.approval = { status: "APPROVED", by: "pm", expected_plan_id: JSON.parse(fingerprint.stdout).plan_id }; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
    const frozenArgs = [installed, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--slice-manifest", "plan.json", "--run-slices"], env = { ...process.env, PATH: `${support}:${process.env.PATH}`, GEMINI_API_KEY: "test-key", GEMINI_TEST_FETCH_MARKER: marker, GEMINI_TEST_RELEASE_FILE: release, NODE_OPTIONS: `--import=${preload}` };
    first = spawn("bash", frozenArgs, { cwd: f.dir, env, stdio: ["ignore", "ignore", "pipe"] }); firstExit = new Promise(resolve => first.on("close", (code, signal) => resolve({ code, signal })));
    for (let attempt = 0; attempt < 200 && !existsSync(marker); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(existsSync(marker), "first wrapper did not reach the provider stub"); const lock = path.join(path.resolve(f.dir, git(f.dir, ["rev-parse", "--git-common-dir"])), "cold-review-gemini.lock"); assert.match(readFileSync(path.join(lock, "owner"), "utf8"), /\nkind=direct\n/);
    const second = spawnSync("bash", frozenArgs, { cwd: f.dir, env, encoding: "utf8" }); assert.equal(second.status, 4, second.stderr); assert.match(second.stderr, /live direct frozen invocation owns this repository gate/); assert.equal(readFileSync(marker, "utf8").trim().split("\n").length, 1);
    writeFileSync(release, "release\n"); const exit = await firstExit; assert.equal(exit.code, 0, `first wrapper exited ${exit.code} (${exit.signal || "no signal"})`); assert.deepEqual(readFileSync(marker, "utf8").trim().split("\n"), [...slices.map(slice => slice.name), "cross"]);
    assert.match(readFileSync(path.join(f.dir, "docs/journal/gemini_review_log.md"), "utf8"), /Record-Kind: `SLICE_SET`[\s\S]*Release-Gate: `YES`[\s\S]*Gate-Verdict: `GO`/);
  } finally { writeFileSync(release, "release\n"); if (first && firstExit) await Promise.race([firstExit, new Promise(resolve => setTimeout(() => { first.kill("SIGTERM"); resolve(); }, 1000))]); rmSync(f.dir, { recursive: true, force: true }); rmSync(support, { recursive: true, force: true }); }
});
test("reordered, duplicate, and missing slice coverage plans refuse before fetch", () => {
  const f = multiFixture(); try {
    const ordered = slicedPlan(f), final = ordered.slices.at(-1); ordered.slices = [final, ...ordered.slices.slice(0, -1)]; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(ordered)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
    const duplicate = slicedPlan(f); duplicate.slices[1].files = ["src.mjs"]; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(duplicate)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
    const missing = slicedPlan(f); missing.slices = missing.slices.filter(slice => slice.name !== "coverage-slice-2.mjs"); writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(missing)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("direct and slice validators share lexical case and punctuation ordering", () => {
  const f = fixture(); try {
    for (const file of ["A.mjs", "a-punct.mjs", "_punct.mjs", "10.mjs", "2.mjs"]) writeFileSync(path.join(f.dir, file), `export const ${file.replace(/[^A-Za-z]/g, "_")} = true;\n`);
    git(f.dir, ["add", "."]); git(f.dir, ["commit", "-qm", "lexical paths"]);
    Object.assign(f, refreshed(f), { files: ["A.mjs", "a-punct.mjs", "_punct.mjs", "10.mjs", "2.mjs", "src.mjs"] }); slicedPlan(f);
    const direct = spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }); assert.equal(direct.status, 0, direct.stderr);
    const out = mkdtempSync(path.join(os.tmpdir(), "gemini-slice-order-")); try {
      const slices = spawnSync(process.execPath, [path.join(root, "scripts", "gemini-gate-slices.mjs"), "fingerprint", "--repo", f.dir, "--manifest", path.join(f.dir, "plan.json"), "--out-dir", out], { encoding: "utf8" }); assert.equal(slices.status, 0, slices.stderr);
    } finally { rmSync(out, { recursive: true, force: true }); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("public selftest and installed runner remain deterministic and network-free", () => {
  const selftest = spawnSync("bash", [wrapper, "--selftest"], { cwd: root, encoding: "utf8" }); assert.equal(selftest.status, 0, selftest.stderr); assert.match(selftest.stdout, /no network/);
  const tuple = [git(root, ["rev-parse", "HEAD~1"]), git(root, ["rev-parse", "HEAD"]), git(root, ["rev-parse", "HEAD^{tree}"])];
  const mixed = spawnSync("bash", [wrapper, "--base", tuple[0], "--candidate", tuple[1], "--tree", tuple[2], "--rig-id", "selftest-rig", "--context", "core/GATES.md", "--selftest"], { cwd: root, encoding: "utf8", env: { ...process.env, [syntheticEnvKey]: ["unread", "test", "key"].join("-") } }); assert.equal(mixed.status, 2); assert.match(mixed.stderr, /--selftest does not accept/);
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-frozen-install-")); try {
    git(dir, ["init", "-q"]); const installed = spawnSync(process.execPath, [path.join(root, "bin", "init.mjs"), "--target", dir, "--repo-name", "fixture", "--owner-name", "Fixture", "--with-gate-runners", "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr); assert.ok(existsSync(path.join(dir, "scripts", "gemini-frozen-gate.mjs")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
