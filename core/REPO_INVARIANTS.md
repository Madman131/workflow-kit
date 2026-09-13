# Workflow-Kit repository invariants

> **CLASS: BINDING** · These facts are specific to the kit repository and accompany the portable
> `core/INVARIANTS.md` in frozen review payloads.

- This repository is the portable Workflow-Kit source. Its committed `core/`, `scripts/`, `tests/`,
  `templates/`, and `skills/` content is the method and its controls; adopter repositories are
  separate and must not be inferred from this tree.
- This repository BUILDS with the method; it does not INSTALL the method into itself. Every
  changeset here owes what any adopter's changeset owes — the tier, the freeze, the cold seat, a
  RULE #1 disposition per finding, a current lane declaration, the every-lane commit floor — and how
  each of those is ARMED here is this repository's own business, because the obligation is on the
  build and not on the installation route. Running `bin/init.mjs` against this tree is not a way to
  satisfy any of them and is not done: it would write the generated identity set below.
- The generated identity set — `CLAUDE.md`, `AGENTS.md`, `core/BINDINGS.md`, `core/OWNER_COMMS.md`,
  `core/SYSTEM_MAP.md` — never exists here. Those files name a person, a repository and a remote,
  and this is a template repository; `tests/kit-controls.test.mjs` fails if a concrete
  `core/OWNER_COMMS.md` appears. So a control or a clause that resolves through one of them cannot
  run in this tree. A kit changeset owing such a rung derives an instrument that meets the rung's
  own description and RECORDS it as derived rather than bound — that is the honest handling, and it
  is not an exemption.
- The frozen Gemini gate is a read-only review control. It may read committed Git objects and write
  only its sanctioned durable journal or gate artifacts; it must never mutate an adopter, push,
  deploy, or execute provider-returned tools.
- `scripts/cold-review-gemini.sh` is the public entrypoint. Its frozen tuple path normally uses the
  subscription-only `agy` transport in its documented disposable request-review rig, with exact
  tuple/endpoint checks and durable receipts. Strict manual Gemini-subscription export/import remains
  the explicit high-sensitivity fallback. Neither frozen route accepts REST/API credentials or a
  direct REST transport.
- A release claim requires exact tuple provenance, complete ordered scope, a verified response, and
  a durable receipt. Focused tests or a selftest alone do not establish a live provider or release.
- Changes to these repository invariants are themselves review material and require the same exact
  frozen provenance and gate controls as any other committed change.
