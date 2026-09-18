# Claude Development Guardrails

**Date:** 2026-09-17
**Ticket:** none — this work is never committed, so the branch/ticket rule it introduces does not
apply to itself
**Branch:** `chore/claude-dev-guardrails` was cut from `origin/staging` as a workspace, but nothing
is committed to it. The bundle's files are untracked and excluded, so they follow the developer
across branch switches
**Scope:** **Backend work only.** Developer-local tooling — Claude Code configuration and git hooks
inside each developer's own clone. **Nothing is committed to the repository**: no tracked files
change, no CI, no branch protection, and the team's PR process is untouched. Frontend work runs
exactly as it does today.
**Approach:** One shared rules file that every Claude session reads while writing, reviewing and
validating; a `/ticket → /validate → /ship` workflow; and a commit gate keyed to the exact staged
tree. Distribution is a bundle the owner hands to a developer, who installs it in their own clone.

## Problem

AI has made development fast, and three things have broken along the way:

1. **Nobody can say why a line exists.** Only 11 of the last 300 commits mention a ticket, the repo
   has no PR template, and most PR descriptions are empty. `git blame` leads nowhere.
2. **Code is inconsistent and breaks the architecture.** The repo has no `CLAUDE.md` at any level,
   so every developer's Claude writes code without the project's rules. The backend rules exist only
   inside the `thportal-pr-review` skill, which runs after the fact. Leads read the result as low
   developer effort.
3. **Nothing is enforced before a commit.** `.claude/settings.json` has no hooks. `core.hooksPath`
   points at the generated `frontend/.husky/_`, so developers who never ran `npm install` have no
   hooks at all, and the backend Husky.Net hook never runs (it also sources a `_/husky.sh` that does
   not exist). Test coverage is thin: 7 backend integration test files and 31 frontend specs.

## Goals

- Every developer's Claude writes code the same way, following the existing architecture and
  conventions: layered architecture, no duplication, SRP and LSP.
- No commit breaks an existing test.
- Every ticket gets QA test cases; API cases are verified over real HTTP before the PR opens.
- Important scenarios get integration tests, and those tests are pushed with the PR.
- All of the above is validated before **every** commit, by Claude or by a human.
- When the PR opens, QA (Aqil) is tagged on the ticket with the cases and the verification results.
- The reason behind the code is recoverable: `git blame` → commit → PR → ticket.
- Commit messages and PR descriptions never mention Claude.

## Non-goals

- Refactoring existing code that breaks the new rules. The rules apply to new and changed code.
- Changing anything the team shares: no commits to the repo, no CI workflow, no required checks, no
  change to how PRs are opened or reviewed today.
- Running an AI model in CI. There is no Anthropic API key, and a subscription token would put the
  whole team on one person's quota.
- Making enforcement tamper-proof. Everything here is local, so a developer who wants to bypass it
  can. The point is to make the right path the easy one, not to police anyone.

## Decisions

| Topic | Decision |
|---|---|
| Delivery | A bundle installed inside each developer's clone at `.claude/guardrails`; nothing is committed to the product repo |
| Distribution | Its own private repo, `faakhir-habib/thportal-guardrails`, cloned into that path; the owner invites collaborators |
| Rollout | Stage 1 owner's pilot → Stage 2 hand it to individual developers. Committing it to the repo and adding CI stays off the table until the user decides otherwise |
| Rules | One file per side; `CLAUDE.md`, the reviewer and the PR review skill all read it |
| Commit gate | Hard block on every commit, Claude or human |
| QA cases per commit | In-scope cases must pass; others may be `pending`; `/ship` requires all API cases passed |
| Integration tests | Mandatory for important scenarios, pushed with the PR |
| Review strictness | Every PR review skill check blocks, plus DRY/SRP/LSP and audit logging; env vars are informational |
| Scope | Backend only. Frontend code is never reviewed or validated; frontend files are only read to check that a changed DTO or endpoint has its callers updated |
| QA handoff | Aqil is tagged only when the PR opens, and nothing reaches the ticket until the developer has read the QA cases and said to post |
| PR description | Short and plain: Asana link, summary, why, verification, waivers |
| Commit messages | Conventional header, a "why" body, an `Asana:` trailer |
| Claude attribution | Never in commits or PRs; blocked in settings, hooks, `/ship` and CI |
| CI | None. Deferred with the rest of the repo-level work |
| Human commits | Same gate, because the hooks live in the clone; `/validate` runs through Claude Code |
| New learnings | `/learn` updates the local rules immediately and logs the lesson for the owner, who merges it into the master bundle and re-sends it |

## 1. Rules and file layout

### Files

Everything lives inside the clone but outside git's view. `.claude/` is already gitignored; the two
`CLAUDE.md` files are hidden per clone through `.git/info/exclude`, which the installer writes.

```
CLAUDE.md                                    workflow, gate, DRY/SRP/LSP, traceability, setup
backend/CLAUDE.md                            imports the backend rules
.claude/
  settings.json                              Claude Code hooks + attribution off
  agents/architecture-reviewer.md            read-only review subagent
  skills/thportal-ticket|validate|ship|learn|review/SKILL.md
  guardrails/
    rules/backend-rules.md                   the single source of backend rules
    config.json                              non-secret config (Asana GIDs, Aqil, categories, preview URLs)
    githooks/{pre-commit,prepare-commit-msg,commit-msg}
    scripts/*.mjs                            checks, stamps, secrets, Asana and GitHub calls
    install.mjs, uninstall.mjs, pack.mjs     install into a clone, remove, build the bundle to send
    VERSION, CHANGELOG.md                    so a developer can see which version they have
```

Local-only state:

```
.claude/work/<task-gid>/                     ticket.md, qa-cases.md, plan.md
.claude/guardrails/learnings-outbox.md       lessons to send back to the owner
.git/guardrails/stamps/<tree-hash>.json      validation stamps
```

The frontend is out of scope: no `frontend/CLAUDE.md`, no frontend rules, no frontend checks. The
repo's own `frontend/coding-practices.md` and husky setup are left untouched.

### `backend-rules.md`

Every rule has three parts: the rule, why it exists, and a real file in the codebase that shows it.
Before a rule is written down it is confirmed in 2–3 places in the codebase. A rule the codebase
does not follow is not enforced.

The file also names one **golden example** per layer. When Claude writes new code it follows that
example's shape:

- controller (v2)
- service
- repository
- DTOs
- EF configuration and migration
- integration test (with `Fixtures/` and `Helpers/`)

Rule catalogue:

- **Layers and dependency flow** — Controller → Service → Repository only; no business logic in
  controllers or repositories; no HTTP types in services; DI registration for new services.
- **API versioning** — new controllers under `Controllers/V2/` with a matching namespace; new
  functionality does not go onto v1 controllers.
- **Soft-delete and active-status filtering** — every new or changed read query filters
  `IsActive` / `IsDeleted` / `Discontinued` (and variants) unless the method name states that
  inactive rows are wanted. **There are no EF global query filters anywhere in the solution**
  (verified 2026-09-18: no `HasQueryFilter` in `RepositoryContext.cs` or the 62 files in
  `Repository/Configuration/`), and 21 entities carry `IsDeleted`, so every filter is manual and a
  missed one silently returns deleted rows.
- **Schema and migrations** — entity changes ship with a migration; `Up`/`Down` are inverses; no
  unrelated drift; destructive changes are called out.
- **DTOs** — no entities in controller signatures; mapping in services; suffix conventions.
- **Frontend sync** — a changed DTO or endpoint signature has every frontend caller updated. This is
  a backend rule: the reviewer reads frontend files only to find stale callers, and never judges
  frontend code quality.
- **Naming** — C# conventions, project patterns (`Get*`, `Delete*`, `*Dto`, `Is*`), and domain
  terms; checked against how the codebase already names things.
- **Audit logging** (verified 2026-09-18):
  - every create, update, delete or status change logs an activity, using a constant from
    `Service/ActivityTypes.cs` — never an inline activity-type string;
  - the modern shapes are `_systemActivityService.LogEntityAsync(ActivityTypes.X, entityId, ("Name",
    value))` for the common case (`Service/Extensions/SystemActivityExtensions.cs`) and
    `OnActivityAsync(ActivityTypes.X, info)` when the pairs are many or conditional
    (`Service/LotCriticalDatesService.cs`). `ISystemActivityService.AddActivity` is legacy — only 4
    file-system call sites use it, and new code must not;
  - updates record the old and new values of the fields that changed;
  - entities that carry `CreatedBy`/`UpdatedBy` get them set, through one shared approach rather
    than another private helper (`SetUpdateAuditFields` and `UpdateAuditMetadata` already duplicate
    each other);
  - `CreatedAt`/`LastModified` are never set by hand — `ITimeStampedModel` and
    `RepositoryContext.SaveChangesAsync` own them.
- **DRY** — before writing a helper, mapper, query or validation, search for an existing one and
  reuse it; copy-paste inside the diff is a violation.
- **SRP** — one reason to change per class and method; methods over ~40–50 lines are split.
- **LSP** — implementations honour their interface contract: no `NotImplementedException`, no
  narrowed preconditions, no surprise side effects, no type checks on the concrete type.
- **Security** — authorization on new endpoints; no secrets in code.
- **Code quality** — async all the way, `AsNoTracking()` on read-only queries, no
  `Console.WriteLine`, no new TODOs, no magic values, minimal comments.
- **Environment variables** — informational only: new variables are listed in the PR "Why" section
  so leads can add them to every environment.

### `thportal-pr-review` refactor

- The rules move out of the skill into `backend-rules.md`; the skill keeps only the procedure.
- Two modes:
  - **PR mode** — `gh pr view` / `gh pr diff`;
  - **local mode** — the staged diff, or the branch diff against `origin/staging`.
- Stale parts are fixed:
  - base branch `development` → `staging`;
  - `web_fetch` and "do not run git" → `gh` and `git`;
  - "backend only" stays as it is — the skill keeps reading frontend files for the DTO and endpoint
    sync checks, and reviews nothing else there.
- **The bundle's skill is named `thportal-review`, not `thportal-pr-review`.** Two copies of the old
  skill already sit in the clone — `backend/.claude/skills/thportal-pr-review/` (tracked) and
  `.claude/skills/thportal-pr-review/` (untracked) — and neither is ours to change. A new name means
  no shadowing and no doubt about which skill ran.

## 2. Workflow

```
/ticket <asana-url> → plan approved → code → /validate → git commit (gate) → … → /ship
```

### Branch ↔ ticket link

Each branch is linked to its ticket with `git config branch.<name>.asanaTask <gid>`. Every branch
must be linked. If no ticket exists, `/ticket` creates one in the ERP project first.

### `/ticket`

1. **Read the ticket.** Fetch the Asana task (name, notes, comments, attachment names) into
   `ticket.md`.
2. **Set up the branch.** If the current branch is not a feature branch, create one from
   `origin/staging` with no upstream, then link it to the ticket.
3. **Clear up ambiguity.** Ask the developer; never guess.
4. **Explore.** An Explore subagent finds the existing code that already solves part of the
   problem (reuse candidates) and picks the golden examples to follow.
5. **Write `qa-cases.md`.** Cases `QA-1…n`, each with:
   - type — `API` (Claude verifies) or `UI` (QA verifies);
   - preconditions, steps, expected result and test data;
   - for mutations, the expected `SystemActivity` row;
   - status (`pending` / `passed` / `failed`) and the commit scope it belongs to.
6. **Write `plan.md`.** It holds:
   - each acceptance criterion mapped to layers and files;
   - reuse decisions;
   - decisions with the rejected alternatives and why;
   - the important scenarios that need integration tests.
7. **Wait for approval.** Coding starts only after the developer approves the plan and the QA cases.
   They are reviewed twice — here, and again in `/ship` before anything is posted to the ticket.

**Important scenarios**, which need an integration test:

- money or calculations (tax, discounts, dates);
- auth, roles and data scope;
- state or lifecycle transitions;
- external integrations and webhooks;
- delete, soft-delete or bulk updates;
- **every bug fix**, with a regression test that reproduces the bug.

Plain CRUD without business rules, UI text and config changes are exempt.

### `/validate`

Runs on the staged index. Steps:

1. **Precondition.** Staged files have no unstaged edits; otherwise what is tested differs from what
   is committed.
2. **Format and restage.** Run `dotnet format` on staged `.cs` files, then restage. The tree hash is
   taken after this step, so the hook never changes it.
3. **Deterministic checks:** `dotnet format --verify-no-changes`, the solution build, and the full
   `FileManager.IntegrationTests` suite (needs Docker).
4. **Test requirement.** If the plan or the diff hits an important scenario and the diff has no new
   or updated test in `FileManager.IntegrationTests`, validation fails.
5. **Review.** `architecture-reviewer` runs in a fresh, read-only context on the staged diff with
   `rules/backend-rules.md`. Findings are either `violation` (blocks) or
   `suggestion` (reported only). A developer who believes a finding is wrong may waive it with a
   written reason; waivers are stored in the stamp and shown in the PR.
6. **QA verification.**
   - Start the API locally and log in for a JWT.
   - Run every in-scope `API` case over HTTP with real routes and query strings, including the
     `SystemActivity` check for mutations.
   - Database: the branch database `erp-v1.0-<branch>` (via `task db:conn`) if the branch has been
     pushed, otherwise the developer's local dev database. The evidence records which one was used.
   - In-scope cases must pass; out-of-scope cases stay `pending`.
7. **Stamp.** `.claude/guardrails/scripts` writes `.git/guardrails/stamps/<tree>.json`:

```json
{
  "tree": "<git write-tree>",
  "branch": "feat/x",
  "asanaTask": "1218492088693885",
  "rulesHash": "<sha256 of backend-rules.md>",
  "createdAt": "2026-09-17T10:00:00Z",
  "kind": "full",
  "checks": { "format": "pass", "build": "pass", "integrationTests": "pass" },
  "testsRequired": { "required": true, "present": ["HomeRoomScopeTests"] },
  "review": { "violations": [], "suggestions": [], "waivers": [] },
  "qa": { "QA-1": { "status": "passed", "db": "erp-v1.0-feat-x", "evidence": "POST /api/v2/... 201" } },
  "result": "pass"
}
```

A stamp is valid while its `rulesHash` matches the current rules files. A commit message edit does
not change the tree, so it does not trigger revalidation.

### `/ship`

Running `/ship` is the developer's explicit go-ahead to push. Claude never pushes otherwise.

1. **Preconditions.**
   - The working tree is clean.
   - HEAD's tree has a `pass` stamp.
   - Every `API` QA case is `passed`.
2. **Branch review.** Run `thportal-pr-review` in local mode on the full branch diff against
   `origin/staging`. It catches cross-commit problems, such as a DTO changed in one commit with the
   frontend never updated. Any violation stops the ship.
3. **Push and open the PR.** Push, then run `gh pr create --base staging`. Before creating the PR,
   scan the body for Claude attribution.
4. **Preview verification.** Wait (with a timeout) for `https://pr-<N>-api.dev.thportal.ca`, then
   rerun the `API` cases there. If the preview does not come up, continue with the local results and
   say so.
5. **Asana — only after the developer approves the text.** Nothing is posted automatically.

   The ERP board already carries the fields this step would otherwise bury in a comment (confirmed on
   2026-09-18 by reading a real ticket): **Branch name**, **Preview Url**, **Backend Dev**,
   **Backend Status**, plus Module, Priority and Urgency. `/ship` fills `Branch name` and
   `Preview Url` as custom fields as well as naming them in the comment, so the board stays sortable
   and QA does not have to open a comment thread to find the preview.

   - Print the exact comment that would go to the ticket: the branch, the preview URL
     `https://pr-<N>.dev.thportal.ca`, the PR link, the QA case table, the verification results, any
     waivers, and the mention of Aqil.
   - Stop and wait. The developer reads the QA cases, edits or removes any that are wrong, adds what
     is missing, and says to post.
   - Only then post the comment and move the task to the **QA** section.

   **Why:** the QA cases are what Aqil tests from, and a wrong or half-understood case wastes a QA
   cycle and makes the developer look careless. The person who wrote the code is the one who knows
   whether a case matches what was actually built.
6. **On an existing PR** (later pushes), `/ship` pushes and prints a short Asana update, again waiting
   for the go-ahead before posting.

Nothing is written to GitHub beyond what a developer does by hand today: a branch, a PR and its
description. No status checks, no bot comments, no labels.

### PR description

Kept to about 15 lines / 150 words. No file lists, no line-by-line narration, nothing the code
already makes obvious. The detail lives on the ticket, where QA works.

```markdown
**Asana:** <ticket link>

## Summary
<1–2 lines: what changed, in business terms>

## Why
- <only decisions the code does not explain, one line each, at most 3; new env vars go here>

## Verification
- Integration tests: `HomeRoomScopeTests` (new) ✅ · existing suite ✅
- QA: 6/6 API cases passed on preview; UI cases → QA (details on the ticket)

## Waivers        (only when there are any)
- <finding> — <reason, one line>
```

### Commit messages

```
feat(deals): show swing field on lot details

The lot form already stored Swing; the details pages never read it.

Asana: https://app.asana.com/1/1209040875779194/project/1209042358568959/task/<gid>
```

The header follows Conventional Commits, the body gives 1–3 lines of *why*, and the trailer is added
automatically. Nothing mentions Claude.

## 3. Enforcement

### Git hooks (`.claude/guardrails/githooks/`)

`core.hooksPath` points at the bundle's hooks directory. It is set by the installer and re-checked by
the Claude Code `SessionStart` hook.

**The gate only applies to commits that touch `backend/`.** A commit with no backend file passes
straight through to the repo's own husky behaviour, so frontend work is exactly as it is today.

**Husky will fight the hooks path.** The frontend `prepare` script runs on every `npm install` and
resets `core.hooksPath` to `frontend/.husky/_`. That file is tracked and must not change, so the
bundle takes the conflict on its own side:

- `SessionStart` puts the hooks path back at the start of every Claude Code session;
- while the path is ours, the hooks delegate the frontend's share of the work back to the repo:
  `pre-commit` runs `npx lint-staged` for staged frontend files, and `commit-msg` runs the repo's
  commitlint config. Nothing the team relies on today is lost.

**`pre-commit`**

- **Merge commit** (`MERGE_HEAD` exists): no stamp required. The merged code has already passed the
  gate, and `/ship` still requires a stamp for HEAD's full tree, which covers conflict resolutions.
- **A commit with no `backend/` file:** `lint-staged` runs and the commit goes through. No stamp, no
  ticket link, no message rules — frontend-only work behaves exactly as it does today.
- **Any commit that touches `backend/`**, in this order:
  1. `lint-staged` runs first for staged frontend files, because it can rewrite and restage them;
  2. the tree hash is computed after that, so it matches what will actually be committed;
  3. the branch must be linked to a ticket;
  4. `.git/guardrails/stamps/<tree>.json` must exist with `result: pass` and a current `rulesHash`.
  - Otherwise the commit is blocked with: *run `/validate` in Claude Code*. If `lint-staged` changed
    something, the hash will not match the stamp — which is correct, because the content changed.
- Beyond `lint-staged` the hook reruns nothing, so it finishes almost instantly.

**`prepare-commit-msg`** — appends `Asana: <url>` from the branch link if it is missing.

**`commit-msg`** (merge commits exempt) — rejects a message that:

- lacks a Conventional Commits header;
- has no body line besides trailers;
- has a missing `Asana:` trailer, or one that points at a different ticket than the branch link;
- contains any Claude attribution:
  - `Co-Authored-By` naming Claude or Anthropic;
  - `noreply@anthropic.com`;
  - "Generated with Claude" or "Claude Code";
  - the 🤖 generated line.

### Claude Code settings (`.claude/settings.json`)

- **Attribution off:**

  ```json
  { "attribution": { "commit": "", "pr": "" } }
  ```

- **`PreToolUse` on Bash — denies:**
  - `--no-verify` / `-n` on commit, and `HUSKY=0`;
  - changing `core.hooksPath`;
  - `git push --force` (`--force-with-lease` is allowed on the current feature branch only);
  - pushing to `staging` or `main`.
- **`PreToolUse` on Write/Edit/Bash** — denies writes to `.git/guardrails/`; only the validate
  script writes stamps.
- **`SessionStart`:**
  - fixes `core.hooksPath`;
  - prunes stamps older than 30 days;
  - adds the branch's ticket and QA status (how many cases are pending) to the context.

### Limits

A developer can still run `git commit --no-verify`, hand-write a stamp, or simply not install the
bundle. Nothing here is enforced on the server, and that is accepted: the bundle is opt-in, and its
value is that the easy path is also the correct one.

## 4. Continuous learning (`/learn`)

A problem found once must never come back. Every skill reads the rules from one place, so writing a
lesson into `rules/backend-rules.md` changes how every skill behaves. A lesson about *procedure*
updates the relevant skill file instead. Frontend lessons are out of scope, and the repo's
`frontend/coding-practices.md` is never edited.

### Where lessons come from

| Source | Where it is picked up |
|---|---|
| A lead's PR review comment that the reviewer missed | `/ship` on an existing PR reads review comments with `gh` |
| A QA failure (Aqil's comment or a bug ticket) | `/ticket` on a bug asks which rule should have caught it |
| A reviewer false positive (a waiver) | End of `/validate`: the rule is wrong or unclear, so fix it |
| A developer correction during a session | `CLAUDE.md` tells Claude to run `/learn` straight away |
| A new shared helper or pattern the team adopts | Golden example or rule update |

### Rules for lessons

1. **General, not ticket-specific.** "Every money field …", not "the deal's X field …".
2. **Confirmed in the codebase.** The pattern is checked in 2–3 places, like any other rule.
3. **No duplicates.** A close existing rule is updated rather than a new one added.
4. **Traceable.** Each rule carries its reason, an example and a link to the PR or ticket that taught
   it. A changelog at the end of the rules file records the date and the source.
5. **Tested.** Each new rule adds a case to the reviewer's planted-bad-diff check (section 9), so
   "never again" is proven rather than assumed.
6. **Conflicts go to a human.** If a lesson contradicts an existing rule, Claude asks the developer
   instead of choosing.

Lessons go into the bundle's rules files, never into a developer's personal Claude memory, which
nobody else sees.

### Propagation (manual, by design)

- `/learn` edits `rules/backend-rules.md` in the guardrails clone immediately, so the developer's
  very next validation uses the new rule.
- The guardrails clone is a git repo of its own, so the lesson is committed there —
  `chore(rules): …`, with the PR or ticket that taught it in the body — and pushed on a branch for
  the owner to merge. The product repo is not touched by any of this.
- The owner merges, bumps `VERSION` and records the change in `CHANGELOG.md`. Everyone else picks it
  up with `git -C .claude/guardrails pull`.
- A developer without push access to the bundle repo falls back to
  `.claude/guardrails/learnings-outbox.md` and sends the entry to the owner.
- A rules change alters `rulesHash`, so existing stamps become invalid and code is revalidated
  against the new rule.

## 5. Distribution

The bundle lives in its own private repo, **`faakhir-habib/thportal-guardrails`**, and is cloned
**inside** the product clone at `.claude/guardrails` — a path the product repo already gitignores.
Nothing is added to the product repo.

```bash
cd /path/to/file-management-server
git clone https://github.com/faakhir-habib/thportal-guardrails.git .claude/guardrails
node .claude/guardrails/install.mjs
```

- **Access:** the owner invites a developer as a collaborator when they are ready to use it.
- **Updates:** `git -C .claude/guardrails pull`, then `install.mjs` again to re-sync the copied files.
- **Offline fallback:** `node .claude/guardrails/pack.mjs` writes `guardrails-<version>.zip` (bundle
  files only — never `work/`, stamps, tokens or the outbox) for a developer without repo access.
- **Install:** `node .claude/guardrails/install.mjs`, which:
  - checks the prerequisites — `git`, Node, Docker, `gh`, and a reachable Asana token and GitHub PAT;
  - sets `core.hooksPath` to the bundle's hooks;
  - adds the `CLAUDE.md` files to `.git/info/exclude` so they never show up in `git status`;
  - merges the hooks and the attribution setting into an existing `.claude/settings.json` rather than
    overwriting it;
  - prints the version and what to do next.
- **Remove it:** `node .claude/guardrails/uninstall.mjs` restores the previous hooks path, removes
  the exclude entries and the bundle's own files, and leaves the repo exactly as it was.

Two developers can sit on different commits of the bundle, which is acceptable at this scale — a
`git pull` brings them level.

**The skills, agents and `CLAUDE.md` files are copied** out of `.claude/guardrails/` into
`.claude/skills/`, `.claude/agents/` and the two `CLAUDE.md` paths, because Claude Code only loads
them from there. `githooks/`, `rules/` and `scripts/` are used straight from the clone, so a `pull`
updates them with no copy step. `install.mjs` is what re-syncs the copied files, and it refuses to
overwrite a file the developer has edited locally without saying so.

## 6. Rollout

Each stage gets its own implementation plan, written only after the previous stage meets its exit
criteria.

### Stage 1 — the owner's pilot (this machine)

- Only new files are created, all inside `.claude/` or listed in `.git/info/exclude`. They stay out
  of `git status` and survive branch switches.
- No tracked file changes: `package.json`, `.gitignore`, the husky folders and the tracked PR review
  skill all stay as they are.
- The pilot runs on three real backend tickets chosen by the user, ideally including one bug fix and
  one ticket that changes a DTO or an endpoint, so the frontend-sync check is exercised.

**Exit criteria:**

- all three tickets reach `/ship`;
- no unresolved false-positive blocks;
- one validation takes ≤10 minutes;
- `install.mjs` and `uninstall.mjs` are proven on a second clone.

### Stage 2 — hand it to individual developers

- The owner sends the bundle to one developer first and walks them through one ticket.
- Their feedback and outbox entries go into the master bundle.
- More developers get it one at a time, as the owner decides.
- Committing any of this to the repo, and adding CI, stays out of scope until the user asks for it.

## 7. Configuration and setup

**`.claude/guardrails/config.json`** (no secrets):

- the Asana workspace (`1209040875779194`), ERP project (`1209042358568959`) and QA section
  (`1209042456419718`) GIDs;
- Aqil — Syed Aqil Shah, user GID `1213187391484366`;
- the Bitwarden project name (`Work`) and secret keys (`ZAYAN_ASANA_TOKEN`, `ZAYAN_GITHUB_PAT`);
- the preview URL patterns;
- the important-scenario categories.

**Credentials.** `.claude/guardrails/scripts/secrets.mjs` resolves each token in this order and stops at the
first hit:

1. **Bitwarden Secrets Manager**, project `Work`, key `ZAYAN_ASANA_TOKEN` / `ZAYAN_GITHUB_PAT`,
   looked up by key name, not by secret ID.
   - The `bws` access token comes from `BWS_ACCESS_TOKEN`.
   - On this machine it comes from the DPAPI-encrypted file
     `C:\Users\Administrator\.local\bws-token-personal.dpapi`, decrypted through PowerShell.
2. **A system environment variable** with the same name (`ZAYAN_ASANA_TOKEN`, `ZAYAN_GITHUB_PAT`).
3. **Neither found:** stop with the setup instructions.

The bundle repo itself is a separate case: it lives on the personal account `faakhir-habib`, so
pushing to it uses `FAAKHIR_GITHUB_PAT` from the Bitwarden **Pepflow.io** project (read with
`bws-token-pepflow-shared.dpapi`), not the work `ZAYAN_GITHUB_PAT`. Git Credential Manager may
already hold a working credential for it, in which case a plain `git push` is enough.

Handling rules:

- Tokens live only in memory. They are passed to child processes as environment variables (the
  GitHub PAT as `GH_TOKEN` for `gh` and `git push`) and are never printed, logged, written to disk or
  placed in a stamp.
- On a 401, the message names the key to rotate in Bitwarden.

**One-time setup per developer** (listed at the top of the root `CLAUDE.md`):

- Bitwarden access to the `Work` project (`bws` on `PATH` + `BWS_ACCESS_TOKEN`), or the two
  environment variables above;
- Docker Desktop;
- `gh` installed;
- running `install.mjs` once, which sets the hooks path.

## 8. Error handling

| Situation | Behaviour |
|---|---|
| Docker not running | Validation fails with a clear message |
| Unstaged edits on staged files | Validation refuses to run and says which files |
| Reviewer false positive | Developer waives it with a reason; the waiver appears in the PR |
| Rules file changed | Existing stamps become invalid |
| Branch not linked to a ticket | Commit blocked; `/ticket` links or creates one |
| Preview env not up | `/ship` continues on local results and reports preview verification as pending |
| Asana call fails, or no Asana token in Bitwarden or the environment | The PR already exists. Retry once, then print the comment for manual posting. The ticket is not moved |
| No GitHub PAT in Bitwarden or the environment, or it returns 401 | `/ship` stops before pushing and names the key to fix |
| Stamps piling up | Pruned after 30 days at session start |
| `npm install` resets the hooks path to husky | `SessionStart` puts it back; `install.mjs` can be re-run at any time |
| A repo change collides with the bundle (a new tracked `CLAUDE.md`, or husky changes) | The installer detects it, keeps the repo's file and reports the conflict instead of overwriting |

## 9. Verifying the guardrails

- **Hooks** are exercised in a throwaway git repo:
  - no stamp → blocked;
  - valid stamp → allowed;
  - stale `rulesHash` → blocked;
  - merge commit → allowed;
  - attribution in the message → rejected;
  - missing trailer → added;
  - wrong ticket in the trailer → rejected;
  - a commit with no `backend/` file → passes through untouched, with `lint-staged` still running.
- **Claude Code hooks:** `--no-verify`, force push and writes under `.git/guardrails/` are denied.
- **Reviewer** gets a planted bad diff and must catch every problem in it:
  - a controller calling a repository;
  - a read query with no `IsDeleted` filter;
  - a mutation with no activity log;
  - a new endpoint on a v1 controller;
  - a duplicated helper;
  - a 70-line method;
  - an entity returned from a controller;
  - a `Co-Authored-By: Claude` line.
- **`/learn`:**
  - a lesson that duplicates an existing rule updates that rule instead of adding one;
  - a lesson that contradicts a rule stops and asks;
  - every accepted lesson adds a planted-bad-diff case, and the reviewer catches it.
- **The full `/ticket` → `/ship` flow** is proven on the three pilot tickets.

## 10. Deferred

These are deliberately out of scope now. They only come up if the user later decides the team should
adopt this rather than individual developers:

- committing the bundle to the repo (`.gitignore`, the `prepare` script, removing the husky folders);
- CI checks on the PR — attestation, PR body and commit-message validation;
- branch protection and required checks on `staging`, which needs a repo admin;
- a team-wide agreement on Conventional Commits and the Docker requirement.
