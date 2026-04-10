import React, { useState, useEffect, useCallback } from 'react';
import PatientVoice from '../components/PatientVoice';

// ==========================================
// CONSTANTS
// ==========================================

const API_BASE = '/api/patient-portal';
const PATIENT_ID = 1; // Default patient ID — accept as prop override

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
  { key: 'appointments', label: 'Appointments', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { key: 'medications', label: 'Medications', icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' },
  { key: 'labs', label: 'Lab Results', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { key: 'messages', label: 'Messages', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { key: 'voice', label: 'Voice', icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
];

const STATUS_COLORS = {
  'scheduled': 'bg-blue-100 text-blue-800',
  'confirmed': 'bg-blue-100 text-blue-800',
  'checked-in': 'bg-green-100 text-green-800',
  'completed': 'bg-gray-100 text-gray-700',
  'cancelled': 'bg-red-100 text-red-700',
  'draft': 'bg-yellow-100 text-yellow-800',
  'physician_review': 'bg-amber-100 text-amber-800',
  'approved': 'bg-blue-100 text-blue-800',
  'sent': 'bg-green-100 text-green-800',
  'read': 'bg-gray-100 text-gray-600',
};

// ==========================================
// HELPERS
// ==========================================

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
}

function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status] || 'bg-gray-100 text-gray-700';
  const label = (status || 'unknown').replace(/[-_]/g, ' ');
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium capitalize ${colors}`}>
      {label}
    </span>
  );
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function PatientPortal({ patientId: propPatientId }) {
  const patientId = propPatientId || PATIENT_ID;

  const [activeTab, setActiveTab] = useState('dashboard');
  const [patientName, setPatientName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Data state
  const [appointments, setAppointments] = useState([]);
  const [medications, setMedications] = useState([]);
  const [labs, setLabs] = useState([]);
  const [messages, setMessages] = useState([]);

  // Form state
  const [msgSubject, setMsgSubject] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [msgSending, setMsgSending] = useState(false);
  const [refillLoading, setRefillLoading] = useState(null);
  const [checkinLoading, setCheckinLoading] = useState(null);

  // ==========================================
  // DATA FETCHING
  // ==========================================

  const fetchData = useCallback(async (tab) => {
    setLoading(true);
    setError(null);
    try {
      switch (tab) {
        case 'dashboard': {
          const [apptRes, medRes, labRes] = await Promise.all([
            fetch(`${API_BASE}/appointments/${patientId}`),
            fetch(`${API_BASE}/medications/${patientId}`),
            fetch(`${API_BASE}/labs/${patientId}`),
          ]);
          const apptData = await apptRes.json();
          const medData = await medRes.json();
          const labData = await labRes.json();
          setAppointments(apptData.appointments || []);
          setMedications(medData.medications || []);
          setLabs(labData.labs || []);
          break;
        }
        case 'appointments': {
          const res = await fetch(`${API_BASE}/appointments/${patientId}`);
          const data = await res.json();
          setAppointments(data.appointments || []);
          break;
        }
        case 'medications': {
          const res = await fetch(`${API_BASE}/medications/${patientId}`);
          const data = await res.json();
          setMedications(data.medications || []);
          break;
        }
        case 'labs': {
          const res = await fetch(`${API_BASE}/labs/${patientId}`);
          const data = await res.json();
          setLabs(data.labs || []);
          break;
        }
        case 'messages': {
          const res = await fetch(`${API_BASE}/messages/${patientId}`);
          const data = await res.json();
          setMessages(data.messages || []);
          break;
        }
        default:
          break;
      }
    } catch (err) {
      setError('Unable to load data. Please try again.');
      console.error('[PatientPortal] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  // Fetch patient name on mount
  useEffect(() => {
    fetch(`/api/patients/${patientId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.first_name) {
          setPatientName(`${data.first_name} ${data.last_name}`);
        }
      })
      .catch(() => setPatientName('Patient'));
  }, [patientId]);

  // ==========================================
  // ACTIONS
  // ==========================================

  const handleCheckIn = async (appointmentId) => {
    setCheckinLoading(appointmentId);
    try {
      const res = await fetch(`${API_BASE}/appointments/${patientId}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointment_id: appointmentId }),
      });
      const data = await res.json();
      if (res.ok) {
        setAppointments(prev =>
          prev.map(a => a.id === appointmentId ? { ...a, status: 'checked-in' } : a)
        );
      } else {
        setError(data.error || 'Check-in failed');
      }
    } catch {
      setError('Check-in failed. Please try again.');
    } finally {
      setCheckinLoading(null);
    }
  };

  const handleRefill = async (med) => {
    setRefillLoading(med.id);
    try {
      const res = await fetch(`${API_BASE}/refill-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          medication_id: med.id,
          medication_name: med.medication_name,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMedications(prev =>
          prev.map(m => m.id === med.id
            ? { ...m, refill_status: 'physician_review', last_refill_request: new Date().toISOString() }
            : m
          )
        );
      } else {
        setError(data.error || 'Refill request failed');
      }
    } catch {
      setError('Refill request failed. Please try again.');
    } finally {
      setRefillLoading(null);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!msgBody.trim()) return;
    setMsgSending(true);
    try {
      const res = await fetch(`${API_BASE}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          subject: msgSubject || 'General Question',
          message: msgBody,
        }),
      });
      if (res.ok) {
        setMsgSubject('');
        setMsgBody('');
        // Refresh messages
        fetchData('messages');
      } else {
        const data = await res.json();
        setError(data.error || 'Message failed to send');
      }
    } catch {
      setError('Message failed to send. Please try again.');
    } finally {
      setMsgSending(false);
    }
  };

  // ==========================================
  // TAB CONTENT RENDERERS
  // ==========================================

  const renderDashboard = () => {
    const nextAppt = appointments[0];
    const abnormalLabs = labs.filter(l => l.flag_level === 'abnormal');
    const recentLabs = labs.slice(0, 3);

    return (
      <div className="space-y-6">
        {/* Quick Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Next Appointment Card */}
          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Next Appointment</h3>
            </div>
            {nextAppt ? (
              <div>
                <p className="text-lg text-gray-900 font-medium">{formatDate(nextAppt.appointment_date)}</p>
                <p className="text-lg text-gray-600">{formatTime(nextAppt.appointment_time)} with {nextAppt.provider_name}</p>
                <p className="text-base text-gray-500 capitalize mt-1">{(nextAppt.appointment_type || '').replace(/_/g, ' ')}</p>
                {isToday(nextAppt.appointment_date) && nextAppt.status === 'scheduled' && (
                  <button
                    onClick={() => handleCheckIn(nextAppt.id)}
                    disabled={checkinLoading === nextAppt.id}
                    className="mt-3 w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg text-lg transition-colors disabled:opacity-50"
                  >
                    {checkinLoading === nextAppt.id ? 'Checking in...' : 'Check In Now'}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-lg text-gray-500">No upcoming appointments</p>
            )}
          </div>

          {/* Lab Results Summary */}
          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Lab Results</h3>
            </div>
            <p className="text-3xl font-bold text-gray-900">{labs.length}</p>
            <p className="text-lg text-gray-500">total results</p>
            {abnormalLabs.length > 0 && (
              <p className="text-lg text-red-600 font-medium mt-2">
                {abnormalLabs.length} abnormal — review needed
              </p>
            )}
          </div>

          {/* Medications Summary */}
          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Medications</h3>
            </div>
            <p className="text-3xl font-bold text-gray-900">{medications.length}</p>
            <p className="text-lg text-gray-500">active medications</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button onClick={() => setActiveTab('appointments')} className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium py-4 px-4 rounded-lg text-lg transition-colors border border-blue-200">
              View Appointments
            </button>
            <button onClick={() => setActiveTab('medications')} className="bg-teal-50 hover:bg-teal-100 text-teal-700 font-medium py-4 px-4 rounded-lg text-lg transition-colors border border-teal-200">
              My Medications
            </button>
            <button onClick={() => setActiveTab('labs')} className="bg-purple-50 hover:bg-purple-100 text-purple-700 font-medium py-4 px-4 rounded-lg text-lg transition-colors border border-purple-200">
              Lab Results
            </button>
            <button onClick={() => setActiveTab('messages')} className="bg-amber-50 hover:bg-amber-100 text-amber-700 font-medium py-4 px-4 rounded-lg text-lg transition-colors border border-amber-200">
              Send Message
            </button>
          </div>
        </div>

        {/* Recent Lab Results */}
        {recentLabs.length > 0 && (
          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Recent Lab Results</h3>
              <button onClick={() => setActiveTab('labs')} className="text-blue-600 hover:text-blue-800 text-lg font-medium">
                View All
              </button>
            </div>
            <div className="space-y-3">
              {recentLabs.map(lab => (
                <LabResultRow key={lab.id} lab={lab} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAppointments = () => (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">Upcoming Appointments</h2>
      {appointments.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md border border-blue-100 p-8 text-center">
          <p className="text-lg text-gray-500">No upcoming appointments.</p>
          <p className="text-base text-gray-400 mt-2">Call our office to schedule your next visit.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {appointments.map((appt, idx) => (
            <div key={appt.id} className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                {/* Timeline dot */}
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-4 h-4 rounded-full ${idx === 0 ? 'bg-blue-600' : 'bg-gray-300'}`} />
                    {idx < appointments.length - 1 && <div className="w-0.5 h-12 bg-gray-200 mt-1" />}
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-gray-900">{formatDate(appt.appointment_date)}</p>
                    <p className="text-lg text-gray-700">{formatTime(appt.appointment_time)}</p>
                    <p className="text-lg text-gray-600 mt-1">
                      With <span className="font-medium">{appt.provider_name}</span>
                    </p>
                    <p className="text-base text-gray-500 capitalize">{(appt.appointment_type || '').replace(/_/g, ' ')}</p>
                    {appt.chief_complaint && (
                      <p className="text-base text-gray-400 mt-1">Reason: {appt.chief_complaint}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={appt.status} />
                  {isToday(appt.appointment_date) && (appt.status === 'scheduled' || appt.status === 'confirmed') && (
                    <button
                      onClick={() => handleCheckIn(appt.id)}
                      disabled={checkinLoading === appt.id}
                      className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-6 rounded-lg text-lg transition-colors disabled:opacity-50"
                    >
                      {checkinLoading === appt.id ? 'Checking in...' : 'Check In'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderMedications = () => (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">Active Medications</h2>
      {medications.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md border border-blue-100 p-8 text-center">
          <p className="text-lg text-gray-500">No active medications on file.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {medications.map(med => (
            <div key={med.id} className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex-1">
                  <p className="text-xl font-semibold text-gray-900">{med.medication_name}</p>
                  {med.generic_name && (
                    <p className="text-base text-gray-500">({med.generic_name})</p>
                  )}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
                    {med.dose && <p className="text-lg text-gray-700">Dose: <span className="font-medium">{med.dose}</span></p>}
                    {med.frequency && <p className="text-lg text-gray-700">Frequency: <span className="font-medium">{med.frequency}</span></p>}
                    {med.route && <p className="text-lg text-gray-700">Route: <span className="font-medium">{med.route}</span></p>}
                  </div>
                  {med.prescriber && (
                    <p className="text-base text-gray-500 mt-1">Prescribed by: {med.prescriber}</p>
                  )}
                  {med.last_refill_request && (
                    <p className="text-base text-gray-500 mt-1">
                      Last refill request: {formatDate(med.last_refill_request.split('T')[0])}
                      {med.refill_status && <> &mdash; <StatusBadge status={med.refill_status} /></>}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleRefill(med)}
                  disabled={refillLoading === med.id || med.refill_status === 'physician_review'}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg text-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {refillLoading === med.id
                    ? 'Requesting...'
                    : med.refill_status === 'physician_review'
                      ? 'Refill Pending'
                      : 'Request Refill'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderLabs = () => (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">Lab Results</h2>
      {labs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md border border-blue-100 p-8 text-center">
          <p className="text-lg text-gray-500">No lab results on file.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {labs.map(lab => (
            <LabResultCard key={lab.id} lab={lab} />
          ))}
        </div>
      )}
    </div>
  );

  const renderMessages = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Messages</h2>

      {/* Compose form */}
      <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">Send a Message to Your Care Team</h3>
        <form onSubmit={handleSendMessage} className="space-y-4">
          <div>
            <label htmlFor="msg-subject" className="block text-lg font-medium text-gray-700 mb-1">Subject</label>
            <input
              id="msg-subject"
              type="text"
              value={msgSubject}
              onChange={e => setMsgSubject(e.target.value)}
              placeholder="What is this about?"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="msg-body" className="block text-lg font-medium text-gray-700 mb-1">Message</label>
            <textarea
              id="msg-body"
              rows={5}
              value={msgBody}
              onChange={e => setMsgBody(e.target.value)}
              placeholder="Type your message here..."
              required
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            />
          </div>
          <button
            type="submit"
            disabled={msgSending || !msgBody.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg text-lg transition-colors disabled:opacity-50"
          >
            {msgSending ? 'Sending...' : 'Send Message'}
          </button>
        </form>
      </div>

      {/* Sent messages */}
      <div>
        <h3 className="text-xl font-semibold text-gray-800 mb-3">Your Messages</h3>
        {messages.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6 text-center">
            <p className="text-lg text-gray-500">No messages yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className="bg-white rounded-xl shadow-md border border-blue-100 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-lg font-semibold text-gray-900">{msg.subject || 'No Subject'}</p>
                    <p className="text-base text-gray-600 mt-1 line-clamp-2">{msg.content}</p>
                    <p className="text-sm text-gray-400 mt-2">
                      {msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}
                    </p>
                  </div>
                  <StatusBadge status={msg.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderVoice = () => (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">Voice Assistant</h2>
      <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
        <p className="text-lg text-gray-600 mb-4">
          Talk to your healthcare assistant. Ask about appointments, medications, lab results, or anything else.
        </p>
        <PatientVoice patientId={patientId} />
      </div>
    </div>
  );

  const tabContent = {
    dashboard: renderDashboard,
    appointments: renderAppointments,
    medications: renderMedications,
    labs: renderLabs,
    messages: renderMessages,
    voice: renderVoice,
  };

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-blue-100">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Patient Portal</h1>
              {patientName && <p className="text-lg text-gray-500">Welcome, {patientName}</p>}
            </div>
          </div>
          <button className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-5 rounded-lg text-lg transition-colors">
            End Session
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto py-2 -mb-px">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3 rounded-lg text-lg font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.key
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Error Banner */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <p className="text-lg text-red-700">{error}</p>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold text-xl">&times;</button>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-lg text-gray-500">Loading...</p>
            </div>
          </div>
        ) : (
          tabContent[activeTab]?.()
        )}
      </main>
    </div>
  );
}

// ==========================================
// SUB-COMPONENTS
// ==========================================

function LabResultRow({ lab }) {
  const flagColors = {
    normal: 'text-green-700 bg-green-50 border-green-200',
    borderline: 'text-yellow-700 bg-yellow-50 border-yellow-200',
    abnormal: 'text-red-700 bg-red-50 border-red-200',
  };
  const dotColors = {
    normal: 'bg-green-500',
    borderline: 'bg-yellow-500',
    abnormal: 'bg-red-500',
  };

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${flagColors[lab.flag_level] || flagColors.normal}`}>
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${dotColors[lab.flag_level] || dotColors.normal}`} />
        <span className="text-lg font-medium">{lab.plain_name || lab.test_name}</span>
      </div>
      <div className="text-right">
        <span className="text-lg font-semibold">{lab.result_value} {lab.units || ''}</span>
        {lab.reference_range && <span className="text-base text-gray-500 ml-2">({lab.reference_range})</span>}
      </div>
    </div>
  );
}

function LabResultCard({ lab }) {
  const flagColors = {
    normal: 'border-green-200',
    borderline: 'border-yellow-300',
    abnormal: 'border-red-300',
  };
  const flagBg = {
    normal: 'bg-green-50',
    borderline: 'bg-yellow-50',
    abnormal: 'bg-red-50',
  };
  const flagLabel = {
    normal: { text: 'Normal', color: 'bg-green-100 text-green-800' },
    borderline: { text: 'Borderline', color: 'bg-yellow-100 text-yellow-800' },
    abnormal: { text: 'Abnormal', color: 'bg-red-100 text-red-800' },
  };
  const info = flagLabel[lab.flag_level] || flagLabel.normal;

  return (
    <div className={`bg-white rounded-xl shadow-md border-2 ${flagColors[lab.flag_level] || flagColors.normal} p-6`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-xl font-semibold text-gray-900">{lab.plain_name || lab.test_name}</p>
          {lab.result_date && <p className="text-base text-gray-500">{formatDate(lab.result_date)}</p>}
        </div>
        <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${info.color}`}>
          {info.text}
        </span>
      </div>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl font-bold text-gray-900">{lab.result_value}</span>
        <span className="text-lg text-gray-500">{lab.units || ''}</span>
        {lab.reference_range && (
          <span className="text-base text-gray-400">Reference: {lab.reference_range}</span>
        )}
      </div>
      {lab.explanation && (
        <div className={`${flagBg[lab.flag_level] || flagBg.normal} rounded-lg p-4`}>
          <p className="text-lg text-gray-700">{lab.explanation}</p>
        </div>
      )}
    </div>
  );
}
