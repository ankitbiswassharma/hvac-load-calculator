/**
 * Airflow, fan, pump and duct sizing — ASHRAE Fundamentals Ch. 21 + Ch. 22
 * plus ASHRAE 90.1 fan power limits.
 *
 * SI throughout. Inputs may be in CFM/inWG (for catalog compatibility) and
 * are converted internally.
 */
"use strict";

const psy = require("./psychrometrics");

const CFM_TO_M3S = 0.00047194745;        // 1 cfm
const M3S_TO_CFM = 1 / CFM_TO_M3S;
const IN_TO_M    = 0.0254;
const IN_WG_TO_PA = 248.84;              // 1 inch water gauge ≈ 248.84 Pa
const AIR_DENSITY = 1.2;                 // kg/m³ standard
const AIR_DYN_VISCOSITY = 1.825e-5;      // Pa·s at 20 °C
const STEEL_ROUGHNESS_M = 0.00015;       // ε for galvanized steel

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

/* ----------------------------------------------------------------- */
/*  Supply airflow from cooling load                                  */
/* ----------------------------------------------------------------- */

/**
 * Required supply airflow (m³/s of dry air) for a given sensible cooling load.
 *   Q_s = m_dot_da · cp_da · ΔT
 *
 * Returns object with mass flow, volumetric flow at supply conditions, and CFM.
 *
 *  sensibleW      — W
 *  supplyTempC    — supply-air dry bulb after coil, °C
 *  roomTempC      — room dry bulb, °C
 *  supplyHumidityRatio — W of supply air (default uses room W for SHR calc)
 *  pressurePa     — atmospheric, Pa
 */
function supplyAirflowForSensible({
  sensibleW, supplyTempC, roomTempC, supplyHumidityRatio = 0.008, pressurePa
}) {
  const P = pressurePa || psy.ATM_PA;
  const dT = (roomTempC || 0) - (supplyTempC || 0);
  if (dT <= 0 || sensibleW <= 0) {
    return { m_dot_da: 0, m3s: 0, cfm: 0 };
  }
  const cp = psy.cpMoistAir(supplyHumidityRatio) * 1000; // J/(kg·K)
  const m_dot_da = sensibleW / (cp * dT);
  // volumetric at supply state:
  const v = psy.moistAirSpecificVolume(supplyTempC, supplyHumidityRatio, P);
  const m3s = m_dot_da * v;
  return {
    m_dot_da: m_dot_da,
    m3s: m3s,
    cfm: m3s * M3S_TO_CFM,
    specificVolume: v
  };
}

/* ----------------------------------------------------------------- */
/*  Duct hydraulics                                                   */
/* ----------------------------------------------------------------- */

/** Equivalent diameter of rectangular duct (m). ASHRAE Eq 21-3. */
function equivalentDiameterRect(widthM, heightM) {
  const w = Math.max(widthM, 1e-6);
  const h = Math.max(heightM, 1e-6);
  return 1.30 * Math.pow(w * h, 0.625) / Math.pow(w + h, 0.25);
}

/** Reynolds number based on hydraulic diameter and mean velocity. */
function reynolds(velocityMs, diameterM) {
  return AIR_DENSITY * velocityMs * diameterM / AIR_DYN_VISCOSITY;
}

/**
 * Swamee–Jain explicit Darcy friction factor.
 * Valid 10⁻⁶ ≤ ε/D ≤ 10⁻², 5000 ≤ Re ≤ 10⁸.
 * Falls back to 64/Re for laminar flow.
 */
function frictionFactor(re, diameterM, roughnessM) {
  if (re <= 0) return 0;
  if (re < 2300) return 64 / re;
  const eD = (roughnessM || STEEL_ROUGHNESS_M) / Math.max(diameterM, 1e-6);
  const denom = Math.log10(eD / 3.7 + 5.74 / Math.pow(re, 0.9));
  return 0.25 / (denom * denom);
}

/**
 * Straight-duct pressure drop, Pa.  ΔP = f · (L/D) · ½ρV²
 */
function ductFrictionDropPa({ lengthM, diameterM, velocityMs, roughnessM }) {
  if (lengthM <= 0 || velocityMs <= 0 || diameterM <= 0) return 0;
  const re = reynolds(velocityMs, diameterM);
  const f = frictionFactor(re, diameterM, roughnessM);
  return f * (lengthM / diameterM) * 0.5 * AIR_DENSITY * velocityMs * velocityMs;
}

/** Fitting loss: ΔP = K · ½ρV² */
function fittingLossPa(velocityMs, kFactor) {
  return Math.max(0, kFactor) * 0.5 * AIR_DENSITY * velocityMs * velocityMs;
}

/* ----------------------------------------------------------------- */
/*  Fan power                                                         */
/* ----------------------------------------------------------------- */

/**
 * Brake fan power (kW) given airflow and total pressure rise.
 *
 *   P_fan = Q · ΔP / η_fan          [W, with Q in m³/s, ΔP in Pa]
 *
 * IMPORTANT: returns shaft (brake) kW. Use motorElectricalKw() to convert
 * to motor electrical input.
 */
function fanShaftKw({ airflowM3s, totalPressurePa, fanEfficiency }) {
  const eta = clamp(fanEfficiency || 0.6, 0.20, 0.92);
  if (airflowM3s <= 0 || totalPressurePa <= 0) return 0;
  return airflowM3s * totalPressurePa / (eta * 1000);
}

/**
 * Motor electrical input kW given brake shaft kW.
 *   P_in = P_brake / η_motor
 *
 * η_motor defaults to NEMA-Premium 4-pole ~0.92 for 1–10 kW class.
 */
function motorElectricalKw({ brakeKw, motorEfficiency = 0.92 }) {
  const eta = clamp(motorEfficiency, 0.70, 0.98);
  if (brakeKw <= 0) return 0;
  return brakeKw / eta;
}

/**
 * Next standard NEMA motor size (kW) after applying service factor.
 *   sized = brake / η_motor × service_factor
 *
 * Service factor default 1.15 (covers run-out, partial-load efficiency loss).
 */
const STANDARD_MOTOR_KW = [
  0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3.0, 3.7, 4.0, 5.5,
  7.5, 9.3, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160
];
function selectNextMotorKw({ brakeKw, motorEfficiency = 0.92, serviceFactor = 1.15 }) {
  const need = (brakeKw / motorEfficiency) * serviceFactor;
  for (const kw of STANDARD_MOTOR_KW) {
    if (kw >= need - 1e-6) return kw;
  }
  return Math.ceil(need / 5) * 5;
}

/**
 * ASHRAE 90.1 §6.5.3.1 fan power limit, expressed as max W/cfm.
 *
 *   CV (constant volume):  1.1 W/cfm
 *   VAV (variable):        1.7 W/cfm
 *
 * Returns the limit and whether the design fan input complies.
 */
function ashrae90_1FanPowerLimit({ airflowCfm, motorInputKw, isVAV = false }) {
  const wPerCfm = motorInputKw * 1000 / Math.max(airflowCfm, 1);
  const limit = isVAV ? 1.7 : 1.1;
  return {
    wPerCfm: wPerCfm,
    limitWPerCfm: limit,
    compliant: wPerCfm <= limit + 1e-6
  };
}

/* ----------------------------------------------------------------- */
/*  Pump (chilled water) power                                        */
/* ----------------------------------------------------------------- */

/**
 * Chilled-water flow rate (m³/s) for a cooling load.
 *
 *   Q_water = Q_load / (ρ · cp · ΔT)
 *
 *   Q_load    — W
 *   deltaTC   — coil ΔT, K (typical 5–7 K)
 *   density   — kg/m³ (default 999 for chilled water at 8 °C)
 *   cp        — J/(kg·K) (default 4186)
 */
function chilledWaterFlow({ coolingLoadW, deltaTC = 6, density = 999, cp = 4186 }) {
  if (coolingLoadW <= 0 || deltaTC <= 0) return { m3s: 0, gpm: 0, lps: 0 };
  const m3s = coolingLoadW / (density * cp * deltaTC);
  return {
    m3s: m3s,
    lps: m3s * 1000,
    gpm: m3s * 15850.32
  };
}

/**
 * Pump shaft power (kW).
 *   P = ρ · g · Q · H / η_pump
 *
 *   flowM3s — m³/s
 *   headM   — total head, meters of fluid
 *   density — fluid density, kg/m³
 *   etaPump — pump hydraulic efficiency (0–1)
 */
function pumpShaftKw({ flowM3s, headM, density = 999, etaPump = 0.70 }) {
  if (flowM3s <= 0 || headM <= 0) return 0;
  const eta = clamp(etaPump, 0.25, 0.90);
  return density * 9.80665 * flowM3s * headM / (eta * 1000);
}

module.exports = {
  CFM_TO_M3S, M3S_TO_CFM, IN_TO_M, IN_WG_TO_PA, AIR_DENSITY,
  supplyAirflowForSensible: supplyAirflowForSensible,
  equivalentDiameterRect: equivalentDiameterRect,
  reynolds: reynolds,
  frictionFactor: frictionFactor,
  ductFrictionDropPa: ductFrictionDropPa,
  fittingLossPa: fittingLossPa,
  fanShaftKw: fanShaftKw,
  motorElectricalKw: motorElectricalKw,
  selectNextMotorKw: selectNextMotorKw,
  STANDARD_MOTOR_KW: STANDARD_MOTOR_KW,
  ashrae90_1FanPowerLimit: ashrae90_1FanPowerLimit,
  chilledWaterFlow: chilledWaterFlow,
  pumpShaftKw: pumpShaftKw
};
