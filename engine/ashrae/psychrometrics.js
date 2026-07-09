/**
 * Re-export shim. The canonical ASHRAE psychrometrics now live in
 * engineeringCore.js (the single source of truth shared by the browser UI
 * and the Node AI endpoints). Kept so existing require() call-sites and
 * tests keep working unchanged.
 */
"use strict";

module.exports = require("../../engineeringCore.js").ashrae.psy;
