export function buildUrl(baseUrl, testCase) {
  const vars = testCase.vars ?? {};
  const path = testCase.request.path.replace(/\{(\w+)\}/g, (whole, name) =>
    (vars[name] === undefined ? whole : encodeURIComponent(vars[name])));

  const query = testCase.request.query ?? {};
  const search = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  return `${baseUrl.replace(/\/$/, '')}${path}${search ? `?${search}` : ''}`;
}

export async function runCases(cases, { baseUrl, token, fetchImpl = fetch }) {
  const results = [];

  for (const testCase of cases.filter((c) => c.type === 'api')) {
    const { method, body } = testCase.request;
    const url = buildUrl(baseUrl, testCase);
    const started = Date.now();

    try {
      const res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      let payload = '';
      try {
        payload = JSON.stringify(await res.json());
      } catch {
        payload = '(the response body was not JSON)';
      }

      const evidence = `${method} ${testCase.request.path} -> ${res.status}`;
      const expected = testCase.expect ?? {};
      const problems = [];

      if (expected.status !== undefined && res.status !== expected.status) {
        problems.push(`expected ${expected.status}, got ${res.status}`);
      }
      if (expected.jsonContains && !payload.includes(expected.jsonContains)) {
        problems.push(`the response did not contain ${expected.jsonContains} — body was ${payload.slice(0, 300)}`);
      }
      if (expected.jsonNotContains && payload.includes(expected.jsonNotContains)) {
        problems.push(`the response should not have contained ${expected.jsonNotContains} — body was ${payload.slice(0, 300)}`);
      }

      results.push({
        id: testCase.id,
        status: problems.length ? 'failed' : 'passed',
        evidence,
        durationMs: Date.now() - started,
        ...(problems.length ? { error: problems.join('; ') } : {}),
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        status: 'failed',
        evidence: `${method} ${testCase.request.path} -> no response`,
        durationMs: Date.now() - started,
        error: error.message,
      });
    }
  }

  return results;
}
