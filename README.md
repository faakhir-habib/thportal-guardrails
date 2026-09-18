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
bash .claude/guardrails/scripts/sync-local.sh
```

`sync-local.sh` copies the agent, the skill and the two `CLAUDE.md` files into the paths Claude Code
reads, and adds the `.git/info/exclude` entries that keep them out of the product repo.

It copies into **both** `.claude/` and `backend/.claude/`, because Claude Code loads agents and skills
from the `.claude/` of whichever directory the session starts in — and developers start sessions in
both the repo root and `backend/`. `CLAUDE.md` behaves differently: it is read from the session
directory upwards, so the root file is always picked up.

**Restart Claude Code after syncing.** A new agent or skill is only registered at startup; until then
`/thportal-review` comes back as an unknown command.

Updating is `git -C .claude/guardrails pull` followed by the same sync command.

## What it gives you

**Working today:**

| What | Effect |
|---|---|
| `rules/backend-rules.md` | The single source of backend rules — layers, versioning, soft delete, audit logging, EF and migrations, DTOs, frontend sync, naming, DRY/SRP/LSP, security, quality, tests. Every rule carries a severity and a golden example |
| `CLAUDE.md` | Imports those rules, so they are in context while code is being written |
| `architecture-reviewer` | A read-only subagent that reviews a diff and returns JSON |
| `/thportal-review <PR>` or `--local` | Reviews a pull request, or the staged/branch diff, against the rules |

**Still to come** — `/ticket`, `/validate`, `/ship`, `/learn`, the git hook that blocks a commit
without a validation stamp, and the installer that replaces `sync-local.sh`. Until then: review with
`/thportal-review --local` before committing, and do the Asana and QA steps by hand.

## Requirements

- Docker (the integration suite uses Testcontainers)
- `gh`, Node and .NET 8
- An Asana token and a GitHub PAT, from Bitwarden or the environment

## Layout

```
rules/          the single source of backend rules
skills/         /thportal-review (more to come)
agents/         the read-only architecture reviewer
scripts/        sync-local.sh, until the installer replaces it
claude/         the CLAUDE.md files copied into the product clone
eval/           the fixtures the reviewer is measured against
docs/           design.md and the implementation plans
```

Status: rules, reviewer and review skill are in place and proven against the eval fixtures. Version 0.2.0 — see CHANGELOG.md.
