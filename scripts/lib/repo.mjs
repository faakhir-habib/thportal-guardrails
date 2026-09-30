import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export const bundleRoot = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The bundle is its own git repo, so asking git for the toplevel from inside it returns the bundle.
// The product clone is always two levels up: <root>/.claude/guardrails.
export const repoRoot = () => resolve(bundleRoot(), '..', '..');

export const stagedFiles = (cwd = repoRoot()) =>
  git(['diff', '--cached', '--name-only'], cwd).split('\n').filter(Boolean);

export const branchFiles = (base = 'origin/staging', cwd = repoRoot()) =>
  git(['diff', '--name-only', `${base}...HEAD`], cwd).split('\n').filter(Boolean);

export const trackedChanges = (cwd = repoRoot()) =>
  git(['status', '--porcelain'], cwd).split('\n').filter((l) => l && !l.startsWith('??'));

export const touchesBackend =(files) => files.some((f) => f.startsWith('backend/'));
export const touchesFrontend = (files) => files.some((f) => f.startsWith('frontend/'));

export const writeTree = (cwd = repoRoot()) => git(['write-tree'], cwd);
export const currentBranch = (cwd = repoRoot()) => git(['branch', '--show-current'], cwd);

export const isMerging = (cwd = repoRoot()) =>
  existsSync(join(git(['rev-parse', '--absolute-git-dir'], cwd), 'MERGE_HEAD'));

export const ticketForBranch = (cwd = repoRoot()) => {
  const branch = currentBranch(cwd);
  if (!branch) return null;
  try {
    return git(['config', '--get', `branch.${branch}.asanaTask`], cwd) || null;
  } catch {
    return null;
  }
};

export const config = () => JSON.parse(readFileSync(join(bundleRoot(), 'config.json'), 'utf8'));
