import { isMain } from '../lib/main.mjs';

const RULES = [
  [/git\s+commit\b[^|;]*\s(--no-verify|-n)\b/, 'the commit gate is not optional — run /validate instead of skipping the hook'],
  [/\bHUSKY=0\b/, 'HUSKY=0 disables the hooks — run /validate instead'],
  [/git\s+config\b[^|;]*core\.hooksPath/, 'changing core.hooksPath turns the gate off; the session start hook sets it for a reason'],
  [/git\s+push\b[^|;]*--force(?!-with-lease)/, 'use --force-with-lease, and only on your own branch'],
  // The ref must be staging or main on its own — feat/main-menu is somebody's branch, not main.
  [/git\s+push\b[^|;]*[\s:](staging|main)(?![\w/-])/, 'never push straight to staging or main — open a PR'],
  [/\.git[\\/]guardrails/, 'stamps are written by validate.mjs, never by hand'],
];

export function evaluateCommand(command = '') {
  for (const [re, reason] of RULES) if (re.test(command)) return { deny: true, reason };
  return { deny: false, reason: '' };
}

export function evaluateWrite(path = '') {
  return /\.git[\\/]guardrails/.test(path)
    ? { deny: true, reason: 'stamps are written by validate.mjs, never by hand' }
    : { deny: false, reason: '' };
}

if (isMain(import.meta.url)) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let input = {};
    try {
      input = JSON.parse(raw || '{}');
    } catch {
      process.exit(0);
    }
    const i = input.tool_input ?? {};
    const verdict = i.command ? evaluateCommand(i.command) : evaluateWrite(i.file_path ?? '');
    if (!verdict.deny) process.exit(0);
    process.stderr.write(`Blocked by the guardrails: ${verdict.reason}\n`);
    process.exit(2);
  });
}
