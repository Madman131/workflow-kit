// workflow-kit — tests for scripts/worktree-census.mjs. A planted repo with one worktree per state,
// classified by the same function the CLI runs. The squash proof is driven through an injected PR
// lookup so the test needs no network and no `gh`; the CLI is run once end-to-end for exit code
// and JSON shape. Both polarities on the load-bearing rule: a squash-merged branch is `merged` ONLY
// when its tree equals the squash commit's, and a later commit on it flips the verdict.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { census, plan } from "../scripts/worktree-census.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(KIT, "scripts", "worktree-census.mjs");

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, args, env = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...ENV, ...env }, stdio: ["ignore", "pipe", "pipe"] }).trim();
const commitFile = (cwd, name, msg, env = {}) => { writeFileSync(path.join(cwd, name), `${msg}\n`); git(cwd, ["add", name]); git(cwd, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], env); };

function plant() {
  const root = mkdtempSync(path.join(os.tmpdir(), "kit-census-"));
  const repo = path.join(root, "main");
  mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  commitFile(repo, "a.txt", "base");
  const wt = (name, branch) => { const p = path.join(root, name); git(repo, ["worktree", "add", "-q", "-b", branch, p, "main"]); return p; };

  // merged by a TRUE merge → ancestor proof
  const merged = wt("wt-merged", "feat-merged"); commitFile(merged, "m.txt", "merged work");
  git(repo, ["-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", "merge feat-merged", "feat-merged"]);
  // merged by SQUASH → needs the PR proof; branched AFTER the merge so its tree equals the squash commit's
  const squashed = wt("wt-squash", "feat-squash"); commitFile(squashed, "s.txt", "squash work");
  git(repo, ["merge", "--squash", "-q", "feat-squash"]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "squash feat-squash"]);
  const squashSha = git(repo, ["rev-parse", "HEAD"]);
  // squash-merged, then ANOTHER commit on the branch → tree differs → salvage
  const squashedPlus = wt("wt-squash-plus", "feat-squash-plus"); commitFile(squashedPlus, "p.txt", "landed");
  git(repo, ["merge", "--squash", "-q", "feat-squash-plus"]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "squash feat-squash-plus"]);
  const squashPlusSha = git(repo, ["rev-parse", "HEAD"]);
  commitFile(squashedPlus, "p2.txt", "after the merge");
  // unmerged, recent → merge-ready
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
  const idle = wt("wt-idle", "feat-idle");
  return { root, repo, squashSha, squashPlusSha, paths: { merged, squashed, squashedPlus, ready, stale, dirty, occupied, idle } };
}

test("every state is classified from git facts, and the squash proof needs tree equality", () => {
  const p = plant();
  try {
    const prLookup = (_repo, branch) => {
      if (branch === "feat-squash") return { available: true, merged: true, mergeCommit: p.squashSha, number: 7 };
      if (branch === "feat-squash-plus") return { available: true, merged: true, mergeCommit: p.squashPlusSha, number: 8 };
      return { available: true, merged: false, mergeCommit: null, number: null };
    };
    const c = census(p.repo, { base: "main", staleDays: 14, pr: true, prLookup });
    const byBranch = Object.fromEntries(c.worktrees.map((w) => [w.branch ?? "(main)", w]));
    assert.equal(c.worktrees[0].state, "main");
    assert.equal(byBranch["feat-merged"].state, "merged"); assert.equal(byBranch["feat-merged"].proof, "ancestor");
    assert.equal(byBranch["feat-squash"].state, "merged"); assert.match(byBranch["feat-squash"].proof, /squash PR #7/);
    assert.equal(byBranch["feat-squash-plus"].state, "merged-pr-tree-differs", "a commit after the squash merge is NOT proven merged");
    assert.equal(byBranch["feat-ready"].state, "merge-ready"); assert.equal(byBranch["feat-ready"].ahead, 1);
    assert.equal(byBranch["feat-stale"].state, "stale"); assert.ok(byBranch["feat-stale"].lastCommitDays >= 39);
    assert.equal(byBranch["feat-dirty"].state, "dirty");
    assert.equal(byBranch["feat-occupied"].state, "occupied"); assert.equal(byBranch["feat-occupied"].occupied.taskId, "live-task");
    assert.equal(byBranch["feat-idle"].state, "merged", "ahead 0 ⇒ ancestor ⇒ merged, the one case where ECC's rule and the proof agree");
    // The plan is a partition with reasons, and "remove-safe" holds ONLY the proven-merged ones.
    const pl = c.plan;
    assert.deepEqual(pl.removeSafe.map((e) => e.branch).sort(), ["feat-idle", "feat-merged", "feat-squash"]);
    assert.deepEqual(pl.salvage.map((e) => e.branch).sort(), ["feat-squash-plus", "feat-stale"]);
    assert.deepEqual(pl.inspect, []);
    assert.ok(pl.keep.some((e) => e.branch === "feat-dirty") && pl.keep.some((e) => e.branch === "feat-occupied") && pl.keep.some((e) => e.branch === "main"));
    const total = pl.removeSafe.length + pl.salvage.length + pl.inspect.length + pl.keep.length;
    assert.equal(total, c.worktrees.length, "the plan partitions every worktree exactly once");

    // POLARITY on the proof: without a PR lookup the squash branch is NOT merged and the note says why.
    const noPr = census(p.repo, { base: "main", staleDays: 14, pr: true, prLookup: () => ({ available: false, merged: false, mergeCommit: null, number: null }) });
    const sq = noPr.worktrees.find((w) => w.branch === "feat-squash");
    assert.notEqual(sq.state, "merged", "an unprovable squash is never reported merged");
    assert.match(sq.note, /pr-proof unavailable/);
    // …and its plan bucket follows the verdict: unproven ⇒ not remove-safe.
    assert.ok(!noPr.plan.removeSafe.some((e) => e.branch === "feat-squash"));
  } finally { rmSync(p.root, { recursive: true, force: true }); }
});

test("the CLI runs end to end: exit 0, JSON shape, --no-pr note, and a bad flag is refused", () => {
  const p = plant();
  try {
    const r = spawnSync(process.execPath, [CLI, "--repo", p.repo, "--base", "main", "--json", "--no-pr"], { encoding: "utf8", env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(r.stdout);
    assert.equal(c.base, "main"); assert.ok(Array.isArray(c.worktrees) && c.worktrees.length === 9);
    assert.ok(c.worktrees.every((w) => typeof w.state === "string"));
    assert.ok(c.worktrees.some((w) => w.note === "pr-proof skipped (--no-pr)"));
    const text = spawnSync(process.execPath, [CLI, "--repo", p.repo, "--base", "main", "--no-pr"], { encoding: "utf8", env: ENV });
    assert.equal(text.status, 0); assert.match(text.stdout, /Report only\. Nothing was removed/);
    assert.match(text.stdout, /REMOVE-SAFE/); assert.match(text.stdout, /SALVAGE FIRST/);
    const bad = spawnSync(process.execPath, [CLI, "--bogus"], { encoding: "utf8", env: ENV });
    assert.equal(bad.status, 2);
    // plan() is a pure partition — an empty census yields four empty buckets, never a throw.
    assert.deepEqual(plan([]), { removeSafe: [], salvage: [], keep: [], inspect: [] });
  } finally { rmSync(p.root, { recursive: true, force: true }); }
});
