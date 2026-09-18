# Guardrails Stage 1, Part 2 — The Commit Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A commit that touches `backend/` cannot land unless the exact staged content has passed
format, build, the integration suite and an architecture review — for Claude and for a human alike.

**Architecture:** `/validate` runs the checks and the reviewer, then writes a **stamp** keyed to
`git write-tree` — the hash of the exact staged content. The `pre-commit` hook re-computes that hash
and refuses the commit when no passing stamp exists for it. Because the key is the content, editing a
single line invalidates the stamp; editing only the commit message does not. Claude Code hooks stop
Claude from going around the gate, and an installer wires everything into a clone.

**Tech Stack:** Node 24 ESM (`node:test`, `node:assert`, `node:crypto`, `node:child_process`), POSIX
`sh` hooks run by Git for Windows, .NET 8 CLI, Docker (Testcontainers).

**Spec:** `C:\file-management-server\.claude\guardrails\docs\design.md`, sections 3 (Enforcement),
5 (Distribution) and 7 (Configuration).

**Two deliberate changes from the spec's task split:**

1. **`/validate` moves into this plan.** The spec listed it in Part 3, but a gate with nothing that
   can produce a stamp is a lock with no key. This plan builds `/validate` at its Part 2 depth —
   format, build, tests, architecture review. Part 3 extends it with ticket-derived QA cases.
2. **`scripts/secrets.mjs` moves to Part 3.** Nothing in the gate needs an Asana or GitHub token; the
   first caller is `/ticket`.

## Global Constraints

- **Backend only.** A commit with no `backend/` file passes straight through to the repo's own husky
  behaviour — no stamp, no message rules. Frontend work is untouched.
- **The product repo gets no commits and no tracked-file edits.** Everything lives in the bundle, or
  in paths hidden per clone through `.git/info/exclude`.
- **No Claude attribution** in commit messages, PR descriptions or file contents.
- **Commit identity in the bundle repo** stays `faakhir-habib <faakhirhabib@gmail.com>`.
- **Conventional Commits** with a one-line body saying why.
- **Minimal comments** in the scripts: a comment only where the code cannot say it — a Windows path
  quirk, a git exit-code meaning.
- **The gate must never silently pass.** Every refusal names the reason and the command that fixes it.
  Any check that cannot run (Docker down, `dotnet` missing) is a **failure**, not a skip.
- **Do not push** until the final task, after the user has reviewed.

## Verified environment facts

Confirmed on this machine on 2026-09-18. Do not re-derive.

| Fact | Value |
|---|---|
| Node | v24.19.0 — `node --test`, `node:assert`, ESM by `.mjs` |
| .NET SDK | 10.0.301 (the solution targets net8.0) |
| Git | 2.45.1.windows.1 — hooks run under Git for Windows `sh` |
| Docker | 28.5.1, running |
| `core.hooksPath` today | `frontend/.husky/_` — husky's, set by `npm install` in `frontend/` |
| Frontend tooling present | `frontend/node_modules/.bin/lint-staged`, `frontend/node_modules/.bin/commitlint` |
| commitlint config | `frontend/commitlint.config.js`, one rule: `header-min-length` ≥ 10 |
| Bundle already installs | agent + skill into both `.claude/` and `backend/.claude/`, `CLAUDE.md` into root and `backend/`, and writes `.git/info/exclude` entries |
| Product repo dirt | `backend/docs/SECRETS.md` is the user's own untracked file — never touch it |

## File Structure

Paths are relative to `C:\file-management-server\.claude\guardrails\`.

| File | Responsibility |
|---|---|
| `scripts/lib/repo.mjs` | Git facts: repo root, staged files, `git write-tree`, branch, merge-in-progress, ticket link |
| `scripts/lib/stamp.mjs` | Stamp path, rules hash, read, write, verify |
| `scripts/lib/checks.mjs` | Running `dotnet format`, `dotnet build`, `dotnet test`, and shaping their results |
| `scripts/gate.mjs` | The decision the `pre-commit` hook makes, as a function and as a CLI |
| `scripts/commit-msg.mjs` | Message rules: conventional header, body, trailer, no attribution |
| `scripts/validate.mjs` | The deterministic half of `/validate`: checks, then a stamp |
| `scripts/hooks/pre-tool-use.mjs` | Claude Code `PreToolUse` guard |
| `scripts/hooks/session-start.mjs` | Claude Code `SessionStart`: hooks path, stamp pruning, branch context |
| `githooks/pre-commit` | Delegates to `gate.mjs`, after `lint-staged` for frontend files |
| `githooks/prepare-commit-msg` | Adds the `Asana:` trailer from the branch's ticket link |
| `githooks/commit-msg` | Delegates to `commit-msg.mjs`, then the repo's commitlint for frontend commits |
| `skills/thportal-validate/SKILL.md` | `/validate` — runs `validate.mjs`, then the reviewer, then stamps |
| `scripts/install.mjs` | Replaces `sync-local.sh`: copies, hooks path, excludes, settings merge, prerequisites |
| `scripts/uninstall.mjs` | Puts the clone back exactly as it was |
| `config.json` | `gate.enabled`, `gate.requireTicket`, `stamp.pruneDays`, paths |
| `tests/*.test.mjs` | `node --test` unit tests for the modules |
| `tests/hooks.test.sh` | The hooks exercised end to end in a throwaway git repo |

---

### Task 1: Repo facts and the stamp

**Files:**
- Create: `scripts/lib/repo.mjs`, `scripts/lib/stamp.mjs`, `config.json`
- Test: `tests/stamp.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `repo.mjs` — `repoRoot()`, `bundleRoot()`, `stagedFiles()` → `string[]`, `touchesBackend(files)` → `boolean`,
    `writeTree()` → `string`, `currentBranch()` → `string`, `isMerging()` → `boolean`,
    `ticketForBranch()` → `string | null`.
  - `stamp.mjs` — `rulesHash()` → `string`, `stampPath(tree)` → `string`,
    `writeStamp(stamp)` → `string`, `readStamp(tree)` → `object | null`,
    `verifyStamp(tree)` → `{ ok: boolean, reason: string }`, `pruneStamps(days)` → `number`.
  - `config.json` — `{ "gate": { "enabled": true, "requireTicket": false }, "stamp": { "pruneDays": 30 } }`.

- [ ] **Step 1: Write the failing test**

`tests/stamp.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd /c/file-management-server/.claude/guardrails
node --test tests/stamp.test.mjs
```
Expected: FAIL — `Cannot find module '../scripts/lib/stamp.mjs'`.

- [ ] **Step 3: Write `scripts/lib/repo.mjs`**

```javascript
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

export const touchesBackend = (files) => files.some((f) => f.startsWith('backend/'));
export const touchesFrontend = (files) => files.some((f) => f.startsWith('frontend/'));

export const writeTree = (cwd = repoRoot()) => git(['write-tree'], cwd);
export const currentBranch = (cwd = repoRoot()) => git(['branch', '--show-current'], cwd);
export const isMerging = (cwd = repoRoot()) => existsSync(join(git(['rev-parse', '--git-dir'], cwd), 'MERGE_HEAD'));

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
```

- [ ] **Step 4: Write `scripts/lib/stamp.mjs`**

```javascript
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { bundleRoot, repoRoot } from './repo.mjs';

const gitDir = (cwd) => execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd, encoding: 'utf8' }).trim();
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
```

- [ ] **Step 5: Write `config.json`**

```json
{
  "gate": {
    "enabled": true,
    "requireTicket": false
  },
  "stamp": {
    "pruneDays": 30
  }
}
```

`requireTicket` stays `false` until `/ticket` exists in Part 3 — turning it on now would block every
commit on a branch nobody has linked yet.

- [ ] **Step 6: Run the tests until they pass**

```bash
cd /c/file-management-server/.claude/guardrails
node --test tests/stamp.test.mjs
```
Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /c/file-management-server/.claude/guardrails
git add scripts/lib config.json tests/stamp.test.mjs
git commit -m "feat: add the validation stamp keyed to the staged tree

Keying on git write-tree is what makes the gate honest: change one line and the stamp no longer applies, change only the message and it still does."
```

---

### Task 2: The checks

**Files:**
- Create: `scripts/lib/checks.mjs`
- Test: `tests/checks.test.mjs`

**Interfaces:**
- Consumes: `repo.mjs`.
- Produces: `runCheck(name, command, args, opts)` → `{ name, status: 'pass'|'fail', durationMs, output }`;
  `formatBackend()`, `buildBackend()`, `testBackend()`, `dockerRunning()` → `boolean`;
  `runBackendChecks({ onProgress })` → `{ result: 'pass'|'fail', checks: {...} }`.

- [ ] **Step 1: Write the failing test**

`tests/checks.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from '../scripts/lib/checks.mjs';

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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test tests/checks.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `scripts/lib/checks.mjs`**

```javascript
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { repoRoot } from './repo.mjs';

const TAIL = 4000;

export function runCheck(name, command, args, opts = {}) {
  const started = Date.now();
  const r = spawnSync(command, args, {
    cwd: opts.cwd ?? repoRoot(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`.slice(-TAIL);
  return { name, status: r.status === 0 ? 'pass' : 'fail', durationMs: Date.now() - started, output };
}

const backend = () => join(repoRoot(), 'backend');

export const dockerRunning = () => runCheck('docker', 'docker', ['info']).status === 'pass';

export const formatBackend = () =>
  runCheck('format', 'dotnet', ['format', 'FileManagementServer.sln', '--verify-no-changes'], { cwd: backend() });

export const buildBackend = () =>
  runCheck('build', 'dotnet', ['build', 'FileManagementServer.sln', '-c', 'Debug', '--nologo'], { cwd: backend() });

export const testBackend = () =>
  runCheck('integrationTests', 'dotnet', [
    'test', 'FileManager.IntegrationTests/FileManager.IntegrationTests.csproj', '-c', 'Debug', '--nologo',
  ], { cwd: backend() });

export function runBackendChecks({ onProgress = () => {} } = {}) {
  const checks = {};
  const record = (r) => {
    checks[r.name] = { status: r.status, durationMs: r.durationMs, output: r.status === 'fail' ? r.output : '' };
    onProgress(r);
    return r.status === 'pass';
  };

  if (!dockerRunning()) {
    checks.docker = { status: 'fail', durationMs: 0, output: 'Docker is not running; the integration suite cannot start its SQL Server container.' };
    return { result: 'fail', checks };
  }

  if (!record(formatBackend())) return { result: 'fail', checks };
  if (!record(buildBackend())) return { result: 'fail', checks };
  if (!record(testBackend())) return { result: 'fail', checks };
  return { result: 'pass', checks };
}
```

- [ ] **Step 4: Run the tests until they pass**

```bash
node --test tests/checks.test.mjs
```
Expected: 3 tests pass.

- [ ] **Step 5: Time the real checks once, because everything downstream depends on it**

```bash
cd /c/file-management-server/.claude/guardrails
node -e "import('./scripts/lib/checks.mjs').then(async m => { const t=Date.now(); const r=m.runBackendChecks({onProgress:c=>console.log(c.name, c.status, (c.durationMs/1000).toFixed(0)+'s')}); console.log('total', ((Date.now()-t)/1000).toFixed(0)+'s', r.result); })"
```
Expected: each check prints with its duration. Write the real numbers into `README.md` under a
"How long validation takes" line — a developer who knows it is four minutes waits; one who does not
kills it and works around the gate.

If `dotnet format` fails on files nobody touched, do not loosen the check — note the finding and
switch the format step to the staged files only:
`dotnet format FileManagementServer.sln --include <staged .cs paths> --verify-no-changes`.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/checks.mjs tests/checks.test.mjs README.md
git commit -m "feat: add the backend checks that feed the stamp

Docker missing is a failure rather than a skip, because a skipped test suite is exactly the hole the gate exists to close."
```

---

### Task 3: The gate and the pre-commit hook

**Files:**
- Create: `scripts/gate.mjs`, `githooks/pre-commit`
- Test: `tests/gate.test.mjs`, `tests/hooks.test.sh`

**Interfaces:**
- Consumes: `repo.mjs`, `stamp.mjs`, `config.json`.
- Produces: `decide({ files, merging, tree, ticket, cfg })` → `{ allow: boolean, reason: string, hint?: string }`,
  and a CLI that exits 0 to allow, 1 to block. `githooks/pre-commit` is what git runs.

- [ ] **Step 1: Write the failing test**

`tests/gate.test.mjs`:

```javascript
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
  const d = decide({ files: ['backend/Service/A.cs'], merging: false, cfg, verify: () => fail('no stamp for this staged content') });
  assert.equal(d.allow, false);
  assert.match(d.reason, /no stamp/i);
  assert.match(d.hint, /\/validate/);
});

test('requireTicket blocks an unlinked branch only when it is turned on', () => {
  const on = { gate: { enabled: true, requireTicket: true } };
  const linked = decide({ files: ['backend/A.cs'], merging: false, cfg: on, ticket: '123', verify: pass });
  const unlinked = decide({ files: ['backend/A.cs'], merging: false, cfg: on, ticket: null, verify: pass });
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test tests/gate.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `scripts/gate.mjs`**

```javascript
import { config, currentBranch, isMerging, stagedFiles, ticketForBranch, touchesBackend, writeTree } from './lib/repo.mjs';
import { verifyStamp } from './lib/stamp.mjs';

export function decide({ files, merging, tree, ticket, cfg, verify = verifyStamp }) {
  if (!cfg.gate.enabled) return { allow: true, reason: 'the gate is disabled in config.json' };
  if (!touchesBackend(files)) return { allow: true, reason: 'no backend files in this commit' };
  if (merging) return { allow: true, reason: 'merge commit — the merged code was gated on its own way in' };

  if (cfg.gate.requireTicket && !ticket) {
    return {
      allow: false,
      reason: 'this branch is not linked to a ticket',
      hint: `git config branch.${currentBranch()}.asanaTask <gid>   (or run /ticket)`,
    };
  }

  const stamp = verify(tree);
  if (!stamp.ok) {
    return {
      allow: false,
      reason: stamp.reason,
      hint: 'run /validate in Claude Code, then commit again',
    };
  }
  return { allow: true, reason: 'validated' };
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const files = stagedFiles();
  const d = decide({ files, merging: isMerging(), tree: writeTree(), ticket: ticketForBranch(), cfg: config() });
  if (d.allow) process.exit(0);
  process.stderr.write(`\nCommit blocked: ${d.reason}\n  ${d.hint}\n\n`);
  process.exit(1);
}
```

- [ ] **Step 4: Write `githooks/pre-commit`**

```sh
#!/bin/sh
# Frontend formatting first: lint-staged rewrites files, and the tree hash must be taken after it.
# Skipped when the frontend has never been installed — that is a clone that does no frontend work,
# not a reason to refuse the commit.
if git diff --cached --name-only | grep -q '^frontend/' && [ -x frontend/node_modules/.bin/lint-staged ]; then
  (cd frontend && npx --no -- lint-staged) || exit 1
  git add -u -- frontend
fi

BUNDLE="$(git rev-parse --show-toplevel)/.claude/guardrails"
[ -f "$BUNDLE/scripts/gate.mjs" ] || exit 0
node "$BUNDLE/scripts/gate.mjs" || exit 1
```

The bundle-missing case exits 0 on purpose: a developer who removes the bundle gets their clone back,
not a repository they cannot commit to.

- [ ] **Step 5: Write `tests/hooks.test.sh`**

```sh
#!/bin/sh
# Exercises the real hooks in a throwaway repo. Run: sh tests/hooks.test.sh
set -e
BUNDLE="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (expected $3, got $2)"; fi; }

WORK="$(mktemp -d)"
cd "$WORK"
git init -q -b main
git config user.email t@t; git config user.name t
mkdir -p .claude backend frontend
cp -r "$BUNDLE" .claude/guardrails
git config core.hooksPath .claude/guardrails/githooks

echo "frontend only commit"
echo "x" > frontend/a.ts
git add frontend/a.ts
git commit -q -m "chore(fe): touch a file" 2>/dev/null; check "frontend-only commit is allowed" "$?" "0"

echo "backend commit with no stamp"
echo "class A {}" > backend/A.cs
git add backend/A.cs
git commit -q -m "feat(be): add A" 2>/dev/null; check "backend commit with no stamp is blocked" "$?" "1"

echo "backend commit with a stamp"
TREE="$(git write-tree)"
mkdir -p .git/guardrails/stamps
RULES_HASH="$(node -e "import('$BUNDLE/scripts/lib/stamp.mjs').then(m=>console.log(m.rulesHash()))")"
printf '{"tree":"%s","result":"pass","rulesHash":"%s","createdAt":"%s"}' \
  "$TREE" "$RULES_HASH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ".git/guardrails/stamps/$TREE.json"
git commit -q -m "feat(be): add A" 2>/dev/null; check "backend commit with a passing stamp is allowed" "$?" "0"

echo "stale rules hash"
echo "class B {}" > backend/B.cs
git add backend/B.cs
TREE2="$(git write-tree)"
printf '{"tree":"%s","result":"pass","rulesHash":"stale","createdAt":"%s"}' \
  "$TREE2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ".git/guardrails/stamps/$TREE2.json"
git commit -q -m "feat(be): add B" 2>/dev/null; check "a stamp from older rules is refused" "$?" "1"

echo
echo "passed: $PASS   failed: $FAIL"
cd /; rm -rf "$WORK"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 6: Run both test files**

```bash
cd /c/file-management-server/.claude/guardrails
node --test tests/gate.test.mjs
sh tests/hooks.test.sh
```
Expected: the unit tests pass, and the hook script prints 4 ok lines and `failed: 0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/gate.mjs githooks/pre-commit tests/gate.test.mjs tests/hooks.test.sh
git commit -m "feat: block a backend commit whose staged content was never validated

The hook exits 0 when the bundle is absent, so removing the bundle gives a developer their clone back rather than a repo they cannot commit to."
```

---

### Task 4: The commit message rules

**Files:**
- Create: `scripts/commit-msg.mjs`, `githooks/prepare-commit-msg`, `githooks/commit-msg`
- Modify: `tests/hooks.test.sh` (add the message cases)
- Test: `tests/commit-msg.test.mjs`

**Interfaces:**
- Consumes: `repo.mjs`.
- Produces: `checkMessage(text, { ticket, requireTicket })` → `{ ok: boolean, problems: string[] }`;
  `addTrailer(text, ticketUrl)` → `string`.

- [ ] **Step 1: Write the failing test**

`tests/commit-msg.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test tests/commit-msg.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `scripts/commit-msg.mjs`**

```javascript
import { readFileSync, writeFileSync } from 'node:fs';
import { config, ticketForBranch } from './lib/repo.mjs';

const HEADER = /^(feat|fix|chore|refactor|test|docs|style|perf|build|ci|revert)(\([a-z0-9._\-/]+\))?!?: .+/;
const ATTRIBUTION = [
  /co-authored-by:.*(claude|anthropic)/i,
  /noreply@anthropic\.com/i,
  /generated with .*claude/i,
  /🤖/,
];
const TRAILER = /^Asana:\s*(\S+)/im;

const strip = (text) => text.split('\n').filter((l) => !l.startsWith('#')).join('\n');

export function checkMessage(raw, { ticket = null, requireTicket = false } = {}) {
  const text = strip(raw).trim();
  const [header, ...rest] = text.split('\n');
  const problems = [];

  if (!HEADER.test(header)) {
    problems.push('the header is not Conventional Commits — use "feat(scope): short summary"');
  }

  const body = rest.filter((l) => l.trim() && !/^[A-Za-z-]+:\s/.test(l));
  if (body.length === 0) {
    problems.push('the body is missing — one to three lines saying why, not what');
  }

  if (ATTRIBUTION.some((re) => re.test(text))) {
    problems.push('the message mentions Claude — attribution never goes in a commit');
  }

  if (requireTicket && ticket) {
    const match = text.match(TRAILER);
    if (!match) problems.push(`the Asana trailer is missing — "Asana: <url ending in ${ticket}>"`);
    else if (!match[1].includes(ticket)) problems.push('the Asana trailer points at a different ticket than the branch');
  }

  return { ok: problems.length === 0, problems };
}

export function addTrailer(raw, ticketUrl) {
  if (TRAILER.test(strip(raw))) return raw;
  return `${raw.replace(/\s*$/, '')}\n\nAsana: ${ticketUrl}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const path = process.argv[2];
  const ticket = ticketForBranch();
  const { requireTicket } = config().gate;
  const { ok, problems } = checkMessage(readFileSync(path, 'utf8'), { ticket, requireTicket });
  if (ok) process.exit(0);
  process.stderr.write(`\nCommit message rejected:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\n`);
  process.exit(1);
}
```

- [ ] **Step 4: Write `githooks/prepare-commit-msg`**

```sh
#!/bin/sh
MSG_FILE="$1"
SOURCE="$2"
[ "$SOURCE" = "merge" ] && exit 0

BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || exit 0
TICKET="$(git config --get "branch.$BRANCH.asanaTask" || true)"
[ -n "$TICKET" ] || exit 0

grep -qi '^Asana:' "$MSG_FILE" && exit 0
printf '\nAsana: https://app.asana.com/1/1209040875779194/project/1209042358568959/task/%s\n' "$TICKET" >> "$MSG_FILE"
```

- [ ] **Step 5: Write `githooks/commit-msg`**

```sh
#!/bin/sh
MSG_FILE="$1"
ROOT="$(git rev-parse --show-toplevel)"

# A merge's message is git's own; the merged commits were checked on their way in.
[ -f "$ROOT/.git/MERGE_HEAD" ] && exit 0

if git diff --cached --name-only | grep -q '^backend/'; then
  [ -f "$ROOT/.claude/guardrails/scripts/commit-msg.mjs" ] || exit 0
  node "$ROOT/.claude/guardrails/scripts/commit-msg.mjs" "$MSG_FILE" || exit 1
fi

if git diff --cached --name-only | grep -q '^frontend/' && [ -x "$ROOT/frontend/node_modules/.bin/commitlint" ]; then
  (cd "$ROOT/frontend" && npx --no -- commitlint --edit "$MSG_FILE") || exit 1
fi
```

Both frontend steps are guarded on the tool actually being installed. Without the guard the hook
harness — and any clone that has never run `npm install` — would fail on `npx` rather than on
anything the developer did.

- [ ] **Step 6: Add the message cases to `tests/hooks.test.sh`**

Insert before the final summary, after the existing gate cases:

```sh
echo "commit message rules"
echo "class C {}" > backend/C.cs
git add backend/C.cs
TREE3="$(git write-tree)"
printf '{"tree":"%s","result":"pass","rulesHash":"%s","createdAt":"%s"}' \
  "$TREE3" "$RULES_HASH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ".git/guardrails/stamps/$TREE3.json"

git commit -q -m "added stuff" 2>/dev/null; check "a non-conventional header is refused" "$?" "1"
git commit -q -m "feat(be): add C" 2>/dev/null; check "a header with no body is refused" "$?" "1"
git commit -q -m "feat(be): add C

Co-Authored-By: Claude <noreply@anthropic.com>" 2>/dev/null; check "attribution is refused" "$?" "1"
git commit -q -m "feat(be): add C

C is needed because B could not carry the flag." 2>/dev/null; check "a good message is accepted" "$?" "0"

echo "the Asana trailer is added from the branch link"
git config branch.main.asanaTask 1218492088693885
echo "class D {}" > backend/D.cs
git add backend/D.cs
TREE4="$(git write-tree)"
printf '{"tree":"%s","result":"pass","rulesHash":"%s","createdAt":"%s"}' \
  "$TREE4" "$RULES_HASH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ".git/guardrails/stamps/$TREE4.json"
git commit -q -m "feat(be): add D

D exists so the trailer has something to attach to."
git log -1 --format=%B | grep -q "Asana: .*1218492088693885"; check "the trailer was appended" "$?" "0"
```

- [ ] **Step 7: Run everything**

```bash
node --test tests/commit-msg.test.mjs
sh tests/hooks.test.sh
```
Expected: all unit tests pass; the hook script reports `failed: 0` across 9 checks.

- [ ] **Step 8: Commit**

```bash
git add scripts/commit-msg.mjs githooks/prepare-commit-msg githooks/commit-msg tests/commit-msg.test.mjs tests/hooks.test.sh
git commit -m "feat: enforce the commit message shape and add the Asana trailer

git blame is only useful if the commit says why, points at its ticket, and never pretends a tool wrote it."
```

---

### Task 5: `/validate`

**Files:**
- Create: `scripts/validate.mjs`, `skills/thportal-validate/SKILL.md`

**Interfaces:**
- Consumes: `repo.mjs`, `checks.mjs`, `stamp.mjs`, and the `architecture-reviewer` agent from Part 1.
- Produces: `node scripts/validate.mjs --checks-only` → prints JSON
  `{ tree, checks, result }` and writes no stamp; `node scripts/validate.mjs --stamp <review.json>`
  → merges the reviewer's findings, writes the stamp and prints its path. `/validate` is the skill
  that ties the two together.

- [ ] **Step 1: Write `scripts/validate.mjs`**

```javascript
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { repoRoot, stagedFiles, touchesBackend, writeTree } from './lib/repo.mjs';
import { runBackendChecks } from './lib/checks.mjs';
import { rulesHash, writeStamp } from './lib/stamp.mjs';
import { currentBranch, ticketForBranch } from './lib/repo.mjs';

const unstagedInStaged = () => {
  const staged = new Set(stagedFiles());
  return execFileSync('git', ['diff', '--name-only'], { cwd: repoRoot(), encoding: 'utf8' })
    .split('\n').filter((f) => f && staged.has(f));
};

const args = process.argv.slice(2);
const reviewPath = args.includes('--stamp') ? args[args.indexOf('--stamp') + 1] : null;

const files = stagedFiles();
if (!touchesBackend(files)) {
  console.log(JSON.stringify({ result: 'skip', reason: 'no backend files staged' }));
  process.exit(0);
}

const dirty = unstagedInStaged();
if (dirty.length) {
  console.log(JSON.stringify({ result: 'fail', reason: 'staged files have unstaged edits', files: dirty }));
  process.exit(1);
}

const { result, checks } = runBackendChecks({
  onProgress: (c) => process.stderr.write(`${c.name}: ${c.status} (${(c.durationMs / 1000).toFixed(0)}s)\n`),
});

const tree = writeTree();

if (!reviewPath) {
  console.log(JSON.stringify({ tree, result, checks }, null, 2));
  process.exit(result === 'pass' ? 0 : 1);
}

const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
const violations = (review.violations ?? []).filter((v) => !v.waived);
const overall = result === 'pass' && violations.length === 0 ? 'pass' : 'fail';

const path = writeStamp({
  tree,
  branch: currentBranch(),
  asanaTask: ticketForBranch(),
  rulesHash: rulesHash(),
  kind: 'part2',
  checks,
  review: { violations, suggestions: review.suggestions ?? [], waivers: (review.violations ?? []).filter((v) => v.waived) },
  result: overall,
});

console.log(JSON.stringify({ tree, result: overall, stamp: path, violations: violations.length }, null, 2));
process.exit(overall === 'pass' ? 0 : 1);
```

- [ ] **Step 2: Write `skills/thportal-validate/SKILL.md`**

````markdown
---
name: thportal-validate
description: "Validates the staged backend changes before a commit: dotnet format, the solution build, the integration suite, and an architecture review of the staged diff against .claude/guardrails/rules/backend-rules.md. Writes a stamp keyed to the staged content, which the pre-commit hook requires. Use before committing backend work, or whenever a commit was blocked for having no stamp."
---

# Validate

Run this before committing backend changes. It takes minutes, not seconds — the integration suite
boots a real SQL Server container.

## Step 1: Check what is staged

```bash
git diff --cached --name-only
```

Nothing staged, or nothing under `backend/` — say so and stop. The gate does not apply.

## Step 2: Run the checks

```bash
node .claude/guardrails/scripts/validate.mjs
```

This refuses to run when a staged file has unstaged edits, because then what is tested is not what
would be committed. It prints `{ tree, result, checks }`.

If a check fails, show the developer the failing output and stop. Do not review, do not stamp. A
failing build is not a review problem.

## Step 3: Review the staged diff

```bash
git diff --cached -- backend/ > "$SCRATCH/staged.diff"
```

Dispatch the `architecture-reviewer` agent:

> Review the diff at `<path>` and report against the backend rules. Output JSON only.

Save its JSON to `$SCRATCH/review.json`.

## Step 4: Verify the violations before they block anything

Follow Step 4 of `/thportal-review`: check each violation against the repository, not just the diff.
Drop what you cannot substantiate.

If the developer disputes a finding and is right, the rules file is what needs fixing — say so. If
they want to proceed anyway, add `"waived": true` and a `"waivedReason"` to that finding in
`review.json`; waivers are recorded in the stamp and belong in the PR description.

## Step 5: Stamp

```bash
node .claude/guardrails/scripts/validate.mjs --stamp "$SCRATCH/review.json"
```

Report the result: each check with its time, the violations, and either "stamped — you can commit" or
what is still blocking.
````

- [ ] **Step 3: Install and restart**

```bash
cd /c/file-management-server
bash .claude/guardrails/scripts/sync-local.sh
```

The sync script copies whole skill directories, so `thportal-validate` comes along. Restart Claude
Code, then confirm `/validate` is listed.

- [ ] **Step 4: Prove the loop on a real change**

Make a deliberately bad backend change — add to any repository a method
`public async Task<Foo?> GetFooByIdAsync(Guid id, bool trackChanges) => await FindByCondition(f => f.Id == id, trackChanges).FirstOrDefaultAsync();`
on an entity that has `IsDeleted`, stage it, and run `/validate`.

Expected: the checks run, the reviewer reports the missing soft-delete filter as a violation, the
stamp is written with `result: "fail"`, and `git commit` is refused. Fix the filter, re-run
`/validate`, and the commit goes through. Then `git reset --hard` the experiment away — it must never
be committed to the product repo.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate.mjs skills/thportal-validate
git commit -m "feat: add /validate, which is what produces a stamp

A gate with no way to produce a key is just a locked door, so the deterministic half of validation lands with it."
```

---

### Task 6: The Claude Code hooks

**Files:**
- Create: `scripts/hooks/pre-tool-use.mjs`, `scripts/hooks/session-start.mjs`
- Create: `claude/settings.partial.json` (what the installer merges)
- Test: `tests/hooks-claude.test.mjs`

**Interfaces:**
- Consumes: `repo.mjs`, `stamp.mjs`, `config.json`.
- Produces: `evaluateCommand(command)` → `{ deny: boolean, reason: string }` and
  `evaluateWrite(path)` → `{ deny: boolean, reason: string }`, both exported for testing and used by
  the `PreToolUse` entry point, which exits 2 to block.

- [ ] **Step 1: Write the failing test**

`tests/hooks-claude.test.mjs`:

```javascript
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
  ]) {
    assert.equal(evaluateCommand(cmd).deny, false, cmd);
  }
});

test('writing a stamp by hand is denied, writing elsewhere is not', () => {
  assert.equal(evaluateWrite('C:/file-management-server/.git/guardrails/stamps/a.json').deny, true);
  assert.equal(evaluateWrite('C:/file-management-server/backend/Service/A.cs').deny, false);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test tests/hooks-claude.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `scripts/hooks/pre-tool-use.mjs`**

```javascript
const RULES = [
  [/git\s+commit\b[^|;]*\s(--no-verify|-n)\b/, 'the commit gate is not optional — run /validate instead of skipping the hook'],
  [/\bHUSKY=0\b/, 'HUSKY=0 disables the hooks — run /validate instead'],
  [/git\s+config\b[^|;]*core\.hooksPath/, 'changing core.hooksPath turns the gate off; the session start hook sets it for a reason'],
  [/git\s+push\b[^|;]*--force(?!-with-lease)/, 'use --force-with-lease, and only on your own branch'],
  // The ref must be staging or main on its own — `feat/main-menu` is somebody's branch, not main.
  [/git\s+push\b[^|;]*[\s:](staging|main)(?![\w/-])/, 'never push straight to staging or main — open a PR'],
  [/\.git[\\/]guardrails/, 'stamps are written by validate.mjs, never by hand'],
];

export function evaluateCommand(command = '') {
  for (const [re, reason] of RULES) if (re.test(command)) return { deny: true, reason };
  return { deny: false, reason: '' };
}

export function evaluateWrite(path = '') {
  return /\.git[\\/]guardrails/.test(path.replace(/\\/g, '/'))
    ? { deny: true, reason: 'stamps are written by validate.mjs, never by hand' }
    : { deny: false, reason: '' };
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    const input = JSON.parse(raw || '{}');
    const i = input.tool_input ?? {};
    const verdict = i.command ? evaluateCommand(i.command) : evaluateWrite(i.file_path ?? '');
    if (!verdict.deny) process.exit(0);
    process.stderr.write(`Blocked by the guardrails: ${verdict.reason}\n`);
    process.exit(2);
  });
}
```

- [ ] **Step 4: Write `scripts/hooks/session-start.mjs`**

```javascript
import { execFileSync } from 'node:child_process';
import { config, currentBranch, repoRoot, ticketForBranch } from '../lib/repo.mjs';
import { pruneStamps } from '../lib/stamp.mjs';

const root = repoRoot();
const hooksPath = '.claude/guardrails/githooks';

try {
  const current = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).trim();
  if (current !== hooksPath) execFileSync('git', ['config', 'core.hooksPath', hooksPath], { cwd: root });
} catch {
  execFileSync('git', ['config', 'core.hooksPath', hooksPath], { cwd: root });
}

let pruned = 0;
try { pruned = pruneStamps(config().stamp.pruneDays, root); } catch { pruned = 0; }

const ticket = ticketForBranch();
const lines = [
  `Guardrails active. Branch: ${currentBranch() || '(detached)'}.`,
  ticket ? `Ticket: ${ticket}.` : 'This branch has no ticket link yet.',
  'Backend commits need a passing /validate stamp. Frontend commits are untouched.',
  pruned ? `Pruned ${pruned} stale stamp(s).` : '',
].filter(Boolean);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join(' ') },
}));
```

- [ ] **Step 5: Write `claude/settings.partial.json`**

```json
{
  "attribution": { "commit": "", "pr": "" },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node .claude/guardrails/scripts/hooks/pre-tool-use.mjs" }]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "node .claude/guardrails/scripts/hooks/pre-tool-use.mjs" }]
      }
    ],
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "node .claude/guardrails/scripts/hooks/session-start.mjs" }]
      }
    ]
  }
}
```

- [ ] **Step 6: Run the unit tests, then the hooks by hand**

```bash
node --test tests/hooks-claude.test.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m x"}}' | node scripts/hooks/pre-tool-use.mjs; echo "exit=$?"
echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | node scripts/hooks/pre-tool-use.mjs; echo "exit=$?"
node scripts/hooks/session-start.mjs
```
Expected: unit tests pass; the first command exits 2 with the reason on stderr; the second exits 0;
`session-start.mjs` prints JSON with `additionalContext`, and `git config --get core.hooksPath` now
reads `.claude/guardrails/githooks`.

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks claude/settings.partial.json tests/hooks-claude.test.mjs
git commit -m "feat: stop Claude from walking around the gate

A hook that only a human can bypass is worth more than one that the tool being gated can disable on its own."
```

---

### Task 7: The installer

**Files:**
- Create: `scripts/install.mjs`, `scripts/uninstall.mjs`
- Delete: `scripts/sync-local.sh`

**Interfaces:**
- Consumes: everything above.
- Produces: `node .claude/guardrails/scripts/install.mjs` and `… /uninstall.mjs`. Install is
  idempotent and safe to re-run after every `git pull` of the bundle.

- [ ] **Step 1: Write `scripts/install.mjs`**

It must do exactly these, in order, printing one line each:

1. **Check prerequisites** — `git`, `node`, `dotnet`, `docker info`, `gh --version`. Docker and `gh`
   missing are warnings; `git`, `node` and `dotnet` missing are errors that stop the install.
2. **Copy** `agents/architecture-reviewer.md` and every directory under `skills/` into both
   `<root>/.claude/` and `<root>/backend/.claude/`; copy `claude/CLAUDE.root.md` → `<root>/CLAUDE.md`
   and `claude/CLAUDE.backend.md` → `<root>/backend/CLAUDE.md`.
3. **Refuse to overwrite a file the developer edited** — if a destination differs from both the
   bundle's copy and the previously installed copy recorded in `.git/guardrails/installed.json`,
   leave it and report it. Record every copied path and its sha256 there.
4. **Set** `core.hooksPath` to `.claude/guardrails/githooks`.
5. **Append the missing `.git/info/exclude` lines**: `/CLAUDE.md`, `/backend/CLAUDE.md`,
   `/backend/.claude/agents/`, `/backend/.claude/skills/`.
6. **Merge `claude/settings.partial.json` into `<root>/.claude/settings.json`** — deep-merge, keeping
   any key the file already has that the partial does not mention, and never dropping
   `enabledPlugins`. Write the merged file only when it differs.
7. **Print** the bundle version and `Restart Claude Code to register the agent and skills.`

- [ ] **Step 2: Write `scripts/uninstall.mjs`**

Reverses it: restore `core.hooksPath` to what `installed.json` recorded (or unset it), remove the
copied files it installed and still owns by hash, remove the `.git/info/exclude` lines it added,
remove its hooks block from `.claude/settings.json`, and leave `.git/guardrails/` and the bundle clone
in place. Print what it removed and what it deliberately kept.

- [ ] **Step 3: Test both in a scratch clone, not in the working clone**

```bash
cd /c/nvm-temp/claude/C--file-management-server-backend/7c5c8085-5e5c-4d70-bac3-f7ecee0b9071/scratchpad
rm -rf install-test && mkdir install-test && cd install-test
git init -q -b main && mkdir -p backend frontend .claude
cp -r /c/file-management-server/.claude/guardrails .claude/guardrails
node .claude/guardrails/scripts/install.mjs
git config --get core.hooksPath
ls .claude/agents .claude/skills backend/.claude/skills CLAUDE.md backend/CLAUDE.md
cat .git/info/exclude | tail -5
node .claude/guardrails/scripts/uninstall.mjs
git config --get core.hooksPath || echo "(hooks path unset again)"
git status --short
```
Expected: install reports each step; the files land in both locations; `git status` is empty after
both install and uninstall; uninstall leaves nothing behind.

- [ ] **Step 4: Re-run install twice and confirm it is idempotent**

```bash
node .claude/guardrails/scripts/install.mjs && node .claude/guardrails/scripts/install.mjs
```
Expected: the second run reports everything already current and changes nothing.

- [ ] **Step 5: Install for real in the working clone**

```bash
cd /c/file-management-server
node .claude/guardrails/scripts/install.mjs
git status --short
git config --get core.hooksPath
```
Expected: `core.hooksPath` is `.claude/guardrails/githooks`, and `git status` shows only
`backend/docs/SECRETS.md`.

- [ ] **Step 6: Replace the old script and commit**

```bash
cd /c/file-management-server/.claude/guardrails
git rm -q scripts/sync-local.sh
git add scripts/install.mjs scripts/uninstall.mjs
git commit -m "feat: replace the sync script with a real installer

An installer that records what it wrote can also take it all back out, which is what makes the bundle safe to try."
```

---

### Task 8: End to end, docs and release

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `VERSION`, `claude/CLAUDE.root.md`

- [ ] **Step 1: Run the whole suite once**

```bash
cd /c/file-management-server/.claude/guardrails
node --test tests/
sh tests/hooks.test.sh
```
Expected: every unit test passes and the hook harness reports `failed: 0`.

- [ ] **Step 2: Prove the gate on a real commit, by hand**

```bash
cd /c/file-management-server
git checkout -b test/gate-proof origin/staging
printf '\n' >> backend/Service/ScenarioService.cs
git add backend/Service/ScenarioService.cs
git commit -m "test(be): prove the gate blocks

This should not be allowed to land."
```
Expected: the commit is refused with `Commit blocked: no stamp for this staged content` and the hint
to run `/validate`.

Then clean up completely:

```bash
git reset --hard && git checkout chore/claude-dev-guardrails && git branch -D test/gate-proof
git status --short
```
Expected: only `backend/docs/SECRETS.md`.

- [ ] **Step 3: Update `claude/CLAUDE.root.md`**

The workflow section currently says only `/thportal-review` exists. Replace that with: `/validate`
before committing, the gate blocking backend commits without a stamp, and `/ticket`, `/ship` and
`/learn` still to come. Keep it to the same handful of lines.

- [ ] **Step 4: Update `README.md`**

- Install is now `node .claude/guardrails/scripts/install.mjs`, uninstall is `uninstall.mjs`.
- Add "How long validation takes" with the real figures measured in Task 2.
- Move `/validate` and the commit gate from "Still to come" into "Working today".

- [ ] **Step 5: Write the `CHANGELOG.md` entry and bump `VERSION` to `0.3.0`**

```markdown
## 0.3.0 — 2026-09-18

- `/validate`: format, build, the integration suite and an architecture review of the staged diff,
  recorded in a stamp keyed to `git write-tree`.
- The commit gate: a `backend/` commit without a passing stamp for its exact staged content is
  refused. Merge commits and frontend-only commits pass through untouched.
- Commit message rules: Conventional Commits header, a body saying why, the `Asana:` trailer added
  from the branch's ticket link, and no Claude attribution.
- Claude Code hooks: `--no-verify`, `HUSKY=0`, hooks-path changes, force pushes, pushes to
  `staging`/`main` and hand-written stamps are all refused. Session start restores the hooks path,
  prunes old stamps and reports the branch's ticket.
- `install.mjs` / `uninstall.mjs` replace `sync-local.sh`, and the install can be taken back out.
```

- [ ] **Step 6: Show the user everything and stop**

```bash
cd /c/file-management-server/.claude/guardrails
git status --short
git log --oneline origin/main..HEAD
cd /c/file-management-server && git status --short && git config --get core.hooksPath
```
Report what each commit contains and confirm the product repo is clean. **Do not push** — the user
reviews first.

- [ ] **Step 7: Push after the user says go**

```bash
cd /c/file-management-server/.claude/guardrails
git add -A && git commit -m "chore: release 0.3.0

The gate is the half of this work that does not depend on anyone remembering to run it."
git push origin main
```

---

## What this plan leaves for Part 3

| Item | Why it waits |
|---|---|
| `/ticket` | Needs Asana credentials (`scripts/secrets.mjs`) and the QA-case format |
| QA cases inside `/validate` | The cases come from `/ticket`; until then validation is checks plus review |
| `/ship` | PR, preview verification, and the Asana comment the developer approves before it posts |
| `/learn` | Turning a review comment or QA failure into a rule, with its eval case |
| `gate.requireTicket: true` | Flip it on once `/ticket` links branches automatically |
