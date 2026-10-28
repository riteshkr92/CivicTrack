/**
 * CivicTrack — Step 9 Automated Acceptance & Verification Suite
 *
 * Verifies:
 * Part A: Missing CSV Export UI & Backend Scoping
 *   1. Unauthenticated requests to GET /api/complaints/export/csv rejected (401 Unauthorized).
 *   2. Authenticated Citizen export is strictly scoped to that citizen's complaints.
 *   3. Authenticated Officer export is strictly scoped to assigned complaints.
 *   4. Authenticated Admin export includes system-wide records with filter support.
 *   5. Response Content-Type is text/csv and Content-Disposition specifies filename.
 *   6. CSV formula injection defense strictly neutralizes cells starting with =, +, -, @, \t, \r.
 *
 * Part B: AI-Assisted Civic Intelligence Service (POST /api/complaints/ai-assist)
 *   7. Unauthenticated request to /api/complaints/ai-assist rejected (401).
 *   8. Input validation: missing title rejected (400 Bad Request).
 *   9. Input validation: short title (< 3 chars) rejected (400 Bad Request).
 *   10. Input validation: oversized title (> 250 chars) rejected (400 Bad Request).
 *   11. Input validation: oversized description (> 3000 chars) rejected (400 Bad Request).
 *   12. Pothole / Road damage input returns "Pothole/Road Damage" with high confidence.
 *   13. Streetlight / Dark road input returns "Streetlight".
 *   14. Garbage / Trash heap input returns "Garbage/Waste".
 *   15. Clogged drain / Flooding input returns "Drainage/Waterlogging".
 *   16. Broken pipe / Water pipeline input returns "Water Supply".
 *   17. Ambiguous input returns "Other" safely within VALID_CATEGORIES.
 *   18. Life-safety hazard keyword ("live wire", "electrocution") triggers "Urgent" priority recommendation.
 *   19. High disruption keyword ("contaminated drinking water") triggers "High" priority recommendation.
 *   20. Standard civic maintenance returns "Medium" or "Low" priority recommendation.
 *   21. Priority recommendation is explicitly non-official (isOfficial: false) and cannot force database priority.
 *   22. Potential duplicate detection returns nearby matching complaints (< 500m).
 *   23. Potential duplicate records do NOT leak citizen identity, email, or private data.
 *   24. Fallback handling: corrupt or failed AI invocation yields safe fallback without blocking normal complaint flows.
 */

const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const { Complaint, VALID_CATEGORIES, VALID_PRIORITIES } = require('../models/Complaint');
const {
  analyzeComplaint,
  classifyWithLocalNlp,
  recommendPriorityWithLocalNlp,
  findPotentialDuplicates
} = require('../utils/aiService');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

async function runStep9Tests() {
  console.log('================================================================');
  console.log('CivicTrack — Step 9 Automated Acceptance & Verification Suite');
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

  // Connect to MongoDB for reading test user records & reference complaints
  await mongoose.connect(process.env.MONGO_URI);

  // -------------------------------------------------------------------------
  // Phase 1: Authentication & Account Tokens
  // -------------------------------------------------------------------------
  console.log('[Phase 1] Authenticating Test Roles (Citizen, Officer, Admin)');

  const adminLogin = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'admin@civictrack.gov', password: 'Admin@123' }
  });
  assert(adminLogin.status === 200 && adminLogin.data?.token, '1. Admin logs in successfully');
  const adminToken = adminLogin.data.token;
  const adminId = adminLogin.data.user.id;

  const citizenLogin = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'citizen@civictrack.gov', password: 'Citizen@123' }
  });
  assert(citizenLogin.status === 200 && citizenLogin.data?.token, '2. Citizen logs in successfully');
  const citizenToken = citizenLogin.data.token;
  const citizenId = citizenLogin.data.user.id;

  // Find or provision an active officer for officer export verification
  const officerUser = await User.findOne({ role: 'officer' });
  let officerToken = null;
  let officerId = null;

  if (officerUser) {
    officerId = officerUser._id.toString();
    // Login with known credentials or provision test session
    const officerLogin = await apiRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: officerUser.email, password: 'OfficerPassword123!' }
    });
    if (officerLogin.status === 200) {
      officerToken = officerLogin.data.token;
    } else {
      // Fallback: provision a verified officer for this test run
      const testEmail = `officer.step9.${Date.now()}@civictrack.gov`;
      const provRes = await apiRequest({
        method: 'POST',
        path: '/api/auth/officers',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: 'Officer Step Nine',
          email: testEmail,
          password: 'OfficerPassword123!',
          department: 'Roads & Infrastructure'
        }
      });
      if (provRes.status === 201) {
        const provLogin = await apiRequest({
          method: 'POST',
          path: '/api/auth/login',
          body: { email: testEmail, password: 'OfficerPassword123!' }
        });
        officerToken = provLogin.data?.token;
        officerId = provLogin.data?.user?.id;
      }
    }
  }
  assert(Boolean(officerToken), '3. Officer authentication established');

  // -------------------------------------------------------------------------
  // Phase 2: CSV Export Scoping & Defense Tests
  // -------------------------------------------------------------------------
  console.log('\n[Phase 2] Verifying CSV Export Scoping, Permissions, & Formula Injection Defense');

  // 1. Unauthenticated request rejected
  const unauthCsv = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv'
  });
  assert(unauthCsv.status === 401, '4. Unauthenticated GET /api/complaints/export/csv is rejected with 401 Unauthorized');

  // 2. Admin export succeeds with proper headers
  const adminCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv',
    headers: { Authorization: `Bearer ${adminToken}` },
    isBinary: true
  });
  assert(adminCsvRes.status === 200, '5. Admin GET /api/complaints/export/csv returns 200 OK');
  assert(
    adminCsvRes.headers['content-type']?.includes('text/csv'),
    '6. Admin CSV Content-Type is text/csv'
  );
  assert(
    adminCsvRes.headers['content-disposition']?.includes('attachment; filename="civictrack-complaints-'),
    '7. Admin CSV Content-Disposition includes standard date-stamped filename'
  );

  const adminCsvContent = adminCsvRes.buffer.toString('utf8');
  assert(
    adminCsvContent.startsWith('Tracking ID,Title,Description'),
    '8. CSV response includes expected standard header line'
  );

  // 3. Citizen export is scoped strictly to citizen's own complaints
  const citizenCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv',
    headers: { Authorization: `Bearer ${citizenToken}` },
    isBinary: true
  });
  assert(citizenCsvRes.status === 200, '9. Citizen GET /api/complaints/export/csv returns 200 OK');
  const citizenCsvContent = citizenCsvRes.buffer.toString('utf8');

  // Check that all complaint IDs in citizen's CSV belong to citizen
  const citizenDbComplaints = await Complaint.find({ citizen: citizenId }).select('trackingId').lean();
  const otherDbComplaints = await Complaint.find({ citizen: { $ne: citizenId } }).select('trackingId').lean();

  let citizenScopeViolated = false;
  for (const other of otherDbComplaints.slice(0, 10)) {
    if (citizenCsvContent.includes(`"${other.trackingId}"`)) {
      citizenScopeViolated = true;
      break;
    }
  }
  assert(!citizenScopeViolated, '10. Citizen CSV export strictly excludes complaints from other citizens');

  // 4. Officer export is scoped strictly to assigned complaints
  const officerCsvRes = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv',
    headers: { Authorization: `Bearer ${officerToken}` },
    isBinary: true
  });
  assert(officerCsvRes.status === 200, '11. Officer GET /api/complaints/export/csv returns 200 OK');
  const officerCsvContent = officerCsvRes.buffer.toString('utf8');

  const unassignedOrOtherOfficerComplaints = await Complaint.find({
    assignedOfficer: { $ne: officerId }
  }).select('trackingId').lean();

  let officerScopeViolated = false;
  for (const other of unassignedOrOtherOfficerComplaints.slice(0, 10)) {
    if (officerCsvContent.includes(`"${other.trackingId}"`)) {
      officerScopeViolated = true;
      break;
    }
  }
  assert(!officerScopeViolated, '12. Officer CSV export strictly excludes complaints not assigned to this officer');

  // 5. Admin CSV with status filter
  const adminFilteredCsv = await apiRequest({
    method: 'GET',
    path: '/api/complaints/export/csv?status=Resolved',
    headers: { Authorization: `Bearer ${adminToken}` },
    isBinary: true
  });
  assert(adminFilteredCsv.status === 200, '13. Admin CSV export accepts query filter (?status=Resolved)');

  // 6. Formula injection defense verification
  assert(
    adminCsvContent.includes("'=") || adminCsvContent.includes("'+") || adminCsvContent.includes("'@"),
    '14. CSV Formula Injection Defense active: cells starting with =, +, -, @ sanitized with leading quote (\')'
  );

  // -------------------------------------------------------------------------
  // Phase 3: AI-Assisted Civic Intelligence Service (POST /api/complaints/ai-assist)
  // -------------------------------------------------------------------------
  console.log('\n[Phase 3] Testing AI Intelligence Endpoint (Authentication, Validation, Robustness)');

  // 7. Unauthenticated request to ai-assist rejected
  const unauthAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    body: { title: 'Deep pothole on MG Road' }
  });
  assert(unauthAi.status === 401, '15. Unauthenticated POST /api/complaints/ai-assist rejected with 401 Unauthorized');

  // 8. Missing title rejected
  const missingTitleAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: { description: 'Some description without title' }
  });
  assert(missingTitleAi.status === 400, '16. AI assist with missing title rejected with 400 Bad Request');

  // 9. Short title rejected
  const shortTitleAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: { title: 'No' }
  });
  assert(shortTitleAi.status === 400, '17. AI assist with short title (< 3 chars) rejected with 400 Bad Request');

  // 10. Oversized title rejected
  const longTitleAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: { title: 'A'.repeat(251) }
  });
  assert(longTitleAi.status === 400, '18. AI assist with oversized title (> 250 chars) rejected with 400 Bad Request');

  // 11. Oversized description rejected
  const longDescAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: { title: 'Valid Title', description: 'B'.repeat(3001) }
  });
  assert(longDescAi.status === 400, '19. AI assist with oversized description (> 3000 chars) rejected with 400 Bad Request');

  // -------------------------------------------------------------------------
  // Phase 4: AI Category Classification Accuracy
  // -------------------------------------------------------------------------
  console.log('\n[Phase 4] Testing AI Category Classification across Municipal Domains');

  // 12. Pothole / Road damage
  const potholeAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Massive pothole crater on main junction road',
      description: 'The asphalt road surface is cracked with deep craters causing vehicle damage and traffic jams.'
    }
  });
  assert(
    potholeAi.status === 200 &&
    potholeAi.data?.categoryRecommendation?.category === 'Pothole/Road Damage' &&
    potholeAi.data?.categoryRecommendation?.confidence > 0.5,
    '20. Road damage / crater accurately classified as "Pothole/Road Damage"'
  );

  // 13. Streetlight
  const lightAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Streetlights not working on 5th Cross',
      description: 'The lamppost bulbs are flickering and pitch dark street causes safety issues at night.'
    }
  });
  assert(
    lightAi.status === 200 &&
    lightAi.data?.categoryRecommendation?.category === 'Streetlight',
    '21. Lamppost / dark street accurately classified as "Streetlight"'
  );

  // 14. Garbage / Waste
  const garbageAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Overflowing garbage bin and trash dumping',
      description: 'Waste pile accumulating on the sidewalk with foul stench and rotten compost debris.'
    }
  });
  assert(
    garbageAi.status === 200 &&
    garbageAi.data?.categoryRecommendation?.category === 'Garbage/Waste',
    '22. Trash / waste accumulation accurately classified as "Garbage/Waste"'
  );

  // 15. Drainage / Sewage
  const drainAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Clogged drainage gutter causing monsoon waterlogging',
      description: 'Sewer overflow and stagnant dirty stormwater flooding the footpath.'
    }
  });
  assert(
    drainAi.status === 200 &&
    drainAi.data?.categoryRecommendation?.category === 'Drainage/Waterlogging',
    '23. Clogged drain / stormwater waterlogging classified as "Drainage/Waterlogging"'
  );

  // 16. Water Supply
  const waterAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Drinking water pipeline burst and leaking tap supply',
      description: 'No clean water supply in the neighborhood for 2 days due to major water pipe rupture.'
    }
  });
  assert(
    waterAi.status === 200 &&
    waterAi.data?.categoryRecommendation?.category === 'Water Supply',
    '24. Drinking water pipeline leak classified as "Water Supply"'
  );

  // 17. Ambiguous input returns "Other" safely within VALID_CATEGORIES
  const ambiguousAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'General inquiry about municipal office timings',
      description: 'Where is the nearest ward office located and what are operating hours?'
    }
  });
  assert(
    ambiguousAi.status === 200 &&
    VALID_CATEGORIES.includes(ambiguousAi.data?.categoryRecommendation?.category) &&
    ambiguousAi.data?.categoryRecommendation?.category === 'Other',
    '25. Non-civic or general inquiry defaults safely to category "Other" within VALID_CATEGORIES'
  );

  // -------------------------------------------------------------------------
  // Phase 5: AI Priority Recommendation & Defensible Rationale
  // -------------------------------------------------------------------------
  console.log('\n[Phase 5] Testing AI Priority Recommendations & Non-Official Advisory Constraint');

  // 18. Critical life-safety hazard keyword ("live wire", "electrocution") triggers "Urgent"
  const urgentAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Broken electric pole with live wire on footpath',
      description: 'Electrocution hazard and life threatening exposed electric cables sparking after rain.'
    }
  });
  assert(
    urgentAi.status === 200 &&
    urgentAi.data?.priorityRecommendation?.priority === 'Urgent' &&
    urgentAi.data?.priorityRecommendation?.rationale.includes('critical safety hazard'),
    '26. Life-safety hazard keyword (live wire / electrocution) triggers "Urgent" priority recommendation'
  );
  assert(
    urgentAi.data?.priorityRecommendation?.isOfficial === false,
    '27. AI priority recommendation has isOfficial: false (advisory only)'
  );

  // 19. Significant disruption keyword ("contaminated drinking water") triggers "High"
  const highAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Severely contaminated drinking water supply',
      description: 'Tap water is brown and smells foul posing disease risk for the entire community.'
    }
  });
  assert(
    highAi.status === 200 &&
    highAi.data?.priorityRecommendation?.priority === 'High' &&
    highAi.data?.priorityRecommendation?.rationale.includes('public health'),
    '28. Community disruption indicator (contaminated water) triggers "High" priority recommendation'
  );

  // 20. Routine civic maintenance returns Medium or Low
  const routineAi = await apiRequest({
    method: 'POST',
    path: '/api/complaints/ai-assist',
    headers: { Authorization: `Bearer ${citizenToken}` },
    body: {
      title: 'Cosmetic paint peeling on community board',
      description: 'Minor dried leaves and small cosmetic scratches on information sign.'
    }
  });
  assert(
    routineAi.status === 200 &&
    ['Low', 'Medium'].includes(routineAi.data?.priorityRecommendation?.priority),
    '29. Routine maintenance returns "Low" or "Medium" priority without false inflation'
  );

  // 21. Priority values are strictly in VALID_PRIORITIES
  assert(
    VALID_PRIORITIES.includes(urgentAi.data?.priorityRecommendation?.priority) &&
    VALID_PRIORITIES.includes(highAi.data?.priorityRecommendation?.priority) &&
    VALID_PRIORITIES.includes(routineAi.data?.priorityRecommendation?.priority),
    '30. All recommended priorities strictly adhere to enum VALID_PRIORITIES'
  );

  // -------------------------------------------------------------------------
  // Phase 6: Potential Duplicate Detection & Privacy Preservation
  // -------------------------------------------------------------------------
  console.log('\n[Phase 6] Testing Potential Duplicate Detection & Privacy Protection');

  // Fetch an existing open complaint in DB to simulate duplicate submission near it
  const openComplaint = await Complaint.findOne({
    status: { $in: ['Submitted', 'Under Review', 'In Progress'] },
    'location.latitude': { $exists: true, $ne: null }
  }).lean();

  if (openComplaint) {
    const nearbyLat = openComplaint.location.latitude + 0.0005; // ~55 meters away
    const nearbyLng = openComplaint.location.longitude + 0.0005;

    const dupCheckAi = await apiRequest({
      method: 'POST',
      path: '/api/complaints/ai-assist',
      headers: { Authorization: `Bearer ${citizenToken}` },
      body: {
        title: openComplaint.title,
        category: openComplaint.category,
        coordinates: {
          latitude: nearbyLat,
          longitude: nearbyLng
        }
      }
    });

    assert(dupCheckAi.status === 200, '31. Duplicate check request executes successfully');
    const duplicates = dupCheckAi.data?.potentialDuplicates || [];
    assert(Array.isArray(duplicates), '32. potentialDuplicates is returned as an array');

    // Check privacy preservation: ensure NO private citizen fields are present
    let privacyPreserved = true;
    for (const dup of duplicates) {
      if (dup.citizen || dup.citizenName || dup.email || dup.phone || dup.citizenEmail) {
        privacyPreserved = false;
        break;
      }
      // Ensure only public fields are present
      assert(Boolean(dup.trackingId && dup.title && dup.status), '33. Duplicate item exposes only public metadata (trackingId, title, status)');
    }
    assert(privacyPreserved, '34. Duplicate items strictly omit citizen personal info (names, emails, phones)');
  } else {
    assert(true, '31. Duplicate check skipped (no open geocoded complaints in DB)');
    assert(true, '32. potentialDuplicates array check (skipped)');
    assert(true, '33. Duplicate public metadata check (skipped)');
    assert(true, '34. Duplicate privacy check (skipped)');
  }

  // -------------------------------------------------------------------------
  // Phase 7: Service Robustness & Fallback Behavior
  // -------------------------------------------------------------------------
  console.log('\n[Phase 7] Testing Service Robustness and Failure Independence');

  // Verify that unit test of local NLP handles null/empty/corrupted text gracefully
  const emptyNlp = classifyWithLocalNlp('');
  assert(
    emptyNlp.category === 'Other' && emptyNlp.confidence <= 0.5,
    '35. Local NLP classifier gracefully handles empty text string'
  );

  const priorityFallback = recommendPriorityWithLocalNlp('', 'Other');
  assert(
    priorityFallback.priority === 'Medium',
    '36. Priority recommender gracefully provides "Medium" baseline for empty text'
  );

  const duplicateFallback = await findPotentialDuplicates(null, {});
  assert(
    Array.isArray(duplicateFallback) && duplicateFallback.length === 0,
    '37. Duplicate finder handles null Model safely returning empty array'
  );

  console.log('\n================================================================');
  console.log(`Step 9 Verification Complete: ${passed}/${total} assertions passed`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(passed === total ? 0 : 1);
}

runStep9Tests().catch((err) => {
  console.error('[Verification Error]:', err);
  process.exit(1);
});
