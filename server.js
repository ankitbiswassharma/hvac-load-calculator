require("./envLoader");

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const { spawn } = require("child_process");
const { URL } = require("url");
const { createPostgresStore } = require("./postgresStore");
const EmailService = require("./emailService");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;
const SESSION_COOKIE = "muskit_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 210000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";
const SOURCE_LICENSE_USER_LIMIT = 999;
const PUBLIC_FILES = new Set([
  "contact copy 2.html",
  "favicon.svg",
  "solarEngine.js",
  "psychroChart.js",
  "diffuserLayout.js",
  "equipmentEngine.js",
  "climateData.js",
  "apiClient.js",
  "authManager.js",
  "projectManager.js",
  "costingEngine.js",
  "schematic3d.js",
  "hvacPlatform.js"
]);

const store = createPostgresStore();

function slugify(text) {
  return String(text || "value")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "value";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(value) {
  return String(value == null ? "" : value).trim();
}

function integerOrDefault(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function addMonthsIso(startIso, months) {
  const date = new Date(startIso || Date.now());
  if (!Number.isFinite(months) || months <= 0) {
    return null;
  }
  date.setMonth(date.getMonth() + months);
  return date.toISOString();
}

function formatInr(value) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);
}

function toIso(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function createSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashSecret(secret, salt) {
  return crypto.pbkdf2Sync(String(secret || ""), salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
}

function createCredential(secret) {
  const salt = createSalt();
  return {
    salt: salt,
    hash: hashSecret(secret, salt)
  };
}

function verifyCredential(secret, salt, expectedHash) {
  const actual = hashSecret(secret, salt);
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function randomToken(length) {
  return crypto.randomBytes(length).toString("hex");
}

function randomPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

function createCompanyId(companyName) {
  return "company-" + slugify(companyName) + "-" + randomToken(3);
}

function createLicenseId(companyName) {
  return "license-" + slugify(companyName) + "-" + randomToken(3);
}

function createLicenseNumber() {
  const year = new Date().getFullYear();
  return "MSK-LIC-" + year + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function maskPassword(password) {
  if (!password) {
    return "";
  }
  if (password.length <= 3) {
    return "***";
  }
  return password.slice(0, 2) + "******" + password.slice(-1);
}

function planCodeForRequestedUsers(requestedUsers) {
  if (requestedUsers <= 5) {
    return "annual_5";
  }
  if (requestedUsers <= 10) {
    return "annual_10";
  }
  if (requestedUsers <= 15) {
    return "annual_15";
  }
  return "";
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createCheckoutInviteToken() {
  return "pay_" + crypto.randomBytes(18).toString("hex");
}

function hashCheckoutInviteToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function requestBaseUrl(req) {
  const forwardedProto = cleanText(req && req.headers && req.headers["x-forwarded-proto"]).split(",")[0];
  const forwardedHost = cleanText(req && req.headers && req.headers["x-forwarded-host"]).split(",")[0];
  const host = forwardedHost || cleanText(req && req.headers && req.headers.host) || ("localhost:" + PORT);
  const proto = forwardedProto || ((req && req.socket && req.socket.encrypted) ? "https" : "http");
  return proto + "://" + host;
}

function appBaseUrl(req) {
  return cleanText(process.env.APP_URL) || requestBaseUrl(req);
}

function parseBody(req) {
  return new Promise(function (resolve, reject) {
    let body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", function () {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function requestIsPotentiallyTrustworthy(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  const encrypted = !!(req.socket && req.socket.encrypted);
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  return encrypted
    || forwardedProto === "https"
    || host === "localhost"
    || host === "127.0.0.1"
    || host === "::1";
}

function applySecurityHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (requestIsPotentiallyTrustworthy(req)) {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  }
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    [
      "geolocation=()",
      "microphone=()",
      "camera=()",
      "accelerometer=(self)",
      "gyroscope=(self)",
      "magnetometer=(self)"
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader.split(";").reduce(function (map, chunk) {
    const parts = chunk.split("=");
    const key = parts.shift();
    if (!key) {
      return map;
    }
    map[key.trim()] = decodeURIComponent(parts.join("=").trim());
    return map;
  }, {});
}

function sessionCookie(token) {
  const attributes = [
    SESSION_COOKIE + "=" + encodeURIComponent(token),
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + Math.floor(SESSION_TTL_MS / 1000)
  ];
  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function clearSessionCookie() {
  const attributes = [
    SESSION_COOKIE + "=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0"
  ];
  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function isOwner(user) {
  return !!(user && user.role === "owner");
}

function isCompanyAdmin(user) {
  return !!(user && user.role === "admin");
}

function razorpayConfig() {
  return {
    keyId: String(process.env.RAZORPAY_KEY_ID || "").trim(),
    keySecret: String(process.env.RAZORPAY_KEY_SECRET || "").trim()
  };
}

function razorpayEnabled() {
  const config = razorpayConfig();
  return !!(config.keyId && config.keySecret && globalThis.fetch);
}

async function callRazorpay(pathname, payload) {
  const config = razorpayConfig();
  if (!(config.keyId && config.keySecret && globalThis.fetch)) {
    throw new Error("Razorpay is not configured on the server.");
  }

  const response = await globalThis.fetch("https://api.razorpay.com/v1/" + pathname.replace(/^\//, ""), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Basic " + Buffer.from(config.keyId + ":" + config.keySecret).toString("base64")
    },
    body: JSON.stringify(payload || {})
  });

  const result = await response.json().catch(function () {
    return {};
  });
  if (!response.ok) {
    throw new Error((result && (result.error && result.error.description)) || result.message || "Razorpay request failed.");
  }
  return result;
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  const config = razorpayConfig();
  if (!(config.keySecret && orderId && paymentId && signature)) {
    return false;
  }
  const digest = crypto
    .createHmac("sha256", config.keySecret)
    .update(String(orderId) + "|" + String(paymentId))
    .digest("hex");
  const actual = Buffer.from(digest);
  const expected = Buffer.from(String(signature || ""));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sanitizeUser(user) {
  const basis = String(user.name || user.email || "User").trim().split(/\s+/).filter(Boolean);
  const initials = basis.length > 1
    ? (basis[0][0] + basis[1][0]).toUpperCase()
    : String((basis[0] || "U").slice(0, 2)).toUpperCase();

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username || "",
    phone: user.phone || "",
    company: user.company || "",
    companyId: user.company_id || user.companyId || "",
    role: user.role || "user",
    isOwner: (user.role || "user") === "owner",
    isCompanyAdmin: (user.role || "user") === "admin",
    initials: initials,
    createdAt: toIso(user.createdAt || user.created_at),
    lastLoginAt: toIso(user.lastLoginAt || user.last_login_at)
  };
}

function summarizeProject(project, slug, savedAtValue) {
  const rooms = Array.isArray(project && project.rooms) ? project.rooms : [];
  const roomsWithResults = rooms.filter(function (room) {
    return room && room.result;
  });
  const totalTR = roomsWithResults.reduce(function (sum, room) {
    return sum + (room.result.tr_final || room.result.tr_design || room.result.TR_sel || 0);
  }, 0);
  const totalCFM = roomsWithResults.reduce(function (sum, room) {
    return sum + (room.result.Q_sup_cfm || 0);
  }, 0);

  return {
    slug: slug || slugify(project && project.name),
    name: project && project.name ? project.name : "HVAC Project",
    savedAt: toIso(savedAtValue || (project && project.savedAt) || null),
    roomCount: rooms.length,
    calculatedRoomCount: roomsWithResults.length,
    totalTR: Math.round(totalTR * 100) / 100,
    totalCFM: Math.round(totalCFM)
  };
}

function summarizeProjectRow(row) {
  return summarizeProject(
    typeof row.project_data === "string" ? JSON.parse(row.project_data) : row.project_data,
    row.slug,
    row.saved_at
  );
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await store.createSession(token, user, createdAt, expiresAt);
  return token;
}

async function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return { token: null, user: null };
  }

  const sessionRecord = await store.getSessionWithUser(token);
  if (!sessionRecord) {
    await store.deleteSession(token);
    return { token: null, user: null };
  }

  return { token: token, user: sessionRecord };
}

async function ensureBootstrapOwner() {
  const email = normalizeEmail(process.env.HVAC_OWNER_EMAIL || process.env.HVAC_ADMIN_EMAIL || "");
  const password = process.env.HVAC_OWNER_PASSWORD || process.env.HVAC_ADMIN_PASSWORD || "";
  const recoveryKey = process.env.HVAC_OWNER_RECOVERY_KEY || process.env.HVAC_ADMIN_RECOVERY_KEY || "change-me-reset";

  const existingOwner = await store.findOwnerUser();
  if (existingOwner) {
    return existingOwner;
  }

  if (!email || !password) {
    return store.promoteLegacyGlobalAdminToOwner();
  }

  const existing = await store.findUserByEmail(email);
  const timestamp = nowIso();
  if (existing) {
    return store.upsertUser({
      id: existing.id,
      name: existing.name || process.env.HVAC_OWNER_NAME || "Platform Owner",
      email: existing.email,
      phone: existing.phone || process.env.HVAC_OWNER_PHONE || "",
      company: existing.company || process.env.HVAC_OWNER_COMPANY || "Musk-IT",
      role: "owner",
      username: existing.username || normalizeUsername(process.env.HVAC_OWNER_USERNAME || "owner"),
      companyId: existing.company_id || null,
      createdByUserId: existing.created_by_user_id || null,
      passwordSalt: existing.password_salt,
      passwordHash: existing.password_hash,
      recoverySalt: existing.recovery_salt,
      recoveryHash: existing.recovery_hash,
      createdAt: existing.created_at || timestamp,
      updatedAt: timestamp,
      lastLoginAt: existing.last_login_at || null
    });
  }

  const passwordCredential = createCredential(password);
  const recoveryCredential = createCredential(recoveryKey);

  return store.createUser({
    id: "user-" + slugify(email),
    name: process.env.HVAC_OWNER_NAME || "Platform Owner",
    email: email,
    phone: process.env.HVAC_OWNER_PHONE || "",
    company: process.env.HVAC_OWNER_COMPANY || "Musk-IT",
    role: "owner",
    username: normalizeUsername(process.env.HVAC_OWNER_USERNAME || "owner"),
    companyId: null,
    createdByUserId: null,
    passwordSalt: passwordCredential.salt,
    passwordHash: passwordCredential.hash,
    recoverySalt: recoveryCredential.salt,
    recoveryHash: recoveryCredential.hash,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null
  });
}

function extractLegacyClimateStations() {
  const html = fs.readFileSync(path.join(ROOT, "contact copy 2.html"), "utf8");
  const startMarker = "const ASHRAE_CITIES = [";
  const endMarker = "// ── LOOKUP TABLES ──";
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const block = html.slice(start, end);
  const arrayStart = block.indexOf("[");
  const arrayEnd = block.lastIndexOf("];");
  if (arrayStart === -1 || arrayEnd === -1) {
    return [];
  }

  try {
    const stations = vm.runInNewContext(block.slice(arrayStart, arrayEnd + 1), {});
    return Array.isArray(stations) ? stations : [];
  } catch (error) {
    console.warn("Legacy climate seed parse failed:", error.message || error);
    return [];
  }
}

async function ensureClimateSeed() {
  const stats = await store.climateStationStats();
  if ((stats.total || 0) > 0) {
    return;
  }

  const legacyStations = extractLegacyClimateStations();
  if (!legacyStations.length) {
    return;
  }

  await store.importClimateStations(legacyStations, {
    source: "ashrae-legacy-inline",
    sourceVersion: "inline-230",
    replaceSource: true
  });
  console.log("Seeded legacy climate dataset into PostgreSQL:", legacyStations.length, "stations");
}

async function requireAuth(req, res) {
  const session = await getSessionUser(req);
  if (!session.user) {
    sendJson(res, 401, { ok: false, error: "Authentication required." });
    return null;
  }
  return session;
}

async function requireAdmin(req, res) {
  const session = await requireAuth(req, res);
  if (!session) {
    return null;
  }
  if (!isCompanyAdmin(session.user) && !isOwner(session.user)) {
    sendJson(res, 403, { ok: false, error: "Admin access required." });
    return null;
  }
  return session;
}

async function requireOwner(req, res) {
  const session = await requireAuth(req, res);
  if (!session) {
    return null;
  }
  if (!isOwner(session.user)) {
    sendJson(res, 403, { ok: false, error: "Owner access required." });
    return null;
  }
  return session;
}

async function requireCompanyAdmin(req, res) {
  const session = await requireAuth(req, res);
  if (!session) {
    return null;
  }
  if (!isCompanyAdmin(session.user) && !isOwner(session.user)) {
    sendJson(res, 403, { ok: false, error: "Company admin access required." });
    return null;
  }
  return session;
}

function readStaticFile(filePath) {
  return fs.readFileSync(filePath);
}

function serveStatic(req, res) {
  const parsedUrl = new URL(req.url, "http://localhost");
  const requestedPath = decodeURIComponent(parsedUrl.pathname);
  const relativePath = requestedPath === "/"
    ? "contact copy 2.html"
    : (requestedPath === "/favicon.ico" ? "favicon.svg" : requestedPath.replace(/^\//, ""));
  if (!PUBLIC_FILES.has(relativePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const safePath = path.resolve(ROOT, relativePath);

  if (!safePath.startsWith(ROOT) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8"
  };
  const content = readStaticFile(safePath);
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Content-Length": content.length
  });
  res.end(content);
}

async function ensureUniqueUsername(baseText) {
  const base = normalizeUsername(baseText) || "user";
  let candidate = base;
  let suffix = 1;
  while (await store.findUserByUsername(candidate)) {
    suffix += 1;
    candidate = base + "." + suffix;
  }
  return candidate;
}

async function resolvePlanForRequest(planCode, requestedUsers, companyId) {
  const normalizedRequestedUsers = Math.max(integerOrDefault(requestedUsers, 1), 1);
  let resolvedPlanCode = cleanText(planCode);
  if (!resolvedPlanCode) {
    resolvedPlanCode = planCodeForRequestedUsers(normalizedRequestedUsers);
  }

  const effectivePlans = companyId
    ? await store.getEffectivePlansForCompany(companyId)
    : await store.listLicensingPlans();

  if (!resolvedPlanCode) {
    const sourcePlan = (effectivePlans || []).find(function (entry) {
      return entry.planCode === "source";
    });
    if (!sourcePlan) {
      throw new Error("Choose a supported licensing plan. Annual licensing supports up to 15 users, or use Source License.");
    }
    resolvedPlanCode = "source";
  }

  let plan = (effectivePlans || []).find(function (entry) {
    return entry.planCode === resolvedPlanCode;
  });

  if (!plan) {
    throw new Error("Selected licensing plan is unavailable.");
  }
  if (plan.licenseType === "annual" && normalizedRequestedUsers > plan.userLimit) {
    const upgradedPlanCode = planCodeForRequestedUsers(normalizedRequestedUsers);
    if (!upgradedPlanCode) {
      const sourcePlan = (effectivePlans || []).find(function (entry) {
        return entry.planCode === "source";
      });
      if (!sourcePlan) {
        throw new Error("Selected annual plan does not cover the requested user count.");
      }
      plan = sourcePlan;
    } else {
      const upgradedPlan = (effectivePlans || []).find(function (entry) {
        return entry.planCode === upgradedPlanCode;
      });
      if (!upgradedPlan) {
        throw new Error("Selected annual plan does not cover the requested user count.");
      }
      plan = upgradedPlan;
    }
  }

  return {
    planCode: plan.planCode,
    planName: plan.planName,
    licenseType: plan.licenseType,
    userLimit: plan.effectiveUserLimit || plan.userLimit,
    annualPriceInr: plan.effectivePriceInr || plan.annualPriceInr,
    durationMonths: plan.durationMonths,
    requestedUsers: normalizedRequestedUsers
  };
}

function escapeEmailHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailAppUrl() {
  return cleanText(process.env.APP_URL);
}

function emailButton(label, href, accentColor) {
  if (!href) {
    return "";
  }
  return [
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:14px 0 0;\">",
    "<tr><td style=\"border-radius:999px;background:", accentColor || "#1666a9", ";\">",
    "<a href=\"", escapeEmailHtml(href), "\" style=\"display:inline-block;padding:13px 22px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;\">",
    escapeEmailHtml(label),
    "</a></td></tr></table>"
  ].join("");
}

function emailDetailsTable(rows) {
  return [
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" width=\"100%\" style=\"border-collapse:collapse;\">",
    (rows || []).filter(function (row) {
      return row && row.value != null && row.value !== "";
    }).map(function (row) {
      return [
        "<tr>",
        "<td style=\"padding:10px 0;border-bottom:1px solid #e7edf4;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#475569;vertical-align:top;width:42%;\">",
        escapeEmailHtml(row.label),
        "</td>",
        "<td style=\"padding:10px 0;border-bottom:1px solid #e7edf4;font-family:Arial,sans-serif;font-size:13px;color:#0f172a;vertical-align:top;\">",
        escapeEmailHtml(row.value),
        "</td>",
        "</tr>"
      ].join("");
    }).join(""),
    "</table>"
  ].join("");
}

function emailCredentialRows(rows) {
  return [
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" width=\"100%\" style=\"border-collapse:separate;border-spacing:0 10px;\">",
    (rows || []).filter(function (row) {
      return row && row.value != null && row.value !== "";
    }).map(function (row) {
      return [
        "<tr>",
        "<td style=\"padding:12px 14px;border:1px solid #cfe0f2;border-radius:14px;background:#f8fbff;\">",
        "<div style=\"font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#1666a9;margin:0 0 6px;\">",
        escapeEmailHtml(row.label),
        "</div>",
        "<div style=\"font-family:'IBM Plex Mono','SFMono-Regular',Consolas,monospace;font-size:15px;font-weight:700;color:#0f172a;word-break:break-word;\">",
        escapeEmailHtml(row.value),
        "</div>",
        "</td>",
        "</tr>"
      ].join("");
    }).join(""),
    "</table>"
  ].join("");
}

function emailCard(title, contentHtml) {
  return [
    "<div style=\"margin:0 0 18px;padding:22px;border:1px solid #dbe5ef;border-radius:20px;background:#ffffff;box-shadow:0 10px 30px rgba(15,23,42,0.06);\">",
    "<div style=\"font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#1666a9;margin:0 0 12px;\">",
    escapeEmailHtml(title),
    "</div>",
    contentHtml || "",
    "</div>"
  ].join("");
}

function renderEmailLayout(options) {
  const preheader = escapeEmailHtml(options.preheader || "");
  return [
    "<!DOCTYPE html><html><body style=\"margin:0;padding:0;background:#eef3f8;\">",
    "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;\">", preheader, "</div>",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" width=\"100%\" style=\"background:#eef3f8;border-collapse:collapse;\">",
    "<tr><td align=\"center\" style=\"padding:28px 14px;\">",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" width=\"100%\" style=\"max-width:680px;border-collapse:separate;border-spacing:0;\">",
    "<tr><td style=\"padding:0 0 16px;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-align:center;\">", preheader, "</td></tr>",
    "<tr><td style=\"background:#0f172a;background-image:linear-gradient(135deg,#0f172a 0%,#12243d 55%,#1666a9 100%);border-radius:26px 26px 0 0;padding:28px 32px 26px;color:#ffffff;\">",
    "<div style=\"font-family:Arial,sans-serif;font-size:28px;font-weight:800;letter-spacing:-0.03em;\">Musk<span style=\"color:#6ec1ff;\">-IT</span></div>",
    "<div style=\"font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#dbeafe;margin-top:10px;\">", escapeEmailHtml(options.kicker || "HVAC Platform Notification"), "</div>",
    "<div style=\"font-family:Arial,sans-serif;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.03em;margin-top:12px;\">", escapeEmailHtml(options.title || "Notification"), "</div>",
    "<div style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#e2e8f0;margin-top:12px;max-width:560px;\">", escapeEmailHtml(options.summary || ""), "</div>",
    (options.heroMeta ? "<div style=\"margin-top:18px;font-family:Arial,sans-serif;font-size:12px;color:#cbd5e1;\">" + options.heroMeta + "</div>" : ""),
    "</td></tr>",
    "<tr><td style=\"background:#ffffff;border:1px solid #dbe5ef;border-top:none;border-radius:0 0 26px 26px;padding:30px 28px 20px;\">",
    options.bodyHtml || "",
    "</td></tr>",
    "<tr><td style=\"padding:16px 12px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#64748b;text-align:center;\">",
    escapeEmailHtml(options.footer || "This message was sent by the Musk-IT HVAC platform."),
    "</td></tr>",
    "</table></td></tr></table></body></html>"
  ].join("");
}

async function sendLicenseEmail(payload) {
  const appUrl = emailAppUrl();
  const html = renderEmailLayout({
    preheader: "Your company license is active and the admin credentials are ready.",
    kicker: "License Activated",
    title: "Your License Is Now Active",
    summary: "The company license has been activated successfully. The details below are your official access credentials and license references.",
    bodyHtml:
      "<p style=\"margin:0 0 18px;font-family:Arial,sans-serif;font-size:15px;line-height:1.75;color:#334155;\">Hello "
      + escapeEmailHtml(payload.adminName)
      + ", your company license is now active and ready to use.</p>"
      + emailCard("Access Credentials", emailCredentialRows([
        { label: "Username", value: payload.username },
        { label: "Temporary Password", value: payload.password },
        { label: "Recovery Key", value: payload.recoveryKey }
      ]))
      + emailCard("License Details", emailDetailsTable([
        { label: "Company", value: payload.companyName },
        { label: "License Number", value: payload.licenseNumber },
        { label: "Plan", value: payload.planName },
        { label: "User Limit", value: payload.userLimit },
        { label: "Valid Until", value: payload.endsAt ? new Date(payload.endsAt).toLocaleDateString("en-IN") : "" }
      ]))
      + "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.75;color:#475569;\">Please sign in and change your password after first access.</div>"
      + emailButton("Open HVAC Platform", appUrl, "#1666a9"),
    footer: "For security, please change your temporary password after your first login."
  });

  return EmailService.sendEmail({
    to: payload.to,
    subject: "Your Musk-IT HVAC license is active - " + payload.licenseNumber,
    html: html,
    text:
      "License activated.\n"
      + "Company: " + payload.companyName + "\n"
      + "License Number: " + payload.licenseNumber + "\n"
      + "Plan: " + payload.planName + "\n"
      + "User Limit: " + payload.userLimit + "\n"
      + "Username: " + payload.username + "\n"
      + "Temporary Password: " + payload.password + "\n"
      + "Recovery Key: " + payload.recoveryKey + "\n"
      + (payload.endsAt ? "Valid Until: " + payload.endsAt + "\n" : "")
  });
}

async function sendCompanyUserEmail(payload) {
  const appUrl = emailAppUrl();
  const html = renderEmailLayout({
    preheader: "Your company HVAC user access is ready.",
    kicker: "User Access",
    title: "Your Account Is Ready",
    summary: "A company admin has created your access to the Musk-IT HVAC platform.",
    bodyHtml:
      "<p style=\"margin:0 0 18px;font-family:Arial,sans-serif;font-size:15px;line-height:1.75;color:#334155;\">Hello "
      + escapeEmailHtml(payload.name)
      + ", your user account is now active under "
      + escapeEmailHtml(payload.companyName)
      + ".</p>"
      + emailCard("Login Credentials", emailCredentialRows([
        { label: "Username", value: payload.username },
        { label: "Temporary Password", value: payload.password },
        { label: "Recovery Key", value: payload.recoveryKey }
      ]))
      + emailCard("Account Details", emailDetailsTable([
        { label: "Company", value: payload.companyName },
        { label: "Email", value: payload.email }
      ]))
      + "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.75;color:#475569;\">Please sign in and update your password after the first login.</div>"
      + emailButton("Open HVAC Platform", appUrl, "#1666a9"),
    footer: "Keep your recovery key secure. It can be used to recover access if you forget your password."
  });

  return EmailService.sendEmail({
    to: payload.email,
    subject: "Your Musk-IT HVAC account is ready",
    html: html,
    text:
      "Company user access created.\n"
      + "Company: " + payload.companyName + "\n"
      + "Username: " + payload.username + "\n"
      + "Email: " + payload.email + "\n"
      + "Temporary Password: " + payload.password + "\n"
      + "Recovery Key: " + payload.recoveryKey + "\n"
  });
}

async function sendPasswordResetTokenEmail(payload) {
  const html = renderEmailLayout({
    preheader: "Use this reset token to set a new password.",
    kicker: "Password Reset",
    title: "Password Reset Requested",
    summary: "Use the one-time token below to securely reset your HVAC platform password.",
    bodyHtml:
      "<p style=\"margin:0 0 18px;font-family:Arial,sans-serif;font-size:15px;line-height:1.75;color:#334155;\">Hello "
      + escapeEmailHtml(payload.name)
      + ", a password reset was requested for your HVAC platform account.</p>"
      + emailCard("Reset Token", emailCredentialRows([
        { label: "One-Time Token", value: payload.token }
      ]))
      + emailCard("Reset Details", emailDetailsTable([
        { label: "Expires At", value: new Date(payload.expiresAt).toLocaleString("en-IN") }
      ]))
      + "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.75;color:#475569;\">If you did not request this reset, you can safely ignore this message.</div>"
      + emailButton("Open Password Reset Page", payload.appUrl || emailAppUrl(), "#1666a9"),
    footer: "For security, this token can only be used once and will expire automatically."
  });

  return EmailService.sendEmail({
    to: payload.to,
    subject: "Musk-IT HVAC password reset token",
    html: html,
    text:
      "Password reset token: " + payload.token + "\n"
      + "Expires at: " + payload.expiresAt + "\n"
      + (payload.appUrl ? "Open the app: " + payload.appUrl + "\n" : "")
  });
}

async function sendCompanyPricingEmail(payload) {
  if (!payload.to) {
    return {
      ok: false,
      skipped: true,
      error: "No company contact email available."
    };
  }

  const html = renderEmailLayout({
    preheader: "Your custom company pricing has been updated and a secure payment link is ready.",
    kicker: "Pricing Update",
    title: "Your Custom Pricing Is Ready",
    summary: "The platform owner has prepared a company-specific license offer for you.",
    bodyHtml:
      "<p style=\"margin:0 0 18px;font-family:Arial,sans-serif;font-size:15px;line-height:1.75;color:#334155;\">Hello "
      + escapeEmailHtml(payload.companyName)
      + " team, your pricing has been updated and a secure payment link is ready below.</p>"
      + emailCard("Pricing Summary", emailDetailsTable([
        { label: "Company", value: payload.companyName },
        { label: "Plan", value: payload.planName },
        { label: "Custom Price", value: payload.priceLabel },
        { label: "User Limit", value: payload.userLimitLabel },
        { label: "Owner Note", value: payload.note || "" }
      ]))
      + emailCard(
        "Secure Payment Link",
        "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.75;color:#475569;\">Use the secure button below to open your locked company payment page. After successful payment, the license will be activated automatically and the company/admin details will be emailed to your contact address.</div>"
        + emailButton("Pay Now via Razorpay", payload.paymentLink, "#1666a9")
        + (payload.paymentLink
          ? "<div style=\"margin-top:14px;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;\">If the button does not open, use this secure link:<br><a href=\"" + escapeEmailHtml(payload.paymentLink) + "\" style=\"color:#1666a9;text-decoration:none;\">" + escapeEmailHtml(payload.paymentLink) + "</a></div>"
          : "")
      ),
    footer: "Questions about pricing or deployment? Reply to this email and the team can assist."
  });

  return EmailService.sendEmail({
    to: payload.to,
    subject: "Musk-IT HVAC pricing updated for " + payload.companyName,
    html: html,
    text:
      "Pricing updated for " + payload.companyName + "\n"
      + "Plan: " + payload.planName + "\n"
      + "Custom Price: " + payload.priceLabel + "\n"
      + "User Limit: " + payload.userLimitLabel + "\n"
      + (payload.paymentLink ? "Payment Link: " + payload.paymentLink + "\n" : "")
      + (payload.note ? "Owner Note: " + payload.note + "\n" : "")
  });
}

async function ensureCompanyRecord(companyName, email, phone) {
  const existing = await store.findCompanyByName(companyName);
  if (existing) {
    return store.upsertCompany({
      id: existing.id,
      name: companyName,
      slug: existing.slug,
      phone: phone || existing.phone || "",
      primaryEmail: email || existing.primaryEmail || "",
      status: existing.status || "prospect",
      activeLicenseId: existing.activeLicenseId || "",
      metadata: existing.metadata || {},
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    });
  }

  return store.upsertCompany({
    id: createCompanyId(companyName),
    name: companyName,
    slug: slugify(companyName),
    phone: phone || "",
    primaryEmail: email || "",
    status: "prospect",
    activeLicenseId: "",
    metadata: {},
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

async function ensureCompanyAdminUser(company, purchaser, licenseInfo) {
  const companyUsers = await store.listCompanyUsers(company.id);
  const existingAdmin = companyUsers.find(function (user) {
    return user.role === "admin";
  });
  if (existingAdmin) {
    const emailResult = await sendLicenseEmail({
      to: purchaser.email,
      adminName: purchaser.name,
      companyName: company.name,
      licenseNumber: licenseInfo.licenseNumber,
      planName: licenseInfo.planName,
      userLimit: licenseInfo.userLimit,
      username: existingAdmin.username || existingAdmin.email,
      password: "Use your current password",
      recoveryKey: "Use your current recovery key",
      endsAt: licenseInfo.endsAt || null
    });
    return {
      user: existingAdmin,
      generatedCredentials: {
        username: existingAdmin.username || existingAdmin.email,
        password: "",
        recoveryKey: "",
        emailSent: !!(emailResult && emailResult.ok),
        emailResult: emailResult
      }
    };
  }

  const username = await ensureUniqueUsername(company.slug + ".admin");
  const password = randomPassword();
  const recoveryKey = "REC-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const passwordCredential = createCredential(password);
  const recoveryCredential = createCredential(recoveryKey);
  const timestamp = nowIso();

  const user = await store.createUser({
    id: "user-" + slugify(company.slug + "-admin-" + purchaser.email),
    name: purchaser.name,
    email: purchaser.email,
    phone: purchaser.phone || "",
    company: company.name,
    companyId: company.id,
    username: username,
    role: "admin",
    passwordSalt: passwordCredential.salt,
    passwordHash: passwordCredential.hash,
    recoverySalt: recoveryCredential.salt,
    recoveryHash: recoveryCredential.hash,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null
  });

  const emailResult = await sendLicenseEmail({
    to: purchaser.email,
    adminName: purchaser.name,
    companyName: company.name,
    licenseNumber: licenseInfo.licenseNumber,
    planName: licenseInfo.planName,
    userLimit: licenseInfo.userLimit,
    username: username,
    password: password,
    recoveryKey: recoveryKey,
    endsAt: licenseInfo.endsAt || null
  });

  return {
    user: user,
    generatedCredentials: {
      username: username,
      password: password,
      recoveryKey: recoveryKey,
      emailSent: !!(emailResult && emailResult.ok),
      emailResult: emailResult
    }
  };
}

function runEnergyCli(command, payload) {
  return new Promise(function (resolve, reject) {
    const pythonBin = process.env.PYTHON_BIN || "python3";
    const child = spawn(
      pythonBin,
      ["-m", "engine.energy.cli", command],
      {
        cwd: ROOT,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(function () {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Energy simulation timed out."));
    }, 15000);

    child.stdout.on("data", function (chunk) {
      stdout += chunk.toString();
    });

    child.stderr.on("data", function (chunk) {
      stderr += chunk.toString();
    });

    child.on("error", function (error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error("Unable to start Python energy engine: " + (error.message || error)));
    });

    child.on("close", function (code) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error((stderr || stdout || "Energy simulation failed.").trim()));
        return;
      }

      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (error) {
        reject(new Error("Energy engine returned invalid JSON."));
      }
    });

    child.stdin.write(JSON.stringify(payload || {}));
    child.stdin.end();
  });
}

async function handleApi(req, res) {
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathname = parsedUrl.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    await store.health();
    sendJson(res, 200, {
      ok: true,
      serverTime: nowIso(),
      capabilities: {
        auth: true,
        projects: true,
        climateStations: true,
        adminOverview: true,
        ownerDashboard: true,
        companyLicensing: true,
        companyAdmin: true,
        paymentsConfigured: razorpayEnabled(),
        emailConfigured: EmailService.isConfigured(),
        energySimulation: true,
        energyComparison: true
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/licensing/plans") {
    const plans = await store.listLicensingPlans();
    sendJson(res, 200, {
      ok: true,
      razorpayEnabled: razorpayEnabled(),
      razorpayKeyId: razorpayEnabled() ? razorpayConfig().keyId : "",
      plans: plans
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/licensing/invite") {
    const token = cleanText(parsedUrl.searchParams.get("token"));
    if (!token) {
      sendJson(res, 400, { ok: false, error: "Invite token is required." });
      return;
    }
    const invite = await store.findActiveLicenseCheckoutInvite(hashCheckoutInviteToken(token));
    if (!invite) {
      sendJson(res, 404, { ok: false, error: "This payment link is invalid, expired, or already used." });
      return;
    }

    await store.markLicenseCheckoutInviteOpened(invite.id);
    const plan = await store.findLicensingPlan(invite.planCode);

    sendJson(res, 200, {
      ok: true,
      invite: {
        companyName: invite.companyName,
        contactName: invite.contactName,
        contactEmail: invite.contactEmail,
        contactPhone: invite.contactPhone,
        planCode: invite.planCode,
        planName: plan ? plan.planName : invite.planCode,
        requestedUsers: invite.requestedUsers,
        annualPriceInr: invite.annualPriceInr,
        userLimit: invite.userLimit,
        note: invite.note || "",
        readonly: true
      }
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/leads/demo") {
    const payload = await parseBody(req);
    const name = cleanText(payload.name);
    const companyName = cleanText(payload.companyName);
    const phone = cleanText(payload.phone);
    const email = normalizeEmail(payload.email);
    const note = cleanText(payload.note);

    if (!name || !companyName || !phone || !email) {
      sendJson(res, 400, { ok: false, error: "Name, company, phone, and email are required." });
      return;
    }

    const lead = await store.createLeadRequest({
      requestType: "demo",
      name: name,
      companyName: companyName,
      phone: phone,
      email: email,
      requestedUsers: 0,
      planCode: "",
      note: note,
      metadata: {}
    });
    sendJson(res, 200, {
      ok: true,
      message: "Demo request submitted successfully. Our team can review it from the owner dashboard.",
      lead: lead
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/leads/quote") {
    const payload = await parseBody(req);
    const name = cleanText(payload.name);
    const companyName = cleanText(payload.companyName);
    const phone = cleanText(payload.phone);
    const email = normalizeEmail(payload.email);
    const requestedUsers = Math.max(integerOrDefault(payload.requestedUsers, 1), 1);
    const planCode = cleanText(payload.planCode) || planCodeForRequestedUsers(requestedUsers);
    const note = cleanText(payload.note);

    if (!name || !companyName || !phone || !email) {
      sendJson(res, 400, { ok: false, error: "Name, company, phone, and email are required." });
      return;
    }

    const lead = await store.createLeadRequest({
      requestType: "quote",
      name: name,
      companyName: companyName,
      phone: phone,
      email: email,
      requestedUsers: requestedUsers,
      planCode: planCode,
      note: note,
      metadata: {}
    });
    sendJson(res, 200, {
      ok: true,
      message: "Quote request submitted successfully.",
      lead: lead
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/licensing/create-order") {
    const payload = await parseBody(req);
    const inviteToken = cleanText(payload.inviteToken);
    const invite = inviteToken
      ? await store.findActiveLicenseCheckoutInvite(hashCheckoutInviteToken(inviteToken))
      : null;
    if (inviteToken && !invite) {
      sendJson(res, 404, { ok: false, error: "This payment link is invalid, expired, or already used." });
      return;
    }

    const purchaserName = cleanText(payload.name) || (invite ? invite.contactName : "");
    const companyName = invite ? invite.companyName : cleanText(payload.companyName);
    const purchaserPhone = cleanText(payload.phone) || (invite ? invite.contactPhone : "");
    const purchaserEmail = normalizeEmail(payload.email || (invite ? invite.contactEmail : ""));
    const requestedUsers = invite
      ? Math.max(integerOrDefault(invite.requestedUsers, 1), 1)
      : Math.max(integerOrDefault(payload.requestedUsers, 1), 1);
    const existingCompany = invite && invite.companyId
      ? await store.findCompanyById(invite.companyId)
      : await store.findCompanyByName(companyName);

    if (!purchaserName || !companyName || !purchaserPhone || !purchaserEmail) {
      sendJson(res, 400, { ok: false, error: "Name, company, phone, and email are required." });
      return;
    }
    if (!razorpayEnabled()) {
      sendJson(res, 400, { ok: false, error: "Razorpay is not configured on the server yet." });
      return;
    }

    const resolvedPlan = await resolvePlanForRequest(invite ? invite.planCode : payload.planCode, requestedUsers, existingCompany && existingCompany.id);
    const lockedPriceInr = invite && invite.annualPriceInr > 0 ? invite.annualPriceInr : resolvedPlan.annualPriceInr;
    const lockedUserLimit = invite && invite.userLimit > 0 ? invite.userLimit : resolvedPlan.userLimit;
    const payment = await store.createLicensePayment({
      companyId: existingCompany ? existingCompany.id : null,
      planCode: resolvedPlan.planCode,
      purchaserName: purchaserName,
      purchaserEmail: purchaserEmail,
      purchaserPhone: purchaserPhone,
      companyName: companyName,
      requestedUsers: requestedUsers,
      amountInr: lockedPriceInr,
      currency: "INR",
      gateway: "razorpay",
      status: "created",
      metadata: {
        planName: resolvedPlan.planName,
        licenseType: resolvedPlan.licenseType,
        userLimit: lockedUserLimit,
        note: invite ? invite.note : cleanText(payload.note),
        inviteId: invite ? invite.id : null
      }
    });

    const order = await callRazorpay("orders", {
      amount: lockedPriceInr * 100,
      currency: "INR",
      receipt: "lic-" + payment.id,
      notes: {
        companyName: companyName,
        planCode: resolvedPlan.planCode,
        purchaserEmail: purchaserEmail,
        requestedUsers: String(requestedUsers),
        inviteId: invite ? String(invite.id) : ""
      }
    });
    await store.updateLicensePaymentOrder(payment.id, order.id, {
      razorpayOrder: order
    });

    sendJson(res, 200, {
      ok: true,
      orderId: order.id,
      razorpayKeyId: razorpayConfig().keyId,
      amountInr: lockedPriceInr,
      amountPaise: lockedPriceInr * 100,
      currency: "INR",
      plan: Object.assign({}, resolvedPlan, {
        annualPriceInr: lockedPriceInr,
        userLimit: lockedUserLimit
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/licensing/confirm-payment") {
    const payload = await parseBody(req);
    const orderId = cleanText(payload.razorpayOrderId);
    const paymentId = cleanText(payload.razorpayPaymentId);
    const signature = cleanText(payload.razorpaySignature);

    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
      sendJson(res, 400, { ok: false, error: "Payment signature verification failed." });
      return;
    }

    const payment = await store.findPaymentByOrderId(orderId);
    if (!payment) {
      sendJson(res, 404, { ok: false, error: "Payment order was not found." });
      return;
    }
    if (payment.status === "paid" && payment.licenseId) {
      const licenses = payment.companyId ? await store.listLicensesForCompany(payment.companyId) : [];
      const existingLicense = licenses.find(function (entry) {
        return entry.id === payment.licenseId;
      });
      sendJson(res, 200, {
        ok: true,
        message: "License was already activated for this payment.",
        license: existingLicense || null
      });
      return;
    }

    const company = await ensureCompanyRecord(payment.companyName, payment.purchaserEmail, payment.purchaserPhone);
    const resolvedPlan = await resolvePlanForRequest(payment.planCode, payment.requestedUsers, company.id);
    const paymentMetadata = payment.metadata || {};
    const lockedUserLimit = integerOrDefault(paymentMetadata.userLimit, 0);
    const effectiveAmountInr = integerOrDefault(payment.amountInr, 0) || resolvedPlan.annualPriceInr;
    const activatedAt = nowIso();
    const endsAt = resolvedPlan.licenseType === "source" ? null : addMonthsIso(activatedAt, resolvedPlan.durationMonths);

    const provisionalLicense = {
      id: createLicenseId(company.name),
      licenseNumber: createLicenseNumber(),
      companyId: company.id,
      planCode: resolvedPlan.planCode,
      licenseType: resolvedPlan.licenseType,
      userLimit: resolvedPlan.licenseType === "source" ? SOURCE_LICENSE_USER_LIMIT : (lockedUserLimit > 0 ? lockedUserLimit : resolvedPlan.userLimit),
      amountInr: effectiveAmountInr,
      currency: "INR",
      durationMonths: resolvedPlan.durationMonths,
      status: "active",
      paymentStatus: "paid",
      adminUserId: "",
      startsAt: activatedAt,
      endsAt: endsAt,
      activatedAt: activatedAt,
      metadata: {
        paymentGateway: "razorpay",
        orderId: orderId,
        paymentId: paymentId
      }
    };

    const license = await store.createLicense(provisionalLicense);
    const adminResult = await ensureCompanyAdminUser(company, {
      name: payment.purchaserName,
      email: payment.purchaserEmail,
      phone: payment.purchaserPhone
    }, {
      licenseNumber: license.licenseNumber,
      planName: resolvedPlan.planName,
      userLimit: license.userLimit,
      endsAt: endsAt
    });
    const finalizedLicense = await store.updateLicenseAdminUser(license.id, adminResult.user.id) || license;

    await store.markLicensePaymentPaid(payment.id, {
      companyId: company.id,
      licenseId: finalizedLicense.id,
      gatewayPaymentId: paymentId,
      gatewaySignature: signature,
      metadata: {
        adminUserId: adminResult.user.id,
        emailSent: !!(adminResult.generatedCredentials && adminResult.generatedCredentials.emailSent)
      }
    });
    if (paymentMetadata.inviteId) {
      await store.markLicenseCheckoutInvitePaid(paymentMetadata.inviteId, {
        licenseId: finalizedLicense.id,
        paymentId: paymentId
      });
    }
    await store.updateCompanyActiveLicense(company.id, finalizedLicense.id, "active");

    sendJson(res, 200, {
      ok: true,
      message: "Payment verified and license activated successfully.",
      license: Object.assign({}, finalizedLicense, {
        adminUserId: adminResult.user.id
      }),
      company: company,
      adminAccount: {
        email: adminResult.user.email,
        username: adminResult.user.username || "",
        emailSent: !!(adminResult.generatedCredentials && adminResult.generatedCredentials.emailSent),
        temporaryPassword: adminResult.generatedCredentials && !adminResult.generatedCredentials.emailSent ? adminResult.generatedCredentials.password : "",
        recoveryKey: adminResult.generatedCredentials && !adminResult.generatedCredentials.emailSent ? adminResult.generatedCredentials.recoveryKey : ""
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/climate/meta") {
    const stats = await store.climateStationStats();
    sendJson(res, 200, { ok: true, stats: stats });
    return;
  }

  if (req.method === "GET" && pathname === "/api/climate/stations") {
    const result = await store.listClimateStations({
      region: parsedUrl.searchParams.get("region") || "",
      q: parsedUrl.searchParams.get("q") || "",
      limit: parsedUrl.searchParams.get("limit") || "250"
    });
    sendJson(res, 200, {
      ok: true,
      total: result.total,
      stations: result.stations
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/session") {
    const session = await getSessionUser(req);
    if (!session.user) {
      sendJson(res, 200, { ok: false, user: null });
      return;
    }
    sendJson(res, 200, { ok: true, user: sanitizeUser(session.user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    sendJson(res, 403, {
      ok: false,
      error: "Self-service account creation is disabled. Use company licensing, quote, or demo onboarding."
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const payload = await parseBody(req);
    const identifier = cleanText(payload.identifier || payload.email || payload.username);
    const password = String(payload.password || "");
    const user = await store.findUserByIdentifier(identifier);

    if (!user) {
      sendJson(res, 404, { ok: false, error: "Account not found for this email or username." });
      return;
    }
    if (!verifyCredential(password, user.password_salt || user.passwordSalt, user.password_hash || user.passwordHash)) {
      sendJson(res, 401, { ok: false, error: "Incorrect password." });
      return;
    }

    const updatedUser = await store.updateUserLoginById(user.id, nowIso()) || user;
    const token = await createSession(updatedUser);
    res.setHeader("Set-Cookie", sessionCookie(token));
    sendJson(res, 200, { ok: true, user: sanitizeUser(updatedUser) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const cookies = parseCookies(req);
    await store.deleteSession(cookies[SESSION_COOKIE]);
    res.setHeader("Set-Cookie", clearSessionCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/forgot-password") {
    const payload = await parseBody(req);
    const email = normalizeEmail(payload.email);
    const user = await store.findUserByEmail(email);

    if (!email) {
      sendJson(res, 400, { ok: false, error: "Email is required." });
      return;
    }

    if (!user) {
      sendJson(res, 200, {
        ok: true,
        message: "If the account exists, a reset token has been sent to the registered email."
      });
      return;
    }

    const token = crypto.randomBytes(4).toString("hex").toUpperCase();
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    await store.clearPasswordResetTokensForUser(user.id);
    await store.createPasswordResetToken(user.id, user.email, tokenHash, expiresAt, {
      channel: "email"
    });

    const appUrl = process.env.APP_URL || "";
    const emailResult = await sendPasswordResetTokenEmail({
      to: user.email,
      name: user.name || user.email,
      token: token,
      expiresAt: expiresAt,
      appUrl: appUrl
    });

    sendJson(res, 200, {
      ok: true,
      message: emailResult && emailResult.ok
        ? "A password reset token has been emailed."
        : "A reset token was generated, but email delivery is not configured. Contact the platform owner or use your recovery key."
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/reset-password") {
    const payload = await parseBody(req);
    const email = normalizeEmail(payload.email);
    const recoveryKey = String(payload.recoveryKey || "").trim();
    const token = String(payload.token || "").trim();
    const newPassword = String(payload.newPassword || "");
    if (newPassword.length < 8) {
      sendJson(res, 400, { ok: false, error: "New password must be at least 8 characters." });
      return;
    }

    let targetUser = null;

    if (token) {
      const tokenRecord = await store.findValidPasswordResetToken(hashResetToken(token));
      if (!tokenRecord) {
        sendJson(res, 401, { ok: false, error: "Reset token is invalid or has expired." });
        return;
      }
      targetUser = tokenRecord;
      await store.markPasswordResetTokenUsed(hashResetToken(token));
    } else {
      const user = await store.findUserByEmail(email);
      if (!user) {
        sendJson(res, 404, { ok: false, error: "Account not found for this email." });
        return;
      }
      if (!verifyCredential(recoveryKey, user.recovery_salt || user.recoverySalt, user.recovery_hash || user.recoveryHash)) {
        sendJson(res, 401, { ok: false, error: "Recovery key did not match this account." });
        return;
      }
      targetUser = user;
    }

    const passwordCredential = createCredential(newPassword);
    await store.updateUserPassword(targetUser.email, passwordCredential.salt, passwordCredential.hash, nowIso());

    sendJson(res, 200, {
      ok: true,
      message: "Password reset successful. Please log in with your new password."
    });
    return;
  }

  if (pathname.indexOf("/api/projects") === 0) {
    const session = await requireAuth(req, res);
    if (!session) {
      return;
    }

    if (req.method === "GET" && pathname === "/api/projects") {
      sendJson(res, 200, { ok: true, projects: await store.listProjectsForUser(session.user.id) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/projects/autosave") {
      sendJson(res, 200, {
        ok: true,
        project: await store.loadAutosave(session.user.id),
        projects: await store.listProjectsForUser(session.user.id)
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/projects/autosave") {
      const payload = await parseBody(req);
      const project = payload.project || null;
      if (project) {
        project.savedAt = nowIso();
        await store.saveAutosave(session.user.id, project);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/projects/save") {
      const payload = await parseBody(req);
      const project = payload.project || null;
      const projectName = String(payload.projectName || (project && project.name) || "HVAC Project");
      if (!project) {
        sendJson(res, 400, { ok: false, error: "Project payload is required." });
        return;
      }

      project.name = projectName;
      project.savedAt = nowIso();
      await store.saveNamedProject(session.user.id, slugify(projectName), projectName, project);
      sendJson(res, 200, {
        ok: true,
        project: project,
        projects: await store.listProjectsForUser(session.user.id)
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/projects/load") {
      const requestedName = parsedUrl.searchParams.get("name");
      const project = requestedName
        ? await store.loadNamedProject(session.user.id, slugify(requestedName))
        : null;
      sendJson(res, 200, {
        ok: true,
        project: project,
        projects: await store.listProjectsForUser(session.user.id)
      });
      return;
    }
  }

  if (pathname.indexOf("/api/energy") === 0) {
    const session = await requireAuth(req, res);
    if (!session) {
      return;
    }

    if (req.method === "POST" && pathname === "/api/energy/simulate") {
      const payload = await parseBody(req);
      const result = await runEnergyCli("simulate", payload || {});
      sendJson(res, 200, Object.assign({
        ok: true,
        generatedAt: nowIso()
      }, result));
      return;
    }

    if (req.method === "POST" && pathname === "/api/energy/compare") {
      const payload = await parseBody(req);
      const result = await runEnergyCli("compare", payload || {});
      sendJson(res, 200, Object.assign({
        ok: true,
        generatedAt: nowIso()
      }, result));
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/company/overview") {
    const session = await requireCompanyAdmin(req, res);
    if (!session) {
      return;
    }

    const requestedCompanyId = isOwner(session.user)
      ? cleanText(parsedUrl.searchParams.get("companyId"))
      : cleanText(session.user.company_id);
    if (!requestedCompanyId) {
      sendJson(res, 400, { ok: false, error: "No company is linked to this admin account." });
      return;
    }

    const company = await store.findCompanyById(requestedCompanyId);
    if (!company) {
      sendJson(res, 404, { ok: false, error: "Company was not found." });
      return;
    }

    const license = await store.getActiveLicenseForCompany(company.id);
    const users = await store.listCompanyUsers(company.id);
    const projects = await store.listProjectsForCompany(company.id);
    const usedSeats = users.length;
    const userLimit = license ? license.userLimit : 0;

    sendJson(res, 200, {
      ok: true,
      company: company,
      license: license,
      seatSummary: {
        usedSeats: usedSeats,
        userLimit: userLimit,
        remainingSeats: Math.max(userLimit - usedSeats, 0)
      },
      users: users.map(function (user) {
        return sanitizeUser(user);
      }),
      projects: projects
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/company/users") {
    const session = await requireCompanyAdmin(req, res);
    if (!session) {
      return;
    }

    const payload = await parseBody(req);
    const targetCompanyId = isOwner(session.user)
      ? cleanText(payload.companyId)
      : cleanText(session.user.company_id);
    const name = cleanText(payload.name);
    const email = normalizeEmail(payload.email);
    const phone = cleanText(payload.phone);

    if (!targetCompanyId) {
      sendJson(res, 400, { ok: false, error: "Target company is required." });
      return;
    }
    if (!name || !email) {
      sendJson(res, 400, { ok: false, error: "Name and email are required." });
      return;
    }

    const company = await store.findCompanyById(targetCompanyId);
    if (!company) {
      sendJson(res, 404, { ok: false, error: "Company was not found." });
      return;
    }
    const license = await store.getActiveLicenseForCompany(targetCompanyId);
    if (!license) {
      sendJson(res, 400, { ok: false, error: "This company does not have an active license yet." });
      return;
    }
    const existing = await store.findUserByEmail(email);
    if (existing) {
      sendJson(res, 409, { ok: false, error: "A user with this email already exists." });
      return;
    }

    const usedSeats = await store.countCompanyUsers(targetCompanyId);
    if (license.userLimit > 0 && usedSeats >= license.userLimit) {
      sendJson(res, 400, { ok: false, error: "Licensed user limit reached for this company." });
      return;
    }

    const username = await ensureUniqueUsername(company.slug + "." + slugify(name).slice(0, 12));
    const password = randomPassword();
    const recoveryKey = "REC-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const passwordCredential = createCredential(password);
    const recoveryCredential = createCredential(recoveryKey);
    const timestamp = nowIso();

    const createdUser = await store.createUser({
      id: "user-" + slugify(email),
      name: name,
      email: email,
      phone: phone,
      company: company.name,
      companyId: company.id,
      username: username,
      createdByUserId: session.user.id,
      role: "user",
      passwordSalt: passwordCredential.salt,
      passwordHash: passwordCredential.hash,
      recoverySalt: recoveryCredential.salt,
      recoveryHash: recoveryCredential.hash,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLoginAt: null
    });

    const emailResult = await sendCompanyUserEmail({
      name: createdUser.name,
      companyName: company.name,
      username: username,
      email: createdUser.email,
      password: password,
      recoveryKey: recoveryKey
    });

    sendJson(res, 200, {
      ok: true,
      user: sanitizeUser(createdUser),
      emailSent: !!(emailResult && emailResult.ok),
      credentialsPreview: emailResult && emailResult.ok
        ? null
        : {
            username: username,
            temporaryPassword: password,
            recoveryKey: recoveryKey
          }
    });
    return;
  }

  if (req.method === "PATCH" && pathname === "/api/company/users") {
    const session = await requireCompanyAdmin(req, res);
    if (!session) {
      return;
    }

    const payload = await parseBody(req);
    const targetCompanyId = isOwner(session.user)
      ? cleanText(payload.companyId)
      : cleanText(session.user.company_id);
    const userId = cleanText(payload.userId);
    const name = cleanText(payload.name);
    const email = normalizeEmail(payload.email);
    const phone = cleanText(payload.phone);

    if (!targetCompanyId || !userId) {
      sendJson(res, 400, { ok: false, error: "Target company and user are required." });
      return;
    }
    if (!name || !email) {
      sendJson(res, 400, { ok: false, error: "Name and email are required." });
      return;
    }

    const company = await store.findCompanyById(targetCompanyId);
    if (!company) {
      sendJson(res, 404, { ok: false, error: "Company was not found." });
      return;
    }

    const targetUser = await store.findUserById(userId);
    if (!targetUser || cleanText(targetUser.company_id) !== targetCompanyId) {
      sendJson(res, 404, { ok: false, error: "Company user was not found." });
      return;
    }

    const existing = await store.findUserByEmail(email);
    if (existing && existing.id !== targetUser.id) {
      sendJson(res, 409, { ok: false, error: "Another user with this email already exists." });
      return;
    }

    const updatedUser = await store.updateCompanyUserProfile(targetUser.id, {
      name: name,
      email: email,
      phone: phone
    });

    sendJson(res, 200, {
      ok: true,
      message: "Company user updated successfully.",
      user: sanitizeUser(updatedUser)
    });
    return;
  }

  if (req.method === "DELETE" && pathname === "/api/company/users") {
    const session = await requireCompanyAdmin(req, res);
    if (!session) {
      return;
    }

    const payload = await parseBody(req);
    const targetCompanyId = isOwner(session.user)
      ? cleanText(payload.companyId)
      : cleanText(session.user.company_id);
    const userId = cleanText(payload.userId);

    if (!targetCompanyId || !userId) {
      sendJson(res, 400, { ok: false, error: "Target company and user are required." });
      return;
    }

    const targetUser = await store.findUserById(userId);
    if (!targetUser || cleanText(targetUser.company_id) !== targetCompanyId) {
      sendJson(res, 404, { ok: false, error: "Company user was not found." });
      return;
    }
    if (cleanText(targetUser.id) === cleanText(session.user.id)) {
      sendJson(res, 400, { ok: false, error: "You cannot delete your own active admin account." });
      return;
    }
    if ((targetUser.role || "user") === "admin") {
      sendJson(res, 400, { ok: false, error: "Admin accounts cannot be deleted from the company user panel." });
      return;
    }

    const deletedUser = await store.deleteUserById(targetUser.id);
    sendJson(res, 200, {
      ok: true,
      message: "Company user deleted successfully.",
      user: deletedUser ? sanitizeUser(deletedUser) : null
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/owner/overview") {
    const session = await requireOwner(req, res);
    if (!session) {
      return;
    }

    const companies = await store.listCompanies();
    const leads = await store.listLeadRequests();
    const users = await store.listUsers();
    const projectRows = await store.listProjects();
    const plans = await store.listLicensingPlans();
    const pricingOverrides = await store.listCompanyPricingOverrides();

    const totals = {
      companyCount: companies.length,
      activeLicenseCount: companies.filter(function (company) {
        return company.activeLicenseStatus === "active";
      }).length,
      leadCount: leads.length,
      demoCount: leads.filter(function (lead) { return lead.requestType === "demo"; }).length,
      quoteCount: leads.filter(function (lead) { return lead.requestType === "quote"; }).length,
      companyUserCount: users.filter(function (user) {
        return !!user.company_id;
      }).length,
      projectCount: projectRows.filter(function (row) { return !row.is_autosave; }).length
    };

    sendJson(res, 200, {
      ok: true,
      totals: totals,
      companies: companies,
      leads: leads,
      plans: plans,
      pricingOverrides: pricingOverrides
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/owner/company-pricing") {
    const session = await requireOwner(req, res);
    if (!session) {
      return;
    }

    const payload = await parseBody(req);
    let companyId = cleanText(payload.companyId);
    let companyName = cleanText(payload.companyName);
    let planCode = cleanText(payload.planCode);
    const annualPriceInr = integerOrDefault(payload.annualPriceInr, 0);
    const userLimit = payload.userLimit == null || payload.userLimit === ""
      ? null
      : integerOrDefault(payload.userLimit, 0);
    const note = cleanText(payload.note);

    if (!companyName && companyId.indexOf("lead::") === 0) {
      companyName = companyId.slice(6);
      companyId = "";
    }
    if (!planCode) {
      planCode = "annual_5";
    }

    if ((!companyId && !companyName) || annualPriceInr <= 0) {
      sendJson(res, 400, { ok: false, error: "Company and valid custom pricing are required." });
      return;
    }

    const latestLead = companyName ? await store.findLatestLeadByCompanyName(companyName) : null;
    let company = companyId
      ? await store.findCompanyById(companyId)
      : null;
    if (!company && companyName) {
      company = await ensureCompanyRecord(companyName, latestLead ? latestLead.email : "", latestLead ? latestLead.phone : "");
    } else if (company && latestLead && (!company.primaryEmail || !company.phone)) {
      company = await store.upsertCompany({
        id: company.id,
        name: company.name,
        slug: company.slug,
        phone: company.phone || latestLead.phone || "",
        primaryEmail: company.primaryEmail || latestLead.email || "",
        status: company.status || "prospect",
        activeLicenseId: company.activeLicenseId || "",
        metadata: company.metadata || {},
        createdAt: company.createdAt,
        updatedAt: nowIso()
      });
    }
    if (!company) {
      sendJson(res, 404, { ok: false, error: "Company was not found." });
      return;
    }
    const plan = await store.findLicensingPlan(planCode);
    if (!plan) {
      sendJson(res, 404, { ok: false, error: "Licensing plan was not found." });
      return;
    }

    await store.upsertCompanyPricingOverride({
      companyId: company.id,
      planCode: planCode,
      annualPriceInr: annualPriceInr,
      userLimit: userLimit,
      note: note,
      updatedByUserId: session.user.id,
      isActive: true
    });

    const inviteToken = createCheckoutInviteToken();
    const inviteExpiresAt = addMonthsIso(nowIso(), 1);
    const inviteRequestedUsers = userLimit != null && userLimit > 0
      ? userLimit
      : integerOrDefault(plan.userLimit, 1);
    const invite = await store.createLicenseCheckoutInvite({
      companyId: company.id,
      planCode: planCode,
      contactName: latestLead ? latestLead.name : "",
      contactEmail: company.primaryEmail || (latestLead ? latestLead.email : ""),
      contactPhone: company.phone || (latestLead ? latestLead.phone : ""),
      companyName: company.name,
      requestedUsers: inviteRequestedUsers,
      annualPriceInr: annualPriceInr,
      userLimit: userLimit,
      note: note,
      createdByUserId: session.user.id,
      tokenHash: hashCheckoutInviteToken(inviteToken),
      expiresAt: inviteExpiresAt,
      metadata: {
        source: "owner-company-pricing"
      }
    });
    const paymentLink = appBaseUrl(req).replace(/\/+$/, "") + "/?licenseInvite=" + encodeURIComponent(inviteToken);

    const pricingEmailResult = await sendCompanyPricingEmail({
      to: company.primaryEmail || (latestLead ? latestLead.email : ""),
      companyName: company.name,
      planName: plan.planName,
      priceLabel: formatInr(annualPriceInr),
      userLimitLabel: userLimit != null && userLimit > 0 ? String(userLimit) + " users" : String(plan.userLimit || "") + " users",
      note: note,
      paymentLink: paymentLink
    });

    sendJson(res, 200, {
      ok: true,
      message: pricingEmailResult && pricingEmailResult.ok
        ? "Custom pricing override saved for " + company.name + ", and the company contact was emailed the pricing details with a secure Razorpay payment link."
        : "Custom pricing override saved for " + company.name + (pricingEmailResult && pricingEmailResult.error ? " Email was not sent: " + pricingEmailResult.error : "."),
      emailSent: !!(pricingEmailResult && pricingEmailResult.ok),
      paymentLink: paymentLink,
      paymentInviteId: invite ? invite.id : null,
      effectivePlans: await store.getEffectivePlansForCompany(company.id)
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/overview") {
    const session = await requireCompanyAdmin(req, res);
    if (!session) {
      return;
    }
    req.url = "/api/company/overview";
    await handleApi(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: "API route not found." });
}

const server = http.createServer(async function (req, res) {
  applySecurityHeaders(req, res);

  try {
    if ((req.url || "").indexOf("/api/") === 0) {
      await handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: error.message || "Server error" });
      return;
    }
    res.end();
  }
});

async function startServer() {
  await store.init();
  await ensureBootstrapOwner();
  await ensureClimateSeed();

  server.listen(PORT, HOST, function () {
    console.log("Musk-IT HVAC platform running at http://" + HOST + ":" + PORT);
    if ((process.env.HVAC_OWNER_EMAIL || process.env.HVAC_ADMIN_EMAIL) && (process.env.HVAC_OWNER_PASSWORD || process.env.HVAC_ADMIN_PASSWORD)) {
      console.log("Bootstrap owner ready for:", process.env.HVAC_OWNER_EMAIL || process.env.HVAC_ADMIN_EMAIL);
    } else {
      console.log("No bootstrap owner env provided. A legacy global admin, if present, will be promoted to owner automatically.");
    }
  });
}

async function shutdown(signal) {
  console.log("Received " + signal + ", closing PostgreSQL connections.");
  try {
    await store.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", function () {
  shutdown("SIGINT");
});

process.on("SIGTERM", function () {
  shutdown("SIGTERM");
});

startServer().catch(function (error) {
  console.error("Failed to start Musk-IT HVAC platform:", error.message || error);
  process.exit(1);
});
