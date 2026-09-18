---
name: thportal-review
description: "Reviews TH Portal backend changes against the shared rules in .claude/guardrails/rules/backend-rules.md. Works on a GitHub pull request (`/thportal-review 2447`) or on the local working copy (`/thportal-review --local`). Use whenever the user asks to review a PR, review their changes, or check a diff for architecture violations in the file-management-server repo. This skill holds the procedure only — every rule lives in the rules file, so the review, the CLAUDE.md files and the commit gate can never disagree."
---

# TH Portal review

Review backend changes for `file-management-server` (.NET 8 backend, Angular frontend) against
`C:/file-management-server/.claude/guardrails/rules/backend-rules.md`.

**This skill carries no rules of its own.** If a rule needs to change, change the rules file — that is
what `/learn` does. Duplicating a rule here is the exact thing the rules forbid.

**Backend only.** Frontend files are read for one purpose: finding stale callers of a changed DTO or
endpoint. Never review frontend code quality.

## Step 1: Pick the mode

### PR mode — `/thportal-review 2447` or a full PR URL

```bash
gh pr view <n> --json title,body,baseRefName,headRefName,url,author
gh pr diff <n>
```

The base branch is `staging`. (`development` was retired; if a PR targets it, say so.) If the diff is
very large, fall back to `gh pr diff <n> --name-only` and review the `.cs` files in batches,
prioritising controllers, services, repositories and migrations over configuration.

### Local mode — `/thportal-review --local`

```bash
git diff --cached -- backend/                                  # staged changes
git fetch origin staging && git diff origin/staging...HEAD -- backend/   # whole branch
```

Use the staged diff when called from `/validate`, the branch diff when called from `/ship` or when the
user asks about "my changes" without a PR.

## Step 2: Read the rules

Read the rules file in full before looking at the diff. Note which rules are `violation` and which are
`suggestion` — that classification decides the report, and the commit gate reads it.

## Step 3: Dispatch the reviewer

Send the diff to the `architecture-reviewer` subagent, which runs read-only in its own context:

> Review the diff at `<path>` and report against the backend rules. Output JSON only.

Write the diff to a temporary file first when it is large. For a diff spanning many files, dispatch
one reviewer per coherent group (controllers + their services, repositories + entities, migrations)
and merge the JSON.

The reviewer returns:

```json
{"violations":[{"id":null,"file":"…","line":42,"rule":"…","why":"…","fix":"…"}],"suggestions":[]}
```

## Step 4: Verify before you report

The reviewer can be wrong, and a false positive costs more trust than a missed nitpick. For each
violation, confirm it against the repository — not just the diff:

- **Soft delete:** open the entity under `Entities/Models/` and confirm the flag exists. Remember
  there are no EF global query filters in this solution, so nothing filters for you.
- **Frontend sync:** actually search `frontend/` for the old property name (both casings) or the old
  route fragment, including `*.component.html` and `*.spec.ts`.
- **Duplication:** point at the existing helper by path, or drop the finding.
- **Naming:** count both forms with `grep -rl … | wc -l` before calling it a violation.
- **Wiring:** check all five files (`IServiceManager`, `ServiceManager`, `IRepositoryManager`,
  `RepositoryManager`, `MainProfile`) before reporting one as missing.

Drop anything you cannot substantiate. Say what you checked.

## Step 5: Write the report

In PR mode, save it as `pr-review-<n>.md` in the scratchpad and summarise in chat. In local mode,
print it.

```markdown
# Review: <PR #n and title, or "local working copy">

**Base**: staging · **Head**: <branch> · **Files**: <count> · **Date**: <date>

## Summary
<2-3 sentences: what the change does, and whether it is ready>

## Violations
### <Rule name> — `path/to/file.cs:42`
<what is wrong, with the line quoted, and why it matters>
**Fix:** <the exact change>

## Suggestions
- `path/to/file.cs:88` — <one line>

## Checked and clean
<the rules you verified that came back clean: soft-delete filters on N queries, activity logging on
the mutations, the five wiring files, frontend callers of the changed DTO. This is what tells the
author their work was actually read.>

## Files reviewed
- `path` — one line each

VERDICT: pass
```

The last line is parsed by other tools, so keep its shape exactly: `VERDICT: pass` or
`VERDICT: <n> violations`.

## Notes

- Be specific. Read the code and decide; do not hedge with "this might be a problem".
- Explain why a rule exists when you flag it — the author should learn the rule, not just the fix.
- If the diff is clean, say so plainly. Not every review needs to find something.
- If a violation keeps appearing across PRs, the rules file is missing something — run `/learn`.
