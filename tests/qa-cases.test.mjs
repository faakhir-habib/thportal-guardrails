import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCases, inScope, summarise } from '../scripts/lib/qa-cases.mjs';

const doc = {
  task: '123',
  cases: [
    { id: 'QA-1', type: 'api', title: 'a', scope: 'this-commit', request: { method: 'GET', path: '/x' }, expect: { status: 200 }, status: 'pending' },
    { id: 'QA-2', type: 'ui', title: 'b', steps: ['open it'], status: 'pending' },
    { id: 'QA-3', type: 'api', title: 'c', scope: 'later', request: { method: 'GET', path: '/y' }, expect: { status: 200 }, status: 'pending' },
  ],
};

test('a valid document parses with no problems', () => {
  const { cases, problems } = parseCases(JSON.stringify(doc));
  assert.equal(cases.length, 3);
  assert.deepEqual(problems, []);
});

test('an api case with no request and no expectation reports both, not just the first', () => {
  const bad = { task: '1', cases: [{ id: 'QA-1', type: 'api', title: 'x', scope: 'this-commit' }] };
  const { problems } = parseCases(JSON.stringify(bad));
  assert.equal(problems.length, 2);
  assert.match(problems.join(' '), /QA-1.*request/i);
  assert.match(problems.join(' '), /QA-1.*expect\.status/i);
});

test('a ui case with no steps is a problem', () => {
  const bad = { task: '1', cases: [{ id: 'QA-9', type: 'ui', title: 'x' }] };
  assert.match(parseCases(JSON.stringify(bad)).problems.join(' '), /QA-9.*steps/i);
});

test('duplicate ids are refused', () => {
  const dupe = { task: '1', cases: [doc.cases[0], doc.cases[0]] };
  assert.match(parseCases(JSON.stringify(dupe)).problems.join(' '), /duplicate/i);
});

test('scope and status default so a hand-written case still runs', () => {
  const terse = { task: '1', cases: [{ id: 'QA-1', type: 'api', title: 'x', request: { method: 'GET', path: '/x' }, expect: { status: 200 } }] };
  const { cases, problems } = parseCases(JSON.stringify(terse));
  assert.deepEqual(problems, []);
  assert.equal(cases[0].scope, 'this-commit');
  assert.equal(cases[0].status, 'pending');
});

test('broken JSON is reported as a problem rather than thrown', () => {
  const { cases, problems } = parseCases('{ not json');
  assert.deepEqual(cases, []);
  assert.match(problems.join(' '), /json/i);
});

test('inScope keeps this-commit api cases only', () => {
  const { cases } = parseCases(JSON.stringify(doc));
  assert.deepEqual(inScope(cases).map((c) => c.id), ['QA-1']);
});

test('summarise counts by type and status', () => {
  const { cases } = parseCases(JSON.stringify(doc));
  const line = summarise(cases);
  assert.match(line, /3 cases/);
  assert.match(line, /2 api/);
  assert.match(line, /1 ui/);
  assert.match(line, /3 pending/);
});
