/**
 * ASHRAE Handbook of Fundamentals Ch. 14 (Climatic Design Info) and
 * Ch. 15 (Fenestration) — solar position and clear-sky radiation.
 *
 * Coordinate convention:
 *   Latitude, longitude in degrees (north +, east +).
 *   Surface azimuth: 0 = North, 90 = East, 180 = South, 270 = West.
 *   Surface tilt: 0 = horizontal (skylight), 90 = vertical wall.
 *
 * All angles internally in radians.
 */
"use strict";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/* --- ASHRAE 2013/2017 monthly clear-sky model coefficients (representative).
 * τb, τd are pseudo-optical depths for beam and diffuse.
 * (A,B,C) are the older simpler model — provided for backward compatibility.
 */
const ASHRAE_CLEAR_SKY_AB = [
  // {month, A_W/m2, B (-), C (-)}
  { A: 1230, B: 0.142, C: 0.058 }, // Jan
  { A: 1215, B: 0.144, C: 0.060 }, // Feb
  { A: 1186, B: 0.156, C: 0.071 }, // Mar
  { A: 1136, B: 0.180, C: 0.097 }, // Apr
  { A: 1104, B: 0.196, C: 0.121 }, // May
  { A: 1088, B: 0.205, C: 0.134 }, // Jun
  { A: 1085, B: 0.207, C: 0.136 }, // Jul
  { A: 1107, B: 0.201, C: 0.122 }, // Aug
  { A: 1152, B: 0.177, C: 0.092 }, // Sep
  { A: 1193, B: 0.160, C: 0.073 }, // Oct
  { A: 1221, B: 0.149, C: 0.063 }, // Nov
  { A: 1234, B: 0.142, C: 0.057 }  // Dec
];

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

function dayOfYearToMonth(N) {
  // Approximate month index (0–11) from day of year (1–365).
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
  for (let m = 0; m < 12; m++) {
    if (N <= cum[m + 1]) return m;
  }
  return 11;
}

/** Solar declination δ (degrees) — Spencer (more accurate than ASHRAE Eq 11). */
function declinationDeg(dayOfYear) {
  const gamma = 2 * Math.PI * (dayOfYear - 1) / 365;
  const d = 0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.001480 * Math.sin(3 * gamma);
  return d * RAD;
}

/** Equation of Time (minutes). Spencer. */
function equationOfTimeMin(dayOfYear) {
  const gamma = 2 * Math.PI * (dayOfYear - 1) / 365;
  return 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  );
}

/**
 * Apparent solar time (decimal hours) from clock time.
 * stdMeridianDeg = 15 * UTC_offset_hours.  East +.
 */
function apparentSolarTime(clockHourLocal, dayOfYear, longitudeDeg, stdMeridianDeg) {
  const eot = equationOfTimeMin(dayOfYear);
  return clockHourLocal + eot / 60 + (longitudeDeg - stdMeridianDeg) / 15;
}

/** Hour angle H (degrees). Negative before solar noon (AM). */
function hourAngleDeg(apparentSolarHour) {
  return 15 * (apparentSolarHour - 12);
}

/**
 * Solar altitude β and azimuth γ_s (south-based, S=180). Returns degrees.
 * Uses atan2 form (no quadrant ambiguity).
 */
function solarPosition(latitudeDeg, dayOfYear, apparentSolarHour) {
  const L = latitudeDeg * DEG;
  const d = declinationDeg(dayOfYear) * DEG;
  const H = hourAngleDeg(apparentSolarHour) * DEG;
  const sinBeta = Math.sin(L) * Math.sin(d) + Math.cos(L) * Math.cos(d) * Math.cos(H);
  const beta = Math.asin(clamp(sinBeta, -1, 1));
  // Azimuth from south, AM negative (east), PM positive (west).
  // azimuth_south = atan2( sin H, cos H * sin L - tan δ * cos L )
  const azS = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(L) - Math.tan(d) * Math.cos(L)
  );
  // Convert south-based to N=0/E=90/S=180/W=270 compass convention:
  // south-based: AM negative, PM positive, with 0 = south.
  // compass azimuth = 180 + azS (in degrees).
  let azimuthCompass = 180 + azS * RAD;
  if (azimuthCompass < 0) azimuthCompass += 360;
  if (azimuthCompass >= 360) azimuthCompass -= 360;
  return {
    altitudeDeg: beta * RAD,
    azimuthDeg: azimuthCompass,
    altitudeRad: beta,
    isAboveHorizon: beta > 0
  };
}

/**
 * Cosine of incidence angle on an arbitrary tilted surface.
 * tiltDeg: 0 = horizontal, 90 = vertical
 * surfaceAzimuthDeg: 0 = facing north, 90 = facing east, etc.
 * Returns 0 if sun is behind surface or below horizon.
 */
function cosIncidenceAngle(tiltDeg, surfaceAzimuthDeg, position) {
  if (!position.isAboveHorizon) return 0;
  const Sigma = tiltDeg * DEG;          // surface tilt
  const surfAz = surfaceAzimuthDeg * DEG;
  const sunAz = position.azimuthDeg * DEG;
  const beta = position.altitudeRad;
  // surface-solar azimuth difference (compass-based)
  const gamma = sunAz - surfAz;
  const cosTheta = Math.cos(beta) * Math.cos(gamma) * Math.sin(Sigma)
    + Math.sin(beta) * Math.cos(Sigma);
  return Math.max(0, cosTheta);
}

/** Air mass (Kasten-Young, ASHRAE Ch 14 Eq 18). */
function relativeAirMass(altitudeDeg) {
  if (altitudeDeg <= 0) return 0;
  const z = (90 - altitudeDeg);
  return 1 / (Math.sin(altitudeDeg * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

/**
 * ASHRAE classic clear-sky (A,B,C) model. Returns W/m² for DNI on
 * normal-to-sun surface, diffuse on horizontal, and direct on horizontal.
 * For more rigorous results use τb/τd (ASHRAE 2013 method); this is the
 * established and widely-published simplified model.
 */
function clearSkyIrradiance(dayOfYear, altitudeDeg) {
  if (altitudeDeg <= 0) return { dni: 0, diffuseHoriz: 0, beamHoriz: 0 };
  const m = dayOfYearToMonth(dayOfYear);
  const { A, B, C } = ASHRAE_CLEAR_SKY_AB[m];
  const sinBeta = Math.sin(altitudeDeg * DEG);
  // Beam normal irradiance
  const dni = A * Math.exp(-B / Math.max(sinBeta, 1e-3));
  const beamHoriz = dni * sinBeta;
  const diffuseHoriz = C * dni;
  return { dni: dni, diffuseHoriz: diffuseHoriz, beamHoriz: beamHoriz };
}

/**
 * Total irradiance components on a tilted surface (W/m²).
 * Returns { direct, diffuse, ground, total }.
 *
 * groundReflectance ρ_g defaults to 0.20 (ASHRAE Ch 15 default).
 */
function irradianceOnSurface({
  dayOfYear,
  latitudeDeg,
  longitudeDeg,
  stdMeridianDeg,
  clockHour,
  tiltDeg,
  surfaceAzimuthDeg,
  groundReflectance = 0.20
}) {
  const ast = apparentSolarTime(clockHour, dayOfYear, longitudeDeg, stdMeridianDeg);
  const pos = solarPosition(latitudeDeg, dayOfYear, ast);
  if (!pos.isAboveHorizon) {
    return { direct: 0, diffuse: 0, ground: 0, total: 0, position: pos, ast: ast };
  }
  const irr = clearSkyIrradiance(dayOfYear, pos.altitudeDeg);
  const cosTheta = cosIncidenceAngle(tiltDeg, surfaceAzimuthDeg, pos);
  const Sigma = tiltDeg * DEG;
  // View factors
  const F_sky = (1 + Math.cos(Sigma)) / 2;
  const F_grd = (1 - Math.cos(Sigma)) / 2;
  // Direct beam on surface
  const direct = irr.dni * cosTheta;
  // Diffuse from sky (isotropic) on surface
  const diffuse = irr.diffuseHoriz * F_sky;
  // Ground reflected
  const ghi = irr.beamHoriz + irr.diffuseHoriz;
  const ground = ghi * groundReflectance * F_grd;
  return {
    direct: direct,
    diffuse: diffuse,
    ground: ground,
    total: direct + diffuse + ground,
    dni: irr.dni,
    cosTheta: cosTheta,
    position: pos,
    ast: ast
  };
}

/**
 * SHGC angular dependence (ASHRAE Ch 15 Eq 28a polynomial in cos θ).
 * Returns the angle-correction factor relative to normal SHGC.
 * Coefficients shown for clear, uncoated single glazing as a default.
 */
function shgcAngleFactor(cosTheta, coeffs) {
  const c = coeffs || [-0.0089, -0.5378, 1.5471, 0.0]; // generic clear glass
  // Eq form: f(cosθ) = c0 + c1·cosθ + c2·cosθ² + c3·cosθ³ then clamped
  const x = Math.max(0, cosTheta);
  const f = c[0] + c[1]*x + c[2]*x*x + (c[3] || 0)*x*x*x;
  return Math.max(0, Math.min(1, f));
}

/**
 * Solar heat gain on a window or fenestration, W per m² of glass.
 *
 * shgcN     — normal (θ=0) SHGC
 * sc        — optional shading coefficient input. If provided and shgcN not,
 *             SHGC ≈ 0.87 × SC.
 * iac       — interior attenuation coefficient (blinds/shades), 0–1.
 * sunlitFrac — fraction of window not shaded by overhangs/fins (0–1).
 * shgcAngularCoeffs — optional coefficients [c0..c3] for the angle factor.
 */
function windowSolarHeatGain({
  irradiance,        // result from irradianceOnSurface
  shgcN,
  sc,
  iac = 1.0,
  sunlitFrac = 1.0,
  shgcAngularCoeffs
}) {
  let shgcNormal = Number(shgcN);
  if (!Number.isFinite(shgcNormal)) {
    if (Number.isFinite(sc)) shgcNormal = 0.87 * sc;
    else shgcNormal = 0.40; // typical clear double-pane default
  }
  const direct = irradiance.direct;
  const diffuse = irradiance.diffuse;
  const ground = irradiance.ground;
  const fDir = shgcAngleFactor(irradiance.cosTheta || 0, shgcAngularCoeffs);
  // diffuse + ground use hemispherical SHGC (~0.93 × SHGC_normal per ASHRAE)
  const shgcDiff = 0.93 * shgcNormal;
  const directGain = shgcNormal * fDir * direct * Math.max(0, sunlitFrac);
  const diffuseGain = shgcDiff * (diffuse + ground);
  return iac * (directGain + diffuseGain);
}

/**
 * Sol-air temperature for opaque surface, °C.
 * α  — solar absorptance (0.9 dark, 0.5 medium, 0.3 light)
 * Et — total solar incident on surface, W/m²
 * h_o— outside film coefficient, W/(m²·K) (default 17 for summer wind)
 * dR — long-wave correction (W/m²): 0 for vertical, ~63 for horizontal roof.
 * ε  — long-wave emittance (default 1.0 for matte surfaces)
 */
function solAirTemperature({ tempOutC, Et, alpha = 0.7, ho = 17, dR = 0, epsilon = 1.0 }) {
  return tempOutC + (alpha * Math.max(Et, 0) - epsilon * dR) / Math.max(ho, 1);
}

/**
 * Overhang shading: sunlit height fraction on a vertical window with a
 * horizontal projection P (m) above the window, with offset h_above (m)
 * between window head and overhang.
 *
 *   shadowHeight = P · tan(profile_angle)
 *   profile_angle: tan φ = tan(β) / cos(γ)  (γ = wall-solar azimuth)
 *   sunlitHeight = max(0, windowHeight - max(0, shadowHeight - h_above))
 */
function overhangSunlitFraction({
  projection,
  offsetAbove = 0,
  windowHeight,
  position,
  surfaceAzimuthDeg
}) {
  if (!position || !position.isAboveHorizon) return 0;
  const gamma = (position.azimuthDeg - surfaceAzimuthDeg) * DEG;
  const cosGamma = Math.cos(gamma);
  if (cosGamma <= 0) return 1; // sun is behind wall: window itself in shade or outside scope
  const tanProfile = Math.tan(position.altitudeRad) / cosGamma;
  const shadow = Math.max(0, projection * tanProfile - offsetAbove);
  const sunlit = Math.max(0, windowHeight - shadow);
  return Math.min(1, sunlit / Math.max(windowHeight, 1e-6));
}

module.exports = {
  declinationDeg: declinationDeg,
  equationOfTimeMin: equationOfTimeMin,
  apparentSolarTime: apparentSolarTime,
  hourAngleDeg: hourAngleDeg,
  solarPosition: solarPosition,
  cosIncidenceAngle: cosIncidenceAngle,
  relativeAirMass: relativeAirMass,
  clearSkyIrradiance: clearSkyIrradiance,
  irradianceOnSurface: irradianceOnSurface,
  shgcAngleFactor: shgcAngleFactor,
  windowSolarHeatGain: windowSolarHeatGain,
  solAirTemperature: solAirTemperature,
  overhangSunlitFraction: overhangSunlitFraction
};
