import { readFileSync } from 'node:fs';
import { config, ticketForBranch } from './lib/repo.mjs';
import { isMain } from './lib/main.mjs';

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
    else if (!match[1].includes(ticket)) {
      problems.push('the Asana trailer points at a different ticket than the branch');
    }
  }

  return { ok: problems.length === 0, problems };
}

export function addTrailer(raw, ticketUrl) {
  if (TRAILER.test(strip(raw))) return raw;
  return `${raw.replace(/\s*$/, '')}\n\nAsana: ${ticketUrl}\n`;
}

if (isMain(import.meta.url)) {
  const path = process.argv[2];
  const { requireTicket } = config().gate;
  const { ok, problems } = checkMessage(readFileSync(path, 'utf8'), {
    ticket: ticketForBranch(),
    requireTicket,
  });
  if (ok) process.exit(0);
  process.stderr.write(`\nCommit message rejected:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\n`);
  process.exit(1);
}
