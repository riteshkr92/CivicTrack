import React, { useState, useEffect, useCallback } from 'react';
import { checkBackendHealth, API_BASE_URL } from '../services/api';

export default function BackendStatus() {
  const [healthState, setHealthState] = useState({
    loading: true,
    healthy: false,
    dbConnected: false,
    httpStatus: null,
    data: null,
    errorMessage: null,
    lastChecked: null
  });

  const fetchHealth = useCallback(async (signal) => {
    setHealthState((prev) => ({ ...prev, loading: true }));

    const result = await checkBackendHealth(signal);

    const now = new Date();
    const isDbConnected = result.data?.services?.database === 'connected';

    setHealthState({
      loading: false,
      healthy: result.ok,
      dbConnected: isDbConnected,
      httpStatus: result.httpStatus,
      data: result.data,
      errorMessage: result.errorMessage,
      lastChecked: now.toLocaleTimeString()
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchHealth]);

  const handleManualRefresh = () => {
    fetchHealth();
  };

  // Determine overall status category: 'loading', 'healthy', 'unhealthy', 'error'
  let statusCategory = 'loading';
  let badgeText = 'Checking connection...';

  if (!healthState.loading) {
    if (healthState.healthy && healthState.dbConnected) {
      statusCategory = 'healthy';
      badgeText = 'Backend Connected — Database Connected';
    } else if (healthState.httpStatus === 503 || (healthState.data && !healthState.dbConnected)) {
      statusCategory = 'unhealthy';
      badgeText = 'Backend Reachable — Database Unavailable';
    } else {
      statusCategory = 'error';
      badgeText = 'Backend Offline / Unreachable';
    }
  }

  return (
    <div className={`backend-status-card status-${statusCategory}`}>
      <div className="status-header">
        <div className="status-indicator-group">
          <div className={`status-badge ${statusCategory}`}>
            <span className={`status-pulse-dot ${statusCategory}`} />
            <span>{badgeText}</span>
          </div>
          <span className="status-title">Live System Health Check</span>
        </div>

        <button
          type="button"
          className={`refresh-btn ${healthState.loading ? 'spinning' : ''}`}
          onClick={handleManualRefresh}
          disabled={healthState.loading}
          title="Query GET /api/health now"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>{healthState.loading ? 'Testing...' : 'Refresh Status'}</span>
        </button>
      </div>

      <div className="status-meta-grid">
        <div className="meta-item">
          <span className="meta-label">Target Endpoint</span>
          <span className="meta-value">{API_BASE_URL}/api/health</span>
        </div>

        <div className="meta-item">
          <span className="meta-label">HTTP Status</span>
          <span className="meta-value">
            {healthState.loading ? 'Pending...' : healthState.httpStatus ? `${healthState.httpStatus} OK` : 'No Response'}
          </span>
        </div>

        <div className="meta-item">
          <span className="meta-label">Database Engine</span>
          <span className="meta-value">
            {healthState.loading
              ? 'Querying...'
              : healthState.dbConnected
              ? 'MongoDB (Connected)'
              : 'MongoDB (Disconnected)'}
          </span>
        </div>

        <div className="meta-item">
          <span className="meta-label">Server Uptime</span>
          <span className="meta-value">
            {healthState.data?.uptime !== undefined
              ? `${Math.floor(healthState.data.uptime)} seconds`
              : 'N/A'}
          </span>
        </div>

        <div className="meta-item">
          <span className="meta-label">Last Checked</span>
          <span className="meta-value">{healthState.lastChecked || 'Initial check'}</span>
        </div>
      </div>

      {healthState.errorMessage && (
        <div className="status-error-tip" role="alert">
          <strong>Connection Issue:</strong> {healthState.errorMessage}. Ensure the Express backend is running on{' '}
          <code>{API_BASE_URL}</code> by executing <code>npm run dev</code> inside the <code>backend/</code> directory.
        </div>
      )}
    </div>
  );
}
