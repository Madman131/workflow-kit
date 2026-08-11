#!/usr/bin/env node
// workflow-kit — .claude/hooks/guard-owner-comms.mjs. A Claude Code **Stop** hook: the mechanical
// half of rule 1 of `core/OWNER_COMMS.md` § "How to talk to <Owner> — Owner, not a developer".
//
// THIS IS A SENSOR, NOT A CONTROL. It **FAILS OPEN** — every parse error, missing field, unreadable
// transcript, absent or unfinished `core/OWNER_COMMS.md`, and every unrecognized shape ALLOWS. A
// clean run therefore proves NOTHING about a message. Do not describe it as enforcement anywhere
// (`PORTABILITY.md` § the Owner-comms sensor; `core/INVARIANTS.md` epistemic rules 2 & 10 — a control
// believed to enforce something it does not is worse than no control).
//
// WHY IT EXISTS: rule 1 already said "answer first, in one sentence" when an Owner asked a three-word
// question and got ~500 words of unrequested inventory, then had to reply "give me the short
// version". The rule was in context and lost. A prompt is not a control, and an "acknowledge you read
// the rules" ritual is worse than nothing — an agent asked to acknowledge always acknowledges. So
// this does not ask whether the rules were read; it looks at what was actually produced.
//
// WHAT IT CANNOT DO — stated plainly. A Stop hook fires AFTER the final message has been generated
// and shown. Blocking does NOT retract it; it forces the agent to emit an ADDITIONAL message. So the
// Owner sees the over-long answer and then a corrected one — mechanically the "give me the short
// version" round-trip they were doing by hand, minus the asking. That is the real benefit and the
// honest limit. It is why the block text asks for a corrected FOLLOW-UP: an agent that believes the
// original was suppressed writes a replacement, which lands as a non-sequitur.
//
// WHAT IT CHECKS — the FINAL assistant message only, which is the ANSWER. Mid-turn preambles before a
// tool call ("let me check the config") are useful narration and are deliberately NOT inspected; the
// same words in the closing message mean the answer is narrating work instead of reporting it.
//   1. NARRATION in the final message — announcing work rather than stating the result.
//   2. SIZE MISMATCH — a short question answered at length.
//   3. UNLABELED ASK (rule 8) — a line ending in "?" in a message carrying no labeled lead at all.
//
// WHAT CHECK 3 IS NOT, said plainly because the release that added it is about honest claims. The
// Owner's complaint was three words — keep it succinct · avoid walls of text · use bullets and
// tables — and **check 3 mechanizes NONE of them.** It covers rule 8 (an ask must be findable),
// which came from the same conversation but is a fourth thing. All three of those words are
// doctrine only, in `core/OWNER_COMMS.md` rules 1, 6 and 9. The wall-of-text check that WOULD have
// covered one of them was designed and deliberately NOT built: its threshold cannot be calibrated
// without a corpus of real Owner-facing messages to measure a false-positive rate against, and an
// over-firing fail-open sensor teaches people to switch it off. "The sensor was extended" without
// this paragraph would imply the complaint was mechanized. It was not.
//
// WHY FAIL OPEN, when this kit's write guards fail CLOSED: those fail closed because the cost of a
// wrong write is unrecoverable. Here the cost of a wrong BLOCK is a wedged session that cannot finish
// a turn. A comms nudge must never be able to stop work.
//
// PARAMETERIZATION — the sensor is repo-agnostic; everything Owner-specific is READ FROM the
// generated `core/OWNER_COMMS.md` (a `[G]` doc), never baked in:
//   · the Owner's NAME, from the `## How to talk to <name> — Owner, not a developer` heading;
//   · the Owner's QUESTION SHORTHAND, from the `` `TOKEN` = gloss `` definitions — one per line or
//     inline in prose, both are real adopter formats. A token whose gloss contains "?" is one of the
//     Owner's questions (e.g. "AR = archive ready?"), so it counts as a short question even though
//     it carries no "?" and no opener word. A gloss without "?" is an INSTRUCTION (e.g. "MIS = make
//     it so"), and an instruction fairly earns a work report.
//   · the LABELED LEADS of rule 8, harvested from the `**LABEL:**` tokens rule 8 itself quotes. Read,
//     not baked in, for the same reason as the name: an adopter may rename them, and a hardcoded
//     list would silently check a vocabulary their contract does not use. Harvest EMPTY ⇒ check 3 is
//     OFF and says so on stderr, exactly like the shorthand harvest — a check that cannot see its
//     own vocabulary must announce the blindness rather than run clean.
// DORMANT UNTIL NAMED: if `core/OWNER_COMMS.md` is absent, has no such heading, or still carries an
// unfilled `{{OWNER_NAME}}`, the sensor ALLOWS unconditionally. Run `init --owner-name <name>`, or
// fill the placeholder by hand, to arm it.
//
// LOOP SAFETY: `stop_hook_active` is true when the agent is already continuing because of this hook.
// Blocking again there would loop forever, so that state always allows — one block per turn, max.
//
// OFF SWITCH: WORKFLOW_KIT_COMMS_GUARD="false" (explicit string compare — the STRING "false" is
// truthy, so a truthiness read here would be a bug).

import { readFileSync, statSync, openSync, readSync, closeSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW = () => process.exit(0);

// Announcements of work, matched PER SEGMENT (see detectNarration) rather than by one regex sweeping
// the whole message. Anchored with ^ so it can only fire at the start of a sentence or list item —
// which also means no ambiguous `\s+`/`\s*` seam and therefore no backtracking blow-up on a long run
// of whitespace. "let me know" is excluded: that is an offer, not narration, and the single most
// common false positive.
const WORK_VERB = String.raw`(?:check|look|see|inspect|verify|confirm|run|start|begin|take a look|dig|trace|read|find|figure)`;
// UNCONDITIONAL narration: "Let me check…", "Checking now". There is no reading of these in a CLOSING
// message that is not announcing work instead of reporting it, so no escape hatch applies.
const NARRATION_ALWAYS_RE = new RegExp(
  String.raw`^(?:` +
  String.raw`(?:now\s+|first,?\s+|so\s+)?let(?:'s| us| me)\s+(?!know)(?:just\s+|quickly\s+|now\s+)?${WORK_VERB}` +
  String.raw`|(?:completing|finishing|starting) the (?:inventory|sweep|check|review)` +
  String.raw`|inspecting now|checking now|looking now` +
  String.raw`)`,
  "i",
);
// CONDITIONAL narration: "I'll check…". Identical words serve two opposite purposes — announcing work
// now, or committing to work later. Only this branch consults DEFERRAL_RE; applying that exemption to
// "Let me check…" as well let "Let me check the config, then I'll report back" through on the word
// "then", which is plainly narration.
const NARRATION_UNLESS_DEFERRED_RE = new RegExp(
  String.raw`^i(?:'ll| will| am going to| am about to)\s+(?:just\s+|now\s+|first\s+)?${WORK_VERB}`,
  "i",
);
// Markdown furniture at the head of a segment: list bullets, ordered markers, quotes, bold/italic.
// Without stripping these, "- Let me check the config" reads as mid-sentence and slips the anchor
// while "1. Let me check…" matches — an accidental split, not a deliberate scope choice.
const SEGMENT_LEAD_RE = /^[\s>]*(?:[-*+]\s+|\d+[.)]\s+)?[*_`]*\s*/;
// A FUTURE COMMITMENT is not narration. "I'll run the deploy once you approve" and "I'll check back
// tomorrow" are idiomatic, rule-1-compliant ways to close a message to a decision-maker; blocking
// them costs the Owner a redundant extra message, which is the exact noise this hook exists to cut.
// Consulted ONLY by the "I'll …" branch. "then" is included because on that branch it chains a
// commitment ("I'll check the logs, then send the summary" — still a promise about later work); on the
// "Let me …" branch it would have been a hole, which is exactly why that branch never consults this.
const DEFERRAL_RE = /\b(?:once|after|when|unless|then|tomorrow|later|next week|next time|before you|you approve|you say|you want|you'd like|on your go|say the word|if you)\b/i;
// An explicit NOW beats a deferral word elsewhere in the same sentence. "I'll check the config now;
// if you have questions, ask" is present-tense narration that the unrelated "if you" would otherwise
// excuse — the deferral test looks anywhere in the segment, so it needs this counterweight.
const IMMEDIACY_RE = /\b(?:now|right away|immediately|straight away|as we speak)\b/i;

// A SHORT question from the Owner: an explicit yes/no opener, a brief line ending in "?", or one of
// the Owner's own question tokens harvested from core/OWNER_COMMS.md.
const YES_NO_OPENER_RE = /^\s*(?:ready|should|shall|can|could|will|would|is|are|was|were|do|does|did|have|has|any|anything|anyway|ok|okay)\b/i;
// An explicit REQUEST FOR DETAIL is not a question that wants "a line or two and a stop" — it is a
// question whose correct answer is long. Without this, "can you give me the full inventory?" (7
// words, ends in "?") is flagged, and the block text tells the agent to withhold the very thing the
// Owner just asked for — the sensor actively working against rule 1 instead of for it.
// PHRASES, not bare quantifiers. An early version listed words like "all", "every", "list" and
// "summary" on their own, which quietly disabled the check for ordinary short questions — "Are all
// tests passing?" and "Is the summary ready?" are yes/no questions, not requests for elaboration.
// Every entry here has to read as "give me more", not merely contain a word that sometimes does.
// Requires an explicit REQUEST framing, not merely a detail-ish noun. A noun-phrase list still
// exempted "Are the details correct?" and "Is the full report ready?", which are yes/no questions —
// the exemption has to key on the Owner ASKING for elaboration, not on the topic being detailed.
const DETAIL_REQUEST_RE = new RegExp(
  String.raw`\b(?:` +
  String.raw`walk me through|deep dive|long version|in (?:full )?detail|spell (?:it|this) out|elaborate|everything you` +
  String.raw`|(?:give|send|show|share|list) me\b[^?]*\b(?:detail|everything|all|full|whole|list|inventory|breakdown|rundown)` +
  String.raw`|(?:can|could|would|will) you\b[^?]*\b(?:detail|everything|full|whole|breakdown|rundown|walk me)` +
  String.raw`)`,
  "i",
);
const SHORT_Q_WORDS = 12;
// Generous on purpose: only an egregious mismatch fires, so a short question that genuinely needs a
// real answer is never punished. The transcript that motivated this was ~500 words to 3 words.
const OVER_ANSWER_WORDS = 350;

// The `[G]` contract doc. Heading shape is fixed by templates/OWNER_COMMS.md.tmpl; the name is not.
const OWNER_COMMS_REL = path.join("core", "OWNER_COMMS.md");
const OWNER_HEADING_RE = /^##\s+How to talk to\s+(.+?)\s+—\s+Owner, not a developer\s*$/m;
// `TOKEN` = gloss — token is short + ALL-CAPS (the shorthand convention). UNANCHORED: adopters write
// their definitions one per line OR inline in prose ("Alex types `AR` = archive ready? when …"), and
// the line-anchored rule this replaces harvested ZERO tokens from an inline-prose doc — question
// coverage silently off (executed against a real adopter doc downstream). The gloss is therefore not
// captured here: it runs to the NEXT definition or blank line (see ownerContract).
const SHORTHAND_DEF_RE = /`([A-Z][A-Z0-9]{0,7})`\s*=\s*/g;
// The template QUOTES the row format in its prose as `` `TOKEN` = gloss `` — a double-backtick code
// span, OUTSIDE the fence. That is a format MENTION, not a definition: left in place, the unanchored
// harvest would read TOKEN as a real definition, which both defeats the empty-harvest warning below
// (the mention would count as a successfully parsed row) and plants a phantom token one prose edit
// away from gaining a "?". Same principle as stripFences: quoted format is not vocabulary.
const FORMAT_MENTION_RE = /``[^\n]*?``/g;
// The WARN's "does this doc even TRY to define shorthand?" detector — deliberately LOOSER than the
// harvester. It also matches a double-backtick row (a shape a human plainly wrote as a definition
// but the parser cannot read; single backticks are the documented format) and it runs on the RAW
// text, so the fenced format examples and a kept intro-paragraph mention count as section
// apparatus. Anything this shape with zero PARSED definitions means the sensor is blind to
// vocabulary the doc visibly carries — that state warns, it never runs silently.
const DEF_SHAPED_RE = /`{1,2}[A-Z][A-Z0-9]{0,7}`{1,2}\s*=\s*/;

// RULE 8's LABELED LEADS, harvested from the doc. Rule 8 quotes them inside single backticks as
// `**QUESTION:**` etc., so the harvest keys on that shape. Letters, spaces and hyphens only: the
// leads are words ("DECISION NEEDED"), and a looser class would swallow neighbouring punctuation
// into the label and never match a real message.
const LEAD_DEF_RE = /`\*\*([A-Z][A-Z \-]{1,30}):\*\*`/g;
// The "does this doc even TRY to state rule 8?" detector, LOOSER than the harvester on purpose —
// same asymmetry as DEF_SHAPED_RE. A contract with no rule 8 at all (a pre-v2.1.1 adopter) is a
// legitimate silent state; a contract that talks about a labeled lead while the harvest comes back
// empty means an adopter reworded the labels and check 3 is blind to their vocabulary. That state
// warns rather than running clean.
const LEAD_PROSE_RE = /labeled lead/i;
// A line "carries a lead" when it holds one of those labels in BOLD — the form rule 8 requires in a
// message, which is the backtick-free spelling of the harvested token.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const leadInMessageRe = (leads) =>
  new RegExp(String.raw`\*\*(?:${leads.map(escapeRe).join("|")}):\*\*`);

// An ASK LINE: a line whose visible text ENDS in "?". Requiring the "?" to TERMINATE the line is the
// narrowing that keeps this off rhetorical prose — "Why did it fail? The lock was stale." asks the
// Owner nothing and answers itself in the same line, while a real ask ("Should I proceed?") ends
// there. Mid-line question marks are therefore deliberately not inspected; this check would rather
// miss a real ask than fire on an explanation, because a fail-open sensor that cries wolf gets
// switched off and then catches nothing at all.
// Trailing markdown emphasis and backticks count as "after the ?" — an ask is routinely written
// `**Should I run it now?**`, and an end-anchor that stopped at the "?" itself would never see that
// line at all. It would still ALLOW, which looks right, but for the wrong reason: the bold clearance
// below would be unreachable and a mutation deleting it would survive. (It did — this class is what
// the mutation battery forced. Same for backticks: without them `stripInlineCode` had no reachable
// case either, so a clause the header claims does work was doing none.)
const ASK_LINE_RE = /\?[`*_"'’”)\]]*$/;
// Bold ANYWHERE on the line clears it. This is `PORTABILITY.md`'s own spelling of the check — "a
// question mark outside a fence sits on an UNBOLDED line" — and it is deliberately generous: an
// agent that bolded the ask but used no label has done most of rule 8, and nagging there costs the
// Owner a message to buy a formatting nit.
const BOLD_RE = /\*\*[^*]+\*\*/;
// Inline code spans are stripped before the scan: a "?" inside `curl 'x?y=1'` is not an ask, and a
// backticked glob or regex routinely ends in one.
const stripInlineCode = (s) => s.replace(/`[^`\n]*`/g, " ");

// Fenced blocks are not prose. Used for BOTH the shorthand harvest (the template's EXAMPLE rows live
// in a fence, so an adopter who never replaced them does not get someone else's vocabulary treated as
// their own) and the message checks (quoted evidence is not narration, and a pasted diff is not an
// over-answer). Handles backtick AND tilde fences; both are valid CommonMark.
const stripFences = (s) => s
  .replace(/^[ \t]*```[\s\S]*?^[ \t]*```[ \t]*$/gm, " ")
  .replace(/^[ \t]*~~~[\s\S]*?^[ \t]*~~~[ \t]*$/gm, " ")
  .replace(/```[\s\S]*?```/g, " "); // unterminated / inline-adjacent leftovers

// Read the Owner contract. Returns null (⇒ the sensor is DORMANT and allows) when there is no doc,
// no heading in the exact shape this hook parses, or an unfilled {{OWNER_NAME}}. Never throws.
//
// EXPORTED because `bin/init.mjs` reports the sensor's armed/dormant state to the adopter and MUST
// decide it with this exact predicate. Two hand-kept copies of "is it armed?" drifted once already:
// a heading whose em dash had been normalized, or retitled, or absent entirely, left init printing
// ARMED while this function returned null and the hook allowed unconditionally — a false statement
// about a control's state, which is the one thing this kit exists to prevent. One function, one
// answer. (init imports it from the kit; the copy installed into an adopter only ever runs as a
// script, guarded below.)
export function ownerContract(projectRoot) {
  let text;
  try { text = readFileSync(path.join(projectRoot, OWNER_COMMS_REL), "utf8"); } catch { return null; }
  const m = OWNER_HEADING_RE.exec(text);
  if (!m) return null;
  const ownerName = m[1].trim();
  if (!ownerName || ownerName.includes("{{")) return null; // generated but never completed
  // Harvest from the FENCE-STRIPPED doc: the template's EXAMPLE rows live in a fence, so an adopter
  // who never replaced them does not get someone else's vocabulary treated as their own. A
  // definition's gloss runs to the next definition or blank line; a gloss that asks ("?") marks a
  // question token, one that doesn't is an instruction.
  const src = stripFences(text).replace(FORMAT_MENTION_RE, " ");
  const defs = [...src.matchAll(SHORTHAND_DEF_RE)];
  const tokens = new Set();
  for (let i = 0; i < defs.length; i++) {
    const start = defs[i].index + defs[i][0].length;
    let gloss = src.slice(start, i + 1 < defs.length ? defs[i + 1].index : src.length);
    // A gloss never crosses a blank line — including a CRLF one. Without \r in the class, a doc
    // saved with Windows line endings never terminates a gloss ("\r\n\r\n" has \r between the two
    // \n), a "?" in unrelated later prose bleeds into an instruction's gloss, and the instruction
    // becomes a question token — a false block (cross-family review, executed both ways).
    const para = gloss.search(/\n[ \t\r]*\n/);
    if (para !== -1) gloss = gloss.slice(0, para);
    if (gloss.includes("?")) tokens.add(defs[i][1]);
  }
  // ZERO definitions parsed while the doc visibly CARRIES definition-shaped rows (per the LOOSE
  // detector above — fenced examples, a double-backtick row, a kept format mention all count):
  // question coverage is off, and this kit has no fallback vocabulary to fail toward — it knows no
  // Owner. main() surfaces that as a NON-BLOCKING stderr warning instead of running silently
  // uncovered. Zero definition-shaped text ANYWHERE is a legitimate no-shorthand doc: stay silent.
  // This keys on parsed DEFINITIONS, not question tokens — an all-instruction vocabulary (no "?"
  // in any gloss) parsed fine and warns about nothing.
  const shorthandUnharvested = defs.length === 0 && DEF_SHAPED_RE.test(text);
  // Rule 8's labeled leads. Harvested from the RAW text, not the fence-stripped copy: rule 8 is
  // prose, and unlike the shorthand there is no "someone else's vocabulary" hazard to fence off —
  // these labels are the contract's own, whoever the Owner is. Empty is a legitimate state (a
  // contract with no rule 8), and main() treats it as "check 3 OFF" rather than as a failure.
  const leads = [...new Set([...text.matchAll(LEAD_DEF_RE)].map((m) => m[1].trim()))];
  const leadsUnharvested = leads.length === 0 && LEAD_PROSE_RE.test(text);
  return { ownerName, questionTokens: [...tokens], shorthandUnharvested, leads, leadsUnharvested };
}

// RULE 8 (check 3): an ask the Owner could scroll past. Returns the offending line, or null.
//
// THE WHOLE-MESSAGE SUPPRESSOR IS THE POINT, not a shortcut: if the message carries a labeled lead
// ANYWHERE, this allows unconditionally. An agent that labeled its ask has followed rule 8, and a
// second question mark further down is explanatory prose or a rhetorical aside. Without this, every
// correctly-formatted decision message with an extra "?" in it would be blocked — the sensor
// punishing exactly the behaviour it exists to produce.
//
// It therefore only ever fires on a message with NO labeled lead at all, which is also why it can
// afford to be simple: that message either has no ask (and no line will end in "?") or has one that
// rule 8 says must be findable and is not.
function detectUnlabeledAsk(message, leads) {
  if (!leads.length) return null;                    // no vocabulary harvested ⇒ check 3 is OFF
  const body = stripFences(message);
  if (leadInMessageRe(leads).test(body)) return null;
  for (const raw of body.split("\n")) {
    // Blockquotes are excluded: a quoted line is the Owner's own words being played back, and rule 8
    // governs what YOU ask, never what you quote. (Executed both ways — without this, echoing the
    // Owner's question to confirm it blocks the reply that answers it.)
    if (/^[ \t]*>/.test(raw)) continue;
    const line = stripInlineCode(raw).trim();
    if (!line) continue;
    if (ASK_LINE_RE.test(line) && !BOLD_RE.test(line)) return line;
  }
  return null;
}

// Narration detection, segment by segment. Returns the offending segment, or null.
function detectNarration(message) {
  for (const raw of stripFences(message).split(/(?<=[.!?])\s+|\n+/)) {
    const seg = raw.replace(SEGMENT_LEAD_RE, "").trim();
    if (!seg) continue;
    if (NARRATION_ALWAYS_RE.test(seg)) return seg;
    // "I'll check…" only counts as narration when it is NOT a deferred commitment — and an explicit
    // "now" in the same sentence overrides a deferral word that belongs to some other clause.
    if (NARRATION_UNLESS_DEFERRED_RE.test(seg) && (!DEFERRAL_RE.test(seg) || IMMEDIACY_RE.test(seg))) return seg;
  }
  return null;
}

function readTail(file, maxBytes = 2 * 1024 * 1024) {
  const size = statSync(file).size;
  if (size <= maxBytes) return readFileSync(file, "utf8");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, size - maxBytes);
    // Drop the leading partial line so JSON.parse never sees a fragment.
    const tail = buf.toString("utf8");
    return tail.slice(tail.indexOf("\n") + 1);
  } finally { closeSync(fd); }
}

// Text content of a transcript entry, tool calls excluded — only what the Owner actually reads.
function textOf(entry) {
  const content = entry?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
}

function proseWordCount(s) {
  return stripFences(s).split(/\s+/).filter(Boolean).length;
}

// The harness injects <system-reminder> (and similar) blocks INTO the user's turn — routinely, e.g.
// the project-context block on a session's first message. STRIP them and keep what the Owner actually
// typed; do NOT discard the whole turn.
//
// Discarding was the original behavior and it silently disabled the size check on exactly the turns
// the feature exists for, in BOTH orderings: a LEADING block nulled `lastUser` outright, and a
// TRAILING one inflated the word count past the short-question ceiling and removed the final "?".
// Either way a one-word question answered with a 400-word inventory sailed through. Fail-open is the
// right posture for an ERROR; it is not an acceptable answer to a shape the harness produces on
// purpose. Returns "" when nothing the Owner typed remains, and the caller treats that as no question.
const HARNESS_TAGS = String.raw`system-reminder|task-notification|command-name|command-message|command-args|local-command-stdout`;
// BOTH strip rules are anchored to a LINE START (with /m): the harness injects its blocks as their
// own lines, so an opening tag mid-sentence is the Owner QUOTING the mechanism, not an injection.
// An earlier version anchored only the UNCLOSED rule below; this one, unanchored, erased Owner-typed
// words from "Is <system-reminder>…</system-reminder> fine?" — shrinking a long question below the
// short-question ceiling and arming the size check on an input it must ignore. A false BLOCK, the
// direction that costs the Owner most (executed downstream against a real adopter of this hook).
// KNOWN RESIDUAL (deferred): a NESTED block — a tag pair inside another block of the same tag — is
// beyond the lazy matcher; the strip ends at the inner closer, the residue keeps the Owner's text
// from standing alone, and the size check then skips (allows). The harness is not observed to nest
// these blocks, the miss fails OPEN, and a balanced scanner is new surface a fail-open sensor should
// not grow speculatively. Characterization test pins today's behavior:
// tests/kit-controls.test.mjs "DEFERRED … nested injected blocks".
const HARNESS_BLOCK_RE = new RegExp(String.raw`^[ \t]*<(${HARNESS_TAGS})\b[\s\S]*?<\/\1>`, "gim");
// An UNCLOSED block — a truncated tail, or a self-closing shape — drops from its opening tag to the
// end of the turn, WHEREVER it appears. Anchoring this to the start of the string (an earlier
// attempt) left a truncated TRAILING block in place, where it inflated the word count past the
// short-question ceiling and stripped the final "?" — silently disabling the size check again, just
// from the other end. Requiring one of the known tag names is what keeps a stray "<" in the Owner's
// prose from eating their words.
// Anchored to a LINE START (with /m). The harness injects these as their own block, so an unclosed one
// always begins a line; requiring that keeps the rule from eating an inline mention — "Is
// `<system-reminder>` supported?" would otherwise be truncated to "Is `", losing the "?" and silently
// disabling the size check on a genuine short question.
const HARNESS_OPEN_TAIL_RE = new RegExp(String.raw`^[ \t]*<(?:${HARNESS_TAGS})\b[\s\S]*$`, "mi");
function ownerTypedText(s) {
  if (typeof s !== "string") return "";
  // FIXPOINT, not a single pass: stripping one own-line closed block leaves a space where it stood,
  // and a SECOND closed block glued on the same line then sits at a (whitespace-led) line start. A
  // single pass left that second block for the unclosed rule below, whose to-end-of-turn sweep
  // erased the Owner's REAL text after it (executed: two glued blocks + a genuine question → "" —
  // the size check silently off, the exact class this hook exists to keep). Each pass removes at
  // least one block or changes nothing, so the loop terminates.
  let prev;
  do { prev = s; s = s.replace(HARNESS_BLOCK_RE, " "); } while (s !== prev);
  return s.replace(HARNESS_OPEN_TAIL_RE, " ").trim();
}

function main(raw) {
  if (process.env.WORKFLOW_KIT_COMMS_GUARD === "false") return ALLOW();
  let input;
  try { input = JSON.parse(raw); } catch { return ALLOW(); }
  if (input?.stop_hook_active) return ALLOW();               // already continuing from a block — never loop
  const file = input?.transcript_path;
  if (typeof file !== "string" || !file) return ALLOW();

  const projectRoot = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const contract = ownerContract(projectRoot);
  if (!contract) return ALLOW();                             // dormant: no completed Owner contract
  // A coverage warning, not a decision: the sensor still runs and still fails open. A sensor that
  // cannot say "I am blind here" reads as clean when a whole check is off — the exact false
  // statement about a control's state this kit exists to prevent.
  if (contract.shorthandUnharvested) {
    // Best-effort by construction: a closed or broken stderr must never turn a WARNING into a crash
    // (observed: Node exits 0 here with stderr closed; the guard pins that posture against the
    // async-pipe-error case too).
    try {
      process.stderr.on("error", () => {});
      process.stderr.write(
        "guard-owner-comms WARN: core/OWNER_COMMS.md carries `TOKEN` = gloss rows, but NONE parsed outside " +
        "the fenced format examples — the Owner's question-shorthand coverage is OFF. Write real rows " +
        "outside the fence (`TOKEN` = gloss, with \"?\" in the gloss marking a question), or delete the " +
        "shorthand section if this Owner has none. Non-blocking: every other check still runs.\n");
    } catch { /* fail open */ }
  }
  if (contract.leadsUnharvested) {
    try {
      process.stderr.on("error", () => {});
      process.stderr.write(
        "guard-owner-comms WARN: core/OWNER_COMMS.md describes a labeled lead, but NO `**LABEL:**` " +
        "tokens parsed — the buried-ask check (rule 8) is OFF. Rule 8 must quote its leads in single " +
        "backticks (`**QUESTION:**`) for the sensor to read them. Non-blocking: every other check " +
        "still runs.\n");
    } catch { /* fail open */ }
  }

  let entries;
  try {
    entries = readTail(file).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return ALLOW(); }

  let finalAnswer = null, lastUser = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    // Subagent turns land in the SAME transcript with isSidechain:true, and a subagent's PROMPT is a
    // user-role entry. Without this, any turn that spawned an agent (cold panels, gate ladders — this
    // method's normal workflow) picks up that long prompt as `lastUser`, the short-question test goes
    // false, and the size check silently disappears on exactly the turns most at risk of an inventory.
    if (e?.isSidechain) continue;
    const role = e?.message?.role ?? e?.type;
    const text = textOf(e).trim();
    if (!text) continue;
    if (finalAnswer === null && role === "assistant") { finalAnswer = text; continue; }
    if (finalAnswer !== null && role === "user") { lastUser = text; break; }
  }
  if (!finalAnswer) return ALLOW();
  // Keep only what the Owner actually typed (harness-injected blocks removed, never the whole turn).
  lastUser = lastUser ? ownerTypedText(lastUser) : "";

  const reasons = [];
  const narration = detectNarration(finalAnswer);
  if (narration) {
    reasons.push(
      `Your FINAL message narrates the work instead of reporting it — "${narration.slice(0, 60)}". ` +
      `Mid-turn preambles before a tool call are fine; the closing answer must state the RESULT.`);
  }

  const unlabeledAsk = detectUnlabeledAsk(finalAnswer, contract.leads);
  if (unlabeledAsk) {
    reasons.push(
      `An ASK is buried (rule 8) — "${unlabeledAsk.slice(0, 60)}" ends in a question mark on a line ` +
      `with no bold and no labeled lead, and the message carries none anywhere. Put it on its own ` +
      `bulleted line, bolded, led by ${contract.leads.map((l) => `**${l}:**`).join(" / ")}. ` +
      `If ${contract.ownerName} could scroll past it, it is not formatted.`);
  }

  if (lastUser) {
    const qWords = proseWordCount(lastUser);
    // A "?" is REQUIRED on the opener branch. Without it the opener list (do/can/should/ok/will…) also
    // matches imperatives — "ok do it", "can you push it", "should be fine, proceed" — which are
    // INSTRUCTIONS. The natural reply to an instruction is a work report that can fairly exceed the
    // ceiling, and the block text would then claim a yes/no question that was never asked.
    const isOwnerQuestionToken = contract.questionTokens.length > 0 &&
      new RegExp(String.raw`^\s*(?:${contract.questionTokens.join("|")})\b[\s?.!]*$`).test(lastUser);
    const isShortQuestion = isOwnerQuestionToken
      || (qWords <= SHORT_Q_WORDS && lastUser.includes("?") && YES_NO_OPENER_RE.test(lastUser))
      || (qWords <= SHORT_Q_WORDS && lastUser.trim().endsWith("?"));
    // …but a short question that ASKS FOR the detail is not over-answered by giving it. Suppressing
    // here (rather than tightening isShortQuestion) keeps the Owner's own shorthand tokens working:
    // "AR" stays a short question, while "can you give me the full inventory?" is left alone.
    const wantsDetail = DETAIL_REQUEST_RE.test(lastUser);
    const aWords = proseWordCount(finalAnswer);
    if (isShortQuestion && !wantsDetail && aWords > OVER_ANSWER_WORDS) {
      reasons.push(
        `SIZE MISMATCH: ${contract.ownerName} asked ${qWords} words ("${lastUser.replace(/\s+/g, " ").slice(0, 70)}") and you answered with ~${aWords} words of prose. ` +
        `Rule 1: a yes/no question gets a line or two and a stop, never an inventory. OFFER the detail, do not deliver it unasked.`);
    }
  }

  if (!reasons.length) return ALLOW();
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason:
      `guard-owner-comms (core/OWNER_COMMS.md § How to talk to ${contract.ownerName}, rule 1). ` +
      `${contract.ownerName} has ALREADY SEEN the message above — a Stop hook cannot retract it. ` +
      "Send a corrected FOLLOW-UP that stands on its own:\n" +
      reasons.map((r) => `  • ${r}`).join("\n") +
      "\nKeep every fact, caveat, risk and ask — a blocker is never 'detail'. Cut the narration and the " +
      "unrequested inventory; offer it in one clause. Do not apologise or explain the correction; just send the better answer.",
  }));
  process.exit(0);
}

// Run ONLY as a script. `bin/init.mjs` imports `ownerContract` from this file so init's report of the
// sensor's state and the sensor's own decision can never be two drifting copies of one predicate;
// without this guard that import would also attach stdin listeners and hang the installer.
//
// Compare REALPATHS. A naive `import.meta.url === pathToFileURL(argv[1]).href` is false whenever the
// invoked path differs from the resolved one by a symlink — on macOS `/tmp` and `/var` are symlinks
// to `/private/...`, which is where this method's own worktrees live. The mismatch would make the
// hook silently do nothing at all: a Stop hook that exits 0 having read no input is indistinguishable
// from one that deliberately allowed, so the sensor would be dead and every run would look clean.
// (`init.mjs` carries `realpathOrSelf` for exactly this macOS reason.)
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const resolve = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
    return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
  } catch { return false; }
})();

if (isMain) {
  let raw = "";
  process.stdin.on("data", (c) => { raw += c; });
  process.stdin.on("end", () => { try { main(raw); } catch { ALLOW(); } });
  process.stdin.on("error", ALLOW);
}
