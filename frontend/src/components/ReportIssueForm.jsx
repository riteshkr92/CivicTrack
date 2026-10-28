import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { submitComplaint, getAiAssistance } from '../services/api';

const CATEGORIES = [
  'Pothole/Road Damage',
  'Garbage/Waste',
  'Streetlight',
  'Drainage/Waterlogging',
  'Water Supply',
  'Other'
];

export default function ReportIssueForm({ onComplaintSubmitted, onCancel }) {
  const { token } = useAuth();

  // Core Form Fields
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  // Photographic Evidence State
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidencePreview, setEvidencePreview] = useState(null);
  const [evidenceMeta, setEvidenceMeta] = useState(null);
  const [evidenceConfirmed, setEvidenceConfirmed] = useState(false);
  const [photoSource, setPhotoSource] = useState('camera'); // 'camera' | 'file_picker'
  const [isPhotoGeoLoading, setIsPhotoGeoLoading] = useState(false);

  // AI-Assisted Civic Intelligence State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [aiApplied, setAiApplied] = useState(false);

  // Status & Validation State
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [geoNotice, setGeoNotice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeoLoading, setIsGeoLoading] = useState(false);
  const [createdComplaint, setCreatedComplaint] = useState(null);
  const [copiedTrackingId, setCopiedTrackingId] = useState(false);

  // Handle Photo Selection / Capture with distinct provenance
  const handlePhotoChange = (e, source = 'camera') => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setFieldErrors((prev) => ({
        ...prev,
        evidence: 'Photograph exceeds the maximum permitted size of 10MB.'
      }));
      return;
    }

    // Validate MIME
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validMimes.includes(file.type)) {
      setFieldErrors((prev) => ({
        ...prev,
        evidence: 'Only JPEG, PNG, or WebP photographs are permitted.'
      }));
      return;
    }

    setPhotoSource(source);
    setEvidenceFile(file);
    const previewUrl = URL.createObjectURL(file);
    setEvidencePreview(previewUrl);

    const now = new Date().toISOString();
    setEvidenceMeta({
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
      type: file.type,
      capturedAt: now,
      deviceCoords: null,
      accuracy: null,
      source
    });

    setFieldErrors((prev) => {
      const updated = { ...prev };
      delete updated.evidence;
      return updated;
    });

    // If taken via camera workflow, obtain device GPS at time of capture
    if (source === 'camera' && navigator.geolocation) {
      setIsPhotoGeoLoading(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setIsPhotoGeoLoading(false);
          const lat = position.coords.latitude.toFixed(6);
          const lng = position.coords.longitude.toFixed(6);
          const acc = Math.round(position.coords.accuracy);

          setEvidenceMeta((prev) => ({
            ...prev,
            deviceCoords: { latitude: Number(lat), longitude: Number(lng) },
            accuracy: acc
          }));

          // Autofill form coordinates if empty
          if (!latitude) setLatitude(lat);
          if (!longitude) setLongitude(lng);
        },
        (err) => {
          setIsPhotoGeoLoading(false);
          console.warn('Browser camera geolocation notice:', err.message);
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    }
  };

  const handleRemovePhoto = () => {
    if (evidencePreview) {
      URL.revokeObjectURL(evidencePreview);
    }
    setEvidenceFile(null);
    setEvidencePreview(null);
    setEvidenceMeta(null);
    setEvidenceConfirmed(false);
    setPhotoSource('camera');
    setIsPhotoGeoLoading(false);

    // Reset file input elements if mounted
    const cameraInput = document.getElementById('complaint-camera-file');
    const storageInput = document.getElementById('complaint-storage-file');
    if (cameraInput) cameraInput.value = '';
    if (storageInput) storageInput.value = '';
  };

  const validate = () => {
    const errors = {};
    const trimmedTitle = title.trim();
    const trimmedDesc = description.trim();
    const trimmedAddress = address.trim();

    if (!trimmedTitle) {
      errors.title = 'Complaint title is required.';
    } else if (trimmedTitle.length < 3) {
      errors.title = 'Title must be at least 3 characters long.';
    } else if (trimmedTitle.length > 150) {
      errors.title = 'Title cannot exceed 150 characters.';
    }

    if (!trimmedDesc) {
      errors.description = 'Detailed description is required.';
    } else if (trimmedDesc.length < 10) {
      errors.description = 'Description must be at least 10 characters long.';
    } else if (trimmedDesc.length > 2000) {
      errors.description = 'Description cannot exceed 2000 characters.';
    }

    if (!CATEGORIES.includes(category)) {
      errors.category = 'Please select a valid civic complaint category.';
    }

    if (!trimmedAddress) {
      errors.address = 'Location address or landmark is required.';
    } else if (trimmedAddress.length < 3) {
      errors.address = 'Address must be at least 3 characters long.';
    } else if (trimmedAddress.length > 250) {
      errors.address = 'Address cannot exceed 250 characters.';
    }

    // Photographic Evidence is Mandatory per municipal rules
    if (!evidenceFile) {
      errors.evidence = 'Photographic evidence is mandatory for all new civic complaint reports.';
    }

    if (!evidenceConfirmed) {
      errors.evidenceConfirmed = 'You must confirm that this photograph represents the civic issue at the reported location.';
    }

    // Geotagged coordinates are mandatory
    if (latitude === '' || longitude === '') {
      errors.coordinates = 'Geotagged coordinates (latitude & longitude) are mandatory for civic evidence.';
    } else {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.latitude = 'Latitude must be a valid number between -90 and 90.';
      }
      if (isNaN(lng) || lng < -180 || lng > 180) {
        errors.longitude = 'Longitude must be a valid number between -180 and 180.';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      setGeoNotice({
        type: 'warning',
        message: 'Geolocation is not supported by your browser. Please enter coordinates manually.'
      });
      return;
    }

    setIsGeoLoading(true);
    setGeoNotice(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsGeoLoading(false);
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        const acc = Math.round(position.coords.accuracy);
        setLatitude(lat);
        setLongitude(lng);

        if (!address.trim()) {
          setAddress(`GPS Location: ${lat}, ${lng}`);
        }

        setGeoNotice({
          type: 'success',
          message: `Device location acquired: ${lat}, ${lng} (Accuracy: ~${acc}m)`
        });

        setFieldErrors((prev) => {
          const updated = { ...prev };
          delete updated.latitude;
          delete updated.longitude;
          delete updated.coordinates;
          return updated;
        });
      },
      (error) => {
        setIsGeoLoading(false);
        if (error.code === error.PERMISSION_DENIED) {
          setGeoNotice({
            type: 'warning',
            message: 'Location access was denied. You can manually enter the address and coordinates below.'
          });
        } else {
          setGeoNotice({
            type: 'warning',
            message: 'Unable to retrieve device GPS. Please input coordinates or address manually.'
          });
        }
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    // Build FormData for multipart/form-data upload
    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('description', description.trim());
    formData.append('category', category);
    formData.append('address', address.trim());
    formData.append('latitude', latitude);
    formData.append('longitude', longitude);

    if (evidenceFile) {
      formData.append('evidence', evidenceFile);
      formData.append('evidenceLatitude', evidenceMeta?.deviceCoords?.latitude || latitude);
      formData.append('evidenceLongitude', evidenceMeta?.deviceCoords?.longitude || longitude);
      formData.append('evidenceAccuracy', evidenceMeta?.accuracy || 15);
      formData.append('evidenceCapturedAt', evidenceMeta?.capturedAt || new Date().toISOString());
      formData.append('photoSource', photoSource);
      formData.append(
        'evidenceLocationSource',
        photoSource === 'camera' && evidenceMeta?.deviceCoords ? 'device_gps' : 'user_confirmed'
      );
    }

    const res = await submitComplaint(token, formData);
    setIsSubmitting(false);

    if (res.ok) {
      setCreatedComplaint(res.complaint);
      if (onComplaintSubmitted) {
        onComplaintSubmitted(res.complaint);
      }
    } else {
      setServerError(res.errorMessage || 'Failed to submit complaint. Please try again.');
    }
  };

  const handleAnalyzeWithAi = async () => {
    if (!title || title.trim().length < 3) {
      setAiError('Please enter an issue title with at least 3 characters for AI analysis.');
      return;
    }
    setAiLoading(true);
    setAiError(null);

    const coords =
      latitude && longitude && !isNaN(Number(latitude)) && !isNaN(Number(longitude))
        ? { latitude: Number(latitude), longitude: Number(longitude) }
        : null;

    try {
      const res = await getAiAssistance(token, {
        title: title.trim(),
        description: description.trim(),
        category,
        coordinates: coords
      });

      if (res.ok) {
        setAiResult(res);
      } else {
        setAiError(res.errorMessage || 'AI assistance temporarily unavailable.');
      }
    } catch {
      setAiError('Could not reach AI assistance service. Manual submission is unaffected.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiCategory = () => {
    if (aiResult?.categoryRecommendation?.category) {
      setCategory(aiResult.categoryRecommendation.category);
      setAiApplied(true);
      setFieldErrors((prev) => {
        const copy = { ...prev };
        delete copy.category;
        return copy;
      });
    }
  };

  const handleReset = () => {
    setTitle('');
    setCategory(CATEGORIES[0]);
    setDescription('');
    setAddress('');
    setLatitude('');
    setLongitude('');
    handleRemovePhoto();
    setFieldErrors({});
    setServerError(null);
    setGeoNotice(null);
    setCreatedComplaint(null);
    setAiResult(null);
    setAiError(null);
    setAiApplied(false);
    setCopiedTrackingId(false);
  };

  const handleCopyTrackingId = async () => {
    if (createdComplaint?.trackingId) {
      try {
        await navigator.clipboard.writeText(createdComplaint.trackingId);
        setCopiedTrackingId(true);
        setTimeout(() => setCopiedTrackingId(false), 3000);
      } catch {
        // Fallback for clipboard restrictions
      }
    }
  };

  // SUCCESS CONFIRMATION VIEW
  if (createdComplaint) {
    return (
      <div className="complaint-success-card" role="status" aria-live="polite">
        <div className="complaint-success-icon-badge" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <h2 className="complaint-success-title">Complaint Registered Successfully</h2>
        <p className="complaint-success-desc">
          Your issue has been recorded in the municipal database with initial status <strong>Submitted</strong>. Our department dispatch unit has received your report.
        </p>

        {/* Tracking Reference Display with Copy Action */}
        <div className="tracking-ref-box">
          <span className="tracking-ref-label">Official Municipal Tracking ID</span>
          <div className="tracking-ref-code">{createdComplaint.trackingId}</div>
          <button
            type="button"
            className="copy-tracking-btn"
            onClick={handleCopyTrackingId}
            title="Copy tracking ID to clipboard"
          >
            {copiedTrackingId ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copy Tracking Reference</span>
              </>
            )}
          </button>
          <span className="tracking-ref-note">Keep this tracking number to monitor assignment, field updates, and resolution milestones.</span>
        </div>

        {/* Issue Summary Preview */}
        <div className="complaint-summary-preview" aria-label="Summary of submitted complaint">
          <div className="preview-row">
            <span className="preview-label">Title:</span>
            <span className="preview-value">{createdComplaint.title}</span>
          </div>
          <div className="preview-row">
            <span className="preview-label">Category:</span>
            <span className="preview-value">{createdComplaint.category}</span>
          </div>
          <div className="preview-row">
            <span className="preview-label">Location:</span>
            <span className="preview-value">{createdComplaint.location?.address || 'Location registered'}</span>
          </div>
          <div className="preview-row">
            <span className="preview-label">Coordinates:</span>
            <span className="preview-value">
              {createdComplaint.location?.latitude?.toFixed(4)}, {createdComplaint.location?.longitude?.toFixed(4)}
            </span>
          </div>
          <div className="preview-row">
            <span className="preview-label">Current Status:</span>
            <span className="status-pill status-submitted">{createdComplaint.status}</span>
          </div>
          {createdComplaint.hasEvidence && (
            <div className="preview-row">
              <span className="preview-label">Evidence:</span>
              <span className="evidence-chip-indicator" style={{ display: 'inline-flex' }}>
                Photo Evidence Attached
              </span>
            </div>
          )}
        </div>

        <div className="complaint-success-actions">
          <button
            type="button"
            className="card-btn blue-solid"
            onClick={handleReset}
          >
            Report Another Issue
          </button>
          {onCancel && (
            <button
              type="button"
              className="card-btn secondary-btn"
              onClick={onCancel}
            >
              Back to Dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  // ACTIVE FORM VIEW
  return (
    <div className="complaint-form-card">
      {/* Form Header */}
      <div className="complaint-form-header">
        <div className="form-icon-badge" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        </div>
        <div className="form-header-text">
          <div className="form-header-top">
            <h1 className="complaint-form-title">Report a Civic Issue</h1>
            <span className="form-required-legend">
              <span className="required-star">*</span> Required fields
            </span>
          </div>
          <p className="complaint-form-subtitle">
            Submit a verified municipal problem in your neighborhood. An official tracking ID is generated upon submission to monitor resolution milestones and field inspection progress.
          </p>
        </div>
      </div>

      {/* Server-Side Error Alert */}
      {serverError && (
        <div className="auth-alert-error" role="alert" style={{ marginBottom: '20px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <strong>Submission Error:</strong> {serverError}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="complaint-form" noValidate>
        {/* SECTION 1: ISSUE DETAILS & CATEGORIZATION */}
        <section className="form-section-card" aria-labelledby="section-details-heading">
          <div className="form-section-header">
            <span className="form-section-number">1</span>
            <div>
              <h2 id="section-details-heading" className="form-section-title">
                Issue Overview & Description
              </h2>
              <p className="form-section-desc">
                Provide a clear summary and explanation of the civic issue so municipal departments can evaluate severity.
              </p>
            </div>
          </div>

          {/* Title Field */}
          <div className="form-group">
            <label htmlFor="complaint-title" className="form-label">
              Issue Title <span className="required-star" aria-hidden="true">*</span>
            </label>
            <input
              id="complaint-title"
              type="text"
              className={`form-input ${fieldErrors.title ? 'input-error' : ''}`}
              placeholder="e.g. Deep pothole causing hazardous traffic on 4th & Main Street"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (fieldErrors.title) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.title;
                    return next;
                  });
                }
              }}
              disabled={isSubmitting}
              maxLength={150}
              aria-required="true"
              aria-invalid={!!fieldErrors.title}
              aria-describedby={fieldErrors.title ? 'complaint-title-error' : 'complaint-title-helper'}
            />
            {fieldErrors.title && (
              <span id="complaint-title-error" className="field-error-text" role="alert">
                {fieldErrors.title}
              </span>
            )}
            <div id="complaint-title-helper" className="field-helper-line">
              <span className="field-helper-text">Brief, actionable summary of the problem.</span>
              <span className={`char-counter ${title.length > 140 ? 'counter-warning' : ''}`}>
                {title.length} / 150
              </span>
            </div>
          </div>

          {/* Category Dropdown */}
          <div className="form-group">
            <div className="label-with-action">
              <label htmlFor="complaint-category" className="form-label">
                Civic Category <span className="required-star" aria-hidden="true">*</span>
              </label>
              {aiApplied ? (
                <span className="ai-applied-tag" style={{ fontSize: '0.74rem' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  AI Category Applied
                </span>
              ) : aiResult?.categoryRecommendation?.category && category !== aiResult.categoryRecommendation.category ? (
                <button
                  type="button"
                  className="ai-suggestion-chip-btn"
                  onClick={handleApplyAiCategory}
                  title={`Click to set category to ${aiResult.categoryRecommendation.category}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span>Suggested: {aiResult.categoryRecommendation.category} (Apply)</span>
                </button>
              ) : null}
            </div>
            <select
              id="complaint-category"
              className={`form-input select-input ${fieldErrors.category ? 'input-error' : ''}`}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                if (fieldErrors.category) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.category;
                    return next;
                  });
                }
              }}
              disabled={isSubmitting}
              aria-required="true"
              aria-invalid={!!fieldErrors.category}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            {fieldErrors.category && (
              <span className="field-error-text" role="alert">
                {fieldErrors.category}
              </span>
            )}
            <span className="field-helper-text">
              Directs this report to the responsible department (Roads, Sanitation, Lighting, Water).
            </span>
          </div>

          {/* Description Field */}
          <div className="form-group">
            <label htmlFor="complaint-desc" className="form-label">
              Detailed Description <span className="required-star" aria-hidden="true">*</span>
            </label>
            <textarea
              id="complaint-desc"
              rows="4"
              className={`form-input textarea-input ${fieldErrors.description ? 'input-error' : ''}`}
              placeholder="Describe the severity, duration of the issue, safety hazards, nearby landmarks, or special access instructions..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (fieldErrors.description) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.description;
                    return next;
                  });
                }
              }}
              disabled={isSubmitting}
              maxLength={2000}
              aria-required="true"
              aria-invalid={!!fieldErrors.description}
              aria-describedby={fieldErrors.description ? 'complaint-desc-error' : 'complaint-desc-helper'}
            />
            {fieldErrors.description && (
              <span id="complaint-desc-error" className="field-error-text" role="alert">
                {fieldErrors.description}
              </span>
            )}
            <div id="complaint-desc-helper" className="field-helper-line">
              <span className="field-helper-text">Minimum 10 characters required for dispatch evaluation.</span>
              <span className={`char-counter ${description.length > 1900 ? 'counter-warning' : ''}`}>
                {description.length} / 2000
              </span>
            </div>
          </div>
        </section>

        {/* SECTION 2: AI CIVIC INTELLIGENCE ASSISTANT (OPTIONAL) */}
        <section className="form-section-card ai-section-card" aria-labelledby="section-ai-heading">
          <div className="form-section-header">
            <span className="form-section-number ai-number">2</span>
            <div className="form-section-header-grow">
              <div className="section-title-with-badge">
                <h2 id="section-ai-heading" className="form-section-title">
                  AI Civic Intelligence Assistant
                </h2>
                <span className="form-optional-badge">Optional Tool</span>
                {aiResult?.meta?.provider && (
                  <span className={`ai-badge ${aiResult.meta.provider === 'gemini' ? 'ai-badge-gemini' : 'ai-badge-local'}`}>
                    {aiResult.meta.provider === 'gemini' ? 'Gemini 2.5 Flash' : 'Local Civic NLP'}
                  </span>
                )}
              </div>
              <p className="form-section-desc">
                Evaluate text to verify category match, view advisory municipal priority, and detect open duplicate reports nearby.
              </p>
            </div>

            <button
              type="button"
              className="ai-trigger-btn"
              onClick={handleAnalyzeWithAi}
              disabled={isSubmitting || aiLoading || !title || title.trim().length < 3}
              title="Analyze complaint text with AI"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>{aiLoading ? 'Analyzing...' : aiResult ? 'Re-Analyze with AI' : 'Analyze Issue with AI'}</span>
            </button>
          </div>

          {aiError && (
            <div className="auth-alert-error" style={{ marginBottom: '12px', padding: '10px 14px', fontSize: '0.82rem' }} role="alert">
              <span>{aiError}</span>
            </div>
          )}

          {aiResult ? (
            <div className="ai-results-wrapper">
              <div className="ai-recommendations-grid">
                {/* Feature 1: Category Recommendation */}
                <div className="ai-box">
                  <div className="ai-box-title">
                    <span>Suggested Category</span>
                    <span className="ai-confidence-tag">
                      {Math.round((aiResult.categoryRecommendation?.confidence || 0.8) * 100)}% match
                    </span>
                  </div>
                  <div className="ai-value-row">
                    <span className="ai-recommendation-name">
                      {aiResult.categoryRecommendation?.category}
                    </span>
                    {category === aiResult.categoryRecommendation?.category ? (
                      <span className="ai-applied-tag">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Selected
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="ai-apply-btn"
                        onClick={handleApplyAiCategory}
                        title={`Change category to ${aiResult.categoryRecommendation?.category}`}
                      >
                        Apply Suggestion
                      </button>
                    )}
                  </div>
                  <p className="ai-box-reasoning">
                    {aiResult.categoryRecommendation?.reasoning}
                  </p>
                </div>

                {/* Feature 2: Priority Recommendation */}
                <div className="ai-box">
                  <div className="ai-box-title">
                    <span>Recommended Priority</span>
                    <span className="ai-advisory-tag">Advisory</span>
                  </div>
                  <div className="ai-value-row">
                    <span className={`ai-priority-badge ai-priority-${(aiResult.priorityRecommendation?.priority || 'medium').toLowerCase()}`}>
                      {aiResult.priorityRecommendation?.priority} Priority
                    </span>
                  </div>
                  <p className="ai-box-reasoning">
                    {aiResult.priorityRecommendation?.rationale}
                  </p>
                </div>
              </div>

              {/* Feature 3: Potential Duplicate Reports in the Area */}
              {aiResult.potentialDuplicates && aiResult.potentialDuplicates.length > 0 && (
                <div className="ai-duplicates-box">
                  <div className="ai-duplicates-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>
                      Potential Similar Open Complaints Nearby ({aiResult.potentialDuplicates.length}):
                    </span>
                  </div>
                  <div className="ai-duplicates-list">
                    {aiResult.potentialDuplicates.map((dup) => (
                      <div key={dup.id || dup.trackingId} className="ai-duplicate-item">
                        <div className="ai-dup-left">
                          <span className="ai-duplicate-tracking">{dup.trackingId}</span>
                          <span className="ai-dup-title">{dup.title}</span>
                        </div>
                        <div className="ai-dup-right">
                          {dup.approxDistanceMeters !== null && (
                            <span className="ai-dup-distance">
                              ~{dup.approxDistanceMeters}m away
                            </span>
                          )}
                          <span className="ai-duplicate-status">{dup.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="ai-dup-notice">
                    Note: If your report describes an issue listed above, municipal field officers may already be assigned. Submitting will register a distinct case for your account.
                  </p>
                </div>
              )}

              <div className="ai-disclaimer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>
                  AI classifications and priorities are advisory recommendations. Official municipal priority, department dispatch, and resolution schedules are determined by authorized personnel.
                </span>
              </div>
            </div>
          ) : (
            <div className="ai-empty-prompt">
              <p>
                Enter an issue title and description above, then click <strong>Analyze Issue with AI</strong> to receive automated categorization, civic priority evaluation, and duplicate checks.
              </p>
            </div>
          )}
        </section>

        {/* SECTION 3: INCIDENT LOCATION & GEOTAGGED COORDINATES */}
        <section className="form-section-card" aria-labelledby="section-location-heading">
          <div className="form-section-header">
            <span className="form-section-number">3</span>
            <div>
              <h2 id="section-location-heading" className="form-section-title">
                Incident Location & GPS Coordinates
              </h2>
              <p className="form-section-desc">
                Accurate coordinates allow municipal field officers and emergency crews to navigate to the exact site.
              </p>
            </div>
          </div>

          {/* Geolocation Notice Banner */}
          {geoNotice && (
            <div
              className={geoNotice.type === 'success' ? 'auth-alert-success' : 'auth-alert-warning'}
              style={{ marginBottom: '14px', padding: '10px 14px', fontSize: '0.84rem' }}
              role="status"
            >
              <span>{geoNotice.message}</span>
            </div>
          )}

          {/* Address / Landmark Input */}
          <div className="form-group">
            <div className="label-with-action">
              <label htmlFor="complaint-address" className="form-label">
                Street Address or Landmark <span className="required-star" aria-hidden="true">*</span>
              </label>
              <button
                type="button"
                className="detect-geo-btn"
                onClick={handleDetectLocation}
                disabled={isSubmitting || isGeoLoading}
                title="Detect device GPS coordinates using browser geolocation"
              >
                {isGeoLoading ? (
                  <>
                    <span className="spinner-dot" style={{ borderTopColor: '#2563eb' }} />
                    <span>Detecting GPS...</span>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="3 11 22 2 13 21 11 13 3 11" />
                    </svg>
                    <span>Use My Current Location</span>
                  </>
                )}
              </button>
            </div>
            <input
              id="complaint-address"
              type="text"
              className={`form-input ${fieldErrors.address ? 'input-error' : ''}`}
              placeholder="e.g. Near City Center Park Gate 2, Oak Avenue"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (fieldErrors.address) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.address;
                    return next;
                  });
                }
              }}
              disabled={isSubmitting}
              maxLength={250}
              aria-required="true"
              aria-invalid={!!fieldErrors.address}
              aria-describedby={fieldErrors.address ? 'complaint-address-error' : 'complaint-address-helper'}
            />
            {fieldErrors.address && (
              <span id="complaint-address-error" className="field-error-text" role="alert">
                {fieldErrors.address}
              </span>
            )}
            <span id="complaint-address-helper" className="field-helper-text">
              Include specific landmarks, cross streets, or building numbers ({address.length}/250 chars).
            </span>
          </div>

          {/* Geotagged Coordinates Row */}
          <div className="form-row-2col">
            <div className="form-group">
              <label htmlFor="complaint-lat" className="form-label">
                Latitude <span className="required-star" aria-hidden="true">*</span>
              </label>
              <input
                id="complaint-lat"
                type="number"
                step="any"
                className={`form-input ${fieldErrors.latitude || fieldErrors.coordinates ? 'input-error' : ''}`}
                placeholder="e.g. 12.971600"
                value={latitude}
                onChange={(e) => {
                  setLatitude(e.target.value);
                  if (fieldErrors.latitude || fieldErrors.coordinates) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.latitude;
                      delete next.coordinates;
                      return next;
                    });
                  }
                }}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!(fieldErrors.latitude || fieldErrors.coordinates)}
              />
              {fieldErrors.latitude && (
                <span className="field-error-text" role="alert">
                  {fieldErrors.latitude}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="complaint-lng" className="form-label">
                Longitude <span className="required-star" aria-hidden="true">*</span>
              </label>
              <input
                id="complaint-lng"
                type="number"
                step="any"
                className={`form-input ${fieldErrors.longitude || fieldErrors.coordinates ? 'input-error' : ''}`}
                placeholder="e.g. 77.594600"
                value={longitude}
                onChange={(e) => {
                  setLongitude(e.target.value);
                  if (fieldErrors.longitude || fieldErrors.coordinates) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.longitude;
                      delete next.coordinates;
                      return next;
                    });
                  }
                }}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!(fieldErrors.longitude || fieldErrors.coordinates)}
              />
              {fieldErrors.longitude && (
                <span className="field-error-text" role="alert">
                  {fieldErrors.longitude}
                </span>
              )}
            </div>
          </div>
          {fieldErrors.coordinates && (
            <span className="field-error-text" role="alert" style={{ marginTop: '-4px' }}>
              {fieldErrors.coordinates}
            </span>
          )}
          <span className="field-helper-text" style={{ marginTop: '2px' }}>
            Coordinates must be between -90 to +90 (latitude) and -180 to +180 (longitude). Click <strong>Use My Current Location</strong> to autofill automatically.
          </span>
        </section>

        {/* SECTION 4: MANDATORY PHOTOGRAPHIC EVIDENCE */}
        <section className="form-section-card" aria-labelledby="section-evidence-heading">
          <div className="form-section-header">
            <span className="form-section-number">4</span>
            <div>
              <h2 id="section-evidence-heading" className="form-section-title">
                Mandatory Photographic Evidence
              </h2>
              <p className="form-section-desc">
                Municipal policy requires photo verification on-site to eliminate spurious complaints and accelerate crew dispatch.
              </p>
            </div>
          </div>

          {/* Hidden File Inputs */}
          <input
            id="complaint-camera-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => handlePhotoChange(e, 'camera')}
            disabled={isSubmitting}
            style={{ display: 'none' }}
          />
          <input
            id="complaint-storage-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handlePhotoChange(e, 'file_picker')}
            disabled={isSubmitting}
            style={{ display: 'none' }}
          />

          {!evidencePreview ? (
            /* Upload / Capture Selector Dropzone */
            <div className={`evidence-dropzone ${fieldErrors.evidence ? 'dropzone-error' : ''}`}>
              <div className="dropzone-content">
                <div className="dropzone-icon" aria-hidden="true">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
                <div className="dropzone-text">
                  <div className="dropzone-action-buttons">
                    <button
                      type="button"
                      className="card-btn blue-solid"
                      onClick={() => document.getElementById('complaint-camera-file')?.click()}
                      disabled={isSubmitting}
                      title="Open device camera to capture live on-site photograph"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                      <span>Take Live Photo (Camera)</span>
                    </button>
                    <button
                      type="button"
                      className="card-btn secondary-btn"
                      onClick={() => document.getElementById('complaint-storage-file')?.click()}
                      disabled={isSubmitting}
                      title="Choose image file from local device storage"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <span>Upload from Device</span>
                    </button>
                  </div>
                  <span className="dropzone-subtext">
                    Supported formats: JPEG, PNG, or WebP up to 10MB. Camera workflow captures device GPS on shutter; device uploads preserve original image.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Selected Evidence Preview Card */
            <div className="evidence-preview-card">
              <div className="evidence-preview-thumb-container">
                <img
                  src={evidencePreview}
                  alt="Complaint Evidence Preview"
                  className="evidence-preview-img"
                />
              </div>
              <div className="evidence-preview-info">
                <div className="evidence-preview-header">
                  <div className="evidence-name-group">
                    <span className="evidence-file-name" title={evidenceMeta?.name}>
                      {evidenceMeta?.name}
                    </span>
                    <span className={`evidence-provenance-tag ${photoSource === 'camera' ? 'tag-camera' : 'tag-storage'}`}>
                      {photoSource === 'camera' ? 'Live Camera Capture' : 'Device Storage File'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="evidence-remove-btn"
                    onClick={handleRemovePhoto}
                    disabled={isSubmitting}
                    title="Remove and replace attached photograph"
                  >
                    Remove Photo
                  </button>
                </div>
                <div className="evidence-meta-grid">
                  <span className="evidence-meta-item">
                    Size: <strong>{evidenceMeta?.size}</strong>
                  </span>
                  <span className="evidence-meta-item">
                    Format: <strong>{evidenceMeta?.type}</strong>
                  </span>
                  <span className="evidence-meta-item">
                    Provenance: <strong>{photoSource === 'camera' ? 'Device GPS Capture' : 'User-Confirmed Location'}</strong>
                  </span>
                  <span className="evidence-meta-item">
                    Coordinates: <strong>
                      {evidenceMeta?.deviceCoords
                        ? `${evidenceMeta.deviceCoords.latitude}, ${evidenceMeta.deviceCoords.longitude}`
                        : latitude && longitude
                        ? `${latitude}, ${longitude}`
                        : 'Entered above'}
                    </strong>
                  </span>
                </div>
                {isPhotoGeoLoading && (
                  <p className="evidence-storage-notice" style={{ color: '#2563eb', fontWeight: 600 }}>
                    Polling device GPS coordinates for camera photo...
                  </p>
                )}
                {photoSource === 'file_picker' && (
                  <p className="evidence-storage-notice">
                    Note: File uploaded from device storage. Embedded EXIF GPS will be verified on the server if present.
                  </p>
                )}
              </div>
            </div>
          )}
          {fieldErrors.evidence && (
            <span className="field-error-text" role="alert" style={{ marginTop: '6px' }}>
              {fieldErrors.evidence}
            </span>
          )}

          {/* Citizen Photo Authenticity Confirmation Checkbox */}
          <div className="evidence-confirmation-box">
            <label className="checkbox-label" htmlFor="evidence-confirmed-checkbox">
              <input
                id="evidence-confirmed-checkbox"
                type="checkbox"
                checked={evidenceConfirmed}
                onChange={(e) => {
                  setEvidenceConfirmed(e.target.checked);
                  if (e.target.checked) {
                    setFieldErrors((prev) => {
                      const updated = { ...prev };
                      delete updated.evidenceConfirmed;
                      return updated;
                    });
                  }
                }}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={!!fieldErrors.evidenceConfirmed}
              />
              <span className="checkbox-text">
                {photoSource === 'camera'
                  ? 'I confirm this photograph was captured live on-site documenting the civic issue at the reported location.'
                  : 'I confirm that this uploaded photograph is authentic evidence of the civic issue, and that the specified coordinates represent where the issue occurred.'}{' '}
                <span className="required-star" aria-hidden="true">*</span>
              </span>
            </label>
            {fieldErrors.evidenceConfirmed && (
              <span className="field-error-text" role="alert" style={{ display: 'block', marginTop: '4px' }}>
                {fieldErrors.evidenceConfirmed}
              </span>
            )}
          </div>
        </section>

        {/* FORM ACTIONS */}
        <div className="form-action-buttons">
          <button
            type="submit"
            className="auth-submit-btn"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <span className="btn-spinner-content">
                <span className="spinner-dot" />
                Submitting to Municipal Database...
              </span>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                <span>Submit Civic Complaint</span>
              </>
            )}
          </button>
          {onCancel && (
            <button
              type="button"
              className="card-btn secondary-btn"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
