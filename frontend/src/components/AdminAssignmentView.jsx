import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchAdminComplaints, downloadComplaintsCsv } from '../services/api';
import AdminAssignmentModal from './AdminAssignmentModal';

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
  'Resolved',
  'Rejected'
];

export default function AdminAssignmentView({ onSelectComplaint, onComplaintAssigned }) {
  const { token, handleUnauthorized } = useAuth();

  const [complaints, setComplaints] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState(null);

  // Filters
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('All Statuses');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');

  // Assignment Modal
  const [assignmentModalComplaint, setAssignmentModalComplaint] = useState(null);

  const handleExportCsv = async () => {
    if (!token) return;
    setIsExporting(true);
    setExportNotice(null);

    const filters = {};
    if (unassignedOnly) filters.assigned = 'false';
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

  const loadComplaints = useCallback(async (targetPage = 1, currentFilters = {}) => {
    setIsLoading(true);
    setErrorMessage(null);

    const unassigned = currentFilters.unassigned !== undefined ? currentFilters.unassigned : unassignedOnly;
    const st = currentFilters.status !== undefined ? currentFilters.status : selectedStatus;
    const cat = currentFilters.category !== undefined ? currentFilters.category : selectedCategory;

    const res = await fetchAdminComplaints(token, {
      page: targetPage,
      limit: 10,
      unassigned,
      status: st === 'All Statuses' ? '' : st,
      category: cat === 'All Categories' ? '' : cat
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
  }, [token, unassignedOnly, selectedStatus, selectedCategory, handleUnauthorized]);

  useEffect(() => {
    loadComplaints(1);
  }, [loadComplaints]);

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

  const handleAssignmentCompleted = (updatedComplaint) => {
    setComplaints((prev) =>
      prev.map((c) => ((c.id || c._id) === (updatedComplaint.id || updatedComplaint._id) ? updatedComplaint : c))
    );
    if (onComplaintAssigned) onComplaintAssigned(updatedComplaint);
    loadComplaints(pagination.page);
  };

  return (
    <div className="admin-assignment-container">
      {/* View Header */}
      <div className="view-header-bar">
        <div>
          <h2 className="view-heading">Complaint Assignment & Officer Dispatch</h2>
          <p className="view-subheading">
            Triage submitted citizen complaints, allocate responsible municipal departments, and assign verified field officers.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="export-csv-btn"
            onClick={handleExportCsv}
            disabled={isExporting}
            title="Download CSV export of complaints"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{isExporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
          <div className="admin-records-pill">
            <span>{pagination.total} Total Complaints in System</span>
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

      {/* Filter Bar */}
      <div className="filter-search-card">
        <div className="filter-inputs-row">
          {/* Unassigned Filter Checkbox / Toggle */}
          <div className="filter-checkbox-wrap">
            <label className="filter-checkbox-label">
              <input
                type="checkbox"
                checked={unassignedOnly}
                onChange={(e) => {
                  setUnassignedOnly(e.target.checked);
                  loadComplaints(1, { unassigned: e.target.checked });
                }}
              />
              <span>Unassigned Only</span>
            </label>
          </div>

          {/* Status Dropdown */}
          <div className="filter-input-wrap">
            <select
              className="filter-select-input"
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                loadComplaints(1, { status: e.target.value });
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
                loadComplaints(1, { category: e.target.value });
              }}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Reset Filters */}
          {(unassignedOnly || selectedStatus !== 'All Statuses' || selectedCategory !== 'All Categories') && (
            <button
              type="button"
              className="card-btn secondary-btn"
              onClick={() => {
                setUnassignedOnly(false);
                setSelectedStatus('All Statuses');
                setSelectedCategory('All Categories');
                loadComplaints(1, { unassigned: false, status: 'All Statuses', category: 'All Categories' });
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="table-loading-container" role="status">
          <div className="spinner-large" aria-hidden="true" />
          <p className="loading-text">Loading complaint inventory from database...</p>
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
          <h3 className="error-title">Unable to Load Complaints</h3>
          <p className="error-desc">{errorMessage}</p>
          <button
            type="button"
            className="card-btn amber-solid"
            onClick={() => loadComplaints(pagination.page)}
          >
            Retry Connection
          </button>
        </div>
      ) : complaints.length === 0 ? (
        /* Empty State */
        <div className="table-empty-container">
          <div className="table-empty-icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <h3 className="table-empty-title">No complaints found</h3>
          <p className="table-empty-desc">
            {unassignedOnly
              ? 'No unassigned complaints found. All active complaints have been assigned to officers.'
              : 'The municipal complaints database contains zero records matching your filters.'}
          </p>
        </div>
      ) : (
        /* Complaints Table */
        <div className="complaints-table-wrapper">
          <table className="complaints-data-table" aria-label="Admin Assignment Management">
            <thead>
              <tr>
                <th scope="col">Tracking ID</th>
                <th scope="col">Title & Citizen</th>
                <th scope="col">Category & Priority</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
                <th scope="col">Assigned Officer</th>
                <th scope="col" className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c) => (
                <tr key={c.id || c._id} className="complaint-table-row">
                  <td className="tracking-cell">
                    <span className="tracking-badge-pill">{c.trackingId}</span>
                  </td>
                  <td className="main-info-cell">
                    <div className="complaint-table-title">{c.title}</div>
                    <div className="complaint-table-address">
                      Citizen: {c.citizen?.name || 'Citizen'} &bull; {c.location?.address || 'Address pending'}
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
                  <td className="date-cell">
                    {formatDate(c.createdAt)}
                  </td>
                  <td>
                    <span className={`status-pill ${getStatusClass(c.status)}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    {c.assignedOfficer ? (
                      <div className="assigned-officer-cell">
                        <span className="officer-name-text">{c.assignedOfficer.name}</span>
                        {c.assignedOfficer.department && (
                          <span className="officer-dept-tag">{c.assignedOfficer.department}</span>
                        )}
                      </div>
                    ) : (
                      <span className="unassigned-badge-pill">Unassigned</span>
                    )}
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
                      <button
                        type="button"
                        className="action-btn-assign"
                        onClick={() => setAssignmentModalComplaint(c)}
                      >
                        {c.assignedOfficer ? 'Reassign' : 'Assign Officer'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="pagination-bar">
              <span className="pagination-summary">
                Showing Page {pagination.page} of {pagination.totalPages} ({pagination.total} Total Complaints)
              </span>
              <div className="pagination-buttons">
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => loadComplaints(pagination.page - 1)}
                  disabled={pagination.page <= 1 || isLoading}
                >
                  &larr; Previous
                </button>
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => loadComplaints(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                >
                  Next &rarr;
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Admin Assignment Modal */}
      {assignmentModalComplaint && (
        <AdminAssignmentModal
          complaint={assignmentModalComplaint}
          token={token}
          onClose={() => setAssignmentModalComplaint(null)}
          onAssigned={handleAssignmentCompleted}
        />
      )}
    </div>
  );
}
