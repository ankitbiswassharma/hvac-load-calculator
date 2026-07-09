/**
 * Re-export shim. Canonical solar/sol-air model lives in engineeringCore.js
 * (single source of truth). Kept for backward-compatible require() paths.
 */
"use strict";

module.exports = require("../../engineeringCore.js").ashrae.solar;
