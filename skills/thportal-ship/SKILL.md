---
name: thportal-ship
description: "Opens the pull request for finished backend work: checks the branch is validated and its QA cases passed, reviews the whole branch diff, pushes, opens the PR against staging, re-runs the QA cases on the preview environment, then shows the developer the exact Asana comment and waits. Nothing is posted to the ticket until they say so. Use when backend work is finished and ready for QA, or when the user asks to ship, open the PR, or hand something to QA."
---

# Ship

Take finished work to the PR and the ticket. Everything is prepared first and shown to the developer;
posting is a separate, explicit step.

## Step 1: Prepare everything

```bash
node .claude/guardrails/scripts/ship.mjs
```

This refuses unless the work is actually finished, and the refusal names what to do:

| Refusal | What it means |
|---|---|
| uncommitted changes | The gate validates what you commit; commit first |
| not linked to a ticket | Run `/ticket`, or set `branch.<name>.asanaTask` |
| the committed content is not validated | Run `/validate`, then commit again |
| API cases have not passed | `/validate` runs them; they must pass before QA sees this |

When it is satisfied it reviews the **whole branch** against `origin/staging` — not the last commit,
because a DTO changed in commit one with a frontend caller never updated is invisible commit by
commit — pushes, opens the PR, waits up to ten minutes for `https://pr-<n>-api.dev.thportal.ca`, and
re-runs the QA cases there. That preview run is the one that matters: it is the environment QA opens.

If the preview never comes up (the box is RAM-bound and sometimes does not), it continues with the
local results and says so, in the report and in the comment.

## Step 2: Read the QA cases with the developer

This is the point of the whole skill. Show them, as plain text:

- each API case, its title and what it proved;
- each UI case and its steps, which is what Aqil will actually follow;
- the branch, the preview URL and the PR link;
- anything that was waived during the review.

Then ask plainly: **do these cases describe what you built?** A case that is wrong or half-understood
costs QA a whole cycle and makes the developer look careless — and the person who wrote the code is
the only one who can tell.

Take their edits into `.claude/work/<gid>/qa-cases.json`, then run `ship.mjs` again so the comment is
rebuilt from the edited cases. Repeat until they are right.

## Step 3: Post, once they say to

```bash
node .claude/guardrails/scripts/ship.mjs --post
```

In order: the comment, then **Branch name** and **Preview Url** and **Backend Status → Done** as
custom fields, then the move to the **QA** section. If any Asana call fails it prints the comment for
pasting by hand and leaves the task where it is.

## What this never does

- **It never posts without that yes.** Not the comment, not the fields, not the move.
- **It never moves the ticket when a case failed.** A failed case means it is not ready to test.
- **It never merges.** Leads own the merge and the deploy, from "QA completed" onward.
- **It never mentions Claude** in the PR body — `buildPrBody` throws rather than let one through.

## After the PR

When a lead leaves review comments, bring them back through `/learn`: a comment that only gets fixed
in this PR will be written again in the next one.
