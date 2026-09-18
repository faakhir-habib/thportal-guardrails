# Changelog

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
