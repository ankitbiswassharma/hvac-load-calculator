(function () {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function saturationPressure(tempC) {
    return 611.21 * Math.exp((18.678 - tempC / 234.5) * tempC / (257.14 + tempC));
  }

  function relativeHumidity(tempC, humidityRatio, pressurePa) {
    const pressure = pressurePa || 101325;
    const partialVapor = humidityRatio * pressure / (0.621945 + humidityRatio);
    return clamp(partialVapor / saturationPressure(tempC) * 100, 0, 100);
  }

  function enthalpy(tempC, humidityRatio) {
    return 1.006 * tempC + humidityRatio * (2501 + 1.86 * tempC);
  }

  function overlapArea(left, right) {
    const xOverlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
    const yOverlap = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
    return xOverlap * yOverlap;
  }

  function distanceSquared(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  function chooseLabelLayouts(statePoints, xFor, yFor, bounds) {
    const keys = ["OA", "RA", "MA", "SA", "ADP"].filter(function (key) {
      return !!statePoints[key];
    }).sort(function (leftKey, rightKey) {
      const left = statePoints[leftKey];
      const right = statePoints[rightKey];
      const leftScore = left.T * 0.7 + left.W * 1000;
      const rightScore = right.T * 0.7 + right.W * 1000;
      return rightScore - leftScore;
    });
    const placements = [];
    const labelWidth = 126;
    const labelHeight = 38;
    const candidateOffsets = [
      { dx: 30, dy: -78 },
      { dx: 30, dy: 30 },
      { dx: -156, dy: -78 },
      { dx: -156, dy: 30 },
      { dx: -63, dy: -96 },
      { dx: -63, dy: 46 },
      { dx: 56, dy: -112 },
      { dx: -184, dy: 48 },
      { dx: 78, dy: -30 },
      { dx: -196, dy: -24 }
    ];

    keys.forEach(function (key) {
      const point = statePoints[key];
      const anchorX = xFor(point.T);
      const anchorY = yFor(point.W);
      let best = null;

      candidateOffsets.forEach(function (offset, index) {
        const candidate = {
          x: clamp(anchorX + offset.dx, bounds.left + 4, bounds.right - labelWidth - 4),
          y: clamp(anchorY + offset.dy, bounds.top + 4, bounds.bottom - labelHeight - 4),
          width: labelWidth,
          height: labelHeight,
          anchorX: anchorX,
          anchorY: anchorY
        };

        let score = index;
        placements.forEach(function (placed) {
          score += overlapArea(candidate, placed) * 220;
          score += overlapArea(
            candidate,
            { x: placed.anchorX - 8, y: placed.anchorY - 8, width: 16, height: 16 }
          ) * 120;
          if (distanceSquared(candidate.x + candidate.width / 2, candidate.y + candidate.height / 2, placed.x + placed.width / 2, placed.y + placed.height / 2) < 36000) {
            score += 120;
          }
        });

        keys.forEach(function (otherKey) {
          if (otherKey === key) {
            return;
          }
          const otherPoint = statePoints[otherKey];
          const otherX = xFor(otherPoint.T);
          const otherY = yFor(otherPoint.W);
          score += overlapArea(
            candidate,
            { x: otherX - 10, y: otherY - 10, width: 20, height: 20 }
          ) * 140;
          if (distanceSquared(candidate.x + candidate.width / 2, candidate.y + candidate.height / 2, otherX, otherY) < 4200) {
            score += 45;
          }
        });

        if (!best || score < best.score) {
          best = {
            score: score,
            x: candidate.x,
            y: candidate.y,
            width: labelWidth,
            height: labelHeight,
            anchorX: anchorX,
            anchorY: anchorY
          };
        }
      });

      placements.push(best);
    });

    return placements.reduce(function (map, placement, index) {
      map[keys[index]] = placement;
      return map;
    }, {});
  }

  function highlightedSegment(x1, y1, x2, y2, color, width, dash, markerId) {
    const dashMarkup = dash ? ' stroke-dasharray="' + dash + '"' : "";
    const markerMarkup = markerId ? ' marker-end="url(#' + markerId + ')"' : "";
    return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="rgba(15,23,42,0.22)" stroke-width="' + (width + 5.4) + '" stroke-linecap="round"' + dashMarkup + ' filter="url(#line-glow)"/>'
      + '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="rgba(15,23,42,0.72)" stroke-width="' + (width + 2.2) + '" stroke-linecap="round"' + dashMarkup + '/>'
      + '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round"' + dashMarkup + markerMarkup + '/>';
  }

  function renderChart(svgElement, legendElement, tableElement, statePoints, meta) {
    if (!svgElement) {
      return;
    }

    const width = 860;
    const height = 420;
    const padding = { left: 64, right: 130, top: 20, bottom: 52 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const minTemp = -5;
    const maxTemp = 55;
    const minW = 0;
    const maxW = 0.03;
    const pressure = (meta && meta.pressurePa) || 101325;
    const colors = {
      OA: "#3b9eff",
      RA: "#f59e0b",
      MA: "#a855f7",
      SA: "#00d4aa",
      ADP: "#ef4444"
    };
    const chartBounds = {
      left: padding.left,
      top: padding.top,
      right: padding.left + chartWidth,
      bottom: padding.top + chartHeight
    };

    function xFor(tempC) {
      return padding.left + (tempC - minTemp) / (maxTemp - minTemp) * chartWidth;
    }

    function yFor(humidityRatio) {
      return padding.top + chartHeight - (humidityRatio - minW) / (maxW - minW) * chartHeight;
    }

    if (!statePoints || !statePoints.OA) {
      svgElement.innerHTML = '<text x="430" y="210" text-anchor="middle" fill="#5f6783" font-size="13" font-family="IBM Plex Mono">Run calculations first</text>';
      if (legendElement) {
        legendElement.innerHTML = "";
      }
      if (tableElement) {
        tableElement.innerHTML = "";
      }
      return;
    }

    const defs =
      '<defs>'
      + '<filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      + '<marker id="oa-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#3b9eff"/></marker>'
      + '<marker id="coil-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#00d4aa"/></marker>'
      + '<marker id="room-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#f59e0b"/></marker>'
      + '<marker id="adp-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#ef4444"/></marker>'
      + "</defs>";
    const background =
      '<rect x="10" y="10" width="' + (width - 20) + '" height="' + (height - 20) + '" rx="20" fill="#ffffff" stroke="#d7e3f1" stroke-width="1.2"/>'
      + '<rect x="' + padding.left + '" y="' + padding.top + '" width="' + chartWidth + '" height="' + chartHeight + '" rx="18" fill="#fbfdff" stroke="#c9d6e6" stroke-width="1.1"/>';
    const axes =
      '<line x1="' + chartBounds.left + '" y1="' + chartBounds.bottom + '" x2="' + chartBounds.right + '" y2="' + chartBounds.bottom + '" stroke="#607089" stroke-width="1.2"/>'
      + '<line x1="' + chartBounds.left + '" y1="' + chartBounds.top + '" x2="' + chartBounds.left + '" y2="' + chartBounds.bottom + '" stroke="#607089" stroke-width="1.2"/>';

    let grid = "";
    for (let temp = 0; temp <= 50; temp += 5) {
      const x = xFor(temp);
      grid += '<line x1="' + x.toFixed(1) + '" y1="' + padding.top + '" x2="' + x.toFixed(1) + '" y2="' + (padding.top + chartHeight) + '" stroke="rgba(45,55,72,0.08)" stroke-width="1"/>';
      grid += '<text x="' + x.toFixed(1) + '" y="' + (padding.top + chartHeight + 16) + '" text-anchor="middle" fill="#6c7994" font-size="10">' + temp + "</text>";
    }

    for (let humidity = 0; humidity <= 0.03; humidity += 0.005) {
      const y = yFor(humidity);
      grid += '<line x1="' + padding.left + '" y1="' + y.toFixed(1) + '" x2="' + (padding.left + chartWidth) + '" y2="' + y.toFixed(1) + '" stroke="rgba(45,55,72,0.08)" stroke-width="1"/>';
      grid += '<text x="' + (padding.left - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="#6c7994" font-size="10">' + (humidity * 1000).toFixed(0) + "</text>";
    }

    let saturationPath = "";
    for (let temp = minTemp; temp <= maxTemp; temp += 0.5) {
      const satW = 0.621945 * saturationPressure(temp) / (pressure - saturationPressure(temp));
      if (satW <= maxW) {
        saturationPath += (saturationPath ? "L" : "M") + xFor(temp).toFixed(1) + "," + yFor(satW).toFixed(1);
      }
    }

    let rhLines = "";
    [10, 20, 30, 40, 50, 60, 70, 80, 90].forEach(function (rh) {
      let path = "";
      for (let temp = minTemp; temp <= maxTemp; temp += 1) {
        const pv = saturationPressure(temp) * rh / 100;
        const ratio = 0.621945 * pv / (pressure - pv);
        if (ratio <= maxW) {
          path += (path ? "L" : "M") + xFor(temp).toFixed(1) + "," + yFor(ratio).toFixed(1);
        }
      }
      if (path) {
        rhLines += '<path d="' + path + '" fill="none" stroke="rgba(71,85,105,0.18)" stroke-width="0.9"/>';
        const labelTemp = 50;
        const pv = saturationPressure(labelTemp) * rh / 100;
        const ratio = 0.621945 * pv / (pressure - pv);
        if (ratio <= maxW) {
          rhLines += '<text x="' + (xFor(labelTemp) + 4).toFixed(1) + '" y="' + yFor(ratio).toFixed(1) + '" fill="rgba(55,65,81,0.50)" font-size="8">' + rh + "%</text>";
        }
      }
    });

    const labelLayouts = chooseLabelLayouts(
      {
        OA: { T: clamp(statePoints.OA.T, minTemp, maxTemp), W: clamp(statePoints.OA.W, minW, maxW) },
        RA: { T: clamp(statePoints.RA.T, minTemp, maxTemp), W: clamp(statePoints.RA.W, minW, maxW) },
        MA: { T: clamp(statePoints.MA.T, minTemp, maxTemp), W: clamp(statePoints.MA.W, minW, maxW) },
        SA: { T: clamp(statePoints.SA.T, minTemp, maxTemp), W: clamp(statePoints.SA.W, minW, maxW) },
        ADP: { T: clamp(statePoints.ADP.T, minTemp, maxTemp), W: clamp(statePoints.ADP.W, minW, maxW) }
      },
      xFor,
      yFor,
      chartBounds
    );

    function pointMarkup(key, point) {
      const x = xFor(clamp(point.T, minTemp, maxTemp));
      const y = yFor(clamp(point.W, minW, maxW));
      const color = colors[key];
      const box = labelLayouts[key];
      const leaderX = box.x + (box.x + box.width / 2 < x ? box.width : 0);
      const leaderY = clamp(box.y + box.height / 2, box.y + 8, box.y + box.height - 8);
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="11" fill="rgba(71,85,105,0.14)"/>'
        + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="8" fill="' + color + '" stroke="rgba(15,23,42,0.9)" stroke-width="2.2"/>'
        + '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + leaderX.toFixed(1) + '" y2="' + leaderY.toFixed(1) + '" stroke="' + color + '" stroke-width="1.4" stroke-opacity="0.92"/>'
        + '<rect x="' + box.x.toFixed(1) + '" y="' + box.y.toFixed(1) + '" width="' + box.width + '" height="' + box.height + '" rx="6" fill="rgba(248,250,252,0.97)" stroke="' + color + '" stroke-width="1.1"/>'
        + '<text x="' + (box.x + 8).toFixed(1) + '" y="' + (box.y + 14).toFixed(1) + '" fill="' + color + '" font-size="10" font-weight="bold">' + key + " - " + point.label + "</text>"
        + '<text x="' + (box.x + 8).toFixed(1) + '" y="' + (box.y + 29).toFixed(1) + '" fill="#152033" font-size="8.5">' + point.T.toFixed(1) + "C / " + (point.W * 1000).toFixed(1) + " g/kg</text>";
    }

    function boxedLineLabel(label, x, y, color) {
      const width = label.length * 5.7 + 12;
      const boxX = clamp(x - width / 2, padding.left + 6, padding.left + chartWidth - width - 6);
      const boxY = clamp(y - 10, padding.top + 6, padding.top + chartHeight - 18);
      return '<rect x="' + boxX.toFixed(1) + '" y="' + boxY.toFixed(1) + '" width="' + width.toFixed(1) + '" height="16" rx="5" fill="rgba(15,23,42,0.78)" stroke="' + color + '" stroke-width="0.8"/>'
        + '<text x="' + (boxX + width / 2).toFixed(1) + '" y="' + (boxY + 11).toFixed(1) + '" text-anchor="middle" fill="' + color + '" font-size="8.2">' + label + "</text>";
    }

    const processLines =
      highlightedSegment(xFor(statePoints.OA.T), yFor(statePoints.OA.W), xFor(statePoints.MA.T), yFor(statePoints.MA.W), "#3b9eff", 2.2, "6,4", "oa-arrow")
      + highlightedSegment(xFor(statePoints.MA.T), yFor(statePoints.MA.W), xFor(statePoints.SA.T), yFor(statePoints.SA.W), "#00d4aa", 3.0, "", "coil-arrow")
      + highlightedSegment(xFor(statePoints.MA.T), yFor(statePoints.MA.W), xFor(statePoints.ADP.T), yFor(statePoints.ADP.W), "#7fe8cf", 1.7, "5,4", "adp-arrow")
      + highlightedSegment(xFor(statePoints.SA.T), yFor(statePoints.SA.W), xFor(statePoints.RA.T), yFor(statePoints.RA.W), "#f59e0b", 2.6, "", "room-arrow")
      + highlightedSegment(xFor(statePoints.SA.T), yFor(statePoints.SA.W), xFor(statePoints.ADP.T), yFor(statePoints.ADP.W), "#ef4444", 1.8, "4,4", "adp-arrow")
      + boxedLineLabel("OA to MA", (xFor(statePoints.OA.T) + xFor(statePoints.MA.T)) / 2, (yFor(statePoints.OA.W) + yFor(statePoints.MA.W)) / 2 - 16, "#3b9eff")
      + boxedLineLabel("Cooling coil", (xFor(statePoints.MA.T) + xFor(statePoints.SA.T)) / 2, (yFor(statePoints.MA.W) + yFor(statePoints.SA.W)) / 2 - 16, "#00d4aa")
      + boxedLineLabel("SHR line", (xFor(statePoints.SA.T) + xFor(statePoints.RA.T)) / 2, (yFor(statePoints.SA.W) + yFor(statePoints.RA.W)) / 2 - 16, "#f59e0b")
      + boxedLineLabel("Bypass factor", (xFor(statePoints.SA.T) + xFor(statePoints.ADP.T)) / 2, (yFor(statePoints.SA.W) + yFor(statePoints.ADP.W)) / 2 + 18, "#ef4444");

    svgElement.innerHTML =
      defs
      + background
      + grid
      + axes
      + rhLines
      + '<path d="' + saturationPath + '" fill="none" stroke="rgba(0,146,116,0.86)" stroke-width="2.5"/>'
      + '<text x="' + padding.left + '" y="' + (padding.top - 6) + '" fill="#52627d" font-size="9">Humidity ratio (g/kg dry air)</text>'
      + '<text x="' + (width / 2) + '" y="' + (height - 4) + '" text-anchor="middle" fill="#52627d" font-size="9">Dry bulb temperature (deg C)</text>'
      + '<text x="' + (width - padding.right + 8) + '" y="' + (padding.top + 12) + '" fill="#52627d" font-size="8">RH%</text>'
      + processLines
      + pointMarkup("OA", statePoints.OA)
      + pointMarkup("RA", statePoints.RA)
      + pointMarkup("MA", statePoints.MA)
      + pointMarkup("SA", statePoints.SA)
      + pointMarkup("ADP", statePoints.ADP);

    if (legendElement) {
      legendElement.innerHTML = [
        ["OA", colors.OA, "Outdoor air"],
        ["RA", colors.RA, "Return air"],
        ["MA", colors.MA, "Mixed air"],
        ["SA", colors.SA, "Supply air"],
        ["ADP", colors.ADP, "Coil ADP"]
      ].map(function (item) {
        return '<div style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11px;color:var(--text2);"><span style="width:10px;height:10px;border-radius:50%;background:' + item[1] + ';flex-shrink:0;"></span>' + item[2] + "</div>";
      }).join("");
    }

    if (tableElement) {
      tableElement.innerHTML =
        '<table class="calc-table"><thead><tr><th>POINT</th><th>NAME</th><th>DBT (deg C)</th><th>W (g/kg)</th><th>RH (%)</th><th>h (kJ/kg)</th></tr></thead><tbody>'
        + Object.keys(statePoints).map(function (key) {
          const point = statePoints[key];
          return '<tr><td style="color:' + colors[key] + ';font-weight:600;">' + key + '</td><td>' + point.label + "</td><td>" + point.T.toFixed(1) + "</td><td>" + (point.W * 1000).toFixed(2) + "</td><td>" + relativeHumidity(point.T, point.W, pressure).toFixed(0) + "</td><td>" + enthalpy(point.T, point.W).toFixed(1) + "</td></tr>";
        }).join("")
        + '<tr class="total-row"><td colspan="3"><b>Room SHR</b></td><td colspan="3" class="num"><b>' + ((meta && meta.shr) || 0).toFixed(3) + '</b></td></tr>'
        + '<tr><td colspan="3">Bypass factor</td><td colspan="3" class="num">' + ((meta && meta.bypassFactor) || 0).toFixed(3) + "</td></tr>"
        + "</tbody></table>";
    }
  }

  window.PsychroChart = {
    relativeHumidity: relativeHumidity,
    enthalpy: enthalpy,
    renderChart: renderChart
  };
}());
