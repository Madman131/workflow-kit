// workflow-kit — tests for SEAT COVERAGE (v2.41.0): `scripts/codex-gate.sh --expect-files FILE`.
// A cross-family seat that never opened the code writes a fluent verdict and an INSPECTED SCOPE line all the same, so the
// gate MEASURES what was opened from the `codex exec --json` event stream. Both polarities:
//   · a seat that opened every expected file exits 0; a seat that left one unopened, or produced no events, exits 3 "UNDER-READ: no verdict";
//   · without the option nothing changes;
//   · the matcher is keyed on REAL records: tests/fixtures/codex-exec-*-events.jsonl are cut from real `codex exec --json` runs
//     (codex-cli 0.159.2; docs/journal/2026-10-01-codex-exec-events-receipt.md), commands verbatim, outputs trimmed to sample lines.
// A fake `codex` replays the fixture; no network, no model.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(KIT, "scripts", "codex-gate.sh");
const FIX = path.join(KIT, "tests", "fixtures");
const FILES = JSON.parse(readFileSync(path.join(FIX, "codex-exec-read-files.json"), "utf8"));
const READ_EVENTS = path.join(FIX, "codex-exec-read-events.jsonl");
const DEVNULL_EVENTS = path.join(FIX, "codex-exec-devnull-events.jsonl");

const FAKE = `#!/usr/bin/env bash
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
prompt="$(cat)"
receipt="$(printf '%s\\n' "$prompt" | sed -n 's/^RECEIPT: //p' | tail -n 1)"
printf 'Review.\\nVERDICT: GO\\nINSPECTED SCOPE: everything\\nRECEIPT: %s\\n' "$receipt" > "$out"
if [ -n "\${FAKE_EVENTS:-}" ] && [ -f "$FAKE_EVENTS" ]; then cat "$FAKE_EVENTS"; fi
`;

function rig(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-seat-"));
  const repo = path.join(dir, "repo"), bin = path.join(dir, "bin");
  mkdirSync(repo); mkdirSync(bin);
  for (const [rel, lines] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), lines.join("\n") + "\n");
  }
  writeFileSync(path.join(bin, "codex"), FAKE); chmodSync(path.join(bin, "codex"), 0o755);
  writeFileSync(path.join(dir, "prompt.txt"), "Review the files.\n");
  return { dir, repo, bin };
}
function gate(r, events, listPaths, extra = []) {
  let list = [];
  if (listPaths) { writeFileSync(path.join(r.dir, "list.txt"), listPaths.join("\n") + "\n"); list = ["--expect-files", path.join(r.dir, "list.txt")]; }
  const env = { ...process.env, PATH: `${r.bin}:${process.env.PATH}`, FAKE_EVENTS: events || "" };
  const out = spawnSync("bash", [GATE, "-o", path.join(r.dir, "out.txt"), "-m", "test", "-e", "low", "-C", r.repo, ...list, ...extra, "-f", path.join(r.dir, "prompt.txt")], { encoding: "utf8", env });
  return out;
}
const cleanup = (r) => rmSync(r.dir, { recursive: true, force: true });

test("the shipped selftest passes (synthetic records in the observed shape)", () => {
  const r = spawnSync("bash", [GATE, "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\d+ passed, 0 failed/);
});

test("REAL read events: a seat that opened all five files passes; one unopened file is UNDER-READ, exit 3", () => {
  const paths = Object.keys(FILES);
  const r = rig({ ...FILES, "core/WORKFLOW.md": ["a line of a file the seat never opened", "another distinct unread line here", "a third distinct unread line here"] });
  try {
    const ok = gate(r, READ_EVENTS, paths);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stderr, /seat coverage OK/);
    const bad = gate(r, READ_EVENTS, [...paths, "core/WORKFLOW.md"]);
    assert.equal(bad.status, 3, bad.stderr);
    assert.match(bad.stderr, /UNDER-READ: no verdict/);
    assert.match(bad.stderr, /^  core\/WORKFLOW\.md$/m, "the missing path is printed");
    for (const p of paths) assert.doesNotMatch(bad.stderr, new RegExp(`^  ${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `${p} was opened and is not listed`);
    const none = gate(r, "", paths);
    assert.equal(none.status, 3, "no events at all");
    assert.match(none.stderr, /UNDER-READ: no verdict/);
    const plain = gate(r, READ_EVENTS, null);
    assert.equal(plain.status, 0, "without --expect-files nothing changes");
    assert.doesNotMatch(plain.stderr, /seat coverage/);
  } finally { cleanup(r); }
});

test("REAL trap: a command that NAMES the files but discards their output opens nothing", () => {
  // codex-exec-devnull-events.jsonl: one real run where the seat ran `sed -n … file >/dev/null; …` for three files, then answered.
  const r = rig({
    VERSION: ["2.40.0"],
    "core/WORKFLOW.md": ["a distinct workflow line number one", "a distinct workflow line number two", "a distinct workflow line number three"],
    "hooks/sensor-stop-notice.mjs": ["a distinct sensor line number one", "a distinct sensor line number two", "a distinct sensor line number three"],
    "PORTABILITY.md": ["a distinct portability line number one", "a distinct portability line number two", "a distinct portability line number three"],
  });
  try {
    const res = gate(r, DEVNULL_EVENTS, ["VERSION", "core/WORKFLOW.md", "hooks/sensor-stop-notice.mjs", "PORTABILITY.md"]);
    assert.equal(res.status, 3, res.stderr);
    assert.match(res.stderr, /UNDER-READ: no verdict/);
    for (const p of ["core/WORKFLOW.md", "hooks/sensor-stop-notice.mjs", "PORTABILITY.md"]) assert.ok(res.stderr.includes(`  ${p}`), `${p} listed as unopened`);
    assert.doesNotMatch(res.stderr, /^  VERSION$/m, "VERSION really was read (its one line is in the output)");
  } finally { cleanup(r); }
});

test("usage errors exit 2 before any model call: empty list, escaping path, --resume", () => {
  const r = rig({ "a.txt": ["alpha alpha alpha alpha"] });
  try {
    assert.equal(gate(r, "", []).status, 2, "empty list");
    assert.match(gate(r, "", []).stderr, /names no paths/);
    assert.equal(gate(r, "", ["../x.txt"]).status, 2, "escaping path");
    assert.equal(gate(r, "", ["a.txt"], ["--resume", "some-thread"]).status, 2, "warm round");
  } finally { cleanup(r); }
});
