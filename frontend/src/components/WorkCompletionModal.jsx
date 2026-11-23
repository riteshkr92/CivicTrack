import React, { useState, useEffect } from 'react';
import { submitWorkCompletion } from '../services/api';

export default function WorkCompletionModal({ complaint, token, onClose, onCompleted }) {
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [latitude, setLatitude] = useState(
    complaint?.location?.latitude !== null && complaint?.location?.latitude !== undefined
      ? String(complaint.location.latitude)
      : ''
  );
  const [longitude, setLongitude] = useState(
    complaint?.location?.longitude !== null && complaint?.location?.longitude !== undefined
      ? String(complaint.location.longitude)
      : ''
  );
  const [accuracy, setAccuracy] = useState('10');
  const [isLocating, setIsLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successResult, setSuccessResult] = useState(null);

  // Cleanup photo preview URL on unmount
  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  if (!complaint) return null;

  const handleFileChange = (e) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setErrorMessage('Please select a valid image file (JPEG, PNG, or WebP).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('Photograph size exceeds 10 MB limit.');
      return;
    }

    setPhotoFile(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleGetCurrentLocation = () => {
    setErrorMessage(null);
    if (!navigator.geolocation) {
      setLocationStatus({ type: 'error', message: 'Geolocation is not supported by your browser.' });
      return;
    }

    setIsLocating(true);
    setLocationStatus({ type: 'info', message: 'Acquiring device GPS coordinates...' });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        const acc = Math.round(pos.coords.accuracy || 10);

        setLatitude(String(lat));
        setLongitude(String(lng));
        setAccuracy(String(acc));
        setLocationStatus({
          type: 'success',
          message: `GPS acquired: ${lat}, ${lng} (Accuracy: ±${acc}m)`
        });
      },
      (err) => {
        setIsLocating(false);
        setLocationStatus({
          type: 'error',
          message: `GPS acquisition failed: ${err.message}. You can manually confirm coordinates.`
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessResult(null);

    if (!photoFile) {
      setErrorMessage('A completion photograph is mandatory to verify field repairs.');
      return;
    }

    if (!resolutionNotes || resolutionNotes.trim().length < 10) {
      setErrorMessage('Resolution notes are required (minimum 10 characters).');
      return;
    }

    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      setErrorMessage('Please provide a valid latitude between -90 and 90.');
      return;
    }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      setErrorMessage('Please provide a valid longitude between -180 and 180.');
      return;
    }

    const accNum = parseFloat(accuracy);
    if (isNaN(accNum) || accNum <= 0 || accNum > 100) {
      setErrorMessage('GPS accuracy must be a positive number under 100 metres.');
      return;
    }

    setIsSubmitting(true);
    const res = await submitWorkCompletion(token, complaint.id || complaint._id, {
      photoFile,
      resolutionNotes: resolutionNotes.trim(),
      latitude: latNum,
      longitude: lngNum,
      accuracy: accNum,
      capturedAt: new Date().toISOString()
    });
    setIsSubmitting(false);

    if (res.ok) {
      setSuccessResult({
        message: 'Work completion evidence verified successfully! Complaint moved to Provisionally Resolved.',
        verification: res.verification
      });
      if (onCompleted) {
        onCompleted(res.complaint);
      }
      setTimeout(() => {
        onClose();
      }, 1600);
    } else {
      setErrorMessage(res.errorMessage || 'Failed to submit work completion.');
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-modal-title"
    >
      <div
        className="modal-card work-completion-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="tracking-badge-pill">{complaint.trackingId}</span>
            <span className="status-pill status-progress">
              In Progress &rarr; Provisionally Resolved
            </span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close work completion modal"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Form with Scrollable Body */}
        <form onSubmit={handleSubmit} className="work-completion-form">
          <div className="modal-body work-completion-modal-body">
            {/* Section 1: Intro Notice */}
            <div className="completion-intro-card">
              <div className="completion-intro-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <div className="completion-intro-text">
                <h3 id="completion-modal-title" className="completion-modal-title">
                  Submit Geo-Verified Work Completion
                </h3>
                <p className="completion-modal-desc">
                  Municipal protocol requires photographic evidence and device GPS coordinates to verify physical remediation within the 200m tolerance threshold before advancing to citizen confirmation.
                </p>
              </div>
            </div>

            {errorMessage && (
              <div className="auth-alert-error" role="alert">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{errorMessage}</span>
              </div>
            )}

            {successResult && (
              <div className="auth-alert-success" role="alert">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <div>
                  <div>{successResult.message}</div>
                  {successResult.verification && (
                    <div className="completion-verification-meta">
                      Distance: <strong>{successResult.verification.distanceMeters ?? '—'}m</strong> &bull; EXIF: <strong>{successResult.verification.exifComparisonStatus}</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Section 2: Completion Photograph Upload */}
            <div className="completion-section">
              <label className="completion-section-label" htmlFor="completion-photo-input">
                1. Completion Photograph <span className="required-star">* Mandatory</span>
              </label>
              <div className={`completion-upload-card ${photoPreview ? 'has-preview' : ''}`}>
                <input
                  id="completion-photo-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  disabled={isSubmitting}
                  className="completion-file-input"
                />
                {!photoPreview ? (
                  <label htmlFor="completion-photo-input" className="completion-dropzone-prompt">
                    <div className="dropzone-icon" aria-hidden="true">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </div>
                    <span className="dropzone-main-text">Click to browse or drop completed work photo</span>
                    <span className="dropzone-sub-text">JPEG, PNG, or WebP &bull; Max 10 MB &bull; Embedded GPS preferred</span>
                  </label>
                ) : (
                  <div className="completion-preview-layout">
                    <img
                      src={photoPreview}
                      alt="Completion preview"
                      className="completion-preview-thumbnail"
                    />
                    <div className="completion-preview-meta">
                      <span className="preview-name">{photoFile?.name}</span>
                      <span className="preview-size">
                        {(photoFile?.size / 1024).toFixed(1)} KB &bull; {photoFile?.type}
                      </span>
                      <button
                        type="button"
                        className="change-photo-btn"
                        onClick={() => {
                          setPhotoFile(null);
                          if (photoPreview) URL.revokeObjectURL(photoPreview);
                          setPhotoPreview(null);
                        }}
                        disabled={isSubmitting}
                      >
                        Replace Photograph
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Section 3 & 4: Field GPS Geofence Verification */}
            <div className="completion-section completion-gps-box">
              <div className="gps-section-header">
                <div>
                  <label className="completion-section-label">
                    2. Field Geolocation Verification <span className="required-star">* 200m Tolerance</span>
                  </label>
                  <span className="gps-section-sub">
                    Device coordinates verify your presence at the reported site
                  </span>
                </div>
                <button
                  type="button"
                  className="card-btn secondary-btn gps-action-btn"
                  onClick={handleGetCurrentLocation}
                  disabled={isLocating || isSubmitting}
                >
                  {isLocating ? 'Acquiring GPS...' : '📍 Use Current GPS'}
                </button>
              </div>

              {locationStatus && (
                <div className={`gps-feedback-pill ${locationStatus.type}`}>
                  <span>{locationStatus.message}</span>
                </div>
              )}

              <div className="gps-inputs-row">
                <div className="gps-input-group">
                  <label className="gps-input-label" htmlFor="comp-lat">Latitude</label>
                  <input
                    id="comp-lat"
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    required
                    disabled={isSubmitting}
                    className="form-control-input"
                    placeholder="e.g. 12.971598"
                  />
                </div>
                <div className="gps-input-group">
                  <label className="gps-input-label" htmlFor="comp-lng">Longitude</label>
                  <input
                    id="comp-lng"
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    required
                    disabled={isSubmitting}
                    className="form-control-input"
                    placeholder="e.g. 77.594562"
                  />
                </div>
                <div className="gps-input-group">
                  <label className="gps-input-label" htmlFor="comp-acc">Accuracy (±m)</label>
                  <input
                    id="comp-acc"
                    type="number"
                    step="any"
                    value={accuracy}
                    onChange={(e) => setAccuracy(e.target.value)}
                    required
                    disabled={isSubmitting}
                    className="form-control-input"
                    placeholder="e.g. 10"
                  />
                </div>
              </div>
            </div>

            {/* Section 5: Resolution Summary Textarea */}
            <div className="completion-section">
              <label className="completion-section-label" htmlFor="comp-notes">
                3. Work Completion Summary <span className="required-star">* Min 10 characters</span>
              </label>
              <textarea
                id="comp-notes"
                className="form-control-textarea"
                placeholder="Detail the physical remediation completed, materials utilized, and site restoration..."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                maxLength={2000}
                required
                rows={3}
                disabled={isSubmitting}
              />
              <div className="completion-char-counter">
                <span>{resolutionNotes.trim().length} / 2000 characters (min. 10 required)</span>
              </div>
            </div>
          </div>

          {/* Section 6: Action Footer */}
          <div className="modal-footer work-completion-modal-footer">
            <button
              type="button"
              className="card-btn secondary-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="card-btn btn-success-action"
              disabled={isSubmitting || !photoFile || resolutionNotes.trim().length < 10}
            >
              {isSubmitting ? 'Verifying & Submitting...' : '✓ Complete Work & Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
