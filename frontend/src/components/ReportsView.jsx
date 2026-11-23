import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { downloadComplaintsCsv } from '../services/api';

const STATUS_OPTIONS = [
  'All Statuses',
  'Submitted',
  'Under Review',
  'In Progress',
  'Provisionally Resolved',
  'Disputed',
  'Resolved',
  'Rejected'
];

const CATEGORY_OPTIONS = [
  'All Categories',
  'Pothole/Road Damage',
  'Garbage/Waste',
  'Streetlight',
  'Drainage/Waterlogging',
  'Water Supply',
  'Other'
];

const DEPARTMENT_OPTIONS = [
  'All Departments',
  'Roads & Infrastructure',
  'Sanitation & Solid Waste',
  'Electrical & Street Lighting',
  'Drainage & Water Supply',
  'General Municipal Operations'
];

export default function ReportsView() {
  const { token, role, handleUnauthorized } = useAuth();

  const [status, setStatus] = useState('All Statuses');
  const [category, setCategory] = useState('All Categories');
  const [department, setDepartment] = useState('All Departments');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState(null);

  const handleExport = async (e) => {
    if (e) e.preventDefault();
    if (!token) return;

    setIsExporting(true);
    setNotice(null);

    const filters = {};
    if (status !== 'All Statuses') filters.status = status;
    if (category !== 'All Categories') filters.category = category;
    if (role === 'admin' && department !== 'All Departments') filters.department = department;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    try {
      const res = await downloadComplaintsCsv(token, filters);
      if (res.ok) {
        setNotice({
          type: 'success',
          message: `Report successfully downloaded as "${res.filename}". Check your browser downloads.`
        });
      } else {
        if (res.status === 401 && handleUnauthorized) {
          handleUnauthorized();
          return;
        }
        setNotice({
          type: 'error',
          message: res.errorMessage || 'Export failed. Please check your network and permissions.'
        });
      }
    } catch (err) {
      setNotice({
        type: 'error',
        message: err.message || 'An error occurred during report generation.'
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleReset = () => {
    setStatus('All Statuses');
    setCategory('All Categories');
    setDepartment('All Departments');
    setStartDate('');
    setEndDate('');
    setNotice(null);
  };

  return (
    <div className="reports-view-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header Bar */}
      <div className="view-header-bar">
        <div>
          <h2 className="view-heading">Municipal Reports & CSV Export</h2>
          <p className="view-subheading">
            Generate and download sanitized, role-scoped civic complaint data exports for audits, reporting, and operational analytics.
          </p>
        </div>
        <div className="admin-records-pill">
          <span>Role Scoped: {role ? role.toUpperCase() : 'USER'}</span>
        </div>
      </div>

      {/* Notice Banner */}
      {notice && (
        <div
          className={notice.type === 'error' ? 'auth-alert-error' : 'auth-alert-success'}
          style={{ padding: '12px 16px', fontSize: '0.9rem', borderRadius: 'var(--radius-md)' }}
          role="alert"
        >
          <span>{notice.message}</span>
        </div>
      )}

      {/* Filter and Export Configuration Card */}
      <div className="filter-search-card" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginBottom: '16px' }}>
          Report Export Parameters
        </h3>

        <form onSubmit={handleExport}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              marginBottom: '20px'
            }}
          >
            {/* Status Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                Status
              </label>
              <select
                className="filter-select-input"
                style={{ width: '100%' }}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                Category
              </label>
              <select
                className="filter-select-input"
                style={{ width: '100%' }}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Department Filter (Admin only) */}
            {role === 'admin' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                  Department
                </label>
                <select
                  className="filter-select-input"
                  style={{ width: '100%' }}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  {DEPARTMENT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Start Date */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                Start Date
              </label>
              <input
                type="date"
                className="filter-text-input"
                style={{ width: '100%' }}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            {/* End Date */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                End Date
              </label>
              <input
                type="date"
                className="filter-text-input"
                style={{ width: '100%' }}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Action Row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '0.82rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Automated formula-injection defense enabled. Cells prefixed with =, +, -, @ are escaped.</span>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="card-btn secondary-btn"
                onClick={handleReset}
                disabled={isExporting}
              >
                Reset Parameters
              </button>
              <button
                type="submit"
                className="card-btn blue-solid"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.9rem' }}
                disabled={isExporting}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>{isExporting ? 'Generating Report...' : 'Download CSV Report'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Report Structure & Schema Details */}
      <div className="filter-search-card" style={{ padding: '24px' }}>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginBottom: '12px' }}>
          Included Data Fields & Standards
        </h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {[
            'Tracking ID',
            'Title',
            'Description',
            'Category',
            'Status',
            'Priority',
            'Department',
            'Location Address',
            'Latitude',
            'Longitude',
            'Evidence Status',
            'Assigned Officer',
            'Created At',
            'Resolved At',
            'Resolution Notes'
          ].map((col) => (
            <span
              key={col}
              style={{
                fontSize: '0.78rem',
                padding: '4px 10px',
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: 'var(--radius-sm)',
                color: '#334155',
                fontWeight: 600
              }}
            >
              {col}
            </span>
          ))}
        </div>
        <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '12px', lineHeight: 1.5 }}>
          Export limits: Up to 5,000 recent complaints matching your filter criteria. File encoding: UTF-8 with standard comma separation.
        </p>
      </div>
    </div>
  );
}
