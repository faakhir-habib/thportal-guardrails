import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bundleRoot, repoRoot } from './lib/repo.mjs';

const BUNDLE = bundleRoot();
const ROOT = repoRoot();
const HOOKS_PATH = '.claude/guardrails/githooks';
const EXCLUDES = ['/CLAUDE.md', '/backend/CLAUDE.md', '/backend/.claude/agents/', '/backend/.claude/skills/'];

const say = (line) => process.stdout.write(`${line}\n`);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
const has = (bin, args) => spawnSync(bin, args, { encoding: 'utf8' }).status === 0;
const gitDir = () => execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
const statePath = () => join(gitDir(), 'guardrails', 'installed.json');

const loadState = () => (existsSync(statePath()) ? JSON.parse(readFileSync(statePath(), 'utf8')) : { files: {} });
const saveState = (state) => {
  mkdirSync(dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
};

function prerequisites() {
  const required = [['git', ['--version']], ['node', ['--version']], ['dotnet', ['--version']]];
  const optional = [['docker', ['info']], ['gh', ['--version']]];
  let ok = true;

  for (const [bin, args] of required) {
    if (has(bin, args)) say(`  ok       ${bin}`);
    else { say(`  MISSING  ${bin} — install it before using the guardrails`); ok = false; }
  }
  for (const [bin, args] of optional) {
    say(has(bin, args)
      ? `  ok       ${bin}`
      : `  warning  ${bin} is not available — ${bin === 'docker' ? 'the integration suite cannot run, so /validate will fail' : 'PR work will not work'}`);
  }
  return ok;
}

function planCopies() {
  const copies = [];
  for (const base of [join(ROOT, '.claude'), join(ROOT, 'backend', '.claude')]) {
    copies.push({ from: join(BUNDLE, 'agents', 'architecture-reviewer.md'), to: join(base, 'agents', 'architecture-reviewer.md') });
    for (const skill of readdirSync(join(BUNDLE, 'skills'))) {
      copies.push({ from: join(BUNDLE, 'skills', skill, 'SKILL.md'), to: join(base, 'skills', skill, 'SKILL.md') });
    }
  }
  copies.push({ from: join(BUNDLE, 'claude', 'CLAUDE.root.md'), to: join(ROOT, 'CLAUDE.md') });
  copies.push({ from: join(BUNDLE, 'claude', 'CLAUDE.backend.md'), to: join(ROOT, 'backend', 'CLAUDE.md') });
  return copies.filter((c) => existsSync(c.from));
}

function copyFiles(state) {
  let copied = 0;
  let kept = 0;
  for (const { from, to } of planCopies()) {
    const rel = to.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '').replace(/\\/g, '/');
    const source = sha(from);

    if (existsSync(to)) {
      const current = sha(to);
      if (current === source) { state.files[rel] = source; continue; }
      const installed = state.files[rel];
      if (installed && current !== installed) {
        say(`  kept     ${rel} — you edited this; the bundle's copy was not written`);
        kept += 1;
        continue;
      }
    }

    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    state.files[rel] = source;
    say(`  wrote    ${rel}`);
    copied += 1;
  }
  return { copied, kept };
}

function setHooksPath(state) {
  let current = '';
  try {
    current = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    current = '';
  }
  if (current === HOOKS_PATH) { say(`  ok       hooks path is ${HOOKS_PATH}`); return; }
  if (!state.previousHooksPath) state.previousHooksPath = current;
  execFileSync('git', ['config', 'core.hooksPath', HOOKS_PATH], { cwd: ROOT });
  say(`  wrote    hooks path ${current || '(unset)'} -> ${HOOKS_PATH}`);
}

function writeExcludes() {
  const path = join(gitDir(), 'info', 'exclude');
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const missing = EXCLUDES.filter((line) => !existing.split(/\r?\n/).includes(line));
  if (missing.length === 0) { say('  ok       git exclude entries'); return; }
  writeFileSync(path, `${existing.replace(/\s*$/, '')}\n\n# local Claude guardrails (never commit)\n${missing.join('\n')}\n`);
  say(`  wrote    ${missing.length} git exclude entr${missing.length === 1 ? 'y' : 'ies'}`);
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (base, patch) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v;
  return out;
};

function mergeSettings() {
  const partialPath = join(BUNDLE, 'claude', 'settings.partial.json');
  if (!existsSync(partialPath)) return;
  const target = join(ROOT, '.claude', 'settings.json');
  const partial = JSON.parse(readFileSync(partialPath, 'utf8'));
  const current = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
  const merged = deepMerge(current, partial);
  if (JSON.stringify(merged) === JSON.stringify(current)) { say('  ok       .claude/settings.json'); return; }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`);
  say('  wrote    .claude/settings.json (hooks and attribution merged in)');
}

say(`Installing the guardrails into ${ROOT}`);
say('prerequisites');
const ready = prerequisites();

say('files');
const state = loadState();
const { copied, kept } = copyFiles(state);

say('git');
setHooksPath(state);
writeExcludes();

say('claude');
mergeSettings();
saveState(state);

const version = existsSync(join(BUNDLE, 'VERSION')) ? readFileSync(join(BUNDLE, 'VERSION'), 'utf8').trim() : 'unknown';
say('');
say(`Guardrails ${version} installed — ${copied} file(s) written, ${kept} left alone.`);
say('Restart Claude Code to register the agent and skills.');
if (!ready) {
  say('Something required is missing; fix it before relying on the gate.');
  process.exit(1);
}
