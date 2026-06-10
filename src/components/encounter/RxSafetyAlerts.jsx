import React from 'react';
import { AlertTriangle, ShieldAlert, ShieldQuestion } from 'lucide-react';
import Badge from '../common/Badge';

// ============================================================
// RxSafetyAlerts — render the server's drug-safety screen at SIGN TIME
// ============================================================
//
// The prescription endpoints (`POST /api/prescriptions` and
// `POST /api/prescriptions/from-speech`) run a warn-and-allow drug-safety
// screen and RETURN a `safety` object on each created script. Before this
// component existed, nothing in src/ consumed it — so the drug-safety net was
// invisible to the prescriber at signing time (audit UR-001/A2 last-mile).
//
// The server contract (server/pharma/drug-safety-service.js fullSafetyCheck):
//   safety = {
//     alerts: [{ type, severity, title, description, source, unavailable? }],
//     interactionScreeningUnavailable: boolean,
//     boxedWarning: { hasBoxedWarning: boolean, warning: string|null },
//   }
//   alert.type     ∈ drug_interaction | boxed_warning | contraindication
//                    | interaction_screening_unavailable
//   alert.severity ∈ critical | serious | moderate | minor | warning
//
// Presentation rules (mirror the warn-and-allow / fail-closed server design):
//   (a) Drug interactions, boxed warnings and contraindications are CRITICAL —
//       danger treatment, must stay visible before the script is finalized.
//   (b) "interaction screening unavailable — verify manually" is a WARNING, not
//       a hard block (warn-and-allow). It is surfaced distinctly so an empty/
//       partial interaction list is never read as a clean "no interactions"
//       result (fail closed).
//
// Styling reuses the wave-1 `cdsError` idiom in EncounterPage: role="alert" +
// aria-live, danger/gold tinted surface, lucide warning icon, Measured Canon
// Badge variants (`danger`, `warning`).

// A `type` (or `severity`) that means "screening could not run" rather than a
// clinical finding. These are downgraded to the warn-and-allow tier.
function isScreeningUnavailableAlert(alert) {
  return (
    alert?.unavailable === true ||
    alert?.type === 'interaction_screening_unavailable' ||
    alert?.severity === 'warning'
  );
}

// Map an alert's severity to a Measured Canon Badge variant. Critical/serious
// findings ride the red `danger` variant; the screening-unavailable warning
// rides the gold `warning` variant; lesser findings stay neutral-but-visible.
function badgeVariantFor(alert) {
  if (isScreeningUnavailableAlert(alert)) return 'warning';
  if (alert?.severity === 'critical' || alert?.severity === 'serious') return 'danger';
  return 'info';
}

function severityLabel(alert) {
  if (isScreeningUnavailableAlert(alert)) return 'Verify manually';
  switch (alert?.severity) {
    case 'critical': return 'Critical';
    case 'serious': return 'Serious';
    case 'moderate': return 'Moderate';
    case 'minor': return 'Minor';
    default: return 'Alert';
  }
}

// One alert row. Critical findings get a danger-tinted surface; the
// screening-unavailable warning gets a gold-tinted surface.
function SafetyAlertRow({ alert }) {
  const unavailable = isScreeningUnavailableAlert(alert);
  const surface = unavailable
    ? 'bg-gold-50 ring-1 ring-gold-200'
    : 'bg-danger-50 ring-1 ring-danger-200';
  const Icon = unavailable ? ShieldQuestion : ShieldAlert;
  const iconColor = unavailable ? 'text-gold-600' : 'text-danger-600';
  const textColor = unavailable ? 'text-gold-800' : 'text-danger-700';

  return (
    <div
      className={`flex items-start gap-2 rounded-lg px-3 py-2 ${surface}`}
      role="alert"
      aria-live="assertive"
    >
      <Icon size={15} className={`mt-0.5 shrink-0 ${iconColor}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${textColor}`}>{alert.title}</span>
          <Badge variant={badgeVariantFor(alert)}>{severityLabel(alert)}</Badge>
        </div>
        {alert.description && (
          <p className={`mt-0.5 text-xs ${textColor}`}>{alert.description}</p>
        )}
        {alert.source && (
          <p className="mt-0.5 text-[11px] text-slate-500">Source: {alert.source}</p>
        )}
      </div>
    </div>
  );
}

// Render the safety screen for a single prescription. `medicationName` is used
// only for the section heading. Returns null when there is nothing to show
// (a clean screen with no findings and screening available).
export default function RxSafetyAlerts({ safety, medicationName }) {
  if (!safety) return null;

  const alerts = Array.isArray(safety.alerts) ? safety.alerts : [];

  // Split into critical findings (interactions, boxed warnings,
  // contraindications) vs the screening-unavailable warning so the two tiers
  // render with the distinct treatment the warn-and-allow design requires.
  const critical = alerts.filter(a => !isScreeningUnavailableAlert(a));
  const unavailable = alerts.filter(isScreeningUnavailableAlert);

  // The server also exposes interactionScreeningUnavailable directly; surface a
  // synthetic warning row if the flag is set but no explicit alert came back
  // (defensive — keeps "fail closed" visible even on an unexpected shape).
  const showScreeningWarning =
    unavailable.length > 0 || safety.interactionScreeningUnavailable === true;

  if (critical.length === 0 && !showScreeningWarning) return null;

  return (
    <div className="space-y-1.5" data-testid="rx-safety-alerts">
      <div className="flex items-center gap-1.5 px-0.5">
        <AlertTriangle size={13} className="text-danger-600" aria-hidden="true" />
        <span className="text-xs font-semibold text-danger-700">
          Drug-safety screen{medicationName ? `: ${medicationName}` : ''}
        </span>
      </div>

      {/* Critical findings first — interactions, boxed warnings, contraindications. */}
      {critical.map((alert, i) => (
        <SafetyAlertRow key={`crit-${i}`} alert={alert} />
      ))}

      {/* Screening-unavailable warning (warn-and-allow). Render the explicit
          alert(s) if present, else a synthetic fail-closed warning. */}
      {unavailable.length > 0
        ? unavailable.map((alert, i) => <SafetyAlertRow key={`unavail-${i}`} alert={alert} />)
        : showScreeningWarning && (
            <SafetyAlertRow
              alert={{
                type: 'interaction_screening_unavailable',
                severity: 'warning',
                unavailable: true,
                title: `Interaction check unavailable${medicationName ? `: ${medicationName}` : ''}`,
                description:
                  'Automated drug-safety screening could not be completed. Verify interactions, boxed warnings, and allergies manually.',
                source: 'drug-safety-service',
              }}
            />
          )}
    </div>
  );
}
