const http = require('http');

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

async function runTests() {
  console.log('====================================================');
  console.log('CivicTrack — Step 6 Dashboard Visibility Verification');
  console.log('====================================================\n');

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

  // 1. Health check
  console.log('1. Backend Server Health Check:');
  const healthRes = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/health',
    method: 'GET'
  });
  assert(healthRes.status === 200 && healthRes.body.services?.database === 'connected', 'Backend is online and connected to MongoDB');

  // 2. Citizen Verification
  console.log('\n2. Citizen Account Verification (citizen@civictrack.gov):');
  const citizenLogin = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'citizen@civictrack.gov', password: 'Citizen@123' });

  assert(citizenLogin.status === 200, `Citizen login status 200 (Got ${citizenLogin.status})`);
  assert(citizenLogin.body?.user?.role === 'citizen', `Citizen role confirmed: ${citizenLogin.body?.user?.role}`);
  const citizenToken = citizenLogin.body?.token;

  // Session restoration test
  const citizenMe = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${citizenToken}` }
  });
  assert(citizenMe.status === 200 && citizenMe.body?.user?.role === 'citizen', 'Session restore via GET /api/auth/me succeeds with citizen role');

  // Citizen authorized endpoints
  const citizenComplaints = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/complaints/my',
    method: 'GET',
    headers: { Authorization: `Bearer ${citizenToken}` }
  });
  assert(citizenComplaints.status === 200, 'Citizen can access GET /api/complaints/my');

  // Citizen unauthorized endpoints
  const citizenForbiddenOfficer = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/complaints/assigned',
    method: 'GET',
    headers: { Authorization: `Bearer ${citizenToken}` }
  });
  assert(citizenForbiddenOfficer.status === 403, 'Citizen blocked from officer queue with 403 Forbidden');

  const citizenForbiddenAdmin = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/complaints/admin/all',
    method: 'GET',
    headers: { Authorization: `Bearer ${citizenToken}` }
  });
  assert(citizenForbiddenAdmin.status === 403, 'Citizen blocked from admin queue with 403 Forbidden');

  // 3. Officer Verification
  console.log('\n3. Officer Account Verification (officer@civictrack.gov):');
  const officerLogin = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'officer@civictrack.gov', password: 'Officer@123' });

  assert(officerLogin.status === 200, `Officer login status 200 (Got ${officerLogin.status})`);
  assert(officerLogin.body?.user?.role === 'officer', `Officer role confirmed: ${officerLogin.body?.user?.role}`);
  const officerToken = officerLogin.body?.token;

  // Session restoration
  const officerMe = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerMe.status === 200 && officerMe.body?.user?.role === 'officer', 'Session restore via GET /api/auth/me succeeds with officer role');
  assert(officerMe.body?.user?.department === 'Roads & Infrastructure', `Officer department verified: ${officerMe.body?.user?.department}`);

  // Officer authorized endpoints
  const officerQueue = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/complaints/assigned',
    method: 'GET',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerQueue.status === 200, 'Officer can access GET /api/complaints/assigned');

  const officerSummary = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/complaints/assigned/summary',
    method: 'GET',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerSummary.status === 200, 'Officer can access GET /api/complaints/assigned/summary');

  // Officer unauthorized endpoints
  const officerForbiddenAdmin = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/complaints/admin/all',
    method: 'GET',
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  assert(officerForbiddenAdmin.status === 403, 'Officer blocked from admin queue with 403 Forbidden');

  // 4. Administrator Verification
  console.log('\n4. Administrator Account Verification (admin@civictrack.gov):');
  const adminLogin = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@civictrack.gov', password: 'Admin@123' });

  assert(adminLogin.status === 200, `Admin login status 200 (Got ${adminLogin.status})`);
  assert(adminLogin.body?.user?.role === 'admin', `Admin role confirmed: ${adminLogin.body?.user?.role}`);
  const adminToken = adminLogin.body?.token;

  // Session restoration
  const adminMe = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminMe.status === 200 && adminMe.body?.user?.role === 'admin', 'Session restore via GET /api/auth/me succeeds with admin role');

  // Admin authorized endpoints
  const adminAll = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/complaints/admin/all',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminAll.status === 200, 'Admin can access GET /api/complaints/admin/all');

  const adminOfficers = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/complaints/admin/officers',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminOfficers.status === 200, 'Admin can access GET /api/complaints/admin/officers');

  // 5. Invalid / Tampered Session Handling
  console.log('\n5. Tampered Session & Security Tests:');
  const invalidSession = await request({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.signature' }
  });
  assert(invalidSession.status === 401, 'Tampered token rejected with 401 Unauthorized');

  console.log(`\n====================================================`);
  console.log(`Results: ${passed} / ${total} assertions passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`====================================================`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
