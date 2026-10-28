import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RegisterView() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const { register, isLoading, authError, setAuthError } = useAuth();

  const validate = () => {
    const errors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      errors.name = 'Full name is required.';
    } else if (trimmedName.length < 2 || trimmedName.length > 100) {
      errors.name = 'Name must be between 2 and 100 characters long.';
    }

    if (!trimmedEmail) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'Please provide a valid email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6 || password.length > 128) {
      errors.password = 'Password must be between 6 and 128 characters long.';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
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

    const result = await register(name.trim(), email.trim().toLowerCase(), password);
    if (result.success) {
      setIsSuccess(true);
      setSuccessMessage(result.message || 'Citizen account registered successfully! You may now sign in.');
    }
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

        {isSuccess ? (
          /* Registration Success Screen */
          <div className="auth-success-box" role="status">
            <div className="success-icon-badge" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="success-title">Account Created</h2>
            <p className="success-desc">{successMessage}</p>
            <div className="success-role-badge">
              <span>Assigned Role: </span>
              <strong>Citizen</strong>
            </div>
            <Link to="/login" className="auth-submit-btn link-button">
              Proceed to Sign In
            </Link>
          </div>
        ) : (
          /* Registration Form Screen */
          <>
            <div className="auth-form-header">
              <h2 className="auth-form-title">Citizen Registration</h2>
              <p className="auth-form-desc">Create your citizen account to report and track municipal issues</p>
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

            <form onSubmit={handleSubmit} className="auth-form" noValidate>
              <div className="form-group">
                <label htmlFor="reg-name" className="form-label">
                  Full Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jane Citizen"
                  className={`form-input ${fieldErrors.name ? 'input-error' : ''}`}
                  disabled={isLoading}
                />
                {fieldErrors.name && <span className="field-error-text">{fieldErrors.name}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="reg-email" className="form-label">
                  Email Address
                </label>
                <input
                  id="reg-email"
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
                <label htmlFor="reg-password" className="form-label">
                  Password (min 6 characters)
                </label>
                <input
                  id="reg-password"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a secure password"
                  className={`form-input ${fieldErrors.password ? 'input-error' : ''}`}
                  disabled={isLoading}
                />
                {fieldErrors.password && <span className="field-error-text">{fieldErrors.password}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="reg-confirm-password" className="form-label">
                  Confirm Password
                </label>
                <input
                  id="reg-confirm-password"
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className={`form-input ${fieldErrors.confirmPassword ? 'input-error' : ''}`}
                  disabled={isLoading}
                />
                {fieldErrors.confirmPassword && (
                  <span className="field-error-text">{fieldErrors.confirmPassword}</span>
                )}
              </div>

              <button
                type="submit"
                className="auth-submit-btn"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="btn-spinner-content">
                    <span className="spinner-dot" />
                    Creating Citizen Account...
                  </span>
                ) : (
                  'Register Citizen Account'
                )}
              </button>
            </form>

            {/* Login Prompt */}
            <div className="auth-footer-prompt">
              <span>Already registered? </span>
              <Link to="/login" className="auth-link">
                Sign In
              </Link>
            </div>

            {/* Role Notice */}
            <div className="auth-notice-box">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>Public registration creates Citizen accounts only. Officer and Administrator accounts require authorized provisioning.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
