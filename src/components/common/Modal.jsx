import React, { useEffect, useRef } from 'react';

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // Save previously focused element
      previousFocusRef.current = document.activeElement;
      // Focus first focusable element in modal
      setTimeout(() => {
        if (modalRef.current) {
          const focusable = modalRef.current.querySelector(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable) focusable.focus();
        }
      }, 0);
    } else {
      document.body.style.overflow = '';
      // Restore focus on close
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw]',
  };

  const titleId = title ? 'modal-title-' + title.replace(/\s+/g, '-').toLowerCase() : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-900/45 backdrop-blur-[1px]" onClick={onClose} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative bg-offWhite-100 rounded-2xl shadow-mc-xl w-full ${sizes[size]} max-h-[90vh] flex flex-col`}
      >
        {title && (
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 id={titleId} className="font-display text-lg font-semibold text-navy-700">{title}</h2>
            <button onClick={onClose} aria-label="Close modal" className="p-2 hover:bg-ivory-200 rounded-lg text-slate-400 hover:text-slate-600">
              &#x2715;
            </button>
          </div>
        )}
        <div className="overflow-auto flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}
