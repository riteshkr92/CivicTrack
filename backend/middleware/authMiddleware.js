const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware to authenticate requests using a Bearer JWT token in the Authorization header.
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Access denied. No authentication token provided in Authorization header.'
    });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Access denied. Token format is invalid.'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch the user from database to ensure account still exists and role is current
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Access denied. User associated with this token no longer exists.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication token has expired. Please log in again.'
      });
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authentication token.'
    });
  }
};

/**
 * Middleware factory to authorize requests based on user roles.
 *
 * @param {...string} allowedRoles - List of authorized roles (e.g., 'citizen', 'officer', 'admin')
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User authentication required before role authorization.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. Role '${req.user.role}' is not authorized to perform this action.`
      });
    }

    next();
  };
};

module.exports = {
  authenticate,
  authenticateToken: authenticate,
  authorize
};
