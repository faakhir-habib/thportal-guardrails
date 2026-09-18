import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../scripts/gate.mjs';

const cfg = { gate: { enabled: true, requireTicket: false } };
const pass = () => ({ ok: true, reason: 'stamp is current' });
const fail = (reason) => ({ ok: false, reason });

test('a commit with no backend file is none of our business', () => {
  const d = decide({ files: ['frontend/apps/a.ts'], merging: false, cfg, verify: () => fail('no stamp') });
  assert.equal(d.allow, true);
  assert.match(d.reason, /no backend/i);
});

test('a merge commit is allowed without a stamp', () => {
  const d = decide({ files: ['backend/Service/A.cs'], merging: true, cfg, verify: () => fail('no stamp') });
  assert.equal(d.allow, true);
  assert.match(d.reason, /merge/i);
});

test('a backend commit with a passing stamp is allowed', () => {
  const d = decide({ files: ['backend/Service/A.cs'], merging: false, cfg, verify: pass });
  assert.equal(d.allow, true);
});

test('a backend commit with no stamp is blocked and told what to run', () => {
  const d = decide({
    files: ['backend/Service/A.cs'],
    merging: false,
    cfg,
    verify: () => fail('no stamp for this staged content'),
  });
  assert.equal(d.allow, false);
  assert.match(d.reason, /no stamp/i);
  assert.match(d.hint, /\/validate/);
});

test('requireTicket blocks an unlinked branch only when it is turned on', () => {
  const on = { gate: { enabled: true, requireTicket: true } };
  const linked = decide({ files: ['backend/A.cs'], merging: false, cfg: on, ticket: '123', verify: pass, branch: 'feat/x' });
  const unlinked = decide({ files: ['backend/A.cs'], merging: false, cfg: on, ticket: null, verify: pass, branch: 'feat/x' });
  assert.equal(linked.allow, true);
  assert.equal(unlinked.allow, false);
  assert.match(unlinked.reason, /ticket/i);
});

test('a disabled gate allows everything but says so', () => {
  const off = { gate: { enabled: false, requireTicket: false } };
  const d = decide({ files: ['backend/A.cs'], merging: false, cfg: off, verify: () => fail('no stamp') });
  assert.equal(d.allow, true);
  assert.match(d.reason, /disabled/i);
});
