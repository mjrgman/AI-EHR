/**
 * InboxPage — Staff portal inbox
 *
 * Route: /inbox
 *
 * Surfaces portal-originated work: secure messages, refill requests, and
 * appointment requests. Accessible to front_desk, ma, physician, nurse_practitioner.
 * Staff can mark messages as read or actioned.
 *
 * B1 fix: portal-originated work was entirely invisible to clinical staff.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, RefreshCw, CheckCircle2, MessageSquare, Pill, Calendar } from 'lucide-react';
import api from '../api/client';
import Card, { CardHeader, CardBody } from '../components/common/Card';
import Badge from '../components/common/Badge';
import TouchButton from '../components/common/TouchButton';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { useToast } from '../components/common/Toast';

const TYPE_META = {
  refill_notification: { label: 'Refill Request', icon: Pill, badge: 'gold' },
  appointment_request: { label: 'Appt Request',  icon: Calendar, badge: 'navy' },
  general:             { label: 'Message',        icon: MessageSquare, badge: 'slate' },
};

function formatDate(str) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

export default function InboxPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'refill_notification' | 'general' | 'appointment_request'
  const [actioningId, setActioningId] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const params = filter !== 'all' ? { message_type: filter } : {};
      const result = await api.getStaffPortalMessages(params);
      setMessages(Array.isArray(result?.messages) ? result.messages : []);
    } catch (err) {
      setLoadError(err.message || 'Failed to load inbox');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function markActioned(msg) {
    setActioningId(msg.id);
    try {
      await api.updatePortalMessage(msg.id, { status: 'actioned' });
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, status: 'actioned' } : m));
    } catch (err) {
      toast.error('Failed to update message: ' + err.message);
    } finally {
      setActioningId(null);
    }
  }

  const FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'refill_notification', label: 'Refill Requests' },
    { value: 'general', label: 'Messages' },
    { value: 'appointment_request', label: 'Appt Requests' },
  ];

  const unreadCount = messages.filter((m) => m.status !== 'actioned' && m.status !== 'resolved').length;

  return (
    <div className="mc-page mc-reveal-stagger space-y-6 pb-8">
      {/* Header */}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <span className="pointer-events-none absolute inset-x-0 -top-2 h-px bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" aria-hidden="true" />
        <div>
          <p className="mc-section-label">Staff</p>
          <h1 className="mc-page-title flex items-center gap-2">
            <Inbox size={22} className="text-navy-600" strokeWidth={2} />
            Portal Inbox
            {unreadCount > 0 && (
              <span className="ml-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gold-500 px-1.5 text-xs font-bold text-white">
                {unreadCount}
              </span>
            )}
          </h1>
        </div>
        <TouchButton variant="secondary" size="sm" icon={<RefreshCw size={16} />} onClick={load}>
          Refresh
        </TouchButton>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value
                ? 'bg-navy-600 text-white shadow-mc'
                : 'bg-offWhite-100 text-slate-600 border border-slate-200 hover:bg-ivory-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Message list */}
      <Card>
        <CardHeader>
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-navy-50 text-navy-600 ring-1 ring-navy-100">
              <Inbox size={14} strokeWidth={2} />
            </span>
            {filter === 'all' ? 'All Messages' : FILTERS.find((f) => f.value === filter)?.label}
          </span>
        </CardHeader>
        <CardBody>
          {loading ? (
            <LoadingSpinner message="Loading inbox..." />
          ) : loadError ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm font-semibold text-danger-700">Unable to load inbox</p>
              <p className="text-xs text-slate-500">{loadError}</p>
              <button type="button" onClick={load}
                className="mt-2 rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-ivory-200">
                Retry
              </button>
            </div>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No messages in this category.</p>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => {
                const meta = TYPE_META[msg.message_type] || TYPE_META.general;
                const Icon = meta.icon;
                const isActioned = msg.status === 'actioned' || msg.status === 'resolved';
                return (
                  <div
                    key={msg.id}
                    className={`rounded-xl border p-4 transition-all ${
                      isActioned
                        ? 'border-slate-100 bg-offWhite-100 opacity-60'
                        : 'border-navy-100 bg-white shadow-mc hover:shadow-mc-lg'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-${meta.badge}-50 text-${meta.badge}-600 ring-1 ring-${meta.badge}-100 mt-0.5`}>
                          <Icon size={16} strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-navy-700 text-sm">
                              {msg.first_name} {msg.last_name}
                            </span>
                            <span className="text-xs text-slate-400">MRN {msg.mrn}</span>
                            <Badge variant={meta.badge} className="text-xs">{meta.label}</Badge>
                            {isActioned && <Badge variant="success" className="text-xs">Actioned</Badge>}
                          </div>
                          {msg.subject && (
                            <p className="mt-0.5 text-sm font-medium text-slate-700 truncate">{msg.subject}</p>
                          )}
                          <p className="mt-1 text-sm text-slate-600 line-clamp-2">{msg.content}</p>
                          <p className="mt-1 text-xs text-slate-400">{formatDate(msg.created_at)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <TouchButton
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/patient/${msg.patient_id}`)}
                        >
                          Chart
                        </TouchButton>
                        {!isActioned && (
                          <TouchButton
                            variant="secondary"
                            size="sm"
                            icon={<CheckCircle2 size={14} />}
                            disabled={actioningId === msg.id}
                            onClick={() => markActioned(msg)}
                          >
                            {actioningId === msg.id ? 'Saving…' : 'Action'}
                          </TouchButton>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
