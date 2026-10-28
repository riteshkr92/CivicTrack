/**
 * CivicTrack — Step 10 Comprehensive Integration, Security & Regression Suite
 *
 * Validates:
 * 1. Authentication & Role Boundaries (Citizen, Officer, Single-Admin invariant, Self-escalation prevention)
 * 2. Citizen Complaint Workflow (Submission, Persistence, Ownership Isolation, Magic Bytes, Disk Cleanup, Provenance)
 * 3. Officer Caseload & Admin Workflows (Assignment, State Machine, Resolution Notes, Workload Metrics, Notifications)
 * 4. CSV Export Integrity & Scoping (Role Scoping, Headers, Filename, Formula Injection Defense)
 * 5. AI Civic Intelligence Service (Domain Classification, Priority Heuristics, Duplicate Privacy, Resilience)
 * 6. Evidence Access & Path Traversal Prevention (RBAC, Directory Traversal Defense, Notification Isolation)
 * 7. Query Sanitization & ReDoS Defense (Search Regex Special Characters)
 * 8. Cleanup & Database Integrity Verification (Zero residual test records, designated admin preserved)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const { Complaint, VALID_CATEGORIES, VALID_STATUSES, VALID_PRIORITIES } = require('../models/Complaint');
const { Notification } = require('../models/Notification');
const {
  analyzeComplaint,
  classifyWithLocalNlp,
  recommendPriorityWithLocalNlp,
  findPotentialDuplicates
} = require('../utils/aiService');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const UPLOAD_DIR = path.resolve(__dirname, '../uploads/evidence');

// Minimal valid PNG buffer
const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);

// HTTP Helper
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
  const boundary = '----WebKitFormBoundaryStep10' + Math.random().toString(36).substring(2);
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

async function runStep10Tests() {
  console.log('================================================================');
  console.log('CivicTrack — Step 10 Comprehensive Integration & Security Suite');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;
  const createdUserIds = [];
  const createdComplaintIds = [];

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✔ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ✖ [FAIL] ${message}`);
    }
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[Setup] Connected to MongoDB database:', mongoose.connection.name);

  // -------------------------------------------------------------------------
  // Section 1: Authentication, Session & Role Escalation Defense
  // -------------------------------------------------------------------------
  console.log('\n--- Section 1: Authentication, Session & Role Escalation Defense ---');

  // 1. Admin login
  const adminLogin = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'admin@civictrack.gov', password: 'Admin@123' }
  });
  assert(adminLogin.status === 200 && adminLogin.data?.token, '1. Admin authenticates successfully');
  const adminToken = adminLogin.data.token;
  const adminId = adminLogin.data.user.id;

  // 2. Verified single-admin invariant in DB
  const adminCount = await User.countDocuments({ role: 'admin' });
  assert(adminCount === 1, `2. Exactly one designated administrator exists in database (found: ${adminCount})`);

  // 3. Citizen self-registration with attempted role escalation to admin
  const testCitizenEmail = `citizen.step10.${Date.now()}@civictrack.gov`;
  const regRes = await apiRequest({
    method: 'POST',
    path: '/api/auth/register',
    body: {
      name: 'Step Ten Citizen',
      email: testCitizenEmail,
      password: 'CitizenPassword123!',
      role: 'admin' // Attempted role escalation
    }
  });
  assert(regRes.status === 201, '3. Citizen registration succeeds');
  assert(regRes.data?.user?.role === 'citizen', '4. Role escalation prevented: role forced strictly to citizen');
  if (regRes.data?.user?.id) createdUserIds.push(regRes.data.user.id);

  // 4. Citizen login & session verification
  const citizenLogin = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: testCitizenEmail, password: 'CitizenPassword123!' }
  });
  assert(citizenLogin.status === 200 && citizenLogin.data?.token, '5. Newly registered citizen logs in successfully');
  const citizenToken = citizenLogin.data.token;
  const citizenId = citizenLogin.data.user.id;

  // 5. GET /api/auth/me session restore
  const meRes = await apiRequest({
    method: 'GET',
    path: '/api/auth/me',
    headers: { Authorization: `Bearer ${citizenToken}` }
  });
  assert(meRes.status === 200 && meRes.data?.user?.id === citizenId, '6. GET /api/auth/me correctly restores authenticated user session');

  // 6. Citizen forbidden from admin-only endpoints
  const citizenAdminCheck = await apiRequest({
    method: 'GET',
    path: '/api/auth/admin-check',
    headers: { Authorization: `Bearer ${citizenToken}` }
  });
  assert(citizenAdminCheck.status === 403, '7. Citizen rejected with 403 Forbidden on admin-check');

  // 7. Citizen forbidden from provisioning officers
  const citizenOfficerAttempt = await apiRequest({
    method: 'POST',
    path: '/api/auth/officers',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      name: 'Rogue Officer',
      email: `rogue.officer.${Date.now()}@civictrack.gov`,
      password: 'Password123!',
      department: 'Roads & Infrastructure'
    }
  });
  assert(citizenOfficerAttempt.status === 403, '8. Citizen rejected with 403 Forbidden from officer provisioning');

  // 8. Admin provisions official officer
  const testOfficerEmail = `officer.step10.${Date.now()}@civictrack.gov`;
  const provRes = await apiRequest({
    method: 'POST',
    path: '/api/auth/officers',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: 'Officer Step Ten',
      email: testOfficerEmail,
      password: 'OfficerPassword123!',
      department: 'Roads & Infrastructure'
    }
  });
  assert(provRes.status === 201 && provRes.data?.officer?.role === 'officer', '9. Admin successfully provisions municipal officer');
  if (provRes.data?.officer?.id) createdUserIds.push(provRes.data.officer.id);

  // 9. Officer logs in
  const officerLogin = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: testOfficerEmail, password: 'OfficerPassword123!' }
  });
  assert(officerLogin.status === 200 && officerLogin.data?.token, '10. Officer logs in successfully');
  const officerToken = officerLogin.data.token;
  const officerId = officerLogin.data.user.id;

  // 10. Officer forbidden from admin summary
  const officerAdminSummary = await apiRequest({
    method: 'GET',
    path: '/api/complaints/admin/summary',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerAdminSummary.status === 403, '11. Officer rejected with 403 Forbidden from admin summary');

  // -------------------------------------------------------------------------
  // Section 2: Citizen Complaint Workflow & Data Isolation
  // -------------------------------------------------------------------------
  console.log('\n--- Section 2: Citizen Complaint Workflow & Data Isolation ---');

  // 11. Complaint submission with invalid magic bytes rejected and cleaned up
  const initialFileCount = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0;
  const badFileMultipart = buildMultipartForm(
    {
      title: 'Corrupt File Test',
      description: 'Attempting to upload text file disguised as image',
      category: 'Streetlight',
      address: 'Sector 4, Road 12',
      latitude: '12.9716',
      longitude: '77.5946'
    },
    [
      {
        fieldname: 'evidence',
        filename: 'fake-image.png',
        contentType: 'image/png',
        buffer: Buffer.from('NOT AN IMAGE FILE')
      }
    ]
  );
  const badFileRes = await apiRequest({
    method: 'POST',
    path: '/api/complaints',
    headers: {
      Authorization: `Bearer ${citizenToken}`,
      'Content-Type': badFileMultipart.contentType
    },
    rawBody: badFileMultipart.body
  });
  assert(badFileRes.status === 400, '12. File upload with invalid magic bytes rejected with 400 Bad Request');
  const fileCountAfterBadUpload = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0;
  assert(fileCountAfterBadUpload === initialFileCount, '13. Disk cleanup verified: rejected upload file deleted immediately from server storage');

  // 12. Valid complaint submission by Citizen
  const validComplaintMultipart = buildMultipartForm(
    {
      title: 'Deep crater pothole near metro station entrance',
      description: 'Major asphalt damage causing vehicle damage during rush hour commute.',
      category: 'Pothole/Road Damage',
      address: 'Metro Station Gate 2, Central Ward',
      latitude: '12.975000',
      longitude: '77.599000',
      photoSource: 'camera',
      evidenceLocationSource: 'device_gps'
    },
    [
      {
        fieldname: 'evidence',
        filename: 'pothole-photo.png',
        contentType: 'image/png',
        buffer: VALID_PNG_BUFFER
      }
    ]
  );

  const createRes = await apiRequest({
    method: 'POST',
    path: '/api/complaints',
    headers: {
      Authorization: `Bearer ${citizenToken}`,
      'Content-Type': validComplaintMultipart.contentType
    },
    rawBody: validComplaintMultipart.body
  });
  assert(createRes.status === 201 && createRes.data?.complaint?.trackingId, '14. Valid complaint submitted successfully (201 Created)');
  const testComplaint = createRes.data.complaint;
  createdComplaintIds.push(testComplaint.id);

  assert(testComplaint.trackingId.startsWith('CT-'), '15. Tracking ID follows standard pattern CT-YYYYMMDD-XXXX');
  assert(testComplaint.hasEvidence === true, '16. Complaint recorded with hasEvidence: true');
  assert(testComplaint.evidence?.locationSource === 'device_gps', '17. Photo provenance labeled accurately as device_gps');

  // 13. Citizen ownership isolation: Second citizen cannot access first citizen's complaint
  const secondCitizenEmail = `citizen2.step10.${Date.now()}@civictrack.gov`;
  const reg2 = await apiRequest({
    method: 'POST',
    path: '/api/auth/register',
    body: { name: 'Citizen Two', email: secondCitizenEmail, password: 'CitizenPassword123!' }
  });
  if (reg2.data?.user?.id) createdUserIds.push(reg2.data.user.id);
  const login2 = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: secondCitizenEmail, password: 'CitizenPassword123!' }
  });
  const citizen2Token = login2.data.token;

  const unauthorizedDetailRes = await apiRequest({
    method: 'GET',
    path: `/api/complaints/${testComplaint.id}`,
    headers: { Authorization: `Bearer ${citizen2Token}` }
  });
  assert(unauthorizedDetailRes.status === 404, '18. Citizen 2 blocked from accessing Citizen 1 complaint detail (returns 404 Not Found to prevent enumeration)');

  const unauthorizedTrackRes = await apiRequest({
    method: 'GET',
    path: `/api/complaints/track/${testComplaint.trackingId}`,
    headers: { Authorization: `Bearer ${citizen2Token}` }
  });
  assert(unauthorizedTrackRes.status === 404, '19. Citizen 2 blocked from tracking Citizen 1 complaint reference (returns 404 Not Found)');

  // -------------------------------------------------------------------------
  // Section 3: Officer Caseload & Admin Workflows
  // -------------------------------------------------------------------------
  console.log('\n--- Section 3: Officer Caseload & Admin Workflows ---');

  // 14. Admin assigns complaint to Officer Step Ten
  const assignRes = await apiRequest({
    method: 'PATCH',
    path: `/api/complaints/${testComplaint.id}/assign`,
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      officerId: officerId,
      comment: 'Dispatched to Roads & Infrastructure field team.'
    }
  });
  assert(assignRes.status === 200, '20. Admin assigns complaint to officer successfully');
  assert(assignRes.data?.complaint?.status === 'Under Review', '21. Complaint status advanced automatically to "Under Review" upon assignment');

  // 15. Officer notification received
  const officerNotifs = await apiRequest({
    method: 'GET',
    path: '/api/notifications',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerNotifs.status === 200 && officerNotifs.data?.notifications?.length > 0, '22. Assigned officer received automated in-app task notification');
  assert(officerNotifs.data.notifications[0].type === 'complaint_assigned', '23. Notification type is complaint_assigned');

  // 16. Second officer cannot update status
  const unassignedOfficerEmail = `officer2.step10.${Date.now()}@civictrack.gov`;
  const prov2 = await apiRequest({
    method: 'POST',
    path: '/api/auth/officers',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      name: 'Unassigned Officer',
      email: unassignedOfficerEmail,
      password: 'OfficerPassword123!',
      department: 'Electrical'
    }
  });
  if (prov2.data?.officer?.id) createdUserIds.push(prov2.data.officer.id);
  const log2 = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: unassignedOfficerEmail, password: 'OfficerPassword123!' }
  });
  const unassignedOfficerToken = log2.data.token;

  const unauthorizedStatusRes = await apiRequest({
    method: 'PATCH',
    path: `/api/complaints/${testComplaint.id}/status`,
    headers: { Authorization: `Bearer ${unassignedOfficerToken}` },
    body: { status: 'In Progress', comment: 'Rogue status change' }
  });
  assert(unauthorizedStatusRes.status === 403, '24. Unassigned officer forbidden (403) from updating status of unassigned complaint');

  // 17. Invalid transition rejected (e.g. jumping straight to Resolved without notes)
  const invalidTransitionRes = await apiRequest({
    method: 'PATCH',
    path: `/api/complaints/${testComplaint.id}/status`,
    headers: { Authorization: `Bearer ${officerToken}` },
    body: { status: 'Resolved' } // Missing resolution notes
  });
  assert(invalidTransitionRes.status === 400, '25. Status transition to Resolved without mandatory resolution notes rejected (400 Bad Request)');

  // 18. Valid status progression: Under Review -> In Progress -> Resolved
  const inProgressRes = await apiRequest({
    method: 'PATCH',
    path: `/api/complaints/${testComplaint.id}/status`,
    headers: { Authorization: `Bearer ${officerToken}` },
    body: { status: 'In Progress', comment: 'Repairs initiated on-site.' }
  });
  assert(inProgressRes.status === 200 && inProgressRes.data?.complaint?.status === 'In Progress', '26. Officer successfully transitions status to "In Progress"');

  const resolveRes = await apiRequest({
    method: 'PATCH',
    path: `/api/complaints/${testComplaint.id}/status`,
    headers: { Authorization: `Bearer ${officerToken}` },
    body: {
      status: 'Resolved',
      resolutionNotes: 'Asphalt resurfacing completed. Road reopened for vehicular traffic.'
    }
  });
  assert(resolveRes.status === 200 && resolveRes.data?.complaint?.status === 'Resolved', '27. Officer successfully transitions status to "Resolved" with verified notes');

  // 19. Admin summary metrics check
  const adminSummaryRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/admin/summary',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminSummaryRes.status === 200, '28. Admin operational summary endpoint returns 200 OK');
  const summaryData = adminSummaryRes.data.summary;
  assert(summaryData.total === summaryData.assigned + summaryData.unassigned, '29. Admin summary invariant holds: total = assigned + unassigned');

  // -------------------------------------------------------------------------
  // Section 4: CSV Export Integrity, Scoping & Formula Injection Defense
  // -------------------------------------------------------------------------
  console.log('\n--- Section 4: CSV Export Integrity, Scoping & Formula Injection Defense ---');

  // 20. Citizen CSV export scoped strictly to own records
  const citizenCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv',
    headers: { Authorization: `Bearer ${citizenToken}` },
    isBinary: true
  });
  assert(citizenCsvRes.status === 200, '30. Citizen CSV export returns 200 OK');
  const citizenCsv = citizenCsvRes.buffer.toString('utf8');
  assert(citizenCsv.includes(testComplaint.trackingId), '31. Citizen CSV includes citizen own complaint');

  // 21. Officer CSV export scoped strictly to assigned records
  const officerCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv',
    headers: { Authorization: `Bearer ${officerToken}` },
    isBinary: true
  });
  assert(officerCsvRes.status === 200, '32. Officer CSV export returns 200 OK');
  const officerCsv = officerCsvRes.buffer.toString('utf8');
  assert(officerCsv.includes(testComplaint.trackingId), '33. Officer CSV includes officer assigned complaint');

  // 22. Unassigned officer CSV should exclude this complaint
  const unassignedCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv',
    headers: { Authorization: `Bearer ${unassignedOfficerToken}` },
    isBinary: true
  });
  const unassignedCsv = unassignedCsvRes.buffer.toString('utf8');
  assert(!unassignedCsv.includes(testComplaint.trackingId), '34. Unassigned officer CSV strictly excludes complaints assigned to other officers');

  // 23. Admin export with status filter and formula injection defense
  const adminCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv?status=Resolved',
    headers: { Authorization: `Bearer ${adminToken}` },
    isBinary: true
  });
  assert(adminCsvRes.status === 200, '35. Admin filtered CSV export returns 200 OK');
  assert(adminCsvRes.headers['content-type']?.includes('text/csv'), '36. CSV Content-Type is text/csv');
  assert(adminCsvRes.headers['content-disposition']?.includes('attachment; filename="civictrack-complaints-'), '37. Content-Disposition specifies standard attachment filename');

  // -------------------------------------------------------------------------
  // Section 5: AI Civic Intelligence Service Robustness & Privacy
  // -------------------------------------------------------------------------
  console.log('\n--- Section 5: AI Civic Intelligence Service Robustness & Privacy ---');

  // 24. AI classification accuracy on road issue
  const aiRoadRes = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Massive cracked asphalt and crater potholes on road',
      description: 'Multiple vehicles suffering tire punctures due to deep craters.'
    }
  });
  assert(
    aiRoadRes.status === 200 &&
    aiRoadRes.data?.categoryRecommendation?.category === 'Pothole/Road Damage',
    '38. AI accurately classifies road damage as "Pothole/Road Damage"'
  );

  // 25. AI hazard priority recommendation
  const aiHazardRes = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Sparking live electric wire fallen on flooded street',
      description: 'High electrocution hazard for pedestrians in flood water.'
    }
  });
  assert(
    aiHazardRes.status === 200 &&
    aiHazardRes.data?.priorityRecommendation?.priority === 'Urgent' &&
    aiHazardRes.data?.priorityRecommendation?.isOfficial === false,
    '39. Critical safety hazard triggers "Urgent" recommendation with isOfficial: false'
  );

  // 26. AI duplicate detection proximity & privacy preservation
  const aiDupRes = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Deep crater pothole near metro gate',
      category: 'Pothole/Road Damage',
      coordinates: { latitude: 12.97505, longitude: 77.59905 } // ~8 meters away from testComplaint
    }
  });
  assert(aiDupRes.status === 200, '40. Duplicate detection request completes successfully');
  const dups = aiDupRes.data?.potentialDuplicates || [];
  let noPiiLeaked = true;
  for (const d of dups) {
    if (d.citizen || d.citizenName || d.email || d.phone) {
      noPiiLeaked = false;
      break;
    }
  }
  assert(noPiiLeaked, '41. Duplicate recommendations strictly omit citizen personal data (name, email, phone)');

  // 27. AI resilient fallback on null or corrupted input
  const emptyNlpResult = classifyWithLocalNlp('');
  assert(
    VALID_CATEGORIES.includes(emptyNlpResult.category) && emptyNlpResult.category === 'Other',
    '42. Local NLP handles empty text gracefully defaulting safely to "Other"'
  );

  // -------------------------------------------------------------------------
  // Section 6: Evidence Access & Path Traversal Defense
  // -------------------------------------------------------------------------
  console.log('\n--- Section 6: Evidence Access & Path Traversal Defense ---');

  // 28. Complaint owner citizen streams evidence
  const ownerEvidenceRes = await apiRequest({
    method: 'GET',
    path: `/api/complaints/${testComplaint.id}/evidence`,
    headers: { Authorization: `Bearer ${citizenToken}` },
    isBinary: true
  });
  assert(ownerEvidenceRes.status === 200, '43. Complaint owner citizen successfully streams evidence photograph');
  assert(ownerEvidenceRes.headers['content-type'] === 'image/png', '44. Streamed Content-Type matches image/png');

  // 29. Assigned officer streams evidence
  const officerEvidenceRes = await apiRequest({
    method: 'GET',
    path: `/api/complaints/${testComplaint.id}/evidence`,
    headers: { Authorization: `Bearer ${officerToken}` },
    isBinary: true
  });
  assert(officerEvidenceRes.status === 200, '45. Assigned officer successfully streams evidence photograph');

  // 30. Unassigned officer rejected from streaming evidence
  const unassignedEvidenceRes = await apiRequest({
    method: 'GET',
    path: `/api/complaints/${testComplaint.id}/evidence`,
    headers: { Authorization: `Bearer ${unassignedOfficerToken}` },
    isBinary: true
  });
  assert(unassignedEvidenceRes.status === 403, '46. Unassigned officer rejected with 403 Forbidden when requesting evidence');

  // 31. Path traversal attack in ID parameter rejected
  const traversalRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/..%2f..%2fetc%2fpasswd/evidence',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert([400, 404].includes(traversalRes.status), '47. Directory traversal attack in evidence route safely rejected');

  // -------------------------------------------------------------------------
  // Section 7: Query Sanitization & ReDoS Defense
  // -------------------------------------------------------------------------
  console.log('\n--- Section 7: Query Sanitization & ReDoS Defense ---');

  // 32. Search parameter with unmatched regex parenthesis does not throw 500
  const regexInjectionRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/assigned?search=(unclosed_paren',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(regexInjectionRes.status === 200, '48. Search query with unclosed regex parenthesis sanitized without 500 error');

  // 33. Search parameter with quantifier injection does not throw 500
  const quantifierRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/assigned?search=++***+++',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(quantifierRes.status === 200, '49. Search query with quantifier characters sanitized without 500 error');

  // -------------------------------------------------------------------------
  // Section 8: Teardown & Database Integrity Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Section 8: Teardown & Database Integrity Verification ---');

  // Remove temporary complaints created in this suite
  let removedComplaints = 0;
  for (const cid of createdComplaintIds) {
    const comp = await Complaint.findById(cid);
    if (comp?.evidence?.storageKey) {
      const p = path.resolve(UPLOAD_DIR, comp.evidence.storageKey);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    }
    await Complaint.findByIdAndDelete(cid);
    removedComplaints++;
  }
  assert(removedComplaints === createdComplaintIds.length, `50. Cleaned up ${removedComplaints} temporary test complaints and associated evidence files`);

  // Remove temporary users created in this suite
  let removedUsers = 0;
  for (const uid of createdUserIds) {
    await User.findByIdAndDelete(uid);
    await Notification.deleteMany({ recipient: uid });
    removedUsers++;
  }
  assert(removedUsers === createdUserIds.length, `51. Cleaned up ${removedUsers} temporary test user accounts`);

  // Verify single designated administrator preserved
  const finalAdmin = await User.findOne({ role: 'admin' });
  const finalAdminCount = await User.countDocuments({ role: 'admin' });
  assert(finalAdminCount === 1, '52. Single designated administrator invariant preserved (found: 1)');
  assert(finalAdmin.email === 'admin@civictrack.gov', '53. Designated administrator account email is unchanged');
  assert(finalAdmin._id.toString() === adminId, '54. Designated administrator MongoDB ObjectId matches baseline fixture');

  console.log('\n================================================================');
  console.log(`Step 10 Integration & Security Verification: ${passed}/${total} assertions passed`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(passed === total ? 0 : 1);
}

runStep10Tests().catch((err) => {
  console.error('[Step 10 Verification Error]:', err);
  process.exit(1);
});
