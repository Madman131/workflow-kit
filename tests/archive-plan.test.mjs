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

const NONGIT = mkdtempSync(path.join(os.tmpdir(), "archive-plan-nongit-"));   // a real, non-git directory: the default cwd of a fixture session
const ME_CWD = mkdtempSync(path.join(os.tmpdir(), "archive-plan-me-"));      // this session's own (non-worktree) cwd
const arch = (args) => (args.includes("--owner-yes") ? [...args, ...(args.includes("--me-cwd") ? [] : ["--me-cwd", ME_CWD]), ...(args.includes("--list-limit") ? [] : ["--list-limit", "200"])] : args);
let seq = 0;
const sess = (over = {}) => {
  const n = ++seq;
  return {
    sessionId: `local_${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`, title: `Session ${n}`, cwd: NONGIT,
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
  args = arch(args);
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
  assert.match(text, /mode REPORT-ONLY \(nothing to be archived from this plan\)/);
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
    assert.equal(kept(p, dirty).why, "unpushed work: uncommitted or untracked changes in its worktree");
    assert.equal(kept(p, unpushed).why, "unpushed work: 1 commit(s) on no remote");
    assert.match(kept(p, noRemote).why, /unpushed work: 1 commit\(s\) on no remote/);
    assert.equal(kept(p, viaLink).why, "unpushed work: uncommitted or untracked changes in its worktree");
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

test("guard 8: an absolute cwd that is gone but whose parent exists passes with a note; an existing non-git cwd passes", () => {
  const L = lab();
  try {
    const gone = sess({ cwd: path.join(L.root, "removed") }), plain = sess({ cwd: L.repos.nonGit });
    const p = plan([gone, plain], [gone, plain].map((s) => s.sessionId));
    assert.deepEqual(archived(p), [gone, plain].map((s) => s.sessionId));
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
    assert.match(kept(p, a).why, /^it shares a worktree with .*, which stays$/);
    assert.equal(kept(p, b).why, "not asserted landed and verified");
    p = plan([a, b], [a.sessionId, b.sessionId]);                        // both finished: both go
    assert.deepEqual(archived(p), [a.sessionId, b.sessionId]);
    p = run([a], ["--me", ME, "--owner-yes", "--done", a.sessionId, "--me-cwd", wt]).out;   // this session works in it
    assert.equal(kept(p, a).why, "it shares a worktree with this session, which stays");
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
      assert.match(kept(p, x).why, /shares a worktree with .*, which stays/);
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
    assert.equal(kept(r.out, a).why, "unpushed work: uncommitted or untracked changes in its worktree");
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
    assert.match(kept(p, a).why, /^it shares a worktree with .*, which stays$/);
  } finally { L.cleanup(); }
});

test("kill-pass: a duplicate sessionId is malformed input (exit 2, nothing planned)", () => {
  const a = sess();
  const r = spawnSync(process.execPath, [SCRIPT, "--json", "--me", ME, "--owner-yes", "--done", a.sessionId], { input: JSON.stringify([a, { ...a, isArchived: true }]), encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.deepEqual(JSON.parse(r.stdout).archive, []);
});

// ---------- R1: the host cleans the archived session's worktree, so every guard must see what the cleanup would destroy ----------

test("R1 item 1: this session's own worktree STAYS (--me-cwd), and a side session's worktree counts too (M4)", () => {
  const L = lab();
  try {
    const wt = L.linked("r1wt1");
    const a = sess({ cwd: wt });
    // archive mode without --me-cwd or --list-limit is REPORT-ONLY, with the reason
    let r = spawnSync(process.execPath, [SCRIPT, "--json", "--me", ME, "--owner-yes", "--done", a.sessionId], { input: JSON.stringify([a]), encoding: "utf8" }).stdout;
    let p = JSON.parse(r);
    assert.equal(p.mode, "report-only"); assert.deepEqual(p.archive, []);
    assert.match(p.notes.join(" "), /archive mode needs --me-cwd <this session's absolute cwd, an existing directory> and --list-limit <the limit passed to list_sessions>: REPORT-ONLY/);
    p = run([a], ["--me", ME, "--owner-yes", "--done", a.sessionId, "--me-cwd", wt]).out;
    assert.equal(kept(p, a).why, "it shares a worktree with this session, which stays");
    // a finished side session taken along that lives in a worktree where another session STAYS keeps the parent
    const parent = sess({ cwd: L.repos.clean }), child = sess({ startedBy: parent.sessionId, cwd: L.linked("r1wt2") }), stayer = sess({ cwd: child.cwd, startedBy: "local_other" });
    p = plan([parent, child, stayer], [parent.sessionId, child.sessionId]);
    assert.deepEqual(archived(p), []);
    assert.match(kept(p, parent).why, /^a side session it would take with it \(.*\) shares a worktree with .*, which stays$/);
    // a kept session anywhere in the list stays: the same worktree, no descendants
    const k = sess({ cwd: wt, startedBy: "local_other" }), x = sess({ cwd: wt });
    assert.match(kept(plan([x, k], [x.sessionId]), x).why, /shares a worktree with .*, which stays/);
  } finally { L.cleanup(); }
});

test("R1 item 2: untracked files, config injection, index flags and submodules cannot hide work", () => {
  const L = lab();
  try {
    const hidden = (mutate) => { const d = L.linked(`r1h${++seq}`); mutate(d); return d; };
    const untracked = (d) => writeFileSync(path.join(d, "new.txt"), "x");
    const cases = [
      ["untracked file under showUntrackedFiles=no in repo config", hidden((d) => { git(d, "config", "--local", "status.showUntrackedFiles", "no"); untracked(d); }), {}, /uncommitted or untracked/],
      ["untracked file under GIT_CONFIG_PARAMETERS", hidden(untracked), { GIT_CONFIG_PARAMETERS: "'status.showuntrackedfiles=no'" }, /uncommitted or untracked/],
      ["untracked file under GIT_CONFIG_COUNT", hidden(untracked), { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "status.showUntrackedFiles", GIT_CONFIG_VALUE_0: "no" }, /uncommitted or untracked/],
      ["skip-worktree", hidden((d) => { git(d, "update-index", "--skip-worktree", "f.txt"); writeFileSync(path.join(d, "f.txt"), "changed\n"); }), {}, /cannot verify: index flags/],
      ["assume-unchanged", hidden((d) => { git(d, "update-index", "--assume-unchanged", "f.txt"); writeFileSync(path.join(d, "f.txt"), "changed\n"); }), {}, /cannot verify: index flags/],
    ];
    for (const [label, cwd, env, re] of cases) {
      const a = sess({ cwd });
      const r = run([a], ["--me", ME, "--owner-yes", "--done", a.sessionId], { env: { ...process.env, ...env } });
      assert.match(kept(r.out, a).why, re, label);
    }
    // a submodule with an unpushed commit, in a super-project that is itself clean and pushed
    const subRemote = path.join(L.root, "sub-remote.git"); git(L.root, "init", "-q", "--bare", subRemote);
    const subSeed = path.join(L.root, "sub-seed"); git(L.root, "clone", "-q", subRemote, subSeed);
    writeFileSync(path.join(subSeed, "s.txt"), "s\n"); git(subSeed, "add", "s.txt"); git(subSeed, "commit", "-q", "-m", "s"); git(subSeed, "push", "-q", "origin", "HEAD:main");
    const sup = L.linked("r1sup");
    git(sup, "-c", "protocol.file.allow=always", "submodule", "add", "-q", "-b", "main", subRemote, "sm");
    git(sup, "commit", "-q", "-m", "add submodule"); git(sup, "push", "-q", "origin", "HEAD:refs/heads/r1sup");
    const a = sess({ cwd: sup });
    assert.deepEqual(archived(plan([a], [a.sessionId])), [a.sessionId], "a clean pushed submodule passes");
    const sm = path.join(sup, "sm"); writeFileSync(path.join(sm, "t.txt"), "t\n"); git(sm, "add", "t.txt"); git(sm, "commit", "-q", "-m", "local sub commit");
    git(sup, "add", "sm"); git(sup, "commit", "-q", "-m", "bump submodule"); git(sup, "push", "-q", "origin", "HEAD:refs/heads/r1sup");
    assert.match(kept(plan([a], [a.sessionId]), a).why, /a submodule has uncommitted changes or commits on no remote/);
  } finally { L.cleanup(); }
});

test("R1 item 3: each cwd rule", () => {
  const L = lab();
  try {
    const keepCases = [
      [undefined, /cannot verify: no cwd is recorded/], ["", /cannot verify: no cwd is recorded/], [42, /cannot verify: no cwd is recorded/],
      ["relative/dir", /cannot verify: its cwd is not an absolute path/], ["~/work", /cannot verify: its cwd is not an absolute path/],
      ["/nonexistent-r1/deep/dir", /cannot verify: its cwd and the cwd's parent directory are both missing/],
      [path.join(L.repos.clean, ".git"), /cannot verify: its cwd is a git directory or a bare repository/],
      [path.join(L.root, "remote.git"), /cannot verify: its cwd is a git directory or a bare repository/],
    ];
    for (const [cwd, re] of keepCases) { const a = sess({ cwd }); assert.match(kept(plan([a], [a.sessionId]), a).why, re, String(cwd)); }
    const gone = sess({ cwd: path.join(L.root, "removed-dir") });
    assert.match(plan([gone], [gone.sessionId]).archive[0].why, /worktree already removed/);
  } finally { L.cleanup(); }
});

test("R1 item 4: a list that may be truncated plans nothing; archive mode needs --list-limit", () => {
  const xs = [sess(), sess(), sess()];
  const ids = xs.map((s) => s.sessionId);
  let p = run(xs, ["--me", ME, "--owner-yes", "--list-limit", "3", ...ids.flatMap((i) => ["--done", i])]).out;
  assert.deepEqual(p.archive, []);
  for (const s of xs) assert.equal(kept(p, s).why, "the list may be truncated; re-list with a larger limit");
  assert.match(p.notes.join(" "), /holds 3 entries, the limit passed was 3/);
  p = run(xs, ["--me", ME, "--owner-yes", "--list-limit", "4", ...ids.flatMap((i) => ["--done", i])]).out;
  assert.deepEqual(archived(p), ids);
  assert.equal(run(xs, ["--me", ME, "--list-limit", "0"]).status, 2);
  assert.equal(run(xs, ["--me", ME, "--list-limit", "abc"]).status, 2);
});

test("R1 item 5: only MERGED or CLOSED (or no PR at all) passes", () => {
  const mk = (over) => sess(over);
  const cases = [[mk({ prState: "DRAFT" }), /^PR not MERGED or CLOSED \(DRAFT/], [mk({ prState: " OPEN" }), /^PR open/], [mk({ prNumber: 7, prState: null }), /^PR not MERGED or CLOSED \(state unknown, #7\)/],
    [mk({ prState: "WEIRD", prNumber: null }), /^PR not MERGED or CLOSED \(WEIRD/]];
  const pass = [mk({ prState: "MERGED" }), mk({ prState: " closed " }), mk({ prState: "merged" }), mk({ prState: "", prNumber: null }), mk({ prState: undefined, prNumber: undefined }), mk({ prState: null, prNumber: "" })];
  const all = [...cases.map((c) => c[0]), ...pass];
  const p = plan(all, all.map((s) => s.sessionId));
  for (const [s, re] of cases) assert.match(kept(p, s).why, re);
  assert.deepEqual(archived(p), pass.map((s) => s.sessionId));
});

test("R1 item 6 (+R2 cheap LOWs): the Architect guard is architect(?!ur): look-alikes are kept, 'architecture' is archivable", () => {
  const kept4 = [sess({ name: "architect_kit" }), sess({ title: "Architect2" }), sess({ name: "KitArchitect" }), sess({ title: "The architects" }), sess({ title: "Kit Architect", name: "kit-lead" }), sess({ name: "kit-architect-main" })];
  const ok = [sess({ title: "Architecture docs pass", name: "architecture-docs" }), sess({ title: "Architectural review" })];
  const all = [...kept4, ...ok], p = plan(all, all.map((s) => s.sessionId));
  assert.deepEqual(archived(p), ok.map((s) => s.sessionId));
  for (const s of kept4) assert.match(kept(p, s).why, /Architect thread/);
});

test("R1 item 7: a session with Remote Control active is flagged, in JSON and in text", () => {
  const rc = sess({ remoteControlActive: true }), plain = sess({ remoteControlActive: false });
  const p = plan([rc, plain], [rc.sessionId, plain.sessionId]);
  assert.equal(p.archive[0].needsRemoteControlOff, true);
  assert.equal(p.archive[0].note, "turn Remote Control off first");
  assert.equal(p.archive[1].needsRemoteControlOff, undefined);
  const text = spawnSync(process.execPath, [SCRIPT, "--me", ME, "--owner-yes", "--me-cwd", ME_CWD, "--list-limit", "200", "--done", rc.sessionId], { input: JSON.stringify([rc]), encoding: "utf8" }).stdout;
  assert.match(text, /\(turn Remote Control off first\)/);
});

test("R1 item 8: 100 sessions over 10 worktrees plan in under 10 s (git facts cached per cwd)", () => {
  const L = lab();
  try {
    const wts = Array.from({ length: 10 }, (_, i) => L.linked(`r1perf${i}`));
    const xs = Array.from({ length: 100 }, (_, i) => sess({ cwd: wts[i % 10] }));
    const t = Date.now();
    const p = plan(xs, xs.map((s) => s.sessionId));
    const ms = Date.now() - t;
    assert.ok(ms < 10_000, `took ${ms} ms`);
    assert.equal(p.archive.length, 100);
  } finally { L.cleanup(); }
});

test("R1 item 9: a plan larger than a pipe buffer arrives whole (no exit() right after the write)", () => {
  const xs = Array.from({ length: 400 }, () => sess({ title: "T".repeat(400) }));
  const r = spawnSync(process.execPath, [SCRIPT, "--json", "--me", ME], { input: JSON.stringify(xs), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.ok(r.stdout.length > 150 * 1024, `output is ${r.stdout.length} bytes`);
  assert.equal(JSON.parse(r.stdout).keep.length, 400);
});

test("R2 LOWs: --me-cwd must be an existing directory; Remote Control strings and side sessions count", () => {
  const a = sess();
  for (const bad of ["/nonexistent-r2/dir", NONGIT + "/no-such", "relative/dir", ME_CWD + "/../" + path.basename(ME_CWD) + "/file-not-dir"]) {
    const r = run([a], ["--me", ME, "--owner-yes", "--done", a.sessionId, "--me-cwd", bad]).out;
    assert.equal(r.mode, "report-only", bad); assert.deepEqual(r.archive, []);
    assert.match(r.notes.join(" "), /--me-cwd <this session's absolute cwd, an existing directory>/);
  }
  const file = path.join(ME_CWD, "a-file"); writeFileSync(file, "x");
  assert.equal(run([a], ["--me", ME, "--owner-yes", "--done", a.sessionId, "--me-cwd", file]).out.mode, "report-only");
  const strs = [sess({ remoteControlActive: "true" }), sess({ remoteControlActive: "TRUE" }), sess({ remoteControlActive: "false" })];
  const p = plan(strs, strs.map((s) => s.sessionId));
  assert.deepEqual(p.archive.map((e) => e.needsRemoteControlOff === true), [true, true, false]);
  const parent = sess(), child = sess({ startedBy: parent.sessionId, remoteControlActive: true });
  const q = plan([parent, child], [parent.sessionId, child.sessionId]);
  assert.equal(q.archive[0].needsRemoteControlOff, true); assert.equal(q.archive[0].note, "turn Remote Control off first");
  assert.equal(q.archive[0].alsoTaken[0].needsRemoteControlOff, true);
});

test("M4: a list without the `linked` filter shows non-family sessions (no startedBy) that share a worktree, and they keep the session", () => {
  const L = lab();
  try {
    const wt = L.linked("r2m4");
    const a = sess({ cwd: wt }), stranger = { sessionId: "local_stranger-0000-4000-8000-000000000000", title: "Hand-started chat", cwd: wt, isArchived: false, isRunning: true };
    const p = plan([a, stranger], [a.sessionId]);
    assert.equal(kept(p, stranger).why, "not started by you");
    assert.match(kept(p, a).why, /shares a worktree with Hand-started chat .*, which stays/);
  } finally { L.cleanup(); }
});
