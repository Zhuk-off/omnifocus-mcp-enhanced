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

test('editItem verifies addTags before moving or editing by default', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    newProjectId: 'proj-1',
    addTags: ['Home']
  });

  const verifyIndex = script.indexOf('set missingTags to {}');
  const moveIndex = script.indexOf('move foundItem to end of tasks of destinationProject');
  assert.ok(verifyIndex > -1);
  assert.ok(moveIndex > -1);
  assert.ok(verifyIndex < moveIndex);
  assert.doesNotMatch(script, /make new tag/);
});

test('editItem verifies replaceTags before clearing existing tags by default', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    replaceTags: ['Home', 'Errands']
  });

  const verifyIndex = script.indexOf('set missingTags to {}');
  const clearIndex = script.indexOf('remove existingTag from tags of foundItem');
  assert.ok(verifyIndex > -1);
  assert.ok(clearIndex > -1);
  assert.ok(verifyIndex < clearIndex);
  assert.match(script, /repeat with tagName in \{"Home", "Errands"\}/);
  assert.doesNotMatch(script, /make new tag/);
});

test('editItem creates missing tags when createMissingTags is true', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    addTags: ['Home'],
    createMissingTags: true
  });

  assert.doesNotMatch(script, /set missingTags to \{\}/);
  assert.match(script, /set tagObj to make new tag with properties \{name:tagName\}/);
});

test('editItem verifies addTags even when replaceTags is present', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    replaceTags: ['Home'],
    addTags: ['Errands']
  });

  assert.match(script, /set missingTags to \{\}/);
  assert.match(script, /repeat with tagName in \{"Home", "Errands"\}/);
});

test('editItem deduplicates tags shared by replaceTags and addTags in verification', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    replaceTags: ['Home'],
    addTags: ['Home', 'Errands']
  });

  assert.match(script, /repeat with tagName in \{"Home", "Errands"\}/);
});

test('editItem does not verify tags for removeTags only', () => {
  const script = generateAppleScript({
    id: 'task-123',
    itemType: 'task',
    removeTags: ['Home']
  });

  assert.doesNotMatch(script, /set missingTags to/);
  assert.doesNotMatch(script, /make new tag/);
});
