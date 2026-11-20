# WorkPulse Enterprise Platform — User Manual & Feature Guide

Welcome to the **WorkPulse Enterprise Platform** user manual. This document provides a complete guide to all features, portal layouts, workflows, and operational procedures for both **Corporate Staff Members** and **Executive Administrators**.

---

## Table of Contents
1. [Platform Overview & Access](#1-platform-overview--access)
   - [Strict Authentication & Portal Separation](#strict-authentication--portal-separation)
   - [Mobile Responsive Design & Touch Navigation](#mobile-responsive-design--touch-navigation)
   - [Standardized Date Formatting Policy (DD-MM-YYYY)](#standardized-date-formatting-policy-dd-mm-yyyy)
   - [Access URLs & Portals](#access-urls--portals)
2. [Staff Self-Service Portal](#2-staff-self-service-portal)
   - [2.1 Self-Attendance, Lunch Break & Inactivity Tracking](#21-self-attendance-lunch-break--inactivity-tracking)
   - [2.2 Attendance Calendar & Monthly KPI Summary Navigation](#22-attendance-calendar--monthly-kpi-summary-navigation)
   - [2.3 Upcoming Meeting Alert Banner](#23-upcoming-meeting-alert-banner)
   - [2.4 Notifications Center](#24-notifications-center)
   - [2.5 Work & Projects Suite](#25-work--projects-suite)
     - [My Work (Assigned Tasks & Deliverable Uploads)](#my-work-assigned-tasks--deliverable-uploads)
     - [Daily Work / Project Report](#daily-work--project-report)
     - [My Reviews & Executive Feedback](#my-reviews--executive-feedback)
   - [2.6 Meetings & Briefings (Dynamic Status Engine)](#26-meetings--briefings-dynamic-status-engine)
   - [2.7 Workforce Requests (Leaves with Rejection Explanations & WFH)](#27-workforce-requests-leaves-with-rejection-explanations--wfh)
   - [2.8 Authenticated Session & Identity Protection](#28-authenticated-session--identity-protection)
   - [2.9 Lead Follow-ups & Telecaller Hub (My Assigned Leads)](#29-lead-follow-ups--telecaller-hub-my-assigned-leads)
   - [2.10 General & Office Services (Staff Miscellaneous Portal)](#210-general--office-services-staff-miscellaneous-portal)
3. [Admin Executive Console](#3-admin-executive-console)
   - [3.1 Executive Dashboard & Analytics](#31-executive-dashboard--analytics)
   - [3.2 Staff Directory & Profile Dossiers](#32-staff-directory--profile-dossiers)
   - [3.3 Registering & Editing Corporate Staff](#33-registering--editing-corporate-staff)
   - [3.4 Attendance Log & Geolocation Audit](#34-attendance-log--geolocation-audit)
   - [3.5 Staff Activity Status & Live Monitoring](#35-staff-activity-status--live-monitoring)
   - [3.6 Staff Work & Project Management](#36-staff-work--project-management)
     - [Assigning Tasks with Document Deliverables](#assigning-tasks-with-document-deliverables)
     - [Reviewing Deliverables & Providing Executive Feedback](#reviewing-deliverables--providing-executive-feedback)
     - [Daily Works Module (Staff Submissions & Review Evaluations)](#daily-works-module-staff-submissions--review-evaluations)
   - [3.7 Scheduling Executive Meetings (Future-Date Validation)](#37-scheduling-executive-meetings-future-date-validation)
   - [3.8 Managing Workforce Requests (Mandatory Leave Rejection Reason)](#38-managing-workforce-requests-mandatory-leave-rejection-reason)
   - [3.9 Excel Bulk Import](#39-excel-bulk-import)
   - [3.10 Office & Inactivity Settings](#310-office--inactivity-settings)
   - [3.11 Sidebar Navigation & Scrolling](#311-sidebar-navigation--scrolling)
   - [3.12 Admin Profile & Account Settings](#312-admin-profile--account-settings)
   - [3.13 Client Management (Multi-Project Portfolios & Financial Dossiers)](#313-client-management-multi-project-portfolios--financial-dossiers)
   - [3.14 Lead Management (Kanban Pipeline, Telecaller Allocation & Follow-up Tracking)](#314-lead-management-kanban-pipeline-telecaller-allocation--follow-up-tracking)
   - [3.15 Domain & Hosting Management (Corporate Assets, Client Portfolios & Renewal Tracking)](#315-domain--hosting-management-corporate-assets-client-portfolios--renewal-tracking)
   - [3.16 Corporate Miscellaneous Hub (General Requests, Assets, Maintenance, Notes & Documents)](#316-corporate-miscellaneous-hub-general-requests-assets-maintenance-notes--documents)
4. [Storage, Security & Synchronization](#4-storage-security--synchronization)
5. [Quick Reference & REST API Endpoints](#5-quick-reference--rest-api-endpoints)

---

## 1. Platform Overview & Access

WorkPulse is a dual-portal workforce management and project collaboration platform powered by a high-performance Express REST API backend (`server.js`) with persistent file-backed JSON storage (`data/workpulse_db.json`), cryptographic session management (`data/workpulse_sessions.json`), and real-time frontend synchronization.

### Strict Authentication & Portal Separation
WorkPulse implements strict mutual portal separation:
- **Administrator Portal**: Authenticates only authorized accounts with the Admin role. Entering staff credentials on the Admin tab is rejected with: *"Invalid Admin credentials. Please use Staff Login."*
  - **Admin Login Identifier**: Accepts `admin@workpulse.com`, `admin`, or `Administrator`.
  - **Admin Default Password**: `admin123` (or as updated in Admin Profile Settings).
- **Staff Workspace Portal**: Authenticates only accounts with the Staff role using credentials provisioned by the Administrator. Entering Admin credentials on the Staff tab is rejected with: *"Access denied. Please use the Administrator portal."*
- **Brute-Force Rate Limiting**: Consecutive invalid login attempts (5 attempts in 15 minutes) trigger an automatic temporary lockout to protect against brute-force attacks. Successful login immediately clears the lockout counter.
- **Secure Password Recovery (Forgot Password Workflow)**: Both Admin and Staff can recover access if their password is forgotten:
  1. Click **"Forgot Password?"** on either login tab.
  2. Enter corporate email, staff ID, or registered mobile number.
  3. The backend generates a secure 6-digit cryptographic authorization code valid for 15 minutes.
  4. Enter the code and choose a new password (minimum 6 characters).
  5. The password hash is immediately updated with salted bcrypt in persistent storage.

### Mobile Responsive Design & Touch Navigation
WorkPulse features fully adaptive responsive layouts:
- **Desktop (1024px+)**: Standard multi-column executive view with fixed dark navy sidebar and horizontal KPI card grids.
- **Tablet / Mobile (≤ 860px)**: Sidebar smoothly converts to a slide-out navigation drawer toggled via the hamburger icon (`☰`). Summary KPI cards gracefully reflow into stacked responsive tiles.
- **Staff Account Isolation & Header Design**: The staff-switching dropdown has been removed from the Staff Portal. Staff members log in directly to their own dedicated workspace. The topbar cleanly presents the employee's initials/photo avatar, full name, position, notification bell, and Sign Out button.

### Standardized Date Formatting Policy (`DD-MM-YYYY`)
WorkPulse enforces a standardized, human-friendly date format of `DD-MM-YYYY` (e.g., `04-11-2026`) across the entire application interface, pickers, tables, and reports:
- **Interactive Date Pickers & Forms**: Powered by a custom offline Flatpickr calendar suite (`flatpickr.min.js`), allowing staff and administrators to select dates intuitively with an executive navy/royal-blue theme. Inputs accept manual keyboard entry in `DD-MM-YYYY` while safely synchronizing standard ISO values (`YYYY-MM-DD`) in the backend database.
- **Attendance & Timesheets**: All monthly calendar views, day-level timesheet audits, check-in histories, and calendar day hover tooltips format dates in `DD-MM-YYYY`.
- **Workforce Requests**: Leave applications, work-from-home (WFH) schedules, approval timestamps, and rejection reviews display exclusively in `DD-MM-YYYY`.
- **Projects, Tasks & Gantt Roadmaps**: Project start and target completion dates, task deadlines, subtask schedules, Gantt chart bar tooltips, and deliverable upload timestamps strictly use `DD-MM-YYYY`.
- **Leads, Telecallers & Acquisition**: Follow-up dates, interaction timeline logs, overdue reminder alerts, and Excel exports present all lead scheduling in `DD-MM-YYYY`.
- **Domain & Hosting Assets**: Registration dates, renewal cycles, hosting expiries, and SSL certificate schedules display in `DD-MM-YYYY`.
- **Corporate Services & Reporting**: Office asset deployments, return schedules, maintenance logs, internal reminders, daily work submissions, and CSV/Excel exports follow `DD-MM-YYYY`.

### Access URLs & Portals
| Portal / Service | Primary Localhost (8000) | New / Alternative Localhost (8080) | Local Network (Wi-Fi / LAN) | Authorized Role |
|---|---|---|---|---|
| **Landing & Split Login** | `http://localhost:8000/index.html` | `http://localhost:8080/index.html` | `http://192.168.1.12:8000/index.html` | Public |
| **Staff Self-Service Portal** | `http://localhost:8000/staff.html` | `http://localhost:8080/staff.html` | `http://192.168.1.12:8000/staff.html` | Verified Staff Only |
| **Admin Executive Console** | `http://localhost:8000/admin.html` | `http://localhost:8080/admin.html` | `http://192.168.1.12:8000/admin.html` | Administrator Only |
| **Backend REST Health Check** | `http://localhost:8000/api/health` | `http://localhost:8080/api/health` | `http://192.168.1.12:8000/api/health` | Public |

---

## 2. Staff Self-Service Portal

The Staff Portal (`staff.html`) provides employees with daily operational self-service tools, GPS attendance logging, project task management, daily reporting, and meeting schedules.

---

### 2.1 Self-Attendance, Lunch Break & Inactivity Tracking
Staff can record their daily attendance directly from their device, manage their official lunch break, and maintain accurate working hours through automated inactivity detection.

#### Operating Rules & Conditions:
1. **Location / GPS Activation**:
   - Staff member turns ON Location/GPS on their mobile device or browser.
   - If Location is disabled or permission is denied, attendance check-in displays a simple message prompt.
2. **One-Click Shift Punch-In**:
   - Simply click **"Record Attendance (Self Check-In)"**.
   - The browser requests location permission when needed.
   - The system automatically captures:
     - Exact check-in timestamp (e.g., `08:58 AM`).
     - Fresh hardware GPS latitude, longitude, accuracy, and physical street address.
     - Direct clickable Google Maps link.
     - Sets attendance status to **Present** (`🟢 Shift In Progress`).
   - Starts the live shift stopwatch counting active working hours in real-time.
3. **Lunch Break Management**:
   - While the shift is active, staff can click **"🍱 Start Lunch Break"**.
   - **When Clicked**:
     - The break start time is recorded.
     - The working-hours timer is **paused** and displays `⏸️ [HHh MMm SSs] (Lunch Break)`.
     - Shift status badge updates to **"🍱 On Lunch Break"**.
     - The button changes to an orange **"🍱 End Lunch Break"** button.
   - **Ending the Lunch Break**:
     - Click **"🍱 End Lunch Break"** to record the break end time and resume the working-hours timer.
     - The total lunch duration is calculated and stored in the attendance record.
     - **Lunch break duration is not counted as working hours** and is automatically deducted from total worked time.
     - **Single Lunch Break Policy**: Staff are permitted **one lunch break per shift**. Once completed, the button updates to a disabled state: `✓ Lunch Taken (XXm)`.
4. **Dual Independent Inactivity Detection**:
   - **Hybrid Monitoring Architecture**: WorkPulse implements two independent inactivity rules operating simultaneously:
     - **Condition 1 — System-Wide Idle Detection (15 Continuous Minutes)**:
       - Uses native browser system idle detection (Chromium `IdleDetector` API) to monitor OS-level keyboard, mouse, and screen-lock states.
       - **Multitasking Safe**: If a staff member is actively working in Excel, VS Code, email, or any other desktop application, the system detects active computer usage and the WorkPulse timer **continues running uninterrupted**.
       - If the **entire computer** is left untouched for **15 continuous minutes** (or the screen is locked / system sleeps), Condition 1 triggers.
     - **OR Condition 2 — WorkPulse Tab Inactivity (1 Continuous Hour)**:
       - Operates as an independent failsafe. If a staff member has had **no activity/interaction inside the WorkPulse browser tab for 1 continuous hour (60 minutes)**, Condition 2 triggers, even if other computer applications were being used.
   - **Independent Trigger Logic**: Whichever condition reaches its limit first immediately triggers the inactivity pause.
   - **Working-Hours Timer Paused**: The stopwatch immediately stops counting and clearly displays `⏸️ Inactive — Timer Paused` along with an alert strip detailing the trigger reason: *"Inactive — Timer Paused"*.
   - **Zero Inactive Work Time**: The inactive period is **not counted as working hours** and is automatically excluded from net working duration.
   - **No Auto-Checkout**: Staff members are **never automatically checked out** due to inactivity; only the timer is paused, and the shift remains active.
   - **Resume Work Workflow**:
     - When the staff member returns, the system displays an interactive prompt: *"You were inactive. Resume your shift?"* displaying the pause start time and trigger reason.
     - Click **"▶️ Resume Work"** (available on both the alert banner and the return dialog) to resume the working timer immediately.
     - The inactivity start time, resume time, duration, and trigger reason are permanently logged into the timesheet record and synced to Admin reports.
5. **Manual Checkout Only**:
   - The shift remains active until the employee manually clicks **"Check Out Shift (Manual)"**.
   - Upon confirmation, the checkout timestamp is captured and total net working hours are calculated:
     $$\text{Net Working Hours} = \text{Elapsed Time} - (\text{Lunch Duration} + \text{Total Inactive Minutes})$$
   - Attendance, break logs, inactive periods, and GPS coordinates---

### 2.2 Attendance Calendar & Monthly KPI Summary Navigation
The Staff Portal includes an authentic **5-color personal monthly attendance calendar** and real-time KPI summary cards powered by live backend attendance records:

#### Dynamic Month Switcher Controls
- Flanking the current month label (`October 2026`) are interactive navigation buttons:
  - **`← [Previous Month]`** (e.g. `← September`): Steps backward one month (smoothly rolling from January back to December of the previous year).
  - **`[Next Month] →`** (e.g. `November →`): Steps forward one month (smoothly rolling from December forward to January of the next year).
  - **`Print Timesheet`**: Formats the selected monthly calendar and KPI summary for clean PDF generation or physical hard-copy printout.
- When the month changes, the calendar date grid and all 6 attendance KPI summary cards update **automatically and instantaneously** based on actual records stored in the backend database.

#### Dynamic Monthly KPI Cards Strip
All 6 metrics calculate in real time for the active month:
1. **Working Days**: Total days in the selected month minus all Sundays (e.g. 27 for October 2026; 26 for September 2026; 25 for November 2026). The subtext dynamically updates to display the active month and year.
2. **Present**: Total unique calendar days with a valid, verified self check-in record on or before today's date (`date <= todayStr`). **Future dates are strictly never counted as Present.**
3. **Half Day**: Total unique calendar days logged as half-day shifts on or before today's date (`date <= todayStr`). Future dates are strictly never counted.
4. **Leave**: Total approved leave days in the selected month (excluding Sundays). Single-day and multi-day ranges are calculated seamlessly.
5. **WFH**: Total approved Work From Home days in the selected month (excluding Sundays).
6. **Attendance %**: Calculated accurately as:
   $$\text{Attendance \%} = \frac{\text{Present} + \text{WFH} + (0.5 \times \text{Half Day})}{\text{Total Working Days}} \times 100\%$$

#### 5-Color Calendar Day Status Engine
- **🟢 Present (Full Day)**: Verified check-in recorded on or before today. Displays arrival time, departure time, working duration, and GPS location coordinates.
- **🟤 Half Day**: Authentic 4-hour half-day shift.
- **🔴 Leave**: Approved absence. Hovering displays leave category and reason.
- **🟠 Work From Home**: Approved remote work day.
- **⚪ Sunday (Weekly Off)**: Non-working weekend day (excluded from corporate working days).
- **Scheduled (Future Date)**: Any future calendar day (`date > todayDateStr`). Automatically displays `⚪ Scheduled` (or pre-approved Leave/WFH). **Future dates are never marked as Present.**
- **⚪ Not Marked (Past Date)**: Unrecorded past work day.
- **Interactive Day Audit Modal**: Click any date cell in the grid to open the Day Timesheet popup with check-in/out timestamps, GPS notes, and shift duration.

---

### 2.3 Upcoming Meeting Alert Banner
- Positioned prominently at the top of the main container.
- Evaluates the nearest meeting using the real-time dynamic status engine (`Upcoming` or `● Ongoing`).
- Displays meeting title, date, time, duration (e.g. `(60m)`), and video conference link.
- Click **"View Meeting Details"** to jump directly to the Meetings section.

---

### 2.4 Notifications Center
- Located on the top navigation bar with a bell icon and unread count badge.
- Alerts staff to:
  - New tasks assigned by Admin.
  - Reviews, star ratings, and feedback on task deliverables and daily reports.
  - Approved or rejected leave requests (including the mandatory rejection reason).
  - Approved or rejected WFH applications.
  - Scheduled meetings and company briefings.
- Click any notification to mark it as read, or click **"Mark all read"**.

---

### 2.5 Work & Projects Suite
Located below the primary self-service applications grid with three interactive sub-tabs:

#### My Work (Assigned Tasks & Deliverable Uploads)
- Displays all tasks assigned to the employee by Executive Management.
- **Clickable Task Cards**: Click any task card to open the **Complete Task Details & Deliverables Modal** (`#task-detail-modal`).
- **Modal Details Displayed**:
  - Full Task Title and Scope Description.
  - Priority Badge (🔴 High, 🟡 Medium, 🔵 Low) and Status Badge (`Pending`, `In Progress`, `Completed`).
  - Assigned Date and Deadline Due Date.
  - Initial attachments provided by the Administrator during assignment.
  - **Previous Deliverable Submissions**: Chronological history of submitted deliverables, comments, timestamps, and executive review feedback.
- **Deliverable Upload Dropzone**:
  - Drag-and-drop or browse project deliverables.
  - **Supported File Types**: `PDF`, `DOC`, `DOCX`, `XLS`, `XLSX`, `JPG`, `PNG`, and `ZIP` up to 25MB.
  - Strictly validated on both frontend and backend against allowed MIME types and file extensions.
  - Uploaded files are saved **persistently to disk in `/uploads/`** on the server, ensuring files remain accessible across reloads, logouts, and across different devices.
- **Progress Update Submission**:
  - Staff can select an updated task status (`In Progress` or `Completed`), enter progress comments, and attach deliverables.
  - Submitting saves the record immediately to the backend database, updates the task status, and notifies Executive Administration.

#### Daily Work / Project Report
Allows employees to log their daily accomplishments and upload deliverables:
1. **Form Fields**:
   - **Project / Work Title**: Short title of the work completed today.
   - **Date**: Date of work accomplished (defaults to today).
   - **Work Progress Status**: Choose from `Completed`, `In Progress`, `On Track`, or `Blocked`.
   - **Related Assigned Task (Optional)**: Link the daily report to an assigned task.
   - **Work Description & Accomplishments**: Detailed log of what was completed, challenges faced, or next steps.
2. **Deliverable File / Document Attachment**:
   - Drag-and-drop or click the file dropzone (PDF, DOCX, XLSX, PNG, JPG, ZIP up to 25MB).
   - Shows attached filename, file size, and persistent upload URL.
3. Click **"Submit Daily Work Report to Admin"**.
4. **Submitted Reports History**:
   - Lists previous submissions with date, title, status badge, expandable description, attached deliverable download link, and Admin Review status.

#### My Reviews & Executive Feedback
- Live stream of executive reviews and feedback submitted by the Admin from the **Daily Works** module.
- **Review Card Details**:
  - Project Title & Report Date.
  - Executive Reviewer name (e.g., `Administrator (Admin)`).
  - Star Rating: 1 to 5 stars (`★★★★★ 5/5`).
  - Executive Feedback callout with quotation layout.

---

### 2.6 Meetings & Briefings (Dynamic Status Engine)
- Filter by `Upcoming`, `Previous`, and `All`.
- **Real-Time Dynamic Status Evaluation**:
  - **Upcoming**: Meeting start time is in the future.
  - **● Ongoing**: Current office time falls within the meeting's scheduled duration.
  - **Completed**: Meeting scheduled end time has elapsed.
  - **Cancelled**: Explicitly marked as cancelled by an executive administrator.
- Displays meeting title, date, time, duration (minutes), attendee group, organizer, and venue.
- **Video Conference Integration**: If the venue is a virtual URL (Google Meet, Zoom, Microsoft Teams), a direct **"Join Video Conference"** button is rendered.

---

### 2.7 Workforce Requests (Leaves with Decision Comments & WFH)
- **Leave Applications**:
  - Apply for Casual Leave, Annual Paid Leave, Medical Leave, or Compassionate Leave with start date, end date, and reason.
  - Automatically associates employee identity (`staffId`, `staffName`, `position`, `photo`) directly with the application.
  - **Status Badges**: Clearly shows `⏳ Pending`, `🔴 Approved`, or `❌ Rejected`.
  - **Admin Approval Comment Display**: When an administrator approves a leave request with an optional comment or handoff instructions, the comment is permanently displayed in a green alert box in the employee's Leave History table alongside the review timestamp (e.g. `✓ Approved by Admin`, `Admin Comment: "Approved. Please coordinate handover with Sneha."`, `Reviewed: 10/14/2026, 1:45:00 PM`).
  - **Rejection Reason Display**: When an administrator rejects a leave request, the **mandatory rejection explanation is permanently displayed** in a red alert box in the Leave History table alongside the review timestamp (e.g. `⚠️ Rejection Reason: "Critical client milestone during these dates."`, `Reviewed: 10/14/2026, 1:45:00 PM`).
- **Work From Home (WFH)**:
  - Request remote work for specific dates with task objectives.
  - Status updates in real time to `Approved` or `Rejected` with administrative notes.

---

### 2.8 Authenticated Session & Strict Account Isolation (IDOR Protection)
- **Immutable Session Identity**: Each staff member authenticates with their verified credentials (email/mobile + password). All backend operations derive the user's identity and permissions strictly from the verified server-side session token, never from client-supplied IDs.
- **Zero Cross-Account Access (HTTP 403 Forbidden)**:
  - Staff members can access and modify only their own attendance, leaves, WFH requests, tasks, project uploads, daily reports, meetings, and reviews.
  - Any attempt to query or manipulate another staff member's records—whether by tampering with URL parameters, request body `staffId`, query strings, or `localStorage` values—is strictly rejected with **HTTP 403 Forbidden: Cross-account access denied**.
- **No Client-Side Account Switching**: The staff persona dropdown has been completely removed from the Staff Portal UI. The portal binds strictly to the logged-in session.
- **Role Isolation**: Only authenticated Administrators with verified Admin permissions can view or manage other staff members' data. Unauthenticated requests are rejected with **HTTP 401 Unauthorized**.

---

### 2.9 Lead Follow-ups & Telecaller Hub (My Assigned Leads)

The Staff Self-Service Portal features a dedicated workspace for sales development representatives, telecallers, and account managers:

#### 1. "My Assigned Leads" Workspace Tab
- **Direct Navigation**: Located in the primary work tabs bar (`#tab-btn-my-leads`) with a live notification counter displaying total assigned leads requiring attention.
- **Strict Role & Assignment Isolation**: Staff members only see prospects assigned to them (`assignedStaffId === currentUser.id`). They cannot access or modify leads belonging to other staff members.

#### 2. Telecaller Performance & Schedule KPIs
- **My Assigned Leads**: Total active leads assigned to the logged-in staff member.
- **Upcoming Calls**: Scheduled follow-ups occurring today or in the future.
- **Overdue Follow-ups**: Follow-ups whose deadline has passed without an update (highlighted with an urgent pulsing alert).
- **Converted**: Total successfully converted leads credited to the staff member.

#### 3. Lead Interaction Table & Actions
- Displays Lead Name, Company, Phone & Email, Interested Service, Pipeline Value, Current Status Badge, Next Follow-up Date/Time, and Call Actions.
- Quick Search and Status Filter dropdown to rapidly isolate hot prospects (`Interested`, `Follow-up`, `New`, etc.).

#### 4. Call Logging & Communication Modal (`#staff-lead-notes-modal`)
- Click **"Log Call / Update"** on any lead row to open the interaction console.
- **Interaction History Stream**: Review the complete chronological log of past telecaller interactions, call notes, and status transitions with exact timestamps.
- **Status Progression**: Update lead status across standard pipeline stages:
  - `New`: Fresh lead assigned for initial discovery.
  - `Contacted`: Initial outreach or call completed.
  - `Follow-up`: Active discussion requiring scheduled callback.
  - `Interested`: High-intent prospect evaluating proposal.
  - `Converted`: Deal closed and ready for client onboarding.
  - `Lost`: Unqualified or non-responsive prospect.
- **Next Follow-up Scheduling**: Set new follow-up date and time with future validation.
- **Call Notes**: Log detailed client feedback, objections, budget notes, and next action items.
- All updates are immediately saved to the server backend (`POST /api/leads/:id/notes`, `PATCH /api/leads/:id/status`) and synchronized with the Admin Console.

---

### 2.10 General & Office Services (Staff Miscellaneous Portal)
Staff members have access to the **General & Office Services** hub via the `#tab-btn-my-misc` tab in their Staff Portal workspace:
- **My General Requests**:
  - Submit office supply, equipment, or service requests with title, category, description, priority, and date.
  - Track real-time status (`Pending`, `Approved`, `Rejected`, `Completed`).
  - Engage in threaded live comments directly with the Administrator regarding delivery dates or specifications.
- **My Assigned Equipment**:
  - View corporate equipment and inventory officially assigned to the staff member (e.g. laptops, monitors, access keys).
  - Inspect asset condition, serial/asset tag, checkout date, and scheduled return date.
- **Report Office Maintenance**:
  - Report facilities, electrical, HVAC, or plumbing issues with title, location, priority, and detailed observations.
  - Track assigned technician/staff member, repair progress, and admin resolution updates.
- **Corporate Documents & Handbooks**:
  - Browse published company policies, handbooks, guidelines, and compliance documentation.
  - Download attachments with single-click access.

---

## 3. Admin Executive Console

The Admin Console (`admin.html`) provides executive leadership with organizational oversight, attendance tracking, task delegation, report auditing, and meeting coordination.

---

### 3.1 Executive Dashboard & Analytics
- **Executive KPIs**:
  - Total Staff Roster count.
  - Present Today, On Leave, WFH Today.
  - Pending Workforce Requests (Leaves & WFH).
  - Active Corporate Tasks count.
- **Visual Analytics**:
  - Attendance Distribution Doughnut Chart (Present vs WFH vs Leave).
  - Departmental Attendance Bar Chart.
- **Recent Activity Feed**: Real-time log of staff check-ins, task updates, and request submissions.

---

### 3.2 Staff Directory & Profile Dossiers
- Interactive directory with search bar (by name, position, or phone number) and department filters.
- **Staff Cards & Table**: Displays staff avatar, name, ID, job title, department, mobile, email, and active status.
- **Staff Dossier Modal**:
  - Click **"View Dossier"** on any staff member.
  - Displays complete employee profile, contact information, and monthly attendance statistics.
  - **Month-by-Month Color Calendar**: Interactive grid highlighting Present (green), Half-Day (amber), Leave (red), WFH (blue), and Sundays (slate).
  - Click any calendar date to view the **Timesheet Details** popup (punch-in time, punch-out time, hours worked, and verified GPS coordinates).
  - **Print / PDF Dossier**: Click **"Print Dossier"** to generate an executive letterhead report.

---

### 3.3 Registering & Editing Corporate Staff
- **Register New Staff**:
  - Click **"+ Register New Staff"** in the Staff Directory view.
  - Vertically scrollable modal with Name, Position, Department, Mobile, Email, Status, and Address.
  - **Staff Profile Photo Widget**: Upload JPG, PNG, or WebP photo with live preview and save button. Falls back to stylized initials avatar if no photo is uploaded.
  - Action buttons: **"Register Staff"** and **"Cancel"**.
- **Edit Staff Details**:
  - Click the edit icon on any staff card.
  - Vertically scrollable modal to modify employee details and update profile photos.
  - Action buttons: **"Save Changes"** and **"Cancel"**.

---

### 3.4 Attendance Log & Geolocation Audit
- Comprehensive table of daily attendance records across the enterprise.
- Filter by Date, Staff Member, and Status (`Present`, `Half Day`, `Leave`, `Work From Home`).
- **Live Shift Status Badges**:
  - `🟢 Active Shift`: Staff member currently on duty with active timer.
  - `🍱 On Lunch`: Staff member currently on lunch break (working timer paused).
  - `⏸️ Inactive`: Staff member detected inactive for 15+ minutes (working timer paused).
- **Geolocation Audit**:
  - Shows verified GPS latitude/longitude recorded during self-attendance check-in.
  - Includes a direct Google Maps lookup link to audit employee punch-in locations against company geofences.
- **Timesheet Audit Details Modal**:
  - Click **"View Details"** on any record or calendar day to open the comprehensive audit popup.
  - Displays:
    - Official Status, Check-In and Check-Out times.
    - **Lunch Break Audit**: Shows Start Time, End Time, and Duration in minutes (or ongoing status).
    - **Inactivity Pause Audit**: Shows total deducted inactive minutes and count of inactivity sessions.
    - **Net Hours Worked**: Accurately accounts for lunch breaks and inactive deductions.
    - Audit notes and GPS telemetry coordinates.

---

### 3.5 Staff Activity Status & Live Monitoring
Accessed via **"Staff Activity Status"** (`nav-activity`) in the sidebar:
- **Real-Time Visibility**: Provides live monitoring into employee work states, portal session presence, idle intervals, lunch breaks, and chronological daily activity progressions.
- **Strict Separation: Portal Presence vs. Attendance Status**:
  - **Portal Presence (`🟢 Online` / `⚫ Offline`)**: Tracks whether the staff member has an active, authenticated portal session open in their browser. Pings the backend via a 20-second heartbeat. Automatically switches to `Offline` immediately when the employee clicks **Logout** or closes their browser tab, or after a 45-second stale heartbeat timeout.
  - **Workplace Attendance (`🟢 Present`, `🟡 Late`, `🔵 Half Day`, `⚪ Not Checked In`)**: Tracks whether the staff member has physically or remotely checked into their daily work shift.
  - *Example*: A staff member logged into the portal prior to their morning punch-in is accurately shown as `🟢 Online` with an attendance status of `⚪ Not Checked In`.
- **Top Summary KPI Cards**:
  - **Total Staff Tracked**: Aggregate number of corporate personnel under active monitoring (all 10 corporate accounts).
  - **Currently Active**: Real-time counter of staff members actively working (`🟢 Active`).
  - **Portal Sessions (Online Now)**: Real-time counter of staff members currently logged in with active portal sessions (`🟢 Online`).
  - **Inactive / Idle**: Staff members whose timers are currently paused due to inactivity (`🟡 Inactive`).
  - **On Lunch Break**: Staff members on official lunch break with paused shift timer (`🔵 On Lunch Break`).
  - **Checked Out**: Staff members who have completed their daily shift (`⚪ Checked Out`).
- **Activity Filter Toolbar & Accurate Date Navigation**:
  - **Default Date**: Automatically defaults to the actual current date in the configured office timezone (`Asia/Kolkata`).
  - **Date Navigation Controls**: Date picker with **◀ Prev Day** and **Next Day ▶** buttons, plus **"Today"** and **"Yesterday"** quick selectors, engineered with UTC-aligned date arithmetic to eliminate timezone or DST shifting.
  - **Dynamic Loading**: Changing the selected date immediately loads and calculates telemetry for all staff members on that specific calendar day.
  - **Staff Member Filter**: Filter the monitoring table by an individual staff member or view all personnel.
  - **Status Filter**: Filter by `Active`, `Inactive`, `On Lunch Break`, or `Checked Out`.
  - **Real-Time Search**: Instant keyword search matching staff name, ID, position, or department.
  - **Reset Filters & Refresh**: Quickly reset all filters or refresh live telemetry data on demand.
- **Activity Monitoring Table Columns**:
  1. **Staff Member**: Profile photo or initials avatar, employee name, ID, position, and live presence indicator (`🟢 Online` or `⚫ Offline`).
  2. **Current Status**: Real-time animated pulse badge (`Active`, `Inactive`, `On Lunch Break`, `Checked Out`, or `Not Checked In`).
  3. **Working Duration**: Net accumulated working time excluding pauses and lunch breaks.
  4. **Last Active**: Timestamp when the staff member was last active. Displays genuine `--:--` when no record exists. Never fabricates timestamps.
  5. **Inactive Start**: Timestamp when inactivity was detected (or most recent pause). Displays `--:--` when not applicable.
  6. **Resume Time**: Timestamp when the staff member resumed duty after inactivity. Displays `--:--` when not applicable.
  7. **Total Inactive**: Total accumulated inactive duration deducted from working hours.
  8. **Lunch Duration**: Total official lunch break duration taken (enforces ≥ 1m minimum delta).
  9. **Activity Timeline**: Action button (**"Timeline &rarr;"**) opening the detailed chronological audit modal.
- **Export Activity Summary (CSV)**:
  - Click **"Export Activity Summary"** to download `WorkPulse_Staff_Activity_Summary_[date].csv` containing comprehensive activity telemetry across all 12 duration and status fields.
- **Staff Activity History & Timeline Modal**:
  - Click **"Timeline &rarr;"** on any employee row to open the modal:
    - **Staff Dossier Header**: Displays profile photo, full name, employee ID, position, and department.
    - **Date Stepper**: Seamlessly step backward or forward through dates (**◀ Prev Day** / **Next Day ▶** / Date selector) without leaving the modal.
    - **4 Key Metric Cards**: Displays *Working Duration*, *Inactive Duration*, *Lunch Break*, and *Inactivity Count* for the chosen date.
    - **Visual Activity Distribution Bar**: Color-coded proportional strip (Green = Active work, Amber = Inactivity/Idle, Blue = Lunch Break) showing daily time distribution at a glance.
    - **Chronological Audit Timeline**: Step-by-step audit trail of every event throughout the day:
      - `09:05 AM — Check In` (GPS location stamped)
      - `09:05 AM–11:30 AM — Active` (Productive working duration)
      - `11:30 AM–11:45 AM — Inactive` (Trigger reason: System idle 15m or WorkPulse tab inactive 1h)
      - `11:45 AM — Active / Resumed` (Working timer continued)
      - `01:00 PM–01:30 PM — Lunch Break` (Deducted break)
      - `01:30 PM — Active` (Resumed after lunch)
      - `03:20 PM–04:05 PM — Inactive` (Second inactivity session logged)
      - `04:05 PM — Active` (Resumed)
      - `05:30 PM — Checked Out` (Manual shift checkout with verified net working hours)
    - **Print Timeline Audit**: Click **"Print Timeline Audit"** to generate a clean, print-ready hard copy of the staff member's daily timeline.

---

### 3.6 Staff Work & Project Management
Accessed via **"Staff Work Management"** (`nav-work`) in the sidebar, with two sub-tabs:

#### Assigning Tasks with Document Deliverables
1. Click **"+ Assign New Task"**.
2. **Form Fields**:
   - **Select Staff Member**: Select an individual employee from the roster or select `-- All Staff Members --`.
   - **Task Title**: Name of the task or milestone.
   - **Task Description**: Detailed instructions, objectives, and deliverables.
   - **Start Date & Due Date**: Date pickers for project scheduling.
   - **Priority**: Select `Low`, `Medium`, or `High`.
   - **Task Status**: Set initial status (`Pending`, `In Progress`, or `Completed`).
   - **Optional File/Document Upload**: Drag-and-drop or browse briefings, specs, or documents (PDF, DOCX, XLSX, PNG, JPG, ZIP up to 25MB).
3. **Buttons**: Click **"Assign Task"** or **"Cancel"**.
4. **Result**:
   - Saved immediately to persistent storage.
   - Automatically dispatches high-priority notification to the selected staff member.
   - Immediately visible in the employee's **"My Work"** section in the Staff Portal.
   - Rendered in the Admin Assigned Tasks table with interactive status changer, delete action, and deliverable review button.

#### Reviewing Deliverables & Providing Executive Feedback
1. In the **"Assigned Tasks"** tab, click **"Inspect & Review"** or click on any task row to open the **Admin Task Details & Deliverables Modal** (`#admin-task-detail-modal`).
2. **Reviewing Staff Deliverables**:
   - View assigned employee, priority, deadline, and task description.
   - Access **Staff Deliverables & Submissions**: Review the chronological list of employee submissions, status changes, progress comments, and timestamps.
   - Click any uploaded deliverable badge (e.g. `📎 Report.pdf`) to inspect or download the persistent file directly from `/uploads/`.
3. **Submitting Evaluation & Feedback**:
   - Select a performance rating from 1 to 5 Stars (`★★★★★ Outstanding` to `★☆☆☆☆ Inadequate`).
   - Enter written executive feedback, guidance, or next steps in the comments field.
   - Click **"Send Feedback to Staff"**.
   - The feedback is immediately saved to the backend database, attached to the task, and pushed to the staff member's portal with a real-time notification.

#### Daily Works Module (Staff Submissions & Review Evaluations)
Accessed directly via **"Daily Works"** (`nav-reviews`, `#reviews`) in the sidebar:
1. **Module Purpose**:
   - Inspect staff daily work submissions, review attached deliverable documents, provide executive feedback, and grade task performance.
2. **KPI Summary Cards**:
   - **Total Submissions**: Total count of all daily work submissions and deliverables (`stat-admin-reports-total`).
   - **Awaiting Review**: Submissions pending executive review (`stat-admin-reports-pending`).
   - **Approved Deliverables**: Submissions passing review standards (`stat-admin-reports-approved`).
   - **Needs Revision / Rejected**: Submissions requiring rework or revision (`stat-admin-reports-revision`).
3. **Filter Toolbar**:
   - Filter by Staff Member, Review Status (`⏳ Pending Review`, `✅ Approved`, `⚠️ Needs Revision`, `❌ Rejected`), Submission Date, and real-time Search (staff name, project, or task).
4. **Daily Works Submissions Table**:
   - Date, Staff Member (with avatar and designation), Project & linked Task, Accomplished Work description, Work Status, Deliverables (direct download link), and Review Decision & Rating.
5. **Evaluating Submissions & Submitting Ratings**:
   - Click **"⭐ Review & Evaluate"** (or **"✏️ Update Review"**) on any submission row to open the review modal (`#review-report-modal`):
     - Select **Review Decision** (`Approved`, `Needs Revision`, or `Rejected`).
     - Select **Performance Rating** (1 to 5 Stars: `Exceptional` to `Unsatisfactory`).
     - Provide **Executive Guidance & Actionable Feedback**.
     - Click **"Submit Review to Staff Portal"**.
   - The evaluation is immediately pushed to the staff member's **"My Reviews"** section in the Staff Portal with an instant notification.

#### Interactive Gantt Chart & Roadmap View
1. Switch to the **"Gantt Chart"** sub-tab in Staff Work Management.
2. **Timeline Visualizer & Roadmap Hierarchy**:
   - Displays all organizational projects as parent milestone bars and their underlying tasks as scheduled sub-bars along a continuous calendar timeline.
   - Project nodes include collapsible expand/collapse controls (`▶`/`▼`) allowing managers to collapse entire project workstreams or drill into specific task details.
   - **Start & Due Date Positioning**: Horizontal geometry automatically computes pixel offsets and spans based on `startDate` and `dueDate`.
   - **Subtask Progress Fill**: Task bars render an internal dark progress fill indicating the percentage of completed subtasks, with badge indicators (e.g., `✓ 2/4`).
3. **Strict 6-Color Status Classification**:
   - **Backlog**: Slate Grey (`#64748B`)
   - **To Do**: Royal Blue (`#2563EB`)
   - **In Progress**: Warm Amber (`#D97706`)
   - **In Review**: Vivid Purple (`#7C3AED`)
   - **Completed**: Emerald Green (`#059669`)
   - **On Hold**: Crimson Red (`#DC2626`)
4. **Real-Time Overdue Task Detection & Visual Alerts**:
   - Any uncompleted task (`status !== 'Completed'`) whose due date is earlier than today is automatically flagged.
   - Renders with a pulsing red outer glow, red status badges, and overdue indicators: `⚠️ Xd Late`.
   - **Overdue KPI Card**: Displays total overdue tasks count in the KPI metrics banner; clicking the card instantly filters the timeline to isolate overdue tasks.
5. **Interactive Controls, Zoom Scales & Filters**:
   - **Timeframe Zoom**: Toggle between **"Days"**, **"Weeks"**, and **"Months"** views to view fine-grained daily schedules or high-level executive roadmaps.
   - **Horizontal Panning**: **"‹ Prev"**, **"Today"**, and **"Next ›"** buttons provide quick calendar navigation, with automatic smooth scrolling to the current day on load.
   - **Multi-Parameter Filtering**: Filter simultaneously by Project, Staff Member, Task Status, and Search Query.
   - **Quick Reschedule Modal**: Click the pencil icon (`✎`) on any task row to quickly adjust start and due dates with full backend persistence (`PUT /api/tasks/:id`).
   - **Full Synchronization**: Clicking any project or task opens the native edit/detail modals, maintaining two-way synchronization with Projects, Kanban, and Tasks tables.
6. **Staff Portal Scoping**:
   - Accessible to staff members under **"My Work" &rarr; "My Gantt Chart"**.
   - Strictly scoped: Staff members only see projects and tasks where they are assigned (or assigned to all staff), protecting enterprise privacy.

---

### 3.7 Scheduling & Managing Executive Meetings
Accessed via **"Meetings & Briefings"** (`nav-meetings`) in the sidebar:
1. Click **"+ Schedule New Meeting"** (or click **"Edit"** on an existing meeting row).
2. Fill in Meeting Title, Date, Time, Duration (minutes), Venue or Video Conference URL (Google Meet, Zoom, Teams), and Agenda Description.
3. **Strict Future-Date Validation**:
   - The system checks the selected date and start time against the current local date and time.
   - If an administrator selects a date or time in the past for new meetings, scheduling is blocked immediately on both the frontend form and backend API with the standard alert:
     > **"Please select a future date and time."**
4. **All-Inclusive Staff Attendee Selector**:
   - The attendee selector provides complete visibility over all corporate staff members (`WP-1001` through `WP-1004`), displaying their full names alongside their organizational titles (e.g., `sneha (editor)`, `Abraham (junior)`, `Akash (editor)`, `Shamila (junior)`).
   - Select `-- All Staff Members --` to broadcast to the entire team, or select any specific employee.
5. **Deduplication Engine & Single-Flight Locks**:
   - Prevents duplicate meetings from multiple rapid submissions through an atomic UI lock (`isSubmittingMeeting`).
   - Generates unique cryptographic `MTG-` prefixed identifiers.
6. **Editing & Updating Meetings**:
   - Click **"Edit"** on any scheduled meeting to load its full parameters into the modal.
   - Updates are saved via `PATCH /api/meetings/:id` without creating duplicate records.
   - Click **"Cancel / Delete"** to purge a meeting via `DELETE /api/meetings/:id`.
7. **Instant Portal Notifications & Video Links**:
   - Check **"Send high-priority alerts to attendee Staff Self-Service Portals"**.
   - The meeting appears in the Meetings table with real-time status (`Upcoming`, `● Ongoing`, `Completed`, `Cancelled`) and displays in attendee Staff Portals with clickable conference links and dynamic alert banners.

---

### 3.8 Managing Workforce Requests (Leave Approval Comments & Mandatory Rejection Reasons)
Accessed via **"Leave Requests & Calendar Sync"** (`nav-requests`) in the sidebar:
- **Leave Requests View**:
  - Displays pending, approved, and rejected leave applications with staff name, position, avatar (initials or photo), requested date range, leave type, and employee justification.
  - **Accurate Staff Identity Binding**: Automatically cross-references and displays employee name and position (e.g. `Shamila`, `junior`, `WP-1004`) from the staff database. Never displays `undefined`.
  - **Approval Modal with Optional Comment (`#approve-leave-modal`)**:
    - Clicking **"✓ Approve (Turn Red)"** opens the approval dialog with employee details and date summary.
    - Includes an **"Approval Comment / Notes (Optional)"** textarea for administrative feedback, handover reminders, or conditional approval notes.
    - Submitting saves the approval status and optional comment to the database (`data/workpulse_db.json`), marks corresponding calendar days as Leave in attendance, updates the row to `🔴 Approved (Calendar Sync)`, and displays the Admin note in green.
  - **Mandatory Rejection Modal (`#reject-leave-modal`)**:
    - Clicking **"✕ Reject"** opens the dedicated rejection reason dialog.
    - Displays applicant name, position, leave type, dates, and employee's reason.
    - The **"Rejection Reason / Comments"** textarea is **strictly mandatory**.
    - If the admin attempts to submit without a reason, both frontend validation and backend REST API enforce rejection (`400 Bad Request: Rejection reason is mandatory when rejecting a leave request`).
    - Submitting saves the rejection reason, reviewer name (`Administrator`), and review timestamp to the database (`data/workpulse_db.json`).
    - The rejection reason is permanently rendered in the Admin table and in the employee's Staff Portal Leave History table with a red warning box.
- **Work From Home View**:
  - Review pending WFH applications with task agendas and approve or reject remote work requests with instant staff notifications and calendar synchronization.

---

### 3.9 Excel Bulk Import
- In the sidebar, click **"Import Staff (Excel)"** (`nav-import`).
- Download the standard Excel template (`.xlsx`), fill in staff records, and drag-and-drop to bulk onboard employees.

### 3.10 Office & Inactivity Settings
Accessed via **"Office Settings & Rules"** (`nav-settings`) in the sidebar:

#### Enterprise Office & Calendar Configuration
- **Office Timezone**: Configurable IANA timezone identifier (e.g. `Asia/Kolkata`, `America/New_York`, `Europe/London`, `UTC`).
  - Governs live executive and staff clocks.
  - Formats all self-attendance punch timestamps and timesheet audit records.
  - Normalizes net shift duration math across different client machine timezones.
- **Configured Weekly Holidays**: Selectable weekly rest days (e.g. `Sunday`, `Saturday & Sunday`).
  - Automatically evaluated across all monthly attendance grids.
  - Dynamically calculates the accurate number of standard working days for any selected month:
    $$\text{Total Working Days} = \text{Calendar Days in Month} - \text{Configured Weekly Holidays in Month}$$
- **Office Geofence & Coordinates**: Latitude and Longitude coordinates paired with a configurable geofence radius (e.g., `150m`). Validates live browser GPS punches during staff self-attendance check-in.

#### Attendance & Inactivity Detection Settings
- **System-Wide Inactivity Timeout (Minutes)**: Configurable threshold (Default: `15` minutes) for operating-system level idle detection (Chromium `IdleDetector` API: screen lock or zero mouse/keyboard activity across the entire computer).
- **WorkPulse Tab Inactivity Timeout (Minutes)**: Configurable threshold (Default: `60` minutes) for tab-specific inactivity (no clicks, keystrokes, scrolling, or mouse movements within the WorkPulse browser tab).
- **Dual OR Evaluation Logic**: If **either** the system-wide idle threshold **or** the tab inactivity threshold is reached, the staff working timer automatically pauses. Inactive duration is excluded from payable working hours. Automatic checkout **never** occurs due to inactivity.
- **Input Validation**: Accepts positive whole integers between `1` and `720` minutes (up to 12 hours). Prevents zero, negative, or invalid values.
- **Dedicated "Save Settings" Button**: Saves settings to both persistent storage (`data/workpulse_db.json`) and `localStorage`. Updates take effect immediately across all active staff sessions without requiring page reloads.

---

### 3.11 Sidebar Navigation, Routing & Refresh Persistence
- The left executive sidebar is styled in classic corporate dark navy (`#0A192F`).
- **Independent Vertical Scrolling**:
  - When the browser viewport height is limited (laptops or zoomed displays), the sidebar scrolls vertically with an elegant low-profile gold scrollbar.
  - The main page content remains fixed and does not scroll together with the sidebar.
  - The Administration section (Import Staff, Reports & Audit, Office Settings) and the Director profile footer remain accessible at all times.
- **Seamless URL Hash Routing & Browser Refresh Persistence**:
  - Every sidebar link updates the browser URL hash (e.g., `#dashboard`, `#staff`, `#attendance`, `#activity`, `#work`, `#reviews` for Daily Works, `#meetings`, `#clients`, `#leads`, `#domains`, `#settings`).
  - Refreshing the browser (`F5` / reload) automatically restores and keeps the user on their active module instead of unexpectedly redirecting to the Executive Dashboard.
  - Interactive Dashboard KPI cards (`Total Staff`, `Present Today`, `Leave Requests`, `WFH Requests`, `Reports`) feature deep-link navigation directly to their respective modules.
  - Browser Back and Forward buttons are fully supported via live `hashchange` event listeners.

---

### 3.12 Admin Profile & Account Settings
The Administrator can view and update their personal profile, corporate credentials, photo, and password at any time:

#### Accessing Admin Profile Settings
1. **Sidebar Footer**: Click on the Admin profile chip at the bottom of the left sidebar (`#sidebar-admin-chip`), displaying the administrator's initials and name.
2. **Office Settings**: In **"Office Settings & Rules"** (`#pane-settings`), view the **Executive Admin Account & Security Profile** card at the top and click **"Edit Admin Profile & Password"**.

#### Configurable Profile Fields
- **Profile Photo**: Click **"Upload New Photo"** to choose an image (JPG, PNG, WebP). The image is automatically scaled, cropped, stored to persistent storage (`/uploads/`), and synchronized across browsers. Click **"Remove Photo"** to revert to standard corporate initials.
- **Admin Full Name**: Edit your actual corporate name (replaces any temporary testing name).
- **Corporate Email Address**: Update your primary corporate email used for login authentication.
- **Position / Executive Role**: Specify your executive title (e.g., Executive Director).

#### Secure Password Updating
- In the **Change Login Password** panel inside the modal, enter your **Current Password** to verify identity, followed by **New Password** (minimum 6 characters) and **Confirm New Password**.
- If password fields are left blank, existing login credentials remain completely unchanged and preserved.
- All updates are saved permanently to the database (`data/workpulse_db.json`) and synchronized across devices via `PUT /api/admin/profile` and `POST /api/sync`.

---

### 3.13 Client Management (Multi-Project Portfolios & Financial Dossiers)
Accessed via **"Client Management"** (`nav-clients`) under the **"CRM & Growth"** sidebar group:

#### 1. Executive Summary Cards (Top Grid)
Calculated dynamically from real database records in `data/workpulse_db.json`:
- **Total Clients**: Number of corporate client accounts registered in the database. Clicking instantly clears all filters.
- **Active Clients**: Count of corporate clients with active ongoing deliverables (`In Progress`, `Planning`, or `On Hold`). Clicking filters by `Active`.
- **Total Projects**: Cumulative count of all assigned client deliverables and portfolio engagements across all clients (displaying total portfolio value sum). Clicking filters clients with assigned projects.

#### 2. Enterprise Client Master Table & Multi-Project Hierarchy
- **Clean, Professional Table Layout**:
  - **Client Name**: Formatted name with personalized avatar initials pill and client ID; clicking the name or avatar immediately opens the complete client profile modal.
  - **Company**: Corporate entity name and physical office address.
  - **Phone**: Clickable direct dialing link (`tel:`).
  - **Email**: Clickable direct mail composition link (`mailto:`).
  - **Assigned Projects**: Dynamic project counter badge displaying total engagements with hover tooltip listing all project names; clicking immediately opens the client profile.
  - **Project Amount**: Tabular formatted currency sum across all client contracts with subtext breakdown (`Paid: X · Due: Y`).
  - **Status**: Derived status badge (`Active`, `Completed`, `On Hold`, or `New / No Projects`).
  - **Actions**: Direct access buttons for **Profile** dossier, **+ Project** quick assignment, **Edit** client details, and **Delete** record.
- **Interactive Multi-Filter, Search, Sorting & Pagination Toolbar**:
  - **Real-time Search**: Search across client name, company, email, phone, and project names.
  - **Status Filter**: Filter by `All Statuses`, `Active`, `Completed`, `On Hold`, or `New / No Projects`.
  - **Service Type Filter**: Filter by specific technical service (`Cloud Architecture & DevOps`, `Enterprise Software`, `Web Application Development`, `Mobile App Development`, `Cybersecurity & Compliance`, `AI & Machine Learning`, `IT Consulting & Infrastructure`, `UI/UX Strategy`).
  - **Payment Status Filter**: Filter by `Paid`, `Partially Paid`, `Pending`, or `Overdue`.
  - **Sort Dropdown**: Sort by Newest First, Name (A→Z), Name (Z→A), Company (A→Z), Amount (High→Low), Amount (Low→High), or Most Projects.
  - **Reset Filters**: One-click reset restoring default table view.
  - **Pagination Controls**: Configurable page sizes (10, 25, 50 rows per page), live record counter, and responsive page navigation buttons.
  - **Export CSV**: One-click download exporting all client records, contacts, project counts, financial metrics, and payment statuses to CSV spreadsheet.

#### 3. Complete Client Portfolio Profile (Full-Page View: `#pane-client-profile`)
Clicking any client row, name, project counter, or **"Profile"** action button in the Client Management directory opens the complete corporate dossier in a dedicated, full-page view (`#pane-client-profile`) taking advantage of the entire available screen width and height:
- **Navigation Bar & Breadcrumbs**:
  - **← Back to Client Management**: Prominent top button returning directly to the Client Management table with one click or browser back navigation.
  - **Breadcrumbs Path**: `Clients / [Client Name] (ID: CLI-...)` providing clear context and instant navigation.
  - **Quick Action Buttons**: Directly accessible `✏️ Edit Profile` and `💳 Record Payment` actions.
- **Client Hero Dossier**: Full-width executive gradient banner featuring personalized initials avatar, corporate name, company affiliation, address, clickable direct phone and email contact links, and primary action controls:
  - **✏️ Edit Profile**: Opens the client edit modal (`#client-modal`, elevated `z-index: 10010`) to update client name, company, phone, email, and billing address. Connected directly to authoritative backend REST API (`PUT /api/clients/:id`) with immediate database persistence and live profile refresh.
  - **💳 Record Payment**: Opens the payment installment modal (`#client-payment-modal`, elevated `z-index: 10010`) to immediately record payments against any contracted project deliverable. Seamlessly supports both existing and newly created clients with automatic deliverable provisioning so administrators are never blocked.
  - **Clean, Streamlined Layout (Assign Project Button Removed)**: The redundant `+ Assign Project` button has been completely removed from the Client Profile header and Projects tab. All project scopes, deliverable details, contract values, and staff assignments are established directly upon client creation or maintained via Edit Profile, resulting in a balanced, uncluttered dossier interface.
- **Financial & Operational KPI Bar (4 Spacious Summary Cards)**:
  - **Total Projects**: Total assigned deliverables and active count in progress (Royal Blue accent).
  - **Portfolio Value**: Aggregate contract revenue across all projects (Gold Primary accent).
  - **Total Paid**: Aggregate received revenue from advances and installments (Emerald Green accent).
  - **Balance Due**: Outstanding receivables with real-time settlement status (`Receivables outstanding` or `All contracts settled in full ✓`).
- **Tabbed Navigation Structure (Full-Width Responsive Tabs)**:
  - **Tab 1: Projects Portfolio**: Comprehensive project cards displaying deliverable scope, assigned staff lead, milestone progress bar, contract financials, linked domains, and project actions (**"+ Add Domain"**, **"+ Payment"**, **"Edit"**, **"Delete"**).
  - **Tab 2: Payment Ledger & Tracking**: Project-by-project contract receivables breakdown and chronological payment installment ledger with method breakdown, reference notes, and live balances.
  - **Tab 3: Domains & Hosting**: Centralized live-synchronized view of all corporate domain names, SSL certificates, DNS servers, and web hosting infrastructure linked to the client's projects. Features a **"+ Add Domain"** button that opens `#domain-modal` with client and project automatically linked, and quick link to **"Manage in Domains Module"**.
  - **Tab 4: Notes & Discussion**: Add communication note form for logging meetings, client check-ins, milestone agreements, and account directives, plus a feed of past notes with timestamps.
  - **Tab 5: Activity History**: Complete chronological audit log of all account lifecycle events: registration, updates, status changes, milestone progress, payment recordings, and note additions.

#### 4. Project Management, Modal Layering & Payment Tracking Modals
- **Elevated Stacking Architecture (`z-index: 10010`) & Notification Visibility (`z-index: 99999`)**:
  - To prevent modals from rendering behind the Client Profile dossier (`z-index: 9999`), all child action modals—**Add / Edit Client** (`#client-modal`), **Record Payment** (`#client-payment-modal`), and **Add / Edit Domain** (`#domain-modal`)—operate at `z-index: 10010`.
  - Child modals overlay the Client Profile cleanly without closing or resetting the parent dossier context.
  - The universal toast notification container (`.toast-container`) is styled with fixed positioning (`top: 24px; right: 24px; z-index: 99999;`) guaranteeing that system alerts and confirmation toasts render prominently on top of all modal layers.
- **Asynchronous Submission, Duplicate Protection & Form State Reset**:
  - **Authoritative Single-Record Creation**: Clicking **"Save Client Account"** dispatches an authoritative `POST /api/clients` request to the backend database. Upon confirmation (HTTP 201), the authoritative client record with its permanent unique Client ID (`CLI-...`) is integrated directly into the local database cache with background echo-sync suppressed (`skipSync = true`), ensuring each Save operation creates exactly ONE client record and completely eliminates duplicate records.
  - **Submission Protection & Loading State**: While a client account is being saved, the button is immediately protected against rapid double-clicks (`isSavingClient = true; btnSave.disabled = true;`), displaying a live spinner with `"Creating Client..."` (or `"Saving Changes..."` for edits).
  - **Automatic Form State Reset (`resetClientForm`)**: Upon successful save, the form state is automatically reset—clearing client name, company, phone, email, address, and optional project scope inputs—and the modal is closed. When opening **"Add New Client"** (`#btn-open-add-client`), `openAddClientModal()` executes a fresh `resetClientForm()` and explicitly re-enables the Save button with `"Save Client Account"`, ensuring the form works cleanly and reliably every time it is opened.
  - **Error Preservation & In-Modal Alert Banner**: If saving fails (e.g. duplicate client collision or server network error), the form remains open, all user inputs are strictly preserved, the Save button is re-enabled immediately, and the exact error is prominently displayed inside the modal via `#client-form-error` and via system toast.
  - Accidental dismissal via background backdrop clicks or Escape key is suppressed while saving is in progress.
- **Add / Edit Project Modal (`#client-project-modal`)**:
  - Full project schema validation (Service Type, Scope, Staff Lead, Amount, Advance, Dates, Progress, Payment Status).
- **Record Payment Modal (`#client-payment-modal`)**:
  - Openable directly from the client profile header, projects tab, or table action.
  - Displays target project dropdown with live contract sums and balances due.
  - Captures Installment Amount, Payment Date, Payment Method (Bank Transfer, Wire, Card, Check, Cash, Other), and Reference/Notes.
  - Persists directly to `POST /api/clients/:id/projects/:projectId/payments`, recalculates balance due, updates project payment status, appends ledger entry, and updates dossier KPI cards in real time.

#### 5. Duplicate Client Prevention & Unique Client IDs
- **Unique Client ID Generation**:
  - Every client record created by the backend or client engine is assigned a guaranteed unique identifier formatted as `CLI-[timestamp]-[entropy]` (e.g., `CLI-1793701234567-4821`), preventing collisions during rapid multi-client creations.
- **Smart Duplicate Prevention**:
  - Both frontend controller and backend REST API validate phone numbers (digit-normalized) and email addresses (case-insensitive) against existing database records.
  - **Edit-Safe Verification**: When updating an existing client profile, duplicate checks are only evaluated if the administrator actually modified the phone number or email address, preventing false-positive duplicate rejections on existing records.
  - If a new collision is detected, submission is blocked with an informative notification and HTTP 409 Conflict detailing the conflicting client name and company.
- **Lead-to-Client Deduplication**:
  - When converting a qualified lead from the Lead Pipeline to a client (`convertLeadToClient`), the system checks for existing clients matching the lead's phone or email.
  - If an existing client matches, the system reuses that client account and attaches the won lead as a new project in their portfolio rather than creating a duplicate client record.

#### 6. REST API Endpoints
- `GET /api/clients`: Retrieve all clients with optional `search`, `status`, `serviceType`, and `paymentStatus` filters.
- `GET /api/clients/summary`: Retrieve live KPI counts and monetary sums across all registered clients.
- `GET /api/clients/:id`: Retrieve complete client record including all projects, notes, and activity history.
- `POST /api/clients`: Create new client with duplicate prevention (returns 409 on conflict).
- `PUT /api/clients/:id`: Update client details with duplicate prevention (returns 409 on conflict).
- `DELETE /api/clients/:id`: Remove client record and associated portfolio.
- `POST /api/clients/:id/projects`: Attach a new project to client portfolio.
- `PUT /api/clients/:id/projects/:projectId`: Update existing client project details.
- `DELETE /api/clients/:id/projects/:projectId`: Delete project from client portfolio.
- `POST /api/clients/:id/projects/:projectId/payments`: Record payment installment for a project.
- `POST /api/clients/:id/notes`: Append communication note to client dossier.

---

### 3.14 Lead Management & Acquisition Pipeline
Accessed via **"Lead Management"** (`nav-leads`) under the **"CRM & Growth"** sidebar group in the Admin Console:

#### 1. Lead Dashboard (6 Summary Cards)
Directly calculated from actual database records:
- **Total Leads**: Total prospective client deals and aggregate pipeline value. Clicking isolates all leads.
- **New Leads**: Uncontacted inquiries requiring qualification. Clicking filters leads with status `New`.
- **Follow-ups Due Today**: Follow-ups scheduled for the current date (`today`). Clicking immediately displays today's agenda.
- **Overdue Follow-ups**: Critical alert KPI with a **pulsing red outer glow** (`@keyframes pulse-overdue`) highlighting leads whose scheduled follow-up date has elapsed. Clicking immediately isolates overdue prospects.
- **Converted Leads**: Successfully closed deals with total won revenue. Clicking filters `Converted` leads.
- **Lost Leads**: Disqualified or cancelled leads with lost revenue analytics. Clicking isolates `Lost` leads.

#### 2. Lead Management & CRUD Operations
- **Add / Edit Lead**: Full modal dialog (`#lead-modal`) capturing:
  - **Prospect Details**: Full Name, Company Name, Phone, and Email.
  - **Commercial Details**: Interested Service (Web Development, Mobile App, Cloud Solutions, etc.), Lead Source (Website, Inbound Call, LinkedIn, Referral, Google Ads, Other), and Expected Project Amount.
  - **Operations Details**: Created Date, Assigned Telecaller Staff, Initial Status, Next Action, and Discussion Notes.
- **Duplicate Prevention**: Real-time validation rejecting submissions if another lead shares the same normalized phone number or email address (HTTP 409 Conflict with detailed error message).
- **Search, Sorting & Pagination**:
  - Live search across name, company, email, phone, and service.
  - Multi-criteria filters: Status (`All`, `New`, `Contacted`, `Follow-up`, `Interested`, `Converted`, `Lost`), Telecaller, Service, and Timeframe (`All`, `Due Today`, `Overdue`, `Upcoming`, `This Month`).
  - Sorting options: Created Date (Newest/Oldest), Follow-up Date (Earliest/Latest), Expected Amount (High to Low / Low to High), and Lead Name (A-Z).
  - Clean pagination controls (10 leads per page) with page number indicators and Next/Prev buttons.

#### 3. Lead Details & Profile Hub (`#lead-notes-modal`)
- Clicking any lead name or the **"Profile"** action button opens the comprehensive profile dialog:
  - **Contact & Deal Overview**: Direct `tel:` and `mailto:` links, commercial value, interested service, lead source, and creation date.
  - **Inline Telecaller Reassignment**: Admin can dynamically reassign the lead to any active staff member with instant database persistence.
  - **Follow-up Scheduler**: Dedicated fields for Next Follow-up Date, Time, and specific Next Action step.
  - **Call Logs & Discussion Notes**: Form to log call outcomes, objections, and next actions with author attribution and timestamps.
  - **Chronological Activity History**: Complete timeline displaying call logs, telecaller assignments, and status transitions.

#### 4. Follow-up Management & Urgency Indicators
- Visual, color-coded urgency badges on table rows and Kanban cards:
  - **Today** (`badge-followup-today`): Amber badge with clock icon for follow-ups due today.
  - **Overdue** (`badge-followup-overdue`): Crimson red badge with alert triangle and pulsing glow animation (`@keyframes pulse-overdue`) for overdue follow-ups.
  - **Upcoming** (`badge-followup-upcoming`): Subtle blue badge displaying scheduled date and time.
  - **None** (`badge-followup-none`): Slate indicator prompting to schedule follow-up.

#### 5. Dual Presentation: Kanban Board & High-Density Table
- **Kanban Board (`#lead-kanban-board-container`)**:
  - 6 distinct columns: **New** (Navy Blue), **Contacted** (Amber), **Follow-up** (Purple), **Interested** (Gold), **Converted** (Emerald Green), **Lost** (Slate Grey).
  - HTML5 Drag-and-Drop: Dragging a card across columns updates lead status via `PATCH /api/leads/:id/status` and recalculates pipeline metrics instantly.
- **Table View (`#lead-table-view-container`)**:
  - High-density tabular layout with Lead Name (clickable profile link), Company, Contact, Service, Telecaller avatar badge, Urgency badge, Expected Amount, Status pill, and Action buttons (Profile, Edit, Convert, Delete).

#### 6. Telecaller Staff Isolation & Permissions
- Telecaller staff members logging into the Staff Portal (`staff.html`) only see prospects assigned to them (`assignedStaffId === currentUser.id`).
- Backend enforcement: `GET /api/leads` scopes records to the authenticated user ID for staff roles. Staff attempts to delete leads are rejected with HTTP 403 Forbidden.

#### 7. One-Click "Convert to Client" Workflow
- Qualified leads can be converted into official corporate clients with a single click in the lead profile or table row.
- **Deduplication Safeguard**: Automatically checks if a client with the same phone or email already exists. If found, the existing client profile is reused, preventing duplicate clients.
- Transfers the lead's company, contact person, phone, email, and creates an initial project with the expected amount and interested service.
- Preserves lead history, marks lead status as `Converted`, and logs a conversion audit entry.

#### 8. Telecaller Performance Reports & Excel I/O
- **Telecaller Analytics Modal (`#telecaller-reports-modal`)**:
  - Breakdown per telecaller: Total Assigned, Active Leads, Follow-ups Due Today, Overdue Follow-ups, Completed Follow-ups, Converted Count, Conversion Rate (%), and Total Won Revenue.
- **Excel Export (`#btn-export-leads-excel`)**:
  - Generates and downloads a clean, styled `.xlsx` spreadsheet of all leads with formatted columns using SheetJS.
- **Excel Import (`#btn-import-leads-excel`)**:
  - Accepts `.xlsx` and `.csv` files. Validates required fields, checks for duplicate phone/email against existing records, and bulk imports valid prospects.

---

### 3.15 Domain & Hosting Management (Corporate Assets, Client Portfolios & Renewal Tracking)

Accessed via **"Domain & Hosting"** (`#nav-domains`) under the **"CRM & Growth"** sidebar group in the Admin Console:

#### 1. Overview & Core Capabilities
- Centralized enterprise asset tracking for all domains, hosting servers, and SSL certificates linked directly to corporate clients and specific deliverables.
- **Mandatory Client & Project Linking**: **Every domain and hosting record in WorkPulse must be linked to both a Client and a specific Project**. Unlinked or orphaned domain records are strictly prohibited at both the database and UI layers.
- **Deep Bidirectional Integration with Client Management**: Full integration between Client Management project portfolios and Domain & Hosting Management. When adding a domain or hosting under Client Management, selecting the relevant Client and specific Project is strictly mandatory. All records synchronize automatically without creating duplicate database entries.
- Full CRUD operations: Add, Edit, View Technical Dossier, Record Renewal Cycles, and Delete domain records.
- Comprehensive data fields:
  - Domain Name, Linked Client Profile (Mandatory), Linked Project (Mandatory).
  - Registrar (GoDaddy, Namecheap, Cloudflare, Route 53, etc.), Registration Date, Expiry Date, Renewal Cost, Currency, Auto-Renew status.
  - Hosting Provider (AWS, DigitalOcean, Hostinger, Vercel, Netlify, cPanel, etc.), Hosting Plan / Tier, Hosting Renewal Date, Server IP Address, Nameservers & DNS records.
  - SSL Certificate Status (`Active`, `Expiring Soon`, `Expired`), SSL Issuer, SSL Expiry Date.
  - Assigned Technical Staff Handler, Administrative Notes, Configuration Documents / Links.

#### 2. Enterprise Table View & Dedicated Client & Project Display
The domain list is presented in an enterprise data table (`#domain-table`) featuring dedicated, sortable columns presenting all essential operational fields:
1. **Domain Name**: Clickable domain URL (opens external link in new tab), SSL status badge (`🔒 Active`, `⚠️ Expiring Soon`, `❌ Expired`), registrar name, and server IP address.
2. **Client Name**: Dedicated Client badge with one-click navigation to their Client Profile (`👤 Client Name (Company)`) displayed for **every record**.
3. **Project Name**: Dedicated Project badge (`📁 Project Name`) with one-click navigation to the project in the Client Profile Projects tab displayed for **every record**.
4. **Hosting Provider**: Hosting provider name (e.g. AWS Cloud, Cloudflare, Hostinger), active hosting plan/tier, and nameserver/DNS summary.
5. **Registration Date**: Official domain registration date (`📅 DD-MM-YYYY`) or indicator (`—`).
6. **Expiry Date**: Primary expiry date (`📅 DD-MM-YYYY`) accompanied by real-time relative countdown badges (`⚠️ Expired X days ago`, `⏳ Expires in X days`, `✓ X days left`).
7. **Renewal Amount**: Formatted financial renewal commitment (e.g., `USD 120.00`) and Auto-Renew indicator pill (`✓ Auto-Renew` or `Manual Renew`).
8. **Status**: High-contrast, clear expiry status badges:
   - **Active (Green Badge with ● Indicator)**: Domain has more than 30 days remaining before expiration.
   - **Expiring Soon (Amber/Orange Badge with ⏳ Indicator)**: Domain expires within 30 days (`0 <= daysRemaining <= 30`), triggering proactive renewal alerts.
   - **Expired (Red Badge with ⚠️ Indicator)**: Expiry date has passed (`daysRemaining < 0`), requiring immediate registrar recovery.
9. **Actions**: Quick-action buttons for View Technical Dossier, Record Renewal Cycle, Edit Domain & Hosting Details, and Delete Record.

#### 3. Search, Multi-Dimensional Filters & Client/Project Drilldown
The module provides an advanced search and filtering toolbar that operates in real time across the database, leveraging the Client and Project relationships:
- **Live Search Input** (`#domain-search-input`): Instant search across domain names, linked Client Names, linked Project Names, hosting providers, server IPs, registrars, and administrative notes.
- **Status Filter** (`#domain-filter-status`): Isolate records by lifecycle status: `All Statuses`, `Active`, `Expiring Soon`, and `Expired`.
- **Client Filter** (`#domain-filter-client`): Dynamically populated from active client records:
  - `All Clients`: Show all portfolios.
  - Specific client accounts (e.g., `👤 ASWIN (UNIK)`, `👤 Ammu (djfnd)`, `👤 WorkPulse Internal`).
- **Project Filter** (`#domain-filter-project`): Dynamically populated based on the selected Client:
  - When `All Clients` is selected, lists all projects across client accounts.
  - When a specific client is selected, dynamically narrows to that client's specific deliverables.
- **Hosting Provider Filter** (`#domain-filter-host`): Dynamically populated with all distinct hosting providers detected in real database records (e.g., AWS, DigitalOcean, Hostinger, Vercel, Netlify, cPanel, Google Cloud Platform, SiteGround).
- **Expiry Date Filters** (`#domain-filter-expiry` & Quick Filter Pills `#domain-expiry-pills`):
  - **Expired**: Displays all domains past their expiration date.
  - **Expiring in 7 days**: Isolates urgent renewals due within the next 7 calendar days.
  - **Expiring in 15 days**: Isolates high-priority renewals due within the next 15 calendar days.
  - **Expiring in 30 days**: Isolates renewals due within the standard 30-day operational renewal window.
  - **Expiring in 60 days**: Broad quarterly planning filter capturing renewals due within 60 calendar days.
  - **Custom date range** (`#domain-custom-range-wrap`): Allows administrators to specify arbitrary **From** and **To** dates (`#domain-filter-start-date`, `#domain-filter-end-date`) with instant "Apply" and "Clear" controls.
- **One-Click Reset** (`#btn-reset-domain-filters`): Instantly clears all search queries, active filters (including client and project filters), and custom date ranges back to initial defaults.

#### 4. Advanced Sorting Options & Interactive Column Headers
Administrators can sort the domain dataset via the sort dropdown (`#domain-sort-by`) or by clicking directly on any table header:
- **Nearest Expiry Date** (`expiry-asc`): Orders records chronologically with soonest expiring (and expired) domains first.
- **Latest Expiry Date** (`expiry-desc`): Orders records in reverse chronological order with furthest expiring domains first.
- **Domain Name (A to Z / Z to A)** (`name-asc`, `name-desc`): Alphabetical ordering by domain name.
- **Client Name (A to Z)** (`client-asc`): Alphabetical grouping by linked client portfolio.
- **Project Name (A to Z)** (`project-asc`): Alphabetical grouping by linked project name.
- **Registration Date (Newest First)** (`regdate-desc`): Chronological order by initial registration date.
- **Renewal Amount (High to Low / Low to High)** (`cost-desc`, `cost-asc`): Sorts by financial commitment.
- **Date Added (Newest First)** (`created-desc`): Reverse chronological order by creation date.
- **Clickable Column Headers**: Clicking "Domain Name", "Client Name", "Project Name", "Hosting Provider", "Registration Date", "Expiry Date", "Renewal Amount", or "Status" toggles ascending/descending sort with dynamic arrow indicators (`▲` / `▼`).

#### 5. Technical Dossier with Complete Client & Project Details
Clicking the eye icon on any domain opens the Technical Dossier (`viewDomainDetails`), displaying complete linked context:
- **Linked Client Profile Dossier**: Client Name, Company, Email, Phone, Account Status badge, Total Projects count, Total Portfolio Valuation, and 1-click button to open full Client Profile.
- **Linked Project Milestone Dossier**: Project Name, Service Type, Milestone Status, Progress %, Financials (Total Project Amount, Advance Paid, Balance Due), Timeline dates, Assigned Technical Staff Lead, and 1-click button to open the project under Client Profile.
- **Hosting, Server & SSL Specifications**: Provider, plan, server IP address, renewal date, SSL issuer and expiry date, nameservers, and administrative notes.
- **Complete Renewal Audit Trail**: Full history table of past renewals with dates, cycle extensions, amounts paid, payment methods, and recording administrator.

#### 6. Client Management Project Integration & Bidirectional Workflow
WorkPulse links Client Management and Domain Management into a unified workflow:
- **Client → Project → Add Domain**: When adding or editing a project under a Client Profile (`#client-project-modal`), administrators can optionally fill out the "Linked Domain & Web Hosting" section (Domain Name, Hosting Provider, Registration Date, Expiry Date, Renewal Cost). Upon saving, the backend automatically provisions or updates the corresponding record in `db.domains` linked to both the Client and that Project.
- **Direct Project Domain Action**: Each project card in the Client Profile Projects tab features a `🌐 + Add Domain` button that opens the Domain modal (`#domain-modal`) with both Client and Project automatically preselected.
- **Mandatory Selection Under Client Profile Domains Tab**: Clicking `+ Add Domain` from the Client Profile Domains tab links the domain to a specific deliverable project under that client. If an existing or legacy client has zero projects, the system automatically provisions an initial primary deliverables scope (`Deliverables & Services`) so administrators are never blocked when registering domain assets.
- **"Save Domain Record" Form Submission & Validation Engine**:
  - **Form Validation**: Strict client-side and server-side validation checks ensure no required fields are omitted:
    - *Domain Name* (Required): Validates input, automatically stripping protocol prefixes (`http://`, `https://`) and trailing path slashes.
    - *Linked Client Account* (Required): Every domain must be associated with an active client.
    - *Linked Client Project* (Required): Every domain must be linked to a specific project milestone deliverable.
    - *Expiry Date* (Required): Valid renewal cutoff date.
    - *Renewal Cost*: Must be a non-negative numerical amount.
    - *Chronological Consistency*: Expiry date cannot precede registration date.
  - **Asynchronous Submission & Loading Indicator**:
    - Clicking **"Save Domain Record"** (`#btn-save-domain`) or pressing Enter locks the submission state (`isSavingDomain = true`) to prevent accidental duplicate requests.
    - The form **does not close** when the button is clicked. A visible animated spinner and `"Saving..."` state appear on the button while communicating with the backend.
    - Modal dismissal via outside backdrop clicks or the Escape key is temporarily guarded while the save operation is in flight.
  - **Error Handling & Data Preservation**:
    - If validation fails or the server returns an error (e.g., duplicate domain name HTTP 409, database conflict), the form **remains open**.
    - A dedicated red error alert banner (`#domain-form-error`) displays the specific error reason alongside a notification toast.
    - **All entered fields are preserved**: None of the entered domain, hosting, server IP, DNS, or notes details are cleared, allowing the administrator to adjust the input and retry without re-typing.
  - **Confirmation & Automatic Post-Save Refresh**:
    - The modal closes **strictly after receiving confirmation** from the backend database (HTTP 200/201).
    - A success notification is displayed (e.g., `Domain "example.com" saved successfully!`).
    - The Domain & Hosting Management list table, summary metrics cards, and filter dropdowns refresh automatically.
    - If the Client Profile modal is open, its project list and Domains tab refresh immediately to display the newly linked asset.
- **Dedicated Project Domain Table**: Under each project in the Client Profile, a dedicated table displays all linked domains with live statuses, expiry countdowns, hosting providers, renewal amounts, and direct actions (View Dossier, Edit, Delete).
- **Single Source of Truth & Zero Duplication**: Both modules query and modify the same database records (`db.domains` in `data/workpulse_db.json`). Client objects do not duplicate domain records, preventing data drift or synchronization divergence. Duplicate domain registrations are blocked immediately (HTTP 409).
- **Referential Integrity & Safe Removal**: Deleting a domain unlinks safely without affecting the client profile or project deliverables. Deleting a client or client project that has active linked domain records is blocked with a validation error, requiring the administrator to reassign or delete the domain first, preventing unlinked or orphaned records.
- **Real-Time Bidirectional Updates**: Modifying domain details (e.g. renewal cost, hosting provider, expiry date) in Domain Management immediately reflects in Client Management; renaming a project or client in Client Management dynamically reflects in Domain Management.
- **Export CSV** (`#btn-export-domains`): One-click download of all domain records, technical specifications, linked clients, and linked projects into a formatted CSV report.

---

### 3.16 Corporate Miscellaneous Hub (General Requests, Assets, Maintenance, Notes & Documents)

Accessed via **"Miscellaneous"** (`#nav-misc`) under the **"Administration"** sidebar group in the Admin Console:

#### 1. Executive Miscellaneous KPIs & Subtab Navigation
- **Executive Metric Cards**:
  - **General Requests**: Total requests count and pending approval counter with gold accent highlight.
  - **Office Assets**: Active inventory count and allocated equipment metrics.
  - **Open Maintenance**: Facilities issues requiring repair, assigned staff, or resolution.
  - **Internal Notes**: Active corporate reminders, announcements, and pinned notices.
  - **Office Documents**: Shared compliance documents, templates, and company guidelines.
- **Unified Subtab Navigation**: Seamless navigation across all 5 operational sections without page reloads:
  - `General Requests` (`#misc-subtab-requests`)
  - `Office Assets` (`#misc-subtab-assets`)
  - `Office Maintenance` (`#misc-subtab-maintenance`)
  - `Internal Notes & Reminders` (`#misc-subtab-notes`)
  - `General Documents` (`#misc-subtab-documents`)

#### 2. General Requests Governance
- Staff submit purchase, equipment, and service requests from their portal.
- **Administrative Actions**:
  - Review request details, priority badge (`Urgent`, `High`, `Medium`, `Low`), and category.
  - One-click status actions: **Approve**, **Reject**, or **Complete**.
  - Interactive details modal (`#misc-details-modal`) featuring real-time threaded comments between Staff and Administration.
  - Automated counter badge (`#badge-misc-count`) in the Admin sidebar alerting when new pending requests arrive.

#### 3. Office Assets & Inventory Registry
- **Comprehensive Asset Dossiers**:
  - Asset title, category, condition (`Brand New`, `Excellent`, `Good`, `Needs Repair`), serial number/asset tag, purchase date, and estimated return date.
  - Staff assignment: Assign equipment to any active staff member with automatic staff directory dropdowns.
  - Asset status tracking: `Available`, `Assigned`, `Under Maintenance`, `Retired`.
  - Filter by condition, allocation status, and staff member with instant search.

#### 4. Office Maintenance & Facility Management
- **Issue Tracking & Dispatch**:
  - Log and review maintenance tickets (HVAC, plumbing, electrical, IT hardware, sanitation).
  - Facility location, description, urgency priority, and reported date.
  - Assign technician or staff member to handle the incident.
  - Status progression: `Reported` &rarr; `In Progress` &rarr; `On Hold` &rarr; `Resolved`.
  - Full activity log and comment history for work orders and vendor receipts.

#### 5. Internal Notes & Reminders
- **Corporate Notices & Announcements**:
  - Create internal memos, administrative checklists, reminders, and departmental notices.
  - Pinned announcement capability (`isPinned: true`) to keep critical notices at the top of the feed with gold pin badge.
  - Due date tracking and audience targeting (`all` staff or specific staff member).
  - Real-time comment stream on internal notes for collaborative discussions.

#### 6. General Documents & Corporate Repository
- **Secure File Upload & Distribution**:
  - Upload SOPs, employee handbooks, compliance policies, and templates.
  - Supports file attachments with Base64 encoding and direct download links.
  - Classification levels: `Standard`, `Internal`, `Confidential`.
  - Department and staff audience targeting.

#### 7. Search, Filtering & CSV Data Export
- Real-time full-text search across all 5 modules (title, description, tags, staff names).
- Multi-dimensional status and priority dropdown filters.
- **CSV Data Export (`#btn-misc-export`)**: Exports the active subtab dataset to a clean, formatted CSV spreadsheet for offline reporting and archiving.

---

## 4. Storage, Security & Synchronization

| Component | Technical Implementation |
|---|---|
| **Backend Architecture** | Node.js & Express REST server (`server.js`) running on port `8000` with strict CORS and security middleware. |
| **Password Hashing** | Salted bcrypt (10 salt rounds) and PBKDF2 with automatic constant-time verification. Plaintext passwords are never stored, logged, or returned in API responses. |
| **Session Management** | Cryptographically secure tokens stored in `data/workpulse_sessions.json` with 24-hour expiration, HTTP-only cookie support, and instant server-side revocation on logout. |
| **Brute-Force Protection** | In-memory IP/identifier rate limiter blocking repeated failed logins (5 attempts per 15 minutes) with HTTP 429. |
| **Server-Side Authorization (RBAC)** | `authenticateToken` and `requireAdmin` middleware intercepting all protected routes. Unauthenticated requests return HTTP 401; unauthorized requests return HTTP 403. |
| **Role-Scoped Synchronization** | `/api/sync` dynamically filters data: Admin receives the full sanitized database; Staff receives scoped data limited to their own attendance, tasks, leaves, reports, and public roster. |
| **Persistent Database** | Authoritative JSON storage file at `data/workpulse_db.json`. Browser `localStorage` acts solely as a sanitized client-side view cache. |
| **File Storage** | Uploaded profile photos and project deliverables saved persistently to disk in `/uploads/`. |
| **Direct Access Protection** | Immediate `<head>` script guards in `admin.html` and `staff.html` prevent opening protected portals without valid sessions. |
| **Real-Time Presence Engine** | 20-second client heartbeats, 45-second stale session detection threshold, immediate beacon revocation (`navigator.sendBeacon`), instant logout cleanup, and strict separation between portal session state (`Online` / `Offline`) and daily shift attendance (`Present` / `Absent`). |

---

## 5. Quick Reference & REST API Endpoints

### Core REST Endpoints
- `GET /api/health` — System status, online staff count, server clock (Public)
- `POST /api/auth/login` — Authenticate Admin or Staff with rate limiting and strict role enforcement
- `POST /api/auth/forgot-password` — Generate 15-minute 6-digit recovery code for password reset (Public)
- `POST /api/auth/reset-password` — Securely update password using verified recovery code (Public)
- `GET /api/auth/session` — Verify active cryptographic session
- `POST /api/auth/logout` — Server-side session revocation (immediately updates staff presence to `Offline`)
- `POST /api/auth/heartbeat` — Periodic authenticated heartbeat keeping staff presence `Online`
- `POST /api/auth/offline` & `POST /api/auth/beacon-offline` — Beacon endpoints marking staff session `Offline` on browser tab close
- `GET /api/staff/online-status` — Real-time online presence map and active employee counts
- `GET /api/sync` — Role-scoped database synchronization (Admin: full sanitized; Staff: own scoped records; includes `onlineStaff` presence map)
- `POST /api/sync` — Synchronize database state (Admin only)
- `GET /api/admin/profile` & `PUT /api/admin/profile` — Admin profile and password management (Admin only)
- `GET /api/staff` — List staff (Admin: full sanitized; Staff: public directory)
- `POST /api/staff` & `DELETE /api/staff/:id` — Register / delete staff (Admin only)
- `PUT /api/staff/:id` — Update staff profile (Admin or self only; role escalation prevented)
- `GET /api/attendance` — Attendance logs (Admin: all; Staff: strictly own records)
- `POST /api/attendance/check-in` & `POST /api/attendance/check-out` — Self-attendance GPS punches
- `GET /api/activity/summary` — Live activity telemetry dashboard (Admin only)
- `GET /api/tasks` & `POST /api/tasks` — Task delegation suite (Staff scoped to own assigned tasks)
- `GET /api/meetings` & `POST /api/meetings` — Executive meetings schedule and attendee invitations
- `PATCH /api/meetings/:id` & `DELETE /api/meetings/:id` — Update or cancel scheduled executive meetings
- `GET /api/leaves` & `POST /api/leaves` — Leave requests (Staff scoped to own requests; Admin approval)
- `GET /api/wfh` & `POST /api/wfh` — Work from home requests (Staff scoped to own requests; Admin approval)
- `GET /api/reports` & `POST /api/reports` — Daily reports suite (Staff scoped to own reports)
- `POST /api/reports/:id/review` — Daily works reviews and 1–5 star ratings (Admin only)
- `GET /api/clients` & `GET /api/clients/summary` — Client directory and portfolio financial metrics
- `POST /api/clients`, `PUT /api/clients/:id` & `DELETE /api/clients/:id` — Client CRUD operations (Admin only)
- `POST /api/clients/:id/projects` & `PUT /api/clients/:id/projects/:projectId` — Add or update client sub-projects
- `DELETE /api/clients/:id/projects/:projectId` — Remove client sub-project (Admin only)
- `GET /api/leads` & `GET /api/leads/summary` — Lead acquisition pipeline and stage metrics (Staff scoped to assigned leads)
- `POST /api/leads`, `PUT /api/leads/:id` & `DELETE /api/leads/:id` — Lead CRUD operations (Admin only)
- `PATCH /api/leads/:id/status` — Update lead lifecycle status (Kanban drag-and-drop or telecaller update)
- `POST /api/leads/:id/notes` — Append telecaller call log and interaction notes
- `GET /api/misc/summary` — Overview KPI counts across all 5 miscellaneous modules
- `GET /api/misc/requests` & `POST /api/misc/requests` — List and submit general requests
- `PUT /api/misc/requests/:id` & `DELETE /api/misc/requests/:id` — Update status, approve/complete, or delete request
- `POST /api/misc/requests/:id/comments` — Threaded live comments on general requests
- `GET /api/misc/assets` & `POST /api/misc/assets` — Office equipment inventory registry
- `PUT /api/misc/assets/:id` & `DELETE /api/misc/assets/:id` — Update equipment, reassign staff, return asset, or delete
- `POST /api/misc/assets/:id/comments` — Equipment maintenance notes and comments
- `GET /api/misc/maintenance` & `POST /api/misc/maintenance` — Office maintenance tickets
- `PUT /api/misc/maintenance/:id` & `DELETE /api/misc/maintenance/:id` — Dispatch technician, update repair status, or delete
- `POST /api/misc/maintenance/:id/comments` — Facilities technician discussion stream
- `GET /api/misc/notes` & `POST /api/misc/notes` — Internal notes, memos, and reminders
- `PUT /api/misc/notes/:id` & `DELETE /api/misc/notes/:id` — Update note, toggle pin, or archive
- `POST /api/misc/notes/:id/comments` — Internal note feedback stream
- `GET /api/misc/documents` & `POST /api/misc/documents` — Corporate document repository with file upload
- `PUT /api/misc/documents/:id` & `DELETE /api/misc/documents/:id` — Edit document metadata or delete
- `POST /api/misc/documents/:id/comments` — Policy review feedback stream
- `POST /api/database/reset` — Reset transactions while preserving staff & settings (Admin only)

---
*WorkPulse Enterprise Platform &copy; 2026. All rights reserved.*
