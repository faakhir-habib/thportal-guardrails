import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, stagedCsIncludes, formatBackend } from '../scripts/lib/checks.mjs';

test('runCheck reports a passing command', () => {
  const r = runCheck('echo', process.execPath, ['-e', 'console.log("hi")']);
  assert.equal(r.status, 'pass');
  assert.match(r.output, /hi/);
  assert.ok(r.durationMs >= 0);
});

test('runCheck reports a failing command and keeps its output', () => {
  const r = runCheck('boom', process.execPath, ['-e', 'console.error("bad things"); process.exit(1)']);
  assert.equal(r.status, 'fail');
  assert.match(r.output, /bad things/);
});

test('runCheck fails cleanly when the binary does not exist', () => {
  const r = runCheck('missing', 'definitely-not-a-binary-xyz', []);
  assert.equal(r.status, 'fail');
  assert.match(r.output, /ENOENT|not found|not recognized/i);
});

test('stagedCsIncludes keeps backend .cs files and drops the backend/ prefix', () => {
  const files = ['backend/Service/A.cs', 'backend/appsettings.json', 'frontend/a.ts', 'backend/Repository/B.cs'];
  assert.deepEqual(stagedCsIncludes(files), ['Service/A.cs', 'Repository/B.cs']);
});

test('format is a trivial pass when no .cs file is staged', () => {
  const r = formatBackend(['backend/appsettings.json']);
  assert.equal(r.status, 'pass');
  assert.match(r.output, /no staged/i);
});
