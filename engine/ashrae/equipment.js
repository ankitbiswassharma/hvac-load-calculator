/**
 * Equipment selection, performance maps, and bin energy.
 *
 * Implements:
 *   - Standard tonnage rounding (AHRI 210/240 size ladder)
 *   - Chiller / DX COP correction with outdoor / condensing temperature
 *     (linear cooling-tower or air-cooled curve, ASHRAE 90.1 reference)
 *   - Part-load factor (IPLV-style, AHRI 550/590)
 *   - Bin energy method (ASHRAE Fundamentals Ch 19)
 *
 * SI throughout.
 */
"use strict";

const airflow = require("./airflow");
const psy = require("./psychrometrics");

const KW_PER_TR = 3.5168525;          // 1 ton refrigeration = 3.517 kW
const STANDARD_TONS = [
  0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8.5, 10,
  12.5, 15, 20, 25, 30, 40, 50, 60, 80, 100, 125, 150, 200,
  250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000
];

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

/** Round design TR up to nearest catalog tonnage. */
function selectStandardTonnage(requiredTR) {
  if (!Number.isFinite(requiredTR) || requiredTR <= 0) return 0;
  for (const t of STANDARD_TONS) {
    if (t >= requiredTR - 1e-9) return t;
  }
  // beyond table: round up to nearest 100
  return Math.ceil(requiredTR / 100) * 100;
}

/**
 * Outdoor-temperature-dependent chiller / DX cooling COP.
 *
 *   COP(T_oa, PLR) = COP_rated · f_T(T_oa) · f_PLF(PLR)
 *
 *   f_T = max(0.30, 1 - kT · (T_oa - T_ref))
 *   f_PLF defaults to AHRI 210/240 part-load factor: f_PLF = 1 - 0.25·(1-PLR)
 *
 *   kT       — sensitivity, /K. 0.022 for water-cooled, 0.030 for air-cooled.
 *   T_ref    — rating outdoor or condensing wet-bulb, °C. AHRI uses 35 °C dry-bulb (air-cooled) or 29 °C ECWT (water).
 */
function coolingCop({
  copRated, outdoorTempC,
  rated_temp_c = 35, kT = 0.030, plr = 1.0,
  minCop = 1.5
}) {
  const fT = Math.max(0.30, 1 - kT * (outdoorTempC - rated_temp_c));
  const fPLF = 1 - 0.25 * (1 - clamp(plr, 0, 1));
  return Math.max(minCop, copRated * fT * fPLF);
}

/**
 * Heating COP for air-source heat pumps with defrost penalty below 5 °C.
 *
 *   COP(T_oa) = COP_rated · (1 - kT·(T_rated - T_oa)) · defrost
 *
 *   defrost = 0.85 for T_oa < -5 °C, 0.92 for −5..+5 °C, 1.00 above.
 */
function heatingCop({
  copRated, outdoorTempC, rated_temp_c = 8.3, kT = 0.025, minCop = 1.0
}) {
  const fT = Math.max(0.20, 1 - kT * (rated_temp_c - outdoorTempC));
  const defrost = outdoorTempC < -5 ? 0.85 : (outdoorTempC < 5 ? 0.92 : 1.0);
  return Math.max(minCop, copRated * fT * defrost);
}

/**
 * Continuous part-load factor for fan (cube law for VFD-driven VAV).
 * Returns power as fraction of rated.
 *   P/P_rated ≈ max(0.1, (Q/Q_rated)^2.8)
 * AHRI/ASHRAE uses 2.7–3.0 exponent — 2.8 is a defensible middle.
 */
function fanCubeLawPower(flowRatio, minRatio = 0.1) {
  const r = clamp(flowRatio, 0, 1);
  return Math.max(minRatio, Math.pow(r, 2.8));
}

/* ----------------------------------------------------------------- */
/*  Balance-point bin method                                          */
/* ----------------------------------------------------------------- */

/**
 * Balance point: outdoor temp at which Q_internal + Q_solar = UA·(T_in − T_oa).
 *   T_b = T_in − (Q_internal + Q_solar) / UA      [°C]
 *
 *   QInternalW — sum of internal gains (people + lighting + equip), W
 *   QSolarW    — solar through fenestration averaged over design period, W
 *   UA         — total envelope conductance, W/K (sum of U·A)
 */
function balancePoint({ tempInC, QInternalW, QSolarW, UA }) {
  if (UA <= 0) return tempInC;
  return tempInC - (QInternalW + QSolarW) / UA;
}

/**
 * Compute cooling/heating load at a given outdoor bin temperature using the
 * balance-point method.
 *
 * For cooling (T_oa > T_b): Q = UA·(T_oa − T_b) + latent_at_bin (if W field present)
 * For heating (T_oa < T_b): Q = UA·(T_b − T_oa)
 *
 * latentFactor — multiplier on sensible to estimate latent in humid climates.
 */
function loadAtBin({
  outdoorTempC, balanceTempC, UA,
  outdoorWetBulbC, indoorTempC, indoorRhPct = 50,
  pressurePa, latentEnabled = true
}) {
  const P = pressurePa || psy.ATM_PA;
  const sensible = UA * (outdoorTempC - balanceTempC);
  if (sensible >= 0) {
    // Cooling
    let latent = 0;
    if (latentEnabled && Number.isFinite(outdoorWetBulbC) && Number.isFinite(indoorTempC)) {
      const W_in  = psy.humidityRatioAt(indoorTempC, indoorRhPct, P);
      const W_out_sat = psy.saturationHumidityRatio(outdoorWetBulbC, P);
      // crude: latent proportional to (W_out_sat - W_in) at average air volume
      const dW = Math.max(0, W_out_sat - W_in);
      latent = Math.max(0, UA * 0.6 * dW * 2501); // empirical reduction
    }
    return { sensible: sensible, latent: latent, total: sensible + latent, mode: "cooling" };
  }
  return { sensible: 0, latent: 0, total: -sensible, mode: "heating" };
}

/**
 * Bin-method annual energy.
 *
 *   bins:        [{tempC, wetBulbC?, hours}]  must sum to 8760 hrs
 *   designLoadW: peak cooling design load, W (used to size chiller)
 *   copRated:    rated COP of chiller at AHRI conditions
 *   UA:          envelope+ventilation thermal conductance, W/K
 *   indoorTempC: setpoint
 *   QInternalW, QSolarW: averaged internal + solar gains during occupied hrs
 *   isAirCooled: true → kT = 0.030, rated_temp 35 °C
 */
function binEnergy({
  bins, copRated, UA, indoorTempC, QInternalW, QSolarW,
  fanPeakKw, processFanPeakKw = 0,
  isAirCooled = true, pressurePa,
  rated_temp_c, kT
}) {
  const t_ref = rated_temp_c != null ? rated_temp_c : (isAirCooled ? 35 : 29);
  const k = kT != null ? kT : (isAirCooled ? 0.030 : 0.022);
  const T_b = balancePoint({ tempInC: indoorTempC, QInternalW, QSolarW, UA });
  // Capacity at rated point (used to compute PLR each bin)
  // Find peak cooling bin to derive a reference capacity:
  let peakCoolingW = 0;
  for (const b of bins || []) {
    if (b.tempC > T_b) {
      const Q = UA * (b.tempC - T_b);
      if (Q > peakCoolingW) peakCoolingW = Q;
    }
  }
  // Capacity = peakCoolingW * sizing safety
  const capacityW = peakCoolingW * 1.10;

  let totalHours = 0;
  let totalCoolingKwh = 0;
  let totalChillerKwh = 0;
  let totalFanKwh = 0;
  let totalProcessFanKwh = 0;
  let totalLatentKwh = 0;
  for (const b of bins || []) {
    const h = Math.max(0, b.hours || 0);
    totalHours += h;
    const load = loadAtBin({
      outdoorTempC: b.tempC,
      balanceTempC: T_b,
      UA: UA,
      outdoorWetBulbC: b.wetBulbC,
      indoorTempC: indoorTempC,
      indoorRhPct: 50,
      pressurePa: pressurePa
    });
    if (load.mode !== "cooling") continue;
    const plr = capacityW > 0 ? Math.min(1, load.total / capacityW) : 0;
    if (plr <= 0) continue;
    const cop = coolingCop({ copRated, outdoorTempC: b.tempC, rated_temp_c: t_ref, kT: k, plr });
    const compressorKw = (load.total / 1000) / cop;
    totalChillerKwh += compressorKw * h;
    // Fan at part flow (VAV cube law). For CAV pass plr=1 externally.
    const fanRatio = airflow ? Math.pow(Math.max(plr, 0.4), 1.0) : plr; // CAV-ish
    const fanKw = (fanPeakKw || 0) * fanCubeLawPower(fanRatio);
    totalFanKwh += fanKw * h;
    totalProcessFanKwh += (processFanPeakKw || 0) * h;
    totalCoolingKwh += (load.total / 1000) * h;
    totalLatentKwh += (load.latent / 1000) * h;
  }
  const electricalKwh = totalChillerKwh + totalFanKwh + totalProcessFanKwh;
  return {
    balanceTempC: T_b,
    capacityW: capacityW,
    binHoursTotal: totalHours,
    coolingDeliveredKwh: totalCoolingKwh,
    latentDeliveredKwh: totalLatentKwh,
    chillerElectricalKwh: totalChillerKwh,
    fanElectricalKwh: totalFanKwh,
    processFanElectricalKwh: totalProcessFanKwh,
    totalElectricalKwh: electricalKwh,
    seasonalCop: totalChillerKwh > 0 ? totalCoolingKwh / totalChillerKwh : 0
  };
}

/**
 * Time-of-use tariff calculation. tariffSlots: [{startHr, endHr, ratePerKwh, demandRate?}]
 * If slots not provided, returns flat-rate cost.
 */
function tariffCost({ kwh, ratePerKwh, demandKw, demandRate, slots }) {
  if (slots && slots.length) {
    // Simplified: caller must already have per-slot kWh in slots[i].kwh
    let total = 0;
    for (const s of slots) {
      total += (s.kwh || 0) * (s.ratePerKwh || 0);
      if (s.demandKw && s.demandRate) total += s.demandKw * s.demandRate;
    }
    return total;
  }
  const energyCost = (kwh || 0) * (ratePerKwh || 0);
  const demandCost = (demandKw || 0) * (demandRate || 0) * 12; // monthly billing
  return energyCost + demandCost;
}

module.exports = {
  KW_PER_TR: KW_PER_TR,
  STANDARD_TONS: STANDARD_TONS,
  selectStandardTonnage: selectStandardTonnage,
  coolingCop: coolingCop,
  heatingCop: heatingCop,
  fanCubeLawPower: fanCubeLawPower,
  balancePoint: balancePoint,
  loadAtBin: loadAtBin,
  binEnergy: binEnergy,
  tariffCost: tariffCost
};
