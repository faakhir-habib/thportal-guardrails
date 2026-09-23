import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, currentBranch, repoRoot, ticketForBranch } from './lib/repo.mjs';
import { getSecret } from './lib/secrets.mjs';
import { verifyStamp } from './lib/stamp.mjs';
import { parseCases } from './lib/qa-cases.mjs';
import { getTask, taskUrl } from './lib/asana.mjs';
import { buildPrBody, createPr, currentPr } from './lib/github.mjs';
import { attachLink, buildQaComment, moveToSection, postComment, setCustomFields } from './lib/asana-write.mjs';

const git = (args) => execFileSync('git', args, { cwd: repoRoot(), encoding: 'utf8' }).trim();

// Network git needs a credential of its own: the product remote's embedded token can be revoked or
// stale, and a push that falls back to a prompt hangs a non-interactive run. The token is passed
// through the environment for the life of the call and never written anywhere.
const gitNetwork = (args) => {
  const helper = '!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f';
  // The empty helper first clears the inherited ones: Git Credential Manager pops an account picker
  // on a machine with more than one GitHub login, and a dialog nobody is watching is a hang.
  return execFileSync('git', ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`, ...args], {
    cwd: repoRoot(),
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_TOKEN: process.env.GH_TOKEN ?? getSecret('ZAYAN_GITHUB_PAT'),
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    },
  }).trim();
};
const say = (line) => process.stderr.write(`${line}\n`);
const post = process.argv.includes('--post');

const stop = (reason, hint) => {
  console.log(JSON.stringify({ result: 'blocked', reason, hint }, null, 2));
  process.exit(1);
};

// ---- preconditions -----------------------------------------------------------------------------

const branch = currentBranch();
if (!branch) stop('HEAD is detached', 'switch to the branch you are working on');
if (['staging', 'main', 'development'].includes(branch)) stop(`you are on ${branch}`, 'ship from a feature branch');

if (git(['status', '--porcelain']).split('\n').filter((l) => l && !l.startsWith('??')).length) {
  stop('the working tree has uncommitted changes', 'commit them (the gate validates what you commit)');
}

const ticket = ticketForBranch();
if (!ticket) stop('this branch is not linked to a ticket', `run /ticket, or: git config branch.${branch}.asanaTask <gid>`);

const headTree = git(['rev-parse', 'HEAD^{tree}']);
const stamp = verifyStamp(headTree);
if (!stamp.ok) stop(`the committed content is not validated — ${stamp.reason}`, 'run /validate, then commit again');

const workDir = join(repoRoot(), '.claude', 'work', ticket);
const casesPath = join(workDir, 'qa-cases.json');
if (!existsSync(casesPath)) stop(`no qa-cases.json in .claude/work/${ticket}`, 'run /ticket first');

const { cases, problems } = parseCases(readFileSync(casesPath, 'utf8'));
if (problems.length) stop('qa-cases.json has problems', problems.join('; '));

const apiCases = cases.filter((c) => c.type === 'api' && c.scope === 'this-commit');
const notPassed = apiCases.filter((c) => c.status !== 'passed');
if (notPassed.length) {
  stop(`${notPassed.length} API case(s) have not passed: ${notPassed.map((c) => c.id).join(', ')}`, 'run /validate, which runs them');
}

say(`branch ${branch} · ticket ${ticket} · ${apiCases.length} API case(s) passed`);

// ---- the whole branch, not the last commit -----------------------------------------------------

gitNetwork(['fetch', '-q', 'origin', 'staging']);
const branchDiff = git(['diff', '--name-only', 'origin/staging...HEAD', '--', 'backend/']).split('\n').filter(Boolean);
say(`branch diff against origin/staging: ${branchDiff.length} backend file(s)`);

// ---- push and PR -------------------------------------------------------------------------------

const task = await getTask(ticket);
const title = task.name.replace(/^\[TEST\]\s*/i, '').trim();

if (!post) {
  say('pushing the branch');
  gitNetwork(['push', '-u', 'origin', branch]);
}

let pr = currentPr();
if (!pr && !post) {
  const summary = process.env.SHIP_SUMMARY ?? task.name;
  const body = buildPrBody({
    ticketUrl: taskUrl(ticket),
    summary,
    why: (process.env.SHIP_WHY ?? '').split('\n').filter(Boolean),
    verification: {
      tests: (process.env.SHIP_TESTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      suite: 'pass',
      qa: `${apiCases.length}/${apiCases.length} API cases passed`,
    },
    waivers: stamp.waivers ?? [],
  });
  say('opening the pull request');
  pr = createPr({ title, body, base: 'staging' });
}

if (!pr) stop('no pull request for this branch', 'open one, or re-run without --post so this can');

// ---- the preview environment -------------------------------------------------------------------

const previewApi = config().preview.api.replace('{n}', pr.number);
const previewApp = config().preview.app.replace('{n}', pr.number);

const waitForPreview = async (url, timeoutMs = 600000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: 'GET' });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  return false;
};

let qaLine = `${apiCases.length}/${apiCases.length} API cases passed locally`;
let previewVerified = false;

say(`waiting for ${previewApi} (up to 10 minutes)`);
if (await waitForPreview(previewApi)) {
  const r = spawnSync(process.execPath, [
    join(import.meta.dirname, 'qa-verify.mjs'), '--work', `.claude/work/${ticket}`, '--base-url', previewApi,
  ], { cwd: repoRoot(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  process.stderr.write(r.stderr ?? '');
  try {
    const out = JSON.parse(r.stdout);
    previewVerified = out.result === 'pass';
    qaLine = `${out.passed}/${out.passed + out.failed} API cases ${previewVerified ? 'passed' : 'run'} on the preview`;
  } catch {
    qaLine = `${qaLine} — the preview run produced no result`;
  }
} else {
  say('the preview did not come up; continuing with the local results');
  qaLine = `${qaLine}; preview verification pending`;
}

// ---- what would go to the ticket ---------------------------------------------------------------

const fresh = parseCases(readFileSync(casesPath, 'utf8')).cases;
const comment = buildQaComment({
  branch,
  previewUrl: previewApp,
  prUrl: pr.url,
  cases: fresh,
  waivers: stamp.waivers ?? [],
  reviewerGid: config().asana.qaReviewer.gid,
});

const fields = {
  1213970239265742: branch,
  1215526484518092: previewApp,
  1213961395073443: '1213961395073445',
};
const section = config().asana.sections.qa;

const payload = {
  result: 'ready',
  posted: false,
  pr,
  preview: { api: previewApi, app: previewApp, verified: previewVerified },
  qa: qaLine,
  asana: { task: ticket, comment, fields, section },
};

if (!post) {
  console.log(JSON.stringify(payload, null, 2));
  say('');
  say('Nothing has been posted. Read the QA cases above; when they are right, run: /ship --post');
  process.exit(0);
}

// ---- --post: the Asana half --------------------------------------------------------------------

const failedCases = fresh.filter((c) => c.type === 'api' && c.status === 'failed');
if (failedCases.length) stop(`${failedCases.length} API case(s) failed — the ticket is not moved`, 'fix them and validate again');

try {
  await postComment(ticket, comment);
  say('posted the comment');
  await attachLink(ticket, { url: pr.url, name: `PR #${pr.number} - ${title}` });
  say(`attached PR #${pr.number} to the task`);
  await setCustomFields(ticket, fields);
  say('set Branch name, Preview Url and Backend Status');
  await moveToSection(ticket, section);
  say('moved the task to QA');
  console.log(JSON.stringify({ ...payload, posted: true }, null, 2));
} catch (error) {
  say(`Asana failed: ${error.message}`);
  say('The comment text follows so it can be pasted by hand. The task has not been moved.');
  console.log(comment);
  process.exit(1);
}
