// scripts/codex-banner.mjs — read a Codex run's SEAT from the banner it prints, never from the
// model's own words. A seat claim made by the thing being seated is not evidence; the banner is
// emitted by the CLI before the model speaks.
//
// Extracted deliberately as its own module rather than ported wholesale from the originating
// repo's much larger multi-arm harness: the sweep sensor needs exactly these two functions, and
// carrying the rest would import machinery this kit does not ship.
//
// EVERY FIELD IS `null` WHEN ABSENT, and null is never folded into an OK. A caller compares each
// field explicitly and fails CLOSED on a mismatch; there is deliberately no "looks close enough".

/**
 * The banner block: the lines between the first two horizontal rules that follow the version line.
 * Returns null when the shape is not present — a transcript with no banner yields no seat, which
 * every caller must treat as UNVERIFIED rather than as "defaults were used".
 */
export function bannerBlock(logText) {
  const lines = String(logText).split("\n");
  const vIdx = lines.findIndex((l) => /^\s*OpenAI Codex\s+v/i.test(l));
  if (vIdx === -1) return null;
  const rules = [];
  for (let i = vIdx + 1; i < lines.length && rules.length < 2; i++) {
    if (/^-{4,}\s*$/.test(lines[i])) rules.push(i);
  }
  return rules.length < 2 ? null : lines.slice(rules[0] + 1, rules[1]).join("\n");
}

/** Read the seat from the banner. Every field is null when absent — null is never folded into ok. */
export function parseBanner(logText) {
  const block = bannerBlock(logText);
  const field = (label) => {
    if (block === null) return null;
    const m = block.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, "im"));
    return m ? m[1] : null;
  };
  // Read from the WHOLE log, not the banner block: a token count is a measurement the CLI prints
  // at the end, not a seat claim, so reading it outside the block cannot forge a false OK.
  const tok = String(logText).match(/^tokens used\s*$\s*([0-9][0-9,]*)/im);
  return {
    model: field("model"),
    effort: field("reasoning effort"),
    workdir: field("workdir"),
    // Printed as `<mode> [roots] (network access …)`, so the mode is the first token and the
    // writable roots are the bracketed list. Both are the run's CONTAINMENT and are verified, not
    // assumed: a host config default may be far wider than read-only, and an un-narrowed
    // workspace-write grants more roots than a caller expects — either way a run that lost a flag
    // would be less contained and otherwise look healthy.
    sandbox: (field("sandbox") || "").split(/[\s[]/)[0] || null,
    sandboxRoots: (() => {
      const raw = field("sandbox");
      if (raw === null) return null;
      // STRICT whole-field parse: mode, exactly one bracket group, optionally the network suffix,
      // nothing else. Any unrecognised form — including a second bracket group AFTER the suffix —
      // yields null (⇒ UNVERIFIED), never a partial parse that reads as narrowed.
      const m = raw.match(/^\S+\s*\[([^\]]*)\]\s*(?:\(network access [a-z]+\))?\s*$/);
      return m ? m[1].trim() : null;
    })(),
    sessionId: field("session id"),
    tokens: tok ? Number(tok[1].replace(/,/g, "")) : null,
  };
}
