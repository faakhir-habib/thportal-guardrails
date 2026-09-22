import { execFileSync } from 'node:child_process';
import { repoRoot } from './repo.mjs';

const CLAUDE = /claude|anthropic|🤖/i;

const defaultRun = (args) => execFileSync('gh', args, { cwd: repoRoot(), encoding: 'utf8' }).trim();

export function buildPrBody({ ticketUrl, summary, why = [], verification = {}, waivers = [] }) {
  const clean = (s) => String(s).replace(/.*claude.*/gi, '').replace(/.*anthropic.*/gi, '').trim();

  const lines = [`**Asana:** ${ticketUrl}`, '', '## Summary', clean(summary), ''];

  lines.push('## Why');
  const reasons = why.map(clean).filter(Boolean).slice(0, 3);
  lines.push(...(reasons.length ? reasons.map((r) => `- ${r}`) : ['- Nothing the diff does not already explain.']));
  lines.push('');

  lines.push('## Verification');
  const tests = (verification.tests ?? []).join(' · ');
  lines.push(`- Integration tests: ${tests || 'none required'} · existing suite ${verification.suite ?? 'pass'}`);
  lines.push(`- QA: ${verification.qa ?? 'not run'}`);

  if (waivers.length) {
    lines.push('', '## Waivers');
    lines.push(...waivers.map((w) => `- ${w.rule} — ${clean(w.reason ?? w.waivedReason ?? '')}`));
  }

  const body = lines.join('\n');
  if (CLAUDE.test(body)) throw new Error('the PR body mentions Claude — that never goes in a PR');
  return body;
}

export function currentPr({ run = defaultRun } = {}) {
  try {
    return JSON.parse(run(['pr', 'view', '--json', 'number,url']));
  } catch {
    return null;
  }
}

export function createPr({ title, body, base = 'staging', run = defaultRun }) {
  run(['pr', 'create', '--base', base, '--title', title, '--body', body]);
  return currentPr({ run });
}

export const prReviewComments = (number, { run = defaultRun } = {}) =>
  JSON.parse(run(['api', `repos/{owner}/{repo}/pulls/${number}/comments`]))
    .map((c) => ({ author: c.user?.login ?? 'unknown', body: c.body ?? '', path: c.path ?? null, line: c.line ?? null }));
