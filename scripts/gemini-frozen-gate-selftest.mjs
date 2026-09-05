#!/usr/bin/env node
// Installed deterministic smoke for the direct transport's response firewall. It makes no network
// request and never reads GEMINI_API_KEY.
import assert from "node:assert/strict";
import { verifyResponse } from "./gemini-frozen-gate.mjs";

const e = { scope: "{\"slice\":\"full\"}", markers: ["PIL-INGEST-HEAD-test", "PIL-INGEST-MIDDLE-test", "PIL-INGEST-EOF-test"] };
const good = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: `VERDICT: GO\nINSPECTED SCOPE: ${e.scope}\nINGESTION PROOF: ${e.markers.join(" | ")}` }] } }] };
assert.equal(verifyResponse(good, e).verdict, "GO");
assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "write" } }] } }] }, e));
assert.throws(() => verifyResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: good.candidates[0].content.parts[0].text }] } }] }, e));
assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: good.candidates[0].content.parts[0].text, thought: true }] } }] }, e));
process.stdout.write("gemini frozen direct selftest: response firewall controls passed (no network)\n");
