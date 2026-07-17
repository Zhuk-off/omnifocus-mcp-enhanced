import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchStopReason, BATCH_DEADLINE_MS } from './batchAddItems.js';

test('batchStopReason returns undefined while inside budget and not aborted', () => {
  assert.equal(batchStopReason(Date.now()), undefined);
  assert.equal(batchStopReason(Date.now(), new AbortController().signal), undefined);
});

test('batchStopReason stops when the client aborted', () => {
  const controller = new AbortController();
  controller.abort();
  const reason = batchStopReason(Date.now(), controller.signal);
  assert.ok(reason && reason.includes('cancelled'), `unexpected reason: ${reason}`);
});

test('batchStopReason stops when the time budget is exhausted', () => {
  const startedAt = Date.now() - BATCH_DEADLINE_MS - 1;
  const reason = batchStopReason(startedAt);
  assert.ok(reason && reason.includes('time budget'), `unexpected reason: ${reason}`);
  // Abort has priority over the deadline message when both apply.
  const controller = new AbortController();
  controller.abort();
  assert.ok(batchStopReason(startedAt, controller.signal)!.includes('cancelled'));
});
