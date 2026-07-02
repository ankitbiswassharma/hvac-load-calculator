/**
 * Regenerate the golden calculation snapshot.
 *
 *   npm run golden:update
 *
 * Run this ONLY after a deliberate, reviewed change to calculation logic.
 * The diff of tests/golden/goldenValues.json then documents exactly which
 * numbers changed and by how much — reviewers see the numeric impact of any
 * engineering change directly in the pull request.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { computeGoldenValues, computePythonGolden } = require("../tests/helpers/goldenCompute.js");

const outPath = path.resolve(__dirname, "..", "tests", "golden", "goldenValues.json");

const golden = computeGoldenValues();
const pythonGolden = computePythonGolden();
if (pythonGolden) {
  golden.pythonEnergyEngine = pythonGolden;
} else {
  console.warn("WARNING: python3 unavailable — python energy golden values not regenerated.");
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(golden, null, 2) + "\n");
console.log("Golden values written to " + outPath);
