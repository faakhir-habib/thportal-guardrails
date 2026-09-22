import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendChangelogRow, checkRule } from '../scripts/lib/rules-changelog.mjs';

const file = `## Changelog

| Date | Rule | Why it was added | Source (PR/ticket) | Eval case |
|---|---|---|---|---|
| 2026-09-18 | All rules in this file | Created from the design | docs/design.md | V1-V22 |
`;

test('a row is appended under the existing ones', () => {
  const out = appendChangelogRow(file, {
    date: '2026-09-22', rule: 'AsNoTracking', why: 'a read tracked entities', source: 'PR 2422', evalCase: 'V23',
  });
  const rows = out.trim().split('\n').filter((r) => r.startsWith('|'));
  assert.match(rows.at(-1), /2026-09-22 \| AsNoTracking .*V23/);
  assert.equal(rows.length, 4, 'header, separator and two rows');
});

test('a rule with no severity is incomplete', () => {
  const r = checkRule('- Always use AsNoTracking on reads.');
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /severity/i);
});

test('a rule with no reason is incomplete', () => {
  const r = checkRule('- Always use AsNoTracking on reads — `violation`. See `backend/Repository/LotRepository.cs`.');
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /why|reason/i);
});

test('a rule with no real example is incomplete', () => {
  const r = checkRule('- Always use `AsNoTracking()` on reads — `violation`. **Why:** tracking a read wastes memory.');
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /example|path/i);
});

test('a complete rule passes', () => {
  const r = checkRule('- Always use `AsNoTracking()` on read-only queries — `violation`. **Why:** change tracking on a read wastes memory and hides accidental writes. See `backend/Repository/LotRepository.cs`.');
  assert.deepEqual(r, { ok: true, problems: [] });
});
