import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchOfficerWorkload, fetchAdminSummary, createOfficer } from '../services/api';

const DEFAULT_DEPARTMENTS = [
  'Roads & Infrastructure',
  'Sanitation & Waste Management',
  'Electrical & Streetlighting',
  'Water Supply & Sewerage',
  'Public Parks & Recreation',
  'General Municipal Operations'
];

export default function OfficerWorkloadView({ onNavigateDispatch }) {
  const { token, handleUnauthorized } = useAuth();
  const [officers, setOfficers] = useState([]);
  const [summaryData, setSummaryData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Step 8: Officer Account Provisioning Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDept, setNewDept] = useState(DEFAULT_DEPARTMENTS[0]);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [workloadRes, summaryRes] = await Promise.all([
        fetchOfficerWorkload(token),
        fetchAdminSummary(token)
      ]);

      setIsLoading(false);

      if (workloadRes.ok) {
        setOfficers(workloadRes.officers || []);
      } else {
        if (workloadRes.status === 401 && handleUnauthorized) {
          handleUnauthorized();
          return;
        }
        setErrorMessage(workloadRes.errorMessage || 'Failed to load officer workload telemetry.');
      }

      if (summaryRes.ok && summaryRes.summary) {
        setSummaryData(summaryRes.summary);
      }
    } catch (err) {
      setIsLoading(false);
      setErrorMessage('Network or server error while loading operational oversight telemetry.');
    }
  }, [token, handleUnauthorized]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Extract unique departments for filter dropdown
  const departments = ['All', ...new Set(officers.map((o) => o.department).filter(Boolean))];

  // Filter officers by department and search query
  const filteredOfficers = officers.filter((officer) => {
    const matchesDept = departmentFilter === 'All' || officer.department === departmentFilter;
    const matchesSearch =
      searchQuery.trim() === '' ||
      officer.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
      officer.email.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
      (officer.department && officer.department.toLowerCase().includes(searchQuery.toLowerCase().trim()));
    return matchesDept && matchesSearch;
  });

  const getCapacityBadge = (activeCount) => {
    if (activeCount === 0) {
      return <span className="capacity-badge idle">Available / Idle</span>;
    }
    if (activeCount <= 3) {
      return <span className="capacity-badge optimal">Optimal Load ({activeCount})</span>;
    }
    if (activeCount <= 7) {
      return <span className="capacity-badge moderate">Moderate ({activeCount})</span>;
    }
    return <span className="capacity-badge heavy">High Workload ({activeCount})</span>;
  };

  const totalAssignedInRoster = officers.reduce((sum, o) => sum + (o.metrics?.totalAssigned || 0), 0);
  const totalActiveInRoster = officers.reduce((sum, o) => sum + (o.metrics?.active || 0), 0);
  const totalResolvedInRoster = officers.reduce((sum, o) => sum + (o.metrics?.resolved || 0), 0);

  const handleOpenModal = () => {
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setNewDept(DEFAULT_DEPARTMENTS[0]);
    setCreateError(null);
    setCreateSuccess(null);
    setShowCreateModal(true);
  };

  const handleSubmitOfficer = async (e) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);

    if (!newName.trim() || newName.trim().length < 2) {
      setCreateError('Officer full name must be at least 2 characters.');
      return;
    }
    if (!newEmail.trim() || !newEmail.includes('@')) {
      setCreateError('Valid official email address is required.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setCreateError('Initial password must be at least 6 characters long.');
      return;
    }
    if (!newDept) {
      setCreateError('Department selection is required.');
      return;
    }

    setCreateLoading(true);
    const res = await createOfficer(token, {
      name: newName.trim(),
      email: newEmail.trim().toLowerCase(),
      password: newPassword,
      department: newDept
    });
    setCreateLoading(false);

    if (res.ok) {
      setCreateSuccess(`Officer ${res.officer.name} (${res.officer.email}) successfully provisioned in ${res.officer.department}!`);
      loadData();
      setTimeout(() => {
        setShowCreateModal(false);
      }, 1600);
    } else {
      setCreateError(res.errorMessage || 'Failed to provision officer account.');
    }
  };

  return (
    <div className="officer-oversight-container" aria-label="Municipal Officer Oversight Module">
      {/* View Header */}
      <div className="view-header-bar">
        <div>
          <h2 className="view-heading">Municipal Officer & Department Oversight</h2>
          <p className="view-subheading">
            Live operational telemetry, assigned caseload tracking, and active capacity across all municipal field officers.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            className="card-btn blue-solid"
            onClick={handleOpenModal}
            title="Provision a new municipal officer account"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: '6px' }}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Provision Officer
          </button>
          <div className="admin-records-pill">
            <span>{officers.length} Verified Field Officer{officers.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="oversight-kpi-row">
        <div className="kpi-mini-card">
          <span className="kpi-mini-label">ACTIVE FIELD OFFICERS</span>
          <span className="kpi-mini-value">{officers.length}</span>
          <span className="kpi-mini-sub">In operational roster</span>
        </div>
        <div className="kpi-mini-card">
          <span className="kpi-mini-label">ACTIVE WORKLOAD</span>
          <span className="kpi-mini-value orange">{totalActiveInRoster}</span>
          <span className="kpi-mini-sub">Under Review + In Progress</span>
        </div>
        <div className="kpi-mini-card">
          <span className="kpi-mini-label">TOTAL ASSIGNED</span>
          <span className="kpi-mini-value blue">{totalAssignedInRoster}</span>
          <span className="kpi-mini-sub">Cumulatively allocated</span>
        </div>
        <div className="kpi-mini-card">
          <span className="kpi-mini-label">RESOLVED BY OFFICERS</span>
          <span className="kpi-mini-value green">{totalResolvedInRoster}</span>
          <span className="kpi-mini-sub">Closed with proof</span>
        </div>
      </div>

      {/* Department Breakdown Section */}
      {summaryData?.byDepartment && Object.keys(summaryData.byDepartment).length > 0 && (
        <section className="department-distribution-card" aria-label="Department Caseload Allocation">
          <div className="dept-dist-header">
            <h3 className="dept-dist-title">Departmental Caseload Distribution</h3>
            <span className="dept-dist-meta">Aggregated from live MongoDB records</span>
          </div>
          <div className="dept-dist-grid">
            {Object.entries(summaryData.byDepartment).map(([deptName, count]) => (
              <div key={deptName} className="dept-pill-card">
                <span className="dept-pill-name">{deptName}</span>
                <span className="dept-pill-count">{count} case{count === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Search & Filter Toolbar */}
      <div className="filter-search-card">
        <div className="filter-inputs-row">
          <div className="form-group flex-1">
            <label htmlFor="officer-search" className="form-label">
              Search Officers
            </label>
            <input
              id="officer-search"
              type="text"
              placeholder="Search by officer name, email, or department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group" style={{ minWidth: '220px' }}>
            <label htmlFor="dept-filter" className="form-label">
              Department
            </label>
            <select
              id="dept-filter"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="form-input"
            >
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-actions-col">
            <button
              type="button"
              className="card-btn primary-solid"
              onClick={loadData}
              disabled={isLoading}
              title="Refresh telemetry from backend"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area: Loading / Error / Empty / Table */}
      {isLoading ? (
        <div className="loading-state-box" role="status">
          <div className="spinner-large" aria-hidden="true" />
          <p className="loading-text">Loading municipal officer workload telemetry...</p>
        </div>
      ) : errorMessage ? (
        <div className="error-state-card" role="alert">
          <p className="error-title">Unable to Load Officer Workload</p>
          <p className="error-desc">{errorMessage}</p>
          <button type="button" className="card-btn primary-solid" onClick={loadData}>
            Retry Request
          </button>
        </div>
      ) : filteredOfficers.length === 0 ? (
        <div className="empty-state-card">
          <div className="empty-icon-wrap" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h3 className="empty-title">
            {officers.length === 0 ? 'No Municipal Officers Registered' : 'No Matching Officers Found'}
          </h3>
          <p className="empty-desc">
            {officers.length === 0
              ? 'No accounts with the officer role exist in the database. Municipal staff accounts can be provisioned using backend/scripts/provision-user.js.'
              : 'No officers match your active filter criteria. Try selecting "All" departments or clearing your search query.'}
          </p>
        </div>
      ) : (
        <div className="table-responsive-wrapper">
          <table className="issues-data-table" aria-label="Municipal Officers Table">
            <thead>
              <tr>
                <th scope="col">OFFICER</th>
                <th scope="col">DEPARTMENT</th>
                <th scope="col">ASSIGNED</th>
                <th scope="col">ACTIVE TASKS</th>
                <th scope="col">RESOLVED</th>
                <th scope="col">CAPACITY STATUS</th>
                <th scope="col" className="text-right">DISPATCH</th>
              </tr>
            </thead>
            <tbody>
              {filteredOfficers.map((officer) => {
                const metrics = officer.metrics || {};
                return (
                  <tr key={officer.id || officer._id} className="table-row-interactive">
                    <td className="cell-officer-info">
                      <div className="officer-avatar-box">
                        <span className="officer-initials">
                          {officer.name ? officer.name.charAt(0).toUpperCase() : 'O'}
                        </span>
                      </div>
                      <div className="officer-name-col">
                        <span className="officer-full-name">{officer.name}</span>
                        <span className="officer-email-sub">{officer.email}</span>
                      </div>
                    </td>

                    <td className="cell-department">
                      <span className="dept-tag">
                        {officer.department || 'General Operations'}
                      </span>
                    </td>

                    <td className="cell-assigned-num">
                      <strong>{metrics.totalAssigned || 0}</strong>
                    </td>

                    <td className="cell-active-num">
                      <span className="active-count-highlight">
                        {metrics.active || 0}
                      </span>
                      <span className="active-sub-breakdown">
                        ({metrics.underReview || 0} review &bull; {metrics.inProgress || 0} work)
                      </span>
                    </td>

                    <td className="cell-resolved-num">
                      <span className="resolved-count-highlight">
                        {metrics.resolved || 0}
                      </span>
                    </td>

                    <td className="cell-capacity">
                      {getCapacityBadge(metrics.active || 0)}
                    </td>

                    <td className="cell-actions text-right">
                      {onNavigateDispatch ? (
                        <button
                          type="button"
                          className="table-action-btn primary"
                          onClick={onNavigateDispatch}
                          title="Open Complaint Assignment & Dispatch to allocate tasks to this officer"
                        >
                          Dispatch Work
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Step 8: Officer Account Provisioning Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => !createLoading && setShowCreateModal(false)} role="dialog" aria-modal="true" aria-labelledby="modal-officer-title">
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <div className="modal-header-left">
                <span className="tracking-badge-pill" style={{ background: '#eff6ff', color: '#2563eb' }}>ADMIN DISPATCH</span>
                <h3 id="modal-officer-title" className="detail-title" style={{ fontSize: '1.2rem', margin: 0 }}>Provision Field Officer</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCreateModal(false)}
                disabled={createLoading}
                aria-label="Close dialog"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmitOfficer} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ fontSize: '0.86rem', color: '#64748b', margin: 0 }}>
                Create an official municipal officer account. Officers have specialized access to department queues, field evidence review, and complaint resolution workflows.
              </p>

              {createError && (
                <div className="auth-alert-error" role="alert">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{createError}</span>
                </div>
              )}

              {createSuccess && (
                <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', padding: '12px 16px', borderRadius: '8px', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{createSuccess}</span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="officer-name">
                  Officer Full Name <span className="required-star">*</span>
                </label>
                <input
                  id="officer-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Officer James Wilson"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={createLoading}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="officer-email">
                  Official Email Address <span className="required-star">*</span>
                </label>
                <input
                  id="officer-email"
                  type="email"
                  className="form-input"
                  placeholder="e.g. jwilson@civictrack.gov"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={createLoading}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="officer-dept">
                  Assigned Department <span className="required-star">*</span>
                </label>
                <select
                  id="officer-dept"
                  className="form-input select-input"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  disabled={createLoading}
                >
                  {DEFAULT_DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="officer-pass">
                  Initial Password <span className="required-star">*</span>
                </label>
                <input
                  id="officer-pass"
                  type="password"
                  className="form-input"
                  placeholder="Minimum 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={createLoading}
                  minLength={6}
                  required
                />
              </div>

              <div className="modal-footer" style={{ padding: '16px 0 0 0', marginTop: '8px' }}>
                <button
                  type="button"
                  className="card-btn secondary-btn"
                  onClick={() => setShowCreateModal(false)}
                  disabled={createLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="auth-submit-btn"
                  style={{ width: 'auto', padding: '10px 24px' }}
                  disabled={createLoading}
                >
                  {createLoading ? 'Provisioning...' : 'Provision Officer Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
