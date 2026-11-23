/**
 * CivicTrack API Service
 * Centralized service module for communicating with the Express backend.
 */

const getBaseUrl = () => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) {
      return import.meta.env.VITE_API_BASE_URL;
    }
  } catch (e) {
    // Fall back to default
  }
  return 'http://localhost:5000';
};

const API_BASE_URL = getBaseUrl().replace(/\/+$/, '');

/**
 * Fetch backend health status with timeout and error handling.
 * Calls GET /api/health.
 */
export async function checkBackendHealth(externalSignal = null, timeoutMs = 5000) {
  const endpoint = `${API_BASE_URL}/api/health`;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      return { ok: false, data: null, httpStatus: null, errorMessage: 'Request aborted' };
    }
    externalSignal.addEventListener('abort', () => timeoutController.abort(externalSignal.reason));
  }

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: timeoutController.signal
    });

    clearTimeout(timer);

    let parsedData = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        parsedData = await response.json();
      } catch (jsonErr) {
        parsedData = null;
      }
    }

    if (response.status === 200 && parsedData) {
      return { ok: true, data: parsedData, httpStatus: response.status, errorMessage: null };
    }

    if (response.status === 503 && parsedData) {
      return {
        ok: false,
        data: parsedData,
        httpStatus: response.status,
        errorMessage: 'Backend reached, but database connection is unavailable.'
      };
    }

    return {
      ok: false,
      data: parsedData,
      httpStatus: response.status,
      errorMessage: `HTTP ${response.status}: ${response.statusText || 'Unexpected response'}`
    };
  } catch (error) {
    clearTimeout(timer);
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      data: null,
      httpStatus: null,
      errorMessage: error.name === 'AbortError'
        ? 'Request was cancelled or timed out.'
        : isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to reach backend server.')
    };
  }
}

/**
 * Register a new citizen account.
 * Calls POST /api/auth/register.
 *
 * @param {Object} userData - { name, email, password }
 */
export async function registerUser({ name, email, password }) {
  const endpoint = `${API_BASE_URL}/api/auth/register`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ name, email, password })
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 201 && data) {
      return {
        ok: true,
        user: data.user,
        message: data.message || 'Registration successful'
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || data?.error || `Registration failed (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to connect to backend service.')
    };
  }
}

/**
 * Authenticate user with email and password.
 * Calls POST /api/auth/login.
 *
 * @param {Object} credentials - { email, password }
 */
export async function loginUser({ email, password }) {
  const endpoint = `${API_BASE_URL}/api/auth/login`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.token) {
      return {
        ok: true,
        token: data.token,
        user: data.user,
        message: data.message || 'Login successful'
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || data?.error || 'Invalid email or password.'
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to connect to backend service.')
    };
  }
}

/**
 * Fetch authenticated user identity.
 * Calls GET /api/auth/me.
 *
 * @param {string} token - In-memory JWT
 */
export async function fetchCurrentUser(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'No authentication token provided.' };
  }

  const endpoint = `${API_BASE_URL}/api/auth/me`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.user) {
      return {
        ok: true,
        user: data.user
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || 'Session expired or invalid.'
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to verify session.')
    };
  }
}

/**
 * Submit a new civic complaint.
 * Calls POST /api/complaints.
 *
 * @param {string} token - In-memory JWT
 * @param {Object} complaintData - { title, description, category, location: { address, latitude, longitude } }
 */
export async function submitComplaint(token, complaintData) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required to submit a complaint.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints`;
  const isFormData = typeof FormData !== 'undefined' && complaintData instanceof FormData;

  try {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    };

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: isFormData ? complaintData : JSON.stringify(complaintData)
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 201 && data && data.complaint) {
      return {
        ok: true,
        complaint: data.complaint,
        message: data.message || 'Complaint submitted successfully'
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || data?.error || `Complaint submission failed (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to submit complaint.')
    };
  }
}

/**
 * Fetch paginated complaints submitted by the authenticated citizen.
 * Calls GET /api/complaints/my?page={page}&limit={limit}.
 *
 * @param {string} token - In-memory JWT
 * @param {number} page - Page number (default: 1)
 * @param {number} limit - Items per page (default: 10)
 */
export async function fetchMyComplaints(token, pageOrOptions = 1, limit = 10) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required to view complaints.' };
  }

  let page = 1;
  let lim = 10;
  let status = '';
  let category = '';
  let search = '';

  if (typeof pageOrOptions === 'object' && pageOrOptions !== null) {
    page = pageOrOptions.page || 1;
    lim = pageOrOptions.limit || 10;
    status = pageOrOptions.status || '';
    category = pageOrOptions.category || '';
    search = pageOrOptions.search || '';
  } else {
    page = pageOrOptions;
    lim = limit;
  }

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(lim)
  });
  if (status && status !== 'All Statuses') queryParams.set('status', status);
  if (category && category !== 'All Categories') queryParams.set('category', category);
  if (search && search.trim()) queryParams.set('search', search.trim());

  const endpoint = `${API_BASE_URL}/api/complaints/my?${queryParams.toString()}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && Array.isArray(data.complaints)) {
      return {
        ok: true,
        complaints: data.complaints,
        pagination: data.pagination || { total: data.complaints.length, page, limit, totalPages: 1 }
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch complaints (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to load complaints.')
    };
  }
}

/**
 * Fetch summary counts of complaints for the authenticated citizen.
 * Calls GET /api/complaints/summary.
 *
 * @param {string} token - In-memory JWT
 */
export async function fetchComplaintSummary(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required to view summary.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/summary`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.summary) {
      return {
        ok: true,
        summary: data.summary
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch summary (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to load complaint summary.')
    };
  }
}

/**
 * Track a complaint by its unique tracking reference.
 * Calls GET /api/complaints/track/{trackingId}.
 *
 * @param {string} token - In-memory JWT
 * @param {string} trackingId - Public complaint tracking reference
 */
export async function trackComplaint(token, trackingId) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required to track complaint.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/track/${encodeURIComponent(trackingId.trim())}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.complaint) {
      return {
        ok: true,
        complaint: data.complaint
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Complaint not found (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to track complaint.')
    };
  }
}

/**
 * Fetch complaint details by MongoDB ObjectId.
 * Calls GET /api/complaints/{id}.
 *
 * @param {string} token - In-memory JWT
 * @param {string} id - Complaint ObjectId
 */
export async function fetchComplaintById(token, id) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required to view complaint details.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/${encodeURIComponent(id)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.complaint) {
      return {
        ok: true,
        complaint: data.complaint
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Complaint not found (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to load complaint details.')
    };
  }
}

/**
 * Fetch complaints assigned to the authenticated officer.
 * Calls GET /api/complaints/assigned.
 */
export async function fetchAssignedComplaints(token, { page = 1, limit = 10, status = '', category = '', search = '', slaBreached = '', escalationLevel = '' } = {}) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required to view assigned complaints.' };
  }

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit)
  });
  if (status) queryParams.set('status', status);
  if (category) queryParams.set('category', category);
  if (search) queryParams.set('search', search);
  if (slaBreached) queryParams.set('slaBreached', String(slaBreached));
  if (escalationLevel !== '' && escalationLevel !== undefined) queryParams.set('escalationLevel', String(escalationLevel));

  const endpoint = `${API_BASE_URL}/api/complaints/assigned?${queryParams.toString()}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data) {
      return {
        ok: true,
        complaints: data.complaints || [],
        pagination: data.pagination || { total: 0, page: 1, limit, totalPages: 1 }
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch assigned complaints (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to fetch assigned complaints.')
    };
  }
}

/**
 * Fetch summary status counts for the authenticated officer's assigned queue.
 * Calls GET /api/complaints/assigned/summary.
 */
export async function fetchAssignedSummary(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/assigned/summary`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.summary) {
      return {
        ok: true,
        summary: data.summary
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch summary (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Unable to fetch summary.')
    };
  }
}

/**
 * Update complaint status through permitted state transitions.
 * Calls PATCH /api/complaints/{id}/status.
 */
export async function updateComplaintStatus(token, id, { status, comment = '', resolutionNotes = '' }) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/${encodeURIComponent(id)}/status`;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({ status, comment, resolutionNotes })
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.complaint) {
      return {
        ok: true,
        message: data.message,
        complaint: data.complaint
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Status update failed (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Status update failed.')
    };
  }
}

/**
 * Record resolution notes for a complaint.
 * Calls PATCH /api/complaints/{id}/resolution.
 */
export async function updateComplaintResolution(token, id, { resolutionNotes, markResolved = false }) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/${encodeURIComponent(id)}/resolution`;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({ resolutionNotes, markResolved })
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.complaint) {
      return {
        ok: true,
        message: data.message,
        complaint: data.complaint
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Resolution update failed (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Resolution update failed.')
    };
  }
}

/**
 * Admin assigns a complaint to an officer.
 * Calls PATCH /api/complaints/{id}/assign.
 */
export async function assignComplaint(token, id, { officerId, department = '', comment = '' }) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/${encodeURIComponent(id)}/assign`;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({ officerId, department, comment })
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.complaint) {
      return {
        ok: true,
        message: data.message,
        complaint: data.complaint
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Assignment failed (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Assignment failed.')
    };
  }
}

/**
 * Admin fetches complaints list for oversight & assignment.
 * Calls GET /api/complaints/admin/all.
 */
export async function fetchAdminComplaints(token, { page = 1, limit = 10, unassigned = false, status = '', category = '', slaBreached = '', escalationLevel = '', criticalAttention = '' } = {}) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit)
  });
  if (unassigned) queryParams.set('unassigned', 'true');
  if (status) queryParams.set('status', status);
  if (category) queryParams.set('category', category);
  if (slaBreached) queryParams.set('slaBreached', String(slaBreached));
  if (escalationLevel !== '' && escalationLevel !== undefined) queryParams.set('escalationLevel', String(escalationLevel));
  if (criticalAttention) queryParams.set('criticalAttention', String(criticalAttention));

  const endpoint = `${API_BASE_URL}/api/complaints/admin/all?${queryParams.toString()}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data) {
      return {
        ok: true,
        complaints: data.complaints || [],
        pagination: data.pagination || { total: 0, page: 1, limit, totalPages: 1 }
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch complaints (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Failed to fetch complaints.')
    };
  }
}

/**
 * Admin fetches list of eligible officers for assignment.
 * Calls GET /api/complaints/admin/officers.
 */
export async function fetchAdminOfficers(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/admin/officers`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.officers) {
      return {
        ok: true,
        officers: data.officers
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch officers (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Failed to fetch officers.')
    };
  }
}

/**
 * Admin fetches city-wide summary aggregation metrics.
 * Calls GET /api/complaints/admin/summary.
 */
export async function fetchAdminSummary(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/admin/summary`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && data.summary) {
      return {
        ok: true,
        summary: data.summary
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch admin summary (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Failed to fetch admin summary.')
    };
  }
}

/**
 * Admin fetches officer workload oversight data.
 * Calls GET /api/complaints/admin/officer-workload.
 */
export async function fetchOfficerWorkload(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/admin/officer-workload`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data && Array.isArray(data.officers)) {
      return {
        ok: true,
        officers: data.officers,
        totalOfficers: data.totalOfficers || data.officers.length,
        totalAssignedTasks: data.totalAssignedTasks || 0
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch officer workload (HTTP ${response.status})`
    };
  } catch (error) {
    const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError' || error.message?.includes('fetch failed');
    return {
      ok: false,
      status: 0,
      errorMessage: isNetworkError
        ? 'Unable to connect to CivicTrack backend server. Please verify the backend service is running on http://localhost:5000.'
        : (error.message || 'Network error: Failed to fetch officer workload.')
    };
  }
}

/**
 * Admin creates an officer account.
 * Calls POST /api/auth/officers.
 */
export async function createOfficer(token, { name, email, department, password }) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Admin authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/auth/officers`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({ name, email, department, password })
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 201 && data && data.officer) {
      return {
        ok: true,
        officer: data.officer,
        message: data.message || 'Officer account created successfully'
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || data?.error || `Officer creation failed (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      errorMessage: error.message || 'Network error: Failed to create officer account.'
    };
  }
}

/**
 * Fetch in-app notifications for the authenticated user.
 * Calls GET /api/notifications.
 */
export async function fetchNotifications(token, { page = 1, limit = 20, unreadOnly = false } = {}) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const params = new URLSearchParams({ page, limit });
  if (unreadOnly) params.append('unreadOnly', 'true');
  const endpoint = `${API_BASE_URL}/api/notifications?${params.toString()}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data) {
      return {
        ok: true,
        notifications: Array.isArray(data.notifications) ? data.notifications : [],
        unreadCount: data.unreadCount || 0,
        pagination: data.pagination
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch notifications (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      errorMessage: error.message || 'Network error: Failed to fetch notifications.'
    };
  }
}

/**
 * Mark a single notification as read.
 * Calls PATCH /api/notifications/:id/read.
 */
export async function markNotificationRead(token, notificationId) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/notifications/${notificationId}/read`;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data) {
      return { ok: true, notification: data.notification, unreadCount: data.unreadCount };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || 'Failed to update notification.'
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      errorMessage: error.message || 'Network error: Failed to mark notification read.'
    };
  }
}

/**
 * Mark all notifications as read.
 * Calls PATCH /api/notifications/read-all.
 */
export async function markAllNotificationsRead(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/notifications/read-all`;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.status === 200 && data) {
      return { ok: true, modifiedCount: data.modifiedCount, unreadCount: 0 };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || 'Failed to mark all notifications read.'
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      errorMessage: error.message || 'Network error: Failed to mark all notifications read.'
    };
  }
}

/**
 * Fetch authenticated evidence image as a Blob.
 * Calls GET /api/complaints/:id/evidence.
 */
export async function fetchEvidenceBlob(token, complaintId) {
  if (!token || !complaintId) return null;

  const endpoint = `${API_BASE_URL}/api/complaints/${complaintId}/evidence`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 200) {
      const blob = await response.blob();
      return blob;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch authenticated completion photograph evidence as a Blob.
 * Calls GET /api/complaints/:id/completion-evidence.
 */
export async function fetchCompletionEvidenceBlob(token, complaintId) {
  if (!token || !complaintId) return null;

  const endpoint = `${API_BASE_URL}/api/complaints/${complaintId}/completion-evidence`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 200) {
      const blob = await response.blob();
      return blob;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Submit geo-verified work completion evidence by assigned officer.
 * Calls POST /api/complaints/:id/complete-work.
 *
 * @param {string} token - In-memory officer JWT
 * @param {string} complaintId - Complaint ID or tracking ID
 * @param {Object} data - { photoFile, resolutionNotes, latitude, longitude, accuracy, capturedAt }
 */
export async function submitWorkCompletion(token, complaintId, { photoFile, resolutionNotes, latitude, longitude, accuracy, capturedAt }) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Officer authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/${complaintId}/complete-work`;
  const formData = new FormData();

  if (photoFile) {
    formData.append('completionPhoto', photoFile);
  }
  if (resolutionNotes) {
    formData.append('resolutionNotes', resolutionNotes);
  }
  if (latitude !== undefined && latitude !== null) {
    formData.append('latitude', latitude);
  }
  if (longitude !== undefined && longitude !== null) {
    formData.append('longitude', longitude);
  }
  if (accuracy !== undefined && accuracy !== null) {
    formData.append('accuracy', accuracy);
  }
  if (capturedAt) {
    formData.append('capturedAt', capturedAt);
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }
    }

    if (response.ok && data) {
      return {
        ok: true,
        complaint: data.complaint,
        completionEvidence: data.completionEvidence,
        verification: data.verification,
        message: data.message
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to submit work completion (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to submit work completion.'
    };
  }
}

/**
 * Fetch authenticated dispute photograph evidence as a Blob.
 * Calls GET /api/complaints/:id/dispute-evidence.
 */
export async function fetchDisputeEvidenceBlob(token, complaintId) {
  if (!token || !complaintId) return null;

  const endpoint = `${API_BASE_URL}/api/complaints/${complaintId}/dispute-evidence`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 200) {
      const blob = await response.blob();
      return blob;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Download complaints CSV report.
 * Calls GET /api/complaints/export/csv.
 */
export async function downloadComplaintsCsv(token, filters = {}) {
  if (!token) {
    return { ok: false, errorMessage: 'Authentication required.' };
  }

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      params.append(k, v);
    }
  });

  const endpoint = `${API_BASE_URL}/api/complaints/export/csv?${params.toString()}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 200) {
      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      let filename = 'civictrack-report.csv';
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }

      // Trigger browser download
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      return { ok: true, filename };
    }

    let errorData = null;
    try {
      errorData = await response.json();
    } catch (e) {}

    return {
      ok: false,
      status: response.status,
      errorMessage: errorData?.message || `CSV download failed (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to download CSV report.'
    };
  }
}

/**
 * Request AI-assisted category classification, priority recommendation, and duplicate analysis.
 * Calls POST /api/complaints/ai-assist.
 */
export async function getAiAssistance(token, { title, description, category, coordinates }) {
  if (!token) {
    return { ok: false, errorMessage: 'Authentication required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/ai-assist`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        title,
        description,
        category,
        coordinates
      })
    });

    const data = await response.json();

    if (response.ok) {
      return {
        ok: true,
        data,
        categoryRecommendation: data.categoryRecommendation,
        priorityRecommendation: data.priorityRecommendation,
        potentialDuplicates: data.potentialDuplicates || [],
        meta: data.meta
      };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `AI assist request failed (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach AI assistance service.'
    };
  }
}

/**
 * Citizen confirms satisfactory resolution of a provisionally resolved complaint.
 * Calls PATCH /api/complaints/:id/confirm-resolution.
 */
export async function confirmComplaintResolution(token, complaintId) {
  if (!token || !complaintId) {
    return { ok: false, errorMessage: 'Authentication and complaint ID are required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/${complaintId}/confirm-resolution`;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      return { ok: true, complaint: data.complaint, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to confirm resolution (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Citizen disputes a provisionally resolved complaint with reason and optional photo.
 * Calls POST /api/complaints/:id/dispute.
 */
export async function disputeComplaintResolution(token, complaintId, { reason, photoFile = null }) {
  if (!token || !complaintId) {
    return { ok: false, errorMessage: 'Authentication and complaint ID are required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/${complaintId}/dispute`;

  try {
    const formData = new FormData();
    formData.append('reason', reason);
    if (photoFile) {
      formData.append('disputePhoto', photoFile);
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const data = await response.json();

    if (response.ok) {
      return { ok: true, complaint: data.complaint, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to submit dispute (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Administrator reviews a disputed complaint (decision: 'accept' or 'reopen').
 * Calls PATCH /api/complaints/:id/admin-review.
 */
export async function adminReviewDispute(token, complaintId, { action, reviewNotes }) {
  if (!token || !complaintId) {
    return { ok: false, errorMessage: 'Authentication and complaint ID are required.' };
  }

  const endpoint = `${API_BASE_URL}/api/complaints/${complaintId}/admin-review`;

  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action, reviewNotes })
    });

    const data = await response.json();

    if (response.ok) {
      return { ok: true, complaint: data.complaint, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to submit admin dispute review (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Fetch active Municipal SLA Policy matrix.
 * Calls GET /api/sla/policy.
 *
 * @param {string} token - In-memory JWT
 */
export async function fetchSlaPolicy(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sla/policy`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, policy: data.policy };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch SLA policy (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Update Municipal SLA Policy targets (Admin only).
 * Calls PATCH /api/sla/policy.
 *
 * @param {string} token - Admin JWT
 * @param {Object} policyData - { priorityTargets, categoryResolutionOverrides, escalationRules, description }
 */
export async function updateSlaPolicy(token, policyData) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Admin authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sla/policy`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(policyData)
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, policy: data.policy, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to update SLA policy (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Fetch comprehensive SLA compliance, escalation, and breach metrics (Admin only).
 * Calls GET /api/sla/overview.
 *
 * @param {string} token - Admin JWT
 */
export async function fetchSlaOverview(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Admin authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sla/overview`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, slaOverview: data.slaOverview };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch SLA overview (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Trigger an immediate on-demand SLA evaluation and escalation cycle (Admin only).
 * Calls POST /api/sla/evaluate.
 *
 * @param {string} token - Admin JWT
 */
export async function triggerSlaEvaluation(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Admin authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sla/evaluate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, results: data.results, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to trigger SLA evaluation (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Fetch critical attention summary & active complaints (Admin only).
 * Calls GET /api/sla/critical-attention.
 *
 * @param {string} token - Admin JWT
 */
export async function fetchCriticalAttention(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Admin authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sla/critical-attention`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, criticalAttention: data.criticalAttention };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch critical attention metrics (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Record a structured administrative escalation action on a complaint (Admin only).
 * Calls POST /api/sla/complaints/:id/actions.
 *
 * @param {string} token - Admin JWT
 * @param {string} complaintId - Complaint ID or tracking ID
 * @param {Object} actionData - { actionType, adminNotes, newOfficerId, department }
 */
export async function recordSlaAction(token, complaintId, { actionType, adminNotes, newOfficerId, department }) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Admin authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sla/complaints/${complaintId}/actions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ actionType, adminNotes, newOfficerId, department })
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, complaint: data.complaint, action: data.action, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to record escalation action (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Retrieve internal escalation action history for a complaint (Admin only).
 * Calls GET /api/sla/complaints/:id/actions.
 *
 * @param {string} token - Admin JWT
 * @param {string} complaintId - Complaint ID
 */
export async function fetchSlaActions(token, complaintId) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Admin authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/sla/complaints/${complaintId}/actions`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, actions: data.actions };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch escalation actions (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Fetch authenticated user profile.
 * Calls GET /api/auth/profile.
 *
 * @param {string} token - In-memory JWT
 */
export async function fetchUserProfile(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, user: data.user };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch profile (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Update authenticated user profile fields.
 * Calls PATCH /api/auth/profile.
 *
 * @param {string} token - In-memory JWT
 * @param {Object} profileData - { name, phone, address, email, currentPassword }
 */
export async function updateUserProfile(token, profileData) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(profileData)
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, user: data.user, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to update profile (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Change authenticated user password.
 * Calls PATCH /api/auth/change-password.
 *
 * @param {string} token - In-memory JWT
 * @param {Object} passwordData - { currentPassword, newPassword, confirmPassword }
 */
export async function changePassword(token, { currentPassword, newPassword, confirmPassword }) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to change password (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Fetch authenticated user notification preferences.
 * Calls GET /api/auth/notifications/preferences.
 *
 * @param {string} token - In-memory JWT
 */
export async function fetchNotificationPreferences(token) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/notifications/preferences`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, preferences: data.preferences };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to fetch notification preferences (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Update authenticated user notification preferences.
 * Calls PATCH /api/auth/notifications/preferences.
 *
 * @param {string} token - In-memory JWT
 * @param {Object} preferences - { complaintStatusUpdates, complaintAssignments, slaWarningsAndBreaches, resolutionDisputeUpdates }
 */
export async function updateNotificationPreferences(token, preferences) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/notifications/preferences`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(preferences)
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, preferences: data.preferences, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to update notification preferences (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Upload profile avatar image.
 * Calls POST /api/auth/profile/avatar.
 *
 * @param {string} token - In-memory JWT
 * @param {File} file - Avatar image file
 */
export async function uploadAvatar(token, file) {
  if (!token) {
    return { ok: false, status: 401, errorMessage: 'Authentication required.' };
  }

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/profile/avatar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const data = await response.json();
    if (response.ok) {
      return { ok: true, user: data.user, avatar: data.avatar, message: data.message };
    }

    return {
      ok: false,
      status: response.status,
      errorMessage: data?.message || `Failed to upload avatar (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error.message || 'Network error: Failed to reach server.'
    };
  }
}

/**
 * Fetch avatar image blob for authenticated user.
 * Calls GET /api/auth/profile/avatar.
 *
 * @param {string} token - In-memory JWT
 */
export async function fetchAvatarBlob(token) {
  if (!token) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/profile/avatar`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      return await response.blob();
    }
    return null;
  } catch (error) {
    return null;
  }
}

export { API_BASE_URL };

