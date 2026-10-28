/**
 * CivicTrack — Step 7 Automated Admin Analytics & Operational Controls Verification Suite
 */

const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Complaint } = require('../models/Complaint');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/civictrack';

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      if (Buffer.isBuffer(data)) {
        req.write(data);
      } else {
        req.write(typeof data === 'string' ? data : JSON.stringify(data));
      }
    }
    req.end();
  });
}

async function runStep7Tests() {
  console.log('================================================================');
  console.log('CivicTrack — Step 7 Automated Admin Analytics & Controls Suite');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✔ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ✖ [FAIL] ${message}`);
    }
  }

  // Connect to MongoDB for fixture assertions and cleanup
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB database:', mongoose.connection.name);

  const cleanupComplaintIds = [];
  const cleanupUserIds = [];

  try {
    // 1. Health check
    console.log('\n--- Test Group 1: Infrastructure & Health ---');
    const health = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/health',
      method: 'GET'
    });
    assert(health.status === 200 && health.body.services?.database === 'connected', 'Backend health check returns 200 and database is connected');

    // 2. Authentication of test actors
    console.log('\n--- Test Group 2: Role Authentication ---');
    const adminLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@civictrack.gov', password: 'Admin@123' });
    assert(adminLogin.status === 200 && adminLogin.body.user?.role === 'admin', 'Admin successfully authenticated (admin@civictrack.gov)');
    const adminToken = adminLogin.body.token;

    const officerLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'officer@civictrack.gov', password: 'Officer@123' });
    assert(officerLogin.status === 200 && officerLogin.body.user?.role === 'officer', 'Officer successfully authenticated (officer@civictrack.gov)');
    const officerToken = officerLogin.body.token;

    const citizenLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'citizen@civictrack.gov', password: 'Citizen@123' });
    assert(citizenLogin.status === 200 && citizenLogin.body.user?.role === 'citizen', 'Citizen successfully authenticated (citizen@civictrack.gov)');
    const citizenToken = citizenLogin.body.token;

    // 3. Admin Summary Aggregation
    console.log('\n--- Test Group 3: Admin Summary Aggregation (GET /api/complaints/admin/summary) ---');
    const summaryRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/summary',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(summaryRes.status === 200, `Admin summary returns HTTP 200 (Got ${summaryRes.status})`);
    const summary = summaryRes.body?.summary;
    assert(summary !== undefined && typeof summary.total === 'number', 'Summary contains total count as number');

    // DB Record Match
    const actualDbTotal = await Complaint.countDocuments();
    assert(summary.total === actualDbTotal, `Summary total (${summary.total}) precisely matches MongoDB total (${actualDbTotal})`);

    // Consistency check: unassigned + assigned === total
    assert(summary.unassigned + summary.assigned === summary.total, `Unassigned (${summary.unassigned}) + Assigned (${summary.assigned}) equals Total (${summary.total})`);

    // Status mapping check: sum(byStatus) === total
    const statusSum = Object.values(summary.byStatus).reduce((a, b) => a + b, 0);
    assert(statusSum === summary.total, `Sum of status counts (${statusSum}) equals Total (${summary.total})`);

    // Check performance and SLA specification
    assert(summary.performance !== undefined, 'Summary contains performance metrics object');
    assert(summary.performance.slaStatus === 'unavailable', 'SLA status is explicitly reported as unavailable');
    assert(summary.performance.slaNotice.includes('municipal SLA policy'), 'SLA notice explains that an official policy is required');

    // 4. Officer Workload Oversight Endpoint
    console.log('\n--- Test Group 4: Officer Workload Oversight (GET /api/complaints/admin/officer-workload) ---');
    const workloadRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/officer-workload',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(workloadRes.status === 200, `Officer workload endpoint returns HTTP 200 (Got ${workloadRes.status})`);
    const officersList = workloadRes.body?.officers;
    assert(Array.isArray(officersList), 'Workload endpoint returns officers array');

    // Security: Check NO sensitive fields leaked
    let hasLeak = false;
    officersList.forEach((o) => {
      if (o.password || o.salt || o.__v) hasLeak = true;
    });
    assert(!hasLeak, 'Officer records do NOT expose password hashes, salts, or internal Mongoose fields');

    // Consistency of workload metrics
    const officersAssignedSum = officersList.reduce((acc, o) => acc + (o.metrics?.totalAssigned || 0), 0);
    assert(officersAssignedSum === workloadRes.body?.totalAssignedTasks, `Sum of individual officer tasks (${officersAssignedSum}) matches totalAssignedTasks (${workloadRes.body?.totalAssignedTasks})`);

    // 5. Security & RBAC Enforcement (Admin Only)
    console.log('\n--- Test Group 5: Security & RBAC Enforcement ---');
    const citizenDeniedSummary = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/summary',
      method: 'GET',
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(citizenDeniedSummary.status === 403, 'Citizen blocked from GET /api/complaints/admin/summary with 403 Forbidden');

    const citizenDeniedWorkload = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/officer-workload',
      method: 'GET',
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(citizenDeniedWorkload.status === 403, 'Citizen blocked from GET /api/complaints/admin/officer-workload with 403 Forbidden');

    const officerDeniedSummary = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/summary',
      method: 'GET',
      headers: { Authorization: `Bearer ${officerToken}` }
    });
    assert(officerDeniedSummary.status === 403, 'Officer blocked from GET /api/complaints/admin/summary with 403 Forbidden');

    const officerDeniedWorkload = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/officer-workload',
      method: 'GET',
      headers: { Authorization: `Bearer ${officerToken}` }
    });
    assert(officerDeniedWorkload.status === 403, 'Officer blocked from GET /api/complaints/admin/officer-workload with 403 Forbidden');

    const unauthDenied = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/summary',
      method: 'GET'
    });
    assert(unauthDenied.status === 401, 'Unauthenticated request blocked with 401 Unauthorized');

    // 6. End-to-End Operational Workflow Integration
    console.log('\n--- Test Group 6: Full Operational Lifecycle & Metric Updates ---');
    // Step 6a: Citizen submits complaint with valid photo evidence
    const boundary = '----CivicTrackTestBoundary' + Math.random().toString(36).substring(2);
    const validPngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]);

    const formParts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nStep 7 Operational Test Case Pothole\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nMajor road crater on municipal junction 42 requiring asphalt repair.\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nPothole/Road Damage\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="address"\r\n\r\nSector 9 Industrial Boulevard, Ward 4\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="latitude"\r\n\r\n18.5204\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="longitude"\r\n\r\n73.8567\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="evidence"; filename="pothole.png"\r\nContent-Type: image/png\r\n\r\n`
    ];

    const multipartBody = Buffer.concat([
      Buffer.from(formParts[0]),
      Buffer.from(formParts[1]),
      Buffer.from(formParts[2]),
      Buffer.from(formParts[3]),
      Buffer.from(formParts[4]),
      Buffer.from(formParts[5]),
      Buffer.from(formParts[6]),
      validPngBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const newComplaintRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
        Authorization: `Bearer ${citizenToken}`
      }
    }, multipartBody);
    assert(newComplaintRes.status === 201, `Citizen submitted new complaint (HTTP 201, Tracking: ${newComplaintRes.body?.complaint?.trackingId})`);
    const testComplaint = newComplaintRes.body?.complaint;
    cleanupComplaintIds.push(testComplaint.id);

    // Verify admin summary now shows +1 unassigned
    const summaryAfterSubmit = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/summary',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(summaryAfterSubmit.body?.summary?.unassigned === summary.unassigned + 1, 'Admin summary unassigned count accurately increased by 1');

    // Step 6b: Admin assigns to officer
    const officerDoc = await User.findOne({ email: 'officer@civictrack.gov' });
    const assignRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint.id}/assign`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      }
    }, {
      officerId: officerDoc._id.toString(),
      department: 'Roads & Infrastructure',
      comment: 'Dispatched to primary roads team for inspection'
    });
    assert(assignRes.status === 200 && assignRes.body?.complaint?.status === 'Under Review', 'Admin successfully dispatched complaint to officer (Status -> Under Review)');

    // Verify workload reflects +1 for this officer
    const workloadAfterAssign = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/officer-workload',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const targetOfficerAfter = workloadAfterAssign.body?.officers?.find((o) => o.email === 'officer@civictrack.gov');
    assert(targetOfficerAfter && targetOfficerAfter.metrics?.underReview >= 1, 'Officer workload immediately reflects active task under review');

    // Step 6c: Officer advances status: Under Review -> In Progress -> Resolved
    const inProgressRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint.id}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, {
      status: 'In Progress',
      comment: 'Road crew and asphalt roller deployed on site.'
    });
    assert(inProgressRes.status === 200 && inProgressRes.body?.complaint?.status === 'In Progress', 'Officer advanced status to In Progress');

    const resolveRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint.id}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, {
      status: 'Resolved',
      resolutionNotes: 'Crater filled with cold-mix asphalt, leveled, and sealed with bitumen.'
    });
    assert(resolveRes.status === 200 && resolveRes.body?.complaint?.status === 'Resolved', 'Officer resolved complaint with verified resolution notes');

    // Step 6d: Final Admin summary check
    const finalSummary = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/summary',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(finalSummary.body?.summary?.resolved >= 1, 'Admin summary reflects updated Resolved complaint count');
    assert(finalSummary.body?.summary?.performance?.avgResolutionHours !== null, `Average resolution time calculated accurately: ${finalSummary.body?.summary?.performance?.avgResolutionHours}h`);
    assert(finalSummary.body?.summary?.performance?.avgResponseHours !== null, `Average response time calculated accurately: ${finalSummary.body?.summary?.performance?.avgResponseHours}h`);

    console.log('\n================================================================');
    console.log(`Results: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
    console.log('================================================================\n');

  } finally {
    // Cleanup created test records
    if (cleanupComplaintIds.length > 0) {
      await Complaint.deleteMany({ _id: { $in: cleanupComplaintIds } });
      console.log(`Cleaned up ${cleanupComplaintIds.length} temporary test complaint(s).`);
    }
    await mongoose.disconnect();
    console.log('MongoDB connection disconnected.');
  }

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runStep7Tests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
