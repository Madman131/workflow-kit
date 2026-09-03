// workflow-kit — tests for scripts/worktree-census.mjs. A planted repo with one worktree per state,
// classified by the same function the CLI runs. The squash proof is driven through an injected PR
// lookup so the test needs no network and no `gh`; the CLI is run once end-to-end for exit code
// and JSON shape. Both polarities on the load-bearing rule: a squash-merged branch is `merged` ONLY
// when the patch that landed equals the patch the branch carries — an unrelated base commit between
// fork and merge does not break it, a commit added after the merge does, a PR into another base
// proves nothing, and a merge commit missing locally is "unprovable", never "clear".

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseBranchName, census, plan } from "../scripts/worktree-census.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(KIT, "scripts", "worktree-census.mjs");

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, args, env = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...ENV, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
const commitFile = (cwd, name, msg, env = {}) => { writeFileSync(path.join(cwd, name), `${msg}\n`); git(cwd, ["add", name]); git(cwd, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], env); };
const squashInto = (repo, branch) => { git(repo, ["merge", "--squash", "-q", branch]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", `squash ${branch}`]); return git(repo, ["rev-parse", "HEAD"]); };

function plant() {
  const root = mkdtempSync(path.join(os.tmpdir(), "kit-census-"));
  const repo = path.join(root, "main");
  mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  commitFile(repo, "a.txt", "base");
  const wt = (name, branch, extra = []) => { const p = path.join(root, name); git(repo, ["worktree", "add", "-q", ...(branch ? ["-b", branch] : ["--detach"]), p, "main", ...extra]); return p; };
  const shas = {};
  // merged by a TRUE merge → ancestor proof
  const merged = wt("wt-merged", "feat-merged"); commitFile(merged, "m.txt", "merged work");
  git(repo, ["-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", "merge feat-merged", "feat-merged"]);
  // squash-merged, base untouched in between → patch-id match
  const squashed = wt("wt-squash", "feat-squash"); commitFile(squashed, "s.txt", "squash work");
  shas.squash = squashInto(repo, "feat-squash");
  // squash-merged AFTER the base moved on with an unrelated commit → still a patch-id match
  const moved = wt("wt-squash-moved", "feat-squash-moved"); commitFile(moved, "mv.txt", "moved work");
  commitFile(repo, "unrelated.txt", "base moved on");
  shas.squashMoved = squashInto(repo, "feat-squash-moved");
  // squash-merged, then ANOTHER commit on the branch → content differs → salvage
  const squashedPlus = wt("wt-squash-plus", "feat-squash-plus"); commitFile(squashedPlus, "p.txt", "landed");
  shas.squashPlus = squashInto(repo, "feat-squash-plus");
  commitFile(squashedPlus, "p2.txt", "after the merge");
  // unmerged, recent → merge-ready (also the wrong-base PR probe)
  const ready = wt("wt-ready", "feat-ready"); commitFile(ready, "r.txt", "ready work");
  // unmerged, OLD → stale
  const stale = wt("wt-stale", "feat-stale");
  const old = new Date(Date.now() - 40 * 86400e3).toISOString();
  commitFile(stale, "st.txt", "old work", { GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old });
  // dirty
  const dirty = wt("wt-dirty", "feat-dirty"); writeFileSync(path.join(dirty, "scratch.txt"), "uncommitted\n");
  // occupied — a live lane declaration wins over everything else
  const occupied = wt("wt-occupied", "feat-occupied"); mkdirSync(path.join(occupied, ".claude"));
  writeFileSync(path.join(occupied, ".claude", "task-lane.json"), JSON.stringify({ mode: "in-thread", sessionId: "s", taskId: "live-task", tier: "T1" }));
  // a fresh branch with no commits of its own: its tip IS an ancestor of the base → merged (ancestor)
  wt("wt-fresh", "feat-fresh");
  // detached and locked
  wt("wt-detached", null);
  const locked = wt("wt-locked", "feat-locked"); commitFile(locked, "l.txt", "locked work"); git(repo, ["worktree", "lock", locked]);
  return { root, repo, shas };
}

test("every state is classified from git facts, and the squash proof needs a base-scoped PR plus a patch-id match", () => {
  const p = plant();
  try {
    const calls = [];
    const prLookup = (_repo, branch, baseBranch) => {
      calls.push([branch, baseBranch]);
      if (baseBranch !== "main") return { available: true, merged: false, mergeCommit: null, number: null };
      if (branch === "feat-squash") return { available: true, merged: true, mergeCommit: p.shas.squash, number: 7 };
      if (branch === "feat-squash-moved") return { available: true, merged: true, mergeCommit: p.shas.squashMoved, number: 8 };
      if (branch === "feat-squash-plus") return { available: true, merged: true, mergeCommit: p.shas.squashPlus, number: 9 };
      if (branch === "feat-stale") return { available: true, merged: true, mergeCommit: "0".repeat(40), number: 10 };   // merged upstream, object not local
      return { available: true, merged: false, mergeCommit: null, number: null };
    };
    const c = census(p.repo, { base: "main", staleDays: 14, pr: true, prLookup });
    const byBranch = Object.fromEntries(c.worktrees.map((w) => [w.branch ?? `(${w.state})`, w]));
    assert.ok(calls.every(([, b]) => b === "main"), "the PR lookup is scoped to the base BRANCH");
    assert.equal(c.worktrees[0].state, "main");
    assert.equal(byBranch["feat-merged"].state, "merged"); assert.equal(byBranch["feat-merged"].proof, "ancestor");
    assert.equal(byBranch["feat-squash"].state, "merged"); assert.match(byBranch["feat-squash"].proof, /squash PR #7 \(patch-id match\)/);
    assert.equal(byBranch["feat-squash-moved"].state, "merged", "an unrelated base commit between fork and squash does not break the proof");
    assert.equal(byBranch["feat-squash-plus"].state, "merged-pr-content-differs", "a commit after the squash merge is NOT proven merged");
    assert.equal(byBranch["feat-stale"].state, "merged-pr-unprovable", "a merge commit missing locally is unprovable, never clear");
    assert.equal(byBranch["feat-ready"].state, "merge-ready"); assert.equal(byBranch["feat-ready"].ahead, 1);
    assert.equal(byBranch["feat-dirty"].state, "dirty");
    assert.equal(byBranch["feat-occupied"].state, "occupied"); assert.equal(byBranch["feat-occupied"].occupied.taskId, "live-task");
    assert.equal(byBranch["feat-fresh"].state, "merged", "ahead 0 ⇒ ancestor ⇒ merged");
    assert.equal(byBranch["(detached)"].state, "detached");
    assert.equal(byBranch["feat-locked"].state, "locked");
    const pl = c.plan;
    assert.deepEqual(pl.removeSafe.map((e) => e.branch).sort(), ["feat-fresh", "feat-merged", "feat-squash", "feat-squash-moved"]);
    assert.deepEqual(pl.salvage.map((e) => e.branch).sort(), ["feat-squash-plus"]);
    assert.deepEqual(pl.inspect.map((e) => e.branch ?? "(detached)").sort(), ["(detached)", "feat-stale"]);
    assert.ok(["feat-dirty", "feat-occupied", "feat-locked", "main"].every((b) => pl.keep.some((e) => e.branch === b)));
    const total = pl.removeSafe.length + pl.salvage.length + pl.inspect.length + pl.keep.length;
    assert.equal(total, c.worktrees.length, "the plan partitions every worktree exactly once");

    // POLARITY on the proof: a lookup that CANNOT see (gh absent) leaves the squash branch unmerged and says why.
    const noPr = census(p.repo, { base: "main", staleDays: 14, pr: true, prLookup: () => ({ available: false, merged: false, mergeCommit: null, number: null }) });
    const sq = noPr.worktrees.find((w) => w.branch === "feat-squash");
    assert.notEqual(sq.state, "merged"); assert.match(sq.note, /pr-proof unavailable/);
    assert.ok(!noPr.plan.removeSafe.some((e) => e.branch === "feat-squash"));
    // …and a PR merged into ANOTHER base proves nothing here: the base-scoped lookup returns no PR.
    const wrongBase = census(p.repo, { base: "main", staleDays: 14, pr: true, prLookup: (_r, b, base) => (b === "feat-squash" && base === "develop" ? { available: true, merged: true, mergeCommit: p.shas.squash, number: 1 } : { available: true, merged: false, mergeCommit: null, number: null }) });
    assert.equal(wrongBase.worktrees.find((w) => w.branch === "feat-squash").state, "merge-ready");
    // The stale branch, with no PR at all, is stale (floor days, 40 ≥ 14).
    assert.equal(wrongBase.worktrees.find((w) => w.branch === "feat-stale").state, "stale");
  } finally { rmSync(p.root, { recursive: true, force: true }); }
});

test("the CLI runs end to end: exit 0, JSON shape, --no-pr note, and bad arguments are refused", () => {
  const p = plant();
  try {
    const r = spawnSync(process.execPath, [CLI, "--repo", p.repo, "--base", "main", "--json", "--no-pr"], { encoding: "utf8", env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(r.stdout);
    assert.equal(c.base, "main"); assert.ok(Array.isArray(c.worktrees) && c.worktrees.length === 12, `12 worktrees planted, got ${c.worktrees.length}`);
    assert.ok(c.worktrees.every((w) => typeof w.state === "string"));
    assert.ok(c.worktrees.some((w) => w.note === "pr-proof skipped (--no-pr)"));
    const text = spawnSync(process.execPath, [CLI, "--repo", p.repo, "--base", "main", "--no-pr"], { encoding: "utf8", env: ENV });
    assert.equal(text.status, 0); assert.match(text.stdout, /Report only\. Nothing was removed/);
    for (const args of [["--bogus"], ["--base", "--json"], ["--repo"]]) {
      const bad = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: ENV });
      assert.equal(bad.status, 2, `refused: ${args.join(" ")}`);
    }
    assert.deepEqual(plan([]), { removeSafe: [], salvage: [], keep: [], inspect: [] });
    assert.equal(baseBranchName("origin/main"), "main"); assert.equal(baseBranchName("main"), "main"); assert.equal(baseBranchName("refs/remotes/origin/develop"), "develop");
  } finally { rmSync(p.root, { recursive: true, force: true }); }
});
