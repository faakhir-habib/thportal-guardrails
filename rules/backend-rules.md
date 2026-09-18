# Backend rules — TH Portal

Every rule here was verified against the codebase on 2026-09-18. Each one states the rule, its
severity, why it matters, and a real file that follows it. Copy the golden example's shape rather
than inventing one.

**Severity is mandatory on every rule.**

- `violation` — blocks the commit.
- `suggestion` — reported, does not block.

A rule with no severity is incomplete. Fix the rule rather than guessing at review time.

These rules cover **backend code only**. Frontend files are read for one purpose — finding callers of
a changed DTO or endpoint — and are never reviewed for their own quality.

## Golden examples

Open the matching file before writing new code and follow its shape.

| Layer | File | Lines |
|---|---|---|
| V2 controller | `backend/FileManager.Presentation/Controllers/V2/TaxCategoryController.cs` | 64 |
| V2 controller, nested route | `backend/FileManager.Presentation/Controllers/V2/LotNotesController.cs` | 63 |
| Service | `backend/Service/ScenarioService.cs` | 327 |
| Service, activity logging across all verbs | `backend/Service/ScenarioStepService.cs` | 227 |
| Repository | `backend/Repository/ScenarioRepository.cs` | 82 |
| Repository, plain CRUD | `backend/Repository/TaxCategoryRepository.cs` | 57 |
| DTOs | `backend/Shared/DataTransferObjects/TaxCategoryDto.cs` | 35 |
| DTOs, multi-DTO feature | `backend/Shared/DataTransferObjects/DsmScenarioDtos.cs` | 80 |
| EF configuration | `backend/Repository/Configuration/ScenarioStepConfiguration.cs` | 39 |
| Migration | `backend/FileManager/Migrations/20260901081818_AddBulkDownloadJobZipFileNamePrefix.cs` | 28 |
| Integration test | `backend/FileManager.IntegrationTests/DealLifecycleE2ETests.cs` | 87 |

## Layers

Dependencies run one way: **Controller → Service → Repository**. Each of these is a `violation`:

- a controller injecting `IRepositoryManager` or touching `RepositoryContext`;
- a service taking HTTP types (`HttpContext`, `IActionResult`, `ControllerBase`);
- a repository calling a service, or referencing a DTO type;
- a controller reaching past its service to do orchestration that belongs in one.

**Why:** the layer boundary is what keeps business rules testable without HTTP and data access
swappable without touching rules. Once a controller queries directly, the same rule ends up written
twice — once in the controller and once in the service — and they drift.

**Evidence:** `RepositoryContext.` appears nowhere outside the `Repository` project.
`backend/Repository/DealRepository.cs` is the counter-example that already broke this, with two direct
`RepositoryContext.Set<...>()` calls and 19 lines referencing DTO types. Do not copy it.

## Controllers

Golden example: `backend/FileManager.Presentation/Controllers/V2/TaxCategoryController.cs`.

- **New controllers live under `Controllers/V2/` with a matching `.V2` namespace.** A folder and
  namespace that disagree break routing and discovery in ways nobody finds quickly — `violation`.
- **New functionality goes to v2, not onto a v1 controller.** Adding an action to an existing v1
  controller is acceptable only when it genuinely extends that same v1 contract, and the diff should
  make that obvious — `violation`.
- **Route shape:** `api/v2/[controller]` with typed constraints (`{id:guid}`). Nested resources follow
  `api/v2/lots/{lotId:guid}/notes` (`LotNotesController.cs`) — `violation`.
- **Inject `IServiceManager` and nothing else**, then call `_service.FooService.BarAsync(...)`. 108 of
  114 V2 controllers do exactly this. Injecting feature services or infrastructure directly is the
  `LotController.cs` mistake, which is how a controller grows to 566 lines — `violation`.
- **Return `result.ToActionResult(ResponseMessages.x)`.** Never construct `ApiResponse` by hand; the
  extension in `FileManager.Presentation/ResultExtensions.cs` maps `Ardalis.Result` status to HTTP and
  wraps the payload, and 109 of 114 V2 controllers rely on it. Never use `CoreResponseModel`, which
  survives in exactly 4 legacy files — `violation`.
- **No business logic, no validation logic, no `IMapper` in a controller.** The counter-example is
  `FileSystemActivityController.cs`, which validates a date range out of `HttpContext.Request.Query` —
  `violation`.
- An action body past ~30 lines means logic has leaked out of the service — `suggestion`.

## Services

Golden examples: `backend/Service/ScenarioService.cs`, `backend/Service/ScenarioStepService.cs`.

- **Constructor injection only.** The usual dependencies are `IRepositoryManager`, `IMapper`,
  `ILoggedInUserService`, `ISystemActivityService` and sibling services. Never `new` a service —
  `violation`.
- **Every public method returns `Result<T>`**, using `Result.NotFound()` and
  `Result.Invalid(new ValidationError(ResponseMessages.x))` for expected failures rather than thrown
  exceptions. Exceptions are for the unexpected; a missing row is not unexpected — `violation`.
- **Mapping between entities and DTOs happens here**, not in a controller and not in a repository —
  `violation`.
- **Order of a write:** apply the change, `await _repository.SaveAsync()`, write the activity log,
  then re-read the DTO to return. Logging before the save records something that may never have
  happened — `violation`.
- A service past ~800 lines is doing too much and should be split. `Service/DealService.cs` reached
  3,093 lines, and nothing about it is reusable now — `suggestion`.

## Repositories

Golden examples: `backend/Repository/ScenarioRepository.cs`, `backend/Repository/TaxCategoryRepository.cs`.

- **Extend `RepositoryBase<TEntity>` and implement the feature's interface**, with a constructor that
  takes `RepositoryContext` and passes it to the base — `violation`. (There is no rule about `sealed`:
  of 149 repositories only 9 are sealed, and `TaxCategoryRepository` is `internal class`.)
- **Reads go through `FindAll(trackChanges)` / `FindByCondition(expr, trackChanges)`** with
  `trackChanges` passed explicitly; read-only queries pass `false` — `violation`.
- **Writes are one-line delegations** to `Create` / `Update` / `Delete`. The service owns `SaveAsync`,
  because only the service knows what belongs in one unit of work — `violation`.
- **Never touch `RepositoryContext.Set<T>()` or a `DbSet` property directly, and never reference a
  DTO** — `violation`.
- Shared `Include` / `AsSplitQuery` graphs belong in a private `IQueryable<T>` helper rather than
  being repeated per method — `suggestion`.

## Wiring a new feature

A new service or repository is invisible until all five files change. Missing any of them is a
`violation`; a missing AutoMapper profile entry fails at runtime, not at compile time.

1. `backend/Service.Contracts/IServiceManager.cs` — add `IFooService FooService { get; }`.
2. `backend/Service/ServiceManager.cs` — add the `Lazy<IFooService>` field, the property, and the
   initializer inside the constructor.
3. `backend/Contracts/IRepositoryManager.cs` — add `IFooRepository Foos { get; }`.
4. `backend/Repository/RepositoryManager.cs` — mirror the `Lazy<IFooRepository>` field, property and
   initializer.
5. `backend/FileManager/MainProfile.cs` — add the `CreateMap<Foo, FooDto>()` entries.

Registering a service directly in `backend/FileManager/Extensions/ServiceExtensions.cs` is only for
the exceptions already there: infrastructure (`IPdfService`, `ICaptchaService`, `ISmsService`) and
background or Hangfire-activated services.

## Soft delete and active status

**There are no EF global query filters in this solution.** `HasQueryFilter` appears nowhere — not in
`backend/Repository/RepositoryContext.cs`, not in any of the 62 files in `Repository/Configuration/`.
Nothing filters deleted rows for you. 21 entities carry `IsDeleted`.

- **Every new or changed read query filters the status flags its entity carries** — `IsActive`,
  `IsDeleted`, `Discontinued`, and variants such as `Deleted`, `IsArchived`, `IsEnabled` or a `Status`
  enum — `violation`.
- The shape is an explicit predicate:
  `FindByCondition(l => l.Id == lotId && l.IsDeleted == false, trackChanges)`.
  `backend/Repository/LotRepository.cs` does this in 17 places.
- **Check the entity before flagging or fixing.** A repository's name says nothing about which flags
  its entity has; open the class under `Entities/Models/`.
- **Omitting the filter is correct when the method says so.** `GetAllIncludingInactiveAsync`,
  `GetByIdForRestoreAsync`, or an explicit parameter as in `backend/Repository/ScenarioRepository.cs:60`
  — `FindByCondition(s => includeInactive || s.IsActive, trackChanges: false)`. Intent in the name is
  the difference between a feature and a bug; a generic `GetProductByIdAsync` that quietly returns
  deleted rows is a bug.

**Why:** a missed filter does not throw. A discontinued product appears in a dropdown, a count is
wrong, a "deleted" user comes back — and it surfaces far from the query that caused it.

## Audit logging

Every create, update, delete or status change writes an activity row — `violation`.

**The common case** — `backend/Service/ScenarioStepService.cs`:

```csharp
await _systemActivityService.LogEntityAsync(ActivityTypes.DsmScenarioCreated, scenario.Id, ("Name", scenario.Name));
```

`LogEntityAsync` (`backend/Service/Extensions/SystemActivityExtensions.cs`) prepends the entity id
itself, so do not pass an entity-id pair of your own.

**Many or conditional pairs** — `backend/Service/LotCriticalDatesService.cs`:

```csharp
var info = new List<KeyValuePair<string, string>> { new(AdditionalInfoKeys.ENTITY_ID, dealId.ToString()) };
if (outcome.ReasonCode != null)
    info.Add(new(AdditionalInfoKeys.REASON_CODE, $"{outcome.ReasonCode.Code} - {outcome.ReasonCode.Name}"));
await _systemActivityService.OnActivityAsync(ActivityTypes.CriticalDatesUpdated, info);
```

- **The activity type is always a constant** in `backend/Service/ActivityTypes.cs`. Add a new one
  there; never pass a string literal — `violation`.
- **Shared keys come from `AdditionalInfoKeys`** (`ActivityTypes.cs:509-549`). Feature-specific pairs
  may use inline keys — `suggestion` when a shared key exists and is not used.
- **An update records the old and new values** of the fields that changed, the way
  `LotCriticalDatesService` snapshots before and after — `violation`.
- **`ISystemActivityService.AddActivity` is legacy** — 4 file-system call sites — and must not appear
  in new code — `violation`.
- **Entities carrying `CreatedBy` / `UpdatedBy` get them set** from `ILoggedInUserService` —
  `violation`.
- **`CreatedAt` / `LastModified` are never assigned by hand.** `RepositoryContext.SaveChangesAsync`
  sets them through `ITimeStampedModel` — `violation`.

**Why:** the activity log is what answers "who changed this deal's closing date, and from what" months
later. A mutation that skips it is invisible, and nobody notices until someone needs the history.

## EF configuration and migrations

- **An entity change ships with its migration in the same PR** — `violation`.
- **A new `IEntityTypeConfiguration<T>` must be registered by hand** with
  `modelBuilder.ApplyConfiguration(new XConfiguration());` in `RepositoryContext.OnModelCreating`
  (the block starts around line 1177 and holds 66 of them). There is no
  `ApplyConfigurationsFromAssembly`, so a forgotten line means the configuration silently does
  nothing — `violation`.
- **`Up` and `Down` are exact inverses**, and the migration carries only this change, no unrelated
  model drift — `violation`.
- **Destructive changes are called out in the PR description** — dropped columns, renames, type
  narrowing, data backfills. The reviewer and the lead need to see the impact before it reaches
  staging — `violation`.
- Configuration order follows `backend/Repository/Configuration/ScenarioStepConfiguration.cs`:
  `HasKey` → `Property(...).IsRequired().HasMaxLength(n)` → relationships with an explicit `OnDelete`
  → `HasIndex(...).HasDatabaseName("IX_<Entity>_<Cols>")` → audit FKs with `DeleteBehavior.Restrict`
  — `suggestion`.
- Raw interpolated SQL for data changes is a last resort. `Migrations/20260904113207_SeedAdminRoleForDSM.cs`
  is the counter-example: its `Down` deletes rows it cannot prove `Up` created — `suggestion`.

## DTOs

Golden example: `backend/Shared/DataTransferObjects/TaxCategoryDto.cs`.

- **A controller never accepts or returns an entity.** The API contract and the database schema must
  be free to change independently, and an entity in a response leaks fields nobody meant to publish —
  `violation`.
- **DTOs are `public class` with `{ get; set; }`.** Of 323 files in `Shared/DataTransferObjects/`, 285
  use `class` and 36 use `record`; new code follows the majority. `DrawCodeDto.cs` is the
  counter-example — `violation`.
- **Non-nullable strings are initialized `= string.Empty`; optional ones are `?`** — `violation`.
- **DataAnnotations go on write DTOs only** — `[Required(ErrorMessage = …)]`,
  `[MaxLength(n, ErrorMessage = …)]`. There is no shared length-constants type, so keep `n` in step
  with the `HasMaxLength(n)` in the entity's EF configuration — `violation` for a missing annotation,
  `suggestion` for a mismatch with the configuration.
- **Naming:** `FooDto` for reads, `FooCreateDto` and `FooUpdateDto` for writes; a feature's DTOs share
  one file, as in `DsmScenarioDtos.cs` — `violation`.

## Frontend sync

This is a backend rule. The reviewer reads frontend files only to find stale callers, and comments on
nothing else there.

When a diff changes **an existing DTO** (property renamed, removed or retyped) **or an endpoint
signature** — route template, HTTP verb, path or query parameters, `[FromBody]` type, response shape,
or authorization — every frontend caller must be updated in the same PR — `violation`.

How to check:

- search `frontend/` for the old property name in both casings (`XRatio` and `xRatio`), and for a
  distinctive fragment of the old route, with and without a leading slash;
- include `*.component.html`, where nothing catches a renamed property;
- check `*.spec.ts` mocks, which otherwise keep passing against a contract that no longer exists.

**Why:** the backend still compiles and its tests still pass. On PR #2312 the Angular services asked
for `model-elevation-products` while the controller routed on `modelelevationproducts`, and the
service's `catchError` swallowed the 404 — the dropdowns simply rendered empty. If the diff has no
frontend changes and the backend change is breaking, say so plainly; the frontend work is missing.

## Naming

**C# conventions** — `violation`:

- PascalCase for classes, methods, properties, enum members, namespaces; camelCase for locals and
  parameters.
- `Async` suffix on every method returning `Task`, `Task<T>` or `ValueTask`, including helpers and
  extension methods.
- `I` prefix on interfaces. No Hungarian or type prefixes on properties.

**Project patterns** — verify before flagging, then `violation` when the codebase is consistent and
`suggestion` when it is split:

- Repository methods: `GetAll<X>Async`, `Get<X>ByIdAsync`, `Get<X>By<Filter>Async`, and synchronous
  `Create<X>` / `Update<X>` / `Delete<X>` that only mark the entity.
- Service methods are all async: `Get<X>Async`, `Create<X>Async`, `Update<X>Async`, `Delete<X>Async`,
  `Toggle<X>StatusAsync`, `Upsert<X>Async`.
- `Delete*` over `Remove*`: 75 service files use `Delete*Async`, 20 use `Remove*Async`. Prefer
  `Delete*`; a `Remove*` on a resource whose existing methods are `Delete*` is a split worth flagging.
- `Get*` over `Fetch*` / `Retrieve*` / `Load*`: only one service file uses the alternatives.
- Boolean properties are `Is*` / `Has*` / `Can*`.
- Foreign keys pair as `<Entity>Id` (scalar) and `<Entity>` (navigation).

**How to verify a naming concern.** Count both forms before saying anything:
`grep -rl "Remove.*Async" --include=*.cs Service | wc -l` against the `Delete*` equivalent. A clear
majority makes it a violation; a near-even split makes it a suggestion, and the author chooses. Group
several naming points into one finding rather than listing each property.

**Why:** names are the interface. When a new method breaks the pattern, autocomplete stops helping,
the domain language drifts, and every reader pays a small tax forever.

## DRY, SRP, LSP

- **DRY** — before writing a helper, mapper, query or validation, search for an existing one and reuse
  it. Two copies of the same logic inside one diff is a `violation`. The live example of the cost:
  `SetUpdateAuditFields` (`Service/ModelElevationProductsService.cs:568`) and `UpdateAuditMetadata`
  (`Service/ScheduleService.cs:1079`) do the same job in two places, so a change to how `UpdatedBy` is
  stamped now has two homes. New code picks one approach.
- **SRP** — one reason to change per class, one job per method. A method past ~40-50 lines is split
  into validate / map / persist / log steps — `violation`.
- **LSP** — an implementation honours its interface: no `NotImplementedException`, no preconditions
  the interface does not state, no `is`/`as` checks on the concrete type by its callers, no surprise
  side effects. A repository method that throws instead of deleting breaks every caller that trusts
  the contract — `violation`.

## Security

- **Every new endpoint carries `[ModuleRoleAuthorize(modules: …, roles: …)]`** — 102 of the V2
  controllers do. A deliberately public endpoint (health checks, webhooks with their own signature
  check) says why in the diff — `violation`.
- **Write actions carry `[ServiceFilter(typeof(ValidationFilterAttribute))]`** — `violation`.
- **Changing an existing endpoint's roles** — narrowing or widening — is called out in the PR
  description, because the frontend may need to change with it — `violation`.
- **No secrets in code:** no connection strings, API keys, passwords or tokens. They belong in
  configuration and in the environment — `violation`.

## Code quality

- `async` all the way: `ToListAsync` / `FirstOrDefaultAsync`, never `.Result` or `.Wait()` on a task —
  `violation`.
- `AsNoTracking()`, or `trackChanges: false` through the repository, on read-only queries —
  `violation`.
- No `Console.WriteLine` or `Debug.WriteLine` in production code; use `ILogger` — `violation`.
- No new `TODO` / `FIXME` comments — unfinished work does not merge — `violation`.
- No magic numbers or strings: name the constant or move it to configuration — `suggestion`.
- No unused usings — `suggestion`.
- Minimal comments. Write a comment only for something the code cannot say, such as an external API's
  quirk — `suggestion`.
- A new environment variable or configuration key is a `suggestion`, but it must be listed in the PR's
  "Why" so every environment gets it before the deploy.

## Tests

Golden example: `backend/FileManager.IntegrationTests/DealLifecycleE2ETests.cs`.

**An integration test is mandatory** — `violation` — when the change touches any of:

- money or calculations (tax, discounts, dates);
- auth, roles or data scope;
- state or lifecycle transitions;
- external integrations and webhooks;
- delete, soft-delete or bulk updates;
- **any bug fix**, as a regression test that reproduces the bug first.

Plain CRUD with no business rule, configuration and text changes are exempt.

How the test is written:

- `[Collection(IntegrationTestCollection.Name)]`, constructor takes `TestingWebApplicationFactory<Program>`
  and does only `factory.CreateClient()`;
- authenticate with `DealApiFactory.AuthenticateClientAsync(_client)`, then call the real route over
  HTTP and read the envelope with `DealApiFactory.ReadRootAsync`;
- reuse `Fixtures/DealDomainSeeder.cs` and `Constants/TestConstants` rather than seeding by hand;
- a mutation's test also asserts the `SystemActivity` row the change is supposed to write;
- keep it small and scenario-shaped. `LotCriticalDatesServiceTests.cs` (923 lines) is not a model to
  copy — it is service-level and too large to read.

**Why:** the suite is the only thing standing between a refactor and a silent regression, and it runs
on every PR as a required check.

## Changelog

Every rule added after this file was created records itself here, with the eval case that proves it.

| Date | Rule | Why it was added | Source (PR/ticket) | Eval case |
|---|---|---|---|---|
| 2026-09-18 | All rules in this file | Created from the guardrails design; verified against the codebase | `docs/design.md` | V1-V22 |
