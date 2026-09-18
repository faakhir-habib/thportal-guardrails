import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rulesHash, writeStamp, readStamp, verifyStamp, pruneStamps } from '../scripts/lib/stamp.mjs';

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, 'backend'), { recursive: true });
  writeFileSync(join(dir, 'backend', 'a.cs'), 'class A {}\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

test('a stamp round-trips and verifies', () => {
  const dir = scratchRepo();
  const tree = execFileSync('git', ['write-tree'], { cwd: dir }).toString().trim();

  writeStamp({ tree, result: 'pass', rulesHash: rulesHash(), checks: { build: 'pass' } }, dir);

  assert.equal(readStamp(tree, dir).result, 'pass');
  assert.deepEqual(verifyStamp(tree, dir), { ok: true, reason: 'stamp is current' });
  rmSync(dir, { recursive: true, force: true });
});

test('a missing stamp, a failed stamp and a stale rules hash are all refused', () => {
  const dir = scratchRepo();
  const tree = execFileSync('git', ['write-tree'], { cwd: dir }).toString().trim();

  assert.equal(verifyStamp(tree, dir).ok, false);
  assert.match(verifyStamp(tree, dir).reason, /no stamp/i);

  writeStamp({ tree, result: 'fail', rulesHash: rulesHash() }, dir);
  assert.match(verifyStamp(tree, dir).reason, /did not pass/i);

  writeStamp({ tree, result: 'pass', rulesHash: 'stale-hash' }, dir);
  assert.match(verifyStamp(tree, dir).reason, /rules changed/i);
  rmSync(dir, { recursive: true, force: true });
});

test('pruneStamps removes only what is older than the cutoff', () => {
  const dir = scratchRepo();
  writeStamp({ tree: 'aaa', result: 'pass', rulesHash: rulesHash(), createdAt: '2000-01-01T00:00:00Z' }, dir);
  writeStamp({ tree: 'bbb', result: 'pass', rulesHash: rulesHash() }, dir);

  assert.equal(pruneStamps(30, dir), 1);
  assert.equal(readStamp('aaa', dir), null);
  assert.ok(readStamp('bbb', dir));
  rmSync(dir, { recursive: true, force: true });
});
