import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { repoRoot } from './repo.mjs';

const TAIL = 4000;

export function runCheck(name, command, args, opts = {}) {
  const started = Date.now();
  // No shell: on Windows it concatenates the arguments without escaping them, which mangles any
  // argument containing quotes. Pass shell: true only for a .cmd/.bat shim that needs it.
  const r = spawnSync(command, args, {
    cwd: opts.cwd ?? repoRoot(),
    encoding: 'utf8',
    shell: opts.shell ?? false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`.slice(-TAIL);
  return { name, status: r.status === 0 ? 'pass' : 'fail', durationMs: Date.now() - started, output };
}

const backend = () => join(repoRoot(), 'backend');

export const dockerRunning = () => runCheck('docker', 'docker', ['info']).status === 'pass';

// Only the staged files. The solution as a whole does not pass `dotnet format` today — unrelated
// files carry IDE2000 warnings — and failing a developer for someone else's blank lines would teach
// them to skip the gate.
export const stagedCsIncludes = (files) =>
  files.filter((f) => f.startsWith('backend/') && f.endsWith('.cs')).map((f) => f.slice('backend/'.length));

// Formatting fixes rather than verifies, then re-stages what it rewrote. Verifying would block a
// developer for whitespace that was already in the file before they touched it — several existing
// files do not pass `dotnet format` today. This is also what the repo's own husky task did.
export const formatAndRestage = (files = []) => {
  const include = stagedCsIncludes(files);
  if (include.length === 0) {
    return { name: 'format', status: 'pass', durationMs: 0, output: 'no staged .cs files', reformatted: [] };
  }

  const r = runCheck('format', 'dotnet', ['format', 'FileManagementServer.sln', '--no-restore', '--include', ...include], {
    cwd: backend(),
  });
  if (r.status !== 'pass') return { ...r, reformatted: [] };

  const staged = files.filter((f) => f.endsWith('.cs'));
  const changed = execFileSync('git', ['diff', '--name-only', '--', ...staged], { cwd: repoRoot(), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  if (changed.length) execFileSync('git', ['add', '-u', '--', ...changed], { cwd: repoRoot() });

  return { ...r, reformatted: changed };
};

export const buildBackend = () =>
  runCheck('build', 'dotnet', ['build', 'FileManagementServer.sln', '-c', 'Debug', '--nologo'], { cwd: backend() });

export const testBackend = () =>
  runCheck('integrationTests', 'dotnet', [
    'test', 'FileManager.IntegrationTests/FileManager.IntegrationTests.csproj', '-c', 'Debug', '--nologo',
  ], { cwd: backend() });

export function runBackendChecks({ files = [], onProgress = () => {} } = {}) {
  const checks = {};
  const record = (r) => {
    checks[r.name] = {
      status: r.status,
      durationMs: r.durationMs,
      output: r.status === 'fail' ? r.output : '',
      ...(r.reformatted?.length ? { reformatted: r.reformatted } : {}),
    };
    onProgress(r);
    return r.status === 'pass';
  };

  if (!dockerRunning()) {
    checks.docker = {
      status: 'fail',
      durationMs: 0,
      output: 'Docker is not running; the integration suite cannot start its SQL Server container.',
    };
    return { result: 'fail', checks };
  }

  if (!record(formatAndRestage(files))) return { result: 'fail', checks };
  if (!record(buildBackend())) return { result: 'fail', checks };
  if (!record(testBackend())) return { result: 'fail', checks };
  return { result: 'pass', checks };
}
