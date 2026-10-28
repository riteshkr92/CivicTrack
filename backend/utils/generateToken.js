const jwt = require('jsonwebtoken');

/**
 * Generate a signed JSON Web Token (JWT) with user ID and role claims.
 *
 * @param {string|mongoose.Types.ObjectId} id - User ObjectId
 * @param {string} role - User role (citizen, officer, admin)
 * @returns {string} - Signed JWT string
 */
const generateToken = (id, role) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';

  return jwt.sign(
    {
      id: id.toString(),
      role
    },
    secret,
    {
      expiresIn
    }
  );
};

module.exports = generateToken;
