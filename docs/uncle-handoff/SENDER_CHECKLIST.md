# Sending Workflow-Kit to a Family Member

Use this checklist to deliver a clean, verifiable copy of Workflow-Kit plus the two documents the
recipient needs. The recommended path is private Git access. A commit-built ZIP is the fallback.

## What to send

Send these four things together:

1. **Workflow-Kit source** from a private Git repository or a ZIP made from one exact commit.
2. **The exact 40-character commit SHA** being transferred and the expected `VERSION` value.
3. [`CODEX_ADOPTION_TICKET.md`](CODEX_ADOPTION_TICKET.md) — the prompt to give Codex while Codex is
   running from the recipient's own target repository.
4. [`FACTSHEET.md`](FACTSHEET.md) — the short human explanation of the method and its responsibilities.

Also send this small intake block after filling only facts you already know:

```text
First target repository: <name and clone URL, or "help me create/select it">
Owner name: <recipient's preferred name>
Deploy branch: <usually main>
What a push to that branch does: <no deployment / deploys to ... / unknown>
Live or irreversible assets: <money, production data, messages, credentials, none, or unknown>
Preferred permanent worktree roots: <paths, or "have Codex propose them">
Provider accounts already available: Codex <yes/no>, Claude Code <yes/no>, Gemini <yes/no>
```

Do not guess unknown answers. The adoption ticket tells Codex to inspect what it can and bring only
real Owner decisions back to the recipient.

## Recommended delivery: private Git access

Private Git access preserves history, makes the commit identity independently checkable, and gives
the recipient a normal upgrade path.

Before granting access, run from the canonical Workflow-Kit checkout:

```sh
git status --short
git rev-parse HEAD
git show HEAD:VERSION
npm test
npm run acceptance
```

Required result:

- `git status --short` prints nothing.
- The SHA and `VERSION` are copied into the handoff message.
- Both verification commands exit `0`.

Then add the recipient's own Git-host account as a collaborator to the **private** repository and
send the private clone URL. Ask the recipient to verify:

```sh
git rev-parse HEAD
sed -n '1p' VERSION
npm test
```

The first command must equal the SHA in the handoff message. A branch name is not an identity.

## Fallback delivery: exact-commit ZIP

Do not make the ZIP by dragging the working folder in Finder. That can include ignored runtime
state, local configuration, credentials, or an accidental dirty change. Build it from the committed
Git tree:

```sh
git -C <workflow-kit-path> status --short
git -C <workflow-kit-path> archive --format=zip \
  --output <private-destination>/workflow-kit-<short-sha>.zip <40-character-sha>
shasum -a 256 <private-destination>/workflow-kit-<short-sha>.zip
```

Only proceed if the status command is empty and `<40-character-sha>` is the intended handoff commit.
Send the SHA-256 checksum in a separate message. The recipient verifies it before unzipping:

```sh
shasum -a 256 workflow-kit-<short-sha>.zip
unzip workflow-kit-<short-sha>.zip -d workflow-kit
cd workflow-kit
sed -n '1p' VERSION
npm test
```

A ZIP does not carry the repository's `.git` history. Prefer private Git when future upgrades or
auditing matter.

## Never send

- API keys, passwords, OAuth tokens, browser cookies, SSH private keys, `.env` files, or credential
  exports.
- The contents of the sender's `~/.codex`, `~/.claude`, Gemini profile, or other provider session
  directories.
- A configured adopter repository as a substitute for Workflow-Kit. Generated `[G]` files such as
  `core/BINDINGS.md`, `core/OWNER_COMMS.md`, and `core/SYSTEM_MAP.md` belong to one repository and
  must not be copied into another.
- `.codex/hooks.json` from another checkout. It contains absolute paths for that checkout and is
  intentionally per-checkout and gitignored.
- Local ledgers, token telemetry, `.bak` upgrade files, temporary gate packets, or review replies.
- Access to the sender's Codex, Claude, or Gemini account. The recipient signs into each provider
  directly on their own Mac when Codex reaches that setup step.

`package.json` currently declares the kit `UNLICENSED`. Keep the transfer private and do not invite
public redistribution unless the repository owner deliberately chooses and adds a license.

## What the recipient does

1. Install or verify Git and Node.js using current official instructions.
2. Clone or unpack Workflow-Kit into its own directory.
3. Open the **target project repository** in Codex, not the Workflow-Kit source directory.
4. Paste the entire adoption ticket into that Codex task and provide the intake block.
5. Let Codex complete read-only discovery and local installation work.
6. When Codex queues a human action, the recipient performs it directly:
   - approve Codex hook trust interactively and run the arming probe;
   - install/sign in to Claude Code for an independent code-review seat;
   - open/sign in to Gemini for the cross-family design-review seat;
   - approve any package installation, push, deployment, or live operation separately.
7. Keep the factsheet. It explains which parts are hard controls and which remain a disciplined
   agreement between the Owner and the agents.

## Sender's final handoff message

```text
This is Workflow-Kit version <VERSION> at exact commit <40-character-sha>.
Private source: <clone URL or private ZIP name>
ZIP SHA-256, if used: <checksum>

Start Codex from your own target project repository and paste CODEX_ADOPTION_TICKET.md into a new
task. Do not paste or send passwords, tokens, or API keys to me or to Codex. When setup needs a
provider login or hook-trust approval, Codex will stop that substep, explain the exact action, and
you will complete it directly on your Mac.
```
