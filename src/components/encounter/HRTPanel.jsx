import React, { useMemo } from 'react';
import Card, { CardHeader, CardBody } from '../common/Card';
import Badge from '../common/Badge';
import EmptyState from '../common/EmptyState';
import HRTRegimenCard from './HRTRegimenCard';
import PeptideCalculator from './PeptideCalculator';
import { HRT_KEYWORDS, isHrtRelevant } from '../../utils/hrt-keywords.mjs';

/**
 * HRTPanel — fourth encounter tab for HRT / Peptide / functional-medicine work.
 *
 * Purely presentational. All data arrives via props so EncounterPage owns the
 * data plumbing. Sections:
 *
 *   1. Active Regimens      — list of current HRT/peptide therapies
 *   2. Proposed Changes     — CDS + Domain Logic suggestions filtered to
 *                             HRT/peptide relevance via `isHrtRelevant`
 *   3. Peptide Calculator   — dose-to-U100-units math for compounded peptides
 *
 * Keyword list lives in `src/utils/hrt-keywords.mjs` so it can be shared with
 * EncounterPage's badge count and (Phase 3b) the client-side voice router,
 * without duplicating the list in each consumer.
 */

export default function HRTPanel({
  regimens = [],
  suggestions = [],
}) {
  const relevantSuggestions = useMemo(
    () => (suggestions || []).filter(isHrtRelevant),
    [suggestions]
  );
  const pendingSuggestions = useMemo(
    () => relevantSuggestions.filter((s) => !s.status || s.status === 'pending'),
    [relevantSuggestions]
  );

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">HRT / Peptide</h2>
        {pendingSuggestions.length > 0 && (
          <Badge variant="urgent">{pendingSuggestions.length} pending</Badge>
        )}
      </div>

      {/* Active Regimens */}
      <Card>
        <CardHeader>Active Regimens</CardHeader>
        <CardBody>
          {regimens.length === 0 ? (
            <EmptyState
              icon={"\u{1F489}"}
              title="No active HRT / peptide therapies"
              message="When a hormone or peptide therapy is prescribed for this patient, it will appear here with dose, schedule, and monitoring labs due."
            />
          ) : (
            <div className="space-y-3">
              {regimens.map((r, i) => (
                <HRTRegimenCard key={r.id || i} regimen={r} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Proposed Changes (HRT-relevant CDS + Domain Logic suggestions) */}
      <Card>
        <CardHeader
          action={pendingSuggestions.length > 0 && (
            <Badge variant="warning">{pendingSuggestions.length}</Badge>
          )}
        >
          Proposed Changes
        </CardHeader>
        <CardBody>
          {pendingSuggestions.length === 0 ? (
            <EmptyState
              icon={"\u{1F9E0}"}
              title="No pending proposals"
              message="Hormone/peptide-related CDS and Domain Logic suggestions will appear here for review before any dosing change."
            />
          ) : (
            <div className="space-y-2">
              {pendingSuggestions.map((s) => (
                <div
                  key={s.id}
                  className="border-l-4 border-l-blue-500 bg-blue-50/50 rounded-r-lg p-3"
                >
                  <div className="font-semibold text-sm text-gray-900">{s.title}</div>
                  {s.description && (
                    <p className="text-xs text-gray-600 mt-1">{s.description}</p>
                  )}
                  {s.rationale && (
                    <p className="text-xs text-gray-400 italic mt-1">{s.rationale}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Peptide Calculator */}
      <Card>
        <CardHeader>Peptide Dose Calculator</CardHeader>
        <CardBody>
          <PeptideCalculator />
        </CardBody>
      </Card>
    </div>
  );
}

// Re-export so existing consumers (EncounterPage) can keep their import path
// unchanged while the canonical source of truth lives in src/utils/.
export { HRT_KEYWORDS, isHrtRelevant };
