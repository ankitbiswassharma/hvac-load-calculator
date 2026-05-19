/**
 * Full-design generator.
 *
 * Given a project context (rooms, climate, design intent), the designer
 * produces a deterministic, fully sized HVAC system: tonnage, supply CFM,
 * duct mains, fan / pump, equipment selection, and KPI rollup.
 *
 * The AI layer in server.js uses this as the *engine of truth*: the model
 * proposes structured input variants, the designer computes them, and the
 * results — never the AI's prose — define the deliverable. This is what
 * the user means by "AI returns the correct design, not just reviews".
 *
 * Inputs (project): see designProject().
 */
"use strict";

const psy = require("./psychrometrics");
const solar = require("./solar");
const loads = require("./loads");
const af = require("./airflow");
const eq = require("./equipment");

function num(v, d) { const x = Number(v); return Number.isFinite(x) ? x : d; }

/**
 * Compute the full design for a single room.
 *
 * room: {
 *   name, areaM2, ceilingHeightM, occupants, activity,
 *   lpd (W/m²), epd (W/m²), equipmentUsage,
 *   walls: [{ area, U, orientation, alpha?, ho? }],
 *   roof:  { area, U, alpha?, ho?, dR? }   // optional
 *   floor: { area, U }                      // optional, T_in≈T_below
 *   windows: [{ area, U, shgcN?, sc?, iac?, orientation, tiltDeg? }],
 *   infiltrationAch, ventilationCfmPerPerson, ventilationCfmPerM2,
 *   safetyFactor (default 1.10), setpointC (default 24), setpointRh (default 50)
 * }
 *
 * climate: {
 *   latitudeDeg, longitudeDeg, stdMeridianDeg,
 *   designOutdoorDbC, designOutdoorWbC, designDayOfYear,
 *   designClockHour, elevationM
 * }
 */
function designRoom(room, climate) {
  const setpoint = num(room.setpointC, 24);
  const setpointRh = num(room.setpointRhPct, 50);
  const elev = num(climate.elevationM, 0);
  const P = psy.pressureAtElevation(elev);
  const T_out = num(climate.designOutdoorDbC, 35);
  const T_wb = num(climate.designOutdoorWbC, 25);
  const RH_out = Math.min(100, Math.max(0,
    Number.isFinite(climate.designOutdoorRhPct)
      ? climate.designOutdoorRhPct
      : 100 * psy.saturationPressurePa(T_wb) / psy.saturationPressurePa(T_out)
  ));
  const day = num(climate.designDayOfYear, 172); // ~ summer solstice (N hemi)
  const clockHour = num(climate.designClockHour, 15); // 3 PM peak

  const orientationAzimuth = {
    N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315
  };

  const components = [];
  let UA = 0;

  // -------- Walls
  for (const w of (room.walls || [])) {
    UA += (w.U || 0) * (w.area || 0);
    const ori = orientationAzimuth[String(w.orientation || "S").toUpperCase()];
    const az = Number.isFinite(ori) ? ori : 180;
    const irr = solar.irradianceOnSurface({
      dayOfYear: day,
      latitudeDeg: num(climate.latitudeDeg, 19),
      longitudeDeg: num(climate.longitudeDeg, 73),
      stdMeridianDeg: num(climate.stdMeridianDeg, 82.5),
      clockHour: clockHour,
      tiltDeg: 90,
      surfaceAzimuthDeg: az
    });
    const q = loads.sunExposedConductionLoad({
      U: w.U, area: w.area, tempInC: setpoint, tempOutC: T_out,
      Et: irr.total, alpha: num(w.alpha, 0.7), ho: num(w.ho, 17), dR: 0
    });
    components.push({ kind: "wall_" + (w.orientation || "S"), sensible: q, latent: 0 });
  }

  // -------- Roof
  if (room.roof && room.roof.area) {
    UA += (room.roof.U || 0) * room.roof.area;
    const irr = solar.irradianceOnSurface({
      dayOfYear: day,
      latitudeDeg: num(climate.latitudeDeg, 19),
      longitudeDeg: num(climate.longitudeDeg, 73),
      stdMeridianDeg: num(climate.stdMeridianDeg, 82.5),
      clockHour: clockHour,
      tiltDeg: 0,
      surfaceAzimuthDeg: 180
    });
    const q = loads.sunExposedConductionLoad({
      U: room.roof.U, area: room.roof.area,
      tempInC: setpoint, tempOutC: T_out,
      Et: irr.total,
      alpha: num(room.roof.alpha, 0.85),
      ho: num(room.roof.ho, 17),
      dR: num(room.roof.dR, 63)
    });
    components.push({ kind: "roof", sensible: q, latent: 0 });
  }

  // -------- Floor (slab-on-grade or above-conditioned)
  if (room.floor && room.floor.area) {
    UA += (room.floor.U || 0) * room.floor.area;
    const T_below = num(room.floor.tempBelowC, 20);
    const q = loads.conductionLoad({
      U: room.floor.U, area: room.floor.area,
      tempOutC: T_below, tempInC: setpoint
    });
    components.push({ kind: "floor", sensible: q, latent: 0 });
  }

  // -------- Windows
  for (const win of (room.windows || [])) {
    UA += (win.U || 0) * (win.area || 0);
    const ori = orientationAzimuth[String(win.orientation || "S").toUpperCase()];
    const az = Number.isFinite(ori) ? ori : 180;
    const irr = solar.irradianceOnSurface({
      dayOfYear: day,
      latitudeDeg: num(climate.latitudeDeg, 19),
      longitudeDeg: num(climate.longitudeDeg, 73),
      stdMeridianDeg: num(climate.stdMeridianDeg, 82.5),
      clockHour: clockHour,
      tiltDeg: num(win.tiltDeg, 90),
      surfaceAzimuthDeg: az
    });
    const result = loads.windowLoad({
      irradiance: irr, U: win.U, area: win.area,
      tempOutC: T_out, tempInC: setpoint,
      shgcN: win.shgcN, sc: win.sc,
      iac: num(win.iac, 1.0),
      sunlitFrac: num(win.sunlitFrac, 1.0)
    });
    components.push({ kind: "window_" + (win.orientation || "S"), sensible: result.total, latent: 0 });
  }

  // -------- Internal: occupants
  const peopleLoad = loads.occupantLoad({
    activity: room.activity || "seated_office",
    count: num(room.occupants, 0)
  });
  components.push({ kind: "people", sensible: peopleLoad.sensible, latent: peopleLoad.latent });

  // -------- Lighting
  const lightW = loads.lightingLoad({
    lpd: num(room.lpd, 10),
    area: num(room.areaM2, 0),
    usage: num(room.lightingUsage, 1.0),
    ballast: num(room.lightingBallast, 1.0)
  });
  components.push({ kind: "lighting", sensible: lightW, latent: 0 });

  // -------- Equipment / plug loads
  const equipLoad = loads.equipmentLoad({
    epd: num(room.epd, 8),
    area: num(room.areaM2, 0),
    usage: num(room.equipmentUsage, 0.7),
    sensFrac: num(room.equipmentSensibleFrac, 1.0)
  });
  components.push({ kind: "equipment", sensible: equipLoad.sensible, latent: equipLoad.latent });

  // -------- Infiltration
  const volumeM3 = num(room.areaM2, 0) * num(room.ceilingHeightM, 3);
  const infilM3s = loads.airflowFromACH(num(room.infiltrationAch, 0.4), volumeM3);
  const infil = loads.airLoads({
    airflowM3s: infilM3s,
    tempOutC: T_out, tempInC: setpoint,
    rhOutPct: RH_out, rhInPct: setpointRh,
    pressurePa: P
  });
  components.push({ kind: "infiltration", sensible: infil.sensible, latent: infil.latent });

  // -------- Ventilation (ASHRAE 62.1 minimum + outdoor air load)
  const cfmPerPerson = num(room.ventilationCfmPerPerson, 5); // 62.1 default office
  const cfmPerM2 = num(room.ventilationCfmPerM2, 0.6);
  const ventCfm = cfmPerPerson * num(room.occupants, 0)
                + cfmPerM2 * num(room.areaM2, 0);
  const ventM3s = ventCfm * af.CFM_TO_M3S;
  const vent = loads.airLoads({
    airflowM3s: ventM3s,
    tempOutC: T_out, tempInC: setpoint,
    rhOutPct: RH_out, rhInPct: setpointRh,
    pressurePa: P
  });
  components.push({ kind: "ventilation", sensible: vent.sensible, latent: vent.latent });

  // -------- Rollup
  const rollup = loads.rollupRoomLoad({
    components: components,
    safetyFactor: num(room.safetyFactor, 1.10)
  });

  // Convert UA to include ventilation+infiltration for the bin method
  const W_out = psy.humidityRatioAt(T_out, RH_out, P);
  const v_out = psy.moistAirSpecificVolume(T_out, W_out, P);
  const m_dot_oa = (infilM3s + ventM3s) / Math.max(v_out, 0.1);
  UA = UA + m_dot_oa * 1006; // add air-side conductance W/K

  // -------- Sizing
  const supplyAir = af.supplyAirflowForSensible({
    sensibleW: rollup.sensibleW,
    supplyTempC: num(room.supplyTempC, 13),
    roomTempC: setpoint,
    pressurePa: P
  });

  const designTR = rollup.totalW / (eq.KW_PER_TR * 1000);
  const standardTR = eq.selectStandardTonnage(designTR);

  return {
    room: room.name || "room",
    components: components.map(c => ({
      kind: c.kind,
      sensibleW: Math.round(c.sensible),
      latentW: Math.round(c.latent || 0)
    })),
    roomLoad: {
      sensibleW: Math.round(rollup.sensibleW),
      latentW: Math.round(rollup.latentW),
      totalW: Math.round(rollup.totalW),
      shr: Number(rollup.shr.toFixed(3)),
      safetyFactor: rollup.safetyFactor
    },
    designTR: Number(designTR.toFixed(2)),
    selectedTR: standardTR,
    UA_W_per_K: Math.round(UA),
    supplyAir: {
      cfm: Math.round(supplyAir.cfm),
      m3s: Number(supplyAir.m3s.toFixed(3)),
      supplyTempC: num(room.supplyTempC, 13)
    },
    psychrometric: {
      outdoorDbC: T_out,
      outdoorWbC: T_wb,
      outdoorWPerKg: Number(W_out.toFixed(4)),
      indoorDbC: setpoint,
      indoorRhPct: setpointRh
    }
  };
}

/**
 * Design an entire project (multiple rooms) and roll up to system level.
 *   project: { name, rooms: [room], climate: {...}, designIntent: {...} }
 *   designIntent: {
 *     systemType: "vrf"|"chiller_ahu"|"split_dx"|"vav",
 *     diversityFactor (load only, 0–1, default 0.85 for multi-zone),
 *     fanEfficiency, motorEfficiency, externalSpPa, mainDuctVelocityMs
 *   }
 */
function designProject(project) {
  const rooms = (project.rooms || []).map(r => designRoom(r, project.climate || {}));
  const totalLoadW = rooms.reduce((a, r) => a + r.roomLoad.totalW, 0);
  const totalSensibleW = rooms.reduce((a, r) => a + r.roomLoad.sensibleW, 0);
  const totalLatentW = rooms.reduce((a, r) => a + r.roomLoad.latentW, 0);
  const totalCfm = rooms.reduce((a, r) => a + r.supplyAir.cfm, 0);
  const designTR = totalLoadW / (eq.KW_PER_TR * 1000);
  const diversity = num((project.designIntent || {}).diversityFactor, rooms.length > 1 ? 0.85 : 1.0);
  const diversifiedLoadW = totalLoadW * diversity;
  const diversifiedTR = diversifiedLoadW / (eq.KW_PER_TR * 1000);
  const selectedTR = eq.selectStandardTonnage(diversifiedTR);

  // Fan sizing
  const intent = project.designIntent || {};
  const externalSpPa = num(intent.externalSpPa, 500); // 2 in WG default
  const fanEta = num(intent.fanEfficiency, 0.65);
  const motorEta = num(intent.motorEfficiency, 0.92);
  const airflowM3s = totalCfm * af.CFM_TO_M3S;
  const brake = af.fanShaftKw({ airflowM3s, totalPressurePa: externalSpPa, fanEfficiency: fanEta });
  const motorKwInput = af.motorElectricalKw({ brakeKw: brake, motorEfficiency: motorEta });
  const selectedMotorKw = af.selectNextMotorKw({ brakeKw: brake, motorEfficiency: motorEta, serviceFactor: 1.15 });
  const fanLimit = af.ashrae90_1FanPowerLimit({
    airflowCfm: totalCfm, motorInputKw: motorKwInput,
    isVAV: String(intent.systemType || "") === "vav"
  });

  // Chilled-water pump (if applicable)
  const isWater = ["chiller_ahu", "vav", "central_ahu"].includes(String(intent.systemType || ""));
  let pump = null;
  if (isWater) {
    const flow = af.chilledWaterFlow({ coolingLoadW: diversifiedLoadW, deltaTC: num(intent.coilDeltaTC, 6) });
    const head = num(intent.pumpHeadM, 25);
    const pumpKw = af.pumpShaftKw({ flowM3s: flow.m3s, headM: head, etaPump: num(intent.pumpEfficiency, 0.70) });
    pump = {
      flowLps: Number(flow.lps.toFixed(2)),
      flowGpm: Math.round(flow.gpm),
      headM: head,
      shaftKw: Number(pumpKw.toFixed(2)),
      electricalKw: Number(af.motorElectricalKw({ brakeKw: pumpKw, motorEfficiency: motorEta }).toFixed(2))
    };
  }

  return {
    projectName: project.name || "Project",
    systemType: intent.systemType || "vrf",
    rooms: rooms,
    aggregate: {
      diversityFactor: diversity,
      totalSensibleW: Math.round(totalSensibleW),
      totalLatentW: Math.round(totalLatentW),
      totalLoadW: Math.round(totalLoadW),
      diversifiedLoadW: Math.round(diversifiedLoadW),
      designTR: Number(designTR.toFixed(2)),
      diversifiedTR: Number(diversifiedTR.toFixed(2)),
      selectedTR: selectedTR,
      totalCfm: Math.round(totalCfm),
      totalM3s: Number(airflowM3s.toFixed(3))
    },
    fan: {
      externalSpPa: externalSpPa,
      fanEfficiency: fanEta,
      shaftKw: Number(brake.toFixed(2)),
      motorInputKw: Number(motorKwInput.toFixed(2)),
      selectedMotorKw: selectedMotorKw,
      wPerCfm: Number(fanLimit.wPerCfm.toFixed(2)),
      ashrae90_1Limit: fanLimit.limitWPerCfm,
      ashrae90_1Compliant: fanLimit.compliant
    },
    pump: pump,
    generatedAt: new Date().toISOString(),
    engineVersion: require("./index").version
  };
}

/**
 * Generate ranked design alternatives by varying a small set of intent
 * parameters and re-running the engine. Each option is a complete design.
 */
function designAlternatives(project) {
  const intent = project.designIntent || {};
  const variants = [
    { key: "cost_effective", label: "Cost-effective",
      patch: { systemType: "split_dx", externalSpPa: 350, fanEfficiency: 0.55 } },
    { key: "balanced",       label: "Balanced",
      patch: { systemType: "vrf", externalSpPa: 500, fanEfficiency: 0.65 } },
    { key: "efficient",      label: "High-efficiency",
      patch: { systemType: "chiller_ahu", externalSpPa: 600, fanEfficiency: 0.72,
               pumpEfficiency: 0.78, coilDeltaTC: 7 } }
  ];

  const options = variants.map(v => {
    const variantProject = Object.assign({}, project, {
      designIntent: Object.assign({}, intent, v.patch)
    });
    const design = designProject(variantProject);
    // simple KPI score: lower W/cfm and lower TR_oversize win
    const oversize = design.aggregate.selectedTR > 0
      ? Math.abs(design.aggregate.selectedTR - design.aggregate.diversifiedTR) / design.aggregate.selectedTR
      : 1;
    const score = 100
      - 25 * Math.min(1, design.fan.wPerCfm / (design.fan.ashrae90_1Limit || 1.1))
      - 30 * oversize
      - 10 * (design.fan.ashrae90_1Compliant ? 0 : 1);
    return {
      key: v.key,
      label: v.label,
      design: design,
      score: Math.max(0, Math.round(score))
    };
  });

  options.sort((a, b) => b.score - a.score);
  return {
    preferredKey: options[0] ? options[0].key : null,
    options: options
  };
}

/**
 * Auto-fix loop: takes a project that fails some constraint, mutates the
 * intent in bounded ways, and returns the first variant that satisfies
 * the constraints. Constraints can include:
 *
 *   maxFanWPerCfm, maxTROversizingPct, minSHR, isoClass (cleanroom)
 */
function autoFix(project, constraints = {}) {
  const log = [];
  const maxIter = 8;
  const intent = Object.assign({}, project.designIntent || {});
  let current = Object.assign({}, project, { designIntent: intent });
  for (let i = 0; i < maxIter; i++) {
    const design = designProject(current);
    const fails = [];
    if (constraints.maxFanWPerCfm && design.fan.wPerCfm > constraints.maxFanWPerCfm) {
      fails.push("fanWPerCfm");
      // mitigate: increase fan efficiency, reduce ESP if possible
      intent.fanEfficiency = Math.min(0.78, num(intent.fanEfficiency, 0.65) + 0.04);
      if (num(intent.externalSpPa, 500) > 350) {
        intent.externalSpPa = num(intent.externalSpPa, 500) - 50;
      }
    }
    if (constraints.maxTROversizingPct) {
      const over = (design.aggregate.selectedTR - design.aggregate.diversifiedTR) / Math.max(design.aggregate.diversifiedTR, 1) * 100;
      if (over > constraints.maxTROversizingPct) {
        fails.push("oversizing");
        intent.diversityFactor = Math.max(0.7, num(intent.diversityFactor, 0.85) - 0.05);
      }
    }
    log.push({ iter: i, fails: fails, intent: Object.assign({}, intent) });
    if (fails.length === 0) {
      return { success: true, iterations: i + 1, design: design, log: log };
    }
    current = Object.assign({}, project, { designIntent: intent });
  }
  return { success: false, iterations: maxIter, design: designProject(current), log: log };
}

module.exports = {
  designRoom: designRoom,
  designProject: designProject,
  designAlternatives: designAlternatives,
  autoFix: autoFix
};
