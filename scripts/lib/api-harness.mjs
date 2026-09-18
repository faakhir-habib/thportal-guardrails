import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { config, repoRoot } from './repo.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Any HTTP answer means the host is up. The API has no health route, and a 404 from Kestrel is still
// proof that Kestrel is listening.
async function waitForApi(baseUrl, timeoutMs, onWait = () => {}) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    try {
      await fetch(baseUrl, { method: 'GET' });
      return true;
    } catch {
      attempt += 1;
      if (attempt % 10 === 0) onWait(Math.round((Date.now() - (deadline - timeoutMs)) / 1000));
      await sleep(1000);
    }
  }
  return false;
}

export async function startApi({ connectionString, onOutput = () => {} } = {}) {
  const { baseUrl, bootTimeoutMs } = config().qa;

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

  const up = await waitForApi(baseUrl, bootTimeoutMs);
  if (!up) {
    stop();
    throw new Error(`the API did not come up on ${baseUrl} within ${bootTimeoutMs / 1000}s. Last output:\n${log}`);
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

// The branch database when the branch has been pushed, otherwise whatever the developer's
// appsettings.Development.json already points at. Never staging, never a shared preview DB.
export function branchConnectionString() {
  try {
    const out = execFileSync('node', [join(repoRoot(), 'docker', 'connection-string.mjs'), repoRoot()], {
      encoding: 'utf8',
      cwd: repoRoot(),
    }).trim();
    return out.includes('Server=') ? out : null;
  } catch {
    return null;
  }
}
