# `codex exec --json` events receipt — kit v2.41.0 (redacted)

Date 2026-10-01. Client: `codex-cli` 0.159.2, model `gpt-5.6-terra`, effort `low`, `-s read-only`, `--json`, run through the same
guard conventions as `scripts/codex-gate.sh` (the `claude` shim first on PATH, `PIL_BLOCK_CLAUDE_COMPANION=1`, Anthropic keys emptied, prompt on stdin).
Purpose: observe how a seat's file opens appear in the event stream BEFORE writing the `--expect-files` matcher (the kit's rule: no matcher
against an unobserved shape; D-107). Two real runs in this repo at `9f600d9`; their fixtures are `tests/fixtures/codex-exec-*`.

## Event inventory (every line of both streams)
One JSON object per line on stdout:
- `{"type":"thread.started","thread_id":"…"}` (the wrapper already reads this).
- `{"type":"item.completed","item":{"id","type":"error","message"}}` — host warnings (an unstable-features notice, a hook-timeout clamp). They are NOT failures and carry local paths (redacted in the fixture).
- `{"type":"turn.started"}`.
- `{"type":"item.completed","item":{"id","type":"agent_message","text"}}` — the seat's prose, including its final answer.
- `{"type":"item.started","item":{"id","type":"command_execution","command","aggregated_output":"","exit_code":null,"status":"in_progress"}}`
- `{"type":"item.completed","item":{"id","type":"command_execution","command","aggregated_output":"<text>","exit_code":0,"status":"completed"}}` — the same `id` as its `item.started`.
- `{"type":"turn.completed","usage":{…}}`.

Not seen in either run: a file-read item type, an `apply_patch` view, an MCP tool call, a `file_change` item, a web search. Every file open was a `command_execution`.

## How the seat actually opened files (run 2: five files named in the prompt, no method suggested)
- `command` is `/bin/zsh -lc "<script>"`; the script is often MULTI-LINE or chained with `&&`, and names several files at once. Three commands covered five files:
  `rg -n -C 5 "Gotchas / traps" core/GATES.md && printf '…--- <path> ---…' && sed -n '1,260p' <path> && …`; five `sed -n 'A,Bp' <path>` lines, newline-separated; and
  `nl -ba <path> | sed -n 'A,Bp'` four times.
- `aggregated_output` is ONE string holding the merged output of the whole script (60 KB, 43 KB and 39 KB here; not truncated). Nothing in it attributes a line to a file except
  the seat's own `printf` markers, which it chose to add in only one of the three scripts. `nl -ba` prefixes each line with `<number>\t`; `rg -n -C` prefixes `<number>-` or `<number>:`.
  The text of every file line is still present as a substring. `exit_code` was 0 on all three.
- The seat's final text named a `VERDICT` and an `INSPECTED SCOPE` that listed all five files, and it had in fact read all five.

## Run 1 — the trap this chip is built around (four files named, one read)
The prompt asked for VERSION (whole), `core/WORKFLOW.md` lines 95-99, the first 20 lines of `hooks/sensor-stop-notice.mjs`, the first 5 lines of `PORTABILITY.md`, and a search for `LABEL_LINE`.
The seat answered with ONE command: `version_value=$(sed -n '1,200p' VERSION); sed -n '95,99p' core/WORKFLOW.md >/dev/null; sed -n '1,20p' hooks/sensor-stop-notice.mjs >/dev/null; sed -n '1,5p' PORTABILITY.md >/dev/null; rg -n --fixed-strings 'LABEL_LINE' . >/dev/null; printf '%s\n' "$version_value"`.
Its `aggregated_output` was `2.40.0\n`. The seat's reply then listed all four files as read. A matcher keyed on "the command names the path" would credit three files whose output was discarded.
This is the observed instance of the failure the gate guards (`core/GATES.md` § Gotchas / traps: a seat's account of its own method is satisfied by the failure it describes).

## What the matcher therefore keys on
A file counts as OPENED only when some `item.completed` / `command_execution` record (a) has the file's repo-relative path (or its basename as a whole token) in `command`, AND (b) has `aggregated_output`
containing at least `min(3, n)` distinct trimmed lines of the file's own content as substrings, where n is the number of its lines of 12+ characters (all its nonblank lines when it has none).
`item.started` records (empty output) earn nothing. An unrecognised shape earns nothing, so a client that changes the stream fails CLOSED (exit 3).

## Not observed (so not coded)
- Truncation of `aggregated_output` on very large reads. A seat that reads a huge file may be under-credited (fails closed; re-run with a prompt that reads in ranges).
- Any non-`command_execution` way of opening a file (an MCP read tool, a patch view). Under the current client none appears; if one does, it earns no credit.
- The event shapes of `codex exec resume` (no `--json` is passed on warm rounds), so `--expect-files` is cold-only.
- Whether a seat can satisfy the content test without reading (printing a distinctive line of file A while naming A in a command that reads B). Reachable only by a seat steering around the check; recorded as a residual in `core/GATES.md`.

## Fixture
`tests/fixtures/codex-exec-read-events.jsonl` is run 2: the commands are verbatim; each `aggregated_output` is trimmed to the first seven nonblank lines of each file's real section (the `printf` markers and the `nl` prefixes
kept); local paths are redacted. `codex-exec-read-files.json` is the content those sample lines come from (the test builds a repo from it). `codex-exec-devnull-events.jsonl` is run 1, whole.
