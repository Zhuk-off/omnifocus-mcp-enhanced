import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAppleScript } from './addProject.js';

test('addProject date handling uses preamble variables outside OmniFocus tell block', () => {
  const script = generateAppleScript({
    name: 'Project with dates',
    dueDate: '2026-02-27',
    deferDate: '2026-02-25',
    plannedDate: '2026-02-24'
  });

  const tellIndex = script.indexOf('tell application "OmniFocus"');
  const preambleIndex = script.indexOf('set dueDateValue to current date');
  assert.ok(preambleIndex > -1 && preambleIndex < tellIndex);

  assert.match(script, /set due date of newProject to dueDateValue/);
  assert.match(script, /set defer date of newProject to deferDateValue/);
  assert.match(script, /set planned date of newProject to plannedDateValue/);

  assert.doesNotMatch(script, /set due date of newProject to date "/);
  assert.doesNotMatch(script, /set defer date of newProject to date "/);
  assert.doesNotMatch(script, /set planned date of newProject to date "/);
});

test('addProject applies default due time to date-only dueDate but midnight to deferDate', () => {
  const saved = process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
  try {
    process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME = '17:00';
    const script = generateAppleScript({
      name: 'Project with date-only dates',
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

test('addProject keeps apostrophes and doubles backslashes in text fields', () => {
  const script = generateAppleScript({
    name: "Client's \\ Roadmap",
    note: "Things that didn't work in C:\\Temp"
  });

  assert.match(script, /name:"Client's \\\\ Roadmap"/);
  assert.match(script, /set note of newProject to "Things that didn't work in C:\\\\Temp"/);
  assert.doesNotMatch(script, /\\'/);
});

test('addProject escapes JSON response values through AppleScript helper', () => {
  const script = generateAppleScript({
    name: "Client's \\ Roadmap"
  });

  assert.match(script, /on jsonEscape\(inputText\)/);
  assert.match(script, /set projectNameValue to name of newProject/);
  assert.match(script, /my jsonEscape\(projectId\)/);
  assert.match(script, /my jsonEscape\(projectNameValue\)/);
});

test('addProject verifies tags before creating the project by default', () => {
  const script = generateAppleScript({
    name: 'Tagged project',
    tags: ['Home']
  });

  const verifyIndex = script.indexOf('set missingTags to {}');
  const createIndex = script.indexOf('make new project');
  assert.ok(verifyIndex > -1);
  assert.ok(createIndex > -1);
  assert.ok(verifyIndex < createIndex);
  assert.match(script, /add theTag to tags of newProject/);
  assert.doesNotMatch(script, /make new tag/);
});

test('addProject creates missing tags when createMissingTags is true', () => {
  const script = generateAppleScript({
    name: 'Tagged project',
    tags: ['Home'],
    createMissingTags: true
  });

  assert.doesNotMatch(script, /set missingTags to \{\}/);
  assert.match(script, /set theTag to make new tag with properties \{name:"Home"\}/);
});
