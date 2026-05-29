import { useState, useCallback } from 'react';
import usePatientVoice from '../hooks/usePatientVoice';

const QUICK_ACTIONS = [
  { label: 'My Appointments', phrase: 'What are my upcoming appointments?' },
  { label: 'Medication Refill', phrase: 'I need a medication refill' },
  { label: 'Lab Results', phrase: 'What are my lab results?' },
  { label: 'Visit Prep', phrase: 'What should I bring to my next visit?' }
];

// ─── Verify Mode ──────────────────────────────────────────────────────

function VerifyForm({ onVerify, isProcessing, error, speechSupported, onVoiceVerify }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [mrn, setMrn] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !dob) return;
    onVerify(firstName.trim(), lastName.trim(), dob, mrn.trim());
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory-200 px-4">
      <div className="mc-reveal w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full border border-navy-100 bg-navy-50">
            <svg className="h-8 w-8 text-navy-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="mb-2 font-display text-3xl font-semibold text-navy-700">Welcome</h1>
          <p className="text-xl text-slate-600">Please verify your identity to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="relative space-y-5 overflow-hidden rounded-2xl border border-slate-100 bg-offWhite-100 p-8 shadow-mc-lg">
          {/* Signature moment — gold hairline crowns the welcome card */}
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent" aria-hidden="true" />
          <div>
            <label htmlFor="pv-first" className="mb-1 block text-lg font-medium text-slate-700">First Name</label>
            <input
              id="pv-first"
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-ivory-100 px-4 py-3 text-xl text-navy-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
              placeholder="John"
              autoComplete="given-name"
              required
            />
          </div>

          <div>
            <label htmlFor="pv-last" className="mb-1 block text-lg font-medium text-slate-700">Last Name</label>
            <input
              id="pv-last"
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-ivory-100 px-4 py-3 text-xl text-navy-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
              placeholder="Smith"
              autoComplete="family-name"
              required
            />
          </div>

          <div>
            <label htmlFor="pv-dob" className="mb-1 block text-lg font-medium text-slate-700">Date of Birth</label>
            <input
              id="pv-dob"
              type="date"
              value={dob}
              onChange={e => setDob(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-ivory-100 px-4 py-3 text-xl text-navy-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
              required
            />
          </div>

          <div>
            <label htmlFor="pv-mrn" className="mb-1 block text-lg font-medium text-slate-700">
              MRN <span className="text-base font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="pv-mrn"
              type="text"
              value={mrn}
              onChange={e => setMrn(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-ivory-100 px-4 py-3 text-xl text-navy-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
              placeholder="e.g. 123456"
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-lg font-medium text-danger-700" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isProcessing || !firstName.trim() || !lastName.trim() || !dob}
            className="min-h-[56px] w-full rounded-xl bg-navy-600 text-xl font-semibold text-white transition-colors duration-150 hover:bg-navy-700 disabled:bg-slate-400"
          >
            {isProcessing ? 'Verifying...' : 'Verify Identity'}
          </button>
        </form>

        {speechSupported && (
          <div className="mt-8 text-center">
            <p className="mb-4 text-lg text-slate-500">Or tap the microphone and say your name and date of birth</p>
            <button
              onClick={onVoiceVerify}
              className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-navy-100 bg-navy-50 transition-all hover:bg-navy-100 active:scale-95"
              aria-label="Verify with voice"
            >
              <MicIcon className="h-7 w-7 text-navy-600" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Conversation Mode ────────────────────────────────────────────────

function ConversationView({
  patientName, isListening, isProcessing, transcript, response, error,
  onMicToggle, onQuickAction, onEndSession, speechSupported, textInput
}) {
  const [typedText, setTypedText] = useState('');

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!typedText.trim()) return;
    textInput(typedText.trim());
    setTypedText('');
  };

  return (
    <div className="flex min-h-screen flex-col bg-ivory-200">
      {/* Header */}
      <header className="relative flex items-center justify-between border-b border-slate-100 bg-offWhite-100/80 px-6 py-4 backdrop-blur">
        {/* Signature moment — gold hairline crowns the conversation header */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent" aria-hidden="true" />
        <div>
          <p className="text-lg text-slate-500">Hello,</p>
          <p className="font-display text-2xl font-semibold text-navy-700">{patientName}</p>
        </div>
        <button
          onClick={onEndSession}
          className="min-h-[48px] rounded-xl border border-danger-100 bg-danger-50 px-5 py-2 text-lg font-medium text-danger-600 transition-colors hover:bg-danger-100"
        >
          End Session
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8 max-w-2xl mx-auto w-full">
        {/* Microphone */}
        {speechSupported ? (
          <button
            onClick={onMicToggle}
            disabled={isProcessing}
            className={`
              flex h-24 w-24 items-center justify-center rounded-full transition-all duration-200
              focus:outline-none focus:ring-4 focus:ring-gold-300
              ${isListening
                ? 'animate-pulse-mic bg-danger-500 shadow-mc-lg hover:bg-danger-600'
                : isProcessing
                  ? 'cursor-wait bg-slate-400'
                  : 'bg-navy-600 shadow-mc-lg hover:bg-navy-700 active:scale-95'
              }
            `}
            aria-label={isListening ? 'Stop listening' : 'Start listening'}
          >
            {isProcessing ? (
              <svg className="w-10 h-10 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <MicIcon className="w-10 h-10 text-white" />
            )}
          </button>
        ) : null}

        <p className="mt-4 text-xl text-slate-500">
          {isProcessing
            ? 'Processing...'
            : isListening
              ? 'Listening... speak now'
              : speechSupported
                ? 'Tap the microphone to speak'
                : 'Type your question below'
          }
        </p>

        {/* Transcript display */}
        {transcript && (
          <div className="mt-6 w-full rounded-2xl border border-slate-100 bg-offWhite-100 p-6 shadow-mc">
            <p className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-400">You said</p>
            <p className="text-xl text-navy-700">{transcript}</p>
          </div>
        )}

        {/* Response display */}
        {response && (
          <div className="mt-4 w-full rounded-2xl border border-navy-100 bg-navy-50 p-6">
            <p className="mb-1 text-sm font-medium uppercase tracking-wide text-gold-700">Response</p>
            <p className="text-xl text-navy-700">{response}</p>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-4 w-full rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-lg font-medium text-danger-700" role="alert">
            {error}
          </div>
        )}

        {/* Text input fallback (always present, primary when speech not supported) */}
        <form onSubmit={handleTextSubmit} className="mt-6 flex w-full gap-3">
          <input
            type="text"
            value={typedText}
            onChange={e => setTypedText(e.target.value)}
            placeholder="Type your question here..."
            className="min-h-[48px] flex-1 rounded-xl border-2 border-slate-200 bg-offWhite-100 px-4 py-3 text-xl text-navy-700 outline-none transition focus:border-gold-400 focus:ring-2 focus:ring-gold-100"
          />
          <button
            type="submit"
            disabled={!typedText.trim() || isProcessing}
            className="min-h-[48px] rounded-xl bg-navy-600 px-6 py-3 text-xl font-semibold text-white transition-colors hover:bg-navy-700 disabled:bg-slate-400"
          >
            Send
          </button>
        </form>
      </main>

      {/* Quick actions */}
      <div className="mx-auto w-full max-w-2xl px-6 pb-8">
        <p className="mb-3 text-center text-lg font-medium text-slate-500">Quick Actions</p>
        <div className="mc-reveal-stagger grid grid-cols-2 gap-3">
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.label}
              onClick={() => onQuickAction(action.phrase)}
              disabled={isProcessing}
              className="min-h-[56px] rounded-xl border-2 border-slate-200 bg-offWhite-100 px-4 py-3 text-xl font-medium text-navy-700 transition-colors hover:bg-ivory-200 hover:border-gold-300 disabled:opacity-50 active:scale-[0.98]"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────

function MicIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0M12 19v3m-4 0h8M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z" />
    </svg>
  );
}

// ─── Pulse animation style (injected once) ─────────────────────────

const PULSE_STYLE_ID = 'pv-pulse-anim';
if (typeof document !== 'undefined' && !document.getElementById(PULSE_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = PULSE_STYLE_ID;
  style.textContent = `
    @keyframes pulse-mic {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
      50% { box-shadow: 0 0 0 16px rgba(239, 68, 68, 0); }
    }
    .animate-pulse-mic { animation: pulse-mic 1.5s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}

// ─── Main Component ──────────────────────────────────────────────────

export default function PatientVoice() {
  const {
    isListening, transcript, response, isProcessing, error,
    isAuthenticated, patientName,
    startListening, stopListening, processTranscript,
    verifyPatient, resetSession
  } = usePatientVoice();

  const speechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Toggle mic on/off
  const handleMicToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Quick action buttons
  const handleQuickAction = useCallback((phrase) => {
    processTranscript(phrase);
  }, [processTranscript]);

  // Text input submit (fallback for no speech support)
  const handleTextInput = useCallback((text) => {
    processTranscript(text);
  }, [processTranscript]);

  // Voice verify — just toggle mic (user speaks name + DOB, manual form still required for structured verify)
  const handleVoiceVerify = useCallback(() => {
    handleMicToggle();
  }, [handleMicToggle]);

  // ── Verify mode ──
  if (!isAuthenticated) {
    return (
      <VerifyForm
        onVerify={verifyPatient}
        isProcessing={isProcessing}
        error={error}
        speechSupported={speechSupported}
        onVoiceVerify={handleVoiceVerify}
      />
    );
  }

  // ── Conversation mode ──
  return (
    <ConversationView
      patientName={patientName}
      isListening={isListening}
      isProcessing={isProcessing}
      transcript={transcript}
      response={response}
      error={error}
      onMicToggle={handleMicToggle}
      onQuickAction={handleQuickAction}
      onEndSession={resetSession}
      speechSupported={speechSupported}
      textInput={handleTextInput}
    />
  );
}
