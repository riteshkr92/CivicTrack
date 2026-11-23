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
  console.log('CivicTrack — Step 11 Settings & Profile Verification');
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

  try {
    // 1. Health check
    console.log('1. Backend Server Health Check:');
    const healthRes = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/health',
      method: 'GET'
    });
    assert(healthRes.status === 200 && healthRes.body.services?.database === 'connected', 'Backend is online and connected to MongoDB');

    // 2. Authentication for all 3 roles
    console.log('\n2. User Authentication:');
    const citizenLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'citizen@civictrack.gov', password: 'Citizen@123' });
    assert(citizenLogin.status === 200, 'Citizen login succeeded');
    const citizenToken = citizenLogin.body?.token;

    const officerLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'officer@civictrack.gov', password: 'Officer@123' });
    assert(officerLogin.status === 200, 'Officer login succeeded');
    const officerToken = officerLogin.body?.token;

    const adminLogin = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@civictrack.gov', password: 'Admin@123' });
    assert(adminLogin.status === 200, 'Admin login succeeded');
    const adminToken = adminLogin.body?.token;

    // 3. GET /api/auth/profile for Citizen, Officer, Admin
    console.log('\n3. GET /api/auth/profile:');
    const citizenProfile = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(citizenProfile.status === 200, 'Citizen profile fetched successfully');
    assert(citizenProfile.body?.user?.role === 'citizen', 'Citizen profile has role: citizen');
    assert(citizenProfile.body?.user?.notificationPreferences !== undefined, 'Citizen profile includes notificationPreferences');

    const officerProfile = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${officerToken}` }
    });
    assert(officerProfile.status === 200, 'Officer profile fetched successfully');
    assert(officerProfile.body?.user?.role === 'officer', 'Officer profile has role: officer');
    assert(officerProfile.body?.user?.department === 'Roads & Infrastructure', 'Officer profile has correct department');

    const adminProfile = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminProfile.status === 200, 'Admin profile fetched successfully');
    assert(adminProfile.body?.user?.role === 'admin', 'Admin profile has role: admin');
    assert(adminProfile.body?.user?.email === 'admin@civictrack.gov', 'Admin profile email is admin@civictrack.gov');

    // 4. PATCH /api/auth/profile - Permitted Updates
    console.log('\n4. Permitted Profile Updates:');
    const updateCitizen = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, {
      name: 'John Citizen (Updated)',
      phone: '+91 98765 43210',
      address: 'Ward 14, Main Road, City Central'
    });
    assert(updateCitizen.status === 200, 'Citizen can update permitted fields (name, phone, address)');
    assert(updateCitizen.body?.user?.phone === '+91 98765 43210', 'Updated phone is reflected');
    assert(updateCitizen.body?.user?.address === 'Ward 14, Main Road, City Central', 'Updated address is reflected');

    // Restore Citizen name
    await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, {
      name: 'John Citizen',
      phone: '+91 98765 43210',
      address: 'Ward 14, Main Road, City Central'
    });

    // 5. Strict Security Guards & Invariants
    console.log('\n5. Strict Security Guards & Invariant Enforcement:');

    // 5.1 Role escalation prevention
    const escalateRole = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, { role: 'admin' });
    assert(escalateRole.status === 403, 'Role escalation attempt rejected with 403 Forbidden');

    // 5.2 Department tampering prevention
    const tamperDept = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, { department: 'Police & Public Safety' });
    assert(tamperDept.status === 403, 'Officer department modification rejected with 403 Forbidden');

    // 5.3 EmployeeId tampering prevention
    const tamperEmpId = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      }
    }, { employeeId: 'EMP-FAKE-999' });
    assert(tamperEmpId.status === 403, 'Officer employee ID modification rejected with 403 Forbidden');

    // 5.4 Admin email immutability invariant
    const tamperAdminEmail = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      }
    }, {
      email: 'hacked_admin@civictrack.gov',
      currentPassword: 'Admin@123'
    });
    assert(tamperAdminEmail.status === 403, 'Admin email immutability enforced with 403 Forbidden');

    // 6. Safe Email Update Validation
    console.log('\n6. Safe Email Update Validation:');

    // 6.1 Email update missing password
    const emailNoPass = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, { email: 'newemail@civictrack.gov' });
    assert(emailNoPass.status === 400, 'Email change without current password rejected with 400 Bad Request');

    // 6.2 Email update with invalid password
    const emailWrongPass = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, { email: 'newemail@civictrack.gov', currentPassword: 'WrongPassword@123' });
    assert(emailWrongPass.status === 401, 'Email change with wrong password rejected with 401 Unauthorized');

    // 6.3 Email update collision
    const emailCollision = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/profile',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, { email: 'officer@civictrack.gov', currentPassword: 'Citizen@123' });
    assert(emailCollision.status === 409, 'Email change collision with existing user rejected with 409 Conflict');

    // 7. Password Management (PATCH /api/auth/change-password)
    console.log('\n7. Password Management (PATCH /api/auth/change-password):');

    // 7.1 Missing fields
    const passMissing = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/change-password',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, { currentPassword: 'Citizen@123' });
    assert(passMissing.status === 400, 'Password change with missing fields rejected with 400');

    // 7.2 Password mismatch
    const passMismatch = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/change-password',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, {
      currentPassword: 'Citizen@123',
      newPassword: 'NewPassword@123',
      confirmPassword: 'DifferentPassword@123'
    });
    assert(passMismatch.status === 400, 'Password mismatch rejected with 400');

    // 7.3 Wrong current password
    const passWrongCurrent = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/change-password',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, {
      currentPassword: 'IncorrectPassword@999',
      newPassword: 'NewPassword@123',
      confirmPassword: 'NewPassword@123'
    });
    assert(passWrongCurrent.status === 400, 'Incorrect current password rejected with 400');

    // 7.4 New password same as current
    const passSame = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/change-password',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, {
      currentPassword: 'Citizen@123',
      newPassword: 'Citizen@123',
      confirmPassword: 'Citizen@123'
    });
    assert(passSame.status === 400, 'Same new and current password rejected with 400');

    // 7.5 End-to-end Password Change & Reversion
    const passChangeOk = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/change-password',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, {
      currentPassword: 'Citizen@123',
      newPassword: 'Citizen@Updated456',
      confirmPassword: 'Citizen@Updated456'
    });
    assert(passChangeOk.status === 200, 'Valid password change succeeded');

    // Verify login with updated password
    const loginWithNewPass = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'citizen@civictrack.gov', password: 'Citizen@Updated456' });
    assert(loginWithNewPass.status === 200, 'Login succeeded using the newly changed password');
    const newCitizenToken = loginWithNewPass.body?.token;

    // Revert password back to Citizen@123 to keep environment pristine
    const passRevertOk = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/change-password',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newCitizenToken}`
      }
    }, {
      currentPassword: 'Citizen@Updated456',
      newPassword: 'Citizen@123',
      confirmPassword: 'Citizen@123'
    });
    assert(passRevertOk.status === 200, 'Reverted password back to original successfully');

    // Confirm original password works again
    const loginOriginalPass = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'citizen@civictrack.gov', password: 'Citizen@123' });
    assert(loginOriginalPass.status === 200, 'Original password confirmed active after test completion');

    // 8. Notification Preferences
    console.log('\n8. Notification Preferences (GET / PATCH /api/auth/notifications/preferences):');
    const getPrefs = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/notifications/preferences',
      method: 'GET',
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(getPrefs.status === 200, 'GET notification preferences succeeded');
    assert(typeof getPrefs.body?.preferences === 'object', 'Notification preferences returned as object');

    const updatePrefs = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/notifications/preferences',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, {
      complaintStatusUpdates: false,
      slaWarningsAndBreaches: true
    });
    assert(updatePrefs.status === 200, 'PATCH notification preferences succeeded');
    assert(updatePrefs.body?.preferences?.complaintStatusUpdates === false, 'complaintStatusUpdates set to false');

    // Verify persistence
    const verifyPrefs = await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/notifications/preferences',
      method: 'GET',
      headers: { Authorization: `Bearer ${citizenToken}` }
    });
    assert(verifyPrefs.body?.preferences?.complaintStatusUpdates === false, 'Preference persistence verified');

    // Revert preferences back to default
    await request({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/auth/notifications/preferences',
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${citizenToken}`
      }
    }, {
      complaintStatusUpdates: true,
      complaintAssignments: true,
      slaWarningsAndBreaches: true,
      resolutionDisputeUpdates: true
    });

    console.log('\n====================================================');
    console.log(`Step 11 Verification Complete: ${passed} / ${total} tests passed.`);
    console.log('====================================================');

    if (passed === total) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  }
}

runTests();
