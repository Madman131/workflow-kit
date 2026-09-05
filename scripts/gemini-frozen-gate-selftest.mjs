#!/usr/bin/env node
// Installed deterministic smoke for the direct transport's response firewall. It makes no network
// request and never reads GEMINI_API_KEY.
import assert from "node:assert/strict";
import { verifyResponse } from "./gemini-frozen-gate.mjs";

const e = { receipt: "PIL-RCPT-test", canary: "PIL-INGEST-test", done: "PIL-DONE-test", name: "full" };
const good = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "PIL-RCPT-test\nPIL-INGEST-test\nVERDICT: GO\nINSPECTED SCOPE: full all files\nPIL-DONE-test" }] } }] };
assert.equal(verifyResponse(good, e).verdict, "GO");
assert.throws(() => verifyResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "write" } }] } }] }, e));
assert.throws(() => verifyResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: good.candidates[0].content.parts[0].text }] } }] }, e));
process.stdout.write("gemini frozen direct selftest: response firewall controls passed (no network)\n");
