import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchAdminComplaints, downloadComplaintsCsv, fetchSlaOverview, fetchCriticalAttention } from '../services/api';
import AdminAssignmentModal from './AdminAssignmentModal';
import SlaPolicyModal from './SlaPolicyModal';

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
  const [selectedEscalation, setSelectedEscalation] = useState('');
  const [selectedCriticalFilter, setSelectedCriticalFilter] = useState('');
  const [slaOverview, setSlaOverview] = useState(null);
  const [criticalAttentionData, setCriticalAttentionData] = useState(null);

  // Assignment & Policy Modals
  const [assignmentModalComplaint, setAssignmentModalComplaint] = useState(null);
  const [showPolicyModal, setShowPolicyModal] = useState(false);

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
    const esc = currentFilters.escalationLevel !== undefined ? currentFilters.escalationLevel : selectedEscalation;
    const crit = currentFilters.criticalAttention !== undefined ? currentFilters.criticalAttention : selectedCriticalFilter;

    const res = await fetchAdminComplaints(token, {
      page: targetPage,
      limit: 10,
      unassigned,
      status: st === 'All Statuses' ? '' : st,
      category: cat === 'All Categories' ? '' : cat,
      escalationLevel: esc,
      criticalAttention: crit
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

    try {
      const [overviewRes, criticalRes] = await Promise.all([
        fetchSlaOverview(token),
        fetchCriticalAttention(token)
      ]);
      if (overviewRes.ok && overviewRes.slaOverview) {
        setSlaOverview(overviewRes.slaOverview);
      }
      if (criticalRes.ok && criticalRes.criticalAttention) {
        setCriticalAttentionData(criticalRes.criticalAttention);
      }
    } catch (e) {
      // Non-fatal
    }
  }, [token, unassignedOnly, selectedStatus, selectedCategory, selectedEscalation, selectedCriticalFilter, handleUnauthorized]);

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

    if (c.sla?.requiresCriticalAttention) {
      return <span className="sla-badge sla-badge-critical-pulse">🚨 Action Required (L3)</span>;
    }

    const level = c.sla?.escalationLevel || 0;
    if (level === 3) {
      if (c.sla?.criticalAttentionAcknowledgedAt) {
        return <span className="sla-badge sla-badge-ack">✓ L3 Acknowledged</span>;
      }
      return <span className="sla-badge sla-badge-escalated">⚠️ L3 Critical</span>;
    }
    if (level === 2 || c.sla?.isBreached) {
      return <span className="sla-badge sla-badge-breached">⚠️ L2 Breached</span>;
    }
    if (level === 1) {
      return <span className="sla-badge sla-badge-approaching">⏳ L1 Approaching</span>;
    }
    return <span className="sla-badge sla-badge-normal">● On Track</span>;
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
            style={{ backgroundColor: '#ffffff', color: '#1e293b', border: '1px solid #cbd5e1' }}
            onClick={() => setShowPolicyModal(true)}
            title="Configure Municipal SLA Targets"
          >
            <span>⚙️ SLA Policy</span>
          </button>
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

      {/* SLA Compliance & Escalation Overview Banner */}
      {slaOverview && (
        <div className="sla-overview-banner">
          <div className="sla-metric-card sla-card-success">
            <span className="sla-metric-label">Compliance Rate</span>
            <span className="sla-metric-value">{slaOverview.complianceRate}%</span>
          </div>
          <div className="sla-metric-card">
            <span className="sla-metric-label">Within SLA</span>
            <span className="sla-metric-value">{slaOverview.withinSla}</span>
          </div>
          <div className="sla-metric-card sla-card-warning">
            <span className="sla-metric-label">Approaching (L1)</span>
            <span className="sla-metric-value">{slaOverview.approaching}</span>
          </div>
          <div className="sla-metric-card sla-card-danger">
            <span className="sla-metric-label">Breached (L2)</span>
            <span className="sla-metric-value">{slaOverview.breached}</span>
          </div>
          <div className="sla-metric-card sla-card-critical">
            <span className="sla-metric-label">Critical (L3)</span>
            <span className="sla-metric-value">{slaOverview.criticallyEscalated}</span>
          </div>
        </div>
      )}

      {/* Critical Attention Panel */}
      {criticalAttentionData && (criticalAttentionData.criticalCount > 0 || criticalAttentionData.unacknowledgedCount > 0) && (
        <div className="critical-attention-panel" role="region" aria-label="Critical SLA Attention Panel">
          <div className="critical-attention-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="attention-pulse-icon" aria-hidden="true">🚨</span>
              <h3 className="critical-attention-title">Critical Attention & Supervisory Triage Queue</h3>
            </div>
            {criticalAttentionData.oldestCriticalAgeHours !== null && (
              <span className="critical-age-badge">
                Oldest Unresolved: <strong>{criticalAttentionData.oldestCriticalAgeHours} hrs</strong>
              </span>
            )}
          </div>

          <div className="critical-attention-metrics">
            <div
              className={`critical-metric-box ${selectedCriticalFilter === 'unacknowledged' ? 'active-filter' : ''}`}
              onClick={() => {
                const next = selectedCriticalFilter === 'unacknowledged' ? '' : 'unacknowledged';
                setSelectedCriticalFilter(next);
                loadComplaints(1, { criticalAttention: next });
              }}
              title="Click to filter unacknowledged complaints"
            >
              <span className="critical-box-label">Action Required</span>
              <span className="critical-box-value critical-val-urgent">
                {criticalAttentionData.unacknowledgedCount}
              </span>
              <span className="critical-box-sub">Unacknowledged L3</span>
            </div>

            <div
              className={`critical-metric-box ${selectedEscalation === '3' ? 'active-filter' : ''}`}
              onClick={() => {
                const next = selectedEscalation === '3' ? '' : '3';
                setSelectedEscalation(next);
                loadComplaints(1, { escalationLevel: next });
              }}
              title="Click to filter Level 3 complaints"
            >
              <span className="critical-box-label">Level 3 Critical</span>
              <span className="critical-box-value">
                {criticalAttentionData.criticalCount}
              </span>
              <span className="critical-box-sub">Total Escalated</span>
            </div>

            <div
              className={`critical-metric-box ${selectedCriticalFilter === 'acknowledged' ? 'active-filter' : ''}`}
              onClick={() => {
                const next = selectedCriticalFilter === 'acknowledged' ? '' : 'acknowledged';
                setSelectedCriticalFilter(next);
                loadComplaints(1, { criticalAttention: next });
              }}
              title="Click to filter acknowledged complaints"
            >
              <span className="critical-box-label">Supervisory Review</span>
              <span className="critical-box-value critical-val-ack">
                {criticalAttentionData.acknowledgedCount}
              </span>
              <span className="critical-box-sub">Acknowledged Cases</span>
            </div>
          </div>

          {criticalAttentionData.byDepartment && Object.keys(criticalAttentionData.byDepartment).length > 0 && (
            <div className="critical-dept-row">
              <span className="critical-dept-label">Affected Departments:</span>
              <div className="critical-dept-tags">
                {Object.entries(criticalAttentionData.byDepartment).map(([dept, count]) => (
                  <span key={dept} className="critical-dept-tag">
                    {dept}: <strong>{count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
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

          {/* Quick Dispute Queue Filter */}
          <div className="filter-checkbox-wrap">
            <button
              type="button"
              className={selectedStatus === 'Disputed' ? 'card-btn amber-solid' : 'card-btn secondary-btn'}
              style={{ fontSize: '0.8rem', padding: '5px 10px', height: '36px' }}
              onClick={() => {
                const nextStatus = selectedStatus === 'Disputed' ? 'All Statuses' : 'Disputed';
                setSelectedStatus(nextStatus);
                loadComplaints(1, { status: nextStatus });
              }}
            >
              <span>{selectedStatus === 'Disputed' ? 'Showing Disputed' : 'Dispute Review Queue'}</span>
            </button>
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

          {/* SLA Escalation Filter */}
          <div className="filter-input-wrap">
            <select
              className="filter-select-input"
              value={selectedEscalation}
              onChange={(e) => {
                setSelectedEscalation(e.target.value);
                loadComplaints(1, { escalationLevel: e.target.value });
              }}
            >
              <option value="">All SLA Levels</option>
              <option value="0">Level 0: Within SLA</option>
              <option value="1">Level 1: Approaching</option>
              <option value="2">Level 2: Breached</option>
              <option value="3">Level 3: Critical Escalation</option>
            </select>
          </div>

          {/* Critical Attention Oversight Filter */}
          <div className="filter-input-wrap">
            <select
              className="filter-select-input"
              value={selectedCriticalFilter}
              onChange={(e) => {
                setSelectedCriticalFilter(e.target.value);
                loadComplaints(1, { criticalAttention: e.target.value });
              }}
            >
              <option value="">All Oversight Status</option>
              <option value="unacknowledged">🚨 Action Required (Unack)</option>
              <option value="acknowledged">✓ Acknowledged Oversight</option>
            </select>
          </div>

          {/* Reset Filters */}
          {(unassignedOnly || selectedStatus !== 'All Statuses' || selectedCategory !== 'All Categories' || selectedEscalation !== '' || selectedCriticalFilter !== '') && (
            <button
              type="button"
              className="card-btn secondary-btn"
              onClick={() => {
                setUnassignedOnly(false);
                setSelectedStatus('All Statuses');
                setSelectedCategory('All Categories');
                setSelectedEscalation('');
                setSelectedCriticalFilter('');
                loadComplaints(1, { unassigned: false, status: 'All Statuses', category: 'All Categories', escalationLevel: '', criticalAttention: '' });
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
          <table className="complaints-data-table admin-complaints-table" aria-label="Admin Assignment Management">
            <thead>
              <tr>
                <th scope="col" className="col-tracking">Tracking ID</th>
                <th scope="col" className="col-main-info">Title & Citizen</th>
                <th scope="col" className="col-category-priority">Category & Priority</th>
                <th scope="col" className="col-sla">SLA Status</th>
                <th scope="col" className="col-date">Submitted</th>
                <th scope="col" className="col-status">Status</th>
                <th scope="col" className="col-officer">Assigned Officer</th>
                <th scope="col" className="col-actions text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c) => (
                <tr key={c.id || c._id} className="complaint-table-row">
                  <td className="tracking-cell">
                    <span className="tracking-badge-pill">{c.trackingId}</span>
                  </td>
                  <td className="main-info-cell admin-main-info-cell">
                    <div className="complaint-table-title" title={c.title}>{c.title}</div>
                    <div className="complaint-table-citizen">
                      <span className="citizen-icon-tag" aria-hidden="true">👤</span>
                      <span className="citizen-name-text">Citizen: <strong>{c.citizen?.name || 'Citizen'}</strong></span>
                    </div>
                    <div className="complaint-table-address" title={c.location?.address || 'Address pending'}>
                      <span className="address-icon-tag" aria-hidden="true">📍</span>
                      <span>{c.location?.address || 'Address pending'}</span>
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
                  <td className="text-right actions-cell">
                    <div className="officer-actions-cell admin-actions-cell">
                      <button
                        type="button"
                        className={c.status === 'Disputed' ? 'action-btn-assign' : 'view-detail-btn'}
                        style={c.status === 'Disputed' ? { backgroundColor: '#ea580c', borderColor: '#c2410c' } : {}}
                        onClick={() => onSelectComplaint && onSelectComplaint(c)}
                        aria-label={`View details for complaint ${c.trackingId}`}
                      >
                        {c.status === 'Disputed' ? 'Review Dispute' : 'Details'}
                      </button>
                      {c.status !== 'Disputed' && (
                        <button
                          type="button"
                          className="action-btn-assign"
                          onClick={() => setAssignmentModalComplaint(c)}
                        >
                          {c.assignedOfficer ? 'Reassign' : 'Assign Officer'}
                        </button>
                      )}
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

      {/* SLA Policy Administration Modal */}
      {showPolicyModal && (
        <SlaPolicyModal
          token={token}
          onClose={() => setShowPolicyModal(false)}
          onPolicyUpdated={() => loadComplaints(pagination.page)}
        />
      )}
    </div>
  );
}
