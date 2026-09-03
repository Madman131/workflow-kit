#!/usr/bin/env node
// workflow-kit — scripts/token-report.mjs. Reads the ledger `hooks/sensor-token-ledger.mjs` writes
// and prints token spend per task (default), per session, or per day. Tokens only — no prices.
//
//   node scripts/token-report.mjs [--by task|session|day] [--ledger <path>] [--json]
//
// EVERY ROW carries a cumulative snapshot AND the delta since the session's previous row. The
// report SUMS DELTAS, in append order, so spend lands in the day and task in which it happened;
// a session that changes task or crosses midnight splits correctly. Rows the hook wrote before
// deltas existed (no `delta` field) are turned into deltas HERE, per session, by differencing
// consecutive cumulatives, and the report says how many such rows it saw. Rows whose delta is
// unknown (`delta: null` — a truncated transcript, or no usable baseline) are excluded, counted,
// and warned about. Malformed rows are counted and reported, never silently dropped — a report
// that hides its own gaps reads as clean.
//
// Columns are tokens the model was handed (prompt = input + cache_creation + cache_read; cache
// reads are cheaper but they are still context) and tokens it produced (out), split between the
// session's own turns (main) and its Agent-tool subagents (side). The split is TOPOLOGY, not
// purpose: it is a proxy for gate-versus-build spend where, as in this method, cold seats and
// panels run as subagents. Where review runs in the main thread the proxy inverts; read it as such.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const o = { by: "task", ledger: null, json: false };
  const needsValue = (i, flag) => { const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) { console.error(`token-report: ${flag} needs a value`); process.exit(2); } return v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--by") o.by = needsValue(i++, a);
    else if (a === "--ledger") o.ledger = needsValue(i++, a);
    else if (a === "-h" || a === "--help") { console.log("usage: token-report.mjs [--by task|session|day] [--ledger <path>] [--json]"); process.exit(0); }
    else { console.error(`token-report: unknown argument ${a}`); process.exit(2); }
  }
  if (!["task", "session", "day"].includes(o.by)) { console.error("token-report: --by must be task, session or day"); process.exit(2); }
  return o;
}

// Parse the ledger. Returns { rows, malformed, legacy } — rows in append order, each normalised to
// carry `spend` (the delta, or the cumulative total for a pre-delta row, flagged `legacy`).
const FIELDS = ["input", "output", "cache_creation", "cache_read", "messages"];
const isSum = (o) => o && typeof o === "object" && FIELDS.every((k) => k in o ? (Number.isFinite(o[k]) && o[k] >= 0) : true);
const diff = (cur, prev) => Object.fromEntries(FIELDS.map((k) => [k, Math.max(0, (cur?.[k] || 0) - (prev?.[k] || 0))]));

export function loadRows(text) {
  const rows = []; let malformed = 0; let legacy = 0; let truncated = 0;
  const lastLegacy = new Map();   // session → its previous cumulative, so legacy rows count once too
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { malformed++; continue; }
    if (!r || typeof r !== "object" || typeof r.session_id !== "string" || !r.session_id) { malformed++; continue; }
    let spend;
    if (r.delta === null) { truncated++; spend = null; }   // delta unknown (truncated transcript, or no usable baseline)
    else if (r.delta && isSum(r.delta.main) && isSum(r.delta.sidechain)) spend = { main: r.delta.main, sidechain: r.delta.sidechain };
    else if (isSum(r.main) && isSum(r.sidechain)) {
      legacy++;
      const prev = lastLegacy.get(r.session_id);
      spend = { main: diff(r.main, prev?.main), sidechain: diff(r.sidechain, prev?.sidechain) };
      lastLegacy.set(r.session_id, { main: r.main, sidechain: r.sidechain });
    } else { malformed++; continue; }
    rows.push({ ...r, spend });
  }
  return { rows, malformed, legacy, truncated };
}

const prompt = (s) => (s?.input || 0) + (s?.cache_creation || 0) + (s?.cache_read || 0);

export function aggregate(rows, by) {
  const groups = new Map();
  const sessions = new Map();
  for (const r of rows) {
    if (!r.spend) continue;   // truncated: spend unknown, never guessed
    const key = by === "session" ? r.session_id
      : by === "day" ? String(r.ts || "").slice(0, 10) || "(undated)"
      : (r.task_id || "(undeclared)");
    const g = groups.get(key) || { key, sessions: new Set(), main_prompt: 0, main_out: 0, side_prompt: 0, side_out: 0, main_messages: 0, side_messages: 0 };
    g.sessions.add(r.session_id);
    g.main_prompt += prompt(r.spend.main); g.main_out += r.spend.main.output || 0; g.main_messages += r.spend.main.messages || 0;
    g.side_prompt += prompt(r.spend.sidechain); g.side_out += r.spend.sidechain.output || 0; g.side_messages += r.spend.sidechain.messages || 0;
    groups.set(key, g);
    sessions.set(r.session_id, true);
  }
  const out = [...groups.values()].map((g) => ({ ...g, sessions: g.sessions.size }));
  return out.sort((a, b) => (b.main_prompt + b.side_prompt) - (a.main_prompt + a.side_prompt));
}

function fmt(n) { return n.toLocaleString("en-US"); }

export function render(groups, by, meta = {}) {
  const head = [by, "sessions", "main prompt", "main out", "side prompt", "side out", "side share"];
  const lines = groups.map((g) => {
    const total = g.main_prompt + g.side_prompt;
    const share = total ? `${Math.round((100 * g.side_prompt) / total)}%` : "—";
    return [g.key, String(g.sessions), fmt(g.main_prompt), fmt(g.main_out), fmt(g.side_prompt), fmt(g.side_out), share];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const row = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  const tot = groups.reduce((a, g) => ({ mp: a.mp + g.main_prompt, mo: a.mo + g.main_out, sp: a.sp + g.side_prompt, so: a.so + g.side_out }), { mp: 0, mo: 0, sp: 0, so: 0 });
  const totalShare = tot.mp + tot.sp ? `${Math.round((100 * tot.sp) / (tot.mp + tot.sp))}%` : "—";
  const notes = [
    "prompt = input + cache_creation + cache_read tokens handed to the model; out = tokens produced.",
    "side = Agent-tool subagent turns; main = the session's own turns. A topology split: a proxy for",
    "gate-vs-build spend only where review runs in subagents, as this method's cold seats do.",
    "Deltas summed in append order; Codex CLI seats are not in this ledger.",
  ];
  if (meta.malformed) notes.push(`WARNING: ${meta.malformed} malformed row(s) ignored — the totals above are incomplete.`);
  if (meta.legacy) notes.push(`${meta.legacy} pre-delta row(s): spend derived from consecutive cumulatives per session.`);
  if (meta.truncated) notes.push(`WARNING: ${meta.truncated} row(s) carry no delta (truncated transcript or unknown baseline) — that spend is NOT in the totals.`);
  return [row(head), row(widths.map((w) => "-".repeat(w))), ...lines.map(row),
    row(["TOTAL", String(meta.sessions ?? ""), fmt(tot.mp), fmt(tot.mo), fmt(tot.sp), fmt(tot.so), totalShare]), "", ...notes].join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  const ledger = o.ledger || process.env.WORKFLOW_KIT_TOKEN_LEDGER_PATH
    || path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".claude", "metrics", "tokens.jsonl");
  if (!existsSync(ledger)) {
    console.error(`token-report: no ledger at ${ledger} — the Stop sensor writes it after the first turn in a repo where it is registered.`);
    process.exit(1);
  }
  const { rows, malformed, legacy, truncated } = loadRows(readFileSync(ledger, "utf8"));
  const sessions = new Set(rows.map((r) => r.session_id)).size;
  const groups = aggregate(rows, o.by);
  if (o.json) console.log(JSON.stringify({ ledger, by: o.by, sessions, rows: rows.length, malformed, legacy, truncated, groups }, null, 2));
  else console.log(`ledger: ${ledger}  (${sessions} session(s), ${rows.length} row(s))\n\n${render(groups, o.by, { malformed, legacy, truncated, sessions })}`);
}
