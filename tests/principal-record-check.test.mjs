// v2.35.0 — the Principal record check at the recorder (write time). A Principal-route event is
// refused unless its authority_record is a git-TRACKED file of the repo that carries the
// decision_id as a whole token. The controller itself is unchanged; this pins the write path.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { recordEvent, principalRecordConfirmed } = await import(path.join(KIT, "scripts", "record-repair-event.mjs"));
const STATE = "principal-authority-record-unconfirmed";

function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "principal-record-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  mkdirSync(path.join(dir, "docs"));
  writeFileSync(path.join(dir, "docs", "program.md"), "# Record\n- `D-12` (Principal) ruling.\n- D-14. and (D-15)\nblank cell: (   )\n");
  git("add", "docs/program.md");
  git("commit", "-qm", "base");
  writeFileSync(path.join(dir, "docs", "untracked.md"), "D-12\n");
  symlinkSync("program.md", path.join(dir, "docs", "link.md"));
  git("add", "docs/link.md"); git("commit", "-qm", "link");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const ev = (evidence) => ({ type: "aggregate_v2", kind: "close", task_id: "t", changeset_id: "c",
  reason: "r", principal_evidence: evidence });
const pe = (authority_record, decision_id) => ({ authority_record, decision_id });

test("a Principal-route event is refused unless its record is a tracked file carrying the id as a token", () => {
  const { dir, cleanup } = repo();
  try {
    const refused = (evidence, why) => assert.equal(
      recordEvent(ev(evidence), { projectRoot: dir, sessionId: "s" }).state, STATE, why);
    refused("I am the principal", "a string principal_evidence");
    refused(["docs/program.md", "D-12"], "an array principal_evidence");
    refused(null, "a null principal_evidence");
    refused(pe("docs/program.md", ""), "an empty decision_id");
    refused(pe("docs/program.md", "   "), "a whitespace decision_id");
    refused(pe("docs/missing.md", "D-12"), "a record that does not exist");
    refused(pe("docs/untracked.md", "D-12"), "an untracked record");
    refused(pe(".git/config", "core"), "git plumbing is not a tracked record");
    refused(pe("docs/link.md", "D-12"), "a symlinked record, even a tracked one");
    refused(pe("../program.md", "D-12"), "a path escaping the repository");
    refused(pe(path.join(dir, "docs", "program.md"), "D-12"), "an absolute path");
    refused(pe("docs/program.md", "D-99"), "a tracked record without the id");
    refused(pe("docs/program.md", "D-1"), "an id that only occurs inside a longer token (D-1 in D-12)");
    for (const id of ["D-12", "D-14", "D-15"]) {
      const r = recordEvent(ev(pe("docs/program.md", id)), { projectRoot: dir, sessionId: "s" });
      assert.notEqual(r.state, STATE, `${id} is confirmed and the controller's own result is returned`);
    }
    const { principal_evidence: _drop, ...ownerEvent } = ev(null);
    const owner = recordEvent({ ...ownerEvent, owner_evidence: "Owner: go" }, { projectRoot: dir, sessionId: "s" });
    assert.notEqual(owner.state, STATE, "an owner_evidence event never meets the Principal check");
    assert.equal(principalRecordConfirmed(pe("docs/program.md", "D-12"), path.join(dir, "docs")), false,
      "the record resolves from the project root it is given; a wrong root finds no tracked file");
  } finally { cleanup(); }
});

test("the recorder CLI names the refusal and both fields", () => {
  const { dir, cleanup } = repo();
  try {
    const input = path.join(dir, "event.json");
    writeFileSync(input, JSON.stringify({ ...ev(pe("docs/untracked.md", "D-12")), session_id: "s" }));
    let err = "";
    try {
      execFileSync(process.execPath, [path.join(KIT, "scripts", "record-repair-event.mjs"), "--event", input],
        { cwd: dir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    } catch (e) { err = String(e.stderr); }
    assert.match(err, /principal-authority-record-unconfirmed/);
    assert.match(err, /authority_record names a git-TRACKED file/);
    assert.match(err, /decision_id appears in that file as a whole token/);
  } finally { cleanup(); }
});
