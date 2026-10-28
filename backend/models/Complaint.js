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

complaintSchema.methods.toSafeObject = function () {
  const hasEv = Boolean(
    this.evidence &&
    (this.evidence.storageKey || this.evidence.imageUrl || this.evidence.filename || this.evidence.originalName || this.evidence.originalFilename)
  );

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
    evidence: this.evidence || null,
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
