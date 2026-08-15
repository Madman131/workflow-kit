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
  const target = path.resolve(argValue(args, "--target") || DEFAULT_TARGET);
  if (!mode || (args.includes("--install") && args.includes("--check"))) {
    console.error("usage: sync-user-orchestrate-skill.mjs (--check|--install) [--target DIR]");
    process.exitCode = 2;
  } else {
    try {
      const result = mode === "install" ? installOrchestrate({ target }) : compareInstalled({ target });
      if (result.ok) console.log(`orchestrate user install is in sync: ${target}`);
      else {
        console.error(`orchestrate user install drift: ${result.drift.join(", ")}`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`orchestrate user install unsafe: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
