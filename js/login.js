/**
 * WORKPULSE — UNIFIED SPLIT LOGIN CONTROLLER (js/login.js)
 * Manages dual-panel switcher, demo credentials, error states, and session storage.
 */

document.addEventListener('DOMContentLoaded', () => {
  let currentRole = 'admin'; // 'admin' | 'staff'

  const roleTabAdmin = document.getElementById('roleTabAdmin');
  const roleTabStaff = document.getElementById('roleTabStaff');
  const loginForm = document.getElementById('mainLoginForm');
  const loginTitle = document.getElementById('loginTitle');
  const loginSubtitle = document.getElementById('loginSubtitle');
  const identifierInput = document.getElementById('loginIdentifier');
  const identifierLabel = document.getElementById('identifierLabel');
  const passwordInput = document.getElementById('loginPassword');
  const pwdToggleBtn = document.getElementById('pwdToggleBtn');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const errorBanner = document.getElementById('loginErrorBanner');
  const errorText = document.getElementById('loginErrorText');

  // Demo buttons
  const demoAdminBtn = document.getElementById('demoAdminBtn');
  const demoStaffBtn = document.getElementById('demoStaffBtn');

  // Forgot password modal
  const forgotPwdLink = document.getElementById('forgotPwdLink');
  const forgotPwdModal = document.getElementById('forgotPwdModal');
  const forgotPwdForm = document.getElementById('forgotPwdForm');

  // --------------------------------------------------------------------------
  // ROLE SWITCHER: ADMIN vs STAFF
  // --------------------------------------------------------------------------
  function setRole(role, clearInputs = true) {
    currentRole = role;
    if (clearInputs) {
      hideError();
    }

    if (role === 'admin') {
      roleTabAdmin.classList.add('active');
      roleTabStaff.classList.remove('active');
      loginTitle.textContent = 'Administrator Portal';
      loginSubtitle.textContent = 'Sign in with master credentials to access the Executive Console.';
      identifierLabel.textContent = 'Admin Corporate Email';
      identifierInput.placeholder = 'admin@workpulse.com';
      if (clearInputs) {
        identifierInput.value = '';
        passwordInput.value = '';
      }
      submitBtn.innerHTML = 'Sign In to Admin Console &rarr;';
    } else {
      roleTabStaff.classList.add('active');
      roleTabAdmin.classList.remove('active');
      loginTitle.textContent = 'Staff Workspace Portal';
      loginSubtitle.textContent = 'Sign in to access your attendance, timesheets, and leave center.';
      identifierLabel.textContent = 'Employee Email or Mobile';
      identifierInput.placeholder = 'e.g. employee@company.com or mobile';
      if (clearInputs) {
        identifierInput.value = '';
        passwordInput.value = '';
      }
      submitBtn.innerHTML = 'Sign In as Staff Member &rarr;';
    }
  }

  if (roleTabAdmin && roleTabStaff) {
    roleTabAdmin.addEventListener('click', () => setRole('admin', true));
    roleTabStaff.addEventListener('click', () => setRole('staff', true));
  }

  // --------------------------------------------------------------------------
  // PASSWORD SHOW / HIDE TOGGLE
  // --------------------------------------------------------------------------
  if (pwdToggleBtn) {
    pwdToggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
      pwdToggleBtn.innerHTML = isPassword
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    });
  }

  // --------------------------------------------------------------------------
  // ERROR BANNER HELPERS
  // --------------------------------------------------------------------------
  function showError(msg) {
    if (errorBanner && errorText) {
      errorText.textContent = msg;
      errorBanner.classList.add('visible');
    }
  }

  function hideError() {
    if (errorBanner) {
      errorBanner.classList.remove('visible');
    }
  }

  // --------------------------------------------------------------------------
  // LOGIN SUBMISSION & REDIRECT
  // --------------------------------------------------------------------------
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();

      const idVal = identifierInput.value.trim().toLowerCase();
      const pwdVal = passwordInput.value.trim();

      if (!idVal) {
        showError('Please enter your email or identifier.');
        identifierInput.focus();
        return;
      }
      if (!pwdVal) {
        showError('Please enter your password.');
        passwordInput.focus();
        return;
      }

      // Visual loading state
      submitBtn.disabled = true;
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
        Authenticating Credentials...
      `;

      try {
        let authSuccess = false;
        let sessionData = null;
        let errMsg = '';

        // Authoritative server-side authentication
        try {
          const authRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              email: idVal,
              password: pwdVal,
              role: currentRole
            })
          });
          const authJson = await authRes.json();
          if (authJson && authJson.success && authJson.session) {
            authSuccess = true;
            sessionData = authJson.session;
          } else {
            errMsg = (authJson && authJson.error) || 'Invalid login credentials.';
          }
        } catch (netErr) {
          console.warn('Network auth failed:', netErr);
          errMsg = 'Unable to connect to the WorkPulse authentication server. Please check your network connection.';
        }

        if (authSuccess && sessionData) {
          // Store secure session token and sanitized user info
          WorkPulseDB.setSession(sessionData.role, sessionData.user, sessionData.token);
          WorkPulseDB.setSessionToken(sessionData.token);

          try {
            document.cookie = `wp_session=${encodeURIComponent(sessionData.token)}; path=/; max-age=86400; SameSite=Lax`;
            if (sessionData.role === 'admin') {
              document.cookie = `wp_admin_session=${encodeURIComponent(sessionData.token)}; path=/; max-age=86400; SameSite=Lax`;
            } else {
              document.cookie = `wp_staff_session=${encodeURIComponent(sessionData.token)}; path=/; max-age=86400; SameSite=Lax`;
            }
          } catch (_) {}

          // Asynchronously trigger server sync so redirect is immediate
          WorkPulseDB.initServerSync().catch(() => {});

          if (sessionData.role === 'admin') {
            window.location.replace('admin.html');
          } else {
            window.location.replace('staff.html');
          }
          return;
        }

        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        showError(errMsg || 'Invalid login credentials. Please verify your credentials and try again.');
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        showError('Authentication error: ' + err.message);
      }
    });
  }

  // --------------------------------------------------------------------------
  // FORGOT PASSWORD MODAL (2-STEP SECURE WORKFLOW)
  // --------------------------------------------------------------------------
  const forgotStep1Form = document.getElementById('forgotStep1Form');
  const forgotStep2Form = document.getElementById('forgotStep2Form');
  const forgotIdentifier = document.getElementById('forgotIdentifier');
  const resetTokenInput = document.getElementById('resetTokenInput');
  const newPasswordInput = document.getElementById('newPasswordInput');
  const confirmPasswordInput = document.getElementById('confirmPasswordInput');
  const forgotStatusAlert = document.getElementById('forgotStatusAlert');
  const btnBackToStep1 = document.getElementById('btnBackToStep1');
  const btnSendResetCode = document.getElementById('btnSendResetCode');
  const btnConfirmReset = document.getElementById('btnConfirmReset');

  function showForgotAlert(msg, isSuccess = false) {
    if (forgotStatusAlert) {
      forgotStatusAlert.textContent = msg;
      forgotStatusAlert.style.display = 'block';
      forgotStatusAlert.style.backgroundColor = isSuccess ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)';
      forgotStatusAlert.style.color = isSuccess ? '#22c55e' : '#ef4444';
      forgotStatusAlert.style.border = isSuccess ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)';
    }
  }

  function hideForgotAlert() {
    if (forgotStatusAlert) {
      forgotStatusAlert.style.display = 'none';
      forgotStatusAlert.textContent = '';
    }
  }

  if (forgotPwdLink && forgotPwdModal) {
    forgotPwdLink.addEventListener('click', (e) => {
      e.preventDefault();
      hideForgotAlert();
      if (forgotStep1Form) forgotStep1Form.style.display = 'block';
      if (forgotStep2Form) forgotStep2Form.style.display = 'none';
      if (forgotIdentifier) {
        forgotIdentifier.value = identifierInput ? identifierInput.value.trim() : '';
      }
      forgotPwdModal.showModal();
    });
  }

  if (btnBackToStep1) {
    btnBackToStep1.addEventListener('click', () => {
      hideForgotAlert();
      if (forgotStep2Form) forgotStep2Form.style.display = 'none';
      if (forgotStep1Form) forgotStep1Form.style.display = 'block';
    });
  }

  if (forgotStep1Form) {
    forgotStep1Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideForgotAlert();
      const idVal = forgotIdentifier.value.trim();
      if (!idVal) {
        showForgotAlert('Please enter your email, mobile, or Staff ID.');
        return;
      }

      btnSendResetCode.disabled = true;
      btnSendResetCode.textContent = 'Generating Code...';

      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: idVal })
        });
        const data = await res.json();
        btnSendResetCode.disabled = false;
        btnSendResetCode.textContent = 'Send Recovery Code';

        if (data.success) {
          showForgotAlert(`Recovery code generated: ${data.resetToken} (valid for 15 minutes)`, true);
          if (resetTokenInput) {
            resetTokenInput.value = data.resetToken;
          }
          forgotStep1Form.style.display = 'none';
          forgotStep2Form.style.display = 'block';
          if (newPasswordInput) newPasswordInput.focus();
        } else {
          showForgotAlert(data.error || 'Failed to locate user account with that identifier.');
        }
      } catch (err) {
        btnSendResetCode.disabled = false;
        btnSendResetCode.textContent = 'Send Recovery Code';
        showForgotAlert('Network connection error: ' + err.message);
      }
    });
  }

  if (forgotStep2Form) {
    forgotStep2Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideForgotAlert();
      const token = resetTokenInput ? resetTokenInput.value.trim() : '';
      const newPwd = newPasswordInput ? newPasswordInput.value.trim() : '';
      const confirmPwd = confirmPasswordInput ? confirmPasswordInput.value.trim() : '';

      if (!token) {
        showForgotAlert('Please provide the 6-digit recovery code.');
        return;
      }
      if (!newPwd || newPwd.length < 6) {
        showForgotAlert('New password must be at least 6 characters long.');
        return;
      }
      if (newPwd !== confirmPwd) {
        showForgotAlert('Passwords do not match. Please re-enter.');
        return;
      }

      btnConfirmReset.disabled = true;
      btnConfirmReset.textContent = 'Updating Password...';

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword: newPwd })
        });
        const data = await res.json();
        btnConfirmReset.disabled = false;
        btnConfirmReset.textContent = 'Update Password';

        if (data.success) {
          showForgotAlert('Password updated successfully! You can now log in.', true);
          if (passwordInput) passwordInput.value = newPwd;
          setTimeout(() => {
            forgotPwdModal.close();
            forgotStep2Form.reset();
            forgotStep1Form.reset();
            hideForgotAlert();
          }, 1500);
        } else {
          showForgotAlert(data.error || 'Failed to update password.');
        }
      } catch (err) {
        btnConfirmReset.disabled = false;
        btnConfirmReset.textContent = 'Update Password';
        showForgotAlert('Network connection error: ' + err.message);
      }
    });
  }

  // Initial set to Admin without wiping prefilled/autofilled credentials
  setRole('admin', false);
  try {
    if (WorkPulseDB.getSessionToken()) {
      WorkPulseDB.initServerSync();
    }
  } catch (e) {}

  // Check URL query parameters for authorization redirects
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const errCode = urlParams.get('error');
    if (errCode === 'admin_required') {
      setRole('admin', false);
      showError('Administrator privileges required. Please sign in with an Admin account.');
    } else if (errCode === 'staff_required') {
      setRole('staff', false);
      showError('Staff portal access requires a verified staff account.');
    } else if (errCode === 'auth_required') {
      showError('Session expired or authentication required. Please sign in.');
    } else if (errCode === 'logged_out') {
      showError('You have been securely logged out.');
    }
  } catch (e) {}
});
