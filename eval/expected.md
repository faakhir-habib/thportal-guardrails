# Review eval — what the reviewer must find

Two fixtures define whether the rules work. Both are real `git diff` output for an invented
"placard photo" feature, so nothing here collides with the codebase.

- `bad-diff.patch` — one instance of each violation class.
- `clean-diff.patch` — the same feature written correctly, including two traps that look wrong and
  are not.

## Pass criteria

1. All 27 ids below are reported in `violations` for `bad-diff.patch`.
2. At most **2** findings outside that table. A reviewer that pads its output with noise fails the
   same way one that misses a violation does.
3. `clean-diff.patch` returns an empty `violations` array.
4. Neither trap in the clean diff is reported as a violation.

## bad-diff.patch

| id | Rule | File | What must be reported | Fix the reviewer should name |
|---|---|---|---|---|
| V1 | Layers | `Controllers/PlacardController.cs` | The controller injects `IRepositoryManager` and calls `_repository.PlacardPhotos.FindAll(false)` | Move the query into a service and call it through `IServiceManager` |
| V2 | Controllers (v2) | `Controllers/PlacardController.cs` | A new endpoint `GET {id:guid}/images` is added to a v1 controller | New functionality belongs in `Controllers/V2/` |
| V3 | Controllers (v2) | `Controllers/PlacardPhotoController.cs` | A brand-new controller lives outside `Controllers/V2/`, and its namespace has no `.V2` | Move the file and namespace under `V2` |
| V4 | Soft delete | `Repository/PlacardPhotoRepository.cs` | `GetPlacardPhotoByIdAsync` and `GetPlacardPhotosAsync` filter nothing; `PlacardPhoto` carries `IsDeleted` and `IsActive` | Add `&& p.IsDeleted == false` (and `IsActive` where the use case needs it) |
| V5 | Audit logging | `Service/PlacardPhotoService.cs` | `CreatePlacardPhotoAsync` saves and returns with no activity log | `await _systemActivityService.LogEntityAsync(ActivityTypes.PlacardPhotoCreated, entity.Id, …)` |
| V6 | Audit logging | `Service/PlacardPhotoService.cs` | `OnActivityAsync("PlacardPhotoUpdated", info)` passes a string literal | Add a constant to `Service/ActivityTypes.cs` and pass it |
| V7 | Audit logging | `Service/PlacardPhotoService.cs` | `AddActivity(...)` is the legacy file-system API | Use `LogEntityAsync` / `OnActivityAsync` |
| V8 | Audit logging | `Service/PlacardPhotoService.cs` | `entity.CreatedAt = DateTime.UtcNow;` is assigned by hand | `RepositoryContext.SaveChangesAsync` sets it through `ITimeStampedModel`; delete the line |
| V9 | DTOs | `Controllers/PlacardController.cs` | The action returns `ActionResult<List<PlacardPhoto>>` — an entity | Return a DTO |
| V10 | DRY | `Service/PlacardPhotoService.cs` | `FormatFileSize` and `FormatSize` are the same method twice | Keep one |
| V11 | SRP | `Service/PlacardPhotoService.cs` | `UpsertPlacardPhotosAsync` runs ~60 lines doing validate + create + update + soft-delete + log | Split into validate / apply / log steps |
| V12 | Controllers (response) | `Controllers/PlacardPhotoController.cs` | `new CoreResponseModel().GetSuccessResponse(...)` is the legacy shape | `return result.ToActionResult(ResponseMessages.x)` |
| V13 | EF configuration | `Repository/Configuration/PlacardPhotoConfiguration.cs` | A new `IEntityTypeConfiguration<T>` with no `ApplyConfiguration` line in `RepositoryContext.OnModelCreating` | Register it; there is no `ApplyConfigurationsFromAssembly` |
| V14 | Migrations | `Entities/Models/PlacardPhoto.cs` | `AltText` is added to the entity with no migration in the diff | Add the migration |
| V15 | Security | `Controllers/PlacardPhotoController.cs` | No `[ModuleRoleAuthorize]` and no `[Authorize]` on a new controller | Add the module/role attribute |
| V16 | Security | `Controllers/PlacardPhotoController.cs` | The POST action has no `[ServiceFilter(typeof(ValidationFilterAttribute))]` | Add it |
| V17 | DTOs | `Shared/DataTransferObjects/PlacardPhotoDto.cs` | `public record` with `{ get; init; }`, and `string Url` is non-nullable with no initializer | `public class` with `{ get; set; }` and `= string.Empty` |
| V18 | Naming | `Service/PlacardPhotoService.cs` | `RemovePlacardPhotoAsync` where the codebase uses `Delete*Async`; `CalculateStorageCost` returns `Task<decimal>` with no `Async` suffix | Rename both |
| V19 | LSP | `Repository/PlacardPhotoRepository.cs` | `DeletePlacardPhoto` throws `NotImplementedException` while implementing the interface | Delegate to `Delete(placardPhoto)` |
| V20 | Frontend sync | `Shared/DataTransferObjects/PlacardGalleryDto.cs` | `ImageUrl` is renamed to `Url` while `placard-gallery.component.ts` — modified in the same diff — still binds `image.imageUrl` | Update the template and its model |
| V21 | Code quality | `Service/PlacardPhotoService.cs` | `.Result` on `GetPlacardByIdAsync`, a `Console.WriteLine`, the magic `86400`, and unused `System.Text` / `System.Xml.Linq` usings | `await`, `ILogger`, a named constant, drop the usings |
| V22 | Tests | whole diff | Money maths (`CalculateStorageCost`) and a soft-delete path change with nothing under `FileManager.IntegrationTests/` | Add an integration test |
| V23 | Audit logging | `Service/PlacardPhotoService.cs` | `CreatedBy` / `UpdatedBy` are never set; the service does not even inject `ILoggedInUserService` | Inject it and stamp both |
| V24 | Audit logging | `Service/PlacardPhotoService.cs` | `UpdatePlacardPhotoAsync` logs only the entity id, not the old and new `Url` | Snapshot before the assignment and log both values |
| V25 | Services | `Service/PlacardPhotoService.cs` | `CalculateStorageCost` is a public service method returning a bare `Task<decimal>` instead of `Result<T>` | Return `Task<Result<decimal>>` or make it private |
| V26 | Wiring | whole diff | A new service and repository with none of the five wiring files touched, so `_service.PlacardPhotoService` cannot resolve | Add the property, the `Lazy<>` field and initializer in all four managers, plus the `MainProfile` map |
| V27 | DTOs | `Shared/DataTransferObjects/PlacardPhotoDto.cs` | The DTO is bound as the POST body but carries no DataAnnotations, so the validation filter has nothing to check and the length rule is hand-rolled in the service | Use a write DTO with `[Required]` and `[MaxLength(2048)]` |

## clean-diff.patch

Expected: `"violations": []`.

The two traps, neither of which is a violation:

| Trap | Why it is correct |
|---|---|
| `GetAllIncludingInactiveAsync` omits the `IsActive` filter | The method name states the intent, which is exactly what the soft-delete rule allows. It still filters `IsDeleted`. |
| `configuration["PlacardPhotos:CdnBaseUrl"]` introduces a new environment value | New configuration is a `suggestion`, never a violation. It may appear in `suggestions`, and belongs in the PR's "Why". |

What the clean diff does right, for reference while judging a false positive: v2 controller under
`Controllers/V2/` with `[ModuleRoleAuthorize]` and `[ServiceFilter(typeof(ValidationFilterAttribute))]`
on the write action, `ToActionResult`, `IServiceManager` only; service returning `Result<T>` and
logging with `LogEntityAsync`; repository filtering `IsDeleted` in every read; `class` DTOs with
`*CreateDto` / `*UpdateDto`; EF configuration **with** its `ApplyConfiguration` line; a migration whose
`Down` mirrors `Up`; all five wiring files updated; and an integration test that drives real HTTP and
asserts the `SystemActivity` row.

## Eval results

Extended by `/learn` whenever a rule is added.

| Date | Fixture | Caught | Missed | Extra findings | Notes |
|---|---|---|---|---|---|
| 2026-09-18 | bad-diff | 22 of 22 planted | 0 | 5, all genuine | The rules needed no strengthening. The five extras were real violations the table had missed — `CreatedBy`/`UpdatedBy` never set, an update logging no old/new values, a public method returning a bare `Task<decimal>`, none of the five wiring files touched, and a POST body DTO with no annotations. They are now planted ids V23-V27. |
| 2026-09-18 | clean-diff | — | — | 0 violations, 5 suggestions | Passed: empty `violations`. Both traps handled correctly — `GetAllIncludingInactiveAsync` was not called a soft-delete violation, and the new configuration key appeared only as a suggestion. The suggestions were fair: the fixture's test file really is missing usings, and `_cdnBaseUrl` really is dead. |

Two notes on how this baseline was produced, so the next run is comparable:

- It ran with the reviewer's instructions passed inline to a general-purpose subagent, because a newly
  written `.claude/agents/` file is only registered after Claude Code restarts. Re-run it through the
  real `architecture-reviewer` agent once to confirm the registered path behaves the same.
- The fixtures were renamed from "product image" to "placard photo" after the first run. The original
  name collided with a real feature in the codebase, and the reviewer correctly cited the existing
  types — useful, but it tied the eval to code that will keep changing.
