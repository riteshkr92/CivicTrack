# CivicTrack 2.0 — Live Demonstration & Presentation Guide

This guide provides a comprehensive, end-to-end operational script for presenting **CivicTrack 2.0 (Smart Civic Complaint Management and Resolution Platform)** in a live classroom, technical evaluation, or stakeholder demonstration.

---

## Pre-Demonstration Checklist

Before starting the presentation, verify that:
- [ ] MongoDB Community Server service is active on `localhost:27017`.
- [ ] Node.js (v20+ LTS or v24) is installed and available in PowerShell.
- [ ] Backend is running on port 5000 (`http://localhost:5000`).
- [ ] Frontend development server is running on port 5173 (`http://localhost:5173`).
- [ ] System health check returns `{"status":"ok","database":"connected"}`.
- [ ] Sample JPEG/PNG image files are prepared on your machine for evidence uploads.
- [ ] Browser window is set up at standard 1080p resolution.

---

## Part A: Application Startup & System Health

### 1. Verify and Start MongoDB (PowerShell)
```powershell
Get-Service -Name MongoDB
```
If status is `Stopped`, start the service:
```powershell
Start-Service -Name MongoDB
```

### 2. Launch the Backend API (Terminal 1)
```powershell
cd C:\Users\rites\OneDrive\Desktop\CivicTrack\backend
node server.js
```
Expected output:
```text
[Startup] Connecting to MongoDB...
[Database] MongoDB connection established successfully: civictrack
[SLA Scheduler] Background SLA evaluation daemon initialized (interval: 15m)
[Startup] CivicTrack backend server running on port 5000
[Startup] Health endpoint available at http://localhost:5000/api/health
```

### 3. Launch the Frontend Application (Terminal 2)
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
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/api/health" -Method Get
```
Expected response:
```json
{
  "status": "ok",
  "database": "connected"
}
```

---

## Verified Demonstration Accounts

The local database contains persistent demonstration accounts:

1. **Designated Administrator:**
   - Email: `admin@civictrack.gov`
   - Role: `admin` (Strict Single Administrator Invariant)
   - Department: `Executive Command`
2. **Field Officer:**
   - Email: `officer@civictrack.gov`
   - Role: `officer`
   - Department: `Roads & Infrastructure`
3. **Citizen:**
   - Email: `citizen@civictrack.gov`
   - Role: `citizen`

> **Note on Security:** In accordance with credential safety practices, passwords are not printed in public documentation.

---

## Part B: The 10-Step End-to-End Workflow Demonstration

### Step 1: Citizen Login & Workspace Overview
1. Navigate to `http://localhost:5173` in your browser.
2. Sign in using Citizen credentials (`citizen@civictrack.gov`).
3. Showcase the **Citizen Dashboard**:
   - Total complaints submitted, In Field Progress, and Resolved counters.
   - Interactive OpenStreetMap showing neighborhood reports.
   - Notification bell showing real-time alerts.

### Step 2: AI-Assisted Geotagged Complaint Submission
1. Click **Report an Issue** in the navigation.
2. Enter:
   - **Title:** `Deep pothole causing hazards near City Central Bus Terminal`
   - **Description:** `Large and dangerous pothole on the main carriageway. Water is accumulating and creating severe risk for two-wheelers.`
3. Point out the **AI Civic Assistant** panel:
   - AI analyzes the title/description and suggests category (`Roads & Infrastructure`) and priority (`High`).
   - Click **Apply Suggestion** to automatically populate form inputs.
   - Mention duplicate detection: system automatically scans for similar reports in the same ward.
4. Upload physical evidence (JPEG/PNG):
   - Explain server-side **binary magic-byte inspection** (JPEG `FF D8 FF`, PNG `89 50 4E 47`).
   - Pure JS EXIF extraction extracts camera GPS metadata and runs Haversine distance verification.
5. Click **Submit Complaint**.
6. Note the generated tracking ID in the toast notification (`CT-YYYYMMDD-XXXX`).

### Step 3: Administrator Dispatch & Officer Assignment
1. Sign out and log in as the Administrator (`admin@civictrack.gov`).
2. Highlight the **Executive Operations Center**:
   - Live MongoDB `$facet` metrics: Active Issues, Unassigned, Overdue/Breached, Average Response Time.
3. Navigate to **Dispatch & Assignment**:
   - Locate the newly submitted complaint marked `Unassigned`.
   - Click **Assign Officer**.
   - Select `Field Officer` from *Roads & Infrastructure*.
   - Add dispatch note: `"Dispatched for on-site inspection and asphalt repair."`
   - Click **Confirm Assignment**.
   - Note the status immediately transitions to `Under Review` and an audit entry is created.

### Step 4: Field Officer Workspace & Starting Field Work
1. Sign out and log in as the Field Officer (`officer@civictrack.gov`).
2. Point out the **Notification Bell**:
   - Notification received: `"New Complaint Assigned: CT-YYYYMMDD-XXXX"`.
3. Open **Assigned Tasks**:
   - Locate the complaint.
   - Notice action button **Start Work** (amber).
   - Click **Start Work** &rarr; status updates to `In Progress`.
   - Explain the state machine constraint: field officers cannot arbitrarily jump to `Resolved`.

### Step 5: Geo-Verified Work Completion Evidence Submission
1. In the officer task queue, click the green **Complete Work** button (or open the complaint detail and click **Submit Completion Evidence**).
2. The **Submit Work Completion Evidence Modal** opens:
   - Upload photographic completion evidence (JPEG/PNG).
   - Click **📍 Use Current GPS** to automatically populate device coordinates from browser geolocation (or confirm entered coordinates).
   - Enter Resolution Summary: `"Pothole filled with standard hot-mix asphalt and compacted. Roadway reopened to traffic."`
3. Click **Submit Completion Evidence**:
   - Backend validates magic bytes, calculates Haversine distance between device GPS and complaint location (200m tolerance), and checks EXIF GPS tags.
   - The complaint status moves to **Provisionally Resolved**.
   - Both the citizen and administrator receive real-time notifications.

### Step 6: Citizen Resolution Review & Hybrid Approval (Path A: Confirmation)
1. Sign out and log in as the Citizen (`citizen@civictrack.gov`).
2. Point out the **Action Required Banner** on the dashboard:
   - `"Action Required: 1 Completed Work Order Awaiting Your Review"`.
3. Click **Review Work** to open the complaint detail modal:
   - View the side-by-side evidence: Citizen's original photo vs. Officer's completion photo.
   - Inspect the geo-verification badge confirming on-site location match.
4. Under **Resolution Review**:
   - Select a 5-star rating.
   - Enter citizen feedback: `"Pothole repaired cleanly. Road is safe again. Thank you!"`
   - Click **Confirm Resolution**.
5. Observe the status transition to final **Resolved** (green badge).

### Step 7: The Citizen Dispute & Admin Review Workflow (Path B: Dispute & Rework)
*(Demonstrate this path using a second complaint or explaining the architecture)*:
1. If work is incomplete or unsatisfactory, the citizen selects **Dispute Resolution**:
   - Mandatory dispute explanation (10-1000 characters).
   - Optional dispute photograph showing incomplete repair.
   - Complaint moves to **Disputed** status.
2. Sign in as Administrator (`admin@civictrack.gov`):
   - Locate the disputed complaint.
   - Click **Review Dispute**: inspects original evidence, officer completion evidence, and citizen dispute claim.
   - The admin has two authorized options:
     - **Confirm Resolution**: Upholds officer work &rarr; transitions to `Resolved`.
     - **Order Rework**: Overrules provisional closure &rarr; transitions back to `In Progress`, triggering notifications to the officer to redo the work.

### Step 8: Smart SLA Engine & Automated Escalation Monitoring
1. In the Administrator view, point out the **SLA & Escalation System**:
   - Each complaint has dynamic deadlines computed based on Category and Priority.
   - Show the **SLA Metric Pill** on complaint cards displaying elapsed hours, remaining time, and warning/breach status.
   - Show the **Overdue / Breached** counter on the Operations Dashboard.
2. Background Scheduler:
   - Explain `backend/services/slaScheduler.js`: periodically evaluates all active complaints.
   - When a ticket exceeds 50% past its deadline, the engine automatically elevates it to **Level 3 Critical Escalation** and sets `requiresCriticalAttention: true`.

### Step 9: Administrator Supervisory Actions & Critical Attention Center
1. Navigate to the Admin Complaints view with the Critical Attention filter (`?criticalAttention=unacknowledged`).
2. Open a Level 3 escalated complaint:
   - Click **Supervisory Actions**.
   - Demonstrate the 5 supervisory controls:
     1. **Acknowledge Escalation:** Resets critical attention flag and logs timestamp.
     2. **Urgent Intervention:** Logs mandatory directive to field command.
     3. **Supervisory Review:** Logs quality audit notes.
     4. **Administrative Note:** Records internal notes strictly hidden from citizens.
     5. **Reassign Officer:** Reallocates the stalled work order to another field officer with automatic notifications to both officers.
3. Review the complete **Supervisory Action Audit Trail**.

### Step 10: Role-Scoped Privacy, CSV Reporting & Security Verification
1. Role-Scoped Privacy:
   - Log in as the Citizen and view the escalated complaint: notice that internal administrative notes, supervisory actions, and officer reassignments are completely omitted from the citizen view, while a polite customer-friendly notice is shown.
2. Secure CSV Export:
   - Click **Export to CSV**: open the downloaded file and point out formula injection sanitization (cells starting with `=`, `+`, `@` are prefixed with `'`).
3. Single-Admin Invariant:
   - Explain how Mongoose schema middleware blocks any second admin from ever being created or promoted.

---

## Part C: Automated Test Suite Verification

To prove 100% technical reliability to stakeholders, execute the automated test suites in PowerShell:

```powershell
# Run the 11 comprehensive test suites
node backend/scripts/test_step2_schema_lifecycle.cjs        # 27/27 PASS
node backend/scripts/test_step3_completion_evidence.cjs      # 35/35 PASS
node backend/scripts/test_step4_citizen_resolution.cjs       # 51/51 PASS
node backend/scripts/test_step5_smart_sla.cjs                # 51/51 PASS
node backend/scripts/test_step6_escalation_actions.cjs       # 71/71 PASS
node backend/scripts/test_step7_admin.cjs                    # 30/30 PASS
node backend/scripts/test_step8.cjs                          # 47/47 PASS
node backend/scripts/test_step8_security_audit.cjs           # 40/40 PASS
node backend/scripts/test_step9.cjs                          # 39/39 PASS
node backend/scripts/test_step10_integration_security.cjs    # 54/54 PASS
node backend/scripts/verify-roles.js                         # 20/20 PASS
```
*Total: 465+ automated test assertions passing (100% pass rate).*

---

## Part D: Presentation Conclusion & Key Takeaways

1. **True Civic Accountability**: Geo-verified photographic evidence and hybrid citizen approval ensure municipal work is genuinely completed before public funds or tickets are closed.
2. **Deterministic Governance**: Strict state machines eliminate arbitrary status jumps and enforce structured dispute handling.
3. **Supervisory Intelligence**: Smart SLAs and automated Level 3 escalations prevent civic complaints from lingering indefinitely in departmental backlogs.
4. **Security by Design**: Single-admin invariant, binary magic-byte inspection, canonical path normalization, and CSV sanitization protect public infrastructure data.
