const TYPES = ['api', 'ui'];

export function parseCases(json) {
  let doc;
  try {
    doc = JSON.parse(json);
  } catch (error) {
    return { cases: [], problems: [`qa-cases.json is not valid JSON: ${error.message}`] };
  }

  const problems = [];
  const seen = new Set();
  const cases = [];

  for (const [index, raw] of (doc.cases ?? []).entries()) {
    const id = raw.id ?? `case ${index + 1}`;

    if (seen.has(id)) problems.push(`${id}: duplicate id`);
    seen.add(id);

    if (!TYPES.includes(raw.type)) problems.push(`${id}: type must be "api" or "ui"`);
    if (!raw.title) problems.push(`${id}: title is missing`);

    if (raw.type === 'api') {
      if (!raw.request?.method || !raw.request?.path) problems.push(`${id}: an api case needs request.method and request.path`);
      if (raw.expect?.status === undefined) problems.push(`${id}: an api case needs expect.status`);
    }

    if (raw.type === 'ui' && !(raw.steps?.length > 0)) problems.push(`${id}: a ui case needs steps`);

    cases.push({ scope: 'this-commit', status: 'pending', ...raw, id });
  }

  return { cases, problems };
}

export const inScope = (cases) => cases.filter((c) => c.type === 'api' && c.scope === 'this-commit');

export function summarise(cases) {
  const api = cases.filter((c) => c.type === 'api').length;
  const ui = cases.filter((c) => c.type === 'ui').length;
  const byStatus = cases.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
  const statuses = Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(', ');
  return `${cases.length} cases — ${api} api, ${ui} ui; ${statuses}`;
}
