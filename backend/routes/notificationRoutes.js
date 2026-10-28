const express = require('express');
const mongoose = require('mongoose');
const { Notification } = require('../models/Notification');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// All notification endpoints require authenticated user
router.use(authenticate);

/**
 * @route   GET /api/notifications
 * @desc    Retrieve notifications for the authenticated user
 * @access  Protected (All authenticated roles)
 */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const query = { recipient: req.user._id };

    if (req.query.unreadOnly === 'true') {
      query.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('complaint', 'trackingId title status category')
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipient: req.user._id, isRead: false })
    ]);

    return res.status(200).json({
      notifications: notifications.map((n) => ({
        id: n._id,
        _id: n._id,
        recipient: n.recipient,
        actor: n.actor,
        actorRole: n.actorRole,
        complaint: n.complaint,
        trackingId: n.trackingId,
        type: n.type,
        title: n.title,
        message: n.message,
        isRead: n.isRead,
        readAt: n.readAt,
        createdAt: n.createdAt
      })),
      unreadCount,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/notifications/:id/read
 * @desc    Mark a single notification as read
 * @access  Protected (Recipient only)
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid notification ID format.'
      });
    }

    // Must be recipient to mark as read
    const notification = await Notification.findOne({
      _id: id,
      recipient: req.user._id
    });

    if (!notification) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Notification not found or access denied.'
      });
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false
    });

    return res.status(200).json({
      message: 'Notification marked as read',
      notification: notification.toSafeObject(),
      unreadCount
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/notifications/read-all
 * @desc    Mark all unread notifications for the user as read
 * @access  Protected (Recipient only)
 */
router.patch('/read-all', async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.status(200).json({
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount,
      unreadCount: 0
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
