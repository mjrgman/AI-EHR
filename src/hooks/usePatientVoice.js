import { useState, useEffect, useRef, useCallback } from 'react';

const SILENCE_TIMEOUT_MS = 2000;
const API_BASE = '/api/patient-portal';

export default function usePatientVoice() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [patientName, setPatientName] = useState('');

  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const patientIdRef = useRef(null);
  const shouldListenRef = useRef(false);

  // Feature detection and SpeechRecognition setup
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError('Speech recognition not supported in this browser');
      return;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let finalText = '';
      let hasNewFinal = false;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
          hasNewFinal = true;
        }
      }

      if (hasNewFinal) {
        setTranscript(prev => {
          const updated = prev + (prev ? ' ' : '') + finalText.trim();
          // Reset silence timer on each final result — process after 2s pause
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            processTranscript(updated);
          }, SILENCE_TIMEOUT_MS);
          return updated;
        });
      }
    };

    recognition.onerror = (event) => {
      const msg = event.error || 'unknown';
      if (msg === 'no-speech' || msg === 'aborted') return;
      setError(`Speech recognition error: ${msg}`);
      setIsListening(false);
      shouldListenRef.current = false;
    };

    recognition.onend = () => {
      // Browser auto-stops recognition; restart if we should still be listening
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch (_) {
          // already started or no permission
        }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      clearTimeout(silenceTimerRef.current);
      try {
        recognition.stop();
      } catch (_) {
        // ok
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- SpeechSynthesis ---
  const speak = useCallback((text) => {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    // Prefer a clear English voice when available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      v => v.lang.startsWith('en') && v.name.includes('Google')
    ) || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;

    window.speechSynthesis.speak(utterance);
  }, []);

  // --- API: process transcript ---
  const processTranscript = useCallback(async (text) => {
    if (!text || !text.trim() || !patientIdRef.current) return;
    setIsProcessing(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/voice-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientIdRef.current,
          transcript: text.trim()
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Request failed (${res.status})`);
      }

      const data = await res.json();
      const responseText = data.response || data.text || 'I received your request.';
      setResponse(responseText);
      speak(responseText);
    } catch (err) {
      const msg = err.message || 'Failed to process your request';
      setError(msg);
      setResponse('');
    } finally {
      setIsProcessing(false);
    }
  }, [speak]);

  // --- Controls ---
  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    setTranscript('');
    setResponse('');
    shouldListenRef.current = true;
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (_) {
      // already started
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    clearTimeout(silenceTimerRef.current);
    try {
      recognitionRef.current?.stop();
    } catch (_) {
      // ok
    }
    setIsListening(false);
  }, []);

  // --- Patient verification ---
  const verifyPatient = useCallback(async (firstName, lastName, dob, mrn) => {
    setIsProcessing(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          date_of_birth: dob,
          mrn: mrn || undefined
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Verification failed');
      }

      const data = await res.json();
      patientIdRef.current = data.patient_id || data.id;
      setPatientName(`${firstName} ${lastName}`);
      setIsAuthenticated(true);
      setResponse('');
      setTranscript('');
      return true;
    } catch (err) {
      setError(err.message || 'Could not verify identity');
      setIsAuthenticated(false);
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Reset session (for "End Session")
  const resetSession = useCallback(() => {
    stopListening();
    window.speechSynthesis?.cancel();
    patientIdRef.current = null;
    setIsAuthenticated(false);
    setPatientName('');
    setTranscript('');
    setResponse('');
    setError(null);
    setIsProcessing(false);
  }, [stopListening]);

  return {
    // State
    isListening,
    transcript,
    response,
    isProcessing,
    error,
    isAuthenticated,
    patientName,
    // Actions
    startListening,
    stopListening,
    speak,
    processTranscript,
    verifyPatient,
    resetSession
  };
}
