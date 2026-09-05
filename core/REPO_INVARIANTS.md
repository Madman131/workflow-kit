# Workflow-Kit repository invariants

> **CLASS: BINDING** · These facts are specific to the kit repository and accompany the portable
> `core/INVARIANTS.md` in frozen review payloads.

- This repository is the portable Workflow-Kit source. Its committed `core/`, `scripts/`, `tests/`,
  `templates/`, and `skills/` content is the method and its controls; adopter repositories are
  separate and must not be inferred from this tree.
- The frozen Gemini gate is a read-only review control. It may read committed Git objects and write
  only its sanctioned durable journal or gate artifacts; it must never mutate an adopter, push,
  deploy, or execute provider-returned tools.
- `scripts/cold-review-gemini.sh` is the public entrypoint. Its frozen tuple path uses the direct
  text transport; its legacy design/working-tree paths retain their documented `agy` behavior.
- A release claim requires exact tuple provenance, complete ordered scope, a verified response, and
  a durable receipt. Focused tests or a selftest alone do not establish a live provider or release.
- Changes to these repository invariants are themselves review material and require the same exact
  frozen provenance and gate controls as any other committed change.
