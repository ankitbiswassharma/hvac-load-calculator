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
const ashrae = require("./engine/ashrae");
const designer = require("./engine/ashrae/designer");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;
const SESSION_COOKIE = "muskit_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const OWNER_OTP_TTL_MS = 1000 * 60 * 10;
const OWNER_OTP_MAX_ATTEMPTS = 5;
const PBKDF2_ITERATIONS = 210000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";
const SOURCE_LICENSE_USER_LIMIT = 999;
const PUBLIC_FILES = new Set([
  "contact copy 2.html",
  "favicon.svg",
  "engineeringCore.js",
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
  "optimizationEngine.js",
  "hvacPlatform.js",
  "aiDesignerUI.js"
]);

const store = createPostgresStore();
const ownerOtpChallenges = new Map();

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

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundNumber(value, digits) {
  const factor = Math.pow(10, digits || 0);
  return Math.round((numberOrDefault(value, 0) * factor)) / factor;
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

function randomOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
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
  return cleanText(process.env.APP_URL || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL) || requestBaseUrl(req);
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

function parseRawBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let length = 0;
    req.on("data", function (chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      length += buffer.length;
      if (length > 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks, length));
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

function openAiModel() {
  return cleanText(process.env.OPENAI_MODEL || process.env.OPENAI_RESPONSES_MODEL || "gpt-5.4-mini");
}

function normalizeAdvisorSeverity(value) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === "critical") {
    return "critical";
  }
  if (normalized === "warning" || normalized === "review") {
    return "warning";
  }
  return "advisory";
}

function extractOpenAiResponseText(payload) {
  if (payload && typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload && payload.output) ? payload.output : [];
  const textParts = [];
  output.forEach(function (entry) {
    const content = Array.isArray(entry && entry.content) ? entry.content : [];
    content.forEach(function (part) {
      if (part && typeof part.text === "string" && part.text.trim()) {
        textParts.push(part.text.trim());
      }
    });
  });
  return textParts.join("\n").trim();
}

function parseLooseJson(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (innerError) {
      return null;
    }
  }
}

function sanitizeAdvisorItem(item) {
  const suggestion = item || {};
  const title = cleanText(suggestion.title || suggestion.heading || suggestion.name);
  const recommendation = cleanText(suggestion.recommendation || suggestion.action || suggestion.fix);
  if (!title || !recommendation) {
    return null;
  }
  return {
    severity: normalizeAdvisorSeverity(suggestion.severity),
    category: cleanText(suggestion.category || "design") || "design",
    title: title,
    issue: cleanText(suggestion.issue || suggestion.problem || ""),
    recommendation: recommendation,
    basis: cleanText(suggestion.basis || suggestion.reasoning || suggestion.rationale || ""),
    why: cleanText(suggestion.why || suggestion.justification || ""),
    tradeoff: cleanText(suggestion.tradeoff || suggestion.trade_off || ""),
    whenToUse: cleanText(suggestion.whenToUse || suggestion.when_to_use || ""),
    confidenceScore: roundNumber(numberOrDefault(suggestion.confidenceScore || suggestion.confidence_score, 0), 2),
    complianceStatus: cleanText(suggestion.complianceStatus || suggestion.compliance_status || "")
  };
}

function sanitizeAdvisorPayload(payload, fallbackAdvisor) {
  const parsed = payload || {};
  const fallback = fallbackAdvisor || { provider: "local_rules", summary: "", items: [] };
  const items = (Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map(sanitizeAdvisorItem)
    .filter(Boolean)
    .slice(0, 6);
  const summary = cleanText(parsed.summary || parsed.overview || (items[0] && items[0].recommendation) || fallback.summary);
  return {
    provider: "openai",
    summary: summary || fallback.summary || "Design review assistant is ready.",
    items: items.length ? items : (fallback.items || [])
  };
}

function sanitizeStringList(value) {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(/\s*\|\s*|\s*;\s*/)
      : [];
  return rawList
    .map(function (entry) { return cleanText(entry); })
    .filter(Boolean)
    .slice(0, 4);
}

function sanitizeAlternativeOption(option) {
  const candidate = option || {};
  const title = cleanText(candidate.title || candidate.name || candidate.heading);
  const systemType = cleanText(candidate.systemType || candidate.system || candidate.architecture);
  if (!title || !systemType) {
    return null;
  }

  return {
    key: cleanText(candidate.key || slugify(title).replace(/-/g, "_")) || "alternative",
    title: title,
    intent: cleanText(candidate.intent || candidate.category || "balanced") || "balanced",
    systemType: systemType,
    scope: cleanText(candidate.scope || candidate.complianceScope || candidate.scopeNote),
    airflowCfm: roundNumber(numberOrDefault(candidate.airflowCfm || candidate.airflow_cfm, 0), 0),
    ach: roundNumber(numberOrDefault(candidate.ach, 0), 1),
    capexDeltaPercent: roundNumber(numberOrDefault(candidate.capexDeltaPercent || candidate.capex_delta_percent, 0), 0),
    energyDeltaPercent: roundNumber(numberOrDefault(candidate.energyDeltaPercent || candidate.energy_delta_percent, 0), 0),
    costScore: roundNumber(numberOrDefault(candidate.costScore || candidate.cost_score, 0), 0),
    efficiencyScore: roundNumber(numberOrDefault(candidate.efficiencyScore || candidate.efficiency_score, 0), 0),
    complianceScore: roundNumber(numberOrDefault(candidate.complianceScore || candidate.compliance_score, 0), 0),
    complianceStatus: cleanText(candidate.complianceStatus || candidate.compliance_status || ""),
    confidenceScore: roundNumber(numberOrDefault(candidate.confidenceScore || candidate.confidence_score, 0), 2),
    strengths: sanitizeStringList(candidate.strengths),
    tradeoffs: sanitizeStringList(candidate.tradeoffs),
    actions: sanitizeStringList(candidate.actions || candidate.recommendations),
    why: cleanText(candidate.why || candidate.justification || ""),
    whenToUse: cleanText(candidate.whenToUse || candidate.when_to_use || "")
  };
}

function sanitizeAlternativesPayload(payload, fallbackAlternatives) {
  const parsed = payload || {};
  const fallback = fallbackAlternatives || { provider: "local_rules", summary: "", options: [] };
  const options = (Array.isArray(parsed.options) ? parsed.options : Array.isArray(parsed.alternatives) ? parsed.alternatives : [])
    .map(sanitizeAlternativeOption)
    .filter(Boolean)
    .slice(0, 4);
  const preferredOptionKey = cleanText(parsed.preferredOptionKey || parsed.preferred_key || (options[0] && options[0].key));
  return {
    provider: "openai",
    summary: cleanText(parsed.summary || parsed.overview || fallback.summary) || "Alternative concepts are ready.",
    preferredOptionKey: preferredOptionKey || (fallback.preferredOptionKey || (options[0] && options[0].key) || "balanced"),
    standardsNote: cleanText(parsed.standardsNote || parsed.basis || fallback.standardsNote),
    options: options.length ? options : (fallback.options || [])
  };
}

let engineeringCoreModule = null;

function engineeringCore() {
  if (!engineeringCoreModule) {
    try {
      engineeringCoreModule = require("./engineeringCore.js");
    } catch (error) {
      engineeringCoreModule = {};
    }
  }
  return engineeringCoreModule;
}

function truthyArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function confidenceOf(value, fallback) {
  return roundNumber(numberOrDefault(value, fallback == null ? 0.75 : fallback), 2);
}

function designValidationFromPayload(payload) {
  const context = payload || {};
  const validation = context.validation && typeof context.validation === "object" ? context.validation : null;
  if (validation && validation.status) {
    return validation;
  }
  const core = engineeringCore();
  if (core && typeof core.buildDesignValidation === "function") {
    return core.buildDesignValidation(context);
  }
  return {
    status: "REVIEW",
    summary: "Validation context was incomplete.",
    findings: [],
    confidenceScore: 0.5
  };
}

function buildTrustedLocalAdvisor(payload) {
  const context = payload || {};
  const validation = designValidationFromPayload(context);
  const localAdvisor = context.localAdvisor && typeof context.localAdvisor === "object"
    ? sanitizeAdvisorPayload(context.localAdvisor, {
        provider: "local_rules",
        summary: validation.summary || "",
        items: []
      })
    : null;
  const core = engineeringCore();

  if (localAdvisor && truthyArray(localAdvisor.items).length) {
    return Object.assign({}, localAdvisor, {
      provider: cleanText(localAdvisor.provider || "local_rules") || "local_rules",
      summary: cleanText(localAdvisor.summary || validation.summary) || validation.summary || "Design review assistant is ready."
    });
  }

  if (core && typeof core.buildDesignIntelligenceReport === "function") {
    const report = core.buildDesignIntelligenceReport(context);
    const items = truthyArray(report && report.rootCauseAnalysis).slice(0, 5).map(function (entry) {
      const firstCause = truthyArray(entry.rootCauses)[0];
      return sanitizeAdvisorItem({
        severity: normalizeAdvisorSeverity(entry.severity || "warning"),
        category: entry.category || "design",
        title: entry.problem || entry.key || "Design issue identified",
        issue: firstCause && firstCause.explanation ? firstCause.explanation : (entry.impact || ""),
        recommendation: entry.recommendation || entry.problem || validation.summary || "Review the current design state.",
        basis: entry.impact || ((firstCause && firstCause.evidence && firstCause.evidence.join(" | ")) || ""),
        why: entry.impact || "",
        tradeoff: "",
        whenToUse: "",
        confidenceScore: confidenceOf(entry.confidenceScore, validation.confidenceScore),
        complianceStatus: validation.status || "REVIEW"
      });
    }).filter(Boolean);
    if (items.length) {
      return {
        provider: "local_reasoning",
        summary: cleanText(report && report.executiveSummary) || validation.summary || "Design review assistant is ready.",
        items: items
      };
    }
  }

  return {
    provider: "local_rules",
    summary: cleanText(validation.summary) || "Design review assistant is ready.",
    items: truthyArray(validation.findings).slice(0, 5).map(function (finding) {
      return sanitizeAdvisorItem({
        severity: finding.severity || "warning",
        category: finding.category || "design",
        title: finding.title || finding.code || "Design issue identified",
        issue: finding.detail || "",
        recommendation: finding.recommendation || validation.summary || "Review the current design state.",
        basis: finding.basis || "",
        confidenceScore: confidenceOf(validation.confidenceScore, 0.7),
        complianceStatus: finding.complianceStatus || validation.status || "REVIEW"
      });
    }).filter(Boolean)
  };
}

function rankAlternativeOption(option) {
  const candidate = option || {};
  const complianceStatus = cleanText(candidate.complianceStatus || "").toUpperCase();
  const complianceRank = complianceStatus === "COMPLIANT" ? 3 : complianceStatus === "REVIEW" ? 2 : complianceStatus === "NON_COMPLIANT" ? 1 : 0;
  const simulationRank = candidate.simulationBacked === true ? 1 : 0;
  const decisionScore = numberOrDefault(candidate.decisionScore, numberOrDefault(candidate.complianceScore, 0));
  return (complianceRank * 1000) + (simulationRank * 100) + decisionScore;
}

function normalizeAlternativesOption(option, validationStatus) {
  const normalized = sanitizeAlternativeOption(option);
  if (!normalized) {
    return null;
  }
  if (!normalized.complianceStatus) {
    normalized.complianceStatus = validationStatus || "REVIEW";
  }
  if (option && option.simulationBacked === true) {
    normalized.simulationBacked = true;
  }
  if (option && option.decisionScore != null) {
    normalized.decisionScore = roundNumber(numberOrDefault(option.decisionScore, 0), 1);
  }
  return normalized;
}

function buildTrustedLocalAlternatives(payload) {
  const context = payload || {};
  const validation = designValidationFromPayload(context);
  const localAlternatives = context.localAlternatives && typeof context.localAlternatives === "object"
    ? context.localAlternatives
    : null;
  const options = truthyArray(localAlternatives && localAlternatives.options)
    .map(function (option) {
      return normalizeAlternativesOption(option, validation.status);
    })
    .filter(Boolean)
    .sort(function (left, right) {
      return rankAlternativeOption(right) - rankAlternativeOption(left);
    });
  const preferredOptionKey = cleanText(localAlternatives && localAlternatives.preferredOptionKey);
  const preferredOption = options.find(function (option) {
    return option.key === preferredOptionKey;
  });
  const bestOption = preferredOption && preferredOption.complianceStatus !== "NON_COMPLIANT"
    ? preferredOption
    : options.find(function (option) {
        return option.complianceStatus !== "NON_COMPLIANT";
      }) || options[0] || null;

  return {
    provider: cleanText(localAlternatives && localAlternatives.provider) || "local_rules",
    summary: cleanText(localAlternatives && localAlternatives.summary) || validation.summary || "Alternative concepts are ready.",
    preferredOptionKey: bestOption ? bestOption.key : "",
    standardsNote: cleanText(localAlternatives && localAlternatives.standardsNote)
      || "Only engineering-consistent alternative concepts should be treated as viable recommendations.",
    options: options
  };
}

function reconcileAdvisorWithEngineering(candidateAdvisor, trustedAdvisor, validation) {
  const trusted = trustedAdvisor || { provider: "local_rules", summary: "", items: [] };
  const normalized = sanitizeAdvisorPayload(candidateAdvisor, trusted);
  const validationStatus = validation && validation.status ? validation.status : "REVIEW";
  const items = truthyArray(normalized.items).map(function (item) {
    return Object.assign({}, item, {
      complianceStatus: cleanText(item.complianceStatus || validationStatus) || validationStatus,
      confidenceScore: confidenceOf(item.confidenceScore, validation && validation.confidenceScore)
    });
  });
  const summaryPrefix = validationStatus === "NON_COMPLIANT"
    ? "Engineering status: NON_COMPLIANT. "
    : validationStatus === "REVIEW"
      ? "Engineering status: REVIEW. "
      : "";
  return {
    provider: normalized.provider || trusted.provider || "openai",
    summary: summaryPrefix + (cleanText(normalized.summary) || cleanText(trusted.summary) || "Design review assistant is ready."),
    items: items.length ? items : truthyArray(trusted.items)
  };
}

function reconcileAlternativesWithEngineering(candidateAlternatives, trustedAlternatives, validation) {
  const trusted = trustedAlternatives || { provider: "local_rules", summary: "", preferredOptionKey: "", options: [] };
  const normalized = sanitizeAlternativesPayload(candidateAlternatives, trusted);
  const validationStatus = validation && validation.status ? validation.status : "REVIEW";
  const options = truthyArray(normalized.options)
    .map(function (option) {
      return normalizeAlternativesOption(option, validationStatus);
    })
    .filter(Boolean)
    .sort(function (left, right) {
      return rankAlternativeOption(right) - rankAlternativeOption(left);
    });
  const preferred = options.find(function (option) {
    return option.key === normalized.preferredOptionKey;
  });
  const best = preferred && preferred.complianceStatus !== "NON_COMPLIANT"
    ? preferred
    : options.find(function (option) {
        return option.complianceStatus !== "NON_COMPLIANT";
      }) || options[0] || null;
  return {
    provider: normalized.provider || trusted.provider || "openai",
    summary: cleanText(normalized.summary) || cleanText(trusted.summary) || "Alternative concepts are ready.",
    preferredOptionKey: best ? best.key : "",
    standardsNote: cleanText(normalized.standardsNote) || cleanText(trusted.standardsNote),
    options: options.length ? options : truthyArray(trusted.options)
  };
}

// Produce a short engineering narrative for an already-computed design.
// AI here is *narrating* engine output, NOT generating numbers. Any numeric
// claim must come from the design object; the prompt forbids inventing values.
async function narrateDesign(design) {
  const apiKey = cleanText(process.env.OPENAI_API_KEY);
  if (!apiKey) return null;
  const prompt = [
    "You are a senior HVAC consulting engineer.",
    "Given a fully computed ASHRAE-correct design (JSON below), produce a short",
    "engineering narrative explaining the design intent in plain language.",
    "ABSOLUTE RULES:",
    "- Quote ONLY numbers that appear in the JSON. Do not invent or round-trip.",
    "- Always cite the ASHRAE chapter or standard supporting any non-trivial choice.",
    "- If a parameter is missing, say so; do not fabricate.",
    "Return JSON: {\"summary\":\"...\",\"design_decisions\":[\"...\"],\"risks\":[\"...\"],\"next_steps\":[\"...\"]}"
  ].join("\n");
  const response = await globalThis.fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({
      model: openAiModel(),
      reasoning: { effort: "low" },
      input: prompt + "\n\nDESIGN JSON:\n" + JSON.stringify(design),
      max_output_tokens: 900
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return null;
  const text = extractOpenAiResponseText(data);
  return parseLooseJson(text);
}

async function generateOpenAiDesignAdvisor(payload) {
  const apiKey = cleanText(process.env.OPENAI_API_KEY);
  const trustedAdvisor = buildTrustedLocalAdvisor(payload || {});
  const trustedValidation = designValidationFromPayload(payload || {});
  if (!apiKey) {
    return trustedAdvisor;
  }

  const fallbackAdvisor = trustedAdvisor;
  const prompt = [
    "You are a senior HVAC design review engineer.",
    "Use only the values present in the supplied JSON context.",
    "Treat the validation object as the governing engineering truth unless it contradicts the numeric context.",
    "Turn diagnostics into practical, specific corrective actions for HVAC engineers.",
    "Reject generic advice. Every recommendation must say why it matters, the main tradeoff, and when the recommendation should be used.",
    "Call out non-compliance explicitly when the design violates airflow, ventilation, or psychrometric consistency constraints.",
    "Do not invent missing measurements, standards clauses, or equipment data.",
    "Return strict JSON with this shape only:",
    "{\"summary\":\"...\",\"items\":[{\"severity\":\"critical|warning|advisory\",\"category\":\"...\",\"title\":\"...\",\"issue\":\"...\",\"recommendation\":\"...\",\"basis\":\"...\",\"why\":\"...\",\"tradeoff\":\"...\",\"whenToUse\":\"...\",\"confidenceScore\":0.0,\"complianceStatus\":\"COMPLIANT|REVIEW|NON_COMPLIANT\"}]}",
    "Limit the list to at most 5 items and sort from highest priority to lowest priority."
  ].join("\n");

  const response = await globalThis.fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: openAiModel(),
      reasoning: {
        effort: "medium"
      },
      input: prompt + "\n\nHVAC DESIGN CONTEXT JSON:\n" + JSON.stringify(payload || {}),
      max_output_tokens: 1400
    })
  });

  const data = await response.json().catch(function () {
    return null;
  });

  if (!response.ok) {
    throw new Error(data && data.error && data.error.message ? data.error.message : "OpenAI design advisor request failed.");
  }

  const text = extractOpenAiResponseText(data);
  const parsed = parseLooseJson(text);
  if (!parsed) {
    throw new Error("OpenAI design advisor returned an unreadable response.");
  }

  return reconcileAdvisorWithEngineering(parsed, fallbackAdvisor, trustedValidation);
}

async function generateOpenAiDesignAlternatives(payload) {
  const apiKey = cleanText(process.env.OPENAI_API_KEY);
  const trustedAlternatives = buildTrustedLocalAlternatives(payload || {});
  const trustedValidation = designValidationFromPayload(payload || {});
  if (!apiKey) {
    return trustedAlternatives;
  }

  const fallbackAlternatives = trustedAlternatives;
  const prompt = [
    "You are a senior HVAC concept design engineer.",
    "Use only the values present in the supplied JSON context.",
    "Treat the validation object as a hard constraint set. Do not present invalid concepts as preferred options.",
    "Prepare alternative HVAC design concepts that compare cost, efficiency, and compliance fit.",
    "Every option must explain why it is suitable and when it should be used.",
    "Do not invent standards clauses, equipment models, or project facts that are not in the JSON.",
    "If cleanroom mode is present, respect the ISO class target and explain scope changes clearly.",
    "Return strict JSON with this shape only:",
    "{\"summary\":\"...\",\"preferredOptionKey\":\"...\",\"standardsNote\":\"...\",\"options\":[{\"key\":\"...\",\"title\":\"...\",\"intent\":\"cost_effective|balanced|efficient\",\"systemType\":\"...\",\"scope\":\"...\",\"airflowCfm\":0,\"ach\":0,\"capexDeltaPercent\":0,\"energyDeltaPercent\":0,\"costScore\":0,\"efficiencyScore\":0,\"complianceScore\":0,\"complianceStatus\":\"COMPLIANT|REVIEW|NON_COMPLIANT\",\"confidenceScore\":0.0,\"strengths\":[\"...\"],\"tradeoffs\":[\"...\"],\"actions\":[\"...\"],\"why\":\"...\",\"whenToUse\":\"...\"}]}",
    "Limit the list to at most 3 options."
  ].join("\n");

  const response = await globalThis.fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: openAiModel(),
      reasoning: {
        effort: "medium"
      },
      input: prompt + "\n\nHVAC ALTERNATIVES CONTEXT JSON:\n" + JSON.stringify(payload || {}),
      max_output_tokens: 1800
    })
  });

  const data = await response.json().catch(function () {
    return null;
  });

  if (!response.ok) {
    throw new Error(data && data.error && data.error.message ? data.error.message : "OpenAI design alternatives request failed.");
  }

  const text = extractOpenAiResponseText(data);
  const parsed = parseLooseJson(text);
  if (!parsed) {
    throw new Error("OpenAI design alternatives returned an unreadable response.");
  }

  return reconcileAlternativesWithEngineering(parsed, fallbackAlternatives, trustedValidation);
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

function headerSessionToken(req) {
  const directHeader = cleanText(req && req.headers && req.headers["x-session-token"]);
  if (directHeader) {
    return directHeader;
  }

  const authorization = cleanText(req && req.headers && req.headers.authorization);
  if (/^bearer\s+/i.test(authorization)) {
    return authorization.replace(/^bearer\s+/i, "").trim();
  }

  return "";
}

function shouldSetSecureCookie(req) {
  const explicit = cleanText(process.env.SESSION_COOKIE_SECURE || process.env.COOKIE_SECURE).toLowerCase();
  if (["1", "true", "yes", "on"].includes(explicit)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(explicit)) {
    return false;
  }

  const forwardedProto = cleanText(req && req.headers && req.headers["x-forwarded-proto"]).split(",")[0].toLowerCase();
  return !!((req && req.socket && req.socket.encrypted) || forwardedProto === "https");
}

function sessionCookie(token, req) {
  const attributes = [
    SESSION_COOKIE + "=" + encodeURIComponent(token),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + Math.floor(SESSION_TTL_MS / 1000)
  ];
  if (shouldSetSecureCookie(req)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function clearSessionCookie(req) {
  const attributes = [
    SESSION_COOKIE + "=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (shouldSetSecureCookie(req)) {
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
    keySecret: String(process.env.RAZORPAY_KEY_SECRET || "").trim(),
    webhookSecret: String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim()
  };
}

function razorpayEnabled() {
  const config = razorpayConfig();
  return !!(config.keyId && config.keySecret && globalThis.fetch);
}

function razorpayDiagnostics() {
  const config = razorpayConfig();
  return {
    configured: razorpayEnabled(),
    keyId: config.keyId ? config.keyId.slice(0, 8) + "..." + config.keyId.slice(-4) : "",
    webhookConfigured: !!config.webhookSecret,
    checkoutScript: "https://checkout.razorpay.com/v1/checkout.js",
    currency: "INR"
  };
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

function verifyRazorpayWebhook(rawBody, signature) {
  const config = razorpayConfig();
  if (!(config.webhookSecret && rawBody && signature)) {
    return false;
  }
  const digest = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(rawBody)
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

function isOwnerAccount(user) {
  return String((user && user.role) || "user").toLowerCase() === "owner";
}

function cleanupOwnerOtpChallenges() {
  const now = Date.now();
  ownerOtpChallenges.forEach(function (challenge, challengeId) {
    if (!challenge || challenge.expiresAtMs <= now) {
      ownerOtpChallenges.delete(challengeId);
    }
  });
}

function ownerRequestIp(req) {
  return cleanText((req.headers["x-forwarded-for"] || "").split(",")[0])
    || (req.socket && req.socket.remoteAddress)
    || "";
}

async function createOwnerOtpChallenge(user, req) {
  cleanupOwnerOtpChallenges();
  const otp = randomOtp();
  const credential = createCredential(otp);
  const challengeId = randomToken(16);
  const expiresAtMs = Date.now() + OWNER_OTP_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const normalizedEmail = normalizeEmail(user.email);

  ownerOtpChallenges.set(challengeId, {
    id: challengeId,
    userId: user.id,
    email: normalizedEmail,
    otpSalt: credential.salt,
    otpHash: credential.hash,
    attempts: 0,
    expiresAtMs: expiresAtMs,
    createdAt: nowIso()
  });

  const sendResult = await sendOwnerLoginOtpEmail({
    to: normalizedEmail,
    name: user.name,
    otp: otp,
    expiresAt: expiresAt,
    ip: ownerRequestIp(req)
  });

  if (!sendResult || sendResult.ok === false) {
    ownerOtpChallenges.delete(challengeId);
    return {
      ok: false,
      error: sendResult && sendResult.error ? sendResult.error : "Owner OTP email could not be sent."
    };
  }

  return {
    ok: true,
    challengeId: challengeId,
    expiresAt: expiresAt,
    email: normalizedEmail
  };
}

async function verifyOwnerOtpChallenge(payload) {
  cleanupOwnerOtpChallenges();
  const challengeId = cleanText(payload.challengeId);
  const email = normalizeEmail(payload.email);
  const otp = cleanText(payload.otp);
  const challenge = ownerOtpChallenges.get(challengeId);

  if (!challenge) {
    return { ok: false, status: 404, error: "Owner OTP challenge expired or was not found. Request a new OTP." };
  }
  if (!otp || !/^\d{6}$/.test(otp)) {
    return { ok: false, status: 400, error: "Enter the 6-digit owner OTP." };
  }
  if (email && email !== challenge.email) {
    return { ok: false, status: 400, error: "Owner OTP email does not match this challenge." };
  }
  if (challenge.expiresAtMs <= Date.now()) {
    ownerOtpChallenges.delete(challengeId);
    return { ok: false, status: 410, error: "Owner OTP expired. Request a new OTP." };
  }
  if (challenge.attempts >= OWNER_OTP_MAX_ATTEMPTS) {
    ownerOtpChallenges.delete(challengeId);
    return { ok: false, status: 429, error: "Too many invalid owner OTP attempts. Request a new OTP." };
  }

  const matches = verifyCredential(otp, challenge.otpSalt, challenge.otpHash);
  if (!matches) {
    challenge.attempts += 1;
    ownerOtpChallenges.set(challengeId, challenge);
    const remaining = Math.max(0, OWNER_OTP_MAX_ATTEMPTS - challenge.attempts);
    return {
      ok: false,
      status: remaining ? 401 : 429,
      error: remaining
        ? "Incorrect owner OTP. " + remaining + " attempt" + (remaining === 1 ? "" : "s") + " remaining."
        : "Too many invalid owner OTP attempts. Request a new OTP."
    };
  }

  ownerOtpChallenges.delete(challengeId);
  const user = await store.findUserByEmail(challenge.email);
  if (!user || user.id !== challenge.userId || !isOwnerAccount(user)) {
    return { ok: false, status: 403, error: "Owner account is no longer available for this OTP challenge." };
  }

  return { ok: true, user: user };
}

async function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE] || headerSessionToken(req);
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
  if (!isCompanyAdmin(session.user)) {
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
  if (!isCompanyAdmin(session.user)) {
    sendJson(res, 403, { ok: false, error: "Company admin access required." });
    return null;
  }
  return session;
}

async function requireDesignWorkspaceUser(req, res) {
  const session = await requireAuth(req, res);
  if (!session) {
    return null;
  }
  if (isOwner(session.user)) {
    sendJson(res, 403, { ok: false, error: "Owner sessions are limited to owner dashboard, user management, DAU, integrations, and pricing override functions." });
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

async function sendOwnerLoginOtpEmail(payload) {
  const html = renderEmailLayout({
    preheader: "Use this one-time password to complete owner login.",
    kicker: "Owner Login",
    title: "Owner Login OTP",
    summary: "A separate owner access flow was requested for the Musk-IT HVAC platform. Use the code below to complete sign-in.",
    bodyHtml:
      "<p style=\"margin:0 0 18px;font-family:Arial,sans-serif;font-size:15px;line-height:1.75;color:#334155;\">Hello "
      + escapeEmailHtml(payload.name || "Owner")
      + ", enter this OTP in the owner login screen after confirming your email and password.</p>"
      + emailCard("Owner Access Code", emailCredentialRows([
        { label: "One-Time Password", value: payload.otp },
        { label: "Expires At", value: new Date(payload.expiresAt).toLocaleString("en-IN") }
      ]))
      + emailCard("Security Context", emailDetailsTable([
        { label: "Account", value: payload.to },
        { label: "Request IP", value: payload.ip || "Unknown" }
      ]))
      + "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.75;color:#475569;\">If you did not request owner access, change the owner password and review active sessions immediately.</div>",
    footer: "For security, this owner OTP expires in 10 minutes and can only be used once."
  });

  return EmailService.sendEmail({
    to: payload.to,
    subject: "Musk-IT HVAC owner login OTP",
    html: html,
    text:
      "Owner login OTP: " + payload.otp + "\n"
      + "Expires at: " + payload.expiresAt + "\n"
      + "Request IP: " + (payload.ip || "Unknown") + "\n"
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

async function activateLicenseForPaidPayment(payment, paymentInfo) {
  if (!payment) {
    throw new Error("Payment order was not found.");
  }
  if (payment.status === "paid" && payment.licenseId) {
    const licenses = payment.companyId ? await store.listLicensesForCompany(payment.companyId) : [];
    const existingLicense = licenses.find(function (entry) {
      return entry.id === payment.licenseId;
    });
    return {
      alreadyActivated: true,
      license: existingLicense || null,
      company: payment.companyId ? await store.findCompanyById(payment.companyId) : null,
      adminAccount: null
    };
  }

  const orderId = cleanText(paymentInfo && paymentInfo.orderId) || payment.gatewayOrderId;
  const paymentId = cleanText(paymentInfo && paymentInfo.paymentId);
  const signature = cleanText(paymentInfo && paymentInfo.signature);
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
      paymentId: paymentId,
      activationSource: cleanText(paymentInfo && paymentInfo.source) || "checkout"
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
      emailSent: !!(adminResult.generatedCredentials && adminResult.generatedCredentials.emailSent),
      activationSource: cleanText(paymentInfo && paymentInfo.source) || "checkout"
    }
  });
  if (paymentMetadata.inviteId) {
    await store.markLicenseCheckoutInvitePaid(paymentMetadata.inviteId, {
      licenseId: finalizedLicense.id,
      paymentId: paymentId
    });
  }
  await store.updateCompanyActiveLicense(company.id, finalizedLicense.id, "active");

  return {
    alreadyActivated: false,
    license: finalizedLicense,
    company: company,
    adminResult: adminResult,
    adminAccount: {
      email: adminResult.user.email,
      username: adminResult.user.username || "",
      emailSent: !!(adminResult.generatedCredentials && adminResult.generatedCredentials.emailSent),
      temporaryPassword: adminResult.generatedCredentials && !adminResult.generatedCredentials.emailSent ? adminResult.generatedCredentials.password : "",
      recoveryKey: adminResult.generatedCredentials && !adminResult.generatedCredentials.emailSent ? adminResult.generatedCredentials.recoveryKey : ""
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
      integrations: {
        email: EmailService.diagnostics(),
        razorpay: razorpayDiagnostics()
      },
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
        energyComparison: true,
        aiDesignAdvisor: !!cleanText(process.env.OPENAI_API_KEY),
        aiDesignAlternatives: !!cleanText(process.env.OPENAI_API_KEY)
      }
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/licensing/razorpay-webhook") {
    const rawBody = await parseRawBody(req);
    const signature = cleanText(req.headers["x-razorpay-signature"]);
    if (!verifyRazorpayWebhook(rawBody, signature)) {
      sendJson(res, 400, { ok: false, error: "Invalid Razorpay webhook signature." });
      return;
    }

    const event = JSON.parse(rawBody.toString("utf8") || "{}");
    const eventName = cleanText(event.event);
    const paymentEntity = event && event.payload && event.payload.payment && event.payload.payment.entity
      ? event.payload.payment.entity
      : null;
    const orderEntity = event && event.payload && event.payload.order && event.payload.order.entity
      ? event.payload.order.entity
      : null;
    const orderId = cleanText(
      paymentEntity && paymentEntity.order_id
      || orderEntity && orderEntity.id
      || ""
    );
    const paymentId = cleanText(paymentEntity && paymentEntity.id || "");

    if (eventName !== "payment.captured" && eventName !== "order.paid") {
      sendJson(res, 200, { ok: true, ignored: true, event: eventName });
      return;
    }
    if (!orderId) {
      sendJson(res, 200, { ok: true, ignored: true, event: eventName, reason: "No Razorpay order id on webhook event." });
      return;
    }

    const payment = await store.findPaymentByOrderId(orderId);
    if (!payment) {
      sendJson(res, 200, { ok: true, ignored: true, event: eventName, reason: "Payment order not found locally." });
      return;
    }

    const activation = await activateLicenseForPaidPayment(payment, {
      orderId: orderId,
      paymentId: paymentId,
      signature: signature,
      source: "razorpay_webhook"
    });
    sendJson(res, 200, {
      ok: true,
      event: eventName,
      alreadyActivated: !!activation.alreadyActivated,
      licenseId: activation.license && activation.license.id || ""
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
    const activation = await activateLicenseForPaidPayment(payment, {
      orderId: orderId,
      paymentId: paymentId,
      signature: signature,
      source: "checkout_confirm"
    });
    if (activation.alreadyActivated) {
      sendJson(res, 200, {
        ok: true,
        message: "License was already activated for this payment.",
        license: activation.license || null
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      message: "Payment verified and license activated successfully.",
      license: Object.assign({}, activation.license, {
        adminUserId: activation.adminResult && activation.adminResult.user ? activation.adminResult.user.id : ""
      }),
      company: activation.company,
      adminAccount: activation.adminAccount
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
    if (isOwnerAccount(user)) {
      sendJson(res, 403, { ok: false, error: "Owner accounts must use Owner Login with email OTP." });
      return;
    }

    const updatedUser = await store.updateUserLoginById(user.id, nowIso()) || user;
    const token = await createSession(updatedUser);
    res.setHeader("Set-Cookie", sessionCookie(token, req));
    sendJson(res, 200, {
      ok: true,
      user: sanitizeUser(updatedUser),
      sessionToken: token
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/owner/request-otp") {
    const payload = await parseBody(req);
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");

    if (!email || !password) {
      sendJson(res, 400, { ok: false, error: "Owner email and password are required before OTP." });
      return;
    }

    const user = await store.findUserByEmail(email);
    if (!user || !isOwnerAccount(user)) {
      sendJson(res, 404, { ok: false, error: "Owner account not found for this email." });
      return;
    }
    if (!verifyCredential(password, user.password_salt || user.passwordSalt, user.password_hash || user.passwordHash)) {
      sendJson(res, 401, { ok: false, error: "Incorrect owner password." });
      return;
    }

    const challenge = await createOwnerOtpChallenge(user, req);
    if (!challenge.ok) {
      sendJson(res, 502, {
        ok: false,
        error: "Owner password was verified, but the OTP email could not be sent: " + challenge.error
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      email: challenge.email,
      message: "Owner OTP sent to " + challenge.email + "."
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/owner/verify-otp") {
    const payload = await parseBody(req);
    const verification = await verifyOwnerOtpChallenge({
      challengeId: payload.challengeId,
      email: payload.email,
      otp: payload.otp
    });

    if (!verification.ok) {
      sendJson(res, verification.status || 401, { ok: false, error: verification.error });
      return;
    }

    const updatedUser = await store.updateUserLoginById(verification.user.id, nowIso()) || verification.user;
    const token = await createSession(updatedUser);
    res.setHeader("Set-Cookie", sessionCookie(token, req));
    sendJson(res, 200, {
      ok: true,
      user: sanitizeUser(updatedUser),
      sessionToken: token
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE] || headerSessionToken(req);
    await store.deleteSession(token);
    res.setHeader("Set-Cookie", clearSessionCookie(req));
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
    const session = await requireDesignWorkspaceUser(req, res);
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
    const session = await requireDesignWorkspaceUser(req, res);
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

  if (pathname.indexOf("/api/ai") === 0) {
    const session = await requireDesignWorkspaceUser(req, res);
    if (!session) {
      return;
    }

    if (req.method === "POST" && pathname === "/api/ai/design-advisor") {
      const payload = await parseBody(req);
      const fallbackAdvisor = buildTrustedLocalAdvisor(payload || {});

      try {
        const advisor = await generateOpenAiDesignAdvisor(payload || {});
        sendJson(res, 200, {
          ok: true,
          provider: advisor && advisor.provider ? advisor.provider : fallbackAdvisor.provider || "local_rules",
          advisor: advisor || fallbackAdvisor,
          generatedAt: nowIso()
        });
      } catch (error) {
        sendJson(res, 502, {
          ok: false,
          error: error && error.message ? error.message : "AI design advisor request failed.",
          fallbackAdvisor: fallbackAdvisor
        });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/ai/design-alternatives") {
      const payload = await parseBody(req);
      const fallbackAlternatives = buildTrustedLocalAlternatives(payload || {});

      try {
        const alternatives = await generateOpenAiDesignAlternatives(payload || {});
        sendJson(res, 200, {
          ok: true,
          provider: alternatives && alternatives.provider ? alternatives.provider : fallbackAlternatives.provider || "local_rules",
          alternatives: alternatives || fallbackAlternatives,
          generatedAt: nowIso()
        });
      } catch (error) {
        sendJson(res, 502, {
          ok: false,
          error: error && error.message ? error.message : "AI design alternatives request failed.",
          fallbackAlternatives: fallbackAlternatives
        });
      }
      return;
    }

    // ---------------------------------------------------------------------
    // /api/ai/design  — full sized design from project context.
    // The engine of truth is engine/ashrae/designer.js. AI is optional and
    // is only used to NARRATE the result; the numbers come from the engine.
    // ---------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ai/design") {
      const payload = await parseBody(req) || {};
      try {
        const design = designer.designProject(payload.project || payload || {});
        let narrative = null;
        if (cleanText(process.env.OPENAI_API_KEY)) {
          try { narrative = await narrateDesign(design); } catch (_) { narrative = null; }
        }
        sendJson(res, 200, {
          ok: true,
          provider: narrative ? "openai+ashrae" : "ashrae",
          engineVersion: ashrae.version,
          design: design,
          narrative: narrative,
          generatedAt: nowIso()
        });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error && error.message ? error.message : "Design generation failed."
        });
      }
      return;
    }

    // ---------------------------------------------------------------------
    // /api/ai/design-variants  — 3 ranked, fully sized alternatives.
    // ---------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ai/design-variants") {
      const payload = await parseBody(req) || {};
      try {
        const alternatives = designer.designAlternatives(payload.project || payload || {});
        sendJson(res, 200, {
          ok: true,
          provider: "ashrae",
          engineVersion: ashrae.version,
          alternatives: alternatives,
          generatedAt: nowIso()
        });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error && error.message ? error.message : "Alternative generation failed."
        });
      }
      return;
    }

    // ---------------------------------------------------------------------
    // /api/ai/design-autofix  — iteratively mutates intent until design
    // satisfies constraints (fan W/cfm, max oversize). Returns the final
    // design + a transcript of what was changed and why.
    // ---------------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/ai/design-autofix") {
      const payload = await parseBody(req) || {};
      try {
        const result = designer.autoFix(payload.project || {}, payload.constraints || {});
        sendJson(res, 200, {
          ok: true,
          provider: "ashrae",
          engineVersion: ashrae.version,
          success: result.success,
          iterations: result.iterations,
          design: result.design,
          log: result.log,
          generatedAt: nowIso()
        });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error && error.message ? error.message : "Auto-fix failed."
        });
      }
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/owner/integrations") {
    const session = await requireOwner(req, res);
    if (!session) {
      return;
    }
    sendJson(res, 200, {
      ok: true,
      email: EmailService.diagnostics(),
      razorpay: razorpayDiagnostics(),
      webhookUrl: appBaseUrl(req).replace(/\/+$/, "") + "/api/licensing/razorpay-webhook"
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/owner/test-email") {
    const session = await requireOwner(req, res);
    if (!session) {
      return;
    }
    const payload = await parseBody(req);
    const to = normalizeEmail(payload.to || session.user.email);
    if (!to) {
      sendJson(res, 400, { ok: false, error: "Recipient email is required." });
      return;
    }
    const verifyResult = await EmailService.verifyConfiguration();
    if (!verifyResult.ok) {
      sendJson(res, 400, { ok: false, error: verifyResult.error || "SMTP verification failed.", diagnostics: EmailService.diagnostics() });
      return;
    }
    const sendResult = await EmailService.sendEmail({
      to: to,
      subject: "Musk-IT HVAC SMTP test",
      html: renderEmailLayout({
        preheader: "SMTP delivery test from the HVAC platform.",
        kicker: "SMTP Test",
        title: "Email Delivery Is Active",
        summary: "This message confirms the configured SMTP provider can send platform emails.",
        bodyHtml: "<p style=\"margin:0;font-family:Arial,sans-serif;font-size:15px;line-height:1.75;color:#334155;\">GoDaddy SMTP is connected and this server can send account, password reset, pricing, and license activation emails.</p>",
        footer: "This is a delivery test generated from the owner integration diagnostics route."
      }),
      text: "Musk-IT HVAC SMTP test. Email delivery is active."
    });
    sendJson(res, sendResult.ok ? 200 : 400, Object.assign({ ok: !!sendResult.ok, diagnostics: EmailService.diagnostics() }, sendResult));
    return;
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
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const sevenDayStart = new Date(Date.now() - (1000 * 60 * 60 * 24 * 7));
    const activeTodayUsers = users.filter(function (user) {
      const lastLogin = user.last_login_at || user.lastLoginAt;
      return lastLogin && new Date(lastLogin).getTime() >= dayStart.getTime();
    });
    const active7DayUsers = users.filter(function (user) {
      const lastLogin = user.last_login_at || user.lastLoginAt;
      return lastLogin && new Date(lastLogin).getTime() >= sevenDayStart.getTime();
    });
    const activeTodayCompanyIds = new Set(activeTodayUsers.map(function (user) {
      return cleanText(user.company_id || user.companyId);
    }).filter(Boolean));
    const dauTrend = Array.from({ length: 7 }).map(function (_, index) {
      const date = new Date(dayStart.getTime() - ((6 - index) * 1000 * 60 * 60 * 24));
      const dateKey = date.toISOString().slice(0, 10);
      const dayUsers = users.filter(function (user) {
        const lastLogin = user.last_login_at || user.lastLoginAt;
        return lastLogin && new Date(lastLogin).toISOString().slice(0, 10) === dateKey;
      });
      const companyIds = new Set(dayUsers.map(function (user) {
        return cleanText(user.company_id || user.companyId);
      }).filter(Boolean));
      return {
        date: dateKey,
        activeUserCount: dayUsers.length,
        activeCompanyCount: companyIds.size,
        adminActiveCount: dayUsers.filter(function (user) { return isCompanyAdmin(user); }).length,
        regularActiveCount: dayUsers.filter(function (user) { return !isOwner(user) && !isCompanyAdmin(user); }).length
      };
    });
    const companyNameById = companies.reduce(function (lookup, company) {
      lookup[company.id] = company.name;
      return lookup;
    }, {});

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
      users: users.map(function (user) {
        const sanitized = sanitizeUser(user);
        return Object.assign({}, sanitized, {
          companyId: user.company_id || user.companyId || sanitized.companyId || "",
          companyName: user.company || companyNameById[user.company_id] || sanitized.company || "",
          lastLoginAt: toIso(user.last_login_at || user.lastLoginAt)
        });
      }),
      dailyActive: {
        date: dayStart.toISOString().slice(0, 10),
        activeUserCount: activeTodayUsers.length,
        active7DayUserCount: active7DayUsers.length,
        activeCompanyCount: activeTodayCompanyIds.size,
        ownerActiveCount: activeTodayUsers.filter(function (user) { return isOwner(user); }).length,
        adminActiveCount: activeTodayUsers.filter(function (user) { return isCompanyAdmin(user); }).length,
        regularActiveCount: activeTodayUsers.filter(function (user) { return !isOwner(user) && !isCompanyAdmin(user); }).length,
        trend: dauTrend
      },
      plans: plans,
      pricingOverrides: pricingOverrides.map(function (override) {
        return Object.assign({}, override, {
          companyName: companyNameById[override.companyId] || ""
        });
      })
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

  if (req.method === "POST" && pathname === "/api/owner/licensing-plan-price") {
    const session = await requireOwner(req, res);
    if (!session) {
      return;
    }

    const payload = await parseBody(req);
    const planCode = cleanText(payload.planCode);
    const annualPriceInr = integerOrDefault(payload.annualPriceInr, 0);

    if (!planCode || annualPriceInr <= 0) {
      sendJson(res, 400, { ok: false, error: "Plan and valid package price are required." });
      return;
    }

    const updatedPlan = await store.updateLicensingPlanPrice(planCode, annualPriceInr);
    if (!updatedPlan) {
      sendJson(res, 404, { ok: false, error: "Licensing plan was not found." });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      message: updatedPlan.planName + " price saved as " + formatInr(updatedPlan.annualPriceInr) + ". Razorpay orders for this package will use this price.",
      plan: updatedPlan,
      plans: await store.listLicensingPlans()
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

if (require.main === module) {
  startServer().catch(function (error) {
    console.error("Failed to start Musk-IT HVAC platform:", error.message || error);
    process.exit(1);
  });
}

module.exports = {
  sanitizeAdvisorPayload: sanitizeAdvisorPayload,
  sanitizeAlternativesPayload: sanitizeAlternativesPayload,
  buildTrustedLocalAdvisor: buildTrustedLocalAdvisor,
  buildTrustedLocalAlternatives: buildTrustedLocalAlternatives,
  reconcileAdvisorWithEngineering: reconcileAdvisorWithEngineering,
  reconcileAlternativesWithEngineering: reconcileAlternativesWithEngineering,
  designValidationFromPayload: designValidationFromPayload
};
