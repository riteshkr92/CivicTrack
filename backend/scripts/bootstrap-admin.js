/**
 * CivicTrack — Server-Side Designated Administrator Bootstrap Procedure
 *
 * This utility safely initializes the single designated administrator account
 * if no administrator exists in the MongoDB database.
 * If an administrator account already exists, the procedure strictly refuses to
 * create a second administrator in accordance with CivicTrack Single-Admin policy.
 *
 * Usage:
 *   node backend/scripts/bootstrap-admin.js
 *   ADMIN_NAME="Municipal Admin" ADMIN_EMAIL="admin@civictrack.gov" ADMIN_PASSWORD="<secure-pass>" node backend/scripts/bootstrap-admin.js
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/civictrack';

async function bootstrapAdmin() {
  console.log('[Bootstrap] Connecting to MongoDB:', MONGO_URI.replace(/\/\/[^@]*@/, '//***@'));
  await mongoose.connect(MONGO_URI);

  try {
    // 1. Check if an administrator already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log(`[Bootstrap Refused] A designated administrator already exists:`);
      console.log(`  - Name:  ${existingAdmin.name}`);
      console.log(`  - Email: ${existingAdmin.email}`);
      console.log(`  - ID:    ${existingAdmin._id}`);
      console.log(`[Bootstrap Policy] CivicTrack permits exactly one administrator. No action taken.`);
      return { success: false, reason: 'ADMIN_EXISTS', admin: existingAdmin.toSafeObject() };
    }

    // 2. Derive credentials from environment or project defaults
    const adminName = process.env.INITIAL_ADMIN_NAME || process.env.ADMIN_NAME || 'Municipal Administrator';
    const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@civictrack.gov').toLowerCase().trim();
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

    if (!adminPassword || adminPassword.length < 8) {
      console.error('[Bootstrap Error] INITIAL_ADMIN_PASSWORD environment variable must be set (minimum 8 characters) to bootstrap the initial admin.');
      process.exit(1);
    }

    // 3. Create initial administrator
    const newAdmin = new User({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      department: null
    });

    await newAdmin.save();
    console.log(`[Bootstrap Success] Designated administrator created successfully:`);
    console.log(`  - Name:  ${newAdmin.name}`);
    console.log(`  - Email: ${newAdmin.email}`);
    console.log(`  - Role:  admin`);
    return { success: true, admin: newAdmin.toSafeObject() };
  } finally {
    await mongoose.disconnect();
    console.log('[Bootstrap] Database connection closed.');
  }
}

if (require.main === module) {
  bootstrapAdmin().catch((err) => {
    console.error('[Bootstrap Failure]', err.message);
    process.exit(1);
  });
}

module.exports = bootstrapAdmin;
