#!/usr/bin/env node
// Keep the user-installed /orchestrate package byte-identical to workflow-kit's canonical source.
// Shape is mechanical: this tool never judges doctrine. A stale installed method is a cross-repo
// process split, so drift is a failing check rather than an informational warning.

import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORCHESTRATE_FILES = ["SKILL.md", "CHIP_BRIEF.md", "PROTOCOLS.md", "RUNG_ZERO.md"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SOURCE = path.join(ROOT, "skills", "orchestrate");
export const DEFAULT_TARGET = path.join(os.homedir(), ".agents", "skills", "orchestrate");
// Claude loads its own user copy from ~/.claude. Syncing only ~/.agents left that copy a release
// behind while this check read green, so with no --target both copies are installed and checked.
export const CLAUDE_TARGET = path.join(os.homedir(), ".claude", "skills", "orchestrate");
export const DEFAULT_TARGETS = [DEFAULT_TARGET, CLAUDE_TARGET];

function regularFile(file) {
  try {
    const st = lstatSync(file);
    return st.isFile() && !st.isSymbolicLink();
  } catch { return false; }
}

function safeDirectory(dir, { create = false } = {}) {
  if (!existsSync(dir)) {
    if (!create) return false;
    mkdirSync(dir, { recursive: true });
  }
  const st = lstatSync(dir);
  return st.isDirectory() && !st.isSymbolicLink();
}

export function compareInstalled({ source = DEFAULT_SOURCE, target = DEFAULT_TARGET } = {}) {
  if (!safeDirectory(source) || !safeDirectory(target)) return { ok: false, drift: ["<directory>"] };
  const drift = [];
  for (const name of ORCHESTRATE_FILES) {
    const src = path.join(source, name);
    const dst = path.join(target, name);
    if (!regularFile(src) || !regularFile(dst) || !readFileSync(src).equals(readFileSync(dst))) drift.push(name);
  }
  return { ok: drift.length === 0, drift };
}

function atomicCopy(src, dst) {
  const tmp = `${dst}.tmp-${process.pid}-${Date.now()}`;
  const data = readFileSync(src);
  let fd;
  try {
    fd = openSync(tmp, "wx", 0o600);
    writeSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, dst);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tmp); } catch {}
  }
}

export function installOrchestrate({ source = DEFAULT_SOURCE, target = DEFAULT_TARGET } = {}) {
  if (!safeDirectory(source) || !safeDirectory(target, { create: true })) {
    throw new Error("source and target must be real directories, not symlinks");
  }
  for (const name of ORCHESTRATE_FILES) {
    const src = path.join(source, name);
    const dst = path.join(target, name);
    if (!regularFile(src)) throw new Error(`canonical source is not a regular file: ${name}`);
    if (existsSync(dst) && !regularFile(dst)) throw new Error(`installed target is not a regular file: ${name}`);
    atomicCopy(src, dst);
  }
  return compareInstalled({ source, target });
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const mode = args.includes("--install") ? "install" : args.includes("--check") ? "check" : null;
  const explicit = argValue(args, "--target");
  // A default copy that was never installed is absent, not stale: check skips it, but at least one
  // must exist. An explicit --target is always checked.
  const present = DEFAULT_TARGETS.filter((t) => existsSync(t));
  const targets = explicit ? [path.resolve(explicit)]
    : mode === "check" && present.length > 0 ? present : DEFAULT_TARGETS;
  if (!mode || (args.includes("--install") && args.includes("--check"))) {
    console.error("usage: sync-user-orchestrate-skill.mjs (--check|--install) [--target DIR]");
    process.exitCode = 2;
  } else {
    for (const target of targets) {
      try {
        const result = mode === "install" ? installOrchestrate({ target }) : compareInstalled({ target });
        if (result.ok) console.log(`orchestrate user install is in sync: ${target}`);
        else {
          console.error(`orchestrate user install drift: ${target}: ${result.drift.join(", ")}`);
          process.exitCode = Math.max(process.exitCode ?? 0, 1);
        }
      } catch (error) {
        console.error(`orchestrate user install unsafe: ${target}: ${error.message}`);
        process.exitCode = 2;
      }
    }
  }
}
