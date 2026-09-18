import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { config, repoRoot } from './repo.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Any HTTP answer means the host is up. The API has no health route, and a 404 from Kestrel is still
// proof that Kestrel is listening.
// Any HTTP answer means the host is up; a 404 from Kestrel still proves Kestrel is listening.
// `hasExited` is checked every round so a crashed API fails in seconds rather than at the timeout —
// waiting three minutes to be told the process died at second four teaches people to distrust this.
async function waitForApi(baseUrl, timeoutMs, hasExited) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fetch(baseUrl, { method: 'GET' });
      return { up: true };
    } catch {
      if (hasExited()) return { up: false, crashed: true };
      await sleep(1000);
    }
  }
  return { up: false, crashed: false };
}

export async function startApi({ connectionString, onOutput = () => {} } = {}) {
  const { baseUrl, bootTimeoutMs } = config().qa;
  assertSafeDatabase(connectionString);

  const child = spawn('dotnet', ['run', '--no-launch-profile', '-c', 'Debug'], {
    cwd: join(repoRoot(), 'backend', 'FileManager'),
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: 'Development',
      ASPNETCORE_URLS: baseUrl,
      ...(connectionString ? { ConnectionStrings__sqlConnection: connectionString } : {}),
    },
    windowsHide: true,
  });

  let log = '';
  const capture = (chunk) => { log = (log + chunk).slice(-4000); onOutput(String(chunk)); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  const stop = () => {
    if (child.exitCode !== null || child.signalCode) return;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
  };

  const { up, crashed } = await waitForApi(baseUrl, bootTimeoutMs, () => child.exitCode !== null);
  if (!up) {
    stop();
    const why = crashed
      ? `the API exited with code ${child.exitCode} before it started listening`
      : `the API did not come up on ${baseUrl} within ${bootTimeoutMs / 1000}s`;
    throw new Error(`${why}. Last output:\n${log}`);
  }

  return { baseUrl, stop, log: () => log };
}

export async function login(baseUrl, { fetchImpl = fetch } = {}) {
  const { path, email, password } = config().qa.login;

  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await res.json();
  const token = body?.data?.tokenDto?.accessToken ?? body?.data?.accessToken;
  if (!token) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return token;
}

const databaseOf = (connectionString) => (connectionString.match(/Database=([^;]+)/i)?.[1] ?? '').trim();

// The API applies migrations on startup, so pointing it at a database other people use would change
// their schema. `docker/connection-string.mjs` falls back to the shared `erp-development` box when a
// branch database does not exist, so its answer is only accepted when the database name is the one
// belonging to this branch.
export function branchConnectionString() {
  try {
    const expected = execFileSync('node', [join(repoRoot(), 'docker', 'branch-db-name.mjs'), repoRoot()], {
      encoding: 'utf8',
      cwd: repoRoot(),
    }).trim();

    const connectionString = execFileSync('node', [join(repoRoot(), 'docker', 'connection-string.mjs'), repoRoot()], {
      encoding: 'utf8',
      cwd: repoRoot(),
    }).trim();

    if (!connectionString.includes('Server=') && !connectionString.includes('server=')) return null;
    if (databaseOf(connectionString) !== expected) return null;

    return connectionString;
  } catch {
    return null;
  }
}

const SHARED = [/^erp-development$/i, /^erp-staging/i, /^thportal_staging$/i, /^erp$/i, /^crm/i, /^thportal_pr_/i];

// A last line of defence: whatever the caller passed, refuse anything that looks like a database
// other people are working against.
export function assertSafeDatabase(connectionString) {
  if (!connectionString) return;
  const name = databaseOf(connectionString);
  if (SHARED.some((re) => re.test(name))) {
    throw new Error(
      `refusing to run against "${name}" — the API applies migrations on startup, and this database is shared. `
      + 'Use your own local database, or a branch database created for this branch.',
    );
  }
}
