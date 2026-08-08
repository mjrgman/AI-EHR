import React from 'react';
import {
  CalendarDays, UserCheck, DoorOpen, HeartPulse, Stethoscope,
  ClipboardList, FileText, PenLine, Flag, Check,
} from 'lucide-react';

// Each entry keeps the `'state': { ... }` object shape (a source-level unit test
// parses these keys as the canonical workflow vocabulary). The emoji glyphs are
// replaced by on-brand lucide-react icon components stored under `Icon`.
const STATE_CONFIG = {
  'scheduled': { label: 'Scheduled', Icon: CalendarDays },
  'checked-in': { label: 'Checked In', Icon: UserCheck },
  'roomed': { label: 'Roomed', Icon: DoorOpen },
  'vitals-recorded': { label: 'Vitals', Icon: HeartPulse },
  'provider-examining': { label: 'Examining', Icon: Stethoscope },
  'orders-pending': { label: 'Orders', Icon: ClipboardList },
  'documentation': { label: 'Docs', Icon: FileText },
  'signed': { label: 'Signed', Icon: PenLine },
  'checked-out': { label: 'Done', Icon: Flag },
};

const ALL_STATES = Object.keys(STATE_CONFIG);

export default function WorkflowTracker({ timeline, currentState, compact = false }) {
  if (!timeline && !currentState) return null;

  if (compact) {
    const cfg = STATE_CONFIG[currentState] || { label: currentState, Icon: null };
    const CfgIcon = cfg.Icon;
    // Signed reads as success; the terminal "done" state reads slate; everything
    // in-flight reads navy-authority.
    const tone = currentState === 'signed'
      ? 'bg-success-50 text-success-700 border border-success-100'
      : currentState === 'checked-out'
        ? 'bg-ivory-200 text-slate-600 border border-slate-100'
        : 'bg-navy-50 text-navy-700 border border-navy-100';
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${tone}`}>
        {CfgIcon && <CfgIcon size={13} strokeWidth={2.25} aria-hidden="true" />} {cfg.label}
      </span>
    );
  }

  const states = timeline?.timeline || ALL_STATES.map(s => ({
    state: s, status: s === currentState ? 'current' : ALL_STATES.indexOf(s) < ALL_STATES.indexOf(currentState) ? 'completed' : 'pending'
  }));

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto py-2 px-1">
      {states.map((s, i) => {
        const cfg = STATE_CONFIG[s.state] || { label: s.state, Icon: null };
        const CfgIcon = cfg.Icon;
        const done = s.status === 'completed';
        const cur = s.status === 'current';
        // The "signed" milestone is the clinical success beat.
        const signed = s.state === 'signed' && (done || cur);
        return (
          <React.Fragment key={s.state}>
            {i > 0 && <div className={`h-0.5 w-3 flex-shrink-0 ${done || cur ? 'bg-navy-300' : 'bg-slate-100'}`} />}
            <div className={`flex flex-col items-center flex-shrink-0 ${cur ? 'scale-110' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                signed
                  ? (cur ? 'bg-success-500 text-white ring-2 ring-success-200' : 'bg-success-100 text-success-600')
                  : done
                    ? 'bg-navy-100 text-navy-600'
                    : cur
                      ? 'bg-navy-600 text-white ring-2 ring-navy-200'
                      : 'bg-ivory-300 text-slate-400'
              }`}>{done ? <Check size={15} strokeWidth={3} aria-hidden="true" /> : CfgIcon ? <CfgIcon size={14} strokeWidth={2.25} aria-hidden="true" /> : null}</div>
              <span className={`text-[9px] mt-0.5 whitespace-nowrap ${
                signed && cur ? 'font-bold text-success-700'
                  : cur ? 'font-bold text-navy-700'
                  : done ? 'text-navy-500'
                  : 'text-slate-400'
              }`}>{cfg.label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
