# Guardrails Stage 1, Part 4 — Ship and Learn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finished work reaches the PR and the ticket in one step — with the QA cases verified on the
preview environment and the ticket comment shown to the developer before a word of it is posted — and
every lesson learned on the way back becomes a rule that cannot be forgotten.

**Architecture:** `/ship` refuses to start unless the branch is already validated, reviews the whole
branch diff rather than the last commit, pushes, opens the PR, waits for the preview API, re-runs the
QA cases against it, and then **stops** and prints the exact Asana comment. Posting is a second,
explicit step. `/learn` turns a review comment, a QA failure or a correction into a rule in
`backend-rules.md`, with a changelog row and an eval case that proves it.

**Tech Stack:** Node 24 ESM (`fetch`, `node:test`), the `gh` CLI for GitHub, the Asana REST API,
the QA runner from Part 3.

**Spec:** `C:\file-management-server\.claude\guardrails\docs\design.md`, sections 2 (`/ship`) and 4
(`/learn`).

## Global Constraints

- **Nothing is posted to Asana or GitHub without the developer saying so.** `/ship` prints, waits,
  and only then posts. This is the rule the whole plan exists to honour.
- **Backend only**, and **no commits to the product repo** beyond the branch the developer is already
  working on.
- **No Claude attribution** in the PR body, the commit messages or the ticket comment.
- **The PR body stays short** — about 15 lines: Asana link, summary, why, verification, waivers.
- **Credentials** come from `secrets.mjs` (environment, then Bitwarden). `gh` handles its own auth.
- **Every rule `/learn` writes carries a severity, a reason, a real example and an eval case.**
- **Do not push the bundle** until the final task, after the user has reviewed.

## Verified facts

Confirmed on 2026-09-22 by reading the ERP board through the API. Do not re-derive.

| Fact | Value |
|---|---|
| Asana workspace / project | `1209040875779194` / `1209042358568959` |
| Section: QA | `1209042456419718` |
| QA reviewer | Syed Aqil Shah, `1213187391484366` |
| Custom field **Branch name** | text, gid `1213970239265742` |
| Custom field **Preview Url** | text, gid `1215526484518092` |
| Custom field **Backend Dev** | people, gid `1213957793553498` |
| Custom field **Backend Status** | enum, gid `1213961395073443` — options: In Progress `1213961395073444`, Done `1213961395073445`, N/A `1213961395073446` |
| Comment call | `POST /tasks/{gid}/stories`, body `{"data":{"html_text":"<body>…</body>"}}` |
| Mention markup | `<a data-asana-gid="1213187391484366"/>` |
| Custom field call | `PUT /tasks/{gid}`, body `{"data":{"custom_fields":{"<field gid>":"<value>"}}}` |
| Section move call | `POST /sections/{section gid}/addTask`, body `{"data":{"task":"<task gid>"}}` |
| Preview URLs | API `https://pr-{n}-api.dev.thportal.ca`, app `https://pr-{n}.dev.thportal.ca` |
| Allowed html in a comment | `<strong> <em> <u> <s> <code> <pre> <ol> <ul> <li> <a> <h1> <h2>` inside `<body>`; `<p>` and `<br>` are rejected, plain newlines survive |
| Base branch | `staging` |

## File Structure

Paths are relative to `C:\file-management-server\.claude\guardrails\`.

| File | Responsibility |
|---|---|
| `scripts/lib/github.mjs` | `gh` wrappers and the PR body builder |
| `scripts/lib/asana-write.mjs` | Posting a comment, setting custom fields, moving a section, and building the comment html |
| `scripts/ship.mjs` | The whole sequence: preconditions → review → push → PR → preview QA → print; `--post` does the Asana half |
| `skills/thportal-ship/SKILL.md` | `/ship` |
| `skills/thportal-learn/SKILL.md` | `/learn` |
| `scripts/lib/rules-changelog.mjs` | Appending a row to the rules changelog, and checking a rule has what a rule needs |
| `tests/github.test.mjs`, `tests/asana-write.test.mjs`, `tests/rules-changelog.test.mjs` | Units, with `gh` and `fetch` injected |

---

### Task 1: The PR body and the `gh` wrappers

**Files:**
- Create: `scripts/lib/github.mjs`
- Test: `tests/github.test.mjs`

**Interfaces:**
- Consumes: `repo.mjs`.
- Produces: `buildPrBody({ ticketUrl, summary, why, verification, waivers })` → `string`;
  `currentPr({ run })` → `{ number, url } | null`; `createPr({ title, body, base, run })` →
  `{ number, url }`; `prReviewComments(number, { run })` → `[{ author, body, path, line }]`.
  `run` is an injected command runner so tests never call `gh`.

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrBody, currentPr, createPr, prReviewComments } from '../scripts/lib/github.mjs';

const body = () => buildPrBody({
  ticketUrl: 'https://app.asana.com/1/w/project/p/task/123',
  summary: 'Adds the usage count so an admin can see what a category is used by.',
  why: ['Counted on the FK column because the navigation is configured twice.'],
  verification: { tests: ['TaxCategoryUsageApiTests (new)'], suite: 'pass', qa: '4/4 API cases passed on preview' },
  waivers: [],
});

test('the body leads with the ticket and stays short', () => {
  const b = body();
  assert.match(b.split('\n')[0], /^\*\*Asana:\*\* https:\/\/app\.asana\.com/);
  assert.ok(b.split('\n').length <= 18, `body was ${b.split('\n').length} lines`);
});

test('the sections that matter are present and the empty one is absent', () => {
  const b = body();
  for (const heading of ['## Summary', '## Why', '## Verification']) assert.match(b, new RegExp(heading));
  assert.doesNotMatch(b, /## Waivers/, 'no waivers means no waivers heading');
});

test('waivers appear when there are any', () => {
  const b = buildPrBody({
    ticketUrl: 'u', summary: 's', why: [], waivers: [{ rule: 'Naming', reason: 'the codebase is split 50/50 here' }],
    verification: { tests: [], suite: 'pass', qa: 'none' },
  });
  assert.match(b, /## Waivers/);
  assert.match(b, /Naming — the codebase is split 50\/50 here/);
});

test('the body never mentions Claude', () => {
  const b = buildPrBody({
    ticketUrl: 'u', summary: 'Generated with Claude Code', why: ['Co-Authored-By: Claude'], waivers: [],
    verification: { tests: [], suite: 'pass', qa: 'none' },
  });
  assert.doesNotMatch(b, /claude/i);
});

test('currentPr returns null when gh finds nothing', () => {
  const run = () => { throw new Error('no pull requests found for branch'); };
  assert.equal(currentPr({ run }), null);
});

test('currentPr parses the number and url', () => {
  const run = () => JSON.stringify({ number: 2450, url: 'https://github.com/o/r/pull/2450' });
  assert.deepEqual(currentPr({ run }), { number: 2450, url: 'https://github.com/o/r/pull/2450' });
});

test('createPr passes the base branch and returns the new number', () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return args.includes('create') ? 'https://github.com/o/r/pull/2451\n' : JSON.stringify({ number: 2451, url: 'x' });
  };
  const pr = createPr({ title: 't', body: 'b', base: 'staging', run });
  assert.equal(pr.number, 2451);
  assert.ok(calls[0].includes('--base') && calls[0].includes('staging'));
});

test('review comments come back flattened', () => {
  const run = () => JSON.stringify([{ user: { login: 'lead' }, body: 'add the filter', path: 'a.cs', line: 12 }]);
  assert.deepEqual(prReviewComments(2450, { run }), [{ author: 'lead', body: 'add the filter', path: 'a.cs', line: 12 }]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /c/file-management-server/.claude/guardrails
node --test "tests/github.test.mjs"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `scripts/lib/github.mjs`**

```javascript
import { execFileSync } from 'node:child_process';
import { repoRoot } from './repo.mjs';

const CLAUDE = /claude|anthropic|🤖/i;

const defaultRun = (args) => execFileSync('gh', args, { cwd: repoRoot(), encoding: 'utf8' }).trim();

export function buildPrBody({ ticketUrl, summary, why = [], verification = {}, waivers = [] }) {
  const clean = (s) => String(s).replace(/.*claude.*/gi, '').replace(/.*anthropic.*/gi, '').trim();

  const lines = [`**Asana:** ${ticketUrl}`, '', '## Summary', clean(summary), ''];

  lines.push('## Why');
  const reasons = why.map(clean).filter(Boolean).slice(0, 3);
  lines.push(...(reasons.length ? reasons.map((r) => `- ${r}`) : ['- Nothing the diff does not already explain.']));
  lines.push('');

  lines.push('## Verification');
  const tests = (verification.tests ?? []).join(' · ');
  lines.push(`- Integration tests: ${tests || 'none required'} · existing suite ${verification.suite ?? 'pass'}`);
  lines.push(`- QA: ${verification.qa ?? 'not run'}`);

  if (waivers.length) {
    lines.push('', '## Waivers');
    lines.push(...waivers.map((w) => `- ${w.rule} — ${clean(w.reason)}`));
  }

  const body = lines.join('\n');
  if (CLAUDE.test(body)) throw new Error('the PR body mentions Claude — that never goes in a PR');
  return body;
}

export function currentPr({ run = defaultRun } = {}) {
  try {
    return JSON.parse(run(['pr', 'view', '--json', 'number,url']));
  } catch {
    return null;
  }
}

export function createPr({ title, body, base = 'staging', run = defaultRun }) {
  run(['pr', 'create', '--base', base, '--title', title, '--body', body]);
  return currentPr({ run });
}

export const prReviewComments = (number, { run = defaultRun } = {}) =>
  JSON.parse(run(['api', `repos/{owner}/{repo}/pulls/${number}/comments`]))
    .map((c) => ({ author: c.user?.login ?? 'unknown', body: c.body ?? '', path: c.path ?? null, line: c.line ?? null }));
```

- [ ] **Step 4: Run the tests until they pass**

```bash
node --test "tests/github.test.mjs"
```
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/github.mjs tests/github.test.mjs
git commit -m "feat: build the PR body and wrap the gh calls

The body is built rather than written by hand so it cannot drift into an essay, and so a mention of Claude fails loudly instead of reaching the PR."
```

---

### Task 2: Writing to the ticket

**Files:**
- Create: `scripts/lib/asana-write.mjs`
- Test: `tests/asana-write.test.mjs`

**Interfaces:**
- Consumes: `asana.mjs`, `secrets.mjs`, `config.json`.
- Produces: `buildQaComment({ branch, previewUrl, prUrl, cases, waivers, reviewerGid })` → html string;
  `postComment(taskGid, html, { fetchImpl, token })`; `setCustomFields(taskGid, fields, { fetchImpl, token })`;
  `moveToSection(taskGid, sectionGid, { fetchImpl, token })`.

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQaComment, postComment, setCustomFields, moveToSection } from '../scripts/lib/asana-write.mjs';

const cases = [
  { id: 'QA-1', type: 'api', title: 'count excludes inactive', status: 'passed', evidence: 'GET /x -> 200' },
  { id: 'QA-2', type: 'ui', title: 'the list shows the count', status: 'pending', steps: ['open it', 'look'] },
];

const comment = () => buildQaComment({
  branch: 'feat/x',
  previewUrl: 'https://pr-9-api.dev.thportal.ca',
  prUrl: 'https://github.com/o/r/pull/9',
  cases,
  waivers: [],
  reviewerGid: '1213187391484366',
});

test('the comment carries the branch, the preview, the PR and the mention', () => {
  const c = comment();
  assert.match(c, /feat\/x/);
  assert.match(c, /pr-9-api\.dev\.thportal\.ca/);
  assert.match(c, /pull\/9/);
  assert.match(c, /<a data-asana-gid="1213187391484366"\/>/);
});

test('api cases show their evidence and ui cases show their steps', () => {
  const c = comment();
  assert.match(c, /GET \/x -> 200/);
  assert.match(c, /open it/);
});

test('only tags allowed by Asana are used', () => {
  const c = comment();
  assert.doesNotMatch(c, /<p>|<br\s*\/?>|<div|<table/i);
  assert.match(c, /^<body>/);
  assert.match(c, /<\/body>$/);
});

test('a failing case is called out rather than buried', () => {
  const c = buildQaComment({
    branch: 'b', previewUrl: 'p', prUrl: 'u', reviewerGid: 'g', waivers: [],
    cases: [{ id: 'QA-1', type: 'api', title: 'x', status: 'failed', error: 'expected 200, got 404' }],
  });
  assert.match(c, /failed/i);
  assert.match(c, /expected 200, got 404/);
});

test('postComment sends html_text to the stories endpoint', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ data: { gid: '1' } }) }; };
  await postComment('123', '<body>hi</body>', { fetchImpl, token: 't' });
  assert.match(seen[0].url, /\/tasks\/123\/stories$/);
  assert.equal(JSON.parse(seen[0].opts.body).data.html_text, '<body>hi</body>');
});

test('setCustomFields PUTs the field map', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ data: {} }) }; };
  await setCustomFields('123', { '1213970239265742': 'feat/x' }, { fetchImpl, token: 't' });
  assert.equal(seen[0].opts.method, 'PUT');
  assert.equal(JSON.parse(seen[0].opts.body).data.custom_fields['1213970239265742'], 'feat/x');
});

test('a failed write says which call failed', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(() => moveToSection('123', '456', { fetchImpl, token: 't' }), /403/);
});
```

- [ ] **Step 2: Run it and watch it fail, then write `scripts/lib/asana-write.mjs`**

```javascript
import { config } from './repo.mjs';
import { getSecret } from './secrets.mjs';

const API = 'https://app.asana.com/api/1.0';
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(path, { method = 'POST', body, fetchImpl = fetch, token }) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Asana ${method} ${path} failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data;
}

export function buildQaComment({ branch, previewUrl, prUrl, cases = [], waivers = [], reviewerGid }) {
  const api = cases.filter((c) => c.type === 'api');
  const ui = cases.filter((c) => c.type === 'ui');
  const failed = api.filter((c) => c.status === 'failed');

  const lines = ['<body><strong>Ready for QA</strong>', ''];
  lines.push(`Branch: <code>${escape(branch)}</code>`);
  lines.push(`Preview: <a href="${escape(previewUrl)}">${escape(previewUrl)}</a>`);
  lines.push(`PR: <a href="${escape(prUrl)}">${escape(prUrl)}</a>`, '');

  lines.push('<strong>Verified over HTTP</strong>', '<ul>');
  for (const c of api) {
    const detail = c.status === 'failed' ? ` — FAILED: ${escape(c.error ?? '')}` : ` — ${escape(c.evidence ?? 'passed')}`;
    lines.push(`<li>${escape(c.id)} ${escape(c.title)}${detail}</li>`);
  }
  lines.push('</ul>');

  if (ui.length) {
    lines.push('<strong>For QA to check</strong>', '<ul>');
    for (const c of ui) lines.push(`<li>${escape(c.id)} ${escape(c.title)}: ${escape((c.steps ?? []).join(' → '))}</li>`);
    lines.push('</ul>');
  }

  if (failed.length) lines.push(`<strong>${failed.length} case(s) failed — this is not ready to test.</strong>`);
  if (waivers.length) {
    lines.push('<strong>Waived review findings</strong>', '<ul>');
    for (const w of waivers) lines.push(`<li>${escape(w.rule)} — ${escape(w.reason ?? w.waivedReason ?? '')}</li>`);
    lines.push('</ul>');
  }

  lines.push('', `<a data-asana-gid="${reviewerGid}"/> over to you.`, '</body>');
  return lines.join('\n');
}

const token = () => getSecret('ZAYAN_ASANA_TOKEN');

export const postComment = (taskGid, html, { fetchImpl = fetch, token: t = token() } = {}) =>
  call(`/tasks/${taskGid}/stories`, { body: { data: { html_text: html } }, fetchImpl, token: t });

export const setCustomFields = (taskGid, fields, { fetchImpl = fetch, token: t = token() } = {}) =>
  call(`/tasks/${taskGid}`, { method: 'PUT', body: { data: { custom_fields: fields } }, fetchImpl, token: t });

export const moveToSection = (taskGid, sectionGid, { fetchImpl = fetch, token: t = token() } = {}) =>
  call(`/sections/${sectionGid}/addTask`, { body: { data: { task: taskGid } }, fetchImpl, token: t });
```

- [ ] **Step 3: Run the tests until they pass, then commit**

```bash
node --test "tests/asana-write.test.mjs"
git add scripts/lib/asana-write.mjs tests/asana-write.test.mjs
git commit -m "feat: build and post the ticket comment QA works from

Asana rejects most html, so the comment is built from the tags it actually accepts rather than hoping markdown survives."
```

---

### Task 3: `/ship` — everything up to the moment of posting

**Files:**
- Create: `scripts/ship.mjs`

**Interfaces:**
- Consumes: `repo.mjs`, `stamp.mjs`, `qa-cases.mjs`, `github.mjs`, `asana-write.mjs`, `qa-verify.mjs`.
- Produces: `node scripts/ship.mjs` → prints `{ checks, pr, preview, qa, asana: { comment, fields, section } }`
  and posts nothing; `node scripts/ship.mjs --post` → performs the Asana half and prints what it did.

- [ ] **Step 1: Write the preconditions and make them refuse loudly**

`ship.mjs` stops, with the reason, unless all of these hold:

1. the working tree is clean (`git status --porcelain` is empty);
2. the branch is linked to a ticket (`branch.<name>.asanaTask`);
3. `verifyStamp(HEAD^{tree})` is `ok` — the committed content is the validated content;
4. every `api` case in `.claude/work/<gid>/qa-cases.json` has `status: "passed"`.

Each refusal names the command that fixes it: `git commit`, `/ticket`, `/validate`.

- [ ] **Step 2: Review the whole branch before pushing anything**

```bash
git fetch -q origin staging
git diff origin/staging...HEAD -- backend/ > "$SCRATCH/branch.diff"
```

`/ship` dispatches the `architecture-reviewer` on that diff — not the last commit's. A DTO changed in
the first commit and a frontend caller never updated is invisible commit by commit and obvious here.
Any violation stops the ship.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin <branch>
```

Then `createPr({ title, body: buildPrBody({...}), base: 'staging' })` when `currentPr()` is null, and
reuse the existing PR when it is not. The title is the ticket's name, trimmed of any `[TEST]` prefix.

- [ ] **Step 4: Verify on the preview environment**

The preview URLs come from `config.preview`, with `{n}` replaced by the PR number. Poll
`https://pr-<n>-api.dev.thportal.ca` for up to 10 minutes; the preview box is RAM-bound and sometimes
does not come up at all.

- **Preview up:** re-run the QA cases against it —
  `node scripts/qa-verify.mjs --work .claude/work/<gid> --base-url https://pr-<n>-api.dev.thportal.ca`
  — and use those results in the comment. This is the run that matters: it is the environment QA will
  actually open.
- **Preview not up:** carry on with the local results and say, in the comment and in the report, that
  preview verification is pending.

- [ ] **Step 5: Print the Asana payload and stop**

Print exactly what would be posted:

- the comment html, rendered as plain text so it can be read;
- the custom fields that would be set — **Branch name** `1213970239265742` and **Preview Url**
  `1215526484518092`, and **Backend Status** `1213961395073443` → Done `1213961395073445`;
- the section the task would move to — **QA** `1209042456419718`.

Then stop. Nothing is posted. Exit 0 with a `"posted": false` in the JSON.

- [ ] **Step 6: `--post` does the second half**

With `--post`, and only then: `postComment`, `setCustomFields`, `moveToSection`, in that order, and
print what each one did. If a call fails, print the comment text so the developer can paste it by
hand, and do not move the section.

- [ ] **Step 7: Prove the preconditions on this repo**

```bash
cd /c/file-management-server
node .claude/guardrails/scripts/ship.mjs
```
Expected on the current branch: it refuses, naming the first unmet precondition rather than pushing
anything. That refusal is the test — there is nothing here that should be shipped.

- [ ] **Step 8: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add scripts/ship.mjs
git commit -m "feat: add /ship up to the point of posting

Everything is prepared and shown first, because a QA case that reaches the ticket wrong wastes a QA cycle and the developer is the only one who can tell."
```

---

### Task 4: The `/ship` skill

**Files:**
- Create: `skills/thportal-ship/SKILL.md`

- [ ] **Step 1: Write the skill**

It carries, in order: run `ship.mjs`; read the refusal out loud if it refuses; show the developer the
QA case table and the comment **as text**, and ask them to check the cases describe what was actually
built; take their edits to `qa-cases.json`; re-run `ship.mjs` so the comment is rebuilt from the
edited cases; and only on an explicit yes run `ship.mjs --post`.

It must also say what `/ship` never does: it never posts without that yes, never moves the ticket when
a case failed, and never merges anything — leads own the merge.

- [ ] **Step 2: Install and check it registers**

```bash
cd /c/file-management-server
node .claude/guardrails/scripts/install.mjs
```
Restart Claude Code, then confirm `/thportal-ship` is listed.

- [ ] **Step 3: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add skills/thportal-ship
git commit -m "feat: add the /ship skill

The skill's job is the pause: it shows the developer the cases QA will test from, and waits."
```

---

### Task 5: `/learn`

**Files:**
- Create: `scripts/lib/rules-changelog.mjs`, `skills/thportal-learn/SKILL.md`
- Test: `tests/rules-changelog.test.mjs`

**Interfaces:**
- Consumes: `rules/backend-rules.md`, `eval/expected.md`.
- Produces: `appendChangelogRow({ date, rule, why, source, evalCase })` → the updated file content;
  `checkRule(text)` → `{ ok, problems }` — a rule needs a severity, a reason and a real path.

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendChangelogRow, checkRule } from '../scripts/lib/rules-changelog.mjs';

const file = `## Changelog

| Date | Rule | Why it was added | Source (PR/ticket) | Eval case |
|---|---|---|---|---|
| 2026-09-18 | All rules in this file | Created from the design | docs/design.md | V1-V22 |
`;

test('a row is appended under the existing ones', () => {
  const out = appendChangelogRow(file, { date: '2026-09-22', rule: 'AsNoTracking', why: 'a read tracked entities', source: 'PR 2422', evalCase: 'V23' });
  const rows = out.trim().split('\n');
  assert.match(rows.at(-1), /2026-09-22 \| AsNoTracking .*V23/);
  assert.equal(rows.filter((r) => r.startsWith('|')).length, 4, 'header, separator and two rows');
});

test('a rule with no severity is incomplete', () => {
  assert.equal(checkRule('- Always use AsNoTracking on reads.').ok, false);
  assert.match(checkRule('- Always use AsNoTracking on reads.').problems.join(' '), /severity/i);
});

test('a rule with no reason is incomplete', () => {
  const r = checkRule('- Always use AsNoTracking on reads — `violation`. See `backend/Repository/LotRepository.cs`.');
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /why|reason/i);
});

test('a complete rule passes', () => {
  const r = checkRule('- Always use `AsNoTracking()` on read-only queries — `violation`. **Why:** change tracking on a read wastes memory and hides accidental writes. See `backend/Repository/LotRepository.cs`.');
  assert.deepEqual(r, { ok: true, problems: [] });
});
```

- [ ] **Step 2: Write `scripts/lib/rules-changelog.mjs`**

`appendChangelogRow` finds the last line starting with `|` and inserts the new row after it.
`checkRule` reports a problem when the text has no `violation`/`suggestion`, no `Why:` (or `because`),
or no path-looking token (`backend/…`).

- [ ] **Step 3: Write `skills/thportal-learn/SKILL.md`**

The skill's steps:

1. **Name the lesson in one sentence.** If it cannot be said in one sentence it is two lessons.
2. **Find where it belongs.** Search `rules/backend-rules.md` for a rule that already covers it —
   `/learn` updates that rule far more often than it adds one. A second rule saying nearly the same
   thing is the duplication the rules themselves forbid.
3. **Verify it against the codebase** — at least two real examples, named with paths. A rule the
   codebase does not follow is not written; it becomes a conversation with the team instead.
4. **Write the rule** with its severity, its reason, and the example. Run `checkRule` on the text.
5. **Add the eval case.** Plant the violation in `eval/bad-diff.patch`, add its row to
   `eval/expected.md`, and re-run the reviewer to prove it is caught. A rule with no eval case is a
   rule nobody will notice regressing.
6. **Record it** with `appendChangelogRow`, naming the PR, ticket or QA failure that taught it.
7. **Commit in the bundle repo** as `chore(rules): …`, never in the product repo.

Sources it is triggered by: a lead's PR review comment the reviewer missed
(`prReviewComments(n)` from `github.mjs`), a QA failure, a developer correction in session, or a
waiver — a waived finding means the rule was wrong or unclear, and that is a lesson too.

- [ ] **Step 4: Run the tests, install, and commit**

```bash
node --test "tests/rules-changelog.test.mjs"
cd /c/file-management-server && node .claude/guardrails/scripts/install.mjs
cd /c/file-management-server/.claude/guardrails
git add scripts/lib/rules-changelog.mjs skills/thportal-learn tests/rules-changelog.test.mjs
git commit -m "feat: add /learn, which turns a lesson into a rule with an eval case

A lesson explained in a review comment is forgotten by the next ticket; a lesson in the rules file with a fixture is not."
```

---

### Task 6: Turn the ticket requirement on, then release 0.5.0

**Files:**
- Modify: `config.json`, `README.md`, `CHANGELOG.md`, `VERSION`, `claude/CLAUDE.root.md`

- [ ] **Step 1: Flip `requireTicket`**

```json
"gate": { "enabled": true, "requireTicket": true }
```

Every branch must now be linked before a backend commit. `/ticket` does the linking; a branch started
by hand needs `git config branch.<name>.asanaTask <gid>` once.

- [ ] **Step 2: Prove the gate still behaves**

```bash
cd /c/file-management-server/.claude/guardrails
node --test "tests/*.test.mjs"
sh tests/hooks.test.sh
```
Expected: everything passes. The hook harness sets a ticket link for its own branch, so the stricter
setting does not change its result.

- [ ] **Step 3: Update the docs**

- README: `/ship` and `/learn` move into "Working today"; add that `requireTicket` is on and what to do
  on a branch that has no ticket.
- `CLAUDE.root.md`: the workflow line loses its "still being built" caveat.
- CHANGELOG 0.5.0, VERSION `0.5.0`.

- [ ] **Step 4: Show the user and stop**

```bash
git status --short
git log --oneline origin/main..HEAD
cd /c/file-management-server && git status --short
```
**Do not push** until the user has reviewed.

- [ ] **Step 5: Push after the go-ahead**

```bash
cd /c/file-management-server/.claude/guardrails
git add -A && git commit -m "chore: release 0.5.0

With /ship and /learn the loop closes: a ticket becomes code, the code becomes a verified PR, and what QA and the leads find becomes a rule."
git push origin main
```

---

## What is left after this

| Item | Why it waits |
|---|---|
| A real ticket end to end | The first `/ticket` → `/ship` run on work that actually merges is what will expose the next set of wrong assumptions |
| Giving the bundle to a second developer | Worth doing only after that run |
| CI (Stage 3) | Still deferred; nothing goes into the product repo until the user says so |
