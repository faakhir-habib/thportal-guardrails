import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inScope, parseCases, summarise } from './lib/qa-cases.mjs';
import { runCases } from './lib/qa-verify-lib.mjs';
import { branchConnectionString, login, startApi } from './lib/api-harness.mjs';
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
const connectionString = arg('db') ?? branchConnectionString();
const database = givenBaseUrl
  ? `an API already running at ${givenBaseUrl}`
  : (connectionString ? connectionString.replace(/Password=[^;]*/i, 'Password=***') : "the developer's local dev database");

let api = null;
let failed = 0;

try {
  const baseUrl = givenBaseUrl ?? (api = await startApi({ connectionString })).baseUrl;
  process.stderr.write(`api: ${baseUrl}\ndatabase: ${database}\n`);

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
}

process.exit(failed ? 1 : 0);
