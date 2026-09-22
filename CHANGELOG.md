# Changelog

## 0.5.0 — 2026-09-22

- **`/ship`** — refuses unless the work is committed, validated and its API cases passed; reviews the
  whole branch against `origin/staging` rather than the last commit; pushes; opens the PR with a short
  built body; waits up to ten minutes for the preview API and re-runs the QA cases there; then prints
  the exact Asana comment and **stops**. `--post` is a separate step that posts the comment, sets
  **Branch name**, **Preview Url** and **Backend Status → Done**, and moves the task to **QA**.
- **`/learn`** — turns a review comment, a QA failure, a waiver or a correction into a rule: one
  sentence, an existing rule updated in preference to a new one, verified against the codebase with a
  counted majority, a severity and a real path, an eval case that proves it, a changelog row, and a
  `chore(rules)` commit in this repo.
- **`gate.requireTicket` is now on.** A backend commit on a branch with no ticket link is refused, and
  the refusal names the command that fixes it. `/ticket` links the branch automatically.
- The PR body builder throws rather than let a mention of Claude through, and the ticket comment is
  built from the small tag set Asana actually accepts.

## 0.4.0 — 2026-09-18

- **`/ticket`** — reads an Asana task and its comments, creates and links the branch, explores the
  code that already exists, then writes `ticket.md`, `plan.md` and `qa-cases.json` into
  `.claude/work/<gid>/` and stops for approval. Proven on a real ticket, where it found that three of
  the five acceptance criteria did not survive contact with the code.
- **QA cases that run.** `qa-cases.json` is a schema a machine executes: `api` cases carry a route, a
  method and a concrete expectation; `ui` cases carry steps for QA and are never executed.
- **The QA runner** boots the API against a **throwaway SQL Server container**, migrates it from
  empty, logs in and calls each case's real route, recording the evidence and the database used.
- **`/validate` runs the in-scope cases** before it stamps, and a failed case fails the stamp — so the
  commit stays blocked. No ticket link means `qa: { skipped: … }` rather than a silent pass.
- **Secrets** resolve from the environment first, then Bitwarden by key name; nothing is written to
  disk or into a stamp.
- **A database guard**: `docker/connection-string.mjs` silently falls back to the shared
  `erp-development` box when a branch database does not exist, and the API applies migrations on
  startup. `erp-development`, `erp-staging*`, `thportal_staging`, `erp`, `crm` and `thportal_pr_*` are
  refused outright.
- A crashed API now fails in seconds with its own output, instead of waiting out the boot timeout.

Three bugs found by running it rather than reading it: the shared-database fallback above; `sqlcmd`
exiting 0 on a failed statement, which made a broken `UPDATE` look successful (fixed with `-b`); and
that same statement needing `QUOTED_IDENTIFIER ON` for this schema's filtered indexes (fixed with
`-I`).

## 0.3.0 — 2026-09-18

- **The commit gate.** A `backend/` commit is refused unless a passing stamp exists for its exact
  staged content, keyed to `git write-tree`. Merge commits and frontend-only commits pass through.
- **`/validate`** — formats the staged `.cs` files and re-stages what it rewrote, builds the solution,
  runs the integration suite, reviews the staged diff with the `architecture-reviewer`, and writes the
  stamp. Measured here: 19s + 99s + 221s, about five and a half minutes. The checks are cached against
  the tree, so stamping afterwards does not run them twice.
- **Commit message rules** — Conventional Commits header, a body saying why, the `Asana:` trailer
  added from the branch's ticket link, and no Claude attribution. They apply to backend commits;
  frontend commits keep going to the repo's own commitlint.
- **Claude Code hooks** — `--no-verify`, `HUSKY=0`, changing `core.hooksPath`, `--force` pushes,
  pushes to `staging`/`main` and hand-written stamps are all refused. Session start puts the hooks
  path back, prunes stamps older than 30 days, and reports the branch and its ticket.
- **`install.mjs` / `uninstall.mjs`** replace `sync-local.sh`. The install records what it wrote, so
  it never overwrites a file you edited and it can take itself back out.
- Formatting runs on the staged files only, and fixes rather than verifies — the solution as a whole
  does not pass `dotnet format` today, and blocking a developer for someone else's blank lines would
  teach them to skip the gate.

Proven end to end on the real repository: an unfiltered soft-delete query was staged, the commit was
refused for having no stamp, `/validate` passed its checks but the reviewer found the missing
`IsDeleted` filter, the stamp came out `fail`, and the commit stayed refused.

## 0.2.0 — 2026-09-18

- `rules/backend-rules.md`: the single source of backend rules, every rule verified against the
  codebase, each with a severity and a golden example to copy.
- `agents/architecture-reviewer.md`: a read-only reviewer that returns JSON. Proven against a planted
  diff — all 22 planted violations caught on the first run, plus 5 real ones the fixture table had
  missed — and against a clean diff, which came back with no violations and both judgement traps
  handled correctly.
- `skills/thportal-review/SKILL.md`: `/thportal-review <PR>` and `/thportal-review --local`. Carries
  the procedure only; the rules live in the rules file. Base branch corrected to `staging`, `gh`
  replaces `web_fetch`.
- `claude/CLAUDE.root.md` and `claude/CLAUDE.backend.md`: the root file imports the rules, so they are
  in context while code is being written rather than only during review.
- `scripts/sync-local.sh`: copies the agent, the skill and the two `CLAUDE.md` files into the paths
  Claude Code actually reads.
- `eval/`: the fixtures, the expected findings and the recorded baseline.

Known gaps, deliberately: `/ticket`, `/validate`, `/ship` and `/learn` do not exist yet, and neither
do the git hooks or the installer. Until they land, review with `/thportal-review --local` before
committing and do the Asana and QA steps by hand.

## 0.1.0 — 2026-09-18

- Repo scaffold: the design document and the README.
