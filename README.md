# TH Portal guardrails

Local Claude Code guardrails for **backend** work on `Zayan-Technologies/file-management-server`.

The goal: every developer's Claude writes code that follows the project's architecture, nothing
breaks an existing test, every ticket's QA cases are verified, and all of it is checked before a
commit lands.

## What this is not

Nothing here is ever committed to the product repo. No tracked file changes, no CI, no branch
protection, and the team's PR process is untouched. Frontend work behaves exactly as it does today —
a commit with no `backend/` file passes straight through.

## How it is installed

This repo is cloned **inside** the product clone, at `.claude/guardrails`. That path is already
gitignored there, so the product repo stays clean:

```bash
cd /path/to/file-management-server
git clone https://github.com/faakhir-habib/thportal-guardrails.git .claude/guardrails
node .claude/guardrails/scripts/install.mjs
```

The installer copies the agent, the skills and the two `CLAUDE.md` files into the paths Claude Code
reads, sets `core.hooksPath` to the bundle's hooks, adds the `.git/info/exclude` entries that keep
those copies out of the product repo, and merges its hooks into `.claude/settings.json` without
touching anything else in that file.

It copies into **both** `.claude/` and `backend/.claude/`, because Claude Code loads agents and skills
from the `.claude/` of whichever directory the session starts in — and developers start sessions in
both the repo root and `backend/`. `CLAUDE.md` behaves differently: it is read from the session
directory upwards, so the root file is always picked up.

It is safe to re-run: it records what it wrote, reports anything you have edited instead of
overwriting it, and changes nothing when everything is current.

**Restart Claude Code after installing.** A new agent or skill is only registered at startup; until
then `/validate` comes back as an unknown command.

Updating is `git -C .claude/guardrails pull` followed by `node .claude/guardrails/scripts/install.mjs`.

To remove it: `node .claude/guardrails/scripts/uninstall.mjs`. It restores the previous hooks path,
deletes only the files it installed and you have not edited, cleans its exclude entries and its hooks
block, and leaves your stamps and the bundle clone alone.

## What it gives you

**Working today:**

| What | Effect |
|---|---|
| `rules/backend-rules.md` | The single source of backend rules — layers, versioning, soft delete, audit logging, EF and migrations, DTOs, frontend sync, naming, DRY/SRP/LSP, security, quality, tests. Every rule carries a severity and a golden example |
| `CLAUDE.md` | Imports those rules, so they are in context while code is being written |
| `architecture-reviewer` | A read-only subagent that reviews a diff and returns JSON |
| `/thportal-review <PR>` or `--local` | Reviews a pull request, or the staged/branch diff, against the rules |
| `/validate` | Formats the staged `.cs` files, builds, runs the integration suite, reviews the staged diff, and stamps the result |
| The commit gate | A `backend/` commit without a passing stamp for its exact staged content is refused. Frontend-only and merge commits pass through untouched |
| Commit message rules | Conventional header, a body saying why, the `Asana:` trailer from the branch's ticket link, and no Claude attribution |
| `/ticket <asana>` | Reads the task, links the branch, and writes the QA cases and the plan for you to approve |
| QA cases | Run over real HTTP against a throwaway SQL container during `/validate`; a failed case blocks the commit |
| `/ship` | Reviews the whole branch, pushes, opens the PR, re-runs the QA cases on the preview, then shows you the ticket comment and waits |
| `/learn` | Turns a review comment, a QA failure or a correction into a rule with an eval case |

**How long validation takes** — measured on this repo: format 19s (staged files only), build 99s,
integration suite 221s. About **five and a half minutes** in total. Stamping straight afterwards
reuses that result, so it costs nothing twice.

**Every branch needs a ticket.** A backend commit on a branch with no `branch.<name>.asanaTask` link is
refused; `/ticket` sets it, or set it by hand once with `git config branch.$(git branch --show-current).asanaTask <gid>`.

## Requirements

- Docker (the integration suite uses Testcontainers)
- `gh`, Node and .NET 8
- An Asana token and a GitHub PAT, from Bitwarden or the environment

## Layout

```
rules/          the single source of backend rules
skills/         /thportal-review, /validate, /ticket, /ship and /learn
agents/         the read-only architecture reviewer
githooks/       pre-commit, prepare-commit-msg, commit-msg
scripts/        the gate, the checks, the stamp, the QA runner, the Claude Code hooks, install and uninstall
claude/         the CLAUDE.md files and the settings merged into the clone
eval/           the fixtures the reviewer is measured against
tests/          node --test units, plus hooks.test.sh which drives real commits
docs/           design.md and the implementation plans
```

Run the tests with `node --test "tests/*.test.mjs"` (72 of them) and `sh tests/hooks.test.sh`, which
drives real commits through the real hooks in a throwaway repo (10 cases). Quote the glob — a bare
`tests/` is read as a module path, not a directory.

Status: the whole loop works — /ticket, /validate, the commit gate, /ship and /learn. Version 0.5.0 — see CHANGELOG.md.
