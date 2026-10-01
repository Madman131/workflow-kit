// workflow-kit — transcript record builders for tests/stop-notice.test.mjs.
// EVERY builder below reproduces the KEYS AND NESTING of a record observed in a real Codex rollout
// (codex-cli 0.159.2, 2026-09-30; see docs/journal/2026-09-30-codex-stop-probe-receipt.md). Text and ids are
// redacted placeholders; no shape here is invented. A trigger with no builder here has no observed shape.

export const ARCHITECT = "00000000-aaaa-7000-8000-00000000000a";
export const OTHER = "00000000-bbbb-7000-8000-00000000000b";
let ordinal = 0;
const line = (type, payload, extra = {}) => JSON.stringify({ timestamp: "2026-09-30T23:40:26.937Z", ordinal: ++ordinal, type, payload, ...extra });
const turnMeta = (turnId) => ({ turn_id: turnId, create_time: 1790811770.588618 });

// event_msg / task_started — the turn start; payload.turn_id equals the Stop payload's turn_id.
export const taskStarted = (turnId) => line("event_msg", { type: "task_started", turn_id: turnId, root_turn_id: turnId, started_at: 1790811626, model_context_window: 258400, collaboration_mode_kind: "default" });

// response_item / function_call_output (namespace codex_app) — a message FROM thread `from`.
// `input` is the sender's text; real leads seen in rollouts: "STOP: …", "CONSULT: …", "RULING NEEDED …", "ARCHITECT_STATUS_V1\n…", directives.
export const delegation = (turnId, from, name = "send_message_to_thread", input = "REDACTED directive", namespace = "codex_app") => line("response_item", {
  type: "function_call_output", id: "fco_00000000-0000-7000-8000-000000000001", name, namespace,
  output: `<codex_delegation>\n  <source_thread_id>${from}</source_thread_id>\n  <input>${input}</input>\n</codex_delegation>`,
  internal_chat_message_metadata_passthrough: turnMeta(turnId),
}, { metadata: { client_authored: false } });

// event_msg / item_completed with a McpToolCall — a send this thread made. status is "completed" or "failed".
export const sent = (turnId, to, status = "completed", tool = "send_message_to_thread") => line("event_msg", {
  type: "item_completed", thread_id: "00000000-cccc-7000-8000-00000000000c", turn_id: turnId,
  item: { type: "McpToolCall", id: "exec-00000000-0000-4000-8000-000000000002", server: "codex_app", tool,
    arguments: { threadId: to, prompt: "STOP: REDACTED; next action: REDACTED; actor: REDACTED" }, pluginId: "codex-app-tools@openai-bundled",
    status, result: { content: [{ type: "text", text: `{"threadId":"${to}"}` }], isError: false }, duration: { secs: 0, nanos: 374511875 } },
  started_at_ms: 1790813506394, completed_at_ms: 1790813512133,
});

// response_item / custom_tool_call `exec` whose input is JavaScript — the OTHER spelling of a send. Not parsed by the sensor.
export const execSendJs = (turnId, to) => line("response_item", {
  type: "custom_tool_call", id: "ctc_0000", status: "completed", call_id: "call_exec0000", name: "exec",
  input: `await tools.mcp__codex_app__send_message_to_thread({threadId:"${to}",hostId:"local",prompt:"STOP: REDACTED"})`,
  internal_chat_message_metadata_passthrough: turnMeta(turnId),
});

// response_item / function_call request_user_input_async, then its function_call_output {"accepted":true} (an acknowledgement).
export const asyncAsk = (turnId, callId) => line("response_item", {
  type: "function_call", id: "fc_0000", name: "request_user_input_async",
  arguments: JSON.stringify({ questions: [{ title: "REDACTED question", options: ["Authorize", "Do not authorize"] }] }), call_id: callId,
  internal_chat_message_metadata_passthrough: turnMeta(turnId),
}, { metadata: { client_authored: false, user_input_order: 97 } });
export const asyncAck = (turnId, callId) => line("response_item", {
  type: "function_call_output", id: "fco_0000", call_id: callId, output: "{\"accepted\":true}",
  internal_chat_message_metadata_passthrough: turnMeta(turnId),
}, { metadata: { client_authored: false, fallback_token_limit_override: 12000 } });

const userMessage = (turnId, text) => line("response_item", {
  type: "message", id: "msg_00000000-0000-7000-8000-000000000003", role: "user", content: [{ type: "input_text", text }],
  internal_chat_message_metadata_passthrough: { ...turnMeta(turnId), content_item_kinds: ["user.text"] },
}, { metadata: { client_authored: false, user_input_order: 100 } });
// role:user messages the host injects — never an Owner message.
export const envContext = (turnId) => userMessage(turnId, "<environment_context>\n  <current_date>2026-09-30</current_date>\n</environment_context>");
export const openPage = (turnId) => userMessage(turnId, "<external_codex_apps_open_page>{\"page_id\":null}</external_codex_apps_open_page>");
export const agentsMd = (turnId) => userMessage(turnId, "# AGENTS.md instructions for /redacted\n\n<INSTRUCTIONS>\nREDACTED\n</INSTRUCTIONS>");
export const hookPrompt = (turnId, reason) => userMessage(turnId, `<hook_prompt hook_run_id="stop:0:/redacted/.codex/hooks.json">${reason}</hook_prompt>`);
// An Owner message: typed text.
export const ownerSays = (turnId, text = "continue with the build\n") => userMessage(turnId, text);
// The Owner's answer to an async ask: a user message naming the call id.
export const questionReply = (turnId, callId) => userMessage(turnId, `<send_user_message_question_reply>\n[{"questionItemId":"[\\"request_user_input_async\\",\\"${callId}\\",0]","question":"REDACTED question","answer":"Authorize"}]\n</send_user_message_question_reply>`);

// response_item / assistant message, phase final_answer (or commentary).
export const assistant = (turnId, text, phase = "final_answer") => line("response_item", {
  type: "message", id: "msg_09a8f5373e8628e9016abdaabcb84c87d199e6f9148d4535d8", role: "assistant", content: [{ type: "output_text", text }], phase,
  internal_chat_message_metadata_passthrough: { turn_id: turnId, content_item_kinds: ["unknown"] },
}, { metadata: { client_authored: false, user_input_order: 124 } });

// Lines the sensor must skip cheaply.
export const tokenCount = () => line("event_msg", { type: "token_count", info: { total_token_usage: { input_tokens: 1 } } });

export const transcript = (...lines) => lines.join("\n") + "\n";
