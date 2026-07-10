/**
 * Utility functions for date formatting
 */

const APPLE_SCRIPT_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Strict wall-clock date/time: YYYY-MM-DD, optionally followed by "T" or a
// space and HH:MM[:SS[.fff]], optionally followed by "Z" or a ±HH:MM offset.
// Anything else (e.g. "07/08/2026", "15.07.2026") must be rejected loudly:
// Date-parseable fallbacks silently reinterpret such strings in US order.
const STRICT_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

const TIME_OF_DAY_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const FALLBACK_DUE_TIME = '17:00';

export interface ParseDateOptions {
  /**
   * Time of day (HH:MM or HH:MM:SS) applied when the input has no time part.
   * Defaults to 00:00:00.
   */
  defaultTime?: string;
}

export interface DateTimeComponents {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  hasExplicitTime: boolean;
}

function parseTimeOfDay(time: string): { hours: number; minutes: number; seconds: number } {
  const match = TIME_OF_DAY_PATTERN.exec(time.trim());
  if (!match) {
    throw new Error(`Invalid time of day: "${time}". Use HH:MM or HH:MM:SS (24-hour).`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] !== undefined ? Number(match[3]) : 0;

  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Invalid time of day: "${time}". Use HH:MM or HH:MM:SS (24-hour).`);
  }

  return { hours, minutes, seconds };
}

/**
 * Default time of day applied to date-only due dates, so a bare "2026-07-15"
 * means "by the end of the workday" instead of midnight (which OmniFocus
 * treats as overdue from the first second of the day).
 *
 * Configurable via the OMNIFOCUS_MCP_DEFAULT_DUE_TIME env variable
 * (HH:MM or HH:MM:SS, 24-hour); falls back to 17:00.
 */
export function getDefaultDueTime(): string {
  const fromEnv = process.env.OMNIFOCUS_MCP_DEFAULT_DUE_TIME;
  if (!fromEnv || fromEnv.trim() === '') {
    return FALLBACK_DUE_TIME;
  }

  try {
    parseTimeOfDay(fromEnv);
    return fromEnv.trim();
  } catch {
    console.error(
      `Ignoring invalid OMNIFOCUS_MCP_DEFAULT_DUE_TIME="${fromEnv}"; using ${FALLBACK_DUE_TIME}`
    );
    return FALLBACK_DUE_TIME;
  }
}

/**
 * Parse an input date string into local wall-clock components.
 *
 * Accepted forms:
 * - "YYYY-MM-DD" (time taken from options.defaultTime, else 00:00:00)
 * - "YYYY-MM-DDTHH:MM[:SS]" or "YYYY-MM-DD HH:MM[:SS]" — local wall time
 * - Either time form with a trailing "Z" or "±HH:MM" — an absolute instant,
 *   converted to local time (the only place `new Date(string)` is legitimate)
 *
 * Anything else throws with an explanatory message.
 */
export function parseDateInput(isoDate: string, options: ParseDateOptions = {}): DateTimeComponents {
  if (!isoDate || isoDate.trim() === '') {
    throw new Error('Date string cannot be empty');
  }

  const trimmed = isoDate.trim();
  const match = STRICT_DATE_TIME_PATTERN.exec(trimmed);

  if (!match) {
    throw new Error(
      `Invalid date string: "${isoDate}". Use ISO format: "YYYY-MM-DD" or ` +
      `"YYYY-MM-DDTHH:MM[:SS]" (24-hour, "T" or space separator, optional ` +
      `"Z"/"±HH:MM" offset), e.g. "2026-07-15T17:00".`
    );
  }

  const [, y, m, d, hh, mm, ss, zone] = match;

  // Validate the written wall-clock components regardless of zone marker:
  // `new Date("2026-02-30T12:00Z")` would silently roll over to March 2.
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const validator = new Date(year, month - 1, day);

  if (
    validator.getFullYear() !== year ||
    validator.getMonth() !== month - 1 ||
    validator.getDate() !== day
  ) {
    throw new Error(`Invalid date string: ${isoDate}`);
  }

  const hasExplicitTime = hh !== undefined;
  let hours: number;
  let minutes: number;
  let seconds: number;

  if (hasExplicitTime) {
    hours = Number(hh);
    minutes = Number(mm);
    seconds = ss !== undefined ? Number(ss) : 0;

    if (hours > 23 || minutes > 59 || seconds > 59) {
      throw new Error(`Invalid time in date string: ${isoDate}`);
    }
  } else {
    ({ hours, minutes, seconds } = parseTimeOfDay(options.defaultTime ?? '00:00'));
  }

  // Inputs with an explicit UTC/offset marker describe an absolute instant:
  // convert it to the local wall-clock time OmniFocus expects.
  if (zone) {
    const instant = new Date(trimmed.replace(' ', 'T'));
    if (isNaN(instant.getTime())) {
      throw new Error(`Invalid date string: ${isoDate}`);
    }

    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
      hours: instant.getHours(),
      minutes: instant.getMinutes(),
      seconds: instant.getSeconds(),
      hasExplicitTime: true,
    };
  }

  return { year, month, day, hours, minutes, seconds, hasExplicitTime };
}

/**
 * Convert an input date string to an AppleScript-compatible, locale-independent
 * YYYY-MM-DD value (date part only; time is handled by `appleScriptDateCode`).
 *
 * AppleScript parses ISO-like YYYY-MM-DD reliably across system locales.
 * English month names (e.g. "31 December 2026") can fail on non-English systems.
 *
 * @param isoDate ISO date string (e.g., "2026-01-09" or "2026-01-09T12:00:00")
 * @returns AppleScript-compatible date string (e.g., "2026-01-09")
 * @throws Error if the date string is invalid
 */
export function formatDateForAppleScript(isoDate: string): string {
  const { year, month, day } = parseDateInput(isoDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Format an ISO date string as local "YYYY-MM-DD HH:MM" for display layers,
 * so tool output shows the time component instead of hiding it.
 */
export function formatDateTimeForDisplay(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    return isoDate;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Format a user-supplied input date string (as accepted by `parseDateInput`)
 * as local "YYYY-MM-DD HH:MM" for confirmation messages.
 *
 * Unlike `formatDateTimeForDisplay`, this never feeds a date-only string to
 * `new Date(string)` (which would parse it as UTC midnight), and it applies
 * the same `defaultTime` the write path used — so the confirmation shows the
 * date and time that were actually set.
 */
export function formatDateInputForDisplay(isoDate: string, options: ParseDateOptions = {}): string {
  let components: DateTimeComponents;
  try {
    components = parseDateInput(isoDate, options);
  } catch {
    return isoDate;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${components.year}-${pad(components.month)}-${pad(components.day)} ` +
    `${pad(components.hours)}:${pad(components.minutes)}`;
}

/**
 * Build AppleScript code that constructs a Date from numeric components.
 *
 * This avoids locale-dependent parsing (e.g. `date "28 February 2026"`) and
 * should be inserted before any `tell application "OmniFocus"` block to avoid
 * property name collisions with OmniFocus terms.
 *
 * @param isoDate Date string accepted by `parseDateInput`
 * @param variableName Target AppleScript variable name (e.g. "dueDateValue")
 * @param options Parsing options (e.g. default time for date-only input)
 * @returns AppleScript statements for creating a date variable
 */
export function appleScriptDateCode(
  isoDate: string,
  variableName: string,
  options: ParseDateOptions = {}
): string {
  if (!APPLE_SCRIPT_VARIABLE_NAME_PATTERN.test(variableName)) {
    throw new Error(`Invalid AppleScript variable name: ${variableName}`);
  }

  const { year, month, day, hours, minutes, seconds } = parseDateInput(isoDate, options);

  // `set day ... to 1` first guards against month-length rollover while the
  // year/month fields are being changed. Keep it before year/month/day.
  return `
    set ${variableName} to current date
    set day of ${variableName} to 1
    set year of ${variableName} to ${year}
    set month of ${variableName} to ${month}
    set day of ${variableName} to ${day}
    set hours of ${variableName} to ${hours}
    set minutes of ${variableName} to ${minutes}
    set seconds of ${variableName} to ${seconds}`;
}
