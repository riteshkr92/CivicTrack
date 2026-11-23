import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import NeedsAttentionPanel from '../components/NeedsAttentionPanel';
import StatCard from '../components/StatCard';
import IssuesTable from '../components/IssuesTable';
import IssueMap from '../components/IssueMap';
import Toast from '../components/Toast';
import ReportIssueForm from '../components/ReportIssueForm';
import MyComplaintsList from '../components/MyComplaintsList';
import OfficerComplaintsList from '../components/OfficerComplaintsList';
import AdminAssignmentView from '../components/AdminAssignmentView';
import OfficerWorkloadView from '../components/OfficerWorkloadView';
import ReportsView from '../components/ReportsView';
import SettingsView from '../components/SettingsView';
import ComplaintDetailModal from '../components/ComplaintDetailModal';
import SlaGaugeCard from '../components/SlaGaugeCard';
import {
  fetchComplaintSummary,
  fetchMyComplaints,
  fetchAssignedSummary,
  fetchAssignedComplaints,
  fetchAdminComplaints,
  fetchAdminSummary
} from '../services/api';

export default function DashboardView() {
  const { user, role, token, handleUnauthorized } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('overview');
  const [toast, setToast] = useState({ visible: false, message: '' });

  // Citizen Complaint Live State
  const [citizenSummary, setCitizenSummary] = useState({
    total: 0,
    submitted: 0,
    underReview: 0,
    inProgress: 0,
    resolved: 0,
    rejected: 0
  });
  const [citizenComplaints, setCitizenComplaints] = useState([]);
  const [recentComplaints, setRecentComplaints] = useState([]);
  const [citizenLoading, setCitizenLoading] = useState(false);
  const [citizenError, setCitizenError] = useState(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState(null);

  // Officer Live State
  const [officerSummary, setOfficerSummary] = useState({
    totalAssigned: 0,
    underReview: 0,
    inProgress: 0,
    provisionallyResolved: 0,
    disputed: 0,
    resolved: 0,
    rejected: 0
  });
  const [officerComplaints, setOfficerComplaints] = useState([]);

  // Admin Live State
  const [adminComplaints, setAdminComplaints] = useState([]);
  const [adminSummary, setAdminSummary] = useState({
    total: 0,
    byStatus: {
      Submitted: 0,
      'Under Review': 0,
      'In Progress': 0,
      'Provisionally Resolved': 0,
      Disputed: 0,
      Resolved: 0,
      Rejected: 0
    },
    unassigned: 0,
    assigned: 0,
    resolved: 0,
    rejected: 0,
    activeIssues: 0,
    byCategory: {},
    byDepartment: {},
    performance: {
      avgResolutionHours: null,
      resolvedCount: 0,
      avgResponseHours: null,
      respondedCount: 0,
      slaStatus: 'unavailable',
      slaNotice: 'Overdue tracking requires a municipal SLA policy defining resolution timeframes by priority and category.'
    }
  });

  // Selected Complaint for Modal Inspection
  const [selectedComplaint, setSelectedComplaint] = useState(null);

  // SLA Overdue Counts (strictly non-terminal active complaints)
  const officerOverdueCount = useMemo(() => {
    return (officerComplaints || []).filter(
      (c) =>
        c.status !== 'Resolved' &&
        c.status !== 'Rejected' &&
        (c.sla?.isBreached || (c.sla?.escalationLevel && c.sla.escalationLevel > 0))
    ).length;
  }, [officerComplaints]);

  const adminOverdueCount = useMemo(() => {
    return (adminComplaints || []).filter(
      (c) =>
        c.status !== 'Resolved' &&
        c.status !== 'Rejected' &&
        (c.sla?.isBreached || (c.sla?.escalationLevel && c.sla.escalationLevel > 0))
    ).length;
  }, [adminComplaints]);

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const closeSidebar = () => setSidebarOpen(false);

  const showToast = (message) => {
    setToast({ visible: true, message });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 4000);
  };

  // 1. Citizen Data Fetcher (fetches full list for map/reporting and slice for overview)
  const refreshCitizenData = useCallback(async () => {
    if (role !== 'citizen' || !token) return;
    setCitizenLoading(true);
    setCitizenError(null);
    setMapLoading(true);
    setMapError(null);

    try {
      const [sumRes, allRes] = await Promise.all([
        fetchComplaintSummary(token),
        fetchMyComplaints(token, 1, 50)
      ]);

      if (sumRes.ok && sumRes.summary) {
        setCitizenSummary(sumRes.summary);
      } else if (sumRes.status === 401 && handleUnauthorized) {
        handleUnauthorized();
        return;
      } else if (!sumRes.ok) {
        setCitizenError(sumRes.errorMessage || 'Failed to load complaint summary.');
      }

      if (allRes.ok && allRes.complaints) {
        setCitizenComplaints(allRes.complaints);
        setRecentComplaints(allRes.complaints.slice(0, 5));
      } else if (allRes.status === 401 && handleUnauthorized) {
        handleUnauthorized();
        return;
      } else if (!allRes.ok) {
        setCitizenError(allRes.errorMessage || 'Failed to load citizen complaints.');
        setMapError(allRes.errorMessage || 'Failed to load citizen complaints.');
      }
    } catch (err) {
      console.warn('Citizen fetch error:', err?.message);
      setCitizenError('Network connection issue while loading complaints.');
      setMapError('Network connection issue while loading complaints.');
    } finally {
      setCitizenLoading(false);
      setMapLoading(false);
    }
  }, [role, token, handleUnauthorized]);

  // 2. Officer Data Fetcher
  const refreshOfficerData = useCallback(async () => {
    if (role !== 'officer' || !token) return;
    setMapLoading(true);
    setMapError(null);

    try {
      const [sumRes, recentRes] = await Promise.all([
        fetchAssignedSummary(token),
        fetchAssignedComplaints(token, { page: 1, limit: 50 })
      ]);

      if (sumRes.ok && sumRes.summary) {
        setOfficerSummary(sumRes.summary);
      } else if (sumRes.status === 401 && handleUnauthorized) {
        handleUnauthorized();
        return;
      }

      if (recentRes.ok && recentRes.complaints) {
        setOfficerComplaints(recentRes.complaints);
      } else if (recentRes.status === 401 && handleUnauthorized) {
        handleUnauthorized();
        return;
      } else if (!recentRes.ok) {
        setMapError(recentRes.errorMessage || 'Failed to load assigned tasks.');
      }
    } catch (err) {
      setMapError('Network connection issue while loading complaints.');
    } finally {
      setMapLoading(false);
    }
  }, [role, token, handleUnauthorized]);

  // 3. Admin Data Fetcher
  const refreshAdminData = useCallback(async () => {
    if (role !== 'admin' || !token) return;
    setMapLoading(true);
    setMapError(null);

    try {
      const [sumRes, allRes] = await Promise.all([
        fetchAdminSummary(token),
        fetchAdminComplaints(token, { page: 1, limit: 50 })
      ]);

      if (sumRes.ok && sumRes.summary) {
        setAdminSummary(sumRes.summary);
      } else if (sumRes.status === 401 && handleUnauthorized) {
        handleUnauthorized();
        return;
      }

      if (allRes.ok) {
        setAdminComplaints(allRes.complaints || []);
      } else if (allRes.status === 401 && handleUnauthorized) {
        handleUnauthorized();
        return;
      } else if (!allRes.ok) {
        setMapError(allRes.errorMessage || 'Failed to load municipal complaints.');
      }
    } catch (err) {
      setMapError('Network connection issue while loading complaints.');
    } finally {
      setMapLoading(false);
    }
  }, [role, token, handleUnauthorized]);

  useEffect(() => {
    if (token) {
      if (role === 'citizen') {
        refreshCitizenData();
      } else if (role === 'officer') {
        refreshOfficerData();
      } else if (role === 'admin') {
        refreshAdminData();
      }
    }
  }, [role, token, refreshCitizenData, refreshOfficerData, refreshAdminData]);

  const handleSelectNav = (navId) => {
    setActiveNav(navId);
    const validNavs = ['overview', 'reports', 'settings'];
    if (role === 'citizen') {
      validNavs.push('my-complaints', 'report-issue', 'city-map');
      if (navId === 'city-map' && citizenComplaints.length === 0) {
        refreshCitizenData();
      }
    }
    if (role === 'officer') {
      validNavs.push('assigned-tasks', 'ward-map');
      if (navId === 'ward-map' && officerComplaints.length === 0) {
        refreshOfficerData();
      }
    }
    if (role === 'admin') {
      validNavs.push('work-orders', 'team', 'departments', 'map');
      if (navId === 'map' && adminComplaints.length === 0) {
        refreshAdminData();
      }
    }

    if (!validNavs.includes(navId)) {
      showToast(`Selected "${navId}".`);
    }
  };

  const handleComplaintUpdated = (updated) => {
    setSelectedComplaint(updated);
    if (role === 'citizen') {
      refreshCitizenData();
    } else if (role === 'officer') {
      refreshOfficerData();
    } else if (role === 'admin') {
      refreshAdminData();
    }
  };

  return (
    <div className="app-layout">
      {/* Sidebar with dynamic role-based navigation */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        activeNav={activeNav}
        onSelectNav={handleSelectNav}
      />

      {/* Main Content Area */}
      <div className="main-wrapper">
        <Header onToggleSidebar={toggleSidebar} onSelectComplaint={(c) => setSelectedComplaint(c)} />

        <main className="dashboard-container">
          {activeNav === 'overview' ? (
            role === 'citizen' ? (
              /* Citizen Dashboard View (UI Enhancement Step 1) */
              <>
                {citizenError && (
                  <div className="citizen-error-banner" role="alert">
                    <div className="citizen-error-content">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{citizenError}</span>
                    </div>
                    <button
                      type="button"
                      className="citizen-retry-btn"
                      onClick={refreshCitizenData}
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Welcome Hero Section */}
                <section className="citizen-hero-card" aria-label="Citizen Welcome Header">
                  <div className="citizen-hero-main">
                    <div className="citizen-hero-badge">
                      <span className="pulse-indicator-dot" aria-hidden="true" />
                      <span>Citizen Services Workspace</span>
                    </div>
                    <h1 className="citizen-hero-title">
                      {user?.name ? `Welcome back, ${user.name}` : 'Welcome to Citizen Services'}
                    </h1>
                    <p className="citizen-hero-description">
                      Report civic infrastructure issues in your neighborhood, track resolution milestones in real time, and monitor municipal department responses.
                    </p>
                    <div className="citizen-hero-meta">
                      <span className="citizen-hero-meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        {citizenLoading ? 'Syncing database...' : `${citizenSummary.total} Total Complaint${citizenSummary.total === 1 ? '' : 's'} on Record`}
                      </span>
                      <span className="citizen-hero-meta-sep" aria-hidden="true">&bull;</span>
                      <span className="citizen-hero-meta-item">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        Live MongoDB Synced
                      </span>
                    </div>
                  </div>

                  <div className="citizen-hero-actions">
                    <button
                      type="button"
                      className="citizen-primary-action-btn"
                      onClick={() => setActiveNav('report-issue')}
                      title="Report a new civic issue in your neighborhood"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span>Report an Issue</span>
                    </button>
                    <button
                      type="button"
                      className="citizen-secondary-action-btn"
                      onClick={() => setActiveNav('my-complaints')}
                      title="View all complaints submitted by your account"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span>My Complaints</span>
                    </button>
                  </div>
                </section>

                {/* Pending Resolution Review Banner */}
                {citizenSummary.provisionallyResolved > 0 && (
                  <div
                    style={{
                      background: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '8px',
                      padding: '14px 18px',
                      marginBottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '16px'
                    }}
                    role="alert"
                    aria-live="polite"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '1.4rem' }}>📋</span>
                      <div>
                        <strong style={{ color: '#065f46', fontSize: '0.95rem' }}>
                          Action Required: {citizenSummary.provisionallyResolved} Completed Work Order{citizenSummary.provisionallyResolved > 1 ? 's' : ''} Awaiting Your Review
                        </strong>
                        <p style={{ margin: '2px 0 0 0', color: '#047857', fontSize: '0.85rem' }}>
                          An officer has submitted photographic completion evidence. Please inspect the work and confirm resolution or submit a dispute.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ whiteSpace: 'nowrap', padding: '7px 16px', fontSize: '0.85rem', cursor: 'pointer' }}
                      onClick={() => setActiveNav('my-complaints')}
                    >
                      Review Work
                    </button>
                  </div>
                )}

                {/* 4 Authentic Citizen Summary Metric Cards */}
                <section className="metrics-row four-cols citizen-metrics-grid" aria-label="My Citizen Metrics">
                  <StatCard
                    label="TOTAL SUBMITTED"
                    value={citizenLoading ? "—" : String(citizenSummary.total)}
                    subtext={citizenLoading ? "Syncing database records..." : citizenSummary.total === 0 ? "No complaints recorded" : `${citizenSummary.total} complaints on record`}
                    colorScheme="blue"
                    isUnavailable={citizenLoading}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="SUBMITTED & REVIEW"
                    value={citizenLoading ? "—" : String((citizenSummary.submitted || 0) + (citizenSummary.underReview || 0))}
                    subtext={citizenLoading ? "Syncing..." : (citizenSummary.submitted || 0) + (citizenSummary.underReview || 0) > 0 ? `${citizenSummary.submitted || 0} Submitted \u2022 ${citizenSummary.underReview || 0} Under Review` : "No pending reviews"}
                    colorScheme="orange"
                    isUnavailable={citizenLoading}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="IN FIELD PROGRESS"
                    value={citizenLoading ? "—" : String(citizenSummary.inProgress || 0)}
                    subtext={citizenLoading ? "Syncing..." : citizenSummary.inProgress > 0 ? `${citizenSummary.inProgress} active field work order${citizenSummary.inProgress === 1 ? '' : 's'}` : "No active field work"}
                    colorScheme="purple"
                    isUnavailable={citizenLoading}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="RESOLVED"
                    value={citizenLoading ? "—" : String(citizenSummary.resolved || 0)}
                    subtext={citizenLoading ? "Syncing..." : citizenSummary.resolved > 0 ? `${citizenSummary.resolved} successfully resolved` : "No resolved complaints yet"}
                    colorScheme="green"
                    isUnavailable={citizenLoading}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    }
                  />
                </section>

                {/* Citizen Lower Grid: Recent Complaints + City Map */}
                <div className="operations-grid">
                  <IssuesTable
                    complaints={recentComplaints}
                    role={role}
                    isLoading={citizenLoading}
                    onSelectComplaint={(c) => setSelectedComplaint(c)}
                    onViewAllComplaints={() => setActiveNav('my-complaints')}
                    onNavigateReport={() => setActiveNav('report-issue')}
                  />
                  <IssueMap
                    complaints={citizenComplaints}
                    role={role}
                    loading={citizenLoading}
                    error={citizenError}
                    onRetry={refreshCitizenData}
                    onSelectComplaint={(c) => setSelectedComplaint(c)}
                    onNavigateReport={() => setActiveNav('report-issue')}
                  />
                </div>
              </>
            ) : role === 'officer' ? (
              /* Officer Dashboard View */
              <>
                <section className="officer-banner-card" aria-label="Officer Workspace Notice">
                  <div className="officer-banner-header">
                    <div className="officer-badge-icon" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="officer-banner-title">Municipal Officer Portal &bull; Field Operations</h2>
                      <p className="officer-banner-desc">
                        Department Queue &bull; Inspect assigned civic issues, advance status milestones, and attach resolution notes.
                      </p>
                    </div>
                  </div>
                  <div className="officer-notice-pill">
                    <span>
                      Officer Assignment Engine: Active Database State: {officerSummary.totalAssigned} assigned task{officerSummary.totalAssigned === 1 ? '' : 's'}
                    </span>
                  </div>

                  {officerSummary.disputed > 0 && (
                    <div
                      style={{
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        marginTop: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}
                      role="alert"
                    >
                      <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                      <div>
                        <strong style={{ color: '#991b1b', fontSize: '0.95rem' }}>
                          Notice: {officerSummary.disputed} Complaint{officerSummary.disputed > 1 ? 's' : ''} Disputed by Citizen
                        </strong>
                        <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.85rem' }}>
                          A citizen was dissatisfied with work evidence. The complaint is currently under administrative dispute review.
                        </p>
                      </div>
                    </div>
                  )}
                </section>

                {/* 4 Officer Metric Cards */}
                <section className="metrics-row" aria-label="Officer Operations Metrics">
                  <StatCard
                    label="DEPARTMENT QUEUE"
                    value={String(officerSummary.totalAssigned)}
                    subtext="Assigned directly to your ID"
                    colorScheme="blue"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="ASSIGNED TO ME"
                    value={String((officerSummary.underReview || 0) + (officerSummary.inProgress || 0))}
                    subtext="Under review or in field work"
                    colorScheme="orange"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="20" y1="8" x2="20" y2="14" />
                        <line x1="23" y1="11" x2="17" y2="11" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="RESOLVED / CLOSED"
                    value={String(officerSummary.resolved || 0)}
                    subtext={officerSummary.provisionallyResolved > 0 ? `${officerSummary.provisionallyResolved} awaiting citizen confirmation` : "Closed with verified evidence"}
                    colorScheme="green"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="OVERDUE TASKS"
                    value={String(officerOverdueCount)}
                    subtext={officerOverdueCount > 0 ? `${officerOverdueCount} active breach${officerOverdueCount === 1 ? '' : 'es'}` : "All tasks within SLA"}
                    colorScheme={officerOverdueCount > 0 ? "danger" : "green"}
                    isUnavailable={false}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    }
                  />
                </section>

                {/* Officer SLA Performance Card */}
                {officerSummary.totalAssigned > 0 && (
                  <div className="officer-performance-row">
                    <SlaGaugeCard
                      totalComplaints={
                        Math.max(
                          0,
                          (officerSummary.totalAssigned || 0) -
                          (officerSummary.resolved || 0) -
                          (officerSummary.rejected || 0)
                        )
                      }
                      overdueCount={officerOverdueCount}
                      inProgressCount={officerSummary.inProgress || 0}
                      resolvedCount={officerSummary.resolved || 0}
                      title="Department Field SLA Performance"
                      subtitle="Real-time metric computed across active assigned tasks"
                    />
                  </div>
                )}

                {/* Officer Lower Grid: Department Queue Table + Ward Map */}
                <div className="operations-grid">
                  <IssuesTable
                    complaints={officerComplaints}
                    role={role}
                    onSelectComplaint={(c) => setSelectedComplaint(c)}
                  />
                  <IssueMap
                    complaints={officerComplaints}
                    onSelectComplaint={(c) => setSelectedComplaint(c)}
                  />
                </div>
              </>
            ) : (
              /* Administrator Dashboard View (Operations Center) */
              <>
                {/* Needs Attention Panel */}
                <NeedsAttentionPanel
                  alertsCount={(adminSummary.unassigned || 0) + adminOverdueCount}
                  overdueCount={adminOverdueCount}
                  unassignedCount={adminSummary.unassigned || 0}
                  nearingBreachCount={(adminComplaints || []).filter(
                    (c) =>
                      c.sla?.remainingHours !== undefined &&
                      c.sla.remainingHours !== null &&
                      c.sla.remainingHours > 0 &&
                      c.sla.remainingHours <= 6 &&
                      !c.sla.isBreached
                  ).length}
                  onAssignClick={() => handleSelectNav('work-orders')}
                  onOverdueClick={() => handleSelectNav('work-orders')}
                  onReviewClick={() => handleSelectNav('work-orders')}
                />

                {/* 5 City-Wide Metric Cards */}
                <section className="metrics-row" aria-label="City-Wide Operations Metrics">
                  <StatCard
                    label="ACTIVE / OPEN ISSUES"
                    value={String(adminSummary.activeIssues)}
                    subtext={
                      adminSummary.total > 0
                        ? `${adminSummary.byStatus['Submitted'] || 0} Submitted \u2022 ${(adminSummary.byStatus['Under Review'] || 0) + (adminSummary.byStatus['In Progress'] || 0)} In Progress`
                        : 'No open complaints'
                    }
                    colorScheme="blue"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="OVERDUE / BREACHED"
                    value={String(adminOverdueCount)}
                    subtext={adminOverdueCount > 0 ? `${adminOverdueCount} breach${adminOverdueCount === 1 ? '' : 'es'} requiring attention` : "All complaints within SLA"}
                    colorScheme={adminOverdueCount > 0 ? "danger" : "green"}
                    isUnavailable={false}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="UNASSIGNED"
                    value={String(adminSummary.unassigned)}
                    subtext={adminSummary.unassigned > 0 ? `${adminSummary.unassigned} pending officer dispatch` : 'All complaints assigned'}
                    colorScheme="orange"
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="20" y1="8" x2="20" y2="14" />
                        <line x1="23" y1="11" x2="17" y2="11" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="AVG. RESPONSE TIME"
                    value={adminSummary.performance?.avgResponseHours !== null ? `${adminSummary.performance.avgResponseHours}h` : '—'}
                    subtext={
                      adminSummary.performance?.respondedCount > 0
                        ? `Based on ${adminSummary.performance.respondedCount} dispatch milestone${adminSummary.performance.respondedCount === 1 ? '' : 's'}`
                        : 'No response records recorded'
                    }
                    colorScheme="purple"
                    isUnavailable={adminSummary.performance?.avgResponseHours === null}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    }
                  />

                  <StatCard
                    label="AVG. RESOLUTION TIME"
                    value={adminSummary.performance?.avgResolutionHours !== null ? `${adminSummary.performance.avgResolutionHours}h` : '—'}
                    subtext={
                      adminSummary.performance?.resolvedCount > 0
                        ? `Based on ${adminSummary.performance.resolvedCount} closed case${adminSummary.performance.resolvedCount === 1 ? '' : 's'}`
                        : 'No resolution records recorded'
                    }
                    colorScheme="green"
                    isUnavailable={adminSummary.performance?.avgResolutionHours === null}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    }
                  />
                </section>

                {/* Municipal SLA Gauge & Complaint Lifecycle Pipeline Breakdown */}
                <div className="analytics-overview-row">
                  <SlaGaugeCard
                    totalComplaints={adminSummary.activeIssues || 0}
                    overdueCount={adminOverdueCount}
                    inProgressCount={
                      (adminSummary.byStatus?.['In Progress'] || 0) +
                      (adminSummary.byStatus?.['Under Review'] || 0)
                    }
                    resolvedCount={adminSummary.byStatus?.['Resolved'] || 0}
                    title="Municipal SLA Performance"
                    subtitle="Real-time metric computed across active municipal caseload"
                  />

                  <section className="admin-status-pipeline-card" aria-label="Complaint Lifecycle Status Distribution">
                    <div className="pipeline-header">
                      <div className="pipeline-title-group">
                        <h3 className="pipeline-title">City-Wide Complaint Lifecycle Pipeline</h3>
                        <span className="pipeline-subtitle">Live real-time aggregation across all municipal categories</span>
                      </div>
                      <div className="pipeline-badge">
                        <span>{adminSummary.total} Total Registered Case{adminSummary.total === 1 ? '' : 's'}</span>
                      </div>
                    </div>

                    <div className="pipeline-stages-row">
                      <div className="pipeline-stage submitted">
                        <div className="stage-top">
                          <span className="stage-indicator-dot" />
                          <span className="stage-name">Submitted</span>
                        </div>
                        <span className="stage-count">{adminSummary.byStatus['Submitted'] || 0}</span>
                        <span className="stage-desc">Awaiting Review</span>
                      </div>

                      <div className="pipeline-stage review">
                        <div className="stage-top">
                          <span className="stage-indicator-dot" />
                          <span className="stage-name">Under Review</span>
                        </div>
                        <span className="stage-count">{adminSummary.byStatus['Under Review'] || 0}</span>
                        <span className="stage-desc">Officer Assessing</span>
                      </div>

                      <div className="pipeline-stage progress">
                        <div className="stage-top">
                          <span className="stage-indicator-dot" />
                          <span className="stage-name">In Progress</span>
                        </div>
                        <span className="stage-count">{adminSummary.byStatus['In Progress'] || 0}</span>
                        <span className="stage-desc">Field Work Underway</span>
                      </div>

                      <div className="pipeline-stage resolved">
                        <div className="stage-top">
                          <span className="stage-indicator-dot" />
                          <span className="stage-name">Resolved</span>
                        </div>
                        <span className="stage-count">{adminSummary.byStatus['Resolved'] || 0}</span>
                        <span className="stage-desc">Closed with Proof</span>
                      </div>

                      <div className="pipeline-stage rejected">
                        <div className="stage-top">
                          <span className="stage-indicator-dot" />
                          <span className="stage-name">Rejected</span>
                        </div>
                        <span className="stage-count">{adminSummary.byStatus['Rejected'] || 0}</span>
                        <span className="stage-desc">Out of Jurisdiction</span>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Administrator Lower Grid: Issues Table + Issue Map */}
                <div className="operations-grid">
                  <IssuesTable
                    complaints={adminComplaints}
                    role={role}
                    onSelectComplaint={(c) => setSelectedComplaint(c)}
                  />
                  <IssueMap
                    complaints={adminComplaints}
                    onSelectComplaint={(c) => setSelectedComplaint(c)}
                  />
                </div>
              </>
            )
          ) : activeNav === 'my-complaints' && role === 'citizen' ? (
            /* Citizen My Complaints Module */
            <MyComplaintsList
              onSelectComplaint={(complaint) => setSelectedComplaint(complaint)}
              onNavigateReport={() => setActiveNav('report-issue')}
            />
          ) : activeNav === 'report-issue' && role === 'citizen' ? (
            /* Citizen Report Issue Form Module */
            <ReportIssueForm
              onComplaintSubmitted={(complaint) => {
                refreshCitizenData();
                showToast(`Complaint registered: ${complaint.trackingId}`);
              }}
              onCancel={() => setActiveNav('overview')}
            />
          ) : (activeNav === 'assigned-tasks' || activeNav === 'work-orders') && role === 'officer' ? (
            /* Officer Assigned Complaints / Work Orders Module */
            <OfficerComplaintsList
              onSelectComplaint={(complaint) => setSelectedComplaint(complaint)}
              onStatusUpdated={() => refreshOfficerData()}
              defaultStatus={activeNav === 'work-orders' ? 'In Progress' : ''}
            />
          ) : activeNav === 'work-orders' && role === 'admin' ? (
            /* Administrator Complaint Assignment & Dispatch Module */
            <AdminAssignmentView
              onSelectComplaint={(complaint) => setSelectedComplaint(complaint)}
              onComplaintAssigned={() => refreshAdminData()}
            />
          ) : (activeNav === 'team' || activeNav === 'departments') && role === 'admin' ? (
            /* Administrator Officer & Department Workload Oversight Module */
            <OfficerWorkloadView
              onNavigateDispatch={() => setActiveNav('work-orders')}
            />
          ) : activeNav === 'reports' ? (
            /* Reports & CSV Export View */
            <ReportsView />
          ) : activeNav === 'settings' ? (
            /* Role-Aware User Settings & Profile Management View */
            <SettingsView />
          ) : (activeNav === 'city-map' || activeNav === 'ward-map' || activeNav === 'map') ? (
            /* Dedicated Interactive GIS / Geographic Complaint Map View */
            <section className="map-view-module" aria-label="Geographic Complaint Map View">
              <div className="map-view-header">
                <div>
                  <div className="map-breadcrumb-tag">
                    {role === 'citizen' ? 'Citizen Services' : role === 'officer' ? 'Field Operations' : 'Municipal Command'} &bull; GIS Map
                  </div>
                  <h2 className="map-view-title">
                    {role === 'citizen'
                      ? 'City Issue Map & Geotagged Incidents'
                      : role === 'officer'
                      ? 'Field & Ward Map Operations'
                      : 'Municipal Geographic Command Center'}
                  </h2>
                  <p className="map-view-subtitle">
                    {role === 'citizen'
                      ? 'Interactive geographic visualization of your submitted civic complaints with verified GPS coordinates and live resolution statuses.'
                      : role === 'officer'
                      ? 'Geographic view of assigned field complaints in your department jurisdiction with verified GPS coordinates.'
                      : 'City-wide geographic map of reported civic issues across all municipal departments and wards.'}
                  </p>
                </div>
                <div className="map-view-actions">
                  {role === 'citizen' && (
                    <button
                      type="button"
                      className="card-btn blue-solid"
                      onClick={() => setActiveNav('report-issue')}
                    >
                      + Report Issue
                    </button>
                  )}
                  <button
                    type="button"
                    className="card-btn ghost-btn"
                    onClick={() => {
                      if (role === 'citizen') refreshCitizenData();
                      else if (role === 'officer') refreshOfficerData();
                      else if (role === 'admin') refreshAdminData();
                    }}
                    title="Refresh complaint coordinates from database"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                  <button
                    type="button"
                    className="card-btn ghost-btn"
                    onClick={() => setActiveNav('overview')}
                  >
                    &larr; Overview
                  </button>
                </div>
              </div>

              <IssueMap
                complaints={role === 'citizen' ? citizenComplaints : role === 'officer' ? officerComplaints : adminComplaints}
                loading={mapLoading}
                error={mapError}
                onRetry={() => {
                  if (role === 'citizen') refreshCitizenData();
                  else if (role === 'officer') refreshOfficerData();
                  else if (role === 'admin') refreshAdminData();
                }}
                role={role}
                isFullPage={true}
                onSelectComplaint={(c) => setSelectedComplaint(c)}
                onNavigateReport={() => setActiveNav('report-issue')}
              />
            </section>
          ) : (
            /* Explanatory Empty State for Other Navigation Sections */
            <section className="section-placeholder-card">
              <div className="placeholder-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </div>
              <h2 className="placeholder-title">
                {activeNav.replace(/-/g, ' ').toUpperCase()} Module
              </h2>
              <p className="placeholder-desc">
                {role === 'officer'
                  ? 'Ward map GIS integrations and additional field telemetry are scheduled for upcoming phases.'
                  : 'This section will connect to authenticated database endpoints in future steps. No fabricated or mock records are presented.'}
              </p>
              <button
                type="button"
                className="card-btn amber-solid"
                onClick={() => setActiveNav('overview')}
              >
                Return to Overview
              </button>
            </section>
          )}
        </main>

        {/* Global Footer */}
        <footer className="app-footer">
          <span>CivicTrack &copy; 2026 &bull; Signed in as <strong>{user?.name || 'User'}</strong> ({role ? role.toUpperCase() : 'USER'})</span>
          <span className="footer-status-pill">
            Verified Database Records:{' '}
            {role === 'citizen'
              ? `${citizenSummary.total} Complaint${citizenSummary.total === 1 ? '' : 's'}`
              : role === 'officer'
              ? `${officerSummary.totalAssigned} Assigned Task${officerSummary.totalAssigned === 1 ? '' : 's'}`
              : role === 'admin'
              ? `${adminSummary.total} Total Complaint${adminSummary.total === 1 ? '' : 's'}`
              : '0 Complaints'}
          </span>
        </footer>
      </div>

      {/* Complaint Detail & Tracking Modal */}
      <ComplaintDetailModal
        complaint={selectedComplaint}
        onClose={() => setSelectedComplaint(null)}
        onComplaintUpdated={handleComplaintUpdated}
      />

      {/* Floating Toast Notification */}
      <Toast
        message={toast.message}
        visible={toast.visible}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </div>
  );
}
