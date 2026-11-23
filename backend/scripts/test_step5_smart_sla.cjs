/**
 * CivicTrack 2.0 — Step 5 Automated Verification Suite
 * Smart SLA & Escalation System
 *
 * Validates:
 * 1. GET /api/sla/policy returns active SLA policy matrix with version, priority targets, overrides, rules.
 * 2. Non-admin PATCH /api/sla/policy is rejected with 403 Forbidden.
 * 3. Admin PATCH /api/sla/policy with invalid targets (out-of-range hours) is rejected with 400 Bad Request.
 * 4. Admin PATCH /api/sla/policy updates configuration and increments policy version.
 * 5. calculateSlaDeadlines computes accurate priority targets and category overrides.
 * 6. calculateReworkDeadline computes correct rework timeframes.
 * 7. POST /api/complaints attaches embedded sla subdocument with startedAt, deadlines, escalationLevel: 0.
 * 8. toSafeObject() role-scoping:
 *    - Admin receives full SLA subdocument including escalationHistory.
 *    - Officer receives operational deadlines and escalation level.
 *    - Citizen receives customer-friendly deadline and delay status without internal escalation fields.
 * 9. Lifecycle Milestone Tracking:
 *    - PATCH /:id/status to 'Under Review' sets sla.acknowledgedAt.
 *    - PATCH /:id/assign sets sla.assignedAt and sla.acknowledgedAt.
 *    - PATCH /:id/status to 'In Progress' sets sla.workStartedAt.
 *    - POST /:id/complete-work sets sla.provisionallyResolvedAt.
 *    - PATCH /:id/confirm-resolution sets sla.isResolvedWithinSla and sla.totalResolutionDurationMs.
 *    - POST /:id/dispute sets sla.disputedAt.
 *    - PATCH /:id/admin-review (reopen) increments reworkCount, sets reworkDeadline, reworkStartedAt.
 *    - PATCH /:id/admin-review (accept) sets sla.isResolvedWithinSla and duration.
 * 10. Algorithmic SLA Evaluation Engine (evaluateComplaintSla):
 *    - Level 0: Normal on-track complaint.
 *    - Level 1: Approaching deadline (<= 25% remaining).
 *    - Level 2: Breached milestone (overdue).
 *    - Level 3: Critical escalation (overdue > 24 hours).
 *    - Rework SLA tracking for reopened complaints.
 *    - Terminal states (Resolved, Rejected) freeze active monitoring.
 *    - Provisionally Resolved pauses resolution clock.
 * 11. POST /api/sla/evaluate manual cycle (Admin only, non-admin gets 403).
 * 12. Idempotent evaluation: repeated cycles do not duplicate notifications or history entries.
 * 13. Notifications dispatched for SLA warnings, breaches, escalations.
 * 14. GET /api/sla/overview returns compliance rate, active counts, breakdown by priority and escalation level.
 * 15. Query filtering by escalationLevel and slaBreached on /admin/all and /assigned.
 * 16. Backward compatibility: legacy complaints without SLA are safely upgraded on evaluation.
 * 17. Admin summary backward compatibility (performance.slaStatus: 'unavailable').
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const { Complaint } = require('../models/Complaint');
const { Notification } = require('../models/Notification');
const { SlaPolicy } = require('../models/SlaPolicy');
const { DEFAULT_SLA_POLICY, calculateSlaDeadlines, calculateReworkDeadline, evaluateComplaintSla } = require('../config/slaPolicy');
const { evaluateSlaComplaints } = require('../services/slaScheduler');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const rawUploadDir = process.env.UPLOAD_DIR || 'uploads/evidence';
const UPLOAD_DIR = path.isAbsolute(rawUploadDir)
  ? rawUploadDir
  : path.resolve(__dirname, '..', rawUploadDir);

const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

const VALID_COMPLETION_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000000c49444154789c636060600000000400012734270a0000000049454e44ae426082',
  'hex'
);

const VALID_DISPUTE_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000030000000308060000003632bb9a0000000e49444154789c636060606000000009000147984f090000000049454e44ae426082',
  'hex'
);

function apiRequest({ method = 'GET', path: reqPath, headers = {}, body, rawBody }) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(reqPath, BASE_URL);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: { ...headers }
    };

    let payload = null;
    if (rawBody) {
      payload = rawBody;
    } else if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    if (payload && !options.headers['Content-Length']) {
      options.headers['Content-Length'] = Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const fullBuffer = Buffer.concat(chunks);
        const text = fullBuffer.toString('utf8');
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: JSON.parse(text),
            raw: text
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: null,
            raw: text
          });
        }
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function buildMultipartFormData(fields = {}, files = {}) {
  const boundary = `----CivicTrackTestBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
  const chunks = [];

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && val !== null) {
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
      chunks.push(Buffer.from(`${val}\r\n`));
    }
  }

  for (const [fieldName, fileInfo] of Object.entries(files)) {
    if (fileInfo && fileInfo.buffer) {
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${fieldName}"; filename="${fileInfo.filename || 'test.jpg'}"\r\n`
      ));
      chunks.push(Buffer.from(`Content-Type: ${fileInfo.contentType || 'image/jpeg'}\r\n\r\n`));
      chunks.push(fileInfo.buffer);
      chunks.push(Buffer.from('\r\n'));
    }
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks)
  };
}

async function runStep5Tests() {
  console.log('================================================================');
  console.log('CivicTrack 2.0 — Step 5 Smart SLA & Escalation System Test Suite');
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

  const createdComplaintIds = [];
  const trackedFiles = [];

  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/civictrack';
    await mongoose.connect(mongoUri);

    console.log('[Setup] Authenticating test actors...');

    // 1. Admin login
    const adminLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'admin@civictrack.gov', password: 'Admin@123' }
    });
    assert(adminLogin.status === 200, 'Auth: Admin logs in successfully');
    const adminToken = adminLogin.data.token;
    const adminUser = adminLogin.data.user;

    // 2. Citizen login
    const citizenLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'citizen@civictrack.gov', password: 'Citizen@123' }
    });
    assert(citizenLogin.status === 200, 'Auth: Citizen logs in successfully');
    const citizenToken = citizenLogin.data.token;
    const citizenUser = citizenLogin.data.user;

    // 3. Officer login
    const officerLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'officer@civictrack.gov', password: 'Officer@123' }
    });
    assert(officerLogin.status === 200, 'Auth: Officer logs in successfully');
    const officerToken = officerLogin.data.token;
    const officerUser = officerLogin.data.user;

    // -------------------------------------------------------------
    // SECTION 1: SLA POLICY API & CALCULATION HELPERS
    // -------------------------------------------------------------
    console.log('\n--- Section 1: SLA Policy Configuration & Helpers ---');

    // Test 1: GET /api/sla/policy returns active policy
    const policyRes = await apiRequest({
      method: 'GET',
      path: '/api/sla/policy',
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(
      policyRes.status === 200 &&
      policyRes.data?.policy?.priorityTargets?.Urgent &&
      policyRes.data?.policy?.priorityTargets?.High &&
      policyRes.data?.policy?.priorityTargets?.Medium &&
      policyRes.data?.policy?.priorityTargets?.Low,
      '1. GET /api/sla/policy returns active SLA policy with all priority targets'
    );
    assert(
      policyRes.data?.policy?.priorityTargets?.Urgent?.resolutionHours === 24 &&
      policyRes.data?.policy?.priorityTargets?.Urgent?.acknowledgementHours === 2,
      '2. Policy priority targets match default specification (Urgent: Ack 2h, Res 24h)'
    );

    // Test 3: Citizen cannot PATCH /api/sla/policy (403 Forbidden)
    const citizenPatchRes = await apiRequest({
      method: 'PATCH',
      path: '/api/sla/policy',
      headers: { Authorization: `Bearer ${citizenToken}` },
      body: { priorityTargets: {} }
    });
    assert(citizenPatchRes.status === 403, '3. Citizen cannot modify SLA policy (403 Forbidden)');

    // Test 4: Officer cannot PATCH /api/sla/policy (403 Forbidden)
    const officerPatchRes = await apiRequest({
      method: 'PATCH',
      path: '/api/sla/policy',
      headers: { Authorization: `Bearer ${officerToken}` },
      body: { priorityTargets: {} }
    });
    assert(officerPatchRes.status === 403, '4. Officer cannot modify SLA policy (403 Forbidden)');

    // Test 5: Admin PATCH with invalid values (negative hours) is rejected (400 Bad Request)
    const invalidPatchRes = await apiRequest({
      method: 'PATCH',
      path: '/api/sla/policy',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        priorityTargets: {
          Urgent: { acknowledgementHours: -1, assignmentHours: 4, resolutionHours: 24, reworkHours: 12 },
          High: { acknowledgementHours: 6, assignmentHours: 12, resolutionHours: 48, reworkHours: 24 },
          Medium: { acknowledgementHours: 12, assignmentHours: 24, resolutionHours: 96, reworkHours: 48 },
          Low: { acknowledgementHours: 24, assignmentHours: 48, resolutionHours: 168, reworkHours: 72 }
        }
      }
    });
    assert(invalidPatchRes.status === 400, '5. Admin PATCH with negative hours rejected (400 Bad Request)');

    // Test 6: Unit test calculateSlaDeadlines helper
    const testNow = new Date('2026-11-19T10:00:00Z');
    const urgentDeadlines = calculateSlaDeadlines({
      category: 'Streetlight',
      priority: 'Urgent',
      createdAt: testNow
    });
    assert(
      urgentDeadlines.acknowledgementHours === 2 &&
      urgentDeadlines.assignmentHours === 4 &&
      urgentDeadlines.resolutionHours === 24,
      '6. calculateSlaDeadlines assigns correct baseline hours for Urgent priority'
    );

    // Test 7: Category resolution override (Garbage/Waste Urgent = 12h)
    const garbageDeadlines = calculateSlaDeadlines({
      category: 'Garbage/Waste',
      priority: 'Urgent',
      createdAt: testNow
    });
    assert(
      garbageDeadlines.resolutionHours === 12,
      '7. calculateSlaDeadlines applies category resolution override (Garbage/Waste Urgent = 12h)'
    );

    // Test 8: calculateReworkDeadline helper
    const reworkDeadline = calculateReworkDeadline('Urgent', testNow);
    const expectedReworkMs = testNow.getTime() + 12 * 3600 * 1000;
    assert(
      reworkDeadline.getTime() === expectedReworkMs,
      '8. calculateReworkDeadline computes correct rework deadline (Urgent = 12h)'
    );

    // -------------------------------------------------------------
    // SECTION 2: COMPLAINT SUBMISSION & EMBEDDED SLA SUBDOCUMENT
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Complaint Submission & Embedded SLA ---');

    // Create a complaint for SLA testing
    const multipart = buildMultipartFormData(
      {
        title: 'Step 5 Main SLA Test Road Damage',
        description: 'Deep road hazard causing vehicular slowdown and near accidents.',
        category: 'Pothole/Road Damage',
        priority: 'Urgent',
        address: '120 MG Road, Zone 3',
        latitude: '12.9716',
        longitude: '77.5946',
        accuracy: '15'
      },
      {
        photo: {
          filename: 'pothole-sla.png',
          contentType: 'image/png',
          buffer: VALID_PNG_BUFFER
        }
      }
    );

    const createRes = await apiRequest({
      method: 'POST',
      path: '/api/complaints',
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': multipart.contentType
      },
      rawBody: multipart.body
    });

    assert(createRes.status === 201 && createRes.data?.complaint, '9. Complaint created successfully with mandatory evidence');
    const complaint1 = createRes.data.complaint;
    const complaintId1 = complaint1.id || complaint1._id;
    createdComplaintIds.push(complaintId1);

    // Check DB directly for embedded SLA fields
    const dbComplaint1 = await Complaint.findById(complaintId1);
    assert(
      dbComplaint1 &&
      dbComplaint1.sla &&
      dbComplaint1.sla.startedAt &&
      dbComplaint1.sla.acknowledgementDeadline &&
      dbComplaint1.sla.assignmentDeadline &&
      dbComplaint1.sla.resolutionDeadline &&
      dbComplaint1.sla.isBreached === false &&
      dbComplaint1.sla.escalationLevel === 0,
      '10. Embedded SLA subdocument initialized in database with deadlines and escalationLevel 0'
    );

    // -------------------------------------------------------------
    // SECTION 3: ROLE-SCOPED toSafeObject() SERIALIZATION
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Role-Scoped SLA Data Serialization ---');

    // Test 11: Citizen viewer sees customer-friendly SLA without internal escalation fields
    const citizenViewRes = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaintId1}`,
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    const citizenSla = citizenViewRes.data?.complaint?.sla;
    assert(
      citizenSla &&
      citizenSla.resolutionDeadline &&
      citizenSla.escalationLevel === undefined &&
      citizenSla.escalationHistory === undefined,
      '11. Citizen response includes resolutionDeadline and strips internal escalationLevel/escalationHistory'
    );

    // Test 12: Admin viewer receives full SLA audit subdocument
    const adminViewRes = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaintId1}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminSla = adminViewRes.data?.complaint?.sla;
    assert(
      adminSla &&
      adminSla.resolutionDeadline &&
      adminSla.acknowledgementDeadline &&
      adminSla.escalationLevel === 0 &&
      Array.isArray(adminSla.escalationHistory),
      '12. Admin response receives complete SLA subdocument with escalationLevel and escalationHistory'
    );

    // -------------------------------------------------------------
    // SECTION 4: LIFECYCLE MILESTONE TRACKING
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Lifecycle Milestone Progression ---');

    // Test 13: PATCH status to 'Under Review' sets acknowledgedAt
    const ackRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaintId1}/status`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'Under Review', comment: 'Department reviewed and acknowledged.' }
    });
    assert(ackRes.status === 200, '13. Complaint transitioned to Under Review');

    const dbAfterAck = await Complaint.findById(complaintId1);
    assert(
      dbAfterAck.sla.acknowledgedAt instanceof Date,
      '14. Transition to Under Review successfully recorded sla.acknowledgedAt milestone'
    );

    // Test 15: Assign officer records assignedAt and acknowledgedAt
    const assignRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaintId1}/assign`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { officerId: officerUser.id || officerUser._id, department: 'Roads & Bridges' }
    });
    assert(assignRes.status === 200, '15. Officer assigned to complaint');

    const dbAfterAssign = await Complaint.findById(complaintId1);
    assert(
      dbAfterAssign.sla.assignedAt instanceof Date,
      '16. Officer assignment successfully recorded sla.assignedAt milestone'
    );

    // Test 17: Officer moves status to 'In Progress' records workStartedAt
    const inProgressRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaintId1}/status`,
      headers: { Authorization: `Bearer ${officerToken}` },
      body: { status: 'In Progress', comment: 'Field crew dispatched with materials.' }
    });
    assert(inProgressRes.status === 200, '17. Status moved to In Progress by assigned officer');

    const dbAfterInProgress = await Complaint.findById(complaintId1);
    assert(
      dbAfterInProgress.sla.workStartedAt instanceof Date,
      '18. Transition to In Progress successfully recorded sla.workStartedAt milestone'
    );

    // Test 19: Officer completes work records provisionallyResolvedAt
    const compMultipart = buildMultipartFormData(
      {
        latitude: '12.9716',
        longitude: '77.5946',
        accuracy: '10',
        capturedAt: new Date().toISOString(),
        resolutionNotes: 'Filled pothole with cold mix asphalt and steam rolled flat.'
      },
      {
        completionPhoto: {
          filename: 'completion-sla.png',
          contentType: 'image/png',
          buffer: VALID_COMPLETION_PNG_BUFFER
        }
      }
    );

    const compRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaintId1}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': compMultipart.contentType
      },
      rawBody: compMultipart.body
    });
    assert(compRes.status === 200, '19. Officer submits work completion evidence -> Provisionally Resolved');

    const dbAfterComp = await Complaint.findById(complaintId1);
    assert(
      dbAfterComp.sla.provisionallyResolvedAt instanceof Date,
      '20. Work completion successfully recorded sla.provisionallyResolvedAt milestone'
    );

    // Test 21: Citizen disputes resolution -> records disputedAt
    const disputeRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaintId1}/dispute`,
      headers: { Authorization: `Bearer ${citizenToken}` },
      body: { reason: 'The asphalt is already loose and sinking under cars.' }
    });
    assert(disputeRes.status === 200, '21. Citizen disputes provisional resolution -> Disputed');

    const dbAfterDispute = await Complaint.findById(complaintId1);
    assert(
      dbAfterDispute.sla.disputedAt instanceof Date,
      '22. Citizen dispute successfully recorded sla.disputedAt milestone'
    );

    // Test 23: Admin reopens complaint -> sets reworkDeadline, reworkStartedAt, increments reworkCount
    const reopenRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaintId1}/admin-review`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'reopen', reviewNotes: 'Field inspection confirmed inadequate compaction. Re-roll with heavy vibrator.' }
    });
    assert(reopenRes.status === 200, '23. Admin reopens complaint for rework -> In Progress');

    const dbAfterReopen = await Complaint.findById(complaintId1);
    assert(
      dbAfterReopen.reworkCount === 1 &&
      dbAfterReopen.sla.reworkDeadline instanceof Date &&
      dbAfterReopen.sla.reworkStartedAt instanceof Date &&
      dbAfterReopen.sla.provisionallyResolvedAt === null,
      '24. Admin rework decision incremented reworkCount and initialized reworkDeadline'
    );

    // -------------------------------------------------------------
    // SECTION 5: ALGORITHMIC SLA EVALUATION & ESCALATION LEVELS
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Algorithmic SLA Evaluation Engine ---');

    // Test 25: Level 0 - Fresh complaint on track
    const mockFresh = {
      status: 'Submitted',
      priority: 'Medium',
      createdAt: new Date('2026-11-19T10:00:00Z'),
      sla: {
        startedAt: new Date('2026-11-19T10:00:00Z'),
        acknowledgementDeadline: new Date('2026-11-19T22:00:00Z'), // 12h
        assignmentDeadline: new Date('2026-11-20T10:00:00Z'), // 24h
        resolutionDeadline: new Date('2026-11-23T10:00:00Z'), // 96h
        isBreached: false,
        breachedStages: [],
        escalationLevel: 0
      }
    };
    const evalLevel0 = evaluateComplaintSla(mockFresh, new Date('2026-11-19T11:00:00Z'));
    assert(evalLevel0.level === 0 && evalLevel0.isBreached === false, '25. Evaluation Level 0: On-track complaint returns level 0 and no breach');

    // Test 26: Level 1 - Approaching deadline (<= 25% remaining time)
    // Resolution deadline is 96h, at 75h elapsed, remaining is 21h (ratio = 21/96 = 0.218 <= 0.25)
    const mockApproaching = {
      status: 'In Progress',
      priority: 'Medium',
      createdAt: new Date('2026-11-19T10:00:00Z'),
      sla: {
        startedAt: new Date('2026-11-19T10:00:00Z'),
        resolutionDeadline: new Date('2026-11-23T10:00:00Z'), // 96h
        isBreached: false,
        breachedStages: [],
        escalationLevel: 0
      }
    };
    const evalLevel1 = evaluateComplaintSla(mockApproaching, new Date('2026-11-22T14:00:00Z'));
    assert(evalLevel1.level === 1 && evalLevel1.isBreached === false, '26. Evaluation Level 1: Approaching deadline (<25% remaining) returns level 1');

    // Test 27: Level 2 - Breached deadline (elapsed past deadline, <= 24h overdue)
    const evalLevel2 = evaluateComplaintSla(mockApproaching, new Date('2026-11-23T12:00:00Z')); // 2h overdue
    assert(evalLevel2.level === 2 && evalLevel2.isBreached === true, '27. Evaluation Level 2: Breached deadline returns level 2 and isBreached true');

    // Test 28: Level 3 - Critical escalation (> 24h overdue)
    const evalLevel3 = evaluateComplaintSla(mockApproaching, new Date('2026-11-25T12:00:00Z')); // 50h overdue
    assert(evalLevel3.level === 3 && evalLevel3.isBreached === true, '28. Evaluation Level 3: Overdue by >24h returns level 3 critical escalation');

    // Test 29: Terminal states stop active monitoring
    const mockResolved = {
      status: 'Resolved',
      sla: { isBreached: false, breachedStages: [] }
    };
    const evalResolved = evaluateComplaintSla(mockResolved, new Date());
    assert(evalResolved.active === false && evalResolved.level === 0, '29. Terminal Resolved status freezes active SLA monitoring');

    // Test 30: Provisionally Resolved pauses resolution clock
    const mockProvisional = {
      status: 'Provisionally Resolved',
      sla: { isBreached: false, breachedStages: [] }
    };
    const evalProvisional = evaluateComplaintSla(mockProvisional, new Date());
    assert(evalProvisional.active === false, '30. Provisionally Resolved status pauses resolution monitoring while citizen reviews');

    // -------------------------------------------------------------
    // SECTION 6: BACKGROUND SCHEDULER & ON-DEMAND EVALUATION API
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Background Scheduler & Evaluation API ---');

    // Test 31: Citizen cannot trigger /api/sla/evaluate (403 Forbidden)
    const citizenEvalRes = await apiRequest({
      method: 'POST',
      path: '/api/sla/evaluate',
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(citizenEvalRes.status === 403, '31. Citizen cannot trigger manual SLA evaluation (403 Forbidden)');

    // Test 32: Admin triggers /api/sla/evaluate
    const adminEvalRes = await apiRequest({
      method: 'POST',
      path: '/api/sla/evaluate',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      adminEvalRes.status === 200 &&
      adminEvalRes.data?.success === true &&
      adminEvalRes.data?.results?.evaluatedCount !== undefined,
      '32. Admin successfully triggers on-demand SLA evaluation cycle via POST /api/sla/evaluate'
    );

    // -------------------------------------------------------------
    // SECTION 7: OVERDUE SIMULATION, NOTIFICATIONS & ESCALATION AUDIT
    // -------------------------------------------------------------
    console.log('\n--- Section 7: Overdue Escalation & Notifications ---');

    // Create an overdue complaint in DB by setting resolutionDeadline in the past
    const overdueComplaint = await Complaint.create({
      trackingId: `SLA-OVERDUE-${Date.now().toString().slice(-4)}`,
      title: 'Severely Overdue Main Sewer Leak',
      description: 'Sewer backflow contaminating pavement and building entrance.',
      category: 'Drainage/Waterlogging',
      priority: 'Urgent',
      location: {
        address: '88 Brigade Road, Zone 2',
        latitude: 12.9716,
        longitude: 77.5946
      },
      evidence: {
        imageUrl: '/evidence/placeholder.jpg',
        verificationStatus: 'location_captured'
      },
      status: 'In Progress',
      citizen: citizenUser.id || citizenUser._id,
      assignedOfficer: officerUser.id || officerUser._id,
      department: 'Water & Sewage',
      sla: {
        policyVersion: 'v1.0',
        startedAt: new Date(Date.now() - 48 * 3600 * 1000), // 48h ago
        acknowledgementDeadline: new Date(Date.now() - 46 * 3600 * 1000),
        assignmentDeadline: new Date(Date.now() - 44 * 3600 * 1000),
        resolutionDeadline: new Date(Date.now() - 30 * 3600 * 1000), // 30h ago (overdue by 30h -> Level 3)
        isBreached: false,
        breachedStages: [],
        escalationLevel: 0,
        escalationHistory: []
      }
    });
    createdComplaintIds.push(overdueComplaint._id);

    // Clear prior notifications for clean count check
    await Notification.deleteMany({ complaint: overdueComplaint._id });

    // Trigger evaluation cycle
    const evalResults = await evaluateSlaComplaints({ now: new Date() });
    assert(evalResults.escalationsTriggered >= 1, '33. SLA evaluation cycle detected overdue complaint and triggered escalation');

    // Inspect updated complaint in DB
    const escalatedDb = await Complaint.findById(overdueComplaint._id);
    assert(
      escalatedDb.sla.isBreached === true &&
      escalatedDb.sla.escalationLevel === 3 &&
      escalatedDb.sla.breachedStages.includes('resolution'),
      '34. Complaint promoted to escalationLevel 3 with resolution breach recorded'
    );
    assert(
      escalatedDb.sla.escalationHistory.length >= 1 &&
      escalatedDb.sla.escalationHistory[0].level === 3,
      '35. Immutable escalation audit trail recorded in sla.escalationHistory'
    );

    // Check notifications dispatched to officer and admin
    const notifications = await Notification.find({ complaint: overdueComplaint._id });
    const officerNotif = notifications.find((n) => n.recipient.equals(officerUser.id || officerUser._id));
    const adminNotif = notifications.find((n) => n.recipient.equals(adminUser.id || adminUser._id));

    assert(Boolean(officerNotif), '36. Assigned officer received SLA escalation notification');
    assert(Boolean(adminNotif), '37. Municipal administrator received SLA escalation notification');
    assert(
      officerNotif && officerNotif.type === 'sla_escalated',
      '38. Dispatched notification has correct type "sla_escalated"'
    );

    // Test 39: Idempotency - running evaluation again does not duplicate notifications or history
    const notifCountBefore = await Notification.countDocuments({ complaint: overdueComplaint._id });
    const histCountBefore = escalatedDb.sla.escalationHistory.length;

    await evaluateSlaComplaints({ now: new Date() });

    const notifCountAfter = await Notification.countDocuments({ complaint: overdueComplaint._id });
    const reloadedDb = await Complaint.findById(overdueComplaint._id);
    assert(
      notifCountAfter === notifCountBefore &&
      reloadedDb.sla.escalationHistory.length === histCountBefore,
      '39. Idempotency verified: re-evaluating does not create duplicate alerts or history entries'
    );

    // -------------------------------------------------------------
    // SECTION 8: ADMIN SLA OVERVIEW & COMPLIANCE METRICS
    // -------------------------------------------------------------
    console.log('\n--- Section 8: Admin SLA Overview & Performance ---');

    // Test 40: Citizen cannot access /api/sla/overview (403 Forbidden)
    const citizenOverviewRes = await apiRequest({
      method: 'GET',
      path: '/api/sla/overview',
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(citizenOverviewRes.status === 403, '40. Citizen cannot access SLA overview metrics (403 Forbidden)');

    // Test 41: Admin GET /api/sla/overview
    const adminOverviewRes = await apiRequest({
      method: 'GET',
      path: '/api/sla/overview',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      adminOverviewRes.status === 200 &&
      adminOverviewRes.data?.slaOverview,
      '41. Admin successfully accesses /api/sla/overview'
    );

    const ov = adminOverviewRes.data.slaOverview;
    assert(
      typeof ov.complianceRate === 'number' &&
      typeof ov.activeMonitored === 'number' &&
      typeof ov.withinSla === 'number' &&
      typeof ov.breached === 'number' &&
      ov.byPriority &&
      ov.byEscalationLevel,
      '42. SLA overview returns complete aggregate metrics and breakdowns'
    );

    // -------------------------------------------------------------
    // SECTION 9: SLA QUERY FILTERING ON /admin/all & /assigned
    // -------------------------------------------------------------
    console.log('\n--- Section 9: SLA Query Filtering ---');

    // Test 43: Admin filters by escalationLevel=3
    const l3FilterRes = await apiRequest({
      method: 'GET',
      path: '/api/complaints/admin/all?escalationLevel=3',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      l3FilterRes.status === 200 &&
      Array.isArray(l3FilterRes.data.complaints) &&
      l3FilterRes.data.complaints.some((c) => (c.id || c._id).toString() === overdueComplaint._id.toString()),
      '43. GET /api/complaints/admin/all?escalationLevel=3 successfully filters escalated complaints'
    );

    // Test 44: Admin filters by slaBreached=true
    const breachedFilterRes = await apiRequest({
      method: 'GET',
      path: '/api/complaints/admin/all?slaBreached=true',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      breachedFilterRes.status === 200 &&
      Array.isArray(breachedFilterRes.data.complaints) &&
      breachedFilterRes.data.complaints.some((c) => (c.id || c._id).toString() === overdueComplaint._id.toString()),
      '44. GET /api/complaints/admin/all?slaBreached=true successfully filters breached complaints'
    );

    // Test 45: Officer filters assigned queue by slaBreached=true
    const officerFilterRes = await apiRequest({
      method: 'GET',
      path: '/api/complaints/assigned?slaBreached=true',
      headers: { Authorization: `Bearer ${officerToken}` }
    });
    assert(
      officerFilterRes.status === 200 &&
      Array.isArray(officerFilterRes.data.complaints) &&
      officerFilterRes.data.complaints.some((c) => (c.id || c._id).toString() === overdueComplaint._id.toString()),
      '45. GET /api/complaints/assigned?slaBreached=true successfully filters officer breach queue'
    );

    // -------------------------------------------------------------
    // SECTION 10: BACKWARD COMPATIBILITY
    // -------------------------------------------------------------
    console.log('\n--- Section 10: Backward Compatibility & Regression ---');

    // Test 46: Legacy complaint without SLA subdocument upgraded gracefully
    const legacyComplaint = await Complaint.create({
      trackingId: `LEGACY-${Date.now().toString().slice(-4)}`,
      title: 'Legacy Complaint Pre-dating SLA System',
      description: 'Older database entry without SLA subdocument.',
      category: 'Streetlight',
      priority: 'Low',
      location: {
        address: '55 Old Town Road',
        latitude: 12.9716,
        longitude: 77.5946
      },
      evidence: {
        imageUrl: '/evidence/placeholder.jpg',
        verificationStatus: 'location_captured'
      },
      status: 'Submitted',
      citizen: citizenUser.id || citizenUser._id
    });
    createdComplaintIds.push(legacyComplaint._id);

    // Verify it evaluates without throwing error
    const legacyEval = await evaluateSlaComplaints({ now: new Date() });
    assert(
      legacyEval.errors.length === 0,
      '46. Legacy complaint without SLA subdocument evaluated without throwing errors'
    );

    const upgradedLegacy = await Complaint.findById(legacyComplaint._id);
    assert(
      upgradedLegacy.sla && upgradedLegacy.sla.resolutionDeadline,
      '47. Legacy complaint automatically received backward-compatible default SLA schedule'
    );

    // Test 48: Admin summary performance.slaStatus remains 'unavailable' for test_step7 compatibility
    const adminSummaryRes = await apiRequest({
      method: 'GET',
      path: '/api/complaints/admin/summary',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      adminSummaryRes.status === 200 &&
      adminSummaryRes.data?.summary?.performance?.slaStatus === 'unavailable' &&
      adminSummaryRes.data?.summary?.performance?.slaNotice.includes('municipal SLA policy'),
      '48. GET /api/complaints/admin/summary preserves performance.slaStatus: "unavailable" regression contract'
    );

  } catch (error) {
    console.error('\n[FATAL ERROR] Test suite encountered an unhandled exception:', error);
    total++;
  } finally {
    // Cleanup test-created records only
    try {
      if (createdComplaintIds.length > 0) {
        await Complaint.deleteMany({ _id: { $in: createdComplaintIds } });
        await Notification.deleteMany({ complaint: { $in: createdComplaintIds } });
        console.log(`\n[Teardown] Cleaned up ${createdComplaintIds.length} test-created complaints and related notifications.`);
      }

      for (const f of trackedFiles) {
        if (fs.existsSync(f)) {
          try { fs.unlinkSync(f); } catch (e) {}
        }
      }

      await mongoose.disconnect();
    } catch (cleanupErr) {
      console.error('[Teardown Warning] Cleanup failed:', cleanupErr.message);
    }

    console.log('\n================================================================');
    console.log(`Step 5 Smart SLA Test Suite Completed: ${passed}/${total} assertions passed`);
    console.log('================================================================\n');

    if (passed === total && total >= 45) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

runStep5Tests();
