# CivicTrack — Frontend Web Application

CivicTrack Frontend is a React application built with Vite and standard Vanilla CSS, providing a responsive municipal operations dashboard for managing civic complaints.

---

## Tech Stack

- **Framework:** React 19
- **Build Tool / Dev Server:** Vite 8
- **Styling:** Vanilla CSS with custom design tokens (`global.css`, `dashboard.css`)
- **HTTP Client:** Native browser Fetch API with AbortController timeout & cancellation handling
- **Node.js Compatibility:** Tested on Node.js v24.20.0 and npm 11.19.0

---

## Directory Structure

```text
frontend/
├── .env.example              # Environment variable template
├── .env                      # Local environment configuration (ignored by Git)
├── .gitignore                # Frontend-specific Git ignore rules
├── index.html                # Application HTML entry point & typography
├── package.json              # Dependencies and scripts
├── package-lock.json         # Lockfile
├── vite.config.js            # Vite configuration (port 5173)
├── src/
│   ├── main.jsx              # React DOM mounting entry point
│   ├── App.jsx               # Dashboard application shell & layout
│   ├── components/
│   │   ├── Header.jsx        # Top navigation header & user profile pill
│   │   ├── Sidebar.jsx       # Branded sidebar with module categories
│   │   ├── StatCard.jsx      # Reusable municipal metric card
│   │   └── BackendStatus.jsx # Real-time health check card (GET /api/health)
│   ├── services/
│   │   └── api.js            # Centralized API service with timeout handling
│   └── styles/
│       ├── global.css        # Color tokens, typography, resets
│       └── dashboard.css     # Grid layouts, responsive styling, cards
```

---

## Setup & Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to create your local `.env`:
```bash
# Windows PowerShell
Copy-Item .env.example .env

# Bash / Command Prompt
cp .env.example .env
```

Default configuration:
```env
VITE_API_BASE_URL=http://localhost:5000
```

### 3. Start Development Server
```bash
npm run dev
```
The application will be accessible at: `http://localhost:5173`

### 4. Build for Production
```bash
npm run build
```
Generates production-ready static assets in `dist/`.

---

## Current Status (Step 3 Completed)

- **Application Shell:** Responsive municipal dashboard layout with sidebar, header, attention cards, and metric cards.
- **Backend Health Integration:** Live querying of `GET /api/health` with real-time status badges, uptime display, and manual refresh button.
- **Visual Design Reference:** Inspired by the municipal operations center layout in `Screenshot 2026-10-13 171222.png`.
- **Planned Modules (Upcoming):**
  - Step 4: Data Models, Schemas, and Authentication.
  - Step 5: Citizen Complaint Submission & Tracking API.
  - Step 6: Department Officer Assignment & Resolution Workflows.
  - Step 7: Interactive GIS Map & Analytics.
