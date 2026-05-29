import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

// On-brand lucide icons keyed by toast type (replaces the prior glyph chars).
const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: 'bg-success-50 border-success-200 text-success-700',
  error: 'bg-danger-50 border-danger-200 text-danger-700',
  warning: 'bg-gold-50 border-gold-200 text-gold-700',
  info: 'bg-navy-50 border-navy-100 text-navy-700',
};

const ICON_COLORS = {
  success: 'bg-success-100 text-success-600',
  error: 'bg-danger-100 text-danger-600',
  warning: 'bg-gold-100 text-gold-600',
  info: 'bg-navy-100 text-navy-600',
};

function ToastItem({ toast, onRemove }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onRemove(toast.id), 300);
    }, toast.duration || 3500);
    return () => clearTimeout(t);
  }, [toast, onRemove]);

  return (
    <div
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 4px 12px rgba(26,58,82,0.08), 0 16px 40px rgba(26,58,82,0.16)' }}
      className={`${exiting ? 'toast-exit' : 'toast-enter'} flex items-start gap-3 px-4 py-3 rounded-xl border ${COLORS[toast.type]} max-w-sm w-full`}
    >
      <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${ICON_COLORS[toast.type]}`}>
        {(() => {
          const Icon = ICONS[toast.type] || Info;
          return <Icon size={14} strokeWidth={2.5} aria-hidden="true" />;
        })()}
      </span>
      <div className="flex-1 min-w-0">
        {toast.title && <p className="font-semibold text-sm">{toast.title}</p>}
        <p className="text-sm opacity-90">{toast.message}</p>
      </div>
      <button onClick={() => { setExiting(true); setTimeout(() => onRemove(toast.id), 300); }}
        aria-label="Dismiss notification"
        className="flex-shrink-0 p-1 rounded-lg hover:bg-black/5 text-current opacity-50 hover:opacity-100 transition-opacity">
        <X size={14} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((type, message, options = {}) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message, ...options }]);
    return id;
  }, []);

  const toast = {
    success: (msg, opts) => addToast('success', msg, opts),
    error: (msg, opts) => addToast('error', msg, opts),
    warning: (msg, opts) => addToast('warning', msg, opts),
    info: (msg, opts) => addToast('info', msg, opts),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

export default ToastProvider;
