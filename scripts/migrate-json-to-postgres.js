const fs = require("fs");
const path = require("path");
const { createPostgresStore } = require("../postgresStore");

const ROOT = path.join(__dirname, "..");
const SOURCE_PATH = process.env.JSON_DB_PATH || path.join(ROOT, "server-data", "database.json");

function slugify(text) {
  return String(text || "value")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "value";
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

async function migrateUsers(store, db) {
  const users = Object.values(db.users || {});
  let migrated = 0;

  for (const user of users) {
    await store.upsertUser({
      id: user.id || "user-" + slugify(user.email),
      name: user.name || user.email || "User",
      email: String(user.email || "").trim().toLowerCase(),
      phone: user.phone || "",
      company: user.company || "",
      role: user.role || "user",
      passwordSalt: user.passwordSalt || user.password_salt,
      passwordHash: user.passwordHash || user.password_hash,
      recoverySalt: user.recoverySalt || user.recovery_salt,
      recoveryHash: user.recoveryHash || user.recovery_hash,
      createdAt: user.createdAt || user.created_at || nowIso(),
      updatedAt: user.updatedAt || user.updated_at || user.createdAt || user.created_at || nowIso(),
      lastLoginAt: user.lastLoginAt || user.last_login_at || null
    });
    migrated += 1;
  }

  return migrated;
}

async function migrateSessions(store, db, userMap) {
  const sessions = Object.entries(db.sessions || {});
  let migrated = 0;

  for (const entry of sessions) {
    const token = entry[0];
    const session = entry[1] || {};
    if (!token || !session.userId || !userMap[session.userId]) {
      continue;
    }

    await store.upsertSessionRecord({
      token: token,
      userId: session.userId,
      email: session.email || userMap[session.userId].email,
      createdAt: session.createdAt || nowIso(),
      expiresAt: session.expiresAt || nowIso()
    });
    migrated += 1;
  }

  return migrated;
}

async function migrateProjects(store, db) {
  const projects = db.projects || {};
  let migratedNamed = 0;
  let migratedAutosaves = 0;

  for (const userId of Object.keys(projects)) {
    const bucket = projects[userId] || {};

    if (bucket.autosave) {
      const autosave = clone(bucket.autosave);
      const savedAt = autosave.savedAt || nowIso();
      await store.upsertProjectRecord({
        userId: userId,
        slug: "__autosave__",
        projectName: autosave.name || "HVAC Project",
        isAutosave: true,
        projectData: autosave,
        savedAt: savedAt,
        createdAt: savedAt,
        updatedAt: savedAt
      });
      migratedAutosaves += 1;
    }

    const namedProjects = bucket.named || {};
    for (const slug of Object.keys(namedProjects)) {
      const project = clone(namedProjects[slug]);
      const savedAt = project.savedAt || nowIso();
      await store.upsertProjectRecord({
        userId: userId,
        slug: slug || slugify(project.name),
        projectName: project.name || slug || "HVAC Project",
        isAutosave: false,
        projectData: project,
        savedAt: savedAt,
        createdAt: savedAt,
        updatedAt: savedAt
      });
      migratedNamed += 1;
    }
  }

  return {
    named: migratedNamed,
    autosaves: migratedAutosaves
  };
}

async function main() {
  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error("JSON database not found at " + SOURCE_PATH);
  }

  const db = readJsonFile(SOURCE_PATH);
  const store = createPostgresStore();

  try {
    await store.init();
    const userCount = await migrateUsers(store, db);
    const userMap = Object.values(db.users || {}).reduce(function (map, user) {
      if (user && user.id) {
        map[user.id] = user;
      }
      return map;
    }, {});
    const sessionCount = await migrateSessions(store, db, userMap);
    const projectCounts = await migrateProjects(store, db);

    console.log("PostgreSQL migration complete.");
    console.log("Users migrated:", userCount);
    console.log("Sessions migrated:", sessionCount);
    console.log("Named projects migrated:", projectCounts.named);
    console.log("Autosaves migrated:", projectCounts.autosaves);
    console.log("Source file:", SOURCE_PATH);
  } finally {
    await store.close();
  }
}

main().catch(function (error) {
  console.error("Migration failed:", error.message || error);
  process.exit(1);
});
