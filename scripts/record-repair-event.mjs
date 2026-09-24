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
  recordAdherenceAudit, recordAggregateEvent, recordOwnerExtension, recordRepairClose, recordRootCauseExit,
  recordRoundDisposition,
} = await import(pathToFileURL(controllerPath).href);

function readInput(file) {
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("event input must be a regular file, not a symlink");
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("event input must be a JSON object");
  return parsed;
}

export function recordEvent(input, options) {
  if (input.type === "aggregate_v2") {
    // An older installed controller predating the aggregate grammar exports no
    // recordAggregateEvent — a typed refusal, never a TypeError: version skew between the
    // recorder and the controller is a deploy-order fact the operator can act on.
    if (typeof recordAggregateEvent !== "function") {
      return { ok: false, state: "repair-controller-version-skew" };
    }
    return recordAggregateEvent(input, options);
  }
  if (input.type === "round_disposition") return recordRoundDisposition(input, options);
  if (input.type === "root_cause_exit") return recordRootCauseExit(input, options);
  if (input.type === "adherence_audit") return recordAdherenceAudit(input, options);
  if (input.type === "owner_extension") return recordOwnerExtension(input, options);
  if (input.type === "repair_close") return recordRepairClose(input, options);
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
        const action = {
          "repair-session-missing": ` — add the current session as \"session_id\" in ${args[at + 1]} (or set WORKFLOW_KIT_SESSION_ID)`,
          "repair-controller-version-skew": " — the installed controller beside this recorder predates the aggregate grammar; upgrade the install (init --force; then run node scripts/check-codex-hooks-armed.mjs for the Codex lane) before recording aggregate events",
          "aggregate-close-self-authorized": " — this close's session id is one the program ADMITTED as a worker (a verification or handoff replacement); record the close from a session distinct from every admitted worker (degraded mode: the Owner's keyboard)",
          "aggregate-terminal": " — the program is terminal (GO, STOP, or Owner-closed); continuation is a typed child_continuation successor, never another round",
          "aggregate-continuation-action-screen-required": " — a successor is a SCREENED recommendation, not an automatic route: the child_continuation must carry a structured action_screen {surviving_finding_ids:[...], harm, trigger, smallest_action, kiss, zoom_out} (each a non-empty string; ids may be empty for a GO-lineage follow-on). Screen the ACTION against RULE #1 / KISS / zoom-out BEFORE minting it (screen-at-emission)",
          "aggregate-worker-required": " — the current batch's brief is confirmed but no worker session is admitted; run confirm-repair-brief.mjs --verify from the working session first",
          "repair-close-self-authorized": " — this close is not eligible: an eligible close names a close-kind owner_extension at the CURRENT round and candidate, and NEITHER that row NOR the close itself may carry a session id this program admitted as a worker. One of yours does. The check compares supplied session IDS, not actors",
          "repair-close-unauthorized": ' — record an owner_extension with "authority_kind":"close" at the CURRENT round and candidate, from a session this program has not admitted as a worker, then name its exact event_id as "owner_close_event_id"',
          "aggregate-dispatch-unavailable": " — no accepted CONTINUE disposition currently authorizes a batch: the program is terminal, the round is already dispatched, or the cited disposition/panel-close ids do not bind the winning rows; derive the program state and re-read its latest disposition",
          "aggregate-root-exit-required": " — this dispatch cites a ROOT-KIND disposition (root_replacement, simplification or split, any round), so it must carry that disposition's exact root_exit event id",
          "aggregate-root-exit-unexpected": " — only a root-kind dispatch may carry a root_exit event id; drop the field or fix the disposition's remediation kind",
          "aggregate-process-review-required": " — record a fresh aggregate_v2 process_review with the transition's exact purpose, current typed anchor, and proposed_transition; then cite its event id. Only a dispatch-purpose finish_bounded_root authorizes repair dispatch",
          "aggregate-worker-superseded": " — this session's admission was REVOKED by an Owner-evidenced worker handoff; the replacement session holds the batch now",
          "repair-ledger-lock-unsupported": " — this host cannot safely serialize current handoff-affecting mutations; use a verified macOS lockf host or hold the transition pending a supported platform cutover. Reads and replay remain available",
          "repair-ledger-lock-busy": " — another current writer holds the Git-common ledger lock; retry the same event after that writer finishes. Never delete the lock file",
          "repair-ledger-lock-unavailable": " — the Git-common lock could not be opened or held; check lockf capability, regular-file identity and ledger permissions. Never delete/recreate a supposedly stale lock file",
          "repair-history-invalid": " — the ledger's derivation failed CLOSED (a corrupt row, a hash mismatch, or a standard identity that no longer derives); this needs row-level repair, not a retry — preserve the file and inspect it",
        }[result.state] ?? (
          // The closed grammar makes the remaining two suffix classes total: shape refusals and
          // first-wins/citation refusals. Name the class so no aggregate state ships bare.
          /-malformed$/.test(result.state) ? " — the event failed TOTAL shape validation before any transition was judged; compare the input field-by-field against its kind's bind list in the design contract (a `detail` field, when present below, names the failed precondition class)"
          : /-conflict$/.test(result.state) ? " — the transition lost first-wins adjudication or an exact reference does not bind the current winning rows; derive the program state and re-derive every cited event id from the WINNERS, never from your own last write"
          : "");
        console.error(`repair event rejected: ${result.state}${result.expected ? ` (expected ${result.expected})` : ""}${result.detail ? ` [${result.detail}]` : ""}${action}`);
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
