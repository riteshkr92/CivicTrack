import React from 'react';

export default function NeedsAttentionPanel({ alertsCount = 0 }) {
  return (
    <section className="needs-attention-banner" aria-label="Operational Attention Status">
      <div className="attention-header">
        <div className="attention-header-left">
          <div className="attention-icon-badge" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
          <div className="attention-title-group">
            <div className="attention-title-row">
              <h2 className="attention-title">Needs Attention</h2>
              <span className="attention-count-pill">
                {alertsCount === 0 ? '0 Active Alerts' : `${alertsCount} Active Alerts`}
              </span>
            </div>
            <p className="attention-subtitle">Priority escalations and SLA deadline monitoring</p>
          </div>
        </div>
      </div>

      <div className="attention-empty-state">
        <div className="attention-empty-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <div className="attention-empty-text">
          <h3 className="attention-empty-title">No outstanding alerts to display</h3>
          <p className="attention-empty-desc">
            There are currently no overdue reports, unassigned high-priority tasks, or SLA breaches recorded in the system. Critical operational warnings will appear here once civic complaints are submitted and monitored.
          </p>
        </div>
      </div>
    </section>
  );
}
