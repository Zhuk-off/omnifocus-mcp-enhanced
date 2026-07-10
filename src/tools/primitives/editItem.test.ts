import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAppleScript, validateEditItemParams } from './editItem.js';

test('editItem date handling uses preamble variables outside OmniFocus tell block', () => {
  const script = generateAppleScript({
    id: 'abc123',
    itemType: 'task',
    newDueDate: '2026-02-24',
    newDeferDate: '2026-02-23',
    newPlannedDate: '2026-02-22'
  });

  const tellIndex = script.indexOf('tell application "OmniFocus"');
  const preambleIndex = script.indexOf('set newDueDateValue to current date');
  assert.ok(preambleIndex > -1 && preambleIndex < tellIndex);

  assert.match(script, /set due date of foundItem to newDueDateValue/);
  assert.match(script, /set defer date of foundItem to newDeferDateValue/);
  assert.match(script, /set planned date of foundItem to newPlannedDateValue/);

  assert.doesNotMatch(script, /set due date of foundItem to date "/);
  assert.doesNotMatch(script, /set defer date of foundItem to date "/);
  assert.doesNotMatch(script, /set planned date of foundItem to date "/);
});

test('editItem applies default due time to date-only newDueDate but midnight to newDeferDate', () => {
  const saved = process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
  try {
    process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME = '17:00';
    const script = generateAppleScript({
      id: 'abc123',
      itemType: 'task',
      newDueDate: '2026-02-24',
      newDeferDate: '2026-02-23'
    });

    assert.match(script, /set hours of newDueDateValue to 17/);
    assert.match(script, /set hours of newDeferDateValue to 0/);
  } finally {
    if (saved === undefined) {
      delete process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
    } else {
      process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME = saved;
    }
  }
});

test('validateEditItemParams rejects task move parameters for project edits', () => {
  const validation = validateEditItemParams({
    id: 'project-1',
    itemType: 'project',
    newProjectName: 'ShouldFail'
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /only supported when itemType is "task"/);
});

test('validateEditItemParams rejects conflicting destination types', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newProjectId: 'proj-1',
    moveToInbox: true
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Invalid destination selection/);
});

test('generateAppleScript adds duplicate-safe source lookup by task name', () => {
  const script = generateAppleScript({
    name: 'Duplicate Name',
    itemType: 'task',
    newFlagged: true
  });

  assert.match(script, /set nameMatches to \(flattened tasks where name = "Duplicate Name"\)/);
  assert.match(script, /Ambiguous task name: Duplicate Name\. Multiple matches found; please use id\./);
});

test('generateAppleScript moves task to project before applying property edits', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    newProjectName: 'Roadmap',
    newName: 'Renamed Task'
  });

  const moveIndex = script.indexOf('move foundItem to end of tasks of destinationProject');
  const renameIndex = script.indexOf('set name of foundItem to "Renamed Task"');

  assert.ok(moveIndex > -1);
  assert.ok(renameIndex > -1);
  assert.ok(moveIndex < renameIndex);
  assert.match(script, /set end of changedProperties to "moved \(project\)"/);
});

test('replaceTags resolves/creates target tags before removing existing ones', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    replaceTags: ['work', 'urgent']
  });

  const resolveIndex = script.indexOf('set end of resolvedTags to tagObj');
  const removeIndex = script.indexOf('remove existingTag from tags of foundItem');

  // Target tags must be resolved/created before any existing tag is stripped,
  // so a failure can't leave the task with no tags.
  assert.ok(resolveIndex > -1 && removeIndex > -1);
  assert.ok(resolveIndex < removeIndex);
  assert.match(script, /set resolvedTags to \{\}/);
});

test('empty newName is not applied (would blank the item)', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    newName: ''
  });

  assert.doesNotMatch(script, /set name of foundItem to ""/);
});

test('generateAppleScript protects against moving task under itself or descendants', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    newParentTaskName: 'Parent Candidate'
  });

  assert.match(script, /set cursorTask to destinationParentTask/);
  assert.match(script, /cannot move a task into itself or its descendants/);
  assert.match(script, /move foundItem to end of tasks of destinationParentTask/);
});

test('generateAppleScript supports moving task to inbox', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    moveToInbox: true
  });

  assert.match(script, /move foundItem to end of inbox tasks/);
  assert.match(script, /set end of changedProperties to "moved \(inbox\)"/);
});

test('generateAppleScript marks completed tasks with mark complete', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    newStatus: 'completed'
  });

  assert.match(script, /mark complete foundItem/);
  assert.doesNotMatch(script, /set completed of foundItem to true/);
});

test('generateAppleScript keeps apostrophes and doubles backslashes in edited text fields', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    newName: "Client's \\ follow-up",
    newNote: "Check Bob's file in C:\\Temp"
  });

  assert.match(script, /set name of foundItem to "Client's \\\\ follow-up"/);
  assert.match(script, /set note of foundItem to "Check Bob's file in C:\\\\Temp"/);
  assert.doesNotMatch(script, /\\'/);
});

test('generateAppleScript escapes edit responses through AppleScript helper', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    newName: "Client's \\ follow-up"
  });

  assert.match(script, /on jsonEscape\(inputText\)/);
  assert.match(script, /my jsonEscape\(itemId\)/);
  assert.match(script, /my jsonEscape\(itemName\)/);
  assert.match(script, /my jsonEscape\(changedPropsText\)/);
  assert.match(script, /my jsonEscape\(errorMessage\)/);
});
