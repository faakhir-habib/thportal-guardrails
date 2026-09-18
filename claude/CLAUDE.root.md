# file-management-server

.NET 8 backend (`backend/`) and Angular frontend (`frontend/`) for TH Portal. Work is tracked on the
Asana ERP board; branches come off `staging`.

## Setup (once per clone)

- Bitwarden access to the `Work` project, or `ZAYAN_ASANA_TOKEN` and `ZAYAN_GITHUB_PAT` as environment
  variables.
- Docker Desktop — the integration suite runs SQL Server in Testcontainers.
- `gh` installed and authenticated.
- After pulling the guardrails bundle: `bash .claude/guardrails/scripts/sync-local.sh`, then restart Claude
  Code so the agent and skill register.
- Start Claude Code from the repo root or from `backend/` — either works. The sync script installs the
  agent and skill in both, and the root `CLAUDE.md`, with the rules it imports, is read from either.

## Scope of these rules

**Backend only.** Frontend work follows the repo's own `frontend/coding-practices.md` and is not
governed by anything here. Frontend files are read for one purpose: finding stale callers of a changed
DTO or endpoint.

## Backend rules

Every backend change follows these rules, and each one names a golden example to copy:

@.claude/guardrails/rules/backend-rules.md

Three principles sit above the specific rules:

- **DRY** — search for an existing helper, query or mapper before writing a new one. Duplicated logic
  is a defect, not a style preference.
- **SRP** — one reason to change per class and method. A method past ~40-50 lines gets split.
- **LSP** — an implementation honours its interface: no `NotImplementedException`, no extra
  preconditions, no surprises for a caller holding the interface.

## Workflow

`/ticket` → plan approved → code → `/validate` → commit → `/ship`

Only `/thportal-review` exists today. `/ticket`, `/validate`, `/ship` and `/learn` are still being
built, so until they land: review with `/thportal-review --local` before committing, and do the Asana
and QA steps by hand.

Never commit or push unless the developer asks. Leave finished work in the working tree and report
what changed per file.

## Traceability

The point is that six months from now `git blame` explains itself.

- Link the branch to its ticket once: `git config branch.$(git branch --show-current).asanaTask <gid>`.
- Commit messages: a Conventional Commits header, a 1-3 line body saying **why** (not what — the diff
  says what), and an `Asana: <ticket url>` trailer.
- Decisions that the code cannot explain go in the commit body and the PR description, not in code
  comments.

```
fix(lots): hide deleted lots from the assignment dropdown

The query had no IsDeleted filter, so deleted lots came back and QA could assign work to them.

Asana: https://app.asana.com/1/1209040875779194/project/1209042358568959/task/<gid>
```

## Never mention Claude

No `Co-Authored-By`, no "Generated with Claude Code", no robot line — not in a commit message, not in
a PR description. Ever.

## Comments

Write no comment that restates the code. A comment earns its place only when it captures something the
code cannot, such as an external API's quirk, and then it is one line.

## When something is learned

When the developer corrects you, or a review comment or QA failure exposes a gap, fix it in
`.claude/guardrails/rules/backend-rules.md` immediately — with the rule, its severity, why, and a real
example — so it never has to be explained twice. `/learn` will automate this; until then, edit the file
by hand and commit it in the guardrails repo, never in this one.
