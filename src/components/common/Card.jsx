import React from 'react';

export default function Card({ children, className = '', ...props }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '', action }) {
  const simpleTitle = typeof children === 'string' || typeof children === 'number';

  return (
    <div className={`px-5 py-4 border-b border-gray-100 flex items-center justify-between ${className}`}>
      {simpleTitle ? (
        <h3 className="font-semibold text-sm uppercase tracking-wide text-gray-500">{children}</h3>
      ) : (
        children
      )}
      {action}
    </div>
  );
}

export function CardBody({ children, className = '' }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}
