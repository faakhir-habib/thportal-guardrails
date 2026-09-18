import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const IMAGE = 'mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const docker = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', ...opts }).trim();

// A database nobody else is using, thrown away afterwards. The API applies migrations on startup, so
// it needs a schema it is allowed to change — and the integration suite already proves this image
// works for that.
export async function startSqlContainer({ onProgress = () => {} } = {}) {
  const password = `Qa${randomBytes(12).toString('base64url')}1!`;
  const name = `guardrails-qa-${randomBytes(4).toString('hex')}`;

  onProgress(`starting ${name}`);
  docker([
    'run', '-d', '--rm',
    '--name', name,
    '-e', 'ACCEPT_EULA=Y',
    '-e', `MSSQL_SA_PASSWORD=${password}`,
    '-e', 'MSSQL_PID=Developer',
    '-p', '0:1433',
    IMAGE,
  ]);

  const stop = () => {
    try {
      docker(['rm', '-f', name], { stdio: 'ignore' });
    } catch {
      // The container is already gone, which is the outcome we wanted.
    }
  };

  try {
    const port = docker(['port', name, '1433']).split(':').pop().trim();
    const deadline = Date.now() + 120000;

    while (Date.now() < deadline) {
      const probe = spawnSync('docker', [
        'exec', name, '/opt/mssql-tools18/bin/sqlcmd',
        '-S', 'localhost', '-U', 'sa', '-P', password, '-C', '-Q', 'SELECT 1',
      ], { encoding: 'utf8' });

      if (probe.status === 0) {
        onProgress(`sql server ready on port ${port}`);

        // -b makes sqlcmd exit non-zero on a SQL error; without it a failed statement still exits 0 and a
        // broken UPDATE looks exactly like a successful one. -I turns on QUOTED_IDENTIFIER, which the
        // schema requires because of its filtered indexes and computed columns.
        const exec = (query, database = 'guardrails_qa') => {
          const r = spawnSync('docker', [
            'exec', name, '/opt/mssql-tools18/bin/sqlcmd',
            '-S', 'localhost', '-U', 'sa', '-P', password, '-C', '-b', '-I', '-d', database, '-Q', query,
          ], { encoding: 'utf8' });
          if (r.status !== 0) throw new Error(`sqlcmd failed: ${(r.stdout ?? '') + (r.stderr ?? '')}`.slice(0, 400));
          return (r.stdout ?? '').trim();
        };

        return {
          name,
          stop,
          exec,
          connectionString: `Server=localhost,${port};Database=guardrails_qa;User Id=sa;Password=${password};TrustServerCertificate=True;Encrypt=False;`,
        };
      }
      await sleep(2000);
    }

    throw new Error('the SQL Server container did not become ready within 120s');
  } catch (error) {
    stop();
    throw error;
  }
}
