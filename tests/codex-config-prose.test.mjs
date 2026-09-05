// codex/config.toml is [P]: installed verbatim into every adopter's .codex/. Its header comment is
// the first thing an Owner reads about Codex-lane enforcement, and until v2.28.0 it still said the
// kit registers NO Codex hooks and a guard was "in flight" — v2.0 prose shipped beside an installer
// that writes the registration on every default run. An Owner who believes it never grants hook
// trust, and the installed guards stay inert. Pinned so the comment cannot drift from the mechanism.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("codex/config.toml describes the shipped registration model, not the v2.0 absence of one", () => {
  const text = readFileSync(path.join(KIT, "codex", "config.toml"), "utf8");
  assert.doesNotMatch(text, /registers NO Codex hooks|in flight/i, "the v2.0 claim is gone");
  assert.match(text, /\.codex\/hooks\.json, which\s*\n#\s*`init` GENERATES/, "it names the generated registration");
  assert.match(text, /hook trust in an INTERACTIVE codex session/, "…the trust gate");
  assert.match(text, /check-codex-hooks-armed\.mjs/, "…and the arming probe");
  assert.match(text, /kit's PORTABILITY\.md § The enforcement asymmetry/, "…and points at the kit's contract, in the kit");
  assert.doesNotMatch(text, /^\s*\[hooks\]|^\s*hooks\s*=/m, "and still declares no hooks itself — one representation");
});
