// v2.35.0 — the gate-ladder sensor's T2 line carries the landed doctrine's lens clause verbatim:
// core/WORKFLOW.md § Steer's T2 row says the cross-family lens is REQUIRED on an action-flagged change,
// and a sensor that printed "[if available]" would tell an agent the opposite at every gate.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the T2 ladder the sensor surfaces carries WORKFLOW.md's lens clause exactly, flagged case included", () => {
  const row = readFileSync(path.join(KIT, "core", "WORKFLOW.md"), "utf8").split("\n").find((l) => l.startsWith("| **T2** |"));
  const clause = /cross-family lens \[[^\]]*\]/.exec(row)?.[0];
  assert.equal(clause, "cross-family lens [if avail; REQUIRED if flagged]", "the doctrine row this sensor transcribes");
  const dir = mkdtempSync(path.join(os.tmpdir(), "ladder-t2-"));
  try {
    mkdirSync(path.join(dir, ".claude"));
    writeFileSync(path.join(dir, ".claude", "task-lane.json"),
      JSON.stringify({ mode: "in-thread", sessionId: "s1", taskId: "ladder-task", tier: "T2" }));
    const r = spawnSync(process.execPath, [path.join(KIT, "hooks", "guard-gate-ladder.mjs")], {
      cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      input: JSON.stringify({ session_id: "s1", tool_input: { command: "bash scripts/codex-gate.sh -m x" } }),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /REQUIRED LADDER for T2/, "the declared T2 ladder is the one surfaced");
    assert.ok(r.stdout.includes(clause), `the surfaced T2 ladder carries "${clause}"`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
