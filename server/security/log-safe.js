'use strict';

/**
 * Log-injection defence.
 *
 * Several call sites interpolate user-controlled values -- a username, a role,
 * a request path -- straight into a console line. A value containing CR or LF
 * splits one log entry into two, so an attacker can forge entries: a crafted
 * username can append a line that reads like a successful admin action. CodeQL
 * flags this as js/log-injection; it found five instances in this codebase.
 *
 * The fix is to neutralise the characters that end a log record, not to stop
 * logging the value -- knowing WHICH user was denied is the point of the line.
 *
 * @param {*} value    the untrusted value
 * @param {number} max truncation length, because a megabyte header should not
 *                     become a megabyte of log
 * @returns {string}   a single-line, control-character-free rendering
 */
function logSafe(value, max = 200) {
  if (value === null || value === undefined) return String(value);

  let str;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    str = String(value);
  }
  if (str === undefined) str = String(value);

  // Strip CR, LF, tab, NUL and the rest of the C0/C1 control range, plus the
  // Unicode line/paragraph separators that some viewers also treat as breaks.
  // eslint-disable-next-line no-control-regex
  const cleaned = str.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ');

  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

module.exports = { logSafe };
