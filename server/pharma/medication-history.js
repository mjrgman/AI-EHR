'use strict';

// Keep unavailable history distinct from an explicitly supplied empty list.
// Database medication status values are active, discontinued, and completed.
function isMedicationRecord(med) {
  return !!med && typeof med === 'object' && !Array.isArray(med)
    && typeof med.medication_name === 'string' && med.medication_name.trim().length > 0;
}

function selectActiveMedications(history) {
  if (!Array.isArray(history)) return history;
  const active = [];
  for (const med of history) {
    if (!isMedicationRecord(med)) {
      active.push(null);
      continue;
    }
    if (['discontinued', 'completed'].includes(med.status)) continue;
    if (med.status !== 'active') {
      // Preserve an invalid entry as an explicit non-result. Never silently
      // filter it out and turn incomplete history into an empty active list.
      active.push(null);
      active.push(med);
    } else {
      active.push(med);
    }
  }
  return active;
}

module.exports = { isMedicationRecord, selectActiveMedications };
