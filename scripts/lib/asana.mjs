import { config } from './repo.mjs';
import { getSecret } from './secrets.mjs';

const API = 'https://app.asana.com/api/1.0';

export const taskGidFromUrl = (input = '') => {
  const s = String(input).trim();
  if (/^\d{6,}$/.test(s)) return s;
  const withTask = s.match(/\/task\/(\d{6,})/);
  if (withTask) return withTask[1];
  const legacy = s.match(/app\.asana\.com\/0\/\d+\/(\d{6,})/);
  return legacy ? legacy[1] : null;
};

export const taskUrl = (gid) => {
  const { workspace, project } = config().asana;
  return `https://app.asana.com/1/${workspace}/project/${project}/task/${gid}`;
};

async function call(path, { fetchImpl, token }) {
  const res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Asana ${path} failed with ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data;
}

export async function getTask(gid, { fetchImpl = fetch, token } = {}) {
  const auth = token ?? getSecret('ZAYAN_ASANA_TOKEN');
  const fields = 'name,notes,permalink_url,assignee.name,completed,custom_fields.name,custom_fields.display_value';

  const task = await call(`/tasks/${gid}?opt_fields=${fields}`, { fetchImpl, token: auth });
  const stories = await call(`/tasks/${gid}/stories?opt_fields=text,created_at,created_by.name,type`, { fetchImpl, token: auth });

  return {
    gid,
    name: task.name,
    notes: task.notes ?? '',
    permalink: task.permalink_url ?? taskUrl(gid),
    assignee: task.assignee?.name ?? null,
    completed: task.completed ?? false,
    customFields: (task.custom_fields ?? []).map((f) => ({ name: f.name, value: f.display_value })),
    stories: (stories ?? [])
      .filter((s) => s.type === 'comment')
      .map((s) => ({ author: s.created_by?.name ?? 'unknown', text: s.text ?? '', createdAt: s.created_at })),
  };
}
