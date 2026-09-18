import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inScope, parseCases, summarise } from './lib/qa-cases.mjs';
import { runCases } from './lib/qa-verify-lib.mjs';
import { branchConnectionString, login, startApi } from './lib/api-harness.mjs';
import { startSqlContainer } from './lib/sql-container.mjs';
import { repoRoot } from './lib/repo.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};

const workDir = arg('work');
if (!workDir) {
  process.stderr.write('usage: node qa-verify.mjs --work <dir> [--base-url <url>] [--db <connection string>]\n');
  process.exit(2);
}

const casesPath = join(repoRoot(), workDir, 'qa-cases.json');
const doc = JSON.parse(readFileSync(casesPath, 'utf8'));
const { cases, problems } = parseCases(JSON.stringify(doc));

if (problems.length) {
  console.log(JSON.stringify({ result: 'fail', reason: 'qa-cases.json has problems', problems }, null, 2));
  process.exit(1);
}

const scoped = inScope(cases);
if (scoped.length === 0) {
  console.log(JSON.stringify({ result: 'skip', reason: 'no in-scope api cases', summary: summarise(cases) }, null, 2));
  process.exit(0);
}

const givenBaseUrl = arg('base-url');
// A throwaway container is the default because the API migrates whatever database it is given, and
// the developer's own database is not a safe thing to migrate on every QA run.
const useContainer = !givenBaseUrl && !arg('db') && !process.argv.includes('--no-container');

let api = null;
let sql = null;
let failed = 0;

try {
  let connectionString = arg('db') ?? branchConnectionString();
  let database;

  if (givenBaseUrl) {
    database = `an API already running at ${givenBaseUrl}`;
  } else if (connectionString) {
    database = connectionString.replace(/Password=[^;]*/i, 'Password=***');
  } else if (useContainer) {
    sql = await startSqlContainer({ onProgress: (m) => process.stderr.write(`sql: ${m}\n`) });
    connectionString = sql.connectionString;
    database = 'a throwaway SQL Server container (guardrails_qa), migrated from empty';
  } else {
    database = "the API's own configured database";
  }

  const baseUrl = givenBaseUrl ?? (api = await startApi({ connectionString })).baseUrl;
  process.stderr.write(`api: ${baseUrl}\ndatabase: ${database}\n`);

  // The seeded admin has two-factor enabled, and the token is emailed. In a container we own and
  // throw away, turning it off for the seeded users is the honest way in; against any other database
  // the developer logs in normally and passes --base-url.
  if (sql) {
    const out = sql.exec(`
      DECLARE @t sysname = (SELECT TOP 1 TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME = 'TwoFactorEnabled');
      IF @t IS NULL THROW 51000, 'no table carries TwoFactorEnabled', 1;
      DECLARE @sql nvarchar(max) = N'UPDATE ' + QUOTENAME(@t) + ' SET TwoFactorEnabled = 0';
      EXEC sp_executesql @sql;
      SELECT @t AS [table], @@ROWCOUNT AS [rows];
    `);
    process.stderr.write(`sql: disabled two-factor in the throwaway database — ${out.replace(/\s+/g, ' ').trim()}\n`);
  }

  const token = await login(baseUrl);
  const results = await runCases(scoped, { baseUrl, token });

  for (const r of results) {
    const target = doc.cases.find((c) => c.id === r.id);
    if (target) {
      target.status = r.status;
      target.evidence = r.evidence;
      target.database = database;
      if (r.error) target.error = r.error; else delete target.error;
    }
    process.stderr.write(`${r.id}: ${r.status} — ${r.evidence}${r.error ? ` (${r.error})` : ''}\n`);
  }

  writeFileSync(casesPath, `${JSON.stringify(doc, null, 2)}\n`);
  failed = results.filter((r) => r.status === 'failed').length;

  console.log(JSON.stringify({
    result: failed ? 'fail' : 'pass',
    database,
    passed: results.length - failed,
    failed,
    results,
  }, null, 2));
} finally {
  if (api) api.stop();
  if (sql) sql.stop();
}

process.exit(failed ? 1 : 0);
