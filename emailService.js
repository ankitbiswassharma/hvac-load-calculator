require("./envLoader");

function getProviderName() {
  return String(
    process.env.MAIL_PROVIDER
    || (process.env.EMAIL_HOST || process.env.SMTP_HOST || process.env.GODADDY_SMTP_HOST ? "smtp" : "resend")
  ).trim().toLowerCase();
}

function envText(keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function envSecret(keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "");
    if (value) {
      return value;
    }
  }
  return "";
}

function envBool(keys, fallback) {
  for (const key of keys) {
    const raw = String(process.env[key] || "").trim().toLowerCase();
    if (!raw) {
      continue;
    }
    if (["1", "true", "yes", "on"].includes(raw)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(raw)) {
      return false;
    }
  }
  return !!fallback;
}

function getProviderConfig() {
  const provider = getProviderName();
  if (provider === "resend") {
    return {
      provider: "resend",
      apiKey: String(process.env.RESEND_API_KEY || "").trim(),
      from: String(process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL || "").trim(),
      replyTo: String(process.env.MAIL_REPLY_TO || "").trim()
    };
  }

  if (provider === "smtp") {
    const host = envText(["EMAIL_HOST", "SMTP_HOST", "GODADDY_SMTP_HOST"]) || "smtpout.secureserver.net";
    const port = parseInt(envText(["EMAIL_PORT", "SMTP_PORT", "GODADDY_SMTP_PORT"]) || "587", 10);
    const user = envText(["EMAIL_USER", "SMTP_USER", "GODADDY_SMTP_USER"]);
    const from = envText(["MAIL_FROM", "EMAIL_FROM", "SMTP_FROM", "GODADDY_SMTP_FROM"]) || user;
    return {
      provider: "smtp",
      host: host,
      port: Number.isFinite(port) ? port : 587,
      secure: envBool(["EMAIL_SECURE", "SMTP_SECURE", "GODADDY_SMTP_SECURE"], String(port) === "465"),
      requireAuth: !envBool(["SMTP_ALLOW_NO_AUTH"], false),
      user: user,
      pass: envSecret(["EMAIL_PASS", "SMTP_PASS", "GODADDY_SMTP_PASS"]),
      from: from,
      replyTo: envText(["MAIL_REPLY_TO", "EMAIL_REPLY_TO", "SMTP_REPLY_TO", "GODADDY_SMTP_REPLY_TO"]),
      connectionTimeout: parseInt(envText(["SMTP_CONNECTION_TIMEOUT_MS"]) || "12000", 10),
      greetingTimeout: parseInt(envText(["SMTP_GREETING_TIMEOUT_MS"]) || "12000", 10),
      socketTimeout: parseInt(envText(["SMTP_SOCKET_TIMEOUT_MS"]) || "20000", 10)
    };
  }

  return {
    provider: provider,
    apiKey: "",
    from: String(process.env.MAIL_FROM || "").trim(),
    replyTo: String(process.env.MAIL_REPLY_TO || "").trim()
  };
}

function isConfigured() {
  const config = getProviderConfig();
  if (config.provider === "resend") {
    return !!(config.apiKey && config.from);
  }
  if (config.provider === "smtp") {
    return !!(config.host && config.port && config.from && (!config.requireAuth || (config.user && config.pass)));
  }
  return false;
}

function diagnostics() {
  const config = getProviderConfig();
  if (config.provider === "smtp") {
    return {
      provider: config.provider,
      configured: isConfigured(),
      host: config.host,
      port: config.port,
      secure: !!config.secure,
      authConfigured: !!(config.user && config.pass),
      from: config.from,
      replyTo: config.replyTo || ""
    };
  }
  return {
    provider: config.provider,
    configured: isConfigured(),
    from: config.from || "",
    replyTo: config.replyTo || ""
  };
}

async function sendWithResend(message, config) {
  if (!(globalThis.fetch && config.apiKey && config.from)) {
    return {
      ok: false,
      skipped: true,
      provider: config.provider,
      error: "Email provider is not configured."
    };
  }

  const payload = {
    from: config.from,
    to: Array.isArray(message.to) ? message.to : [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text || "",
    reply_to: config.replyTo || undefined
  };

  const response = await globalThis.fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + config.apiKey
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    return {
      ok: false,
      provider: config.provider,
      error: (result && result.message) || "Email send failed."
    };
  }

  return {
    ok: true,
    provider: config.provider,
    messageId: result && result.id ? result.id : ""
  };
}

async function sendWithSmtp(message, config) {
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (error) {
    return {
      ok: false,
      skipped: true,
      provider: config.provider,
      error: "SMTP support requires the nodemailer package."
    };
  }

  if (!(config.host && config.port && config.from && (!config.requireAuth || (config.user && config.pass)))) {
    return {
      ok: false,
      skipped: true,
      provider: config.provider,
      error: "SMTP provider is not fully configured."
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: !!config.secure,
    auth: config.user ? {
      user: config.user,
      pass: config.pass || ""
    } : undefined,
    requireTLS: !config.secure,
    connectionTimeout: config.connectionTimeout,
    greetingTimeout: config.greetingTimeout,
    socketTimeout: config.socketTimeout,
    tls: {
      servername: config.host,
      minVersion: "TLSv1.2"
    }
  });

  try {
    const result = await transporter.sendMail({
      from: config.from,
      to: Array.isArray(message.to) ? message.to.join(", ") : message.to,
      subject: message.subject,
      html: message.html,
      text: message.text || "",
      replyTo: config.replyTo || undefined
    });
    return {
      ok: true,
      provider: config.provider,
      messageId: result && result.messageId ? result.messageId : ""
    };
  } catch (error) {
    return {
      ok: false,
      provider: config.provider,
      error: error && error.message ? error.message : "SMTP send failed."
    };
  }
}

async function verifyConfiguration() {
  const config = getProviderConfig();
  if (config.provider !== "smtp") {
    return {
      ok: isConfigured(),
      provider: config.provider,
      skipped: true,
      error: isConfigured() ? "" : "Email provider is not configured."
    };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (error) {
    return {
      ok: false,
      provider: config.provider,
      error: "SMTP support requires the nodemailer package."
    };
  }

  if (!isConfigured()) {
    return {
      ok: false,
      provider: config.provider,
      error: "SMTP provider is not fully configured."
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: !!config.secure,
    auth: config.user ? {
      user: config.user,
      pass: config.pass || ""
    } : undefined,
    requireTLS: !config.secure,
    connectionTimeout: config.connectionTimeout,
    greetingTimeout: config.greetingTimeout,
    socketTimeout: config.socketTimeout,
    tls: {
      servername: config.host,
      minVersion: "TLSv1.2"
    }
  });

  try {
    await transporter.verify();
    return {
      ok: true,
      provider: config.provider,
      host: config.host,
      port: config.port,
      secure: !!config.secure,
      from: config.from
    };
  } catch (error) {
    return {
      ok: false,
      provider: config.provider,
      host: config.host,
      port: config.port,
      secure: !!config.secure,
      error: error && error.message ? error.message : "SMTP verification failed."
    };
  }
}

async function sendEmail(message) {
  const config = getProviderConfig();
  if (config.provider === "resend") {
    return sendWithResend(message, config);
  }
  if (config.provider === "smtp") {
    return sendWithSmtp(message, config);
  }

  return {
    ok: false,
    skipped: true,
    provider: config.provider,
    error: "Unsupported email provider configuration."
  };
}

module.exports = {
  diagnostics,
  getProviderConfig,
  isConfigured,
  verifyConfiguration,
  sendEmail
};
