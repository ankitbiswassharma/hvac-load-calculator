/**
 * ASHRAE Handbook of Fundamentals (2017) Ch. 1 — Psychrometrics.
 *
 * SI-only. All temperatures in °C, pressures in Pa, humidity ratios kg_w/kg_da,
 * enthalpies kJ/kg_da, specific volumes m³/kg_da.
 *
 * Equations referenced by ASHRAE Eq # are from Ch. 1, 2017 edition.
 */
"use strict";

const R_DA = 287.042;          // J/(kg·K), gas constant of dry air (ASHRAE Eq 1)
const R_W  = 461.524;          // J/(kg·K), gas constant of water vapor
const MW_RATIO = 0.621945;     // Mw/Ma  (18.01528 / 28.9645)
const ATM_PA = 101325;         // Pa, standard atmospheric pressure
const T_ZERO_K = 273.15;

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function isFiniteNumber(x) { return Number.isFinite(x); }

/** Atmospheric pressure at elevation (m) per U.S. Standard Atmosphere. */
function pressureAtElevation(elevationM) {
  const z = Math.max(0, elevationM || 0);
  return ATM_PA * Math.pow(1 - 2.25577e-5 * z, 5.25588);
}

/**
 * Saturation pressure of water vapor over liquid water (T ≥ 0 °C) and over
 * ice (T < 0 °C). ASHRAE Eq 5 (ice) and Eq 6 (water). Returns Pa.
 */
function saturationPressurePa(tempC) {
  const T = (tempC || 0) + T_ZERO_K;
  if (tempC < 0) {
    // ASHRAE Eq 5: ln(p_ws) over ice
    const c = [
      -5.6745359e3,
      6.3925247,
      -9.677843e-3,
      6.2215701e-7,
      2.0747825e-9,
      -9.484024e-13,
      4.1635019
    ];
    const ln = c[0]/T + c[1] + c[2]*T + c[3]*T*T + c[4]*T*T*T + c[5]*T*T*T*T + c[6]*Math.log(T);
    return Math.exp(ln);
  }
  // ASHRAE Eq 6: ln(p_ws) over liquid water
  const c = [
    -5.8002206e3,
    1.3914993,
    -4.8640239e-2,
    4.1764768e-5,
    -1.4452093e-8,
    6.5459673
  ];
  const ln = c[0]/T + c[1] + c[2]*T + c[3]*T*T + c[4]*T*T*T + c[5]*Math.log(T);
  return Math.exp(ln);
}

/** Humidity ratio from partial vapor pressure pw (Pa). ASHRAE Eq 22. */
function humidityRatioFromPw(pwPa, totalPressurePa) {
  const P = totalPressurePa || ATM_PA;
  const pw = clamp(pwPa, 0, P - 1);
  return MW_RATIO * pw / Math.max(P - pw, 1);
}

/** Humidity ratio from T (°C), RH (0–100), pressure (Pa). */
function humidityRatioAt(tempC, relativeHumidityPct, pressurePa) {
  const rh = clamp((relativeHumidityPct || 0) / 100, 0, 1);
  const pws = saturationPressurePa(tempC);
  return humidityRatioFromPw(rh * pws, pressurePa);
}

/** Saturation humidity ratio at given T, P. */
function saturationHumidityRatio(tempC, pressurePa) {
  return humidityRatioAt(tempC, 100, pressurePa);
}

/** Vapor pressure (Pa) from humidity ratio. */
function vaporPressureFromW(W, pressurePa) {
  const P = pressurePa || ATM_PA;
  const w = Math.max(W, 0);
  return P * w / (MW_RATIO + w);
}

/** Relative humidity (%) from T (°C), W, P. */
function relativeHumidity(tempC, W, pressurePa) {
  const pw = vaporPressureFromW(W, pressurePa);
  const pws = saturationPressurePa(tempC);
  if (pws <= 0) return 0;
  return clamp(100 * pw / pws, 0, 100);
}

/** Moist-air enthalpy, kJ/kg_da. ASHRAE Eq 32. */
function moistAirEnthalpy(tempC, W) {
  return 1.006 * tempC + Math.max(W, 0) * (2501 + 1.86 * tempC);
}

/** Humidity ratio that gives enthalpy h at temperature T. */
function humidityRatioFromEnthalpyTemp(h, tempC) {
  const denom = 2501 + 1.86 * tempC;
  return denom !== 0 ? (h - 1.006 * tempC) / denom : 0;
}

/** Specific volume of moist air, m³/kg_da. ASHRAE Eq 26. */
function moistAirSpecificVolume(tempC, W, pressurePa) {
  const P = pressurePa || ATM_PA;
  return R_DA * (tempC + T_ZERO_K) * (1 + 1.607858 * Math.max(W, 0)) / P;
}

/** Moist-air density (kg/m³ of moist mixture). */
function moistAirDensity(tempC, W, pressurePa) {
  const v = moistAirSpecificVolume(tempC, W, pressurePa);
  return (1 + Math.max(W, 0)) / v;
}

/** Specific heat of moist air at constant pressure, kJ/(kg_da·K). */
function cpMoistAir(W) {
  return 1.006 + 1.86 * Math.max(W, 0);
}

/**
 * Dew point (°C) from humidity ratio and pressure.
 * Inverts saturation pressure numerically (bisection, robust below freezing).
 */
function dewPointTemp(W, pressurePa) {
  const P = pressurePa || ATM_PA;
  const w = Math.max(W, 1e-9);
  const pw = vaporPressureFromW(w, P);
  let lo = -90, hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (saturationPressurePa(mid) < pw) lo = mid; else hi = mid;
    if (hi - lo < 1e-4) break;
  }
  return (lo + hi) / 2;
}

/**
 * Wet bulb (°C) from dry bulb, W, and pressure. Iterates ASHRAE Eq 35
 * (psychrometric, normal liquid-water wet bulb).
 */
function wetBulbTemp(tempC, W, pressurePa) {
  const P = pressurePa || ATM_PA;
  const w = Math.max(W, 0);
  let lo = -50, hi = tempC;
  // W from wet bulb (ASHRAE Eq 35 over water, valid Twb > 0):
  function wAtTwb(twb) {
    const Wws = saturationHumidityRatio(twb, P);
    if (twb >= 0) {
      // Eq 35
      return ((2501 - 2.326 * twb) * Wws - 1.006 * (tempC - twb))
        / (2501 + 1.86 * tempC - 4.186 * twb);
    }
    // Eq 37 over ice
    return ((2830 - 0.24 * twb) * Wws - 1.006 * (tempC - twb))
      / (2830 + 1.86 * tempC - 2.1 * twb);
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const wmid = wAtTwb(mid);
    if (wmid < w) lo = mid; else hi = mid;
    if (hi - lo < 1e-4) break;
  }
  return (lo + hi) / 2;
}

/** Convenience: derive full psychrometric state from T_db, RH, P. */
function stateFromDryBulbRH(tempC, rhPct, pressurePa) {
  const P = pressurePa || ATM_PA;
  const W = humidityRatioAt(tempC, rhPct, P);
  return {
    tempC: tempC,
    rhPct: rhPct,
    humidityRatio: W,
    enthalpy: moistAirEnthalpy(tempC, W),
    specificVolume: moistAirSpecificVolume(tempC, W, P),
    density: moistAirDensity(tempC, W, P),
    dewPoint: dewPointTemp(W, P),
    wetBulb: wetBulbTemp(tempC, W, P),
    pressurePa: P
  };
}

module.exports = {
  R_DA: R_DA,
  R_W: R_W,
  MW_RATIO: MW_RATIO,
  ATM_PA: ATM_PA,
  pressureAtElevation: pressureAtElevation,
  saturationPressurePa: saturationPressurePa,
  humidityRatioFromPw: humidityRatioFromPw,
  humidityRatioAt: humidityRatioAt,
  saturationHumidityRatio: saturationHumidityRatio,
  vaporPressureFromW: vaporPressureFromW,
  relativeHumidity: relativeHumidity,
  moistAirEnthalpy: moistAirEnthalpy,
  humidityRatioFromEnthalpyTemp: humidityRatioFromEnthalpyTemp,
  moistAirSpecificVolume: moistAirSpecificVolume,
  moistAirDensity: moistAirDensity,
  cpMoistAir: cpMoistAir,
  dewPointTemp: dewPointTemp,
  wetBulbTemp: wetBulbTemp,
  stateFromDryBulbRH: stateFromDryBulbRH
};
