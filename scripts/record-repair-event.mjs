#!/usr/bin/env node
// Record one typed repair-controller event from a JSON file. The controller computes candidate
// identity and evidence bindings; callers do not mint trusted pointers themselves.

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const controllerPath = [
  path.resolve(HERE, "../hooks/repair-dispatch-state.mjs"),
  path.resolve(HERE, "../.claude/hooks/repair-dispatch-state.mjs"),
  path.resolve(HERE, "../.codex/hooks/repair-dispatch-state.mjs"),
].find((candidate) => existsSync(candidate));
if (!controllerPath) throw new Error("repair controller is not installed beside this recorder");
const {
  recordAdherenceAudit, recordOwnerExtension, recordRootCauseExit, recordRoundDisposition,
} = await import(pathToFileURL(controllerPath).href);

function readInput(file) {
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("event input must be a regular file, not a symlink");
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("event input must be a JSON object");
  return parsed;
}

export function recordEvent(input, options) {
  if (input.type === "round_disposition") return recordRoundDisposition(input, options);
  if (input.type === "root_cause_exit") return recordRootCauseExit(input, options);
  if (input.type === "adherence_audit") return recordAdherenceAudit(input, options);
  if (input.type === "owner_extension") return recordOwnerExtension(input, options);
  return { ok: false, state: "repair-event-type-unsupported" };
}

const entry = process.argv[1]
  ? (() => { try { return realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } })()
  : null;
if (entry && entry === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--event");
  if (at === -1 || !args[at + 1] || args.length !== 2) {
    console.error("usage: record-repair-event.mjs --event EVENT.json");
    process.exitCode = 2;
  } else {
    try {
      const input = readInput(path.resolve(args[at + 1]));
      const sessionId = process.env.WORKFLOW_KIT_SESSION_ID || input.session_id;
      const result = recordEvent(input, {
        projectRoot: process.cwd(),
        sessionId,
      });
      if (!result.ok) {
        const action = result.state === "repair-session-missing"
          ? ` — add the current session as \"session_id\" in ${args[at + 1]} (or set WORKFLOW_KIT_SESSION_ID)`
          : "";
        console.error(`repair event rejected: ${result.state}${result.expected ? ` (expected ${result.expected})` : ""}${action}`);
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify(result));
      }
    } catch (error) {
      console.error(`repair event unavailable: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
