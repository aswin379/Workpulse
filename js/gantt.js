/**
 * WORKPULSE ENTERPRISE GANTT CHART MODULE (js/gantt.js)
 * High-performance, synchronized timeline scheduler for WorkPulse Projects & Tasks.
 * Features:
 * - Dynamic Day / Week / Month timeline views
 * - Strict 6-color status differentiation (Backlog, To Do, In Progress, In Review, Completed, On Hold)
 * - Real-time Overdue task calculation and visual alert highlights
 * - Task subtask progress visualization with inner progress fills
 * - Assigned staff resolution with tooltip avatars
 * - Synchronized with Projects, Kanban, and Tasks tables
 * - Interactive quick date adjustment persisting directly to backend API
 * - Role-scoped permissions (Admin manages all; Staff scoped to assigned)
 */

window.WorkPulseGantt = (function() {
  'use strict';

  // Per-instance state (keyed by container ID)
  const instances = {};

  // Status Colors & Badges mapping
  const STATUS_CONFIG = {
    'Backlog': { color: '#64748B', bg: '#F1F5F9', border: '#CBD5E1', text: '#334155', cls: 'status-backlog' },
    'To Do': { color: '#2563EB', bg: '#DBEAFE', border: '#93C5FD', text: '#1E40AF', cls: 'status-todo' },
    'In Progress': { color: '#D97706', bg: '#FEF3C7', border: '#FDE68A', text: '#92400E', cls: 'status-inprogress' },
    'In Review': { color: '#7C3AED', bg: '#EDE9FE', border: '#DDD6FE', text: '#5B21B6', cls: 'status-inreview' },
    'Completed': { color: '#059669', bg: '#D1FAE5', border: '#A7F3D0', text: '#065F46', cls: 'status-completed' },
    'On Hold': { color: '#DC2626', bg: '#FEE2E2', border: '#FECACA', text: '#991B1B', cls: 'status-onhold' },
    'Pending': { color: '#D97706', bg: '#FEF3C7', border: '#FDE68A', text: '#92400E', cls: 'status-inprogress' }
  };

  /**
   * Helper: Parse YYYY-MM-DD or ISO string into local midnight Date
   */
  function parseLocalDate(str) {
    if (!str) return null;
    if (str instanceof Date) {
      return new Date(str.getFullYear(), str.getMonth(), str.getDate(), 0, 0, 0, 0);
    }
    const clean = String(str).split('T')[0].trim();
    const parts = clean.split('-');
    if (parts.length < 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d, 0, 0, 0, 0);
  }

  /**
   * Helper: Format local Date to YYYY-MM-DD
   */
  function formatLocalDate(d) {
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Helper: Format local Date to DD-MM-YYYY for user display
   */
  function formatDisplayLocalDate(d) {
    if (!d) return '';
    if (typeof WorkPulseDB !== 'undefined' && typeof WorkPulseDB.formatDisplayDate === 'function') {
      return WorkPulseDB.formatDisplayDate(d);
    }
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    return `${day}-${m}-${y}`;
  }

  /**
   * Helper: Escape HTML string
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Helper: Resolve staff names & avatars
   */
  function resolveStaffData(task, staffList) {
    const list = Array.isArray(staffList) ? staffList : [];
    let staffIds = [];
    if (Array.isArray(task.assignedStaffIds) && task.assignedStaffIds.length > 0) {
      staffIds = task.assignedStaffIds;
    } else if (task.assignedStaffId) {
      staffIds = [task.assignedStaffId];
    }

    if (staffIds.includes('all')) {
      return {
        isAll: true,
        displayName: 'All Staff Members',
        avatars: [{ name: 'All Staff', initials: 'ALL', bg: '#1D5F8F' }]
      };
    }

    if (staffIds.length === 0) {
      return {
        isAll: false,
        displayName: 'Unassigned',
        avatars: [{ name: 'Unassigned', initials: '--', bg: '#94A3B8' }]
      };
    }

    const avatars = [];
    const names = [];
    staffIds.forEach(sid => {
      const s = list.find(st => st.id === sid);
      const name = s ? s.name : (task.assignedStaffName || sid);
      names.push(name);
      const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'ST';
      avatars.push({
        name,
        initials,
        bg: '#1D5F8F'
      });
    });

    return {
      isAll: false,
      displayName: names.join(', '),
      avatars
    };
  }

  /**
   * Compute task progress percentage
   */
  function getTaskProgress(task) {
    if (task.status === 'Completed') return 100;
    if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
      const comp = task.subtasks.filter(s => s.completed).length;
      return Math.round((comp / task.subtasks.length) * 100);
    }
    if (task.status === 'In Review') return 85;
    if (task.status === 'In Progress') return 50;
    if (task.status === 'To Do') return 15;
    return 0;
  }

  /**
   * Main Render Method
   */
  function render(options) {
    const containerEl = typeof options.container === 'string'
      ? document.getElementById(options.container)
      : options.container;

    if (!containerEl) {
      console.warn('[WorkPulseGantt] Container not found:', options.container);
      return;
    }

    const containerId = containerEl.id || 'gantt-root';
    if (!instances[containerId]) {
      instances[containerId] = {
        filterProject: 'all',
        filterStaff: 'all',
        filterStatus: 'all',
        filterOverdueOnly: false,
        searchQuery: '',
        viewMode: 'days', // 'days' | 'weeks' | 'months'
        collapsedProjects: new Set(),
        collapsedTasks: new Set(),
        panOffsetDays: 0
      };
    }
    const state = instances[containerId];

    const isAdmin = Boolean(options.isAdmin);
    const currentStaff = options.currentStaff || null;
    const allProjects = Array.isArray(options.projects) ? options.projects : [];
    const allTasks = Array.isArray(options.tasks) ? options.tasks : [];
    const staffList = Array.isArray(options.staffList) ? options.staffList : [];

    // 1. Role-based scoping for Staff
    let scopedProjects = allProjects;
    let scopedTasks = allTasks;

    if (!isAdmin && currentStaff) {
      const staffId = currentStaff.id;
      scopedProjects = allProjects.filter(p => {
        const pIds = Array.isArray(p.assignedStaffIds) ? p.assignedStaffIds : [p.assignedStaffId];
        return pIds.includes(staffId) || pIds.includes('all');
      });

      scopedTasks = allTasks.filter(t => {
        const tIds = Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds : [t.assignedStaffId];
        return tIds.includes(staffId) || tIds.includes('all');
      });
    }

    // 2. Identify Overdue tasks and compute KPI metrics
    const today = parseLocalDate(new Date());
    const todayTime = today.getTime();
    const todayStr = formatLocalDate(today);

    scopedTasks.forEach(t => {
      const due = parseLocalDate(t.dueDate);
      t._isOverdue = Boolean(due && due.getTime() < todayTime && t.status !== 'Completed');
      t._daysOverdue = t._isOverdue ? Math.max(1, Math.round((todayTime - due.getTime()) / 86400000)) : 0;
      t._progress = getTaskProgress(t);
    });

    const totalTasksCount = scopedTasks.length;
    const completedTasksCount = scopedTasks.filter(t => t.status === 'Completed').length;
    const inProgressTasksCount = scopedTasks.filter(t => t.status === 'In Progress').length;
    const inReviewTasksCount = scopedTasks.filter(t => t.status === 'In Review').length;
    const overdueTasksCount = scopedTasks.filter(t => t._isOverdue).length;
    const overallProgress = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

    // 3. Apply Filters
    let filteredTasks = scopedTasks.slice();
    let filteredProjects = scopedProjects.slice();

    if (state.filterProject !== 'all') {
      filteredTasks = filteredTasks.filter(t => t.projectId === state.filterProject);
      filteredProjects = filteredProjects.filter(p => p.id === state.filterProject);
    }

    if (state.filterStaff !== 'all' && isAdmin) {
      filteredTasks = filteredTasks.filter(t => {
        const ids = Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds : [t.assignedStaffId];
        return ids.includes(state.filterStaff) || ids.includes('all');
      });
      filteredProjects = filteredProjects.filter(p => {
        const ids = Array.isArray(p.assignedStaffIds) ? p.assignedStaffIds : [p.assignedStaffId];
        return ids.includes(state.filterStaff) || ids.includes('all');
      });
    }

    if (state.filterStatus !== 'all') {
      filteredTasks = filteredTasks.filter(t => t.status === state.filterStatus);
    }

    if (state.filterOverdueOnly) {
      filteredTasks = filteredTasks.filter(t => t._isOverdue);
      // Keep only projects that have overdue tasks
      const overdueProjectIds = new Set(filteredTasks.map(t => t.projectId).filter(Boolean));
      filteredProjects = filteredProjects.filter(p => overdueProjectIds.has(p.id));
    }

    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase().trim();
      filteredTasks = filteredTasks.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.projectName && t.projectName.toLowerCase().includes(q)) ||
        (t.assignedStaffName && t.assignedStaffName.toLowerCase().includes(q))
      );
      const matchedPrjIds = new Set(filteredTasks.map(t => t.projectId).filter(Boolean));
      filteredProjects = filteredProjects.filter(p => 
        matchedPrjIds.has(p.id) || 
        (p.name && p.name.toLowerCase().includes(q)) || 
        (p.description && p.description.toLowerCase().includes(q))
      );
    }

    // 4. Calculate Timeline Scale & Bounds
    let minDate = new Date(today);
    minDate.setDate(minDate.getDate() - 7);
    let maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 21);

    // Expand bounds based on visible projects & tasks
    [...filteredProjects, ...filteredTasks].forEach(item => {
      const s = parseLocalDate(item.startDate || item.assignedDate || item.createdAt);
      const d = parseLocalDate(item.dueDate);
      if (s && s < minDate) minDate = new Date(s);
      if (d && d > maxDate) maxDate = new Date(d);
    });

    // Add visual comfort padding
    minDate.setDate(minDate.getDate() - 5);
    maxDate.setDate(maxDate.getDate() + 10);

    // Timeline column geometry
    let colWidth = 38; // px per unit
    let stepUnit = 'day';
    if (state.viewMode === 'weeks') {
      colWidth = 90;
      stepUnit = 'week';
    } else if (state.viewMode === 'months') {
      colWidth = 140;
      stepUnit = 'month';
    }

    const totalDays = Math.max(15, Math.round((maxDate.getTime() - minDate.getTime()) / 86400000));
    const timelineStartMs = minDate.getTime();

    // 5. Build HTML Markup
    let html = `
      <div class="gantt-chart-wrapper" id="${containerId}-wrapper">
        <!-- Gantt Controls & Filter Toolbar -->
        <div class="gantt-controls-card">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <div class="d-flex align-items-center gap-2 flex-wrap" style="flex: 1;">
              <span style="font-size:0.75rem; font-weight:700; color:var(--navy-dark); text-transform:uppercase;">Gantt Filters:</span>
              
              <!-- Search -->
              <input type="text" class="form-control form-control-sm gantt-filter-input" id="${containerId}-search" placeholder="Search project or task..." value="${escapeHtml(state.searchQuery)}" style="width:190px;">
              
              <!-- Project Filter -->
              <select class="form-control form-control-sm gantt-filter-input" id="${containerId}-filter-project" style="width:180px;">
                <option value="all" ${state.filterProject === 'all' ? 'selected' : ''}>All Projects (${scopedProjects.length})</option>
                ${scopedProjects.map(p => `
                  <option value="${p.id}" ${state.filterProject === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>
                `).join('')}
              </select>

              ${isAdmin ? `
                <!-- Staff Filter (Admin Only) -->
                <select class="form-control form-control-sm gantt-filter-input" id="${containerId}-filter-staff" style="width:170px;">
                  <option value="all" ${state.filterStaff === 'all' ? 'selected' : ''}>All Staff Members</option>
                  ${staffList.map(s => `
                    <option value="${s.id}" ${state.filterStaff === s.id ? 'selected' : ''}>${escapeHtml(s.name)} (${s.id})</option>
                  `).join('')}
                </select>
              ` : ''}

              <!-- Status Filter -->
              <select class="form-control form-control-sm gantt-filter-input" id="${containerId}-filter-status" style="width:140px;">
                <option value="all" ${state.filterStatus === 'all' ? 'selected' : ''}>All Statuses</option>
                <option value="Backlog" ${state.filterStatus === 'Backlog' ? 'selected' : ''}>Backlog</option>
                <option value="To Do" ${state.filterStatus === 'To Do' ? 'selected' : ''}>To Do</option>
                <option value="In Progress" ${state.filterStatus === 'In Progress' ? 'selected' : ''}>In Progress</option>
                <option value="In Review" ${state.filterStatus === 'In Review' ? 'selected' : ''}>In Review</option>
                <option value="Completed" ${state.filterStatus === 'Completed' ? 'selected' : ''}>Completed</option>
                <option value="On Hold" ${state.filterStatus === 'On Hold' ? 'selected' : ''}>On Hold</option>
              </select>

              <!-- Overdue Only Toggle Button -->
              <button class="btn btn-sm ${state.filterOverdueOnly ? 'btn-danger' : 'btn-secondary'} gantt-toggle-overdue" id="${containerId}-btn-overdue" style="display:inline-flex; align-items:center; gap:5px; font-weight:700;">
                <span>⚠️ Overdue Only</span>
                <span class="badge" style="background:${state.filterOverdueOnly ? '#FFFFFF' : '#DC2626'}; color:${state.filterOverdueOnly ? '#DC2626' : '#FFFFFF'}; font-size:0.68rem; padding:2px 6px;">${overdueTasksCount}</span>
              </button>
            </div>

            <!-- Timeline Navigation & Zoom Controls -->
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <div class="btn-group" role="group">
                <button type="button" class="btn btn-sm ${state.viewMode === 'days' ? 'btn-primary' : 'btn-secondary'} gantt-zoom-btn" data-mode="days">Days</button>
                <button type="button" class="btn btn-sm ${state.viewMode === 'weeks' ? 'btn-primary' : 'btn-secondary'} gantt-zoom-btn" data-mode="weeks">Weeks</button>
                <button type="button" class="btn btn-sm ${state.viewMode === 'months' ? 'btn-primary' : 'btn-secondary'} gantt-zoom-btn" data-mode="months">Months</button>
              </div>

              <div class="btn-group" role="group">
                <button type="button" class="btn btn-sm btn-secondary gantt-nav-btn" data-action="prev" title="Shift timeline left">‹ Prev</button>
                <button type="button" class="btn btn-sm btn-secondary gantt-nav-btn" data-action="today" style="font-weight:700; color:var(--royal-blue);" title="Jump to Today">Today</button>
                <button type="button" class="btn btn-sm btn-secondary gantt-nav-btn" data-action="next" title="Shift timeline right">Next ›</button>
              </div>

              <button class="btn btn-ghost btn-sm gantt-reset-filters" id="${containerId}-btn-reset" style="font-size:0.75rem; color:var(--royal-blue);">Reset</button>
            </div>
          </div>

          <!-- KPI Summary Bar -->
          <div class="gantt-kpi-bar mb-2">
            <div class="gantt-kpi-card">
              <div class="gantt-kpi-label">Active Projects</div>
              <div class="gantt-kpi-value">${filteredProjects.length}</div>
            </div>
            <div class="gantt-kpi-card">
              <div class="gantt-kpi-label">Total Tasks</div>
              <div class="gantt-kpi-value">${filteredTasks.length}</div>
            </div>
            <div class="gantt-kpi-card">
              <div class="gantt-kpi-label">In Progress</div>
              <div class="gantt-kpi-value" style="color:#D97706;">${filteredTasks.filter(t => t.status === 'In Progress').length}</div>
            </div>
            <div class="gantt-kpi-card">
              <div class="gantt-kpi-label">In Review</div>
              <div class="gantt-kpi-value" style="color:#7C3AED;">${filteredTasks.filter(t => t.status === 'In Review').length}</div>
            </div>
            <div class="gantt-kpi-card">
              <div class="gantt-kpi-label">Completed</div>
              <div class="gantt-kpi-value" style="color:#059669;">${filteredTasks.filter(t => t.status === 'Completed').length} <span style="font-size:0.80rem; font-weight:600; color:#64748B;">(${overallProgress}%)</span></div>
            </div>
            <div class="gantt-kpi-card kpi-overdue ${state.filterOverdueOnly ? 'active-filter' : ''}" id="${containerId}-kpi-overdue-card" title="Click to filter overdue tasks">
              <div class="gantt-kpi-label">
                <span>Overdue Tasks</span>
                <span>⚠️</span>
              </div>
              <div class="gantt-kpi-value text-overdue">${overdueTasksCount}</div>
            </div>
          </div>

          <!-- Legend Bar -->
          <div class="gantt-legend-bar">
            <span style="font-size:0.70rem; font-weight:700; color:var(--navy-dark); text-transform:uppercase;">Status Colors:</span>
            <div class="gantt-legend-item"><span class="gantt-legend-swatch" style="background:#64748B;"></span> Backlog</div>
            <div class="gantt-legend-item"><span class="gantt-legend-swatch" style="background:#2563EB;"></span> To Do</div>
            <div class="gantt-legend-item"><span class="gantt-legend-swatch" style="background:#D97706;"></span> In Progress</div>
            <div class="gantt-legend-item"><span class="gantt-legend-swatch" style="background:#7C3AED;"></span> In Review</div>
            <div class="gantt-legend-item"><span class="gantt-legend-swatch" style="background:#059669;"></span> Completed</div>
            <div class="gantt-legend-item"><span class="gantt-legend-swatch" style="background:#DC2626;"></span> On Hold</div>
            <div class="gantt-legend-item ms-auto" style="color:#DC2626;">
              <span style="display:inline-block; width:14px; height:10px; border:2px solid #DC2626; border-radius:2px; background:#FEE2E2;"></span> Red Glowing = Overdue
            </div>
          </div>
        </div>

        <!-- Gantt Main Split Screen -->
        <div class="gantt-main-card">
          <div class="gantt-split-view" id="${containerId}-split-view">
            <!-- Left Sidebar (Tree Table) -->
            <div class="gantt-sidebar-pane" id="${containerId}-sidebar">
              <div class="gantt-sidebar-header">
                <div style="flex:1;">Project / Task Hierarchy</div>
                <div style="width:75px; text-align:right;">Progress</div>
              </div>
              <div class="gantt-sidebar-rows-wrap" id="${containerId}-sidebar-rows">
                <!-- Populated row by row -->
              </div>
            </div>

            <!-- Right Timeline View -->
            <div class="gantt-timeline-pane" id="${containerId}-timeline">
              <div class="gantt-timeline-header-wrap" id="${containerId}-timeline-header">
                <!-- Months row & Days row populated dynamically -->
              </div>
              <div class="gantt-timeline-body" id="${containerId}-timeline-body">
                <!-- Background day/grid lines, Today line, and Task/Project bars -->
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    containerEl.innerHTML = html;

    // 6. Build the Grid Structure and Populate Rows
    const sidebarRowsWrap = document.getElementById(`${containerId}-sidebar-rows`);
    const timelineHeaderWrap = document.getElementById(`${containerId}-timeline-header`);
    const timelineBody = document.getElementById(`${containerId}-timeline-body`);

    // Generate Month Header & Day Header Columns
    let monthsHtml = `<div class="gantt-timeline-months">`;
    let daysHtml = `<div class="gantt-timeline-days">`;
    let gridColsHtml = `<div class="gantt-grid-columns">`;

    let currentCursor = new Date(minDate);
    let monthStartCursor = new Date(minDate);
    let monthDaysCount = 0;
    let currentMonthName = currentCursor.toLocaleString('default', { month: 'long', year: 'numeric' });

    let todayOffsetPx = null;
    let totalTimelineWidth = 0;

    for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
      const iterDate = new Date(minDate);
      iterDate.setDate(iterDate.getDate() + dayIdx);
      const isWeekend = iterDate.getDay() === 0 || iterDate.getDay() === 6;
      const isToday = iterDate.getTime() === todayTime;
      const dayNum = iterDate.getDate();
      const weekDayName = iterDate.toLocaleString('default', { weekday: 'narrow' });
      const monthName = iterDate.toLocaleString('default', { month: 'long', year: 'numeric' });

      if (isToday) {
        todayOffsetPx = dayIdx * colWidth;
      }

      // Track Month headers
      if (monthName !== currentMonthName) {
        const monthWidth = monthDaysCount * colWidth;
        monthsHtml += `<div class="gantt-timeline-month-cell" style="width:${monthWidth}px;">${escapeHtml(currentMonthName)}</div>`;
        currentMonthName = monthName;
        monthDaysCount = 0;
      }
      monthDaysCount++;

      // Day Column Header
      daysHtml += `
        <div class="gantt-day-header-cell ${isWeekend ? 'is-weekend' : ''} ${isToday ? 'is-today' : ''}" style="width:${colWidth}px;" title="${formatDisplayLocalDate(iterDate)}">
          <span>${dayNum}</span>
          <span style="font-size:0.60rem; opacity:0.8;">${weekDayName}</span>
        </div>
      `;

      // Background grid line
      gridColsHtml += `
        <div class="gantt-grid-col ${isWeekend ? 'is-weekend' : ''} ${isToday ? 'is-today' : ''}" style="width:${colWidth}px;"></div>
      `;
    }

    // Flush last month
    const lastMonthWidth = monthDaysCount * colWidth;
    monthsHtml += `<div class="gantt-timeline-month-cell" style="width:${lastMonthWidth}px;">${escapeHtml(currentMonthName)}</div>`;
    monthsHtml += `</div>`;
    daysHtml += `</div>`;
    gridColsHtml += `</div>`;

    timelineHeaderWrap.innerHTML = monthsHtml + daysHtml;
    totalTimelineWidth = totalDays * colWidth;

    // Build Rows: Group tasks under projects
    let sidebarHtml = '';
    let timelineRowsHtml = '';

    // Grouping
    const projectTaskMap = {};
    filteredProjects.forEach(p => {
      projectTaskMap[p.id] = [];
    });
    const standaloneTasks = [];

    filteredTasks.forEach(t => {
      if (t.projectId && projectTaskMap[t.projectId]) {
        projectTaskMap[t.projectId].push(t);
      } else {
        standaloneTasks.push(t);
      }
    });

    // Helper: Position calculation
    function calculateBarPosition(startDateStr, dueDateStr) {
      const s = parseLocalDate(startDateStr) || minDate;
      const d = parseLocalDate(dueDateStr) || new Date(s.getTime() + 7 * 86400000);
      const safeD = d < s ? s : d;

      const offsetDays = (s.getTime() - timelineStartMs) / 86400000;
      const spanDays = Math.max(1, (safeD.getTime() - s.getTime()) / 86400000 + 1);

      const leftPx = Math.max(0, offsetDays * colWidth);
      const widthPx = Math.max(28, spanDays * colWidth);
      return { leftPx, widthPx, s, d: safeD };
    }

    // Render Project and Task Rows
    filteredProjects.forEach(p => {
      const pTasks = projectTaskMap[p.id] || [];
      const isCollapsed = state.collapsedProjects.has(p.id);
      const pPos = calculateBarPosition(p.startDate, p.dueDate);
      
      // Compute project progress
      let pCompleted = pTasks.filter(t => t.status === 'Completed').length;
      let pTotal = pTasks.length;
      let pProgress = pTotal > 0 ? Math.round((pCompleted / pTotal) * 100) : 0;
      if (p.status === 'Completed') pProgress = 100;

      // Project Sidebar Row
      sidebarHtml += `
        <div class="gantt-sidebar-row gantt-row-project" data-project-id="${p.id}" id="gsidebar-prj-${p.id}" title="Click to toggle or view project details">
          <div class="d-flex align-items-center gap-2" style="flex:1; overflow:hidden;">
            <span class="gantt-collapse-toggle" data-project-id="${p.id}" style="cursor:pointer; font-size:0.75rem; width:16px; color:#1D5F8F;">
              ${isCollapsed ? '▶' : '▼'}
            </span>
            <span style="font-size:0.95rem;">📁</span>
            <span style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--navy-dark);" title="${escapeHtml(p.name)}">
              ${escapeHtml(p.name)}
            </span>
            <span class="badge badge-sm" style="background:#E2E8F0; color:#334155; font-size:0.65rem;">${pTasks.length} tasks</span>
          </div>
          <div class="d-flex align-items-center gap-1" style="width:75px; justify-content:flex-end;">
            <span class="badge" style="background:var(--royal-blue); color:#FFFFFF; font-size:0.70rem; font-weight:700;">${pProgress}%</span>
          </div>
        </div>
      `;

      // Project Timeline Row
      timelineRowsHtml += `
        <div class="gantt-timeline-row gantt-trow-project" id="gtrow-prj-${p.id}" style="width:${totalTimelineWidth}px;">
          <div class="gantt-bar-project" data-project-id="${p.id}" style="left:${pPos.leftPx}px; width:${pPos.widthPx}px;" title="Project: ${escapeHtml(p.name)} (${p.startDate || '--'} to ${p.dueDate || '--'}) - Progress: ${pProgress}%">
            <div class="gantt-project-progress-fill" style="width:${pProgress}%;"></div>
            <div class="gantt-bar-label">
              <span>📁 ${escapeHtml(p.name)}</span>
              <span style="font-weight:800; font-size:0.65rem; color:#FDE68A;">(${pProgress}%)</span>
            </div>
          </div>
        </div>
      `;

      // Task Rows under Project
      if (!isCollapsed) {
        pTasks.forEach(t => {
          const tPos = calculateBarPosition(t.startDate || t.assignedDate || t.createdAt, t.dueDate);
          const staffData = resolveStaffData(t, staffList);
          const statConfig = STATUS_CONFIG[t.status] || STATUS_CONFIG['To Do'];
          const subtasksCount = Array.isArray(t.subtasks) ? t.subtasks.length : 0;
          const completedSubtasks = Array.isArray(t.subtasks) ? t.subtasks.filter(s => s.completed).length : 0;
          const isTaskCollapsed = state.collapsedTasks.has(t.id);

          // Sidebar Task Row
          sidebarHtml += `
            <div class="gantt-sidebar-row gantt-row-task ${t._isOverdue ? 'is-overdue-row' : ''}" data-task-id="${t.id}" id="gsidebar-tsk-${t.id}">
              <div class="d-flex align-items-center gap-1" style="flex:1; overflow:hidden;">
                ${subtasksCount > 0 ? `
                  <span class="gantt-task-collapse-toggle" data-task-id="${t.id}" title="Toggle subtasks">
                    ${isTaskCollapsed ? '▶' : '▼'}
                  </span>
                ` : '<span style="width:14px; display:inline-block;"></span>'}
                <span style="color:#94A3B8; font-size:0.75rem;">📋</span>
                <span class="text-truncate" style="font-weight:600; color:var(--navy-dark);" title="${escapeHtml(t.title)}">
                  ${escapeHtml(t.title)}
                </span>
                ${t._isOverdue ? `
                  <span class="gantt-overdue-badge" title="Overdue by ${t._daysOverdue} days! Due date was ${t.dueDate}">
                    ⚠️ ${t._daysOverdue}d Late
                  </span>
                ` : ''}
              </div>
              <div class="d-flex align-items-center gap-2" style="flex-shrink:0;">
                <!-- Staff Avatar circle -->
                <div class="avatar-circle-sm" style="width:22px; height:22px; border-radius:50%; background:#1D5F8F; color:#FFFFFF; font-size:0.60rem; font-weight:700; display:flex; align-items:center; justify-content:center;" title="Assigned: ${escapeHtml(staffData.displayName)}">
                  ${escapeHtml(staffData.avatars[0]?.initials || 'ST')}
                </div>
                <!-- Status pill -->
                <span class="badge" style="background:${statConfig.bg}; color:${statConfig.text}; border:1px solid ${statConfig.border}; font-size:0.65rem; font-weight:700; padding:2px 6px;">
                  ${escapeHtml(t.status)}
                </span>
                <!-- Quick Date Edit button -->
                <button type="button" class="btn btn-ghost btn-sm gantt-quick-edit-date-btn p-0" data-task-id="${t.id}" title="Quick Edit Dates" style="color:#64748B; width:18px; height:18px;">
                  ✎
                </button>
              </div>
            </div>
          `;

          // Timeline Task Bar Row
          timelineRowsHtml += `
            <div class="gantt-timeline-row gantt-trow-task ${t._isOverdue ? 'is-overdue-row' : ''}" id="gtrow-tsk-${t.id}" style="width:${totalTimelineWidth}px;">
              <div class="gantt-bar-task ${statConfig.cls} ${t._isOverdue ? 'is-overdue' : ''}" data-task-id="${t.id}" style="left:${tPos.leftPx}px; width:${tPos.widthPx}px;" title="Task: ${escapeHtml(t.title)}\nStatus: ${t.status}\nAssigned: ${escapeHtml(staffData.displayName)}\nDates: ${formatDisplayLocalDate(tPos.s)} to ${formatDisplayLocalDate(tPos.d)}${t._isOverdue ? `\n⚠️ OVERDUE by ${t._daysOverdue} days!` : ''}\nSubtasks: ${completedSubtasks}/${subtasksCount}">
                <div class="gantt-task-progress-fill" style="width:${t._progress}%;"></div>
                <div class="gantt-bar-content">
                  <span class="avatar-sm-circle" style="width:18px; height:18px; border-radius:50%; background:rgba(0,0,0,0.25); color:#FFFFFF; font-size:0.55rem; font-weight:800; display:inline-flex; align-items:center; justify-content:center;">
                    ${escapeHtml(staffData.avatars[0]?.initials || 'ST')}
                  </span>
                  <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    ${escapeHtml(t.title)}
                  </span>
                  ${subtasksCount > 0 ? `
                    <span style="font-size:0.62rem; opacity:0.9; background:rgba(0,0,0,0.2); padding:1px 4px; border-radius:3px;">
                      ✓ ${completedSubtasks}/${subtasksCount}
                    </span>
                  ` : ''}
                  ${t._isOverdue ? `
                    <span style="background:#DC2626; color:#FFFFFF; font-size:0.58rem; font-weight:800; padding:1px 4px; border-radius:3px;">
                      OVERDUE
                    </span>
                  ` : ''}
                </div>
              </div>
            </div>
          `;

          // Subtasks Rows under this Task (Requirement 3: project tasks and subtasks on a timeline)
          if (subtasksCount > 0 && !isTaskCollapsed) {
            t.subtasks.forEach(sub => {
              const subStart = sub.startDate || t.startDate || t.assignedDate || t.createdAt;
              const subDue = sub.dueDate || t.dueDate;
              const subPos = calculateBarPosition(subStart, subDue);
              const subCls = sub.completed ? 'status-completed' : (t.status === 'In Progress' ? 'status-inprogress' : 'status-todo');

              // Sidebar Subtask Row
              sidebarHtml += `
                <div class="gantt-sidebar-row gantt-row-subtask" data-task-id="${t.id}" data-subtask-id="${sub.id}" id="gsidebar-sub-${sub.id}">
                  <div class="d-flex align-items-center gap-2" style="flex:1; overflow:hidden;">
                    <input type="checkbox" class="gantt-subtask-toggle" data-task-id="${t.id}" data-subtask-id="${sub.id}" ${sub.completed ? 'checked' : ''} style="cursor:pointer;" title="Toggle subtask completion">
                    <span class="text-truncate" style="${sub.completed ? 'text-decoration:line-through; color:#94A3B8;' : 'color:#334155; font-weight:500;'}" title="${escapeHtml(sub.title)}">
                      ${escapeHtml(sub.title)}
                    </span>
                  </div>
                  <div style="flex-shrink:0;">
                    <span class="badge" style="font-size:0.62rem; ${sub.completed ? 'background:#D1FAE5; color:#065F46; border:1px solid #A7F3D0;' : 'background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;'}">
                      ${sub.completed ? 'Completed' : (sub.dueDate ? sub.dueDate.substring(5) : 'Active')}
                    </span>
                  </div>
                </div>
              `;

              // Timeline Subtask Row
              timelineRowsHtml += `
                <div class="gantt-timeline-row gantt-trow-subtask" id="gtrow-sub-${sub.id}" style="width:${totalTimelineWidth}px;">
                  <div class="gantt-bar-subtask ${subCls}" data-task-id="${t.id}" data-subtask-id="${sub.id}" style="left:${subPos.leftPx}px; width:${subPos.widthPx}px;" title="Subtask: ${escapeHtml(sub.title)} (${sub.completed ? 'Completed' : 'Pending'})">
                    <span>${sub.completed ? '✓' : '○'} ${escapeHtml(sub.title)}</span>
                  </div>
                </div>
              `;
            });
          }
        });
      }
    });

    // Render Standalone Tasks (if any)
    if (standaloneTasks.length > 0) {
      sidebarHtml += `
        <div class="gantt-sidebar-row gantt-row-project" style="background:#F8FAFC; border-left-color:#64748B;">
          <div class="d-flex align-items-center gap-2" style="flex:1;">
            <span style="font-size:0.95rem;">📌</span>
            <span style="font-weight:700; color:#334155;">General / Standalone Tasks</span>
            <span class="badge badge-sm" style="background:#E2E8F0; color:#334155;">${standaloneTasks.length}</span>
          </div>
        </div>
      `;
      timelineRowsHtml += `
        <div class="gantt-timeline-row" style="width:${totalTimelineWidth}px; background:#F8FAFC;"></div>
      `;

      standaloneTasks.forEach(t => {
        const tPos = calculateBarPosition(t.startDate || t.assignedDate || t.createdAt, t.dueDate);
        const staffData = resolveStaffData(t, staffList);
        const statConfig = STATUS_CONFIG[t.status] || STATUS_CONFIG['To Do'];
        const subtasksCount = Array.isArray(t.subtasks) ? t.subtasks.length : 0;
        const completedSubtasks = Array.isArray(t.subtasks) ? t.subtasks.filter(s => s.completed).length : 0;

        sidebarHtml += `
          <div class="gantt-sidebar-row gantt-row-task ${t._isOverdue ? 'is-overdue-row' : ''}" data-task-id="${t.id}" id="gsidebar-tsk-${t.id}">
            <div class="d-flex align-items-center gap-2" style="flex:1; overflow:hidden;">
              <span style="color:#94A3B8; font-size:0.75rem;">└ 📋</span>
              <span class="text-truncate" style="font-weight:600; color:var(--navy-dark);" title="${escapeHtml(t.title)}">
                ${escapeHtml(t.title)}
              </span>
              ${t._isOverdue ? `
                <span class="gantt-overdue-badge">⚠️ ${t._daysOverdue}d Late</span>
              ` : ''}
            </div>
            <div class="d-flex align-items-center gap-2" style="flex-shrink:0;">
              <div class="avatar-circle-sm" style="width:22px; height:22px; border-radius:50%; background:#1D5F8F; color:#FFFFFF; font-size:0.60rem; font-weight:700; display:flex; align-items:center; justify-content:center;" title="${escapeHtml(staffData.displayName)}">
                ${escapeHtml(staffData.avatars[0]?.initials || 'ST')}
              </div>
              <span class="badge" style="background:${statConfig.bg}; color:${statConfig.text}; border:1px solid ${statConfig.border}; font-size:0.65rem; font-weight:700;">
                ${escapeHtml(t.status)}
              </span>
              <button type="button" class="btn btn-ghost btn-sm gantt-quick-edit-date-btn p-0" data-task-id="${t.id}" title="Quick Edit Dates" style="color:#64748B; width:18px; height:18px;">
                ✎
              </button>
            </div>
          </div>
        `;

        timelineRowsHtml += `
          <div class="gantt-timeline-row gantt-trow-task ${t._isOverdue ? 'is-overdue-row' : ''}" id="gtrow-tsk-${t.id}" style="width:${totalTimelineWidth}px;">
            <div class="gantt-bar-task ${statConfig.cls} ${t._isOverdue ? 'is-overdue' : ''}" data-task-id="${t.id}" style="left:${tPos.leftPx}px; width:${tPos.widthPx}px;" title="Task: ${escapeHtml(t.title)}\nStatus: ${t.status}\nAssigned: ${escapeHtml(staffData.displayName)}\nDates: ${formatDisplayLocalDate(tPos.s)} to ${formatDisplayLocalDate(tPos.d)}">
              <div class="gantt-task-progress-fill" style="width:${t._progress}%;"></div>
              <div class="gantt-bar-content">
                <span class="avatar-sm-circle" style="width:18px; height:18px; border-radius:50%; background:rgba(0,0,0,0.25); color:#FFFFFF; font-size:0.55rem; font-weight:800; display:inline-flex; align-items:center; justify-content:center;">
                  ${escapeHtml(staffData.avatars[0]?.initials || 'ST')}
                </span>
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                  ${escapeHtml(t.title)}
                </span>
                ${subtasksCount > 0 ? `
                  <span style="font-size:0.62rem; opacity:0.9; background:rgba(0,0,0,0.2); padding:1px 4px; border-radius:3px;">
                    ✓ ${completedSubtasks}/${subtasksCount}
                  </span>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      });
    }

    if (filteredProjects.length === 0 && standaloneTasks.length === 0) {
      sidebarHtml = `
        <div class="p-4 text-center text-muted" style="font-size:0.85rem;">
          No projects or tasks match your current filters.
        </div>
      `;
      timelineRowsHtml = `
        <div class="p-4 text-center text-muted" style="width:${totalTimelineWidth}px;">
          No timeline items to display.
        </div>
      `;
    }

    sidebarRowsWrap.innerHTML = sidebarHtml;

    // Timeline Body HTML (Grid columns + Today Line + Timeline Bars)
    let todayLineHtml = '';
    if (todayOffsetPx !== null) {
      todayLineHtml = `
        <div class="gantt-today-line" style="left:${todayOffsetPx + (colWidth / 2)}px;">
          <div class="gantt-today-pill">Today</div>
        </div>
      `;
    }

    timelineBody.innerHTML = `
      ${gridColsHtml}
      ${todayLineHtml}
      <div class="gantt-timeline-rows-container" style="position:relative; z-index:5;">
        ${timelineRowsHtml}
      </div>
    `;

    // 7. Attach Interactive Event Listeners
    setupEventListeners(containerId, options, allTasks, allProjects, todayOffsetPx);
  }

  /**
   * Setup Event Listeners for Filters, Modals, Date Edits, and Syncing
   */
  function setupEventListeners(containerId, options, allTasks, allProjects, todayOffsetPx) {
    const state = instances[containerId];
    const wrapper = document.getElementById(`${containerId}-wrapper`);
    if (!wrapper) return;

    // Filter Change Handlers
    const searchInput = document.getElementById(`${containerId}-search`);
    if (searchInput) {
      let debounceTimer = null;
      searchInput.addEventListener('input', e => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.searchQuery = e.target.value;
          render(options);
        }, 250);
      });
    }

    const prjSelect = document.getElementById(`${containerId}-filter-project`);
    if (prjSelect) {
      prjSelect.addEventListener('change', e => {
        state.filterProject = e.target.value;
        render(options);
      });
    }

    const staffSelect = document.getElementById(`${containerId}-filter-staff`);
    if (staffSelect) {
      staffSelect.addEventListener('change', e => {
        state.filterStaff = e.target.value;
        render(options);
      });
    }

    const statusSelect = document.getElementById(`${containerId}-filter-status`);
    if (statusSelect) {
      statusSelect.addEventListener('change', e => {
        state.filterStatus = e.target.value;
        render(options);
      });
    }

    const overdueBtn = document.getElementById(`${containerId}-btn-overdue`);
    if (overdueBtn) {
      overdueBtn.addEventListener('click', () => {
        state.filterOverdueOnly = !state.filterOverdueOnly;
        render(options);
      });
    }

    const overdueKpiCard = document.getElementById(`${containerId}-kpi-overdue-card`);
    if (overdueKpiCard) {
      overdueKpiCard.addEventListener('click', () => {
        state.filterOverdueOnly = !state.filterOverdueOnly;
        render(options);
      });
    }

    const resetBtn = document.getElementById(`${containerId}-btn-reset`);
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.filterProject = 'all';
        state.filterStaff = 'all';
        state.filterStatus = 'all';
        state.filterOverdueOnly = false;
        state.searchQuery = '';
        render(options);
      });
    }

    // Zoom Buttons
    wrapper.querySelectorAll('.gantt-zoom-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.viewMode = btn.dataset.mode;
        render(options);
      });
    });

    // Navigation Buttons
    wrapper.querySelectorAll('.gantt-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const timelinePane = document.getElementById(`${containerId}-timeline`);
        if (!timelinePane) return;

        if (action === 'today') {
          if (todayOffsetPx !== null) {
            timelinePane.scrollTo({
              left: Math.max(0, todayOffsetPx - timelinePane.clientWidth / 2 + 100),
              behavior: 'smooth'
            });
          }
        } else if (action === 'prev') {
          timelinePane.scrollBy({ left: -250, behavior: 'smooth' });
        } else if (action === 'next') {
          timelinePane.scrollBy({ left: 250, behavior: 'smooth' });
        }
      });
    });

    // Project Expand / Collapse
    wrapper.querySelectorAll('.gantt-collapse-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const prjId = toggle.dataset.projectId;
        if (state.collapsedProjects.has(prjId)) {
          state.collapsedProjects.delete(prjId);
        } else {
          state.collapsedProjects.add(prjId);
        }
        render(options);
      });
    });

    // Task Subtasks Expand / Collapse
    wrapper.querySelectorAll('.gantt-task-collapse-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = toggle.dataset.taskId;
        if (state.collapsedTasks.has(taskId)) {
          state.collapsedTasks.delete(taskId);
        } else {
          state.collapsedTasks.add(taskId);
        }
        render(options);
      });
    });

    // Subtask Completion Checkbox Toggle
    wrapper.querySelectorAll('.gantt-subtask-toggle').forEach(chk => {
      chk.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskId = chk.dataset.taskId;
        const subtaskId = chk.dataset.subtaskId;
        const isCompleted = chk.checked;
        if (typeof WorkPulseDB !== 'undefined' && WorkPulseDB.toggleSubtask) {
          WorkPulseDB.toggleSubtask(taskId, subtaskId, isCompleted);
        }
        render(options);
        if (typeof options.onDataChange === 'function') {
          options.onDataChange();
        }
      });
    });


    // Project Row Click -> Open Project Details Modal
    wrapper.querySelectorAll('.gantt-row-project, .gantt-bar-project').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('gantt-collapse-toggle')) return;
        const prjId = el.dataset.projectId;
        if (prjId && typeof options.onOpenProjectModal === 'function') {
          options.onOpenProjectModal(prjId);
        }
      });
    });

    // Task Row & Task Bar Click -> Open Task Modal
    wrapper.querySelectorAll('.gantt-row-task, .gantt-bar-task').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('gantt-quick-edit-date-btn')) return;
        const taskId = el.dataset.taskId;
        if (taskId && typeof options.onOpenTaskModal === 'function') {
          options.onOpenTaskModal(taskId);
        }
      });
    });

    // Quick Date Edit Modal Trigger
    wrapper.querySelectorAll('.gantt-quick-edit-date-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const task = allTasks.find(t => t.id === taskId);
        if (!task) return;
        openQuickDateModal(task, options);
      });
    });

    // Synchronize Vertical Scrolling between Sidebar and Timeline
    const sidebarPane = document.getElementById(`${containerId}-sidebar`);
    const timelinePane = document.getElementById(`${containerId}-timeline`);

    if (sidebarPane && timelinePane) {
      let isSyncingSidebar = false;
      let isSyncingTimeline = false;

      sidebarPane.addEventListener('scroll', () => {
        if (!isSyncingSidebar) {
          isSyncingTimeline = true;
          timelinePane.scrollTop = sidebarPane.scrollTop;
        }
        isSyncingSidebar = false;
      }, { passive: true });

      timelinePane.addEventListener('scroll', () => {
        if (!isSyncingTimeline) {
          isSyncingSidebar = true;
          sidebarPane.scrollTop = timelinePane.scrollTop;
        }
        isSyncingTimeline = false;
      }, { passive: true });

      // Auto-scroll timeline to bring Today into view on initial render
      if (todayOffsetPx !== null && !wrapper._hasAutoScrolled) {
        wrapper._hasAutoScrolled = true;
        setTimeout(() => {
          const targetLeft = Math.max(0, todayOffsetPx - (timelinePane.clientWidth || 800) / 2 + 100);
          if (timelinePane && typeof timelinePane.scrollTo === 'function') {
            timelinePane.scrollTo({ left: targetLeft, behavior: 'smooth' });
          } else if (timelinePane) {
            timelinePane.scrollLeft = targetLeft;
          }
        }, 100);
      }
    }
  }

  /**
   * Quick Date Edit Modal
   */
  function openQuickDateModal(task, options) {
    const existing = document.getElementById('gantt-quick-date-modal');
    if (existing) existing.remove();

    const startVal = task.startDate || task.assignedDate || formatLocalDate(new Date());
    const dueVal = task.dueDate || formatLocalDate(new Date(Date.now() + 7 * 86400000));

    const modalHtml = `
      <div class="gantt-date-modal-backdrop" id="gantt-quick-date-modal">
        <div class="gantt-date-modal-card">
          <div class="modal-header" style="background:#F8FAFC; border-bottom:1px solid #E2E8F0; padding:16px 20px;">
            <div class="d-flex align-items-center gap-2">
              <span style="font-size:1.1rem;">📅</span>
              <span class="modal-title" style="font-size:1rem; font-weight:700; color:var(--navy-dark);">Quick Adjust Task Timeline</span>
            </div>
            <button type="button" class="modal-close" id="btn-close-gantt-date-modal" style="background:none; border:none; font-size:1.2rem; cursor:pointer;">&times;</button>
          </div>
          <div class="modal-body" style="padding:20px;">
            <div class="mb-3">
              <label class="form-label" style="font-size:0.75rem; font-weight:700; color:#64748B; text-transform:uppercase;">Task</label>
              <div style="font-weight:700; color:var(--navy-dark); font-size:0.92rem;">${escapeHtml(task.title)}</div>
              <div style="font-size:0.75rem; color:#64748B;">ID: ${escapeHtml(task.id)} | Status: ${escapeHtml(task.status)}</div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label" style="font-size:0.75rem; font-weight:700; color:var(--navy-dark);">Start Date</label>
                <input type="date" class="form-control" id="gantt-edit-start-date" value="${escapeHtml(startVal)}">
              </div>
              <div class="col-6">
                <label class="form-label" style="font-size:0.75rem; font-weight:700; color:var(--navy-dark);">Due Date</label>
                <input type="date" class="form-control" id="gantt-edit-due-date" value="${escapeHtml(dueVal)}">
              </div>
            </div>

            <div id="gantt-date-edit-alert" class="alert alert-danger py-2 mb-3" style="display:none; font-size:0.80rem;"></div>

            <div class="d-flex justify-content-end gap-2">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-gantt-date">Cancel</button>
              <button type="button" class="btn btn-primary btn-sm" id="btn-save-gantt-date" style="font-weight:700;">
                Save Changes to Backend
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalEl = document.getElementById('gantt-quick-date-modal');
    const closeBtn = document.getElementById('btn-close-gantt-date-modal');
    const cancelBtn = document.getElementById('btn-cancel-gantt-date');
    const saveBtn = document.getElementById('btn-save-gantt-date');
    const alertEl = document.getElementById('gantt-date-edit-alert');

    function closeModal() {
      if (modalEl) modalEl.remove();
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const newStart = document.getElementById('gantt-edit-start-date').value;
        const newDue = document.getElementById('gantt-edit-due-date').value;

        if (!newStart || !newDue) {
          alertEl.textContent = 'Please specify both start date and due date.';
          alertEl.style.display = 'block';
          return;
        }

        if (newDue < newStart) {
          alertEl.textContent = 'Due date cannot be earlier than start date.';
          alertEl.style.display = 'block';
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          if (typeof options.onUpdateTaskDates === 'function') {
            await options.onUpdateTaskDates(task.id, newStart, newDue);
          }
          closeModal();
          if (typeof options.onRefreshAll === 'function') {
            options.onRefreshAll();
          }
        } catch (err) {
          alertEl.textContent = err.message || 'Failed to update task dates';
          alertEl.style.display = 'block';
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes to Backend';
        }
      });
    }
  }

  return {
    render
  };
})();
