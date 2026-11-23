/**
 * CivicTrack 2.0 — SLA Policy & Administration Routes
 *
 * Provides endpoints for retrieving active SLA policies, administrative policy updates,
 * SLA queue filtering, and manual evaluation triggers.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const { authenticate, authenticateToken, authorize } = require('../middleware/authMiddleware');
const { DEFAULT_SLA_POLICY, calculateSlaDeadlines, evaluateComplaintSla } = require('../config/slaPolicy');
const { SlaPolicy } = require('../models/SlaPolicy');
const { Complaint, VALID_CATEGORIES, VALID_PRIORITIES } = require('../models/Complaint');
const { evaluateSlaComplaints } = require('../services/slaScheduler');
const { sendNotification } = require('../utils/notificationService');

// Helper to get active policy from database or default
async function getActivePolicy() {
  const custom = await SlaPolicy.findOne({ isActive: true }).sort({ createdAt: -1 });
  if (custom) {
    return custom;
  }
  return DEFAULT_SLA_POLICY;
}

/**
 * @route   GET /api/sla/policy
 * @desc    Get the active municipal SLA policy matrix
 * @access  Protected (Authenticated Citizen, Officer, or Admin)
 */
router.get('/policy', authenticateToken, async (req, res, next) => {
  try {
    const policy = await getActivePolicy();
    return res.status(200).json({
      success: true,
      policy: {
        version: policy.version,
        description: policy.description,
        priorityTargets: policy.priorityTargets,
        categoryResolutionOverrides: policy.categoryResolutionOverrides || {},
        escalationRules: policy.escalationRules || {},
        updatedAt: policy.updatedAt || policy.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/sla/policy
 * @desc    Configure municipal SLA policy targets (Admin only)
 * @access  Protected (Admin only)
 */
router.patch('/policy', authenticateToken, authorize('admin'), async (req, res, next) => {
  try {
    const { priorityTargets, categoryResolutionOverrides, escalationRules, description } = req.body;

    if (!priorityTargets || typeof priorityTargets !== 'object') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Priority targets object is required.'
      });
    }

    // Server-side validation of priority targets
    for (const priority of VALID_PRIORITIES) {
      const target = priorityTargets[priority];
      if (!target || typeof target !== 'object') {
        return res.status(400).json({
          error: 'Bad Request',
          message: `SLA targets missing for priority level: ${priority}`
        });
      }

      const { acknowledgementHours, assignmentHours, resolutionHours, reworkHours } = target;
      const hours = [
        { name: 'acknowledgementHours', val: acknowledgementHours },
        { name: 'assignmentHours', val: assignmentHours },
        { name: 'resolutionHours', val: resolutionHours },
        { name: 'reworkHours', val: reworkHours }
      ];

      for (const h of hours) {
        if (typeof h.val !== 'number' || isNaN(h.val) || h.val < 1 || h.val > 720) {
          return res.status(400).json({
            error: 'Bad Request',
            message: `Target ${h.name} for ${priority} must be a number between 1 and 720 hours.`
          });
        }
      }
    }

    // Generate new version identifier
    const count = await SlaPolicy.countDocuments();
    const newVersion = `v${(1 + (count + 1) * 0.1).toFixed(1)}`;

    const newPolicy = await SlaPolicy.create({
      version: newVersion,
      description: description || `Municipal SLA Policy updated by ${req.user.name}`,
      priorityTargets,
      categoryResolutionOverrides: categoryResolutionOverrides || {},
      escalationRules: escalationRules || DEFAULT_SLA_POLICY.escalationRules,
      isActive: true,
      updatedBy: req.user._id
    });

    // Mark previous policies inactive
    await SlaPolicy.updateMany(
      { _id: { $ne: newPolicy._id } },
      { $set: { isActive: false } }
    );

    return res.status(200).json({
      success: true,
      message: 'SLA policy configuration updated successfully. Applies to new complaints.',
      policy: newPolicy
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/sla/overview
 * @desc    Comprehensive SLA compliance, escalation, and breach performance metrics
 * @access  Protected (Admin only)
 */
router.get('/overview', authenticateToken, authorize('admin'), async (req, res, next) => {
  try {
    const totalComplaints = await Complaint.countDocuments();

    // Active monitored complaints (non-terminal)
    const activeComplaints = await Complaint.find({
      status: { $in: ['Submitted', 'Under Review', 'In Progress', 'Disputed'] }
    });

    let withinSla = 0;
    let approaching = 0;
    let breached = 0;
    let criticallyEscalated = 0;

    const byPriority = { Urgent: 0, High: 0, Medium: 0, Low: 0 };
    const byEscalationLevel = { level0: 0, level1: 0, level2: 0, level3: 0 };

    for (const c of activeComplaints) {
      const level = c.sla?.escalationLevel || 0;
      if (level === 0) {
        withinSla++;
        byEscalationLevel.level0++;
      } else if (level === 1) {
        approaching++;
        byEscalationLevel.level1++;
      } else if (level === 2) {
        breached++;
        byEscalationLevel.level2++;
      } else if (level === 3) {
        criticallyEscalated++;
        byEscalationLevel.level3++;
      }

      if (c.priority && byPriority[c.priority] !== undefined) {
        byPriority[c.priority]++;
      }
    }

    // Resolved compliance metrics
    const resolvedComplaints = await Complaint.find({
      status: 'Resolved'
    }).select('sla resolvedAt createdAt');

    let resolvedWithinSlaCount = 0;
    let totalResolutionDurationMs = 0;
    let resolvedWithDurationCount = 0;

    for (const r of resolvedComplaints) {
      if (r.sla?.isResolvedWithinSla === true) {
        resolvedWithinSlaCount++;
      }
      if (r.sla?.totalResolutionDurationMs) {
        totalResolutionDurationMs += r.sla.totalResolutionDurationMs;
        resolvedWithDurationCount++;
      } else if (r.resolvedAt && r.createdAt) {
        const diff = new Date(r.resolvedAt).getTime() - new Date(r.createdAt).getTime();
        if (diff >= 0) {
          totalResolutionDurationMs += diff;
          resolvedWithDurationCount++;
        }
      }
    }

    const complianceRate = resolvedComplaints.length > 0
      ? Number(((resolvedWithinSlaCount / resolvedComplaints.length) * 100).toFixed(1))
      : 100.0;

    const avgResolutionHours = resolvedWithDurationCount > 0
      ? Number((totalResolutionDurationMs / (resolvedWithDurationCount * 1000 * 60 * 60)).toFixed(1))
      : null;

    // Rework breach count
    const reworkBreaches = await Complaint.countDocuments({
      'sla.breachedStages': 'rework'
    });

    return res.status(200).json({
      success: true,
      slaOverview: {
        totalComplaints,
        activeMonitored: activeComplaints.length,
        withinSla,
        approaching,
        breached,
        criticallyEscalated,
        complianceRate,
        resolvedCount: resolvedComplaints.length,
        resolvedWithinSlaCount,
        avgResolutionHours,
        reworkBreaches,
        byPriority,
        byEscalationLevel
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/sla/evaluate
 * @desc    Manually trigger an immediate SLA evaluation and escalation cycle (Admin only)
 * @access  Protected (Admin only)
 */
router.post('/evaluate', authenticateToken, authorize('admin'), async (req, res, next) => {
  try {
    const results = await evaluateSlaComplaints();
    return res.status(200).json({
      success: true,
      message: 'SLA evaluation and escalation cycle completed.',
      results
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/sla/critical-attention
 * @desc    Get metrics and active complaints requiring critical supervisory attention (Admin only)
 * @access  Protected (Admin only)
 */
router.get('/critical-attention', authenticateToken, authorize('admin'), async (req, res, next) => {
  try {
    const activeFilter = { status: { $in: ['Submitted', 'Under Review', 'In Progress', 'Disputed'] } };

    const criticalComplaints = await Complaint.find({
      ...activeFilter,
      'sla.escalationLevel': 3
    }).populate('citizen', 'name email').populate('assignedOfficer', 'name email department');

    const unacknowledgedComplaints = await Complaint.find({
      ...activeFilter,
      'sla.requiresCriticalAttention': true
    }).populate('citizen', 'name email').populate('assignedOfficer', 'name email department');

    const acknowledgedCount = await Complaint.countDocuments({
      ...activeFilter,
      'sla.criticalAttentionAcknowledgedAt': { $ne: null }
    });

    const byDepartment = {};
    let oldestCriticalAgeHours = null;
    const nowMs = Date.now();

    for (const c of criticalComplaints) {
      const dept = c.department || 'Unassigned';
      byDepartment[dept] = (byDepartment[dept] || 0) + 1;

      const triggerDate = c.sla?.criticalAttentionTriggeredAt || c.sla?.lastEscalatedAt || c.sla?.resolutionDeadline;
      if (triggerDate) {
        const ageHours = (nowMs - new Date(triggerDate).getTime()) / (1000 * 60 * 60);
        if (oldestCriticalAgeHours === null || ageHours > oldestCriticalAgeHours) {
          oldestCriticalAgeHours = ageHours;
        }
      }
    }

    return res.status(200).json({
      success: true,
      criticalAttention: {
        criticalCount: criticalComplaints.length,
        unacknowledgedCount: unacknowledgedComplaints.length,
        acknowledgedCount,
        byDepartment,
        oldestCriticalAgeHours: oldestCriticalAgeHours !== null ? Number(oldestCriticalAgeHours.toFixed(1)) : null,
        complaints: unacknowledgedComplaints.map((c) => c.toSafeObject(req.user))
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/sla/complaints/:id/actions
 * @desc    Record a structured administrative escalation action on a complaint (Admin only)
 * @access  Protected (Admin only)
 */
router.post('/complaints/:id/actions', authenticateToken, authorize('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { actionType, adminNotes, newOfficerId, department } = req.body;

    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id).populate('assignedOfficer', 'name email department')
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() }).populate('assignedOfficer', 'name email department');

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    const ALLOWED_ACTIONS = ['urgent_intervention', 'officer_reassigned', 'supervisory_review', 'admin_note', 'acknowledged'];
    if (!actionType || !ALLOWED_ACTIONS.includes(actionType)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid action type. Allowed types are: ${ALLOWED_ACTIONS.join(', ')}`
      });
    }

    const trimmedNotes = typeof adminNotes === 'string' ? adminNotes.trim() : '';
    if (trimmedNotes.length > 1000) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Admin escalation notes cannot exceed 1000 characters.'
      });
    }

    if (actionType === 'admin_note' && (!trimmedNotes || trimmedNotes.length < 3)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Admin note content is required (minimum 3 characters).'
      });
    }

    if (!complaint.sla) complaint.sla = {};
    if (!complaint.sla.escalationActions) complaint.sla.escalationActions = [];

    let description = '';
    let previousOfficerId = complaint.assignedOfficer?._id || complaint.assignedOfficer || null;
    let previousOfficerName = complaint.assignedOfficer?.name || '';
    let targetOfficer = null;

    if (actionType === 'acknowledged') {
      complaint.sla.requiresCriticalAttention = false;
      complaint.sla.criticalAttentionAcknowledgedAt = new Date();
      complaint.sla.criticalAttentionAcknowledgedBy = req.user._id;
      description = 'Critical SLA escalation acknowledged by municipal administrator.';
    } else if (actionType === 'urgent_intervention') {
      complaint.sla.requiresCriticalAttention = false;
      complaint.sla.criticalAttentionAcknowledgedAt = new Date();
      complaint.sla.criticalAttentionAcknowledgedBy = req.user._id;
      description = trimmedNotes
        ? `Urgent administrative intervention: ${trimmedNotes}`
        : 'Urgent administrative intervention recorded for prioritized field remediation.';
    } else if (actionType === 'supervisory_review') {
      complaint.sla.requiresCriticalAttention = false;
      complaint.sla.criticalAttentionAcknowledgedAt = new Date();
      complaint.sla.criticalAttentionAcknowledgedBy = req.user._id;
      description = trimmedNotes
        ? `Supervisory review: ${trimmedNotes}`
        : 'Supervisory management review completed.';
    } else if (actionType === 'admin_note') {
      description = `Administrative supervisory note added: ${trimmedNotes.slice(0, 100)}`;
    } else if (actionType === 'officer_reassigned') {
      if (!newOfficerId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'New officer ID (newOfficerId) is required for reassignment.'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(newOfficerId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid officer ID format.'
        });
      }

      targetOfficer = await User.findById(newOfficerId);
      if (!targetOfficer || targetOfficer.role !== 'officer') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Target user is not an active, authorized municipal officer.'
        });
      }

      const isSameOfficer = previousOfficerId && previousOfficerId.toString() === targetOfficer._id.toString();
      if (isSameOfficer) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Complaint is already assigned to officer ${targetOfficer.name}.`
        });
      }

      // Reassign officer and update department if provided
      complaint.assignedOfficer = targetOfficer._id;
      if (department && typeof department === 'string' && department.trim()) {
        complaint.department = department.trim();
      } else if (targetOfficer.department) {
        complaint.department = targetOfficer.department;
      }

      // Append to status history
      const reassignmentComment = `Officer reassigned to ${targetOfficer.name}${complaint.department ? ` (${complaint.department})` : ''} via SLA supervisory action. ${trimmedNotes ? `Notes: ${trimmedNotes}` : ''}`;
      complaint.statusHistory.push({
        status: complaint.status,
        timestamp: new Date(),
        comment: reassignmentComment.trim(),
        actor: req.user._id,
        actorRole: 'admin'
      });

      // Clear unacknowledged critical flag upon intervention
      complaint.sla.requiresCriticalAttention = false;
      complaint.sla.criticalAttentionAcknowledgedAt = new Date();
      complaint.sla.criticalAttentionAcknowledgedBy = req.user._id;

      description = `Officer reassigned to ${targetOfficer.name}${complaint.department ? ` (${complaint.department})` : ''}.`;

      // Notifications
      await sendNotification({
        recipient: targetOfficer._id,
        actor: req.user._id,
        actorRole: 'admin',
        complaint: complaint._id,
        trackingId: complaint.trackingId,
        type: 'complaint_reassigned',
        title: 'Priority Escalation: Complaint Reassigned',
        message: `Complaint ${complaint.trackingId} has been reassigned to you by municipal administration under active SLA oversight.`
      });

      if (previousOfficerId) {
        await sendNotification({
          recipient: previousOfficerId,
          actor: req.user._id,
          actorRole: 'admin',
          complaint: complaint._id,
          trackingId: complaint.trackingId,
          type: 'complaint_reassigned',
          title: 'Complaint Reassigned to Another Officer',
          message: `Complaint ${complaint.trackingId} has been reassigned to officer ${targetOfficer.name}.`
        });
      }
    }

    const actionRecord = {
      actionType,
      escalationLevel: complaint.sla.escalationLevel || 0,
      description,
      adminNotes: trimmedNotes,
      actionTakenAt: new Date(),
      performedBy: req.user._id,
      performedByName: req.user.name,
      previousOfficer: previousOfficerId,
      previousOfficerName,
      newOfficer: targetOfficer ? targetOfficer._id : null,
      newOfficerName: targetOfficer ? targetOfficer.name : ''
    };

    complaint.sla.escalationActions.push(actionRecord);
    await complaint.save();

    const populatedComplaint = await Complaint.findById(complaint._id)
      .populate('citizen', 'name email')
      .populate('assignedOfficer', 'name email department');

    return res.status(200).json({
      success: true,
      message: 'Escalation action recorded successfully.',
      complaint: populatedComplaint.toSafeObject(req.user),
      action: actionRecord
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/sla/complaints/:id/actions
 * @desc    Retrieve internal escalation action history (Admin only)
 * @access  Protected (Admin only)
 */
router.get('/complaints/:id/actions', authenticateToken, authorize('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const complaint = mongoose.Types.ObjectId.isValid(id)
      ? await Complaint.findById(id).select('sla trackingId title')
      : await Complaint.findOne({ trackingId: id.trim().toUpperCase() }).select('sla trackingId title');

    if (!complaint) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Complaint not found.'
      });
    }

    return res.status(200).json({
      success: true,
      trackingId: complaint.trackingId,
      actions: complaint.sla?.escalationActions || []
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
