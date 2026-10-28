import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchEvidenceBlob } from '../services/api';

export default function ComplaintDetailModal({ complaint, onClose }) {
  const { token } = useAuth();
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(null);

  const complaintId = complaint?.id || complaint?._id;
  const hasEvidence = Boolean(complaint?.evidence || complaint?.hasEvidence);

  useEffect(() => {
    if (!complaint) return;
    let active = true;
    let createdUrl = null;

    if (hasEvidence && complaintId && token) {
      setPhotoLoading(true);
      setPhotoError(null);

      fetchEvidenceBlob(token, complaintId)
        .then((blob) => {
          if (!active) return;
          if (blob) {
            createdUrl = URL.createObjectURL(blob);
            setPhotoUrl(createdUrl);
          } else {
            setPhotoError('Unable to load evidence photograph.');
          }
          setPhotoLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setPhotoError(err.message || 'Evidence photo could not be retrieved.');
          setPhotoLoading(false);
        });
    }

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [complaintId, hasEvidence, token]);
  
  if (!complaint) return null;

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(dateString));
    } catch (e) {
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

  const getPriorityClass = (priority) => {
    switch (priority) {
      case 'Urgent':
        return 'priority-urgent';
      case 'High':
        return 'priority-high';
      case 'Medium':
        return 'priority-medium';
      case 'Low':
        return 'priority-low';
      default:
        return 'priority-medium';
    }
  };

  const getExifBadgeClass = (status) => {
    switch (status) {
      case 'matched':
        return 'exif-badge-matched';
      case 'mismatch':
        return 'exif-badge-mismatch';
      case 'no_exif_gps':
        return 'exif-badge-no-gps';
      default:
        return 'exif-badge-neutral';
    }
  };

  const getExifLabel = (status) => {
    switch (status) {
      case 'matched':
        return 'EXIF GPS Matched (≤ 200m)';
      case 'mismatch':
        return 'EXIF GPS Location Mismatch';
      case 'no_exif_gps':
        return 'No Embedded EXIF GPS';
      default:
        return 'EXIF Not Applicable';
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-complaint-title">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="tracking-badge-pill">{complaint.trackingId}</span>
            <span className={`status-pill ${getStatusClass(complaint.status)}`}>
              {complaint.status}
            </span>
            <span className={`priority-pill ${getPriorityClass(complaint.priority)}`}>
              Priority: {complaint.priority}
            </span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close complaint details"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          <div className="detail-section">
            <span className="detail-category-tag">{complaint.category}</span>
            <h2 id="modal-complaint-title" className="detail-title">{complaint.title}</h2>
            <div className="detail-meta-row">
              <span>Submitted: <strong>{formatDate(complaint.createdAt)}</strong></span>
              {complaint.updatedAt && complaint.updatedAt !== complaint.createdAt && (
                <span>&bull; Last Updated: <strong>{formatDate(complaint.updatedAt)}</strong></span>
              )}
            </div>
          </div>

          <div className="detail-section">
            <h3 className="section-subtitle">Issue Description</h3>
            <p className="detail-description-text">{complaint.description}</p>
          </div>

          <div className="detail-section">
            <h3 className="section-subtitle">Reported Location</h3>
            <div className="location-info-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <div>
                <div className="location-address">{complaint.location?.address || 'Location description not specified'}</div>
                {complaint.location?.latitude !== null && complaint.location?.longitude !== null && (
                  <div className="location-coords">
                    GPS Coordinates: {complaint.location.latitude}, {complaint.location.longitude}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Step 8: Photographic Evidence Review Section */}
          <div className="detail-section">
            <h3 className="section-subtitle">Photographic Evidence Review</h3>
            {hasEvidence ? (
              <div className="evidence-detail-container">
                <div className="evidence-photo-panel">
                  {photoLoading ? (
                    <div className="evidence-photo-loading">
                      <div className="spinner-dot" />
                      <span>Loading authenticated evidence photograph...</span>
                    </div>
                  ) : photoError ? (
                    <div className="evidence-photo-error">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{photoError}</span>
                    </div>
                  ) : photoUrl ? (
                    <div className="evidence-photo-wrapper">
                      <img
                        src={photoUrl}
                        alt={`Evidence for complaint ${complaint.trackingId}`}
                        className="evidence-modal-image"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="evidence-metadata-card">
                  <div className="evidence-meta-header">
                    <span className="evidence-tag">On-Site Evidence Record</span>
                    {complaint.evidence?.exifComparisonStatus && (
                      <span className={`exif-status-pill ${getExifBadgeClass(complaint.evidence.exifComparisonStatus)}`}>
                        {getExifLabel(complaint.evidence.exifComparisonStatus)}
                      </span>
                    )}
                  </div>

                  <div className="evidence-meta-rows">
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">File:</span>
                      <span className="evidence-meta-value">{complaint.evidence?.originalName || 'photo-evidence.jpg'}</span>
                    </div>
                    {complaint.evidence?.sizeBytes && (
                      <div className="evidence-meta-row">
                        <span className="evidence-meta-label">Size:</span>
                        <span className="evidence-meta-value">{(complaint.evidence.sizeBytes / 1024).toFixed(1)} KB ({complaint.evidence.mimeType || 'image/jpeg'})</span>
                      </div>
                    )}
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">Captured:</span>
                      <span className="evidence-meta-value">{formatDate(complaint.evidence?.capturedAt)}</span>
                    </div>
                    {complaint.evidence?.coordinates && (
                      <div className="evidence-meta-row">
                        <span className="evidence-meta-label">Evidence GPS:</span>
                        <span className="evidence-meta-value">
                          {complaint.evidence.coordinates.latitude}, {complaint.evidence.coordinates.longitude}
                          {complaint.evidence.coordinates.accuracyMeters ? ` (±${complaint.evidence.coordinates.accuracyMeters}m)` : ''}
                        </span>
                      </div>
                    )}
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">Location Source:</span>
                      <span className="evidence-meta-value source-tag">
                        {complaint.evidence?.locationSource === 'device_gps'
                          ? 'Device GPS (Camera Workflow)'
                          : complaint.evidence?.locationSource === 'user_confirmed'
                          ? 'Citizen-Confirmed Issue Location'
                          : complaint.evidence?.locationSource === 'exif'
                          ? 'Embedded EXIF GPS'
                          : complaint.evidence?.locationSource || 'Not Specified'}
                      </span>
                    </div>
                    {complaint.evidence?.verificationReason && (
                      <div className="evidence-verification-note">
                        <span className="verification-label">Verification Note:</span>
                        <span className="verification-text">{complaint.evidence.verificationReason}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="evidence-empty-note">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>No photographic evidence was attached to this historical complaint.</span>
              </div>
            )}
          </div>

          {/* Assignment Information */}
          <div className="detail-section">
            <h3 className="section-subtitle">Department & Assignment</h3>
            <div className="assignment-info-box">
              {complaint.assignedOfficer ? (
                <div>
                  <div className="assignment-officer-name">
                    Assigned Officer: <strong>{complaint.assignedOfficer.name}</strong>
                  </div>
                  <div className="assignment-officer-meta">
                    Department: <strong>{complaint.department || complaint.assignedOfficer.department || 'Municipal Operations'}</strong>
                    {complaint.assignedOfficer.email && <span> &bull; {complaint.assignedOfficer.email}</span>}
                  </div>
                </div>
              ) : (
                <div className="assignment-unassigned-note">
                  <span>Status: <strong>Unassigned</strong> &bull; Pending municipal triage & dispatch</span>
                </div>
              )}
            </div>
          </div>

          {/* Resolution Notes (if resolved) */}
          {complaint.resolutionNotes && (
            <div className="detail-section">
              <h3 className="section-subtitle">Official Resolution Notes</h3>
              <div className="resolution-notes-box">
                <div className="resolution-notes-header">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>Verified Resolution Record {complaint.resolvedAt ? `&bull; ${formatDate(complaint.resolvedAt)}` : ''}</span>
                </div>
                <p className="resolution-notes-content">{complaint.resolutionNotes}</p>
              </div>
            </div>
          )}

          {/* Status History Timeline */}
          <div className="detail-section">
            <h3 className="section-subtitle">Resolution Status History</h3>
            {Array.isArray(complaint.statusHistory) && complaint.statusHistory.length > 0 ? (
              <div className="status-timeline">
                {complaint.statusHistory.map((step, idx) => (
                  <div key={step._id || idx} className="timeline-item">
                    <div className="timeline-bullet-wrapper">
                      <div className={`timeline-bullet ${getStatusClass(step.status)}`} />
                      {idx < complaint.statusHistory.length - 1 && <div className="timeline-line" />}
                    </div>
                    <div className="timeline-content">
                      <div className="timeline-header">
                        <span className={`status-pill ${getStatusClass(step.status)}`}>
                          {step.status}
                        </span>
                        {step.actorRole && (
                          <span className="timeline-actor-pill">
                            {step.actorRole === 'admin' ? 'Admin' : step.actorRole === 'officer' ? 'Officer' : step.actorRole === 'citizen' ? 'Citizen' : 'System'}
                          </span>
                        )}
                        <span className="timeline-date">{formatDate(step.timestamp)}</span>
                      </div>
                      {step.comment && (
                        <p className="timeline-comment">{step.comment}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="detail-description-text text-muted">Initial submission recorded.</p>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <span className="footer-disclaimer">Verified citizen record from MongoDB collection</span>
          <button type="button" className="card-btn secondary-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
