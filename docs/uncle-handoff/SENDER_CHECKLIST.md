# Sending Workflow-Kit to a Family Member

Use this checklist to deliver a clean, verifiable copy of Workflow-Kit plus the two documents the
recipient needs. The recommended path is private Git access. A commit-built ZIP is the fallback.

## What to send

Send these four things together:

1. **Workflow-Kit source** from a private Git repository or a ZIP made from one exact commit.
2. **The exact 40-character commit SHA** being transferred and the expected `VERSION` value.
3. [`CODEX_ADOPTION_TICKET.md`](CODEX_ADOPTION_TICKET.md) — the complete prompt to give a local Codex
   task. It starts by discovering the Mac's setup; an existing repository is not required to begin.
4. [`FACTSHEET.docx`](FACTSHEET.docx) — the human-readable Word guide to the method and its responsibilities.

`FACTSHEET.md` is the AI-readable text companion; send the Word version for your uncle to read.
The Word document preserves the Owner's formatting. Update it in place rather than rebuilding it
from Markdown and losing those corrections.

Also send this small intake block after filling only facts you already know:

```text
First target repository: <name and clone URL, or "help me create/select it">
Owner name: <recipient's preferred name>
Mac to set up first: <recipient's choice, or unknown>
Deploy branch: <known branch, or unknown>
What a push to that branch does: <no deployment / deploys to ... / unknown>
Live or irreversible assets: <money, production data, messages, credentials, none, or unknown>
Preferred permanent worktree roots: <paths, or "have Codex propose them">
Provider accounts already available: Codex <yes/no/unknown>, Claude <yes/no/unknown>, Gemini <yes/no/unknown>
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
send the private clone URL. The adoption ticket has Codex guide source retrieval after checking Git
and account access, then run these checks for the recipient:

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
Send the SHA-256 checksum in a separate message. Codex guides verification before extraction into a
new folder, then runs the version and test checks after verifying Node.js/npm:

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

He does not need to inventory his software or install Git, Node.js, or review tools before giving
Codex the ticket. The only bootstrap requirement is a working local Codex session on the first Mac.

1. Choose one Mac to start with. If Codex already runs locally, use it. Otherwise, help him follow
   the [official desktop setup guide](https://learn.chatgpt.com/docs/app) to install a compatible
   application, sign into his own account, and open Codex. Check that Mac's compatibility first. If
   the desktop route is unsupported, use the [official Codex CLI guide](https://learn.chatgpt.com/docs/codex/cli)
   for a supported alternative, with his approval. A local session must exist before it can inspect
   or configure his Mac; don't leave him with instructions to ask a not-yet-installed Codex for help.
2. Give that local Codex task the complete adoption ticket, source URL or ZIP location, and sender's
   identity/checksum details. Paste the ticket text if attaching Markdown is awkward; unknown intake
   answers can stay unknown. Start in a separate setup folder if no target project is chosen yet,
   not in the Workflow-Kit source. Codex will help select or create the target project folder.
3. Let Codex discover what is installed and working, explain the missing pieces, and guide each
   needed installation or repair. It should preserve working software and run the checks itself.
4. Complete one human action at a time when Codex requests it: approve a named installation, sign in
   directly, grant hook trust, or perform Gemini's guided browser handoff. Never paste passwords,
   tokens, or API keys into chat. Purchases, paid API use, and consequential actions require separate
   permission.
5. Have Codex demonstrate that the hooks and reviewer routes work and give a plain-language result:
   what is ready, what is still blocked, and exactly what to do next. Installed files alone are not
   completion. Repeat the discovery and machine-specific checks separately for each additional Mac.

The ticket is written for a technically literate non-coder: Codex explains unfamiliar terms, supplies
exact commands only when needed, waits for each dependent human step, and verifies the result. Keep
the factsheet for the human explanation of the method.

## Sender's final handoff message

```text
This is Workflow-Kit version <VERSION> at exact commit <40-character-sha>.
Private source: <clone URL or private ZIP name>
ZIP SHA-256, if used: <checksum>

Start with one Mac. If you do not have Codex running locally yet, I can help you get that first
session open. Then paste the complete CODEX_ADOPTION_TICKET.md into a local Codex task, along with
the source details above. You do not need to install Git, Node.js, or the review tools first, and
it is fine not to know what is already set up. If you do not have a project folder yet, tell Codex;
it will help you choose or create one before installing the kit.

Codex will check your Mac, explain what is missing, and walk you through setup one step at a time.
It will ask when you need to approve an installation, sign into your own account, enable hooks, or
complete a Gemini browser handoff, then check the result before continuing. Do not paste or send
passwords, tokens, or API keys to me or to Codex. Setup does not authorize purchases, publishing,
deployment, or live-data changes. Each additional Mac gets its own setup check.
```
