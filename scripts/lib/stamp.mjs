import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { bundleRoot, repoRoot } from './repo.mjs';

const gitDir = (cwd) =>
  execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8' }).trim();

const stampDir = (cwd = repoRoot()) => join(gitDir(cwd), 'guardrails', 'stamps');

export const rulesHash = () => {
  const rules = readFileSync(join(bundleRoot(), 'rules', 'backend-rules.md'), 'utf8').replace(/\r/g, '');
  return createHash('sha256').update(rules).digest('hex').slice(0, 16);
};

export const stampPath = (tree, cwd = repoRoot()) => join(stampDir(cwd), `${tree}.json`);

export function writeStamp(stamp, cwd = repoRoot()) {
  const full = { createdAt: new Date().toISOString(), ...stamp };
  mkdirSync(stampDir(cwd), { recursive: true });
  const path = stampPath(full.tree, cwd);
  writeFileSync(path, JSON.stringify(full, null, 2));
  return path;
}

export function readStamp(tree, cwd = repoRoot()) {
  const path = stampPath(tree, cwd);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

export function verifyStamp(tree, cwd = repoRoot()) {
  const stamp = readStamp(tree, cwd);
  if (!stamp) return { ok: false, reason: 'no stamp for this staged content' };
  if (stamp.result !== 'pass') return { ok: false, reason: `the last validation did not pass (${stamp.result})` };
  if (stamp.rulesHash !== rulesHash()) return { ok: false, reason: 'the rules changed since this was validated' };
  return { ok: true, reason: 'stamp is current' };
}

export function pruneStamps(days, cwd = repoRoot()) {
  const dir = stampDir(cwd);
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const stamp = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (Date.parse(stamp.createdAt) < cutoff) {
      rmSync(join(dir, name));
      removed += 1;
    }
  }
  return removed;
}
