import {
  config,
  currentBranch,
  isMerging,
  stagedFiles,
  ticketForBranch,
  touchesBackend,
  writeTree,
} from './lib/repo.mjs';
import { verifyStamp } from './lib/stamp.mjs';
import { isMain } from './lib/main.mjs';

export function decide({ files, merging, tree, ticket, branch, cfg, verify = verifyStamp }) {
  if (!cfg.gate.enabled) return { allow: true, reason: 'the gate is disabled in config.json' };
  if (!touchesBackend(files)) return { allow: true, reason: 'no backend files in this commit' };
  if (merging) return { allow: true, reason: 'merge commit — the merged code was gated on its way in' };

  if (cfg.gate.requireTicket && !ticket) {
    return {
      allow: false,
      reason: 'this branch is not linked to a ticket',
      hint: `git config branch.${branch ?? '<branch>'}.asanaTask <gid>   (or run /ticket)`,
    };
  }

  const stamp = verify(tree);
  if (!stamp.ok) {
    return { allow: false, reason: stamp.reason, hint: 'run /validate in Claude Code, then commit again' };
  }
  return { allow: true, reason: 'validated' };
}

if (isMain(import.meta.url)) {
  const files = stagedFiles();
  const d = decide({
    files,
    merging: isMerging(),
    tree: files.length ? writeTree() : '',
    ticket: ticketForBranch(),
    branch: currentBranch(),
    cfg: config(),
  });
  if (d.allow) process.exit(0);
  process.stderr.write(`\nCommit blocked: ${d.reason}\n  ${d.hint}\n\n`);
  process.exit(1);
}
