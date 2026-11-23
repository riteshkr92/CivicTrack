/**
 * CivicTrack 2.0 — Step 3 Automated Verification Suite
 * Geo-Verified Work Completion & Evidence Retrieval
 *
 * Validates:
 * 1. Assigned officer can submit valid completion evidence.
 * 2. Unassigned officer receives 403.
 * 3. Citizen cannot submit completion evidence.
 * 4. Admin cannot submit completion evidence through the officer endpoint.
 * 5. Complaint outside 'In Progress' cannot accept completion evidence.
 * 6. Missing photograph is rejected.
 * 7. Invalid MIME or magic bytes are rejected.
 * 8. File larger than 10 MB is rejected.
 * 9. Invalid coordinates are rejected.
 * 10. GPS accuracy above 100 metres is rejected.
 * 11. Completion distance within tolerance is accepted.
 * 12. Completion distance beyond tolerance is rejected.
 * 13. Missing original complaint GPS is handled safely.
 * 14. Invalid, future, or older-than-24-hour timestamps are rejected.
 * 15. Missing EXIF GPS is handled according to the documented fallback.
 * 16. Duplicate submissions and concurrent requests cannot create duplicate completion transitions.
 * 17. Original citizen evidence remains unchanged.
 * 18. Unauthorized users cannot retrieve completion photographs.
 * 19. Authorized citizen, assigned officer, and admin can retrieve evidence.
 * 20. Failed submissions do not leave orphaned files.
 * 21. Provisional complaints do not receive a final resolvedAt timestamp.
 * 22. Internal storage keys and filesystem paths are not exposed in public API responses.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const { Complaint } = require('../models/Complaint');
const { Notification } = require('../models/Notification');
const { calculateDistanceMeters, validateImageMagicBytes } = require('../utils/exifParser');

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

const VALID_JPEG_BUFFER = Buffer.from(
  'ffd8ffe000104a46494600010101004800480000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffda0008010100003f00bf00ffd9',
  'hex'
);

const FAKE_TEXT_BUFFER = Buffer.from('This is completely fake image data without genuine magic bytes.');

// Synthetic JPEG generator with embedded EXIF GPS tags
function buildGpsJpeg(lat, lon) {
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

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]),
    app1Len,
    app1Data,
    Buffer.from([0xff, 0xd9])
  ]);
}

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
  const boundary = '----WebKitFormBoundaryStep3Test' + Math.random().toString(36).substring(2);
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

async function runStep3Tests() {
  console.log('================================================================');
  console.log('CivicTrack 2.0 — Step 3 Work Completion & Geo-Verification Suite');
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
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);

    // 1. Authenticate Actors
    console.log('[Setup] Authenticating test actors...');
    const adminLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'admin@civictrack.gov', password: 'Admin@123' }
    });
    assert(adminLogin.status === 200, 'Auth: Admin logs in successfully');
    const adminToken = adminLogin.data.token;
    const adminUser = adminLogin.data.user;

    const citizenLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'citizen@civictrack.gov', password: 'Citizen@123' }
    });
    assert(citizenLogin.status === 200, 'Auth: Citizen logs in successfully');
    const citizenToken = citizenLogin.data.token;
    const citizenUser = citizenLogin.data.user;

    const officerLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'officer@civictrack.gov', password: 'Officer@123' }
    });
    assert(officerLogin.status === 200, 'Auth: Officer logs in successfully');
    const officerToken = officerLogin.data.token;
    const officerUser = officerLogin.data.user;

    // Create a second officer for unassigned officer tests
    const otherOfficerEmail = `unassigned.officer.${Date.now()}@civictrack.gov`;
    const otherOfficerRes = await apiRequest({
      method: 'POST',
      path: '/api/auth/officers',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Unassigned Officer',
        email: otherOfficerEmail,
        password: 'Password123!',
        department: 'Roads & Infrastructure'
      }
    });
    assert(otherOfficerRes.status === 201, 'Auth: Admin provisions secondary test officer');
    const otherOfficerId = otherOfficerRes.data.officer.id;
    createdUserIds.push(otherOfficerId);

    const otherOfficerLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: otherOfficerEmail, password: 'Password123!' }
    });
    assert(otherOfficerLogin.status === 200, 'Auth: Secondary officer logs in');
    const otherOfficerToken = otherOfficerLogin.data.token;

    // Create a third citizen for unauthorized retrieval tests
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
    const otherCitizenToken = otherCitizenLogin.data.token;

    // Helper to create an In Progress complaint directly in DB
    async function createTestComplaint({ status = 'In Progress', assignedOfficer = officerUser.id, withCoords = true, trackingSuffix = '1' } = {}) {
      const trackingId = await Complaint.generateTrackingId();
      const origFilename = `orig-evidence-${Date.now()}-${trackingSuffix}.png`;
      const origPath = path.resolve(UPLOAD_DIR, origFilename);
      fs.writeFileSync(origPath, VALID_PNG_BUFFER);
      trackedFiles.push(origPath);

      const complaint = new Complaint({
        trackingId,
        title: `Test Issue ${trackingSuffix} for Step 3`,
        description: 'Test issue description documenting potholes on municipal avenue.',
        category: 'Pothole/Road Damage',
        location: {
          address: '42 MG Road, Ward 5',
          latitude: withCoords ? 18.5204 : null,
          longitude: withCoords ? 73.8567 : null
        },
        priority: 'High',
        status: status,
        citizen: citizenUser.id,
        assignedOfficer: assignedOfficer,
        department: 'Roads & Infrastructure',
        evidence: {
          imageUrl: `/api/complaints/${trackingId}/evidence`,
          storageKey: origFilename,
          originalName: 'issue.png',
          mimetype: 'image/png',
          size: VALID_PNG_BUFFER.length,
          coordinates: {
            latitude: withCoords ? 18.5204 : null,
            longitude: withCoords ? 73.8567 : null,
            accuracy: 10
          },
          locationSource: 'device_gps',
          verificationStatus: 'location_captured'
        },
        statusHistory: [
          { status: 'Submitted', timestamp: new Date(Date.now() - 3600000), comment: 'Initial filing', actorRole: 'citizen' },
          { status: status, timestamp: new Date(), comment: 'Status setup for test', actorRole: 'officer' }
        ]
      });
      await complaint.save();
      createdComplaintIds.push(complaint._id);
      return complaint;
    }

    console.log('\n--- Section 1: Authorization & Role Guards ---');

    // Test 1: Assigned officer can submit valid completion evidence
    const complaint1 = await createTestComplaint({ trackingSuffix: 'T1' });
    const validMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Successfully repaired the asphalt and completed road leveling.',
        latitude: '18.52045',
        longitude: '73.85675',
        accuracy: '12',
        capturedAt: new Date(Date.now() - 120000).toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'work_done.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );

    const submitRes1 = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint1._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': validMultipart.contentType
      },
      rawBody: validMultipart.body
    });

    assert(
      submitRes1.status === 200 && submitRes1.data?.complaint?.status === 'Provisionally Resolved',
      '1. Assigned officer successfully submits valid completion evidence (Status: Provisionally Resolved)'
    );
    assert(
      submitRes1.data?.complaint?.hasCompletionEvidence === true && submitRes1.data?.complaint?.completionEvidence?.distanceMeters !== undefined,
      '1b. Response contains hasCompletionEvidence: true and calculated distanceMeters'
    );

    // Test 1c: Duplicate image content (matching original complaint image) is rejected
    const duplicatePhotoMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Attempting to submit identical photo from original complaint.',
        latitude: '18.52045',
        longitude: '73.85675',
        accuracy: '12',
        capturedAt: new Date(Date.now() - 120000).toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'same_as_original.png', contentType: 'image/png', buffer: VALID_PNG_BUFFER }]
    );
    const complaintDup = await createTestComplaint({ trackingSuffix: 'T1dup' });
    const dupRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaintDup._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': duplicatePhotoMultipart.contentType
      },
      rawBody: duplicatePhotoMultipart.body
    });
    assert(
      dupRes.status === 400 && dupRes.data?.message?.includes('matches the original complaint photograph'),
      '1c. Completion photograph matching original complaint image is rejected with 400 Bad Request'
    );

    // Test 2: Unassigned officer receives 403
    const complaint2 = await createTestComplaint({ trackingSuffix: 'T2' });
    const unassignedRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${otherOfficerToken}`,
        'Content-Type': validMultipart.contentType
      },
      rawBody: validMultipart.body
    });
    assert(
      unassignedRes.status === 403 && unassignedRes.data?.message?.includes('not assigned'),
      '2. Unassigned officer receives 403 Forbidden with clear assignment message'
    );

    // Test 3: Citizen cannot submit completion evidence (403)
    const citizenAttempt = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${citizenToken}`,
        'Content-Type': validMultipart.contentType
      },
      rawBody: validMultipart.body
    });
    assert(
      citizenAttempt.status === 403,
      '3. Citizen role cannot submit completion evidence (403 Forbidden)'
    );

    // Test 4: Admin cannot submit completion evidence through the officer endpoint
    const adminAttempt = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': validMultipart.contentType
      },
      rawBody: validMultipart.body
    });
    assert(
      adminAttempt.status === 403,
      '4. Admin role cannot submit completion evidence through officer endpoint (403 Forbidden)'
    );

    console.log('\n--- Section 2: Lifecycle Status & Input Validation ---');

    // Test 5: Complaint outside 'In Progress' cannot accept completion evidence
    const submittedComplaint = await createTestComplaint({ status: 'Submitted', trackingSuffix: 'T5' });
    const badStatusRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${submittedComplaint._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': validMultipart.contentType
      },
      rawBody: validMultipart.body
    });
    assert(
      badStatusRes.status === 400 && badStatusRes.data?.message?.includes('In Progress'),
      '5. Complaint outside In Progress (Submitted) is rejected with 400 Bad Request'
    );

    // Test 6: Missing photograph is rejected
    const noPhotoMultipart = buildMultipartForm({
      resolutionNotes: 'Completed repairs but forgot photograph.',
      latitude: '18.5204',
      longitude: '73.8567',
      accuracy: '10',
      capturedAt: new Date().toISOString()
    });
    const noPhotoRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': noPhotoMultipart.contentType
      },
      rawBody: noPhotoMultipart.body
    });
    assert(
      noPhotoRes.status === 400 && noPhotoRes.data?.message?.includes('photograph is required'),
      '6. Missing completion photograph is rejected with 400 Bad Request'
    );

    // Test 7: Invalid MIME or magic bytes are rejected
    const fakeMagicMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Completed repairs with spoofed photograph.',
        latitude: '18.5204',
        longitude: '73.8567',
        accuracy: '10',
        capturedAt: new Date().toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'fake.png', contentType: 'image/png', buffer: FAKE_TEXT_BUFFER }]
    );
    const fakeMagicRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': fakeMagicMultipart.contentType
      },
      rawBody: fakeMagicMultipart.body
    });
    assert(
      fakeMagicRes.status === 400 && fakeMagicRes.data?.message?.includes('valid image format'),
      '7. File with fake/text magic bytes is rejected with 400 Bad Request'
    );

    // Test 8: File larger than 10 MB is rejected
    // We test limit via a simulated 11MB buffer chunk header check
    const largeBuffer = Buffer.alloc(10.5 * 1024 * 1024, 0);
    const largeMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Completed repairs with giant file.',
        latitude: '18.5204',
        longitude: '73.8567',
        accuracy: '10',
        capturedAt: new Date().toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'huge.jpg', contentType: 'image/jpeg', buffer: largeBuffer }]
    );
    const largeRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': largeMultipart.contentType
      },
      rawBody: largeMultipart.body
    });
    assert(
      largeRes.status === 400 && largeRes.data?.message?.includes('10MB'),
      '8. Completion file larger than 10 MB is rejected with 400 Bad Request'
    );

    // Test 9: Invalid coordinates are rejected
    const invalidCoordsMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Completed repairs with impossible latitude.',
        latitude: '195.5',
        longitude: '73.8567',
        accuracy: '10',
        capturedAt: new Date().toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'photo.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );
    const invalidCoordsRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': invalidCoordsMultipart.contentType
      },
      rawBody: invalidCoordsMultipart.body
    });
    assert(
      invalidCoordsRes.status === 400 && invalidCoordsRes.data?.message?.includes('latitude'),
      '9. Invalid latitude coordinates (>90) rejected with 400 Bad Request'
    );

    // Test 10: GPS accuracy above 100 metres is rejected
    const lowAccuracyMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Completed repairs with poor cell tower accuracy.',
        latitude: '18.5204',
        longitude: '73.8567',
        accuracy: '150',
        capturedAt: new Date().toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'photo.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );
    const lowAccuracyRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint2._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': lowAccuracyMultipart.contentType
      },
      rawBody: lowAccuracyMultipart.body
    });
    assert(
      lowAccuracyRes.status === 400 && lowAccuracyRes.data?.message?.includes('100 metres or better'),
      '10. GPS accuracy above 100 metres is rejected with 400 Bad Request'
    );

    console.log('\n--- Section 3: Geofence Distance Verification ---');

    // Test 11: Completion distance within tolerance is accepted
    // Original: 18.5204, 73.8567; Offset: ~50m away -> 18.5208, 73.8567
    const complaint3 = await createTestComplaint({ trackingSuffix: 'T11' });
    const withinToleranceMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Completed repairs and verified location within 50 metres.',
        latitude: '18.5208',
        longitude: '73.8567',
        accuracy: '10',
        capturedAt: new Date().toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'finish.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );
    const withinTolRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint3._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': withinToleranceMultipart.contentType
      },
      rawBody: withinToleranceMultipart.body
    });
    assert(
      withinTolRes.status === 200 && withinTolRes.data?.complaint?.status === 'Provisionally Resolved',
      '11. Completion distance within 200m tolerance is accepted (Provisionally Resolved)'
    );

    // Test 12: Completion distance beyond tolerance is rejected
    // Offset ~11km away -> 18.6204, 73.8567
    const complaint4 = await createTestComplaint({ trackingSuffix: 'T12' });
    const beyondToleranceMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Completed repairs but taken 11km away at the municipal depot.',
        latitude: '18.6204',
        longitude: '73.8567',
        accuracy: '10',
        capturedAt: new Date().toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'depot.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );
    const beyondTolRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint4._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': beyondToleranceMultipart.contentType
      },
      rawBody: beyondToleranceMultipart.body
    });
    assert(
      beyondTolRes.status === 400 && beyondTolRes.data?.message?.includes('exceeds the permitted tolerance'),
      '12. Completion distance beyond configured tolerance is rejected with 400 Bad Request'
    );

    // Test 13: Missing original complaint GPS is handled safely
    const noGpsComplaint = await createTestComplaint({ withCoords: false, trackingSuffix: 'T13' });
    const noGpsRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${noGpsComplaint._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': validMultipart.contentType
      },
      rawBody: validMultipart.body
    });
    assert(
      noGpsRes.status === 400 && noGpsRes.data?.message?.includes('Original complaint does not contain valid GPS'),
      '13. Missing original complaint GPS coordinates rejected safely with clear explanation'
    );

    console.log('\n--- Section 4: Timestamp & EXIF Fallback Verification ---');

    // Test 14: Invalid, future, or older-than-24-hour timestamps are rejected
    const futureTimestamp = new Date(Date.now() + 3600000).toISOString();
    const futureMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Completed work with future timestamp.',
        latitude: '18.5204',
        longitude: '73.8567',
        accuracy: '10',
        capturedAt: futureTimestamp
      },
      [{ fieldname: 'completionPhoto', filename: 'future.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );
    const futureRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint4._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': futureMultipart.contentType
      },
      rawBody: futureMultipart.body
    });
    assert(
      futureRes.status === 400 && futureRes.data?.message?.includes('future'),
      '14a. Timestamp in the future (>60s) is rejected with 400 Bad Request'
    );

    const oldTimestamp = new Date(Date.now() - 48 * 3600000).toISOString();
    const oldMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Completed work with 48h old timestamp.',
        latitude: '18.5204',
        longitude: '73.8567',
        accuracy: '10',
        capturedAt: oldTimestamp
      },
      [{ fieldname: 'completionPhoto', filename: 'old.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );
    const oldRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint4._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': oldMultipart.contentType
      },
      rawBody: oldMultipart.body
    });
    assert(
      oldRes.status === 400 && oldRes.data?.message?.includes('24 hours'),
      '14b. Timestamp older than 24 hours is rejected with 400 Bad Request'
    );

    // Test 15: Missing EXIF GPS is handled according to documented fallback
    // VALID_COMPLETION_PNG_BUFFER has no EXIF GPS. The submission should succeed with no_metadata
    const complaint5 = await createTestComplaint({ trackingSuffix: 'T15' });
    const noExifMultipart = buildMultipartForm(
      {
        resolutionNotes: 'Genuine field photo taken without hardware EXIF GPS metadata.',
        latitude: '18.5204',
        longitude: '73.8567',
        accuracy: '15',
        capturedAt: new Date(Date.now() - 60000).toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'no_exif.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );
    const noExifRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint5._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': noExifMultipart.contentType
      },
      rawBody: noExifMultipart.body
    });
    assert(
      noExifRes.status === 200 &&
      noExifRes.data?.complaint?.completionEvidence?.exifComparisonStatus === 'no_metadata' &&
      noExifRes.data?.complaint?.completionEvidence?.verificationStatus === 'verified',
      '15. Missing EXIF GPS falls back safely to device GPS with exifComparisonStatus: no_metadata'
    );

    console.log('\n--- Section 5: Concurrency & Integrity Checks ---');

    // Test 16: Duplicate submissions and concurrent requests cannot create duplicate completion transitions
    const complaint6 = await createTestComplaint({ trackingSuffix: 'T16' });
    const concurrent1 = apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint6._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': validMultipart.contentType
      },
      rawBody: validMultipart.body
    });
    const concurrent2 = apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint6._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': validMultipart.contentType
      },
      rawBody: validMultipart.body
    });

    const [c1Res, c2Res] = await Promise.all([concurrent1, concurrent2]);
    const statuses = [c1Res.status, c2Res.status].sort();
    assert(
      statuses[0] === 200 && (statuses[1] === 409 || statuses[1] === 400),
      `16. Concurrent completion submissions: exactly one succeeds (200) and the second is rejected (${statuses[1]})`
    );

    // Test 17: Original citizen evidence remains unchanged
    const fetchedComp6 = await Complaint.findById(complaint6._id);
    assert(
      fetchedComp6.evidence &&
      fetchedComp6.evidence.originalName === 'issue.png' &&
      fetchedComp6.evidence.coordinates.latitude === 18.5204 &&
      fetchedComp6.completionEvidence !== null,
      '17. Original citizen evidence object and coordinates remain intact after work completion'
    );

    console.log('\n--- Section 6: Authenticated Evidence Retrieval ---');

    // Test 18: Unauthorized users cannot retrieve completion photographs (403)
    const unauthGet1 = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint1._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${otherCitizenToken}` }
    });
    assert(
      unauthGet1.status === 403,
      '18a. Unrelated citizen receives 403 Forbidden on completion evidence retrieval'
    );

    const unauthGet2 = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint1._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${otherOfficerToken}` }
    });
    assert(
      unauthGet2.status === 403,
      '18b. Unassigned officer receives 403 Forbidden on completion evidence retrieval'
    );

    // Test 19: Authorized citizen, assigned officer, and admin can retrieve evidence
    const citizenGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint1._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${citizenToken}` },
      isBinary: true
    });
    assert(
      citizenGet.status === 200 && citizenGet.headers['content-type']?.includes('image') && citizenGet.headers['cache-control']?.includes('no-store'),
      '19a. Complaint citizen retrieves completion image (200 OK with private no-store headers)'
    );

    const officerGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint1._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${officerToken}` },
      isBinary: true
    });
    assert(
      officerGet.status === 200 && officerGet.buffer.length > 0,
      '19b. Assigned officer retrieves completion image stream (200 OK)'
    );

    const adminGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint1._id}/completion-evidence`,
      headers: { Authorization: `Bearer ${adminToken}` },
      isBinary: true
    });
    assert(
      adminGet.status === 200 && adminGet.buffer.length > 0,
      '19c. Admin retrieves completion image stream (200 OK)'
    );

    console.log('\n--- Section 7: File Clean-up & Security Sanitization ---');

    // Test 20: Failed submissions do not leave orphaned files
    const filesBefore = fs.readdirSync(UPLOAD_DIR).filter((f) => f.startsWith('completion-'));
    const failedSubmissionMultipart = buildMultipartForm(
      {
        resolutionNotes: 'This submission fails due to out-of-range distance.',
        latitude: '18.9999', // out of range
        longitude: '73.8567',
        accuracy: '10',
        capturedAt: new Date().toISOString()
      },
      [{ fieldname: 'completionPhoto', filename: 'orphan_test.png', contentType: 'image/png', buffer: VALID_COMPLETION_PNG_BUFFER }]
    );
    const failedSubRes = await apiRequest({
      method: 'POST',
      path: `/api/complaints/${complaint4._id}/complete-work`,
      headers: {
        Authorization: `Bearer ${officerToken}`,
        'Content-Type': failedSubmissionMultipart.contentType
      },
      rawBody: failedSubmissionMultipart.body
    });
    assert(failedSubRes.status === 400, '20a. Out of range submission rejected with 400');
    const filesAfter = fs.readdirSync(UPLOAD_DIR).filter((f) => f.startsWith('completion-'));
    assert(
      filesBefore.length === filesAfter.length,
      `20b. No orphaned completion files remain in upload directory after failed submission (${filesBefore.length} === ${filesAfter.length})`
    );

    // Test 21: Provisional complaints do not receive a final resolvedAt timestamp
    const provDoc = await Complaint.findById(complaint1._id);
    assert(
      provDoc.status === 'Provisionally Resolved' && provDoc.resolvedAt === null,
      '21. Provisionally Resolved complaint maintains resolvedAt as null (final resolution not yet occurred)'
    );

    // Test 22: Internal storage keys and filesystem paths are not exposed in public API responses
    const singleGet = await apiRequest({
      method: 'GET',
      path: `/api/complaints/${complaint1._id}`,
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    const cData = singleGet.data?.complaint;
    assert(
      cData &&
      cData.completionEvidence &&
      cData.completionEvidence.storageKey === undefined &&
      cData.completionEvidence.filePath === undefined &&
      cData.evidence.storageKey === undefined,
      '22. Public complaint JSON strips internal storageKey and filePath from completionEvidence and evidence'
    );

    // Test 23: Notification was sent to citizen with type 'work_completed'
    const notif = await Notification.findOne({
      recipient: citizenUser.id,
      complaint: complaint1._id,
      type: 'work_completed'
    });
    assert(
      notif !== null && notif.title.includes('Work Completed'),
      '23. Notification with type work_completed created for citizen'
    );

    console.log('\n================================================================');
    console.log(`Step 3 Verification Completed: ${passed} / ${total} PASS (${Math.round((passed / total) * 100)}%)`);
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

runStep3Tests().catch((err) => {
  console.error('Test suite failed with fatal error:', err);
  process.exit(1);
});
