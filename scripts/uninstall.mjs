import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/repo.mjs';

const ROOT = repoRoot();
const EXCLUDES = ['/CLAUDE.md', '/backend/CLAUDE.md', '/backend/.claude/agents/', '/backend/.claude/skills/'];

const say = (line) => process.stdout.write(`${line}\n`);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
const gitDir = () => execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
const statePath = () => join(gitDir(), 'guardrails', 'installed.json');

if (!existsSync(statePath())) {
  say('Nothing to remove — no install was recorded for this clone.');
  process.exit(0);
}

const state = JSON.parse(readFileSync(statePath(), 'utf8'));

say('files');
let removed = 0;
let kept = 0;
for (const [rel, installedHash] of Object.entries(state.files ?? {})) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) continue;
  if (sha(path) !== installedHash) {
    say(`  kept     ${rel} — you edited it after install`);
    kept += 1;
    continue;
  }
  rmSync(path);
  say(`  removed  ${rel}`);
  removed += 1;
}

say('git');
const previous = state.previousHooksPath ?? '';
if (previous) {
  execFileSync('git', ['config', 'core.hooksPath', previous], { cwd: ROOT });
  say(`  restored hooks path -> ${previous}`);
} else {
  try {
    execFileSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: ROOT });
    say('  unset    hooks path');
  } catch {
    say('  ok       hooks path was already unset');
  }
}

const excludePath = join(gitDir(), 'info', 'exclude');
if (existsSync(excludePath)) {
  const lines = readFileSync(excludePath, 'utf8').split(/\r?\n/);
  const cleaned = lines.filter((l) => !EXCLUDES.includes(l) && l !== '# local Claude guardrails (never commit)');
  writeFileSync(excludePath, `${cleaned.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '')}\n`);
  say('  cleaned  git exclude entries');
}

say('claude');
const settingsPath = join(ROOT, '.claude', 'settings.json');
if (existsSync(settingsPath)) {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  delete settings.hooks;
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  say('  cleaned  hooks out of .claude/settings.json (attribution left as it is)');
}

rmSync(statePath());

say('');
say(`Removed ${removed} file(s), left ${kept} alone.`);
say('Kept on purpose: the bundle clone at .claude/guardrails, and .git/guardrails with your stamps.');
say('Delete those by hand if you want them gone. Restart Claude Code to drop the agent and skills.');
