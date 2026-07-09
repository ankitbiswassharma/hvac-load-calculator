/**
 * Re-export shim. The full-design generator (designRoom / designProject /
 * designAlternatives / autoFix) now lives in engineeringCore.js so the exact
 * same code runs in the browser UI and in the Node AI endpoints — there is
 * no longer a separate engine that can disagree with the main calculator.
 *
 * Kept for backward-compatible require() paths (server.js, tests).
 */
"use strict";

module.exports = require("../../engineeringCore.js").ashrae.designer;
