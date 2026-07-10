import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from './batchAddItems.js';

test('batch_add_items handler reports per-item errors when every item fails', async () => {
  const result = await handler({
    items: [{
      type: 'task' as const,
      name: 'X',
      projectName: 'P',
      parentTaskName: 'Q'
    }]
  }, {} as any);

  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /❌ task: "X"/);
  assert.match(text, /Do not provide projectName when parentTaskId or parentTaskName is set/);
  assert.doesNotMatch(text, /undefined/);
});
