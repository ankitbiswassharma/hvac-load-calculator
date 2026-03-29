require("./envLoader");

function getProviderName() {
  return String(
    process.env.MAIL_PROVIDER
    || (process.env.EMAIL_HOST ? "smtp" : "resend")
  ).trim().toLowerCase();
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
    return {
      provider: "smtp",
      host: String(process.env.EMAIL_HOST || "").trim(),
      port: parseInt(process.env.EMAIL_PORT || "587", 10),
      secure: ["1", "true", "yes", "on"].includes(String(process.env.EMAIL_SECURE || "").toLowerCase()) || String(process.env.EMAIL_PORT || "") === "465",
      user: String(process.env.EMAIL_USER || process.env.SMTP_USER || "").trim(),
      pass: String(process.env.EMAIL_PASS || process.env.SMTP_PASS || ""),
      from: String(process.env.MAIL_FROM || process.env.EMAIL_FROM || "").trim(),
      replyTo: String(process.env.MAIL_REPLY_TO || process.env.EMAIL_REPLY_TO || "").trim()
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
    return !!(config.host && config.port && config.from);
  }
  return false;
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

  if (!(config.host && config.port && config.from)) {
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
    } : undefined
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
  isConfigured,
  sendEmail
};
