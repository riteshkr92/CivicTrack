/**
 * CivicTrack — Internal Administrative User Provisioning Script
 * 
 * Used by municipal administrators / developers to provision verified
 * staff accounts (officer, admin) or promote existing users.
 * 
 * Usage:
 *   List users:
 *     node backend/scripts/provision-user.js --list
 * 
 *   Create an officer:
 *     node backend/scripts/provision-user.js --create --name "Field Officer" --email "officer@civictrack.gov" --password "Officer@123" --role officer --department "Roads & Infrastructure"
 * 
 *   Create an administrator:
 *     node backend/scripts/provision-user.js --create --name "Municipal Admin" --email "admin@civictrack.gov" --password "Admin@123" --role admin
 * 
 *   Promote an existing account:
 *     node backend/scripts/provision-user.js --promote user@example.com --role officer --department "Sanitation"
 */

const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/civictrack';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        parsed[key] = args[i + 1];
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB:', mongoose.connection.name);

  try {
    if (args.list) {
      const users = await User.find({}, '-password').sort({ createdAt: -1 });
      console.log(`\n--- CIVICTRACK USER DIRECTORY (${users.length} Users) ---`);
      users.forEach((u) => {
        console.log(`- [${u.role.toUpperCase()}] ${u.name} <${u.email}> | Department: ${u.department || 'None'} | ID: ${u._id}`);
      });
      return;
    }

    if (args.promote) {
      const email = typeof args.promote === 'string' ? args.promote.toLowerCase().trim() : (args.email || '').toLowerCase().trim();
      const targetRole = (args.role || 'officer').toLowerCase();
      const department = args.department || null;

      if (!['officer', 'admin', 'citizen'].includes(targetRole)) {
        console.error('Error: Role must be "officer", "admin", or "citizen"');
        process.exit(1);
      }

      if (targetRole === 'admin') {
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin && existingAdmin.email !== email) {
          console.error(`Error: Single-Admin Policy Violation. CivicTrack permits exactly one administrator. Existing admin: "${existingAdmin.email}".`);
          process.exit(1);
        }
      }

      const user = await User.findOne({ email });
      if (!user) {
        console.error(`Error: User with email "${email}" not found.`);
        process.exit(1);
      }

      user.role = targetRole;
      if (department) user.department = department;
      await user.save();

      console.log(`\n✔ Successfully promoted "${user.name}" (${user.email}) to role: ${targetRole.toUpperCase()}${department ? ` [${department}]` : ''}`);
      return;
    }

    if (args.create) {
      const name = (args.name || '').trim();
      const email = (args.email || '').toLowerCase().trim();
      const password = args.password || '';
      const role = (args.role || 'officer').toLowerCase();
      const department = args.department || (role === 'officer' ? 'General Operations' : null);

      if (!name || !email || !password) {
        console.error('Error: --name, --email, and --password are required when creating a user.');
        process.exit(1);
      }

      if (!['officer', 'admin', 'citizen'].includes(role)) {
        console.error('Error: Role must be "officer", "admin", or "citizen"');
        process.exit(1);
      }

      if (role === 'admin') {
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin && existingAdmin.email !== email) {
          console.error(`Error: Single-Admin Policy Violation. CivicTrack permits exactly one administrator. Existing admin: "${existingAdmin.email}".`);
          process.exit(1);
        }
      }

      let user = await User.findOne({ email });
      if (user) {
        console.log(`User "${email}" already exists. Updating role to ${role.toUpperCase()} and setting password...`);
        user.name = name;
        user.role = role;
        user.department = department;
        user.password = password; // Will be hashed by pre-save hook
        await user.save();
        console.log(`✔ User "${email}" updated to role: ${role.toUpperCase()}`);
      } else {
        user = new User({
          name,
          email,
          password,
          role,
          department
        });
        await user.save();
        console.log(`\n✔ Provisioned new user "${name}" <${email}> with role: ${role.toUpperCase()}`);
      }
      return;
    }

    console.log(`
Usage:
  node backend/scripts/provision-user.js --list
  node backend/scripts/provision-user.js --create --name "Field Officer" --email "officer@civictrack.gov" --password "Officer@123" --role officer --department "Roads & Infrastructure"
  node backend/scripts/provision-user.js --create --name "Municipal Admin" --email "admin@civictrack.gov" --password "Admin@123" --role admin
  node backend/scripts/provision-user.js --promote user@example.com --role officer --department "Sanitation"
`);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed.');
  }
}

main().catch((err) => {
  console.error('Provisioning script error:', err);
  process.exit(1);
});
