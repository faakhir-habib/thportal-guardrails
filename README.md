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
git clone git@github.com:faakhir-habib/thportal-guardrails.git .claude/guardrails
node .claude/guardrails/install.mjs
```

Updating is `git -C .claude/guardrails pull` followed by the same install command.

## What it gives you

| Command | What it does |
|---|---|
| `/ticket <asana-url>` | Reads the ticket, sets up the branch, writes the QA cases and the plan, waits for approval |
| `/validate` | Format, build, the integration suite, an architecture review of the staged diff, and the QA cases over real HTTP — then stamps the exact staged tree |
| `/ship` | Reviews the whole branch, pushes, opens the PR, verifies on the preview env, comments on the ticket and tags QA |
| `/learn` | Turns a lesson (a review comment, a QA failure, a correction) into a rule so it cannot happen again |

A git hook blocks any commit that touches `backend/` without a valid validation stamp.

## Requirements

- Docker (the integration suite uses Testcontainers)
- `gh`, Node and .NET 8
- An Asana token and a GitHub PAT, from Bitwarden or the environment

## Layout

```
rules/          the single source of backend rules
skills/         /ticket, /validate, /ship, /learn, pr-review
agents/         the read-only architecture reviewer
githooks/       the commit gate
scripts/        checks, stamps, secrets, Asana and GitHub calls
claude/         the CLAUDE.md files copied into the product clone
docs/design.md  the full design
```

Status: design complete, implementation in progress.
