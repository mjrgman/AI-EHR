import { useMemo } from 'react';
import { detectHRTCategories } from '../utils/hrt-keywords.mjs';

/**
 * useHRTKeywords — stateless detector for hormone/peptide/functional-med
 * categories in an encounter transcript.
 *
 * This is deliberately a thin, pure `useMemo` wrapper around
 * `detectHRTCategories` (which is unit-tested in test/run-tests.js). It holds
 * NO state of its own — the consumer (EncounterPage) owns any UI policy like
 * "only auto-focus once per encounter". Keeping the hook stateless means:
 *
 *   1. There is no hidden "has already fired" flag that could desync from
 *      the encounter lifecycle — resetting the transcript naturally resets
 *      the matched categories with no extra wiring.
 *   2. All non-trivial logic lives in a pure function that runs the same way
 *      in Node tests and in the browser. Any test that passes for
 *      `detectHRTCategories` automatically covers this hook.
 *   3. The server is still the authoritative classifier: this hook exists
 *      purely to give the user instant UI feedback (tab focus) while the
 *      DomainLogicAgent does the real routing on the backend.
 *
 * @param {string} transcript — accumulated final transcript from
 *   `useSpeechRecognition` (or any text source)
 * @returns {{ categories: string[], hasHrtContent: boolean }}
 */
export function useHRTKeywords(transcript) {
  return useMemo(() => {
    const categories = detectHRTCategories(transcript);
    return {
      categories,
      hasHrtContent: categories.length > 0,
    };
  }, [transcript]);
}

export default useHRTKeywords;
