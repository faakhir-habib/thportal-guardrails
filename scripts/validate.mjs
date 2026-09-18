import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { currentBranch, repoRoot, stagedFiles, ticketForBranch, touchesBackend, writeTree } from './lib/repo.mjs';
import { runBackendChecks } from './lib/checks.mjs';
import { rulesHash, writeStamp } from './lib/stamp.mjs';

const unstagedInStaged = () => {
  const staged = new Set(stagedFiles());
  return execFileSync('git', ['diff', '--name-only'], { cwd: repoRoot(), encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && staged.has(f));
};

const args = process.argv.slice(2);
const reviewPath = args.includes('--stamp') ? args[args.indexOf('--stamp') + 1] : null;

// The checks take minutes, so their result is cached against the tree they ran on. Stamping right
// after a run reuses it; a changed tree means a changed diff, and they run again.
const gitDir = () => execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repoRoot(), encoding: 'utf8' }).trim();
const cachePath = (tree) => join(gitDir(), 'guardrails', 'checks', `${tree}.json`);

const cacheChecks = (tree, payload) => {
  mkdirSync(join(gitDir(), 'guardrails', 'checks'), { recursive: true });
  writeFileSync(cachePath(tree), JSON.stringify(payload));
};

const cachedChecks = (tree) => (existsSync(cachePath(tree)) ? JSON.parse(readFileSync(cachePath(tree), 'utf8')) : null);

const files = stagedFiles();

if (!touchesBackend(files)) {
  console.log(JSON.stringify({ result: 'skip', reason: 'no backend files staged' }, null, 2));
  process.exit(0);
}

const dirty = unstagedInStaged();
if (dirty.length) {
  console.log(JSON.stringify({
    result: 'fail',
    reason: 'staged files have unstaged edits — what would be tested is not what would be committed',
    files: dirty,
  }, null, 2));
  process.exit(1);
}

const cached = reviewPath ? cachedChecks(writeTree()) : null;

const { result, checks } = cached ?? runBackendChecks({
  files,
  onProgress: (c) => process.stderr.write(`${c.name}: ${c.status} (${(c.durationMs / 1000).toFixed(0)}s)\n`),
});

if (cached) process.stderr.write('checks: reusing the result cached for this exact staged content\n');

// After the checks, because formatting rewrites and re-stages files.
const tree = writeTree();
if (!cached) cacheChecks(tree, { result, checks });

if (!reviewPath) {
  console.log(JSON.stringify({ tree, result, checks }, null, 2));
  process.exit(result === 'pass' ? 0 : 1);
}

// QA cases come from the ticket the branch is linked to. Without a link there is nothing to run, and
// saying so in the stamp is better than implying the cases passed.
function runQaCases() {
  const ticket = ticketForBranch();
  if (!ticket) return { skipped: 'this branch is not linked to a ticket' };

  const workDir = `.claude/work/${ticket}`;
  if (!existsSync(join(repoRoot(), workDir, 'qa-cases.json'))) {
    return { skipped: `no qa-cases.json in ${workDir} — run /ticket first` };
  }

  process.stderr.write('qa: running the in-scope cases over HTTP\n');
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'qa-verify.mjs'), '--work', workDir], {
    cwd: repoRoot(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  process.stderr.write(r.stderr ?? '');
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { result: 'fail', reason: 'the QA runner produced no result', output: (r.stdout ?? r.stderr ?? '').slice(-2000) };
  }
}

const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
const all = review.violations ?? [];
const violations = all.filter((v) => !v.waived);
const waivers = all.filter((v) => v.waived);

const qa = runQaCases();
const qaFailed = qa.result === 'fail';

const overall = result === 'pass' && violations.length === 0 && !qaFailed ? 'pass' : 'fail';

const stampFile = writeStamp({
  tree,
  branch: currentBranch(),
  asanaTask: ticketForBranch(),
  rulesHash: rulesHash(),
  kind: 'part3',
  checks,
  review: { violations, suggestions: review.suggestions ?? [], waivers },
  qa,
  result: overall,
});

console.log(JSON.stringify({
  tree,
  result: overall,
  stamp: stampFile,
  violations: violations.length,
  waivers: waivers.length,
  qa: qa.skipped ? `skipped — ${qa.skipped}` : `${qa.passed ?? 0} passed, ${qa.failed ?? 0} failed`,
}, null, 2));
process.exit(overall === 'pass' ? 0 : 1);
