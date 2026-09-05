import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run, verifyResponse } from "../scripts/gemini-frozen-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), runner = path.join(root, "scripts", "gemini-frozen-gate.mjs"), wrapper = path.join(root, "scripts", "cold-review-gemini.sh");
function git(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim(); }
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-frozen-gate-"));
  git(dir, ["init", "-q"]); git(dir, ["config", "user.email", "test@example.invalid"]); git(dir, ["config", "user.name", "Test"]);
  mkdirSync(path.join(dir, "core"), { recursive: true }); mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "core", "INVARIANTS.md"), "portable invariant\n"); writeFileSync(path.join(dir, "core", "REPO_INVARIANTS.md"), "repo invariant\n");
  writeFileSync(path.join(dir, "docs", "contract.md"), "acceptance context\n"); writeFileSync(path.join(dir, "unchanged.md"), "UNRELATED-SENTINEL\n"); writeFileSync(path.join(dir, "src.mjs"), "export const before = 1;\n");
  git(dir, ["add", "."]); git(dir, ["commit", "-qm", "base"]); const base = git(dir, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(dir, "src.mjs"), "export const after = 2;\n"); git(dir, ["add", "."]); git(dir, ["commit", "-qm", "candidate"]);
  return { dir, base, candidate: git(dir, ["rev-parse", "HEAD"]), tree: git(dir, ["rev-parse", "HEAD^{tree}"]) };
}
function args(f, extra = []) { return ["--repo", f.dir, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "test-rig", "--context", "docs/contract.md", ...extra]; }
function dry(f, extra = []) { return spawnSync(process.execPath, [runner, ...args(f, ["--dry-run", ...extra])], { encoding: "utf8" }); }
function responseFrom(request, verdict = "GO") {
  const text = JSON.parse(request.body).contents[0].parts[0].text;
  const scope = text.match(/=== NORMALIZED INSPECTED SCOPE ===\n([^\n]+)\n\n=== END/)[1];
  const markers = [...text.matchAll(/PIL-INGEST-(?:HEAD|MIDDLE|EOF)-[0-9a-f]+/g)].map(match => match[0]);
  return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: `findings\nVERDICT: ${verdict}\nINSPECTED SCOPE: ${scope}\nINGESTION PROOF: ${markers.join(" | ")}` }] } }] }) };
}
async function withFetch(fn) {
  const previousFetch = globalThis.fetch, previousKey = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "test-key";
  try { return await fn(); } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; process.exitCode = 0; }
}
function plan(f, mutate = {}) {
  const base = { version: 2, approval: { status: "DRAFT", by: "pm", expected_plan_id: "" }, scope: { base_commit: f.base, candidate_commit: f.candidate, candidate_tree: f.tree, files: ["src.mjs"] }, uncovered: [], slices: [{ name: "coverage", kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"] }, { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], boundaries: Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }])) }] };
  Object.assign(base, mutate); const file = path.join(f.dir, "plan.json"); writeFileSync(file, JSON.stringify(base)); return file;
}
function multiFixture() {
  const f = fixture(), files = ["src.mjs"];
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
test("response firewall refuses old mixed parts, conflicting verdicts, and incomplete proof", () => {
  const e = { scope: "{\"slice\":\"full\"}", markers: ["PIL-INGEST-HEAD-a", "PIL-INGEST-MIDDLE-b", "PIL-INGEST-EOF-c"] };
  const text = `VERDICT: GO\nINSPECTED SCOPE: ${e.scope}\nINGESTION PROOF: ${e.markers.join(" | ")}`;
  assert.equal(verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }, e).verdict, "GO");
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text, thought: "old runner accepted this" }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: `${text}\nVERDICT: NO-GO` }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: text.replace(e.markers[2], "missing") }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: text.replace("VERDICT: GO", "VERDICT: go") }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "" }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text }] } }] }, e));
  assert.doesNotMatch(readFileSync(runner, "utf8"), /\bagy\b/);
});
test("live no-log is refused before fetch", async () => {
  const f = fixture(); try { await withFetch(async () => { let calls = 0; globalThis.fetch = async () => { calls += 1; return responseFrom({ body: "{}" }); }; await assert.rejects(run(args(f, ["--no-log"]))); assert.equal(calls, 0); }); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("verified GO and NO-GO print and persist complete records", async () => {
  const f = fixture(); try { await withFetch(async () => {
    globalThis.fetch = async (_url, request) => { assert.doesNotMatch(JSON.parse(request.body).contents[0].parts[0].text, /UNRELATED-SENTINEL/); return responseFrom(request, "GO"); }; let printed = "", write = process.stdout.write; process.stdout.write = value => { printed += value; return true; };
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
test("reordered, duplicate, and missing slice coverage plans refuse before fetch", () => {
  const f = multiFixture(); try {
    const ordered = slicedPlan(f), final = ordered.slices.at(-1); ordered.slices = [final, ...ordered.slices.slice(0, -1)]; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(ordered)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
    const duplicate = slicedPlan(f); duplicate.slices[1].files = ["src.mjs"]; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(duplicate)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
    const missing = slicedPlan(f); missing.slices = missing.slices.filter(slice => slice.name !== "coverage-slice-2.mjs"); writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(missing)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("public selftest and installed runner remain deterministic and network-free", () => {
  const selftest = spawnSync("bash", [wrapper, "--selftest"], { cwd: root, encoding: "utf8" }); assert.equal(selftest.status, 0, selftest.stderr); assert.match(selftest.stdout, /no network/);
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-frozen-install-")); try {
    git(dir, ["init", "-q"]); const installed = spawnSync(process.execPath, [path.join(root, "bin", "init.mjs"), "--target", dir, "--repo-name", "fixture", "--owner-name", "Fixture", "--with-gate-runners", "--skip-codex-prompt", "--skip-codex-lane"], { encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr); assert.ok(existsSync(path.join(dir, "scripts", "gemini-frozen-gate.mjs")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
