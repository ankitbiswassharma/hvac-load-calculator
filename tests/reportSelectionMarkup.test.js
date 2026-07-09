/**
 * The equipment de-rating and coil ADP/BF outputs (Priorities #4/#5) must be
 * rendered into the Report page and PDF, sourced from the shared engine — and
 * each result must appear exactly ONCE (no repetition across sections).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { loadBrowserCalculator } = require("./helpers/browserCalculator.js");
const { comfortRoomInputs, humidRoomInputs } = require("./helpers/goldenCompute.js");

function textOf(html) {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("04A equipment block shows de-rated cooling unit + peak hour (and NOT the coil numbers)", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(comfortRoomInputs(), { skipAiEnhancements: true });
  const md = textOf(sandbox.HvacPlatformTest.buildSharedEngineSelectionMarkup(result));
  assert.ok(/Selected cooling unit/i.test(md), "must show the de-rated cooling unit");
  assert.ok(/Design peak hour/i.test(md), "must show the swept design peak hour");
  assert.ok(/de-rat/i.test(md), "must state the capacity is de-rated at the design condition");
  // Coil numbers must NOT live here — they belong to the psychrometric section only.
  assert.ok(!/Coil ADP/i.test(md), "coil ADP must not be duplicated into the equipment block");
});

test("coil feasibility note gives a single ACHIEVABLE/REVIEW verdict", function () {
  const sandbox = loadBrowserCalculator();
  const comfort = sandbox.HvacPlatformTest.calculateRoom(comfortRoomInputs(), { skipAiEnhancements: true });
  const humid = sandbox.HvacPlatformTest.calculateRoom(humidRoomInputs(), { skipAiEnhancements: true });
  const comfortNote = textOf(sandbox.HvacPlatformTest.buildCoilFeasibilityNote(comfort));
  const humidNote = textOf(sandbox.HvacPlatformTest.buildCoilFeasibilityNote(humid));
  assert.ok(/(ACHIEVABLE|REVIEW)/.test(comfortNote), "comfort room must state coil feasibility");
  if (humid.ashraeDesignerCrossCheck.coil && humid.ashraeDesignerCrossCheck.coil.achievable === false) {
    assert.ok(/REVIEW/.test(humidNote), "an infeasible coil must be flagged REVIEW");
    assert.ok(/reheat|dehumidif|lower supply/i.test(humidNote), "must give corrective guidance");
  }
});

test("full report renders correct method label and does not repeat results", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(comfortRoomInputs(), { skipAiEnhancements: true });
  result.finalDesign = sandbox.HvacPlatformTest.buildFinalDesign(result);
  sandbox.__project.rooms = [{ id: "report-case", name: "Pune report case", inputs: result.inputs, result: result }];
  sandbox.HvacPlatformTest.renderReport(result, []);
  const html = sandbox.__elements.get("report-content").innerHTML;

  // Correctness: the method label must reflect the sol-air switch, not stale CLTD.
  assert.ok(/sol-air/i.test(html), "report must describe the sol-air method");
  assert.ok(!/ASHRAE CLTD \//.test(html), "stale 'ASHRAE CLTD /' method label must be gone");

  // No repetition: the shared-engine coil feasibility verdict appears exactly once.
  assert.strictEqual(countOccurrences(html, "Coil feasibility (shared engine)"), 1,
    "coil feasibility verdict must appear exactly once in the report");

  // No repetition: the equipment-selection section header appears exactly once.
  assert.strictEqual(countOccurrences(html, "EQUIPMENT SELECTION (SHARED ENGINE)"), 1,
    "the 04A equipment-selection section header must appear once");

  // The 04A section must also be listed in the contents index (once).
  assert.strictEqual(countOccurrences(html, "Equipment selection (shared engine)"), 1,
    "04A must be listed once in the report index");
});
