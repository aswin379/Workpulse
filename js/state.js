/**
 * WORKPULSE — CENTRALIZED PERSISTENT STATE & BUSINESS ENGINE (js/state.js)
 * Manages localStorage persistence, attendance calculations, Sunday weekly offs,
 * manual staff checkout, leave/WFH synchronization, and Excel import validation.
 */

const WP_STORAGE_KEY = 'workpulse_db_v2';
const WP_SESSION_KEY = 'workpulse_session_v2';

// --------------------------------------------------------------------------
// 1. DEFAULT SEED DATABASE
// --------------------------------------------------------------------------
const INITIAL_STAFF = [];

// Known legacy demo/test staff created during development or sample batches
const DEMO_STAFF_EMAILS = [
  'marcus.sterling@workpulse.com',
  'sarah.jenkins@workpulse.com',
  'elena.rostova@workpulse.com',
  'david.chen@workpulse.com',
  'tariq.mansoor@workpulse.com',
  'rachel.green@workpulse.com',
  'liam.scott@workpulse.com',
  'amina.nour@workpulse.com',
  'carlos.gomez@workpulse.com',
  'carlos.mendez@workpulse.com',
  'sophia.wu@workpulse.com',
  'priya.sharma@workpulse.com',
  'alexander.vance@workpulse.com',
  'camila.rodriguez@workpulse.com',
  'ethan.bailey@workpulse.com',
  'zara.khan@workpulse.com',
  'lucas.wright@workpulse.com',
  'lm@gmail.com'
];

const DEMO_STAFF_NAMES = [
  'Marcus Sterling',
  'Sarah Jenkins',
  'Elena Rostova',
  'David Chen',
  'Tariq Al-Mansoor',
  'Rachel Green',
  'Liam Scott',
  'Amina Nour',
  'Carlos Gomez',
  'Carlos Mendez',
  'Sophia Wu',
  'Priya Sharma',
  'Alexander Vance',
  'Camila Rodriguez',
  'Ethan Bailey',
  'Zara Khan',
  'Lucas Wright',
  'Lionel Messi'
];

function isDemoRecord(record) {
  if (!record) return false;
  if (record._genuine) return false; // Staff registered through the portal are never scrubbed
  const id = (record.id || record.staffId || '').trim();
  if (id === 'WP-ADMIN' || record.role === 'Admin' || record.role === 'admin') return false;

  const email = (record.email || '').toLowerCase().trim();
  const name = (record.name || record.staffName || '').trim().toLowerCase();
  
  if (DEMO_STAFF_EMAILS.some(e => e.toLowerCase() === email)) return true;
  if (DEMO_STAFF_NAMES.some(n => n.toLowerCase() === name)) return true;
  return false;
}
if (typeof global !== 'undefined') global.isDemoRecord = isDemoRecord;
if (typeof window !== 'undefined') window.isDemoRecord = isDemoRecord;

function generateMonthAttendance(staffList, year, month) {
  return [];
}

function generateSeptemberAttendance(staffList) {
  return [];
}

// --------------------------------------------------------------------------
// 2. INITIAL DATABASE SEED FACTORY
// --------------------------------------------------------------------------
function getInitialDatabase() {
  const staff = INITIAL_STAFF;
  const attendance = [];
  const leaves = [];
  const wfhRequests = [];

  const settings = {
    officeName: 'WorkPulse Global Headquarters',
    officeAddress: '500 Howard Street, Suite 1200, San Francisco, CA 94105',
    latitude: 37.7749,
    longitude: -122.4194,
    geofenceRadiusMeters: 150,
    checkInStartTime: '09:00 AM',
    checkoutRule: 'Manual Staff Checkout',
    requireLocationPermission: true,
    sundayWeeklyOff: true,
    systemInactivityTimeoutMinutes: 15,
    tabInactivityTimeoutMinutes: 60
  };

  const notifications = [];
  const projects = [];
  const tasks = [];
  const dailyReports = [];
  const meetings = [];

  const admin = {
    id: 'WP-ADMIN',
    name: 'Sarah Montgomery',
    email: 'admin@workpulse.com',
    position: 'Executive Director',
    role: 'Admin',
    photo: null
  };

  return {
    admin,
    staff,
    attendance,
    leaves,
    wfhRequests,
    settings,
    notifications,
    projects,
    tasks,
    dailyReports,
    meetings,
    clients: [],
    leads: [],
    generalRequests: [],
    officeAssets: [],
    maintenanceIssues: [],
    internalNotes: [],
    generalDocuments: []
  };
}

// --------------------------------------------------------------------------
// 3. STORAGE REPOSITORY
// --------------------------------------------------------------------------
const WorkPulseDB = {
  load() {
    try {
      const data = localStorage.getItem(WP_STORAGE_KEY);
      if (!data) {
        const initial = getInitialDatabase();
        try { localStorage.setItem(WP_STORAGE_KEY, JSON.stringify(initial)); } catch (e) {}
        return initial;
      }
      let db = JSON.parse(data);
      if (db && typeof db.workpulse_db_v2 === 'string') {
        try { db = JSON.parse(db.workpulse_db_v2); } catch (e) {}
      } else if (db && db.workpulse_db_v2 && typeof db.workpulse_db_v2 === 'object') {
        db = db.workpulse_db_v2;
      }
      if (db && Array.isArray(db.staff)) {
        let changed = false;

        // Ensure Admin Profile exists
        if (!db.admin || typeof db.admin !== 'object') {
          db.admin = {
            id: 'WP-ADMIN',
            name: 'Sarah Montgomery',
            email: 'admin@workpulse.com',
            password: 'admin123',
            position: 'Executive Director',
            role: 'Admin',
            photo: null
          };
          changed = true;
        }

        // Scrub all legacy demo/test staff from database & localStorage
        const demoStaffIds = new Set();
        const scrubbedStaff = [];
        db.staff.forEach(s => {
          if (isDemoRecord(s)) {
            demoStaffIds.add(s.id);
            changed = true;
          } else {
            scrubbedStaff.push(s);
          }
        });

        if (changed) {
          db.staff = scrubbedStaff;
          if (Array.isArray(db.attendance)) {
            db.attendance = db.attendance.filter(a => !demoStaffIds.has(a.staffId) && !isDemoRecord(a));
          }
          if (Array.isArray(db.leaves)) {
            db.leaves = db.leaves.filter(l => !demoStaffIds.has(l.staffId) && !isDemoRecord(l));
          }
          if (Array.isArray(db.wfhRequests)) {
            db.wfhRequests = db.wfhRequests.filter(w => !demoStaffIds.has(w.staffId) && !isDemoRecord(w));
          }
          if (Array.isArray(db.tasks)) {
            db.tasks = db.tasks.filter(t => !demoStaffIds.has(t.assignedStaffId));
          }
          if (Array.isArray(db.dailyReports)) {
            db.dailyReports = db.dailyReports.filter(r => !demoStaffIds.has(r.staffId) && !isDemoRecord(r));
          }
          if (Array.isArray(db.notifications)) {
            db.notifications = db.notifications.filter(n => !demoStaffIds.has(n.staffId));
          }
          if (Array.isArray(db.meetings)) {
            db.meetings.forEach(m => {
              if (Array.isArray(m.attendeeIds)) {
                m.attendeeIds = m.attendeeIds.filter(id => !demoStaffIds.has(id));
              }
              if (Array.isArray(m.attendeeStaffIds)) {
                m.attendeeStaffIds = m.attendeeStaffIds.filter(id => !demoStaffIds.has(id));
              }
            });
          }
        }

        // Ensure collections are valid arrays without injecting demo data
        if (!Array.isArray(db.projects)) { db.projects = []; changed = true; }
        if (!Array.isArray(db.tasks)) { db.tasks = []; changed = true; }
        else {
          // De-duplicate any existing tasks created redundantly
          const dedupedTasks = [];
          const seen = [];
          db.tasks.forEach(t => {
            if (!t) return;
            const tTitle = (t.title || '').trim().toLowerCase();
            const tProj = t.projectId || '';
            const tTime = new Date(t.createdAt || 0).getTime() || parseInt((t.id || '').split('-')[1] || '0', 10);

            const match = seen.find(s => {
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
              seen.push(t);
              dedupedTasks.push(t);
            } else {
              // Preserve subtasks and comments into the retained task
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
              changed = true;
            }
          });

          if (dedupedTasks.length !== db.tasks.length) {
            db.tasks = dedupedTasks;
            changed = true;
          }

          db.tasks.forEach(t => {
            if (!t.assignedStaffId || t.assignedStaffId === 'undefined') {
              t.assignedStaffId = 'all';
              t.assignedStaffName = 'All Staff Members';
              changed = true;
            }
            if (!Array.isArray(t.assignedStaffIds)) {
              t.assignedStaffIds = t.assignedStaffId ? [t.assignedStaffId] : ['all'];
              changed = true;
            }
            if (!Array.isArray(t.subtasks)) { t.subtasks = []; changed = true; }
            if (!Array.isArray(t.comments)) { t.comments = []; changed = true; }
            if (!Array.isArray(t.activity)) { t.activity = []; changed = true; }
          });
        }
        if (!Array.isArray(db.dailyReports)) { db.dailyReports = []; changed = true; }
        if (!Array.isArray(db.meetings)) { db.meetings = []; changed = true; }
        if (!Array.isArray(db.attendance)) { db.attendance = []; changed = true; }
        if (!Array.isArray(db.leaves)) { db.leaves = []; changed = true; }
        if (!Array.isArray(db.wfhRequests)) { db.wfhRequests = []; changed = true; }
        if (!Array.isArray(db.notifications)) { db.notifications = []; changed = true; }
        if (!Array.isArray(db.clients)) { db.clients = []; changed = true; }
        if (!Array.isArray(db.leads)) { db.leads = []; changed = true; }
        if (!Array.isArray(db.domains)) { db.domains = []; changed = true; }
        else {
          // Ensure every domain is linked to both a Client and a specific Project
          db.domains.forEach(d => {
            if (!d.clientId || !d.projectId) {
              if (d.clientId) {
                const cl = (db.clients || []).find(c => c.id === d.clientId);
                if (cl && Array.isArray(cl.projects) && cl.projects.length > 0 && !d.projectId) {
                  d.projectId = cl.projects[0].id;
                  d.projectName = cl.projects[0].name || cl.projects[0].projectName || '';
                  d.clientName = cl.name + (cl.company ? ` (${cl.company})` : '');
                  changed = true;
                }
              } else {
                const wpCl = (db.clients || []).find(c => c.id === 'CLI-WP-INTERNAL' || c.name === 'WorkPulse Internal') || (db.clients && db.clients[0]);
                if (wpCl && Array.isArray(wpCl.projects) && wpCl.projects.length > 0) {
                  d.clientId = wpCl.id;
                  d.clientName = wpCl.name + (wpCl.company ? ` (${wpCl.company})` : '');
                  d.projectId = wpCl.projects[0].id;
                  d.projectName = wpCl.projects[0].name || wpCl.projects[0].projectName || '';
                  d.ownerType = 'client';
                  changed = true;
                }
              }
            }
          });
        }
        if (!Array.isArray(db.generalRequests)) { db.generalRequests = []; changed = true; }
        if (!Array.isArray(db.officeAssets)) { db.officeAssets = []; changed = true; }
        if (!Array.isArray(db.maintenanceIssues)) { db.maintenanceIssues = []; changed = true; }
        if (!Array.isArray(db.internalNotes)) { db.internalNotes = []; changed = true; }
        if (!Array.isArray(db.generalDocuments)) { db.generalDocuments = []; changed = true; }
        if (!db.settings || typeof db.settings !== 'object') {
          db.settings = getInitialDatabase().settings;
          changed = true;
        } else {
          if (typeof db.settings.systemInactivityTimeoutMinutes !== 'number' || db.settings.systemInactivityTimeoutMinutes <= 0) {
            db.settings.systemInactivityTimeoutMinutes = 15;
            changed = true;
          }
          if (typeof db.settings.tabInactivityTimeoutMinutes !== 'number' || db.settings.tabInactivityTimeoutMinutes <= 0) {
            db.settings.tabInactivityTimeoutMinutes = 60;
            changed = true;
          }
        }
        if (changed) this.save(db, true);
      }
      return db;
    } catch (e) {
      console.warn('Error loading WorkPulseDB:', e);
      const initial = getInitialDatabase();
      try { localStorage.setItem(WP_STORAGE_KEY, JSON.stringify(initial)); } catch (err) {}
      return initial;
    }
  },

  save(db, skipSync = false) {
    try {
      if (typeof document !== 'undefined' && db && typeof db === 'object') {
        if (db.admin && db.admin.password) delete db.admin.password;
        if (db.admin && db.admin.passwordHash) delete db.admin.passwordHash;
        if (Array.isArray(db.staff)) {
          db.staff.forEach(s => {
            if (s) {
              delete s.password;
              delete s.passwordHash;
            }
          });
        }
      }
      localStorage.setItem(WP_STORAGE_KEY, JSON.stringify(db));
      // Asynchronous backend synchronization if running in browser with Admin privileges
      if (!skipSync && typeof document !== 'undefined' && typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
        const sess = this.getSession();
        if (sess && sess.role === 'admin') {
          fetch('/api/sync', {
            method: 'POST',
            headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(db)
          }).catch(() => {
            // Silent offline fallback
          });
        }
      }
    } catch (e) {
      console.error('Storage save error:', e);
    }
  },

  /**
   * Helper to retrieve stored cryptographic session token
   */
  getSessionToken(preferredRole = null) {
    try {
      if (typeof localStorage !== 'undefined') {
        const sessStr = localStorage.getItem(WP_SESSION_KEY);
        let sess = null;
        if (sessStr) {
          try { sess = JSON.parse(sessStr); } catch (_) {}
        }

        const isAdminContext = preferredRole === 'admin' || (typeof window !== 'undefined' && (
          (window.location && (window.location.pathname.includes('admin') || (window.location.hash && window.location.hash.includes('domain')))) ||
          document.body?.classList.contains('admin-body') ||
          document.getElementById('admin-app') ||
          (sess && ((sess.role && String(sess.role).toLowerCase() === 'admin') || (sess.user && String(sess.user.role).toLowerCase() === 'admin')))
        ));

        if (isAdminContext) {
          const adminTok = localStorage.getItem('workpulse_admin_token') || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('workpulse_admin_token'));
          if (adminTok && adminTok.startsWith('wp-admin')) return adminTok;
          if (sess && ((sess.role && String(sess.role).toLowerCase() === 'admin') || String(sess.user?.role).toLowerCase() === 'admin' || sess.token?.startsWith('wp-admin'))) {
            return sess.token;
          }
        }

        const isStaffContext = preferredRole === 'staff' || (typeof window !== 'undefined' && (
          (window.location && window.location.pathname.includes('staff')) ||
          document.body?.classList.contains('staff-page-body') ||
          document.getElementById('staff-app-layout')
        ));

        if (isStaffContext) {
          const staffTok = localStorage.getItem('workpulse_staff_token') || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('workpulse_staff_token'));
          if (staffTok && staffTok.startsWith('wp-staff')) return staffTok;
          if (sess && ((sess.role && String(sess.role).toLowerCase() === 'staff') || sess.token?.startsWith('wp-staff'))) {
            return sess.token;
          }
        }

        if (sess && sess.token) return sess.token;

        const tok = localStorage.getItem('workpulse_session_token');
        if (tok) return tok;
      }
      if (typeof document !== 'undefined' && document.cookie) {
        if (preferredRole === 'admin') {
          const admMatch = document.cookie.match(/(?:^|;\s*)wp_admin_session=([^;]+)/);
          if (admMatch) return decodeURIComponent(admMatch[1]);
        }
        const match = document.cookie.match(/(?:^|;\s*)wp_session=([^;]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
    } catch (e) {}
    return '';
  },

  /**
   * Alias for getSessionToken
   */
  getToken() {
    return this.getSessionToken();
  },

  /**
   * Returns today's date formatted as YYYY-MM-DD in user's local timezone
   */
  getTodayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  /**
   * Helper to persist cryptographic session token
   */
  setSessionToken(token) {
    try {
      if (typeof localStorage !== 'undefined') {
        if (token) localStorage.setItem('workpulse_session_token', token);
        else localStorage.removeItem('workpulse_session_token');
      }
      if (typeof document !== 'undefined') {
        if (token) {
          document.cookie = `wp_session=${encodeURIComponent(token)}; path=/; max-age=86400; SameSite=Lax`;
        } else {
          document.cookie = 'wp_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        }
      }
    } catch (e) {}
  },

  /**
   * Generates authorization headers with Bearer token for all protected API requests
   */
  getAuthHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extra
    };
    const token = this.getSessionToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Session-Token'] = token;
    }
    return headers;
  },

  /**
   * Hydrates local state from backend server database if available.
   * Returns a Promise resolving to the authoritative database state.
   */
  initServerSync(callback) {
    if (typeof window !== 'undefined' && typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
      const token = this.getSessionToken();
      const pathname = window.location.pathname || '';
      const isLoginPage = pathname === '/' || pathname.endsWith('index.html') || pathname.endsWith('login');
      if (!token && isLoginPage) {
        return Promise.resolve(null);
      }
      const origin = (window.location && window.location.origin && window.location.origin !== 'null') 
        ? window.location.origin 
        : (window.location && window.location.host ? `${window.location.protocol || 'http:'}//${window.location.host}` : '');
      const syncUrl = origin ? `${origin}/api/sync` : '/api/sync';
      if (!origin && typeof process !== 'undefined' && (!window.location || !window.location.host)) {
        return Promise.resolve(null);
      }
      return fetch(syncUrl, {
        headers: this.getAuthHeaders(),
        credentials: 'include'
      })
        .then(res => {
          if (res.status === 401 || res.status === 403) {
            const pathname = window.location.pathname || '';
            if (pathname.includes('admin.html')) {
              window.location.replace('index.html?error=admin_required');
            } else if (pathname.includes('staff.html')) {
              window.location.replace('index.html?error=staff_required');
            }
            return null;
          }
          return res.json();
        })
        .then(json => {
          if (json && json.success && json.data) {
            try {
              if (json.onlineStaff || json.data.onlineStaff) {
                json.data.onlineStaff = json.onlineStaff || json.data.onlineStaff;
                WorkPulseDB._onlineStaffMap = json.data.onlineStaff;
              }
              if (Array.isArray(json.data.staff)) {
                json.data.staff = json.data.staff.filter(s => !isDemoRecord(s));
              }
              localStorage.setItem(WP_STORAGE_KEY, JSON.stringify(json.data));
              if (typeof callback === 'function') callback(json.data);
              return json.data;
            } catch (e) {}
          }
          return json ? json.data : null;
        })
        .catch(err => {
          console.warn('Backend sync unreachable, using local cache:', err);
          return null;
        });
    }
    return Promise.resolve(null);
  },

  /**
   * Continuous background synchronization across multiple devices/tabs
   */
  startAutoSync(intervalMs = 4000, onUpdate) {
    if (typeof window === 'undefined' || typeof fetch !== 'function' || !window.location || !window.location.protocol.startsWith('http')) {
      return null;
    }
    const token = this.getSessionToken();
    const pathname = window.location.pathname || '';
    const isLoginPage = pathname === '/' || pathname.endsWith('index.html') || pathname.endsWith('login');
    if (!token && isLoginPage) {
      return null;
    }
    if (window._wpAutoSyncInterval) {
      clearInterval(window._wpAutoSyncInterval);
    }

    const getComparableString = (data) => {
      if (!data || typeof data !== 'object') return '';
      try {
        const clone = { ...data };
        if (clone.onlineStaff && typeof clone.onlineStaff === 'object') {
          const simplifiedOnline = {};
          for (const k of Object.keys(clone.onlineStaff)) {
            if (clone.onlineStaff[k]) {
              simplifiedOnline[k] = { isOnline: !!clone.onlineStaff[k].isOnline };
            }
          }
          clone.onlineStaff = simplifiedOnline;
        }
        return JSON.stringify(clone);
      } catch (e) {
        return JSON.stringify(data);
      }
    };

    let lastDataString = localStorage.getItem(WP_STORAGE_KEY) || '';
    let lastComparableString = getComparableString(this.load());

    window._wpAutoSyncInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/sync', {
          headers: this.getAuthHeaders(),
          credentials: 'include'
        });
        if (res.status === 401 || res.status === 403) {
          const pathname = window.location.pathname || '';
          if (pathname.includes('admin.html') || pathname.includes('staff.html')) {
            window.location.replace('index.html?error=auth_required');
          }
          return;
        }
        if (!res.ok) return;
        const json = await res.json();
        if (json && json.success && json.data) {
          if (json.onlineStaff || json.data.onlineStaff) {
            json.data.onlineStaff = json.onlineStaff || json.data.onlineStaff;
            WorkPulseDB._onlineStaffMap = json.data.onlineStaff;
          }
          if (Array.isArray(json.data.staff)) {
            json.data.staff = json.data.staff.filter(s => !isDemoRecord(s));
          }
          const newComparableString = getComparableString(json.data);
          if (newComparableString !== lastComparableString) {
            lastComparableString = newComparableString;
            lastDataString = JSON.stringify(json.data);
            localStorage.setItem(WP_STORAGE_KEY, lastDataString);
            if (typeof onUpdate === 'function') {
              onUpdate(json.data);
            }
          }
        }
      } catch (e) {
        // Quiet network check
      }
    }, intervalMs);

    return window._wpAutoSyncInterval;
  },

  /**
   * Push full local state to server to keep disk in sync
   */
  async syncToServer(callback) {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    try {
      const db = this.load();
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(db),
        credentials: 'include'
      });
      if (res.ok && typeof callback === 'function') {
        const json = await res.json();
        callback(json);
      }
    } catch (e) {
      console.warn('syncToServer failed:', e);
    }
  },

  /**
   * Helper to upload files to persistent server storage
   */
  uploadFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file provided'));
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataBase64 = e.target.result;
        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              fileName: file.name,
              name: file.name,
              fileType: file.type || 'application/octet-stream',
              dataBase64: dataBase64
            })
          });
          const json = await res.json();
          if (json && json.success && json.url) {
            resolve({
              name: file.name,
              size: `${Math.round(file.size / 1024)} KB`,
              type: file.type || 'application/octet-stream',
              url: json.url,
              dataBase64: dataBase64
            });
            return;
          }
        } catch (err) {
          console.warn('Persistent file upload failed, using local base64 fallback:', err);
        }
        resolve({
          name: file.name,
          size: `${Math.round(file.size / 1024)} KB`,
          type: file.type || 'application/octet-stream',
          url: null,
          dataBase64: dataBase64
        });
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  },

  // ------------------------------------------------------------------------
  // AUTHENTICATION & SESSION
  // ------------------------------------------------------------------------
  getSession() {
    try {
      const sess = localStorage.getItem(WP_SESSION_KEY);
      return sess ? JSON.parse(sess) : null;
    } catch (e) {
      return null;
    }
  },

  setSession(roleOrObj, user, token) {
    let sess;
    if (typeof roleOrObj === 'object' && roleOrObj !== null) {
      sess = { ...roleOrObj, timestamp: Date.now() };
    } else {
      sess = { role: roleOrObj, user, timestamp: Date.now() };
    }
    if (token) {
      sess.token = token;
      this.setSessionToken(token);
    } else if (sess.token) {
      this.setSessionToken(sess.token);
    }
    try {
      localStorage.setItem(WP_SESSION_KEY, JSON.stringify(sess));
      const roleStr = String((sess.role || (sess.user && sess.user.role)) || '').toLowerCase();
      if (roleStr === 'admin' || (sess.token && sess.token.startsWith('wp-admin'))) {
        localStorage.setItem('workpulse_admin_token', sess.token);
        localStorage.setItem('workpulse_admin_session', JSON.stringify(sess));
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('workpulse_admin_token', sess.token);
        if (typeof document !== 'undefined') {
          document.cookie = `wp_admin_session=${encodeURIComponent(sess.token)}; path=/; max-age=86400; SameSite=Lax`;
        }
      } else if (roleStr === 'staff' || (sess.token && sess.token.startsWith('wp-staff'))) {
        localStorage.setItem('workpulse_staff_token', sess.token);
        localStorage.setItem('workpulse_staff_session', JSON.stringify(sess));
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('workpulse_staff_token', sess.token);
        if (typeof document !== 'undefined') {
          document.cookie = `wp_staff_session=${encodeURIComponent(sess.token)}; path=/; max-age=86400; SameSite=Lax`;
        }
      }
    } catch (e) {}
    return sess;
  },

  clearSession() {
    try {
      localStorage.removeItem(WP_SESSION_KEY);
      localStorage.removeItem('workpulse_session_token');
      localStorage.removeItem('workpulse_admin_token');
      localStorage.removeItem('workpulse_admin_session');
      localStorage.removeItem('workpulse_staff_token');
      localStorage.removeItem('workpulse_staff_session');
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('workpulse_admin_token');
        sessionStorage.removeItem('workpulse_staff_token');
      }
      if (typeof document !== 'undefined') {
        document.cookie = 'wp_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        document.cookie = 'wp_admin_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
        document.cookie = 'wp_staff_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      }
    } catch (e) {}
  },

  // ------------------------------------------------------------------------
  // ADMIN PROFILE & ACCOUNT MANAGEMENT
  // ------------------------------------------------------------------------
  getAdminProfile() {
    const db = this.load();
    if (!db.admin || typeof db.admin !== 'object') {
      db.admin = {
        id: 'WP-ADMIN',
        name: 'Sarah Montgomery',
        email: 'admin@workpulse.com',
        position: 'Executive Director',
        role: 'Admin',
        photo: null
      };
      this.save(db, true);
    }
    return db.admin;
  },

  updateAdminProfile(data) {
    const db = this.load();
    const currentAdmin = this.getAdminProfile();
    const updated = {
      ...currentAdmin,
      name: data.name ? data.name.trim() : currentAdmin.name,
      email: data.email ? data.email.trim().toLowerCase() : currentAdmin.email,
      position: data.position ? data.position.trim() : currentAdmin.position,
      photo: data.photo !== undefined ? data.photo : currentAdmin.photo
    };

    if (data.newPassword && data.newPassword.trim()) {
      updated.password = data.newPassword.trim();
    }

    db.admin = updated;
    this.save(db);

    // Update active admin session
    const sess = this.getSession();
    if (sess && (sess.role === 'admin' || (sess.user && sess.user.role === 'Admin'))) {
      this.setSession('admin', {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        position: updated.position,
        role: 'Admin',
        photo: updated.photo
      });
    }

    return updated;
  },

  // ------------------------------------------------------------------------
  // STAFF OPERATIONS
  // ------------------------------------------------------------------------
  getStaffList() {
    const db = this.load();
    return db.staff || [];
  },

  getStaffById(id) {
    if (!id) return null;
    const cleanId = String(id).trim().toUpperCase();
    const list = this.getStaffList();
    return list.find(s => s && String(s.id).trim().toUpperCase() === cleanId) || null;
  },

  getOnlineStaffMap() {
    if (this._onlineStaffMap && Object.keys(this._onlineStaffMap).length > 0) {
      return this._onlineStaffMap;
    }
    const db = this.load();
    return db.onlineStaff || {};
  },

  isStaffOnline(staffId) {
    if (!staffId) return false;
    const cleanId = String(staffId).trim();
    const map = this.getOnlineStaffMap();
    return !!(map[cleanId] && map[cleanId].isOnline);
  },

  setOnlineStaffMap(map) {
    this._onlineStaffMap = map || {};
    try {
      const db = this.load();
      db.onlineStaff = this._onlineStaffMap;
      this.save(db, true);
    } catch (e) {}
  },

  addStaff(staffObj) {
    const db = this.load();
    staffObj._genuine = true;
    if (!staffObj.id) {
      // Generate next ID WP-10xx
      const maxIdNum = db.staff.reduce((max, s) => {
        const num = parseInt((s.id || '').replace('WP-', ''), 10) || 1000;
        return num > max ? num : max;
      }, 1000);
      staffObj.id = `WP-${maxIdNum + 1}`;
    }
    staffObj.status = staffObj.status || 'Active';
    staffObj.joiningDate = staffObj.joiningDate || new Date().toISOString().split('T')[0];

    const existingIdx = db.staff.findIndex(s => s.id === staffObj.id);
    if (existingIdx >= 0) {
      db.staff[existingIdx] = staffObj;
    } else {
      db.staff.unshift(staffObj);
    }

    this.save(db);
    return staffObj;
  },

  updateStaff(id, updatedFields) {
    const db = this.load();
    const idx = db.staff.findIndex(s => s.id === id);
    if (idx !== -1) {
      db.staff[idx] = { ...db.staff[idx], ...updatedFields };
      // Also update matching attendance records
      db.attendance.forEach(att => {
        if (att.staffId === id) {
          att.staffName = db.staff[idx].name;
          att.position = db.staff[idx].position;
        }
      });
      this.save(db);
      return db.staff[idx];
    }
    return null;
  },

  toggleStaffStatus(id) {
    const db = this.load();
    const staff = db.staff.find(s => s.id === id);
    if (staff) {
      staff.status = staff.status === 'Active' ? 'Inactive' : 'Active';
      this.save(db);
      return staff.status;
    }
    return null;
  },

  deleteStaff(id) {
    const db = this.load();
    const targetStaff = (db.staff || []).find(s => s.id === id);
    const targetName = targetStaff ? (targetStaff.name || '').toLowerCase().trim() : '';

    // 1. Remove from staff
    db.staff = (db.staff || []).filter(s => s.id !== id);

    // 2. Remove all attendance records
    db.attendance = (db.attendance || []).filter(a => a.staffId !== id);

    // 3. Remove leave and WFH requests
    db.leaves = (db.leaves || []).filter(l => l.staffId !== id);
    db.wfhRequests = (db.wfhRequests || []).filter(w => w.staffId !== id);

    // 4. Remove daily reports
    db.dailyReports = (db.dailyReports || []).filter(r => r.staffId !== id);

    // 5. Clean up tasks and subtasks
    db.tasks = (db.tasks || []).filter(t => {
      if (t.assignedStaffId === id || t.staffId === id) return false;
      if (Array.isArray(t.assignedStaffIds) && t.assignedStaffIds.length === 1 && t.assignedStaffIds[0] === id) return false;
      return true;
    }).map(t => {
      if (Array.isArray(t.assignedStaffIds)) {
        t.assignedStaffIds = t.assignedStaffIds.filter(aid => aid !== id);
      }
      if (Array.isArray(t.subtasks)) {
        t.subtasks = t.subtasks.filter(st => st.assignedStaffId !== id);
      }
      return t;
    });

    // 6. Clean up projects
    db.projects = (db.projects || []).filter(p => {
      const hasOtherStaff = (Array.isArray(p.assignedStaffIds) && p.assignedStaffIds.some(sid => sid !== id)) ||
                            (Array.isArray(p.teamMembers) && p.teamMembers.some(tm => (typeof tm === 'string' ? tm : (tm.id || tm.name)) !== id));
      if (!hasOtherStaff && (Array.isArray(p.assignedStaffIds) && p.assignedStaffIds.includes(id))) {
        return false;
      }
      return true;
    }).map(p => {
      if (Array.isArray(p.assignedStaffIds)) {
        p.assignedStaffIds = p.assignedStaffIds.filter(aid => aid !== id);
      }
      if (Array.isArray(p.assignedStaffNames) && targetName) {
        p.assignedStaffNames = p.assignedStaffNames.filter(name => (name || '').toLowerCase().trim() !== targetName);
      }
      if (Array.isArray(p.teamMembers)) {
        p.teamMembers = p.teamMembers.filter(tm => {
          if (typeof tm === 'string') return tm !== id && tm.toLowerCase().trim() !== targetName;
          return tm && tm.id !== id && (tm.name || '').toLowerCase().trim() !== targetName;
        });
      }
      return p;
    });

    // 7. Remove all notifications related to this staff (both staff-role and admin alerts about this staff)
    db.notifications = (db.notifications || []).filter(n => {
      if (n.staffId === id) return false;
      const str = JSON.stringify(n);
      if (str.includes(id)) return false;
      if (targetName && str.toLowerCase().includes(targetName)) return false;
      return true;
    });

    // 8. Clean up meetings
    if (Array.isArray(db.meetings)) {
      db.meetings.forEach(m => {
        if (Array.isArray(m.attendeeIds)) {
          m.attendeeIds = m.attendeeIds.filter(aid => aid !== id);
        }
        if (Array.isArray(m.attendeeStaffIds)) {
          m.attendeeStaffIds = m.attendeeStaffIds.filter(aid => aid !== id);
        }
      });
    }

    // 9. Clean up leads
    if (Array.isArray(db.leads)) {
      db.leads.forEach(l => {
        if (l.assignedStaffId === id) {
          l.assignedStaffId = null;
          l.assignedTo = null;
        }
      });
    }

    // 10. Clean up general requests
    if (Array.isArray(db.generalRequests)) {
      db.generalRequests = db.generalRequests.filter(gr => gr.staffId !== id);
    }

    this.save(db);
    return true;
  },

  // ------------------------------------------------------------------------
  // ATTENDANCE & SHIFT CHECKOUT MANAGEMENT
  // ------------------------------------------------------------------------
  getAttendance(filters = {}) {
    const db = this.load();
    let records = db.attendance || [];

    if (filters.staffId) {
      records = records.filter(r => r.staffId === filters.staffId);
    }
    if (filters.date) {
      records = records.filter(r => r.date === filters.date);
    }
    if (filters.status && filters.status !== 'All') {
      records = records.filter(r => r.status === filters.status);
    }
    return records;
  },

  getAttendanceById(id) {
    if (!id) return null;
    const db = this.load();
    const records = db.attendance || [];
    const cleanId = String(id).trim().toUpperCase();
    return records.find(r => 
      (r.id && String(r.id).trim().toUpperCase() === cleanId) ||
      (r.attendanceId && String(r.attendanceId).trim().toUpperCase() === cleanId)
    ) || null;
  },

  /**
   * Calculates working duration between two HH:MM AM/PM strings
   */
  /**
   * Calculates working duration between two HH:MM AM/PM strings, deducting break minutes
   */
  calculateHoursWorked(inTimeStr, outTimeStr, deductMinutes = 0) {
    if (!inTimeStr || !outTimeStr || inTimeStr === '--:--' || outTimeStr === '--:--') {
      return '0h 00m';
    }

    function parseToMinutes(t) {
      if (!t || typeof t !== 'string') return 0;
      const parts = t.trim().split(/\s+/);
      const timeParts = parts[0].split(':');
      if (timeParts.length < 2) return 0;
      let hours = parseInt(timeParts[0], 10) || 0;
      const minutes = parseInt(timeParts[1], 10) || 0;
      if (parts.length >= 2) {
        const period = parts[1].toUpperCase();
        if (period === 'PM' && hours < 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
      }
      return hours * 60 + minutes;
    }

    const inMin = parseToMinutes(inTimeStr);
    const outMin = parseToMinutes(outTimeStr);
    let diff = outMin - inMin - (deductMinutes || 0);
    if (diff < 0) diff = 0;

    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  },

  getOfficeTimezone() {
    const db = this.load();
    return (db && db.settings && db.settings.officeTimezone) || 'Asia/Kolkata';
  },

  getOfficeWeeklyHolidays() {
    const db = this.load();
    const s = db && db.settings;
    if (s && Array.isArray(s.weeklyHolidays) && s.weeklyHolidays.length > 0) {
      return s.weeklyHolidays;
    }
    if (s && s.sundayWeeklyOff !== false) {
      return ['Sunday'];
    }
    return ['Sunday'];
  },

  isDateWeeklyOff(dateStr) {
    if (!dateStr) return false;
    const iso = (typeof this.parseDateToISO === 'function') ? this.parseDateToISO(dateStr) : dateStr;
    const d = new Date(iso + 'T00:00:00');
    const dayOfWeek = d.getDay();
    const holidays = this.getOfficeWeeklyHolidays();
    const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    return holidays.some(h => DAY_MAP[h.toLowerCase()] === dayOfWeek);
  },

  formatOfficeTime(date = new Date(), options = {}) {
    const tz = this.getOfficeTimezone();
    const d = (date instanceof Date) ? date : new Date(date);
    try {
      return d.toLocaleTimeString('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        ...options
      });
    } catch (e) {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, ...options });
    }
  },

  formatOfficeDate(date = new Date()) {
    const tz = this.getOfficeTimezone();
    const d = (date instanceof Date) ? date : new Date(date);
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    } catch (e) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  },

  /**
   * Formats a date string (YYYY-MM-DD, ISO timestamp, or Date) into DD-MM-YYYY format
   * for consistent display throughout the entire application.
   */
  formatDisplayDate(dateVal, includeTime = false) {
    if (!dateVal && dateVal !== 0) return '—';
    try {
      if (typeof dateVal === 'string') {
        const trimmed = dateVal.trim();
        if (!trimmed || trimmed === '—' || trimmed === '--' || trimmed === 'N/A' || trimmed === 'Ongoing') return trimmed;
        // If already DD-MM-YYYY
        if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
          return trimmed;
        }
        // If YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
        const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
        if (match) {
          const [, y, m, d, hh, mm] = match;
          const datePart = `${d}-${m}-${y}`;
          if (includeTime && hh !== undefined && mm !== undefined) {
            const hNum = parseInt(hh, 10);
            const ampm = hNum >= 12 ? 'PM' : 'AM';
            const h12 = hNum % 12 || 12;
            return `${datePart} ${String(h12).padStart(2, '0')}:${mm} ${ampm}`;
          }
          return datePart;
        }
      }
      const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const datePart = `${day}-${month}-${year}`;
      if (includeTime) {
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${datePart} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
      }
      return datePart;
    } catch (e) {
      return String(dateVal);
    }
  },

  /**
   * Parses any date string (including DD-MM-YYYY) into standardized YYYY-MM-DD ISO format
   * for internal querying, state comparison, and persistent database storage.
   */
  parseDateToISO(dateVal) {
    if (!dateVal) return '';
    try {
      if (dateVal instanceof Date) {
        if (isNaN(dateVal.getTime())) return '';
        const y = dateVal.getFullYear();
        const m = String(dateVal.getMonth() + 1).padStart(2, '0');
        const d = String(dateVal.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      const trimmed = String(dateVal).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
      const mDd = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (mDd) {
        const d = String(mDd[1]).padStart(2, '0');
        const m = String(mDd[2]).padStart(2, '0');
        const y = mDd[3];
        return `${y}-${m}-${d}`;
      }
      const isoPrefix = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoPrefix) return isoPrefix[0];
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch (e) {}
    return String(dateVal);
  },

  initDatePickers(root = null) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (typeof flatpickr === 'undefined') return;
    
    if (typeof flatpickr.setDefaults === 'function') {
      flatpickr.setDefaults({
        disableMobile: true,
        prevArrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
        nextArrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
      });
    }

    // Install the value descriptor hook on HTMLInputElement once
    if (!window.__workpulseDatePickerHooked) {
      window.__workpulseDatePickerHooked = true;
      const originalValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (originalValueDesc && originalValueDesc.set) {
        Object.defineProperty(HTMLInputElement.prototype, 'value', {
          get() {
            return originalValueDesc.get.call(this);
          },
          set(val) {
            originalValueDesc.set.call(this, val);
            if (this._flatpickr && !this._isUpdatingFlatpickr) {
              this._isUpdatingFlatpickr = true;
              try {
                this._flatpickr.setDate(val || '', false);
              } catch (e) {
              } finally {
                this._isUpdatingFlatpickr = false;
              }
            }
          }
        });
      }
    }

    const container = (root && root.querySelectorAll) ? root : document;
    const selector = 'input[type="date"], input.datepicker, input[data-datepicker]';
    const inputs = container.querySelectorAll(selector);
    inputs.forEach(inp => {
      if (inp._flatpickr) return;
      try {
        const curVal = inp.value;
        const fp = flatpickr(inp, {
          dateFormat: 'Y-m-d',
          altInput: true,
          altFormat: 'd-m-Y',
          allowInput: true,
          disableMobile: true,
          altInputClass: (inp.className || '') + ' flatpickr-alt-input',
          prevArrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
          nextArrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
          parseDate: (datestr, format) => {
            if (!datestr) return undefined;
            if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(datestr)) {
              const [d, m, y] = datestr.split(/[-/]/).map(Number);
              return new Date(y, m - 1, d);
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(datestr)) {
              const [y, m, d] = datestr.split('-').map(Number);
              return new Date(y, m - 1, d);
            }
            return flatpickr.parseDate(datestr, format);
          },
          onReady: function(selectedDates, dateStr, instance) {
            if (instance.altInput) {
              instance.altInput.placeholder = 'DD-MM-YYYY';
              if (inp.required) instance.altInput.required = true;
            }
            if (instance.prevMonthNav) {
              instance.prevMonthNav.setAttribute('title', 'Previous Month');
              instance.prevMonthNav.setAttribute('aria-label', 'Previous Month');
            }
            if (instance.nextMonthNav) {
              instance.nextMonthNav.setAttribute('title', 'Next Month');
              instance.nextMonthNav.setAttribute('aria-label', 'Next Month');
            }
          },
          onChange: function(selectedDates, dateStr, instance) {
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        if (curVal) {
          fp.setDate(curVal, false);
        }
      } catch (err) {
        console.warn('Flatpickr init notice:', err);
      }
    });
  },

  setupDatePickerObserver() {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    if (window.__workpulseDatePickerObserverActive) return;
    window.__workpulseDatePickerObserverActive = true;
    const observer = new MutationObserver((mutations) => {
      let hasNewDateInputs = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              if (node.matches && node.matches('input[type="date"], input.datepicker')) {
                hasNewDateInputs = true;
                break;
              }
              if (node.querySelector && node.querySelector('input[type="date"], input.datepicker')) {
                hasNewDateInputs = true;
                break;
              }
            }
          }
        }
        if (hasNewDateInputs) break;
      }
      if (hasNewDateInputs) {
        this.initDatePickers(document.body);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },

  calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  },

  isWithinOfficeGeofence(coordsOrLat, lng) {
    let lat, lon;
    if (typeof coordsOrLat === 'number') {
      lat = coordsOrLat;
      lon = lng;
    } else if (coordsOrLat && typeof coordsOrLat.latitude === 'number') {
      lat = coordsOrLat.latitude;
      lon = coordsOrLat.longitude;
    } else {
      return { within: false, distance: null, officeCoords: null, radius: 150 };
    }
    const db = this.load();
    const officeLat = Number(db?.settings?.latitude);
    const officeLng = Number(db?.settings?.longitude);
    const radius = Number(db?.settings?.geofenceRadiusMeters) || 150;
    if (isNaN(officeLat) || isNaN(officeLng)) {
      return { within: true, distance: 0, officeCoords: null, radius };
    }
    const dist = this.calculateDistanceMeters(lat, lon, officeLat, officeLng);
    return {
      within: dist <= radius,
      distance: Math.round(dist),
      radius: radius,
      officeCoords: { latitude: officeLat, longitude: officeLng }
    };
  },

  getTodayDateString() {
    return this.formatOfficeDate(new Date());
  },

  /**
   * Records staff location-based check-in
   * Staff attendance remains active until manual checkout
   */
  checkInStaff(staffId, coords, customLocation, targetDate = null, extraData = {}) {
    const db = this.load();
    const todayStr = targetDate || this.getTodayDateString();
    const staff = db.staff.find(s => s.id === staffId);
    if (!staff) return null;

    const inTime = this.formatOfficeTime(new Date());

    // MANUAL CHECKOUT RULE:
    // Attendance remains active until the staff member manually checks out.
    const outTime = '--:--';
    const workingHours = 'In Progress';

    let cleanCoords = null;
    let readableAddress = (extraData && extraData.address) ? extraData.address : null;
    let checkInTimestamp = (extraData && extraData.checkInTimestamp) ? extraData.checkInTimestamp : new Date().toISOString();
    let accuracy = (extraData && extraData.accuracy !== undefined && !isNaN(Number(extraData.accuracy))) ? Number(extraData.accuracy) : (coords?.accuracy ? Number(coords.accuracy) : null);

    let formattedLocation = customLocation;

    if (coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number' && !isNaN(coords.latitude) && !isNaN(coords.longitude)) {
      cleanCoords = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: accuracy
      };
      const latDir = coords.latitude >= 0 ? 'N' : 'S';
      const lngDir = coords.longitude >= 0 ? 'E' : 'W';
      const coordStr = `${Math.abs(coords.latitude).toFixed(4)}° ${latDir}, ${Math.abs(coords.longitude).toFixed(4)}° ${lngDir}`;
      if (!formattedLocation || formattedLocation.includes('GPS Telemetry Unavailable') || formattedLocation.includes('Office Geofence')) {
        formattedLocation = readableAddress ? `${readableAddress} (${coordStr})` : `GPS (${coordStr})`;
      }
    } else {
      if (!formattedLocation || formattedLocation.includes('GPS Telemetry Unavailable') || formattedLocation.includes('Office Geofence')) {
        formattedLocation = 'Location unavailable';
      }
    }

    const mapUrl = cleanCoords ? `https://www.google.com/maps?q=${cleanCoords.latitude},${cleanCoords.longitude}` : null;

    const dayNum = parseInt(todayStr.split('-')[2], 10);
    const isOff = this.isDateWeeklyOff(todayStr);

    let rec = db.attendance.find(a => a.staffId === staffId && a.date === todayStr);
    if (!rec) {
      rec = {
        id: `ATT-${staffId}-${todayStr}`,
        staffId: staffId,
        staffName: staff.name,
        position: staff.position,
        date: todayStr,
        dayNumber: dayNum,
        isSunday: isOff,
        isWeeklyOff: isOff,
        checkIn: inTime,
        checkOut: outTime,
        workingHours: workingHours,
        location: formattedLocation,
        address: readableAddress,
        coords: cleanCoords,
        latitude: cleanCoords ? cleanCoords.latitude : null,
        longitude: cleanCoords ? cleanCoords.longitude : null,
        accuracy: accuracy,
        mapUrl: mapUrl,
        checkInTimestamp: checkInTimestamp,
        status: 'Present',
        shiftStatus: 'active',
        lunchBreak: { startedAt: null, endedAt: null, durationMinutes: 0, used: false },
        inactivityPeriods: [],
        totalBreakMinutes: 0,
        totalInactiveMinutes: 0,
        notes: `Checked in at ${inTime}. Shift active until manual checkout.`,
        isAutoCheckout: false
      };
      db.attendance.push(rec);
    } else {
      rec.checkIn = inTime;
      rec.checkOut = outTime;
      rec.workingHours = workingHours;
      rec.location = formattedLocation;
      rec.address = readableAddress || null;
      rec.coords = cleanCoords;
      rec.latitude = cleanCoords ? cleanCoords.latitude : null;
      rec.longitude = cleanCoords ? cleanCoords.longitude : null;
      rec.accuracy = accuracy !== null && accuracy !== undefined ? accuracy : null;
      rec.mapUrl = mapUrl;
      rec.checkInTimestamp = checkInTimestamp;
      rec.status = 'Present';
      rec.shiftStatus = 'active';
      rec.lunchBreak = rec.lunchBreak || { startedAt: null, endedAt: null, durationMinutes: 0, used: false };
      rec.inactivityPeriods = rec.inactivityPeriods || [];
      rec.totalBreakMinutes = rec.totalBreakMinutes || 0;
      rec.totalInactiveMinutes = rec.totalInactiveMinutes || 0;
      rec.notes = `Checked in at ${inTime}. Shift active until manual checkout.`;
      rec.isAutoCheckout = false;
    }

    // Add admin notification
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      text: `${staff.name} checked in (${inTime}) at ${formattedLocation}.`,
      time: 'Just now',
      read: false
    });

    this.save(db);
    return rec;
  },

  /**
   * Starts staff lunch break (pauses working timer)
   * Enforces one lunch break per shift policy
   */
  startLunchBreak(staffId, targetDate = null) {
    const db = this.load();
    const todayStr = targetDate || this.getTodayDateString();
    let rec = db.attendance.find(a => a.staffId === staffId && a.date === todayStr);
    if (!rec) rec = db.attendance.find(a => a.staffId === staffId && a.shiftStatus && a.shiftStatus !== 'completed' && a.shiftStatus !== 'none');
    if (!rec || rec.checkIn === '--:--' || rec.checkOut !== '--:--') {
      return { success: false, error: 'Shift is not active.' };
    }

    if (rec.lunchBreak && rec.lunchBreak.used) {
      return { success: false, error: 'You have already taken your lunch break for this shift.' };
    }
    if (rec.shiftStatus === 'lunch') {
      return { success: false, error: 'Already on lunch break.' };
    }

    const now = new Date();
    const timeStr = this.formatOfficeTime(now);

    rec.lunchBreak = {
      startedAt: timeStr,
      startTs: now.getTime(),
      endedAt: null,
      durationMinutes: 0,
      used: false
    };
    rec.shiftStatus = 'lunch';
    rec.notes = `${rec.notes || ''} [Lunch started: ${timeStr}]`.trim();

    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      text: `${rec.staffName} started lunch break at ${timeStr}. Working timer paused.`,
      time: 'Just now',
      read: false
    });

    this.save(db);
    return { success: true, record: rec };
  },

  /**
   * Ends staff lunch break (resumes working timer)
   * Stores duration and marks lunch break as used
   */
  endLunchBreak(staffId, targetDate = null) {
    const db = this.load();
    const todayStr = targetDate || this.getTodayDateString();
    let rec = db.attendance.find(a => a.staffId === staffId && a.date === todayStr);
    if (!rec) rec = db.attendance.find(a => a.staffId === staffId && a.shiftStatus === 'lunch');
    if (!rec || rec.shiftStatus !== 'lunch' || !rec.lunchBreak) {
      return { success: false, error: 'Staff is not currently on lunch break.' };
    }

    const now = new Date();
    const startTs = rec.lunchBreak.startTs || now.getTime();
    let durMin = Math.round((now.getTime() - startTs) / 60000);
    if (durMin < 1) durMin = 1; // Count at least 1 minute

    let timeStr = this.formatOfficeTime(now);
    // Ensure endedAt is never identical to startedAt
    if (timeStr === rec.lunchBreak.startedAt) {
      const endTs = startTs + durMin * 60000;
      timeStr = this.formatOfficeTime(new Date(endTs));
    }

    rec.lunchBreak.endedAt = timeStr;
    rec.lunchBreak.endTs = now.getTime();
    rec.lunchBreak.durationMinutes = durMin;
    rec.lunchBreak.used = true;
    rec.shiftStatus = 'active';
    rec.totalBreakMinutes = (rec.totalBreakMinutes || 0) + durMin;
    rec.notes = `${rec.notes || ''} [Lunch ended: ${timeStr} (${durMin}m)]`.trim();

    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      text: `${rec.staffName} resumed shift from lunch break at ${timeStr} (Duration: ${durMin}m).`,
      time: 'Just now',
      read: false
    });

    this.save(db);
    return { success: true, record: rec };
  },

  /**
   * Records start of inactivity period (pauses working timer)
   */
  recordInactivityStart(staffId, reason = 'System idle (15m)', targetDate = null) {
    const db = this.load();
    const todayStr = targetDate || this.getTodayDateString();
    let rec = db.attendance.find(a => a.staffId === staffId && a.date === todayStr);
    if (!rec) rec = db.attendance.find(a => a.staffId === staffId && a.shiftStatus && a.shiftStatus !== 'completed' && a.shiftStatus !== 'none');
    if (!rec || rec.checkIn === '--:--' || rec.checkOut !== '--:--') {
      return { success: false, error: 'Shift is not active.' };
    }

    // If already on lunch break or already inactive, ignore
    if (rec.shiftStatus === 'lunch' || rec.shiftStatus === 'inactive') {
      return { success: false, error: `Already in status ${rec.shiftStatus}` };
    }

    const now = new Date();
    const timeStr = this.formatOfficeTime(now);

    rec.shiftStatus = 'inactive';
    rec.currentInactivityStart = {
      timeStr: timeStr,
      ts: now.getTime(),
      reason: reason
    };
    rec.notes = `${rec.notes || ''} [Inactivity detected (${reason}): ${timeStr}]`.trim();

    this.save(db);
    return { success: true, record: rec };
  },

  /**
   * Resumes staff shift from inactivity when staff clicks Resume Work
   */
  recordInactivityResume(staffId, targetDate = null) {
    const db = this.load();
    const todayStr = targetDate || this.getTodayDateString();
    let rec = db.attendance.find(a => a.staffId === staffId && a.date === todayStr);
    if (!rec) rec = db.attendance.find(a => a.staffId === staffId && a.shiftStatus === 'inactive');
    if (!rec || rec.shiftStatus !== 'inactive' || !rec.currentInactivityStart) {
      return { success: false, error: 'Staff is not in inactive status.' };
    }

    const now = new Date();
    const timeStr = this.formatOfficeTime(now);
    const startTs = rec.currentInactivityStart.ts;
    const triggerReason = rec.currentInactivityStart.reason || 'Inactivity';
    let durMin = Math.round((now.getTime() - startTs) / 60000);
    if (durMin < 1) durMin = 1;

    rec.inactivityPeriods = rec.inactivityPeriods || [];
    rec.inactivityPeriods.push({
      startedAt: rec.currentInactivityStart.timeStr,
      resumedAt: timeStr,
      durationMinutes: durMin,
      reason: triggerReason
    });
    rec.totalBreakMinutes = (rec.totalBreakMinutes || 0) + durMin;
    rec.totalInactiveMinutes = (rec.totalInactiveMinutes || 0) + durMin;
    rec.currentInactivityStart = null;
    rec.shiftStatus = 'active';
    rec.notes = `${rec.notes || ''} [Resumed from inactivity (${triggerReason}): ${timeStr} (${durMin}m)]`.trim();

    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      text: `${rec.staffName} resumed shift from inactivity at ${timeStr} (Paused for ${durMin}m — ${triggerReason}).`,
      time: 'Just now',
      read: false
    });

    this.save(db);
    return { success: true, record: rec };
  },

  /**
   * Manual staff checkout
   */
  checkOutStaff(staffId, coords, targetDate = null) {
    const db = this.load();
    const todayStr = targetDate || this.getTodayDateString();
    let rec = db.attendance.find(a => a.staffId === staffId && a.date === todayStr);
    if (!rec) rec = db.attendance.find(a => a.staffId === staffId && a.shiftStatus && a.shiftStatus !== 'completed' && a.shiftStatus !== 'none');
    if (!rec || rec.checkIn === '--:--') return null;

    const now = new Date();
    const outTime = this.formatOfficeTime(now);

    // If staff was on lunch break at checkout, end it
    if (rec.shiftStatus === 'lunch' && rec.lunchBreak && !rec.lunchBreak.endedAt) {
      const durMin = Math.max(1, Math.round((now.getTime() - (rec.lunchBreak.startTs || now.getTime())) / 60000));
      rec.lunchBreak.endedAt = outTime;
      rec.lunchBreak.durationMinutes = durMin;
      rec.lunchBreak.used = true;
      rec.totalBreakMinutes = (rec.totalBreakMinutes || 0) + durMin;
    }

    // If staff was inactive at checkout, conclude period
    if (rec.shiftStatus === 'inactive' && rec.currentInactivityStart) {
      const durMin = Math.max(1, Math.round((now.getTime() - rec.currentInactivityStart.ts) / 60000));
      const triggerReason = rec.currentInactivityStart.reason || 'Inactivity';
      rec.inactivityPeriods = rec.inactivityPeriods || [];
      rec.inactivityPeriods.push({
        startedAt: rec.currentInactivityStart.timeStr,
        resumedAt: outTime,
        durationMinutes: durMin,
        reason: triggerReason
      });
      rec.totalBreakMinutes = (rec.totalBreakMinutes || 0) + durMin;
      rec.totalInactiveMinutes = (rec.totalInactiveMinutes || 0) + durMin;
      rec.currentInactivityStart = null;
    }

    rec.shiftStatus = 'completed';
    rec.checkOut = outTime;
    rec.workingHours = this.calculateHoursWorked(rec.checkIn, outTime, rec.totalBreakMinutes || 0);
    rec.isAutoCheckout = false;
    rec.notes = `Manually checked out at ${outTime}. Total breaks/pause: ${rec.totalBreakMinutes || 0}m.`;
    if (coords && typeof coords.latitude === 'number') {
      rec.outCoords = { latitude: coords.latitude, longitude: coords.longitude };
    }

    this.save(db);
    return rec;
  },

  /**
   * Reset today's attendance for demo / testing re-punch
   */
  resetTodayAttendance(staffId, targetDate = null) {
    const db = this.load();
    const todayStr = targetDate || this.getTodayDateString();
    let rec = db.attendance.find(a => a.staffId === staffId && a.date === todayStr);
    if (!rec) rec = db.attendance.find(a => a.staffId === staffId && a.shiftStatus && a.shiftStatus !== 'none');
    if (rec) {
      rec.checkIn = '--:--';
      rec.checkOut = '--:--';
      rec.workingHours = '0h 00m';
      rec.status = 'Not Marked';
      rec.shiftStatus = 'none';
      rec.lunchBreak = { startedAt: null, endedAt: null, durationMinutes: 0, used: false };
      rec.inactivityPeriods = [];
      rec.totalBreakMinutes = 0;
      rec.totalInactiveMinutes = 0;
      rec.currentInactivityStart = null;
      rec.location = 'Pending Check-In';
      rec.address = null;
      rec.coords = null;
      rec.latitude = null;
      rec.longitude = null;
      rec.accuracy = null;
      rec.mapUrl = null;
      rec.checkInTimestamp = null;
      rec.notes = 'Attendance reset for fresh self check-in testing';
      rec.isAutoCheckout = false;
      this.save(db);
      return rec;
    }
    return null;
  },

  // ------------------------------------------------------------------------
  // MONTHLY ATTENDANCE SUMMARY CALCULATION
  // ------------------------------------------------------------------------
  getMonthSummaryForStaff(staffId, year, month) {
    const now = new Date();
    if (year === undefined || year === null) year = now.getFullYear();
    if (month === undefined || month === null) month = now.getMonth();
    year = Number(year);
    month = Number(month);

    const db = this.load();
    const attList = Array.isArray(db.attendance) ? db.attendance : [];
    let records = attList.filter(a => {
      if (a.staffId !== staffId) return false;
      const parts = (a.date || '').split('-');
      return parseInt(parts[0], 10) === year && parseInt(parts[1], 10) === (month + 1);
    });

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const holidays = this.getOfficeWeeklyHolidays();
    const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    let weeklyOffCount = 0;
    let sundaysCount = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dayOfWeek = new Date(year, month, d).getDay();
      if (dayOfWeek === 0) sundaysCount++;
      const isOff = holidays.some(h => DAY_MAP[h.toLowerCase()] === dayOfWeek);
      if (isOff) weeklyOffCount++;
    }

    const todayStr = this.getTodayDateString();

    // Unique days where staff had a valid check-in; strictly exclude future dates
    const presentDates = new Set();
    const halfDayDates = new Set();
    records.forEach(r => {
      if (r.date && r.date <= todayStr) {
        if (r.status === 'Half Day') {
          halfDayDates.add(r.date);
        } else if ((r.status === 'Present' || r.status === 'Checked-In') && r.checkIn && r.checkIn !== '--:--') {
          presentDates.add(r.date);
        }
      }
    });
    const presentDays = presentDates.size;
    const halfDays = halfDayDates.size;

    // Approved leaves & WFH for this month
    const leavesList = Array.isArray(db.leaves) ? db.leaves : [];
    const wfhList = Array.isArray(db.wfhRequests) ? db.wfhRequests : [];
    let leaveDays = 0;
    let wfhDays = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const curDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month, d).getDay();
      const isOff = holidays.some(h => DAY_MAP[h.toLowerCase()] === dayOfWeek);
      if (!isOff) {
        const hasLeave = leavesList.some(l => {
          if (l.staffId !== staffId || l.status !== 'Approved') return false;
          const start = l.leaveDate || l.startDate;
          const end = l.toDate || l.endDate || start;
          return curDateStr >= start && curDateStr <= end;
        });
        if (hasLeave) leaveDays++;

        const hasWfh = wfhList.some(w => {
          if (w.staffId !== staffId || w.status !== 'Approved') return false;
          return w.date === curDateStr;
        });
        if (hasWfh) wfhDays++;
      }
    }

    const totalWorkingDays = Math.max(0, daysInMonth - weeklyOffCount);
    const effectiveAttended = presentDays + wfhDays + (halfDays * 0.5);
    const attendancePct = (totalWorkingDays > 0 && effectiveAttended > 0)
      ? Math.min(100, Math.max(0, (effectiveAttended / totalWorkingDays) * 100)).toFixed(2)
      : '0.00';

    return {
      totalDays: daysInMonth,
      weeklyOffs: weeklyOffCount,
      sundays: sundaysCount,
      totalWorkingDays,
      presentDays,
      halfDays,
      leaveDays,
      wfhDays,
      effectiveAttended,
      attendancePercentage: `${attendancePct}%`
    };
  },

  // ------------------------------------------------------------------------
  // LEAVE MANAGEMENT & CALENDAR INTEGRATION
  // ------------------------------------------------------------------------
  calculateLeaveDays(startDate, endDate) {
    if (!startDate) return 1;
    if (!endDate || endDate === startDate) return 1;
    const sIso = (typeof this.parseDateToISO === 'function') ? this.parseDateToISO(startDate) : startDate;
    const eIso = (typeof this.parseDateToISO === 'function') ? this.parseDateToISO(endDate) : endDate;
    const start = new Date(sIso + 'T00:00:00');
    const end = new Date(eIso + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 1;
    const diffTime = Math.abs(end - start);
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays > 0 ? diffDays : 1;
  },

  getLeaves(filter = null) {
    const db = this.load();
    const staffList = db.staff || [];
    const staffMap = new Map();
    staffList.forEach(s => {
      if (s && s.id) {
        staffMap.set(s.id, s);
        staffMap.set(s.id.toUpperCase(), s);
        staffMap.set(s.id.toLowerCase(), s);
      }
    });

    const rawLeaves = (db.leaves || []).map(lv => {
      if (!lv) return lv;
      const s = staffMap.get(lv.staffId) || (lv.staffId ? staffMap.get(String(lv.staffId).trim().toUpperCase()) : null);
      let name = lv.staffName;
      if (!name || name === 'undefined') name = s ? s.name : null;
      if (!name || name === 'undefined') name = lv.staffId || 'Staff Member';

      let pos = lv.position;
      if (!pos || pos === 'undefined') pos = s ? s.position : null;
      if (!pos || pos === 'undefined') pos = 'Staff';

      const start = lv.startDate || lv.leaveDate;
      const end = lv.endDate || lv.toDate || start;
      const tDays = lv.totalDays || this.calculateLeaveDays(start, end);

      return {
        ...lv,
        startDate: start,
        endDate: end,
        leaveDate: start,
        toDate: end,
        totalDays: tDays,
        staffName: name,
        position: pos,
        photo: (lv.photo && lv.photo !== 'undefined') ? lv.photo : (s ? s.photo : null)
      };
    });

    // Deduplicate any repeated leave records by ID or normalized content key
    const deduplicated = [];
    const seen = new Map();
    rawLeaves.forEach(lv => {
      if (!lv) return;
      const idKey = lv.id ? `ID_${lv.id}` : null;
      const start = lv.startDate || lv.leaveDate;
      const end = lv.endDate || lv.toDate || start;
      const contentKey = (lv.staffId && start && lv.leaveType) 
        ? `${String(lv.staffId).trim().toUpperCase()}_${start}_${end}_${lv.leaveType}`.toUpperCase() 
        : null;

      const key = idKey || contentKey;
      if (!key) {
        deduplicated.push(lv);
        return;
      }

      if (!seen.has(key)) {
        seen.set(key, lv);
        if (contentKey && contentKey !== key) seen.set(contentKey, lv);
        deduplicated.push(lv);
      } else {
        const prev = seen.get(key);
        if (prev.status === 'Pending' && lv.status !== 'Pending') {
          const idx = deduplicated.indexOf(prev);
          if (idx !== -1) deduplicated[idx] = lv;
          seen.set(key, lv);
        }
      }
    });

    let result = deduplicated;
    if (filter && typeof filter === 'object') {
      if (filter.staffId) {
        result = result.filter(l => String(l.staffId || '').trim().toUpperCase() === String(filter.staffId).trim().toUpperCase());
      }
      if (filter.status && filter.status !== 'All') {
        result = result.filter(l => l.status === filter.status);
      }
    }

    return result;
  },

  applyLeave(staffId, leaveData) {
    const startDate = leaveData?.startDate || leaveData?.leaveDate;
    const endDate = leaveData?.endDate || leaveData?.toDate || startDate;

    if (startDate && endDate && endDate < startDate) {
      throw new Error('End Date cannot be earlier than Start Date.');
    }

    const db = this.load();
    const staff = this.getStaffById(staffId) || (db.staff || []).find(s => s && String(s.id).trim().toUpperCase() === String(staffId).trim().toUpperCase());
    if (!staff) return null;

    const totalDays = leaveData.totalDays || this.calculateLeaveDays(startDate, endDate);

    const newLeave = {
      id: leaveData?.id || `LV-${Date.now()}`,
      staffId: staff.id,
      staffName: staff.name,
      position: staff.position,
      photo: staff.photo || null,
      startDate: startDate,
      endDate: endDate,
      leaveDate: startDate,
      toDate: endDate,
      totalDays: totalDays,
      leaveType: leaveData.leaveType,
      reason: leaveData.reason,
      status: 'Pending',
      appliedDate: leaveData.appliedDate || this.getTodayDateString(),
      adminComment: null,
      rejectionReason: null
    };

    if (!Array.isArray(db.leaves)) db.leaves = [];
    
    // Check if an existing leave for this staff and date range already exists
    const existingIdx = db.leaves.findIndex(l => 
      l.id === newLeave.id || 
      (String(l.staffId).trim().toUpperCase() === String(staff.id).trim().toUpperCase() && 
       (l.startDate === startDate || l.leaveDate === startDate) && 
       (l.endDate === endDate || l.toDate === endDate) && 
       l.leaveType === leaveData.leaveType)
    );

    if (existingIdx >= 0) {
      db.leaves[existingIdx] = { ...db.leaves[existingIdx], ...newLeave, id: db.leaves[existingIdx].id };
    } else {
      db.leaves.unshift(newLeave);
    }

    // Notify Admin
    if (!Array.isArray(db.notifications)) db.notifications = [];
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      text: `New leave application filed by ${staff.name} (${leaveData.leaveType})`,
      time: 'Just now',
      read: false
    });

    this.save(db);
    return newLeave;
  },

  updateLeaveStatus(leaveId, newStatus, reasonOrNotes) {
    const db = this.load();
    const leave = (db.leaves || []).find(l => l.id === leaveId);
    if (!leave) return { success: false, error: 'Leave request not found' };

    leave.status = newStatus;
    leave.reviewedAt = new Date().toISOString();
    leave.reviewedBy = 'Administrator';

    const commentText = (reasonOrNotes || '').trim();

    const startDate = leave.startDate || leave.leaveDate;
    const endDate = leave.endDate || leave.toDate || startDate;
    leave.startDate = startDate;
    leave.endDate = endDate;
    leave.leaveDate = startDate;
    leave.toDate = endDate;

    // Ensure staff details are resolved and permanently bound
    const staffMember = (db.staff || []).find(s => s && String(s.id).trim().toUpperCase() === String(leave.staffId).trim().toUpperCase());
    if (staffMember) {
      if (!leave.staffName || leave.staffName === 'undefined') leave.staffName = staffMember.name;
      if (!leave.position || leave.position === 'undefined') leave.position = staffMember.position;
      if (!leave.photo || leave.photo === 'undefined') leave.photo = staffMember.photo;
    }

    function getDatesInRange(startStr, endStr) {
      const dates = [];
      if (!startStr) return dates;
      let cur = new Date(startStr + 'T00:00:00');
      const end = new Date((endStr || startStr) + 'T00:00:00');
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
      }
      return dates;
    }

    if (!Array.isArray(db.attendance)) db.attendance = [];
    const rangeDates = getDatesInRange(startDate, endDate);

    if (newStatus === 'Rejected') {
      leave.rejectionReason = commentText;
      leave.adminComment = commentText;
      leave.approvalComment = null;

      // Revert any attendance records marked as Leave for this staff member during this range
      db.attendance.forEach(att => {
        if (att.staffId === leave.staffId && rangeDates.includes(att.date)) {
          if (att.status === 'Leave') {
            att.status = 'Not Marked';
            att.notes = `Leave request rejected by Admin. Reason: ${commentText || 'Rejected'}`;
          }
        }
      });
    } else if (newStatus === 'Approved') {
      leave.rejectionReason = null;
      leave.adminComment = commentText || null;
      leave.approvalComment = commentText || null;
      leave.notes = commentText || null;

      // Update or create attendance records as Leave for all active non-weekly-off dates in the leave range
      rangeDates.forEach(dStr => {
        if (this.isDateWeeklyOff(dStr)) return;
        let att = db.attendance.find(a => a.staffId === leave.staffId && a.date === dStr);
        if (!att) {
          const dObj = new Date(dStr + 'T00:00:00');
          att = {
            id: `ATT-${leave.staffId}-${dStr}`,
            staffId: leave.staffId,
            staffName: leave.staffName || '',
            position: leave.position || '',
            date: dStr,
            dayNumber: dObj.getDate(),
            isSunday: dObj.getDay() === 0,
            checkIn: '--:--',
            checkOut: '--:--',
            workingHours: '0h 00m',
            location: 'On Approved Leave',
            coords: null,
            status: 'Leave',
            shiftStatus: 'none',
            notes: `Approved ${leave.leaveType}: ${leave.reason}` + (commentText ? ` [Admin Note: ${commentText}]` : ''),
            isAutoCheckout: false
          };
          db.attendance.push(att);
        } else {
          att.status = 'Leave';
          att.notes = `Approved ${leave.leaveType}: ${leave.reason}` + (commentText ? ` [Admin Note: ${commentText}]` : '');
          att.checkIn = '--:--';
          att.checkOut = '--:--';
          att.workingHours = '0h 00m';
        }
      });
    }

    const dateRangeStr = (startDate && endDate)
      ? ((startDate === endDate) ? startDate : `${startDate} to ${endDate}`)
      : (startDate || endDate || leave.date || leave.leaveDate || 'requested dates');
    const notifText = newStatus === 'Rejected'
      ? `Your leave request for ${dateRangeStr} was rejected by Admin. Reason: ${leave.rejectionReason || 'No reason provided'}`
      : `Your leave request for ${dateRangeStr} was approved by Admin.` + (commentText ? ` Note: ${commentText}` : '');

    if (!Array.isArray(db.notifications)) db.notifications = [];
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'staff',
      staffId: leave.staffId,
      title: `Leave Request ${newStatus}`,
      text: notifText,
      message: notifText,
      time: 'Just now',
      createdAt: 'Just now',
      read: false
    });

    this.save(db);
    return { success: true, message: `Leave request ${newStatus.toLowerCase()}`, data: leave, leave };
  },

  // ------------------------------------------------------------------------
  // WORK FROM HOME MANAGEMENT & CALENDAR INTEGRATION
  // ------------------------------------------------------------------------
  getWfhRequests() {
    const db = this.load();
    const staffList = db.staff || [];
    const staffMap = new Map();
    staffList.forEach(s => {
      if (s && s.id) {
        staffMap.set(s.id, s);
        staffMap.set(s.id.toUpperCase(), s);
        staffMap.set(s.id.toLowerCase(), s);
      }
    });

    const mapped = (db.wfhRequests || []).map(w => {
      if (!w) return w;
      const s = staffMap.get(w.staffId) || (w.staffId ? staffMap.get(String(w.staffId).trim().toUpperCase()) : null);
      return {
        ...w,
        staffName: w.staffName || (s ? s.name : null) || w.staffId || 'Staff',
        position: w.position || (s ? s.position : null) || 'Staff Member',
        photo: w.photo || (s ? s.photo : null)
      };
    });

    const deduplicated = [];
    mapped.forEach(w => {
      if (!w) return;
      const matchIdx = deduplicated.findIndex(existing => {
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
        deduplicated.push(w);
      } else {
        const existing = deduplicated[matchIdx];
        const exStatus = String(existing.status || 'Pending').trim().toLowerCase();
        const itemStatus = String(w.status || 'Pending').trim().toLowerCase();
        if (exStatus === 'pending' && itemStatus !== 'pending') {
          deduplicated[matchIdx] = w;
        } else if (exStatus === itemStatus) {
          if ((!existing.reviewedBy && w.reviewedBy) || (existing.id && existing.id.length < 10 && w.id && w.id.length >= 10)) {
            deduplicated[matchIdx] = w;
          }
        }
      }
    });

    return deduplicated;
  },

  applyWfh(staffId, wfhData) {
    const db = this.load();
    const staff = db.staff.find(s => s.id === staffId);
    if (!staff) return null;

    if (!Array.isArray(db.wfhRequests)) db.wfhRequests = [];

    // Check for existing pending request for same staff and date to prevent duplicate records
    const existing = db.wfhRequests.find(w =>
      w && String(w.staffId || '').trim().toUpperCase() === String(staffId).trim().toUpperCase() &&
      w.date === wfhData.date &&
      String(w.status || 'Pending').toLowerCase() === 'pending'
    );
    if (existing) {
      if (wfhData.reason) existing.reason = wfhData.reason;
      this.save(db);
      return existing;
    }

    const newWfh = {
      id: `WFH-${Date.now()}`,
      staffId: staffId,
      staffName: staff.name,
      position: staff.position,
      photo: staff.photo || null,
      date: wfhData.date,
      reason: wfhData.reason,
      status: 'Pending',
      checkIn: '--:--',
      checkOut: '--:--',
      workingHours: '0h 00m',
      appliedDate: this.getTodayDateString()
    };

    db.wfhRequests.unshift(newWfh);

    // Notify Admin
    if (!Array.isArray(db.notifications)) db.notifications = [];
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      text: `New WFH request from ${staff.name} for ${wfhData.date}`,
      time: 'Just now',
      read: false
    });

    this.save(db);
    return newWfh;
  },

  updateWfhStatus(wfhId, newStatus, reasonOrNotes) {
    const db = this.load();
    const req = (db.wfhRequests || []).find(w => w.id === wfhId);
    if (!req) return { success: false, error: 'WFH request not found' };

    req.status = newStatus;
    req.reviewedAt = new Date().toISOString();
    req.reviewedBy = 'Administrator';

    if (newStatus === 'Rejected') {
      req.rejectionReason = (reasonOrNotes || '').trim();
    } else if (newStatus === 'Approved') {
      req.rejectionReason = null;
      db.attendance.forEach(att => {
        if (att.staffId === req.staffId && att.date === req.date && !this.isDateWeeklyOff(att.date)) {
          att.status = 'Work From Home';
          att.checkIn = '09:00 AM';
          att.checkOut = '05:00 PM';
          att.workingHours = '8h 00m';
          att.location = 'Approved Remote Work';
          att.notes = `WFH: ${req.reason}`;
        }
      });
    }

    // Clean up any lingering duplicate pending records for this staffId and date
    if (Array.isArray(db.wfhRequests)) {
      db.wfhRequests = db.wfhRequests.filter(w => {
        if (!w || w.id === req.id) return true;
        const sameStaff = String(w.staffId || '').trim().toUpperCase() === String(req.staffId || '').trim().toUpperCase();
        const sameDate = String(w.date || '').trim() === String(req.date || '').trim();
        const isPending = String(w.status || 'Pending').toLowerCase() === 'pending';
        const sameReason = String(w.reason || '').trim().toLowerCase() === String(req.reason || '').trim().toLowerCase();
        if (sameStaff && sameDate && (isPending || sameReason)) {
          return false;
        }
        return true;
      });
    }

    const notifText = newStatus === 'Rejected'
      ? `Your Work From Home request for ${req.date} was Rejected. Reason: ${req.rejectionReason || 'No reason provided'}`
      : `Your Work From Home request for ${req.date} was Approved.`;

    if (!Array.isArray(db.notifications)) db.notifications = [];
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'staff',
      staffId: req.staffId,
      title: `WFH Request ${newStatus}`,
      text: notifText,
      message: notifText,
      time: 'Just now',
      createdAt: 'Just now',
      read: false
    });

    this.save(db);
    return { success: true, message: `WFH request ${newStatus.toLowerCase()}`, data: req };
  },

  updateWFHStatus(wfhId, newStatus, reasonOrNotes) {
    return this.updateWfhStatus(wfhId, newStatus, reasonOrNotes);
  },

  // ------------------------------------------------------------------------
  // EXCEL / CSV IMPORT PARSER & VALIDATOR
  // Required Headings: Staff Name | Position | Mobile Number | Address
  // ------------------------------------------------------------------------
  validateAndImportExcel(csvText) {
    const lines = csvText.trim().split(/\r\n|\n/);
    if (lines.length < 2) {
      return { success: false, error: 'File is empty or missing data rows.' };
    }

    // Check header
    const headerCols = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const expectedHeaders = ['Staff Name', 'Position', 'Mobile Number', 'Address'];

    const isValidHeader = expectedHeaders.every(exp => 
      headerCols.some(col => col.toLowerCase() === exp.toLowerCase())
    );

    if (!isValidHeader) {
      return {
        success: false,
        error: `Invalid Excel header columns. Expected: ${expectedHeaders.join(' | ')}`
      };
    }

    const nameIdx = headerCols.findIndex(c => c.toLowerCase().includes('name'));
    const posIdx = headerCols.findIndex(c => c.toLowerCase().includes('position'));
    const mobIdx = headerCols.findIndex(c => c.toLowerCase().includes('mobile'));
    const addrIdx = headerCols.findIndex(c => c.toLowerCase().includes('address'));

    const db = this.load();
    const existingMobiles = new Set(db.staff.map(s => s.mobile.replace(/\D/g, '')));
    const existingNames = new Set(db.staff.map(s => s.name.toLowerCase()));

    const imported = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle quoted commas
      const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^["']|["']$/g, ''));

      const name = cols[nameIdx] || '';
      const position = cols[posIdx] || '';
      const mobile = cols[mobIdx] || '';
      const address = cols[addrIdx] || '';

      // Validation Rules
      if (!name || !position || !mobile || !address) {
        errors.push({ row: i + 1, data: name || 'Empty', error: 'Missing mandatory fields' });
        continue;
      }

      const cleanMob = mobile.replace(/\D/g, '');
      if (cleanMob.length < 7) {
        errors.push({ row: i + 1, data: name, error: `Invalid mobile number: ${mobile}` });
        continue;
      }

      // Duplicate Check
      if (existingMobiles.has(cleanMob) || existingNames.has(name.toLowerCase())) {
        errors.push({ row: i + 1, data: name, error: `Duplicate staff detected: ${name} (${mobile})` });
        continue;
      }

      existingMobiles.add(cleanMob);
      existingNames.add(name.toLowerCase());

      const emailUsername = name.toLowerCase().replace(/[^a-z0-9]/g, '.') + '@workpulse.com';

      imported.push({
        name,
        position,
        mobile,
        address,
        email: emailUsername,
        password: 'password123',
        status: 'Active',
        joiningDate: new Date().toISOString().split('T')[0]
      });
    }

    // Commit imported staff
    imported.forEach(s => {
      this.addStaff(s);
    });

    return {
      success: true,
      importedCount: imported.length,
      failedCount: errors.length,
      errors: errors,
      importedRecords: imported
    };
  },

  // Resets database back to pristine initial clean state
  clearDemoData() {
    const db = this.load();
    db.attendance = [];
    db.leaves = [];
    db.wfhRequests = [];
    db.notifications = [];
    db.tasks = [];
    db.dailyReports = [];
    db.meetings = [];
    db.projects = [];
    db.leads = [];
    db.generalRequests = [];
    db.officeAssets = [];
    db.maintenanceIssues = [];
    db.internalNotes = [];
    db.generalDocuments = [];
    // Only preserve genuine client records (e.g. ASWIN / UNIK)
    db.clients = (db.clients || []).filter(c => c.id === 'CLI-1793251535683' || (c.company && c.company.toUpperCase() === 'UNIK'));
    this.save(db);
    return db;
  },

  resetDatabase() {
    const current = this.load();
    const preservedAdmin = current.admin || getInitialDatabase().admin;
    const preservedSettings = current.settings || getInitialDatabase().settings;
    const genuineClients = (current.clients || []).filter(c => c.id === 'CLI-1793251535683' || (c.company && c.company.toUpperCase() === 'UNIK'));
    localStorage.removeItem(WP_STORAGE_KEY);
    const fresh = getInitialDatabase();
    fresh.admin = preservedAdmin;
    fresh.settings = preservedSettings;
    fresh.clients = genuineClients;
    this.save(fresh);
    return fresh;
  },

  getSettings() {
    const db = this.load();
    if (!db.settings || typeof db.settings !== 'object') {
      db.settings = getInitialDatabase().settings;
      this.save(db);
    }
    if (typeof db.settings.systemInactivityTimeoutMinutes !== 'number' || db.settings.systemInactivityTimeoutMinutes <= 0) {
      db.settings.systemInactivityTimeoutMinutes = 15;
    }
    if (typeof db.settings.tabInactivityTimeoutMinutes !== 'number' || db.settings.tabInactivityTimeoutMinutes <= 0) {
      db.settings.tabInactivityTimeoutMinutes = 60;
    }
    return db.settings;
  },

  updateSettings(newSettings) {
    const db = this.load();
    db.settings = { ...db.settings, ...newSettings };
    this.save(db);
    return db.settings;
  },

  // Generates real downloadable Excel template with standard columns
  generateExcelTemplateCSV() {
    return this.generateBlankTemplateCSV();
  },

  generateFilledSampleCSV() {
    return this.generateBlankTemplateCSV();
  },

  generateBlankTemplateCSV() {
    return 'Staff Name,Position,Mobile Number,Address\r\n';
  },

  // ------------------------------------------------------------------------
  // 9. PROJECTS & WORK MANAGEMENT ENGINE
  // ------------------------------------------------------------------------

  // --- PROJECTS MANAGEMENT ---
  getProjects(filters = {}) {
    const db = this.load();
    let rawProjects = Array.isArray(db.projects) ? db.projects : [];

    // Enforce strict deduplication: exactly one card per project (by unique ID and normalized name)
    const seenIds = new Set();
    const seenNames = new Set();
    let projects = [];

    for (const p of rawProjects) {
      if (!p || !p.id) continue;
      const normName = (p.name || p.title || '').trim().toLowerCase();
      if (seenIds.has(p.id) || (normName && seenNames.has(normName))) {
        continue;
      }
      seenIds.add(p.id);
      if (normName) seenNames.add(normName);
      projects.push(p);
    }

    if (filters.staffId && filters.staffId !== 'all') {
      projects = projects.filter(p => {
        const ids = Array.isArray(p.assignedStaffIds) ? p.assignedStaffIds : [p.assignedStaffId];
        return ids.includes(filters.staffId) || ids.includes('all') || p.assignedStaffId === filters.staffId || p.assignedStaffId === 'all';
      });
    }
    if (filters.status && filters.status !== 'all' && filters.status !== 'All') {
      projects = projects.filter(p => p.status === filters.status);
    }
    if (filters.priority && filters.priority !== 'all' && filters.priority !== 'All') {
      projects = projects.filter(p => p.priority === filters.priority);
    }
    if (filters.date) {
      projects = projects.filter(p => (!p.startDate || p.startDate <= filters.date) && (!p.dueDate || p.dueDate >= filters.date));
    }
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      projects = projects.filter(p => (p.name && p.name.toLowerCase().includes(q)) || (p.description && p.description.toLowerCase().includes(q)));
    }
    return projects;
  },

  getProjectById(projectId) {
    const db = this.load();
    return (db.projects || []).find(p => p.id === projectId) || null;
  },

  addProject(projectData, author = null) {
    const db = this.load();
    if (!Array.isArray(db.projects)) db.projects = [];

    const projectName = (projectData.name || projectData.projectName || '').trim() || 'Untitled Project';
    const normName = projectName.toLowerCase();

    // Prevent duplicate project card creation: check for existing project with same name
    const existing = db.projects.find(p => (p.name || '').trim().toLowerCase() === normName);
    if (existing) {
      // Update existing project instead of adding a duplicate card
      return this.updateProject(existing.id, projectData, author);
    }

    const id = `PRJ-${Date.now()}`;
    const rawIds = Array.isArray(projectData.assignedStaffIds) 
      ? projectData.assignedStaffIds 
      : (projectData.assignedStaffId ? [projectData.assignedStaffId] : ['all']);
    const assignedStaffIds = rawIds.filter(Boolean);
    const assignedStaffNames = assignedStaffIds.map(sid => {
      if (sid === 'all') return 'All Staff Members';
      const s = (db.staff || []).find(st => st.id === sid);
      return s ? s.name : sid;
    });

    const newProject = {
      id,
      name: projectName,
      description: (projectData.description || '').trim(),
      startDate: projectData.startDate || new Date().toISOString().split('T')[0],
      dueDate: projectData.dueDate || '',
      priority: projectData.priority || 'Medium', // Low, Medium, High, Urgent
      status: projectData.status || 'To Do', // Backlog, To Do, In Progress, In Review, Completed, On Hold
      assignedStaffIds: assignedStaffIds.length ? assignedStaffIds : ['all'],
      assignedStaffNames,
      createdBy: author?.name || projectData.createdBy || 'Administrator',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: Array.isArray(projectData.comments) ? projectData.comments : [
        {
          id: `CMT-${Date.now()}-1`,
          author: author?.name || 'Administrator',
          authorRole: author?.role || 'admin',
          text: 'Project initialized and registered in WorkPulse.',
          createdAt: new Date().toISOString()
        }
      ],
      attachments: Array.isArray(projectData.attachments) ? projectData.attachments : [],
      reviewHistory: Array.isArray(projectData.reviewHistory) ? projectData.reviewHistory : [
        {
          id: `REV-${Date.now()}-1`,
          date: new Date().toISOString().split('T')[0],
          reviewer: author?.name || 'Administrator',
          decision: 'Approved',
          notes: 'Project created and initialized.',
          timestamp: new Date().toISOString()
        }
      ]
    };

    db.projects.unshift(newProject);

    // Notify assigned staff
    if (!Array.isArray(db.notifications)) db.notifications = [];
    assignedStaffIds.forEach(sid => {
      if (sid === 'all') {
        (db.staff || []).forEach(s => {
          db.notifications.unshift({
            id: `N-${Date.now()}-${s.id}`,
            role: 'staff',
            staffId: s.id,
            title: 'New Project Assigned',
            message: `You were assigned to project: "${newProject.name}" (Due: ${newProject.dueDate || 'Ongoing'})`,
            text: `You were assigned to project: "${newProject.name}"`,
            createdAt: 'Just now',
            time: 'Just now',
            read: false
          });
        });
      } else {
        db.notifications.unshift({
          id: `N-${Date.now()}-${sid}`,
          role: 'staff',
          staffId: sid,
          title: 'New Project Assigned',
          message: `You were assigned to project: "${newProject.name}" (Due: ${newProject.dueDate || 'Ongoing'})`,
          text: `You were assigned to project: "${newProject.name}"`,
          createdAt: 'Just now',
          time: 'Just now',
          read: false
        });
      }
    });

    this.save(db);
    return newProject;
  },

  updateProject(projectId, updateData, author = null) {
    const db = this.load();
    const project = (db.projects || []).find(p => p.id === projectId);
    if (!project) return null;

    const oldStatus = project.status;

    if (updateData.name !== undefined) project.name = updateData.name.trim();
    if (updateData.description !== undefined) project.description = updateData.description.trim();
    if (updateData.startDate !== undefined) project.startDate = updateData.startDate;
    if (updateData.dueDate !== undefined) project.dueDate = updateData.dueDate;
    if (updateData.priority !== undefined) project.priority = updateData.priority;
    if (updateData.status !== undefined) project.status = updateData.status;
    if (updateData.assignedStaffIds !== undefined) {
      project.assignedStaffIds = Array.isArray(updateData.assignedStaffIds) ? updateData.assignedStaffIds : [updateData.assignedStaffIds];
      project.assignedStaffNames = project.assignedStaffIds.map(sid => {
        if (sid === 'all') return 'All Staff Members';
        const s = (db.staff || []).find(st => st.id === sid);
        return s ? s.name : sid;
      });
    }

    if (!Array.isArray(project.comments)) project.comments = [];
    if (!Array.isArray(project.attachments)) project.attachments = [];
    if (!Array.isArray(project.reviewHistory)) project.reviewHistory = [];

    // Log review history if status changed
    if (updateData.status !== undefined && updateData.status !== oldStatus) {
      project.reviewHistory.unshift({
        id: `REV-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        reviewer: author?.name || 'Administrator',
        decision: `Status: ${updateData.status}`,
        notes: `Project status updated from "${oldStatus}" to "${updateData.status}".`,
        timestamp: new Date().toISOString()
      });
    }

    project.updatedAt = new Date().toISOString();
    this.save(db);
    return project;
  },

  deleteProject(projectId) {
    const db = this.load();
    db.projects = (db.projects || []).filter(p => p.id !== projectId);
    (db.tasks || []).forEach(t => {
      if (t.projectId === projectId) {
        t.projectId = null;
        t.projectName = '';
      }
    });
    this.save(db);
    return true;
  },

  addProjectComment(projectId, commentText, author = null) {
    const db = this.load();
    const project = (db.projects || []).find(p => p.id === projectId);
    if (!project) return null;

    if (!Array.isArray(project.comments)) project.comments = [];

    const newComment = {
      id: `CMT-${Date.now()}`,
      author: author?.name || 'Administrator',
      authorRole: author?.role || (author?.id?.startsWith('WP-1') ? 'staff' : 'admin'),
      text: (commentText || '').trim(),
      createdAt: new Date().toISOString()
    };

    project.comments.unshift(newComment);
    project.updatedAt = new Date().toISOString();
    this.save(db);
    return newComment;
  },

  addProjectAttachment(projectId, attachmentData, author = null) {
    const db = this.load();
    const project = (db.projects || []).find(p => p.id === projectId);
    if (!project) return null;

    if (!Array.isArray(project.attachments)) project.attachments = [];

    const newAttachment = {
      id: `ATT-${Date.now()}`,
      name: attachmentData.name || 'document.pdf',
      size: attachmentData.size || '1.0 MB',
      url: attachmentData.url || '#',
      uploadedBy: author?.name || 'Administrator',
      uploadedAt: new Date().toISOString()
    };

    project.attachments.unshift(newAttachment);
    project.updatedAt = new Date().toISOString();
    this.save(db);
    return newAttachment;
  },

  addProjectReview(projectId, reviewData, author = null) {
    const db = this.load();
    const project = (db.projects || []).find(p => p.id === projectId);
    if (!project) return null;

    if (!Array.isArray(project.reviewHistory)) project.reviewHistory = [];

    const newReview = {
      id: `REV-${Date.now()}`,
      date: reviewData.date || new Date().toISOString().split('T')[0],
      reviewer: author?.name || 'Administrator',
      decision: reviewData.decision || 'Reviewed',
      notes: reviewData.notes || '',
      timestamp: new Date().toISOString()
    };

    project.reviewHistory.unshift(newReview);
    project.updatedAt = new Date().toISOString();
    this.save(db);
    return newReview;
  },

  getProjectProgress(projectId) {
    const db = this.load();
    const tasks = (db.tasks || []).filter(t => t.projectId === projectId);
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'Completed').length;
    const inProgress = tasks.filter(t => t.status === 'In Progress').length;
    const inReview = tasks.filter(t => t.status === 'In Review').length;

    let subtasksCount = 0;
    let completedSubtasks = 0;
    tasks.forEach(t => {
      if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
        subtasksCount += t.subtasks.length;
        completedSubtasks += t.subtasks.filter(s => s.completed).length;
      }
    });

    let percent = 0;
    if (total > 0) {
      if (subtasksCount > 0) {
        // Blended calculation: 60% task completion + 40% subtask completion
        const taskRatio = completed / total;
        const subtaskRatio = completedSubtasks / subtasksCount;
        percent = Math.round(((taskRatio * 0.6) + (subtaskRatio * 0.4)) * 100);
      } else {
        percent = Math.round((completed / total) * 100);
      }
    }

    return {
      total,
      totalTasks: total,
      completed,
      completedTasks: completed,
      inProgress,
      inReview,
      percent,
      percentage: percent,
      subtasksCount,
      completedSubtasks
    };
  },

  // --- TASKS MANAGEMENT ---
  getTasks(filters = {}) {
    const db = this.load();
    let tasks = db.tasks || [];

    if (filters.staffId && filters.staffId !== 'all') {
      tasks = tasks.filter(t => {
        const ids = Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds : [t.assignedStaffId];
        return ids.includes(filters.staffId) || ids.includes('all') || t.assignedStaffId === filters.staffId || t.assignedStaffId === 'all';
      });
    }
    if (filters.projectId && filters.projectId !== 'all') {
      tasks = tasks.filter(t => t.projectId === filters.projectId);
    }
    if (filters.status && filters.status !== 'all' && filters.status !== 'All') {
      tasks = tasks.filter(t => t.status === filters.status);
    }
    if (filters.priority && filters.priority !== 'all' && filters.priority !== 'All') {
      tasks = tasks.filter(t => t.priority === filters.priority);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      tasks = tasks.filter(t => (t.title && t.title.toLowerCase().includes(q)) || (t.description && t.description.toLowerCase().includes(q)));
    }
    return tasks;
  },

  getTaskById(taskId) {
    const db = this.load();
    return (db.tasks || []).find(t => t.id === taskId) || null;
  },

  assignTask(taskData, author = null) {
    return this.addTask(taskData, author);
  },

  upsertTask(task) {
    if (!task || !task.id) return null;
    const db = this.load();
    if (!Array.isArray(db.tasks)) db.tasks = [];

    const idx = db.tasks.findIndex(t => t.id === task.id);
    if (idx >= 0) {
      db.tasks[idx] = { ...db.tasks[idx], ...task };
    } else {
      // Check if a near-identical task was created in the last 15 seconds
      const normTitle = (task.title || '').trim().toLowerCase();
      const projId = task.projectId || null;
      const dupIdx = db.tasks.findIndex(t => {
        const tTitle = (t.title || '').trim().toLowerCase();
        const tProj = t.projectId || null;
        if (tTitle === normTitle && tProj === projId) {
          const createdTime = new Date(t.createdAt || 0).getTime() || parseInt((t.id || '').split('-')[1] || '0', 10);
          if (createdTime && Math.abs(Date.now() - createdTime) < 15000) {
            return true;
          }
        }
        return false;
      });

      if (dupIdx >= 0) {
        db.tasks[dupIdx] = { ...db.tasks[dupIdx], ...task };
      } else {
        db.tasks.unshift(task);
      }
    }

    this.save(db, true);
    return task;
  },

  addTask(taskData, author = null) {
    const db = this.load();
    if (!Array.isArray(db.tasks)) db.tasks = [];

    // 1. If taskData already has an ID and exists in database, update it
    if (taskData.id) {
      const existing = db.tasks.find(t => t.id === taskData.id);
      if (existing) {
        return this.updateTask(taskData.id, taskData, author);
      }
    }

    // 2. Prevent duplicate task creation:
    // If a task with the exact same title and projectId was created in the last 15 seconds, return it
    const normTitle = (taskData.title || '').trim().toLowerCase();
    const projId = taskData.projectId || null;
    if (normTitle) {
      const existingRecent = db.tasks.find(t => {
        const tTitle = (t.title || '').trim().toLowerCase();
        const tProj = t.projectId || null;
        if (tTitle === normTitle && tProj === projId) {
          const createdTime = new Date(t.createdAt || 0).getTime() || parseInt((t.id || '').split('-')[1] || '0', 10);
          if (createdTime && Math.abs(Date.now() - createdTime) < 15000) {
            return true;
          }
        }
        return false;
      });
      if (existingRecent) {
        return existingRecent;
      }
    }

    // 3. Unique Task ID generation
    const id = taskData.id || `TSK-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const rawIds = Array.isArray(taskData.assignedStaffIds) 
      ? taskData.assignedStaffIds 
      : (taskData.assignedStaffId ? [taskData.assignedStaffId] : ['all']);
    const assignedStaffIds = rawIds.filter(Boolean);
    const primaryStaffId = assignedStaffIds[0] || 'all';

    let assignedStaffName = 'All Staff Members';
    if (!assignedStaffIds.includes('all')) {
      const names = assignedStaffIds.map(sid => {
        const s = (db.staff || []).find(st => st.id === sid);
        return s ? s.name : sid;
      });
      assignedStaffName = names.join(', ') || 'Unassigned Staff';
    }

    let projectName = taskData.projectName || '';
    if (taskData.projectId) {
      const p = (db.projects || []).find(prj => prj.id === taskData.projectId);
      if (p) projectName = p.name;
    }

    const authorName = author?.name || (author?.role === 'staff' ? author.name : 'Administrator');
    const authorId = author?.id || (author?.role === 'staff' ? author.id : 'WP-ADMIN');

    const newTask = {
      id,
      projectId: taskData.projectId || null,
      projectName,
      title: (taskData.title || '').trim() || 'Untitled Task',
      description: (taskData.description || '').trim(),
      assignedStaffId: primaryStaffId,
      assignedStaffIds: assignedStaffIds.length ? assignedStaffIds : ['all'],
      assignedStaffName,
      startDate: taskData.startDate || new Date().toISOString().split('T')[0],
      assignedDate: taskData.assignedDate || taskData.startDate || new Date().toISOString().split('T')[0],
      dueDate: taskData.dueDate || '',
      priority: taskData.priority || 'Medium', // Low, Medium, High, Urgent
      status: taskData.status || 'To Do', // Backlog, To Do, In Progress, In Review, Completed, On Hold
      file: taskData.file || null,
      attachments: Array.isArray(taskData.attachments) ? taskData.attachments : (taskData.file ? [taskData.file] : []),
      subtasks: Array.isArray(taskData.subtasks) ? taskData.subtasks : [],
      comments: [],
      activity: [
        {
          id: `ACT-${Date.now()}`,
          action: 'created',
          details: `Task created with status "${taskData.status || 'To Do'}" and priority "${taskData.priority || 'Medium'}"`,
          authorId,
          authorName,
          createdAt: new Date().toISOString()
        }
      ],
      review: null,
      submissions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!Array.isArray(db.tasks)) db.tasks = [];
    db.tasks.unshift(newTask);

    // Notify assigned staff
    if (!Array.isArray(db.notifications)) db.notifications = [];
    assignedStaffIds.forEach(sid => {
      if (sid === 'all') {
        (db.staff || []).forEach(s => {
          db.notifications.unshift({
            id: `N-${Date.now()}-${s.id}`,
            role: 'staff',
            staffId: s.id,
            title: 'New Task Assigned',
            message: `Task assigned: "${newTask.title}" (Priority: ${newTask.priority}, Due: ${newTask.dueDate || 'Ongoing'})`,
            text: `Task assigned: "${newTask.title}"`,
            createdAt: 'Just now',
            time: 'Just now',
            read: false
          });
        });
      } else {
        db.notifications.unshift({
          id: `N-${Date.now()}-${sid}`,
          role: 'staff',
          staffId: sid,
          title: 'New Task Assigned',
          message: `Task assigned: "${newTask.title}" (Priority: ${newTask.priority}, Due: ${newTask.dueDate || 'Ongoing'})`,
          text: `Task assigned: "${newTask.title}"`,
          createdAt: 'Just now',
          time: 'Just now',
          read: false
        });
      }
    });

    this.save(db);
    return newTask;
  },

  updateTask(taskId, updateData, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task) return null;

    const authorName = author?.name || (author?.role === 'staff' ? author.name : 'Administrator');
    const authorId = author?.id || (author?.role === 'staff' ? author.id : 'WP-ADMIN');
    if (!Array.isArray(task.activity)) task.activity = [];

    const changes = [];
    if (updateData.title !== undefined && updateData.title !== task.title) {
      changes.push(`Title changed to "${updateData.title}"`);
      task.title = updateData.title.trim();
    }
    if (updateData.description !== undefined && updateData.description !== task.description) {
      changes.push(`Description updated`);
      task.description = updateData.description.trim();
    }
    if (updateData.projectId !== undefined && updateData.projectId !== task.projectId) {
      task.projectId = updateData.projectId;
      const prj = (db.projects || []).find(p => p.id === task.projectId);
      task.projectName = prj ? prj.name : '';
      changes.push(`Assigned to project "${task.projectName || 'None'}"`);
    }
    if (updateData.priority !== undefined && updateData.priority !== task.priority) {
      changes.push(`Priority changed from "${task.priority}" to "${updateData.priority}"`);
      task.priority = updateData.priority;
    }
    if (updateData.dueDate !== undefined && updateData.dueDate !== task.dueDate) {
      changes.push(`Due date set to ${updateData.dueDate || 'None'}`);
      task.dueDate = updateData.dueDate;
    }
    if (updateData.startDate !== undefined && updateData.startDate !== task.startDate) {
      changes.push(`Start date set to ${updateData.startDate || 'None'}`);
      task.startDate = updateData.startDate;
    }
    if (updateData.status !== undefined && updateData.status !== task.status) {
      changes.push(`Status changed from "${task.status}" to "${updateData.status}"`);
      task.status = updateData.status;
    }
    if (updateData.assignedStaffIds !== undefined) {
      task.assignedStaffIds = Array.isArray(updateData.assignedStaffIds) ? updateData.assignedStaffIds : [updateData.assignedStaffIds];
      task.assignedStaffId = task.assignedStaffIds[0] || 'all';
      if (task.assignedStaffIds.includes('all')) {
        task.assignedStaffName = 'All Staff Members';
      } else {
        const names = task.assignedStaffIds.map(sid => {
          const s = (db.staff || []).find(st => st.id === sid);
          return s ? s.name : sid;
        });
        task.assignedStaffName = names.join(', ') || 'Unassigned Staff';
      }
      changes.push(`Assigned staff updated to ${task.assignedStaffName}`);
    }
    if (Array.isArray(updateData.attachments)) {
      task.attachments = updateData.attachments;
    }

    if (changes.length > 0) {
      task.activity.unshift({
        id: `ACT-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        action: 'updated',
        details: changes.join('; '),
        authorId,
        authorName,
        createdAt: new Date().toISOString()
      });
    }

    task.updatedAt = new Date().toISOString();
    this.save(db);
    return task;
  },

  updateTaskStatus(taskId, newStatus, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task) return null;

    const oldStatus = task.status;
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();

    const authorName = author?.name || (typeof author === 'string' && author === 'admin' ? 'Administrator' : (typeof author === 'string' ? author : 'Staff'));
    const authorId = author?.id || (author === 'admin' ? 'WP-ADMIN' : 'USER');

    if (!Array.isArray(task.activity)) task.activity = [];
    task.activity.unshift({
      id: `ACT-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      action: 'status_change',
      details: `Status changed from "${oldStatus}" to "${newStatus}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    if (!Array.isArray(db.notifications)) db.notifications = [];
    if (authorId === 'WP-ADMIN' || author === 'admin') {
      const staffIds = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      staffIds.forEach(sid => {
        if (sid && sid !== 'all') {
          db.notifications.unshift({
            id: `N-${Date.now()}-${sid}`,
            role: 'staff',
            staffId: sid,
            title: 'Task Status Updated',
            message: `Admin updated task "${task.title}" status to "${newStatus}"`,
            text: `Task "${task.title}" status updated to "${newStatus}"`,
            createdAt: 'Just now',
            time: 'Just now',
            read: false
          });
        }
      });
    } else {
      db.notifications.unshift({
        id: `N-${Date.now()}`,
        role: 'admin',
        title: 'Task Status Updated',
        message: `${authorName} updated task "${task.title}" to "${newStatus}"`,
        text: `${authorName} marked task "${task.title}" as "${newStatus}"`,
        createdAt: 'Just now',
        time: 'Just now',
        read: false
      });
    }

    this.save(db);
    return task;
  },

  // Sync progress for parent task and parent project
  syncTaskAndProjectProgress(task, db) {
    if (!task) return;

    // 1. Calculate parent task progress automatically based on subtasks
    if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
      const total = task.subtasks.length;
      const completedSubs = task.subtasks.filter(s => s.completed || s.status === 'Completed').length;

      let sumProgress = 0;
      task.subtasks.forEach(s => {
        if (s.completed || s.status === 'Completed') {
          sumProgress += 100;
        } else {
          sumProgress += (Number(s.progress) || 0);
        }
      });
      task.progress = Math.round(sumProgress / total);

      // Status updates based on subtask completion
      if (completedSubs === total && total > 0) {
        task.status = 'Completed';
      } else if (completedSubs > 0 && task.status === 'Completed') {
        task.status = 'In Progress';
      } else if (completedSubs > 0 && task.status === 'To Do') {
        task.status = 'In Progress';
      } else if (completedSubs === 0 && task.status === 'Completed') {
        task.status = (task.progress > 0) ? 'In Progress' : 'To Do';
      }
    } else {
      if (task.status === 'Completed') {
        task.progress = 100;
      } else if (task.status === 'In Progress') {
        task.progress = task.progress || 50;
      } else {
        task.progress = task.progress || 0;
      }
    }

    // 2. Update overall project progress based on task & subtask completion
    if (task.projectId) {
      const project = (db.projects || []).find(p => p.id === task.projectId);
      if (project) {
        const prog = this.getProjectProgress(task.projectId, db);
        project.progress = prog.percentage;
        if (prog.totalTasks > 0 && prog.completedTasks === prog.totalTasks) {
          project.status = 'Completed';
        } else if (prog.completedTasks > 0 && project.status === 'To Do') {
          project.status = 'In Progress';
        }
        project.updatedAt = new Date().toISOString();
      }
    }
  },

  // Subtasks management (unlimited subtasks per task with full rich metadata)
  addSubtask(taskId, subtaskData, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task) return null;

    if (!Array.isArray(task.subtasks)) task.subtasks = [];
    const isString = typeof subtaskData === 'string';
    const title = isString ? subtaskData : (subtaskData?.title || '');
    const description = isString ? '' : (subtaskData?.description || '');
    const assignedStaffId = isString ? null : (subtaskData?.assignedStaffId || null);

    let assignedStaffName = isString ? '' : (subtaskData?.assignedStaffName || '');
    if (!assignedStaffName && assignedStaffId) {
      if (assignedStaffId === 'all') {
        assignedStaffName = 'All Staff';
      } else {
        const sObj = (db.staff || []).find(s => s.id === assignedStaffId);
        assignedStaffName = sObj ? sObj.name : assignedStaffId;
      }
    }

    const startDate = isString ? new Date().toISOString().split('T')[0] : (subtaskData?.startDate || new Date().toISOString().split('T')[0]);
    const dueDate = isString ? (task.dueDate || '') : (subtaskData?.dueDate || task.dueDate || '');
    const priority = isString ? 'Medium' : (subtaskData?.priority || 'Medium');
    const status = isString ? 'To Do' : (subtaskData?.status || 'To Do');
    const isCompleted = status === 'Completed' || (subtaskData && subtaskData.completed === true);
    const progress = isCompleted ? 100 : (Number(subtaskData?.progress) || 0);

    // Guard against duplicate subtask creation
    if (!isString && subtaskData?.id) {
      const existingSub = task.subtasks.find(s => s.id === subtaskData.id);
      if (existingSub) {
        return { success: true, task, subtask: existingSub };
      }
    }
    const normSubTitle = (title || '').trim().toLowerCase();
    if (normSubTitle) {
      const existingRecent = task.subtasks.find(s => {
        if ((s.title || '').trim().toLowerCase() === normSubTitle) {
          const sTime = new Date(s.createdAt || 0).getTime() || parseInt((s.id || '').split('-')[1] || '0', 10);
          if (sTime && Math.abs(Date.now() - sTime) < 15000) return true;
        }
        return false;
      });
      if (existingRecent) {
        return { success: true, task, subtask: existingRecent };
      }
    }

    const subtaskId = (!isString && subtaskData?.id) 
      ? subtaskData.id 
      : `SUB-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const subtask = {
      id: subtaskId,
      title: (title || '').trim(),
      description: (description || '').trim(),
      assignedStaffId: assignedStaffId || null,
      assignedStaffName: assignedStaffName || '',
      startDate,
      dueDate,
      priority,
      status: isCompleted ? 'Completed' : status,
      completed: isCompleted,
      progress,
      comments: Array.isArray(subtaskData?.comments) ? subtaskData.comments : [],
      attachments: Array.isArray(subtaskData?.attachments) ? subtaskData.attachments : [],
      activity: [],
      reviewHistory: [],
      createdAt: new Date().toISOString(),
      completedAt: isCompleted ? new Date().toISOString() : null
    };

    const authorName = (typeof author === 'string' ? author : author?.name) || 'User';
    const authorId = (typeof author === 'object' ? author?.id : null) || 'WP-USER';

    subtask.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'subtask_created',
      details: `Created subtask: "${subtask.title}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    task.subtasks.push(subtask);

    if (!Array.isArray(task.activity)) task.activity = [];
    task.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'subtask_added',
      details: `Added subtask: "${subtask.title}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    this.syncTaskAndProjectProgress(task, db);
    this.save(db);
    return { task, subtask };
  },

  updateSubtask(taskId, subtaskId, updateData, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return null;

    const sub = task.subtasks.find(s => s.id === subtaskId);
    if (!sub) return null;

    if (updateData.title !== undefined) sub.title = String(updateData.title).trim();
    if (updateData.description !== undefined) sub.description = String(updateData.description).trim();
    if (updateData.assignedStaffId !== undefined) {
      sub.assignedStaffId = updateData.assignedStaffId || null;
      if (updateData.assignedStaffName) {
        sub.assignedStaffName = updateData.assignedStaffName;
      } else if (sub.assignedStaffId === 'all') {
        sub.assignedStaffName = 'All Staff';
      } else if (sub.assignedStaffId) {
        const sObj = (db.staff || []).find(s => s.id === sub.assignedStaffId);
        sub.assignedStaffName = sObj ? sObj.name : sub.assignedStaffId;
      } else {
        sub.assignedStaffName = '';
      }
    }
    if (updateData.startDate !== undefined) sub.startDate = updateData.startDate;
    if (updateData.dueDate !== undefined) sub.dueDate = updateData.dueDate;
    if (updateData.priority !== undefined) sub.priority = updateData.priority;

    if (updateData.progress !== undefined) {
      sub.progress = Math.max(0, Math.min(100, Number(updateData.progress) || 0));
      if (sub.progress === 100) {
        sub.completed = true;
        sub.status = 'Completed';
        if (!sub.completedAt) sub.completedAt = new Date().toISOString();
      } else if (sub.status === 'Completed' && sub.progress < 100) {
        sub.completed = false;
        sub.status = 'In Progress';
        sub.completedAt = null;
      }
    }

    if (updateData.status !== undefined) {
      sub.status = updateData.status;
      if (sub.status === 'Completed') {
        sub.completed = true;
        sub.progress = 100;
        if (!sub.completedAt) sub.completedAt = new Date().toISOString();
      } else if (sub.completed && sub.status !== 'Completed') {
        sub.completed = false;
        if (sub.progress === 100) sub.progress = 75;
        sub.completedAt = null;
      }
    }

    if (updateData.completed !== undefined) {
      sub.completed = !!updateData.completed;
      if (sub.completed) {
        sub.status = 'Completed';
        sub.progress = 100;
        sub.completedAt = new Date().toISOString();
      } else {
        if (sub.status === 'Completed') sub.status = 'In Progress';
        if (sub.progress === 100) sub.progress = 0;
        sub.completedAt = null;
      }
    }

    sub.updatedAt = new Date().toISOString();

    const authorName = (typeof author === 'string' ? author : author?.name) || 'User';
    const authorId = (typeof author === 'object' ? author?.id : null) || 'WP-USER';

    if (!Array.isArray(sub.activity)) sub.activity = [];
    sub.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'subtask_updated',
      details: `Updated subtask (${sub.status}, ${sub.progress}%)`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    if (!Array.isArray(task.activity)) task.activity = [];
    task.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'subtask_updated',
      details: `Updated subtask "${sub.title}" (${sub.status}, ${sub.progress}%)`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    this.syncTaskAndProjectProgress(task, db);
    this.save(db);
    return { task, subtask: sub };
  },

  toggleSubtask(taskId, subtaskId, completed = null, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return null;

    const sub = task.subtasks.find(s => s.id === subtaskId);
    if (!sub) return null;

    let targetCompleted = !sub.completed;
    let actualAuthor = author;
    if (typeof completed === 'boolean') {
      targetCompleted = completed;
    } else if (typeof completed === 'string' || (completed && typeof completed === 'object')) {
      actualAuthor = completed;
    }

    sub.completed = targetCompleted;
    if (sub.completed) {
      sub.status = 'Completed';
      sub.progress = 100;
      sub.completedAt = new Date().toISOString();
    } else {
      sub.status = (sub.progress > 0) ? 'In Progress' : 'To Do';
      if (sub.progress === 100) sub.progress = 0;
      sub.completedAt = null;
    }

    const authorName = (typeof actualAuthor === 'string' ? actualAuthor : actualAuthor?.name) || 'User';
    const authorId = (typeof actualAuthor === 'object' ? actualAuthor?.id : null) || 'WP-USER';

    if (!Array.isArray(sub.activity)) sub.activity = [];
    sub.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'subtask_toggle',
      details: `${sub.completed ? 'Completed' : 'Reopened'} subtask: "${sub.title}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    if (!Array.isArray(task.activity)) task.activity = [];
    task.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'subtask_toggle',
      details: `${sub.completed ? 'Completed' : 'Reopened'} subtask: "${sub.title}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    this.syncTaskAndProjectProgress(task, db);
    this.save(db);
    return { task, subtask: sub };
  },

  deleteSubtask(taskId, subtaskId, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return null;

    const sub = task.subtasks.find(s => s.id === subtaskId);
    const subTitle = sub ? sub.title : subtaskId;
    task.subtasks = task.subtasks.filter(s => s.id !== subtaskId);

    const authorName = author?.name || 'User';
    const authorId = author?.id || 'WP-ADMIN';
    if (!Array.isArray(task.activity)) task.activity = [];
    task.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'subtask_deleted',
      details: `Deleted subtask: "${subTitle}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    this.syncTaskAndProjectProgress(task, db);
    this.save(db);
    return task;
  },

  addSubtaskComment(taskId, subtaskId, commentData, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return null;

    const sub = task.subtasks.find(s => s.id === subtaskId);
    if (!sub) return null;

    if (!Array.isArray(sub.comments)) sub.comments = [];
    const authorName = author?.name || commentData.authorName || 'User';
    const authorId = author?.id || commentData.authorId || 'WP-USER';
    const authorRole = author?.role || commentData.authorRole || 'staff';

    const comment = {
      id: `CMT-SUB-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      text: (commentData.text || '').trim(),
      authorId,
      authorName,
      authorRole,
      createdAt: new Date().toISOString()
    };

    sub.comments.push(comment);

    if (!Array.isArray(sub.activity)) sub.activity = [];
    sub.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'comment_added',
      details: `Comment by ${authorName}: "${comment.text.length > 40 ? comment.text.substring(0, 37) + '...' : comment.text}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    if (!Array.isArray(task.comments)) task.comments = [];
    task.comments.push({
      id: `CMT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      text: comment.text,
      targetType: 'subtask',
      subtaskId: sub.id,
      subtaskTitle: sub.title,
      authorId,
      authorName,
      authorRole,
      createdAt: comment.createdAt
    });

    task.updatedAt = new Date().toISOString();
    this.save(db);
    return { task, subtask: sub, comment };
  },

  addSubtaskAttachment(taskId, subtaskId, attachmentData, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return null;

    const sub = task.subtasks.find(s => s.id === subtaskId);
    if (!sub) return null;

    if (!Array.isArray(sub.attachments)) sub.attachments = [];
    const authorName = author?.name || attachmentData.uploadedBy || 'User';
    const authorId = author?.id || attachmentData.uploadedById || 'WP-USER';

    const attachment = {
      id: `ATT-SUB-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      name: attachmentData.name || 'document.bin',
      size: attachmentData.size || '1.0 MB',
      url: attachmentData.url || attachmentData.dataBase64 || '#',
      uploadedBy: authorName,
      uploadedById: authorId,
      uploadedAt: new Date().toISOString()
    };

    sub.attachments.push(attachment);

    if (!Array.isArray(sub.activity)) sub.activity = [];
    sub.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'attachment_uploaded',
      details: `Attached file: "${attachment.name}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    this.save(db);
    return { task, subtask: sub, attachment };
  },

  addSubtaskReview(taskId, subtaskId, reviewData, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return null;

    const sub = task.subtasks.find(s => s.id === subtaskId);
    if (!sub) return null;

    if (!Array.isArray(sub.reviewHistory)) sub.reviewHistory = [];
    const reviewer = author?.name || reviewData.reviewer || 'Administrator';
    const reviewerId = author?.id || reviewData.reviewerId || 'WP-ADMIN';

    const review = {
      id: `REV-SUB-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      decision: reviewData.decision || 'Approved',
      notes: reviewData.notes || '',
      reviewer,
      reviewerId,
      timestamp: new Date().toISOString()
    };

    sub.reviewHistory.unshift(review);

    if (review.decision === 'Approved') {
      sub.completed = true;
      sub.status = 'Completed';
      sub.progress = 100;
      sub.completedAt = new Date().toISOString();
    } else if (review.decision === 'Changes Requested') {
      sub.completed = false;
      sub.status = 'In Progress';
      sub.completedAt = null;
    }

    if (!Array.isArray(sub.activity)) sub.activity = [];
    sub.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'subtask_reviewed',
      details: `Reviewed: ${review.decision}${review.notes ? ` ("${review.notes}")` : ''}`,
      authorId: reviewerId,
      authorName: reviewer,
      createdAt: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    this.syncTaskAndProjectProgress(task, db);
    this.save(db);
    return { task, subtask: sub, review };
  },

  getSubtaskById(taskId, subtaskId) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task || !Array.isArray(task.subtasks)) return null;
    const subtask = task.subtasks.find(s => s.id === subtaskId);
    return subtask ? { task, subtask } : null;
  },

  // Task & Subtask Comments and Discussions
  addTaskComment(taskId, commentData, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task) return null;

    if (!Array.isArray(task.comments)) task.comments = [];
    const authorName = author?.name || commentData.authorName || 'User';
    const authorId = author?.id || commentData.authorId || 'WP-ADMIN';
    const authorRole = author?.role || commentData.authorRole || 'staff';

    const comment = {
      id: `CMT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      text: (commentData.text || '').trim(),
      targetType: commentData.targetType || 'task', // 'task' or 'subtask'
      subtaskId: commentData.subtaskId || null,
      subtaskTitle: commentData.subtaskTitle || null,
      authorId,
      authorName,
      authorRole,
      createdAt: new Date().toISOString()
    };

    task.comments.push(comment);

    if (!Array.isArray(task.activity)) task.activity = [];
    const targetLabel = comment.targetType === 'subtask' ? `subtask "${comment.subtaskTitle || comment.subtaskId}"` : 'task';
    task.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'comment',
      details: `Comment added on ${targetLabel}: "${comment.text.length > 50 ? comment.text.substring(0, 47) + '...' : comment.text}"`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    this.save(db);
    return { task, comment };
  },

  // Task Review Workflows (Approve, Request Changes, Submit for Review)
  reviewTask(taskId, reviewData, author = null) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task) return null;

    const action = reviewData.action; // 'approve', 'request_changes', 'submit_review'
    const feedback = (reviewData.feedback || reviewData.comment || '').trim();
    const rating = Number(reviewData.rating) || 5;
    const authorName = author?.name || (author?.role === 'staff' ? author.name : 'Administrator');
    const authorId = author?.id || (author?.role === 'staff' ? author.id : 'WP-ADMIN');

    if (action === 'submit_review') {
      task.status = 'In Review';
      task.review = {
        status: 'Pending',
        feedback: feedback || 'Submitted for executive review',
        submittedAt: new Date().toISOString(),
        submitterId: authorId,
        submitterName: authorName
      };
    } else if (action === 'approve') {
      task.status = 'Completed';
      task.review = {
        status: 'Approved',
        feedback: feedback || 'Deliverable and execution approved.',
        rating,
        reviewedAt: new Date().toISOString(),
        reviewerId: authorId,
        reviewerName: authorName
      };
    } else if (action === 'request_changes') {
      task.status = 'In Progress';
      task.review = {
        status: 'Changes Requested',
        feedback: feedback || 'Revisions and changes requested by administrator.',
        rating: Math.min(3, rating),
        reviewedAt: new Date().toISOString(),
        reviewerId: authorId,
        reviewerName: authorName
      };
    }

    if (!Array.isArray(task.activity)) task.activity = [];
    task.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'review',
      details: `Review action: ${action.replace('_', ' ').toUpperCase()} — ${feedback || 'No notes'}`,
      authorId,
      authorName,
      createdAt: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    this.save(db);
    return task;
  },

  submitTaskDeliverable(taskId, submissionData) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task) return null;

    const staffMember = db.staff.find(s => s.id === (submissionData.staffId || task.assignedStaffId || task.staffId));
    const submission = {
      id: `SUB-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      staffId: submissionData.staffId || task.assignedStaffId || task.staffId,
      staffName: staffMember ? staffMember.name : (submissionData.staffName || task.assignedStaffName || 'Staff Member'),
      comment: (submissionData.comment || '').trim(),
      status: submissionData.status || task.status || 'In Review',
      attachments: Array.isArray(submissionData.attachments) ? submissionData.attachments : [],
      submittedAt: new Date().toISOString()
    };

    if (!Array.isArray(task.submissions)) task.submissions = [];
    task.submissions.unshift(submission);

    task.status = submissionData.status || 'In Review';
    if (!Array.isArray(task.activity)) task.activity = [];
    task.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'deliverable_submitted',
      details: `Deliverable submitted by ${submission.staffName}. Status set to "${task.status}".`,
      authorId: submission.staffId,
      authorName: submission.staffName,
      createdAt: new Date().toISOString()
    });

    // Send notification to Admin
    if (!Array.isArray(db.notifications)) db.notifications = [];
    const notifMsg = `Staff ${submission.staffName} submitted a deliverable for task "${task.title}".`;
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      title: 'Task Deliverable Submitted',
      message: notifMsg,
      text: notifMsg,
      time: 'Just now',
      createdAt: 'Just now',
      read: false
    });

    task.updatedAt = new Date().toISOString();
    this.save(db);
    return task;
  },

  reviewTaskDeliverable(taskId, reviewData) {
    const db = this.load();
    const task = (db.tasks || []).find(t => t.id === taskId);
    if (!task) return null;

    const reviewObj = {
      feedback: (reviewData.feedback || reviewData.comment || '').trim(),
      rating: Number(reviewData.rating) || 5,
      reviewedAt: new Date().toISOString(),
      reviewerName: reviewData.reviewerName || 'Administrator'
    };
    task.adminFeedback = reviewObj;

    if (Array.isArray(task.submissions) && task.submissions.length > 0) {
      const idx = (typeof reviewData.submissionIndex === 'number' && reviewData.submissionIndex >= 0 && reviewData.submissionIndex < task.submissions.length)
        ? reviewData.submissionIndex
        : 0;
      task.submissions[idx].review = reviewObj;
    }

    if (!Array.isArray(task.activity)) task.activity = [];
    task.activity.unshift({
      id: `ACT-${Date.now()}`,
      action: 'review',
      details: `Administrator feedback: "${reviewObj.feedback}" (${reviewObj.rating}★)`,
      authorId: 'WP-ADMIN',
      authorName: reviewObj.reviewerName,
      createdAt: new Date().toISOString()
    });

    // Send notification to assigned staff
    const targetStaffId = task.assignedStaffId || task.staffId;
    if (!Array.isArray(db.notifications)) db.notifications = [];
    const notifMsg = `Admin reviewed your submission for task "${task.title}": "${reviewObj.feedback}"`;
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'staff',
      staffId: targetStaffId,
      title: 'Task Deliverable Reviewed',
      message: notifMsg,
      text: notifMsg,
      time: 'Just now',
      createdAt: 'Just now',
      read: false
    });

    task.updatedAt = new Date().toISOString();
    this.save(db);
    return task;
  },

  deleteTask(taskId) {
    const db = this.load();
    db.tasks = (db.tasks || []).filter(t => t.id !== taskId);
    this.save(db);
    return true;
  },

  // ------------------------------------------------------------------------
  // DAILY WORK & PROJECT REPORTS & PERFORMANCE REVIEWS
  // ------------------------------------------------------------------------
  getDailyReports(filters = {}) {
    const db = this.load();
    let reports = db.dailyReports || [];
    if (filters.staffId && filters.staffId !== 'all') {
      reports = reports.filter(r => r.staffId === filters.staffId);
    }
    if (filters.projectId && filters.projectId !== 'all') {
      reports = reports.filter(r => r.projectId === filters.projectId || r.projectTitle === filters.projectId);
    }
    if (filters.date) {
      reports = reports.filter(r => r.date === filters.date);
    }
    if (filters.status && filters.status !== 'all') {
      const st = filters.status.toLowerCase();
      if (st === 'reviewed') {
        reports = reports.filter(r => !!r.review);
      } else if (st === 'pending') {
        reports = reports.filter(r => !r.review);
      } else {
        reports = reports.filter(r => {
          const dec = (r.review && r.review.decision) ? r.review.decision.toLowerCase() : '';
          const revSt = r.reviewStatus ? r.reviewStatus.toLowerCase() : '';
          return dec === st || revSt === st;
        });
      }
    }
    return reports;
  },

  submitDailyReport(reportData) {
    const db = this.load();
    const id = reportData.id || `REP-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const staff = (db.staff || []).find(s => s.id === reportData.staffId);
    
    // Auto-resolve task and project if taskId provided
    let taskId = reportData.taskId || null;
    let taskTitle = reportData.taskTitle || '';
    let projectId = reportData.projectId || null;
    let projectTitle = (reportData.projectTitle || '').trim();

    if (taskId && Array.isArray(db.tasks)) {
      const task = db.tasks.find(t => t.id === taskId);
      if (task) {
        if (!taskTitle) taskTitle = task.title || '';
        if (!projectId && task.projectId) projectId = task.projectId;
        if (!projectTitle && task.projectTitle) projectTitle = task.projectTitle;
      }
    }
    if (!projectTitle && reportData.project) {
      projectTitle = reportData.project;
    }
    if (!projectTitle) {
      projectTitle = 'General Project Work';
    }

    if (!Array.isArray(db.dailyReports)) db.dailyReports = [];
    const existingIndex = db.dailyReports.findIndex(r => r.id === id);

    const newReport = {
      id,
      staffId: reportData.staffId,
      staffName: staff ? staff.name : (reportData.staffName || 'Staff Member'),
      projectId,
      projectTitle,
      taskId,
      taskTitle,
      description: (reportData.description || '').trim(),
      date: reportData.date || new Date().toISOString().split('T')[0],
      workStatus: reportData.workStatus || 'Completed',
      file: reportData.file || null, // { name, size, type, dataBase64, url }
      submittedAt: reportData.submittedAt || (this.formatDisplayDate(new Date()) + ' ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })),
      review: reportData.review || null,
      reviewStatus: reportData.review ? (reportData.review.decision || 'Reviewed') : (reportData.reviewStatus || 'Pending Review')
    };

    if (existingIndex >= 0) {
      db.dailyReports[existingIndex] = { ...db.dailyReports[existingIndex], ...newReport };
    } else {
      db.dailyReports.unshift(newReport);
    }

    // Notify Admin
    if (!Array.isArray(db.notifications)) db.notifications = [];
    const notifText = `Daily work report submitted by ${newReport.staffName}: "${newReport.projectTitle}"${newReport.taskTitle ? ' (' + newReport.taskTitle + ')' : ''}`;
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'admin',
      title: 'Daily Work Report Submitted',
      message: notifText,
      text: notifText,
      createdAt: 'Just now',
      time: 'Just now',
      read: false
    });

    this.save(db);
    return newReport;
  },

  submitReportReview(reportId, reviewData) {
    const db = this.load();
    const report = (db.dailyReports || []).find(r => r.id === reportId);
    if (!report) return null;

    const feedbackText = (reviewData.feedback || reviewData.comments || '').trim();
    const decision = reviewData.decision || (reviewData.status || 'Approved');
    const rating = parseInt(reviewData.rating, 10) || 5;
    const currentAdmin = db.admin || this.getAdminProfile();
    const defaultReviewer = `${currentAdmin.name || 'Administrator'} (${currentAdmin.position || 'Executive Director'})`;
    const reviewerName = reviewData.reviewerName || reviewData.reviewedBy || defaultReviewer;
    const reviewDate = reviewData.reviewDate || new Date().toISOString().split('T')[0];
    const reviewedAt = reviewData.reviewedAt || (this.formatDisplayDate(new Date()) + ' ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }));

    report.review = {
      decision,
      status: decision,
      feedback: feedbackText,
      comments: feedbackText,
      rating,
      reviewerName,
      reviewedBy: reviewerName,
      reviewDate,
      reviewedAt
    };
    report.reviewStatus = decision;

    // If report has linked taskId, update task comments, activity log, and status
    if (report.taskId && Array.isArray(db.tasks)) {
      const task = db.tasks.find(t => t.id === report.taskId);
      if (task) {
        if (!Array.isArray(task.comments)) task.comments = [];
        task.comments.push({
          id: `CMT-${Date.now()}`,
          author: reviewerName,
          authorRole: 'Admin',
          text: `[Executive Review - ${decision} ★${rating}/5] ${feedbackText}`,
          createdAt: reviewedAt
        });
        if (!Array.isArray(task.activity)) task.activity = [];
        task.activity.push({
          id: `ACT-${Date.now()}`,
          text: `Executive evaluation: ${decision} (${rating} Stars) by ${reviewerName}`,
          timestamp: reviewedAt
        });
        if (decision === 'Approved' && task.status === 'In Review') {
          task.status = 'Completed';
        }
      }
    }

    // Notify Staff member
    if (!Array.isArray(db.notifications)) db.notifications = [];
    const notifText = `Executive Review: Your report for "${report.projectTitle}" was marked as ${decision} (${rating}/5 Stars) with feedback.`;
    db.notifications.unshift({
      id: `N-${Date.now()}`,
      role: 'staff',
      staffId: report.staffId,
      title: `Report Review: ${decision}`,
      message: notifText,
      text: notifText,
      createdAt: 'Just now',
      time: 'Just now',
      read: false
    });

    this.save(db);
    return report;
  },

  // ------------------------------------------------------------------------
  // CORPORATE MEETINGS & BRIEFINGS
  // ------------------------------------------------------------------------
  getMeetings(filters = {}) {
    const db = this.load();
    let meetings = db.meetings || [];
    if (filters.staffId) {
      meetings = meetings.filter(m => m.targetAll || m.attendees === 'all' || (Array.isArray(m.attendeeIds) && m.attendeeIds.includes(filters.staffId)) || (Array.isArray(m.attendeeStaffIds) && m.attendeeStaffIds.includes(filters.staffId)));
    }
    // Dynamically assign status so past meetings never appear as Upcoming
    meetings.forEach(m => {
      m.status = this.getMeetingDynamicStatus(m);
    });
    return meetings;
  },

  parseMeetingDateTime(dateStr, timeStr) {
    if (!dateStr) return NaN;
    const parts = dateStr.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return NaN;
    let year, month, day;
    if (parts[0] > 1000) {
      [year, month, day] = parts;
    } else {
      [day, month, year] = parts;
    }
    let hours = 0;
    let minutes = 0;
    if (timeStr) {
      const timeClean = timeStr.trim().toLowerCase();
      const isPm = timeClean.includes('pm');
      const isAm = timeClean.includes('am');
      const match = timeClean.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        hours = parseInt(match[1], 10);
        minutes = parseInt(match[2], 10);
        if (isPm && hours < 12) hours += 12;
        if (isAm && hours === 12) hours = 0;
      }
    }
    return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
  },

  getMeetingDynamicStatus(meetingOrDate, timeOrNow, optionalNow) {
    let meeting;
    let now = new Date();
    if (typeof meetingOrDate === 'string') {
      meeting = { date: meetingOrDate, time: timeOrNow };
      if (optionalNow instanceof Date) now = optionalNow;
    } else {
      meeting = meetingOrDate;
      if (timeOrNow instanceof Date) now = timeOrNow;
    }
    if (!meeting) return 'Completed';
    if (meeting.status === 'Cancelled') return 'Cancelled';

    const startMs = this.parseMeetingDateTime(meeting.date, meeting.time);
    if (isNaN(startMs)) return 'Upcoming';

    let durationMins = parseInt(meeting.durationMinutes || meeting.duration, 10);
    if (isNaN(durationMins) || durationMins <= 0) durationMins = 60;
    const endMs = startMs + (durationMins * 60 * 1000);
    const nowMs = now.getTime();

    if (nowMs < startMs) {
      return 'Upcoming';
    } else if (nowMs >= startMs && nowMs <= endMs) {
      return 'Ongoing';
    } else {
      return 'Completed';
    }
  },

  createMeeting(meetingData) {
    const db = this.load();
    const id = `MTG-${Date.now()}`;
    const title = (meetingData.title || '').trim();
    const date = meetingData.date;
    const time = (meetingData.time || '').trim();
    const venue = (meetingData.venue || meetingData.venueOrLink || '').trim();
    const description = (meetingData.description || '').trim();

    // Validate future date and time (allow 60s grace margin for slight client/server skew)
    const startMs = this.parseMeetingDateTime(date, time);
    if (isNaN(startMs) || startMs < Date.now() - 60000) {
      throw new Error('Please select a future date and time.');
    }

    const isTargetAll = meetingData.targetAll !== undefined ? !!meetingData.targetAll : (meetingData.attendees === 'all');
    const attendeeIds = isTargetAll ? db.staff.map(s => s.id) : (meetingData.attendeeStaffIds || meetingData.attendeeIds || []);
    const durationMinutes = parseInt(meetingData.durationMinutes || meetingData.duration, 10) || 60;

    const newMeeting = {
      id,
      title,
      date,
      time,
      durationMinutes,
      status: 'Upcoming',
      venue: venue,
      venueOrLink: venue,
      description,
      attendees: isTargetAll ? 'all' : 'selected',
      targetAll: isTargetAll,
      attendeeIds,
      attendeeStaffIds: attendeeIds,
      organizer: meetingData.organizer || meetingData.createdBy || `${(db.admin || this.getAdminProfile()).name || 'Administrator'} (Admin)`,
      createdBy: meetingData.organizer || meetingData.createdBy || `${(db.admin || this.getAdminProfile()).name || 'Administrator'} (Admin)`,
      createdAt: this.formatDisplayDate(new Date()) + ' ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    };

    if (!Array.isArray(db.meetings)) db.meetings = [];
    db.meetings.unshift(newMeeting);

    // Send notifications to attendees if requested
    if (meetingData.sendNotification !== false) {
      if (!Array.isArray(db.notifications)) db.notifications = [];
      const recipientIds = isTargetAll ? db.staff.map(s => s.id) : attendeeIds;
      recipientIds.forEach(staffId => {
        const notifMsg = `New meeting scheduled: "${newMeeting.title}" on ${newMeeting.date} at ${newMeeting.time}`;
        db.notifications.unshift({
          id: `N-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          role: 'staff',
          staffId,
          title: 'New Meeting Scheduled',
          message: notifMsg,
          text: notifMsg,
          createdAt: 'Just now',
          time: 'Just now',
          read: false
        });
      });
    }

    this.save(db);
    return newMeeting;
  },

  updateMeeting(meetingId, updateData) {
    const db = this.load();
    const meeting = (db.meetings || []).find(m => m.id === meetingId);
    if (!meeting) return { success: false, error: 'Meeting not found' };

    if (updateData.status === 'Cancelled') {
      meeting.status = 'Cancelled';
      this.save(db);
      return { success: true, message: 'Meeting cancelled', data: meeting };
    }

    // If updating date or time, validate future
    const newDate = updateData.date || meeting.date;
    const newTime = updateData.time || meeting.time;
    if (updateData.date || updateData.time) {
      const startMs = this.parseMeetingDateTime(newDate, newTime);
      if (isNaN(startMs) || startMs < Date.now() - 60000) {
        return { success: false, error: 'Please select a future date and time.' };
      }
    }

    Object.assign(meeting, updateData);
    this.save(db);
    return { success: true, message: 'Meeting updated', data: meeting };
  },

  deleteMeeting(meetingId) {
    const db = this.load();
    db.meetings = (db.meetings || []).filter(m => m.id !== meetingId);
    this.save(db);
    return true;
  },

  // ------------------------------------------------------------------------
  // NOTIFICATIONS
  // ------------------------------------------------------------------------
  getNotifications(filters = {}) {
    const db = this.load();
    let notifs = db.notifications || [];
    if (filters.role) {
      notifs = notifs.filter(n => n.role === filters.role);
    }
    if (filters.staffId) {
      notifs = notifs.filter(n => !n.staffId || n.staffId === 'all' || n.staffId === filters.staffId);
    }
    return notifs;
  },

  markNotificationRead(notifId) {
    const db = this.load();
    const notif = (db.notifications || []).find(n => n.id === notifId);
    if (notif) {
      notif.read = true;
      this.save(db);
    }
    return true;
  },

  markAllNotificationsRead(role, staffId = null) {
    const db = this.load();
    (db.notifications || []).forEach(n => {
      if (n.role === role) {
        if (!staffId || n.staffId === staffId) {
          n.read = true;
        }
      }
    });
    this.save(db);
    return true;
  },

  // ------------------------------------------------------------------------
  // 12. STAFF ACTIVITY STATUS & TIMELINE ENGINE
  // ------------------------------------------------------------------------
  /**
   * Returns activity metrics for all staff for a specific date
   */
  getStaffActivitySummary(dateStr) {
    if (!dateStr) dateStr = this.getTodayDateString();
    const db = this.load();
    const attendanceList = db.attendance || [];
    const staffList = this.getStaffList();
    
    const items = staffList.map(staff => {
      const att = attendanceList.find(a => a.staffId === staff.id && a.date === dateStr) || null;
      return this.computeStaffActivityMetrics(staff, att, dateStr);
    });

    const activeCount = items.filter(i => (i.currentStatus || i.activityStatus) === 'Active').length;
    const inactiveCount = items.filter(i => (i.currentStatus || i.activityStatus) === 'Inactive').length;
    const lunchCount = items.filter(i => (i.currentStatus || i.activityStatus) === 'On Lunch Break').length;
    const checkedOutCount = items.filter(i => (i.currentStatus || i.activityStatus) === 'Checked Out').length;
    const notCheckedInCount = items.filter(i => (i.currentStatus || i.activityStatus) === 'Not Checked In').length;

    // Attach properties to array so it acts as both Array and Summary Object
    items.totalStaff = staffList.length;
    items.activeCount = activeCount;
    items.inactiveCount = inactiveCount;
    items.lunchCount = lunchCount;
    items.checkedOutCount = checkedOutCount;
    items.notCheckedInCount = notCheckedInCount;
    items.items = items;

    return items;
  },

  /**
   * Computes individual activity status and metrics for a staff member
   */
  computeStaffActivityMetrics(staff, att, dateStr) {
    const todayStr = this.getTodayDateString();
    const isToday = dateStr === todayStr;

    if (!att || !att.checkIn || att.checkIn === '--:--') {
      const displayStatus = att && att.status ? att.status : 'Not Checked In';
      return {
        staff: staff,
        staffId: staff.id,
        staffName: staff.name,
        position: staff.position || 'Staff',
        photo: staff.photo || null,
        date: dateStr,
        status: displayStatus,
        currentStatus: displayStatus === 'Present' ? 'Not Checked In' : displayStatus,
        activityStatus: displayStatus === 'Present' ? 'Not Checked In' : displayStatus,
        isOnline: this.isStaffOnline(staff.id),
        lastActiveTime: '--:--',
        inactiveStartTime: '--:--',
        resumeActiveTime: '--:--',
        totalInactiveDuration: '0m',
        totalInactiveDurationFormatted: '0m',
        totalInactiveMinutes: 0,
        totalLunchDuration: '0m',
        totalLunchDurationFormatted: '0m',
        totalLunchMinutes: 0,
        currentWorkingDuration: '0h 00m',
        currentWorkingDurationFormatted: '0h 00m',
        attendance: att
      };
    }

    let activityStatus = 'Active';
    if (att.checkOut && att.checkOut !== '--:--') {
      activityStatus = 'Checked Out';
    } else if (att.shiftStatus === 'lunch') {
      activityStatus = 'On Lunch Break';
    } else if (att.shiftStatus === 'inactive') {
      activityStatus = 'Inactive';
    } else if (!isToday) {
      // Past record with no checkout recorded
      activityStatus = 'Checked Out';
    } else {
      activityStatus = 'Active';
    }

    // Inactive Start Time
    let inactiveStartTime = '--:--';
    if (att.shiftStatus === 'inactive' && att.currentInactivityStart) {
      inactiveStartTime = att.currentInactivityStart.timeStr || '--:--';
    } else if (Array.isArray(att.inactivityPeriods) && att.inactivityPeriods.length > 0) {
      inactiveStartTime = att.inactivityPeriods[att.inactivityPeriods.length - 1].startedAt || '--:--';
    }

    // Resume / Active Time (Only show genuine resumedAt timestamps; never fabricate checkIn as resume time)
    let resumeActiveTime = '--:--';
    if (att.shiftStatus === 'inactive') {
      resumeActiveTime = 'Pending Resume';
    } else if (Array.isArray(att.inactivityPeriods) && att.inactivityPeriods.length > 0) {
      resumeActiveTime = att.inactivityPeriods[att.inactivityPeriods.length - 1].resumedAt || '--:--';
    }

    // Last Active Time
    let lastActiveTime = '--:--';
    if (activityStatus === 'Active') {
      lastActiveTime = isToday ? 'Active Now' : (att.checkOut && att.checkOut !== '--:--' ? att.checkOut : att.checkIn);
    } else if (activityStatus === 'Inactive') {
      lastActiveTime = inactiveStartTime !== '--:--' ? inactiveStartTime : att.checkIn;
    } else if (activityStatus === 'On Lunch Break') {
      lastActiveTime = (att.lunchBreak && att.lunchBreak.startedAt) ? att.lunchBreak.startedAt : att.checkIn;
    } else if (activityStatus === 'Checked Out') {
      lastActiveTime = att.checkOut && att.checkOut !== '--:--' ? att.checkOut : att.checkIn;
    }

    // Inactive Duration
    const totalInactiveMin = att.totalInactiveMinutes || 0;
    const inactiveDurStr = totalInactiveMin > 0 
      ? `${totalInactiveMin}m` 
      : (att.shiftStatus === 'inactive' && att.currentInactivityStart ? 'Ongoing' : '0m');

    // Lunch Duration
    let totalLunchMin = 0;
    let lunchDurStr = '0m';
    if (att.lunchBreak) {
      if (att.lunchBreak.used || att.lunchBreak.endedAt) {
        totalLunchMin = att.lunchBreak.durationMinutes || 0;
        lunchDurStr = `${totalLunchMin}m`;
      } else if (att.shiftStatus === 'lunch') {
        lunchDurStr = `Ongoing (from ${att.lunchBreak.startedAt || '--:--'})`;
      }
    }

    // Working Duration
    let workingDurStr = att.workingHours || '0h 00m';
    if (att.checkOut && att.checkOut !== '--:--') {
      workingDurStr = att.workingHours || this.calculateHoursWorked(att.checkIn, att.checkOut, att.totalBreakMinutes || 0);
    } else if (isToday && att.checkIn && att.checkIn !== '--:--') {
      function parseMinutes(t) {
        if (!t || typeof t !== 'string') return 0;
        const parts = t.trim().split(/\s+/);
        const timeParts = parts[0].split(':');
        if (timeParts.length < 2) return 0;
        let hours = parseInt(timeParts[0], 10) || 0;
        const minutes = parseInt(timeParts[1], 10) || 0;
        if (parts.length >= 2) {
          const period = parts[1].toUpperCase();
          if (period === 'PM' && hours < 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
        }
        return hours * 60 + minutes;
      }

      const inMin = parseMinutes(att.checkIn);
      let curTimeStr = this.formatOfficeTime(new Date());

      if (att.shiftStatus === 'lunch' && att.lunchBreak && att.lunchBreak.startedAt) {
        curTimeStr = att.lunchBreak.startedAt;
      } else if (att.shiftStatus === 'inactive' && att.currentInactivityStart && att.currentInactivityStart.timeStr) {
        curTimeStr = att.currentInactivityStart.timeStr;
      }

      const endMin = parseMinutes(curTimeStr);
      const elapsedMin = Math.max(0, endMin - inMin);
      const totalDeduct = att.totalBreakMinutes || 0;
      const netMin = Math.max(0, elapsedMin - totalDeduct);
      const nh = Math.floor(netMin / 60);
      const nm = netMin % 60;
      workingDurStr = `${nh}h ${String(nm).padStart(2, '0')}m`;
    }

    return {
      staff: staff,
      staffId: staff.id,
      staffName: staff.name,
      position: staff.position || 'Staff',
      photo: staff.photo || null,
      date: dateStr,
      status: att.status || 'Present',
      currentStatus: activityStatus,
      activityStatus: activityStatus,
      isOnline: this.isStaffOnline(staff.id),
      lastActiveTime: lastActiveTime,
      inactiveStartTime: inactiveStartTime,
      resumeActiveTime: resumeActiveTime,
      totalInactiveDuration: inactiveDurStr,
      totalInactiveDurationFormatted: inactiveDurStr,
      totalInactiveMinutes: totalInactiveMin,
      totalLunchDuration: lunchDurStr,
      totalLunchDurationFormatted: lunchDurStr,
      totalLunchMinutes: totalLunchMin,
      currentWorkingDuration: workingDurStr,
      currentWorkingDurationFormatted: workingDurStr,
      attendance: att
    };
  },

  /**
   * Returns chronological daily activity timeline for a staff member on a specific date
   */
  getStaffActivityTimeline(staffId, dateStr) {
    if (!dateStr) dateStr = this.getTodayDateString();
    const db = this.load();
    const staff = (db.staff || []).find(s => s.id === staffId);
    if (!staff) return null;
    const att = (db.attendance || []).find(a => a.staffId === staffId && a.date === dateStr) || null;
    return this.buildStaffDayTimeline(staff, att, dateStr);
  },

  buildStaffDayTimeline(staff, att, dateStr) {
    if (!att || att.checkIn === '--:--') {
      const offStatus = att ? (att.status || 'No Check-In Recorded') : 'No Check-In Recorded';
      const noCheckinTimeline = [
        {
          timeRange: '--:--',
          title: offStatus === 'Sunday' ? 'Sunday (Weekly Off)' : (offStatus === 'Leave' ? 'Approved Leave' : (offStatus === 'Work From Home' ? 'Work From Home' : 'No Check-In Recorded')),
          type: 'neutral',
          icon: offStatus === 'Sunday' ? '⚪' : (offStatus === 'Leave' ? '🔴' : '⚪'),
          badgeClass: 'badge-secondary',
          duration: '',
          durationFormatted: '',
          description: `Staff member has no recorded physical check-in for ${dateStr} (${offStatus}).`
        }
      ];

      return {
        staff,
        attendance: att,
        date: dateStr,
        summary: {
          status: offStatus,
          currentStatus: offStatus === 'Present' ? 'Checked Out' : (offStatus === 'Sunday' || offStatus === 'Leave' ? offStatus : 'Checked Out'),
          checkIn: '--:--',
          checkOut: '--:--',
          workingDurationFormatted: '0h 00m',
          netWorkingHours: '0h 00m',
          workingMinutes: 0,
          totalInactiveDurationFormatted: '0m',
          totalInactiveMinutes: 0,
          totalLunchDurationFormatted: '0m',
          totalLunchMinutes: 0
        },
        slices: [],
        timeline: noCheckinTimeline,
        events: noCheckinTimeline.map(t => ({
          ...t,
          label: `${t.timeRange} — ${t.title}`,
          durationFormatted: t.duration || '',
          notes: t.description || ''
        }))
      };
    }

    const checkIn = att.checkIn;
    const checkOut = (att.checkOut && att.checkOut !== '--:--') ? att.checkOut : null;

    function toMin(str) {
      if (!str || str === '--:--' || str === 'Present') return -1;
      const parts = str.trim().split(' ');
      if (parts.length < 2) return -1;
      const hm = parts[0].split(':');
      let h = parseInt(hm[0], 10);
      const m = parseInt(hm[1], 10);
      if (parts[1].toUpperCase() === 'PM' && h < 12) h += 12;
      if (parts[1].toUpperCase() === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    }

    function formatMinDiff(m) {
      const h = Math.floor(m / 60);
      const rem = m % 60;
      if (h > 0 && rem > 0) return `${h}h ${rem}m`;
      if (h > 0) return `${h}h`;
      return `${rem}m`;
    }

    const pauses = [];

    // Lunch break
    if (att.lunchBreak && att.lunchBreak.startedAt) {
      const lStartMin = toMin(att.lunchBreak.startedAt);
      const isOngoing = !att.lunchBreak.endedAt && att.shiftStatus === 'lunch';
      const lEndMin = isOngoing ? -1 : toMin(att.lunchBreak.endedAt);
      const dur = att.lunchBreak.durationMinutes || (isOngoing ? 20 : 30);
      pauses.push({
        type: 'lunch',
        startStr: att.lunchBreak.startedAt,
        endStr: isOngoing ? 'Present' : att.lunchBreak.endedAt,
        startMin: lStartMin,
        endMin: lEndMin,
        durationMin: dur,
        isOngoing: isOngoing,
        reason: 'Official Lunch Break'
      });
    }

    // Inactivity periods
    if (Array.isArray(att.inactivityPeriods)) {
      att.inactivityPeriods.forEach(p => {
        pauses.push({
          type: 'inactive',
          startStr: p.startedAt,
          endStr: p.resumedAt,
          startMin: toMin(p.startedAt),
          endMin: toMin(p.resumedAt),
          durationMin: p.durationMinutes || 15,
          isOngoing: false,
          reason: p.reason || 'System-wide idle / tab inactive'
        });
      });
    }

    // Ongoing inactivity
    if (att.shiftStatus === 'inactive' && att.currentInactivityStart) {
      pauses.push({
        type: 'inactive',
        startStr: att.currentInactivityStart.timeStr,
        endStr: 'Present',
        startMin: toMin(att.currentInactivityStart.timeStr),
        endMin: -1,
        durationMin: Math.max(1, Math.round((Date.now() - att.currentInactivityStart.ts) / 60000)),
        isOngoing: true,
        reason: att.currentInactivityStart.reason || 'Inactivity detected'
      });
    }

    pauses.sort((a, b) => a.startMin - b.startMin);

    const timeline = [];
    const slices = [];

    // Check-in event
    timeline.push({
      timeRange: checkIn,
      title: 'Check In',
      type: 'checkin',
      icon: '📍',
      badgeClass: 'badge-primary',
      description: `Morning attendance recorded via GPS telemetry (${att.location || 'Verified Office Location'}).`
    });

    let currentStr = checkIn;
    let currentMin = toMin(checkIn);

    pauses.forEach(p => {
      if (p.startMin > currentMin) {
        const activeDur = p.startMin - currentMin;
        timeline.push({
          timeRange: `${currentStr}–${p.startStr}`,
          title: 'Active',
          type: 'active',
          icon: '🟢',
          badgeClass: 'badge-present',
          duration: formatMinDiff(activeDur),
          description: `Productive working duration (${formatMinDiff(activeDur)}). Timer active.`
        });
        slices.push({
          type: 'active',
          label: `${currentStr} - ${p.startStr}`,
          duration: activeDur,
          color: '#10B981'
        });
      }

      if (p.type === 'lunch') {
        timeline.push({
          timeRange: `${p.startStr}–${p.endStr}`,
          title: 'Lunch Break',
          type: 'lunch',
          icon: '🍱',
          badgeClass: 'badge-warning',
          duration: `${p.durationMin}m`,
          description: p.isOngoing 
            ? `Staff member is currently on official lunch break (Paused since ${p.startStr}).`
            : `Official lunch break taken (${p.durationMin}m deducted from working time).`
        });
        slices.push({
          type: 'lunch',
          label: `Lunch: ${p.startStr} - ${p.endStr}`,
          duration: p.durationMin,
          color: '#F59E0B'
        });
        if (!p.isOngoing && p.endStr) {
          timeline.push({
            timeRange: p.endStr,
            title: 'Active',
            type: 'resume',
            icon: '▶️',
            badgeClass: 'badge-present',
            description: `Returned from lunch break; working timer resumed.`
          });
          currentStr = p.endStr;
          currentMin = p.endMin;
        }
      } else {
        timeline.push({
          timeRange: `${p.startStr}–${p.endStr}`,
          title: 'Inactive',
          type: 'inactive',
          icon: '⏸️',
          badgeClass: 'badge-danger',
          duration: `${p.durationMin}m`,
          description: p.isOngoing
            ? `Timer paused due to ${p.reason}. Ongoing pause since ${p.startStr}.`
            : `Working timer paused for ${p.durationMin}m due to ${p.reason} (Excluded from working hours).`
        });
        slices.push({
          type: 'inactive',
          label: `Inactive: ${p.startStr} - ${p.endStr}`,
          duration: p.durationMin,
          color: '#EF4444'
        });
        if (!p.isOngoing && p.endStr) {
          const hasPriorResume = timeline.some(t => t.title === 'Active / Resumed');
          const resumeTitle = hasPriorResume ? 'Active' : 'Active / Resumed';
          timeline.push({
            timeRange: p.endStr,
            title: resumeTitle,
            type: 'resume',
            icon: '▶️',
            badgeClass: 'badge-present',
            description: `Staff member resumed shift; working timer continued.`
          });
          currentStr = p.endStr;
          currentMin = p.endMin;
        }
      }
    });

    if (checkOut) {
      const outMin = toMin(checkOut);
      if (outMin > currentMin) {
        const activeDur = outMin - currentMin;
        timeline.push({
          timeRange: `${currentStr}–${checkOut}`,
          title: 'Active',
          type: 'active',
          icon: '🟢',
          badgeClass: 'badge-present',
          duration: formatMinDiff(activeDur),
          description: `Productive working duration (${formatMinDiff(activeDur)}) until shift conclusion.`
        });
        slices.push({
          type: 'active',
          label: `${currentStr} - ${checkOut}`,
          duration: activeDur,
          color: '#10B981'
        });
      }
      timeline.push({
        timeRange: checkOut,
        title: 'Checked Out',
        type: 'checkout',
        icon: '🏁',
        badgeClass: 'badge-primary',
        description: `Manual shift checkout recorded at ${checkOut}. Net working duration: ${att.workingHours || 'Completed'}.`
      });
    } else {
      if (att.shiftStatus === 'active') {
        timeline.push({
          timeRange: `${currentStr}–Present`,
          title: 'Active (In Progress)',
          type: 'active',
          icon: '🟢',
          badgeClass: 'badge-present',
          duration: 'Live',
          description: `Staff member is actively working now.`
        });
      }
    }

    let effectiveLunchMin = att.lunchBreak ? (att.lunchBreak.durationMinutes || 0) : 0;
    if (att.shiftStatus === 'lunch' && att.lunchBreak && !att.lunchBreak.endedAt) {
      const ongoingLunch = att.lunchBreak.startTs ? Math.max(1, Math.round((Date.now() - att.lunchBreak.startTs) / 60000)) : 20;
      effectiveLunchMin += ongoingLunch;
    }

    let effectiveInactiveMin = att.totalInactiveMinutes || 0;
    if (att.shiftStatus === 'inactive' && att.currentInactivityStart) {
      const ongoingInact = Math.max(1, Math.round((Date.now() - att.currentInactivityStart.ts) / 60000));
      effectiveInactiveMin += ongoingInact;
    }

    // Working minutes calculation
    let calculatedWorkingMin = slices.filter(s => s.type === 'active').reduce((sum, s) => sum + (s.duration || 0), 0);
    if (att.workingHours && att.workingHours !== 'In Progress') {
      const hMatch = att.workingHours.match(/(\d+)\s*h/);
      const mMatch = att.workingHours.match(/(\d+)\s*m/);
      if (hMatch || mMatch) {
        calculatedWorkingMin = (hMatch ? parseInt(hMatch[1], 10) * 60 : 0) + (mMatch ? parseInt(mMatch[1], 10) : 0);
      }
    }

    let netHours = att.workingHours;
    if (!netHours || netHours === 'In Progress') {
      const wh = Math.floor(calculatedWorkingMin / 60);
      const wm = calculatedWorkingMin % 60;
      netHours = `${wh}h ${String(wm).padStart(2, '0')}m`;
    }

    let displayStatus = 'Active';
    if (att.checkOut && att.checkOut !== '--:--') displayStatus = 'Checked Out';
    else if (att.shiftStatus === 'lunch') displayStatus = 'On Lunch Break';
    else if (att.shiftStatus === 'inactive') displayStatus = 'Inactive';

    return {
      staff,
      attendance: att,
      date: dateStr,
      summary: {
        currentStatus: displayStatus,
        status: displayStatus,
        checkIn: checkIn,
        checkOut: checkOut || 'In Progress',
        workingDurationFormatted: netHours,
        netWorkingHours: netHours,
        workingMinutes: calculatedWorkingMin,
        totalInactiveDurationFormatted: `${effectiveInactiveMin}m`,
        totalInactiveMinutes: effectiveInactiveMin,
        totalLunchDurationFormatted: `${effectiveLunchMin}m`,
        totalLunchMinutes: effectiveLunchMin
      },
      slices,
      timeline,
      events: timeline.map(t => ({
        ...t,
        label: `${t.timeRange} — ${t.title}`,
        durationFormatted: t.duration || '',
        notes: t.description || t.notes || ''
      }))
    };
  },

  // ========================================================================
  // CLIENT MANAGEMENT ENGINE
  // ========================================================================
  checkDuplicateClient(phone, email, excludeId = null) {
    const db = this.load();
    const clients = Array.isArray(db.clients) ? db.clients : [];
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const cleanEmail = (email || '').trim().toLowerCase();

    for (const c of clients) {
      if (excludeId && c.id === excludeId) continue;
      const cPhone = (c.phone || '').replace(/\D/g, '');
      const cEmail = (c.email || '').trim().toLowerCase();

      if (cleanPhone && cPhone && cleanPhone === cPhone) {
        return { isDuplicate: true, field: 'phone', client: c };
      }
      if (cleanEmail && cEmail && cleanEmail === cEmail) {
        return { isDuplicate: true, field: 'email', client: c };
      }
    }
    return { isDuplicate: false };
  },

  getClients(filters = {}) {
    const db = this.load();
    let clients = Array.isArray(db.clients) ? db.clients : [];

    // Search query across name, company, email, phone, project names, service type, and address
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      clients = clients.filter(c => {
        const nameMatch = (c.name || '').toLowerCase().includes(q);
        const compMatch = (c.company || '').toLowerCase().includes(q);
        const emailMatch = (c.email || '').toLowerCase().includes(q);
        const phoneMatch = (c.phone || '').toLowerCase().includes(q);
        const addrMatch = (c.address || '').toLowerCase().includes(q);
        const projMatch = Array.isArray(c.projects) && c.projects.some(p => 
          (p.name || '').toLowerCase().includes(q) ||
          (p.serviceType || '').toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        );
        return nameMatch || compMatch || emailMatch || phoneMatch || addrMatch || projMatch;
      });
    }

    // Payment Status Filter (Paid, Partially Paid, Pending, Overdue)
    if (filters.paymentStatus && filters.paymentStatus !== 'all' && filters.paymentStatus !== 'All') {
      clients = clients.filter(c => {
        if (!Array.isArray(c.projects) || c.projects.length === 0) return false;
        return c.projects.some(p => (p.paymentStatus || '').toLowerCase() === filters.paymentStatus.toLowerCase());
      });
    }

    // Project Status Filter (Planning, In Progress, Completed, On Hold, Cancelled)
    if (filters.projectStatus && filters.projectStatus !== 'all' && filters.projectStatus !== 'All') {
      clients = clients.filter(c => {
        if (!Array.isArray(c.projects) || c.projects.length === 0) return false;
        return c.projects.some(p => (p.status || p.projectStatus || '').toLowerCase() === filters.projectStatus.toLowerCase());
      });
    }

    // Service Type Filter
    if (filters.serviceType && filters.serviceType !== 'all' && filters.serviceType !== 'All') {
      clients = clients.filter(c => {
        if (!Array.isArray(c.projects) || c.projects.length === 0) return false;
        return c.projects.some(p => (p.serviceType || '').toLowerCase() === filters.serviceType.toLowerCase());
      });
    }

    // Client Derived Status Filter (Active, Completed, On Hold, New)
    if (filters.status && filters.status !== 'all' && filters.status !== 'All') {
      clients = clients.filter(c => {
        const projects = Array.isArray(c.projects) ? c.projects : [];
        let derived = 'New';
        if (projects.length > 0) {
          const hasActive = projects.some(p => {
            const st = (p.status || p.projectStatus || '').toLowerCase();
            return st === 'in progress' || st === 'planning';
          });
          if (hasActive) derived = 'Active';
          else if (projects.every(p => (p.status || p.projectStatus || '').toLowerCase() === 'completed')) derived = 'Completed';
          else if (projects.some(p => (p.status || p.projectStatus || '').toLowerCase() === 'on hold')) derived = 'On Hold';
          else derived = 'Active';
        }
        return derived.toLowerCase() === filters.status.toLowerCase();
      });
    }

    return clients;
  },

  getClientById(clientId) {
    const db = this.load();
    return (db.clients || []).find(c => c.id === clientId) || null;
  },

  addClient(clientData, author = null, skipSync = false) {
    const db = this.load();
    if (!Array.isArray(db.clients)) db.clients = [];

    // If client with this ID already exists, update instead of duplicating
    if (clientData.id) {
      const existingClient = db.clients.find(c => c.id === clientData.id);
      if (existingClient) {
        return this.updateClient(clientData.id, clientData, author);
      }
    }

    // Duplicate Check (excluding current ID if provided)
    const dupCheck = this.checkDuplicateClient(clientData.phone, clientData.email, clientData.id || null);
    if (dupCheck.isDuplicate) {
      const err = new Error(`A client with this ${dupCheck.field} already exists: "${dupCheck.client.name}" (${dupCheck.client.company || 'No Company'})`);
      err.code = 'DUPLICATE_CLIENT';
      err.duplicateClient = dupCheck.client;
      throw err;
    }

    // Guarantee unique client ID
    let id = clientData.id;
    if (!id) {
      do {
        id = `CLI-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      } while (db.clients.some(c => c.id === id));
    }
    const projects = [];

    // Support optional initial project details attached when creating client
    const projName = (clientData.projectName || clientData.project_name || clientData.projectTitle || '').trim();
    if (projName) {
      const amt = Number(clientData.projectAmount || clientData.amount) || 0;
      const adv = Number(clientData.advancePaid) || 0;
      const balance = Math.max(0, amt - adv);
      let payStatus = clientData.paymentStatus || 'Pending';
      if (adv >= amt && amt > 0) payStatus = 'Paid';
      else if (adv > 0 && adv < amt) payStatus = 'Partially Paid';

      projects.push({
        id: `CPRJ-${Date.now()}-1`,
        name: projName,
        description: (clientData.projectDescription || clientData.description || '').trim(),
        serviceType: clientData.serviceType || 'Enterprise Software',
        amount: amt,
        advancePaid: adv,
        additionalPayments: [],
        balanceDue: balance,
        startDate: clientData.startDate || new Date().toISOString().split('T')[0],
        dueDate: clientData.dueDate || '',
        paymentDates: {
          advanceDate: adv > 0 ? (clientData.startDate || new Date().toISOString().split('T')[0]) : null,
          lastPaymentDate: null,
          dueDate: clientData.dueDate || null
        },
        paymentStatus: payStatus,
        status: clientData.projectStatus || clientData.status || 'Planning',
        progress: Number(clientData.progress) || 0,
        assignedStaff: clientData.assignedStaff || clientData.assignedStaffId || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } else if (Array.isArray(clientData.projects)) {
      clientData.projects.forEach((p, idx) => {
        const amt = Number(p.amount) || 0;
        const adv = Number(p.advancePaid) || 0;
        const addPayments = Array.isArray(p.additionalPayments) ? p.additionalPayments : [];
        const totalPaid = adv + addPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0);
        const balance = Math.max(0, amt - totalPaid);
        let payStatus = p.paymentStatus || 'Pending';
        if (totalPaid >= amt && amt > 0) payStatus = 'Paid';
        else if (totalPaid > 0 && totalPaid < amt) payStatus = 'Partially Paid';

        projects.push({
          id: p.id || `CPRJ-${Date.now()}-${idx + 1}`,
          name: p.name || 'Untitled Project',
          description: p.description || '',
          serviceType: p.serviceType || 'Enterprise Software',
          amount: amt,
          advancePaid: adv,
          additionalPayments: addPayments,
          balanceDue: balance,
          startDate: p.startDate || new Date().toISOString().split('T')[0],
          dueDate: p.dueDate || '',
          paymentDates: p.paymentDates || {
            advanceDate: adv > 0 ? p.startDate : null,
            lastPaymentDate: addPayments.length > 0 ? addPayments[addPayments.length - 1].date : null,
            dueDate: p.dueDate || null
          },
          paymentStatus: payStatus,
          status: p.status || p.projectStatus || 'Planning',
          progress: Number(p.progress) || 0,
          assignedStaff: p.assignedStaff || '',
          createdAt: p.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      });
    }

    // Ensure every client always has an initial project scope
    if (projects.length === 0) {
      const defaultProjName = `${(clientData.name || clientData.clientName || 'Client').trim()} Deliverables & Services`;
      const amt = Number(clientData.projectAmount || clientData.amount) || 0;
      const adv = Number(clientData.advancePaid) || 0;
      projects.push({
        id: `CPRJ-${Date.now()}-1`,
        name: defaultProjName,
        description: (clientData.projectDescription || clientData.description || '').trim() || 'Core client project deliverables and service contract scope.',
        serviceType: clientData.serviceType || 'Enterprise Software',
        amount: amt,
        advancePaid: adv,
        additionalPayments: [],
        balanceDue: Math.max(0, amt - adv),
        startDate: clientData.startDate || new Date().toISOString().split('T')[0],
        dueDate: clientData.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        paymentDates: {
          advanceDate: adv > 0 ? (clientData.startDate || new Date().toISOString().split('T')[0]) : null,
          lastPaymentDate: null,
          dueDate: clientData.dueDate || null
        },
        paymentStatus: (adv >= amt && amt > 0) ? 'Paid' : (adv > 0 ? 'Partially Paid' : 'Pending'),
        status: clientData.projectStatus || clientData.status || 'In Progress',
        progress: Number(clientData.progress) || 10,
        assignedStaff: clientData.assignedStaff || clientData.assignedStaffId || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
    const newClient = {
      id,
      name: (clientData.name || clientData.clientName || '').trim() || 'New Client',
      company: (clientData.company || clientData.companyName || '').trim(),
      phone: (clientData.phone || clientData.mobile || '').trim(),
      email: (clientData.email || '').trim().toLowerCase(),
      address: (clientData.address || '').trim(),
      projects,
      notes: Array.isArray(clientData.notes) ? clientData.notes : [],
      activityHistory: [
        {
          id: `ACT-${Date.now()}-init`,
          type: 'client_created',
          title: 'Client Registered',
          description: `Client account registered for ${clientData.name || 'New Client'} (${clientData.company || 'Corporate Client'}).`,
          author: authorName,
          timestamp: new Date().toISOString()
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (projects.length > 0) {
      newClient.activityHistory.unshift({
        id: `ACT-${Date.now()}-p1`,
        type: 'project_added',
        title: 'Project Assigned',
        description: `Initial project "${projects[0].name}" (${projects[0].amount.toLocaleString()}) assigned.`,
        author: authorName,
        timestamp: new Date().toISOString()
      });
    }

    db.clients.unshift(newClient);
    this.save(db, skipSync);
    return newClient;
  },

  updateClient(clientId, clientData, author = null) {
    const db = this.load();
    if (!Array.isArray(db.clients)) db.clients = [];
    const client = db.clients.find(c => c.id === clientId);
    if (!client) return null;

    // Duplicate Check only if phone or email is actually changed
    const phoneChanged = clientData.phone !== undefined && (client.phone || '').replace(/\D/g, '') !== (clientData.phone || '').replace(/\D/g, '');
    const emailChanged = clientData.email !== undefined && (client.email || '').trim().toLowerCase() !== (clientData.email || '').trim().toLowerCase();

    if (phoneChanged || emailChanged) {
      const dupCheck = this.checkDuplicateClient(
        phoneChanged ? clientData.phone : '',
        emailChanged ? clientData.email : '',
        clientId
      );
      if (dupCheck.isDuplicate) {
        const err = new Error(`A client with this ${dupCheck.field} already exists: "${dupCheck.client.name}" (${dupCheck.client.company || 'No Company'})`);
        err.code = 'DUPLICATE_CLIENT';
        err.duplicateClient = dupCheck.client;
        throw err;
      }
    }

    if (clientData.name !== undefined) client.name = (clientData.name || '').trim();
    if (clientData.clientName !== undefined) client.name = (clientData.clientName || '').trim();
    if (clientData.company !== undefined) client.company = (clientData.company || '').trim();
    if (clientData.companyName !== undefined) client.company = (clientData.companyName || '').trim();
    if (clientData.phone !== undefined) client.phone = (clientData.phone || '').trim();
    if (clientData.email !== undefined) client.email = (clientData.email || '').trim().toLowerCase();
    if (clientData.address !== undefined) client.address = (clientData.address || '').trim();
    if (Array.isArray(clientData.projects)) client.projects = clientData.projects;

    if (!Array.isArray(client.activityHistory)) client.activityHistory = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
    client.activityHistory.unshift({
      id: `ACT-${Date.now()}-upd`,
      type: 'client_updated',
      title: 'Client Updated',
      description: `Client contact and profile details updated.`,
      author: authorName,
      timestamp: new Date().toISOString()
    });

    client.updatedAt = new Date().toISOString();
    this.save(db);
    return client;
  },

  deleteClient(clientId, author = null) {
    const db = this.load();
    if (!Array.isArray(db.clients)) return false;

    // Prevent deletion if any domain is linked to this client
    const linkedDomains = (db.domains || []).filter(d => d.clientId === clientId);
    if (linkedDomains.length > 0) {
      const names = linkedDomains.map(d => d.domainName).join(', ');
      const err = new Error(`Cannot delete client because they have active domain records (${names}). Every domain and hosting record must be linked to a Client and a specific Project. Please reassign or delete the linked domain records first.`);
      err.code = 'CLIENT_HAS_LINKED_DOMAINS';
      throw err;
    }

    const initialLen = db.clients.length;
    db.clients = db.clients.filter(c => c.id !== clientId);
    if (db.clients.length !== initialLen) {
      this.save(db);
      return true;
    }
    return false;
  },

  addClientProject(clientId, projectData, author = null) {
    const db = this.load();
    const client = (db.clients || []).find(c => c.id === clientId);
    if (!client) return null;
    if (!Array.isArray(client.projects)) client.projects = [];

    const amt = Number(projectData.amount || projectData.projectAmount) || 0;
    const adv = Number(projectData.advancePaid !== undefined ? projectData.advancePaid : (projectData.advance !== undefined ? projectData.advance : 0)) || 0;
    const balance = Math.max(0, amt - adv);
    let payStatus = projectData.paymentStatus || 'Pending';
    if (adv >= amt && amt > 0) payStatus = 'Paid';
    else if (adv > 0 && adv < amt) payStatus = 'Partially Paid';
    else if (projectData.dueDate && new Date(projectData.dueDate) < new Date()) payStatus = 'Overdue';

    const newProj = {
      id: `CPRJ-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: (projectData.name || projectData.projectName || '').trim() || 'Untitled Project',
      description: (projectData.description || projectData.projectDescription || '').trim(),
      serviceType: projectData.serviceType || 'Enterprise Software',
      amount: amt,
      advancePaid: adv,
      additionalPayments: [],
      balanceDue: balance,
      startDate: projectData.startDate || new Date().toISOString().split('T')[0],
      dueDate: projectData.dueDate || '',
      paymentDates: {
        advanceDate: adv > 0 ? (projectData.startDate || new Date().toISOString().split('T')[0]) : null,
        lastPaymentDate: null,
        dueDate: projectData.dueDate || null
      },
      paymentStatus: payStatus,
      status: projectData.status || projectData.projectStatus || 'Planning',
      progress: Number(projectData.progress) || 0,
      assignedStaff: projectData.assignedStaff || projectData.assignedStaffId || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    client.projects.push(newProj);

    if (!Array.isArray(client.activityHistory)) client.activityHistory = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
    client.activityHistory.unshift({
      id: `ACT-${Date.now()}-padd`,
      type: 'project_added',
      title: 'Project Assigned',
      description: `New project "${newProj.name}" (${amt.toLocaleString()}) assigned (${newProj.serviceType}).`,
      author: authorName,
      timestamp: new Date().toISOString()
    });

    client.updatedAt = new Date().toISOString();
    this.save(db);
    return { client, project: newProj };
  },

  updateClientProject(clientId, projectId, projectData, author = null) {
    const db = this.load();
    const client = (db.clients || []).find(c => c.id === clientId);
    if (!client || !Array.isArray(client.projects)) return null;
    const proj = client.projects.find(p => p.id === projectId);
    if (!proj) return null;

    if (projectData.name !== undefined) proj.name = (projectData.name || projectData.projectName || '').trim();
    if (projectData.description !== undefined) proj.description = (projectData.description || projectData.projectDescription || '').trim();
    if (projectData.serviceType !== undefined) proj.serviceType = projectData.serviceType;
    if (projectData.amount !== undefined) proj.amount = Number(projectData.amount || projectData.projectAmount) || 0;
    if (projectData.advancePaid !== undefined) proj.advancePaid = Number(projectData.advancePaid) || 0;
    if (projectData.startDate !== undefined) proj.startDate = projectData.startDate;
    if (projectData.dueDate !== undefined) proj.dueDate = projectData.dueDate;
    if (projectData.status !== undefined) proj.status = projectData.status;
    if (projectData.projectStatus !== undefined) proj.status = projectData.projectStatus;
    if (projectData.progress !== undefined) proj.progress = Number(projectData.progress) || 0;
    if (projectData.assignedStaff !== undefined) proj.assignedStaff = projectData.assignedStaff;

    // Recalculate balance and payment status
    const addPayments = Array.isArray(proj.additionalPayments) ? proj.additionalPayments : [];
    const totalPaid = (Number(proj.advancePaid) || 0) + addPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    proj.balanceDue = Math.max(0, (Number(proj.amount) || 0) - totalPaid);

    if (projectData.paymentStatus !== undefined && projectData.paymentStatus !== 'auto') {
      proj.paymentStatus = projectData.paymentStatus;
    } else {
      if (totalPaid >= proj.amount && proj.amount > 0) proj.paymentStatus = 'Paid';
      else if (totalPaid > 0 && totalPaid < proj.amount) proj.paymentStatus = 'Partially Paid';
      else if (proj.dueDate && new Date(proj.dueDate) < new Date()) proj.paymentStatus = 'Overdue';
      else proj.paymentStatus = 'Pending';
    }

    if (!Array.isArray(client.activityHistory)) client.activityHistory = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
    client.activityHistory.unshift({
      id: `ACT-${Date.now()}-pupd`,
      type: 'project_updated',
      title: 'Project Updated',
      description: `Project "${proj.name}" updated (Status: ${proj.status}, Progress: ${proj.progress}%).`,
      author: authorName,
      timestamp: new Date().toISOString()
    });

    proj.updatedAt = new Date().toISOString();
    client.updatedAt = new Date().toISOString();
    this.save(db);
    return { client, project: proj };
  },

  deleteClientProject(clientId, projectId, author = null) {
    const db = this.load();
    const client = (db.clients || []).find(c => c.id === clientId);
    if (!client || !Array.isArray(client.projects)) return false;
    const initialLen = client.projects.length;
    const targetProj = client.projects.find(p => p.id === projectId);
    const targetName = targetProj ? targetProj.name : 'Project';

    // Prevent deletion if any domain is linked to this project
    const linkedDomains = (db.domains || []).filter(d => d.clientId === clientId && d.projectId === projectId);
    if (linkedDomains.length > 0) {
      const names = linkedDomains.map(d => d.domainName).join(', ');
      const err = new Error(`Cannot delete project "${targetName}" because it is linked to active domain records (${names}). Every domain and hosting record must be linked to a specific project. Please reassign or delete the linked domain records first.`);
      err.code = 'PROJECT_HAS_LINKED_DOMAINS';
      throw err;
    }

    client.projects = client.projects.filter(p => p.id !== projectId);
    if (client.projects.length !== initialLen) {
      if (Array.isArray(db.domains)) {
        db.domains.forEach(d => {
          if (d.clientId === clientId && d.projectId === projectId) {
            d.projectId = '';
            d.projectName = '';
          }
        });
      }

      if (!Array.isArray(client.activityHistory)) client.activityHistory = [];
      const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
      client.activityHistory.unshift({
        id: `ACT-${Date.now()}-pdel`,
        type: 'project_deleted',
        title: 'Project Deleted',
        description: `Project "${targetName}" removed from client portfolio.`,
        author: authorName,
        timestamp: new Date().toISOString()
      });

      client.updatedAt = new Date().toISOString();
      this.save(db);
      return true;
    }
    return false;
  },

  recordClientPayment(clientId, projectId, paymentData, author = null) {
    const db = this.load();
    const client = (db.clients || []).find(c => c.id === clientId);
    if (!client) throw new Error('Client not found');
    const project = (client.projects || []).find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');

    const paymentAmount = Number(paymentData.amount) || 0;
    if (paymentAmount <= 0) throw new Error('Payment amount must be greater than zero');

    if (!Array.isArray(project.additionalPayments)) project.additionalPayments = [];

    const paymentRecord = {
      id: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      amount: paymentAmount,
      date: paymentData.date || new Date().toISOString().split('T')[0],
      method: paymentData.method || 'Bank Transfer',
      notes: (paymentData.notes || '').trim(),
      author: author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff'),
      createdAt: new Date().toISOString()
    };

    project.additionalPayments.push(paymentRecord);

    // Recalculate balance and payment status
    const totalPaid = (Number(project.advancePaid) || 0) + project.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    project.balanceDue = Math.max(0, (Number(project.amount) || 0) - totalPaid);

    if (totalPaid >= project.amount && project.amount > 0) {
      project.paymentStatus = 'Paid';
    } else if (totalPaid > 0) {
      project.paymentStatus = 'Partially Paid';
    } else {
      project.paymentStatus = 'Pending';
    }

    if (!project.paymentDates) project.paymentDates = {};
    project.paymentDates.lastPaymentDate = paymentRecord.date;

    if (!Array.isArray(client.activityHistory)) client.activityHistory = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
    client.activityHistory.unshift({
      id: `ACT-${Date.now()}-pay`,
      type: 'payment_recorded',
      title: 'Payment Recorded',
      description: `Payment of ${paymentAmount.toLocaleString()} recorded via ${paymentRecord.method} for "${project.name}" (Remaining Balance: ${project.balanceDue.toLocaleString()}).`,
      author: authorName,
      timestamp: new Date().toISOString()
    });

    project.updatedAt = new Date().toISOString();
    client.updatedAt = new Date().toISOString();
    this.save(db);
    return { client, project, payment: paymentRecord };
  },

  addClientNote(clientId, noteText, author = null) {
    const db = this.load();
    const client = (db.clients || []).find(c => c.id === clientId);
    if (!client) throw new Error('Client not found');

    const cleanText = (noteText || '').trim();
    if (!cleanText) throw new Error('Note content cannot be empty');

    if (!Array.isArray(client.notes)) client.notes = [];

    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
    const note = {
      id: `CNOTE-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      text: cleanText,
      author: authorName,
      authorRole: author?.role || 'Admin',
      createdAt: new Date().toISOString()
    };

    client.notes.unshift(note);

    if (!Array.isArray(client.activityHistory)) client.activityHistory = [];
    client.activityHistory.unshift({
      id: `ACT-${Date.now()}-note`,
      type: 'note_added',
      title: 'Note Added',
      description: `Note added by ${authorName}: "${cleanText.substring(0, 50)}${cleanText.length > 50 ? '...' : ''}"`,
      author: authorName,
      timestamp: new Date().toISOString()
    });

    client.updatedAt = new Date().toISOString();
    this.save(db);
    return { client, note };
  },

  getClientSummary() {
    const db = this.load();
    const clients = Array.isArray(db.clients) ? db.clients : [];
    let totalProjects = 0;
    let activeProjects = 0;
    let totalProjectValue = 0;
    let totalPaid = 0;
    let totalBalanceDue = 0;
    let activeClients = 0;

    clients.forEach(c => {
      const projects = Array.isArray(c.projects) ? c.projects : [];
      let hasActiveProjects = false;

      projects.forEach(p => {
        totalProjects++;
        const amt = Number(p.amount) || 0;
        totalProjectValue += amt;

        const adv = Number(p.advancePaid) || 0;
        const addSum = Array.isArray(p.additionalPayments) 
          ? p.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) 
          : 0;
        const paid = adv + addSum;
        totalPaid += paid;
        totalBalanceDue += Math.max(0, amt - paid);

        const status = (p.status || p.projectStatus || '').toLowerCase();
        if (status === 'in progress' || status === 'planning') {
          activeProjects++;
          hasActiveProjects = true;
        } else if (status === 'on hold' || status === '') {
          hasActiveProjects = true;
        }
      });

      const cStatus = (c.status || '').toLowerCase();
      if (cStatus === 'active' || (cStatus !== 'inactive' && (projects.length === 0 || hasActiveProjects))) {
        activeClients++;
      }
    });

    return {
      totalClients: clients.length,
      activeClients,
      totalProjects,
      activeProjects,
      totalProjectValue,
      totalPaid,
      totalBalanceDue,
      pendingPayments: totalBalanceDue,
      paidPayments: totalPaid
    };
  },

  // ========================================================================
  // LEAD MANAGEMENT ENGINE
  // ========================================================================
  getLeads(filters = {}) {
    const db = this.load();
    let leads = Array.isArray(db.leads) ? db.leads : [];
    const todayStr = new Date().toISOString().split('T')[0];

    const telecallerFilter = filters.telecallerId || filters.staffId;
    if (telecallerFilter && telecallerFilter !== 'all' && telecallerFilter !== 'All') {
      const targetStaffId = String(telecallerFilter).trim().toUpperCase();
      leads = leads.filter(l => String(l.assignedStaffId || '').trim().toUpperCase() === targetStaffId);
    }

    if (filters.status && filters.status !== 'all' && filters.status !== 'All') {
      leads = leads.filter(l => (l.status || '').toLowerCase() === filters.status.toLowerCase());
    }

    if (filters.service && filters.service !== 'all' && filters.service !== 'All') {
      leads = leads.filter(l => (l.service || l.interestedService || '').toLowerCase() === filters.service.toLowerCase());
    }

    if (filters.source && filters.source !== 'all' && filters.source !== 'All') {
      leads = leads.filter(l => (l.source || '').toLowerCase() === filters.source.toLowerCase());
    }

    const tf = filters.timeframe || filters.dateFilter;
    if (tf === 'today') {
      leads = leads.filter(l => l.followUpDate === todayStr && l.status !== 'Converted' && l.status !== 'Lost');
    } else if (tf === 'upcoming') {
      leads = leads.filter(l => l.followUpDate && l.followUpDate >= todayStr && l.status !== 'Converted' && l.status !== 'Lost');
    } else if (tf === 'overdue') {
      leads = leads.filter(l => l.followUpDate && l.followUpDate < todayStr && l.status !== 'Converted' && l.status !== 'Lost');
    } else if (tf === 'this-month') {
      const monthPrefix = todayStr.substring(0, 7);
      leads = leads.filter(l => (l.createdAt && l.createdAt.startsWith(monthPrefix)) || (l.followUpDate && l.followUpDate.startsWith(monthPrefix)));
    }

    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      leads = leads.filter(l => {
        const nameMatch = (l.name || '').toLowerCase().includes(q);
        const compMatch = (l.company || '').toLowerCase().includes(q);
        const emailMatch = (l.email || '').toLowerCase().includes(q);
        const phoneMatch = (l.phone || '').toLowerCase().includes(q);
        const serviceMatch = (l.service || l.interestedService || '').toLowerCase().includes(q);
        const staffMatch = (l.assignedStaffName || '').toLowerCase().includes(q);
        return nameMatch || compMatch || emailMatch || phoneMatch || serviceMatch || staffMatch;
      });
    }

    return leads;
  },

  getLeadById(leadId) {
    const db = this.load();
    return (db.leads || []).find(l => l.id === leadId) || null;
  },

  checkDuplicateLead(phone, email, excludeId = null) {
    const db = this.load();
    const leads = Array.isArray(db.leads) ? db.leads : [];
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const cleanEmail = (email || '').trim().toLowerCase();

    for (const l of leads) {
      if (excludeId && l.id === excludeId) continue;
      const lPhone = (l.phone || '').replace(/\D/g, '');
      const lEmail = (l.email || '').trim().toLowerCase();

      if (cleanPhone && lPhone && cleanPhone.length >= 7 && lPhone.length >= 7 && (cleanPhone === lPhone || cleanPhone.endsWith(lPhone) || lPhone.endsWith(cleanPhone))) {
        return { isDuplicate: true, field: 'phone', lead: l };
      }
      if (cleanEmail && lEmail && cleanEmail === lEmail) {
        return { isDuplicate: true, field: 'email', lead: l };
      }
    }
    return { isDuplicate: false };
  },

  addLead(leadData, author = null) {
    const db = this.load();
    if (!Array.isArray(db.leads)) db.leads = [];

    // Duplicate check
    const dupCheck = this.checkDuplicateLead(leadData.phone, leadData.email);
    if (dupCheck.isDuplicate) {
      const err = new Error(`A lead with this ${dupCheck.field} already exists: "${dupCheck.lead.name}" (${dupCheck.lead.company || 'No Company'})`);
      err.code = 'DUPLICATE_LEAD';
      err.duplicateLead = dupCheck.lead;
      throw err;
    }

    const id = `LEAD-${Date.now()}`;
    const staffId = leadData.assignedStaffId || leadData.assignedTelecaller || '';
    let staffName = leadData.assignedStaffName || '';
    if (staffId && !staffName) {
      const st = (db.staff || []).find(s => String(s.id).trim().toUpperCase() === String(staffId).trim().toUpperCase());
      staffName = st ? st.name : staffId;
    }

    const notes = [];
    const initNote = (leadData.followUpNotes || leadData.notes || leadData.initialNote || '').trim();
    if (initNote) {
      notes.push({
        id: `NOTE-${Date.now()}-1`,
        text: initNote,
        nextAction: (leadData.nextAction || '').trim(),
        author: author?.name || (author?.role === 'admin' ? 'Administrator' : 'Telecaller'),
        authorRole: author?.role || (author?.name ? 'Staff' : 'Telecaller'),
        timestamp: this.formatDisplayDate(new Date(), true),
        date: new Date().toISOString()
      });
    }

    const createdIso = leadData.createdDate ? new Date(leadData.createdDate).toISOString() : new Date().toISOString();

    const newLead = {
      id,
      name: (leadData.name || leadData.leadName || '').trim() || 'New Lead',
      company: (leadData.company || '').trim(),
      phone: (leadData.phone || '').trim(),
      email: (leadData.email || '').trim().toLowerCase(),
      source: leadData.source || leadData.leadSource || 'Website',
      service: leadData.service || leadData.interestedService || 'Enterprise Software',
      interestedService: leadData.service || leadData.interestedService || 'Enterprise Software',
      expectedAmount: Number(leadData.expectedAmount) || 0,
      assignedStaffId: staffId,
      assignedStaffName: staffName,
      createdDate: leadData.createdDate || createdIso.split('T')[0],
      followUpDate: leadData.followUpDate || '',
      followUpTime: leadData.followUpTime || '11:00',
      nextAction: (leadData.nextAction || '').trim(),
      status: leadData.status || leadData.leadStatus || 'New',
      notes,
      createdAt: createdIso,
      updatedAt: new Date().toISOString()
    };

    db.leads.unshift(newLead);

    // Create notification for assigned telecaller staff member
    if (staffId) {
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-lead`,
        role: 'staff',
        staffId: staffId,
        title: 'New Lead Assigned',
        message: `New lead assigned to you: "${newLead.name}" (${newLead.company || 'No Company'}). Scheduled follow-up: ${newLead.followUpDate || 'TBD'}`,
        text: `New lead assigned: "${newLead.name}"`,
        time: 'Just now',
        createdAt: new Date().toISOString(),
        read: false
      });
    }

    this.save(db);
    return newLead;
  },

  updateLead(leadId, leadData, author = null) {
    const db = this.load();
    if (!Array.isArray(db.leads)) db.leads = [];
    const lead = db.leads.find(l => l.id === leadId);
    if (!lead) return null;

    // Duplicate check on phone/email if being updated
    if (leadData.phone || leadData.email) {
      const testPhone = leadData.phone !== undefined ? leadData.phone : lead.phone;
      const testEmail = leadData.email !== undefined ? leadData.email : lead.email;
      const dupCheck = this.checkDuplicateLead(testPhone, testEmail, leadId);
      if (dupCheck.isDuplicate) {
        const err = new Error(`A lead with this ${dupCheck.field} already exists: "${dupCheck.lead.name}" (${dupCheck.lead.company || 'No Company'})`);
        err.code = 'DUPLICATE_LEAD';
        err.duplicateLead = dupCheck.lead;
        throw err;
      }
    }

    if (leadData.name !== undefined) lead.name = (leadData.name || '').trim();
    if (leadData.company !== undefined) lead.company = (leadData.company || '').trim();
    if (leadData.phone !== undefined) lead.phone = (leadData.phone || '').trim();
    if (leadData.email !== undefined) lead.email = (leadData.email || '').trim().toLowerCase();
    if (leadData.source !== undefined) lead.source = leadData.source;
    if (leadData.service !== undefined) {
      lead.service = leadData.service;
      lead.interestedService = leadData.service;
    }
    if (leadData.interestedService !== undefined) {
      lead.service = leadData.interestedService;
      lead.interestedService = leadData.interestedService;
    }
    if (leadData.expectedAmount !== undefined) lead.expectedAmount = Number(leadData.expectedAmount) || 0;
    if (leadData.assignedStaffId !== undefined) {
      const oldStaffId = lead.assignedStaffId;
      lead.assignedStaffId = leadData.assignedStaffId;
      const st = (db.staff || []).find(s => String(s.id).trim().toUpperCase() === String(leadData.assignedStaffId).trim().toUpperCase());
      lead.assignedStaffName = st ? st.name : (leadData.assignedStaffId || 'Unassigned');

      if (leadData.assignedStaffId && String(leadData.assignedStaffId).trim().toUpperCase() !== String(oldStaffId || '').trim().toUpperCase()) {
        if (!Array.isArray(db.notifications)) db.notifications = [];
        db.notifications.unshift({
          id: `N-${Date.now()}-lead-reassign`,
          role: 'staff',
          staffId: leadData.assignedStaffId,
          title: 'Lead Assigned to You',
          message: `Lead assigned to you: "${lead.name}" (${lead.company || 'No Company'}).`,
          text: `Lead assigned: "${lead.name}"`,
          time: 'Just now',
          createdAt: new Date().toISOString(),
          read: false
        });
      }
    }
    if (leadData.assignedStaffName !== undefined) lead.assignedStaffName = leadData.assignedStaffName;
    if (leadData.followUpDate !== undefined) lead.followUpDate = leadData.followUpDate;
    if (leadData.followUpTime !== undefined) lead.followUpTime = leadData.followUpTime;
    if (leadData.nextAction !== undefined) lead.nextAction = (leadData.nextAction || '').trim();
    if (leadData.createdDate !== undefined) lead.createdAt = new Date(leadData.createdDate).toISOString();

    if (leadData.status !== undefined && leadData.status !== lead.status) {
      const oldStatus = lead.status;
      lead.status = leadData.status;
      if (!Array.isArray(lead.notes)) lead.notes = [];
      lead.notes.unshift({
        id: `NOTE-${Date.now()}`,
        text: `Status updated from "${oldStatus}" to "${leadData.status}".`,
        nextAction: lead.nextAction || '',
        author: author?.name || (author?.role === 'admin' ? 'Administrator' : 'Telecaller'),
        authorRole: author?.role || 'Staff',
        timestamp: this.formatDisplayDate(new Date(), true),
        date: new Date().toISOString()
      });
    }

    lead.updatedAt = new Date().toISOString();
    lead.lastUpdatedBy = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
    this.save(db);
    return lead;
  },

  updateLeadStatus(leadId, newStatus, author = null) {
    return this.updateLead(leadId, { status: newStatus }, author);
  },

  addLeadNote(leadId, noteText, author = null, nextFollowUpDate = null, nextFollowUpTime = null, nextAction = null) {
    const db = this.load();
    const lead = (db.leads || []).find(l => l.id === leadId);
    if (!lead) return null;
    if (!Array.isArray(lead.notes)) lead.notes = [];

    const note = {
      id: `NOTE-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      text: (noteText || '').trim(),
      nextAction: (nextAction || '').trim(),
      author: author?.name || (author?.role === 'admin' ? 'Administrator' : 'Telecaller'),
      authorRole: author?.role || (author?.position || 'Staff'),
      timestamp: this.formatDisplayDate(new Date(), true),
      date: new Date().toISOString()
    };
    lead.notes.unshift(note);

    if (nextFollowUpDate) lead.followUpDate = nextFollowUpDate;
    if (nextFollowUpTime) lead.followUpTime = nextFollowUpTime;
    if (nextAction !== null && nextAction !== undefined) lead.nextAction = (nextAction || '').trim();

    lead.updatedAt = new Date().toISOString();
    lead.lastUpdatedBy = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff');
    this.save(db);
    return { lead, note };
  },

  deleteLead(leadId, author = null) {
    const db = this.load();
    if (!Array.isArray(db.leads)) return false;
    const initialLen = db.leads.length;
    db.leads = db.leads.filter(l => l.id !== leadId);
    if (db.leads.length !== initialLen) {
      this.save(db);
      return true;
    }
    return false;
  },

  convertLeadToClient(leadId, overrides = {}, author = null) {
    const db = this.load();
    const lead = (db.leads || []).find(l => l.id === leadId);
    if (!lead) throw new Error('Lead not found');

    if (!Array.isArray(db.clients)) db.clients = [];

    // Check if client already exists with same phone or email
    const cleanPhone = (overrides.phone || lead.phone || '').replace(/\D/g, '');
    const cleanEmail = (overrides.email || lead.email || '').trim().toLowerCase();

    let existingClient = null;
    if (cleanPhone || cleanEmail) {
      existingClient = db.clients.find(c => {
        const cPhone = (c.phone || '').replace(/\D/g, '');
        const cEmail = (c.email || '').trim().toLowerCase();
        return (cleanPhone && cPhone && cleanPhone === cPhone) || (cleanEmail && cEmail && cleanEmail === cEmail);
      });
    }

    let clientRecord = existingClient;

    if (!existingClient) {
      const clientId = `CLI-${Date.now()}`;
      const projectName = overrides.projectName || lead.service || lead.interestedService || 'Initial Deliverable';
      const projectAmount = Number(overrides.projectAmount !== undefined ? overrides.projectAmount : lead.expectedAmount) || 0;

      const initialProject = {
        id: `CPRJ-${Date.now()}-1`,
        name: projectName,
        description: overrides.projectDescription || `Converted from Lead ${lead.name} (${lead.source || 'Website'}).`,
        amount: projectAmount,
        startDate: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        paymentStatus: overrides.paymentStatus || 'Pending',
        status: overrides.projectStatus || 'Planning',
        createdAt: new Date().toISOString()
      };

      clientRecord = {
        id: clientId,
        name: (overrides.name || lead.name || '').trim(),
        company: (overrides.company || lead.company || '').trim() || 'Independent Client',
        phone: (overrides.phone || lead.phone || '').trim(),
        email: (overrides.email || lead.email || '').trim().toLowerCase(),
        address: (overrides.address || lead.company || '').trim(),
        status: 'Active',
        projects: [initialProject],
        convertedFromLeadId: lead.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      db.clients.unshift(clientRecord);
    } else {
      // Attach an additional project to existing client if requested
      const projectName = overrides.projectName || lead.service || lead.interestedService || 'Pipeline Engagement';
      const projectAmount = Number(overrides.projectAmount !== undefined ? overrides.projectAmount : lead.expectedAmount) || 0;
      if (!Array.isArray(existingClient.projects)) existingClient.projects = [];
      existingClient.projects.push({
        id: `CPRJ-${Date.now()}-cv`,
        name: projectName,
        description: overrides.projectDescription || `Contract added from converted lead ${lead.name}.`,
        amount: projectAmount,
        startDate: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        paymentStatus: 'Pending',
        status: 'Planning',
        createdAt: new Date().toISOString()
      });
      existingClient.updatedAt = new Date().toISOString();
    }

    // Mark lead as Converted
    lead.status = 'Converted';
    lead.convertedClientId = clientRecord.id;
    lead.convertedAt = new Date().toISOString();
    lead.updatedAt = new Date().toISOString();

    if (!Array.isArray(lead.notes)) lead.notes = [];
    lead.notes.unshift({
      id: `NOTE-${Date.now()}`,
      text: `🎉 Successfully converted to Corporate Client account: "${clientRecord.name}" (${clientRecord.company}).`,
      author: author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff'),
      authorRole: author?.role || 'Admin',
      timestamp: this.formatDisplayDate(new Date(), true),
      date: new Date().toISOString()
    });

    this.save(db);
    return { lead, client: clientRecord, isExistingClient: !!existingClient };
  },

  getLeadSummary(filters = {}) {
    const db = this.load();
    let leads = Array.isArray(db.leads) ? db.leads : [];
    const telecallerFilter = filters.telecallerId || filters.staffId;
    if (telecallerFilter && telecallerFilter !== 'all' && telecallerFilter !== 'All') {
      const targetStaffId = String(telecallerFilter).trim().toUpperCase();
      leads = leads.filter(l => String(l.assignedStaffId || '').trim().toUpperCase() === targetStaffId);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    let totalPipelineValue = 0;
    let newLeads = 0;
    let followUpsToday = 0;
    let overdueFollowUps = 0;
    let upcomingFollowUps = 0;
    let convertedLeads = 0;
    let lostLeads = 0;
    let convertedValue = 0;

    leads.forEach(l => {
      const amt = Number(l.expectedAmount) || 0;
      totalPipelineValue += amt;
      const status = l.status || 'New';

      if (status === 'New') {
        newLeads++;
      } else if (status === 'Converted') {
        convertedLeads++;
        convertedValue += amt;
      } else if (status === 'Lost') {
        lostLeads++;
      }

      if (status !== 'Converted' && status !== 'Lost') {
        if (l.followUpDate) {
          if (l.followUpDate === todayStr) {
            followUpsToday++;
          } else if (l.followUpDate < todayStr) {
            overdueFollowUps++;
          } else {
            upcomingFollowUps++;
          }
        }
      }
    });

    const conversionRate = leads.length > 0 ? ((convertedLeads / leads.length) * 100).toFixed(1) : '0.0';

    return {
      totalLeads: leads.length,
      newLeads,
      followUpsToday,
      overdueFollowUps,
      upcomingFollowUps,
      convertedLeads,
      convertedCount: convertedLeads,
      lostLeads,
      totalPipelineValue,
      pipelineValue: totalPipelineValue,
      convertedValue,
      convertedRevenue: convertedValue,
      conversionRate
    };
  },

  getTelecallerReport() {
    const db = this.load();
    const staffList = Array.isArray(db.staff) ? db.staff : [];
    const leads = Array.isArray(db.leads) ? db.leads : [];
    const todayStr = new Date().toISOString().split('T')[0];

    const reports = staffList.map(st => {
      const staffLeads = leads.filter(l => String(l.assignedStaffId || '').trim().toUpperCase() === String(st.id || '').trim().toUpperCase());
      const converted = staffLeads.filter(l => l.status === 'Converted');
      const lost = staffLeads.filter(l => l.status === 'Lost');
      const active = staffLeads.filter(l => l.status !== 'Converted' && l.status !== 'Lost');
      const todayDue = staffLeads.filter(l => l.followUpDate === todayStr && l.status !== 'Converted' && l.status !== 'Lost');
      const overdue = staffLeads.filter(l => l.followUpDate && l.followUpDate < todayStr && l.status !== 'Converted' && l.status !== 'Lost');

      let followUpsCompleted = 0;
      staffLeads.forEach(l => {
        if (Array.isArray(l.notes)) {
          followUpsCompleted += l.notes.filter(n => n.author === st.name || n.authorRole === 'Staff').length;
        }
      });

      const totalPipeline = staffLeads.reduce((sum, l) => sum + (Number(l.expectedAmount) || 0), 0);
      const wonRevenue = converted.reduce((sum, l) => sum + (Number(l.expectedAmount) || 0), 0);
      const conversionRate = staffLeads.length > 0 ? ((converted.length / staffLeads.length) * 100).toFixed(1) : '0.0';

      return {
        staffId: st.id,
        staffName: st.name,
        position: st.position || 'Telecaller',
        mobile: st.mobile || '—',
        email: st.email || '—',
        assignedCount: staffLeads.length,
        activeCount: active.length,
        todayDueCount: todayDue.length,
        overdueCount: overdue.length,
        followUpsCompleted,
        convertedCount: converted.length,
        lostCount: lost.length,
        totalPipeline,
        wonRevenue,
        conversionRate
      };
    });

    return reports;
  },

  importLeads(leadRows, author = null) {
    if (!Array.isArray(leadRows)) throw new Error('Invalid input: leadRows must be an array');
    let importedCount = 0;
    let skippedCount = 0;
    const skippedReasons = [];
    const createdLeads = [];

    for (let i = 0; i < leadRows.length; i++) {
      const row = leadRows[i];
      const name = (row.name || row['Lead Name'] || row['Name'] || '').trim();
      const company = (row.company || row['Company Name'] || row['Company'] || '').trim();
      const phone = (row.phone || row['Phone Number'] || row['Phone'] || '').trim();
      const email = (row.email || row['Email Address'] || row['Email'] || '').trim().toLowerCase();

      if (!name) {
        skippedCount++;
        skippedReasons.push(`Row ${i + 1}: Missing lead name`);
        continue;
      }
      if (!phone && !email) {
        skippedCount++;
        skippedReasons.push(`Row ${i + 1} (${name}): Missing both phone and email`);
        continue;
      }

      // Check duplicates
      const dup = this.checkDuplicateLead(phone, email);
      if (dup.isDuplicate) {
        skippedCount++;
        skippedReasons.push(`Row ${i + 1} (${name}): Duplicate ${dup.field} matches existing lead "${dup.lead.name}"`);
        continue;
      }

      try {
        const newLead = this.addLead({
          name,
          company,
          phone,
          email,
          service: row.service || row['Interested Service'] || row['Service'] || 'Enterprise Software',
          source: row.source || row['Lead Source'] || row['Source'] || 'Import',
          expectedAmount: Number(row.expectedAmount || row['Expected Project Amount'] || row['Amount'] || 0),
          assignedStaffId: row.assignedStaffId || row['Assigned Telecaller ID'] || '',
          assignedStaffName: row.assignedStaffName || row['Assigned Telecaller'] || '',
          followUpDate: row.followUpDate || row['Follow-up Date'] || '',
          followUpTime: row.followUpTime || row['Follow-up Time'] || '11:00',
          status: row.status || row['Status'] || 'New',
          notes: row.notes || row['Notes'] || 'Imported via Excel spreadsheet'
        }, author);

        importedCount++;
        createdLeads.push(newLead);
      } catch (e) {
        skippedCount++;
        skippedReasons.push(`Row ${i + 1} (${name}): ${e.message}`);
      }
    }

    return {
      success: true,
      importedCount,
      skippedCount,
      skippedReasons,
      createdLeads
    };
  },

  // --------------------------------------------------------------------------
  // DOMAIN & HOSTING MANAGEMENT MODULE
  // --------------------------------------------------------------------------
  calculateDomainStatus(expiryDate) {
    if (!expiryDate) {
      return { status: 'Active', daysRemaining: 999, label: 'No Expiry Set', badgeClass: 'badge-success', isExpired: false, isExpiringSoon: false, isActive: true };
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const parts = String(expiryDate).split('-');
    let exp;
    if (parts.length === 3) {
      exp = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      exp = new Date(expiryDate);
    }
    
    const diffTime = exp.getTime() - today.getTime();
    const daysRemaining = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (daysRemaining < 0) {
      const daysAgo = Math.abs(daysRemaining);
      return {
        status: 'Expired',
        daysRemaining,
        label: daysAgo === 1 ? 'Expired yesterday' : `Expired ${daysAgo} days ago`,
        badgeClass: 'badge-danger',
        isExpired: true,
        isExpiringSoon: false,
        isActive: false
      };
    } else if (daysRemaining <= 30) {
      return {
        status: 'Expiring Soon',
        daysRemaining,
        label: daysRemaining === 0 ? 'Expires today' : (daysRemaining === 1 ? 'Expires tomorrow' : `Expires in ${daysRemaining} days`),
        badgeClass: 'badge-warning',
        isExpired: false,
        isExpiringSoon: true,
        isActive: false,
        needsReminder: true
      };
    } else {
      return {
        status: 'Active',
        daysRemaining,
        label: `Active (${daysRemaining} days left)`,
        badgeClass: 'badge-success',
        isExpired: false,
        isExpiringSoon: false,
        isActive: true
      };
    }
  },

  checkDomainReminders() {
    const db = this.load();
    if (!Array.isArray(db.domains)) db.domains = [];
    if (!Array.isArray(db.notifications)) db.notifications = [];
    
    const triggered = [];
    const now = new Date().toISOString();
    let dbModified = false;
    
    db.domains.forEach(d => {
      const statusInfo = this.calculateDomainStatus(d.expiryDate);
      const days = statusInfo.daysRemaining;
      d.computedStatus = statusInfo.status;
      d.daysRemaining = days;
      d.remindersSent = d.remindersSent || {};
      
      const thresholds = [
        { days: 30, key: '30', urgency: 'Low', title: 'Domain Renewal Reminder (30 Days)' },
        { days: 15, key: '15', urgency: 'Medium', title: 'Domain Renewal Alert (15 Days)' },
        { days: 7, key: '7', urgency: 'High', title: 'CRITICAL: Domain Renewal Due (7 Days)' }
      ];
      
      thresholds.forEach(t => {
        if (days <= t.days && days >= 0 && !d.remindersSent[t.key]) {
          d.remindersSent[t.key] = true;
          dbModified = true;
          const clientText = d.clientName ? ` for Client "${d.clientName}"${d.projectName ? ` (Project: "${d.projectName}")` : ''}` : '';
          const notif = {
            id: `N-${Date.now()}-dom-${t.key}-${Math.random().toString(36).substring(2, 6)}`,
            role: 'admin',
            type: 'domain_renewal',
            title: t.title,
            message: `Domain "${d.domainName}"${clientText} expires in ${days} days on ${d.expiryDate}. Estimated renewal cost: ${d.renewalCost || 0}.`,
            text: `Domain "${d.domainName}" [${d.clientName || 'Client'} / ${d.projectName || 'Project'}] expires in ${days} days (${d.expiryDate}).`,
            domainId: d.id,
            domainName: d.domainName,
            clientId: d.clientId || '',
            clientName: d.clientName || '',
            projectId: d.projectId || '',
            projectName: d.projectName || '',
            urgency: t.urgency,
            time: 'Just now',
            createdAt: now,
            read: false
          };
          db.notifications.unshift(notif);
          triggered.push({ domainId: d.id, domainName: d.domainName, threshold: t.days, daysRemaining: days, clientId: d.clientId, projectId: d.projectId });
        }
      });
    });
    
    if (dbModified || triggered.length > 0) {
      this.save(db);
    }
    return triggered;
  },

  getDomains(filters = {}) {
    const db = this.load();
    let domains = Array.isArray(db.domains) ? [...db.domains] : [];
    
    domains = domains.map(d => {
      const statusInfo = this.calculateDomainStatus(d.expiryDate);
      let clientName = d.clientName || '';
      let projectName = d.projectName || '';
      if (d.clientId) {
        const cl = (db.clients || []).find(c => c.id === d.clientId);
        if (cl) {
          clientName = cl.name + (cl.company ? ` (${cl.company})` : '');
          if (d.projectId && Array.isArray(cl.projects)) {
            const proj = cl.projects.find(p => p.id === d.projectId);
            if (proj) {
              projectName = proj.name || proj.projectName || projectName;
            }
          }
        }
      }
      return {
        ...d,
        clientName: clientName || d.clientName || '',
        projectName: projectName || d.projectName || '',
        computedStatus: statusInfo.status,
        daysRemaining: statusInfo.daysRemaining,
        statusLabel: statusInfo.label,
        badgeClass: statusInfo.badgeClass
      };
    });
    
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      domains = domains.filter(d => 
        (d.domainName && d.domainName.toLowerCase().includes(q)) ||
        (d.registrar && d.registrar.toLowerCase().includes(q)) ||
        (d.hostingProvider && d.hostingProvider.toLowerCase().includes(q)) ||
        (d.hostingPlan && d.hostingPlan.toLowerCase().includes(q)) ||
        (d.clientName && d.clientName.toLowerCase().includes(q)) ||
        (d.projectName && d.projectName.toLowerCase().includes(q)) ||
        (d.serverIp && d.serverIp.toLowerCase().includes(q)) ||
        (d.assignedStaffName && d.assignedStaffName.toLowerCase().includes(q)) ||
        (d.notes && d.notes.toLowerCase().includes(q))
      );
    }
    
    if (filters.status && filters.status !== 'all' && filters.status !== 'All') {
      domains = domains.filter(d => (d.computedStatus || '').toLowerCase() === filters.status.toLowerCase());
    }
    
    if (filters.ownerType && filters.ownerType !== 'all' && filters.ownerType !== 'All') {
      domains = domains.filter(d => (d.ownerType || '').toLowerCase() === filters.ownerType.toLowerCase());
    }
    
    if (filters.clientId && filters.clientId !== 'all' && filters.clientId !== 'All') {
      if (filters.clientId === 'company') {
        domains = domains.filter(d => d.clientId === 'CLI-WP-INTERNAL' || (d.ownerType || '').toLowerCase() === 'company');
      } else if (filters.clientId === 'client') {
        domains = domains.filter(d => d.clientId && d.clientId !== 'CLI-WP-INTERNAL');
      } else {
        domains = domains.filter(d => d.clientId === filters.clientId);
      }
    }
    
    if (filters.projectId && filters.projectId !== 'all' && filters.projectId !== 'All') {
      if (filters.projectId === 'none' || filters.projectId === 'unassigned') {
        domains = domains.filter(d => !d.projectId);
      } else {
        domains = domains.filter(d => d.projectId === filters.projectId);
      }
    }
    
    if (filters.registrar && filters.registrar !== 'all' && filters.registrar !== 'All') {
      domains = domains.filter(d => (d.registrar || '').toLowerCase().includes(filters.registrar.toLowerCase().trim()));
    }
    
    if (filters.hostingProvider && filters.hostingProvider !== 'all' && filters.hostingProvider !== 'All') {
      domains = domains.filter(d => (d.hostingProvider || '').toLowerCase().includes(filters.hostingProvider.toLowerCase().trim()));
    }

    // Expiry Date Filters: Expired, Expiring in 7, 15, 30, 60 days, or Custom Date Range
    if (filters.expiryFilter && filters.expiryFilter !== 'all' && filters.expiryFilter !== 'All') {
      const ef = String(filters.expiryFilter).toLowerCase().trim();
      if (ef === 'expired') {
        domains = domains.filter(d => d.daysRemaining < 0);
      } else if (ef === '7days' || ef === '7' || ef === 'expiring-7') {
        domains = domains.filter(d => d.daysRemaining >= 0 && d.daysRemaining <= 7);
      } else if (ef === '15days' || ef === '15' || ef === 'expiring-15') {
        domains = domains.filter(d => d.daysRemaining >= 0 && d.daysRemaining <= 15);
      } else if (ef === '30days' || ef === '30' || ef === 'expiring-30') {
        domains = domains.filter(d => d.daysRemaining >= 0 && d.daysRemaining <= 30);
      } else if (ef === '60days' || ef === '60' || ef === 'expiring-60') {
        domains = domains.filter(d => d.daysRemaining >= 0 && d.daysRemaining <= 60);
      } else if (ef === 'custom') {
        if (filters.startDate) {
          domains = domains.filter(d => d.expiryDate && d.expiryDate >= filters.startDate);
        }
        if (filters.endDate) {
          domains = domains.filter(d => d.expiryDate && d.expiryDate <= filters.endDate);
        }
      }
    }

    // Custom Date Range filter applied directly if startDate or endDate provided
    if (filters.startDate && filters.expiryFilter !== 'custom') {
      domains = domains.filter(d => d.expiryDate && d.expiryDate >= filters.startDate);
    }
    if (filters.endDate && filters.expiryFilter !== 'custom') {
      domains = domains.filter(d => d.expiryDate && d.expiryDate <= filters.endDate);
    }
    
    const sortBy = filters.sortBy || 'expiry-asc';
    if (sortBy === 'expiry-asc' || sortBy === 'nearest-expiry') {
      domains.sort((a, b) => {
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return a.daysRemaining - b.daysRemaining || a.expiryDate.localeCompare(b.expiryDate);
      });
    } else if (sortBy === 'expiry-desc' || sortBy === 'latest-expiry') {
      domains.sort((a, b) => {
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return b.daysRemaining - a.daysRemaining || b.expiryDate.localeCompare(a.expiryDate);
      });
    } else if (sortBy === 'name-asc') {
      domains.sort((a, b) => (a.domainName || '').localeCompare(b.domainName || ''));
    } else if (sortBy === 'name-desc') {
      domains.sort((a, b) => (b.domainName || '').localeCompare(a.domainName || ''));
    } else if (sortBy === 'client-asc') {
      domains.sort((a, b) => (a.clientName || (a.ownerType === 'company' ? 'Company Internal' : '')).localeCompare(b.clientName || (b.ownerType === 'company' ? 'Company Internal' : '')));
    } else if (sortBy === 'client-desc') {
      domains.sort((a, b) => (b.clientName || (b.ownerType === 'company' ? 'Company Internal' : '')).localeCompare(a.clientName || (a.ownerType === 'company' ? 'Company Internal' : '')));
    } else if (sortBy === 'project-asc') {
      domains.sort((a, b) => (a.projectName || '').localeCompare(b.projectName || ''));
    } else if (sortBy === 'project-desc') {
      domains.sort((a, b) => (b.projectName || '').localeCompare(a.projectName || ''));
    } else if (sortBy === 'host-asc') {
      domains.sort((a, b) => (a.hostingProvider || '').localeCompare(b.hostingProvider || ''));
    } else if (sortBy === 'host-desc') {
      domains.sort((a, b) => (b.hostingProvider || '').localeCompare(a.hostingProvider || ''));
    } else if (sortBy === 'regdate-asc') {
      domains.sort((a, b) => (a.registrationDate || '').localeCompare(b.registrationDate || ''));
    } else if (sortBy === 'regdate-desc') {
      domains.sort((a, b) => (b.registrationDate || '').localeCompare(a.registrationDate || ''));
    } else if (sortBy === 'status-asc') {
      domains.sort((a, b) => (a.computedStatus || '').localeCompare(b.computedStatus || ''));
    } else if (sortBy === 'status-desc') {
      domains.sort((a, b) => (b.computedStatus || '').localeCompare(a.computedStatus || ''));
    } else if (sortBy === 'cost-desc') {
      domains.sort((a, b) => (Number(b.renewalCost) || 0) - (Number(a.renewalCost) || 0));
    } else if (sortBy === 'cost-asc') {
      domains.sort((a, b) => (Number(a.renewalCost) || 0) - (Number(b.renewalCost) || 0));
    } else if (sortBy === 'created-desc') {
      domains.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (sortBy === 'created-asc') {
      domains.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    }
    
    return domains;
  },

  getDomainById(id) {
    const db = this.load();
    const d = (db.domains || []).find(x => x.id === id);
    if (!d) return null;
    const statusInfo = this.calculateDomainStatus(d.expiryDate);

    let clientProfile = null;
    let projectDetails = null;
    let liveClientName = d.clientName || '';
    let liveProjectName = d.projectName || '';

    if (d.clientId) {
      const cl = (db.clients || []).find(c => c.id === d.clientId);
      if (cl) {
        liveClientName = cl.name + (cl.company ? ` (${cl.company})` : '');
        const clientProjects = Array.isArray(cl.projects) ? cl.projects : [];
        const activeProjectsCount = clientProjects.filter(p => {
          const st = (p.status || p.projectStatus || '').toLowerCase();
          return st === 'in progress' || st === 'planning';
        }).length;
        const totalVal = clientProjects.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
        const totalPaid = clientProjects.reduce((acc, p) => {
          const adv = Number(p.advancePaid) || 0;
          const add = Array.isArray(p.additionalPayments) ? p.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
          return acc + adv + add;
        }, 0);
        const totalDue = Math.max(0, totalVal - totalPaid);

        clientProfile = {
          id: cl.id,
          name: cl.name,
          company: cl.company || '',
          phone: cl.phone || '',
          email: cl.email || '',
          address: cl.address || '',
          status: cl.status || (activeProjectsCount > 0 ? 'Active' : 'Inactive'),
          totalProjects: clientProjects.length,
          activeProjects: activeProjectsCount,
          portfolioValue: totalVal,
          totalPaid: totalPaid,
          balanceDue: totalDue,
          createdAt: cl.createdAt
        };

        if (d.projectId && clientProjects.length > 0) {
          const pr = clientProjects.find(p => p.id === d.projectId);
          if (pr) {
            liveProjectName = pr.name || pr.projectName || liveProjectName;
            const pAmt = Number(pr.amount) || 0;
            const pAdv = Number(pr.advancePaid) || 0;
            const pAdd = Array.isArray(pr.additionalPayments) ? pr.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
            const pPaid = pAdv + pAdd;
            const pDue = Math.max(0, pAmt - pPaid);

            let staffName = pr.assignedStaffName || '';
            if (pr.assignedStaff && !staffName) {
              const stObj = (db.staff || []).find(s => s.id === pr.assignedStaff);
              if (stObj) staffName = `${stObj.name} (${stObj.position || 'Lead'})`;
            }

            projectDetails = {
              ...pr,
              totalAmount: pAmt,
              advancePaid: pAdv,
              totalPaid: pPaid,
              balanceDue: pDue,
              assignedStaffName: staffName || 'Unassigned',
              progress: Math.min(100, Math.max(0, Number(pr.progress) || 0))
            };
          }
        }
      }
    } else if (d.ownerType === 'company') {
      liveClientName = '';
      liveProjectName = '';
    }

    return {
      ...d,
      clientName: d.ownerType === 'client' ? liveClientName : '',
      projectName: d.ownerType === 'client' ? liveProjectName : '',
      computedStatus: statusInfo.status,
      daysRemaining: statusInfo.daysRemaining,
      statusLabel: statusInfo.label,
      badgeClass: statusInfo.badgeClass,
      clientProfile,
      projectDetails
    };
  },

  getDomainSummary() {
    const db = this.load();
    const domains = Array.isArray(db.domains) ? db.domains : [];
    
    let total = domains.length;
    let active = 0;
    let expiringSoon = 0;
    let expired = 0;
    let companyOwned = 0;
    let clientOwned = 0;
    let totalRenewalCost = 0;
    let renewal30Days = 0;
    let renewal15Days = 0;
    let renewal7Days = 0;
    
    domains.forEach(d => {
      const statusInfo = this.calculateDomainStatus(d.expiryDate);
      if (statusInfo.status === 'Active') active++;
      else if (statusInfo.status === 'Expiring Soon') expiringSoon++;
      else if (statusInfo.status === 'Expired') expired++;
      
      if (d.ownerType === 'company') companyOwned++;
      else if (d.ownerType === 'client') clientOwned++;
      
      totalRenewalCost += (Number(d.renewalCost) || 0);
      
      if (statusInfo.daysRemaining <= 30 && statusInfo.daysRemaining >= 0) renewal30Days++;
      if (statusInfo.daysRemaining <= 15 && statusInfo.daysRemaining >= 0) renewal15Days++;
      if (statusInfo.daysRemaining <= 7 && statusInfo.daysRemaining >= 0) renewal7Days++;
    });
    
    return {
      total,
      active,
      expiringSoon,
      expired,
      companyOwned,
      clientOwned,
      totalRenewalCost,
      renewal30Days,
      renewal15Days,
      renewal7Days
    };
  },

  addDomain(data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.domains)) db.domains = [];
    
    const cleanName = (data.domainName || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!cleanName) {
      const err = new Error('Domain name is required');
      err.code = 'INVALID_DOMAIN';
      throw err;
    }
    
    const existing = db.domains.find(d => (d.domainName || '').toLowerCase() === cleanName);
    if (existing) {
      if ((data.id && existing.id === data.id) || (data.id && (existing.domainName || '').toLowerCase() === cleanName)) {
        return this.updateDomain(existing.id, data, author);
      }
      const err = new Error(`Domain "${cleanName}" is already registered in the system (ID: ${existing.id}).`);
      err.code = 'DUPLICATE_DOMAIN';
      err.duplicateDomain = existing;
      throw err;
    }
    
    const id = data.id || `DOM-${Date.now()}`;
    const now = new Date().toISOString();
    
    let clientId = (data.clientId || '').trim();
    let projectId = (data.projectId || '').trim();

    // Fallback if ownerType === 'company' was supplied by legacy script
    if (!clientId && data.ownerType === 'company') {
      const wpClient = (db.clients || []).find(c => c.id === 'CLI-WP-INTERNAL' || c.name === 'WorkPulse Internal') || (db.clients && db.clients[0]);
      if (wpClient) {
        clientId = wpClient.id;
        if (!projectId && Array.isArray(wpClient.projects) && wpClient.projects.length > 0) {
          projectId = wpClient.projects[0].id;
        }
      }
    }

    if (!clientId) {
      const err = new Error('Client selection is required. Every domain and hosting record must be linked to both a Client and a specific Project.');
      err.code = 'CLIENT_REQUIRED';
      throw err;
    }

    const cl = (db.clients || []).find(c => c.id === clientId);
    if (!cl) {
      const err = new Error('Selected client not found. Every domain must be linked to a valid Client.');
      err.code = 'CLIENT_NOT_FOUND';
      throw err;
    }

    if (!projectId) {
      const err = new Error('Project selection is required. Every domain and hosting record must be linked to a specific Project.');
      err.code = 'PROJECT_REQUIRED';
      throw err;
    }

    const proj = (cl.projects || []).find(p => p.id === projectId);
    if (!proj) {
      const err = new Error('Selected project not found under this client. Every domain must be linked to a specific Project.');
      err.code = 'PROJECT_NOT_FOUND';
      throw err;
    }

    const clientName = cl.name + (cl.company ? ` (${cl.company})` : '');
    const projectName = proj.name || proj.projectName || '';
    
    let assignedStaffName = data.assignedStaffName || '';
    if (data.assignedStaffId && !assignedStaffName) {
      const st = (db.staff || []).find(s => s.id === data.assignedStaffId);
      if (st) assignedStaffName = st.name;
    }
    
    const statusInfo = this.calculateDomainStatus(data.expiryDate);
    
    const newDomain = {
      id,
      domainName: cleanName,
      ownerType: 'client',
      clientId,
      clientName,
      projectId,
      projectName,
      registrar: (data.registrar || 'Namecheap').trim(),
      registrationDate: data.registrationDate || '',
      expiryDate: data.expiryDate || '',
      renewalCost: Number(data.renewalCost) || 0,
      currency: data.currency || 'USD',
      autoRenew: data.autoRenew === true || data.autoRenew === 'true' || data.autoRenew === 'yes',
      hostingProvider: (data.hostingProvider || 'AWS Route 53 / Cloud').trim(),
      hostingPlan: (data.hostingPlan || 'Standard').trim(),
      hostingExpiryDate: data.hostingExpiryDate || '',
      serverIp: (data.serverIp || '').trim(),
      nameservers: (data.nameservers || '').trim(),
      sslStatus: data.sslStatus || 'Active',
      sslExpiryDate: data.sslExpiryDate || '',
      sslIssuer: (data.sslIssuer || "Let's Encrypt").trim(),
      assignedStaffId: data.assignedStaffId || '',
      assignedStaffName,
      notes: (data.notes || '').trim(),
      documents: Array.isArray(data.documents) ? data.documents : [],
      renewalHistory: Array.isArray(data.renewalHistory) ? data.renewalHistory : [],
      status: statusInfo.status,
      remindersSent: {},
      createdAt: now,
      updatedAt: now
    };
    
    db.domains.unshift(newDomain);
    
    if (!Array.isArray(cl.activityHistory)) cl.activityHistory = [];
    cl.activityHistory.unshift({
      id: `ACT-${Date.now()}-dom`,
      type: 'domain_linked',
      title: 'Domain Linked',
      description: `Domain "${newDomain.domainName}" linked to client portfolio (Project: ${projectName}).`,
      author: author?.name || 'Administrator',
      timestamp: now
    });
    
    this.save(db);
    this.checkDomainReminders();
    return this.getDomainById(id);
  },

  updateDomain(id, data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.domains)) return null;
    
    const idx = db.domains.findIndex(d => d.id === id);
    if (idx === -1) return null;
    
    const current = db.domains[idx];
    
    if (data.domainName) {
      const cleanName = data.domainName.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const dup = db.domains.find(d => d.id !== id && (d.domainName || '').toLowerCase() === cleanName);
      if (dup) {
        const err = new Error(`Domain "${cleanName}" is already registered to another record (ID: ${dup.id}).`);
        err.code = 'DUPLICATE_DOMAIN';
        err.duplicateDomain = dup;
        throw err;
      }
    }
    
    let clientId = data.clientId !== undefined ? (data.clientId || '').trim() : (current.clientId || '');
    let projectId = data.projectId !== undefined ? (data.projectId || '').trim() : (current.projectId || '');

    // Fallback if ownerType === 'company' was supplied by legacy test
    if (!clientId && data.ownerType === 'company') {
      const wpClient = (db.clients || []).find(c => c.id === 'CLI-WP-INTERNAL' || c.name === 'WorkPulse Internal') || (db.clients && db.clients[0]);
      if (wpClient) {
        clientId = wpClient.id;
        if (!projectId && Array.isArray(wpClient.projects) && wpClient.projects.length > 0) {
          projectId = wpClient.projects[0].id;
        }
      }
    }

    if (!clientId) {
      const err = new Error('Client selection is required. Every domain and hosting record must be linked to both a Client and a specific Project.');
      err.code = 'CLIENT_REQUIRED';
      throw err;
    }

    const cl = (db.clients || []).find(c => c.id === clientId);
    if (!cl) {
      const err = new Error('Selected client not found. Every domain must be linked to a valid Client.');
      err.code = 'CLIENT_NOT_FOUND';
      throw err;
    }

    if (!projectId) {
      const err = new Error('Project selection is required. Every domain and hosting record must be linked to a specific Project.');
      err.code = 'PROJECT_REQUIRED';
      throw err;
    }

    const proj = (cl.projects || []).find(p => p.id === projectId);
    if (!proj) {
      const err = new Error('Selected project not found under this client. Every domain must be linked to a specific Project.');
      err.code = 'PROJECT_NOT_FOUND';
      throw err;
    }

    const clientName = cl.name + (cl.company ? ` (${cl.company})` : '');
    const projectName = proj.name || proj.projectName || '';
    const ownerType = 'client';
    
    let assignedStaffName = data.assignedStaffName !== undefined ? data.assignedStaffName : current.assignedStaffName;
    const assignedStaffId = data.assignedStaffId !== undefined ? data.assignedStaffId : current.assignedStaffId;
    if (assignedStaffId && (!assignedStaffName || assignedStaffId !== current.assignedStaffId)) {
      const st = (db.staff || []).find(s => s.id === assignedStaffId);
      if (st) assignedStaffName = st.name;
    }
    
    const expiryDate = data.expiryDate !== undefined ? data.expiryDate : current.expiryDate;
    const statusInfo = this.calculateDomainStatus(expiryDate);
    const now = new Date().toISOString();

    // Client portfolio activity history sync on reassignment / unlinking
    if (current.ownerType === 'client' && current.clientId && (ownerType !== 'client' || clientId !== current.clientId)) {
      const prevClient = (db.clients || []).find(c => c.id === current.clientId);
      if (prevClient) {
        if (!Array.isArray(prevClient.activityHistory)) prevClient.activityHistory = [];
        prevClient.activityHistory.unshift({
          id: `ACT-${Date.now()}-domun`,
          type: 'domain_unlinked',
          title: 'Domain Unlinked',
          description: `Domain "${current.domainName}" was ${ownerType === 'client' ? 'reassigned to another client portfolio' : 'converted to company-owned asset'}.`,
          author: author?.name || 'Administrator',
          timestamp: now
        });
      }
    }
    
    const updated = {
      ...current,
      domainName: data.domainName ? data.domainName.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : current.domainName,
      ownerType,
      clientId,
      clientName,
      projectId,
      projectName,
      registrar: data.registrar !== undefined ? (data.registrar || '').trim() : current.registrar,
      registrationDate: data.registrationDate !== undefined ? data.registrationDate : current.registrationDate,
      expiryDate,
      renewalCost: data.renewalCost !== undefined ? (Number(data.renewalCost) || 0) : current.renewalCost,
      currency: data.currency || current.currency,
      autoRenew: data.autoRenew !== undefined ? (data.autoRenew === true || data.autoRenew === 'true' || data.autoRenew === 'yes') : current.autoRenew,
      hostingProvider: data.hostingProvider !== undefined ? (data.hostingProvider || '').trim() : current.hostingProvider,
      hostingPlan: data.hostingPlan !== undefined ? (data.hostingPlan || '').trim() : current.hostingPlan,
      hostingExpiryDate: data.hostingExpiryDate !== undefined ? data.hostingExpiryDate : current.hostingExpiryDate,
      serverIp: data.serverIp !== undefined ? (data.serverIp || '').trim() : current.serverIp,
      nameservers: data.nameservers !== undefined ? (data.nameservers || '').trim() : current.nameservers,
      sslStatus: data.sslStatus !== undefined ? data.sslStatus : current.sslStatus,
      sslExpiryDate: data.sslExpiryDate !== undefined ? data.sslExpiryDate : current.sslExpiryDate,
      sslIssuer: data.sslIssuer !== undefined ? (data.sslIssuer || '').trim() : current.sslIssuer,
      assignedStaffId,
      assignedStaffName,
      notes: data.notes !== undefined ? (data.notes || '').trim() : current.notes,
      renewalHistory: Array.isArray(data.renewalHistory) ? data.renewalHistory : (current.renewalHistory || []),
      status: statusInfo.status,
      updatedAt: now
    };
    
    if (Array.isArray(data.documents)) {
      updated.documents = data.documents;
    }

    if (ownerType === 'client' && clientId && (current.ownerType !== 'client' || current.clientId !== clientId)) {
      const newClient = (db.clients || []).find(c => c.id === clientId);
      if (newClient) {
        if (!Array.isArray(newClient.activityHistory)) newClient.activityHistory = [];
        const projSuffix = projectName ? ` (Project: ${projectName})` : '';
        newClient.activityHistory.unshift({
          id: `ACT-${Date.now()}-domlk`,
          type: 'domain_linked',
          title: 'Domain Linked',
          description: `Domain "${updated.domainName}" linked to client portfolio${projSuffix}.`,
          author: author?.name || 'Administrator',
          timestamp: now
        });
      }
    }
    
    db.domains[idx] = updated;
    this.save(db);
    this.checkDomainReminders();
    return this.getDomainById(id);
  },

  deleteDomain(id, author = null) {
    const db = this.load();
    if (!Array.isArray(db.domains)) return false;
    
    const domain = db.domains.find(d => d.id === id);
    if (!domain) return false;

    db.domains = db.domains.filter(d => d.id !== id);

    if (domain.ownerType === 'client' && domain.clientId) {
      const cl = (db.clients || []).find(c => c.id === domain.clientId);
      if (cl) {
        if (!Array.isArray(cl.activityHistory)) cl.activityHistory = [];
        cl.activityHistory.unshift({
          id: `ACT-${Date.now()}-domdel`,
          type: 'domain_unlinked',
          title: 'Domain Deleted',
          description: `Domain "${domain.domainName}" was deleted from domain records.`,
          author: author?.name || 'Administrator',
          timestamp: new Date().toISOString()
        });
      }
    }

    this.save(db);
    return true;
  },

  recordDomainRenewal(id, renewalData = {}, author = null) {
    const db = this.load();
    if (!Array.isArray(db.domains)) return null;

    const idx = db.domains.findIndex(d => d.id === id);
    if (idx === -1) return null;

    const current = db.domains[idx];
    const now = new Date().toISOString();
    const renewalDate = renewalData.renewalDate || now.split('T')[0];
    const newExpiryDate = renewalData.newExpiryDate || '';
    const newHostingExpiryDate = renewalData.newHostingExpiryDate || current.hostingExpiryDate || '';
    const amount = Number(renewalData.amount) || Number(current.renewalCost) || 0;
    const currency = renewalData.currency || current.currency || 'USD';
    const paymentMethod = renewalData.paymentMethod || 'Corporate Card';
    const notes = (renewalData.notes || '').trim();

    const renewalEntry = {
      id: `REN-${Date.now()}`,
      renewalDate,
      previousExpiryDate: current.expiryDate,
      newExpiryDate: newExpiryDate || current.expiryDate,
      previousHostingExpiryDate: current.hostingExpiryDate,
      newHostingExpiryDate,
      amount,
      currency,
      paymentMethod,
      registrar: current.registrar,
      hostingProvider: current.hostingProvider,
      notes: notes || 'Domain & Hosting renewal cycle logged',
      recordedBy: author?.name || 'Administrator',
      timestamp: now
    };

    if (!Array.isArray(current.renewalHistory)) {
      current.renewalHistory = [];
    }
    current.renewalHistory.unshift(renewalEntry);

    if (newExpiryDate) {
      current.expiryDate = newExpiryDate;
    }
    if (newHostingExpiryDate) {
      current.hostingExpiryDate = newHostingExpiryDate;
    }
    if (renewalData.amount !== undefined) {
      current.renewalCost = amount;
    }
    if (renewalData.currency) {
      current.currency = currency;
    }
    current.updatedAt = now;

    const statusInfo = this.calculateDomainStatus(current.expiryDate);
    current.status = statusInfo.status;

    db.domains[idx] = current;

    if (current.clientId) {
      const cl = (db.clients || []).find(c => c.id === current.clientId);
      if (cl) {
        if (!Array.isArray(cl.activityHistory)) cl.activityHistory = [];
        cl.activityHistory.unshift({
          id: `ACT-${Date.now()}-domren`,
          type: 'domain_renewed',
          title: 'Domain & Hosting Renewed',
          description: `Domain "${current.domainName}" (Project: "${current.projectName || 'Project'}") renewed until ${current.expiryDate} (${currency} ${amount.toLocaleString()}).`,
          author: author?.name || 'Administrator',
          timestamp: now
        });
      }
    }

    this.save(db);
    this.checkDomainReminders();
    return this.getDomainById(id);
  },

  // --------------------------------------------------------------------------
  // MISCELLANEOUS MODULE: GENERAL REQUESTS
  // --------------------------------------------------------------------------
  getGeneralRequests(filters = {}) {
    const db = this.load();
    let list = Array.isArray(db.generalRequests) ? [...db.generalRequests] : [];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(r =>
        (r.title && r.title.toLowerCase().includes(q)) ||
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.requestedByName && r.requestedByName.toLowerCase().includes(q)) ||
        (r.assignedStaffName && r.assignedStaffName.toLowerCase().includes(q)) ||
        (r.category && r.category.toLowerCase().includes(q))
      );
    }
    if (filters.status && filters.status !== 'all') {
      list = list.filter(r => (r.status || '').toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.priority && filters.priority !== 'all') {
      list = list.filter(r => (r.priority || '').toLowerCase() === filters.priority.toLowerCase());
    }
    if (filters.category && filters.category !== 'all') {
      list = list.filter(r => (r.category || '').toLowerCase() === filters.category.toLowerCase());
    }
    if (filters.staffId && filters.staffId !== 'all') {
      list = list.filter(r => r.assignedStaffId === filters.staffId || r.requestedById === filters.staffId || r.staffId === filters.staffId);
    }
    if (filters.requestedById) {
      list = list.filter(r => r.requestedById === filters.requestedById);
    }

    return list.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
  },

  addGeneralRequest(data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.generalRequests)) db.generalRequests = [];

    const now = new Date().toISOString();
    const reqId = `REQ-${Date.now()}`;
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorId = author?.id || (author?.role === 'admin' ? 'WP-ADMIN' : '');

    const newReq = {
      id: reqId,
      title: (data.title || '').trim(),
      description: (data.description || '').trim(),
      category: data.category || 'Equipment',
      staffId: data.staffId || data.requestedById || authorId,
      staffName: data.staffName || data.requestedByName || authorName,
      requestedById: data.requestedById || data.staffId || authorId,
      requestedByName: data.requestedByName || data.staffName || authorName,
      assignedStaffId: data.assignedStaffId || '',
      assignedStaffName: data.assignedStaffName || 'Unassigned',
      priority: data.priority || 'Medium',
      date: data.date || data.neededByDate || now.split('T')[0],
      neededByDate: data.neededByDate || data.date || '',
      status: data.status || 'Pending',
      comments: Array.isArray(data.comments) ? data.comments : [],
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      createdAt: now,
      updatedAt: now
    };

    const initialText = (data.initialComment || data.note || data.remark || '').trim();
    if (initialText) {
      newReq.comments.push({
        id: `CMT-${Date.now()}`,
        author: authorName,
        authorRole: author?.role || (authorId.startsWith('WP-1') ? 'staff' : 'admin'),
        text: initialText,
        createdAt: now
      });
      newReq.note = initialText;
    }

    db.generalRequests.unshift(newReq);

    // Notify Admin of new staff request
    if (newReq.requestedById !== 'WP-ADMIN') {
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-req`,
        role: 'admin',
        title: 'New General Request Submitted',
        message: `${newReq.requestedByName} submitted request: "${newReq.title}" (${newReq.priority} priority)`,
        text: `${newReq.requestedByName} requested: ${newReq.title}`,
        time: 'Just now',
        createdAt: 'Just now',
        read: false
      });
    }

    this.save(db);
    return newReq;
  },

  updateGeneralRequest(id, data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.generalRequests)) return null;

    const idx = db.generalRequests.findIndex(r => r.id === id);
    if (idx === -1) return null;

    const current = db.generalRequests[idx];
    const prevStatus = current.status;
    const now = new Date().toISOString();

    const updated = {
      ...current,
      title: data.title !== undefined ? (data.title || '').trim() : current.title,
      description: data.description !== undefined ? (data.description || '').trim() : current.description,
      category: data.category || current.category,
      priority: data.priority || current.priority,
      date: data.date || current.date,
      status: data.status || current.status,
      assignedStaffId: data.assignedStaffId !== undefined ? data.assignedStaffId : current.assignedStaffId,
      assignedStaffName: data.assignedStaffName !== undefined ? data.assignedStaffName : current.assignedStaffName,
      adminComment: data.adminComment !== undefined ? data.adminComment : current.adminComment,
      rejectionReason: data.rejectionReason !== undefined ? data.rejectionReason : (data.adminComment || current.rejectionReason),
      updatedAt: now
    };

    if (Array.isArray(data.attachments)) {
      updated.attachments = data.attachments;
    }

    // Status change notification to requester
    if (data.status && data.status !== prevStatus && current.requestedById && current.requestedById !== 'WP-ADMIN') {
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-req-st`,
        role: 'staff',
        staffId: current.requestedById,
        title: `Request Status Updated: ${data.status}`,
        message: `Your request "${current.title}" was updated to status "${data.status}".`,
        text: `Request "${current.title}" is now ${data.status}`,
        time: 'Just now',
        createdAt: 'Just now',
        read: false
      });
    }

    db.generalRequests[idx] = updated;
    this.save(db);
    return updated;
  },

  deleteGeneralRequest(id, author = null) {
    const db = this.load();
    if (!Array.isArray(db.generalRequests)) return false;
    const initialLen = db.generalRequests.length;
    db.generalRequests = db.generalRequests.filter(r => r.id !== id);
    if (db.generalRequests.length !== initialLen) {
      this.save(db);
      return true;
    }
    return false;
  },

  addGeneralRequestComment(id, text, author = null) {
    const db = this.load();
    if (!Array.isArray(db.generalRequests)) return null;
    const req = db.generalRequests.find(r => r.id === id);
    if (!req) return null;

    if (!Array.isArray(req.comments)) req.comments = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorRole = author?.role || (author?.id?.startsWith('WP-1') ? 'staff' : 'admin');
    const now = new Date().toISOString();

    const comment = {
      id: `CMT-${Date.now()}`,
      author: authorName,
      authorRole,
      text: (text || '').trim(),
      createdAt: now
    };

    req.comments.push(comment);
    req.updatedAt = now;
    this.save(db);
    return comment;
  },

  // --------------------------------------------------------------------------
  // MISCELLANEOUS MODULE: OFFICE ASSETS & INVENTORY
  // --------------------------------------------------------------------------
  getOfficeAssets(filters = {}) {
    const db = this.load();
    let list = Array.isArray(db.officeAssets) ? [...db.officeAssets] : [];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(a =>
        (a.title && a.title.toLowerCase().includes(q)) ||
        (a.description && a.description.toLowerCase().includes(q)) ||
        (a.assetTag && a.assetTag.toLowerCase().includes(q)) ||
        (a.assignedStaffName && a.assignedStaffName.toLowerCase().includes(q)) ||
        (a.category && a.category.toLowerCase().includes(q))
      );
    }
    if (filters.status && filters.status !== 'all') {
      list = list.filter(a => (a.status || '').toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.priority && filters.priority !== 'all') {
      list = list.filter(a => (a.priority || '').toLowerCase() === filters.priority.toLowerCase());
    }
    if (filters.category && filters.category !== 'all') {
      list = list.filter(a => (a.category || '').toLowerCase() === filters.category.toLowerCase());
    }
    if (filters.staffId && filters.staffId !== 'all') {
      if (filters.staffId === 'unassigned') {
        list = list.filter(a => !a.assignedStaffId || a.assignedStaffId === '');
      } else {
        list = list.filter(a => a.assignedStaffId === filters.staffId);
      }
    }
    if (filters.condition && filters.condition !== 'all') {
      list = list.filter(a => (a.condition || '').toLowerCase() === filters.condition.toLowerCase());
    }

    return list.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
  },

  addOfficeAsset(data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.officeAssets)) db.officeAssets = [];

    const now = new Date().toISOString();
    const assetId = `AST-${Date.now()}`;
    const nextSeq = (db.officeAssets.length + 1).toString().padStart(3, '0');
    const assetTag = data.assetTag && data.assetTag.trim() ? data.assetTag.trim() : `WP-AST-${new Date().getFullYear()}-${nextSeq}`;

    const newAsset = {
      id: assetId,
      assetTag,
      title: (data.title || '').trim(),
      description: (data.description || '').trim(),
      category: data.category || 'IT Hardware',
      assignedStaffId: data.assignedStaffId || '',
      assignedStaffName: data.assignedStaffName || 'Unassigned',
      priority: data.priority || 'Medium',
      date: data.date || now.split('T')[0],
      returnDate: data.returnDate || '',
      status: data.status || (data.assignedStaffId ? 'Assigned' : 'Available'),
      condition: data.condition || 'Excellent',
      comments: Array.isArray(data.comments) ? data.comments : [],
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      createdAt: now,
      updatedAt: now
    };

    if (data.initialComment && data.initialComment.trim()) {
      newAsset.comments.push({
        id: `CMT-${Date.now()}`,
        author: author?.name || 'Administrator',
        authorRole: author?.role || 'admin',
        text: data.initialComment.trim(),
        createdAt: now
      });
    }

    db.officeAssets.unshift(newAsset);

    // Notify assigned staff
    if (newAsset.assignedStaffId && newAsset.assignedStaffId !== 'WP-ADMIN') {
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-ast`,
        role: 'staff',
        staffId: newAsset.assignedStaffId,
        title: 'New Office Asset Assigned',
        message: `Equipment allocated to you: "${newAsset.title}" (Tag: ${newAsset.assetTag}).`,
        text: `Asset "${newAsset.title}" assigned to you`,
        time: 'Just now',
        createdAt: 'Just now',
        read: false
      });
    }

    this.save(db);
    return newAsset;
  },

  updateOfficeAsset(id, data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.officeAssets)) return null;

    const idx = db.officeAssets.findIndex(a => a.id === id);
    if (idx === -1) return null;

    const current = db.officeAssets[idx];
    const prevAssignee = current.assignedStaffId;
    const now = new Date().toISOString();

    const updated = {
      ...current,
      assetTag: data.assetTag !== undefined ? (data.assetTag || '').trim() : current.assetTag,
      title: data.title !== undefined ? (data.title || '').trim() : current.title,
      description: data.description !== undefined ? (data.description || '').trim() : current.description,
      category: data.category || current.category,
      priority: data.priority || current.priority,
      date: data.date || current.date,
      returnDate: data.returnDate !== undefined ? data.returnDate : current.returnDate,
      status: data.status || current.status,
      condition: data.condition || current.condition,
      assignedStaffId: data.assignedStaffId !== undefined ? data.assignedStaffId : current.assignedStaffId,
      assignedStaffName: data.assignedStaffName !== undefined ? data.assignedStaffName : current.assignedStaffName,
      adminComment: data.adminComment !== undefined ? data.adminComment : current.adminComment,
      rejectionReason: data.rejectionReason !== undefined ? data.rejectionReason : (data.adminComment || current.rejectionReason),
      updatedAt: now
    };

    if (Array.isArray(data.attachments)) {
      updated.attachments = data.attachments;
    }

    // Auto-update status based on assignee
    if (data.status === undefined) {
      if (updated.assignedStaffId && updated.assignedStaffId !== '') {
        if (updated.status === 'Available') updated.status = 'Assigned';
      } else {
        if (updated.status === 'Assigned') updated.status = 'Available';
      }
    }

    // Notify newly assigned staff
    if (updated.assignedStaffId && updated.assignedStaffId !== prevAssignee && updated.assignedStaffId !== 'WP-ADMIN') {
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-ast-ch`,
        role: 'staff',
        staffId: updated.assignedStaffId,
        title: 'Office Asset Reassigned',
        message: `Equipment assigned to you: "${updated.title}" (${updated.assetTag}).`,
        text: `Asset "${updated.title}" assigned to you`,
        time: 'Just now',
        createdAt: 'Just now',
        read: false
      });
    }

    db.officeAssets[idx] = updated;
    this.save(db);
    return updated;
  },

  deleteOfficeAsset(id, author = null) {
    const db = this.load();
    if (!Array.isArray(db.officeAssets)) return false;
    const initialLen = db.officeAssets.length;
    db.officeAssets = db.officeAssets.filter(a => a.id !== id);
    if (db.officeAssets.length !== initialLen) {
      this.save(db);
      return true;
    }
    return false;
  },

  addOfficeAssetComment(id, text, author = null) {
    const db = this.load();
    if (!Array.isArray(db.officeAssets)) return null;
    const asset = db.officeAssets.find(a => a.id === id);
    if (!asset) return null;

    if (!Array.isArray(asset.comments)) asset.comments = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorRole = author?.role || (author?.id?.startsWith('WP-1') ? 'staff' : 'admin');
    const now = new Date().toISOString();

    const comment = {
      id: `CMT-${Date.now()}`,
      author: authorName,
      authorRole,
      text: (text || '').trim(),
      createdAt: now
    };

    asset.comments.push(comment);
    asset.updatedAt = now;
    this.save(db);
    return comment;
  },

  // --------------------------------------------------------------------------
  // MISCELLANEOUS MODULE: OFFICE MAINTENANCE
  // --------------------------------------------------------------------------
  getMaintenanceIssues(filters = {}) {
    const db = this.load();
    let list = Array.isArray(db.maintenanceIssues) ? [...db.maintenanceIssues] : [];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(m =>
        (m.title && m.title.toLowerCase().includes(q)) ||
        (m.description && m.description.toLowerCase().includes(q)) ||
        (m.location && m.location.toLowerCase().includes(q)) ||
        (m.reportedByName && m.reportedByName.toLowerCase().includes(q)) ||
        (m.assignedStaffName && m.assignedStaffName.toLowerCase().includes(q)) ||
        (m.category && m.category.toLowerCase().includes(q))
      );
    }
    if (filters.status && filters.status !== 'all') {
      list = list.filter(m => (m.status || '').toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.priority && filters.priority !== 'all') {
      list = list.filter(m => (m.priority || '').toLowerCase() === filters.priority.toLowerCase());
    }
    if (filters.category && filters.category !== 'all') {
      list = list.filter(m => (m.category || '').toLowerCase() === filters.category.toLowerCase());
    }
    if (filters.staffId && filters.staffId !== 'all') {
      list = list.filter(m => m.assignedStaffId === filters.staffId || m.reportedById === filters.staffId);
    }
    if (filters.reportedById) {
      list = list.filter(m => m.reportedById === filters.reportedById);
    }

    return list.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
  },

  addMaintenanceIssue(data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.maintenanceIssues)) db.maintenanceIssues = [];

    const now = new Date().toISOString();
    const issueId = `MNT-${Date.now()}`;
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorId = author?.id || (author?.role === 'admin' ? 'WP-ADMIN' : '');

    const newIssue = {
      id: issueId,
      title: (data.title || '').trim(),
      description: (data.description || '').trim(),
      location: (data.location || '').trim() || 'Headquarters Office',
      category: data.category || 'Facility & Structural',
      assignedStaffId: data.assignedStaffId || '',
      assignedStaffName: data.assignedStaffName || 'Facility Vendor / Staff',
      reportedById: data.reportedById || authorId,
      reportedByName: data.reportedByName || authorName,
      priority: data.priority || 'Medium',
      date: data.date || now.split('T')[0],
      targetDate: data.targetDate || '',
      status: data.status || 'Reported',
      comments: Array.isArray(data.comments) ? data.comments : [],
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      createdAt: now,
      updatedAt: now
    };

    if (data.initialComment && data.initialComment.trim()) {
      newIssue.comments.push({
        id: `CMT-${Date.now()}`,
        author: authorName,
        authorRole: author?.role || (authorId.startsWith('WP-1') ? 'staff' : 'admin'),
        text: data.initialComment.trim(),
        createdAt: now
      });
    }

    db.maintenanceIssues.unshift(newIssue);

    // Notify Admin of new reported maintenance issue
    if (newIssue.reportedById !== 'WP-ADMIN') {
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-mnt`,
        role: 'admin',
        title: 'New Maintenance Issue Reported',
        message: `${newIssue.reportedByName} reported issue: "${newIssue.title}" at ${newIssue.location}.`,
        text: `Maintenance reported: ${newIssue.title}`,
        time: 'Just now',
        createdAt: 'Just now',
        read: false
      });
    }

    this.save(db);
    return newIssue;
  },

  updateMaintenanceIssue(id, data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.maintenanceIssues)) return null;

    const idx = db.maintenanceIssues.findIndex(m => m.id === id);
    if (idx === -1) return null;

    const current = db.maintenanceIssues[idx];
    const prevStatus = current.status;
    const now = new Date().toISOString();

    const updated = {
      ...current,
      title: data.title !== undefined ? (data.title || '').trim() : current.title,
      description: data.description !== undefined ? (data.description || '').trim() : current.description,
      location: data.location !== undefined ? (data.location || '').trim() : current.location,
      category: data.category || current.category,
      priority: data.priority || current.priority,
      date: data.date || current.date,
      targetDate: data.targetDate !== undefined ? data.targetDate : current.targetDate,
      status: data.status || current.status,
      assignedStaffId: data.assignedStaffId !== undefined ? data.assignedStaffId : current.assignedStaffId,
      assignedStaffName: data.assignedStaffName !== undefined ? data.assignedStaffName : current.assignedStaffName,
      adminComment: data.adminComment !== undefined ? data.adminComment : current.adminComment,
      rejectionReason: data.rejectionReason !== undefined ? data.rejectionReason : (data.adminComment || current.rejectionReason),
      updatedAt: now
    };

    if (Array.isArray(data.attachments)) {
      updated.attachments = data.attachments;
    }

    // Status change notification to reporter
    if (data.status && data.status !== prevStatus && current.reportedById && current.reportedById !== 'WP-ADMIN') {
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-mnt-st`,
        role: 'staff',
        staffId: current.reportedById,
        title: `Maintenance Status: ${data.status}`,
        message: `Issue "${current.title}" has been updated to "${data.status}".`,
        text: `Maintenance "${current.title}" is now ${data.status}`,
        time: 'Just now',
        createdAt: 'Just now',
        read: false
      });
    }

    db.maintenanceIssues[idx] = updated;
    this.save(db);
    return updated;
  },

  deleteMaintenanceIssue(id, author = null) {
    const db = this.load();
    if (!Array.isArray(db.maintenanceIssues)) return false;
    const initialLen = db.maintenanceIssues.length;
    db.maintenanceIssues = db.maintenanceIssues.filter(m => m.id !== id);
    if (db.maintenanceIssues.length !== initialLen) {
      this.save(db);
      return true;
    }
    return false;
  },

  addMaintenanceComment(id, text, author = null) {
    const db = this.load();
    if (!Array.isArray(db.maintenanceIssues)) return null;
    const issue = db.maintenanceIssues.find(m => m.id === id);
    if (!issue) return null;

    if (!Array.isArray(issue.comments)) issue.comments = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorRole = author?.role || (author?.id?.startsWith('WP-1') ? 'staff' : 'admin');
    const now = new Date().toISOString();

    const comment = {
      id: `CMT-${Date.now()}`,
      author: authorName,
      authorRole,
      text: (text || '').trim(),
      createdAt: now
    };

    issue.comments.push(comment);
    issue.updatedAt = now;
    this.save(db);
    return comment;
  },

  // --------------------------------------------------------------------------
  // MISCELLANEOUS MODULE: INTERNAL NOTES & REMINDERS
  // --------------------------------------------------------------------------
  getInternalNotes(filters = {}) {
    const db = this.load();
    let list = Array.isArray(db.internalNotes) ? [...db.internalNotes] : [];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(n =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.description && n.description.toLowerCase().includes(q)) ||
        (n.category && n.category.toLowerCase().includes(q)) ||
        (n.assignedStaffName && n.assignedStaffName.toLowerCase().includes(q))
      );
    }
    if (filters.status && filters.status !== 'all') {
      list = list.filter(n => (n.status || '').toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.priority && filters.priority !== 'all') {
      list = list.filter(n => (n.priority || '').toLowerCase() === filters.priority.toLowerCase());
    }
    if (filters.category && filters.category !== 'all') {
      list = list.filter(n => (n.category || '').toLowerCase() === filters.category.toLowerCase());
    }
    if (filters.isPinned !== undefined) {
      list = list.filter(n => !!n.isPinned === !!filters.isPinned);
    }
    if (filters.staffId && filters.staffId !== 'all') {
      list = list.filter(n => n.assignedStaffId === 'all' || n.assignedStaffId === filters.staffId);
    }

    // Sort pinned first, then by date descending
    return list.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
    });
  },

  addInternalNote(data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.internalNotes)) db.internalNotes = [];

    const now = new Date().toISOString();
    const noteId = `NOT-${Date.now()}`;
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorId = author?.id || (author?.role === 'admin' ? 'WP-ADMIN' : '');

    const newNote = {
      id: noteId,
      title: (data.title || '').trim(),
      description: (data.description || '').trim(),
      category: data.category || 'Internal Policy',
      assignedStaffId: data.assignedStaffId || 'all',
      assignedStaffName: data.assignedStaffName || 'All Staff Members',
      priority: data.priority || 'Medium',
      date: data.date || now.split('T')[0],
      status: data.status || 'Active',
      isPinned: !!data.isPinned,
      createdById: data.createdById || authorId,
      createdByName: data.createdByName || authorName,
      comments: Array.isArray(data.comments) ? data.comments : [],
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      createdAt: now,
      updatedAt: now
    };

    if (data.initialComment && data.initialComment.trim()) {
      newNote.comments.push({
        id: `CMT-${Date.now()}`,
        author: authorName,
        authorRole: author?.role || 'admin',
        text: data.initialComment.trim(),
        createdAt: now
      });
    }

    db.internalNotes.unshift(newNote);
    this.save(db);
    return newNote;
  },

  updateInternalNote(id, data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.internalNotes)) return null;

    const idx = db.internalNotes.findIndex(n => n.id === id);
    if (idx === -1) return null;

    const current = db.internalNotes[idx];
    const now = new Date().toISOString();

    const updated = {
      ...current,
      title: data.title !== undefined ? (data.title || '').trim() : current.title,
      description: data.description !== undefined ? (data.description || '').trim() : current.description,
      category: data.category || current.category,
      priority: data.priority || current.priority,
      date: data.date || current.date,
      status: data.status || current.status,
      isPinned: data.isPinned !== undefined ? !!data.isPinned : current.isPinned,
      assignedStaffId: data.assignedStaffId !== undefined ? data.assignedStaffId : current.assignedStaffId,
      assignedStaffName: data.assignedStaffName !== undefined ? data.assignedStaffName : current.assignedStaffName,
      adminComment: data.adminComment !== undefined ? data.adminComment : current.adminComment,
      rejectionReason: data.rejectionReason !== undefined ? data.rejectionReason : (data.adminComment || current.rejectionReason),
      updatedAt: now
    };

    if (Array.isArray(data.attachments)) {
      updated.attachments = data.attachments;
    }

    db.internalNotes[idx] = updated;
    this.save(db);
    return updated;
  },

  deleteInternalNote(id, author = null) {
    const db = this.load();
    if (!Array.isArray(db.internalNotes)) return false;
    const initialLen = db.internalNotes.length;
    db.internalNotes = db.internalNotes.filter(n => n.id !== id);
    if (db.internalNotes.length !== initialLen) {
      this.save(db);
      return true;
    }
    return false;
  },

  toggleInternalNotePin(id, author = null) {
    const db = this.load();
    if (!Array.isArray(db.internalNotes)) return null;
    const note = db.internalNotes.find(n => n.id === id);
    if (!note) return null;
    note.isPinned = !note.isPinned;
    note.updatedAt = new Date().toISOString();
    this.save(db);
    return note;
  },

  addInternalNoteComment(id, text, author = null) {
    const db = this.load();
    if (!Array.isArray(db.internalNotes)) return null;
    const note = db.internalNotes.find(n => n.id === id);
    if (!note) return null;

    if (!Array.isArray(note.comments)) note.comments = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorRole = author?.role || (author?.id?.startsWith('WP-1') ? 'staff' : 'admin');
    const now = new Date().toISOString();

    const comment = {
      id: `CMT-${Date.now()}`,
      author: authorName,
      authorRole,
      text: (text || '').trim(),
      createdAt: now
    };

    note.comments.push(comment);
    note.updatedAt = now;
    this.save(db);
    return comment;
  },

  // --------------------------------------------------------------------------
  // MISCELLANEOUS MODULE: GENERAL DOCUMENTS
  // --------------------------------------------------------------------------
  getGeneralDocuments(filters = {}) {
    const db = this.load();
    let list = Array.isArray(db.generalDocuments) ? [...db.generalDocuments] : [];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(d =>
        (d.title && d.title.toLowerCase().includes(q)) ||
        (d.description && d.description.toLowerCase().includes(q)) ||
        (d.fileName && d.fileName.toLowerCase().includes(q)) ||
        (d.category && d.category.toLowerCase().includes(q)) ||
        (d.assignedStaffName && d.assignedStaffName.toLowerCase().includes(q))
      );
    }
    if (filters.status && filters.status !== 'all') {
      list = list.filter(d => (d.status || '').toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.priority && filters.priority !== 'all') {
      list = list.filter(d => (d.priority || '').toLowerCase() === filters.priority.toLowerCase());
    }
    if (filters.category && filters.category !== 'all') {
      list = list.filter(d => (d.category || '').toLowerCase() === filters.category.toLowerCase());
    }
    if (filters.staffId && filters.staffId !== 'all') {
      list = list.filter(d => d.assignedStaffId === 'all' || d.assignedStaffId === filters.staffId);
    }

    return list.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
  },

  addGeneralDocument(data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.generalDocuments)) db.generalDocuments = [];

    const now = new Date().toISOString();
    const docId = `DOC-${Date.now()}`;
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorId = author?.id || (author?.role === 'admin' ? 'WP-ADMIN' : '');

    const newDoc = {
      id: docId,
      title: (data.title || '').trim(),
      description: (data.description || '').trim(),
      category: data.category || 'Company Policies',
      assignedStaffId: data.assignedStaffId || 'all',
      assignedStaffName: data.assignedStaffName || 'All Staff Members',
      priority: data.priority || 'Standard',
      date: data.date || now.split('T')[0],
      expiryDate: data.expiryDate || '',
      status: data.status || 'Active',
      fileName: data.fileName || 'office_document.pdf',
      fileSize: data.fileSize || '1.0 MB',
      fileType: data.fileType || 'application/pdf',
      fileUrl: data.fileUrl || '#',
      uploadedById: data.uploadedById || authorId,
      uploadedByName: data.uploadedByName || authorName,
      comments: Array.isArray(data.comments) ? data.comments : [],
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      createdAt: now,
      updatedAt: now
    };

    if (data.initialComment && data.initialComment.trim()) {
      newDoc.comments.push({
        id: `CMT-${Date.now()}`,
        author: authorName,
        authorRole: author?.role || 'admin',
        text: data.initialComment.trim(),
        createdAt: now
      });
    }

    db.generalDocuments.unshift(newDoc);
    this.save(db);
    return newDoc;
  },

  updateGeneralDocument(id, data, author = null) {
    const db = this.load();
    if (!Array.isArray(db.generalDocuments)) return null;

    const idx = db.generalDocuments.findIndex(d => d.id === id);
    if (idx === -1) return null;

    const current = db.generalDocuments[idx];
    const now = new Date().toISOString();

    const updated = {
      ...current,
      title: data.title !== undefined ? (data.title || '').trim() : current.title,
      description: data.description !== undefined ? (data.description || '').trim() : current.description,
      category: data.category || current.category,
      priority: data.priority || current.priority,
      date: data.date || current.date,
      expiryDate: data.expiryDate !== undefined ? data.expiryDate : current.expiryDate,
      status: data.status || current.status,
      assignedStaffId: data.assignedStaffId !== undefined ? data.assignedStaffId : current.assignedStaffId,
      assignedStaffName: data.assignedStaffName !== undefined ? data.assignedStaffName : current.assignedStaffName,
      fileName: data.fileName !== undefined ? data.fileName : current.fileName,
      fileSize: data.fileSize !== undefined ? data.fileSize : current.fileSize,
      fileType: data.fileType !== undefined ? data.fileType : current.fileType,
      fileUrl: data.fileUrl !== undefined ? data.fileUrl : current.fileUrl,
      updatedAt: now
    };

    if (Array.isArray(data.attachments)) {
      updated.attachments = data.attachments;
    }

    db.generalDocuments[idx] = updated;
    this.save(db);
    return updated;
  },

  deleteGeneralDocument(id, author = null) {
    const db = this.load();
    if (!Array.isArray(db.generalDocuments)) return false;
    const initialLen = db.generalDocuments.length;
    db.generalDocuments = db.generalDocuments.filter(d => d.id !== id);
    if (db.generalDocuments.length !== initialLen) {
      this.save(db);
      return true;
    }
    return false;
  },

  addGeneralDocumentComment(id, text, author = null) {
    const db = this.load();
    if (!Array.isArray(db.generalDocuments)) return null;
    const doc = db.generalDocuments.find(d => d.id === id);
    if (!doc) return null;

    if (!Array.isArray(doc.comments)) doc.comments = [];
    const authorName = author?.name || (author?.role === 'admin' ? 'Administrator' : 'Staff Member');
    const authorRole = author?.role || (author?.id?.startsWith('WP-1') ? 'staff' : 'admin');
    const now = new Date().toISOString();

    const comment = {
      id: `CMT-${Date.now()}`,
      author: authorName,
      authorRole,
      text: (text || '').trim(),
      createdAt: now
    };

    doc.comments.push(comment);
    doc.updatedAt = now;
    this.save(db);
    return comment;
  },

  // --------------------------------------------------------------------------
  // MISCELLANEOUS MODULE: KPI SUMMARY METRICS
  // --------------------------------------------------------------------------
  getMiscSummary(staffId = null) {
    const db = this.load();
    let reqs = Array.isArray(db.generalRequests) ? db.generalRequests : [];
    let assets = Array.isArray(db.officeAssets) ? db.officeAssets : [];
    let maintenance = Array.isArray(db.maintenanceIssues) ? db.maintenanceIssues : [];
    let notes = Array.isArray(db.internalNotes) ? db.internalNotes : [];
    let docs = Array.isArray(db.generalDocuments) ? db.generalDocuments : [];

    if (staffId && staffId !== 'WP-ADMIN') {
      reqs = reqs.filter(r => r.requestedById === staffId || r.assignedStaffId === staffId);
      assets = assets.filter(a => a.assignedStaffId === staffId);
      maintenance = maintenance.filter(m => m.reportedById === staffId || m.assignedStaffId === staffId);
      notes = notes.filter(n => n.assignedStaffId === 'all' || n.assignedStaffId === staffId);
      docs = docs.filter(d => d.assignedStaffId === 'all' || d.assignedStaffId === staffId);
    }

    const pendingRequests = reqs.filter(r => (r.status || '').toLowerCase() === 'pending').length;
    const approvedRequests = reqs.filter(r => (r.status || '').toLowerCase() === 'approved').length;
    const completedRequests = reqs.filter(r => (r.status || '').toLowerCase() === 'completed').length;
    const totalRequests = reqs.length;

    const totalAssets = assets.length;
    const assignedAssets = assets.filter(a => a.assignedStaffId && a.assignedStaffId !== '').length;
    const availableAssets = totalAssets - assignedAssets;

    const openMaintenance = maintenance.filter(m => ['reported', 'in progress', 'on hold'].includes((m.status || '').toLowerCase())).length;
    const resolvedMaintenance = maintenance.filter(m => (m.status || '').toLowerCase() === 'resolved').length;
    const totalMaintenance = maintenance.length;

    const activeNotes = notes.filter(n => (n.status || '').toLowerCase() !== 'archived').length;
    const pinnedNotes = notes.filter(n => n.isPinned).length;

    const totalDocs = docs.filter(d => (d.status || '').toLowerCase() !== 'archived').length;

    return {
      pendingRequests,
      approvedRequests,
      completedRequests,
      totalRequests,
      totalAssets,
      assignedAssets,
      availableAssets,
      openMaintenance,
      resolvedMaintenance,
      totalMaintenance,
      activeNotes,
      pinnedNotes,
      totalDocs,
      totalDocuments: totalDocs
    };
  }
};

// Expose globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkPulseDB;
}
if (typeof window !== 'undefined') {
  window.WorkPulseDB = WorkPulseDB;
  try {
    const pathname = window.location.pathname || '';
    const isLoginPage = pathname === '/' || pathname.endsWith('index.html') || pathname.endsWith('login');
    if (!isLoginPage || WorkPulseDB.getSessionToken()) {
      WorkPulseDB.initServerSync();
    }
  } catch (e) {}

  // Automatically initialize date pickers & observer on window / document ready
  try {
    const initDP = () => {
      WorkPulseDB.initDatePickers(document.body);
      WorkPulseDB.setupDatePickerObserver();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDP);
    } else {
      initDP();
    }
  } catch (e) {}
}
