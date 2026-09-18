import { execFileSync } from 'node:child_process';
import { config, currentBranch, repoRoot, ticketForBranch } from '../lib/repo.mjs';
import { pruneStamps } from '../lib/stamp.mjs';

const root = repoRoot();
const hooksPath = '.claude/guardrails/githooks';

const gitConfig = (args) => execFileSync('git', ['config', ...args], { cwd: root, encoding: 'utf8' }).trim();

let current = '';
try {
  current = gitConfig(['--get', 'core.hooksPath']);
} catch {
  current = '';
}
if (current !== hooksPath) gitConfig(['core.hooksPath', hooksPath]);

let pruned = 0;
try {
  pruned = pruneStamps(config().stamp.pruneDays, root);
} catch {
  pruned = 0;
}

const ticket = ticketForBranch();
const lines = [
  `Guardrails active. Branch: ${currentBranch() || '(detached)'}.`,
  ticket ? `Ticket: ${ticket}.` : 'This branch has no ticket link yet.',
  'A backend commit needs a passing /validate stamp; frontend commits are untouched.',
  current !== hooksPath ? `Hooks path was ${current || 'unset'} — set back to ${hooksPath}.` : '',
  pruned ? `Pruned ${pruned} stale stamp(s).` : '',
].filter(Boolean);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join(' ') },
}));
