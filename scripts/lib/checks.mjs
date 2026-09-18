import { spawnSync } from 'node:child_process';
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
    checks.docker = {
      status: 'fail',
      durationMs: 0,
      output: 'Docker is not running; the integration suite cannot start its SQL Server container.',
    };
    return { result: 'fail', checks };
  }

  if (!record(formatBackend())) return { result: 'fail', checks };
  if (!record(buildBackend())) return { result: 'fail', checks };
  if (!record(testBackend())) return { result: 'fail', checks };
  return { result: 'pass', checks };
}
