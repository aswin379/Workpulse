/**
 * WORKPULSE — STAFF SELF-SERVICE PORTAL CONTROLLER (js/staff.js)
 * Manages browser GPS check-in, real-time shift stopwatch, manual checkout,
 * personal 5-color monthly calendar, and leave/WFH applications.
 */

document.addEventListener('DOMContentLoaded', () => {
  const sessionToken = WorkPulseDB.getSessionToken();
  const session = WorkPulseDB.getSession();
  if (!sessionToken || !session || session.role !== 'staff' || !session.user || !session.user.id) {
    WorkPulseDB.clearSession();
    window.location.replace('index.html?error=staff_required');
    return;
  }

  // Validate session against authoritative server
  fetch('/api/auth/session', {
    headers: WorkPulseDB.getAuthHeaders()
  })
    .then(res => res.json())
    .then(data => {
      if (!data.success || !data.session || data.session.role !== 'staff' || !data.session.user) {
        WorkPulseDB.clearSession();
        window.location.replace('index.html?error=staff_required');
        return;
      }
      // Guarantee local user identity strictly matches server session (prevent localStorage tampering)
      if (session.user.id !== data.session.user.id) {
        session.user = data.session.user;
        currentStaffId = data.session.user.id;
        staff = data.session.user;
        WorkPulseDB.setSession(data.session);
        populateProfile();
        checkAttendanceState();
        renderMonthlyKPIs();
        renderStaffCalendar();
        renderMyApplications();
        initWorkAndMeetingsModule();
      }
    })
    .catch(() => {});

  const staffUser = session.user;
  let currentStaffId = staffUser.id || '';
  let staff = (currentStaffId ? WorkPulseDB.getStaffById(currentStaffId) : null) || staffUser;

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const currentNow = new Date();
  let activeYear = currentNow.getFullYear();
  let activeMonth = currentNow.getMonth(); // 0-indexed: based on user's local date
  const todayDateStr = WorkPulseDB.getTodayDateString ? WorkPulseDB.getTodayDateString() : `${activeYear}-${String(activeMonth + 1).padStart(2, '0')}-${String(currentNow.getDate()).padStart(2, '0')}`;

  // Stopwatch & GPS state
  let shiftStopwatchInterval = null;
  let cachedCoords = null;
  let isGpsLocked = false;
  let isWithinGeofence = false;
  let isGpsDetecting = false;

  const navStaffAvatar = document.getElementById('nav-staff-avatar');
  const navStaffName = document.getElementById('nav-staff-name');
  const navStaffPosition = document.getElementById('nav-staff-position');
  const heroFirstName = document.getElementById('hero-staff-first-name');
  const logoutBtn = document.getElementById('btn-staff-logout');

  // Clock & GPS
  const liveClockEl = document.getElementById('staff-live-clock');
  const liveDateEl = document.getElementById('staff-live-date');
  const gpsStatusBox = document.getElementById('gps-status-container');
  const gpsIconBadge = document.getElementById('gps-icon-badge');
  const gpsStatusLabel = document.getElementById('gps-status-label');
  const gpsStatusCoords = document.getElementById('gps-status-coords');
  const btnDetectGps = document.getElementById('btn-detect-gps');
  const btnRefreshGps = document.getElementById('btn-refresh-gps');
  const btnToggleDemoGps = document.getElementById('btn-toggle-demo-gps');
  const btnRefreshActiveLocation = document.getElementById('btn-refresh-active-location');

  // Punch actions & Stopwatch
  const stateNotCheckedIn = document.getElementById('state-not-checked-in');
  const stateCheckedIn = document.getElementById('state-checked-in');
  const btnClockInTrigger = document.getElementById('btn-clockin-trigger');
  const btnManualCheckout = document.getElementById('btn-manual-checkout');
  const btnLunchBreak = document.getElementById('btn-lunch-break');
  const btnRepunchCheckin = document.getElementById('btn-repunch-checkin');
  const btnResetAttendance = document.getElementById('btn-reset-attendance');
  const activeShiftTimerEl = document.getElementById('active-shift-timer');
  const punchInTimeDisplay = document.getElementById('punch-in-time-display');
  const punchInLocationDisplay = document.getElementById('punch-in-location-display');
  const punchInMapLink = document.getElementById('punch-in-map-link');
  const locationOffWarning = document.getElementById('location-off-warning');
  const btnRetryGps = document.getElementById('btn-retry-gps');
  const breakStatusBadge = document.getElementById('break-status-badge');
  const punchLunchTimeContainer = document.getElementById('punch-lunch-time-container');
  const punchLunchTimeDisplay = document.getElementById('punch-lunch-time-display');
  const inactivityPausedBanner = document.getElementById('inactivity-paused-banner');
  const bannerBtnResumeWork = document.getElementById('banner-btn-resume-work');
  const modalBtnResumeWork = document.getElementById('modal-btn-resume-work');
  const inactivityResumeModal = document.getElementById('inactivity-resume-modal');
  const btnCloseInactivityModal = document.getElementById('btn-close-inactivity-modal');
  const modalInactiveStartTime = document.getElementById('modal-inactive-start-time');
  const btnSimulateInactivity = document.getElementById('btn-simulate-inactivity');

  // Modals
  const applyLeaveModal = document.getElementById('apply-leave-modal');
  const applyWfhModal = document.getElementById('apply-wfh-modal');
  const dayDetailModal = document.getElementById('day-detail-modal');

  // Toast Helper
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    } else {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    }

    toast.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="display:flex; align-items:center;">${iconSvg}</span>
        <span>${message}</span>
      </div>
      <button style="background:none; border:none; color:inherit; font-size:16px; cursor:pointer; margin-left:12px;" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 4500);
  }

  // Universal Illustrated Empty Table State Component
  function renderEmptyTableState(colspan, title, subtitle = 'No records found.') {
    return `
      <tr>
        <td colspan="${colspan}" style="text-align:center; padding: 36px 16px;">
          <div class="d-flex flex-column align-items-center justify-content-center" style="gap: 6px;">
            <div style="width: 40px; height: 40px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; color: #94A3B8; margin-bottom: 2px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </div>
            <div style="font-weight: 700; color: var(--navy-dark); font-size: 0.86rem;">${title}</div>
            <div style="font-size: 0.74rem; color: var(--text-muted);">${subtitle}</div>
          </div>
        </td>
      </tr>
    `;
  }

  // --------------------------------------------------------------------------
  // 3. POPULATE PROFILE HEADER
  // --------------------------------------------------------------------------
  function populateProfile() {
    const initials = getInitials(staff.name);
    const photoImg = staff.photo 
      ? `<img src="${staff.photo}" alt="${escapeHtml(staff.name)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;" onerror="this.parentElement.textContent='${initials}'">`
      : null;

    // Sidebar footer chip
    const sbAvatar = document.getElementById('sidebar-staff-avatar');
    const sbName = document.getElementById('sidebar-staff-name');
    const sbRole = document.getElementById('sidebar-staff-role');
    if (sbAvatar) {
      if (photoImg) sbAvatar.innerHTML = photoImg;
      else sbAvatar.textContent = initials;
    }
    if (sbName) sbName.textContent = staff.name || 'Staff Member';
    if (sbRole) sbRole.textContent = staff.position || 'Employee';

    // Topbar profile pill
    const tbAvatar = document.getElementById('topbar-staff-avatar') || navStaffAvatar;
    const tbName = document.getElementById('topbar-staff-name') || navStaffName;
    const tbRole = document.getElementById('topbar-staff-role') || navStaffPosition;
    if (tbAvatar) {
      if (photoImg) tbAvatar.innerHTML = photoImg;
      else tbAvatar.textContent = initials;
    }
    if (tbName) tbName.textContent = staff.name || 'Staff Member';
    if (tbRole) tbRole.textContent = staff.position || 'Employee';

    // Profile settings page
    const pAvatar = document.getElementById('profile-page-avatar');
    const pName = document.getElementById('profile-page-name');
    const pRole = document.getElementById('profile-page-role');
    const pId = document.getElementById('profile-page-id');
    if (pAvatar) {
      if (photoImg) pAvatar.innerHTML = photoImg;
      else pAvatar.textContent = initials;
    }
    if (pName) pName.textContent = staff.name || 'Staff Member';
    if (pRole) pRole.textContent = staff.position || 'Employee';
    if (pId) pId.textContent = `ID: ${staff.id || staff.staffId || 'WP-1001'}`;

    // Hero title
    if (heroFirstName) heroFirstName.textContent = (staff.name || '').split(' ')[0] || staff.name || 'Staff';
  }
  // 3.1 REAL-TIME PRESENCE HEARTBEAT & SESSION TRACKING
  function startStaffPresenceHeartbeat() {
    const sendHeartbeat = () => {
      if (typeof fetch === 'function' && typeof WorkPulseDB !== 'undefined' && WorkPulseDB.getSessionToken()) {
        fetch('/api/auth/heartbeat', {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders()
        }).catch(() => {});
      }
    };
    sendHeartbeat();

    // Send heartbeat every 20 seconds to maintain online presence
    setInterval(sendHeartbeat, 20000);

    // Immediate offline signal on tab close or window unload
    window.addEventListener('beforeunload', () => {
      const token = typeof WorkPulseDB !== 'undefined' ? WorkPulseDB.getSessionToken() : null;
      if (token && navigator.sendBeacon) {
        navigator.sendBeacon('/api/auth/beacon-offline?token=' + encodeURIComponent(token));
      }
    });

    window.addEventListener('pagehide', () => {
      const token = typeof WorkPulseDB !== 'undefined' ? WorkPulseDB.getSessionToken() : null;
      if (token && navigator.sendBeacon) {
        navigator.sendBeacon('/api/auth/beacon-offline?token=' + encodeURIComponent(token));
      }
    });
  }
  startStaffPresenceHeartbeat();

  // Logout (Topbar and Sidebar)
  const handleStaffLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: WorkPulseDB.getAuthHeaders()
      });
    } catch (e) {}
    WorkPulseDB.clearSession();
    window.location.replace('index.html?msg=logged_out');
  };

  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleStaffLogout);
  }
  const sidebarLogoutBtn = document.getElementById('btn-sidebar-logout');
  if (sidebarLogoutBtn) {
    sidebarLogoutBtn.addEventListener('click', handleStaffLogout);
  }

  // --------------------------------------------------------------------------
  // 4. LIVE CLOCK & STOPWATCH
  // --------------------------------------------------------------------------
  function initLiveClock() {
    function updateClock() {
      const tz = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getOfficeTimezone === 'function') 
        ? WorkPulseDB.getOfficeTimezone() 
        : 'Asia/Kolkata';
      const now = new Date();
      if (liveClockEl) {
        liveClockEl.textContent = now.toLocaleTimeString('en-US', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
      }
      if (liveDateEl) {
        const fullDay = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' });
        const dStr = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') 
          ? WorkPulseDB.formatDisplayDate(now) 
          : `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
        liveDateEl.textContent = `${fullDay}, ${dStr}`;
      }
      const topbarClock = document.getElementById('topbar-live-clock-text');
      if (topbarClock) {
        const shortDay = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
        const dStr = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') 
          ? WorkPulseDB.formatDisplayDate(now) 
          : `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
        topbarClock.textContent = `${shortDay}, ${dStr} • ` + now.toLocaleTimeString('en-US', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }
    }
    updateClock();
    setInterval(updateClock, 1000);
  }

  // --------------------------------------------------------------------------
  // 5. BROWSER GPS GEOLOCATION ENGINE
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // 5. BROWSER GPS GEOLOCATION ENGINE & REVERSE GEOCODING
  // --------------------------------------------------------------------------
  async function reverseGeocodeClient(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;
    
    // 1. Try server-side reverse-geocode endpoint first (has server cache & User-Agent)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(`/api/location/reverse-geocode?lat=${lat}&lng=${lng}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.success && data.address) {
          return data.address;
        }
      }
    } catch (e) {}

    // 2. Direct fallback to OpenStreetMap Nominatim
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json();
        return data?.display_name || null;
      }
    } catch (e) {}
    return null;
  }

  function updateToggleGpsButton(mode) {
    // Legacy helper kept as no-op for backward compatibility
  }

  function setGpsState(type, label, coordsText, mapUrl = null) {
    if (!gpsIconBadge || !gpsStatusLabel || !gpsStatusCoords) return;

    // Consistency guard: If attendance is already checked in / completed today, preserve verified state and never display error/denied
    const todayRec = (typeof WorkPulseDB !== 'undefined' && typeof staff !== 'undefined' && staff?.id)
      ? WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0]
      : null;
    const isCheckedIn = todayRec && todayRec.checkIn && todayRec.checkIn !== '--:--';

    if (isCheckedIn && type === 'error') {
      type = 'verified';
      label = 'Attendance Checked In';
      const lat = (todayRec.coords && typeof todayRec.coords.latitude === 'number') ? todayRec.coords.latitude : (typeof todayRec.latitude === 'number' && !isNaN(todayRec.latitude) ? todayRec.latitude : null);
      const lng = (todayRec.coords && typeof todayRec.coords.longitude === 'number') ? todayRec.coords.longitude : (typeof todayRec.longitude === 'number' && !isNaN(todayRec.longitude) ? todayRec.longitude : null);
      const hasCoords = lat !== null && lng !== null;
      let locDisplay = todayRec.address || todayRec.location;
      if (!locDisplay || locDisplay.includes('GPS Telemetry Unavailable') || locDisplay.includes('Office Geofence') || locDisplay === 'Pending Check-In') {
        locDisplay = hasCoords ? `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` : 'Location unavailable';
      }
      coordsText = locDisplay;
      mapUrl = hasCoords ? (todayRec.mapUrl || `https://www.google.com/maps?q=${lat},${lng}`) : null;
      if (locationOffWarning) locationOffWarning.style.display = 'none';
    }

    if (type === 'verified') {
      gpsIconBadge.className = 'gps-icon-circle verified';
      gpsIconBadge.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      if (locationOffWarning) locationOffWarning.style.display = 'none';
      if (btnClockInTrigger) {
        btnClockInTrigger.style.opacity = '1';
        btnClockInTrigger.style.filter = 'none';
      }
    } else if (type === 'error') {
      gpsIconBadge.className = 'gps-icon-circle error';
      gpsIconBadge.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
      if (locationOffWarning) {
        locationOffWarning.style.display = 'flex';
        locationOffWarning.style.background = '#FEF2F2';
        locationOffWarning.style.borderColor = '#FCA5A5';
        locationOffWarning.style.color = '#991B1B';
        const span = locationOffWarning.querySelector('#location-off-warning-text') || locationOffWarning.querySelector('span');
        if (span) span.textContent = coordsText || 'Location is required. Please turn ON GPS on your mobile device and try again.';
        if (btnRetryGps) btnRetryGps.style.display = 'inline-flex';
      }
      if (btnClockInTrigger) {
        btnClockInTrigger.style.opacity = '1';
        btnClockInTrigger.style.filter = 'none';
      }
    } else if (type === 'loading') {
      gpsIconBadge.className = 'gps-icon-circle';
      gpsIconBadge.innerHTML = '<svg class="spin-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: wp-spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>';
      if (locationOffWarning) locationOffWarning.style.display = 'none';
    } else {
      // ready or initial state
      gpsIconBadge.className = 'gps-icon-circle';
      gpsIconBadge.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
      if (locationOffWarning) locationOffWarning.style.display = 'none';
      if (btnClockInTrigger) {
        btnClockInTrigger.style.opacity = '1';
        btnClockInTrigger.style.filter = 'none';
      }
    }

    gpsStatusLabel.textContent = label;
    if (mapUrl) {
      gpsStatusCoords.innerHTML = `<span>${coordsText}</span> &bull; <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--royal-blue); font-weight:600; text-decoration:underline;">View on Map &rarr;</a>`;
    } else {
      gpsStatusCoords.textContent = coordsText;
    }
  }

  /**
   * Fetches the device's actual current location via browser Geolocation API.
   * Utilizes the device's normal Android Location Services across all available providers
   * (GPS, Wi-Fi networks, and mobile cellular networks).
   * Does NOT require GPS-only mode.
   */
  function fetchDeviceLocation(options = {}) {
    const timeoutMs = options.timeoutMs || 15000;

    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        // If on insecure HTTP over LAN on mobile, auto-redirect to HTTPS port 8443
        if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
          window.location.href = 'https://' + window.location.hostname + ':8443' + window.location.pathname + window.location.search;
          return reject({ code: -2, message: 'Redirecting to secure connection for location access...' });
        }
        return reject({ code: -1, message: 'Location is not supported by your browser.' });
      }

      let finished = false;
      let timer = null;

      const finishOnce = (callback) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        callback();
      };

      timer = setTimeout(() => {
        finishOnce(() => {
          reject({ code: 3, message: 'Location request timed out. Please ensure Location Services are enabled on your device.' });
        });
      }, timeoutMs);

      // Attempt 1: Normal Android Location Services (Wi-Fi, Cellular Network, and GPS)
      // maximumAge: 60000 allows Android Location Services (Fused Provider) to supply a fresh fix without forcing satellite-only mode
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          finishOnce(() => {
            if (!pos || !pos.coords || typeof pos.coords.latitude !== 'number') {
              return reject({ code: 2, message: 'Device returned empty location coordinates.' });
            }
            resolve(pos);
          });
        },
        (err) => {
          // If permission was explicitly denied (code 1), do not retry — respect user's permission choice
          if (err && err.code === 1) {
            return finishOnce(() => reject(err));
          }

          // Attempt 2: In case device Location Services requires high accuracy hint (GNSS + Network)
          navigator.geolocation.getCurrentPosition(
            (posHigh) => {
              finishOnce(() => {
                if (!posHigh || !posHigh.coords || typeof posHigh.coords.latitude !== 'number') {
                  return reject({ code: 2, message: 'Device returned empty location coordinates.' });
                }
                resolve(posHigh);
              });
            },
            (errHigh) => {
              if (errHigh && errHigh.code === 1) {
                return finishOnce(() => reject(errHigh));
              }

              // Attempt 3: Any recent cached location available in device provider (within last 5 minutes)
              navigator.geolocation.getCurrentPosition(
                (posCache) => {
                  finishOnce(() => {
                    if (!posCache || !posCache.coords || typeof posCache.coords.latitude !== 'number') {
                      return reject({ code: 2, message: 'Device returned empty location coordinates.' });
                    }
                    resolve(posCache);
                  });
                },
                (errFinal) => {
                  finishOnce(() => reject(errFinal || errHigh || err));
                },
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
              );
            },
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
          );
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  // Backward compatibility alias
  const fetchDeviceGPS = fetchDeviceLocation;

  async function detectBrowserGPS(options = {}) {
    const silent = typeof options === 'boolean' ? options : !!options.silent;

    if (isGpsDetecting) return null;
    isGpsDetecting = true;

    setGpsState('loading', 'Detecting Location...', 'Requesting device Location Services (GPS, Wi-Fi, Network)...');

    try {
      const pos = await fetchDeviceLocation(options);
      isGpsDetecting = false;

      const lat = Number(pos.coords.latitude);
      const lng = Number(pos.coords.longitude);
      const acc = Number(pos.coords.accuracy || 15);

      if (isNaN(lat) || isNaN(lng)) {
        setGpsState('error', 'Location Error', 'Device returned invalid coordinates. Please try again.');
        if (!silent) showToast('Could not read valid location coordinates.', 'error');
        return null;
      }

      cachedCoords = {
        latitude: lat,
        longitude: lng,
        accuracy: acc,
        timestamp: new Date().toISOString()
      };
      isGpsLocked = true;

      // Reverse geocode to get actual street address
      let resolvedAddress = null;
      try {
        resolvedAddress = await reverseGeocodeClient(lat, lng);
      } catch (e) {}

      if (resolvedAddress) {
        cachedCoords.address = resolvedAddress;
      }

      const latDir = lat >= 0 ? 'N' : 'S';
      const lngDir = lng >= 0 ? 'E' : 'W';
      const coordFormatted = `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
      const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      const accFormatted = acc >= 1000 ? `${(acc / 1000).toFixed(1)}km` : `${Math.round(acc)}m`;
      const displayLabel = resolvedAddress ? `${resolvedAddress} (${coordFormatted}, ±${accFormatted})` : `${coordFormatted} (±${accFormatted})`;

      setGpsState(
        'verified',
        'Location Verified',
        displayLabel,
        mapUrl
      );

      return cachedCoords;
    } catch (err) {
      isGpsDetecting = false;
      isGpsLocked = false;
      cachedCoords = null;
      console.warn('Geolocation error / rejection:', err);

      let statusLabel = 'Location Required';
      let simpleMessage = 'Location access is required. Please turn ON Location on your device and allow permission.';
      let toastMsg = 'Location error: Unable to determine location.';

      if (err.code === 1) { // PERMISSION_DENIED
        statusLabel = 'Location Permission Denied';
        simpleMessage = 'Location permission was denied. Please allow location access in your browser settings to mark attendance.';
        toastMsg = 'Location permission denied: Please allow location access in browser settings.';
      } else if (err.code === 2) { // POSITION_UNAVAILABLE
        statusLabel = 'Device Location is OFF';
        simpleMessage = 'Device Location Services is turned OFF. Please turn ON Location in your Android settings and try again.';
        toastMsg = 'Device Location is turned OFF. Please enable Location in settings.';
      } else if (err.code === 3) { // TIMEOUT
        statusLabel = 'Location Request Timed Out';
        simpleMessage = 'Location request timed out. Please ensure Location is enabled on your device and try again.';
        toastMsg = 'Location request timed out. Please retry.';
      } else if (err.message) {
        simpleMessage = err.message;
        toastMsg = err.message;
      }

      setGpsState('error', statusLabel, simpleMessage);
      if (!silent) {
        showToast(toastMsg, 'warning');
      }
      return null;
    }
  }

  // Retry Location button handler
  btnRetryGps?.addEventListener('click', () => {
    executeAttendanceCheckin();
  });

  function initGpsLocation() {
    const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
    if (todayRec && todayRec.checkIn && todayRec.checkIn !== '--:--') {
      // Already checked in today: display read-only recorded location
      const lat = (todayRec.coords && typeof todayRec.coords.latitude === 'number') ? todayRec.coords.latitude : (typeof todayRec.latitude === 'number' && !isNaN(todayRec.latitude) ? todayRec.latitude : null);
      const lng = (todayRec.coords && typeof todayRec.coords.longitude === 'number') ? todayRec.coords.longitude : (typeof todayRec.longitude === 'number' && !isNaN(todayRec.longitude) ? todayRec.longitude : null);
      const hasCoords = lat !== null && lng !== null;
      let locDisplay = todayRec.address || todayRec.location;
      if (!locDisplay || locDisplay.includes('GPS Telemetry Unavailable') || locDisplay.includes('Office Geofence') || locDisplay === 'Pending Check-In') {
        locDisplay = hasCoords ? `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` : 'Location unavailable';
      }
      const mapUrl = hasCoords ? (todayRec.mapUrl || `https://www.google.com/maps?q=${lat},${lng}`) : null;
      setGpsState(
        'verified',
        'Attendance Checked In',
        locDisplay,
        mapUrl
      );
      if (locationOffWarning) locationOffWarning.style.display = 'none';
      return;
    }

    // Auto-redirect mobile devices on LAN HTTP to HTTPS port 8443
    if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      window.location.href = 'https://' + window.location.hostname + ':8443' + window.location.pathname + window.location.search;
      return;
    }

    setGpsState(
      'ready',
      'Location Attendance',
      'Turn ON device Location and click Record Attendance'
    );
    if (locationOffWarning) locationOffWarning.style.display = 'none';
  }

  // --------------------------------------------------------------------------
  // 6. SHIFT PUNCH-IN & MANUAL CHECKOUT CONTROLLER
  // --------------------------------------------------------------------------
  function updateNavbarShiftStatus(status, detail) {
    const quickDot = document.getElementById('quick-shift-dot');
    const quickLabel = document.getElementById('quick-shift-label');
    const navDot = document.getElementById('nav-shift-status-dot');

    if (!quickDot || !quickLabel) return;

    if (status === 'in_progress') {
      quickDot.className = 'quick-shift-dot active';
      quickLabel.textContent = `🟢 Shift Active (${detail || 'In Progress'})`;
      if (navDot) navDot.className = 'staff-module-dot active';
    } else if (status === 'lunch_break') {
      quickDot.className = 'quick-shift-dot break';
      quickLabel.textContent = `🍱 Lunch Break`;
      if (navDot) navDot.className = 'staff-module-dot break';
    } else if (status === 'inactive') {
      quickDot.className = 'quick-shift-dot';
      quickLabel.textContent = `⏸️ Shift Paused`;
      if (navDot) navDot.className = 'staff-module-dot break';
    } else if (status === 'completed') {
      quickDot.className = 'quick-shift-dot';
      quickLabel.textContent = `Checked Out (${detail || 'Done'})`;
      if (navDot) navDot.className = 'staff-module-dot';
    } else {
      quickDot.className = 'quick-shift-dot';
      quickLabel.textContent = `Punch In`;
      if (navDot) navDot.className = 'staff-module-dot';
    }
  }

  function checkAttendanceState() {
    const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];

    if (!todayRec || todayRec.checkIn === '--:--') {
      // Not checked in yet
      stateNotCheckedIn.style.display = 'block';
      stateCheckedIn.style.display = 'none';
      if (shiftStopwatchInterval) clearInterval(shiftStopwatchInterval);
      updateNavbarShiftStatus('not_checked_in');
      if (punchInLocationDisplay) punchInLocationDisplay.textContent = 'Location unavailable';
      if (punchInMapLink) {
        punchInMapLink.style.display = 'none';
        punchInMapLink.href = '#';
      }
    } else {
      // Checked in!
      stateNotCheckedIn.style.display = 'none';
      stateCheckedIn.style.display = 'block';
      if (locationOffWarning) locationOffWarning.style.display = 'none';
      punchInTimeDisplay.textContent = todayRec.checkIn;

      const lat = (todayRec.coords && typeof todayRec.coords.latitude === 'number') ? todayRec.coords.latitude : (typeof todayRec.latitude === 'number' && !isNaN(todayRec.latitude) ? todayRec.latitude : null);
      const lng = (todayRec.coords && typeof todayRec.coords.longitude === 'number') ? todayRec.coords.longitude : (typeof todayRec.longitude === 'number' && !isNaN(todayRec.longitude) ? todayRec.longitude : null);
      const hasCoords = lat !== null && lng !== null;
      let locText = todayRec.address || todayRec.location;
      if (!locText || locText.includes('GPS Telemetry Unavailable') || locText.includes('Office Geofence') || locText === 'Pending Check-In') {
        locText = hasCoords ? `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` : 'Location unavailable';
      }

      if (punchInLocationDisplay) {
        punchInLocationDisplay.textContent = locText;
      }

      const mapUrl = hasCoords ? (todayRec.mapUrl || `https://www.google.com/maps?q=${lat},${lng}`) : null;
      if (punchInMapLink) {
        if (mapUrl) {
          punchInMapLink.href = mapUrl;
          punchInMapLink.style.display = 'inline-flex';
        } else {
          punchInMapLink.style.display = 'none';
        }
      }

      // Keep GPS status box synchronized with verified attendance check-in
      setGpsState(
        'verified',
        'Attendance Checked In',
        locText,
        mapUrl
      );

      const shiftStatusBadge = document.getElementById('shift-status-badge');
      const shiftPolicyStripText = document.getElementById('shift-policy-strip-text');
      const punchOutTimeContainer = document.getElementById('punch-out-time-container');
      const punchOutTimeDisplay = document.getElementById('punch-out-time-display');

      if (todayRec.checkOut && todayRec.checkOut !== '--:--') {
        // Staff member has manually checked out: shift ended
        updateNavbarShiftStatus('completed', todayRec.checkOut);
        if (shiftStopwatchInterval) {
          clearInterval(shiftStopwatchInterval);
          shiftStopwatchInterval = null;
        }
        activeShiftTimerEl.textContent = todayRec.workingHours;
        activeShiftTimerEl.style.color = 'var(--royal-blue)';
        if (btnManualCheckout) btnManualCheckout.style.display = 'none';
        if (btnLunchBreak) btnLunchBreak.style.display = 'none';
        if (btnRepunchCheckin) btnRepunchCheckin.style.display = 'none';
        if (breakStatusBadge) breakStatusBadge.style.display = 'none';
        if (inactivityPausedBanner) inactivityPausedBanner.style.display = 'none';

        if (shiftStatusBadge) {
          shiftStatusBadge.className = 'badge badge-primary';
          shiftStatusBadge.style.background = '';
          shiftStatusBadge.style.color = '';
          shiftStatusBadge.style.border = '';
          shiftStatusBadge.textContent = '🟢 Shift Completed';
        }
        if (shiftPolicyStripText) {
          shiftPolicyStripText.textContent = `Shift completed. Checked out at ${todayRec.checkOut}`;
        }
        if (punchOutTimeContainer && punchOutTimeDisplay) {
          punchOutTimeContainer.style.display = 'block';
          punchOutTimeDisplay.textContent = todayRec.checkOut;
        }
        if (punchLunchTimeContainer && punchLunchTimeDisplay && todayRec.lunchBreak && todayRec.lunchBreak.used) {
          punchLunchTimeContainer.style.display = 'block';
          punchLunchTimeDisplay.textContent = `${todayRec.lunchBreak.startedAt} - ${todayRec.lunchBreak.endedAt} (${todayRec.lunchBreak.durationMinutes}m)`;
        }
      } else {
        // Shift is active until manual checkout
        if (btnManualCheckout) btnManualCheckout.style.display = 'inline-flex';
        if (punchOutTimeContainer) punchOutTimeContainer.style.display = 'none';

        const shiftStatus = todayRec.shiftStatus || 'active';

        // 1. Lunch Break Button State
        if (btnLunchBreak) {
          btnLunchBreak.style.display = 'inline-flex';
          if (shiftStatus === 'lunch') {
            btnLunchBreak.innerHTML = '<span>🍱 Resume Work (End Lunch)</span>';
            btnLunchBreak.className = 'btn btn-primary btn-sm';
            btnLunchBreak.style.background = '#D97706';
            btnLunchBreak.style.borderColor = '#B45309';
            btnLunchBreak.style.color = '#FFFFFF';
            btnLunchBreak.disabled = false;
            btnLunchBreak.style.opacity = '1';
            btnLunchBreak.style.cursor = 'pointer';
          } else if (todayRec.lunchBreak && todayRec.lunchBreak.used) {
            btnLunchBreak.innerHTML = `<span>✓ Lunch Taken (${todayRec.lunchBreak.durationMinutes}m)</span>`;
            btnLunchBreak.className = 'btn btn-secondary btn-sm';
            btnLunchBreak.style.background = '#F1F5F9';
            btnLunchBreak.style.borderColor = '#E2E8F0';
            btnLunchBreak.style.color = '#64748B';
            btnLunchBreak.disabled = true;
            btnLunchBreak.style.opacity = '0.7';
            btnLunchBreak.style.cursor = 'not-allowed';
          } else {
            btnLunchBreak.innerHTML = '<span>🍱 Start Lunch Break</span>';
            btnLunchBreak.className = 'btn btn-secondary btn-sm';
            btnLunchBreak.style.background = '#FFFBEB';
            btnLunchBreak.style.borderColor = '#FCD34D';
            btnLunchBreak.style.color = '#92400E';
            btnLunchBreak.disabled = false;
            btnLunchBreak.style.opacity = '1';
            btnLunchBreak.style.cursor = 'pointer';
          }
        }

        // Lunch Timing Display
        if (punchLunchTimeContainer && punchLunchTimeDisplay) {
          if (shiftStatus === 'lunch' && todayRec.lunchBreak) {
            punchLunchTimeContainer.style.display = 'block';
            punchLunchTimeDisplay.textContent = `Started at ${todayRec.lunchBreak.startedAt} (Paused)`;
          } else if (todayRec.lunchBreak && todayRec.lunchBreak.used) {
            punchLunchTimeContainer.style.display = 'block';
            punchLunchTimeDisplay.textContent = `${todayRec.lunchBreak.startedAt} - ${todayRec.lunchBreak.endedAt} (${todayRec.lunchBreak.durationMinutes}m)`;
          } else {
            punchLunchTimeContainer.style.display = 'none';
          }
        }

        // 2. Status Badges & Inactivity Banner
        if (shiftStatus === 'lunch') {
          updateNavbarShiftStatus('lunch_break');
          activeShiftTimerEl.style.color = '#D97706';
          if (shiftStatusBadge) {
            shiftStatusBadge.className = 'badge';
            shiftStatusBadge.style.background = '#FEF3C7';
            shiftStatusBadge.style.color = '#92400E';
            shiftStatusBadge.style.border = '1px solid #FDE68A';
            shiftStatusBadge.textContent = '🍱 On Lunch Break';
          }
          if (breakStatusBadge) breakStatusBadge.style.display = 'none';
          if (inactivityPausedBanner) inactivityPausedBanner.style.display = 'none';
          if (shiftPolicyStripText) {
            shiftPolicyStripText.textContent = 'Working timer paused for Lunch Break';
          }
        } else if (shiftStatus === 'inactive') {
          updateNavbarShiftStatus('inactive');
          activeShiftTimerEl.style.color = '#DC2626';
          if (shiftStatusBadge) {
            shiftStatusBadge.className = 'badge';
            shiftStatusBadge.style.background = '#FEE2E2';
            shiftStatusBadge.style.color = '#991B1B';
            shiftStatusBadge.style.border = '1px solid #FCA5A5';
            shiftStatusBadge.textContent = '⏸️ Inactive — Timer Paused';
          }
          if (breakStatusBadge) breakStatusBadge.style.display = 'none';
          if (inactivityPausedBanner) {
            inactivityPausedBanner.style.display = 'block';
            const descEl = document.getElementById('inactivity-banner-desc');
            const reason = todayRec.currentInactivityStart?.reason;
            if (descEl) {
              const cfg = (typeof getInactivityConfig === 'function') ? getInactivityConfig() : { systemMinutes: 15, tabMinutes: 60 };
              descEl.textContent = reason 
                ? `Timer paused due to ${reason}. Inactivity is excluded from working hours.`
                : `Working timer is paused (system idle for ${cfg.systemMinutes}m or WorkPulse tab inactive for ${cfg.tabMinutes}m). Inactivity is excluded from working hours.`;
            }
          }
          if (shiftPolicyStripText) {
            const reason = todayRec.currentInactivityStart?.reason;
            shiftPolicyStripText.textContent = reason 
              ? `Inactive — Timer Paused (${reason}). Click Resume Work to continue.`
              : 'Inactive — Timer Paused. Click Resume Work to continue.';
          }
        } else {
          // Normal active
          updateNavbarShiftStatus('in_progress', todayRec.checkIn);
          activeShiftTimerEl.style.color = 'var(--gold-soft)';
          if (shiftStatusBadge) {
            shiftStatusBadge.className = 'badge badge-present';
            shiftStatusBadge.style.background = '';
            shiftStatusBadge.style.color = '';
            shiftStatusBadge.style.border = '';
            shiftStatusBadge.textContent = '🟢 Shift In Progress';
          }
          if (breakStatusBadge) breakStatusBadge.style.display = 'none';
          if (inactivityPausedBanner) inactivityPausedBanner.style.display = 'none';
          if (shiftPolicyStripText) {
            shiftPolicyStripText.textContent = 'Shift is active until manual checkout';
          }
        }

        // Start live stopwatch from check-in time
        startShiftStopwatch(todayRec.checkIn);
      }
    }
  }

  // Web Audio Corporate Synthesizer
  function playCorporateChime(type = 'success') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      if (type === 'success') {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(523.25, now);
        osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.12);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1046.5, now + 0.06);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now + 0.06);
        osc1.stop(now + 0.45);
        osc2.stop(now + 0.45);
      } else if (type === 'error') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(160, now + 0.25);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      // Audio context policy fallback
    }
  }

  // Helper to format coordinate pair
  function formatCoordPair(coords) {
    if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') return '--';
    const lat = coords.latitude;
    const lng = coords.longitude;
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
  }

  // Authoritative Attendance Check-In Controller
  async function executeAttendanceCheckin(options = {}) {
    const isRepunch = !!(options && options.isRepunch);

    // Guard: If shift is already completed, check-in cannot be re-recorded
    const existingRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
    if (existingRec && existingRec.checkOut && existingRec.checkOut !== '--:--') {
      showToast('Shift is completed for today. Check-in cannot be re-recorded.', 'info');
      checkAttendanceState();
      return;
    }
    // If already checked in and not an explicit re-punch, just synchronize UI
    if (existingRec && existingRec.checkIn && existingRec.checkIn !== '--:--' && !isRepunch) {
      checkAttendanceState();
      return;
    }

    const originalBtnHtml = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
      <span>Record Attendance (Self Check-In)</span>
    `;

    const setButtonLoading = (loading) => {
      if (!btnClockInTrigger) return;
      if (loading) {
        btnClockInTrigger.disabled = true;
        btnClockInTrigger.style.pointerEvents = 'none';
        btnClockInTrigger.innerHTML = `
          <span style="display:inline-flex; align-items:center; gap:8px;">
            <svg class="spin-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: wp-spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
            <span>Acquiring GPS Location...</span>
          </span>
        `;
      } else {
        btnClockInTrigger.disabled = false;
        btnClockInTrigger.style.pointerEvents = '';
        btnClockInTrigger.innerHTML = originalBtnHtml;
      }
    };

    // 1. Fetch fresh device GPS coordinates ONLY at the time of check-in!
    // Never reuse old, cached, or previously saved coordinates.
    cachedCoords = null;
    setButtonLoading(true);
    const coordsToUse = await detectBrowserGPS({ silent: false });
    if (!coordsToUse || typeof coordsToUse.latitude !== 'number' || isNaN(coordsToUse.latitude)) {
      // Location detection failed (e.g. permission denied)
      setButtonLoading(false);
      // Requirement 4: If location permission is denied, do not display an old location as current check-in location
      if (!existingRec || existingRec.checkIn === '--:--') {
        if (punchInLocationDisplay) punchInLocationDisplay.textContent = 'Location unavailable';
        if (punchInMapLink) punchInMapLink.style.display = 'none';
      }
      return;
    }

    // 2. Allow attendance from anywhere: send actual fresh GPS coordinates to server
    try {
      let serverRecord = null;
      if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
        const resp = await fetch('/api/attendance/check-in', {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            staffId: staff.id,
            coordinates: coordsToUse,
            latitude: coordsToUse.latitude,
            longitude: coordsToUse.longitude,
            accuracy: coordsToUse.accuracy,
            address: coordsToUse.address || null,
            timestamp: coordsToUse.timestamp || new Date().toISOString()
          })
        });
        const json = await resp.json();
        if (!json.success) {
          setButtonLoading(false);
          playCorporateChime('error');
          showToast(json.error || 'Check-in rejected by server', 'error');
          return;
        }
        serverRecord = json.data;
      }

      setButtonLoading(false);
      playCorporateChime('success');

      let rec = serverRecord;
      if (rec && typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.load === 'function') {
        const db = WorkPulseDB.load();
        const existingIdx = db.attendance.findIndex(a => a.id === rec.id || (a.staffId === rec.staffId && a.date === rec.date));
        if (existingIdx >= 0) {
          db.attendance[existingIdx] = rec;
        } else {
          db.attendance.push(rec);
        }
        WorkPulseDB.save(db, true);
      } else {
        rec = WorkPulseDB.checkInStaff(staff.id, coordsToUse, null, null, {
          address: coordsToUse.address || null,
          accuracy: coordsToUse.accuracy,
          checkInTimestamp: coordsToUse.timestamp
        });
      }

      if (rec) {
        showToast(`Attendance marked! Location: ${rec.address || rec.location}`, 'success');
        checkAttendanceState();
        resetInactivityTimer();
        initSystemIdleDetector();
        renderMonthlyKPIs();
        renderStaffCalendar();
      }
    } catch (err) {
      setButtonLoading(false);
      playCorporateChime('error');
      showToast('Network error during attendance check-in. Please retry.', 'error');
    }
  }

  // Clock-in button click: triggers verified check-in or requests location
  if (btnClockInTrigger) {
    btnClockInTrigger.addEventListener('click', () => {
      executeAttendanceCheckin();
    });
  }

  // Re-punch / Update location button click
  if (btnRepunchCheckin) {
    btnRepunchCheckin.addEventListener('click', () => {
      const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
      if (todayRec && todayRec.checkOut && todayRec.checkOut !== '--:--') {
        showToast('Shift is completed. Location cannot be updated after checkout.', 'warning');
        return;
      }
      executeAttendanceCheckin({ isRepunch: true });
    });
  }

  // Refresh active location button click (refreshes display from saved record, does NOT re-request browser GPS)
  if (btnRefreshActiveLocation) {
    btnRefreshActiveLocation.addEventListener('click', () => {
      const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
      if (todayRec && todayRec.checkIn && todayRec.checkIn !== '--:--') {
        checkAttendanceState();
        showToast(`Saved check-in location: ${todayRec.address || todayRec.location || 'Recorded GPS'}`, 'info');
      } else {
        executeAttendanceCheckin();
      }
    });
  }

  // Reset Today's Attendance (Requires user confirmation)
  if (btnResetAttendance) {
    btnResetAttendance.addEventListener('click', () => {
      const confirmed = window.confirm("Are you sure you want to reset today's attendance? This will clear today's check-in timestamp and shift stopwatch for fresh testing.");
      if (!confirmed) return;
      WorkPulseDB.resetTodayAttendance(staff.id);
      if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
        fetch('/api/attendance/reset', {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ staffId: staff.id })
        }).catch(() => {});
      }
      showToast('Today’s attendance reset. You can now test the fresh self-attendance check-in.', 'info');
      checkAttendanceState();
      renderMonthlyKPIs();
      renderStaffCalendar();
    });
  }

  // Manual Checkout button click (Early checkout with styled modal)
  const checkoutModal = document.getElementById('checkout-confirm-modal');
  const btnCloseCheckout = document.getElementById('btn-close-checkout-modal');
  const btnCancelCheckout = document.getElementById('btn-cancel-checkout');
  const btnConfirmCheckout = document.getElementById('btn-confirm-checkout');

  if (btnManualCheckout) {
    btnManualCheckout.addEventListener('click', () => {
      if (checkoutModal) {
        checkoutModal.classList.add('open');
      } else {
        executeCheckout();
      }
    });
  }

  btnCloseCheckout?.addEventListener('click', () => checkoutModal?.classList.remove('open'));
  btnCancelCheckout?.addEventListener('click', () => checkoutModal?.classList.remove('open'));

  btnConfirmCheckout?.addEventListener('click', () => {
    executeCheckout();
    checkoutModal?.classList.remove('open');
  });

  // Start / End Lunch Break button handler (Single authoritative controller)
  if (btnLunchBreak) {
    btnLunchBreak.addEventListener('click', () => {
      const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
      if (!todayRec || todayRec.checkIn === '--:--' || (todayRec.checkOut && todayRec.checkOut !== '--:--')) {
        showToast('Shift is not active.', 'warning');
        return;
      }
      if (todayRec.shiftStatus === 'lunch') {
        const res = WorkPulseDB.endLunchBreak(staff.id);
        if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
          fetch('/api/activity/lunch/end', {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ staffId: staff.id })
          }).catch(() => {});
        }
        if (res && res.success) {
          playCorporateChime('success');
          showToast(`Lunch break ended (${res.record.lunchBreak.durationMinutes}m). Working shift stopwatch resumed.`, 'success');
          checkAttendanceState();
          resetInactivityTimer();
          renderMonthlyKPIs();
          renderStaffCalendar();
        } else {
          showToast(res?.error || 'Unable to end lunch break.', 'error');
        }
      } else {
        if (todayRec.lunchBreak && todayRec.lunchBreak.used) {
          showToast('Policy: Only one lunch break is permitted per shift.', 'warning');
          return;
        }
        if (todayRec.shiftStatus === 'inactive') {
          showToast('Please resume work before starting lunch break.', 'warning');
          return;
        }
        const res = WorkPulseDB.startLunchBreak(staff.id);
        if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
          fetch('/api/activity/lunch/start', {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ staffId: staff.id })
          }).catch(() => {});
        }
        if (res && res.success) {
          playCorporateChime('success');
          showToast(`Lunch break started at ${res.record.lunchBreak.startedAt}. Working shift timer paused.`, 'info');
          checkAttendanceState();
          renderMonthlyKPIs();
          renderStaffCalendar();
        } else {
          showToast(res?.error || 'Unable to start lunch break.', 'warning');
        }
      }
    });
  }

  function executeCheckout() {
    const rec = WorkPulseDB.checkOutStaff(staff.id, cachedCoords);
    if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
      fetch('/api/attendance/check-out', {
        method: 'POST',
        headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ staffId: staff.id, coordinates: cachedCoords })
      }).catch(() => {});
    }
    if (rec) {
      playCorporateChime('success');
      showToast(`Checked out at ${rec.checkOut}. Shift completed (Duration: ${rec.workingHours})`, 'success');
      if (shiftStopwatchInterval) {
        clearInterval(shiftStopwatchInterval);
        shiftStopwatchInterval = null;
      }
      activeShiftTimerEl.textContent = rec.workingHours;
      activeShiftTimerEl.style.color = 'var(--royal-blue)';
      if (btnManualCheckout) btnManualCheckout.style.display = 'none';
      checkAttendanceState();
      renderMonthlyKPIs();
      renderStaffCalendar();
    }
  }

  function startShiftStopwatch(checkInTimeStr) {
    if (shiftStopwatchInterval) clearInterval(shiftStopwatchInterval);

    function calculateElapsedTime() {
      const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
      if (!todayRec || todayRec.checkIn === '--:--' || (todayRec.checkOut && todayRec.checkOut !== '--:--')) {
        return;
      }

      const parts = checkInTimeStr.trim().split(/\s+/);
      const timeParts = parts[0].split(':');
      if (timeParts.length < 2) {
        activeShiftTimerEl.textContent = '00h 00m 00s';
        return;
      }

      let inH = parseInt(timeParts[0], 10) || 0;
      const inM = parseInt(timeParts[1], 10) || 0;
      if (parts.length >= 2) {
        const period = parts[1].toUpperCase();
        if (period === 'PM' && inH < 12) inH += 12;
        if (period === 'AM' && inH === 12) inH = 0;
      }

      const tz = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getOfficeTimezone === 'function')
        ? WorkPulseDB.getOfficeTimezone()
        : 'Asia/Kolkata';

      const now = new Date();
      const nowOfficeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const [curH, curM, curS] = nowOfficeStr.split(':').map(Number);
      const curTotalSec = curH * 3600 + curM * 60 + curS;
      const inTotalSec = inH * 3600 + inM * 60;
      let diffSec = curTotalSec - inTotalSec;
      if (diffSec < 0) diffSec = 0;

      // Deduct past completed breaks & inactive periods
      let pauseSec = (todayRec.totalBreakMinutes || 0) * 60;

      // If currently on lunch break, deduct elapsed time of this break so timer does not advance
      if (todayRec.shiftStatus === 'lunch' && todayRec.lunchBreak) {
        if (todayRec.lunchBreak.startTs) {
          const currentBreakSec = Math.floor((now.getTime() - todayRec.lunchBreak.startTs) / 1000);
          if (currentBreakSec > 0) pauseSec += currentBreakSec;
        } else if (todayRec.lunchBreak.startedAt) {
          const lp = todayRec.lunchBreak.startedAt.trim().split(/\s+/);
          const lParts = lp[0].split(':');
          let lh = parseInt(lParts[0], 10) || 0;
          const lm = parseInt(lParts[1], 10) || 0;
          if (lp.length >= 2) {
            if (lp[1].toUpperCase() === 'PM' && lh < 12) lh += 12;
            if (lp[1].toUpperCase() === 'AM' && lh === 12) lh = 0;
          }
          const lunchStartSec = lh * 3600 + lm * 60;
          const currentBreakSec = Math.max(0, curTotalSec - lunchStartSec);
          pauseSec += currentBreakSec;
        }
      }

      // If currently inactive, deduct elapsed time of this inactive period so timer does not advance
      if (todayRec.shiftStatus === 'inactive' && todayRec.currentInactivityStart && todayRec.currentInactivityStart.ts) {
        const currentInactiveSec = Math.floor((now.getTime() - todayRec.currentInactivityStart.ts) / 1000);
        if (currentInactiveSec > 0) pauseSec += currentInactiveSec;
      }

      const totalSec = Math.max(0, diffSec - pauseSec);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;

      const timeFormatted = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;

      if (todayRec.shiftStatus === 'lunch') {
        activeShiftTimerEl.textContent = `⏸️ ${timeFormatted} (Lunch Break)`;
      } else if (todayRec.shiftStatus === 'inactive') {
        activeShiftTimerEl.textContent = `⏸️ ${timeFormatted} (Paused)`;
      } else {
        activeShiftTimerEl.textContent = timeFormatted;
      }
    }

    calculateElapsedTime();
    shiftStopwatchInterval = setInterval(calculateElapsedTime, 1000);
  }

  // --------------------------------------------------------------------------
  // INACTIVITY / OFFLINE DETECTION CONTROLLER (CONFIGURABLE ADMIN SETTINGS)
  // --------------------------------------------------------------------------
  /**
   * Retrieves active inactivity timeout thresholds from Admin Settings
   */
  function getInactivityConfig() {
    const settings = WorkPulseDB.getSettings();
    const systemMinutes = (typeof settings.systemInactivityTimeoutMinutes === 'number' && settings.systemInactivityTimeoutMinutes > 0)
      ? settings.systemInactivityTimeoutMinutes
      : 15;
    const tabMinutes = (typeof settings.tabInactivityTimeoutMinutes === 'number' && settings.tabInactivityTimeoutMinutes > 0)
      ? settings.tabInactivityTimeoutMinutes
      : 60;
    return {
      systemMinutes,
      systemMs: systemMinutes * 60 * 1000,
      tabMinutes,
      tabMs: tabMinutes * 60 * 1000
    };
  }

  // Dynamic aliases for backward compatibility with automated test suites
  let INACTIVITY_TIMEOUT_MS = getInactivityConfig().systemMs;
  let TAB_INACTIVITY_TIMEOUT_MS = getInactivityConfig().tabMs;

  let inactivityTimer = null; // keeps backward-compatibility alias for test suites
  let tabInactivityTimer = null;
  let inactivityHeartbeatInterval = null;
  let lastTabActivityTs = Date.now();
  let lastUserActivityTs = Date.now(); // backward-compatibility alias
  let isInactivePromptOpen = false;

  // System-wide IdleDetector (Chromium Native API)
  let systemIdleDetector = null;
  let systemIdleAbortController = null;
  let isSystemDetectorRunning = false;
  let isSystemIdleDetected = false;

  /**
   * Initializes system-wide idle detection using native Chromium IdleDetector API
   */
  async function initSystemIdleDetector() {
    if (typeof window === 'undefined' || !('IdleDetector' in window)) {
      console.info('WorkPulse: Native IdleDetector API not supported in this browser. Condition 1 will fallback to tab-based detection.');
      return;
    }

    try {
      let permissionState = 'prompt';
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const status = await navigator.permissions.query({ name: 'idle-detection' });
          permissionState = status.state;
        } catch (_) {}
      }

      if (permissionState === 'prompt' && typeof IdleDetector.requestPermission === 'function') {
        permissionState = await IdleDetector.requestPermission();
      }

      if (permissionState === 'granted') {
        if (systemIdleAbortController) {
          systemIdleAbortController.abort();
        }
        systemIdleAbortController = new AbortController();
        systemIdleDetector = new IdleDetector();

        const config = getInactivityConfig();
        INACTIVITY_TIMEOUT_MS = config.systemMs;
        TAB_INACTIVITY_TIMEOUT_MS = config.tabMs;

        systemIdleDetector.addEventListener('change', () => {
          const userState = systemIdleDetector.user;     // 'active' or 'idle'
          const screenState = systemIdleDetector.screen; // 'locked' or 'unlocked'

          if (userState === 'idle' || screenState === 'locked') {
            isSystemIdleDetected = true;
            // Condition 1 Triggered: entire computer is idle for configured systemMinutes or locked
            const currentCfg = getInactivityConfig();
            triggerInactivityPause(`System-wide idle (${currentCfg.systemMinutes} continuous minutes)`);
          } else {
            isSystemIdleDetected = false;
          }
        });

        // Threshold: minimum supported by Chrome IdleDetector is 60,000 ms (1 minute)
        const thresholdMs = Math.max(60000, config.systemMs);
        await systemIdleDetector.start({
          threshold: thresholdMs,
          signal: systemIdleAbortController.signal
        });
        isSystemDetectorRunning = true;
        console.log(`WorkPulse: Native System-wide Idle Detection started successfully (${config.systemMinutes}m configured threshold).`);
      }
    } catch (err) {
      console.warn('WorkPulse: Native IdleDetector setup note:', err);
    }
  }

  /**
   * Resets and registers activity inside the WorkPulse tab (Condition 2)
   */
  function resetInactivityTimer() {
    lastTabActivityTs = Date.now();
    lastUserActivityTs = lastTabActivityTs;

    const config = getInactivityConfig();
    INACTIVITY_TIMEOUT_MS = config.systemMs;
    TAB_INACTIVITY_TIMEOUT_MS = config.tabMs;

    const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
    if (!todayRec || todayRec.checkIn === '--:--' || (todayRec.checkOut && todayRec.checkOut !== '--:--')) {
      if (tabInactivityTimer) clearTimeout(tabInactivityTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      return;
    }

    // If already in inactive status and user interacts, prompt to resume
    if (todayRec.shiftStatus === 'inactive') {
      if (!isInactivePromptOpen) {
        openInactivityResumeModal();
      }
      return;
    }

    // If currently on lunch break, do not pause timer for inactivity
    if (todayRec.shiftStatus === 'lunch') {
      if (tabInactivityTimer) clearTimeout(tabInactivityTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
      return;
    }

    // Start system idle detector if shift is active and not running yet
    if (!isSystemDetectorRunning && 'IdleDetector' in window) {
      initSystemIdleDetector();
    }

    // Condition 2: Schedule WorkPulse tab inactivity timer
    if (tabInactivityTimer) clearTimeout(tabInactivityTimer);
    tabInactivityTimer = setTimeout(() => {
      triggerInactivityPause(`WorkPulse tab inactive (${config.tabMinutes} continuous minutes)`);
    }, config.tabMs);
    inactivityTimer = tabInactivityTimer; // maintain alias
  }

  /**
   * Triggers inactivity pause on working timer
   */
  function triggerInactivityPause(reason) {
    const config = getInactivityConfig();
    const finalReason = reason || `System-wide idle (${config.systemMinutes} continuous minutes)`;

    const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
    if (!todayRec || todayRec.checkIn === '--:--' || (todayRec.checkOut && todayRec.checkOut !== '--:--')) return;
    if (todayRec.shiftStatus === 'lunch' || todayRec.shiftStatus === 'inactive') return;

    WorkPulseDB.recordInactivityStart(staff.id, finalReason);
    playCorporateChime('error');
    showToast(`Inactive — Timer Paused (${finalReason})`, 'warning');
    checkAttendanceState();
    openInactivityResumeModal();
  }

  function openInactivityResumeModal() {
    isInactivePromptOpen = true;
    const config = getInactivityConfig();
    const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
    if (modalInactiveStartTime && todayRec && todayRec.currentInactivityStart) {
      modalInactiveStartTime.textContent = todayRec.currentInactivityStart.timeStr;
    }
    const modalReasonEl = document.getElementById('modal-inactive-reason');
    if (modalReasonEl && todayRec && todayRec.currentInactivityStart) {
      modalReasonEl.textContent = `Trigger: ${todayRec.currentInactivityStart.reason || `${config.systemMinutes}m inactivity`}`;
    }
    const modalExplanationEl = document.getElementById('modal-inactive-explanation');
    if (modalExplanationEl) {
      modalExplanationEl.textContent = `Working timer is paused (${config.systemMinutes} minutes of system-wide inactivity or ${config.tabMinutes} minutes of WorkPulse tab inactivity limit reached). The inactive duration will not count toward working hours.`;
    }
    inactivityResumeModal?.classList.add('open');
  }

  function closeInactivityResumeModal() {
    isInactivePromptOpen = false;
    inactivityResumeModal?.classList.remove('open');
  }

  function resumeFromInactivity() {
    const res = WorkPulseDB.recordInactivityResume(staff.id);
    closeInactivityResumeModal();
    if (res && res.success) {
      playCorporateChime('success');
      showToast('Shift resumed! Working-hours timer continued.', 'success');
      lastTabActivityTs = Date.now();
      lastUserActivityTs = lastTabActivityTs;
      isSystemIdleDetected = false;
      checkAttendanceState();
      renderMonthlyKPIs();
      renderStaffCalendar();
      resetInactivityTimer();
      initSystemIdleDetector();
    }
  }

  // Track user activity across WorkPulse tab window (Condition 2)
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
    window.addEventListener(evt, () => {
      // Throttle user activity calls to once every 2 seconds
      if (Date.now() - lastTabActivityTs > 2000) {
        resetInactivityTimer();
      }
    }, { passive: true });
  });

  // Independent heartbeat interval for Condition 2 (configured tab inactivity)
  if (inactivityHeartbeatInterval) clearInterval(inactivityHeartbeatInterval);
  inactivityHeartbeatInterval = setInterval(() => {
    const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
    if (!todayRec || todayRec.checkIn === '--:--' || (todayRec.checkOut && todayRec.checkOut !== '--:--')) {
      return;
    }
    if (todayRec.shiftStatus === 'lunch' || todayRec.shiftStatus === 'inactive') {
      return;
    }

    const config = getInactivityConfig();
    INACTIVITY_TIMEOUT_MS = config.systemMs;
    TAB_INACTIVITY_TIMEOUT_MS = config.tabMs;

    const elapsedTabInactiveMs = Date.now() - lastTabActivityTs;
    if (elapsedTabInactiveMs >= config.tabMs) {
      triggerInactivityPause(`WorkPulse tab inactive (${config.tabMinutes} continuous minutes)`);
    }
  }, 10000);

  // Cross-tab synchronization: re-apply updated timeouts when Admin changes settings
  window.addEventListener('storage', (e) => {
    if (e.key === WP_STORAGE_KEY) {
      const cfg = getInactivityConfig();
      INACTIVITY_TIMEOUT_MS = cfg.systemMs;
      TAB_INACTIVITY_TIMEOUT_MS = cfg.tabMs;
      resetInactivityTimer();
    }
  });

  // Resume Work button clicks (Banner + Modal)
  bannerBtnResumeWork?.addEventListener('click', resumeFromInactivity);
  modalBtnResumeWork?.addEventListener('click', resumeFromInactivity);
  btnCloseInactivityModal?.addEventListener('click', closeInactivityResumeModal);

  // Quick Demo Trigger: Simulate inactivity without waiting
  btnSimulateInactivity?.addEventListener('click', () => {
    const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayDateStr })[0];
    if (!todayRec || todayRec.checkIn === '--:--' || (todayRec.checkOut && todayRec.checkOut !== '--:--')) {
      showToast('Please check in first to test inactivity detection.', 'info');
      return;
    }
    if (todayRec.shiftStatus === 'lunch') {
      showToast('Staff is on Lunch Break. Resume from lunch before testing inactivity.', 'warning');
      return;
    }
    if (todayRec.shiftStatus === 'inactive') {
      openInactivityResumeModal();
      return;
    }
    const cfg = getInactivityConfig();
    triggerInactivityPause(`Simulation: System-wide idle (${cfg.systemMinutes} continuous minutes)`);
  });

  // --------------------------------------------------------------------------
  // 7. MONTHLY ATTENDANCE KPIS
  // --------------------------------------------------------------------------
  function renderMonthlyKPIs() {
    const summary = WorkPulseDB.getMonthSummaryForStaff(staff.id, activeYear, activeMonth);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    const workingDaysEl = document.getElementById('my-kpi-working-days');
    if (workingDaysEl) workingDaysEl.textContent = summary.totalWorkingDays;

    const workingDaysSub = document.getElementById('my-kpi-working-days-sub') || document.querySelector('#my-kpi-working-days + div');
    if (workingDaysSub) workingDaysSub.textContent = `${monthNames[activeMonth]} ${activeYear}`;

    const presentEl = document.getElementById('my-kpi-present');
    if (presentEl) presentEl.textContent = summary.presentDays;

    const halfdayEl = document.getElementById('my-kpi-halfday');
    if (halfdayEl) halfdayEl.textContent = summary.halfDays;

    const leaveEl = document.getElementById('my-kpi-leave');
    if (leaveEl) leaveEl.textContent = summary.leaveDays;

    const wfhEl = document.getElementById('my-kpi-wfh');
    if (wfhEl) wfhEl.textContent = summary.wfhDays;

    const pctEl = document.getElementById('my-kpi-pct');
    if (pctEl) pctEl.textContent = summary.attendancePercentage;
  }

  // --------------------------------------------------------------------------
  // INTERACTIVE CALENDAR HOVER TOOLTIP SINGLETON (STAFF PORTAL)
  // --------------------------------------------------------------------------
  let calendarTooltipEl = document.getElementById('wp-calendar-tooltip');
  if (!calendarTooltipEl) {
    calendarTooltipEl = document.createElement('div');
    calendarTooltipEl.id = 'wp-calendar-tooltip';
    calendarTooltipEl.className = 'wp-calendar-tooltip';
    document.body.appendChild(calendarTooltipEl);
  }

  // --------------------------------------------------------------------------
  // AUTHENTIC ATTENDANCE & STATUS DETERMINATION ENGINE
  // --------------------------------------------------------------------------
  function getStaffDayStatus(dateStr, rec, allLeaves = [], allWfh = []) {
    const dateObj = new Date(dateStr + 'T00:00:00');
    const isWeeklyOff = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.isDateWeeklyOff === 'function') 
      ? WorkPulseDB.isDateWeeklyOff(dateStr) 
      : (dateObj.getDay() === 0);
    const isFuture = dateStr > todayDateStr;
    const isToday = dateStr === todayDateStr;
    const isPast = dateStr < todayDateStr;

    // Check approved leave
    const matchedLeave = allLeaves.find(l => {
      const start = l.leaveDate || l.startDate;
      const end = l.toDate || l.endDate || start;
      return dateStr >= start && dateStr <= end;
    });

    // Check approved WFH
    const matchedWfh = allWfh.find(w => w.date === dateStr);

    if (isWeeklyOff) {
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      return {
        status: 'Weekly Off',
        label: `${dayName} Off`,
        badgeClass: 'badge-sunday',
        cellClass: 'status-sunday',
        icon: '⚪',
        checkIn: '--:--',
        checkOut: '--:--',
        hours: 'Off',
        location: `Weekly Off (${dayName})`,
        notes: `${dayName} Weekly Off (Excluded from working days)`
      };
    }

    // STRICT GUARD: Future dates MUST NEVER be marked as Present or Half Day
    if (isFuture) {
      if (matchedLeave) {
        return {
          status: 'Leave',
          label: 'Leave',
          badgeClass: 'badge-leave',
          cellClass: 'status-leave',
          icon: '🔴',
          checkIn: '--:--',
          checkOut: '--:--',
          hours: '0h 00m',
          location: 'On Approved Leave',
          notes: `Approved Leave (${matchedLeave.leaveType || 'Leave'}${matchedLeave.reason ? ': ' + matchedLeave.reason : ''})`
        };
      }
      if (matchedWfh) {
        return {
          status: 'Work From Home',
          label: 'WFH',
          badgeClass: 'badge-wfh',
          cellClass: 'status-wfh',
          icon: '🟠',
          checkIn: '--:--',
          checkOut: '--:--',
          hours: matchedWfh.workingHours || 'WFH',
          location: 'Remote Work From Home',
          notes: `Approved Work From Home${matchedWfh.reason ? ' (' + matchedWfh.reason + ')' : ''}`
        };
      }
      return {
        status: 'Scheduled',
        label: 'Scheduled',
        badgeClass: 'badge-future',
        cellClass: 'status-future',
        icon: '⚪',
        checkIn: '--:--',
        checkOut: '--:--',
        hours: '--:--',
        location: 'Upcoming scheduled date',
        notes: 'Upcoming scheduled work day'
      };
    }

    // Genuine attendance check: requires a legitimate check-in record
    const hasValidCheckIn = rec && rec.checkIn && rec.checkIn !== '--:--' && (rec.status === 'Present' || rec.status === 'Checked-In' || rec.status === 'Half Day');

    if (hasValidCheckIn) {
      const isHalfDay = rec.status === 'Half Day';
      let hours = rec.workingHours;
      if (!hours || hours === '0h 00m') {
        if (rec.checkOut && rec.checkOut !== '--:--') {
          hours = WorkPulseDB.calculateHoursWorked(rec.checkIn, rec.checkOut, rec.totalBreakMinutes);
        } else {
          hours = 'In Progress';
        }
      }
      return {
        status: isHalfDay ? 'Half Day' : 'Present',
        label: isHalfDay ? 'Half Day' : 'Present',
        badgeClass: isHalfDay ? 'badge-halfday' : 'badge-present',
        cellClass: isHalfDay ? 'status-halfday' : 'status-present',
        icon: isHalfDay ? '🟤' : '🟢',
        checkIn: rec.checkIn || '--:--',
        checkOut: rec.checkOut || '--:--',
        hours: hours || '--:--',
        location: rec.location || 'Verified Location',
        notes: rec.notes || (rec.checkOut && rec.checkOut !== '--:--' ? 'Shift completed with verified GPS telemetry' : 'Shift currently active and tracking')
      };
    }

    if (matchedLeave) {
      return {
        status: 'Leave',
        label: 'Leave',
        badgeClass: 'badge-leave',
        cellClass: 'status-leave',
        icon: '🔴',
        checkIn: '--:--',
        checkOut: '--:--',
        hours: '0h 00m',
        location: 'On Approved Leave',
        notes: `Approved Leave (${matchedLeave.leaveType || 'Leave'}${matchedLeave.reason ? ': ' + matchedLeave.reason : ''})`
      };
    }

    if (matchedWfh) {
      return {
        status: 'Work From Home',
        label: 'WFH',
        badgeClass: 'badge-wfh',
        cellClass: 'status-wfh',
        icon: '🟠',
        checkIn: rec?.checkIn || '--:--',
        checkOut: rec?.checkOut || '--:--',
        hours: matchedWfh.workingHours || (rec?.workingHours) || 'WFH',
        location: 'Remote Work From Home',
        notes: `Approved Work From Home${matchedWfh.reason ? ' (' + matchedWfh.reason + ')' : ''}`
      };
    }

    if (isToday) {
      return {
        status: 'Scheduled',
        label: 'Scheduled',
        badgeClass: 'badge-future',
        cellClass: 'status-future',
        icon: '⚪',
        checkIn: '--:--',
        checkOut: '--:--',
        hours: '--:--',
        location: 'Awaiting Check-In',
        notes: 'Today — shift pending check-in'
      };
    }

    // Past date with no attendance
    return {
      status: 'Not Marked',
      label: 'Not Marked',
      badgeClass: 'badge-not-marked',
      cellClass: 'status-absent',
      icon: '⚪',
      checkIn: '--:--',
      checkOut: '--:--',
      hours: '--:--',
      location: 'No punch recorded',
      notes: 'No attendance recorded for this date'
    };
  }

  function showCalendarTooltip(e, dateStr, rec) {
    if (!calendarTooltipEl) return;

    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const formattedDate = `${dayNames[dateObj.getDay()]}, ${WorkPulseDB.formatDisplayDate(dateStr)}`;

    const allLeaves = WorkPulseDB.getLeaves().filter(l => l.staffId === staff.id && l.status === 'Approved');
    const allWfh = WorkPulseDB.getWfhRequests().filter(w => w.staffId === staff.id && w.status === 'Approved');

    const dayInfo = getStaffDayStatus(dateStr, rec, allLeaves, allWfh);

    let checkoutPolicyNote = (dayInfo.checkOut === '--:--' && dayInfo.checkIn !== '--:--') ? '<span style="font-size:0.68rem; color:#10B981; display:block;">(Shift Active)</span>' : '';

    calendarTooltipEl.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-date">${formattedDate}</span>
        <span class="tooltip-badge ${dayInfo.badgeClass}">${dayInfo.icon} ${dayInfo.label}</span>
      </div>
      <div class="tooltip-row">
        <span class="label">My Check-In:</span>
        <span class="val">${dayInfo.checkIn}</span>
      </div>
      <div class="tooltip-row">
        <span class="label">My Check-Out:</span>
        <span class="val">${dayInfo.checkOut} ${checkoutPolicyNote}</span>
      </div>
      <div class="tooltip-row">
        <span class="label">Shift Duration:</span>
        <span class="val" style="color:var(--gold-soft); font-weight:700;">${dayInfo.hours}</span>
      </div>
      <div class="tooltip-row">
        <span class="label">GPS Telemetry:</span>
        <span class="val" style="font-size:0.72rem;">${dayInfo.location}</span>
      </div>
      ${dayInfo.notes ? `<div class="tooltip-note">${dayInfo.notes}</div>` : ''}
      <div class="tooltip-footer">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>Click day to view audit details</span>
      </div>
    `;

    positionCalendarTooltip(e);
    calendarTooltipEl.classList.add('active');
  }

  function positionCalendarTooltip(e) {
    if (!calendarTooltipEl || !calendarTooltipEl.classList.contains('active')) return;
    const tooltipWidth = 295;
    const tooltipHeight = 185;
    const padding = 12;

    let x = e.clientX + 14;
    let y = e.clientY - (tooltipHeight / 2);

    if (x + tooltipWidth > window.innerWidth - padding) {
      x = e.clientX - tooltipWidth - 14;
    }
    if (x < padding) x = padding;

    if (y + tooltipHeight > window.innerHeight - padding) {
      y = window.innerHeight - tooltipHeight - padding;
    }
    if (y < padding) y = padding;

    calendarTooltipEl.style.left = `${x}px`;
    calendarTooltipEl.style.top = `${y}px`;
  }

  function hideCalendarTooltip() {
    if (calendarTooltipEl) {
      calendarTooltipEl.classList.remove('active');
    }
  }

  // --------------------------------------------------------------------------
  // 8. PERSONAL 5-COLOR ATTENDANCE CALENDAR
  // --------------------------------------------------------------------------
  function renderStaffCalendar() {
    const grid = document.getElementById('staff-calendar-grid');
    if (!grid) return;

    // Month names and navigation labels
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthLabel = document.getElementById('calendar-current-month-label');
    if (monthLabel) monthLabel.textContent = `${monthNames[activeMonth]} ${activeYear}`;

    // Update Previous / Next Month button text dynamically
    const prevIdx = (activeMonth === 0) ? 11 : activeMonth - 1;
    const nextIdx = (activeMonth === 11) ? 0 : activeMonth + 1;
    const btnPrev = document.getElementById('btn-prev-month');
    const btnNext = document.getElementById('btn-next-month');
    if (btnPrev) btnPrev.innerHTML = `&larr; Previous`;
    if (btnNext) btnNext.innerHTML = `Next &rarr;`;

    const kpiMonthSub = document.querySelector('#my-kpi-working-days + div');
    if (kpiMonthSub) kpiMonthSub.textContent = `${monthNames[activeMonth]} ${activeYear}`;

    // Headers
    const headersHtml = `
      <div class="staff-cal-header">Mon</div>
      <div class="staff-cal-header">Tue</div>
      <div class="staff-cal-header">Wed</div>
      <div class="staff-cal-header">Thu</div>
      <div class="staff-cal-header">Fri</div>
      <div class="staff-cal-header">Sat</div>
      <div class="staff-cal-header sunday-col">Sun</div>
    `;

    const firstDay = new Date(activeYear, activeMonth, 1);
    let startDayOfWeek = firstDay.getDay(); // 0 = Sunday
    const offset = (startDayOfWeek === 0) ? 6 : startDayOfWeek - 1;
    const daysInMonth = new Date(activeYear, activeMonth + 1, 0).getDate();

    // Attendance records map
    const records = WorkPulseDB.getAttendance({ staffId: staff.id });
    const recordsByDay = {};
    records.forEach(r => {
      const parts = (r.date || '').split('-');
      if (parseInt(parts[0], 10) === activeYear && parseInt(parts[1], 10) === (activeMonth + 1)) {
        const d = r.dayNumber || parseInt(parts[2], 10);
        if (d) {
          recordsByDay[d] = r;
        }
      }
    });

    const allLeaves = WorkPulseDB.getLeaves().filter(l => l.staffId === staff.id && l.status === 'Approved');
    const allWfh = WorkPulseDB.getWfhRequests().filter(w => w.staffId === staff.id && w.status === 'Approved');

    let html = headersHtml;

    // Empty offset cells
    for (let i = 0; i < offset; i++) {
      html += `<div class="staff-day-cell cal-day-empty" style="background:transparent; border-color:transparent; cursor:default;"></div>`;
    }

    // Days 1..daysInMonth
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${activeYear}-${String(activeMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const rec = recordsByDay[day];
      const dayInfo = getStaffDayStatus(dateStr, rec, allLeaves, allWfh);
      const isTodayCell = (dateStr === todayDateStr);

      html += `
        <div class="staff-day-cell ${dayInfo.cellClass} ${isTodayCell ? 'is-today' : ''}" data-day="${day}" data-date="${dateStr}">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="date-num">${day}</span>
            <div class="d-flex align-items-center gap-1">
              ${isTodayCell ? '<span class="today-pill">TODAY</span>' : ''}
              <span class="cell-status-icon" style="font-size:0.72rem;">${dayInfo.icon}</span>
            </div>
          </div>
          <div class="mt-auto">
            <div class="status-text">${dayInfo.label}</div>
            <div class="status-hours" style="font-size:0.68rem; font-weight:600;">${dayInfo.hours}</div>
          </div>
        </div>
      `;
    }

    grid.innerHTML = html;

    // Wire day hover and clicks
    grid.querySelectorAll('.staff-day-cell:not(.cal-day-empty)').forEach(cell => {
      const dateStr = cell.dataset.date;
      const dayNum = parseInt(cell.dataset.day, 10);
      const rec = recordsByDay[dayNum];

      cell.addEventListener('mouseenter', (e) => {
        showCalendarTooltip(e, dateStr, rec);
      });
      cell.addEventListener('mousemove', (e) => {
        positionCalendarTooltip(e);
      });
      cell.addEventListener('mouseleave', () => {
        hideCalendarTooltip();
      });

      cell.addEventListener('click', () => {
        hideCalendarTooltip();
        openDayDetailModal(dateStr, rec);
      });
    });
  }

  // Month navigation
  document.getElementById('btn-prev-month')?.addEventListener('click', () => {
    activeMonth--;
    if (activeMonth < 0) { activeMonth = 11; activeYear--; }
    renderStaffCalendar();
    renderMonthlyKPIs();
  });

  document.getElementById('btn-next-month')?.addEventListener('click', () => {
    activeMonth++;
    if (activeMonth > 11) { activeMonth = 0; activeYear++; }
    renderStaffCalendar();
    renderMonthlyKPIs();
  });

  // Print Personal Timesheet Button
  document.getElementById('btn-print-staff-calendar')?.addEventListener('click', () => {
    document.body.classList.add('printing-staff-calendar');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-staff-calendar');
    }, 1000);
  });

  // Day Detail Modal
  function openDayDetailModal(dateStr, rec) {
    if (!rec) {
      const records = WorkPulseDB.getAttendance({ staffId: staff.id, date: dateStr });
      if (records && records.length > 0) rec = records[0];
    }
    document.getElementById('day-detail-title').textContent = `Day Timesheet: ${WorkPulseDB.formatDisplayDate(dateStr)}`;
    const body = document.getElementById('day-detail-body');

    const allLeaves = WorkPulseDB.getLeaves().filter(l => l.staffId === staff.id && l.status === 'Approved');
    const allWfh = WorkPulseDB.getWfhRequests().filter(w => w.staffId === staff.id && w.status === 'Approved');
    const dayInfo = getStaffDayStatus(dateStr, rec, allLeaves, allWfh);

    const hasCheckedIn = rec && rec.checkIn && rec.checkIn !== '--:--';
    const lat = rec?.coords?.latitude ?? rec?.latitude;
    const lng = rec?.coords?.longitude ?? rec?.longitude;
    const hasValidCoords = typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);
    let dayLocationText = 'Location unavailable';
    if (hasCheckedIn) {
      dayLocationText = rec.address || rec.location || (hasValidCoords ? `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})` : 'Verified Location');
    } else {
      dayLocationText = dayInfo.location || 'Location unavailable';
    }
    const showMapLink = hasCheckedIn && hasValidCoords;
    const mapUrl = rec?.mapUrl || (hasValidCoords ? `https://www.google.com/maps?q=${lat},${lng}` : '#');

    body.innerHTML = `
      <div style="padding: 10px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="staff-avatar-thumb" style="width:34px; height:34px;">
              ${staff.photo 
                ? `<img src="${staff.photo}" alt="${staff.name}" onerror="this.parentElement.textContent='${getInitials(staff.name)}'">`
                : getInitials(staff.name)}
            </div>
            <div>
              <div style="font-weight:700; color:var(--navy-dark);">${staff.name}</div>
              <div style="font-size:0.72rem; color:var(--text-muted);">${staff.position}</div>
            </div>
          </div>
          <span class="badge badge-gold">${staff.id}</span>
        </div>

        <div style="background:var(--bg-main); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:14px; display:flex; flex-direction:column; gap:8px;">
          <div class="d-flex justify-content-between">
            <span class="text-muted" style="font-size:0.8rem;">Status:</span>
            <span style="font-weight:700;">${dayInfo.icon} ${dayInfo.label}</span>
          </div>
          <div class="d-flex justify-content-between">
            <span class="text-muted" style="font-size:0.8rem;">Punch-In:</span>
            <span style="font-weight:700; color:var(--navy-dark);">${dayInfo.checkIn}</span>
          </div>
          <div class="d-flex justify-content-between">
            <span class="text-muted" style="font-size:0.8rem;">Punch-Out:</span>
            <span style="font-weight:700; color:var(--navy-dark);">${dayInfo.checkOut} ${dayInfo.checkOut === '--:--' && dayInfo.checkIn !== '--:--' ? '<span class="badge badge-success" style="font-size:0.6rem; background:#10B981; color:#fff;">Active Shift</span>' : ''}</span>
          </div>
          ${rec && rec.lunchBreak && (rec.lunchBreak.used || rec.lunchBreak.endedAt) ? `
            <div class="d-flex justify-content-between">
              <span class="text-muted" style="font-size:0.8rem;">Lunch Break:</span>
              <span style="font-weight:700; color:#92400E; font-size:0.8rem;">🍱 ${rec.lunchBreak.startedAt} - ${rec.lunchBreak.endedAt} (${rec.lunchBreak.durationMinutes}m)</span>
            </div>
          ` : (rec && rec.shiftStatus === 'lunch' && rec.lunchBreak ? `
            <div class="d-flex justify-content-between">
              <span class="text-muted" style="font-size:0.8rem;">Lunch Break:</span>
              <span class="badge" style="background:#FEF3C7; color:#92400E; font-size:0.7rem;">🍱 Ongoing (From ${rec.lunchBreak.startedAt})</span>
            </div>
          ` : '')}
          ${rec && (rec.totalInactiveMinutes > 0 || (rec.inactivityPeriods && rec.inactivityPeriods.length > 0)) ? `
            <div class="d-flex justify-content-between">
              <span class="text-muted" style="font-size:0.8rem;">Inactivity Pauses:</span>
              <span style="font-weight:700; color:#DC2626; font-size:0.8rem;">⏸️ ${rec.totalInactiveMinutes || 0}m deducted (${(rec.inactivityPeriods || []).length} event${(rec.inactivityPeriods || []).length === 1 ? '' : 's'})</span>
            </div>
          ` : (rec && rec.shiftStatus === 'inactive' && rec.currentInactivityStart ? `
            <div class="d-flex justify-content-between">
              <span class="text-muted" style="font-size:0.8rem;">Inactivity Status:</span>
              <span class="badge" style="background:#FEE2E2; color:#991B1B; font-size:0.7rem;">⏸️ Paused (Since ${rec.currentInactivityStart.timeStr})</span>
            </div>
          ` : '')}
          <div class="d-flex justify-content-between">
            <span class="text-muted" style="font-size:0.8rem;">Net Hours Worked:</span>
            <span style="font-weight:700; color:var(--royal-blue);">${dayInfo.hours}</span>
          </div>
          <div class="d-flex justify-content-between align-items-start">
            <span class="text-muted" style="font-size:0.8rem;">Location:</span>
            <div style="font-size:0.75rem; text-align:right; max-width:240px;">
              <div style="color:var(--navy-dark); font-weight:600;">${dayLocationText}</div>
              ${showMapLink ? `
                <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:3px; color:var(--royal-blue); font-weight:600; text-decoration:underline; font-size:0.72rem; margin-top:3px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                  <span>View on Map &rarr;</span>
                </a>
              ` : ''}
            </div>
          </div>
          <div style="border-top:1px dashed var(--border-color); padding-top:6px; margin-top:4px;">
            <div class="text-muted" style="font-size:0.75rem; font-weight:700;">Log Notes:</div>
            <div style="font-size:0.8rem; color:var(--navy-dark);">${dayInfo.notes}</div>
          </div>
        </div>
      </div>
    `;

    dayDetailModal.classList.add('open');
  }

  // Helper: Calculate inclusive days for leave range
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

  // Helper: Format date string cleanly for display
  function formatDisplayDate(dateStr) {
    if (!dateStr) return '--';
    return (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function')
      ? (WorkPulseDB.formatDisplayDate(dateStr) || '--')
      : dateStr;
  }

  // --------------------------------------------------------------------------
  // 9. MY APPLICATIONS TABLES (LEAVES & WFH)
  // --------------------------------------------------------------------------
  function renderMyApplications(skipFetch = false) {
    renderMyApplicationsUI();
    if (!skipFetch) {
      fetchAndSyncMyLeaves();
      fetchAndSyncMyWfh();
    }
  }

  let isFetchingMyLeaves = false;
  let lastLeavesFetchTime = 0;

  function fetchAndSyncMyLeaves(force = false) {
    if (typeof fetch !== 'function' || !window.location || !window.location.protocol.startsWith('http')) return;
    const sId = currentStaffId || (staff ? staff.id : '');
    if (!sId) return;

    const now = Date.now();
    if (!force && (isFetchingMyLeaves || (now - lastLeavesFetchTime < 5000))) {
      return;
    }

    isFetchingMyLeaves = true;
    lastLeavesFetchTime = now;

    fetch('/api/leaves', {
      headers: WorkPulseDB.getAuthHeaders(),
      credentials: 'include'
    })
      .then(res => res.json())
      .then(json => {
        if (json && json.success && Array.isArray(json.data)) {
          const currentDb = WorkPulseDB.load();
          const existingMyLeaves = (currentDb.leaves || []).filter(l => 
            String(l.staffId || '').trim().toUpperCase() === String(sId).trim().toUpperCase()
          );
          const hasChanged = JSON.stringify(existingMyLeaves) !== JSON.stringify(json.data);
          if (hasChanged) {
            const otherLeaves = (currentDb.leaves || []).filter(l => 
              String(l.staffId || '').trim().toUpperCase() !== String(sId).trim().toUpperCase()
            );
            currentDb.leaves = [...json.data, ...otherLeaves];
            WorkPulseDB.save(currentDb, true);
            renderMyApplicationsUI();
            renderMonthlyKPIs();
            renderStaffCalendar();
          }
        }
      })
      .catch(err => {
        console.warn('Could not sync leaves with server:', err);
      })
      .finally(() => {
        isFetchingMyLeaves = false;
      });
  }

  let isFetchingMyWfh = false;
  let lastWfhFetchTime = 0;

  function fetchAndSyncMyWfh(force = false) {
    if (typeof fetch !== 'function' || !window.location || !window.location.protocol.startsWith('http')) return;
    const sId = currentStaffId || (staff ? staff.id : '');
    if (!sId) return;

    const now = Date.now();
    if (!force && (isFetchingMyWfh || (now - lastWfhFetchTime < 5000))) {
      return;
    }

    isFetchingMyWfh = true;
    lastWfhFetchTime = now;

    fetch('/api/wfh', {
      headers: WorkPulseDB.getAuthHeaders(),
      credentials: 'include'
    })
      .then(res => res.json())
      .then(json => {
        if (json && json.success && Array.isArray(json.data)) {
          const currentDb = WorkPulseDB.load();
          const existingMyWfh = (currentDb.wfhRequests || []).filter(w => 
            String(w.staffId || '').trim().toUpperCase() === String(sId).trim().toUpperCase()
          );
          const hasChanged = JSON.stringify(existingMyWfh) !== JSON.stringify(json.data);
          if (hasChanged) {
            const otherWfh = (currentDb.wfhRequests || []).filter(w => 
              String(w.staffId || '').trim().toUpperCase() !== String(sId).trim().toUpperCase()
            );
            currentDb.wfhRequests = [...json.data, ...otherWfh];
            WorkPulseDB.save(currentDb, true);
            renderMyApplicationsUI();
            renderMonthlyKPIs();
            renderStaffCalendar();
          }
        }
      })
      .catch(err => {
        console.warn('Could not sync WFH with server:', err);
      })
      .finally(() => {
        isFetchingMyWfh = false;
      });
  }

  function renderMyApplicationsUI() {
    const sId = currentStaffId || (staff ? staff.id : '');
    // 1. My Leaves
    const allLeaves = WorkPulseDB.getLeaves ? WorkPulseDB.getLeaves() : [];
    const myLeaves = allLeaves.filter(l => 
      String(l.staffId || '').trim().toUpperCase() === String(sId || '').trim().toUpperCase()
    );
    const leavesTbody = document.getElementById('my-leaves-tbody');
    const totalBadge = document.getElementById('my-leaves-total-badge');
    const navBadge = document.getElementById('badge-my-leaves');

    const totalLeavesText = `${myLeaves.length} ${myLeaves.length === 1 ? 'request' : 'requests'}`;
    if (totalBadge && totalBadge.textContent !== totalLeavesText) {
      totalBadge.textContent = totalLeavesText;
    }
    if (navBadge) {
      const pendingCount = String(myLeaves.filter(l => (l.status || '').toLowerCase() === 'pending').length);
      if (navBadge.textContent !== pendingCount) {
        navBadge.textContent = pendingCount;
      }
    }

    if (leavesTbody) {
      const leavesSignature = JSON.stringify(myLeaves);
      if (leavesTbody.dataset.renderedSignature !== leavesSignature) {
        leavesTbody.dataset.renderedSignature = leavesSignature;
        if (myLeaves.length === 0) {
          leavesTbody.innerHTML = renderEmptyTableState(7, 'No Leave Applications', 'You have not submitted any leave requests yet.');
        } else {
        leavesTbody.innerHTML = myLeaves.map(l => {
          let badge = '';
          const st = (l.status || 'Pending').trim();
          if (st === 'Pending') {
            badge = `<span class="badge badge-gold" style="font-size:0.75rem; padding:4px 10px; font-weight:700;">⏳ Pending</span>`;
          } else if (st === 'Approved') {
            badge = `<span class="badge" style="font-size:0.75rem; padding:4px 10px; font-weight:700; background:#059669; color:#FFFFFF; border:1px solid #059669;">✅ Approved</span>`;
          } else {
            badge = `<span class="badge" style="font-size:0.75rem; padding:4px 10px; font-weight:700; background:#FEE2E2; color:#991B1B; border:1px solid #F87171;">❌ Rejected</span>`;
          }

          const adminCommentText = (l.adminComment || l.approvalComment || l.notes || '').trim();
          const rejectionReasonText = (l.rejectionReason || l.adminComment || '').trim();

          let decisionInfo = '';
          if (st === 'Rejected') {
            decisionInfo = `
              <div style="margin-top: 6px; padding: 6px 10px; background: #FEF2F2; border-left: 3px solid #EF4444; border-radius: 4px; color: #991B1B; font-size: 0.74rem; line-height: 1.4;">
                <div style="font-weight: 700; display:flex; align-items:center; gap:4px;">
                  <span>⚠️ Rejection Reason:</span>
                </div>
                <div style="margin-top:2px;">${escapeHtml(rejectionReasonText || 'No reason specified by administration.')}</div>
                ${l.reviewedAt ? `<div style="font-size: 0.68rem; color: #B91C1C; margin-top: 3px;">Reviewed: ${new Date(l.reviewedAt).toLocaleString()}</div>` : ''}
              </div>
            `;
          } else if (st === 'Approved') {
            decisionInfo = `
              <div style="margin-top: 6px; padding: 6px 10px; background: #ECFDF5; border-left: 3px solid #10B981; border-radius: 4px; color: #065F46; font-size: 0.74rem; line-height: 1.4;">
                <div style="font-weight: 700; display:flex; align-items:center; gap:4px;">
                  <span>✓ Approved by Admin</span>
                </div>
                ${adminCommentText ? `<div style="margin-top:2px; color:#047857;"><strong>Admin Note:</strong> ${escapeHtml(adminCommentText)}</div>` : ''}
                ${l.reviewedAt ? `<div style="font-size: 0.68rem; color: #059669; margin-top: 3px;">Reviewed: ${new Date(l.reviewedAt).toLocaleString()}</div>` : ''}
              </div>
            `;
          } else {
            decisionInfo = `<div style="font-size:0.72rem; color:#D97706; margin-top:4px;">⏳ Awaiting Executive Review</div>`;
          }

          const sDate = l.startDate || l.leaveDate || '';
          const eDate = l.endDate || l.toDate || sDate;
          const totalDays = l.totalDays || calculateLeaveDays(sDate, eDate);
          const appliedDate = l.appliedDate || (l.createdAt ? l.createdAt.split('T')[0] : '') || sDate;

          return `
            <tr>
              <td>
                <span class="badge" style="background:#F1F5F9; color:#1E3A5F; font-size:0.75rem; padding:4px 8px; border:1px solid #CBD5E1; font-weight:600;">
                  ${escapeHtml(l.leaveType || 'Casual Leave')}
                </span>
              </td>
              <td style="font-weight:600; font-size:0.8rem; color:var(--navy-dark);">${formatDisplayDate(sDate)}</td>
              <td style="font-weight:600; font-size:0.8rem; color:var(--navy-dark);">${formatDisplayDate(eDate)}</td>
              <td class="text-center">
                <span class="badge badge-info" style="font-size:0.75rem; padding:3px 8px; font-weight:700;">
                  ${totalDays} ${totalDays === 1 ? 'Day' : 'Days'}
                </span>
              </td>
              <td style="font-size:0.78rem; max-width:280px;">
                <div style="color:var(--navy-dark); font-weight:500;">${escapeHtml(l.reason || 'No description provided')}</div>
                ${decisionInfo}
              </td>
              <td style="font-size:0.78rem; color:#64748B;">${formatDisplayDate(appliedDate)}</td>
              <td class="text-end">${badge}</td>
            </tr>
          `;
        }).join('');
        }
      }
    }

    // 2. My WFH
    const allWfh = WorkPulseDB.getWfhRequests ? WorkPulseDB.getWfhRequests() : [];
    const myWfh = allWfh.filter(w => String(w.staffId || '').trim().toUpperCase() === String(sId || '').trim().toUpperCase());
    const wfhTbody = document.getElementById('my-wfh-tbody');
    const wfhTotalBadge = document.getElementById('my-wfh-total-badge');
    const wfhNavBadge = document.getElementById('badge-my-wfh');

    const totalWfhText = `${myWfh.length} ${myWfh.length === 1 ? 'request' : 'requests'}`;
    if (wfhTotalBadge && wfhTotalBadge.textContent !== totalWfhText) {
      wfhTotalBadge.textContent = totalWfhText;
    }
    if (wfhNavBadge) {
      const pendingCount = String(myWfh.filter(w => (w.status || '').toLowerCase() === 'pending').length);
      if (wfhNavBadge.textContent !== pendingCount) {
        wfhNavBadge.textContent = pendingCount;
      }
    }

    if (wfhTbody) {
      const wfhSignature = JSON.stringify(myWfh);
      if (wfhTbody.dataset.renderedSignature !== wfhSignature) {
        wfhTbody.dataset.renderedSignature = wfhSignature;
        if (myWfh.length === 0) {
          wfhTbody.innerHTML = renderEmptyTableState(5, 'No WFH Requests', 'You have not submitted any remote work requests yet.');
        } else {
        wfhTbody.innerHTML = myWfh.map(w => {
          let badge = '';
          const st = (w.status || 'Pending').trim();
          if (st.toLowerCase() === 'approved') {
            badge = `<span class="badge" style="font-size:0.75rem; padding:4px 10px; font-weight:700; background:#ECFDF5; color:#047857; border:1px solid #6EE7B7; border-radius:9999px; display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#10B981; display:inline-block;"></span> Approved</span>`;
          } else if (st.toLowerCase() === 'rejected') {
            badge = `<span class="badge" style="font-size:0.75rem; padding:4px 10px; font-weight:700; background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5; border-radius:9999px; display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#EF4444; display:inline-block;"></span> Rejected</span>`;
          } else {
            badge = `<span class="badge" style="font-size:0.75rem; padding:4px 10px; font-weight:700; background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; border-radius:9999px; display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#EA580C; display:inline-block;"></span> Pending</span>`;
          }

          const adminComment = (w.adminComment || w.notes || w.approvalComment || '').trim();
          const rejectionReason = (w.rejectionReason || w.adminComment || '').trim();

          let wfhDecisionInfo = '';
          if (st.toLowerCase() === 'approved') {
            wfhDecisionInfo = `
              <div style="margin-top: 6px; padding: 6px 10px; background: #ECFDF5; border-left: 3px solid #10B981; border-radius: 4px; color: #065F46; font-size: 0.74rem; line-height: 1.4;">
                <div style="font-weight: 700; display:flex; align-items:center; gap:4px; color:#047857;">
                  <span>✓ Approved by ${escapeHtml(w.reviewedBy || 'Admin')}</span>
                  ${w.reviewedAt ? `<span style="font-weight:400; color:#059669; font-size:0.7rem;">on ${WorkPulseDB.formatDisplayDate(w.reviewedAt)}</span>` : ''}
                </div>
                ${adminComment ? `<div style="margin-top:3px; color:#047857;"><strong>Admin Comment:</strong> ${escapeHtml(adminComment)}</div>` : ''}
              </div>
            `;
          } else if (st.toLowerCase() === 'rejected') {
            wfhDecisionInfo = `
              <div style="margin-top: 6px; padding: 6px 10px; background: #FEF2F2; border-left: 3px solid #EF4444; border-radius: 4px; color: #991B1B; font-size: 0.74rem; line-height: 1.4;">
                <div style="font-weight: 700; display:flex; align-items:center; gap:4px; color:#DC2626;">
                  <span>⚠️ Rejection Reason:</span>
                </div>
                <div style="margin-top:2px;">${escapeHtml(rejectionReason || 'No reason specified by administration.')}</div>
                ${w.reviewedAt ? `<div style="font-size: 0.68rem; color: #B91C1C; margin-top: 3px;">Reviewed: ${WorkPulseDB.formatDisplayDate(w.reviewedAt, true)}</div>` : ''}
              </div>
            `;
          } else {
            wfhDecisionInfo = `<div style="font-size:0.72rem; color:#D97706; margin-top:4px;">⏳ Awaiting Administrative Review</div>`;
          }

          return `
            <tr>
              <td style="white-space:nowrap;">
                <div style="font-weight:700; font-size:0.82rem; color:var(--navy-dark);">${escapeHtml(WorkPulseDB.formatDisplayDate(w.date))}</div>
                <div style="font-size:0.7rem; color:#64748B;">${formatDisplayDate(w.date)}</div>
              </td>
              <td style="font-size:0.78rem; min-width:220px; max-width:320px;" title="${escapeHtml(w.reason || '')}">
                <div style="color:var(--navy-dark); font-weight:600; word-break:break-word;">${escapeHtml(w.reason || 'No description provided')}</div>
                ${wfhDecisionInfo}
              </td>
              <td class="text-center" style="white-space:nowrap;">
                <span class="badge" style="background:#EFF6FF; color:#1D4ED8; font-weight:700; font-size:0.78rem; padding:4px 8px; border-radius:6px; border:1px solid #BFDBFE;">
                  ${escapeHtml(w.workingHours || '8h 00m')}
                </span>
              </td>
              <td class="text-center" style="white-space:nowrap;">${badge}</td>
              <td class="text-end" style="white-space:nowrap;">
                <button type="button" class="btn btn-secondary btn-sm btn-view-wfh" data-wfh-id="${escapeHtml(w.id)}" style="font-size:0.75rem; padding:4px 10px; font-weight:600; display:inline-flex; align-items:center; gap:4px; border-radius:6px;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  <span>View Details</span>
                </button>
              </td>
            </tr>
          `;
        }).join('');
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 10. MODAL INTERACTIONS (LEAVE & WFH SUBMISSIONS)
  // --------------------------------------------------------------------------
  // Leave & WFH date pickers & controls
  const leaveStartDateInput = document.getElementById('leave-start-date');
  const leaveEndDateInput = document.getElementById('leave-end-date');
  const wfhDateInput = document.getElementById('wfh-date');

  function getLocalDateString() {
    if (WorkPulseDB && typeof WorkPulseDB.getTodayDateString === 'function') {
      return WorkPulseDB.getTodayDateString();
    }
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function updateLeaveModalDuration() {
    const startVal = leaveStartDateInput ? leaveStartDateInput.value : '';
    const endVal = leaveEndDateInput ? leaveEndDateInput.value : '';
    const dispEl = document.getElementById('leave-days-count-display');
    if (!dispEl) return;

    if (!startVal) {
      dispEl.innerHTML = 'Please select a Start Date.';
      return;
    }
    if (!endVal || endVal === startVal) {
      dispEl.innerHTML = `Duration: <strong>1 Day</strong> (${formatDisplayDate(startVal)})`;
      return;
    }
    if (endVal < startVal) {
      dispEl.innerHTML = `<span style="color:#DC2626;">End Date cannot be earlier than Start Date.</span>`;
      return;
    }
    const days = calculateLeaveDays(startVal, endVal);
    dispEl.innerHTML = `Duration: <strong>${days} Days</strong> (${formatDisplayDate(startVal)} &rarr; ${formatDisplayDate(endVal)})`;
  }

  function initLeaveFormDates(forceToday = false) {
    const today = getLocalDateString();
    if (leaveStartDateInput) {
      if (forceToday || !leaveStartDateInput.value) {
        leaveStartDateInput.value = today;
      }
    }
    if (leaveEndDateInput) {
      if (forceToday || !leaveEndDateInput.value) {
        leaveEndDateInput.value = today;
      }
      if (leaveStartDateInput && leaveStartDateInput.value) {
        leaveEndDateInput.min = leaveStartDateInput.value;
      } else {
        leaveEndDateInput.min = today;
      }
    }
    updateLeaveModalDuration();
  }

  function openLeaveModal() {
    if (!applyLeaveModal) return;
    initLeaveFormDates(true);
    applyLeaveModal.classList.add('open');
  }

  function openWfhModal() {
    if (!applyWfhModal) return;
    const today = getLocalDateString();
    if (wfhDateInput) {
      wfhDateInput.value = today;
    }
    applyWfhModal.classList.add('open');
  }

  // Initial sync on script load
  initLeaveFormDates(true);
  if (wfhDateInput && !wfhDateInput.value) {
    wfhDateInput.value = getLocalDateString();
  }

  // Date constraint listeners
  if (leaveStartDateInput && leaveEndDateInput) {
    leaveStartDateInput.addEventListener('change', () => {
      const startVal = leaveStartDateInput.value;
      if (startVal) {
        leaveEndDateInput.min = startVal;
        if (leaveEndDateInput.value && leaveEndDateInput.value < startVal) {
          leaveEndDateInput.value = startVal;
        }
      }
      updateLeaveModalDuration();
    });

    leaveEndDateInput.addEventListener('change', () => {
      const startVal = leaveStartDateInput.value;
      const endVal = leaveEndDateInput.value;
      if (startVal && endVal && endVal < startVal) {
        showToast('End Date cannot be earlier than Start Date.', 'error');
        leaveEndDateInput.value = startVal;
      }
      updateLeaveModalDuration();
    });
  }

  // Refresh leaves button
  const btnRefreshLeaves = document.getElementById('btn-refresh-my-leaves');
  if (btnRefreshLeaves) {
    btnRefreshLeaves.addEventListener('click', () => {
      btnRefreshLeaves.disabled = true;
      showToast('Syncing leave applications with server...', 'info');
      fetchAndSyncMyLeaves();
      setTimeout(() => {
        btnRefreshLeaves.disabled = false;
        showToast('Leave records synchronized.', 'success');
      }, 600);
    });
  }

  // Leave modal triggers
  document.getElementById('btn-open-leave-modal')?.addEventListener('click', openLeaveModal);
  document.getElementById('btn-card-apply-leave')?.addEventListener('click', openLeaveModal);
  document.getElementById('btn-close-leave-modal')?.addEventListener('click', () => applyLeaveModal.classList.remove('open'));
  document.getElementById('btn-cancel-leave')?.addEventListener('click', () => applyLeaveModal.classList.remove('open'));

  // WFH modal triggers
  document.getElementById('btn-open-wfh-modal')?.addEventListener('click', openWfhModal);
  document.getElementById('btn-card-apply-wfh')?.addEventListener('click', openWfhModal);
  document.getElementById('btn-close-wfh-modal')?.addEventListener('click', () => applyWfhModal.classList.remove('open'));
  document.getElementById('btn-cancel-wfh')?.addEventListener('click', () => applyWfhModal.classList.remove('open'));

  // WFH details modal controls
  function openWfhDetailsModal(wfhId) {
    const allWfh = WorkPulseDB.getWfhRequests ? WorkPulseDB.getWfhRequests() : [];
    const wfh = allWfh.find(w => String(w.id || '').trim().toUpperCase() === String(wfhId || '').trim().toUpperCase());
    if (!wfh) {
      showToast('WFH request details not found.', 'error');
      return;
    }

    const modal = document.getElementById('wfh-detail-modal');
    const content = document.getElementById('wfh-detail-content');
    if (!modal || !content) return;

    let badge = '';
    const st = (wfh.status || 'Pending').trim();
    if (st.toLowerCase() === 'approved') {
      badge = `<span class="badge" style="font-size:0.75rem; padding:4px 10px; font-weight:700; background:#ECFDF5; color:#047857; border:1px solid #6EE7B7; border-radius:9999px; display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#10B981; display:inline-block;"></span> Approved</span>`;
    } else if (st.toLowerCase() === 'rejected') {
      badge = `<span class="badge" style="font-size:0.75rem; padding:4px 10px; font-weight:700; background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5; border-radius:9999px; display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#EF4444; display:inline-block;"></span> Rejected</span>`;
    } else {
      badge = `<span class="badge" style="font-size:0.75rem; padding:4px 10px; font-weight:700; background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; border-radius:9999px; display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#EA580C; display:inline-block;"></span> Pending</span>`;
    }

    const adminComment = (wfh.adminComment || wfh.notes || wfh.approvalComment || '').trim();
    const rejectionReason = (wfh.rejectionReason || wfh.adminComment || '').trim();

    content.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; border-bottom:1px solid #E2E8F0; padding-bottom:14px;">
        <div>
          <span style="font-size:0.72rem; color:#64748B; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Request Reference</span>
          <div style="font-weight:700; font-size:1.1rem; color:var(--navy-dark); font-family:var(--font-heading);">${escapeHtml(wfh.id)}</div>
        </div>
        <div>${badge}</div>
      </div>

      <div class="row g-3" style="margin-bottom:16px;">
        <div class="col-6">
          <div style="font-size:0.72rem; color:#64748B; font-weight:600; text-transform:uppercase;">Requested Remote Date</div>
          <div style="font-weight:700; font-size:0.9rem; color:var(--navy-dark); margin-top:2px;">${escapeHtml(WorkPulseDB.formatDisplayDate(wfh.date))}</div>
        </div>
        <div class="col-6">
          <div style="font-size:0.72rem; color:#64748B; font-weight:600; text-transform:uppercase;">Work Duration</div>
          <div style="font-weight:700; font-size:0.9rem; color:var(--royal-blue); margin-top:2px;">${escapeHtml(wfh.workingHours || '8h 00m')}</div>
        </div>
        <div class="col-6">
          <div style="font-size:0.72rem; color:#64748B; font-weight:600; text-transform:uppercase;">Submitted On</div>
          <div style="font-weight:500; font-size:0.85rem; color:#334155; margin-top:2px;">${wfh.appliedDate ? formatDisplayDate(wfh.appliedDate) : (wfh.createdAt ? WorkPulseDB.formatDisplayDate(wfh.createdAt) : 'N/A')}</div>
        </div>
        <div class="col-6">
          <div style="font-size:0.72rem; color:#64748B; font-weight:600; text-transform:uppercase;">Shift Working Times</div>
          <div style="font-weight:500; font-size:0.85rem; color:#334155; margin-top:2px;">${escapeHtml(wfh.checkIn || '09:00 AM')} - ${escapeHtml(wfh.checkOut || '05:00 PM')}</div>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="font-size:0.72rem; color:#64748B; font-weight:600; text-transform:uppercase; margin-bottom:4px;">Reason & Justification</div>
        <div style="padding:12px 14px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; font-size:0.85rem; color:#1E293B; line-height:1.5;">
          ${escapeHtml(wfh.reason || 'No description provided')}
        </div>
      </div>

      <div>
        <div style="font-size:0.72rem; color:#64748B; font-weight:600; text-transform:uppercase; margin-bottom:4px;">Administration Review</div>
        ${st.toLowerCase() === 'approved' ? `
          <div style="padding:12px 14px; background:#ECFDF5; border:1px solid #A7F3D0; border-radius:6px; color:#065F46; font-size:0.82rem; line-height:1.5;">
            <div style="font-weight:700; display:flex; align-items:center; gap:5px; color:#047857;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Approved by ${escapeHtml(wfh.reviewedBy || 'Administrator')}</span>
            </div>
            ${adminComment ? `<div style="margin-top:6px; color:#047857;"><strong>Admin Comment:</strong> ${escapeHtml(adminComment)}</div>` : ''}
            ${wfh.reviewedAt ? `<div style="font-size:0.72rem; color:#059669; margin-top:4px;">Timestamp: ${new Date(wfh.reviewedAt).toLocaleString()}</div>` : ''}
          </div>
        ` : (st.toLowerCase() === 'rejected' ? `
          <div style="padding:12px 14px; background:#FEF2F2; border:1px solid #FECACA; border-radius:6px; color:#991B1B; font-size:0.82rem; line-height:1.5;">
            <div style="font-weight:700; display:flex; align-items:center; gap:5px; color:#DC2626;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
              <span>Rejected by ${escapeHtml(wfh.reviewedBy || 'Administrator')}</span>
            </div>
            <div style="margin-top:6px;"><strong>Rejection Reason:</strong> ${escapeHtml(rejectionReason || 'No reason specified by administration.')}</div>
            ${wfh.reviewedAt ? `<div style="font-size:0.72rem; color:#B91C1C; margin-top:4px;">Timestamp: ${new Date(wfh.reviewedAt).toLocaleString()}</div>` : ''}
          </div>
        ` : `
          <div style="padding:12px 14px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:6px; color:#92400E; font-size:0.82rem;">
            ⏳ <strong>Pending Administrative Review:</strong> Your application has been received and is waiting for management decision.
          </div>
        `)}
      </div>
    `;

    modal.classList.add('open');
  }

  function closeWfhDetailsModal() {
    const modal = document.getElementById('wfh-detail-modal');
    modal?.classList.remove('open');
  }

  document.getElementById('btn-close-wfh-detail')?.addEventListener('click', closeWfhDetailsModal);
  document.getElementById('btn-dismiss-wfh-detail')?.addEventListener('click', closeWfhDetailsModal);
  document.getElementById('btn-refresh-my-wfh')?.addEventListener('click', () => {
    fetchAndSyncMyWfh(true);
    showToast('Work From Home records synced with server.', 'info');
  });

  document.getElementById('my-wfh-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-view-wfh');
    if (btn) {
      const wId = btn.dataset.wfhId;
      openWfhDetailsModal(wId);
    }
  });

  // Day detail modal closers
  document.getElementById('btn-close-day-detail')?.addEventListener('click', () => dayDetailModal.classList.remove('open'));
  document.getElementById('btn-close-day-foot')?.addEventListener('click', () => dayDetailModal.classList.remove('open'));

  // Universal Modal Dismissal (Click outside dialog or press Escape)
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      hideCalendarTooltip();
    }
  });

  // Apply Leave Submit
  const leaveForm = document.getElementById('apply-leave-form');
  if (leaveForm) {
    leaveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = leaveForm.querySelector('button[type="submit"]');
      if (submitBtn && submitBtn.disabled) return;

      const startDate = leaveStartDateInput ? leaveStartDateInput.value : document.getElementById('leave-start-date').value;
      const endDate = leaveEndDateInput ? leaveEndDateInput.value : document.getElementById('leave-end-date').value;
      const leaveType = document.getElementById('leave-type').value;
      const reason = document.getElementById('leave-reason').value.trim();

      if (!startDate || !endDate || !reason) {
        showToast('Please specify all required leave fields.', 'error');
        return;
      }

      if (endDate < startDate) {
        showToast('End Date cannot be earlier than Start Date.', 'error');
        if (leaveEndDateInput) leaveEndDateInput.value = startDate;
        return;
      }

      const totalDays = calculateLeaveDays(startDate, endDate);

      // Disable button to prevent duplicate submissions
      const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Submitting...</span>';
      }

      try {
        const payload = {
          startDate,
          endDate,
          leaveDate: startDate,
          toDate: endDate,
          totalDays,
          leaveType,
          reason,
          staffId: staff.id,
          staffName: staff.name,
          position: staff.position,
          photo: staff.photo
        };

        const res = await fetch('/api/leaves', {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok && data && data.success && data.data) {
          const savedLeave = data.data;

          // Save to local storage cleanly without duplicates
          const currentDb = WorkPulseDB.load();
          currentDb.leaves = currentDb.leaves || [];
          const existingIdx = currentDb.leaves.findIndex(l => 
            l.id === savedLeave.id || 
            (String(l.staffId).trim().toUpperCase() === String(staff.id).trim().toUpperCase() &&
             (l.startDate === startDate || l.leaveDate === startDate) &&
             (l.endDate === endDate || l.toDate === endDate) &&
             l.leaveType === leaveType)
          );

          if (existingIdx >= 0) {
            currentDb.leaves[existingIdx] = savedLeave;
          } else {
            currentDb.leaves.unshift(savedLeave);
          }
          WorkPulseDB.save(currentDb, true);

          leaveForm.reset();
          initLeaveFormDates(true);
          if (applyLeaveModal) applyLeaveModal.classList.remove('open');
          showToast('Leave application submitted successfully.', 'success');

          renderMyApplicationsUI();
          renderMonthlyKPIs();
          renderStaffCalendar();
          updateDynamicSidebarBadgesAndPermissions();
        } else {
          showToast((data && data.error) || 'Failed to submit leave application.', 'error');
        }
      } catch (err) {
        console.error('Leave submission error:', err);
        showToast('Network error submitting leave application. Please try again.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = origBtnHtml;
        }
      }
    });
  }

   // Apply WFH Submit
  const wfhForm = document.getElementById('apply-wfh-form');
  if (wfhForm) {
    wfhForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = wfhForm.querySelector('button[type="submit"]');
      if (submitBtn && submitBtn.disabled) return;

      const dateInput = document.getElementById('wfh-date');
      const reasonInput = document.getElementById('wfh-reason');
      const date = dateInput ? dateInput.value : '';
      const reason = reasonInput ? reasonInput.value.trim() : '';

      if (!date || !reason) {
        showToast('Please fill out date and reason for WFH.', 'error');
        return;
      }

      // Check for duplicate pending WFH for same date in local state
      const existingMyWfh = (WorkPulseDB.getWfhRequests ? WorkPulseDB.getWfhRequests() : [])
        .find(w => String(w.staffId || '').trim().toUpperCase() === String(staff.id).trim().toUpperCase() &&
                   w.date === date && (String(w.status || '').toLowerCase() === 'pending'));
      if (existingMyWfh) {
        showToast('You already have a pending Work From Home request for this date.', 'warning');
        return;
      }

      // Disable button to prevent duplicate submissions on repeated clicks
      const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Submitting...</span>';
      }

      try {
        let savedWfh = null;

        if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
          const res = await fetch('/api/wfh', {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              staffId: staff.id,
              staffName: staff.name,
              position: staff.position,
              photo: staff.photo,
              date,
              reason
            })
          });

          const data = await res.json();
          if (res.ok && data && data.success && data.data) {
            savedWfh = data.data;
          } else {
            showToast((data && data.error) || 'Failed to submit WFH request.', 'error');
            return;
          }
        } else {
          // Offline fallback only when no server connection
          savedWfh = WorkPulseDB.applyWfh(staff.id, { date, reason });
        }

        if (savedWfh) {
          // Save to local storage cleanly without duplicates
          const currentDb = WorkPulseDB.load();
          currentDb.wfhRequests = currentDb.wfhRequests || [];
          const existingIdx = currentDb.wfhRequests.findIndex(w =>
            (w.id && savedWfh.id && w.id === savedWfh.id) ||
            (String(w.staffId || '').trim().toUpperCase() === String(staff.id).trim().toUpperCase() &&
             w.date === savedWfh.date && (String(w.status || '').toLowerCase() === 'pending'))
          );

          if (existingIdx >= 0) {
            currentDb.wfhRequests[existingIdx] = savedWfh;
          } else {
            currentDb.wfhRequests.unshift(savedWfh);
          }
          WorkPulseDB.save(currentDb, true); // skipSync = true to prevent redundant sync push

          wfhForm.reset();
          if (wfhDateInput) wfhDateInput.value = getLocalDateString();
          if (applyWfhModal) applyWfhModal.classList.remove('open');
          showToast('Work From Home request submitted to Executive Administration.', 'success');
          renderMyApplications();
          renderMonthlyKPIs();
          if (typeof renderStaffCalendar === 'function') renderStaffCalendar();
          if (typeof updateDynamicSidebarBadgesAndPermissions === 'function') updateDynamicSidebarBadgesAndPermissions();
        }
      } catch (err) {
        console.error('WFH submission error:', err);
        showToast('Network error submitting WFH request. Please try again.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = origBtnHtml;
        }
      }
    });
  }

  // Utility: Initials
  function getInitials(name) {
    if (!name) return 'WP';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // ==========================================================================
  // 12. WORK & PROJECTS, MEETINGS, AND NOTIFICATIONS CONTROLLER
  // ==========================================================================
  let activeTaskFilter = 'all';
  let activeMeetingFilter = 'upcoming';
  let attachedDailyReportFile = null;

  // Cache elements
  const notifToggleBtn = document.getElementById('staff-notif-toggle-btn');
  const notifBadge = document.getElementById('staff-notif-badge');
  const notifDropdown = document.getElementById('staff-notif-dropdown');
  const notifList = document.getElementById('staff-notif-list');
  const btnClearNotifs = document.getElementById('btn-staff-clear-notifs');

  const meetingAlertBanner = document.getElementById('staff-meeting-alert-banner');
  const meetingAlertTitle = document.getElementById('meeting-alert-title');
  const meetingAlertDesc = document.getElementById('meeting-alert-desc');
  const btnJumpToMeetings = document.getElementById('btn-jump-to-meetings');

  // Work tab buttons
  const tabBtnMyProjects = document.getElementById('tab-btn-my-projects');
  const tabBtnMyKanban = document.getElementById('tab-btn-my-kanban');
  const tabBtnMyGantt = document.getElementById('tab-btn-my-gantt');
  const tabBtnMyWork = document.getElementById('tab-btn-my-work');
  const tabBtnDailyReport = document.getElementById('tab-btn-daily-report');
  const tabBtnMyMeetings = document.getElementById('tab-btn-my-meetings');
  const tabBtnMyReviews = document.getElementById('tab-btn-my-reviews');
  const tabBtnMyLeads = document.getElementById('tab-btn-my-leads');
  const tabBtnMyMisc = document.getElementById('tab-btn-my-misc');

  const paneTabMyProjects = document.getElementById('pane-tab-my-projects');
  const paneTabMyKanban = document.getElementById('pane-tab-my-kanban');
  const paneTabMyGantt = document.getElementById('pane-tab-my-gantt');
  const paneTabMyWork = document.getElementById('pane-tab-my-work');
  const paneTabDailyReport = document.getElementById('pane-tab-daily-report');
  const paneTabMyMeetings = document.getElementById('pane-tab-my-meetings');
  const paneTabMyReviews = document.getElementById('pane-tab-my-reviews');
  const paneTabMyLeads = document.getElementById('pane-tab-my-leads');
  const paneTabMyMisc = document.getElementById('pane-tab-my-misc');

  // Daily Report Form & File Dropzone
  const dailyReportForm = document.getElementById('staff-daily-report-form');
  const reportFileInput = document.getElementById('report-file-input');
  const reportDropzone = document.getElementById('report-file-dropzone');
  const dropzoneIdle = document.getElementById('dropzone-idle-content');
  const dropzonePreview = document.getElementById('dropzone-file-preview');
  const selectedFileName = document.getElementById('selected-file-name');
  const selectedFileSize = document.getElementById('selected-file-size');
  const btnRemoveFile = document.getElementById('btn-remove-attached-file');
  const reportRelatedTaskSelect = document.getElementById('report-related-task');

  // ==========================================================================
  // MULTI-VIEW CORPORATE WORKSPACE ROUTER & NAVIGATION CONTROLLER
  // ==========================================================================
  const validStaffViews = [
    'dashboard',
    'projects',
    'tasks',
    'kanban',
    'gantt',
    'reports',
    'meetings',
    'reviews',
    'updates',
    'attendance',
    'calendar',
    'leaves',
    'wfh',
    'leads',
    'misc',
    'profile'
  ];

  const staffViewHeadings = {
    'dashboard': 'Workspace Dashboard',
    'projects': 'Assigned Projects',
    'tasks': 'Tasks & Subtasks',
    'kanban': 'Kanban Board',
    'gantt': 'Gantt Timeline Schedule',
    'reports': 'Daily Work Reports',
    'meetings': 'Meetings & Briefings',
    'reviews': 'Daily Works Reviews',
    'updates': 'Project Comments & Updates',
    'attendance': 'Desk Punch & Stopwatch',
    'calendar': 'Attendance Calendar',
    'leaves': 'Leave Applications',
    'wfh': 'Work From Home Requests',
    'leads': 'Assigned Leads (CRM)',
    'misc': 'General & Office Hub',
    'profile': 'Profile & Account Settings'
  };

  const viewAliasMap = {
    'work': 'dashboard',
    'my-projects': 'projects',
    'my-work': 'tasks',
    'my-kanban': 'kanban',
    'my-gantt': 'gantt',
    'daily-report': 'reports',
    'my-meetings': 'meetings',
    'my-reviews': 'reviews',
    'my-leads': 'leads',
    'my-misc': 'misc',
    'timesheet': 'calendar',
    'time': 'attendance',
    'settings': 'profile'
  };

  function switchStaffView(targetView) {
    if (!targetView) targetView = 'dashboard';
    if (viewAliasMap[targetView]) targetView = viewAliasMap[targetView];
    if (!validStaffViews.includes(targetView)) targetView = 'dashboard';

    try {
      localStorage.setItem('workpulse_staff_last_view', targetView);
      if (window.location.hash !== '#' + targetView) {
        window.history.replaceState(null, '', '#' + targetView);
      }
    } catch (e) {}

    // Update active nav item
    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      const match = item.dataset.view === targetView;
      item.classList.toggle('active', match);
    });

    // Update active view pane
    document.querySelectorAll('.staff-view-pane').forEach(pane => {
      const match = pane.id === `view-${targetView}`;
      pane.classList.toggle('active', match);
    });

    // Update topbar heading
    const headingEl = document.getElementById('staff-page-heading');
    if (headingEl) {
      headingEl.textContent = staffViewHeadings[targetView] || 'Workspace Dashboard';
    }

    // Auto close mobile drawer if open
    const sidebarEl = document.getElementById('staff-sidebar');
    const backdropEl = document.getElementById('staff-sidebar-backdrop');
    if (sidebarEl) sidebarEl.classList.remove('mobile-open');
    if (backdropEl) backdropEl.classList.remove('active');

    // Render corresponding view components
    try {
      if (targetView === 'dashboard') {
        renderStaffDashboardOverview();
        renderWorkKPIs();
      } else if (targetView === 'projects') {
        renderStaffProjects();
      } else if (targetView === 'tasks') {
        renderStaffTasks();
      } else if (targetView === 'kanban') {
        renderStaffKanban();
      } else if (targetView === 'gantt') {
        renderStaffGantt();
      } else if (targetView === 'reports') {
        populateReportTaskSelect();
        renderStaffDailyReports();
      } else if (targetView === 'meetings') {
        renderStaffMeetings();
      } else if (targetView === 'reviews') {
        renderStaffReviews();
      } else if (targetView === 'updates') {
        renderStaffProjectUpdates();
      } else if (targetView === 'attendance') {
        checkAttendanceState();
        renderMonthlyKPIs();
      } else if (targetView === 'calendar') {
        renderStaffCalendar();
      } else if (targetView === 'leaves' || targetView === 'wfh') {
        renderMyApplications();
      } else if (targetView === 'leads') {
        renderStaffLeads();
      } else if (targetView === 'misc') {
        renderStaffMisc();
      } else if (targetView === 'profile') {
        renderStaffProfileSettings();
      }
    } catch (err) {
      console.error(`[WorkPulse Staff Navigation] Error rendering view "${targetView}":`, err);
    }
  }

  window.switchStaffView = switchStaffView;
  window.switchWorkTab = function(tabName) {
    switchStaffView(viewAliasMap[tabName] || tabName);
  };
  window.switchMainSection = function(secName) {
    if (secName === 'attendance') {
      switchStaffView('attendance');
    } else {
      const last = localStorage.getItem('workpulse_staff_last_view') || 'dashboard';
      switchStaffView(last === 'attendance' ? 'dashboard' : last);
    }
  };

  // Attach nav item click listeners
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const view = item.dataset.view;
      if (view) {
        e.preventDefault();
        switchStaffView(view);
      }
    });
  });

  // Desktop sidebar collapse / expand toggle
  const sidebarEl = document.getElementById('staff-sidebar');
  const btnSidebarToggle = document.getElementById('staff-sidebar-toggle-btn');
  if (btnSidebarToggle && sidebarEl) {
    btnSidebarToggle.addEventListener('click', () => {
      sidebarEl.classList.toggle('collapsed');
      try {
        localStorage.setItem('workpulse_staff_sidebar_collapsed', sidebarEl.classList.contains('collapsed') ? '1' : '0');
      } catch (e) {}
    });
  }
  try {
    if (localStorage.getItem('workpulse_staff_sidebar_collapsed') === '1' && sidebarEl) {
      sidebarEl.classList.add('collapsed');
    }
  } catch (e) {}

  // Mobile drawer menu toggle & backdrop
  const btnMobileMenu = document.getElementById('staff-mobile-menu-btn');
  const backdropEl = document.getElementById('staff-sidebar-backdrop');
  if (btnMobileMenu && sidebarEl) {
    btnMobileMenu.addEventListener('click', () => {
      sidebarEl.classList.toggle('mobile-open');
      if (backdropEl) backdropEl.classList.toggle('active', sidebarEl.classList.contains('mobile-open'));
    });
  }
  if (backdropEl && sidebarEl) {
    backdropEl.addEventListener('click', () => {
      sidebarEl.classList.remove('mobile-open');
      backdropEl.classList.remove('active');
    });
  }

  // WorkPulse Logo Click: Return to Dashboard without sign out!
  const logoHomeBtn = document.getElementById('staff-logo-home');
  if (logoHomeBtn) {
    logoHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      switchStaffView('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Profile Chips Click -> Navigate to Profile View
  const sidebarStaffChip = document.getElementById('sidebar-staff-chip');
  if (sidebarStaffChip) {
    sidebarStaffChip.addEventListener('click', () => switchStaffView('profile'));
  }
  const topbarStaffUser = document.getElementById('staff-topbar-user');
  if (topbarStaffUser) {
    topbarStaffUser.addEventListener('click', () => switchStaffView('profile'));
  }

  // Quick Shift Pill in Topbar
  const quickShiftBtn = document.getElementById('staff-quick-shift-btn');
  if (quickShiftBtn) {
    quickShiftBtn.addEventListener('click', () => {
      switchStaffView('attendance');
      const card = document.getElementById('checkin-card');
      if (card) card.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Hero Quick Action Buttons
  const btnHeroSwitchAttendance = document.getElementById('btn-hero-switch-attendance');
  if (btnHeroSwitchAttendance) {
    btnHeroSwitchAttendance.addEventListener('click', () => switchStaffView('attendance'));
  }
  const btnHeroWorkReport = document.getElementById('btn-hero-work-report');
  if (btnHeroWorkReport) {
    btnHeroWorkReport.addEventListener('click', () => switchStaffView('reports'));
  }
  const btnHeroViewProjects = document.getElementById('btn-hero-view-projects');
  if (btnHeroViewProjects) {
    btnHeroViewProjects.addEventListener('click', () => switchStaffView('projects'));
  }
  const btnHeroWorkRequest = document.getElementById('btn-hero-work-request');
  if (btnHeroWorkRequest) {
    btnHeroWorkRequest.addEventListener('click', () => {
      const modal = document.getElementById('staff-request-modal');
      if (modal) {
        const form = document.getElementById('staff-request-form');
        if (form) form.reset();
        modal.classList.add('open');
      } else {
        switchStaffView('misc');
      }
    });
  }

  // Dashboard Operational Grid Links
  const linkDashAllProjects = document.getElementById('link-dash-all-projects');
  if (linkDashAllProjects) linkDashAllProjects.addEventListener('click', () => switchStaffView('projects'));
  const linkDashAllTasks = document.getElementById('link-dash-all-tasks');
  if (linkDashAllTasks) linkDashAllTasks.addEventListener('click', () => switchStaffView('tasks'));
  const linkDashAllMeetings = document.getElementById('link-dash-all-meetings');
  if (linkDashAllMeetings) linkDashAllMeetings.addEventListener('click', () => switchStaffView('meetings'));
  const linkDashAllUpdates = document.getElementById('link-dash-all-updates');
  if (linkDashAllUpdates) linkDashAllUpdates.addEventListener('click', () => switchStaffView('updates'));

  // Topbar Global Search
  const globalSearchInput = document.getElementById('staff-global-search');
  if (globalSearchInput) {
    globalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = globalSearchInput.value.trim().toLowerCase();
        if (!q) return;
        switchStaffView('tasks');
        const searchBox = document.getElementById('search-staff-tasks');
        if (searchBox) {
          searchBox.value = q;
          searchBox.dispatchEvent(new Event('input'));
        }
      }
    });
  }

  // Topbar Shift Status Pill Updater
  function updateQuickShiftStatusPill() {
    const dot = document.getElementById('quick-shift-dot');
    const label = document.getElementById('quick-shift-label');
    if (!dot || !label) return;

    const todayRecord = WorkPulseDB.getAttendanceRecord ? WorkPulseDB.getAttendanceRecord(staff.id, todayDateStr) : null;
    const isPunchedIn = todayRecord && todayRecord.inTime && !todayRecord.outTime;
    const isOnLunch = todayRecord && todayRecord.lunchBreakStart && !todayRecord.lunchBreakEnd;

    if (isOnLunch) {
      dot.className = 'quick-shift-dot break';
      label.textContent = 'On Lunch Break';
    } else if (isPunchedIn) {
      dot.className = 'quick-shift-dot active';
      label.textContent = 'Active Shift • Checked In';
    } else {
      dot.className = 'quick-shift-dot inactive';
      label.textContent = todayRecord && todayRecord.outTime ? `Shift Ended (${todayRecord.outTime})` : 'Checked Out';
    }
  }

  // Dynamic Sidebar Badges & Permissions Controller
  function updateDynamicSidebarBadgesAndPermissions() {
    if (!staff || !staff.id) return;

    // 1. My Projects count badge
    const allProjects = WorkPulseDB.getProjects ? WorkPulseDB.getProjects({ staffId: staff.id }) : [];
    const badgeProjects = document.getElementById('badge-my-projects');
    if (badgeProjects) badgeProjects.textContent = allProjects.length;

    // 2. My Tasks count badge (pending tasks)
    const allTasks = WorkPulseDB.getTasks ? WorkPulseDB.getTasks() : [];
    const myPendingTasks = allTasks.filter(t => {
      const isAssigned = (t.assignedStaffId === staff.id) ||
        (t.assignedTo && (t.assignedTo.toLowerCase() === (staff.name || '').toLowerCase() || t.assignedTo.includes(staff.name))) ||
        (Array.isArray(t.assignedStaffIds) && t.assignedStaffIds.includes(staff.id)) ||
        (Array.isArray(t.assignedStaff) && t.assignedStaff.some(s => s.id === staff.id || s.name === staff.name));
      return isAssigned && (t.status || 'To Do') !== 'Completed';
    });
    const badgeTasks = document.getElementById('badge-my-tasks');
    if (badgeTasks) badgeTasks.textContent = myPendingTasks.length;

    // 3. My Meetings count badge (upcoming)
    const allMeetings = WorkPulseDB.getMeetings ? WorkPulseDB.getMeetings({ staffId: staff.id }) : [];
    const upcomingMeetings = allMeetings.filter(m => {
      const dyn = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function') ? WorkPulseDB.getMeetingDynamicStatus(m) : 'Upcoming';
      return dyn === 'Upcoming' || dyn === 'Ongoing';
    });
    const badgeMeetings = document.getElementById('badge-my-meetings');
    if (badgeMeetings) badgeMeetings.textContent = upcomingMeetings.length;

    // 4. My Reviews count badge
    const reports = WorkPulseDB.getDailyReports ? WorkPulseDB.getDailyReports({ staffId: staff.id }) : [];
    const reviewedReports = reports.filter(r => r.review);
    const badgeReviews = document.getElementById('badge-my-reviews');
    if (badgeReviews) badgeReviews.textContent = reviewedReports.length;

    // 5. Leaves & WFH count badges (pending requests)
    const leaves = WorkPulseDB.getLeaves ? WorkPulseDB.getLeaves({ staffId: staff.id }) : [];
    const pendingLeaves = leaves.filter(l => (l.status || '').toLowerCase() === 'pending');
    const badgeLeaves = document.getElementById('badge-my-leaves');
    if (badgeLeaves) badgeLeaves.textContent = pendingLeaves.length;

    const wfhs = WorkPulseDB.getWFHRequests ? WorkPulseDB.getWFHRequests({ staffId: staff.id }) : [];
    const pendingWfh = wfhs.filter(w => (w.status || '').toLowerCase() === 'pending');
    const badgeWfh = document.getElementById('badge-my-wfh');
    if (badgeWfh) badgeWfh.textContent = pendingWfh.length;

    // 6. Dynamic CRM Leads Visibility
    const allLeads = (WorkPulseDB.getLeads ? WorkPulseDB.getLeads() : []).filter(l => l.assignedStaffId === staff.id || l.assignedTo === staff.name);
    const isTelecaller = (staff.department || '').toLowerCase().includes('telecall') ||
                         (staff.department || '').toLowerCase().includes('sales') ||
                         (staff.position || '').toLowerCase().includes('telecall') ||
                         (staff.position || '').toLowerCase().includes('sales') ||
                         allLeads.length > 0;
    const navItemLeads = document.getElementById('nav-item-leads');
    const badgeLeads = document.getElementById('badge-my-leads');
    if (navItemLeads) {
      navItemLeads.style.display = isTelecaller ? 'flex' : 'none';
      if (badgeLeads) badgeLeads.textContent = allLeads.length;
    }

    // 7. Dynamic Misc Hub Visibility
    const navItemMisc = document.getElementById('nav-item-misc');
    const badgeMisc = document.getElementById('badge-my-misc');
    const allRequests = (typeof WorkPulseDB.getGeneralRequests === 'function') ? WorkPulseDB.getGeneralRequests({ staffId: staff.id }) : [];
    if (navItemMisc) {
      navItemMisc.style.display = 'flex';
      if (badgeMisc) badgeMisc.textContent = allRequests.length;
    }

    // Dynamic Section Header Label
    const dynamicSectionLabel = document.getElementById('section-label-dynamic');
    if (dynamicSectionLabel) {
      const hasDynamicItem = isTelecaller || (navItemMisc && navItemMisc.style.display !== 'none');
      dynamicSectionLabel.style.display = hasDynamicItem ? 'block' : 'none';
    }

    // 8. Shift dot in sidebar
    const sidebarShiftDot = document.getElementById('sidebar-shift-dot');
    const todayRecord = WorkPulseDB.getAttendanceRecord ? WorkPulseDB.getAttendanceRecord(staff.id, todayDateStr) : null;
    const isPunchedIn = todayRecord && todayRecord.inTime && !todayRecord.outTime;
    if (sidebarShiftDot) {
      sidebarShiftDot.className = 'nav-shift-dot ' + (isPunchedIn ? 'active' : 'inactive');
    }
  }

  // Dashboard Overview Content Renderer
  function renderStaffDashboardOverview() {
    if (!staff || !staff.id) return;

    checkMeetingAlert();

    // 1. Active Projects List (#dash-active-projects-list)
    const allProjects = WorkPulseDB.getProjects ? WorkPulseDB.getProjects({ staffId: staff.id }) : [];
    const activeProjects = allProjects.filter(p => (p.status || 'Active') === 'Active' || p.status === 'In Progress');
    const dashProjectsList = document.getElementById('dash-active-projects-list');

    if (dashProjectsList) {
      if (activeProjects.length === 0) {
        dashProjectsList.innerHTML = `
          <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
            <div style="font-weight: 600; color: var(--navy-dark); margin-bottom: 2px;">No active projects assigned</div>
            <div>When administrative management assigns client initiatives to your desk, they will appear here.</div>
          </div>
        `;
      } else {
        dashProjectsList.innerHTML = activeProjects.slice(0, 4).map(p => {
          const progress = Math.min(100, Math.max(0, parseInt(p.progress || 0, 10)));
          const tasks = WorkPulseDB.getTasks ? WorkPulseDB.getTasks({ projectId: p.id }) : [];
          const completedTasks = tasks.filter(t => t.status === 'Completed').length;
          return `
            <div class="dash-mini-item" onclick="openStaffProjectDetailsModal('${p.id}')" title="Click to view full project specifications">
              <div class="d-flex align-items-center justify-content-between mb-1">
                <span class="dash-item-title">${escapeHtml(p.title)}</span>
                <span class="badge-status-subtle status-${(p.status || 'Active').toLowerCase().replace(/\\s+/g, '-')}">${escapeHtml(p.status || 'Active')}</span>
              </div>
              <div class="d-flex align-items-center justify-content-between mb-1" style="font-size: 0.72rem; color: var(--text-muted);">
                <span>${tasks.length > 0 ? `${completedTasks}/${tasks.length} tasks completed` : (p.clientName || 'Internal Deliverable')}</span>
                <span style="font-weight: 700; color: var(--navy-dark); font-variant-numeric: tabular-nums;">${progress}%</span>
              </div>
              <div class="dash-item-progress-track">
                <div class="dash-item-progress-bar" style="width: ${progress}%;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Priority Tasks List (#dash-priority-tasks-list)
    const allTasks = WorkPulseDB.getTasks ? WorkPulseDB.getTasks() : [];
    const myTasks = allTasks.filter(t => {
      return (t.assignedStaffId === staff.id) ||
        (t.assignedTo && (t.assignedTo.toLowerCase() === (staff.name || '').toLowerCase() || t.assignedTo.includes(staff.name))) ||
        (Array.isArray(t.assignedStaffIds) && t.assignedStaffIds.includes(staff.id)) ||
        (Array.isArray(t.assignedStaff) && t.assignedStaff.some(s => s.id === staff.id || s.name === staff.name));
    });

    const priorityOrder = { 'urgent': 1, 'high': 2, 'medium': 3, 'low': 4 };
    const pendingTasks = myTasks
      .filter(t => (t.status || 'To Do') !== 'Completed')
      .sort((a, b) => {
        const pA = priorityOrder[(a.priority || 'medium').toLowerCase()] || 3;
        const pB = priorityOrder[(b.priority || 'medium').toLowerCase()] || 3;
        return pA - pB;
      });

    const dashTasksList = document.getElementById('dash-priority-tasks-list');
    if (dashTasksList) {
      if (pendingTasks.length === 0) {
        dashTasksList.innerHTML = `
          <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
            <div style="font-weight: 600; color: #059669; margin-bottom: 2px;">All tasks completed!</div>
            <div>No pending tasks currently on your desk. Great job!</div>
          </div>
        `;
      } else {
        dashTasksList.innerHTML = pendingTasks.slice(0, 5).map(t => {
          const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
          const completedSubs = subtasks.filter(s => s.status === 'Completed' || s.completed).length;
          const subInfo = subtasks.length > 0 ? ` • ${completedSubs}/${subtasks.length} subtasks` : '';
          const isOverdue = t.dueDate && t.dueDate < todayDateStr;
          const isToday = t.dueDate && t.dueDate === todayDateStr;
          let dueClass = '';
          let dueText = t.dueDate ? WorkPulseDB.formatDisplayDate(t.dueDate) : 'No due date';
          if (isOverdue) {
            dueClass = 'style="color:#DC2626; font-weight:700;"';
            dueText = `Overdue (${WorkPulseDB.formatDisplayDate(t.dueDate)})`;
          } else if (isToday) {
            dueClass = 'style="color:#D97706; font-weight:700;"';
            dueText = 'Due Today';
          }

          return `
            <div class="dash-mini-item" onclick="openStaffTaskModal('${t.id}')" title="Click to view task details and subtasks">
              <div class="d-flex align-items-center justify-content-between mb-1">
                <span class="dash-item-title">${escapeHtml(t.title)}</span>
                <span class="badge-priority-subtle priority-${(t.priority || 'medium').toLowerCase()}">${escapeHtml(t.priority || 'Medium')}</span>
              </div>
              <div class="d-flex align-items-center justify-content-between" style="font-size: 0.72rem; color: var(--text-muted);">
                <span>${escapeHtml(t.projectTitle || 'General Task')}${subInfo}</span>
                <span ${dueClass}>${dueText}</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 3. Upcoming Meetings List (#dash-upcoming-meetings-list)
    const allMeetings = WorkPulseDB.getMeetings ? WorkPulseDB.getMeetings({ staffId: staff.id }) : [];
    const upcomingMeetings = allMeetings.filter(m => {
      const dyn = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function') ? WorkPulseDB.getMeetingDynamicStatus(m) : 'Upcoming';
      return dyn === 'Upcoming' || dyn === 'Ongoing';
    }).sort((a, b) => {
      const aTime = (typeof WorkPulseDB.parseMeetingDateTime === 'function') ? WorkPulseDB.parseMeetingDateTime(a.date, a.time) : new Date(`${a.date}T${a.time}`).getTime();
      const bTime = (typeof WorkPulseDB.parseMeetingDateTime === 'function') ? WorkPulseDB.parseMeetingDateTime(b.date, b.time) : new Date(`${b.date}T${b.time}`).getTime();
      return aTime - bTime;
    });

    const dashMeetingsList = document.getElementById('dash-upcoming-meetings-list');
    if (dashMeetingsList) {
      if (upcomingMeetings.length === 0) {
        dashMeetingsList.innerHTML = `
          <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
            <div style="font-weight: 600; color: var(--navy-dark); margin-bottom: 2px;">No upcoming meetings</div>
            <div>You have a clear schedule today with no executive briefings or syncs.</div>
          </div>
        `;
      } else {
        dashMeetingsList.innerHTML = upcomingMeetings.slice(0, 3).map(m => {
          const isToday = m.date === todayDateStr;
          return `
            <div class="dash-mini-item" onclick="switchStaffView('meetings')" title="Click to view meeting agenda and links">
              <div class="d-flex align-items-center justify-content-between mb-1">
                <span class="dash-item-title">${escapeHtml(m.title)}</span>
                <span class="badge-status-subtle ${isToday ? 'status-in-progress' : 'status-to-do'}">${isToday ? 'Today' : WorkPulseDB.formatDisplayDate(m.date)}</span>
              </div>
              <div class="d-flex align-items-center justify-content-between" style="font-size: 0.72rem; color: var(--text-muted);">
                <span>⏰ ${m.time || '10:00 AM'} • ${escapeHtml(m.platform || m.venue || 'Meeting Room')}</span>
                <span style="color: var(--royal-blue); font-weight: 600;">View &rarr;</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 4. Recent Project Updates List (#dash-recent-updates-list)
    const updates = [];
    allProjects.forEach(p => {
      if (Array.isArray(p.comments)) {
        p.comments.forEach(c => {
          updates.push({
            source: 'Project',
            parentId: p.id,
            parentTitle: p.title,
            authorName: c.authorName || 'Team Member',
            text: c.text || '',
            timestamp: c.createdAt || c.timestamp || p.createdAt || ''
          });
        });
      }
    });
    allTasks.forEach(t => {
      if (Array.isArray(t.comments)) {
        t.comments.forEach(c => {
          updates.push({
            source: 'Task',
            parentId: t.id,
            parentTitle: t.title,
            authorName: c.authorName || 'Colleague',
            text: c.text || '',
            timestamp: c.createdAt || c.timestamp || t.createdAt || ''
          });
        });
      }
    });
    updates.sort((a, b) => {
      const tA = new Date(a.timestamp).getTime() || 0;
      const tB = new Date(b.timestamp).getTime() || 0;
      return tB - tA;
    });

    const dashUpdatesList = document.getElementById('dash-recent-updates-list');
    if (dashUpdatesList) {
      if (updates.length === 0) {
        dashUpdatesList.innerHTML = `
          <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
            <div style="font-weight: 600; color: var(--navy-dark); margin-bottom: 2px;">No recent discussions</div>
            <div>Project dialogue, design reviews, and task comments will stream here.</div>
          </div>
        `;
      } else {
        dashUpdatesList.innerHTML = updates.slice(0, 4).map(u => {
          const initials = getInitials(u.authorName);
          return `
            <div class="dash-mini-item" onclick="switchStaffView('updates')" title="Click to view discussions stream">
              <div class="d-flex align-items-center gap-2 mb-1">
                <div class="staff-avatar-circle" style="width:22px; height:22px; font-size:0.65rem;">${initials}</div>
                <div style="font-weight: 700; font-size: 0.78rem; color: var(--navy-dark);">${escapeHtml(u.authorName)}</div>
                <span class="badge-status-subtle" style="font-size: 0.65rem; padding: 1px 6px;">${u.source}</span>
              </div>
              <div style="font-size: 0.75rem; color: #334155; line-height: 1.35; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                ${escapeHtml(u.text)}
              </div>
              <div style="font-size: 0.7rem; color: var(--text-muted);">
                on <strong>${escapeHtml(u.parentTitle)}</strong>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    updateQuickShiftStatusPill();
  }

  // Project Comments & Updates Feed (#view-updates)
  function renderStaffProjectUpdates() {
    const container = document.getElementById('staff-project-updates-list');
    if (!container) return;

    const allProjects = WorkPulseDB.getProjects ? WorkPulseDB.getProjects({ staffId: staff.id }) : [];
    const allTasks = WorkPulseDB.getTasks ? WorkPulseDB.getTasks() : [];
    const myTasks = allTasks.filter(t => {
      return (t.assignedStaffId === staff.id) ||
        (t.assignedTo && (t.assignedTo.toLowerCase() === (staff.name || '').toLowerCase() || t.assignedTo.includes(staff.name))) ||
        (Array.isArray(t.assignedStaffIds) && t.assignedStaffIds.includes(staff.id)) ||
        (Array.isArray(t.assignedStaff) && t.assignedStaff.some(s => s.id === staff.id || s.name === staff.name));
    });

    const updates = [];
    allProjects.forEach(p => {
      if (Array.isArray(p.comments)) {
        p.comments.forEach(c => {
          updates.push({
            type: 'project',
            id: p.id,
            title: p.title,
            authorName: c.authorName || 'Executive Staff',
            authorRole: c.authorRole || 'Team Member',
            text: c.text || '',
            timestamp: c.createdAt || c.timestamp || p.createdAt || ''
          });
        });
      }
    });

    myTasks.forEach(t => {
      if (Array.isArray(t.comments)) {
        t.comments.forEach(c => {
          updates.push({
            type: 'task',
            id: t.id,
            title: t.title,
            authorName: c.authorName || 'Lead Contributor',
            authorRole: c.authorRole || 'Staff Member',
            text: c.text || '',
            timestamp: c.createdAt || c.timestamp || t.createdAt || ''
          });
        });
      }
    });

    updates.sort((a, b) => {
      const tA = new Date(a.timestamp).getTime() || 0;
      const tB = new Date(b.timestamp).getTime() || 0;
      return tB - tA;
    });

    if (updates.length === 0) {
      container.innerHTML = `
        <div style="padding: 48px 16px; text-align: center; background: #F8FAFC; border-radius: var(--radius-sm); border: 1px dashed var(--border-color);">
          <div style="font-weight: 700; color: var(--navy-dark); font-size: 1rem; margin-bottom: 4px;">No discussion comments yet</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); max-width: 480px; margin: 0 auto;">
            When teammates or administrative supervisors leave comments on your assigned projects or tasks, they will appear here in chronological order.
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        ${updates.map(u => {
          const initials = getInitials(u.authorName);
          return `
            <div class="staff-update-card" style="background:#FFFFFF; border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:16px 20px; box-shadow:0 1px 3px rgba(0,0,0,0.03);">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div class="staff-avatar-circle" style="width:34px; height:34px; font-size:0.8rem;">${initials}</div>
                  <div>
                    <div style="font-weight:700; color:var(--navy-dark); font-size:0.88rem;">${escapeHtml(u.authorName)}</div>
                    <div style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(u.authorRole)}</div>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="badge-status-subtle" style="font-size:0.7rem; text-transform:uppercase;">${u.type}</span>
                  <span style="font-size:0.72rem; color:var(--text-muted);">${u.timestamp || 'Recent'}</span>
                </div>
              </div>
              <div style="font-size:0.84rem; color:#334155; line-height:1.5; margin-bottom:12px; background:#F8FAFC; padding:12px 14px; border-radius:6px; border-left:3px solid var(--royal-blue);">
                ${escapeHtml(u.text)}
              </div>
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <span style="font-size:0.76rem; color:var(--navy-dark); font-weight:600;">
                  Regarding: <strong>${escapeHtml(u.title)}</strong>
                </span>
                <button type="button" class="btn btn-secondary btn-sm" style="font-size:0.74rem; padding:4px 10px;" onclick="window._openStaffUpdateDetail('${u.type}', '${u.id}')">
                  Open ${u.type === 'project' ? 'Project' : 'Task'} Details &rarr;
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    window._openStaffUpdateDetail = function(type, id) {
      if (type === 'project' && typeof openStaffProjectDetailsModal === 'function') {
        openStaffProjectDetailsModal(id);
      } else if (type === 'task' && typeof openStaffTaskModal === 'function') {
        openStaffTaskModal(id);
      }
    };
  }

  // Profile & Account Settings Controller
  function renderStaffProfileSettings() {
    const staffRecord = (staff.id ? WorkPulseDB.getStaffById(staff.id) : null) || staff;
    
    const avatarEl = document.getElementById('profile-page-avatar');
    const nameEl = document.getElementById('profile-page-name');
    const roleEl = document.getElementById('profile-page-role');
    const idEl = document.getElementById('profile-page-id');

    const initials = getInitials(staffRecord.name);
    if (avatarEl) {
      if (staffRecord.photo) {
        avatarEl.innerHTML = `<img src="${staffRecord.photo}" alt="${escapeHtml(staffRecord.name)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.parentElement.textContent='${initials}'">`;
      } else {
        avatarEl.textContent = initials;
      }
    }
    if (nameEl) nameEl.textContent = staffRecord.name || 'Staff Member';
    if (roleEl) roleEl.textContent = staffRecord.position || 'Employee';
    if (idEl) idEl.textContent = `ID: ${staffRecord.id || staffRecord.staffId || 'WP-1001'}`;

    const nameInput = document.getElementById('profile-input-name');
    const emailInput = document.getElementById('profile-input-email');
    const posInput = document.getElementById('profile-input-position');
    const mobileInput = document.getElementById('profile-input-mobile');
    const addrInput = document.getElementById('profile-input-address');

    if (nameInput) nameInput.value = staffRecord.name || '';
    if (emailInput) emailInput.value = staffRecord.email || '';
    if (posInput) posInput.value = staffRecord.position || '';
    if (mobileInput) mobileInput.value = staffRecord.mobile || staffRecord.phone || '';
    if (addrInput) addrInput.value = staffRecord.address || '';
  }

  // Handle Profile Update Submission
  const profileForm = document.getElementById('staff-profile-update-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('profile-input-name');
      const mobileInput = document.getElementById('profile-input-mobile');
      const addrInput = document.getElementById('profile-input-address');

      const updatedData = {
        name: (nameInput ? nameInput.value : '').trim(),
        mobile: (mobileInput ? mobileInput.value : '').trim(),
        address: (addrInput ? addrInput.value : '').trim()
      };

      try {
        const res = await fetch(`/api/staff/${encodeURIComponent(staff.id)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...WorkPulseDB.getAuthHeaders()
          },
          body: JSON.stringify(updatedData)
        });
        const data = await res.json();
        if (data.success) {
          staff = Object.assign(staff, data.data || updatedData);
          const sess = WorkPulseDB.getSession();
          if (sess && sess.user) {
            sess.user = Object.assign(sess.user, staff);
            WorkPulseDB.setSession(sess);
          }
          populateProfile();
          showToast('Profile updated successfully.', 'success');
        } else {
          showToast(data.error || 'Failed to update profile.', 'error');
        }
      } catch (err) {
        showToast('Network error while updating profile.', 'error');
      }
    });
  }

  // Handle Password Update Submission
  const pwForm = document.getElementById('staff-password-update-form');
  if (pwForm) {
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPwEl = document.getElementById('staff-current-pw');
      const newPwEl = document.getElementById('staff-new-pw');
      const confirmPwEl = document.getElementById('staff-confirm-pw');
      const submitBtn = document.getElementById('btn-update-staff-pw');

      const currentPw = currentPwEl ? currentPwEl.value : '';
      const newPw = newPwEl ? newPwEl.value : '';
      const confirmPw = confirmPwEl ? confirmPwEl.value : '';

      if (!currentPw) {
        showToast('Please enter your current password.', 'warning');
        if (currentPwEl) currentPwEl.focus();
        return;
      }
      if (!newPw) {
        showToast('Please enter a new password.', 'warning');
        if (newPwEl) newPwEl.focus();
        return;
      }
      if (newPw.length < 6) {
        showToast('New password must be at least 6 characters.', 'error');
        if (newPwEl) newPwEl.focus();
        return;
      }
      if (newPw !== confirmPw) {
        showToast('New passwords do not match.', 'error');
        if (confirmPwEl) confirmPwEl.focus();
        return;
      }

      // Preserve and set loading button state
      const origBtnContent = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Updating...</span>';
      }

      try {
        const response = await fetch('/api/staff/change-password', {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            currentPassword: currentPw,
            newPassword: newPw,
            confirmPassword: confirmPw
          })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          pwForm.reset();
          showToast(data.message || 'Password updated successfully.', 'success');
        } else {
          showToast(data.error || 'Failed to update password.', 'error');
        }
      } catch (err) {
        console.error('Password change error:', err);
        showToast('Network error while updating password. Please try again.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = origBtnContent;
        }
      }
    });
  }

  // Work & Projects KPI calculation
  function renderWorkKPIs() {
    // 1. Projects
    const allProjects = WorkPulseDB.getProjects ? WorkPulseDB.getProjects({ staffId: staff.id }) : [];
    const activeProjects = allProjects.filter(p => (p.status || 'Active') === 'Active' || p.status === 'In Progress');
    const elProjCount = document.getElementById('kpi-work-projects-count');
    const elProjSub = document.getElementById('kpi-work-projects-sub');
    if (elProjCount) elProjCount.textContent = allProjects.length;
    if (elProjSub) elProjSub.textContent = `${activeProjects.length} active assignment${activeProjects.length === 1 ? '' : 's'}`;

    // 2. Pending Tasks & Subtasks
    const allTasks = WorkPulseDB.getTasks ? WorkPulseDB.getTasks() : [];
    const myTasks = allTasks.filter(t => {
      return t.assignedStaffId === staff.id ||
        (Array.isArray(t.assignedStaffIds) && (t.assignedStaffIds.includes(staff.id) || t.assignedStaffIds.includes('all'))) ||
        t.assignedStaffId === 'all' ||
        t.staffId === staff.id;
    });

    const pendingTasks = myTasks.filter(t => t.status !== 'Completed');
    let totalSubsRemaining = 0;
    myTasks.forEach(t => {
      const subs = t.subtasks || [];
      const uncompleted = subs.filter(s => !s.completed && s.status !== 'Completed');
      totalSubsRemaining += uncompleted.length;
    });

    const elTasksCount = document.getElementById('kpi-work-tasks-count');
    const elSubsSub = document.getElementById('kpi-work-subtasks-sub');
    if (elTasksCount) elTasksCount.textContent = pendingTasks.length;
    if (elSubsSub) elSubsSub.textContent = `${totalSubsRemaining} subtask${totalSubsRemaining === 1 ? '' : 's'} remaining`;

    const navBadgeWorkTasks = document.getElementById('nav-badge-work-tasks');
    if (navBadgeWorkTasks) navBadgeWorkTasks.textContent = pendingTasks.length;

    // 3. Upcoming Deadlines / Due Soon
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in48Hours = new Date(today.getTime() + 48 * 3600 * 1000);

    const dueSoon = myTasks.filter(t => {
      if (t.status === 'Completed') return false;
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      return d <= in48Hours;
    });

    const overdue = myTasks.filter(t => {
      if (t.status === 'Completed') return false;
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      return d < today;
    });

    const elDeadlinesCount = document.getElementById('kpi-work-deadlines-count');
    const elDeadlinesSub = document.getElementById('kpi-work-deadlines-sub');
    if (elDeadlinesCount) elDeadlinesCount.textContent = dueSoon.length;
    if (elDeadlinesSub) {
      if (overdue.length > 0) {
        elDeadlinesSub.innerHTML = `<span style="color:#DC2626; font-weight:700;">⚠️ ${overdue.length} overdue</span> &bull; ${dueSoon.length} due soon`;
      } else {
        elDeadlinesSub.textContent = dueSoon.length > 0 ? `${dueSoon.length} due in next 48h` : 'No urgent deadlines';
      }
    }

    // 4. Upcoming Meetings
    const myMeetings = WorkPulseDB.getMeetings ? WorkPulseDB.getMeetings({ staffId: staff.id }) : [];
    const upcomingMeetings = myMeetings.filter(m => {
      const dyn = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function') ? WorkPulseDB.getMeetingDynamicStatus(m) : 'Upcoming';
      return dyn === 'Upcoming' || dyn === 'Ongoing';
    });

    const elMeetingsCount = document.getElementById('kpi-work-meetings-count');
    const elMeetingsSub = document.getElementById('kpi-work-meetings-sub');
    const counterMeetings = document.getElementById('counter-my-meetings');
    if (elMeetingsCount) elMeetingsCount.textContent = upcomingMeetings.length;
    if (counterMeetings) counterMeetings.textContent = upcomingMeetings.length;
    if (elMeetingsSub) {
      if (upcomingMeetings.length > 0) {
        const nextM = upcomingMeetings[0];
        elMeetingsSub.textContent = `Next: ${nextM.title} (${nextM.time})`;
      } else {
        elMeetingsSub.textContent = 'None scheduled today';
      }
    }
  }

  // --- NOTIFICATIONS ---
  function renderStaffNotifications() {
    if (!notifBadge || !notifList) return;
    const notifs = WorkPulseDB.getNotifications({ role: 'staff', staffId: staff.id });
    const unread = notifs.filter(n => !n.read);

    if (unread.length > 0) {
      notifBadge.style.display = 'block';
      notifBadge.textContent = unread.length > 9 ? '9+' : unread.length;
    } else {
      notifBadge.style.display = 'none';
    }

    if (notifs.length === 0) {
      notifList.innerHTML = '<div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.78rem;">No notifications at this time.</div>';
      return;
    }

    notifList.innerHTML = notifs.map(n => `
      <div class="staff-notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
        <div style="font-weight: 700; color: var(--navy-dark); margin-bottom: 2px;">${n.title || n.text}</div>
        <div style="color: #475569; font-size: 0.76rem; line-height: 1.4;">${n.message || n.text}</div>
        <div class="staff-notif-meta">
          <span>${n.createdAt || n.time || ''}</span>
          ${n.read ? '<span style="color:#94A3B8;">Read</span>' : '<span style="color:var(--royal-blue); font-weight:700;">New</span>'}
        </div>
      </div>
    `).join('');

    // Click on notif item marks it read
    notifList.querySelectorAll('.staff-notif-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        WorkPulseDB.markNotificationRead(id);
        renderStaffNotifications();
      });
    });
  }

  if (notifToggleBtn && notifDropdown) {
    notifToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = notifDropdown.style.display === 'block';
      notifDropdown.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) renderStaffNotifications();
    });

    document.addEventListener('click', (e) => {
      if (notifDropdown && !notifDropdown.contains(e.target) && e.target !== notifToggleBtn) {
        notifDropdown.style.display = 'none';
      }
    });
  }

  if (btnClearNotifs) {
    btnClearNotifs.addEventListener('click', () => {
      WorkPulseDB.markAllNotificationsRead('staff', staff.id);
      renderStaffNotifications();
      showToast('All notifications marked as read.', 'info');
    });
  }

  // --- MEETING ALERT BANNER ---
  function checkMeetingAlert() {
    if (!meetingAlertBanner) return;
    const allMeetings = WorkPulseDB.getMeetings({ staffId: staff.id });
    const upcoming = allMeetings.filter(m => {
      const dyn = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function')
        ? WorkPulseDB.getMeetingDynamicStatus(m)
        : (m.status || 'Upcoming');
      return dyn === 'Upcoming' || dyn === 'Ongoing';
    }).sort((a, b) => {
      const aTime = (typeof WorkPulseDB.parseMeetingDateTime === 'function') ? WorkPulseDB.parseMeetingDateTime(a.date, a.time) : new Date(`${a.date}T${a.time}`).getTime();
      const bTime = (typeof WorkPulseDB.parseMeetingDateTime === 'function') ? WorkPulseDB.parseMeetingDateTime(b.date, b.time) : new Date(`${b.date}T${b.time}`).getTime();
      return aTime - bTime;
    });

    if (upcoming.length > 0) {
      const nextMeeting = upcoming[0];
      const dyn = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function')
        ? WorkPulseDB.getMeetingDynamicStatus(nextMeeting)
        : 'Upcoming';
      meetingAlertBanner.style.display = 'flex';
      if (meetingAlertTitle) {
        meetingAlertTitle.textContent = dyn === 'Ongoing'
          ? `● Ongoing Executive Briefing: ${nextMeeting.title}`
          : `Upcoming Executive Meeting: ${nextMeeting.title}`;
      }
      if (meetingAlertDesc) {
        meetingAlertDesc.textContent = `Scheduled for ${WorkPulseDB.formatDisplayDate(nextMeeting.date)} at ${nextMeeting.time} (${nextMeeting.durationMinutes || 60}m) — ${nextMeeting.venue || 'Online'}`;
      }
    } else {
      meetingAlertBanner.style.display = 'none';
    }
  }

  if (btnJumpToMeetings) {
    btnJumpToMeetings.addEventListener('click', () => {
      const sec = document.getElementById('staff-meetings-section');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // --- STATUS & PRIORITY BADGE HELPERS ---
  function getStatusBadgeClass(status) {
    const s = (status || '').toLowerCase().replace(/\s+/g, '');
    if (s === 'backlog') return 'badge-status-backlog';
    if (s === 'todo') return 'badge-status-todo';
    if (s === 'inprogress') return 'badge-status-inprogress';
    if (s === 'inreview') return 'badge-status-inreview';
    if (s === 'completed') return 'badge-status-completed';
    if (s === 'onhold') return 'badge-status-onhold';
    return 'badge-status-todo';
  }

  function getPriorityBadgeClass(priority) {
    const p = (priority || '').toLowerCase();
    if (p === 'low') return 'badge-priority-low';
    if (p === 'medium') return 'badge-priority-medium';
    if (p === 'high') return 'badge-priority-high';
    if (p === 'urgent') return 'badge-priority-urgent';
    return 'badge-priority-medium';
  }

  function getResolvedStaffNames(t) {
    if (t.assignedStaffName) return t.assignedStaffName;
    if (t.assignedStaffId === 'all') return 'All Staff Members';
    if (Array.isArray(t.assignedStaffIds) && t.assignedStaffIds.length > 0) {
      if (t.assignedStaffIds.includes('all')) return 'All Staff Members';
      const names = t.assignedStaffIds.map(id => {
        const s = WorkPulseDB.getStaffById(id);
        return s ? s.name : id;
      });
      return names.join(', ');
    }
    if (t.assignedStaffId) {
      const s = WorkPulseDB.getStaffById(t.assignedStaffId);
      return s ? s.name : t.assignedStaffId;
    }
    if (t.staffId) {
      const s = WorkPulseDB.getStaffById(t.staffId);
      return s ? s.name : t.staffId;
    }
    return 'Unassigned';
  }

  // --- SUBTAB 1: MY PROJECTS (STAFF) ---
  const staffProjectDetailsModal = document.getElementById('staff-project-details-modal');
  const btnCloseStaffProjectDetails = document.getElementById('btn-close-staff-project-details');

  function renderStaffProjects() {
    const grid = document.getElementById('staff-projects-grid');
    const counterBadge = document.getElementById('counter-my-projects');
    if (!grid) return;

    const allProjects = WorkPulseDB.getProjects ? WorkPulseDB.getProjects() : [];
    // Scope projects: assigned to current staff member or 'all'
    const myProjects = allProjects.filter(p => {
      if (!p.assignedStaffIds) return p.assignedStaffId === staff.id || p.assignedStaffId === 'all';
      return p.assignedStaffIds.includes(staff.id) || p.assignedStaffIds.includes('all') || p.assignedStaffId === staff.id || p.assignedStaffId === 'all';
    });

    if (counterBadge) counterBadge.textContent = myProjects.length;

    if (myProjects.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 16px; text-align: center; background: #F8FAFC; border-radius: var(--radius-sm); border: 1px dashed var(--border-color);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.5" style="margin-bottom:8px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          <div style="font-weight: 700; color: var(--navy-dark); font-size: 1rem; margin-bottom: 4px;">No Assigned Projects</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); max-width: 420px; margin: 0 auto;">You have not been assigned to any corporate projects yet. When administration assigns you to a project, it will appear here.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = myProjects.map(p => {
      const prog = WorkPulseDB.getProjectProgress ? WorkPulseDB.getProjectProgress(p.id) : { totalTasks: 0, completedTasks: 0, percent: 0 };
      const statusBadge = `<span class="badge ${getStatusBadgeClass(p.status)}">${p.status || 'To Do'}</span>`;
      const priorityBadge = `<span class="badge ${getPriorityBadgeClass(p.priority)}">${p.priority || 'Medium'}</span>`;

      // Assigned team avatars
      let teamAvatars = '';
      if (Array.isArray(p.assignedStaffIds) && p.assignedStaffIds.length > 0) {
        teamAvatars = p.assignedStaffIds.slice(0, 3).map(id => {
          if (id === 'all') return '<span class="avatar-stack-item" style="background:#071A2B;" title="All Staff">ALL</span>';
          const member = WorkPulseDB.getStaffById(id);
          const initials = member ? member.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() : id.substring(0,2);
          return `<span class="avatar-stack-item" title="${member ? member.name : id}">${initials}</span>`;
        }).join('');
        if (p.assignedStaffIds.length > 3) {
          teamAvatars += `<span class="avatar-stack-item" style="background:#64748B;">+${p.assignedStaffIds.length - 3}</span>`;
        }
      }

      return `
        <div class="project-card" data-project-id="${p.id}">
          <div class="project-card-header">
            <div>
              <div class="project-card-title">${escapeHtml(p.name)}</div>
              <div style="font-size:0.72rem; color:#64748B; margin-top:2px;">ID: ${p.id}</div>
            </div>
            <div class="d-flex align-items-center gap-1">
              ${priorityBadge}
              ${statusBadge}
            </div>
          </div>
          <p class="project-card-desc">${escapeHtml(p.description || 'No description provided.')}</p>

          <div class="project-progress-container">
            <div class="project-progress-meta">
              <span>Task Completion</span>
              <span class="project-progress-pct">${prog.percent}% (${prog.completedTasks}/${prog.totalTasks})</span>
            </div>
            <div class="project-progress-bar">
              <div class="project-progress-fill" style="width: ${prog.percent}%;"></div>
            </div>
          </div>

          <div class="project-card-footer">
            <div class="avatar-stack">
              ${teamAvatars}
            </div>
            <div class="project-dates-pill">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              <span>Due: ${WorkPulseDB.formatDisplayDate(p.dueDate) || 'Ongoing'}</span>
            </div>
          </div>

          <button type="button" class="btn btn-secondary btn-sm btn-staff-open-project" data-project-id="${p.id}" style="width:100%; margin-top:12px; font-weight:600; font-size:0.78rem; display:flex; align-items:center; justify-content:center; gap:6px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            <span>View Project Details & Tasks</span>
          </button>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.btn-staff-open-project').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openStaffProjectDetailsModal(btn.dataset.projectId);
      });
    });

    grid.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openStaffProjectDetailsModal(card.dataset.projectId);
      });
    });
  }

  let activeStaffProjectTab = 'tasks';
  let activeStaffProjectId = null;

  function openStaffProjectDetailsModal(projectId, targetTab = 'tasks') {
    if (!staffProjectDetailsModal) return;
    const project = WorkPulseDB.getProjectById ? WorkPulseDB.getProjectById(projectId) : null;
    if (!project) return;
    activeStaffProjectId = projectId;
    activeStaffProjectTab = targetTab;

    const titleEl = document.getElementById('staff-project-details-title');
    const idEl = document.getElementById('staff-project-details-id-display');
    const contentEl = document.getElementById('staff-project-details-content');

    if (titleEl) titleEl.textContent = project.name;
    if (idEl) idEl.textContent = `${project.id} • ${project.status || 'To Do'}`;

    if (!contentEl) return;

    if (!Array.isArray(project.comments)) project.comments = [];
    if (!Array.isArray(project.attachments)) project.attachments = [];
    if (!Array.isArray(project.reviewHistory)) project.reviewHistory = [];

    const prog = WorkPulseDB.getProjectProgress ? WorkPulseDB.getProjectProgress(projectId) : { totalTasks: 0, completedTasks: 0, percent: 0, subtasksCount: 0, completedSubtasks: 0 };
    const pct = prog.percentage ?? prog.percent ?? 0;
    const compTasks = prog.completedTasks ?? prog.completed ?? 0;
    const totTasks = prog.totalTasks ?? prog.total ?? 0;
    const compSubs = prog.completedSubtasks ?? 0;
    const totSubs = prog.subtasksCount ?? 0;

    // Get tasks in this project visible to this staff member
    const allProjectTasks = WorkPulseDB.getTasks({ projectId });
    const myTasks = allProjectTasks.filter(t => {
      return t.assignedStaffId === staff.id ||
        (Array.isArray(t.assignedStaffIds) && (t.assignedStaffIds.includes(staff.id) || t.assignedStaffIds.includes('all'))) ||
        t.assignedStaffId === 'all' ||
        t.staffId === staff.id;
    });

    // Staff team names
    let teamNames = 'All Staff Members';
    if (Array.isArray(project.assignedStaffIds) && !project.assignedStaffIds.includes('all')) {
      teamNames = project.assignedStaffIds.map(id => {
        const s = WorkPulseDB.getStaffById(id);
        return s ? s.name : id;
      }).join(', ');
    }

    contentEl.innerHTML = `
      <!-- Project Summary Banner -->
      <div class="card p-3 mb-3" style="background:#F8FAFC; border:1px solid #E2E8F0;">
        <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
          <div style="max-width:68%;">
            <div class="d-flex align-items-center gap-2 mb-1">
              <span class="badge ${getPriorityBadgeClass(project.priority)}">${project.priority || 'Medium'} Priority</span>
              <span class="badge ${getStatusBadgeClass(project.status)}">${project.status || 'To Do'}</span>
            </div>
            <h3 style="margin:4px 0; color:var(--navy-dark); font-family:var(--font-serif); font-size:1.15rem;">${escapeHtml(project.name)}</h3>
            <p style="font-size:0.84rem; color:#475569; margin:4px 0 8px; line-height:1.5;">${escapeHtml(project.description || 'No detailed description.')}</p>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
            <div style="font-size:0.72rem; color:#64748B; font-weight:700; text-transform:uppercase;">Project Status</div>
            <select class="form-control form-control-sm" id="staff-proj-status-select" style="min-width:130px; font-weight:700;">
              <option value="Backlog" ${project.status === 'Backlog' ? 'selected' : ''}>Backlog</option>
              <option value="To Do" ${(project.status === 'To Do' || project.status === 'Pending') ? 'selected' : ''}>To Do</option>
              <option value="In Progress" ${project.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
              <option value="In Review" ${project.status === 'In Review' ? 'selected' : ''}>In Review</option>
              <option value="Completed" ${project.status === 'Completed' ? 'selected' : ''}>Completed</option>
              <option value="On Hold" ${project.status === 'On Hold' ? 'selected' : ''}>On Hold</option>
            </select>
          </div>
        </div>

        <div class="project-progress-container mb-3" style="background:#FFFFFF; padding:10px 14px; border-radius:6px; border:1px solid #E2E8F0;">
          <div class="project-progress-meta">
            <span style="font-weight:700; color:var(--navy-dark);">Project Execution Progress</span>
            <span class="project-progress-pct" style="font-weight:800; color:var(--royal-blue);">${pct}%</span>
          </div>
          <div class="project-progress-bar" style="height:10px;">
            <div class="project-progress-fill" style="width: ${pct}%;"></div>
          </div>
          <div class="d-flex justify-content-between align-items-center mt-1" style="font-size:0.72rem; color:#64748B;">
            <span>${compTasks} of ${totTasks} project tasks completed</span>
            <span>${totSubs > 0 ? `${compSubs} of ${totSubs} subtasks finished` : 'No subtasks'}</span>
          </div>
        </div>

        <div class="row g-2" style="font-size:0.78rem; color:#475569;">
          <div class="col-md-4">
            <strong>Start Date:</strong> ${WorkPulseDB.formatDisplayDate(project.startDate) || 'N/A'}
          </div>
          <div class="col-md-4">
            <strong>Target Due Date:</strong> ${WorkPulseDB.formatDisplayDate(project.dueDate) || 'Ongoing'}
          </div>
          <div class="col-md-4">
            <strong>Assigned Team:</strong> ${escapeHtml(teamNames)}
          </div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="d-flex border-bottom mb-3" style="gap:4px;">
        <button type="button" class="btn btn-sm ${activeStaffProjectTab === 'tasks' ? 'btn-primary' : 'btn-ghost'} staff-proj-tab-btn" data-tab="tasks" style="font-weight:700;">
          📋 My Tasks & Subtasks (${myTasks.length})
        </button>
        <button type="button" class="btn btn-sm ${activeStaffProjectTab === 'comments' ? 'btn-primary' : 'btn-ghost'} staff-proj-tab-btn" data-tab="comments" style="font-weight:700;">
          💬 Comments & Discussion (${project.comments.length})
        </button>
        <button type="button" class="btn btn-sm ${activeStaffProjectTab === 'attachments' ? 'btn-primary' : 'btn-ghost'} staff-proj-tab-btn" data-tab="attachments" style="font-weight:700;">
          📎 Attachments (${project.attachments.length})
        </button>
        <button type="button" class="btn btn-sm ${activeStaffProjectTab === 'reviews' ? 'btn-primary' : 'btn-ghost'} staff-proj-tab-btn" data-tab="reviews" style="font-weight:700;">
          📜 Review History (${project.reviewHistory.length})
        </button>
      </div>

      <!-- TAB 1: TASKS & SUBTASKS -->
      <div id="staff-proj-tab-pane-tasks" style="display: ${activeStaffProjectTab === 'tasks' ? 'block' : 'none'};">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h4 style="font-size:0.92rem; font-weight:700; color:var(--navy-dark); margin:0;">
            Assigned Tasks (${myTasks.length})
          </h4>
        </div>

        <div class="tasks-cards-grid">
          ${myTasks.length === 0 ? `
            <div style="grid-column: 1 / -1; padding: 28px; text-align: center; background: #FFFFFF; border-radius: 6px; border: 1px dashed #CBD5E1; color: #64748B; font-size: 0.82rem;">
              No tasks specifically assigned to you in this project yet.
            </div>
          ` : myTasks.map(t => {
            const tStatus = `<span class="badge ${getStatusBadgeClass(t.status)}">${t.status}</span>`;
            const tPrio = `<span class="badge ${getPriorityBadgeClass(t.priority)}">${t.priority}</span>`;
            const subDone = (t.subtasks || []).filter(s => s.completed).length;
            const subTotal = (t.subtasks || []).length;
            const subBadge = subTotal > 0 ? `<span class="badge" style="background:#F1F5F9; color:#475569; font-size:0.7rem;">✓ ${subDone}/${subTotal} Subtasks</span>` : '';

            return `
              <div class="card p-3" style="border:1px solid #E2E8F0; background:#FFFFFF;">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <div style="font-weight:700; color:var(--navy-dark); font-size:0.88rem;">${escapeHtml(t.title)}</div>
                  <div class="d-flex gap-1">${tPrio} ${tStatus}</div>
                </div>
                <p style="font-size:0.78rem; color:#64748B; margin-bottom:10px; line-height:1.4;">${escapeHtml(t.description || 'No description.')}</p>
                <div class="d-flex justify-content-between align-items-center" style="font-size:0.74rem; color:#64748B;">
                  <span>Due: ${WorkPulseDB.formatDisplayDate(t.dueDate) || 'Ongoing'}</span>
                  <div>${subBadge}</div>
                </div>

                <!-- Subtasks interactive checklist -->
                ${subTotal > 0 ? `
                  <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px; margin-top:10px;">
                    <div style="font-size:0.70rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:4px;">
                      Subtasks (${subDone}/${subTotal} completed):
                    </div>
                    <div class="d-flex flex-column gap-1">
                      ${t.subtasks.map(sub => `
                        <label class="d-flex align-items-center gap-2 m-0" style="font-size:0.76rem; cursor:pointer;">
                          <input type="checkbox" class="staff-proj-subtask-chk" data-task-id="${t.id}" data-subtask-id="${sub.id}" ${sub.completed ? 'checked' : ''}>
                          <span style="${sub.completed ? 'text-decoration:line-through; color:#94A3B8;' : 'color:#1E293B;'}">${escapeHtml(sub.title)}</span>
                          <span class="badge ms-auto" style="font-size:0.60rem; ${sub.completed ? 'background:#D1FAE5; color:#065F46;' : 'background:#EFF6FF; color:#1E40AF;'}">
                            ${sub.completed ? 'Done' : (WorkPulseDB.formatDisplayDate(sub.dueDate) || 'Active')}
                          </span>
                        </label>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}

                <button type="button" class="btn btn-secondary btn-sm w-100 mt-2 btn-open-staff-task-detail" data-task-id="${t.id}" style="font-size:0.74rem;">
                  View Task Details & Submit Work
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- TAB 2: COMMENTS & DISCUSSION -->
      <div id="staff-proj-tab-pane-comments" style="display: ${activeStaffProjectTab === 'comments' ? 'block' : 'none'};">
        <div class="card p-3 mb-3" style="background:#F8FAFC; border:1px solid #E2E8F0;">
          <h5 style="font-size:0.86rem; font-weight:700; color:var(--navy-dark); margin-bottom:8px;">Add Project Comment / Update</h5>
          <div class="mb-2">
            <textarea class="form-control" id="staff-proj-comment-input" rows="3" placeholder="Share progress updates, ask questions, or report blockers on this project..."></textarea>
          </div>
          <div class="d-flex justify-content-end">
            <button class="btn btn-primary btn-sm" id="btn-submit-staff-proj-comment" style="font-size:0.78rem;">
              Post Comment
            </button>
          </div>
        </div>

        <div class="d-flex flex-column gap-2" id="staff-proj-comments-stream">
          ${project.comments.length === 0 ? `
            <div class="text-center p-4 text-muted" style="font-size:0.82rem; background:#F8FAFC; border-radius:6px;">
              No comments posted yet. Start the conversation with your team!
            </div>
          ` : project.comments.map(c => `
            <div class="card p-3" style="background:#FFFFFF; border:1px solid #E2E8F0;">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <div class="d-flex align-items-center gap-2">
                  <span class="avatar-circle-sm" style="width:24px; height:24px; border-radius:50%; background:var(--royal-blue); color:#fff; font-size:0.65rem; font-weight:700; display:inline-flex; align-items:center; justify-content:center;">
                    ${(c.author || 'ST').substring(0,2).toUpperCase()}
                  </span>
                  <span style="font-weight:700; font-size:0.82rem; color:var(--navy-dark);">${escapeHtml(c.author || 'User')}</span>
                  <span class="badge" style="font-size:0.62rem; background:#F1F5F9; color:#475569;">${c.authorRole || 'Team'}</span>
                </div>
                <span style="font-size:0.70rem; color:#94A3B8;">${WorkPulseDB.formatDisplayDate(c.createdAt || Date.now(), true)}</span>
              </div>
              <p style="font-size:0.82rem; color:#334155; margin:0; line-height:1.5;">${escapeHtml(c.text || '')}</p>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- TAB 3: ATTACHMENTS -->
      <div id="staff-proj-tab-pane-attachments" style="display: ${activeStaffProjectTab === 'attachments' ? 'block' : 'none'};">
        <div class="card p-3 mb-3" style="background:#F8FAFC; border:1px solid #E2E8F0;">
          <h5 style="font-size:0.86rem; font-weight:700; color:var(--navy-dark); margin-bottom:6px;">Upload Project Document / Spec</h5>
          <div class="d-flex align-items-center gap-2">
            <input type="file" id="staff-proj-attachment-file-input" class="form-control form-control-sm" style="max-width:380px;">
            <button class="btn btn-secondary btn-sm" id="btn-upload-staff-proj-attachment" style="font-size:0.78rem;">
              Upload File
            </button>
          </div>
          <small class="text-muted" style="font-size:0.72rem; margin-top:4px;">Supported: PDF, DOCX, XLSX, Images, ZIP</small>
        </div>

        <div class="table-container" style="border:1px solid #E2E8F0; border-radius:8px;">
          <table class="table mb-0">
            <thead>
              <tr style="background:#F8FAFC;">
                <th>File Name</th>
                <th style="width:100px;">Size</th>
                <th style="width:150px;">Uploaded By</th>
                <th style="width:130px;">Date</th>
                <th class="text-end" style="width:100px;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${project.attachments.length === 0 ? `
                <tr>
                  <td colspan="5" class="text-center p-3 text-muted" style="font-size:0.82rem;">No attachments uploaded to this project yet.</td>
                </tr>
              ` : project.attachments.map(att => `
                <tr>
                  <td>
                    <div style="font-weight:700; color:var(--navy-dark); font-size:0.82rem;">📎 ${escapeHtml(att.name)}</div>
                  </td>
                  <td style="font-size:0.76rem; color:#64748B;">${att.size || '1.0 MB'}</td>
                  <td style="font-size:0.76rem; color:#334155;">👤 ${escapeHtml(att.uploadedBy || 'Team')}</td>
                  <td style="font-size:0.74rem; color:#64748B;">${WorkPulseDB.formatDisplayDate(att.uploadedAt || Date.now())}</td>
                  <td class="text-end">
                    <a href="${att.url || '#'}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:0.72rem; padding:2px 8px; color:var(--royal-blue);">
                      View / Open
                    </a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 4: REVIEW & AUDIT HISTORY -->
      <div id="staff-proj-tab-pane-reviews" style="display: ${activeStaffProjectTab === 'reviews' ? 'block' : 'none'};">
        <div class="timeline-container p-3 rounded" style="background:#FFFFFF; border:1px solid #E2E8F0;">
          <div style="font-size:0.76rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:12px;">Executive Milestone Approvals & Audit Trail</div>
          ${project.reviewHistory.length === 0 ? `
            <div class="text-center p-3 text-muted" style="font-size:0.82rem;">No review history recorded yet. Administrative sign-offs will appear here.</div>
          ` : project.reviewHistory.map(rev => `
            <div class="d-flex align-items-start gap-3 mb-3 pb-3 border-bottom">
              <div style="font-size:1.2rem;">🏅</div>
              <div style="flex:1;">
                <div class="d-flex justify-content-between align-items-center">
                  <span style="font-weight:700; color:var(--navy-dark); font-size:0.84rem;">${escapeHtml(rev.decision || 'Reviewed')}</span>
                  <span style="font-size:0.72rem; color:#94A3B8;">${new Date(rev.timestamp || Date.now()).toLocaleString()}</span>
                </div>
                <div style="font-size:0.76rem; color:#475569; margin:2px 0;">Reviewed by: <strong>${escapeHtml(rev.reviewer || 'Administrator')}</strong></div>
                <div style="font-size:0.80rem; color:#334155;">${escapeHtml(rev.notes || 'No review notes provided.')}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Wire Tab Switching
    contentEl.querySelectorAll('.staff-proj-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        openStaffProjectDetailsModal(projectId, btn.dataset.tab);
      });
    });

    // Wire Status Dropdown
    const statusSel = document.getElementById('staff-proj-status-select');
    if (statusSel) {
      statusSel.addEventListener('change', async () => {
        const newStatus = statusSel.value;
        try {
          await fetch(`/api/projects/${project.id}/status`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: newStatus })
          });
        } catch (e) {}
        WorkPulseDB.updateProject(project.id, { status: newStatus }, staff);
        showToast(`Project status updated to "${newStatus}"`, 'success');
        renderStaffProjects();
        renderStaffKanban();
        renderStaffGantt();
        openStaffProjectDetailsModal(project.id, activeStaffProjectTab);
      });
    }

    // Wire Subtask completion toggling
    contentEl.querySelectorAll('.staff-proj-subtask-chk').forEach(chk => {
      chk.addEventListener('change', async () => {
        const taskId = chk.dataset.taskId;
        const subtaskId = chk.dataset.subtaskId;
        const isDone = chk.checked;
        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ completed: isDone })
          });
        } catch (e) {}
        WorkPulseDB.toggleSubtask(taskId, subtaskId, isDone);
        showToast(`Subtask marked ${isDone ? 'completed' : 'pending'}`, 'info');
        renderStaffProjects();
        renderStaffTasks();
        renderStaffKanban();
        renderStaffGantt();
        openStaffProjectDetailsModal(projectId, 'tasks');
      });
    });

    // Wire Task Details button
    contentEl.querySelectorAll('.btn-open-staff-task-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        if (staffProjectDetailsModal) staffProjectDetailsModal.classList.remove('open');
        openStaffTaskModal(btn.dataset.taskId);
      });
    });

    // Wire Comment Submission
    const btnSubmitComment = document.getElementById('btn-submit-staff-proj-comment');
    if (btnSubmitComment) {
      btnSubmitComment.addEventListener('click', async () => {
        const input = document.getElementById('staff-proj-comment-input');
        const text = input ? input.value.trim() : '';
        if (!text) {
          showToast('Please enter a comment or update.', 'warning');
          return;
        }
        btnSubmitComment.disabled = true;
        try {
          await fetch(`/api/projects/${project.id}/comments`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ text })
          });
        } catch (e) {}
        WorkPulseDB.addProjectComment(project.id, text, staff);
        showToast('Comment posted successfully', 'success');
        openStaffProjectDetailsModal(projectId, 'comments');
      });
    }

    // Wire Attachment Upload
    const btnUploadAtt = document.getElementById('btn-upload-staff-proj-attachment');
    if (btnUploadAtt) {
      btnUploadAtt.addEventListener('click', async () => {
        const fileInput = document.getElementById('staff-proj-attachment-file-input');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
          showToast('Please select a file to upload.', 'warning');
          return;
        }
        const file = fileInput.files[0];
        btnUploadAtt.disabled = true;
        btnUploadAtt.textContent = 'Uploading...';

        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64Data = e.target.result;
          const sizeKb = Math.round(file.size / 1024);
          const sizeStr = sizeKb > 1024 ? `${(sizeKb/1024).toFixed(1)} MB` : `${sizeKb} KB`;

          try {
            await fetch(`/api/projects/${project.id}/attachments`, {
              method: 'POST',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                name: file.name,
                size: sizeStr,
                dataBase64: base64Data
              })
            });
          } catch (netErr) {}

          WorkPulseDB.addProjectAttachment(project.id, {
            name: file.name,
            size: sizeStr,
            url: base64Data
          }, staff);

          showToast('Attachment uploaded successfully', 'success');
          openStaffProjectDetailsModal(projectId, 'attachments');
        };
        reader.readAsDataURL(file);
      });
    }

    staffProjectDetailsModal.classList.add('open');
  }

  if (btnCloseStaffProjectDetails) {
    btnCloseStaffProjectDetails.addEventListener('click', () => {
      if (staffProjectDetailsModal) staffProjectDetailsModal.classList.remove('open');
    });
  }

  // --- SUBTAB 2: KANBAN BOARD (STAFF) ---
  function renderStaffKanban() {
    const statuses = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Completed', 'On Hold'];
    const statusMap = {
      'Backlog': 'backlog',
      'To Do': 'todo',
      'In Progress': 'inprogress',
      'In Review': 'inreview',
      'Completed': 'completed',
      'On Hold': 'onhold'
    };

    const allTasks = WorkPulseDB.getTasks ? WorkPulseDB.getTasks() : [];
    // Scope tasks to current logged-in staff member
    const myTasks = allTasks.filter(t => {
      return t.assignedStaffId === staff.id ||
        (Array.isArray(t.assignedStaffIds) && (t.assignedStaffIds.includes(staff.id) || t.assignedStaffIds.includes('all'))) ||
        t.assignedStaffId === 'all' ||
        t.staffId === staff.id;
    });

    statuses.forEach(status => {
      const slug = statusMap[status];
      const colList = document.getElementById(`staff-kanban-list-${slug}`);
      const counter = document.getElementById(`staff-counter-kanban-${slug}`);

      const tasksInCol = myTasks.filter(t => (t.status || 'To Do') === status);
      if (counter) counter.textContent = tasksInCol.length;

      if (!colList) return;

      if (tasksInCol.length === 0) {
        colList.innerHTML = '<div class="kanban-empty-state">No tasks</div>';
      } else {
        colList.innerHTML = tasksInCol.map(t => {
          const prioClass = getPriorityBadgeClass(t.priority);
          const project = t.projectId ? WorkPulseDB.getProjectById(t.projectId) : null;
          const projectName = project ? project.name : (t.projectTitle || '');
          const staffNames = getResolvedStaffNames(t);

          const subDone = (t.subtasks || []).filter(s => s.completed).length;
          const subTotal = (t.subtasks || []).length;
          const subInfo = subTotal > 0 ? `<span class="badge" style="background:#F1F5F9; color:#475569; font-size:0.68rem;">✓ ${subDone}/${subTotal}</span>` : '';

          return `
            <div class="kanban-card" draggable="true" data-task-id="${t.id}" id="staff-kcard-${t.id}">
              <div class="kanban-card-project">${escapeHtml(projectName ? `📁 ${projectName}` : 'Task')}</div>
              <div class="kanban-card-title">${escapeHtml(t.title)}</div>
              <div class="kanban-card-footer">
                <span class="badge ${prioClass}">${t.priority || 'Medium'}</span>
                ${subInfo}
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:0.7rem; color:#64748B;">
                <span>📅 ${WorkPulseDB.formatDisplayDate(t.dueDate) || 'Ongoing'}</span>
                <span style="font-weight:600; color:var(--navy-dark);" title="${escapeHtml(staffNames)}">👤 ${escapeHtml(staffNames.length > 14 ? staffNames.substring(0,12) + '...' : staffNames)}</span>
              </div>
            </div>
          `;
        }).join('');
      }

      // Wire HTML5 Drag & Drop listeners on cards
      colList.querySelectorAll('.kanban-card').forEach(card => {
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', card.dataset.taskId);
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
        });
        card.addEventListener('click', () => {
          openStaffTaskModal(card.dataset.taskId);
        });
      });
    });

    // Wire drop containers
    document.querySelectorAll('#staff-kanban-board .kanban-column').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => {
        col.classList.remove('drag-over');
      });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const targetStatus = col.dataset.status;
        if (!taskId || !targetStatus) return;

        try {
          await fetch(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: targetStatus, updatedBy: staff.name })
          });
        } catch (netErr) {
          console.warn('Network status patch fallback:', netErr);
        }

        WorkPulseDB.updateTaskStatus(taskId, targetStatus, staff.name, 'Staff');
        showToast(`Task moved to "${targetStatus}"`, 'success');
        renderStaffKanban();
        renderStaffTasks();
        populateReportTaskSelect();
      });
    });
  }

  // --- SUBTAB: MY GANTT CHART (STAFF) ---
  function renderStaffGantt() {
    if (!window.WorkPulseGantt) return;
    const projects = WorkPulseDB.getProjects();
    const tasks = WorkPulseDB.getTasks();
    const staffList = WorkPulseDB.getStaffList();

    WorkPulseGantt.render({
      container: 'pane-tab-my-gantt',
      isAdmin: false,
      currentStaff: staff,
      projects,
      tasks,
      staffList,
      onOpenTaskModal: (taskId) => {
        openStaffTaskModal(taskId);
      },
      onOpenProjectModal: (projectId) => {
        openStaffProjectDetailsModal(projectId);
      },
      onUpdateTaskDates: async (taskId, startDate, dueDate) => {
        const token = localStorage.getItem('workpulse_token') || sessionStorage.getItem('workpulse_token');
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ startDate, dueDate })
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to update task dates');
        }
        WorkPulseDB.updateTask(taskId, { startDate, dueDate }, staff);
        showToast('Task schedule dates updated', 'success');
        renderStaffGantt();
        renderStaffKanban();
        renderStaffProjects();
        renderStaffTasks();
      },
      onRefreshAll: () => {
        renderStaffGantt();
        renderStaffKanban();
        renderStaffProjects();
        renderStaffTasks();
      }
    });
  }

  // --- SUBTAB 3: MY TASKS (STAFF GRID & LIST) ---
  const taskDetailModal = document.getElementById('task-detail-modal');
  const btnCloseTaskModal = document.getElementById('btn-close-task-modal');
  let currentTaskDeliverableFile = null;

  function renderStaffTasks() {
    const grid = document.getElementById('staff-tasks-grid');
    if (!grid) return;

    const allTasks = WorkPulseDB.getTasks ? WorkPulseDB.getTasks() : [];
    // Scope tasks strictly to logged-in staff member
    const allMyTasks = allTasks.filter(t => {
      return t.assignedStaffId === staff.id ||
        (Array.isArray(t.assignedStaffIds) && (t.assignedStaffIds.includes(staff.id) || t.assignedStaffIds.includes('all'))) ||
        t.assignedStaffId === 'all' ||
        t.staffId === staff.id;
    });

    // Update count badges
    const cAll = allMyTasks.length;
    const cBacklog = allMyTasks.filter(t => t.status === 'Backlog').length;
    const cTodo = allMyTasks.filter(t => t.status === 'To Do' || t.status === 'Pending').length;
    const cProg = allMyTasks.filter(t => t.status === 'In Progress').length;
    const cReview = allMyTasks.filter(t => t.status === 'In Review').length;
    const cComp = allMyTasks.filter(t => t.status === 'Completed').length;
    const cOnhold = allMyTasks.filter(t => t.status === 'On Hold').length;

    const elAll = document.getElementById('task-count-all');
    const elBacklog = document.getElementById('task-count-backlog');
    const elTodo = document.getElementById('task-count-todo');
    const elProg = document.getElementById('task-count-progress');
    const elReview = document.getElementById('task-count-review');
    const elComp = document.getElementById('task-count-completed');
    const elOnhold = document.getElementById('task-count-onhold');
    const counterWork = document.getElementById('counter-my-work');

    if (elAll) elAll.textContent = cAll;
    if (elBacklog) elBacklog.textContent = cBacklog;
    if (elTodo) elTodo.textContent = cTodo;
    if (elProg) elProg.textContent = cProg;
    if (elReview) elReview.textContent = cReview;
    if (elComp) elComp.textContent = cComp;
    if (elOnhold) elOnhold.textContent = cOnhold;
    if (counterWork) counterWork.textContent = cTodo + cProg + cReview;

    // Filter
    let filtered = allMyTasks;
    if (activeTaskFilter !== 'all') {
      if (activeTaskFilter === 'To Do') {
        filtered = allMyTasks.filter(t => t.status === 'To Do' || t.status === 'Pending');
      } else {
        filtered = allMyTasks.filter(t => t.status === activeTaskFilter);
      }
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 36px 16px; text-align: center; background: #F8FAFC; border-radius: var(--radius-sm); border: 1px dashed var(--border-color);">
          <div style="font-weight: 700; color: var(--navy-dark); font-size: 0.95rem; margin-bottom: 4px;">No tasks found</div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">No assigned tasks match the "${activeTaskFilter}" filter criteria.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(t => {
      const pClass = getPriorityBadgeClass(t.priority);
      const sClass = getStatusBadgeClass(t.status);
      const isOverdue = t.dueDate && t.status !== 'Completed' && (new Date(t.dueDate) < new Date());
      const subCount = (t.submissions || []).length;
      const project = t.projectId ? WorkPulseDB.getProjectById(t.projectId) : null;
      const projectName = project ? project.name : (t.projectTitle || '');
      const staffNames = getResolvedStaffNames(t);

      const subDone = (t.subtasks || []).filter(s => s.completed).length;
      const subTotal = (t.subtasks || []).length;
      const subInfo = subTotal > 0 ? `<span class="badge" style="background:#F1F5F9; color:#475569; font-size:0.72rem;">✓ ${subDone}/${subTotal} Subtasks</span>` : '';

      return `
        <div class="staff-task-card" data-task-id="${t.id}" style="cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;">
          <div>
            ${projectName ? `<div style="font-size:0.72rem; font-weight:700; color:var(--royal-blue); margin-bottom:4px;">📁 ${escapeHtml(projectName)}</div>` : ''}
            <div class="task-card-top">
              <h3 class="task-title" style="color:var(--navy-dark); font-size:0.95rem;">${escapeHtml(t.title)}</h3>
              <div class="d-flex gap-1">
                <span class="badge ${pClass}">${t.priority || 'Medium'}</span>
                <span class="badge ${sClass}">${t.status || 'To Do'}</span>
              </div>
            </div>
            <p class="task-desc">${escapeHtml(t.description || 'No description provided.')}</p>

            <div class="d-flex align-items-center gap-2 mb-2" style="font-size:0.75rem; color:#475569;">
              <span style="font-weight:600;">Assigned To:</span>
              <span style="color:var(--navy-dark); font-weight:700;">${escapeHtml(staffNames)}</span>
            </div>

            <div class="task-meta-row">
              <span class="task-meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Start: ${WorkPulseDB.formatDisplayDate(t.startDate || t.assignedDate) || 'N/A'}
              </span>
              <span class="task-meta-item" style="${isOverdue ? 'color: #DC2626; font-weight: 700;' : ''}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                Due: ${WorkPulseDB.formatDisplayDate(t.dueDate) || 'Ongoing'}${isOverdue ? ' (Overdue)' : ''}
              </span>
            </div>

            ${subInfo ? `<div style="margin-top:6px;">${subInfo}</div>` : ''}

            ${t.file ? `
              <div style="margin-top: 10px;">
                <a href="${t.file.url || t.file.dataBase64}" download="${t.file.name}" class="btn btn-secondary btn-sm task-file-link" style="font-size:0.72rem; padding: 3px 9px; display: inline-flex; align-items: center; gap: 4px; color: var(--royal-blue); border-color: rgba(29,95,143,0.3);" title="Download Attached Task File: ${t.file.name} (${t.file.size})">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                  <span>📎 Briefing: ${t.file.name}</span>
                </a>
              </div>
            ` : ''}

            <button type="button" class="btn btn-secondary btn-sm btn-open-task-details" data-task-id="${t.id}" style="width: 100%; margin-top: 12px; font-weight: 600; font-size: 0.76rem; display: flex; align-items: center; justify-content: center; gap: 6px; background:#F8FAFC; border:1px solid #CBD5E1; color:var(--navy-dark);">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              <span>View Details, Discussion & Subtasks</span>
              ${subCount > 0 ? `<span class="badge" style="background:#E0E7FF; color:#3730A3; font-size:0.65rem; padding:1px 5px;">${subCount} deliverable${subCount > 1 ? 's' : ''}</span>` : ''}
            </button>
          </div>

          <div class="task-status-control-bar" style="margin-top: 10px;">
            <span style="font-size: 0.72rem; font-weight: 700; color: var(--navy-dark); text-transform: uppercase;">Update Status:</span>
            <select class="task-status-select" data-task-id="${t.id}">
              <option value="Backlog" ${t.status === 'Backlog' ? 'selected' : ''}>Backlog</option>
              <option value="To Do" ${(t.status === 'To Do' || t.status === 'Pending') ? 'selected' : ''}>To Do</option>
              <option value="In Progress" ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
              <option value="In Review" ${t.status === 'In Review' ? 'selected' : ''}>In Review</option>
              <option value="Completed" ${t.status === 'Completed' ? 'selected' : ''}>Completed</option>
              <option value="On Hold" ${t.status === 'On Hold' ? 'selected' : ''}>On Hold</option>
            </select>
          </div>
        </div>
      `;
    }).join('');

    // Wire clicks to open task modal
    grid.querySelectorAll('.staff-task-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.task-status-select') || e.target.closest('.task-file-link')) return;
        const taskId = card.dataset.taskId;
        openStaffTaskModal(taskId);
      });
    });

    // Wire status update dropdowns
    grid.querySelectorAll('.task-status-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        e.stopPropagation();
        const taskId = sel.dataset.taskId;
        const newStatus = e.target.value;
        try {
          await fetch(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: newStatus, updatedBy: staff.name })
          });
        } catch (netErr) {
          console.warn('Status patch network fallback:', netErr);
        }

        WorkPulseDB.updateTaskStatus(taskId, newStatus, staff.name, 'Staff');
        showToast(`Task status updated to "${newStatus}"`, 'success');
        renderStaffTasks();
        renderStaffKanban();
        populateReportTaskSelect();
      });
    });
  }

  // --- STAFF TASK DETAILS, SUBTASKS, DISCUSSION & DELIVERABLE MODAL ---
  function openStaffTaskModal(taskId) {
    if (!taskDetailModal) return;
    const task = WorkPulseDB.getTaskById ? WorkPulseDB.getTaskById(taskId) : null;
    if (!task) return;

    // Check authorization: must be assigned or shared
    const isAssigned = (task.assignedStaffId === 'all') ||
      (task.assignedStaffId === staff.id) ||
      (task.staffId === staff.id) ||
      (Array.isArray(tAssignedIds = task.assignedStaffIds) && (tAssignedIds.includes(staff.id) || tAssignedIds.includes('all')));
    if (!isAssigned) {
      showToast('You are not authorized to access this task.', 'error');
      return;
    }

    const titleEl = document.getElementById('task-modal-title');
    if (titleEl) titleEl.textContent = task.title;

    const contentEl = document.getElementById('task-modal-content');
    if (!contentEl) return;

    currentTaskDeliverableFile = null;
    const pClass = getPriorityBadgeClass(task.priority);
    const sClass = getStatusBadgeClass(task.status);
    const isOverdue = task.dueDate && task.status !== 'Completed' && (new Date(task.dueDate) < new Date());

    const project = task.projectId ? WorkPulseDB.getProjectById(task.projectId) : null;
    const projectName = project ? project.name : (task.projectTitle || '');
    const staffNames = getResolvedStaffNames(task);

    let adminAttachHtml = '<span style="color:#94A3B8; font-size:0.8rem;">No reference file attached by Admin.</span>';
    if (task.file) {
      adminAttachHtml = `
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700; color:var(--navy-dark); font-size:0.84rem;">📎 ${task.file.name}</div>
            <div style="font-size:0.72rem; color:#64748B;">Size: ${task.file.size} &bull; Admin Reference Document</div>
          </div>
          <a href="${task.file.url || task.file.dataBase64}" download="${task.file.name}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:0.75rem; color:var(--royal-blue); border-color:rgba(29,95,143,0.3);">
            Download
          </a>
        </div>
      `;
    }

    // Subtasks Rich HTML
    const subtasks = task.subtasks || [];
    const completedSubs = subtasks.filter(s => s.completed || s.status === 'Completed').length;
    const todayStr = new Date().toISOString().split('T')[0];

    let subtasksHtml = '';
    if (subtasks.length > 0) {
      subtasksHtml = subtasks.map(s => {
        const isComp = s.completed || s.status === 'Completed';
        const prog = s.progress !== undefined ? s.progress : (isComp ? 100 : 0);
        const statusClass = isComp ? 'is-completed' : (s.status === 'In Progress' ? 'is-in-progress' : (s.status === 'In Review' ? 'is-in-review' : (s.status === 'Blocked' ? 'is-blocked' : '')));
        const sComments = Array.isArray(s.comments) ? s.comments : [];
        const sAttachments = Array.isArray(s.attachments) ? s.attachments : [];
        const sReviews = Array.isArray(s.reviewHistory) ? s.reviewHistory : [];
        const sActivity = Array.isArray(s.activity) ? s.activity : [];

        return `
          <div class="subtask-item-card ${statusClass} mb-2" data-subtask-id="${s.id}">
            <div class="subtask-item-header" data-subtask-header="${s.id}">
              <div class="subtask-header-left">
                <input type="checkbox" class="subtask-checkbox staff-subtask-toggle" data-subtask-id="${s.id}" ${isComp ? 'checked' : ''} title="Toggle completion">
                <div class="subtask-title-wrap">
                  <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span class="subtask-title-text">${escapeHtml(s.title)}</span>
                    <span class="badge ${getStatusBadgeClass(s.status || 'To Do')}" style="font-size:0.65rem;">${s.status || 'To Do'}</span>
                    <span class="badge ${getPriorityBadgeClass(s.priority || 'Medium')}" style="font-size:0.65rem;">${s.priority || 'Medium'}</span>
                  </div>
                  <div class="d-flex align-items-center gap-3 mt-1" style="font-size:0.72rem; color:#64748B;">
                    <span>👤 ${escapeHtml(s.assignedStaffName || 'Assigned Team')}</span>
                    ${s.dueDate ? `<span>📅 Due: ${WorkPulseDB.formatDisplayDate(s.dueDate)}</span>` : ''}
                    ${s.description ? `<span class="subtask-desc-preview" title="${escapeHtml(s.description)}">${escapeHtml(s.description)}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="subtask-header-right">
                <div class="d-flex align-items-center gap-1" title="Progress: ${prog}%">
                  <div class="subtask-progress-mini">
                    <div class="subtask-progress-fill" style="width:${prog}%;"></div>
                  </div>
                  <span style="font-size:0.70rem; font-weight:700; color:#475569; width:30px; text-align:right;">${prog}%</span>
                </div>
                <span class="badge" style="background:#F1F5F9; color:#475569; font-size:0.70rem;" title="Comments">💬 ${sComments.length}</span>
                <span class="badge" style="background:#F1F5F9; color:#475569; font-size:0.70rem;" title="Attachments">📎 ${sAttachments.length}</span>
                <button type="button" class="btn btn-ghost btn-sm btn-staff-toggle-subtask" data-subtask-id="${s.id}" style="padding:2px 6px; font-size:0.72rem; color:var(--royal-blue); font-weight:600;">
                  Details ▾
                </button>
              </div>
            </div>

            <!-- Expandable Details Pane -->
            <div class="subtask-details-pane" id="staff-subtask-pane-${s.id}">
              <div class="subtask-meta-grid">
                <div class="subtask-meta-item">
                  <strong>Timeline</strong>
                  <span>${WorkPulseDB.formatDisplayDate(s.startDate) || '—'} &rarr; ${WorkPulseDB.formatDisplayDate(s.dueDate) || '—'}</span>
                </div>
                <div class="subtask-meta-item">
                  <strong>Priority</strong>
                  <span class="badge ${getPriorityBadgeClass(s.priority)}">${s.priority || 'Medium'}</span>
                </div>
                <div class="subtask-meta-item">
                  <strong>Status</strong>
                  <select class="form-control form-control-sm staff-subtask-status-sel" data-subtask-id="${s.id}" style="font-size:0.72rem; padding:2px 4px; height:26px;">
                    <option value="To Do" ${s.status === 'To Do' ? 'selected' : ''}>To Do</option>
                    <option value="In Progress" ${s.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                    <option value="In Review" ${s.status === 'In Review' ? 'selected' : ''}>In Review</option>
                    <option value="Completed" ${s.status === 'Completed' ? 'selected' : ''}>Completed</option>
                    <option value="Blocked" ${s.status === 'Blocked' ? 'selected' : ''}>Blocked</option>
                  </select>
                </div>
                <div class="subtask-meta-item">
                  <div class="d-flex justify-content-between align-items-center mb-1">
                    <strong>Progress: <span id="staff-sub-prog-val-${s.id}">${prog}%</span></strong>
                    <button type="button" class="btn btn-secondary btn-sm btn-staff-save-sub-prog" data-subtask-id="${s.id}" style="font-size:0.65rem; padding:1px 6px;">Save</button>
                  </div>
                  <input type="range" class="form-range staff-subtask-prog-slider" data-subtask-id="${s.id}" min="0" max="100" value="${prog}" style="width:100%;">
                </div>
              </div>

              ${s.description ? `
                <div class="mb-3 p-2 rounded" style="background:#FFFFFF; border:1px solid #E2E8F0; font-size:0.78rem; color:#334155;">
                  <strong style="font-size:0.72rem; color:var(--navy-dark); text-transform:uppercase;">Description & Instructions:</strong>
                  <p style="margin:4px 0 0; line-height:1.4;">${escapeHtml(s.description)}</p>
                </div>
              ` : ''}

              <!-- Sub-tabs Bar -->
              <div class="subtask-tabs-bar">
                <button type="button" class="subtask-tab-btn active" data-staff-sub-tab="comments" data-subtask-id="${s.id}">
                  💬 Comments (${sComments.length})
                </button>
                <button type="button" class="subtask-tab-btn" data-staff-sub-tab="attachments" data-subtask-id="${s.id}">
                  📎 Attachments (${sAttachments.length})
                </button>
                <button type="button" class="subtask-tab-btn" data-staff-sub-tab="reviews" data-subtask-id="${s.id}">
                  📜 Reviews & History (${sReviews.length + sActivity.length})
                </button>
              </div>

              <!-- Tab 1: Comments -->
              <div class="subtask-tab-panel active" id="staff-subtask-tab-comments-${s.id}">
                <div class="mb-2" style="max-height:150px; overflow-y:auto;">
                  ${sComments.length === 0 ? `
                    <div style="font-size:0.74rem; color:#94A3B8; text-align:center; padding:8px;">No comments yet on this subtask.</div>
                  ` : sComments.map(c => `
                    <div class="subtask-comment-card">
                      <div class="d-flex justify-content-between align-items-center mb-1">
                        <div>
                          <strong style="font-size:0.76rem; color:var(--navy-dark);">${escapeHtml(c.authorName || 'Staff')}</strong>
                          <span class="badge" style="background:#E0E7FF; color:#3730A3; font-size:0.62rem; margin-left:4px;">${c.authorRole || 'User'}</span>
                        </div>
                        <span style="font-size:0.68rem; color:#94A3B8;">${new Date(c.createdAt || Date.now()).toLocaleTimeString()}</span>
                      </div>
                      <div style="font-size:0.78rem; color:#334155; line-height:1.4;">${escapeHtml(c.text)}</div>
                    </div>
                  `).join('')}
                </div>
                <form class="staff-subtask-add-comment-form d-flex gap-2" data-subtask-id="${s.id}">
                  <input type="text" class="form-control form-control-sm staff-subtask-comment-input" placeholder="Add comment on this subtask..." required style="font-size:0.76rem;">
                  <button type="submit" class="btn btn-secondary btn-sm" style="font-size:0.72rem; padding:4px 10px;">Post</button>
                </form>
              </div>

              <!-- Tab 2: Attachments -->
              <div class="subtask-tab-panel" id="staff-subtask-tab-attachments-${s.id}">
                <div class="mb-2" style="max-height:150px; overflow-y:auto;">
                  ${sAttachments.length === 0 ? `
                    <div style="font-size:0.74rem; color:#94A3B8; text-align:center; padding:8px;">No files attached to this subtask.</div>
                  ` : sAttachments.map(att => `
                    <div class="d-flex justify-content-between align-items-center p-2 mb-1 rounded" style="background:#FFFFFF; border:1px solid #E2E8F0; font-size:0.75rem;">
                      <a href="${att.url || att.dataBase64}" download="${att.name}" target="_blank" style="color:var(--royal-blue); font-weight:600; text-decoration:none;">
                        📎 ${escapeHtml(att.name)} <span style="font-size:0.68rem; color:#64748B;">(${att.size || 'File'})</span>
                      </a>
                      <span style="font-size:0.68rem; color:#94A3B8;">by ${escapeHtml(att.uploadedBy || 'User')}</span>
                    </div>
                  `).join('')}
                </div>
                <div class="d-flex align-items-center gap-2">
                  <input type="file" class="form-control form-control-sm staff-subtask-file-input" data-subtask-id="${s.id}" style="font-size:0.74rem;">
                  <button type="button" class="btn btn-secondary btn-sm btn-staff-upload-subtask-att" data-subtask-id="${s.id}" style="font-size:0.72rem; padding:4px 10px;">Upload</button>
                </div>
              </div>

              <!-- Tab 3: Reviews & Activity -->
              <div class="subtask-tab-panel" id="staff-subtask-tab-reviews-${s.id}">
                <div style="max-height:150px; overflow-y:auto;">
                  ${sReviews.length === 0 && sActivity.length === 0 ? `
                    <div style="font-size:0.74rem; color:#94A3B8; text-align:center; padding:8px;">No reviews or activity logged yet.</div>
                  ` : `
                    ${sReviews.map(r => `
                      <div class="p-2 mb-1 rounded" style="background:#FFFFFF; border:1px solid #E2E8F0; font-size:0.75rem;">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                          <span class="badge ${r.decision === 'Approved' ? 'bg-success' : 'bg-warning'}" style="font-size:0.65rem;">${r.decision}</span>
                          <span style="font-size:0.68rem; color:#94A3B8;">${new Date(r.timestamp || r.createdAt || Date.now()).toLocaleTimeString()} by ${escapeHtml(r.reviewer || 'Admin')}</span>
                        </div>
                        ${r.notes ? `<div style="font-size:0.76rem; color:#334155;">${escapeHtml(r.notes)}</div>` : ''}
                      </div>
                    `).join('')}
                    ${sActivity.map(act => `
                      <div class="d-flex align-items-start gap-2 mb-1" style="font-size:0.72rem;">
                        <span style="color:var(--royal-blue);">&bull;</span>
                        <div style="flex:1;">
                          <span style="font-weight:600; color:var(--navy-dark);">${escapeHtml(act.details || act.action)}</span>
                        </div>
                        <span style="color:#94A3B8;">${new Date(act.createdAt || Date.now()).toLocaleTimeString()}</span>
                      </div>
                    `).join('')}
                  `}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      subtasksHtml = '<div style="font-size:0.78rem; color:#94A3B8; font-style:italic; padding:8px 0; text-align:center;">No subtasks created yet. Add one below to track sub-milestones.</div>';
    }

    // Comments Thread HTML
    const comments = task.comments || [];
    let commentsHtml = '';
    if (comments.length > 0) {
      commentsHtml = comments.map(c => {
        const isAdm = c.authorRole === 'Admin';
        return `
          <div class="d-flex gap-2 mb-3">
            <div style="width:32px; height:32px; border-radius:50%; background:${isAdm ? 'var(--navy-dark)' : 'var(--royal-blue)'}; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700; flex-shrink:0;">
              ${(c.authorName || 'User').split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase()}
            </div>
            <div style="flex:1; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px 12px;">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <div>
                  <span style="font-weight:700; font-size:0.8rem; color:var(--navy-dark);">${escapeHtml(c.authorName || 'Staff Member')}</span>
                  <span class="badge" style="font-size:0.65rem; margin-left:4px; ${isAdm ? 'background:#071A2B; color:#C99A32;' : 'background:#DBEAFE; color:#1E40AF;'}">${c.authorRole || 'Staff'}</span>
                </div>
                <span style="font-size:0.7rem; color:#94A3B8;">${WorkPulseDB.formatDisplayDate(c.createdAt || Date.now(), true)}</span>
              </div>
              <div style="font-size:0.82rem; color:#334155; line-height:1.45; white-space:pre-wrap;">${escapeHtml(c.text)}</div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      commentsHtml = '<div style="font-size:0.8rem; color:#94A3B8; font-style:italic; padding:8px 0;">No discussion comments yet. Start a conversation below.</div>';
    }

    // Activity Timeline HTML
    const activity = task.activity || [];
    let activityHtml = '';
    if (activity.length > 0) {
      activityHtml = activity.map(a => `
        <div class="d-flex align-items-center gap-2 mb-2 pb-2 border-bottom" style="font-size:0.78rem;">
          <span style="font-size:0.75rem; color:#94A3B8; width:130px; flex-shrink:0;">${WorkPulseDB.formatDisplayDate(a.timestamp || Date.now(), true)}</span>
          <span style="font-weight:700; color:var(--navy-dark);">${escapeHtml(a.author || 'User')}:</span>
          <span style="color:#475569;">${escapeHtml(a.text || a.action)}</span>
        </div>
      `).join('');
    } else {
      activityHtml = '<div style="font-size:0.78rem; color:#94A3B8; font-style:italic;">No recorded activity yet.</div>';
    }

    // Deliverables history HTML
    let submissionsHtml = '';
    if (task.submissions && task.submissions.length > 0) {
      submissionsHtml = task.submissions.map((sub, idx) => `
        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; padding:14px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge" style="background:#E0E7FF; color:#3730A3; font-size:0.7rem;">Deliverable #${idx + 1}</span>
              <span style="font-size:0.75rem; color:#64748B;">${new Date(sub.submittedAt).toLocaleString()}</span>
            </div>
            <span class="badge ${getStatusBadgeClass(sub.status)}" style="font-size:0.7rem;">${sub.status}</span>
          </div>
          <p style="font-size:0.82rem; color:#334155; margin-bottom:10px; line-height:1.45;">${escapeHtml(sub.comments || 'No submission comment.')}</p>
          ${sub.file ? `
            <div style="display:flex; align-items:center; justify-content:space-between; background:#F1F5F9; border-radius:6px; padding:8px 12px; margin-bottom:6px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span style="font-size:0.8rem; font-weight:600; color:var(--navy-dark);">${sub.file.name}</span>
                <span style="font-size:0.7rem; color:#64748B;">(${sub.file.size})</span>
              </div>
              <a href="${sub.file.url || sub.file.dataBase64}" download="${sub.file.name}" target="_blank" class="btn btn-ghost btn-sm" style="font-size:0.72rem; color:var(--royal-blue); font-weight:700;">
                Download
              </a>
            </div>
          ` : ''}
          ${sub.review ? `
            <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:6px; padding:10px 12px; margin-top:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.76rem; font-weight:700; color:#92400E;">Admin Feedback & Rating:</span>
                <span style="color:#D97706; font-size:0.76rem;">${'★'.repeat(sub.review.rating || 5)}</span>
              </div>
              <div style="font-size:0.78rem; color:#78350F; margin-top:4px;">"${escapeHtml(sub.review.feedback)}"</div>
              <div style="font-size:0.68rem; color:#B45309; margin-top:2px;">Reviewed by: ${escapeHtml(sub.review.reviewerName || 'Administrator')}</div>
            </div>
          ` : ''}
        </div>
      `).join('');
    } else {
      submissionsHtml = '<div style="font-size:0.8rem; color:#94A3B8; font-style:italic; padding:8px 0;">No deliverables submitted yet for this task.</div>';
    }

    contentEl.innerHTML = `
      <!-- Task Meta Card -->
      <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:18px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div>
            ${projectName ? `<div style="font-size:0.75rem; font-weight:700; color:var(--royal-blue); margin-bottom:2px;">📁 Project: ${escapeHtml(projectName)}</div>` : ''}
            <h3 style="font-family:var(--font-serif); font-size:1.15rem; font-weight:700; color:var(--navy-dark); margin-bottom:4px;">${escapeHtml(task.title)}</h3>
            <div style="display:flex; gap:12px; font-size:0.78rem; color:#64748B; flex-wrap:wrap;">
              <span><strong>Assigned Staff:</strong> <span style="color:var(--navy-dark); font-weight:700;">${escapeHtml(staffNames)}</span></span>
              <span><strong>Start Date:</strong> ${WorkPulseDB.formatDisplayDate(task.startDate || task.assignedDate) || 'N/A'}</span>
              <span style="${isOverdue ? 'color:#DC2626; font-weight:700;' : ''}"><strong>Due Date:</strong> ${WorkPulseDB.formatDisplayDate(task.dueDate) || 'Ongoing'}${isOverdue ? ' (Overdue)' : ''}</span>
            </div>
          </div>
          <div style="display:flex; gap:6px;">
            <span class="badge ${pClass}">${task.priority}</span>
            <span class="badge ${sClass}">${task.status}</span>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:0.76rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:4px;">Description / Instructions:</div>
          <div style="font-size:0.84rem; color:var(--navy-dark); line-height:1.5; white-space:pre-wrap;">${escapeHtml(task.description || 'No description provided.')}</div>
        </div>

        <div>
          <div style="font-size:0.76rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:6px;">Admin Reference Attachments:</div>
          ${adminAttachHtml}
        </div>
      </div>

      <!-- Section: Subtasks Management -->
      <div class="card p-3 mb-4" style="background:#FFFFFF; border:1px solid #E2E8F0;">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h4 style="font-size:0.92rem; font-weight:700; color:var(--navy-dark); margin:0;">
            ✓ Subtasks & Milestones (${subtasks.filter(s=>s.completed).length}/${subtasks.length})
          </h4>
        </div>
        <div id="staff-modal-subtasks-list" class="mb-3">
          ${subtasksHtml}
        </div>
        <div class="input-group">
          <input type="text" class="form-control form-control-sm" id="staff-input-new-subtask" placeholder="Add a new subtask or milestone item...">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-staff-add-subtask" style="font-weight:600;">Add Subtask</button>
        </div>
      </div>

      <!-- Section: Comments & Discussion -->
      <div class="card p-3 mb-4" style="background:#FFFFFF; border:1px solid #E2E8F0;">
        <h4 style="font-size:0.92rem; font-weight:700; color:var(--navy-dark); margin-bottom:12px;">
          💬 Comments & Discussion (${comments.length})
        </h4>
        <div id="staff-modal-comments-list" style="max-height:280px; overflow-y:auto; margin-bottom:12px;">
          ${commentsHtml}
        </div>
        <div>
          <textarea class="form-control form-control-sm mb-2" id="staff-input-comment-text" rows="2" placeholder="Write a comment or project update..."></textarea>
          <div class="text-end">
            <button type="button" class="btn btn-primary btn-sm" id="btn-staff-post-comment" style="font-weight:600;">Post Comment</button>
          </div>
        </div>
      </div>

      <!-- Section: Activity Timeline History -->
      <div class="card p-3 mb-4" style="background:#FFFFFF; border:1px solid #E2E8F0;">
        <h4 style="font-size:0.92rem; font-weight:700; color:var(--navy-dark); margin-bottom:10px;">
          ⏱️ Task Activity History (${activity.length})
        </h4>
        <div style="max-height:180px; overflow-y:auto;">
          ${activityHtml}
        </div>
      </div>

      <!-- Section: Deliverables History -->
      <div style="margin-bottom:24px;">
        <h4 style="font-size:0.92rem; font-weight:700; color:var(--navy-dark); margin-bottom:10px; display:flex; align-items:center; gap:6px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Submitted Deliverables & Updates (${(task.submissions || []).length})</span>
        </h4>
        ${submissionsHtml}
      </div>

      <!-- Section: Submit Deliverable Form -->
      <div style="background:#FFFFFF; border:1.5px solid var(--border-color); border-radius:8px; padding:20px;">
        <h4 style="font-size:0.95rem; font-weight:700; color:var(--navy-dark); margin-bottom:4px;">Submit Deliverable / Request Executive Review</h4>
        <p style="font-size:0.76rem; color:#64748B; margin-bottom:16px;">Upload project deliverables, documentation, or completion updates for Admin evaluation.</p>

        <form id="form-staff-submit-deliverable">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label" for="task-submit-status" style="font-weight:600; font-size:0.78rem;">Task Status Update <span class="text-danger">*</span></label>
              <select class="form-control form-control-sm" id="task-submit-status" required>
                <option value="In Review" selected>In Review (Submit for Admin Review)</option>
                <option value="In Progress">In Progress (Milestone Progress)</option>
                <option value="Completed">Completed (Final Deliverable)</option>
                <option value="On Hold">On Hold</option>
              </select>
            </div>
            <div class="col-12">
              <label class="form-label" for="task-submit-comments" style="font-weight:600; font-size:0.78rem;">Deliverable Summary / Completion Notes <span class="text-danger">*</span></label>
              <textarea class="form-control form-control-sm" id="task-submit-comments" rows="3" required placeholder="Describe project deliverables submitted, summary of progress, or notes for the Admin..."></textarea>
            </div>
            <div class="col-12">
              <label class="form-label" style="font-weight:600; font-size:0.78rem;">Attach Deliverable File / Document</label>
              <div class="file-drop-zone" id="task-deliverable-dropzone" style="padding:16px; border:2px dashed var(--border-color); border-radius:6px; background:#F8FAFC; text-align:center; cursor:pointer;">
                <input type="file" id="task-deliverable-file-input" style="display:none;" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip">
                <div id="task-del-drop-idle">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  <div style="font-weight:600; font-size:0.8rem; color:var(--navy-dark); margin-top:4px;">Click or drag file to attach deliverable</div>
                  <div style="font-size:0.7rem; color:#64748B;">Supported: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, ZIP (Max 25MB)</div>
                </div>
                <div id="task-del-drop-preview" style="display:none; align-items:center; justify-content:space-between; background:#EFF6FF; border:1px solid #BFDBFE; border-radius:6px; padding:8px 12px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:1.1rem;">📄</span>
                    <div style="text-align:left;">
                      <div id="task-del-filename" style="font-weight:700; font-size:0.8rem; color:var(--navy-dark);">file.pdf</div>
                      <div id="task-del-filesize" style="font-size:0.7rem; color:#64748B;">0 KB</div>
                    </div>
                  </div>
                  <button type="button" class="btn btn-ghost btn-sm text-danger" id="btn-remove-task-del-file" style="padding:2px 6px;">&times;</button>
                </div>
              </div>
            </div>
            <div class="col-12 text-end" style="margin-top:14px;">
              <button type="button" class="btn btn-secondary btn-sm me-2" id="btn-cancel-task-detail-modal">Close</button>
              <button type="submit" class="btn btn-primary btn-sm" id="btn-submit-task-deliverable">
                <span>Submit Deliverable for Review</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    `;

    // 1. Wire subtask completion toggle
    contentEl.querySelectorAll('.staff-subtask-toggle').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        e.stopPropagation();
        const subId = chk.dataset.subtaskId;
        const isCompleted = chk.checked;
        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ completed: isCompleted, updatedBy: staff.name })
          });
        } catch (netErr) {}

        WorkPulseDB.toggleSubtask(taskId, subId, isCompleted, staff);
        showToast('Subtask milestone updated', 'success');
        openStaffTaskModal(taskId);
        renderStaffTasks();
        renderStaffKanban();
      });
    });

    // 2. Wire subtask details expand/collapse
    contentEl.querySelectorAll('.subtask-item-header').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        if (e.target.closest('input') || e.target.closest('button') || e.target.closest('select') || e.target.closest('a')) return;
        const subId = hdr.dataset.subtaskHeader;
        const pane = document.getElementById(`staff-subtask-pane-${subId}`);
        if (pane) pane.classList.toggle('open');
      });
    });

    contentEl.querySelectorAll('.btn-staff-toggle-subtask').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subId = btn.dataset.subtaskId;
        const pane = document.getElementById(`staff-subtask-pane-${subId}`);
        if (pane) {
          pane.classList.toggle('open');
          btn.textContent = pane.classList.contains('open') ? 'Details ▴' : 'Details ▾';
        }
      });
    });

    // 3. Wire subtask status select
    contentEl.querySelectorAll('.staff-subtask-status-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        const subId = sel.dataset.subtaskId;
        const newStatus = sel.value;
        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: newStatus, updatedBy: staff.name })
          });
        } catch (netErr) {}

        WorkPulseDB.updateSubtask(taskId, subId, { status: newStatus }, staff);
        showToast('Subtask status updated', 'success');
        openStaffTaskModal(taskId);
        renderStaffTasks();
        renderStaffKanban();
      });
    });

    // 4. Wire subtask progress slider
    contentEl.querySelectorAll('.staff-subtask-prog-slider').forEach(slider => {
      const subId = slider.dataset.subtaskId;
      const displayVal = document.getElementById(`staff-sub-prog-val-${subId}`);
      slider.addEventListener('input', () => {
        if (displayVal) displayVal.textContent = `${slider.value}%`;
      });
    });

    contentEl.querySelectorAll('.btn-staff-save-sub-prog').forEach(btn => {
      btn.addEventListener('click', async () => {
        const subId = btn.dataset.subtaskId;
        const slider = contentEl.querySelector(`.staff-subtask-prog-slider[data-subtask-id="${subId}"]`);
        const progressVal = Number(slider?.value) || 0;

        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ progress: progressVal, updatedBy: staff.name })
          });
        } catch (netErr) {}

        WorkPulseDB.updateSubtask(taskId, subId, { progress: progressVal }, staff);
        showToast(`Subtask progress saved: ${progressVal}%`, 'success');
        openStaffTaskModal(taskId);
        renderStaffTasks();
        renderStaffKanban();
      });
    });

    // 5. Wire subtask sub-tabs switcher
    contentEl.querySelectorAll('.subtask-tab-btn[data-staff-sub-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subId = tabBtn.dataset.subtaskId;
        const tabName = tabBtn.dataset.staffSubTab;
        const pane = document.getElementById(`staff-subtask-pane-${subId}`);
        if (!pane) return;

        pane.querySelectorAll('.subtask-tab-btn').forEach(b => b.classList.remove('active'));
        pane.querySelectorAll('.subtask-tab-panel').forEach(p => p.classList.remove('active'));

        tabBtn.classList.add('active');
        const targetPanel = document.getElementById(`staff-subtask-tab-${tabName}-${subId}`);
        if (targetPanel) targetPanel.classList.add('active');
      });
    });

    // 6. Wire subtask comment submission
    contentEl.querySelectorAll('.staff-subtask-add-comment-form').forEach(cForm => {
      cForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const subId = cForm.dataset.subtaskId;
        const input = cForm.querySelector('.staff-subtask-comment-input');
        const text = input ? input.value.trim() : '';
        if (!text) return;

        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subId}/comments`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ text, authorName: staff.name, authorRole: 'Staff' })
          });
        } catch (netErr) {}

        WorkPulseDB.addSubtaskComment(taskId, subId, { text, authorName: staff.name, authorRole: 'Staff' }, staff);
        showToast('Subtask comment added', 'success');
        openStaffTaskModal(taskId);
      });
    });

    // 7. Wire subtask attachment upload
    contentEl.querySelectorAll('.btn-staff-upload-subtask-att').forEach(btn => {
      btn.addEventListener('click', () => {
        const subId = btn.dataset.subtaskId;
        const fileInput = contentEl.querySelector(`.staff-subtask-file-input[data-subtask-id="${subId}"]`);
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
          return showToast('Please select a file to upload', 'warning');
        }
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const dataBase64 = ev.target.result;
          const sizeKb = Math.round(file.size / 1024);
          const sizeStr = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

          const payload = {
            name: file.name,
            size: sizeStr,
            dataBase64,
            uploadedBy: staff.name
          };

          try {
            await fetch(`/api/tasks/${taskId}/subtasks/${subId}/attachments`, {
              method: 'POST',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(payload)
            });
          } catch (netErr) {}

          WorkPulseDB.addSubtaskAttachment(taskId, subId, payload, staff);
          showToast('File attached to subtask', 'success');
          openStaffTaskModal(taskId);
        };
        reader.readAsDataURL(file);
      });
    });

    // 8. Wire add new subtask button
    const btnAddSub = contentEl.querySelector('#btn-staff-add-subtask');
    const inputSub = contentEl.querySelector('#staff-input-new-subtask');
    if (btnAddSub && inputSub) {
      btnAddSub.addEventListener('click', async () => {
        const title = inputSub.value.trim();
        if (!title) return;
        const subData = {
          title,
          assignedStaffId: staff.id,
          assignedStaffName: staff.name,
          startDate: todayStr,
          dueDate: task.dueDate || '',
          priority: 'Medium',
          status: 'To Do',
          progress: 0
        };

        try {
          await fetch(`/api/tasks/${taskId}/subtasks`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(subData)
          });
        } catch (netErr) {}

        WorkPulseDB.addSubtask(taskId, subData, staff);
        showToast('Subtask added', 'success');
        openStaffTaskModal(taskId);
        renderStaffTasks();
        renderStaffKanban();
      });
    }

    // Wire post comment button
    const btnPostComment = contentEl.querySelector('#btn-staff-post-comment');
    const inputComment = contentEl.querySelector('#staff-input-comment-text');
    if (btnPostComment && inputComment) {
      btnPostComment.addEventListener('click', async () => {
        const text = inputComment.value.trim();
        if (!text) return;
        try {
          await fetch(`/api/tasks/${taskId}/comments`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ text, authorName: staff.name, authorRole: 'Staff' })
          });
        } catch (netErr) {
          console.warn('Comment post fallback:', netErr);
        }
        WorkPulseDB.addTaskComment(taskId, text, staff.name, 'Staff');
        showToast('Discussion comment posted', 'success');
        openStaffTaskModal(taskId);
      });
    }

    // Wire deliverable file input
    const dropzone = contentEl.querySelector('#task-deliverable-dropzone');
    const fileInput = contentEl.querySelector('#task-deliverable-file-input');
    const idlePrompt = contentEl.querySelector('#task-del-drop-idle');
    const previewWrap = contentEl.querySelector('#task-del-drop-preview');
    const nameEl = contentEl.querySelector('#task-del-filename');
    const sizeEl = contentEl.querySelector('#task-del-filesize');
    const btnRemove = contentEl.querySelector('#btn-remove-task-del-file');

    function resetDeliverableFile() {
      currentTaskDeliverableFile = null;
      if (fileInput) fileInput.value = '';
      if (previewWrap) previewWrap.style.display = 'none';
      if (idlePrompt) idlePrompt.style.display = 'block';
    }

    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        resetDeliverableFile();
      });
    }

    const allowedExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.zip'];

    function handleFile(file) {
      if (!file) return;
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!allowedExts.includes(ext)) {
        showToast('Invalid file type. Allowed formats: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, ZIP', 'error');
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        showToast('File size exceeds the 25MB limit. Please upload a smaller file.', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (ev) => {
        let serverUrl = null;
        try {
          const upRes = await fetch('/api/upload', {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              fileName: file.name,
              fileType: file.type || 'application/octet-stream',
              dataBase64: ev.target.result
            })
          });
          const upJson = await upRes.json();
          if (upJson.success && upJson.url) {
            serverUrl = upJson.url;
          }
        } catch (netErr) {
          console.warn('File upload fallback:', netErr);
        }

        currentTaskDeliverableFile = {
          name: file.name,
          size: formatFileSize(file.size),
          type: file.type || 'application/octet-stream',
          url: serverUrl,
          dataBase64: ev.target.result
        };

        if (idlePrompt) idlePrompt.style.display = 'none';
        if (previewWrap) {
          previewWrap.style.display = 'flex';
          if (nameEl) nameEl.textContent = file.name;
          if (sizeEl) sizeEl.textContent = formatFileSize(file.size);
        }
        showToast(`Attached deliverable: ${file.name}`, 'info');
      };
      reader.onerror = () => {
        showToast('Failed to read file.', 'error');
      };
      reader.readAsDataURL(file);
    }

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', (e) => {
        if (e.target.closest('#btn-remove-task-del-file')) return;
        fileInput.click();
      });
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--royal-blue)';
        dropzone.style.background = '#EFF6FF';
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = 'var(--border-color)';
        dropzone.style.background = '#F8FAFC';
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--border-color)';
        dropzone.style.background = '#F8FAFC';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFile(e.dataTransfer.files[0]);
        }
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleFile(e.target.files[0]);
        }
      });
    }

    // Handle deliverable form submit
    const delForm = contentEl.querySelector('#form-staff-submit-deliverable');
    if (delForm) {
      delForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newStatus = contentEl.querySelector('#task-submit-status').value;
        const comments = contentEl.querySelector('#task-submit-comments').value.trim();

        if (!comments) {
          showToast('Please enter submission notes or report comments.', 'error');
          return;
        }

        const submissionData = {
          status: newStatus,
          comments,
          file: currentTaskDeliverableFile
        };

        try {
          const resp = await fetch(`/api/tasks/${taskId}/submissions`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(submissionData)
          });
          const json = await resp.json();
          if (!resp.ok) {
            showToast(json.error || 'Failed to submit deliverable.', 'error');
            return;
          }
        } catch (netErr) {
          console.warn('Network task submission fallback:', netErr);
        }

        WorkPulseDB.submitTaskDeliverable(taskId, submissionData, staff.name);
        showToast('Deliverable submitted to Admin for Review!', 'success');
        openStaffTaskModal(taskId); // Refresh view
        renderStaffTasks();
        renderStaffKanban();
      });
    }

    const btnCancel = contentEl.querySelector('#btn-cancel-task-detail-modal');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        taskDetailModal.classList.remove('open');
      });
    }

    taskDetailModal.classList.add('open');
  }

  if (btnCloseTaskModal) {
    btnCloseTaskModal.addEventListener('click', () => {
      if (taskDetailModal) taskDetailModal.classList.remove('open');
    });
  }

  // Filter pills in My Work
  const filterPillsContainer = document.getElementById('task-filter-pills');
  if (filterPillsContainer) {
    filterPillsContainer.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        filterPillsContainer.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTaskFilter = btn.dataset.filter;
        renderStaffTasks();
      });
    });
  }

  // --- TAB 2: DAILY REPORT & FILE UPLOADS ---
  function populateReportTaskSelect() {
    if (!reportRelatedTaskSelect) return;
    const tasks = WorkPulseDB.getTasks({ staffId: staff.id });
    reportRelatedTaskSelect.innerHTML = '<option value="">-- None / General Work --</option>' + tasks.map(t => `
      <option value="${t.id}">${t.title} (${t.status})</option>
    `).join('');
  }

  if (reportRelatedTaskSelect) {
    reportRelatedTaskSelect.addEventListener('change', () => {
      const selectedTaskId = reportRelatedTaskSelect.value;
      if (selectedTaskId) {
        const task = (WorkPulseDB.getTasks({ staffId: staff.id }) || []).find(t => t.id === selectedTaskId);
        if (task) {
          const titleInput = document.getElementById('report-project-title');
          if (titleInput && (!titleInput.value || titleInput.value.trim() === '')) {
            titleInput.value = task.projectTitle || task.title;
          }
        }
      }
    });
  }

  // File Dropzone Handlers
  if (reportDropzone && reportFileInput) {
    reportDropzone.addEventListener('click', (e) => {
      if (e.target.id === 'btn-remove-attached-file') return;
      reportFileInput.click();
    });

    reportDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      reportDropzone.classList.add('dragover');
    });

    reportDropzone.addEventListener('dragleave', () => {
      reportDropzone.classList.remove('dragover');
    });

    reportDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      reportDropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleSelectedReportFile(e.dataTransfer.files[0]);
      }
    });

    reportFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleSelectedReportFile(e.target.files[0]);
      }
    });
  }

  function handleSelectedReportFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('File size exceeds 10MB limit. Please upload a smaller file.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      let fileUrl = null;
      try {
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            fileName: file.name,
            fileType: file.type || 'application/octet-stream',
            dataBase64: e.target.result
          })
        });
        const uploadJson = await uploadRes.json();
        if (uploadJson && uploadJson.success && uploadJson.url) {
          fileUrl = uploadJson.url;
        }
      } catch (err) {
        console.warn('Persistent report file upload fallback:', err);
      }

      attachedDailyReportFile = {
        name: file.name,
        size: formatFileSize(file.size),
        type: file.type || 'application/octet-stream',
        url: fileUrl,
        dataBase64: e.target.result
      };

      if (dropzoneIdle) dropzoneIdle.style.display = 'none';
      if (dropzonePreview) {
        dropzonePreview.style.display = 'flex';
        if (selectedFileName) selectedFileName.textContent = file.name;
        if (selectedFileSize) selectedFileSize.textContent = formatFileSize(file.size);
      }
      showToast(`Attached file: ${file.name}`, 'info');
    };
    reader.onerror = () => {
      showToast('Failed to read selected file.', 'error');
    };
    reader.readAsDataURL(file);
  }

  function clearAttachedReportFile() {
    attachedDailyReportFile = null;
    if (reportFileInput) reportFileInput.value = '';
    if (dropzoneIdle) dropzoneIdle.style.display = 'block';
    if (dropzonePreview) dropzonePreview.style.display = 'none';
  }

  if (btnRemoveFile) {
    btnRemoveFile.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAttachedReportFile();
      showToast('Attachment removed.', 'info');
    });
  }

  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Daily Report Form Submit
  if (dailyReportForm) {
    dailyReportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projectTitle = document.getElementById('report-project-title').value.trim();
      const date = document.getElementById('report-date').value;
      const workStatus = document.getElementById('report-status').value;
      const taskId = document.getElementById('report-related-task').value || null;
      const description = document.getElementById('report-description').value.trim();

      if (!projectTitle || !date || !description) {
        showToast('Please fill out all required fields.', 'error');
        return;
      }

      const submitBtn = document.getElementById('btn-submit-daily-report');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Submitting Report...</span>';
      }

      // Resolve task title if linked
      let taskTitle = '';
      let projectId = null;
      if (taskId) {
        const task = (WorkPulseDB.getTasks({ staffId: staff.id }) || []).find(t => t.id === taskId);
        if (task) {
          taskTitle = task.title;
          projectId = task.projectId || null;
        }
      }

      const reportPayload = {
        staffId: staff.id,
        staffName: staff.name,
        projectId,
        projectTitle,
        taskId,
        taskTitle,
        date,
        workStatus,
        description,
        file: attachedDailyReportFile
      };

      try {
        const token = WorkPulseDB.getToken();
        const resp = await fetch('/api/reports', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify(reportPayload)
        });
        const resJson = await resp.json();
        if (resJson && resJson.success && resJson.data) {
          WorkPulseDB.submitDailyReport(resJson.data);
        } else {
          WorkPulseDB.submitDailyReport(reportPayload);
        }
      } catch (err) {
        console.warn('Backend report submit fallback:', err);
        WorkPulseDB.submitDailyReport(reportPayload);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Submit Daily Work Report</span>';
        }
      }

      dailyReportForm.reset();
      clearAttachedReportFile();
      showToast('Daily work report and deliverables submitted to Admin for review!', 'success');
      renderStaffDailyReports();
      renderStaffReviews();
    });
  }

  // --- RENDER SUBMITTED DAILY REPORTS (STAFF) ---
  let isFetchingStaffReports = false;
  async function fetchAndSyncStaffReports() {
    if (isFetchingStaffReports) return;
    isFetchingStaffReports = true;
    try {
      const token = WorkPulseDB.getToken();
      const resp = await fetch('/api/reports', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const resJson = await resp.json();
      if (resJson && resJson.success && Array.isArray(resJson.data)) {
        const db = WorkPulseDB.load();
        if (!Array.isArray(db.dailyReports)) db.dailyReports = [];
        resJson.data.forEach(r => {
          const idx = db.dailyReports.findIndex(x => x.id === r.id);
          if (idx >= 0) db.dailyReports[idx] = r;
          else db.dailyReports.push(r);
        });
        WorkPulseDB.save(db);
      }
    } catch (err) {
      console.warn('Failed to sync staff reports:', err);
    } finally {
      isFetchingStaffReports = false;
      renderStaffDailyReportsUI();
      renderStaffReviewsUI();
    }
  }

  function renderStaffDailyReports() {
    renderStaffDailyReportsUI();
    fetchAndSyncStaffReports();
  }

  function renderStaffDailyReportsUI() {
    const tbody = document.getElementById('staff-reports-tbody') || document.getElementById('my-reports-tbody');
    if (!tbody) return;

    const reports = WorkPulseDB.getDailyReports({ staffId: staff.id });

    if (reports.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="padding: 36px 16px; text-align: center; background: #F8FAFC;">
            <div style="font-weight: 700; color: var(--navy-dark); font-size: 0.9rem; margin-bottom: 4px;">No Daily Reports Submitted Yet</div>
            <div style="font-size: 0.74rem; color: #64748B;">Fill out the form on the left to submit your project progress and deliverables to Admin.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = reports.map(r => {
      let fileCell = '<span style="color:#94A3B8; font-size:0.75rem;">None</span>';
      if (r.file) {
        fileCell = `
          <a href="${r.file.url || r.file.dataBase64}" download="${r.file.name}" class="btn btn-ghost btn-sm" style="font-size:0.72rem; padding:2px 6px; color:var(--royal-blue); display:inline-flex; align-items:center; gap:3px;" title="Download ${r.file.name} (${r.file.size})">
            📎 <span>${r.file.name.length > 12 ? r.file.name.substring(0, 10) + '...' : r.file.name}</span>
          </a>
        `;
      }

      let reviewCell = '<span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.7rem; font-weight:600;">Pending Review</span>';
      if (r.review) {
        const rev = r.review;
        const decision = rev.decision || 'Approved';
        const stars = '★'.repeat(rev.rating || 5);
        let badgeStyle = 'background:#ECFDF5; color:#047857;';
        if (decision === 'Needs Revision') badgeStyle = 'background:#FFFBEB; color:#B45309;';
        else if (decision === 'Rejected') badgeStyle = 'background:#FEF2F2; color:#B91C1C;';

        reviewCell = `
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
            <span class="badge" style="${badgeStyle} font-size:0.7rem; font-weight:700;" title="${rev.feedback || ''}">
              ${decision}
            </span>
            <span style="color:#D97706; font-size:0.72rem;">${stars}</span>
          </div>
        `;
      }

      let statusBadge = '';
      if (r.workStatus === 'Completed') statusBadge = '<span class="badge badge-present" style="font-size:0.7rem;">Completed</span>';
      else if (r.workStatus === 'Blocked') statusBadge = '<span class="badge badge-leave" style="font-size:0.7rem;">Blocked</span>';
      else if (r.workStatus === 'On Track') statusBadge = '<span class="badge" style="background:#EFF6FF; color:#1D4ED8; font-size:0.7rem;">On Track</span>';
      else statusBadge = `<span class="badge badge-wfh" style="font-size:0.7rem;">${r.workStatus}</span>`;

      let taskSnippet = '';
      if (r.taskTitle || r.taskId) {
        taskSnippet = `<div style="font-size:0.72rem; color:#4338CA; font-weight:600; margin-top:1px;">📋 ${r.taskTitle || r.taskId}</div>`;
      }

      return `
        <tr>
          <td style="font-weight:600; color:var(--navy-dark); font-size:0.78rem;">${WorkPulseDB.formatDisplayDate(r.date)}</td>
          <td>
            <div style="font-weight:700; color:var(--navy-dark); font-size:0.82rem;">${r.projectTitle}</div>
            ${taskSnippet}
            <div style="font-size:0.74rem; color:#64748B; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;">${r.description}</div>
          </td>
          <td class="text-center">${statusBadge}</td>
          <td>${fileCell}</td>
          <td class="text-end">${reviewCell}</td>
        </tr>
      `;
    }).join('');
  }

  // --- TAB 3: MY DAILY WORKS REVIEWS (STAFF) ---
  function renderStaffReviews() {
    renderStaffReviewsUI();
    fetchAndSyncStaffReports();
  }

  function renderStaffReviewsUI() {
    const container = document.getElementById('staff-reviews-stream-grid') || document.getElementById('staff-reviews-stream');
    const counter = document.getElementById('badge-my-reviews') || document.getElementById('counter-my-reviews');
    if (!container) return;

    const reports = WorkPulseDB.getDailyReports({ staffId: staff.id });
    const reviewedReports = reports.filter(r => r.review);

    if (counter) counter.textContent = reviewedReports.length;

    if (reviewedReports.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 24px; text-align: center; background: #F8FAFC; border-radius: 8px; border: 1px dashed #CBD5E1;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: #EFF6FF; color: var(--royal-blue); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          </div>
          <div style="font-weight: 700; color: var(--navy-dark); font-size: 1rem; margin-bottom: 4px;">No Daily Works Reviews Yet</div>
          <div style="font-size: 0.82rem; color: #64748B; max-width: 460px; margin: 0 auto; line-height: 1.5;">When executive management reviews your submitted daily work reports, tasks, and project deliverables, their formal evaluations, star ratings, and strategic feedback will appear here.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = reviewedReports.map(r => {
      const rev = r.review;
      const decision = rev.decision || 'Approved';
      const rating = rev.rating || 5;
      const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);

      let decisionBadge = '<span class="badge" style="background:#ECFDF5; color:#047857; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:4px;">✅ Approved</span>';
      if (decision === 'Needs Revision') {
        decisionBadge = '<span class="badge" style="background:#FFFBEB; color:#B45309; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:4px;">⚠️ Needs Revision</span>';
      } else if (decision === 'Rejected') {
        decisionBadge = '<span class="badge" style="background:#FEF2F2; color:#B91C1C; font-weight:700; font-size:0.75rem; padding:3px 8px; border-radius:4px;">❌ Rejected</span>';
      }

      let deliverableHtml = '';
      if (r.file) {
        deliverableHtml = `
          <div style="margin-top: 10px; padding: 8px 12px; background: #F1F5F9; border-radius: 6px; font-size: 0.76rem; display: inline-flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--royal-blue);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            <span style="color:#475569;">Reviewed Deliverable:</span>
            <a href="${r.file.url || r.file.dataBase64}" download="${r.file.name}" style="color:var(--royal-blue); font-weight:700; text-decoration:underline;">
              ${r.file.name}
            </a>
            <span style="color:#94A3B8;">(${r.file.size || 'File'})</span>
          </div>
        `;
      }

      return `
        <div class="staff-review-card" style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; padding:20px; border-left:4px solid ${decision === 'Approved' ? '#059669' : (decision === 'Needs Revision' ? '#D97706' : '#DC2626')}; box-shadow:0 1px 3px rgba(15,23,42,0.04);">
          <div class="review-card-head" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
            <div>
              <div class="review-project-name" style="font-size:0.95rem; font-weight:700; color:var(--navy-dark);">${r.projectTitle}</div>
              ${r.taskTitle || r.taskId ? `<div style="font-size:0.74rem; color:#4338CA; font-weight:600; margin-top:2px;">📋 Task: ${r.taskTitle || r.taskId}</div>` : ''}
              <div style="font-size:0.72rem; color:#64748B; margin-top:2px;">Report Date: <strong>${WorkPulseDB.formatDisplayDate(r.date)}</strong> ${r.submittedAt ? '• ' + r.submittedAt : ''}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
              ${decisionBadge}
              <div class="review-stars" style="color:#D97706; font-size:0.95rem; letter-spacing:2px;" title="${rating} out of 5 stars">${stars}</div>
            </div>
          </div>

          <div style="font-size:0.76rem; color:#475569; margin-bottom:10px; background:#F8FAFC; padding:8px 12px; border-radius:4px; border:1px solid #E2E8F0;">
            <strong style="color:var(--navy-dark);">Work Accomplished:</strong> ${r.description}
          </div>

          <div class="review-feedback-bubble" style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:6px; padding:12px 14px; font-size:0.84rem; color:#92400E; line-height:1.5; margin-bottom:12px; font-style:italic;">
            "${rev.feedback || rev.comments || 'No comments provided.'}"
          </div>

          ${deliverableHtml}

          <div class="review-author-foot" style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; color:#64748B; margin-top:12px; padding-top:10px; border-top:1px solid #F1F5F9;">
            <span>Reviewer: <strong style="color:var(--navy-dark);">${rev.reviewerName || 'Administrator'}</strong></span>
            <span>Reviewed: <strong>${WorkPulseDB.formatDisplayDate(rev.reviewedAt || rev.reviewDate) || ''}</strong></span>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- MEETINGS & BRIEFINGS SECTION ---
  function renderStaffMeetings() {
    const grid = document.getElementById('staff-meetings-cards-grid') || document.getElementById('staff-meetings-grid');
    if (!grid) return;

    const meetings = WorkPulseDB.getMeetings({ staffId: staff.id });

    let filtered = meetings;
    if (activeMeetingFilter === 'upcoming') {
      filtered = meetings.filter(m => {
        const dyn = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function') ? WorkPulseDB.getMeetingDynamicStatus(m) : 'Upcoming';
        return dyn === 'Upcoming' || dyn === 'Ongoing';
      });
    } else if (activeMeetingFilter === 'past') {
      filtered = meetings.filter(m => {
        const dyn = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function') ? WorkPulseDB.getMeetingDynamicStatus(m) : 'Completed';
        return dyn === 'Completed' || dyn === 'Cancelled';
      });
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 36px 16px; text-align: center; background: #F8FAFC; border-radius: var(--radius-sm); border: 1px dashed var(--border-color);">
          <div style="font-weight: 700; color: var(--navy-dark); font-size: 0.95rem; margin-bottom: 4px;">No meetings found</div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">No meetings scheduled under the "${activeMeetingFilter}" filter.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(m => {
      const dynStatus = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function') ? WorkPulseDB.getMeetingDynamicStatus(m) : (m.status || 'Upcoming');
      const isUrl = m.venue && (m.venue.startsWith('http://') || m.venue.startsWith('https://') || m.venue.includes('meet.google') || m.venue.includes('zoom.us') || m.venue.includes('teams.microsoft'));
      
      let venueHtml = `<span>📍 ${m.venue || 'Corporate HQ'}</span>`;
      if (isUrl) {
        venueHtml = `
          <a href="${m.venue}" target="_blank" rel="noopener noreferrer" style="color:var(--royal-blue); font-weight:700; text-decoration:none; display:flex; align-items:center; gap:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l5 5-5 5"></path><path d="M4 4v7a4 4 0 0 0 4 4h12"></path></svg>
            <span>Join Video Conference (${m.venue.length > 28 ? m.venue.substring(0, 25) + '...' : m.venue})</span>
          </a>
        `;
      }

      let statusBadge = '<span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.65rem; padding:2px 6px;">Completed</span>';
      if (dynStatus === 'Upcoming') {
        statusBadge = '<span class="badge" style="background:#DCFCE7; color:#166534; font-size:0.65rem; padding:2px 6px;">Upcoming</span>';
      } else if (dynStatus === 'Ongoing') {
        statusBadge = '<span class="badge" style="background:#FEF3C7; color:#92400E; font-size:0.65rem; padding:2px 6px; font-weight:700; border:1px solid #F59E0B;">● Ongoing</span>';
      } else if (dynStatus === 'Cancelled') {
        statusBadge = '<span class="badge badge-leave" style="font-size:0.65rem; padding:2px 6px;">Cancelled</span>';
      }

      return `
        <div class="staff-meeting-card ${dynStatus === 'Upcoming' || dynStatus === 'Ongoing' ? 'upcoming' : 'past'}">
          <div>
            <div class="meeting-card-datetime">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>${WorkPulseDB.formatDisplayDate(m.date)} at ${m.time} (${m.durationMinutes || 60}m)</span>
              ${statusBadge}
            </div>
            <h3 class="meeting-card-title">${m.title}</h3>
            <p class="meeting-card-desc">${m.description || 'Corporate briefing.'}</p>
            <div class="meeting-card-venue">${venueHtml}</div>
          </div>
          <div class="meeting-card-foot">
            <span>Organizer: <strong>${m.organizer || 'Administrator (Admin)'}</strong></span>
            <span>Attendees: ${m.attendees === 'all' ? 'All Staff' : 'Selected Team'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Meeting Filter Buttons
  ['btn-filter-meetings-upcoming', 'btn-filter-meetings-past', 'btn-filter-meetings-all'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.meeting-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeMeetingFilter = btn.dataset.mfilter;
        renderStaffMeetings();
      });
    }
  });

  // ==========================================================================
  // TELECALLER: MY ASSIGNED LEADS & FOLLOW-UP LOGS
  // ==========================================================================
  let activeStaffLeadNotesId = null;
  let isFetchingStaffLeads = false;

  async function syncStaffLeadsFromServer() {
    if (isFetchingStaffLeads) return;
    isFetchingStaffLeads = true;
    try {
      const res = await fetch('/api/leads', {
        headers: WorkPulseDB.getAuthHeaders()
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          const db = WorkPulseDB.load();
          const currentStaffId = (staff && staff.id) ? staff.id : (WorkPulseDB.getSession()?.user?.id || '');
          const targetId = String(currentStaffId).trim().toUpperCase();
          const otherLeads = (db.leads || []).filter(l => String(l.assignedStaffId || '').trim().toUpperCase() !== targetId);
          db.leads = [...json.data, ...otherLeads];
          WorkPulseDB.save(db);
          renderStaffLeads(true);
        }
      }
    } catch (err) {
      console.warn('[Staff Leads] Error syncing from server:', err);
    } finally {
      isFetchingStaffLeads = false;
    }
  }

  function renderStaffLeads(skipBackgroundSync = false) {
    if (!skipBackgroundSync && !isFetchingStaffLeads) {
      syncStaffLeadsFromServer();
    }

    const tbody = document.getElementById('staff-leads-tbody');
    if (!tbody) return;

    const currentStaffId = (staff && staff.id) ? staff.id : (WorkPulseDB.getSession()?.user?.id || '');
    const allAssigned = WorkPulseDB.getLeads({ telecallerId: currentStaffId });

    // Update Counter in Tab
    const counterBadge = document.getElementById('counter-my-leads');
    if (counterBadge) counterBadge.textContent = allAssigned.length;

    // Summary KPIs
    const todayStr = new Date().toISOString().split('T')[0];
    const upcomingCount = allAssigned.filter(l => l.followUpDate && l.followUpDate >= todayStr && l.status !== 'Converted' && l.status !== 'Lost').length;
    const overdueCount = allAssigned.filter(l => l.followUpDate && l.followUpDate < todayStr && l.status !== 'Converted' && l.status !== 'Lost').length;
    const convertedCount = allAssigned.filter(l => l.status === 'Converted').length;
    const conversionPct = allAssigned.length > 0 ? ((convertedCount / allAssigned.length) * 100).toFixed(1) : 0;

    const kpiTotal = document.getElementById('staff-lead-kpi-total');
    const kpiUpcoming = document.getElementById('staff-lead-kpi-upcoming');
    const kpiOverdue = document.getElementById('staff-lead-kpi-overdue');
    const kpiConverted = document.getElementById('staff-lead-kpi-converted');
    const kpiConvertedSub = document.getElementById('staff-lead-kpi-converted-sub');

    if (kpiTotal) kpiTotal.textContent = allAssigned.length;
    if (kpiUpcoming) kpiUpcoming.textContent = upcomingCount;
    if (kpiOverdue) {
      kpiOverdue.textContent = overdueCount;
      if (overdueCount > 0) {
        kpiOverdue.style.animation = 'pulse-overdue 2s infinite';
      } else {
        kpiOverdue.style.animation = 'none';
      }
    }
    if (kpiConverted) kpiConverted.textContent = convertedCount;
    if (kpiConvertedSub) kpiConvertedSub.textContent = `${conversionPct}% conversion rate`;

    // Active filters
    const search = (document.getElementById('staff-lead-search-input')?.value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('staff-lead-filter-status')?.value || 'all';

    let filtered = allAssigned;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(l => (l.status || 'New') === statusFilter);
    }
    if (search) {
      filtered = filtered.filter(l => 
        (l.name && l.name.toLowerCase().includes(search)) ||
        (l.company && l.company.toLowerCase().includes(search)) ||
        (l.interestedService && l.interestedService.toLowerCase().includes(search)) ||
        (l.phone && l.phone.includes(search)) ||
        (l.email && l.email.toLowerCase().includes(search))
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 36px 16px; color: #94A3B8; font-size: 0.85rem;">
            No assigned leads match the current filters.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(lead => {
      const isOverdue = lead.followUpDate && lead.followUpDate < todayStr && lead.status !== 'Converted' && lead.status !== 'Lost';
      const isUpcoming = lead.followUpDate && lead.followUpDate >= todayStr && lead.status !== 'Converted' && lead.status !== 'Lost';

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--navy-dark); font-size: 0.84rem;">${escapeHtml(lead.name)}</div>
            <div style="font-size: 0.74rem; color: var(--royal-blue); font-weight: 600;">${escapeHtml(lead.company)}</div>
            <span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.65rem; margin-top: 2px;">Source: ${escapeHtml(lead.source || 'Website')}</span>
          </td>
          <td>
            <div style="font-size: 0.76rem; color: #334155;">📞 <a href="tel:${escapeHtml(lead.phone)}" style="color: inherit; text-decoration: none;">${escapeHtml(lead.phone || 'N/A')}</a></div>
            <div style="font-size: 0.74rem; color: #64748B;">✉️ <a href="mailto:${escapeHtml(lead.email)}" style="color: inherit; text-decoration: none;">${escapeHtml(lead.email || 'N/A')}</a></div>
          </td>
          <td>
            <div style="font-weight: 600; color: var(--navy-dark); font-size: 0.8rem;">${escapeHtml(lead.interestedService || 'General')}</div>
            <div style="font-size: 0.76rem; font-weight: 700; color: var(--gold-primary);">${(Number(lead.expectedAmount) || 0).toLocaleString()}</div>
          </td>
          <td>
            ${isOverdue ? `
              <span class="badge" style="background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; font-size: 0.7rem; font-weight: 700;">⚠️ Overdue: ${WorkPulseDB.formatDisplayDate(lead.followUpDate)}</span>
            ` : isUpcoming ? `
              <span class="badge" style="background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; font-size: 0.7rem;">📅 ${WorkPulseDB.formatDisplayDate(lead.followUpDate)} ${lead.followUpTime || ''}</span>
            ` : `
              <span style="font-size: 0.74rem; color: #64748B;">${WorkPulseDB.formatDisplayDate(lead.followUpDate) || '—'}</span>
            `}
          </td>
          <td class="text-center">
            ${getStaffLeadStatusBadge(lead.status)}
          </td>
          <td class="text-end">
            <button class="btn btn-primary btn-sm" style="font-size: 0.72rem; padding: 4px 10px;" onclick="window.openStaffLeadNotesModal('${lead.id}')">
              Call Log & Notes
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function getStaffLeadStatusBadge(status) {
    const s = status || 'New';
    const map = {
      'New': { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
      'Contacted': { bg: '#EEF2FF', text: '#4338CA', border: '#C7D2FE' },
      'Follow-up': { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
      'Interested': { bg: '#F5F3FF', text: '#6D28D9', border: '#DDD6FE' },
      'Converted': { bg: '#ECFDF5', text: '#047857', border: '#A7F3D0' },
      'Lost': { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' }
    };
    const c = map[s] || { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' };
    return `<span class="badge" style="background:${c.bg}; color:${c.text}; border:1px solid ${c.border}; font-size:0.72rem; font-weight:700;">${escapeHtml(s)}</span>`;
  }

  function openStaffLeadNotesModal(leadId) {
    activeStaffLeadNotesId = leadId;
    const lead = WorkPulseDB.getLeadById(leadId);
    if (!lead) return;

    const modal = document.getElementById('staff-lead-notes-modal');
    const content = document.getElementById('staff-lead-notes-modal-content');
    if (!modal || !content) return;

    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    const today = new Date().toISOString().split('T')[0];
    const isOverdue = lead.followUpDate && lead.followUpDate < today && lead.status !== 'Converted' && lead.status !== 'Lost';

    content.innerHTML = `
      <!-- Lead Summary Header -->
      <div style="background: #F8FAFC; border: 1px solid var(--border-color); border-radius: 10px; padding: 18px; margin-bottom: 20px;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--navy-dark); margin: 0;">${escapeHtml(lead.name)}</h3>
              ${getStaffLeadStatusBadge(lead.status)}
              ${isOverdue ? `<span class="badge" style="background:#FEF2F2; color:#DC2626; border:1px solid #FECACA; font-size:0.68rem; font-weight:700;">OVERDUE CALL</span>` : ''}
            </div>
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--royal-blue); margin-top: 2px;">${escapeHtml(lead.company)}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size: 0.78rem; color: #475569;">
          <div><strong>📞 Phone:</strong> <a href="tel:${escapeHtml(lead.phone)}" style="color: inherit;">${escapeHtml(lead.phone || 'N/A')}</a></div>
          <div><strong>✉️ Email:</strong> <a href="mailto:${escapeHtml(lead.email)}" style="color: inherit;">${escapeHtml(lead.email || 'N/A')}</a></div>
          <div><strong>🎯 Interested Service:</strong> ${escapeHtml(lead.interestedService || 'General')}</div>
          <div><strong>💰 Expected Amount:</strong> ${(Number(lead.expectedAmount) || 0).toLocaleString()}</div>
          <div><strong>📅 Current Next Follow-up:</strong> ${WorkPulseDB.formatDisplayDate(lead.followUpDate) || 'None'} ${lead.followUpTime || ''}</div>
        </div>
      </div>

      <!-- Log Call Note Form -->
      <div class="card p-3 mb-4" style="border: 1px solid #E2E8F0; background: #FFFFFF; border-radius: 8px;">
        <h4 style="font-size: 0.85rem; font-weight: 700; color: var(--navy-dark); margin-bottom: 10px;">
          Record Follow-up Call / Note
        </h4>
        <form id="staff-lead-note-form">
          <div class="mb-3">
            <textarea class="form-control" id="staff-lead-note-text" rows="3" required placeholder="Describe conversation highlights, lead questions, client requirements, budget discussions..."></textarea>
          </div>
          <div class="row g-2 align-items-center">
            <div class="col-md-4">
              <label class="form-label" style="font-size: 0.72rem; margin-bottom: 2px;">Next Follow-up Date</label>
              <input type="date" class="form-control form-control-sm" id="staff-lead-next-date" value="${lead.followUpDate || ''}">
            </div>
            <div class="col-md-3">
              <label class="form-label" style="font-size: 0.72rem; margin-bottom: 2px;">Time</label>
              <input type="time" class="form-control form-control-sm" id="staff-lead-next-time" value="${lead.followUpTime || '11:00'}">
            </div>
            <div class="col-md-3">
              <label class="form-label" style="font-size: 0.72rem; margin-bottom: 2px;">Update Status</label>
              <select class="form-control form-control-sm" id="staff-lead-new-status">
                <option value="New" ${lead.status === 'New' ? 'selected' : ''}>New</option>
                <option value="Contacted" ${lead.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
                <option value="Follow-up" ${lead.status === 'Follow-up' ? 'selected' : ''}>Follow-up</option>
                <option value="Interested" ${lead.status === 'Interested' ? 'selected' : ''}>Interested</option>
                <option value="Converted" ${lead.status === 'Converted' ? 'selected' : ''}>Converted</option>
                <option value="Lost" ${lead.status === 'Lost' ? 'selected' : ''}>Lost</option>
              </select>
            </div>
            <div class="col-md-2" style="margin-top: 18px;">
              <button type="submit" class="btn btn-primary btn-sm w-100" style="font-size: 0.74rem;">Save Note</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Chronological Notes Feed -->
      <div>
        <h4 style="font-size: 0.85rem; font-weight: 700; color: var(--navy-dark); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span>Follow-up History (${notes.length})</span>
        </h4>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${notes.length === 0 ? `
            <div style="text-align: center; padding: 24px; color: #94A3B8; font-size: 0.82rem; background: #F8FAFC; border-radius: 8px;">
              No follow-up notes logged yet.
            </div>
          ` : notes.slice().reverse().map(n => `
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-left: 3px solid var(--royal-blue); border-radius: 6px; padding: 12px;">
              <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #64748B; margin-bottom: 6px;">
                <span style="font-weight: 700; color: var(--navy-dark);">👤 ${escapeHtml(n.author || 'Telecaller')}</span>
                <span>🕒 ${escapeHtml(n.timestamp || 'Recent')}</span>
              </div>
              <div style="font-size: 0.82rem; color: #334155; line-height: 1.45; white-space: pre-wrap;">${escapeHtml(n.text || n.note || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const noteForm = document.getElementById('staff-lead-note-form');
    if (noteForm) {
      noteForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = (document.getElementById('staff-lead-note-text')?.value || '').trim();
        const nextDate = document.getElementById('staff-lead-next-date')?.value || '';
        const nextTime = document.getElementById('staff-lead-next-time')?.value || '';
        const newStatus = document.getElementById('staff-lead-new-status')?.value || lead.status;

        if (!text) return;

        const authorName = (staff && staff.name) ? staff.name : 'Telecaller Staff';
        WorkPulseDB.addLeadNote(leadId, text, authorName, nextDate);
        if (newStatus && newStatus !== lead.status) {
          WorkPulseDB.updateLeadStatus(leadId, newStatus, authorName);
        }
        if (nextTime) {
          WorkPulseDB.updateLead(leadId, { followUpTime: nextTime }, authorName);
        }

        showToast('Follow-up call note recorded successfully!', 'success');
        openStaffLeadNotesModal(leadId);
        renderStaffLeads(true);

        fetch(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            note: text,
            nextFollowUpDate: nextDate,
            nextFollowUpTime: nextTime,
            status: newStatus
          })
        }).catch(err => console.warn('Failed to save staff lead note to server:', err));
      });
    }

    modal.classList.add('open');
  }

  function closeStaffLeadNotesModal() {
    document.getElementById('staff-lead-notes-modal')?.classList.remove('open');
  }

  window.openStaffLeadNotesModal = openStaffLeadNotesModal;
  document.getElementById('btn-close-staff-lead-notes')?.addEventListener('click', closeStaffLeadNotesModal);
  document.getElementById('staff-lead-search-input')?.addEventListener('input', () => renderStaffLeads());
  document.getElementById('staff-lead-filter-status')?.addEventListener('change', () => renderStaffLeads());

  function initWorkAndMeetingsModule() {
    renderStaffProjects();
    renderStaffKanban();
    renderStaffTasks();
    populateReportTaskSelect();
    renderStaffDailyReports();
    renderStaffReviews();
    renderStaffMeetings();
    renderStaffNotifications();
    renderStaffLeads();
    renderStaffMisc();
    checkMeetingAlert();
  }

  // --------------------------------------------------------------------------
  // 10.5 GENERAL & OFFICE SERVICES (STAFF MISCELLANEOUS MODULE)
  // --------------------------------------------------------------------------
  let staffMiscActiveSubtab = 'requests';
  let staffMiscCurrentDetailItem = null;

  function getStaffMiscPriorityPill(priority) {
    const p = (priority || 'medium').toLowerCase();
    let cls = 'standard';
    if (p.includes('urgent') || p.includes('critical')) cls = 'urgent';
    else if (p.includes('high')) cls = 'high';
    else if (p.includes('important')) cls = 'important';
    else if (p.includes('low')) cls = 'low';
    else if (p.includes('medium')) cls = 'medium';
    return `<span class="misc-pill-priority ${cls}"><span class="misc-prio-dot"></span>${escapeHtml(priority || 'Medium')}</span>`;
  }

  function getStaffMiscStatusBadge(status) {
    const raw = (status || 'active').toLowerCase().replace(/\s+/g, '-');
    return `<span class="misc-badge-status ${raw}"><span class="misc-status-dot"></span>${escapeHtml(status || 'Active')}</span>`;
  }

  function formatStaffMiscDate(dateVal) {
    if (!dateVal) return '—';
    return (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function')
      ? (WorkPulseDB.formatDisplayDate(dateVal) || '—')
      : '—';
  }

  function switchStaffMiscSubtab(subtabKey) {
    staffMiscActiveSubtab = subtabKey;

    document.querySelectorAll('[data-staff-subtab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.staffSubtab === subtabKey);
    });

    document.querySelectorAll('[data-staff-subtab-target]').forEach(card => {
      card.classList.toggle('active', card.dataset.staffSubtabTarget === subtabKey);
    });

    const panes = {
      requests: document.getElementById('staff-pane-requests'),
      assets: document.getElementById('staff-pane-assets'),
      maintenance: document.getElementById('staff-pane-maintenance'),
      notes: document.getElementById('staff-pane-notes'),
      documents: document.getElementById('staff-pane-documents')
    };

    Object.keys(panes).forEach(k => {
      const p = panes[k];
      if (!p) return;
      const match = k === subtabKey;
      p.classList.toggle('active', match);
      p.style.display = match ? 'block' : 'none';
    });

    renderStaffMisc();
  }

  function renderStaffMisc() {
    if (!currentStaffId) return;

    // 1. Fetch staff specific datasets
    const allRequests = (typeof WorkPulseDB.getGeneralRequests === 'function') 
      ? WorkPulseDB.getGeneralRequests({ staffId: currentStaffId }) 
      : [];
    const allAssets = (typeof WorkPulseDB.getOfficeAssets === 'function') 
      ? WorkPulseDB.getOfficeAssets({ staffId: currentStaffId }) 
      : [];
    const allMaint = (typeof WorkPulseDB.getMaintenanceIssues === 'function') 
      ? WorkPulseDB.getMaintenanceIssues({ staffId: currentStaffId }) 
      : [];
    const allNotes = (typeof WorkPulseDB.getInternalNotes === 'function') 
      ? WorkPulseDB.getInternalNotes({ staffId: currentStaffId }) 
      : [];
    const allDocs = (typeof WorkPulseDB.getGeneralDocuments === 'function') 
      ? WorkPulseDB.getGeneralDocuments({ staffId: currentStaffId }) 
      : [];

    const pendingReqs = allRequests.filter(r => r.status === 'Pending').length;
    const openMaint = allMaint.filter(m => m.status !== 'Resolved' && m.status !== 'Cancelled').length;
    const pinnedNotes = allNotes.filter(n => n.isPinned).length;

    // 2. Update KPI metrics
    const kpiReqs = document.getElementById('staff-misc-kpi-reqs');
    const kpiReqsSub = document.getElementById('staff-misc-kpi-reqs-sub');
    if (kpiReqs) kpiReqs.textContent = allRequests.length;
    if (kpiReqsSub) kpiReqsSub.textContent = `${pendingReqs} Pending Review`;

    const kpiAssets = document.getElementById('staff-misc-kpi-assets');
    if (kpiAssets) kpiAssets.textContent = allAssets.length;

    const kpiMaint = document.getElementById('staff-misc-kpi-maint');
    const kpiMaintSub = document.getElementById('staff-misc-kpi-maint-sub');
    if (kpiMaint) kpiMaint.textContent = allMaint.length;
    if (kpiMaintSub) kpiMaintSub.textContent = `${openMaint} Open Issues`;

    const kpiNotes = document.getElementById('staff-misc-kpi-notes');
    const kpiNotesSub = document.getElementById('staff-misc-kpi-notes-sub');
    if (kpiNotes) kpiNotes.textContent = allNotes.length;
    if (kpiNotesSub) kpiNotesSub.textContent = `${pinnedNotes} Pinned Memos`;

    const kpiDocs = document.getElementById('staff-misc-kpi-docs');
    if (kpiDocs) kpiDocs.textContent = allDocs.length;

    // 3. Update badges
    const bReqs = document.getElementById('staff-badge-requests');
    if (bReqs) bReqs.textContent = allRequests.length;
    const bAssets = document.getElementById('staff-badge-assets');
    if (bAssets) bAssets.textContent = allAssets.length;
    const bMaint = document.getElementById('staff-badge-maintenance');
    if (bMaint) bMaint.textContent = allMaint.length;
    const bNotes = document.getElementById('staff-badge-notes');
    if (bNotes) bNotes.textContent = allNotes.length;
    const bDocs = document.getElementById('staff-badge-documents');
    if (bDocs) bDocs.textContent = allDocs.length;

    const mainCounter = document.getElementById('counter-my-misc');
    if (mainCounter) mainCounter.textContent = pendingReqs + openMaint;

    // 4. Render Table: Requests
    const tbodyReqs = document.getElementById('staff-tbody-requests');
    if (tbodyReqs) {
      if (allRequests.length === 0) {
        tbodyReqs.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-5">
              <div class="misc-empty-state">
                <div class="misc-empty-icon" style="background: #FFFBEB; color: #B45309;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                </div>
                <div class="misc-empty-title">No Requests Submitted</div>
                <div class="misc-empty-desc">Need office supplies, hardware upgrades, software licenses, or administrative support? Click below to submit a request to administration.</div>
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('btn-staff-new-request').click()">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="me-1"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Submit Your First Request
                </button>
              </div>
            </td>
          </tr>
        `;
      } else {
        tbodyReqs.innerHTML = allRequests.map(r => {
          const cCount = (r.comments && r.comments.length) || 0;
          return `
            <tr>
              <td style="font-weight: 700; color: #1D5F8F; font-size: 0.82rem;"><code>${escapeHtml(r.id)}</code></td>
              <td>
                <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(r.title)}</div>
                <div style="font-size: 0.74rem; color: #64748B;">${escapeHtml(r.description || '')}</div>
              </td>
              <td><span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.72rem;">${escapeHtml(r.category || 'General')}</span></td>
              <td class="text-center">${getStaffMiscPriorityPill(r.priority)}</td>
              <td class="text-center">${getStaffMiscStatusBadge(r.status)}</td>
              <td><span style="font-size: 0.78rem; color: #64748B;">${formatStaffMiscDate(r.date)}</span></td>
              <td class="text-end">
                <button class="btn btn-outline-secondary btn-sm p-1 px-2" data-action="view-staff-misc-details" data-type="requests" data-id="${r.id}" title="View Details & Comments">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  ${cCount > 0 ? `<span class="badge bg-secondary ms-1" style="font-size: 0.65rem;">${cCount}</span>` : ''}
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 5. Render Table: Assets
    const tbodyAssets = document.getElementById('staff-tbody-assets');
    if (tbodyAssets) {
      if (allAssets.length === 0) {
        tbodyAssets.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-5">
              <div class="misc-empty-state">
                <div class="misc-empty-icon" style="background: #EFF6FF; color: #1D5F8F;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                </div>
                <div class="misc-empty-title">No Equipment Currently Assigned</div>
                <div class="misc-empty-desc">Company hardware, laptops, monitors, or accessories assigned to your staff profile will appear here once registered by Administration.</div>
              </div>
            </td>
          </tr>
        `;
      } else {
        tbodyAssets.innerHTML = allAssets.map(a => `
          <tr>
            <td style="font-weight: 700; color: #1D5F8F; font-size: 0.82rem;"><code>${escapeHtml(a.assetTag || a.id)}</code></td>
            <td>
              <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(a.title || a.name)}</div>
              <div style="font-size: 0.74rem; color: #64748B;">${escapeHtml(a.description || 'Assigned company hardware')}</div>
            </td>
            <td><span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.72rem;">${escapeHtml(a.category || 'Hardware')}</span></td>
            <td class="text-center">
              <span class="badge ${a.condition === 'Excellent' ? 'bg-success-subtle text-success' : 'bg-info-subtle text-info'}" style="font-size: 0.72rem;">
                ${escapeHtml(a.condition || 'Good')}
              </span>
            </td>
            <td><span style="font-size: 0.8rem; color: #1E293B;">${formatStaffMiscDate(a.date || a.assignedDate)}</span></td>
            <td><span style="font-size: 0.8rem; color: #64748B;">${formatStaffMiscDate(a.returnDate || a.expectedReturnDate)}</span></td>
            <td class="text-end">${getStaffMiscStatusBadge(a.status)}</td>
          </tr>
        `).join('');
      }
    }

    // 6. Render Table: Maintenance
    const tbodyMaint = document.getElementById('staff-tbody-maintenance');
    if (tbodyMaint) {
      if (allMaint.length === 0) {
        tbodyMaint.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-5">
              <div class="misc-empty-state">
                <div class="misc-empty-icon" style="background: #FEF2F2; color: #DC2626;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                </div>
                <div class="misc-empty-title">No Maintenance Issues Reported</div>
                <div class="misc-empty-desc">Notice a broken desk, leaking tap, lighting problem, or air conditioner issue in the office? Click below to log a maintenance ticket.</div>
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('btn-staff-report-maint').click()">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="me-1"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                  Report a Maintenance Issue
                </button>
              </div>
            </td>
          </tr>
        `;
      } else {
        tbodyMaint.innerHTML = allMaint.map(m => {
          const cCount = (m.comments && m.comments.length) || 0;
          return `
            <tr>
              <td style="font-weight: 700; color: #1D5F8F; font-size: 0.82rem;"><code>${escapeHtml(m.id)}</code></td>
              <td>
                <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(m.title)}</div>
                <div style="font-size: 0.74rem; color: #64748B;">📍 ${escapeHtml(m.location || 'Office area')}</div>
              </td>
              <td><span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.72rem;">${escapeHtml(m.category || 'Facility')}</span></td>
              <td class="text-center">${getStaffMiscPriorityPill(m.priority)}</td>
              <td><span style="font-size: 0.78rem; color: #64748B;">${formatStaffMiscDate(m.date || m.reportedDate)}</span></td>
              <td class="text-center">${getStaffMiscStatusBadge(m.status)}</td>
              <td class="text-end">
                <button class="btn btn-outline-secondary btn-sm p-1 px-2" data-action="view-staff-misc-details" data-type="maintenance" data-id="${m.id}" title="View Details & Comments">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  ${cCount > 0 ? `<span class="badge bg-secondary ms-1" style="font-size: 0.65rem;">${cCount}</span>` : ''}
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 7. Render Table: Internal Notes & Notices
    const tbodyNotes = document.getElementById('staff-tbody-notes');
    if (tbodyNotes) {
      if (allNotes.length === 0) {
        tbodyNotes.innerHTML = `
          <tr>
            <td colspan="6" class="text-center py-5">
              <div class="misc-empty-state">
                <div class="misc-empty-icon" style="background: #F5F3FF; color: #7C3AED;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </div>
                <div class="misc-empty-title">No Internal Notes or Memos</div>
                <div class="misc-empty-desc">Important company announcements, reminders, and executive notices will appear here once published by Administration.</div>
              </div>
            </td>
          </tr>
        `;
      } else {
        tbodyNotes.innerHTML = allNotes.map(n => `
          <tr>
            <td class="text-center">
              ${n.isPinned 
                ? `<span class="badge" style="background:#FEF3C7; color:#B45309; font-size:0.7rem; font-weight:700;">📌 Pinned</span>` 
                : `<span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.7rem;">Memo</span>`}
            </td>
            <td>
              <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(n.title)}</div>
              <div style="font-size: 0.74rem; color: #64748B; white-space: pre-wrap; max-width: 420px;">${escapeHtml(n.description || '')}</div>
            </td>
            <td><span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.72rem;">${escapeHtml(n.category || 'Announcement')}</span></td>
            <td><span style="font-size: 0.8rem; color: #1E293B;">${formatStaffMiscDate(n.reminderDate || n.date)}</span></td>
            <td class="text-center">${getStaffMiscPriorityPill(n.priority)}</td>
            <td class="text-end"><span class="badge" style="background: #E0E7FF; color: #3730A3; font-size: 0.72rem;">${escapeHtml(n.assignedStaffName || 'All Staff')}</span></td>
          </tr>
        `).join('');
      }
    }

    // 8. Render Table: Documents
    const tbodyDocs = document.getElementById('staff-tbody-documents');
    if (tbodyDocs) {
      if (allDocs.length === 0) {
        tbodyDocs.innerHTML = `
          <tr>
            <td colspan="5" class="text-center py-5">
              <div class="misc-empty-state">
                <div class="misc-empty-icon" style="background: #ECFDF5; color: #059669;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                </div>
                <div class="misc-empty-title">No Company Documents Published</div>
                <div class="misc-empty-desc">Employee handbooks, corporate guidelines, compliance templates, and forms published by Administration will appear here.</div>
              </div>
            </td>
          </tr>
        `;
      } else {
        tbodyDocs.innerHTML = allDocs.map(d => {
          const hasFile = !!(d.fileUrl || d.attachmentUrl || d.fileName);
          const fileName = d.fileName || (d.fileUrl ? d.fileUrl.split('/').pop() : 'Document');
          return `
            <tr>
              <td>
                <div class="d-flex align-items-center gap-2">
                  <div style="width: 28px; height: 28px; border-radius: 6px; background: rgba(29, 95, 143, 0.1); color: #1D5F8F; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  </div>
                  <div>
                    <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(d.title)}</div>
                    <div style="font-size: 0.72rem; color: #64748B;">${escapeHtml(d.description || '')}</div>
                  </div>
                </div>
              </td>
              <td><span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.72rem;">${escapeHtml(d.category || 'Policy')}</span></td>
              <td><span style="font-size: 0.8rem; color: #1E293B;">${formatStaffMiscDate(d.date || d.effectiveDate)}</span></td>
              <td class="text-center"><span class="badge" style="background: #E2E8F0; color: #334155; font-size: 0.72rem;">${escapeHtml(d.classification || 'Internal')}</span></td>
              <td class="text-end">
                ${hasFile ? `
                  <a href="${d.fileUrl || d.attachmentUrl || '#'}" target="_blank" download="${escapeHtml(fileName)}" class="btn btn-outline-primary btn-sm p-1 px-2" style="font-size: 0.78rem;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="me-1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Download
                  </a>
                ` : `<span style="font-size: 0.74rem; color: #94A3B8;">No file</span>`}
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  // OPEN STAFF DETAILS & DISCUSSION MODAL
  function openStaffMiscDetailsModal(type, id) {
    let item = null;
    let typeLabel = 'Record';
    if (type === 'requests') {
      item = WorkPulseDB.getGeneralRequests().find(r => r.id === id);
      typeLabel = 'General Request';
    } else if (type === 'maintenance') {
      item = WorkPulseDB.getMaintenanceIssues().find(m => m.id === id);
      typeLabel = 'Maintenance Issue';
    }

    if (!item) {
      showToast('Record not found.', 'error');
      return;
    }

    staffMiscCurrentDetailItem = { type, id, item };

    const modal = document.getElementById('staff-misc-details-modal');
    const titleEl = document.getElementById('staff-misc-details-modal-title');
    const contentEl = document.getElementById('staff-misc-details-modal-content');
    if (!modal || !contentEl) return;

    if (titleEl) titleEl.textContent = `[${typeLabel}] ${item.title || item.id}`;

    renderStaffMiscDetailsContent();
    modal.classList.add('open');
  }

  function renderStaffMiscDetailsContent() {
    if (!staffMiscCurrentDetailItem) return;
    const { type, id } = staffMiscCurrentDetailItem;
    const contentEl = document.getElementById('staff-misc-details-modal-content');
    if (!contentEl) return;

    let item = null;
    if (type === 'requests') item = WorkPulseDB.getGeneralRequests().find(r => r.id === id);
    else if (type === 'maintenance') item = WorkPulseDB.getMaintenanceIssues().find(m => m.id === id);
    if (!item) return;

    const comments = item.comments || [];

    contentEl.innerHTML = `
      <div class="mb-4 p-3" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <div class="d-flex align-items-center gap-2">
            <span style="font-size: 0.85rem; font-weight: 700; color: #1D5F8F;">${escapeHtml(item.id)}</span>
            <span class="badge" style="background: #E2E8F0; color: #334155;">${escapeHtml(item.category || 'General')}</span>
            ${item.priority ? getStaffMiscPriorityPill(item.priority) : ''}
            ${item.status ? getStaffMiscStatusBadge(item.status) : ''}
          </div>
          <span style="font-size: 0.78rem; color: #64748B;">Date: ${formatStaffMiscDate(item.date || item.reportedDate)}</span>
        </div>

        <h4 style="font-size: 1.05rem; font-weight: 700; color: #0A192F; margin-bottom: 8px;">${escapeHtml(item.title)}</h4>
        
        <div style="background: #FFFFFF; padding: 12px 14px; border-radius: 6px; border: 1px solid #E2E8F0; font-size: 0.85rem; color: #334155; line-height: 1.5; white-space: pre-wrap; margin-bottom: 10px;">
          ${escapeHtml(item.description || 'No additional details provided.')}
        </div>

        <div class="row g-2" style="font-size: 0.8rem; color: #475569;">
          ${item.location ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Location:</span> <strong>${escapeHtml(item.location)}</strong>
            </div>
          ` : ''}
          ${item.assignedStaffName ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Assigned Handler:</span> <strong>${escapeHtml(item.assignedStaffName)}</strong>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- COMMENTS & FEEDBACK -->
      <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h5 style="font-size: 0.95rem; font-weight: 700; color: #0A192F; margin: 0;">
            Administrative Updates & Discussion
            <span class="badge bg-secondary ms-1" style="font-size: 0.72rem;">${comments.length}</span>
          </h5>
        </div>

        <div class="mb-3" style="max-height: 220px; overflow-y: auto; padding-right: 4px;">
          ${comments.length === 0 ? `
            <div class="p-3 text-center" style="background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 6px; color: #94A3B8; font-size: 0.82rem;">
              No messages posted yet.
            </div>
          ` : comments.map(c => `
            <div class="misc-comment-card">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <div class="d-flex align-items-center gap-2">
                  <span class="misc-avatar-chip" style="width: 22px; height: 22px; font-size: 0.65rem;">${(c.author || 'ST').slice(0, 2).toUpperCase()}</span>
                  <span style="font-size: 0.82rem; font-weight: 600; color: #1E293B;">${escapeHtml(c.author || 'Staff')}</span>
                  <span class="badge ${c.role === 'admin' ? 'bg-primary-subtle text-primary' : 'bg-secondary-subtle text-secondary'}" style="font-size: 0.65rem;">${c.role || 'Staff'}</span>
                </div>
                <span style="font-size: 0.7rem; color: #94A3B8;">${formatStaffMiscDate(c.date || c.createdAt)}</span>
              </div>
              <div style="font-size: 0.82rem; color: #334155; line-height: 1.4; padding-left: 30px;">
                ${escapeHtml(c.comment || c.text || '')}
              </div>
            </div>
          `).join('')}
        </div>

        <!-- NEW COMMENT INPUT -->
        <div class="card p-2" style="background: #F8FAFC; border: 1px solid #E2E8F0;">
          <div class="d-flex gap-2">
            <textarea class="form-control form-control-sm" id="staff-new-comment-input" rows="2" placeholder="Send a message or follow-up note to Admin..." style="font-size: 0.82rem;"></textarea>
            <button class="btn btn-primary btn-sm align-self-end" id="btn-staff-submit-comment" style="white-space: nowrap; height: 38px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="me-1"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              Send
            </button>
          </div>
        </div>
      </div>
    `;

    const postBtn = document.getElementById('btn-staff-submit-comment');
    if (postBtn) {
      postBtn.addEventListener('click', () => {
        const inputEl = document.getElementById('staff-new-comment-input');
        if (!inputEl) return;
        const text = inputEl.value.trim();
        if (!text) {
          showToast('Please enter a note before sending.', 'error');
          return;
        }

        const authorName = (staff && staff.name) ? staff.name : 'Staff Member';
        let res = null;
        if (type === 'requests') res = WorkPulseDB.addGeneralRequestComment(id, text, authorName);
        else if (type === 'maintenance') res = WorkPulseDB.addMaintenanceComment(id, text, authorName);

        if (res) {
          showToast('Message sent to Administration.', 'success');
          WorkPulseDB.syncToServer();
          renderStaffMiscDetailsContent();
          renderStaffMisc();
        } else {
          showToast('Failed to post message.', 'error');
        }
      });
    }
  }

  // ATTACH STAFF MISC EVENT LISTENERS
  function initStaffMiscListeners() {
    // 1. Subtab pills inside General & Office Services
    document.querySelectorAll('[data-staff-subtab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const subtab = btn.dataset.staffSubtab;
        if (subtab) switchStaffMiscSubtab(subtab);
      });
    });

    // 1b. KPI Metric Cards click to switch subtab
    document.querySelectorAll('[data-staff-subtab-target]').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const target = card.dataset.staffSubtabTarget;
        if (target) switchStaffMiscSubtab(target);
      });
    });

    // 2. Open Submit Request Modal
    const btnNewReq = document.getElementById('btn-staff-new-request');
    if (btnNewReq) {
      btnNewReq.addEventListener('click', () => {
        const form = document.getElementById('staff-request-form');
        if (form) form.reset();
        const modal = document.getElementById('staff-request-modal');
        if (modal) modal.classList.add('open');
      });
    }

    // 3. Open Report Maintenance Modal
    const btnNewMaint = document.getElementById('btn-staff-report-maint');
    if (btnNewMaint) {
      btnNewMaint.addEventListener('click', () => {
        const form = document.getElementById('staff-maint-form');
        if (form) form.reset();
        const modal = document.getElementById('staff-maint-modal');
        if (modal) modal.classList.add('open');
      });
    }

    // 4. Modal Close & Cancel handlers
    [
      { btnId: 'btn-close-staff-request-modal', modalId: 'staff-request-modal' },
      { btnId: 'btn-cancel-staff-req', modalId: 'staff-request-modal' },
      { btnId: 'btn-close-staff-maint-modal', modalId: 'staff-maint-modal' },
      { btnId: 'btn-cancel-staff-maint', modalId: 'staff-maint-modal' },
      { btnId: 'btn-close-staff-misc-details', modalId: 'staff-misc-details-modal' },
      { btnId: 'btn-dismiss-staff-misc-details', modalId: 'staff-misc-details-modal' }
    ].forEach(({ btnId, modalId }) => {
      const btn = document.getElementById(btnId);
      const modal = document.getElementById(modalId);
      if (btn && modal) {
        btn.addEventListener('click', () => modal.classList.remove('open'));
      }
    });

    ['staff-request-modal', 'staff-maint-modal', 'staff-misc-details-modal'].forEach(mId => {
      const el = document.getElementById(mId);
      if (el) {
        el.addEventListener('click', (e) => {
          if (e.target === el) el.classList.remove('open');
        });
      }
    });

    // 5. Submit Request Form
    const reqForm = document.getElementById('staff-request-form');
    if (reqForm) {
      reqForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('btn-save-staff-req') || reqForm.querySelector('button[type="submit"]');
        if (submitBtn && (submitBtn.disabled || submitBtn.dataset.submitting === 'true')) {
          return;
        }

        const titleEl = document.getElementById('staff-req-title');
        const catEl = document.getElementById('staff-req-category');
        const descEl = document.getElementById('staff-req-desc');
        const prioEl = document.getElementById('staff-req-priority');
        const dateEl = document.getElementById('staff-req-date');
        const noteEl = document.getElementById('staff-req-note');

        const title = titleEl ? titleEl.value.trim() : '';
        const category = catEl ? catEl.value.trim() : 'IT Equipment';
        const description = descEl ? descEl.value.trim() : '';
        const priority = prioEl ? prioEl.value : 'Medium';
        const neededByDate = dateEl ? dateEl.value : '';
        const note = noteEl ? noteEl.value.trim() : '';

        if (!title) {
          showToast('Please enter a request title.', 'error');
          if (titleEl) titleEl.focus();
          return;
        }
        if (!description) {
          showToast('Please enter details / business need for the request.', 'error');
          if (descEl) descEl.focus();
          return;
        }

        // Prevent duplicate submissions by disabling button and setting flag
        const origBtnHtml = submitBtn ? submitBtn.innerHTML : 'Submit Request';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.dataset.submitting = 'true';
          submitBtn.innerHTML = '<span>Submitting...</span>';
        }

        const staffName = (staff && staff.name) ? staff.name : 'Staff Member';

        try {
          const payload = {
            title,
            category,
            description,
            priority,
            date: neededByDate || new Date().toISOString().split('T')[0],
            neededByDate,
            note,
            initialComment: note,
            staffId: currentStaffId,
            staffName,
            requestedById: currentStaffId,
            requestedByName: staffName,
            status: 'Pending'
          };

          const res = await fetch('/api/misc/requests', {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
          });

          const data = await res.json();

          if (!res.ok || !data || !data.success) {
            // Keep user on the form and display clear error message
            const errorMsg = (data && data.error) ? data.error : 'Failed to submit request. Please try again.';
            showToast(errorMsg, 'error');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.dataset.submitting = 'false';
              submitBtn.innerHTML = origBtnHtml;
            }
            return;
          }

          const newReq = data.data;

          // Merge into local DB
          const currentDb = WorkPulseDB.load();
          currentDb.generalRequests = currentDb.generalRequests || [];
          const existingIdx = currentDb.generalRequests.findIndex(r => r.id === newReq.id);
          if (existingIdx >= 0) {
            currentDb.generalRequests[existingIdx] = newReq;
          } else {
            currentDb.generalRequests.unshift(newReq);
          }
          WorkPulseDB.save(currentDb, true);

          // Reset form and close modal ONLY after successful submission
          reqForm.reset();
          const modal = document.getElementById('staff-request-modal');
          if (modal) modal.classList.remove('open', 'show');

          showToast('Request submitted to Administration for review!', 'success');

          // Re-enable button
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.dataset.submitting = 'false';
            submitBtn.innerHTML = origBtnHtml;
          }

          // Refresh Staff Portal request list and dashboard overview automatically
          renderStaffMisc();
          if (typeof renderStaffDashboardOverview === 'function') {
            renderStaffDashboardOverview();
          }

          // Background sync to ensure client and server states match
          WorkPulseDB.syncToServer();
        } catch (err) {
          console.error('Submit request error:', err);
          showToast('Network error while submitting request. Please try again.', 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.dataset.submitting = 'false';
            submitBtn.innerHTML = origBtnHtml;
          }
        }
      });
    }

    // 6. Submit Maintenance Form
    const maintForm = document.getElementById('staff-maint-form');
    if (maintForm) {
      maintForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('staff-maint-title').value.trim();
        const category = (document.getElementById('staff-maint-category') || {}).value || 'Facility';
        const location = document.getElementById('staff-maint-location').value.trim();
        const priority = (document.getElementById('staff-maint-priority') || document.getElementById('staff-maint-urgency') || {}).value || 'Medium';
        const description = document.getElementById('staff-maint-desc').value.trim();

        const staffName = (staff && staff.name) ? staff.name : 'Staff Member';

        WorkPulseDB.addMaintenanceIssue({
          title,
          category,
          location,
          priority,
          description,
          staffId: currentStaffId,
          staffName,
          reportedById: currentStaffId,
          reportedByName: staffName,
          date: new Date().toISOString().split('T')[0],
          status: 'Reported'
        });

        const modal = document.getElementById('staff-maint-modal');
        if (modal) modal.classList.remove('open');
        WorkPulseDB.syncToServer();
        showToast('Maintenance issue logged! Facility team notified.', 'success');
        renderStaffMisc();
      });
    }

    // 7. Delegated view details action in staff tables
    const miscPane = document.getElementById('pane-tab-my-misc');
    if (miscPane) {
      miscPane.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="view-staff-misc-details"]');
        if (!btn) return;
        const type = btn.dataset.type;
        const id = btn.dataset.id;
        openStaffMiscDetailsModal(type, id);
      });
    }
  }

  initStaffMiscListeners();

  function refreshStaffUI() {
    const sess = WorkPulseDB.getSession();
    if (sess && sess.role === 'staff' && sess.user && sess.user.id) {
      currentStaffId = sess.user.id;
      staff = WorkPulseDB.getStaffById(currentStaffId) || sess.user;
    }
    populateProfile();
    checkAttendanceState();
    renderMonthlyKPIs();
    renderStaffCalendar();
    renderMyApplications(true);
    initWorkAndMeetingsModule();
    renderWorkKPIs();
    renderStaffDashboardOverview();
    updateDynamicSidebarBadgesAndPermissions();

    // Re-render currently active view if applicable
    const activePane = document.querySelector('.staff-view-pane.active');
    if (activePane) {
      const activeViewName = activePane.id.replace(/^view-/, '');
      if (activeViewName === 'projects') renderStaffProjects();
      else if (activeViewName === 'tasks') renderStaffTasks();
      else if (activeViewName === 'kanban') renderStaffKanban();
      else if (activeViewName === 'gantt') renderStaffGantt();
      else if (activeViewName === 'reports') renderStaffDailyReports();
      else if (activeViewName === 'meetings') renderStaffMeetings();
      else if (activeViewName === 'reviews') renderStaffReviews();
      else if (activeViewName === 'updates') renderStaffProjectUpdates();
      else if (activeViewName === 'leads') renderStaffLeads();
      else if (activeViewName === 'misc') renderStaffMisc();
      else if (activeViewName === 'profile') renderStaffProfileSettings();
    }
  }

  // --------------------------------------------------------------------------
  // 11. INITIALIZATION SEQUENCE
  // --------------------------------------------------------------------------
  populateProfile();
  initLiveClock();
  initGpsLocation();
  checkAttendanceState();
  resetInactivityTimer();
  renderMonthlyKPIs();
  renderStaffCalendar();
  renderMyApplications();
  initWorkAndMeetingsModule();
  renderWorkKPIs();
  renderStaffDashboardOverview();
  updateDynamicSidebarBadgesAndPermissions();

  // Restore active view from hash or localStorage
  const savedStaffHash = (window.location.hash || '').replace(/^#/, '').trim();
  const savedStaffLocalView = localStorage.getItem('workpulse_staff_last_view') || localStorage.getItem('workpulse_staff_last_tab') || 'dashboard';

  let initialStaffView = 'dashboard';
  if (savedStaffHash) {
    initialStaffView = viewAliasMap[savedStaffHash] || (validStaffViews.includes(savedStaffHash) ? savedStaffHash : 'dashboard');
  } else if (savedStaffLocalView) {
    initialStaffView = viewAliasMap[savedStaffLocalView] || (validStaffViews.includes(savedStaffLocalView) ? savedStaffLocalView : 'dashboard');
  }

  switchStaffView(initialStaffView);

  window.addEventListener('hashchange', () => {
    const hash = (window.location.hash || '').replace(/^#/, '').trim();
    if (hash) {
      const targetView = viewAliasMap[hash] || (validStaffViews.includes(hash) ? hash : 'dashboard');
      switchStaffView(targetView);
    }
  });

  // Synchronize state with persistent backend database on page load
  WorkPulseDB.initServerSync(() => {
    refreshStaffUI();
  });

  // Start continuous cross-device auto-sync
  WorkPulseDB.startAutoSync(4000, () => {
    refreshStaffUI();
  });
});
