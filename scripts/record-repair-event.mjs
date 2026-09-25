#!/usr/bin/env node
// Record one typed repair-controller event from a JSON file. The controller computes candidate
// identity and evidence bindings; callers do not mint trusted pointers themselves.
//
// TWO FIELDS A CALLER MUST SUPPLY, AND HOW TO PICK THEM (aggregate_v2 events):
//   · `authority_route` — "owner" or "principal". Required on a `child_continuation` and inside the
//     `proposed_transition` of the `process_review` that precedes it. "owner" carries
//     `owner_evidence` (and no `principal_evidence`); "principal" is a bounded T2 Principal route
//     whose process-review proposal carries NO `principal_evidence` and whose continuation carries it.
//   · `proposed_transition.policy_version` — must EQUAL the version the recorder is about to mint for
//     this task, or the review is refused as malformed. The caller does not choose it; it derives it:
//     3 when the task's existing program — or, with no program, its pending child lineage — is a
//     policy-3 lineage or tier T3; otherwise 4 (every new program is 4). The event envelope's own
//     `policy_version` is minted by the recorder, never supplied.
// A mismatch in either is reported as `aggregate-process-review-malformed` or
// `aggregate-continuation-malformed`; the hint printed below names both fields.
//
// PRINCIPAL RECORD CHECK (v2.35.0). An event carrying `principal_evidence` is refused as
// `principal-authority-record-unconfirmed` unless the evidence is a plain object, its `decision_id`
// is non-empty, its `authority_record` is a git-TRACKED regular file of this repository, and the id
// occurs in that file as a token (no [A-Za-z0-9_-] either side). Checked HERE, at write time, and
// never at replay: the controller re-derives state from every row on every call, and a replay-time
// read of a mutable file would make a past event's validity depend on today's file contents. It
// proves an id is present in a tracked record, not that the record authorized this transition; a
// hand-written ledger row bypasses it.

import { execFileSync } from "node:child_process";
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

const TOKEN_CHAR = /[A-Za-z0-9_-]/;
export function principalRecordConfirmed(evidence, projectRoot) {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  const { authority_record: rel, decision_id: id } = evidence;
  if (typeof id !== "string" || !id.trim() || typeof rel !== "string" || !rel || path.isAbsolute(rel)) return false;
  try {
    const root = realpathSync(projectRoot);
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) || realpathSync(abs) !== abs || !lstatSync(abs).isFile()) return false;
    execFileSync("git", ["-C", root, "ls-files", "--error-unmatch", "--", path.relative(root, abs)], { stdio: "ignore" });
    const text = readFileSync(abs, "utf8");
    for (let at = text.indexOf(id); at !== -1; at = text.indexOf(id, at + 1)) {
      if (!TOKEN_CHAR.test(text[at - 1] ?? "") && !TOKEN_CHAR.test(text[at + id.length] ?? "")) return true;
    }
  } catch { /* unreadable, untracked, or not a repository: unconfirmed */ }
  return false;
}

export function recordEvent(input, options) {
  if (input.type === "aggregate_v2" && Object.hasOwn(input, "principal_evidence") &&
      !principalRecordConfirmed(input.principal_evidence, options?.projectRoot ?? process.cwd())) {
    return { ok: false, state: "principal-authority-record-unconfirmed" };
  }
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
          "aggregate-process-review-malformed": " — check the transition's shape, and above all the two fields callers most often get wrong: proposed_transition.policy_version must EQUAL the version this task mints (3 for a policy-3 or T3 lineage, otherwise 4), and a child_continuation proposal must carry authority_route (\"owner\" with owner_evidence, or \"principal\" with no principal_evidence yet); see this script's header",
          "aggregate-continuation-malformed": " — check the continuation's shape, and above all authority_route: \"owner\" with owner_evidence, or \"principal\" (a bounded T2 Principal route) with principal_evidence matching the reviewed transition; see this script's header",
          "principal-authority-record-unconfirmed": " — principal_evidence must be an object whose authority_record names a git-TRACKED file of this repository (repo-relative) and whose non-empty decision_id appears in that file as a whole token; commit the Principal's record into the checkout, then cite it",
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
