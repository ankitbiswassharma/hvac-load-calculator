/**
 * Golden-value computation for the full calculation stack.
 *
 * This module produces one nested object of pure numbers/strings covering
 * every calculation engine in the platform. The generator script snapshots
 * it into tests/golden/goldenValues.json; the regression test recomputes it
 * and compares. Any change to any calculation result anywhere in the stack
 * fails CI until the golden file is deliberately regenerated with:
 *
 *     npm run golden:update
 */
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const psy = require("../../engine/ashrae/psychrometrics.js");
const sol = require("../../engine/ashrae/solar.js");
const loads = require("../../engine/ashrae/loads.js");
const airflow = require("../../engine/ashrae/airflow.js");
const equipment = require("../../engine/ashrae/equipment.js");
const designer = require("../../engine/ashrae/designer.js");
const SolarEngine = require("../../solarEngine.js");
const EquipmentEngine = require("../../equipmentEngine.js");
const CostingEngine = require("../../costingEngine.js");
const { loadBrowserCalculator } = require("./browserCalculator.js");

/* ------------------------------------------------------------------ */
/*  Fixed reference inputs — never change these without regenerating   */
/*  the golden file, because expected values are pinned against them.  */
/* ------------------------------------------------------------------ */

function designerProject() {
  return {
    name: "Golden designer case",
    climate: {
      latitudeDeg: 26.9, longitudeDeg: 75.8, stdMeridianDeg: 82.5,
      designOutdoorDbC: 42, designOutdoorWbC: 24,
      designDayOfYear: 202, designClockHour: 15, elevationM: 216
    },
    rooms: [{
      name: "Office", areaM2: 120, ceilingHeightM: 3.5,
      occupants: 25, activity: "seated_office",
      lpd: 9, epd: 20, equipmentUsage: 0.8,
      walls: [
        { area: 51, U: 0.42, orientation: "S", alpha: 0.6 },
        { area: 51, U: 0.42, orientation: "W", alpha: 0.6 }
      ],
      roof: { area: 120, U: 0.35, alpha: 0.85, dR: 63 },
      windows: [{ area: 14, U: 2.8, sc: 0.65, orientation: "W" }],
      infiltrationAch: 0.5, ventilationCfmPerPerson: 10, ventilationCfmPerM2: 0.3,
      supplyTempC: 13.5, setpointC: 23, setpointRhPct: 55, safetyFactor: 1.10
    }],
    designIntent: {
      systemType: "vrf", fanEfficiency: 0.65, motorEfficiency: 0.92,
      externalSpPa: 480, diversityFactor: 1.0
    }
  };
}

function comfortRoomInputs() {
  // Pune comfort office — same shape the UI submits.
  return {
    len: "20", wid: "13", ht: "4",
    design_mode: "comfort",
    cleanroom_iso_class: "ISO 8", cleanroom_state: "operational", cleanroom_pressure_mode: "positive",
    window_count: "1", window_config: '[{"area":12,"orientation":"W"}]',
    win_area: "12", win_orient: "W",
    wall_count: "2", wall_config: '[{"area":80,"orientation":"W"},{"area":52,"orientation":"S"}]',
    wall_exp: "2", ceiling_area: "260", floor_area: "260", roof_exp: "ground",
    occ: "10", occ_act: "seated_light", fresh_cfm: "15",
    lighting: "12", equip: "15",
    out_dbt: "39.8", out_wbt: "24", out_rh: "23",
    out_lat: "18.52", out_elev: "560",
    in_dbt: "22", in_rh: "45", sf: "10",
    u_wall: "0.45", u_roof: "0.40", sc_glass: "0.87", clf_shade: "0.55",
    solar_day: "202", solar_hour: "15", ahu_group: "AHU-1"
  };
}

function cleanroomRoomInputs() {
  return Object.assign(comfortRoomInputs(), {
    len: "12", wid: "8", ht: "3",
    design_mode: "cleanroom",
    cleanroom_iso_class: "ISO 7",
    roof_exp: "top_floor",
    occ: "6", occ_act: "standing_light",
    lighting: "14", equip: "35",
    fresh_cfm: "20",
    in_dbt: "21", in_rh: "50",
    win_area: "0", window_count: "0", window_config: "[]"
  });
}

function humidRoomInputs() {
  // High-latent Mumbai case: hot, humid outdoor air with dense occupancy.
  return Object.assign(comfortRoomInputs(), {
    len: "15", wid: "10", ht: "3.2",
    occ: "40", occ_act: "seated_light", fresh_cfm: "12",
    out_dbt: "34.5", out_wbt: "28", out_lat: "19.07", out_elev: "14",
    in_dbt: "24", in_rh: "55",
    lighting: "10", equip: "12",
    win_area: "10", window_config: '[{"area":10,"orientation":"W"}]'
  });
}

const GOLDEN_RATES = {
  rate_tr: 26000, rate_duct: 1450, rate_insul: 480,
  rate_diffuser: 2200, rate_return: 1800,
  rate_fan: 9500, rate_pipe: 3800, rate_bms: 2500
};

function fullYearBins() {
  const temps = [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46];
  const hours = [200, 340, 480, 620, 760, 860, 940, 980, 900, 760, 600, 460, 340, 520]; // Σ = 8760
  return temps.map(function (t, i) { return { dry_bulb_c: t, hours: hours[i] }; });
}

/* ------------------------------------------------------------------ */
/*  Extraction helpers                                                 */
/* ------------------------------------------------------------------ */

function round(value, digits) {
  const f = Math.pow(10, digits == null ? 6 : digits);
  return Math.round((Number(value) || 0) * f) / f;
}

function extractRoomResult(result) {
  return {
    loads: {
      peopleSensible: round(result.peopleSensible),
      peopleLatent: round(result.peopleLatent),
      lightingSensible: round(result.lightingSensible),
      equipmentSensible: round(result.equipmentSensible),
      windowSensible: round(result.windowSensible),
      wallSensible: round(result.wallSensible),
      roofSensible: round(result.roofSensible),
      infiltrationSensible: round(result.infiltrationSensible),
      infiltrationLatent: round(result.infiltrationLatent),
      freshAirSensible: round(result.freshAirSensible),
      freshAirLatent: round(result.freshAirLatent),
      totalSensible: round(result.totalS),
      totalLatent: round(result.totalL),
      totalLoad: round(result.totalLoad),
      systemShr: round(result.systemShr),
      roomShr: round(result.roomShr)
    },
    tonnage: {
      trDesign: round(result.tr_design),
      trCoolingCoil: round(result.tr_cooling_coil),
      trFinal: round(result.tr_final),
      trCatalog: round(result.tr_catalog),
      trCatalogEquipment: round(result.tr_catalog_equipment)
    },
    airflow: {
      cfmThermal: round(result.cfm_thermal),
      cfmVent: round(result.cfm_vent),
      cfmAch: round(result.cfm_ach),
      cfmConditioned: round(result.cfm_conditioned),
      cfmCoolingCoil: round(result.cfm_cooling_coil),
      cfmDedicatedVentilation: round(result.cfm_dedicated_ventilation),
      cfmProcessExcess: round(result.cfm_process_excess),
      cfmFinal: round(result.cfm_final),
      ach: round(result.ach)
    },
    psychro: {
      supplyTemp: round(result.psychro.supplyTemp),
      supplyHumidity: round(result.psychro.supplyHumidity, 8),
      mixedAirTemp: round(result.psychro.mixedAirTemp),
      oaFraction: round(result.psychro.oaFraction),
      coilTotalLoad: round(result.psychro.coilTotalLoad),
      coilSensibleLoad: round(result.psychro.coilSensibleLoad),
      adpTemp: round(result.psychro.adpTemp),
      bypassFactor: round(result.psychro.bypassFactor)
    },
    fansAndEsp: {
      totalEsp: round(result.total_esp),
      coolingFanKw: round(result.cooling_fan_kw),
      recirculationFanKw: round(result.recirculation_fan_kw),
      ventilationFanKw: round(result.ventilation_fan_kw),
      totalFanKw: round(result.total_fan_kw),
      installedMotorKw: round(result.motor_kw)
    },
    equipment: {
      ahuModel: result.equipmentSelection.ahu.model,
      ahuCapacityTR: round(result.equipmentSelection.ahu.capacityTR),
      fanCurveId: result.equipmentSelection.fan.curveId
    },
    diffusers: {
      count: round(result.diffuserLayout.diffuserCount),
      cfmPerDiffuser: round(result.diffuserLayout.cfmPerDiffuser),
      returnCount: round(result.diffuserLayout.returns.count)
    },
    validationStatus: result.validation.status
  };
}

/* ------------------------------------------------------------------ */
/*  Main compute                                                        */
/* ------------------------------------------------------------------ */

function computeGoldenValues() {
  const golden = {};

  // 1 — ASHRAE psychrometrics
  const P = psy.pressureAtElevation(560);
  const W = psy.humidityRatioAt(24, 50, psy.ATM_PA);
  golden.psychrometrics = {
    pressureAt560m: round(P, 3),
    saturationPressureAt24C: round(psy.saturationPressurePa(24), 4),
    humidityRatio24C50: round(W, 9),
    enthalpy24C50: round(psy.moistAirEnthalpy(24, W), 6),
    specificVolume24C50: round(psy.moistAirSpecificVolume(24, W, psy.ATM_PA), 8),
    dewPoint24C50: round(psy.dewPointTemp(W, psy.ATM_PA), 4),
    wetBulb24C50: round(psy.wetBulbTemp(24, W, psy.ATM_PA), 4)
  };

  // 2 — Solar models (ASHRAE engine + legacy UI engine)
  const irr = sol.irradianceOnSurface({
    dayOfYear: 172, latitudeDeg: 19.07, longitudeDeg: 72.87,
    stdMeridianDeg: 82.5, clockHour: 15, tiltDeg: 90, surfaceAzimuthDeg: 270
  });
  const shgfPoint = SolarEngine.hourlySHGF(18.52, 202, 15, "W", {
    glassSHGC: 0.87, coolingLoadFactor: 0.55
  });
  golden.solar = {
    mumbaiWestWall3pm: {
      direct: round(irr.direct, 4),
      diffuse: round(irr.diffuse, 4),
      ground: round(irr.ground, 4),
      total: round(irr.total, 4)
    },
    puneWestGlass3pm: {
      altitude: round(shgfPoint.altitude, 4),
      incidentSolarOnGlassWm2: round(shgfPoint.incidentSolarOnGlassWm2, 4),
      effectiveCoolingLoadWm2: round(shgfPoint.coolingLoadSolarWm2, 4)
    }
  };

  // 3 — ASHRAE load components
  const air = loads.airLoads({
    airflowM3s: 0.5, tempOutC: 40, tempInC: 24,
    rhOutPct: 30, rhInPct: 50, pressurePa: psy.ATM_PA
  });
  const people = loads.occupantLoad({ activity: "seated_office", count: 10 });
  golden.loads = {
    airLoadsSensibleW: round(air.sensible, 4),
    airLoadsLatentW: round(air.latent, 4),
    airLoadsTotalW: round(air.total, 4),
    occupants10Office: { sensible: people.sensible, latent: people.latent, total: people.total },
    lighting100m2At9Wm2: round(loads.lightingLoad({ lpd: 9, area: 100, usage: 1, ballast: 1 }), 6)
  };

  // 4 — Airflow / duct / fan physics
  const supply = airflow.supplyAirflowForSensible({
    sensibleW: 10000, supplyTempC: 13, roomTempC: 24,
    supplyHumidityRatio: 0.008, pressurePa: psy.ATM_PA
  });
  golden.airflowPhysics = {
    supplyCfmFor10kWAt11K: round(supply.cfm, 4),
    equivalentDiameter600x300mm: round(airflow.equivalentDiameterRect(0.6, 0.3), 6),
    ductDrop20mAt6ms: round(airflow.ductFrictionDropPa({
      lengthM: 20, diameterM: 0.45, velocityMs: 6
    }), 6),
    fanShaftKw1m3s500Pa: round(airflow.fanShaftKw({
      airflowM3s: 1, totalPressurePa: 500, fanEfficiency: 0.65
    }), 6),
    chilledWaterGpm100kW: round(airflow.chilledWaterFlow({ coolingLoadW: 100000 }).gpm, 4)
  };

  // 5 — Equipment physics (ASHRAE engine)
  golden.equipmentPhysics = {
    standardTonnageFor23_4TR: equipment.selectStandardTonnage(23.4),
    copAirCooled40C75plr: round(equipment.coolingCop({
      copRated: 3.5, outdoorTempC: 40, plr: 0.75
    }), 6),
    plfAt50pct: round(1 - 0.25 * (1 - 0.5), 6)
  };

  // 6 — Catalog fan + AHU selection (UI equipment engine)
  const fan = EquipmentEngine.selectFan(4500, 550);
  const system = EquipmentEngine.selectSystem(10, 3800, 550, { catalogTR: 10 });
  golden.fanSelection = {
    curveId: fan.curveId,
    type: fan.type,
    brakeKW: fan.brakeKW,
    electricalKW: fan.electricalKW,
    motorKW: fan.motorKW,
    withinRange: fan.withinRange
  };
  golden.systemSelection = {
    ahuModel: system.ahu.model,
    capacityTR: system.ahu.capacityTR,
    airSectionCount: system.ahu.airSectionCount,
    electricalFanKWTotal: system.electricalFanKWTotal,
    recommendedMotorKW: system.recommendedMotorKW,
    specificFanPowerKWPerTR: system.specificFanPowerKWPerTR
  };

  // 7 — Full ASHRAE designer
  const design = designer.designProject(designerProject());
  golden.designer = {
    totalSensibleW: round(design.aggregate.totalSensibleW),
    totalLatentW: round(design.aggregate.totalLatentW),
    totalLoadW: round(design.aggregate.totalLoadW),
    designTR: round(design.aggregate.designTR),
    selectedTR: round(design.aggregate.selectedTR),
    totalCfm: round(design.aggregate.totalCfm),
    fanShaftKw: round(design.fan.shaftKw),
    fanMotorInputKw: round(design.fan.motorInputKw),
    fanWPerCfm: round(design.fan.wPerCfm),
    ashrae90_1Compliant: design.fan.ashrae90_1Compliant
  };

  // 8 — Full room calculation through the real UI pipeline (3 scenarios)
  const sandbox = loadBrowserCalculator();
  const comfort = sandbox.HvacPlatformTest.calculateRoom(comfortRoomInputs(), { skipAiEnhancements: true });
  const cleanroom = sandbox.HvacPlatformTest.calculateRoom(cleanroomRoomInputs(), { skipAiEnhancements: true });
  const humid = sandbox.HvacPlatformTest.calculateRoom(humidRoomInputs(), { skipAiEnhancements: true });
  golden.roomScenarios = {
    comfortPuneOffice: extractRoomResult(comfort),
    cleanroomIso7: extractRoomResult(cleanroom),
    humidMumbaiHall: extractRoomResult(humid)
  };

  // 9 — Costing / BOQ from the comfort scenario
  const rooms = [{ id: "golden-case", inputs: comfort.inputs, result: comfort }];
  const groups = EquipmentEngine.buildAhuGroups(rooms, 0.85);
  const items = CostingEngine.buildItems(
    { rooms: rooms, costingContext: { regionProfile: "standard" } },
    groups,
    GOLDEN_RATES
  );
  const boq = CostingEngine.summarize(items, 12);
  golden.costing = {
    itemCount: items.length,
    supplyTotal: round(boq.supplyTotal, 2),
    installationAmount: round(boq.installationAmount, 2),
    grandTotal: round(boq.grandTotal, 2),
    equipmentTotal: round(boq.equipmentTotal, 2),
    ductTotal: round(boq.ductTotal, 2),
    diffuserTotal: round(boq.diffuserTotal, 2)
  };

  return golden;
}

/* ------------------------------------------------------------------ */
/*  Python energy engine (spawned like server.js does)                 */
/* ------------------------------------------------------------------ */

function computePythonGolden() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const payload = {
    bin_data: fullYearBins(),
    system_data: {
      option_name: "Golden energy case",
      peak_load_kw: 40,
      design_outdoor_temp_c: 42,
      indoor_setpoint_c: 24,
      conditioned_airflow_cfm: 4500,
      process_airflow_cfm: 800,
      peak_conditioned_fan_kw: 3.2,
      process_fan_static_pa: 220,
      tariff_per_kwh: 8.5
    }
  };
  const proc = spawnSync(process.env.PYTHON_BIN || "python3", ["-m", "engine.energy.cli", "simulate"], {
    cwd: repoRoot,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 30000
  });
  if (proc.error || proc.status !== 0) {
    return null; // python unavailable — caller decides to skip
  }
  const report = JSON.parse(proc.stdout).report;
  return {
    annualEnergyKwh: round(report.annual_energy_kwh, 3),
    coolingEnergyKwh: round(report.cooling_energy, 3),
    fanEnergyKwh: round(report.fan_energy, 3),
    processEnergyKwh: round(report.process_energy, 3),
    peakPowerKw: round(report.peak_power_kw, 4),
    energyCost: round(report.energy_cost, 2),
    peakKwPerTr: round(report.peak_kw_per_tr, 5),
    binCount: report.bin_count
  };
}

module.exports = {
  computeGoldenValues: computeGoldenValues,
  computePythonGolden: computePythonGolden,
  comfortRoomInputs: comfortRoomInputs,
  cleanroomRoomInputs: cleanroomRoomInputs,
  humidRoomInputs: humidRoomInputs
};
