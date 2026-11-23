const mongoose = require('mongoose');
const crypto = require('crypto');

const VALID_CATEGORIES = [
  'Pothole/Road Damage',
  'Garbage/Waste',
  'Streetlight',
  'Drainage/Waterlogging',
  'Water Supply',
  'Other'
];

const VALID_STATUSES = [
  'Submitted',
  'Under Review',
  'In Progress',
  'Provisionally Resolved',
  'Disputed',
  'Resolved',
  'Rejected'
];

const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: VALID_STATUSES
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [500, 'Comment cannot exceed 500 characters'],
      default: ''
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    actorRole: {
      type: String,
      enum: ['citizen', 'officer', 'admin', 'system'],
      default: null
    }
  },
  { _id: true }
);

const locationSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: [true, 'Location address or description is required'],
      trim: true,
      minlength: [3, 'Location description must be at least 3 characters long'],
      maxlength: [250, 'Location description cannot exceed 250 characters']
    },
    latitude: {
      type: Number,
      default: null,
      validate: {
        validator: function (v) {
          if (v === null || v === undefined) return true;
          return typeof v === 'number' && !isNaN(v) && v >= -90 && v <= 90;
        },
        message: 'Latitude must be a valid number between -90 and 90'
      }
    },
    longitude: {
      type: Number,
      default: null,
      validate: {
        validator: function (v) {
          if (v === null || v === undefined) return true;
          return typeof v === 'number' && !isNaN(v) && v >= -180 && v <= 180;
        },
        message: 'Longitude must be a valid number between -180 and 180'
      }
    }
  },
  { _id: false }
);

const evidenceSchema = new mongoose.Schema(
  {
    imageUrl: {
      type: String,
      default: null
    },
    storageKey: {
      type: String,
      default: null
    },
    sha256: {
      type: String,
      default: null
    },
    originalFilename: {
      type: String,
      default: null
    },
    originalName: {
      type: String,
      default: null
    },
    mimetype: {
      type: String,
      default: null
    },
    mimeType: {
      type: String,
      default: null
    },
    size: {
      type: Number,
      default: null
    },
    sizeBytes: {
      type: Number,
      default: null
    },
    capturedAt: {
      type: Date,
      default: null
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    coordinates: {
      latitude: {
        type: Number,
        default: null,
        validate: {
          validator: function (v) {
            if (v === null || v === undefined) return true;
            return typeof v === 'number' && !isNaN(v) && v >= -90 && v <= 90;
          },
          message: 'Evidence latitude must be a valid number between -90 and 90'
        }
      },
      longitude: {
        type: Number,
        default: null,
        validate: {
          validator: function (v) {
            if (v === null || v === undefined) return true;
            return typeof v === 'number' && !isNaN(v) && v >= -180 && v <= 180;
          },
          message: 'Evidence longitude must be a valid number between -180 and 180'
        }
      },
      accuracy: {
        type: Number,
        default: null
      },
      accuracyMeters: {
        type: Number,
        default: null
      }
    },
    locationSource: {
      type: String,
      enum: ['device_gps', 'exif', 'user_declared', 'user_confirmed', 'device_capture', 'browser_geolocation', 'user_confirmed_upload'],
      default: 'device_gps'
    },
    exifMetadata: {
      hasGps: { type: Boolean, default: false },
      gpsLatitude: { type: Number, default: null },
      gpsLongitude: { type: Number, default: null },
      matchResult: {
        type: String,
        enum: ['matched', 'missing', 'mismatched', 'unavailable'],
        default: 'unavailable'
      },
      distanceMeters: { type: Number, default: null },
      notes: { type: String, default: '' }
    },
    exifComparisonStatus: {
      type: String,
      enum: ['matched', 'mismatch', 'no_exif_gps', 'not_applicable'],
      default: 'not_applicable'
    },
    verificationStatus: {
      type: String,
      enum: ['location_captured', 'exif_matched', 'exif_missing', 'location_mismatch', 'unverified'],
      default: 'location_captured'
    },
    verificationReason: {
      type: String,
      default: ''
    }
  },
  { _id: false }
);

const completionEvidenceSchema = new mongoose.Schema(
  {
    imageUrl: {
      type: String,
      default: null
    },
    storageKey: {
      type: String,
      default: null
    },
    sha256: {
      type: String,
      default: null
    },
    originalFilename: {
      type: String,
      default: null
    },
    originalName: {
      type: String,
      default: null
    },
    mimetype: {
      type: String,
      default: null
    },
    mimeType: {
      type: String,
      default: null
    },
    size: {
      type: Number,
      default: null
    },
    sizeBytes: {
      type: Number,
      default: null
    },
    capturedAt: {
      type: Date,
      default: null
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    coordinates: {
      latitude: {
        type: Number,
        default: null,
        validate: {
          validator: function (v) {
            if (v === null || v === undefined) return true;
            return typeof v === 'number' && !isNaN(v) && v >= -90 && v <= 90;
          },
          message: 'Completion evidence latitude must be a valid number between -90 and 90'
        }
      },
      longitude: {
        type: Number,
        default: null,
        validate: {
          validator: function (v) {
            if (v === null || v === undefined) return true;
            return typeof v === 'number' && !isNaN(v) && v >= -180 && v <= 180;
          },
          message: 'Completion evidence longitude must be a valid number between -180 and 180'
        }
      },
      accuracy: {
        type: Number,
        default: null
      },
      accuracyMeters: {
        type: Number,
        default: null
      }
    },
    locationSource: {
      type: String,
      enum: ['device_gps', 'exif', 'user_declared', 'user_confirmed', 'device_capture', 'browser_geolocation', 'user_confirmed_upload', 'manual', 'estimated'],
      default: 'device_gps'
    },
    resolutionNotes: {
      type: String,
      trim: true,
      maxlength: [2000, 'Completion resolution notes cannot exceed 2000 characters'],
      default: ''
    },
    exifMetadata: {
      hasGps: { type: Boolean, default: false },
      gpsLatitude: { type: Number, default: null },
      gpsLongitude: { type: Number, default: null },
      matchResult: {
        type: String,
        enum: ['matched', 'missing', 'mismatched', 'unavailable'],
        default: 'unavailable'
      },
      distanceMeters: { type: Number, default: null },
      notes: { type: String, default: '' }
    },
    exifComparisonStatus: {
      type: String,
      enum: ['matched', 'verified', 'mismatch', 'location_mismatch', 'date_mismatch', 'no_exif_gps', 'no_metadata', 'not_applicable', 'flagged'],
      default: 'not_applicable'
    },
    distanceMeters: {
      type: Number,
      default: null
    },
    verificationStatus: {
      type: String,
      enum: ['verified', 'passed', 'warning', 'failed', 'distance_mismatch', 'exif_missing', 'low_accuracy_gps', 'unverified', 'skipped'],
      default: 'unverified'
    },
    verificationReason: {
      type: String,
      default: ''
    }
  },
  { _id: false }
);

const disputePhotoSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, default: null },
    storageKey: { type: String, default: null },
    sha256: { type: String, default: null },
    originalName: { type: String, default: null },
    mimeType: { type: String, default: null },
    sizeBytes: { type: Number, default: null },
    submittedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const resolutionDisputeSchema = new mongoose.Schema(
  {
    reason: {
      type: String,
      required: [true, 'Dispute reason is required'],
      trim: true,
      minlength: [10, 'Dispute reason must be at least 10 characters long'],
      maxlength: [1000, 'Dispute reason cannot exceed 1000 characters']
    },
    photo: {
      type: disputePhotoSchema,
      default: null
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    citizen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Disputing citizen reference is required']
    },
    status: {
      type: String,
      enum: ['pending_review', 'resolved_by_admin', 'returned_in_progress'],
      default: 'pending_review'
    },
    adminDecision: {
      type: String,
      enum: ['confirm_resolution', 'return_in_progress', null],
      default: null
    },
    adminNotes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Admin dispute notes cannot exceed 1000 characters'],
      default: ''
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { _id: false }
);

const escalationHistorySchema = new mongoose.Schema(
  {
    level: {
      type: Number,
      required: true,
      min: [0, 'Escalation level minimum is 0'],
      max: [3, 'Escalation level maximum is 3']
    },
    stage: {
      type: String,
      enum: ['acknowledgement', 'assignment', 'resolution', 'rework', 'general'],
      default: 'general'
    },
    triggeredAt: {
      type: Date,
      default: Date.now
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    actionTaken: {
      type: String,
      default: '',
      trim: true
    },
    notifiedRoles: [{
      type: String,
      enum: ['admin', 'officer', 'citizen']
    }]
  },
  { _id: true }
);

const escalationActionSchema = new mongoose.Schema(
  {
    actionType: {
      type: String,
      required: true,
      enum: ['urgent_intervention', 'officer_reassigned', 'supervisory_review', 'admin_note', 'acknowledged']
    },
    escalationLevel: {
      type: Number,
      required: true,
      min: [0, 'Escalation level minimum is 0'],
      max: [3, 'Escalation level maximum is 3']
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    adminNotes: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000
    },
    actionTakenAt: {
      type: Date,
      default: Date.now
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    performedByName: {
      type: String,
      default: ''
    },
    previousOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    previousOfficerName: {
      type: String,
      default: ''
    },
    newOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    newOfficerName: {
      type: String,
      default: ''
    }
  },
  { _id: true }
);

const slaSchema = new mongoose.Schema(
  {
    policyVersion: {
      type: String,
      default: 'v1.0'
    },
    startedAt: {
      type: Date,
      default: null
    },
    acknowledgementDeadline: {
      type: Date,
      default: null
    },
    acknowledgedAt: {
      type: Date,
      default: null
    },
    assignmentDeadline: {
      type: Date,
      default: null
    },
    assignedAt: {
      type: Date,
      default: null
    },
    workStartedAt: {
      type: Date,
      default: null
    },
    resolutionDeadline: {
      type: Date,
      default: null
    },
    provisionallyResolvedAt: {
      type: Date,
      default: null
    },
    disputedAt: {
      type: Date,
      default: null
    },
    reworkDeadline: {
      type: Date,
      default: null
    },
    reworkStartedAt: {
      type: Date,
      default: null
    },
    isReworkBreached: {
      type: Boolean,
      default: false
    },
    stoppedAt: {
      type: Date,
      default: null
    },
    isBreached: {
      type: Boolean,
      default: false,
      index: true
    },
    breachedStages: [{
      type: String,
      enum: ['acknowledgement', 'assignment', 'resolution', 'rework']
    }],
    isResolvedWithinSla: {
      type: Boolean,
      default: null
    },
    totalResolutionDurationMs: {
      type: Number,
      default: null
    },
    escalationLevel: {
      type: Number,
      default: 0,
      min: [0, 'Escalation level minimum is 0'],
      max: [3, 'Escalation level maximum is 3'],
      index: true
    },
    lastEscalatedAt: {
      type: Date,
      default: null
    },
    requiresCriticalAttention: {
      type: Boolean,
      default: false,
      index: true
    },
    criticalAttentionTriggeredAt: {
      type: Date,
      default: null
    },
    criticalAttentionAcknowledgedAt: {
      type: Date,
      default: null
    },
    criticalAttentionAcknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    escalationActions: {
      type: [escalationActionSchema],
      default: []
    },
    escalationHistory: {
      type: [escalationHistorySchema],
      default: []
    },
    warningNotifiedStages: {
      type: [String],
      default: []
    },
    breachNotifiedStages: {
      type: [String],
      default: []
    }
  },
  { _id: false }
);

const complaintSchema = new mongoose.Schema(
  {
    trackingId: {
      type: String,
      required: [true, 'Tracking ID is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [3, 'Title must be at least 3 characters long'],
      maxlength: [150, 'Title cannot exceed 150 characters']
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      minlength: [10, 'Description must be at least 10 characters long'],
      maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: {
        values: VALID_CATEGORIES,
        message: `Category must be one of: ${VALID_CATEGORIES.join(', ')}`
      }
    },
    location: {
      type: locationSchema,
      required: [true, 'Location details are required']
    },
    priority: {
      type: String,
      enum: {
        values: VALID_PRIORITIES,
        message: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}`
      },
      default: 'Medium'
    },
    status: {
      type: String,
      enum: {
        values: VALID_STATUSES,
        message: `Status must be one of: ${VALID_STATUSES.join(', ')}`
      },
      default: 'Submitted'
    },
    citizen: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Citizen reference is required'],
      index: true
    },
    assignedOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    department: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    resolutionNotes: {
      type: String,
      trim: true,
      maxlength: [2000, 'Resolution notes cannot exceed 2000 characters'],
      default: ''
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    evidence: {
      type: evidenceSchema,
      default: null
    },
    completionEvidence: {
      type: completionEvidenceSchema,
      default: null
    },
    resolutionDispute: {
      type: resolutionDisputeSchema,
      default: null
    },
    reworkCount: {
      type: Number,
      default: 0,
      min: [0, 'Rework count cannot be negative']
    },
    sla: {
      type: slaSchema,
      default: () => ({})
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

// Compound and auxiliary indexes for efficient sorting and filtering
complaintSchema.index({ citizen: 1, createdAt: -1 });
complaintSchema.index({ assignedOfficer: 1, status: 1 });
complaintSchema.index({ department: 1, status: 1 });
complaintSchema.index({ status: 1 });
complaintSchema.index({ 'sla.isBreached': 1, status: 1 });
complaintSchema.index({ 'sla.escalationLevel': 1, status: 1 });
complaintSchema.index({ 'sla.resolutionDeadline': 1 });

/**
 * Generate a unique public tracking reference.
 * Format: CT-YYYYMMDD-XXXX (e.g. CT-20261022-7F3A)
 * Retries up to 5 times to safely resolve any collision.
 */
complaintSchema.statics.generateTrackingId = async function () {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    const candidateId = `CT-${dateStr}-${randomHex}`;

    const exists = await this.findOne({ trackingId: candidateId }).select('_id').lean();
    if (!exists) {
      return candidateId;
    }
    attempts++;
  }

  // Fallback with higher entropy if collision occurred repeatedly
  const highEntropy = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `CT-${dateStr}-${highEntropy}`;
};

// Safe JSON serialization
complaintSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

complaintSchema.methods.toSafeObject = function (viewer = null) {
  const hasEv = Boolean(
    this.evidence &&
    (this.evidence.storageKey || this.evidence.imageUrl || this.evidence.filename || this.evidence.originalName || this.evidence.originalFilename)
  );
  const hasCompEv = Boolean(
    this.completionEvidence &&
    (this.completionEvidence.storageKey || this.completionEvidence.imageUrl)
  );
  const hasDispute = Boolean(
    this.resolutionDispute &&
    this.resolutionDispute.reason
  );

  // Determine authorization for sensitive officer completion telemetry
  const viewerId = viewer ? (viewer._id || viewer.id)?.toString() : null;
  const isAdmin = Boolean(viewer && viewer.role === 'admin');
  const citizenId = this.citizen ? (this.citizen._id || this.citizen)?.toString() : null;
  const isOwner = Boolean(viewerId && citizenId && viewerId === citizenId);

  const officerId = this.assignedOfficer ? (this.assignedOfficer._id || this.assignedOfficer)?.toString() : null;
  const isAssigned = Boolean(viewerId && officerId && viewerId === officerId);

  const isAuthorized = Boolean(isAdmin || isOwner || isAssigned);

  let safeEvidence = null;
  if (this.evidence) {
    const raw = typeof this.evidence.toObject === 'function' ? this.evidence.toObject() : { ...this.evidence };
    delete raw.storageKey;
    delete raw.filePath;
    delete raw.sha256;
    safeEvidence = raw;
  }

  let safeCompletionEvidence = null;
  if (this.completionEvidence) {
    const raw = typeof this.completionEvidence.toObject === 'function' ? this.completionEvidence.toObject() : { ...this.completionEvidence };
    delete raw.storageKey;
    delete raw.filePath;
    delete raw.sha256;

    // GPS Privacy Protection:
    // Exact officer completion GPS coordinates and raw EXIF coordinates are only accessible to
    // authorized parties (complaint owner citizen, assigned officer, admin).
    // For unauthenticated public tracking or unauthorized viewers, exact telemetry is stripped.
    if (!isAuthorized) {
      delete raw.coordinates;
      if (raw.exifMetadata) {
        const safeExif = { ...raw.exifMetadata };
        delete safeExif.gpsLatitude;
        delete safeExif.gpsLongitude;
        raw.exifMetadata = safeExif;
      }
    }

    safeCompletionEvidence = raw;
  }

  let safeDispute = null;
  if (this.resolutionDispute) {
    const raw = typeof this.resolutionDispute.toObject === 'function' ? this.resolutionDispute.toObject() : { ...this.resolutionDispute };
    if (raw.photo) {
      delete raw.photo.storageKey;
      delete raw.photo.filePath;
      delete raw.photo.sha256;
    }
    safeDispute = raw;
  }

  let safeSla = null;
  if (this.sla) {
    const rawSla = typeof this.sla.toObject === 'function' ? this.sla.toObject() : { ...this.sla };

    if (isAdmin) {
      safeSla = rawSla;
    } else if (isAssigned) {
      safeSla = {
        policyVersion: rawSla.policyVersion,
        startedAt: rawSla.startedAt,
        acknowledgementDeadline: rawSla.acknowledgementDeadline,
        assignmentDeadline: rawSla.assignmentDeadline,
        resolutionDeadline: rawSla.resolutionDeadline,
        reworkDeadline: rawSla.reworkDeadline,
        isBreached: Boolean(rawSla.isBreached),
        breachedStages: rawSla.breachedStages || [],
        escalationLevel: rawSla.escalationLevel || 0,
        isResolvedWithinSla: rawSla.isResolvedWithinSla,
        requiresCriticalAttention: Boolean(rawSla.requiresCriticalAttention)
      };
    } else {
      // Citizen (owner or public) sees customer-friendly service expectations without internal escalation alerts
      safeSla = {
        resolutionDeadline: rawSla.resolutionDeadline,
        isDelayed: Boolean(rawSla.isBreached),
        isResolvedWithinSla: rawSla.isResolvedWithinSla,
        isEscalated: rawSla.escalationLevel === 3,
        escalationNotice: rawSla.escalationLevel === 3 ? 'Your complaint has been escalated for supervisory attention.' : null,
        statusNotice: rawSla.escalationLevel === 3 ? 'Your complaint has been escalated for supervisory attention.' : null
      };
    }
  }

  return {
    id: this._id,
    trackingId: this.trackingId,
    title: this.title,
    description: this.description,
    category: this.category,
    location: this.location,
    priority: this.priority,
    status: this.status,
    citizen: this.citizen,
    assignedOfficer: this.assignedOfficer,
    department: this.department,
    resolutionNotes: this.resolutionNotes || '',
    resolvedAt: this.resolvedAt || null,
    hasEvidence: hasEv,
    evidence: safeEvidence,
    hasCompletionEvidence: hasCompEv,
    completionEvidence: safeCompletionEvidence,
    hasDispute: hasDispute,
    resolutionDispute: safeDispute,
    reworkCount: this.reworkCount || 0,
    sla: safeSla,
    statusHistory: this.statusHistory,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const Complaint = mongoose.model('Complaint', complaintSchema);

module.exports = {
  Complaint,
  VALID_CATEGORIES,
  VALID_STATUSES,
  VALID_PRIORITIES
};
