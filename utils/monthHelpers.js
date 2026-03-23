/**
 * Month helper utilities.
 * All months represented as "YYYY-MM" strings to avoid timezone bugs.
 */

/**
 * Get current month as "YYYY-MM"
 */
function getCurrentMonth() {
  const now = new Date();
  return formatMonth(now.getFullYear(), now.getMonth() + 1);
}

/**
 * Format year and month (1-indexed) to "YYYY-MM"
 */
function formatMonth(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Parse "YYYY-MM" string into { year, month } (month is 1-indexed)
 */
function parseMonth(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  return { year, month };
}

/**
 * Generate array of all months from startMonth to endMonth (inclusive).
 * Both in "YYYY-MM" format.
 */
function getMonthRange(startMonth, endMonth) {
  const start = parseMonth(startMonth);
  const end = parseMonth(endMonth);
  const months = [];

  let y = start.year;
  let m = start.month;

  while (y < end.year || (y === end.year && m <= end.month)) {
    months.push(formatMonth(y, m));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  return months;
}

/**
 * Compare two "YYYY-MM" strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareMonths(a, b) {
  return a.localeCompare(b);
}

/**
 * Convert a Date object to "YYYY-MM" string
 */
function dateToMonth(date) {
  const d = new Date(date);
  return formatMonth(d.getFullYear(), d.getMonth() + 1);
}

/**
 * Get the previous month as "YYYY-MM"
 */
function getPreviousMonth(monthStr) {
  const { year, month } = parseMonth(monthStr);
  if (month === 1) return formatMonth(year - 1, 12);
  return formatMonth(year, month - 1);
}

module.exports = {
  getCurrentMonth,
  formatMonth,
  parseMonth,
  getMonthRange,
  compareMonths,
  dateToMonth,
  getPreviousMonth,
};
