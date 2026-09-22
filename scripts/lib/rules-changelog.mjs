export function appendChangelogRow(fileText, { date, rule, why, source, evalCase }) {
  const lines = fileText.split('\n');
  const last = lines.map((l, i) => (l.trim().startsWith('|') ? i : -1)).filter((i) => i !== -1).at(-1);
  if (last === undefined) throw new Error('no changelog table found in the rules file');

  const row = `| ${date} | ${rule} | ${why} | ${source} | ${evalCase} |`;
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
}

// A rule that does not say how hard it bites, why it exists, or where the codebase already does it is
// a rule someone will argue with at review time. Catch that while it is being written.
export function checkRule(text) {
  const problems = [];

  if (!/`?(violation|suggestion)`?/i.test(text)) {
    problems.push('no severity — say `violation` (blocks) or `suggestion` (reported)');
  }
  if (!/(why|because)\b/i.test(text)) {
    problems.push('no why — a rule without a reason gets argued with instead of followed');
  }
  if (!/(backend|frontend)\/[\w./-]+/.test(text)) {
    problems.push('no example — name a real path the codebase already does this in');
  }

  return { ok: problems.length === 0, problems };
}
