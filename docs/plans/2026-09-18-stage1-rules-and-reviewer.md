# Guardrails Stage 1, Part 1 — Rules and Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the knowledge core of the guardrails — one verified backend rules file, a read-only
architecture reviewer that catches every planted violation, the review skill, and the `CLAUDE.md`
files that put the rules in front of Claude while it writes code.

**Architecture:** Rules live in exactly one file, `rules/backend-rules.md`, in the guardrails clone at
`C:\file-management-server\.claude\guardrails` (its own git repo, `faakhir-habib/thportal-guardrails`).
The reviewer agent, the review skill and the `CLAUDE.md` files point at that file instead of restating
it. Claude Code only loads agents, skills and `CLAUDE.md` from fixed paths, so a small sync script
copies them out of the bundle into place. The rules are proven by an eval fixture: a planted bad diff
whose every violation the reviewer must report, and a clean diff it must pass silently.

**Tech Stack:** Markdown (rules, skills, agent definitions), Claude Code agents/skills/CLAUDE.md
loading, `gh` CLI for PR mode, git, one bash sync script.

**Spec:** `C:\file-management-server\.claude\guardrails\docs\design.md` — the only copy. The former
copy under `backend/docs/superpowers/specs/` is now a pointer file.

**Out of scope for this plan** (later plans): `scripts/*.mjs`, `githooks/`, `install.mjs`/`uninstall.mjs`,
and the `/ticket`, `/validate`, `/ship`, `/learn` skills.

## Global Constraints

- **Backend only.** Frontend code is never reviewed. Frontend files are read only to find stale
  callers of a changed DTO or endpoint.
- **The product repo (`C:\file-management-server`) gets no commits and no tracked-file edits.** The
  two `CLAUDE.md` files are placed in the working tree and hidden through `.git/info/exclude`, so
  they can never be committed. Everything else lives under `.claude/`, which is already gitignored.
- **Work from the repo root.** Start Claude Code in `C:\file-management-server`, not in `backend\`.
  `CLAUDE.md` imports outside the working directory trigger an approval prompt, which a
  non-interactive `claude -p` cannot answer.
- **No Claude attribution anywhere** — not in commit messages, not in file contents. Task 1 turns the
  harness default off before any commit is made.
- **Commit identity in the guardrails repo** is already set to `faakhir-habib <faakhirhabib@gmail.com>`.
  Do not change it.
- **Commit messages** use Conventional Commits with a one-line body explaining why.
- **Minimal comments** in anything this plan produces: no comment that restates the code.
- **Every rule is verified before it is written** — at least 2 real examples, named with paths, and a
  stated severity. A rule the codebase does not follow is not written. Each task that writes rules
  ends with a verification step; do not skip it.
- **Do not push** until the final task, after the user has reviewed.

## Verified facts this plan is built on

Confirmed by reading the codebase on 2026-09-18 and re-checked by an independent pass. Use them; do
not re-derive them.

| Fact | Evidence |
|---|---|
| Controllers return `result.ToActionResult(ResponseMessages.x)` (Ardalis.Result) | `FileManager.Presentation/ResultExtensions.cs`; exactly 109 of 114 V2 controller files |
| `CoreResponseModel` is legacy | exactly 4 files: `FileSystemActivityController`, `FileSystemController`, `LookupController`, `LotController` |
| Controllers inject `IServiceManager _service` and call `_service.FooService.BarAsync(...)` | 108 of 114 V2 controllers |
| Auth attribute is `[ModuleRoleAuthorize(modules: …, roles: …)]` | 102 V2 files; `FileManager.Presentation/ActionFilters/ModuleRoleAuthorizeAttribute.cs` |
| Write actions carry `[ServiceFilter(typeof(ValidationFilterAttribute))]` | POST/PUT actions across V2 |
| Services reach data only through `IRepositoryManager` | zero occurrences of `RepositoryContext.` (with the dot) outside `Repository/`. The bare type name appears ~405 times elsewhere (DI setup, health checks, tests) — match the dot, not the name |
| Repositories extend `RepositoryBase<T>` and use `FindAll(trackChanges)` / `FindByCondition(expr, trackChanges)` | `Repository/ScenarioRepository.cs`, `Repository/TaxCategoryRepository.cs` |
| Repository classes are **not** consistently `sealed` — 9 sealed, 100 `public class`, 40 `internal class` of 149 | do not write a `sealed` rule |
| **No EF global query filters exist** (`HasQueryFilter` = 0 solution-wide); 21 entities carry `IsDeleted` | `Repository/RepositoryContext.cs` (2,779 lines) and all 62 files in `Repository/Configuration/` |
| Activity logging: `LogEntityAsync(ActivityTypes.X, entityId, ("Key", value))` for the common case; `OnActivityAsync(ActivityTypes.X, info)` for many/conditional pairs | `Service/Extensions/SystemActivityExtensions.cs`, `Service/ScenarioStepService.cs`, `Service/LotCriticalDatesService.cs` |
| `LogEntityAsync` prepends the entity id itself, using the literal `"EntityId"` — callers must not add it | `Service/Extensions/SystemActivityExtensions.cs` |
| `ISystemActivityService.AddActivity` is legacy, file-system only | 6 hits in 4 files, one of which is the implementation in `Service/SystemActivityService.cs` |
| Shared activity keys live in `AdditionalInfoKeys` at `Service/ActivityTypes.cs:509-549` (file is 549 lines); feature-specific pairs may use inline string keys | `Service/ActivityTypes.cs` |
| DTOs are `public class` with `{ get; set; }`, not records | of 323 top-level files in `Shared/DataTransferObjects/`, 285 declare `public class` and 36 declare `public record` |
| EF configurations are hand-registered — no `ApplyConfigurationsFromAssembly` anywhere | 66 `modelBuilder.ApplyConfiguration(...)` lines from `Repository/RepositoryContext.cs:1177` |
| Wiring a new feature touches 5 files | `Service.Contracts/IServiceManager.cs`, `Service/ServiceManager.cs`, `Contracts/IRepositoryManager.cs`, `Repository/RepositoryManager.cs`, `FileManager/MainProfile.cs` |
| Integration tests share one SQL Server Testcontainer via `[Collection(IntegrationTestCollection.Name)]` and authenticate with `DealApiFactory.AuthenticateClientAsync(_client)` | `FileManager.IntegrationTests/Fixtures/TestingWebApplicationFactory.cs`, `Helpers/DealApiFactory.cs` |
| There is **no** shared length-constants type in `Shared/Constants/` — DTO `[MaxLength(n)]` values are literals | `Shared/DataTransferObjects/TaxCategoryDto.cs` |

### Golden examples (the shapes new code copies)

| Layer | File | Lines |
|---|---|---|
| V2 controller | `FileManager.Presentation/Controllers/V2/TaxCategoryController.cs` | 64 |
| V2 controller, nested route | `FileManager.Presentation/Controllers/V2/LotNotesController.cs` (`[Route("api/v2/lots/{lotId:guid}/notes")]`) | 63 |
| Service | `Service/ScenarioService.cs` | 327 |
| Service (activity logging across all verbs) | `Service/ScenarioStepService.cs` | 227 |
| Repository | `Repository/ScenarioRepository.cs` | 82 |
| Repository (plain CRUD) | `Repository/TaxCategoryRepository.cs` | 57 |
| DTOs | `Shared/DataTransferObjects/TaxCategoryDto.cs` | 35 |
| DTOs (multi-DTO feature) | `Shared/DataTransferObjects/DsmScenarioDtos.cs` | 80 |
| EF configuration | `Repository/Configuration/ScenarioStepConfiguration.cs` | 39 |
| Migration | `FileManager/Migrations/20260901081818_AddBulkDownloadJobZipFileNamePrefix.cs` | 28 |
| Integration test | `FileManager.IntegrationTests/DealLifecycleE2ETests.cs` | 87 |

### Known bad examples (used by the eval fixture and quoted in rules)

| File | What is wrong |
|---|---|
| `Controllers/V2/FileSystemActivityController.cs` | legacy `CoreResponseModel`, date/sort validation read from `HttpContext.Request.Query` in the controller, injects `IMapper`, 27 usings with many unused |
| `Controllers/V2/LotController.cs` (566 lines) | bypasses `IServiceManager` by injecting feature services (`ILotDeficiencyReportService`) and infrastructure (`ITemplateRenderer`, `IPdfService`) straight into the controller |
| `Service/DealService.cs` (3,093 lines) | god service |
| `Repository/DealRepository.cs` (1,153 lines) | 2 direct `RepositoryContext.Set<...>()` calls, 19 lines referencing DTO types |
| `Shared/DataTransferObjects/DrawCodeDto.cs` | `record` + `{ get; init; }`, the minority style |
| `FileManager/Migrations/20260904113207_SeedAdminRoleForDSM.cs` | raw interpolated SQL in both directions; `Down` deletes rows it cannot prove `Up` created |
| `FileManager.IntegrationTests/LotCriticalDatesServiceTests.cs` (923 lines) | too large to imitate, and service-level rather than HTTP-level |

## File Structure

Paths are relative to `C:\file-management-server\.claude\guardrails\` unless stated otherwise.

| File | Responsibility |
|---|---|
| `scripts/sync-local.sh` | Copies the agent, the skill and the two `CLAUDE.md` files out of the bundle into the paths Claude Code reads. Superseded by `install.mjs` in Part 2 |
| `rules/backend-rules.md` | The single source of backend rules |
| `eval/bad-diff.patch` | A planted diff containing one instance of each violation class |
| `eval/clean-diff.patch` | A correct diff of comparable size, to catch false positives |
| `eval/expected.md` | The findings the reviewer must report, and the ones it must not |
| `eval/results/` | Reviewer output captured per run, for comparison |
| `agents/architecture-reviewer.md` | The read-only reviewer subagent definition |
| `skills/thportal-review/SKILL.md` | The review procedure, PR mode and local mode. Named `thportal-review` so it cannot be shadowed by the two existing `thportal-pr-review` copies |
| `claude/CLAUDE.root.md` | Copied to `C:\file-management-server\CLAUDE.md` |
| `claude/CLAUDE.backend.md` | Copied to `C:\file-management-server\backend\CLAUDE.md` |
| `VERSION`, `CHANGELOG.md` | Bundle version and what changed |

---

### Task 1: Local sync and attribution

Nothing else in this plan can be tested until Claude Code can actually load what the bundle produces,
and no commit should be made until attribution is off.

**Files:**
- Create: `C:\file-management-server\.claude\settings.json` (merge into the existing file)
- Create: `scripts/sync-local.sh`
- Create: the empty bundle directories `rules/`, `agents/`, `skills/thportal-review/`, `claude/`,
  `eval/results/`

**Interfaces:**
- Consumes: nothing.
- Produces: `bash scripts/sync-local.sh`, which copies
  `agents/architecture-reviewer.md` → `.claude/agents/`,
  `skills/thportal-review/SKILL.md` → `.claude/skills/thportal-review/`,
  `claude/CLAUDE.root.md` → `CLAUDE.md`, `claude/CLAUDE.backend.md` → `backend/CLAUDE.md`.
  Every later task calls it after changing one of those four files.

- [ ] **Step 1: Turn Claude attribution off**

The existing `C:\file-management-server\.claude\settings.json` currently holds only `enabledPlugins`.
Add the attribution block, keeping what is there:

```json
{
  "enabledPlugins": { "discord@claude-plugins-official": true },
  "attribution": { "commit": "", "pr": "" }
}
```

- [ ] **Step 2: Verify attribution is off**

```bash
cd /c/file-management-server
node -e "const s=require('./.claude/settings.json');console.log(JSON.stringify(s.attribution))"
```
Expected: `{"commit":"","pr":""}`. Restart Claude Code so the setting is picked up before any commit
in this plan is made. After the first commit, run `git -C .claude/guardrails log -1 --format=%B` and
confirm there is no `Co-Authored-By` line.

- [ ] **Step 3: Create the bundle directories**

```bash
cd /c/file-management-server/.claude/guardrails
mkdir -p rules agents skills/thportal-review claude eval/results
```

- [ ] **Step 4: Write `scripts/sync-local.sh`**

```bash
#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUNDLE="$ROOT/.claude/guardrails"

mkdir -p "$ROOT/.claude/agents" "$ROOT/.claude/skills/thportal-review"

[ -f "$BUNDLE/agents/architecture-reviewer.md" ] && \
  cp "$BUNDLE/agents/architecture-reviewer.md" "$ROOT/.claude/agents/architecture-reviewer.md"
[ -f "$BUNDLE/skills/thportal-review/SKILL.md" ] && \
  cp "$BUNDLE/skills/thportal-review/SKILL.md" "$ROOT/.claude/skills/thportal-review/SKILL.md"
[ -f "$BUNDLE/claude/CLAUDE.root.md" ] && cp "$BUNDLE/claude/CLAUDE.root.md" "$ROOT/CLAUDE.md"
[ -f "$BUNDLE/claude/CLAUDE.backend.md" ] && cp "$BUNDLE/claude/CLAUDE.backend.md" "$ROOT/backend/CLAUDE.md"

echo "synced into $ROOT"
```

- [ ] **Step 5: Run it and confirm it is harmless when the sources do not exist yet**

```bash
cd /c/file-management-server
bash .claude/guardrails/scripts/sync-local.sh
git status --short
```
Expected: it prints `synced into C:/file-management-server` and copies nothing yet. `git status` shows
no new entries (`backend/docs/SECRETS.md` may appear — that is the user's own untracked file, leave it).

- [ ] **Step 6: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add scripts/sync-local.sh
git commit -m "feat: add the local sync script

Claude Code loads agents, skills and CLAUDE.md only from fixed paths, so the bundle has to copy itself into them until the installer exists."
```

---

### Task 2: Eval fixtures

The reviewer is tested like code: the fixtures come first and define what "working" means. Every
blocking rule this plan writes must have a case here — that is the standard `/learn` will inherit.

**Files:**
- Create: `eval/bad-diff.patch`
- Create: `eval/clean-diff.patch`
- Create: `eval/expected.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the three files above. Task 6 runs the reviewer against the two patches and compares its
  JSON to `expected.md`.

- [ ] **Step 1: Write `eval/bad-diff.patch`**

A unified diff (as `git diff` prints it) for an invented "product image" feature, touching invented
files so it never collides with real code. Plant exactly these violations, one each. Copy the
surrounding shape from the golden examples so the only thing wrong is the violation itself.

| id | Violation | How to plant it |
|---|---|---|
| V1 | Controller calls a repository directly | `_repository.ProductImages.FindAll(false)` inside the action |
| V2 | New endpoint added to an existing v1 controller | add `GetProductImages` to `Controllers/ProductController.cs` |
| V3 | Brand-new controller outside `Controllers/V2/` | new file `Controllers/ProductImageController.cs` |
| V4 | Read query with no soft-delete filter | `FindByCondition(p => p.Id == id, false)` on an entity that has `IsDeleted` |
| V5 | Mutation with no activity log | `CreateProductImageAsync` saves and returns, with no `LogEntityAsync`/`OnActivityAsync` |
| V6 | Inline activity-type string | `OnActivityAsync("ProductImageUpdated", info)` instead of an `ActivityTypes` constant |
| V7 | Legacy `AddActivity` in new code | `_systemActivityService.AddActivity(args)` in the new service |
| V8 | `CreatedAt` assigned by hand | `entity.CreatedAt = DateTime.UtcNow;` in the service |
| V9 | Entity exposed in a controller signature | action takes `ProductImage` and returns `ActionResult<ProductImage>` |
| V10 | Duplicated helper | a private `FormatFileSize` in the service duplicating one added in the same diff |
| V11 | Method far over the size limit | a 70-line `UpsertProductImagesAsync` doing validate + map + save + log |
| V12 | Legacy response shape | `new CoreResponseModel().GetSuccessResponse(...)` instead of `ToActionResult` |
| V13 | New `IEntityTypeConfiguration<T>` with no `ApplyConfiguration` registration | add `Repository/Configuration/ProductImageConfiguration.cs`, leave `RepositoryContext.OnModelCreating` untouched |
| V14 | Entity change with no migration | add a property to `Entities/Models/ProductImage.cs`, no file under `FileManager/Migrations/` |
| V15 | Missing authorization | the new controller has no `[ModuleRoleAuthorize]` and no `[Authorize]` |
| V16 | Missing validation filter | the POST action has no `[ServiceFilter(typeof(ValidationFilterAttribute))]` |
| V17 | `record` + `{ get; init; }` DTO | `public record ProductImageDto { public string Url { get; init; } }` |
| V18 | Naming drift | `RemoveProductImageAsync` where the codebase uses `Delete*Async`, and a `Task` method with no `Async` suffix |
| V19 | LSP break | `ProductImageRepository.DeleteProductImage` throws `NotImplementedException` |
| V20 | Frontend sync missed | rename `ImageUrl` → `Url` in an existing DTO while a frontend file in the diff's repo still reads `imageUrl` |
| V21 | Code quality cluster | `.Result` on an async call, a `Console.WriteLine`, a magic number `86400`, and three unused usings |
| V22 | Missing integration test for a bug fix | the diff's own message says it fixes a bug and touches money math, with nothing under `FileManager.IntegrationTests/` |

Claude attribution in a commit message is deliberately not here: the reviewer sees a diff, not a
commit message, so that check belongs to the `commit-msg` hook in Part 2.

- [ ] **Step 2: Write `eval/clean-diff.patch`**

The same feature done correctly, roughly 150 lines: a v2 controller injecting `IServiceManager` with
`[ModuleRoleAuthorize(...)]` and `[ServiceFilter(typeof(ValidationFilterAttribute))]` on the write
action, returning `result.ToActionResult(ResponseMessages.productImageInserted)`; a service returning
`Result<T>` that logs with `LogEntityAsync(ActivityTypes.ProductImageCreated, image.Id, ("Name", image.Name))`;
a repository using `FindByCondition(p => p.Id == id && !p.IsDeleted, trackChanges: false)`; `class`
DTOs named `ProductImageDto` / `ProductImageCreateDto`; an EF configuration **plus** its
`ApplyConfiguration` line; a migration whose `Down` mirrors `Up`; and an integration test in the
harness style.

It must also include the five wiring edits (`IServiceManager`, `ServiceManager`, `IRepositoryManager`,
`RepositoryManager`, `MainProfile`), otherwise the reviewer is right to flag missing wiring and the
"no violations" bar is unreachable.

Include two things that look suspicious but are correct, to test judgement:
- a method named `GetAllIncludingInactiveAsync` that deliberately omits the `IsActive` filter;
- a new environment variable read through `IConfiguration` — a suggestion, never a violation.

- [ ] **Step 3: Write `eval/expected.md`**

Three sections:
1. **bad-diff** — a table of V1-V22 with the file and line each must be reported against and the
   one-line fix expected.
2. **clean-diff** — "no violations", with the explicit note that `GetAllIncludingInactiveAsync` and
   the new environment variable must not appear in `violations` (the variable may appear in
   `suggestions`).
3. **Pass criteria** — all 22 ids reported on the bad diff, **and no more than 2 findings that are not
   in the table**. A reviewer that pads its output with noise fails just as a reviewer that misses a
   violation does.

- [ ] **Step 4: Verify the fixtures parse as diffs**

```bash
cd /c/file-management-server/.claude/guardrails
git apply --stat eval/bad-diff.patch && git apply --stat eval/clean-diff.patch
```
Expected: both print a file/line summary and exit 0. `--stat` parses without touching the working
tree, which is what is wanted here — do not use `--check`, which fails on modification hunks because
the backend files do not exist inside the guardrails repo.

- [ ] **Step 5: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add eval/
git commit -m "test: add review eval fixtures

The reviewer is only useful if it catches known violations, so the planted diff defines that bar before the rules are written."
```

---

### Task 3: Rules, part 1 — architecture and layering

**Files:**
- Create: `rules/backend-rules.md` (header, Layers, Controllers, Services, Repositories, Wiring)

**Interfaces:**
- Consumes: the verified facts and golden examples above.
- Produces: `rules/backend-rules.md` with `## Layers`, `## Controllers`, `## Services`,
  `## Repositories`, `## Wiring a new feature`. Tasks 4 and 5 append; Task 6's agent and Task 7's
  skill read the whole file.

- [ ] **Step 1: Write the header and fix the rule format**

```markdown
# Backend rules — TH Portal

Every rule here was verified against the codebase. Each one states the rule, its severity, why it
matters, and a real file that follows it. Copy the golden example's shape rather than inventing one.

**Severity is mandatory on every rule.**
- `violation` — blocks the commit.
- `suggestion` — reported, does not block.

If a rule has no severity it is incomplete; fix it rather than guessing at review time.
```

Then the "Golden examples" table copied from this plan.

- [ ] **Step 2: Write `## Layers`** — severity: violation

`Controller → Service → Repository`, one direction only. Violations: a controller touching
`IRepositoryManager` or `RepositoryContext`; a service taking `HttpContext`/`IActionResult`; a
repository calling a service or referencing DTO types. Evidence: `RepositoryContext.` (with the dot)
appears nowhere outside `Repository/`; `Repository/DealRepository.cs` is the counter-example, with 2
direct `RepositoryContext.Set<...>()` calls and 19 DTO-referencing lines.

- [ ] **Step 3: Write `## Controllers`** — golden example `Controllers/V2/TaxCategoryController.cs`

- New controllers live in `Controllers/V2/` with a matching `.V2` namespace — violation.
- New functionality does not get added to a v1 controller; extending an existing v1 feature is the
  only exception, and it must be deliberate — violation.
- Route `api/v2/[controller]` with typed constraints (`{id:guid}`); nested resources follow
  `api/v2/lots/{lotId:guid}/notes` (`LotNotesController.cs`) — violation.
- Inject `IServiceManager` only, then `_service.FooService.BarAsync(...)`. Injecting feature services
  or infrastructure directly is the `LotController.cs` mistake — violation.
- Return `result.ToActionResult(ResponseMessages.x)`. Never construct `ApiResponse` by hand; never use
  `CoreResponseModel`, which survives in exactly 4 legacy files — violation.
- No business logic, no validation logic, no `IMapper` in a controller — the counter-example is
  `FileSystemActivityController.cs` — violation.
- An action body over ~30 lines means logic has leaked out of the service — suggestion.

- [ ] **Step 4: Write `## Services`** — golden examples `Service/ScenarioService.cs`, `Service/ScenarioStepService.cs`

- Constructor DI only: `IRepositoryManager`, `IMapper`, `ILoggedInUserService`, `ISystemActivityService`
  and sibling services — violation.
- Every public method returns `Result<T>`, with `NotFound` / `Invalid(new ValidationError(ResponseMessages.x))`
  guards rather than exceptions for expected failures — violation.
- Mapping to DTOs happens here, not in controllers or repositories — violation.
- `_repository.SaveAsync()` commits, then the activity log is written, then the DTO is re-read —
  violation.
- A service past ~800 lines should be split; `Service/DealService.cs` (3,093 lines) is what happens
  when nobody does — suggestion.

- [ ] **Step 5: Write `## Repositories`** — golden examples `Repository/ScenarioRepository.cs`, `Repository/TaxCategoryRepository.cs`

- `class X : RepositoryBase<TEntity>, IXRepository`; the constructor takes `RepositoryContext` and
  passes it to the base. Do not require `sealed` — only 9 of 149 repositories are sealed, and
  `TaxCategoryRepository` is `internal class` — violation for the base class, no rule on `sealed`.
- Reads go through `FindAll(trackChanges)` / `FindByCondition(expr, trackChanges)` with `trackChanges`
  stated explicitly; read-only queries pass `false` — violation.
- Writes are one-line delegations to `Create` / `Update` / `Delete`; the service calls `SaveAsync` —
  violation.
- Shared `Include`/`AsSplitQuery` graphs are factored into private `IQueryable<T>` helpers — suggestion.
- Never reach into `RepositoryContext.Set<T>()` or a `DbSet` property, and never reference a DTO type
  — violation.

- [ ] **Step 6: Write `## Wiring a new feature`** — severity: violation

The five files that must all change, in order: `Service.Contracts/IServiceManager.cs` (property) →
`Service/ServiceManager.cs` (`Lazy<IFooService>` field, property, constructor initializer) →
`Contracts/IRepositoryManager.cs` (property) → `Repository/RepositoryManager.cs` (mirror) →
`FileManager/MainProfile.cs` (`CreateMap<Foo, FooDto>()`). Note that per-service `AddScoped` in
`FileManager/Extensions/ServiceExtensions.cs` is only for infrastructure and background-activated
services, and that a missing `MainProfile` map fails at runtime, not at compile time.

- [ ] **Step 7: Verify every claim in this task**

```bash
cd /c/file-management-server/backend
sed -n '1,64p' FileManager.Presentation/Controllers/V2/TaxCategoryController.cs
grep -rl "ToActionResult" FileManager.Presentation/Controllers/V2/ | wc -l
grep -rl "CoreResponseModel" FileManager.Presentation/Controllers/V2/ | wc -l
grep -rl "IServiceManager" FileManager.Presentation/Controllers/V2/ | wc -l
grep -rn "RepositoryContext\." --include=*.cs Service Contracts Shared | wc -l
```
Expected: the controller matches the rule text; `109`; `4`; `108`; `0`. If a number is far off, the
codebase wins — fix the rule before committing.

- [ ] **Step 8: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add rules/backend-rules.md
git commit -m "docs(rules): add layering, controller, service and repository rules

Each rule names a golden example and a severity so new code copies a shape that already exists and the reviewer never has to guess whether a finding blocks."
```

---

### Task 4: Rules, part 2 — data correctness

**Files:**
- Modify: `rules/backend-rules.md` (append `## Soft delete and active status`, `## Audit logging`,
  `## EF configuration and migrations`, `## DTOs`, `## Frontend sync`)

**Interfaces:**
- Consumes: `rules/backend-rules.md` from Task 3.
- Produces: the five sections above.

- [ ] **Step 1: Write `## Soft delete and active status`** — severity: violation

- Every new or changed read query filters the status flags the entity carries (`IsActive`,
  `IsDeleted`, `Discontinued` and variants).
- **There are no EF global query filters in this solution** — `HasQueryFilter` appears nowhere. Every
  filter is manual, and 21 entities carry `IsDeleted`, so a missed filter silently returns deleted rows.
- The shape: `FindByCondition(l => l.Id == lotId && l.IsDeleted == false, trackChanges)` —
  `Repository/LotRepository.cs` does this in 17 places.
- Omitting the filter is correct only when the method name says so (`GetAllIncludingInactiveAsync`,
  `GetByIdForRestoreAsync`, or an explicit parameter as `Repository/ScenarioRepository.cs:60` does
  with `FindByCondition(s => includeInactive || s.IsActive, trackChanges: false)`). Do not flag those.

- [ ] **Step 2: Write `## Audit logging`** — severity: violation

- Every create, update, delete or status change writes an activity.
- Common case: `await _systemActivityService.LogEntityAsync(ActivityTypes.DsmScenarioCreated, scenario.Id, ("Name", scenario.Name));`
  The extension prepends the entity id itself using the literal `"EntityId"`, so callers must not add
  an entity-id pair — see `Service/Extensions/SystemActivityExtensions.cs` and `Service/ScenarioStepService.cs`.
- Many or conditional pairs: build a `List<KeyValuePair<string, string>>` starting with
  `AdditionalInfoKeys.ENTITY_ID` and call `OnActivityAsync(ActivityTypes.X, info)` —
  `Service/LotCriticalDatesService.cs`.
- The activity type is always a constant in `Service/ActivityTypes.cs`; add a new one rather than
  passing a string literal.
- Shared keys come from `AdditionalInfoKeys` (`Service/ActivityTypes.cs:509-549`); feature-specific
  pairs may use inline keys.
- Updates record the old and new values of the fields that changed.
- `ISystemActivityService.AddActivity` is legacy — 4 file-system call sites — and must not appear in
  new code.
- Entities carrying `CreatedBy`/`UpdatedBy` get them set. `CreatedAt`/`LastModified` are set by
  `RepositoryContext.SaveChangesAsync` through `ITimeStampedModel` and must never be assigned by hand.

- [ ] **Step 3: Write `## EF configuration and migrations`**

- An entity change ships with a migration in the same PR — violation.
- A new `IEntityTypeConfiguration<T>` must be registered by hand with
  `modelBuilder.ApplyConfiguration(new XConfiguration());` in `RepositoryContext.OnModelCreating`
  (from line ~1177). There is no `ApplyConfigurationsFromAssembly`, so a forgotten line means the
  configuration silently does nothing — violation.
- Configuration order follows `Repository/Configuration/ScenarioStepConfiguration.cs`: `HasKey` →
  `Property(...).IsRequired().HasMaxLength(n)` → relationships with explicit `OnDelete` → `HasIndex`
  named `IX_<Entity>_<Cols>` → audit FKs with `DeleteBehavior.Restrict` — suggestion.
- `Up` and `Down` are exact inverses, and the migration contains only this change — violation.
- Destructive changes — dropped columns, renames, type narrowing, data backfills — are called out
  explicitly in the PR description so a reviewer sees the impact — violation.
- Avoid raw interpolated SQL for data changes; the counter-example is
  `Migrations/20260904113207_SeedAdminRoleForDSM.cs`, whose `Down` deletes rows it cannot prove `Up`
  created — suggestion.
- Golden example: `Migrations/20260901081818_AddBulkDownloadJobZipFileNamePrefix.cs`.

- [ ] **Step 4: Write `## DTOs`** — golden example `Shared/DataTransferObjects/TaxCategoryDto.cs`

- Controllers never accept or return an entity — violation.
- DTOs are `public class` with `{ get; set; }`; `record` + `{ get; init; }` is the minority style and
  is not used in new code (counter-example `DrawCodeDto.cs`) — violation.
- Non-nullable strings are initialized `= string.Empty`; optional ones are `?` — violation.
- DataAnnotations (`[Required(ErrorMessage = …)]`, `[MaxLength(n, ErrorMessage = …)]`) go on write
  DTOs only. There is no shared length-constants type, so keep `n` in step with the `HasMaxLength(n)`
  in the entity's EF configuration — violation for the annotation, suggestion for the mismatch.
- Naming: `FooDto` (read), `FooCreateDto`, `FooUpdateDto`; a feature's DTOs share one file, as in
  `DsmScenarioDtos.cs` — violation.

- [ ] **Step 5: Write `## Frontend sync`** — severity: violation

Its own section, because it is triggered by controller changes as well as DTO changes.

- When an existing DTO changes (property renamed, removed, or retyped) **or an endpoint signature
  changes** (route, verb, path/query parameters, `[FromBody]` type, return shape, authorization), every
  frontend caller must be updated in the same PR.
- The reviewer searches `frontend/` for the old property name in both casings and for the old URL
  fragment, including `*.component.html` templates, where nothing would catch the typo.
- Backend compiles, frontend breaks at runtime: on PR #2312 the Angular services asked for
  `model-elevation-products` while the controller routed on `modelelevationproducts`, and
  `catchError` swallowed the 404 into an empty dropdown.
- The reviewer reads frontend files for this check and for nothing else. It never comments on frontend
  code quality.

- [ ] **Step 6: Verify the claims in this task**

```bash
cd /c/file-management-server/backend
grep -rn "LogEntityAsync" --include=*.cs Service | head -5
grep -rln "AddActivity(" --include=*.cs Service | wc -l
grep -rn "HasQueryFilter" --include=*.cs . | wc -l
grep -c "IsDeleted == false" Repository/LotRepository.cs
sed -n '60p' Repository/ScenarioRepository.cs
grep -rl "public class" Shared/DataTransferObjects/*.cs | wc -l
```
Expected (all confirmed on 2026-09-18): `LogEntityAsync` appears in current services; `4`; `0`; `17`;
the `includeInactive || s.IsActive` line; `285`. Correct any rule whose number does not hold.

- [ ] **Step 7: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add rules/backend-rules.md
git commit -m "docs(rules): add soft-delete, audit logging, EF, DTO and frontend-sync rules

Records that this solution has no global query filters, so every soft-delete filter is manual and a missed one silently returns deleted rows."
```

---

### Task 5: Rules, part 3 — craft, security, tests

**Files:**
- Modify: `rules/backend-rules.md` (append `## Naming`, `## DRY, SRP, LSP`, `## Security`,
  `## Code quality`, `## Tests`, `## Changelog`)

**Interfaces:**
- Consumes: `rules/backend-rules.md` from Tasks 3-4.
- Produces: the finished rules file, read by Task 6's agent and imported by Task 8's `CLAUDE.md`.

- [ ] **Step 1: Write `## Naming`**

C# conventions (PascalCase members, camelCase locals, `Async` suffix on every `Task`-returning method,
`I` prefix on interfaces) — violation. Project patterns: repository methods `GetAll<X>Async` /
`Get<X>ByIdAsync` / `Create<X>` / `Update<X>` / `Delete<X>`; services all-async; `Delete*` not
`Remove*`; `Get*` not `Fetch*`/`Retrieve*`; booleans `Is*`/`Has*`/`Can*`; `<Entity>Id` beside
`<Entity>` navigation — violation when the codebase is consistent, suggestion when it is split.
State the verification rule: count both forms with `grep -rl … | wc -l` before flagging.

- [ ] **Step 2: Write `## DRY, SRP, LSP`**

- **DRY** — before writing a helper, mapper, query or validation, search for an existing one and reuse
  it; duplicated logic inside the diff is a violation. The real case in this codebase:
  `SetUpdateAuditFields` (`Service/ModelElevationProductsService.cs:568`) and `UpdateAuditMetadata`
  (`Service/ScheduleService.cs:1079`) do the same job twice.
- **SRP** — one reason to change per class and method; a method over ~40-50 lines is split into
  validate / map / persist / log — violation.
- **LSP** — an implementation honours its interface contract: no `NotImplementedException`, no
  narrowed preconditions, no surprise side effects, no type checks on the concrete type — violation.

- [ ] **Step 3: Write `## Security`** — severity: violation

- Every new endpoint carries `[ModuleRoleAuthorize(modules: …, roles: …)]` (102 of the V2 controllers
  do) unless it is deliberately public, and then the diff says why.
- Write actions carry `[ServiceFilter(typeof(ValidationFilterAttribute))]`.
- Narrowing or widening an existing endpoint's roles is called out in the PR description, because the
  frontend may need to change with it.
- No secrets in code: no connection strings, keys, passwords or tokens — they belong in configuration.

- [ ] **Step 4: Write `## Code quality`**

`async` all the way (`ToListAsync`; never `.Result` or `.Wait()`) — violation. `AsNoTracking()` or
`trackChanges: false` on read-only queries — violation. No `Console.WriteLine` — violation. No new
TODOs, no magic values, no unused usings, minimal comments — suggestion. New environment variables are
a suggestion, but must be listed in the PR's "Why" so every environment gets them.

- [ ] **Step 5: Write `## Tests`** — severity: violation

- An integration test is mandatory when the change touches money or calculations, auth/roles/data
  scope, state or lifecycle transitions, external integrations or webhooks, delete/soft-delete/bulk
  updates — and for every bug fix, as a regression test that reproduces the bug.
- Plain CRUD with no business rule, config and text changes are exempt.
- Tests live in `FileManager.IntegrationTests`, carry `[Collection(IntegrationTestCollection.Name)]`,
  take `TestingWebApplicationFactory<Program>` in the constructor, authenticate with
  `DealApiFactory.AuthenticateClientAsync(_client)` and drive real HTTP endpoints. Golden example:
  `DealLifecycleE2ETests.cs`. Reuse `Fixtures/DealDomainSeeder.cs` and `Constants/TestConstants` rather
  than seeding by hand.
- A mutation's test also asserts the `SystemActivity` row the change is supposed to write.
- Do not imitate `LotCriticalDatesServiceTests.cs` (923 lines) — too large, and service-level.

- [ ] **Step 6: Write `## Changelog`**

A table with columns `Date | Rule | Why it was added | Source (PR/ticket) | Eval case`. The last column
is what makes "never again" checkable: every rule added later by `/learn` names the fixture id that
proves it. Seed it with one row: this file was created from the design on 2026-09-18, eval cases
V1-V22.

- [ ] **Step 7: Verify this task's claims**

```bash
cd /c/file-management-server/backend
grep -rl "Remove.*Async" --include=*.cs Service | wc -l
grep -rl "Delete.*Async" --include=*.cs Service | wc -l
grep -rln "Fetch\|Retrieve" --include=*.cs Service | wc -l
grep -n "SetUpdateAuditFields" Service/ModelElevationProductsService.cs | head -2
grep -n "UpdateAuditMetadata" Service/ScheduleService.cs | head -2
awk 'END {print NR}' FileManager.IntegrationTests/LotCriticalDatesServiceTests.cs
```
Expected: `Delete*` clearly dominates `Remove*`; `Fetch`/`Retrieve` are rare; both duplicate helpers
exist at the stated lines; `923`. Any threshold you cannot evidence (the ~40-50 line and ~800 line
figures) is written as a suggestion, not a violation.

- [ ] **Step 8: Read the whole file once and de-duplicate**

```bash
cd /c/file-management-server/.claude/guardrails
grep -n "^## " rules/backend-rules.md
grep -c "violation\|suggestion" rules/backend-rules.md
```
Expected: sections in order — Layers, Controllers, Services, Repositories, Wiring, Soft delete, Audit
logging, EF, DTOs, Frontend sync, Naming, DRY/SRP/LSP, Security, Code quality, Tests, Changelog. Read
it top to bottom and remove anything that repeats another section; the rules file obeys its own DRY
rule. Every rule must carry a severity.

- [ ] **Step 9: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add rules/backend-rules.md
git commit -m "docs(rules): add naming, DRY/SRP/LSP, security, quality and test rules

Completes the rules file so the reviewer and the CLAUDE.md files have a single source to read."
```

---

### Task 6: The architecture reviewer

**Files:**
- Create: `agents/architecture-reviewer.md`
- Create: `eval/results/bad-<date>.json`, `eval/results/clean-<date>.json`

**Interfaces:**
- Consumes: `rules/backend-rules.md`, the three eval files, `scripts/sync-local.sh`.
- Produces: an agent named `architecture-reviewer` that, given a diff path, returns JSON
  `{"violations":[{"id","file","line","rule","why","fix"}],"suggestions":[…]}`. `id` is the fixture id
  (`V1`…) when reviewing a fixture and `null` on a real diff. `/validate` in Part 2 consumes exactly
  this shape and stores `violations`, `suggestions` and `waivers` in the stamp.

- [ ] **Step 1: Write the agent definition**

```markdown
---
name: architecture-reviewer
description: Reviews a backend diff against the TH Portal backend rules and reports violations. Read-only.
tools: Read, Glob, Grep
model: opus
---

You review a .NET backend diff for `file-management-server`. You never edit code.

First read `C:/file-management-server/.claude/guardrails/rules/backend-rules.md`, then read the diff
at the path you were given. Review only against that file. Anything that bothers you but no rule
covers goes in `suggestions`, never in `violations`. A rule marked `suggestion` never goes in
`violations` either.

Check before you flag: open the entity, the repository or the DbContext when the rule depends on it.
A missing `IsDeleted` filter is only a violation if the entity has that flag, and a method whose name
says it includes inactive rows is correct as written.

For each violation give the rule name, the file and line, one sentence on why it matters, and the
exact fix. If the diff is clean, say so with empty arrays.

Output JSON and nothing else:
{"violations":[{"id":null,"file":"…","line":12,"rule":"Layers","why":"…","fix":"…"}],"suggestions":[]}
```

- [ ] **Step 2: Install it where Claude Code can load it**

```bash
cd /c/file-management-server
bash .claude/guardrails/scripts/sync-local.sh
ls .claude/agents/architecture-reviewer.md
```
Expected: the file exists at `C:\file-management-server\.claude\agents\architecture-reviewer.md`.
Claude Code discovers subagents from `.claude/agents/` only — a definition left inside the bundle is
never loaded. Restart Claude Code so the agent is registered.

- [ ] **Step 3: Run the reviewer on the bad fixture**

Dispatch the `architecture-reviewer` agent with this prompt:

```
Review the diff at C:/file-management-server/.claude/guardrails/eval/bad-diff.patch and report
against the backend rules. When a finding matches one of the planted ids listed in the patch's
comments, use that id.
```

Save the returned JSON yourself (the agent cannot write files) to
`eval/results/bad-2026-09-18.json`.

Expected: all 22 ids appear in `violations`.

- [ ] **Step 4: Close the gap between expected and actual**

For every planted violation the reviewer missed, the rules file is what failed — the rule was missing,
vague, or had no example. Strengthen that rule in `rules/backend-rules.md`, re-run Step 3, and repeat
until all 22 are caught and there are no more than 2 findings outside the table.

Never "fix" it by telling the reviewer about a violation directly; the reviewer only ever knows what
the rules file says.

- [ ] **Step 5: Run the reviewer on the clean fixture**

Dispatch the agent with `C:/file-management-server/.claude/guardrails/eval/clean-diff.patch` and save
the JSON to `eval/results/clean-2026-09-18.json`.

Expected: `violations` is empty; `GetAllIncludingInactiveAsync` is not flagged; the new environment
variable appears in `suggestions` at most. Any false positive means the rule that produced it is too
blunt — tighten that rule, because a reviewer that cries wolf gets waived into uselessness.

- [ ] **Step 6: Record the baseline**

Append an "Eval results" section to `eval/expected.md`: the date, which ids were caught on the first
run, what had to change in the rules, and the final counts for both fixtures. `/learn` extends this
whenever a rule is added.

- [ ] **Step 7: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add agents/architecture-reviewer.md rules/backend-rules.md eval/
git commit -m "feat: add the read-only architecture reviewer

Proven against the planted diff: every violation class is reported and the clean diff passes without false positives."
```

---

### Task 7: The review skill

**Files:**
- Create: `skills/thportal-review/SKILL.md`

**Interfaces:**
- Consumes: `rules/backend-rules.md`, the `architecture-reviewer` agent, `scripts/sync-local.sh`.
- Produces: `/thportal-review <PR-number-or-url>` (PR mode) and `/thportal-review --local` (working
  copy mode). `/ship` and `/validate` in later plans call local mode and read its `VERDICT:` line.

The skill is deliberately **not** called `thportal-pr-review`: two copies of the old skill already
exist in the clone (`backend/.claude/skills/` tracked, `.claude/skills/` untracked) and neither may be
touched. A new name means there is never any doubt about which skill ran.

- [ ] **Step 1: Start from the existing skill**

```bash
mkdir -p /c/file-management-server/.claude/guardrails/skills/thportal-review
cp /c/file-management-server/backend/.claude/skills/thportal-pr-review/SKILL.md \
   /c/file-management-server/.claude/guardrails/skills/thportal-review/SKILL.md
```

- [ ] **Step 2: Strip every rule out of it**

Delete the sections that state rules — Step 3 "Review against architecture guidelines", Step 4 schema,
Step 5 code quality, and the per-rule report sections (API versioning, soft-delete, naming, frontend
sync, DTO, code quality). Replace them with one instruction: read
`C:/file-management-server/.claude/guardrails/rules/backend-rules.md`, dispatch the
`architecture-reviewer` agent per diff chunk, and merge its JSON.

Keep only the procedure: how to get the diff, the order of work, and the report format. Set the
frontmatter `name: thportal-review` and update the description to say it reviews a PR or the local
working copy against the shared rules.

- [ ] **Step 3: Write the two modes explicitly**

```markdown
## PR mode — `/thportal-review 2447`

gh pr view <n> --json title,body,baseRefName,headRefName,url
gh pr diff <n>

Base branch is `staging`. `development` no longer exists.

## Local mode — `/thportal-review --local`

Staged changes:      git diff --cached -- backend/
Whole branch:        git fetch origin staging && git diff origin/staging...HEAD -- backend/

Use the staged diff when called from /validate, the branch diff when called from /ship.
```

Also delete the old skill's line "Do not run any `git` commands — you don't need a local checkout",
which is now false, and replace `web_fetch` with `gh` throughout.

- [ ] **Step 4: Define the report**

Keep these headed sections only: Summary, Violations (grouped by rule), Suggestions, Files reviewed.
Drop the rest of the old skill's 17 sections — their content is now rules, not report structure. End
the report with a new verdict line, which did not exist in the old skill and which later skills parse:

```
VERDICT: pass
VERDICT: 3 violations
```

- [ ] **Step 5: Install and confirm the right skill runs**

```bash
cd /c/file-management-server
bash .claude/guardrails/scripts/sync-local.sh
ls .claude/skills/thportal-review/SKILL.md
```
Restart Claude Code, then confirm `/thportal-review` is listed and `/thportal-pr-review` still points
at the old one. They must be two separate entries.

- [ ] **Step 6: Smoke-test on a real backend PR**

Pick a merged PR that actually exercises the backend:

```bash
cd /c/file-management-server
for n in $(gh pr list --state merged --base staging --limit 30 --json number --jq '.[].number'); do
  c=$(gh pr diff $n --name-only | grep -c '^backend/.*\.cs$')
  [ "$c" -ge 5 ] && echo "PR $n — $c backend files"
done | head -5
```
Run `/thportal-review <n>` on the first result. Do not use PR #2447 for this: its backend side is only
`MainProfile.cs`, a constants file and four DTOs, so it exercises almost no rule.

Expected: the skill fetches with `gh`, dispatches the reviewer, and prints a report ending in
`VERDICT:`. Judge the findings by hand — anything clearly wrong is a rules problem, so fix the rule,
not the report.

- [ ] **Step 7: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add skills/thportal-review/SKILL.md rules/backend-rules.md
git commit -m "feat: add the review skill that reads the shared rules

The old skill carried its own copy of the rules, which is the duplication the rules themselves forbid; this one holds only the procedure."
```

---

### Task 8: The CLAUDE.md files

**Files:**
- Create: `claude/CLAUDE.root.md`, `claude/CLAUDE.backend.md`
- Copy to: `C:\file-management-server\CLAUDE.md`, `C:\file-management-server\backend\CLAUDE.md`
- Modify: `C:\file-management-server\.git\info\exclude`

**Interfaces:**
- Consumes: `rules/backend-rules.md`, `scripts/sync-local.sh`.
- Produces: the two `CLAUDE.md` files in the product clone. Part 2's `install.mjs` will copy the same
  two files.

- [ ] **Step 1: Write `claude/CLAUDE.root.md`** — under 70 lines, covering all six of these

1. **Setup** (first, so a new developer sees it): Bitwarden `Work` access or the `ZAYAN_ASANA_TOKEN`
   and `ZAYAN_GITHUB_PAT` environment variables; Docker Desktop; `gh`; run
   `bash .claude/guardrails/scripts/sync-local.sh` after pulling the bundle; start Claude Code from
   the repo root, not from `backend/`.
2. **Scope**: backend only; frontend work is untouched by these rules.
3. **Workflow**: `/ticket` → plan approved → code → `/validate` → commit → `/ship`. Say plainly that
   `/ticket`, `/validate`, `/ship` and `/learn` do not exist yet — only `/thportal-review` does — so
   nobody waits on a command that is still being built.
4. **Traceability**: every branch is linked to its ticket with
   `git config branch.<name>.asanaTask <gid>`; commits carry a Conventional Commits header, a 1-3 line
   *why* body and an `Asana:` trailer, so `git blame` → commit → PR → ticket always resolves.
5. **Never mention Claude** in a commit message or a PR description.
6. **Learning**: when the developer corrects Claude, or a review comment or QA failure reveals a gap,
   run `/learn` straight away so the rule is fixed once rather than re-explained every time. Until
   `/learn` exists, add the lesson to `.claude/guardrails/rules/backend-rules.md` by hand.

Plus DRY/SRP/LSP in one line each, and a pointer to `.claude/guardrails/rules/backend-rules.md` for
backend work. No rules of its own.

- [ ] **Step 2: Write `claude/CLAUDE.backend.md`**

```markdown
# Backend

All backend work follows these rules, without exception:

@../.claude/guardrails/rules/backend-rules.md

Before writing a new controller, service, repository, DTO, migration or test, open the matching
golden example named in that file and copy its shape.
```

- [ ] **Step 3: Install both**

```bash
cd /c/file-management-server
bash .claude/guardrails/scripts/sync-local.sh
ls CLAUDE.md backend/CLAUDE.md
```

- [ ] **Step 4: Hide them from git**

```bash
cd /c/file-management-server
printf '\n# local Claude guardrails (never commit)\n/CLAUDE.md\n/backend/CLAUDE.md\n' >> .git/info/exclude
git status --short
```
Expected: neither `CLAUDE.md` is listed. (`backend/docs/SECRETS.md` may still appear — it is the
user's own untracked file and this plan does not touch it.)

- [ ] **Step 5: Verify the rules actually reach a session**

Run from the repo root, not from `backend/`:

```bash
cd /c/file-management-server
claude -p "Answer from your loaded context only, without reading any file: name the golden example file for a v2 controller and the one for a repository."
```
Expected: `Controllers/V2/TaxCategoryController.cs` and `Repository/ScenarioRepository.cs`.

If it cannot answer: the import in `CLAUDE.backend.md` points outside the working directory when the
session starts in `backend/`, and Claude Code asks for approval on such an import — which `claude -p`
cannot give. Either run from the root (as here), or approve the import once in an interactive session.
The relative path itself is correct: imports resolve against the file that contains them.

- [ ] **Step 6: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add claude/
git commit -m "feat: add the CLAUDE.md files that load the rules

Rules only change behaviour if they are in front of Claude while it writes, not only when it reviews."
```

---

### Task 9: Version, changelog and push

**Files:**
- Modify: `VERSION`, `README.md`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Bump the version**

```bash
cd /c/file-management-server/.claude/guardrails
echo "0.2.0" > VERSION
```

- [ ] **Step 2: Write `CHANGELOG.md`**

```markdown
# Changelog

## 0.2.0 — 2026-09-18

- Backend rules file, verified against the codebase, with a golden example and a severity per rule.
- Read-only `architecture-reviewer` agent, proven against a planted diff of 22 violations and a clean
  diff with no false positives.
- `/thportal-review` skill: PR mode and local mode, reading the shared rules.
- `CLAUDE.md` files that load the rules while code is being written.
- `scripts/sync-local.sh` to install the above into the paths Claude Code reads.

## 0.1.0 — 2026-09-18

- Repo scaffold: design document and README.
```

- [ ] **Step 3: Update the README**

Replace `Status: design complete, implementation in progress.` with what works today (rules, reviewer,
`/thportal-review`, `sync-local.sh`) and what is still missing (`/ticket`, `/validate`, `/ship`,
`/learn`, the hooks, the installer). Correct the install instructions to use `sync-local.sh` rather
than `install.mjs`, which does not exist yet.

- [ ] **Step 4: Show the user everything and stop**

```bash
cd /c/file-management-server/.claude/guardrails
git status --short
git diff
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
cd /c/file-management-server && git status --short
```
Report what each commit contains, what is still uncommitted, and confirm the product repo is clean.
**Do not push** — the user reviews first.

- [ ] **Step 5: Push after the user says go**

```bash
cd /c/file-management-server/.claude/guardrails
git add -A
git commit -m "chore: release 0.2.0

Rules, reviewer and CLAUDE.md files are in place, so the bundle is useful to a developer even before the gate exists."
git push origin main
```
Git Credential Manager already holds a working credential for this remote, so no token handling is
needed. If it ever fails, the fallback is `FAAKHIR_GITHUB_PAT` from the Bitwarden **Pepflow.io**
project, read with `C:\Users\Administrator\.local\bws-token-pepflow-shared.dpapi` and passed through
`GH_TOKEN` — never written to a file or into `.git/config`.

---

## What this plan deliberately leaves for later

| Later plan | Contents |
|---|---|
| Stage 1, Part 2 — the gate | `scripts/secrets.mjs`, `scripts/checks.mjs`, `scripts/stamp.mjs`, `githooks/*`, `install.mjs` (replacing `sync-local.sh`), `uninstall.mjs`, the `PreToolUse` and `SessionStart` hooks |
| Stage 1, Part 3 — the workflow | `/ticket`, `/validate`, `/ship`, `/learn`, `config.json`, and the three pilot tickets |
