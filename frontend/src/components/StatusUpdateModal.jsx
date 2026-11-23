import React, { useState } from 'react';
import { updateComplaintStatus } from '../services/api';

const PERMITTED_NEXT_STATUSES = {
  'Submitted': ['Under Review', 'Rejected'],
  'Under Review': ['In Progress', 'Rejected'],
  'In Progress': ['Rejected'],
  'Resolved': [],
  'Rejected': []
};

export default function StatusUpdateModal({ complaint, token, onClose, onUpdated, onOpenCompletion }) {
  const currentStatus = complaint?.status || 'Submitted';
  const allowedNext = PERMITTED_NEXT_STATUSES[currentStatus] || [];
  const isTerminal = allowedNext.length === 0;

  const [selectedStatus, setSelectedStatus] = useState(allowedNext[0] || '');
  const [comment, setComment] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  if (!complaint) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    if (isTerminal) {
      setErrorMessage(`Complaint is already in terminal status "${currentStatus}" and cannot be transitioned.`);
      return;
    }

    if (!selectedStatus) {
      setErrorMessage('Please select a target status.');
      return;
    }

    if (selectedStatus === 'Resolved' && (!resolutionNotes || resolutionNotes.trim().length < 5)) {
      setErrorMessage('Resolution notes are required (at least 5 characters) to mark a complaint as Resolved.');
      return;
    }

    setIsSubmitting(true);
    const res = await updateComplaintStatus(token, complaint.id || complaint._id, {
      status: selectedStatus,
      comment: comment.trim(),
      resolutionNotes: selectedStatus === 'Resolved' ? resolutionNotes.trim() : undefined
    });
    setIsSubmitting(false);

    if (res.ok) {
      if (onUpdated) onUpdated(res.complaint);
      onClose();
    } else {
      setErrorMessage(res.errorMessage || 'Failed to update status.');
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

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="status-modal-title">
      <div className="modal-card status-update-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="tracking-badge-pill">{complaint.trackingId}</span>
            <span className={`status-pill ${getStatusClass(currentStatus)}`}>
              Current: {currentStatus}
            </span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close status update modal"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="detail-section">
              <span className="detail-category-tag">{complaint.category}</span>
              <h2 id="status-modal-title" className="detail-title">{complaint.title}</h2>
              <div className="location-info-compact">
                <span>Location: {complaint.location?.address || 'Address pending'}</span>
              </div>
            </div>

            {errorMessage && (
              <div className="form-alert-banner error" role="alert">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{errorMessage}</span>
              </div>
            )}

            {isTerminal ? (
              <div className="status-terminal-notice">
                <p>
                  This complaint is in a <strong>{currentStatus}</strong> state. No further status transitions are permitted for this record.
                </p>
              </div>
            ) : (
              <>
                {currentStatus === 'In Progress' && onOpenCompletion && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.86rem', color: '#166534', marginBottom: '4px' }}>
                      Work is Currently In Progress
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#15803d', marginBottom: '10px' }}>
                      To complete this work and advance to citizen review, municipal policy requires submitting geo-verified photographic evidence and GPS coordinates.
                    </div>
                    <button
                      type="button"
                      className="card-btn"
                      style={{ backgroundColor: '#16a34a', color: '#ffffff', border: 'none', padding: '6px 14px', fontSize: '0.82rem', fontWeight: 600 }}
                      onClick={() => onOpenCompletion(complaint)}
                    >
                      📸 Submit Work Completion Evidence
                    </button>
                  </div>
                )}

                {/* Permitted Next Status Selector */}
                <div className="form-field-group">
                  <label htmlFor="target-status-select" className="form-label">
                    Target Status <span className="required-star">*</span>
                  </label>
                  <select
                    id="target-status-select"
                    className="form-select-control"
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    disabled={isSubmitting}
                    required
                  >
                    {allowedNext.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                  <span className="form-field-hint">
                    Permitted transition from <strong>{currentStatus}</strong>: {allowedNext.join(' or ')}
                  </span>
                </div>

                {/* Conditional Resolution Notes for Resolved status */}
                {selectedStatus === 'Resolved' && (
                  <div className="form-field-group">
                    <label htmlFor="resolution-notes-input" className="form-label">
                      Resolution Notes <span className="required-star">*</span>
                    </label>
                    <textarea
                      id="resolution-notes-input"
                      className="form-textarea-control"
                      rows={4}
                      placeholder="Document field verification, corrective actions taken, contractor work completed, or inspection results..."
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      disabled={isSubmitting}
                      required
                    />
                    <span className="form-field-hint">
                      Minimum 5 characters required. Notes are recorded in the permanent resolution record.
                    </span>
                  </div>
                )}

                {/* Optional Status Change Comment */}
                <div className="form-field-group">
                  <label htmlFor="status-comment-input" className="form-label">
                    Status History Comment <span className="optional-tag">(Optional)</span>
                  </label>
                  <input
                    id="status-comment-input"
                    type="text"
                    className="form-input-control"
                    placeholder="Brief explanation for this status update..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    disabled={isSubmitting}
                    maxLength={300}
                  />
                  <span className="form-field-hint">
                    Appears in the public complaint tracking timeline alongside your officer attribution.
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Modal Footer */}
          <div className="modal-footer">
            <button
              type="button"
              className="card-btn secondary-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            {!isTerminal && (
              <button
                type="submit"
                className="card-btn blue-solid"
                disabled={isSubmitting || !selectedStatus}
              >
                {isSubmitting ? 'Updating Status...' : `Set Status to ${selectedStatus}`}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
