// v2.47.0 KIT-THREAD-HYGIENE: scripts/archive-plan.mjs is a PURE decision script. Each guard KEEPS its session with its
// reason, the cascade keeps a parent whose side session is unfinished, and nothing is planned without the Owner's yes.
// Fixtures are shaped like the host's real `list_sessions` entries; git states are real temp repos.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/archive-plan.mjs", import.meta.url));
const ME = "local_11111111-aaaa-4aaa-8aaa-111111111111";
const G = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"];
const git = (cwd, ...a) => execFileSync("git", [...G, "-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let seq = 0;
const sess = (over = {}) => {
  const n = ++seq;
  return {
    sessionId: `local_${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`, title: `Session ${n}`, cwd: "/nonexistent/worktree-removed",
    isArchived: false, isRunning: true, prNumber: 48, prState: "MERGED", lastActivityAt: "2026-11-21T18:56:45.580Z",
    name: `pm-thing-${n}`, startedBy: ME, ...over,
  };
};

function lab() {
  const root = mkdtempSync(path.join(os.tmpdir(), "archive-plan-"));
  const remote = path.join(root, "remote.git");
  git(root, "init", "-q", "--bare", remote);
  const clone = (name) => { const d = path.join(root, name); git(root, "clone", "-q", remote, d); return d; };
  const primary = clone("primary");
  writeFileSync(path.join(primary, "f.txt"), "x\n"); git(primary, "add", "f.txt"); git(primary, "commit", "-q", "-m", "init"); git(primary, "push", "-q", "origin", "HEAD:main"); git(primary, "fetch", "-q");
  const repos = {
    clean: primary,
    dirty: (() => { const d = clone("dirty"); git(d, "checkout", "-q", "-B", "main", "origin/main"); writeFileSync(path.join(d, "u.txt"), "u\n"); return d; })(),
    unpushed: (() => { const d = clone("unpushed"); git(d, "checkout", "-q", "-B", "main", "origin/main"); writeFileSync(path.join(d, "g.txt"), "g\n"); git(d, "add", "g.txt"); git(d, "commit", "-q", "-m", "local only"); return d; })(),
    noRemote: (() => { const d = path.join(root, "noremote"); mkdirSync(d); git(d, "init", "-q"); writeFileSync(path.join(d, "a"), "a"); git(d, "add", "a"); git(d, "commit", "-q", "-m", "c"); return d; })(),
    nonGit: (() => { const d = path.join(root, "plain"); mkdirSync(d); return d; })(),
  };
  const linked = (name) => { const d = path.join(root, name); git(primary, "worktree", "add", "-q", "-b", name, d, "origin/main"); return d; };
  return { root, repos, linked, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const run = (list, args = [], { env, stdin = true } = {}) => {
  const r = stdin
    ? spawnSync(process.execPath, [SCRIPT, "--json", ...args], { input: JSON.stringify(list), encoding: "utf8", env: env ?? process.env })
    : spawnSync(process.execPath, [SCRIPT, "--json", ...args], { encoding: "utf8", env: env ?? process.env });
  return { status: r.status, stderr: r.stderr, out: r.stdout ? JSON.parse(r.stdout) : null, raw: r.stdout };
};
const plan = (list, ids = [], extra = []) => run(list, ["--me", ME, "--owner-yes", ...ids.flatMap((i) => ["--done", i]), ...extra]).out;
const kept = (p, s) => p.keep.find((k) => k.sessionId === s.sessionId);
const archived = (p) => p.archive.map((a) => a.sessionId);

test("happy path: archives exactly the --done children, with names, ids and why", () => {
  const L = lab();
  try {
    const a = sess({ cwd: L.repos.clean }), b = sess({ cwd: L.repos.nonGit }), c = sess({ cwd: L.repos.clean }), notDone = sess({ cwd: L.repos.clean });
    const p = plan([a, b, c, notDone], [a.sessionId, b.sessionId, c.sessionId]);
    assert.equal(p.mode, "archive");
    assert.deepEqual(archived(p), [a.sessionId, b.sessionId, c.sessionId]);
    assert.equal(p.archive[0].name, a.name);
    assert.match(p.archive[0].why, /started by you; asserted landed and verified; its worktree is clean and pushed/);
    assert.match(p.archive[1].why, /not a git work tree/);
    assert.deepEqual(p.reportOnly, []);
    assert.equal(kept(p, notDone).why, "not asserted landed and verified");
  } finally { L.cleanup(); }
});

test("no --owner-yes: report-only, the would-archive set is listed and `archive` is empty", () => {
  const a = sess();
  const r = run([a], ["--me", ME, "--done", a.sessionId]);
  assert.equal(r.status, 0);
  assert.equal(r.out.mode, "report-only");
  assert.deepEqual(r.out.archive, []);
  assert.deepEqual(r.out.reportOnly.map((x) => x.sessionId), [a.sessionId]);
  assert.match(r.out.notes.join(" "), /no --owner-yes/);
  const text = spawnSync(process.execPath, [SCRIPT, "--me", ME, "--done", a.sessionId], { input: JSON.stringify([a]), encoding: "utf8" }).stdout;
  assert.match(text, /mode REPORT-ONLY \(no standing Owner yes passed; archive nothing\)/);
  assert.match(text, /WOULD ARCHIVE \(1\)/);
});

test("guard 1: a session not started by you is kept, even when its id is spoofed into --done", () => {
  const other = sess({ startedBy: "local_someone-else" }), none = sess({ startedBy: undefined });
  const p = plan([other, none], [other.sessionId, none.sessionId]);
  assert.deepEqual(archived(p), []);
  assert.equal(kept(p, other).why, "not started by you");
  assert.equal(kept(p, none).why, "not started by you");
});

test("guard 2: this session is kept", () => {
  const self = sess({ sessionId: ME });
  const p = plan([self], [ME]);
  assert.equal(kept(p, self).why, "this session");
});

test("guard 3: an already archived session is skipped", () => {
  const a = sess({ isArchived: true });
  const p = plan([a], [a.sessionId]);
  assert.equal(kept(p, a).why, "already archived (skipped)");
});

test("guard 4: an Architect thread is never archived, by title or by name, even asserted done", () => {
  const byTitle = sess({ title: "Kit Architect thread", name: "kit-lead" }), byName = sess({ title: "Standing", name: "ARCHITECT-main" });
  const p = plan([byTitle, byName], [byTitle.sessionId, byName.sessionId]);
  assert.deepEqual(archived(p), []);
  for (const s of [byTitle, byName]) assert.match(kept(p, s).why, /an Architect thread \(never archived\)/);
});

test("guard 5: a session not asserted landed and verified is kept", () => {
  const a = sess();
  assert.equal(kept(plan([a], []), a).why, "not asserted landed and verified");
});

test("guard 6: a session waiting on the Owner is kept even when done", () => {
  const a = sess();
  const p = plan([a], [a.sessionId], ["--waiting", a.sessionId]);
  assert.equal(kept(p, a).why, "waiting on the Owner");
});

test("guard 7: a session whose PR is open is kept; MERGED, CLOSED and no PR pass", () => {
  const open = sess({ prState: "OPEN", prNumber: 63 }), merged = sess({ prState: "MERGED" }), closed = sess({ prState: "CLOSED" }), none = sess({ prState: null, prNumber: null });
  const p = plan([open, merged, closed, none], [open, merged, closed, none].map((s) => s.sessionId));
  assert.equal(kept(p, open).why, "PR open (#63)");
  assert.deepEqual(archived(p), [merged, closed, none].map((s) => s.sessionId));
});

test("guard 8: uncommitted changes, unpushed commits, a repo with no remote, and a symlink to a dirty repo all KEEP", () => {
  const L = lab();
  try {
    const link = path.join(L.root, "dirty-link"); symlinkSync(L.repos.dirty, link);
    const dirty = sess({ cwd: L.repos.dirty }), unpushed = sess({ cwd: L.repos.unpushed }), noRemote = sess({ cwd: L.repos.noRemote }), viaLink = sess({ cwd: link }), clean = sess({ cwd: L.repos.clean });
    const all = [dirty, unpushed, noRemote, viaLink, clean];
    const p = plan(all, all.map((s) => s.sessionId));
    assert.equal(kept(p, dirty).why, "unpushed work: uncommitted changes in its worktree");
    assert.equal(kept(p, unpushed).why, "unpushed work: 1 commit(s) on no remote");
    assert.match(kept(p, noRemote).why, /unpushed work: 1 commit\(s\) on no remote/);
    assert.equal(kept(p, viaLink).why, "unpushed work: uncommitted changes in its worktree");
    assert.deepEqual(archived(p), [clean.sessionId]);
  } finally { L.cleanup(); }
});

test("guard 8: a git that cannot run means `cannot verify` and KEEPS", () => {
  const L = lab();
  try {
    const a = sess({ cwd: L.repos.clean });
    const r = run([a], ["--me", ME, "--owner-yes", "--done", a.sessionId], { env: { PATH: "/nonexistent-bin" } });
    assert.equal(r.status, 0);
    assert.match(kept(r.out, a).why, /unpushed work cannot be verified/);
    assert.deepEqual(r.out.archive, []);
  } finally { L.cleanup(); }
});

test("guard 8: a missing cwd passes with a note, a non-git cwd passes", () => {
  const L = lab();
  try {
    const gone = sess({ cwd: path.join(L.root, "removed") }), plain = sess({ cwd: L.repos.nonGit }), noCwd = sess({ cwd: undefined });
    const p = plan([gone, plain, noCwd], [gone, plain, noCwd].map((s) => s.sessionId));
    assert.deepEqual(archived(p), [gone, plain, noCwd].map((s) => s.sessionId));
    assert.match(p.archive[0].why, /worktree already removed/);
    assert.match(p.archive[1].why, /not a git work tree/);
  } finally { L.cleanup(); }
});

test("guard 9, cascade: a done parent is kept when a side session it would take with it is unfinished (every kind)", () => {
  const L = lab();
  try {
    const kinds = {
      "not done": {}, "waiting": {}, "PR open": { prState: "OPEN", prNumber: 9 }, "unpushed": { cwd: L.repos.unpushed },
      "dirty": { cwd: L.repos.dirty }, "an Architect": { title: "Build Architect", name: "ba" },
    };
    for (const [label, over] of Object.entries(kinds)) {
      const parent = sess({ cwd: L.repos.clean }), child = sess({ startedBy: parent.sessionId, ...over });
      const done = [parent.sessionId, ...(label === "not done" ? [] : [child.sessionId])];
      const p = plan([parent, child], done, label === "waiting" ? ["--waiting", child.sessionId] : []);
      assert.deepEqual(archived(p), [], label);
      assert.match(kept(p, parent).why, /^a side session it would take with it is not finished: /, label);
      assert.ok(kept(p, parent).why.includes(child.sessionId), label);
    }
    // a grandchild counts too
    const parent = sess({ cwd: L.repos.clean }), child = sess({ startedBy: parent.sessionId }), grand = sess({ startedBy: child.sessionId });
    const p = plan([parent, child, grand], [parent.sessionId, child.sessionId]);
    assert.match(kept(p, parent).why, new RegExp(`${grand.sessionId}.*not asserted landed and verified`));
  } finally { L.cleanup(); }
});

test("guard 9: finished and already archived side sessions do not block, and the finished ones are named in alsoTaken", () => {
  const parent = sess(), finished = sess({ startedBy: parent.sessionId }), gone = sess({ startedBy: parent.sessionId, isArchived: true, prState: "OPEN" });
  const p = plan([parent, finished, gone], [parent.sessionId, finished.sessionId]);
  assert.deepEqual(archived(p), [parent.sessionId]);
  assert.deepEqual(p.archive[0].alsoTaken, [{ sessionId: finished.sessionId, name: finished.name }]);
  // the side session is not planned on its own: it was not started by this session
  assert.equal(kept(p, finished).why, "not started by you");
  assert.match(spawnSync(process.execPath, [SCRIPT, "--me", ME, "--owner-yes", "--done", parent.sessionId, "--done", finished.sessionId], { input: JSON.stringify([parent, finished, gone]), encoding: "utf8" }).stdout, /also taken by the host: .*\[local_/);
});

test("guard 9: a linked worktree shared with a session that stays keeps both; a shared primary checkout does not", () => {
  const L = lab();
  try {
    const wt = L.linked("wt1");
    const a = sess({ cwd: wt }), b = sess({ cwd: wt });
    let p = plan([a, b], [a.sessionId]);                                 // b is not done
    assert.match(kept(p, a).why, /^it shares its worktree with a session that stays: /);
    assert.equal(kept(p, b).why, "not asserted landed and verified");
    p = plan([a, b], [a.sessionId, b.sessionId]);                        // both finished: both go
    assert.deepEqual(archived(p), [a.sessionId, b.sessionId]);
    p = plan([a, sess({ cwd: wt, sessionId: ME })], [a.sessionId]);      // this session works in it
    assert.equal(kept(p, a).why, "it shares its worktree with this session");
    const x = sess({ cwd: L.repos.clean }), y = sess({ cwd: L.repos.clean });
    p = plan([x, y], [x.sessionId]);                                     // a primary checkout is never cleaned up
    assert.deepEqual(archived(p), [x.sessionId]);
  } finally { L.cleanup(); }
});

test("guard 9 reaches a fixpoint: a session stranded by a stranded session is kept, in either list order", () => {
  const L = lab();
  try {
    const wt = L.linked("wt2");
    const x = sess({ cwd: wt }), y = sess({ cwd: wt }), z = sess({ startedBy: y.sessionId });   // z is unfinished and y's side session
    for (const list of [[x, y, z], [z, y, x]]) {
      const p = plan(list, [x.sessionId, y.sessionId]);
      assert.deepEqual(archived(p), []);
      assert.match(kept(p, y).why, /side session it would take with it is not finished/);
      assert.match(kept(p, x).why, /shares its worktree with a session that stays/);
    }
  } finally { L.cleanup(); }
});

test("spoof attempts: --done for an unknown id is noted and ignored; --done never overrides a guard", () => {
  const dirtyWaiting = sess({ prState: "OPEN" });
  const p = plan([dirtyWaiting], [dirtyWaiting.sessionId, "local_not-in-list"], ["--waiting", dirtyWaiting.sessionId]);
  assert.deepEqual(archived(p), []);
  assert.match(p.notes.join("\n"), /--done local_not-in-list: not in the session list/);
});

test("input forms: --sessions <file>, an object with a `sessions` array, and an empty list", () => {
  const L = lab();
  try {
    const a = sess(), f = path.join(L.root, "list.json");
    writeFileSync(f, JSON.stringify({ sessions: [a] }));
    const r = run(null, ["--me", ME, "--owner-yes", "--done", a.sessionId, "--sessions", f], { stdin: false });
    assert.deepEqual(archived(r.out), [a.sessionId]);
    assert.deepEqual(run([], ["--me", ME, "--owner-yes"]).out.archive, []);
  } finally { L.cleanup(); }
});

test("malformed input exits 2 with an error and nothing planned", () => {
  const bad = (input, args = ["--me", ME, "--owner-yes"]) => spawnSync(process.execPath, [SCRIPT, "--json", ...args], { input, encoding: "utf8" });
  for (const input of ["{not json", "42", "{\"sessions\":\"x\"}", JSON.stringify([{ title: "no id" }]), JSON.stringify([null])]) {
    const r = bad(input);
    assert.equal(r.status, 2, input);
    assert.match(r.stderr, /^archive-plan: /);
    const o = JSON.parse(r.stdout);
    assert.deepEqual([o.archive, o.reportOnly], [[], []], "nothing planned");
    assert.ok(o.error);
  }
  assert.equal(bad("[]", ["--owner-yes"]).status, 2, "--me is required");
  assert.equal(bad("[]", ["--me", ME, "--bogus"]).status, 2);
  assert.equal(bad("[]", ["--me", ME, "--sessions", "/nonexistent/list.json"]).status, 2);
});

test("the Architect's run over the PMs it started, and a PM's run over its builders, on one realistic list (fixtures only; no live session)", () => {
  const L = lab();
  try {
    const A = "local_aaaaaaaa-0000-4000-8000-00000000000a";
    const pmLanded = sess({ name: "pm-adopt-health-macro", startedBy: A, cwd: L.linked("pm1"), prNumber: 48, prState: "MERGED" });
    const builderOfLanded = sess({ name: "builder-health", startedBy: pmLanded.sessionId, cwd: L.repos.nonGit });
    const pmOpenPr = sess({ name: "pm-kit-v2470", startedBy: A, cwd: L.linked("pm2"), prNumber: 64, prState: "OPEN" });
    const pmWaiting = sess({ name: "pm-llmpb", startedBy: A, cwd: L.linked("pm3") });
    const pmForeign = sess({ name: "pm-codex-lane", startedBy: "local_other-architect" });
    const pmStrandedByBuilder = sess({ name: "pm-restock", startedBy: A, cwd: L.linked("pm4") });
    const dirtyBuilder = sess({ name: "builder-restock", startedBy: pmStrandedByBuilder.sessionId, cwd: L.repos.dirty });
    const pmNotDone = sess({ name: "pm-nexus", startedBy: A, cwd: L.linked("pm5") });
    const self = sess({ sessionId: A, name: "architect-kit", title: "Kit Architect", startedBy: "local_josh" });
    const list = [pmLanded, builderOfLanded, pmOpenPr, pmWaiting, pmForeign, pmStrandedByBuilder, dirtyBuilder, pmNotDone, self];
    const r = run(list, ["--me", A, "--owner-yes", ...[pmLanded, builderOfLanded, pmOpenPr, pmWaiting, pmForeign, pmStrandedByBuilder, dirtyBuilder].flatMap((s) => ["--done", s.sessionId]), "--waiting", pmWaiting.sessionId]).out;
    assert.deepEqual(r.archive.map((a) => a.name), ["pm-adopt-health-macro"]);
    assert.deepEqual(r.archive[0].alsoTaken.map((x) => x.name), ["builder-health"]);
    const why = (s) => r.keep.find((k) => k.sessionId === s.sessionId).why;
    assert.equal(why(pmOpenPr), "PR open (#64)");
    assert.equal(why(pmWaiting), "waiting on the Owner");
    assert.equal(why(pmForeign), "not started by you");
    assert.match(why(pmStrandedByBuilder), /side session it would take with it is not finished: builder-restock .*unpushed work: uncommitted/);
    assert.equal(why(pmNotDone), "not asserted landed and verified");
    assert.equal(why(self), "not started by you");
    // the PM's own run: its builders are the candidates and it never plans itself
    const PM = pmLanded.sessionId;
    const rb = run([builderOfLanded, sess({ name: "builder-two", startedBy: PM, cwd: L.repos.dirty })], ["--me", PM, "--owner-yes", "--done", builderOfLanded.sessionId]).out;
    assert.deepEqual(rb.archive.map((a) => a.name), ["builder-health"]);
    assert.equal(rb.keep[0].why, "not asserted landed and verified");
  } finally { L.cleanup(); }
});

test("kill-pass: an inherited GIT_DIR cannot make a dirty worktree read clean", () => {
  const L = lab();
  try {
    const a = sess({ cwd: L.repos.dirty });
    const r = run([a], ["--me", ME, "--owner-yes", "--done", a.sessionId], { env: { ...process.env, GIT_DIR: path.join(L.repos.clean, ".git"), GIT_WORK_TREE: L.repos.clean } });
    assert.equal(kept(r.out, a).why, "unpushed work: uncommitted changes in its worktree");
  } finally { L.cleanup(); }
});

test("kill-pass: prState is compared case-insensitively, and sessions in two subdirectories of one linked worktree are one worktree", () => {
  const L = lab();
  try {
    const open = sess({ prState: "open" });
    assert.match(kept(plan([open], [open.sessionId]), open).why, /^PR open/);
    const wt = L.linked("wt3"); const sub = path.join(wt, "sub"); mkdirSync(sub);
    const a = sess({ cwd: wt }), b = sess({ cwd: sub });
    const p = plan([a, b], [a.sessionId]);                               // b (in a subdirectory) is not done
    assert.match(kept(p, a).why, /^it shares its worktree with a session that stays: /);
  } finally { L.cleanup(); }
});

test("kill-pass: a duplicate sessionId is malformed input (exit 2, nothing planned)", () => {
  const a = sess();
  const r = spawnSync(process.execPath, [SCRIPT, "--json", "--me", ME, "--owner-yes", "--done", a.sessionId], { input: JSON.stringify([a, { ...a, isArchived: true }]), encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.deepEqual(JSON.parse(r.stdout).archive, []);
});
