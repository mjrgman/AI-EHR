/**
 * Shared date utility functions for Agentic EHR
 */

/**
 * Calculate a completed-years age by calendar comparison (year diff adjusted by
 * month/day), NOT by dividing elapsed milliseconds by 365.25 days.
 *
 * The millisecond/365.25 approach off-by-ones at boundaries: it under- or
 * over-counts by up to ~1 day because real years vary (365 vs 366), so a
 * birthday that has just occurred (or a leap-year Feb-29 birthday evaluated on
 * Feb-28/Mar-1) can flip to the wrong completed age. Calendar comparison is
 * exact and matches the NCQA "age as of <date>" convention.
 *
 * Leap-year Feb-29 birthdays: a person born 2000-02-29 "turns" N on Mar-1 in
 * common years (the JS Date for 2000-02-29 + N years lands on Mar-1 in a common
 * year, so day/month comparison treats Feb-28 as not-yet-birthday). This matches
 * the common US legal/actuarial convention.
 *
 * @param {string|Date} dob - Date of birth
 * @param {Date} [asOf] - Reference date (defaults to now)
 * @returns {number|null} Completed years of age, or null when DOB is missing/invalid
 */
function ageAsOf(dob, asOf = new Date()) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const ref = asOf instanceof Date ? asOf : new Date(asOf);
  if (isNaN(ref.getTime())) return null;

  let age = ref.getFullYear() - birth.getFullYear();
  const monthDiff = ref.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Calculate age from date of birth as of today.
 * @param {string|Date} dob - Date of birth
 * @returns {number} Age in years
 */
function calculateAge(dob) {
  return ageAsOf(dob, new Date());
}

module.exports = { calculateAge, ageAsOf };
