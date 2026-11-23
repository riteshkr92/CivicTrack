import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  fetchEvidenceBlob,
  fetchCompletionEvidenceBlob,
  fetchDisputeEvidenceBlob,
  confirmComplaintResolution,
  disputeComplaintResolution,
  adminReviewDispute,
  recordSlaAction,
  fetchSlaActions,
  fetchAdminOfficers
} from '../services/api';
import WorkCompletionModal from './WorkCompletionModal';

export default function ComplaintDetailModal({ complaint, onClose, onComplaintUpdated }) {
  const { user, role, token } = useAuth();
  const [currentComplaint, setCurrentComplaint] = useState(complaint);

  // Original Evidence Photo State
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(null);

  // Completion Evidence Photo State
  const [completionPhotoUrl, setCompletionPhotoUrl] = useState(null);
  const [completionPhotoLoading, setCompletionPhotoLoading] = useState(false);
  const [completionPhotoError, setCompletionPhotoError] = useState(null);

  // Dispute Evidence Photo State
  const [disputePhotoUrl, setDisputePhotoUrl] = useState(null);
  const [disputePhotoLoading, setDisputePhotoLoading] = useState(false);
  const [disputePhotoError, setDisputePhotoError] = useState(null);

  // Citizen Action States
  const [isConfirming, setIsConfirming] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeFile, setDisputeFile] = useState(null);
  const [disputeFilePreview, setDisputeFilePreview] = useState(null);
  const [isDisputing, setIsDisputing] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);

  // Admin Dispute Review States
  const [adminNotes, setAdminNotes] = useState('');
  const [adminDecisionType, setAdminDecisionType] = useState(null); // 'accept' or 'reopen'
  const [isAdminSubmitting, setIsAdminSubmitting] = useState(false);
  const [showAdminConfirmModal, setShowAdminConfirmModal] = useState(false);

  // Admin SLA Escalation Action States
  const [escalationActionType, setEscalationActionType] = useState(null); // 'acknowledged', 'urgent_intervention', 'supervisory_review', 'admin_note', 'officer_reassigned'
  const [escalationNotes, setEscalationNotes] = useState('');
  const [escalationOfficerId, setEscalationOfficerId] = useState('');
  const [officersList, setOfficersList] = useState([]);
  const [isSubmittingEscalationAction, setIsSubmittingEscalationAction] = useState(false);
  const [escalationActionFeedback, setEscalationActionFeedback] = useState(null);
  const [showEscalationActionModal, setShowEscalationActionModal] = useState(false);

  // Officer Work Completion Modal State
  const [showWorkCompletionModal, setShowWorkCompletionModal] = useState(false);

  // General Action Notification Feedback
  const [actionFeedback, setActionFeedback] = useState(null);

  useEffect(() => {
    setCurrentComplaint(complaint);
    setShowDisputeForm(false);
    setDisputeReason('');
    setDisputeFile(null);
    setDisputeFilePreview(null);
    setAdminNotes('');
    setActionFeedback(null);
    setEscalationActionType(null);
    setEscalationNotes('');
    setEscalationOfficerId('');
    setEscalationActionFeedback(null);
    setShowEscalationActionModal(false);
  }, [complaint]);

  useEffect(() => {
    if (role === 'admin' && token) {
      fetchAdminOfficers(token).then((res) => {
        if (res.ok && Array.isArray(res.officers)) {
          setOfficersList(res.officers);
        }
      }).catch(() => {});
    }
  }, [role, token]);

  const complaintId = currentComplaint?.id || currentComplaint?._id;
  const hasEvidence = Boolean(currentComplaint?.evidence || currentComplaint?.hasEvidence);
  const hasCompletionEvidence = Boolean(
    currentComplaint?.completionEvidence || currentComplaint?.hasCompletionEvidence
  );
  const hasDisputeEvidence = Boolean(
    currentComplaint?.resolutionDispute?.photo || currentComplaint?.hasDispute
  );

  // 1. Load Original Citizen Evidence
  useEffect(() => {
    if (!currentComplaint) return;
    let active = true;
    let createdUrl = null;

    if (hasEvidence && complaintId && token) {
      setPhotoLoading(true);
      setPhotoError(null);

      fetchEvidenceBlob(token, complaintId)
        .then((blobOrUrl) => {
          if (!active) return;
          if (blobOrUrl instanceof Blob) {
            createdUrl = URL.createObjectURL(blobOrUrl);
            setPhotoUrl(createdUrl);
          } else if (typeof blobOrUrl === 'string' && blobOrUrl.trim()) {
            setPhotoUrl(blobOrUrl);
          } else {
            setPhotoError('Unable to load evidence photograph.');
          }
          setPhotoLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setPhotoError(err?.message || 'Evidence photo could not be retrieved.');
          setPhotoLoading(false);
        });
    }

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [complaintId, hasEvidence, token, currentComplaint]);

  // 2. Load Officer Completion Evidence
  useEffect(() => {
    if (!currentComplaint) return;
    let active = true;
    let createdUrl = null;

    if (hasCompletionEvidence && complaintId && token) {
      setCompletionPhotoLoading(true);
      setCompletionPhotoError(null);

      fetchCompletionEvidenceBlob(token, complaintId)
        .then((blobOrUrl) => {
          if (!active) return;
          if (blobOrUrl instanceof Blob) {
            createdUrl = URL.createObjectURL(blobOrUrl);
            setCompletionPhotoUrl(createdUrl);
          } else if (typeof blobOrUrl === 'string' && blobOrUrl.trim()) {
            setCompletionPhotoUrl(blobOrUrl);
          } else {
            setCompletionPhotoError('Unable to load completion photograph.');
          }
          setCompletionPhotoLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setCompletionPhotoError(err?.message || 'Completion photo could not be retrieved.');
          setCompletionPhotoLoading(false);
        });
    }

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [complaintId, hasCompletionEvidence, token, currentComplaint]);

  // 3. Load Dispute Evidence (if any)
  useEffect(() => {
    if (!currentComplaint) return;
    let active = true;
    let createdUrl = null;

    if (hasDisputeEvidence && currentComplaint.resolutionDispute?.photo && complaintId && token) {
      setDisputePhotoLoading(true);
      setDisputePhotoError(null);

      fetchDisputeEvidenceBlob(token, complaintId)
        .then((blobOrUrl) => {
          if (!active) return;
          if (blobOrUrl instanceof Blob) {
            createdUrl = URL.createObjectURL(blobOrUrl);
            setDisputePhotoUrl(createdUrl);
          } else if (typeof blobOrUrl === 'string' && blobOrUrl.trim()) {
            setDisputePhotoUrl(blobOrUrl);
          } else {
            setDisputePhotoError('Unable to load dispute photograph.');
          }
          setDisputePhotoLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setDisputePhotoError(err?.message || 'Dispute photo could not be retrieved.');
          setDisputePhotoLoading(false);
        });
    }

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [complaintId, hasDisputeEvidence, token, currentComplaint]);

  // Cleanup dispute file preview
  useEffect(() => {
    return () => {
      if (disputeFilePreview) {
        URL.revokeObjectURL(disputeFilePreview);
      }
    };
  }, [disputeFilePreview]);

  if (!currentComplaint) return null;

  // Ownership Check
  const currentUserId = user?._id || user?.id;
  const complaintCitizenId = currentComplaint.citizen?._id || currentComplaint.citizen?.id || currentComplaint.citizen;
  const isOwner = Boolean(
    currentUserId && complaintCitizenId && currentUserId.toString() === complaintCitizenId.toString()
  );
  const isCitizenRole = role === 'citizen';
  const isAdminRole = role === 'admin';

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
      case 'Provisionally Resolved':
        return 'status-provisional';
      case 'Disputed':
        return 'status-disputed';
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
      case 'location_mismatch':
        return 'exif-badge-mismatch';
      case 'no_exif_gps':
      case 'no_metadata':
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
      case 'location_mismatch':
        return 'EXIF GPS Location Mismatch (> 150m)';
      case 'no_exif_gps':
        return 'No Embedded EXIF GPS';
      case 'no_metadata':
        return 'Verified via Device GPS (No EXIF)';
      default:
        return 'EXIF Not Applicable';
    }
  };

  // --- Citizen Action Handlers ---
  const handleExecuteConfirmResolution = async () => {
    setShowConfirmModal(false);
    setIsConfirming(true);
    setActionFeedback(null);

    const res = await confirmComplaintResolution(token, complaintId);
    setIsConfirming(false);

    if (res.ok) {
      setActionFeedback({ type: 'success', message: 'Resolution confirmed! Complaint is now fully resolved.' });
      setCurrentComplaint(res.complaint);
      if (onComplaintUpdated) onComplaintUpdated(res.complaint);
    } else {
      setActionFeedback({ type: 'error', message: res.errorMessage || 'Failed to confirm resolution.' });
    }
  };

  const handleDisputeFileChange = (e) => {
    const file = e.target.files?.[0];
    if (disputeFilePreview) {
      URL.revokeObjectURL(disputeFilePreview);
      setDisputeFilePreview(null);
    }

    if (!file) {
      setDisputeFile(null);
      return;
    }

    // Validate size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setActionFeedback({ type: 'error', message: 'Dispute photograph exceeds the maximum 10MB limit.' });
      return;
    }

    setDisputeFile(file);
    setDisputeFilePreview(URL.createObjectURL(file));
  };

  const handleExecuteDisputeResolution = async () => {
    setShowDisputeModal(false);
    setIsDisputing(true);
    setActionFeedback(null);

    const res = await disputeComplaintResolution(token, complaintId, {
      reason: disputeReason.trim(),
      photoFile: disputeFile
    });
    setIsDisputing(false);

    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: 'Resolution dispute filed successfully. Case has been sent to municipal administration for review.'
      });
      setShowDisputeForm(false);
      setCurrentComplaint(res.complaint);
      if (onComplaintUpdated) onComplaintUpdated(res.complaint);
    } else {
      setActionFeedback({ type: 'error', message: res.errorMessage || 'Failed to submit dispute.' });
    }
  };

  // --- Admin Action Handlers ---
  const handleExecuteAdminReview = async () => {
    setShowAdminConfirmModal(false);
    setIsAdminSubmitting(true);
    setActionFeedback(null);

    const res = await adminReviewDispute(token, complaintId, {
      action: adminDecisionType,
      reviewNotes: adminNotes.trim()
    });
    setIsAdminSubmitting(false);

    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: adminDecisionType === 'accept'
          ? 'Dispute review completed: Resolution upheld and complaint marked as resolved.'
          : 'Dispute review completed: Complaint reopened for officer rework.'
      });
      setCurrentComplaint(res.complaint);
      if (onComplaintUpdated) onComplaintUpdated(res.complaint);
    } else {
      setActionFeedback({ type: 'error', message: res.errorMessage || 'Failed to execute administrative decision.' });
    }
  };

  // --- Admin SLA Escalation Action Handlers ---
  const handleAcknowledgeEscalation = async () => {
    if (!complaintId || !token) return;
    setIsSubmittingEscalationAction(true);
    setEscalationActionFeedback(null);

    const res = await recordSlaAction(token, complaintId, { actionType: 'acknowledged' });
    setIsSubmittingEscalationAction(false);

    if (res.ok) {
      setEscalationActionFeedback({
        type: 'success',
        message: 'Critical SLA escalation acknowledged successfully. Unacknowledged status cleared.'
      });
      if (res.complaint) {
        setCurrentComplaint(res.complaint);
        if (onComplaintUpdated) onComplaintUpdated(res.complaint);
      }
    } else {
      setEscalationActionFeedback({
        type: 'error',
        message: res.errorMessage || 'Failed to acknowledge escalation.'
      });
    }
  };

  const handleExecuteEscalationAction = async () => {
    if (!complaintId || !token || !escalationActionType) return;

    if (escalationActionType === 'admin_note' && (!escalationNotes || escalationNotes.trim().length < 3)) {
      setEscalationActionFeedback({ type: 'error', message: 'Admin note must be at least 3 characters.' });
      return;
    }
    if (escalationActionType === 'officer_reassigned' && !escalationOfficerId) {
      setEscalationActionFeedback({ type: 'error', message: 'Please select a replacement officer.' });
      return;
    }

    setIsSubmittingEscalationAction(true);
    setEscalationActionFeedback(null);

    const payload = {
      actionType: escalationActionType,
      adminNotes: escalationNotes.trim()
    };

    if (escalationActionType === 'officer_reassigned') {
      payload.newOfficerId = escalationOfficerId;
      const chosen = officersList.find((o) => (o.id || o._id) === escalationOfficerId);
      if (chosen && chosen.department) {
        payload.department = chosen.department;
      }
    }

    const res = await recordSlaAction(token, complaintId, payload);
    setIsSubmittingEscalationAction(false);

    if (res.ok) {
      setEscalationActionFeedback({
        type: 'success',
        message: res.message || 'Administrative escalation action recorded successfully.'
      });
      setShowEscalationActionModal(false);
      setEscalationActionType(null);
      setEscalationNotes('');
      setEscalationOfficerId('');
      if (res.complaint) {
        setCurrentComplaint(res.complaint);
        if (onComplaintUpdated) onComplaintUpdated(res.complaint);
      }
    } else {
      setEscalationActionFeedback({
        type: 'error',
        message: res.errorMessage || 'Failed to record escalation action.'
      });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-complaint-title">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="tracking-badge-pill">{currentComplaint.trackingId}</span>
            <span className={`status-pill ${getStatusClass(currentComplaint.status)}`}>
              {currentComplaint.status}
            </span>
            <span className={`priority-pill ${getPriorityClass(currentComplaint.priority)}`}>
              Priority: {currentComplaint.priority}
            </span>
            {currentComplaint.reworkCount > 0 && (
              <span className="timeline-actor-pill" style={{ backgroundColor: '#fff7ed', color: '#c2410c', borderColor: '#fed7aa' }}>
                Rework #{currentComplaint.reworkCount}
              </span>
            )}
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
          {actionFeedback && (
            <div
              className={actionFeedback.type === 'error' ? 'auth-alert-error' : 'auth-alert-success'}
              style={{ marginBottom: '14px', padding: '10px 14px', fontSize: '0.88rem' }}
              role="alert"
            >
              <span>{actionFeedback.message}</span>
            </div>
          )}

          {/* Title & Metadata */}
          <div className="detail-section">
            <span className="detail-category-tag">{currentComplaint.category}</span>
            <h2 id="modal-complaint-title" className="detail-title">{currentComplaint.title}</h2>
            <div className="detail-meta-row">
              <span>Submitted: <strong>{formatDate(currentComplaint.createdAt)}</strong></span>
              {currentComplaint.updatedAt && currentComplaint.updatedAt !== currentComplaint.createdAt && (
                <span>&bull; Last Updated: <strong>{formatDate(currentComplaint.updatedAt)}</strong></span>
              )}
              {currentComplaint.resolvedAt && (
                <span>&bull; Final Resolution: <strong>{formatDate(currentComplaint.resolvedAt)}</strong></span>
              )}
            </div>
          </div>

          {/* Smart SLA & Timeline Section */}
          {currentComplaint.sla && (
            <div className="sla-modal-section">
              <div className="sla-modal-header">
                <div className="sla-modal-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>Municipal SLA & Resolution Commitment</span>
                </div>
                {role !== 'citizen' && (
                  <div>
                    {currentComplaint.status === 'Resolved' ? (
                      <span className="sla-badge sla-badge-completed">
                        {currentComplaint.sla.isResolvedWithinSla ? '✓ Resolved Within SLA' : 'Resolved Overdue'}
                      </span>
                    ) : currentComplaint.sla.escalationLevel === 3 ? (
                      <span className="sla-badge sla-badge-escalated">⚠️ Level 3 Critical Escalation</span>
                    ) : currentComplaint.sla.escalationLevel === 2 || currentComplaint.sla.isBreached ? (
                      <span className="sla-badge sla-badge-breached">⚠️ Level 2 SLA Breached</span>
                    ) : currentComplaint.sla.escalationLevel === 1 ? (
                      <span className="sla-badge sla-badge-approaching">⏳ Level 1 Approaching Deadline</span>
                    ) : (
                      <span className="sla-badge sla-badge-normal">● Within SLA Tolerance</span>
                    )}
                  </div>
                )}
              </div>

              {role === 'citizen' ? (
                /* Citizen Customer-Friendly SLA Overview */
                <div>
                  <div className="sla-milestone-grid">
                    <div className="sla-milestone-item">
                      <div className="sla-milestone-label">Estimated Resolution By</div>
                      <div className="sla-milestone-time">
                        {formatDate(currentComplaint.sla.resolutionDeadline)}
                      </div>
                      <div className="sla-milestone-status">
                        {currentComplaint.status === 'Resolved' ? (
                          <span style={{ color: '#16a34a', fontWeight: 600 }}>Work Completed & Resolved</span>
                        ) : currentComplaint.sla.isDelayed ? (
                          <span style={{ color: '#dc2626', fontWeight: 600 }}>Active - High Priority Escalation</span>
                        ) : (
                          <span style={{ color: '#2563eb', fontWeight: 600 }}>Scheduled Field Operations</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {currentComplaint.sla.isDelayed && currentComplaint.status !== 'Resolved' && (
                    <div style={{ fontSize: '0.82rem', color: '#b45309', background: '#fffbeb', padding: '8px 12px', borderRadius: '6px', border: '1px solid #fde68a' }}>
                      Notice: Resolution is taking longer than our baseline target. Dedicated supervisory oversight has been notified to accelerate completion.
                    </div>
                  )}
                </div>
              ) : (
                /* Officer & Admin Operational SLA Milestones */
                <div>
                  <div className="sla-milestone-grid">
                    <div className="sla-milestone-item">
                      <div className="sla-milestone-label">Resolution Deadline</div>
                      <div className="sla-milestone-time">{formatDate(currentComplaint.sla.resolutionDeadline)}</div>
                      <div className="sla-milestone-status">
                        {currentComplaint.sla.resolutionDeadline && new Date() > new Date(currentComplaint.sla.resolutionDeadline) && currentComplaint.status !== 'Resolved'
                          ? <span style={{ color: '#dc2626', fontWeight: 600 }}>Overdue</span>
                          : <span style={{ color: '#16a34a' }}>Target</span>}
                      </div>
                    </div>
                    {currentComplaint.sla.acknowledgementDeadline && (
                      <div className="sla-milestone-item">
                        <div className="sla-milestone-label">Acknowledgement Target</div>
                        <div className="sla-milestone-time">{formatDate(currentComplaint.sla.acknowledgementDeadline)}</div>
                        <div className="sla-milestone-status">
                          {currentComplaint.sla.acknowledgedAt
                            ? <span style={{ color: '#16a34a' }}>✓ {formatDate(currentComplaint.sla.acknowledgedAt)}</span>
                            : <span>Pending Review</span>}
                        </div>
                      </div>
                    )}
                    {currentComplaint.sla.assignmentDeadline && (
                      <div className="sla-milestone-item">
                        <div className="sla-milestone-label">Assignment Target</div>
                        <div className="sla-milestone-time">{formatDate(currentComplaint.sla.assignmentDeadline)}</div>
                        <div className="sla-milestone-status">
                          {currentComplaint.sla.assignedAt
                            ? <span style={{ color: '#16a34a' }}>✓ {formatDate(currentComplaint.sla.assignedAt)}</span>
                            : <span>Pending Assignment</span>}
                        </div>
                      </div>
                    )}
                    {currentComplaint.sla.reworkDeadline && (
                      <div className="sla-milestone-item">
                        <div className="sla-milestone-label">Rework SLA Deadline</div>
                        <div className="sla-milestone-time">{formatDate(currentComplaint.sla.reworkDeadline)}</div>
                        <div className="sla-milestone-status">
                          <span style={{ color: '#6d28d9', fontWeight: 600 }}>Rework Cycle #{currentComplaint.reworkCount || 1}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Admin Escalation History Log */}
                  {role === 'admin' && Array.isArray(currentComplaint.sla.escalationHistory) && currentComplaint.sla.escalationHistory.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                        Escalation Audit Trail ({currentComplaint.sla.escalationHistory.length} events):
                      </div>
                      <div className="escalation-history-list">
                        {currentComplaint.sla.escalationHistory.map((item, idx) => (
                          <div key={idx} className="escalation-history-item">
                            <span className="escalation-history-level">Level {item.level} ({item.stage})</span>
                            <span className="escalation-history-date">{formatDate(item.triggeredAt)}</span>
                            <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{item.reason}</div>
                            {item.actionTaken && (
                              <div style={{ fontSize: '0.72rem', color: '#2563eb' }}>{item.actionTaken}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Admin SLA Supervisory Management & Actions (Admin Only) */}
                  {role === 'admin' && (
                    <div className="admin-sla-supervisory-box">
                      {escalationActionFeedback && (
                        <div
                          className={escalationActionFeedback.type === 'error' ? 'auth-alert-error' : 'auth-alert-success'}
                          style={{ marginBottom: '10px', padding: '8px 12px', fontSize: '0.82rem' }}
                          role="alert"
                        >
                          <span>{escalationActionFeedback.message}</span>
                        </div>
                      )}

                      {/* Critical Attention Required Alert Banner */}
                      {currentComplaint.sla.requiresCriticalAttention && (
                        <div className="critical-attention-alert-bar">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1.25rem' }}>🚨</span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#991b1b' }}>
                                Critical Supervisory Attention Required
                              </div>
                              <div style={{ fontSize: '0.76rem', color: '#7f1d1d' }}>
                                Level 3 SLA breach recorded. Please acknowledge this alert or initiate intervention.
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="card-btn"
                            style={{ backgroundColor: '#dc2626', color: '#ffffff', border: 'none', padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600 }}
                            onClick={handleAcknowledgeEscalation}
                            disabled={isSubmittingEscalationAction}
                          >
                            {isSubmittingEscalationAction ? 'Acknowledging...' : 'Acknowledge Escalation'}
                          </button>
                        </div>
                      )}

                      {/* Supervisory Actions Toolbar */}
                      <div className="admin-escalation-action-bar">
                        <span className="action-bar-label">Supervisory Controls:</span>
                        <div className="action-bar-buttons">
                          <button
                            type="button"
                            className="action-btn-urgent"
                            onClick={() => {
                              setEscalationActionType('urgent_intervention');
                              setShowEscalationActionModal(true);
                            }}
                          >
                            ⚡ Urgent Intervention
                          </button>
                          <button
                            type="button"
                            className="action-btn-review"
                            onClick={() => {
                              setEscalationActionType('supervisory_review');
                              setShowEscalationActionModal(true);
                            }}
                          >
                            📋 Supervisory Review
                          </button>
                          <button
                            type="button"
                            className="action-btn-reassign"
                            onClick={() => {
                              setEscalationActionType('officer_reassigned');
                              setEscalationOfficerId('');
                              setShowEscalationActionModal(true);
                            }}
                          >
                            🔄 Reassign Officer
                          </button>
                          <button
                            type="button"
                            className="action-btn-note"
                            onClick={() => {
                              setEscalationActionType('admin_note');
                              setShowEscalationActionModal(true);
                            }}
                          >
                            📝 Add Note
                          </button>
                        </div>
                      </div>

                      {/* Chronological Escalation Actions Timeline */}
                      {Array.isArray(currentComplaint.sla.escalationActions) && currentComplaint.sla.escalationActions.length > 0 && (
                        <div className="escalation-actions-timeline-section">
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                            Supervisory Action Log ({currentComplaint.sla.escalationActions.length} recorded):
                          </div>
                          <div className="escalation-actions-timeline">
                            {currentComplaint.sla.escalationActions.map((act, idx) => (
                              <div key={act._id || idx} className="escalation-action-card">
                                <div className="action-card-header">
                                  <span className={`action-type-pill pill-${act.actionType}`}>
                                    {act.actionType === 'urgent_intervention' && '⚡ Urgent Intervention'}
                                    {act.actionType === 'officer_reassigned' && '🔄 Officer Reassigned'}
                                    {act.actionType === 'supervisory_review' && '📋 Supervisory Review'}
                                    {act.actionType === 'admin_note' && '📝 Admin Note'}
                                    {act.actionType === 'acknowledged' && '✓ Acknowledged'}
                                  </span>
                                  <span className="action-card-meta">
                                    {act.performedByName || 'Admin'} &bull; {formatDate(act.actionTakenAt)}
                                  </span>
                                </div>
                                <p className="action-card-desc">{act.description}</p>
                                {act.adminNotes && (
                                  <div className="action-card-notes">
                                    <strong>Notes:</strong> {act.adminNotes}
                                  </div>
                                )}
                                {act.actionType === 'officer_reassigned' && act.newOfficerName && (
                                  <div className="action-card-reassigned-info">
                                    Reassigned: {act.previousOfficerName || 'Unassigned'} &rarr; <strong>{act.newOfficerName}</strong>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Description */}
          <div className="detail-section">
            <h3 className="section-subtitle">Issue Description</h3>
            <p className="detail-description-text">{currentComplaint.description}</p>
          </div>

          {/* Location */}
          <div className="detail-section">
            <h3 className="section-subtitle">Reported Location</h3>
            <div className="location-info-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <div>
                <div className="location-address">{currentComplaint.location?.address || 'Location description not specified'}</div>
                {currentComplaint.location?.latitude !== null && currentComplaint.location?.longitude !== null && (
                  <div className="location-coords">
                    GPS Coordinates: {currentComplaint.location.latitude}, {currentComplaint.location.longitude}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Original Photographic Evidence */}
          <div className="detail-section">
            <h3 className="section-subtitle">Original Citizen Evidence Photograph</h3>
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
                        alt={`Original evidence for complaint ${currentComplaint.trackingId}`}
                        className="evidence-modal-image"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="evidence-metadata-card">
                  <div className="evidence-meta-header">
                    <span className="evidence-tag">Original Evidence Record</span>
                    {currentComplaint.evidence?.exifComparisonStatus && (
                      <span className={`exif-status-pill ${getExifBadgeClass(currentComplaint.evidence.exifComparisonStatus)}`}>
                        {getExifLabel(currentComplaint.evidence.exifComparisonStatus)}
                      </span>
                    )}
                  </div>

                  <div className="evidence-meta-rows">
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">File:</span>
                      <span className="evidence-meta-value">{currentComplaint.evidence?.originalName || 'photo-evidence.jpg'}</span>
                    </div>
                    {currentComplaint.evidence?.sizeBytes && (
                      <div className="evidence-meta-row">
                        <span className="evidence-meta-label">Size:</span>
                        <span className="evidence-meta-value">{(currentComplaint.evidence.sizeBytes / 1024).toFixed(1)} KB ({currentComplaint.evidence.mimeType || 'image/jpeg'})</span>
                      </div>
                    )}
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">Captured:</span>
                      <span className="evidence-meta-value">{formatDate(currentComplaint.evidence?.capturedAt)}</span>
                    </div>
                    {currentComplaint.evidence?.coordinates && (
                      <div className="evidence-meta-row">
                        <span className="evidence-meta-label">Evidence GPS:</span>
                        <span className="evidence-meta-value">
                          {currentComplaint.evidence.coordinates.latitude}, {currentComplaint.evidence.coordinates.longitude}
                          {currentComplaint.evidence.coordinates.accuracyMeters ? ` (±${currentComplaint.evidence.coordinates.accuracyMeters}m)` : ''}
                        </span>
                      </div>
                    )}
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">Location Source:</span>
                      <span className="evidence-meta-value source-tag">
                        {currentComplaint.evidence?.locationSource === 'device_gps'
                          ? 'Device GPS (Camera Workflow)'
                          : currentComplaint.evidence?.locationSource === 'user_confirmed'
                          ? 'Citizen-Confirmed Issue Location'
                          : currentComplaint.evidence?.locationSource || 'Not Specified'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="evidence-empty-note">
                <span>No photographic evidence was attached to this complaint.</span>
              </div>
            )}
          </div>

          {/* Officer Completion Evidence Section (if exists) */}
          {hasCompletionEvidence && (
            <div className="detail-section">
              <h3 className="section-subtitle">Officer Work Completion Evidence</h3>
              <div className="evidence-detail-container">
                <div className="evidence-photo-panel">
                  {completionPhotoLoading ? (
                    <div className="evidence-photo-loading">
                      <div className="spinner-dot" />
                      <span>Loading authenticated completion photograph...</span>
                    </div>
                  ) : completionPhotoError ? (
                    <div className="evidence-photo-error">
                      <span>{completionPhotoError}</span>
                    </div>
                  ) : completionPhotoUrl ? (
                    <div className="evidence-photo-wrapper">
                      <img
                        src={completionPhotoUrl}
                        alt={`Completion evidence for complaint ${currentComplaint.trackingId}`}
                        className="evidence-modal-image"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="evidence-metadata-card">
                  <div className="evidence-meta-header">
                    <span className="evidence-tag" style={{ backgroundColor: '#f3e8ff', color: '#6b21a8' }}>
                      Geo-Verified Field Completion
                    </span>
                    <span className={`exif-status-pill ${getExifBadgeClass(currentComplaint.completionEvidence?.exifComparisonStatus)}`}>
                      {getExifLabel(currentComplaint.completionEvidence?.exifComparisonStatus)}
                    </span>
                  </div>

                  <div className="evidence-meta-rows">
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">File:</span>
                      <span className="evidence-meta-value">{currentComplaint.completionEvidence?.originalName || 'completion.jpg'}</span>
                    </div>
                    {currentComplaint.completionEvidence?.distanceMeters !== undefined && currentComplaint.completionEvidence?.distanceMeters !== null && (
                      <div className="evidence-meta-row">
                        <span className="evidence-meta-label">Distance from Issue:</span>
                        <span className="evidence-meta-value"><strong>{currentComplaint.completionEvidence.distanceMeters} metres</strong> (tolerance: 200m)</span>
                      </div>
                    )}
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">Verification Status:</span>
                      <span className="evidence-meta-value" style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                        {currentComplaint.completionEvidence?.verificationStatus || 'Verified'}
                      </span>
                    </div>
                    <div className="evidence-meta-row">
                      <span className="evidence-meta-label">Work Completed:</span>
                      <span className="evidence-meta-value">{formatDate(currentComplaint.completionEvidence?.capturedAt || currentComplaint.completionEvidence?.submittedAt)}</span>
                    </div>
                    {currentComplaint.completionEvidence?.coordinates && (
                      <div className="evidence-meta-row">
                        <span className="evidence-meta-label">Field GPS:</span>
                        <span className="evidence-meta-value">
                          {currentComplaint.completionEvidence.coordinates.latitude}, {currentComplaint.completionEvidence.coordinates.longitude}
                          {currentComplaint.completionEvidence.coordinates.accuracy ? ` (±${currentComplaint.completionEvidence.coordinates.accuracy}m)` : ''}
                        </span>
                      </div>
                    )}
                    {currentComplaint.completionEvidence?.verificationReason && (
                      <div className="evidence-verification-note" style={{ marginTop: '8px' }}>
                        <span className="verification-label">Verification Telemetry:</span>
                        <span className="verification-text">{currentComplaint.completionEvidence.verificationReason}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {currentComplaint.completionEvidence?.resolutionNotes && (
                <div style={{ marginTop: '12px', padding: '10px 14px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Officer Work Summary:</span>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#1e293b', whiteSpace: 'pre-wrap' }}>
                    {currentComplaint.completionEvidence.resolutionNotes}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* OFFICER FIELD WORK COMPLETION ACTION BANNER */}
          {role === 'officer' && currentComplaint.status === 'In Progress' && (
            <div className="detail-section" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>🛠️</span>
                    <h3 className="section-subtitle" style={{ margin: 0, color: '#166534' }}>
                      Field Work In Progress
                    </h3>
                  </div>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#15803d' }}>
                    When repairs are finished at the site, upload your mandatory geotagged completion photo and GPS coordinates to transition this complaint to Provisionally Resolved.
                  </p>
                </div>
                <button
                  type="button"
                  className="card-btn"
                  style={{ backgroundColor: '#16a34a', color: '#ffffff', border: 'none', padding: '8px 16px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                  onClick={() => setShowWorkCompletionModal(true)}
                >
                  📸 Submit Completion Evidence
                </button>
              </div>
            </div>
          )}

          {/* CITIZEN RESOLUTION REVIEW (When Provisionally Resolved & User is Citizen Owner) */}
          {currentComplaint.status === 'Provisionally Resolved' && isCitizenRole && isOwner && (
            <div className="provisional-review-banner">
              <div className="provisional-review-header">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6b21a8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <h3 className="provisional-review-title">Resolution Review Required</h3>
              </div>
              <p className="provisional-review-desc">
                An assigned officer has submitted geo-verified completion evidence for your complaint. Please inspect the work photograph, location, and description. You may confirm that the issue is satisfactorily fixed, or dispute the resolution if the problem remains.
              </p>

              {!showDisputeForm ? (
                <div className="provisional-actions-row">
                  <button
                    type="button"
                    className="confirm-action-btn"
                    disabled={isConfirming}
                    onClick={() => setShowConfirmModal(true)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{isConfirming ? 'Confirming...' : 'Confirm Resolution'}</span>
                  </button>

                  <button
                    type="button"
                    className="dispute-action-btn"
                    disabled={isConfirming}
                    onClick={() => setShowDisputeForm(true)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>Dispute Resolution</span>
                  </button>
                </div>
              ) : (
                <div className="dispute-form-container">
                  <h4 className="dispute-form-title">Dispute Work Completion</h4>
                  <p style={{ fontSize: '0.84rem', color: '#64748b', margin: '0 0 8px 0' }}>
                    Describe specifically what work remains incomplete or unsatisfactory. An administrator will review your dispute.
                  </p>
                  <textarea
                    className="dispute-textarea"
                    placeholder="Provide details on why the issue is not fixed (minimum 10 characters)..."
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    maxLength={1000}
                    disabled={isDisputing}
                  />
                  <div className="dispute-char-hint">
                    {disputeReason.trim().length} / 1000 characters (min. 10)
                  </div>

                  <div className="dispute-upload-row">
                    <label className="dispute-upload-label" htmlFor="dispute-photo-input">
                      Optional Supporting Photo:
                    </label>
                    <input
                      id="dispute-photo-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleDisputeFileChange}
                      disabled={isDisputing}
                    />
                    {disputeFilePreview && (
                      <div className="dispute-photo-preview">
                        <img src={disputeFilePreview} alt="Dispute Preview" className="dispute-photo-thumb" />
                        <div className="dispute-photo-info">
                          <span>{disputeFile?.name}</span>
                          <span>{(disputeFile.size / 1024).toFixed(1)} KB</span>
                        </div>
                        <button
                          type="button"
                          className="remove-thumb-btn"
                          onClick={() => {
                            setDisputeFile(null);
                            URL.revokeObjectURL(disputeFilePreview);
                            setDisputeFilePreview(null);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="dispute-form-actions">
                    <button
                      type="button"
                      className="card-btn secondary-btn"
                      disabled={isDisputing}
                      onClick={() => {
                        setShowDisputeForm(false);
                        setDisputeReason('');
                        setDisputeFile(null);
                        if (disputeFilePreview) {
                          URL.revokeObjectURL(disputeFilePreview);
                          setDisputeFilePreview(null);
                        }
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="dispute-action-btn"
                      disabled={isDisputing || disputeReason.trim().length < 10}
                      onClick={() => setShowDisputeModal(true)}
                    >
                      <span>{isDisputing ? 'Submitting...' : 'Submit Dispute'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DISPUTE RECORD SECTION (When complaint has a dispute record) */}
          {currentComplaint.resolutionDispute && currentComplaint.resolutionDispute.reason && (
            <div className="detail-section" style={{ backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <h3 className="section-subtitle" style={{ margin: 0, color: '#9a3412' }}>
                  Citizen Dispute Record {currentComplaint.status === 'Disputed' ? '(Under Review)' : ''}
                </h3>
              </div>
              <div style={{ fontSize: '0.88rem', color: '#431407', marginBottom: '8px' }}>
                <strong>Reason:</strong> {currentComplaint.resolutionDispute.reason}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#7c2d12' }}>
                Disputed on: <strong>{formatDate(currentComplaint.resolutionDispute.submittedAt)}</strong>
              </div>

              {/* Dispute Photo if attached */}
              {currentComplaint.resolutionDispute.photo && (
                <div style={{ marginTop: '10px' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#9a3412' }}>Citizen Dispute Evidence Photo:</span>
                  <div style={{ marginTop: '6px', maxWidth: '320px' }}>
                    {disputePhotoLoading ? (
                      <span style={{ fontSize: '0.84rem', color: '#64748b' }}>Loading dispute photo...</span>
                    ) : disputePhotoError ? (
                      <span style={{ fontSize: '0.84rem', color: '#dc2626' }}>{disputePhotoError}</span>
                    ) : disputePhotoUrl ? (
                      <img
                        src={disputePhotoUrl}
                        alt="Dispute evidence"
                        style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #fed7aa' }}
                      />
                    ) : null}
                  </div>
                </div>
              )}

              {/* Admin Review Outcome (if reviewed) */}
              {currentComplaint.resolutionDispute.reviewedAt && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed #fdba74' }}>
                  <div style={{ fontSize: '0.84rem', color: '#9a3412', fontWeight: 600 }}>
                    Administrative Review Decision: {currentComplaint.resolutionDispute.adminDecision === 'confirm_resolution' ? 'Resolution Upheld' : 'Returned for Rework'}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#431407', marginTop: '2px' }}>
                    Notes: {currentComplaint.resolutionDispute.adminNotes || 'No notes recorded.'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#7c2d12', marginTop: '2px' }}>
                    Reviewed on: {formatDate(currentComplaint.resolutionDispute.reviewedAt)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ADMIN DISPUTE REVIEW & DECISION PANEL (When Disputed & User is Admin) */}
          {currentComplaint.status === 'Disputed' && isAdminRole && (
            <div className="dispute-admin-banner">
              <div className="dispute-admin-header">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <h3 className="dispute-admin-title">Administrative Dispute Decision</h3>
              </div>
              <p className="dispute-admin-desc">
                Review the citizen's dispute reason, the officer's completion photograph, and original complaint evidence above. Decide whether to uphold the resolution as final or reopen the complaint and dispatch for rework.
              </p>

              <div className="admin-decision-box">
                <label style={{ fontSize: '0.84rem', fontWeight: 600, color: '#334155' }} htmlFor="admin-review-notes">
                  Review Notes / Rework Instructions (required for rework):
                </label>
                <textarea
                  id="admin-review-notes"
                  className="admin-notes-textarea"
                  placeholder="Enter administrative review findings or detailed rework instructions for the officer..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  maxLength={1000}
                  disabled={isAdminSubmitting}
                />
                <div style={{ fontSize: '0.78rem', color: '#64748b', textAlign: 'right', marginTop: '2px' }}>
                  {adminNotes.trim().length} / 1000 characters
                </div>

                <div className="admin-decision-buttons">
                  <button
                    type="button"
                    className="admin-accept-btn"
                    disabled={isAdminSubmitting}
                    onClick={() => {
                      setAdminDecisionType('accept');
                      setShowAdminConfirmModal(true);
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Accept Resolution (Final Resolved)</span>
                  </button>

                  <button
                    type="button"
                    className="admin-reopen-btn"
                    disabled={isAdminSubmitting || adminNotes.trim().length < 5}
                    onClick={() => {
                      setAdminDecisionType('reopen');
                      setShowAdminConfirmModal(true);
                    }}
                    title={adminNotes.trim().length < 5 ? 'Enter at least 5 characters in review notes to reopen' : ''}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    <span>Reopen Work (Return to In Progress)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Assignment Information */}
          <div className="detail-section">
            <h3 className="section-subtitle">Department & Assignment</h3>
            <div className="assignment-info-box">
              {currentComplaint.assignedOfficer ? (
                <div>
                  <div className="assignment-officer-name">
                    Assigned Officer: <strong>{currentComplaint.assignedOfficer.name}</strong>
                  </div>
                  <div className="assignment-officer-meta">
                    Department: <strong>{currentComplaint.department || currentComplaint.assignedOfficer.department || 'Municipal Operations'}</strong>
                    {currentComplaint.assignedOfficer.email && <span> &bull; {currentComplaint.assignedOfficer.email}</span>}
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
          {currentComplaint.resolutionNotes && (
            <div className="detail-section">
              <h3 className="section-subtitle">Official Resolution Record</h3>
              <div className="resolution-notes-box">
                <div className="resolution-notes-header">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>Verified Resolution Record {currentComplaint.resolvedAt ? `&bull; ${formatDate(currentComplaint.resolvedAt)}` : ''}</span>
                </div>
                <p className="resolution-notes-content">{currentComplaint.resolutionNotes}</p>
              </div>
            </div>
          )}

          {/* Status History Timeline */}
          <div className="detail-section">
            <h3 className="section-subtitle">Resolution Status History</h3>
            {Array.isArray(currentComplaint.statusHistory) && currentComplaint.statusHistory.length > 0 ? (
              <div className="status-timeline">
                {currentComplaint.statusHistory.map((step, idx) => (
                  <div key={step._id || idx} className="timeline-item">
                    <div className="timeline-bullet-wrapper">
                      <div className={`timeline-bullet ${getStatusClass(step.status)}`} />
                      {idx < currentComplaint.statusHistory.length - 1 && <div className="timeline-line" />}
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

      {/* Confirmation Dialog: Citizen Confirm Resolution */}
      {showConfirmModal && (
        <div className="confirmation-dialog-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="confirmation-dialog-card" onClick={(e) => e.stopPropagation()}>
            <h4 className="confirmation-dialog-title">Confirm Satisfactory Resolution?</h4>
            <p className="confirmation-dialog-desc">
              By confirming, you verify that the civic work reported in "{currentComplaint.title}" has been completed satisfactorily. The complaint status will advance to final Resolved.
            </p>
            <div className="confirmation-dialog-actions">
              <button
                type="button"
                className="card-btn secondary-btn"
                onClick={() => setShowConfirmModal(false)}
              >
                Go Back
              </button>
              <button
                type="button"
                className="confirm-action-btn"
                onClick={handleExecuteConfirmResolution}
              >
                Yes, Confirm Resolution
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Citizen Dispute Resolution */}
      {showDisputeModal && (
        <div className="confirmation-dialog-overlay" onClick={() => setShowDisputeModal(false)}>
          <div className="confirmation-dialog-card" onClick={(e) => e.stopPropagation()}>
            <h4 className="confirmation-dialog-title">Submit Resolution Dispute?</h4>
            <p className="confirmation-dialog-desc">
              Your dispute and reason will be recorded and forwarded to municipal administration. An administrator will review your case and either uphold the resolution or reopen work orders.
            </p>
            <div className="confirmation-dialog-actions">
              <button
                type="button"
                className="card-btn secondary-btn"
                onClick={() => setShowDisputeModal(false)}
              >
                Go Back
              </button>
              <button
                type="button"
                className="dispute-action-btn"
                onClick={handleExecuteDisputeResolution}
              >
                Yes, Submit Dispute
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Admin Dispute Decision */}
      {showAdminConfirmModal && (
        <div className="confirmation-dialog-overlay" onClick={() => setShowAdminConfirmModal(false)}>
          <div className="confirmation-dialog-card" onClick={(e) => e.stopPropagation()}>
            <h4 className="confirmation-dialog-title">
              {adminDecisionType === 'accept' ? 'Uphold and Confirm Resolution?' : 'Reopen Complaint for Rework?'}
            </h4>
            <p className="confirmation-dialog-desc">
              {adminDecisionType === 'accept'
                ? `Confirm that the civic work is satisfactory. This will mark "${currentComplaint.title}" as final Resolved and notify both the citizen and officer.`
                : `Return "${currentComplaint.title}" to In Progress for officer rework. Rework count will be incremented and the officer will be notified with your instructions.`}
            </p>
            <div className="confirmation-dialog-actions">
              <button
                type="button"
                className="card-btn secondary-btn"
                onClick={() => setShowAdminConfirmModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={adminDecisionType === 'accept' ? 'admin-accept-btn' : 'admin-reopen-btn'}
                onClick={handleExecuteAdminReview}
              >
                {adminDecisionType === 'accept' ? 'Confirm Resolution' : 'Reopen Work Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation & Input Dialog: Admin SLA Escalation Action */}
      {showEscalationActionModal && escalationActionType && (
        <div className="confirmation-dialog-overlay" onClick={() => setShowEscalationActionModal(false)}>
          <div className="confirmation-dialog-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <h4 className="confirmation-dialog-title">
              {escalationActionType === 'urgent_intervention' && '⚡ Record Urgent Administrative Intervention'}
              {escalationActionType === 'supervisory_review' && '📋 Record Supervisory Management Review'}
              {escalationActionType === 'officer_reassigned' && '🔄 Reassign Complaint to Field Officer'}
              {escalationActionType === 'admin_note' && '📝 Add Administrative Supervisory Note'}
            </h4>
            <p className="confirmation-dialog-desc">
              {escalationActionType === 'urgent_intervention' && 'Prioritize resources and record immediate operational intervention for this complaint.'}
              {escalationActionType === 'supervisory_review' && 'Document administrative review findings and instructions for field supervisors.'}
              {escalationActionType === 'officer_reassigned' && 'Select an authorized municipal officer to take over active remediation.'}
              {escalationActionType === 'admin_note' && 'Add an internal administrative note to the permanent audit trail.'}
            </p>

            {escalationActionType === 'officer_reassigned' && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                  Select New Assigned Officer:
                </label>
                <select
                  className="filter-select-input"
                  style={{ width: '100%' }}
                  value={escalationOfficerId}
                  onChange={(e) => setEscalationOfficerId(e.target.value)}
                  disabled={isSubmittingEscalationAction}
                >
                  <option value="">-- Choose Officer --</option>
                  {officersList
                    .filter((o) => (o.id || o._id) !== (currentComplaint.assignedOfficer?._id || currentComplaint.assignedOfficer?.id || currentComplaint.assignedOfficer))
                    .map((off) => (
                      <option key={off.id || off._id} value={off.id || off._id}>
                        {off.name} ({off.department || 'General Operations'})
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                {escalationActionType === 'admin_note' ? 'Admin Note (min. 3 characters):' : 'Supervisory Notes (Optional):'}
              </label>
              <textarea
                className="admin-notes-textarea"
                style={{ width: '100%', minHeight: '80px' }}
                placeholder="Enter supervisory instructions, priority allocation, or internal observations..."
                value={escalationNotes}
                onChange={(e) => setEscalationNotes(e.target.value)}
                maxLength={1000}
                disabled={isSubmittingEscalationAction}
              />
              <div style={{ fontSize: '0.74rem', color: '#64748b', textAlign: 'right' }}>
                {escalationNotes.trim().length} / 1000 characters
              </div>
            </div>

            <div className="confirmation-dialog-actions">
              <button
                type="button"
                className="card-btn secondary-btn"
                onClick={() => {
                  setShowEscalationActionModal(false);
                  setEscalationActionType(null);
                  setEscalationNotes('');
                  setEscalationOfficerId('');
                }}
                disabled={isSubmittingEscalationAction}
              >
                Cancel
              </button>
              <button
                type="button"
                className="card-btn amber-solid"
                onClick={handleExecuteEscalationAction}
                disabled={
                  isSubmittingEscalationAction ||
                  (escalationActionType === 'admin_note' && escalationNotes.trim().length < 3) ||
                  (escalationActionType === 'officer_reassigned' && !escalationOfficerId)
                }
              >
                {isSubmittingEscalationAction ? 'Executing...' : 'Confirm Action'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Officer Work Completion Modal */}
      {showWorkCompletionModal && (
        <WorkCompletionModal
          complaint={currentComplaint}
          token={token}
          onClose={() => setShowWorkCompletionModal(false)}
          onCompleted={(updated) => {
            setCurrentComplaint(updated);
            if (onComplaintUpdated) onComplaintUpdated(updated);
            setShowWorkCompletionModal(false);
            setActionFeedback({
              type: 'success',
              message: 'Work completion evidence verified and submitted successfully! Status moved to Provisionally Resolved.'
            });
          }}
        />
      )}
    </div>
  );
}
