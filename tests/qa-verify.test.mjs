import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCases, buildUrl } from '../scripts/lib/qa-verify-lib.mjs';

const fetchImpl = async (url, opts = {}) => {
  if (url.endsWith('/ok')) return { status: 200, json: async () => ({ success: true, data: [{ id: 'a' }] }) };
  if (url.endsWith('/count')) return { status: 200, json: async () => ({ success: true, data: 1 }) };
  if (url.endsWith('/missing')) return { status: 404, json: async () => ({ success: false, data: null }) };
  if (url.endsWith('/boom')) throw new Error('connection refused');
  return { status: 500, json: async () => ({}) };
};

test('a case whose status matches passes and records evidence', async () => {
  const [r] = await runCases([
    { id: 'QA-1', type: 'api', request: { method: 'GET', path: '/ok' }, expect: { status: 200 } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(r.status, 'passed');
  assert.match(r.evidence, /GET \/ok -> 200/);
});

test('a case whose status does not match fails and says what came back', async () => {
  const [r] = await runCases([
    { id: 'QA-2', type: 'api', request: { method: 'GET', path: '/missing' }, expect: { status: 200 } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /expected 200.*got 404/i);
});

test('jsonContains is checked against the whole envelope', async () => {
  const [pass] = await runCases([
    { id: 'QA-3', type: 'api', request: { method: 'GET', path: '/count' }, expect: { status: 200, jsonContains: '"data":1' } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  const [fail] = await runCases([
    { id: 'QA-4', type: 'api', request: { method: 'GET', path: '/count' }, expect: { status: 200, jsonContains: '"data":7' } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(pass.status, 'passed');
  assert.equal(fail.status, 'failed');
  assert.match(fail.error, /did not contain/i);
});

test('jsonNotContains catches something that should have been filtered out', async () => {
  const [r] = await runCases([
    { id: 'QA-5', type: 'api', request: { method: 'GET', path: '/ok' }, expect: { status: 200, jsonNotContains: '"id":"a"' } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /should not have contained/i);
});

test('a request that throws is a failure, never a pass', async () => {
  const [r] = await runCases([
    { id: 'QA-6', type: 'api', request: { method: 'GET', path: '/boom' }, expect: { status: 200 } },
  ], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /connection refused/);
});

test('ui cases are never executed', async () => {
  const results = await runCases([{ id: 'QA-7', type: 'ui', steps: ['click'] }], { baseUrl: 'http://x', token: 't', fetchImpl });
  assert.equal(results.length, 0);
});

test('buildUrl substitutes vars and appends the query string', () => {
  const url = buildUrl('http://x', {
    request: { method: 'GET', path: '/api/v2/lots/{lotId}/notes', query: { includeInactive: 'false' } },
    vars: { lotId: '123' },
  });
  assert.equal(url, 'http://x/api/v2/lots/123/notes?includeInactive=false');
});

test('a var the case never defined is left alone rather than silently blanked', () => {
  const url = buildUrl('http://x', { request: { method: 'GET', path: '/a/{missing}/b' }, vars: {} });
  assert.match(url, /\{missing\}/);
});
