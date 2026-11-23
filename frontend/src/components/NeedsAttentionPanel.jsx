import React from 'react';

export default function NeedsAttentionPanel({
  alertsCount = 0,
  overdueCount = 0,
  unassignedCount = 0,
  nearingBreachCount = 0,
  onAssignClick,
  onOverdueClick,
  onReviewClick
}) {
  const totalActionItems = alertsCount || (overdueCount + unassignedCount + nearingBreachCount);

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
              <span className="attention-action-pill">ACTION REQUIRED</span>
              <span className="attention-count-sub">
                {totalActionItems === 0
                  ? 'All operational queues within acceptable thresholds'
                  : `${totalActionItems} item${totalActionItems === 1 ? '' : 's'} need action right now`}
              </span>
            </div>
            <p className="attention-subtitle">Priority escalations, unassigned triage, and SLA compliance monitoring</p>
          </div>
        </div>
      </div>

      {totalActionItems > 0 ? (
        <div className="attention-cards-grid">
          {/* Card 1: Overdue within SLA */}
          <div className="attention-subcard">
            <div className="subcard-header">
              <div className="subcard-icon warning" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="subcard-title-wrap">
                <span className="subcard-title">
                  {overdueCount > 0 ? `${overdueCount} Overdue Tasks` : 'Active SLA Timers'}
                </span>
                <span className="subcard-meta">
                  {overdueCount > 0 ? 'Resolution target passed' : 'All active tasks within SLA'}
                </span>
              </div>
            </div>
            <p className="subcard-desc">
              {overdueCount > 0
                ? 'High-priority complaints exceeding expected resolution milestones.'
                : 'Every active complaint still has time on the municipal clock.'}
            </p>
            <button
              type="button"
              className="subcard-action-btn warning"
              onClick={onOverdueClick}
            >
              Resolve Now
            </button>
          </div>

          {/* Card 2: Unassigned Tasks */}
          <div className="attention-subcard">
            <div className="subcard-header">
              <div className="subcard-icon danger" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
              </div>
              <div className="subcard-title-wrap">
                <span className="subcard-title">
                  {unassignedCount} Unassigned Issues
                </span>
                <span className="subcard-meta status-needs-owner">
                  {unassignedCount > 0 ? 'Needs an Owner' : 'Fully Assigned'}
                </span>
              </div>
            </div>
            <p className="subcard-desc">
              {unassignedCount > 0
                ? 'Assign an officer to start the departmental remediation clock.'
                : 'All complaints have been dispatched to verified departmental officers.'}
            </p>
            <button
              type="button"
              className="subcard-action-btn primary"
              onClick={onAssignClick}
            >
              Assign Now
            </button>
          </div>

          {/* Card 3: Nearing SLA Breach */}
          <div className="attention-subcard">
            <div className="subcard-header">
              <div className="subcard-icon alert" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className="subcard-title-wrap">
                <span className="subcard-title">
                  {nearingBreachCount > 0 ? `${nearingBreachCount} Nearing SLA Breach` : 'SLA Compliance Status'}
                </span>
                <span className="subcard-meta status-nearing">
                  {nearingBreachCount > 0 ? 'Tightest: <6h Remaining' : 'Normal Monitoring'}
                </span>
              </div>
            </div>
            <p className="subcard-desc">
              {nearingBreachCount > 0
                ? 'Tasks with less than 25% of SLA resolution window remaining.'
                : 'Active complaints are progressing well within configured SLA policies.'}
            </p>
            <button
              type="button"
              className="subcard-action-btn review"
              onClick={onReviewClick}
            >
              Review Now
            </button>
          </div>
        </div>
      ) : (
        <div className="attention-empty-state">
          <div className="attention-empty-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="attention-empty-text">
            <h3 className="attention-empty-title">All municipal queues operational</h3>
            <p className="attention-empty-desc">
              There are currently no overdue complaints, unassigned tasks, or SLA breaches recorded in the system. Priority escalations and operational warnings will appear here when action is required.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
