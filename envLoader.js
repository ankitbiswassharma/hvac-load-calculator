const fs = require("fs");
const path = require("path");

let loaded = false;

function parseEnvValue(rawValue) {
  const value = String(rawValue == null ? "" : rawValue);
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath) {
  if (loaded) {
    return;
  }

  const targetPath = filePath || path.join(__dirname, ".env");
  if (!fs.existsSync(targetPath)) {
    loaded = true;
    return;
  }

  const contents = fs.readFileSync(targetPath, "utf8");
  contents.split(/\r?\n/).forEach(function (line) {
    if (!line || /^\s*#/.test(line) || line.indexOf("=") === -1) {
      return;
    }
    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      return;
    }
    const value = parseEnvValue(line.slice(separatorIndex + 1));
    process.env[key] = value;
  });

  loaded = true;
}

loadEnvFile();

module.exports = {
  loadEnvFile
};
