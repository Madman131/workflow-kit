# Codex Stop probe receipt — kit v2.40.0 (redacted)

Date 2026-09-30. Client: `codex-cli` 0.159.2. Purpose: observe the Codex `Stop` payload, `decision:"block"` and
`stop_hook_active` BEFORE registering a Stop sensor (the kit's rule: no sensor against an unobserved shape).

## Probe
A scratch git repo with `.codex/hooks.json` holding one `Stop` command hook. The hook logged its stdin to a file; on its first
run it printed `{"decision":"block","reason":"PROBE: reply with the single word BLOCKED-OK"}`, afterwards nothing.
The Owner trusted the project and the hook interactively. Run: `codex exec -s read-only --skip-git-repo-check "Say the single word HELLO…"`.
A first run with NO trust wrote no payload: Codex records trust per project and per `hooks.json` entry and skips an untrusted hook silently.

## Observed (payload, both invocations)
Keys: `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name:"Stop"`, `model`, `permission_mode`, `stop_hook_active`, `last_assistant_message`.
1. Invocation 1: `stop_hook_active:false`, `last_assistant_message:"HELLO"`. The hook returned `decision:"block"` + `reason`. Codex printed
   "hook: Stop Blocked" and CONTINUED the turn; the reason arrived as a new user message and the model replied "BLOCKED-OK".
2. Invocation 2 (the continuation's Stop): `stop_hook_active:true`, `last_assistant_message:"BLOCKED-OK"`, the SAME `turn_id`. The hook printed
   nothing and the turn ended. Block-once through the `stop_hook_active` guard works.
3. `transcript_path` is the rollout JSONL under `~/.codex/sessions/YYYY/MM/DD/`. The payload's `turn_id` equals the transcript's `task_started`
   `turn_id`. The final assistant message is already written to the transcript when the hook runs, followed by the block's user message
   `<hook_prompt hook_run_id="stop:0:…/.codex/hooks.json">REASON</hook_prompt>`.

## Observed (transcript shapes the sensor reads; real rollouts, 2026-09-30, one delegated PM session and the probe session)
Each line is `{timestamp, ordinal, type, payload[, metadata]}`.
- Turn start: `type:"event_msg"`, `payload:{type:"task_started", turn_id, root_turn_id, …}`.
- A message FROM another thread: `type:"response_item"`, `payload:{type:"function_call_output", name:"create_thread"|"send_message_to_thread",
  namespace:"codex_app", output:"<codex_delegation><source_thread_id>ID</source_thread_id><input>…"}`. `source_thread_id` is the sender
  (the output's own text says "Source thread: ID" under "SENDER USER MESSAGES").
- A message this thread SENT: never a `function_call` named `send_message_to_thread` (none in either rollout). It is
  `type:"event_msg"`, `payload:{type:"item_completed", item:{type:"McpToolCall", server:"codex_app", tool:"send_message_to_thread",
  arguments:{threadId, prompt}, status:"completed"}}`; the same send also appears as an `exec` custom_tool_call whose `input` is JavaScript.
- An async Owner ask: `type:"response_item"`, `payload:{type:"function_call", name:"request_user_input_async", arguments, call_id}`, then a
  `function_call_output` with the same `call_id` and `output:"{\"accepted\":true}"` — an ACKNOWLEDGEMENT, delivered within milliseconds, never the answer
  (all four asks in the delegated session had it, yet one never surfaced to the Owner). The answer arrives later as a `role:"user"` message whose text is
  `<send_user_message_question_reply>` naming `request_user_input_async` and the `call_id`.
- An Owner message: a `role:"user"` message with typed text. Host-injected `role:"user"` messages open with `<` (`<environment_context>`,
  `<external_codex_apps_open_page>`, `<skill>`, `<hook_prompt …>`) or `# AGENTS.md instructions`.
- A final message: `role:"assistant"`, `payload.phase:"final_answer"`.

## Not observed (so not coded)
- A transcript marker for an Owner-ended final close.
- How a scheduled heartbeat turn arrives (it may be an ordinary user message).
- Whether a Stop hook fires for a Codex subagent turn (the sensor ignores a payload that carries `agent_id` or `agent_type`).

## Checked against the real rollout
Replaying the delegated PM rollout (turn by turn, the transcript cut at each `task_complete`) the sensor's triggers fire on exactly the silent
stops measured that day (no send to the delegating thread; an async ask with no label in the final message) and stay silent on the turn that
sent its notice and ended with a labeled ask.
