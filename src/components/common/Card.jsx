import React from 'react';

export default function Card({ children, className = '', ...props }) {
  return (
    <div className={`mc-card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '', action }) {
  const simpleTitle = typeof children === 'string' || typeof children === 'number';

  return (
    <div className={`px-5 py-4 border-b border-slate-100 flex items-center justify-between ${className}`}>
      {simpleTitle ? (
        <h3 className="font-semibold text-xs uppercase tracking-[0.12em] text-slate-500">{children}</h3>
      ) : (
        children
      )}
      {action}
    </div>
  );
}

export function CardBody({ children, className = '' }) {
  return <div className={`p-5 text-navy-600 ${className}`}>{children}</div>;
}
