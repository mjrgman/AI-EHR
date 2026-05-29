import React from 'react';

export default function LoadingSpinner({ message = 'Loading...', size = 'md' }) {
  const sizes = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-12 h-12' };
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className={`${sizes[size]} border-navy-100 border-t-navy-600 rounded-full animate-spin`}
           style={{ borderWidth: '3px' }} />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
