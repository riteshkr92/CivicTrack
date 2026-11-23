import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchAssignedComplaints, downloadComplaintsCsv } from '../services/api';
import StatusUpdateModal from './StatusUpdateModal';
import WorkCompletionModal from './WorkCompletionModal';

const CATEGORIES = [
  'All Categories',
  'Pothole/Road Damage',
  'Garbage/Waste',
  'Streetlight',
  'Drainage/Waterlogging',
  'Water Supply',
  'Other'
];

const STATUSES = [
  'All Statuses',
  'Submitted',
  'Under Review',
  'In Progress',
  'Provisionally Resolved',
  'Disputed',
  'Resolved',
  'Rejected'
];

export default function OfficerComplaintsList({ onSelectComplaint, onStatusUpdated, defaultStatus = '' }) {
  const { token, handleUnauthorized } = useAuth();

  const [complaints, setComplaints] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState(null);

  // Filters & Search
  const [selectedStatus, setSelectedStatus] = useState(defaultStatus || 'All Statuses');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  // Status Update & Work Completion Modals
  const [statusModalComplaint, setStatusModalComplaint] = useState(null);
  const [completionModalComplaint, setCompletionModalComplaint] = useState(null);

  const handleExportCsv = async () => {
    if (!token) return;
    setIsExporting(true);
    setExportNotice(null);

    const filters = {};
    if (selectedStatus && selectedStatus !== 'All Statuses') filters.status = selectedStatus;
    if (selectedCategory && selectedCategory !== 'All Categories') filters.category = selectedCategory;

    try {
      const res = await downloadComplaintsCsv(token, filters);
      if (res.ok) {
        setExportNotice({ type: 'success', message: `Exported: ${res.filename}` });
        setTimeout(() => setExportNotice(null), 4000);
      } else {
        if (res.status === 401 && handleUnauthorized) {
          handleUnauthorized();
          return;
        }
        setExportNotice({ type: 'error', message: res.errorMessage || 'CSV export failed' });
      }
    } catch (err) {
      setExportNotice({ type: 'error', message: err.message || 'Export failed' });
    } finally {
      setIsExporting(false);
    }
  };

  const loadAssignedComplaints = useCallback(async (targetPage = 1, currentFilters = {}) => {
    setIsLoading(true);
    setErrorMessage(null);

    const st = currentFilters.status !== undefined ? currentFilters.status : selectedStatus;
    const cat = currentFilters.category !== undefined ? currentFilters.category : selectedCategory;
    const q = currentFilters.search !== undefined ? currentFilters.search : activeSearch;

    const res = await fetchAssignedComplaints(token, {
      page: targetPage,
      limit: 10,
      status: st === 'All Statuses' ? '' : st,
      category: cat === 'All Categories' ? '' : cat,
      search: q.trim()
    });

    setIsLoading(false);

    if (res.ok) {
      setComplaints(res.complaints);
      setPagination(res.pagination);
    } else {
      if (res.status === 401 && handleUnauthorized) {
        handleUnauthorized();
        return;
      }
      setErrorMessage(res.errorMessage);
    }
  }, [token, selectedStatus, selectedCategory, activeSearch, handleUnauthorized]);

  useEffect(() => {
    loadAssignedComplaints(1);
  }, [loadAssignedComplaints]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setActiveSearch(searchQuery);
    loadAssignedComplaints(1, { search: searchQuery });
  };

  const handleResetFilters = () => {
    setSelectedStatus('All Statuses');
    setSelectedCategory('All Categories');
    setSearchQuery('');
    setActiveSearch('');
    loadAssignedComplaints(1, { status: 'All Statuses', category: 'All Categories', search: '' });
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium'
      }).format(new Date(dateString));
    } catch (e) {
      return dateString;
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

  const getPriorityClass = (priority) => {
    switch (priority) {
      case 'Urgent':
        return 'priority-urgent';
      case 'High':
        return 'priority-high';
      case 'Medium':
        return 'priority-medium';
      case 'Low':
        return 'priority-low';
      default:
        return 'priority-medium';
    }
  };

  const renderSlaBadge = (c) => {
    if (c.status === 'Resolved') {
      return (
        <span className="sla-badge sla-badge-completed">
          {c.sla?.isResolvedWithinSla ? '✓ Within SLA' : 'Resolved Overdue'}
        </span>
      );
    }
    if (c.status === 'Rejected') {
      return <span className="sla-badge sla-badge-completed">Closed</span>;
    }
    if (c.reworkCount > 0 && c.sla?.reworkDeadline) {
      if (c.sla?.isBreached || (c.sla?.breachedStages || []).includes('rework')) {
        return <span className="sla-badge sla-badge-breached">⚠️ Rework Overdue</span>;
      }
      return <span className="sla-badge sla-badge-rework">🔄 Rework Active</span>;
    }
    const level = c.sla?.escalationLevel || 0;
    if (level === 3) {
      return <span className="sla-badge sla-badge-escalated">⚠️ L3 Critical</span>;
    }
    if (level === 2 || c.sla?.isBreached) {
      return <span className="sla-badge sla-badge-breached">⚠️ Overdue</span>;
    }
    if (level === 1) {
      return <span className="sla-badge sla-badge-approaching">⏳ Deadline Near</span>;
    }
    return <span className="sla-badge sla-badge-normal">● On Track</span>;
  };

  const handleComplaintUpdated = (updated) => {
    // Update complaint locally in state
    setComplaints((prev) =>
      prev.map((c) => ((c.id || c._id) === (updated.id || updated._id) ? updated : c))
    );
    if (onStatusUpdated) onStatusUpdated(updated);
  };

  return (
    <div className="officer-complaints-container">
      {/* View Header */}
      <div className="view-header-bar">
        <div>
          <h2 className="view-heading">Assigned Complaints Queue</h2>
          <p className="view-subheading">
            Field work orders and civic issues assigned directly to your account. Update milestone progress and record resolution notes.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="export-csv-btn"
            onClick={handleExportCsv}
            disabled={isExporting}
            title="Download CSV export of your assigned complaints"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{isExporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
          <div className="officer-queue-badge">
            <span>{pagination.total} Task{pagination.total === 1 ? '' : 's'} Assigned</span>
          </div>
        </div>
      </div>

      {exportNotice && (
        <div
          className={exportNotice.type === 'error' ? 'auth-alert-error' : 'auth-alert-success'}
          style={{ marginBottom: '16px', padding: '10px 14px', fontSize: '0.85rem' }}
          role="alert"
        >
          <span>{exportNotice.message}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="filter-search-card">
        <form onSubmit={handleSearchSubmit} className="filter-search-form">
          <div className="filter-inputs-row">
            {/* Search Input */}
            <div className="filter-input-wrap search-input-wrap">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="filter-text-input"
                placeholder="Search tracking ID or title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Status Dropdown */}
            <div className="filter-input-wrap">
              <select
                className="filter-select-input"
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  loadAssignedComplaints(1, { status: e.target.value });
                }}
              >
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Dropdown */}
            <div className="filter-input-wrap">
              <select
                className="filter-select-input"
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  loadAssignedComplaints(1, { category: e.target.value });
                }}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Action Buttons */}
            <div className="filter-btn-group">
              <button type="submit" className="card-btn blue-solid">
                Search
              </button>
              {(selectedStatus !== 'All Statuses' || selectedCategory !== 'All Categories' || activeSearch) && (
                <button
                  type="button"
                  className="card-btn secondary-btn"
                  onClick={handleResetFilters}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="table-loading-container" role="status">
          <div className="spinner-large" aria-hidden="true" />
          <p className="loading-text">Loading assigned complaints from database...</p>
        </div>
      ) : errorMessage ? (
        /* Error State with Retry */
        <div className="table-error-container" role="alert">
          <div className="error-icon-badge" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h3 className="error-title">Unable to Load Assigned Complaints</h3>
          <p className="error-desc">{errorMessage}</p>
          <button
            type="button"
            className="card-btn amber-solid"
            onClick={() => loadAssignedComplaints(pagination.page)}
          >
            Retry Connection
          </button>
        </div>
      ) : complaints.length === 0 ? (
        /* Honest Truthful Empty State */
        <div className="table-empty-container">
          <div className="table-empty-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h3 className="table-empty-title">No complaints assigned to your queue</h3>
          <p className="table-empty-desc">
            {selectedStatus !== 'All Statuses' || selectedCategory !== 'All Categories' || activeSearch
              ? 'No assigned complaints match the selected filter criteria. Try adjusting or clearing your search filters.'
              : 'Administrators have not assigned any complaints to your officer ID in MongoDB yet. Once assigned, complaints will appear here with field triage controls.'}
          </p>
          {(selectedStatus !== 'All Statuses' || selectedCategory !== 'All Categories' || activeSearch) && (
            <button
              type="button"
              className="card-btn secondary-btn"
              onClick={handleResetFilters}
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        /* Real Officer Complaints Table */
        <div className="complaints-table-wrapper">
          <table className="complaints-data-table" aria-label="Assigned Field Complaints">
            <thead>
              <tr>
                <th scope="col">Tracking ID</th>
                <th scope="col">Title & Location</th>
                <th scope="col">Category & Priority</th>
                <th scope="col">SLA Status</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c) => {
                const isTerminal = c.status === 'Resolved' || c.status === 'Rejected';
                return (
                  <tr key={c.id || c._id} className="complaint-table-row">
                    <td className="tracking-cell">
                      <span className="tracking-badge-pill">{c.trackingId}</span>
                    </td>
                    <td className="main-info-cell">
                      <div className="complaint-table-title">{c.title}</div>
                      <div className="complaint-table-address">
                        {c.location?.address || 'Location description pending'}
                      </div>
                    </td>
                    <td>
                      <div className="category-priority-wrap">
                        <span className="category-chip">{c.category}</span>
                        <span className={`priority-pill-sm ${getPriorityClass(c.priority)}`}>
                          {c.priority}
                        </span>
                      </div>
                    </td>
                    <td className="sla-cell">
                      {renderSlaBadge(c)}
                    </td>
                    <td className="date-cell">
                      {formatDate(c.createdAt)}
                    </td>
                    <td>
                      <span className={`status-pill ${getStatusClass(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="officer-actions-cell">
                        <button
                          type="button"
                          className="view-detail-btn"
                          onClick={() => onSelectComplaint && onSelectComplaint(c)}
                          aria-label={`View details for complaint ${c.trackingId}`}
                        >
                          Details
                        </button>
                        {c.status === 'In Progress' ? (
                          <button
                            type="button"
                            className="card-btn"
                            style={{ backgroundColor: '#16a34a', color: '#ffffff', border: 'none', padding: '4px 10px', fontSize: '0.78rem', fontWeight: 600 }}
                            onClick={() => setCompletionModalComplaint(c)}
                            title="Submit geo-verified work completion photograph"
                          >
                            Complete Work
                          </button>
                        ) : c.status === 'Under Review' ? (
                          <button
                            type="button"
                            className="card-btn amber-solid"
                            style={{ padding: '4px 10px', fontSize: '0.78rem', fontWeight: 600 }}
                            onClick={() => setStatusModalComplaint(c)}
                            title="Start field work"
                          >
                            Start Work
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`action-btn-status ${isTerminal || c.status === 'Provisionally Resolved' ? 'disabled' : 'active'}`}
                            onClick={() => setStatusModalComplaint(c)}
                            disabled={isTerminal || c.status === 'Provisionally Resolved'}
                            title={isTerminal ? `Record is ${c.status}` : c.status === 'Provisionally Resolved' ? 'Awaiting citizen review' : 'Update status'}
                          >
                            {isTerminal ? 'Closed' : c.status === 'Provisionally Resolved' ? 'Pending Citizen' : 'Update Status'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="pagination-bar">
              <span className="pagination-summary">
                Showing Page {pagination.page} of {pagination.totalPages} ({pagination.total} Total Assigned)
              </span>
              <div className="pagination-buttons">
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => loadAssignedComplaints(pagination.page - 1)}
                  disabled={pagination.page <= 1 || isLoading}
                >
                  &larr; Previous
                </button>
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => loadAssignedComplaints(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                >
                  Next &rarr;
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status Update Modal */}
      {statusModalComplaint && (
        <StatusUpdateModal
          complaint={statusModalComplaint}
          token={token}
          onClose={() => setStatusModalComplaint(null)}
          onUpdated={(updated) => {
            handleComplaintUpdated(updated);
            loadAssignedComplaints(pagination.page);
          }}
        />
      )}

      {/* Geo-Verified Work Completion Modal */}
      {completionModalComplaint && (
        <WorkCompletionModal
          complaint={completionModalComplaint}
          token={token}
          onClose={() => setCompletionModalComplaint(null)}
          onCompleted={(updated) => {
            handleComplaintUpdated(updated);
            loadAssignedComplaints(pagination.page);
          }}
        />
      )}
    </div>
  );
}
