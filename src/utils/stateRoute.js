/**
 * stateRoute — shared encounter-state → URL mapper
 *
 * Single source of truth for both QueueDashboard and PatientPage (and any
 * future screen that needs to navigate to a live or completed encounter).
 *
 * Terminal states (signed / checked-out) route to the read-only Visit Summary
 * screen (/visit/:id) rather than to the Check-Out billing page.
 *
 * In-progress states map to the active workflow step so clinicians land at the
 * right stage of the encounter pipeline.
 */

const STATE_PREFIX_MAP = {
  'scheduled':           '/checkin/',
  'checked-in':          '/checkin/',
  'roomed':              '/ma/',
  'vitals-recorded':     '/ma/',
  'provider-examining':  '/encounter/',
  'orders-pending':      '/encounter/',
  'documentation':       '/encounter/',
  'review-pending':      '/review/',
  // Terminal — read-only visit summary
  'signed':              '/visit/',
  'checked-out':         '/visit/',
};

/**
 * Returns the canonical URL for a given encounter state.
 *
 * @param {string|number} encounterId
 * @param {string} state  — workflow engine state string
 * @returns {string}       — full path (e.g. "/encounter/42")
 */
export function stateRoute(encounterId, state) {
  const prefix = STATE_PREFIX_MAP[state] || '/encounter/';
  return prefix + encounterId;
}

export default stateRoute;
