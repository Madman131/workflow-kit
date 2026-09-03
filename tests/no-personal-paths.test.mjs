// workflow-kit — tests/no-personal-paths.test.mjs. The kit ships to other machines and other
// people; a file that carries the author's home directory or login name carries a fact that is
// false everywhere else. `skills/orchestrate/CHIP_BRIEF.md` § 6 already states the rule (no
// Owner name, no absolute paths) — as an honour rule, checked by nobody. This pins it.
//
// Origin: the shape is ECC's `scripts/ci/validate-no-personal-paths.js` (affaan-m/ECC @ 22e8cf0,
// MIT), rewritten for this suite: no dependencies, and the personal identifiers are DERIVED from
// the machine running the test (login name, git user) rather than written into it — a list typed
// here would itself be the leak it hunts, and a pin that restates its source is a new mirror.
//
// TWO POLARITIES, like every check in this suite: the shipped tree must be clean (green), and the
// SAME scanner over a planted tree must find every planted leak (red) — a scanner observed only
// green is a scanner never observed working.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Never descended: not shipped, or deliberately untracked working state (`.claude/` holds the
// failure log and chip artifacts; `thread-restarts/` holds transient digests).
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", "thread-restarts"]);
const TEXT_RE = /\.(mjs|js|cjs|ts|md|json|toml|sh|zsh|yml|yaml|txt|tmpl)$/;

// A home-directory path with a REAL segment after it. Placeholders (`/Users/<name>`, `/Users/{{X}}`,
// `~/.claude`) do not match: the segment must be a plain word.
const HOME_PATH_RE = /(?:\/Users|\/home)\/[A-Za-z0-9][A-Za-z0-9._-]*|[A-Za-z]:\\+Users\\+[A-Za-z0-9][A-Za-z0-9._-]*/g;
// Generic segments that documentation uses as stand-ins for "your home" — `/home/user`,
// `/Users/you`. A deny-list with a reason per entry: each is a word no real login is likely to be.
const PLACEHOLDER_SEGMENT_RE = /^(?:user|username|you|me|yourname|your-name|example|owner|someone)$/i;
const segmentOf = (m) => m.replace(/^[A-Za-z]:\\+Users\\+|^\/(?:Users|home)\//, "");

// Personal identifiers of THIS machine's operator, derived at run time. A kit checkout on the
// author's machine is where a leak is minted, so this is where it is caught; on any other machine
// these names are different and the scan degrades to the path rule alone — stated, not hidden.
export function personalIdentifiers() {
  const ids = new Set();
  try { const u = os.userInfo().username; if (u && u.length >= 4) ids.add(u); } catch { /* none */ }
  for (const key of ["user.name", "github.user"]) {
    try {
      const v = execFileSync("git", ["config", "--get", key], { encoding: "utf8", cwd: KIT }).trim();
      // Only a single token is a usable needle; "First Last" would need word logic this test does
      // not attempt, and a two-letter handle would match everything.
      if (v && !/\s/.test(v) && v.length >= 4) ids.add(v);
    } catch { /* unset */ }
  }
  return [...ids];
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && TEXT_RE.test(name)) out.push(p);
  }
  return out;
}

// Returns [{ file, line, match }] for every leak in every text file under `root`.
export function scanTree(root, identifiers) {
  const idRe = identifiers.length
    ? new RegExp(String.raw`(?<![A-Za-z0-9_])(?:${identifiers.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9_])`, "g")
    : null;
  const hits = [];
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const m of text.matchAll(HOME_PATH_RE)) {
        if (PLACEHOLDER_SEGMENT_RE.test(segmentOf(m[0]))) continue;
        hits.push({ file: path.relative(root, file), line: i + 1, match: m[0] });
      }
      if (idRe) for (const m of text.matchAll(idRe)) hits.push({ file: path.relative(root, file), line: i + 1, match: m[0] });
    });
  }
  return hits;
}

test("the shipped tree carries no home-directory path and no operator identifier", () => {
  const ids = personalIdentifiers();
  const hits = scanTree(KIT, ids);
  assert.deepEqual(hits, [],
    `personal path/identifier leaked into shipped files:\n${hits.map((h) => `  ${h.file}:${h.line}  ${h.match}`).join("\n")}\n` +
    "Generalize it (a placeholder, a relative path, a role name) — CHIP_BRIEF.md § 6.");
});

test("the scanner CAN FAIL: a planted tree reddens on every leak shape, and placeholders stay green", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-leak-"));
  try {
    mkdirSync(path.join(dir, "core"));
    mkdirSync(path.join(dir, "node_modules"));
    // Fixture strings are ASSEMBLED here so this file carries no literal leak of its own — the
    // shipped-tree test scans tests/ too, and a self-exemption would be a deny-list entry nobody
    // needs.
    const mac = ["", "Users", "alice", "Github", "kit"].join("/");
    const linux = ["", "home", "bob", "src"].join("/");
    const win = ["C:", "Users", "carol", "kit"].join("\\");
    const generic = ["", "home", "user", "src"].join("/");
    writeFileSync(path.join(dir, "core", "clean.md"), `See \`/Users/<name>/.claude\`, \`~/.codex/prompts\`, \`{{REPO_ROOT_PATH}}\` and ${generic}.\n`);
    writeFileSync(path.join(dir, "core", "leak-mac.md"), `Run it from ${mac} today.\n`);
    writeFileSync(path.join(dir, "core", "leak-linux.sh"), `cd ${linux}\n`);
    writeFileSync(path.join(dir, "core", "leak-win.json"), JSON.stringify({ p: win }) + "\n");
    writeFileSync(path.join(dir, "core", "leak-id.md"), "Ping zzhandle when it lands; zzhandle_x is a different token.\n");
    writeFileSync(path.join(dir, "node_modules", "ignored.md"), `${["", "Users", "nobody", "looks"].join("/")}\n`);
    const hits = scanTree(dir, ["zzhandle"]);
    const got = hits.map((h) => `${h.file}:${h.match}`).sort();
    assert.deepEqual(got, [
      "core/leak-id.md:zzhandle",
      `core/leak-linux.sh:${["", "home", "bob"].join("/")}`,
      `core/leak-mac.md:${["", "Users", "alice"].join("/")}`,
      `core/leak-win.json:${["C:", "Users", "carol"].join("\\\\")}`, // JSON doubled the backslashes on disk
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
