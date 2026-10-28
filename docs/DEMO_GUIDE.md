# CivicTrack — Live Demonstration & Presentation Guide

This guide provides an end-to-end operational script for presenting **CivicTrack (Smart Civic Complaint Management and Resolution Platform)** in a live classroom, technical review, or stakeholder demonstration.

---

## Pre-Demonstration Checklist

Before starting the presentation, verify that:
- [ ] MongoDB Community Server service is active on `localhost:27017`.
- [ ] Node.js (v20+ LTS) is installed and available in PowerShell.
- [ ] Backend is running on port 5000 (`http://localhost:5000`).
- [ ] Frontend development server is running on port 5173 (`http://localhost:5173`).
- [ ] Health-check returns `{"status":"ok","database":"connected"}`.
- [ ] Sample image files (JPEG, PNG, or WebP) are prepared on your machine for complaint evidence uploads.
- [ ] Browser window is set up at standard resolution (1080p recommended).

---

## Part A: Application Startup & Verification

### 1. Verify and Start MongoDB
Open Windows PowerShell:
```powershell
Get-Service -Name MongoDB
```
If the status is `Stopped`, start the service:
```powershell
Start-Service -Name MongoDB
```

### 2. Launch the Backend API (Terminal 1)
In PowerShell:
```powershell
cd C:\Users\rites\OneDrive\Desktop\CivicTrack\backend
node server.js
```
Expected output:
```text
[Startup] Connecting to MongoDB...
[Database] MongoDB connection established successfully: civictrack
[Startup] CivicTrack backend server running on port 5000
[Startup] Health endpoint available at http://localhost:5000/api/health
```

### 3. Launch the Frontend Application (Terminal 2)
In a second PowerShell window:
```powershell
cd C:\Users\rites\OneDrive\Desktop\CivicTrack\frontend
npm run dev
```
Expected output:
```text
  VITE v8.3.4  ready in ~250 ms

  ➜  Local:   http://localhost:5173/
```

### 4. Verify Health Endpoint
Open a web browser or run in PowerShell:
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/api/health" -Method Get
```
Confirm the response:
```json
{
  "status": "ok",
  "database": "connected"
}
```

### Troubleshooting Startup Errors

| Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| `EADDRINUSE: address already in use :::5000` | Port 5000 is occupied by another process | Find and terminate the process: `netstat -ano \| findstr :5000` then `Stop-Process -Id <PID> -Force` |
| `[Startup Failure] MONGO_URI... is required` | Missing `backend/.env` file | Copy `backend/.env.example` to `backend/.env` |
| `MongoDB connection failed` | Local MongoDB daemon is not running | Run `Start-Service -Name MongoDB` in PowerShell as Administrator |
| Frontend displays network connection error | Backend is offline or blocked by firewall | Verify backend Terminal 1 is running and accessible at `http://localhost:5000/api/health` |

---

## Demo Account Guidance

> **Important Security Policy:**  
> In accordance with secure credential management practices, passwords and JWT tokens are **not** committed to version control or printed in public documents. Store demonstration credentials in a private local note during presentations.

### Verified Existing Database Accounts
The following persistent accounts are confirmed in the local database:

1. **Designated Administrator:**  
   - Email: `admin@civictrack.gov`  
   - Role: `admin` (Enforced Single Administrator)  
   - Department: Executive Command

2. **Field Officer:**  
   - Email: `officer@civictrack.gov`  
   - Role: `officer`  
   - Department: `Roads & Infrastructure`

3. **Citizen:**  
   - Email: `citizen@civictrack.gov`  
   - Role: `citizen`

### How to Provision Accounts if Needed
- **Citizen Account:** Anyone can self-register a citizen account instantly from the public **Register** page (`http://localhost:5173/register`).
- **Field Officer Account:** An administrator can provision new officers directly via the **Officer Oversight** panel inside the dashboard, or via CLI:
  ```powershell
  node backend/scripts/provision-user.js --create --name "Field Officer" --email "new_officer@civictrack.gov" --password "YourSecurePassword" --role officer --department "Sanitation & Waste Management"
  ```
- **List All Existing Accounts:**
  ```powershell
  node backend/scripts/provision-user.js --list
  ```

---

## Part B: Citizen Workflow Demonstration

**Narrative:** *"A local resident discovers a dangerous pothole causing traffic hazards on Main Street. The citizen uses CivicTrack to report the hazard with verified photo evidence and track its resolution."*

### Step 1: Citizen Login & Workspace
1. Navigate to `http://localhost:5173`.
2. Enter the Citizen credentials and click **Sign In**.
3. Point out the **Citizen Services Overview**:
   - Total complaints submitted by this citizen.
   - Status breakdown badges (`Submitted`, `In Progress`, `Resolved`).
   - Recent activity list with real tracking IDs.

### Step 2: AI-Assisted Complaint Reporting
1. Click **Report Issue** in the sidebar navigation.
2. In the **Issue Title** field, type:
   `"Deep pothole on Main Street near central bus terminal"`
3. In the **Detailed Description** field, type:
   `"A large and deep pothole is causing vehicle damage and traffic backups. Rainwater is accumulating, creating a serious hazard for two-wheelers."`
4. Point out the **AI Assistant Panel** on the right:
   - Notice the AI suggestion automatically highlights **Roads & Infrastructure** as the recommended category and **High / Urgent** as the recommended priority.
   - Click **Apply Suggestion** to auto-populate the form fields.
   - Explain the duplicate detection feature: if similar complaints exist in the same ward, CivicTrack alerts the user before submission to avoid redundant tickets.

### Step 3: Evidence Upload & Geotag Verification
1. Upload a sample photo under **Physical Evidence**.
2. Explain the validation safeguards:
   - CivicTrack performs **binary magic-byte inspection** (JPEG, PNG, WebP) on the backend to reject spoofed files.
   - Pure JavaScript EXIF extraction reads GPS coordinates embedded in the image.
   - The Haversine formula compares declared location with photo coordinates.
3. Enter or confirm the declared location coordinates (e.g. `12.9716, 77.5946`).
4. Click **Submit Complaint**.

### Step 4: Tracking ID & Personal Complaints List
1. Note the generated tracking ID in the confirmation toast: `CT-YYYYMMDD-XXXX`.
2. Navigate to **My Complaints** in the sidebar.
3. Open the newly submitted complaint:
   - Review the status timeline (starts at `Submitted`).
   - Point out the authenticated evidence preview.
   - Point out the interactive location map pin.

### Step 5: Citizen CSV Export
1. On the **My Complaints** page, click **Export to CSV**.
2. Open the downloaded file to demonstrate:
   - The export contains only the citizen's personal complaints (role-scoped).
   - All cells are sanitized against formula injection (`=`, `+`, `@`).

---

## Part C: Municipal Administrator Workflow Demonstration

**Narrative:** *"The Municipal Administrator logs in to the Command Center to inspect incoming city-wide complaints, review departmental workloads, and dispatch work orders to field officers."*

### Step 1: Admin Login & Operations Command
1. Click the profile icon in the top header and select **Sign Out**.
2. Log in using the Administrator credentials (`admin@civictrack.gov`).
3. Highlight the **Executive Operations Center**:
   - **Active/Open Issues:** Real-time count of unresolved municipal tickets.
   - **Unassigned Issues:** Complaints awaiting departmental dispatch.
   - **Average Response Time & Resolution Time:** Computed dynamically from MongoDB timestamp deltas.
   - **Overdue Indicator:** Honestly designated as *Awaiting municipal SLA policy* (demonstrates adherence to zero fabricated data).

### Step 2: Dispatch & Assignment Center
1. Navigate to **Dispatch & Assignment** in the sidebar.
2. Find the newly submitted complaint from Part B (marked with an `Unassigned` badge).
3. Click **Assign Officer**:
   - The assignment modal loads the list of verified field officers.
   - Select an officer (e.g., `Field Officer` from *Roads & Infrastructure*).
   - Enter dispatch instructions: `"Dispatched for on-site inspection and asphalt repair."`
   - Click **Confirm Assignment**.
4. Point out that the complaint status updates immediately, and the assignment is recorded in the immutable audit trail.

### Step 3: Officer Workload Oversight
1. Navigate to **Officer Oversight** in the sidebar.
2. Review the officer capacity metrics:
   - Active caseload per officer.
   - Departmental distribution pills (Roads, Water, Sanitation, Electrical).
   - Capacity status badges (`Available / Idle`, `Optimal Load`, `Moderate`, `High Workload`).
3. Demonstrate the **Provision New Officer** button:
   - Shows that new officers can only be provisioned by an authenticated administrator.

### Step 4: City-Wide Geographic Command Map
1. Click **Geographic Map** in the sidebar.
2. Demonstrate the full-screen interactive Leaflet map:
   - Markers colored by complaint status (Blue for Submitted, Yellow for In Progress, Green for Resolved).
   - Click any pin to view tracking ID, title, department, and click **Inspect Complaint** to open the full detail modal.

### Step 5: City-Wide Reports & CSV Export
1. Navigate to **Reports & Export** in the sidebar.
2. Select department or status filters, or leave blank for a comprehensive municipal report.
3. Click **Export Municipal CSV Report**.
4. Explain that the admin export covers all municipal departments, whereas the citizen export only included personal records.

---

## Part D: Field Officer Workflow Demonstration

**Narrative:** *"The field officer receives the assignment on their mobile/tablet dashboard, inspects the site, updates progress to 'In Progress', and marks the issue 'Resolved' with official resolution notes."*

### Step 1: Officer Login & Live Notification
1. Sign out of the Administrator account.
2. Log in using the Field Officer credentials (`officer@civictrack.gov`).
3. Click the **Notification Bell** in the top navigation header:
   - Notice the unread notification: `"New Complaint Assigned: CT-YYYYMMDD-XXXX"`.
   - Click the notification to mark it as read and view the assigned ticket.

### Step 2: Officer Task Queue & Status Lifecycle
1. Navigate to **Assigned Tasks** in the sidebar.
2. Locate the assigned complaint. Click **Update Status**.
3. Demonstrate the **Enforced State Machine**:
   - Point out that only valid next transitions are available in the dropdown:
     - From `Submitted`, only `Under Review` or `Rejected` is allowed.
     - Direct jumps from `Submitted` to `Resolved` are strictly prohibited by the backend.
4. Select `Under Review`, add comment: `"Inspecting site conditions."` and submit.
5. Click **Update Status** again, select `In Progress`, and submit.

### Step 3: Resolving with Official Notes
1. Click **Update Status** once more.
2. Select `Resolved`.
3. Note that the **Resolution Notes** field becomes mandatory:
   - Type: `"Pothole filled with standard hot-mix asphalt and compacted. Roadway opened to normal traffic."`
4. Click **Confirm Status Update**.
5. Observe the status change to `Resolved` (green badge) and the timestamp recorded.

---

## Part E: Closing the Loop (Citizen Verification)

**Narrative:** *"The citizen logs back in to verify that their issue was successfully resolved."*

1. Sign out of the Officer account.
2. Log back in as the Citizen.
3. Click the **Notification Bell**:
   - Point out the notification: `"Your complaint CT-YYYYMMDD-XXXX has been resolved."`
4. Open the complaint details:
   - Status badge displays **Resolved**.
   - Audit trail shows the complete history: Citizen submission &rarr; Admin dispatch &rarr; Officer review &rarr; Officer resolution with official notes.

---

## Part F: Presentation Conclusion & Classroom Checklist

### Presentation Takeaways
1. **Verifiable & Trustworthy:** Real physical evidence validation via EXIF and binary inspection eliminates frivolous tickets.
2. **Security-First Architecture:** Single-admin invariant, role-based route guards, and CSV formula sanitization protect administrative data.
3. **Operational Clarity:** Deterministic state machine and automated notifications keep all stakeholders aligned without manual phone calls.
4. **Resilient AI:** Dual-engine civic classifier delivers AI capabilities when cloud services are configured, and runs offline seamlessly when disconnected.

### Post-Demonstration Clean-up
- [ ] Sign out of the active user session.
- [ ] Keep database records intact (do not wipe database after presentation).
- [ ] Stop backend and frontend terminal processes (`Ctrl+C` in each PowerShell window).
