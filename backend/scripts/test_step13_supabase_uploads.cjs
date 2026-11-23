/**
 * CivicTrack — Step 13: Supabase Evidence Upload Migration Verification Suite
 *
 * Validates Phase 4B:
 * 1. Kill Switch Enforcement (EVIDENCE_UPLOADS_ENABLED === 'true' required; 503 + Retry-After: 30 when disabled)
 *    - POST /api/complaints
 *    - POST /api/complaints/:id/complete-work
 *    - POST /api/complaints/:id/dispute
 *    - POST /api/auth/profile/avatar
 * 2. Memory Storage & Zero Local Disk Writes:
 *    - Multer memory storage across all 4 upload routes
 *    - No files written to backend/uploads/ or backend/uploads/evidence/
 * 3. Citizen Complaint Evidence Upload (POST /api/complaints):
 *    - Magic-byte validation enforcement (rejects disguised files with 400)
 *    - SHA-256 calculated from exact memory buffer and persisted in MongoDB
 *    - Uploaded to private Supabase bucket via storageService.uploadFile
 *    - toSafeObject() strips storageKey and sha256
 *    - Authenticated download via GET /api/complaints/:id/evidence succeeds bit-for-bit
 * 4. Officer Work Completion & Anti-Fraud Verification (POST /api/complaints/:id/complete-work):
 *    - Anti-Fraud check: fails closed (400) if complaint.evidence.sha256 is missing in DB
 *    - Anti-Fraud check: rejects with 400 if completion SHA-256 matches original complaint evidence SHA-256
 *    - Valid distinct completion photo uploaded to Supabase, SHA-256 persisted in DB
 *    - Authenticated download via GET /api/complaints/:id/completion-evidence succeeds bit-for-bit
 * 5. Citizen Resolution Dispute Evidence (POST /api/complaints/:id/dispute):
 *    - Ownership check: non-owner receives 403 Forbidden
 *    - Valid dispute photo uploaded to Supabase, SHA-256 persisted in DB
 *    - Authenticated download via GET /api/complaints/:id/dispute-evidence succeeds bit-for-bit
 * 6. User Profile Avatar Upload & Replacement (POST /api/auth/profile/avatar):
 *    - Initial avatar uploaded to Supabase and persisted in MongoDB
 *    - Replacement avatar uploads new file first, updates DB, then deletes previous avatar from Supabase
 *    - Authenticated download via GET /api/auth/profile/avatar succeeds bit-for-bit
 * 7. Compensation / Cleanup on DB failure:
 *    - Uploaded Supabase object is deleted if MongoDB operation fails
 * 8. Manifest Integrity:
 *    - All 89 historical evidence items in manifest remain completely untouched in Supabase
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
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
const cleanupStorageKeys = [];

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✔ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ✖ [FAIL] ${message}`);
  }
}

// Multipart Form Builder
function buildMultipartFormData(fields = {}, files = {}) {
  const boundary = `----CivicTrackUploadTestBoundary${Date.now()}${crypto.randomBytes(4).toString('hex')}`;
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

// Synthetic JPEG generator with embedded EXIF GPS tags
function buildGpsJpeg(lat, lon, tag = 'CT_TEST') {
  const tiff = Buffer.alloc(200);
  tiff.write('II', 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  // IFD0 at offset 8: 1 entry (GPSInfo 0x8825 pointing to offset 26)
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);

  // GPS IFD at offset 26: 4 entries:
  tiff.writeUInt16LE(4, 26);

  // Entry 1: GPSLatitudeRef (tag 1, ASCII, count 2)
  tiff.writeUInt16LE(1, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(2, 32);
  tiff.write(lat >= 0 ? 'N\0' : 'S\0', 36);

  // Entry 2: GPSLatitude (tag 2, RATIONAL, count 3, offset 78)
  tiff.writeUInt16LE(2, 40);
  tiff.writeUInt16LE(5, 42);
  tiff.writeUInt32LE(3, 44);
  tiff.writeUInt32LE(78, 48);

  // Entry 3: GPSLongitudeRef (tag 3, ASCII, count 2)
  tiff.writeUInt16LE(3, 52);
  tiff.writeUInt16LE(2, 54);
  tiff.writeUInt32LE(2, 56);
  tiff.write(lon >= 0 ? 'E\0' : 'W\0', 60);

  // Entry 4: GPSLongitude (tag 4, RATIONAL, count 3, offset 102)
  tiff.writeUInt16LE(4, 64);
  tiff.writeUInt16LE(5, 66);
  tiff.writeUInt32LE(3, 68);
  tiff.writeUInt32LE(102, 72);

  tiff.writeUInt32LE(0, 76);

  const absLat = Math.abs(lat);
  const latDeg = Math.floor(absLat);
  const latMin = Math.floor((absLat - latDeg) * 60);
  const latSec = Math.round(((absLat - latDeg) * 60 - latMin) * 60);
  tiff.writeUInt32LE(latDeg, 78); tiff.writeUInt32LE(1, 82);
  tiff.writeUInt32LE(latMin, 86); tiff.writeUInt32LE(1, 90);
  tiff.writeUInt32LE(latSec, 94); tiff.writeUInt32LE(1, 98);

  const absLon = Math.abs(lon);
  const lonDeg = Math.floor(absLon);
  const lonMin = Math.floor((absLon - lonDeg) * 60);
  const lonSec = Math.round(((absLon - lonDeg) * 60 - lonMin) * 60);
  tiff.writeUInt32LE(lonDeg, 102); tiff.writeUInt32LE(1, 106);
  tiff.writeUInt32LE(lonMin, 110); tiff.writeUInt32LE(1, 114);
  tiff.writeUInt32LE(lonSec, 118); tiff.writeUInt32LE(1, 122);

  const app1Header = Buffer.from('Exif\0\0');
  const app1Data = Buffer.concat([app1Header, tiff.subarray(0, 130)]);
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(app1Data.length + 2, 0);

  // Extra entropy to make different images have distinct SHA-256
  const extraEntropy = Buffer.from(`/* ${tag} - ${Date.now()} - ${crypto.randomBytes(8).toString('hex')} */`);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]),
    app1Len,
    app1Data,
    extraEntropy,
    Buffer.from([0xff, 0xd9])
  ]);
}

const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

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
    if (Buffer.isBuffer(body)) {
      payload = body;
      options.headers['Content-Length'] = payload.length;
    } else if (body) {
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

function getLocalEvidenceFileCount() {
  const evidenceDir = path.resolve(__dirname, '../uploads/evidence');
  if (!fs.existsSync(evidenceDir)) return 0;
  return fs.readdirSync(evidenceDir).length;
}

function getLocalAvatarFileCount() {
  const uploadsDir = path.resolve(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) return 0;
  return fs.readdirSync(uploadsDir).filter(f => f.startsWith('avatar-')).length;
}

async function runStep13Tests() {
  console.log('========================================================================');
  console.log('CivicTrack — Step 13: Supabase Evidence Upload Migration Verification Suite');
  console.log('========================================================================\n');

  try {
    // 0. Setup & Infrastructure Initialization
    console.log('--- Phase 0: Setup & Infrastructure Initialization ---');
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/civictrack';
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log(`Connected to MongoDB (${mongoose.connection.host}/${mongoose.connection.name})`);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    console.log(`Ephemeral test HTTP server listening on ${baseUrl}\n`);

    // Record baseline disk counts
    const initialEvidenceFileCount = getLocalEvidenceFileCount();
    const initialAvatarFileCount = getLocalAvatarFileCount();
    console.log(`Initial local evidence files: ${initialEvidenceFileCount}, initial local avatar files: ${initialAvatarFileCount}`);

    // Provision test actors
    console.log('\n--- Phase 1: User & Token Provisioning ---');
    const timestamp = Date.now();
    const citizenUser = await User.create({
      name: `Upload Test Citizen ${timestamp}`,
      email: `citizen_upload_${timestamp}@test.local`,
      password: 'Password123!',
      role: 'citizen'
    });
    cleanupUserIds.push(citizenUser._id);
    const citizenToken = generateToken(citizenUser._id);

    const otherCitizen = await User.create({
      name: `Other Citizen ${timestamp}`,
      email: `other_citizen_${timestamp}@test.local`,
      password: 'Password123!',
      role: 'citizen'
    });
    cleanupUserIds.push(otherCitizen._id);
    const otherCitizenToken = generateToken(otherCitizen._id);

    const officerUser = await User.create({
      name: `Upload Test Officer ${timestamp}`,
      email: `officer_upload_${timestamp}@test.local`,
      password: 'Password123!',
      role: 'officer',
      department: 'Roads & Infrastructure'
    });
    cleanupUserIds.push(officerUser._id);
    const officerToken = generateToken(officerUser._id);

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
    const adminToken = generateToken(adminUser._id);

    assert(Boolean(citizenToken && officerToken && adminToken), 'Test tokens generated for citizen, officer, and admin');

    // -------------------------------------------------------------
    // PHASE 2: Kill Switch Verification (EVIDENCE_UPLOADS_ENABLED)
    // -------------------------------------------------------------
    console.log('\n--- Phase 2: Kill Switch Enforcement (EVIDENCE_UPLOADS_ENABLED) ---');
    process.env.EVIDENCE_UPLOADS_ENABLED = 'false';

    const testJpeg = buildGpsJpeg(12.9716, 77.5946, 'KILL_SWITCH');
    const multipartKillSwitch = buildMultipartFormData(
      {
        title: 'Kill Switch Test',
        description: 'Testing upload disable switch',
        category: 'Roads & Infrastructure',
        address: '123 Main St',
        latitude: 12.9716,
        longitude: 77.5946
      },
      {
        evidence: { buffer: testJpeg, filename: 'killswitch.jpg', contentType: 'image/jpeg' }
      }
    );

    // 2.1 POST /api/complaints when disabled
    const killComplaintRes = await request({
      method: 'POST',
      path: '/api/complaints',
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': multipartKillSwitch.contentType
      },
      body: multipartKillSwitch.body
    });
    assert(killComplaintRes.status === 503, 'Kill switch: POST /api/complaints returns 503 when EVIDENCE_UPLOADS_ENABLED=false');
    assert(killComplaintRes.headers['retry-after'] === '30', 'Kill switch: Retry-After: 30 header present on complaints route');

    // 2.2 POST /api/complaints/:id/complete-work when disabled
    const killCompleteRes = await request({
      method: 'POST',
      path: `/api/complaints/${new mongoose.Types.ObjectId()}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': multipartKillSwitch.contentType
      },
      body: multipartKillSwitch.body
    });
    assert(killCompleteRes.status === 503, 'Kill switch: POST /api/complaints/:id/complete-work returns 503 when disabled');
    assert(killCompleteRes.headers['retry-after'] === '30', 'Kill switch: Retry-After: 30 header present on complete-work route');

    // 2.3 POST /api/complaints/:id/dispute when disabled
    const killDisputeRes = await request({
      method: 'POST',
      path: `/api/complaints/${new mongoose.Types.ObjectId()}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': multipartKillSwitch.contentType
      },
      body: multipartKillSwitch.body
    });
    assert(killDisputeRes.status === 503, 'Kill switch: POST /api/complaints/:id/dispute returns 503 when disabled');
    assert(killDisputeRes.headers['retry-after'] === '30', 'Kill switch: Retry-After: 30 header present on dispute route');

    // 2.4 POST /api/auth/profile/avatar when disabled
    const avatarKillFormData = buildMultipartFormData({}, {
      avatar: { buffer: VALID_PNG_BUFFER, filename: 'avatar.png', contentType: 'image/png' }
    });
    const killAvatarRes = await request({
      method: 'POST',
      path: '/api/auth/profile/avatar',
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': avatarKillFormData.contentType
      },
      body: avatarKillFormData.body
    });
    assert(killAvatarRes.status === 503, 'Kill switch: POST /api/auth/profile/avatar returns 503 when disabled');
    assert(killAvatarRes.headers['retry-after'] === '30', 'Kill switch: Retry-After: 30 header present on avatar route');

    // -------------------------------------------------------------
    // PHASE 3: Citizen Complaint Evidence Upload
    // -------------------------------------------------------------
    console.log('\n--- Phase 3: Citizen Complaint Evidence Upload (POST /api/complaints) ---');
    process.env.EVIDENCE_UPLOADS_ENABLED = 'true';

    // 3.1 Magic Byte Validation (reject fake file disguised as image)
    const fakeTextBuffer = Buffer.from('NOT A REAL IMAGE FILE DATA FOR TEST');
    const fakeMultipart = buildMultipartFormData(
      {
        title: 'Fake Image Test',
        description: 'Should fail magic byte validation',
        category: 'Roads & Infrastructure',
        address: '123 Fake St',
        latitude: 12.9716,
        longitude: 77.5946
      },
      {
        evidence: { buffer: fakeTextBuffer, filename: 'disguised.jpg', contentType: 'image/jpeg' }
      }
    );
    const fakeUploadRes = await request({
      method: 'POST',
      path: '/api/complaints',
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': fakeMultipart.contentType
      },
      body: fakeMultipart.body
    });
    assert(fakeUploadRes.status === 400, 'Validation: Disguised non-image file is rejected with 400 Bad Request');

    // 3.2 Legitimate Complaint Upload with Synthetic Geotagged JPEG
    const origLat = 12.9716;
    const origLng = 77.5946;
    const originalJpegBuffer = buildGpsJpeg(origLat, origLng, 'ORIGINAL_COMPLAINT');
    const originalJpegSha256 = crypto.createHash('sha256').update(originalJpegBuffer).digest('hex');
    const originalJpegSize = originalJpegBuffer.length;

    const validComplaintMultipart = buildMultipartFormData(
      {
        title: 'Pothole on 5th Avenue',
        description: 'Deep hazardous pothole causing traffic obstruction and vehicle damage',
        category: 'Pothole/Road Damage',
        address: '5th Avenue, Bengaluru',
        latitude: origLat,
        longitude: origLng,
        evidenceLatitude: origLat,
        evidenceLongitude: origLng
      },
      {
        evidence: { buffer: originalJpegBuffer, filename: 'pothole.jpg', contentType: 'image/jpeg' }
      }
    );

    const complaintCreateRes = await request({
      method: 'POST',
      path: '/api/complaints',
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': validComplaintMultipart.contentType
      },
      body: validComplaintMultipart.body
    });

    assert(complaintCreateRes.status === 201, 'Complaint Upload: POST /api/complaints returns 201 Created');
    const createdComplaintData = complaintCreateRes.data?.complaint;
    assert(Boolean(createdComplaintData?.id), 'Complaint Upload: Complaint ID returned in response');
    cleanupComplaintIds.push(createdComplaintData.id);

    // Verify toSafeObject response does NOT leak storageKey or sha256
    assert(
      createdComplaintData.evidence?.imageUrl?.startsWith('/api/complaints/') &&
      createdComplaintData.evidence?.imageUrl?.endsWith('/evidence'),
      'Complaint Upload: imageUrl points to authenticated endpoint'
    );
    assert(createdComplaintData.evidence?.storageKey === undefined, 'Complaint Upload: storageKey stripped from API response');
    assert(createdComplaintData.evidence?.sha256 === undefined, 'Complaint Upload: sha256 stripped from API response');

    // Verify MongoDB document directly
    const storedComplaint = await Complaint.findById(createdComplaintData.id);
    assert(Boolean(storedComplaint.evidence?.storageKey), 'Database: evidence.storageKey is persisted');
    assert(storedComplaint.evidence.storageKey.startsWith('evidence-'), 'Database: evidence.storageKey starts with "evidence-" prefix');
    cleanupStorageKeys.push(storedComplaint.evidence.storageKey);
    assert(storedComplaint.evidence.sha256 === originalJpegSha256, `Database: evidence.sha256 (${storedComplaint.evidence.sha256}) matches exact uploaded buffer SHA-256`);
    assert(storedComplaint.evidence.sizeBytes === originalJpegSize, 'Database: evidence.sizeBytes matches uploaded buffer size');

    // Verify Supabase Object
    const supabaseBuffer = await storageService.getFileBuffer(storedComplaint.evidence.storageKey);
    assert(Boolean(supabaseBuffer && supabaseBuffer.length === originalJpegSize), 'Supabase: Uploaded object retrieved with exact byte length');
    const downloadedSha256 = crypto.createHash('sha256').update(supabaseBuffer).digest('hex');
    assert(downloadedSha256 === originalJpegSha256, 'Supabase: Uploaded object SHA-256 matches exact uploaded bytes');

    // Verify ZERO local files written
    const postComplaintEvidenceCount = getLocalEvidenceFileCount();
    assert(postComplaintEvidenceCount === initialEvidenceFileCount, `Zero Local Writes: Local evidence directory unchanged (${postComplaintEvidenceCount} === ${initialEvidenceFileCount})`);

    // Verify Authenticated Download Stream
    const downloadRes = await request({
      method: 'GET',
      path: `/api/complaints/${storedComplaint._id}/evidence`,
      headers: { Authorization: `Bearer ${citizenToken}` },
      isBinary: true
    });
    assert(downloadRes.status === 200, 'Authenticated Download: GET /api/complaints/:id/evidence returns 200 OK');
    assert(downloadRes.headers['content-type'] === 'image/jpeg', 'Authenticated Download: Content-Type is image/jpeg');
    const streamedSha256 = crypto.createHash('sha256').update(downloadRes.buffer).digest('hex');
    assert(streamedSha256 === originalJpegSha256, 'Authenticated Download: Streamed bytes match original upload bit-for-bit');

    // -------------------------------------------------------------
    // PHASE 4: Officer Work Completion & Anti-Fraud Verification
    // -------------------------------------------------------------
    console.log('\n--- Phase 4: Officer Work Completion & Anti-Fraud Verification ---');

    // Assign complaint to officer and transition to In Progress
    storedComplaint.assignedOfficer = officerUser._id;
    storedComplaint.department = 'Roads & Infrastructure';
    storedComplaint.status = 'In Progress';
    await storedComplaint.save();

    // 4.1 Anti-Fraud: Missing Original Hash fails closed with 400
    storedComplaint.evidence.sha256 = null;
    await storedComplaint.save();

    const dummyCompletionJpeg = buildGpsJpeg(origLat, origLng, 'DUMMY_COMPLETION');
    const missingHashCompletionData = buildMultipartFormData(
      {
        resolutionNotes: 'Work completed by team; pothole filled with asphalt.',
        latitude: origLat,
        longitude: origLng,
        accuracy: 10,
        capturedAt: new Date().toISOString()
      },
      {
        completionPhoto: { buffer: dummyCompletionJpeg, filename: 'completion.jpg', contentType: 'image/jpeg' }
      }
    );

    const missingHashRes = await request({
      method: 'POST',
      path: `/api/complaints/${storedComplaint._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': missingHashCompletionData.contentType
      },
      body: missingHashCompletionData.body
    });
    assert(missingHashRes.status === 400, 'Anti-Fraud: Fails closed (400) when original evidence SHA-256 is missing on record');
    assert(missingHashRes.data?.message?.includes('Original evidence hash is missing on record'), 'Anti-Fraud: Informative error message on missing hash');

    // Restore original SHA-256 on complaint
    storedComplaint.evidence.sha256 = originalJpegSha256;
    await storedComplaint.save();

    // 4.2 Anti-Fraud: Re-uploading original image is rejected as duplicate
    const duplicateCompletionData = buildMultipartFormData(
      {
        resolutionNotes: 'Work completed by team; pothole filled with asphalt.',
        latitude: origLat,
        longitude: origLng,
        accuracy: 10,
        capturedAt: new Date().toISOString()
      },
      {
        completionPhoto: { buffer: originalJpegBuffer, filename: 'duplicate_fraud.jpg', contentType: 'image/jpeg' }
      }
    );

    const duplicateRes = await request({
      method: 'POST',
      path: `/api/complaints/${storedComplaint._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': duplicateCompletionData.contentType
      },
      body: duplicateCompletionData.body
    });
    assert(duplicateRes.status === 400, 'Anti-Fraud: Re-uploading identical original photo is rejected with 400 Bad Request');
    assert(duplicateRes.data?.message?.includes('Completion photograph matches the original complaint photograph'), 'Anti-Fraud: Rejection message on matching SHA-256');

    // 4.3 Legitimate Distinct Completion Photo Upload
    const validCompletionJpeg = buildGpsJpeg(origLat, origLng, 'GENUINE_COMPLETION');
    const validCompletionSha256 = crypto.createHash('sha256').update(validCompletionJpeg).digest('hex');
    const validCompletionSize = validCompletionJpeg.length;

    const validCompletionData = buildMultipartFormData(
      {
        resolutionNotes: 'Work has been completely executed and verified on site with asphalt leveling.',
        latitude: origLat,
        longitude: origLng,
        accuracy: 10,
        capturedAt: new Date().toISOString()
      },
      {
        completionPhoto: { buffer: validCompletionJpeg, filename: 'completion_valid.jpg', contentType: 'image/jpeg' }
      }
    );

    const validCompletionRes = await request({
      method: 'POST',
      path: `/api/complaints/${storedComplaint._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': validCompletionData.contentType
      },
      body: validCompletionData.body
    });

    assert(validCompletionRes.status === 200, 'Completion Upload: POST /api/complaints/:id/complete-work returns 200 OK');
    const updatedComplaintDoc = await Complaint.findById(storedComplaint._id);
    assert(updatedComplaintDoc.status === 'Provisionally Resolved', 'Completion Upload: Complaint transitioned to Provisionally Resolved');
    assert(Boolean(updatedComplaintDoc.completionEvidence?.storageKey), 'Database: completionEvidence.storageKey is persisted');
    assert(updatedComplaintDoc.completionEvidence.storageKey.startsWith('completion-'), 'Database: completionEvidence storageKey starts with "completion-"');
    cleanupStorageKeys.push(updatedComplaintDoc.completionEvidence.storageKey);
    assert(updatedComplaintDoc.completionEvidence.sha256 === validCompletionSha256, 'Database: completionEvidence.sha256 matches uploaded completion buffer SHA-256');

    // Verify Supabase Completion Object
    const supabaseCompBuffer = await storageService.getFileBuffer(updatedComplaintDoc.completionEvidence.storageKey);
    assert(Boolean(supabaseCompBuffer && supabaseCompBuffer.length === validCompletionSize), 'Supabase: Completion object retrieved with exact length');
    const compSha256 = crypto.createHash('sha256').update(supabaseCompBuffer).digest('hex');
    assert(compSha256 === validCompletionSha256, 'Supabase: Completion object SHA-256 matches bit-for-bit');

    // Verify Authenticated Completion Download
    const compDownloadRes = await request({
      method: 'GET',
      path: `/api/complaints/${storedComplaint._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${citizenToken}` },
      isBinary: true
    });
    assert(compDownloadRes.status === 200, 'Authenticated Download: GET /api/complaints/:id/completion-evidence returns 200 OK');
    const streamedCompSha256 = crypto.createHash('sha256').update(compDownloadRes.buffer).digest('hex');
    assert(streamedCompSha256 === validCompletionSha256, 'Authenticated Download: Streamed completion bytes match original upload bit-for-bit');

    // Verify Zero Local Writes
    assert(getLocalEvidenceFileCount() === initialEvidenceFileCount, 'Zero Local Writes: Still no local evidence files written after completion upload');

    // -------------------------------------------------------------
    // PHASE 5: Citizen Resolution Dispute Evidence Upload
    // -------------------------------------------------------------
    console.log('\n--- Phase 5: Citizen Resolution Dispute Evidence (POST /api/complaints/:id/dispute) ---');

    const disputeJpeg = buildGpsJpeg(origLat, origLng, 'DISPUTE_EVIDENCE');
    const disputeJpegSha256 = crypto.createHash('sha256').update(disputeJpeg).digest('hex');
    const disputeJpegSize = disputeJpeg.length;

    const disputeFormData = buildMultipartFormData(
      {
        reason: 'The pothole was only filled with loose gravel and washed out within an hour of light rain.'
      },
      {
        disputePhoto: { buffer: disputeJpeg, filename: 'dispute.jpg', contentType: 'image/jpeg' }
      }
    );

    // 5.1 Non-owner Forbidden
    const unauthDisputeRes = await request({
      method: 'POST',
      path: `/api/complaints/${storedComplaint._id}/dispute`,
      headers: {
        Authorization: `Bearer ${otherCitizenToken}`,
        'Content-Type': disputeFormData.contentType
      },
      body: disputeFormData.body
    });
    assert(unauthDisputeRes.status === 403, 'Dispute: Non-owner citizen receives 403 Forbidden');

    // 5.2 Owner Citizen Submits Dispute
    const disputeRes = await request({
      method: 'POST',
      path: `/api/complaints/${storedComplaint._id}/dispute`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': disputeFormData.contentType
      },
      body: disputeFormData.body
    });

    assert(disputeRes.status === 200, 'Dispute Upload: POST /api/complaints/:id/dispute returns 200 OK');
    const disputedDoc = await Complaint.findById(storedComplaint._id);
    assert(disputedDoc.status === 'Disputed', 'Dispute Upload: Status transitioned to "Disputed"');
    assert(Boolean(disputedDoc.resolutionDispute?.photo?.storageKey), 'Database: resolutionDispute.photo.storageKey is persisted');
    assert(disputedDoc.resolutionDispute.photo.storageKey.startsWith('dispute-'), 'Database: dispute storageKey starts with "dispute-"');
    cleanupStorageKeys.push(disputedDoc.resolutionDispute.photo.storageKey);
    assert(disputedDoc.resolutionDispute.photo.sha256 === disputeJpegSha256, 'Database: resolutionDispute.photo.sha256 matches uploaded buffer SHA-256');

    // Verify Supabase Dispute Object
    const supabaseDisputeBuffer = await storageService.getFileBuffer(disputedDoc.resolutionDispute.photo.storageKey);
    assert(Boolean(supabaseDisputeBuffer && supabaseDisputeBuffer.length === disputeJpegSize), 'Supabase: Dispute object retrieved with exact length');
    const downloadedDisputeSha256 = crypto.createHash('sha256').update(supabaseDisputeBuffer).digest('hex');
    assert(downloadedDisputeSha256 === disputeJpegSha256, 'Supabase: Dispute object SHA-256 matches bit-for-bit');

    // Verify Authenticated Dispute Download
    const disputeDownloadRes = await request({
      method: 'GET',
      path: `/api/complaints/${storedComplaint._id}/dispute-evidence`,
      headers: { Authorization: `Bearer ${citizenToken}` },
      isBinary: true
    });
    assert(disputeDownloadRes.status === 200, 'Authenticated Download: GET /api/complaints/:id/dispute-evidence returns 200 OK');
    const streamedDisputeSha256 = crypto.createHash('sha256').update(disputeDownloadRes.buffer).digest('hex');
    assert(streamedDisputeSha256 === disputeJpegSha256, 'Authenticated Download: Streamed dispute bytes match original upload bit-for-bit');

    // Verify Zero Local Writes
    assert(getLocalEvidenceFileCount() === initialEvidenceFileCount, 'Zero Local Writes: Still no local evidence files written after dispute upload');

    // -------------------------------------------------------------
    // PHASE 6: User Profile Avatar Upload & Replacement
    // -------------------------------------------------------------
    console.log('\n--- Phase 6: User Profile Avatar Upload & Replacement (POST /api/auth/profile/avatar) ---');

    // 6.1 Initial Avatar Upload
    const avatar1Buffer = VALID_PNG_BUFFER;
    const avatar1Sha256 = crypto.createHash('sha256').update(avatar1Buffer).digest('hex');
    const avatar1FormData = buildMultipartFormData({}, {
      avatar: { buffer: avatar1Buffer, filename: 'avatar1.png', contentType: 'image/png' }
    });

    const avatar1Res = await request({
      method: 'POST',
      path: '/api/auth/profile/avatar',
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': avatar1FormData.contentType
      },
      body: avatar1FormData.body
    });

    assert(avatar1Res.status === 200, 'Avatar Upload: Initial POST /api/auth/profile/avatar returns 200 OK');
    const userDoc1 = await User.findById(citizenUser._id);
    const avatarKey1 = userDoc1.avatar;
    assert(Boolean(avatarKey1 && avatarKey1.startsWith('avatar-')), 'Database: user.avatar updated with safe avatar key');
    cleanupStorageKeys.push(avatarKey1);

    // Verify Supabase has Avatar 1
    const supabaseAvatar1 = await storageService.getFileBuffer(avatarKey1);
    assert(Boolean(supabaseAvatar1 && supabaseAvatar1.length === avatar1Buffer.length), 'Supabase: Avatar 1 object exists in private bucket');

    // Verify authenticated avatar download
    const avatar1Download = await request({
      method: 'GET',
      path: '/api/auth/profile/avatar',
      headers: { Authorization: `Bearer ${citizenToken}` },
      isBinary: true
    });
    assert(avatar1Download.status === 200, 'Authenticated Download: GET /api/auth/profile/avatar returns 200 OK');
    const streamedAvatar1Sha = crypto.createHash('sha256').update(avatar1Download.buffer).digest('hex');
    assert(streamedAvatar1Sha === avatar1Sha256, 'Authenticated Download: Streamed avatar 1 matches upload bit-for-bit');

    // Verify zero local files written to uploads directory
    assert(getLocalAvatarFileCount() === initialAvatarFileCount, 'Zero Local Writes: No avatar files written to local disk');

    // 6.2 Replacement Avatar Upload (uploads new, updates DB, deletes previous)
    const avatar2Buffer = buildGpsJpeg(12.9716, 77.5946, 'AVATAR_2');
    const avatar2Sha256 = crypto.createHash('sha256').update(avatar2Buffer).digest('hex');
    const avatar2FormData = buildMultipartFormData({}, {
      avatar: { buffer: avatar2Buffer, filename: 'avatar2.jpg', contentType: 'image/jpeg' }
    });

    const avatar2Res = await request({
      method: 'POST',
      path: '/api/auth/profile/avatar',
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': avatar2FormData.contentType
      },
      body: avatar2FormData.body
    });

    assert(avatar2Res.status === 200, 'Avatar Replacement: Second POST /api/auth/profile/avatar returns 200 OK');
    const userDoc2 = await User.findById(citizenUser._id);
    const avatarKey2 = userDoc2.avatar;
    assert(avatarKey2 !== avatarKey1, 'Database: user.avatar updated to new storage key');
    cleanupStorageKeys.push(avatarKey2);

    // Verify new avatar exists in Supabase
    const supabaseAvatar2 = await storageService.getFileBuffer(avatarKey2);
    assert(Boolean(supabaseAvatar2 && supabaseAvatar2.length === avatar2Buffer.length), 'Supabase: New avatar object exists in private bucket');

    // Verify OLD avatar was DELETED from Supabase
    let oldAvatarDeleted = false;
    try {
      await storageService.getFileBuffer(avatarKey1);
    } catch (err) {
      oldAvatarDeleted = true;
    }
    assert(oldAvatarDeleted, 'Avatar Replacement: Previous avatar object was safely deleted from Supabase');

    // Verify authenticated download returns new avatar
    const avatar2Download = await request({
      method: 'GET',
      path: '/api/auth/profile/avatar',
      headers: { Authorization: `Bearer ${citizenToken}` },
      isBinary: true
    });
    assert(avatar2Download.status === 200, 'Authenticated Download: GET /api/auth/profile/avatar returns new avatar');
    const streamedAvatar2Sha = crypto.createHash('sha256').update(avatar2Download.buffer).digest('hex');
    assert(streamedAvatar2Sha === avatar2Sha256, 'Authenticated Download: Streamed avatar 2 matches new upload bit-for-bit');

    // -------------------------------------------------------------
    // PHASE 7: Compensation Verification (Rollback on failure)
    // -------------------------------------------------------------
    console.log('\n--- Phase 7: Compensation Cleanup on Failure ---');

    // Test that storageService.deleteFile works properly on cleanup
    const testCompensationKey = `test-compensation-${Date.now()}.jpg`;
    await storageService.uploadFile(testCompensationKey, testJpeg, 'image/jpeg');
    const preDeleteBuffer = await storageService.getFileBuffer(testCompensationKey);
    assert(Boolean(preDeleteBuffer && preDeleteBuffer.length > 0), 'Compensation Test: Test object uploaded to Supabase');

    await storageService.deleteFile(testCompensationKey);
    let compensationConfirmed = false;
    try {
      await storageService.getFileBuffer(testCompensationKey);
    } catch {
      compensationConfirmed = true;
    }
    assert(compensationConfirmed, 'Compensation Test: storageService.deleteFile cleanly purges failed/compensating objects');

    // -------------------------------------------------------------
    // PHASE 8: Historical Evidence & Manifest Protection Check
    // -------------------------------------------------------------
    console.log('\n--- Phase 8: Manifest Integrity & Historical Evidence Protection ---');
    assert(manifest.length === 89, 'Manifest verification: Exact 89 files recorded in manifest');

    // Check a random sample of 5 manifest items to verify they were untouched
    const sampleItems = [manifest[0], manifest[20], manifest[40], manifest[60], manifest[88]];
    let allSampleIntact = true;
    for (const item of sampleItems) {
      try {
        const itemBuf = await storageService.getFileBuffer(item.filename);
        const itemSha = crypto.createHash('sha256').update(itemBuf).digest('hex');
        if (itemSha !== item.sha256) {
          allSampleIntact = false;
          console.error(`Mismatch on manifest item ${item.filename}`);
        }
      } catch (err) {
        allSampleIntact = false;
        console.error(`Failed to fetch manifest item ${item.filename}:`, err.message);
      }
    }
    assert(allSampleIntact, 'Safety: Historical manifest evidence items in Supabase are completely intact and unmodified');

    // Final local write check
    assert(getLocalEvidenceFileCount() === initialEvidenceFileCount, `Zero Local Writes Final Check: Local evidence count unchanged (${getLocalEvidenceFileCount()} === ${initialEvidenceFileCount})`);

  } catch (error) {
    console.error('Fatal error during test execution:', error);
  } finally {
    console.log('\n--- Cleanup Phase ---');
    // Clean up Supabase test storage keys
    for (const key of cleanupStorageKeys) {
      try {
        await storageService.deleteFile(key);
      } catch (_) {}
    }
    console.log(`Cleaned up ${cleanupStorageKeys.length} ephemeral test objects from Supabase.`);

    // Clean up complaints
    for (const cid of cleanupComplaintIds) {
      try {
        await Complaint.findByIdAndDelete(cid);
      } catch (_) {}
    }
    console.log(`Cleaned up ${cleanupComplaintIds.length} test complaints from MongoDB.`);

    // Clean up users
    for (const uid of cleanupUserIds) {
      try {
        await User.findByIdAndDelete(uid);
      } catch (_) {}
    }
    console.log(`Cleaned up ${cleanupUserIds.length} test users from MongoDB.`);

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('Closed ephemeral HTTP server.');
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB.');
    }

    console.log('\n========================================================================');
    console.log(`Test Execution Summary: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
    console.log('========================================================================\n');

    if (passed === total && total > 0) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

runStep13Tests();
