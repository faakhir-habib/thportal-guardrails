# Guardrails Stage 1, Part 3 — Ticket and QA Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ticket turns into QA cases and a plan before any code is written, and those cases are
verified over real HTTP before a commit is allowed — so "it works" stops being a claim and becomes a
recorded result.

**Architecture:** `/ticket` reads the Asana task, links the branch to it, and writes two files into
`.claude/work/<task-gid>/`: `qa-cases.json` (machine-readable, what the runner executes) and
`plan.md` (what the developer approves). `/validate` gains a fifth check: it boots the API against a
real database, logs in, runs every in-scope `api` case over HTTP, asserts the `SystemActivity` row a
mutation is supposed to write, and records the results in the same stamp the commit gate already
reads.

**Tech Stack:** Node 24 ESM (`fetch`, `node:test`), the Asana REST API, `bws` for credentials, the
.NET CLI for booting the API, SQL Server (branch DB or local dev DB).

**Spec:** `C:\file-management-server\.claude\guardrails\docs\design.md`, sections 2 (Workflow) and 7
(Configuration).

**Split from the spec:** `/ship` and `/learn` are **Part 4**. This plan stops at the point where a
developer can commit backend work whose QA cases have been verified. Shipping it — the PR, the
preview run, and the Asana comment the developer approves before it posts — is the next plan.

## Global Constraints

- **Backend only.** UI cases are written for QA to run by hand; the runner never touches them.
- **The product repo gets no commits and no tracked-file edits.** `.claude/work/` is inside the
  already-ignored `.claude/`.
- **Credentials are never written to disk, logged, or put in a stamp.** They live in memory for the
  life of one process.
- **Nothing is posted to Asana in this plan.** Reading the ticket is fine; writing to it is Part 4,
  and even then only after the developer approves the text.
- **No Claude attribution** anywhere.
- **Conventional Commits** in the bundle repo, with a body saying why.
- **Every rule stays in `rules/backend-rules.md`** — skills carry procedure only.
- **Do not push** until the final task, after the user has reviewed.

## Verified facts

Confirmed on 2026-09-18. Do not re-derive.

| Fact | Value |
|---|---|
| Asana workspace | `1209040875779194` |
| ERP project | `1209042358568959` |
| Section: In progress | `1209042456419716` |
| Section: QA | `1209042456419718` |
| Section: QA completed | `1215791320211211` |
| Section: Ready for release | `1209042402017048` |
| QA reviewer | Syed Aqil Shah, user gid `1213187391484366` |
| Asana token | Bitwarden **Work** project, key `ZAYAN_ASANA_TOKEN`; the `bws` access token on this machine is the DPAPI file `C:\Users\Administrator\.local\bws-token-personal.dpapi` |
| Asana task URL shape | `https://app.asana.com/1/<workspace>/project/<project>/task/<task-gid>` |
| Asana comment call | `POST /tasks/{gid}/stories`, body `{"data":{"html_text":"<body>…</body>"}}`; mention with `<a data-asana-gid="USER_GID"/>` |
| Preview env | API `https://pr-<N>-api.dev.thportal.ca`, app `https://pr-<N>.dev.thportal.ca` |
| Branch database | `erp-v1.0-<branch>`, created by the `create` workflow when the branch is first pushed; connection string from `task db:conn` at the repo root |
| Local API boot | `cd backend/FileManager && ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5237 ConnectionStrings__sqlConnection='…' dotnet run` |
| Dev SuperAdmin | seeded on startup outside Production: `devdevelopment@zayantechnologies.com` / `Admin@123` |
| Login route | `POST /api/v2/authentication/login`, JWT at `data.tokenDto.accessToken` |
| Response envelope | `ApiResponse` — `{ success, message, data, errors, code }` |

## File Structure

Paths are relative to `C:\file-management-server\.claude\guardrails\`.

| File | Responsibility |
|---|---|
| `scripts/lib/secrets.mjs` | Resolve a named secret: environment first, then Bitwarden; never persist it |
| `scripts/lib/asana.mjs` | Asana REST: read a task, its stories and its custom fields |
| `scripts/lib/qa-cases.mjs` | Read, validate and filter `qa-cases.json` |
| `scripts/lib/api-harness.mjs` | Boot the API, wait for it, log in, tear it down |
| `scripts/qa-verify.mjs` | Run the in-scope api cases and print results as JSON |
| `skills/thportal-ticket/SKILL.md` | `/ticket` — read the task, link the branch, write the plan and the cases |
| `config.json` | Asana gids, preview URL patterns, QA runner defaults |
| `tests/secrets.test.mjs`, `tests/qa-cases.test.mjs`, `tests/qa-verify.test.mjs` | Units, with a fake server rather than the real API |

---

### Task 1: Secrets

**Files:**
- Create: `scripts/lib/secrets.mjs`
- Test: `tests/secrets.test.mjs`

**Interfaces:**
- Consumes: `config.json`.
- Produces: `getSecret(key, { env, runBws })` → `string`; throws with a setup message when neither
  source has it. `runBws` is injected so tests never call the real CLI.

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSecret } from '../scripts/lib/secrets.mjs';

test('the environment wins and the CLI is never called', () => {
  let called = false;
  const value = getSecret('ZAYAN_ASANA_TOKEN', {
    env: { ZAYAN_ASANA_TOKEN: 'from-env' },
    runBws: () => { called = true; return '[]'; },
  });
  assert.equal(value, 'from-env');
  assert.equal(called, false);
});

test('Bitwarden is read by key name, not by id', () => {
  const value = getSecret('ZAYAN_ASANA_TOKEN', {
    env: {},
    runBws: () => JSON.stringify([
      { key: 'ZAYAN_GITHUB_PAT', value: 'gh' },
      { key: 'ZAYAN_ASANA_TOKEN', value: 'from-bitwarden' },
    ]),
  });
  assert.equal(value, 'from-bitwarden');
});

test('a missing secret explains both ways to provide it', () => {
  assert.throws(
    () => getSecret('ZAYAN_ASANA_TOKEN', { env: {}, runBws: () => '[]' }),
    /ZAYAN_ASANA_TOKEN.*(environment|Bitwarden)/s,
  );
});

test('the value never appears in the error when the CLI fails', () => {
  assert.throws(
    () => getSecret('ZAYAN_ASANA_TOKEN', { env: {}, runBws: () => { throw new Error('bws: 401 unauthorized'); } }),
    /bws/,
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /c/file-management-server/.claude/guardrails
node --test "tests/secrets.test.mjs"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `scripts/lib/secrets.mjs`**

```javascript
import { execFileSync } from 'node:child_process';
import { config } from './repo.mjs';

const defaultRunBws = () => {
  const { project } = config().bitwarden;
  const projects = JSON.parse(execFileSync('bws', ['project', 'list', '-o', 'json'], { encoding: 'utf8' }));
  const match = projects.find((p) => p.name === project);
  if (!match) throw new Error(`the Bitwarden project "${project}" is not visible to this bws token`);
  return execFileSync('bws', ['secret', 'list', match.id, '-o', 'json'], { encoding: 'utf8' });
};

export function getSecret(key, { env = process.env, runBws = defaultRunBws } = {}) {
  if (env[key]) return env[key];

  let listed = '[]';
  try {
    listed = runBws();
  } catch (error) {
    throw new Error(`could not read ${key} from Bitwarden (${error.message.split('\n')[0]}). Set ${key} in your environment instead.`);
  }

  const found = JSON.parse(listed).find((s) => s.key === key);
  if (found?.value) return found.value;

  throw new Error(`${key} was not found. Set it in your environment, or make it readable in the Bitwarden project "${config().bitwarden.project}".`);
}
```

Note for the implementer: on this machine the `bws` access token comes from a DPAPI file and is not
in the environment. Read it once per process in `defaultRunBws` by shelling out to PowerShell only
when `BWS_ACCESS_TOKEN` is absent, and pass it through `env` to `execFileSync` — never write it
anywhere.

- [ ] **Step 4: Add the Bitwarden block to `config.json`**

```json
{
  "gate": { "enabled": true, "requireTicket": false },
  "stamp": { "pruneDays": 30 },
  "bitwarden": { "project": "Work", "tokenFile": "C:/Users/Administrator/.local/bws-token-personal.dpapi" },
  "asana": {
    "workspace": "1209040875779194",
    "project": "1209042358568959",
    "sections": { "inProgress": "1209042456419716", "qa": "1209042456419718" },
    "qaReviewer": { "name": "Syed Aqil Shah", "gid": "1213187391484366" }
  },
  "preview": { "api": "https://pr-{n}-api.dev.thportal.ca", "app": "https://pr-{n}.dev.thportal.ca" },
  "qa": { "baseUrl": "http://localhost:5237", "bootTimeoutMs": 180000 }
}
```

- [ ] **Step 5: Run the tests, then prove it against the real Bitwarden once**

```bash
node --test "tests/secrets.test.mjs"
node -e "import('./scripts/lib/secrets.mjs').then(m => console.log(m.getSecret('ZAYAN_ASANA_TOKEN').length + ' characters'))"
```
Expected: 4 tests pass, and the second command prints a length — never the value.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/secrets.mjs config.json tests/secrets.test.mjs
git commit -m "feat: resolve secrets from the environment or Bitwarden

A token that lives in a file is a token that leaks into a diff eventually, so nothing here writes one down."
```

---

### Task 2: Reading the ticket

**Files:**
- Create: `scripts/lib/asana.mjs`
- Test: `tests/asana.test.mjs`

**Interfaces:**
- Consumes: `secrets.mjs`, `config.json`.
- Produces: `taskGidFromUrl(url)` → `string | null`; `getTask(gid, { fetchImpl, token })` →
  `{ gid, name, notes, permalink, assignee, section, stories: [{ author, text, createdAt }] }`;
  `taskUrl(gid)` → `string`.

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskGidFromUrl, getTask, taskUrl } from '../scripts/lib/asana.mjs';

test('a task gid is pulled out of every URL shape the board produces', () => {
  assert.equal(taskGidFromUrl('https://app.asana.com/1/1209040875779194/project/1209042358568959/task/1218492088693885'), '1218492088693885');
  assert.equal(taskGidFromUrl('https://app.asana.com/0/1209042358568959/1218492088693885'), '1218492088693885');
  assert.equal(taskGidFromUrl('https://app.asana.com/1/x/project/y/task/1218492088693885?focus=true'), '1218492088693885');
  assert.equal(taskGidFromUrl('1218492088693885'), '1218492088693885');
  assert.equal(taskGidFromUrl('not a task'), null);
});

test('getTask returns the fields the ticket file needs', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => (url.includes('/stories')
      ? { data: [{ created_by: { name: 'Aqil' }, text: 'repro steps', created_at: '2026-09-01T00:00:00Z', type: 'comment' }] }
      : { data: { gid: '123', name: 'Fix the dropdown', notes: 'it shows deleted lots', permalink_url: 'https://app.asana.com/x', assignee: { name: 'Faakhir' } } }),
  });

  const task = await getTask('123', { fetchImpl, token: 'x' });
  assert.equal(task.name, 'Fix the dropdown');
  assert.equal(task.notes, 'it shows deleted lots');
  assert.equal(task.stories.length, 1);
  assert.equal(task.stories[0].author, 'Aqil');
});

test('an API failure says which call failed', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(() => getTask('123', { fetchImpl, token: 'x' }), /401/);
});

test('taskUrl builds a link the board recognises', () => {
  assert.match(taskUrl('123'), /^https:\/\/app\.asana\.com\/1\/1209040875779194\/project\/1209042358568959\/task\/123$/);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test "tests/asana.test.mjs"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `scripts/lib/asana.mjs`**

```javascript
import { config } from './repo.mjs';
import { getSecret } from './secrets.mjs';

const API = 'https://app.asana.com/api/1.0';

export const taskGidFromUrl = (input = '') => {
  const s = String(input).trim();
  if (/^\d{6,}$/.test(s)) return s;
  const withTask = s.match(/\/task\/(\d{6,})/);
  if (withTask) return withTask[1];
  const legacy = s.match(/app\.asana\.com\/0\/\d+\/(\d{6,})/);
  return legacy ? legacy[1] : null;
};

export const taskUrl = (gid) => {
  const { workspace, project } = config().asana;
  return `https://app.asana.com/1/${workspace}/project/${project}/task/${gid}`;
};

async function call(path, { fetchImpl = fetch, token }) {
  const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Asana ${path} failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data;
}

export async function getTask(gid, { fetchImpl = fetch, token = getSecret('ZAYAN_ASANA_TOKEN') } = {}) {
  const fields = 'name,notes,permalink_url,assignee.name,completed,custom_fields.name,custom_fields.display_value';
  const task = await call(`/tasks/${gid}?opt_fields=${fields}`, { fetchImpl, token });
  const stories = await call(`/tasks/${gid}/stories?opt_fields=text,created_at,created_by.name,type`, { fetchImpl, token });

  return {
    gid,
    name: task.name,
    notes: task.notes ?? '',
    permalink: task.permalink_url ?? taskUrl(gid),
    assignee: task.assignee?.name ?? null,
    customFields: (task.custom_fields ?? []).map((f) => ({ name: f.name, value: f.display_value })),
    stories: (stories ?? [])
      .filter((s) => s.type === 'comment')
      .map((s) => ({ author: s.created_by?.name ?? 'unknown', text: s.text ?? '', createdAt: s.created_at })),
  };
}
```

- [ ] **Step 4: Run the tests, then read one real ticket**

```bash
node --test "tests/asana.test.mjs"
node -e "import('./scripts/lib/asana.mjs').then(async m => { const t = await m.getTask('1217777034665218'); console.log(t.name); console.log('comments:', t.stories.length); })"
```
Expected: 4 tests pass, and the real call prints the ticket title
("Narrow DealDocumentController authorization …") and its comment count.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/asana.mjs tests/asana.test.mjs
git commit -m "feat: read an Asana ticket, its notes and its comments

QA's repro steps live in the comments more often than in the description, so a ticket reader that only fetches the description reads the wrong half."
```

---

### Task 3: The QA case format

**Files:**
- Create: `scripts/lib/qa-cases.mjs`
- Test: `tests/qa-cases.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCases(json)` → `{ cases, problems }`; `inScope(cases, commitScope)` → `cases[]`;
  `summarise(cases)` → `string`. The schema every other task depends on:

```json
{
  "task": "1218492088693885",
  "cases": [
    {
      "id": "QA-1",
      "type": "api",
      "title": "A deleted lot is not offered in the assignment dropdown",
      "scope": "this-commit",
      "request": { "method": "GET", "path": "/api/v2/lots/{lotId}/assignable", "query": { "includeInactive": "false" } },
      "expect": { "status": 200, "jsonNotContains": "$.data[*].id == {deletedLotId}" },
      "activity": null,
      "status": "pending"
    },
    {
      "id": "QA-2",
      "type": "ui",
      "title": "The dropdown shows no deleted lots on the deal page",
      "steps": ["Open a deal", "Open the lot dropdown", "Confirm the deleted lot is absent"],
      "status": "pending"
    }
  ]
}
```

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCases, inScope, summarise } from '../scripts/lib/qa-cases.mjs';

const doc = {
  task: '123',
  cases: [
    { id: 'QA-1', type: 'api', title: 'a', scope: 'this-commit', request: { method: 'GET', path: '/x' }, expect: { status: 200 }, status: 'pending' },
    { id: 'QA-2', type: 'ui', title: 'b', steps: ['open it'], status: 'pending' },
    { id: 'QA-3', type: 'api', title: 'c', scope: 'later', request: { method: 'GET', path: '/y' }, expect: { status: 200 }, status: 'pending' },
  ],
};

test('a valid document parses with no problems', () => {
  const { cases, problems } = parseCases(JSON.stringify(doc));
  assert.equal(cases.length, 3);
  assert.deepEqual(problems, []);
});

test('an api case with no request or no expectation is a problem, not a silent pass', () => {
  const bad = { task: '1', cases: [{ id: 'QA-1', type: 'api', title: 'x', scope: 'this-commit' }] };
  const { problems } = parseCases(JSON.stringify(bad));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /QA-1.*request/i);
});

test('duplicate ids are refused', () => {
  const dupe = { task: '1', cases: [doc.cases[0], doc.cases[0]] };
  assert.match(parseCases(JSON.stringify(dupe)).problems.join(' '), /duplicate/i);
});

test('inScope keeps this-commit api cases only', () => {
  const { cases } = parseCases(JSON.stringify(doc));
  const scoped = inScope(cases);
  assert.deepEqual(scoped.map((c) => c.id), ['QA-1']);
});

test('summarise counts by type and status', () => {
  const { cases } = parseCases(JSON.stringify(doc));
  assert.match(summarise(cases), /3 cases/);
  assert.match(summarise(cases), /2 api/);
  assert.match(summarise(cases), /1 ui/);
});
```

- [ ] **Step 2: Run it and watch it fail, then write `scripts/lib/qa-cases.mjs`**

The implementation is a validator, not a framework: parse the JSON, check each case has an `id`, a
`type` of `api` or `ui`, a `title`, and — for `api` — a `request.method`, a `request.path` and an
`expect.status`; collect every problem rather than throwing on the first; refuse duplicate ids;
default `scope` to `this-commit` and `status` to `pending`.

`inScope(cases)` returns the `api` cases whose `scope` is `this-commit`. `summarise(cases)` returns a
line like `3 cases — 2 api, 1 ui; 3 pending`.

- [ ] **Step 3: Run the tests until they pass, then commit**

```bash
node --test "tests/qa-cases.test.mjs"
git add scripts/lib/qa-cases.mjs tests/qa-cases.test.mjs
git commit -m "feat: give QA cases a shape a machine can run

A case that only exists as prose gets verified by eye, which is how a case passes review and fails in production."
```

---

### Task 4: `/ticket`

**Files:**
- Create: `skills/thportal-ticket/SKILL.md`

**Interfaces:**
- Consumes: `asana.mjs`, `qa-cases.mjs`, `repo.mjs`.
- Produces: `.claude/work/<task-gid>/ticket.md`, `plan.md`, `qa-cases.json`, and
  `git config branch.<name>.asanaTask <gid>`.

- [ ] **Step 1: Write the skill**

It must carry these steps, in order:

1. **Read the ticket.** `node -e` through `asana.mjs`, writing `ticket.md` with the title, the
   description, the comments and the custom fields. Say who reported it and when.
2. **Set up the branch.** If the current branch is `staging` or a branch belonging to other work,
   create one from `origin/staging` with no upstream. Then
   `git config branch.<name>.asanaTask <gid>`.
3. **Ask what is ambiguous.** One question at a time, and only questions the ticket genuinely does
   not answer. Never invent acceptance criteria.
4. **Explore before planning.** Dispatch the `Explore` agent for: the code that already does part of
   this, the golden examples for the layers involved, and anything in `rules/backend-rules.md` that
   the change will run into (soft delete, audit logging, wiring).
5. **Write `qa-cases.json`.** Every acceptance criterion becomes at least one case. `api` cases carry
   a real route, real parameters and a concrete expectation; `ui` cases carry steps a person follows.
   A mutation's case names the `SystemActivity` type it should write.
6. **Write `plan.md`:** each criterion mapped to files and layers, what is being reused, the decisions
   and the rejected alternatives, and which important scenarios need an integration test.
7. **Stop for approval.** Print the plan and the cases. Coding starts only when the developer says so,
   and they are reviewed again in `/ship` before anything reaches the ticket.

- [ ] **Step 2: Install, restart, and run it against a real ticket**

```bash
cd /c/file-management-server
node .claude/guardrails/scripts/install.mjs
```

Restart Claude Code, then run `/ticket 1217777034665218` (the DealDocumentController authorization
ticket — real, small and backend-only).

Expected: `.claude/work/1217777034665218/` holds the three files, the branch is linked
(`git config --get branch.$(git branch --show-current).asanaTask` prints the gid), and the QA cases
name real routes from `DealDocumentController`.

- [ ] **Step 3: Check the cases are runnable, not just readable**

```bash
node -e "import('./.claude/guardrails/scripts/lib/qa-cases.mjs').then(async m => { const fs = await import('node:fs'); const { cases, problems } = m.parseCases(fs.readFileSync('.claude/work/1217777034665218/qa-cases.json','utf8')); console.log(problems.length ? problems : m.summarise(cases)); })"
```
Expected: no problems, and a summary naming the api and ui counts.

- [ ] **Step 4: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add skills/thportal-ticket
git commit -m "feat: add /ticket, which turns a task into QA cases and a plan

Writing the cases before the code is what stops them from being written to match whatever the code ended up doing."
```

---

### Task 5: The QA runner

**Files:**
- Create: `scripts/lib/qa-verify-lib.mjs` (the pure part, which the tests drive),
  `scripts/lib/api-harness.mjs` (booting and login), `scripts/qa-verify.mjs` (the CLI)
- Test: `tests/qa-verify.test.mjs`

**Interfaces:**
- Consumes: `qa-cases.mjs`, `config.json`.
- Produces: from `qa-verify-lib.mjs`, `runCases(cases, { baseUrl, token, fetchImpl })` →
  `[{ id, status: 'passed'|'failed', evidence, error }]`; `startApi({ connectionString })` →
  `{ baseUrl, stop() }`; `login(baseUrl, { fetchImpl })` → `string` (JWT).
  `node scripts/qa-verify.mjs --work <dir> [--base-url <url>]` prints
  `{ results, passed, failed }` and exits non-zero when any in-scope case fails.

- [ ] **Step 1: Write the failing test, with a fake server rather than the real API**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCases } from '../scripts/lib/qa-verify-lib.mjs';

const fetchImpl = async (url, opts) => {
  if (url.endsWith('/ok')) return { status: 200, json: async () => ({ success: true, data: [{ id: 'a' }] }) };
  if (url.endsWith('/missing')) return { status: 404, json: async () => ({ success: false, data: null }) };
  return { status: 500, json: async () => ({}) };
};

test('a case whose status matches passes and records evidence', async () => {
  const [r] = await runCases([
    { id: 'QA-1', type: 'api', request: { method: 'GET', path: '/ok' }, expect: { status: 200 } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(r.status, 'passed');
  assert.match(r.evidence, /GET \/ok -> 200/);
});

test('a case whose status does not match fails and says what came back', async () => {
  const [r] = await runCases([
    { id: 'QA-2', type: 'api', request: { method: 'GET', path: '/missing' }, expect: { status: 200 } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /expected 200.*got 404/i);
});

test('a jsonContains expectation is checked against the envelope data', async () => {
  const [pass] = await runCases([
    { id: 'QA-3', type: 'api', request: { method: 'GET', path: '/ok' }, expect: { status: 200, jsonContains: 'a' } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  const [fail] = await runCases([
    { id: 'QA-4', type: 'api', request: { method: 'GET', path: '/ok' }, expect: { status: 200, jsonContains: 'zzz' } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(pass.status, 'passed');
  assert.equal(fail.status, 'failed');
});

test('ui cases are never executed', async () => {
  const results = await runCases([{ id: 'QA-5', type: 'ui', steps: ['click'] }], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(results.length, 0);
});
```

- [ ] **Step 2: Write `scripts/lib/qa-verify-lib.mjs`**

`runCases` sends each `api` case with its method, path (after substituting `{placeholders}` from the
case's `vars` object when present), query string and body, with `Authorization: Bearer <token>`. It
compares the status, then any `jsonContains` against `JSON.stringify(body.data)`. Evidence is one
line: `GET /path -> 200`. A thrown request error is a failure with the message, never a pass.

- [ ] **Step 3: Write `scripts/lib/api-harness.mjs`**

`startApi` spawns `dotnet run --no-build -c Debug` in `backend/FileManager` with
`ASPNETCORE_ENVIRONMENT=Development`, `ASPNETCORE_URLS` from `config.qa.baseUrl` and
`ConnectionStrings__sqlConnection` from the caller, polls `GET {baseUrl}/api/v2/health` (falling back
to any 404-but-listening response) until `config.qa.bootTimeoutMs`, and returns `stop()` which kills
the process tree. `login` POSTs the dev SuperAdmin credentials to
`/api/v2/authentication/login` and returns `data.tokenDto.accessToken`.

**The database choice belongs to the caller, and must be stated in the evidence:** the branch DB from
`task db:conn` when the branch has been pushed, otherwise the developer's local dev database. Never
point it at staging or a PR preview DB that other people are using.

- [ ] **Step 4: Write `scripts/qa-verify.mjs`**

Reads `<work>/qa-cases.json`, takes the in-scope api cases, boots the API unless `--base-url` was
given, logs in, runs the cases, always stops the API, writes the updated statuses back into
`qa-cases.json`, and prints `{ database, results, passed, failed }`.

- [ ] **Step 5: Run the unit tests, then a real end-to-end run**

```bash
node --test "tests/qa-verify.test.mjs"
cd /c/file-management-server && node .claude/guardrails/scripts/qa-verify.mjs --work .claude/work/1217777034665218
```
Expected: the units pass; the real run boots the API, logs in, executes the api cases and prints
their results with the database it used. Expect the first real run to surface a mismatch between a
case's route and the real route — that is the runner doing its job, and the case gets fixed.

- [ ] **Step 6: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add scripts/lib/api-harness.mjs scripts/lib/qa-verify-lib.mjs scripts/qa-verify.mjs tests/qa-verify.test.mjs
git commit -m "feat: run the QA cases over real HTTP

On PR 2312 the query layer passed and the first real HTTP call 404'd, which is the whole reason this runs the route rather than the method."
```

---

### Task 6: QA in `/validate` and in the stamp

**Files:**
- Modify: `scripts/validate.mjs`, `skills/thportal-validate/SKILL.md`, `config.json`

**Interfaces:**
- Consumes: `qa-verify.mjs`, `qa-cases.mjs`, `repo.mjs`.
- Produces: a stamp whose `qa` field holds `{ [caseId]: { status, evidence, database } }`, and a
  `result` that is `fail` when any in-scope case failed.

- [ ] **Step 1: Extend `validate.mjs`**

After the checks and before the stamp:

1. Find the work folder from the branch's ticket link: `.claude/work/<gid>/`. No link, or no
   `qa-cases.json` — record `qa: { skipped: 'no ticket linked' }` and carry on. This keeps the gate
   usable while `requireTicket` is off.
2. Otherwise run `qa-verify.mjs`, and fail the stamp when any in-scope case failed.
3. Put the results, and which database was used, into the stamp.

- [ ] **Step 2: Update the `/validate` skill**

Add the QA step between the review and the stamp, and say plainly in the report: which cases ran,
against which database, which passed, and which UI cases are left for QA.

- [ ] **Step 3: Prove it end to end on the real ticket**

Stage the backend change for the ticket used in Task 4, run `/validate`, and confirm the stamp holds
the QA results.

```bash
cd /c/file-management-server
cat .git/guardrails/stamps/$(git write-tree).json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify({result:j.result,qa:j.qa},null,2))})"
```
Expected: `result` reflects the QA outcome, and `qa` names each case with its evidence.

- [ ] **Step 4: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add scripts/validate.mjs skills/thportal-validate config.json
git commit -m "feat: make the QA cases part of what the gate checks

A verified case in a stamp is the difference between believing the change works and being able to show it."
```

---

### Task 7: Docs and release 0.4.0

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `VERSION`, `claude/CLAUDE.root.md`

- [ ] **Step 1: Run the whole suite**

```bash
cd /c/file-management-server/.claude/guardrails
node --test "tests/*.test.mjs"
sh tests/hooks.test.sh
```
Expected: every test passes.

- [ ] **Step 2: Update the docs**

- README: move `/ticket` into "Working today", document the work folder and the QA case schema, and
  add how long a QA run takes on top of the five and a half minutes.
- `CLAUDE.root.md`: the workflow line becomes `/ticket` → plan approved → code → `/validate` →
  commit, with `/ship` still to come.
- CHANGELOG 0.4.0, VERSION `0.4.0`.

- [ ] **Step 3: Show the user and stop**

```bash
git status --short
git log --oneline origin/main..HEAD
cd /c/file-management-server && git status --short
```
**Do not push** until the user has reviewed.

- [ ] **Step 4: Push after the go-ahead**

```bash
cd /c/file-management-server/.claude/guardrails
git add -A && git commit -m "chore: release 0.4.0

QA cases that run are the point of the whole exercise; everything before this was scaffolding for them."
git push origin main
```

---

## What Part 4 covers

| Item | Why it is separate |
|---|---|
| `/ship` | Pushing, the PR body, verifying on the preview env, and the Asana comment the developer approves before it posts |
| `/learn` | Turning a review comment or a QA failure into a rule, with the eval case that proves it |
| `gate.requireTicket: true` | Flip it on once `/ticket` has linked branches for a few real tickets |
| Asana writes | The first time anything is posted to a ticket — and it never posts without the developer saying so |
