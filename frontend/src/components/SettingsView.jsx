import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  fetchUserProfile,
  updateUserProfile,
  changePassword,
  fetchNotificationPreferences,
  updateNotificationPreferences,
  uploadAvatar,
  fetchAvatarBlob
} from '../services/api';

export default function SettingsView() {
  const { user, token, role, updateUser } = useAuth();

  // Active Settings Tab
  const [activeTab, setActiveTab] = useState('personal');

  // General Loading & Feedback State
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isSavingPersonal, setIsSavingPersonal] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isSavingNotifs, setIsSavingNotifs] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const [feedback, setFeedback] = useState({ type: null, message: null });

  // 1. Personal Information State
  const [personalForm, setPersonalForm] = useState({
    name: '',
    phone: '',
    address: '',
    email: '',
    currentPasswordForEmail: ''
  });

  const [initialPersonal, setInitialPersonal] = useState({
    name: '',
    phone: '',
    address: '',
    email: ''
  });

  // Avatar State
  const [avatarBlobUrl, setAvatarBlobUrl] = useState(null);
  const [avatarUploadError, setAvatarUploadError] = useState(null);

  // 2. Account Security State
  const [securityForm, setSecurityForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  // 3. Notification Preferences State
  const [notifPreferences, setNotifPreferences] = useState({
    complaintStatusUpdates: true,
    complaintAssignments: true,
    slaWarningsAndBreaches: true,
    resolutionDisputeUpdates: true
  });

  const [initialNotifs, setInitialNotifs] = useState({
    complaintStatusUpdates: true,
    complaintAssignments: true,
    slaWarningsAndBreaches: true,
    resolutionDisputeUpdates: true
  });

  // Clear feedback after 5 seconds
  const setTemporaryFeedback = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev.message === message ? { type: null, message: null } : prev));
    }, 5000);
  };

  // Load Profile and Preferences
  const loadProfileData = useCallback(async () => {
    if (!token) return;
    setIsLoadingProfile(true);

    try {
      const [profileRes, notifRes] = await Promise.all([
        fetchUserProfile(token),
        fetchNotificationPreferences(token)
      ]);

      if (profileRes.ok && profileRes.user) {
        const u = profileRes.user;
        const formData = {
          name: u.name || '',
          phone: u.phone || '',
          address: u.address || '',
          email: u.email || '',
          currentPasswordForEmail: ''
        };
        setPersonalForm(formData);
        setInitialPersonal({
          name: formData.name,
          phone: formData.phone,
          address: formData.address,
          email: formData.email
        });

        // Update auth context user
        if (updateUser) {
          updateUser(u);
        }
      }

      if (notifRes.ok && notifRes.preferences) {
        setNotifPreferences(notifRes.preferences);
        setInitialNotifs(notifRes.preferences);
      }
    } catch (err) {
      setTemporaryFeedback('error', 'Unable to retrieve settings records from server.');
    } finally {
      setIsLoadingProfile(false);
    }
  }, [token, updateUser]);

  // Load profile avatar image blob if configured
  useEffect(() => {
    let active = true;
    let url = null;

    if (user?.avatar && token) {
      fetchAvatarBlob(token).then((blob) => {
        if (!active) return;
        if (blob instanceof Blob) {
          url = URL.createObjectURL(blob);
          setAvatarBlobUrl(url);
        }
      });
    } else {
      setAvatarBlobUrl(null);
    }

    return () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [user?.avatar, token]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  // Dirty state tracking for unsaved changes
  const isPersonalDirty = useMemo(() => {
    return (
      personalForm.name !== initialPersonal.name ||
      personalForm.phone !== initialPersonal.phone ||
      personalForm.address !== initialPersonal.address ||
      personalForm.email !== initialPersonal.email
    );
  }, [personalForm, initialPersonal]);

  const isNotifsDirty = useMemo(() => {
    return (
      notifPreferences.complaintStatusUpdates !== initialNotifs.complaintStatusUpdates ||
      notifPreferences.complaintAssignments !== initialNotifs.complaintAssignments ||
      notifPreferences.slaWarningsAndBreaches !== initialNotifs.slaWarningsAndBreaches ||
      notifPreferences.resolutionDisputeUpdates !== initialNotifs.resolutionDisputeUpdates
    );
  }, [notifPreferences, initialNotifs]);

  // Password Strength Calculation
  const passwordStrength = useMemo(() => {
    const pw = securityForm.newPassword;
    if (!pw) return { score: 0, label: 'None', color: '#94a3b8' };
    let score = 0;
    if (pw.length >= 6) score += 1;
    if (pw.length >= 8) score += 1;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
    if (/\d/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;

    if (score <= 2) return { score, label: 'Weak', color: '#dc2626' };
    if (score <= 3) return { score, label: 'Moderate', color: '#d97706' };
    if (score <= 4) return { score, label: 'Strong', color: '#16a34a' };
    return { score, label: 'Very Strong', color: '#104a9e' };
  }, [securityForm.newPassword]);

  // Tab Switching Guard
  const handleTabChange = (newTab) => {
    if (activeTab === 'personal' && isPersonalDirty) {
      const confirmLeave = window.confirm(
        'You have unsaved changes in Personal Information. Discard changes and switch tabs?'
      );
      if (!confirmLeave) return;
      // Revert personal form
      setPersonalForm({
        ...initialPersonal,
        currentPasswordForEmail: ''
      });
    }
    setActiveTab(newTab);
    setFeedback({ type: null, message: null });
  };

  // Handler: Save Personal Information
  const handleSavePersonal = async (e) => {
    e.preventDefault();
    setFeedback({ type: null, message: null });

    if (!personalForm.name.trim()) {
      setTemporaryFeedback('error', 'Full name is required.');
      return;
    }

    if (personalForm.name.trim().length < 2 || personalForm.name.trim().length > 100) {
      setTemporaryFeedback('error', 'Full name must be between 2 and 100 characters.');
      return;
    }

    // Check email change guard
    const isEmailChanging = personalForm.email.trim().toLowerCase() !== initialPersonal.email.toLowerCase();
    if (isEmailChanging && role === 'admin') {
      setTemporaryFeedback('error', 'The designated administrator account email cannot be altered.');
      return;
    }

    if (isEmailChanging && !personalForm.currentPasswordForEmail) {
      setTemporaryFeedback('error', 'Current password is required to change your account email address.');
      return;
    }

    setIsSavingPersonal(true);

    const payload = {
      name: personalForm.name.trim(),
      phone: personalForm.phone.trim(),
      address: personalForm.address.trim()
    };

    if (isEmailChanging) {
      payload.email = personalForm.email.trim().toLowerCase();
      payload.currentPassword = personalForm.currentPasswordForEmail;
    }

    const res = await updateUserProfile(token, payload);
    setIsSavingPersonal(false);

    if (res.ok && res.user) {
      setInitialPersonal({
        name: res.user.name || '',
        phone: res.user.phone || '',
        address: res.user.address || '',
        email: res.user.email || ''
      });
      setPersonalForm((prev) => ({ ...prev, currentPasswordForEmail: '' }));
      if (updateUser) {
        updateUser(res.user);
      }
      setTemporaryFeedback('success', res.message || 'Profile information saved successfully.');
    } else {
      setTemporaryFeedback('error', res.errorMessage || 'Failed to update personal profile.');
    }
  };

  // Handler: Revert Personal Form
  const handleRevertPersonal = () => {
    setPersonalForm({
      ...initialPersonal,
      currentPasswordForEmail: ''
    });
    setFeedback({ type: null, message: null });
  };

  // Handler: Avatar Upload
  const handleAvatarFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAvatarUploadError('Only JPEG, PNG, or WebP images are permitted for profile avatars.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setAvatarUploadError('Avatar image file size must not exceed 5 MB.');
      return;
    }

    setAvatarUploadError(null);
    setIsUploadingAvatar(true);

    const res = await uploadAvatar(token, file);
    setIsUploadingAvatar(false);

    if (res.ok && res.user) {
      if (updateUser) {
        updateUser(res.user);
      }
      setTemporaryFeedback('success', 'Profile avatar updated successfully.');
    } else {
      setAvatarUploadError(res.errorMessage || 'Failed to upload profile picture.');
    }
  };

  // Handler: Change Password
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setFeedback({ type: null, message: null });

    if (!securityForm.currentPassword) {
      setTemporaryFeedback('error', 'Please enter your current password.');
      return;
    }

    if (!securityForm.newPassword) {
      setTemporaryFeedback('error', 'Please enter a new password.');
      return;
    }

    if (securityForm.newPassword.length < 6) {
      setTemporaryFeedback('error', 'New password must be at least 6 characters long.');
      return;
    }

    if (securityForm.newPassword !== securityForm.confirmPassword) {
      setTemporaryFeedback('error', 'New password and confirm password do not match.');
      return;
    }

    if (securityForm.currentPassword === securityForm.newPassword) {
      setTemporaryFeedback('error', 'New password must be different from current password.');
      return;
    }

    setIsSavingPassword(true);

    const res = await changePassword(token, securityForm);
    setIsSavingPassword(false);

    if (res.ok) {
      setSecurityForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setTemporaryFeedback('success', res.message || 'Password changed successfully.');
    } else {
      setTemporaryFeedback('error', res.errorMessage || 'Password update failed.');
    }
  };

  // Handler: Save Notification Preferences
  const handleSaveNotifications = async () => {
    setIsSavingNotifs(true);
    setFeedback({ type: null, message: null });

    const res = await updateNotificationPreferences(token, notifPreferences);
    setIsSavingNotifs(false);

    if (res.ok && res.preferences) {
      setInitialNotifs(res.preferences);
      setTemporaryFeedback('success', res.message || 'Notification preferences updated successfully.');
    } else {
      setTemporaryFeedback('error', res.errorMessage || 'Failed to update notification preferences.');
    }
  };

  return (
    <div className="settings-view-module" role="region" aria-label="User Settings and Profile Management">
      {/* Settings Top Header Bar */}
      <div className="view-header-bar">
        <div>
          <div className="view-breadcrumb-tag">
            {role === 'citizen' ? 'Citizen Account' : role === 'officer' ? 'Field Officer Portal' : 'System Administration'} &bull; Settings
          </div>
          <h2 className="view-title">Account Settings & Profile Management</h2>
          <p className="view-subtitle">
            Manage your personal profile, account security credentials, in-app notification routing, and verified identity details.
          </p>
        </div>
      </div>

      {/* Global Feedback Banner */}
      {feedback.message && (
        <div
          className={`settings-feedback-banner ${feedback.type === 'success' ? 'success' : 'error'}`}
          role="alert"
          aria-live="polite"
        >
          <span className="feedback-icon" aria-hidden="true">
            {feedback.type === 'success' ? '✓' : '⚠️'}
          </span>
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Settings Main Content Layout: Left Nav Tabs + Right Content Panel */}
      <div className="settings-layout-grid">
        {/* Left Vertical Sub-Navigation Tabs */}
        <aside className="settings-nav-sidebar" aria-label="Settings Categories">
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'personal' ? 'active' : ''}`}
            onClick={() => handleTabChange('personal')}
          >
            <span className="tab-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <div className="tab-text-group">
              <span className="tab-title">Personal Info</span>
              <span className="tab-desc">Name, contact & avatar</span>
            </div>
          </button>

          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => handleTabChange('security')}
          >
            <span className="tab-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <div className="tab-text-group">
              <span className="tab-title">Security & Password</span>
              <span className="tab-desc">Authentication credentials</span>
            </div>
          </button>

          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => handleTabChange('notifications')}
          >
            <span className="tab-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
            <div className="tab-text-group">
              <span className="tab-title">Notifications</span>
              <span className="tab-desc">Status & SLA alert routing</span>
            </div>
          </button>

          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'account' ? 'active' : ''}`}
            onClick={() => handleTabChange('account')}
          >
            <span className="tab-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </span>
            <div className="tab-text-group">
              <span className="tab-title">Account Details</span>
              <span className="tab-desc">Role, IDs & audit trail</span>
            </div>
          </button>
        </aside>

        {/* Right Active Panel Content */}
        <main className="settings-panel-container">
          {/* TAB 1: PERSONAL INFORMATION */}
          {activeTab === 'personal' && (
            <div className="settings-card" role="tabpanel" aria-label="Personal Information">
              <div className="settings-card-header">
                <div>
                  <h3 className="settings-card-title">Personal Profile Information</h3>
                  <p className="settings-card-desc">
                    Update your verified identity and contact preferences across municipal services.
                  </p>
                </div>
                <div className="settings-role-badge">
                  <span>Role: <strong>{role ? role.toUpperCase() : 'USER'}</strong></span>
                </div>
              </div>

              {/* Profile Avatar Management Box */}
              <div className="settings-avatar-row">
                <div className="settings-avatar-preview">
                  {avatarBlobUrl ? (
                    <img src={avatarBlobUrl} alt="User Avatar" className="settings-avatar-img" />
                  ) : (
                    <div className="settings-avatar-initials">
                      {user?.name
                        ? user.name
                            .split(' ')
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((p) => p[0].toUpperCase())
                            .join('')
                        : 'CT'}
                    </div>
                  )}
                </div>
                <div className="settings-avatar-actions">
                  <h4 className="avatar-heading">Profile Photograph</h4>
                  <p className="avatar-desc">
                    JPEG, PNG, or WebP format. Maximum file size 5 MB.
                  </p>
                  <label className="btn-secondary avatar-upload-btn">
                    <span>{isUploadingAvatar ? 'Uploading...' : 'Upload New Photo'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleAvatarFileChange}
                      disabled={isUploadingAvatar}
                      style={{ display: 'none' }}
                    />
                  </label>
                  {avatarUploadError && (
                    <span className="avatar-error-text">{avatarUploadError}</span>
                  )}
                </div>
              </div>

              <form onSubmit={handleSavePersonal} className="settings-form">
                <div className="form-group-grid">
                  {/* Full Name */}
                  <div className="settings-field">
                    <label htmlFor="settings-name" className="settings-label">
                      Full Name <span className="required-star">*</span>
                    </label>
                    <input
                      id="settings-name"
                      type="text"
                      className="settings-input"
                      value={personalForm.name}
                      onChange={(e) => setPersonalForm({ ...personalForm, name: e.target.value })}
                      placeholder="e.g. Jane Doe"
                      required
                      minLength={2}
                      maxLength={100}
                    />
                  </div>

                  {/* Phone Number */}
                  <div className="settings-field">
                    <label htmlFor="settings-phone" className="settings-label">
                      Phone Number
                    </label>
                    <input
                      id="settings-phone"
                      type="tel"
                      className="settings-input"
                      value={personalForm.phone}
                      onChange={(e) => setPersonalForm({ ...personalForm, phone: e.target.value })}
                      placeholder="+1 (555) 000-0000"
                      maxLength={20}
                    />
                  </div>
                </div>

                {/* Email Address */}
                <div className="settings-field">
                  <div className="field-label-group">
                    <label htmlFor="settings-email" className="settings-label">
                      Account Email Address <span className="required-star">*</span>
                    </label>
                    {role === 'admin' && (
                      <span className="admin-invariant-pill">
                        Single Designated Administrator &bull; Immutable
                      </span>
                    )}
                  </div>
                  <input
                    id="settings-email"
                    type="email"
                    className={`settings-input ${role === 'admin' ? 'read-only' : ''}`}
                    value={personalForm.email}
                    onChange={(e) => setPersonalForm({ ...personalForm, email: e.target.value })}
                    placeholder="citizen@civictrack.gov"
                    readOnly={role === 'admin'}
                    required
                  />
                  {role === 'admin' ? (
                    <span className="field-hint">
                      In accordance with CivicTrack security governance, the primary administrator address is strictly immutable.
                    </span>
                  ) : personalForm.email.trim().toLowerCase() !== initialPersonal.email.toLowerCase() ? (
                    <div className="email-change-alert">
                      <label htmlFor="current-pw-email" className="email-pw-label">
                        Enter your current password to authorize email address modification:
                      </label>
                      <input
                        id="current-pw-email"
                        type="password"
                        className="settings-input"
                        placeholder="Current Password"
                        value={personalForm.currentPasswordForEmail}
                        onChange={(e) => setPersonalForm({ ...personalForm, currentPasswordForEmail: e.target.value })}
                        required
                      />
                    </div>
                  ) : null}
                </div>

                {/* Role-Specific Fields */}
                {role === 'citizen' && (
                  <div className="settings-field">
                    <label htmlFor="settings-address" className="settings-label">
                      Residential / Ward Address
                    </label>
                    <textarea
                      id="settings-address"
                      rows={2}
                      className="settings-textarea"
                      value={personalForm.address}
                      onChange={(e) => setPersonalForm({ ...personalForm, address: e.target.value })}
                      placeholder="Street address, ward number, or landmark..."
                      maxLength={250}
                    />
                  </div>
                )}

                {role === 'officer' && (
                  <div className="form-group-grid">
                    <div className="settings-field">
                      <label className="settings-label">Assigned Department</label>
                      <div className="readonly-badge-box">
                        <span>{user?.department || 'Roads & Infrastructure'}</span>
                        <span className="readonly-tag">Administrative Assignment</span>
                      </div>
                    </div>
                    <div className="settings-field">
                      <label className="settings-label">Employee ID</label>
                      <div className="readonly-badge-box">
                        <span>{user?.employeeId || `OFF-${user?.id ? String(user.id).slice(-6).toUpperCase() : '00192'}`}</span>
                        <span className="readonly-tag">Authorized Officer</span>
                      </div>
                    </div>
                  </div>
                )}

                {role === 'admin' && (
                  <div className="admin-governance-box">
                    <div className="admin-badge-icon" aria-hidden="true">🛡️</div>
                    <div>
                      <strong style={{ color: '#104A9E' }}>Designated Municipal Administration</strong>
                      <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748B' }}>
                        You possess primary supervisory clearance over work orders, escalation policies, SLA triage, and municipal officer provisioning.
                      </p>
                    </div>
                  </div>
                )}

                {/* Form Footer Action Buttons */}
                <div className="settings-form-actions">
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isSavingPersonal || !isPersonalDirty}
                  >
                    {isSavingPersonal ? 'Saving Profile...' : 'Save Profile Changes'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleRevertPersonal}
                    disabled={isSavingPersonal || !isPersonalDirty}
                  >
                    Cancel / Revert
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 2: ACCOUNT SECURITY */}
          {activeTab === 'security' && (
            <div className="settings-card" role="tabpanel" aria-label="Account Security">
              <div className="settings-card-header">
                <div>
                  <h3 className="settings-card-title">Account Security & Password</h3>
                  <p className="settings-card-desc">
                    Keep your account secure with a strong password. Passwords are encrypted using bcrypt hashing.
                  </p>
                </div>
              </div>

              <form onSubmit={handleChangePassword} className="settings-form">
                {/* Current Password */}
                <div className="settings-field">
                  <label htmlFor="current-pw" className="settings-label">
                    Current Password <span className="required-star">*</span>
                  </label>
                  <div className="password-input-wrapper">
                    <input
                      id="current-pw"
                      type={showCurrentPw ? 'text' : 'password'}
                      className="settings-input"
                      value={securityForm.currentPassword}
                      onChange={(e) => setSecurityForm({ ...securityForm, currentPassword: e.target.value })}
                      placeholder="Enter current password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowCurrentPw((prev) => !prev)}
                      aria-label={showCurrentPw ? 'Hide password' : 'Show password'}
                    >
                      {showCurrentPw ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div className="settings-field">
                  <label htmlFor="new-pw" className="settings-label">
                    New Password <span className="required-star">*</span>
                  </label>
                  <div className="password-input-wrapper">
                    <input
                      id="new-pw"
                      type={showNewPw ? 'text' : 'password'}
                      className="settings-input"
                      value={securityForm.newPassword}
                      onChange={(e) => setSecurityForm({ ...securityForm, newPassword: e.target.value })}
                      placeholder="Enter new password (min. 6 characters)"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowNewPw((prev) => !prev)}
                      aria-label={showNewPw ? 'Hide password' : 'Show password'}
                    >
                      {showNewPw ? '🙈' : '👁️'}
                    </button>
                  </div>

                  {/* Password Strength Meter */}
                  {securityForm.newPassword && (
                    <div className="password-strength-container">
                      <div className="strength-bar-track">
                        <div
                          className="strength-bar-fill"
                          style={{
                            width: `${Math.min(100, (passwordStrength.score / 5) * 100)}%`,
                            backgroundColor: passwordStrength.color
                          }}
                        />
                      </div>
                      <span className="strength-label" style={{ color: passwordStrength.color }}>
                        Strength: {passwordStrength.label}
                      </span>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="settings-field">
                  <label htmlFor="confirm-pw" className="settings-label">
                    Confirm New Password <span className="required-star">*</span>
                  </label>
                  <div className="password-input-wrapper">
                    <input
                      id="confirm-pw"
                      type={showConfirmPw ? 'text' : 'password'}
                      className="settings-input"
                      value={securityForm.confirmPassword}
                      onChange={(e) => setSecurityForm({ ...securityForm, confirmPassword: e.target.value })}
                      placeholder="Re-enter new password"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowConfirmPw((prev) => !prev)}
                      aria-label={showConfirmPw ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPw ? '🙈' : '👁️'}
                    </button>
                  </div>
                  {securityForm.confirmPassword && securityForm.newPassword !== securityForm.confirmPassword && (
                    <span className="field-error-text">Passwords do not match.</span>
                  )}
                </div>

                <div className="settings-form-actions">
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isSavingPassword || !securityForm.currentPassword || !securityForm.newPassword}
                  >
                    {isSavingPassword ? 'Updating Password...' : 'Change Password'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: NOTIFICATION PREFERENCES */}
          {activeTab === 'notifications' && (
            <div className="settings-card" role="tabpanel" aria-label="Notification Preferences">
              <div className="settings-card-header">
                <div>
                  <h3 className="settings-card-title">In-App Notification Preferences</h3>
                  <p className="settings-card-desc">
                    Control which operational updates, citizen verifications, and SLA alerts generate in-app notifications.
                  </p>
                </div>
              </div>

              <div className="settings-preferences-list">
                {/* 1. Status Updates */}
                <div className="preference-item">
                  <div className="preference-info">
                    <strong className="preference-title">Complaint Status Milestones</strong>
                    <p className="preference-desc">
                      Receive notifications when a complaint status advances (e.g. Under Review, In Progress, Resolved).
                    </p>
                  </div>
                  <label className="switch-toggle" aria-label="Toggle Complaint Status Milestones">
                    <input
                      type="checkbox"
                      checked={notifPreferences.complaintStatusUpdates}
                      onChange={(e) =>
                        setNotifPreferences({
                          ...notifPreferences,
                          complaintStatusUpdates: e.target.checked
                        })
                      }
                    />
                    <span className="slider-round" />
                  </label>
                </div>

                {/* 2. Assignments (Officer/Admin) */}
                <div className="preference-item">
                  <div className="preference-info">
                    <strong className="preference-title">Work Assignments & Officer Dispatch</strong>
                    <p className="preference-desc">
                      Notifications generated when issues are dispatched to departments or reassigned between field officers.
                    </p>
                  </div>
                  <label className="switch-toggle" aria-label="Toggle Work Assignments">
                    <input
                      type="checkbox"
                      checked={notifPreferences.complaintAssignments}
                      onChange={(e) =>
                        setNotifPreferences({
                          ...notifPreferences,
                          complaintAssignments: e.target.checked
                        })
                      }
                    />
                    <span className="slider-round" />
                  </label>
                </div>

                {/* 3. SLA Warnings & Escalations */}
                <div className="preference-item">
                  <div className="preference-info">
                    <strong className="preference-title">SLA Deadlines & Escalation Alerts</strong>
                    <p className="preference-desc">
                      Alerts triggered when municipal resolution deadlines approach (&lt;25% remaining) or exceed target SLA.
                    </p>
                  </div>
                  <label className="switch-toggle" aria-label="Toggle SLA Alerts">
                    <input
                      type="checkbox"
                      checked={notifPreferences.slaWarningsAndBreaches}
                      onChange={(e) =>
                        setNotifPreferences({
                          ...notifPreferences,
                          slaWarningsAndBreaches: e.target.checked
                        })
                      }
                    />
                    <span className="slider-round" />
                  </label>
                </div>

                {/* 4. Resolution Confirmation & Disputes */}
                <div className="preference-item">
                  <div className="preference-info">
                    <strong className="preference-title">Provisional Work & Citizen Dispute Reviews</strong>
                    <p className="preference-desc">
                      Notifications when field work completion evidence is submitted, approved by citizens, or disputed.
                    </p>
                  </div>
                  <label className="switch-toggle" aria-label="Toggle Resolution Reviews">
                    <input
                      type="checkbox"
                      checked={notifPreferences.resolutionDisputeUpdates}
                      onChange={(e) =>
                        setNotifPreferences({
                          ...notifPreferences,
                          resolutionDisputeUpdates: e.target.checked
                        })
                      }
                    />
                    <span className="slider-round" />
                  </label>
                </div>
              </div>

              <div className="settings-form-actions" style={{ marginTop: '24px' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveNotifications}
                  disabled={isSavingNotifs || !isNotifsDirty}
                >
                  {isSavingNotifs ? 'Saving Preferences...' : 'Save Notification Preferences'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: ACCOUNT DETAILS */}
          {activeTab === 'account' && (
            <div className="settings-card" role="tabpanel" aria-label="Account Information">
              <div className="settings-card-header">
                <div>
                  <h3 className="settings-card-title">Account Governance & Details</h3>
                  <p className="settings-card-desc">
                    Verified system credentials, internal identifier records, and authorization telemetry.
                  </p>
                </div>
              </div>

              <div className="account-details-grid">
                <div className="detail-item">
                  <span className="detail-label">System User ID</span>
                  <code className="detail-value-mono">{user?.id || '—'}</code>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Role Classification</span>
                  <span className="detail-role-pill">{role ? role.toUpperCase() : 'USER'}</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Municipal Department</span>
                  <span className="detail-value">{user?.department || (role === 'admin' ? 'All Municipal Departments' : 'Citizen Self-Service')}</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Account Created</span>
                  <span className="detail-value">
                    {user?.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Verified Record'}
                  </span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Authentication Status</span>
                  <span className="detail-status-pill success">JWT Bearer Session Active</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Governance Clearance</span>
                  <span className="detail-value">
                    {role === 'admin'
                      ? 'Executive Administrative Oversight'
                      : role === 'officer'
                      ? 'Field Operations & Resolution Evidence'
                      : 'Citizen Service Requester'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
