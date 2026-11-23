/**
 * CivicTrack 2.0 — Smart SLA Policy Configuration & Helpers
 *
 * Defines default acknowledgement, assignment, resolution, and rework timeframes
 * based on complaint priority and civic category.
 *
 * Note: These values represent proposed default project configurations,
 * not official municipal service regulations.
 */

const DEFAULT_SLA_POLICY = {
  version: 'v1.0',
  description: 'Default Municipal Smart SLA Policy Matrix',
  updatedAt: new Date('2026-11-01T00:00:00Z'),

  // Priority-driven baseline targets (in hours)
  priorityTargets: {
    Urgent: {
      acknowledgementHours: 2,
      assignmentHours: 4,
      resolutionHours: 24,
      reworkHours: 12
    },
    High: {
      acknowledgementHours: 6,
      assignmentHours: 12,
      resolutionHours: 48,
      reworkHours: 24
    },
    Medium: {
      acknowledgementHours: 12,
      assignmentHours: 24,
      resolutionHours: 96,
      reworkHours: 48
    },
    Low: {
      acknowledgementHours: 24,
      assignmentHours: 48,
      resolutionHours: 168,
      reworkHours: 72
    }
  },

  // Category-specific resolution target adjustments (in hours, optional overrides)
  categoryResolutionOverrides: {
    'Garbage/Waste': {
      Urgent: 12,
      High: 24,
      Medium: 48,
      Low: 96
    },
    'Water Supply': {
      Urgent: 18,
      High: 36,
      Medium: 72,
      Low: 120
    },
    'Drainage/Waterlogging': {
      Urgent: 18,
      High: 36,
      Medium: 72,
      Low: 120
    }
  },

  // Thresholds for escalation progression
  escalationRules: {
    // Level 1: Approaching deadline when remaining time ratio is <= 0.25 (25%) or <= 4 hours
    warningWindowRatio: 0.25,
    minWarningWindowHours: 4,

    // Level 2: Breached when elapsed time exceeds deadline (past 0h remaining)
    breachLevel: 2,

    // Level 3: Critical management escalation when overdue by > 24 hours
    criticalOverdueHours: 24
  }
};

/**
 * Calculate complete SLA milestone deadlines for a newly submitted complaint.
 *
 * @param {Object} params
 * @param {string} params.category - Complaint category
 * @param {string} params.priority - Complaint priority ('Urgent', 'High', 'Medium', 'Low')
 * @param {Date|string} [params.createdAt] - Reference timestamp (defaults to Date.now())
 * @param {Object} [params.customPolicy] - Optional active municipal policy override
 * @returns {Object} Calculated SLA schedule
 */
function calculateSlaDeadlines(param1, param2, param3, param4) {
  let category, priority, createdAt, customPolicy;
  if (param1 && typeof param1 === 'object' && !(param1 instanceof Date)) {
    category = param1.category;
    priority = param1.priority;
    createdAt = param1.createdAt || new Date();
    customPolicy = param1.customPolicy || null;
  } else {
    category = param1;
    priority = param2;
    createdAt = param3 || new Date();
    customPolicy = param4 || null;
  }

  const policy = customPolicy || DEFAULT_SLA_POLICY;
  const safePriority = policy.priorityTargets[priority] ? priority : 'Medium';
  const targets = policy.priorityTargets[safePriority];

  const startTime = new Date(createdAt);
  const nowMs = startTime.getTime();

  // Determine resolution hours (checking for category override first)
  const categoryOverrides = policy.categoryResolutionOverrides?.[category];
  const resolutionHours = categoryOverrides?.[safePriority] || targets.resolutionHours;

  const ackMs = targets.acknowledgementHours * 60 * 60 * 1000;
  const assignMs = targets.assignmentHours * 60 * 60 * 1000;
  const resMs = resolutionHours * 60 * 60 * 1000;

  return {
    policyVersion: policy.version || 'v1.0',
    startedAt: startTime,
    acknowledgementDeadline: new Date(nowMs + ackMs),
    assignmentDeadline: new Date(nowMs + assignMs),
    resolutionDeadline: new Date(nowMs + resMs),
    resolutionHours: resolutionHours,
    acknowledgementHours: targets.acknowledgementHours,
    assignmentHours: targets.assignmentHours,
    reworkHours: targets.reworkHours
  };
}

/**
 * Calculate SLA deadline for a complaint reopened for rework.
 * Supports both object parameter ({ priority, reworkStartedAt, customPolicy })
 * and positional parameters (priority, reworkStartedAt, customPolicy).
 */
function calculateReworkDeadline(param1, param2, param3) {
  let priority, reworkStartedAt, customPolicy;
  if (param1 && typeof param1 === 'object' && !(param1 instanceof Date)) {
    priority = param1.priority;
    reworkStartedAt = param1.reworkStartedAt || new Date();
    customPolicy = param1.customPolicy || null;
  } else {
    priority = param1;
    reworkStartedAt = param2 || new Date();
    customPolicy = param3 || null;
  }

  const policy = customPolicy || DEFAULT_SLA_POLICY;
  const safePriority = policy.priorityTargets[priority] ? priority : 'Medium';
  const reworkHours = policy.priorityTargets[safePriority]?.reworkHours || 48;

  const startMs = new Date(reworkStartedAt).getTime();
  return new Date(startMs + reworkHours * 60 * 60 * 1000);
}

/**
 * Evaluate SLA status and determine applicable escalation level for an active complaint.
 *
 * @param {Object} complaint - Complaint document or plain object
 * @param {Date} [referenceDate] - Current evaluation timestamp (defaults to Date.now())
 * @returns {Object} Evaluation summary { level, isBreached, stage, message }
 */
function evaluateComplaintSla(complaint, referenceDate = new Date()) {
  const now = new Date(referenceDate).getTime();
  const status = complaint.status;
  const sla = complaint.sla || {};

  // Terminal states stop active evaluation
  if (status === 'Resolved' || status === 'Rejected') {
    return {
      active: false,
      level: 0,
      isBreached: Boolean(sla.isBreached),
      breachedStages: sla.breachedStages || [],
      message: `Complaint is ${status}; active SLA monitoring concluded.`
    };
  }

  // Provisionally Resolved: work submitted, awaiting citizen review
  if (status === 'Provisionally Resolved') {
    return {
      active: false,
      level: 0,
      isBreached: Boolean(sla.isBreached),
      breachedStages: sla.breachedStages || [],
      message: 'Work completion evidence submitted; pending citizen resolution review.'
    };
  }

  let isBreached = Boolean(sla.isBreached);
  const breachedStages = new Set(sla.breachedStages || []);
  let highestLevel = 0;
  let primaryStage = 'resolution';
  let breachReason = '';

  // 1. Check Acknowledgement SLA (applies when still Submitted)
  if (status === 'Submitted' && sla.acknowledgementDeadline) {
    const ackDeadline = new Date(sla.acknowledgementDeadline).getTime();
    if (now > ackDeadline) {
      isBreached = true;
      breachedStages.add('acknowledgement');
      const overdueHours = (now - ackDeadline) / (1000 * 60 * 60);
      const lvl = overdueHours > 24 ? 3 : 2;
      if (lvl > highestLevel) {
        highestLevel = lvl;
        primaryStage = 'acknowledgement';
        breachReason = `Acknowledgement deadline exceeded by ${overdueHours.toFixed(1)}h`;
      }
    }
  }

  // 2. Check Assignment SLA (applies when Submitted or Under Review without officer)
  if (!complaint.assignedOfficer && sla.assignmentDeadline && (status === 'Submitted' || status === 'Under Review')) {
    const assignDeadline = new Date(sla.assignmentDeadline).getTime();
    if (now > assignDeadline) {
      isBreached = true;
      breachedStages.add('assignment');
      const overdueHours = (now - assignDeadline) / (1000 * 60 * 60);
      const lvl = overdueHours > 24 ? 3 : 2;
      if (lvl > highestLevel) {
        highestLevel = lvl;
        primaryStage = 'assignment';
        breachReason = `Assignment deadline exceeded by ${overdueHours.toFixed(1)}h`;
      }
    }
  }

  // 3. Check Rework SLA (if complaint is in rework status)
  if (complaint.reworkCount > 0 && sla.reworkDeadline && (status === 'In Progress' || status === 'Disputed')) {
    const reworkDeadline = new Date(sla.reworkDeadline).getTime();
    const reworkStart = sla.reworkStartedAt ? new Date(sla.reworkStartedAt).getTime() : (reworkDeadline - 24 * 3600 * 1000);
    const totalReworkMs = reworkDeadline - reworkStart;

    if (now > reworkDeadline) {
      isBreached = true;
      breachedStages.add('rework');
      const overdueHours = (now - reworkDeadline) / (1000 * 60 * 60);
      const lvl = overdueHours > 24 ? 3 : 2;
      if (lvl > highestLevel) {
        highestLevel = lvl;
        primaryStage = 'rework';
        breachReason = `Rework SLA deadline exceeded by ${overdueHours.toFixed(1)}h`;
      }
    } else {
      const remainingMs = reworkDeadline - now;
      const warningWindowMs = Math.max(totalReworkMs * 0.25, 4 * 3600 * 1000);
      if (remainingMs <= warningWindowMs && highestLevel < 1) {
        highestLevel = 1;
        primaryStage = 'rework';
        breachReason = `Rework deadline approaching (${(remainingMs / (1000 * 60 * 60)).toFixed(1)}h remaining)`;
      }
    }
  }

  // 4. Check Overall Resolution SLA (applies to In Progress, Under Review, Disputed)
  if (sla.resolutionDeadline && (status === 'In Progress' || status === 'Under Review' || status === 'Disputed')) {
    const resDeadline = new Date(sla.resolutionDeadline).getTime();
    const startTime = sla.startedAt ? new Date(sla.startedAt).getTime() : new Date(complaint.createdAt).getTime();
    const totalDurationMs = resDeadline - startTime;

    if (now > resDeadline) {
      isBreached = true;
      breachedStages.add('resolution');
      const overdueHours = (now - resDeadline) / (1000 * 60 * 60);
      const lvl = overdueHours > 24 ? 3 : 2;
      if (lvl > highestLevel) {
        highestLevel = lvl;
        primaryStage = 'resolution';
        breachReason = `Resolution deadline exceeded by ${overdueHours.toFixed(1)}h`;
      }
    } else {
      const remainingMs = resDeadline - now;
      const warningWindowMs = Math.max(totalDurationMs * 0.25, 4 * 3600 * 1000);
      if (remainingMs <= warningWindowMs && highestLevel < 1) {
        highestLevel = 1;
        primaryStage = 'resolution';
        breachReason = `Resolution deadline approaching (${(remainingMs / (1000 * 60 * 60)).toFixed(1)}h remaining)`;
      }
    }
  }

  return {
    active: true,
    level: highestLevel,
    isBreached,
    breachedStages: Array.from(breachedStages),
    primaryStage,
    breachReason: breachReason || (highestLevel === 0 ? 'Within SLA tolerances' : 'SLA milestone requires attention')
  };
}

module.exports = {
  DEFAULT_SLA_POLICY,
  calculateSlaDeadlines,
  calculateReworkDeadline,
  evaluateComplaintSla
};
