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
