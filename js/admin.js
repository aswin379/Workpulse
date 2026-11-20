/**
 * WORKPULSE — EXECUTIVE ADMIN CONSOLE JAVASCRIPT (js/admin.js)
 * Manages 8 operational modules, interactive 5-color attendance calendars,
 * Excel file import, leave/WFH approval synchronization, and CSV audit exports.
 */

document.addEventListener('DOMContentLoaded', () => {
  const sessionToken = WorkPulseDB.getSessionToken();
  const session = WorkPulseDB.getSession();
  const currentRole = ((session && (session.role || (session.user && session.user.role))) || '').toLowerCase();
  if (!sessionToken || !session || currentRole !== 'admin') {
    WorkPulseDB.clearSession();
    window.location.replace('index.html?error=admin_required');
    return;
  }

  // Validate session against authoritative server
  fetch('/api/auth/session', {
    headers: WorkPulseDB.getAuthHeaders(),
    cache: 'no-store'
  })
    .then(res => res.json())
    .then(data => {
      const serverRole = ((data && data.session && (data.session.role || (data.session.user && data.session.user.role))) || '').toLowerCase();
      if (!data.success || !data.session || serverRole !== 'admin') {
        WorkPulseDB.clearSession();
        window.location.replace('index.html?error=admin_required');
      }
    })
    .catch((netErr) => {
      console.warn('Authoritative session verification network check:', netErr);
    });

  // Active view state
  let currentView = 'dashboard';
  let activeDossierStaffId = null;
  let isSavingDomain = false;
  let isSavingClient = false;
  let isSavingClientPayment = false;
  const currentInitialDate = new Date();
  let activeDossierYear = currentInitialDate.getFullYear();
  let activeDossierMonth = currentInitialDate.getMonth(); // 0-indexed

  // --------------------------------------------------------------------------
  // 2. DOM ELEMENT CACHE
  // --------------------------------------------------------------------------
  const sidebar = document.getElementById('admin-sidebar');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const navItems = document.querySelectorAll('.sidebar-nav-item');
  const viewPanes = document.querySelectorAll('.admin-view-pane');
  const pageHeading = document.getElementById('admin-page-heading');
  const logoutBtn = document.getElementById('btn-admin-logout');

  // Topbar
  const notifBtn = document.getElementById('notif-toggle-btn');
  const notifDropdown = document.getElementById('notification-dropdown');
  const notifContainer = document.getElementById('notif-items-container');
  const notifBadgeDot = document.getElementById('notif-badge-dot');
  const clearNotifsBtn = document.getElementById('btn-clear-notifs');
  const globalSearchInput = document.getElementById('global-search-input');
  const topbarAddStaffBtn = document.getElementById('btn-topbar-add-staff');

  // Modals
  const dossierModal = document.getElementById('staff-dossier-modal');
  const addStaffModal = document.getElementById('add-staff-modal');
  const editStaffModal = document.getElementById('edit-staff-modal');
  const dayDetailModal = document.getElementById('day-detail-modal');

  // Badges
  const badgeLeavesCount = document.getElementById('badge-leaves-count');
  const badgeWfhCount = document.getElementById('badge-wfh-count');

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
  function renderEmptyTableState(colspan, title, subtitle = 'No records match the active criteria or filter parameters.') {
    return `
      <tr>
        <td colspan="${colspan}" style="text-align:center; padding: 48px 24px;">
          <div class="d-flex flex-column align-items-center justify-content-center" style="gap: 8px;">
            <div style="width: 46px; height: 46px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; color: #94A3B8; margin-bottom: 2px;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <div style="font-weight: 700; color: var(--navy-dark); font-size: 0.9rem;">${title}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); max-width: 340px;">${subtitle}</div>
          </div>
        </td>
      </tr>
    `;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Universal Staff Avatar Renderer (Displays photo if present, falls back to initials circle)
  function renderStaffAvatar(item, size = 34) {
    if (!item) return '';
    const staffId = item.id || item.staffId;
    let name = item.name || item.staffName;
    let photo = item.photo;
    if (staffId && (!name || name === 'undefined' || !photo)) {
      const fullStaff = WorkPulseDB.getStaffById(staffId);
      if (fullStaff) {
        if (!name || name === 'undefined') name = fullStaff.name;
        if (!photo && fullStaff.photo) photo = fullStaff.photo;
      }
    }
    name = (name && name !== 'undefined') ? name : 'Staff';
    const initials = getInitials(name);
    if (photo) {
      return `
        <div class="staff-avatar-thumb" style="width:${size}px; height:${size}px;" title="${escapeHtml(name)}">
          <img src="${photo}" alt="${escapeHtml(name)}" onerror="this.parentElement.innerHTML='${initials}'">
        </div>
      `;
    }
    return `
      <div class="staff-avatar-thumb" style="width:${size}px; height:${size}px;" title="${escapeHtml(name)}">
        ${initials}
      </div>
    `;
  }

  // Universal Location Cell Renderer (Displays recorded address/coords, accuracy, and View on Map link)
  function renderAdminLocationCell(att) {
    if (!att || !att.checkIn || att.checkIn === '--:--') {
      const fallbackText = att?.status === 'Leave' ? 'On Approved Leave' : (att?.status === 'Work From Home' ? 'Approved Remote Work' : (att?.status === 'Sunday' ? 'Weekly Off' : 'Awaiting check-in'));
      return `<span style="color:#94A3B8; font-style:italic; font-size:0.74rem;">${fallbackText}</span>`;
    }
    const lat = (att.coords && typeof att.coords.latitude === 'number') ? att.coords.latitude : (typeof att.latitude === 'number' && !isNaN(att.latitude) ? att.latitude : (att.lat !== undefined && !isNaN(Number(att.lat)) ? Number(att.lat) : null));
    const lng = (att.coords && typeof att.coords.longitude === 'number') ? att.coords.longitude : (typeof att.longitude === 'number' && !isNaN(att.longitude) ? att.longitude : (att.lng !== undefined && !isNaN(Number(att.lng)) ? Number(att.lng) : null));
    const hasCoords = lat !== null && lng !== null;
    let mapUrl = att.mapUrl || '';
    if (!mapUrl && hasCoords) {
      mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    }

    let address = att.address || '';
    if (!address && hasCoords) {
      address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } else if (!address && att.location && !att.location.toLowerCase().includes('unavailable') && !att.location.toLowerCase().includes('absent') && !att.location.toLowerCase().includes('n/a') && !att.location.toLowerCase().includes('pending')) {
      address = att.location;
    }

    if (!address && !hasCoords) {
      return `<span style="color:#94A3B8; font-style:italic; font-size:0.74rem;">Location unavailable</span>`;
    }

    const accuracyVal = (att.coords && typeof att.coords.accuracy === 'number') ? att.coords.accuracy : (att.accuracy ? Number(att.accuracy) : null);
    const accuracyFormatted = accuracyVal ? (accuracyVal >= 1000 ? `${(accuracyVal / 1000).toFixed(1)}km` : `${Math.round(accuracyVal)}m`) : '';
    const accuracyText = accuracyFormatted ? `<span style="font-size:0.68rem; color:#64748B;"> (±${accuracyFormatted})</span>` : '';
    const mapLinkHtml = mapUrl ? `<a href="${mapUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--royal-blue, #1D5F8F); font-weight:700; text-decoration:underline; font-size:0.74rem; display:inline-flex; align-items:center; gap:3px; margin-top:3px;">📍 View on Google Maps &rarr;</a>` : '';

    return `
      <div style="font-size:0.74rem; line-height:1.3; display:flex; flex-direction:column;">
        <div style="font-weight:600; color:var(--navy-dark);">${escapeHtml(address || 'Recorded GPS')}${accuracyText}</div>
        ${hasCoords && address !== `${lat.toFixed(5)}, ${lng.toFixed(5)}` ? `<div style="font-size:0.69rem; color:#64748B;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>` : ''}
        ${mapLinkHtml}
      </div>
    `;
  }

  // Staff Photo Processing & Canvas 256x256 Square Cropper with Persistent Server Upload
  function processStaffPhotoFile(file, callback) {
    if (!file || !file.type.startsWith('image/')) {
      callback(null, 'Please select a valid image file (JPG, PNG, WebP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 256;
          canvas.width = maxDim;
          canvas.height = maxDim;
          const ctx = canvas.getContext('2d');

          let sx = 0, sy = 0, sWidth = img.width, sHeight = img.height;
          if (img.width > img.height) {
            sWidth = img.height;
            sx = (img.width - img.height) / 2;
          } else if (img.height > img.width) {
            sHeight = img.width;
            sy = (img.height - img.width) / 2;
          }

          ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, maxDim, maxDim);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

          // Upload photo to shared persistent server storage
          try {
            const uploadRes = await fetch('/api/upload', {
              method: 'POST',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                fileName: file.name || 'photo.jpg',
                fileType: 'image/jpeg',
                dataBase64: dataUrl
              })
            });
            const uploadJson = await uploadRes.json();
            if (uploadJson && uploadJson.success && uploadJson.url) {
              callback(uploadJson.url, null);
              return;
            }
          } catch (netErr) {
            console.warn('Persistent photo upload fallback:', netErr);
          }

          callback(dataUrl, null);
        } catch (err) {
          callback(null, 'Error processing image: ' + err.message);
        }
      };
      img.onerror = () => {
        callback(null, 'Failed to load selected image.');
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
      callback(null, 'Failed to read image file.');
    };
    reader.readAsDataURL(file);
  }

  // --------------------------------------------------------------------------
  // 3. NAVIGATION CONTROLLER
  // --------------------------------------------------------------------------
  const validViews = ['dashboard', 'staff', 'attendance', 'activity', 'work', 'reviews', 'meetings', 'clients', 'client-profile', 'leads', 'domains', 'leaves', 'wfh', 'import', 'reports', 'settings', 'misc'];

  function switchView(viewName) {
    if (!viewName || !validViews.includes(viewName)) {
      viewName = 'dashboard';
    }
    currentView = viewName;
    
    // Update URL hash & localStorage for seamless browser refresh persistence
    try {
      localStorage.setItem('workpulse_admin_last_view', viewName);
      if (window.location.hash !== '#' + viewName) {
        window.history.replaceState(null, '', '#' + viewName);
      }
    } catch (e) {}

    // Special handling for dedicated Client Portfolio Profile full-page view
    if (viewName === 'client-profile') {
      if (!activeClientProfileId) {
        try {
          activeClientProfileId = localStorage.getItem('workpulse_admin_last_client_id');
        } catch (e) {}
      }
      const client = activeClientProfileId ? WorkPulseDB.getClientById(activeClientProfileId) : null;
      if (!client) {
        switchView('clients');
        return;
      }
      navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === 'clients');
      });
      viewPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === 'pane-client-profile');
      });
      if (pageHeading) {
        pageHeading.textContent = `Client Portfolio: ${client.name}`;
      }
      if (sidebar) sidebar.classList.remove('open');
      const viewContent = document.getElementById('client-profile-view-content');
      if (viewContent && (!viewContent.innerHTML || !viewContent.innerHTML.trim())) {
        openClientProfileModal(activeClientProfileId, clientActiveTab);
      }
      return;
    }

    // Special handling for dedicated Daily Works link
    if (viewName === 'reviews') {
      navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === 'reviews');
      });
      viewPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === 'pane-reviews');
      });
      if (pageHeading) {
        pageHeading.textContent = 'Daily Works';
      }
      if (sidebar) sidebar.classList.remove('open');
      renderAdminReports();
      return;
    }

    // Update sidebar nav highlights
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update active pane
    viewPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === `pane-${viewName}`);
    });

    // Update Topbar Title
    const titles = {
      dashboard: 'Executive Dashboard',
      staff: 'Corporate Staff Directory',
      attendance: 'Attendance Timesheet Log',
      activity: 'Staff Activity Status & Live Monitoring',
      leaves: 'Leave Management & Approvals',
      wfh: 'Work From Home Governance',
      import: 'Excel Staff Batch Importer',
      reports: 'Executive Reports & Analytics',
      settings: 'Office Settings & Geofence',
      work: 'Staff Work & Project Management',
      reviews: 'Daily Works',
      meetings: 'Meetings & Briefings Management',
      clients: 'Client Management & Project Portfolios',
      'client-profile': 'Client Portfolio Profile',
      leads: 'Lead Management & Acquisition Pipeline',
      domains: 'Domain & Hosting Management',
      misc: 'Corporate Miscellaneous Hub'
    };
    if (pageHeading) {
      pageHeading.textContent = titles[viewName] || 'Executive Console';
    }

    // Close mobile sidebar if open
    if (sidebar) sidebar.classList.remove('open');

    // Trigger view-specific render safely
    try {
      if (viewName === 'dashboard') renderDashboard();
      else if (viewName === 'staff') renderStaffDirectory();
      else if (viewName === 'attendance') renderAttendanceLog();
      else if (viewName === 'activity') renderActivityStatus();
      else if (viewName === 'leaves') renderLeavesTable();
      else if (viewName === 'wfh') renderWfhTable();
      else if (viewName === 'reports') renderReports();
      else if (viewName === 'work') renderWorkManagement();
      else if (viewName === 'meetings') renderMeetingsManagement();
      else if (viewName === 'settings') renderSettings();
      else if (viewName === 'clients') renderClients();
      else if (viewName === 'leads') renderLeads();
      else if (viewName === 'domains') renderDomains();
      else if (viewName === 'misc') renderMiscModule();
    } catch (err) {
      console.error(`[WorkPulse Navigation] Error rendering view "${viewName}":`, err);
    }
  }

  // Expose globally for inline buttons and modals
  window.switchView = switchView;

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      if (view) switchView(view);
    });
  });

  // Delegated click listener for any dynamic [data-route] or [data-view] elements
  document.addEventListener('click', (e) => {
    const navEl = e.target.closest('.sidebar-nav-item, [data-view]');
    if (navEl) {
      const view = navEl.dataset.view;
      if (view && validViews.includes(view)) {
        e.preventDefault();
        switchView(view);
        return;
      }
    }
    const routeEl = e.target.closest('[data-route]');
    if (routeEl) {
      const route = routeEl.dataset.route;
      if (route) {
        e.preventDefault();
        switchView(route);
        if (route === 'attendance' && routeEl.dataset.status) {
          const statSel = document.getElementById('att-filter-status');
          if (statSel) {
            statSel.value = routeEl.dataset.status;
            renderAttendanceLog();
          }
        }
      }
    }
  });

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });
  }

  document.addEventListener('click', (e) => {
    if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== mobileMenuBtn) {
      sidebar.classList.remove('open');
    }
  });

  // Logout handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders()
        });
      } catch (e) {}
      WorkPulseDB.clearSession();
      window.location.href = 'index.html?error=logged_out';
    });
  }

  // Shortcuts & Global Search
  document.getElementById('btn-view-full-attendance')?.addEventListener('click', () => switchView('attendance'));
  document.getElementById('btn-import-staff-shortcut')?.addEventListener('click', () => switchView('import'));
  
  if (topbarAddStaffBtn) {
    topbarAddStaffBtn.addEventListener('click', () => {
      addStaffModal.classList.add('open');
    });
  }
  document.getElementById('btn-open-add-staff-modal')?.addEventListener('click', () => {
    addStaffModal.classList.add('open');
  });

  // Wire interactive KPI cards
  document.querySelectorAll('.kpi-clickable').forEach(card => {
    card.addEventListener('click', () => {
      const route = card.dataset.route;
      const status = card.dataset.status;
      if (route) {
        switchView(route);
        if (route === 'attendance' && status) {
          const statSel = document.getElementById('att-filter-status');
          if (statSel) {
            statSel.value = status;
            renderAttendanceLog();
          }
        }
      }
    });
  });

  if (globalSearchInput) {
    globalSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (q && currentView !== 'staff') {
        switchView('staff');
      }
      const staffSearch = document.getElementById('staff-search-input');
      if (staffSearch) {
        staffSearch.value = q;
        renderStaffDirectory(q);
      }
    });
  }

  // Notifications Toggle
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle('open');
      renderNotifications();
    });

    document.addEventListener('click', (e) => {
      if (!notifDropdown.contains(e.target) && e.target !== notifBtn) {
        notifDropdown.classList.remove('open');
      }
    });

    if (clearNotifsBtn) {
      clearNotifsBtn.addEventListener('click', () => {
        const db = WorkPulseDB.load();
        db.notifications.forEach(n => { if (n.role === 'admin') n.read = true; });
        WorkPulseDB.save(db);
        renderNotifications();
        updatePendingBadges();
      });
    }
  }

  function renderNotifications() {
    const db = WorkPulseDB.load();
    const adminNotifs = (db.notifications || []).filter(n => n.role === 'admin');
    
    if (notifContainer) {
      if (adminNotifs.length === 0) {
        notifContainer.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:0.8rem;">No notifications.</div>`;
        return;
      }
      notifContainer.innerHTML = adminNotifs.map(n => `
        <div class="notif-item ${!n.read ? 'unread' : ''}">
          <div style="font-weight:${!n.read ? '700' : '500'}; color:var(--navy-dark);">${n.text}</div>
          <div class="notif-time">${n.time}</div>
        </div>
      `).join('');
    }
  }

  async function updatePendingBadges() {
    // 1. Calculate from local authoritative state immediately (prevent duplicate counting & case-insensitive)
    const rawLeaves = WorkPulseDB.getLeaves() || [];
    const pendingLeavesMap = new Map();
    rawLeaves.forEach(l => {
      if (l && l.id && String(l.status || '').trim().toLowerCase() === 'pending') {
        pendingLeavesMap.set(String(l.id).trim(), l);
      }
    });
    const pendingLeavesCount = pendingLeavesMap.size;

    const rawWfh = WorkPulseDB.getWfhRequests() || [];
    const pendingWfhMap = new Map();
    rawWfh.forEach(w => {
      if (w && w.id && String(w.status || '').trim().toLowerCase() === 'pending') {
        const sig = `${String(w.staffId || '').trim()}_${String(w.date || '').trim()}`.toUpperCase();
        if (!pendingWfhMap.has(sig)) {
          pendingWfhMap.set(sig, w);
        }
      }
    });
    const pendingWfhCount = pendingWfhMap.size;

    // Sidebar Leave Requests Badge
    if (badgeLeavesCount) {
      badgeLeavesCount.textContent = pendingLeavesCount;
      badgeLeavesCount.style.display = pendingLeavesCount > 0 ? 'inline-block' : 'none';
    }

    // Sidebar Work From Home Badge
    if (badgeWfhCount) {
      badgeWfhCount.textContent = pendingWfhCount;
      badgeWfhCount.style.display = pendingWfhCount > 0 ? 'inline-block' : 'none';
    }

    // Leave View Tab Badge: Pending Review (N)
    const leaveTabBadge = document.getElementById('leave-pending-badge');
    if (leaveTabBadge) leaveTabBadge.textContent = pendingLeavesCount;

    // WFH View Tab Badge: Pending Review (N)
    const wfhTabBadge = document.getElementById('wfh-pending-badge');
    if (wfhTabBadge) wfhTabBadge.textContent = pendingWfhCount;

    // Domain & Hosting Badge
    const domainBadge = document.getElementById('badge-domains-count');
    if (domainBadge && typeof WorkPulseDB.getDomainSummary === 'function') {
      const dSummary = WorkPulseDB.getDomainSummary();
      const alertCount = (dSummary.expiringSoon || 0) + (dSummary.expired || 0);
      domainBadge.textContent = alertCount > 0 ? alertCount : (dSummary.total || 0);
      domainBadge.style.display = ((dSummary.total || 0) > 0 || alertCount > 0) ? 'inline-block' : 'none';
      if (alertCount > 0) {
        domainBadge.style.background = '#D97706';
        domainBadge.style.color = '#FFFFFF';
      } else {
        domainBadge.style.background = 'var(--royal-blue)';
        domainBadge.style.color = '#FFFFFF';
      }
    }

    // Miscellaneous Hub Badge
    const miscBadge = document.getElementById('badge-misc-count');
    if (miscBadge && typeof WorkPulseDB.getGeneralRequests === 'function') {
      const pendingReqs = WorkPulseDB.getGeneralRequests({ status: 'Pending' }).length;
      miscBadge.textContent = pendingReqs;
      miscBadge.style.display = pendingReqs > 0 ? 'inline-block' : 'none';
    }

    // Daily Works Pending Badge
    const rawReports = WorkPulseDB.getDailyReports() || [];
    const pendingReportsCount = rawReports.filter(r => !r.review).length;
    const badgeReviews = document.getElementById('badge-admin-reviews-pending');
    if (badgeReviews) {
      badgeReviews.textContent = pendingReportsCount;
      badgeReviews.style.display = pendingReportsCount > 0 ? 'inline-block' : 'none';
    }
    const badgeReportsSubtab = document.getElementById('badge-admin-reports-pending');
    if (badgeReportsSubtab) {
      badgeReportsSubtab.textContent = `${pendingReportsCount} pending`;
      badgeReportsSubtab.style.display = pendingReportsCount > 0 ? 'inline-block' : 'none';
    }
    
    // Topbar Notification Bell Dot
    const db = WorkPulseDB.load();
    const hasUnread = (db.notifications || []).some(n => n.role === 'admin' && !n.read);
    if (notifBadgeDot) {
      notifBadgeDot.style.display = hasUnread ? 'block' : 'none';
    }

    // Executive Dashboard Pending Approvals KPI Card
    const pendingStat = document.getElementById('stat-pending-approvals');
    if (pendingStat) pendingStat.textContent = pendingLeavesCount + pendingWfhCount;

    // 2. Authoritative background sync with server to ensure multi-device & multi-tab consistency
    if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
      try {
        const res = await fetch('/api/admin/pending-counts', {
          headers: WorkPulseDB.getAuthHeaders(),
          cache: 'no-store'
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.success) {
            const serverLeaves = Number(json.pendingLeaves) || 0;
            const serverWfh = Number(json.pendingWfh) || 0;

            if (badgeLeavesCount) {
              badgeLeavesCount.textContent = serverLeaves;
              badgeLeavesCount.style.display = serverLeaves > 0 ? 'inline-block' : 'none';
            }
            if (badgeWfhCount) {
              badgeWfhCount.textContent = serverWfh;
              badgeWfhCount.style.display = serverWfh > 0 ? 'inline-block' : 'none';
            }
            if (leaveTabBadge) leaveTabBadge.textContent = serverLeaves;
            if (wfhTabBadge) wfhTabBadge.textContent = serverWfh;
            if (pendingStat) pendingStat.textContent = serverLeaves + serverWfh;

            // If server differs from local storage, trigger sync to reload authoritative records
            if (serverLeaves !== pendingLeavesCount || serverWfh !== pendingWfhCount) {
              WorkPulseDB.initServerSync();
            }
          }
        }
      } catch (err) {
        // Fall back gracefully to local counts if network is unreachable
      }
    }
  }

  // --------------------------------------------------------------------------
  // 4. VIEW 1: EXECUTIVE DASHBOARD
  // --------------------------------------------------------------------------
  function renderDashboard() {
    const staffList = WorkPulseDB.getStaffList();
    const todayStr = (WorkPulseDB && typeof WorkPulseDB.getTodayDateString === 'function') 
      ? WorkPulseDB.getTodayDateString() 
      : new Date().toISOString().split('T')[0];
    const todayAtt = WorkPulseDB.getAttendance({ date: todayStr });

    // Calculate metrics
    const totalStaff = staffList.length;
    const presentToday = todayAtt.filter(a => a.status === 'Present').length;
    const halfDayToday = todayAtt.filter(a => a.status === 'Half Day').length;
    const leaveToday = todayAtt.filter(a => a.status === 'Leave').length;
    const wfhToday = todayAtt.filter(a => a.status === 'Work From Home').length;
    const activeShiftsCount = todayAtt.filter(a => a.checkIn !== '--:--' && a.checkOut === '--:--').length;

    // Update KPI grid
    document.getElementById('stat-total-staff').textContent = totalStaff;
    document.getElementById('stat-present-today').textContent = presentToday;
    document.getElementById('stat-halfday-today').textContent = halfDayToday;
    document.getElementById('stat-leave-today').textContent = leaveToday;
    document.getElementById('stat-wfh-today').textContent = wfhToday;
    const statAutoCheckoutEl = document.getElementById('stat-auto-checkout-count');
    if (statAutoCheckoutEl) {
      statAutoCheckoutEl.textContent = activeShiftsCount;
    }

    updatePendingBadges();

    // Render Today's Activity Table
    const tbody = document.getElementById('dashboard-activity-tbody');
    if (tbody) {
      if (todayAtt.length === 0) {
        tbody.innerHTML = renderEmptyTableState(8, 'No Attendance Activity Today', 'Clock-in transactions will appear here automatically as personnel log in.');
        return;
      }

      tbody.innerHTML = todayAtt.map(att => {
        let statusBadge = '';
        if (att.status === 'Present') statusBadge = `<span class="badge badge-present">🟢 Present</span>`;
        else if (att.status === 'Half Day') statusBadge = `<span class="badge badge-halfday">🟤 Half Day</span>`;
        else if (att.status === 'Leave') statusBadge = `<span class="badge badge-leave">🔴 Leave</span>`;
        else if (att.status === 'Work From Home') statusBadge = `<span class="badge badge-wfh">🟠 WFH</span>`;
        else if (att.status === 'Sunday') statusBadge = `<span class="badge badge-sunday">⚪ Sunday</span>`;
        else statusBadge = `<span class="badge badge-future">${att.status}</span>`;

        let checkoutHtml = `<span>${att.checkOut}</span>`;
        if (att.checkIn !== '--:--' && att.checkOut === '--:--') {
          checkoutHtml = `<span class="badge badge-success" style="font-size:0.62rem; padding:2px 6px; background:#10B981; color:#fff;" title="Shift currently active until manual checkout">🟢 Active Shift</span>`;
        } else if (att.checkOut && att.checkOut !== '--:--') {
          checkoutHtml = `<span style="font-weight:700;">${att.checkOut}</span>`;
        }

        const isOnline = WorkPulseDB.isStaffOnline(att.staffId);
        const onlineBadge = isOnline
          ? `<span class="badge" style="background:#ECFDF5; color:#059669; font-size:0.67rem; padding:1px 6px; font-weight:700; margin-left:6px;"><span class="pulse-dot pulse-dot-green" style="margin-right:4px;"></span>Online</span>`
          : `<span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.67rem; padding:1px 6px; font-weight:600; margin-left:6px;"><span class="pulse-dot pulse-dot-gray" style="margin-right:4px;"></span>Offline</span>`;

        return `
          <tr>
            <td>
              <div class="d-flex align-items-center gap-2">
                ${renderStaffAvatar(att, 32)}
                <div>
                  <div style="font-weight:700; color:var(--navy-dark); display:flex; align-items:center;">
                    <span>${att.staffName}</span>
                    ${onlineBadge}
                  </div>
                  <div style="font-size:0.72rem; color:var(--text-muted);">${att.staffId}</div>
                </div>
              </div>
            </td>
            <td style="font-size:0.82rem; font-weight:600; color:var(--text-muted);">${att.position}</td>
            <td class="text-center" style="font-family:var(--font-sans); font-weight:700; color:var(--navy-dark);">${att.checkIn}</td>
            <td class="text-center" style="font-family:var(--font-sans);">${checkoutHtml}</td>
            <td class="text-center" style="font-weight:700; color:var(--royal-blue);">${att.workingHours}</td>
            <td style="font-size:0.75rem; color:var(--text-muted); max-width:200px;">
              ${renderAdminLocationCell(att)}
            </td>
            <td class="text-center">${statusBadge}</td>
            <td class="text-end">
              <button class="btn btn-secondary btn-sm btn-open-dossier" data-id="${att.staffId}" style="padding:4px 8px; font-size:0.74rem;">
                Dossier &rarr;
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Attach dossier listeners
      tbody.querySelectorAll('.btn-open-dossier').forEach(btn => {
        btn.addEventListener('click', () => {
          openStaffDossier(btn.dataset.id);
        });
      });
    }
  }

  document.getElementById('btn-refresh-dashboard')?.addEventListener('click', () => {
    renderDashboard();
    showToast('Dashboard metrics refreshed from live database.', 'info');
  });

  document.getElementById('btn-export-quick-audit')?.addEventListener('click', () => {
    exportAttendanceAuditCSV();
  });

  // --------------------------------------------------------------------------
  // 5. VIEW 2: STAFF DIRECTORY
  // --------------------------------------------------------------------------
  function renderStaffDirectory(searchQuery = '') {
    const staffList = WorkPulseDB.getStaffList();
    const statusFilter = document.getElementById('staff-status-filter')?.value || 'All';

    let filtered = staffList.filter(s => {
      const matchSearch = !searchQuery || 
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.position.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.mobile.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.id.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus = statusFilter === 'All' || s.status === statusFilter;
      return matchSearch && matchStatus;
    });

    const countEl = document.getElementById('staff-records-count');
    if (countEl) countEl.textContent = `Showing ${filtered.length} of ${staffList.length} staff members`;

    const todayStr = (WorkPulseDB && typeof WorkPulseDB.getTodayDateString === 'function') 
      ? WorkPulseDB.getTodayDateString() 
      : new Date().toISOString().split('T')[0];
    const todayAttList = WorkPulseDB.getAttendance({ date: todayStr });
    const todayAttMap = {};
    todayAttList.forEach(a => { todayAttMap[a.staffId] = a; });

    const tbody = document.getElementById('staff-master-tbody');
    if (tbody) {
      if (filtered.length === 0) {
        const emptySubtitle = staffList.length === 0
          ? 'Click "Add New Staff" above to enroll employee profiles into the directory.'
          : 'No staff members match the active search or filter criteria.';
        tbody.innerHTML = renderEmptyTableState(8, 'No staff members found', emptySubtitle);
        return;
      }

      tbody.innerHTML = filtered.map(staff => {
        const att = todayAttMap[staff.id];
        let locCell = '';
        if (att && att.checkIn && att.checkIn !== '--:--') {
          let badgeClass = 'badge-present';
          let badgeLabel = `🟢 ${att.checkIn}`;
          if (att.status === 'Half Day') {
            badgeClass = 'badge-halfday';
            badgeLabel = `🟤 Half Day (${att.checkIn})`;
          } else if (att.status === 'Work From Home') {
            badgeClass = 'badge-wfh';
            badgeLabel = `🟠 WFH (${att.checkIn})`;
          } else if (att.status === 'Leave') {
            badgeClass = 'badge-leave';
            badgeLabel = `🔴 On Leave`;
          }

          locCell = `
            <td>
              <div style="display:flex; flex-direction:column; gap:3px;">
                <div style="display:flex; align-items:center; gap:6px;">
                  <span class="badge ${badgeClass}" style="font-size:0.7rem; padding:2px 7px;">${badgeLabel}</span>
                </div>
                ${renderAdminLocationCell(att)}
              </div>
            </td>
          `;
        } else {
          locCell = `
            <td>
              <div style="display:flex; flex-direction:column; gap:2px;">
                <span class="badge badge-secondary" style="font-size:0.7rem; padding:2px 7px; background:#F1F5F9; color:#64748B; width:fit-content;">
                  ⚪ Not Checked In
                </span>
                <span style="font-size:0.71rem; color:var(--text-muted); font-style:italic;">Location unavailable</span>
              </div>
            </td>
          `;
        }

        const isOnline = WorkPulseDB.isStaffOnline(staff.id);
        const onlineBadge = isOnline
          ? `<span class="badge" style="background:#ECFDF5; color:#059669; font-size:0.67rem; padding:1px 6px; font-weight:700; margin-left:6px;"><span class="pulse-dot pulse-dot-green" style="margin-right:4px;"></span>Online</span>`
          : `<span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.67rem; padding:1px 6px; font-weight:600; margin-left:6px;"><span class="pulse-dot pulse-dot-gray" style="margin-right:4px;"></span>Offline</span>`;

        return `
          <tr>
            <td style="font-weight:700; color:var(--royal-blue); font-size:0.8rem;">${staff.id}</td>
            <td>
              <div class="d-flex align-items-center gap-2">
                ${renderStaffAvatar(staff, 36)}
                <div>
                  <div style="font-weight:700; color:var(--navy-dark); display:flex; align-items:center;">
                    <span>${staff.name}</span>
                    ${onlineBadge}
                  </div>
                  <div style="font-size:0.72rem; color:var(--text-muted);">${staff.email}</div>
                </div>
              </div>
            </td>
            <td style="font-size:0.84rem; font-weight:600;">${staff.position}</td>
            <td style="font-size:0.82rem; font-family:var(--font-sans); color:var(--text-muted);">${staff.mobile}</td>
            <td style="font-size:0.78rem; max-width:240px; color:var(--text-muted);" title="${staff.address}">${staff.address}</td>
            ${locCell}
            <td class="text-center">
              <span class="badge ${staff.status === 'Active' ? 'badge-present' : 'badge-sunday'} btn-toggle-status" data-id="${staff.id}" style="cursor:pointer;" title="Click to toggle status">
                ${staff.status === 'Active' ? '● Active' : '○ Inactive'}
              </span>
            </td>
            <td class="text-end">
              <div class="d-flex gap-1 justify-content-end">
                <button class="btn btn-secondary btn-sm btn-view-calendar" data-id="${staff.id}" title="View Monthly Calendar & Location Dossier" style="padding:4px 8px; font-size:0.74rem;">
                  📅 Calendar
                </button>
                <button class="btn btn-secondary btn-sm btn-edit-staff" data-id="${staff.id}" title="Edit Staff" style="padding:4px 8px; font-size:0.74rem;">
                  ✏️
                </button>
                <button class="btn btn-secondary btn-sm btn-delete-staff" data-id="${staff.id}" title="Delete Staff" style="padding:4px 8px; font-size:0.74rem; color:#DC2626;">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Wire row actions
      tbody.querySelectorAll('.btn-view-calendar').forEach(b => {
        b.addEventListener('click', () => openStaffDossier(b.dataset.id));
      });

      tbody.querySelectorAll('.btn-toggle-status').forEach(b => {
        b.addEventListener('click', () => {
          const newStatus = WorkPulseDB.toggleStaffStatus(b.dataset.id);
          showToast(`Staff status updated to ${newStatus}.`, 'info');
          renderStaffDirectory(searchQuery);
          renderDashboard();
        });
      });

      tbody.querySelectorAll('.btn-edit-staff').forEach(b => {
        b.addEventListener('click', () => openEditStaffModal(b.dataset.id));
      });

      tbody.querySelectorAll('.btn-delete-staff').forEach(b => {
        b.addEventListener('click', async () => {
          const staff = WorkPulseDB.getStaffById(b.dataset.id);
          if (staff && confirm(`Are you sure you want to delete staff member "${staff.name}" (${staff.id})? This will permanently delete their profile and all associated records.`)) {
            WorkPulseDB.deleteStaff(staff.id);
            if (typeof fetch === 'function') {
              try {
                await fetch('/api/staff/' + encodeURIComponent(staff.id), {
                  method: 'DELETE',
                  headers: WorkPulseDB.getAuthHeaders()
                });
              } catch (e) {
                console.warn('Backend staff delete notice:', e);
              }
            }
            showToast(`Deleted ${staff.name} from records.`, 'warning');
            renderStaffDirectory(searchQuery);
            renderDashboard();
          }
        });
      });
    }
  }

  // Filter input bindings
  document.getElementById('staff-search-input')?.addEventListener('input', (e) => {
    renderStaffDirectory(e.target.value.trim());
  });
  document.getElementById('staff-status-filter')?.addEventListener('change', () => {
    const q = document.getElementById('staff-search-input')?.value.trim() || '';
    renderStaffDirectory(q);
  });

  // --------------------------------------------------------------------------
  // 6. DOSSIER & 5-COLOR ATTENDANCE CALENDAR MODAL
  // --------------------------------------------------------------------------
  function openStaffDossier(staffId, year, month) {
    const now = new Date();
    if (year === undefined || year === null) year = now.getFullYear();
    if (month === undefined || month === null) month = now.getMonth();

    activeDossierStaffId = staffId;
    activeDossierYear = year;
    activeDossierMonth = month;

    const staff = WorkPulseDB.getStaffById(staffId);
    if (!staff) return;

    // Populate Hero
    document.getElementById('dossier-name').textContent = staff.name;
    document.getElementById('dossier-pos').textContent = staff.position;
    document.getElementById('dossier-id').textContent = staff.id;
    document.getElementById('dossier-mobile').textContent = staff.mobile;
    document.getElementById('dossier-address').textContent = staff.address;
    const dossierAvatarEl = document.getElementById('dossier-avatar');
    if (dossierAvatarEl) {
      if (staff.photo) {
        dossierAvatarEl.innerHTML = `<img src="${staff.photo}" alt="${staff.name}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;" onerror="this.outerHTML='${getInitials(staff.name)}'">`;
      } else {
        dossierAvatarEl.textContent = getInitials(staff.name);
      }
    }
    
    const badgeStatus = document.getElementById('dossier-status-badge');
    if (badgeStatus) {
      badgeStatus.className = `badge ${staff.status === 'Active' ? 'badge-present' : 'badge-sunday'}`;
      badgeStatus.textContent = `${staff.status} Staff`;
    }

    // Populate Today's Attendance & Geolocation Strip
    const todayStr = (WorkPulseDB && typeof WorkPulseDB.getTodayDateString === 'function') 
      ? WorkPulseDB.getTodayDateString() 
      : new Date().toISOString().split('T')[0];
    const todayRec = WorkPulseDB.getAttendance({ staffId: staff.id, date: todayStr })[0];
    const locStrip = document.getElementById('dossier-location-strip');
    const locBadge = document.getElementById('dossier-today-status-badge');
    const locText = document.getElementById('dossier-today-location-text');
    const locTime = document.getElementById('dossier-today-time-text');
    const mapLink = document.getElementById('btn-dossier-map-link');

    if (locStrip) {
      if (todayRec && todayRec.checkIn && todayRec.checkIn !== '--:--') {
        locStrip.style.borderLeftColor = 'var(--color-present)';
        if (locBadge) {
          locBadge.className = 'badge badge-present';
          locBadge.style.background = '';
          locBadge.style.color = '';
          locBadge.textContent = `🟢 ${todayRec.status} (In: ${todayRec.checkIn})`;
        }
        const lat = (todayRec.coords && typeof todayRec.coords.latitude === 'number') ? todayRec.coords.latitude : (typeof todayRec.latitude === 'number' && !isNaN(todayRec.latitude) ? todayRec.latitude : null);
        const lng = (todayRec.coords && typeof todayRec.coords.longitude === 'number') ? todayRec.coords.longitude : (typeof todayRec.longitude === 'number' && !isNaN(todayRec.longitude) ? todayRec.longitude : null);
        const hasCoords = lat !== null && lng !== null;
        const displayLoc = todayRec.address || (hasCoords ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : (todayRec.location && !todayRec.location.toLowerCase().includes('unavailable') && !todayRec.location.toLowerCase().includes('pending') ? todayRec.location : 'Location unavailable'));
        if (locText) {
          const accVal = (todayRec.coords && todayRec.coords.accuracy) ? todayRec.coords.accuracy : todayRec.accuracy;
          const accStr = accVal ? ` (±${Math.round(accVal)}m)` : '';
          locText.textContent = `${displayLoc}${accStr}`;
        }
        if (locTime) {
          locTime.textContent = `Check-In: ${todayRec.checkIn} | Check-Out: ${todayRec.checkOut} | Shift: ${todayRec.workingHours}`;
        }
        if (mapLink) {
          let mapUrl = todayRec.mapUrl || (hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : '');
          if (mapUrl) {
            mapLink.href = mapUrl;
            mapLink.style.display = 'inline-flex';
          } else {
            mapLink.style.display = 'none';
          }
        }
      } else {
        locStrip.style.borderLeftColor = '#94A3B8';
        if (locBadge) {
          locBadge.className = 'badge badge-secondary';
          locBadge.style.background = '#F1F5F9';
          locBadge.style.color = '#64748B';
          locBadge.textContent = '⚪ Not Checked In Today';
        }
        if (locText) {
          locText.textContent = 'Location unavailable';
        }
        if (locTime) {
          locTime.textContent = 'Awaiting check-in for current shift';
        }
        if (mapLink) {
          mapLink.style.display = 'none';
        }
      }
    }

    // Monthly summary calculation
    const summary = WorkPulseDB.getMonthSummaryForStaff(staffId, year, month);
    document.getElementById('dossier-stat-working-days').textContent = summary.totalWorkingDays;
    document.getElementById('dossier-stat-present').textContent = summary.presentDays;
    document.getElementById('dossier-stat-halfday').textContent = summary.halfDays;
    document.getElementById('dossier-stat-leave').textContent = summary.leaveDays;
    document.getElementById('dossier-stat-wfh').textContent = summary.wfhDays;
    document.getElementById('dossier-stat-pct').textContent = summary.attendancePercentage;

    // Month Label
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('dossier-month-label').textContent = `${monthNames[month]} ${year}`;

    // Render Calendar Grid (7 columns: Mon, Tue, Wed, Thu, Fri, Sat, Sun)
    renderCalendarGrid(staffId, year, month);

    dossierModal.classList.add('open');
  }

  // --------------------------------------------------------------------------
  // INTERACTIVE CALENDAR HOVER TOOLTIP SINGLETON
  // --------------------------------------------------------------------------
  let calendarTooltipEl = document.getElementById('wp-calendar-tooltip');
  if (!calendarTooltipEl) {
    calendarTooltipEl = document.createElement('div');
    calendarTooltipEl.id = 'wp-calendar-tooltip';
    calendarTooltipEl.className = 'wp-calendar-tooltip';
    document.body.appendChild(calendarTooltipEl);
  }

  function showCalendarTooltip(e, dateStr, rec) {
    if (!calendarTooltipEl) return;

    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedDate = `${dayNames[dateObj.getDay()]}, ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(dateStr) : `${String(dateObj.getDate()).padStart(2, '0')}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${dateObj.getFullYear()}`}`;

    const todayStr = (WorkPulseDB && typeof WorkPulseDB.getTodayDateString === 'function') 
      ? WorkPulseDB.getTodayDateString() 
      : new Date().toISOString().split('T')[0];
    const isWeeklyOff = WorkPulseDB.isDateWeeklyOff(dateStr);
    const isFuture = dateStr > todayStr;

    let status = rec?.status;
    let checkIn = rec?.checkIn;
    let checkOut = rec?.checkOut;
    let hours = rec?.workingHours;
    let location = rec?.location;
    let notes = rec?.notes;

    if (!rec) {
      if (isWeeklyOff) {
        status = 'Weekly Off';
        checkIn = '--:--';
        checkOut = '--:--';
        hours = '0h 00m';
        location = 'N/A';
        notes = 'Weekly Off (Excluded from divisor)';
      } else if (isFuture) {
        status = 'Scheduled';
        checkIn = '--:--';
        checkOut = '--:--';
        hours = '0h 00m';
        location = 'N/A';
        notes = 'Future Scheduled Date';
      } else {
        status = 'Absent';
        checkIn = '--:--';
        checkOut = '--:--';
        hours = '0h 00m';
        location = 'N/A';
        notes = 'No attendance recorded for this date';
      }
    } else {
      checkIn = checkIn || '--:--';
      checkOut = checkOut || '--:--';
      hours = hours || '0h 00m';
      location = location || 'Verified Location';
      notes = notes || 'Shift recorded';
    }

    let badgeClass = 'badge-present';
    let icon = '🟢';
    if (status === 'Half Day') { badgeClass = 'badge-halfday'; icon = '🟤'; }
    else if (status === 'Leave' || status === 'Absent') { badgeClass = 'badge-leave'; icon = '🔴'; }
    else if (status === 'Work From Home') { badgeClass = 'badge-wfh'; icon = '🟠'; }
    else if (status === 'Weekly Off' || status === 'Sunday') { badgeClass = 'badge-sunday'; icon = '⚪'; }
    else if (status === 'Scheduled' || status === 'Future') { badgeClass = 'badge-future'; icon = '⚪'; }

    let checkoutPolicyNote = (checkOut === '--:--' && checkIn !== '--:--') ? '<span style="font-size:0.68rem; color:#10B981; display:block;">(Shift Active)</span>' : '';

    calendarTooltipEl.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-date">${formattedDate}</span>
        <span class="tooltip-badge ${badgeClass}">${icon} ${status}</span>
      </div>
      <div class="tooltip-row">
        <span class="label">Check-In:</span>
        <span class="val">${checkIn}</span>
      </div>
      <div class="tooltip-row">
        <span class="label">Check-Out:</span>
        <span class="val">${checkOut} ${checkoutPolicyNote}</span>
      </div>
      <div class="tooltip-row">
        <span class="label">Working Duration:</span>
        <span class="val" style="color:var(--gold-soft); font-weight:700;">${hours}</span>
      </div>
      <div class="tooltip-row">
        <span class="label">Telemetry:</span>
        <span class="val" style="font-size:0.72rem;">${location}</span>
      </div>
      ${notes ? `<div class="tooltip-note">${notes}</div>` : ''}
      <div class="tooltip-footer">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>Click day cell to open full audit dossier</span>
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

  function renderCalendarGrid(staffId, year, month) {
    const grid = document.getElementById('dossier-calendar-grid');
    if (!grid) return;

    // Headers (Mon - Sun)
    const headersHtml = `
      <div class="calendar-day-header">Mon</div>
      <div class="calendar-day-header">Tue</div>
      <div class="calendar-day-header">Wed</div>
      <div class="calendar-day-header">Thu</div>
      <div class="calendar-day-header">Fri</div>
      <div class="calendar-day-header">Sat</div>
      <div class="calendar-day-header sunday-header">Sun</div>
    `;

    // Calculation: 1st of month day of week
    const firstDay = new Date(year, month, 1);
    let startDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday
    const offset = (startDayOfWeek === 0) ? 6 : startDayOfWeek - 1;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = (WorkPulseDB && typeof WorkPulseDB.getTodayDateString === 'function') 
      ? WorkPulseDB.getTodayDateString() 
      : new Date().toISOString().split('T')[0];

    // Fetch month records
    const records = WorkPulseDB.getAttendance({ staffId });
    const recordsByDay = {};
    records.forEach(r => {
      const parts = r.date.split('-');
      if (parseInt(parts[0], 10) === year && parseInt(parts[1], 10) === (month + 1)) {
        recordsByDay[r.dayNumber] = r;
      }
    });

    let cellsHtml = headersHtml;

    // 1. Empty offset padding cells before 1st of month
    for (let i = 0; i < offset; i++) {
      cellsHtml += `<div class="cal-day-cell cal-day-empty" style="background:transparent; border-color:transparent; cursor:default;"></div>`;
    }

    // 2. Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isWeeklyOff = WorkPulseDB.isDateWeeklyOff(dateStr);
      const isFuture = dateStr > todayStr;
      const rec = recordsByDay[day];

      let status = '';
      let hours = '0h 00m';
      let cellClass = 'status-present';
      let icon = '🟢';
      let label = 'Present';

      if (rec) {
        status = rec.status;
        hours = rec.workingHours || '0h 00m';
        if (status === 'Half Day') {
          cellClass = 'status-halfday'; icon = '🟤'; label = 'Half Day';
        } else if (status === 'Leave') {
          cellClass = 'status-leave'; icon = '🔴'; label = 'Leave';
        } else if (status === 'Work From Home') {
          cellClass = 'status-wfh'; icon = '🟠'; label = 'WFH';
        } else if (status === 'Sunday' || status === 'Weekly Off') {
          cellClass = 'status-sunday'; icon = '⚪'; label = 'Weekly Off'; hours = 'Off';
        } else {
          cellClass = 'status-present'; icon = '🟢'; label = 'Present';
        }
      } else {
        if (isWeeklyOff) {
          status = 'Weekly Off'; cellClass = 'status-sunday'; icon = '⚪'; label = 'Weekly Off'; hours = 'Off';
        } else if (isFuture) {
          status = 'Scheduled'; cellClass = 'status-future'; icon = '⚪'; label = 'Scheduled'; hours = '--:--';
        } else {
          status = 'Absent'; cellClass = 'status-leave'; icon = '🔴'; label = 'Absent'; hours = '0h 00m';
        }
      }

      cellsHtml += `
        <div class="cal-day-cell ${cellClass}" data-day="${day}" data-date="${dateStr}">
          <div class="d-flex justify-content-between align-items-center">
            <span class="cal-date-num">${day}</span>
            <span style="font-size:0.75rem;">${icon}</span>
          </div>
          <div>
            <div class="cal-status-label">${label}</div>
            <div class="cal-hours-sub">${(status === 'Weekly Off' || status === 'Sunday') ? 'Off' : hours}</div>
          </div>
        </div>
      `;
    }

    grid.innerHTML = cellsHtml;

    // Attach click and rich hover listeners for Day Detail Modal & Tooltip
    grid.querySelectorAll('.cal-day-cell:not(.cal-day-empty)').forEach(cell => {
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
        openDayDetailModal(staffId, dateStr, rec);
      });
    });
  }

  // Month navigation in Dossier
  document.getElementById('btn-dossier-prev-month')?.addEventListener('click', () => {
    let m = activeDossierMonth - 1;
    let y = activeDossierYear;
    if (m < 0) { m = 11; y--; }
    openStaffDossier(activeDossierStaffId, y, m);
  });

  document.getElementById('btn-dossier-next-month')?.addEventListener('click', () => {
    let m = activeDossierMonth + 1;
    let y = activeDossierYear;
    if (m > 11) { m = 0; y++; }
    openStaffDossier(activeDossierStaffId, y, m);
  });

  // Modal Closers & Print Handlers
  document.getElementById('btn-close-dossier-modal')?.addEventListener('click', () => dossierModal.classList.remove('open'));
  document.getElementById('btn-dossier-close-foot')?.addEventListener('click', () => dossierModal.classList.remove('open'));
  document.getElementById('btn-dossier-print')?.addEventListener('click', () => {
    document.body.classList.add('printing-dossier');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-dossier');
    }, 1000);
  });

  document.getElementById('btn-close-add-modal')?.addEventListener('click', () => addStaffModal.classList.remove('open'));
  document.getElementById('btn-cancel-add-staff')?.addEventListener('click', () => addStaffModal.classList.remove('open'));
  document.getElementById('btn-close-edit-modal')?.addEventListener('click', () => editStaffModal.classList.remove('open'));
  document.getElementById('btn-cancel-edit-staff')?.addEventListener('click', () => editStaffModal.classList.remove('open'));
  document.getElementById('btn-close-day-detail')?.addEventListener('click', () => dayDetailModal.classList.remove('open'));
  document.getElementById('btn-close-day-foot')?.addEventListener('click', () => dayDetailModal.classList.remove('open'));

  // Universal Modal Dismissal (Click outside dialog or press Escape)
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        if ((modal.id === 'domain-modal' && typeof isSavingDomain !== 'undefined' && isSavingDomain) ||
            (modal.id === 'client-modal' && typeof isSavingClient !== 'undefined' && isSavingClient) ||
            (modal.id === 'client-payment-modal' && typeof isSavingClientPayment !== 'undefined' && isSavingClientPayment)) {
          return; // Do not dismiss modal while save is in progress
        }
        modal.classList.remove('open');
        modal.style.display = '';
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ((typeof isSavingDomain !== 'undefined' && isSavingDomain) ||
          (typeof isSavingClient !== 'undefined' && isSavingClient) ||
          (typeof isSavingClientPayment !== 'undefined' && isSavingClientPayment)) {
        return; // Do not dismiss modals while save is in progress
      }
      document.querySelectorAll('.modal-backdrop').forEach(m => {
        m.classList.remove('open');
        m.style.display = '';
      });
      hideCalendarTooltip();
    }
  });

  // Day Detail Modal
  function openDayDetailModal(staffId, dateStr, rec) {
    if (!rec && staffId && dateStr) {
      const all = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getAttendance === 'function')
        ? WorkPulseDB.getAttendance({ staffId, date: dateStr })
        : [];
      rec = all[0] || null;
    }

    if (!staffId && rec) {
      staffId = rec.staffId;
      dateStr = rec.date;
    }

    if (!staffId && !rec) {
      showToast('Unable to load attendance details: Record could not be identified.', 'error');
      return;
    }

    let staff = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getStaffById === 'function')
      ? WorkPulseDB.getStaffById(staffId)
      : null;

    if (!staff && rec) {
      staff = {
        id: rec.staffId || staffId,
        name: rec.staffName || 'Staff Member',
        position: rec.position || 'Employee',
        photo: rec.photo || null
      };
    }

    if (!staff) {
      showToast(`Unable to load attendance record: Staff member (${staffId}) not found.`, 'error');
      return;
    }

    const displayDate = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function')
      ? WorkPulseDB.formatDisplayDate(dateStr)
      : dateStr;

    const titleEl = document.getElementById('day-detail-title');
    if (titleEl) {
      titleEl.textContent = `Timesheet Audit: ${displayDate}`;
    }

    const content = document.getElementById('day-detail-content');
    if (!content) return;

    const todayStr = (WorkPulseDB && typeof WorkPulseDB.getTodayDateString === 'function') 
      ? WorkPulseDB.getTodayDateString() 
      : new Date().toISOString().split('T')[0];
    const isWeeklyOff = (WorkPulseDB && typeof WorkPulseDB.isDateWeeklyOff === 'function') ? WorkPulseDB.isDateWeeklyOff(dateStr) : false;
    const isFuture = dateStr > todayStr;

    const rawStatus = rec ? rec.status : (isWeeklyOff ? 'Weekly Off' : (isFuture ? 'Scheduled' : 'Absent'));
    let statusBadge = '';
    if (rawStatus === 'Present') statusBadge = `<span class="badge badge-present">🟢 Present</span>`;
    else if (rawStatus === 'Half Day') statusBadge = `<span class="badge badge-halfday">🟤 Half Day</span>`;
    else if (rawStatus === 'Leave') statusBadge = `<span class="badge badge-leave">🔴 Leave</span>`;
    else if (rawStatus === 'Work From Home' || rawStatus === 'WFH') statusBadge = `<span class="badge badge-wfh">🟠 Work From Home</span>`;
    else if (rawStatus === 'Sunday' || rawStatus === 'Weekly Off') statusBadge = `<span class="badge badge-sunday">⚪ Weekly Off</span>`;
    else statusBadge = `<span class="badge badge-future">${escapeHtml(rawStatus)}</span>`;

    const checkIn = (rec && rec.checkIn) ? rec.checkIn : '--:--';
    const checkOut = (rec && rec.checkOut) ? rec.checkOut : '--:--';
    const hours = (rec && rec.workingHours) ? rec.workingHours : (isWeeklyOff ? '0h 00m' : (isFuture ? 'Scheduled' : '0h 00m'));

    let checkoutHtml = `<span>${escapeHtml(checkOut)}</span>`;
    if (checkIn !== '--:--' && checkOut === '--:--') {
      if (rec && rec.shiftStatus === 'lunch') {
        checkoutHtml = `<span class="badge" style="font-size:0.65rem; padding:2px 8px; background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;">🍱 On Lunch Break</span>`;
      } else if (rec && rec.shiftStatus === 'inactive') {
        checkoutHtml = `<span class="badge" style="font-size:0.65rem; padding:2px 8px; background:#FEE2E2; color:#991B1B; border:1px solid #FCA5A5;">⏸️ Shift Inactive</span>`;
      } else {
        checkoutHtml = `<span class="badge badge-success" style="font-size:0.65rem; padding:2px 8px; background:#10B981; color:#fff;">🟢 Active Shift</span>`;
      }
    }

    const lat = (rec && rec.coords && typeof rec.coords.latitude === 'number') 
      ? rec.coords.latitude 
      : (rec && typeof rec.latitude === 'number' && !isNaN(rec.latitude) ? rec.latitude : (rec && rec.lat !== undefined && !isNaN(Number(rec.lat)) ? Number(rec.lat) : null));
    const lng = (rec && rec.coords && typeof rec.coords.longitude === 'number') 
      ? rec.coords.longitude 
      : (rec && typeof rec.longitude === 'number' && !isNaN(rec.longitude) ? rec.longitude : (rec && rec.lng !== undefined && !isNaN(Number(rec.lng)) ? Number(rec.lng) : null));
    const hasCoords = lat !== null && lng !== null;

    let mapUrl = (rec && rec.mapUrl) ? rec.mapUrl : '';
    if (!mapUrl && hasCoords) {
      mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    }

    let address = (rec && rec.address) ? rec.address : '';
    if (!address && hasCoords) {
      address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } else if (!address && rec && rec.location && !rec.location.toLowerCase().includes('unavailable') && !rec.location.toLowerCase().includes('absent') && !rec.location.toLowerCase().includes('n/a') && !rec.location.toLowerCase().includes('pending')) {
      address = rec.location;
    }

    const accuracyVal = (rec && rec.coords && typeof rec.coords.accuracy === 'number') 
      ? rec.coords.accuracy 
      : (rec && rec.accuracy ? Number(rec.accuracy) : null);
    const accuracyFormatted = accuracyVal ? (accuracyVal >= 1000 ? `${(accuracyVal / 1000).toFixed(1)}km` : `${Math.round(accuracyVal)}m`) : '';
    const accuracyText = accuracyFormatted ? ` <span style="font-size:0.7rem; color:#64748B; font-weight:normal;">(±${accuracyFormatted})</span>` : '';

    let locationHtml = '';
    if (hasCoords || (address && address.trim())) {
      locationHtml = `
        <div style="text-align:right; max-width: 270px;">
          <div style="font-weight:600; color:var(--navy-dark); font-size:0.78rem; line-height:1.35; word-break:break-word;">
            ${escapeHtml(address || 'Recorded GPS Location')}${accuracyText}
          </div>
          ${hasCoords ? `
            <div style="font-size:0.72rem; color:#64748B; margin-top:2px; font-family:var(--font-sans);">
              <strong>Coordinates:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}
            </div>
          ` : ''}
          ${mapUrl ? `
            <div style="margin-top:4px;">
              <a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--royal-blue); font-weight:700; text-decoration:underline; font-size:0.75rem; display:inline-flex; align-items:center; gap:3px;">
                📍 View on Google Maps &rarr;
              </a>
            </div>
          ` : ''}
        </div>
      `;
    } else {
      const fallbackText = rec?.status === 'Leave' 
        ? 'On Approved Leave' 
        : (rec?.status === 'Work From Home' 
          ? (rec.location || 'Approved Remote Work') 
          : (isWeeklyOff ? 'N/A (Weekly Off)' : (isFuture ? 'N/A (Future Date)' : (rec?.location || 'Location unavailable'))));
      locationHtml = `<span style="color:#94A3B8; font-style:italic; font-size:0.78rem;">${escapeHtml(fallbackText)}</span>`;
    }

    const notesHtml = (rec && rec.notes && rec.notes.trim())
      ? escapeHtml(rec.notes.trim())
      : '<span style="color:#94A3B8; font-style:italic;">No audit notes entered for this attendance record.</span>';

    content.innerHTML = `
      <div style="padding: 10px 0;">
        <div class="d-flex align-items-center justify-content-between mb-3 pb-2" style="border-bottom: 1px solid var(--border-color);">
          <div class="d-flex align-items-center gap-3">
            ${renderStaffAvatar(staff, 46)}
            <div>
              <div style="font-size:1.1rem; font-weight:700; color:var(--navy-dark);">${escapeHtml(staff.name)}</div>
              <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(staff.position)} &bull; <span style="font-weight:600;">${escapeHtml(staff.id)}</span></div>
            </div>
          </div>
          ${rec && rec.id ? `
            <div style="text-align:right;">
              <span class="badge" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; font-size:0.68rem; font-family:monospace; padding:3px 7px;">${escapeHtml(rec.id)}</span>
            </div>
          ` : ''}
        </div>

        <div style="background:var(--bg-main); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:14px; display:flex; flex-direction:column; gap:9px;">
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted" style="font-size:0.8rem;">Attendance Date:</span>
            <span style="font-weight:700; color:var(--navy-dark); font-size:0.85rem;">${displayDate} <span style="font-size:0.74rem; font-weight:normal; color:#64748B;">(${dateStr})</span></span>
          </div>
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted" style="font-size:0.8rem;">Attendance Status:</span>
            <span>${statusBadge}</span>
          </div>
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted" style="font-size:0.8rem;">Morning Check-In:</span>
            <span style="font-weight:700; color:var(--navy-dark); font-family:var(--font-sans); font-size:0.85rem;">${escapeHtml(checkIn)}</span>
          </div>
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted" style="font-size:0.8rem;">Evening Check-Out:</span>
            <span style="font-family:var(--font-sans); font-size:0.85rem;">${checkoutHtml}</span>
          </div>
          ${rec && rec.lunchBreak && (rec.lunchBreak.used || rec.lunchBreak.endedAt) ? `
            <div class="d-flex justify-content-between align-items-center">
              <span class="text-muted" style="font-size:0.8rem;">Lunch Break:</span>
              <span style="font-weight:700; color:#92400E; font-size:0.8rem;">🍱 ${escapeHtml(rec.lunchBreak.startedAt)} - ${escapeHtml(rec.lunchBreak.endedAt)} (${rec.lunchBreak.durationMinutes}m)</span>
            </div>
          ` : (rec && rec.shiftStatus === 'lunch' && rec.lunchBreak ? `
            <div class="d-flex justify-content-between align-items-center">
              <span class="text-muted" style="font-size:0.8rem;">Lunch Break:</span>
              <span class="badge" style="background:#FEF3C7; color:#92400E; font-size:0.7rem;">🍱 Ongoing (From ${escapeHtml(rec.lunchBreak.startedAt)})</span>
            </div>
          ` : '')}
          ${rec && (rec.totalInactiveMinutes > 0 || (rec.inactivityPeriods && rec.inactivityPeriods.length > 0)) ? `
            <div class="d-flex justify-content-between align-items-center">
              <span class="text-muted" style="font-size:0.8rem;">Inactivity Pauses:</span>
              <span style="font-weight:700; color:#DC2626; font-size:0.8rem;">⏸️ ${rec.totalInactiveMinutes || 0}m deducted (${(rec.inactivityPeriods || []).length} session${(rec.inactivityPeriods || []).length === 1 ? '' : 's'})</span>
            </div>
          ` : (rec && rec.shiftStatus === 'inactive' && rec.currentInactivityStart ? `
            <div class="d-flex justify-content-between align-items-center">
              <span class="text-muted" style="font-size:0.8rem;">Inactivity Status:</span>
              <span class="badge" style="background:#FEE2E2; color:#991B1B; font-size:0.7rem;">⏸️ Currently Inactive (Since ${escapeHtml(rec.currentInactivityStart.timeStr)})</span>
            </div>
          ` : '')}
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted" style="font-size:0.8rem;">Working Duration:</span>
            <span style="font-weight:700; color:var(--royal-blue); font-size:0.88rem;">${escapeHtml(hours)}</span>
          </div>
          <div class="d-flex justify-content-between align-items-start" style="border-top:1px dashed var(--border-color); padding-top:8px; margin-top:2px;">
            <span class="text-muted" style="font-size:0.8rem; white-space:nowrap; margin-right:12px;">GPS Location:</span>
            ${locationHtml}
          </div>
          <div style="border-top:1px dashed var(--border-color); padding-top:8px; margin-top:2px;">
            <div class="text-muted" style="font-size:0.75rem; font-weight:700; margin-bottom:2px;">Audit Notes:</div>
            <div style="font-size:0.8rem; color:var(--navy-dark);">${notesHtml}</div>
          </div>
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid #e2e8f0;">
            <button class="btn btn-outline-primary btn-sm w-100" id="btn-daydetail-view-timeline" type="button" style="display:flex; align-items:center; justify-content:center; gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>View Full Activity Timeline & History</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-daydetail-view-timeline')?.addEventListener('click', () => {
      dayDetailModal.classList.remove('open');
      openActivityTimelineModal(staffId, dateStr);
    });

    dayDetailModal.classList.add('open');
  }

  window.openDayDetailModal = openDayDetailModal;
  window.viewAttendanceRecordDetails = function(recordId) {
    if (!recordId) {
      showToast('Attendance record ID is missing.', 'error');
      return;
    }

    let rec = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getAttendanceById === 'function')
      ? WorkPulseDB.getAttendanceById(recordId)
      : null;

    if (!rec) {
      const all = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getAttendance === 'function')
        ? WorkPulseDB.getAttendance()
        : [];
      const cleanId = String(recordId).trim().toUpperCase();
      rec = all.find(r => 
        (r.id && String(r.id).trim().toUpperCase() === cleanId) ||
        (r.attendanceId && String(r.attendanceId).trim().toUpperCase() === cleanId)
      );
    }

    if (!rec) {
      showToast(`Unable to load attendance record. Record "${recordId}" was not found.`, 'error');
      return;
    }

    openDayDetailModal(rec.staffId, rec.date, rec);
  };

  // --------------------------------------------------------------------------
  // 7. ADD & EDIT STAFF FORMS (WITH PROFILE PHOTO UPLOAD)
  // --------------------------------------------------------------------------
  let newStaffPhotoData = null;
  const newStaffPhotoInput = document.getElementById('new-staff-photo-input');
  const btnBrowseNewPhoto = document.getElementById('btn-browse-new-photo');
  const newStaffPhotoImg = document.getElementById('new-staff-photo-img');
  const newStaffPhotoPlaceholder = document.getElementById('new-staff-photo-placeholder');
  const newPhotoDefaultControls = document.getElementById('new-photo-default-controls');
  const newPhotoPendingControls = document.getElementById('new-photo-pending-controls');
  const btnSaveNewPhoto = document.getElementById('btn-save-new-photo');
  const btnCancelNewPhoto = document.getElementById('btn-cancel-new-photo');
  const newPhotoMetaText = document.getElementById('new-photo-meta-text');

  function resetNewStaffPhoto() {
    newStaffPhotoData = null;
    if (newStaffPhotoImg) {
      newStaffPhotoImg.src = '';
      newStaffPhotoImg.style.display = 'none';
    }
    if (newStaffPhotoPlaceholder) newStaffPhotoPlaceholder.style.display = 'flex';
    if (newPhotoPendingControls) newPhotoPendingControls.style.display = 'none';
    if (newPhotoDefaultControls) newPhotoDefaultControls.style.display = 'flex';
    if (newStaffPhotoInput) newStaffPhotoInput.value = '';
    if (newPhotoMetaText) newPhotoMetaText.textContent = 'Recommended: Square portrait photo. Automatically resized and optimized.';
  }

  btnBrowseNewPhoto?.addEventListener('click', () => newStaffPhotoInput?.click());

  newStaffPhotoInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      processStaffPhotoFile(e.target.files[0], (dataUrl, err) => {
        if (err) {
          showToast(err, 'error');
          return;
        }
        newStaffPhotoData = dataUrl;
        if (newStaffPhotoImg) {
          newStaffPhotoImg.src = dataUrl;
          newStaffPhotoImg.style.display = 'block';
        }
        if (newStaffPhotoPlaceholder) newStaffPhotoPlaceholder.style.display = 'none';
        if (newPhotoDefaultControls) newPhotoDefaultControls.style.display = 'none';
        if (newPhotoPendingControls) newPhotoPendingControls.style.display = 'flex';
        if (newPhotoMetaText) newPhotoMetaText.textContent = 'Photo preview ready. Click "Save Photo" to confirm for new staff or "Cancel" to discard.';
      });
    }
  });

  btnSaveNewPhoto?.addEventListener('click', () => {
    if (!newStaffPhotoData) return;
    if (newPhotoPendingControls) newPhotoPendingControls.style.display = 'none';
    if (newPhotoDefaultControls) newPhotoDefaultControls.style.display = 'flex';
    if (newPhotoMetaText) newPhotoMetaText.textContent = 'Photo confirmed and ready to save with new staff record.';
    showToast('Profile photo confirmed for new staff member.', 'success');
  });

  btnCancelNewPhoto?.addEventListener('click', () => {
    resetNewStaffPhoto();
    showToast('Photo selection discarded.', 'info');
  });

  const addForm = document.getElementById('add-staff-form');
  const btnSubmitAddStaff = document.getElementById('btn-submit-add-staff');

  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const nameInput = document.getElementById('new-staff-name');
      const posInput = document.getElementById('new-staff-position');
      const mobileInput = document.getElementById('new-staff-mobile');
      const addressInput = document.getElementById('new-staff-address');
      const emailInput = document.getElementById('new-staff-email');
      const passwordInput = document.getElementById('new-staff-password');

      const name = nameInput ? nameInput.value.trim() : '';
      const position = posInput ? posInput.value.trim() : '';
      const mobile = mobileInput ? mobileInput.value.trim() : '';
      const address = addressInput ? addressInput.value.trim() : '';
      const rawEmail = emailInput ? emailInput.value.trim() : '';
      const rawPassword = passwordInput ? passwordInput.value.trim() : '';

      // Frontend field validation
      if (!name) {
        showToast('Please enter the Staff Full Name.', 'error');
        nameInput?.focus();
        return;
      }
      if (name.length < 2) {
        showToast('Please provide a valid full name (at least 2 characters).', 'error');
        nameInput?.focus();
        return;
      }
      if (!position) {
        showToast('Please enter the Position / Job Title.', 'error');
        posInput?.focus();
        return;
      }
      if (!mobile) {
        showToast('Please enter a Mobile Number.', 'error');
        mobileInput?.focus();
        return;
      }
      const digits = mobile.replace(/\D/g, '');
      if (digits.length < 7) {
        showToast('Please enter a valid mobile number with at least 7 digits.', 'error');
        mobileInput?.focus();
        return;
      }
      if (!address) {
        showToast('Please enter the Residential / Official Address.', 'error');
        addressInput?.focus();
        return;
      }

      // Email formatting and validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      let email = rawEmail;
      if (email && !emailRegex.test(email)) {
        showToast('Please enter a valid email address (e.g. name@workpulse.com).', 'error');
        emailInput?.focus();
        return;
      }
      if (!email) {
        email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@workpulse.com`;
      }
      const cleanEmail = email.toLowerCase().trim();
      const cleanPassword = rawPassword || 'password123';

      // Frontend duplicate validation against active roster
      const currentStaff = WorkPulseDB.getStaffList();
      const dupEmail = currentStaff.find(s => s.email && s.email.toLowerCase().trim() === cleanEmail);
      if (dupEmail) {
        showToast(`A staff member with email "${cleanEmail}" already exists (${dupEmail.name} - ${dupEmail.id}).`, 'error');
        emailInput?.focus();
        return;
      }
      const dupMobile = currentStaff.find(s => s.mobile && s.mobile.replace(/\D/g, '') === digits);
      if (dupMobile) {
        showToast(`A staff member with mobile number "${mobile}" already exists (${dupMobile.name} - ${dupMobile.id}).`, 'error');
        mobileInput?.focus();
        return;
      }

      // Set button to loading state
      if (btnSubmitAddStaff) {
        btnSubmitAddStaff.disabled = true;
        btnSubmitAddStaff.textContent = 'Registering Staff...';
      }

      const payload = {
        name,
        position,
        mobile,
        address,
        email: cleanEmail,
        password: cleanPassword,
        status: 'Active',
        photo: newStaffPhotoData || null
      };

      try {
        let createdStaff = null;

        // Persist to backend API if running via server
        if (window.location && window.location.protocol.startsWith('http')) {
          const res = await fetch('/api/staff', {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload)
          });
          const json = await res.json();

          if (!res.ok || !json.success) {
            showToast(json.error || 'Failed to register staff member on the server.', 'error');
            if (btnSubmitAddStaff) {
              btnSubmitAddStaff.disabled = false;
              btnSubmitAddStaff.textContent = 'Register Staff';
            }
            return;
          }
          createdStaff = json.data;
        }

        // Synchronize with local database engine
        if (createdStaff) {
          WorkPulseDB.addStaff(createdStaff);
        } else {
          createdStaff = WorkPulseDB.addStaff(payload);
        }

        // Reset form and photo preview
        addForm.reset();
        resetNewStaffPhoto();
        addStaffModal.classList.remove('open');

        showToast(`Staff member ${createdStaff.name} (${createdStaff.id}) registered successfully!`, 'success');

        // Immediately refresh Staff Directory and all related views
        renderStaffDirectory();
        renderDashboard();
        if (typeof populateStaffDropdown === 'function') populateStaffDropdown();
        if (typeof populateActivityStaffDropdown === 'function') populateActivityStaffDropdown();
        if (typeof populateStaffFilters === 'function') populateStaffFilters();

      } catch (err) {
        console.error('[Add Staff Error]', err);
        showToast(`An unexpected error occurred during registration: ${err.message}`, 'error');
      } finally {
        if (btnSubmitAddStaff) {
          btnSubmitAddStaff.disabled = false;
          btnSubmitAddStaff.textContent = 'Register Staff';
        }
      }
    });
  }

  const closeAddModal = () => {
    resetNewStaffPhoto();
    addStaffModal.classList.remove('open');
  };
  document.getElementById('btn-cancel-add-staff')?.addEventListener('click', closeAddModal);
  document.getElementById('btn-close-add-modal')?.addEventListener('click', closeAddModal);

  // Edit Staff Photo Bindings
  let editStaffPhotoData = null;
  let originalStaffPhoto = null;
  const editStaffPhotoInput = document.getElementById('edit-staff-photo-input');
  const btnBrowseEditPhoto = document.getElementById('btn-browse-edit-photo');
  const editStaffPhotoImg = document.getElementById('edit-staff-photo-img');
  const editStaffPhotoPlaceholder = document.getElementById('edit-staff-photo-placeholder');
  const editStaffPhotoInitials = document.getElementById('edit-staff-photo-initials');
  const editPhotoDefaultControls = document.getElementById('edit-photo-default-controls');
  const editPhotoPendingControls = document.getElementById('edit-photo-pending-controls');
  const btnSaveEditPhoto = document.getElementById('btn-save-edit-photo');
  const btnCancelEditPhoto = document.getElementById('btn-cancel-edit-photo');
  const editPhotoMetaText = document.getElementById('edit-photo-meta-text');

  btnBrowseEditPhoto?.addEventListener('click', () => editStaffPhotoInput?.click());

  editStaffPhotoInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      processStaffPhotoFile(e.target.files[0], (dataUrl, err) => {
        if (err) {
          showToast(err, 'error');
          return;
        }
        editStaffPhotoData = dataUrl;
        if (editStaffPhotoImg) {
          editStaffPhotoImg.src = dataUrl;
          editStaffPhotoImg.style.display = 'block';
        }
        if (editStaffPhotoPlaceholder) editStaffPhotoPlaceholder.style.display = 'none';
        
        // Show pending action controls: Save Photo & Cancel
        if (editPhotoDefaultControls) editPhotoDefaultControls.style.display = 'none';
        if (editPhotoPendingControls) editPhotoPendingControls.style.display = 'flex';
        if (editPhotoMetaText) editPhotoMetaText.textContent = 'New photo selected. Click "Save Photo" to save to profile or "Cancel" to discard.';
      });
    }
  });

  // Dedicated "Save Photo" action button: immediately saves photo to DB & updates all views
  btnSaveEditPhoto?.addEventListener('click', () => {
    const staffId = document.getElementById('edit-staff-id')?.value;
    if (!staffId) return;
    const staff = WorkPulseDB.getStaffById(staffId);

    // Save photo directly to database
    WorkPulseDB.updateStaff(staffId, { photo: editStaffPhotoData });
    originalStaffPhoto = editStaffPhotoData;

    // Reset controls to saved default state
    if (editPhotoPendingControls) editPhotoPendingControls.style.display = 'none';
    if (editPhotoDefaultControls) editPhotoDefaultControls.style.display = 'flex';
    if (editStaffPhotoInput) editStaffPhotoInput.value = '';

    if (editPhotoMetaText) editPhotoMetaText.textContent = 'Profile photo saved successfully.';

    // Synchronize all lists, tables, and open dossier modal
    renderStaffDirectory();
    renderDashboard();
    renderAttendanceLog();
    renderLeavesTable();
    renderWfhTable();
    renderReports();

    // If dossier modal is currently open with this staff member, update its avatar immediately
    if (activeDossierStaffId === staffId) {
      const dossierAvatarEl = document.getElementById('dossier-avatar');
      if (dossierAvatarEl) {
        if (editStaffPhotoData) {
          dossierAvatarEl.innerHTML = `<img src="${editStaffPhotoData}" alt="${staff ? staff.name : 'Staff'}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;" onerror="this.outerHTML='${getInitials(staff ? staff.name : 'Staff')}'">`;
        } else {
          dossierAvatarEl.textContent = getInitials(staff ? staff.name : 'Staff');
        }
      }
    }

    showToast(`Profile photo saved successfully for ${staff ? staff.name : 'staff member'}!`, 'success');
  });

  // Dedicated "Cancel" action button: discards selected photo and restores previous state
  btnCancelEditPhoto?.addEventListener('click', () => {
    editStaffPhotoData = originalStaffPhoto;
    if (editStaffPhotoInput) editStaffPhotoInput.value = '';

    if (originalStaffPhoto) {
      if (editStaffPhotoImg) {
        editStaffPhotoImg.src = originalStaffPhoto;
        editStaffPhotoImg.style.display = 'block';
      }
      if (editStaffPhotoPlaceholder) editStaffPhotoPlaceholder.style.display = 'none';
    } else {
      if (editStaffPhotoImg) {
        editStaffPhotoImg.src = '';
        editStaffPhotoImg.style.display = 'none';
      }
      if (editStaffPhotoPlaceholder) editStaffPhotoPlaceholder.style.display = 'flex';
      const staffName = document.getElementById('edit-staff-name')?.value || 'Staff';
      if (editStaffPhotoInitials) editStaffPhotoInitials.textContent = getInitials(staffName);
    }

    if (editPhotoPendingControls) editPhotoPendingControls.style.display = 'none';
    if (editPhotoDefaultControls) editPhotoDefaultControls.style.display = 'flex';
    if (editPhotoMetaText) editPhotoMetaText.textContent = "Upload a new photo to update this staff member's avatar and profile.";

    showToast('Photo selection discarded.', 'info');
  });

  function resetEditStaffPhotoUI() {
    if (editPhotoPendingControls) editPhotoPendingControls.style.display = 'none';
    if (editPhotoDefaultControls) editPhotoDefaultControls.style.display = 'flex';
    if (editStaffPhotoInput) editStaffPhotoInput.value = '';
    if (editPhotoMetaText) editPhotoMetaText.textContent = "Upload a new photo to update this staff member's avatar and profile.";
  }

  function openEditStaffModal(staffId) {
    const staff = WorkPulseDB.getStaffById(staffId);
    if (!staff) return;

    document.getElementById('edit-staff-id').value = staff.id;
    document.getElementById('edit-staff-name').value = staff.name;
    document.getElementById('edit-staff-position').value = staff.position;
    document.getElementById('edit-staff-mobile').value = staff.mobile;
    const editEmailEl = document.getElementById('edit-staff-email');
    if (editEmailEl) editEmailEl.value = staff.email || '';
    document.getElementById('edit-staff-address').value = staff.address;
    document.getElementById('edit-staff-status').value = staff.status;

    resetEditStaffPhotoUI();

    // Populate photo preview in edit modal
    originalStaffPhoto = staff.photo || null;
    editStaffPhotoData = staff.photo || null;
    if (staff.photo) {
      if (editStaffPhotoImg) {
        editStaffPhotoImg.src = staff.photo;
        editStaffPhotoImg.style.display = 'block';
      }
      if (editStaffPhotoPlaceholder) editStaffPhotoPlaceholder.style.display = 'none';
    } else {
      if (editStaffPhotoImg) {
        editStaffPhotoImg.src = '';
        editStaffPhotoImg.style.display = 'none';
      }
      if (editStaffPhotoPlaceholder) editStaffPhotoPlaceholder.style.display = 'flex';
      if (editStaffPhotoInitials) editStaffPhotoInitials.textContent = getInitials(staff.name);
    }

    editStaffModal.classList.add('open');
  }

  const editForm = document.getElementById('edit-staff-form');
  if (editForm) {
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-staff-id').value;
      const name = document.getElementById('edit-staff-name').value.trim();
      const position = document.getElementById('edit-staff-position').value.trim();
      const mobile = document.getElementById('edit-staff-mobile').value.trim();
      const email = document.getElementById('edit-staff-email')?.value.trim() || '';
      const address = document.getElementById('edit-staff-address').value.trim();
      const status = document.getElementById('edit-staff-status').value;

      const updatePayload = { name, position, mobile, email, address, status };
      if (editStaffPhotoData !== null) {
        updatePayload.photo = editStaffPhotoData;
      }

      WorkPulseDB.updateStaff(id, updatePayload);
      resetEditStaffPhotoUI();
      editStaffModal.classList.remove('open');
      showToast(`Updated details for ${name}.`, 'success');
      renderStaffDirectory();
      renderDashboard();
      renderAttendanceLog();
      renderLeavesTable();
      renderWfhTable();
      renderReports();
    });
  }

  document.getElementById('btn-cancel-edit-staff')?.addEventListener('click', resetEditStaffPhotoUI);
  document.getElementById('btn-close-edit-modal')?.addEventListener('click', resetEditStaffPhotoUI);


  // --------------------------------------------------------------------------
  // 8. VIEW 3: MASTER ATTENDANCE RECORDS LOG
  // --------------------------------------------------------------------------
  function populateStaffDropdown() {
    const select = document.getElementById('att-filter-staff');
    if (!select) return;
    const staffList = WorkPulseDB.getStaffList();
    select.innerHTML = `<option value="All">All Staff Members</option>` + 
      staffList.map(s => `<option value="${s.id}">${s.name} (${s.id})</option>`).join('');
  }

  function renderAttendanceLog() {
    populateStaffDropdown();

    const todayDateDefault = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') 
      ? WorkPulseDB.getTodayDateString() 
      : new Date().toISOString().split('T')[0];
    const dateVal = document.getElementById('att-filter-date')?.value || todayDateDefault;
    const staffVal = document.getElementById('att-filter-staff')?.value || 'All';
    const statusVal = document.getElementById('att-filter-status')?.value || 'All';
    const searchKeyword = document.getElementById('att-filter-search')?.value.toLowerCase().trim() || '';

    const filters = {};
    if (dateVal) filters.date = dateVal;
    if (staffVal !== 'All') filters.staffId = staffVal;
    if (statusVal !== 'All') filters.status = statusVal;

    let records = WorkPulseDB.getAttendance(filters);

    if (searchKeyword) {
      records = records.filter(r => 
        r.staffName.toLowerCase().includes(searchKeyword) ||
        r.staffId.toLowerCase().includes(searchKeyword) ||
        r.position.toLowerCase().includes(searchKeyword) ||
        (r.location && r.location.toLowerCase().includes(searchKeyword)) ||
        (r.notes && r.notes.toLowerCase().includes(searchKeyword))
      );
    }

    const tbody = document.getElementById('attendance-log-tbody');
    if (!tbody) return;

    if (records.length === 0) {
      tbody.innerHTML = renderEmptyTableState(9, 'No Attendance Logs Found', 'Try adjusting your date range, staff member selector, or status filter.');
      return;
    }

    tbody.innerHTML = records.map(att => {
      let statusBadge = '';
      if (att.status === 'Present') statusBadge = `<span class="badge badge-present">🟢 Present</span>`;
      else if (att.status === 'Half Day') statusBadge = `<span class="badge badge-halfday">🟤 Half Day</span>`;
      else if (att.status === 'Leave') statusBadge = `<span class="badge badge-leave">🔴 Leave</span>`;
      else if (att.status === 'Work From Home') statusBadge = `<span class="badge badge-wfh">🟠 WFH</span>`;
      else if (att.status === 'Sunday') statusBadge = `<span class="badge badge-sunday">⚪ Sunday</span>`;
      else statusBadge = `<span class="badge badge-future">${att.status}</span>`;

      let checkoutHtml = `<span>${att.checkOut}</span>`;
      if (att.checkIn !== '--:--' && att.checkOut === '--:--') {
        if (att.shiftStatus === 'lunch') {
          checkoutHtml = `<span class="badge" style="font-size:0.62rem; padding:2px 6px; background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;" title="Staff is currently on lunch break">🍱 On Lunch</span>`;
        } else if (att.shiftStatus === 'inactive') {
          checkoutHtml = `<span class="badge" style="font-size:0.62rem; padding:2px 6px; background:#FEE2E2; color:#991B1B; border:1px solid #FCA5A5;" title="Shift timer paused due to inactivity">⏸️ Inactive</span>`;
        } else {
          checkoutHtml = `<span class="badge badge-success" style="font-size:0.62rem; padding:2px 6px; background:#10B981; color:#fff;" title="Shift currently active until manual checkout">🟢 Active Shift</span>`;
        }
      } else if (att.checkOut && att.checkOut !== '--:--') {
        checkoutHtml = `<span style="font-weight:700;">${att.checkOut}</span>`;
      }

      return `
        <tr>
          <td style="font-weight:700; color:var(--navy-dark); font-size:0.8rem;">${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(att.date) : att.date}</td>
          <td>
            <div class="d-flex align-items-center gap-2">
              ${renderStaffAvatar(att, 32)}
              <div>
                <div style="font-weight:700; color:var(--navy-dark);">${att.staffName}</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${att.staffId}</div>
              </div>
            </div>
          </td>
          <td style="font-size:0.8rem; color:var(--text-muted);">${att.position}</td>
          <td class="text-center" style="font-family:var(--font-sans); font-weight:700;">${att.checkIn}</td>
          <td class="text-center" style="font-family:var(--font-sans);">${checkoutHtml}</td>
          <td class="text-center" style="font-weight:700; color:var(--royal-blue);">${att.workingHours}</td>
          <td class="text-center">${statusBadge}</td>
          <td style="font-size:0.74rem; color:var(--text-muted); max-width:200px;">
            ${renderAdminLocationCell(att)}
          </td>
          <td class="text-end">
            <button type="button" class="btn btn-secondary btn-sm btn-att-detail" data-id="${escapeHtml(att.id || '')}" data-staff-id="${escapeHtml(att.staffId || '')}" data-date="${escapeHtml(att.date || '')}" onclick="window.viewAttendanceRecordDetails('${escapeHtml(att.id || '')}');" title="View Complete Attendance Details" aria-label="View Attendance Details" style="padding:3px 7px; font-size:0.72rem;">
              View &rarr;
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-att-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const recordId = btn.dataset.id;
        if (recordId) {
          window.viewAttendanceRecordDetails(recordId);
        } else {
          const staffId = btn.dataset.staffId;
          const dateStr = btn.dataset.date;
          const rec = records.find(r => r.staffId === staffId && r.date === dateStr);
          openDayDetailModal(staffId, dateStr, rec);
        }
      });
    });

    if (!tbody._hasAttDelegatedListener) {
      tbody._hasAttDelegatedListener = true;
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-att-detail');
        if (!btn) return;
        if (btn.hasAttribute('onclick')) return;
        e.preventDefault();
        const recordId = btn.dataset.id;
        if (recordId) {
          window.viewAttendanceRecordDetails(recordId);
        }
      });
    }
  }

  window.renderAttendanceLog = renderAttendanceLog;

  // Filter bindings
  document.getElementById('att-filter-date')?.addEventListener('change', renderAttendanceLog);
  document.getElementById('att-filter-staff')?.addEventListener('change', renderAttendanceLog);
  document.getElementById('att-filter-status')?.addEventListener('change', renderAttendanceLog);
  document.getElementById('att-filter-search')?.addEventListener('input', renderAttendanceLog);
  document.getElementById('btn-reset-att-filters')?.addEventListener('click', () => {
    const dateInp = document.getElementById('att-filter-date');
    if (dateInp) dateInp.value = '';
    const staffSel = document.getElementById('att-filter-staff');
    if (staffSel) staffSel.value = 'All';
    const statSel = document.getElementById('att-filter-status');
    if (statSel) statSel.value = 'All';
    const searchInp = document.getElementById('att-filter-search');
    if (searchInp) searchInp.value = '';
    renderAttendanceLog();
  });

  document.getElementById('btn-export-attendance-csv')?.addEventListener('click', () => {
    exportAttendanceAuditCSV();
  });

  document.getElementById('btn-print-attendance')?.addEventListener('click', () => {
    window.print();
  });

  // --------------------------------------------------------------------------
  // 8B. VIEW: STAFF ACTIVITY STATUS & TIMELINE MONITORING
  // --------------------------------------------------------------------------
  let currentTimelineStaffId = null;
  let currentTimelineDateStr = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') 
    ? WorkPulseDB.getTodayDateString() 
    : new Date().toISOString().split('T')[0];

  function shiftDate(dateStr, days) {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + days));
      return dt.toISOString().split('T')[0];
    } catch (e) {
      return dateStr;
    }
  }

  function populateActivityStaffDropdown() {
    const select = document.getElementById('activity-filter-staff');
    if (!select) return;
    const staffList = WorkPulseDB.getStaffList();
    const currentVal = select.value;
    select.innerHTML = `<option value="All">All Staff Members</option>` + 
      staffList.map(s => `<option value="${s.id}">${s.name} (${s.id})</option>`).join('');
    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
      select.value = currentVal;
    }
  }

  function renderActivityStatus() {
    populateActivityStaffDropdown();

    const officeToday = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function')
      ? WorkPulseDB.getTodayDateString()
      : new Date().toISOString().split('T')[0];

    const dateInput = document.getElementById('activity-filter-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = officeToday;
    }
    const dateVal = dateInput?.value || officeToday;
    currentTimelineDateStr = dateVal;

    const staffVal = document.getElementById('activity-filter-staff')?.value || 'All';
    const statusVal = document.getElementById('activity-filter-status')?.value || 'All';
    const searchKeyword = document.getElementById('activity-search-input')?.value.toLowerCase().trim() || '';

    const summaryData = WorkPulseDB.getStaffActivitySummary(dateVal);

    // Update KPIs
    const kpiTotal = document.getElementById('kpi-activity-total');
    const kpiOnline = document.getElementById('kpi-activity-online');
    const kpiActive = document.getElementById('kpi-activity-active');
    const kpiInactive = document.getElementById('kpi-activity-inactive');
    const kpiLunch = document.getElementById('kpi-activity-lunch');
    const kpiCheckedOut = document.getElementById('kpi-activity-checkedout');

    if (kpiTotal) kpiTotal.textContent = summaryData.totalStaff;
    if (kpiOnline) {
      const onlineMap = WorkPulseDB.getOnlineStaffMap();
      const onlineCount = Object.values(onlineMap).filter(o => o.isOnline).length;
      kpiOnline.textContent = onlineCount;
    }
    if (kpiActive) kpiActive.textContent = summaryData.activeCount;
    if (kpiInactive) kpiInactive.textContent = summaryData.inactiveCount;
    if (kpiLunch) kpiLunch.textContent = summaryData.lunchCount;
    if (kpiCheckedOut) kpiCheckedOut.textContent = summaryData.checkedOutCount + (summaryData.notCheckedInCount || 0);

    // Filter staff items
    let items = summaryData.items;

    if (staffVal !== 'All') {
      items = items.filter(it => it.staff.id === staffVal);
    }

    if (statusVal !== 'All') {
      items = items.filter(it => it.currentStatus === statusVal);
    }

    if (searchKeyword) {
      items = items.filter(it => 
        (it.staff.name && it.staff.name.toLowerCase().includes(searchKeyword)) ||
        (it.staff.id && it.staff.id.toLowerCase().includes(searchKeyword)) ||
        (it.staff.position && it.staff.position.toLowerCase().includes(searchKeyword)) ||
        (it.staff.department && it.staff.department.toLowerCase().includes(searchKeyword))
      );
    }

    const tbody = document.getElementById('staff-activity-tbody');
    if (!tbody) return;

    if (items.length === 0) {
      tbody.innerHTML = renderEmptyTableState(9, 'No Staff Activity Records Found', 'Try selecting a different date or clearing the status/search filters.');
      return;
    }

    tbody.innerHTML = items.map(item => {
      let statusBadge = '';
      if (item.currentStatus === 'Active') {
        statusBadge = `<span class="badge-status-active"><span class="pulse-dot pulse-dot-green"></span>Active</span>`;
      } else if (item.currentStatus === 'Inactive') {
        statusBadge = `<span class="badge-status-inactive"><span class="pulse-dot pulse-dot-amber"></span>Inactive</span>`;
      } else if (item.currentStatus === 'On Lunch Break') {
        statusBadge = `<span class="badge-status-lunch"><span class="pulse-dot pulse-dot-blue"></span>On Lunch Break</span>`;
      } else if (item.currentStatus === 'Checked Out') {
        statusBadge = `<span class="badge-status-checkedout"><span class="pulse-dot pulse-dot-gray"></span>Checked Out</span>`;
      } else if (item.currentStatus === 'Not Checked In') {
        statusBadge = `<span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.75rem; font-weight:600;"><span class="pulse-dot pulse-dot-gray"></span>Not Checked In</span>`;
      } else {
        statusBadge = `<span class="badge" style="background:#F1F5F9; color:#475569; font-size:0.75rem; font-weight:600;">${escapeHtml(item.currentStatus || 'Offline')}</span>`;
      }

      const isOnline = item.isOnline !== undefined ? item.isOnline : WorkPulseDB.isStaffOnline(item.staff.id);
      const onlineBadge = isOnline
        ? `<span class="badge" style="background:#ECFDF5; color:#059669; font-size:0.67rem; padding:1px 6px; font-weight:700; margin-left:6px;"><span class="pulse-dot pulse-dot-green" style="margin-right:4px;"></span>Online</span>`
        : `<span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.67rem; padding:1px 6px; font-weight:600; margin-left:6px;"><span class="pulse-dot pulse-dot-gray" style="margin-right:4px;"></span>Offline</span>`;

      return `
        <tr>
          <td>
            <div class="d-flex align-items-center gap-2">
              ${renderStaffAvatar(item.staff, 34)}
              <div>
                <div style="font-weight:700; color:var(--navy-dark); font-size:0.84rem; display:flex; align-items:center;">
                  <span>${escapeHtml(item.staff.name)}</span>
                  ${onlineBadge}
                </div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(item.staff.id)} • ${escapeHtml(item.staff.position || 'Staff')}</div>
              </div>
            </div>
          </td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center" style="font-weight:700; color:var(--royal-blue); font-size:0.83rem;">${escapeHtml(item.currentWorkingDurationFormatted)}</td>
          <td class="text-center" style="font-size:0.82rem; font-weight:600; color:#334155;">${escapeHtml(item.lastActiveTime)}</td>
          <td class="text-center" style="font-size:0.82rem; font-weight:600; color:${item.inactiveStartTime !== '--:--' ? '#d97706' : '#64748b'};">${escapeHtml(item.inactiveStartTime)}</td>
          <td class="text-center" style="font-size:0.82rem; font-weight:600; color:${item.resumeActiveTime !== '--:--' && item.resumeActiveTime !== 'Pending Resume' ? '#059669' : '#64748b'};">${escapeHtml(item.resumeActiveTime)}</td>
          <td class="text-center" style="font-size:0.82rem; font-weight:700; color:#d97706;">${escapeHtml(item.totalInactiveDurationFormatted)}</td>
          <td class="text-center" style="font-size:0.82rem; font-weight:700; color:#2563eb;">${escapeHtml(item.totalLunchDurationFormatted)}</td>
          <td class="text-end">
            <button class="btn btn-secondary btn-sm btn-open-timeline" data-id="${item.staff.id}" data-date="${dateVal}" style="padding:4px 9px; font-size:0.75rem; white-space:nowrap;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Timeline &rarr;
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-open-timeline').forEach(btn => {
      btn.addEventListener('click', () => {
        openActivityTimelineModal(btn.dataset.id, btn.dataset.date);
      });
    });
  }

  function openActivityTimelineModal(staffId, dateStr) {
    currentTimelineStaffId = staffId;
    currentTimelineDateStr = dateStr || (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function' ? WorkPulseDB.getTodayDateString() : new Date().toISOString().split('T')[0]);

    const timelineData = WorkPulseDB.getStaffActivityTimeline(currentTimelineStaffId, currentTimelineDateStr);
    if (!timelineData) return;

    const modal = document.getElementById('staff-activity-timeline-modal');
    if (!modal) return;

    // Staff Info
    const staff = timelineData.staff;
    const nameEl = document.getElementById('modal-activity-staff-name');
    const idEl = document.getElementById('modal-activity-staff-id');
    const roleEl = document.getElementById('modal-activity-staff-role');
    const avatarEl = document.getElementById('modal-activity-avatar');

    if (nameEl) nameEl.textContent = staff.name;
    if (idEl) idEl.textContent = staff.id;
    if (roleEl) roleEl.textContent = `${staff.position} • ${staff.department || 'Operations'}`;
    if (avatarEl) {
      if (staff.photo) {
        avatarEl.innerHTML = `<img src="${staff.photo}" alt="${staff.name}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;" onerror="this.outerHTML='${getInitials(staff.name)}'">`;
      } else {
        avatarEl.textContent = getInitials(staff.name);
      }
    }

    // Date Control
    const dateInput = document.getElementById('modal-activity-date-input');
    if (dateInput) dateInput.value = currentTimelineDateStr;

    const dateFormattedEl = document.getElementById('modal-activity-date-formatted');
    if (dateFormattedEl) {
      try {
        const [y, m, d] = currentTimelineDateStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        dateFormattedEl.textContent = `${dateObj.toLocaleDateString('en-US', { weekday: 'long' })}, ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
      } catch (e) {
        dateFormattedEl.textContent = currentTimelineDateStr;
      }
    }

    // Status Badge
    const statusBadge = document.getElementById('modal-activity-status-badge');
    if (statusBadge) {
      const st = timelineData.summary.currentStatus;
      if (st === 'Active') {
        statusBadge.className = 'badge badge-status-active';
        statusBadge.innerHTML = '<span class="pulse-dot pulse-dot-green"></span> Active';
      } else if (st === 'Inactive') {
        statusBadge.className = 'badge badge-status-inactive';
        statusBadge.innerHTML = '<span class="pulse-dot pulse-dot-amber"></span> Inactive';
      } else if (st === 'On Lunch Break') {
        statusBadge.className = 'badge badge-status-lunch';
        statusBadge.innerHTML = '<span class="pulse-dot pulse-dot-blue"></span> On Lunch Break';
      } else {
        statusBadge.className = 'badge badge-status-checkedout';
        statusBadge.innerHTML = '<span class="pulse-dot pulse-dot-gray"></span> Checked Out';
      }
    }

    // 4 KPI Strips
    const kpiWork = document.getElementById('modal-kpi-work-duration');
    const kpiInactive = document.getElementById('modal-kpi-inactive-duration');
    const kpiLunch = document.getElementById('modal-kpi-lunch-duration');
    const kpiPauses = document.getElementById('modal-kpi-pauses-count');

    if (kpiWork) kpiWork.textContent = timelineData.summary.workingDurationFormatted;
    if (kpiInactive) kpiInactive.textContent = timelineData.summary.totalInactiveDurationFormatted;
    if (kpiLunch) kpiLunch.textContent = timelineData.summary.totalLunchDurationFormatted;
    if (kpiPauses) {
      const inactCount = (timelineData.attendance?.inactivityPeriods || []).length + (timelineData.attendance?.currentInactivityStart ? 1 : 0);
      kpiPauses.textContent = `${inactCount} session${inactCount === 1 ? '' : 's'}`;
    }

    // Visual Distribution Bar
    const distBar = document.getElementById('modal-activity-distribution-bar');
    if (distBar) {
      const activeMins = timelineData.summary.workingMinutes || 0;
      const inactiveMins = timelineData.summary.totalInactiveMinutes || 0;
      const lunchMins = timelineData.summary.totalLunchMinutes || 0;
      const totalMins = activeMins + inactiveMins + lunchMins;

      if (totalMins > 0) {
        const pActive = Math.round((activeMins / totalMins) * 100);
        const pInactive = Math.round((inactiveMins / totalMins) * 100);
        const pLunch = 100 - pActive - pInactive;

        distBar.innerHTML = `
          <div style="width:${pActive}%; background:#10b981; height:100%; transition:width 0.3s;" title="Active: ${timelineData.summary.workingDurationFormatted} (${pActive}%)"></div>
          <div style="width:${pInactive}%; background:#f59e0b; height:100%; transition:width 0.3s;" title="Inactive / Idle: ${timelineData.summary.totalInactiveDurationFormatted} (${pInactive}%)"></div>
          <div style="width:${pLunch}%; background:#3b82f6; height:100%; transition:width 0.3s;" title="Lunch Break: ${timelineData.summary.totalLunchDurationFormatted} (${pLunch}%)"></div>
        `;
      } else {
        distBar.innerHTML = `<div style="width:100%; background:#e2e8f0; height:100%; display:flex; align-items:center; justify-content:center; font-size:0.68rem; color:#64748b;">No shift activity logged for this date</div>`;
      }
    }

    // Chronological Steps List
    const stepsListEl = document.getElementById('modal-timeline-steps-list');
    if (stepsListEl) {
      if (!timelineData.events || timelineData.events.length === 0) {
        stepsListEl.innerHTML = `
          <div class="text-center py-4 text-muted">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.6;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <div style="font-weight:600; font-size:0.88rem;">No activity events recorded</div>
            <div style="font-size:0.75rem;">Staff member has no registered shift intervals on ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(currentTimelineDateStr) : currentTimelineDateStr}.</div>
          </div>
        `;
      } else {
        stepsListEl.innerHTML = timelineData.events.map(ev => {
          let iconClass = 'timeline-icon-active';
          let iconSvg = '▶';
          let badgeBg = '#ecfdf5';
          let badgeColor = '#065f46';

          if (ev.type === 'checkin') {
            iconClass = 'timeline-icon-checkin';
            iconSvg = '🏁';
            badgeBg = '#d1fae5';
            badgeColor = '#047857';
          } else if (ev.type === 'inactive') {
            iconClass = 'timeline-icon-inactive';
            iconSvg = '⏸';
            badgeBg = '#fef3c7';
            badgeColor = '#92400e';
          } else if (ev.type === 'resumed') {
            iconClass = 'timeline-icon-active';
            iconSvg = '⏯';
            badgeBg = '#ecfdf5';
            badgeColor = '#065f46';
          } else if (ev.type === 'lunch') {
            iconClass = 'timeline-icon-lunch';
            iconSvg = '🍱';
            badgeBg = '#dbeafe';
            badgeColor = '#1e40af';
          } else if (ev.type === 'checkout') {
            iconClass = 'timeline-icon-checkout';
            iconSvg = '🚪';
            badgeBg = '#f1f5f9';
            badgeColor = '#334155';
          }

          return `
            <div class="activity-timeline-item">
              <div class="timeline-icon-bubble ${iconClass}">${iconSvg}</div>
              <div class="timeline-content-card">
                <div class="timeline-content-header">
                  <div class="timeline-title-text">${ev.label}</div>
                  ${ev.durationFormatted ? `<span class="timeline-duration-badge" style="background:${badgeBg}; color:${badgeColor};">${ev.durationFormatted}</span>` : ''}
                </div>
                ${(ev.notes || ev.description) ? `<div class="timeline-note-text">${ev.notes || ev.description}</div>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
    }

    modal.classList.add('open');
    modal.style.display = '';
  }

  function exportActivitySummaryCSV() {
    const todayDefaultStr = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') ? WorkPulseDB.getTodayDateString() : new Date().toISOString().split('T')[0];
    const dateVal = document.getElementById('activity-filter-date')?.value || todayDefaultStr;
    const summaryData = WorkPulseDB.getStaffActivitySummary(dateVal);

    const headers = [
      'Staff ID',
      'Staff Name',
      'Position',
      'Department',
      'Activity Date',
      'Current Status',
      'Last Active Time',
      'Inactive Start Time',
      'Resume/Active Time',
      'Total Inactive Duration',
      'Total Lunch Break Duration',
      'Current Working Duration'
    ];

    const rows = summaryData.items.map(it => [
      `"${it.staff.id}"`,
      `"${it.staff.name}"`,
      `"${it.staff.position}"`,
      `"${it.staff.department || 'Operations'}"`,
      `"${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(it.date) : it.date}"`,
      `"${it.currentStatus}"`,
      `"${it.lastActiveTime}"`,
      `"${it.inactiveStartTime}"`,
      `"${it.resumeActiveTime}"`,
      `"${it.totalInactiveDurationFormatted}"`,
      `"${it.totalLunchDurationFormatted}"`,
      `"${it.currentWorkingDurationFormatted}"`
    ].join(','));

    const csvText = [headers.join(','), ...rows].join('\r\n');
    downloadCSV(`WorkPulse_Staff_Activity_Summary_${dateVal}.csv`, csvText);
    showToast(`Staff Activity Summary for ${dateVal} exported successfully.`, 'success');
  }

  // Activity filter event listeners
  document.getElementById('activity-filter-date')?.addEventListener('change', renderActivityStatus);
  document.getElementById('activity-filter-staff')?.addEventListener('change', renderActivityStatus);
  document.getElementById('activity-filter-status')?.addEventListener('change', renderActivityStatus);
  document.getElementById('activity-search-input')?.addEventListener('input', renderActivityStatus);

  document.getElementById('btn-activity-prev-day')?.addEventListener('click', () => {
    const inp = document.getElementById('activity-filter-date');
    if (inp) {
      const fallback = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') ? WorkPulseDB.getTodayDateString() : new Date().toISOString().split('T')[0];
      inp.value = shiftDate(inp.value || fallback, -1);
      renderActivityStatus();
    }
  });

  document.getElementById('btn-activity-next-day')?.addEventListener('click', () => {
    const inp = document.getElementById('activity-filter-date');
    if (inp) {
      const fallback = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') ? WorkPulseDB.getTodayDateString() : new Date().toISOString().split('T')[0];
      inp.value = shiftDate(inp.value || fallback, 1);
      renderActivityStatus();
    }
  });

  document.getElementById('btn-quick-today')?.addEventListener('click', () => {
    const inp = document.getElementById('activity-filter-date');
    if (inp) {
      inp.value = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') ? WorkPulseDB.getTodayDateString() : new Date().toISOString().split('T')[0];
      renderActivityStatus();
    }
  });

  document.getElementById('btn-quick-yesterday')?.addEventListener('click', () => {
    const inp = document.getElementById('activity-filter-date');
    if (inp) {
      const todayStr = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') ? WorkPulseDB.getTodayDateString() : new Date().toISOString().split('T')[0];
      inp.value = shiftDate(todayStr, -1);
      renderActivityStatus();
    }
  });

  document.getElementById('btn-reset-activity-filters')?.addEventListener('click', () => {
    const dateInp = document.getElementById('activity-filter-date');
    if (dateInp) dateInp.value = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') ? WorkPulseDB.getTodayDateString() : new Date().toISOString().split('T')[0];
    const staffSel = document.getElementById('activity-filter-staff');
    if (staffSel) staffSel.value = 'All';
    const statusSel = document.getElementById('activity-filter-status');
    if (statusSel) statusSel.value = 'All';
    const searchInp = document.getElementById('activity-search-input');
    if (searchInp) searchInp.value = '';
    renderActivityStatus();
  });

  document.getElementById('btn-refresh-activity')?.addEventListener('click', () => {
    renderActivityStatus();
    showToast('Staff activity monitoring data refreshed live.', 'info');
  });

  document.getElementById('btn-export-activity-csv')?.addEventListener('click', exportActivitySummaryCSV);

  // Timeline modal event listeners
  const activityTimelineModal = document.getElementById('staff-activity-timeline-modal');
  const closeTimelineBtn = document.getElementById('btn-close-activity-timeline');
  const closeTimelineFooterBtn = document.getElementById('btn-modal-close-timeline-footer');

  function closeActivityTimelineModal() {
    if (activityTimelineModal) {
      activityTimelineModal.classList.remove('open');
      activityTimelineModal.style.display = '';
    }
  }

  closeTimelineBtn?.addEventListener('click', closeActivityTimelineModal);
  closeTimelineFooterBtn?.addEventListener('click', closeActivityTimelineModal);

  if (activityTimelineModal) {
    activityTimelineModal.addEventListener('click', (e) => {
      if (e.target === activityTimelineModal) {
        closeActivityTimelineModal();
      }
    });
  }

  document.getElementById('modal-activity-date-input')?.addEventListener('change', (e) => {
    openActivityTimelineModal(currentTimelineStaffId, e.target.value);
  });

  document.getElementById('btn-modal-prev-day')?.addEventListener('click', () => {
    const prevDate = shiftDate(currentTimelineDateStr, -1);
    openActivityTimelineModal(currentTimelineStaffId, prevDate);
  });

  document.getElementById('btn-modal-next-day')?.addEventListener('click', () => {
    const nextDate = shiftDate(currentTimelineDateStr, 1);
    openActivityTimelineModal(currentTimelineStaffId, nextDate);
  });

  document.getElementById('btn-modal-print-timeline')?.addEventListener('click', () => {
    window.print();
  });

  // Cross-tab synchronization and live duration refreshes for Staff Activity monitoring
  window.addEventListener('storage', (e) => {
    if (e.key === 'workpulse_db_v2') {
      const activePane = document.querySelector('.admin-view-pane.active');
      if (activePane && activePane.id === 'pane-activity') {
        renderActivityStatus();
        if (activityTimelineModal && activityTimelineModal.style.display === 'flex' && currentTimelineStaffId) {
          openActivityTimelineModal(currentTimelineStaffId, currentTimelineDateStr);
        }
      }
    }
  });

  setInterval(() => {
    const activePane = document.querySelector('.admin-view-pane.active');
    if (activePane && activePane.id === 'pane-activity') {
      const todayStr = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') ? WorkPulseDB.getTodayDateString() : new Date().toISOString().split('T')[0];
      const dateInp = document.getElementById('activity-filter-date');
      if (!dateInp || dateInp.value === todayStr) {
        renderActivityStatus();
        if (activityTimelineModal && activityTimelineModal.style.display === 'flex' && currentTimelineStaffId && currentTimelineDateStr === todayStr) {
          openActivityTimelineModal(currentTimelineStaffId, currentTimelineDateStr);
        }
      }
    }
  }, 10000);

  // --------------------------------------------------------------------------
  // 9. VIEW 4: LEAVE REQUESTS & CALENDAR SYNCHRONIZATION
  // --------------------------------------------------------------------------
  let leaveActiveTab = 'Pending';

  document.querySelectorAll('.leave-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.leave-filter-tab').forEach(t => t.classList.remove('active', 'btn-primary'));
      document.querySelectorAll('.leave-filter-tab').forEach(t => t.classList.add('btn-secondary'));
      tab.classList.remove('btn-secondary');
      tab.classList.add('active', 'btn-primary');
      leaveActiveTab = tab.dataset.tab;
      renderLeavesTable();
    });
  });

  function renderLeavesTable() {
    const leaves = WorkPulseDB.getLeaves();
    const pendingCount = leaves.filter(l => l.status === 'Pending').length;
    const badge = document.getElementById('leave-pending-badge');
    if (badge) badge.textContent = pendingCount;

    let filtered = leaves;
    if (leaveActiveTab !== 'All') {
      filtered = leaves.filter(l => l.status === leaveActiveTab);
    }

    const tbody = document.getElementById('leaves-table-tbody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = renderEmptyTableState(8, `No ${leaveActiveTab} Leave Applications`, 'There are currently no leave requests recorded under this category.');
      return;
    }

    tbody.innerHTML = filtered.map(lv => {
      let statusBadge = '';
      if (lv.status === 'Pending') statusBadge = `<span class="badge badge-gold">⏳ Pending</span>`;
      else if (lv.status === 'Approved') statusBadge = `<span class="badge badge-leave">🔴 Approved (Calendar Sync)</span>`;
      else statusBadge = `<span class="badge badge-sunday">❌ Rejected</span>`;

      const actions = lv.status === 'Pending' ? `
        <div class="d-flex gap-1 justify-content-end">
          <button class="btn btn-primary btn-sm btn-approve-leave" data-id="${lv.id}" style="padding:3px 8px; font-size:0.72rem; background:#059669; border-color:#059669;">
            ✓ Approve (Turn Red)
          </button>
          <button class="btn btn-secondary btn-sm btn-reject-leave" data-id="${lv.id}" style="padding:3px 8px; font-size:0.72rem; color:#DC2626;">
            ✕ Reject
          </button>
        </div>
      ` : `<span class="text-muted" style="font-size:0.78rem;">Closed</span>`;

      const staffMember = lv.staffId ? WorkPulseDB.getStaffById(lv.staffId) : null;
      let staffName = lv.staffName;
      if (!staffName || staffName === 'undefined') {
        staffName = staffMember ? staffMember.name : lv.staffId;
      }
      staffName = (staffName && staffName !== 'undefined') ? staffName : 'Staff Member';

      let staffPosition = lv.position;
      if (!staffPosition || staffPosition === 'undefined') {
        staffPosition = staffMember ? staffMember.position : 'Staff';
      }
      staffPosition = (staffPosition && staffPosition !== 'undefined') ? staffPosition : 'Staff';

      const avatarObj = {
        name: staffName,
        photo: lv.photo !== undefined ? lv.photo : (staffMember ? staffMember.photo : null),
        position: staffPosition,
        staffId: lv.staffId,
        id: lv.staffId
      };

      let reasonHtml = `<div style="font-size:0.8rem; max-width:220px;">${escapeHtml(lv.reason || 'No details provided')}</div>`;
      if (lv.status === 'Rejected' && (lv.rejectionReason || lv.adminComment)) {
        reasonHtml += `
          <div style="margin-top:4px; padding:3px 6px; background:#FEF2F2; border-left:3px solid #EF4444; border-radius:3px; color:#991B1B; font-size:0.72rem; line-height:1.3; max-width:220px;">
            <strong>Rejection Reason:</strong> ${escapeHtml(lv.rejectionReason || lv.adminComment)}
          </div>
        `;
      } else if (lv.status === 'Approved' && (lv.adminComment || lv.approvalComment || lv.notes)) {
        reasonHtml += `
          <div style="margin-top:4px; padding:3px 6px; background:#ECFDF5; border-left:3px solid #10B981; border-radius:3px; color:#065F46; font-size:0.72rem; line-height:1.3; max-width:220px;">
            <strong>Admin Note:</strong> ${escapeHtml(lv.adminComment || lv.approvalComment || lv.notes)}
          </div>
        `;
      }

      const sDate = lv.startDate || lv.leaveDate || '';
      const eDate = lv.endDate || lv.toDate || sDate;
      const tDays = lv.totalDays || (sDate && eDate && typeof WorkPulseDB.calculateLeaveDays === 'function' ? WorkPulseDB.calculateLeaveDays(sDate, eDate) : 1);
      const sDateDisp = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(sDate) : sDate;
      const eDateDisp = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(eDate) : eDate;
      const dateDisplayHtml = (sDate === eDate)
        ? `<span>${escapeHtml(sDateDisp)}</span> <span class="badge badge-info" style="font-size:0.68rem; margin-left:4px;">1 Day</span>`
        : `<span>${escapeHtml(sDateDisp)} &rarr; ${escapeHtml(eDateDisp)}</span> <span class="badge badge-info" style="font-size:0.68rem; margin-left:4px;">${tDays} Days</span>`;

      return `
        <tr>
          <td style="font-weight:700; color:var(--royal-blue); font-size:0.8rem;">${lv.id}</td>
          <td>
            <div class="d-flex align-items-center gap-2">
              ${renderStaffAvatar(avatarObj, 32)}
              <div>
                <div style="font-weight:700; color:var(--navy-dark);">${escapeHtml(staffName)}</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(lv.staffId || '')}</div>
              </div>
            </div>
          </td>
          <td style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(staffPosition)}</td>
          <td style="font-weight:700; font-size:0.82rem; color:var(--navy-dark);">${dateDisplayHtml}</td>
          <td class="text-center"><span class="badge badge-secondary" style="font-size:0.72rem;">${escapeHtml(lv.leaveType || 'Leave')}</span></td>
          <td>${reasonHtml}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-end">${actions}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-approve-leave').forEach(btn => {
      btn.addEventListener('click', () => {
        openApproveLeaveModal(btn.dataset.id);
      });
    });

    tbody.querySelectorAll('.btn-reject-leave').forEach(btn => {
      btn.addEventListener('click', () => {
        openRejectLeaveModal(btn.dataset.id);
      });
    });
  }

  // --- APPROVE LEAVE MODAL CONTROLLER (WITH OPTIONAL COMMENT) ---
  const approveLeaveModal = document.getElementById('approve-leave-modal');
  const approveLeaveForm = document.getElementById('approve-leave-form');
  const approveLeaveIdInput = document.getElementById('approve-leave-id');
  const approveLeaveCommentInput = document.getElementById('approve-leave-comment');
  const approveLeaveSummary = document.getElementById('approve-leave-summary');
  const btnCloseApproveLeave = document.getElementById('btn-close-approve-leave');
  const btnCancelApproveLeave = document.getElementById('btn-cancel-approve-leave');

  function openApproveLeaveModal(leaveId) {
    if (!approveLeaveModal) return;
    const leaves = WorkPulseDB.getLeaves();
    const lv = leaves.find(l => l.id === leaveId);
    if (!lv) return;

    const staffMember = lv.staffId ? WorkPulseDB.getStaffById(lv.staffId) : null;
    let staffName = lv.staffName;
    if (!staffName || staffName === 'undefined') staffName = staffMember ? staffMember.name : lv.staffId;
    staffName = (staffName && staffName !== 'undefined') ? staffName : 'Staff Member';

    let staffPosition = lv.position;
    if (!staffPosition || staffPosition === 'undefined') staffPosition = staffMember ? staffMember.position : 'Staff';
    staffPosition = (staffPosition && staffPosition !== 'undefined') ? staffPosition : 'Staff';

    if (approveLeaveIdInput) approveLeaveIdInput.value = leaveId;
    if (approveLeaveCommentInput) approveLeaveCommentInput.value = '';
    if (approveLeaveSummary) {
      const sDate = lv.startDate || lv.leaveDate || '';
      const eDate = lv.endDate || lv.toDate || sDate;
      const tDays = lv.totalDays || (sDate && eDate && typeof WorkPulseDB.calculateLeaveDays === 'function' ? WorkPulseDB.calculateLeaveDays(sDate, eDate) : 1);
      const sDisp = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(sDate) : sDate;
      const eDisp = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(eDate) : eDate;
      const dateText = (sDate === eDate) ? `${sDisp} (1 Day)` : `${sDisp} to ${eDisp} (${tDays} Days)`;

      approveLeaveSummary.innerHTML = `
        <div style="font-weight: 700; color: #065F46; margin-bottom: 2px;">
          Applicant: ${escapeHtml(staffName)} (${escapeHtml(staffPosition)})
        </div>
        <div style="color: var(--royal-blue); margin-bottom: 2px;">
          Type: <strong>${escapeHtml(lv.leaveType || 'Leave')}</strong> &bull; Dates: <strong>${escapeHtml(dateText)}</strong>
        </div>
        <div style="color: #64748B;">
          Staff Reason: <em>"${escapeHtml(lv.reason || 'None specified')}"</em>
        </div>
      `;
    }
    const submitBtn = approveLeaveForm?.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '✓ Confirm & Approve Leave';
    }
    approveLeaveModal.classList.add('open');
    approveLeaveModal.style.display = '';
    if (approveLeaveCommentInput) approveLeaveCommentInput.focus();
  }

  function closeApproveLeaveModal() {
    if (approveLeaveModal) {
      approveLeaveModal.classList.remove('open');
      approveLeaveModal.style.display = '';
    }
    const submitBtn = approveLeaveForm?.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '✓ Confirm & Approve Leave';
    }
  }

  if (btnCloseApproveLeave) btnCloseApproveLeave.addEventListener('click', closeApproveLeaveModal);
  if (btnCancelApproveLeave) btnCancelApproveLeave.addEventListener('click', closeApproveLeaveModal);

  if (approveLeaveForm) {
    approveLeaveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = approveLeaveForm.querySelector('button[type="submit"]');
      if (submitBtn && submitBtn.disabled) return;

      const leaveId = approveLeaveIdInput ? approveLeaveIdInput.value : null;
      const comment = approveLeaveCommentInput ? approveLeaveCommentInput.value.trim() : '';

      if (!leaveId) {
        showToast('Invalid leave request selected.', 'error');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></span> Approving...';
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch(`/api/leaves/${leaveId}`, {
          method: 'PATCH',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            status: 'Approved',
            comment: comment,
            notes: comment
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        let data = null;
        try {
          data = await res.json();
        } catch (jsonErr) {
          throw new Error('Invalid server response');
        }

        if (!res.ok || !data || !data.success) {
          showToast((data && data.error) || 'Failed to approve leave on server.', 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '✓ Confirm & Approve Leave';
          }
          return;
        }

        WorkPulseDB.updateLeaveStatus(leaveId, 'Approved', comment);
        closeApproveLeaveModal();
        showToast('Leave Approved. Corresponding calendar days turned RED (Leave).', 'success');
        renderLeavesTable();
        updatePendingBadges();
        renderDashboard();
      } catch (netErr) {
        clearTimeout(timeoutId);
        console.error('Approve leave error:', netErr);
        const errorMsg = netErr.name === 'AbortError' 
          ? 'Leave approval request timed out. Please retry.' 
          : 'Network error communicating with server. Please try again.';
        showToast(errorMsg, 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '✓ Confirm & Approve Leave';
        }
      }
    });
  }

  // --- REJECT LEAVE MODAL CONTROLLER (MANDATORY REASON) ---
  const rejectLeaveModal = document.getElementById('reject-leave-modal');
  const rejectLeaveForm = document.getElementById('reject-leave-form');
  const rejectLeaveIdInput = document.getElementById('reject-leave-id');
  const rejectLeaveReasonInput = document.getElementById('reject-leave-reason');
  const rejectLeaveSummary = document.getElementById('reject-leave-summary');
  const btnCloseRejectLeave = document.getElementById('btn-close-reject-leave');
  const btnCancelRejectLeave = document.getElementById('btn-cancel-reject-leave');

  function openRejectLeaveModal(leaveId) {
    if (!rejectLeaveModal) return;
    const leaves = WorkPulseDB.getLeaves();
    const lv = leaves.find(l => l.id === leaveId);
    if (!lv) return;

    const staffMember = lv.staffId ? WorkPulseDB.getStaffById(lv.staffId) : null;
    let staffName = lv.staffName;
    if (!staffName || staffName === 'undefined') staffName = staffMember ? staffMember.name : lv.staffId;
    staffName = (staffName && staffName !== 'undefined') ? staffName : 'Staff Member';

    let staffPosition = lv.position;
    if (!staffPosition || staffPosition === 'undefined') staffPosition = staffMember ? staffMember.position : 'Staff';
    staffPosition = (staffPosition && staffPosition !== 'undefined') ? staffPosition : 'Staff';

    if (rejectLeaveIdInput) rejectLeaveIdInput.value = leaveId;
    if (rejectLeaveReasonInput) rejectLeaveReasonInput.value = '';
    if (rejectLeaveSummary) {
      const sDate = lv.startDate || lv.leaveDate || '';
      const eDate = lv.endDate || lv.toDate || sDate;
      const tDays = lv.totalDays || (sDate && eDate && typeof WorkPulseDB.calculateLeaveDays === 'function' ? WorkPulseDB.calculateLeaveDays(sDate, eDate) : 1);
      const sDisp = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(sDate) : sDate;
      const eDisp = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(eDate) : eDate;
      const dateText = (sDate === eDate) ? `${sDisp} (1 Day)` : `${sDisp} to ${eDisp} (${tDays} Days)`;

      rejectLeaveSummary.innerHTML = `
        <div style="font-weight: 700; color: var(--navy-dark); margin-bottom: 2px;">
          Applicant: ${escapeHtml(staffName)} (${escapeHtml(staffPosition)})
        </div>
        <div style="color: var(--royal-blue); margin-bottom: 2px;">
          Type: <strong>${escapeHtml(lv.leaveType || 'Leave')}</strong> &bull; Dates: <strong>${escapeHtml(dateText)}</strong>
        </div>
        <div style="color: #64748B;">
          Staff Reason: <em>"${escapeHtml(lv.reason || 'None specified')}"</em>
        </div>
      `;
    }
    const submitBtn = rejectLeaveForm?.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Confirm & Reject Leave';
    }
    rejectLeaveModal.classList.add('open');
    rejectLeaveModal.style.display = '';
    if (rejectLeaveReasonInput) rejectLeaveReasonInput.focus();
  }

  function closeRejectLeaveModal() {
    if (rejectLeaveModal) {
      rejectLeaveModal.classList.remove('open');
      rejectLeaveModal.style.display = '';
    }
    const submitBtn = rejectLeaveForm?.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Confirm & Reject Leave';
    }
  }

  if (btnCloseRejectLeave) btnCloseRejectLeave.addEventListener('click', closeRejectLeaveModal);
  if (btnCancelRejectLeave) btnCancelRejectLeave.addEventListener('click', closeRejectLeaveModal);

  if (rejectLeaveForm) {
    rejectLeaveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = rejectLeaveForm.querySelector('button[type="submit"]');
      if (submitBtn && submitBtn.disabled) return;

      const leaveId = rejectLeaveIdInput ? rejectLeaveIdInput.value : null;
      const reason = rejectLeaveReasonInput ? rejectLeaveReasonInput.value.trim() : '';

      if (!reason) {
        showToast('Please enter a mandatory rejection reason before confirming.', 'error');
        if (rejectLeaveReasonInput) rejectLeaveReasonInput.focus();
        return;
      }

      if (!leaveId) {
        showToast('Invalid leave request selected.', 'error');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; margin-right:6px; vertical-align:middle;"></span> Rejecting...';
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch(`/api/leaves/${leaveId}`, {
          method: 'PATCH',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            status: 'Rejected',
            rejectionReason: reason,
            comment: reason
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        let data = null;
        try {
          data = await res.json();
        } catch (jsonErr) {
          throw new Error('Invalid server response');
        }

        if (!res.ok || !data || !data.success) {
          showToast((data && data.error) || 'Failed to reject leave on server.', 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Confirm & Reject Leave';
          }
          return;
        }

        WorkPulseDB.updateLeaveStatus(leaveId, 'Rejected', reason);
        closeRejectLeaveModal();
        showToast('Leave request rejected and reason communicated to staff member.', 'info');
        renderLeavesTable();
        updatePendingBadges();
        renderDashboard();
      } catch (netErr) {
        clearTimeout(timeoutId);
        console.error('Reject leave error:', netErr);
        const errorMsg = netErr.name === 'AbortError' 
          ? 'Leave rejection request timed out. Please retry.' 
          : 'Network error communicating with server. Please try again.';
        showToast(errorMsg, 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Confirm & Reject Leave';
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // 10. VIEW 5: WORK FROM HOME (WFH) GOVERNANCE
  // --------------------------------------------------------------------------
  let wfhActiveTab = 'Pending';

  document.querySelectorAll('.wfh-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.wfh-filter-tab').forEach(t => t.classList.remove('active', 'btn-primary'));
      document.querySelectorAll('.wfh-filter-tab').forEach(t => t.classList.add('btn-secondary'));
      tab.classList.remove('btn-secondary');
      tab.classList.add('active', 'btn-primary');
      wfhActiveTab = tab.dataset.tab;
      renderWfhTable();
    });
  });

  function renderWfhTable() {
    const wfhList = WorkPulseDB.getWfhRequests();
    const pendingCount = wfhList.filter(w => w.status === 'Pending').length;
    const badge = document.getElementById('wfh-pending-badge');
    if (badge) badge.textContent = pendingCount;

    let filtered = wfhList;
    if (wfhActiveTab !== 'All') {
      filtered = wfhList.filter(w => w.status === wfhActiveTab);
    }

    const tbody = document.getElementById('wfh-table-tbody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = renderEmptyTableState(7, `No ${wfhActiveTab} WFH Requests`, 'There are currently no remote work applications recorded under this category.');
      return;
    }

    tbody.innerHTML = filtered.map(w => {
      let statusBadge = '';
      if (w.status === 'Pending') statusBadge = `<span class="badge badge-gold">⏳ Pending</span>`;
      else if (w.status === 'Approved') statusBadge = `<span class="badge badge-wfh">🟠 Approved (Calendar Sync)</span>`;
      else statusBadge = `<span class="badge badge-sunday">❌ Rejected</span>`;

      const actions = w.status === 'Pending' ? `
        <div class="d-flex gap-1 justify-content-end">
          <button class="btn btn-primary btn-sm btn-approve-wfh" data-id="${w.id}" style="padding:3px 8px; font-size:0.72rem; background:#EA580C; border-color:#EA580C;">
            ✓ Approve (Turn Orange)
          </button>
          <button class="btn btn-secondary btn-sm btn-reject-wfh" data-id="${w.id}" style="padding:3px 8px; font-size:0.72rem; color:#DC2626;">
            ✕ Reject
          </button>
        </div>
      ` : `<span class="text-muted" style="font-size:0.78rem;">Closed</span>`;

      return `
        <tr>
          <td style="font-weight:700; color:var(--royal-blue); font-size:0.8rem;">${w.id}</td>
          <td>
            <div class="d-flex align-items-center gap-2">
              ${renderStaffAvatar(w, 32)}
              <div>
                <div style="font-weight:700; color:var(--navy-dark);">${w.staffName}</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${w.staffId}</div>
              </div>
            </div>
          </td>
          <td style="font-size:0.8rem; color:var(--text-muted);">${w.position}</td>
          <td style="font-weight:700; font-size:0.82rem; color:var(--navy-dark);">${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(w.date) : w.date}</td>
          <td style="font-size:0.8rem; max-width:260px;">${w.reason}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-end">${actions}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-approve-wfh').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wfhId = btn.dataset.id;
        try {
          btn.disabled = true;
          const res = await fetch(`/api/wfh/${wfhId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: 'Approved' })
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            showToast((data && data.error) || 'Failed to approve WFH request on server.', 'error');
            btn.disabled = false;
            return;
          }
        } catch (e) {
          console.warn('Network error updating WFH on server, saving locally:', e);
        }
        WorkPulseDB.updateWfhStatus(wfhId, 'Approved');
        showToast('WFH Approved. Corresponding calendar day turned ORANGE (WFH).', 'success');
        renderWfhTable();
        updatePendingBadges();
        renderDashboard();
      });
    });

    tbody.querySelectorAll('.btn-reject-wfh').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wfhId = btn.dataset.id;
        const reason = prompt('Please state the reason for rejecting this Work From Home request:');
        if (reason === null) return; // Cancelled
        if (!reason.trim()) {
          showToast('A rejection reason is mandatory when rejecting a WFH request.', 'error');
          return;
        }
        try {
          btn.disabled = true;
          const res = await fetch(`/api/wfh/${wfhId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: 'Rejected', rejectionReason: reason.trim() })
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            showToast((data && data.error) || 'Failed to reject WFH request on server.', 'error');
            btn.disabled = false;
            return;
          }
        } catch (e) {
          console.warn('Network error rejecting WFH on server, saving locally:', e);
        }
        WorkPulseDB.updateWfhStatus(wfhId, 'Rejected', reason.trim());
        showToast('WFH request rejected.', 'info');
        renderWfhTable();
        updatePendingBadges();
        renderDashboard();
      });
    });
  }

  // --------------------------------------------------------------------------
  // 11. VIEW 6: EXCEL STAFF IMPORT SECTION
  // --------------------------------------------------------------------------
  const dropZone = document.getElementById('excel-drop-zone');
  const fileInput = document.getElementById('excel-file-input');
  const browseBtn = document.getElementById('btn-browse-file');
  const demoQuickImportBtn = document.getElementById('btn-demo-quick-import');
  const progressBar = document.getElementById('import-progress-bar');
  const progressFill = document.getElementById('progress-fill-active');
  const resultsContainer = document.getElementById('import-results-container');
  const downloadTemplateBtn = document.getElementById('btn-download-excel-template');
  const downloadSampleBtn = document.getElementById('btn-download-sample-excel');

  // Download official template file
  if (downloadSampleBtn) {
    downloadSampleBtn.addEventListener('click', () => {
      const csvContent = WorkPulseDB.generateBlankTemplateCSV();
      downloadCSV('WorkPulse_Staff_Import_Template.csv', csvContent);
      showToast('Staff Batch Template (.CSV) downloaded.', 'info');
    });
  }

  // Download official blank template
  if (downloadTemplateBtn) {
    downloadTemplateBtn.addEventListener('click', () => {
      const csvContent = WorkPulseDB.generateBlankTemplateCSV();
      downloadCSV('WorkPulse_Blank_Template.csv', csvContent);
      showToast('Blank Excel Template (.CSV) downloaded.', 'info');
    });
  }

  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (dropZone) {
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileImport(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileImport(e.target.files[0]);
      }
    });
  }

  function handleFileImport(file) {
    if (!file.name.match(/\.(csv|txt|xlsx|xls)$/i)) {
      showToast('Please upload a valid CSV or Excel format tabular file.', 'error');
      return;
    }

    // Animate progress bar
    if (progressBar && progressFill) {
      progressBar.style.display = 'block';
      progressFill.style.width = '20%';
      setTimeout(() => { progressFill.style.width = '60%'; }, 150);
    }

    const isBinaryXlsx = file.name.match(/\.(xlsx|xls)$/i);

    if (isBinaryXlsx && typeof XLSX !== 'undefined') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const csvText = XLSX.utils.sheet_to_csv(worksheet);

          setTimeout(() => {
            if (progressFill) progressFill.style.width = '100%';
            const res = WorkPulseDB.validateAndImportExcel(csvText);
            renderImportResults(res, file.name);
            if (res.success && res.importedCount > 0) {
              showToast(`Imported ${res.importedCount} staff from Excel spreadsheet!`, 'success');
              renderStaffDirectory();
              renderDashboard();
            } else if (!res.success) {
              showToast(res.error || 'Import failed.', 'error');
            } else {
              showToast('No new staff records imported. Review duplicate logs.', 'warning');
            }
          }, 350);
        } catch (err) {
          showToast('Failed to parse Excel workbook: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        setTimeout(() => {
          if (progressFill) progressFill.style.width = '100%';
          const res = WorkPulseDB.validateAndImportExcel(text);
          renderImportResults(res, file.name);
          if (res.success && res.importedCount > 0) {
            showToast(`Successfully imported ${res.importedCount} staff records!`, 'success');
            renderStaffDirectory();
            renderDashboard();
          } else if (!res.success) {
            showToast(res.error || 'Import failed.', 'error');
          } else {
            showToast('No new staff records imported. Review duplicates/errors below.', 'warning');
          }
        }, 350);
      };
      reader.readAsText(file);
    }
  }

  function renderImportResults(res, fileName) {
    if (!resultsContainer) return;
    resultsContainer.style.display = 'block';

    if (!res.success) {
      resultsContainer.innerHTML = `
        <div class="alert alert-error" style="background:#FEE2E2; border-color:#DC2626; color:#991B1B; padding:16px; border-radius:var(--radius-sm);">
          <div class="d-flex align-items-center gap-2 mb-2 font-weight-bold">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <strong>Import Error in file "${fileName}"</strong>
          </div>
          <p style="margin:0; font-size:0.86rem;">${res.error}</p>
        </div>
      `;
      return;
    }

    const errorListHtml = res.errors.length > 0 ? `
      <div class="mt-3 p-3" style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:var(--radius-sm);">
        <div style="font-weight:700; color:#B45309; font-size:0.84rem; margin-bottom:6px;">Skipped Rows / Duplicate Diagnostics (${res.errors.length}):</div>
        <ul style="margin:0; padding-left:20px; font-size:0.8rem; color:#92400E;">
          ${res.errors.map(err => `<li>Row ${err.row}: <strong>${err.data}</strong> — ${err.error}</li>`).join('')}
        </ul>
      </div>
    ` : '';

    const newRowsHtml = res.importedRecords.length > 0 ? `
      <div class="mt-3">
        <h4 style="font-size:0.95rem; font-weight:700; color:var(--navy-dark); margin-bottom:8px;">Newly Enrolled Staff Members (${res.importedRecords.length}):</h4>
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Assigned ID</th>
                <th>Staff Name</th>
                <th>Position</th>
                <th>Mobile</th>
                <th>Address</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${res.importedRecords.map(s => `
                <tr>
                  <td style="font-weight:700; color:var(--royal-blue);">${s.id}</td>
                  <td style="font-weight:700; color:var(--navy-dark);">
                    <div class="d-flex align-items-center gap-2">
                      ${renderStaffAvatar(s, 28)}
                      <span>${s.name}</span>
                    </div>
                  </td>
                  <td>${s.position}</td>
                  <td>${s.mobile}</td>
                  <td>${s.address}</td>
                  <td><span class="badge badge-present">Active</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : '';

    resultsContainer.innerHTML = `
      <div class="card p-3" style="border-left:4px solid var(--color-present);">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <h4 style="font-size:1.1rem; font-weight:700; color:var(--navy-dark); margin-bottom:4px;">Excel Batch Import Summary</h4>
            <p style="margin:0; font-size:0.8rem; color:var(--text-muted);">Source File: <strong>${fileName}</strong></p>
          </div>
          <div class="d-flex gap-3">
            <div class="text-center">
              <span style="font-size:0.7rem; text-transform:uppercase; font-weight:700; color:var(--color-present);">Enrolled</span>
              <div style="font-size:1.4rem; font-weight:800; color:var(--color-present);">${res.importedCount}</div>
            </div>
            <div class="text-center">
              <span style="font-size:0.7rem; text-transform:uppercase; font-weight:700; color:#D97706;">Skipped</span>
              <div style="font-size:1.4rem; font-weight:800; color:#D97706;">${res.failedCount}</div>
            </div>
          </div>
        </div>

        ${errorListHtml}
        ${newRowsHtml}
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // 12. VIEW 7: REPORTS & EXECUTIVE AUDIT EXPORT
  // --------------------------------------------------------------------------
  let reportsSelectedYear = new Date().getFullYear();
  let reportsSelectedMonth = new Date().getMonth(); // 0-indexed

  function initReportsMonthSelector() {
    const sel = document.getElementById('reports-month-select');
    if (!sel || sel.options.length > 0) return;
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const curYear = new Date().getFullYear();
    const curMonth = new Date().getMonth();

    const options = [];
    for (let y = curYear - 1; y <= curYear + 1; y++) {
      for (let m = 0; m < 12; m++) {
        const isSelected = (y === curYear && m === curMonth);
        options.push(`<option value="${y}-${m}" ${isSelected ? 'selected' : ''}>${monthNames[m]} ${y}</option>`);
      }
    }
    sel.innerHTML = options.join('');
    sel.addEventListener('change', () => {
      const [y, m] = sel.value.split('-').map(Number);
      reportsSelectedYear = y;
      reportsSelectedMonth = m;
      renderReports();
    });
  }

  function renderReports() {
    initReportsMonthSelector();
    const sel = document.getElementById('reports-month-select');
    if (sel && sel.value) {
      const [y, m] = sel.value.split('-').map(Number);
      reportsSelectedYear = y;
      reportsSelectedMonth = m;
    }
    const staffList = WorkPulseDB.getStaffList();
    const tbody = document.getElementById('reports-summary-tbody');
    if (!tbody) return;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const daysInMonth = new Date(reportsSelectedYear, reportsSelectedMonth + 1, 0).getDate();

    const weeklyHolidays = WorkPulseDB.getOfficeWeeklyHolidays();
    let weeklyOffCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(reportsSelectedYear, reportsSelectedMonth, d);
      const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
      if (weeklyHolidays.includes(dayName)) weeklyOffCount++;
    }
    const standardWorkingDays = Math.max(0, daysInMonth - weeklyOffCount);

    const calDaysEl = document.getElementById('report-stat-calendar-days');
    const calSubEl = document.getElementById('report-stat-calendar-month-sub');
    const weeklyOffEl = document.getElementById('report-stat-weekly-off');
    const workingDaysEl = document.getElementById('report-stat-standard-working-days');
    const companyRateEl = document.getElementById('report-stat-company-rate');
    const tableTitleEl = document.getElementById('report-table-title');

    if (calDaysEl) calDaysEl.textContent = `${daysInMonth} Days`;
    if (calSubEl) calSubEl.textContent = `${monthNames[reportsSelectedMonth]} ${reportsSelectedYear}`;
    if (weeklyOffEl) weeklyOffEl.textContent = `${weeklyOffCount} Days`;
    if (workingDaysEl) workingDaysEl.textContent = `${standardWorkingDays} Days`;
    if (tableTitleEl) tableTitleEl.textContent = `Staff Monthly Attendance Roster - ${monthNames[reportsSelectedMonth]} ${reportsSelectedYear}`;

    let totalPossibleDays = 0;
    let totalAttendedDays = 0;

    tbody.innerHTML = staffList.map(staff => {
      const summary = WorkPulseDB.getMonthSummaryForStaff(staff.id, reportsSelectedYear, reportsSelectedMonth);
      totalPossibleDays += summary.totalWorkingDays;
      totalAttendedDays += (summary.presentDays + (summary.halfDays * 0.5) + summary.wfhDays);

      return `
        <tr>
          <td>
            <div class="d-flex align-items-center gap-2">
              ${renderStaffAvatar(staff, 32)}
              <div>
                <div style="font-weight:700; color:var(--navy-dark);">${staff.name}</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${staff.id}</div>
              </div>
            </div>
          </td>
          <td style="font-size:0.82rem;">${staff.position}</td>
          <td class="text-center" style="font-weight:700; color:var(--navy-dark);">${summary.totalWorkingDays}</td>
          <td class="text-center" style="color:var(--color-present); font-weight:700;">${summary.presentDays}</td>
          <td class="text-center" style="color:var(--color-halfday); font-weight:700;">${summary.halfDays}</td>
          <td class="text-center" style="color:var(--color-leave); font-weight:700;">${summary.leaveDays}</td>
          <td class="text-center" style="color:var(--color-wfh); font-weight:700;">${summary.wfhDays}</td>
          <td class="text-center" style="color:#6B7280; font-weight:700;">${summary.sundays}</td>
          <td class="text-center">
            <div class="d-flex align-items-center justify-content-center gap-2">
              <span style="font-weight:800; color:var(--navy-dark);">${summary.attendancePercentage}</span>
              <div style="width:45px; height:6px; background:#E2E8F0; border-radius:3px; overflow:hidden;">
                <div style="height:100%; width:${summary.attendancePercentage}; background:var(--royal-blue);"></div>
              </div>
            </div>
          </td>
          <td class="text-end">
            <button class="btn btn-secondary btn-sm btn-report-dossier" data-id="${staff.id}" style="padding:3px 7px; font-size:0.72rem;">
              Calendar &rarr;
            </button>
          </td>
        </tr>
      `;
    }).join('');

    const overallPct = (totalPossibleDays > 0 && totalAttendedDays > 0)
      ? ((totalAttendedDays / totalPossibleDays) * 100).toFixed(2) + '%'
      : '0.00%';
    if (companyRateEl) companyRateEl.textContent = overallPct;

    tbody.querySelectorAll('.btn-report-dossier').forEach(btn => {
      btn.addEventListener('click', () => openStaffDossier(btn.dataset.id, reportsSelectedYear, reportsSelectedMonth));
    });
  }

  document.getElementById('btn-generate-full-audit')?.addEventListener('click', () => {
    exportAttendanceAuditCSV();
  });

  document.getElementById('btn-print-reports')?.addEventListener('click', () => {
    window.print();
  });

  function exportAttendanceAuditCSV() {
    const records = WorkPulseDB.getAttendance();
    if (records.length === 0) {
      showToast('No attendance records to export.', 'warning');
      return;
    }

    const headers = ['Date', 'Staff ID', 'Staff Name', 'Position', 'Check In', 'Check Out', 'Hours Worked', 'Status', 'GPS Telemetry', 'Notes'];
    const rows = records.map(r => {
      const isCheckedIn = r.checkIn && r.checkIn !== '--:--';
      const locVal = isCheckedIn
        ? (r.address || r.location || (r.coords && r.coords.latitude ? `${r.coords.latitude}, ${r.coords.longitude}` : (r.latitude ? `${r.latitude}, ${r.longitude}` : 'Verified Location')))
        : (r.status === 'Leave' ? 'On Approved Leave' : (r.status === 'Work From Home' ? 'Approved Remote Work' : (r.status === 'Sunday' ? 'Weekly Off' : 'Awaiting check-in')));
      return [
        `"${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(r.date) : r.date}"`,
        `"${r.staffId}"`,
        `"${r.staffName}"`,
        `"${r.position}"`,
        `"${r.checkIn}"`,
        `"${r.checkOut}"`,
        `"${r.workingHours}"`,
        `"${r.status}"`,
        `"${(locVal || '').replace(/"/g, '""')}"`,
        `"${(r.notes || '').replace(/"/g, '""')}"`
      ].join(',');
    });

    const csvText = [headers.join(','), ...rows].join('\r\n');
    downloadCSV(`WorkPulse_Attendance_Audit_${new Date().toISOString().split('T')[0]}.csv`, csvText);
    showToast('Corporate Timesheet Audit CSV generated & downloaded.', 'success');
  }

  function downloadCSV(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --------------------------------------------------------------------------
  // 13. VIEW 8: OFFICE & INACTIVITY SETTINGS
  // --------------------------------------------------------------------------
  function renderSettings() {
    const settings = WorkPulseDB.getSettings();
    const officeNameEl = document.getElementById('setting-office-name');
    const officeAddressEl = document.getElementById('setting-office-address');
    const latitudeEl = document.getElementById('setting-latitude');
    const longitudeEl = document.getElementById('setting-longitude');
    const radiusEl = document.getElementById('setting-radius');
    const checkinTimeEl = document.getElementById('setting-checkin-time');
    const requireGpsEl = document.getElementById('setting-require-gps');
    const systemInactivityEl = document.getElementById('setting-system-inactivity');
    const tabInactivityEl = document.getElementById('setting-tab-inactivity');

    if (officeNameEl) officeNameEl.value = settings.officeName || 'WorkPulse Global Headquarters';
    if (officeAddressEl) officeAddressEl.value = settings.officeAddress || '500 Howard Street, Suite 1200, San Francisco, CA 94105';
    if (latitudeEl) latitudeEl.value = settings.latitude ?? 37.7749;
    if (longitudeEl) longitudeEl.value = settings.longitude ?? -122.4194;
    if (radiusEl) radiusEl.value = settings.geofenceRadiusMeters ?? 150;
    if (checkinTimeEl) checkinTimeEl.value = settings.checkInStartTime || '09:00 AM';
    if (requireGpsEl) requireGpsEl.checked = !!settings.requireLocationPermission;
    if (systemInactivityEl) systemInactivityEl.value = settings.systemInactivityTimeoutMinutes ?? 15;
    if (tabInactivityEl) tabInactivityEl.value = settings.tabInactivityTimeoutMinutes ?? 60;

    const timezoneEl = document.getElementById('setting-office-timezone');
    const holidaysEl = document.getElementById('setting-weekly-holidays');
    if (timezoneEl) timezoneEl.value = settings.officeTimezone || 'Asia/Kolkata';
    if (holidaysEl) {
      const currentHolidays = settings.weeklyHolidays || ['Sunday'];
      holidaysEl.value = currentHolidays.includes('Saturday') && currentHolidays.includes('Sunday') ? 'Saturday,Sunday' : 'Sunday';
    }

    renderAdminProfileUI();
  }

  function handleSaveSettings() {
    const systemInactivityInput = document.getElementById('setting-system-inactivity');
    const tabInactivityInput = document.getElementById('setting-tab-inactivity');

    const systemMinutes = parseInt(systemInactivityInput?.value, 10);
    const tabMinutes = parseInt(tabInactivityInput?.value, 10);

    // Strict validation: accept only positive, reasonable time values
    if (isNaN(systemMinutes) || systemMinutes <= 0) {
      showToast('Validation Error: System-Wide Inactivity Timeout must be a positive number of minutes (minimum 1 minute).', 'error');
      if (systemInactivityInput) systemInactivityInput.focus();
      return;
    }
    if (systemMinutes > 720) {
      showToast('Validation Error: System-Wide Inactivity Timeout cannot exceed 720 minutes (12 hours).', 'error');
      if (systemInactivityInput) systemInactivityInput.focus();
      return;
    }

    if (isNaN(tabMinutes) || tabMinutes <= 0) {
      showToast('Validation Error: WorkPulse Tab Inactivity Timeout must be a positive number of minutes (minimum 1 minute).', 'error');
      if (tabInactivityInput) tabInactivityInput.focus();
      return;
    }
    if (tabMinutes > 720) {
      showToast('Validation Error: WorkPulse Tab Inactivity Timeout cannot exceed 720 minutes (12 hours).', 'error');
      if (tabInactivityInput) tabInactivityInput.focus();
      return;
    }

    const timezoneEl = document.getElementById('setting-office-timezone');
    const holidaysEl = document.getElementById('setting-weekly-holidays');
    const selectedHolidays = holidaysEl?.value === 'Saturday,Sunday' ? ['Saturday', 'Sunday'] : ['Sunday'];

    const updated = {
      officeName: document.getElementById('setting-office-name')?.value.trim() || 'WorkPulse Global Headquarters',
      officeAddress: document.getElementById('setting-office-address')?.value.trim() || '500 Howard Street, Suite 1200, San Francisco, CA 94105',
      latitude: parseFloat(document.getElementById('setting-latitude')?.value) || 37.7749,
      longitude: parseFloat(document.getElementById('setting-longitude')?.value) || -122.4194,
      geofenceRadiusMeters: parseInt(document.getElementById('setting-radius')?.value, 10) || 150,
      checkInStartTime: document.getElementById('setting-checkin-time')?.value.trim() || '09:00 AM',
      checkoutRule: 'Manual Staff Checkout',
      requireLocationPermission: !!document.getElementById('setting-require-gps')?.checked,
      officeTimezone: timezoneEl?.value || 'Asia/Kolkata',
      weeklyHolidays: selectedHolidays,
      sundayWeeklyOff: true,
      systemInactivityTimeoutMinutes: systemMinutes,
      tabInactivityTimeoutMinutes: tabMinutes
    };

    WorkPulseDB.updateSettings(updated);

    // Asynchronously notify backend REST endpoint if running with server
    if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
      fetch('/api/settings', {
        method: 'PUT',
        headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updated)
      }).catch(() => {});
    }

    showToast(`Settings Saved: System Idle Timeout set to ${systemMinutes}m, Tab Inactivity Timeout set to ${tabMinutes}m.`, 'success');
  }

  const saveSettingsBtn = document.getElementById('btn-save-settings');
  const saveAttendanceSettingsBtn = document.getElementById('btn-save-attendance-settings');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', handleSaveSettings);
  if (saveAttendanceSettingsBtn) saveAttendanceSettingsBtn.addEventListener('click', handleSaveSettings);

  // Reset / Clear Database
  const resetDbBtn = document.getElementById('btn-reset-database');
  if (resetDbBtn) {
    resetDbBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all records? All attendance, activity timelines, leaves, tasks, and notifications will be reset, while preserving staff accounts and settings.')) {
        WorkPulseDB.clearDemoData();
        showToast('All demo records cleared. Staff accounts and settings preserved.', 'success');
        renderDashboard();
        renderStaffDirectory();
        renderAttendanceLog();
        renderLeavesTable();
        renderWfhTable();
        renderActivityStatus();
        renderAdminTasks();
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
  // ==========================================================================
  // 13. STAFF WORK & PROJECT MANAGEMENT AND MEETINGS MODULE
  // ==========================================================================
  let adminWorkActiveSubtab = 'projects';
  let activeProjectsSearchFilter = '';
  let activeProjectsStaffFilter = 'all';
  let activeProjectsStatusFilter = 'all';
  let activeProjectsPriorityFilter = 'all';
  let activeProjectsDateFilter = '';

  let activeKanbanProjectFilter = 'all';
  let activeKanbanStaffFilter = 'all';
  let activeKanbanPriorityFilter = 'all';

  let activeWorkProjectFilter = 'all';
  let activeWorkStaffFilter = 'all';
  let activeWorkStatusFilter = 'all';
  let activeWorkPriorityFilter = 'all';
  let activeReportsStaffFilter = 'all';
  let activeReportsStatusFilter = 'all';
  let activeReportsSearchFilter = '';
  let activeReportsDateFilter = '';

  // Subtab buttons
  const tabBtnAdminProjects = document.getElementById('tab-btn-admin-projects');
  const tabBtnAdminKanban = document.getElementById('tab-btn-admin-kanban');
  const tabBtnAdminGantt = document.getElementById('tab-btn-admin-gantt');
  const tabBtnAdminTasks = document.getElementById('tab-btn-admin-tasks');
  const tabBtnAdminReports = document.getElementById('tab-btn-admin-reports');

  // Subtab Panes
  const subtabPaneProjects = document.getElementById('subtab-pane-projects');
  const subtabPaneKanban = document.getElementById('subtab-pane-kanban');
  const subtabPaneGantt = document.getElementById('subtab-pane-gantt');
  const subtabPaneTasks = document.getElementById('subtab-pane-tasks');
  const subtabPaneReports = document.getElementById('subtab-pane-reports');

  // Badges
  const badgeAdminProjects = document.getElementById('badge-admin-projects-count');
  const badgeAdminTasks = document.getElementById('badge-admin-tasks-count');
  const badgeAdminReports = document.getElementById('badge-admin-reports-count');
  const badgeAdminReviewsPending = document.getElementById('badge-admin-reviews-pending');
  const badgeAdminReportsPending = document.getElementById('badge-admin-reports-pending');

  // Project Modals
  const createProjectModal = document.getElementById('create-project-modal');
  const btnOpenCreateProject = document.getElementById('btn-open-create-project');
  const btnCloseCreateProject = document.getElementById('btn-close-create-project');
  const btnCancelProject = document.getElementById('btn-cancel-project');
  const createProjectForm = document.getElementById('create-project-form');

  const projectDetailsModal = document.getElementById('project-details-modal');
  const btnCloseProjectDetails = document.getElementById('btn-close-project-details');
  const projectDetailsModalContent = document.getElementById('project-details-modal-content');
  const btnProjectAddTask = document.getElementById('btn-project-add-task');
  const btnProjectEdit = document.getElementById('btn-project-edit');
  const btnProjectDelete = document.getElementById('btn-project-delete');

  // Task Modals
  const assignTaskModal = document.getElementById('assign-task-modal');
  const btnOpenAssignTask = document.getElementById('btn-open-assign-task');
  const btnCloseAssignTask = document.getElementById('btn-close-assign-task');
  const btnCancelAssignTask = document.getElementById('btn-cancel-assign-task');
  const assignTaskForm = document.getElementById('assign-task-form');

  const reviewReportModal = document.getElementById('review-report-modal');
  const btnCloseReviewReport = document.getElementById('btn-close-review-report');
  const btnCancelReviewReport = document.getElementById('btn-cancel-review-report');
  const reviewReportForm = document.getElementById('review-report-form');

  const scheduleMeetingModal = document.getElementById('schedule-meeting-modal');
  const btnOpenScheduleMeeting = document.getElementById('btn-open-schedule-meeting');
  const btnCloseScheduleMeeting = document.getElementById('btn-close-schedule-meeting');
  const btnCancelScheduleMeeting = document.getElementById('btn-cancel-schedule-meeting');
  const scheduleMeetingForm = document.getElementById('schedule-meeting-form');

  // Filter dropdowns
  const filterProjectsSearch = document.getElementById('filter-projects-search');
  const filterProjectsStaff = document.getElementById('filter-projects-staff');
  const filterProjectsStatus = document.getElementById('filter-projects-status');
  const filterProjectsPriority = document.getElementById('filter-projects-priority');
  const filterProjectsDate = document.getElementById('filter-projects-date');
  const btnResetProjectsFilter = document.getElementById('btn-reset-projects-filter');

  const filterKanbanProject = document.getElementById('filter-kanban-project');
  const filterKanbanStaff = document.getElementById('filter-kanban-staff');
  const filterKanbanPriority = document.getElementById('filter-kanban-priority');

  const filterTasksProject = document.getElementById('filter-tasks-project');
  const filterTasksStaff = document.getElementById('filter-tasks-staff');
  const filterTasksStatus = document.getElementById('filter-tasks-status');
  const filterTasksPriority = document.getElementById('filter-tasks-priority');

  // Reports & Reviews Filter Elements
  const filterReportsStaff = document.getElementById('filter-reports-staff');
  const filterReportsStatus = document.getElementById('filter-reports-status');
  const filterReportsSearch = document.getElementById('filter-reports-search');
  const filterReportsDate = document.getElementById('filter-reports-date');
  const btnResetReportsFilter = document.getElementById('btn-reset-reports-filter');
  const btnRefreshAdminReports = document.getElementById('btn-refresh-admin-reports');
  const btnRefreshAdminReportsTop = document.getElementById('btn-refresh-admin-reports-top');
  if (btnRefreshAdminReportsTop) {
    btnRefreshAdminReportsTop.addEventListener('click', () => {
      renderAdminReports();
    });
  }

  // Subtab switching
  function switchAdminWorkSubtab(subtab) {
    if (subtab === 'reports') {
      switchView('reviews');
      return;
    }
    adminWorkActiveSubtab = subtab;
    const tabs = [
      { id: 'projects', btn: tabBtnAdminProjects, pane: subtabPaneProjects },
      { id: 'kanban', btn: tabBtnAdminKanban, pane: subtabPaneKanban },
      { id: 'gantt', btn: tabBtnAdminGantt, pane: subtabPaneGantt },
      { id: 'tasks', btn: tabBtnAdminTasks, pane: subtabPaneTasks }
    ];

    tabs.forEach(t => {
      if (t.btn) {
        const isActive = t.id === subtab;
        t.btn.classList.toggle('active', isActive);
        t.btn.classList.toggle('btn-primary', isActive);
        t.btn.classList.toggle('btn-secondary', !isActive);
      }
      if (t.pane) {
        t.pane.style.display = t.id === subtab ? 'block' : 'none';
      }
    });

    if (subtab === 'projects') renderAdminProjects();
    if (subtab === 'kanban') renderAdminKanban();
    if (subtab === 'gantt') renderAdminGantt();
    if (subtab === 'tasks') renderAdminTasks();
  }

  if (tabBtnAdminProjects) tabBtnAdminProjects.addEventListener('click', () => switchAdminWorkSubtab('projects'));
  if (tabBtnAdminKanban) tabBtnAdminKanban.addEventListener('click', () => switchAdminWorkSubtab('kanban'));
  if (tabBtnAdminGantt) tabBtnAdminGantt.addEventListener('click', () => switchAdminWorkSubtab('gantt'));
  if (tabBtnAdminTasks) tabBtnAdminTasks.addEventListener('click', () => switchAdminWorkSubtab('tasks'));
  if (tabBtnAdminReports) tabBtnAdminReports.addEventListener('click', () => switchView('reviews'));

  // Main view render
  function renderWorkManagement() {
    if (adminWorkActiveSubtab === 'reports') {
      adminWorkActiveSubtab = 'projects';
    }
    populateWorkFilters();
    switchAdminWorkSubtab(adminWorkActiveSubtab);
  }

  function populateWorkFilters() {
    const staffList = WorkPulseDB.getStaffList();
    const projects = WorkPulseDB.getProjects();

    const staffOpts = '<option value="all">All Staff Members</option>' + staffList.map(s => `
      <option value="${s.id}">${s.name} (${s.id})</option>
    `).join('');

    const projectOpts = '<option value="all">All Projects</option>' + projects.map(p => `
      <option value="${p.id}">${p.name}</option>
    `).join('');

    // Projects filters
    if (filterProjectsStaff) filterProjectsStaff.innerHTML = staffOpts;
    if (filterProjectsStaff) filterProjectsStaff.value = activeProjectsStaffFilter;

    // Kanban filters
    if (filterKanbanProject) filterKanbanProject.innerHTML = projectOpts;
    if (filterKanbanProject) filterKanbanProject.value = activeKanbanProjectFilter;
    if (filterKanbanStaff) filterKanbanStaff.innerHTML = staffOpts;
    if (filterKanbanStaff) filterKanbanStaff.value = activeKanbanStaffFilter;

    // Tasks filters
    if (filterTasksProject) filterTasksProject.innerHTML = projectOpts;
    if (filterTasksProject) filterTasksProject.value = activeWorkProjectFilter;
    if (filterTasksStaff) filterTasksStaff.innerHTML = staffOpts;
    if (filterTasksStaff) filterTasksStaff.value = activeWorkStaffFilter;

    // Reports filters
    if (filterReportsStaff) filterReportsStaff.innerHTML = staffOpts;
    if (filterReportsStaff) filterReportsStaff.value = activeReportsStaffFilter;
  }

  // Filter Event Listeners
  if (filterProjectsSearch) filterProjectsSearch.addEventListener('input', (e) => { activeProjectsSearchFilter = e.target.value.toLowerCase().trim(); renderAdminProjects(); });
  if (filterProjectsStaff) filterProjectsStaff.addEventListener('change', (e) => { activeProjectsStaffFilter = e.target.value; renderAdminProjects(); });
  if (filterProjectsStatus) filterProjectsStatus.addEventListener('change', (e) => { activeProjectsStatusFilter = e.target.value; renderAdminProjects(); });
  if (filterProjectsPriority) filterProjectsPriority.addEventListener('change', (e) => { activeProjectsPriorityFilter = e.target.value; renderAdminProjects(); });
  if (filterProjectsDate) filterProjectsDate.addEventListener('change', (e) => { activeProjectsDateFilter = e.target.value; renderAdminProjects(); });
  if (btnResetProjectsFilter) {
    btnResetProjectsFilter.addEventListener('click', () => {
      activeProjectsSearchFilter = '';
      activeProjectsStaffFilter = 'all';
      activeProjectsStatusFilter = 'all';
      activeProjectsPriorityFilter = 'all';
      activeProjectsDateFilter = '';
      if (filterProjectsSearch) filterProjectsSearch.value = '';
      if (filterProjectsStaff) filterProjectsStaff.value = 'all';
      if (filterProjectsStatus) filterProjectsStatus.value = 'all';
      if (filterProjectsPriority) filterProjectsPriority.value = 'all';
      if (filterProjectsDate) filterProjectsDate.value = '';
      renderAdminProjects();
    });
  }

  if (filterKanbanProject) filterKanbanProject.addEventListener('change', (e) => { activeKanbanProjectFilter = e.target.value; renderAdminKanban(); });
  if (filterKanbanStaff) filterKanbanStaff.addEventListener('change', (e) => { activeKanbanStaffFilter = e.target.value; renderAdminKanban(); });
  if (filterKanbanPriority) filterKanbanPriority.addEventListener('change', (e) => { activeKanbanPriorityFilter = e.target.value; renderAdminKanban(); });

  if (filterTasksProject) filterTasksProject.addEventListener('change', (e) => { activeWorkProjectFilter = e.target.value; renderAdminTasks(); });
  if (filterTasksStaff) filterTasksStaff.addEventListener('change', (e) => { activeWorkStaffFilter = e.target.value; renderAdminTasks(); });
  if (filterTasksStatus) filterTasksStatus.addEventListener('change', (e) => { activeWorkStatusFilter = e.target.value; renderAdminTasks(); });
  if (filterTasksPriority) filterTasksPriority.addEventListener('change', (e) => { activeWorkPriorityFilter = e.target.value; renderAdminTasks(); });

  if (filterReportsStaff) filterReportsStaff.addEventListener('change', (e) => { activeReportsStaffFilter = e.target.value; renderAdminReports(); });
  if (filterReportsStatus) filterReportsStatus.addEventListener('change', (e) => { activeReportsStatusFilter = e.target.value; renderAdminReports(); });
  if (filterReportsSearch) filterReportsSearch.addEventListener('input', (e) => { activeReportsSearchFilter = e.target.value.toLowerCase().trim(); renderAdminReports(); });
  if (filterReportsDate) filterReportsDate.addEventListener('change', (e) => { activeReportsDateFilter = e.target.value; renderAdminReports(); });
  if (btnResetReportsFilter) {
    btnResetReportsFilter.addEventListener('click', () => {
      activeReportsStaffFilter = 'all';
      activeReportsStatusFilter = 'all';
      activeReportsSearchFilter = '';
      activeReportsDateFilter = '';
      if (filterReportsStaff) filterReportsStaff.value = 'all';
      if (filterReportsStatus) filterReportsStatus.value = 'all';
      if (filterReportsSearch) filterReportsSearch.value = '';
      if (filterReportsDate) filterReportsDate.value = '';
      renderAdminReports();
    });
  }
  if (btnRefreshAdminReports) {
    btnRefreshAdminReports.addEventListener('click', () => {
      fetchAndSyncAdminReports();
      showToast('Fetching latest staff daily reports...', 'info');
    });
  }

  // Helpers for Status & Priority styling
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
    if (p === 'urgent') return 'badge-priority-urgent';
    if (p === 'high') return 'badge-priority-high';
    if (p === 'medium') return 'badge-priority-medium';
    return 'badge-priority-low';
  }

  // ==========================================================================
  // 13.1 PROJECTS MANAGEMENT (ADMIN)
  // ==========================================================================
  function renderAdminProjects() {
    const grid = document.getElementById('admin-projects-grid');
    if (!grid) return;

    let projects = WorkPulseDB.getProjects();

    // Strict deduplication: ensure each unique project ID and title is rendered at most once
    const seenIds = new Set();
    const seenNames = new Set();
    projects = projects.filter(p => {
      if (!p || !p.id) return false;
      const norm = (p.name || '').trim().toLowerCase();
      if (seenIds.has(p.id) || (norm && seenNames.has(norm))) return false;
      seenIds.add(p.id);
      if (norm) seenNames.add(norm);
      return true;
    });

    if (badgeAdminProjects) badgeAdminProjects.textContent = projects.length;

    // Apply Filters
    if (activeProjectsSearchFilter) {
      projects = projects.filter(p => (p.name || '').toLowerCase().includes(activeProjectsSearchFilter) || (p.description || '').toLowerCase().includes(activeProjectsSearchFilter));
    }
    if (activeProjectsStaffFilter !== 'all') {
      projects = projects.filter(p => {
        const staffIds = Array.isArray(p.assignedStaffIds) ? p.assignedStaffIds : [p.assignedStaffId || 'all'];
        return staffIds.includes(activeProjectsStaffFilter) || staffIds.includes('all');
      });
    }
    if (activeProjectsStatusFilter !== 'all') {
      projects = projects.filter(p => p.status === activeProjectsStatusFilter);
    }
    if (activeProjectsPriorityFilter !== 'all') {
      projects = projects.filter(p => p.priority === activeProjectsPriorityFilter);
    }
    if (activeProjectsDateFilter) {
      projects = projects.filter(p => {
        const start = p.startDate || '';
        const due = p.dueDate || '';
        return (!start || start <= activeProjectsDateFilter) && (!due || due >= activeProjectsDateFilter);
      });
    }

    if (projects.length === 0) {
      grid.innerHTML = `
        <div class="card p-5 text-center" style="grid-column: 1 / -1; background:#F8FAFC; border:1px dashed #CBD5E1;">
          <div style="font-size: 2rem; margin-bottom: 8px;">📁</div>
          <h4 style="color:var(--navy-dark); margin-bottom:6px;">No Projects Found</h4>
          <p class="text-muted" style="font-size:0.85rem; max-width:420px; margin:0 auto 16px;">No enterprise projects match the active filters or none have been created yet.</p>
          <div>
            <button class="btn btn-primary btn-sm" id="btn-empty-create-project">Create First Project</button>
          </div>
        </div>
      `;
      const emptyBtn = document.getElementById('btn-empty-create-project');
      if (emptyBtn) emptyBtn.addEventListener('click', () => openCreateProjectModal());
      return;
    }

    grid.innerHTML = projects.map(p => {
      const progress = WorkPulseDB.getProjectProgress(p.id);
      const pct = progress.percentage ?? progress.percent ?? 0;
      const comp = progress.completedTasks ?? progress.completed ?? 0;
      const tot = progress.totalTasks ?? progress.total ?? 0;
      const subComp = progress.completedSubtasks ?? 0;
      const subTot = progress.subtasksCount ?? 0;

      const staffIds = Array.isArray(p.assignedStaffIds) ? p.assignedStaffIds : (p.assignedStaffId ? [p.assignedStaffId] : ['all']);
      const isAllStaff = staffIds.includes('all');

      let avatarsHtml = '';
      if (isAllStaff) {
        avatarsHtml = `
          <div class="avatar-stack">
            <div class="avatar-stack-item" style="background:#1D5F8F; color:#FFFFFF; font-size:0.68rem;" title="All Staff Members">ALL</div>
          </div>
          <span style="font-size:0.75rem; color:#475569; font-weight:600;">All Staff Members</span>
        `;
      } else {
        const staffMembers = staffIds.map(id => WorkPulseDB.getStaffById(id)).filter(Boolean);
        const displayed = staffMembers.slice(0, 4);
        const extraCount = staffMembers.length - 4;

        avatarsHtml = `
          <div class="avatar-stack">
            ${displayed.map(s => {
              const initials = (s.name || '').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'ST';
              return `<div class="avatar-stack-item" title="${s.name} (${s.position})">${initials}</div>`;
            }).join('')}
            ${extraCount > 0 ? `<div class="avatar-stack-item" style="background:#64748B; color:#fff; font-size:0.65rem;">+${extraCount}</div>` : ''}
          </div>
          <span style="font-size:0.75rem; color:#475569; font-weight:600;">
            ${staffMembers.length > 0 ? staffMembers.map(s => s.name).join(', ') : 'Unassigned'}
          </span>
        `;
      }

      const statusBadge = `<span class="badge ${getStatusBadgeClass(p.status)}">${p.status || 'In Progress'}</span>`;
      const priorityBadge = `<span class="badge ${getPriorityBadgeClass(p.priority)}">${p.priority || 'Medium'}</span>`;

      return `
        <div class="project-card" data-project-id="${p.id}">
          <div class="project-card-header">
            <div>
              <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">${p.id}</div>
              <h3 class="project-card-title">${escapeHtml(p.name)}</h3>
            </div>
            <div class="d-flex align-items-center gap-1">
              ${statusBadge}
              ${priorityBadge}
            </div>
          </div>

          <p class="project-card-desc" title="${escapeHtml(p.description || '')}">${escapeHtml(p.description || 'No description provided.')}</p>

          <!-- Progress -->
          <div class="project-progress-wrap">
            <div class="project-progress-header">
              <span class="project-progress-label">Task Completion Progress</span>
              <span class="project-progress-val">${pct}%</span>
            </div>
            <div class="project-progress-bar">
              <div class="project-progress-fill" style="width: ${pct}%;"></div>
            </div>
            <div class="d-flex justify-content-between align-items-center" style="font-size:0.7rem; color:#64748B; margin-top:3px;">
              <span>${comp} of ${tot} tasks completed</span>
              ${subTot > 0 ? `<span style="font-weight:600; color:var(--royal-blue);">${subComp}/${subTot} subtasks</span>` : ''}
            </div>
          </div>

          <!-- Metadata -->
          <div class="project-meta-row">
            <div class="d-flex align-items-center gap-1" style="font-size:0.75rem; color:#64748B;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              <span>${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(p.startDate) : (p.startDate || 'Start')} &rarr; <strong>${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(p.dueDate) : (p.dueDate || 'Due')}</strong></span>
            </div>
          </div>

          <!-- Team -->
          <div class="project-team-row">
            ${avatarsHtml}
          </div>

          <!-- Actions -->
          <div class="project-card-actions">
            <button class="btn btn-secondary btn-sm btn-view-project" data-project-id="${p.id}" style="font-size:0.76rem; padding:4px 10px; color:var(--royal-blue); font-weight:600;">
              View Details & Tasks
            </button>
            <div class="d-flex align-items-center gap-1">
              <button class="btn btn-ghost btn-sm btn-edit-project" data-project-id="${p.id}" title="Edit Project" style="padding:4px 8px; font-size:0.76rem;">
                Edit
              </button>
              <button class="btn btn-ghost btn-sm btn-delete-project text-danger" data-project-id="${p.id}" title="Delete Project" style="padding:4px 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Wire Card Clicks
    grid.querySelectorAll('.btn-view-project').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProjectDetailsModal(btn.dataset.projectId);
      });
    });

    grid.querySelectorAll('.btn-edit-project').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCreateProjectModal(btn.dataset.projectId);
      });
    });

    grid.querySelectorAll('.btn-delete-project').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteProject(btn.dataset.projectId);
      });
    });

    grid.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        openProjectDetailsModal(card.dataset.projectId);
      });
    });
  }

  // --- CREATE / EDIT PROJECT MODAL ---
  function openCreateProjectModal(projectId = null) {
    if (!createProjectModal || !createProjectForm) return;

    const modalTitle = document.getElementById('create-project-modal-title');
    const submitBtnLabel = document.getElementById('btn-submit-project-label');
    const idInput = document.getElementById('project-form-id');
    const nameInput = document.getElementById('project-input-name');
    const descInput = document.getElementById('project-input-desc');
    const startInput = document.getElementById('project-input-start');
    const dueInput = document.getElementById('project-input-due');
    const priorityInput = document.getElementById('project-input-priority');
    const statusInput = document.getElementById('project-input-status');
    const selectAllCheckbox = document.getElementById('project-staff-select-all');
    const checkboxesList = document.getElementById('project-staff-checkboxes-list');

    createProjectForm.reset();

    // Populate staff checkboxes
    const staffList = WorkPulseDB.getStaffList();
    if (checkboxesList) {
      checkboxesList.innerHTML = staffList.map(s => `
        <label class="d-flex align-items-center gap-2 m-0 p-1 rounded" style="cursor:pointer; font-size:0.78rem; background:#FFFFFF; border:1px solid #F1F5F9;">
          <input type="checkbox" class="project-staff-check-item" value="${s.id}">
          <span style="font-weight:600; color:var(--navy-dark);">${s.name}</span>
          <span style="color:#64748B; font-size:0.72rem;">(${s.id} &bull; ${s.position})</span>
        </label>
      `).join('');
    }

    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.onchange = () => {
        const checks = checkboxesList.querySelectorAll('.project-staff-check-item');
        checks.forEach(c => { c.checked = selectAllCheckbox.checked; });
      };
    }

    if (projectId) {
      // Edit Mode
      const project = WorkPulseDB.getProjectById(projectId);
      if (!project) return;
      if (modalTitle) modalTitle.textContent = 'Edit Project: ' + project.name;
      if (submitBtnLabel) submitBtnLabel.textContent = 'Update Project';
      if (idInput) idInput.value = project.id;
      if (nameInput) nameInput.value = project.name || '';
      if (descInput) descInput.value = project.description || '';
      if (startInput) startInput.value = project.startDate || '';
      if (dueInput) dueInput.value = project.dueDate || '';
      if (priorityInput) priorityInput.value = project.priority || 'Medium';
      if (statusInput) statusInput.value = project.status || 'In Progress';

      const assignedIds = Array.isArray(project.assignedStaffIds) ? project.assignedStaffIds : [project.assignedStaffId || 'all'];
      if (assignedIds.includes('all')) {
        if (selectAllCheckbox) selectAllCheckbox.checked = true;
        if (checkboxesList) {
          checkboxesList.querySelectorAll('.project-staff-check-item').forEach(c => { c.checked = true; });
        }
      } else {
        if (checkboxesList) {
          checkboxesList.querySelectorAll('.project-staff-check-item').forEach(c => {
            c.checked = assignedIds.includes(c.value);
          });
        }
      }
    } else {
      // Create Mode
      if (modalTitle) modalTitle.textContent = 'Create New Project';
      if (submitBtnLabel) submitBtnLabel.textContent = 'Save Project';
      if (idInput) idInput.value = '';
      const today = new Date().toISOString().split('T')[0];
      const dueObj = new Date();
      dueObj.setDate(dueObj.getDate() + 30);
      const due = dueObj.toISOString().split('T')[0];
      if (startInput) startInput.value = today;
      if (dueInput) dueInput.value = due;
      if (priorityInput) priorityInput.value = 'Medium';
      if (statusInput) statusInput.value = 'In Progress';

      // Default select all staff
      if (selectAllCheckbox) selectAllCheckbox.checked = true;
      if (checkboxesList) {
        checkboxesList.querySelectorAll('.project-staff-check-item').forEach(c => { c.checked = true; });
      }
    }

    createProjectModal.classList.add('open');
  }

  function closeCreateProjectModal() {
    if (createProjectModal) createProjectModal.classList.remove('open');
  }

  if (btnOpenCreateProject) btnOpenCreateProject.addEventListener('click', () => openCreateProjectModal());
  if (btnCloseCreateProject) btnCloseCreateProject.addEventListener('click', closeCreateProjectModal);
  if (btnCancelProject) btnCancelProject.addEventListener('click', closeCreateProjectModal);

  if (createProjectForm) {
    createProjectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('project-form-id').value;
      const name = document.getElementById('project-input-name').value.trim();
      const description = document.getElementById('project-input-desc').value.trim();
      const startDate = document.getElementById('project-input-start').value;
      const dueDate = document.getElementById('project-input-due').value;
      const priority = document.getElementById('project-input-priority').value;
      const status = document.getElementById('project-input-status').value;

      const selectAll = document.getElementById('project-staff-select-all')?.checked;
      const checkedBoxes = Array.from(document.querySelectorAll('.project-staff-check-item:checked')).map(c => c.value);

      if (!name || !description) {
        showToast('Please provide a project name and description.', 'error');
        return;
      }

      if (!selectAll && checkedBoxes.length === 0) {
        showToast('Please assign at least one staff member or select All Staff.', 'error');
        return;
      }

      const assignedStaffIds = selectAll ? ['all'] : checkedBoxes;
      const staffNames = selectAll ? 'All Staff Members' : checkedBoxes.map(cid => WorkPulseDB.getStaffById(cid)?.name || cid).join(', ');

      const projectData = {
        name,
        description,
        startDate,
        dueDate,
        priority,
        status,
        assignedStaffIds,
        assignedStaffName: staffNames
      };

      try {
        if (id) {
          await fetch(`/api/projects/${id}`, {
            method: 'PUT',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(projectData)
          });
          WorkPulseDB.updateProject(id, projectData, 'admin');
          showToast(`Project "${name}" updated successfully!`, 'success');
        } else {
          const res = await fetch('/api/projects', {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(projectData)
          });
          const json = await res.json();
          WorkPulseDB.addProject(json.project || projectData, 'admin');
          showToast(`Project "${name}" created and assigned!`, 'success');
        }
      } catch (netErr) {
        if (id) WorkPulseDB.updateProject(id, projectData, 'admin');
        else WorkPulseDB.addProject(projectData, 'admin');
        showToast(`Project saved to database.`, 'success');
      }

      closeCreateProjectModal();
      populateWorkFilters();
      renderAdminProjects();
      renderAdminKanban();
    });
  }

  async function deleteProject(projectId) {
    const project = WorkPulseDB.getProjectById(projectId);
    const projName = project ? project.name : projectId;
    if (!confirm(`Are you sure you want to delete project "${projName}"?\nTasks associated with this project will remain in the database.`)) {
      return;
    }

    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: WorkPulseDB.getAuthHeaders()
      });
    } catch (netErr) {}

    WorkPulseDB.deleteProject(projectId);
    showToast(`Project "${projName}" deleted.`, 'info');
    closeProjectDetailsModal();
    populateWorkFilters();
    renderAdminProjects();
    renderAdminKanban();
  }

  // --- PROJECT DETAILS & TASKS PAGE MODAL ---
  let activeDetailsProjectId = null;
  let activeDetailsProjectTab = 'tasks';

  function openProjectDetailsModal(projectId, targetTab = 'tasks') {
    if (!projectDetailsModal || !projectDetailsModalContent) return;
    const project = WorkPulseDB.getProjectById(projectId);
    if (!project) return;
    activeDetailsProjectId = projectId;
    activeDetailsProjectTab = targetTab;

    const titleEl = document.getElementById('project-details-title');
    const idDisplay = document.getElementById('project-details-id-display');
    const statusSelect = document.getElementById('project-details-status-select');

    if (titleEl) titleEl.textContent = project.name;
    if (idDisplay) idDisplay.textContent = `${project.id} • Created ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(project.createdAt || Date.now()) : new Date(project.createdAt || Date.now()).toLocaleDateString()}`;

    // Setup header status select dropdown
    if (statusSelect) {
      statusSelect.value = project.status || 'To Do';
      statusSelect.onchange = async () => {
        const newStatus = statusSelect.value;
        try {
          await fetch(`/api/projects/${project.id}/status`, {
            method: 'PATCH',
            headers: {
              ...WorkPulseDB.getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
          });
        } catch (e) {}

        WorkPulseDB.updateProject(project.id, { status: newStatus });
        showToast(`Project status changed to "${newStatus}"`, 'success');
        renderAdminProjects();
        renderAdminKanban();
        openProjectDetailsModal(project.id, activeDetailsProjectTab);
      };
    }

    // Wire header action buttons
    if (btnProjectAddTask) {
      btnProjectAddTask.onclick = () => {
        closeProjectDetailsModal();
        openAssignTaskModal(null, project.id);
      };
    }
    if (btnProjectEdit) {
      btnProjectEdit.onclick = () => {
        closeProjectDetailsModal();
        openCreateProjectModal(project.id);
      };
    }
    if (btnProjectDelete) {
      btnProjectDelete.onclick = () => {
        deleteProject(project.id);
      };
    }

    // Ensure array structures
    if (!Array.isArray(project.comments)) project.comments = [];
    if (!Array.isArray(project.attachments)) project.attachments = [];
    if (!Array.isArray(project.reviewHistory)) project.reviewHistory = [];

    // Progress and Tasks
    const progress = WorkPulseDB.getProjectProgress(project.id);
    const tasks = WorkPulseDB.getTasks().filter(t => t.projectId === project.id);
    const pct = progress.percentage ?? progress.percent ?? 0;
    const compTasks = progress.completedTasks ?? progress.completed ?? 0;
    const totTasks = progress.totalTasks ?? progress.total ?? 0;
    const compSubs = progress.completedSubtasks ?? 0;
    const totSubs = progress.subtasksCount ?? 0;

    // Staff badges
    const staffIds = Array.isArray(project.assignedStaffIds) ? project.assignedStaffIds : (project.assignedStaffId ? [project.assignedStaffId] : ['all']);
    const isAllStaff = staffIds.includes('all');
    let staffPills = '';
    if (isAllStaff) {
      staffPills = `<span class="badge" style="background:#1D5F8F; color:#fff; font-size:0.75rem;">All Staff Members</span>`;
    } else {
      const staffMembers = staffIds.map(id => WorkPulseDB.getStaffById(id)).filter(Boolean);
      staffPills = staffMembers.map(s => `
        <span class="badge" style="background:#F1F5F9; color:var(--navy-dark); border:1px solid #CBD5E1; font-size:0.75rem;">
          👤 ${s.name} (${s.position})
        </span>
      `).join(' ');
    }

    // Modal Markup with Navigation Tabs
    projectDetailsModalContent.innerHTML = `
      <!-- Top Overview Card -->
      <div class="card p-3 mb-3" style="background:#F8FAFC; border:1px solid #E2E8F0;">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div style="max-width: 65%;">
            <div class="d-flex align-items-center gap-2 mb-1">
              <span class="badge ${getStatusBadgeClass(project.status)}" style="font-size:0.76rem;">${project.status}</span>
              <span class="badge ${getPriorityBadgeClass(project.priority)}" style="font-size:0.76rem;">${project.priority} Priority</span>
            </div>
            <p style="font-size:0.86rem; color:#334155; line-height:1.5; margin:0;">${escapeHtml(project.description || 'No detailed description.')}</p>
          </div>
          <div style="background:#FFFFFF; padding:10px 16px; border-radius:8px; border:1px solid #E2E8F0; text-align:right;">
            <div style="font-size:0.72rem; color:#64748B; text-transform:uppercase; font-weight:700;">Active Timeline</div>
            <div style="font-weight:700; color:var(--navy-dark); font-size:0.86rem; margin-top:2px;">
              ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(project.startDate) : (project.startDate || 'Started')} &rarr; ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(project.dueDate) : (project.dueDate || 'No Due Date')}
            </div>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="mb-3">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span style="font-size:0.76rem; font-weight:700; color:var(--navy-dark); text-transform:uppercase;">Overall Project Progress</span>
            <span style="font-weight:800; font-size:0.95rem; color:var(--royal-blue);">${pct}%</span>
          </div>
          <div class="project-progress-bar" style="height:10px;">
            <div class="project-progress-fill" style="width: ${pct}%;"></div>
          </div>
          <div class="d-flex justify-content-between align-items-center" style="font-size:0.72rem; color:#64748B; margin-top:4px;">
            <span>${compTasks} completed out of ${totTasks} tasks</span>
            <span>${totSubs > 0 ? `${compSubs} of ${totSubs} subtasks finished` : 'No subtasks'}</span>
          </div>
        </div>

        <!-- Assigned Staff -->
        <div>
          <div style="font-size:0.72rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:6px;">Assigned Staff Members:</div>
          <div class="d-flex flex-wrap gap-1">
            ${staffPills}
          </div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="d-flex border-bottom mb-3" style="gap:4px;">
        <button type="button" class="btn btn-sm ${activeDetailsProjectTab === 'tasks' ? 'btn-primary' : 'btn-ghost'} proj-tab-btn" data-tab="tasks" style="font-weight:700;">
          📋 Tasks & Subtasks (${tasks.length})
        </button>
        <button type="button" class="btn btn-sm ${activeDetailsProjectTab === 'comments' ? 'btn-primary' : 'btn-ghost'} proj-tab-btn" data-tab="comments" style="font-weight:700;">
          💬 Comments & Discussion (${project.comments.length})
        </button>
        <button type="button" class="btn btn-sm ${activeDetailsProjectTab === 'attachments' ? 'btn-primary' : 'btn-ghost'} proj-tab-btn" data-tab="attachments" style="font-weight:700;">
          📎 Attachments (${project.attachments.length})
        </button>
        <button type="button" class="btn btn-sm ${activeDetailsProjectTab === 'reviews' ? 'btn-primary' : 'btn-ghost'} proj-tab-btn" data-tab="reviews" style="font-weight:700;">
          📜 Review History (${project.reviewHistory.length})
        </button>
      </div>

      <!-- TAB 1: TASKS & SUBTASKS -->
      <div id="proj-tab-pane-tasks" style="display: ${activeDetailsProjectTab === 'tasks' ? 'block' : 'none'};">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h4 style="font-size:0.92rem; font-weight:700; color:var(--navy-dark); margin:0;">
            Project Tasks & Subtasks Breakdown
          </h4>
        </div>

        ${tasks.length === 0 ? `
          <div class="text-center p-4" style="background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:8px;">
            <p style="color:#64748B; font-size:0.85rem; margin-bottom:12px;">No tasks assigned to this project yet.</p>
            <button class="btn btn-primary btn-sm" id="btn-project-empty-add-task">Create First Task for this Project</button>
          </div>
        ` : `
          <div class="table-container" style="border:1px solid #E2E8F0; border-radius:8px;">
            <table class="table mb-0">
              <thead>
                <tr style="background:#F8FAFC;">
                  <th style="width: 85px;">Task ID</th>
                  <th>Task Title & Subtasks</th>
                  <th style="width: 170px;">Assigned Staff</th>
                  <th style="width: 105px;">Due Date</th>
                  <th class="text-center" style="width: 80px;">Priority</th>
                  <th class="text-center" style="width: 100px;">Status</th>
                  <th class="text-end" style="width: 110px;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${tasks.map(t => {
                  const subCount = Array.isArray(t.subtasks) ? t.subtasks.length : 0;
                  const completedSubs = Array.isArray(t.subtasks) ? t.subtasks.filter(s => s.completed).length : 0;
                  const staffName = t.assignedStaffName || (t.assignedStaffId === 'all' ? 'All Staff' : (WorkPulseDB.getStaffById(t.assignedStaffId)?.name || 'Unassigned'));

                  return `
                    <tr>
                      <td style="font-weight:700; color:var(--royal-blue); font-size:0.78rem;">${t.id}</td>
                      <td>
                        <div style="font-weight:700; color:var(--navy-dark); font-size:0.84rem;">${escapeHtml(t.title)}</div>
                        <div style="font-size:0.74rem; color:#64748B; margin-bottom:6px;">${escapeHtml(t.description || '')}</div>
                        
                        <!-- Subtasks checklist -->
                        ${subCount > 0 ? `
                          <div style="background:#F8FAFC; padding:8px 10px; border-radius:6px; border:1px solid #E2E8F0; margin-top:6px;">
                            <div style="font-size:0.70rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:4px;">
                              Subtasks (${completedSubs}/${subCount} completed):
                            </div>
                            <div class="d-flex flex-column gap-1">
                              ${t.subtasks.map(sub => `
                                <label class="d-flex align-items-center gap-2 m-0" style="font-size:0.76rem; cursor:pointer;">
                                  <input type="checkbox" class="proj-subtask-chk" data-task-id="${t.id}" data-subtask-id="${sub.id}" ${sub.completed ? 'checked' : ''}>
                                  <span style="${sub.completed ? 'text-decoration:line-through; color:#94A3B8;' : 'color:#1E293B;'}">${escapeHtml(sub.title)}</span>
                                  <span class="badge ms-auto" style="font-size:0.60rem; ${sub.completed ? 'background:#D1FAE5; color:#065F46;' : 'background:#EFF6FF; color:#1E40AF;'}">
                                    ${sub.completed ? 'Done' : ((typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(sub.dueDate) : (sub.dueDate || 'Active'))}
                                  </span>
                                </label>
                              `).join('')}
                            </div>
                          </div>
                        ` : ''}
                      </td>
                      <td style="font-size:0.78rem; font-weight:600; color:#334155;">👤 ${escapeHtml(staffName)}</td>
                      <td style="font-size:0.76rem; color:#475569;">${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(t.dueDate) : (t.dueDate || 'Ongoing')}</td>
                      <td class="text-center"><span class="badge ${getPriorityBadgeClass(t.priority)}">${t.priority}</span></td>
                      <td class="text-center"><span class="badge ${getStatusBadgeClass(t.status)}">${t.status}</span></td>
                      <td class="text-end" style="white-space:nowrap;">
                        <button class="btn btn-ghost btn-sm btn-project-task-add-sub" data-task-id="${t.id}" style="font-size:0.72rem; padding:3px 7px; color:var(--royal-blue); margin-right:4px;" title="Add Subtask to this Task">
                          + Subtask
                        </button>
                        <button class="btn btn-secondary btn-sm btn-project-task-view" data-task-id="${t.id}" style="font-size:0.72rem; padding:3px 8px; color:var(--royal-blue);">
                          Manage
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <!-- TAB 2: COMMENTS & DISCUSSION -->
      <div id="proj-tab-pane-comments" style="display: ${activeDetailsProjectTab === 'comments' ? 'block' : 'none'};">
        <div class="card p-3 mb-3" style="background:#F8FAFC; border:1px solid #E2E8F0;">
          <h5 style="font-size:0.86rem; font-weight:700; color:var(--navy-dark); margin-bottom:8px;">Add Project Comment / Update</h5>
          <div class="mb-2">
            <textarea class="form-control" id="proj-comment-input" rows="3" placeholder="Share updates, discussion notes, questions, or milestone announcements..."></textarea>
          </div>
          <div class="d-flex justify-content-end">
            <button class="btn btn-primary btn-sm" id="btn-submit-proj-comment" style="font-size:0.78rem;">
              Post Comment
            </button>
          </div>
        </div>

        <div class="d-flex flex-column gap-2" id="proj-comments-stream">
          ${project.comments.length === 0 ? `
            <div class="text-center p-4 text-muted" style="font-size:0.82rem; background:#F8FAFC; border-radius:6px;">
              No comments posted yet. Be the first to start the discussion!
            </div>
          ` : project.comments.map(c => `
            <div class="card p-3" style="background:#FFFFFF; border:1px solid #E2E8F0;">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <div class="d-flex align-items-center gap-2">
                  <span class="avatar-circle-sm" style="width:24px; height:24px; border-radius:50%; background:var(--royal-blue); color:#fff; font-size:0.65rem; font-weight:700; display:inline-flex; align-items:center; justify-content:center;">
                    ${(c.author || 'AD').substring(0,2).toUpperCase()}
                  </span>
                  <span style="font-weight:700; font-size:0.82rem; color:var(--navy-dark);">${escapeHtml(c.author || 'User')}</span>
                  <span class="badge" style="font-size:0.62rem; background:#F1F5F9; color:#475569;">${c.authorRole || 'Team'}</span>
                </div>
                <span style="font-size:0.70rem; color:#94A3B8;">${new Date(c.createdAt || Date.now()).toLocaleString()}</span>
              </div>
              <p style="font-size:0.82rem; color:#334155; margin:0; line-height:1.5;">${escapeHtml(c.text || '')}</p>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- TAB 3: ATTACHMENTS -->
      <div id="proj-tab-pane-attachments" style="display: ${activeDetailsProjectTab === 'attachments' ? 'block' : 'none'};">
        <div class="card p-3 mb-3" style="background:#F8FAFC; border:1px solid #E2E8F0;">
          <h5 style="font-size:0.86rem; font-weight:700; color:var(--navy-dark); margin-bottom:6px;">Upload Project Document / Spec</h5>
          <div class="d-flex align-items-center gap-2">
            <input type="file" id="proj-attachment-file-input" class="form-control form-control-sm" style="max-width:380px;">
            <button class="btn btn-secondary btn-sm" id="btn-upload-proj-attachment" style="font-size:0.78rem;">
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
                  <td style="font-size:0.76rem; color:#334155;">👤 ${escapeHtml(att.uploadedBy || 'Admin')}</td>
                  <td style="font-size:0.74rem; color:#64748B;">${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(att.uploadedAt || Date.now()) : new Date(att.uploadedAt || Date.now()).toLocaleDateString()}</td>
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
      <div id="proj-tab-pane-reviews" style="display: ${activeDetailsProjectTab === 'reviews' ? 'block' : 'none'};">
        <div class="card p-3 mb-3" style="background:#F8FAFC; border:1px solid #E2E8F0;">
          <h5 style="font-size:0.86rem; font-weight:700; color:var(--navy-dark); margin-bottom:8px;">Record Executive Review / Milestone Signoff</h5>
          <div class="row g-2 mb-2">
            <div class="col-md-4">
              <label class="form-label" style="font-size:0.75rem; font-weight:700;">Review Decision</label>
              <select class="form-control form-control-sm" id="proj-review-decision">
                <option value="Approved">Approved</option>
                <option value="Milestone Met">Milestone Met</option>
                <option value="Changes Requested">Changes Requested</option>
                <option value="Audited">Audited</option>
              </select>
            </div>
            <div class="col-md-8">
              <label class="form-label" style="font-size:0.75rem; font-weight:700;">Review Notes & Guidance</label>
              <input type="text" class="form-control form-control-sm" id="proj-review-notes" placeholder="e.g. Q4 deliverable verified, ready for client deployment.">
            </div>
          </div>
          <div class="d-flex justify-content-end">
            <button class="btn btn-primary btn-sm" id="btn-submit-proj-review" style="font-size:0.78rem;">
              Save Review Note
            </button>
          </div>
        </div>

        <div class="timeline-container p-3 rounded" style="background:#FFFFFF; border:1px solid #E2E8F0;">
          ${project.reviewHistory.length === 0 ? `
            <div class="text-center p-3 text-muted" style="font-size:0.82rem;">No review history recorded yet.</div>
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
    projectDetailsModalContent.querySelectorAll('.proj-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        openProjectDetailsModal(projectId, target);
      });
    });

    // Wire Subtask completion toggling inside project details
    projectDetailsModalContent.querySelectorAll('.proj-subtask-chk').forEach(chk => {
      chk.addEventListener('change', async () => {
        const taskId = chk.dataset.taskId;
        const subtaskId = chk.dataset.subtaskId;
        const isDone = chk.checked;
        
        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'PATCH',
            headers: {
              ...WorkPulseDB.getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ completed: isDone })
          });
        } catch (e) {}

        WorkPulseDB.toggleSubtask(taskId, subtaskId, isDone);
        showToast(`Subtask ${isDone ? 'completed' : 'uncompleted'}`, 'info');
        renderAdminProjects();
        renderAdminKanban();
        openProjectDetailsModal(projectId, 'tasks');
      });
    });

    // Wire Add Comment
    const btnComment = document.getElementById('btn-submit-proj-comment');
    if (btnComment) {
      btnComment.addEventListener('click', async () => {
        const commentInput = document.getElementById('proj-comment-input');
        const text = (commentInput?.value || '').trim();
        if (!text) return showToast('Please enter comment text', 'warning');

        try {
          await fetch(`/api/projects/${projectId}/comments`, {
            method: 'POST',
            headers: {
              ...WorkPulseDB.getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
          });
        } catch (e) {}

        WorkPulseDB.addProjectComment(projectId, text, { name: 'Administrator', role: 'admin' });
        showToast('Comment posted successfully', 'success');
        openProjectDetailsModal(projectId, 'comments');
      });
    }

    // Wire Add Attachment
    const btnUpload = document.getElementById('btn-upload-proj-attachment');
    if (btnUpload) {
      btnUpload.addEventListener('click', () => {
        const fileInput = document.getElementById('proj-attachment-file-input');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
          return showToast('Please select a file to upload', 'warning');
        }
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = async (e) => {
          const dataBase64 = e.target.result;
          const sizeKb = Math.round(file.size / 1024);
          const sizeStr = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

          try {
            await fetch(`/api/projects/${projectId}/attachments`, {
              method: 'POST',
              headers: {
                ...WorkPulseDB.getAuthHeaders(),
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                name: file.name,
                size: sizeStr,
                dataBase64
              })
            });
          } catch (netErr) {}

          WorkPulseDB.addProjectAttachment(projectId, {
            name: file.name,
            size: sizeStr,
            url: dataBase64
          }, { name: 'Administrator' });

          showToast(`Attachment "${file.name}" uploaded successfully`, 'success');
          openProjectDetailsModal(projectId, 'attachments');
        };
        reader.readAsDataURL(file);
      });
    }

    // Wire Add Review
    const btnReview = document.getElementById('btn-submit-proj-review');
    if (btnReview) {
      btnReview.addEventListener('click', async () => {
        const decisionSelect = document.getElementById('proj-review-decision');
        const notesInput = document.getElementById('proj-review-notes');
        const decision = decisionSelect?.value || 'Approved';
        const notes = (notesInput?.value || '').trim();

        try {
          await fetch(`/api/projects/${projectId}/reviews`, {
            method: 'POST',
            headers: {
              ...WorkPulseDB.getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ decision, notes })
          });
        } catch (e) {}

        WorkPulseDB.addProjectReview(projectId, { decision, notes }, { name: 'Administrator' });
        showToast('Executive review saved', 'success');
        openProjectDetailsModal(projectId, 'reviews');
      });
    }

    // Wire inline add task button
    const inlineAdd = document.getElementById('btn-project-add-task-inline');
    if (inlineAdd) {
      inlineAdd.addEventListener('click', () => {
        closeProjectDetailsModal();
        openAssignTaskModal(null, project.id);
      });
    }

    const emptyAdd = document.getElementById('btn-project-empty-add-task');
    if (emptyAdd) {
      emptyAdd.addEventListener('click', () => {
        closeProjectDetailsModal();
        openAssignTaskModal(null, project.id);
      });
    }

    // Wire task view & subtask buttons inside project details
    projectDetailsModalContent.querySelectorAll('.btn-project-task-view').forEach(btn => {
      btn.addEventListener('click', () => {
        closeProjectDetailsModal();
        openAdminTaskModal(btn.dataset.taskId);
      });
    });

    projectDetailsModalContent.querySelectorAll('.btn-project-task-add-sub').forEach(btn => {
      btn.addEventListener('click', () => {
        closeProjectDetailsModal();
        openAdminTaskModal(btn.dataset.taskId, { autoOpenAddSubtask: true });
      });
    });

    // Wire quick subtask toggles in project breakdown table
    projectDetailsModalContent.querySelectorAll('.proj-subtask-chk').forEach(chk => {
      chk.addEventListener('change', async () => {
        const taskId = chk.dataset.taskId;
        const subtaskId = chk.dataset.subtaskId;
        const completed = chk.checked;
        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ completed })
          });
        } catch (e) {}
        WorkPulseDB.toggleSubtask(taskId, subtaskId, completed, 'admin');
        openProjectDetailsModal(projectId, 'tasks');
        renderAdminProjects();
        renderAdminKanban();
        renderAdminTasks();
      });
    });

    projectDetailsModal.classList.add('open');
  }

  function closeProjectDetailsModal() {
    if (projectDetailsModal) projectDetailsModal.classList.remove('open');
  }

  if (btnCloseProjectDetails) btnCloseProjectDetails.addEventListener('click', closeProjectDetailsModal);

  // ==========================================================================
  // 13.2 KANBAN BOARD (ADMIN & STAFF)
  // ==========================================================================
  const KANBAN_STATUSES = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Completed', 'On Hold'];

  function renderAdminKanban() {
    let tasks = WorkPulseDB.getTasks();

    // Filters
    if (activeKanbanProjectFilter !== 'all') {
      tasks = tasks.filter(t => t.projectId === activeKanbanProjectFilter);
    }
    if (activeKanbanStaffFilter !== 'all') {
      tasks = tasks.filter(t => {
        const staffIds = Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds : [t.assignedStaffId || 'all'];
        return staffIds.includes(activeKanbanStaffFilter) || staffIds.includes('all');
      });
    }
    if (activeKanbanPriorityFilter !== 'all') {
      tasks = tasks.filter(t => t.priority === activeKanbanPriorityFilter);
    }

    KANBAN_STATUSES.forEach(status => {
      const colSlug = status.toLowerCase().replace(/\s+/g, '');
      const listEl = document.getElementById(`kanban-list-${colSlug}`);
      const counterEl = document.getElementById(`counter-kanban-${colSlug}`);
      if (!listEl) return;

      // Normalize status matching (Pending -> To Do fallback)
      const colTasks = tasks.filter(t => {
        if (t.status === status) return true;
        if (status === 'To Do' && t.status === 'Pending') return true;
        return false;
      });

      if (counterEl) counterEl.textContent = colTasks.length;

      if (colTasks.length === 0) {
        listEl.innerHTML = `
          <div style="padding:16px 8px; text-align:center; color:#94A3B8; font-size:0.75rem; border:1px dashed #CBD5E1; border-radius:6px;">
            No tasks
          </div>
        `;
      } else {
        listEl.innerHTML = colTasks.map(t => {
          const project = t.projectId ? WorkPulseDB.getProjectById(t.projectId) : null;
          const projName = project ? project.name : (t.projectName || '');
          const staffMember = WorkPulseDB.getStaffById(t.assignedStaffId);
          const staffName = t.assignedStaffName || (t.assignedStaffId === 'all' ? 'All Staff Members' : (staffMember ? staffMember.name : (Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds.map(id => WorkPulseDB.getStaffById(id)?.name || id).join(', ') : 'Unassigned Staff')));
          const initials = (staffName || 'ST').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

          const subCount = Array.isArray(t.subtasks) ? t.subtasks.length : 0;
          const completedSubs = Array.isArray(t.subtasks) ? t.subtasks.filter(s => s.completed).length : 0;
          const commentsCount = Array.isArray(t.comments) ? t.comments.length : 0;

          return `
            <div class="kanban-card" draggable="true" data-task-id="${t.id}">
              <div class="kanban-card-meta">
                ${projName ? `<span class="kanban-card-project" title="${projName}">📁 ${projName}</span>` : '<span></span>'}
                <span class="badge ${getPriorityBadgeClass(t.priority)}" style="font-size:0.65rem;">${t.priority}</span>
              </div>

              <div class="kanban-card-title">${t.title}</div>

              <div class="d-flex align-items-center gap-2 flex-wrap mb-2" style="font-size:0.7rem; color:#64748B;">
                ${subCount > 0 ? `<span>✓ ${completedSubs}/${subCount} subtasks</span>` : ''}
                ${commentsCount > 0 ? `<span>💬 ${commentsCount}</span>` : ''}
                ${t.file ? `<span>📎 Doc</span>` : ''}
              </div>

              <div class="kanban-card-footer">
                <div class="kanban-card-staff" title="${staffName}">
                  <div class="kanban-avatar">${initials}</div>
                  <span class="kanban-staff-name">${staffName}</span>
                </div>
                <div class="kanban-card-due" title="Due Date">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg>
                  <span>${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(t.dueDate) : (t.dueDate || 'Ongoing')}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }

      // Wire dragover and drop on column list
      listEl.ondragover = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.classList.add('drag-over');
      };

      listEl.ondragleave = () => {
        listEl.classList.remove('drag-over');
      };

      listEl.ondrop = async (e) => {
        e.preventDefault();
        listEl.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (!taskId) return;

        const targetStatus = status;
        const task = WorkPulseDB.getTaskById(taskId);
        if (task && task.status !== targetStatus) {
          try {
            await fetch(`/api/tasks/${taskId}/status`, {
              method: 'PATCH',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ status: targetStatus })
            });
          } catch (netErr) {}

          WorkPulseDB.updateTaskStatus(taskId, targetStatus, 'admin');
          showToast(`Task moved to "${targetStatus}".`, 'success');
          renderAdminKanban();
          renderAdminTasks();
          renderAdminProjects();
        }
      };
    });

    // Wire Card Dragstart & Click
    document.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.taskId);
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });

      card.addEventListener('click', () => {
        openAdminTaskModal(card.dataset.taskId);
      });
    });
  }

  // ==========================================================================
  // 13.2B GANTT CHART TIMELINE (ADMIN)
  // ==========================================================================
  function renderAdminGantt() {
    if (!window.WorkPulseGantt) return;
    const projects = WorkPulseDB.getProjects();
    const tasks = WorkPulseDB.getTasks();
    const staffList = WorkPulseDB.getStaffList();

    WorkPulseGantt.render({
      container: 'subtab-pane-gantt',
      isAdmin: true,
      projects,
      tasks,
      staffList,
      onOpenTaskModal: (taskId) => {
        openAdminTaskModal(taskId);
      },
      onOpenProjectModal: (projectId) => {
        openProjectDetailsModal(projectId);
      },
      onUpdateTaskDates: async (taskId, startDate, dueDate) => {
        const token = localStorage.getItem('workpulse_admin_token') || sessionStorage.getItem('workpulse_admin_token');
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
        WorkPulseDB.updateTask(taskId, { startDate, dueDate }, 'admin');
        showToast('Task schedule dates updated successfully', 'success');
        renderAdminGantt();
        renderAdminKanban();
        renderAdminProjects();
        renderAdminTasks();
      },
      onRefreshAll: () => {
        renderAdminGantt();
        renderAdminKanban();
        renderAdminProjects();
        renderAdminTasks();
      }
    });
  }

  // ==========================================================================
  // 13.3 ASSIGNED TASKS (TABLE VIEW)
  // ==========================================================================
  function renderAdminTasks() {
    const tbody = document.getElementById('admin-tasks-tbody');
    if (!tbody) return;

    let tasks = WorkPulseDB.getTasks();
    if (badgeAdminTasks) badgeAdminTasks.textContent = tasks.length;

    // Filters
    if (activeWorkProjectFilter !== 'all') {
      tasks = tasks.filter(t => t.projectId === activeWorkProjectFilter);
    }
    if (activeWorkStaffFilter !== 'all') {
      tasks = tasks.filter(t => {
        const staffIds = Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds : [t.assignedStaffId || 'all'];
        return staffIds.includes(activeWorkStaffFilter) || staffIds.includes('all');
      });
    }
    if (activeWorkStatusFilter !== 'all') {
      tasks = tasks.filter(t => t.status === activeWorkStatusFilter);
    }
    if (activeWorkPriorityFilter !== 'all') {
      tasks = tasks.filter(t => t.priority === activeWorkPriorityFilter);
    }

    if (tasks.length === 0) {
      tbody.innerHTML = renderEmptyTableState(9, 'No Tasks Found', 'No tasks match the active filter criteria.');
      return;
    }

    tbody.innerHTML = tasks.map(t => {
      const staffMember = WorkPulseDB.getStaffById(t.assignedStaffId);
      const staffName = t.assignedStaffName || (t.assignedStaffId === 'all' ? 'All Staff Members' : (staffMember ? staffMember.name : (Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds.map(id => WorkPulseDB.getStaffById(id)?.name || id).join(', ') : 'Unassigned Staff')));
      const staffPos = staffMember ? staffMember.position : '';
      const avatarHtml = staffMember ? renderStaffAvatar(staffMember, 30) : '<div class="staff-avatar-thumb" style="width:30px;height:30px; background:#1D5F8F; color:#fff; font-size:0.68rem;">ALL</div>';

      const project = t.projectId ? WorkPulseDB.getProjectById(t.projectId) : null;
      const projName = project ? project.name : (t.projectName || '');

      const subCount = Array.isArray(t.subtasks) ? t.subtasks.length : 0;
      const completedSubs = Array.isArray(t.subtasks) ? t.subtasks.filter(s => s.completed).length : 0;

      const priorityBadge = `<span class="badge ${getPriorityBadgeClass(t.priority)}" style="font-size:0.7rem;">${t.priority}</span>`;

      return `
        <tr>
          <td style="font-weight:700; color:var(--royal-blue); font-size:0.78rem;">${t.id}</td>
          <td>
            <div style="font-weight:700; color:var(--navy-dark); font-size:0.84rem;">${t.title}</div>
            ${projName ? `<div style="font-size:0.72rem; color:var(--royal-blue); font-weight:600; margin-top:2px;">📁 ${projName}</div>` : ''}
            ${t.file ? `
              <div style="margin-top: 3px;">
                <a href="${t.file.url || t.file.dataBase64}" download="${t.file.name}" class="badge" style="background:#F1F5F9; color:var(--royal-blue); border:1px solid var(--border-color); text-decoration:none; display:inline-flex; align-items:center; gap:3px; font-size:0.68rem;" title="Download deliverable: ${t.file.name} (${t.file.size})">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                  <span>${t.file.name}</span>
                </a>
              </div>
            ` : ''}
          </td>
          <td>
            <div style="font-size:0.76rem; color:#475569; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${t.description || ''}">
              ${t.description || 'No description'}
            </div>
            ${subCount > 0 ? `<div style="font-size:0.7rem; color:#64748B; margin-top:2px;">Subtasks: ${completedSubs}/${subCount} completed</div>` : ''}
          </td>
          <td>
            <div class="staff-cell-flex">
              ${avatarHtml}
              <div class="staff-meta-inline">
                <span class="name-txt">${staffName}</span>
                <span class="sub-txt">${staffPos}</span>
              </div>
            </div>
          </td>
          <td style="font-size:0.76rem; color:var(--text-muted);">${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(t.startDate || t.assignedDate) : (t.startDate || t.assignedDate || 'Today')}</td>
          <td style="font-size:0.76rem; color:var(--navy-dark); font-weight:600;">${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(t.dueDate) : (t.dueDate || 'Ongoing')}</td>
          <td class="text-center">${priorityBadge}</td>
          <td class="text-center">
            <select class="form-control form-control-sm admin-task-status-change" data-task-id="${t.id}" style="font-size:0.74rem; font-weight:600; padding:3px 6px;">
              ${KANBAN_STATUSES.map(st => `<option value="${st}" ${t.status === st ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
          </td>
          <td class="text-end">
            <div class="d-flex align-items-center justify-content-end gap-1">
              <button class="btn btn-secondary btn-sm btn-view-task-admin" data-task-id="${t.id}" style="padding:3px 8px; font-size:0.72rem; color:var(--royal-blue); border-color:rgba(29,95,143,0.3);" title="Details, subtasks, discussion and reviews">
                📂 Details (${Array.isArray(t.submissions) ? t.submissions.length : 0})
              </button>
              <button class="btn btn-ghost btn-sm btn-delete-task text-danger" data-task-id="${t.id}" title="Delete Task" style="padding:3px 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Status change listener
    tbody.querySelectorAll('.admin-task-status-change').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const taskId = sel.dataset.taskId;
        const newStatus = e.target.value;
        try {
          await fetch(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: newStatus })
          });
        } catch (netErr) {}

        WorkPulseDB.updateTaskStatus(taskId, newStatus, 'admin');
        showToast(`Task status updated to "${newStatus}".`, 'success');
        renderAdminKanban();
        renderAdminProjects();
      });
    });

    // View task details modal listener
    tbody.querySelectorAll('.btn-view-task-admin').forEach(btn => {
      btn.addEventListener('click', () => {
        openAdminTaskModal(btn.dataset.taskId);
      });
    });

    // Delete task listener
    tbody.querySelectorAll('.btn-delete-task').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.dataset.taskId;
        if (confirm(`Are you sure you want to delete task ${taskId}?`)) {
          try {
            await fetch(`/api/tasks/${taskId}`, { method: 'DELETE', headers: WorkPulseDB.getAuthHeaders() });
          } catch (netErr) {}
          WorkPulseDB.deleteTask(taskId);
          showToast('Task deleted.', 'info');
          renderAdminTasks();
          renderAdminKanban();
          renderAdminProjects();
        }
      });
    });
  }

  // ==========================================================================
  // 13.4 ADMIN TASK DETAILS, SUBTASKS, COMMENTS & REVIEWS MODAL
  // ==========================================================================
  const adminTaskModal = document.getElementById('admin-task-detail-modal');
  const btnCloseAdminTaskModal = document.getElementById('btn-close-admin-task-modal');
  const adminTaskModalContent = document.getElementById('admin-task-modal-content');

  function openAdminTaskModal(taskId, options = {}) {
    if (!adminTaskModal || !adminTaskModalContent) return;
    const task = WorkPulseDB.getTaskById(taskId);
    if (!task) return;

    const staffList = WorkPulseDB.getStaffList();
    const staffMember = WorkPulseDB.getStaffById(task.assignedStaffId);
    const staffName = task.assignedStaffName || (task.assignedStaffId === 'all' ? 'All Corporate Staff' : (staffMember ? staffMember.name : (Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds.map(id => WorkPulseDB.getStaffById(id)?.name || id).join(', ') : 'Unassigned')));
    const project = task.projectId ? WorkPulseDB.getProjectById(task.projectId) : null;
    const projName = project ? project.name : (task.projectName || 'Standalone Task');

    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    const comments = Array.isArray(task.comments) ? task.comments : [];
    const activity = Array.isArray(task.activity) ? task.activity : [];
    const submissions = Array.isArray(task.submissions) ? task.submissions : [];

    const completedSubs = subtasks.filter(s => s.completed || s.status === 'Completed').length;
    const todayStr = new Date().toISOString().split('T')[0];

    const staffOptionsHtml = staffList.map(st => `
      <option value="${st.id}">${escapeHtml(st.name)} (${escapeHtml(st.position || 'Staff')})</option>
    `).join('');

    // Unlimited Subtasks Enterprise Management HTML
    const subtasksHtml = `
      <div class="subtasks-container mb-4" id="admin-subtasks-section">
        <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2 pb-2" style="border-bottom:1px solid #E2E8F0;">
          <div>
            <span style="font-weight:700; font-size:0.95rem; color:var(--navy-dark);">
              Subtasks Management (${completedSubs}/${subtasks.length})
            </span>
            <div style="font-size:0.74rem; color:#64748B; margin-top:2px;">
              Parent task automatically updates based on subtask completion: <strong style="color:var(--navy-dark);">${task.progress || 0}% Complete</strong>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-toggle-add-subtask-form" style="display:inline-flex; align-items:center; gap:5px; font-size:0.78rem; font-weight:600; padding:5px 12px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Add Subtask</span>
          </button>
        </div>

        <!-- Collapsible Add Subtask Form Card -->
        <div class="subtask-add-card mb-3" id="admin-add-subtask-card" style="display:none;">
          <h5 style="font-size:0.88rem; font-weight:700; color:var(--navy-dark); margin-bottom:12px;">
            Create New Subtask
          </h5>
          <form id="admin-add-subtask-form">
            <div class="row g-2 mb-2">
              <div class="col-md-8">
                <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block; margin-bottom:3px;">Subtask Title *</label>
                <input type="text" class="form-control form-control-sm" id="admin-new-subtask-title" placeholder="e.g. Design responsive UI layout..." required>
              </div>
              <div class="col-md-4">
                <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block; margin-bottom:3px;">Assign Staff</label>
                <select class="form-control form-control-sm" id="admin-new-subtask-staff">
                  <option value="">Inherit Task Assignee</option>
                  <option value="all">All Corporate Staff</option>
                  ${staffOptionsHtml}
                </select>
              </div>
            </div>
            <div class="mb-2">
              <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block; margin-bottom:3px;">Description & Scope</label>
              <textarea class="form-control form-control-sm" id="admin-new-subtask-desc" rows="2" placeholder="Specific technical requirements or deliverable checklist for this subtask..."></textarea>
            </div>
            <div class="row g-2 mb-3">
              <div class="col-md-3">
                <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block; margin-bottom:3px;">Start Date</label>
                <input type="date" class="form-control form-control-sm" id="admin-new-subtask-start" value="${todayStr}">
              </div>
              <div class="col-md-3">
                <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block; margin-bottom:3px;">Due Date</label>
                <input type="date" class="form-control form-control-sm" id="admin-new-subtask-due" value="${task.dueDate || ''}">
              </div>
              <div class="col-md-2">
                <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block; margin-bottom:3px;">Priority</label>
                <select class="form-control form-control-sm" id="admin-new-subtask-priority">
                  <option value="Low">Low</option>
                  <option value="Medium" selected>Medium</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
              <div class="col-md-2">
                <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block; margin-bottom:3px;">Status</label>
                <select class="form-control form-control-sm" id="admin-new-subtask-status">
                  <option value="To Do" selected>To Do</option>
                  <option value="In Progress">In Progress</option>
                  <option value="In Review">In Review</option>
                  <option value="Completed">Completed</option>
                  <option value="Blocked">Blocked</option>
                </select>
              </div>
              <div class="col-md-2">
                <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block; margin-bottom:3px;">Progress %</label>
                <input type="number" class="form-control form-control-sm" id="admin-new-subtask-progress" min="0" max="100" value="0">
              </div>
            </div>
            <div class="d-flex justify-content-end gap-2">
              <button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-add-subtask">Cancel</button>
              <button type="submit" class="btn btn-primary btn-sm" style="font-weight:600;">Save Subtask</button>
            </div>
          </form>
        </div>

        <!-- Subtasks Expandable List -->
        <div class="subtasks-wrapper" id="admin-subtasks-list">
          ${subtasks.length === 0 ? `
            <div class="p-3 text-center" style="background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:8px;">
              <p style="font-size:0.82rem; color:#64748B; margin:0 0 8px;">No subtasks added yet. Break down this task into actionable milestones.</p>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-add-first-subtask" style="font-size:0.76rem;">Add First Subtask</button>
            </div>
          ` : subtasks.map(s => {
            const isComp = s.completed || s.status === 'Completed';
            const prog = s.progress !== undefined ? s.progress : (isComp ? 100 : 0);
            const statusClass = isComp ? 'is-completed' : (s.status === 'In Progress' ? 'is-in-progress' : (s.status === 'In Review' ? 'is-in-review' : (s.status === 'Blocked' ? 'is-blocked' : '')));
            const sComments = Array.isArray(s.comments) ? s.comments : [];
            const sAttachments = Array.isArray(s.attachments) ? s.attachments : [];
            const sReviews = Array.isArray(s.reviewHistory) ? s.reviewHistory : [];
            const sActivity = Array.isArray(s.activity) ? s.activity : [];

            return `
              <div class="subtask-item-card ${statusClass}" data-subtask-id="${s.id}">
                <div class="subtask-item-header" data-subtask-header="${s.id}">
                  <div class="subtask-header-left">
                    <input type="checkbox" class="subtask-checkbox admin-subtask-toggle" data-subtask-id="${s.id}" ${isComp ? 'checked' : ''} title="Toggle completion">
                    <div class="subtask-title-wrap">
                      <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span class="subtask-title-text">${escapeHtml(s.title)}</span>
                        <span class="badge ${getStatusBadgeClass(s.status || 'To Do')}" style="font-size:0.65rem;">${s.status || 'To Do'}</span>
                        <span class="badge ${getPriorityBadgeClass(s.priority || 'Medium')}" style="font-size:0.65rem;">${s.priority || 'Medium'}</span>
                      </div>
                      <div class="d-flex align-items-center gap-3 mt-1" style="font-size:0.72rem; color:#64748B;">
                        <span>👤 ${escapeHtml(s.assignedStaffName || staffName || 'Unassigned')}</span>
                        ${s.dueDate ? `<span>📅 Due: ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(s.dueDate) : s.dueDate}</span>` : ''}
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
                    <button type="button" class="btn btn-ghost btn-sm text-primary btn-edit-subtask" data-subtask-id="${s.id}" title="Edit Subtask" style="padding:2px 6px; font-size:0.72rem;">
                      ✏️ Edit
                    </button>
                    <button type="button" class="btn btn-ghost btn-sm text-danger btn-delete-subtask" data-subtask-id="${s.id}" title="Delete Subtask" style="padding:2px 6px; font-size:0.75rem;">
                      🗑️
                    </button>
                    <button type="button" class="btn btn-ghost btn-sm btn-toggle-subtask-details" data-subtask-id="${s.id}" style="padding:2px 6px; font-size:0.72rem; color:var(--royal-blue); font-weight:600;">
                      Details ▾
                    </button>
                  </div>
                </div>

                <!-- Expandable Details Pane -->
                <div class="subtask-details-pane" id="subtask-pane-${s.id}">
                  <!-- Meta Details Grid -->
                  <div class="subtask-meta-grid">
                    <div class="subtask-meta-item">
                      <strong>Assigned Staff</strong>
                      <span>${escapeHtml(s.assignedStaffName || staffName || 'Unassigned')}</span>
                    </div>
                    <div class="subtask-meta-item">
                      <strong>Timeline</strong>
                      <span>${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(s.startDate) : (s.startDate || '—')} &rarr; ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(s.dueDate) : (s.dueDate || '—')}</span>
                    </div>
                    <div class="subtask-meta-item">
                      <strong>Priority</strong>
                      <span class="badge ${getPriorityBadgeClass(s.priority)}">${s.priority || 'Medium'}</span>
                    </div>
                    <div class="subtask-meta-item">
                      <strong>Status Update</strong>
                      <select class="form-control form-control-sm subtask-status-select" data-subtask-id="${s.id}" style="font-size:0.72rem; padding:2px 4px; height:26px;">
                        <option value="To Do" ${s.status === 'To Do' ? 'selected' : ''}>To Do</option>
                        <option value="In Progress" ${s.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                        <option value="In Review" ${s.status === 'In Review' ? 'selected' : ''}>In Review</option>
                        <option value="Completed" ${s.status === 'Completed' ? 'selected' : ''}>Completed</option>
                        <option value="Blocked" ${s.status === 'Blocked' ? 'selected' : ''}>Blocked</option>
                      </select>
                    </div>
                    <div class="subtask-meta-item" style="grid-column: span 2;">
                      <div class="d-flex justify-content-between align-items-center mb-1">
                        <strong>Progress: <span id="sub-prog-val-${s.id}">${prog}%</span></strong>
                        <button type="button" class="btn btn-secondary btn-sm btn-save-subtask-prog" data-subtask-id="${s.id}" style="font-size:0.65rem; padding:1px 6px;">Save %</button>
                      </div>
                      <input type="range" class="form-range subtask-prog-slider" data-subtask-id="${s.id}" min="0" max="100" value="${prog}" style="width:100%;">
                    </div>
                  </div>

                  ${s.description ? `
                    <div class="mb-3 p-2 rounded" style="background:#FFFFFF; border:1px solid #E2E8F0; font-size:0.78rem; color:#334155;">
                      <strong style="font-size:0.72rem; color:var(--navy-dark); text-transform:uppercase;">Description & Deliverables:</strong>
                      <p style="margin:4px 0 0; line-height:1.4;">${escapeHtml(s.description)}</p>
                    </div>
                  ` : ''}

                  <!-- Inline Edit Form (Hidden by default) -->
                  <div id="subtask-edit-form-${s.id}" class="card p-3 mb-3" style="display:none; background:#F8FAFC; border:1px solid #CBD5E1;">
                    <h6 style="font-size:0.82rem; font-weight:700; color:var(--navy-dark); margin-bottom:8px;">Edit Subtask Details</h6>
                    <form class="form-edit-subtask" data-subtask-id="${s.id}">
                      <div class="mb-2">
                        <label style="font-size:0.70rem; font-weight:700; color:#475569;">Title *</label>
                        <input type="text" class="form-control form-control-sm edit-sub-title" value="${escapeHtml(s.title)}" required>
                      </div>
                      <div class="mb-2">
                        <label style="font-size:0.70rem; font-weight:700; color:#475569;">Description</label>
                        <textarea class="form-control form-control-sm edit-sub-desc" rows="2">${escapeHtml(s.description || '')}</textarea>
                      </div>
                      <div class="row g-2 mb-2">
                        <div class="col-md-6">
                          <label style="font-size:0.70rem; font-weight:700; color:#475569;">Assign Staff</label>
                          <select class="form-control form-control-sm edit-sub-staff">
                            <option value="">Unassigned</option>
                            <option value="all" ${s.assignedStaffId === 'all' ? 'selected' : ''}>All Staff</option>
                            ${staffList.map(st => `<option value="${st.id}" ${s.assignedStaffId === st.id ? 'selected' : ''}>${escapeHtml(st.name)}</option>`).join('')}
                          </select>
                        </div>
                        <div class="col-md-6">
                          <label style="font-size:0.70rem; font-weight:700; color:#475569;">Priority</label>
                          <select class="form-control form-control-sm edit-sub-priority">
                            <option value="Low" ${s.priority === 'Low' ? 'selected' : ''}>Low</option>
                            <option value="Medium" ${s.priority === 'Medium' ? 'selected' : ''}>Medium</option>
                            <option value="High" ${s.priority === 'High' ? 'selected' : ''}>High</option>
                            <option value="Urgent" ${s.priority === 'Urgent' ? 'selected' : ''}>Urgent</option>
                          </select>
                        </div>
                      </div>
                      <div class="row g-2 mb-3">
                        <div class="col-md-4">
                          <label style="font-size:0.70rem; font-weight:700; color:#475569;">Start Date</label>
                          <input type="date" class="form-control form-control-sm edit-sub-start" value="${s.startDate || ''}">
                        </div>
                        <div class="col-md-4">
                          <label style="font-size:0.70rem; font-weight:700; color:#475569;">Due Date</label>
                          <input type="date" class="form-control form-control-sm edit-sub-due" value="${s.dueDate || ''}">
                        </div>
                        <div class="col-md-4">
                          <label style="font-size:0.70rem; font-weight:700; color:#475569;">Status</label>
                          <select class="form-control form-control-sm edit-sub-status">
                            <option value="To Do" ${s.status === 'To Do' ? 'selected' : ''}>To Do</option>
                            <option value="In Progress" ${s.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                            <option value="In Review" ${s.status === 'In Review' ? 'selected' : ''}>In Review</option>
                            <option value="Completed" ${s.status === 'Completed' ? 'selected' : ''}>Completed</option>
                            <option value="Blocked" ${s.status === 'Blocked' ? 'selected' : ''}>Blocked</option>
                          </select>
                        </div>
                      </div>
                      <div class="d-flex justify-content-end gap-2">
                        <button type="button" class="btn btn-ghost btn-sm btn-cancel-edit-sub" data-subtask-id="${s.id}">Cancel</button>
                        <button type="submit" class="btn btn-primary btn-sm">Save Changes</button>
                      </div>
                    </form>
                  </div>

                  <!-- Sub-tabs Bar -->
                  <div class="subtask-tabs-bar">
                    <button type="button" class="subtask-tab-btn active" data-subtask-tab="comments" data-subtask-id="${s.id}">
                      💬 Comments (${sComments.length})
                    </button>
                    <button type="button" class="subtask-tab-btn" data-subtask-tab="attachments" data-subtask-id="${s.id}">
                      📎 Attachments (${sAttachments.length})
                    </button>
                    <button type="button" class="subtask-tab-btn" data-subtask-tab="reviews" data-subtask-id="${s.id}">
                      📜 Reviews (${sReviews.length})
                    </button>
                    <button type="button" class="subtask-tab-btn" data-subtask-tab="activity" data-subtask-id="${s.id}">
                      ⏱️ Activity (${sActivity.length})
                    </button>
                  </div>

                  <!-- Tab 1: Comments -->
                  <div class="subtask-tab-panel active" id="subtask-tab-comments-${s.id}">
                    <div class="mb-2" style="max-height:160px; overflow-y:auto;">
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
                    <form class="subtask-add-comment-form d-flex gap-2" data-subtask-id="${s.id}">
                      <input type="text" class="form-control form-control-sm subtask-comment-input" placeholder="Write a comment on this subtask..." required style="font-size:0.76rem;">
                      <button type="submit" class="btn btn-secondary btn-sm" style="font-size:0.72rem; padding:4px 10px;">Post</button>
                    </form>
                  </div>

                  <!-- Tab 2: Attachments -->
                  <div class="subtask-tab-panel" id="subtask-tab-attachments-${s.id}">
                    <div class="mb-2" style="max-height:160px; overflow-y:auto;">
                      ${sAttachments.length === 0 ? `
                        <div style="font-size:0.74rem; color:#94A3B8; text-align:center; padding:8px;">No attachments uploaded for this subtask.</div>
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
                      <input type="file" class="form-control form-control-sm subtask-file-input" data-subtask-id="${s.id}" style="font-size:0.74rem;">
                      <button type="button" class="btn btn-secondary btn-sm btn-upload-subtask-att" data-subtask-id="${s.id}" style="font-size:0.72rem; padding:4px 10px;">Upload</button>
                    </div>
                  </div>

                  <!-- Tab 3: Reviews -->
                  <div class="subtask-tab-panel" id="subtask-tab-reviews-${s.id}">
                    <div class="mb-2" style="max-height:160px; overflow-y:auto;">
                      ${sReviews.length === 0 ? `
                        <div style="font-size:0.74rem; color:#94A3B8; text-align:center; padding:8px;">No review entries logged yet.</div>
                      ` : sReviews.map(r => `
                        <div class="p-2 mb-1 rounded" style="background:#FFFFFF; border:1px solid #E2E8F0; font-size:0.75rem;">
                          <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="badge ${r.decision === 'Approved' ? 'bg-success' : 'bg-warning'}" style="font-size:0.65rem;">${r.decision}</span>
                            <span style="font-size:0.68rem; color:#94A3B8;">${new Date(r.timestamp || r.createdAt || Date.now()).toLocaleTimeString()} by ${escapeHtml(r.reviewer || 'Admin')}</span>
                          </div>
                          ${r.notes ? `<div style="font-size:0.76rem; color:#334155;">${escapeHtml(r.notes)}</div>` : ''}
                        </div>
                      `).join('')}
                    </div>
                    <form class="subtask-add-review-form" data-subtask-id="${s.id}">
                      <div class="row g-2 mb-2">
                        <div class="col-md-5">
                          <select class="form-control form-control-sm subtask-review-decision" style="font-size:0.74rem;">
                            <option value="Approved">Approved</option>
                            <option value="Changes Requested">Changes Requested</option>
                            <option value="Needs Inspection">Needs Inspection</option>
                          </select>
                        </div>
                        <div class="col-md-7">
                          <input type="text" class="form-control form-control-sm subtask-review-notes" placeholder="Feedback or directives..." style="font-size:0.74rem;">
                        </div>
                      </div>
                      <div class="text-end">
                        <button type="submit" class="btn btn-primary btn-sm" style="font-size:0.72rem; padding:3px 10px;">Log Review</button>
                      </div>
                    </form>
                  </div>

                  <!-- Tab 4: Activity Log -->
                  <div class="subtask-tab-panel" id="subtask-tab-activity-${s.id}">
                    <div style="max-height:160px; overflow-y:auto;">
                      ${sActivity.length === 0 ? `
                        <div style="font-size:0.74rem; color:#94A3B8; text-align:center; padding:8px;">No activity logged yet.</div>
                      ` : sActivity.map(act => `
                        <div class="d-flex align-items-start gap-2 mb-1" style="font-size:0.74rem;">
                          <span style="color:var(--royal-blue); font-weight:700;">&bull;</span>
                          <div style="flex:1;">
                            <span style="font-weight:600; color:var(--navy-dark);">${escapeHtml(act.details || act.action)}</span>
                            <span style="color:#64748B; font-size:0.68rem;">by ${escapeHtml(act.authorName || 'System')}</span>
                          </div>
                          <span style="color:#94A3B8; font-size:0.68rem;">${new Date(act.createdAt || Date.now()).toLocaleTimeString()}</span>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Comments & Discussion HTML
    const commentsHtml = `
      <div class="comments-container mb-4">
        <h4 style="font-weight:700; font-size:0.9rem; color:var(--navy-dark); margin-bottom:10px;">
          Task Discussion & Comments (${comments.length})
        </h4>

        <div class="discussion-thread mb-3" style="max-height:220px; overflow-y:auto; background:#F8FAFC; padding:12px; border-radius:8px; border:1px solid #E2E8F0;">
          ${comments.length === 0 ? `
            <div style="font-size:0.78rem; color:#94A3B8; text-align:center; padding:10px;">
              No discussion comments yet. Start the conversation below.
            </div>
          ` : comments.map(c => `
            <div class="comment-bubble p-2 mb-2" style="background:#FFFFFF; border:1px solid #CBD5E1; border-radius:6px;">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span style="font-weight:700; font-size:0.8rem; color:var(--navy-dark);">
                  ${escapeHtml(c.authorName || 'Staff Member')}
                  <span class="badge" style="background:#E0E7FF; color:#3730A3; font-size:0.65rem; margin-left:4px;">${c.authorRole || 'User'}</span>
                </span>
                <span style="font-size:0.68rem; color:#64748B;">${new Date(c.createdAt || Date.now()).toLocaleString()}</span>
              </div>
              <p style="font-size:0.82rem; color:#1E293B; margin:0; line-height:1.4;">${escapeHtml(c.text)}</p>
            </div>
          `).join('')}
        </div>

        <form id="admin-add-comment-form">
          <div class="d-flex gap-2">
            <textarea class="form-control form-control-sm" id="admin-new-comment-text" rows="2" placeholder="Write a comment, directive, or update for this task..." required style="font-size:0.8rem;"></textarea>
            <button type="submit" class="btn btn-primary btn-sm" style="font-weight:600; font-size:0.78rem; align-self:flex-end; padding:6px 14px;">
              Post
            </button>
          </div>
        </form>
      </div>
    `;

    // Activity Stream HTML
    const activityHtml = `
      <div class="activity-container mb-4">
        <h4 style="font-weight:700; font-size:0.9rem; color:var(--navy-dark); margin-bottom:10px;">
          Task Activity History Log (${activity.length})
        </h4>
        <div class="activity-stream" style="max-height:180px; overflow-y:auto; background:#F8FAFC; padding:10px 14px; border-radius:8px; border:1px solid #E2E8F0;">
          ${activity.length === 0 ? `
            <div style="font-size:0.78rem; color:#94A3B8; text-align:center;">No activity logged yet.</div>
          ` : activity.slice().reverse().map(act => `
            <div class="activity-item d-flex align-items-start gap-2 mb-2 pb-2 border-bottom" style="font-size:0.76rem;">
              <span style="color:var(--royal-blue); font-weight:700;">&bull;</span>
              <div style="flex:1;">
                <span style="font-weight:600; color:var(--navy-dark);">${escapeHtml(act.text || act.action || act.details)}</span>
                <span style="color:#64748B; font-size:0.7rem; margin-left:4px;">by ${escapeHtml(act.author || act.authorName || 'Admin')}</span>
              </div>
              <span style="color:#94A3B8; font-size:0.68rem;">${new Date(act.timestamp || act.createdAt || Date.now()).toLocaleTimeString()}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Deliverables & Submissions HTML
    let submissionsHtml = '';
    if (submissions.length === 0) {
      submissionsHtml = `
        <div style="padding: 12px; background: #F8FAFC; border-radius: 6px; border: 1px dashed #CBD5E1; text-align: center; color: #64748B; font-size: 0.8rem;">
          No staff deliverables or review submissions uploaded yet.
        </div>
      `;
    } else {
      submissionsHtml = submissions.map(sub => {
        let attachmentsHtml = '';
        if (Array.isArray(sub.attachments) && sub.attachments.length > 0) {
          attachmentsHtml = `
            <div style="margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap;">
              ${sub.attachments.map(att => `
                <a href="${att.url}" download="${att.name}" target="_blank" style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 6px; color: var(--royal-blue); font-size: 0.76rem; text-decoration: none; font-weight: 600;">
                  📎 ${escapeHtml(att.name)} <span style="font-size:0.68rem; color:#64748B;">(${att.size || 'File'})</span>
                </a>
              `).join('')}
            </div>
          `;
        }
        return `
          <div style="padding: 12px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong style="color:var(--navy-dark); font-size:0.82rem;">${escapeHtml(sub.staffName || 'Staff Member')}</strong>
              <span style="font-size:0.7rem; color:#64748B;">${new Date(sub.submittedAt).toLocaleString()}</span>
            </div>
            <p style="font-size:0.8rem; color:#334155; margin:4px 0 0;">${escapeHtml(sub.comment || 'Submitted deliverables for review.')}</p>
            ${attachmentsHtml}
          </div>
        `;
      }).join('');
    }

    adminTaskModalContent.innerHTML = `
      <!-- Header Meta Banner -->
      <div style="border-bottom: 1px solid #E2E8F0; padding-bottom: 14px; margin-bottom: 16px;">
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div>
            <div style="font-size:0.72rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">
              Task ${task.id} &bull; Project: <strong style="color:var(--royal-blue);">${escapeHtml(projName)}</strong>
            </div>
            <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--navy-dark); margin: 2px 0 0;">${escapeHtml(task.title)}</h3>
          </div>
          <div class="d-flex align-items-center gap-1">
            <span class="badge ${getStatusBadgeClass(task.status)}" style="font-size: 0.76rem;">${task.status}</span>
            <span class="badge ${getPriorityBadgeClass(task.priority)}" style="font-size: 0.76rem;">${task.priority} Priority</span>
          </div>
        </div>

        <p style="font-size: 0.84rem; color: #475569; line-height: 1.5; margin-bottom: 10px;">${escapeHtml(task.description || 'No detailed instructions.')}</p>

        <div class="d-flex gap-3 flex-wrap mb-2" style="font-size: 0.78rem; color: #64748B;">
          <span>👤 Assigned Staff: <strong style="color: var(--navy-dark);">${escapeHtml(staffName)}</strong></span>
          <span>📅 Start: <strong>${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(task.startDate || task.assignedDate) : (task.startDate || task.assignedDate || 'Today')}</strong></span>
          <span>⏰ Due: <strong>${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(task.dueDate) : (task.dueDate || 'Ongoing')}</strong></span>
        </div>

        <!-- Task Progress Calculation Indicator -->
        <div class="p-2 rounded mt-2" style="background:#F8FAFC; border:1px solid #E2E8F0;">
          <div class="d-flex justify-content-between align-items-center mb-1" style="font-size:0.74rem;">
            <strong style="color:var(--navy-dark);">Task Completion Progress</strong>
            <strong style="color:var(--royal-blue);">${task.progress || 0}%</strong>
          </div>
          <div style="height:6px; background:#E2E8F0; border-radius:4px; overflow:hidden;">
            <div style="height:100%; width:${task.progress || 0}%; background:var(--royal-blue); border-radius:4px; transition:width 0.3s ease;"></div>
          </div>
        </div>

        ${task.file ? `
          <div style="margin-top: 10px; padding: 6px 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; display: inline-flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.74rem; font-weight: 600; color: #475569;">Briefing Document:</span>
            <a href="${task.file.url || task.file.dataBase64}" download="${task.file.name}" style="color: var(--royal-blue); font-weight: 600; font-size: 0.78rem; text-decoration: none;">
              📎 ${escapeHtml(task.file.name)} (${task.file.size})
            </a>
          </div>
        ` : ''}
      </div>

      <!-- Action Buttons Bar -->
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 p-3 mb-4 rounded" style="background:#F1F5F9; border:1px solid #E2E8F0;">
        <div class="d-flex align-items-center gap-2">
          ${task.status === 'In Review' ? `
            <button class="btn btn-primary btn-sm btn-action-approve" style="background:#059669; border-color:#059669; font-weight:700;">
              ✓ Approve Deliverables
            </button>
            <button class="btn btn-secondary btn-sm btn-action-request-changes" style="color:#D97706; border-color:#F59E0B; font-weight:700;">
              ↺ Request Changes
            </button>
          ` : ''}
          ${task.status !== 'Completed' ? `
            <button class="btn btn-secondary btn-sm btn-action-complete" style="color:#059669; border-color:#10B981; font-weight:600;">
              ✓ Mark Complete
            </button>
          ` : ''}
        </div>
        <div class="d-flex align-items-center gap-2">
          <button class="btn btn-secondary btn-sm btn-action-edit-task" style="font-size:0.75rem;">
            Edit Task
          </button>
          <button class="btn btn-ghost btn-sm text-danger btn-action-delete-task" style="font-size:0.75rem;">
            Delete Task
          </button>
        </div>
      </div>

      <!-- Unlimited Subtasks Section -->
      ${subtasksHtml}

      <!-- Discussion / Comments -->
      ${commentsHtml}

      <!-- Activity Timeline -->
      ${activityHtml}

      <!-- Deliverables Section -->
      <div class="mb-3">
        <h4 style="font-weight:700; font-size:0.9rem; color:var(--navy-dark); margin-bottom:8px;">
          Staff Deliverables & Submissions (${submissions.length})
        </h4>
        ${submissionsHtml}
      </div>
    `;

    // ==========================================================================
    // Wire Subtasks Enterprise Event Handlers
    // ==========================================================================

    // 1. Toggle Add Subtask Form Card
    const btnToggleAddSub = adminTaskModalContent.querySelector('#btn-toggle-add-subtask-form');
    const btnAddFirstSub = adminTaskModalContent.querySelector('#btn-add-first-subtask');
    const addSubCard = adminTaskModalContent.querySelector('#admin-add-subtask-card');
    const btnCancelAddSub = adminTaskModalContent.querySelector('#btn-cancel-add-subtask');

    function toggleSubtaskForm(show) {
      if (!addSubCard) return;
      const isVisible = show !== undefined ? show : addSubCard.style.display !== 'none';
      addSubCard.style.display = isVisible ? 'block' : 'none';
      if (isVisible) {
        const titleInput = document.getElementById('admin-new-subtask-title');
        if (titleInput) titleInput.focus();
      }
    }

    if (btnToggleAddSub) btnToggleAddSub.addEventListener('click', () => toggleSubtaskForm(addSubCard.style.display === 'none'));
    if (btnAddFirstSub) btnAddFirstSub.addEventListener('click', () => toggleSubtaskForm(true));
    if (btnCancelAddSub) btnCancelAddSub.addEventListener('click', () => toggleSubtaskForm(false));

    if (options.autoOpenAddSubtask) {
      toggleSubtaskForm(true);
    }

    // 2. Add New Subtask Form Submission
    const addSubForm = adminTaskModalContent.querySelector('#admin-add-subtask-form');
    if (addSubForm) {
      addSubForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = (document.getElementById('admin-new-subtask-title')?.value || '').trim();
        const description = (document.getElementById('admin-new-subtask-desc')?.value || '').trim();
        const assignedStaffId = document.getElementById('admin-new-subtask-staff')?.value || null;
        const priority = document.getElementById('admin-new-subtask-priority')?.value || 'Medium';
        const status = document.getElementById('admin-new-subtask-status')?.value || 'To Do';
        const startDate = document.getElementById('admin-new-subtask-start')?.value || todayStr;
        const dueDate = document.getElementById('admin-new-subtask-due')?.value || '';
        const progress = Number(document.getElementById('admin-new-subtask-progress')?.value) || 0;

        if (!title) return;

        const subtaskPayload = {
          title,
          description,
          assignedStaffId,
          priority,
          status,
          startDate,
          dueDate,
          progress
        };

        let serverTask = null;
        try {
          const resp = await fetch(`/api/tasks/${taskId}/subtasks`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(subtaskPayload)
          });
          const json = await resp.json().catch(() => null);
          if (json && json.success && json.task) {
            serverTask = json.task;
            WorkPulseDB.upsertTask(serverTask);
          } else {
            WorkPulseDB.addSubtask(taskId, subtaskPayload, 'admin');
          }
        } catch (netErr) {
          WorkPulseDB.addSubtask(taskId, subtaskPayload, 'admin');
        }

        showToast('Subtask added successfully!', 'success');
        openAdminTaskModal(taskId);
        renderAdminTasks();
        renderAdminKanban();
        renderAdminProjects();
        if (adminWorkActiveSubtab === 'gantt') renderAdminGantt();
      });
    }

    // 3. Subtask Checkbox Completion Toggle
    adminTaskModalContent.querySelectorAll('.admin-subtask-toggle').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        e.stopPropagation();
        const subtaskId = chk.dataset.subtaskId;
        const completed = chk.checked;
        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ completed })
          });
        } catch (netErr) {}

        WorkPulseDB.toggleSubtask(taskId, subtaskId, completed, 'admin');
        openAdminTaskModal(taskId);
        renderAdminTasks();
        renderAdminKanban();
        renderAdminProjects();
        if (adminWorkActiveSubtab === 'gantt') renderAdminGantt();
      });
    });

    // 4. Subtask Details Pane Expand / Collapse
    adminTaskModalContent.querySelectorAll('.subtask-item-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('input') || e.target.closest('button') || e.target.closest('select') || e.target.closest('a')) return;
        const subtaskId = header.dataset.subtaskHeader;
        const pane = document.getElementById(`subtask-pane-${subtaskId}`);
        if (pane) {
          pane.classList.toggle('open');
        }
      });
    });

    adminTaskModalContent.querySelectorAll('.btn-toggle-subtask-details').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subtaskId = btn.dataset.subtaskId;
        const pane = document.getElementById(`subtask-pane-${subtaskId}`);
        if (pane) {
          pane.classList.toggle('open');
          btn.textContent = pane.classList.contains('open') ? 'Details ▴' : 'Details ▾';
        }
      });
    });

    if (options.openSubtaskId) {
      const targetPane = document.getElementById(`subtask-pane-${options.openSubtaskId}`);
      if (targetPane) targetPane.classList.add('open');
    }

    // 5. Subtask Quick Status Select Dropdown
    adminTaskModalContent.querySelectorAll('.subtask-status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const subtaskId = sel.dataset.subtaskId;
        const newStatus = sel.value;
        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: newStatus })
          });
        } catch (netErr) {}

        WorkPulseDB.updateSubtask(taskId, subtaskId, { status: newStatus }, 'admin');
        showToast('Subtask status updated', 'success');
        openAdminTaskModal(taskId, { openSubtaskId: subtaskId });
        renderAdminTasks();
        renderAdminKanban();
        renderAdminProjects();
        if (adminWorkActiveSubtab === 'gantt') renderAdminGantt();
      });
    });

    // 6. Subtask Progress Slider & Save
    adminTaskModalContent.querySelectorAll('.subtask-prog-slider').forEach(slider => {
      const subtaskId = slider.dataset.subtaskId;
      const displayVal = document.getElementById(`sub-prog-val-${subtaskId}`);
      slider.addEventListener('input', () => {
        if (displayVal) displayVal.textContent = `${slider.value}%`;
      });
    });

    adminTaskModalContent.querySelectorAll('.btn-save-subtask-prog').forEach(btn => {
      btn.addEventListener('click', async () => {
        const subtaskId = btn.dataset.subtaskId;
        const slider = adminTaskModalContent.querySelector(`.subtask-prog-slider[data-subtask-id="${subtaskId}"]`);
        const progressVal = Number(slider?.value) || 0;

        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ progress: progressVal })
          });
        } catch (netErr) {}

        WorkPulseDB.updateSubtask(taskId, subtaskId, { progress: progressVal }, 'admin');
        showToast(`Subtask progress saved: ${progressVal}%`, 'success');
        openAdminTaskModal(taskId, { openSubtaskId: subtaskId });
        renderAdminTasks();
        renderAdminKanban();
        renderAdminProjects();
        if (adminWorkActiveSubtab === 'gantt') renderAdminGantt();
      });
    });

    // 7. Subtask Edit Form Toggle & Submit
    adminTaskModalContent.querySelectorAll('.btn-edit-subtask').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subtaskId = btn.dataset.subtaskId;
        const pane = document.getElementById(`subtask-pane-${subtaskId}`);
        if (pane) pane.classList.add('open');
        const form = document.getElementById(`subtask-edit-form-${subtaskId}`);
        if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
      });
    });

    adminTaskModalContent.querySelectorAll('.btn-cancel-edit-sub').forEach(btn => {
      btn.addEventListener('click', () => {
        const subtaskId = btn.dataset.subtaskId;
        const form = document.getElementById(`subtask-edit-form-${subtaskId}`);
        if (form) form.style.display = 'none';
      });
    });

    adminTaskModalContent.querySelectorAll('.form-edit-subtask').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const subtaskId = form.dataset.subtaskId;
        const title = form.querySelector('.edit-sub-title')?.value.trim();
        const description = form.querySelector('.edit-sub-desc')?.value.trim();
        const assignedStaffId = form.querySelector('.edit-sub-staff')?.value || null;
        const priority = form.querySelector('.edit-sub-priority')?.value || 'Medium';
        const startDate = form.querySelector('.edit-sub-start')?.value || '';
        const dueDate = form.querySelector('.edit-sub-due')?.value || '';
        const status = form.querySelector('.edit-sub-status')?.value || 'To Do';

        const updateData = {
          title,
          description,
          assignedStaffId,
          priority,
          startDate,
          dueDate,
          status
        };

        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'PUT',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(updateData)
          });
        } catch (netErr) {}

        WorkPulseDB.updateSubtask(taskId, subtaskId, updateData, 'admin');
        showToast('Subtask details updated', 'success');
        openAdminTaskModal(taskId, { openSubtaskId: subtaskId });
        renderAdminTasks();
        renderAdminKanban();
        renderAdminProjects();
        if (adminWorkActiveSubtab === 'gantt') renderAdminGantt();
      });
    });

    // 8. Subtask Deletion
    adminTaskModalContent.querySelectorAll('.btn-delete-subtask').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const subtaskId = btn.dataset.subtaskId;
        if (!confirm('Are you sure you want to delete this subtask?')) return;

        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}`, {
            method: 'DELETE',
            headers: WorkPulseDB.getAuthHeaders()
          });
        } catch (netErr) {}

        WorkPulseDB.deleteSubtask(taskId, subtaskId, 'admin');
        showToast('Subtask deleted', 'info');
        openAdminTaskModal(taskId);
        renderAdminTasks();
        renderAdminKanban();
        renderAdminProjects();
        if (adminWorkActiveSubtab === 'gantt') renderAdminGantt();
      });
    });

    // 9. Subtask Sub-tabs Switcher
    adminTaskModalContent.querySelectorAll('.subtask-tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subtaskId = tabBtn.dataset.subtaskId;
        const tabName = tabBtn.dataset.subtaskTab;
        const pane = document.getElementById(`subtask-pane-${subtaskId}`);
        if (!pane) return;

        pane.querySelectorAll('.subtask-tab-btn').forEach(b => b.classList.remove('active'));
        pane.querySelectorAll('.subtask-tab-panel').forEach(p => p.classList.remove('active'));

        tabBtn.classList.add('active');
        const targetPanel = document.getElementById(`subtask-tab-${tabName}-${subtaskId}`);
        if (targetPanel) targetPanel.classList.add('active');
      });
    });

    // 10. Subtask Comment Form
    adminTaskModalContent.querySelectorAll('.subtask-add-comment-form').forEach(cForm => {
      cForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const subtaskId = cForm.dataset.subtaskId;
        const input = cForm.querySelector('.subtask-comment-input');
        const text = input ? input.value.trim() : '';
        if (!text) return;

        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}/comments`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ text, authorRole: 'Admin' })
          });
        } catch (netErr) {}

        WorkPulseDB.addSubtaskComment(taskId, subtaskId, { text, authorRole: 'Admin' }, 'admin');
        showToast('Subtask comment added', 'success');
        openAdminTaskModal(taskId, { openSubtaskId: subtaskId });
      });
    });

    // 11. Subtask Attachment Upload
    adminTaskModalContent.querySelectorAll('.btn-upload-subtask-att').forEach(btn => {
      btn.addEventListener('click', () => {
        const subtaskId = btn.dataset.subtaskId;
        const fileInput = adminTaskModalContent.querySelector(`.subtask-file-input[data-subtask-id="${subtaskId}"]`);
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
            dataBase64
          };

          try {
            await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}/attachments`, {
              method: 'POST',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(payload)
            });
          } catch (netErr) {}

          WorkPulseDB.addSubtaskAttachment(taskId, subtaskId, payload, 'admin');
          showToast('File attached to subtask', 'success');
          openAdminTaskModal(taskId, { openSubtaskId: subtaskId });
        };
        reader.readAsDataURL(file);
      });
    });

    // 12. Subtask Review Form
    adminTaskModalContent.querySelectorAll('.subtask-add-review-form').forEach(rForm => {
      rForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const subtaskId = rForm.dataset.subtaskId;
        const decision = rForm.querySelector('.subtask-review-decision')?.value || 'Approved';
        const notes = (rForm.querySelector('.subtask-review-notes')?.value || '').trim();

        try {
          await fetch(`/api/tasks/${taskId}/subtasks/${subtaskId}/review`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ decision, notes })
          });
        } catch (netErr) {}

        WorkPulseDB.addSubtaskReview(taskId, subtaskId, { decision, notes }, 'admin');
        showToast('Subtask review logged', 'success');
        openAdminTaskModal(taskId, { openSubtaskId: subtaskId });
      });
    });

    // ==========================================================================
    // Wire Parent Task Level Discussion & Controls
    // ==========================================================================

    // Wire Add Comment Form
    const commentForm = document.getElementById('admin-add-comment-form');
    if (commentForm) {
      commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textInput = document.getElementById('admin-new-comment-text');
        const text = textInput ? textInput.value.trim() : '';
        if (!text) return;

        try {
          await fetch(`/api/tasks/${taskId}/comments`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ text, authorRole: 'Admin' })
          });
        } catch (netErr) {}

        WorkPulseDB.addTaskComment(taskId, { text, authorRole: 'Admin' }, 'admin');
        showToast('Comment posted to discussion!', 'success');
        openAdminTaskModal(taskId);
      });
    }

    // Wire Action Buttons
    const btnApprove = adminTaskModalContent.querySelector('.btn-action-approve');
    if (btnApprove) {
      btnApprove.addEventListener('click', async () => {
        try {
          await fetch(`/api/tasks/${taskId}/review`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ action: 'approve', feedback: 'Approved deliverables and completed task.' })
          });
        } catch (netErr) {}

        WorkPulseDB.reviewTask(taskId, { action: 'approve' }, 'admin');
        showToast('Task deliverables approved and marked Completed!', 'success');
        openAdminTaskModal(taskId);
        renderAdminTasks();
        renderAdminKanban();
        renderAdminProjects();
      });
    }

    const btnReqChanges = adminTaskModalContent.querySelector('.btn-action-request-changes');
    if (btnReqChanges) {
      btnReqChanges.addEventListener('click', async () => {
        const feedback = prompt('Enter required changes / feedback for staff:', 'Please revise deliverables according to briefing instructions.');
        if (!feedback) return;

        try {
          await fetch(`/api/tasks/${taskId}/review`, {
            method: 'POST',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ action: 'request_changes', feedback })
          });
        } catch (netErr) {}

        WorkPulseDB.reviewTask(taskId, { action: 'request_changes', feedback }, 'admin');
        showToast('Changes requested. Task moved back to In Progress.', 'info');
        openAdminTaskModal(taskId);
        renderAdminTasks();
        renderAdminKanban();
      });
    }

    const btnComplete = adminTaskModalContent.querySelector('.btn-action-complete');
    if (btnComplete) {
      btnComplete.addEventListener('click', async () => {
        try {
          await fetch(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: 'Completed' })
          });
        } catch (netErr) {}

        WorkPulseDB.updateTaskStatus(taskId, 'Completed', 'admin');
        showToast('Task marked as Completed!', 'success');
        openAdminTaskModal(taskId);
        renderAdminTasks();
        renderAdminKanban();
        renderAdminProjects();
      });
    }

    const btnEdit = adminTaskModalContent.querySelector('.btn-action-edit-task');
    if (btnEdit) {
      btnEdit.addEventListener('click', () => {
        closeAdminTaskModal();
        openAssignTaskModal(taskId);
      });
    }

    const btnDel = adminTaskModalContent.querySelector('.btn-action-delete-task');
    if (btnDel) {
      btnDel.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to delete task ${taskId}?`)) {
          try {
            await fetch(`/api/tasks/${taskId}`, { method: 'DELETE', headers: WorkPulseDB.getAuthHeaders() });
          } catch (netErr) {}
          WorkPulseDB.deleteTask(taskId);
          showToast('Task deleted.', 'info');
          closeAdminTaskModal();
          renderAdminTasks();
          renderAdminKanban();
          renderAdminProjects();
        }
      });
    }

    adminTaskModal.classList.add('open');
  }

  function closeAdminTaskModal() {
    if (adminTaskModal) {
      adminTaskModal.classList.remove('open');
    }
  }

  if (btnCloseAdminTaskModal) btnCloseAdminTaskModal.addEventListener('click', closeAdminTaskModal);

  // --- DAILY WORKS MODULE (ADMIN) ---
  let isFetchingAdminReports = false;

  async function fetchAndSyncAdminReports() {
    if (isFetchingAdminReports) return;
    isFetchingAdminReports = true;
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
        // Merge with existing
        resJson.data.forEach(r => {
          const idx = db.dailyReports.findIndex(x => x.id === r.id);
          if (idx >= 0) db.dailyReports[idx] = r;
          else db.dailyReports.push(r);
        });
        WorkPulseDB.save(db);
      }
    } catch (err) {
      console.warn('Failed to fetch reports from backend:', err);
    } finally {
      isFetchingAdminReports = false;
      renderAdminReportsUI();
    }
  }

  function renderAdminReports() {
    // Render immediate local cache
    renderAdminReportsUI();
    // Fetch latest from backend
    fetchAndSyncAdminReports();
  }

  function renderAdminReportsUI() {
    const tbody = document.getElementById('admin-reports-tbody');
    if (!tbody) return;

    const allReports = WorkPulseDB.getDailyReports();
    
    // Calculate and update KPI summary metrics
    const totalCount = allReports.length;
    const pendingCount = allReports.filter(r => !r.review).length;
    const approvedCount = allReports.filter(r => (r.review?.decision === 'Approved' || r.reviewStatus === 'Approved')).length;
    const revisionCount = allReports.filter(r => (r.review?.decision === 'Needs Revision' || r.review?.decision === 'Rejected' || r.reviewStatus === 'Needs Revision' || r.reviewStatus === 'Rejected')).length;

    const elTotal = document.getElementById('stat-admin-reports-total');
    const elPending = document.getElementById('stat-admin-reports-pending');
    const elApproved = document.getElementById('stat-admin-reports-approved');
    const elRevision = document.getElementById('stat-admin-reports-revision');

    if (elTotal) elTotal.textContent = totalCount;
    if (elPending) elPending.textContent = pendingCount;
    if (elApproved) elApproved.textContent = approvedCount;
    if (elRevision) elRevision.textContent = revisionCount;

    if (badgeAdminReports) badgeAdminReports.textContent = totalCount;
    if (badgeAdminReportsPending) {
      if (pendingCount > 0) {
        badgeAdminReportsPending.style.display = 'inline-block';
        badgeAdminReportsPending.textContent = `${pendingCount} pending`;
      } else {
        badgeAdminReportsPending.style.display = 'none';
      }
    }
    if (badgeAdminReviewsPending) {
      if (pendingCount > 0) {
        badgeAdminReviewsPending.style.display = 'inline-block';
        badgeAdminReviewsPending.textContent = pendingCount;
      } else {
        badgeAdminReviewsPending.style.display = 'none';
      }
    }

    // Apply Filter Criteria
    let reports = [...allReports];
    if (activeReportsStaffFilter && activeReportsStaffFilter !== 'all') {
      reports = reports.filter(r => r.staffId === activeReportsStaffFilter);
    }
    if (activeReportsStatusFilter && activeReportsStatusFilter !== 'all') {
      if (activeReportsStatusFilter === 'pending') {
        reports = reports.filter(r => !r.review);
      } else if (activeReportsStatusFilter === 'Approved') {
        reports = reports.filter(r => r.review?.decision === 'Approved' || r.reviewStatus === 'Approved');
      } else if (activeReportsStatusFilter === 'Needs Revision') {
        reports = reports.filter(r => r.review?.decision === 'Needs Revision' || r.reviewStatus === 'Needs Revision');
      } else if (activeReportsStatusFilter === 'Rejected') {
        reports = reports.filter(r => r.review?.decision === 'Rejected' || r.reviewStatus === 'Rejected');
      }
    }
    if (activeReportsDateFilter) {
      reports = reports.filter(r => r.date === activeReportsDateFilter);
    }
    if (activeReportsSearchFilter) {
      const q = activeReportsSearchFilter.toLowerCase();
      reports = reports.filter(r => {
        const staff = WorkPulseDB.getStaffById(r.staffId);
        const sName = staff ? staff.name.toLowerCase() : '';
        const pTitle = (r.projectTitle || '').toLowerCase();
        const tTitle = (r.taskTitle || '').toLowerCase();
        const desc = (r.description || '').toLowerCase();
        return sName.includes(q) || pTitle.includes(q) || tTitle.includes(q) || desc.includes(q);
      });
    }

    if (reports.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="padding: 48px 16px; text-align: center; background: #F8FAFC;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: #EFF6FF; color: var(--royal-blue); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 10px;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            </div>
            <div style="font-weight: 700; color: var(--navy-dark); font-size: 0.95rem; margin-bottom: 4px;">No Staff Reports Found</div>
            <div style="font-size: 0.78rem; color: #64748B; max-width: 420px; margin: 0 auto;">Staff daily work reports, deliverables, and submissions will appear here for executive evaluation and reviews.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = reports.map(r => {
      const staffMember = WorkPulseDB.getStaffById(r.staffId);
      const staffName = staffMember ? staffMember.name : (r.staffName || r.staffId);
      const staffPos = staffMember ? (staffMember.position || staffMember.id) : r.staffId;
      const avatarHtml = renderStaffAvatar(staffMember, 30);

      let fileCell = '<span style="color:#94A3B8; font-size:0.75rem;">None</span>';
      if (r.file) {
        const fileUrl = r.file.url || r.file.dataBase64 || '#';
        fileCell = `
          <a href="${fileUrl}" download="${r.file.name}" class="btn btn-secondary btn-sm" style="font-size:0.72rem; padding:3px 8px; color:var(--royal-blue); border-color:rgba(29,95,143,0.3); display:inline-flex; align-items:center; gap:4px;" title="Download deliverable: ${r.file.name} (${r.file.size || 'File'})">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>${r.file.name.length > 11 ? r.file.name.substring(0, 9) + '...' : r.file.name}</span>
          </a>
        `;
      }

      let statusBadge = '<span class="badge badge-wfh" style="font-size:0.7rem;">In Progress</span>';
      if (r.workStatus === 'Completed') statusBadge = '<span class="badge badge-present" style="font-size:0.7rem;">Completed</span>';
      else if (r.workStatus === 'Blocked') statusBadge = '<span class="badge badge-leave" style="font-size:0.7rem;">Blocked</span>';
      else if (r.workStatus === 'On Track') statusBadge = '<span class="badge" style="background:#EFF6FF; color:#1D4ED8; font-size:0.7rem;">On Track</span>';

      let taskSnippet = '';
      if (r.taskTitle || r.taskId) {
        taskSnippet = `<span class="badge" style="background:#EEF2FF; color:#4338CA; font-size:0.68rem; font-weight:600; margin-top:2px; display:inline-block;" title="Linked Task: ${r.taskTitle || r.taskId}">📋 ${r.taskTitle ? (r.taskTitle.length > 20 ? r.taskTitle.substring(0, 18) + '...' : r.taskTitle) : r.taskId}</span>`;
      } else {
        taskSnippet = `<span style="font-size:0.68rem; color:#94A3B8;">General Project Work</span>`;
      }

      let reviewCell = '';
      let reviewAction = '';
      if (r.review) {
        const rev = r.review;
        const decision = rev.decision || 'Approved';
        const stars = '★'.repeat(rev.rating || 5);
        let decisionBadge = '<span class="badge" style="background:#ECFDF5; color:#047857; font-size:0.7rem; font-weight:700;">✅ Approved</span>';
        if (decision === 'Needs Revision') {
          decisionBadge = '<span class="badge" style="background:#FFFBEB; color:#B45309; font-size:0.7rem; font-weight:700;">⚠️ Needs Revision</span>';
        } else if (decision === 'Rejected') {
          decisionBadge = '<span class="badge" style="background:#FEF2F2; color:#B91C1C; font-size:0.7rem; font-weight:700;">❌ Rejected</span>';
        }

        reviewCell = `
          <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
            ${decisionBadge}
            <span style="color:#D97706; font-size:0.75rem; letter-spacing:1px;" title="${rev.rating} out of 5 stars">${stars}</span>
            <div style="font-size:0.68rem; color:#64748B; font-style:italic; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${rev.feedback || rev.comments || ''}">
              "${rev.feedback || rev.comments || 'Reviewed'}"
            </div>
          </div>
        `;

        reviewAction = `
          <button class="btn btn-ghost btn-sm btn-review-report" data-report-id="${r.id}" style="font-size:0.72rem; color:var(--royal-blue); border:1px solid rgba(29,95,143,0.3); padding:3px 8px; border-radius:4px;">
            ✏️ Update Review
          </button>
        `;
      } else {
        reviewCell = `
          <div style="display:flex; flex-direction:column; align-items:center;">
            <span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.7rem; font-weight:600;">⏳ Pending Review</span>
          </div>
        `;
        reviewAction = `
          <button class="btn btn-primary btn-sm btn-review-report" data-report-id="${r.id}" style="font-size:0.72rem; padding:4px 10px; font-weight:600;">
            ⭐ Review & Evaluate
          </button>
        `;
      }

      return `
        <tr>
          <td>
            <div style="font-weight:700; color:var(--navy-dark); font-size:0.78rem;">${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(r.date) : r.date}</div>
            ${r.submittedAt ? `<div style="font-size:0.68rem; color:#94A3B8;">${r.submittedAt}</div>` : ''}
          </td>
          <td>
            <div class="staff-cell-flex">
              ${avatarHtml}
              <div class="staff-meta-inline">
                <span class="name-txt">${staffName}</span>
                <span class="sub-txt">${staffPos}</span>
              </div>
            </div>
          </td>
          <td>
            <div style="font-weight:700; color:var(--navy-dark); font-size:0.82rem;">${r.projectTitle}</div>
            ${taskSnippet}
          </td>
          <td>
            <div style="font-size:0.76rem; color:#334155; max-width:300px; line-height:1.45;">${r.description}</div>
          </td>
          <td class="text-center">${statusBadge}</td>
          <td>${fileCell}</td>
          <td class="text-center">${reviewCell}</td>
          <td class="text-end">${reviewAction}</td>
        </tr>
      `;
    }).join('');

    // Wire review action buttons
    tbody.querySelectorAll('.btn-review-report').forEach(btn => {
      btn.addEventListener('click', () => {
        openReviewReportModal(btn.dataset.reportId);
      });
    });
  }

  // --- REVIEW REPORT MODAL ---
  function openReviewReportModal(reportId) {
    const report = WorkPulseDB.getDailyReports().find(r => r.id === reportId);
    if (!report) return;

    const staffMember = WorkPulseDB.getStaffById(report.staffId);
    document.getElementById('review-report-id').value = report.id;
    document.getElementById('review-modal-project-title').textContent = report.projectTitle || 'General Project Work';

    // Populate Task details
    const taskTitleEl = document.getElementById('review-modal-task-title');
    const taskWrapEl = document.getElementById('review-modal-task-wrap');
    if (taskTitleEl) {
      if (report.taskTitle || report.taskId) {
        taskTitleEl.textContent = report.taskTitle || report.taskId;
        if (taskWrapEl) taskWrapEl.style.display = 'block';
      } else {
        taskTitleEl.textContent = 'None / General Project Work';
        if (taskWrapEl) taskWrapEl.style.display = 'none';
      }
    }

    document.getElementById('review-modal-status').textContent = report.workStatus;
    document.getElementById('review-modal-staff-name').textContent = staffMember ? `${staffMember.name} (${staffMember.position || staffMember.id})` : (report.staffName || report.staffId);
    document.getElementById('review-modal-date').textContent = `${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(report.date) : report.date}${report.submittedAt ? ' • ' + report.submittedAt : ''}`;
    document.getElementById('review-modal-description').textContent = report.description || 'No description provided.';

    const fileBox = document.getElementById('review-modal-file-box');
    if (report.file) {
      const fileUrl = report.file.url || report.file.dataBase64 || '#';
      fileBox.innerHTML = `
        <div style="font-size:0.72rem; font-weight:700; color:var(--navy-dark); text-transform:uppercase; margin-bottom:3px;">Submitted Deliverable / Attachment</div>
        <div style="background:#FFFFFF; padding:8px 12px; border-radius:var(--radius-xs); border:1px solid #E2E8F0; display:inline-flex; align-items:center; gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--royal-blue);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          <a href="${fileUrl}" download="${report.file.name}" style="color:var(--royal-blue); font-weight:700; font-size:0.8rem; text-decoration:underline;">
            ${report.file.name}
          </a>
          <span style="font-size:0.72rem; color:#64748B;">(${report.file.size || 'Attachment'})</span>
        </div>
      `;
    } else {
      fileBox.innerHTML = '<span style="color:#94A3B8; font-size:0.76rem;">No deliverable files attached for this report.</span>';
    }

    // Populate review fields
    const decisionSelect = document.getElementById('review-decision-select');
    const ratingSelect = document.getElementById('review-rating-select');
    const feedbackText = document.getElementById('review-feedback-text');

    if (report.review) {
      if (decisionSelect) decisionSelect.value = report.review.decision || 'Approved';
      if (ratingSelect) ratingSelect.value = String(report.review.rating || 5);
      if (feedbackText) feedbackText.value = report.review.feedback || report.review.comments || '';
    } else {
      if (decisionSelect) decisionSelect.value = 'Approved';
      if (ratingSelect) ratingSelect.value = '5';
      if (feedbackText) feedbackText.value = '';
    }

    reviewReportModal.classList.add('open');
  }

  if (btnCloseReviewReport) btnCloseReviewReport.addEventListener('click', () => reviewReportModal.classList.remove('open'));
  if (btnCancelReviewReport) btnCancelReviewReport.addEventListener('click', () => reviewReportModal.classList.remove('open'));

  if (reviewReportForm) {
    reviewReportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reportId = document.getElementById('review-report-id').value;
      const decisionSelect = document.getElementById('review-decision-select');
      const decision = decisionSelect ? decisionSelect.value : 'Approved';
      const rating = parseInt(document.getElementById('review-rating-select').value, 10);
      const feedback = document.getElementById('review-feedback-text').value.trim();

      if (!feedback) {
        showToast('Please provide constructive review feedback.', 'error');
        return;
      }

      const submitBtn = reviewReportForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving Review...';
      }

      const adminProfile = WorkPulseDB.getAdminProfile();
      const adminReviewer = `${adminProfile.name || 'Administrator'} (${adminProfile.position || 'Executive Director'})`;
      const reviewPayload = {
        decision,
        status: decision,
        rating,
        feedback,
        comments: feedback,
        reviewerName: adminReviewer
      };

      try {
        const token = WorkPulseDB.getToken();
        const resp = await fetch(`/api/reports/${encodeURIComponent(reportId)}/review`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify(reviewPayload)
        });
        const resJson = await resp.json();
        if (resJson && resJson.success && resJson.data) {
          WorkPulseDB.submitReportReview(reportId, resJson.data.review || reviewPayload);
        } else {
          WorkPulseDB.submitReportReview(reportId, reviewPayload);
        }
      } catch (err) {
        console.warn('Backend review fallback:', err);
        WorkPulseDB.submitReportReview(reportId, reviewPayload);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Review to Staff Portal';
        }
      }

      reviewReportModal.classList.remove('open');
      showToast(`Review recorded: ${decision} (${rating} Stars) sent to Staff Portal!`, 'success');
      renderAdminReports();
      updatePendingBadges();
    });
  }

  // --- ASSIGN / EDIT TASK MODAL (ADMIN) ---
  const taskFileDropzone = document.getElementById('task-file-dropzone');
  const taskFileInput = document.getElementById('task-file-input');
  const taskDropzonePrompt = document.getElementById('task-dropzone-prompt');
  const taskFilePreviewWrap = document.getElementById('task-file-preview-wrap');
  const taskFileName = document.getElementById('task-file-name');
  const taskFileSize = document.getElementById('task-file-size');
  const btnRemoveTaskFile = document.getElementById('btn-remove-task-file');

  function resetTaskFileDropzone() {
    if (taskFileInput) taskFileInput.value = '';
    if (taskDropzonePrompt) taskDropzonePrompt.style.display = 'block';
    if (taskFilePreviewWrap) taskFilePreviewWrap.style.display = 'none';
  }

  if (taskFileDropzone && taskFileInput) {
    taskFileDropzone.addEventListener('click', (e) => {
      if (e.target !== btnRemoveTaskFile) taskFileInput.click();
    });
    taskFileInput.addEventListener('change', () => {
      const file = taskFileInput.files[0];
      if (file) {
        if (taskFileName) taskFileName.textContent = file.name;
        if (taskFileSize) taskFileSize.textContent = (file.size / 1024).toFixed(1) + ' KB';
        if (taskDropzonePrompt) taskDropzonePrompt.style.display = 'none';
        if (taskFilePreviewWrap) taskFilePreviewWrap.style.display = 'flex';
      }
    });
  }

  if (btnRemoveTaskFile) {
    btnRemoveTaskFile.addEventListener('click', (e) => {
      e.stopPropagation();
      resetTaskFileDropzone();
    });
  }

  function openAssignTaskModal(taskId = null, defaultProjectId = null) {
    if (!assignTaskModal || !assignTaskForm) return;

    const modalTitle = document.getElementById('assign-task-modal-title');
    const submitBtnLabel = document.getElementById('btn-submit-task-label');
    const idInput = document.getElementById('task-form-id');
    const projectSelect = document.getElementById('task-input-project');
    const selectAllCheckbox = document.getElementById('task-staff-select-all');
    const checkboxesList = document.getElementById('task-staff-checkboxes-list');
    const titleInput = document.getElementById('task-input-title');
    const descInput = document.getElementById('task-input-desc');
    const startInput = document.getElementById('task-input-start');
    const dueInput = document.getElementById('task-input-due');
    const priorityInput = document.getElementById('task-input-priority');
    const statusInput = document.getElementById('task-input-status');

    assignTaskForm.reset();
    resetTaskFileDropzone();

    // Populate projects dropdown
    const projects = WorkPulseDB.getProjects();
    if (projectSelect) {
      projectSelect.innerHTML = `
        <option value="">-- Standalone Task / No Project --</option>
        ${projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
      `;
      if (defaultProjectId) projectSelect.value = defaultProjectId;
    }

    // Populate staff checkboxes
    const staffList = WorkPulseDB.getStaffList();
    if (checkboxesList) {
      checkboxesList.innerHTML = staffList.map(s => `
        <label class="d-flex align-items-center gap-2 m-0 p-1 rounded" style="cursor:pointer; font-size:0.78rem; background:#FFFFFF; border:1px solid #F1F5F9;">
          <input type="checkbox" class="task-staff-check-item" value="${s.id}">
          <span style="font-weight:600; color:var(--navy-dark);">${escapeHtml(s.name)}</span>
          <span style="color:#64748B; font-size:0.72rem;">(${s.id} &bull; ${escapeHtml(s.position)})</span>
        </label>
      `).join('');
    }

    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.onchange = () => {
        const checks = checkboxesList.querySelectorAll('.task-staff-check-item');
        checks.forEach(c => { c.checked = selectAllCheckbox.checked; });
      };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    if (startInput) startInput.value = todayStr;
    if (dueInput) dueInput.value = nextWeek;

    if (taskId) {
      // Edit Task Mode
      const task = WorkPulseDB.getTaskById(taskId);
      if (!task) return;
      if (modalTitle) modalTitle.textContent = 'Edit Task: ' + task.title;
      if (submitBtnLabel) submitBtnLabel.textContent = 'Update Task';
      if (idInput) idInput.value = task.id;
      if (titleInput) titleInput.value = task.title || '';
      if (descInput) descInput.value = task.description || '';
      if (startInput) startInput.value = task.startDate || task.assignedDate || todayStr;
      if (dueInput) dueInput.value = task.dueDate || nextWeek;
      if (priorityInput) priorityInput.value = task.priority || 'Medium';
      if (statusInput) statusInput.value = task.status || 'To Do';
      if (projectSelect && task.projectId) projectSelect.value = task.projectId;

      // Check assigned staff
      const staffIds = Array.isArray(task.assignedStaffIds) ? task.assignedStaffIds : [task.assignedStaffId];
      if (staffIds.includes('all')) {
        if (selectAllCheckbox) selectAllCheckbox.checked = true;
        if (checkboxesList) {
          checkboxesList.querySelectorAll('.task-staff-check-item').forEach(c => { c.checked = true; });
        }
      } else if (checkboxesList) {
        checkboxesList.querySelectorAll('.task-staff-check-item').forEach(c => {
          c.checked = staffIds.includes(c.value);
        });
      }
    } else {
      if (modalTitle) modalTitle.textContent = 'Assign New Task';
      if (submitBtnLabel) submitBtnLabel.textContent = 'Assign Task';
      if (idInput) idInput.value = '';
    }

    assignTaskModal.classList.add('open');
  }

  function closeAssignTaskModal() {
    if (assignTaskModal) assignTaskModal.classList.remove('open');
  }

  if (btnOpenAssignTask) btnOpenAssignTask.addEventListener('click', () => openAssignTaskModal());
  if (btnCloseAssignTask) btnCloseAssignTask.addEventListener('click', closeAssignTaskModal);
  if (btnCancelAssignTask) btnCancelAssignTask.addEventListener('click', closeAssignTaskModal);

  if (assignTaskForm) {
    let isSubmittingTask = false;

    assignTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSubmittingTask) return; // Prevent duplicate concurrent submissions

      const submitBtn = document.getElementById('btn-submit-assign-task');
      const submitLabel = document.getElementById('btn-submit-task-label');
      const originalLabel = submitLabel ? submitLabel.textContent : 'Assign Task';

      const id = document.getElementById('task-form-id').value;
      const projectId = document.getElementById('task-input-project').value || null;
      const title = document.getElementById('task-input-title').value.trim();
      const description = document.getElementById('task-input-desc').value.trim();
      const startDate = document.getElementById('task-input-start').value;
      const dueDate = document.getElementById('task-input-due').value;
      const priority = document.getElementById('task-input-priority').value;
      const status = document.getElementById('task-input-status').value;

      const selectAll = document.getElementById('task-staff-select-all')?.checked;
      const checkedBoxes = Array.from(document.querySelectorAll('.task-staff-check-item:checked')).map(c => c.value);

      if (!title || !description) {
        showToast('Please provide task title and description.', 'error');
        return;
      }

      if (!selectAll && checkedBoxes.length === 0) {
        showToast('Please assign task to at least one staff member or select All Staff.', 'error');
        return;
      }

      isSubmittingTask = true;
      if (submitBtn) submitBtn.disabled = true;
      if (submitLabel) submitLabel.textContent = 'Saving...';

      const assignedStaffIds = selectAll ? ['all'] : checkedBoxes;
      const staffNames = selectAll ? 'All Staff Members' : checkedBoxes.map(cid => WorkPulseDB.getStaffById(cid)?.name || cid).join(', ');

      const taskPayload = {
        title,
        description,
        projectId,
        startDate,
        dueDate,
        priority,
        status,
        assignedStaffIds,
        assignedStaffName: staffNames,
        assignedStaffId: assignedStaffIds[0] || 'all'
      };

      try {
        if (id) {
          const res = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(taskPayload)
          });
          const json = await res.json().catch(() => null);
          const updated = (json && (json.data || json.task)) ? (json.data || json.task) : taskPayload;
          WorkPulseDB.updateTask(id, updated, 'admin');
          showToast(`Task "${title}" updated successfully!`, 'success');
        } else {
          let serverTask = null;
          try {
            const res = await fetch('/api/tasks', {
              method: 'POST',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(taskPayload)
            });
            const json = await res.json();
            if (json && json.success && (json.data || json.task)) {
              serverTask = json.data || json.task;
              // Authoritative server task cached directly into local storage without re-calling addTask
              WorkPulseDB.upsertTask(serverTask);
              showToast(`Task "${title}" created and assigned!`, 'success');
            } else {
              throw new Error(json?.error || 'Failed to create task on backend');
            }
          } catch (netErr) {
            // Offline fallback: ONLY create task in local DB if server request failed
            console.warn('Backend task create notice, falling back to local database:', netErr);
            WorkPulseDB.addTask(taskPayload, 'admin');
            showToast(`Task saved locally to database.`, 'success');
          }
        }
      } finally {
        isSubmittingTask = false;
        if (submitBtn) submitBtn.disabled = false;
        if (submitLabel) submitLabel.textContent = originalLabel;
      }

      closeAssignTaskModal();
      populateWorkFilters();
      renderAdminTasks();
      renderAdminKanban();
      renderAdminProjects();
      if (adminWorkActiveSubtab === 'gantt') renderAdminGantt();
    });
  }

  // --- MEETINGS MANAGEMENT ---
  function renderMeetingsManagement() {
    const tbody = document.getElementById('admin-meetings-tbody');
    if (!tbody) return;

    const meetings = WorkPulseDB.getMeetings();

    if (meetings.length === 0) {
      tbody.innerHTML = renderEmptyTableState(7, 'No Meetings Scheduled', 'Click "Schedule New Meeting" above to create your first executive briefing.');
      return;
    }

    const staffList = WorkPulseDB.getStaffList();

    tbody.innerHTML = meetings.map(m => {
      const dynamicStatus = (typeof WorkPulseDB.getMeetingDynamicStatus === 'function') 
        ? WorkPulseDB.getMeetingDynamicStatus(m) 
        : (m.status || (m.date >= new Date().toISOString().split('T')[0] ? 'Upcoming' : 'Completed'));
      const isUrl = m.venue && (m.venue.startsWith('http://') || m.venue.startsWith('https://') || m.venue.includes('meet.google') || m.venue.includes('zoom.us'));

      let venueDisplay = `<span>📍 ${escapeHtml(m.venue || 'Corporate HQ')}</span>`;
      if (isUrl) {
        venueDisplay = `
          <a href="${m.venue}" target="_blank" rel="noopener noreferrer" style="color:var(--royal-blue); font-weight:700; text-decoration:none; display:flex; align-items:center; gap:4px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l5 5-5 5"></path><path d="M4 4v7a4 4 0 0 0 4 4h12"></path></svg>
            <span>${m.venue.length > 24 ? escapeHtml(m.venue.substring(0, 22)) + '...' : escapeHtml(m.venue)}</span>
          </a>
        `;
      }

      let attendeesDisplay = `<span class="badge" style="background:#E0E7FF; color:#3730A3;">All Staff (${staffList.length})</span>`;
      if (m.attendees !== 'all') {
        const ids = Array.isArray(m.attendeeStaffIds) ? m.attendeeStaffIds : (Array.isArray(m.attendeeIds) ? m.attendeeIds : []);
        const attendeeNames = ids.map(id => {
          const s = staffList.find(st => st.id === id);
          return s ? `${s.name} (${s.position})` : id;
        });
        const tooltip = attendeeNames.join(', ');
        attendeesDisplay = `<span class="badge" style="background:#F1F5F9; color:#475569;" title="${escapeHtml(tooltip)}">${ids.length} Staff Selected</span>`;
      }

      let statusBadge = '<span class="badge" style="background:#F1F5F9; color:#64748B; font-size:0.7rem;">Completed</span>';
      if (dynamicStatus === 'Upcoming') {
        statusBadge = '<span class="badge badge-present" style="font-size:0.7rem;">Upcoming</span>';
      } else if (dynamicStatus === 'Ongoing') {
        statusBadge = '<span class="badge" style="background:#FEF3C7; color:#92400E; font-size:0.7rem; font-weight:700; border:1px solid #F59E0B; animation:pulse 2s infinite;">● Ongoing</span>';
      } else if (dynamicStatus === 'Cancelled') {
        statusBadge = '<span class="badge badge-leave" style="font-size:0.7rem;">Cancelled</span>';
      }

      return `
        <tr>
          <td>
            <div style="font-weight:700; color:var(--navy-dark); font-size:0.82rem;">${escapeHtml((typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(m.date) : m.date)}</div>
            <div style="font-size:0.72rem; color:var(--royal-blue); font-weight:600;">${escapeHtml(m.time)} (${m.durationMinutes || 60}m)</div>
          </td>
          <td>
            <div style="font-weight:700; color:var(--navy-dark); font-size:0.86rem;">${escapeHtml(m.title)}</div>
          </td>
          <td>
            <div style="font-size:0.76rem; color:#475569; max-width:300px;">${escapeHtml(m.description || 'Corporate briefing.')}</div>
          </td>
          <td>${venueDisplay}</td>
          <td>${attendeesDisplay}</td>
          <td class="text-center">
            ${statusBadge}
          </td>
          <td class="text-end">
            <div class="d-flex align-items-center justify-content-end gap-1">
              <button class="btn btn-ghost btn-sm btn-edit-meeting text-primary" data-meeting-id="${m.id}" title="Edit Meeting" style="padding:4px 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="btn btn-ghost btn-sm btn-delete-meeting text-danger" data-meeting-id="${m.id}" title="Cancel Meeting" style="padding:4px 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Edit meeting listener
    tbody.querySelectorAll('.btn-edit-meeting').forEach(btn => {
      btn.addEventListener('click', () => {
        const meetingId = btn.dataset.meetingId;
        const meeting = WorkPulseDB.getMeetings().find(m => m.id === meetingId);
        if (!meeting) return;

        openMeetingModalForEdit(meeting);
      });
    });

    // Delete/Cancel meeting listener
    tbody.querySelectorAll('.btn-delete-meeting').forEach(btn => {
      btn.addEventListener('click', async () => {
        const meetingId = btn.dataset.meetingId;
        if (confirm('Cancel and remove this scheduled meeting?')) {
          try {
            await fetch(`/api/meetings/${meetingId}`, {
              method: 'DELETE',
              headers: WorkPulseDB.getAuthHeaders()
            });
          } catch (e) {
            console.warn('Network delete error, removing locally:', e);
          }
          WorkPulseDB.deleteMeeting(meetingId);
          showToast('Meeting cancelled and removed.', 'info');
          renderMeetingsManagement();
        }
      });
    });
  }

  function populateMeetingStaffCheckboxes(selectedIds = []) {
    const checkboxList = document.getElementById('meeting-staff-checkboxes-list');
    if (!checkboxList) return;
    const staffList = WorkPulseDB.getStaffList();
    const selSet = new Set(selectedIds || []);
    checkboxList.innerHTML = staffList.map(s => `
      <div class="form-check" style="margin:0;">
        <input class="form-check-input meeting-staff-check" type="checkbox" value="${s.id}" id="chk-staff-${s.id}" ${selSet.has(s.id) ? 'checked' : ''}>
        <label class="form-check-label" for="chk-staff-${s.id}" style="font-size:0.76rem; color:var(--navy-dark); font-weight:600;">
          ${escapeHtml(s.name)} <span style="font-size:0.7rem; color:var(--text-muted); font-weight:400;">(${escapeHtml(s.position || 'Staff')})</span>
        </label>
      </div>
    `).join('');
  }

  function openMeetingModalForEdit(meeting) {
    if (!scheduleMeetingModal) return;
    if (scheduleMeetingForm) scheduleMeetingForm.reset();

    const idInput = document.getElementById('meeting-input-id');
    if (idInput) idInput.value = meeting.id;

    const modalTitle = document.getElementById('modal-meeting-title');
    if (modalTitle) modalTitle.textContent = 'Edit Corporate Meeting';

    const submitBtn = document.getElementById('btn-submit-meeting');
    if (submitBtn) submitBtn.textContent = 'Update Meeting';

    const titleInput = document.getElementById('meeting-input-title');
    if (titleInput) titleInput.value = meeting.title || '';

    const dateInput = document.getElementById('meeting-input-date');
    if (dateInput) {
      dateInput.removeAttribute('min');
      dateInput.value = meeting.date || '';
    }

    const timeInput = document.getElementById('meeting-input-time');
    if (timeInput) timeInput.value = meeting.time || '';

    const durationInput = document.getElementById('meeting-input-duration');
    if (durationInput) durationInput.value = String(meeting.durationMinutes || 60);

    const venueInput = document.getElementById('meeting-input-venue');
    if (venueInput) venueInput.value = meeting.venue || '';

    const descInput = document.getElementById('meeting-input-desc');
    if (descInput) descInput.value = meeting.description || '';

    const isAll = meeting.attendees === 'all';
    const checkAll = document.getElementById('check-all-attendees');
    if (checkAll) {
      checkAll.checked = isAll;
      checkAll.onchange = () => {
        const checks = document.querySelectorAll('.meeting-staff-check');
        checks.forEach(c => { c.disabled = checkAll.checked; if (checkAll.checked) c.checked = false; });
      };
    }

    const attendeeIds = Array.isArray(meeting.attendeeStaffIds) ? meeting.attendeeStaffIds : (Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds : []);
    populateMeetingStaffCheckboxes(isAll ? [] : attendeeIds);

    const checks = document.querySelectorAll('.meeting-staff-check');
    checks.forEach(c => { c.disabled = isAll; });

    scheduleMeetingModal.classList.add('open');
  }

  // --- SCHEDULE MEETING MODAL ---
  if (btnOpenScheduleMeeting) {
    btnOpenScheduleMeeting.addEventListener('click', () => {
      const idInput = document.getElementById('meeting-input-id');
      if (idInput) idInput.value = '';

      const modalTitle = document.getElementById('modal-meeting-title');
      if (modalTitle) modalTitle.textContent = 'Schedule Corporate Meeting';

      const submitBtn = document.getElementById('btn-submit-meeting');
      if (submitBtn) submitBtn.textContent = 'Schedule Meeting & Notify';

      populateMeetingStaffCheckboxes();

      const checkAll = document.getElementById('check-all-attendees');
      if (checkAll) {
        checkAll.checked = true;
        checkAll.onchange = () => {
          const checks = document.querySelectorAll('.meeting-staff-check');
          checks.forEach(c => { c.disabled = checkAll.checked; if (checkAll.checked) c.checked = false; });
        };
        const checks = document.querySelectorAll('.meeting-staff-check');
        checks.forEach(c => { c.disabled = true; });
      }

      if (scheduleMeetingForm) scheduleMeetingForm.reset();

      // Set min date and default date/time to now / near future in office timezone
      const todayDateStr = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getTodayDateString === 'function') 
        ? WorkPulseDB.getTodayDateString() 
        : new Date().toISOString().split('T')[0];
      const dateInput = document.getElementById('meeting-input-date');
      const timeInput = document.getElementById('meeting-input-time');
      if (dateInput) {
        dateInput.min = todayDateStr;
        dateInput.value = todayDateStr;
      }
      if (timeInput) {
        const now = new Date();
        const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
        timeInput.value = String(nextHour.getHours()).padStart(2, '0') + ':00';
      }

      scheduleMeetingModal.classList.add('open');
    });
  }

  if (btnCloseScheduleMeeting) btnCloseScheduleMeeting.addEventListener('click', () => scheduleMeetingModal.classList.remove('open'));
  if (btnCancelScheduleMeeting) btnCancelScheduleMeeting.addEventListener('click', () => scheduleMeetingModal.classList.remove('open'));

  let isSubmittingMeeting = false;
  if (scheduleMeetingForm) {
    scheduleMeetingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSubmittingMeeting) return;

      const submitBtn = document.getElementById('btn-submit-meeting');
      const editingId = document.getElementById('meeting-input-id')?.value || '';
      const title = document.getElementById('meeting-input-title').value.trim();
      const date = document.getElementById('meeting-input-date').value;
      const time = document.getElementById('meeting-input-time').value;
      const durationVal = document.getElementById('meeting-input-duration') ? parseInt(document.getElementById('meeting-input-duration').value, 10) : 60;
      const venue = document.getElementById('meeting-input-venue').value.trim();
      const description = document.getElementById('meeting-input-desc').value.trim();
      const isAll = document.getElementById('check-all-attendees').checked;
      const sendNotif = document.getElementById('check-send-meeting-notif').checked;

      // Validate future date and time for new meetings or date edits
      const startMs = (typeof WorkPulseDB.parseMeetingDateTime === 'function') 
        ? WorkPulseDB.parseMeetingDateTime(date, time) 
        : new Date(`${date}T${time}`).getTime();
      if (isNaN(startMs) || startMs < Date.now() - 120000) {
        showToast('Please select a future date and time.', 'error');
        return;
      }

      const allStaff = WorkPulseDB.getStaffList();
      let attendeeStaffIds = [];
      if (!isAll) {
        document.querySelectorAll('.meeting-staff-check:checked').forEach(c => attendeeStaffIds.push(c.value));
        if (attendeeStaffIds.length === 0) {
          showToast('Please select at least one staff attendee or check "All Corporate Staff".', 'error');
          return;
        }
      } else {
        attendeeStaffIds = allStaff.map(s => s.id);
      }
      attendeeStaffIds = Array.from(new Set(attendeeStaffIds));

      const adminProfile = WorkPulseDB.getAdminProfile();
      const adminOrganizer = `${adminProfile?.name || 'Administrator'} (Admin)`;

      const meetingPayload = {
        title,
        date,
        time,
        durationMinutes: durationVal || 60,
        venue,
        venueOrLink: venue,
        description,
        attendees: isAll ? 'all' : 'selected',
        targetAll: isAll,
        attendeeStaffIds,
        attendeeIds: attendeeStaffIds,
        organizer: adminOrganizer,
        sendNotification: sendNotif
      };

      isSubmittingMeeting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = editingId ? 'Updating...' : 'Scheduling...';
      }

      try {
        if (editingId) {
          // UPDATE existing meeting
          const resp = await fetch(`/api/meetings/${editingId}`, {
            method: 'PATCH',
            headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(meetingPayload)
          });
          const json = await resp.json();
          if (!resp.ok) {
            showToast(json.error || 'Failed to update meeting.', 'error');
            return;
          }
          WorkPulseDB.updateMeeting(editingId, meetingPayload);
          showToast('Meeting updated successfully!', 'success');
        } else {
          // CREATE new meeting
          let serverSaved = false;
          try {
            const resp = await fetch('/api/meetings', {
              method: 'POST',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(meetingPayload)
            });
            const json = await resp.json();
            if (!resp.ok) {
              showToast(json.error || 'Please select a future date and time.', 'error');
              return;
            }
            if (json && json.data) {
              const localDb = WorkPulseDB.load();
              if (!Array.isArray(localDb.meetings)) localDb.meetings = [];
              const idx = localDb.meetings.findIndex(m => m.id === json.data.id);
              if (idx >= 0) {
                localDb.meetings[idx] = json.data;
              } else {
                localDb.meetings.unshift(json.data);
              }
              WorkPulseDB.save(localDb);
              serverSaved = true;
            }
          } catch (netErr) {
            console.warn('Network call error, creating in local state:', netErr);
          }

          if (!serverSaved) {
            WorkPulseDB.createMeeting(meetingPayload);
          }
          showToast('Meeting scheduled and alerts dispatched to attendee portals!', 'success');
        }

        scheduleMeetingModal.classList.remove('open');
        renderMeetingsManagement();
      } catch (err) {
        showToast(err.message || 'Operation failed.', 'error');
      } finally {
        isSubmittingMeeting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = editingId ? 'Update Meeting' : 'Schedule Meeting & Notify';
        }
      }
    });
  }

  // Live Executive Clock
  function initAdminLiveClock() {
    const clockBadge = document.getElementById('topbar-live-clock');
    if (!clockBadge) return;
    function update() {
      const tz = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.getOfficeTimezone === 'function') 
        ? WorkPulseDB.getOfficeTimezone() 
        : 'Asia/Kolkata';
      const now = new Date();
      const shortDay = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
      const dStr = (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') 
        ? WorkPulseDB.formatDisplayDate(now) 
        : `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
      const dateStr = `${shortDay}, ${dStr}`;
      const timeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      clockBadge.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>${dateStr} &bull; ${timeStr}</span>
      `;
    }
    update();
    setInterval(update, 1000);
  }

  // --------------------------------------------------------------------------
  // 17. ADMIN PROFILE & ACCOUNT MANAGEMENT CONTROLLER
  // --------------------------------------------------------------------------
  let pendingAdminPhotoData = undefined; // undefined = unchanged, null = removed, string = new URL/base64

  function renderAdminProfileUI() {
    const admin = WorkPulseDB.getAdminProfile();
    const initials = getInitials(admin.name || 'Admin');

    // 1. Sidebar Footer Elements
    const sidebarNameEl = document.getElementById('sidebar-admin-name');
    const sidebarRoleEl = document.getElementById('sidebar-admin-role');
    const sidebarInitialsEl = document.getElementById('sidebar-admin-initials');

    if (sidebarNameEl) sidebarNameEl.textContent = admin.name || 'Admin';
    if (sidebarRoleEl) sidebarRoleEl.textContent = admin.position || 'Executive Director';
    if (sidebarInitialsEl) {
      if (admin.photo) {
        sidebarInitialsEl.innerHTML = `<img src="${admin.photo}" alt="${admin.name || 'Admin'}" onerror="this.parentElement.textContent='${initials}'">`;
      } else {
        sidebarInitialsEl.textContent = initials;
      }
    }

    // 2. Settings View Card Displays
    const settingsNameEl = document.getElementById('settings-admin-name-display');
    const settingsEmailEl = document.getElementById('settings-admin-email-display');
    const settingsPosEl = document.getElementById('settings-admin-position-display');
    const settingsAvatarEl = document.getElementById('settings-admin-avatar-preview');

    if (settingsNameEl) settingsNameEl.textContent = admin.name || 'Admin';
    if (settingsEmailEl) {
      settingsEmailEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: -2px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>${admin.email || 'admin@workpulse.com'}`;
    }
    if (settingsPosEl) {
      settingsPosEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: -2px;"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>${admin.position || 'Executive Director'}`;
    }
    if (settingsAvatarEl) {
      if (admin.photo) {
        settingsAvatarEl.innerHTML = `<img src="${admin.photo}" alt="${admin.name || 'Admin'}" onerror="this.parentElement.textContent='${initials}'">`;
      } else {
        settingsAvatarEl.textContent = initials;
      }
    }
  }

  function updateModalPhotoDisplay(photoUrl, name) {
    const initials = getInitials(name || 'Admin');
    const imgEl = document.getElementById('admin-modal-img');
    const initialsEl = document.getElementById('admin-modal-initials');
    const removeBtn = document.getElementById('btn-remove-admin-photo');

    if (photoUrl) {
      if (imgEl) {
        imgEl.src = photoUrl;
        imgEl.style.display = 'block';
      }
      if (initialsEl) initialsEl.style.display = 'none';
      if (removeBtn) removeBtn.style.display = 'inline-flex';
    } else {
      if (imgEl) {
        imgEl.src = '';
        imgEl.style.display = 'none';
      }
      if (initialsEl) {
        initialsEl.textContent = initials;
        initialsEl.style.display = 'inline';
      }
      if (removeBtn) removeBtn.style.display = 'none';
    }
  }

  function openAdminProfileModal() {
    const admin = WorkPulseDB.getAdminProfile();
    pendingAdminPhotoData = undefined;

    const modal = document.getElementById('admin-profile-modal');
    if (!modal) return;

    const nameInput = document.getElementById('admin-input-name');
    const emailInput = document.getElementById('admin-input-email');
    const posInput = document.getElementById('admin-input-position');
    const curPwdInput = document.getElementById('admin-input-current-pwd');
    const newPwdInput = document.getElementById('admin-input-new-pwd');
    const confPwdInput = document.getElementById('admin-input-confirm-pwd');

    if (nameInput) nameInput.value = admin.name || '';
    if (emailInput) emailInput.value = admin.email || '';
    if (posInput) posInput.value = admin.position || '';
    if (curPwdInput) curPwdInput.value = '';
    if (newPwdInput) newPwdInput.value = '';
    if (confPwdInput) confPwdInput.value = '';

    updateModalPhotoDisplay(admin.photo, admin.name || 'Admin');
    modal.classList.add('open');
  }

  function closeAdminProfileModal() {
    const modal = document.getElementById('admin-profile-modal');
    if (modal) modal.classList.remove('open');
    pendingAdminPhotoData = undefined;
  }

  // Photo browse and removal controls
  const adminPhotoInput = document.getElementById('admin-photo-input');
  const browseAdminPhotoBtn = document.getElementById('btn-browse-admin-photo');
  const removeAdminPhotoBtn = document.getElementById('btn-remove-admin-photo');

  if (browseAdminPhotoBtn && adminPhotoInput) {
    browseAdminPhotoBtn.addEventListener('click', () => adminPhotoInput.click());
  }

  if (adminPhotoInput) {
    adminPhotoInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      processStaffPhotoFile(file, (photoUrl, err) => {
        if (err) {
          showToast(err, 'error');
          return;
        }
        pendingAdminPhotoData = photoUrl;
        const nameVal = document.getElementById('admin-input-name')?.value.trim() || 'Admin';
        updateModalPhotoDisplay(photoUrl, nameVal);
        showToast('Photo uploaded & previewed. Click "Save Profile" to apply.', 'info');
      });
      adminPhotoInput.value = '';
    });
  }

  if (removeAdminPhotoBtn) {
    removeAdminPhotoBtn.addEventListener('click', () => {
      pendingAdminPhotoData = null;
      const nameVal = document.getElementById('admin-input-name')?.value.trim() || 'Admin';
      updateModalPhotoDisplay(null, nameVal);
      showToast('Photo marked for removal. Click "Save Profile" to apply.', 'info');
    });
  }

  // Profile Form Submission & Password Updating
  const adminProfileForm = document.getElementById('admin-profile-form');
  if (adminProfileForm) {
    adminProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('admin-input-name')?.value.trim();
      const email = document.getElementById('admin-input-email')?.value.trim();
      const position = document.getElementById('admin-input-position')?.value.trim();
      const currentPassword = document.getElementById('admin-input-current-pwd')?.value.trim();
      const newPassword = document.getElementById('admin-input-new-pwd')?.value.trim();
      const confirmPassword = document.getElementById('admin-input-confirm-pwd')?.value.trim();

      if (!name) {
        showToast('Please enter your full name.', 'error');
        document.getElementById('admin-input-name')?.focus();
        return;
      }
      if (!email || !email.includes('@')) {
        showToast('Please enter a valid corporate email address.', 'error');
        document.getElementById('admin-input-email')?.focus();
        return;
      }

      // If user desires to change password, enforce strict verification
      if (newPassword) {
        if (!currentPassword) {
          showToast('Please enter your Current Password to verify identity before setting a new password.', 'error');
          document.getElementById('admin-input-current-pwd')?.focus();
          return;
        }
        if (newPassword.length < 6) {
          showToast('New password must contain at least 6 characters.', 'error');
          document.getElementById('admin-input-new-pwd')?.focus();
          return;
        }
        if (newPassword !== confirmPassword) {
          showToast('New password confirmation does not match. Please re-enter carefully.', 'error');
          document.getElementById('admin-input-confirm-pwd')?.focus();
          return;
        }
      }

      const submitBtn = document.getElementById('btn-save-admin-profile');
      const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
          Saving Profile...
        `;
      }

      const payload = {
        name,
        email,
        position: position || 'Executive Director'
      };

      if (pendingAdminPhotoData !== undefined) {
        payload.photo = pendingAdminPhotoData;
      }
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      try {
        // Authoritative backend API call
        if (typeof fetch === 'function' && window.location && window.location.protocol.startsWith('http')) {
          try {
            const res = await fetch('/api/admin/profile', {
              method: 'PUT',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json && !json.success) {
              showToast(json.error || 'Failed to update admin profile.', 'error');
              if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnHtml;
              }
              return;
            }
          } catch (netErr) {
            console.warn('Network profile update fallback:', netErr);
          }
        }

        // Apply locally to state engine and update active admin session
        WorkPulseDB.updateAdminProfile(payload);

        // Update UI immediately
        renderAdminProfileUI();
        closeAdminProfileModal();
        showToast('Admin Profile and Account Settings successfully saved!', 'success');

      } catch (err) {
        showToast('Error saving profile: ' + err.message, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHtml;
        }
      }
    });
  }

  // Open & Close Modal Listeners
  const adminChipEl = document.getElementById('sidebar-admin-chip');
  if (adminChipEl) {
    adminChipEl.addEventListener('click', openAdminProfileModal);
    adminChipEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openAdminProfileModal();
      }
    });
  }
  document.getElementById('btn-open-admin-profile')?.addEventListener('click', openAdminProfileModal);
  document.getElementById('btn-close-admin-profile-modal')?.addEventListener('click', closeAdminProfileModal);
  document.getElementById('btn-cancel-admin-profile')?.addEventListener('click', closeAdminProfileModal);

  // ==========================================================================
  // CLIENT MANAGEMENT & LEAD MANAGEMENT MODULES
  // ==========================================================================

  let activeClientProfileId = null;
  let activeLeadNotesId = null;
  let currentLeadView = 'kanban'; // 'kanban' | 'table'
  let leadCurrentPage = 1;
  let leadPageSize = 10;

  // Helper Badge Renderers
  function getLeadStatusBadge(status) {
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

  function getProjectPaymentBadge(status) {
    const s = status || 'Pending';
    const map = {
      'Paid': { bg: '#ECFDF5', text: '#047857', border: '#A7F3D0' },
      'Partially Paid': { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
      'Pending': { bg: '#FFF7ED', text: '#C2410C', border: '#FED7AA' },
      'Overdue': { bg: '#FEF2F2', text: '#B91C1C', border: '#FECACA' }
    };
    const c = map[s] || { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0' };
    return `<span class="badge" style="background:${c.bg}; color:${c.text}; border:1px solid ${c.border}; font-size:0.7rem; font-weight:700;">${escapeHtml(s)}</span>`;
  }

  function getProjectStatusBadge(status) {
    const s = status || 'Planning';
    const map = {
      'Planning': { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
      'In Progress': { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0' },
      'Completed': { bg: '#ECFDF5', text: '#047857', border: '#A7F3D0' },
      'On Hold': { bg: '#FEF2F2', text: '#B91C1C', border: '#FECACA' },
      'Cancelled': { bg: '#F1F5F9', text: '#64748B', border: '#CBD5E1' }
    };
    const c = map[s] || { bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0' };
    return `<span class="badge" style="background:${c.bg}; color:${c.text}; border:1px solid ${c.border}; font-size:0.7rem; font-weight:700;">${escapeHtml(s)}</span>`;
  }

  // --------------------------------------------------------------------------
  // CLIENT MANAGEMENT CONTROLLER (COMPLETE MULTI-PROJECT & FINANCIAL LEDGER)
  // --------------------------------------------------------------------------
  let clientCurrentPage = 1;
  let clientPageSize = 10;
  let clientActiveTab = 'projects'; // 'projects' | 'payments' | 'notes' | 'activity'

  function populateClientStaffDropdowns() {
    const staffList = WorkPulseDB.getStaffList();
    const optionsHtml = '<option value="">Select Staff Lead...</option>' + staffList.map(s => `
      <option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.position || 'Staff')})</option>
    `).join('');

    const initStaff = document.getElementById('client-input-proj-staff');
    if (initStaff) {
      const cur = initStaff.value;
      initStaff.innerHTML = optionsHtml;
      if (cur) initStaff.value = cur;
    }

    const projStaff = document.getElementById('cproj-input-staff');
    if (projStaff) {
      const cur = projStaff.value;
      projStaff.innerHTML = optionsHtml;
      if (cur) projStaff.value = cur;
    }
  }

  function renderClients() {
    const tbody = document.getElementById('clients-table-tbody');
    if (!tbody) return;

    // Filters & Search Inputs
    const search = (document.getElementById('client-search-input')?.value || '').trim();
    const paymentStatus = document.getElementById('client-filter-payment')?.value || 'all';
    const clientStatusFilter = document.getElementById('client-filter-status')?.value || 'all';
    const serviceType = document.getElementById('client-filter-service')?.value || 'all';
    const sortBy = document.getElementById('client-sort-select')?.value || 'newest';
    const pageSizeSelect = document.getElementById('client-page-size');
    if (pageSizeSelect) clientPageSize = parseInt(pageSizeSelect.value, 10) || 10;

    // Summary KPIs strictly calculated from actual database records
    const summary = WorkPulseDB.getClientSummary();
    const kpiTotal = document.getElementById('client-kpi-total-clients');
    const kpiActive = document.getElementById('client-kpi-active-clients');
    const kpiProjects = document.getElementById('client-kpi-total-projects');
    const kpiProjectsSub = document.getElementById('client-kpi-total-projects-sub');

    if (kpiTotal) kpiTotal.textContent = summary.totalClients;
    if (kpiActive) kpiActive.textContent = summary.activeClients;
    if (kpiProjects) kpiProjects.textContent = summary.totalProjects;
    if (kpiProjectsSub) {
      kpiProjectsSub.textContent = `Across ${summary.totalClients} client portfolios (${summary.totalProjectValue.toLocaleString()})`;
    }

    // Get Filtered Client List from backend state engine
    let clients = WorkPulseDB.getClients({ search, paymentStatus, serviceType, status: clientStatusFilter });

    // Client-side Sorting
    clients.sort((a, b) => {
      const aProjects = Array.isArray(a.projects) ? a.projects : [];
      const bProjects = Array.isArray(b.projects) ? b.projects : [];
      const aVal = aProjects.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const bVal = bProjects.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      switch (sortBy) {
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'company-asc':
          return (a.company || '').localeCompare(b.company || '');
        case 'amount-desc':
          return bVal - aVal;
        case 'amount-asc':
          return aVal - bVal;
        case 'projects-desc':
          return bProjects.length - aProjects.length;
        case 'newest':
        default:
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      }
    });

    const totalRecords = clients.length;
    const countBadge = document.getElementById('client-results-count');
    if (countBadge) countBadge.textContent = `${totalRecords} ${totalRecords === 1 ? 'Client' : 'Clients'}`;

    // Pagination calculations
    const totalPages = Math.max(1, Math.ceil(totalRecords / clientPageSize));
    if (clientCurrentPage > totalPages) clientCurrentPage = totalPages;
    if (clientCurrentPage < 1) clientCurrentPage = 1;

    const startIndex = (clientCurrentPage - 1) * clientPageSize;
    const endIndex = Math.min(startIndex + clientPageSize, totalRecords);
    const pagedClients = clients.slice(startIndex, endIndex);

    // Empty state
    if (totalRecords === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 48px 20px; background: #FFFFFF;">
            <div style="width: 52px; height: 52px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: #94A3B8;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </div>
            <h3 style="font-size: 1rem; font-weight: 700; color: var(--navy-dark); margin: 0 0 6px;">No Clients Found</h3>
            <p style="font-size: 0.8rem; color: #64748B; max-width: 380px; margin: 0 auto 16px;">No corporate client accounts match your current query or filter selections.</p>
            <button class="btn btn-primary btn-sm" onclick="window.openAddClientModal()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Add New Client</span>
            </button>
          </td>
        </tr>
      `;
      renderClientPagination(0, 0, 0, 1, 1);
      return;
    }

    // Render Table Rows
    tbody.innerHTML = pagedClients.map(c => {
      const projects = Array.isArray(c.projects) ? c.projects : [];
      const clientTotalValue = projects.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      const clientPaidValue = projects.reduce((acc, p) => {
        const adv = Number(p.advancePaid) || 0;
        const add = Array.isArray(p.additionalPayments) ? p.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
        return acc + adv + add;
      }, 0);
      const clientDueValue = Math.max(0, clientTotalValue - clientPaidValue);

      const initials = getInitials(c.name || 'Client');
      const derivedStatus = getClientDerivedStatus(c, projects);
      const statusBadge = getClientStatusBadge(derivedStatus);

      // Tooltip listing project names on hover
      const projectNamesTooltip = projects.length > 0 
        ? projects.map(p => `• ${p.name} (${(Number(p.amount) || 0).toLocaleString()} - ${p.status || p.projectStatus || 'In Progress'})`).join('\n')
        : 'No projects attached';

      return `
        <tr onclick="if(!event.target.closest('button, a, input, select')) window.openClientProfileModal('${c.id}')" title="Click to view complete client dossier">
          <!-- Client Name & Avatar -->
          <td>
            <div class="d-flex align-items-center gap-2">
              <div class="client-avatar-sm">${initials}</div>
              <div style="min-width: 0;">
                <a href="javascript:void(0)" class="client-name-link" onclick="event.stopPropagation(); window.openClientProfileModal('${c.id}')">
                  ${escapeHtml(c.name)}
                </a>
                <div class="text-muted" style="font-size: 0.72rem;">ID: ${escapeHtml(c.id)}</div>
              </div>
            </div>
          </td>

          <!-- Company -->
          <td>
            <div style="font-weight: 600; color: #1E293B; font-size: 0.84rem;">${escapeHtml(c.company || '—')}</div>
            ${c.address ? `<div style="font-size: 0.72rem; color: #64748B; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(c.address)}">${escapeHtml(c.address)}</div>` : ''}
          </td>

          <!-- Phone -->
          <td>
            ${c.phone ? `<a href="tel:${escapeHtml(c.phone)}" onclick="event.stopPropagation()" style="color: #475569; text-decoration: none; font-size: 0.8rem; font-weight: 500;">${escapeHtml(c.phone)}</a>` : '<span class="text-muted">—</span>'}
          </td>

          <!-- Email -->
          <td>
            ${c.email ? `<a href="mailto:${escapeHtml(c.email)}" onclick="event.stopPropagation()" style="color: var(--royal-blue); text-decoration: none; font-size: 0.8rem; font-weight: 500;">${escapeHtml(c.email)}</a>` : '<span class="text-muted">—</span>'}
          </td>

          <!-- Assigned Projects -->
          <td style="text-align: center;">
            <span class="badge" style="background: #EFF6FF; color: #1D4ED8; font-weight: 700; padding: 4px 10px; border-radius: 12px; border: 1px solid #BFDBFE; cursor: pointer;" onclick="event.stopPropagation(); window.openClientProfileModal('${c.id}', 'projects')" title="${escapeHtml(projectNamesTooltip)}">
              ${projects.length} ${projects.length === 1 ? 'Project' : 'Projects'}
            </span>
          </td>

          <!-- Project Amount with Financial Subtext -->
          <td style="text-align: right; font-variant-numeric: tabular-nums;">
            <div style="font-weight: 800; color: var(--navy-dark); font-size: 0.88rem;">${clientTotalValue.toLocaleString()}</div>
            <div style="font-size: 0.7rem; color: #64748B;">
              <span style="color: #059669; font-weight: 600;">Paid ${clientPaidValue.toLocaleString()}</span> &bull; 
              <span style="color: ${clientDueValue > 0 ? '#DC2626' : '#64748B'}; font-weight: 600;">Due ${clientDueValue.toLocaleString()}</span>
            </div>
          </td>

          <!-- Status -->
          <td style="text-align: center;">
            ${statusBadge}
          </td>

          <!-- Actions -->
          <td style="text-align: right;">
            <div class="d-flex align-items-center justify-content-end gap-1" onclick="event.stopPropagation()">
              <button class="btn btn-outline-primary btn-sm" style="padding: 3px 8px; font-size: 0.74rem;" onclick="window.openClientProfileModal('${c.id}')" title="View Detailed Profile">
                Profile
              </button>
              <button class="btn btn-ghost btn-sm" style="padding: 3px 6px; font-size: 0.74rem; color: var(--royal-blue);" onclick="window.openAddClientProjectModal('${c.id}')" title="Assign New Project">
                + Project
              </button>
              <button class="btn btn-ghost btn-sm" style="padding: 3px 6px; color: #64748B;" onclick="window.openEditClientModal('${c.id}')" title="Edit Client">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              </button>
              <button class="btn btn-ghost btn-sm text-danger" style="padding: 3px 6px;" onclick="window.confirmDeleteClient('${c.id}', '${escapeHtml(c.name)}')" title="Delete Client">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    renderClientPagination(startIndex + 1, endIndex, totalRecords, clientCurrentPage, totalPages);
  }

  function getClientDerivedStatus(client, projects) {
    if (!projects || projects.length === 0) return 'New';
    const hasActive = projects.some(p => {
      const st = (p.status || p.projectStatus || '').toLowerCase();
      return st === 'in progress' || st === 'planning';
    });
    if (hasActive) return 'Active';
    const allCompleted = projects.every(p => {
      const st = (p.status || p.projectStatus || '').toLowerCase();
      return st === 'completed';
    });
    if (allCompleted) return 'Completed';
    const hasOnHold = projects.some(p => {
      const st = (p.status || p.projectStatus || '').toLowerCase();
      return st === 'on hold';
    });
    if (hasOnHold) return 'On Hold';
    return 'Active';
  }

  function getClientStatusBadge(status) {
    switch (status) {
      case 'Active':
        return `<span class="badge" style="background: #DEF7EC; color: #03543F; font-weight: 700; padding: 4px 10px; border-radius: 12px; border: 1px solid #BCF0DA;">Active</span>`;
      case 'Completed':
        return `<span class="badge" style="background: #E1EFFE; color: #1E429F; font-weight: 700; padding: 4px 10px; border-radius: 12px; border: 1px solid #BFDBFE;">Completed</span>`;
      case 'On Hold':
        return `<span class="badge" style="background: #FEF08A; color: #854D0E; font-weight: 700; padding: 4px 10px; border-radius: 12px; border: 1px solid #FDE047;">On Hold</span>`;
      case 'New':
      default:
        return `<span class="badge" style="background: #F1F5F9; color: #475569; font-weight: 700; padding: 4px 10px; border-radius: 12px; border: 1px solid #E2E8F0;">New</span>`;
    }
  }

  function renderClientPagination(from, to, total, current, totalPages) {
    const info = document.getElementById('client-pagination-info');
    const buttons = document.getElementById('client-pagination-buttons');
    if (info) {
      info.textContent = total === 0 ? 'Showing 0 of 0 clients' : `Showing ${from}–${to} of ${total} clients`;
    }
    if (!buttons) return;

    if (total === 0 || totalPages <= 1) {
      buttons.innerHTML = '';
      return;
    }

    let btnsHtml = `
      <button class="client-page-btn" ${current === 1 ? 'disabled' : ''} onclick="window.changeClientPage(${current - 1})">
        &lsaquo; Prev
      </button>
    `;

    for (let p = 1; p <= totalPages; p++) {
      if (totalPages > 7 && Math.abs(p - current) > 2 && p !== 1 && p !== totalPages) {
        if (p === 2 || p === totalPages - 1) {
          btnsHtml += `<span style="padding: 0 4px; color: #94A3B8;">...</span>`;
        }
        continue;
      }
      btnsHtml += `
        <button class="client-page-btn ${p === current ? 'active' : ''}" onclick="window.changeClientPage(${p})">
          ${p}
        </button>
      `;
    }

    btnsHtml += `
      <button class="client-page-btn" ${current === totalPages ? 'disabled' : ''} onclick="window.changeClientPage(${current + 1})">
        Next &rsaquo;
      </button>
    `;

    buttons.innerHTML = btnsHtml;
  }

  window.changeClientPage = function(page) {
    clientCurrentPage = page;
    renderClients();
  };

  // --------------------------------------------------------------------------
  // COMPLETE CLIENT PROFILE MODAL WITH TABS (PROJECTS, PAYMENTS, NOTES, ACTIVITY)
  // --------------------------------------------------------------------------
  function openClientProfileModal(clientId, activeTab = null) {
    activeClientProfileId = clientId;
    if (activeTab) clientActiveTab = activeTab;

    try {
      localStorage.setItem('workpulse_admin_last_client_id', clientId);
    } catch (e) {}

    const client = WorkPulseDB.getClientById(clientId);
    if (!client) {
      showToast('Client profile record not found.', 'error');
      return;
    }

    const projects = Array.isArray(client.projects) ? client.projects : [];
    const notes = Array.isArray(client.notes) ? client.notes : [];
    const activity = Array.isArray(client.activityHistory) ? client.activityHistory : [];
    const clientDomains = (typeof WorkPulseDB.getDomains === 'function') ? WorkPulseDB.getDomains({ clientId: client.id }) : [];

    // Financial calculations
    const totalVal = projects.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const totalPaidVal = projects.reduce((acc, p) => {
      const adv = Number(p.advancePaid) || 0;
      const add = Array.isArray(p.additionalPayments) ? p.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
      return acc + adv + add;
    }, 0);
    const totalDueVal = Math.max(0, totalVal - totalPaidVal);
    const activeProjectsCount = projects.filter(p => {
      const st = (p.status || p.projectStatus || '').toLowerCase();
      return st === 'in progress' || st === 'planning';
    }).length;

    // Aggregated Payments List across all projects
    const allPaymentsList = [];
    projects.forEach(p => {
      const advAmt = Number(p.advancePaid) || 0;
      if (advAmt > 0) {
        allPaymentsList.push({
          projectId: p.id,
          projectName: p.name,
          serviceType: p.serviceType || 'Enterprise Software',
          type: 'Advance Deposit',
          amount: advAmt,
          date: p.paymentDates?.advanceDate || p.startDate || 'Initial',
          method: 'Bank / Initial Deposit',
          notes: 'Contract Advance Payment',
          author: 'System / Admin'
        });
      }
      if (Array.isArray(p.additionalPayments)) {
        p.additionalPayments.forEach(pay => {
          allPaymentsList.push({
            projectId: p.id,
            projectName: p.name,
            serviceType: p.serviceType || 'Enterprise Software',
            type: 'Installment',
            amount: Number(pay.amount) || 0,
            date: pay.date || 'Recent',
            method: pay.method || 'Bank Transfer',
            notes: pay.notes || pay.reference || 'Milestone Payment',
            author: pay.author || 'Admin'
          });
        });
      }
    });
    allPaymentsList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const initials = getInitials(client.name || 'Client');
    const derivedStatus = getClientDerivedStatus(client, projects);
    const staffList = WorkPulseDB.getStaffList();

    const fullPageHtml = `
      <div class="cprof-fullpage-wrap">
        <!-- Top Navigation & Breadcrumbs Bar -->
        <div class="cprof-page-nav">
          <div class="cprof-nav-left">
            <button type="button" class="cprof-back-btn" id="btn-back-to-clients" onclick="window.closeClientProfile()" title="Return to Client Management">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              <span>Back to Client Management</span>
            </button>
            <div class="cprof-breadcrumbs">
              <span class="cprof-crumb-link" onclick="window.closeClientProfile()">Clients</span>
              <span class="cprof-crumb-sep">/</span>
              <span class="cprof-crumb-current">${escapeHtml(client.name)}</span>
              <span class="cprof-id-pill">ID: ${escapeHtml(client.id)}</span>
            </div>
          </div>
          <div class="cprof-nav-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.openEditClientModal('${client.id}')">
              <span>✏️ Edit Profile</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm" style="background: #10B981; border: none; font-weight: 700;" onclick="window.openRecordPaymentModal('${client.id}')">
              <span>💳 Record Payment</span>
            </button>
          </div>
        </div>

        <!-- Client Hero Dossier -->
        <div class="cprof-hero-card">
          <div class="cprof-hero-main">
            <div class="cprof-hero-avatar">
              ${initials}
            </div>
            <div class="cprof-hero-info">
              <div class="cprof-hero-title-row">
                <h2 class="cprof-hero-name">${escapeHtml(client.name)}</h2>
                ${getClientStatusBadge(derivedStatus)}
                <span style="font-size: 0.72rem; color: #94A3B8; background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px;">ID: ${escapeHtml(client.id)}</span>
              </div>
              <div class="cprof-hero-company">
                ${escapeHtml(client.company || 'Corporate Enterprise Client')}
              </div>
              <div class="cprof-hero-contacts">
                <span class="cprof-contact-item">📞 <a href="tel:${escapeHtml(client.phone)}" style="color: inherit; text-decoration: none; font-weight: 600;">${escapeHtml(client.phone || 'N/A')}</a></span>
                <span class="cprof-contact-item">✉️ <a href="mailto:${escapeHtml(client.email)}" style="color: inherit; text-decoration: none; font-weight: 600;">${escapeHtml(client.email || 'N/A')}</a></span>
                ${client.address ? `<span class="cprof-contact-item">📍 ${escapeHtml(client.address)}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="cprof-hero-actions">
            <button type="button" class="btn btn-secondary btn-sm" style="background: rgba(255,255,255,0.18); color: #FFFFFF; border: 1px solid rgba(255,255,255,0.35); font-size: 0.82rem; font-weight: 600; padding: 7px 16px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s ease;" onclick="window.openEditClientModal('${client.id}')">
              <span>✏️</span> <span>Edit Profile</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm" style="background: #10B981; color: #FFFFFF; border: none; font-weight: 700; font-size: 0.82rem; padding: 7px 16px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(16,185,129,0.25); transition: all 0.2s ease;" onclick="window.openRecordPaymentModal('${client.id}')">
              <span>💳</span> <span>Record Payment</span>
            </button>
          </div>
        </div>

        <!-- Financial Portfolio Metrics (4 Real Database KPI Cards) -->
        <div class="cprof-summary-grid">
          <div class="cprof-kpi-card kpi-projects">
            <div class="cprof-kpi-top">
              <span class="cprof-kpi-label">Total Projects</span>
              <div class="stat-icon-wrap" style="color: var(--royal-blue);">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              </div>
            </div>
            <div class="cprof-kpi-value" style="color: var(--navy-dark);">${projects.length}</div>
            <div class="cprof-kpi-sub">${activeProjectsCount} Active deliverables</div>
          </div>

          <div class="cprof-kpi-card kpi-value">
            <div class="cprof-kpi-top">
              <span class="cprof-kpi-label">Portfolio Value</span>
              <div class="stat-icon-wrap" style="color: var(--gold-primary);">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              </div>
            </div>
            <div class="cprof-kpi-value" style="color: var(--gold-primary);">${totalVal.toLocaleString()}</div>
            <div class="cprof-kpi-sub">Contracted scope sum</div>
          </div>

          <div class="cprof-kpi-card kpi-paid">
            <div class="cprof-kpi-top">
              <span class="cprof-kpi-label">Total Paid</span>
              <div class="stat-icon-wrap" style="color: #10B981;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
            </div>
            <div class="cprof-kpi-value" style="color: #10B981;">${totalPaidVal.toLocaleString()}</div>
            <div class="cprof-kpi-sub">${allPaymentsList.length} Payments credited</div>
          </div>

          <div class="cprof-kpi-card ${totalDueVal > 0 ? 'kpi-due' : 'kpi-settled'}">
            <div class="cprof-kpi-top">
              <span class="cprof-kpi-label">Balance Due</span>
              <div class="stat-icon-wrap" style="color: ${totalDueVal > 0 ? '#EA580C' : '#059669'};">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              </div>
            </div>
            <div class="cprof-kpi-value" style="color: ${totalDueVal > 0 ? '#EA580C' : '#059669'};">${totalDueVal.toLocaleString()}</div>
            <div class="cprof-kpi-sub">${totalDueVal > 0 ? 'Receivables outstanding' : 'All contracts settled in full ✓'}</div>
          </div>
        </div>

        <!-- Navigation Tabs Bar -->
        <div class="cprof-tabs-bar">
          <button type="button" class="cprof-tab-btn ${clientActiveTab === 'projects' ? 'active' : ''}" onclick="window.switchClientProfileTab('${client.id}', 'projects')">
            <span>📁 Projects Portfolio</span>
            <span class="cprof-tab-count">${projects.length}</span>
          </button>
          <button type="button" class="cprof-tab-btn ${clientActiveTab === 'payments' ? 'active' : ''}" onclick="window.switchClientProfileTab('${client.id}', 'payments')">
            <span>💳 Payment Ledger & Tracking</span>
            <span class="cprof-tab-count">${allPaymentsList.length}</span>
          </button>
          <button type="button" class="cprof-tab-btn ${clientActiveTab === 'domains' ? 'active' : ''}" onclick="window.switchClientProfileTab('${client.id}', 'domains')">
            <span>🌐 Domains & Hosting</span>
            <span class="cprof-tab-count">${clientDomains.length}</span>
          </button>
          <button type="button" class="cprof-tab-btn ${clientActiveTab === 'notes' ? 'active' : ''}" onclick="window.switchClientProfileTab('${client.id}', 'notes')">
            <span>📝 Notes & Discussion</span>
            <span class="cprof-tab-count">${notes.length}</span>
          </button>
          <button type="button" class="cprof-tab-btn ${clientActiveTab === 'activity' ? 'active' : ''}" onclick="window.switchClientProfileTab('${client.id}', 'activity')">
            <span>🕒 Activity History</span>
            <span class="cprof-tab-count">${activity.length}</span>
          </button>
        </div>

        <!-- Tab Content Area -->
        <div id="cprof-tab-content-area" class="cprof-tab-content-area">
          ${renderClientProfileTabContent(client, clientActiveTab, projects, allPaymentsList, notes, activity, staffList, totalVal, totalPaidVal, totalDueVal, clientDomains)}
        </div>
      </div>
    `;

    const viewContent = document.getElementById('client-profile-view-content');
    if (viewContent) {
      viewContent.innerHTML = fullPageHtml;
    }

    const modalContent = document.getElementById('client-profile-modal-content');
    if (modalContent) {
      modalContent.innerHTML = fullPageHtml;
    }

    // Keep compatibility with any code/checks tracking modal state
    const modal = document.getElementById('client-profile-modal');
    if (modal) {
      modal.classList.add('open');
    }

    // Switch view to the full-page client profile view
    switchView('client-profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderClientProfileTabContent(client, activeTab, projects, allPaymentsList, notes, activity, staffList, totalVal, totalPaidVal, totalDueVal, clientDomains = []) {
    if (activeTab === 'domains') {
      const activeCount = clientDomains.filter(d => (d.computedStatus || d.status) === 'Active').length;
      const expiringCount = clientDomains.filter(d => (d.computedStatus || d.status) === 'Expiring Soon').length;
      const expiredCount = clientDomains.filter(d => (d.computedStatus || d.status) === 'Expired').length;
      const totalRenewalCommitment = clientDomains.reduce((acc, d) => acc + (Number(d.renewalCost) || 0), 0);

      return `
        <!-- Domains & Hosting Portfolio Tab -->
        <div>
          <!-- Integration Context Banner -->
          <div style="background: linear-gradient(135deg, #F0FDF4 0%, #E0F2FE 100%); border: 1px solid #BAE6FD; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
            <div>
              <div class="d-flex align-items-center gap-2">
                <span style="font-size: 1.15rem;">🌐</span>
                <h4 style="font-size: 0.96rem; font-weight: 800; color: #0369A1; margin: 0;">Client Domains & Web Hosting Portfolio</h4>
                <span class="badge" style="background: #0284C7; color: #FFFFFF; font-size: 0.7rem; font-weight: 700;">Live Synchronized</span>
              </div>
              <p style="font-size: 0.77rem; color: #475569; margin: 4px 0 0;">
                All records are managed centrally in the separate <strong>Domain & Hosting Management</strong> module and automatically synchronized with this profile.
              </p>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn btn-outline-primary btn-sm" style="font-size: 0.76rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;" onclick="window.navigateToDomainModule('${client.id}')">
                <span>Manage in Domains Module</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </button>
              <button type="button" class="btn btn-primary btn-sm" style="font-size: 0.76rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; background: var(--royal-blue); border: none;" onclick="window.openAddDomainForClient('${client.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>Add Domain</span>
              </button>
            </div>
          </div>

          <!-- Quick Metrics Bar -->
          <div class="row g-2 mb-3">
            <div class="col-md-3 col-6">
              <div class="card p-2 text-center" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;">
                <div style="font-size: 0.7rem; color: #64748B; font-weight: 700; text-transform: uppercase;">Total Linked</div>
                <div style="font-size: 1.25rem; font-weight: 800; color: var(--navy-dark);">${clientDomains.length}</div>
              </div>
            </div>
            <div class="col-md-3 col-6">
              <div class="card p-2 text-center" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;">
                <div style="font-size: 0.7rem; color: #64748B; font-weight: 700; text-transform: uppercase;">Active Domains</div>
                <div style="font-size: 1.25rem; font-weight: 800; color: #16A34A;">${activeCount}</div>
              </div>
            </div>
            <div class="col-md-3 col-6">
              <div class="card p-2 text-center" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;">
                <div style="font-size: 0.7rem; color: #64748B; font-weight: 700; text-transform: uppercase;">Attention / Expiring</div>
                <div style="font-size: 1.25rem; font-weight: 800; color: ${expiringCount > 0 ? '#EA580C' : '#64748B'};">${expiringCount}</div>
              </div>
            </div>
            <div class="col-md-3 col-6">
              <div class="card p-2 text-center" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;">
                <div style="font-size: 0.7rem; color: #64748B; font-weight: 700; text-transform: uppercase;">Annual Renewal</div>
                <div style="font-size: 1.25rem; font-weight: 800; color: var(--royal-blue);">${totalRenewalCommitment.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <!-- Domains & Hosting Portfolio Table -->
          <div class="card mb-3" style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
            <div class="table-container">
              <table class="table wp-table" style="margin: 0; font-size: 0.8rem;">
                <thead style="background: #F8FAFC;">
                  <tr>
                    <th>Domain Name & Registrar</th>
                    <th>Hosting Provider & Plan</th>
                    <th>Domain & Hosting Expiry</th>
                    <th style="text-align: right;">Renewal Cost</th>
                    <th style="text-align: center;">Status</th>
                    <th>SSL Security</th>
                    <th>Linked Project</th>
                    <th style="text-align: center;">Renewal History</th>
                    <th style="text-align: right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${clientDomains.length === 0 ? `
                    <tr>
                      <td colspan="9" style="text-align: center; color: #94A3B8; padding: 36px 20px;">
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 8px; opacity: 0.6;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                        <div style="font-weight: 700; color: #475569; font-size: 0.9rem;">No Domains or Hosting Linked to this Client</div>
                        <div style="font-size: 0.76rem; color: #64748B; margin-top: 4px;">Click "Add Domain" above to register a corporate domain in the Domain & Hosting module.</div>
                      </td>
                    </tr>
                  ` : clientDomains.map(d => {
                    const st = d.computedStatus || d.status || 'Active';
                    const badgeClass = st === 'Active' ? 'domain-status-active' : (st === 'Expiring Soon' ? 'domain-status-expiring' : 'domain-status-expired');
                    const sslBadge = d.sslStatus === 'Active' ? 'domain-ssl-active' : (d.sslStatus === 'Expiring Soon' ? 'domain-ssl-warning' : 'domain-ssl-danger');
                    const renewals = Array.isArray(d.renewalHistory) ? d.renewalHistory : [];
                    const renewalsCount = renewals.length;

                    return `
                      <tr>
                        <!-- 1. Domain Name and Registrar -->
                        <td>
                          <div style="font-weight: 800; color: var(--navy-dark); font-size: 0.85rem;">
                            <a href="https://${escapeHtml(d.domainName)}" target="_blank" rel="noopener noreferrer" style="color: var(--royal-blue); text-decoration: none;" title="Open website in new tab">
                              ${escapeHtml(d.domainName)} ↗
                            </a>
                          </div>
                          <div style="font-size: 0.72rem; color: #475569; margin-top: 2px;">
                            Registrar: <strong>${escapeHtml(d.registrar || 'Namecheap')}</strong>
                          </div>
                          ${d.serverIp ? `<div style="font-size: 0.68rem; color: #64748B;">IP: <code>${escapeHtml(d.serverIp)}</code></div>` : ''}
                        </td>

                        <!-- 2. Hosting Provider and Hosting Plan -->
                        <td>
                          <div style="font-weight: 700; color: #1E293B; font-size: 0.82rem;">${escapeHtml(d.hostingProvider || 'AWS Cloud')}</div>
                          <div style="font-size: 0.72rem; color: #64748B;">${escapeHtml(d.hostingPlan || 'Standard Tier')}</div>
                        </td>

                        <!-- 3. Domain and Hosting Expiry Dates -->
                        <td>
                          <div style="font-size: 0.78rem; font-weight: 700; color: #1E293B;">
                            📅 Domain: <span>${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(d.expiryDate) : (d.expiryDate || 'N/A')}</span>
                          </div>
                          <div style="font-size: 0.72rem; color: ${d.daysRemaining <= 30 ? '#DC2626' : '#64748B'}; font-weight: 600;">
                            ${d.statusLabel || ''}
                          </div>
                          <div style="font-size: 0.72rem; color: #64748B; margin-top: 3px;">
                            ☁️ Hosting: <strong>${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(d.hostingExpiryDate) : (d.hostingExpiryDate || 'Aligned with domain')}</strong>
                          </div>
                        </td>

                        <!-- 4. Renewal Amount and Auto-Renew -->
                        <td style="text-align: right; font-variant-numeric: tabular-nums;">
                          <div style="font-weight: 800; color: var(--navy-dark); font-size: 0.86rem;">
                            ${escapeHtml(d.currency || 'USD')} ${(Number(d.renewalCost) || 0).toLocaleString()}
                          </div>
                          <div style="font-size: 0.68rem; color: ${d.autoRenew ? '#059669' : '#64748B'}; font-weight: 600;">
                            ${d.autoRenew ? '✓ Auto-Renew ON' : 'Manual Renew'}
                          </div>
                        </td>

                        <!-- 5. Renewal Status -->
                        <td style="text-align: center;">
                          <span class="domain-status-badge ${badgeClass}">${st}</span>
                        </td>

                        <!-- 6. SSL Status & Expiry -->
                        <td>
                          <span class="domain-ssl-pill ${sslBadge}">🔒 ${escapeHtml(d.sslStatus || 'Active')}</span>
                          <div style="font-size: 0.7rem; color: #64748B; margin-top: 3px;">
                            Exp: ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(d.sslExpiryDate) : (d.sslExpiryDate || 'Auto-Managed')}
                          </div>
                          ${d.sslIssuer ? `<div style="font-size: 0.68rem; color: #94A3B8;">${escapeHtml(d.sslIssuer)}</div>` : ''}
                        </td>

                        <!-- 7. Linked Projects -->
                        <td>
                          ${(d.projectName || d.projectId) ? `
                            <span class="badge" style="background: #EFF6FF; color: #1D4ED8; font-weight: 700; border: 1px solid #BFDBFE; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 3px;" title="Linked to client project deliverable">
                              📁 ${escapeHtml(d.projectName || d.projectId)}
                            </span>
                          ` : `
                            <span class="badge" style="background: #F8FAFC; color: #64748B; font-size: 0.7rem; border: 1px solid #E2E8F0;" title="Associated with general client corporate account">
                              Corporate / General
                            </span>
                          `}
                        </td>

                        <!-- 8. Renewal History -->
                        <td style="text-align: center;">
                          ${renewalsCount > 0 ? `
                            <button type="button" class="btn btn-outline-info btn-sm" style="font-size: 0.72rem; padding: 2px 8px; font-weight: 700;" onclick="window.viewDomainRenewalHistory('${d.id}')" title="Click to view renewal audit trail">
                              📜 ${renewalsCount} Logged
                            </button>
                          ` : `
                            <div style="font-size: 0.7rem; color: #94A3B8; margin-bottom: 2px;">Initial Cycle</div>
                            <button type="button" class="btn btn-ghost btn-sm" style="font-size: 0.7rem; padding: 1px 6px; color: #10B981; font-weight: 700;" onclick="window.openRecordDomainRenewalModal('${d.id}')" title="Record renewal cycle">
                              + Renew
                            </button>
                          `}
                        </td>

                        <!-- Actions -->
                        <td style="text-align: right;">
                          <div class="d-flex align-items-center justify-content-end gap-1">
                            <button type="button" class="btn btn-outline-secondary btn-sm p-1" onclick="window.viewDomainDetails('${d.id}')" title="View Full Technical Dossier">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button type="button" class="btn btn-outline-primary btn-sm p-1" onclick="window.openEditDomainModal('${d.id}')" title="Edit in Domain Management Module">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    if (activeTab === 'payments') {
      return `
        <!-- Payment Ledger Tab -->
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
            <div>
              <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--navy-dark); margin: 0;">Financial Accounting Ledger</h4>
              <p style="font-size: 0.76rem; color: #64748B; margin: 2px 0 0;">Internal payment tracking, advance deposits, and settlement history.</p>
            </div>
            <button class="btn btn-primary btn-sm" style="display: inline-flex; align-items: center; gap: 5px; background: #10B981; border: none; font-weight: 700; font-size: 0.76rem;" onclick="window.openRecordPaymentModal('${client.id}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Record Payment Installment</span>
            </button>
          </div>

          <!-- Project Financial Breakdown Table -->
          <div class="card mb-4" style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
            <div style="background: #F8FAFC; padding: 10px 16px; border-bottom: 1px solid var(--border-color); font-weight: 700; font-size: 0.82rem; color: var(--navy-dark);">
              Project Contract Receivables Breakdown
            </div>
            <div class="table-container">
              <table class="table wp-table" style="margin: 0; font-size: 0.8rem;">
                <thead>
                  <tr>
                    <th>Project Name</th>
                    <th>Service Type</th>
                    <th style="text-align: right;">Total Amount</th>
                    <th style="text-align: right;">Advance Paid</th>
                    <th style="text-align: right;">Installments</th>
                    <th style="text-align: right;">Balance Due</th>
                    <th style="text-align: center;">Payment Status</th>
                    <th style="text-align: right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${projects.length === 0 ? `
                    <tr><td colspan="8" style="text-align: center; color: #94A3B8; padding: 24px;">No projects registered for billing.</td></tr>
                  ` : projects.map(p => {
                    const pTotal = Number(p.amount) || 0;
                    const pAdv = Number(p.advancePaid) || 0;
                    const pAdd = Array.isArray(p.additionalPayments) ? p.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
                    const pPaid = pAdv + pAdd;
                    const pDue = Math.max(0, pTotal - pPaid);
                    return `
                      <tr>
                        <td>
                          <div style="font-weight: 700; color: var(--navy-dark);">${escapeHtml(p.name)}</div>
                        </td>
                        <td>
                          <span class="badge-service-type">${escapeHtml(p.serviceType || 'Enterprise Software')}</span>
                        </td>
                        <td style="text-align: right; font-weight: 700;">${pTotal.toLocaleString()}</td>
                        <td style="text-align: right; color: #059669;">${pAdv.toLocaleString()}</td>
                        <td style="text-align: right; color: #1D4ED8;">${pAdd.toLocaleString()}</td>
                        <td style="text-align: right; font-weight: 800; color: ${pDue > 0 ? '#DC2626' : '#059669'};">${pDue.toLocaleString()}</td>
                        <td style="text-align: center;">${getProjectPaymentBadge(p.paymentStatus)}</td>
                        <td style="text-align: right;">
                          <button class="btn btn-outline-primary btn-sm" style="padding: 2px 8px; font-size: 0.72rem;" onclick="window.openRecordPaymentModal('${client.id}', '${p.id}')">
                            + Pay
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Chronological Payment Transactions History -->
          <div class="card" style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
            <div style="background: #F8FAFC; padding: 10px 16px; border-bottom: 1px solid var(--border-color); font-weight: 700; font-size: 0.82rem; color: var(--navy-dark); display: flex; justify-content: space-between;">
              <span>Recorded Transactions & Installment Ledger</span>
              <span class="badge" style="background: #E2E8F0; color: #475569;">${allPaymentsList.length} Entries</span>
            </div>
            <div class="table-container">
              <table class="table wp-table" style="margin: 0; font-size: 0.8rem;">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Project</th>
                    <th>Payment Type</th>
                    <th>Method</th>
                    <th>Notes / Reference</th>
                    <th style="text-align: right;">Amount</th>
                    <th>Recorded By</th>
                  </tr>
                </thead>
                <tbody>
                  ${allPaymentsList.length === 0 ? `
                    <tr><td colspan="7" style="text-align: center; color: #94A3B8; padding: 32px;">No payment installments recorded yet. Click "Record Payment Installment" above.</td></tr>
                  ` : allPaymentsList.map(pay => `
                    <tr>
                      <td style="font-weight: 600; color: var(--navy-dark);">${escapeHtml((typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(pay.date) : pay.date)}</td>
                      <td>
                        <div style="font-weight: 600; color: #1E293B;">${escapeHtml(pay.projectName)}</div>
                        <span class="badge-service-type" style="font-size: 0.65rem; padding: 1px 5px;">${escapeHtml(pay.serviceType)}</span>
                      </td>
                      <td>
                        <span class="badge" style="background: ${pay.type === 'Advance Deposit' ? '#EFF6FF' : '#ECFDF5'}; color: ${pay.type === 'Advance Deposit' ? '#1D4ED8' : '#047857'}; font-weight: 700;">
                          ${escapeHtml(pay.type)}
                        </span>
                      </td>
                      <td style="color: #475569;">${escapeHtml(pay.method)}</td>
                      <td style="color: #64748B; font-size: 0.74rem;">${escapeHtml(pay.notes)}</td>
                      <td style="text-align: right; font-weight: 800; color: #047857; font-size: 0.86rem;">
                        +${pay.amount.toLocaleString()}
                      </td>
                      <td style="font-size: 0.74rem; color: #64748B;">${escapeHtml(pay.author)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    if (activeTab === 'notes') {
      return `
        <!-- Notes & Discussion Tab -->
        <div>
          <!-- Add Note Box -->
          <div class="card p-3 mb-4" style="border: 1px solid #E2E8F0; background: #FFFFFF; border-radius: 8px;">
            <h4 style="font-size: 0.85rem; font-weight: 700; color: var(--navy-dark); margin-bottom: 8px;">
              Add Communication Note / Discussion Update
            </h4>
            <div class="mb-2">
              <textarea class="form-control" id="cprof-input-note" rows="3" placeholder="Enter client discussion summary, meeting recap, deliverable feedback, change requests, or account directives..."></textarea>
            </div>
            <div style="display: flex; justify-content: flex-end;">
              <button type="button" class="btn btn-primary btn-sm" onclick="window.submitClientNote('${client.id}')">
                Log Note to Profile
              </button>
            </div>
          </div>

          <!-- Notes Stream -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="font-size: 0.9rem; font-weight: 800; color: var(--navy-dark); margin: 0;">Client Notes Feed</h4>
            <span class="badge" style="background: #E2E8F0; color: #475569;">${notes.length} ${notes.length === 1 ? 'Note' : 'Notes'}</span>
          </div>

          ${notes.length === 0 ? `
            <div style="text-align: center; padding: 36px 20px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; color: #94A3B8; font-size: 0.82rem;">
              No notes logged for this client yet. Use the input above to record meeting summaries.
            </div>
          ` : notes.slice().reverse().map(n => `
            <div class="cprof-note-card">
              <div class="cprof-note-header">
                <div class="cprof-note-author">
                  <span>👤 ${escapeHtml(n.author || 'Admin')}</span>
                  ${n.authorRole ? `<span style="font-size: 0.7rem; color: #64748B; font-weight: 500;">(${escapeHtml(n.authorRole)})</span>` : ''}
                </div>
                <div class="cprof-note-date">${escapeHtml(n.timestamp || 'Recent')}</div>
              </div>
              <div class="cprof-note-body">${escapeHtml(n.text || n.note || '')}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    if (activeTab === 'activity') {
      return `
        <!-- Activity Timeline Tab -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <div>
              <h4 style="font-size: 0.92rem; font-weight: 800; color: var(--navy-dark); margin: 0;">Comprehensive Activity History</h4>
              <p style="font-size: 0.76rem; color: #64748B; margin: 2px 0 0;">Chronological record of account events, project assignments, payment updates, and edits.</p>
            </div>
            <span class="badge" style="background: #E2E8F0; color: #475569;">${activity.length} Events</span>
          </div>

          ${activity.length === 0 ? `
            <div style="text-align: center; padding: 36px 20px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; color: #94A3B8; font-size: 0.82rem;">
              No activity logs recorded yet.
            </div>
          ` : `
            <div class="cprof-timeline">
              ${activity.slice().reverse().map(act => {
                let dotClass = '';
                if ((act.type || '').includes('payment')) dotClass = 'payment';
                else if ((act.type || '').includes('project')) dotClass = 'project';
                else if ((act.type || '').includes('note')) dotClass = 'note';

                return `
                  <div class="cprof-timeline-item">
                    <div class="cprof-timeline-dot ${dotClass}"></div>
                    <div class="cprof-timeline-content">
                      <div class="cprof-timeline-title">
                        <span>${escapeHtml(act.title || act.type || 'Event')}</span>
                        <span class="cprof-timeline-time">${escapeHtml(act.timestamp || 'Recent')}</span>
                      </div>
                      <p class="cprof-timeline-desc">${escapeHtml(act.description || act.details || '')}</p>
                      ${act.author ? `<div style="font-size: 0.68rem; color: #94A3B8; margin-top: 4px;">By: ${escapeHtml(act.author)}</div>` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      `;
    }

    // Default: Projects Portfolio Tab
    return `
      <div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--navy-dark); margin: 0;">Client Projects & Deliverables Portfolio</h4>
            <p style="font-size: 0.76rem; color: #64748B; margin: 2px 0 0;">Manage deliverable scopes, assigned staff leads, execution progress, and contracts.</p>
          </div>
        </div>

        ${projects.length === 0 ? `
          <div style="text-align: center; padding: 48px 20px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;">
            <div style="font-size: 2rem; margin-bottom: 8px;">📂</div>
            <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--navy-dark); margin-bottom: 4px;">No Projects Assigned</h4>
            <p style="font-size: 0.8rem; color: #64748B; max-width: 380px; margin: 0 auto;">Project scope and deliverables are configured upon client creation or updated via Edit Profile.</p>
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 14px;">
            ${projects.map(p => {
              const pTotal = Number(p.amount) || 0;
              const pAdv = Number(p.advancePaid) || 0;
              const pAdd = Array.isArray(p.additionalPayments) ? p.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
              const pPaid = pAdv + pAdd;
              const pDue = Math.max(0, pTotal - pPaid);
              const progressVal = Math.min(100, Math.max(0, Number(p.progress) || 0));

              let statusClass = 'in-progress';
              const stLower = (p.status || p.projectStatus || '').toLowerCase();
              if (stLower === 'completed') statusClass = 'completed';
              else if (stLower === 'on hold') statusClass = 'on-hold';
              else if (stLower === 'planning') statusClass = 'planning';

              const staff = staffList.find(s => s.id === (p.assignedStaff || p.assignedStaffId)) || null;
              const staffName = staff ? staff.name : (p.assignedStaffName || 'Unassigned');
              const staffPos = staff ? (staff.position || 'Staff') : 'Staff Lead';

              return `
                <div class="card" style="border: 1px solid #E2E8F0; border-radius: 10px; padding: 18px; background: #FFFFFF; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                  <!-- Top Row: Name, Service Badge, Status Badges, Actions -->
                  <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap;">
                    <div>
                      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <h4 style="font-size: 1rem; font-weight: 800; color: var(--navy-dark); margin: 0;">${escapeHtml(p.name)}</h4>
                        <span class="badge-service-type">${escapeHtml(p.serviceType || 'Enterprise Software')}</span>
                        ${getProjectStatusBadge(p.status || p.projectStatus)}
                        ${getProjectPaymentBadge(p.paymentStatus)}
                      </div>
                      ${p.description ? `<p style="font-size: 0.8rem; color: #475569; margin: 4px 0 0; line-height: 1.4;">${escapeHtml(p.description)}</p>` : ''}
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <button class="btn btn-outline-info btn-sm" style="font-size: 0.72rem; padding: 3px 8px; font-weight: 700;" onclick="window.openAddDomainForClient('${client.id}', '${p.id}')" title="Add Domain & Hosting for this Project">
                        🌐 + Add Domain
                      </button>
                      <button class="btn btn-outline-primary btn-sm" style="font-size: 0.72rem; padding: 3px 8px;" onclick="window.openRecordPaymentModal('${client.id}', '${p.id}')" title="Record Payment">
                        💳 + Payment
                      </button>
                      <button class="btn btn-secondary btn-sm" style="font-size: 0.72rem; padding: 3px 8px;" onclick="window.openEditClientProjectModal('${client.id}', '${p.id}')" title="Edit Project Details">
                        ✏️ Edit
                      </button>
                      <button class="btn btn-ghost btn-sm text-danger" style="font-size: 0.72rem; padding: 3px 6px;" onclick="window.confirmDeleteClientProject('${client.id}', '${p.id}', '${escapeHtml(p.name)}')" title="Delete Project">
                        🗑️
                      </button>
                    </div>
                  </div>

                  <!-- Details Grid: Assigned Staff, Timeline, Financials, Progress -->
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 16px; margin-top: 10px;">
                    <div>
                      <div style="font-size: 0.7rem; font-weight: 700; color: #64748B; text-transform: uppercase;">Assigned Staff Lead</div>
                      <div style="font-size: 0.82rem; font-weight: 700; color: var(--navy-dark); margin-top: 2px;">👤 ${escapeHtml(staffName)}</div>
                      <div style="font-size: 0.7rem; color: #94A3B8;">${escapeHtml(staffPos)}</div>
                    </div>
                    <div>
                      <div style="font-size: 0.7rem; font-weight: 700; color: #64748B; text-transform: uppercase;">Timeline</div>
                      <div style="font-size: 0.82rem; font-weight: 600; color: #334155; margin-top: 2px;">
                        📅 ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(p.startDate) : (p.startDate || '—')} &rarr; ${(typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') ? WorkPulseDB.formatDisplayDate(p.dueDate) : (p.dueDate || '—')}
                      </div>
                      <div style="font-size: 0.7rem; color: #94A3B8;">Start &bull; Target Delivery</div>
                    </div>
                    <div>
                      <div style="font-size: 0.7rem; font-weight: 700; color: #64748B; text-transform: uppercase;">Contract & Payments</div>
                      <div style="font-size: 0.84rem; font-weight: 800; color: var(--navy-dark); margin-top: 2px;">
                        ${pTotal.toLocaleString()} <span style="font-size: 0.72rem; font-weight: 600; color: #059669;">(Paid: ${pPaid.toLocaleString()})</span>
                      </div>
                      <div style="font-size: 0.7rem; color: ${pDue > 0 ? '#DC2626' : '#059669'}; font-weight: 600;">
                        ${pDue > 0 ? `Balance Due: ${pDue.toLocaleString()}` : 'Fully Settled ✓'}
                      </div>
                    </div>
                    <div>
                      <div style="display: flex; justify-content: space-between; font-size: 0.7rem; font-weight: 700; color: #64748B; text-transform: uppercase;">
                        <span>Progress</span>
                        <span>${progressVal}%</span>
                      </div>
                      <div class="cprof-progress-track">
                        <div class="cprof-progress-fill ${statusClass}" style="width: ${progressVal}%;"></div>
                      </div>
                      <div style="font-size: 0.7rem; color: #94A3B8; margin-top: 4px;">${p.status || p.projectStatus || 'In Progress'}</div>
                    </div>
                  </div>

                  <!-- Linked Project Domains & Web Infrastructure -->
                  ${(() => {
                    const projectDomains = clientDomains.filter(d => d.projectId === p.id);
                    if (projectDomains.length === 0) {
                      return `
                        <div style="margin-top: 10px; padding: 8px 12px; background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem;">
                          <span style="color: #64748B;">🌐 No domain or hosting linked to this project yet.</span>
                          <button type="button" class="btn btn-outline-primary btn-xs" style="font-size: 0.7rem; padding: 2px 8px; font-weight: 700;" onclick="window.openAddDomainForClient('${client.id}', '${p.id}')">
                            + Link Domain
                          </button>
                        </div>
                      `;
                    }
                    return `
                      <div style="margin-top: 10px; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; background: #FFFFFF;">
                        <div style="background: #F1F5F9; padding: 6px 12px; font-weight: 700; font-size: 0.72rem; color: #475569; display: flex; align-items: center; justify-content: space-between;">
                          <span>🌐 Linked Project Domains & Web Infrastructure (${projectDomains.length})</span>
                          <button type="button" class="btn btn-ghost btn-xs text-primary" style="font-size: 0.7rem; padding: 0 4px; font-weight: 700;" onclick="window.openAddDomainForClient('${client.id}', '${p.id}')">
                            + Add Another Domain
                          </button>
                        </div>
                        <div class="table-container">
                          <table class="table wp-table mb-0" style="font-size: 0.75rem;">
                            <thead style="background: #F8FAFC;">
                              <tr>
                                <th>Domain Name</th>
                                <th>Hosting Provider</th>
                                <th>Registration Date</th>
                                <th>Expiry Date</th>
                                <th style="text-align: right;">Renewal Amount</th>
                                <th style="text-align: center;">Status</th>
                                <th style="text-align: right;">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${projectDomains.map(d => {
                                const st = d.computedStatus || d.status || 'Active';
                                const badgeClass = st === 'Active' ? 'domain-status-active' : (st === 'Expiring Soon' ? 'domain-status-expiring' : 'domain-status-expired');
                                return `
                                  <tr>
                                    <td>
                                      <a href="https://${escapeHtml(d.domainName)}" target="_blank" rel="noopener noreferrer" style="font-weight: 700; color: var(--royal-blue); text-decoration: none;">
                                        ${escapeHtml(d.domainName)} ↗
                                      </a>
                                      <div style="font-size: 0.68rem; color: #64748B;">${escapeHtml(d.registrar || 'Namecheap')}</div>
                                    </td>
                                    <td>
                                      <div style="font-weight: 600; color: #1E293B;">${escapeHtml(d.hostingProvider || 'AWS Cloud')}</div>
                                      <div style="font-size: 0.68rem; color: #64748B;">${escapeHtml(d.hostingPlan || 'Standard')}</div>
                                    </td>
                                    <td>
                                      <span>${WorkPulseDB.formatDisplayDate(d.registrationDate) || '—'}</span>
                                    </td>
                                    <td>
                                      <div style="font-weight: 700;">📅 ${WorkPulseDB.formatDisplayDate(d.expiryDate) || 'N/A'}</div>
                                      <div style="font-size: 0.68rem; color: ${d.daysRemaining <= 30 ? '#DC2626' : '#64748B'}; font-weight: 600;">
                                        ${d.statusLabel || ''}
                                      </div>
                                    </td>
                                    <td style="text-align: right; font-weight: 700;">
                                      ${escapeHtml(d.currency || 'USD')} ${(Number(d.renewalCost) || 0).toLocaleString()}
                                    </td>
                                    <td style="text-align: center;">
                                      <span class="domain-status-badge ${badgeClass}" style="font-size: 0.68rem; padding: 2px 6px;">${st}</span>
                                    </td>
                                    <td style="text-align: right;">
                                      <div class="d-flex align-items-center justify-content-end gap-1">
                                        <button type="button" class="btn btn-outline-secondary btn-sm p-1" onclick="window.viewDomainDetails('${d.id}')" title="View Full Technical Dossier">
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                        </button>
                                        <button type="button" class="btn btn-outline-primary btn-sm p-1" onclick="window.openEditDomainModal('${d.id}')" title="Edit Domain & Hosting">
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                        </button>
                                        <button type="button" class="btn btn-outline-danger btn-sm p-1" onclick="window.deleteDomainRecord('${d.id}')" title="Delete Domain">
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                `;
                              }).join('')}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    `;
                  })()}
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  window.switchClientProfileTab = function(clientId, tabName) {
    clientActiveTab = tabName;
    openClientProfileModal(clientId, tabName);
  };

  window.submitClientNote = function(clientId) {
    const input = document.getElementById('cprof-input-note');
    const text = (input?.value || '').trim();
    if (!text) {
      showToast('Please enter a note before submitting.', 'warning');
      return;
    }

    WorkPulseDB.addClientNote(clientId, text, 'Admin');
    showToast('Note added to client profile.', 'success');
    openClientProfileModal(clientId, 'notes');
  };

  window.closeClientProfile = function() {
    activeClientProfileId = null;
    try {
      localStorage.removeItem('workpulse_admin_last_client_id');
    } catch (e) {}
    document.getElementById('client-profile-modal')?.classList.remove('open');
    switchView('clients');
  };

  function closeClientProfileModal() {
    window.closeClientProfile();
  }

  // --------------------------------------------------------------------------
  // CLIENT MODAL HANDLERS (ADD & EDIT)
  // --------------------------------------------------------------------------
  function showClientFormError(message) {
    const errorEl = document.getElementById('client-form-error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  }

  function hideClientFormError() {
    const errorEl = document.getElementById('client-form-error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  }

  function resetClientForm() {
    const form = document.getElementById('client-form');
    if (form) form.reset();

    const editIdInput = document.getElementById('client-edit-id');
    if (editIdInput) editIdInput.value = '';

    const nameInput = document.getElementById('client-input-name');
    if (nameInput) nameInput.value = '';

    const compInput = document.getElementById('client-input-company');
    if (compInput) compInput.value = '';

    const phoneInput = document.getElementById('client-input-phone');
    if (phoneInput) phoneInput.value = '';

    const emailInput = document.getElementById('client-input-email');
    if (emailInput) emailInput.value = '';

    const addrInput = document.getElementById('client-input-address');
    if (addrInput) addrInput.value = '';

    const projNameInput = document.getElementById('client-input-proj-name');
    if (projNameInput) projNameInput.value = '';

    const projServInput = document.getElementById('client-input-proj-service');
    if (projServInput) projServInput.value = 'Enterprise Software';

    const projAmtInput = document.getElementById('client-input-proj-amount');
    if (projAmtInput) projAmtInput.value = '';

    const projAdvInput = document.getElementById('client-input-proj-advance');
    if (projAdvInput) projAdvInput.value = '';

    const projStaffInput = document.getElementById('client-input-proj-staff');
    if (projStaffInput) projStaffInput.value = '';

    const projDescInput = document.getElementById('client-input-proj-desc');
    if (projDescInput) projDescInput.value = '';

    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    const startInput = document.getElementById('client-input-proj-start');
    if (startInput) startInput.value = today;

    const dueInput = document.getElementById('client-input-proj-due');
    if (dueInput) dueInput.value = nextMonth;

    const statusInput = document.getElementById('client-input-proj-status');
    if (statusInput) statusInput.value = 'Planning';

    const progInput = document.getElementById('client-input-proj-progress');
    if (progInput) progInput.value = '0';

    const modal = document.getElementById('client-modal');
    if (modal) {
      modal.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    }

    hideClientFormError();
  }

  function openAddClientModal() {
    populateClientStaffDropdowns();
    const modal = document.getElementById('client-modal');
    if (!modal) return;

    resetClientForm();
    document.getElementById('client-modal-title').textContent = 'Add New Client';
    const projSection = document.getElementById('client-initial-project-section');
    if (projSection) projSection.style.display = 'block';

    const btnSave = document.getElementById('btn-save-client');
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.dataset.submitting = 'false';
      btnSave.textContent = 'Save Client Account';
    }
    isSavingClient = false;

    modal.classList.add('open');
  }

  function openEditClientModal(id) {
    populateClientStaffDropdowns();
    const client = WorkPulseDB.getClientById(id);
    if (!client) {
      showToast('Client account not found.', 'error');
      return;
    }

    const modal = document.getElementById('client-modal');
    if (!modal) return;

    resetClientForm();
    document.getElementById('client-edit-id').value = client.id;
    document.getElementById('client-modal-title').textContent = `Edit Client: ${client.name}`;
    document.getElementById('client-input-name').value = client.name || '';
    document.getElementById('client-input-company').value = client.company || '';
    document.getElementById('client-input-phone').value = client.phone || '';
    document.getElementById('client-input-email').value = client.email || '';
    document.getElementById('client-input-address').value = client.address || '';

    // Hide initial project section when editing basic profile
    const projSection = document.getElementById('client-initial-project-section');
    if (projSection) projSection.style.display = 'none';

    const btnSave = document.getElementById('btn-save-client');
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.dataset.submitting = 'false';
      btnSave.textContent = 'Save Changes';
    }
    isSavingClient = false;

    modal.classList.add('open');
  }

  function closeClientModal() {
    const modal = document.getElementById('client-modal');
    if (modal) modal.classList.remove('open');
    hideClientFormError();
    const btnSave = document.getElementById('btn-save-client');
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.dataset.submitting = 'false';
      btnSave.textContent = document.getElementById('client-edit-id')?.value ? 'Save Changes' : 'Save Client Account';
    }
    isSavingClient = false;
  }

  // --------------------------------------------------------------------------
  // CLIENT PROJECT MODAL HANDLERS (MULTI-PROJECT MANAGEMENT)
  // --------------------------------------------------------------------------
  function openAddClientProjectModal(clientId) {
    populateClientStaffDropdowns();
    const client = WorkPulseDB.getClientById(clientId);
    if (!client) return;

    const modal = document.getElementById('client-project-modal');
    const form = document.getElementById('client-project-form');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('cproj-client-id').value = clientId;
    document.getElementById('cproj-edit-id').value = '';
    document.getElementById('client-project-modal-title').textContent = `Assign Project to ${client.name}`;

    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0];
    document.getElementById('cproj-input-start').value = today;
    document.getElementById('cproj-input-due').value = nextMonth;
    document.getElementById('cproj-input-status').value = 'In Progress';
    document.getElementById('cproj-input-progress').value = '0';
    document.getElementById('cproj-input-advance').value = '';

    // Reset linked domain fields
    const domInp = document.getElementById('cproj-input-domain');
    const hostInp = document.getElementById('cproj-input-host');
    const regInp = document.getElementById('cproj-input-regdate');
    const expInp = document.getElementById('cproj-input-expdate');
    const renInp = document.getElementById('cproj-input-renewal');
    if (domInp) domInp.value = '';
    if (hostInp) hostInp.value = 'AWS Route 53 / EC2';
    if (regInp) regInp.value = today;
    if (expInp) expInp.value = nextYear;
    if (renInp) renInp.value = '';

    modal.classList.add('open');
  }

  function openEditClientProjectModal(clientId, projectId) {
    populateClientStaffDropdowns();
    const client = WorkPulseDB.getClientById(clientId);
    if (!client) return;
    const project = (client.projects || []).find(p => p.id === projectId);
    if (!project) return;

    const modal = document.getElementById('client-project-modal');
    const form = document.getElementById('client-project-form');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('cproj-client-id').value = clientId;
    document.getElementById('cproj-edit-id').value = projectId;
    document.getElementById('client-project-modal-title').textContent = `Edit Project: ${project.name}`;

    document.getElementById('cproj-input-name').value = project.name || '';
    document.getElementById('cproj-input-service').value = project.serviceType || 'Enterprise Software';
    document.getElementById('cproj-input-desc').value = project.description || '';
    document.getElementById('cproj-input-amount').value = project.amount || 0;
    document.getElementById('cproj-input-advance').value = project.advancePaid || 0;
    document.getElementById('cproj-input-staff').value = project.assignedStaff || project.assignedStaffId || '';
    document.getElementById('cproj-input-start').value = project.startDate || '';
    document.getElementById('cproj-input-due').value = project.dueDate || '';
    document.getElementById('cproj-input-status').value = project.status || project.projectStatus || 'In Progress';
    document.getElementById('cproj-input-progress').value = project.progress || 0;

    // Prefill linked domain fields if domain exists for this project
    const allDomains = (typeof WorkPulseDB.getDomains === 'function') ? WorkPulseDB.getDomains({ clientId, projectId }) : [];
    const linkedDomain = allDomains.find(d => d.projectId === projectId);
    const domInp = document.getElementById('cproj-input-domain');
    const hostInp = document.getElementById('cproj-input-host');
    const regInp = document.getElementById('cproj-input-regdate');
    const expInp = document.getElementById('cproj-input-expdate');
    const renInp = document.getElementById('cproj-input-renewal');
    if (domInp) domInp.value = linkedDomain ? (linkedDomain.domainName || '') : '';
    if (hostInp) hostInp.value = linkedDomain ? (linkedDomain.hostingProvider || 'AWS Route 53 / EC2') : 'AWS Route 53 / EC2';
    if (regInp) regInp.value = linkedDomain ? (linkedDomain.registrationDate || '') : '';
    if (expInp) expInp.value = linkedDomain ? (linkedDomain.expiryDate || '') : '';
    if (renInp) renInp.value = linkedDomain ? (linkedDomain.renewalCost || '') : '';

    modal.classList.add('open');
  }

  function closeClientProjectModal() {
    document.getElementById('client-project-modal')?.classList.remove('open');
  }

  // --------------------------------------------------------------------------
  // PAYMENT MODAL HANDLERS (RECORD PAYMENT INSTALLMENTS)
  // --------------------------------------------------------------------------
  async function openRecordPaymentModal(clientId, projectId = null) {
    const client = WorkPulseDB.getClientById(clientId);
    if (!client) {
      showToast('Client not found.', 'error');
      return;
    }

    let projects = Array.isArray(client.projects) ? client.projects : [];
    if (projects.length === 0) {
      // Auto-provision initial deliverable project if client currently has none
      const defaultProj = {
        name: `${client.name || 'Client'} Deliverables & Services`,
        serviceType: 'Enterprise Software',
        description: 'Primary project deliverables & service contract scope',
        amount: 0,
        advancePaid: 0,
        status: 'In Progress',
        progress: 10,
        startDate: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
      };
      try {
        const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/projects`, {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders ? WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }) : { 'Content-Type': 'application/json' },
          body: JSON.stringify(defaultProj)
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data && json.data.id) {
            projects = [json.data];
            client.projects = projects;
          } else if (json.client && Array.isArray(json.client.projects)) {
            projects = json.client.projects;
            client.projects = projects;
          }
        }
      } catch (e) {
        console.warn('Auto-provisioning client project failed:', e);
      }
      if (projects.length === 0) {
        const localRes = WorkPulseDB.addClientProject(clientId, defaultProj, 'Admin');
        if (localRes && localRes.project) {
          projects = [localRes.project];
          client.projects = projects;
        }
      }
    }

    const modal = document.getElementById('client-payment-modal');
    const form = document.getElementById('client-payment-form');
    const projSelect = document.getElementById('cpay-input-project');
    if (!modal || !form || !projSelect) return;

    form.reset();
    document.getElementById('cpay-client-id').value = clientId;

    // Reset button state
    const btnSave = document.getElementById('btn-save-client-payment');
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = 'Record Payment';
    }

    // Populate projects dropdown
    projSelect.innerHTML = projects.map(p => {
      const pTotal = Number(p.amount) || 0;
      const pAdv = Number(p.advancePaid) || 0;
      const pAdd = Array.isArray(p.additionalPayments) ? p.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
      const pDue = Math.max(0, pTotal - (pAdv + pAdd));
      return `<option value="${p.id}" ${p.id === projectId ? 'selected' : ''}>${escapeHtml(p.name)} (${pTotal.toLocaleString()} &bull; Due: ${pDue.toLocaleString()})</option>`;
    }).join('');

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('cpay-input-date').value = today;

    // Pre-fill amount with balance due of target project if available
    const targetProj = (projectId ? projects.find(p => p.id === projectId) : null) || projects[0];
    if (targetProj) {
      const pTotal = Number(targetProj.amount) || 0;
      const pAdv = Number(targetProj.advancePaid) || 0;
      const pAdd = Array.isArray(targetProj.additionalPayments) ? targetProj.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
      const pDue = Math.max(0, pTotal - (pAdv + pAdd));
      if (pDue > 0) document.getElementById('cpay-input-amount').value = pDue;
    }

    modal.classList.add('open');
  }

  function closeClientPaymentModal() {
    document.getElementById('client-payment-modal')?.classList.remove('open');
  }

  function confirmDeleteClient(id, name) {
    if (confirm(`Are you sure you want to delete client "${name}" and all attached projects and payments? This action cannot be undone.`)) {
      WorkPulseDB.deleteClient(id, 'Admin');
      showToast(`Client "${name}" deleted successfully.`, 'success');
      renderClients();
      if (activeClientProfileId === id) closeClientProfileModal();
    }
  }

  function confirmDeleteClientProject(clientId, projectId, projName) {
    if (confirm(`Are you sure you want to delete project "${projName}"?`)) {
      WorkPulseDB.deleteClientProject(clientId, projectId, 'Admin');
      showToast(`Project "${projName}" deleted.`, 'success');
      renderClients();
      if (activeClientProfileId === clientId) openClientProfileModal(clientId, 'projects');
    }
  }

  // Export Clients to CSV
  function exportClientsCsv() {
    const clients = WorkPulseDB.getClients();
    if (!clients || clients.length === 0) {
      showToast('No client records to export.', 'warning');
      return;
    }

    const rows = [
      ['Client ID', 'Client Name', 'Company', 'Phone', 'Email', 'Address', 'Project Name', 'Service Type', 'Project Description', 'Amount', 'Advance Paid', 'Balance Due', 'Assigned Staff', 'Start Date', 'Due Date', 'Payment Status', 'Project Status', 'Progress %']
    ];

    clients.forEach(c => {
      const projects = Array.isArray(c.projects) && c.projects.length > 0 ? c.projects : [{}];
      projects.forEach(p => {
        const pTotal = Number(p.amount) || 0;
        const pAdv = Number(p.advancePaid) || 0;
        const pAdd = Array.isArray(p.additionalPayments) ? p.additionalPayments.reduce((s, a) => s + (Number(a.amount) || 0), 0) : 0;
        const pDue = Math.max(0, pTotal - (pAdv + pAdd));

        rows.push([
          c.id || '',
          c.name || '',
          c.company || '',
          c.phone || '',
          c.email || '',
          (c.address || '').replace(/[\r\n]+/g, ' '),
          p.name || '',
          p.serviceType || '',
          (p.description || '').replace(/[\r\n]+/g, ' '),
          pTotal,
          pAdv,
          pDue,
          p.assignedStaff || '',
          p.startDate || '',
          p.dueDate || '',
          p.paymentStatus || '',
          p.status || p.projectStatus || '',
          p.progress !== undefined ? p.progress : ''
        ]);
      });
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `WorkPulse_Clients_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Client records exported to CSV.', 'success');
  }

  // --------------------------------------------------------------------------
  // LEAD MANAGEMENT CONTROLLER
  // --------------------------------------------------------------------------
  function populateTelecallerDropdowns() {
    const staffList = WorkPulseDB.getStaffList();
    const filterSelect = document.getElementById('lead-filter-telecaller');
    const inputSelect = document.getElementById('lead-input-telecaller');

    if (filterSelect) {
      const currentVal = filterSelect.value;
      filterSelect.innerHTML = `<option value="all">All Telecallers</option>` + staffList.map(s => `
        <option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.position || s.department || 'Staff')})</option>
      `).join('');
      filterSelect.value = currentVal || 'all';
    }

    if (inputSelect) {
      const currentVal = inputSelect.value;
      inputSelect.innerHTML = `<option value="">Select Telecaller Staff</option>` + staffList.map(s => `
        <option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.position || s.department || 'Staff')})</option>
      `).join('');
      inputSelect.value = currentVal || '';
    }
  }

  function renderLeads() {
    populateTelecallerDropdowns();

    // Filters
    const search = (document.getElementById('lead-search-input')?.value || '').trim();
    const status = document.getElementById('lead-filter-status')?.value || 'all';
    const service = document.getElementById('lead-filter-service')?.value || 'all';
    const telecallerId = document.getElementById('lead-filter-telecaller')?.value || 'all';
    const timeframe = document.getElementById('lead-filter-timeframe')?.value || 'all';
    const sortVal = document.getElementById('lead-sort-select')?.value || 'newest';

    // Summary KPIs (6 Summary Cards)
    const summary = WorkPulseDB.getLeadSummary();
    const kpiTotal = document.getElementById('lead-kpi-total-leads');
    const kpiPipelineVal = document.getElementById('lead-kpi-pipeline-value');
    const kpiNew = document.getElementById('lead-kpi-new-leads');
    const kpiToday = document.getElementById('lead-kpi-today-followups');
    const kpiOverdue = document.getElementById('lead-kpi-overdue');
    const kpiConverted = document.getElementById('lead-kpi-converted-leads');
    const kpiConvertedCount = document.getElementById('lead-kpi-converted-count');
    const kpiLost = document.getElementById('lead-kpi-lost-leads');

    if (kpiTotal) kpiTotal.textContent = summary.totalLeads;
    if (kpiPipelineVal) kpiPipelineVal.textContent = `${(summary.pipelineValue || 0).toLocaleString()} estimated pipeline`;
    if (kpiNew) kpiNew.textContent = summary.newLeads;
    if (kpiToday) kpiToday.textContent = summary.followUpsToday;
    if (kpiOverdue) {
      kpiOverdue.textContent = summary.overdueFollowUps;
      if (summary.overdueFollowUps > 0) {
        kpiOverdue.style.animation = 'pulse-overdue 2s infinite';
      } else {
        kpiOverdue.style.animation = 'none';
      }
    }
    if (kpiConverted) kpiConverted.textContent = summary.convertedLeads;
    if (kpiConvertedCount) kpiConvertedCount.textContent = `${summary.convertedLeads} won (${summary.conversionRate}%)`;
    if (kpiLost) kpiLost.textContent = summary.lostLeads;

    // Filtered Leads
    const leads = WorkPulseDB.getLeads({ search, status, service, telecallerId, timeframe });

    // Sorting
    const sortedLeads = [...leads];
    if (sortVal === 'newest') {
      sortedLeads.sort((a, b) => new Date(b.createdDate || b.createdAt || 0) - new Date(a.createdDate || a.createdAt || 0));
    } else if (sortVal === 'name-asc') {
      sortedLeads.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortVal === 'name-desc') {
      sortedLeads.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    } else if (sortVal === 'company-asc') {
      sortedLeads.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
    } else if (sortVal === 'amount-desc') {
      sortedLeads.sort((a, b) => (Number(b.expectedAmount) || 0) - (Number(a.expectedAmount) || 0));
    } else if (sortVal === 'amount-asc') {
      sortedLeads.sort((a, b) => (Number(a.expectedAmount) || 0) - (Number(b.expectedAmount) || 0));
    } else if (sortVal === 'followup-asc') {
      sortedLeads.sort((a, b) => (a.followUpDate || '9999-99-99').localeCompare(b.followUpDate || '9999-99-99'));
    }

    const countBadge = document.getElementById('lead-results-count');
    if (countBadge) countBadge.textContent = `${sortedLeads.length} Lead${sortedLeads.length === 1 ? '' : 's'}`;

    // Render depending on current active view mode
    const kanbanContainer = document.getElementById('lead-kanban-board-container');
    const tableContainer = document.getElementById('lead-table-view-container');

    if (currentLeadView === 'kanban') {
      if (kanbanContainer) kanbanContainer.style.display = 'flex';
      if (tableContainer) tableContainer.style.display = 'none';
      renderLeadKanban(sortedLeads);
    } else {
      if (kanbanContainer) kanbanContainer.style.display = 'none';
      if (tableContainer) tableContainer.style.display = 'block';
      renderLeadTable(sortedLeads);
    }
  }

  // Kanban View Renderer
  function renderLeadKanban(leads) {
    const container = document.getElementById('lead-kanban-board-container');
    if (!container) return;

    const columns = [
      { key: 'New', title: 'New Leads', color: '#3B82F6', border: '#BFDBFE' },
      { key: 'Contacted', title: 'Contacted', color: '#6366F1', border: '#C7D2FE' },
      { key: 'Follow-up', title: 'In Follow-up', color: '#F59E0B', border: '#FDE68A' },
      { key: 'Interested', title: 'Interested', color: '#8B5CF6', border: '#DDD6FE' },
      { key: 'Converted', title: 'Converted', color: '#10B981', border: '#A7F3D0' },
      { key: 'Lost', title: 'Lost / Closed', color: '#64748B', border: '#CBD5E1' }
    ];

    const todayStr = new Date().toISOString().split('T')[0];

    container.innerHTML = columns.map(col => {
      const colLeads = leads.filter(l => (l.status || 'New') === col.key);
      const colValue = colLeads.reduce((acc, l) => acc + (Number(l.expectedAmount) || 0), 0);

      const cardsHtml = colLeads.length === 0 
        ? `<div style="text-align:center; padding: 28px 12px; color: #94A3B8; font-size: 0.76rem; border: 1px dashed #CBD5E1; border-radius: 8px;">No leads in ${col.key}</div>`
        : colLeads.map(lead => {
            const isDueToday = lead.followUpDate && lead.followUpDate === todayStr && lead.status !== 'Converted' && lead.status !== 'Lost';
            const isOverdue = lead.followUpDate && lead.followUpDate < todayStr && lead.status !== 'Converted' && lead.status !== 'Lost';
            const isUpcoming = lead.followUpDate && lead.followUpDate > todayStr && lead.status !== 'Converted' && lead.status !== 'Lost';
            const telecallerInitials = getInitials(lead.assignedStaffName || 'Telecaller');

            return `
              <div class="lead-card" draggable="true" data-lead-id="${lead.id}" style="background: #FFFFFF; border-radius: 8px; border: 1px solid #E2E8F0; padding: 12px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); cursor: grab; transition: transform 0.15s, box-shadow 0.15s;">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                  <div>
                    <h4 style="font-size: 0.86rem; font-weight: 700; color: var(--navy-dark); margin: 0 0 2px 0;">
                      <a href="javascript:void(0)" onclick="window.openLeadNotesModal('${lead.id}')" style="color: inherit; text-decoration: none;">${escapeHtml(lead.name)}</a>
                    </h4>
                    <div style="font-size: 0.74rem; font-weight: 600; color: var(--royal-blue);">${escapeHtml(lead.company)}</div>
                  </div>
                  <span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.68rem;">${escapeHtml(lead.source || 'Website')}</span>
                </div>

                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem; margin-bottom: 8px; background: #F8FAFC; padding: 4px 8px; border-radius: 4px;">
                  <span style="color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;" title="${escapeHtml(lead.interestedService || lead.service || 'General')}">🎯 ${escapeHtml(lead.interestedService || lead.service || 'General')}</span>
                  <span style="font-weight: 700; color: var(--navy-dark);">${(Number(lead.expectedAmount) || 0).toLocaleString()}</span>
                </div>

                <!-- Follow-up Alert Indicator -->
                <div style="margin-bottom: 8px;">
                  ${isDueToday ? `
                    <div style="display: inline-flex; align-items: center; gap: 4px; background: #FEF3C7; color: #D97706; border: 1px solid #FDE68A; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">
                      <span>📅 Due Today ${lead.followUpTime || ''}</span>
                    </div>
                  ` : isOverdue ? `
                    <div class="lead-overdue-badge" style="display: inline-flex; align-items: center; gap: 4px; background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700;">
                      <span>⚠️ Overdue: ${lead.followUpDate}</span>
                    </div>
                  ` : isUpcoming ? `
                    <div style="display: inline-flex; align-items: center; gap: 4px; background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; padding: 2px 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 600;">
                      <span>📅 Next: ${lead.followUpDate} ${lead.followUpTime || ''}</span>
                    </div>
                  ` : `
                    <div style="font-size: 0.68rem; color: #94A3B8;">Follow-up: None</div>
                  `}
                </div>

                ${lead.nextAction ? `
                  <div style="font-size: 0.72rem; color: #475569; margin-bottom: 8px; background: #F8FAFC; padding: 3px 6px; border-radius: 4px; line-height: 1.3;">
                    <strong>Next:</strong> ${escapeHtml(lead.nextAction)}
                  </div>
                ` : ''}

                <!-- Telecaller Assignment & Actions Footer -->
                <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #F1F5F9; padding-top: 8px; font-size: 0.72rem;">
                  <div style="display: flex; align-items: center; gap: 6px;" title="Assigned Telecaller: ${escapeHtml(lead.assignedStaffName || 'Unassigned')}">
                    <div style="width: 22px; height: 22px; border-radius: 50%; background: #071A2B; color: #FFFFFF; font-size: 0.65rem; font-weight: 700; display: flex; align-items: center; justify-content: center;">
                      ${telecallerInitials}
                    </div>
                    <span style="color: #475569; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(lead.assignedStaffName || 'Telecaller')}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <button class="btn btn-ghost btn-sm" style="padding: 2px 6px; color: var(--royal-blue);" onclick="window.openLeadNotesModal('${lead.id}')" title="Call Logs & Notes">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm" style="padding: 2px 6px; color: #64748B;" onclick="window.openEditLeadModal('${lead.id}')" title="Edit Lead">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    ${lead.status !== 'Converted' ? `
                      <button class="btn btn-ghost btn-sm" style="padding: 2px 6px; color: #059669;" onclick="window.convertLeadToClient('${lead.id}')" title="Convert to Client">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                      </button>
                    ` : ''}
                    <button class="btn btn-ghost btn-sm" style="padding: 2px 6px; color: #DC2626;" onclick="window.confirmDeleteLead('${lead.id}', '${escapeHtml(lead.name)}')" title="Delete Lead">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </div>
              </div>
            `;
          }).join('');

      return `
        <div class="lead-kanban-column" data-status="${col.key}" style="flex: 1; min-width: 260px; max-width: 320px; background: #F1F5F9; border-radius: 10px; border-top: 3px solid ${col.color}; padding: 12px; display: flex; flex-direction: column;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: ${col.color};"></span>
              <span style="font-weight: 700; color: var(--navy-dark); font-size: 0.85rem;">${col.title}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="badge" style="background: #E2E8F0; color: #334155; font-size: 0.7rem; font-weight: 700;">${colLeads.length}</span>
              <span style="font-size: 0.7rem; font-weight: 700; color: #64748B;">${colValue.toLocaleString()}</span>
            </div>
          </div>
          <div class="lead-kanban-dropzone" data-status="${col.key}" style="flex: 1; min-height: 250px;">
            ${cardsHtml}
          </div>
        </div>
      `;
    }).join('');

    // Attach HTML5 Drag-and-Drop Listeners
    initKanbanDragAndDrop();
  }

  function initKanbanDragAndDrop() {
    const cards = document.querySelectorAll('.lead-card');
    const dropzones = document.querySelectorAll('.lead-kanban-dropzone');

    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.leadId);
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });
    });

    dropzones.forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');
      });

      zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
      });

      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const leadId = e.dataTransfer.getData('text/plain');
        const targetStatus = zone.dataset.status;

        if (leadId && targetStatus) {
          const lead = WorkPulseDB.getLeadById(leadId);
          if (lead && lead.status !== targetStatus) {
            WorkPulseDB.updateLeadStatus(leadId, targetStatus, 'Admin');
            showToast(`Lead moved to "${targetStatus}".`, 'success');
            renderLeads();

            fetch(`/api/leads/${encodeURIComponent(leadId)}/status`, {
              method: 'PATCH',
              headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ status: targetStatus })
            }).catch(err => console.warn('Failed to sync lead status to server:', err));
          }
        }
      });
    });
  }

  // Table View Renderer with Pagination
  function renderLeadTable(leads) {
    const tbody = document.getElementById('lead-table-tbody');
    if (!tbody) return;

    if (leads.length === 0) {
      tbody.innerHTML = renderEmptyTableState(8, 'No Leads Found', 'No prospective leads match your current query.');
      renderLeadPagination(0, 1, 0, 0);
      return;
    }

    const totalItems = leads.length;
    const totalPages = Math.ceil(totalItems / leadPageSize) || 1;
    if (leadCurrentPage > totalPages) leadCurrentPage = totalPages;
    if (leadCurrentPage < 1) leadCurrentPage = 1;

    const startIdx = (leadCurrentPage - 1) * leadPageSize;
    const endIdx = Math.min(startIdx + leadPageSize, totalItems);
    const pageLeads = leads.slice(startIdx, endIdx);

    const todayStr = new Date().toISOString().split('T')[0];

    tbody.innerHTML = pageLeads.map(lead => {
      const isDueToday = lead.followUpDate && lead.followUpDate === todayStr && lead.status !== 'Converted' && lead.status !== 'Lost';
      const isOverdue = lead.followUpDate && lead.followUpDate < todayStr && lead.status !== 'Converted' && lead.status !== 'Lost';
      const isUpcoming = lead.followUpDate && lead.followUpDate > todayStr && lead.status !== 'Converted' && lead.status !== 'Lost';
      const initials = getInitials(lead.name || 'Lead');

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div class="lead-avatar-sm" style="background: var(--navy-dark); color: #FFFFFF; width: 34px; height: 34px; border-radius: 50%; font-size: 0.76rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                ${initials}
              </div>
              <div style="min-width: 0;">
                <a href="javascript:void(0)" class="lead-name-link" onclick="window.openLeadNotesModal('${lead.id}')" style="font-weight: 700; color: var(--navy-dark); font-size: 0.86rem; text-decoration: none;">
                  ${escapeHtml(lead.name)}
                </a>
                <div style="font-size: 0.74rem; color: var(--royal-blue); font-weight: 600;">${escapeHtml(lead.company)}</div>
                <div style="display: flex; align-items: center; gap: 5px; margin-top: 3px;">
                  <span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.65rem;">${escapeHtml(lead.source || 'Website')}</span>
                  <span style="font-size: 0.68rem; color: #94A3B8;">Created: ${WorkPulseDB.formatDisplayDate(lead.createdDate) || 'Recent'}</span>
                </div>
              </div>
            </div>
          </td>
          <td>
            <div style="font-size: 0.76rem; color: #334155; margin-bottom: 2px;">
              📞 <a href="tel:${escapeHtml(lead.phone)}" style="color: inherit; text-decoration: none; font-weight: 600;">${escapeHtml(lead.phone || 'N/A')}</a>
            </div>
            <div style="font-size: 0.74rem; color: #64748B;">
              ✉️ <a href="mailto:${escapeHtml(lead.email)}" style="color: inherit; text-decoration: none;">${escapeHtml(lead.email || 'N/A')}</a>
            </div>
          </td>
          <td>
            <div style="font-weight: 600; color: var(--navy-dark); font-size: 0.8rem;">${escapeHtml(lead.interestedService || lead.service || 'General')}</div>
            <span class="badge" style="background: #FFFBEB; color: #B45309; border: 1px solid #FDE68A; font-size: 0.7rem; font-weight: 700; margin-top: 2px;">
              ${escapeHtml(lead.interestedService || lead.service || 'General')}
            </span>
          </td>
          <td style="text-align: right;">
            <div style="font-size: 0.86rem; font-weight: 800; color: var(--navy-dark);">${(Number(lead.expectedAmount) || 0).toLocaleString()}</div>
            <div style="font-size: 0.68rem; color: #94A3B8;">Expected Value</div>
          </td>
          <td>
            <div style="font-weight: 600; color: #334155; font-size: 0.8rem;">${escapeHtml(lead.assignedStaffName || 'Unassigned')}</div>
            <div style="font-size: 0.7rem; color: #94A3B8;">${escapeHtml(lead.assignedStaffId || 'WP-STAFF')}</div>
          </td>
          <td>
            <div>
              ${isDueToday ? `
                <span class="badge badge-followup-today" style="background: #FEF3C7; color: #D97706; border: 1px solid #FDE68A; font-size: 0.7rem; font-weight: 700;">📅 Due Today: ${lead.followUpTime || '11:00'}</span>
              ` : isOverdue ? `
                <span class="badge badge-followup-overdue" style="background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; font-size: 0.7rem; font-weight: 700;">⚠️ Overdue: ${WorkPulseDB.formatDisplayDate(lead.followUpDate)}</span>
              ` : isUpcoming ? `
                <span class="badge badge-followup-upcoming" style="background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; font-size: 0.7rem;">📅 ${WorkPulseDB.formatDisplayDate(lead.followUpDate)} ${lead.followUpTime || ''}</span>
              ` : `
                <span class="badge badge-followup-none" style="background: #F1F5F9; color: #64748B; font-size: 0.7rem;">${WorkPulseDB.formatDisplayDate(lead.followUpDate) || 'None'}</span>
              `}
            </div>
            ${lead.nextAction ? `<div style="font-size: 0.72rem; color: #475569; margin-top: 4px; line-height: 1.3;"><strong>Next:</strong> ${escapeHtml(lead.nextAction)}</div>` : ''}
          </td>
          <td class="text-center">
            ${getLeadStatusBadge(lead.status)}
          </td>
          <td class="text-end" style="white-space: nowrap;">
            <button class="btn btn-ghost btn-sm" style="padding: 3px 6px; color: var(--royal-blue);" onclick="window.openLeadNotesModal('${lead.id}')" title="Call Logs & Profile">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            </button>
            <button class="btn btn-ghost btn-sm" style="padding: 3px 6px; color: #64748B;" onclick="window.openEditLeadModal('${lead.id}')" title="Edit Lead">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            ${lead.status !== 'Converted' ? `
              <button class="btn btn-ghost btn-sm" style="padding: 3px 6px; color: #059669;" onclick="window.convertLeadToClient('${lead.id}')" title="Convert to Client">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
              </button>
            ` : ''}
            <button class="btn btn-ghost btn-sm" style="padding: 3px 6px; color: #DC2626;" onclick="window.confirmDeleteLead('${lead.id}', '${escapeHtml(lead.name)}')" title="Delete Lead">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    renderLeadPagination(totalItems, totalPages, startIdx, endIdx);
  }

  function renderLeadPagination(totalItems, totalPages, startIdx, endIdx) {
    const info = document.getElementById('lead-pagination-info');
    const controls = document.getElementById('lead-pagination-buttons');
    if (info) {
      info.textContent = totalItems === 0
        ? 'Showing 0 to 0 of 0 leads'
        : `Showing ${startIdx + 1} to ${endIdx} of ${totalItems} leads`;
    }
    if (!controls) return;

    if (totalPages <= 1) {
      controls.innerHTML = '';
      return;
    }

    let buttonsHtml = `
      <button class="lead-page-btn" ${leadCurrentPage === 1 ? 'disabled' : ''} onclick="window.changeLeadPage(${leadCurrentPage - 1})">
        &lsaquo; Prev
      </button>
    `;

    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= leadCurrentPage - 1 && p <= leadCurrentPage + 1)) {
        buttonsHtml += `
          <button class="lead-page-btn ${p === leadCurrentPage ? 'active' : ''}" onclick="window.changeLeadPage(${p})">
            ${p}
          </button>
        `;
      } else if (p === leadCurrentPage - 2 || p === leadCurrentPage + 2) {
        buttonsHtml += `<span style="padding: 0 4px; color: #94A3B8;">...</span>`;
      }
    }

    buttonsHtml += `
      <button class="lead-page-btn" ${leadCurrentPage === totalPages ? 'disabled' : ''} onclick="window.changeLeadPage(${leadCurrentPage + 1})">
        Next &rsaquo;
      </button>
    `;

    controls.innerHTML = buttonsHtml;
  }

  window.changeLeadPage = function(page) {
    leadCurrentPage = page;
    renderLeads();
  };

  // Lead Modals
  function openAddLeadModal() {
    populateTelecallerDropdowns();
    const modal = document.getElementById('lead-modal');
    const form = document.getElementById('lead-form');
    if (!modal || !form) return;

    form.reset();
    modal.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    document.getElementById('lead-edit-id').value = '';
    document.getElementById('lead-modal-title').textContent = 'Add New Lead';
    document.getElementById('lead-initial-note-wrap').style.display = 'block';

    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const createdInput = document.getElementById('lead-input-created-date');
    if (createdInput) createdInput.value = today;
    document.getElementById('lead-input-followup-date').value = tomorrow;
    document.getElementById('lead-input-status').value = 'New';
    const nextActionInput = document.getElementById('lead-input-next-action');
    if (nextActionInput) nextActionInput.value = '';

    const saveBtn = document.getElementById('btn-save-lead');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.dataset.submitting = 'false';
      saveBtn.innerHTML = 'Save Lead';
    }

    modal.classList.add('open');
  }

  function openEditLeadModal(id) {
    populateTelecallerDropdowns();
    const lead = WorkPulseDB.getLeadById(id);
    if (!lead) {
      showToast('Lead record not found.', 'error');
      return;
    }

    const modal = document.getElementById('lead-modal');
    const form = document.getElementById('lead-form');
    if (!modal || !form) return;

    form.reset();
    modal.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    document.getElementById('lead-edit-id').value = lead.id;
    document.getElementById('lead-modal-title').textContent = `Edit Lead: ${lead.name}`;
    document.getElementById('lead-input-name').value = lead.name || '';
    document.getElementById('lead-input-company').value = lead.company || '';
    document.getElementById('lead-input-phone').value = lead.phone || '';
    document.getElementById('lead-input-email').value = lead.email || '';
    document.getElementById('lead-input-source').value = lead.source || 'Website';
    document.getElementById('lead-input-service').value = lead.interestedService || lead.service || '';
    document.getElementById('lead-input-amount').value = lead.expectedAmount || '';
    document.getElementById('lead-input-telecaller').value = lead.assignedStaffId || '';
    document.getElementById('lead-input-status').value = lead.status || 'New';
    const createdInput = document.getElementById('lead-input-created-date');
    if (createdInput) createdInput.value = lead.createdDate || '';
    document.getElementById('lead-input-followup-date').value = lead.followUpDate || '';
    document.getElementById('lead-input-followup-time').value = lead.followUpTime || '11:00';
    const nextActionInput = document.getElementById('lead-input-next-action');
    if (nextActionInput) nextActionInput.value = lead.nextAction || '';

    // Hide initial note wrap when editing existing lead
    document.getElementById('lead-initial-note-wrap').style.display = 'none';

    const saveBtn = document.getElementById('btn-save-lead');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.dataset.submitting = 'false';
      saveBtn.innerHTML = 'Update Lead';
    }

    modal.classList.add('open');
  }

  function closeLeadModal() {
    const modal = document.getElementById('lead-modal');
    modal?.classList.remove('open');
    modal?.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    const saveBtn = document.getElementById('btn-save-lead');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.dataset.submitting = 'false';
    }
  }

  // Lead Details & Follow-up History Modal
  function openLeadNotesModal(leadId) {
    activeLeadNotesId = leadId;
    const lead = WorkPulseDB.getLeadById(leadId);
    if (!lead) {
      showToast('Lead not found.', 'error');
      return;
    }

    const modal = document.getElementById('lead-notes-modal');
    const content = document.getElementById('lead-notes-modal-content');
    if (!modal || !content) return;

    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    const today = new Date().toISOString().split('T')[0];
    const isDueToday = lead.followUpDate && lead.followUpDate === today && lead.status !== 'Converted' && lead.status !== 'Lost';
    const isOverdue = lead.followUpDate && lead.followUpDate < today && lead.status !== 'Converted' && lead.status !== 'Lost';
    const isUpcoming = lead.followUpDate && lead.followUpDate > today && lead.status !== 'Converted' && lead.status !== 'Lost';
    const staffList = WorkPulseDB.getStaffList();

    content.innerHTML = `
      <!-- Lead Summary Header -->
      <div style="background: #F8FAFC; border: 1px solid var(--border-color); border-radius: 10px; padding: 18px; margin-bottom: 20px;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--navy-dark); margin: 0;">${escapeHtml(lead.name)}</h3>
              ${getLeadStatusBadge(lead.status)}
              ${isDueToday ? `<span class="badge badge-followup-today" style="background:#FEF3C7; color:#D97706; border:1px solid #FDE68A; font-size:0.68rem; font-weight:700;">DUE TODAY</span>` : ''}
              ${isOverdue ? `<span class="badge badge-followup-overdue" style="background:#FEF2F2; color:#DC2626; border:1px solid #FECACA; font-size:0.68rem; font-weight:700;">OVERDUE</span>` : ''}
              ${isUpcoming ? `<span class="badge badge-followup-upcoming" style="background:#ECFDF5; color:#059669; border:1px solid #A7F3D0; font-size:0.68rem; font-weight:700;">UPCOMING</span>` : ''}
            </div>
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--royal-blue); margin-top: 2px;">${escapeHtml(lead.company)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-secondary btn-sm" onclick="window.openEditLeadModal('${lead.id}')">
              ✏️ Edit Lead
            </button>
            ${lead.status !== 'Converted' ? `
              <button class="btn btn-primary btn-sm" onclick="window.convertLeadToClient('${lead.id}')" style="background: var(--gold-primary); color: #071A2B; border: none; font-weight: 700;">
                🌟 Convert to Client
              </button>
            ` : `
              <span class="badge" style="background: #ECFDF5; color: #047857; font-size: 0.75rem; padding: 6px 12px; font-weight: 700; border: 1px solid #A7F3D0;">
                ✓ Client Account Converted
              </span>
            `}
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 0.78rem; color: #475569; background: #FFFFFF; padding: 14px; border-radius: 8px; border: 1px solid #E2E8F0;">
          <div><strong>📞 Phone:</strong> <a href="tel:${escapeHtml(lead.phone)}" style="color: var(--royal-blue); font-weight: 600;">${escapeHtml(lead.phone || 'N/A')}</a></div>
          <div><strong>✉️ Email:</strong> <a href="mailto:${escapeHtml(lead.email)}" style="color: var(--royal-blue); font-weight: 600;">${escapeHtml(lead.email || 'N/A')}</a></div>
          <div><strong>🎯 Service:</strong> ${escapeHtml(lead.interestedService || lead.service || 'General')}</div>
          <div><strong>💰 Expected Pipeline:</strong> <span style="font-weight: 700; color: var(--navy-dark);">${(Number(lead.expectedAmount) || 0).toLocaleString()}</span></div>
          <div><strong>🏷️ Lead Source:</strong> ${escapeHtml(lead.source || 'Website')}</div>
          <div><strong>📅 Created Date:</strong> ${WorkPulseDB.formatDisplayDate(lead.createdDate) || 'Recent'}</div>
          <div><strong>📅 Next Follow-up:</strong> ${WorkPulseDB.formatDisplayDate(lead.followUpDate) || 'None'} ${lead.followUpTime || ''}</div>
          <div><strong>🎯 Next Action:</strong> <span style="color: #0F172A; font-weight: 600;">${escapeHtml(lead.nextAction || 'None specified')}</span></div>
        </div>

        <!-- Telecaller Quick Reassignment Row -->
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.76rem; font-weight: 700; color: var(--navy-dark);">Assigned Telecaller Staff:</span>
            <span style="font-size: 0.76rem; color: #334155; font-weight: 600;">${escapeHtml(lead.assignedStaffName || 'Unassigned')}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <label for="lead-profile-reassign-select" style="font-size: 0.74rem; color: #64748B; margin: 0;">Reassign:</label>
            <select id="lead-profile-reassign-select" class="form-control form-control-sm" style="width: 200px; font-size: 0.75rem;" onchange="window.reassignLeadTelecaller('${lead.id}', this.value)">
              <option value="">Choose Staff...</option>
              ${staffList.map(s => `
                <option value="${s.id}" ${s.id === lead.assignedStaffId ? 'selected' : ''}>
                  ${escapeHtml(s.name)} (${escapeHtml(s.position || 'Staff')})
                </option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Add New Follow-up Note Form -->
      <div class="card p-3 mb-4" style="border: 1px solid #E2E8F0; background: #FFFFFF; border-radius: 8px;">
        <h4 style="font-size: 0.85rem; font-weight: 700; color: var(--navy-dark); margin-bottom: 10px;">
          Log Telecaller Call / Discussion Details & Schedule Follow-up
        </h4>
        <form id="lead-new-note-form">
          <div class="mb-3">
            <label class="form-label" style="font-size: 0.72rem; margin-bottom: 2px;">Discussion Details / Notes <span class="text-danger">*</span></label>
            <textarea class="form-control" id="lead-note-text" rows="2" required placeholder="Enter conversation details, client requirements, discussion recap, feedback..."></textarea>
          </div>
          <div class="row g-2 align-items-center mb-2">
            <div class="col-md-6">
              <label class="form-label" style="font-size: 0.72rem; margin-bottom: 2px;">Next Action / Milestone</label>
              <input type="text" class="form-control form-control-sm" id="lead-note-next-action" placeholder="e.g., Send pricing proposal, conduct tech demo" value="${escapeHtml(lead.nextAction || '')}">
            </div>
            <div class="col-md-3">
              <label class="form-label" style="font-size: 0.72rem; margin-bottom: 2px;">Next Follow-up Date</label>
              <input type="date" class="form-control form-control-sm" id="lead-note-next-date" value="${lead.followUpDate || ''}">
            </div>
            <div class="col-md-3">
              <label class="form-label" style="font-size: 0.72rem; margin-bottom: 2px;">Time</label>
              <input type="time" class="form-control form-control-sm" id="lead-note-next-time" value="${lead.followUpTime || '11:00'}">
            </div>
          </div>
          <div class="row g-2 align-items-center">
            <div class="col-md-8">
              <label class="form-label" style="font-size: 0.72rem; margin-bottom: 2px;">Update Lead Status</label>
              <select class="form-control form-control-sm" id="lead-note-new-status">
                <option value="New" ${lead.status === 'New' ? 'selected' : ''}>New</option>
                <option value="Contacted" ${lead.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
                <option value="Follow-up" ${lead.status === 'Follow-up' ? 'selected' : ''}>Follow-up</option>
                <option value="Interested" ${lead.status === 'Interested' ? 'selected' : ''}>Interested</option>
                <option value="Converted" ${lead.status === 'Converted' ? 'selected' : ''}>Converted</option>
                <option value="Lost" ${lead.status === 'Lost' ? 'selected' : ''}>Lost</option>
              </select>
            </div>
            <div class="col-md-4" style="margin-top: 18px;">
              <button type="submit" class="btn btn-primary btn-sm w-100" style="font-size: 0.76rem;">Log Note & Schedule</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Chronological Notes Stream -->
      <div>
        <h4 style="font-size: 0.85rem; font-weight: 700; color: var(--navy-dark); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span>Follow-up History & Activity Stream</span>
          <span class="badge" style="background:#E2E8F0; color:#475569;">${notes.length} ${notes.length === 1 ? 'Entry' : 'Entries'}</span>
        </h4>
        <div class="followup-timeline" style="display: flex; flex-direction: column; gap: 10px;">
          ${notes.length === 0 ? `
            <div style="text-align: center; padding: 24px; color: #94A3B8; font-size: 0.82rem; background: #F8FAFC; border-radius: 8px;">
              No follow-up notes logged yet. Use the form above to record communication.
            </div>
          ` : notes.slice().reverse().map(n => `
            <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-left: 3px solid var(--royal-blue); border-radius: 6px; padding: 12px;">
              <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #64748B; margin-bottom: 6px;">
                <span style="font-weight: 700; color: var(--navy-dark);">👤 ${escapeHtml(n.author || 'Staff')} (${escapeHtml(n.authorRole || 'Telecaller')})</span>
                <span>🕒 ${escapeHtml(n.timestamp || 'Recent')}</span>
              </div>
              <div style="font-size: 0.82rem; color: #334155; line-height: 1.45; white-space: pre-wrap; margin-bottom: 4px;">${escapeHtml(n.text || n.note || '')}</div>
              ${n.nextAction ? `<div style="font-size: 0.72rem; color: var(--royal-blue); font-weight: 600;">🎯 Next: ${escapeHtml(n.nextAction)}</div>` : ''}
              ${n.nextFollowUpDate ? `<div style="font-size: 0.7rem; color: #64748B;">📅 Scheduled Next: ${WorkPulseDB.formatDisplayDate(n.nextFollowUpDate)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Note form submit listener
    const noteForm = document.getElementById('lead-new-note-form');
    if (noteForm) {
      noteForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = (document.getElementById('lead-note-text')?.value || '').trim();
        const nextAction = (document.getElementById('lead-note-next-action')?.value || '').trim();
        const nextDate = document.getElementById('lead-note-next-date')?.value || '';
        const nextTime = document.getElementById('lead-note-next-time')?.value || '';
        const newStatus = document.getElementById('lead-note-new-status')?.value || lead.status;

        if (!text) return;

        WorkPulseDB.addLeadNote(leadId, text, 'Admin', nextDate, nextAction, nextTime);
        if (newStatus && newStatus !== lead.status) {
          WorkPulseDB.updateLeadStatus(leadId, newStatus, 'Admin');
        }
        if (nextTime || nextAction) {
          WorkPulseDB.updateLead(leadId, { followUpTime: nextTime, nextAction }, 'Admin');
        }

        showToast('Follow-up note logged successfully!', 'success');
        openLeadNotesModal(leadId);
        renderLeads();

        fetch(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            note: text,
            nextFollowUpDate: nextDate,
            nextFollowUpTime: nextTime,
            nextAction,
            status: newStatus
          })
        }).catch(err => console.warn('Failed to save lead note on server:', err));

        fetch(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
          method: 'POST',
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            note: text,
            nextFollowUpDate: nextDate,
            nextFollowUpTime: nextTime,
            nextAction,
            status: newStatus
          })
        }).catch(err => console.warn('Failed to save lead note on server:', err));
      });
    }

    modal.classList.add('open');
  }

  function closeLeadNotesModal() {
    document.getElementById('lead-notes-modal')?.classList.remove('open');
  }

  async function reassignLeadTelecaller(leadId, newStaffId) {
    if (!newStaffId) return;
    const staff = WorkPulseDB.getStaffById(newStaffId);
    if (!staff) return;

    WorkPulseDB.updateLead(leadId, {
      assignedStaffId: staff.id,
      assignedStaffName: staff.name
    }, 'Admin');

    WorkPulseDB.addLeadNote(leadId, `Assigned to telecaller ${staff.name} by Admin.`, 'Admin');
    showToast(`Lead reassigned to ${staff.name}.`, 'success');
    openLeadNotesModal(leadId);
    renderLeads();

    try {
      await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
        method: 'PUT',
        headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          assignedStaffId: staff.id,
          assignedStaffName: staff.name
        })
      });
    } catch (e) {
      console.warn('Failed to update telecaller assignment on server:', e);
    }
  }
  window.reassignLeadTelecaller = reassignLeadTelecaller;

  async function convertLeadToClient(leadId) {
    const lead = WorkPulseDB.getLeadById(leadId);
    if (!lead) return;

    if (!confirm(`Convert lead "${lead.name}" (${lead.company}) to a Client account? Details will be transferred into Client Management.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/convert`, {
        method: 'POST',
        headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Failed to convert lead.', 'error');
        return;
      }
      WorkPulseDB.convertLeadToClient(leadId, {}, { name: 'Administrator', role: 'admin' });
      closeLeadNotesModal();
      renderLeads();
      renderClients();

      if (data.data?.isExistingClient || data.message?.includes('existing client')) {
        showToast(data.message || `Lead converted! Added engagement project to existing client account.`, 'success');
      } else {
        showToast(data.message || `Lead "${lead.name}" successfully converted to new Client account!`, 'success');
      }
    } catch (e) {
      console.error('Error converting lead:', e);
      showToast('Network error while converting lead.', 'error');
    }
  }

  async function confirmDeleteLead(id, name) {
    if (confirm(`Are you sure you want to delete lead "${name}"? This action cannot be undone.`)) {
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: WorkPulseDB.getAuthHeaders()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(data.error || 'Failed to delete lead from server.', 'error');
          return;
        }
        WorkPulseDB.deleteLead(id, 'Admin');
        showToast(`Lead "${name}" deleted successfully.`, 'success');
        renderLeads();
        if (activeLeadNotesId === id) closeLeadNotesModal();
      } catch (e) {
        console.error('Error deleting lead:', e);
        showToast('Network error while deleting lead.', 'error');
      }
    }
  }

  // Telecaller Performance Reports Modal
  function openTelecallerReportsModal() {
    const modal = document.getElementById('telecaller-reports-modal');
    const content = document.getElementById('telecaller-reports-modal-content');
    if (!modal || !content) return;

    const reports = WorkPulseDB.getTelecallerReport();
    const totalStaff = reports.length;
    const totalAssigned = reports.reduce((acc, r) => acc + r.assignedCount, 0);
    const totalFollowUps = reports.reduce((acc, r) => acc + r.followUpsCompleted, 0);
    const totalConverted = reports.reduce((acc, r) => acc + r.convertedCount, 0);
    const totalWonRevenue = reports.reduce((acc, r) => acc + r.wonRevenue, 0);
    const overallRate = totalAssigned > 0 ? ((totalConverted / totalAssigned) * 100).toFixed(1) : '0.0';

    content.innerHTML = `
      <!-- Top Metrics Summary Grid -->
      <div class="row g-3 mb-4">
        <div class="col-md-2 col-6">
          <div class="card p-3" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
            <div style="font-size: 0.72rem; color: #64748B; font-weight: 700;">TELECALLERS</div>
            <div style="font-size: 1.35rem; font-weight: 800; color: var(--navy-dark);">${totalStaff}</div>
          </div>
        </div>
        <div class="col-md-2 col-6">
          <div class="card p-3" style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px;">
            <div style="font-size: 0.72rem; color: #1D4ED8; font-weight: 700;">ASSIGNED LEADS</div>
            <div style="font-size: 1.35rem; font-weight: 800; color: #1D4ED8;">${totalAssigned}</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3" style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px;">
            <div style="font-size: 0.72rem; color: #B45309; font-weight: 700;">FOLLOW-UPS LOGGED</div>
            <div style="font-size: 1.35rem; font-weight: 800; color: #B45309;">${totalFollowUps}</div>
          </div>
        </div>
        <div class="col-md-2 col-6">
          <div class="card p-3" style="background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 8px;">
            <div style="font-size: 0.72rem; color: #047857; font-weight: 700;">CONVERTED</div>
            <div style="font-size: 1.35rem; font-weight: 800; color: #047857;">${totalConverted}</div>
          </div>
        </div>
        <div class="col-md-3 col-12">
          <div class="card p-3" style="background: #071A2B; color: #FFFFFF; border-radius: 8px;">
            <div style="font-size: 0.72rem; color: #94A3B8; font-weight: 700;">CONVERSION & REVENUE</div>
            <div style="font-size: 1.25rem; font-weight: 800; color: var(--gold-primary);">${overallRate}% &bull; ${totalWonRevenue.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <!-- Telecaller Performance Breakdown Table -->
      <div class="card" style="border: 1px solid var(--border-color); overflow: hidden;">
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
          <table class="table wp-table">
            <thead>
              <tr>
                <th style="min-width: 170px;">Telecaller Staff</th>
                <th style="text-align: center; width: 90px;">Assigned</th>
                <th style="text-align: center; width: 80px;">Active</th>
                <th style="text-align: center; width: 90px;">Due Today</th>
                <th style="text-align: center; width: 80px;">Overdue</th>
                <th style="text-align: center; width: 110px;">Follow-ups Done</th>
                <th style="text-align: center; width: 85px;">Converted</th>
                <th style="text-align: center; width: 75px;">Lost</th>
                <th style="text-align: right; width: 100px;">Conv. Rate</th>
                <th style="text-align: right; width: 110px;">Won Revenue</th>
              </tr>
            </thead>
            <tbody>
              ${reports.map(r => `
                <tr>
                  <td>
                    <div style="font-weight: 700; color: var(--navy-dark); font-size: 0.82rem;">${escapeHtml(r.staffName)}</div>
                    <div style="font-size: 0.7rem; color: #64748B;">${escapeHtml(r.position)} &bull; ${escapeHtml(r.staffId)}</div>
                  </td>
                  <td style="text-align: center; font-weight: 700; color: var(--navy-dark);">${r.assignedCount}</td>
                  <td style="text-align: center; color: #334155;">${r.activeCount}</td>
                  <td style="text-align: center;">
                    ${r.todayDueCount > 0 ? `<span class="badge" style="background:#FEF3C7; color:#D97706; font-weight:700;">${r.todayDueCount}</span>` : `<span style="color:#94A3B8;">0</span>`}
                  </td>
                  <td style="text-align: center;">
                    ${r.overdueCount > 0 ? `<span class="badge" style="background:#FEF2F2; color:#DC2626; font-weight:700;">${r.overdueCount}</span>` : `<span style="color:#94A3B8;">0</span>`}
                  </td>
                  <td style="text-align: center; font-weight: 600; color: var(--royal-blue);">${r.followUpsCompleted}</td>
                  <td style="text-align: center; font-weight: 700; color: #047857;">${r.convertedCount}</td>
                  <td style="text-align: center; color: #64748B;">${r.lostCount}</td>
                  <td style="text-align: right; font-weight: 700; color: ${Number(r.conversionRate) > 0 ? '#047857' : '#64748B'};">
                    ${r.conversionRate}%
                  </td>
                  <td style="text-align: right; font-weight: 700; color: var(--gold-primary);">
                    $${(r.wonRevenue || 0).toLocaleString()}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    modal.classList.add('open');
  }

  function closeTelecallerReportsModal() {
    document.getElementById('telecaller-reports-modal')?.classList.remove('open');
  }

  // Excel Export
  function exportLeadsExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS Excel library not loaded.', 'error');
      return;
    }

    const leads = WorkPulseDB.getLeads();
    if (!leads || leads.length === 0) {
      showToast('No leads available to export.', 'error');
      return;
    }

    const rows = leads.map(l => ({
      'Lead ID': l.id,
      'Name': l.name || '',
      'Company Name': l.company || '',
      'Phone': l.phone || '',
      'Email': l.email || '',
      'Interested Service': l.interestedService || l.service || '',
      'Lead Source': l.source || '',
      'Expected Project Amount': Number(l.expectedAmount) || 0,
      'Created Date': l.createdDate || '',
      'Assigned Telecaller': l.assignedStaffName || '',
      'Assigned Telecaller ID': l.assignedStaffId || '',
      'Status': l.status || 'New',
      'Next Follow-up Date': l.followUpDate || '',
      'Next Follow-up Time': l.followUpTime || '',
      'Next Action': l.nextAction || '',
      'Total Notes Count': Array.isArray(l.notes) ? l.notes.length : 0
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'WorkPulse Leads');

    const todayStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `WorkPulse_Leads_Report_${todayStr}.xlsx`);
    showToast(`Exported ${leads.length} leads to Excel file successfully!`, 'success');
  }

  // Excel Import
  function importLeadsExcel(file) {
    if (!file) return;
    if (typeof XLSX === 'undefined') {
      showToast('Excel parser library not available.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);

        if (!rows || rows.length === 0) {
          showToast('The selected file contains no readable lead rows.', 'error');
          return;
        }

        const res = WorkPulseDB.importLeads(rows, { name: 'Administrator', role: 'admin' });
        if (res.importedCount > 0) {
          showToast(`Excel Import: Added ${res.importedCount} new leads! (${res.skippedCount} duplicates/invalid skipped)`, 'success');
        } else {
          showToast(`No new leads imported. ${res.skippedCount} records were duplicates or invalid.`, 'warning');
        }

        renderLeads();
      } catch (err) {
        showToast(`Failed to parse Excel file: ${err.message}`, 'error');
      } finally {
        const input = document.getElementById('lead-excel-file-input');
        if (input) input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }


  // Window bridge for inline onclick handlers
  window.renderClients = renderClients;
  window.openClientProfileModal = openClientProfileModal;
  window.viewClientProfile = openClientProfileModal;
  window.switchClientProfileTab = switchClientProfileTab;
  window.submitClientNote = submitClientNote;
  window.openRecordPaymentModal = openRecordPaymentModal;
  window.closeClientPaymentModal = closeClientPaymentModal;
  window.openAddClientModal = openAddClientModal;
  window.openEditClientModal = openEditClientModal;
  window.openAddClientProjectModal = openAddClientProjectModal;
  window.openEditClientProjectModal = openEditClientProjectModal;
  window.confirmDeleteClient = confirmDeleteClient;
  window.confirmDeleteClientProject = confirmDeleteClientProject;

  window.openAddLeadModal = openAddLeadModal;
  window.openEditLeadModal = openEditLeadModal;
  window.openLeadNotesModal = openLeadNotesModal;
  window.convertLeadToClient = convertLeadToClient;
  window.confirmDeleteLead = confirmDeleteLead;

  // Form Submission Listeners
  // 1. Client Form (with Duplicate Client Prevention)
  const clientForm = document.getElementById('client-form');
  if (clientForm) {
    clientForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const editId = document.getElementById('client-edit-id')?.value;
      const name = (document.getElementById('client-input-name')?.value || '').trim();
      const company = (document.getElementById('client-input-company')?.value || '').trim();
      const phone = (document.getElementById('client-input-phone')?.value || '').trim();
      const email = (document.getElementById('client-input-email')?.value || '').trim();
      const address = (document.getElementById('client-input-address')?.value || '').trim();

      if (!name || !phone || !email) {
        showToast('Please fill all mandatory client fields (*).', 'error');
        return;
      }

      // Check for duplicate client (by phone or email)
      const dupCheck = WorkPulseDB.checkDuplicateClient(phone, email, editId);
      if (dupCheck.isDuplicate) {
        showToast(`Duplicate Client: A client with this ${dupCheck.field} already exists ("${dupCheck.client.name}" - ${dupCheck.client.company || 'No Company'}).`, 'error');
        return;
      }

      if (editId) {
        WorkPulseDB.updateClient(editId, { name, company, phone, email, address }, 'Admin');
        showToast('Client account successfully updated.', 'success');
        if (activeClientProfileId === editId) openClientProfileModal(editId);
      } else {
        const projName = (document.getElementById('client-input-proj-name')?.value || '').trim();
        const clientPayload = { name, company, phone, email, address };

        if (projName) {
          clientPayload.projectName = projName;
          clientPayload.serviceType = document.getElementById('client-input-proj-service')?.value || 'Enterprise Software';
          clientPayload.projectAmount = Number(document.getElementById('client-input-proj-amount')?.value) || 0;
          clientPayload.advancePaid = Number(document.getElementById('client-input-proj-advance')?.value) || 0;
          clientPayload.assignedStaff = document.getElementById('client-input-proj-staff')?.value || '';
          clientPayload.projectDescription = (document.getElementById('client-input-proj-desc')?.value || '').trim();
          clientPayload.startDate = document.getElementById('client-input-proj-start')?.value || '';
          clientPayload.dueDate = document.getElementById('client-input-proj-due')?.value || '';
          clientPayload.projectStatus = document.getElementById('client-input-proj-status')?.value || 'Planning';
          clientPayload.progress = Number(document.getElementById('client-input-proj-progress')?.value) || 0;
        }

        try {
          WorkPulseDB.addClient(clientPayload, 'Admin');
          showToast('New client account created successfully!', 'success');
        } catch (err) {
          showToast(err.message, 'error');
          return;
        }
      }

      closeClientModal();
      renderClients();
    });
  }

  // 2. Client Project Form (Multi-Project Management)
  const clientProjectForm = document.getElementById('client-project-form');
  if (clientProjectForm) {
    clientProjectForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const clientId = document.getElementById('cproj-client-id')?.value;
      const editId = document.getElementById('cproj-edit-id')?.value;
      const name = (document.getElementById('cproj-input-name')?.value || '').trim();
      const serviceType = document.getElementById('cproj-input-service')?.value || 'Enterprise Software';
      const description = (document.getElementById('cproj-input-desc')?.value || '').trim();
      const amount = Number(document.getElementById('cproj-input-amount')?.value) || 0;
      const advancePaid = Number(document.getElementById('cproj-input-advance')?.value) || 0;
      const assignedStaff = document.getElementById('cproj-input-staff')?.value || '';
      const startDate = document.getElementById('cproj-input-start')?.value || '';
      const dueDate = document.getElementById('cproj-input-due')?.value || '';
      const status = document.getElementById('cproj-input-status')?.value || 'In Progress';
      const progress = Number(document.getElementById('cproj-input-progress')?.value) || 0;

      if (!clientId || !name) {
        showToast('Project name and client ID are required.', 'error');
        return;
      }

      const projData = {
        name,
        serviceType,
        description,
        amount,
        advancePaid,
        assignedStaff,
        startDate,
        dueDate,
        status,
        projectStatus: status,
        progress
      };

      if (editId) {
        WorkPulseDB.updateClientProject(clientId, editId, projData, 'Admin');
        showToast('Project details updated successfully.', 'success');
      } else {
        WorkPulseDB.addClientProject(clientId, projData, 'Admin');
        showToast('New project assigned to client account!', 'success');
      }

      closeClientProjectModal();
      renderClients();
      if (activeClientProfileId === clientId) openClientProfileModal(clientId, 'projects');
    });
  }

  // 3. Client Payment Form (Record Payment Installments)
  const clientPaymentForm = document.getElementById('client-payment-form');
  if (clientPaymentForm) {
    clientPaymentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const clientId = document.getElementById('cpay-client-id')?.value;
      const projectId = document.getElementById('cpay-input-project')?.value;
      const amount = Number(document.getElementById('cpay-input-amount')?.value) || 0;
      const date = document.getElementById('cpay-input-date')?.value || new Date().toISOString().split('T')[0];
      const method = document.getElementById('cpay-input-method')?.value || 'Bank Transfer';
      const notes = (document.getElementById('cpay-input-notes')?.value || '').trim();

      if (!clientId || !projectId) {
        showToast('Please select a valid project for this payment.', 'warning');
        return;
      }

      if (amount <= 0) {
        showToast('Please specify a positive payment amount.', 'warning');
        return;
      }

      WorkPulseDB.recordClientPayment(clientId, projectId, {
        amount,
        date,
        method,
        notes
      }, 'Admin');

      showToast(`Payment of $${amount.toLocaleString()} recorded successfully!`, 'success');
      closeClientPaymentModal();
      renderClients();
      if (activeClientProfileId === clientId) openClientProfileModal(clientId, 'payments');
    });
  }

  // 4. Lead Form
  const leadForm = document.getElementById('lead-form');
  if (leadForm) {
    leadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-lead');
      if (saveBtn && (saveBtn.disabled || saveBtn.dataset.submitting === 'true')) {
        return;
      }

      const editId = document.getElementById('lead-edit-id')?.value;
      const name = (document.getElementById('lead-input-name')?.value || '').trim();
      const company = (document.getElementById('lead-input-company')?.value || '').trim();
      const phone = (document.getElementById('lead-input-phone')?.value || '').trim();
      const email = (document.getElementById('lead-input-email')?.value || '').trim();
      const source = document.getElementById('lead-input-source')?.value || 'Website';
      const interestedService = (document.getElementById('lead-input-service')?.value || '').trim();
      const expectedAmount = Number(document.getElementById('lead-input-amount')?.value) || 0;
      const assignedStaffId = document.getElementById('lead-input-telecaller')?.value || '';
      const status = document.getElementById('lead-input-status')?.value || 'New';
      const createdDate = document.getElementById('lead-input-created-date')?.value || new Date().toISOString().split('T')[0];
      const followUpDate = document.getElementById('lead-input-followup-date')?.value || '';
      const followUpTime = document.getElementById('lead-input-followup-time')?.value || '11:00';
      const nextAction = (document.getElementById('lead-input-next-action')?.value || '').trim();
      const initialNotes = (document.getElementById('lead-input-notes')?.value || '').trim();

      // Required Field Validations
      if (!name) {
        showToast('Please enter the lead or contact name.', 'error');
        document.getElementById('lead-input-name')?.focus();
        return;
      }
      if (!company) {
        showToast('Please enter the company or organization name.', 'error');
        document.getElementById('lead-input-company')?.focus();
        return;
      }
      if (!phone) {
        showToast('Please enter a contact phone number.', 'error');
        document.getElementById('lead-input-phone')?.focus();
        return;
      }
      if (!interestedService) {
        showToast('Please specify the interested service.', 'error');
        document.getElementById('lead-input-service')?.focus();
        return;
      }
      if (!assignedStaffId) {
        showToast('Please select an assigned telecaller staff member.', 'error');
        document.getElementById('lead-input-telecaller')?.focus();
        return;
      }
      if (!followUpDate) {
        showToast('Please specify next follow-up date.', 'error');
        document.getElementById('lead-input-followup-date')?.focus();
        return;
      }

      // Pre-check duplicate locally for immediate feedback
      const dup = WorkPulseDB.checkDuplicateLead(phone, email, editId);
      if (dup.isDuplicate) {
        showToast(`Duplicate Lead: A lead with this ${dup.field} already exists ("${dup.lead.name}" - ${dup.lead.company || 'No Company'}).`, 'error');
        return;
      }

      const staff = WorkPulseDB.getStaffById(assignedStaffId);
      const assignedStaffName = staff ? staff.name : 'Telecaller Staff';

      const leadData = {
        name,
        leadName: name,
        company,
        phone,
        email,
        source,
        leadSource: source,
        interestedService,
        service: interestedService,
        expectedAmount,
        assignedStaffId,
        assignedStaffName,
        status,
        leadStatus: status,
        createdDate,
        followUpDate,
        followUpTime,
        nextAction
      };

      if (!editId && initialNotes) {
        leadData.notes = initialNotes;
        leadData.followUpNotes = initialNotes;
      }

      // Lock button to prevent duplicate submissions
      const origBtnHtml = saveBtn ? saveBtn.innerHTML : (editId ? 'Update Lead' : 'Save Lead');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.submitting = 'true';
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" style="margin-right:6px;"></span>Saving Lead...';
      }

      try {
        const endpoint = editId ? `/api/leads/${encodeURIComponent(editId)}` : '/api/leads';
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(endpoint, {
          method,
          headers: WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(leadData)
        });

        const resData = await res.json().catch(() => ({}));

        if (!res.ok) {
          const errMsg = resData.error || `Failed to save lead (Server error: ${res.status})`;
          showToast(errMsg, 'error');
          return;
        }

        const savedLead = resData.data || resData.lead;
        if (savedLead) {
          const db = WorkPulseDB.load();
          if (!Array.isArray(db.leads)) db.leads = [];
          if (editId) {
            const idx = db.leads.findIndex(l => l.id === editId);
            if (idx >= 0) db.leads[idx] = savedLead;
            else db.leads.unshift(savedLead);
          } else {
            const existingIdx = db.leads.findIndex(l => l.id === savedLead.id);
            if (existingIdx >= 0) db.leads[existingIdx] = savedLead;
            else db.leads.unshift(savedLead);
          }
          WorkPulseDB.save(db);
        }

        showToast(editId ? 'Lead record updated successfully.' : 'New lead successfully added to acquisition pipeline!', 'success');
        closeLeadModal();
        renderLeads();
      } catch (err) {
        console.error('Error saving lead to server:', err);
        showToast('Network error: Unable to save lead to database. Please check server connection.', 'error');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.dataset.submitting = 'false';
          saveBtn.innerHTML = origBtnHtml;
        }
      }
    });
  }

  // Button Listeners for Client Management
  document.getElementById('btn-open-add-client')?.addEventListener('click', openAddClientModal);
  document.getElementById('btn-close-client-modal')?.addEventListener('click', closeClientModal);
  document.getElementById('btn-cancel-client-modal')?.addEventListener('click', closeClientModal);

  document.getElementById('btn-close-client-project-modal')?.addEventListener('click', closeClientProjectModal);
  document.getElementById('btn-cancel-client-project-modal')?.addEventListener('click', closeClientProjectModal);

  document.getElementById('btn-close-client-payment-modal')?.addEventListener('click', closeClientPaymentModal);
  document.getElementById('btn-cancel-client-payment-modal')?.addEventListener('click', closeClientPaymentModal);

  document.getElementById('btn-close-client-profile-modal')?.addEventListener('click', closeClientProfileModal);
  document.getElementById('btn-export-clients')?.addEventListener('click', exportClientsCsv);

  // Quick Client Summary KPI Card Clicks (Total, Active, Projects)
  document.getElementById('client-kpi-card-total')?.addEventListener('click', () => {
    const sInput = document.getElementById('client-search-input');
    const stFilter = document.getElementById('client-filter-status');
    const srvFilter = document.getElementById('client-filter-service');
    const pFilter = document.getElementById('client-filter-payment');
    const sortSelect = document.getElementById('client-sort-select');
    if (sInput) sInput.value = '';
    if (stFilter) stFilter.value = 'all';
    if (srvFilter) srvFilter.value = 'all';
    if (pFilter) pFilter.value = 'all';
    if (sortSelect) sortSelect.value = 'newest';
    clientCurrentPage = 1;
    renderClients();
  });

  document.getElementById('client-kpi-card-active')?.addEventListener('click', () => {
    const stFilter = document.getElementById('client-filter-status');
    if (stFilter) stFilter.value = 'Active';
    clientCurrentPage = 1;
    renderClients();
  });

  document.getElementById('client-kpi-card-projects')?.addEventListener('click', () => {
    const sortSelect = document.getElementById('client-sort-select');
    if (sortSelect) sortSelect.value = 'projects-desc';
    clientCurrentPage = 1;
    renderClients();
  });

  // Client Filter Change Listeners
  document.getElementById('client-search-input')?.addEventListener('input', () => {
    clientCurrentPage = 1;
    renderClients();
  });
  document.getElementById('client-filter-status')?.addEventListener('change', () => {
    clientCurrentPage = 1;
    renderClients();
  });
  document.getElementById('client-filter-service')?.addEventListener('change', () => {
    clientCurrentPage = 1;
    renderClients();
  });
  document.getElementById('client-filter-payment')?.addEventListener('change', () => {
    clientCurrentPage = 1;
    renderClients();
  });
  document.getElementById('client-sort-select')?.addEventListener('change', () => {
    clientCurrentPage = 1;
    renderClients();
  });
  document.getElementById('client-page-size')?.addEventListener('change', () => {
    clientCurrentPage = 1;
    renderClients();
  });
  document.getElementById('btn-reset-client-filters')?.addEventListener('click', () => {
    const sInput = document.getElementById('client-search-input');
    const stFilter = document.getElementById('client-filter-status');
    const srvFilter = document.getElementById('client-filter-service');
    const pFilter = document.getElementById('client-filter-payment');
    const sortSelect = document.getElementById('client-sort-select');
    if (sInput) sInput.value = '';
    if (stFilter) stFilter.value = 'all';
    if (srvFilter) srvFilter.value = 'all';
    if (pFilter) pFilter.value = 'all';
    if (sortSelect) sortSelect.value = 'newest';
    clientCurrentPage = 1;
    renderClients();
  });

  // Button Listeners for Lead Management
  document.getElementById('btn-open-add-lead')?.addEventListener('click', openAddLeadModal);
  document.getElementById('btn-close-lead-modal')?.addEventListener('click', closeLeadModal);
  document.getElementById('btn-cancel-lead-modal')?.addEventListener('click', closeLeadModal);

  document.getElementById('btn-close-lead-notes-modal')?.addEventListener('click', closeLeadNotesModal);

  // Lead Reports Modal Listeners
  document.getElementById('btn-lead-reports')?.addEventListener('click', openTelecallerReportsModal);
  document.getElementById('btn-close-telecaller-reports-modal')?.addEventListener('click', closeTelecallerReportsModal);
  document.getElementById('btn-dismiss-telecaller-reports')?.addEventListener('click', closeTelecallerReportsModal);

  // Excel Export and Import Listeners
  document.getElementById('btn-export-leads-excel')?.addEventListener('click', exportLeadsExcel);
  document.getElementById('btn-import-leads-excel')?.addEventListener('click', () => {
    document.getElementById('lead-excel-file-input')?.click();
  });
  document.getElementById('lead-excel-file-input')?.addEventListener('change', function() {
    if (this.files && this.files[0]) {
      importLeadsExcel(this.files[0]);
    }
  });

  // Lead View Mode Switching
  const btnKanban = document.getElementById('btn-lead-view-kanban');
  const btnTable = document.getElementById('btn-lead-view-table');

  if (btnKanban && btnTable) {
    btnKanban.addEventListener('click', () => {
      currentLeadView = 'kanban';
      btnKanban.classList.add('active');
      btnTable.classList.remove('active');
      renderLeads();
    });

    btnTable.addEventListener('click', () => {
      currentLeadView = 'table';
      btnTable.classList.add('active');
      btnKanban.classList.remove('active');
      renderLeads();
    });
  }

  // Quick Summary KPI Clicks (All 6 Cards)
  document.getElementById('lead-kpi-card-total')?.addEventListener('click', () => {
    const sInput = document.getElementById('lead-search-input');
    const st = document.getElementById('lead-filter-status');
    const tf = document.getElementById('lead-filter-timeframe');
    if (sInput) sInput.value = '';
    if (st) st.value = 'all';
    if (tf) tf.value = 'all';
    leadCurrentPage = 1;
    renderLeads();
  });

  document.getElementById('lead-kpi-card-new')?.addEventListener('click', () => {
    const st = document.getElementById('lead-filter-status');
    const tf = document.getElementById('lead-filter-timeframe');
    if (st) st.value = 'New';
    if (tf) tf.value = 'all';
    leadCurrentPage = 1;
    renderLeads();
  });

  document.getElementById('lead-kpi-card-today')?.addEventListener('click', () => {
    const tf = document.getElementById('lead-filter-timeframe');
    if (tf) tf.value = 'today';
    leadCurrentPage = 1;
    renderLeads();
  });

  document.getElementById('lead-kpi-card-overdue')?.addEventListener('click', () => {
    const tf = document.getElementById('lead-filter-timeframe');
    if (tf) tf.value = 'overdue';
    leadCurrentPage = 1;
    renderLeads();
  });

  document.getElementById('lead-kpi-card-converted')?.addEventListener('click', () => {
    const st = document.getElementById('lead-filter-status');
    const tf = document.getElementById('lead-filter-timeframe');
    if (st) st.value = 'Converted';
    if (tf) tf.value = 'all';
    leadCurrentPage = 1;
    renderLeads();
  });

  document.getElementById('lead-kpi-card-lost')?.addEventListener('click', () => {
    const st = document.getElementById('lead-filter-status');
    const tf = document.getElementById('lead-filter-timeframe');
    if (st) st.value = 'Lost';
    if (tf) tf.value = 'all';
    leadCurrentPage = 1;
    renderLeads();
  });

  // Lead Filter & Sorting Change Listeners
  document.getElementById('lead-search-input')?.addEventListener('input', () => {
    leadCurrentPage = 1;
    renderLeads();
  });
  document.getElementById('lead-filter-status')?.addEventListener('change', () => {
    leadCurrentPage = 1;
    renderLeads();
  });
  document.getElementById('lead-filter-service')?.addEventListener('change', () => {
    leadCurrentPage = 1;
    renderLeads();
  });
  document.getElementById('lead-filter-telecaller')?.addEventListener('change', () => {
    leadCurrentPage = 1;
    renderLeads();
  });
  document.getElementById('lead-filter-timeframe')?.addEventListener('change', () => {
    leadCurrentPage = 1;
    renderLeads();
  });
  document.getElementById('lead-sort-select')?.addEventListener('change', () => {
    leadCurrentPage = 1;
    renderLeads();
  });
  document.getElementById('lead-page-size')?.addEventListener('change', function() {
    leadPageSize = Number(this.value) || 10;
    leadCurrentPage = 1;
    renderLeads();
  });
  document.getElementById('btn-reset-lead-filters')?.addEventListener('click', () => {
    const sInput = document.getElementById('lead-search-input');
    const stFilter = document.getElementById('lead-filter-status');
    const srvFilter = document.getElementById('lead-filter-service');
    const tFilter = document.getElementById('lead-filter-telecaller');
    const tfFilter = document.getElementById('lead-filter-timeframe');
    const sortSelect = document.getElementById('lead-sort-select');
    if (sInput) sInput.value = '';
    if (stFilter) stFilter.value = 'all';
    if (srvFilter) srvFilter.value = 'all';
    if (tFilter) tFilter.value = 'all';
    if (tfFilter) tfFilter.value = 'all';
    if (sortSelect) sortSelect.value = 'newest';
    leadCurrentPage = 1;
    renderLeads();
  });



  // --------------------------------------------------------------------------
  // VIEW: DOMAIN & HOSTING MANAGEMENT MODULE
  // --------------------------------------------------------------------------
  let domainSearchQuery = '';
  let domainFilterStatus = 'all';
  let domainFilterOwner = 'all';
  let domainFilterClient = 'all';
  let domainFilterProject = 'all';
  let domainFilterRegistrar = 'all';
  let domainFilterHost = 'all';
  let domainFilterExpiry = 'all';
  let domainStartDate = '';
  let domainEndDate = '';
  let domainSortBy = 'expiry-asc';

  function populateDomainProjectDropdown(clientId, selectedProjectId = null) {
    const projSelect = document.getElementById('domain-input-project');
    if (!projSelect) return;
    projSelect.innerHTML = '<option value="">-- Select Relevant Project --</option>';
    if (!clientId) return;
    const clients = (typeof WorkPulseDB.getClients === 'function') ? WorkPulseDB.getClients() : [];
    const client = clients.find(c => c.id === clientId);
    const projects = (client && Array.isArray(client.projects)) ? client.projects : [];
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.projectName || p.id;
      if (selectedProjectId && p.id === selectedProjectId) {
        opt.selected = true;
      }
      projSelect.appendChild(opt);
    });
    if (selectedProjectId) {
      projSelect.value = selectedProjectId;
    }
  }

  function renderDomains() {
    updatePendingBadges();
    const tbody = document.getElementById('domain-tbody');
    if (!tbody) return;

    // Populate dynamic filter options
    populateDomainFilterDropdowns();

    // Query domain dataset
    const domains = (typeof WorkPulseDB.getDomains === 'function')
      ? WorkPulseDB.getDomains({
          search: domainSearchQuery,
          status: domainFilterStatus,
          ownerType: domainFilterOwner,
          clientId: domainFilterClient,
          projectId: domainFilterProject,
          registrar: domainFilterRegistrar,
          hostingProvider: domainFilterHost,
          expiryFilter: domainFilterExpiry,
          startDate: domainStartDate,
          endDate: domainEndDate,
          sortBy: domainSortBy
        })
      : [];

    const summary = (typeof WorkPulseDB.getDomainSummary === 'function')
      ? WorkPulseDB.getDomainSummary()
      : { total: 0, active: 0, expiringSoon: 0, expired: 0, renewal30Days: 0, renewal7Days: 0, totalRenewalCost: 0 };

    // Update KPI Metric Cards
    const kpiTotal = document.getElementById('domain-kpi-total-domains');
    const kpiActive = document.getElementById('domain-kpi-active-domains');
    const kpiExpiring = document.getElementById('domain-kpi-expiring-domains');
    const kpiExpired = document.getElementById('domain-kpi-expired-domains');
    const kpiExpiringFoot = document.getElementById('domain-kpi-expiring-foot');
    const resultsCount = document.getElementById('domain-results-count');

    if (kpiTotal) kpiTotal.textContent = summary.total || 0;
    if (kpiActive) kpiActive.textContent = summary.active || 0;
    if (kpiExpiring) kpiExpiring.textContent = summary.expiringSoon || 0;
    if (kpiExpired) kpiExpired.textContent = summary.expired || 0;
    if (kpiExpiringFoot) kpiExpiringFoot.textContent = `${summary.renewal30Days || 0} due in next 30 days`;
    if (resultsCount) resultsCount.textContent = `${domains.length} ${domains.length === 1 ? 'Record' : 'Records'}`;

    // Render Renewal Reminders Banner
    const banner = document.getElementById('domain-renewal-alerts-banner');
    if (banner) {
      const alertDomainsCount = (summary.renewal30Days || 0) + (summary.expired || 0);
      if (alertDomainsCount > 0) {
        banner.style.display = 'block';
        banner.innerHTML = `
          <div class="domain-alert-banner">
            <div class="d-flex align-items-center gap-3">
              <div style="background: #D97706; color: #FFFFFF; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.1rem; flex-shrink: 0;">⚠️</div>
              <div>
                <div style="font-weight: 800; font-size: 0.92rem; color: #92400E;">Domain & Hosting Renewal Alerts Action Required</div>
                <div style="font-size: 0.78rem; color: #78350F; margin-top: 2px;">
                  <strong>${alertDomainsCount} domain(s)</strong> require renewal attention (${summary.renewal7Days || 0} critical within 7 days, ${summary.expired || 0} expired). Projected renewal cost: <strong>$${(summary.totalRenewalCost || 0).toLocaleString()}</strong>.
                </div>
              </div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-warning btn-sm" style="font-weight: 700; font-size: 0.75rem; white-space: nowrap;" onclick="window.filterExpiringDomains()">
                Filter Expiring (${summary.expiringSoon})
              </button>
            </div>
          </div>
        `;
      } else {
        banner.style.display = 'none';
      }
    }

    // Render Table Content (9 Columns matching table header)
    if (domains.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center py-5">
            <div style="padding: 30px; text-align: center; color: #64748B;">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 10px; color: #94A3B8;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              <div style="font-size: 1rem; font-weight: 700; color: #1E293B; margin-bottom: 4px;">No Domain Records Found</div>
              <div style="font-size: 0.8rem; margin-bottom: 16px;">Try adjusting search terms or register a company or client domain asset.</div>
              <button class="btn btn-primary btn-sm" onclick="window.openAddDomainModal()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="me-1"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Add New Domain
              </button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = domains.map(d => {
      const st = d.computedStatus || d.status || 'Active';
      const badgeClass = st === 'Active' ? 'domain-status-active' : (st === 'Expiring Soon' ? 'domain-status-expiring' : 'domain-status-expired');
      const sslBadge = d.sslStatus === 'Active' ? 'domain-ssl-active' : (d.sslStatus === 'Expiring Soon' ? 'domain-ssl-warning' : 'domain-ssl-danger');
      const isClientOwned = d.ownerType === 'client' || (!d.ownerType && d.clientId);
      const ownerPill = isClientOwned 
        ? `<span class="badge" style="background: #F3E8FF; color: #6B21A8; font-size: 0.72rem; cursor: pointer;" onclick="window.openClientProfileModal('${escapeHtml(d.clientId)}')" title="Click to view Client Profile">👤 ${escapeHtml(d.clientName || 'Client')}</span>`
        : `<span class="badge" style="background: #EFF6FF; color: #1E40AF; font-size: 0.72rem;">🏢 Company-Owned</span>`;
      const curSym = d.currency === 'INR' ? '₹' : (d.currency === 'EUR' ? '€' : (d.currency === 'GBP' ? '£' : '$'));

      return `
        <tr data-domain-id="${escapeHtml(d.id)}">
          <!-- 1. Domain Name -->
          <td>
            <div class="d-flex align-items-center gap-2">
              <a href="https://${escapeHtml(d.domainName)}" target="_blank" rel="noopener noreferrer" style="font-weight: 700; color: var(--royal-blue); font-size: 0.88rem; text-decoration: none;" title="Open in browser">
                ${escapeHtml(d.domainName)}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ms-1" style="vertical-align: middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>
              <span class="domain-ssl-pill ${sslBadge}" title="SSL: ${escapeHtml(d.sslStatus || 'Active')} (${escapeHtml(d.sslIssuer || '')})">
                🔒 ${escapeHtml(d.sslStatus || 'Active')}
              </span>
            </div>
            ${d.serverIp ? `<div style="font-size: 0.7rem; color: #64748B; margin-top: 3px;">Server IP: <code>${escapeHtml(d.serverIp)}</code></div>` : ''}
          </td>

          <!-- 2. Client Name -->
          <td>
            ${ownerPill}
            ${d.assignedStaffName ? `<div style="font-size: 0.7rem; color: #64748B; margin-top: 3px;">Handler: <strong>${escapeHtml(d.assignedStaffName)}</strong></div>` : ''}
          </td>

          <!-- 3. Project Name -->
          <td>
            <div style="font-weight: 600; color: #0F172A; font-size: 0.82rem;">${escapeHtml(d.projectName || '—')}</div>
            <div style="font-size: 0.72rem; color: #64748B; margin-top: 2px;">${escapeHtml(d.registrar || 'Namecheap')}</div>
          </td>

          <!-- 4. Hosting Provider -->
          <td>
            <div style="font-weight: 600; color: #0F172A; font-size: 0.82rem;">${escapeHtml(d.hostingProvider || 'AWS Route 53 / EC2')}</div>
            <div style="font-size: 0.72rem; color: #64748B;">${escapeHtml(d.hostingPlan || 'Standard Cloud')}</div>
            ${d.nameservers ? `<div style="font-size: 0.68rem; color: #94A3B8; margin-top: 2px;" title="${escapeHtml(d.nameservers)}">DNS: ${escapeHtml(d.nameservers.split('\n')[0].slice(0, 25))}...</div>` : ''}
          </td>

          <!-- 5. Registration Date -->
          <td>
            <div style="font-size: 0.82rem; font-weight: 600; color: #334155;">${d.registrationDate || 'N/A'}</div>
          </td>

          <!-- 6. Expiry Date -->
          <td>
            <div style="font-weight: 600; color: #0F172A; font-size: 0.82rem;">${d.expiryDate || 'N/A'}</div>
            <div style="font-size: 0.7rem; font-weight: 600; color: ${st === 'Expired' ? '#DC2626' : (st === 'Expiring Soon' ? '#D97706' : '#059669')};">
              ${escapeHtml(d.statusLabel || '')}
            </div>
          </td>

          <!-- 7. Renewal Amount -->
          <td>
            <div style="font-weight: 700; color: #0F172A; font-size: 0.84rem;">
              ${curSym}${(Number(d.renewalCost) || 0).toLocaleString()}
            </div>
            <span class="badge" style="background: ${d.autoRenew ? '#ECFDF5; color: #047857;' : '#F1F5F9; color: #64748B;'}; font-size: 0.68rem; padding: 2px 6px;">
              ${d.autoRenew ? '✓ Auto-Renew' : 'Manual Renew'}
            </span>
          </td>

          <!-- 8. Status -->
          <td class="text-center">
            <span class="domain-status-badge ${badgeClass}">${st}</span>
          </td>

          <!-- 9. Actions -->
          <td class="text-end">
            <div class="d-flex align-items-center justify-content-end gap-1">
              <button type="button" class="btn btn-outline-secondary btn-sm p-1 btn-view-domain" data-action="view" data-id="${escapeHtml(d.id)}" onclick="window.viewDomainDetails('${escapeHtml(d.id)}')" title="View Full Technical Dossier" aria-label="View Full Technical Dossier">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              </button>
              <button type="button" class="btn btn-outline-primary btn-sm p-1 btn-edit-domain" data-action="edit" data-id="${escapeHtml(d.id)}" onclick="window.openEditDomainModal('${escapeHtml(d.id)}')" title="Edit Domain & Hosting Details" aria-label="Edit Domain & Hosting Details">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button type="button" class="btn btn-outline-danger btn-sm p-1 btn-delete-domain" data-action="delete" data-id="${escapeHtml(d.id)}" onclick="window.deleteDomainRecord('${escapeHtml(d.id)}')" title="Delete Domain Record" aria-label="Delete Domain Record">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function populateDomainFilterDropdowns() {
    // Populate client filter
    const clientSelect = document.getElementById('domain-filter-client');
    if (clientSelect && clientSelect.options.length <= 3) {
      const clients = (typeof WorkPulseDB.getClients === 'function') ? WorkPulseDB.getClients() : [];
      clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name + (c.company ? ` (${c.company})` : '');
        clientSelect.appendChild(opt);
      });
    }

    // Populate project filter
    const projSelect = document.getElementById('domain-filter-project');
    if (projSelect && projSelect.options.length <= 1) {
      const clients = (typeof WorkPulseDB.getClients === 'function') ? WorkPulseDB.getClients() : [];
      const addedProjects = new Set();
      clients.forEach(c => {
        if (Array.isArray(c.projects)) {
          c.projects.forEach(p => {
            if (p.id && !addedProjects.has(p.id)) {
              addedProjects.add(p.id);
              const opt = document.createElement('option');
              opt.value = p.id;
              opt.textContent = `${p.name || p.projectName || p.id} (${c.name})`;
              projSelect.appendChild(opt);
            }
          });
        }
      });
    }

    // Populate registrar filter from existing domains
    const regSelect = document.getElementById('domain-filter-registrar');
    if (regSelect && regSelect.options.length <= 1) {
      const defaultRegs = ['GoDaddy', 'Namecheap', 'Cloudflare Registrar', 'Google Domains / Squarespace', 'Hostinger', 'AWS Route 53', 'Name.com', 'Porkbun'];
      defaultRegs.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        regSelect.appendChild(opt);
      });
    }

    // Populate hosting provider filter
    const hostSelect = document.getElementById('domain-filter-host');
    if (hostSelect && hostSelect.options.length <= 1) {
      const defaultHosts = ['AWS Route 53 / EC2', 'DigitalOcean', 'Hostinger', 'SiteGround', 'Vercel', 'Netlify', 'Cloudflare Pages / Workers', 'Google Cloud Platform', 'cPanel Shared / Dedicated'];
      defaultHosts.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        hostSelect.appendChild(opt);
      });
    }
  }

  window.filterExpiringDomains = function() {
    domainFilterStatus = 'Expiring Soon';
    const filterEl = document.getElementById('domain-filter-status');
    if (filterEl) filterEl.value = 'Expiring Soon';
    renderDomains();
  };

  window.openAddDomainModal = function(preselectedClientId = null, preselectedProjectId = null) {
    const form = document.getElementById('domain-form');
    if (form) form.reset();

    const idInput = document.getElementById('domain-edit-id');
    if (idInput) idInput.value = '';

    const titleEl = document.getElementById('domain-modal-title');
    if (titleEl) titleEl.textContent = 'Add New Domain & Hosting';

    // Populate clients dropdown in form
    const clientDropdown = document.getElementById('domain-input-client');
    if (clientDropdown) {
      clientDropdown.innerHTML = '<option value="">-- Select Linked Client --</option>';
      const clients = (typeof WorkPulseDB.getClients === 'function') ? WorkPulseDB.getClients() : [];
      clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name + (c.company ? ` (${c.company})` : '');
        clientDropdown.appendChild(opt);
      });
    }

    // Populate staff dropdown in form
    const staffDropdown = document.getElementById('domain-input-staff');
    if (staffDropdown) {
      staffDropdown.innerHTML = '<option value="">-- Unassigned (Admin Desk) --</option>';
      const staffList = (typeof WorkPulseDB.getStaffList === 'function') ? WorkPulseDB.getStaffList() : [];
      staffList.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (${s.id})`;
        staffDropdown.appendChild(opt);
      });
    }

    // Handle preselected client and project
    const ownerSelect = document.getElementById('domain-input-owner');
    const clientWrap = document.getElementById('domain-client-select-wrap');
    if (preselectedClientId) {
      if (ownerSelect) ownerSelect.value = 'client';
      if (clientWrap) clientWrap.style.display = 'block';
      if (clientDropdown) clientDropdown.value = preselectedClientId;
      populateDomainProjectDropdown(preselectedClientId, preselectedProjectId);
    } else {
      if (ownerSelect) ownerSelect.value = 'client';
      if (clientWrap) clientWrap.style.display = 'block';
      populateDomainProjectDropdown(clientDropdown?.value || '', preselectedProjectId);
    }

    // Clear error alert
    const errBanner = document.getElementById('domain-form-error');
    if (errBanner) errBanner.style.display = 'none';

    const modal = document.getElementById('domain-modal');
    if (modal) modal.classList.add('open');
  };

  window.openAddDomainForClient = function(clientId) {
    openAddDomainModal(clientId);
  };

  window.renderDomains = renderDomains;

  window.openEditDomainModal = function(id) {
    if (!id) {
      showToast('No Domain ID specified.', 'error');
      return;
    }
    const domain = (typeof WorkPulseDB.getDomainById === 'function') ? WorkPulseDB.getDomainById(id) : null;
    if (!domain) {
      showToast('Domain record not found.', 'error');
      return;
    }

    openAddDomainModal(domain.clientId, domain.projectId);

    const idInput = document.getElementById('domain-edit-id');
    if (idInput) idInput.value = domain.id;

    const titleEl = document.getElementById('domain-modal-title');
    if (titleEl) titleEl.textContent = `Edit Domain: ${domain.domainName}`;

    const nameInp = document.getElementById('domain-input-name');
    const ownerInp = document.getElementById('domain-input-owner');
    const clientInp = document.getElementById('domain-input-client');
    const clientWrap = document.getElementById('domain-client-select-wrap');
    const projectInp = document.getElementById('domain-input-project');
    const regInp = document.getElementById('domain-input-registrar');
    const regDateInp = document.getElementById('domain-input-reg-date');
    const expDateInp = document.getElementById('domain-input-exp-date');
    const costInp = document.getElementById('domain-input-cost');
    const curInp = document.getElementById('domain-input-currency');
    const autoInp = document.getElementById('domain-input-autorenew');
    const hostInp = document.getElementById('domain-input-host-provider');
    const planInp = document.getElementById('domain-input-host-plan');
    const hostExpInp = document.getElementById('domain-input-host-expiry');
    const ipInp = document.getElementById('domain-input-server-ip');
    const nsInp = document.getElementById('domain-input-nameservers');
    const sslStInp = document.getElementById('domain-input-ssl-status');
    const sslIssInp = document.getElementById('domain-input-ssl-issuer');
    const sslExpInp = document.getElementById('domain-input-ssl-expiry');
    const staffInp = document.getElementById('domain-input-staff');
    const docInp = document.getElementById('domain-input-documents');
    const noteInp = document.getElementById('domain-input-notes');

    if (nameInp) nameInp.value = domain.domainName || '';
    if (ownerInp) ownerInp.value = domain.ownerType || 'client';
    if (clientWrap) clientWrap.style.display = domain.ownerType === 'company' ? 'none' : 'block';
    if (clientInp) {
      clientInp.value = domain.clientId || '';
      populateDomainProjectDropdown(domain.clientId, domain.projectId);
    }
    if (projectInp && domain.projectId) {
      projectInp.value = domain.projectId;
    }
    if (regInp) regInp.value = domain.registrar || 'Namecheap';
    if (regDateInp) regDateInp.value = domain.registrationDate || '';
    if (expDateInp) expDateInp.value = domain.expiryDate || '';
    if (costInp) costInp.value = domain.renewalCost !== undefined ? domain.renewalCost : '';
    if (curInp) curInp.value = domain.currency || 'USD';
    if (autoInp) autoInp.value = String(domain.autoRenew === true || domain.autoRenew === 'true');
    if (hostInp) hostInp.value = domain.hostingProvider || 'AWS Route 53 / EC2';
    if (planInp) planInp.value = domain.hostingPlan || '';
    if (hostExpInp) hostExpInp.value = domain.hostingExpiryDate || '';
    if (ipInp) ipInp.value = domain.serverIp || '';
    if (nsInp) nsInp.value = domain.nameservers || '';
    if (sslStInp) sslStInp.value = domain.sslStatus || 'Active';
    if (sslIssInp) sslIssInp.value = domain.sslIssuer || '';
    if (sslExpInp) sslExpInp.value = domain.sslExpiryDate || '';
    if (staffInp) staffInp.value = domain.assignedStaffId || '';
    if (docInp) {
      if (Array.isArray(domain.documents) && domain.documents.length > 0) {
        docInp.value = domain.documents.map(d => d.url || d.name).join(', ');
      } else {
        docInp.value = '';
      }
    }
    if (noteInp) noteInp.value = domain.notes || '';

    // Clear error alert
    const errBanner = document.getElementById('domain-form-error');
    if (errBanner) errBanner.style.display = 'none';

    const modal = document.getElementById('domain-modal');
    if (modal) modal.classList.add('open');
  };

  window.viewDomainDetails = function(id) {
    if (!id) {
      showToast('No Domain ID specified.', 'error');
      return;
    }
    const domain = (typeof WorkPulseDB.getDomainById === 'function') ? WorkPulseDB.getDomainById(id) : null;
    if (!domain) {
      showToast('Domain record not found.', 'error');
      return;
    }

    const titleEl = document.getElementById('domain-details-modal-title');
    if (titleEl) titleEl.textContent = `Technical Dossier: ${domain.domainName}`;

    const content = document.getElementById('domain-details-modal-content');
    const actions = document.getElementById('domain-details-actions');
    if (!content) return;

    const st = domain.computedStatus || domain.status || 'Active';
    const badgeClass = st === 'Active' ? 'domain-status-active' : (st === 'Expiring Soon' ? 'domain-status-expiring' : 'domain-status-expired');
    const sslBadge = domain.sslStatus === 'Active' ? 'domain-ssl-active' : (domain.sslStatus === 'Expiring Soon' ? 'domain-ssl-warning' : 'domain-ssl-danger');
    const curSym = domain.currency === 'INR' ? '₹' : (domain.currency === 'EUR' ? '€' : (domain.currency === 'GBP' ? '£' : '$'));

    content.innerHTML = `
      <!-- Dossier Header Overview -->
      <div class="card p-3 mb-3" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <div class="d-flex align-items-center gap-2">
            <span style="font-size: 1.15rem; font-weight: 800; color: var(--navy-dark);">${escapeHtml(domain.domainName)}</span>
            <span class="domain-status-badge ${badgeClass}">${st}</span>
            <span class="domain-ssl-pill ${sslBadge}">🔒 SSL: ${escapeHtml(domain.sslStatus || 'Active')}</span>
          </div>
          <div>
            <span class="badge" style="background: ${domain.ownerType === 'client' ? '#F3E8FF; color: #6B21A8;' : '#EFF6FF; color: #1E40AF;'}; font-size: 0.75rem;">
              ${domain.ownerType === 'client' ? `Client: ${escapeHtml(domain.clientName || 'Client-Owned')}` : 'Company-Owned Asset'}
            </span>
          </div>
        </div>
        <div class="d-flex align-items-center gap-3 flex-wrap" style="font-size: 0.8rem; color: #64748B;">
          <span>Registrar: <strong>${escapeHtml(domain.registrar || 'Namecheap')}</strong></span>
          <span>&bull;</span>
          <span>Registered: <strong>${domain.registrationDate || 'N/A'}</strong></span>
          <span>&bull;</span>
          <span>Expires: <strong>${domain.expiryDate || 'N/A'}</strong> (${domain.statusLabel || ''})</span>
          <span>&bull;</span>
          <span>Renewal Cost: <strong>${curSym}${(Number(domain.renewalCost) || 0).toLocaleString()} ${escapeHtml(domain.currency || 'USD')}</strong> (${domain.autoRenew ? 'Auto-Renew ON' : 'Manual Renew'})</span>
        </div>
      </div>

      <!-- Technical Specifications Grid -->
      <div class="row g-3 mb-3">
        <!-- Client & Project Association -->
        <div class="col-md-6">
          <div class="card p-3 h-100" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;">
            <div style="font-size: 0.76rem; font-weight: 800; color: #64748B; text-transform: uppercase; margin-bottom: 8px;">Client & Project Association</div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Linked Client:</span> <strong>${escapeHtml(domain.clientName || (domain.ownerType === 'company' ? 'Internal Company Asset' : 'None'))}</strong></div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Linked Project:</span> <strong>${escapeHtml(domain.projectName || 'None')}</strong></div>
            ${domain.projectDetails ? `
              <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Project Status:</span> <span class="badge bg-light text-dark border">${escapeHtml(domain.projectDetails.status || domain.projectDetails.projectStatus || 'In Progress')}</span></div>
              <div style="font-size: 0.82rem;"><span style="color: #64748B;">Project Value:</span> <strong>$${(Number(domain.projectDetails.totalAmount || domain.projectDetails.amount) || 0).toLocaleString()}</strong> (Balance Due: $${(Number(domain.projectDetails.balanceDue) || 0).toLocaleString()})</div>
            ` : ''}
          </div>
        </div>

        <!-- Hosting & Infrastructure -->
        <div class="col-md-6">
          <div class="card p-3 h-100" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;">
            <div style="font-size: 0.76rem; font-weight: 800; color: #64748B; text-transform: uppercase; margin-bottom: 8px;">Hosting & Server Specs</div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Provider:</span> <strong>${escapeHtml(domain.hostingProvider || 'AWS Cloud')}</strong></div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Plan / Tier:</span> <strong>${escapeHtml(domain.hostingPlan || 'Standard')}</strong></div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Server IP:</span> <code>${escapeHtml(domain.serverIp || 'Not configured')}</code></div>
            <div style="font-size: 0.82rem;"><span style="color: #64748B;">Hosting Renewal:</span> <strong>${domain.hostingExpiryDate || 'Linked with domain'}</strong></div>
          </div>
        </div>

        <!-- SSL & Security -->
        <div class="col-md-6">
          <div class="card p-3 h-100" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;">
            <div style="font-size: 0.76rem; font-weight: 800; color: #64748B; text-transform: uppercase; margin-bottom: 8px;">SSL Certificate & Handler</div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">SSL Status:</span> <strong>${escapeHtml(domain.sslStatus || 'Active')}</strong></div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Certificate Issuer:</span> <strong>${escapeHtml(domain.sslIssuer || "Let's Encrypt")}</strong></div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">SSL Expiration:</span> <strong>${domain.sslExpiryDate || 'Auto-Managed'}</strong></div>
            <div style="font-size: 0.82rem;"><span style="color: #64748B;">Technical Lead:</span> <strong>${escapeHtml(domain.assignedStaffName || 'Administrator Desk')}</strong></div>
          </div>
        </div>

        <!-- Registration & Renewal Specs -->
        <div class="col-md-6">
          <div class="card p-3 h-100" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;">
            <div style="font-size: 0.76rem; font-weight: 800; color: #64748B; text-transform: uppercase; margin-bottom: 8px;">Registration & Renewal</div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Registrar:</span> <strong>${escapeHtml(domain.registrar || 'Namecheap')}</strong></div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Registration Date:</span> <strong>${domain.registrationDate || 'N/A'}</strong></div>
            <div style="font-size: 0.82rem; margin-bottom: 6px;"><span style="color: #64748B;">Current Expiry Date:</span> <strong>${domain.expiryDate || 'N/A'}</strong> (${domain.statusLabel || ''})</div>
            <div style="font-size: 0.82rem;"><span style="color: #64748B;">Renewal Commitment:</span> <strong>${curSym}${(Number(domain.renewalCost) || 0).toLocaleString()}</strong> (${domain.autoRenew ? 'Auto-Renew' : 'Manual'})</div>
          </div>
        </div>

        <!-- DNS & Nameservers -->
        <div class="col-12">
          <div class="card p-3" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span style="font-size: 0.76rem; font-weight: 800; color: #64748B; text-transform: uppercase;">Configured Nameservers & DNS Records</span>
            </div>
            <div style="background: #0A192F; color: #38BDF8; padding: 10px 14px; border-radius: 6px; font-family: monospace; font-size: 0.82rem; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(domain.nameservers || 'ns1.cloudflare.com\nns2.cloudflare.com')}</div>
          </div>
        </div>

        <!-- Documents / Attachments -->
        ${Array.isArray(domain.documents) && domain.documents.length > 0 ? `
          <div class="col-12">
            <div class="card p-3" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;">
              <div style="font-size: 0.76rem; font-weight: 800; color: #64748B; text-transform: uppercase; margin-bottom: 6px;">Configuration Documents & Files</div>
              <div class="d-flex flex-wrap gap-2">
                ${domain.documents.map(doc => `
                  <a href="${escapeHtml(doc.url || '#')}" target="_blank" rel="noopener noreferrer" class="badge bg-light text-dark border p-2" style="text-decoration: none; font-size: 0.78rem;">
                    📄 ${escapeHtml(doc.name || 'Document')} ↗
                  </a>
                `).join('')}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Notes & Documentation -->
        <div class="col-12">
          <div class="card p-3" style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;">
            <div style="font-size: 0.76rem; font-weight: 800; color: #64748B; text-transform: uppercase; margin-bottom: 6px;">Technical Notes & Credentials References</div>
            <div style="font-size: 0.82rem; color: #334155; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(domain.notes || 'No administrative notes recorded.')}</div>
          </div>
        </div>
      </div>
    `;

    if (actions) {
      actions.innerHTML = `
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="window.deleteDomainRecord('${escapeHtml(domain.id)}', true)">Delete Domain</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="document.getElementById('domain-details-modal')?.classList.remove('open'); window.openEditDomainModal('${escapeHtml(domain.id)}')">Edit Domain</button>
      `;
    }

    const modal = document.getElementById('domain-details-modal');
    if (modal) modal.classList.add('open');
  };

  const deletingDomainIds = new Set();
  window.deleteDomainRecord = async function(id, fromDetails = false) {
    if (!id) {
      showToast('No Domain ID specified for deletion.', 'error');
      return;
    }
    if (deletingDomainIds.has(id)) return;
    deletingDomainIds.add(id);

    try {
      const domain = (typeof WorkPulseDB.getDomainById === 'function') ? WorkPulseDB.getDomainById(id) : null;
      const name = domain ? domain.domainName : id;

      if (!confirm(`Are you sure you want to permanently delete the domain "${name}"?\nThis action cannot be undone.`)) {
        return;
      }

      const adminTok = (typeof WorkPulseDB !== 'undefined' && WorkPulseDB.getSessionToken)
        ? (WorkPulseDB.getSessionToken('admin') || (session && session.token) || WorkPulseDB.getSessionToken())
        : (session && session.token);

      const res = await fetch(`/api/domains/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          ...(WorkPulseDB.getAuthHeaders ? WorkPulseDB.getAuthHeaders() : {}),
          ...(adminTok ? { 'Authorization': `Bearer ${adminTok}`, 'X-Session-Token': adminTok } : {})
        },
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete domain record');
      }

      WorkPulseDB.deleteDomain(id);
      showToast(`Domain "${name}" deleted successfully.`, 'success');

      if (fromDetails) {
        document.getElementById('domain-details-modal')?.classList.remove('open');
      }

      renderDomains();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      deletingDomainIds.delete(id);
    }
  };

  async function handleDomainSave(e) {
    if (e) e.preventDefault();
    const editId = document.getElementById('domain-edit-id')?.value;
    const domainName = (document.getElementById('domain-input-name')?.value || '').trim();
    const ownerType = document.getElementById('domain-input-owner')?.value || 'client';
    const clientId = document.getElementById('domain-input-client')?.value || '';
    const projectId = document.getElementById('domain-input-project')?.value || '';
    const registrar = document.getElementById('domain-input-registrar')?.value || 'Namecheap';
    const registrationDate = document.getElementById('domain-input-reg-date')?.value || '';
    const expiryDate = document.getElementById('domain-input-exp-date')?.value || '';
    const renewalCost = document.getElementById('domain-input-cost')?.value || 0;
    const currency = document.getElementById('domain-input-currency')?.value || 'USD';
    const autoRenew = document.getElementById('domain-input-autorenew')?.value === 'true';
    const hostingProvider = document.getElementById('domain-input-host-provider')?.value || 'AWS Route 53 / EC2';
    const hostingPlan = document.getElementById('domain-input-host-plan')?.value || '';
    const hostingExpiryDate = document.getElementById('domain-input-host-expiry')?.value || '';
    const serverIp = document.getElementById('domain-input-server-ip')?.value || '';
    const nameservers = document.getElementById('domain-input-nameservers')?.value || '';
    const sslStatus = document.getElementById('domain-input-ssl-status')?.value || 'Active';
    const sslIssuer = document.getElementById('domain-input-ssl-issuer')?.value || '';
    const sslExpiryDate = document.getElementById('domain-input-ssl-expiry')?.value || '';
    const assignedStaffId = document.getElementById('domain-input-staff')?.value || '';
    const documentUrl = document.getElementById('domain-input-documents')?.value || '';
    const notes = document.getElementById('domain-input-notes')?.value || '';

    const errBanner = document.getElementById('domain-form-error');
    const errMsg = document.getElementById('domain-form-error-msg');
    const showError = (msg, inputEl) => {
      if (errBanner && errMsg) {
        errMsg.textContent = msg;
        errBanner.style.display = 'flex';
      }
      showToast(msg, 'error');
      if (inputEl) inputEl.focus();
    };

    if (!domainName) {
      showError('Please enter a valid domain name.', document.getElementById('domain-input-name'));
      return;
    }
    if (ownerType === 'client' && !clientId) {
      showError('Please select a linked client account.', document.getElementById('domain-input-client'));
      return;
    }
    if (ownerType === 'client' && !projectId) {
      showError('Please select a linked client project.', document.getElementById('domain-input-project'));
      return;
    }
    if (!expiryDate) {
      showError('Please select the domain expiry date.', document.getElementById('domain-input-exp-date'));
      return;
    }

    if (errBanner) errBanner.style.display = 'none';

    let docs = [];
    if (documentUrl) {
      docs = documentUrl.split(',').map((u, i) => ({
        id: `doc-${Date.now()}-${i}`,
        name: `Domain Config ${i + 1}`,
        url: u.trim()
      })).filter(d => d.url);
    }

    const payload = {
      domainName,
      ownerType,
      clientId,
      projectId,
      registrar,
      registrationDate,
      expiryDate,
      renewalCost: Number(renewalCost) || 0,
      currency,
      autoRenew,
      hostingProvider,
      hostingPlan,
      hostingExpiryDate,
      serverIp,
      nameservers,
      sslStatus,
      sslIssuer,
      sslExpiryDate,
      assignedStaffId,
      notes,
      documents: docs
    };

    const btnSave = document.getElementById('btn-save-domain');
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving...';
    }

    try {
      const url = editId ? `/api/domains/${encodeURIComponent(editId)}` : '/api/domains';
      const method = editId ? 'PUT' : 'POST';

      const adminTok = (typeof WorkPulseDB !== 'undefined' && WorkPulseDB.getSessionToken)
        ? (WorkPulseDB.getSessionToken('admin') || (session && session.token) || WorkPulseDB.getSessionToken())
        : (session && session.token);

      const res = await fetch(url, {
        method,
        headers: {
          ...(WorkPulseDB.getAuthHeaders ? WorkPulseDB.getAuthHeaders({ 'Content-Type': 'application/json' }) : { 'Content-Type': 'application/json' }),
          ...(adminTok ? { 'Authorization': `Bearer ${adminTok}`, 'X-Session-Token': adminTok } : {})
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save domain record');
      }

      if (editId) {
        WorkPulseDB.updateDomain(editId, data.data || payload);
        showToast(`Domain "${domainName}" updated successfully.`, 'success');
      } else {
        WorkPulseDB.addDomain(data.data || payload);
        showToast(`Domain "${domainName}" added to portfolio!`, 'success');
      }

      document.getElementById('domain-modal')?.classList.remove('open');
      renderDomains();
    } catch (err) {
      showError(err.message);
    } finally {
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.textContent = 'Save Domain Record';
      }
    }
  }

  // Wire Domain Module Event Listeners
  function initDomainManagementModule() {
    // Open Add Domain Modal
    document.getElementById('btn-open-add-domain')?.addEventListener('click', () => {
      openAddDomainModal();
    });

    // Close Modals
    document.getElementById('btn-close-domain-modal')?.addEventListener('click', () => {
      document.getElementById('domain-modal')?.classList.remove('open');
    });
    document.getElementById('btn-cancel-domain-modal')?.addEventListener('click', () => {
      document.getElementById('domain-modal')?.classList.remove('open');
    });
    document.getElementById('btn-close-domain-details-modal')?.addEventListener('click', () => {
      document.getElementById('domain-details-modal')?.classList.remove('open');
    });
    document.getElementById('btn-dismiss-domain-details')?.addEventListener('click', () => {
      document.getElementById('domain-details-modal')?.classList.remove('open');
    });

    // Owner type select toggle
    document.getElementById('domain-input-owner')?.addEventListener('change', function() {
      const wrap = document.getElementById('domain-client-select-wrap');
      if (wrap) {
        wrap.style.display = this.value === 'client' ? 'block' : 'none';
      }
    });

    // Client select -> populate linked projects
    document.getElementById('domain-input-client')?.addEventListener('change', function() {
      populateDomainProjectDropdown(this.value);
    });

    // Form submission & Save button
    const domainForm = document.getElementById('domain-form');
    if (domainForm) {
      domainForm.addEventListener('submit', handleDomainSave);
    }
    document.getElementById('btn-save-domain')?.addEventListener('click', (e) => {
      e.preventDefault();
      handleDomainSave(e);
    });

    // Delegated click listener on #domain-tbody for ultra-reliable button handling
    const tbody = document.getElementById('domain-tbody');
    if (tbody && !tbody._hasDomainActionListeners) {
      tbody._hasDomainActionListeners = true;
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        if (btn.hasAttribute('onclick')) return; // Already triggered by inline onclick attribute
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (!id) return;
        if (action === 'view') {
          window.viewDomainDetails(id);
        } else if (action === 'edit') {
          window.openEditDomainModal(id);
        } else if (action === 'delete') {
          window.deleteDomainRecord(id);
        }
      });
    }

    // Search and filter listeners
    document.getElementById('domain-search-input')?.addEventListener('input', function() {
      domainSearchQuery = this.value;
      renderDomains();
    });

    document.getElementById('domain-filter-status')?.addEventListener('change', function() {
      domainFilterStatus = this.value;
      renderDomains();
    });

    document.getElementById('domain-filter-owner')?.addEventListener('change', function() {
      domainFilterOwner = this.value;
      renderDomains();
    });

    document.getElementById('domain-filter-client')?.addEventListener('change', function() {
      domainFilterClient = this.value;
      renderDomains();
    });

    document.getElementById('domain-filter-project')?.addEventListener('change', function() {
      domainFilterProject = this.value;
      renderDomains();
    });

    document.getElementById('domain-filter-registrar')?.addEventListener('change', function() {
      domainFilterRegistrar = this.value;
      renderDomains();
    });

    document.getElementById('domain-filter-host')?.addEventListener('change', function() {
      domainFilterHost = this.value;
      renderDomains();
    });

    document.getElementById('domain-filter-expiry')?.addEventListener('change', function() {
      domainFilterExpiry = this.value;
      const pills = document.querySelectorAll('#domain-expiry-pills .domain-expiry-pill');
      pills.forEach(p => p.classList.toggle('active', p.dataset.expiry === this.value));
      const customWrap = document.getElementById('domain-custom-range-wrap');
      if (customWrap) {
        customWrap.style.display = this.value === 'custom' ? 'flex' : 'none';
      }
      renderDomains();
    });

    // Expiry quick filter pills
    document.querySelectorAll('#domain-expiry-pills .domain-expiry-pill').forEach(pill => {
      pill.addEventListener('click', function() {
        document.querySelectorAll('#domain-expiry-pills .domain-expiry-pill').forEach(p => p.classList.remove('active'));
        this.classList.add('active');
        const expiryVal = this.dataset.expiry || 'all';
        domainFilterExpiry = expiryVal;
        const expSel = document.getElementById('domain-filter-expiry');
        if (expSel) expSel.value = expiryVal;
        const customWrap = document.getElementById('domain-custom-range-wrap');
        if (customWrap) {
          customWrap.style.display = expiryVal === 'custom' ? 'flex' : 'none';
        }
        renderDomains();
      });
    });

    // Custom date range apply and clear
    document.getElementById('btn-apply-domain-custom-date')?.addEventListener('click', () => {
      domainStartDate = document.getElementById('domain-filter-start-date')?.value || '';
      domainEndDate = document.getElementById('domain-filter-end-date')?.value || '';
      domainFilterExpiry = 'custom';
      const expSel = document.getElementById('domain-filter-expiry');
      if (expSel) expSel.value = 'custom';
      renderDomains();
    });

    document.getElementById('btn-clear-domain-custom-date')?.addEventListener('click', () => {
      domainStartDate = '';
      domainEndDate = '';
      domainFilterExpiry = 'all';
      const sInp = document.getElementById('domain-filter-start-date');
      const eInp = document.getElementById('domain-filter-end-date');
      const expSel = document.getElementById('domain-filter-expiry');
      const customWrap = document.getElementById('domain-custom-range-wrap');
      if (sInp) sInp.value = '';
      if (eInp) eInp.value = '';
      if (expSel) expSel.value = 'all';
      if (customWrap) customWrap.style.display = 'none';
      document.querySelectorAll('#domain-expiry-pills .domain-expiry-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.expiry === 'all');
      });
      renderDomains();
    });

    document.getElementById('domain-sort-by')?.addEventListener('change', function() {
      domainSortBy = this.value;
      renderDomains();
    });

    document.getElementById('btn-reset-domain-filters')?.addEventListener('click', () => {
      domainSearchQuery = '';
      domainFilterStatus = 'all';
      domainFilterOwner = 'all';
      domainFilterClient = 'all';
      domainFilterProject = 'all';
      domainFilterRegistrar = 'all';
      domainFilterHost = 'all';
      domainFilterExpiry = 'all';
      domainStartDate = '';
      domainEndDate = '';
      domainSortBy = 'expiry-asc';

      const sInp = document.getElementById('domain-search-input');
      const stInp = document.getElementById('domain-filter-status');
      const owInp = document.getElementById('domain-filter-owner');
      const clInp = document.getElementById('domain-filter-client');
      const prInp = document.getElementById('domain-filter-project');
      const regInp = document.getElementById('domain-filter-registrar');
      const hostInp = document.getElementById('domain-filter-host');
      const expSel = document.getElementById('domain-filter-expiry');
      const startInp = document.getElementById('domain-filter-start-date');
      const endInp = document.getElementById('domain-filter-end-date');
      const customWrap = document.getElementById('domain-custom-range-wrap');
      const sortInp = document.getElementById('domain-sort-by');

      if (sInp) sInp.value = '';
      if (stInp) stInp.value = 'all';
      if (owInp) owInp.value = 'all';
      if (clInp) clInp.value = 'all';
      if (prInp) prInp.value = 'all';
      if (regInp) regInp.value = 'all';
      if (hostInp) hostInp.value = 'all';
      if (expSel) expSel.value = 'all';
      if (startInp) startInp.value = '';
      if (endInp) endInp.value = '';
      if (customWrap) customWrap.style.display = 'none';
      if (sortInp) sortInp.value = 'expiry-asc';

      document.querySelectorAll('#domain-expiry-pills .domain-expiry-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.expiry === 'all');
      });

      renderDomains();
    });

    // KPI Card Click Shortcuts
    document.getElementById('domain-kpi-card-total')?.addEventListener('click', () => {
      domainFilterStatus = 'all';
      const el = document.getElementById('domain-filter-status');
      if (el) el.value = 'all';
      renderDomains();
    });

    document.getElementById('domain-kpi-card-active')?.addEventListener('click', () => {
      domainFilterStatus = 'Active';
      const el = document.getElementById('domain-filter-status');
      if (el) el.value = 'Active';
      renderDomains();
    });

    document.getElementById('domain-kpi-card-expiring')?.addEventListener('click', () => {
      domainFilterStatus = 'Expiring Soon';
      const el = document.getElementById('domain-filter-status');
      if (el) el.value = 'Expiring Soon';
      renderDomains();
    });

    document.getElementById('domain-kpi-card-expired')?.addEventListener('click', () => {
      domainFilterStatus = 'Expired';
      const el = document.getElementById('domain-filter-status');
      if (el) el.value = 'Expired';
      renderDomains();
    });

    // Check Reminders Button
    document.getElementById('btn-check-domain-reminders')?.addEventListener('click', async () => {
      try {
        const adminTok = (typeof WorkPulseDB !== 'undefined' && WorkPulseDB.getSessionToken)
          ? (WorkPulseDB.getSessionToken('admin') || (session && session.token) || WorkPulseDB.getSessionToken())
          : (session && session.token);

        const res = await fetch('/api/domains/check-reminders', {
          method: 'POST',
          headers: {
            ...(WorkPulseDB.getAuthHeaders ? WorkPulseDB.getAuthHeaders() : {}),
            ...(adminTok ? { 'Authorization': `Bearer ${adminTok}`, 'X-Session-Token': adminTok } : {})
          },
          credentials: 'include'
        });
        const data = await res.json();
        const count = data.count || 0;
        if (count > 0) {
          showToast(`${count} renewal reminder notifications dispatched to Admin.`, 'warning');
        } else {
          showToast('Domain renewal schedule verified. Reminders are up to date.', 'success');
        }
        renderDomains();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Export CSV Button
    document.getElementById('btn-export-domains')?.addEventListener('click', () => {
      const domains = (typeof WorkPulseDB.getDomains === 'function') ? WorkPulseDB.getDomains() : [];
      if (domains.length === 0) {
        showToast('No domains available to export.', 'info');
        return;
      }

      const headers = ['Domain Name', 'Owner Type', 'Linked Client', 'Linked Project', 'Registrar', 'Registration Date', 'Expiry Date', 'Status', 'Days Remaining', 'Renewal Cost', 'Currency', 'Auto Renew', 'Hosting Provider', 'Hosting Plan', 'Server IP', 'Nameservers', 'SSL Status', 'SSL Issuer', 'Assigned Staff'];
      const rows = domains.map(d => [
        d.domainName,
        d.ownerType,
        d.clientName || '',
        d.projectName || '',
        d.registrar || '',
        d.registrationDate || '',
        d.expiryDate || '',
        d.computedStatus || d.status || '',
        d.daysRemaining || '',
        d.renewalCost || 0,
        d.currency || 'USD',
        d.autoRenew ? 'Yes' : 'No',
        d.hostingProvider || '',
        d.hostingPlan || '',
        d.serverIp || '',
        (d.nameservers || '').replace(/\n/g, ' / '),
        d.sslStatus || '',
        d.sslIssuer || '',
        d.assignedStaffName || ''
      ]);

      const csvContent = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `workpulse_domains_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Domain & hosting export generated successfully.', 'success');
    });
  }

  // --------------------------------------------------------------------------
  // 17. VIEW: CORPORATE MISCELLANEOUS HUB
  // --------------------------------------------------------------------------
  let miscActiveSubtab = 'requests';
  let miscSearchQuery = '';
  let miscFilterStatusVal = 'all';
  let miscFilterPriorityVal = 'all';
  let miscFilterCategoryVal = 'all';
  let miscFilterStaffVal = 'all';
  let miscDetailsCurrentItem = null;

  const miscSubtabMeta = {
    requests: {
      name: 'General Requests',
      singular: 'General Request',
      addLabel: 'New General Request',
      categories: ['All Categories', 'IT Equipment', 'Stationery & Supplies', 'Software License', 'Access & Credentials', 'Travel & Expense', 'Facilities', 'HR Services', 'Other'],
      statuses: ['All Statuses', 'Pending', 'Approved', 'In Progress', 'Completed', 'Rejected']
    },
    assets: {
      name: 'Office Equipment',
      singular: 'Office Equipment',
      addLabel: 'Register Equipment',
      categories: ['All Categories', 'IT Hardware', 'Electronics & Peripherals', 'Networking & Audio', 'Office Furniture', 'Facility Assets', 'Other'],
      statuses: ['All Statuses', 'Available', 'Assigned', 'In Repair', 'Retired']
    },
    maintenance: {
      name: 'Maintenance Issues',
      singular: 'Maintenance Issue',
      addLabel: 'Report Maintenance',
      categories: ['All Categories', 'Electrical', 'HVAC / Climate', 'Plumbing', 'Networking & Internet', 'Cleaning & Janitorial', 'Furniture & Structural', 'Other'],
      statuses: ['All Statuses', 'Reported', 'In Progress', 'Resolved', 'On Hold', 'Cancelled']
    },
    notes: {
      name: 'Internal Notes',
      singular: 'Internal Note & Reminder',
      addLabel: 'Create Note / Reminder',
      categories: ['All Categories', 'Internal Policy', 'Executive Reminder', 'Company Announcement', 'Vendor & Supplier', 'Action Item', 'Meeting Follow-up'],
      statuses: ['All Statuses', 'Active', 'Follow-up', 'Completed', 'Archived']
    },
    documents: {
      name: 'General Documents',
      singular: 'Corporate Document',
      addLabel: 'Upload Document',
      categories: ['All Categories', 'Company Policies', 'HR & Governance', 'Legal & Compliance', 'Templates & Forms', 'Technical Guidelines', 'Financial & Invoices'],
      statuses: ['All Statuses', 'Active', 'Draft', 'Under Review', 'Archived']
    }
  };

  function getMiscPriorityPill(priority) {
    const p = (priority || 'medium').toLowerCase();
    let cls = 'standard';
    if (p.includes('urgent')) cls = 'urgent';
    else if (p.includes('high') || p.includes('important')) cls = 'high';
    else if (p.includes('low')) cls = 'low';
    return `<span class="misc-pill-priority misc-prio-${cls} ${cls}"><span class="misc-prio-dot"></span>${escapeHtml(priority || 'Medium')}</span>`;
  }

  function getMiscStatusBadge(status) {
    const raw = (status || 'active').toLowerCase().replace(/\s+/g, '-');
    return `<span class="misc-badge-status misc-status-${raw} ${raw}"><span class="misc-status-dot"></span>${escapeHtml(status || 'Active')}</span>`;
  }

  function formatMiscDate(dateVal) {
    if (!dateVal) return '—';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return dateVal;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateVal;
    }
  }

  function renderMiscStaffChip(name, id) {
    if (!name || name === 'all' || name === 'Unassigned') {
      return `<span style="color: #94A3B8; font-style: italic; font-size: 0.8rem;">${escapeHtml(name || 'Unassigned')}</span>`;
    }
    const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || 'ST';
    return `
      <div class="d-flex align-items-center gap-2">
        <span class="misc-avatar-chip">${escapeHtml(initials)}</span>
        <div>
          <div style="font-size: 0.82rem; font-weight: 600; color: #1E293B; line-height: 1.2;">${escapeHtml(name)}</div>
          ${id ? `<div style="font-size: 0.68rem; color: #64748B;">${escapeHtml(id)}</div>` : ''}
        </div>
      </div>
    `;
  }

  function populateMiscStaffDropdown(selectEl, includeUnassigned = false, includeAll = false) {
    if (!selectEl) return;
    const currentVal = selectEl.value;
    selectEl.innerHTML = '';
    if (includeAll) {
      const opt = document.createElement('option');
      opt.value = 'all';
      opt.textContent = 'All Corporate Staff (Public)';
      selectEl.appendChild(opt);
    }
    if (includeUnassigned) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Unassigned (In Storage / Shared)';
      selectEl.appendChild(opt);
    }
    const staffList = (typeof WorkPulseDB.getStaffList === 'function') ? WorkPulseDB.getStaffList() : [];
    staffList.forEach(s => {
      if (!s) return;
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.id}) - ${s.position || s.department || 'Staff'}`;
      selectEl.appendChild(opt);
    });
    if (currentVal) selectEl.value = currentVal;
  }

  function populateMiscFilterDropdowns() {
    const meta = miscSubtabMeta[miscActiveSubtab] || miscSubtabMeta.requests;
    
    // Status filter
    const statusSelect = document.getElementById('misc-filter-status');
    if (statusSelect) {
      statusSelect.innerHTML = '';
      meta.statuses.forEach(st => {
        const opt = document.createElement('option');
        opt.value = (st === 'All Statuses') ? 'all' : st;
        opt.textContent = st;
        statusSelect.appendChild(opt);
      });
      statusSelect.value = miscFilterStatusVal || 'all';
    }

    // Category filter
    const catSelect = document.getElementById('misc-filter-category');
    if (catSelect) {
      catSelect.innerHTML = '';
      meta.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = (cat === 'All Categories') ? 'all' : cat;
        opt.textContent = cat;
        catSelect.appendChild(opt);
      });
      catSelect.value = miscFilterCategoryVal || 'all';
    }

    // Staff filter
    const staffSelect = document.getElementById('misc-filter-staff');
    if (staffSelect) {
      staffSelect.innerHTML = '<option value="all">All Staff Members</option>';
      const staffList = (typeof WorkPulseDB.getStaffList === 'function') ? WorkPulseDB.getStaffList() : [];
      staffList.forEach(s => {
        if (!s) return;
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (${s.id})`;
        staffSelect.appendChild(opt);
      });
      staffSelect.value = miscFilterStaffVal || 'all';
    }
  }

  function updateMiscKpis() {
    if (typeof WorkPulseDB.getMiscSummary !== 'function') return;
    const summary = WorkPulseDB.getMiscSummary();

    const pReq = document.getElementById('misc-kpi-pending-reqs');
    const tReq = document.getElementById('misc-kpi-total-reqs');
    if (pReq) pReq.textContent = summary.pendingRequests || 0;
    if (tReq) tReq.textContent = `${summary.totalRequests || 0} Total Submissions`;

    const tAst = document.getElementById('misc-kpi-total-assets');
    const aAst = document.getElementById('misc-kpi-assigned-assets');
    if (tAst) tAst.textContent = summary.totalAssets || 0;
    if (aAst) aAst.textContent = `${summary.assignedAssets || 0} Assigned to Staff`;

    const oMnt = document.getElementById('misc-kpi-open-maint');
    const rMnt = document.getElementById('misc-kpi-resolved-maint');
    if (oMnt) oMnt.textContent = summary.openMaintenance || 0;
    if (rMnt) rMnt.textContent = `${summary.resolvedMaintenance || 0} Issues Resolved`;

    const aNot = document.getElementById('misc-kpi-active-notes');
    const pNot = document.getElementById('misc-kpi-pinned-notes');
    if (aNot) aNot.textContent = summary.activeNotes || 0;
    if (pNot) pNot.textContent = `${summary.pinnedNotes || 0} Pinned Notices`;

    const tDoc = document.getElementById('misc-kpi-total-docs');
    if (tDoc) tDoc.textContent = summary.totalDocuments || 0;

    // Badges in subtab navigation
    const bReq = document.getElementById('misc-badge-requests');
    if (bReq) bReq.textContent = summary.pendingRequests || 0;
    const bAst = document.getElementById('misc-badge-assets');
    if (bAst) bAst.textContent = summary.totalAssets || 0;
    const bMnt = document.getElementById('misc-badge-maintenance');
    if (bMnt) bMnt.textContent = summary.openMaintenance || 0;
    const bNot = document.getElementById('misc-badge-notes');
    if (bNot) bNot.textContent = summary.activeNotes || 0;
    const bDoc = document.getElementById('misc-badge-documents');
    if (bDoc) bDoc.textContent = summary.totalDocuments || 0;
  }

  function switchMiscSubtab(subtabKey) {
    if (!miscSubtabMeta[subtabKey]) subtabKey = 'requests';
    miscActiveSubtab = subtabKey;

    document.querySelectorAll('.misc-subtab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === subtabKey);
    });

    document.querySelectorAll('.misc-kpi-card').forEach(card => {
      card.classList.toggle('active', card.dataset.subtab === subtabKey);
    });

    document.querySelectorAll('.misc-pane').forEach(pane => {
      const match = pane.id === `misc-pane-${subtabKey}`;
      pane.classList.toggle('active', match);
      pane.style.display = match ? 'block' : 'none';
    });

    const addBtn = document.getElementById('btn-misc-add-item');
    const addText = document.getElementById('btn-misc-add-text');
    if (addBtn) {
      if (subtabKey === 'requests') {
        addBtn.style.display = 'none';
      } else {
        addBtn.style.display = 'inline-flex';
        if (addText && miscSubtabMeta[subtabKey]) {
          addText.textContent = miscSubtabMeta[subtabKey].addLabel;
        }
      }
    }

    miscSearchQuery = '';
    const searchInp = document.getElementById('misc-search-input');
    if (searchInp) searchInp.value = '';
    miscFilterStatusVal = 'all';
    miscFilterPriorityVal = 'all';
    miscFilterCategoryVal = 'all';
    miscFilterStaffVal = 'all';

    populateMiscFilterDropdowns();
    renderMiscModule();
  }

  // 1. RENDER GENERAL REQUESTS TABLE
  function renderMiscRequestsTable() {
    const tbody = document.getElementById('misc-tbody-requests');
    if (!tbody) return;

    let items = (typeof WorkPulseDB.getGeneralRequests === 'function') ? WorkPulseDB.getGeneralRequests() : [];

    // Filter
    if (miscFilterStatusVal && miscFilterStatusVal !== 'all') {
      items = items.filter(i => (i.status || '').toLowerCase() === miscFilterStatusVal.toLowerCase());
    }
    if (miscFilterPriorityVal && miscFilterPriorityVal !== 'all') {
      items = items.filter(i => (i.priority || '').toLowerCase() === miscFilterPriorityVal.toLowerCase());
    }
    if (miscFilterCategoryVal && miscFilterCategoryVal !== 'all') {
      items = items.filter(i => (i.category || '').toLowerCase() === miscFilterCategoryVal.toLowerCase());
    }
    if (miscFilterStaffVal && miscFilterStaffVal !== 'all') {
      items = items.filter(i => i.staffId === miscFilterStaffVal || i.assignedStaffId === miscFilterStaffVal);
    }
    if (miscSearchQuery) {
      const q = miscSearchQuery.toLowerCase();
      items = items.filter(i => 
        (i.title || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.staffName || '').toLowerCase().includes(q) ||
        (i.id || '').toLowerCase().includes(q)
      );
    }

    const countBadge = document.getElementById('misc-results-count');
    if (countBadge) countBadge.textContent = `${items.length} ${items.length === 1 ? 'Record' : 'Records'}`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-5" style="color: #94A3B8;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-2" style="opacity: 0.5;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            <div style="font-size: 0.95rem; font-weight: 600; color: #475569;">No General Requests Found</div>
            <div style="font-size: 0.8rem;">Try adjusting search terms or click "Add Request" to create one.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(req => {
      const commentCount = (req.comments && req.comments.length) || 0;
      return `
        <tr>
          <td style="font-weight: 700; color: #1D5F8F; font-size: 0.82rem;">${escapeHtml(req.id)}</td>
          <td>
            <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(req.title)}</div>
            <div style="font-size: 0.74rem; color: #64748B;">${escapeHtml(req.category || 'General')} &bull; ${escapeHtml((req.description || '').slice(0, 50))}${req.description && req.description.length > 50 ? '...' : ''}</div>
          </td>
          <td>
            ${renderMiscStaffChip(req.staffName, req.staffId)}
            <div style="font-size: 0.7rem; color: #94A3B8; margin-top: 2px;">${formatMiscDate(req.date)}</div>
          </td>
          <td class="text-center">${getMiscPriorityPill(req.priority)}</td>
          <td class="text-center">${getMiscStatusBadge(req.status)}</td>
          <td>${renderMiscStaffChip(req.assignedStaffName || 'Admin Desk', req.assignedStaffId)}</td>
          <td class="text-end">
            <div class="d-flex align-items-center justify-content-end gap-1">
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="view-details" data-type="requests" data-id="${req.id}" title="View Details & Comments (${commentCount})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                ${commentCount > 0 ? `<span class="badge bg-secondary ms-1" style="font-size: 0.65rem;">${commentCount}</span>` : ''}
              </button>
              ${req.status === 'Pending' ? `
                <button class="btn btn-outline-success btn-sm p-1" data-action="quick-approve-request" data-id="${req.id}" title="Quick Approve">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </button>
                <button class="btn btn-outline-danger btn-sm p-1" data-action="quick-reject-request" data-id="${req.id}" title="Quick Reject">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              ` : ''}
              ${(req.status === 'Approved' || req.status === 'In Progress') ? `
                <button class="btn btn-outline-primary btn-sm p-1" data-action="quick-complete-request" data-id="${req.id}" title="Mark Completed">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </button>
              ` : ''}
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="edit-request" data-id="${req.id}" title="Edit Request">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="btn btn-outline-danger btn-sm p-1" data-action="delete-request" data-id="${req.id}" title="Delete Request">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 2. RENDER OFFICE ASSETS TABLE
  function renderMiscAssetsTable() {
    const tbody = document.getElementById('misc-tbody-assets');
    if (!tbody) return;

    let items = (typeof WorkPulseDB.getOfficeAssets === 'function') ? WorkPulseDB.getOfficeAssets() : [];

    // Filter
    if (miscFilterStatusVal && miscFilterStatusVal !== 'all') {
      items = items.filter(i => (i.status || '').toLowerCase() === miscFilterStatusVal.toLowerCase());
    }
    if (miscFilterPriorityVal && miscFilterPriorityVal !== 'all') {
      items = items.filter(i => (i.priority || '').toLowerCase() === miscFilterPriorityVal.toLowerCase());
    }
    if (miscFilterCategoryVal && miscFilterCategoryVal !== 'all') {
      items = items.filter(i => (i.category || '').toLowerCase() === miscFilterCategoryVal.toLowerCase());
    }
    if (miscFilterStaffVal && miscFilterStaffVal !== 'all') {
      items = items.filter(i => i.assignedTo === miscFilterStaffVal || i.assignedStaffId === miscFilterStaffVal);
    }
    if (miscSearchQuery) {
      const q = miscSearchQuery.toLowerCase();
      items = items.filter(i => 
        (i.title || i.name || '').toLowerCase().includes(q) ||
        (i.assetTag || '').toLowerCase().includes(q) ||
        (i.assignedStaffName || i.assignedToName || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      );
    }

    const countBadge = document.getElementById('misc-results-count');
    if (countBadge) countBadge.textContent = `${items.length} ${items.length === 1 ? 'Record' : 'Records'}`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-5" style="color: #94A3B8;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-2" style="opacity: 0.5;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line></svg>
            <div style="font-size: 0.95rem; font-weight: 600; color: #475569;">No Office Equipment Found</div>
            <div style="font-size: 0.8rem;">Click "Add Asset" to track laptops, monitors, or office furniture.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(ast => {
      const commentCount = (ast.comments && ast.comments.length) || 0;
      const assignedName = ast.assignedStaffName || ast.assignedToName;
      const isAssigned = ast.status === 'Assigned' && !!assignedName;
      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: #1D5F8F; font-size: 0.8rem; letter-spacing: 0.5px;">${escapeHtml(ast.assetTag || ast.id)}</div>
            <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(ast.title || ast.name)}</div>
          </td>
          <td><span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.72rem; border: 1px solid #E2E8F0;">${escapeHtml(ast.category || 'Hardware')}</span></td>
          <td class="text-center">
            <span class="badge ${ast.condition === 'Excellent' ? 'bg-success-subtle text-success' : (ast.condition === 'Good' ? 'bg-info-subtle text-info' : 'bg-warning-subtle text-warning')}" style="font-size: 0.72rem;">
              ${escapeHtml(ast.condition || 'Good')}
            </span>
          </td>
          <td>${renderMiscStaffChip(assignedName || 'Unassigned', ast.assignedTo || ast.assignedStaffId)}</td>
          <td>
            <div style="font-size: 0.78rem; color: #1E293B;">Issued: ${formatMiscDate(ast.date || ast.assignedDate)}</div>
            <div style="font-size: 0.72rem; color: #64748B;">Return: ${formatMiscDate(ast.returnDate || ast.expectedReturnDate)}</div>
          </td>
          <td class="text-center">${getMiscStatusBadge(ast.status)}</td>
          <td class="text-end">
            <div class="d-flex align-items-center justify-content-end gap-1">
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="view-details" data-type="assets" data-id="${ast.id}" title="View Details & Comments (${commentCount})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                ${commentCount > 0 ? `<span class="badge bg-secondary ms-1" style="font-size: 0.65rem;">${commentCount}</span>` : ''}
              </button>
              ${isAssigned ? `
                <button class="btn btn-outline-warning btn-sm p-1" data-action="quick-return-asset" data-id="${ast.id}" title="Mark Returned to Storage">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                </button>
              ` : ''}
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="edit-asset" data-id="${ast.id}" title="Edit Asset Record">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="btn btn-outline-danger btn-sm p-1" data-action="delete-asset" data-id="${ast.id}" title="Delete Asset Record">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 3. RENDER OFFICE MAINTENANCE TABLE
  function renderMiscMaintenanceTable() {
    const tbody = document.getElementById('misc-tbody-maintenance');
    if (!tbody) return;

    let items = (typeof WorkPulseDB.getMaintenanceIssues === 'function') ? WorkPulseDB.getMaintenanceIssues() : [];

    // Filter
    if (miscFilterStatusVal && miscFilterStatusVal !== 'all') {
      items = items.filter(i => (i.status || '').toLowerCase() === miscFilterStatusVal.toLowerCase());
    }
    if (miscFilterPriorityVal && miscFilterPriorityVal !== 'all') {
      items = items.filter(i => (i.priority || '').toLowerCase() === miscFilterPriorityVal.toLowerCase());
    }
    if (miscFilterCategoryVal && miscFilterCategoryVal !== 'all') {
      items = items.filter(i => (i.category || '').toLowerCase() === miscFilterCategoryVal.toLowerCase());
    }
    if (miscFilterStaffVal && miscFilterStaffVal !== 'all') {
      items = items.filter(i => i.staffId === miscFilterStaffVal || i.assignedStaffId === miscFilterStaffVal);
    }
    if (miscSearchQuery) {
      const q = miscSearchQuery.toLowerCase();
      items = items.filter(i => 
        (i.title || '').toLowerCase().includes(q) ||
        (i.location || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.staffName || '').toLowerCase().includes(q) ||
        (i.id || '').toLowerCase().includes(q)
      );
    }

    const countBadge = document.getElementById('misc-results-count');
    if (countBadge) countBadge.textContent = `${items.length} ${items.length === 1 ? 'Record' : 'Records'}`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-5" style="color: #94A3B8;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-2" style="opacity: 0.5;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
            <div style="font-size: 0.95rem; font-weight: 600; color: #475569;">No Maintenance Issues Reported</div>
            <div style="font-size: 0.8rem;">Click "Report Issue" to log facility or hardware issues.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(mnt => {
      const commentCount = (mnt.comments && mnt.comments.length) || 0;
      const isResolved = mnt.status === 'Resolved';
      return `
        <tr>
          <td style="font-weight: 700; color: #1D5F8F; font-size: 0.82rem;">${escapeHtml(mnt.id)}</td>
          <td>
            <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(mnt.title)}</div>
            <div style="font-size: 0.74rem; color: #64748B;">
              <strong>${escapeHtml(mnt.location || 'General Office')}</strong> &bull; ${escapeHtml(mnt.category || 'Facility')}
            </div>
          </td>
          <td>
            ${renderMiscStaffChip(mnt.staffName || 'Facility Team', mnt.staffId)}
            <div style="font-size: 0.7rem; color: #94A3B8; margin-top: 2px;">${formatMiscDate(mnt.date || mnt.reportedDate)}</div>
          </td>
          <td class="text-center">${getMiscPriorityPill(mnt.priority)}</td>
          <td>${renderMiscStaffChip(mnt.assignedStaffName || 'Facility Lead', mnt.assignedStaffId)}</td>
          <td class="text-center">${getMiscStatusBadge(mnt.status)}</td>
          <td class="text-end">
            <div class="d-flex align-items-center justify-content-end gap-1">
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="view-details" data-type="maintenance" data-id="${mnt.id}" title="View Details & Comments (${commentCount})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                ${commentCount > 0 ? `<span class="badge bg-secondary ms-1" style="font-size: 0.65rem;">${commentCount}</span>` : ''}
              </button>
              ${!isResolved ? `
                <button class="btn btn-outline-success btn-sm p-1" data-action="quick-resolve-maintenance" data-id="${mnt.id}" title="Mark Resolved">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </button>
              ` : ''}
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="edit-maintenance" data-id="${mnt.id}" title="Edit Issue">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="btn btn-outline-danger btn-sm p-1" data-action="delete-maintenance" data-id="${mnt.id}" title="Delete Issue">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 4. RENDER INTERNAL NOTES & REMINDERS TABLE
  function renderMiscNotesTable() {
    const tbody = document.getElementById('misc-tbody-notes');
    if (!tbody) return;

    let items = (typeof WorkPulseDB.getInternalNotes === 'function') ? WorkPulseDB.getInternalNotes() : [];

    // Filter
    if (miscFilterStatusVal && miscFilterStatusVal !== 'all') {
      items = items.filter(i => (i.status || '').toLowerCase() === miscFilterStatusVal.toLowerCase());
    }
    if (miscFilterPriorityVal && miscFilterPriorityVal !== 'all') {
      items = items.filter(i => (i.priority || '').toLowerCase() === miscFilterPriorityVal.toLowerCase());
    }
    if (miscFilterCategoryVal && miscFilterCategoryVal !== 'all') {
      items = items.filter(i => (i.category || '').toLowerCase() === miscFilterCategoryVal.toLowerCase());
    }
    if (miscFilterStaffVal && miscFilterStaffVal !== 'all') {
      items = items.filter(i => i.assignedStaffId === miscFilterStaffVal || i.staffId === miscFilterStaffVal || i.assignedStaffId === 'all');
    }
    if (miscSearchQuery) {
      const q = miscSearchQuery.toLowerCase();
      items = items.filter(i => 
        (i.title || '').toLowerCase().includes(q) ||
        (i.description || i.content || '').toLowerCase().includes(q) ||
        (i.id || '').toLowerCase().includes(q)
      );
    }

    const countBadge = document.getElementById('misc-results-count');
    if (countBadge) countBadge.textContent = `${items.length} ${items.length === 1 ? 'Record' : 'Records'}`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-5" style="color: #94A3B8;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-2" style="opacity: 0.5;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            <div style="font-size: 0.95rem; font-weight: 600; color: #475569;">No Internal Notes Found</div>
            <div style="font-size: 0.8rem;">Click "Add Note" to broadcast memos or set operational reminders.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(note => {
      const commentCount = (note.comments && note.comments.length) || 0;
      const isPinned = !!note.isPinned;
      return `
        <tr style="${isPinned ? 'background: rgba(201, 154, 50, 0.04);' : ''}">
          <td>
            <div class="d-flex align-items-center gap-2">
              <button class="btn btn-sm p-0 border-0" data-action="toggle-pin-note" data-id="${note.id}" title="${isPinned ? 'Unpin Note' : 'Pin Note'}" style="font-size: 1.1rem; line-height: 1;">
                ${isPinned ? '📌' : '📍'}
              </button>
              <div>
                <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">
                  ${isPinned ? '<span class="badge bg-warning-subtle text-warning me-1" style="font-size: 0.65rem;">PINNED</span>' : ''}
                  ${escapeHtml(note.title)}
                </div>
                <div style="font-size: 0.74rem; color: #64748B;">${escapeHtml(note.category || 'General')}</div>
              </div>
            </div>
          </td>
          <td style="max-width: 260px;">
            <div style="font-size: 0.8rem; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(note.description || note.content || '')}
            </div>
          </td>
          <td>
            <span class="badge" style="background: #F1F5F9; color: #334155; font-size: 0.72rem;">
              ${note.assignedStaffName === 'all' || !note.assignedStaffName ? '🌐 All Staff' : escapeHtml(note.assignedStaffName)}
            </span>
          </td>
          <td>
            <div style="font-size: 0.8rem; font-weight: 600; color: #1D5F8F;">${formatMiscDate(note.date || note.reminderDate)}</div>
          </td>
          <td class="text-center">${getMiscPriorityPill(note.priority)}</td>
          <td class="text-center">${getMiscStatusBadge(note.status)}</td>
          <td class="text-end">
            <div class="d-flex align-items-center justify-content-end gap-1">
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="view-details" data-type="notes" data-id="${note.id}" title="View Details & Comments (${commentCount})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                ${commentCount > 0 ? `<span class="badge bg-secondary ms-1" style="font-size: 0.65rem;">${commentCount}</span>` : ''}
              </button>
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="edit-note" data-id="${note.id}" title="Edit Note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="btn btn-outline-danger btn-sm p-1" data-action="delete-note" data-id="${note.id}" title="Delete Note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }


  // 5. RENDER GENERAL DOCUMENTS TABLE
  function renderMiscDocumentsTable() {
    const tbody = document.getElementById('misc-tbody-documents');
    if (!tbody) return;

    let items = (typeof WorkPulseDB.getGeneralDocuments === 'function') ? WorkPulseDB.getGeneralDocuments() : [];

    // Filter
    if (miscFilterStatusVal && miscFilterStatusVal !== 'all') {
      items = items.filter(i => (i.status || '').toLowerCase() === miscFilterStatusVal.toLowerCase());
    }
    if (miscFilterPriorityVal && miscFilterPriorityVal !== 'all') {
      items = items.filter(i => (i.priority || '').toLowerCase() === miscFilterPriorityVal.toLowerCase());
    }
    if (miscFilterCategoryVal && miscFilterCategoryVal !== 'all') {
      items = items.filter(i => (i.category || '').toLowerCase() === miscFilterCategoryVal.toLowerCase());
    }
    if (miscFilterStaffVal && miscFilterStaffVal !== 'all') {
      items = items.filter(i => i.assignedStaffId === miscFilterStaffVal || i.staffId === miscFilterStaffVal || i.assignedStaffId === 'all');
    }
    if (miscSearchQuery) {
      const q = miscSearchQuery.toLowerCase();
      items = items.filter(i => 
        (i.title || '').toLowerCase().includes(q) ||
        (i.fileName || i.fileUrl || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.id || '').toLowerCase().includes(q)
      );
    }

    const countBadge = document.getElementById('misc-results-count');
    if (countBadge) countBadge.textContent = `${items.length} ${items.length === 1 ? 'Record' : 'Records'}`;

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-5" style="color: #94A3B8;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-2" style="opacity: 0.5;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <div style="font-size: 0.95rem; font-weight: 600; color: #475569;">No Corporate Documents Uploaded</div>
            <div style="font-size: 0.8rem;">Click "Upload Document" to share policies, templates, and company files.</div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items.map(doc => {
      const commentCount = (doc.comments && doc.comments.length) || 0;
      const hasFile = !!(doc.fileUrl || doc.attachmentUrl || doc.fileName);
      const fileName = doc.fileName || (doc.fileUrl ? doc.fileUrl.split('/').pop() : 'Document');
      return `
        <tr>
          <td>
            <div class="d-flex align-items-center gap-2">
              <div style="width: 32px; height: 32px; border-radius: 6px; background: rgba(29, 95, 143, 0.1); color: #1D5F8F; display: flex; align-items: center; justify-content: center;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              </div>
              <div>
                <div style="font-weight: 600; color: #0A192F; font-size: 0.86rem;">${escapeHtml(doc.title)}</div>
                <div style="font-size: 0.72rem; color: #64748B;">
                  ${hasFile ? `<a href="${doc.fileUrl || doc.attachmentUrl || '#'}" target="_blank" download="${escapeHtml(fileName)}" style="color: #1D5F8F; text-decoration: none;">📎 ${escapeHtml(fileName)}</a>` : 'No file attached'}
                </div>
              </div>
            </div>
          </td>
          <td><span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.72rem; border: 1px solid #E2E8F0;">${escapeHtml(doc.category || 'Policy')}</span></td>
          <td>
            <span class="badge" style="background: #EEF2FF; color: #4338CA; font-size: 0.72rem;">
              ${doc.assignedStaffName === 'all' || !doc.assignedStaffName ? '🌐 Company-Wide' : escapeHtml(doc.assignedStaffName)}
            </span>
          </td>
          <td><div style="font-size: 0.8rem; color: #1E293B;">${formatMiscDate(doc.date || doc.effectiveDate)}</div></td>
          <td class="text-center">${getMiscPriorityPill(doc.priority || doc.classification || 'Standard')}</td>
          <td class="text-center">${getMiscStatusBadge(doc.status)}</td>
          <td class="text-end">
            <div class="d-flex align-items-center justify-content-end gap-1">
              ${hasFile ? `
                <a href="${doc.fileUrl || doc.attachmentUrl || '#'}" target="_blank" download="${escapeHtml(fileName)}" class="btn btn-outline-primary btn-sm p-1" title="Download Document">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </a>
              ` : ''}
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="view-details" data-type="documents" data-id="${doc.id}" title="View Details & Comments (${commentCount})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                ${commentCount > 0 ? `<span class="badge bg-secondary ms-1" style="font-size: 0.65rem;">${commentCount}</span>` : ''}
              </button>
              <button class="btn btn-outline-secondary btn-sm p-1" data-action="edit-document" data-id="${doc.id}" title="Edit Document Record">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="btn btn-outline-danger btn-sm p-1" data-action="delete-document" data-id="${doc.id}" title="Delete Document">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ROOT MODULE RENDER
  function renderMiscModule() {
    updateMiscKpis();
    if (miscActiveSubtab === 'requests') renderMiscRequestsTable();
    else if (miscActiveSubtab === 'assets') renderMiscAssetsTable();
    else if (miscActiveSubtab === 'maintenance') renderMiscMaintenanceTable();
    else if (miscActiveSubtab === 'notes') renderMiscNotesTable();
    else if (miscActiveSubtab === 'documents') renderMiscDocumentsTable();
  }

  // UNIVERSAL DETAILS & COMMENT STREAM MODAL
  function openMiscDetailsModal(type, id) {
    let item = null;
    let typeLabel = 'Record';
    if (type === 'requests') {
      item = WorkPulseDB.getGeneralRequests().find(r => r.id === id);
      typeLabel = 'General Request';
    } else if (type === 'assets') {
      item = WorkPulseDB.getOfficeAssets().find(a => a.id === id);
      typeLabel = 'Office Equipment';
    } else if (type === 'maintenance') {
      item = WorkPulseDB.getMaintenanceIssues().find(m => m.id === id);
      typeLabel = 'Maintenance Issue';
    } else if (type === 'notes') {
      item = WorkPulseDB.getInternalNotes().find(n => n.id === id);
      typeLabel = 'Internal Note & Reminder';
    } else if (type === 'documents') {
      item = WorkPulseDB.getGeneralDocuments().find(d => d.id === id);
      typeLabel = 'General Document';
    }

    if (!item) {
      showToast('Record not found.', 'error');
      return;
    }

    miscDetailsCurrentItem = { type, id, item };

    const modal = document.getElementById('misc-details-modal');
    const titleEl = document.getElementById('misc-details-modal-title');
    const contentEl = document.getElementById('misc-details-modal-content');
    if (!modal || !contentEl) return;

    if (titleEl) titleEl.textContent = `[${typeLabel}] ${item.title || item.name || item.id}`;

    renderMiscDetailsModalContent();
    modal.classList.add('open');
  }

  function renderMiscDetailsModalContent() {
    if (!miscDetailsCurrentItem) return;
    const { type, id } = miscDetailsCurrentItem;
    const contentEl = document.getElementById('misc-details-modal-content');
    if (!contentEl) return;

    // Refresh latest item from DB
    let item = null;
    if (type === 'requests') item = WorkPulseDB.getGeneralRequests().find(r => r.id === id);
    else if (type === 'assets') item = WorkPulseDB.getOfficeAssets().find(a => a.id === id);
    else if (type === 'maintenance') item = WorkPulseDB.getMaintenanceIssues().find(m => m.id === id);
    else if (type === 'notes') item = WorkPulseDB.getInternalNotes().find(n => n.id === id);
    else if (type === 'documents') item = WorkPulseDB.getGeneralDocuments().find(d => d.id === id);
    if (!item) return;

    const comments = item.comments || [];
    const hasFile = !!(item.fileUrl || item.attachmentUrl || item.fileName);
    const fileName = item.fileName || (item.fileUrl ? item.fileUrl.split('/').pop() : 'Attachment');

    contentEl.innerHTML = `
      <div class="mb-4 p-3" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div class="d-flex align-items-center gap-2">
            <span style="font-size: 0.85rem; font-weight: 700; color: #1D5F8F;">${escapeHtml(item.id)}</span>
            <span class="badge" style="background: #E2E8F0; color: #334155;">${escapeHtml(item.category || 'General')}</span>
            ${item.priority ? getMiscPriorityPill(item.priority) : ''}
            ${item.status ? getMiscStatusBadge(item.status) : ''}
            ${item.isPinned ? '<span class="badge bg-warning-subtle text-warning">📌 Pinned</span>' : ''}
          </div>
          <span style="font-size: 0.78rem; color: #64748B;">Recorded: ${formatMiscDate(item.createdAt || item.date)}</span>
        </div>

        <h4 style="font-size: 1.1rem; font-weight: 700; color: #0A192F; margin-bottom: 8px;">${escapeHtml(item.title || item.name)}</h4>
        
        <div style="background: #FFFFFF; padding: 12px 14px; border-radius: 6px; border: 1px solid #E2E8F0; font-size: 0.88rem; color: #334155; line-height: 1.5; white-space: pre-wrap; margin-bottom: 12px;">
          ${escapeHtml(item.description || item.content || 'No details provided.')}
        </div>

        <div class="row g-2" style="font-size: 0.8rem; color: #475569;">
          ${item.staffName ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Staff / Requester:</span> <strong>${escapeHtml(item.staffName)}</strong> ${item.staffId ? `(${escapeHtml(item.staffId)})` : ''}
            </div>
          ` : ''}
          ${(item.assignedStaffName || item.assignedToName) ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Assigned Handler:</span> <strong>${escapeHtml(item.assignedStaffName || item.assignedToName)}</strong>
            </div>
          ` : ''}
          ${item.assetTag ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Asset Tag / Serial:</span> <code>${escapeHtml(item.assetTag)}</code>
            </div>
          ` : ''}
          ${item.condition ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Condition:</span> <strong>${escapeHtml(item.condition)}</strong>
            </div>
          ` : ''}
          ${item.location ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Location / Office Area:</span> <strong>${escapeHtml(item.location)}</strong>
            </div>
          ` : ''}
          ${item.returnDate || item.expectedReturnDate ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Expected Return:</span> <strong>${formatMiscDate(item.returnDate || item.expectedReturnDate)}</strong>
            </div>
          ` : ''}
          ${item.resolvedDate ? `
            <div class="col-sm-6">
              <span style="color: #64748B;">Resolved On:</span> <strong>${formatMiscDate(item.resolvedDate)}</strong>
            </div>
          ` : ''}
        </div>

        ${hasFile ? `
          <div class="mt-3 pt-2 border-top d-flex align-items-center justify-content-between">
            <div class="d-flex align-items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1D5F8F" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
              <span style="font-size: 0.82rem; font-weight: 600; color: #1E293B;">Attached File: ${escapeHtml(fileName)}</span>
            </div>
            <a href="${item.fileUrl || item.attachmentUrl || '#'}" target="_blank" download="${escapeHtml(fileName)}" class="btn btn-outline-primary btn-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="me-1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Download
            </a>
          </div>
        ` : ''}
      </div>

      <!-- COMMENTS & AUDIT TRAIL STREAM -->
      <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h5 style="font-size: 0.95rem; font-weight: 700; color: #0A192F; margin: 0;">
            Activity & Discussion Stream
            <span class="badge bg-secondary ms-1" style="font-size: 0.72rem;">${comments.length}</span>
          </h5>
          <span style="font-size: 0.74rem; color: #64748B;">Staff & Admin collaboration</span>
        </div>

        <div id="misc-comments-thread" class="mb-3" style="max-height: 240px; overflow-y: auto; padding-right: 4px;">
          ${comments.length === 0 ? `
            <div class="p-3 text-center" style="background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 6px; color: #94A3B8; font-size: 0.82rem;">
              No remarks or comments yet. Post the first administrative note below.
            </div>
          ` : comments.map(c => `
            <div class="misc-comment-card">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <div class="d-flex align-items-center gap-2">
                  <span class="misc-avatar-chip" style="width: 22px; height: 22px; font-size: 0.65rem;">${(c.author || 'AD').slice(0, 2).toUpperCase()}</span>
                  <span style="font-size: 0.82rem; font-weight: 600; color: #1E293B;">${escapeHtml(c.author || 'Admin')}</span>
                  <span class="badge ${c.role === 'admin' ? 'bg-primary-subtle text-primary' : 'bg-secondary-subtle text-secondary'}" style="font-size: 0.65rem;">${c.role || 'Admin'}</span>
                </div>
                <span style="font-size: 0.7rem; color: #94A3B8;">${formatMiscDate(c.date || c.createdAt)}</span>
              </div>
              <div style="font-size: 0.82rem; color: #334155; line-height: 1.4; padding-left: 30px;">
                ${escapeHtml(c.comment || c.text || '')}
              </div>
            </div>
          `).join('')}
        </div>

        <!-- NEW COMMENT INPUT FORM -->
        <div class="card p-2" style="background: #F8FAFC; border: 1px solid #E2E8F0;">
          <div class="d-flex gap-2">
            <textarea class="form-control form-control-sm" id="misc-new-comment-input" rows="2" placeholder="Write an administrative response, update note, or fulfillment comment..." style="font-size: 0.82rem;"></textarea>
            <button class="btn btn-primary btn-sm align-self-end" id="btn-submit-misc-comment" style="white-space: nowrap; height: 38px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="me-1"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              Post
            </button>
          </div>
        </div>
      </div>
    `;

    // Wire up Post Comment button
    const postBtn = document.getElementById('btn-submit-misc-comment');
    if (postBtn) {
      postBtn.addEventListener('click', () => {
        const inputEl = document.getElementById('misc-new-comment-input');
        if (!inputEl) return;
        const text = inputEl.value.trim();
        if (!text) {
          showToast('Please type a comment before posting.', 'error');
          return;
        }

        let res = null;
        if (type === 'requests') res = WorkPulseDB.addGeneralRequestComment(id, text, 'Administrator');
        else if (type === 'assets') res = WorkPulseDB.addOfficeAssetComment(id, text, 'Administrator');
        else if (type === 'maintenance') res = WorkPulseDB.addMaintenanceComment(id, text, 'Administrator');
        else if (type === 'notes') res = WorkPulseDB.addInternalNoteComment(id, text, 'Administrator');
        else if (type === 'documents') res = WorkPulseDB.addGeneralDocumentComment(id, text, 'Administrator');

        if (res) {
          showToast('Comment posted successfully.', 'success');
          WorkPulseDB.syncToServer();
          renderMiscDetailsModalContent();
          renderMiscModule(); // Refresh list comment badges in background
        } else {
          showToast('Failed to add comment.', 'error');
        }
      });
    }
  }

  // EXPORT CSV FOR ACTIVE SUBTAB
  function exportMiscToCsv() {
    let rows = [];
    let headers = [];
    let filename = `workpulse_${miscActiveSubtab}_${new Date().toISOString().slice(0, 10)}.csv`;

    if (miscActiveSubtab === 'requests') {
      const items = (typeof WorkPulseDB.getGeneralRequests === 'function') ? WorkPulseDB.getGeneralRequests() : [];
      headers = ['ID', 'Title', 'Category', 'Requester Name', 'Staff ID', 'Date', 'Priority', 'Status', 'Assigned Handler', 'Description'];
      rows = items.map(i => [
        i.id, i.title, i.category, i.staffName, i.staffId, i.date, i.priority, i.status, i.assignedStaffName || '', (i.description || '').replace(/"/g, '""')
      ]);
    } else if (miscActiveSubtab === 'assets') {
      const items = (typeof WorkPulseDB.getOfficeAssets === 'function') ? WorkPulseDB.getOfficeAssets() : [];
      headers = ['Asset Tag', 'Name', 'Category', 'Condition', 'Assigned To', 'Staff ID', 'Issued Date', 'Expected Return', 'Status', 'Priority'];
      rows = items.map(i => [
        i.assetTag || i.id, i.title || i.name, i.category, i.condition, i.assignedStaffName || i.assignedToName || 'Unassigned', i.assignedTo || '', i.date || '', i.returnDate || '', i.status, i.priority || ''
      ]);
    } else if (miscActiveSubtab === 'maintenance') {
      const items = (typeof WorkPulseDB.getMaintenanceIssues === 'function') ? WorkPulseDB.getMaintenanceIssues() : [];
      headers = ['ID', 'Title', 'Category', 'Location', 'Reported By', 'Date', 'Priority', 'Assigned Staff', 'Status', 'Description'];
      rows = items.map(i => [
        i.id, i.title, i.category, i.location, i.staffName, i.date || i.reportedDate, i.priority, i.assignedStaffName || '', i.status, (i.description || '').replace(/"/g, '""')
      ]);
    } else if (miscActiveSubtab === 'notes') {
      const items = (typeof WorkPulseDB.getInternalNotes === 'function') ? WorkPulseDB.getInternalNotes() : [];
      headers = ['ID', 'Title', 'Category', 'Target Audience', 'Reminder Date', 'Priority', 'Status', 'Pinned', 'Content'];
      rows = items.map(i => [
        i.id, i.title, i.category, i.assignedStaffName || 'All Staff', i.date || i.reminderDate, i.priority, i.status, i.isPinned ? 'Yes' : 'No', (i.description || i.content || '').replace(/"/g, '""')
      ]);
    } else if (miscActiveSubtab === 'documents') {
      const items = (typeof WorkPulseDB.getGeneralDocuments === 'function') ? WorkPulseDB.getGeneralDocuments() : [];
      headers = ['ID', 'Title', 'Category', 'Target Scope', 'Effective Date', 'Classification', 'Status', 'File Name', 'Summary'];
      rows = items.map(i => [
        i.id, i.title, i.category, i.assignedStaffName || 'Company-Wide', i.date || i.effectiveDate, i.priority || i.classification || 'Standard', i.status, i.fileName || '', (i.description || '').replace(/"/g, '""')
      ]);
    }

    if (rows.length === 0) {
      showToast('No records available to export.', 'warning');
      return;
    }

    let csvContent = headers.map(h => `"${h}"`).join(',') + '\n';
    rows.forEach(r => {
      csvContent += r.map(c => `"${c || ''}"`).join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${rows.length} ${miscActiveSubtab} records to CSV.`, 'success');
  }

  // ATTACH EVENT LISTENERS FOR MISC MODULE (Run Once)
  function initMiscEventListeners() {
    // 1. Subtab button click
    document.querySelectorAll('.misc-subtab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const subtab = btn.dataset.subtab;
        if (subtab) switchMiscSubtab(subtab);
      });
    });

    // 2. Filter & Search listeners
    const searchInp = document.getElementById('misc-search-input');
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        miscSearchQuery = e.target.value.trim();
        renderMiscModule();
      });
    }

    const stFilter = document.getElementById('misc-filter-status');
    if (stFilter) {
      stFilter.addEventListener('change', (e) => {
        miscFilterStatusVal = e.target.value;
        renderMiscModule();
      });
    }

    const priFilter = document.getElementById('misc-filter-priority');
    if (priFilter) {
      priFilter.addEventListener('change', (e) => {
        miscFilterPriorityVal = e.target.value;
        renderMiscModule();
      });
    }

    const catFilter = document.getElementById('misc-filter-category');
    if (catFilter) {
      catFilter.addEventListener('change', (e) => {
        miscFilterCategoryVal = e.target.value;
        renderMiscModule();
      });
    }

    const staffFilter = document.getElementById('misc-filter-staff');
    if (staffFilter) {
      staffFilter.addEventListener('change', (e) => {
        miscFilterStaffVal = e.target.value;
        renderMiscModule();
      });
    }

    const resetFiltersHandler = () => {
      miscSearchQuery = '';
      if (searchInp) searchInp.value = '';
      miscFilterStatusVal = 'all';
      miscFilterPriorityVal = 'all';
      miscFilterCategoryVal = 'all';
      miscFilterStaffVal = 'all';
      if (stFilter) stFilter.value = 'all';
      if (priFilter) priFilter.value = 'all';
      if (catFilter) catFilter.value = 'all';
      if (staffFilter) staffFilter.value = 'all';
      renderMiscModule();
    };

    ['btn-misc-filter-reset', 'btn-misc-reset-filters'].forEach(bId => {
      const resetBtn = document.getElementById(bId);
      if (resetBtn) resetBtn.addEventListener('click', resetFiltersHandler);
    });

    // 3. Export CSV button
    const expBtn = document.getElementById('btn-misc-export');
    if (expBtn) {
      expBtn.addEventListener('click', exportMiscToCsv);
    }

    // Modal Opening Helper Functions
    function openMiscRequestModal() {
      const form = document.getElementById('misc-request-form');
      if (form) form.reset();
      const idEl = document.getElementById('misc-request-id');
      if (idEl) idEl.value = '';
      const titleEl = document.getElementById('misc-request-modal-title');
      if (titleEl) titleEl.textContent = 'Create General Request';
      const dateEl = document.getElementById('misc-req-date');
      if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
      const reqDrop = document.getElementById('misc-req-requester');
      populateMiscStaffDropdown(reqDrop, false, false);
      const asgDrop = document.getElementById('misc-req-assigned');
      populateMiscStaffDropdown(asgDrop, true, false);
      const cWrap = document.getElementById('misc-req-initial-comment-wrap');
      if (cWrap) cWrap.style.display = 'block';
      const modal = document.getElementById('misc-request-modal');
      if (modal) modal.classList.add('open');
    }

    function openMiscAssetModal() {
      const form = document.getElementById('misc-asset-form');
      if (form) form.reset();
      const idEl = document.getElementById('misc-asset-id');
      if (idEl) idEl.value = '';
      const titleEl = document.getElementById('misc-asset-modal-title');
      if (titleEl) titleEl.textContent = 'Register Office Equipment';
      const tagEl = document.getElementById('misc-asset-tag');
      if (tagEl) tagEl.value = `WP-AST-${Math.floor(1000 + Math.random() * 9000)}`;
      const dateEl = document.getElementById('misc-asset-date');
      if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
      const staffDrop = document.getElementById('misc-asset-staff');
      populateMiscStaffDropdown(staffDrop, true, false);
      const modal = document.getElementById('misc-asset-modal');
      if (modal) modal.classList.add('open');
    }

    function openMiscMaintenanceModal() {
      const form = document.getElementById('misc-maintenance-form');
      if (form) form.reset();
      const idEl = document.getElementById('misc-maintenance-id');
      if (idEl) idEl.value = '';
      const titleEl = document.getElementById('misc-maintenance-modal-title');
      if (titleEl) titleEl.textContent = 'Report Office Maintenance Issue';
      const dateEl = document.getElementById('misc-maint-date');
      if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
      const repDrop = document.getElementById('misc-maint-reporter');
      populateMiscStaffDropdown(repDrop, false, false);
      const asgDrop = document.getElementById('misc-maint-assigned');
      populateMiscStaffDropdown(asgDrop, true, false);
      const modal = document.getElementById('misc-maintenance-modal');
      if (modal) modal.classList.add('open');
    }

    function openMiscNoteModal() {
      const form = document.getElementById('misc-note-form');
      if (form) form.reset();
      const idEl = document.getElementById('misc-note-id');
      if (idEl) idEl.value = '';
      const titleEl = document.getElementById('misc-note-modal-title');
      if (titleEl) titleEl.textContent = 'Create Internal Note & Reminder';
      const dateEl = document.getElementById('misc-note-date');
      if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
      const staffDrop = document.getElementById('misc-note-staff');
      populateMiscStaffDropdown(staffDrop, false, true);
      const modal = document.getElementById('misc-note-modal');
      if (modal) modal.classList.add('open');
    }

    function openMiscDocumentModal() {
      const form = document.getElementById('misc-document-form');
      if (form) form.reset();
      const idEl = document.getElementById('misc-doc-id');
      if (idEl) idEl.value = '';
      const titleEl = document.getElementById('misc-doc-modal-title');
      if (titleEl) titleEl.textContent = 'Upload Corporate Document';
      const dateEl = document.getElementById('misc-doc-date');
      if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
      const staffDrop = document.getElementById('misc-doc-staff');
      populateMiscStaffDropdown(staffDrop, false, true);
      const fileInfo = document.getElementById('misc-doc-file-info');
      if (fileInfo) fileInfo.textContent = 'Attach policy document, spreadsheet, PDF or guideline file.';
      const modal = document.getElementById('misc-document-modal');
      if (modal) modal.classList.add('open');
    }

    // 4. Dynamic "+ New Item" button opens appropriate modal based on active subtab
    const addBtn = document.getElementById('btn-misc-add-item');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (miscActiveSubtab === 'requests') openMiscRequestModal();
        else if (miscActiveSubtab === 'assets') openMiscAssetModal();
        else if (miscActiveSubtab === 'maintenance') openMiscMaintenanceModal();
        else if (miscActiveSubtab === 'notes') openMiscNoteModal();
        else if (miscActiveSubtab === 'documents') openMiscDocumentModal();
      });
    }

    // Quick Action Bar Buttons (top of pane)
    const btnQuickReq = document.getElementById('btn-misc-add-request');
    if (btnQuickReq) btnQuickReq.addEventListener('click', () => { switchMiscSubtab('requests'); openMiscRequestModal(); });
    const btnQuickAst = document.getElementById('btn-misc-add-asset');
    if (btnQuickAst) btnQuickAst.addEventListener('click', () => { switchMiscSubtab('assets'); openMiscAssetModal(); });
    const btnQuickMnt = document.getElementById('btn-misc-report-issue');
    if (btnQuickMnt) btnQuickMnt.addEventListener('click', () => { switchMiscSubtab('maintenance'); openMiscMaintenanceModal(); });
    const btnQuickNot = document.getElementById('btn-misc-add-note');
    if (btnQuickNot) btnQuickNot.addEventListener('click', () => { switchMiscSubtab('notes'); openMiscNoteModal(); });
    const btnQuickDoc = document.getElementById('btn-misc-upload-doc');
    if (btnQuickDoc) btnQuickDoc.addEventListener('click', () => { switchMiscSubtab('documents'); openMiscDocumentModal(); });

    // In-Pane Action Buttons (inside section headers)
    const btnPaneReq = document.getElementById('btn-pane-add-request');
    if (btnPaneReq) btnPaneReq.addEventListener('click', openMiscRequestModal);
    const btnPaneAst = document.getElementById('btn-pane-add-asset');
    if (btnPaneAst) btnPaneAst.addEventListener('click', openMiscAssetModal);
    const btnPaneMnt = document.getElementById('btn-pane-report-issue');
    if (btnPaneMnt) btnPaneMnt.addEventListener('click', openMiscMaintenanceModal);
    const btnPaneNot = document.getElementById('btn-pane-add-note');
    if (btnPaneNot) btnPaneNot.addEventListener('click', openMiscNoteModal);
    const btnPaneDoc = document.getElementById('btn-pane-upload-doc');
    if (btnPaneDoc) btnPaneDoc.addEventListener('click', openMiscDocumentModal);

    // KPI Cards Click -> Switch Subtab
    document.querySelectorAll('.misc-kpi-card[data-subtab]').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const subtab = card.dataset.subtab;
        if (subtab) switchMiscSubtab(subtab);
      });
    });

    // 5. Delegated Table Actions (Quick actions, details, edit, delete)
    const miscPane = document.getElementById('pane-misc');
    if (miscPane) {
      miscPane.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const type = btn.dataset.type;

        if (action === 'view-details') {
          openMiscDetailsModal(type, id);
        } else if (action === 'quick-approve-request') {
          WorkPulseDB.updateGeneralRequest(id, { status: 'Approved' });
          WorkPulseDB.addGeneralRequestComment(id, 'Request approved by Administrator.', 'Administrator');
          WorkPulseDB.syncToServer();
          showToast(`General request ${id} approved.`, 'success');
          updatePendingBadges();
          renderMiscModule();
        } else if (action === 'quick-reject-request') {
          const reason = prompt('Please enter a rejection reason (optional):') || 'Rejected by Administrator';
          WorkPulseDB.updateGeneralRequest(id, { status: 'Rejected' });
          WorkPulseDB.addGeneralRequestComment(id, `Request rejected: ${reason}`, 'Administrator');
          WorkPulseDB.syncToServer();
          showToast(`General request ${id} rejected.`, 'info');
          updatePendingBadges();
          renderMiscModule();
        } else if (action === 'quick-complete-request') {
          WorkPulseDB.updateGeneralRequest(id, { status: 'Completed' });
          WorkPulseDB.addGeneralRequestComment(id, 'Request marked as completed/fulfilled by Administrator.', 'Administrator');
          WorkPulseDB.syncToServer();
          showToast(`General request ${id} marked completed!`, 'success');
          renderMiscModule();
        } else if (action === 'edit-request') {
          const req = WorkPulseDB.getGeneralRequests().find(r => r.id === id);
          if (!req) return;
          const idEl = document.getElementById('misc-request-id');
          if (idEl) idEl.value = req.id;
          const titleModal = document.getElementById('misc-request-modal-title');
          if (titleModal) titleModal.textContent = `Edit Request: ${req.id}`;
          const tInp = document.getElementById('misc-req-title');
          if (tInp) tInp.value = req.title || '';
          const cInp = document.getElementById('misc-req-category');
          if (cInp) cInp.value = req.category || 'IT Equipment';
          const dInp = document.getElementById('misc-req-desc');
          if (dInp) dInp.value = req.description || '';
          const rDrop = document.getElementById('misc-req-requester');
          populateMiscStaffDropdown(rDrop, false, false);
          if (rDrop) rDrop.value = req.staffId || '';
          const aDrop = document.getElementById('misc-req-assigned');
          populateMiscStaffDropdown(aDrop, true, false);
          if (aDrop) aDrop.value = req.assignedStaffId || '';
          const pInp = document.getElementById('misc-req-priority');
          if (pInp) pInp.value = req.priority || 'Medium';
          const dtInp = document.getElementById('misc-req-date');
          if (dtInp) dtInp.value = req.date || '';
          const stInp = document.getElementById('misc-req-status');
          if (stInp) stInp.value = req.status || 'Pending';
          const cWrap = document.getElementById('misc-req-initial-comment-wrap');
          if (cWrap) cWrap.style.display = 'none';
          const modal = document.getElementById('misc-request-modal');
          if (modal) modal.classList.add('open');
        } else if (action === 'delete-request') {
          if (confirm(`Are you sure you want to delete general request ${id}?`)) {
            WorkPulseDB.deleteGeneralRequest(id);
            WorkPulseDB.syncToServer();
            showToast(`General request ${id} deleted.`, 'warning');
            updatePendingBadges();
            renderMiscModule();
          }
        } else if (action === 'quick-return-asset') {
          WorkPulseDB.updateOfficeAsset(id, { 
            status: 'Available', 
            assignedTo: '', 
            assignedStaffId: '', 
            assignedStaffName: 'Unassigned',
            assignedToName: 'Unassigned',
            returnDate: new Date().toISOString().split('T')[0]
          });
          WorkPulseDB.addOfficeAssetComment(id, 'Asset checked in / returned to storage inventory.', 'Administrator');
          WorkPulseDB.syncToServer();
          showToast(`Equipment marked as returned to storage inventory.`, 'success');
          renderMiscModule();
        } else if (action === 'edit-asset') {
          const ast = WorkPulseDB.getOfficeAssets().find(a => a.id === id);
          if (!ast) return;
          const idEl = document.getElementById('misc-asset-id');
          if (idEl) idEl.value = ast.id;
          const titleModal = document.getElementById('misc-asset-modal-title');
          if (titleModal) titleModal.textContent = `Edit Equipment: ${ast.assetTag || ast.id}`;
          const tInp = document.getElementById('misc-asset-title');
          if (tInp) tInp.value = ast.title || ast.name || '';
          const tagInp = document.getElementById('misc-asset-tag');
          if (tagInp) tagInp.value = ast.assetTag || '';
          const cInp = document.getElementById('misc-asset-category');
          if (cInp) cInp.value = ast.category || 'IT Hardware';
          const condInp = document.getElementById('misc-asset-condition');
          if (condInp) condInp.value = ast.condition || 'Good';
          const dInp = document.getElementById('misc-asset-desc');
          if (dInp) dInp.value = ast.description || '';
          const sDrop = document.getElementById('misc-asset-staff');
          populateMiscStaffDropdown(sDrop, true, false);
          if (sDrop) sDrop.value = ast.assignedTo || ast.assignedStaffId || '';
          const stInp = document.getElementById('misc-asset-status');
          if (stInp) stInp.value = ast.status || 'Available';
          const dtInp = document.getElementById('misc-asset-date');
          if (dtInp) dtInp.value = ast.date || ast.assignedDate || '';
          const rdtInp = document.getElementById('misc-asset-return-date');
          if (rdtInp) rdtInp.value = ast.returnDate || ast.expectedReturnDate || '';
          const priInp = document.getElementById('misc-asset-priority');
          if (priInp) priInp.value = ast.priority || 'Medium';
          const modal = document.getElementById('misc-asset-modal');
          if (modal) modal.classList.add('open');
        } else if (action === 'delete-asset') {
          if (confirm(`Are you sure you want to delete asset ${id}?`)) {
            WorkPulseDB.deleteOfficeAsset(id);
            WorkPulseDB.syncToServer();
            showToast(`Asset record deleted.`, 'warning');
            renderMiscModule();
          }
        } else if (action === 'quick-resolve-maintenance') {
          WorkPulseDB.updateMaintenanceIssue(id, { 
            status: 'Resolved',
            resolvedDate: new Date().toISOString().split('T')[0]
          });
          WorkPulseDB.addMaintenanceComment(id, 'Issue resolved and inspected by facility administration.', 'Administrator');
          WorkPulseDB.syncToServer();
          showToast(`Maintenance issue ${id} marked Resolved!`, 'success');
          renderMiscModule();
        } else if (action === 'edit-maintenance') {
          const mnt = WorkPulseDB.getMaintenanceIssues().find(m => m.id === id);
          if (!mnt) return;
          const idEl = document.getElementById('misc-maintenance-id');
          if (idEl) idEl.value = mnt.id;
          const titleModal = document.getElementById('misc-maintenance-modal-title');
          if (titleModal) titleModal.textContent = `Edit Maintenance Issue: ${mnt.id}`;
          const tInp = document.getElementById('misc-maint-title');
          if (tInp) tInp.value = mnt.title || '';
          const cInp = document.getElementById('misc-maint-category');
          if (cInp) cInp.value = mnt.category || 'Electrical';
          const locInp = document.getElementById('misc-maint-location');
          if (locInp) locInp.value = mnt.location || '';
          const dInp = document.getElementById('misc-maint-desc');
          if (dInp) dInp.value = mnt.description || '';
          const rDrop = document.getElementById('misc-maint-reporter');
          populateMiscStaffDropdown(rDrop, false, false);
          if (rDrop) rDrop.value = mnt.staffId || '';
          const aDrop = document.getElementById('misc-maint-assigned');
          populateMiscStaffDropdown(aDrop, true, false);
          if (aDrop) aDrop.value = mnt.assignedStaffId || '';
          const priInp = document.getElementById('misc-maint-priority');
          if (priInp) priInp.value = mnt.priority || 'Medium';
          const dtInp = document.getElementById('misc-maint-date');
          if (dtInp) dtInp.value = mnt.date || mnt.reportedDate || '';
          const tgtInp = document.getElementById('misc-maint-target-date');
          if (tgtInp) tgtInp.value = mnt.targetDate || '';
          const stInp = document.getElementById('misc-maint-status');
          if (stInp) stInp.value = mnt.status || 'Reported';
          const modal = document.getElementById('misc-maintenance-modal');
          if (modal) modal.classList.add('open');
        } else if (action === 'delete-maintenance') {
          if (confirm(`Are you sure you want to delete maintenance issue ${id}?`)) {
            WorkPulseDB.deleteMaintenanceIssue(id);
            WorkPulseDB.syncToServer();
            showToast(`Maintenance issue ${id} deleted.`, 'warning');
            renderMiscModule();
          }
        } else if (action === 'toggle-pin-note') {
          WorkPulseDB.toggleInternalNotePin(id);
          WorkPulseDB.syncToServer();
          renderMiscModule();
        } else if (action === 'edit-note') {
          const note = WorkPulseDB.getInternalNotes().find(n => n.id === id);
          if (!note) return;
          const idEl = document.getElementById('misc-note-id');
          if (idEl) idEl.value = note.id;
          const titleModal = document.getElementById('misc-note-modal-title');
          if (titleModal) titleModal.textContent = `Edit Note: ${note.id}`;
          const tInp = document.getElementById('misc-note-title');
          if (tInp) tInp.value = note.title || '';
          const cInp = document.getElementById('misc-note-category');
          if (cInp) cInp.value = note.category || 'Internal Policy';
          const dInp = document.getElementById('misc-note-desc');
          if (dInp) dInp.value = note.description || note.content || '';
          const sDrop = document.getElementById('misc-note-staff');
          populateMiscStaffDropdown(sDrop, false, true);
          if (sDrop) sDrop.value = note.assignedStaffId || 'all';
          const dtInp = document.getElementById('misc-note-date');
          if (dtInp) dtInp.value = note.date || note.reminderDate || '';
          const priInp = document.getElementById('misc-note-priority');
          if (priInp) priInp.value = note.priority || 'Medium';
          const stInp = document.getElementById('misc-note-status');
          if (stInp) stInp.value = note.status || 'Active';
          const pinInp = document.getElementById('misc-note-pinned');
          if (pinInp) pinInp.checked = !!note.isPinned;
          const modal = document.getElementById('misc-note-modal');
          if (modal) modal.classList.add('open');
        } else if (action === 'delete-note') {
          if (confirm(`Are you sure you want to delete internal note ${id}?`)) {
            WorkPulseDB.deleteInternalNote(id);
            WorkPulseDB.syncToServer();
            showToast(`Internal note ${id} deleted.`, 'warning');
            renderMiscModule();
          }
        } else if (action === 'edit-document') {
          const doc = WorkPulseDB.getGeneralDocuments().find(d => d.id === id);
          if (!doc) return;
          const idEl = document.getElementById('misc-doc-id');
          if (idEl) idEl.value = doc.id;
          const titleModal = document.getElementById('misc-doc-modal-title');
          if (titleModal) titleModal.textContent = `Edit Document: ${doc.title}`;
          const tInp = document.getElementById('misc-doc-title');
          if (tInp) tInp.value = doc.title || '';
          const cInp = document.getElementById('misc-doc-category');
          if (cInp) cInp.value = doc.category || 'Company Policies';
          const dInp = document.getElementById('misc-doc-desc');
          if (dInp) dInp.value = doc.description || '';
          const sDrop = document.getElementById('misc-doc-staff');
          populateMiscStaffDropdown(sDrop, false, true);
          if (sDrop) sDrop.value = doc.assignedStaffId || 'all';
          const priInp = document.getElementById('misc-doc-priority');
          if (priInp) priInp.value = doc.priority || doc.classification || 'Standard';
          const dtInp = document.getElementById('misc-doc-date');
          if (dtInp) dtInp.value = doc.date || doc.effectiveDate || '';
          const stInp = document.getElementById('misc-doc-status');
          if (stInp) stInp.value = doc.status || 'Active';
          const fInfo = document.getElementById('misc-doc-file-info');
          if (fInfo) fInfo.textContent = doc.fileName ? `Existing file: ${doc.fileName}. Choose a new file to replace.` : 'No file currently attached.';
          const modal = document.getElementById('misc-document-modal');
          if (modal) modal.classList.add('open');
        } else if (action === 'delete-document') {
          if (confirm(`Are you sure you want to delete document ${id}?`)) {
            WorkPulseDB.deleteGeneralDocument(id);
            WorkPulseDB.syncToServer();
            showToast(`Document record deleted.`, 'warning');
            renderMiscModule();
          }
        }
      });
    }

    // 6. Modal close handlers
    [
      { btnId: 'btn-close-misc-request-modal', modalId: 'misc-request-modal' },
      { btnId: 'btn-cancel-misc-request', modalId: 'misc-request-modal' },
      { btnId: 'btn-close-misc-asset-modal', modalId: 'misc-asset-modal' },
      { btnId: 'btn-cancel-misc-asset', modalId: 'misc-asset-modal' },
      { btnId: 'btn-close-misc-maint-modal', modalId: 'misc-maintenance-modal' },
      { btnId: 'btn-cancel-misc-maint', modalId: 'misc-maintenance-modal' },
      { btnId: 'btn-close-misc-note-modal', modalId: 'misc-note-modal' },
      { btnId: 'btn-cancel-misc-note', modalId: 'misc-note-modal' },
      { btnId: 'btn-close-misc-doc-modal', modalId: 'misc-document-modal' },
      { btnId: 'btn-cancel-misc-doc', modalId: 'misc-document-modal' },
      { btnId: 'btn-close-misc-details-modal', modalId: 'misc-details-modal' },
      { btnId: 'btn-dismiss-misc-details', modalId: 'misc-details-modal' }
    ].forEach(({ btnId, modalId }) => {
      const btn = document.getElementById(btnId);
      const modal = document.getElementById(modalId);
      if (btn && modal) {
        btn.addEventListener('click', () => modal.classList.remove('open'));
      }
    });

    // Close on backdrop click
    ['misc-request-modal', 'misc-asset-modal', 'misc-maintenance-modal', 'misc-note-modal', 'misc-document-modal', 'misc-details-modal'].forEach(mId => {
      const el = document.getElementById(mId);
      if (el) {
        el.addEventListener('click', (e) => {
          if (e.target === el) el.classList.remove('open');
        });
      }
    });

    // 7. FORM SUBMISSIONS
    // Form 1: General Request
    const reqForm = document.getElementById('misc-request-form');
    if (reqForm) {
      reqForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('misc-request-id').value;
        const title = document.getElementById('misc-req-title').value.trim();
        const category = document.getElementById('misc-req-category').value;
        const description = document.getElementById('misc-req-desc').value.trim();
        const staffId = document.getElementById('misc-req-requester').value;
        const assignedStaffId = document.getElementById('misc-req-assigned').value;
        const priority = document.getElementById('misc-req-priority').value;
        const date = document.getElementById('misc-req-date').value || new Date().toISOString().split('T')[0];
        const status = document.getElementById('misc-req-status').value;
        const initialComment = (document.getElementById('misc-req-initial-comment') || {}).value;

        const staffObj = (typeof WorkPulseDB.getStaffById === 'function') ? WorkPulseDB.getStaffById(staffId) : null;
        const staffName = staffObj ? staffObj.name : staffId;
        const asgObj = (typeof WorkPulseDB.getStaffById === 'function') ? WorkPulseDB.getStaffById(assignedStaffId) : null;
        const assignedStaffName = asgObj ? asgObj.name : (assignedStaffId ? 'Admin Desk' : '');

        const data = {
          title,
          category,
          description,
          staffId,
          staffName,
          assignedStaffId,
          assignedStaffName,
          priority,
          date,
          status
        };

        if (id) {
          WorkPulseDB.updateGeneralRequest(id, data);
          showToast(`General request ${id} updated.`, 'success');
        } else {
          const newReq = WorkPulseDB.addGeneralRequest(data);
          if (initialComment && initialComment.trim() && newReq) {
            WorkPulseDB.addGeneralRequestComment(newReq.id, initialComment.trim(), 'Administrator');
          }
          showToast(`General request created successfully!`, 'success');
        }

        const modal = document.getElementById('misc-request-modal');
        if (modal) modal.classList.remove('open');
        WorkPulseDB.syncToServer();
        updatePendingBadges();
        renderMiscModule();
      });
    }

    // Form 2: Office Asset
    const astForm = document.getElementById('misc-asset-form');
    if (astForm) {
      astForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('misc-asset-id').value;
        const title = document.getElementById('misc-asset-title').value.trim();
        let assetTag = document.getElementById('misc-asset-tag').value.trim();
        if (!assetTag) assetTag = `WP-AST-${Math.floor(1000 + Math.random() * 9000)}`;
        const category = document.getElementById('misc-asset-category').value;
        const condition = document.getElementById('misc-asset-condition').value;
        const description = document.getElementById('misc-asset-desc').value.trim();
        const assignedTo = document.getElementById('misc-asset-staff').value;
        const status = document.getElementById('misc-asset-status').value;
        const date = document.getElementById('misc-asset-date').value || new Date().toISOString().split('T')[0];
        const returnDate = document.getElementById('misc-asset-return-date').value;
        const priority = document.getElementById('misc-asset-priority').value;

        const staffObj = (typeof WorkPulseDB.getStaffById === 'function') ? WorkPulseDB.getStaffById(assignedTo) : null;
        const assignedStaffName = staffObj ? staffObj.name : (assignedTo ? assignedTo : 'Unassigned');

        const data = {
          title,
          name: title,
          assetTag,
          category,
          condition,
          description,
          assignedTo,
          assignedStaffId: assignedTo,
          assignedStaffName,
          assignedToName: assignedStaffName,
          status,
          date,
          assignedDate: date,
          returnDate,
          expectedReturnDate: returnDate,
          priority
        };

        if (id) {
          WorkPulseDB.updateOfficeAsset(id, data);
          showToast(`Asset ${assetTag} updated.`, 'success');
        } else {
          WorkPulseDB.addOfficeAsset(data);
          showToast(`Asset registered successfully!`, 'success');
        }

        const modal = document.getElementById('misc-asset-modal');
        if (modal) modal.classList.remove('open');
        WorkPulseDB.syncToServer();
        renderMiscModule();
      });
    }

    // Form 3: Office Maintenance Issue
    const mntForm = document.getElementById('misc-maintenance-form');
    if (mntForm) {
      mntForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('misc-maintenance-id').value;
        const title = document.getElementById('misc-maint-title').value.trim();
        const category = document.getElementById('misc-maint-category').value;
        const location = document.getElementById('misc-maint-location').value.trim();
        const description = document.getElementById('misc-maint-desc').value.trim();
        const staffId = document.getElementById('misc-maint-reporter').value;
        const assignedStaffId = document.getElementById('misc-maint-assigned').value;
        const priority = document.getElementById('misc-maint-priority').value;
        const date = document.getElementById('misc-maint-date').value || new Date().toISOString().split('T')[0];
        const targetDate = document.getElementById('misc-maint-target-date').value;
        const status = document.getElementById('misc-maint-status').value;

        const staffObj = (typeof WorkPulseDB.getStaffById === 'function') ? WorkPulseDB.getStaffById(staffId) : null;
        const staffName = staffObj ? staffObj.name : (staffId || 'Facility Team');
        const asgObj = (typeof WorkPulseDB.getStaffById === 'function') ? WorkPulseDB.getStaffById(assignedStaffId) : null;
        const assignedStaffName = asgObj ? asgObj.name : (assignedStaffId || 'Facility Lead');

        const data = {
          title,
          category,
          location,
          description,
          staffId,
          staffName,
          assignedStaffId,
          assignedStaffName,
          priority,
          date,
          reportedDate: date,
          targetDate,
          status
        };

        if (id) {
          WorkPulseDB.updateMaintenanceIssue(id, data);
          showToast(`Maintenance issue ${id} updated.`, 'success');
        } else {
          WorkPulseDB.addMaintenanceIssue(data);
          showToast(`Maintenance issue logged successfully!`, 'success');
        }

        const modal = document.getElementById('misc-maintenance-modal');
        if (modal) modal.classList.remove('open');
        WorkPulseDB.syncToServer();
        renderMiscModule();
      });
    }

    // Form 4: Internal Note & Reminder
    const noteForm = document.getElementById('misc-note-form');
    if (noteForm) {
      noteForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('misc-note-id').value;
        const title = document.getElementById('misc-note-title').value.trim();
        const category = document.getElementById('misc-note-category').value;
        const description = document.getElementById('misc-note-desc').value.trim();
        const assignedStaffId = document.getElementById('misc-note-staff').value;
        const date = document.getElementById('misc-note-date').value || new Date().toISOString().split('T')[0];
        const priority = document.getElementById('misc-note-priority').value;
        const status = document.getElementById('misc-note-status').value;
        const isPinned = document.getElementById('misc-note-pinned').checked;

        const staffObj = (typeof WorkPulseDB.getStaffById === 'function') ? WorkPulseDB.getStaffById(assignedStaffId) : null;
        const assignedStaffName = (assignedStaffId === 'all') ? 'all' : (staffObj ? staffObj.name : assignedStaffId);

        const data = {
          title,
          category,
          description,
          content: description,
          assignedStaffId,
          assignedStaffName,
          date,
          reminderDate: date,
          priority,
          status,
          isPinned
        };

        if (id) {
          WorkPulseDB.updateInternalNote(id, data);
          showToast(`Internal note updated.`, 'success');
        } else {
          WorkPulseDB.addInternalNote(data);
          showToast(`Internal note created successfully!`, 'success');
        }

        const modal = document.getElementById('misc-note-modal');
        if (modal) modal.classList.remove('open');
        WorkPulseDB.syncToServer();
        renderMiscModule();
      });
    }

    // Form 5: Corporate Document
    const docForm = document.getElementById('misc-document-form');
    if (docForm) {
      docForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('misc-doc-id').value;
        const title = document.getElementById('misc-doc-title').value.trim();
        const category = document.getElementById('misc-doc-category').value;
        const description = document.getElementById('misc-doc-desc').value.trim();
        const assignedStaffId = document.getElementById('misc-doc-staff').value;
        const priority = document.getElementById('misc-doc-priority').value;
        const date = document.getElementById('misc-doc-date').value || new Date().toISOString().split('T')[0];
        const status = document.getElementById('misc-doc-status').value;
        const fileInput = document.getElementById('misc-doc-file');

        const staffObj = (typeof WorkPulseDB.getStaffById === 'function') ? WorkPulseDB.getStaffById(assignedStaffId) : null;
        const assignedStaffName = (assignedStaffId === 'all') ? 'all' : (staffObj ? staffObj.name : assignedStaffId);

        const saveDocument = (fileData = null) => {
          const existingDoc = id ? WorkPulseDB.getGeneralDocuments().find(d => d.id === id) : null;
          const data = {
            title,
            category,
            description,
            assignedStaffId,
            assignedStaffName,
            priority,
            classification: priority,
            date,
            effectiveDate: date,
            status
          };

          if (fileData) {
            data.fileName = fileData.name;
            data.fileSize = fileData.size;
            data.fileUrl = fileData.url;
            data.attachmentUrl = fileData.url;
          } else if (existingDoc) {
            data.fileName = existingDoc.fileName;
            data.fileSize = existingDoc.fileSize;
            data.fileUrl = existingDoc.fileUrl;
            data.attachmentUrl = existingDoc.attachmentUrl;
          }

          if (id) {
            WorkPulseDB.updateGeneralDocument(id, data);
            showToast(`Document record updated.`, 'success');
          } else {
            WorkPulseDB.addGeneralDocument(data);
            showToast(`Document uploaded successfully!`, 'success');
          }

          const modal = document.getElementById('misc-document-modal');
          if (modal) modal.classList.remove('open');
          WorkPulseDB.syncToServer();
          renderMiscModule();
        };

        if (fileInput && fileInput.files && fileInput.files[0]) {
          const file = fileInput.files[0];
          const reader = new FileReader();
          reader.onload = (re) => {
            saveDocument({
              name: file.name,
              size: file.size,
              url: re.target.result
            });
          };
          reader.onerror = () => {
            saveDocument({ name: file.name, size: file.size, url: '' });
          };
          reader.readAsDataURL(file);
        } else {
          saveDocument();
        }
      });
    }

    // Populate initial filter dropdowns
    populateMiscFilterDropdowns();
  }

  // Initialize event listeners when DOM is loaded
  initMiscEventListeners();
  if (typeof initDomainManagementModule === 'function') initDomainManagementModule();

  // Initial load: resolve view from hash first, then localStorage, defaulting to dashboard
  const savedHash = (window.location.hash || '').replace(/^#/, '').trim();
  const savedLocal = localStorage.getItem('workpulse_admin_last_view');
  const initialView = validViews.includes(savedHash) ? savedHash : (validViews.includes(savedLocal) ? savedLocal : 'dashboard');

  renderAdminProfileUI();
  initAdminLiveClock();
  switchView(initialView);

  // Listen for browser Back/Forward or manual hash navigation
  window.addEventListener('hashchange', () => {
    const hash = (window.location.hash || '').replace(/^#/, '').trim();
    if (hash && validViews.includes(hash) && hash !== currentView) {
      switchView(hash);
    }
  });

  // Synchronize state with persistent backend database on page load
  WorkPulseDB.initServerSync(() => {
    renderAdminProfileUI();
    switchView(currentView);
  });

  // Start continuous cross-device auto-sync
  WorkPulseDB.startAutoSync(4000, () => {
    const isModalOpen = !!document.querySelector('.modal-backdrop.open');
    if (!isModalOpen) {
      renderAdminProfileUI();
      if (typeof switchView === 'function' && currentView) {
        if (currentView === 'leaves') {
          renderLeavesTable();
          updatePendingBadges();
        } else if (currentView === 'wfh') {
          renderWfhTable();
          updatePendingBadges();
        } else if (currentView === 'misc') {
          renderMiscModule();
          updatePendingBadges();
        } else if (currentView === 'leads') {
          renderLeads();
        } else if (currentView === 'domains') {
          if (typeof renderDomains === 'function') renderDomains();
        } else {
          switchView(currentView);
        }
      }
    }
  });
});
