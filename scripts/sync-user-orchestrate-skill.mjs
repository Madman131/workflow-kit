#!/usr/bin/env node
// Keep user-installed method packages byte-identical to workflow-kit's canonical source. Shape is
// mechanical: this tool never judges doctrine. `/orchestrate` keeps its historical default surface;
// the architecture pair is explicit because a pre-existing /architect-build may be user-owned.

import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORCHESTRATE_FILES = ["SKILL.md", "CHIP_BRIEF.md", "PROTOCOLS.md", "RUNG_ZERO.md"];
export const ARCHITECT_BUILD_FILES = ["SKILL.md", "ROUTING.md"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SOURCE = path.join(ROOT, "skills", "orchestrate");
export const DEFAULT_TARGET = path.join(os.homedir(), ".agents", "skills", "orchestrate");
// Claude loads its own user copy from ~/.claude. Syncing only ~/.agents left that copy a release
// behind while this check read green, so with no --target both copies are installed and checked.
export const CLAUDE_TARGET = path.join(os.homedir(), ".claude", "skills", "orchestrate");
export const DEFAULT_TARGETS = [DEFAULT_TARGET, CLAUDE_TARGET];
export const ARCHITECT_BUILD_SOURCE = path.join(ROOT, "skills", "architect-build");
export const ARCHITECT_BUILD_TARGET = path.join(os.homedir(), ".agents", "skills", "architect-build");
export const CLAUDE_ARCHITECT_BUILD_TARGET = path.join(os.homedir(), ".claude", "skills", "architect-build");
export const ARCHITECT_BUILD_TARGETS = [ARCHITECT_BUILD_TARGET, CLAUDE_ARCHITECT_BUILD_TARGET];

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

export function compareInstalled({ source = DEFAULT_SOURCE, target = DEFAULT_TARGET, files = ORCHESTRATE_FILES } = {}) {
  if (!safeDirectory(source) || !safeDirectory(target)) return { ok: false, drift: ["<directory>"] };
  const drift = [];
  for (const name of files) {
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

function installPackage({ source, target, files }) {
  if (!safeDirectory(source) || !safeDirectory(target, { create: true })) {
    throw new Error("source and target must be real directories, not symlinks");
  }
  for (const name of files) {
    const src = path.join(source, name);
    const dst = path.join(target, name);
    if (!regularFile(src)) throw new Error(`canonical source is not a regular file: ${name}`);
    if (existsSync(dst) && !regularFile(dst)) throw new Error(`installed target is not a regular file: ${name}`);
    atomicCopy(src, dst);
  }
  return compareInstalled({ source, target, files });
}

export function installOrchestrate({ source = DEFAULT_SOURCE, target = DEFAULT_TARGET } = {}) {
  return installPackage({ source, target, files: ORCHESTRATE_FILES });
}

export function compareArchitectBuildInstalled({ source = ARCHITECT_BUILD_SOURCE, target = ARCHITECT_BUILD_TARGET } = {}) {
  return compareInstalled({ source, target, files: ARCHITECT_BUILD_FILES });
}

function assertArchitectBuildInstallSafe({ source, target, force = false }) {
  if (!safeDirectory(source)) throw new Error("canonical source is not a real directory");
  if (!existsSync(target)) return;
  if (!safeDirectory(target)) throw new Error("installed target is not a real directory, not a symlink");
  for (const name of ARCHITECT_BUILD_FILES) {
    const src = path.join(source, name);
    const dst = path.join(target, name);
    if (!regularFile(src)) throw new Error(`canonical source is not a regular file: ${name}`);
    if (!existsSync(dst)) continue;
    if (!regularFile(dst)) throw new Error(`installed target is not a regular file: ${name}`);
    if (!readFileSync(src).equals(readFileSync(dst)) && !force) {
      throw new Error(`refusing to replace existing architect-build ${name}; preserve it or re-run the explicit architecture-pair install with --force`);
    }
  }
}

export function installArchitectBuild({ source = ARCHITECT_BUILD_SOURCE, target = ARCHITECT_BUILD_TARGET, force = false } = {}) {
  assertArchitectBuildInstallSafe({ source, target, force });
  return installPackage({ source, target, files: ARCHITECT_BUILD_FILES });
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const mode = args.includes("--install") ? "install" : args.includes("--check") ? "check" : null;
  const explicit = argValue(args, "--target");
  const architecturePair = args.includes("--architecture-pair");
  const force = args.includes("--force");
  // The established no-flag command remains /orchestrate-only. The explicit pair prevents one
  // architecture half from reading green against the other harness's orchestrate half.
  const orchestrate = { name: "orchestrate", source: DEFAULT_SOURCE, files: ORCHESTRATE_FILES, targets: DEFAULT_TARGETS };
  const architectBuild = { name: "architect-build", source: ARCHITECT_BUILD_SOURCE, files: ARCHITECT_BUILD_FILES, targets: ARCHITECT_BUILD_TARGETS };
  const packages = explicit ? [{ ...orchestrate, targets: [path.resolve(explicit)] }]
    : architecturePair ? [orchestrate, architectBuild] : [orchestrate];
  const anyPresent = !explicit && packages.some((p) => p.targets.some((t) => existsSync(t)));
  if (!mode || (args.includes("--install") && args.includes("--check")) || (architecturePair && explicit)) {
    console.error("usage: sync-user-orchestrate-skill.mjs (--check|--install) [--target ORCHESTRATE_DIR] [--architecture-pair [--force]]");
    process.exitCode = 2;
  } else {
    // Refuse all unforced architect replacements before an architecture-pair install writes either
    // package. A user-created regular file is indistinguishable from an old managed copy, so force
    // is the explicit ownership decision for an update or takeover.
    if (mode === "install" && architecturePair) {
      try {
        for (const target of ARCHITECT_BUILD_TARGETS) {
          assertArchitectBuildInstallSafe({ source: ARCHITECT_BUILD_SOURCE, target, force });
        }
      } catch (error) {
        console.error(`architect-build user install unsafe: ${error.message}`);
        process.exitCode = 2;
      }
    }
    for (const pkg of packages) {
      const present = pkg.targets.filter((t) => existsSync(t));
      // Historic /orchestrate checks ignore a never-installed sibling. An explicit architecture
      // pair checks every one of its four destinations, so crossed installs cannot report parity.
      const targets = mode === "check" && !explicit && !architecturePair && anyPresent && present.length > 0 ? present : pkg.targets;
      for (const target of targets) {
        if (process.exitCode === 2) continue;
        try {
          const result = mode === "install"
            ? pkg.name === "architect-build"
              ? installArchitectBuild({ source: pkg.source, target, force })
              : installPackage({ source: pkg.source, target, files: pkg.files })
            : compareInstalled({ source: pkg.source, target, files: pkg.files });
          if (result.ok) console.log(`${pkg.name} user install is in sync: ${target}`);
          else {
            console.error(`${pkg.name} user install drift: ${target}: ${result.drift.join(", ")}`);
            process.exitCode = Math.max(process.exitCode ?? 0, 1);
          }
        } catch (error) {
          console.error(`${pkg.name} user install unsafe: ${target}: ${error.message}`);
          process.exitCode = 2;
        }
      }
    }
  }
}
