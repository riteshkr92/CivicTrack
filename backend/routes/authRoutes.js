const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const storageService = require('../services/storageService');
const { validateImageMagicBytes } = require('../utils/exifParser');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Upload kill switch: uploads permitted only when EVIDENCE_UPLOADS_ENABLED === 'true'
const checkUploadsEnabled = (req, res, next) => {
  if (process.env.EVIDENCE_UPLOADS_ENABLED !== 'true') {
    res.setHeader('Retry-After', '30');
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Evidence uploads are temporarily disabled by administrator policy.'
    });
  }
  next();
};

// Upload directory configuration for user avatars
const rawUploadDir = process.env.UPLOAD_DIR || 'uploads';
const UPLOAD_DIR = path.isAbsolute(rawUploadDir)
  ? rawUploadDir
  : path.resolve(__dirname, '..', rawUploadDir);
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Canonical path traversal guard
const isPathInsideDirectory = (baseDir, targetPath) => {
  if (!baseDir || !targetPath) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

// Avatar multer configuration using memory storage
const avatarStorage = multer.memoryStorage();

const uploadAvatarMiddleware = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Only JPEG, PNG, and WebP images are permitted for avatars.'));
    }
  }
});

/**
 * @route   POST /api/auth/register
 * @desc    Register a new citizen account
 * @access  Public
 * @rule    Role is strictly set to 'citizen'. Public registration cannot create elevated accounts.
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // Validate presence of required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Name, email, and password are required fields.'
      });
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const rawPassword = typeof password === 'string' ? password : '';

    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Name must be between 2 and 100 characters long.'
      });
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Please provide a valid email address.'
      });
    }

    if (rawPassword.length < 6 || rawPassword.length > 128) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be between 6 and 128 characters long.'
      });
    }

    // Check if user already exists with this email
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email address already exists.'
      });
    }

    // Create user: role is unconditionally locked to 'citizen' for public registration
    const user = new User({
      name: trimmedName,
      email: normalizedEmail,
      password: rawPassword,
      role: 'citizen'
    });

    await user.save();

    return res.status(201).json({
      message: 'Citizen account registered successfully',
      user: user.toSafeObject()
    });
  } catch (error) {
    // Handle MongoDB duplicate key error (code 11000)
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email address already exists.'
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        error: 'Bad Request',
        message: messages.join(', ')
      });
    }

    next(error);
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and return JWT token
 * @access  Public
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required.'
      });
    }

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const rawPassword = typeof password === 'string' ? password : '';

    // Find user by email and explicitly select password hash
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      // Return generic credential failure to prevent account enumeration
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.'
      });
    }

    // Compare provided password with stored hash
    const isMatch = await user.matchPassword(rawPassword);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.'
      });
    }

    // Generate signed JWT
    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      message: 'Authentication successful',
      token,
      user: user.toSafeObject()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Retrieve authenticated user profile
 * @access  Protected (Requires Bearer token)
 */
router.get('/me', authenticate, (req, res) => {
  return res.status(200).json({
    user: req.user.toSafeObject()
  });
});

/**
 * @route   GET /api/auth/admin-check
 * @desc    Role verification test endpoint (requires admin role)
 * @access  Protected (Admin only)
 */
router.get('/admin-check', authenticate, authorize('admin'), (req, res) => {
  return res.status(200).json({
    message: 'Admin authorization verified successfully',
    user: req.user.toSafeObject()
  });
});

/**
 * @route   POST /api/auth/officers
 * @desc    Admin-provisioned municipal officer account
 * @access  Protected (Admin only)
 * @rule    Role is strictly set to 'officer'. Role supplied in request body is ignored.
 */
router.post('/officers', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { name, email, department, password } = req.body;

    if (!name || !email || !department || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Name, email, department, and initial password are required fields.'
      });
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const trimmedDept = typeof department === 'string' ? department.trim() : '';
    const rawPassword = typeof password === 'string' ? password : '';

    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Name must be between 2 and 100 characters long.'
      });
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Please provide a valid email address.'
      });
    }

    if (trimmedDept.length < 2 || trimmedDept.length > 100) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Department must be between 2 and 100 characters long.'
      });
    }

    if (rawPassword.length < 6 || rawPassword.length > 128) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be between 6 and 128 characters long.'
      });
    }

    // Check duplicate email
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email address already exists.'
      });
    }

    // Unconditionally assign role 'officer' - never trust client role
    const officer = new User({
      name: trimmedName,
      email: normalizedEmail,
      password: rawPassword,
      role: 'officer',
      department: trimmedDept
    });

    await officer.save();

    return res.status(201).json({
      message: 'Officer account created successfully',
      officer: officer.toSafeObject(),
      user: officer.toSafeObject()
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email address already exists.'
      });
    }
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        error: 'Bad Request',
        message: messages.join(', ')
      });
    }
    next(error);
  }
});

/**
 * @route   GET /api/auth/profile
 * @desc    Get detailed user profile of the authenticated user
 * @access  Protected
 */
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User profile not found.'
      });
    }
    return res.status(200).json({
      user: user.toSafeObject()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/auth/profile
 * @desc    Update permitted profile fields for the authenticated user
 * @access  Protected
 */
router.patch('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found.'
      });
    }

    const {
      name,
      phone,
      address,
      email,
      currentPassword,
      role,
      department,
      employeeId,
      designation
    } = req.body;

    // Strict Authorization Guards: reject unauthorized attempts to modify immutable/privileged attributes
    if (role !== undefined && role !== user.role) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Role escalation and role modifications are strictly forbidden.'
      });
    }

    if (department !== undefined && department !== user.department) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Department modification is restricted to administrative dispatch.'
      });
    }

    if (employeeId !== undefined && employeeId !== user.employeeId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Employee ID is an immutable administrative identifier.'
      });
    }

    if (designation !== undefined && designation !== user.designation) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Designation is an immutable administrative attribute.'
      });
    }

    // Permitted Name Update
    if (name !== undefined) {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (trimmedName.length < 2 || trimmedName.length > 100) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Full name must be between 2 and 100 characters long.'
        });
      }
      user.name = trimmedName;
    }

    // Permitted Phone Number Update
    if (phone !== undefined) {
      const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
      if (trimmedPhone.length > 20) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Phone number cannot exceed 20 characters.'
        });
      }
      user.phone = trimmedPhone;
    }

    // Permitted Address Update (Citizen)
    if (address !== undefined) {
      const trimmedAddress = typeof address === 'string' ? address.trim() : '';
      if (trimmedAddress.length > 250) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Address cannot exceed 250 characters.'
        });
      }
      user.address = trimmedAddress;
    }

    // Safe Email Address Update
    if (email !== undefined) {
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (normalizedEmail !== user.email) {
        // Enforce invariant: designated administrator email cannot be modified
        if (user.role === 'admin' || user.email === 'admin@civictrack.gov') {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'The designated administrator account email cannot be modified.'
          });
        }

        if (!EMAIL_REGEX.test(normalizedEmail)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Please provide a valid email address.'
          });
        }

        // Require current password verification to change email address
        if (!currentPassword) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Current password is required to change your account email address.'
          });
        }

        const isPasswordValid = await user.matchPassword(currentPassword);
        if (!isPasswordValid) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Current password verification failed. Email was not updated.'
          });
        }

        // Check for collision with existing accounts
        const existingEmailUser = await User.findOne({
          email: normalizedEmail,
          _id: { $ne: user._id }
        });
        if (existingEmailUser) {
          return res.status(409).json({
            error: 'Conflict',
            message: 'An account with this email address already exists.'
          });
        }

        user.email = normalizedEmail;
      }
    }

    await user.save();

    return res.status(200).json({
      message: 'Profile details saved successfully.',
      user: user.toSafeObject()
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email address already exists.'
      });
    }
    next(error);
  }
});

/**
 * @route   PATCH /api/auth/change-password
 * @desc    Change password for the authenticated user
 * @access  Protected
 */
router.patch('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Current password, new password, and confirmation password are all required.'
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'New password must be between 6 and 128 characters long.'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'New password and confirmation password do not match.'
      });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User account not found.'
      });
    }

    const isCurrentMatch = await user.matchPassword(currentPassword);
    if (!isCurrentMatch) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Current password is incorrect.'
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'New password must be different from current password.'
      });
    }

    // Set new password (pre-save hook will hash it with bcrypt salt 10)
    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      message: 'Password changed successfully. Please use your new password on your next sign-in.'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/auth/notifications/preferences
 * @desc    Get notification preferences for authenticated user
 * @access  Protected
 */
router.get('/notifications/preferences', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('notificationPreferences');
    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User account not found.'
      });
    }

    return res.status(200).json({
      preferences: user.notificationPreferences || {
        complaintStatusUpdates: true,
        complaintAssignments: true,
        slaWarningsAndBreaches: true,
        resolutionDisputeUpdates: true
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PATCH /api/auth/notifications/preferences
 * @desc    Update notification preferences for authenticated user
 * @access  Protected
 */
router.patch('/notifications/preferences', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User account not found.'
      });
    }

    const {
      complaintStatusUpdates,
      complaintAssignments,
      slaWarningsAndBreaches,
      resolutionDisputeUpdates
    } = req.body;

    if (!user.notificationPreferences) {
      user.notificationPreferences = {
        complaintStatusUpdates: true,
        complaintAssignments: true,
        slaWarningsAndBreaches: true,
        resolutionDisputeUpdates: true
      };
    }

    if (typeof complaintStatusUpdates === 'boolean') {
      user.notificationPreferences.complaintStatusUpdates = complaintStatusUpdates;
    }
    if (typeof complaintAssignments === 'boolean') {
      user.notificationPreferences.complaintAssignments = complaintAssignments;
    }
    if (typeof slaWarningsAndBreaches === 'boolean') {
      user.notificationPreferences.slaWarningsAndBreaches = slaWarningsAndBreaches;
    }
    if (typeof resolutionDisputeUpdates === 'boolean') {
      user.notificationPreferences.resolutionDisputeUpdates = resolutionDisputeUpdates;
    }

    await user.save();

    return res.status(200).json({
      message: 'Notification preferences updated successfully.',
      preferences: user.notificationPreferences
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/profile/avatar
 * @desc    Upload profile picture for authenticated user
 * @access  Protected
 */
router.post('/profile/avatar', checkUploadsEnabled, authenticate, (req, res, next) => {
  uploadAvatarMiddleware.single('avatar')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Avatar file size exceeds the 5MB limit.'
        });
      }
      return res.status(400).json({
        error: 'Bad Request',
        message: err.message
      });
    }
    if (!req.file) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Avatar image file is required.'
      });
    }

    const fileBuffer = req.file.buffer;
    const detectedMime = validateImageMagicBytes(fileBuffer);
    if (!detectedMime) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Uploaded file is not a valid image format (genuine JPEG, PNG, or WebP required).'
      });
    }

    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User not found.'
        });
      }

      const ext = path.extname(req.file.originalname || '').toLowerCase();
      const cleanExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
      const safeAvatarKey = `avatar-${user._id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${cleanExt}`;

      let uploadedStorageKey = null;
      try {
        const uploadResult = await storageService.uploadFile(safeAvatarKey, fileBuffer, detectedMime);
        uploadedStorageKey = uploadResult.key || safeAvatarKey;
      } catch (storageErr) {
        res.setHeader('Retry-After', '30');
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Avatar storage service is temporarily unreachable. Please retry shortly.'
        });
      }

      const previousAvatar = user.avatar;
      user.avatar = safeAvatarKey;

      try {
        await user.save();
      } catch (dbErr) {
        if (uploadedStorageKey) {
          try { await storageService.deleteFile(uploadedStorageKey); } catch (_) {}
        }
        throw dbErr;
      }

      // Replacement upload: Delete previous avatar only after DB update succeeds
      if (previousAvatar && previousAvatar !== safeAvatarKey && previousAvatar.startsWith('avatar-')) {
        try {
          await storageService.deleteFile(previousAvatar);
        } catch (delErr) {
          console.error(`Failed to delete previous avatar ${previousAvatar}:`, delErr.message);
        }
      }

      return res.status(200).json({
        message: 'Profile avatar uploaded successfully.',
        avatar: user.avatar,
        user: user.toSafeObject()
      });
    } catch (error) {
      next(error);
    }
  });
});

/**
 * @route   GET /api/auth/profile/avatar
 * @desc    Stream profile picture of authenticated user
 * @access  Protected
 */
router.get('/profile/avatar', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.avatar) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No profile avatar configured.'
      });
    }

    const rawKey = user.avatar;
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    const candidatePath = path.resolve(resolvedUploadDir, rawKey);
    if (!isPathInsideDirectory(resolvedUploadDir, candidatePath)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. Avatar path outside designated directory.'
      });
    }

    const safeKey = path.basename(rawKey);
    let fileBuffer;
    try {
      fileBuffer = await storageService.getFileBuffer(safeKey);
    } catch (storageErr) {
      if (storageErr.isNotFound || storageErr.statusCode === 404 || (storageErr.message && storageErr.message.includes('Object not found'))) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Avatar image not found on disk.'
        });
      }
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Avatar storage service is temporarily unreachable. Please retry shortly.'
      });
    }

    const ext = path.extname(safeKey).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg'
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${safeKey}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(fileBuffer);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

