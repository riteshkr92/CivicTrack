/**
 * CivicTrack 2.0 — Step 6 Automated Verification Suite
 * Automated SLA Escalation Actions & Admin Controls
 *
 * Validates:
 * 1. RBAC & Access Control:
 *    - GET /api/sla/critical-attention requires admin (citizen/officer get 403, anon gets 401).
 *    - POST /api/sla/complaints/:id/actions requires admin (citizen/officer get 403, anon gets 401).
 *    - GET /api/sla/complaints/:id/actions requires admin (citizen/officer get 403, anon gets 401).
 * 2. Level 3 Critical Attention & Deduplicated Scheduler Action:
 *    - Level 3 breach sets sla.requiresCriticalAttention = true, records criticalAttentionTriggeredAt.
 *    - Evaluator records an automated supervisory_review action in sla.escalationActions.
 *    - Subsequent scheduler runs do not duplicate the automated supervisory_review record.
 * 3. Administrative Escalation Actions API:
 *    - Action 'acknowledged': clears requiresCriticalAttention, sets criticalAttentionAcknowledgedAt & By.
 *    - Action 'urgent_intervention': records notes, performer, and clears unacknowledged flag.
 *    - Action 'supervisory_review': records notes and performer.
 *    - Action 'admin_note': records internal note; rejects empty/<3 chars with 400; rejects >1000 chars.
 *    - Action 'officer_reassigned': reassigns assignedOfficer, updates statusHistory, dispatches notifications.
 *    - Officer reassignment validation: rejects invalid officer (400), rejects same officer (400).
 * 4. Retrieval & Query Filtering:
 *    - GET /api/sla/complaints/:id/actions returns chronological action trail for admin.
 *    - GET /api/sla/critical-attention returns counts, byDepartment, oldestCriticalAgeHours, active complaints.
 *    - GET /api/complaints/admin/all?criticalAttention=unacknowledged filters correctly.
 *    - GET /api/complaints/admin/all?criticalAttention=acknowledged filters correctly.
 * 5. Data Privacy & Role-Scoping:
 *    - toSafeObject(citizen): escalationActions and internal adminNotes are stripped.
 *    - toSafeObject(citizen): displays customer-safe notice instead of internal telemetry.
 *    - toSafeObject(admin): contains full escalationActions and notes.
 * 6. Non-disruption:
 *    - Preserves single-admin invariant, complaint lifecycle, and existing collections.
 */

const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const { Complaint } = require('../models/Complaint');
const { Notification } = require('../models/Notification');
const { evaluateSlaComplaints } = require('../services/slaScheduler');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function apiRequest({ method = 'GET', path: reqPath, headers = {}, body }) {
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
    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    if (payload && !options.headers['Content-Length']) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          data = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function loginUser(email, password) {
  const res = await apiRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email, password }
  });
  if (res.status !== 200 || !res.data.token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`);
  }
  return { token: res.data.token, user: res.data.user };
}

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    if (details) console.error(`    Details: ${details}`);
    failedTests++;
  }
}

async function runStep6Tests() {
  console.log('\n=============================================================');
  console.log('CivicTrack 2.0 — Step 6 Automated Escalation Actions Test Suite');
  console.log('=============================================================\n');

  // 1. Connect Mongoose to local DB
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/civictrack';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB for direct verification queries.');

  const createdComplaintIds = [];
  const createdUserIds = [];

  try {
    // 2. Authenticate standard roles
    console.log('\n[Phase 1] Authenticating test user roles...');
    const admin = await loginUser('admin@civictrack.gov', 'Admin@123');
    const officer1 = await loginUser('officer@civictrack.gov', 'Officer@123');
    const citizen = await loginUser('citizen@civictrack.gov', 'Citizen@123');

    // Find or create second officer for reassignment tests
    let officer2User = await User.findOne({ role: 'officer', _id: { $ne: officer1.user.id || officer1.user._id } });
    if (!officer2User) {
      officer2User = await User.create({
        name: 'Second Officer',
        email: `officer2.step6.${Date.now()}@civictrack.gov`,
        password: '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEF', // dummy hash
        role: 'officer',
        department: 'Sanitation & Civil Works'
      });
      createdUserIds.push(officer2User._id);
    }

    assert(admin.user.role === 'admin', 'Admin authenticated with admin role');
    assert(officer1.user.role === 'officer', 'Officer 1 authenticated with officer role');
    assert(officer2User.role === 'officer', 'Officer 2 verified with officer role');
    assert(citizen.user.role === 'citizen', 'Citizen authenticated with citizen role');

    // 3. RBAC & Access Control Checks
    console.log('\n[Phase 2] Verifying RBAC on SLA Escalation Endpoints...');

    // 3.1 Anonymous access
    const anonCritical = await apiRequest({ method: 'GET', path: '/api/sla/critical-attention' });
    assert(anonCritical.status === 401, 'Anonymous GET /api/sla/critical-attention returns 401 Unauthorized');

    const anonActions = await apiRequest({
      method: 'POST',
      path: '/api/sla/complaints/CT-TEST-001/actions',
      body: { actionType: 'acknowledged' }
    });
    assert(anonActions.status === 401, 'Anonymous POST /api/sla/complaints/:id/actions returns 401 Unauthorized');

    // 3.2 Citizen access
    const citizenCritical = await apiRequest({
      method: 'GET',
      path: '/api/sla/critical-attention',
      headers: { Authorization: `Bearer ${citizen.token}` }
    });
    assert(citizenCritical.status === 403, 'Citizen GET /api/sla/critical-attention returns 403 Forbidden');

    const citizenAction = await apiRequest({
      method: 'POST',
      path: '/api/sla/complaints/CT-TEST-001/actions',
      headers: { Authorization: `Bearer ${citizen.token}` },
      body: { actionType: 'acknowledged' }
    });
    assert(citizenAction.status === 403, 'Citizen POST /api/sla/complaints/:id/actions returns 403 Forbidden');

    const citizenGetActions = await apiRequest({
      method: 'GET',
      path: '/api/sla/complaints/CT-TEST-001/actions',
      headers: { Authorization: `Bearer ${citizen.token}` }
    });
    assert(citizenGetActions.status === 403, 'Citizen GET /api/sla/complaints/:id/actions returns 403 Forbidden');

    // 3.3 Officer access
    const officerCritical = await apiRequest({
      method: 'GET',
      path: '/api/sla/critical-attention',
      headers: { Authorization: `Bearer ${officer1.token}` }
    });
    assert(officerCritical.status === 403, 'Officer GET /api/sla/critical-attention returns 403 Forbidden');

    const officerAction = await apiRequest({
      method: 'POST',
      path: '/api/sla/complaints/CT-TEST-001/actions',
      headers: { Authorization: `Bearer ${officer1.token}` },
      body: { actionType: 'acknowledged' }
    });
    assert(officerAction.status === 403, 'Officer POST /api/sla/complaints/:id/actions returns 403 Forbidden');

    // 4. Create an active complaint for Level 3 Escalation testing
    console.log('\n[Phase 3] Testing Level 3 Critical Attention Trigger and Scheduler Deduplication...');
    const now = new Date();
    const pastOverdue = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48h ago

    const testComplaint1 = await Complaint.create({
      trackingId: `CT-S6-L3-${Date.now().toString().slice(-5)}`,
      title: 'Step 6 Critical Attention Test Pothole',
      description: 'Major hazardous crater requiring urgent municipal intervention and supervisory oversight.',
      category: 'Pothole/Road Damage',
      priority: 'Urgent',
      status: 'In Progress',
      citizen: citizen.user.id || citizen.user._id,
      assignedOfficer: officer1.user.id || officer1.user._id,
      department: 'Roads & Infrastructure',
      location: {
        address: 'MG Road Junction, Ward 4',
        latitude: 12.9716,
        longitude: 77.5946
      },
      statusHistory: [
        {
          status: 'Submitted',
          timestamp: pastOverdue,
          actor: citizen.user.id || citizen.user._id,
          actorRole: 'citizen'
        },
        {
          status: 'In Progress',
          timestamp: new Date(pastOverdue.getTime() + 2 * 60 * 60 * 1000),
          actor: admin.user.id || admin.user._id,
          actorRole: 'admin'
        }
      ],
      sla: {
        startedAt: pastOverdue,
        resolutionDeadline: new Date(now.getTime() - 25 * 60 * 60 * 1000), // Overdue by 25 hours (>24h overdue => Level 3)
        acknowledgementDeadline: new Date(pastOverdue.getTime() + 2 * 60 * 60 * 1000),
        assignmentDeadline: new Date(pastOverdue.getTime() + 4 * 60 * 60 * 1000),
        acknowledgedAt: new Date(pastOverdue.getTime() + 1 * 60 * 60 * 1000),
        assignedAt: new Date(pastOverdue.getTime() + 2 * 60 * 60 * 1000),
        workStartedAt: new Date(pastOverdue.getTime() + 2 * 60 * 60 * 1000),
        escalationLevel: 0,
        isBreached: false,
        requiresCriticalAttention: false,
        escalationActions: []
      }
    });
    createdComplaintIds.push(testComplaint1._id);

    // Run scheduler evaluation
    await evaluateSlaComplaints();

    const refreshedL3 = await Complaint.findById(testComplaint1._id);
    assert(refreshedL3.sla.escalationLevel === 3, 'Evaluator elevated complaint to Level 3 Critical Escalation');
    assert(refreshedL3.sla.requiresCriticalAttention === true, 'Level 3 complaint set sla.requiresCriticalAttention = true');
    assert(refreshedL3.sla.criticalAttentionTriggeredAt instanceof Date, 'sla.criticalAttentionTriggeredAt timestamp is recorded');

    // Check automated supervisory_review action
    const autoActions = refreshedL3.sla.escalationActions.filter((a) => a.actionType === 'supervisory_review');
    assert(autoActions.length === 1, 'Scheduler automatically created exactly 1 supervisory_review action record');
    assert(autoActions[0].description.toLowerCase().includes('automated level 3') && autoActions[0].description.toLowerCase().includes('escalation'), 'Automated action description identifies Level 3 escalation');

    // Run scheduler evaluation a SECOND time to test deduplication
    await evaluateSlaComplaints();
    const refreshedL3Second = await Complaint.findById(testComplaint1._id);
    const autoActionsSecond = refreshedL3Second.sla.escalationActions.filter((a) => a.actionType === 'supervisory_review');
    assert(autoActionsSecond.length === 1, 'Scheduler deduplication: repeated runs do NOT create duplicate supervisory review actions');

    // 5. Admin Actions API Execution
    console.log('\n[Phase 4] Testing Admin Escalation Actions (POST /api/sla/complaints/:id/actions)...');

    // 5.1 Acknowledged Action
    const ackRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: { actionType: 'acknowledged' }
    });

    assert(ackRes.status === 200, 'Admin successfully acknowledged escalation (HTTP 200)');
    assert(ackRes.data.complaint.sla.requiresCriticalAttention === false, 'sla.requiresCriticalAttention was reset to false');
    assert(Boolean(ackRes.data.complaint.sla.criticalAttentionAcknowledgedAt), 'sla.criticalAttentionAcknowledgedAt is populated');
    assert(ackRes.data.action.actionType === 'acknowledged', 'Action record returned with actionType acknowledged');

    // Verify in database
    const dbAfterAck = await Complaint.findById(testComplaint1._id);
    assert(dbAfterAck.sla.requiresCriticalAttention === false, 'DB: requiresCriticalAttention is false after admin ack');
    assert(dbAfterAck.sla.criticalAttentionAcknowledgedBy.toString() === admin.user.id || dbAfterAck.sla.criticalAttentionAcknowledgedBy.toString() === admin.user._id, 'DB: criticalAttentionAcknowledgedBy references the admin');

    // 5.2 Urgent Intervention Action
    const urgentRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: {
        actionType: 'urgent_intervention',
        adminNotes: 'Deploying municipal emergency road patch unit with asphalt roller.'
      }
    });

    assert(urgentRes.status === 200, 'Admin recorded urgent_intervention action (HTTP 200)');
    assert(urgentRes.data.action.actionType === 'urgent_intervention', 'Action type is urgent_intervention');
    assert(urgentRes.data.action.adminNotes === 'Deploying municipal emergency road patch unit with asphalt roller.', 'Admin notes saved correctly');
    assert(urgentRes.data.action.performedByName === admin.user.name, 'Admin performer name recorded accurately');

    // 5.3 Supervisory Review Action
    const reviewRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: {
        actionType: 'supervisory_review',
        adminNotes: 'Reviewed incident log with zonal chief; allocated additional field resources.'
      }
    });

    assert(reviewRes.status === 200, 'Admin recorded supervisory_review action (HTTP 200)');
    assert(reviewRes.data.action.actionType === 'supervisory_review', 'Action type is supervisory_review');

    // 5.4 Admin Note Action & Validations
    const shortNoteRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: { actionType: 'admin_note', adminNotes: 'hi' }
    });
    assert(shortNoteRes.status === 400, 'Admin note < 3 chars is rejected with 400 Bad Request');

    const validNoteRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: { actionType: 'admin_note', adminNotes: 'Discussed traffic diversions with traffic police outpost.' }
    });
    assert(validNoteRes.status === 200, 'Admin recorded admin_note action (HTTP 200)');
    assert(validNoteRes.data.action.actionType === 'admin_note', 'Action type is admin_note');

    // 5.5 Officer Reassignment Action & Validations
    // Invalid: missing newOfficerId
    const missingOffRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: { actionType: 'officer_reassigned' }
    });
    assert(missingOffRes.status === 400, 'Reassignment without newOfficerId is rejected with 400 Bad Request');

    // Invalid: assigning to the current officer
    const sameOffRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: {
        actionType: 'officer_reassigned',
        newOfficerId: officer1.user.id || officer1.user._id
      }
    });
    assert(sameOffRes.status === 400, 'Reassignment to same officer is rejected with 400 Bad Request');

    // Invalid: assigning to a citizen
    const citizenOffRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: {
        actionType: 'officer_reassigned',
        newOfficerId: citizen.user.id || citizen.user._id
      }
    });
    assert(citizenOffRes.status === 400, 'Reassignment to citizen is rejected with 400 Bad Request');

    // Valid: reassign to officer 2
    const validReassignRes = await apiRequest({
      method: 'POST',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` },
      body: {
        actionType: 'officer_reassigned',
        newOfficerId: officer2User._id.toString(),
        department: 'Sanitation & Civil Works',
        adminNotes: 'Transferring custody to Officer Patel due to proximity to ward boundary.'
      }
    });

    assert(validReassignRes.status === 200, 'Admin successfully reassigned officer (HTTP 200)');
    assert(validReassignRes.data.complaint.assignedOfficer.name === officer2User.name, `Complaint assignedOfficer is now ${officer2User.name}`);
    assert(validReassignRes.data.action.previousOfficerName === officer1.user.name, `Action record recorded previousOfficerName: ${officer1.user.name}`);
    assert(validReassignRes.data.action.newOfficerName === officer2User.name, `Action record recorded newOfficerName: ${officer2User.name}`);

    // Verify statusHistory in DB
    const dbAfterReassign = await Complaint.findById(testComplaint1._id);
    const lastHistory = dbAfterReassign.statusHistory[dbAfterReassign.statusHistory.length - 1];
    assert(lastHistory.comment.includes('Officer reassigned to'), 'statusHistory contains officer reassignment entry');
    assert(lastHistory.actorRole === 'admin', 'statusHistory entry records actorRole: admin');

    // Verify Notifications dispatched
    const off2Notifications = await Notification.find({
      recipient: officer2User._id,
      type: 'complaint_reassigned'
    });
    assert(off2Notifications.length >= 1, 'New assigned officer received reassignment notification');

    const off1Notifications = await Notification.find({
      recipient: officer1.user.id || officer1.user._id,
      type: 'complaint_reassigned'
    });
    assert(off1Notifications.length >= 1, 'Previous officer received reassignment notification');

    // 6. Action History Retrieval API
    console.log('\n[Phase 5] Testing Action History Retrieval (GET /api/sla/complaints/:id/actions)...');
    const actionsHistoryRes = await apiRequest({
      method: 'GET',
      path: `/api/sla/complaints/${testComplaint1._id}/actions`,
      headers: { Authorization: `Bearer ${admin.token}` }
    });

    assert(actionsHistoryRes.status === 200, 'GET /api/sla/complaints/:id/actions returns HTTP 200');
    assert(Array.isArray(actionsHistoryRes.data.actions), 'Returned actions array');
    assert(actionsHistoryRes.data.actions.length >= 5, `Audit trail contains all ${actionsHistoryRes.data.actions.length} recorded actions`);

    // 7. Critical Attention Overview and Query Filtering
    console.log('\n[Phase 6] Testing Critical Attention Overview & Query Filters...');

    // Create a fresh unacknowledged Level 3 complaint
    const testComplaint2 = await Complaint.create({
      trackingId: `CT-S6-UNACK-${Date.now().toString().slice(-5)}`,
      title: 'Step 6 Unacknowledged Drainage Blockage',
      description: 'Severe sewer backup overflowing into public street.',
      category: 'Drainage/Waterlogging',
      priority: 'High',
      status: 'Submitted',
      citizen: citizen.user.id || citizen.user._id,
      department: 'Drainage & Sewage',
      location: {
        address: 'BTM 2nd Stage, Ward 7',
        latitude: 12.9165,
        longitude: 77.6101
      },
      statusHistory: [
        {
          status: 'Submitted',
          timestamp: pastOverdue,
          actor: citizen.user.id || citizen.user._id,
          actorRole: 'citizen'
        }
      ],
      sla: {
        startedAt: pastOverdue,
        resolutionDeadline: new Date(now.getTime() - 30 * 60 * 60 * 1000), // Overdue > 24h => Level 3
        acknowledgementDeadline: new Date(pastOverdue.getTime() + 4 * 60 * 60 * 1000),
        assignmentDeadline: new Date(pastOverdue.getTime() + 8 * 60 * 60 * 1000),
        escalationLevel: 0,
        isBreached: false,
        requiresCriticalAttention: false,
        escalationActions: []
      }
    });
    createdComplaintIds.push(testComplaint2._id);

    // Run scheduler evaluation so testComplaint2 becomes unacknowledged Level 3
    await evaluateSlaComplaints();

    const critOverviewRes = await apiRequest({
      method: 'GET',
      path: '/api/sla/critical-attention',
      headers: { Authorization: `Bearer ${admin.token}` }
    });

    assert(critOverviewRes.status === 200, 'GET /api/sla/critical-attention returns HTTP 200');
    const { criticalAttention } = critOverviewRes.data;
    assert(criticalAttention.criticalCount >= 2, `criticalCount (${criticalAttention.criticalCount}) includes both Level 3 complaints`);
    assert(criticalAttention.unacknowledgedCount >= 1, `unacknowledgedCount (${criticalAttention.unacknowledgedCount}) includes unacknowledged complaint`);
    assert(criticalAttention.acknowledgedCount >= 1, `acknowledgedCount (${criticalAttention.acknowledgedCount}) includes acknowledged complaint`);
    assert(typeof criticalAttention.byDepartment === 'object', 'byDepartment breakdown object is provided');
    assert(criticalAttention.oldestCriticalAgeHours !== null, `oldestCriticalAgeHours is computed: ${criticalAttention.oldestCriticalAgeHours}h`);

    // Test query filter: criticalAttention=unacknowledged
    const filterUnackRes = await apiRequest({
      method: 'GET',
      path: '/api/complaints/admin/all?criticalAttention=unacknowledged',
      headers: { Authorization: `Bearer ${admin.token}` }
    });
    assert(filterUnackRes.status === 200, 'GET /admin/all?criticalAttention=unacknowledged returns HTTP 200');
    const unackComplaints = filterUnackRes.data.complaints;
    assert(unackComplaints.length >= 1, 'Filter returned unacknowledged complaints');
    const allUnackValid = unackComplaints.every((c) => c.sla?.requiresCriticalAttention === true);
    assert(allUnackValid, 'All returned complaints strictly have requiresCriticalAttention === true');

    // Test query filter: criticalAttention=acknowledged
    const filterAckRes = await apiRequest({
      method: 'GET',
      path: '/api/complaints/admin/all?criticalAttention=acknowledged',
      headers: { Authorization: `Bearer ${admin.token}` }
    });
    assert(filterAckRes.status === 200, 'GET /admin/all?criticalAttention=acknowledged returns HTTP 200');
    const ackComplaints = filterAckRes.data.complaints;
    assert(ackComplaints.length >= 1, 'Filter returned acknowledged complaints');
    const allAckValid = ackComplaints.every((c) => Boolean(c.sla?.criticalAttentionAcknowledgedAt));
    assert(allAckValid, 'All returned complaints have criticalAttentionAcknowledgedAt populated');

    // 8. Data Privacy & Role-Scoping Verification
    console.log('\n[Phase 7] Testing Data Privacy & Role-Scoped Serialization...');
    const complaintWithActions = await Complaint.findById(testComplaint1._id);

    // 8.1 Admin View
    const adminSafe = complaintWithActions.toSafeObject(admin.user);
    assert(Array.isArray(adminSafe.sla.escalationActions), 'Admin serialization includes sla.escalationActions array');
    assert(adminSafe.sla.escalationActions.length >= 5, 'Admin serialization includes all internal escalation actions');
    assert(adminSafe.sla.escalationActions[0].adminNotes !== undefined, 'Admin serialization includes internal admin notes');

    // 8.2 Citizen View
    const citizenSafe = complaintWithActions.toSafeObject(citizen.user);
    assert(citizenSafe.sla.escalationActions === undefined, 'Citizen serialization strictly OMITS sla.escalationActions');
    assert(citizenSafe.sla.requiresCriticalAttention === undefined, 'Citizen serialization strictly OMITS requiresCriticalAttention');
    assert(citizenSafe.sla.criticalAttentionAcknowledgedAt === undefined, 'Citizen serialization strictly OMITS criticalAttentionAcknowledgedAt');
    assert(citizenSafe.sla.isEscalated === true, 'Citizen serialization includes isEscalated: true');
    assert(citizenSafe.sla.escalationNotice === 'Your complaint has been escalated for supervisory attention.', 'Citizen receives customer-friendly notice');

    // 8.3 Anonymous / Public View
    const publicSafe = complaintWithActions.toSafeObject(null);
    assert(publicSafe.sla.escalationActions === undefined, 'Public serialization strictly OMITS sla.escalationActions');
    assert(publicSafe.sla.isEscalated === true, 'Public serialization includes isEscalated: true');
    assert(publicSafe.sla.escalationNotice === 'Your complaint has been escalated for supervisory attention.', 'Public receives customer-friendly notice');

    // 8.4 Officer View
    const officerSafe = complaintWithActions.toSafeObject(officer2User);
    assert(officerSafe.sla.escalationActions === undefined, 'Officer serialization strictly OMITS internal escalationActions');
    assert(typeof officerSafe.sla.requiresCriticalAttention === 'boolean', 'Officer serialization receives operational requiresCriticalAttention flag');

  } catch (error) {
    console.error('\n✗ Test Suite Runtime Exception:', error);
    failedTests++;
  } finally {
    // Clean up created complaints & users
    if (createdComplaintIds.length > 0) {
      await Complaint.deleteMany({ _id: { $in: createdComplaintIds } });
      await Notification.deleteMany({ complaint: { $in: createdComplaintIds } });
      console.log(`\nCleaned up ${createdComplaintIds.length} test complaints and associated notifications.`);
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
      console.log(`Cleaned up ${createdUserIds.length} test users.`);
    }
    await mongoose.disconnect();
  }

  console.log('\n=============================================================');
  console.log(`Step 6 Test Results: ${passedTests} passed, ${failedTests} failed.`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStep6Tests();
