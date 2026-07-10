import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTagAssignmentScript, buildTagVerificationScript, generateAppleScript } from './addOmniFocusTask.js';

test('buildTagAssignmentScript only assigns existing tags by default', () => {
  const script = buildTagAssignmentScript(['mcp-test-tag'], 'newTask');

  assert.match(script, /set theTag to first flattened tag where name = "mcp-test-tag"/);
  assert.match(script, /if theTag is not missing value then/);
  assert.match(script, /add theTag to tags of newTask/);
  assert.doesNotMatch(script, /make new tag/);
});

test('buildTagAssignmentScript creates missing tags when createMissingTags is true', () => {
  const script = buildTagAssignmentScript(['mcp-test-tag'], 'newTask', true);

  assert.match(script, /set theTag to first flattened tag where name = "mcp-test-tag"/);
  assert.match(script, /if theTag is missing value then/);
  assert.match(script, /set theTag to make new tag with properties \{name:"mcp-test-tag"\}/);
  assert.match(script, /add theTag to tags of newTask/);
});

test('buildTagVerificationScript fails with the list of unknown tags', () => {
  const script = buildTagVerificationScript(['Home', 'Errands']);

  assert.match(script, /repeat with tagName in \{"Home", "Errands"\}/);
  assert.match(script, /set end of missingTags to \(tagName as string\)/);
  assert.match(script, /Unknown tags: /);
  assert.match(script, /createMissingTags/);
});

test('buildTagVerificationScript escapes quotes and backslashes in tag names', () => {
  const script = buildTagVerificationScript(['ta"g', 'back\\slash']);

  assert.match(script, /\{"ta\\"g", "back\\\\slash"\}/);
});

test('generateAppleScript verifies tags before creating the task by default', () => {
  const script = generateAppleScript({
    name: 'Tagged task',
    tags: ['Home']
  });

  const verifyIndex = script.indexOf('set missingTags to {}');
  const createIndex = script.indexOf('make new inbox task');
  assert.ok(verifyIndex > -1);
  assert.ok(createIndex > -1);
  assert.ok(verifyIndex < createIndex);
  assert.doesNotMatch(script, /make new tag/);
});

test('generateAppleScript skips tag verification when createMissingTags is true', () => {
  const script = generateAppleScript({
    name: 'Tagged task',
    tags: ['Home'],
    createMissingTags: true
  });

  assert.doesNotMatch(script, /set missingTags to \{\}/);
  assert.match(script, /make new tag/);
});

test('generateAppleScript emits no tag verification when there are no tags', () => {
  const script = generateAppleScript({ name: 'No tags' });

  assert.doesNotMatch(script, /set missingTags to/);
});

test('generateAppleScript builds date variables before OmniFocus tell block', () => {
  const script = generateAppleScript({
    name: 'Task with dates',
    dueDate: '2026-02-27',
    deferDate: '2026-02-25',
    plannedDate: '2026-02-24'
  });

  const tellIndex = script.indexOf('tell application "OmniFocus"');
  const preambleIndex = script.indexOf('set dueDateValue to current date');
  assert.ok(preambleIndex > -1 && preambleIndex < tellIndex);

  assert.match(script, /set due date of newTask to dueDateValue/);
  assert.match(script, /set defer date of newTask to deferDateValue/);
  assert.match(script, /set planned date of newTask to plannedDateValue/);

  assert.doesNotMatch(script, /set due date of newTask to date "/);
  assert.doesNotMatch(script, /set defer date of newTask to date "/);
  assert.doesNotMatch(script, /set planned date of newTask to date "/);
});

test('generateAppleScript applies default due time to date-only dueDate but midnight to deferDate', () => {
  const saved = process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
  try {
    process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME = '17:00';
    const script = generateAppleScript({
      name: 'Task with date-only dates',
      dueDate: '2026-02-27',
      deferDate: '2026-02-25'
    });

    assert.match(script, /set hours of dueDateValue to 17/);
    assert.match(script, /set hours of deferDateValue to 0/);
  } finally {
    if (saved === undefined) {
      delete process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
    } else {
      process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME = saved;
    }
  }
});

test('generateAppleScript preserves explicit time in dueDate', () => {
  const script = generateAppleScript({
    name: 'Task with timed due date',
    dueDate: '2026-02-27T09:15'
  });

  assert.match(script, /set hours of dueDateValue to 9/);
  assert.match(script, /set minutes of dueDateValue to 15/);
});

test('generateAppleScript keeps apostrophes and doubles backslashes in task text fields', () => {
  const script = generateAppleScript({
    name: "Review client's \\ draft",
    note: "Check Bob's file in C:\\Temp"
  });

  assert.match(script, /make new inbox task with properties \{name:"Review client's \\\\ draft"\}/);
  assert.match(script, /set note of newTask to "Check Bob's file in C:\\\\Temp"/);
  assert.doesNotMatch(script, /\\'/);
});

test('generateAppleScript escapes JSON response values through AppleScript helper', () => {
  const script = generateAppleScript({
    name: "Review client's \\ draft"
  });

  assert.match(script, /on jsonEscape\(inputText\)/);
  assert.match(script, /set taskNameValue to name of newTask/);
  assert.match(script, /my jsonEscape\(taskId\)/);
  assert.match(script, /my jsonEscape\(taskNameValue\)/);
});
