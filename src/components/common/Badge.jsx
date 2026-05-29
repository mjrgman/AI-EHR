import React from 'react';

const VARIANTS = {
  urgent: 'bg-red-100 text-red-800',
  danger: 'bg-red-100 text-red-800',
  routine: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  info: 'bg-gray-100 text-gray-700',
  purple: 'bg-purple-100 text-purple-800',
};

export default function Badge({ children, variant = 'info', className = '', dot }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${VARIANTS[variant]} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full bg-current`} />}
      {children}
    </span>
  );
}
