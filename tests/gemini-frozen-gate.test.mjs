import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run, verifyResponse } from "../scripts/gemini-frozen-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), runner = path.join(root, "scripts", "gemini-frozen-gate.mjs"), wrapper = path.join(root, "scripts", "cold-review-gemini.sh"), journal = "docs/journal/gemini_review_log.md";
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
function git(dir, args, encoding = "utf8") { return execFileSync("git", ["-C", dir, ...args], { encoding }).trim(); }
function fixture(options = false) {
  const { installed = false, baseSource = "export const before = 1;\n", candidateSource = "export const after = 2;\n" } = typeof options === "boolean" ? { installed: options } : options;
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-manual-handoff-"));
  git(dir, ["init", "-q"]); git(dir, ["config", "user.email", "test@example.invalid"]); git(dir, ["config", "user.name", "Test"]);
  mkdirSync(path.join(dir, "core"), { recursive: true }); mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "core", "INVARIANTS.md"), "portable invariant\n"); writeFileSync(path.join(dir, "core", "REPO_INVARIANTS.md"), "repo invariant\n"); writeFileSync(path.join(dir, "docs", "contract.md"), "acceptance context\n"); writeFileSync(path.join(dir, "src.mjs"), baseSource);
  if (installed) { mkdirSync(path.join(dir, "scripts")); for (const name of ["cold-review-gemini.sh", "gemini-frozen-gate.mjs", "gemini-gate-supervisor.mjs"]) writeFileSync(path.join(dir, "scripts", name), readFileSync(path.join(root, "scripts", name))); chmodSync(path.join(dir, "scripts/cold-review-gemini.sh"), 0o755); }
  git(dir, ["add", "."]); git(dir, ["commit", "-qm", "base"]); const base = git(dir, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(dir, "src.mjs"), candidateSource); git(dir, ["add", "."]); git(dir, ["commit", "-qm", "candidate"]);
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
function invoke(f, extra = [], env = process.env) { return spawnSync(process.execPath, [runner, ...args(f, extra)], { encoding: "utf8", env }); }
function exportHandoff(f) { manifest(f); const result = invoke(f, ["--slice-manifest", "plan.json", "--handoff-export", ".gemini-gate/handoff"]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
function reply(packet, verdict) {
  const scope = packet.match(/=== NORMALIZED INSPECTED SCOPE ===\n([^\n]+)/)[1], markers = [...packet.matchAll(/PIL-INGEST-(?:HEAD|MIDDLE|EOF)-[0-9a-f]+/g)].map(match => match[0]), done = packet.match(/PIL-DONE-[0-9a-f]+/)[0];
  return `finding\nVERDICT: ${verdict}\nINSPECTED SCOPE: ${scope}\nINGESTION PROOF: ${markers.join(" | ")}\n${done}\n`;
}
function packets(f) { const root = path.join(f.dir, ".gemini-gate", "handoff"); return JSON.parse(readFileSync(path.join(root, "handoff.json"), "utf8")).packets.map(item => readFileSync(path.join(root, "packets", item.filename), "utf8")); }
function replies(f, verdicts) { const dir = path.join(f.dir, ".gemini-gate", "handoff", "replies"); for (const [index, verdict] of verdicts.entries()) writeFileSync(path.join(dir, `${String(index + 1).padStart(4, "0")}.txt`), reply(packets(f)[index], verdict)); }
function importHandoff(f) { return invoke(f, ["--slice-manifest", "plan.json", "--handoff-import", ".gemini-gate/handoff"]); }
function dry(f, extra = []) { return invoke(f, ["--context", "docs/contract.md", "--dry-run", ...extra]); }
function fakeAgy({ hang = false, termIgnoringWriter = false, omitToolPermission = false, toolPermission = "request-review", initPermissionMode = "request-review", initEffort, stepUsage, terminalUsage } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fake-agy-")), home = path.join(dir, "home"), binary = path.join(dir, "agy"), settings = path.join(home, ".gemini", "antigravity-cli", "settings.json");
  mkdirSync(path.dirname(settings), { recursive: true });
  writeFileSync(settings, JSON.stringify({ ...(omitToolPermission ? {} : { toolPermission }), allowNonWorkspaceAccess: false, permissions: { allow: [] } }));
  writeFileSync(binary, `#!/usr/bin/env node
let input=""; const initEffort = ${JSON.stringify(initEffort)}, initPermissionMode = ${JSON.stringify(initPermissionMode)}, stepUsage = ${JSON.stringify(stepUsage)}, terminalUsage = ${JSON.stringify(terminalUsage)}; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => { if (process.argv.includes("--version")) return; if (${hang}) return setInterval(() => {}, 1000); if (${termIgnoringWriter}) { process.on("SIGTERM", () => {}); return setInterval(() => process.stdout.write("x".repeat(65536)), 1); } const prompt = JSON.parse(input).message.content, scope = prompt.match(/=== NORMALIZED INSPECTED SCOPE ===\\n([^\\n]+)/)[1], markers = [...prompt.matchAll(/PIL-INGEST-(?:HEAD|MIDDLE|EOF)-[0-9a-f]+/g)].map(match => match[0]), done = prompt.match(/PIL-DONE-[0-9a-f]+/)[0], model = process.argv[process.argv.indexOf("--model") + 1], response = "finding\\nVERDICT: GO\\nINSPECTED SCOPE: " + scope + "\\nINGESTION PROOF: " + markers.join(" | ") + "\\n" + done; console.log(JSON.stringify({ event: "init", conversation_id: "fake", init: { cwd: process.cwd(), tools: [], permission_mode: initPermissionMode, model, ...(initEffort === undefined ? {} : { effort: initEffort }) } })); console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: "fake", step_index: 0, state: "DONE", step_type: "user_input", ...(stepUsage === undefined ? {} : { usage: stepUsage }) } })); console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: "fake", step_index: 1, state: "DONE", step_type: "agent_response", text_delta: response, ...(stepUsage === undefined ? {} : { usage: stepUsage }) } })); console.log(JSON.stringify({ event: "result", result: { conversation_id: "fake", status: "SUCCESS", response, duration_seconds: 0, num_turns: 1, ...(terminalUsage === undefined ? {} : { usage: terminalUsage }) } })); }); if (process.argv.includes("--version")) console.log("1.2.2");\n`);
  chmodSync(binary, 0o755);
  const ps = path.join(dir, "ps"); writeFileSync(ps, "#!/bin/sh\ncase \"$*\" in *lstart=*) echo 'Mon Sep  1 00:00:00 2026' ;; *command=*) echo 'fake-supervisor' ;; esac\n"); chmodSync(ps, 0o755);
  return { env: { ...process.env, HOME: home, PATH: `${dir}:${process.env.PATH}` }, home, settings, binary, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
function controlledAgy() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "controlled-agy-")), home = path.join(dir, "home"), binary = path.join(dir, "agy"), settings = path.join(home, ".gemini", "antigravity-cli", "settings.json"), events = path.join(dir, "events"), releaseVersion = path.join(dir, "release-version"), releaseFirst = path.join(dir, "release-first"), phase = path.join(dir, "phase"), ps = path.join(dir, "ps");
  mkdirSync(path.dirname(settings), { recursive: true }); writeFileSync(settings, JSON.stringify({ toolPermission: "request-review", allowNonWorkspaceAccess: false, permissions: { allow: [] } })); writeFileSync(events, "");
  writeFileSync(phase, "bash\n"); writeFileSync(ps, "#!/bin/sh\npid=\"$2\"\ncase \"$*\" in *lstart=*) printf 'start-%s\\n' \"$pid\" ;; *command=*) printf '%s-%s\\n' \"$(cat \"$(dirname \"$0\")/phase\")\" \"$pid\" ;; esac\n"); chmodSync(ps, 0o755);
  writeFileSync(binary, `#!/usr/bin/env node
import fs from "node:fs"; const events = ${JSON.stringify(events)}, releaseVersion = ${JSON.stringify(releaseVersion)}, releaseFirst = ${JSON.stringify(releaseFirst)}, phase = ${JSON.stringify(phase)}; const mark = value => fs.appendFileSync(events, value + "\\n"); if (process.argv.includes("--version")) { fs.writeFileSync(phase, "node\\n"); mark("version"); const wait = () => fs.existsSync(releaseVersion) ? (console.log("1.2.2"), process.exit(0)) : setTimeout(wait, 10); wait(); } else { let input = ""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => { const count = fs.readFileSync(events, "utf8").split("\\n").filter(value => value === "provider").length + 1; mark("provider"); const respond = () => { const prompt = JSON.parse(input).message.content, scope = prompt.match(/=== NORMALIZED INSPECTED SCOPE ===\\n([^\\n]+)/)[1], markers = [...prompt.matchAll(/PIL-INGEST-(?:HEAD|MIDDLE|EOF)-[0-9a-f]+/g)].map(match => match[0]), done = prompt.match(/PIL-DONE-[0-9a-f]+/)[0], model = process.argv[process.argv.indexOf("--model") + 1], response = "finding\\nVERDICT: GO\\nINSPECTED SCOPE: " + scope + "\\nINGESTION PROOF: " + markers.join(" | ") + "\\n" + done; console.log(JSON.stringify({ event: "init", conversation_id: "controlled", init: { cwd: process.cwd(), tools: [], permission_mode: "request-review", model } })); console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: "controlled", step_index: 0, state: "DONE", step_type: "user_input" } })); console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: "controlled", step_index: 1, state: "DONE", step_type: "agent_response", text_delta: response } })); console.log(JSON.stringify({ event: "result", result: { conversation_id: "controlled", status: "SUCCESS", response, duration_seconds: 0, num_turns: 1 } })); }; if (count === 1) { const wait = () => fs.existsSync(releaseFirst) ? respond() : setTimeout(wait, 10); wait(); return; } if (count === 2) { process.on("SIGTERM", () => mark("term")); return setInterval(() => {}, 1000); } respond(); }); }\n`);
  chmodSync(binary, 0o755);
  return { env: { ...process.env, HOME: home, PATH: `${dir}:${process.env.PATH}` }, binary, events, releaseVersion, releaseFirst, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
async function eventually(check, timeout = 5000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } assert.fail("timed out waiting for asynchronous runner state"); }
function gateLock(f) { return path.join(path.resolve(f.dir, git(f.dir, ["rev-parse", "--git-common-dir"])), "cold-review-gemini.lock"); }
function eventsOf(controlled, name) { return readFileSync(controlled.events, "utf8").split("\n").filter(value => value === name).length; }
function ownerFields(lock) { return Object.fromEntries(readFileSync(path.join(lock, "owner"), "utf8").trim().split("\n").map(line => line.split(/=(.*)/s))); }
function psValue(env, pid, field) { return execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], { encoding: "utf8", env }).trim(); }
function assertLiveSupervisor(lock, env) {
  const text = readFileSync(path.join(lock, "owner"), "utf8"), owner = Object.fromEntries(text.trim().split("\n").map(line => line.split(/=(.*)/s)));
  for (const key of ["supervisor_pid", "supervisor_start", "supervisor_command"]) assert.equal((text.match(new RegExp(`^${key}=`, "gm")) || []).length, 1, `${key} is replaced, not appended`);
  assert.equal(psValue(env, owner.supervisor_pid, "lstart"), owner.supervisor_start);
  assert.equal(psValue(env, owner.supervisor_pid, "command"), owner.supervisor_command);
  return owner;
}
function generated(f, output = ".gemini-gate/generated/manifest.json") { const result = invoke(f, ["--context", "docs/contract.md", "--generate-slice-plan", output]); assert.equal(result.status, 0, result.stderr); return { result: JSON.parse(result.stdout), output, plan: JSON.parse(readFileSync(path.join(f.dir, output), "utf8")) }; }
function componentBytes(f, fragment) { return fragment.component_kind === "per_file_diff" ? execFileSync("git", ["-C", f.dir, "diff", "--no-ext-diff", "--no-textconv", "--unified=80", f.base, f.candidate, "--", fragment.path]) : execFileSync("git", ["-C", f.dir, "show", `${fragment.component_kind === "deleted_source" ? f.base : f.candidate}:${fragment.path}`]); }
function assertPartitions(f, plan) {
  const fragments = plan.slices.filter(slice => slice.kind === "coverage").flatMap(slice => slice.fragments);
  for (const key of new Set(fragments.map(item => `${item.path}\0${item.component_kind}`))) { const group = fragments.filter(item => `${item.path}\0${item.component_kind}` === key), bytes = componentBytes(f, group[0]); let offset = 0; for (const item of group) { assert.equal(item.byte_start, offset, `${key} ordered`); if (item.byte_start) assert.notEqual(bytes[item.byte_start] & 0xc0, 0x80); if (item.byte_end < bytes.length) assert.notEqual(bytes[item.byte_end] & 0xc0, 0x80); offset = item.byte_end; } assert.equal(offset, bytes.length, `${key} complete`); }
}

test("exact tuple, clean endpoint, regular manifest, and symlink inputs fail closed", () => {
  const f = fixture(); try {
    assert.notEqual(dry(f, ["--tree", "0".repeat(40)]).status, 0);
    writeFileSync(path.join(f.dir, "outside.txt"), "dirty\n"); assert.notEqual(dry(f).status, 0); rmSync(path.join(f.dir, "outside.txt"));
    writeFileSync(path.join(f.dir, "plan.json"), "{}"); assert.notEqual(invoke(f, ["--slice-manifest", "plan.json", "--fingerprint"]).status, 0); rmSync(path.join(f.dir, "plan.json"));
    symlinkSync("docs/contract.md", path.join(f.dir, "plan.json")); assert.notEqual(invoke(f, ["--slice-manifest", "plan.json", "--fingerprint"]).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("current and deleted Basic or Token credential-like material refuses before envelope output", () => {
  const authorization = (scheme, state) => ["Authorization:", scheme, `${state}-${["secret", "value"].join("-")}`].join(" ") + "\n";
  const cases = [
    fixture({ candidateSource: authorization("Basic", "current") }), fixture({ candidateSource: authorization("Token", "current") }),
    fixture({ baseSource: authorization("Basic", "deleted"), candidateSource: "export const removed = true;\n" }), fixture({ baseSource: authorization("Token", "deleted"), candidateSource: "export const removed = true;\n" })
  ];
  try { for (const f of cases) assert.notEqual(dry(f).status, 0, `credential accepted in ${f.dir}`); } finally { for (const f of cases) rmSync(f.dir, { recursive: true, force: true }); }
});
test("response proof firewall rejects altered scope, markers, completion, and mixed output", () => {
  const e = { scope: "{\"slice\":\"proof\"}", markers: ["PIL-INGEST-HEAD-a", "PIL-INGEST-MIDDLE-b", "PIL-INGEST-EOF-c"], done: "PIL-DONE-proof" }, text = `VERDICT: GO\nINSPECTED SCOPE: ${e.scope}\nINGESTION PROOF: ${e.markers.join(" | ")}\n${e.done}`;
  assert.equal(verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }, e).verdict, "GO");
  for (const altered of [text.replace(e.scope, "{}"), text.replace(e.markers[2], "missing"), text.replace(e.done, ""), `${text}\nVERDICT: NO-GO`]) assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: altered }] } }] }, e));
  assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text, functionCall: { name: "forbidden" } }] } }] }, e));
});
test("generator stays cap-measured, UTF-8 safe, ordered, deterministic, and blocks DRAFT fingerprinting", () => {
  const baseLines = Array.from({ length: 2400 }, (_, index) => `export const value_${index} = \"${"é".repeat(12)}\";\n`), candidateLines = [...baseLines]; for (const index of [100, 400, 700, 1000, 1300, 1600, 1900, 2200]) candidateLines[index] = candidateLines[index].replace("é", "a");
  const f = fixture({ baseSource: baseLines.join(""), candidateSource: candidateLines.join("") }); try {
    const first = generated(f), again = generated(f); assert.deepEqual(again.plan, first.plan); assert.ok(first.result.envelopes.every(item => item.envelope_bytes < 81920)); assert.ok(first.result.coverage_call_count > 1); assert.equal(first.plan.slices.at(-1).draft.state, "NEEDS_HUMAN_CROSS_BOUNDARY"); assertPartitions(f, first.plan); assert.equal(existsSync(path.join(f.dir, journal)), false);
    const fingerprint = invoke(f, ["--slice-manifest", first.output, "--fingerprint"]); assert.notEqual(fingerprint.status, 0); assert.match(fingerprint.stderr, /DRAFT cross-boundary placeholder/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("export is local-only and binds deterministic packets to the exact approved plan", () => {
  const f = fixture(); try {
    const source = readFileSync(runner, "utf8"); assert.doesNotMatch(source, /\bfetch\s*\(/); assert.doesNotMatch(source, /GEMINI_API_KEY/);
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
test("an exact durable prefix is reused and only missing handoff receipts are appended", () => {
  const f = fixture(); try {
    exportHandoff(f); replies(f, ["GO", "GO", "GO"]); assert.equal(importHandoff(f).status, 0);
    const blocks = readFileSync(path.join(f.dir, journal), "utf8").split(/(?=^## Gemini frozen gate attempt — )/m).filter(block => block.startsWith("## Gemini frozen gate attempt — "));
    writeFileSync(path.join(f.dir, journal), blocks[0]); const retry = importHandoff(f); assert.equal(retry.status, 0, retry.stderr);
    const recovered = readFileSync(path.join(f.dir, journal), "utf8"); assert.equal((recovered.match(/Handoff-ID: `PIL-GEMINI-HANDOFF-/g) || []).length, 4); assert.equal((recovered.match(/Status: `PASS_VERDICT`/g) || []).length, 4);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("endpoint changes after slice receipts prevent the final release aggregate", async () => {
  const f = fixture(); try {
    exportHandoff(f); replies(f, ["GO", "GO", "GO"]);
    await assert.rejects(run(args(f, ["--slice-manifest", "plan.json", "--handoff-import", ".gemini-gate/handoff"]), { afterSliceReceipts: () => writeFileSync(path.join(f.dir, "outside.txt"), "dirty\n") }), /source checkout is dirty outside sanctioned artifacts/);
    const text = readFileSync(path.join(f.dir, journal), "utf8"); assert.equal((text.match(/Handoff-ID: `PIL-GEMINI-HANDOFF-/g) || []).length, 3); assert.doesNotMatch(text, /Record-Kind: `SLICE_SET`/); assert.doesNotMatch(text, /Release-Gate: `YES`/);
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
    const text = readFileSync(path.join(f.dir, journal), "utf8"); assert.match(text, /Slice: `coverage-diff`[\s\S]*Status: `NO_GO`|Status: `NO_GO`[\s\S]*Slice: `coverage-diff`/); assert.doesNotMatch(text, /Record-Kind: `SLICE_SET`/); const replay = importHandoff(f); assert.equal(replay.status, 3); assert.match(replay.stderr, /already has a complete durable receipt/);
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
test("automated subscription is the default, REST is refused, and the installed wrapper retains manual fallback", () => {
  const f = fixture(true), fake = fakeAgy(); try {
    assert.equal(invoke(f, ["--transport", "api"], fake.env).status, 3);
    manifest(f); const common = ["--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "manual-test", "--slice-manifest", "plan.json"], env = { ...fake.env, GEMINI_REVIEW_CONTEXT: "" }, automated = spawnSync("bash", ["scripts/cold-review-gemini.sh", ...common, "--run-slices", "--agy-bin", fake.binary], { cwd: f.dir, encoding: "utf8", env }); assert.equal(automated.status, 0, automated.stderr); const receipt = readFileSync(path.join(f.dir, journal), "utf8"); assert.match(receipt, /Transport: `antigravity-agy-subscription-stream-v2`/); assert.match(receipt, new RegExp(`settings-sha256:${sha(readFileSync(fake.settings))}`));
    manifest(f); const exported = spawnSync("bash", ["scripts/cold-review-gemini.sh", ...common, "--handoff-export", ".gemini-gate/wrapper-handoff"], { cwd: f.dir, encoding: "utf8", env }); assert.equal(exported.status, 0, exported.stderr);
    const handoff = path.join(f.dir, ".gemini-gate/wrapper-handoff"), state = JSON.parse(readFileSync(path.join(handoff, "handoff.json"), "utf8")); for (const item of state.packets) writeFileSync(path.join(handoff, "replies", item.filename), reply(readFileSync(path.join(handoff, "packets", item.filename), "utf8"), "GO"));
    const imported = spawnSync("bash", ["scripts/cold-review-gemini.sh", ...common, "--handoff-import", ".gemini-gate/wrapper-handoff"], { cwd: f.dir, encoding: "utf8", env }); assert.equal(imported.status, 0, imported.stderr); assert.match(readFileSync(path.join(f.dir, journal), "utf8"), /Slice: `aggregate`/);
    const mismatch = fixture(), wrongEffort = fakeAgy({ initEffort: "low" }); try { manifest(mismatch); const refused = invoke(mismatch, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", wrongEffort.binary], wrongEffort.env); assert.notEqual(refused.status, 0, refused.stderr); } finally { wrongEffort.cleanup(); rmSync(mismatch.dir, { recursive: true, force: true }); }
  } finally { fake.cleanup(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("pinned agy 1.2.2 accepts an absent settings posture only when runtime init proves request-review", () => {
  const f = fixture(), fake = fakeAgy({ omitToolPermission: true }); try {
    manifest(f); const result = invoke(f, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", fake.binary], fake.env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(path.join(f.dir, journal), "utf8"), /settings-sha256:/);
  } finally { fake.cleanup(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("permissive settings and non-request-review runtime init each refuse", () => {
  const permissive = fixture(), runtime = fixture(), permissiveFake = fakeAgy({ toolPermission: "allow-all" }), runtimeFake = fakeAgy({ omitToolPermission: true, initPermissionMode: "danger-full-access" }); try {
    manifest(permissive); const settingsRefusal = invoke(permissive, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", permissiveFake.binary], permissiveFake.env); assert.notEqual(settingsRefusal.status, 0); assert.match(settingsRefusal.stderr, /toolPermission must require request-review when present/);
    manifest(runtime); const runtimeRefusal = invoke(runtime, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", runtimeFake.binary], runtimeFake.env); assert.notEqual(runtimeRefusal.status, 0); assert.match(runtimeRefusal.stderr, /required disposable request-review rig/);
  } finally { permissiveFake.cleanup(); runtimeFake.cleanup(); rmSync(permissive.dir, { recursive: true, force: true }); rmSync(runtime.dir, { recursive: true, force: true }); }
});
test("agy usage admits only the closed token schema in direct and installed transport paths", () => {
  const usage = { input_tokens: 1, output_tokens: 2, thinking_tokens: 3, cache_read_tokens: 4, total_tokens: 10 }, good = fixture(), direct = fixture(), installed = fixture(true), goodFake = fakeAgy({ stepUsage: usage, terminalUsage: usage }), directFake = fakeAgy({ stepUsage: { tool_output: 1 } }), installedFake = fakeAgy({ terminalUsage: { ...usage, tool_output: 1 } }); try {
    manifest(good); assert.equal(invoke(good, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", goodFake.binary], goodFake.env).status, 0);
    manifest(direct); const directResult = invoke(direct, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", directFake.binary], directFake.env); assert.notEqual(directResult.status, 0); assert.match(directResult.stderr, /unrecognized step/);
    manifest(installed); const installedResult = spawnSync("bash", ["scripts/cold-review-gemini.sh", "--base", installed.base, "--candidate", installed.candidate, "--tree", installed.tree, "--rig-id", "manual-test", "--slice-manifest", "plan.json", "--run-slices", "--agy-bin", installedFake.binary], { cwd: installed.dir, encoding: "utf8", env: { ...installedFake.env, GEMINI_REVIEW_CONTEXT: "" } }); assert.notEqual(installedResult.status, 0); assert.match(installedResult.stderr, /not one clean successful result/);
  } finally { goodFake.cleanup(); directFake.cleanup(); installedFake.cleanup(); rmSync(good.dir, { recursive: true, force: true }); rmSync(direct.dir, { recursive: true, force: true }); rmSync(installed.dir, { recursive: true, force: true }); }
});
test("post-flight endpoint failure leaves no accepted automated provider result and records a diagnostic", async () => {
  const f = fixture(), fake = fakeAgy(), priorHome = process.env.HOME, priorPath = process.env.PATH; try {
    process.env.HOME = fake.env.HOME;
    process.env.PATH = fake.env.PATH;
    manifest(f);
    await assert.rejects(run(args(f, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", fake.binary]), { afterProviderResponse: () => writeFileSync(path.join(f.dir, "outside.txt"), "dirty\n") }), /source checkout is dirty outside sanctioned artifacts/);
    const receipt = readFileSync(path.join(f.dir, journal), "utf8"); assert.match(receipt, /Status: `FAILED_TRANSPORT`/); assert.doesNotMatch(receipt, /Status: `PASS_VERDICT`|Release-Gate: `YES`/);
  } finally { if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome; if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath; fake.cleanup(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("fake HOME settings identity is rechecked after a provider response before a receipt", async () => {
  const f = fixture(), fake = fakeAgy(), priorHome = process.env.HOME, priorPath = process.env.PATH; try {
    process.env.HOME = fake.env.HOME; process.env.PATH = fake.env.PATH; manifest(f);
    await assert.rejects(run(args(f, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", fake.binary]), { afterProviderResponse: () => writeFileSync(fake.settings, JSON.stringify({ toolPermission: "request-review", allowNonWorkspaceAccess: false, permissions: { allow: [], changed: true } })) }), /agy settings changed after subscription transport preflight/);
    const receipt = readFileSync(path.join(f.dir, journal), "utf8"); assert.match(receipt, /Status: `FAILED_TRANSPORT`/); assert.doesNotMatch(receipt, /Status: `PASS_VERDICT`/);
  } finally { if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome; if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath; fake.cleanup(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("fake HOME settings drift before aggregation prevents the aggregate receipt", async () => {
  const f = fixture(), fake = fakeAgy(), priorHome = process.env.HOME, priorPath = process.env.PATH; try {
    process.env.HOME = fake.env.HOME; process.env.PATH = fake.env.PATH; manifest(f);
    await assert.rejects(run(args(f, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", fake.binary]), { beforeAggregate: () => writeFileSync(fake.settings, JSON.stringify({ toolPermission: "request-review", allowNonWorkspaceAccess: false, permissions: { allow: [], aggregateChanged: true } })) }), /agy settings changed after subscription transport preflight/);
    const receipt = readFileSync(path.join(f.dir, journal), "utf8"); assert.equal((receipt.match(/Status: `PASS_VERDICT`/g) || []).length, 3); assert.doesNotMatch(receipt, /Record-Kind: `SLICE_SET`/);
  } finally { if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome; if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath; fake.cleanup(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("supervisor proves TERM-ignoring writer closure before releasing parent-loss ownership", async () => {
  const f = fixture(), fake = fakeAgy({ termIgnoringWriter: true }); try {
    manifest(f);
    const runnerProcess = spawn(process.execPath, [runner, ...args(f, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", fake.binary])], { env: fake.env, stdio: "ignore" });
    const common = path.resolve(f.dir, git(f.dir, ["rev-parse", "--git-common-dir"])), lock = path.join(common, "cold-review-gemini.lock");
    await eventually(() => existsSync(path.join(lock, "owner")) && /supervisor_pid=/.test(readFileSync(path.join(lock, "owner"), "utf8")));
    runnerProcess.kill("SIGKILL");
    await new Promise(resolve => runnerProcess.once("exit", resolve));
    const plan = JSON.parse(readFileSync(path.join(f.dir, "plan.json"), "utf8")), diagnostic = path.join(f.dir, ".gemini-gate", "diagnostics");
    await eventually(() => !existsSync(lock) && existsSync(diagnostic));
    const files = readdirSync(diagnostic); assert.equal(files.length, 1); const record = JSON.parse(readFileSync(path.join(diagnostic, files[0]), "utf8"));
    assert.equal(record.kind, "ABRUPT_PARENT_LOSS_UNVERIFIED"); assert.equal(record.non_verdict, true); assert.match(record.attempt_id, /^PIL-FROZEN-ATTEMPT-[0-9a-f]{24}$/); assert.deepEqual(record.frozen, { base: f.base, candidate: f.candidate, tree: f.tree }); assert.equal(record.plan_id, plan.approval.expected_plan_id); assert.equal(record.slice, "coverage-source"); assert.equal(record.transport.name, "antigravity-agy-subscription-stream-v2"); assert.equal(record.transport.identity, `1.2.2|settings-sha256:${sha(readFileSync(fake.settings))}|high`); assert.equal(record.verification.endpoint, "NOT_COMPLETED"); assert.equal(record.verification.workspace, "NOT_COMPLETED"); assert.doesNotMatch(readFileSync(path.join(f.dir, journal), "utf8"), /Gemini frozen gate attempt|PASS_VERDICT|FAILED_TOOL/);
  } finally { fake.cleanup(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("matching live frozen subscription ownership survives Bash-to-Node exec, later slices, and later parent-loss teardown", async () => {
  const f = fixture(true), controlled = controlledAgy(), command = ["scripts/cold-review-gemini.sh", "--base", f.base, "--candidate", f.candidate, "--tree", f.tree, "--rig-id", "manual-test", "--slice-manifest", "plan.json", "--run-slices", "--agy-bin", controlled.binary], lock = gateLock(f); let first, firstStderr = "";
  try {
    manifest(f); first = spawn("bash", command, { cwd: f.dir, env: { ...controlled.env, GEMINI_REVIEW_CONTEXT: "" }, stdio: ["ignore", "ignore", "pipe"] }); first.stderr.on("data", chunk => firstStderr += chunk);
    await eventually(() => { if (first.exitCode !== null) assert.fail(firstStderr); return eventsOf(controlled, "version") === 1 && existsSync(path.join(lock, "owner")); });
    const beforeSupervisor = readFileSync(path.join(lock, "owner"), "utf8"), beforeFields = ownerFields(lock);
    assert.equal(beforeFields.kind, "subscription"); assert.equal(beforeFields.pid, String(first.pid)); assert.equal(beforeFields.command, "frozen-subscription-exec"); assert.equal(psValue(controlled.env, first.pid, "command"), `node-${first.pid}`, "the Bash command changed after exec, so subscription kind is the stable contention identity"); assert.doesNotMatch(beforeSupervisor, /^supervisor_pid=/m);
    const early = spawnSync("bash", command, { cwd: f.dir, encoding: "utf8", env: { ...controlled.env, GEMINI_REVIEW_CONTEXT: "" } });
    assert.equal(early.status, 4, early.stderr); assert.match(early.stderr, /live frozen subscription invocation/); assert.equal(readFileSync(path.join(lock, "owner"), "utf8"), beforeSupervisor); assert.equal(eventsOf(controlled, "provider"), 0, "a contender cannot launch a provider before first supervisor publication");
    writeFileSync(controlled.releaseVersion, "release\n");
    await eventually(() => eventsOf(controlled, "provider") === 1 && /^supervisor_pid=/m.test(readFileSync(path.join(lock, "owner"), "utf8")));
    const firstSupervisor = assertLiveSupervisor(lock, controlled.env); writeFileSync(controlled.releaseFirst, "release\n");
    await eventually(() => eventsOf(controlled, "provider") === 2 && ownerFields(lock).supervisor_pid !== firstSupervisor.supervisor_pid);
    const laterSupervisor = assertLiveSupervisor(lock, controlled.env), duringLaterSlice = readFileSync(path.join(lock, "owner"), "utf8");
    const later = spawnSync("bash", command, { cwd: f.dir, encoding: "utf8", env: { ...controlled.env, GEMINI_REVIEW_CONTEXT: "" } });
    assert.equal(later.status, 4, later.stderr); assert.equal(readFileSync(path.join(lock, "owner"), "utf8"), duringLaterSlice); assert.equal(eventsOf(controlled, "provider"), 2, "a later-slice contender cannot replace ownership or launch a provider");
    first.kill("SIGKILL"); await new Promise(resolve => first.once("exit", resolve));
    await eventually(() => eventsOf(controlled, "term") === 1);
    const duringTeardown = readFileSync(path.join(lock, "owner"), "utf8"); assert.equal(assertLiveSupervisor(lock, controlled.env).supervisor_pid, laterSupervisor.supervisor_pid);
    const teardown = spawnSync("bash", command, { cwd: f.dir, encoding: "utf8", env: { ...controlled.env, GEMINI_REVIEW_CONTEXT: "" } });
    assert.equal(teardown.status, 4, teardown.stderr); assert.equal(readFileSync(path.join(lock, "owner"), "utf8"), duringTeardown); assert.equal(eventsOf(controlled, "provider"), 2, "a teardown contender cannot replace ownership or launch a provider");
    await eventually(() => !existsSync(lock));
  } finally { try { if (first?.exitCode === null) first.kill("SIGKILL"); } catch {} controlled.cleanup(); rmSync(f.dir, { recursive: true, force: true }); }
});
test("pipe capture caps a fast TERM-ignoring writer before process-group teardown", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gemini-supervisor-overflow-")), lock = path.join(dir, "lock"), capture = path.join(dir, "capture"), workspace = path.join(dir, "workspace"), bin = path.join(dir, "bin"), writer = path.join(dir, "writer.mjs"), stdout = path.join(capture, "stdout"), stderr = path.join(capture, "stderr"), pid = path.join(capture, "pid"), meta = path.join(capture, "meta"), attemptLog = path.join(dir, "attempt.log"), supervisor = path.join(root, "scripts", "gemini-gate-supervisor.mjs");
  try {
    mkdirSync(lock); mkdirSync(capture); mkdirSync(workspace); mkdirSync(bin); writeFileSync(path.join(lock, "owner"), `pid=${process.pid}\n`); writeFileSync(meta, "do_log=0\n"); writeFileSync(attemptLog, ""); writeFileSync(path.join(bin, "ps"), "#!/bin/sh\ncase \"$*\" in *lstart=*) echo 'Mon Sep  1 00:00:00 2026' ;; *command=*) echo 'test-supervisor' ;; esac\n"); chmodSync(path.join(bin, "ps"), 0o755);
    writeFileSync(writer, "import process from 'node:process'; process.on('SIGTERM', () => {}); setInterval(() => process.stdout.write('x'.repeat(65536)), 1);\n");
    const result = spawnSync(process.execPath, [supervisor, "--timeout-seconds", "20", "--grace-seconds", "1", "--stdout", stdout, "--stderr", stderr, "--stdout-limit", "1024", "--stderr-limit", "1024", "--capture-dir", capture, "--pid-file", pid, "--parent-pid", String(process.pid), "--temp-dir", workspace, "--lock-dir", lock, "--parent-loss-meta", meta, "--parent-loss-diagnostic", path.join(dir, "parent-loss.json"), "--", process.execPath, writer], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 3, result.stderr);
    assert.equal(existsSync(stdout), true, result.stderr);
    assert.ok(statSync(stdout).size <= 1024, "stdout file never exceeds its configured byte cap");
    assert.ok(statSync(stderr).size <= 1024, "stderr file never exceeds its configured byte cap");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("success, timeout, and overflow release the gate only after observed process-group closure", () => {
  const cases = [
    { fake: fakeAgy(), args: [], status: 0 },
    { fake: fakeAgy({ hang: true }), args: ["--timeout-seconds", "1"], status: 3 },
    { fake: fakeAgy({ termIgnoringWriter: true }), args: [], status: 3 },
  ];
  for (const item of cases) {
    const f = fixture(); try {
      manifest(f); const result = invoke(f, ["--slice-manifest", "plan.json", "--run-slices", "--agy-bin", item.fake.binary, ...item.args], item.fake.env);
      assert.equal(result.status, item.status, result.stderr);
      assert.equal(existsSync(gateLock(f)), false, "runner releases only after supervisor observes its owned process-group closed");
    } finally { item.fake.cleanup(); rmSync(f.dir, { recursive: true, force: true }); }
  }
});
test("public wrapper refuses an unresolved supervisor lock instead of stale-reclaiming it", () => {
  const f = fixture(true); try {
    const common = path.resolve(f.dir, git(f.dir, ["rev-parse", "--git-common-dir"])), lock = path.join(common, "cold-review-gemini.lock");
    mkdirSync(lock); writeFileSync(path.join(lock, "owner"), `pid=999999\nrepo=${common}\nsupervisor_state=UNRESOLVED_PROCESS_GROUP\n`);
    const bin = path.join(f.dir, "test-bin"); mkdirSync(bin); writeFileSync(path.join(bin, "ps"), "#!/bin/sh\ncase \"$*\" in *lstart=*) echo 'Mon Sep  1 00:00:00 2026' ;; *command=*) echo 'test-runner' ;; esac\n"); chmodSync(path.join(bin, "ps"), 0o755);
    const result = spawnSync("bash", ["scripts/cold-review-gemini.sh", "--design", "docs/contract.md", "--no-log"], { cwd: f.dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 4, result.stderr);
    assert.match(result.stderr, /unresolved supervisor process-group ownership/);
    assert.equal(existsSync(lock), true);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
test("subscription PID reuse recovers stale ownership while matching subscription and direct owners stay live", () => {
  const cases = [
    { kind: "subscription", ownerStart: "current-start", currentStart: "current-start", status: 4, retained: true },
    { kind: "subscription", ownerStart: "prior-start", currentStart: "current-start", status: undefined, retained: false },
    { kind: "direct", ownerStart: "", currentStart: "current-start", status: 4, retained: true },
  ];
  for (const item of cases) {
    const f = fixture(true); let owner;
    try {
      owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      const lock = gateLock(f), bin = path.join(f.dir, "identity-bin"); mkdirSync(lock); mkdirSync(bin);
      writeFileSync(path.join(bin, "ps"), "#!/bin/sh\npid=\nfor arg do case \"$arg\" in *[0-9]*) pid=$arg ;; esac; done\ncase \"$*\" in *lstart=*) printf '%s-%s\\n' \"$TEST_OWNER_START\" \"$pid\" ;; *command=*) printf 'owner-command-%s\\n' \"$pid\" ;; esac\n"); chmodSync(path.join(bin, "ps"), 0o755);
      writeFileSync(path.join(lock, "owner"), `pid=${owner.pid}\n${item.ownerStart ? `start=${item.ownerStart}-${owner.pid}\n` : ""}repo=${realpathSync(path.dirname(lock))}\nkind=${item.kind}\ncommand=prior-owner\n`);
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_OWNER_START: item.currentStart, GEMINI_AGY_BIN: path.join(f.dir, "missing-agy") };
      assert.doesNotThrow(() => process.kill(owner.pid, 0));
      assert.equal(psValue(env, owner.pid, "lstart"), `${item.currentStart}-${owner.pid}`);
      const result = spawnSync("bash", ["scripts/cold-review-gemini.sh", "--design", "docs/contract.md", "--no-log"], { cwd: f.dir, encoding: "utf8", env });
      if (item.status !== undefined) { assert.equal(result.status, item.status, `${item.kind}: ${result.stderr}`); assert.match(result.stderr, new RegExp(`live frozen ${item.kind} invocation`)); assert.equal(existsSync(lock), item.retained); }
      else { assert.notEqual(result.status, 4, result.stderr); assert.match(result.stderr, /recovered stale single-flight guard/); assert.equal(existsSync(lock), false); }
    } finally { owner?.kill(); rmSync(f.dir, { recursive: true, force: true }); }
  }
});
test("portable frozen-Gemini surfaces name automated subscription and manual fallback without REST", () => {
  const surfaces = ["README.md", "PORTABILITY.md", "core/GATES.md", "core/REPO_INVARIANTS.md", "templates/BINDINGS.md.tmpl", "docs/uncle-handoff/CODEX_ADOPTION_TICKET.md"];
  for (const file of surfaces) {
    const text = readFileSync(path.join(root, file), "utf8");
    assert.match(text, /subscription/i, `${file} names the subscription route`);
    assert.match(text, /manual/i, `${file} retains manual fallback`);
  }
  assert.match(readFileSync(path.join(root, "core/GATES.md"), "utf8"), /REST\/API transport is unavailable/);
  assert.doesNotMatch(readFileSync(path.join(root, "scripts/gemini-frozen-gate.mjs"), "utf8"), /GEMINI_API_KEY/);
});

test("subscription transport keeps secrets, unbounded capture, and malformed execution streams outside its admitted path", () => {
  const runnerSource = readFileSync(runner, "utf8"), supervisorSource = readFileSync(path.join(root, "scripts/gemini-gate-supervisor.mjs"), "utf8");
  assert.match(runnerSource, /function subscriptionEnv\(\)/);
  assert.match(runnerSource, /env = subscriptionEnv\(\)/, "the version probe resolves one reduced environment");
  assert.match(runnerSource, /env: transport\.env/, "the provider receives that same reduced environment");
  assert.doesNotMatch(runnerSource, /env: process\.env/, "ambient provider secrets are not forwarded");
  assert.doesNotMatch(runnerSource, /GEMINI_AGY_SETTINGS/, "the production transport cannot override its sanitized-HOME settings path");
  assert.match(runnerSource, /\.gemini", "antigravity-cli", "settings\.json"/);
  assert.match(runnerSource, /recheckSubscriptionSettings\(transport\)/);
  assert.match(supervisorSource, /exceeded bounded capture limit/);
  assert.match(supervisorSource, /capture-dir/);
  assert.match(supervisorSource, /stdio: \[forwardStdin \? process\.stdin : "ignore", "pipe", "pipe"\]/);
  assert.match(supervisorSource, /captureOutput\("stdout", chunk\)/);
  assert.match(supervisorSource, /observeClosureThenFinish/);
  assert.match(runnerSource, /invalid step lifecycle/);
  assert.match(runnerSource, /onlyKeys\(step, allowed\)/);
  assert.match(runnerSource, /prior\.state !== "ACTIVE" \|\| !\["ACTIVE", "DONE"\]\.includes\(step\.state\)/, "a streaming agent-response index may repeat ACTIVE before its one DONE");
});

test("ordinary design mode acquires and releases its owner record before agy discovery", () => {
  const f = fixture(true); try {
    const bin = path.join(f.dir, "test-bin"); mkdirSync(bin);
    writeFileSync(path.join(bin, "ps"), "#!/bin/sh\ncase \"$*\" in *lstart=*) echo 'Mon Sep  1 00:00:00 2026' ;; *command=*) echo 'test-runner' ;; esac\n");
    chmodSync(path.join(bin, "ps"), 0o755);
    const result = spawnSync("bash", ["scripts/cold-review-gemini.sh", "--design", "docs/contract.md", "--no-log"],
      { cwd: f.dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GEMINI_AGY_BIN: path.join(f.dir, "missing-agy") } });
    assert.equal(result.status, 127, result.stderr);
    assert.doesNotMatch(result.stderr, /cannot write single-flight owner record/);
    const commonDir = path.resolve(f.dir, git(f.dir, ["rev-parse", "--git-common-dir"]));
    assert.equal(existsSync(path.join(commonDir, "cold-review-gemini.lock")), false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
