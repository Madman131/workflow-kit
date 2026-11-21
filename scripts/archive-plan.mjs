#!/usr/bin/env node
// workflow-kit — scripts/archive-plan.mjs. Decide which of the sessions THIS session started may be archived now.
// A PURE DECISION SCRIPT: it reads a host session list, runs `git` read-only against each session's cwd, prints a
// plan, and never archives, stops, signals or writes anything. The host's archive tool does the archiving, once per
// planned id, after skills/closeout/ARCHIVE.md's other steps (it stops the session's Codex plugin brokers first).
//
//   node scripts/archive-plan.mjs --me <my session id> [--sessions <file> | stdin] [--done <id>]… [--waiting <id>]…
//                                 [--owner-yes] [--json]
//
//   --sessions   the host's session list as JSON: an array of entries shaped like
//                { "sessionId":"local_…", "title":"…", "name":"pm-x", "cwd":"…", "isArchived":false, "isRunning":true,
//                  "prNumber":48, "prState":"MERGED", "lastActivityAt":"…", "startedBy":"local_…" }
//                (or { "sessions": [ … ] }). The host excludes the CURRENT session from its own list.
//   --done       the agent asserts: that session's work is landed, verified, and has nothing left to do. Repeatable.
//   --waiting    that session is waiting on the Owner. Repeatable. (A --done id that is also --waiting is KEPT.)
//   --owner-yes  the standing Owner yes is in force. Without it the plan is REPORT-ONLY: what would be archived is
//                listed under `reportOnly`, `archive` stays empty, and the caller archives nothing.
//
// THE GUARDS — each one KEEPS the session, and the first that fires names the reason:
//   1 startedBy is not --me · 2 it is this session · 3 already archived (skipped) · 4 an Architect thread (title or name
//   matches /architect/i) · 5 not asserted --done · 6 --waiting · 7 prState is OPEN · 8 its cwd is a git work tree
//   with uncommitted changes or commits on no remote, or git cannot say ("cannot verify") · 9 THE CASCADE.
// A cwd that no longer exists passes 8 with a note (the worktree is already gone); a non-git cwd passes 8.
// GUARD 9. The host's archive call ALSO archives the session's side sessions (those that share its worktree or have
// finished) and cleans up its worktree. So a session is kept when any descendant in the list (anyone whose startedBy
// chain leads to it) is not already archived and fails 4–8, or when another session that stays shares its linked
// worktree. The plan is a fixpoint: removing a session can strand its parent, so it repeats until stable.
// An archived entry lists `alsoTaken` — the descendants the host will take with it — so the receipt can name them.
//
// Exit 0 always for a plan; 2 for malformed input or arguments (an error message, nothing planned).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

function fail(msg, json) {
  console.error(`archive-plan: ${msg}`);
  if (json) console.log(JSON.stringify({ error: msg, mode: "error", archive: [], reportOnly: [], keep: [] }, null, 2));
  process.exit(2);
}

// ---------- git facts ----------
const git = (cwd, args) => spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8" });

// Returns { pass:boolean, why, note }. Never throws.
export function unpushedCheck(cwd) {
  if (!cwd || typeof cwd !== "string") return { pass: true, note: "no cwd recorded" };
  if (!existsSync(cwd)) return { pass: true, note: "worktree already removed" };
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error) return { pass: false, why: `unpushed work cannot be verified (git: ${inside.error.code ?? inside.error.message})` };
  if (inside.status !== 0 && /not a git repository/i.test(inside.stderr ?? "")) return { pass: true, note: "not a git work tree" };
  if (inside.status !== 0) return { pass: false, why: `unpushed work cannot be verified (git: ${(inside.stderr ?? "").trim().split("\n")[0] || "failed"})` };
  if (inside.stdout.trim() !== "true") return { pass: true, note: "not a git work tree" };
  const st = git(cwd, ["status", "--porcelain"]);
  if (st.status !== 0) return { pass: false, why: "unpushed work cannot be verified (git status failed)" };
  if (st.stdout.trim() !== "") return { pass: false, why: "unpushed work: uncommitted changes in its worktree" };
  const rl = git(cwd, ["rev-list", "HEAD", "--not", "--remotes"]);
  if (rl.status !== 0) return { pass: false, why: "unpushed work cannot be verified (git rev-list failed)" };
  const n = rl.stdout.split("\n").filter(Boolean).length;
  if (n > 0) return { pass: false, why: `unpushed work: ${n} commit(s) on no remote` };
  return { pass: true };
}

// A LINKED worktree (git dir differs from the common dir) is one the host may clean up; a primary checkout is not.
function isLinkedWorktree(cwd) {
  if (!cwd || !existsSync(cwd)) return false;
  const a = git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"]), b = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return a.status === 0 && b.status === 0 && a.stdout.trim() !== b.stdout.trim();
}
const rp = (p) => { try { return realpathSync(p); } catch { return p; } };

// ---------- the plan ----------
export function plan(list, { me, done = [], waiting = [], ownerYes = false } = {}) {
  const sessions = list.filter((s) => s && typeof s === "object");
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const doneSet = new Set(done), waitingSet = new Set(waiting);
  const notes = [];
  for (const id of done) if (!byId.has(id)) notes.push(`--done ${id}: not in the session list (ignored)`);
  for (const id of waiting) if (!byId.has(id)) notes.push(`--waiting ${id}: not in the session list (ignored)`);
  const label = (s) => s.name || s.title || s.sessionId;
  const entry = (s, why, extra = {}) => ({ sessionId: s.sessionId, name: s.name ?? null, title: s.title ?? null, why, ...extra });
  const isArchitect = (s) => /architect/i.test(`${s.title ?? ""}\n${s.name ?? ""}`);

  const gitCache = new Map();
  const gitFacts = (s) => { if (!gitCache.has(s.sessionId)) gitCache.set(s.sessionId, unpushedCheck(s.cwd)); return gitCache.get(s.sessionId); };

  // Guards 4–8: "is this session itself finished?" (the part that applies to a descendant too).
  const finishedWhy = (s) => {
    if (isArchitect(s)) return "an Architect thread (never archived)";
    if (!doneSet.has(s.sessionId)) return "not asserted landed and verified";
    if (waitingSet.has(s.sessionId)) return "waiting on the Owner";
    if (s.prState === "OPEN") return `PR open${s.prNumber != null ? ` (#${s.prNumber})` : ""}`;
    const g = gitFacts(s);
    if (!g.pass) return g.why;
    return null;
  };

  // Guards 1–3 first, then 4–8.
  const kept = new Map();          // id -> why
  const cand = new Set();
  for (const s of sessions) {
    let why = null;
    if (!s.startedBy || s.startedBy !== me) why = "not started by you";
    else if (s.sessionId === me) why = "this session";
    else if (s.isArchived === true) why = "already archived (skipped)";
    else why = finishedWhy(s);
    if (why) kept.set(s.sessionId, why); else cand.add(s.sessionId);
  }

  // Descendants: every session whose startedBy chain leads to `id` (cycle-safe).
  const children = new Map();
  for (const s of sessions) if (s.startedBy) { if (!children.has(s.startedBy)) children.set(s.startedBy, []); children.get(s.startedBy).push(s); }
  const descendantsOf = (id) => {
    const out = [], seen = new Set([id]); const stack = [id];
    while (stack.length) for (const c of children.get(stack.pop()) ?? []) if (!seen.has(c.sessionId)) { seen.add(c.sessionId); out.push(c); stack.push(c.sessionId); }
    return out;
  };
  const worktreeKey = (s) => (isLinkedWorktree(s.cwd) ? rp(s.cwd) : null);

  // Guard 9, to a fixpoint.
  const alsoTaken = new Map();
  for (let changed = true; changed;) {
    changed = false;
    for (const s of sessions) {
      if (!cand.has(s.sessionId)) continue;
      const desc = descendantsOf(s.sessionId).filter((d) => d.isArchived !== true && d.sessionId !== me);
      const taken = [];
      let block = null;
      if (descendantsOf(s.sessionId).some((d) => d.sessionId === me)) block = `this session is one of its side sessions`;
      for (const d of desc) {
        if (block) break;
        const w = finishedWhy(d);
        if (w) block = `a side session it would take with it is not finished: ${label(d)} (${d.sessionId}): ${w}`;
        else taken.push(d);
      }
      const key = block ? null : worktreeKey(s);
      if (key) for (const o of sessions) {
        if (block || o.sessionId === s.sessionId || o.isArchived === true) continue;
        if (worktreeKey(o) !== key || desc.some((d) => d.sessionId === o.sessionId)) continue;
        if (o.sessionId === me) block = "it shares its worktree with this session";
        else if (!cand.has(o.sessionId)) block = `it shares its worktree with a session that stays: ${label(o)} (${o.sessionId})`;
        else taken.push(o);
      }
      if (block) { cand.delete(s.sessionId); kept.set(s.sessionId, block); changed = true; }
      else alsoTaken.set(s.sessionId, taken);
    }
  }

  const archive = [], keep = [];
  for (const s of sessions) {
    if (cand.has(s.sessionId)) {
      const g = gitFacts(s);
      const why = `started by you; asserted landed and verified; ${g.note ? g.note : "its worktree is clean and pushed"}`;
      archive.push(entry(s, why, { alsoTaken: (alsoTaken.get(s.sessionId) ?? []).map((d) => ({ sessionId: d.sessionId, name: d.name ?? null })) }));
    } else keep.push(entry(s, kept.get(s.sessionId)));
  }
  return ownerYes
    ? { mode: "archive", me, archive, reportOnly: [], keep, notes }
    : { mode: "report-only", me, archive: [], reportOnly: archive, keep, notes: [...notes, "no --owner-yes: nothing is to be archived; this lists what would be"] };
}

function render(p) {
  const L = [`archive-plan: mode ${p.mode.toUpperCase()}${p.mode === "report-only" ? " (no standing Owner yes passed; archive nothing)" : ""}`];
  const rows = (title, xs) => {
    L.push(`${title} (${xs.length})`);
    for (const x of xs) {
      L.push(`  ${x.name ?? x.title ?? x.sessionId}  [${x.sessionId}]  ${x.why}`);
      for (const a of x.alsoTaken ?? []) L.push(`      also taken by the host: ${a.name ?? "?"} [${a.sessionId}]`);
    }
  };
  rows(p.mode === "archive" ? "ARCHIVE" : "WOULD ARCHIVE", p.mode === "archive" ? p.archive : p.reportOnly);
  rows("KEEP", p.keep);
  for (const n of p.notes) L.push(`note: ${n}`);
  return L.join("\n");
}

// ---------- CLI ----------
function main(argv) {
  const o = { me: null, sessions: null, done: [], waiting: [], ownerYes: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => (i + 1 < argv.length ? argv[++i] : fail(`${a} needs a value`, o.json));
    if (a === "--me") o.me = next();
    else if (a === "--sessions") o.sessions = next();
    else if (a === "--done") o.done.push(next());
    else if (a === "--waiting") o.waiting.push(next());
    else if (a === "--owner-yes") o.ownerYes = true;
    else if (a === "--json") o.json = true;
    else fail(`unknown argument ${a}`, o.json);
  }
  if (!o.me) fail("--me <this session's id> is required", o.json);
  let raw;
  try { raw = o.sessions ? readFileSync(o.sessions, "utf8") : readFileSync(0, "utf8"); } catch (e) { fail(`cannot read the session list: ${e.code ?? e.message}`, o.json); }
  let data;
  try { data = JSON.parse(raw); } catch (e) { fail(`the session list is not valid JSON (${e.message})`, o.json); }
  const list = Array.isArray(data) ? data : Array.isArray(data?.sessions) ? data.sessions : null;
  if (!list) fail("the session list must be a JSON array (or an object with a `sessions` array)", o.json);
  list.forEach((s, i) => { if (!s || typeof s !== "object" || typeof s.sessionId !== "string" || !s.sessionId) fail(`session list entry ${i} has no sessionId`, o.json); });
  const p = plan(list, { me: o.me, done: o.done, waiting: o.waiting, ownerYes: o.ownerYes });
  console.log(o.json ? JSON.stringify(p, null, 2) : render(p));
  process.exit(0);
}

const isMain = process.argv[1] && rp(process.argv[1]) === rp(fileURLToPath(import.meta.url));
if (isMain) main(process.argv.slice(2));
