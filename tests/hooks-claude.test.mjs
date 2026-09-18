import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCommand, evaluateWrite } from '../scripts/hooks/pre-tool-use.mjs';

test('the ways around the gate are denied', () => {
  for (const cmd of [
    'git commit --no-verify -m "x"',
    'git commit -n -m "x"',
    'HUSKY=0 git commit -m "x"',
    'git config core.hooksPath .husky',
    'git push --force origin feat/x',
    'git push origin staging',
    'git push origin main',
    'echo "{}" > .git/guardrails/stamps/abc.json',
  ]) {
    assert.equal(evaluateCommand(cmd).deny, true, cmd);
  }
});

test('ordinary git work is allowed', () => {
  for (const cmd of [
    'git commit -m "feat(be): add A"',
    'git push origin feat/x',
    'git push origin feature/main-menu',
    'git push --force-with-lease origin feat/x',
    'git status --short',
    'node .claude/guardrails/scripts/validate.mjs',
    'git log --oneline -5',
  ]) {
    assert.equal(evaluateCommand(cmd).deny, false, cmd);
  }
});

test('writing a stamp by hand is denied, writing elsewhere is not', () => {
  assert.equal(evaluateWrite('C:/file-management-server/.git/guardrails/stamps/a.json').deny, true);
  assert.equal(evaluateWrite('C:\\file-management-server\\.git\\guardrails\\stamps\\a.json').deny, true);
  assert.equal(evaluateWrite('C:/file-management-server/backend/Service/A.cs').deny, false);
});
