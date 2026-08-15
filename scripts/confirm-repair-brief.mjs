#!/usr/bin/env node
// Confirm or verify one persisted repair brief. The controller reads the brief bytes itself;
// callers never supply a trusted hash.

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const controllerPath = [
  path.resolve(HERE, "../hooks/repair-dispatch-state.mjs"),
  path.resolve(HERE, "../.claude/hooks/repair-dispatch-state.mjs"),
  path.resolve(HERE, "../.codex/hooks/repair-dispatch-state.mjs"),
].find((candidate) => existsSync(candidate));
if (!controllerPath) throw new Error("repair controller is not installed beside this confirmer");
const { confirmRepairBrief, recordWorkerVerification } = await import(pathToFileURL(controllerPath).href);

function readInput(file) {
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("input must be a regular JSON file, not a symlink");
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input must be a JSON object");
  return parsed;
}

export function run(input, mode, options) {
  if (mode === "--confirm") return confirmRepairBrief(input, options);
  if (mode === "--verify") return recordWorkerVerification(input, options);
  return { ok: false, state: "repair-brief-mode-unsupported" };
}

const entry = process.argv[1]
  ? (() => { try { return realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } })()
  : null;
if (entry && entry === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const mode = ["--confirm", "--verify"].find((flag) => args.includes(flag));
  const at = mode ? args.indexOf(mode) : -1;
  if (at === -1 || !args[at + 1] || args.length !== 2) {
    console.error("usage: confirm-repair-brief.mjs (--confirm|--verify) INPUT.json");
    process.exitCode = 2;
  } else {
    try {
      const input = readInput(path.resolve(args[at + 1]));
      const result = run(input, mode, {
        projectRoot: process.cwd(),
        sessionId: process.env.WORKFLOW_KIT_SESSION_ID || input.session_id,
      });
      if (!result.ok) {
        const action = result.state === "repair-worker-session-missing"
          ? ` — add the current hook session as \"session_id\" in ${args[at + 1]} (or set WORKFLOW_KIT_SESSION_ID)`
          : "";
        console.error(`repair brief rejected: ${result.state}${action}`);
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify(result));
      }
    } catch (error) {
      console.error(`repair brief unavailable: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
