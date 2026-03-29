const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const AUTOSAVE_SLUG = "__autosave__";
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function sslRequested() {
  return truthy(process.env.PGSSL)
    || truthy(process.env.DATABASE_SSL)
    || String(process.env.PGSSLMODE || "").toLowerCase() === "require";
}

function nowIso() {
  return new Date().toISOString();
}

function sslConfig() {
  if (!sslRequested()) {
    return false;
  }
  return {
    rejectUnauthorized: !["false", "0", "no", "off"].includes(String(process.env.PGSSL_REJECT_UNAUTHORIZED || process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || "false").toLowerCase())
  };
}

function poolConfig(options) {
  const useSsl = !(options && options.disableSsl);
  const ssl = useSsl ? sslConfig() : false;
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: ssl,
      max: parseInt(process.env.PGPOOL_MAX || "10", 10),
      idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || "10000", 10),
      application_name: "musk-it-hvac-platform"
    };
  }

  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: parseInt(process.env.PGPORT || "5432", 10),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "musk_it_hvac",
    ssl: ssl,
    max: parseInt(process.env.PGPOOL_MAX || "10", 10),
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || "10000", 10),
    application_name: "musk-it-hvac-platform"
  };
}

function sslUnsupportedError(error) {
  const message = String(error && error.message ? error.message : "").toLowerCase();
  return message.includes("does not support ssl connections")
    || message.includes("ssl is not enabled on the server")
    || message.includes("server does not support ssl");
}

function normalizeProjectData(projectData, projectName, savedAt) {
  const payload = JSON.parse(JSON.stringify(projectData || {}));
  payload.name = projectName || payload.name || "HVAC Project";
  payload.savedAt = savedAt;
  return payload;
}

function projectSummary(row) {
  const project = typeof row.project_data === "string" ? JSON.parse(row.project_data) : row.project_data;
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
    slug: row.slug,
    name: row.project_name,
    savedAt: row.saved_at,
    roomCount: rooms.length,
    calculatedRoomCount: roomsWithResults.length,
    totalTR: Math.round(totalTR * 100) / 100,
    totalCFM: Math.round(totalCFM)
  };
}

function cleanText(value) {
  return String(value == null ? "" : value).trim();
}

function numericOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrDefault(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function climateStationRow(row) {
  return {
    stationKey: row.station_key,
    source: row.source,
    sourceVersion: row.source_version || "",
    region: row.region || "",
    city: row.city,
    country: row.country || "",
    wmoCode: row.wmo_code || "",
    lat: numericOrNull(row.latitude),
    lon: numericOrNull(row.longitude),
    elev: numericOrNull(row.elevation_m),
    zone: row.climate_zone || "",
    koppen: row.koppen || "",
    dbt04: numericOrNull(row.dbt_04_c),
    wbt_c: numericOrNull(row.wbt_coincident_c),
    wbt04: numericOrNull(row.wbt_04_c),
    mdr: numericOrNull(row.mean_daily_range_c),
    heat99: numericOrNull(row.heating_99_6_c),
    rh: numericOrNull(row.rh_percent),
    metadata: row.metadata || {}
  };
}

function climateStationRecord(station, defaults) {
  const source = cleanText((station && station.source) || (defaults && defaults.source) || "ashrae");
  const sourceVersion = cleanText((station && station.sourceVersion) || (defaults && defaults.sourceVersion) || "");
  const city = cleanText(station && station.city);
  const region = cleanText(station && station.region);
  const country = cleanText(station && station.country);
  const wmoCode = cleanText(station && station.wmoCode);
  const stationKey = cleanText((station && station.stationKey) || [source || "ashrae", sourceVersion || "default", region || "global", city || "station", country || ""].join("|").toLowerCase().replace(/\s+/g, " "));

  return {
    stationKey: stationKey,
    source: source || "ashrae",
    sourceVersion: sourceVersion,
    region: region,
    city: city,
    country: country,
    wmoCode: wmoCode,
    latitude: numericOrNull(station && station.lat),
    longitude: numericOrNull(station && station.lon),
    elevationM: numericOrNull(station && station.elev),
    climateZone: cleanText(station && station.zone),
    koppen: cleanText(station && station.koppen),
    dbt04: numericOrNull(station && station.dbt04),
    wbtCoincident: numericOrNull(station && station.wbt_c),
    wbt04: numericOrNull(station && station.wbt04),
    meanDailyRange: numericOrNull(station && station.mdr),
    heating996: numericOrNull(station && station.heat99),
    rhPercent: numericOrNull(station && station.rh),
    metadata: station && station.metadata ? station.metadata : {}
  };
}

function companyRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    phone: row.phone || "",
    primaryEmail: row.primary_email || "",
    status: row.status || "prospect",
    activeLicenseId: row.active_license_id || "",
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function licensingPlanRow(row) {
  return {
    planCode: row.plan_code,
    planName: row.plan_name,
    licenseType: row.license_type,
    userMin: integerOrDefault(row.user_min, 1),
    userMax: integerOrDefault(row.user_max, 1),
    userLimit: integerOrDefault(row.user_limit, 1),
    annualPriceInr: integerOrDefault(row.annual_price_inr, 0),
    durationMonths: integerOrDefault(row.duration_months, 12),
    isActive: !!row.is_active,
    metadata: row.metadata || {}
  };
}

function leadRequestRow(row) {
  return {
    id: row.id,
    requestType: row.request_type,
    name: row.name,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    requestedUsers: integerOrDefault(row.requested_users, 0),
    planCode: row.plan_code || "",
    note: row.note || "",
    status: row.status || "new",
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function licenseRow(row) {
  return {
    id: row.id,
    licenseNumber: row.license_number,
    companyId: row.company_id,
    planCode: row.plan_code,
    licenseType: row.license_type,
    userLimit: integerOrDefault(row.user_limit, 0),
    amountInr: integerOrDefault(row.amount_inr, 0),
    currency: row.currency || "INR",
    durationMonths: integerOrDefault(row.duration_months, 12),
    status: row.status || "pending",
    paymentStatus: row.payment_status || "pending",
    adminUserId: row.admin_user_id || "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    activatedAt: row.activated_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function paymentRow(row) {
  return {
    id: row.id,
    companyId: row.company_id || "",
    licenseId: row.license_id || "",
    planCode: row.plan_code || "",
    purchaserName: row.purchaser_name,
    purchaserEmail: row.purchaser_email,
    purchaserPhone: row.purchaser_phone || "",
    companyName: row.company_name || "",
    requestedUsers: integerOrDefault(row.requested_users, 0),
    amountInr: integerOrDefault(row.amount_inr, 0),
    currency: row.currency || "INR",
    gateway: row.gateway || "razorpay",
    gatewayOrderId: row.gateway_order_id || "",
    gatewayPaymentId: row.gateway_payment_id || "",
    gatewaySignature: row.gateway_signature || "",
    status: row.status || "created",
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function licenseCheckoutInviteRow(row) {
  return {
    id: row.id,
    companyId: row.company_id || "",
    planCode: row.plan_code,
    contactName: row.contact_name || "",
    contactEmail: row.contact_email || "",
    contactPhone: row.contact_phone || "",
    companyName: row.company_name,
    requestedUsers: integerOrDefault(row.requested_users, 1),
    annualPriceInr: integerOrDefault(row.annual_price_inr, 0),
    userLimit: row.user_limit == null ? null : integerOrDefault(row.user_limit, 0),
    note: row.note || "",
    createdByUserId: row.created_by_user_id || "",
    tokenHash: row.token_hash,
    isActive: !!row.is_active,
    openedAt: row.opened_at || null,
    paidAt: row.paid_at || null,
    expiresAt: row.expires_at || null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class PostgresStore {
  constructor() {
    this.pool = new Pool(poolConfig());
    this.initialized = false;
    this.initializing = null;
    this.sslFallbackApplied = false;
  }

  async switchToNonSslPool() {
    if (this.sslFallbackApplied) {
      return;
    }
    const oldPool = this.pool;
    this.pool = new Pool(poolConfig({ disableSsl: true }));
    this.sslFallbackApplied = true;
    this.initialized = false;
    this.initializing = null;
    try {
      await oldPool.end();
    } catch (error) {
      // Ignore close errors while switching pool mode.
    }
  }

  async init() {
    if (this.initialized) {
      return;
    }
    if (this.initializing) {
      await this.initializing;
      return;
    }
    this.initializing = (async () => {
      try {
        await this.pool.query(SCHEMA_SQL);
        this.initialized = true;
      } catch (error) {
        if (sslRequested() && !this.sslFallbackApplied && sslUnsupportedError(error)) {
          await this.switchToNonSslPool();
          await this.pool.query(SCHEMA_SQL);
          this.initialized = true;
          return;
        }
        throw error;
      } finally {
        this.initializing = null;
      }
    })();
    await this.initializing;
  }

  async close() {
    await this.pool.end();
  }

  async health() {
    await this.init();
    await this.pool.query("SELECT 1");
    return true;
  }

  async withTransaction(work) {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByEmail(email) {
    await this.init();
    const result = await this.pool.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [email]);
    return result.rows[0] || null;
  }

  async findUserByUsername(username) {
    await this.init();
    const result = await this.pool.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1", [username]);
    return result.rows[0] || null;
  }

  async findUserByIdentifier(identifier) {
    const normalized = cleanText(identifier).toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized.indexOf("@") !== -1) {
      return this.findUserByEmail(normalized);
    }
    return this.findUserByUsername(normalized);
  }

  async findUserById(userId) {
    await this.init();
    const result = await this.pool.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
    return result.rows[0] || null;
  }

  async createUser(user) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO users (id, name, email, phone, company, role, username, company_id, created_by_user_id, password_salt, password_hash, recovery_salt, recovery_hash, created_at, updated_at, last_login_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *",
      [
        user.id,
        user.name,
        user.email,
        user.phone || "",
        user.company || "",
        user.role || "user",
        user.username || null,
        user.companyId || null,
        user.createdByUserId || null,
        user.passwordSalt,
        user.passwordHash,
        user.recoverySalt,
        user.recoveryHash,
        user.createdAt,
        user.updatedAt,
        user.lastLoginAt || null
      ]
    );
    return result.rows[0];
  }

  async upsertUser(user) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO users (id, name, email, phone, company, role, username, company_id, created_by_user_id, password_salt, password_hash, recovery_salt, recovery_hash, created_at, updated_at, last_login_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id, name = EXCLUDED.name, phone = EXCLUDED.phone, company = EXCLUDED.company, role = EXCLUDED.role, username = EXCLUDED.username, company_id = EXCLUDED.company_id, created_by_user_id = EXCLUDED.created_by_user_id, password_salt = EXCLUDED.password_salt, password_hash = EXCLUDED.password_hash, recovery_salt = EXCLUDED.recovery_salt, recovery_hash = EXCLUDED.recovery_hash, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, last_login_at = EXCLUDED.last_login_at RETURNING *",
      [
        user.id,
        user.name,
        user.email,
        user.phone || "",
        user.company || "",
        user.role || "user",
        user.username || null,
        user.companyId || null,
        user.createdByUserId || null,
        user.passwordSalt,
        user.passwordHash,
        user.recoverySalt,
        user.recoveryHash,
        user.createdAt,
        user.updatedAt,
        user.lastLoginAt || null
      ]
    );
    return result.rows[0];
  }

  async updateUserLogin(email, timestamp) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE users SET last_login_at = $2, updated_at = $2 WHERE email = $1 RETURNING *",
      [email, timestamp]
    );
    return result.rows[0] || null;
  }

  async updateUserLoginById(userId, timestamp) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE users SET last_login_at = $2, updated_at = $2 WHERE id = $1 RETURNING *",
      [userId, timestamp]
    );
    return result.rows[0] || null;
  }

  async updateUserPassword(email, passwordSalt, passwordHash, updatedAt) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE users SET password_salt = $2, password_hash = $3, updated_at = $4 WHERE email = $1 RETURNING *",
      [email, passwordSalt, passwordHash, updatedAt]
    );
    return result.rows[0] || null;
  }

  async updateCompanyUserProfile(userId, updates) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE users SET name = $2, email = $3, phone = $4, updated_at = NOW() WHERE id = $1 RETURNING *",
      [
        userId,
        updates.name,
        updates.email,
        updates.phone || ""
      ]
    );
    return result.rows[0] || null;
  }

  async deleteUserById(userId) {
    await this.init();
    const result = await this.pool.query(
      "DELETE FROM users WHERE id = $1 RETURNING *",
      [userId]
    );
    return result.rows[0] || null;
  }

  async createPasswordResetToken(userId, email, tokenHash, expiresAt, metadata) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO password_reset_tokens (user_id, email, token_hash, expires_at, metadata, created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *",
      [userId, email, tokenHash, expiresAt, metadata || {}]
    );
    return result.rows[0] || null;
  }

  async findValidPasswordResetToken(tokenHash) {
    await this.init();
    const result = await this.pool.query(
      "SELECT prt.*, u.* FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id WHERE prt.token_hash = $1 AND prt.used_at IS NULL AND prt.expires_at > NOW() ORDER BY prt.created_at DESC LIMIT 1",
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  async markPasswordResetTokenUsed(tokenHash) {
    await this.init();
    await this.pool.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL",
      [tokenHash]
    );
  }

  async clearPasswordResetTokensForUser(userId) {
    await this.init();
    await this.pool.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1",
      [userId]
    );
  }

  async createSession(token, user, createdAt, expiresAt) {
    await this.init();
    await this.pool.query(
      "INSERT INTO sessions (token, user_id, email, created_at, expires_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, email = EXCLUDED.email, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at",
      [token, user.id, user.email, createdAt, expiresAt]
    );
  }

  async deleteSession(token) {
    await this.init();
    if (!token) {
      return;
    }
    await this.pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  }

  async upsertSessionRecord(session) {
    await this.init();
    await this.pool.query(
      "INSERT INTO sessions (token, user_id, email, created_at, expires_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, email = EXCLUDED.email, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at",
      [session.token, session.userId, session.email, session.createdAt, session.expiresAt]
    );
  }

  async getSessionWithUser(token) {
    await this.init();
    const result = await this.pool.query(
      "SELECT s.token, s.email AS session_email, s.created_at AS session_created_at, s.expires_at AS session_expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > NOW() LIMIT 1",
      [token]
    );
    return result.rows[0] || null;
  }

  async saveAutosave(userId, project) {
    await this.init();
    const savedAt = (project && project.savedAt) || new Date().toISOString();
    const projectName = (project && project.name) || "HVAC Project";
    const payload = normalizeProjectData(project, projectName, savedAt);
    await this.pool.query(
      "INSERT INTO projects (user_id, slug, project_name, is_autosave, project_data, saved_at, updated_at) VALUES ($1,$2,$3,TRUE,$4,$5,$5) ON CONFLICT (user_id, slug) DO UPDATE SET project_name = EXCLUDED.project_name, is_autosave = TRUE, project_data = EXCLUDED.project_data, saved_at = EXCLUDED.saved_at, updated_at = EXCLUDED.updated_at",
      [userId, AUTOSAVE_SLUG, projectName, payload, savedAt]
    );
  }

  async saveNamedProject(userId, slug, projectName, project) {
    await this.init();
    const savedAt = (project && project.savedAt) || new Date().toISOString();
    const payload = normalizeProjectData(project, projectName, savedAt);
    await this.withTransaction(async (client) => {
      await client.query(
        "INSERT INTO projects (user_id, slug, project_name, is_autosave, project_data, saved_at, updated_at) VALUES ($1,$2,$3,FALSE,$4,$5,$5) ON CONFLICT (user_id, slug) DO UPDATE SET project_name = EXCLUDED.project_name, is_autosave = FALSE, project_data = EXCLUDED.project_data, saved_at = EXCLUDED.saved_at, updated_at = EXCLUDED.updated_at",
        [userId, slug, projectName, payload, savedAt]
      );
      await client.query(
        "INSERT INTO projects (user_id, slug, project_name, is_autosave, project_data, saved_at, updated_at) VALUES ($1,$2,$3,TRUE,$4,$5,$5) ON CONFLICT (user_id, slug) DO UPDATE SET project_name = EXCLUDED.project_name, is_autosave = TRUE, project_data = EXCLUDED.project_data, saved_at = EXCLUDED.saved_at, updated_at = EXCLUDED.updated_at",
        [userId, AUTOSAVE_SLUG, projectName, payload, savedAt]
      );
    });
    return payload;
  }

  async upsertProjectRecord(record) {
    await this.init();
    const savedAt = record.savedAt || new Date().toISOString();
    const projectData = normalizeProjectData(record.projectData, record.projectName, savedAt);
    await this.pool.query(
      "INSERT INTO projects (user_id, slug, project_name, is_autosave, project_data, saved_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, slug) DO UPDATE SET project_name = EXCLUDED.project_name, is_autosave = EXCLUDED.is_autosave, project_data = EXCLUDED.project_data, saved_at = EXCLUDED.saved_at, updated_at = EXCLUDED.updated_at",
      [record.userId, record.slug, record.projectName, !!record.isAutosave, projectData, savedAt, record.createdAt || savedAt, record.updatedAt || savedAt]
    );
  }

  async loadAutosave(userId) {
    await this.init();
    const result = await this.pool.query(
      "SELECT project_data FROM projects WHERE user_id = $1 AND slug = $2 LIMIT 1",
      [userId, AUTOSAVE_SLUG]
    );
    return result.rows[0] ? result.rows[0].project_data : null;
  }

  async loadNamedProject(userId, slug) {
    await this.init();
    const result = await this.pool.query(
      "SELECT project_data FROM projects WHERE user_id = $1 AND slug = $2 AND is_autosave = FALSE LIMIT 1",
      [userId, slug]
    );
    return result.rows[0] ? result.rows[0].project_data : null;
  }

  async listProjectsForUser(userId) {
    await this.init();
    const result = await this.pool.query(
      "SELECT slug, project_name, project_data, saved_at FROM projects WHERE user_id = $1 AND is_autosave = FALSE ORDER BY saved_at DESC",
      [userId]
    );
    return result.rows.map(projectSummary);
  }

  async listUsers() {
    await this.init();
    const result = await this.pool.query("SELECT * FROM users ORDER BY created_at DESC");
    return result.rows;
  }

  async listProjects() {
    await this.init();
    const result = await this.pool.query("SELECT user_id, slug, project_name, project_data, saved_at, is_autosave FROM projects ORDER BY saved_at DESC");
    return result.rows;
  }

  async findOwnerUser() {
    await this.init();
    const result = await this.pool.query("SELECT * FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1");
    return result.rows[0] || null;
  }

  async promoteLegacyGlobalAdminToOwner() {
    await this.init();
    const owner = await this.findOwnerUser();
    if (owner) {
      return owner;
    }
    const result = await this.pool.query(
      "UPDATE users SET role = 'owner', updated_at = NOW() WHERE id = (SELECT id FROM users WHERE role = 'admin' AND company_id IS NULL ORDER BY created_at ASC LIMIT 1) RETURNING *"
    );
    return result.rows[0] || null;
  }

  async findCompanyById(companyId) {
    await this.init();
    const result = await this.pool.query("SELECT * FROM companies WHERE id = $1 LIMIT 1", [companyId]);
    return result.rows[0] ? companyRow(result.rows[0]) : null;
  }

  async findCompanyByName(name) {
    await this.init();
    const trimmed = cleanText(name);
    if (!trimmed) {
      return null;
    }
    const result = await this.pool.query("SELECT * FROM companies WHERE LOWER(name) = LOWER($1) OR slug = $2 LIMIT 1", [
      trimmed,
      trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company"
    ]);
    return result.rows[0] ? companyRow(result.rows[0]) : null;
  }

  async upsertCompany(company) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO companies (id, name, slug, phone, primary_email, status, active_license_id, metadata, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, primary_email = EXCLUDED.primary_email, status = EXCLUDED.status, active_license_id = EXCLUDED.active_license_id, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at RETURNING *",
      [
        company.id,
        company.name,
        company.slug,
        company.phone || "",
        company.primaryEmail || "",
        company.status || "prospect",
        company.activeLicenseId || "",
        company.metadata || {},
        company.createdAt || nowIso(),
        company.updatedAt || nowIso()
      ]
    );
    return result.rows[0] ? companyRow(result.rows[0]) : null;
  }

  async updateCompanyActiveLicense(companyId, activeLicenseId, status) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE companies SET active_license_id = $2, status = $3, updated_at = NOW() WHERE id = $1 RETURNING *",
      [companyId, activeLicenseId || "", status || "active"]
    );
    return result.rows[0] ? companyRow(result.rows[0]) : null;
  }

  async listCompanies() {
    await this.init();
    const result = await this.pool.query(
      "SELECT c.*, l.license_number, l.plan_code, l.user_limit, l.amount_inr, l.status AS license_status, l.payment_status, l.ends_at, COALESCE(u.user_count, 0) AS user_count FROM companies c LEFT JOIN licenses l ON l.id = NULLIF(c.active_license_id, '') LEFT JOIN (SELECT company_id, COUNT(*)::INT AS user_count FROM users WHERE company_id IS NOT NULL GROUP BY company_id) u ON u.company_id = c.id ORDER BY c.created_at DESC"
    );
    return result.rows.map(function (row) {
      return Object.assign(companyRow(row), {
        activeLicenseNumber: row.license_number || "",
        activePlanCode: row.plan_code || "",
        activeUserLimit: integerOrDefault(row.user_limit, 0),
        activeAmountInr: integerOrDefault(row.amount_inr, 0),
        activeLicenseStatus: row.license_status || "",
        activePaymentStatus: row.payment_status || "",
        activeLicenseEndsAt: row.ends_at || null,
        userCount: integerOrDefault(row.user_count, 0)
      });
    });
  }

  async listLicensingPlans() {
    await this.init();
    const result = await this.pool.query(
      "SELECT * FROM licensing_plans WHERE is_active = TRUE ORDER BY (metadata->>'displayOrder')::INT NULLS LAST, annual_price_inr ASC"
    );
    return result.rows.map(licensingPlanRow);
  }

  async findLicensingPlan(planCode) {
    await this.init();
    const result = await this.pool.query("SELECT * FROM licensing_plans WHERE plan_code = $1 LIMIT 1", [planCode]);
    return result.rows[0] ? licensingPlanRow(result.rows[0]) : null;
  }

  async upsertLicensingPlan(plan) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO licensing_plans (plan_code, plan_name, license_type, user_min, user_max, user_limit, annual_price_inr, duration_months, is_active, metadata, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT (plan_code) DO UPDATE SET plan_name = EXCLUDED.plan_name, license_type = EXCLUDED.license_type, user_min = EXCLUDED.user_min, user_max = EXCLUDED.user_max, user_limit = EXCLUDED.user_limit, annual_price_inr = EXCLUDED.annual_price_inr, duration_months = EXCLUDED.duration_months, is_active = EXCLUDED.is_active, metadata = EXCLUDED.metadata, updated_at = NOW() RETURNING *",
      [
        plan.planCode,
        plan.planName,
        plan.licenseType,
        plan.userMin,
        plan.userMax,
        plan.userLimit,
        plan.annualPriceInr,
        plan.durationMonths,
        plan.isActive !== false,
        plan.metadata || {}
      ]
    );
    return result.rows[0] ? licensingPlanRow(result.rows[0]) : null;
  }

  async listCompanyPricingOverrides(companyId) {
    await this.init();
    const values = [];
    let whereSql = "";
    if (companyId) {
      values.push(companyId);
      whereSql = " WHERE o.company_id = $" + values.length;
    }
    const result = await this.pool.query(
      "SELECT o.*, p.plan_name, p.license_type FROM company_pricing_overrides o JOIN licensing_plans p ON p.plan_code = o.plan_code" + whereSql + " ORDER BY o.updated_at DESC",
      values
    );
    return result.rows.map(function (row) {
      return {
        id: row.id,
        companyId: row.company_id,
        planCode: row.plan_code,
        planName: row.plan_name,
        licenseType: row.license_type,
        annualPriceInr: integerOrDefault(row.annual_price_inr, 0),
        userLimit: row.user_limit == null ? null : integerOrDefault(row.user_limit, 0),
        note: row.note || "",
        updatedByUserId: row.updated_by_user_id || "",
        isActive: !!row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
  }

  async upsertCompanyPricingOverride(override) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO company_pricing_overrides (company_id, plan_code, annual_price_inr, user_limit, note, updated_by_user_id, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) ON CONFLICT (company_id, plan_code) DO UPDATE SET annual_price_inr = EXCLUDED.annual_price_inr, user_limit = EXCLUDED.user_limit, note = EXCLUDED.note, updated_by_user_id = EXCLUDED.updated_by_user_id, is_active = EXCLUDED.is_active, updated_at = NOW() RETURNING *",
      [
        override.companyId,
        override.planCode,
        override.annualPriceInr,
        override.userLimit == null ? null : override.userLimit,
        override.note || "",
        override.updatedByUserId || "",
        override.isActive !== false
      ]
    );
    return result.rows[0] || null;
  }

  async getEffectivePlansForCompany(companyId) {
    await this.init();
    const result = await this.pool.query(
      "SELECT p.*, o.annual_price_inr AS override_price_inr, o.user_limit AS override_user_limit, o.note AS override_note, o.is_active AS override_active FROM licensing_plans p LEFT JOIN company_pricing_overrides o ON o.plan_code = p.plan_code AND o.company_id = $1 AND o.is_active = TRUE WHERE p.is_active = TRUE ORDER BY (p.metadata->>'displayOrder')::INT NULLS LAST, p.annual_price_inr ASC",
      [companyId]
    );
    return result.rows.map(function (row) {
      const basePlan = licensingPlanRow(row);
      return Object.assign({}, basePlan, {
        effectivePriceInr: row.override_price_inr == null ? basePlan.annualPriceInr : integerOrDefault(row.override_price_inr, basePlan.annualPriceInr),
        effectiveUserLimit: row.override_user_limit == null ? basePlan.userLimit : integerOrDefault(row.override_user_limit, basePlan.userLimit),
        overrideNote: row.override_note || "",
        hasOverride: row.override_price_inr != null || row.override_user_limit != null
      });
    });
  }

  async createLeadRequest(lead) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO lead_requests (request_type, name, company_name, phone, email, requested_users, plan_code, note, status, metadata, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING *",
      [
        lead.requestType,
        lead.name,
        lead.companyName,
        lead.phone,
        lead.email,
        lead.requestedUsers || 0,
        lead.planCode || "",
        lead.note || "",
        lead.status || "new",
        lead.metadata || {}
      ]
    );
    return result.rows[0] ? leadRequestRow(result.rows[0]) : null;
  }

  async listLeadRequests() {
    await this.init();
    const result = await this.pool.query("SELECT * FROM lead_requests ORDER BY created_at DESC");
    return result.rows.map(leadRequestRow);
  }

  async findLatestLeadByCompanyName(companyName) {
    await this.init();
    const trimmed = cleanText(companyName);
    if (!trimmed) {
      return null;
    }
    const result = await this.pool.query(
      "SELECT * FROM lead_requests WHERE LOWER(company_name) = LOWER($1) ORDER BY created_at DESC LIMIT 1",
      [trimmed]
    );
    return result.rows[0] ? leadRequestRow(result.rows[0]) : null;
  }

  async createLicensePayment(payment) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO license_payments (company_id, license_id, plan_code, purchaser_name, purchaser_email, purchaser_phone, company_name, requested_users, amount_inr, currency, gateway, gateway_order_id, gateway_payment_id, gateway_signature, status, metadata, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) RETURNING *",
      [
        payment.companyId || null,
        payment.licenseId || null,
        payment.planCode || "",
        payment.purchaserName,
        payment.purchaserEmail,
        payment.purchaserPhone || "",
        payment.companyName,
        payment.requestedUsers || 0,
        payment.amountInr || 0,
        payment.currency || "INR",
        payment.gateway || "razorpay",
        payment.gatewayOrderId || "",
        payment.gatewayPaymentId || "",
        payment.gatewaySignature || "",
        payment.status || "created",
        payment.metadata || {}
      ]
    );
    return result.rows[0] ? paymentRow(result.rows[0]) : null;
  }

  async createLicenseCheckoutInvite(invite) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO license_checkout_invites (company_id, plan_code, contact_name, contact_email, contact_phone, company_name, requested_users, annual_price_inr, user_limit, note, created_by_user_id, token_hash, is_active, opened_at, paid_at, expires_at, metadata, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW()) RETURNING *",
      [
        invite.companyId || null,
        invite.planCode,
        invite.contactName || "",
        invite.contactEmail || "",
        invite.contactPhone || "",
        invite.companyName,
        invite.requestedUsers || 1,
        invite.annualPriceInr || 0,
        invite.userLimit == null ? null : invite.userLimit,
        invite.note || "",
        invite.createdByUserId || "",
        invite.tokenHash,
        invite.isActive !== false,
        invite.openedAt || null,
        invite.paidAt || null,
        invite.expiresAt || null,
        invite.metadata || {}
      ]
    );
    return result.rows[0] ? licenseCheckoutInviteRow(result.rows[0]) : null;
  }

  async findActiveLicenseCheckoutInvite(tokenHash) {
    await this.init();
    const result = await this.pool.query(
      "SELECT * FROM license_checkout_invites WHERE token_hash = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT 1",
      [tokenHash]
    );
    return result.rows[0] ? licenseCheckoutInviteRow(result.rows[0]) : null;
  }

  async markLicenseCheckoutInviteOpened(inviteId) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE license_checkout_invites SET opened_at = COALESCE(opened_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *",
      [inviteId]
    );
    return result.rows[0] ? licenseCheckoutInviteRow(result.rows[0]) : null;
  }

  async markLicenseCheckoutInvitePaid(inviteId, metadata) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE license_checkout_invites SET is_active = FALSE, paid_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *",
      [inviteId, metadata || {}]
    );
    return result.rows[0] ? licenseCheckoutInviteRow(result.rows[0]) : null;
  }

  async updateLicensePaymentOrder(paymentId, gatewayOrderId, metadata) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE license_payments SET gateway_order_id = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *",
      [paymentId, gatewayOrderId || "", metadata || {}]
    );
    return result.rows[0] ? paymentRow(result.rows[0]) : null;
  }

  async findPaymentByOrderId(orderId) {
    await this.init();
    const result = await this.pool.query("SELECT * FROM license_payments WHERE gateway_order_id = $1 LIMIT 1", [orderId]);
    return result.rows[0] ? paymentRow(result.rows[0]) : null;
  }

  async findPaymentById(paymentId) {
    await this.init();
    const result = await this.pool.query("SELECT * FROM license_payments WHERE id = $1 LIMIT 1", [paymentId]);
    return result.rows[0] ? paymentRow(result.rows[0]) : null;
  }

  async markLicensePaymentPaid(paymentId, update) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE license_payments SET company_id = COALESCE($2, company_id), license_id = COALESCE($3, license_id), gateway_payment_id = $4, gateway_signature = $5, status = 'paid', metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *",
      [paymentId, update.companyId || null, update.licenseId || null, update.gatewayPaymentId || "", update.gatewaySignature || "", update.metadata || {}]
    );
    return result.rows[0] ? paymentRow(result.rows[0]) : null;
  }

  async createLicense(license) {
    await this.init();
    const result = await this.pool.query(
      "INSERT INTO licenses (id, license_number, company_id, plan_code, license_type, user_limit, amount_inr, currency, duration_months, status, payment_status, admin_user_id, starts_at, ends_at, activated_at, metadata, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) RETURNING *",
      [
        license.id,
        license.licenseNumber,
        license.companyId,
        license.planCode,
        license.licenseType,
        license.userLimit,
        license.amountInr || 0,
        license.currency || "INR",
        license.durationMonths == null ? 12 : license.durationMonths,
        license.status || "active",
        license.paymentStatus || "paid",
        license.adminUserId || "",
        license.startsAt || null,
        license.endsAt || null,
        license.activatedAt || null,
        license.metadata || {}
      ]
    );
    return result.rows[0] ? licenseRow(result.rows[0]) : null;
  }

  async listLicensesForCompany(companyId) {
    await this.init();
    const result = await this.pool.query("SELECT * FROM licenses WHERE company_id = $1 ORDER BY created_at DESC", [companyId]);
    return result.rows.map(licenseRow);
  }

  async updateLicenseAdminUser(licenseId, adminUserId) {
    await this.init();
    const result = await this.pool.query(
      "UPDATE licenses SET admin_user_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
      [licenseId, adminUserId || ""]
    );
    return result.rows[0] ? licenseRow(result.rows[0]) : null;
  }

  async getActiveLicenseForCompany(companyId) {
    await this.init();
    const result = await this.pool.query(
      "SELECT * FROM licenses WHERE company_id = $1 AND status = 'active' ORDER BY activated_at DESC NULLS LAST, created_at DESC LIMIT 1",
      [companyId]
    );
    return result.rows[0] ? licenseRow(result.rows[0]) : null;
  }

  async listCompanyUsers(companyId) {
    await this.init();
    const result = await this.pool.query(
      "SELECT * FROM users WHERE company_id = $1 ORDER BY CASE WHEN role = 'admin' THEN 0 WHEN role = 'owner' THEN 1 ELSE 2 END, created_at ASC",
      [companyId]
    );
    return result.rows;
  }

  async countCompanyUsers(companyId) {
    await this.init();
    const result = await this.pool.query(
      "SELECT COUNT(*)::INT AS count FROM users WHERE company_id = $1",
      [companyId]
    );
    return result.rows[0] ? result.rows[0].count : 0;
  }

  async listProjectsForCompany(companyId) {
    await this.init();
    const result = await this.pool.query(
      "SELECT p.*, u.name AS owner_name, u.email AS owner_email FROM projects p JOIN users u ON u.id = p.user_id WHERE u.company_id = $1 AND p.is_autosave = FALSE ORDER BY p.saved_at DESC",
      [companyId]
    );
    return result.rows.map(function (row) {
      return Object.assign({}, projectSummary(row), {
        ownerName: row.owner_name,
        ownerEmail: row.owner_email
      });
    });
  }

  async listClimateStations(filters) {
    await this.init();
    const options = filters || {};
    const region = cleanText(options.region);
    const search = cleanText(options.q).toLowerCase();
    const limit = Math.min(Math.max(parseInt(options.limit || "250", 10) || 250, 1), 20000);
    const values = [];
    const where = [];

    if (region) {
      values.push(region);
      where.push("region = $" + values.length);
    }
    if (search) {
      values.push("%" + search + "%");
      where.push("(LOWER(city) LIKE $" + values.length + " OR LOWER(region) LIKE $" + values.length + " OR LOWER(country) LIKE $" + values.length + " OR LOWER(climate_zone) LIKE $" + values.length + " OR LOWER(koppen) LIKE $" + values.length + ")");
    }

    const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
    const totalQuery = "SELECT COUNT(*)::INT AS count FROM climate_stations" + whereSql;
    const orderSql = search
      ? " ORDER BY CASE WHEN LOWER(city) = $" + (values.length + 1) + " THEN 0 ELSE 1 END, region ASC, city ASC"
      : " ORDER BY region ASC, city ASC";
    const rowValues = values.slice();
    if (search) {
      rowValues.push(search);
    }
    rowValues.push(limit);
    const rowsQuery = "SELECT * FROM climate_stations" + whereSql + orderSql + " LIMIT $" + rowValues.length;

    const totalResult = await this.pool.query(totalQuery, values);
    const rowsResult = await this.pool.query(rowsQuery, rowValues);

    return {
      total: totalResult.rows[0] ? totalResult.rows[0].count : 0,
      stations: rowsResult.rows.map(climateStationRow)
    };
  }

  async climateStationStats() {
    await this.init();
    const totalResult = await this.pool.query("SELECT COUNT(*)::INT AS count FROM climate_stations");
    const sourceResult = await this.pool.query(
      "SELECT source, source_version, COUNT(*)::INT AS count FROM climate_stations GROUP BY source, source_version ORDER BY source, source_version"
    );
    const regionResult = await this.pool.query(
      "SELECT region, COUNT(*)::INT AS count FROM climate_stations GROUP BY region ORDER BY region"
    );
    return {
      total: totalResult.rows[0] ? totalResult.rows[0].count : 0,
      sources: sourceResult.rows.map(function (row) {
        return {
          source: row.source,
          sourceVersion: row.source_version || "",
          count: row.count
        };
      }),
      regions: regionResult.rows.map(function (row) {
        return {
          region: row.region || "",
          count: row.count
        };
      })
    };
  }

  async importClimateStations(stations, options) {
    await this.init();
    const defaults = options || {};
    const records = (stations || [])
      .map(function (station) {
        return climateStationRecord(station, defaults);
      })
      .filter(function (record) {
        return record.city && record.stationKey;
      });

    if (!records.length) {
      return { imported: 0 };
    }

    await this.withTransaction(async (client) => {
      if (defaults.replaceSource && defaults.source) {
        await client.query("DELETE FROM climate_stations WHERE source = $1 AND source_version = $2", [
          cleanText(defaults.source),
          cleanText(defaults.sourceVersion)
        ]);
      }

      for (const record of records) {
        await client.query(
          "INSERT INTO climate_stations (station_key, source, source_version, region, city, country, wmo_code, latitude, longitude, elevation_m, climate_zone, koppen, dbt_04_c, wbt_coincident_c, wbt_04_c, mean_daily_range_c, heating_99_6_c, rh_percent, metadata, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW()) ON CONFLICT (station_key) DO UPDATE SET source = EXCLUDED.source, source_version = EXCLUDED.source_version, region = EXCLUDED.region, city = EXCLUDED.city, country = EXCLUDED.country, wmo_code = EXCLUDED.wmo_code, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, elevation_m = EXCLUDED.elevation_m, climate_zone = EXCLUDED.climate_zone, koppen = EXCLUDED.koppen, dbt_04_c = EXCLUDED.dbt_04_c, wbt_coincident_c = EXCLUDED.wbt_coincident_c, wbt_04_c = EXCLUDED.wbt_04_c, mean_daily_range_c = EXCLUDED.mean_daily_range_c, heating_99_6_c = EXCLUDED.heating_99_6_c, rh_percent = EXCLUDED.rh_percent, metadata = EXCLUDED.metadata, updated_at = NOW()",
          [
            record.stationKey,
            record.source,
            record.sourceVersion,
            record.region,
            record.city,
            record.country,
            record.wmoCode,
            record.latitude,
            record.longitude,
            record.elevationM,
            record.climateZone,
            record.koppen,
            record.dbt04,
            record.wbtCoincident,
            record.wbt04,
            record.meanDailyRange,
            record.heating996,
            record.rhPercent,
            record.metadata
          ]
        );
      }
    });

    return { imported: records.length };
  }
}

function createPostgresStore() {
  return new PostgresStore();
}

module.exports = {
  AUTOSAVE_SLUG,
  createPostgresStore
};
