/**
 * Single-engine consolidation guarantees.
 *
 * After consolidation there is exactly ONE implementation of the ASHRAE
 * sol-air design engine — it lives in engineeringCore.js and is exposed as
 * `EngineeringCore.ashrae`. The engine/ashrae/* modules are thin re-export
 * shims. These tests lock that in so the split-brain (two engines that can
 * disagree) cannot silently return.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const EngineeringCore = require("../engineeringCore.js");
const designerShim = require("../engine/ashrae/designer.js");
const psyShim = require("../engine/ashrae/psychrometrics.js");
const solarShim = require("../engine/ashrae/solar.js");
const loadsShim = require("../engine/ashrae/loads.js");
const airflowShim = require("../engine/ashrae/airflow.js");
const equipmentShim = require("../engine/ashrae/equipment.js");
const { loadBrowserCalculator } = require("./helpers/browserCalculator.js");
const { comfortRoomInputs, cleanroomRoomInputs, humidRoomInputs } = require("./helpers/goldenCompute.js");

const ashrae = EngineeringCore.ashrae;

test("engineeringCore exposes the canonical ashrae engine", function () {
  assert.ok(ashrae, "EngineeringCore.ashrae must exist");
  assert.ok(ashrae.designer && typeof ashrae.designer.designProject === "function");
  assert.strictEqual(typeof EngineeringCore.designProject, "function");
  assert.strictEqual(EngineeringCore.designProject, ashrae.designer.designProject);
});

test("engine/ashrae/* modules are the SAME object as the canonical engine (no duplicate implementation)", function () {
  assert.strictEqual(designerShim, ashrae.designer, "designer shim must delegate to engineeringCore");
  assert.strictEqual(psyShim, ashrae.psy);
  assert.strictEqual(solarShim, ashrae.solar);
  assert.strictEqual(loadsShim, ashrae.loads);
  assert.strictEqual(airflowShim, ashrae.airflow);
  assert.strictEqual(equipmentShim, ashrae.equipment);
});

test("shim and canonical engine produce byte-identical designs", function () {
  const project = {
    name: "consolidation",
    climate: {
      latitudeDeg: 26.9, longitudeDeg: 75.8, stdMeridianDeg: 82.5,
      designOutdoorDbC: 42, designOutdoorWbC: 24,
      designDayOfYear: 202, designClockHour: 15, elevationM: 216
    },
    rooms: [{
      name: "Office", areaM2: 120, ceilingHeightM: 3.5, occupants: 25, activity: "seated_office",
      lpd: 9, epd: 20, equipmentUsage: 0.8,
      walls: [{ area: 51, U: 0.42, orientation: "S", alpha: 0.6 }, { area: 51, U: 0.42, orientation: "W", alpha: 0.6 }],
      roof: { area: 120, U: 0.35, alpha: 0.85, dR: 63 },
      windows: [{ area: 14, U: 2.8, sc: 0.65, orientation: "W" }],
      infiltrationAch: 0.5, ventilationCfmPerPerson: 10, ventilationCfmPerM2: 0.3,
      supplyTempC: 13.5, setpointC: 23, setpointRhPct: 55, safetyFactor: 1.10
    }],
    designIntent: { systemType: "vrf", fanEfficiency: 0.65, motorEfficiency: 0.92, externalSpPa: 480, diversityFactor: 1.0 }
  };
  const viaShim = designerShim.designProject(project);
  const viaCore = ashrae.designer.designProject(project);
  // generatedAt is a timestamp; compare everything else.
  delete viaShim.generatedAt; delete viaCore.generatedAt;
  assert.deepStrictEqual(viaShim, viaCore);
});

test("Priority #4: equipment selection de-rates capacity at the design outdoor temperature", function () {
  const eq = EngineeringCore.ashrae.equipment;
  const mild = eq.selectEquipment({ requiredTR: 9.5, outdoorTempC: 35, systemType: "vrf" });
  const hot = eq.selectEquipment({ requiredTR: 9.5, outdoorTempC: 46, systemType: "vrf" });
  assert.ok(mild.meetsLoad && hot.meetsLoad, "both selections must cover the load");
  assert.ok(hot.deratingFactor < 1, "capacity must be de-rated at 46 C");
  assert.ok(hot.correctedTR < hot.nominalTR, "corrected capacity must be below nominal at 46 C");
  // The same load at a hotter design condition must select equal-or-larger iron.
  assert.ok(hot.nominalTR >= mild.nominalTR,
    "hotter design day must not select smaller equipment (got " + hot.nominalTR + " vs " + mild.nominalTR + ")");
  // Water-cooled chillers are far less temperature-sensitive than air-cooled VRF.
  const vrfDerate = eq.capacityDeratingFactor(46, "vrf");
  const chillerDerate = eq.capacityDeratingFactor(46, "chiller_ahu");
  assert.ok(chillerDerate > vrfDerate, "chiller should de-rate less than air-cooled VRF");
});

test("Priority #5: coil ADP/bypass flags an unachievable low-SHR room", function () {
  const eq = EngineeringCore.ashrae.equipment;
  const comfort = eq.coilProcess({ roomTempC: 24, roomRhPct: 50, shr: 0.78, supplyTempC: 13 });
  assert.ok(comfort.achievable, "a normal comfort SHR must be achievable");
  assert.ok(comfort.adpC > 5 && comfort.adpC < 15, "comfort ADP should be a sane 5-15 C, got " + comfort.adpC);
  assert.ok(comfort.bypassFactor >= 0 && comfort.bypassFactor <= 1, "bypass factor must be a fraction");
  const extremeLatent = eq.coilProcess({ roomTempC: 24, roomRhPct: 55, shr: 0.55, supplyTempC: 13 });
  assert.ok(!extremeLatent.achievable,
    "a very low room SHR should be flagged as not achievable by a single standard coil");
});

test("Priority #4/#5: designProject exposes de-rated equipment selection and a coil rollup", function () {
  const designer = EngineeringCore.ashrae.designer;
  const proj = {
    name: "p",
    climate: { latitudeDeg: 19, longitudeDeg: 72.8, stdMeridianDeg: 82.5, designOutdoorDbC: 44, designOutdoorWbC: 26, designDayOfYear: 172, elevationM: 14 },
    rooms: [{
      name: "R", areaM2: 120, ceilingHeightM: 3.5, occupants: 25, activity: "seated_office",
      lpd: 9, epd: 20, equipmentUsage: 0.8,
      walls: [{ area: 51, U: 0.42, orientation: "W", alpha: 0.6 }],
      roof: { area: 120, U: 0.35, alpha: 0.85, dR: 63 },
      windows: [{ area: 14, U: 2.8, sc: 0.65, orientation: "W" }],
      infiltrationAch: 0.5, ventilationCfmPerPerson: 10, ventilationCfmPerM2: 0.3,
      supplyTempC: 13.5, setpointC: 23, setpointRhPct: 55, safetyFactor: 1.10
    }],
    designIntent: { systemType: "vrf" }
  };
  const p = designer.designProject(proj);
  assert.ok(p.equipmentSelection && p.equipmentSelection.model, "must return a selected equipment model");
  assert.ok(p.equipmentSelection.meetsLoad, "selected equipment must meet the de-rated load");
  assert.ok(p.equipmentSelection.correctedTR >= p.aggregate.diversifiedTR, "corrected capacity must cover the load");
  assert.ok(p.coil && Number.isFinite(p.coil.designAdpC), "must return a system coil rollup with ADP");
  assert.ok(p.rooms[0].coil && Number.isFinite(p.rooms[0].coil.bypassFactor), "each room must carry a coil result");
});

test("Priority #3: design-day sweep finds orientation-specific peak hours", function () {
  const designer = EngineeringCore.ashrae.designer;
  function room(name, ori) {
    return {
      name: name, areaM2: 60, ceilingHeightM: 3, occupants: 6, activity: "seated_office",
      lpd: 10, epd: 12, equipmentUsage: 0.7,
      walls: [{ area: 30, U: 0.5, orientation: ori, alpha: 0.7 }],
      windows: [{ area: 10, U: 2.8, sc: 0.6, orientation: ori }],
      infiltrationAch: 0.4, ventilationCfmPerPerson: 5, ventilationCfmPerM2: 0.6,
      supplyTempC: 13, setpointC: 24, setpointRhPct: 50, safetyFactor: 1.10
    };
  }
  const climate = { latitudeDeg: 19, longitudeDeg: 72.8, stdMeridianDeg: 82.5, designOutdoorDbC: 35, designOutdoorWbC: 26, designDayOfYear: 172, elevationM: 14 };
  const east = designer.designRoom(room("E", "E"), climate);
  const west = designer.designRoom(room("W", "W"), climate);
  assert.ok(east.designDaySwept, "sweep should be on by default");
  assert.ok(east.peakHour < 12, "east-facing room must peak in the morning, got " + east.peakHour);
  assert.ok(west.peakHour > 14, "west-facing room must peak in the afternoon, got " + west.peakHour);
  assert.ok(Array.isArray(west.hourly) && west.hourly.length > 1, "hourly load curve must be returned");

  // The fixed-hour (15:00) assumption under-sizes a west room vs its true peak.
  const westFixed = designer.designRoom(room("W", "W"), Object.assign({}, climate, { sweepDesignDay: false, designClockHour: 15 }));
  assert.strictEqual(westFixed.peakHour, 15);
  assert.ok(west.designTR >= westFixed.designTR,
    "swept peak must be >= the fixed-hour result (fixed hour can under-size)");
});

test("Priority #3: multi-room block peak is coincident, not sum of room peaks", function () {
  const designer = EngineeringCore.ashrae.designer;
  function room(name, ori) {
    return {
      name: name, areaM2: 60, ceilingHeightM: 3, occupants: 6, activity: "seated_office",
      lpd: 10, epd: 12, equipmentUsage: 0.7,
      walls: [{ area: 30, U: 0.5, orientation: ori, alpha: 0.7 }],
      windows: [{ area: 10, U: 2.8, sc: 0.6, orientation: ori }],
      infiltrationAch: 0.4, supplyTempC: 13, setpointC: 24, setpointRhPct: 50, safetyFactor: 1.10
    };
  }
  const climate = { latitudeDeg: 19, longitudeDeg: 72.8, stdMeridianDeg: 82.5, designOutdoorDbC: 35, designOutdoorWbC: 26, designDayOfYear: 172, elevationM: 14 };
  const p = designer.designProject({ name: "blk", climate: climate, rooms: [room("East", "E"), room("West", "W")], designIntent: { systemType: "vrf" } });
  assert.ok(p.aggregate.blockPeakW < p.aggregate.sumOfRoomPeaksW,
    "coincident block peak must be below the sum of room peaks");
  assert.ok(p.aggregate.coincidenceFactor > 0.5 && p.aggregate.coincidenceFactor < 1,
    "coincidence factor should be a real diversity in (0.5, 1), got " + p.aggregate.coincidenceFactor);
});

test("Priority #2: main UI envelope loads equal the shared sol-air engine (no method split)", function () {
  const sandbox = loadBrowserCalculator();
  const scenarios = [comfortRoomInputs(), cleanroomRoomInputs(), humidRoomInputs()];
  for (const inputs of scenarios) {
    const result = sandbox.HvacPlatformTest.calculateRoom(inputs, { skipAiEnhancements: true });
    assert.strictEqual(result.envelopeMethod, "ashrae_sol_air",
      "UI envelope must use the shared sol-air method, not legacy CLTD");
    const cc = result.ashraeDesignerCrossCheck;
    // The UI reads wall/roof/window loads directly from the shared engine's
    // component breakdown, so the envelope totals must match to the watt.
    const uiEnvelope = Math.round(result.windowSensible + result.wallSensible + result.roofSensible);
    assert.strictEqual(uiEnvelope, cc.envelopeSensibleW,
      "UI envelope sensible must equal the shared-engine envelope sensible exactly");
  }
});

test("main UI calculator calls the shared engine and attaches a cross-check on every room", function () {
  const sandbox = loadBrowserCalculator();
  const scenarios = [comfortRoomInputs(), cleanroomRoomInputs(), humidRoomInputs()];
  for (const inputs of scenarios) {
    const result = sandbox.HvacPlatformTest.calculateRoom(inputs, { skipAiEnhancements: true });
    const cc = result.ashraeDesignerCrossCheck;
    assert.ok(cc, "every room result must carry an ashraeDesignerCrossCheck");
    assert.ok(!cc.error, "cross-check must not error: " + cc.error);
    assert.ok(Number.isFinite(cc.designTR) && cc.designTR > 0, "shared designer must return a positive TR");
    assert.ok(cc.engine.indexOf("engineeringCore.ashrae") === 0, "cross-check must come from the shared engine");
    // Sanity band: the two methods (UI CLTD vs shared sol-air) must be in the
    // same ballpark. A gross mismatch means the engines have diverged and is a
    // real bug. The residual gap is the known CLTD-vs-sol-air method difference.
    const ratio = cc.designTR / (cc.uiDesignTR || cc.designTR);
    assert.ok(ratio > 0.5 && ratio < 1.6,
      "UI and shared designer tonnage diverge too far (ratio " + ratio.toFixed(2) + ") — engines may have split");
  }
});
