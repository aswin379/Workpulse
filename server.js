/**
 * WORKPULSE ENTERPRISE BACKEND SERVER (server.js)
 * High-performance Node.js & Express REST API with persistent file-backed database.
 * Serves static frontend assets, real-time staff activity telemetry,
 * attendance GPS tracking, dual inactivity detection, leave workflows, and tasks.
 * Includes complete session authentication, role-based authorization,
 * PBKDF2 password hashing, and brute-force protection.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const {
  hashPassword,
  verifyPassword,
  generateSecureToken,
  sanitizeStaff,
  sanitizeAdmin,
  sanitizeDatabase
} = require('./auth-crypto');

const PORT = process.env.PORT || 8000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'workpulse_db.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'workpulse_sessions.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure data and uploads directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// -----------------------------------------------------------------------------
// 1. PERSISTENT STORAGE ADAPTER FOR WORKPULSE STATE ENGINE
// -----------------------------------------------------------------------------
function readDbFromFile() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading DB_FILE:', err);
  }
  return {};
}

function writeDbToFile(obj) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing DB_FILE:', err);
  }
}

// Bind localStorage on global environment for WorkPulseDB in Node
global.localStorage = {
  getItem: (key) => {
    const db = readDbFromFile();
    return db[key] || null;
  },
  setItem: (key, val) => {
    const db = readDbFromFile();
    db[key] = String(val);
    writeDbToFile(db);
  },
  removeItem: (key) => {
    const db = readDbFromFile();
    delete db[key];
    writeDbToFile(db);
  },
  clear: () => {
    writeDbToFile({});
  }
};
global.window = global;

// Load core business engine (js/state.js)
const stateCode = fs.readFileSync(path.join(__dirname, 'js', 'state.js'), 'utf8');
eval(stateCode);

// Automated persistent file storage migration on server startup
function migrateExistingFiles() {
  try {
    const db = WorkPulseDB.load();
    let updated = false;

    // Migrate task deliverable files to persistent disk storage
    if (Array.isArray(db.tasks)) {
      db.tasks.forEach(t => {
        if (t.file && t.file.dataBase64 && !t.file.url) {
          const match = t.file.dataBase64.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const cleanName = (t.file.name || 'deliverable.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
            const storedFileName = `task_${t.id}_${cleanName}`;
            const diskPath = path.join(UPLOADS_DIR, storedFileName);
            fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
            t.file.url = `/uploads/${storedFileName}`;
            updated = true;
            console.log(`[Storage Migration] Saved task deliverable to disk: /uploads/${storedFileName}`);
          }
        }
      });
    }

    // Migrate daily report deliverable files to persistent disk storage
    if (Array.isArray(db.dailyReports)) {
      db.dailyReports.forEach(r => {
        if (r.file && r.file.dataBase64 && !r.file.url) {
          const match = r.file.dataBase64.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const cleanName = (r.file.name || 'report_file.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
            const storedFileName = `report_${r.id}_${cleanName}`;
            const diskPath = path.join(UPLOADS_DIR, storedFileName);
            fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
            r.file.url = `/uploads/${storedFileName}`;
            updated = true;
            console.log(`[Storage Migration] Saved report deliverable to disk: /uploads/${storedFileName}`);
          }
        }
      });
    }

    // Migrate staff profile photos to persistent disk storage
    if (Array.isArray(db.staff)) {
      db.staff.forEach(s => {
        if (s.photo && typeof s.photo === 'string' && s.photo.startsWith('data:image')) {
          const match = s.photo.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
          if (match) {
            const ext = '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
            const storedFileName = `photo_${s.id}${ext}`;
            const diskPath = path.join(UPLOADS_DIR, storedFileName);
            fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
            s.photo = `/uploads/${storedFileName}`;
            updated = true;
            console.log(`[Storage Migration] Saved staff photo to disk: /uploads/${storedFileName}`);
          }
        }
      });
    }

    // Migrate admin photo to persistent disk storage
    if (db.admin && db.admin.photo && typeof db.admin.photo === 'string' && db.admin.photo.startsWith('data:image')) {
      const match = db.admin.photo.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (match) {
        const ext = '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
        const storedFileName = `photo_admin_${Date.now()}${ext}`;
        const diskPath = path.join(UPLOADS_DIR, storedFileName);
        fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
        db.admin.photo = `/uploads/${storedFileName}`;
        updated = true;
        console.log(`[Storage Migration] Saved admin photo to disk: /uploads/${storedFileName}`);
      }
    }

    if (updated) {
      WorkPulseDB.save(db);
    }
  } catch (err) {
    console.error('File migration error:', err);
  }
}

// Initialize database on server boot
const initialDb = WorkPulseDB.load();
migrateExistingFiles();
console.log(`[WorkPulse Backend] Database loaded. Staff count: ${initialDb.staff.length}, Attendance count: ${initialDb.attendance.length}`);

// -----------------------------------------------------------------------------
// 2. PERSISTENT SERVER-SIDE SESSION & RATE LIMITING ENGINE
// -----------------------------------------------------------------------------
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading sessions:', err);
  }
  return {};
}

function saveSessions(sessions) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving sessions:', err);
  }
}

let activeSessions = loadSessions();

// Stale heartbeat detection threshold (45 seconds without heartbeat = offline)
const STALE_HEARTBEAT_THRESHOLD_MS = 45 * 1000;

// Create new authenticated server session
function createSession(role, user) {
  const token = generateSecureToken(`wp-${role}`);
  const now = Date.now();
  const userId = user.id || (role === 'admin' ? 'WP-ADMIN' : '');

  // If staff, invalidate older sessions for this user so only 1 active session exists
  if (role === 'staff' && userId) {
    for (const t in activeSessions) {
      if (activeSessions[t] && activeSessions[t].userId === userId) {
        delete activeSessions[t];
      }
    }
  }

  const session = {
    token,
    role,
    userId,
    user: role === 'admin' ? sanitizeAdmin(user) : sanitizeStaff(user),
    createdAt: now,
    lastHeartbeatAt: now,
    expiresAt: now + (24 * 60 * 60 * 1000) // 24-hour expiration
  };
  activeSessions[token] = session;
  saveSessions(activeSessions);
  return session;
}

// Retrieve and validate server session by token
function getSessionByToken(token) {
  if (!token) return null;
  if (!activeSessions[token]) {
    activeSessions = loadSessions();
  }
  const sess = activeSessions[token];
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    delete activeSessions[token];
    saveSessions(activeSessions);
    return null;
  }
  return sess;
}

// Revoke session on logout immediately
function revokeSession(token) {
  if (token && activeSessions[token]) {
    const sess = activeSessions[token];
    const userId = sess.userId;
    const role = sess.role;

    // Invalidate session(s)
    if (role === 'staff' && userId) {
      for (const t in activeSessions) {
        if (activeSessions[t] && activeSessions[t].userId === userId) {
          delete activeSessions[t];
        }
      }
    } else {
      delete activeSessions[token];
    }
    saveSessions(activeSessions);
    return true;
  }
  return false;
}

// Map of online staff derived from valid active sessions with fresh heartbeats
function getOnlineStaffMap() {
  const now = Date.now();
  const map = {};

  if (!activeSessions || Object.keys(activeSessions).length === 0) {
    activeSessions = loadSessions();
  }

  for (const token in activeSessions) {
    const sess = activeSessions[token];
    if (!sess) continue;

    if (now > sess.expiresAt) {
      delete activeSessions[token];
      continue;
    }

    if (sess.role === 'staff' && sess.userId) {
      const lastBeat = sess.lastHeartbeatAt || sess.createdAt || 0;
      const isOnline = (now - lastBeat) <= STALE_HEARTBEAT_THRESHOLD_MS;

      if (!map[sess.userId] || isOnline) {
        map[sess.userId] = {
          isOnline,
          lastSeen: lastBeat,
          lastSeenIso: new Date(lastBeat).toISOString()
        };
      }
    }
  }

  return map;
}

// Brute-force protection & rate limiting
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15-minute lockout

function checkRateLimit(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true };
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingMins = Math.ceil((record.lockedUntil - now) / 60000);
    return { allowed: false, remainingMins };
  }
  if (now - record.firstAttempt > WINDOW_MS) {
    loginAttempts.delete(key);
    return { allowed: true };
  }
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + WINDOW_MS;
    return { allowed: false, remainingMins: 15 };
  }
  return { allowed: true };
}

function recordFailedLogin(key) {
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, firstAttempt: now };
  if (now - record.firstAttempt > WINDOW_MS) {
    record.count = 1;
    record.firstAttempt = now;
  } else {
    record.count++;
  }
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + WINDOW_MS;
  }
  loginAttempts.set(key, record);
}

function clearRateLimit(key) {
  loginAttempts.delete(key);
}

// Cookie parser utility
function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers && req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name ? name.trim() : '';
    if (!name) return;
    let value = rest.join('=').trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      list[name] = decodeURIComponent(value);
    } catch (e) {
      list[name] = value;
    }
  });
  return list;
}

// Extract authentication token from request
function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerTok = authHeader.substring(7).trim();
    if (bearerTok && bearerTok !== 'null' && bearerTok !== 'undefined') {
      return bearerTok;
    }
  }
  if (req.headers['x-session-token']) {
    const xTok = req.headers['x-session-token'].trim();
    if (xTok && xTok !== 'null' && xTok !== 'undefined') {
      return xTok;
    }
  }
  const cookies = parseCookies(req);
  // For admin routes or domain management, prioritize explicit admin cookie if available
  if (cookies['wp_admin_session'] && (req.path.startsWith('/api/domains') || req.path.startsWith('/api/admin'))) {
    const admTok = cookies['wp_admin_session'].trim();
    if (admTok && (activeSessions[admTok] || fs.existsSync(SESSIONS_FILE))) {
      return admTok;
    }
  }
  if (cookies['wp_session']) {
    return cookies['wp_session'].trim();
  }
  if (cookies['wp_admin_session']) {
    return cookies['wp_admin_session'].trim();
  }
  if (cookies['wp_staff_session']) {
    return cookies['wp_staff_session'].trim();
  }
  if (req.query && req.query.token) {
    return req.query.token.trim();
  }
  return null;
}

// Authentication middleware
function authenticateToken(req, res, next) {
  let token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication session required' });
  }

  let session = getSessionByToken(token);

  // If token is invalid or belongs to a non-admin session on admin-specific routes like /api/domains,
  // check whether an authentic admin session exists in wp_admin_session cookie or x-session-token
  if (req.path.startsWith('/api/domains')) {
    const isSessAdmin = session && (
      (session.role && String(session.role).toLowerCase() === 'admin') ||
      (session.user && (String(session.user.role).toLowerCase() === 'admin' || session.user.id === 'WP-ADMIN')) ||
      session.userId === 'WP-ADMIN' ||
      (session.token && String(session.token).startsWith('wp-admin'))
    );
    if (!isSessAdmin) {
      const cookies = parseCookies(req);
      const adminCookie = cookies['wp_admin_session'] || (req.headers['x-session-token'] && req.headers['x-session-token'].startsWith('wp-admin') ? req.headers['x-session-token'] : null);
      if (adminCookie) {
        const altSession = getSessionByToken(adminCookie.trim());
        if (altSession) {
          session = altSession;
          token = adminCookie.trim();
        }
      }
    }
  }

  if (!session) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired session' });
  }

  session.lastHeartbeatAt = Date.now();
  req.session = session;
  req.user = session.user;

  // Robustly determine and normalize role (case-insensitive)
  const resolvedRole = (
    session.role ||
    (session.user && session.user.role) ||
    (session.userId === 'WP-ADMIN' || (session.user && session.user.id === 'WP-ADMIN') ? 'admin' : '') ||
    (token.startsWith('wp-admin') ? 'admin' : '') ||
    ''
  ).toString().toLowerCase().trim();

  req.role = resolvedRole;
  req.token = token;
  next();
}

// Authorization middleware for Administrator
function requireAdmin(req, res, next) {
  const role = (
    req.role ||
    (req.session && req.session.role) ||
    (req.user && req.user.role) ||
    ''
  ).toString().toLowerCase().trim();

  const isAdmin = role === 'admin' ||
    (req.user && (req.user.id === 'WP-ADMIN' || String(req.user.role).toLowerCase() === 'admin' || (req.user.email && req.user.email.toLowerCase() === 'admin@workpulse.com'))) ||
    (req.session && (req.session.userId === 'WP-ADMIN' || (req.session.token && String(req.session.token).startsWith('wp-admin')))) ||
    (req.token && String(req.token).startsWith('wp-admin'));

  if (!isAdmin) {
    return res.status(403).json({ success: false, error: 'Forbidden: Administrator privileges required' });
  }
  req.role = 'admin';
  next();
}

// -----------------------------------------------------------------------------
// 3. EXPRESS APPLICATION SETUP
// -----------------------------------------------------------------------------
const app = express();

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'Accept']
}));
app.use(express.json({ limit: '50mb', type: ['application/json', 'text/plain', '*/*'] }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'string') {
    try {
      req.body = JSON.parse(req.body);
    } catch (e) { }
  }
  next();
});

// Static file hosting for shared persistent uploads (photos & deliverables)
app.use('/uploads', express.static(UPLOADS_DIR));

// Request logging middleware
app.use((req, res, next) => {
  if (req.url.startsWith('/api')) {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[API] ${req.method} ${req.url} -> ${res.statusCode} (${duration}ms)`);
    });
  }
  next();
});

// -----------------------------------------------------------------------------
// 4. REST API ENDPOINTS
// -----------------------------------------------------------------------------

// System Health (Public)
app.get('/api/health', (req, res) => {
  const db = WorkPulseDB.load();
  const onlineMap = getOnlineStaffMap();
  const onlineStaffCount = Object.values(onlineMap).filter(s => s.isOnline).length;
  res.json({
    status: 'online',
    system: 'WorkPulse Enterprise Management System',
    timestamp: new Date().toISOString(),
    totalStaff: db.staff.length,
    onlineStaffCount,
    checkoutRule: db.settings.checkoutRule,
    serverTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  });
});

// Helper for intelligent collection merging
function mergeCollections(serverList = [], clientList = [], key = 'id') {
  if (!Array.isArray(serverList)) serverList = [];
  if (!Array.isArray(clientList) || clientList.length === 0) return serverList;

  const map = new Map();
  serverList.forEach(item => {
    if (item && item[key]) map.set(item[key], item);
  });

  clientList.forEach(item => {
    if (item && item[key]) {
      const existing = map.get(item[key]);
      if (existing) {
        // Special guard for approval decisions (leaves / wfh):
        // NEVER allow a client record with status: 'Pending' to overwrite a server record with status: 'Approved' or 'Rejected'!
        if ((existing.status === 'Approved' || existing.status === 'Rejected') && item.status === 'Pending') {
          map.set(item[key], {
            ...item,
            ...existing,
            status: existing.status,
            reviewedAt: existing.reviewedAt || item.reviewedAt,
            reviewedBy: existing.reviewedBy || item.reviewedBy,
            adminComment: existing.adminComment || item.adminComment,
            approvalComment: existing.approvalComment || item.approvalComment,
            rejectionReason: existing.rejectionReason || item.rejectionReason,
            notes: existing.notes || item.notes
          });
        } else {
          map.set(item[key], { ...existing, ...item });
        }
      } else {
        map.set(item[key], item);
      }
    }
  });

  const mergedItems = Array.from(map.values());
  // If collection is leaves, deduplicate by (staffId, startDate, endDate, leaveType)
  if (mergedItems.length > 0 && mergedItems[0].leaveType !== undefined) {
    const deduplicated = [];
    const seenLeaves = new Map();
    mergedItems.forEach(l => {
      const start = l.startDate || l.leaveDate;
      const end = l.endDate || l.toDate || start;
      const sig = `${l.staffId}_${start}_${end}_${l.leaveType}`.toUpperCase();
      if (!seenLeaves.has(sig)) {
        seenLeaves.set(sig, l);
        deduplicated.push(l);
      } else {
        const prev = seenLeaves.get(sig);
        if (prev.status === 'Pending' && l.status !== 'Pending') {
          const idx = deduplicated.indexOf(prev);
          if (idx !== -1) deduplicated[idx] = l;
          seenLeaves.set(sig, l);
        }
      }
    });
    return deduplicated;
  }

  // If collection is wfhRequests, deduplicate by (staffId, date, reason)
  if (mergedItems.length > 0 && mergedItems.some(item => item && item.id && String(item.id).startsWith('WFH-'))) {
    const deduplicatedWfh = [];
    mergedItems.forEach(w => {
      if (!w || !w.staffId || !w.date) return;
      const matchIdx = deduplicatedWfh.findIndex(existing => {
        if (existing.id && w.id && String(existing.id).trim() === String(w.id).trim()) return true;
        const sameStaff = String(existing.staffId || '').trim().toUpperCase() === String(w.staffId || '').trim().toUpperCase();
        const sameDate = String(existing.date || '').trim() === String(w.date || '').trim();
        if (!sameStaff || !sameDate) return false;
        const st1 = String(existing.status || 'Pending').trim().toLowerCase();
        const st2 = String(w.status || 'Pending').trim().toLowerCase();
        if (st1 === 'pending' || st2 === 'pending') return true;
        const r1 = String(existing.reason || '').trim().toLowerCase();
        const r2 = String(w.reason || '').trim().toLowerCase();
        return r1 === r2;
      });

      if (matchIdx === -1) {
        deduplicatedWfh.push(w);
      } else {
        const existing = deduplicatedWfh[matchIdx];
        const exStatus = String(existing.status || 'Pending').trim().toLowerCase();
        const itemStatus = String(w.status || 'Pending').trim().toLowerCase();
        if (exStatus === 'pending' && itemStatus !== 'pending') {
          deduplicatedWfh[matchIdx] = w;
        } else if (exStatus === itemStatus) {
          if ((!existing.reviewedBy && w.reviewedBy) || (existing.id && existing.id.length < 10 && w.id && w.id.length >= 10)) {
            deduplicatedWfh[matchIdx] = w;
          }
        }
      }
    });
    return deduplicatedWfh;
  }

  // If collection is tasks, deduplicate near-identical tasks (same project, title, created within 60s)
  if (mergedItems.length > 0 && mergedItems[0].title !== undefined && (mergedItems[0].id || '').startsWith('TSK-')) {
    const deduplicatedTasks = [];
    const seenTasks = [];
    mergedItems.forEach(t => {
      if (!t) return;
      const tTitle = (t.title || '').trim().toLowerCase();
      const tProj = t.projectId || '';
      const tTime = new Date(t.createdAt || 0).getTime() || parseInt((t.id || '').split('-')[1] || '0', 10);

      const match = seenTasks.find(s => {
        if (s.id === t.id) return true;
        const sTitle = (s.title || '').trim().toLowerCase();
        const sProj = s.projectId || '';
        const sTime = new Date(s.createdAt || 0).getTime() || parseInt((s.id || '').split('-')[1] || '0', 10);
        if (sTitle === tTitle && sProj === tProj) {
          if (sTime && tTime && Math.abs(sTime - tTime) < 60000) return true;
        }
        return false;
      });

      if (!match) {
        seenTasks.push(t);
        deduplicatedTasks.push(t);
      } else {
        // Merge subtasks or comments if any into the retained task
        if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
          if (!Array.isArray(match.subtasks) || match.subtasks.length === 0) {
            match.subtasks = t.subtasks;
          }
        }
        if (Array.isArray(t.comments) && t.comments.length > 0) {
          if (!Array.isArray(match.comments) || match.comments.length === 0) {
            match.comments = t.comments;
          }
        }
      }
    });
    return deduplicatedTasks;
  }

  return mergedItems;
}

// Complete State Synchronization (Client <-> Server Sync)
// Protected with role-based scoping: Admin receives full DB, Staff receives scoped view!
app.get('/api/sync', authenticateToken, (req, res) => {
  try {
    const db = WorkPulseDB.load();

    const onlineMap = getOnlineStaffMap();

    if (req.role === 'admin') {
      const sanitized = sanitizeDatabase(db);
      sanitized.onlineStaff = onlineMap;
      return res.json({ success: true, role: 'admin', data: sanitized, onlineStaff: onlineMap, timestamp: Date.now() });
    }

    // Role is Staff: Filter scoped data!
    if (req.query.staffId && req.query.staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cross-account access denied' });
    }
    const staffId = req.user.id;
    const scopedDb = {
      admin: null, // Never expose admin credentials or details to staff!
      onlineStaff: onlineMap,
      staff: (db.staff || []).map(s => ({
        id: s.id,
        name: s.name,
        position: s.position,
        photo: s.photo,
        status: s.status
      })),
      attendance: (db.attendance || []).filter(a => String(a.staffId || '').trim().toUpperCase() === String(staffId).trim().toUpperCase()),
      leaves: (db.leaves || []).filter(l => String(l.staffId || '').trim().toUpperCase() === String(staffId).trim().toUpperCase()),
      wfhRequests: (db.wfhRequests || []).filter(w => String(w.staffId || '').trim().toUpperCase() === String(staffId).trim().toUpperCase()),
      projects: (db.projects || []).filter(p => {
        const ids = Array.isArray(p.assignedStaffIds) ? p.assignedStaffIds : [p.assignedStaffId];
        return ids.includes(staffId) || ids.includes('all');
      }),
      tasks: (db.tasks || []).filter(t => {
        const ids = Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds : [t.assignedStaffId];
        return ids.includes(staffId) || ids.includes('all') || t.assignedStaffId === staffId || t.assignedStaffId === 'all';
      }),
      dailyReports: (db.dailyReports || []).filter(r => r.staffId === staffId),
      meetings: WorkPulseDB.getMeetings({ staffId }),
      notifications: (db.notifications || []).filter(n => n.role === 'staff' && (!n.staffId || n.staffId === staffId)),
      leads: (db.leads || []).filter(l => String(l.assignedStaffId || '').trim().toUpperCase() === String(staffId).trim().toUpperCase()),
      generalRequests: (db.generalRequests || []).filter(r => r.requestedById === staffId || r.staffId === staffId || r.assignedStaffId === staffId),
      officeAssets: (db.officeAssets || []).filter(a => a.assignedStaffId === staffId),
      maintenanceIssues: (db.maintenanceIssues || []).filter(m => m.reportedById === staffId || m.assignedStaffId === staffId),
      internalNotes: (db.internalNotes || []).filter(n => n.assignedStaffId === 'all' || n.assignedStaffId === staffId),
      generalDocuments: (db.generalDocuments || []).filter(d => d.assignedStaffId === 'all' || d.assignedStaffId === staffId),
      settings: {
        officeName: db.settings?.officeName,
        officeAddress: db.settings?.officeAddress,
        latitude: db.settings?.latitude,
        longitude: db.settings?.longitude,
        geofenceRadiusMeters: db.settings?.geofenceRadiusMeters,
        checkInStartTime: db.settings?.checkInStartTime,
        checkoutRule: db.settings?.checkoutRule,
        requireLocationPermission: db.settings?.requireLocationPermission,
        sundayWeeklyOff: db.settings?.sundayWeeklyOff,
        officeTimezone: db.settings?.officeTimezone || 'Asia/Kolkata',
        weeklyHolidays: db.settings?.weeklyHolidays || ['Sunday'],
        systemInactivityTimeoutMinutes: db.settings?.systemInactivityTimeoutMinutes,
        tabInactivityTimeoutMinutes: db.settings?.tabInactivityTimeoutMinutes
      }
    };

    return res.json({ success: true, role: 'staff', data: scopedDb, onlineStaff: onlineMap, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sync', authenticateToken, requireAdmin, (req, res) => {
  try {
    const incomingData = req.body;
    if (!incomingData || typeof incomingData !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid sync payload' });
    }
    const current = WorkPulseDB.load();

    // Scrub legacy demo records
    const checkDemo = typeof isDemoRecord === 'function' ? isDemoRecord : (typeof global.isDemoRecord === 'function' ? global.isDemoRecord : () => false);
    if (Array.isArray(incomingData.staff)) {
      incomingData.staff = incomingData.staff.filter(s => !checkDemo(s));
    }
    if (Array.isArray(incomingData.attendance)) {
      incomingData.attendance = incomingData.attendance.filter(a => !checkDemo(a));
    }

    // Smart merge collections — NEVER overwrite server records with empty client arrays
    const merged = { ...current };

    const collections = [
      'staff', 'attendance', 'leaves', 'wfhRequests',
      'tasks', 'dailyReports', 'meetings', 'notifications',
      'clients', 'leads', 'projects',
      'generalRequests', 'officeAssets', 'maintenanceIssues', 'internalNotes', 'generalDocuments',
      'domains'
    ];

    collections.forEach(col => {
      if (Array.isArray(incomingData[col])) {
        merged[col] = mergeCollections(current[col], incomingData[col], 'id');
      } else {
        merged[col] = current[col] || [];
      }
    });

    // Ensure staff passwords remain secure hashes and are never erased by sanitized client sync payloads
    if (Array.isArray(merged.staff)) {
      merged.staff.forEach(s => {
        if (!s) return;
        const currentMatch = (current.staff || []).find(cs => cs && cs.id === s.id);
        if (currentMatch && currentMatch.password) {
          s.password = currentMatch.password;
        } else if (s.password && !s.password.startsWith('$2')) {
          s.password = hashPassword(s.password);
        }
      });
    }

    // Merge settings carefully
    if (incomingData.settings && typeof incomingData.settings === 'object') {
      merged.settings = { ...current.settings, ...incomingData.settings };
    }

    // Merge admin profile carefully and preserve password hash
    if (incomingData.admin && typeof incomingData.admin === 'object') {
      merged.admin = { ...(current.admin || WorkPulseDB.getAdminProfile()), ...incomingData.admin };
      if (current.admin && current.admin.password) {
        merged.admin.password = current.admin.password;
      }
    }

    WorkPulseDB.save(merged);
    res.json({ success: true, message: 'Server database synchronized', data: sanitizeDatabase(merged) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Shared Persistent File Upload Endpoint with Secure Validation
app.post('/api/upload', authenticateToken, (req, res) => {
  try {
    const { name, fileName, type, fileType, dataBase64, data } = req.body;
    const base64Content = dataBase64 || data;
    if (!base64Content) {
      return res.status(400).json({ success: false, error: 'No file data provided' });
    }

    const originalName = fileName || name || 'file.bin';
    const ext = path.extname(originalName).toLowerCase();
    const ALLOWED_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.zip'];

    if (!ALLOWED_EXTS.includes(ext)) {
      return res.status(400).json({
        success: false,
        error: `Invalid file type "${ext}". Supported file types: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, and ZIP.`
      });
    }

    let buffer;
    const match = base64Content.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      buffer = Buffer.from(match[2], 'base64');
    } else {
      buffer = Buffer.from(base64Content, 'base64');
    }

    const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
    if (buffer.length > MAX_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `File size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds maximum permitted limit of 25 MB.`
      });
    }

    const cleanBase = path.basename(originalName, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedFileName = `${Date.now()}_${cleanBase}${ext}`;
    const filePath = path.join(UPLOADS_DIR, storedFileName);

    fs.writeFileSync(filePath, buffer);

    const fileUrl = `/uploads/${storedFileName}`;
    console.log(`[File Upload] Persistent file saved: ${fileUrl} (${buffer.length} bytes, type: ${ext})`);

    res.json({
      success: true,
      url: fileUrl,
      name: originalName,
      size: buffer.length < 1024 * 1024
        ? `${(buffer.length / 1024).toFixed(1)} KB`
        : `${(buffer.length / (1024 * 1024)).toFixed(2)} MB`,
      sizeBytes: buffer.length,
      type: fileType || type || 'application/octet-stream',
      extension: ext
    });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// In-memory token storage for password resets
const passwordResetTokens = new Map();

// Authentication — Request Password Reset Token
app.post('/api/auth/forgot-password', (req, res) => {
  const { identifier, role } = req.body;
  if (!identifier) {
    return res.status(400).json({ success: false, error: 'Corporate email, staff ID, or mobile number is required' });
  }

  const inputId = identifier.toLowerCase().trim();
  const digitsOnly = identifier.replace(/\D/g, '');
  const db = WorkPulseDB.load();
  const adminAccount = WorkPulseDB.getAdminProfile();
  const adminEmail = (adminAccount.email || 'admin@workpulse.com').toLowerCase().trim();

  let targetUser = null;
  let targetRole = null;

  if (role === 'admin' || inputId === adminEmail || inputId === 'admin' || inputId === 'wp-admin') {
    targetUser = adminAccount;
    targetRole = 'admin';
  } else {
    const matchedStaff = (db.staff || []).find(s =>
      (s.email && s.email.toLowerCase().trim() === inputId) ||
      (s.id && s.id.toLowerCase().trim() === inputId) ||
      (digitsOnly.length >= 7 && s.mobile && s.mobile.replace(/\D/g, '') === digitsOnly)
    );
    if (matchedStaff) {
      targetUser = matchedStaff;
      targetRole = 'staff';
    } else if (inputId === adminEmail || inputId === 'admin' || inputId === 'wp-admin') {
      targetUser = adminAccount;
      targetRole = 'admin';
    }
  }

  if (!targetUser) {
    return res.status(404).json({
      success: false,
      error: 'No registered corporate account found matching the provided identifier.'
    });
  }

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = Date.now() + (15 * 60 * 1000); // 15-minute validity

  const tokenKey = (targetUser.email || targetUser.id || inputId).toLowerCase().trim();
  const resetRecord = {
    token: resetCode,
    expiresAt: expiry,
    role: targetRole,
    userId: targetUser.id || (targetRole === 'admin' ? 'WP-ADMIN' : ''),
    tokenKey: tokenKey
  };
  passwordResetTokens.set(tokenKey, resetRecord);
  passwordResetTokens.set(resetCode, resetRecord);

  console.log(`[Security] Password reset requested for ${tokenKey}. Recovery code: ${resetCode}`);

  return res.json({
    success: true,
    message: `A recovery authorization code has been generated for ${targetUser.email || targetUser.name}.`,
    resetCode: resetCode,
    resetToken: resetCode,
    email: targetUser.email || inputId,
    role: targetRole
  });
});

// Authentication — Verify Reset Token and Update Password
app.post('/api/auth/reset-password', (req, res) => {
  const code = (req.body.resetCode || req.body.token || req.body.recoveryCode || '').toString().trim();
  const identifier = (req.body.identifier || req.body.email || '').toString().trim();
  const newPassword = (req.body.newPassword || '').toString();

  if (!code || !newPassword) {
    return res.status(400).json({ success: false, error: 'Recovery code and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long' });
  }

  // Lookup record by code directly or by tokenKey
  let record = passwordResetTokens.get(code);
  let tokenKey = null;
  if (record) {
    tokenKey = record.tokenKey;
  } else if (identifier) {
    const inputId = identifier.toLowerCase().trim();
    record = passwordResetTokens.get(inputId);
    tokenKey = inputId;
  }

  if (!record) {
    return res.status(400).json({ success: false, error: 'No active recovery request found. Please request a new token.' });
  }

  if (Date.now() > record.expiresAt) {
    if (tokenKey) passwordResetTokens.delete(tokenKey);
    passwordResetTokens.delete(code);
    return res.status(400).json({ success: false, error: 'Recovery code has expired. Please request a new token.' });
  }

  if (record.token.trim() !== code) {
    return res.status(400).json({ success: false, error: 'Invalid recovery code.' });
  }

  const db = WorkPulseDB.load();
  const adminAccount = WorkPulseDB.getAdminProfile();
  const targetRole = record.role;
  const newHash = hashPassword(newPassword);

  if (targetRole === 'admin') {
    adminAccount.password = newHash;
    if (db.admin) db.admin.password = newHash;
  } else {
    const staffInDb = (db.staff || []).find(s => s.id === record.userId || (s.email && s.email.toLowerCase() === (tokenKey || '').toLowerCase()));
    if (staffInDb) {
      staffInDb.password = newHash;
    }
  }

  WorkPulseDB.save(db);
  if (tokenKey) passwordResetTokens.delete(tokenKey);
  passwordResetTokens.delete(code);
  console.log(`[Security] Password successfully updated for ${targetRole} user (${tokenKey || record.userId}).`);

  return res.json({
    success: true,
    message: 'Password has been successfully updated. You may now log in with your new credentials.'
  });
});

// Authentication — Separate Admin & Staff Login with Brute-Force Rate Limiting
app.post(['/api/auth/login', '/api/login', '/login', '/api/auth/admin-login', '/api/auth/staff-login'], (req, res) => {
  const inputEmail = req.body.email || req.body.identifier || req.body.username || req.body.id;
  const { password } = req.body;
  const role = req.body.role || req.body.loginType;
  if (!inputEmail || !password) {
    return res.status(400).json({ success: false, error: 'Email/Identifier and password are required' });
  }

  const inputIdentifier = (inputEmail || '').toString().toLowerCase().trim();
  const digitsOnly = inputIdentifier.replace(/\D/g, '');
  const rateLimitKey = `${req.ip || 'ip'}_${inputIdentifier}`;

  const rateCheck = checkRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: `Too many failed login attempts. Please try again after ${rateCheck.remainingMins} minutes.`
    });
  }

  const db = WorkPulseDB.load();
  const adminAccount = WorkPulseDB.getAdminProfile();
  const adminEmail = (adminAccount.email || 'admin@workpulse.com').toLowerCase().trim();
  const adminName = (adminAccount.name || '').toLowerCase().trim();
  const adminId = (adminAccount.id || 'WP-ADMIN').toLowerCase().trim();

  // Check if identifier belongs to Admin (email, 'admin', name, or 'wp-admin')
  const isAdminIdentifier = (
    inputIdentifier === adminEmail ||
    inputIdentifier === 'admin@workpulse.com' ||
    inputIdentifier === 'admin' ||
    (adminName && inputIdentifier === adminName) ||
    (adminId && inputIdentifier === adminId) ||
    inputIdentifier === 'wp-admin'
  );

  let requestedPortal = (role || '').toLowerCase().trim(); // 'admin' | 'staff'
  if (!requestedPortal) {
    if (req.path.includes('admin')) requestedPortal = 'admin';
    else if (req.path.includes('staff')) requestedPortal = 'staff';
    else if (isAdminIdentifier) requestedPortal = 'admin';
    else requestedPortal = 'staff';
  }

  // Check if identifier belongs to a Staff member (supporting multiple candidates sharing a mobile number)
  const matchedStaffCandidates = (db.staff || []).filter(s =>
    (s.email && s.email.toLowerCase().trim() === inputIdentifier) ||
    (s.id && s.id.toLowerCase().trim() === inputIdentifier) ||
    (digitsOnly.length >= 7 && s.mobile && s.mobile.replace(/\D/g, '') === digitsOnly)
  );
  const matchedStaff = matchedStaffCandidates.find(s => verifyPassword(password, s.password)) || matchedStaffCandidates[0];

  // SCENARIO 1: ADMIN LOGIN PORTAL
  if (requestedPortal === 'admin') {
    // If a staff user tries to log in on Admin portal: REJECT with mandatory message
    if (matchedStaff && !isAdminIdentifier) {
      recordFailedLogin(rateLimitKey);
      return res.status(403).json({
        success: false,
        error: 'Invalid Admin credentials. Please use Staff Login.'
      });
    }

    if (!isAdminIdentifier) {
      recordFailedLogin(rateLimitKey);
      return res.status(401).json({
        success: false,
        error: 'Invalid administrator credentials'
      });
    }

    // Check Admin Password
    const activeAdminPwd = adminAccount.password || '';
    if (!verifyPassword(password.trim(), activeAdminPwd)) {
      recordFailedLogin(rateLimitKey);
      return res.status(401).json({
        success: false,
        error: 'Invalid administrator credentials'
      });
    }

    // Success! Clear rate limit
    clearRateLimit(rateLimitKey);

    // Auto-upgrade legacy hash to salted bcrypt on successful login
    if (!adminAccount.password.startsWith('$2')) {
      adminAccount.password = hashPassword(password);
      WorkPulseDB.save(db);
    }

    const session = createSession('admin', adminAccount);
    res.cookie('wp_session', session.token, {
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.cookie('wp_admin_session', session.token, {
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      token: session.token,
      session: {
        role: session.role,
        token: session.token,
        user: session.user
      }
    });
  }

  // SCENARIO 2: STAFF LOGIN PORTAL
  if (requestedPortal === 'staff') {
    // If Admin credentials entered on Staff portal: REJECT
    if (isAdminIdentifier && !matchedStaff) {
      recordFailedLogin(rateLimitKey);
      return res.status(403).json({
        success: false,
        error: 'Access denied. Please use the Administrator portal.'
      });
    }

    if (!matchedStaff) {
      recordFailedLogin(rateLimitKey);
      return res.status(404).json({
        success: false,
        error: 'Staff account not found'
      });
    }

    if (matchedStaff.status && matchedStaff.status.toLowerCase() === 'inactive') {
      return res.status(403).json({
        success: false,
        error: 'Staff account is marked Inactive. Please contact administration.'
      });
    }

    // Check Staff Password
    if (!verifyPassword(password, matchedStaff.password)) {
      recordFailedLogin(rateLimitKey);
      return res.status(401).json({
        success: false,
        error: 'Incorrect staff password'
      });
    }

    // Success! Clear rate limit
    clearRateLimit(rateLimitKey);

    // Auto-upgrade legacy hash to salted bcrypt on successful login
    if (!matchedStaff.password.startsWith('$2')) {
      matchedStaff.password = hashPassword(password);
      WorkPulseDB.save(db);
    }

    const session = createSession('staff', matchedStaff);
    res.cookie('wp_session', session.token, {
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.cookie('wp_staff_session', session.token, {
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      token: session.token,
      session: {
        role: session.role,
        token: session.token,
        user: session.user
      }
    });
  }

  return res.status(400).json({ success: false, error: 'Invalid login portal role requested' });
});

app.get('/api/auth/session', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const token = extractToken(req);
  if (!token) return res.json({ success: true, session: null });
  const session = getSessionByToken(token);
  if (!session) return res.json({ success: true, session: null });

  res.json({
    success: true,
    session: {
      role: session.role,
      token: session.token,
      user: session.user
    }
  });
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  revokeSession(req.token);
  res.clearCookie('wp_session', { path: '/' });
  res.clearCookie('wp_admin_session', { path: '/' });
  res.clearCookie('wp_staff_session', { path: '/' });
  res.json({ success: true, message: 'Session logged out successfully' });
});

// Staff Presence Heartbeat & Keep-Alive
app.post('/api/auth/heartbeat', authenticateToken, (req, res) => {
  if (req.session) {
    req.session.lastHeartbeatAt = Date.now();
  }
  res.json({ success: true, timestamp: Date.now() });
});

// Explicit offline notification (beacon or pagehide - does NOT revoke session)
app.post(['/api/auth/offline', '/api/auth/beacon-offline'], (req, res) => {
  // Navigation, page reloads or tab switches trigger pagehide/beacon;
  // NEVER revoke authentication sessions here!
  // Sign-out happens ONLY when user clicks the explicit Logout button (/api/auth/logout).
  const token = extractToken(req);
  if (token && activeSessions[token]) {
    // Only update presence timestamp, do not revoke
    activeSessions[token].lastHeartbeatAt = Date.now() - 40000;
  }
  res.json({ success: true });
});

// Retrieve Real-Time Online/Offline Status for All Staff (Admin Only)
app.get('/api/staff/online-status', authenticateToken, requireAdmin, (req, res) => {
  const onlineMap = getOnlineStaffMap();
  const db = WorkPulseDB.load();
  const staffList = db.staff || [];

  const statusList = staffList.map(s => {
    const info = onlineMap[s.id] || { isOnline: false, lastSeen: null, lastSeenIso: null };
    return {
      staffId: s.id,
      staffName: s.name,
      isOnline: !!info.isOnline,
      lastSeen: info.lastSeen || null,
      lastSeenIso: info.lastSeenIso || null
    };
  });

  const onlineCount = statusList.filter(s => s.isOnline).length;
  res.json({
    success: true,
    onlineCount,
    totalStaff: staffList.length,
    data: statusList,
    map: onlineMap
  });
});

// Admin Profile & Account Management
app.get('/api/admin/profile', authenticateToken, requireAdmin, (req, res) => {
  try {
    const admin = WorkPulseDB.getAdminProfile();
    res.json({ success: true, data: sanitizeAdmin(admin) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/profile', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, email, position, photo, currentPassword, newPassword } = req.body;
    const currentAdmin = WorkPulseDB.getAdminProfile();

    // If changing password, verify current password against salted hash
    if (newPassword && newPassword.trim()) {
      const activePwd = currentAdmin.password || '';
      if (!currentPassword || !verifyPassword(currentPassword, activePwd)) {
        return res.status(400).json({
          success: false,
          error: 'Current password verification failed. Please enter your current password correctly.'
        });
      }
      if (newPassword.trim().length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must contain at least 6 characters.'
        });
      }
      req.body.newPassword = hashPassword(newPassword.trim());
    }

    const updated = WorkPulseDB.updateAdminProfile(req.body);
    res.json({
      success: true,
      message: 'Admin profile updated successfully',
      data: sanitizeAdmin(updated)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Staff Management
app.get('/api/staff', authenticateToken, (req, res) => {
  if (req.role === 'admin') {
    const staff = WorkPulseDB.getStaffList().map(sanitizeStaff);
    return res.json({ success: true, count: staff.length, data: staff });
  }
  // Staff view: Public roster without sensitive private info
  const staff = WorkPulseDB.getStaffList().map(s => ({
    id: s.id,
    name: s.name,
    position: s.position,
    photo: s.photo,
    status: s.status
  }));
  res.json({ success: true, count: staff.length, data: staff });
});

app.get('/api/staff/:id', authenticateToken, (req, res) => {
  const member = WorkPulseDB.getStaffById(req.params.id);
  if (!member) {
    return res.status(404).json({ success: false, error: 'Staff member not found' });
  }
  if (req.role === 'admin' || req.user.id === req.params.id) {
    return res.json({ success: true, data: sanitizeStaff(member) });
  }
  // Other staff members see only public info
  res.json({
    success: true,
    data: {
      id: member.id,
      name: member.name,
      position: member.position,
      photo: member.photo,
      status: member.status
    }
  });
});

app.post('/api/staff', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, position, mobile, email, address, password, photo, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Staff Full Name is required.' });
    }
    if (!position || !position.trim()) {
      return res.status(400).json({ success: false, error: 'Position / Job Title is required.' });
    }
    if (!mobile || !mobile.trim()) {
      return res.status(400).json({ success: false, error: 'Mobile number is required.' });
    }
    if (!address || !address.trim()) {
      return res.status(400).json({ success: false, error: 'Address is required.' });
    }

    const cleanName = name.trim();
    const cleanPosition = position.trim();
    const cleanMobile = mobile.trim();
    const cleanAddress = address.trim();
    const cleanEmail = (email && email.trim())
      ? email.trim().toLowerCase()
      : `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@workpulse.com`;
    const cleanPassword = (password && password.trim()) ? password.trim() : 'password123';

    // Duplicate validation against current roster
    const existing = WorkPulseDB.getStaffList();
    const digitsOnly = cleanMobile.replace(/\D/g, '');

    const duplicateEmail = existing.find(s => s.email && s.email.toLowerCase().trim() === cleanEmail);
    if (duplicateEmail) {
      return res.status(400).json({
        success: false,
        error: `A staff member with email "${cleanEmail}" already exists (${duplicateEmail.name} - ${duplicateEmail.id}).`
      });
    }

    if (digitsOnly.length >= 7) {
      const duplicateMobile = existing.find(s => s.mobile && s.mobile.replace(/\D/g, '') === digitsOnly);
      if (duplicateMobile) {
        return res.status(400).json({
          success: false,
          error: `A staff member with mobile number "${cleanMobile}" already exists (${duplicateMobile.name} - ${duplicateMobile.id}).`
        });
      }
    }

    // Save profile photo to disk if provided in base64
    let finalPhoto = photo || null;
    if (photo && typeof photo === 'string' && photo.startsWith('data:image')) {
      const match = photo.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (match) {
        const ext = '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
        const storedFileName = `photo_staff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
        const diskPath = path.join(UPLOADS_DIR, storedFileName);
        fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
        finalPhoto = `/uploads/${storedFileName}`;
      }
    }

    const newStaffObj = {
      name: cleanName,
      position: cleanPosition,
      mobile: cleanMobile,
      address: cleanAddress,
      email: cleanEmail,
      password: hashPassword(cleanPassword), // Stored as salted PBKDF2 hash!
      status: status || 'Active',
      photo: finalPhoto,
      _genuine: true
    };

    const result = WorkPulseDB.addStaff(newStaffObj);
    if (!result) return res.status(400).json({ success: false, error: 'Failed to save staff record' });

    res.status(201).json({ success: true, data: sanitizeStaff(result), message: 'Staff member registered successfully' });
  } catch (err) {
    console.error('[API Register Staff Error]', err);
    res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
  }
});

app.put('/api/staff/:id', authenticateToken, (req, res) => {
  try {
    const existing = WorkPulseDB.getStaffById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Staff not found' });

    // Authorization: only Admin or the staff member themselves can update
    if (req.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot update other staff records' });
    }

    const updateData = { ...req.body };
    // Prevent staff privilege escalation
    if (req.role !== 'admin') {
      delete updateData.role;
      delete updateData.position;
      delete updateData.status;
      delete updateData.id;
      delete updateData.password; // Non-admin staff cannot change password via generic PUT; must use /api/staff/change-password
    }

    if (req.role === 'admin' && updateData.password && updateData.password.trim()) {
      updateData.password = hashPassword(updateData.password.trim());
    } else {
      updateData.password = existing.password;
    }

    const result = WorkPulseDB.updateStaff(req.params.id, updateData);
    res.json({ success: true, data: sanitizeStaff(result) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Staff Password Update (Self-service with verified current password)
app.post('/api/staff/change-password', authenticateToken, (req, res) => {
  try {
    // 1. Authorization: Verify user identity
    const targetStaffId = req.user && req.user.id;
    if (!targetStaffId) {
      return res.status(401).json({ success: false, error: 'Unauthorized: User identity not found in session' });
    }

    // 2. Input validation
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!currentPassword || typeof currentPassword !== 'string' || !currentPassword.trim()) {
      return res.status(400).json({ success: false, error: 'Current password is required.' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      return res.status(400).json({ success: false, error: 'New password must contain at least 6 characters.' });
    }
    if (confirmPassword && confirmPassword !== newPassword) {
      return res.status(400).json({ success: false, error: 'New password and confirmation do not match.' });
    }

    // 3. Retrieve user record from persistent database
    const db = WorkPulseDB.load();
    const staffMember = (db.staff || []).find(s => s && s.id === targetStaffId);
    if (!staffMember) {
      return res.status(404).json({ success: false, error: 'Staff account not found.' });
    }

    // 4. Verify current password against stored salted hash
    const isCurrentValid = verifyPassword(currentPassword.trim(), staffMember.password);
    if (!isCurrentValid) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect. Please check and try again.' });
    }

    // 5. Hash new password securely with bcrypt and store
    const hashedNew = hashPassword(newPassword.trim());
    staffMember.password = hashedNew;
    delete staffMember.passwordHash;

    // Save changes to persistent file
    WorkPulseDB.save(db);

    console.log(`[Staff Password Changed] Successfully updated password for staff ${targetStaffId} (${staffMember.name || staffMember.email})`);

    return res.json({
      success: true,
      message: 'Password updated successfully. Please use your new password for future logins.'
    });
  } catch (err) {
    console.error('[Staff Change Password Error]', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error while changing password' });
  }
});

app.delete('/api/staff/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const staffId = req.params.id;
    // Revoke any active sessions for this staff member
    try {
      const sessions = loadSessions();
      let sessionsUpdated = false;
      for (const [token, session] of Object.entries(sessions)) {
        if (session.userId === staffId) {
          delete sessions[token];
          sessionsUpdated = true;
        }
      }
      if (sessionsUpdated) {
        saveSessions(sessions);
      }
    } catch (e) {
      console.warn('Error revoking sessions for deleted staff:', e);
    }

    const result = WorkPulseDB.deleteStaff(staffId);
    res.json({ success: true, message: 'Staff deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Attendance Management
app.get('/api/attendance', authenticateToken, (req, res) => {
  let { staffId, date, status } = req.query;
  // If staff, enforce that they can ONLY view their own attendance
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff attendance records' });
    }
    staffId = req.user.id;
  }
  const records = WorkPulseDB.getAttendance({ staffId, date, status });
  res.json({ success: true, count: records.length, data: records });
});

// In-memory cache for reverse-geocoded addresses to ensure fast response & Nominatim compliance
const reverseGeocodeCache = new Map();

// Reverse-geocode coordinates into human-readable address using OpenStreetMap Nominatim
async function reverseGeocodeCoords(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (reverseGeocodeCache.has(cacheKey)) {
    return reverseGeocodeCache.get(cacheKey);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
      headers: {
        'User-Agent': 'WorkPulse-Enterprise-Attendance/1.0 (admin@workpulse.com)'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.display_name) {
        reverseGeocodeCache.set(cacheKey, data.display_name);
        return data.display_name;
      }
    }
  } catch (e) {
    // Graceful fallback on network timeout or offline
  }
  return null;
}

// Dedicated Reverse Geocoding API for Client & Admin Portals
app.get('/api/location/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat || req.query.latitude);
  const lng = Number(req.query.lng || req.query.lon || req.query.longitude);
  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ success: false, error: 'Valid latitude and longitude query parameters are required' });
  }

  const address = await reverseGeocodeCoords(lat, lng);
  if (address) {
    return res.json({ success: true, address, latitude: lat, longitude: lng });
  }
  return res.json({ success: false, address: null, error: 'Unable to resolve street address for coordinates' });
});

app.post('/api/attendance/check-in', authenticateToken, async (req, res) => {
  let { staffId } = req.body;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot check in for another staff member' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  try {
    const bodyCoords = req.body.coordinates || req.body.coords || req.body;
    const lat = bodyCoords.latitude !== undefined ? Number(bodyCoords.latitude) : (bodyCoords.lat !== undefined ? Number(bodyCoords.lat) : null);
    const lng = bodyCoords.longitude !== undefined ? Number(bodyCoords.longitude) : (bodyCoords.lng !== undefined ? Number(bodyCoords.lng) : null);
    const acc = bodyCoords.accuracy !== undefined ? Number(bodyCoords.accuracy) : null;
    const coords = (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng)) ? { latitude: lat, longitude: lng, accuracy: acc } : null;

    // Requirement: Never use fake coordinates or silently substitute office coordinates.
    // If staff checks in, actual device location coordinates (GPS, Wi-Fi, or Mobile Network) are required.
    if (!coords && req.role !== 'admin') {
      return res.status(400).json({
        success: false,
        error: 'Location is required for attendance check-in. Please enable device Location Services and allow browser access.'
      });
    }

    // Check location accuracy: allow up to 50,000m (covers Wi-Fi, GPS, and cellular tower network fixes)
    const MAX_ALLOWED_ACCURACY_METERS = 50000;
    if (coords && typeof coords.accuracy === 'number' && coords.accuracy > MAX_ALLOWED_ACCURACY_METERS && req.role !== 'admin') {
      return res.status(400).json({
        success: false,
        error: `Location accuracy is too coarse (±${Math.round(coords.accuracy >= 1000 ? coords.accuracy / 1000 : coords.accuracy)}${coords.accuracy >= 1000 ? 'km' : 'm'}) to mark attendance. Please enable device Location Services and try again.`
      });
    }

    // Convert latest GPS coordinates into the correct readable address
    let address = null;
    if (coords) {
      address = await reverseGeocodeCoords(coords.latitude, coords.longitude);
    }
    if (!address) {
      address = req.body.address || null;
    }

    let customLocation = req.body.location || req.body.customLocation || null;
    if (!customLocation && coords) {
      const latDir = coords.latitude >= 0 ? 'N' : 'S';
      const lngDir = coords.longitude >= 0 ? 'E' : 'W';
      const coordStr = `${Math.abs(coords.latitude).toFixed(4)}° ${latDir}, ${Math.abs(coords.longitude).toFixed(4)}° ${lngDir}`;
      customLocation = address ? `${address} (${coordStr})` : `GPS (${coordStr})`;
    } else if (!customLocation && !coords) {
      customLocation = 'Location unavailable';
    }

    const checkInTimestamp = req.body.timestamp || new Date().toISOString();
    const record = WorkPulseDB.checkInStaff(staffId, coords, customLocation, null, {
      address,
      accuracy: acc,
      checkInTimestamp
    });

    res.json({ success: true, message: 'Check-in recorded', data: record });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/attendance/check-out', authenticateToken, (req, res) => {
  let { staffId } = req.body;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot check out for another staff member' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  try {
    const lat = req.body.latitude !== undefined ? Number(req.body.latitude) : (req.body.lat !== undefined ? Number(req.body.lat) : null);
    const lng = req.body.longitude !== undefined ? Number(req.body.longitude) : (req.body.lng !== undefined ? Number(req.body.lng) : null);
    const coords = (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng)) ? { latitude: lat, longitude: lng } : null;
    const record = WorkPulseDB.checkOutStaff(staffId, coords);
    if (!record) return res.status(404).json({ success: false, error: 'Active shift not found for staff' });
    res.json({ success: true, message: 'Checkout completed', data: record });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/attendance/reset', authenticateToken, (req, res) => {
  let { staffId } = req.body;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot reset other staff attendance' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  const record = WorkPulseDB.resetTodayAttendance(staffId);
  res.json({ success: true, message: 'Today attendance reset for testing', data: record });
});

app.get('/api/attendance/summary', authenticateToken, (req, res) => {
  const currentNow = new Date();
  let { staffId, year = currentNow.getFullYear(), month = currentNow.getMonth() } = req.query;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff summary' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  const summary = WorkPulseDB.getMonthSummaryForStaff(staffId, Number(year), Number(month));
  res.json({ success: true, data: summary });
});

app.get('/api/attendance/:id', authenticateToken, (req, res) => {
  try {
    const record = (typeof WorkPulseDB.getAttendanceById === 'function')
      ? WorkPulseDB.getAttendanceById(req.params.id)
      : (WorkPulseDB.getAttendance() || []).find(r => r.id === req.params.id || r.attendanceId === req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Attendance record not found' });
    }
    if (req.role !== 'admin' && record.staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff attendance records' });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Staff Activity Status & Live Monitoring Telemetry (Admin Only)
app.get('/api/activity/summary', authenticateToken, requireAdmin, (req, res) => {
  const dateStr = req.query.date || WorkPulseDB.getTodayDateString();
  const summary = WorkPulseDB.getStaffActivitySummary(dateStr);
  res.json({
    success: true,
    date: dateStr,
    totalStaff: summary.totalStaff,
    activeCount: summary.activeCount,
    inactiveCount: summary.inactiveCount,
    lunchCount: summary.lunchCount,
    checkedOutCount: summary.checkedOutCount,
    items: summary.items
  });
});

app.get('/api/activity/timeline', authenticateToken, (req, res) => {
  let { staffId, date = WorkPulseDB.getTodayDateString() } = req.query;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff timeline' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  const timeline = WorkPulseDB.getStaffActivityTimeline(staffId, date);
  if (!timeline) return res.status(404).json({ success: false, error: 'Staff timeline not found' });
  res.json({ success: true, data: timeline });
});

// Lunch Break Controller
app.post('/api/activity/lunch/start', authenticateToken, (req, res) => {
  let { staffId } = req.body;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot modify other staff lunch break' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  const result = WorkPulseDB.startLunchBreak(staffId);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/activity/lunch/end', authenticateToken, (req, res) => {
  let { staffId } = req.body;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot modify other staff lunch break' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  const result = WorkPulseDB.endLunchBreak(staffId);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// Dual Inactivity Detection Controller
app.post('/api/activity/inactivity/start', authenticateToken, (req, res) => {
  let { staffId, reason = 'System-wide idle (15 continuous minutes)' } = req.body;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot modify other staff activity state' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  const result = WorkPulseDB.recordInactivityStart(staffId, reason);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/activity/inactivity/resume', authenticateToken, (req, res) => {
  let { staffId } = req.body;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot modify other staff activity state' });
    }
    staffId = req.user.id;
  }
  if (!staffId) return res.status(400).json({ success: false, error: 'staffId is required' });

  const result = WorkPulseDB.recordInactivityResume(staffId);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// Helper: Calculate inclusive calendar days for leave range
function calculateLeaveDays(startDate, endDate) {
  if (!startDate) return 1;
  if (!endDate || endDate === startDate) return 1;
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 1;
  const diffTime = Math.abs(end - start);
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays > 0 ? diffDays : 1;
}

// Leave & WFH Requests
app.get('/api/leaves', authenticateToken, (req, res) => {
  const db = WorkPulseDB.load();
  let { staffId, status } = req.query;
  if (req.role !== 'admin') {
    if (staffId && String(staffId).trim().toUpperCase() !== String(req.user.id).trim().toUpperCase()) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff leave applications' });
    }
    staffId = req.user.id;
  }
  let leaves = db.leaves || [];
  if (staffId) {
    leaves = leaves.filter(l => String(l.staffId || '').trim().toUpperCase() === String(staffId).trim().toUpperCase());
  }
  if (status && status !== 'All') {
    leaves = leaves.filter(l => l.status === status);
  }

  const staffMap = new Map();
  (db.staff || []).forEach(s => {
    if (s && s.id) {
      staffMap.set(String(s.id).trim().toUpperCase(), s);
    }
  });

  leaves = leaves.map(l => {
    const s = l.staffId ? staffMap.get(String(l.staffId).trim().toUpperCase()) : null;
    let name = l.staffName;
    if (!name || name === 'undefined') name = s ? s.name : null;
    if (!name || name === 'undefined') name = l.staffId || 'Staff Member';

    let pos = l.position;
    if (!pos || pos === 'undefined') pos = s ? s.position : null;
    if (!pos || pos === 'undefined') pos = 'Staff';

    const sDate = l.startDate || l.leaveDate;
    const eDate = l.endDate || l.toDate || sDate;
    const tDays = l.totalDays || calculateLeaveDays(sDate, eDate);

    return {
      ...l,
      startDate: sDate,
      endDate: eDate,
      leaveDate: sDate,
      toDate: eDate,
      totalDays: tDays,
      staffName: name,
      position: pos,
      photo: l.photo !== undefined && l.photo !== null && l.photo !== 'undefined' ? l.photo : (s ? s.photo : null)
    };
  });

  res.json({ success: true, count: leaves.length, data: leaves });
});

app.post('/api/leaves', authenticateToken, (req, res) => {
  const db = WorkPulseDB.load();
  if (req.role !== 'admin') {
    if (req.body.staffId && String(req.body.staffId).trim().toUpperCase() !== String(req.user.id).trim().toUpperCase()) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot apply for leave on behalf of another staff member' });
    }
  }
  const staffId = req.role === 'admin' ? (req.body.staffId || 'WP-ADMIN') : req.user.id;
  const startDate = req.body.startDate || req.body.leaveDate;
  const endDate = req.body.endDate || req.body.toDate || startDate;

  if (!startDate) {
    return res.status(400).json({ success: false, error: 'Start Date is required.' });
  }

  if (startDate && endDate && endDate < startDate) {
    return res.status(400).json({ success: false, error: 'End Date cannot be earlier than Start Date.' });
  }

  const staffMember = (db.staff || []).find(s => s && String(s.id).trim().toUpperCase() === String(staffId).trim().toUpperCase()) ||
    (req.user && String(req.user.id).trim().toUpperCase() === String(staffId).trim().toUpperCase() ? req.user : null);

  let resolvedStaffName = req.body.staffName;
  if (!resolvedStaffName || resolvedStaffName === 'undefined') {
    resolvedStaffName = staffMember ? staffMember.name : (req.role === 'admin' ? 'Administrator' : staffId);
  }
  let resolvedPosition = req.body.position;
  if (!resolvedPosition || resolvedPosition === 'undefined') {
    resolvedPosition = staffMember ? staffMember.position : 'Staff Member';
  }
  const resolvedPhoto = req.body.photo !== undefined && req.body.photo !== null && req.body.photo !== 'undefined'
    ? req.body.photo
    : (staffMember ? staffMember.photo : null);

  db.leaves = db.leaves || [];
  const totalDays = req.body.totalDays || calculateLeaveDays(startDate, endDate);

  // Check if a leave request already exists with the same ID, or same staff, dates, and leaveType
  const leaveId = req.body.id || `LV-${Date.now()}`;
  let existingLeave = db.leaves.find(l => l.id === leaveId);
  if (!existingLeave) {
    existingLeave = db.leaves.find(l =>
      String(l.staffId).trim().toUpperCase() === String(staffId).trim().toUpperCase() &&
      (l.startDate === startDate || l.leaveDate === startDate) &&
      (l.endDate === endDate || l.toDate === endDate) &&
      l.leaveType === req.body.leaveType
    );
  }

  if (existingLeave) {
    existingLeave.startDate = startDate;
    existingLeave.endDate = endDate;
    existingLeave.leaveDate = startDate;
    existingLeave.toDate = endDate;
    existingLeave.totalDays = totalDays;
    existingLeave.leaveType = req.body.leaveType || existingLeave.leaveType;
    existingLeave.reason = req.body.reason || existingLeave.reason;
    existingLeave.staffName = resolvedStaffName;
    existingLeave.position = resolvedPosition;
    existingLeave.photo = resolvedPhoto;
    WorkPulseDB.save(db);
    return res.status(200).json({ success: true, message: 'Existing leave request updated', data: existingLeave });
  }

  const newLeave = {
    id: leaveId,
    ...req.body,
    startDate,
    endDate,
    leaveDate: startDate,
    toDate: endDate,
    totalDays: totalDays,
    staffId: staffId,
    staffName: resolvedStaffName,
    position: resolvedPosition,
    photo: resolvedPhoto,
    status: 'Pending',
    appliedDate: req.body.appliedDate || new Date().toISOString().split('T')[0]
  };
  db.leaves.unshift(newLeave);

  db.notifications = db.notifications || [];
  db.notifications.unshift({
    id: `N-${Date.now()}`,
    role: 'admin',
    text: `New leave application from ${resolvedStaffName} (${newLeave.leaveType || 'Leave'}, ${totalDays} day${totalDays === 1 ? '' : 's'})`,
    time: 'Just now',
    read: false
  });

  WorkPulseDB.save(db);
  res.status(201).json({ success: true, data: newLeave });
});

app.patch('/api/leaves/:id', authenticateToken, requireAdmin, (req, res) => {
  const body = req.body || {};
  const { status, notes, rejectionReason, comment, approvalComment, adminComment } = body;
  if (!status) {
    return res.status(400).json({ success: false, error: 'Status is required' });
  }

  const trimmedComment = (comment || adminComment || approvalComment || notes || rejectionReason || '').trim();

  if (status === 'Rejected') {
    const reason = (rejectionReason || comment || adminComment || notes || '').trim();
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Rejection reason is mandatory when rejecting a leave request'
      });
    }
  }

  const reasonToSave = status === 'Rejected'
    ? (rejectionReason || trimmedComment)
    : (trimmedComment || null);

  const result = WorkPulseDB.updateLeaveStatus(req.params.id, status, reasonToSave);
  if (!result || result.success === false) {
    return res.status(404).json({ success: false, error: result && result.error ? result.error : 'Leave request not found' });
  }
  const leaveData = result.data || result.leave || result;
  res.json({ success: true, message: `Leave request ${status}`, data: leaveData });
});

app.get('/api/wfh', authenticateToken, (req, res) => {
  let { staffId } = req.query;
  if (req.role !== 'admin') {
    if (staffId && String(staffId).trim().toUpperCase() !== String(req.user.id).trim().toUpperCase()) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff WFH applications' });
    }
    staffId = req.user.id;
  }
  let wfh = WorkPulseDB.getWfhRequests ? WorkPulseDB.getWfhRequests() : (WorkPulseDB.load().wfhRequests || []);
  if (staffId) {
    const sIdUpper = String(staffId).trim().toUpperCase();
    wfh = wfh.filter(w => String(w.staffId || '').trim().toUpperCase() === sIdUpper);
  }
  res.json({ success: true, count: wfh.length, data: wfh });
});

app.post('/api/wfh', authenticateToken, (req, res) => {
  try {
    const db = WorkPulseDB.load();
    if (req.role !== 'admin') {
      if (req.body.staffId && String(req.body.staffId).trim().toUpperCase() !== String(req.user.id).trim().toUpperCase()) {
        return res.status(403).json({ success: false, error: 'Forbidden: Cannot apply for WFH on behalf of another staff member' });
      }
    }
    const staffId = req.role === 'admin' ? (req.body.staffId || 'WP-ADMIN') : req.user.id;
    const date = String(req.body.date || '').trim();
    const reason = String(req.body.reason || '').trim();

    if (!date || !reason) {
      return res.status(400).json({ success: false, error: 'Target Date and Reason are required for WFH requests' });
    }

    const staffIdUpper = String(staffId).trim().toUpperCase();
    const staffMember = (db.staff || []).find(s => s && String(s.id).trim().toUpperCase() === staffIdUpper) ||
      (req.user && String(req.user.id).trim().toUpperCase() === staffIdUpper ? req.user : null);

    db.wfhRequests = db.wfhRequests || [];

    // Check for existing request with same ID or same staffId and date
    const reqId = req.body.id ? String(req.body.id).trim() : null;
    let existingWfh = null;

    if (reqId) {
      existingWfh = db.wfhRequests.find(w => w && String(w.id).trim() === reqId);
    }

    if (!existingWfh) {
      existingWfh = db.wfhRequests.find(w =>
        w && String(w.staffId || '').trim().toUpperCase() === staffIdUpper &&
        String(w.date || '').trim() === date &&
        String(w.status || 'Pending').toLowerCase() === 'pending'
      );
    }

    if (existingWfh) {
      // Idempotent duplicate prevention: update reason and return existing record without duplicating
      existingWfh.reason = reason || existingWfh.reason;
      if (staffMember) {
        existingWfh.staffName = staffMember.name || existingWfh.staffName;
        existingWfh.position = staffMember.position || existingWfh.position;
        existingWfh.photo = staffMember.photo || existingWfh.photo;
      }
      WorkPulseDB.save(db);
      return res.status(200).json({ success: true, data: existingWfh, message: 'Existing pending WFH request updated' });
    }

    // Check if request for this date was already approved or rejected
    const decidedWfh = db.wfhRequests.find(w =>
      w && String(w.staffId || '').trim().toUpperCase() === staffIdUpper &&
      String(w.date || '').trim() === date &&
      (String(w.status || '').toLowerCase() === 'approved' || String(w.status || '').toLowerCase() === 'rejected')
    );
    if (decidedWfh && req.role !== 'admin') {
      return res.status(409).json({
        success: false,
        error: `A Work From Home request for this date has already been ${decidedWfh.status.toLowerCase()}.`
      });
    }

    const newWfh = {
      id: reqId || `WFH-${Date.now()}`,
      staffId: staffId,
      staffName: staffMember ? staffMember.name : (req.body.staffName || (req.role === 'admin' ? 'Administrator' : staffId)),
      position: staffMember ? staffMember.position : (req.body.position || 'Staff Member'),
      photo: (staffMember && staffMember.photo) ? staffMember.photo : (req.body.photo || null),
      date: date,
      reason: reason,
      status: 'Pending',
      checkIn: '--:--',
      checkOut: '--:--',
      workingHours: '0h 00m',
      appliedDate: new Date().toISOString().split('T')[0]
    };

    db.wfhRequests.unshift(newWfh);

    // Notify Admin
    if (!Array.isArray(db.notifications)) db.notifications = [];
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      text: `New WFH request from ${newWfh.staffName} for ${date}`,
      time: 'Just now',
      read: false
    });

    WorkPulseDB.save(db);
    res.status(201).json({ success: true, data: newWfh });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/wfh/:id', authenticateToken, requireAdmin, (req, res) => {
  const body = req.body || {};
  const { status, notes, rejectionReason } = body;
  if (!status) {
    return res.status(400).json({ success: false, error: 'Status is required' });
  }
  if (status === 'Rejected') {
    const reason = (rejectionReason || notes || '').trim();
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Rejection reason is mandatory when rejecting a WFH request'
      });
    }
  }
  const reasonToSave = status === 'Rejected' ? (rejectionReason || notes) : (notes || null);
  const result = WorkPulseDB.updateWFHStatus(req.params.id, status, reasonToSave);
  if (!result || !result.success) return res.status(400).json(result || { success: false, error: 'Failed to update WFH request' });
  res.json(result);
});

// Authoritative Pending Notification Counts (Admin Only)
app.get('/api/admin/pending-counts', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = WorkPulseDB.load();

    // Deduplicate and filter pending leaves
    const pendingLeavesMap = new Map();
    (db.leaves || []).forEach(l => {
      if (l && l.id && String(l.status || '').trim().toLowerCase() === 'pending') {
        pendingLeavesMap.set(String(l.id).trim(), l);
      }
    });

    // Deduplicate and filter pending WFH requests
    const pendingWfhMap = new Map();
    (db.wfhRequests || []).forEach(w => {
      if (w && w.id && String(w.status || '').trim().toLowerCase() === 'pending') {
        const sig = `${String(w.staffId || '').trim()}_${String(w.date || '').trim()}`.toUpperCase();
        if (!pendingWfhMap.has(sig)) {
          pendingWfhMap.set(sig, w);
        }
      }
    });

    const pendingRequestsCount = typeof WorkPulseDB.getGeneralRequests === 'function'
      ? WorkPulseDB.getGeneralRequests({ status: 'Pending' }).length
      : (db.generalRequests || []).filter(r => String(r.status || '').trim().toLowerCase() === 'pending').length;

    res.json({
      success: true,
      pendingLeaves: pendingLeavesMap.size,
      pendingWfh: pendingWfhMap.size,
      pendingRequests: pendingRequestsCount,
      totalPendingApprovals: pendingLeavesMap.size + pendingWfhMap.size
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// PROJECTS MANAGEMENT REST API
// -----------------------------------------------------------------------------

// List Projects (Scoped by role: Admin sees all, Staff sees assigned/shared)
app.get('/api/projects', authenticateToken, (req, res) => {
  try {
    const db = WorkPulseDB.load();
    let { staffId, status, priority, search, date } = req.query;

    if (req.role !== 'admin') {
      staffId = req.user.id;
    }

    let projects = WorkPulseDB.getProjects({ staffId, status, priority, search, date });

    // Attach real-time computed progress and task stats to each project
    const projectsWithProgress = projects.map(p => {
      const progress = WorkPulseDB.getProjectProgress(p.id);
      return {
        ...p,
        progress
      };
    });

    res.json({
      success: true,
      count: projectsWithProgress.length,
      data: projectsWithProgress
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create Project (Admin Only)
app.post('/api/projects', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, projectName, description, startDate, dueDate, priority, status, assignedStaffIds } = req.body;
    const title = (name || projectName || '').trim();
    if (!title) {
      return res.status(400).json({ success: false, error: 'Project name is required' });
    }

    const project = WorkPulseDB.addProject({
      name: title,
      description,
      startDate,
      dueDate,
      priority,
      status,
      assignedStaffIds
    }, req.user);

    const progress = WorkPulseDB.getProjectProgress(project.id);
    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: { ...project, progress }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Single Project Details with Tasks
app.get('/api/projects/:id', authenticateToken, (req, res) => {
  try {
    const project = WorkPulseDB.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    // Role verification: Staff must be assigned to project or project assigned to 'all'
    if (req.role !== 'admin') {
      const staffIds = Array.isArray(project.assignedStaffIds) ? project.assignedStaffIds : [project.assignedStaffId];
      if (!staffIds.includes(req.user.id) && !staffIds.includes('all')) {
        return res.status(403).json({ success: false, error: 'Forbidden: Access to this project is not permitted' });
      }
    }

    const tasks = WorkPulseDB.getTasks({ projectId: project.id });
    const progress = WorkPulseDB.getProjectProgress(project.id);

    res.json({
      success: true,
      data: {
        ...project,
        progress,
        tasks
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Project (Admin Only)
app.put('/api/projects/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const updated = WorkPulseDB.updateProject(req.params.id, req.body, req.user);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    const progress = WorkPulseDB.getProjectProgress(updated.id);
    res.json({
      success: true,
      message: 'Project updated successfully',
      data: { ...updated, progress }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Project (Admin Only)
app.delete('/api/projects/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteProject(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Project Status (Admin or Assigned Staff)
app.patch('/api/projects/:id/status', authenticateToken, (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'Status is required' });

    const project = WorkPulseDB.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    if (req.role !== 'admin') {
      const staffIds = Array.isArray(project.assignedStaffIds) ? project.assignedStaffIds : [project.assignedStaffId];
      if (!staffIds.includes(req.user.id) && !staffIds.includes('all')) {
        return res.status(403).json({ success: false, error: 'Forbidden: You are not assigned to this project' });
      }
    }

    const updated = WorkPulseDB.updateProject(req.params.id, { status }, req.user);
    const progress = WorkPulseDB.getProjectProgress(updated.id);
    res.json({ success: true, message: `Project status updated to ${status}`, data: { ...updated, progress } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Project Comment (Admin or Assigned Staff)
app.post('/api/projects/:id/comments', authenticateToken, (req, res) => {
  try {
    const { text, comment } = req.body;
    const commentText = (text || comment || '').trim();
    if (!commentText) return res.status(400).json({ success: false, error: 'Comment text is required' });

    const project = WorkPulseDB.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    if (req.role !== 'admin') {
      const staffIds = Array.isArray(project.assignedStaffIds) ? project.assignedStaffIds : [project.assignedStaffId];
      if (!staffIds.includes(req.user.id) && !staffIds.includes('all')) {
        return res.status(403).json({ success: false, error: 'Forbidden: You are not assigned to this project' });
      }
    }

    const newComment = WorkPulseDB.addProjectComment(req.params.id, commentText, req.user);
    res.status(201).json({ success: true, message: 'Comment added successfully', data: newComment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Project Attachment (Admin or Assigned Staff)
app.post('/api/projects/:id/attachments', authenticateToken, (req, res) => {
  try {
    const { name, size, url, dataBase64 } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Attachment name is required' });

    const project = WorkPulseDB.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    if (req.role !== 'admin') {
      const staffIds = Array.isArray(project.assignedStaffIds) ? project.assignedStaffIds : [project.assignedStaffId];
      if (!staffIds.includes(req.user.id) && !staffIds.includes('all')) {
        return res.status(403).json({ success: false, error: 'Forbidden: You are not assigned to this project' });
      }
    }

    let fileUrl = url || '#';
    if (dataBase64) {
      const match = dataBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const cleanName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storedFileName = `proj_${req.params.id}_${Date.now()}_${cleanName}`;
        const diskPath = path.join(UPLOADS_DIR, storedFileName);
        fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
        fileUrl = `/uploads/${storedFileName}`;
      }
    }

    const newAttachment = WorkPulseDB.addProjectAttachment(req.params.id, {
      name,
      size: size || '1.0 MB',
      url: fileUrl
    }, req.user);

    res.status(201).json({ success: true, message: 'Attachment uploaded successfully', data: newAttachment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Project Review / Milestone Approval (Admin Only)
app.post('/api/projects/:id/reviews', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { decision, notes, date } = req.body;
    const project = WorkPulseDB.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const review = WorkPulseDB.addProjectReview(req.params.id, {
      decision: decision || 'Approved',
      notes: notes || '',
      date: date || new Date().toISOString().split('T')[0]
    }, req.user);

    res.status(201).json({ success: true, message: 'Review recorded successfully', data: review });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// CLIENT MANAGEMENT REST API
// -----------------------------------------------------------------------------
// Get Clients (Admin sees full list; with optional search and status filters)
app.get('/api/clients', authenticateToken, (req, res) => {
  try {
    const { search, paymentStatus, projectStatus } = req.query;
    const clients = WorkPulseDB.getClients({ search, paymentStatus, projectStatus });
    const summary = WorkPulseDB.getClientSummary();
    res.json({ success: true, count: clients.length, data: clients, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/clients/summary', authenticateToken, (req, res) => {
  try {
    const summary = WorkPulseDB.getClientSummary();
    res.json({ success: true, data: summary, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/clients/:id', authenticateToken, (req, res) => {
  try {
    const client = WorkPulseDB.getClientById(req.params.id);
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/clients', authenticateToken, requireAdmin, (req, res) => {
  try {
    const name = (req.body.name || req.body.clientName || '').trim();
    const company = (req.body.company || req.body.companyName || '').trim();
    const phone = (req.body.phone || req.body.mobile || '').trim();
    const email = (req.body.email || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, error: 'Client name is required' });
    }
    if (!company) {
      return res.status(400).json({ success: false, error: 'Company name is required' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }

    const newClient = WorkPulseDB.addClient({ ...req.body, name, company, phone, email }, req.user);
    res.status(201).json({ success: true, message: 'Client created successfully', data: newClient, client: newClient });
  } catch (err) {
    if (err.code === 'DUPLICATE_CLIENT') {
      return res.status(409).json({ success: false, code: 'DUPLICATE_CLIENT', error: err.message, message: err.message, duplicateClient: err.duplicateClient });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/clients/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const updated = WorkPulseDB.updateClient(req.params.id, req.body, req.user);
    if (!updated) return res.status(404).json({ success: false, error: 'Client not found' });
    res.json({ success: true, message: 'Client updated successfully', data: updated });
  } catch (err) {
    if (err.code === 'DUPLICATE_CLIENT') {
      return res.status(409).json({ success: false, code: 'DUPLICATE_CLIENT', error: err.message, message: err.message, duplicateClient: err.duplicateClient });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/clients/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteClient(req.params.id, req.user);
    if (!success) return res.status(404).json({ success: false, error: 'Client not found' });
    res.json({ success: true, message: 'Client deleted successfully' });
  } catch (err) {
    if (err.code === 'CLIENT_HAS_LINKED_DOMAINS') {
      return res.status(400).json({ success: false, error: err.message, code: err.code });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// Client Project Sub-items
app.post('/api/clients/:id/projects', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = WorkPulseDB.addClientProject(req.params.id, req.body, req.user);
    if (!result) return res.status(404).json({ success: false, error: 'Client not found' });

    // Automatically synchronize domain record if domainName is provided
    if (req.body.domainName && String(req.body.domainName).trim()) {
      try {
        const cleanDomain = String(req.body.domainName).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const existing = WorkPulseDB.getDomains().find(d => (d.domainName || '').toLowerCase() === cleanDomain);
        if (existing) {
          WorkPulseDB.updateDomain(existing.id, {
            ownerType: 'client',
            clientId: req.params.id,
            projectId: result.project.id,
            hostingProvider: req.body.hostingProvider || existing.hostingProvider,
            registrationDate: req.body.registrationDate || existing.registrationDate,
            expiryDate: req.body.expiryDate || existing.expiryDate,
            renewalCost: req.body.renewalCost !== undefined ? Number(req.body.renewalCost) : existing.renewalCost
          }, req.user);
        } else {
          WorkPulseDB.addDomain({
            domainName: cleanDomain,
            ownerType: 'client',
            clientId: req.params.id,
            projectId: result.project.id,
            hostingProvider: req.body.hostingProvider || 'AWS Route 53 / EC2',
            registrationDate: req.body.registrationDate || new Date().toISOString().split('T')[0],
            expiryDate: req.body.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
            renewalCost: Number(req.body.renewalCost) || 0
          }, req.user);
        }
      } catch (domErr) {
        console.warn('[Domain Sync] Notice on project add:', domErr.message);
      }
    }

    res.status(201).json({ success: true, message: 'Project added to client', data: result.project, client: result.client });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/clients/:id/projects/:projectId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = WorkPulseDB.updateClientProject(req.params.id, req.params.projectId, req.body, req.user);
    if (!result) return res.status(404).json({ success: false, error: 'Client or project not found' });

    // Automatically synchronize domain record if domainName is provided
    if (req.body.domainName && String(req.body.domainName).trim()) {
      try {
        const cleanDomain = String(req.body.domainName).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const existing = WorkPulseDB.getDomains().find(d => (d.domainName || '').toLowerCase() === cleanDomain || (d.projectId === req.params.projectId));
        if (existing) {
          WorkPulseDB.updateDomain(existing.id, {
            domainName: cleanDomain,
            ownerType: 'client',
            clientId: req.params.id,
            projectId: req.params.projectId,
            hostingProvider: req.body.hostingProvider || existing.hostingProvider,
            registrationDate: req.body.registrationDate || existing.registrationDate,
            expiryDate: req.body.expiryDate || existing.expiryDate,
            renewalCost: req.body.renewalCost !== undefined ? Number(req.body.renewalCost) : existing.renewalCost
          }, req.user);
        } else {
          WorkPulseDB.addDomain({
            domainName: cleanDomain,
            ownerType: 'client',
            clientId: req.params.id,
            projectId: req.params.projectId,
            hostingProvider: req.body.hostingProvider || 'AWS Route 53 / EC2',
            registrationDate: req.body.registrationDate || new Date().toISOString().split('T')[0],
            expiryDate: req.body.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
            renewalCost: Number(req.body.renewalCost) || 0
          }, req.user);
        }
      } catch (domErr) {
        console.warn('[Domain Sync] Notice on project update:', domErr.message);
      }
    }

    res.json({ success: true, message: 'Client project updated', data: result.project, client: result.client });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/clients/:id/projects/:projectId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteClientProject(req.params.id, req.params.projectId, req.user);
    if (!success) return res.status(404).json({ success: false, error: 'Client or project not found' });
    res.json({ success: true, message: 'Client project deleted' });
  } catch (err) {
    if (err.code === 'PROJECT_HAS_LINKED_DOMAINS') {
      return res.status(400).json({ success: false, error: err.message, code: err.code });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// Record Client Project Payment Installment
app.post('/api/clients/:id/projects/:projectId/payments', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = WorkPulseDB.recordClientPayment(req.params.id, req.params.projectId, req.body, req.user);
    res.status(201).json({ success: true, message: 'Payment recorded successfully', data: result.project, project: result.project, client: result.client, payment: result.payment });
  } catch (err) {
    const status = (err.message === 'Client not found' || err.message === 'Project not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Append Client Notes
app.post('/api/clients/:id/notes', authenticateToken, requireAdmin, (req, res) => {
  try {
    const noteText = req.body.text || req.body.note || req.body.notes;
    const result = WorkPulseDB.addClientNote(req.params.id, noteText, req.user);
    res.status(201).json({ success: true, message: 'Note added to client dossier', data: result.client, client: result.client, note: result.note });
  } catch (err) {
    const status = err.message === 'Client not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// LEAD MANAGEMENT REST API
// -----------------------------------------------------------------------------
app.get('/api/leads', authenticateToken, (req, res) => {
  try {
    let { staffId, telecallerId, status, service, source, search, timeframe, dateFilter } = req.query;
    if (req.role !== 'admin') {
      staffId = req.user.id; // Staff telecallers only see their assigned leads
      telecallerId = req.user.id;
    }
    const leads = WorkPulseDB.getLeads({ staffId: staffId || telecallerId, status, service, source, search, timeframe, dateFilter });
    const summary = WorkPulseDB.getLeadSummary({ staffId: staffId || telecallerId });
    res.json({ success: true, count: leads.length, data: leads, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/leads/summary', authenticateToken, (req, res) => {
  try {
    let staffId = req.query.staffId || req.query.telecallerId;
    if (req.role !== 'admin') staffId = req.user.id;
    const summary = WorkPulseDB.getLeadSummary({ staffId });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/leads/reports/telecallers', authenticateToken, requireAdmin, (req, res) => {
  try {
    const reports = WorkPulseDB.getTelecallerReport();
    res.json({ success: true, data: reports });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/import', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads)) {
      return res.status(400).json({ success: false, error: 'Expected "leads" array in request body' });
    }
    const result = WorkPulseDB.importLeads(leads, req.user);
    res.json({ success: true, message: `Imported ${result.importedCount} leads (${result.skippedCount} skipped/duplicates)`, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/leads/:id', authenticateToken, (req, res) => {
  try {
    const lead = WorkPulseDB.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (req.role !== 'admin' && String(lead.assignedStaffId || '').trim().toUpperCase() !== String(req.user.id).trim().toUpperCase()) {
      return res.status(403).json({ success: false, error: 'Forbidden: You cannot view leads not assigned to you' });
    }
    res.json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads', authenticateToken, requireAdmin, (req, res) => {
  try {
    const name = (req.body.name || req.body.leadName || '').trim();
    const phone = (req.body.phone || '').trim();
    const service = (req.body.service || req.body.interestedService || '').trim();
    const assignedStaffId = (req.body.assignedStaffId || req.body.assignedTelecaller || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, error: 'Lead name is required' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }
    if (!service) {
      return res.status(400).json({ success: false, error: 'Interested service is required' });
    }
    if (!assignedStaffId) {
      return res.status(400).json({ success: false, error: 'Assigned telecaller staff is required' });
    }

    const lead = WorkPulseDB.addLead(req.body, req.user);
    res.status(201).json({ success: true, message: 'Lead added successfully', data: lead, lead: lead });
  } catch (err) {
    if (err.code === 'DUPLICATE_LEAD') {
      return res.status(409).json({ success: false, duplicate: true, error: err.message, duplicateLead: err.duplicateLead });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/leads/:id', authenticateToken, (req, res) => {
  try {
    const lead = WorkPulseDB.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (req.role !== 'admin' && String(lead.assignedStaffId || '').trim().toUpperCase() !== String(req.user.id).trim().toUpperCase()) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot edit unassigned lead' });
    }
    const updated = WorkPulseDB.updateLead(req.params.id, req.body, req.user);
    res.json({ success: true, message: 'Lead updated successfully', data: updated, lead: updated });
  } catch (err) {
    if (err.code === 'DUPLICATE_LEAD') {
      return res.status(409).json({ success: false, duplicate: true, error: err.message, duplicateLead: err.duplicateLead });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/leads/:id/status', authenticateToken, (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'New status is required' });

    const validStatuses = ['New', 'Contacted', 'Follow-up', 'Interested', 'Converted', 'Lost'];
    const matchStatus = validStatuses.find(s => s.toLowerCase() === status.toLowerCase());
    if (!matchStatus) {
      return res.status(400).json({ success: false, error: `Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}` });
    }

    const lead = WorkPulseDB.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    if (req.role !== 'admin' && String(lead.assignedStaffId || '').trim().toUpperCase() !== String(req.user.id).trim().toUpperCase()) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot update status of unassigned lead' });
    }

    const updated = WorkPulseDB.updateLeadStatus(req.params.id, matchStatus, req.user);
    res.json({ success: true, message: `Lead status updated to ${matchStatus}`, data: updated, lead: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/:id/notes', authenticateToken, (req, res) => {
  try {
    const { note, text, followUpNotes, nextFollowUpDate, nextFollowUpTime, nextAction } = req.body;
    const noteText = note || text || followUpNotes;
    if (!noteText || !noteText.trim()) {
      return res.status(400).json({ success: false, error: 'Follow-up note text cannot be empty' });
    }

    const lead = WorkPulseDB.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    if (req.role !== 'admin' && String(lead.assignedStaffId || '').trim().toUpperCase() !== String(req.user.id).trim().toUpperCase()) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot add note to unassigned lead' });
    }

    if (req.body.status) {
      WorkPulseDB.updateLeadStatus(req.params.id, req.body.status, req.user);
    }
    const result = WorkPulseDB.addLeadNote(req.params.id, noteText, req.user, nextFollowUpDate, nextFollowUpTime, nextAction);
    res.status(201).json({ success: true, message: 'Follow-up note recorded', data: result.note, lead: result.lead });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/:id/convert', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = WorkPulseDB.convertLeadToClient(req.params.id, req.body || {}, req.user);
    res.json({
      success: true,
      message: result.isExistingClient
        ? `Lead successfully converted and linked to existing client "${result.client.name}".`
        : `Lead successfully converted into new client "${result.client.name}".`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/leads/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteLead(req.params.id, req.user);
    if (!success) return res.status(404).json({ success: false, error: 'Lead not found' });
    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// DOMAIN & HOSTING MANAGEMENT REST API
// -----------------------------------------------------------------------------
app.get('/api/domains', authenticateToken, (req, res) => {
  try {
    const { search, status, ownerType, clientId, projectId, registrar, hostingProvider, sortBy, expiryFilter, startDate, endDate } = req.query;
    const domains = WorkPulseDB.getDomains({ search, status, ownerType, clientId, projectId, registrar, hostingProvider, sortBy, expiryFilter, startDate, endDate });
    const summary = WorkPulseDB.getDomainSummary();
    res.json({ success: true, count: domains.length, data: domains, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/domains/summary', authenticateToken, (req, res) => {
  try {
    const summary = WorkPulseDB.getDomainSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/domains/check-reminders', authenticateToken, (req, res) => {
  try {
    const reminders = WorkPulseDB.checkDomainReminders();
    res.json({ success: true, message: 'Domain renewal reminders checked', count: reminders.length, data: reminders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/domains/:id', authenticateToken, (req, res) => {
  try {
    const domain = WorkPulseDB.getDomainById(req.params.id);
    if (!domain) return res.status(404).json({ success: false, error: 'Domain record not found' });
    res.json({ success: true, data: domain });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/domains', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { domainName, expiryDate, clientId, projectId, ownerType } = req.body || {};
    if (!domainName || !domainName.trim()) {
      return res.status(400).json({ success: false, error: 'Domain name is required' });
    }
    if (!expiryDate || !expiryDate.trim()) {
      return res.status(400).json({ success: false, error: 'Domain expiry date is required' });
    }
    if (!clientId && ownerType !== 'company') {
      return res.status(400).json({ success: false, error: 'Client selection is required. Every domain and hosting record must be linked to both a Client and a specific Project.' });
    }
    if (!projectId && ownerType !== 'company') {
      return res.status(400).json({ success: false, error: 'Project selection is required. Every domain and hosting record must be linked to a specific Project.' });
    }

    const domain = WorkPulseDB.addDomain(req.body, req.user);
    res.status(201).json({ success: true, message: 'Domain record created successfully', data: domain });
  } catch (err) {
    if (err.code === 'DUPLICATE_DOMAIN') {
      return res.status(409).json({ success: false, error: err.message, duplicateDomain: err.duplicateDomain });
    }
    if (err.code === 'CLIENT_REQUIRED' || err.code === 'PROJECT_REQUIRED' || err.code === 'CLIENT_NOT_FOUND' || err.code === 'PROJECT_NOT_FOUND' || err.code === 'INVALID_DOMAIN') {
      return res.status(400).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/domains/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const updated = WorkPulseDB.updateDomain(req.params.id, req.body, req.user);
    if (!updated) return res.status(404).json({ success: false, error: 'Domain record not found' });
    res.json({ success: true, message: 'Domain record updated successfully', data: updated });
  } catch (err) {
    if (err.code === 'DUPLICATE_DOMAIN') {
      return res.status(409).json({ success: false, error: err.message, duplicateDomain: err.duplicateDomain });
    }
    if (err.code === 'CLIENT_REQUIRED' || err.code === 'PROJECT_REQUIRED' || err.code === 'CLIENT_NOT_FOUND' || err.code === 'PROJECT_NOT_FOUND') {
      return res.status(400).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/domains/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteDomain(req.params.id, req.user);
    if (!success) return res.status(404).json({ success: false, error: 'Domain record not found' });
    res.json({ success: true, message: 'Domain record deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/domains/:id/renew', authenticateToken, requireAdmin, (req, res) => {
  try {
    const renewed = WorkPulseDB.recordDomainRenewal(req.params.id, req.body, req.user);
    if (!renewed) return res.status(404).json({ success: false, error: 'Domain record not found' });
    res.json({ success: true, message: 'Domain renewal recorded successfully', data: renewed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// TASKS & KANBAN MANAGEMENT REST API
// -----------------------------------------------------------------------------

// List Tasks (Role scoped: Admin sees all; Staff sees assigned/shared)
app.get('/api/tasks', authenticateToken, (req, res) => {
  try {
    let { staffId, projectId, status, priority, search } = req.query;

    if (req.role !== 'admin') {
      staffId = req.user.id;
    }

    const tasks = WorkPulseDB.getTasks({ staffId, projectId, status, priority, search });
    res.json({
      success: true,
      count: tasks.length,
      data: tasks
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Single Task Details (includes subtasks, comments, activity history)
app.get('/api/tasks/:id', authenticateToken, (req, res) => {
  try {
    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (req.role !== 'admin') {
      const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (!ids.includes(req.user.id) && !ids.includes('all') && task.assignedStaffId !== req.user.id && task.assignedStaffId !== 'all') {
        return res.status(403).json({ success: false, error: 'Forbidden: Access to this task is restricted' });
      }
    }

    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create Task (Admin or Staff within assigned project)
app.post('/api/tasks', authenticateToken, (req, res) => {
  try {
    const { title, description, projectId, startDate, dueDate, priority, status, assignedStaffIds, assignedStaffId, file, attachments } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Task title is required' });
    }

    // If staff creating a task, ensure they are permitted
    let staffIdsToAssign = assignedStaffIds || (assignedStaffId ? [assignedStaffId] : []);
    if (req.role !== 'admin') {
      if (projectId) {
        const prj = WorkPulseDB.getProjectById(projectId);
        const pStaff = prj && Array.isArray(prj.assignedStaffIds) ? prj.assignedStaffIds : [];
        if (!pStaff.includes(req.user.id) && !pStaff.includes('all')) {
          return res.status(403).json({ success: false, error: 'Forbidden: You cannot create tasks in unassigned projects' });
        }
      }
      if (!staffIdsToAssign.length) staffIdsToAssign = [req.user.id];
    }

    const newTask = WorkPulseDB.addTask({
      title,
      description,
      projectId,
      startDate,
      dueDate,
      priority,
      status: status || 'To Do',
      assignedStaffIds: staffIdsToAssign,
      file,
      attachments
    }, req.user);

    res.status(201).json({ success: true, message: 'Task created successfully', data: newTask, task: newTask });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Task (Full Update)
app.put('/api/tasks/:id', authenticateToken, (req, res) => {
  try {
    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (req.role !== 'admin') {
      const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (!ids.includes(req.user.id) && !ids.includes('all')) {
        return res.status(403).json({ success: false, error: 'Forbidden: You cannot modify tasks not assigned to you' });
      }
    }

    const updated = WorkPulseDB.updateTask(req.params.id, req.body, req.user);
    res.json({ success: true, message: 'Task updated successfully', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Quick Status Update (Used by Kanban Drag-and-Drop & Quick Actions)
app.patch('/api/tasks/:id/status', authenticateToken, (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'New status is required' });

    const validStatuses = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Completed', 'On Hold', 'Pending'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}` });
    }

    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (req.role !== 'admin') {
      const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (!ids.includes(req.user.id) && !ids.includes('all') && task.assignedStaffId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: Cannot update status of unassigned task' });
      }
    }

    const updated = WorkPulseDB.updateTaskStatus(req.params.id, status, req.user);
    res.json({ success: true, message: `Task status updated to ${status}`, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Backward-compatibility status update patch
app.patch('/api/tasks/:id', authenticateToken, (req, res) => {
  try {
    const { status } = req.body;
    if (status) {
      const task = WorkPulseDB.getTaskById(req.params.id);
      if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

      if (req.role !== 'admin') {
        const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
        if (!ids.includes(req.user.id) && !ids.includes('all')) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      }

      const result = WorkPulseDB.updateTaskStatus(req.params.id, status, req.user);
      return res.json({ success: true, data: result });
    }

    const updated = WorkPulseDB.updateTask(req.params.id, req.body, req.user);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Subtask (Unlimited subtasks per task with full rich metadata)
app.post('/api/tasks/:id/subtasks', authenticateToken, (req, res) => {
  try {
    const { title, description, assignedStaffId, assignedStaffName, startDate, dueDate, priority, status, progress } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, error: 'Subtask title is required' });
    }

    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (req.role !== 'admin') {
      const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (!ids.includes(req.user.id) && !ids.includes('all') && task.assignedStaffId !== req.user.id && task.staffId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: You are not authorized to add subtasks to this task' });
      }
    }

    const result = WorkPulseDB.addSubtask(req.params.id, {
      title,
      description,
      assignedStaffId,
      assignedStaffName,
      startDate,
      dueDate,
      priority,
      status,
      progress
    }, req.user);

    res.status(201).json({ success: true, message: 'Subtask created successfully', data: result.subtask, task: result.task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Subtask (PUT and PATCH: Update title, description, staff, dates, priority, status, progress, completion)
const handleSubtaskUpdate = (req, res) => {
  try {
    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (req.role !== 'admin') {
      const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (!ids.includes(req.user.id) && !ids.includes('all') && task.assignedStaffId !== req.user.id && task.staffId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    }

    const result = WorkPulseDB.updateSubtask(req.params.id, req.params.subtaskId, req.body || {}, req.user);
    if (!result) return res.status(404).json({ success: false, error: 'Subtask not found' });
    res.json({ success: true, message: 'Subtask updated successfully', data: result.subtask, task: result.task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

app.put('/api/tasks/:id/subtasks/:subtaskId', authenticateToken, handleSubtaskUpdate);
app.patch('/api/tasks/:id/subtasks/:subtaskId', authenticateToken, handleSubtaskUpdate);

// Delete Subtask
app.delete('/api/tasks/:id/subtasks/:subtaskId', authenticateToken, (req, res) => {
  try {
    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (req.role !== 'admin') {
      const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (!ids.includes(req.user.id) && !ids.includes('all') && task.assignedStaffId !== req.user.id && task.staffId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    }

    const updatedTask = WorkPulseDB.deleteSubtask(req.params.id, req.params.subtaskId, req.user);
    res.json({ success: true, message: 'Subtask deleted successfully', data: updatedTask });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Subtask Comment
app.post('/api/tasks/:id/subtasks/:subtaskId/comments', authenticateToken, (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }

    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const result = WorkPulseDB.addSubtaskComment(req.params.id, req.params.subtaskId, {
      text,
      authorName: req.user.name || (req.role === 'admin' ? 'Administrator' : req.user.id),
      authorId: req.user.id || (req.role === 'admin' ? 'WP-ADMIN' : 'STAFF'),
      authorRole: req.role
    }, req.user);

    if (!result) return res.status(404).json({ success: false, error: 'Subtask not found' });
    res.status(201).json({ success: true, message: 'Subtask comment posted', data: result.comment, subtask: result.subtask });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Subtask Attachment
app.post('/api/tasks/:id/subtasks/:subtaskId/attachments', authenticateToken, (req, res) => {
  try {
    const { name, size, url, dataBase64 } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: 'File name is required' });

    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const result = WorkPulseDB.addSubtaskAttachment(req.params.id, req.params.subtaskId, {
      name,
      size,
      url: url || dataBase64,
      uploadedBy: req.user.name || (req.role === 'admin' ? 'Administrator' : req.user.id),
      uploadedById: req.user.id || (req.role === 'admin' ? 'WP-ADMIN' : 'STAFF')
    }, req.user);

    if (!result) return res.status(404).json({ success: false, error: 'Subtask not found' });
    res.status(201).json({ success: true, message: 'Subtask attachment uploaded', data: result.attachment, subtask: result.subtask });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Record Subtask Review
app.post('/api/tasks/:id/subtasks/:subtaskId/review', authenticateToken, (req, res) => {
  try {
    const { decision, notes } = req.body || {};
    if (!decision) return res.status(400).json({ success: false, error: 'Review decision is required' });

    if (req.role !== 'admin' && (decision === 'Approved' || decision === 'Changes Requested')) {
      return res.status(403).json({ success: false, error: 'Forbidden: Only Administrator can approve or request changes on subtasks' });
    }

    const result = WorkPulseDB.addSubtaskReview(req.params.id, req.params.subtaskId, {
      decision,
      notes,
      reviewer: req.user.name || 'Administrator',
      reviewerId: req.user.id || 'WP-ADMIN'
    }, req.user);

    if (!result) return res.status(404).json({ success: false, error: 'Subtask not found' });
    res.json({ success: true, message: 'Subtask review saved', data: result.review, subtask: result.subtask });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Comment / Discussion on Task or Subtask
app.post('/api/tasks/:id/comments', authenticateToken, (req, res) => {
  try {
    const { text, targetType, subtaskId, subtaskTitle } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text cannot be empty' });
    }

    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (req.role !== 'admin') {
      const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (!ids.includes(req.user.id) && !ids.includes('all')) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
    }

    const result = WorkPulseDB.addTaskComment(req.params.id, {
      text,
      targetType,
      subtaskId,
      subtaskTitle,
      authorName: req.user.name || (req.role === 'admin' ? 'Administrator' : req.user.id),
      authorId: req.user.id || (req.role === 'admin' ? 'WP-ADMIN' : 'STAFF'),
      authorRole: req.role
    }, req.user);

    res.status(201).json({
      success: true,
      message: 'Comment added to discussion',
      data: result.comment,
      task: result.task
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Review Action Endpoint (Submit for Review, Approve, Request Changes)
app.post('/api/tasks/:id/review', authenticateToken, (req, res) => {
  try {
    const { action, feedback, rating } = req.body;
    if (!action) return res.status(400).json({ success: false, error: 'Action is required (submit_review, approve, request_changes)' });

    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    // Permissions:
    // Only Admin can approve or request changes. Staff can submit for review.
    if (action === 'approve' || action === 'request_changes') {
      if (req.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Forbidden: Only Administrator can approve or request changes' });
      }
    } else if (action === 'submit_review') {
      const ids = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (req.role !== 'admin' && !ids.includes(req.user.id) && !ids.includes('all')) {
        return res.status(403).json({ success: false, error: 'Forbidden: Cannot submit unassigned task for review' });
      }
    }

    const updatedTask = WorkPulseDB.reviewTask(req.params.id, { action, feedback, rating }, req.user);
    res.json({
      success: true,
      message: `Task review action "${action}" completed`,
      data: updatedTask
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Staff Deliverable Submission Endpoint
app.post('/api/tasks/:id/submissions', authenticateToken, (req, res) => {
  try {
    const db = WorkPulseDB.load();
    const task = (db.tasks || []).find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const taskStaffIds = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
    if (req.role !== 'admin') {
      if (!taskStaffIds.includes(req.user.id) && !taskStaffIds.includes('all') && task.assignedStaffId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: You can only submit deliverables for your own assigned tasks' });
      }
      if (req.body.staffId && req.body.staffId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: Cannot submit deliverable under another staff identity' });
      }
    }

    const { comment, comments, status, attachments, file } = req.body;
    let finalAttachments = Array.isArray(attachments) ? [...attachments] : [];
    if (file && typeof file === 'object') {
      finalAttachments.push(file);
    }

    const submissionData = {
      staffId: req.user.id,
      staffName: req.user.name || req.user.id,
      comment: (comment || comments || '').trim(),
      status: status || 'In Review',
      attachments: finalAttachments
    };

    const updatedTask = WorkPulseDB.submitTaskDeliverable(req.params.id, submissionData);
    if (!updatedTask) return res.status(400).json({ success: false, error: 'Failed to record task submission' });

    res.status(200).json({
      success: true,
      message: 'Task deliverable and progress update submitted successfully',
      data: updatedTask
    });
  } catch (err) {
    console.error('Task submission error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Review & Feedback for Task Deliverable
app.post('/api/tasks/:id/feedback', authenticateToken, requireAdmin, (req, res) => {
  try {
    const task = WorkPulseDB.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const { feedback, rating, submissionIndex } = req.body;
    if (!feedback || !feedback.trim()) {
      return res.status(400).json({ success: false, error: 'Feedback text is required' });
    }

    const updatedTask = WorkPulseDB.reviewTaskDeliverable(req.params.id, {
      feedback: feedback.trim(),
      rating: Number(rating) || 5,
      submissionIndex: typeof submissionIndex === 'number' ? submissionIndex : 0,
      reviewerName: req.user.name || 'Administrator'
    });

    res.json({
      success: true,
      message: 'Task deliverable review and feedback recorded successfully',
      data: updatedTask
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Task (Admin Only)
app.delete('/api/tasks/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = WorkPulseDB.deleteTask(req.params.id);
    if (!result) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Daily Project Reports & Performance Reviews
app.get('/api/reports', authenticateToken, (req, res) => {
  let { staffId, status, projectId } = req.query;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff reports' });
    }
    staffId = req.user.id;
  }
  const reports = WorkPulseDB.getDailyReports({ staffId, status, projectId });
  res.json({ success: true, count: reports.length, data: reports });
});

app.post('/api/reports', authenticateToken, (req, res) => {
  try {
    if (req.role !== 'admin') {
      if (req.body.staffId && req.body.staffId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: Cannot submit report on behalf of another staff member' });
      }
    }
    const payload = { ...req.body };
    if (req.role !== 'admin') payload.staffId = req.user.id;

    // Persist attached base64 file to disk uploads directory if provided
    if (payload.file && payload.file.dataBase64 && !payload.file.url) {
      const match = payload.file.dataBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const cleanName = (payload.file.name || 'report_file.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
        const storedFileName = `report_${Date.now()}_${cleanName}`;
        const diskPath = path.join(UPLOADS_DIR, storedFileName);
        fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
        payload.file.url = `/uploads/${storedFileName}`;
        delete payload.file.dataBase64;
      }
    }

    const report = WorkPulseDB.submitDailyReport(payload);
    if (!report) return res.status(400).json({ success: false, error: 'Failed to submit report' });
    res.status(201).json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reports/:id/review', authenticateToken, requireAdmin, (req, res) => {
  try {
    const updatedReport = WorkPulseDB.submitReportReview(req.params.id, req.body);
    if (!updatedReport) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({ success: true, message: 'Review recorded', data: updatedReport });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Corporate Meetings & Briefings
app.get('/api/meetings', authenticateToken, (req, res) => {
  let { staffId } = req.query;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff meetings' });
    }
    staffId = req.user.id;
  }
  const meetings = WorkPulseDB.getMeetings({ staffId });
  res.json({ success: true, count: meetings.length, data: meetings });
});

app.post('/api/meetings', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, date, time } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Meeting title is required.' });
    }
    if (!date || !time) {
      return res.status(400).json({ success: false, error: 'Meeting date and time are required.' });
    }

    const startMs = WorkPulseDB.parseMeetingDateTime(date, time);
    if (isNaN(startMs) || startMs < Date.now() - 60000) {
      return res.status(400).json({
        success: false,
        error: 'Please select a future date and time.'
      });
    }

    const meeting = WorkPulseDB.createMeeting(req.body);
    if (!meeting) return res.status(400).json({ success: false, error: 'Failed to create meeting' });
    res.status(201).json({ success: true, data: meeting });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'Failed to create meeting' });
  }
});

app.patch('/api/meetings/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = WorkPulseDB.updateMeeting(req.params.id, req.body);
    if (!result || !result.success) {
      return res.status(400).json(result || { success: false, error: 'Failed to update meeting' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/meetings/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = WorkPulseDB.deleteMeeting(req.params.id);
    if (!result) return res.status(404).json({ success: false, error: 'Meeting not found' });
    res.json({ success: true, message: 'Meeting cancelled and removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Notifications
app.get('/api/notifications', authenticateToken, (req, res) => {
  let { role = 'admin', staffId } = req.query;
  if (req.role !== 'admin') {
    if (staffId && staffId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot view other staff notifications' });
    }
    role = 'staff';
    staffId = req.user.id;
  }
  const notifs = WorkPulseDB.getNotifications(role, staffId);
  res.json({ success: true, count: notifs.length, data: notifs });
});

app.post('/api/notifications/:id/read', authenticateToken, (req, res) => {
  const db = WorkPulseDB.load();
  const notif = (db.notifications || []).find(n => n.id === req.params.id);
  if (!notif) return res.status(404).json({ success: false, error: 'Notification not found' });
  if (req.role !== 'admin' && notif.staffId && notif.staffId !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Forbidden: Cannot mark another staff notification as read' });
  }
  notif.read = true;
  WorkPulseDB.save(db);
  res.json({ success: true, message: 'Notification marked read' });
});

// Settings
app.get('/api/settings', authenticateToken, (req, res) => {
  const db = WorkPulseDB.load();
  res.json({ success: true, data: db.settings });
});

app.put('/api/settings', authenticateToken, requireAdmin, (req, res) => {
  const db = WorkPulseDB.load();
  const incoming = req.body || {};
  if (incoming.systemInactivityTimeoutMinutes) {
    const val = parseInt(incoming.systemInactivityTimeoutMinutes, 10);
    if (!isNaN(val) && val > 0) incoming.systemInactivityTimeoutMinutes = val;
  }
  if (incoming.tabInactivityTimeoutMinutes) {
    const val = parseInt(incoming.tabInactivityTimeoutMinutes, 10);
    if (!isNaN(val) && val > 0) incoming.tabInactivityTimeoutMinutes = val;
  }
  db.settings = { ...db.settings, ...incoming };
  WorkPulseDB.save(db);
  res.json({ success: true, message: 'Settings updated', data: db.settings });
});

// Database Management & Demo Data Cleanup (Admin Only)
app.post('/api/database/clear-demo', authenticateToken, requireAdmin, (req, res) => {
  try {
    const cleanDb = WorkPulseDB.clearDemoData();
    res.json({
      success: true,
      message: 'All demo attendance, activity timelines, leaves, tasks, notifications, reports, and meetings have been cleared. Staff accounts and settings preserved.',
      staffCount: cleanDb.staff.length,
      attendanceCount: cleanDb.attendance.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/database/reset', authenticateToken, requireAdmin, (req, res) => {
  try {
    const freshDb = WorkPulseDB.resetDatabase();
    res.json({
      success: true,
      message: 'Database reset to clean baseline (staff accounts & settings retained, demo data cleared).',
      staffCount: freshDb.staff.length,
      attendanceCount: freshDb.attendance.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 5. SERVER-LEVEL PAGE ROUTE GUARDS (ROLE-BASED AUTHORIZATION)
// -----------------------------------------------------------------------------

// Authoritative Server-Side Guard for Executive Admin Console
app.get(['/admin.html', '/admin'], (req, res) => {
  const token = extractToken(req);
  if (token) {
    const session = getSessionByToken(token);
    // Strict Role Check: Staff credentials must NEVER grant Admin access
    if (session && session.role !== 'admin') {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(403).json({ success: false, error: 'Forbidden: Staff credentials cannot access the Executive Admin Console' });
      }
      return res.status(403).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>403 Forbidden — Access Denied</title>
  <meta http-equiv="refresh" content="3;url=/staff.html?error=forbidden">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0A192F; color: #FFFFFF; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #112240; padding: 40px; border-radius: 12px; border: 1px solid #DC2626; max-width: 480px; box-shadow: 0 20px 40px rgba(220,38,38,0.2); }
    h1 { color: #EF4444; font-size: 1.5rem; margin-bottom: 12px; }
    p { color: #94A3B8; font-size: 0.95rem; line-height: 1.5; margin-bottom: 24px; }
    a { display: inline-block; background: #DC2626; color: #FFFFFF; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>403 — Forbidden: Access Denied</h1>
    <p>Staff members are strictly prohibited from accessing the Executive Administrator Console. This access attempt has been logged for security audit.</p>
    <a href="/staff.html">Return to Staff Portal</a>
  </div>
</body>
</html>`);
    }

    if (session && session.role === 'admin') {
      return res.sendFile(path.join(__dirname, 'admin.html'));
    }
  }

  // If request specifically expects JSON API response and has no valid token, return 401
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Administrator authentication session required' });
  }

  // For browser page navigation, serve admin.html which executes its immediate client-side token verification against localStorage and /api/sync.
  // If no valid admin token exists in localStorage, it immediately redirects to /index.html?error=admin_required.
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Authoritative Server-Side Guard for Staff Portal
app.get(['/staff.html', '/staff'], (req, res) => {
  const token = extractToken(req);
  if (token) {
    const session = getSessionByToken(token);
    if (session && session.role === 'admin') {
      return res.status(403).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>403 Forbidden — Access Denied</title>
  <meta http-equiv="refresh" content="3;url=/admin.html">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0A192F; color: #FFFFFF; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #112240; padding: 40px; border-radius: 12px; border: 1px solid #DC2626; max-width: 480px; }
    h1 { color: #EF4444; font-size: 1.5rem; margin-bottom: 12px; }
    p { color: #94A3B8; font-size: 0.95rem; margin-bottom: 24px; }
    a { display: inline-block; background: #DC2626; color: #FFFFFF; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>403 — Forbidden</h1>
    <p>Please use the Executive Admin Console.</p>
    <a href="/admin.html">Go to Admin Console</a>
  </div>
</body>
</html>`);
    }

    if (session && session.role === 'staff') {
      return res.sendFile(path.join(__dirname, 'staff.html'));
    }
  }

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
  }

  res.sendFile(path.join(__dirname, 'staff.html'));
});

// -----------------------------------------------------------------------------
// 5. MISCELLANEOUS MODULE REST APIS
// -----------------------------------------------------------------------------

// Summary KPI metrics
app.get('/api/misc/summary', authenticateToken, (req, res) => {
  try {
    const staffId = req.role === 'staff' ? req.user.id : null;
    const summary = WorkPulseDB.getMiscSummary(staffId);
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- General Requests (Supports both /api/misc/requests and /api/requests) ---
app.get(['/api/misc/requests', '/api/requests'], authenticateToken, (req, res) => {
  try {
    const filters = { ...req.query };
    if (req.role === 'staff') {
      filters.staffId = req.user.id;
    }
    const requests = WorkPulseDB.getGeneralRequests(filters);
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/misc/requests', '/api/requests'], authenticateToken, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.title.trim()) {
      return res.status(400).json({ success: false, error: 'Request title is required' });
    }
    if (!body.description || !body.description.trim()) {
      return res.status(400).json({ success: false, error: 'Details / Business need is required' });
    }

    const staffId = req.user?.id || (body.staffId || 'WP-STAFF');
    const staffName = req.user?.name || (body.staffName || 'Staff Member');

    if (req.role === 'staff') {
      body.requestedById = staffId;
      body.requestedByName = staffName;
      body.staffId = staffId;
      body.staffName = staffName;
    } else {
      body.requestedById = body.requestedById || staffId;
      body.requestedByName = body.requestedByName || staffName;
      body.staffId = body.staffId || staffId;
      body.staffName = body.staffName || staffName;
    }

    // Explicitly set initial status to 'Pending'
    body.status = 'Pending';

    // Duplicate submission prevention: check for existing pending request from same staff with same title & category
    const db = WorkPulseDB.load();
    const existingPending = (db.generalRequests || []).find(r =>
      r && r.status === 'Pending' &&
      (String(r.requestedById || '').trim().toUpperCase() === String(body.requestedById).trim().toUpperCase() ||
        String(r.staffId || '').trim().toUpperCase() === String(body.staffId).trim().toUpperCase()) &&
      (r.title || '').trim().toLowerCase() === body.title.trim().toLowerCase() &&
      (r.category || '').trim().toLowerCase() === (body.category || 'it equipment').trim().toLowerCase()
    );

    if (existingPending) {
      return res.status(409).json({
        success: false,
        error: 'A pending request with this title and category has already been submitted.',
        data: existingPending
      });
    }

    const newReq = WorkPulseDB.addGeneralRequest(body, req.user);
    res.status(201).json({ success: true, data: newReq });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put(['/api/misc/requests/:id', '/api/requests/:id'], authenticateToken, (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    if (req.role === 'staff') {
      const existing = (WorkPulseDB.load().generalRequests || []).find(r => r.id === id);
      if (!existing || (existing.requestedById !== req.user.id && existing.staffId !== req.user.id)) {
        return res.status(403).json({ success: false, error: 'Forbidden: You can only edit your own requests' });
      }
      if (existing.status !== 'Pending') {
        return res.status(400).json({ success: false, error: 'Cannot edit request once reviewed by administration' });
      }
      delete body.status;
    }
    const updated = WorkPulseDB.updateGeneralRequest(id, body, req.user);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch(['/api/misc/requests/:id', '/api/requests/:id'], authenticateToken, (req, res) => {
  try {
    const id = req.params.id;
    const { status, adminComment, comment, reason } = req.body || {};
    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required' });
    }
    if (req.role === 'staff') {
      return res.status(403).json({ success: false, error: 'Forbidden: Staff cannot approve or reject requests' });
    }

    const noteText = adminComment || comment || reason || '';
    const updateData = { status };
    if (noteText) {
      updateData.adminComment = noteText;
    }

    const updated = WorkPulseDB.updateGeneralRequest(id, updateData, req.user);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    if (noteText) {
      const authorName = (req.user && req.user.name) ? req.user.name : 'Administrator';
      WorkPulseDB.addGeneralRequestComment(id, noteText, authorName);
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete(['/api/misc/requests/:id', '/api/requests/:id'], authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteGeneralRequest(req.params.id, req.user);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    res.json({ success: true, message: 'Request deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/misc/requests/:id/comments', '/api/requests/:id/comments'], authenticateToken, (req, res) => {
  try {
    const text = req.body && (req.body.text || req.body.comment);
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }
    const authorName = (req.user && req.user.name) ? req.user.name : (req.role === 'admin' ? 'Administrator' : 'Staff Member');
    const comment = WorkPulseDB.addGeneralRequestComment(req.params.id, text.trim(), authorName);
    if (!comment) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Office Assets & Inventory ---
app.get('/api/misc/assets', authenticateToken, (req, res) => {
  try {
    const filters = { ...req.query };
    if (req.role === 'staff') {
      filters.staffId = req.user.id;
    }
    const assets = WorkPulseDB.getOfficeAssets(filters);
    res.json({ success: true, data: assets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/misc/assets', authenticateToken, requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.title.trim()) {
      return res.status(400).json({ success: false, error: 'Asset title is required' });
    }
    const newAsset = WorkPulseDB.addOfficeAsset(body, req.user);
    res.status(201).json({ success: true, data: newAsset });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/misc/assets/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const updated = WorkPulseDB.updateOfficeAsset(req.params.id, req.body || {}, req.user);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/misc/assets/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteOfficeAsset(req.params.id, req.user);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    res.json({ success: true, message: 'Asset deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/misc/assets/:id/comments', authenticateToken, (req, res) => {
  try {
    const text = req.body && req.body.text;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }
    const comment = WorkPulseDB.addOfficeAssetComment(req.params.id, text, req.user);
    if (!comment) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Office Maintenance ---
app.get('/api/misc/maintenance', authenticateToken, (req, res) => {
  try {
    const filters = { ...req.query };
    if (req.role === 'staff') {
      filters.staffId = req.user.id;
    }
    const issues = WorkPulseDB.getMaintenanceIssues(filters);
    res.json({ success: true, data: issues });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/misc/maintenance', authenticateToken, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.title.trim()) {
      return res.status(400).json({ success: false, error: 'Issue title is required' });
    }
    if (req.role === 'staff') {
      body.reportedById = req.user.id;
      body.reportedByName = req.user.name;
    }
    const newIssue = WorkPulseDB.addMaintenanceIssue(body, req.user);
    res.status(201).json({ success: true, data: newIssue });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/misc/maintenance/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const updated = WorkPulseDB.updateMaintenanceIssue(req.params.id, req.body || {}, req.user);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Maintenance issue not found' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/misc/maintenance/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteMaintenanceIssue(req.params.id, req.user);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Maintenance issue not found' });
    }
    res.json({ success: true, message: 'Maintenance issue deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/misc/maintenance/:id/comments', authenticateToken, (req, res) => {
  try {
    const text = req.body && req.body.text;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }
    const comment = WorkPulseDB.addMaintenanceComment(req.params.id, text, req.user);
    if (!comment) {
      return res.status(404).json({ success: false, error: 'Maintenance issue not found' });
    }
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Internal Notes & Reminders ---
app.get('/api/misc/notes', authenticateToken, (req, res) => {
  try {
    const filters = { ...req.query };
    if (req.role === 'staff') {
      filters.staffId = req.user.id;
    }
    const notes = WorkPulseDB.getInternalNotes(filters);
    res.json({ success: true, data: notes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/misc/notes', authenticateToken, requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.title.trim()) {
      return res.status(400).json({ success: false, error: 'Note title is required' });
    }
    const newNote = WorkPulseDB.addInternalNote(body, req.user);
    res.status(201).json({ success: true, data: newNote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/misc/notes/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const updated = WorkPulseDB.updateInternalNote(req.params.id, req.body || {}, req.user);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/misc/notes/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteInternalNote(req.params.id, req.user);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }
    res.json({ success: true, message: 'Note deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/misc/notes/:id/comments', authenticateToken, (req, res) => {
  try {
    const text = req.body && req.body.text;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }
    const comment = WorkPulseDB.addInternalNoteComment(req.params.id, text, req.user);
    if (!comment) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- General Documents ---
app.get('/api/misc/documents', authenticateToken, (req, res) => {
  try {
    const filters = { ...req.query };
    if (req.role === 'staff') {
      filters.staffId = req.user.id;
    }
    const docs = WorkPulseDB.getGeneralDocuments(filters);
    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/misc/documents', authenticateToken, requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.title.trim()) {
      return res.status(400).json({ success: false, error: 'Document title is required' });
    }

    // If Base64 file attached, save to /uploads/ disk
    if (body.fileData && body.fileData.startsWith('data:')) {
      const match = body.fileData.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const cleanName = (body.fileName || 'office_doc.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
        const diskName = `doc_${Date.now()}_${cleanName}`;
        const diskPath = path.join(UPLOADS_DIR, diskName);
        fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
        body.fileUrl = `/uploads/${diskName}`;
        delete body.fileData;
      }
    }

    const newDoc = WorkPulseDB.addGeneralDocument(body, req.user);
    res.status(201).json({ success: true, data: newDoc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/misc/documents/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (body.fileData && body.fileData.startsWith('data:')) {
      const match = body.fileData.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const cleanName = (body.fileName || 'office_doc.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
        const diskName = `doc_${Date.now()}_${cleanName}`;
        const diskPath = path.join(UPLOADS_DIR, diskName);
        fs.writeFileSync(diskPath, Buffer.from(match[2], 'base64'));
        body.fileUrl = `/uploads/${diskName}`;
        delete body.fileData;
      }
    }

    const updated = WorkPulseDB.updateGeneralDocument(req.params.id, body, req.user);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/misc/documents/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const success = WorkPulseDB.deleteGeneralDocument(req.params.id, req.user);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/misc/documents/:id/comments', authenticateToken, (req, res) => {
  try {
    const text = req.body && req.body.text;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }
    const comment = WorkPulseDB.addGeneralDocumentComment(req.params.id, text, req.user);
    if (!comment) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 6. STATIC ASSET SERVING WITH CACHE CONTROL
// -----------------------------------------------------------------------------
app.use(express.static(path.join(__dirname), {
  etag: true,
  lastModified: true,
  maxAge: '0'
}));

// Route root and login to index.html
app.get(['/', '/index.html', '/login'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 Handler for undefined API routes
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `API route ${req.method} ${req.originalUrl} not found` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[WorkPulse Server Error]', err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// -----------------------------------------------------------------------------
// 6. SERVER INITIALIZATION & LISTENER (HTTP & SECURE HTTPS FOR MOBILE GPS)
// -----------------------------------------------------------------------------
const https = require('https');
const os = require('os');
let selfsigned = null;
try {
  selfsigned = require('selfsigned');
} catch (e) { }

const HTTPS_PORT = process.env.HTTPS_PORT || 8443;
const SSL_DIR = path.join(DATA_DIR, 'ssl');
const CERT_FILE = path.join(SSL_DIR, 'cert.pem');
const KEY_FILE = path.join(SSL_DIR, 'key.pem');

async function getOrCreateSSLCert() {
  try {
    if (!fs.existsSync(SSL_DIR)) {
      fs.mkdirSync(SSL_DIR, { recursive: true });
    }

    if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
      const cert = fs.readFileSync(CERT_FILE, 'utf8');
      const key = fs.readFileSync(KEY_FILE, 'utf8');
      if (cert && key && cert.includes('BEGIN CERTIFICATE')) {
        return { cert, key };
      }
    }

    if (!selfsigned) {
      console.warn('[HTTPS Setup] selfsigned module not available, skipping auto-generation');
      return null;
    }

    const ifaces = os.networkInterfaces();
    const altNames = [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' }
    ];

    for (const dev in ifaces) {
      for (const details of ifaces[dev]) {
        if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
          altNames.push({ type: 7, ip: details.address });
          altNames.push({ type: 2, value: details.address });
        }
      }
    }

    const pems = await selfsigned.generate([
      { name: 'commonName', value: 'WorkPulse Mobile GPS Attendance' }
    ], {
      days: 365,
      extensions: [{ name: 'subjectAltName', altNames }]
    });

    fs.writeFileSync(CERT_FILE, pems.cert, 'utf8');
    fs.writeFileSync(KEY_FILE, pems.private, 'utf8');
    return { cert: pems.cert, key: pems.private };
  } catch (err) {
    console.error('[HTTPS Setup] Error generating SSL cert:', err.message);
    return null;
  }
}

let httpsServer = null;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(`WORKPULSE ENTERPRISE BACKEND SERVER ACTIVE`);
  console.log(`Primary Localhost:     http://localhost:${PORT}`);
  console.log(`New / Alternative:     http://localhost:8080`);
  console.log(`Network LAN Access:    http://192.168.1.12:${PORT}`);
  console.log(`REST API Health:       http://localhost:${PORT}/api/health`);
  console.log(`Database Path:         ${DB_FILE}`);
  console.log(`Sessions Path:         ${SESSIONS_FILE}`);
  console.log('================================================================');
});

// Also bind secondary port 8080 so users can access a completely fresh localhost
let altServer = null;
if (PORT !== 8080) {
  try {
    altServer = app.listen(8080, '0.0.0.0', () => {
      console.log(`[WorkPulse] Additional fresh localhost active: http://localhost:8080`);
    });
    altServer.on('error', (err) => {
      console.log(`[WorkPulse] Port 8080 notice:`, err.message);
    });
  } catch (e) { }
}

// Start Secure HTTPS listener on port 8443 for Mobile Android / iOS GPS Access
(async () => {
  try {
    const ssl = await getOrCreateSSLCert();
    if (ssl && ssl.cert && ssl.key) {
      httpsServer = https.createServer({ key: ssl.key, cert: ssl.cert }, app);
      httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log('----------------------------------------------------------------');
        console.log(`SECURE HTTPS SERVER ACTIVE (REQUIRED FOR MOBILE GPS):`);
        console.log(`Local HTTPS:           https://localhost:${HTTPS_PORT}`);
        console.log(`Mobile Device HTTPS:   https://192.168.1.12:${HTTPS_PORT}`);
        console.log('----------------------------------------------------------------');
      });
      httpsServer.on('error', (err) => {
        console.log(`[HTTPS Server] Port ${HTTPS_PORT} notice:`, err.message);
      });
    }
  } catch (e) {
    console.error('[HTTPS Server] Startup error:', e.message);
  }
})();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\nShutting down WorkPulse server...');
  if (httpsServer) httpsServer.close();
  if (altServer) altServer.close();
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  if (httpsServer) httpsServer.close();
  if (altServer) altServer.close();
  server.close(() => process.exit(0));
});
