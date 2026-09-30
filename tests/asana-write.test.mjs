import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachLink, buildQaComment, postComment, setCustomFields, moveToSection } from '../scripts/lib/asana-write.mjs';

const cases = [
  { id: 'QA-1', type: 'api', title: 'count excludes inactive', status: 'passed', evidence: 'GET /x -> 200' },
  { id: 'QA-2', type: 'ui', title: 'the list shows the count', status: 'pending', steps: ['open it', 'look'] },
];

const comment = () => buildQaComment({
  branch: 'feat/x',
  previewUrl: 'https://pr-9-api.dev.thportal.ca',
  prUrl: 'https://github.com/o/r/pull/9',
  cases,
  waivers: [],
  reviewerGid: '1213187391484366',
});

test('the comment carries the branch, the preview, the PR and the mention', () => {
  const c = comment();
  assert.match(c, /feat\/x/);
  assert.match(c, /pr-9-api\.dev\.thportal\.ca/);
  assert.match(c, /pull\/9/);
  assert.match(c, /<a data-asana-gid="1213187391484366"\/>/);
});

test('api cases show their evidence and ui cases show their steps', () => {
  const c = comment();
  // Escaped in the html; Asana renders it back as "GET /x -> 200".
  assert.match(c, /GET \/x -&gt; 200/);
  assert.match(c, /open it/);
});

test('only tags allowed by Asana are used', () => {
  const c = comment();
  assert.doesNotMatch(c, /<p>|<br\s*\/?>|<div|<table/i);
  assert.match(c, /^<body>/);
  assert.match(c, /<\/body>$/);
});

test('ui cases scoped later are listed apart, not handed to QA to check now', () => {
  const c = buildQaComment({
    branch: 'b',
    previewUrl: 'p',
    prUrl: 'u',
    reviewerGid: 'g',
    waivers: [],
    cases: [
      { id: 'QA-1', type: 'ui', title: 'now', steps: ['do now'] },
      { id: 'QA-2', type: 'ui', title: 'afterwards', scope: 'later', steps: ['do later'] },
    ],
  });
  const [now, later] = c.split('Later on this ticket');
  assert.match(now, /QA-1 now: do now/);
  assert.doesNotMatch(now, /QA-2/);
  assert.match(later, /QA-2 afterwards/);
  assert.doesNotMatch(later, /do later/);
});

test('a failing case is called out rather than buried', () => {
  const c = buildQaComment({
    branch: 'b',
    previewUrl: 'p',
    prUrl: 'u',
    reviewerGid: 'g',
    waivers: [],
    cases: [{ id: 'QA-1', type: 'api', title: 'x', status: 'failed', error: 'expected 200, got 404' }],
  });
  assert.match(c, /failed/i);
  assert.match(c, /expected 200, got 404/);
});

test('postComment sends html_text to the stories endpoint', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ data: { gid: '1' } }) }; };
  await postComment('123', '<body>hi</body>', { fetchImpl, token: 't' });
  assert.match(seen[0].url, /\/tasks\/123\/stories$/);
  assert.equal(JSON.parse(seen[0].opts.body).data.html_text, '<body>hi</body>');
});

test('setCustomFields PUTs the field map', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ data: {} }) }; };
  await setCustomFields('123', { 1213970239265742: 'feat/x' }, { fetchImpl, token: 't' });
  assert.equal(seen[0].opts.method, 'PUT');
  assert.equal(JSON.parse(seen[0].opts.body).data.custom_fields['1213970239265742'], 'feat/x');
});

test('a failed write says which call failed', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(() => moveToSection('123', '456', { fetchImpl, token: 't' }), /403/);
});

test('html in a case title is escaped rather than passed through', () => {
  const c = buildQaComment({
    branch: 'b', previewUrl: 'p', prUrl: 'u', reviewerGid: 'g', waivers: [],
    cases: [{ id: 'QA-1', type: 'api', title: '<script>alert(1)</script>', status: 'passed', evidence: 'x' }],
  });
  assert.doesNotMatch(c, /<script>/);
  assert.match(c, /&lt;script&gt;/);
});

test('attachLink posts an external attachment pointing at the PR', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return { ok: true, json: async () => ({ data: { gid: '1' } }) }; };
  await attachLink('123', { url: 'https://github.com/o/r/pull/9', name: 'PR #9' }, { fetchImpl, token: 't' });

  const body = JSON.parse(seen[0].opts.body).data;
  assert.match(seen[0].url, /\/attachments$/);
  assert.equal(body.resource_subtype, 'external');
  assert.equal(body.parent, '123');
  assert.equal(body.url, 'https://github.com/o/r/pull/9');
});
