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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome</h1>
          <p className="text-xl text-gray-600">Please verify your identity to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg p-8 space-y-5">
          <div>
            <label htmlFor="pv-first" className="block text-lg font-medium text-gray-700 mb-1">First Name</label>
            <input
              id="pv-first"
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="w-full min-h-[48px] text-xl px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
              placeholder="John"
              autoComplete="given-name"
              required
            />
          </div>

          <div>
            <label htmlFor="pv-last" className="block text-lg font-medium text-gray-700 mb-1">Last Name</label>
            <input
              id="pv-last"
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="w-full min-h-[48px] text-xl px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
              placeholder="Smith"
              autoComplete="family-name"
              required
            />
          </div>

          <div>
            <label htmlFor="pv-dob" className="block text-lg font-medium text-gray-700 mb-1">Date of Birth</label>
            <input
              id="pv-dob"
              type="date"
              value={dob}
              onChange={e => setDob(e.target.value)}
              className="w-full min-h-[48px] text-xl px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
              required
            />
          </div>

          <div>
            <label htmlFor="pv-mrn" className="block text-lg font-medium text-gray-700 mb-1">
              MRN <span className="text-base text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="pv-mrn"
              type="text"
              value={mrn}
              onChange={e => setMrn(e.target.value)}
              className="w-full min-h-[48px] text-xl px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
              placeholder="e.g. 123456"
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-lg" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isProcessing || !firstName.trim() || !lastName.trim() || !dob}
            className="w-full min-h-[56px] bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xl font-semibold rounded-xl transition-colors duration-150"
          >
            {isProcessing ? 'Verifying...' : 'Verify Identity'}
          </button>
        </form>

        {speechSupported && (
          <div className="text-center mt-8">
            <p className="text-lg text-gray-500 mb-4">Or tap the microphone and say your name and date of birth</p>
            <button
              onClick={onVoiceVerify}
              className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 hover:bg-blue-200 active:scale-95 transition-all"
              aria-label="Verify with voice"
            >
              <MicIcon className="w-7 h-7 text-blue-600" />
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
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur border-b border-gray-100">
        <div>
          <p className="text-lg text-gray-500">Hello,</p>
          <p className="text-2xl font-bold text-gray-900">{patientName}</p>
        </div>
        <button
          onClick={onEndSession}
          className="min-h-[48px] px-5 py-2 text-lg font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
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
              w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200
              focus:outline-none focus:ring-4 focus:ring-blue-300
              ${isListening
                ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200 animate-pulse-mic'
                : isProcessing
                  ? 'bg-gray-400 cursor-wait'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-95'
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

        <p className="mt-4 text-xl text-gray-500">
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
          <div className="mt-6 w-full bg-white rounded-2xl shadow p-6">
            <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-1">You said</p>
            <p className="text-xl text-gray-800">{transcript}</p>
          </div>
        )}

        {/* Response display */}
        {response && (
          <div className="mt-4 w-full bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <p className="text-sm font-medium text-blue-400 uppercase tracking-wide mb-1">Response</p>
            <p className="text-xl text-gray-900">{response}</p>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-4 w-full bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-lg" role="alert">
            {error}
          </div>
        )}

        {/* Text input fallback (always present, primary when speech not supported) */}
        <form onSubmit={handleTextSubmit} className="mt-6 w-full flex gap-3">
          <input
            type="text"
            value={typedText}
            onChange={e => setTypedText(e.target.value)}
            placeholder="Type your question here..."
            className="flex-1 min-h-[48px] text-xl px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition"
          />
          <button
            type="submit"
            disabled={!typedText.trim() || isProcessing}
            className="min-h-[48px] px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xl font-semibold rounded-xl transition-colors"
          >
            Send
          </button>
        </form>
      </main>

      {/* Quick actions */}
      <div className="px-6 pb-8 max-w-2xl mx-auto w-full">
        <p className="text-lg font-medium text-gray-500 mb-3 text-center">Quick Actions</p>
        <div className="grid grid-cols-2 gap-3">
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.label}
              onClick={() => onQuickAction(action.phrase)}
              disabled={isProcessing}
              className="min-h-[56px] bg-white hover:bg-gray-50 disabled:opacity-50 border-2 border-gray-200 rounded-xl px-4 py-3 text-xl font-medium text-gray-700 transition-colors active:scale-[0.98]"
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
