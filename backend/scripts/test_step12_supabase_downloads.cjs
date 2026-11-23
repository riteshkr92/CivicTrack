/**
 * CivicTrack — Step 12: Authenticated Supabase Evidence Download Verification Suite
 *
 * Validates Phase 4A:
 * 1. Authentication & Authorization (401 Missing JWT, 403 Forbidden for unauthorized citizen / unassigned officer)
 * 2. Authenticated Binary Streaming & Parity (200 OK for Owner, Assigned Officer, Admin with bit-for-bit SHA-256 and size verification)
 * 3. All Four Routes Covered:
 *    - GET /api/complaints/:id/evidence
 *    - GET /api/complaints/:id/completion-evidence
 *    - GET /api/complaints/:id/dispute-evidence
 *    - GET /api/auth/profile/avatar
 * 4. Cache-Control & Content Headers (private caching, MIME typing, Content-Disposition)
 * 5. Missing Database Reference & Missing Storage Object Handlers (404 Not Found)
 * 6. Storage Outage & Network Failure Resilience (503 Service Unavailable + Retry-After: 30 header)
 * 7. Privacy & Leak Prevention (storageKey and sha256 stripped in toSafeObject() responses)
 * 8. Zero fallback to local disk during outages
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = require('../app');
const User = require('../models/User');
const { Complaint } = require('../models/Complaint');
const generateToken = require('../utils/generateToken');
const storageService = require('../services/storageService');
const manifest = require('../config/evidence_manifest.json');

let server;
let baseUrl;
let passed = 0;
let total = 0;

const cleanupUserIds = [];
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

function request({ method = 'GET', path: reqPath, headers = {}, body, isBinary = false }) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { ...headers }
    };

    let payload = null;
    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
      options.headers['Content-Length'] = Buffer.byteLength(payload);
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
        } catch {
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

async function runStep12Tests() {
  console.log('========================================================================');
  console.log('CivicTrack — Step 12: Supabase Authenticated Download Verification Suite');
  console.log('========================================================================\n');

  try {
    // 1. Database Connection & Server Startup
    console.log('--- Phase 0: Setup & Infrastructure Initialization ---');
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/civictrack';
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log(`Connected to MongoDB (${mongoose.connection.host}/${mongoose.connection.name})`);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    console.log(`Ephemeral test HTTP server listening on ${baseUrl}\n`);

    // Pick real uploaded files from manifest for test fixtures
    const origEvidenceItem = manifest.find((m) => m.fileCategory === 'original_evidence');
    const compEvidenceItem = manifest.find((m) => m.fileCategory === 'completion_evidence');
    assert(origEvidenceItem && compEvidenceItem, 'Manifest contains valid original and completion evidence samples');

    // 2. Provision Test Users
    console.log('\n--- Phase 1: User & Token Provisioning ---');
    const timestamp = Date.now();
    const citizenA = await User.create({
      name: `Citizen A ${timestamp}`,
      email: `citizen_a_${timestamp}@test.local`,
      password: 'Password123!',
      role: 'citizen',
      avatar: origEvidenceItem.filename
    });
    cleanupUserIds.push(citizenA._id);

    const citizenB = await User.create({
      name: `Citizen B ${timestamp}`,
      email: `citizen_b_${timestamp}@test.local`,
      password: 'Password123!',
      role: 'citizen'
    });
    cleanupUserIds.push(citizenB._id);

    const officerAssigned = await User.create({
      name: `Officer Assigned ${timestamp}`,
      email: `officer_assigned_${timestamp}@test.local`,
      password: 'Password123!',
      role: 'officer',
      department: 'Roads & Infrastructure'
    });
    cleanupUserIds.push(officerAssigned._id);

    const officerUnassigned = await User.create({
      name: `Officer Unassigned ${timestamp}`,
      email: `officer_unassigned_${timestamp}@test.local`,
      password: 'Password123!',
      role: 'officer',
      department: 'Sanitation'
    });
    cleanupUserIds.push(officerUnassigned._id);

    let adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      adminUser = await User.create({
        name: `Admin ${timestamp}`,
        email: `admin_${timestamp}@test.local`,
        password: 'Password123!',
        role: 'admin'
      });
      cleanupUserIds.push(adminUser._id);
    }

    const tokenCitizenA = generateToken(citizenA._id, 'citizen');
    const tokenCitizenB = generateToken(citizenB._id, 'citizen');
    const tokenOfficerAssigned = generateToken(officerAssigned._id, 'officer');
    const tokenOfficerUnassigned = generateToken(officerUnassigned._id, 'officer');
    const tokenAdmin = generateToken(adminUser._id, 'admin');

    assert(tokenCitizenA && tokenCitizenB && tokenOfficerAssigned && tokenOfficerUnassigned && tokenAdmin, 'Generated valid JWTs for all 5 test actors');

    // 3. Create Test Complaint with evidence, completionEvidence, and dispute photo
    console.log('\n--- Phase 2: Complaint Fixture Creation ---');
    const complaint = await Complaint.create({
      trackingId: `CT-TEST-${timestamp}-1`,
      title: 'Broken Pothole Test',
      description: 'Test pothole description for authenticated download suite',
      category: 'Pothole/Road Damage',
      priority: 'Medium',
      status: 'Disputed',
      citizen: citizenA._id,
      assignedOfficer: officerAssigned._id,
      assignedDepartment: 'Roads & Infrastructure',
      location: {
        address: '123 Test Street',
        coordinates: { latitude: 28.6139, longitude: 77.209 }
      },
      evidence: {
        storageKey: origEvidenceItem.filename,
        mimetype: 'image/jpeg',
        originalFilename: 'original_pothole.jpg',
        sha256: origEvidenceItem.sha256
      },
      completionEvidence: {
        storageKey: compEvidenceItem.filename,
        mimetype: 'image/png',
        originalFilename: 'repaired_pothole.png',
        sha256: compEvidenceItem.sha256,
        resolutionNotes: 'Completed repairs on site'
      },
      resolutionDispute: {
        reason: 'The pothole was not filled completely and still causes damage.',
        citizen: citizenA._id,
        photo: {
          storageKey: origEvidenceItem.filename,
          mimeType: 'image/jpeg',
          originalName: 'dispute_proof.jpg',
          sha256: origEvidenceItem.sha256
        }
      }
    });
    cleanupComplaintIds.push(complaint._id);
    assert(complaint && complaint._id, `Created test complaint ${complaint.trackingId} with full evidence subdocuments`);

    // 4. Authentication & Authorization Checks (401 & 403)
    console.log('\n--- Phase 3: Authentication & Authorization Gates (401 & 403) ---');

    // 4.1 Unauthenticated requests (401)
    const unauthEv = await request({ path: `/api/complaints/${complaint._id}/evidence` });
    assert(unauthEv.status === 401, '401 Unauthorized when requesting evidence without JWT');

    const unauthComp = await request({ path: `/api/complaints/${complaint._id}/completion-evidence` });
    assert(unauthComp.status === 401, '401 Unauthorized when requesting completion evidence without JWT');

    const unauthDisp = await request({ path: `/api/complaints/${complaint._id}/dispute-evidence` });
    assert(unauthDisp.status === 401, '401 Unauthorized when requesting dispute evidence without JWT');

    const unauthAvatar = await request({ path: '/api/auth/profile/avatar' });
    assert(unauthAvatar.status === 401, '401 Unauthorized when requesting profile avatar without JWT');

    // 4.2 Unauthorized citizen (Citizen B accessing Citizen A complaint) (403)
    const citBEv = await request({
      path: `/api/complaints/${complaint._id}/evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenB}` }
    });
    assert(citBEv.status === 403, '403 Forbidden for Citizen B attempting to view Citizen A evidence');

    const citBComp = await request({
      path: `/api/complaints/${complaint._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenB}` }
    });
    assert(citBComp.status === 403, '403 Forbidden for Citizen B attempting to view Citizen A completion evidence');

    const citBDisp = await request({
      path: `/api/complaints/${complaint._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenB}` }
    });
    assert(citBDisp.status === 403, '403 Forbidden for Citizen B attempting to view Citizen A dispute evidence');

    // 4.3 Unassigned officer (403)
    const offUnEv = await request({
      path: `/api/complaints/${complaint._id}/evidence`,
      headers: { Authorization: `Bearer ${tokenOfficerUnassigned}` }
    });
    assert(offUnEv.status === 403, '403 Forbidden for unassigned officer requesting evidence');

    const offUnComp = await request({
      path: `/api/complaints/${complaint._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${tokenOfficerUnassigned}` }
    });
    assert(offUnComp.status === 403, '403 Forbidden for unassigned officer requesting completion evidence');

    const offUnDisp = await request({
      path: `/api/complaints/${complaint._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${tokenOfficerUnassigned}` }
    });
    assert(offUnDisp.status === 403, '403 Forbidden for unassigned officer requesting dispute evidence');

    // 5. Authorized Binary Downloads & Parity (200 OK)
    console.log('\n--- Phase 4: Authorized Binary Downloads & Bit-for-Bit Parity (200 OK) ---');

    // 5.1 Citizen A (Owner) original evidence
    const ownerEvRes = await request({
      path: `/api/complaints/${complaint._id}/evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenA}` },
      isBinary: true
    });
    assert(ownerEvRes.status === 200, '200 OK: Citizen Owner downloads original evidence');
    assert(ownerEvRes.headers['content-type'] === 'image/jpeg', 'Content-Type header correctly set to image/jpeg');
    assert(ownerEvRes.headers['content-disposition'] === `inline; filename="${origEvidenceItem.filename}"`, 'Content-Disposition contains inline filename');
    assert(ownerEvRes.headers['cache-control'] === 'private, max-age=3600', 'Cache-Control header correctly set to private, max-age=3600');
    assert(ownerEvRes.buffer.length === origEvidenceItem.sizeBytes, `Downloaded buffer size (${ownerEvRes.buffer.length}) matches manifest (${origEvidenceItem.sizeBytes})`);
    const ownerEvHash = crypto.createHash('sha256').update(ownerEvRes.buffer).digest('hex');
    assert(ownerEvHash === origEvidenceItem.sha256, `Downloaded SHA-256 matches manifest exact hash (${origEvidenceItem.sha256})`);

    // 5.2 Assigned Officer original evidence
    const officerEvRes = await request({
      path: `/api/complaints/${complaint._id}/evidence`,
      headers: { Authorization: `Bearer ${tokenOfficerAssigned}` },
      isBinary: true
    });
    assert(officerEvRes.status === 200, '200 OK: Assigned Officer downloads original evidence');
    assert(crypto.createHash('sha256').update(officerEvRes.buffer).digest('hex') === origEvidenceItem.sha256, 'Assigned Officer received byte-for-byte identical evidence');

    // 5.3 Admin original evidence
    const adminEvRes = await request({
      path: `/api/complaints/${complaint._id}/evidence`,
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      isBinary: true
    });
    assert(adminEvRes.status === 200, '200 OK: Admin downloads original evidence');
    assert(crypto.createHash('sha256').update(adminEvRes.buffer).digest('hex') === origEvidenceItem.sha256, 'Admin received byte-for-byte identical evidence');

    // 5.4 Completion Evidence (Citizen Owner)
    const compEvRes = await request({
      path: `/api/complaints/${complaint._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenA}` },
      isBinary: true
    });
    assert(compEvRes.status === 200, '200 OK: Citizen Owner downloads completion evidence');
    assert(compEvRes.headers['content-type'] === 'image/png', 'Completion evidence Content-Type correctly set to image/png');
    assert(compEvRes.headers['cache-control'] === 'private, no-cache, no-store, must-revalidate', 'Completion evidence Cache-Control contains no-store directives');
    assert(compEvRes.headers['pragma'] === 'no-cache' && compEvRes.headers['expires'] === '0', 'Completion evidence Pragma and Expires headers present');
    assert(compEvRes.buffer.length === compEvidenceItem.sizeBytes, `Completion evidence byte size matches manifest (${compEvidenceItem.sizeBytes})`);
    assert(crypto.createHash('sha256').update(compEvRes.buffer).digest('hex') === compEvidenceItem.sha256, 'Completion evidence SHA-256 matches manifest');

    // 5.5 Dispute Evidence (Citizen Owner)
    const dispEvRes = await request({
      path: `/api/complaints/${complaint._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenA}` },
      isBinary: true
    });
    assert(dispEvRes.status === 200, '200 OK: Citizen Owner downloads dispute evidence');
    assert(dispEvRes.headers['content-type'] === 'image/jpeg', 'Dispute evidence Content-Type correctly set to image/jpeg');
    assert(dispEvRes.headers['cache-control'] === 'private, no-cache, no-store, must-revalidate', 'Dispute evidence Cache-Control contains no-store directives');
    assert(dispEvRes.buffer.length === origEvidenceItem.sizeBytes, 'Dispute evidence byte size matches manifest');
    assert(crypto.createHash('sha256').update(dispEvRes.buffer).digest('hex') === origEvidenceItem.sha256, 'Dispute evidence SHA-256 matches manifest');

    // 5.6 Profile Avatar (Citizen A)
    const avatarRes = await request({
      path: '/api/auth/profile/avatar',
      headers: { Authorization: `Bearer ${tokenCitizenA}` },
      isBinary: true
    });
    assert(avatarRes.status === 200, '200 OK: Citizen A downloads profile avatar');
    assert(avatarRes.headers['cache-control'] === 'private, max-age=86400', 'Avatar Cache-Control set to private, max-age=86400');
    assert(avatarRes.buffer.length === origEvidenceItem.sizeBytes, 'Avatar byte size matches manifest');
    assert(crypto.createHash('sha256').update(avatarRes.buffer).digest('hex') === origEvidenceItem.sha256, 'Avatar SHA-256 matches manifest');

    // 6. Missing Storage Objects & Missing References (404 Not Found)
    console.log('\n--- Phase 5: Missing Storage Objects & Missing References (404 Not Found) ---');

    // 6.1 Non-existent storageKey in complaint
    const missingFileComplaint = await Complaint.create({
      trackingId: `CT-TEST-${timestamp}-404`,
      title: 'Missing File Test',
      description: 'Complaint referencing nonexistent remote object',
      category: 'Garbage/Waste',
      priority: 'Low',
      status: 'Submitted',
      citizen: citizenA._id,
      location: { address: '404 Street', coordinates: { latitude: 28.5, longitude: 77.1 } },
      evidence: {
        storageKey: 'evidence-9999999999999-0000000000000000.jpg',
        mimetype: 'image/jpeg',
        originalFilename: 'ghost.jpg'
      }
    });
    cleanupComplaintIds.push(missingFileComplaint._id);

    const missingFileRes = await request({
      path: `/api/complaints/${missingFileComplaint._id}/evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenA}` }
    });
    assert(missingFileRes.status === 404, '404 Not Found when remote storage object does not exist');
    assert(missingFileRes.data?.message === 'Evidence photograph file is missing from server storage.', '404 returns expected clean missing file message');

    // 6.2 Complaint with no completion evidence
    const noCompRes = await request({
      path: `/api/complaints/${missingFileComplaint._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenA}` }
    });
    assert(noCompRes.status === 404, '404 Not Found when complaint has no completion evidence configured');

    // 6.3 Complaint with no dispute evidence
    const noDispRes = await request({
      path: `/api/complaints/${missingFileComplaint._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${tokenCitizenA}` }
    });
    assert(noDispRes.status === 404, '404 Not Found when complaint has no dispute evidence configured');

    // 6.4 User with no avatar configured
    const noAvatarRes = await request({
      path: '/api/auth/profile/avatar',
      headers: { Authorization: `Bearer ${tokenCitizenB}` }
    });
    assert(noAvatarRes.status === 404, '404 Not Found when user has no avatar configured');

    // 6.5 User with missing avatar storage object
    await User.findByIdAndUpdate(citizenB._id, { avatar: 'avatar-ghost-file-99999.png' });
    const missingAvatarRes = await request({
      path: '/api/auth/profile/avatar',
      headers: { Authorization: `Bearer ${tokenCitizenB}` }
    });
    assert(missingAvatarRes.status === 404, '404 Not Found when avatar storage object does not exist in Supabase');

    // 7. Supabase Storage Outage & Network Failure Resilience (503 Service Unavailable + Retry-After: 30)
    console.log('\n--- Phase 6: Supabase Outage & Network Failure Resilience (503 Service Unavailable) ---');

    const originalGetFileBuffer = storageService.getFileBuffer;
    // Simulate Supabase service outage / network timeout
    storageService.getFileBuffer = async () => {
      const outageErr = new Error('fetch failed: connection timeout connecting to Supabase storage cluster');
      outageErr.status = 500;
      throw outageErr;
    };

    try {
      const outageEvRes = await request({
        path: `/api/complaints/${complaint._id}/evidence`,
        headers: { Authorization: `Bearer ${tokenCitizenA}` }
      });
      assert(outageEvRes.status === 503, '503 Service Unavailable on evidence download when Supabase is unreachable');
      assert(outageEvRes.headers['retry-after'] === '30', 'Retry-After: 30 header present on evidence 503 response');
      assert(outageEvRes.data?.error === 'Service Unavailable', 'Error property is "Service Unavailable"');

      const outageCompRes = await request({
        path: `/api/complaints/${complaint._id}/completion-evidence`,
        headers: { Authorization: `Bearer ${tokenCitizenA}` }
      });
      assert(outageCompRes.status === 503, '503 Service Unavailable on completion evidence download during outage');
      assert(outageCompRes.headers['retry-after'] === '30', 'Retry-After: 30 header present on completion evidence 503 response');

      const outageDispRes = await request({
        path: `/api/complaints/${complaint._id}/dispute-evidence`,
        headers: { Authorization: `Bearer ${tokenCitizenA}` }
      });
      assert(outageDispRes.status === 503, '503 Service Unavailable on dispute evidence download during outage');
      assert(outageDispRes.headers['retry-after'] === '30', 'Retry-After: 30 header present on dispute evidence 503 response');

      const outageAvatarRes = await request({
        path: '/api/auth/profile/avatar',
        headers: { Authorization: `Bearer ${tokenCitizenA}` }
      });
      assert(outageAvatarRes.status === 503, '503 Service Unavailable on avatar download during outage');
      assert(outageAvatarRes.headers['retry-after'] === '30', 'Retry-After: 30 header present on avatar 503 response');
    } finally {
      // Restore real getFileBuffer
      storageService.getFileBuffer = originalGetFileBuffer;
    }

    // 8. Privacy & Data Leak Prevention (toSafeObject check)
    console.log('\n--- Phase 7: Privacy & Leak Prevention (toSafeObject Inspection) ---');
    const safeComplaintRes = await request({
      path: `/api/complaints/${complaint._id}`,
      headers: { Authorization: `Bearer ${tokenCitizenA}` }
    });
    assert(safeComplaintRes.status === 200, '200 OK: Complaint detail fetched');
    const compData = safeComplaintRes.data?.complaint || safeComplaintRes.data;

    assert(compData.evidence && compData.evidence.storageKey === undefined, 'Internal storageKey is stripped from evidence in API response');
    assert(compData.evidence && compData.evidence.sha256 === undefined, 'Internal sha256 is stripped from evidence in API response');

    assert(compData.completionEvidence && compData.completionEvidence.storageKey === undefined, 'Internal storageKey is stripped from completionEvidence in API response');
    assert(compData.completionEvidence && compData.completionEvidence.sha256 === undefined, 'Internal sha256 is stripped from completionEvidence in API response');

    assert(compData.resolutionDispute?.photo && compData.resolutionDispute.photo.storageKey === undefined, 'Internal storageKey is stripped from dispute photo in API response');
    assert(compData.resolutionDispute?.photo && compData.resolutionDispute.photo.sha256 === undefined, 'Internal sha256 is stripped from dispute photo in API response');

  } catch (err) {
    console.error('Test execution failed with error:', err);
    total++;
  } finally {
    // 9. Teardown
    console.log('\n--- Phase 8: Teardown & Fixture Cleanup ---');
    try {
      if (cleanupComplaintIds.length > 0) {
        await Complaint.deleteMany({ _id: { $in: cleanupComplaintIds } });
        console.log(`Cleaned up ${cleanupComplaintIds.length} test complaints.`);
      }
      if (cleanupUserIds.length > 0) {
        await User.deleteMany({ _id: { $in: cleanupUserIds } });
        console.log(`Cleaned up ${cleanupUserIds.length} test users.`);
      }
      if (server) {
        await new Promise((resolve) => server.close(resolve));
        console.log('Closed test HTTP server.');
      }
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
      }
    } catch (cleanupErr) {
      console.error('Error during teardown:', cleanupErr.message);
    }

    console.log('\n========================================================================');
    console.log(`Verification Complete: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
    console.log('========================================================================\n');

    if (passed < total) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runStep12Tests();
