import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeDatabase } from '../scripts/lib/api-harness.mjs';

test('a shared database is refused by name', () => {
  for (const name of ['erp-development', 'erp-staging1.2', 'thportal_staging', 'erp', 'thportal_pr_2422', 'crm']) {
    assert.throws(
      () => assertSafeDatabase(`Server=x,1433;Database=${name};User Id=u;Password=p;`),
      /refusing to run against/,
      name,
    );
  }
});

test('a branch database and a local database are allowed', () => {
  assertSafeDatabase('Server=x,1433;Database=erp-v1.0-feat-my-branch;User Id=u;Password=p;');
  assertSafeDatabase('Server=(localdb)\mssqllocaldb;Database=FileManagerDb;Trusted_Connection=True;');
  assertSafeDatabase(null);
});
