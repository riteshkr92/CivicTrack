/**
 * CivicTrack 2.0 — Step 2: Backend Schema & Lifecycle Foundation Test Suite
 *
 * Verifies:
 * 1. Complaint model status enum expansion ('Provisionally Resolved', 'Disputed')
 * 2. completionEvidence, resolutionDispute, and reworkCount subdocument schema definition
 * 3. Notification model notification type expansion
 * 4. Preservation of existing citizen evidence and historical records
 * 5. Lifecycle transition rules & direct officer resolution prevention (HTTP API)
 * 6. Terminal state protections
 * 7. Clean isolation and automated database fixture teardown
 */

const http = require('http');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const { Complaint, VALID_STATUSES } = require('../models/Complaint');
const { Notification, NOTIFICATION_TYPES } = require('../models/Notification');
const User = require('../models/User');

const BASE_URL = 'http://127.0.0.1:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/civictrack';

let passed = 0;
let total = 0;
const cleanupComplaintIds = [];

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✔ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ✖ [FAIL] ${message}`);
  }
}

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
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runStep2Tests() {
  console.log('================================================================');
  console.log('CivicTrack 2.0 — Step 2: Schema & Lifecycle Verification Suite');
  console.log('================================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB for schema assertion inspection.\n');

  try {
    // -------------------------------------------------------------------------
    // Part 1: Schema Invariant & Model Validation Unit Tests
    // -------------------------------------------------------------------------
    console.log('--- Part 1: Complaint Schema & Model Invariants ---');

    // 1. VALID_STATUSES enum inspection
    assert(
      VALID_STATUSES.includes('Provisionally Resolved') && VALID_STATUSES.includes('Disputed'),
      '1. VALID_STATUSES contains both "Provisionally Resolved" and "Disputed"'
    );
    assert(
      VALID_STATUSES.length === 7 &&
      VALID_STATUSES.includes('Submitted') &&
      VALID_STATUSES.includes('Under Review') &&
      VALID_STATUSES.includes('In Progress') &&
      VALID_STATUSES.includes('Resolved') &&
      VALID_STATUSES.includes('Rejected'),
      '2. All 5 original statuses are preserved alongside the 2 new statuses (Total: 7)'
    );

    // 2. Validate Mongoose schema rejects invalid status
    const dummyCitizen = await User.findOne({ role: 'citizen' });
    const dummyOfficer = await User.findOne({ role: 'officer' });
    const dummyAdmin = await User.findOne({ role: 'admin' });

    assert(Boolean(dummyCitizen && dummyOfficer && dummyAdmin), '3. Seed accounts exist for model instantiation tests');

    const invalidStatusDoc = new Complaint({
      trackingId: 'CT-TEST-INVALID-1',
      title: 'Invalid Status Test',
      description: 'Testing invalid status enum validation in Complaint model',
      category: 'Streetlight',
      location: { address: 'Test Location 123' },
      status: 'ClosedCompleted', // Not in enum
      citizen: dummyCitizen._id
    });
    const validateErr = invalidStatusDoc.validateSync();
    assert(
      validateErr && validateErr.errors['status'],
      '4. Mongoose schema rejects unapproved status values (e.g. "ClosedCompleted")'
    );

    // 3. Validate Mongoose schema accepts new statuses
    const provResDoc = new Complaint({
      trackingId: 'CT-TEST-PROV-1',
      title: 'Provisional Status Test',
      description: 'Testing valid Provisionally Resolved status enum validation',
      category: 'Streetlight',
      location: { address: 'Test Location 123' },
      status: 'Provisionally Resolved',
      citizen: dummyCitizen._id
    });
    const provErr = provResDoc.validateSync();
    assert(!provErr, '5. Mongoose schema cleanly validates "Provisionally Resolved" status');

    const disputeDoc = new Complaint({
      trackingId: 'CT-TEST-DISP-1',
      title: 'Dispute Status Test',
      description: 'Testing valid Disputed status enum validation in Complaint model',
      category: 'Streetlight',
      location: { address: 'Test Location 123' },
      status: 'Disputed',
      citizen: dummyCitizen._id
    });
    const dispErr = disputeDoc.validateSync();
    assert(!dispErr, '6. Mongoose schema cleanly validates "Disputed" status');

    // 4. completionEvidence subdocument schema validation
    const completionEvidenceDoc = new Complaint({
      trackingId: 'CT-TEST-COMPEV-1',
      title: 'Completion Evidence Schema Test',
      description: 'Validating completion evidence subdocument fields and types',
      category: 'Garbage/Waste',
      location: { address: 'Test Municipal Depot' },
      status: 'Provisionally Resolved',
      citizen: dummyCitizen._id,
      assignedOfficer: dummyOfficer._id,
      completionEvidence: {
        imageUrl: '/api/complaints/CT-TEST-COMPEV-1/completion-evidence',
        storageKey: 'evidence-completion-test.jpg',
        originalFilename: 'work-done.jpg',
        originalName: 'work-done.jpg',
        mimetype: 'image/jpeg',
        mimeType: 'image/jpeg',
        size: 102400,
        sizeBytes: 102400,
        capturedAt: new Date(),
        submittedAt: new Date(),
        coordinates: {
          latitude: 28.6139,
          longitude: 77.2090,
          accuracy: 8.5,
          accuracyMeters: 8.5
        },
        locationSource: 'device_gps',
        resolutionNotes: 'Debris cleared, bin emptied and sanitised.',
        distanceMeters: 18,
        verificationStatus: 'verified',
        verificationReason: 'On-site completion verified within 20m tolerance'
      }
    });
    const compEvErr = completionEvidenceDoc.validateSync();
    assert(!compEvErr, '7. completionEvidence subdocument passes Mongoose validation with all telemetry fields');

    // 5. resolutionDispute subdocument schema validation
    const disputeSubdoc = new Complaint({
      trackingId: 'CT-TEST-DISPSUB-1',
      title: 'Resolution Dispute Schema Test',
      description: 'Validating resolution dispute subdocument fields and types',
      category: 'Pothole/Road Damage',
      location: { address: 'Test Highway 10' },
      status: 'Disputed',
      citizen: dummyCitizen._id,
      resolutionDispute: {
        reason: 'Pothole was only filled with dirt and has washed away with rain.',
        submittedAt: new Date(),
        citizen: dummyCitizen._id,
        status: 'pending_review'
      }
    });
    const disputeSubErr = disputeSubdoc.validateSync();
    assert(!disputeSubErr, '8. resolutionDispute subdocument passes Mongoose validation with reason and citizen ref');

    // 6. reworkCount schema validation
    const reworkDoc = new Complaint({
      trackingId: 'CT-TEST-REWORK-1',
      title: 'Rework Count Test',
      description: 'Validating rework count default and minimum values',
      category: 'Streetlight',
      location: { address: 'Test Pole 4' },
      status: 'In Progress',
      citizen: dummyCitizen._id,
      reworkCount: 2
    });
    assert(reworkDoc.reworkCount === 2, '9. reworkCount field accepts integer counter');

    const defaultReworkDoc = new Complaint({
      trackingId: 'CT-TEST-REWORK-DEF',
      title: 'Rework Count Default Test',
      description: 'Validating rework count defaults safely to 0',
      category: 'Streetlight',
      location: { address: 'Test Pole 4' },
      citizen: dummyCitizen._id
    });
    assert(defaultReworkDoc.reworkCount === 0, '10. reworkCount defaults safely to 0 when unspecified');

    const negativeReworkDoc = new Complaint({
      trackingId: 'CT-TEST-REWORK-NEG',
      title: 'Rework Count Negative Test',
      description: 'Validating rework count rejects negative numbers',
      category: 'Streetlight',
      location: { address: 'Test Pole 4' },
      citizen: dummyCitizen._id,
      reworkCount: -1
    });
    const negErr = negativeReworkDoc.validateSync();
    assert(negErr && negErr.errors['reworkCount'], '11. reworkCount rejects negative values (min: 0)');

    // 7. toSafeObject serialization
    const safeObj = completionEvidenceDoc.toSafeObject();
    assert(
      safeObj.hasCompletionEvidence === true &&
      safeObj.completionEvidence &&
      safeObj.completionEvidence.storageKey === undefined &&
      safeObj.reworkCount === 0,
      '12. toSafeObject() serializes hasCompletionEvidence, completionEvidence (sanitizing storageKey), and reworkCount'
    );

    // -------------------------------------------------------------------------
    // Part 2: Notification Model Invariant Tests
    // -------------------------------------------------------------------------
    console.log('\n--- Part 2: Notification Model Invariants ---');

    assert(
      NOTIFICATION_TYPES.includes('work_completed') &&
      NOTIFICATION_TYPES.includes('resolution_confirmed') &&
      NOTIFICATION_TYPES.includes('resolution_disputed') &&
      NOTIFICATION_TYPES.includes('resolution_admin_closed') &&
      NOTIFICATION_TYPES.includes('resolution_reopened'),
      '13. NOTIFICATION_TYPES includes all 5 hybrid-approval notification event types'
    );
    assert(
      NOTIFICATION_TYPES.includes('complaint_assigned') &&
      NOTIFICATION_TYPES.includes('complaint_reassigned') &&
      NOTIFICATION_TYPES.includes('status_changed') &&
      NOTIFICATION_TYPES.includes('complaint_resolved') &&
      NOTIFICATION_TYPES.includes('notes_updated'),
      '14. All 5 original notification types are preserved intact'
    );

    // -------------------------------------------------------------------------
    // Part 3: HTTP API Lifecycle & Prevention of Direct Officer Resolution
    // -------------------------------------------------------------------------
    console.log('\n--- Part 3: HTTP API Lifecycle & Direct Officer Resolution Prevention ---');

    // Health check
    const healthRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/health',
      method: 'GET'
    });
    assert(healthRes.status === 200, '15. Backend server is online on port 5000');

    // Authenticate test users
    const citizenLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'citizen@civictrack.gov', password: 'Citizen@123' });
    const citizenToken = citizenLogin.body?.token;

    const officerLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'officer@civictrack.gov', password: 'Officer@123' });
    const officerToken = officerLogin.body?.token;

    const adminLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@civictrack.gov', password: 'Admin@123' });
    const adminToken = adminLogin.body?.token;

    assert(Boolean(citizenToken && officerToken && adminToken), '16. All role tokens acquired successfully');

    // Create an isolated test complaint
    const trackingId = await Complaint.generateTrackingId();
    const testComplaint = new Complaint({
      trackingId,
      title: 'Step 2 Lifecycle Invariant Test Complaint',
      description: 'Testing that direct officer resolution is strictly prevented by state machine',
      category: 'Pothole/Road Damage',
      location: {
        address: '100 Municipal Way, Central Ward',
        latitude: 28.6139,
        longitude: 77.2090
      },
      status: 'Submitted',
      citizen: dummyCitizen._id,
      statusHistory: [
        {
          status: 'Submitted',
          timestamp: new Date(),
          comment: 'Initial submission for Step 2 lifecycle testing',
          actor: dummyCitizen._id,
          actorRole: 'citizen'
        }
      ]
    });
    await testComplaint.save();
    cleanupComplaintIds.push(testComplaint._id);
    assert(Boolean(testComplaint._id), '17. Isolated test complaint created in "Submitted" status');

    // Assign to officer via Admin
    const assignRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint._id}/assign`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      }
    }, {
      officerId: dummyOfficer._id.toString(),
      department: 'Roads & Infrastructure',
      comment: 'Assigned for Step 2 lifecycle test'
    });
    assert(assignRes.status === 200, '18. Admin assigned complaint to officer (Status -> Under Review)');

    // Officer advances Under Review -> In Progress
    const inProgressRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint._id}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, {
      status: 'In Progress',
      comment: 'Field work started on site.'
    });
    assert(inProgressRes.status === 200 && inProgressRes.body?.complaint?.status === 'In Progress', '19. Officer successfully advanced status to "In Progress"');

    // CRITICAL GUARD 1: Officer attempting direct status update to 'Resolved' MUST be rejected
    const directResolveRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint._id}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, {
      status: 'Resolved',
      resolutionNotes: 'Attempting to bypass provisional resolution'
    });
    assert(
      directResolveRes.status === 400,
      '20. Direct officer status update to "Resolved" from In Progress is REJECTED (400 Bad Request)'
    );

    // CRITICAL GUARD 2: Direct resolution via markResolved on PATCH /:id/resolution MUST be rejected
    const directResolutionRouteRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint._id}/resolution`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, {
      resolutionNotes: 'Attempting resolution route bypass',
      markResolved: true
    });
    assert(
      directResolutionRouteRes.status === 400 &&
      directResolutionRouteRes.body?.message?.includes('Direct resolution from \'In Progress\' is not permitted'),
      '21. Direct resolution bypass via markResolved on PATCH /:id/resolution is REJECTED (400 Bad Request)'
    );

    // CRITICAL GUARD 3: Generic status update route cannot be used to jump to 'Provisionally Resolved'
    const genericProvRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint._id}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, {
      status: 'Provisionally Resolved',
      comment: 'Trying to set provisional without photo evidence'
    });
    assert(
      genericProvRes.status === 400 &&
      genericProvRes.body?.message?.includes('geo-verified completion evidence'),
      '22. Generic status update to "Provisionally Resolved" is REJECTED without completion evidence (400 Bad Request)'
    );

    // CRITICAL GUARD 4: Generic status update route cannot be used to jump to 'Disputed'
    const genericDisputeRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${testComplaint._id}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, {
      status: 'Disputed',
      comment: 'Trying to set disputed via generic route'
    });
    assert(
      genericDisputeRes.status === 400 &&
      genericDisputeRes.body?.message?.includes('citizen via the dispute submission workflow'),
      '23. Generic status update to "Disputed" is REJECTED (400 Bad Request - citizen workflow only)'
    );

    // CRITICAL GUARD 5: Terminal status protection (Rejected complaints cannot transition)
    const rejectTestComplaint = new Complaint({
      trackingId: await Complaint.generateTrackingId(),
      title: 'Terminal Rejection Test Complaint',
      description: 'Testing that rejected complaints cannot be transitioned by any status update',
      category: 'Streetlight',
      location: { address: 'Test Location 999' },
      status: 'Rejected',
      citizen: dummyCitizen._id
    });
    await rejectTestComplaint.save();
    cleanupComplaintIds.push(rejectTestComplaint._id);

    const transitionFromRejectedRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/complaints/${rejectTestComplaint._id}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      }
    }, {
      status: 'In Progress',
      comment: 'Trying to reopen rejected complaint'
    });
    assert(
      transitionFromRejectedRes.status === 400,
      '24. Terminal protection holds: Rejected complaints cannot be transitioned to any status (400 Bad Request)'
    );

    // CRITICAL GUARD 6: Admin summary metric integrity
    const adminSummaryRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/complaints/admin/summary',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminSummaryRes.status === 200, '25. Admin summary endpoint responds with 200 OK');
    const summary = adminSummaryRes.body?.summary;
    assert(
      summary &&
      summary.byStatus['Provisionally Resolved'] !== undefined &&
      summary.byStatus['Disputed'] !== undefined,
      '26. Admin summary byStatus breakdown includes "Provisionally Resolved" and "Disputed" keys'
    );
    assert(
      summary && summary.resolved === summary.byStatus['Resolved'],
      '27. Admin summary "resolved" count strictly counts only final "Resolved" status'
    );

  } finally {
    // Teardown and clean up all temporary test records
    if (cleanupComplaintIds.length > 0) {
      await Complaint.deleteMany({ _id: { $in: cleanupComplaintIds } });
      console.log(`\nTeardown complete: Cleaned up ${cleanupComplaintIds.length} temporary test complaint(s).`);
    }
    await mongoose.disconnect();
    console.log('MongoDB connection disconnected.');
  }

  console.log('\n================================================================');
  console.log(`Results: ${passed} / ${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runStep2Tests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

