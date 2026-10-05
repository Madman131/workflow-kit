// v2.44.0 — the gate-ladder sensor's T2 line carries the landed doctrine verbatim:
// core/WORKFLOW.md § Steer's T2 row says a standard T2 is two cold seats from different families,
// and § Steer's action-flag paragraph says a flag (or declared stakes) ADDS the full depth with the
// cross-family lens REQUIRED. A sensor that printed the retired panel, or "[if avail]" on a flagged
// change, would tell an agent the opposite at every gate.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the T2 ladder the sensor surfaces carries WORKFLOW.md's seat clause and its flagged-depth clause exactly", () => {
  const workflow = readFileSync(path.join(KIT, "core", "WORKFLOW.md"), "utf8");
  const row = workflow.split("\n").find((l) => l.startsWith("| **T2** |"));
  const clause = /\*\*(2 cold seats, [^*]*)\*\*/.exec(row)?.[1];
  assert.equal(clause, "2 cold seats, different families, one the free adversary", "the doctrine row this sensor transcribes");
  const flagged = "≥2 angles + free, a REQUIRED cross-family lens";
  assert.ok(workflow.replaceAll("**", "").includes(flagged), "the doctrine paragraph this sensor transcribes for flagged work");
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
    assert.ok(r.stdout.includes(flagged), `the surfaced T2 ladder carries "${flagged}"`);
    assert.ok(!r.stdout.includes("cold panel (≥2 angle seats"), "the retired standard-T2 panel is not surfaced");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
