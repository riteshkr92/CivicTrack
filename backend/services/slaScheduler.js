/**
 * CivicTrack 2.0 — Smart SLA Evaluation & Escalation Background Service
 *
 * Periodically evaluates active civic complaints against SLA milestone deadlines,
 * detects approaching deadlines, flags breaches, advances escalation levels (0 -> 1 -> 2 -> 3),
 * dispatches role-scoped notifications, and maintains an immutable audit trail.
 */

const { Complaint } = require('../models/Complaint');
const { Notification } = require('../models/Notification');
const User = require('../models/User');
const { evaluateComplaintSla, calculateSlaDeadlines } = require('../config/slaPolicy');

let schedulerTimer = null;
let isEvaluating = false;

/**
 * Dispatch SLA escalation notification with deduplication safeguards.
 *
 * @param {Object} params
 * @param {Object} params.complaint - Complaint document
 * @param {number} params.level - Escalation level (1, 2, or 3)
 * @param {string} params.stage - Milestone stage ('acknowledgement', 'assignment', 'resolution', 'rework')
 * @param {string} params.reason - Telemetry reason for escalation
 * @param {Date} params.now - Current evaluation timestamp
 * @returns {Promise<Array<string>>} Notified roles
 */
async function dispatchSlaNotifications({ complaint, level, stage, reason, now }) {
  const notifiedRoles = [];
  const trackingId = complaint.trackingId;
  const title = complaint.title;

  // Locate the designated municipal administrator
  const adminUser = await User.findOne({ role: 'admin' });
  const officerId = complaint.assignedOfficer?._id || complaint.assignedOfficer;

  if (level === 1) {
    // Level 1: Approaching Deadline Warning
    const notifType = stage === 'rework' ? 'sla_rework_warning' : 'sla_warning';
    const notifTitle = `SLA Warning: ${trackingId} Approaching Deadline`;
    const notifMsg = `Complaint "${title}" (${trackingId}) is nearing its ${stage} SLA deadline. ${reason}.`;

    if (officerId) {
      await Notification.create({
        recipient: officerId,
        actor: null,
        actorRole: 'system',
        complaint: complaint._id,
        trackingId,
        type: notifType,
        title: notifTitle,
        message: notifMsg
      });
      notifiedRoles.push('officer');
    }

    if (adminUser) {
      await Notification.create({
        recipient: adminUser._id,
        actor: null,
        actorRole: 'system',
        complaint: complaint._id,
        trackingId,
        type: notifType,
        title: notifTitle,
        message: notifMsg
      });
      notifiedRoles.push('admin');
    }
  } else if (level === 2) {
    // Level 2: SLA Breached
    const notifType = stage === 'rework' ? 'sla_rework_breached' : 'sla_breached';
    const notifTitle = `SLA Breached: ${trackingId} Overdue (${stage})`;
    const notifMsg = `Complaint "${title}" (${trackingId}) has breached its ${stage} SLA deadline. ${reason}. Immediate operational attention required.`;

    if (officerId) {
      await Notification.create({
        recipient: officerId,
        actor: null,
        actorRole: 'system',
        complaint: complaint._id,
        trackingId,
        type: notifType,
        title: notifTitle,
        message: notifMsg
      });
      notifiedRoles.push('officer');
    }

    if (adminUser) {
      await Notification.create({
        recipient: adminUser._id,
        actor: null,
        actorRole: 'system',
        complaint: complaint._id,
        trackingId,
        type: notifType,
        title: notifTitle,
        message: notifMsg
      });
      notifiedRoles.push('admin');
    }
  } else if (level === 3) {
    // Level 3: Critical Management Escalation
    const notifType = 'sla_escalated';
    const notifTitle = `CRITICAL ESCALATION: ${trackingId} Overdue by >24h`;
    const notifMsg = `Management escalation level 3: Complaint "${title}" (${trackingId}) is significantly overdue. ${reason}.`;

    if (adminUser) {
      await Notification.create({
        recipient: adminUser._id,
        actor: null,
        actorRole: 'system',
        complaint: complaint._id,
        trackingId,
        type: notifType,
        title: notifTitle,
        message: notifMsg
      });
      notifiedRoles.push('admin');
    }

    if (officerId) {
      await Notification.create({
        recipient: officerId,
        actor: null,
        actorRole: 'system',
        complaint: complaint._id,
        trackingId,
        type: notifType,
        title: notifTitle,
        message: notifMsg
      });
      notifiedRoles.push('officer');
    }
  }

  return notifiedRoles;
}

/**
 * Execute a single complete SLA evaluation cycle over all active complaints.
 *
 * @param {Object} [options]
 * @param {Date} [options.now] - Evaluation reference timestamp (defaults to Date.now())
 * @returns {Promise<Object>} Execution summary
 */
async function evaluateSlaComplaints({ now = new Date() } = {}) {
  if (isEvaluating) {
    return { skipped: true, reason: 'Evaluation cycle already in progress' };
  }

  isEvaluating = true;
  const evaluationDate = new Date(now);

  const results = {
    evaluatedCount: 0,
    breachesDetected: 0,
    escalationsTriggered: 0,
    levelBreakdown: { level0: 0, level1: 0, level2: 0, level3: 0 },
    errors: []
  };

  try {
    // Find all complaints in active, non-terminal states
    const activeComplaints = await Complaint.find({
      status: { $in: ['Submitted', 'Under Review', 'In Progress', 'Disputed'] }
    });

    results.evaluatedCount = activeComplaints.length;

    for (const complaint of activeComplaints) {
      try {
        let modified = false;

        // Ensure SLA deadlines exist (for backward compatibility with older test complaints)
        if (!complaint.sla || !complaint.sla.resolutionDeadline) {
          const deadlines = calculateSlaDeadlines({
            category: complaint.category,
            priority: complaint.priority,
            createdAt: complaint.createdAt || evaluationDate
          });

          complaint.sla = {
            policyVersion: deadlines.policyVersion,
            startedAt: deadlines.startedAt,
            acknowledgementDeadline: deadlines.acknowledgementDeadline,
            assignmentDeadline: deadlines.assignmentDeadline,
            resolutionDeadline: deadlines.resolutionDeadline,
            isBreached: false,
            breachedStages: [],
            escalationLevel: 0,
            escalationHistory: [],
            warningNotifiedStages: [],
            breachNotifiedStages: []
          };
          modified = true;
        }

        // Run algorithmic evaluation
        const evalResult = evaluateComplaintSla(complaint, evaluationDate);
        const currentLevel = complaint.sla.escalationLevel || 0;

        // Update breach flag if newly breached
        if (evalResult.isBreached && !complaint.sla.isBreached) {
          complaint.sla.isBreached = true;
          results.breachesDetected++;
          modified = true;
        }

        // Merge breached stages
        if (evalResult.breachedStages && evalResult.breachedStages.length > 0) {
          const existingStages = new Set(complaint.sla.breachedStages || []);
          evalResult.breachedStages.forEach((st) => existingStages.add(st));
          if (existingStages.size !== (complaint.sla.breachedStages || []).length) {
            complaint.sla.breachedStages = Array.from(existingStages);
            modified = true;
          }
        }

        // Check for escalation progression (strictly higher level than currently recorded)
        if (evalResult.level > currentLevel) {
          complaint.sla.escalationLevel = evalResult.level;
          complaint.sla.lastEscalatedAt = evaluationDate;
          results.escalationsTriggered++;

          // Dispatch notifications
          const notifiedRoles = await dispatchSlaNotifications({
            complaint,
            level: evalResult.level,
            stage: evalResult.primaryStage,
            reason: evalResult.breachReason,
            now: evaluationDate
          });

          // Append to escalation history
          complaint.sla.escalationHistory.push({
            level: evalResult.level,
            stage: evalResult.primaryStage,
            triggeredAt: evaluationDate,
            reason: evalResult.breachReason,
            actionTaken: `Automated escalation to level ${evalResult.level}. Notifications dispatched to: ${notifiedRoles.join(', ')}`,
            notifiedRoles
          });

          modified = true;
        }

        // Critical Attention Flag & Deduplicated Automated Action for Level 3
        if (evalResult.level === 3 || complaint.sla.escalationLevel === 3) {
          if (!complaint.sla.criticalAttentionAcknowledgedAt) {
            if (!complaint.sla.requiresCriticalAttention) {
              complaint.sla.requiresCriticalAttention = true;
              complaint.sla.criticalAttentionTriggeredAt = evaluationDate;
              modified = true;
            }
          }

          if (!complaint.sla.escalationActions) {
            complaint.sla.escalationActions = [];
          }

          const hasAutoLevel3Action = complaint.sla.escalationActions.some(
            (act) => act.escalationLevel === 3 && act.actionType === 'supervisory_review'
          );

          if (!hasAutoLevel3Action) {
            const adminUser = await User.findOne({ role: 'admin' });
            complaint.sla.escalationActions.push({
              actionType: 'supervisory_review',
              escalationLevel: 3,
              description: `Automated Level 3 Critical Escalation triggered: ${evalResult.breachReason}`,
              adminNotes: 'Automated municipal oversight record. Flagged for critical supervisory review and operational intervention.',
              actionTakenAt: evaluationDate,
              performedBy: adminUser ? adminUser._id : complaint.citizen,
              performedByName: adminUser ? adminUser.name : 'Municipal System',
              previousOfficer: complaint.assignedOfficer?._id || complaint.assignedOfficer || null,
              previousOfficerName: complaint.assignedOfficer?.name || '',
              newOfficer: complaint.assignedOfficer?._id || complaint.assignedOfficer || null,
              newOfficerName: complaint.assignedOfficer?.name || ''
            });
            modified = true;
          }
        }

        // Record metrics breakdown
        const effectiveLevel = complaint.sla.escalationLevel || 0;
        if (effectiveLevel === 1) results.levelBreakdown.level1++;
        else if (effectiveLevel === 2) results.levelBreakdown.level2++;
        else if (effectiveLevel === 3) results.levelBreakdown.level3++;
        else results.levelBreakdown.level0++;

        if (modified) {
          await complaint.save();
        }
      } catch (complaintError) {
        results.errors.push({
          complaintId: complaint._id,
          error: complaintError.message
        });
      }
    }
  } catch (error) {
    results.errors.push({ error: error.message });
  } finally {
    isEvaluating = false;
  }

  return results;
}

/**
 * Start the recurring background SLA evaluation timer.
 *
 * @param {number} [intervalMs] - Polling interval in milliseconds (defaults to 60,000ms)
 */
function startSlaScheduler(intervalMs = 60000) {
  if (schedulerTimer) {
    return;
  }

  console.log(`[SLA Scheduler] Service started. Evaluation interval: ${intervalMs / 1000}s`);

  // Run initial evaluation shortly after startup
  setTimeout(() => {
    evaluateSlaComplaints().catch((err) => {
      console.error('[SLA Scheduler] Initial evaluation failed:', err.message);
    });
  }, 2000);

  schedulerTimer = setInterval(() => {
    evaluateSlaComplaints().catch((err) => {
      console.error('[SLA Scheduler] Periodic evaluation failed:', err.message);
    });
  }, intervalMs);
}

/**
 * Stop the background SLA evaluation timer gracefully.
 */
function stopSlaScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[SLA Scheduler] Service stopped.');
  }
}

module.exports = {
  startSlaScheduler,
  stopSlaScheduler,
  evaluateSlaComplaints,
  dispatchSlaNotifications
};
