import React, { useState, useEffect } from 'react';
import { fetchSlaPolicy, updateSlaPolicy } from '../services/api';

const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

const TARGET_FIELDS = [
  { key: 'acknowledgementHours', label: 'Ack. Target (hrs)', min: 1, max: 720 },
  { key: 'assignmentHours', label: 'Assign Target (hrs)', min: 1, max: 720 },
  { key: 'resolutionHours', label: 'Resolution Target (hrs)', min: 1, max: 720 },
  { key: 'reworkHours', label: 'Rework Target (hrs)', min: 1, max: 720 }
];

export default function SlaPolicyModal({ token, onClose, onPolicyUpdated }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policyVersion, setPolicyVersion] = useState('');
  const [description, setDescription] = useState('');
  const [priorityTargets, setPriorityTargets] = useState({
    Urgent: { acknowledgementHours: 2, assignmentHours: 4, resolutionHours: 24, reworkHours: 12 },
    High: { acknowledgementHours: 4, assignmentHours: 8, resolutionHours: 48, reworkHours: 24 },
    Medium: { acknowledgementHours: 12, assignmentHours: 24, resolutionHours: 72, reworkHours: 36 },
    Low: { acknowledgementHours: 24, assignmentHours: 48, resolutionHours: 120, reworkHours: 48 }
  });
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadPolicy() {
      setLoading(true);
      const res = await fetchSlaPolicy(token);
      if (isMounted) {
        setLoading(false);
        if (res.ok && res.policy) {
          setPolicyVersion(res.policy.version || 'v1.0');
          setDescription(res.policy.description || '');
          if (res.policy.priorityTargets) {
            setPriorityTargets(res.policy.priorityTargets);
          }
        } else {
          setFeedback({ type: 'error', message: res.errorMessage || 'Failed to load SLA policy matrix.' });
        }
      }
    }
    loadPolicy();
    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleHourChange = (priority, field, val) => {
    const num = parseInt(val, 10);
    setPriorityTargets((prev) => ({
      ...prev,
      [priority]: {
        ...prev[priority],
        [field]: isNaN(num) ? '' : num
      }
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFeedback(null);

    // Validate numbers
    for (const p of PRIORITIES) {
      const targets = priorityTargets[p];
      for (const f of TARGET_FIELDS) {
        const val = Number(targets[f.key]);
        if (isNaN(val) || val < f.min || val > f.max) {
          setFeedback({
            type: 'error',
            message: `${p} priority: ${f.label} must be a number between ${f.min} and ${f.max} hours.`
          });
          return;
        }
      }
    }

    setSaving(true);
    const res = await updateSlaPolicy(token, {
      priorityTargets,
      description: description.trim() || `Configured via Admin Dashboard on ${new Date().toLocaleDateString()}`
    });
    setSaving(false);

    if (res.ok) {
      setFeedback({ type: 'success', message: 'SLA policy updated successfully! New complaints will adhere to updated targets.' });
      if (onPolicyUpdated) {
        onPolicyUpdated(res.policy);
      }
      setTimeout(() => {
        onClose();
      }, 1500);
    } else {
      setFeedback({ type: 'error', message: res.errorMessage || 'Failed to save SLA policy.' });
    }
  };

  return (
    <div className="confirmation-dialog-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sla-policy-modal-title">
      <div className="sla-policy-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="sla-policy-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>⚙️</span>
            <div>
              <h3 id="sla-policy-modal-title" style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>
                Municipal SLA Policy Configuration
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Active Version: <strong>{policyVersion}</strong> &bull; Modify response and resolution commitments
              </p>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        {feedback && (
          <div
            className={feedback.type === 'error' ? 'auth-alert-error' : 'auth-alert-success'}
            style={{ margin: '14px 20px 0 20px', padding: '10px 14px', fontSize: '0.84rem' }}
            role="alert"
          >
            <span>{feedback.message}</span>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div className="spinner-large" />
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '10px' }}>Loading SLA targets...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} style={{ padding: '16px 20px' }}>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Policy Description / Audit Note:
              </label>
              <input
                type="text"
                className="filter-select-input"
                style={{ width: '100%', fontSize: '0.85rem' }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Q4 Performance Targets Revision"
                maxLength={200}
              />
            </div>

            <div className="sla-policy-table-wrapper">
              <table className="sla-policy-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>Priority</th>
                    {TARGET_FIELDS.map((f) => (
                      <th key={f.key} style={{ padding: '8px 10px', textAlign: 'center' }}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PRIORITIES.map((p) => (
                    <tr key={p} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px', fontWeight: 700, color: '#1e293b' }}>
                        <span className={`priority-pill-sm priority-${p.toLowerCase()}`}>{p}</span>
                      </td>
                      {TARGET_FIELDS.map((f) => (
                        <td key={f.key} style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <input
                            type="number"
                            min={f.min}
                            max={f.max}
                            value={priorityTargets[p]?.[f.key] ?? ''}
                            onChange={(e) => handleHourChange(p, f.key, e.target.value)}
                            required
                            style={{
                              width: '72px',
                              padding: '5px 8px',
                              borderRadius: '4px',
                              border: '1px solid #cbd5e1',
                              textAlign: 'center',
                              fontSize: '0.85rem'
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button type="button" className="card-btn secondary-btn" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="card-btn amber-solid" disabled={saving}>
                {saving ? 'Updating Policy...' : 'Save SLA Policy'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
