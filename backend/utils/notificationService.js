const { Notification } = require('../models/Notification');

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
