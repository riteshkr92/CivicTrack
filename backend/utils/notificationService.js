const { Notification } = require('../models/Notification');
const User = require('../models/User');

/**
 * Dispatch an in-app notification securely on the backend.
 *
 * @param {Object} params
 * @param {ObjectId} params.recipient - Target User ID
 * @param {ObjectId} [params.actor] - Originating User ID
 * @param {string} [params.actorRole] - 'citizen' | 'officer' | 'admin' | 'system'
 * @param {ObjectId} params.complaint - Complaint ObjectId
 * @param {string} params.trackingId - Complaint Tracking ID
 * @param {string} params.type - One of NOTIFICATION_TYPES
 * @param {string} params.title - Short summary
 * @param {string} params.message - Descriptive text
 */
async function sendNotification({
  recipient,
  actor = null,
  actorRole = 'system',
  complaint,
  trackingId,
  type,
  title,
  message
}) {
  if (!recipient || !complaint || !trackingId || !type) {
    return null;
  }

  try {
    // Respect recipient notification preferences if explicitly disabled
    const recipientUser = await User.findById(recipient).select('notificationPreferences');
    if (recipientUser && recipientUser.notificationPreferences) {
      const prefs = recipientUser.notificationPreferences;
      if (['status_changed', 'complaint_resolved', 'notes_updated'].includes(type) && prefs.complaintStatusUpdates === false) {
        return null;
      }
      if (['complaint_assigned', 'complaint_reassigned'].includes(type) && prefs.complaintAssignments === false) {
        return null;
      }
      if (['sla_warning', 'sla_breached', 'sla_escalated', 'sla_rework_warning', 'sla_rework_breached'].includes(type) && prefs.slaWarningsAndBreaches === false) {
        return null;
      }
      if (['work_completed', 'resolution_confirmed', 'resolution_disputed', 'resolution_admin_closed', 'resolution_reopened'].includes(type) && prefs.resolutionDisputeUpdates === false) {
        return null;
      }
    }

    // Event-specific deduplication guard: avoid double-creation for the identical event within 5 seconds
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const existing = await Notification.findOne({
      recipient,
      complaint,
      type,
      title,
      createdAt: { $gte: fiveSecondsAgo }
    }).select('_id');

    if (existing) {
      return existing;
    }

    const notification = new Notification({
      recipient,
      actor,
      actorRole,
      complaint,
      trackingId,
      type,
      title,
      message,
      isRead: false
    });

    await notification.save();
    return notification;
  } catch (error) {
    // Log without interrupting the primary complaint workflow
    console.error(`[Notification Service] Failed to create notification: ${error.message}`);
    return null;
  }
}

module.exports = {
  sendNotification
};
