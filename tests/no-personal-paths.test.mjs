// workflow-kit — tests/no-personal-paths.test.mjs. The kit ships to other machines and other
// people; a file that carries the author's home directory or login name carries a fact that is
// false everywhere else. `skills/orchestrate/CHIP_BRIEF.md` § 6 already states the rule (no
// Owner name, no absolute paths) — as an honour rule, checked by nobody. This pins it.
//
// WHAT IS SCANNED: the TRACKED tree (`git ls-files`), which is what ships — not the working
// directory, so an untracked scratch note cannot fail it and a sparse checkout cannot hide a
// tracked leak from it; every tracked file that sniffs as text (no NUL byte in its first 8 KiB),
// whatever its name — `VERSION`, `.gitignore`, `githooks/pre-commit`, an extensionless runner.
// Falls back to a disk walk only where git is unavailable, and says so.
//
// WHAT IS MATCHED: a home-directory path with a real segment after it (`/Users/<x>`, `/home/<x>`,
// `C:\Users\<x>`), and the running operator's home-directory basename as a standalone token when it
// is 5+ characters. The identifier is DERIVED from the machine, never written here — a list typed
// into the test would itself be the leak it hunts. On a machine whose login is an ordinary word
// the identifier rule can false-fail; WORKFLOW_KIT_LEAK_IDENTIFIERS overrides it (comma list, or
// empty to disable), stated rather than silently narrowed.
//
// KNOWN RESIDUALS, accepted: a real login that is also a documentation placeholder (`user`,
// `owner`) is exempted by the placeholder list; a login under 5 characters is not matched as a bare
// token (its home PATH still is).
//
// Origin: the shape is ECC's `scripts/ci/validate-no-personal-paths.js` (affaan-m/ECC @ 22e8cf0,
// MIT), rewritten for this suite: no dependencies, tracked-tree membership, derived identifiers.
//
// TWO POLARITIES: the shipped tree must be clean (green), and the SAME scanner over a planted tree
// must find every planted leak shape and skip the placeholders (red) — a scanner observed only
// green is a scanner never observed working.

import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, mkdtempSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A home-directory path with a REAL segment after it. Placeholders (`/Users/<name>`, `/Users/{{X}}`,
// `~/.claude`) do not match: the segment must be a plain word. Backslashes may be doubled on disk.
const HOME_PATH_RE = /(?:\/Users|\/home)\/[A-Za-z0-9][A-Za-z0-9._-]*|[A-Za-z]:\\+Users\\+[A-Za-z0-9][A-Za-z0-9._-]*/g;
// Generic segments documentation uses as stand-ins for "your home" — a deny-list, one reason each:
// none is a plausible real login on a developer machine.
const PLACEHOLDER_SEGMENT_RE = /^(?:user|username|you|me|yourname|your-name|example|owner|someone)$/i;
const segmentOf = (m) => m.replace(/^[A-Za-z]:\\+Users\\+|^\/(?:Users|home)\//, "");
const MIN_IDENTIFIER = 5;

// The operator's home-directory basename — the segment that appears in every leaked home path and
// is the one identifier this machine can vouch for. WORKFLOW_KIT_LEAK_IDENTIFIERS overrides.
export function personalIdentifiers(env = process.env) {
  if (typeof env.WORKFLOW_KIT_LEAK_IDENTIFIERS === "string") {
    return env.WORKFLOW_KIT_LEAK_IDENTIFIERS.split(",").map((s) => s.trim()).filter((s) => s.length >= MIN_IDENTIFIER);
  }
  const ids = new Set();
  try { const h = path.basename(os.homedir()); if (h && h.length >= MIN_IDENTIFIER && !PLACEHOLDER_SEGMENT_RE.test(h)) ids.add(h); } catch { /* none */ }
  return [...ids];
}

// Text sniff: no NUL in the first 8 KiB. Binary files are skipped by content, not by name.
function isText(file) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, 8192, 0);
    return !buf.subarray(0, n).includes(0);
  } finally { closeSync(fd); }
}

// The file set: tracked files from git when the root is a repository, else a disk walk.
// Returns { files, source } with repo-relative POSIX paths.
export function shippedFiles(root) {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--exclude-standard"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const files = out.split("\0").filter(Boolean);
    return { files, source: "git ls-files" };
  } catch { /* not a repo, or no git */ }
  const SKIP = new Set(["node_modules", ".git", ".claude", "thread-restarts"]);
  const files = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const p = path.join(dir, name);
      let st;
      try { st = statSync(p); } catch (e) { throw new Error(`cannot stat ${p}: ${e.message}`); }
      const r = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) walk(p, r);
      else if (st.isFile()) files.push(r);
    }
  };
  walk(root, "");
  return { files, source: "disk walk (not a git repository)" };
}

// Returns [{ file, line, match }] for every leak in every text file of the shipped set.
export function scanTree(root, identifiers) {
  const idRe = identifiers.length
    ? new RegExp(String.raw`(?<![A-Za-z0-9_])(?:${identifiers.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9_])`, "g")
    : null;
  const hits = [];
  const { files } = shippedFiles(root);
  for (const rel of files) {
    const abs = path.join(root, ...rel.split("/"));
    let st;
    try { st = lstatSync(abs); } catch (e) { throw new Error(`tracked file unreadable: ${rel}: ${e.message}`); }
    // A tracked symlink ships its TARGET STRING, not what it points at — scan that string and
    // never follow the link (following would scan whatever the author's disk holds there).
    const lines = st.isSymbolicLink() ? [readlinkSync(abs)] : (st.isFile() && isText(abs) ? readFileSync(abs, "utf8").split("\n") : null);
    if (!lines) continue;
    lines.forEach((text, i) => {
      for (const m of text.matchAll(HOME_PATH_RE)) {
        if (PLACEHOLDER_SEGMENT_RE.test(segmentOf(m[0]))) continue;
        hits.push({ file: rel, line: i + 1, match: m[0] });
      }
      if (idRe) for (const m of text.matchAll(idRe)) hits.push({ file: rel, line: i + 1, match: m[0] });
    });
  }
  return hits;
}

test("the shipped (tracked) tree carries no home-directory path and no operator identifier", () => {
  const ids = personalIdentifiers();
  const { source } = shippedFiles(KIT);
  assert.equal(source, "git ls-files", "the kit checkout is a repository; the tracked set is what is scanned");
  const hits = scanTree(KIT, ids);
  assert.deepEqual(hits, [],
    `personal path/identifier leaked into shipped files:\n${hits.map((h) => `  ${h.file}:${h.line}  ${h.match}`).join("\n")}\n` +
    "Generalize it (a placeholder, a relative path, a role name) — CHIP_BRIEF.md § 6.");
});

test("personalIdentifiers derives the home basename (or honours the override), never a list typed here", () => {
  const home = path.basename(os.homedir());
  const derived = personalIdentifiers({});
  if (home.length >= MIN_IDENTIFIER && !PLACEHOLDER_SEGMENT_RE.test(home)) assert.deepEqual(derived, [home]);
  else assert.deepEqual(derived, []);
  assert.deepEqual(personalIdentifiers({ WORKFLOW_KIT_LEAK_IDENTIFIERS: "" }), [], "empty override disables the identifier rule");
  assert.deepEqual(personalIdentifiers({ WORKFLOW_KIT_LEAK_IDENTIFIERS: "zzhandle, ab" }), ["zzhandle"], "override entries under 5 chars are dropped");
});

test("the scanner CAN FAIL: a planted repo reddens on every leak shape, in any file name, and stays green on placeholders, binaries and untracked files", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-leak-"));
  try {
    const git = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    git(["init", "-q", "-b", "main"]);
    mkdirSync(path.join(dir, "core")); mkdirSync(path.join(dir, "githooks"));
    // Fixture strings are ASSEMBLED so this file carries no literal leak of its own — the
    // shipped-tree test scans tests/ too.
    const mac = ["", "Users", "alice", "Github", "kit"].join("/");
    const linux = ["", "home", "bob", "src"].join("/");
    const win = ["C:", "Users", "carol", "kit"].join("\\");
    const generic = ["", "home", "user", "src"].join("/");
    writeFileSync(path.join(dir, "core", "clean.md"), `See \`/Users/<name>/.claude\`, \`~/.codex/prompts\`, \`{{REPO_ROOT_PATH}}\` and ${generic}.\n`);
    writeFileSync(path.join(dir, "core", "leak-mac.md"), `Run it from ${mac} today.\n`);
    writeFileSync(path.join(dir, "core", "leak-linux.sh"), `cd ${linux}\n`);
    writeFileSync(path.join(dir, "core", "leak-win.json"), JSON.stringify({ p: win }) + "\n");
    writeFileSync(path.join(dir, "core", "leak-id.md"), "Ping zzhandle when it lands; zzhandle_x is a different token.\n");
    writeFileSync(path.join(dir, "githooks", "pre-commit"), `#!/bin/sh\n# ${mac}\n`);                       // extensionless
    writeFileSync(path.join(dir, "VERSION"), `1.0.0 ${["", "home", "dave"].join("/")}\n`);                   // extensionless
    writeFileSync(path.join(dir, "core", "blob.bin"), Buffer.concat([Buffer.from(mac), Buffer.from([0, 1, 2])])); // binary: skipped
    writeFileSync(path.join(dir, "untracked.md"), `${["", "Users", "nobody", "looks"].join("/")}\n`);        // never added
    symlinkSync(["", "Users", "erin", "private"].join("/"), path.join(dir, "core", "link"));                  // a tracked symlink to a home path
    git(["add", "core", "githooks", "VERSION"]);
    const hits = scanTree(dir, ["zzhandle"]);
    const got = hits.map((h) => `${h.file}:${h.match}`).sort();
    assert.deepEqual(got, [
      `VERSION:${["", "home", "dave"].join("/")}`,
      "core/leak-id.md:zzhandle",
      `core/leak-linux.sh:${["", "home", "bob"].join("/")}`,
      `core/leak-mac.md:${["", "Users", "alice"].join("/")}`,
      `core/leak-win.json:${["C:", "Users", "carol"].join("\\\\")}`,   // JSON doubled the backslashes on disk
      `core/link:${["", "Users", "erin"].join("/")}`,                       // the symlink's TARGET string, never followed
      `githooks/pre-commit:${["", "Users", "alice"].join("/")}`,
    ]);
    // …and outside a repository the disk walk is the fallback, declared as such.
    const plain = mkdtempSync(path.join(os.tmpdir(), "kit-leak-plain-"));
    try {
      writeFileSync(path.join(plain, "n.md"), `${mac}\n`);
      assert.equal(shippedFiles(plain).source, "disk walk (not a git repository)");
      assert.equal(scanTree(plain, []).length, 1);
    } finally { rmSync(plain, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
