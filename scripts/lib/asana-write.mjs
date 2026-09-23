import { getSecret } from './secrets.mjs';

const API = 'https://app.asana.com/api/1.0';
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(path, { method = 'POST', body, fetchImpl = fetch, token }) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Asana ${method} ${path} failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data;
}

// Asana accepts a small tag set inside <body> and rejects <p> and <br>; plain newlines survive.
export function buildQaComment({ branch, previewUrl, prUrl, cases = [], waivers = [], reviewerGid }) {
  const api = cases.filter((c) => c.type === 'api');
  const ui = cases.filter((c) => c.type === 'ui');
  const failed = api.filter((c) => c.status === 'failed');

  const lines = ['<body><strong>Ready for QA</strong>', ''];
  lines.push(`Branch: <code>${escape(branch)}</code>`);
  lines.push(`Preview: <a href="${escape(previewUrl)}">${escape(previewUrl)}</a>`);
  lines.push(`PR: <a href="${escape(prUrl)}">${escape(prUrl)}</a>`, '');

  if (api.length) {
    lines.push('<strong>Verified over HTTP</strong>', '<ul>');
    for (const c of api) {
      const detail = c.status === 'failed'
        ? ` — FAILED: ${escape(c.error ?? '')}`
        : ` — ${escape(c.evidence ?? 'passed')}`;
      lines.push(`<li>${escape(c.id)} ${escape(c.title)}${detail}</li>`);
    }
    lines.push('</ul>');
  }

  if (ui.length) {
    lines.push('<strong>For QA to check</strong>', '<ul>');
    for (const c of ui) lines.push(`<li>${escape(c.id)} ${escape(c.title)}: ${escape((c.steps ?? []).join(' → '))}</li>`);
    lines.push('</ul>');
  }

  if (failed.length) lines.push(`<strong>${failed.length} case(s) failed — this is not ready to test.</strong>`);

  if (waivers.length) {
    lines.push('<strong>Waived review findings</strong>', '<ul>');
    for (const w of waivers) lines.push(`<li>${escape(w.rule)} — ${escape(w.reason ?? w.waivedReason ?? '')}</li>`);
    lines.push('</ul>');
  }

  lines.push('', `<a data-asana-gid="${reviewerGid}"/> over to you.`, '</body>');
  return lines.join('\n');
}

const token = () => getSecret('ZAYAN_ASANA_TOKEN');

export const postComment = (taskGid, html, { fetchImpl = fetch, token: t } = {}) =>
  call(`/tasks/${taskGid}/stories`, { body: { data: { html_text: html } }, fetchImpl, token: t ?? token() });

export const setCustomFields = (taskGid, fields, { fetchImpl = fetch, token: t } = {}) =>
  call(`/tasks/${taskGid}`, { method: 'PUT', body: { data: { custom_fields: fields } }, fetchImpl, token: t ?? token() });

export const moveToSection = (taskGid, sectionGid, { fetchImpl = fetch, token: t } = {}) =>
  call(`/sections/${sectionGid}/addTask`, { body: { data: { task: taskGid } }, fetchImpl, token: t ?? token() });

// A link in a comment scrolls away; an attachment stays at the top of the task where QA and the lead
// look for it.
export const attachLink = (taskGid, { url, name }, { fetchImpl = fetch, token: t } = {}) =>
  call('/attachments', {
    body: { data: { resource_subtype: 'external', parent: taskGid, url, name } },
    fetchImpl,
    token: t ?? token(),
  });
