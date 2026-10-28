const express = require('express');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

module.exports = router;

