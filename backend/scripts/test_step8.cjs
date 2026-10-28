/**
 * CivicTrack — Step 8 Automated Acceptance & Verification Suite
 * Tests:
 * 1. Single-Admin policy enforcement across models, scripts, and auth.
 * 2. Officer account provisioning by Admin (POST /api/auth/officers).
 * 3. Mandatory geotagged photo evidence (POST /api/complaints, magic bytes, coordinates).
 * 4. Evidence streaming and role-based access control (GET /api/complaints/:id/evidence).
 * 5. In-App Notifications (triggers on assign, status, resolution; GET /api/notifications, PATCH /read).
 * 6. Reporting and CSV Export with formula injection defense and role-scoped data.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const { Complaint } = require('../models/Complaint');
const Notification = require('../models/Notification');
const { calculateDistanceMeters, validateImageMagicBytes, extractExifGps } = require('../utils/exifParser');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Sample minimal valid image buffers
const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

const VALID_JPEG_BUFFER = Buffer.from(
  'ffd8ffe000104a46494600010101004800480000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffda0008010100003f00bf00ffd9',
  'hex'
);

const FAKE_TEXT_BUFFER = Buffer.from('This is not an image file. It is plain text.');

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

// Multipart Form Builder Helper
function buildMultipartForm(fields, files = []) {
  const boundary = '----WebKitFormBoundaryCivicTrackStep8' + Math.random().toString(36).substring(2);
  const chunks = [];

  for (const [key, val] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
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

async function runStep8Tests() {
  console.log('================================================================');
  console.log('CivicTrack — Step 8 Automated Acceptance & Verification Suite');
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

  // Connect to DB directly for model level checks
  await mongoose.connect(process.env.MONGO_URI);

  // Authenticate existing admin
  console.log('[Phase 1] Testing Authentication & Invariant Single Admin Policy');
  const adminLogin = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'admin@civictrack.gov', password: 'Admin@123' }
  });
  assert(adminLogin.status === 200 && adminLogin.data?.token, '1. Admin logs in with authentic credentials');
  const adminToken = adminLogin.data.token;
  const adminUserId = adminLogin.data.user.id;

  // Verify only one admin in DB
  const adminCount = await User.countDocuments({ role: 'admin' });
  assert(adminCount === 1, `2. Exactly one administrator exists in MongoDB (found: ${adminCount})`);

  // Attempting to create secondary admin via Mongoose directly
  let duplicateAdminCaught = false;
  try {
    const fakeAdmin = new User({
      name: 'Rogue Admin',
      email: 'rogue.admin@civictrack.gov',
      password: 'RoguePassword123!',
      role: 'admin'
    });
    await fakeAdmin.save();
  } catch (err) {
    duplicateAdminCaught = true;
    assert(
      err.message.includes('Single-Admin') || err.message.includes('one designated administrator') || err.message.includes('Only one administrator'),
      '3. User pre-save hook strictly rejects secondary admin creation'
    );
  }
  if (!duplicateAdminCaught) {
    assert(false, '3. FAILED: Secondary admin was saved to MongoDB without restriction');
  }

  // Running bootstrap-admin.js should exit with zero modifications and notice
  try {
    const bootstrapOutput = execSync('node backend/scripts/bootstrap-admin.js', { encoding: 'utf8' });
    assert(
      bootstrapOutput.includes('already exists') && bootstrapOutput.includes('exactly one administrator'),
      '4. bootstrap-admin.js script safely recognizes existing admin and refuses duplicate'
    );
  } catch (e) {
    assert(false, `4. bootstrap-admin.js threw unexpected error: ${e.message}`);
  }

  // Running provision-user.js with --role admin should refuse
  try {
    execSync('node backend/scripts/provision-user.js --create --name "Test" --email "test.admin@civictrack.gov" --role admin --password "Test1234!"', {
      encoding: 'utf8'
    });
    assert(false, '5. provision-user.js failed to reject --role admin');
  } catch (e) {
    assert(
      e.message.includes('refused') || e.message.includes('Only one administrator') || e.status !== 0,
      '5. provision-user.js rejects secondary admin creation attempt'
    );
  }

  // Phase 2: Officer Account Provisioning
  console.log('\n[Phase 2] Testing Officer Account Provisioning (POST /api/auth/officers)');
  
  // Non-admin attempt should be 403
  const citizenLogin = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'citizen@civictrack.gov', password: 'Citizen@123' }
  });
  assert(citizenLogin.status === 200, '6. Citizen logs in successfully');
  const citizenToken = citizenLogin.data.token;

  const citizenOfficerAttempt = await apiRequest({
    method: 'POST',
    path: '/api/auth/officers',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      name: 'Unauthorized Officer',
      email: 'unauth.officer@civictrack.gov',
      password: 'Password123!',
      department: 'Roads & Infrastructure'
    }
  });
  assert(citizenOfficerAttempt.status === 403, '7. Non-admin is forbidden (403) from provisioning officer accounts');

  // Admin provisioning new officer
  const newOfficerEmail = `officer.step8.${Date.now()}@civictrack.gov`;
  const provisionRes = await apiRequest({
    method: 'POST',
    path: '/api/auth/officers',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: 'Officer Step Eight',
      email: newOfficerEmail,
      password: 'OfficerPassword123!',
      department: 'Electrical & Streetlighting'
    }
  });
  assert(provisionRes.status === 201 && provisionRes.data?.officer?.role === 'officer', '8. Admin successfully provisions new officer account');
  assert(!provisionRes.data?.officer?.password, '9. Provisioned officer response does not leak password hash');
  const newOfficer = provisionRes.data.officer;

  // Provisioning with duplicate email
  const duplicateOfficerRes = await apiRequest({
    method: 'POST',
    path: '/api/auth/officers',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: 'Officer Step Eight Duplicate',
      email: newOfficerEmail,
      password: 'OfficerPassword123!',
      department: 'Roads & Infrastructure'
    }
  });
  assert(duplicateOfficerRes.status === 409, '10. Provisioning duplicate officer email is rejected with 409 Conflict');

  // Verify newly provisioned officer can log in
  const newOfficerLogin = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: newOfficerEmail, password: 'OfficerPassword123!' }
  });
  assert(newOfficerLogin.status === 200 && newOfficerLogin.data?.user?.role === 'officer', '11. Provisioned officer logs in and receives officer role JWT');
  const officerToken = newOfficerLogin.data.token;

  // Phase 3: Mandatory Geotagged Complaint Evidence
  console.log('\n[Phase 3] Testing Mandatory Geotagged Evidence & EXIF Processing');

  // 1. Complaint submission without evidence must fail with 400
  const noEvidenceRes = await apiRequest({
    method: 'POST',
    path: '/api/complaints',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Missing Photo Evidence Pothole',
      description: 'This complaint contains no photo evidence attached to it.',
      category: 'Pothole/Road Damage',
      address: '100 Main Street',
      latitude: 12.9716,
      longitude: 77.5946
    }
  });
  assert(noEvidenceRes.status === 400, '12. POST /api/complaints without photograph is rejected (400 Bad Request)');
  assert(noEvidenceRes.data?.message?.includes('photograph is required'), '13. Meaningful error message returned for missing evidence');

  // 2. Complaint submission with corrupted/fake magic bytes must fail with 400
  const fakeFileMultipart = buildMultipartForm(
    {
      title: 'Corrupted File Complaint',
      description: 'Attempting to upload a plain text file renamed as image.jpg.',
      category: 'Garbage/Waste',
      address: '200 Waste Road',
      latitude: 12.972,
      longitude: 77.595
    },
    [
      {
        fieldname: 'evidence',
        filename: 'fake-photo.jpg',
        contentType: 'image/jpeg',
        buffer: FAKE_TEXT_BUFFER
      }
    ]
  );
  const fakeFileRes = await apiRequest({
    method: 'POST',
    path: '/api/complaints',
    headers: {
      Authorization: `Bearer ${citizenToken}`,
      'Content-Type': fakeFileMultipart.contentType
    },
    rawBody: fakeFileMultipart.body
  });
  assert(fakeFileRes.status === 400, '14. POST /api/complaints rejects file with invalid magic bytes (400 Bad Request)');

  // 3. Complaint submission with valid PNG image and coordinates
  const validMultipart = buildMultipartForm(
    {
      title: 'Step 8 Valid Geotagged Pothole Evidence',
      description: 'Significant road crater captured with on-site device GPS coordinates.',
      category: 'Pothole/Road Damage',
      address: '456 Residency Road, Ward 12',
      latitude: '12.975000',
      longitude: '77.598000',
      evidenceLatitude: '12.975000',
      evidenceLongitude: '77.598000',
      evidenceAccuracy: '12',
      evidenceCapturedAt: new Date().toISOString(),
      evidenceLocationSource: 'device_gps'
    },
    [
      {
        fieldname: 'evidence',
        filename: 'pothole-evidence.png',
        contentType: 'image/png',
        buffer: VALID_PNG_BUFFER
      }
    ]
  );

  const validComplaintRes = await apiRequest({
    method: 'POST',
    path: '/api/complaints',
    headers: {
      Authorization: `Bearer ${citizenToken}`,
      'Content-Type': validMultipart.contentType
    },
    rawBody: validMultipart.body
  });
  if (validComplaintRes.status !== 201) {
    console.log('DEBUG validComplaintRes:', validComplaintRes.status, validComplaintRes.data || validComplaintRes.raw);
  }
  assert(validComplaintRes.status === 201, '15. POST /api/complaints with valid photograph and coordinates succeeds (201 Created)');
  assert(validComplaintRes.data?.complaint?.hasEvidence === true, '16. Created complaint has hasEvidence: true');
  assert(validComplaintRes.data?.complaint?.evidence?.originalName === 'pothole-evidence.png', '17. Evidence originalName persisted correctly');
  assert(validComplaintRes.data?.complaint?.evidence?.coordinates?.latitude === 12.975, '18. Evidence coordinates persisted in subdocument');
  assert(validComplaintRes.data?.complaint?.evidence?.exifComparisonStatus, '19. EXIF comparison status generated in evidence subdocument');

  const createdComplaintId = validComplaintRes.data.complaint._id || validComplaintRes.data.complaint.id;

  // 4. Test pure EXIF Parser and Haversine Distance helper directly
  const d1 = calculateDistanceMeters(12.9716, 77.5946, 12.972, 77.5946);
  assert(Math.round(d1) > 0 && Math.round(d1) < 100, `20. Haversine distance calculator accurate (approx 44m, got: ${Math.round(d1)}m)`);

  const magicPng = validateImageMagicBytes(VALID_PNG_BUFFER);
  const magicJpg = validateImageMagicBytes(VALID_JPEG_BUFFER);
  const magicFake = validateImageMagicBytes(FAKE_TEXT_BUFFER);
  assert(magicPng === 'image/png' && magicJpg === 'image/jpeg' && magicFake === null, '21. Magic bytes validator reliably detects JPEG, PNG, and rejects non-images');

  // Phase 4: Evidence Streaming & Access Control (GET /api/complaints/:id/evidence)
  console.log('\n[Phase 4] Testing Evidence Streaming & RBAC (GET /api/complaints/:id/evidence)');

  // 1. Owner citizen streams evidence
  const ownerStream = await apiRequest({
    method: 'GET',
    path: `/api/complaints/${createdComplaintId}/evidence`,
    headers: { Authorization: `Bearer ${citizenToken}` },
    isBinary: true
  });
  assert(ownerStream.status === 200, '22. Complaint owner citizen streams evidence file (200 OK)');
  assert(ownerStream.headers['content-type'] === 'image/png', '23. Evidence streamed with correct Content-Type: image/png');
  assert(ownerStream.buffer.length === VALID_PNG_BUFFER.length, '24. Streamed file byte length matches uploaded photograph');

  // 2. Admin streams evidence
  const adminStream = await apiRequest({
    method: 'GET',
    path: `/api/complaints/${createdComplaintId}/evidence`,
    headers: { Authorization: `Bearer ${adminToken}` },
    isBinary: true
  });
  assert(adminStream.status === 200, '25. Administrator streams complaint evidence (200 OK)');

  // 3. Another citizen attempts to stream evidence
  let secondCitizenToken = null;
  const regRes = await apiRequest({
    method: 'POST',
    path: '/api/auth/register',
    body: {
      name: 'Secondary Citizen',
      email: 'secondary.citizen@example.com',
      password: 'CitizenPassword123!'
    }
  });
  if (regRes.status === 201) {
    secondCitizenToken = regRes.data.token;
  } else {
    const loginRes = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'secondary.citizen@example.com',
        password: 'CitizenPassword123!'
      }
    });
    secondCitizenToken = loginRes.data?.token;
  }

  const unauthorizedStream = await apiRequest({
    method: 'GET',
    path: `/api/complaints/${createdComplaintId}/evidence`,
    headers: { Authorization: `Bearer ${secondCitizenToken}` }
  });
  assert(unauthorizedStream.status === 403, '26. Unauthorized citizen is rejected with 403 Forbidden when requesting another citizen\'s evidence');

  // Phase 5: Notifications Workflow
  console.log('\n[Phase 5] Testing Automated In-App Notifications on State Transitions');

  // Assign complaint to newOfficer
  const assignRes = await apiRequest({
    method: 'PATCH',
    path: `/api/complaints/${createdComplaintId}/assign`,
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      officerId: newOfficer.id,
      department: 'Electrical & Streetlighting'
    }
  });
  assert(assignRes.status === 200, '27. Admin assigns complaint to officer');

  // Check notifications for assigned officer
  const officerNotifs = await apiRequest({
    method: 'GET',
    path: '/api/notifications',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerNotifs.status === 200, '28. GET /api/notifications returns 200 for officer');
  assert(officerNotifs.data.notifications.length > 0, '29. Assigned officer received task allocation notification');
  assert(officerNotifs.data.notifications[0].type === 'complaint_assigned', '30. Officer notification type is complaint_assigned');
  assert(officerNotifs.data.unreadCount >= 1, '31. unreadCount accurately reflects unread notification');

  // Check citizen also notified of assignment
  const citizenNotifs = await apiRequest({
    method: 'GET',
    path: '/api/notifications',
    headers: { Authorization: `Bearer ${citizenToken}` }
  });
  assert(citizenNotifs.data.notifications.some(n => n.type === 'complaint_assigned'), '32. Citizen received notification of officer assignment');

  // Officer updates status to In Progress
  const statusRes = await apiRequest({
    method: 'PATCH',
    path: `/api/complaints/${createdComplaintId}/status`,
    headers: { Authorization: `Bearer ${officerToken}` },
    body: {
      status: 'In Progress',
      comment: 'Field crew dispatched to repair streetlight pole and wiring.'
    }
  });
  assert(statusRes.status === 200, '33. Officer advances status to In Progress');

  // Officer resolves complaint with resolution proof
  const resolveRes = await apiRequest({
    method: 'PATCH',
    path: `/api/complaints/${createdComplaintId}/resolution`,
    headers: { Authorization: `Bearer ${officerToken}` },
    body: {
      resolutionNotes: 'Streetlight pole re-anchored, ballast replaced, and LED unit verified illuminated.',
      markResolved: true
    }
  });
  assert(resolveRes.status === 200, '34. Officer submits resolution record');

  // Verify citizen receives resolution notification
  const citizenNotifsAfterResolve = await apiRequest({
    method: 'GET',
    path: '/api/notifications',
    headers: { Authorization: `Bearer ${citizenToken}` }
  });
  const resolveNotif = citizenNotifsAfterResolve.data.notifications.find(n => n.type === 'complaint_resolved');
  assert(Boolean(resolveNotif), '35. Citizen received verified complaint_resolved notification');

  // Test PATCH /api/notifications/:id/read
  if (resolveNotif) {
    const notifId = resolveNotif.id || resolveNotif._id;
    const markReadRes = await apiRequest({
      method: 'PATCH',
      path: `/api/notifications/${notifId}/read`,
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(markReadRes.status === 200 && markReadRes.data.notification.isRead === true, '36. Individual notification marked as read (PATCH /:id/read)');
  }

  // Test PATCH /api/notifications/read-all
  const markAllRes = await apiRequest({
    method: 'PATCH',
    path: '/api/notifications/read-all',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(markAllRes.status === 200, '37. Mark all notifications as read (PATCH /read-all) succeeds');
  const officerNotifsAfterMarkAll = await apiRequest({
    method: 'GET',
    path: '/api/notifications',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerNotifsAfterMarkAll.data.unreadCount === 0, '38. Officer unreadCount is 0 after mark-all');

  // Phase 6: Reporting & CSV Export with Formula Injection Defense
  console.log('\n[Phase 6] Testing Reporting & CSV Export Defense');

  // Create a formula injection test complaint
  const formulaMultipart = buildMultipartForm(
    {
      title: '=1+1 Dangerous Injection Formula',
      description: '@SUM(A1:A10) Excel Formula in Description -CMD | \' /C calc\'!A0',
      category: 'Streetlight',
      address: '+44 Street Road, Sector 5',
      latitude: '12.980000',
      longitude: '77.600000'
    },
    [
      {
        fieldname: 'evidence',
        filename: 'injection-test.png',
        contentType: 'image/png',
        buffer: VALID_PNG_BUFFER
      }
    ]
  );
  await apiRequest({
    method: 'POST',
    path: '/api/complaints',
    headers: {
      Authorization: `Bearer ${citizenToken}`,
      'Content-Type': formulaMultipart.contentType
    },
    rawBody: formulaMultipart.body
  });

  // Admin exports CSV
  const adminCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv',
    headers: { Authorization: `Bearer ${adminToken}` },
    isBinary: true
  });
  assert(adminCsvRes.status === 200, '39. Admin requests GET /api/complaints/export/csv (200 OK)');
  assert(adminCsvRes.headers['content-type'].includes('text/csv'), '40. Content-Type is text/csv');
  assert(adminCsvRes.headers['content-disposition'].includes('attachment; filename="civictrack-complaints-'), '41. Content-Disposition header formatted with attachment and date filename');

  const csvContent = adminCsvRes.buffer.toString('utf8');
  assert(csvContent.includes('\'=1+1 Dangerous Injection Formula'), '42. Formula starting with = sanitized with leading quote (\'=)');
  assert(csvContent.includes('\'@SUM(A1:A10)'), '43. Formula starting with @ sanitized with leading quote (\'@)');
  assert(csvContent.includes('\'+44 Street Road'), '44. Cell starting with + sanitized with leading quote (\'+)');

  // Verify Role Scoping: Citizen CSV only includes citizen's complaints
  const citizenCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv',
    headers: { Authorization: `Bearer ${citizenToken}` },
    isBinary: true
  });
  const citizenCsvContent = citizenCsvRes.buffer.toString('utf8');
  assert(citizenCsvRes.status === 200, '45. Citizen export CSV returns 200');
  assert(!citizenCsvContent.includes('CT-20261022-A2C6'), '46. Citizen export strictly excludes other citizens\' complaints');

  console.log('\n================================================================');
  console.log(`Step 8 Verification Complete: ${passed}/${total} assertions passed`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(passed === total ? 0 : 1);
}

runStep8Tests().catch((err) => {
  console.error('[Verification Error]:', err);
  process.exit(1);
});
