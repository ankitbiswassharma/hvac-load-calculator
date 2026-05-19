(function () {
  const ORIENTATION_AZIMUTH = {
    N: 0,
    NE: 45,
    E: 90,
    SE: 135,
    S: 180,
    SW: 225,
    W: 270,
    NW: 315
  };

  // Orientation is already captured by the incidence-angle math (cos θ from
  // solar position and surface azimuth). Multiplying again by these fixed
  // factors double-counted orientation: north walls were reduced twice, west
  // walls were inflated by 16%. All entries are now 1.0 so that the legacy
  // factor is a no-op. The variable is kept so external callers do not break.
  const ORIENTATION_MULTIPLIER = {
    N: 1, NE: 1, E: 1, SE: 1, S: 1, SW: 1, W: 1, NW: 1
  };

  const ORIENTATION_COLORS = {
    N: "#8891ac",
    NE: "#22d3ee",
    E: "#f59e0b",
    SE: "#00d4aa",
    S: "#ef4444",
    SW: "#a855f7",
    W: "#3b9eff",
    NW: "#fb923c"
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function degToRad(value) {
    return value * Math.PI / 180;
  }

  function radToDeg(value) {
    return value * 180 / Math.PI;
  }

  function solarDeclination(dayOfYear) {
    const gamma = 2 * Math.PI * (dayOfYear - 1) / 365;
    return radToDeg(
      0.006918
      - 0.399912 * Math.cos(gamma)
      + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma)
      + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma)
      + 0.00148 * Math.sin(3 * gamma)
    );
  }

  function solarAltitude(latitude, declination, hourAngle) {
    const latRad = degToRad(latitude);
    const decRad = degToRad(declination);
    const haRad = degToRad(hourAngle);
    const sinAltitude = Math.sin(latRad) * Math.sin(decRad)
      + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
    return radToDeg(Math.asin(clamp(sinAltitude, -1, 1)));
  }

  function solarAzimuth(latitude, declination, hourAngle, altitude) {
    const latRad = degToRad(latitude);
    const decRad = degToRad(declination);
    const altRad = degToRad(altitude);
    const numerator = Math.sin(decRad) - Math.sin(latRad) * Math.sin(altRad);
    const denominator = Math.cos(latRad) * Math.cos(altRad) || 1e-9;
    let azimuth = radToDeg(Math.acos(clamp(numerator / denominator, -1, 1)));
    if (hourAngle < 0) {
      azimuth = 180 - azimuth;
    } else {
      azimuth = 180 + azimuth;
    }
    return (azimuth + 360) % 360;
  }

  function hourAngleFromSolarHour(hour) {
    return (hour - 12) * 15;
  }

  function incidenceAngle(altitude, solarAzimuthDeg, surfaceAzimuthDeg) {
    const altitudeRad = degToRad(altitude);
    const azimuthDelta = degToRad(solarAzimuthDeg - surfaceAzimuthDeg);
    const cosTheta = Math.cos(altitudeRad) * Math.cos(azimuthDelta);
    return radToDeg(Math.acos(clamp(cosTheta, 0, 1)));
  }

  // ASHRAE HOF Ch 14 monthly clear-sky (A, B, C) coefficients.
  // A — apparent solar constant (W/m²)
  // B — atmospheric extinction (-)
  // C — diffuse sky factor (-)
  const ASHRAE_CLEAR_SKY = [
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

  function monthIndexFromDayOfYear(dayOfYear) {
    const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
    for (let m = 0; m < 12; m++) {
      if (dayOfYear <= cum[m + 1]) return m;
    }
    return 11;
  }

  function ashraeMonthlyCoeffs(dayOfYear) {
    return ASHRAE_CLEAR_SKY[monthIndexFromDayOfYear(dayOfYear || 172)];
  }

  function clearSkyDirectNormalIrradiance(altitude, dayOfYear) {
    if (altitude <= 0) return 0;
    const sinAlt = Math.sin(degToRad(altitude));
    const { A, B } = ashraeMonthlyCoeffs(dayOfYear);
    return A * Math.exp(-B / Math.max(sinAlt, 1e-3));
  }

  // Diffuse on a horizontal surface = C × DNI. For a tilted surface multiply
  // by the sky-view factor (1 + cos Σ)/2 — caller is responsible. The
  // legacy code returned 0.12*DNI for all tilts; we keep the signature but
  // now compute the monthly value.
  function diffuseIrradiance(dni, dayOfYear) {
    const { C } = ashraeMonthlyCoeffs(dayOfYear);
    return C * dni;
  }

  // Ground-reflected on a vertical surface (view factor 0.5).
  // E_r = (DNI·sinβ + E_d_horiz) · ρ_g · (1 − cos Σ)/2
  // For Σ=90° (vertical wall), (1 − cos Σ)/2 = 0.5; ρ_g = 0.2 default.
  function groundReflectedComponent(dni, altitude, dayOfYear, groundReflectance) {
    const sinAlt = Math.sin(degToRad(Math.max(altitude, 0)));
    const ghi = dni * sinAlt + diffuseIrradiance(dni, dayOfYear);
    const rho = groundReflectance != null ? groundReflectance : 0.20;
    return ghi * rho * 0.5;
  }

  function hourlySHGF(latitude, dayOfYear, solarHour, orientation, options) {
    const settings = options || {};
    const glassSHGC = Math.max(settings.glassSHGC != null ? settings.glassSHGC : settings.shadingCoefficient != null ? settings.shadingCoefficient : 0.87, 0);
    const coolingLoadFactor = Math.max(settings.coolingLoadFactor != null ? settings.coolingLoadFactor : 1, 0);
    const declination = solarDeclination(dayOfYear);
    const hourAngle = hourAngleFromSolarHour(solarHour);
    const altitude = solarAltitude(latitude, declination, hourAngle);
    if (altitude <= 0) {
      return {
        hour: solarHour,
        declination: declination,
        hourAngle: hourAngle,
        altitude: 0,
        azimuth: 0,
        incidence: 90,
        direct: 0,
        diffuse: 0,
        ground: 0,
        multiplier: ORIENTATION_MULTIPLIER[orientation] || 1,
        shgf: 0,
        solarIrradianceWm2: 0,
        incidentSolarOnGlassWm2: 0,
        glassSHGC: glassSHGC,
        shadingCoefficient: glassSHGC,
        solarHeatGainWm2: 0,
        coolingLoadSolarWm2: 0,
        clfAdjustedSolarLoadWm2: 0,
        valueBasis: "effective_glass_cooling_load_w_m2"
      };
    }

    const azimuth = solarAzimuth(latitude, declination, hourAngle, altitude);
    const surfaceAzimuth = ORIENTATION_AZIMUTH[orientation] || 180;
    const incidence = incidenceAngle(altitude, azimuth, surfaceAzimuth);
    const dni = clearSkyDirectNormalIrradiance(altitude, dayOfYear);
    const direct = incidence < 90 ? dni * Math.cos(degToRad(incidence)) : 0;
    const diffuse = diffuseIrradiance(dni, dayOfYear);
    const ground = groundReflectedComponent(dni, altitude, dayOfYear);
    const multiplier = ORIENTATION_MULTIPLIER[orientation] || 1;
    const skySolarIrradiance = Math.max(0, direct + diffuse + ground);
    const incidentSolarIrradiance = Math.max(0, skySolarIrradiance * multiplier);
    const incidenceModifier = clamp(1 - Math.pow(Math.max(incidence, 0) / 95, 2) * 0.22, 0.55, 1);
    const incidentSolarOnGlassWm2 = incidentSolarIrradiance * incidenceModifier;
    const solarHeatGainWm2 = incidentSolarOnGlassWm2 * glassSHGC;
    const coolingLoadSolarWm2 = solarHeatGainWm2 * coolingLoadFactor;
    const shgf = coolingLoadSolarWm2;

    return {
      hour: solarHour,
      declination: declination,
      hourAngle: hourAngle,
      altitude: altitude,
      azimuth: azimuth,
      incidence: incidence,
      direct: direct,
      diffuse: diffuse,
      ground: ground,
      multiplier: multiplier,
      incidenceAngleModifier: incidenceModifier,
      solarIrradianceWm2: skySolarIrradiance,
      incidentSolarIrradianceWm2: incidentSolarIrradiance,
      incidentSolarOnGlassWm2: incidentSolarOnGlassWm2,
      glassSHGC: glassSHGC,
      shadingCoefficient: glassSHGC,
      solarHeatGainWm2: solarHeatGainWm2,
      coolingLoadSolarWm2: coolingLoadSolarWm2,
      clfAdjustedSolarLoadWm2: coolingLoadSolarWm2,
      shgf: shgf,
      valueBasis: "effective_glass_cooling_load_w_m2"
    };
  }

  function hourlyCurve(latitude, dayOfYear, orientation, startHour, endHour, options) {
    const fromHour = startHour == null ? 8 : startHour;
    const toHour = endHour == null ? 17 : endHour;
    const rows = [];
    for (let hour = fromHour; hour <= toHour; hour += 1) {
      rows.push(hourlySHGF(latitude, dayOfYear, hour, orientation, options));
    }
    return rows;
  }

  function buildOrientationSeries(latitude, dayOfYear, startHour, endHour, options) {
    return Object.keys(ORIENTATION_AZIMUTH).map(function (orientation) {
      return {
        orientation: orientation,
        color: ORIENTATION_COLORS[orientation],
        points: hourlyCurve(latitude, dayOfYear, orientation, startHour, endHour, options)
      };
    });
  }

  function renderChart(svgElement, options) {
    if (!svgElement) {
      return;
    }

    const width = options.width || 800;
    const height = options.height || 260;
    const padding = { left: 56, right: 20, top: 16, bottom: 44 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const hours = options.hours;
    const series = options.series;
    const activeOrientation = options.activeOrientation;
    const activeOrientationLabel = options.activeOrientationLabel || activeOrientation;
    const activeCurve = options.activeCurve;
    const designPoint = options.designPoint;
    const maxValue = Math.max(100, Math.max.apply(null, activeCurve.map(function (row) {
      return row.shgf;
    })));

    function xFor(index) {
      return padding.left + index / Math.max(hours.length - 1, 1) * chartWidth;
    }

    function yFor(value) {
      return padding.top + chartHeight - value / maxValue * chartHeight;
    }

    let grid = "";
    [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
      const y = yFor(maxValue * fraction);
      grid += '<line x1="' + padding.left + '" y1="' + y.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>';
      grid += '<text x="' + (padding.left - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="#5f6783" font-size="9">' + Math.round(maxValue * fraction) + "</text>";
    });

    hours.forEach(function (hour, index) {
      const x = xFor(index);
      grid += '<line x1="' + x.toFixed(1) + '" y1="' + padding.top + '" x2="' + x.toFixed(1) + '" y2="' + (height - padding.bottom) + '" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>';
      grid += '<text x="' + x.toFixed(1) + '" y="' + (height - padding.bottom + 15) + '" text-anchor="middle" fill="#5f6783" font-size="9">' + hour + ":00</text>";
    });

    const areaPath = activeCurve.map(function (row, index) {
      const prefix = index === 0 ? "M" : "L";
      return prefix + xFor(index).toFixed(1) + "," + yFor(row.shgf).toFixed(1);
    }).join(" ")
      + " L" + xFor(hours.length - 1).toFixed(1) + "," + yFor(0).toFixed(1)
      + " L" + xFor(0).toFixed(1) + "," + yFor(0).toFixed(1)
      + " Z";

    let polylines = "";
    series.forEach(function (item) {
      const points = item.points.map(function (row, index) {
        return xFor(index).toFixed(1) + "," + yFor(row.shgf).toFixed(1);
      }).join(" ");
      const active = item.orientation === activeOrientation;
      polylines += '<polyline points="' + points + '" fill="none" stroke="' + item.color + '" stroke-width="' + (active ? 2.6 : 1.1) + '" stroke-opacity="' + (active ? 1 : 0.28) + '" stroke-dasharray="' + (active ? "none" : "4,3") + '"/>';
    });

    const designIndex = Math.max(0, hours.indexOf(designPoint.hour));
    const designX = xFor(designIndex);
    const designY = yFor(designPoint.shgf);
    const activeColor = ORIENTATION_COLORS[activeOrientation] || "#00d4aa";

    svgElement.innerHTML =
      grid
      + '<path d="' + areaPath + '" fill="' + activeColor + '" fill-opacity="0.08"/>'
      + polylines
      + '<circle cx="' + designX.toFixed(1) + '" cy="' + designY.toFixed(1) + '" r="5" fill="' + activeColor + '" stroke="var(--bg3)" stroke-width="2"/>'
      + '<text x="' + designX.toFixed(1) + '" y="' + (designY - 10).toFixed(1) + '" text-anchor="middle" fill="' + activeColor + '" font-size="10" font-weight="bold">' + Math.round(designPoint.shgf) + "</text>"
      + '<text x="' + padding.left + '" y="' + (padding.top - 4) + '" fill="#5f6783" font-size="9">EFFECTIVE SOLAR LOAD (W/m2)</text>'
      + '<text x="' + (width / 2) + '" y="' + (height - 4) + '" text-anchor="middle" fill="#5f6783" font-size="9">Solar hour 8:00-17:00 | Day ' + options.dayOfYear + " | Lat " + options.latitude.toFixed(1) + " deg | " + activeOrientationLabel + "</text>";
  }

  const api = {
    ORIENTATION_AZIMUTH: ORIENTATION_AZIMUTH,
    ORIENTATION_MULTIPLIER: ORIENTATION_MULTIPLIER,
    ORIENTATION_COLORS: ORIENTATION_COLORS,
    solarDeclination: solarDeclination,
    solarAltitude: solarAltitude,
    solarAzimuth: solarAzimuth,
    hourAngleFromSolarHour: hourAngleFromSolarHour,
    incidenceAngle: incidenceAngle,
    hourlySHGF: hourlySHGF,
    hourlyCurve: hourlyCurve,
    buildOrientationSeries: buildOrientationSeries,
    renderChart: renderChart
  };
  if (typeof window !== "undefined") {
    window.SolarEngine = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
}());
