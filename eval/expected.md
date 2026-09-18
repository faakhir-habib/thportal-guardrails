# Review eval — what the reviewer must find

Two fixtures define whether the rules work. Both are real `git diff` output for an invented
"product image" feature, so nothing here collides with the codebase.

- `bad-diff.patch` — one instance of each violation class.
- `clean-diff.patch` — the same feature written correctly, including two traps that look wrong and
  are not.

## Pass criteria

1. All 22 ids below are reported in `violations` for `bad-diff.patch`.
2. At most **2** findings outside that table. A reviewer that pads its output with noise fails the
   same way one that misses a violation does.
3. `clean-diff.patch` returns an empty `violations` array.
4. Neither trap in the clean diff is reported as a violation.

## bad-diff.patch

| id | Rule | File | What must be reported | Fix the reviewer should name |
|---|---|---|---|---|
| V1 | Layers | `Controllers/ProductController.cs` | The controller injects `IRepositoryManager` and calls `_repository.ProductImages.FindAll(false)` | Move the query into a service and call it through `IServiceManager` |
| V2 | Controllers (v2) | `Controllers/ProductController.cs` | A new endpoint `GET {id:guid}/images` is added to a v1 controller | New functionality belongs in `Controllers/V2/` |
| V3 | Controllers (v2) | `Controllers/ProductImageController.cs` | A brand-new controller lives outside `Controllers/V2/`, and its namespace has no `.V2` | Move the file and namespace under `V2` |
| V4 | Soft delete | `Repository/ProductImageRepository.cs` | `GetProductImageByIdAsync` and `GetProductImagesAsync` filter nothing; `ProductImage` carries `IsDeleted` and `IsActive` | Add `&& p.IsDeleted == false` (and `IsActive` where the use case needs it) |
| V5 | Audit logging | `Service/ProductImageService.cs` | `CreateProductImageAsync` saves and returns with no activity log | `await _systemActivityService.LogEntityAsync(ActivityTypes.ProductImageCreated, entity.Id, …)` |
| V6 | Audit logging | `Service/ProductImageService.cs` | `OnActivityAsync("ProductImageUpdated", info)` passes a string literal | Add a constant to `Service/ActivityTypes.cs` and pass it |
| V7 | Audit logging | `Service/ProductImageService.cs` | `AddActivity(...)` is the legacy file-system API | Use `LogEntityAsync` / `OnActivityAsync` |
| V8 | Audit logging | `Service/ProductImageService.cs` | `entity.CreatedAt = DateTime.UtcNow;` is assigned by hand | `RepositoryContext.SaveChangesAsync` sets it through `ITimeStampedModel`; delete the line |
| V9 | DTOs | `Controllers/ProductController.cs` | The action returns `ActionResult<List<ProductImage>>` — an entity | Return a DTO |
| V10 | DRY | `Service/ProductImageService.cs` | `FormatFileSize` and `FormatSize` are the same method twice | Keep one |
| V11 | SRP | `Service/ProductImageService.cs` | `UpsertProductImagesAsync` runs ~60 lines doing validate + create + update + soft-delete + log | Split into validate / apply / log steps |
| V12 | Controllers (response) | `Controllers/ProductImageController.cs` | `new CoreResponseModel().GetSuccessResponse(...)` is the legacy shape | `return result.ToActionResult(ResponseMessages.x)` |
| V13 | EF configuration | `Repository/Configuration/ProductImageConfiguration.cs` | A new `IEntityTypeConfiguration<T>` with no `ApplyConfiguration` line in `RepositoryContext.OnModelCreating` | Register it; there is no `ApplyConfigurationsFromAssembly` |
| V14 | Migrations | `Entities/Models/ProductImage.cs` | `AltText` is added to the entity with no migration in the diff | Add the migration |
| V15 | Security | `Controllers/ProductImageController.cs` | No `[ModuleRoleAuthorize]` and no `[Authorize]` on a new controller | Add the module/role attribute |
| V16 | Security | `Controllers/ProductImageController.cs` | The POST action has no `[ServiceFilter(typeof(ValidationFilterAttribute))]` | Add it |
| V17 | DTOs | `Shared/DataTransferObjects/ProductImageDto.cs` | `public record` with `{ get; init; }`, and `string Url` is non-nullable with no initializer | `public class` with `{ get; set; }` and `= string.Empty` |
| V18 | Naming | `Service/ProductImageService.cs` | `RemoveProductImageAsync` where the codebase uses `Delete*Async`; `CalculateStorageCost` returns `Task<decimal>` with no `Async` suffix | Rename both |
| V19 | LSP | `Repository/ProductImageRepository.cs` | `DeleteProductImage` throws `NotImplementedException` while implementing the interface | Delegate to `Delete(productImage)` |
| V20 | Frontend sync | `Shared/DataTransferObjects/ProductGalleryDto.cs` | `ImageUrl` is renamed to `Url` while `product-gallery.component.ts` — modified in the same diff — still binds `image.imageUrl` | Update the template and its model |
| V21 | Code quality | `Service/ProductImageService.cs` | `.Result` on `GetProductByIdAsync`, a `Console.WriteLine`, the magic `86400`, and unused `System.Text` / `System.Xml.Linq` usings | `await`, `ILogger`, a named constant, drop the usings |
| V22 | Tests | whole diff | Money maths (`CalculateStorageCost`) and a soft-delete path change with nothing under `FileManager.IntegrationTests/` | Add an integration test |

## clean-diff.patch

Expected: `"violations": []`.

The two traps, neither of which is a violation:

| Trap | Why it is correct |
|---|---|
| `GetAllIncludingInactiveAsync` omits the `IsActive` filter | The method name states the intent, which is exactly what the soft-delete rule allows. It still filters `IsDeleted`. |
| `configuration["ProductImages:CdnBaseUrl"]` introduces a new environment value | New configuration is a `suggestion`, never a violation. It may appear in `suggestions`, and belongs in the PR's "Why". |

What the clean diff does right, for reference while judging a false positive: v2 controller under
`Controllers/V2/` with `[ModuleRoleAuthorize]` and `[ServiceFilter(typeof(ValidationFilterAttribute))]`
on the write action, `ToActionResult`, `IServiceManager` only; service returning `Result<T>` and
logging with `LogEntityAsync`; repository filtering `IsDeleted` in every read; `class` DTOs with
`*CreateDto` / `*UpdateDto`; EF configuration **with** its `ApplyConfiguration` line; a migration whose
`Down` mirrors `Up`; all five wiring files updated; and an integration test that drives real HTTP and
asserts the `SystemActivity` row.

## Eval results

Filled in by Task 6, and extended by `/learn` whenever a rule is added.

| Date | Fixture | Caught | Missed | Extra findings | Notes |
|---|---|---|---|---|---|
