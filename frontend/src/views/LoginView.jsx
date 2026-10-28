import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const { login, isLoading, isInitializing, isAuthenticated, authError, setAuthError } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  // Automatically redirect already-authenticated users to dashboard
  useEffect(() => {
    if (!isInitializing && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isInitializing, isAuthenticated, navigate]);

  const validate = () => {
    const errors = {};
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'Please provide a valid email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);

    if (!validate()) {
      return;
    }

    const result = await login(email.trim().toLowerCase(), password);
    if (result.success) {
      navigate(from, { replace: true });
    }
  };

  const handleFillCredentials = (demoEmail, demoPass) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setFieldErrors({});
    setAuthError(null);
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card">
        {/* Brand Header */}
        <div className="auth-brand-header">
          <div className="auth-brand-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
          </div>
          <h1 className="auth-brand-title">CivicTrack</h1>
          <p className="auth-brand-subtitle">Smart Civic Complaint & Resolution Platform</p>
        </div>

        <div className="auth-form-header">
          <h2 className="auth-form-title">Sign In</h2>
          <p className="auth-form-desc">Access your civic dashboard and operational reports</p>
        </div>

        {/* Server Auth Error Alert */}
        {authError && (
          <div className="auth-alert-error" role="alert">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{authError}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-group">
            <label htmlFor="login-email" className="form-label">
              Email Address
            </label>
            <input
              id="login-email"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className={`form-input ${fieldErrors.email ? 'input-error' : ''}`}
              disabled={isLoading}
            />
            {fieldErrors.email && <span className="field-error-text">{fieldErrors.email}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="login-password" className="form-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className={`form-input ${fieldErrors.password ? 'input-error' : ''}`}
              disabled={isLoading}
            />
            {fieldErrors.password && <span className="field-error-text">{fieldErrors.password}</span>}
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="btn-spinner-content">
                <span className="spinner-dot" />
                Signing In...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Role Testing / Provisioned Accounts Helper - Strictly Guarded for Local Development Only */}
        {import.meta.env.DEV && (
          <div className="auth-role-helpers" aria-label="Provisioned Operational Accounts">
            <div className="role-helpers-header">
              <span className="role-helpers-title">Local Dev Testing (Hidden in Production):</span>
            </div>
            <div className="role-helpers-buttons">
              <button
                type="button"
                className="role-fill-btn citizen"
                onClick={() => handleFillCredentials('citizen@civictrack.gov', 'Citizen@123')}
                title="Fill Citizen account credentials"
              >
                Citizen Portal
              </button>
              <button
                type="button"
                className="role-fill-btn officer"
                onClick={() => handleFillCredentials('officer@civictrack.gov', 'Officer@123')}
                title="Fill Municipal Field Officer credentials"
              >
                Officer Portal
              </button>
              <button
                type="button"
                className="role-fill-btn admin"
                onClick={() => handleFillCredentials('admin@civictrack.gov', 'Admin@123')}
                title="Fill Municipal Administrator credentials"
              >
                Admin Portal
              </button>
            </div>
            <span className="role-helpers-hint">
              Role authorization is strictly verified cryptographically by backend JWT from MongoDB.
            </span>
          </div>
        )}

        {/* Registration Link */}
        <div className="auth-footer-prompt">
          <span>Don't have an account? </span>
          <Link to="/register" className="auth-link">
            Register as Citizen
          </Link>
        </div>

        {/* Security / Architecture Disclosure */}
        <div className="auth-notice-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Verified JWT session with automatic token restoration and backend RBAC enforcement.</span>
        </div>
      </div>
    </div>
  );
}
