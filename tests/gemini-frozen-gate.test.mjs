import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), runner = path.join(root, "scripts", "gemini-frozen-gate.mjs"), wrapper = path.join(root, "scripts", "cold-review-gemini.sh"), journal = "docs/journal/gemini_review_log.md";
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
function git(dir, args, encoding = "utf8") { return execFileSync("git", ["-C", dir, ...args], { encoding }).trim(); }
function fixture(installed = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-manual-handoff-"));
  git(dir, ["init", "-q"]); git(dir, ["config", "user.email", "test@example.invalid"]); git(dir, ["config", "user.name", "Test"]);
  mkdirSync(path.join(dir, "core"), { recursive: true }); mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "core", "INVARIANTS.md"), "portable invariant\n"); writeFileSync(path.join(dir, "core", "REPO_INVARIANTS.md"), "repo invariant\n"); writeFileSync(path.join(dir, "docs", "contract.md"), "acceptance context\n"); writeFileSync(path.join(dir, "src.mjs"), "export const before = 1;\n");
  if (installed) { mkdirSync(path.join(dir, "scripts")); for (const name of ["cold-review-gemini.sh", "gemini-frozen-gate.mjs"]) writeFileSync(path.join(dir, "scripts", name), readFileSync(path.join(root, "scripts", name))); chmodSync(path.join(dir, "scripts/cold-review-gemini.sh"), 0o755); }
  git(dir, ["add", "."]); git(dir, ["commit", "-qm", "base"]); const base = git(dir, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(dir, "src.mjs"), "export const after = 2;\n"); git(dir, ["add", "."]); git(dir, ["commit", "-qm", "candidate"]);
  return { dir, base, candidate: git(dir, ["rev-parse", "HEAD"]), tree: git(dir, ["rev-parse", "HEAD^{tree}"]) };
}
function component(f, kind) {
  const bytes = kind === "frozen_source" ? execFileSync("git", ["-C", f.dir, "show", `${f.candidate}:src.mjs`]) : execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", "src.mjs"]);
  return { base_commit: f.base, candidate_commit: f.candidate, candidate_tree: f.tree, path: "src.mjs", component_kind: kind, component_byte_length: bytes.length, component_sha256: sha(bytes), byte_start: 0, byte_end: bytes.length, fragment_sha256: sha(bytes) };
}
function manifest(f) {
  const source = component(f, "frozen_source"), diff = component(f, "per_file_diff"), boundaries = Object.fromEntries(["public_contract", "storage_migration", "write_path", "read_path", "doctor_parity"].map(name => [name, { status: "covered", scope_files: ["src.mjs"], contract_context: [], rationale: "reviewed" }]));
  const value = { version: 2, approval: { status: "DRAFT", by: "pm", expected_plan_id: "" }, scope: { base_commit: f.base, candidate_commit: f.candidate, candidate_tree: f.tree, files: ["src.mjs"] }, uncovered: [], slices: [
    { name: "coverage-source", kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [source] },
    { name: "coverage-diff", kind: "coverage", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [diff] },
    { name: "cross", kind: "cross_boundary", files: ["src.mjs"], contract_context: ["docs/contract.md"], fragments: [source, diff], boundaries }
  ] };
  writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
  const finger = invoke(f, ["--slice-manifest", "plan.json", "--fingerprint"]); assert.equal(finger.status, 0, finger.stderr); value.approval = { status: "APPROVED", by: "pm", expected_plan_id: JSON.parse(finger.stdout).plan_id }; writeFileSync(path.join(f.dir, "plan.json"), JSON.stringify(value));
}
function args(f, extra = []) { return ["--repo", f.dir, "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "manual-test", ...extra]; }
function invoke(f, extra = []) { return spawnSync(process.execPath, [runner, ...args(f, extra)], { encoding: "utf8" }); }
function exportHandoff(f) { manifest(f); const result = invoke(f, ["--slice-manifest", "plan.json", "--handoff-export", ".gemini-gate/handoff"]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
function reply(packet, verdict) {
  const scope = packet.match(/=== NORMALIZED INSPECTED SCOPE ===\n([^\n]+)/)[1], markers = [...packet.matchAll(/PIL-INGEST-(?:HEAD|MIDDLE|EOF)-[0-9a-f]+/g)].map(match => match[0]), done = packet.match(/PIL-DONE-[0-9a-f]+/)[0];
  return `finding\nVERDICT: ${verdict}\nINSPECTED SCOPE: ${scope}\nINGESTION PROOF: ${markers.join(" | ")}\n${done}\n`;
}
function packets(f) { const root = path.join(f.dir, ".gemini-gate", "handoff"); return JSON.parse(readFileSync(path.join(root, "handoff.json"), "utf8")).packets.map(item => readFileSync(path.join(root, "packets", item.filename), "utf8")); }
function replies(f, verdicts) { const dir = path.join(f.dir, ".gemini-gate", "handoff", "replies"); for (const [index, verdict] of verdicts.entries()) writeFileSync(path.join(dir, `${String(index + 1).padStart(4, "0")}.txt`), reply(packets(f)[index], verdict)); }
function importHandoff(f) { return invoke(f, ["--slice-manifest", "plan.json", "--handoff-import", ".gemini-gate/handoff"]); }

test("export is local-only and binds deterministic packets to the exact approved plan", () => {
  const f = fixture(); try {
    const source = readFileSync(runner, "utf8"); assert.doesNotMatch(source, /\bfetch\s*\(/); assert.doesNotMatch(source, /\bspawn\s*\(/); assert.doesNotMatch(source, /antigravity-cli|GEMINI_API_KEY/);
    const output = exportHandoff(f), handoff = JSON.parse(readFileSync(path.join(f.dir, ".gemini-gate/handoff/handoff.json"), "utf8"));
    assert.match(output.handoff_id, /^PIL-GEMINI-HANDOFF-[0-9a-f]{24}$/); assert.equal(handoff.tuple.candidate, f.candidate); assert.equal(handoff.plan_id.length, 64); assert.equal(handoff.manual_transport.model, "gemini-3.1-pro-high"); assert.equal(handoff.packets.length, 3); assert.equal(existsSync(path.join(f.dir, journal)), false); assert.deepEqual(readdirSync(path.join(f.dir, ".gemini-gate/handoff/replies")), []);
    assert.ok(handoff.packets.every(item => item.prompt_sha256 === sha(readFileSync(path.join(f.dir, ".gemini-gate/handoff/packets", item.filename)))));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("all verified manual GO replies append ordered receipts and aggregate GO, then refuse replay", () => {
  const f = fixture(); try {
    exportHandoff(f); replies(f, ["GO", "GO", "GO"]); const result = importHandoff(f); assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(path.join(f.dir, journal), "utf8"); assert.equal((text.match(/Status: `PASS_VERDICT`/g) || []).length, 4); assert.match(text, /Release-Gate: `YES`/); assert.match(text, /Slice: `aggregate`/); assert.match(text, /Handoff-ID: `PIL-GEMINI-HANDOFF-/); const replay = importHandoff(f); assert.equal(replay.status, 3); assert.match(replay.stderr, /already has a complete durable receipt/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("source-only NO-GO is retained as attribution hold after later GO replies", () => {
  const f = fixture(); try {
    exportHandoff(f); replies(f, ["NO-GO", "GO", "GO"]); const result = importHandoff(f); assert.equal(result.status, 3, result.stderr);
    const text = readFileSync(path.join(f.dir, journal), "utf8"); assert.match(text, /Status: `UNRESOLVED_ATTRIBUTION`/); assert.match(text, /Status: `ATTRIBUTION_HOLD`/); assert.doesNotMatch(text, /Slice: `aggregate`[\s\S]*Release-Gate: `YES`/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("a final supplied diff NO-GO is terminal and permits no aggregate", () => {
  const f = fixture(); try {
    exportHandoff(f); replies(f, ["GO", "NO-GO"]); const result = importHandoff(f); assert.equal(result.status, 3, result.stderr);
    const text = readFileSync(path.join(f.dir, journal), "utf8"); assert.match(text, /Slice: `coverage-diff`[\s\S]*Status: `NO_GO`|Status: `NO_GO`[\s\S]*Slice: `coverage-diff`/); assert.doesNotMatch(text, /Record-Kind: `SLICE_SET`/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("tampered packets and incomplete, nonterminal replies fail before journal mutation", () => {
  const f = fixture(), g = fixture(); try {
    exportHandoff(f); writeFileSync(path.join(f.dir, ".gemini-gate/handoff/packets/0001.txt"), "tampered\n"); const tampered = importHandoff(f); assert.equal(tampered.status, 3); assert.equal(existsSync(path.join(f.dir, journal)), false);
    exportHandoff(g); replies(g, ["NO-GO"]); const partial = importHandoff(g); assert.equal(partial.status, 3); assert.equal(existsSync(path.join(g.dir, journal)), false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); rmSync(g.dir, { recursive: true, force: true }); }
});
test("tampered state, tuple, plan, endpoint, and reply enumeration fail before journal mutation", () => {
  const cases = [
    f => { const file = path.join(f.dir, ".gemini-gate/handoff/handoff.json"), value = JSON.parse(readFileSync(file, "utf8")); value.tuple.candidate = "0".repeat(40); writeFileSync(file, JSON.stringify(value)); },
    f => { const file = path.join(f.dir, "plan.json"), value = JSON.parse(readFileSync(file, "utf8")); value.approval.expected_plan_id = "0".repeat(64); writeFileSync(file, JSON.stringify(value)); },
    f => { replies(f, ["GO", "GO", "GO"]); writeFileSync(path.join(f.dir, ".gemini-gate/handoff/replies/0004.txt"), "extra\n"); },
    f => { replies(f, ["GO"]); writeFileSync(path.join(f.dir, ".gemini-gate/handoff/replies/0002.txt"), reply(packets(f)[1], "GO")); },
    f => { writeFileSync(path.join(f.dir, "outside.txt"), "dirty\n"); }
  ];
  for (const mutate of cases) { const f = fixture(); try { exportHandoff(f); mutate(f); const result = importHandoff(f); assert.notEqual(result.status, 0, result.stderr); assert.equal(existsSync(path.join(f.dir, journal)), false); } finally { rmSync(f.dir, { recursive: true, force: true }); } }
  const linked = fixture(); try { exportHandoff(linked); const packetsDir = path.join(linked.dir, ".gemini-gate/handoff/packets"), saved = path.join(linked.dir, ".gemini-gate/handoff/packets-real"); renameSync(packetsDir, saved); symlinkSync("packets-real", packetsDir); const result = importHandoff(linked); assert.equal(result.status, 3); assert.equal(existsSync(path.join(linked.dir, journal)), false); } finally { rmSync(linked.dir, { recursive: true, force: true }); }
});
test("retired automated flags refuse before access and the installed wrapper forwards manual handoff", () => {
  const f = fixture(true); try {
    for (const flag of [["--transport", "api"], ["--run-slices"], ["--agy-bin", "ignored"], ["--timeout-seconds", "1"]]) { const result = invoke(f, flag); assert.equal(result.status, 3, result.stderr); }
    manifest(f); const result = spawnSync("bash", ["scripts/cold-review-gemini.sh", "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "manual-test", "--slice-manifest", "plan.json", "--handoff-export", ".gemini-gate/wrapper-handoff"], { cwd: f.dir, encoding: "utf8", env: { ...process.env, GEMINI_REVIEW_CONTEXT: "" } }); assert.equal(result.status, 0, result.stderr); assert.ok(existsSync(path.join(f.dir, ".gemini-gate/wrapper-handoff/handoff.json")));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
