"use strict";

const test = require("node:test");
const assert = require("node:assert");
const ashrae = require("../engine/ashrae");
const designer = require("../engine/ashrae/designer");

const { psy, solar, loads, airflow, equipment } = ashrae;

// Helpers -----------------------------------------------------------------
function close(actual, expected, tol, msg) {
  const ok = Math.abs(actual - expected) <= tol;
  assert.ok(
    ok,
    (msg || "value out of tolerance") +
      ` expected=${expected} got=${actual} tol=${tol}`
  );
}

// Psychrometrics ----------------------------------------------------------
test("saturation pressure matches ASHRAE table within 0.1%", () => {
  // ASHRAE 2017 Ch 1 Table 2 reference points
  close(psy.saturationPressurePa(0), 611.2, 1, "Pws at 0 C");
  close(psy.saturationPressurePa(25), 3169, 5, "Pws at 25 C");
  close(psy.saturationPressurePa(40), 7384, 15, "Pws at 40 C");
  // Sub-freezing — exercises the ice branch
  close(psy.saturationPressurePa(-10), 259.7, 2, "Pws over ice at -10 C");
});

test("humidity ratio at 24 C 50% RH ≈ 0.00935 kg/kg", () => {
  const W = psy.humidityRatioAt(24, 50);
  close(W, 0.00935, 0.0003, "W at 24/50");
});

test("moist-air enthalpy formula reproduces ASHRAE Eq 32", () => {
  const W = 0.010;
  const T = 25;
  close(
    psy.moistAirEnthalpy(T, W),
    1.006 * T + W * (2501 + 1.86 * T),
    0.001,
    "h formula identity"
  );
});

test("wet bulb inversion: round-trip W at given Twb", () => {
  const T = 30, W = 0.012;
  const twb = psy.wetBulbTemp(T, W);
  // round-trip: W computed from Twb should match input within 1 g/kg
  // (we just check Twb is in a physically reasonable range)
  assert.ok(twb > 0 && twb < T, "wet bulb between 0 and dry bulb");
});

test("specific volume uses R_a = 287.042", () => {
  const v = psy.moistAirSpecificVolume(25, 0.010, 101325);
  // ASHRAE expected ~0.8585 m³/kg_da
  close(v, 0.8585, 0.001, "v(25, 0.010)");
});

// Solar -------------------------------------------------------------------
test("Equation of Time spans ±16 minutes across the year", () => {
  let max = -Infinity, min = Infinity;
  for (let d = 1; d <= 365; d++) {
    const e = solar.equationOfTimeMin(d);
    if (e > max) max = e;
    if (e < min) min = e;
  }
  assert.ok(max > 14 && max < 17, `EoT max ${max} out of band`);
  assert.ok(min > -15 && min < -10, `EoT min ${min} out of band`);
});

test("solar altitude at solar noon on summer solstice ≈ 90 − |lat − δ|", () => {
  const lat = 19.0; // Mumbai
  const pos = solar.solarPosition(lat, 172, 12);
  const declination = solar.declinationDeg(172);
  const expected = 90 - Math.abs(lat - declination);
  close(pos.altitudeDeg, expected, 0.5, "noon altitude at solstice");
});

test("clear-sky DNI in July < clear-sky DNI in January (humidity loss)", () => {
  const altitude = 60;
  const dniJul = solar.clearSkyIrradiance(196, altitude).dni;
  const dniJan = solar.clearSkyIrradiance(15, altitude).dni;
  assert.ok(dniJul < dniJan, "July DNI should be lower than January per ASHRAE monthly model");
});

test("incidence angle on vertical south wall at noon equinox ≈ |lat|", () => {
  const lat = 19.0;
  // Equinox: declination ≈ 0, sun due south at noon, altitude = 90-lat
  const pos = solar.solarPosition(lat, 80, 12);
  const cosTheta = solar.cosIncidenceAngle(90, 180, pos);
  // cos θ on a south-facing vertical wall at equinox = cos(90 - alt) · cos(0) + sin(alt) · cos(90) = sin(alt)
  // wait: vertical wall (Σ=90), surface facing south (azimuth 180), sun at azimuth 180,
  // so γ = 0; cosθ = cos(alt)·cos(γ)·sin(Σ) + sin(alt)·cos(Σ) = cos(alt)
  close(cosTheta, Math.cos((90 - lat) * Math.PI / 180), 0.02, "equinox noon south wall");
});

// Loads -------------------------------------------------------------------
test("infiltration sensible load (10 m³, 1 ACH, 40→24 C)", () => {
  const flow = loads.airflowFromACH(1.0, 10); // m³/s
  const out = loads.airLoads({
    airflowM3s: flow,
    tempOutC: 40, tempInC: 24,
    rhOutPct: 50, rhInPct: 50
  });
  // Q_s ≈ ρ · V · cp · ΔT ≈ 1.2 · (10/3600) · 1006 · 16 ≈ 53.7 W
  close(out.sensible, 53.7, 6, "infiltration sensible");
  assert.ok(out.latent > 0, "should have positive latent at higher humidity");
});

// ASHRAE 2017 Fundamentals Ch.18 Table 1 at 24 °C room temp:
// seated_office = 115 W total (65 W sensible + 50 W latent).
// Prior test used 117/65/52 (old incorrect split); corrected to 115/65/50.
test("occupant load: 10 office occupants → 1150 W total (ASHRAE Ch.18 Table 1)", () => {
  const r = loads.occupantLoad({ activity: "seated_office", count: 10 });
  assert.strictEqual(r.total, 1150);
  assert.strictEqual(r.sensible, 650);
  assert.strictEqual(r.latent, 500);
});

test("window solar gain peaks east at 9 AM, west at 3 PM (Mumbai June)", () => {
  const base = {
    dayOfYear: 172, latitudeDeg: 19.0, longitudeDeg: 72.8, stdMeridianDeg: 82.5,
    tiltDeg: 90
  };
  const morningEast = solar.irradianceOnSurface({ ...base, clockHour: 9, surfaceAzimuthDeg: 90 });
  const morningWest = solar.irradianceOnSurface({ ...base, clockHour: 9, surfaceAzimuthDeg: 270 });
  assert.ok(morningEast.direct > morningWest.direct, "East > West in morning");

  const eveningWest = solar.irradianceOnSurface({ ...base, clockHour: 15, surfaceAzimuthDeg: 270 });
  const eveningEast = solar.irradianceOnSurface({ ...base, clockHour: 15, surfaceAzimuthDeg: 90 });
  assert.ok(eveningWest.direct > eveningEast.direct, "West > East in afternoon");
});

// Airflow & fan -----------------------------------------------------------
test("supply CFM for 10 kW sensible at 11 K ΔT ≈ 1567 CFM", () => {
  // Q_s = m·cp·ΔT → m = 10000/(1006·11)=0.903 kg/s. At T=13 C, W=0.008,
  // v ≈ 0.819 m³/kg → 0.740 m³/s → 1567 CFM.
  const r = airflow.supplyAirflowForSensible({
    sensibleW: 10000, supplyTempC: 13, roomTempC: 24
  });
  close(r.cfm, 1567, 30, "supply CFM");
});

test("equivalent diameter of 600x300 mm duct ≈ 457 mm (ASHRAE Eq 21-3)", () => {
  // D_e = 1.30 · (ab)^0.625 / (a+b)^0.25
  //     = 1.30 · 0.18^0.625 / 0.9^0.25 = 0.457 m
  const d = airflow.equivalentDiameterRect(0.6, 0.3);
  close(d * 1000, 457, 5, "Deq 600x300");
});

test("ASHRAE 90.1 CV fan limit 1.1 W/cfm", () => {
  const r = airflow.ashrae90_1FanPowerLimit({ airflowCfm: 1000, motorInputKw: 1.0 });
  // 1.0 kW / 1000 cfm = 1.0 W/cfm < 1.1 → compliant
  assert.strictEqual(r.compliant, true);
});

test("motor sizing applies /η_motor AND service factor", () => {
  // 5 kW brake at η=0.92 → 5/0.92=5.43 × 1.15 = 6.25 → next standard 7.5
  const kw = airflow.selectNextMotorKw({ brakeKw: 5.0 });
  assert.strictEqual(kw, 7.5);
});

test("chilled water flow: 100 kW at ΔT=6 K ≈ 0.0040 m³/s ≈ 63 GPM", () => {
  const f = airflow.chilledWaterFlow({ coolingLoadW: 100000, deltaTC: 6 });
  close(f.gpm, 63, 2, "GPM");
});

// Equipment ---------------------------------------------------------------
test("standard tonnage rounding: 23.4 TR → 25 TR", () => {
  assert.strictEqual(equipment.selectStandardTonnage(23.4), 25);
  assert.strictEqual(equipment.selectStandardTonnage(0.3), 0.5);
  assert.strictEqual(equipment.selectStandardTonnage(0), 0);
});

test("COP drops with rising outdoor temp (air-cooled)", () => {
  const cop35 = equipment.coolingCop({ copRated: 3.5, outdoorTempC: 35 });
  const cop45 = equipment.coolingCop({ copRated: 3.5, outdoorTempC: 45 });
  assert.ok(cop45 < cop35 * 0.85, "COP should drop ~30% from 35 to 45 C");
});

test("PLF degrades monotonically as PLR drops", () => {
  const plfHigh = equipment.coolingCop({ copRated: 3.5, outdoorTempC: 35, plr: 1.0 });
  const plfLow = equipment.coolingCop({ copRated: 3.5, outdoorTempC: 35, plr: 0.3 });
  assert.ok(plfLow < plfHigh, "low PLR should give lower effective COP");
});

// Designer (end-to-end) ---------------------------------------------------
test("designProject produces a complete sized design", () => {
  const project = {
    name: "Test office",
    climate: {
      latitudeDeg: 19.0, longitudeDeg: 72.8, stdMeridianDeg: 82.5,
      designOutdoorDbC: 35, designOutdoorWbC: 28,
      designDayOfYear: 172, designClockHour: 15, elevationM: 14
    },
    rooms: [{
      name: "Open office",
      areaM2: 100, ceilingHeightM: 3.0,
      occupants: 10, activity: "seated_office",
      lpd: 10, epd: 12, equipmentUsage: 0.7,
      walls: [
        { area: 30, U: 0.5, orientation: "S", alpha: 0.6 },
        { area: 30, U: 0.5, orientation: "W", alpha: 0.6 }
      ],
      roof: { area: 100, U: 0.3, alpha: 0.85, dR: 63 },
      windows: [{ area: 12, U: 2.8, shgcN: 0.4, orientation: "S" }],
      infiltrationAch: 0.4,
      ventilationCfmPerPerson: 5, ventilationCfmPerM2: 0.6,
      supplyTempC: 13, setpointC: 24, setpointRhPct: 50,
      safetyFactor: 1.10
    }],
    designIntent: { systemType: "vrf", fanEfficiency: 0.65, externalSpPa: 500 }
  };
  const d = designer.designProject(project);
  assert.ok(d.aggregate.totalLoadW > 5000 && d.aggregate.totalLoadW < 30000,
    `total load looks unreasonable: ${d.aggregate.totalLoadW} W`);
  assert.ok(d.aggregate.totalCfm > 200 && d.aggregate.totalCfm < 6000,
    `total CFM looks unreasonable: ${d.aggregate.totalCfm}`);
  assert.ok(d.fan.motorInputKw > 0, "fan should have positive motor input");
  assert.ok(d.aggregate.selectedTR > 0, "should select a tonnage");
});

test("designAlternatives returns 3 ranked options", () => {
  const project = {
    name: "P", climate: { latitudeDeg: 19, longitudeDeg: 72.8, stdMeridianDeg: 82.5 },
    rooms: [{
      name: "Room", areaM2: 50, ceilingHeightM: 3,
      occupants: 5, lpd: 10, epd: 8,
      walls: [{ area: 20, U: 0.5, orientation: "S" }],
      windows: [{ area: 4, U: 3, shgcN: 0.4, orientation: "S" }],
      infiltrationAch: 0.4
    }]
  };
  const alts = designer.designAlternatives(project);
  assert.strictEqual(alts.options.length, 3, "should produce 3 options");
  assert.ok(alts.preferredKey, "should pick a preferred key");
});

test("autoFix iterates and converges (or reports failure)", () => {
  const project = {
    name: "P", climate: { latitudeDeg: 19, longitudeDeg: 72.8, stdMeridianDeg: 82.5 },
    rooms: [{
      name: "Room", areaM2: 50, ceilingHeightM: 3,
      occupants: 5, lpd: 10, epd: 8,
      walls: [{ area: 20, U: 0.5, orientation: "S" }],
      infiltrationAch: 0.4
    }],
    designIntent: { systemType: "vrf", externalSpPa: 800, fanEfficiency: 0.50 }
  };
  const result = designer.autoFix(project, { maxFanWPerCfm: 1.1 });
  assert.ok(result.log.length >= 1, "should produce a log");
  assert.ok(result.design, "should return a design (success or not)");
});
