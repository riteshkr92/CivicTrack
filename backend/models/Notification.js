const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'complaint_assigned',
  'complaint_reassigned',
  'status_changed',
  'complaint_resolved',
  'notes_updated'
];

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient user reference is required'],
      index: true
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    actorRole: {
      type: String,
      enum: ['citizen', 'officer', 'admin', 'system'],
      default: 'system'
    },
    complaint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Complaint',
      required: [true, 'Complaint reference is required'],
      index: true
    },
    trackingId: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      required: true,
      enum: NOTIFICATION_TYPES
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: [150, 'Title cannot exceed 150 characters']
    },
    message: {
      type: String,
      required: [true, 'Notification message is required'],
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters']
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index for user notification inbox queries
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

notificationSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

notificationSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    recipient: this.recipient,
    actor: this.actor,
    actorRole: this.actorRole,
    complaint: this.complaint,
    trackingId: this.trackingId,
    type: this.type,
    title: this.title,
    message: this.message,
    isRead: this.isRead,
    readAt: this.readAt,
    createdAt: this.createdAt
  };
};

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = {
  Notification,
  NOTIFICATION_TYPES
};
