import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMessage, addTrailer } from '../scripts/commit-msg.mjs';

const good = `fix(lots): hide deleted lots from the assignment dropdown

The query had no IsDeleted filter, so deleted lots came back.
`;

test('a conventional message with a body passes', () => {
  assert.deepEqual(checkMessage(good, {}), { ok: true, problems: [] });
});

test('a non-conventional header is refused', () => {
  const r = checkMessage('updated some files\n\nbecause reasons\n', {});
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /conventional/i);
});

test('a header with no body is refused', () => {
  const r = checkMessage('fix(lots): hide deleted lots\n', {});
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /why/i);
});

test('comment lines from the git template are not a body', () => {
  const r = checkMessage('fix(lots): hide deleted lots\n\n# Please enter the commit message\n# On branch main\n', {});
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /why/i);
});

test('Claude attribution in any of its shapes is refused', () => {
  for (const line of [
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    'Generated with Claude Code',
    '🤖 Generated with something',
    'co-authored-by: Anthropic',
  ]) {
    const r = checkMessage(`${good}\n${line}\n`, {});
    assert.equal(r.ok, false, line);
    assert.match(r.problems.join(' '), /claude|attribution/i);
  }
});

test('the Asana trailer is required only when the branch is linked', () => {
  assert.equal(checkMessage(good, { ticket: null, requireTicket: true }).ok, true);

  const missing = checkMessage(good, { ticket: '1218492088693885', requireTicket: true });
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join(' '), /asana/i);

  const withTrailer = `${good}\nAsana: https://app.asana.com/1/x/project/y/task/1218492088693885\n`;
  assert.equal(checkMessage(withTrailer, { ticket: '1218492088693885', requireTicket: true }).ok, true);
});

test('a trailer pointing at a different ticket is refused', () => {
  const wrong = `${good}\nAsana: https://app.asana.com/1/x/project/y/task/999\n`;
  const r = checkMessage(wrong, { ticket: '1218492088693885', requireTicket: true });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /different ticket/i);
});

test('addTrailer appends once and leaves an existing trailer alone', () => {
  const url = 'https://app.asana.com/1/x/project/y/task/123';
  const once = addTrailer(good, url);
  assert.match(once, /Asana: https/);
  assert.equal(addTrailer(once, url), once);
});
