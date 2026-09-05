import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run, verifyResponse } from "../scripts/gemini-frozen-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), runner = path.join(root, "scripts", "gemini-frozen-gate.mjs"), wrapper = path.join(root, "scripts", "cold-review-gemini.sh");
const syntheticEnvKey = ["GEMINI", "API", "KEY"].join("_");
function syntheticAssignment(labelParts, valueParts) { return ["export const ", labelParts.join("_"), " = '", valueParts.join(""), "';\n"].join(""); }
function git(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim(); }
function fixture({ contextSymlink = false, invariantSymlink = false, noDocs = false, baseSource = "export const before = 1;\n", candidateSource = "export const after = 2;\n" } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-frozen-gate-"));
  git(dir, ["init", "-q"]); git(dir, ["config", "user.email", "test@example.invalid"]); git(dir, ["config", "user.name", "Test"]);
  mkdirSync(path.join(dir, "core"), { recursive: true }); if (!noDocs) mkdirSync(path.join(dir, "docs"), { recursive: true });
  if (invariantSymlink) { writeFileSync(path.join(dir, "invariant-target.md"), "portable invariant\n"); symlinkSync("../invariant-target.md", path.join(dir, "core", "INVARIANTS.md")); } else writeFileSync(path.join(dir, "core", "INVARIANTS.md"), "portable invariant\n");
  writeFileSync(path.join(dir, "core", "REPO_INVARIANTS.md"), "repo invariant\n");
  if (!noDocs) { if (contextSymlink) { writeFileSync(path.join(dir, "contract-target.md"), "acceptance context\n"); symlinkSync("../contract-target.md", path.join(dir, "docs", "contract.md")); } else writeFileSync(path.join(dir, "docs", "contract.md"), "acceptance context\n"); }
  writeFileSync(path.join(dir, "unchanged.md"), "UNRELATED-SENTINEL\n"); writeFileSync(path.join(dir, "src.mjs"), baseSource);
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
  const secret = fixture({ baseSource: [syntheticAssignment(["API", "KEY"], ["reallysecretvalue"]), syntheticAssignment(["DB", "PASSWORD"], ["alsosecretvalue"])].join(""), candidateSource: "export const removed = true;\n" }), placeholder = fixture({ baseSource: ["export const ", ["DB", "PASSWORD"].join("_"), " = '${DB_PASSWORD}';\n"].join(""), candidateSource: "export const removed = true;\n" }); try { await withFetch(async () => {
    assert.notEqual(dry(secret).status, 0);
    let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("must not fetch"); }; await assert.rejects(run(args(secret))); assert.equal(calls, 0);
    assert.equal(dry(placeholder).status, 0);
  }); } finally { rmSync(secret.dir, { recursive: true, force: true }); rmSync(placeholder.dir, { recursive: true, force: true }); }
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
test("reordered, duplicate, and missing slice coverage plans refuse before fetch", () => {
  const f = multiFixture(); try {
    const ordered = slicedPlan(f), final = ordered.slices.at(-1); ordered.slices = [final, ...ordered.slices.slice(0, -1)]; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(ordered)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
    const duplicate = slicedPlan(f); duplicate.slices[1].files = ["src.mjs"]; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(duplicate)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
    const missing = slicedPlan(f); missing.slices = missing.slices.filter(slice => slice.name !== "coverage-slice-2.mjs"); writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(missing)); assert.notEqual(spawnSync(process.execPath, [runner, ...sliceArgs(f, "--fingerprint")], { encoding: "utf8" }).status, 0);
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
