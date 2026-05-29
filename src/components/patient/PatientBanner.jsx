import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Badge from '../common/Badge';
import { avatarTone, getInitials } from '../common/avatarColor';

function calcAge(dob) {
  if (!dob) return '?';
  const b = new Date(dob), n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
  return age;
}

export default function PatientBanner({ patient, compact = false }) {
  if (!patient) return null;
  const age = patient.age || calcAge(patient.dob);
  const allergies = patient.allergies || [];
  // Brand-harmonious avatar tone (navy / slate / deep-teal / muted-gold) — no purple.
  const tone = avatarTone(`${patient.first_name || ''} ${patient.last_name || ''}`);

  return (
    <div className="relative border-b border-slate-100 bg-offWhite-100/90 px-4 py-3 shadow-mc backdrop-blur-sm">
      {/* Signature moment — a gold hairline crowns the patient banner. */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent"
        aria-hidden="true"
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold tracking-wide shadow-mc ring-1 ring-white/40 ${tone.bg} ${tone.text}`}>
            {getInitials(patient.first_name, patient.last_name)}
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold leading-tight text-navy-700">
              {patient.first_name} {patient.last_name}
              <span className="ml-2 font-body text-sm font-normal text-slate-400">{age}{patient.sex || ''} &middot; MRN: {patient.mrn}</span>
            </h2>
            {!compact && <p className="text-xs text-slate-500">DOB: {patient.dob} &middot; {patient.insurance_carrier || 'No insurance'}</p>}
          </div>
        </div>
        {allergies.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-danger-200 bg-danger-50 px-3 py-1.5 shadow-mc">
            <span className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-danger-700">
              <AlertTriangle size={15} strokeWidth={2.5} aria-hidden="true" /> Allergies
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {allergies.map((a, i) => <Badge key={a.id || a.allergen || i} variant="danger">{a.allergen}</Badge>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
