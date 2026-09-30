// D-63 / F1: every file path an adopter's installed instruction text cites must exist in the ADOPTER's
// tree. Discovered by running a hermetic `init` into a temp git repo and scanning what it rendered; a
// citation resolves against the target root, the citing file's own directory, or core/.
//
// NO ALLOW-LIST (memory: allow-list-is-an-undeclared-narrowing). Every scanned file is scanned; every
// token that is not a resolvable path must match a DENY entry below with a reason. Nothing is skipped
// silently: the two structural exclusions (core/ and non-path tokens) are declared here with reasons.
//
// SCANNED: AGENTS.md, CLAUDE.md, .claude/commands/thread-restart.md, every .agents/skills/**/*.md.
// NOT SCANNED, declared: core/ — ~150 history / opt-in / journal citations (docs/journal/, optional
//   adopter docs) that an adopter may legitimately not have yet; a separate NOTE owns that class.
// NOT A PATH, declared: a backticked token is "path-like" only if it contains "/" or ends in a known
//   file extension. Tokens holding <>*{}$|=()  are placeholders, globs, flags or shell, not citations.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERMETIC_PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);

// DENY-LIST: each entry = what it matches, WHY it legitimately does not exist in a freshly init-ed tree.
// `near` (optional): the entry applies only when the citing text, within 160 chars of the token, matches
// it — so a citation that merely lacks the disclosure still fails (this is what keeps items 4 live).
const DENY = [
  { tok: ".claude/task-lane.json", why: "runtime-created by /lane-declare in the adopter's session; never installed" },
  { tok: ".claude/metrics/tokens.jsonl", why: "runtime-created by the token recorder hook on first use" },
  { tok: "package.json", why: "adopter-owned; the kit never writes it" },
  { tok: "PORTABILITY.md", near: /kit's|workflow-kit repository|in the kit\b|workflow-kit's/, why: "kit-repo contract; allowed only where the text names it as the kit's (see portability-citations.test.mjs)" },
  { tok: "scripts/sweep.mjs", near: /workflow-kit repository; init does not install it/, why: "kit-repo tool init never installs; allowed only where the sentence says so" },
  { tok: "hooks.json", why: "bare generic name of Codex's hook registration (the adopter's is .codex/hooks.json); orchestrate-skill.test.mjs pins the phrase verbatim, so it stays bare by decision" },
  { tok: ".md", why: "the bare file-extension token, not a path" },
  { tok: "docs/journal/", why: "the adopter's own history directory, created by the adopter as needed" },
  { tok: "docs/", why: "the adopter's own docs tree, named as an example of a lane-exempt prefix" },
  { tok: "memory/", why: "the adopter's own memory directory, named as an example of a lane-exempt prefix" },
  { tok: "thread-restarts/", why: "directory the /thread-restart prompt tells the agent to create when needed" },
  { tok: "docs/thread-restarts/", why: "directory the /thread-restart prompt tells the agent to create when needed" },
  { tok: "skills/verification-loop", why: "origin attribution to the external ECC repository, not a pointer into this tree" },
  { re: /^\/[a-z][a-z-]*$/, why: "slash command (/orchestrate, /clear, ...), not a file path" },
  { re: /^\/(private\/)?tmp$/, why: "absolute system scratch directory, outside any adopter tree" },
  { re: /^~\//, why: "home-directory path (~/.claude, ~/.codex/prompts/), outside any adopter tree" },
];
const denied = (tok, text, at) => DENY.some((d) =>
  (d.tok === tok || (d.re && d.re.test(tok))) && (!d.near || d.near.test(text.slice(Math.max(0, at - 160), at + tok.length + 160))));
const EXT = /\.(md|mjs|js|json|jsonl|toml|sh|tmpl|yml|yaml)$/;
const PLACEHOLDER = /[<>*{}$|=()]/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

export function citations(text) {
  const out = [];
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    let t = m[1].replace(/#.*$/, "").replace(/[:,.;]+$/, (x) => (EXT.test(m[1].replace(/#.*$/, "")) ? "" : x));
    t = t.replace(/^\.\//, "");
    if (!t || PLACEHOLDER.test(t) || /^[a-z]+:\/\//.test(t)) continue;
    if (t.includes("/") || EXT.test(t)) out.push([t, m.index]);
  }
  return out;
}

function unresolved() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-citations-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-citations-prompts-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const r = spawnSync(process.execPath,
      [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter", "--codex-prompts-dir", codexDir],
      { encoding: "utf8", env: { ...process.env, PATH: HERMETIC_PATH } });
    assert.equal(r.status, 0, r.stderr);
    const files = ["AGENTS.md", "CLAUDE.md", ".claude/commands/thread-restart.md"].map((f) => path.join(dir, f));
    files.push(...walk(path.join(dir, ".agents", "skills")).filter((f) => f.endsWith(".md")));
    const bad = [];
    let seen = 0;
    for (const f of files) {
      assert.ok(existsSync(f), `${path.relative(dir, f)} was rendered`);
      const text = readFileSync(f, "utf8");
      for (const [tok, at] of citations(text)) {
        seen++;
        const roots = [dir, path.dirname(f), path.join(dir, "core")];
        if (roots.some((r) => existsSync(path.join(r, tok)))) continue;
        if (denied(tok, text, at)) continue;
        bad.push(`${path.relative(dir, f)}: \`${tok}\``);
      }
    }
    return { bad, seen, nfiles: files.length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(codexDir, { recursive: true, force: true });
  }
}

test("every path an installed instruction file cites resolves in the adopter tree or is a reasoned deny entry", () => {
  const { bad, seen, nfiles } = unresolved();
  assert.ok(nfiles >= 10 && seen >= 50, `scan is non-trivial (${nfiles} files, ${seen} citations)`);
  assert.deepEqual(bad, [], `dead citations in adopter-installed text:\n${bad.join("\n")}`);
});

test("every deny entry carries a reason", () => {
  for (const d of DENY) assert.ok(d.why && d.why.length > 10, `${d.tok ?? d.re} needs a reason`);
});

test("the extractor finds path-like tokens and skips placeholders", () => {
  assert.deepEqual(citations("see `a/b.md`, `x.mjs`: and `<dir>/y.md` `--flag` `foo`").map((c) => c[0]), ["a/b.md", "x.mjs"]);
});
