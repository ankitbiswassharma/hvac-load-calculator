const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(fileName) {
  return fs.readFileSync(path.join(repoRoot, fileName), "utf8");
}

test("owner login is separated from company login and requires emailed OTP", function () {
  const serverSource = readRepoFile("server.js");
  const htmlSource = readRepoFile("contact copy 2.html");
  const apiSource = readRepoFile("apiClient.js");
  const authSource = readRepoFile("authManager.js");
  const platformSource = readRepoFile("hvacPlatform.js");

  assert.match(serverSource, /pathname === "\/api\/auth\/owner\/request-otp"/);
  assert.match(serverSource, /pathname === "\/api\/auth\/owner\/verify-otp"/);
  assert.match(serverSource, /Owner accounts must use Owner Login with email OTP/);
  assert.match(serverSource, /sendOwnerLoginOtpEmail/);
  assert.match(serverSource, /requireDesignWorkspaceUser/);
  assert.match(serverSource, /Owner sessions are limited to owner dashboard, user management, DAU, integrations, and pricing override functions/);
  assert.match(serverSource, /dailyActive/);
  assert.match(serverSource, /trend:\s*dauTrend/);
  assert.doesNotMatch(serverSource, /sendJson\(res,\s*200,\s*\{[\s\S]{0,240}otp\s*:/i);

  assert.match(htmlSource, /data-auth-mode="owner"/);
  assert.match(htmlSource, /id="auth-owner-email"/);
  assert.match(htmlSource, /id="auth-owner-password"/);
  assert.match(htmlSource, /id="auth-owner-otp"/);
  assert.match(htmlSource, /id="m-owner-dau"/);
  assert.match(htmlSource, /show\('owner-users'\)/);
  assert.match(htmlSource, /show\('owner-dau'\)/);
  assert.match(htmlSource, /show\('owner-pricing'\)/);
  assert.match(htmlSource, /id="p-owner-users"/);
  assert.match(htmlSource, /id="p-owner-dau"/);
  assert.match(htmlSource, /id="p-owner-pricing"/);
  assert.match(htmlSource, /id="owner-users-table"/);
  assert.match(htmlSource, /id="owner-dau-table"/);
  assert.match(htmlSource, /id="owner-dau-trend"/);
  assert.match(htmlSource, /id="owner-pricing-overrides-table"/);

  assert.match(apiSource, /requestOwnerOtp/);
  assert.match(apiSource, /verifyOwnerOtp/);
  assert.match(authSource, /Owner login requires the backend server/);
  assert.match(platformSource, /ownerLoginChallenge/);
  assert.match(platformSource, /AuthManager\.requestOwnerOtp/);
  assert.match(platformSource, /AuthManager\.verifyOwnerOtp/);
  assert.match(platformSource, /isOwnerUser\(user\)[\s\S]{0,180}show\("owner"\)/);
  assert.match(platformSource, /ownerPanels = \["owner", "owner-users", "owner-dau", "owner-pricing"\]/);
  assert.match(platformSource, /owner-users-table/);
  assert.match(platformSource, /owner-dau-table/);
  assert.match(platformSource, /owner-dau-trend/);
});
