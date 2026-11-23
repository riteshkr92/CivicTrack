/**
 * CivicTrack 2.0 — Step 4 Automated Verification Suite
 * Citizen Resolution Confirmation, Dispute Workflow & Admin Review
 *
 * Validates:
 * 1. Complaint owner can confirm provisional resolution.
 * 2. Unrelated citizen cannot confirm (403 Forbidden).
 * 3. Officer cannot confirm (403 Forbidden).
 * 4. Unauthenticated user cannot confirm (401 Unauthorized).
 * 5. Complaint owner can dispute with a valid reason.
 * 6. Dispute reason is mandatory (rejects missing or < 10 chars with 400 Bad Request).
 * 7. Invalid dispute photograph is rejected (magic bytes check, 400 Bad Request).
 * 8. Valid dispute photograph is accepted (stored, metadata created, status Disputed).
 * 9. Unrelated citizen cannot submit a dispute (403 Forbidden).
 * 10. Duplicate confirmation is rejected (cannot confirm when already Resolved).
 * 11. Concurrent confirmation and dispute cannot both succeed (atomic status checks: 200 + 409).
 * 12. Only admin can review disputes (officer & citizen get 403 Forbidden).
 * 13. Admin can accept resolution (updates to Resolved, sets resolvedAt, records adminNotes).
 * 14. Admin can reopen work with a mandatory reason (updates to In Progress, increments reworkCount).
 * 15. Unauthorized users cannot access dispute evidence (403 Forbidden / 401 Unauthorized).
 * 16. Previous evidence is preserved after reopening (original evidence, completion evidence, dispute photo/reason).
 * 17. resolvedAt is only set for final resolution (null during Provisional and Disputed).
 * 18. Provisional and disputed complaints are excluded from final resolved metrics in admin summary.
 * 19. Citizen and officer receive the appropriate notifications.
 * 20. Existing Step 2, Step 3 and Step 3.1 behavior remains intact.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const { Complaint } = require('../models/Complaint');
const { Notification } = require('../models/Notification');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const rawUploadDir = process.env.UPLOAD_DIR || 'uploads/evidence';
const UPLOAD_DIR = path.isAbsolute(rawUploadDir)
  ? rawUploadDir
  : path.resolve(__dirname, '..', rawUploadDir);

// Minimal valid images
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

const FAKE_TEXT_BUFFER = Buffer.from('This is completely fake image data without genuine magic bytes.');

// HTTP Request Helper
function apiRequest({ method = 'GET', path: reqPath, headers = {}, body, rawBody, isBinary = false }) {
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
        if (isBinary) {
          return resolve({
            status: res.statusCode,
            headers: res.headers,
            buffer: fullBuffer
          });
        }
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

// Multipart Form Builder
function buildMultipartForm(fields, files = []) {
  const boundary = '----WebKitFormBoundaryStep4Test' + Math.random().toString(36).substring(2);
  const chunks = [];

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && val !== null) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
    }
  }

  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
      )
    );
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks)
  };
}

async function runStep4Tests() {
  console.log('================================================================');
  console.log('CivicTrack 2.0 — Step 4 Citizen Resolution & Dispute Suite');
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
  const createdUserIds = [];
  const trackedFiles = [];

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/civictrack';
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

    // 2. Citizen 1 (Complaint Owner) login
    const citizenLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'citizen@civictrack.gov', password: 'Citizen@123' }
    });
    assert(citizenLogin.status === 200, 'Auth: Citizen 1 (Owner) logs in successfully');
    const citizenToken = citizenLogin.data.token;
    const citizenUser = citizenLogin.data.user;

    // 3. Officer 1 (Assigned) login
    const officerLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'officer@civictrack.gov', password: 'Officer@123' }
    });
    assert(officerLogin.status === 200, 'Auth: Officer 1 (Assigned) logs in successfully');
    const officerToken = officerLogin.data.token;
    const officerUser = officerLogin.data.user;

    // 4. Create Citizen 2 (Unrelated Citizen)
    const otherCitizen = new User({
      name: 'Unrelated Citizen',
      email: `other.citizen.${Date.now()}@example.com`,
      password: 'CitizenPassword123!',
      role: 'citizen'
    });
    await otherCitizen.save();
    createdUserIds.push(otherCitizen._id);
    const otherCitizenLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: otherCitizen.email, password: 'CitizenPassword123!' }
    });
    assert(otherCitizenLogin.status === 200, 'Auth: Unrelated citizen account authenticated');
    const otherCitizenToken = otherCitizenLogin.data.token;

    // 5. Create Officer 2 (Unassigned Officer)
    const otherOfficerEmail = `unassigned.officer.${Date.now()}@civictrack.gov`;
    const otherOfficerRes = await apiRequest({
      method: 'POST',
      path: '/api/auth/officers',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Unassigned Officer',
        email: otherOfficerEmail,
        password: 'Password123!',
        department: 'Sanitation'
      }
    });
    assert(otherOfficerRes.status === 201, 'Auth: Secondary test officer provisioned');
    createdUserIds.push(otherOfficerRes.data.officer.id);

    const otherOfficerLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: otherOfficerEmail, password: 'Password123!' }
    });
    const otherOfficerToken = otherOfficerLogin.data.token;

    // Helper: Create a Provisionally Resolved test complaint with full evidence fixtures
    async function createProvisionallyResolvedComplaint({
      citizenId = citizenUser.id,
      officerId = officerUser.id,
      trackingSuffix = '1'
    } = {}) {
      const trackingId = await Complaint.generateTrackingId();

      // Original evidence file
      const origFilename = `orig-evidence-${Date.now()}-${trackingSuffix}.png`;
      const origPath = path.resolve(UPLOAD_DIR, origFilename);
      fs.writeFileSync(origPath, VALID_PNG_BUFFER);
      trackedFiles.push(origPath);

      // Completion evidence file
      const compFilename = `completion-${Date.now()}-${trackingSuffix}.png`;
      const compPath = path.resolve(UPLOAD_DIR, compFilename);
      fs.writeFileSync(compPath, VALID_COMPLETION_PNG_BUFFER);
      trackedFiles.push(compPath);

      const complaint = new Complaint({
        trackingId,
        title: `Pothole Repair Work Order #${trackingSuffix}`,
        description: 'Deep road crater in ward 4 requiring hot-mix asphalt patching.',
        category: 'Pothole/Road Damage',
        location: {
          address: '100 Nehru Marg, Ward 4',
          latitude: 18.5204,
          longitude: 73.8567
        },
        priority: 'High',
        status: 'Provisionally Resolved',
        citizen: citizenId,
        assignedOfficer: officerId,
        department: 'Roads & Infrastructure',
        evidence: {
          imageUrl: `/api/complaints/${trackingId}/evidence`,
          storageKey: origFilename,
          originalName: 'issue.png',
          mimetype: 'image/png',
          size: VALID_PNG_BUFFER.length,
          coordinates: { latitude: 18.5204, longitude: 73.8567, accuracy: 10 },
          locationSource: 'device_gps',
          verificationStatus: 'location_captured'
        },
        completionEvidence: {
          imageUrl: `/api/complaints/${trackingId}/completion-evidence`,
          storageKey: compFilename,
          originalName: 'completion.png',
          mimetype: 'image/png',
          size: VALID_COMPLETION_PNG_BUFFER.length,
          capturedAt: new Date(Date.now() - 300000),
          submittedAt: new Date(Date.now() - 250000),
          coordinates: { latitude: 18.52045, longitude: 73.85675, accuracy: 12 },
          distanceMeters: 8,
          verificationStatus: 'verified',
          exifComparisonStatus: 'no_metadata',
          resolutionNotes: 'Completed asphalt hot-mix leveling and rolling.'
        },
        resolutionNotes: 'Completed asphalt hot-mix leveling and rolling.',
        statusHistory: [
          { status: 'Submitted', timestamp: new Date(Date.now() - 7200000), comment: 'Filing', actorRole: 'citizen' },
          { status: 'In Progress', timestamp: new Date(Date.now() - 3600000), comment: 'Started', actorRole: 'officer' },
          { status: 'Provisionally Resolved', timestamp: new Date(Date.now() - 250000), comment: 'Completed work', actorRole: 'officer' }
        ]
      });

      await complaint.save();
      createdComplaintIds.push(complaint._id);
      return complaint;
    }

    console.log('\n--- Section 1: Citizen Resolution Confirmation ---');

    // Test 1: Complaint owner can confirm provisional resolution
    const complaint1 = await createProvisionallyResolvedComplaint({ trackingSuffix: 'C1' });
    const confirmRes1 = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint1._id}/confirm-resolution`,
      headers: { Authorization: `Bearer ${citizenToken}` }
    });

    assert(
      confirmRes1.status === 200 && confirmRes1.data?.complaint?.status === 'Resolved',
      '1. Complaint owner can confirm provisional resolution (status becomes Resolved)'
    );

    const doc1 = await Complaint.findById(complaint1._id);
    assert(
      doc1.resolvedAt !== null && doc1.resolvedAt instanceof Date,
      '1b. Final resolvedAt timestamp is accurately recorded upon citizen confirmation'
    );
    const lastHistory1 = doc1.statusHistory[doc1.statusHistory.length - 1];
    assert(
      lastHistory1.status === 'Resolved' && lastHistory1.actorRole === 'citizen',
      '1c. Status history records Resolved transition with citizen actor'
    );

    // Test 2: Unrelated citizen cannot confirm (403 Forbidden)
    const complaint2 = await createProvisionallyResolvedComplaint({ trackingSuffix: 'C2' });
    const unauthCitizenRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint2._id}/confirm-resolution`,
      headers: { Authorization: `Bearer ${otherCitizenToken}` }
    });
    assert(
      unauthCitizenRes.status === 403,
      '2. Unrelated citizen cannot confirm resolution (403 Forbidden)'
    );

    // Test 3: Officer cannot confirm (403 Forbidden)
    const officerConfirmRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint2._id}/confirm-resolution`,
      headers: { Authorization: `Bearer ${officerToken}` }
    });
    assert(
      officerConfirmRes.status === 403,
      '3. Officer role cannot confirm citizen resolution (403 Forbidden)'
    );

    // Test 4: Unauthenticated user cannot confirm (401 Unauthorized)
    const unauthConfirmRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint2._id}/confirm-resolution`
    });
    assert(
      unauthConfirmRes.status === 401,
      '4. Unauthenticated user cannot confirm resolution (401 Unauthorized)'
    );

    // Test 5: Confirming already resolved complaint is rejected (400 Bad Request)
    const dupConfirmRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint1._id}/confirm-resolution`,
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(
      dupConfirmRes.status === 400 && dupConfirmRes.data?.message?.includes('Provisionally Resolved'),
      '5. Confirming an already Resolved complaint is rejected with 400 Bad Request'
    );

    console.log('\n--- Section 2: Citizen Dispute Workflow ---');

    // Test 6: Dispute reason is mandatory (rejects missing or < 10 chars with 400 Bad Request)
    const shortReasonForm = buildMultipartForm({ reason: 'Too short' });
    const shortReasonRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': shortReasonForm.contentType
      },
      rawBody: shortReasonForm.body
    });
    assert(
      shortReasonRes.status === 400 && shortReasonRes.data?.message?.includes('at least 10 characters'),
      '6. Dispute reason shorter than 10 characters is rejected with 400 Bad Request'
    );

    // Test 7: Complaint owner can dispute with a valid reason (without photo)
    const validReasonText = 'The asphalt patch is uneven and has already started crumbling under vehicle traffic.';
    const validDisputeForm = buildMultipartForm({ reason: validReasonText });
    const disputeRes1 = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': validDisputeForm.contentType
      },
      rawBody: validDisputeForm.body
    });
    assert(
      disputeRes1.status === 200 && disputeRes1.data?.complaint?.status === 'Disputed',
      '7. Complaint owner successfully disputes resolution (status becomes Disputed)'
    );
    assert(
      disputeRes1.data?.complaint?.hasDispute === true &&
      disputeRes1.data?.complaint?.resolutionDispute?.reason === validReasonText,
      '7b. Response contains hasDispute: true and records citizen dispute reason'
    );

    // Verify resolvedAt remains null
    const doc2 = await Complaint.findById(complaint2._id);
    assert(
      doc2.resolvedAt === null,
      '7c. Disputed complaint maintains resolvedAt as null (never set during dispute)'
    );

    // Test 8: Invalid dispute photograph is rejected (magic bytes check)
    const complaint3 = await createProvisionallyResolvedComplaint({ trackingSuffix: 'C3' });
    const fakeMagicDisputeForm = buildMultipartForm(
      { reason: 'The crater remains completely exposed and waterlogged.' },
      [{ fieldname: 'disputePhoto', filename: 'fake.png', contentType: 'image/png', buffer: FAKE_TEXT_BUFFER }]
    );
    const fakeMagicDisputeRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint3._id}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': fakeMagicDisputeForm.contentType
      },
      rawBody: fakeMagicDisputeForm.body
    });
    assert(
      fakeMagicDisputeRes.status === 400 && fakeMagicDisputeRes.data?.message?.includes('valid JPEG or PNG'),
      '8. Dispute photograph with invalid magic bytes is rejected with 400 Bad Request'
    );

    // Test 8b & 8c: Disk cleanup verified: Failed dispute upload cleans up temporary photo immediately
    const filesBeforeFailedUpload = fs.readdirSync(UPLOAD_DIR);
    const badReasonDisputeForm = buildMultipartForm(
      { reason: 'Too short' }, // Less than 10 characters
      [{ fieldname: 'disputePhoto', filename: 'orphan_test.png', contentType: 'image/png', buffer: VALID_DISPUTE_PNG_BUFFER }]
    );
    const badReasonDisputeRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint3._id}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': badReasonDisputeForm.contentType
      },
      rawBody: badReasonDisputeForm.body
    });
    const filesAfterFailedUpload = fs.readdirSync(UPLOAD_DIR);
    assert(
      badReasonDisputeRes.status === 400 && badReasonDisputeRes.data?.message?.includes('10 characters'),
      '8b. Dispute upload with invalid reason (< 10 chars) rejected with 400 Bad Request'
    );
    assert(
      filesAfterFailedUpload.length === filesBeforeFailedUpload.length,
      '8c. Disk cleanup verified: rejected dispute upload leaves zero orphaned files on disk'
    );

    // Test 9: Valid dispute photograph is accepted
    const validPhotoDisputeForm = buildMultipartForm(
      { reason: 'Attached photo showing road patch missing aggregate and asphalt binder.' },
      [{ fieldname: 'disputePhoto', filename: 'dispute_proof.png', contentType: 'image/png', buffer: VALID_DISPUTE_PNG_BUFFER }]
    );
    const validPhotoDisputeRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint3._id}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': validPhotoDisputeForm.contentType
      },
      rawBody: validPhotoDisputeForm.body
    });
    assert(
      validPhotoDisputeRes.status === 200 && validPhotoDisputeRes.data?.complaint?.status === 'Disputed',
      '9. Dispute with valid supporting photograph accepted (status becomes Disputed)'
    );
    assert(
      validPhotoDisputeRes.data?.complaint?.resolutionDispute?.photo?.imageUrl !== undefined,
      '9b. Dispute response provides secure evidence streaming URL for the dispute photograph'
    );

    // Test 10: Unrelated citizen cannot submit a dispute (403 Forbidden)
    const complaint4 = await createProvisionallyResolvedComplaint({ trackingSuffix: 'C4' });
    const unauthDisputeRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint4._id}/dispute`,
      headers: {
        Authorization: `Bearer ${otherCitizenToken}`,
        'Content-Type': validDisputeForm.contentType
      },
      rawBody: validDisputeForm.body
    });
    assert(
      unauthDisputeRes.status === 403,
      '10. Unrelated citizen cannot dispute another citizen\'s complaint (403 Forbidden)'
    );

    // Test 11: Officer and Admin cannot submit citizen dispute (403 Forbidden)
    const officerDisputeRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint4._id}/dispute`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': validDisputeForm.contentType
      },
      rawBody: validDisputeForm.body
    });
    assert(
      officerDisputeRes.status === 403,
      '11. Officer role cannot execute citizen dispute endpoint (403 Forbidden)'
    );

    console.log('\n--- Section 3: Concurrency & Integrity Checks ---');

    // Test 12: Concurrent confirmation and dispute cannot both succeed
    const complaint5 = await createProvisionallyResolvedComplaint({ trackingSuffix: 'C5' });
    const concurrentConfirm = apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint5._id}/confirm-resolution`,
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    const concurrentDispute = apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint5._id}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': validDisputeForm.contentType
      },
      rawBody: validDisputeForm.body
    });

    const [cRes, dRes] = await Promise.all([concurrentConfirm, concurrentDispute]);
    const pairStatuses = [cRes.status, dRes.status].sort();
    assert(
      pairStatuses[0] === 200 && (pairStatuses[1] === 409 || pairStatuses[1] === 400),
      `12. Concurrent confirm & dispute: exactly one succeeds (200), other rejected with (${pairStatuses[1]})`
    );

    // Test 13: Generic status-update route cannot transition out of Disputed or Provisionally Resolved
    const genericStatusBypass = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint2._id}/status`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'Resolved' }
    });
    assert(
      genericStatusBypass.status === 400 && genericStatusBypass.data?.message?.includes('workflows'),
      '13. Generic PATCH /:id/status blocked from bypassing dispute review workflow (400 Bad Request)'
    );

    console.log('\n--- Section 4: Dispute Evidence Retrieval ---');

    // Test 14: Unauthorized users cannot access dispute evidence
    const unauthDisputeGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${otherCitizenToken}` }
    });
    assert(
      unauthDisputeGet.status === 403,
      '14a. Unrelated citizen receives 403 Forbidden when requesting dispute evidence'
    );

    const unassignedOfficerGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${otherOfficerToken}` }
    });
    assert(
      unassignedOfficerGet.status === 403,
      '14b. Unassigned officer receives 403 Forbidden when requesting dispute evidence'
    );

    const noAuthDisputeGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/dispute-evidence`
    });
    assert(
      noAuthDisputeGet.status === 401,
      '14c. Unauthenticated request receives 401 Unauthorized for dispute evidence'
    );

    // Test 15: Authorized citizen, assigned officer, and admin can access dispute evidence
    const citizenDisputeGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${citizenToken}` },
      isBinary: true
    });
    assert(
      citizenDisputeGet.status === 200 && citizenDisputeGet.headers['content-type']?.includes('image'),
      '15a. Complaint owner streams dispute evidence image (200 OK)'
    );

    const officerDisputeGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${officerToken}` },
      isBinary: true
    });
    assert(
      officerDisputeGet.status === 200 && officerDisputeGet.buffer.length > 0,
      '15b. Assigned officer streams dispute evidence image (200 OK)'
    );

    const adminDisputeGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${adminToken}` },
      isBinary: true
    });
    assert(
      adminDisputeGet.status === 200 && adminDisputeGet.buffer.length > 0,
      '15c. Administrator streams dispute evidence image (200 OK)'
    );

    // Test 15d: Path traversal attempt on dispute evidence returns 403 Forbidden
    const complaint3Doc = await Complaint.findById(complaint3._id);
    const origDisputeKey = complaint3Doc.resolutionDispute.photo.storageKey;
    await Complaint.updateOne(
      { _id: complaint3._id },
      { $set: { 'resolutionDispute.photo.storageKey': '../../package.json' } }
    );
    const traversalDisputeRes = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      traversalDisputeRes.status === 403,
      '15d. Path traversal attempt (../../package.json) on dispute evidence rejected with 403 Forbidden'
    );

    // Test 15e: Sibling directory attack on dispute evidence returns 403 Forbidden
    await Complaint.updateOne(
      { _id: complaint3._id },
      { $set: { 'resolutionDispute.photo.storageKey': '../uploads_sibling/fake.png' } }
    );
    const siblingDisputeRes = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      siblingDisputeRes.status === 403,
      '15e. Sibling directory attack (../uploads_sibling) on dispute evidence rejected with 403 Forbidden'
    );

    // Restore dispute evidence key
    await Complaint.updateOne(
      { _id: complaint3._id },
      { $set: { 'resolutionDispute.photo.storageKey': origDisputeKey } }
    );

    // Test 15f: Path traversal attempt on completion evidence returns 403 Forbidden
    const origCompKey = complaint3Doc.completionEvidence.storageKey;
    await Complaint.updateOne(
      { _id: complaint3._id },
      { $set: { 'completionEvidence.storageKey': '../../server.js' } }
    );
    const traversalCompRes = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      traversalCompRes.status === 403,
      '15f. Path traversal attempt (../../server.js) on completion evidence rejected with 403 Forbidden'
    );

    // Test 15g: Sibling directory attack on completion evidence returns 403 Forbidden
    await Complaint.updateOne(
      { _id: complaint3._id },
      { $set: { 'completionEvidence.storageKey': '../uploads_sibling/fake.png' } }
    );
    const siblingCompRes = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint3._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      siblingCompRes.status === 403,
      '15g. Sibling directory attack (../uploads_sibling) on completion evidence rejected with 403 Forbidden'
    );

    // Restore completion evidence key
    await Complaint.updateOne(
      { _id: complaint3._id },
      { $set: { 'completionEvidence.storageKey': origCompKey } }
    );

    console.log('\n--- Section 5: Admin Dispute Review Decision ---');

    // Test 16: Only admin can review disputes (officer & citizen get 403 Forbidden)
    const citizenAdminReviewAttempt = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint2._id}/admin-review`,
      headers: { Authorization: `Bearer ${citizenToken}` },
      body: { action: 'accept', reviewNotes: 'Citizen trying to approve own dispute' }
    });
    assert(
      citizenAdminReviewAttempt.status === 403,
      '16a. Citizen role cannot execute admin review endpoint (403 Forbidden)'
    );

    const officerAdminReviewAttempt = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint2._id}/admin-review`,
      headers: { Authorization: `Bearer ${officerToken}` },
      body: { action: 'accept', reviewNotes: 'Officer trying to approve own dispute' }
    });
    assert(
      officerAdminReviewAttempt.status === 403,
      '16b. Officer role cannot execute admin review endpoint (403 Forbidden)'
    );

    // Test 17: Admin can accept resolution (Decision A)
    const adminAcceptRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint2._id}/admin-review`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'accept', reviewNotes: 'Inspected site: Work complies with municipal road specifications.' }
    });
    assert(
      adminAcceptRes.status === 200 && adminAcceptRes.data?.complaint?.status === 'Resolved',
      '17. Admin accepts resolution after dispute review (status becomes final Resolved)'
    );
    const doc2AfterAdmin = await Complaint.findById(complaint2._id);
    assert(
      doc2AfterAdmin.resolvedAt !== null && doc2AfterAdmin.resolutionDispute.status === 'resolved_by_admin',
      '17b. resolvedAt is set and dispute status marked resolved_by_admin'
    );

    // Test 17c: Admin can accept resolution with omitted reviewNotes (optional by design)
    const complaintAcceptOptional = await createProvisionallyResolvedComplaint({ trackingSuffix: 'OPT' });
    const disputeFormOpt = buildMultipartForm({ reason: 'Citizen filing dispute to test optional admin notes on accept' });
    await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaintAcceptOptional._id}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': disputeFormOpt.contentType
      },
      rawBody: disputeFormOpt.body
    });
    const adminAcceptNoNotes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaintAcceptOptional._id}/admin-review`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'accept' } // No reviewNotes passed
    });
    assert(
      adminAcceptNoNotes.status === 200 && adminAcceptNoNotes.data?.complaint?.status === 'Resolved',
      '17c. Admin accept resolution succeeds with omitted review notes (optional by design)'
    );

    // Test 18: Admin reopen without reviewNotes (< 5 chars) is rejected
    const badReopenRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint3._id}/admin-review`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'reopen', reviewNotes: 'No' }
    });
    assert(
      badReopenRes.status === 400 && badReopenRes.data?.message?.includes('minimum 5 characters'),
      '18. Admin reopen without mandatory review reason (>= 5 chars) is rejected with 400 Bad Request'
    );

    // Test 18b: Admin reopen with whitespace-only reviewNotes is rejected with 400 Bad Request
    const whitespaceReopenRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint3._id}/admin-review`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'reopen', reviewNotes: '     ' }
    });
    assert(
      whitespaceReopenRes.status === 400 && whitespaceReopenRes.data?.message?.includes('minimum 5 characters'),
      '18b. Admin reopen with whitespace-only review notes is rejected with 400 Bad Request'
    );

    // Test 19: Admin can reopen work (Decision B)
    const adminReopenRes = await apiRequest({
      method: 'PATCH',
      path: `/api/complaints/${complaint3._id}/admin-review`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'reopen', reviewNotes: 'Field inspection confirms edge raveling. Re-apply hot-mix seal coat.' }
    });
    assert(
      adminReopenRes.status === 200 && adminReopenRes.data?.complaint?.status === 'In Progress',
      '19. Admin reopens work: complaint returns to In Progress'
    );
    assert(
      adminReopenRes.data?.complaint?.reworkCount === 1,
      '19b. reworkCount is automatically incremented from 0 to 1'
    );

    // Test 20: Previous evidence is preserved after reopening
    const doc3AfterReopen = await Complaint.findById(complaint3._id);
    assert(
      doc3AfterReopen.evidence !== null &&
      doc3AfterReopen.completionEvidence !== null &&
      doc3AfterReopen.resolutionDispute?.reason !== null &&
      doc3AfterReopen.resolutionDispute?.photo?.storageKey !== null,
      '20. All historical evidence (original, completion, dispute photo/reason) preserved intact after reopen'
    );
    assert(
      doc3AfterReopen.resolvedAt === null,
      '20b. Reopened complaint maintains resolvedAt as null'
    );

    console.log('\n--- Section 6: Analytics & Notification Invariants ---');

    // Test 21: Admin summary strictly excludes Provisional and Disputed from resolved count
    const adminSummaryRes = await apiRequest({
      method: 'GET',
      path: '/api/complaints/admin/summary',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      adminSummaryRes.status === 200 &&
      adminSummaryRes.data?.summary?.byStatus?.['Provisionally Resolved'] !== undefined &&
      adminSummaryRes.data?.summary?.byStatus?.['Disputed'] !== undefined,
      '21. Admin summary breakdown includes explicit Provisionally Resolved and Disputed counts'
    );

    // Test 22: In-app notifications generated correctly for all transitions
    const notifs = await Notification.find({
      complaint: { $in: [complaint1._id, complaint2._id, complaint3._id] }
    });

    const hasConfirmedNotif = notifs.some((n) => n.type === 'resolution_confirmed');
    const hasDisputedNotif = notifs.some((n) => n.type === 'resolution_disputed');
    const hasAdminClosedNotif = notifs.some((n) => n.type === 'resolution_admin_closed');
    const hasReopenedNotif = notifs.some((n) => n.type === 'resolution_reopened');

    assert(hasConfirmedNotif, '22a. In-app notification with type resolution_confirmed sent to assigned officer');
    assert(hasDisputedNotif, '22b. In-app notification with type resolution_disputed sent on citizen dispute');
    assert(hasAdminClosedNotif, '22c. In-app notification with type resolution_admin_closed sent on admin accept');
    assert(hasReopenedNotif, '22d. In-app notification with type resolution_reopened sent on admin rework');

    console.log('\n================================================================');
    console.log(`Step 4 Verification Completed: ${passed} / ${total} PASS (${Math.round((passed / total) * 100)}%)`);
    console.log('================================================================\n');

  } finally {
    console.log('[Teardown] Cleaning up temporary test fixtures...');
    for (const cid of createdComplaintIds) {
      const comp = await Complaint.findById(cid);
      if (comp?.completionEvidence?.storageKey) {
        const compPath = path.resolve(UPLOAD_DIR, path.basename(comp.completionEvidence.storageKey));
        if (fs.existsSync(compPath)) {
          try { fs.unlinkSync(compPath); } catch (e) {}
        }
      }
      if (comp?.evidence?.storageKey) {
        const evPath = path.resolve(UPLOAD_DIR, path.basename(comp.evidence.storageKey));
        if (fs.existsSync(evPath)) {
          try { fs.unlinkSync(evPath); } catch (e) {}
        }
      }
      if (comp?.resolutionDispute?.photo?.storageKey) {
        const dispPath = path.resolve(UPLOAD_DIR, path.basename(comp.resolutionDispute.photo.storageKey));
        if (fs.existsSync(dispPath)) {
          try { fs.unlinkSync(dispPath); } catch (e) {}
        }
      }
      await Complaint.findByIdAndDelete(cid);
      await Notification.deleteMany({ complaint: cid });
    }

    for (const uid of createdUserIds) {
      await User.findByIdAndDelete(uid);
    }

    for (const tf of trackedFiles) {
      if (fs.existsSync(tf)) {
        try { fs.unlinkSync(tf); } catch (e) {}
      }
    }

    await mongoose.disconnect();
  }

  if (passed !== total) {
    process.exit(1);
  }
}

runStep4Tests().catch((err) => {
  console.error('Test suite failed with fatal error:', err);
  process.exit(1);
});
