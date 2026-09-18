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
    /ZAYAN_ASANA_TOKEN[\s\S]*(environment|Bitwarden)/,
  );
});

test('a CLI failure is reported without leaking anything', () => {
  assert.throws(
    () => getSecret('ZAYAN_ASANA_TOKEN', { env: {}, runBws: () => { throw new Error('bws: 401 unauthorized'); } }),
    /bws/,
  );
});
