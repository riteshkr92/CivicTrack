import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchMyComplaints, downloadComplaintsCsv } from '../services/api';

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

export default function MyComplaintsList({ onSelectComplaint, onNavigateReport }) {
  const { token, handleUnauthorized } = useAuth();

  const [complaints, setComplaints] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState(null);

  // Filters & Search
  const [selectedStatus, setSelectedStatus] = useState('All Statuses');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  const loadComplaints = useCallback(async (targetPage = 1, overrideFilters = {}) => {
    if (!token) return;
    setIsLoading(true);
    setErrorMessage(null);

    const st = overrideFilters.status !== undefined ? overrideFilters.status : selectedStatus;
    const cat = overrideFilters.category !== undefined ? overrideFilters.category : selectedCategory;
    const q = overrideFilters.search !== undefined ? overrideFilters.search : activeSearch;

    const res = await fetchMyComplaints(token, {
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
      setErrorMessage(res.errorMessage || 'Failed to load complaints.');
    }
  }, [token, selectedStatus, selectedCategory, activeSearch, handleUnauthorized]);

  useEffect(() => {
    loadComplaints(1);
  }, [loadComplaints]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setActiveSearch(searchInput);
    loadComplaints(1, { search: searchInput });
  };

  const handleStatusChange = (status) => {
    setSelectedStatus(status);
    loadComplaints(1, { status });
  };

  const handleCategoryChange = (category) => {
    setSelectedCategory(category);
    loadComplaints(1, { category });
  };

  const handleClearFilters = () => {
    setSelectedStatus('All Statuses');
    setSelectedCategory('All Categories');
    setSearchInput('');
    setActiveSearch('');
    loadComplaints(1, { status: 'All Statuses', category: 'All Categories', search: '' });
  };

  const hasActiveFilters = selectedStatus !== 'All Statuses' || selectedCategory !== 'All Categories' || activeSearch !== '';

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(new Date(dateString));
    } catch {
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

  return (
    <div className="my-complaints-container">
      {/* View Header */}
      <div className="view-header-bar">
        <div className="view-header-title-group">
          <div className="view-header-topline">
            <h1 className="view-heading">My Submitted Complaints</h1>
            <span className="live-records-count-chip">
              {pagination.total} Record{pagination.total === 1 ? '' : 's'}
            </span>
          </div>
          <p className="view-subheading">
            Track and monitor resolution milestones, department dispatch, and field progress for issues in your neighborhood.
          </p>
        </div>

        <div className="view-header-actions">
          <button
            type="button"
            className="export-csv-btn"
            onClick={handleExportCsv}
            disabled={isExporting}
            title="Download CSV export of your filtered complaints"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{isExporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
          {onNavigateReport && (
            <button
              type="button"
              className="card-btn blue-solid"
              onClick={onNavigateReport}
              title="Report a new civic issue in your neighborhood"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>+ Report New Issue</span>
            </button>
          )}
        </div>
      </div>

      {/* CSV Export Notice */}
      {exportNotice && (
        <div
          className={exportNotice.type === 'error' ? 'auth-alert-error' : 'auth-alert-success'}
          style={{ marginBottom: '14px', padding: '10px 14px', fontSize: '0.85rem' }}
          role="alert"
        >
          <span>{exportNotice.message}</span>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <section className="complaints-filter-card" aria-label="Complaints Filter and Search Toolbar">
        <form className="complaints-search-form" onSubmit={handleSearchSubmit}>
          <div className="complaints-search-wrapper">
            <svg className="search-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              id="citizen-complaint-search"
              type="search"
              className="complaints-search-input"
              placeholder="Search by tracking ID or title..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search complaints by tracking ID or title"
            />
            {searchInput && (
              <button
                type="button"
                className="search-field-clear"
                onClick={() => {
                  setSearchInput('');
                  if (activeSearch) {
                    setActiveSearch('');
                    loadComplaints(1, { search: '' });
                  }
                }}
                aria-label="Clear search input"
              >
                &times;
              </button>
            )}
          </div>
          <button type="submit" className="complaints-search-btn">
            Search
          </button>
        </form>

        <div className="complaints-filter-selects">
          <div className="filter-select-group">
            <label htmlFor="complaint-status-filter" className="filter-select-label">Status:</label>
            <select
              id="complaint-status-filter"
              className="filter-select-styled"
              value={selectedStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              {STATUSES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          <div className="filter-select-group">
            <label htmlFor="complaint-category-filter" className="filter-select-label">Category:</label>
            <select
              id="complaint-category-filter"
              className="filter-select-styled"
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="clear-filters-btn"
              onClick={handleClearFilters}
              title="Clear all active search and filter constraints"
            >
              Reset Filters
            </button>
          )}
        </div>
      </section>

      {/* Main Content Area: Loading, Error, Empty, or Table */}
      {isLoading ? (
        <div className="table-loading-container" role="status">
          <div className="spinner-large" aria-hidden="true" />
          <p className="loading-text">Loading your complaints from database...</p>
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
          <h2 className="error-title">Unable to Load Complaints</h2>
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
            {hasActiveFilters ? (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            ) : (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            )}
          </div>
          <h2 className="table-empty-title">
            {hasActiveFilters
              ? 'No complaints match the selected filter criteria'
              : 'You have not submitted any complaints yet'}
          </h2>
          <p className="table-empty-desc">
            {hasActiveFilters
              ? 'Try clearing or modifying your search terms, status filter, or category filter to view other submitted complaints.'
              : 'No complaints are linked to your account in MongoDB. Report a civic issue (such as road damage, streetlight outages, or drainage blockages) in your neighborhood to start tracking resolution milestones.'}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              className="card-btn blue-solid"
              onClick={handleClearFilters}
            >
              Clear All Filters
            </button>
          ) : onNavigateReport ? (
            <button
              type="button"
              className="card-btn blue-solid"
              onClick={onNavigateReport}
            >
              Report Your First Issue
            </button>
          ) : null}
        </div>
      ) : (
        /* Real Complaints Table */
        <div className="complaints-table-wrapper">
          <table className="complaints-data-table" aria-label="My Submitted Complaints">
            <thead>
              <tr>
                <th scope="col">Tracking ID</th>
                <th scope="col">Complaint Details</th>
                <th scope="col">Category</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
                <th scope="col">Assignment & Dispatch</th>
                <th scope="col" className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c) => {
                const locationAddress = c.location?.address || (typeof c.location === 'string' ? c.location : 'Location description pending');
                return (
                  <tr
                    key={c.id || c._id}
                    className="complaint-table-row clickable-row"
                    onClick={() => onSelectComplaint && onSelectComplaint(c)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (onSelectComplaint && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onSelectComplaint(c);
                      }
                    }}
                    aria-label={`Complaint ${c.trackingId}: ${c.title}`}
                  >
                    <td className="tracking-cell">
                      <span className="tracking-badge-pill">{c.trackingId}</span>
                    </td>
                    <td className="main-info-cell">
                      <div className="complaint-table-title">{c.title}</div>
                      <div className="complaint-table-meta-line">
                        <span className="complaint-table-address" title={locationAddress}>
                          {locationAddress}
                        </span>
                        {c.hasEvidence && (
                          <span className="evidence-chip-indicator" title="Geotagged photographic evidence attached">
                            &bull; Photo Verified
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="category-chip">{c.category}</span>
                    </td>
                    <td className="date-cell">
                      {formatDate(c.createdAt)}
                    </td>
                    <td>
                      <span className={`status-pill ${getStatusClass(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="assignment-cell">
                      {c.assignedOfficer ? (
                        <div className="assignment-info">
                          <span className="officer-name-tag">Officer: {c.assignedOfficer.name}</span>
                          {c.department && <span className="department-tag">&bull; {c.department}</span>}
                        </div>
                      ) : c.status === 'Resolved' ? (
                        <span className="resolved-status-tag">Resolved Case</span>
                      ) : (
                        <span className="unassigned-status-tag">Awaiting dispatch</span>
                      )}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="view-detail-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectComplaint) onSelectComplaint(c);
                        }}
                        aria-label={`Track details for complaint ${c.trackingId}`}
                      >
                        Track Details
                      </button>
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
                Showing Page {pagination.page} of {pagination.totalPages} ({pagination.total} Total Case{pagination.total === 1 ? '' : 's'})
              </span>
              <div className="pagination-buttons">
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => loadComplaints(pagination.page - 1)}
                  disabled={pagination.page <= 1 || isLoading}
                  aria-label="Go to previous page"
                >
                  &larr; Previous
                </button>
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => loadComplaints(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                  aria-label="Go to next page"
                >
                  Next &rarr;
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
