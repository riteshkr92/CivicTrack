import React from 'react';

export default function Toast({ message, visible, onClose }) {
  if (!visible || !message) return null;

  return (
    <div className="toast-notification" role="status" aria-live="polite">
      <div className="toast-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </div>
      <div className="toast-body">
        <span className="toast-title">Demo Preview Notice</span>
        <span className="toast-desc">{message}</span>
      </div>
      <button
        type="button"
        className="toast-close-btn"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  );
}
