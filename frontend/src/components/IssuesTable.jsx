import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { downloadComplaintsCsv } from '../services/api';

const STATUS_OPTIONS = ['All', 'Submitted', 'Under Review', 'In Progress', 'Provisionally Resolved', 'Disputed', 'Resolved', 'Rejected'];
const CATEGORY_OPTIONS = [
  'All',
  'Pothole/Road Damage',
  'Garbage/Waste',
  'Streetlight',
  'Drainage/Waterlogging',
  'Water Supply',
  'Other'
];

export default function IssuesTable({
  complaints = [],
  role = 'citizen',
  isLoading = false,
  onSelectComplaint,
  onActionClick,
  onViewAllComplaints,
  onNavigateReport
}) {
  const { token } = useAuth();
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState(null);

  const isCitizen = role === 'citizen';
  const isOfficer = role === 'officer';

  const formatDate = (dateString) => {
    if (!dateString) return null;
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(new Date(dateString));
    } catch (e) {
      return null;
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'Submitted':
        return 'status-submitted';
      case 'Under Review':
        return 'status-review';
      case 'In Progress':
        return 'status-progress';
      case 'Provisionally Resolved':
        return 'status-provisional';
      case 'Disputed':
        return 'status-disputed';
      case 'Resolved':
        return 'status-resolved';
      case 'Rejected':
        return 'status-rejected';
      default:
        return 'status-neutral';
    }
  };

  const getCategoryIcon = (category) => {
    const cat = (category || '').toLowerCase();
    if (cat.includes('pothole') || cat.includes('road')) {
      return (
        <div className="cat-icon-circle cat-road" title="Road / Infrastructure Damage" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 12h.01M12 12h.01M18 12h.01" />
          </svg>
        </div>
      );
    }
    if (cat.includes('light') || cat.includes('street')) {
      return (
        <div className="cat-icon-circle cat-light" title="Streetlight Issue" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </div>
      );
    }
    if (cat.includes('garbage') || cat.includes('waste')) {
      return (
        <div className="cat-icon-circle cat-waste" title="Garbage / Sanitation" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </div>
      );
    }
    if (cat.includes('drainage') || cat.includes('water')) {
      return (
        <div className="cat-icon-circle cat-water" title="Water / Drainage" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
          </svg>
        </div>
      );
    }
    return (
      <div className="cat-icon-circle cat-other" title={category || 'Civic Issue'} aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
    );
  };

  const getPriorityBadge = (priority) => {
    const p = (priority || 'Medium').toLowerCase();
    if (p === 'urgent' || p === 'high') {
      return (
        <span className="priority-pill high" title="High Priority">
          <span className="priority-dot" /> High
        </span>
      );
    }
    if (p === 'low') {
      return (
        <span className="priority-pill low" title="Low Priority">
          <span className="priority-dot" /> Low
        </span>
      );
    }
    return (
      <span className="priority-pill medium" title="Medium Priority">
        <span className="priority-dot" /> Medium
      </span>
    );
  };

  const getSlaPill = (issue) => {
    if (issue.sla?.isBreached) {
      return <span className="sla-pill breached" title="SLA Breached">⚠️ Breached</span>;
    }
    if (issue.sla?.remainingHours !== undefined && issue.sla.remainingHours !== null) {
      const rem = issue.sla.remainingHours;
      if (rem <= 0) {
        return <span className="sla-pill breached" title="Past SLA target">⏱️ Overdue</span>;
      }
      if (rem <= 24) {
        return <span className="sla-pill tight" title={`${Math.round(rem)} hours remaining`}>⏱️ {Math.round(rem)}h left</span>;
      }
      const days = (rem / 24).toFixed(1);
      return <span className="sla-pill ok" title={`${days} days remaining`}>⏱️ {days}d left</span>;
    }
    return <span className="sla-pill ok" title="Within SLA timeframe">⏱️ Within SLA</span>;
  };

  const getTitle = () => {
    if (isCitizen) return 'Recent Complaints';
    if (isOfficer) return 'Assigned Field Queue';
    return 'High-Priority Issues';
  };

  // Filter complaints locally
  const filteredComplaints = (complaints || []).filter((issue) => {
    const matchesStatus = statusFilter === 'All' || issue.status === statusFilter;
    const matchesCategory = categoryFilter === 'All' || issue.category === categoryFilter;
    return matchesStatus && matchesCategory;
  });

  const handleExportCsv = async () => {
    if (!token) return;
    setIsExporting(true);
    setExportNotice(null);

    const filters = {};
    if (statusFilter !== 'All') filters.status = statusFilter;
    if (categoryFilter !== 'All') filters.category = categoryFilter;

    try {
      const res = await downloadComplaintsCsv(token, filters);
      if (res.ok) {
        setExportNotice({ type: 'success', message: `Exported: ${res.filename}` });
        setTimeout(() => setExportNotice(null), 4000);
      } else {
        setExportNotice({ type: 'error', message: res.errorMessage || 'Export failed. Please try again.' });
      }
    } catch (err) {
      console.error('CSV Export Error:', err);
      setExportNotice({ type: 'error', message: 'Export failed. Please try again.' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <section className="issues-panel" aria-label="Civic Issues Queue">
      <div className="issues-panel-header">
        <div className="issues-title-left">
          <h2 className="issues-title">{getTitle()}</h2>
          <span className="live-records-count-chip">
            {filteredComplaints.length} Records
          </span>
        </div>

        <div className="issues-actions-right">
          {onViewAllComplaints && (
            <button
              type="button"
              className="view-all-link-btn"
              onClick={onViewAllComplaints}
              title="View all complaints on My Complaints page"
            >
              <span>View All &rarr;</span>
            </button>
          )}
          <button
            type="button"
            className="export-csv-btn"
            onClick={handleExportCsv}
            disabled={isExporting}
            title="Export filtered complaints as secure CSV"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{isExporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {exportNotice && (
        <div
          className={exportNotice.type === 'error' ? 'auth-alert-error' : 'auth-alert-success'}
          style={{ margin: '8px 16px 0 16px', padding: '8px 12px', fontSize: '0.8rem' }}
          role="alert"
        >
          <span>{exportNotice.message}</span>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="issues-filter-bar">
        <div className="filter-chip-group">
          <label htmlFor="issue-status-filter" className="filter-label-inline">Status:</label>
          <select
            id="issue-status-filter"
            className="filter-select-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>

        <div className="filter-chip-group">
          <label htmlFor="issue-category-filter" className="filter-label-inline">Category:</label>
          <select
            id="issue-category-filter"
            className="filter-select-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            {CATEGORY_OPTIONS.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {(statusFilter !== 'All' || categoryFilter !== 'All') && (
          <button
            type="button"
            className="clear-filter-btn"
            onClick={() => {
              setStatusFilter('All');
              setCategoryFilter('All');
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="table-loading-container" aria-live="polite">
          <div className="table-loading-spinner" aria-hidden="true" />
          <span className="table-loading-text">Loading complaints from database...</span>
        </div>
      ) : filteredComplaints.length === 0 ? (
        <div className="table-empty-container">
          <div className="table-empty-icon" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {isOfficer ? (
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              ) : (
                <>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </>
              )}
            </svg>
          </div>
          <h3 className="table-empty-title">
            {complaints.length > 0
              ? 'No complaints match the selected filter criteria.'
              : isCitizen
              ? 'You have not submitted any complaints yet.'
              : isOfficer
              ? 'No complaints currently assigned to you.'
              : 'No complaints in the database.'}
          </h3>
          <p className="table-empty-desc">
            {complaints.length > 0
              ? 'Try adjusting your status or category filter to view other complaints in the roster.'
              : isCitizen
              ? 'When you report a local issue (such as road damage, water blockages, or broken lighting), your submissions and resolution status will appear here.'
              : isOfficer
              ? 'Complaints assigned to your officer account by administrators will appear here for field verification, status advancement, and resolution.'
              : 'The municipal complaints database contains zero active records matching this triage queue.'}
          </p>
          {isCitizen && complaints.length === 0 && onNavigateReport && (
            <button
              type="button"
              className="empty-report-action-btn"
              onClick={onNavigateReport}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Report an Issue</span>
            </button>
          )}
        </div>
      ) : (
        <div className="issues-list" role="list">
          {filteredComplaints.map((issue) => {
            const hasCoords =
              issue.location?.latitude !== undefined &&
              issue.location?.latitude !== null &&
              issue.location?.longitude !== undefined &&
              issue.location?.longitude !== null;
            const coordsText = hasCoords
              ? `${Number(issue.location.latitude).toFixed(4)}, ${Number(issue.location.longitude).toFixed(4)}`
              : null;
            const addressText =
              issue.location?.address ||
              (typeof issue.location === 'string' ? issue.location : null);
            const locationDisplay = coordsText || addressText || 'Location logged';

            return (
              <div
                key={issue.id || issue._id}
                className="issue-row clickable-row"
                role="listitem"
                onClick={() => onSelectComplaint && onSelectComplaint(issue)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (onSelectComplaint && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectComplaint(issue);
                  }
                }}
              >
                {/* 1. Category Icon Box */}
                {getCategoryIcon(issue.category)}

                {/* 2. Main Issue Info */}
                <div className="issue-main-info">
                  <div className="issue-title-row">
                    <span className="issue-title-text">{issue.title}</span>
                  </div>
                  <div className="issue-coord-text">
                    <span className="issue-location-tag">{locationDisplay}</span>
                    {issue.trackingId && (
                      <span className="issue-tracking-inline">&bull; {issue.trackingId}</span>
                    )}
                  </div>
                </div>

                {/* 3. Priority Pill */}
                <div className="issue-priority-cell">
                  {getPriorityBadge(issue.priority)}
                </div>

                {/* 4. SLA Indicator Pill */}
                <div className="issue-sla-cell">
                  {getSlaPill(issue)}
                </div>

                {/* 5. Status Badge */}
                <div className="issue-status-cell">
                  <span className={`status-pill ${getStatusClass(issue.status)}`}>
                    {issue.status}
                  </span>
                </div>

                {/* 6. Action Button */}
                <div className="issue-action-cell">
                  <button
                    type="button"
                    className="issue-row-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onActionClick) {
                        onActionClick(issue);
                      } else if (onSelectComplaint) {
                        onSelectComplaint(issue);
                      }
                    }}
                    title="Inspect complaint details"
                  >
                    <span>{role === 'admin' && issue.status === 'Submitted' ? 'Assign' : 'View'}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="issues-panel-footer">
        <span>Showing 1-{filteredComplaints.length} of {complaints.length} complaints</span>
        <span className="verified-database-tag">&bull; Live MongoDB Records</span>
      </div>
    </section>
  );
}
