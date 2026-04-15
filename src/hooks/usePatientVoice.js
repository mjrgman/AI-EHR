import { useState, useEffect, useRef, useCallback } from 'react';
import { portalApi } from '../api/client';

const SILENCE_TIMEOUT_MS = 2000;

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
  const shouldListenRef = useRef(false);

  const bootstrapPortalSession = useCallback(async () => {
    try {
      const session = await portalApi.getSession();
      const name = session?.patient?.name || [session?.patient?.first_name, session?.patient?.last_name].filter(Boolean).join(' ');
      if (name) {
        setPatientName(name);
      }
      setIsAuthenticated(Boolean(session?.authenticated));
      return true;
    } catch {
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  useEffect(() => {
    bootstrapPortalSession();
  }, [bootstrapPortalSession]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError('Speech recognition not supported in this browser');
      return undefined;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let finalText = '';
      let hasNewFinal = false;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
          hasNewFinal = true;
        }
      }

      if (hasNewFinal) {
        setTranscript((previous) => {
          const updated = `${previous}${previous ? ' ' : ''}${finalText.trim()}`.trim();
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            processTranscript(updated);
          }, SILENCE_TIMEOUT_MS);
          return updated;
        });
      }
    };

    recognition.onerror = (event) => {
      const message = event.error || 'unknown';
      if (message === 'no-speech' || message === 'aborted') return;
      setError(`Speech recognition error: ${message}`);
      setIsListening(false);
      shouldListenRef.current = false;
    };

    recognition.onend = () => {
      if (shouldListenRef.current) {
        try {
          recognition.start();
        } catch {
          // Browser already restarted the recognition stream.
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
      } catch {
        // Ignore shutdown failures from browsers that already stopped.
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const speak = useCallback((text) => {
    if (!text || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.lang = 'en-US';

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((voice) => voice.lang.startsWith('en') && voice.name.includes('Google'))
      || voices.find((voice) => voice.lang.startsWith('en'));
    if (preferred) {
      utterance.voice = preferred;
    }

    window.speechSynthesis.speak(utterance);
  }, []);

  const processTranscript = useCallback(async (text) => {
    if (!text || !text.trim()) return;

    setIsProcessing(true);
    setError(null);

    try {
      if (!isAuthenticated) {
        const hasSession = await bootstrapPortalSession();
        if (!hasSession) {
          throw new Error('Please verify your identity before sending a voice request.');
        }
      }

      const data = await portalApi.processVoiceIntent(text.trim());
      const responseText = data.response || data.text || 'I received your request.';
      setResponse(responseText);
      speak(responseText);
    } catch (err) {
      setResponse('');
      setError(err.message || 'Failed to process your request');
    } finally {
      setIsProcessing(false);
    }
  }, [bootstrapPortalSession, isAuthenticated, speak]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    setTranscript('');
    setResponse('');
    shouldListenRef.current = true;
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch {
      // SpeechRecognition throws if already started; ignore.
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    clearTimeout(silenceTimerRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {
      // Ignore browser stop errors.
    }
    setIsListening(false);
  }, []);

  const verifyPatient = useCallback(async (firstName, lastName, dob, mrn) => {
    setIsProcessing(true);
    setError(null);

    try {
      const data = await portalApi.verify({
        first_name: firstName,
        last_name: lastName,
        dob,
        ...(mrn ? { mrn } : {}),
      });

      const name = data?.patient?.name || `${firstName} ${lastName}`.trim();
      setPatientName(name);
      setIsAuthenticated(true);
      setResponse('');
      setTranscript('');
      return true;
    } catch (err) {
      setIsAuthenticated(false);
      setError(err.message || 'Could not verify identity');
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const resetSession = useCallback(async () => {
    stopListening();
    window.speechSynthesis?.cancel();

    try {
      await portalApi.logout();
    } catch {
      // Ignore logout failures; local state should still clear.
    }

    setIsAuthenticated(false);
    setPatientName('');
    setTranscript('');
    setResponse('');
    setError(null);
    setIsProcessing(false);
  }, [stopListening]);

  return {
    isListening,
    transcript,
    response,
    isProcessing,
    error,
    isAuthenticated,
    patientName,
    startListening,
    stopListening,
    speak,
    processTranscript,
    verifyPatient,
    resetSession,
    bootstrapPortalSession,
  };
}
