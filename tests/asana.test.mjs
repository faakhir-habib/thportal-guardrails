import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskGidFromUrl, getTask, taskUrl } from '../scripts/lib/asana.mjs';

test('a task gid is pulled out of every URL shape the board produces', () => {
  assert.equal(taskGidFromUrl('https://app.asana.com/1/1209040875779194/project/1209042358568959/task/1218492088693885'), '1218492088693885');
  assert.equal(taskGidFromUrl('https://app.asana.com/0/1209042358568959/1218492088693885'), '1218492088693885');
  assert.equal(taskGidFromUrl('https://app.asana.com/1/x/project/y/task/1218492088693885?focus=true'), '1218492088693885');
  assert.equal(taskGidFromUrl('1218492088693885'), '1218492088693885');
  assert.equal(taskGidFromUrl('not a task'), null);
});

test('getTask returns the fields the ticket file needs', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => (url.includes('/stories')
      ? {
        data: [
          { created_by: { name: 'Aqil' }, text: 'repro steps', created_at: '2026-09-01T00:00:00Z', type: 'comment' },
          { created_by: { name: 'system' }, text: 'moved to QA', created_at: '2026-09-02T00:00:00Z', type: 'system' },
        ],
      }
      : {
        data: {
          gid: '123',
          name: 'Fix the dropdown',
          notes: 'it shows deleted lots',
          permalink_url: 'https://app.asana.com/x',
          assignee: { name: 'Faakhir' },
          custom_fields: [{ name: 'Priority', display_value: 'High' }],
        },
      }),
  });

  const task = await getTask('123', { fetchImpl, token: 'x' });
  assert.equal(task.name, 'Fix the dropdown');
  assert.equal(task.notes, 'it shows deleted lots');
  assert.equal(task.assignee, 'Faakhir');
  assert.deepEqual(task.customFields, [{ name: 'Priority', value: 'High' }]);
  assert.equal(task.stories.length, 1, 'system stories are not comments');
  assert.equal(task.stories[0].author, 'Aqil');
});

test('an API failure says which call failed and with what status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(() => getTask('123', { fetchImpl, token: 'x' }), /401/);
});

test('taskUrl builds a link the board recognises', () => {
  assert.equal(taskUrl('123'), 'https://app.asana.com/1/1209040875779194/project/1209042358568959/task/123');
});
