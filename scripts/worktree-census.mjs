#!/usr/bin/env node
// workflow-kit — scripts/worktree-census.mjs. Classify every worktree of a repo from git facts and
// print a cleanup PLAN. REPORT ONLY: this script never removes, prunes, checks out, fetches, or
// changes any tracked content, ref or worktree; the only write git may do on its behalf is the
// optional index refresh `git status` performs, and it is run with --no-optional-locks so it never
// takes the index lock. The decision stays with whoever runs it (core/OPERATE.md § Garden: sensors,
// not actuators; the orchestrator's housekeeping rule: prove a thing is DEAD before removing it).
//
//   node scripts/worktree-census.mjs [--repo <path>] [--base <ref>] [--stale-days <n>] [--json] [--no-pr]
//
// STATES, first match wins:
//   main         the primary checkout (never a removal candidate)
//   occupied     carries a live `.claude/task-lane.json` — another lane's declared work, untouchable
//   dirty        uncommitted changes — never removable, someone's in-flight work
//   locked       `git worktree lock` was applied — someone protected it on purpose; keep
//   merged       PROVEN landed on the base, by one of the two forms the method recognises:
//                  ancestor  — HEAD is an ancestor of the base (a true merge, or fast-forward)
//                  squash    — a PR from this branch INTO THE BASE BRANCH is MERGED, and the patch
//                              the squash commit applied (mergeCommit^..mergeCommit) is BYTE-EQUAL,
//                              hunk headers aside, to the patch the branch carries over its merge
//                              base with that parent — whitespace included, because an
//                              indentation-only change is a semantic change in some languages
//                              (`git patch-id` would ignore it). An unrelated base commit landing
//                              between fork and merge does not break the proof; a commit added to
//                              the branch after the merge does
//                (skills/orchestrate/PROTOCOLS.md § Shipping: "ancestor-of" is permanently false
//                after a squash, so ECC's `ahead == 0 ⇒ merged` rule is NOT enough; that gap is
//                the one this script closes)
//   merged-pr-content-differs  the PR is merged but what the branch carries is not what landed —
//                commits after the merge, or a merge that dropped content; SALVAGE before removing
//   merged-pr-unprovable  the PR is merged but its merge commit is not in the local object store
//                (not fetched) — INSPECT; fetch, then re-run
//   detached     no branch — inspect by hand
//   stale        unmerged commits and no activity for --stale-days (default 14) — salvage candidate
//   merge-ready  unmerged commits, recent, clean
//   idle         no merge base with the base ref (unrelated history) — inspect
//   bare · missing · unreadable — the degenerate cases, each named as itself
//
// PR PROOF needs `gh`; without it (or with --no-pr) the squash form is unavailable and the report
// says so per worktree rather than guessing. A census that cannot see is not a clear.
//
// Origin: state set and the "stale ⇒ salvage, never a blind delete" posture from ECC's
// scripts/lib/worktree-lifecycle/lifecycle.js (affaan-m/ECC @ 22e8cf0, MIT); the squash proof and
// the occupancy state are this kit's.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function git(repo, args, opts = {}) {
  return execFileSync("git", ["-C", repo, "--no-optional-locks", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000, ...opts }).trim();
}
function tryGit(repo, args) { try { return git(repo, args); } catch { return null; } }

export function parseArgs(argv) {
  const o = { repo: process.cwd(), base: null, staleDays: 14, json: false, pr: true, plan: true };
  const needsValue = (i, flag) => { const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) { console.error(`worktree-census: ${flag} needs a value`); process.exit(2); } return v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") o.repo = path.resolve(needsValue(i++, a));
    else if (a === "--base") o.base = needsValue(i++, a);
    else if (a === "--stale-days") o.staleDays = Number(needsValue(i++, a));
    else if (a === "--json") o.json = true;
    else if (a === "--no-pr") o.pr = false;
    else if (a === "-h" || a === "--help") { console.log("usage: worktree-census.mjs [--repo <path>] [--base <ref>] [--stale-days <n>] [--json] [--no-pr]"); process.exit(0); }
    else { console.error(`worktree-census: unknown argument ${a}`); process.exit(2); }
  }
  if (!Number.isFinite(o.staleDays) || o.staleDays <= 0) { console.error("worktree-census: --stale-days must be a positive number"); process.exit(2); }
  return o;
}

export function listWorktrees(repo) {
  const out = git(repo, ["worktree", "list", "--porcelain"]);
  const items = [];
  let cur = null;
  for (const l of out.split("\n")) {
    if (l.startsWith("worktree ")) { cur = { path: l.slice(9), head: null, branch: null, detached: false, bare: false, locked: false }; items.push(cur); }
    else if (!cur) continue;
    else if (l.startsWith("HEAD ")) cur.head = l.slice(5);
    else if (l.startsWith("branch ")) cur.branch = l.slice(7).replace(/^refs\/heads\//, "");
    else if (l === "detached") cur.detached = true;
    else if (l === "bare") cur.bare = true;
    else if (l === "locked" || l.startsWith("locked ")) cur.locked = true;
  }
  return items;
}

// Default PR lookup via `gh`, scoped to PRs INTO the base branch (a PR merged into `develop` proves
// nothing about `main`). Returns { available, merged, mergeCommit } — `available:false` when gh is
// absent, unauthenticated, hangs (15 s) or errors, so the caller says "unproven", never "not merged".
export function ghPrLookup(repo, branch, baseBranch) {
  try {
    const args = ["pr", "list", "--head", branch, "--state", "merged", "--json", "number,mergeCommit", "--limit", "1"];
    if (baseBranch) args.push("--base", baseBranch);
    const raw = execFileSync("gh", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 });
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return { available: true, merged: false, mergeCommit: null, number: null };
    return { available: true, merged: true, mergeCommit: arr[0].mergeCommit?.oid || null, number: arr[0].number };
  } catch { return { available: false, merged: false, mergeCommit: null, number: null }; }
}

// The base ref's BRANCH name for the PR filter: `origin/main` → `main`, `upstream/main` → `main`
// when `upstream` is a configured remote, `release/1.x` → `release/1.x` (not a remote).
export function baseBranchName(base, remotes = []) {
  let b = String(base || "").replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "");
  const slash = b.indexOf("/");
  if (slash > 0 && remotes.includes(b.slice(0, slash))) b = b.slice(slash + 1);
  return b;
}

// Content fingerprint of a range: the diff with hunk headers and index lines removed (line numbers
// drift when the base moves; content, whitespace included, must not), hashed. Null when git cannot
// produce it (missing object). "empty" for an empty range.
function contentId(repo, from, to) {
  try {
    const diff = git(repo, ["diff", "--no-color", `${from}..${to}`]);
    if (!diff) return "empty";
    const norm = diff.split("\n").filter((l) => !l.startsWith("@@") && !l.startsWith("index ")).join("\n");
    return createHash("sha256").update(norm).digest("hex");
  } catch { return null; }
}

export function classify(repo, wt, opts) {
  const { base, staleDays, prLookup, now = Date.now() } = opts;
  const rec = { path: wt.path, branch: wt.branch, head: wt.head ? wt.head.slice(0, 8) : null, state: null, ahead: null, behind: null,
    lastCommitDays: null, occupied: null, proof: null, note: null };
  if (wt.bare) { rec.state = "bare"; return rec; }
  if (wt.path === opts.mainPath) { rec.state = "main"; return rec; }
  if (wt.locked) { rec.state = "locked"; rec.note = "git worktree lock is set — protected on purpose"; return rec; }
  // Occupancy: a declared lane. Read-only; the mtime is what the lane guard's staleness clock reads.
  const lane = path.join(wt.path, ".claude", "task-lane.json");
  if (existsSync(lane)) {
    try {
      const l = JSON.parse(readFileSync(lane, "utf8"));
      const ageH = Math.round((now - statSync(lane).mtimeMs) / 36e5);
      rec.occupied = { taskId: l.taskId ?? null, tier: l.tier ?? null, ageHours: ageH };
      rec.state = "occupied"; rec.note = `lane ${l.taskId ?? "?"} declared ${ageH}h ago`; return rec;
    } catch { rec.occupied = { taskId: null, tier: null, ageHours: null }; rec.state = "occupied"; rec.note = "unparseable lane declaration — treat as live"; return rec; }
  }
  if (!existsSync(wt.path)) { rec.state = "missing"; rec.note = "path absent on disk (git worktree prune candidate — still a human decision)"; return rec; }
  const dirty = tryGit(wt.path, ["status", "--porcelain", "--untracked-files=normal"]);   // --no-optional-locks is on every git call
  if (dirty === null) { rec.state = "unreadable"; rec.note = "git status failed"; return rec; }
  if (dirty) { rec.state = "dirty"; rec.note = `${dirty.split("\n").length} uncommitted path(s)`; return rec; }
  if (wt.detached || !wt.branch) { rec.state = "detached"; return rec; }
  // Unrelated history: rev-list still returns counts, so ask merge-base directly.
  if (tryGit(repo, ["merge-base", base, wt.branch]) === null) { rec.state = "idle"; rec.note = "no merge base with the base ref"; return rec; }
  const lr = tryGit(repo, ["rev-list", "--left-right", "--count", `${base}...${wt.branch}`]);
  if (lr) { const [b, a] = lr.split(/\s+/).map(Number); rec.behind = b; rec.ahead = a; }
  const ts = tryGit(repo, ["log", "-1", "--format=%ct", wt.branch]);
  if (ts) rec.lastCommitDays = Math.floor((now / 1000 - Number(ts)) / 86400);
  // Proof form 1: ancestor-of.
  try { git(repo, ["merge-base", "--is-ancestor", wt.branch, base]); rec.state = "merged"; rec.proof = "ancestor"; return rec; } catch { /* not an ancestor */ }
  // Proof form 2: a PR into the base branch is merged, AND the patch the squash commit applied
  // equals the patch the branch carries over its merge base with the squash commit's parent.
  if (prLookup) {
    const pr = prLookup(repo, wt.branch, baseBranchName(base, opts.remotes || []));
    if (!pr.available) rec.note = "pr-proof unavailable (gh missing/unauthenticated/timed out) — squash merges cannot be proven here";
    else if (pr.merged && pr.mergeCommit) {
      const parent = tryGit(repo, ["rev-parse", "--verify", "--quiet", `${pr.mergeCommit}^`]);
      if (!parent) { rec.state = "merged-pr-unprovable"; rec.proof = `PR #${pr.number} merged; merge commit not in local objects`; rec.note = "fetch, then re-run"; return rec; }
      const mb = tryGit(repo, ["merge-base", parent, wt.branch]);
      const landed = contentId(repo, parent, pr.mergeCommit);
      const carried = mb ? contentId(repo, mb, wt.branch) : null;
      if (landed && carried && landed === carried) { rec.state = "merged"; rec.proof = `squash PR #${pr.number} (content match)`; return rec; }
      rec.state = "merged-pr-content-differs"; rec.proof = `PR #${pr.number} merged; branch content differs from what landed`; rec.note = "salvage: commits after the merge, or the merge dropped content"; return rec;
    }
  } else rec.note = "pr-proof skipped (--no-pr)";
  const stale = rec.lastCommitDays !== null && rec.lastCommitDays >= staleDays;
  rec.state = stale ? "stale" : "merge-ready";
  return rec;
}

export function census(repo, o) {
  const top = git(repo, ["rev-parse", "--show-toplevel"]);
  const wts = listWorktrees(top);
  const mainPath = wts[0]?.path ?? top;
  const base = o.base || (tryGit(top, ["rev-parse", "--verify", "--quiet", "origin/main"]) ? "origin/main" : (tryGit(top, ["rev-parse", "--verify", "--quiet", "main"]) ? "main" : "HEAD"));
  const prLookup = o.pr ? (o.prLookup || ghPrLookup) : null;   // signature: (repo, branch, baseBranch)
  const remotes = (tryGit(top, ["remote"]) || "").split("\n").filter(Boolean);
  const rows = wts.map((w) => classify(top, w, { base, staleDays: o.staleDays, prLookup, mainPath, now: o.now, remotes }));
  return { repo: top, base, worktrees: rows, plan: plan(rows) };
}

// The plan is a partition, and every bucket carries its reason. "remove-safe" still means a human
// runs `git worktree remove`; this script only says which ones the evidence permits.
export function plan(rows) {
  const p = { removeSafe: [], salvage: [], keep: [], inspect: [] };
  for (const r of rows) {
    if (r.state === "merged") p.removeSafe.push({ path: r.path, branch: r.branch, reason: `proven merged (${r.proof})` });
    else if (r.state === "stale" || r.state === "merged-pr-content-differs") p.salvage.push({ path: r.path, branch: r.branch, reason: `${r.state}: ${r.ahead ?? "?"} ahead, last commit ${r.lastCommitDays ?? "?"}d ago — push/bundle before removing${r.note ? ` (${r.note})` : ""}` });
    else if (["idle", "detached", "missing", "unreadable", "merged-pr-unprovable"].includes(r.state)) p.inspect.push({ path: r.path, branch: r.branch, reason: `${r.state}${r.note ? `: ${r.note}` : ""}` });
    else p.keep.push({ path: r.path, branch: r.branch, reason: r.note ? `${r.state}: ${r.note}` : r.state });
  }
  return p;
}

export function render(c) {
  const rows = c.worktrees;
  const cols = ["state", "branch", "ahead", "behind", "age(d)", "path"];
  const cells = rows.map((r) => [r.state, r.branch ?? "(detached)", r.ahead ?? "-", r.behind ?? "-", r.lastCommitDays ?? "-", r.path].map(String));
  const w = cols.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((x, i) => x.padEnd(w[i])).join("  ");
  const out = [`repo: ${c.repo}  base: ${c.base}  worktrees: ${rows.length}`, "", line(cols), line(w.map((n) => "-".repeat(n))), ...cells.map(line), ""];
  for (const [k, label] of [["removeSafe", "REMOVE-SAFE (proven merged; still your hand on the command)"], ["salvage", "SALVAGE FIRST"], ["inspect", "INSPECT"], ["keep", "KEEP"]]) {
    out.push(`${label}: ${c.plan[k].length}`);
    for (const e of c.plan[k]) out.push(`  ${e.path}  — ${e.reason}`);
  }
  const unproven = rows.filter((r) => r.note && r.note.startsWith("pr-proof")).length;
  if (unproven) out.push("", `${unproven} worktree(s) could not be checked for a squash merge (see notes) — not clears.`);
  out.push("", "Report only. Nothing was removed, pruned or fetched.");
  return out.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  let c;
  try { c = census(o.repo, o); } catch (e) { console.error(`worktree-census: ${e.message}`); process.exit(1); }
  console.log(o.json ? JSON.stringify(c, null, 2) : render(c));
}
