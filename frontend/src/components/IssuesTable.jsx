import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { downloadComplaintsCsv } from '../services/api';

const STATUS_OPTIONS = ['All', 'Submitted', 'Under Review', 'In Progress', 'Resolved', 'Rejected'];
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
      case 'Resolved':
        return 'status-resolved';
      case 'Rejected':
        return 'status-rejected';
      default:
        return 'status-neutral';
    }
  };

  const getTitle = () => {
    if (isCitizen) return 'My Recent Complaints';
    if (isOfficer) return 'Assigned Field Queue';
    return 'Active Complaints & Triage';
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

        {/* Step 8/9: CSV Export Action & Step 1 View All Link */}
        <div className="issues-actions-right">
          {onViewAllComplaints && (
            <button
              type="button"
              className="view-all-link-btn"
              onClick={onViewAllComplaints}
              title="View all complaints on My Complaints page"
            >
              <span>View All Complaints &rarr;</span>
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
          <span className="table-loading-text">Loading recent complaints from database...</span>
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
          <div className="table-empty-status-tag">
            <span>Database Status: {complaints.length} records in collection</span>
          </div>
        </div>
      ) : (
        <div className="issues-list" role="list">
          {filteredComplaints.map((issue) => {
            const locationText = issue.location?.address || (typeof issue.location === 'string' ? issue.location : 'Location pending');
            const formattedDate = formatDate(issue.createdAt);
            return (
              <div
                key={issue.id || issue._id}
                className={`issue-row ${onSelectComplaint ? 'clickable-row' : ''}`}
                role="listitem"
                onClick={() => onSelectComplaint && onSelectComplaint(issue)}
                tabIndex={onSelectComplaint ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onSelectComplaint && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectComplaint(issue);
                  }
                }}
              >
                <div className="issue-main-info">
                  <div className="issue-title-line">
                    {issue.trackingId && (
                      <span className="tracking-badge-pill-sm">{issue.trackingId}</span>
                    )}
                    <span className="issue-title-text">{issue.title}</span>
                    {issue.category && (
                      <span className="issue-category-badge">{issue.category}</span>
                    )}
                  </div>
                  <div className="issue-coord-text">
                    {formattedDate && (
                      <span className="issue-date-tag">{formattedDate}</span>
                    )}
                    {formattedDate && locationText && <span className="meta-sep">&bull;</span>}
                    <span className="issue-location-tag">{locationText}</span>
                    {issue.assignedOfficer && (
                      <span className="issue-officer-attribution">
                        &bull; Officer: <strong>{issue.assignedOfficer.name}</strong>
                      </span>
                    )}
                    {issue.hasEvidence && (
                      <span className="evidence-chip-indicator" title="Geotagged photographic evidence attached">
                        &bull; Photo Verified
                      </span>
                    )}
                  </div>
                </div>
                <div className="issue-status-cell">
                  <span className={`status-pill ${getStatusClass(issue.status)}`}>{issue.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="issues-panel-footer">
        <span>Displaying {filteredComplaints.length} of {complaints.length} records</span>
        <span className="verified-database-tag">Verified Mongoose Collection</span>
      </div>
    </section>
  );
}
