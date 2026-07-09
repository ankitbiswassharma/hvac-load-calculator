/**
 * Re-export shim. Canonical airflow/fan/pump/duct sizing lives in
 * engineeringCore.js (single source of truth). Kept for backward-compatible
 * require() paths.
 */
"use strict";

module.exports = require("../../engineeringCore.js").ashrae.airflow;
