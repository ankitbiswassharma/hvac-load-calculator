/**
 * Barrel export for the ASHRAE-correct HVAC engine.
 *
 *   psy:       psychrometric functions (ASHRAE Ch. 1)
 *   solar:     solar position + irradiance + window solar gain (Ch. 14, 15)
 *   loads:     conduction, infiltration, internal, room rollup (Ch. 17, 18)
 *   airflow:   supply CFM, duct hydraulics, fan/pump power (Ch. 21, 22 + 90.1)
 *   equipment: tonnage selection, COP curves, bin energy (Ch. 19 + AHRI)
 *   designer:  end-to-end full-design generator (used by the AI auto-fix loop)
 */
"use strict";

const psy = require("./psychrometrics");
const solar = require("./solar");
const loads = require("./loads");
const airflow = require("./airflow");
const equipment = require("./equipment");

module.exports = {
  psy: psy,
  psychrometrics: psy,
  solar: solar,
  loads: loads,
  airflow: airflow,
  equipment: equipment,
  // canonical short keys
  saturationPressurePa: psy.saturationPressurePa,
  moistAirEnthalpy: psy.moistAirEnthalpy,
  humidityRatioAt: psy.humidityRatioAt,
  wetBulbTemp: psy.wetBulbTemp,
  dewPointTemp: psy.dewPointTemp,
  // engine version (bump when you change physics)
  version: "1.0.0"
};
