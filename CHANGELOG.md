# Changelog

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
