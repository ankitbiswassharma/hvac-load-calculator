/**
 * Re-export shim. Canonical load calculations live in engineeringCore.js
 * (single source of truth). Kept for backward-compatible require() paths.
 */
"use strict";

module.exports = require("../../engineeringCore.js").ashrae.loads;
