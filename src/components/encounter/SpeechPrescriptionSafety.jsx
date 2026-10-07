import React from 'react';
import RxSafetyAlerts from './RxSafetyAlerts';

export default function SpeechPrescriptionSafety({ prescriptions = [], failure }) {
  return (
    <div className="space-y-2">
      {failure && <p role="alert" className="text-sm text-danger-700">{failure}</p>}
      {prescriptions.map((rx, i) => (
        <div key={rx.id || `unsaved-rx-${i}`}>
          <p className="text-xs text-slate-600">
            {rx.medication_name}: {rx.persistence?.status === 'saved' ? 'Draft saved; review required'
              : rx.persistence?.status === 'failed' ? 'Not saved'
                : rx.persistence?.status === 'not_attempted' ? 'Not attempted' : 'Draft; review required'}
          </p>
          <RxSafetyAlerts safety={rx.safety} medicationName={rx.medication_name} />
        </div>
      ))}
    </div>
  );
}
