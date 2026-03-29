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

  const ORIENTATION_MULTIPLIER = {
    N: 0.55,
    NE: 0.82,
    E: 1.14,
    SE: 1.08,
    S: 0.95,
    SW: 1.08,
    W: 1.16,
    NW: 0.84
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

  function clearSkyDirectNormalIrradiance(altitude) {
    if (altitude <= 0) {
      return 0;
    }
    const sinAltitude = Math.sin(degToRad(altitude));
    const beamA = 1160;
    const beamB = 0.21;
    return beamA * Math.exp(-beamB / Math.max(sinAltitude, 0.05));
  }

  function diffuseIrradiance(dni) {
    return 0.12 * dni;
  }

  function groundReflectedComponent(dni, altitude) {
    return 0.18 * dni * Math.sin(degToRad(Math.max(altitude, 0))) * 0.5;
  }

  function hourlySHGF(latitude, dayOfYear, solarHour, orientation) {
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
        shgf: 0
      };
    }

    const azimuth = solarAzimuth(latitude, declination, hourAngle, altitude);
    const surfaceAzimuth = ORIENTATION_AZIMUTH[orientation] || 180;
    const incidence = incidenceAngle(altitude, azimuth, surfaceAzimuth);
    const dni = clearSkyDirectNormalIrradiance(altitude);
    const direct = incidence < 90 ? dni * Math.cos(degToRad(incidence)) : 0;
    const diffuse = diffuseIrradiance(dni);
    const ground = groundReflectedComponent(dni, altitude);
    const multiplier = ORIENTATION_MULTIPLIER[orientation] || 1;
    const shgf = Math.max(0, (direct + diffuse + ground) * multiplier);

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
      shgf: shgf
    };
  }

  function hourlyCurve(latitude, dayOfYear, orientation, startHour, endHour) {
    const fromHour = startHour == null ? 8 : startHour;
    const toHour = endHour == null ? 17 : endHour;
    const rows = [];
    for (let hour = fromHour; hour <= toHour; hour += 1) {
      rows.push(hourlySHGF(latitude, dayOfYear, hour, orientation));
    }
    return rows;
  }

  function buildOrientationSeries(latitude, dayOfYear, startHour, endHour) {
    return Object.keys(ORIENTATION_AZIMUTH).map(function (orientation) {
      return {
        orientation: orientation,
        color: ORIENTATION_COLORS[orientation],
        points: hourlyCurve(latitude, dayOfYear, orientation, startHour, endHour)
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
      + '<text x="' + padding.left + '" y="' + (padding.top - 4) + '" fill="#5f6783" font-size="9">SHGF (W/m2)</text>'
      + '<text x="' + (width / 2) + '" y="' + (height - 4) + '" text-anchor="middle" fill="#5f6783" font-size="9">Solar hour 8:00-17:00 | Day ' + options.dayOfYear + " | Lat " + options.latitude.toFixed(1) + " deg | " + activeOrientation + " facade</text>";
  }

  window.SolarEngine = {
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
}());
