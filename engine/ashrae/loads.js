/**
 * ASHRAE-correct load calculations.
 *
 * Provides:
 *   - conductionLoad     Q = U·A·ΔT  (or U·A·CLTD via sol-air for sun-exposed)
 *   - windowLoad         conductive + solar gain through fenestration
 *   - infiltrationLoads  sensible + latent loads from infiltration airflow
 *   - ventilationLoads   sensible + latent loads from outdoor-air ventilation
 *   - internalGains      occupants, lighting, equipment
 *   - peopleSensibleLatent table by activity
 *
 * All powers in W. Areas in m². Temperatures in °C. Humidity ratios kg/kg_da.
 * Airflow in m³/s.
 */
"use strict";

const psy = require("./psychrometrics");
const sol = require("./solar");

const RHO_W = 1000;      // kg/m³ water reference
const H_FG_0 = 2501e3;   // J/kg latent heat of vaporization at 0 °C

// ASHRAE 2017 Fundamentals Ch.18 Table 1 — adjusted heat gain at 24 °C (75 °F) room temp, W.
// Totals are used for energy balance; sensible+latent split drives coil SHR.
const PEOPLE_HEAT = {
  seated_quiet:   { total: 100, sensible:  60, latent:  40 },  // theater/classroom
  seated_office:  { total: 115, sensible:  65, latent:  50 },  // office work (was 117/65/52, totals corrected)
  seated_eating:  { total: 145, sensible:  75, latent:  70 },  // restaurant (was 144/75/69)
  light_industry: { total: 220, sensible: 100, latent: 120 },  // ✓
  moderate_work:  { total: 295, sensible: 130, latent: 165 },  // ✓
  heavy_work:     { total: 425, sensible: 170, latent: 255 },  // ✓
  athletic:       { total: 525, sensible: 210, latent: 315 }   // ✓
};

/* ------------------------------------------------------------------ */
/*  Envelope conduction                                                */
/* ------------------------------------------------------------------ */

/** Plain conduction: Q = U·A·(T_out − T_in), W. */
function conductionLoad({ U, area, tempOutC, tempInC }) {
  return Math.max(0, U) * Math.max(0, area) * ((tempOutC || 0) - (tempInC || 0));
}

/**
 * Sun-exposed opaque conduction using sol-air temperature.
 *   Q = U·A·(T_solair − T_in)
 *
 * Inputs:
 *   U, area, tempInC
 *   Et            — total solar incident on surface, W/m²
 *   tempOutC      — ambient dry-bulb, °C
 *   alpha, ho, dR — sol-air parameters (see solar.js)
 */
function sunExposedConductionLoad({
  U, area, tempInC, tempOutC, Et,
  alpha = 0.7, ho = 17, dR = 0
}) {
  const Tsa = sol.solAirTemperature({ tempOutC, Et, alpha, ho, dR });
  return Math.max(0, U) * Math.max(0, area) * (Tsa - (tempInC || 0));
}

/**
 * Window load: conductive + solar.
 *   irradiance     — irradiance components on glass (sol.irradianceOnSurface)
 *   U              — overall window U-value, W/(m²·K)
 *   area           — glass area, m²
 *   shgcN, sc, iac, sunlitFrac (see solar.js)
 *
 * Returns { conduction, solar, total } in W.
 */
function windowLoad({
  irradiance, U, area, tempOutC, tempInC,
  shgcN, sc, iac = 1.0, sunlitFrac = 1.0, shgcAngularCoeffs
}) {
  const cond = conductionLoad({ U, area, tempOutC, tempInC });
  const solarPerM2 = sol.windowSolarHeatGain({
    irradiance, shgcN, sc, iac, sunlitFrac, shgcAngularCoeffs
  });
  const solar = solarPerM2 * Math.max(0, area);
  return { conduction: cond, solar: solar, total: cond + solar };
}

/* ------------------------------------------------------------------ */
/*  Air-side loads: infiltration + ventilation                          */
/* ------------------------------------------------------------------ */

/**
 * Convert ACH to volumetric airflow (m³/s) given room volume (m³).
 */
function airflowFromACH(achPerHr, roomVolumeM3) {
  return Math.max(0, achPerHr) * Math.max(0, roomVolumeM3) / 3600;
}

/**
 * Infiltration / outdoor-air loads.
 *
 *   Q_sensible = m_dot_da · cp_moist · (T_out − T_in)              [W]
 *   Q_latent   = m_dot_da · (W_out − W_in) · (h_fg + 1.86·T_avg)   [W]
 *   Q_total    = m_dot_da · (h_out − h_in)                          [W]
 *
 * Inputs are SI. airflowM3s is volumetric outdoor air entering the space.
 */
function airLoads({
  airflowM3s, tempOutC, tempInC, rhOutPct, rhInPct, pressurePa
}) {
  const P = pressurePa || psy.ATM_PA;
  const flow = Math.max(0, airflowM3s);
  if (flow === 0) {
    return { sensible: 0, latent: 0, total: 0, massFlowDaKgs: 0 };
  }
  const W_out = psy.humidityRatioAt(tempOutC, rhOutPct, P);
  const W_in  = psy.humidityRatioAt(tempInC,  rhInPct,  P);
  const v_out = psy.moistAirSpecificVolume(tempOutC, W_out, P);
  // mass flow of DRY AIR entering (m³ of moist air × (1+W) / v gives kg moist;
  // dividing by (1+W) yields kg dry air; equivalent: m_dot_da = flow / v_out
  // when v is per kg dry air ASHRAE convention).
  const m_dot_da = flow / v_out;
  // ASHRAE Fundamentals Ch.1: for outdoor-air entering a space, cp is
  // evaluated at the incoming (outdoor) air state — using W_out, not an
  // average of W_out and W_in. The average understates cp in humid
  // climates and shifts sensible/latent split incorrectly. Total load is
  // exact via enthalpy; sensible uses this corrected cp.
  const cp = psy.cpMoistAir(W_out);
  const sensible = m_dot_da * cp * 1000 * ((tempOutC || 0) - (tempInC || 0)); // W
  const h_out = psy.moistAirEnthalpy(tempOutC, W_out);
  const h_in  = psy.moistAirEnthalpy(tempInC,  W_in);
  const total = m_dot_da * (h_out - h_in) * 1000; // W
  const latent = total - sensible;
  return {
    sensible: sensible,
    latent: latent,
    total: total,
    massFlowDaKgs: m_dot_da,
    humidityRatioOut: W_out,
    humidityRatioIn:  W_in
  };
}

/* ------------------------------------------------------------------ */
/*  Internal heat gains                                                 */
/* ------------------------------------------------------------------ */

/**
 * Occupant heat gain. ASHRAE Ch 18.
 *   activity: key in PEOPLE_HEAT
 *   count:    number of people present (after diversity)
 *   clo, met: optional — not used here, table values assume typical clo/met.
 * Returns { sensible, latent, total } in W.
 */
function occupantLoad({ activity = "seated_office", count = 0 }) {
  const g = PEOPLE_HEAT[activity] || PEOPLE_HEAT.seated_office;
  const n = Math.max(0, count);
  return {
    sensible: n * g.sensible,
    latent:   n * g.latent,
    total:    n * g.total
  };
}

/**
 * Lighting heat gain: Q = lpd · area · usage_factor · cu_factor.
 *
 *   lpd        — lighting power density, W/m²
 *   area       — m²
 *   usage      — diversity/utilization factor (0–1)
 *   ballast    — ballast/driver factor (1.0 for LED, 1.2 for older fluorescent)
 *
 * Lighting is all sensible.
 */
function lightingLoad({ lpd = 8, area, usage = 1.0, ballast = 1.0 }) {
  return Math.max(0, lpd) * Math.max(0, area) * usage * ballast;
}

/**
 * Equipment / plug load.
 *   epd      — equipment power density, W/m²  (or pass `kW` directly)
 *   kW       — direct connected kW (preferred for known equipment)
 *   area     — m² (used only when epd supplied)
 *   usage    — diversity (0–1)
 *   sensFrac — sensible fraction of total (default 1.0 for office; 0.85 kitchen)
 */
function equipmentLoad({ epd, kW, area, usage = 0.6, sensFrac = 1.0 }) {
  let totalW;
  if (Number.isFinite(kW)) {
    totalW = Math.max(0, kW) * 1000 * usage;
  } else {
    totalW = Math.max(0, epd || 0) * Math.max(0, area || 0) * usage;
  }
  const sens = totalW * Math.max(0, Math.min(1, sensFrac));
  return { sensible: sens, latent: totalW - sens, total: totalW };
}

/* ------------------------------------------------------------------ */
/*  Room-level rollup                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compose a room cooling design load from components.
 * Each component should already be in W and pre-classified into
 * { sensible, latent }. This function sums them with a safety factor
 * applied only once, at the room total.
 */
function rollupRoomLoad({ components, safetyFactor = 1.10 }) {
  let qs = 0, ql = 0;
  for (const c of (components || [])) {
    qs += Number(c.sensible) || 0;
    ql += Number(c.latent)   || 0;
  }
  const totalSensible = qs * safetyFactor;
  const totalLatent   = ql * safetyFactor;
  const totalCooling  = totalSensible + totalLatent;
  return {
    sensibleW: totalSensible,
    latentW:   totalLatent,
    totalW:    totalCooling,
    shr: totalCooling > 0 ? totalSensible / totalCooling : 1.0,
    safetyFactor: safetyFactor
  };
}

module.exports = {
  PEOPLE_HEAT: PEOPLE_HEAT,
  conductionLoad: conductionLoad,
  sunExposedConductionLoad: sunExposedConductionLoad,
  windowLoad: windowLoad,
  airflowFromACH: airflowFromACH,
  airLoads: airLoads,
  occupantLoad: occupantLoad,
  lightingLoad: lightingLoad,
  equipmentLoad: equipmentLoad,
  rollupRoomLoad: rollupRoomLoad
};
