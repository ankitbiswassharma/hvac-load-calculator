/**
 * Golden regression: every calculation engine must reproduce the pinned
 * reference results exactly (within float tolerance) in one pass.
 *
 * Covers: ASHRAE psychrometrics, solar (both engines), load components,
 * airflow/duct/fan physics, equipment physics, catalog fan + AHU selection,
 * the full ASHRAE designer, three end-to-end room calculations through the
 * real UI pipeline (comfort / cleanroom / high-latent), BOQ costing, and the
 * Python bin-method energy engine.
 *
 * If this suite fails, a calculation result changed. That is either a bug
 * (fix it) or a deliberate engineering change (regenerate the snapshot with
 * `npm run golden:update` and let the JSON diff document the change).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { computeGoldenValues, computePythonGolden } = require("./helpers/goldenCompute.js");

const goldenPath = path.resolve(__dirname, "golden", "goldenValues.json");
const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

const REL_TOL = 1e-6;
const ABS_TOL = 1e-9;

function assertDeepClose(actual, expected, trail) {
  const label = trail.join(".");
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", label + ": expected a number, got " + typeof actual);
    const diff = Math.abs(actual - expected);
    const tolerance = ABS_TOL + REL_TOL * Math.abs(expected);
    assert.ok(diff <= tolerance,
      label + ": expected " + expected + ", got " + actual + " (Δ=" + diff + ")");
    return;
  }
  if (expected === null || typeof expected !== "object") {
    assert.equal(actual, expected, label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
    return;
  }
  assert.ok(actual && typeof actual === "object", label + ": expected object, got " + typeof actual);
  for (const key of Object.keys(expected)) {
    assertDeepClose(actual[key], expected[key], trail.concat(key));
  }
}

const recomputed = computeGoldenValues();

const SECTIONS = [
  ["psychrometrics", "ASHRAE psychrometrics reference values"],
  ["solar", "solar irradiance and effective glass load"],
  ["loads", "load components (air, occupants, lighting)"],
  ["airflowPhysics", "supply airflow, duct friction, fan and pump physics"],
  ["equipmentPhysics", "tonnage ladder, COP and part-load physics"],
  ["fanSelection", "catalog fan selection (curve, brake/electrical/motor kW)"],
  ["systemSelection", "AHU + fan system selection"],
  ["designer", "full ASHRAE designer aggregate results"],
  ["roomScenarios", "end-to-end room calculations (comfort, cleanroom, high-latent)"],
  ["costing", "BOQ costing roll-up"]
];

for (const [key, label] of SECTIONS) {
  test("golden: " + label, () => {
    assert.ok(golden[key], "golden snapshot is missing section '" + key + "' — run npm run golden:update");
    assertDeepClose(recomputed[key], golden[key], [key]);
  });
}

test("golden: python bin-method energy engine", (t) => {
  if (!golden.pythonEnergyEngine) {
    t.skip("no python golden values in snapshot");
    return;
  }
  const actual = computePythonGolden();
  if (!actual) {
    // Local machines without python3 skip; CI installs python and enforces.
    if (process.env.CI) {
      assert.fail("python3 is required in CI to verify the energy engine golden values");
    }
    t.skip("python3 not available in this environment");
    return;
  }
  assertDeepClose(actual, golden.pythonEnergyEngine, ["pythonEnergyEngine"]);
});
