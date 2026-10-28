import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead
} from '../services/api';

export default function Header({ onToggleSidebar, onSelectComplaint }) {
  const { user, token, logout } = useAuth();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const notificationMenuRef = useRef(null);

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchNotifications(token);
      if (res.ok) {
        setNotifications(res.notifications || []);
        setUnreadCount(res.unreadCount || 0);
      }
    } catch (e) {
      console.warn('Error fetching notifications:', e.message);
    }
  }, [token]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000); // 30s polling
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (notificationMenuRef.current && !notificationMenuRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    };
    if (notificationsOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [notificationsOpen]);

  const handleMarkAllRead = async () => {
    if (!token) return;
    try {
      const res = await markAllNotificationsRead(token);
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
      }
    } catch (e) {
      console.warn('Error marking all as read:', e.message);
    }
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.isRead && token) {
      markNotificationRead(token, notif._id).catch(() => {});
      setNotifications((prev) =>
        prev.map((n) => (n._id === notif._id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    setNotificationsOpen(false);
    if (onSelectComplaint && notif.complaint) {
      onSelectComplaint(notif.complaint);
    }
  };

  // Format current date matching the reference design format: "Saturday, April 25"
  const formattedDate = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    }).format(new Date());
  }, []);

  // Derive display initials and name from authenticated profile
  const displayName = user?.name || 'Authenticated User';
  const displayRole = user?.role ? user.role.toUpperCase() : 'USER';
  const displayInitials = user?.name
    ? user.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('')
    : 'CT';

  const toggleDropdown = () => setProfileDropdownOpen((prev) => !prev);
  const toggleNotifications = () => setNotificationsOpen((prev) => !prev);
  const handleLogout = () => {
    setProfileDropdownOpen(false);
    logout();
  };

  return (
    <header className="header">
      <div className="header-left">
        <button
          type="button"
          className="mobile-toggle-btn"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div>
          <h1 className="page-title">
            {user?.role === 'citizen'
              ? 'Citizen Portal'
              : user?.role === 'officer'
              ? 'Municipal Officer Portal'
              : 'Operations Center'}
          </h1>
          <p className="page-subtitle">
            {user?.role === 'citizen'
              ? 'Report and track civic infrastructure complaints'
              : user?.role === 'officer'
              ? 'Department queue, field tasks, and resolution verification'
              : 'Civic complaint tracking and municipal operations oversight'}
          </p>
        </div>
      </div>

      <div className="header-right">
        {/* Date Display Pill */}
        <div className="date-pill" title="Current Operational Date">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{formattedDate}</span>
        </div>

        {/* Real In-App Notifications Icon & Dropdown Panel */}
        <div className="notifications-menu-wrapper" ref={notificationMenuRef}>
          <button
            type="button"
            className={`icon-btn-badge ${unreadCount > 0 ? 'has-unread' : ''}`}
            onClick={toggleNotifications}
            title={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
            aria-label={`Notifications (${unreadCount} unread)`}
            aria-expanded={notificationsOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="notification-counter-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>

          {notificationsOpen && (
            <div className="notifications-dropdown-card" role="dialog" aria-label="Notifications Panel">
              <div className="notifications-card-header">
                <div className="notifications-header-title">
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <span className="unread-count-chip">{unreadCount} new</span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="mark-all-read-btn"
                    onClick={handleMarkAllRead}
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="notifications-list" role="list">
                {notifications.length === 0 ? (
                  <div className="notifications-empty">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    <p>No notifications yet</p>
                    <span>Status updates, assignments, and resolution proof alerts will appear here.</span>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif._id}
                      className={`notification-item ${!notif.isRead ? 'unread' : ''}`}
                      role="listitem"
                      onClick={() => handleNotificationClick(notif)}
                    >
                      <div className="notif-indicator-col">
                        {!notif.isRead && <span className="unread-dot" />}
                      </div>
                      <div className="notif-body">
                        <div className="notif-title-row">
                          <span className="notif-title">{notif.title}</span>
                          {notif.trackingId && (
                            <span className="notif-tracking-pill">{notif.trackingId}</span>
                          )}
                        </div>
                        <p className="notif-message">{notif.message}</p>
                        <span className="notif-time">
                          {new Intl.DateTimeFormat('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          }).format(new Date(notif.createdAt))}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Real User Profile Pill with Logout Menu */}
        <div className="profile-menu-wrapper">
          <button
            type="button"
            className="user-profile-pill"
            onClick={toggleDropdown}
            aria-expanded={profileDropdownOpen}
            aria-haspopup="true"
            aria-label="User profile and session options"
          >
            <div className="avatar" aria-hidden="true">
              <span>{displayInitials}</span>
            </div>
            <div className="user-info">
              <span className="user-name">{displayName}</span>
              <span className="user-role">{displayRole}</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {profileDropdownOpen && (
            <div className="profile-dropdown-menu" role="menu">
              <div className="dropdown-user-header">
                <div className="dropdown-name">{displayName}</div>
                <div className="dropdown-email">{user?.email}</div>
                <div className="dropdown-role-tag">Role: {user?.role}</div>
              </div>
              <div className="dropdown-divider" />
              <button
                type="button"
                className="dropdown-logout-btn"
                onClick={handleLogout}
                role="menuitem"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
