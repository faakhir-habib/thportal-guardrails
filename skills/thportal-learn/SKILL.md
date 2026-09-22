---
name: thportal-learn
description: "Turns a lesson into a rule: takes a lead's PR review comment, a QA failure, a waived review finding or a correction the developer just made, verifies it against the codebase, writes or updates a rule in .claude/guardrails/rules/backend-rules.md with its severity and a real example, adds the eval case that proves it, and commits it in the guardrails repo. Use whenever something was explained that will otherwise be explained again — a review comment, a QA bug, a 'no, do it this way'."
---

# Learn

A problem found once must not come back. Every skill reads the rules from one file, so writing the
lesson there changes how all of them behave — while explaining it in a review comment changes nothing
after that PR.

## Where the lesson comes from

| Source | How to pick it up |
|---|---|
| A lead's PR review comment the reviewer missed | `node -e "import('./.claude/guardrails/scripts/lib/github.mjs').then(m => console.log(JSON.stringify(m.prReviewComments(<n>), null, 2)))"` |
| A QA failure or a bug ticket | Ask what rule would have caught it before QA ever saw it |
| A waived review finding | The waiver means the rule was wrong or unclear — that is a lesson about the rule |
| A correction the developer made in session | The most common source, and the easiest to lose |

## Step 1: Say the lesson in one sentence

If it needs two sentences joined by "and", it is two lessons. Write them separately.

## Step 2: Find where it belongs

Search `rules/backend-rules.md` for a rule that already covers this. **Updating an existing rule is
the normal outcome**; adding one is the exception. Two rules that nearly say the same thing are the
duplication the rules themselves forbid, and the reviewer will report both.

## Step 3: Verify it against the codebase

Find at least two real places that already follow it, and name their paths. A rule the codebase does
not follow is not a rule — it is a proposal, and it goes to the team rather than into this file.

Count before you claim a convention:

```bash
grep -rl "<the shape you are claiming>" --include=*.cs backend | wc -l
grep -rl "<the shape you are claiming is wrong>" --include=*.cs backend | wc -l
```

A clear majority makes it a `violation`; a near-even split makes it a `suggestion`.

## Step 4: Write the rule

Every rule carries the rule, a severity, why it matters, and a real path:

```markdown
- Always use `AsNoTracking()` on read-only queries — `violation`. **Why:** change tracking on a read
  wastes memory and hides accidental writes. See `backend/Repository/LotRepository.cs`.
```

Check it before moving on:

```bash
node -e "import('./.claude/guardrails/scripts/lib/rules-changelog.mjs').then(m => console.log(m.checkRule(process.argv[1])))" "<the rule text>"
```

## Step 5: Add the eval case

A rule with no fixture is a rule nobody notices regressing.

1. Plant the violation in `eval/bad-diff.patch`, in the shape a real diff would have it.
2. Add its row to the table in `eval/expected.md` with the next `V<n>` id, and raise the count in the
   pass criteria.
3. Re-run the reviewer on the fixture and confirm the new case is caught:

> Review the diff at `C:/file-management-server/.claude/guardrails/eval/bad-diff.patch` and report
> against the backend rules. Output JSON only.

If it is not caught, the rule is too vague — sharpen it and run again. Do not tell the reviewer about
the case directly; it only ever knows what the rules file says.

## Step 6: Record it

```bash
node -e "
import('./.claude/guardrails/scripts/lib/rules-changelog.mjs').then(async m => {
  const fs = await import('node:fs');
  const p = '.claude/guardrails/rules/backend-rules.md';
  fs.writeFileSync(p, m.appendChangelogRow(fs.readFileSync(p, 'utf8'), {
    date: '<today>', rule: '<short name>', why: '<what happened>', source: '<PR or ticket>', evalCase: 'V<n>',
  }));
})"
```

## Step 7: Commit in the guardrails repo

```bash
cd .claude/guardrails
git add rules/backend-rules.md eval/
git commit -m "chore(rules): <short name>

<what taught it, in one line>"
```

Never in the product repo. Push when the developer is ready; everyone else picks it up with
`git -C .claude/guardrails pull`.

## What not to do

- Do not write a rule from a single incident that the codebase does not support. One PR is an
  anecdote.
- Do not write a rule that restates something the compiler or the tests already enforce.
- Do not smuggle a preference in as a `violation`. If reasonable people would disagree, it is a
  `suggestion`.
