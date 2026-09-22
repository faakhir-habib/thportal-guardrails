import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrBody, currentPr, createPr, prReviewComments } from '../scripts/lib/github.mjs';

const body = () => buildPrBody({
  ticketUrl: 'https://app.asana.com/1/w/project/p/task/123',
  summary: 'Adds the usage count so an admin can see what a category is used by.',
  why: ['Counted on the FK column because the navigation is configured twice.'],
  verification: { tests: ['TaxCategoryUsageApiTests (new)'], suite: 'pass', qa: '4/4 API cases passed on preview' },
  waivers: [],
});

test('the body leads with the ticket and stays short', () => {
  const b = body();
  assert.match(b.split('\n')[0], /^\*\*Asana:\*\* https:\/\/app\.asana\.com/);
  assert.ok(b.split('\n').length <= 18, `body was ${b.split('\n').length} lines`);
});

test('the sections that matter are present and the empty one is absent', () => {
  const b = body();
  for (const heading of ['## Summary', '## Why', '## Verification']) assert.match(b, new RegExp(heading));
  assert.doesNotMatch(b, /## Waivers/, 'no waivers means no waivers heading');
});

test('waivers appear when there are any', () => {
  const b = buildPrBody({
    ticketUrl: 'u',
    summary: 's',
    why: [],
    waivers: [{ rule: 'Naming', reason: 'the codebase is split 50/50 here' }],
    verification: { tests: [], suite: 'pass', qa: 'none' },
  });
  assert.match(b, /## Waivers/);
  assert.match(b, /Naming — the codebase is split 50\/50 here/);
});

test('the body never mentions Claude', () => {
  const b = buildPrBody({
    ticketUrl: 'u',
    summary: 'Generated with Claude Code',
    why: ['Co-Authored-By: Claude'],
    waivers: [],
    verification: { tests: [], suite: 'pass', qa: 'none' },
  });
  assert.doesNotMatch(b, /claude/i);
});

test('currentPr returns null when gh finds nothing', () => {
  const run = () => { throw new Error('no pull requests found for branch'); };
  assert.equal(currentPr({ run }), null);
});

test('currentPr parses the number and url', () => {
  const run = () => JSON.stringify({ number: 2450, url: 'https://github.com/o/r/pull/2450' });
  assert.deepEqual(currentPr({ run }), { number: 2450, url: 'https://github.com/o/r/pull/2450' });
});

test('createPr passes the base branch and returns the new number', () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return args.includes('create') ? 'https://github.com/o/r/pull/2451\n' : JSON.stringify({ number: 2451, url: 'x' });
  };
  const pr = createPr({ title: 't', body: 'b', base: 'staging', run });
  assert.equal(pr.number, 2451);
  assert.ok(calls[0].includes('--base') && calls[0].includes('staging'));
});

test('review comments come back flattened', () => {
  const run = () => JSON.stringify([{ user: { login: 'lead' }, body: 'add the filter', path: 'a.cs', line: 12 }]);
  assert.deepEqual(prReviewComments(2450, { run }), [{ author: 'lead', body: 'add the filter', path: 'a.cs', line: 12 }]);
});
