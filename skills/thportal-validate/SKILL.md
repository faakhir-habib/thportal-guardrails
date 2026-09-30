---
name: thportal-validate
description: "Validates staged backend changes before a commit: dotnet format on the staged files, the solution build, the integration suite, and an architecture review of the staged diff against .claude/guardrails/rules/backend-rules.md. Writes a stamp keyed to the staged content, which the pre-commit hook requires. Use before committing backend work, whenever a commit was blocked for having no stamp, or when the user asks to validate, check or verify their changes."
---

# Validate

Run this before committing backend changes. It takes minutes, not seconds — the integration suite
boots a real SQL Server container.

## Step 1: See what is staged

```bash
git diff --cached --name-only
```

Nothing staged, or nothing under `backend/` — say so and stop. The gate does not apply to a commit
with no backend files.

## Step 2: Run the checks

```bash
node .claude/guardrails/scripts/validate.mjs
```

It refuses to run when a staged file has unstaged edits, because then what is tested is not what
would be committed. Otherwise it formats the staged `.cs` files, re-stages anything it rewrote, builds
the solution and runs the integration suite, then prints `{ tree, result, checks }`.

If a check fails, show the failing output and stop. Do not review, do not stamp — a failing build is
not a review problem. If `format` reports `reformatted`, tell the developer which files it rewrote;
their diff just grew.

## Step 3: Review the staged diff

```bash
git diff --cached -- backend/ > "$SCRATCH/staged.diff"
```

Dispatch the `architecture-reviewer` agent:

> Review the diff at `<path>` and report against the backend rules. Output JSON only.

Save its JSON to `$SCRATCH/review.json`.

## Step 4: Verify each violation before it blocks anything

Follow Step 4 of `/thportal-review`: check every violation against the repository, not just the diff —
open the entity for a soft-delete claim, search `frontend/` for a sync claim, name the existing helper
for a duplication claim. Drop what you cannot substantiate; a false positive costs more trust than a
missed nitpick.

If the developer disputes a finding and is right, the rules file is what needs fixing — say so. If
they want to proceed anyway, add `"waived": true` and a short `"waivedReason"` to that finding in
`review.json`. Waivers are recorded in the stamp and belong in the PR description.

## Step 5: The QA cases run themselves

When the branch is linked to a ticket and `.claude/work/<gid>/qa-cases.json` exists, the stamp step
runs the in-scope `api` cases over real HTTP before it writes anything:

- it starts a **throwaway SQL Server container**, because the API applies migrations to whatever
  database it is given and nobody's data should be migrated by a QA run;
- it boots the API against that container, turns off two-factor for the seeded user in it, logs in,
  and calls each case's real route;
- every case records its evidence (`GET /api/v2/... -> 200`) and the database it ran against;
- a failed case fails the stamp, so the commit stays blocked.

No ticket link, or no cases file, and the stamp says so — `qa: { skipped: … }` — rather than implying
the cases passed. `ui` cases are never executed; they belong to QA.

To run them on their own, without stamping:

```bash
node .claude/guardrails/scripts/qa-verify.mjs --work .claude/work/<gid>
```

`--base-url <url>` runs them against an API you already have running, and `--db "<connection string>"`
against a database you name. The guard refuses shared databases either way.

## Step 6: Stamp

```bash
node .claude/guardrails/scripts/validate.mjs --stamp "$SCRATCH/review.json"
```

The checks are not run twice: Step 2 cached its result against this exact staged content, and the
stamp reuses it. If the staged content changed in between — a file edited during the review — the
checks run again, which is the point.

## Step 7: Report

Give the developer:

- each check with its time, and any files that formatting rewrote;
- violations, grouped by rule, each with the fix;
- suggestions, briefly;
- the verdict: "stamped — you can commit", or exactly what is still blocking.

If the commit is still refused after a passing stamp, the staged content changed after the stamp was
written. Re-stage and validate again.

## After merging staging into the branch

A merge commit passes the commit gate, but `/ship` needs a stamp for what HEAD now holds — code nobody
has built together yet. With a clean working tree, add `--committed` to both calls: the checks and the
review cover the branch's own files against `origin/staging`, and the stamp is keyed to HEAD.

```bash
node .claude/guardrails/scripts/validate.mjs --committed
git diff origin/staging...HEAD -- backend/ > "$SCRATCH/branch.diff"   # review this one
node .claude/guardrails/scripts/validate.mjs --committed --stamp "$SCRATCH/review.json"
```
