// workflow-kit — control suite, part: the skill and agent installs. Dual-lane skills and their shims,
// mechanism skills, obstructed installs that must not skip later controls, the frontier-review
// agents, and verification of installed shims. Split out of tests/kit-controls.test.mjs so the
// suite's files run in parallel; the test bodies are unchanged.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { adopt, HERMETIC_ENV } from "./kit-controls-helpers.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("init installs the dual-lane skills: one shared body, a shim per harness, idempotently", () => {
  const { dir, codexDir, run, cleanup } = adopt();
  try {
    const body = path.join(dir, ".agents", "skills", "humanize", "SKILL.md");
    const bullet = path.join(dir, ".agents", "skills", "humanize", "BULLET.md");
    const claudeShim = path.join(dir, ".claude", "skills", "humanize", "SKILL.md");
    const aliasShim = path.join(dir, ".claude", "skills", "humanize-bullet", "SKILL.md");
    const codexShim = path.join(codexDir, "humanize.md");
    const codexAlias = path.join(codexDir, "humanize-bullet.md");
    for (const [label, p] of [["shared body", body], ["body sibling BULLET.md", bullet], ["Claude shim", claudeShim],
      ["Claude alias shim", aliasShim], ["Codex shim", codexShim], ["Codex alias shim", codexAlias]]) {
      assert.ok(existsSync(p), `${label} installed at ${p}`);
    }
    assert.match(readFileSync(claudeShim, "utf8"), /^---\n/, "Claude skill shim opens with YAML frontmatter");
    assert.match(readFileSync(codexShim, "utf8"), /^# /, "Codex skill prompt opens with a markdown H1");
    // THE load-bearing property: every shim points at a body that EXISTS. A shim naming a renamed or
    // dropped body ships a command that dead-ends, which is the failure this mechanism must not hide.
    for (const shim of [claudeShim, aliasShim, codexShim, codexAlias]) {
      const refs = [...readFileSync(shim, "utf8").matchAll(/\.agents\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)/g)];
      assert.ok(refs.length > 0, `${shim} names a shared body`);
      for (const [, skill, file] of refs) {
        assert.ok(existsSync(path.join(dir, ".agents", "skills", skill, file)),
          `${shim} points at .agents/skills/${skill}/${file}, which must exist`);
      }
    }
    // The shims carry NO rules of their own — that is the point of a single shared body.
    for (const shim of [claudeShim, codexShim]) {
      assert.doesNotMatch(readFileSync(shim, "utf8"), /Word budget/, `${shim} must not duplicate the body's rules`);
    }
    // Idempotent: plant a real USER EDIT first. Hashing a pristine install would stay green even if
    // copyGuarded regressed to overwrite (a re-copy is byte-identical), so it must be MUTATED.
    const edited = {};
    for (const p of [body, claudeShim, codexShim]) {
      edited[p] = readFileSync(p, "utf8") + "\n<!-- user edit: keep me -->\n";
      writeFileSync(p, edited[p]);
    }
    run();
    for (const p of [body, claudeShim, codexShim]) {
      assert.equal(readFileSync(p, "utf8"), edited[p], `re-run KEEPS the user-edited ${p} (no clobber without --force)`);
    }
  } finally { cleanup(); }
});

test("architect-build is a mechanism skill: a plain rerun names stale body and both shims", () => {
  const { dir, codexDir, cleanup } = adopt();
  try {
    const body = path.join(dir, ".agents", "skills", "architect-build", "SKILL.md");
    const routing = path.join(dir, ".agents", "skills", "architect-build", "ROUTING.md");
    const claudeShim = path.join(dir, ".claude", "skills", "architect-build", "SKILL.md");
    const codexShim = path.join(codexDir, "architect-build.md");
    assert.ok(existsSync(routing), "the architect-build body installs its authoritative routing reference beside itself");
    assert.match(readFileSync(body, "utf8"), /\.agents\/skills\/architect-build\/ROUTING\.md/, "the body names the installed reference layer");
    const edited = {};
    for (const p of [body, routing, claudeShim, codexShim]) {
      edited[p] = readFileSync(p, "utf8") + "\n<!-- drift -->\n";
      writeFileSync(p, edited[p]);
    }
    const rerun = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--codex-prompts-dir", codexDir], { encoding: "utf8" });
    assert.equal(rerun.status, 1, "a plain rerun with stale architect-build mechanism files fails");
    const output = rerun.stdout + rerun.stderr;
    for (const p of [body, routing, claudeShim, codexShim]) {
      assert.match(output, new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${p} is named as stale`);
      assert.equal(readFileSync(p, "utf8"), edited[p], `${p} remains untouched without --force`);
    }
    assert.equal((output.match(/KEPT BUT STALE/g) || []).length, 4, "every architect-build mechanism artifact is detected");
    const forced = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--codex-prompts-dir", codexDir, "--force"], { encoding: "utf8", env: HERMETIC_ENV });
    assert.equal(forced.status, 1, "the hermetic forced rerun restores artifacts but remains honest about unverified Codex hook trust");
    const canonical = new Map([
      [body, path.join(KIT, "skills", "architect-build", "SKILL.md")],
      [routing, path.join(KIT, "skills", "architect-build", "ROUTING.md")],
      [claudeShim, path.join(KIT, "skill-shims", "claude", "architect-build.md")],
      [codexShim, path.join(KIT, "skill-shims", "codex", "architect-build.md")],
    ]);
    for (const [installed, source] of canonical) {
      assert.equal(readFileSync(installed, "utf8"), readFileSync(source, "utf8"), `${installed} is restored from the canonical artifact`);
      assert.equal(readFileSync(`${installed}.bak`, "utf8"), edited[installed], `${installed}.bak preserves the differing artifact`);
    }
    assert.equal(existsSync(`${path.join(dir, ".agents", "skills", "orchestrate", "SKILL.md")}.bak`), false,
      "an identical mechanism artifact gets no backup on --force");
  } finally { cleanup(); }
});

test("an obstructed repo-local architect skill fails while downstream hook controls still install", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-architect-obstruct-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-architect-obstruct-codex-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const obstruction = path.join(dir, ".agents", "skills", "architect-build");
    mkdirSync(path.dirname(obstruction), { recursive: true });
    writeFileSync(obstruction, "not a skill directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--codex-prompts-dir", codexDir], { encoding: "utf8" });
    assert.equal(r.status, 1, "an unavailable repo-local execution-method skill makes adoption nonzero");
    const output = r.stdout + r.stderr;
    assert.match(output, /repo-local mechanism skill artifact\(s\) could NOT install/, "the final report names the unavailable mechanism");
    assert.match(output, /mechanism skill shim reference\(s\) do NOT resolve/, "the dangling architect shims are named at final status");
    assert.ok(existsSync(path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs")), "downstream hook files still install");
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    assert.ok((settings.hooks?.PreToolUse || []).length > 0, "downstream hook registrations still install");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(codexDir, { recursive: true, force: true });
  }
});

test("an obstructed Claude mechanism shim fails while downstream hook controls still install", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-architect-shim-obstruct-"));
  const codexDir = mkdtempSync(path.join(os.tmpdir(), "kit-architect-shim-obstruct-codex-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const obstruction = path.join(dir, ".claude", "skills", "architect-build");
    mkdirSync(path.dirname(obstruction), { recursive: true });
    writeFileSync(obstruction, "not a skill directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--codex-prompts-dir", codexDir], { encoding: "utf8" });
    assert.equal(r.status, 1, "an unavailable Claude execution-method shim makes adoption nonzero");
    const output = r.stdout + r.stderr;
    assert.match(output, /mechanism skill "architect-build" Claude shim/, "the named unavailable mechanism is reported");
    assert.match(output, /repo-local mechanism skill artifact\(s\) could NOT install/, "the failure reaches final status");
    assert.ok(existsSync(path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs")), "downstream hook files still install");
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    assert.ok((settings.hooks?.PreToolUse || []).length > 0, "downstream hook registrations still install");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(codexDir, { recursive: true, force: true });
  }
});

test("an obstructed Codex mechanism shim fails while downstream hook controls still install", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-architect-codex-shim-obstruct-"));
  const scratch = mkdtempSync(path.join(os.tmpdir(), "kit-architect-codex-shim-prompts-"));
  const codexPromptsFile = path.join(scratch, "prompts-file");
  try {
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(codexPromptsFile, "not a prompts directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--codex-prompts-dir", codexPromptsFile], { encoding: "utf8" });
    assert.equal(r.status, 1, "an unavailable Codex execution-method shim makes adoption nonzero");
    const output = r.stdout + r.stderr;
    assert.match(output, /mechanism skill "architect-build" Codex shim/, "the named unavailable mechanism is reported");
    assert.match(output, /repo-local mechanism skill artifact\(s\) could NOT install/, "the failure reaches final status");
    assert.ok(existsSync(path.join(dir, ".claude", "hooks", "guard-lane-authoring.mjs")), "downstream hook files still install");
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    assert.ok((settings.hooks?.PreToolUse || []).length > 0, "downstream hook registrations still install");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("an obstructed optional Claude shim does not skip later mechanism shims or controls", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-humanize-shim-obstruct-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const obstruction = path.join(dir, ".claude", "skills", "humanize");
    mkdirSync(path.dirname(obstruction), { recursive: true });
    writeFileSync(obstruction, "not a skill directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, "an optional Claude shim obstruction remains warning-only");
    assert.match(r.stderr, /repo-local skills install failed/, "the optional shim obstruction is reported");
    assert.ok(existsSync(path.join(dir, ".agents", "skills", "orchestrate", "SKILL.md")),
      "the later mechanism body still installs");
    assert.ok(existsSync(path.join(dir, ".claude", "skills", "orchestrate", "SKILL.md")),
      "the later mechanism Claude shim still installs");
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    assert.ok((settings.hooks?.PreToolUse || []).length > 0, "downstream hook registrations still install");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an obstructed optional shared body does not skip later mechanism artifacts or controls", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-boot-body-obstruct-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    const obstruction = path.join(dir, ".agents", "skills", "boot");
    mkdirSync(path.dirname(obstruction), { recursive: true });
    writeFileSync(obstruction, "not a skill directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, "an optional shared-body obstruction remains warning-only");
    assert.match(r.stderr, /repo-local skills install failed/, "the optional body obstruction is reported");
    for (const name of ["frontier-review", "orchestrate"]) {
      assert.ok(existsSync(path.join(dir, ".agents", "skills", name, "SKILL.md")),
        `the later ${name} mechanism body still installs`);
      assert.ok(existsSync(path.join(dir, ".claude", "skills", name, "SKILL.md")),
        `the later ${name} mechanism Claude shim still installs`);
    }
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    assert.ok((settings.hooks?.PreToolUse || []).length > 0, "downstream hook registrations still install");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init installs the frontier-review skill + reviewer agents; the tools: [] cage survives verbatim", () => {
  const { dir, codexDir, run, cleanup } = adopt();
  try {
    const body = path.join(dir, ".agents", "skills", "frontier-review", "SKILL.md");
    const invoke = path.join(dir, ".agents", "skills", "frontier-review", "INVOKE.md");
    const claudeShim = path.join(dir, ".claude", "skills", "frontier-review", "SKILL.md");
    const codexShim = path.join(codexDir, "frontier-review.md");
    const cold = path.join(dir, ".claude", "agents", "cold-reviewer.md");
    const consult = path.join(dir, ".claude", "agents", "frontier-consult.md");
    for (const [label, p] of [["shared body", body], ["reference-layer sibling INVOKE.md", invoke],
      ["Claude shim", claudeShim], ["Codex shim", codexShim],
      ["cold-reviewer agent", cold], ["frontier-consult agent", consult]]) {
      assert.ok(existsSync(p), `${label} installed at ${p}`);
    }
    // The body is budget-capped, so on-demand mechanics live in the sibling — but a pointer to a
    // file that is not installed is a dead end, the same class as a shim naming a missing body.
    const bodyRefs = [...readFileSync(body, "utf8").matchAll(/\.agents\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)/g)];
    assert.ok(bodyRefs.length > 0, "the body points at its reference layer");
    for (const [, skill, file] of bodyRefs) {
      assert.ok(existsSync(path.join(dir, ".agents", "skills", skill, file)),
        `the body points at .agents/skills/${skill}/${file}, which must be installed`);
    }
    // The five honesty corrections stay in the BODY — a correction of a false claim must never sit
    // in a layer the executor may not load. Pinned so a future fold cannot quietly relocate one.
    const honestyText = readFileSync(body, "utf8");
    for (const [claim, probe] of [
      ["the cap is not mechanical", /nothing counts it/],
      ["the kit does not execute the cage enforcement", /does not execute the enforcement/],
      ["the consult never substitutes for a gate seat", /never substitutes/],
      ["the Codex lane is not packet-only", /NOT packet-only/],
      ["the packet carries the doctrine the caged seat cannot read", /the doctrine excerpts it is judged against/],
    ]) assert.match(honestyText, probe, `the body itself states: ${claim}`);
    // the shims point at a body that exists and carry no rules of their own (the shared-body invariant)
    for (const shim of [claudeShim, codexShim]) {
      assert.match(readFileSync(shim, "utf8"), /\.agents\/skills\/frontier-review\/SKILL\.md/, `${shim} names the shared body`);
      assert.doesNotMatch(readFileSync(shim, "utf8"), /Word budget/, `${shim} must not duplicate the body's rules`);
    }
    // THE load-bearing line, asserted as the LITERAL string the harness parses. `tools: []` is what
    // makes the consult seat's packet-only limit mechanical; a reworded or dropped line is the cage gone.
    const consultText = readFileSync(consult, "utf8");
    assert.match(consultText, /^tools: \[\]$/m, "frontier-consult carries the literal tools: [] line (the packet cage)");
    assert.match(readFileSync(cold, "utf8"), /^tools: Read, Grep, Glob$/m,
      "cold-reviewer keeps its read-only toolset (NOT caged — it must verify claims against the code)");
    // A plain re-run still KEEPS user edits — and since v2.16.0 it FAILS (exit 1) while doing so:
    // the frontier-review body and the agent seat are MECHANISM files, so a stale keep is a
    // failing state, never a silent success. Mutated first, so a regressed overwrite cannot hide.
    const edited = {};
    for (const p of [body, consult]) { edited[p] = readFileSync(p, "utf8") + "\n<!-- user edit: keep me -->\n"; writeFileSync(p, edited[p]); }
    const staleRerun = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
      "--repo-name", "adopter", "--codex-prompts-dir", codexDir], { encoding: "utf8" });
    assert.equal(staleRerun.status, 1, "a plain re-run over stale mechanism keeps FAILS");
    assert.match(staleRerun.stdout + staleRerun.stderr, /KEPT BUT STALE/, "…naming the keeps");
    for (const p of [body, consult]) assert.equal(readFileSync(p, "utf8"), edited[p], `re-run KEEPS the user-edited ${p} (no clobber without --force)`);
    // The cage check reads the INSTALLED file (a kept agent may be edited or stale). Probe it at
    // SEVERAL points, not one: a check proven against a single broken shape is proven against that
    // shape only — a relaxed anchor or a whole-file scope stays green under a one-mutation suite.
    const initSays = (args = []) => {
      const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
        "--codex-prompts-dir", codexDir, ...args], { encoding: "utf8" });
      // This test mutates INSTALLED mechanism files on purpose, so a plain rerun now legitimately
      // fails as a stale install; any other nonzero is a real error.
      assert.ok(r.status === 0 || (r.status === 1 && /KEPT BUT STALE/.test(r.stdout + r.stderr)),
        `init should exit 0, or fail only as a stale install: ${r.stderr}`);
      return r.stdout + r.stderr;
    };
    const fmSwap = (line) => writeFileSync(consult, consultText.replace(/^tools: \[\]$/m, line));
    for (const [line, label] of [["tools: '*'", "wildcard"], ["tools: [Read]", "a NON-empty list"],
      ["tools: Read, Bash, Write", "a plain tool list"], ["# tools: []", "the line commented out"]]) {
      fmSwap(line);
      assert.match(initSays(), /packet-only cage is NOT confirmed/, `init warns when the frontmatter reads ${label}`);
    }
    // THE false-pass a whole-file grep allows: frontmatter grants tools while some BODY line happens
    // to spell `tools: []`. The harness parses only the frontmatter; so must the check.
    writeFileSync(consult, consultText.replace(/^tools: \[\]$/m, "tools: Read, Bash, Write")
      + "\nMaintainer note — the kit default for this seat is:\ntools: []\n");
    assert.match(initSays(), /packet-only cage is NOT confirmed/,
      "a body line spelling `tools: []` must NOT certify a frontmatter that grants tools");
    // …and the converse: spellings YAML reads as an empty list must NOT warn. A check that cries
    // wolf on a genuinely caged seat is one adopters learn to ignore.
    for (const [line, label] of [["tools: []  ", "trailing whitespace"], ["tools: [] # none at all", "a trailing comment"],
      ["tools: [ ]", "a space inside the brackets"]]) {
      fmSwap(line);
      assert.doesNotMatch(initSays(), /cage is NOT confirmed/, `no false warning for ${label}`);
    }
    // ABSENCE IS NOT A PASS. The skill names a `subagent_type`; if THAT seat is not installed the
    // consult dead-ends, and a check that silently skips would report health on a broken adopt —
    // the same vacuity the shim check was hardened against ("zero matches means zero comparisons").
    // Produced the way it actually happens: the installed body names a seat that does not exist
    // (a renamed or half-updated skill). Note deleting the installed agent does NOT produce this —
    // init simply reinstalls it, which is why the check keys on the NAME, not on a fixed filename.
    writeFileSync(consult, consultText);   // healthy seat on disk…
    const bodyText = readFileSync(body, "utf8");
    writeFileSync(body, bodyText.replace('subagent_type: "frontier-consult"', 'subagent_type: "frontier-consult-v2"'));
    const absent = initSays();
    assert.match(absent, /"frontier-consult-v2".*is NOT installed/s, "a named seat that is NOT installed is reported, not silently skipped");
    assert.doesNotMatch(absent, /cage \("tools: \[\]"\) is present/, "…and init does not also certify a cage it never checked");
    writeFileSync(body, bodyText);
    // --force restores the kit's verbatim agent and the check clears. Since v2.16.0 the forced
    // rerun exits 1 in a hermetic adopter (armed-check unverifiable) and DIFFERING [P] files get a
    // .bak — the subject here is the restored bytes, so run via spawnSync and read them.
    spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--codex-prompts-dir", codexDir, "--force"], { encoding: "utf8", env: HERMETIC_ENV });
    assert.equal(readFileSync(consult, "utf8"), readFileSync(path.join(KIT, "agents", "frontier-consult.md"), "utf8"),
      "--force restores the kit's frontier-consult verbatim");
    assert.ok(!existsSync(`${consult}.bak`),
      "an IDENTICAL mechanism [P] asset gets NO .bak on --force — backups exist for differing files only (that polarity is pinned in the v2.1.1 upgrade test), never as noise");
    const clean = initSays();
    assert.doesNotMatch(clean, /cage is NOT confirmed/, "no cage warning against a healthy installed seat (discriminates, no cry-wolf)");
    assert.match(clean, /cage \("tools: \[\]"\) is present/, "…and it says so positively, so silence is never the only evidence");
  } finally { cleanup(); }
});

test("the agents install is FAILURE-ISOLATED: it cannot abort the hook registration that follows it", () => {
  // § 4e is a NUDGE; § 5 (merging the PreToolUse/Stop registrations) is a CONTROL. An exception
  // escaping the agents block would leave hook FILES on disk with ZERO registrations — the silent
  // fail-open mergeSettings' own read-back exists to stop. The commands block has had this proof
  // since v1.1; § 4e shipped without its counterpart, and removing the try/catch left BOTH suites
  // green. This is that missing canary.
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-agentfail-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    // A regular FILE where the directory must be: the copy throws (ENOTDIR/EEXIST) mid-block.
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    writeFileSync(path.join(dir, ".claude", "agents"), "not a directory\n");
    const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt"], { encoding: "utf8" });
    assert.equal(r.status, 0, `a failed agents install must NOT abort the adopt: ${r.stderr}`);
    assert.match(r.stderr, /review-seat agents install failed/, "…it warns plainly instead of dying");
    // THE assertion that matters: the CONTROL downstream of the failure still ran.
    const settings = JSON.parse(readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const cmds = [...(settings.hooks?.PreToolUse ?? []), ...(settings.hooks?.Stop ?? [])].flatMap((g) => g.hooks ?? []).map((h) => String(h.command));
    assert.equal(cmds.filter((c) => /guard-(cross-repo-writes|lane-authoring|gate-ladder)\.mjs/.test(c)).length, 3,
      "the 3 PreToolUse guards are STILL registered after the agents block failed");
    assert.equal(cmds.filter((c) => c.includes("guard-owner-comms.mjs")).length, 1,
      "…and so is the Stop sensor");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("init verifies the INSTALLED shims, and a shim naming no body is a failure not a pass", () => {
  const { dir, run, cleanup } = adopt(["--skip-codex-prompt"]);
  try {
    const shim = path.join(dir, ".claude", "skills", "humanize", "SKILL.md");
    // BOTH streams: init's log() goes to stdout but warn() goes to stderr, and the dangling-shim
    // report is a warning. Reading stdout alone would make every assertion below unfalsifiable.
    const runOut = (args) => {
      const r = spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir,
        "--repo-name", "adopter", "--skip-codex-prompt", ...args], { encoding: "utf8" });
      assert.equal(r.status, 0, `init should exit 0: ${r.stderr}`);
      return r.stdout + r.stderr;
    };
    assert.match(runOut([]), /body reference\(s\).*all resolve on disk/, "a healthy install reports resolution");
    // A KEPT shim is the one the harness loads. Point it at a body that does not exist: init must
    // read the INSTALLED file, not the kit's pristine source, or it certifies a shim it never saw.
    writeFileSync(shim, "---\nname: humanize\n---\nRead `.agents/skills/gone-forever/SKILL.md`.\n");
    const out = runOut([]);
    assert.match(out, /gone-forever\/SKILL\.md, which is NOT installed/, "a dangling INSTALLED shim is reported");
    assert.match(out, /do NOT resolve/, "and the summary line says so rather than claiming success");
    assert.doesNotMatch(out, /all resolve on disk/, "init must not also print a clean bill of health");
    // A shim naming NO body at all: zero matches must not read as zero failures.
    writeFileSync(shim, "---\nname: humanize\n---\nNo body reference here at all.\n");
    assert.match(runOut([]), /names NO \.agents\/skills/, "a shim with zero body references is a failure, not a vacuous pass");
    // Restore for any later assertions in this test file (exit 1 is the hermetic norm — ignored).
    spawnSync("node", [path.join(KIT, "bin", "init.mjs"), "--target", dir, "--repo-name", "adopter",
      "--skip-codex-prompt", "--force"], { encoding: "utf8", env: HERMETIC_ENV });
  } finally { cleanup(); }
});
