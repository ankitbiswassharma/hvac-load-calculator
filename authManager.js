(function () {
  const ACCOUNTS_KEY = "hvac-platform-users-v1";
  const SESSION_KEY = "hvac-platform-session-v1";
  const SESSION_PROFILE_KEY = "hvac-platform-session-profile-v1";
  const BACKEND_SESSION_TOKEN_KEY = "hvac-platform-backend-session-token-v1";

  function nowIso() {
    return new Date().toISOString();
  }

  function slugify(text) {
    return String(text || "user")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "user";
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function removeKey(key) {
    window.localStorage.removeItem(key);
  }

  function readSessionProfile() {
    return readJson(SESSION_PROFILE_KEY, null);
  }

  function writeSessionProfile(user) {
    writeJson(SESSION_PROFILE_KEY, user);
  }

  function clearSessionProfile() {
    removeKey(SESSION_PROFILE_KEY);
  }

  function readBackendSessionToken() {
    return String(readJson(BACKEND_SESSION_TOKEN_KEY, "") || "").trim();
  }

  function writeBackendSessionToken(token) {
    writeJson(BACKEND_SESSION_TOKEN_KEY, String(token || "").trim());
  }

  function clearBackendSessionToken() {
    removeKey(BACKEND_SESSION_TOKEN_KEY);
  }

  function fallbackHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return "fallback-" + (hash >>> 0).toString(16);
  }

  async function sha256Hex(value) {
    if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) {
      return fallbackHash(value);
    }

    try {
      const bytes = new window.TextEncoder().encode(String(value || ""));
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    } catch (error) {
      return fallbackHash(value);
    }
  }

  function buildInitials(name, email) {
    const basis = String(name || email || "User").trim();
    const parts = basis.split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return "U";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function readAccounts() {
    return readJson(ACCOUNTS_KEY, {});
  }

  function writeAccounts(accounts) {
    writeJson(ACCOUNTS_KEY, accounts);
  }

  function sanitizeUser(account) {
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      phone: account.phone || "",
      company: account.company || "",
      role: account.role || "user",
      initials: buildInitials(account.name, account.email),
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt || null
    };
  }

  function persistSession(account) {
    const session = {
      userId: account.id,
      email: account.email,
      authenticatedAt: nowIso()
    };
    writeJson(SESSION_KEY, session);
    writeSessionProfile(sanitizeUser(account));
    return session;
  }

  function clearSession() {
    removeKey(SESSION_KEY);
    clearSessionProfile();
    clearBackendSessionToken();
  }

  async function confirmBackendSession() {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return null;
    }

    const response = await window.ServerApi.getSession();
    if (response && response.ok && response.user) {
      writeSessionProfile(response.user);
      return response.user;
    }

    clearSession();
    return null;
  }

  const manager = {
    async createAccount(payload) {
      const name = String((payload && payload.name) || "").trim();
      const email = normalizeEmail(payload && payload.email);
      const phone = String((payload && payload.phone) || "").trim();
      const company = String((payload && payload.company) || "").trim();
      const password = String((payload && payload.password) || "");
      const recoveryKey = String((payload && payload.recoveryKey) || "").trim();

      if (window.ServerApi && await window.ServerApi.isAvailable()) {
        const response = await window.ServerApi.register({
          name: name,
          email: email,
          phone: phone,
          company: company,
          password: password,
          recoveryKey: recoveryKey
        });
        if (response && response.ok) {
          if (response.sessionToken) {
            writeBackendSessionToken(response.sessionToken);
          }
          if (response.user) {
            writeSessionProfile(response.user);
          }
        }
        return response;
      }

      if (!name) {
        return { ok: false, error: "Full name is required." };
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "Enter a valid email address." };
      }
      if (!phone) {
        return { ok: false, error: "Phone number is required." };
      }
      if (!company) {
        return { ok: false, error: "Company name is required." };
      }
      if (password.length < 8) {
        return { ok: false, error: "Password must be at least 8 characters." };
      }
      if (recoveryKey.length < 4) {
        return { ok: false, error: "Recovery key must be at least 4 characters." };
      }

      const accounts = readAccounts();
      if (accounts[email]) {
        return { ok: false, error: "An account with this email already exists." };
      }

      const account = {
        id: "user-" + slugify(email),
        name: name,
        email: email,
        phone: phone,
        company: company,
        role: Object.keys(accounts).length ? "user" : "admin",
        passwordHash: await sha256Hex(password),
        recoveryHash: await sha256Hex(recoveryKey),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastLoginAt: nowIso()
      };

      accounts[email] = account;
      writeAccounts(accounts);
      persistSession(account);

      return {
        ok: true,
        user: sanitizeUser(account)
      };
    },

    async login(payload) {
      const identifier = String((payload && (payload.identifier || payload.email || payload.username)) || "").trim();
      const email = normalizeEmail(identifier);
      const password = String((payload && payload.password) || "");

      if (window.ServerApi && await window.ServerApi.isAvailable()) {
        const response = await window.ServerApi.login({
          identifier: identifier,
          password: password
        });
        if (response && response.ok) {
          if (response.sessionToken) {
            writeBackendSessionToken(response.sessionToken);
          }
          if (response.user) {
            writeSessionProfile(response.user);
          }
        }
        return response;
      }

      const accounts = readAccounts();
      const account = accounts[email];

      if (!account) {
        return { ok: false, error: "Account not found for this email." };
      }

      const passwordHash = await sha256Hex(password);
      if (passwordHash !== account.passwordHash) {
        return { ok: false, error: "Incorrect password." };
      }

      account.lastLoginAt = nowIso();
      accounts[email] = account;
      writeAccounts(accounts);
      persistSession(account);

      return {
        ok: true,
        user: sanitizeUser(account)
      };
    },

    async requestOwnerOtp(payload) {
      const email = normalizeEmail(payload && payload.email);
      const password = String((payload && payload.password) || "");

      if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
        return { ok: false, error: "Owner login requires the backend server so the email OTP can be issued." };
      }

      return window.ServerApi.requestOwnerOtp({
        email: email,
        password: password
      });
    },

    async verifyOwnerOtp(payload) {
      const response = window.ServerApi && await window.ServerApi.isAvailable()
        ? await window.ServerApi.verifyOwnerOtp({
          challengeId: String((payload && payload.challengeId) || "").trim(),
          email: normalizeEmail(payload && payload.email),
          otp: String((payload && payload.otp) || "").trim()
        })
        : { ok: false, error: "Owner login requires the backend server so the email OTP can be verified." };

      if (response && response.ok) {
        if (response.sessionToken) {
          writeBackendSessionToken(response.sessionToken);
        }
        if (response.user) {
          writeSessionProfile(response.user);
        }
      }

      return response;
    },

    async resetPassword(payload) {
      const email = normalizeEmail(payload && payload.email);
      const recoveryKey = String((payload && payload.recoveryKey) || "").trim();
      const token = String((payload && payload.token) || "").trim();
      const newPassword = String((payload && payload.newPassword) || "");

      if (window.ServerApi && await window.ServerApi.isAvailable()) {
        return window.ServerApi.resetPassword({
          email: email,
          recoveryKey: recoveryKey,
          token: token,
          newPassword: newPassword
        });
      }

      const accounts = readAccounts();
      const account = accounts[email];

      if (!account) {
        return { ok: false, error: "Account not found for this email." };
      }
      if (newPassword.length < 8) {
        return { ok: false, error: "New password must be at least 8 characters." };
      }

      const recoveryHash = await sha256Hex(recoveryKey);
      if (recoveryHash !== account.recoveryHash) {
        return { ok: false, error: "Recovery key did not match this account." };
      }

      account.passwordHash = await sha256Hex(newPassword);
      account.updatedAt = nowIso();
      accounts[email] = account;
      writeAccounts(accounts);

      return {
        ok: true,
        message: "Password reset successful. Please log in with your new password."
      };
    },

    async requestResetToken(payload) {
      const email = normalizeEmail(payload && payload.email);

      if (window.ServerApi && await window.ServerApi.isAvailable()) {
        return window.ServerApi.forgotPassword({
          email: email
        });
      }

      return {
        ok: false,
        error: "Token-based reset requires the backend server."
      };
    },

    async logout() {
      if (window.ServerApi && await window.ServerApi.isAvailable()) {
        await window.ServerApi.logout();
      }
      clearSession();
      return true;
    },

    async hydrateSession() {
      if (window.ServerApi && await window.ServerApi.isAvailable()) {
        return confirmBackendSession();
      }
      return this.getCurrentUser();
    },

    handleUnauthorized(detail) {
      clearSession();
      return {
        ok: false,
        status: 401,
        error: detail && detail.error ? detail.error : "Your session expired. Please log in again."
      };
    },

    getCurrentUser() {
      const cachedUser = readSessionProfile();
      if (cachedUser) {
        return cachedUser;
      }

      const session = readJson(SESSION_KEY, null);
      if (!session || !session.email) {
        return null;
      }

      const account = readAccounts()[normalizeEmail(session.email)];
      if (!account) {
        removeKey(SESSION_KEY);
        return null;
      }

      const user = sanitizeUser(account);
      writeSessionProfile(user);
      return user;
    },

    isAuthenticated() {
      return !!this.getCurrentUser();
    },

    getBackendSessionToken() {
      return readBackendSessionToken();
    }
  };

  window.AuthManager = manager;
}());
