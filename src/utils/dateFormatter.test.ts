import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appleScriptDateCode,
  formatDateForAppleScript,
  formatDateTimeForDisplay,
  getDefaultDueTime,
  parseDateInput,
} from './dateFormatter.js';

test('formatDateForAppleScript returns locale-independent YYYY-MM-DD for date-only input', () => {
  assert.equal(formatDateForAppleScript('2026-12-31'), '2026-12-31');
});

test('formatDateForAppleScript normalizes full ISO input to YYYY-MM-DD', () => {
  assert.equal(formatDateForAppleScript('2026-01-09T23:59:00'), '2026-01-09');
});

test('formatDateForAppleScript throws on invalid input', () => {
  assert.throws(() => formatDateForAppleScript('not-a-date'));
});

test('parseDateInput preserves explicit time', () => {
  const parsed = parseDateInput('2026-07-15T17:00');
  assert.deepEqual(parsed, {
    year: 2026,
    month: 7,
    day: 15,
    hours: 17,
    minutes: 0,
    seconds: 0,
    hasExplicitTime: true,
  });
});

test('parseDateInput accepts a space instead of T', () => {
  const parsed = parseDateInput('2026-07-15 09:30:45');
  assert.equal(parsed.hours, 9);
  assert.equal(parsed.minutes, 30);
  assert.equal(parsed.seconds, 45);
});

test('parseDateInput applies defaultTime to date-only input', () => {
  const parsed = parseDateInput('2026-07-15', { defaultTime: '17:00' });
  assert.equal(parsed.hours, 17);
  assert.equal(parsed.minutes, 0);
  assert.equal(parsed.hasExplicitTime, false);
});

test('parseDateInput defaults date-only input to midnight', () => {
  const parsed = parseDateInput('2026-07-15');
  assert.equal(parsed.hours, 0);
  assert.equal(parsed.minutes, 0);
  assert.equal(parsed.seconds, 0);
});

test('parseDateInput converts Z timestamps to local wall-clock components', () => {
  const instant = new Date('2026-07-15T12:00:00Z');
  const parsed = parseDateInput('2026-07-15T12:00:00Z');
  assert.equal(parsed.year, instant.getFullYear());
  assert.equal(parsed.month, instant.getMonth() + 1);
  assert.equal(parsed.day, instant.getDate());
  assert.equal(parsed.hours, instant.getHours());
  assert.equal(parsed.minutes, instant.getMinutes());
  assert.equal(parsed.hasExplicitTime, true);
});

test('parseDateInput converts ±HH:MM offsets to local wall-clock components', () => {
  const instant = new Date('2026-07-15T23:30:00+05:00');
  const parsed = parseDateInput('2026-07-15T23:30:00+05:00');
  assert.equal(parsed.day, instant.getDate());
  assert.equal(parsed.hours, instant.getHours());
  assert.equal(parsed.minutes, instant.getMinutes());
});

test('parseDateInput accepts toISOString output (fractional seconds)', () => {
  const instant = new Date('2026-07-15T12:00:00.000Z');
  const parsed = parseDateInput(instant.toISOString());
  assert.equal(parsed.hours, instant.getHours());
});

test('parseDateInput rejects US-style slash dates instead of silently misreading them', () => {
  assert.throws(() => parseDateInput('07/08/2026'), /Invalid date string/);
});

test('parseDateInput rejects dotted European dates', () => {
  assert.throws(() => parseDateInput('15.07.2026'), /Invalid date string/);
});

test('parseDateInput rejects impossible calendar dates', () => {
  assert.throws(() => parseDateInput('2026-02-30'));
});

test('parseDateInput rejects impossible calendar dates with zone markers instead of rolling over', () => {
  assert.throws(() => parseDateInput('2026-02-30T12:00:00Z'));
  assert.throws(() => parseDateInput('2026-04-31T09:00+03:00'));
});

test('parseDateInput rejects out-of-range times with zone markers', () => {
  assert.throws(() => parseDateInput('2026-07-15T24:00Z'));
});

test('parseDateInput rejects out-of-range times', () => {
  assert.throws(() => parseDateInput('2026-07-15T25:00'));
  assert.throws(() => parseDateInput('2026-07-15T10:61'));
});

test('parseDateInput rejects empty input', () => {
  assert.throws(() => parseDateInput('  '));
});

test('getDefaultDueTime falls back to 17:00 and honors the env variable', () => {
  const saved = process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
  try {
    delete process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
    assert.equal(getDefaultDueTime(), '17:00');

    process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME = '18:30';
    assert.equal(getDefaultDueTime(), '18:30');

    process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME = '25:99';
    assert.equal(getDefaultDueTime(), '17:00');
  } finally {
    if (saved === undefined) {
      delete process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
    } else {
      process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME = saved;
    }
  }
});

test('appleScriptDateCode builds locale-independent date construction', () => {
  const code = appleScriptDateCode('2026-02-28', 'dueDateValue');

  assert.match(code, /set dueDateValue to current date/);
  assert.match(code, /set day of dueDateValue to 1/);
  assert.match(code, /set year of dueDateValue to 2026/);
  assert.match(code, /set month of dueDateValue to 2/);
  assert.match(code, /set day of dueDateValue to 28/);
  assert.match(code, /set hours of dueDateValue to 0/);
  assert.match(code, /set minutes of dueDateValue to 0/);
  assert.match(code, /set seconds of dueDateValue to 0/);
});

test('appleScriptDateCode keeps the rollover guard before year/month/day', () => {
  const code = appleScriptDateCode('2026-02-28', 'dueDateValue');
  const guardIndex = code.indexOf('set day of dueDateValue to 1');
  const yearIndex = code.indexOf('set year of dueDateValue');
  assert.ok(guardIndex >= 0 && guardIndex < yearIndex);
});

test('appleScriptDateCode preserves explicit time components', () => {
  const code = appleScriptDateCode('2026-07-15T17:00', 'dueDateValue');

  assert.match(code, /set hours of dueDateValue to 17/);
  assert.match(code, /set minutes of dueDateValue to 0/);
  assert.match(code, /set seconds of dueDateValue to 0/);
});

test('appleScriptDateCode applies defaultTime to date-only due dates', () => {
  const code = appleScriptDateCode('2026-07-15', 'dueDateValue', { defaultTime: '17:00' });

  assert.match(code, /set hours of dueDateValue to 17/);
  assert.match(code, /set minutes of dueDateValue to 0/);
});

test('appleScriptDateCode rejects US-style slash dates', () => {
  assert.throws(() => appleScriptDateCode('07/08/2026', 'dueDateValue'));
});

test('appleScriptDateCode rejects invalid variable names', () => {
  assert.throws(() => appleScriptDateCode('2026-02-28', 'invalid name'));
});

test('formatDateTimeForDisplay renders local YYYY-MM-DD HH:MM', () => {
  const local = new Date(2026, 6, 15, 17, 5);
  assert.equal(formatDateTimeForDisplay(local.toISOString()), '2026-07-15 17:05');
});

test('formatDateTimeForDisplay returns unparseable input unchanged', () => {
  assert.equal(formatDateTimeForDisplay('garbage'), 'garbage');
});
