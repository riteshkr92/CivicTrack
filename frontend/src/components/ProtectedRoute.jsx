import React from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, isInitializing, role } = useAuth();
  const location = useLocation();

  // If restoring authenticated session on startup/reload, render non-disruptive loading screen
  if (isInitializing) {
    return (
      <div className="auth-loading-screen" role="status" aria-live="polite">
        <div className="spinner-large" aria-hidden="true" />
        <p className="loading-text">Verifying CivicTrack authentication session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login while saving the intended location
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return (
      <div className="access-denied-container">
        <div className="access-denied-card">
          <div className="access-denied-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="access-denied-title">Access Restricted</h2>
          <p className="access-denied-desc">
            Your authenticated role (<strong>{role}</strong>) is not authorized to access this section.
          </p>
          <Link to="/" className="auth-submit-btn link-button">
            Return to Authorized Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return children;
}
