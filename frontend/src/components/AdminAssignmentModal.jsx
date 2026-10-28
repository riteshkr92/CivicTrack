import React, { useState, useEffect } from 'react';
import { assignComplaint, fetchAdminOfficers } from '../services/api';

export default function AdminAssignmentModal({ complaint, token, onClose, onAssigned }) {
  const [officers, setOfficers] = useState([]);
  const [loadingOfficers, setLoadingOfficers] = useState(true);
  const [selectedOfficerId, setSelectedOfficerId] = useState(
    complaint?.assignedOfficer?.id || complaint?.assignedOfficer?._id || ''
  );
  const [department, setDepartment] = useState(
    complaint?.department || complaint?.assignedOfficer?.department || ''
  );
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!complaint) return;
    setSelectedOfficerId(complaint.assignedOfficer?.id || complaint.assignedOfficer?._id || '');
    setDepartment(complaint.department || complaint.assignedOfficer?.department || '');
  }, [complaint]);

  useEffect(() => {
    if (!token || !complaint) return;
    let isMounted = true;
    async function loadOfficers() {
      setLoadingOfficers(true);
      const res = await fetchAdminOfficers(token);
      if (isMounted) {
        setLoadingOfficers(false);
        if (res.ok && res.officers) {
          setOfficers(res.officers);
          if (!selectedOfficerId && res.officers.length > 0) {
            setSelectedOfficerId(res.officers[0].id);
            if (res.officers[0].department && !department) {
              setDepartment(res.officers[0].department);
            }
          }
        } else {
          setErrorMessage(res.errorMessage || 'Failed to load officers list.');
        }
      }
    }

    loadOfficers();
    return () => {
      isMounted = false;
    };
  }, [token, complaint]);

  if (!complaint) return null;

  const handleOfficerChange = (e) => {
    const officerId = e.target.value;
    setSelectedOfficerId(officerId);
    const chosen = officers.find((o) => o.id === officerId);
    if (chosen && chosen.department) {
      setDepartment(chosen.department);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedOfficerId) {
      setErrorMessage('Please select an authorized officer.');
      return;
    }

    setIsSubmitting(true);
    const res = await assignComplaint(token, complaint.id || complaint._id, {
      officerId: selectedOfficerId,
      department: department.trim(),
      comment: comment.trim() || undefined
    });
    setIsSubmitting(false);

    if (res.ok && res.complaint) {
      if (onAssigned) onAssigned(res.complaint);
      onClose();
    } else {
      setErrorMessage(res.errorMessage || 'Failed to assign complaint.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="assign-modal-title">
      <div className="modal-card assignment-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="tracking-badge-pill">{complaint.trackingId}</span>
            <span className="badge-admin-tag">Admin Assignment</span>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close assignment modal"
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
              <h2 id="assign-modal-title" className="detail-title">{complaint.title}</h2>
              <div className="location-info-compact">
                <span>Location: {complaint.location?.address || 'Address not specified'}</span>
              </div>
              {complaint.assignedOfficer && (
                <div className="current-assignment-note">
                  Currently Assigned: <strong>{complaint.assignedOfficer.name}</strong> ({complaint.assignedOfficer.department || 'General'})
                </div>
              )}
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

            {loadingOfficers ? (
              <div className="table-loading-container compact" role="status">
                <div className="spinner-large" aria-hidden="true" />
                <p className="loading-text">Loading authorized municipal officers...</p>
              </div>
            ) : officers.length === 0 ? (
              <div className="table-empty-container compact">
                <p className="table-empty-desc">
                  No registered officer accounts found in the database. Officers must be provisioned with role <code>officer</code> before complaints can be assigned.
                </p>
              </div>
            ) : (
              <>
                <div className="form-field-group">
                  <label htmlFor="officer-select" className="form-label">
                    Assign to Municipal Officer <span className="required-star">*</span>
                  </label>
                  <select
                    id="officer-select"
                    className="form-select-control"
                    value={selectedOfficerId}
                    onChange={handleOfficerChange}
                    disabled={isSubmitting}
                    required
                  >
                    <option value="" disabled>Select an officer...</option>
                    {officers.map((officer) => (
                      <option key={officer.id} value={officer.id}>
                        {officer.name} &bull; {officer.department ? `${officer.department} Dept` : 'General'} ({officer.email})
                      </option>
                    ))}
                  </select>
                  <span className="form-field-hint">
                    Only verified accounts with role <strong>officer</strong> are eligible for field assignment.
                  </span>
                </div>

                <div className="form-field-group">
                  <label htmlFor="department-input" className="form-label">
                    Assigned Department <span className="optional-tag">(Optional)</span>
                  </label>
                  <input
                    id="department-input"
                    type="text"
                    className="form-input-control"
                    placeholder="e.g. Roads & Infrastructure, Water Works, Sanitation"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="form-field-group">
                  <label htmlFor="assign-comment-input" className="form-label">
                    Assignment Directive / Comment <span className="optional-tag">(Optional)</span>
                  </label>
                  <input
                    id="assign-comment-input"
                    type="text"
                    className="form-input-control"
                    placeholder="e.g. Dispatched for on-site inspection by Thursday"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    disabled={isSubmitting}
                    maxLength={300}
                  />
                  <span className="form-field-hint">
                    Recorded in status history and visible on the complaint timeline.
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
            <button
              type="submit"
              className="card-btn blue-solid"
              disabled={isSubmitting || loadingOfficers || officers.length === 0 || !selectedOfficerId}
            >
              {isSubmitting ? 'Assigning Officer...' : 'Confirm Assignment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
