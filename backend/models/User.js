const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [EMAIL_REGEX, 'Please provide a valid email address']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long'],
      maxlength: [128, 'Password cannot exceed 128 characters'],
      select: false // Exclude password from query results by default
    },
    role: {
      type: String,
      enum: {
        values: ['citizen', 'officer', 'admin'],
        message: 'Role must be citizen, officer, or admin'
      },
      default: 'citizen'
    },
    department: {
      type: String,
      trim: true,
      maxlength: [100, 'Department cannot exceed 100 characters'],
      default: null
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [20, 'Phone number cannot exceed 20 characters'],
      default: ''
    },
    address: {
      type: String,
      trim: true,
      maxlength: [250, 'Address cannot exceed 250 characters'],
      default: ''
    },
    avatar: {
      type: String,
      trim: true,
      default: null
    },
    employeeId: {
      type: String,
      trim: true,
      maxlength: [50, 'Employee ID cannot exceed 50 characters'],
      default: null
    },
    designation: {
      type: String,
      trim: true,
      maxlength: [100, 'Designation cannot exceed 100 characters'],
      default: null
    },
    notificationPreferences: {
      complaintStatusUpdates: {
        type: Boolean,
        default: true
      },
      complaintAssignments: {
        type: Boolean,
        default: true
      },
      slaWarningsAndBreaches: {
        type: Boolean,
        default: true
      },
      resolutionDisputeUpdates: {
        type: Boolean,
        default: true
      }
    }
  },
  {
    timestamps: true
  }
);

// Pre-save hook: Hash password and enforce single-admin policy
userSchema.pre('save', async function () {
  // Prevent demoting the designated administrator
  if (this.email === 'admin@civictrack.gov' && this.isModified('role') && this.role !== 'admin') {
    const err = new Error('Designated administrator account role cannot be demoted.');
    err.statusCode = 403;
    throw err;
  }

  // Enforce Single Designated Administrator policy
  if (this.role === 'admin') {
    const existingAdminCount = await mongoose.model('User').countDocuments({
      role: 'admin',
      _id: { $ne: this._id }
    });
    if (existingAdminCount > 0) {
      const err = new Error('Single-Admin Policy Violation: CivicTrack permits exactly one designated administrator account.');
      err.statusCode = 403;
      throw err;
    }
  }

  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return;
  }

  const saltRounds = 10;
  this.password = await bcrypt.hash(this.password, saltRounds);
});

// Helper to verify single-admin policy across all query-based update operations
async function enforceSingleAdminOnUpdate() {
  const update = this.getUpdate();
  if (!update) return;

  // Extract role if being updated
  let targetRole = null;
  if (typeof update.role === 'string') {
    targetRole = update.role;
  } else if (update.$set && typeof update.$set.role === 'string') {
    targetRole = update.$set.role;
  }

  const existingAdmin = await mongoose.model('User').findOne({ role: 'admin' });

  // 1. If attempting to promote/set role to 'admin'
  if (targetRole === 'admin') {
    if (existingAdmin) {
      const filter = this.getFilter() || {};
      const filterId = filter._id || (filter.id && mongoose.Types.ObjectId.isValid(filter.id) ? filter.id : null);
      const isTargetingAdmin =
        (filterId && String(filterId) === String(existingAdmin._id)) ||
        (filter.email && String(filter.email).toLowerCase() === String(existingAdmin.email).toLowerCase());

      if (!isTargetingAdmin) {
        const err = new Error(
          'Single-Admin Policy Violation: CivicTrack permits exactly one designated administrator account.'
        );
        err.statusCode = 403;
        throw err;
      }
    }
  }

  // 2. If attempting to demote the designated administrator
  if (targetRole && targetRole !== 'admin' && existingAdmin) {
    const filter = this.getFilter() || {};
    const filterId = filter._id || (filter.id && mongoose.Types.ObjectId.isValid(filter.id) ? filter.id : null);
    const isTargetingAdmin =
      (filterId && String(filterId) === String(existingAdmin._id)) ||
      (filter.email && String(filter.email).toLowerCase() === String(existingAdmin.email).toLowerCase());

    if (isTargetingAdmin) {
      const err = new Error('Designated administrator account role cannot be demoted.');
      err.statusCode = 403;
      throw err;
    }
  }
}

// Hook all query-based update operations
userSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'findByIdAndUpdate', 'replaceOne', 'findOneAndReplace'],
  enforceSingleAdminOnUpdate
);

// Pre-insertMany hook: Enforce single-admin policy on bulk document insertions
userSchema.pre('insertMany', async function (docs) {
  const actualDocs = Array.isArray(docs) ? docs : (Array.isArray(arguments[0]) ? arguments[0] : []);
  if (Array.isArray(actualDocs)) {
    const adminDocs = actualDocs.filter((d) => d && d.role === 'admin');
    if (adminDocs.length > 0) {
      const existingAdminCount = await mongoose.model('User').countDocuments({ role: 'admin' });
      if (existingAdminCount > 0 || adminDocs.length > 1) {
        const err = new Error(
          'Single-Admin Policy Violation: CivicTrack permits exactly one designated administrator account.'
        );
        err.statusCode = 403;
        throw err;
      }
    }
  }
});

// Compare entered password with stored bcrypt hash
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) {
    throw new Error('Password hash not loaded for comparison');
  }
  return await bcrypt.compare(enteredPassword, this.password);
};

// Safe representation of user profile without sensitive fields
userSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    department: this.department,
    phone: this.phone || '',
    address: this.address || '',
    avatar: this.avatar || null,
    employeeId: this.employeeId || null,
    designation: this.designation || null,
    notificationPreferences: this.notificationPreferences || {
      complaintStatusUpdates: true,
      complaintAssignments: true,
      slaWarningsAndBreaches: true,
      resolutionDisputeUpdates: true
    },
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// Safe JSON serialization transform
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.password;
    delete ret.__v;
    return ret;
  }
});

const User = mongoose.model('User', userSchema);

module.exports = User;
