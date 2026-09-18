---
name: thportal-ticket
description: "Starts backend work from an Asana ticket: reads the task and its comments, creates and links the branch, explores the code that already exists, then writes the QA cases and the implementation plan into .claude/work/<task-gid>/ and waits for the developer to approve them. Use when the user gives an Asana ticket link or gid, says they are starting a ticket, or asks what the plan for a ticket should be."
---

# Ticket

Turn an Asana ticket into a branch, QA cases and a plan — before any code is written. The cases are
written now so they describe what the ticket asked for, not whatever the code ended up doing.

## Step 1: Read the ticket

```bash
node -e "import('./.claude/guardrails/scripts/lib/asana.mjs').then(async m => {
  const gid = m.taskGidFromUrl(process.argv[1]);
  const t = await m.getTask(gid);
  console.log(JSON.stringify(t, null, 2));
})" "<url-or-gid>"
```

Write `.claude/work/<gid>/ticket.md` with the title, the description, the custom fields, and every
comment with its author and date. **Read the comments properly** — QA's repro steps and the "actually
what we agreed" corrections live there more often than in the description.

## Step 2: Set up the branch

If the current branch is `staging`, `main`, or somebody else's work, create one from `origin/staging`:

```bash
git fetch -q origin staging
git switch -c <type>/<short-name> origin/staging
git branch --unset-upstream
git config branch.$(git branch --show-current).asanaTask <gid>
```

The ticket may already carry a **Branch name** custom field — use that name if it is set. The link is
what puts the `Asana:` trailer on every commit and what `/ship` reads later.

## Step 3: Ask what the ticket does not say

One question at a time, and only about things the ticket genuinely leaves open — a missing acceptance
criterion, an ambiguous scope boundary, an unstated role restriction. Never invent an acceptance
criterion, and never guess at a number or a rule. If the ticket is clear, ask nothing.

## Step 4: Explore before planning

Dispatch the `Explore` agent for three things:

1. the code that already does part of this — the endpoint, the service, the query;
2. the golden examples named in `rules/backend-rules.md` for the layers this will touch;
3. the rules this change will run into: soft delete, audit logging, wiring, security, tests.

Reuse is the first question, not the last: a ticket that turns into a new service when an existing one
already owns the domain is how `DealService.cs` reached 3,093 lines.

## Step 5: Write the QA cases

`.claude/work/<gid>/qa-cases.json`:

```json
{
  "task": "<gid>",
  "cases": [
    {
      "id": "QA-1",
      "type": "api",
      "title": "The usage count excludes soft-deleted products",
      "scope": "this-commit",
      "request": { "method": "GET", "path": "/api/v2/taxcategories/{taxCategoryId}/usage" },
      "vars": { "taxCategoryId": "<a real id, or one the case creates first>" },
      "expect": { "status": 200, "jsonContains": "\"productCount\"" },
      "activity": null,
      "status": "pending"
    },
    {
      "id": "QA-2",
      "type": "ui",
      "title": "The category list shows the usage count",
      "steps": ["Open Settings → Tax categories", "Confirm each row shows a usage count"],
      "status": "pending"
    }
  ]
}
```

Rules for the cases:

- **Every acceptance criterion becomes at least one case.** A criterion with no case is a criterion
  nobody will check.
- **`api` cases carry a real route and a concrete expectation** — the route as the controller actually
  spells it, real parameters, and a status plus something specific in the body. `/validate` runs these
  over HTTP, so a vague case fails loudly rather than passing quietly.
- **A mutation's case names the `SystemActivity` type** it should write, in `activity`.
- **`ui` cases carry steps a person follows.** These are for QA; the runner never touches them.
- **`scope`** is `this-commit` for what this change must satisfy now, `later` for cases that belong to
  a following commit on the same ticket.

Also write `.claude/work/<gid>/qa-cases.md` — the same cases as a table, for pasting into the ticket
later. `/ship` will show it to the developer before anything is posted.

## Step 6: Write the plan

`.claude/work/<gid>/plan.md`, covering:

- each acceptance criterion mapped to the files and layers it touches;
- what is being reused, named by path;
- the decisions and the alternatives rejected, with why — this is what the commit body and the PR
  description will draw on;
- which important scenarios need an integration test (money, auth, state transitions, external
  integrations, delete/soft-delete/bulk, and every bug fix);
- what is deliberately out of scope.

## Step 7: Stop

Print the plan and the QA cases. **Coding starts only when the developer approves them.** They see the
cases again in `/ship`, before anything reaches the ticket — so this is the first of two reviews, not
the only one.

## Notes

- Everything written here lives in `.claude/work/`, which git never sees.
- If `qa-cases.json` does not parse, `/validate` says so rather than skipping the cases:
  `node -e "import('./.claude/guardrails/scripts/lib/qa-cases.mjs').then(m => { const fs = require('node:fs'); const r = m.parseCases(fs.readFileSync('.claude/work/<gid>/qa-cases.json','utf8')); console.log(r.problems.length ? r.problems : m.summarise(r.cases)); })"`
- Nothing in this skill writes to Asana. Posting to the ticket happens in `/ship`, and only after the
  developer approves the text.
