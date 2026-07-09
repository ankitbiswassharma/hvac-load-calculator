/**
 * Re-export shim. Canonical equipment selection / COP / bin-energy model
 * lives in engineeringCore.js (single source of truth). Kept for
 * backward-compatible require() paths.
 */
"use strict";

module.exports = require("../../engineeringCore.js").ashrae.equipment;
