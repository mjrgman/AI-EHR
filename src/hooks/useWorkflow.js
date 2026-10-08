import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

export function useWorkflow(encounterId) {
  const [workflow, setWorkflow] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!encounterId) return;
    setLoading(true);
    try {
      const [wf, tl] = await Promise.all([
        api.getWorkflow(encounterId).catch(() => null),
        api.getTimeline(encounterId).catch(() => null)
      ]);
      setWorkflow(wf);
      setTimeline(tl);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [encounterId]);

  useEffect(() => { refresh(); }, [refresh]);

  const transition = useCallback(async (targetState, metadata = {}) => {
    if (!encounterId) return;
    try {
      const result = await api.transitionWorkflow(encounterId, { target_state: targetState, ...metadata });
      await refresh();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [encounterId, refresh]);

  const timelineEntries = Array.isArray(timeline) ? timeline : (timeline?.timeline || []);

  return { workflow, timeline, timelineEntries, loading, error, transition, refresh };
}
