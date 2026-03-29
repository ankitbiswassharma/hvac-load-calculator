(function () {
  const CFM_TO_M3S = 0.00047194745;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundTo(value, digits) {
    const factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
  }

  function safeDiv(numerator, denominator, fallback) {
    return denominator ? numerator / denominator : (fallback || 0);
  }

  function buildAxisPositions(span, count, offset) {
    if (count <= 1) {
      return [span / 2];
    }
    const usable = Math.max(span - offset * 2, 0);
    const step = usable / Math.max(count - 1, 1);
    const values = [];
    for (let index = 0; index < count; index += 1) {
      values.push(offset + step * index);
    }
    return values;
  }

  function chooseGrid(requiredCount, length, width, wallOffset, maxSpacing) {
    let best = null;

    for (let rows = 1; rows <= Math.max(requiredCount, 1); rows += 1) {
      const cols = Math.ceil(requiredCount / rows);
      const actualCount = rows * cols;
      const xPositions = buildAxisPositions(length, cols, wallOffset);
      const yPositions = buildAxisPositions(width, rows, wallOffset);
      const spacingX = cols > 1 ? xPositions[1] - xPositions[0] : 0;
      const spacingY = rows > 1 ? yPositions[1] - yPositions[0] : 0;
      const roomRatio = safeDiv(length, width, 1);
      const gridRatio = safeDiv(cols, rows, 1);
      const aspectPenalty = Math.abs(gridRatio - roomRatio);
      const excessPenalty = actualCount - requiredCount;
      const spacingPenalty = Math.max(0, spacingX - maxSpacing) + Math.max(0, spacingY - maxSpacing);
      const score = aspectPenalty * 8 + excessPenalty * 3 + spacingPenalty * 15;

      if (!best || score < best.score) {
        best = {
          rows: rows,
          cols: cols,
          actualCount: actualCount,
          xPositions: xPositions,
          yPositions: yPositions,
          spacingX: spacingX,
          spacingY: spacingY,
          score: score
        };
      }
    }

    return best || {
      rows: 1,
      cols: 1,
      actualCount: 1,
      xPositions: [length / 2],
      yPositions: [width / 2],
      spacingX: 0,
      spacingY: 0,
      score: 0
    };
  }

  function estimateThrow(cfmPerDevice, ceilingHeight, throwProfile) {
    if (throwProfile === "high_bay") {
      return 0.36 * Math.sqrt(Math.max(cfmPerDevice, 0)) + ceilingHeight * 0.55;
    }
    if (throwProfile === "long_throw") {
      return 0.30 * Math.sqrt(Math.max(cfmPerDevice, 0)) + ceilingHeight * 0.35;
    }
    if (throwProfile === "industrial") {
      return 0.24 * Math.sqrt(Math.max(cfmPerDevice, 0)) + ceilingHeight * 0.35;
    }
    return 0.22 * Math.sqrt(Math.max(cfmPerDevice, 0)) + ceilingHeight * 0.18;
  }

  function buildSupplies(grid) {
    const supplies = [];
    grid.yPositions.forEach(function (y) {
      grid.xPositions.forEach(function (x) {
        supplies.push({
          x: roundTo(x, 2),
          y: roundTo(y, 2)
        });
      });
    });
    return supplies;
  }

  function buildReturns(length, width, wallOffset, totalAirflowCFM, industrialMode) {
    const totalArea = Math.max(totalAirflowCFM * CFM_TO_M3S / 2.5, 0.12);
    const count = industrialMode || totalAirflowCFM > 4000 ? Math.max(2, Math.ceil(totalAirflowCFM / 5000)) : 1;
    const areaPerReturn = totalArea / count;
    const grilleWidth = roundTo(Math.sqrt(areaPerReturn * 1.6), 2);
    const grilleHeight = roundTo(areaPerReturn / Math.max(grilleWidth, 0.1), 2);
    const alongLength = length >= width;
    const side = alongLength ? "east wall" : "north wall";
    const coords = [];

    if (alongLength) {
      const yPositions = buildAxisPositions(width, count, wallOffset);
      yPositions.forEach(function (y) {
        coords.push({
          x: roundTo(length - wallOffset, 2),
          y: roundTo(y, 2)
        });
      });
    } else {
      const xPositions = buildAxisPositions(length, count, wallOffset);
      xPositions.forEach(function (x) {
        coords.push({
          x: roundTo(x, 2),
          y: roundTo(width - wallOffset, 2)
        });
      });
    }

    return {
      count: count,
      type: industrialMode ? "High-wall return grille" : "Ceiling return grille",
      side: side,
      width: grilleWidth,
      height: grilleHeight,
      totalArea: roundTo(totalArea, 3),
      maxFaceVelocity: 2.5,
      coords: coords,
      locationNote: "Placed opposite the supply field to reduce short-circuiting."
    };
  }

  function requiredThrowDistance(length, width, wallOffset, grid) {
    const xRequirement = grid.cols > 1
      ? grid.spacingX * 0.75
      : Math.max(length / 2 - wallOffset, wallOffset);
    const yRequirement = grid.rows > 1
      ? grid.spacingY * 0.75
      : Math.max(width / 2 - wallOffset, wallOffset);
    return Math.max(wallOffset, xRequirement, yRequirement);
  }

  function evaluateCandidate(requiredCount, config) {
    const grid = chooseGrid(requiredCount, config.length, config.width, config.wallOffset, config.maxSpacing);
    const cfmPerDevice = safeDiv(config.totalAirflowCFM, grid.actualCount, 0);
    const throwDistance = estimateThrow(cfmPerDevice, config.ceilingHeight, config.throwProfile);
    const verticalReachRequired = config.ceilingHeight * (config.verticalReachFactor || 0);
    const requiredThrow = Math.max(requiredThrowDistance(config.length, config.width, config.wallOffset, grid), verticalReachRequired);
    const spacingPass = (grid.cols <= 1 || grid.spacingX <= config.maxSpacing + 0.01)
      && (grid.rows <= 1 || grid.spacingY <= config.maxSpacing + 0.01);
    const throwPass = throwDistance >= requiredThrow;
    const cfmRangePass = cfmPerDevice >= config.minCFMPerDiffuser - 0.1
      && cfmPerDevice <= config.maxCFMPerDiffuser + 0.1;
    const cfmPenalty = cfmPerDevice < config.minCFMPerDiffuser
      ? (config.minCFMPerDiffuser - cfmPerDevice) / Math.max(config.minCFMPerDiffuser, 1)
      : cfmPerDevice > config.maxCFMPerDiffuser
        ? (cfmPerDevice - config.maxCFMPerDiffuser) / Math.max(config.maxCFMPerDiffuser, 1)
        : 0;
    const score = (spacingPass ? 0 : 60 + Math.max(grid.spacingX - config.maxSpacing, 0) + Math.max(grid.spacingY - config.maxSpacing, 0))
      + (throwPass ? 0 : 40 + (requiredThrow - throwDistance) * 12)
      + cfmPenalty * 30
      + Math.abs(cfmPerDevice - config.targetCFM) / Math.max(config.targetCFM, 1) * 8
      + (grid.actualCount - requiredCount) * 1.5;

    return {
      diffuserCount: grid.actualCount,
      rows: grid.rows,
      cols: grid.cols,
      spacingX: roundTo(grid.spacingX, 2),
      spacingY: roundTo(grid.spacingY, 2),
      maxSpacing: roundTo(config.maxSpacing, 2),
      maxSpacingFactor: config.maxSpacingFactor,
      wallOffset: roundTo(config.wallOffset, 2),
      cfmPerDiffuser: roundTo(cfmPerDevice, 1),
      minCFMPerDiffuser: config.minCFMPerDiffuser,
      maxCFMPerDiffuser: config.maxCFMPerDiffuser,
      throwDistance: roundTo(throwDistance, 2),
      requiredThrow: roundTo(requiredThrow, 2),
      verticalReachRequired: roundTo(verticalReachRequired, 2),
      throwFactor: config.throwFactor,
      cfmRangePass: cfmRangePass,
      undersized: cfmPerDevice < config.minCFMPerDiffuser - 0.1,
      oversized: cfmPerDevice > config.maxCFMPerDiffuser + 0.1,
      spacingPass: spacingPass,
      throwPass: throwPass,
      supplies: buildSupplies(grid),
      returns: buildReturns(config.length, config.width, config.wallOffset, config.totalAirflowCFM, config.industrialMode),
      score: score
    };
  }

  function selectionBasisText(layout) {
    const status = [];

    if (layout.cfmRangePass) {
      status.push("airflow per outlet stays inside the preferred band");
    } else if (layout.undersized) {
      status.push("outlet count is limited by minimum CFM per device, so zoning or a higher-throw device should be considered instead of adding undersized outlets");
    } else {
      status.push("airflow per outlet is above the preferred band and a larger outlet family may be required");
    }

    status.push(layout.spacingPass ? "spacing limit passes" : "spacing exceeds the preferred ceiling-height rule");
    status.push(layout.throwPass ? "throw / occupied-zone delivery check passes" : "throw / occupied-zone delivery review is required");

    return layout.distributionMode + " distribution selected because airflow density is "
      + roundTo(layout.airflowPerArea, 1)
      + " CFM/m² against a threshold of "
      + roundTo(layout.airflowPerAreaThreshold, 1)
      + " CFM/m²; "
      + status.join(", ")
      + ".";
  }

  function computeSingleLayout(options) {
    const settings = options || {};
    const length = Math.max(settings.length || 0, 0);
    const width = Math.max(settings.width || 0, 0);
    const ceilingHeight = Math.max(settings.ceilingHeight || 3, 2.4);
    const totalAirflowCFM = Math.max(settings.totalAirflowCFM || 0, 0);
    const area = Math.max(length * width, 1);
    const airflowPerArea = totalAirflowCFM / area;
    const airflowPerAreaThreshold = Math.max(settings.industrialAirflowPerAreaThreshold || 22, 8);
    const highBayMode = ceilingHeight >= 10;
    const longThrowMode = ceilingHeight >= 7.5;
    const industrialMode = !!(settings.forceIndustrialTerminals || airflowPerArea > airflowPerAreaThreshold || longThrowMode);
    const wallOffset = industrialMode
      ? clamp(Math.min(length, width) * 0.08, 0.75, 1.0)
      : clamp(Math.min(length, width) * 0.08, 0.5, 0.9);

    const config = highBayMode
      ? {
          length: length,
          width: width,
          ceilingHeight: ceilingHeight,
          totalAirflowCFM: totalAirflowCFM,
          industrialMode: true,
          supplyDeviceType: "High-bay jet nozzle",
          distributionMode: "High-bay industrial",
          targetCFM: clamp(settings.highBayTargetCFM || 2200, 1400, 3200),
          minCFMPerDiffuser: Math.max(settings.highBayMinCFM || 1200, 900),
          maxCFMPerDiffuser: Math.max(settings.highBayMaxCFM || 3600, 2400),
          maxSpacingFactor: 2.8,
          maxSpacing: ceilingHeight * 2.8,
          wallOffset: clamp(Math.min(length, width) * 0.08, 1.0, 1.5),
          throwFactor: 0.85,
          verticalReachFactor: 0.85,
          throwProfile: "high_bay"
        }
      : (longThrowMode || industrialMode)
        ? {
            length: length,
            width: width,
            ceilingHeight: ceilingHeight,
            totalAirflowCFM: totalAirflowCFM,
            industrialMode: true,
            supplyDeviceType: settings.largeIndustrialHall ? "Air sock / long-throw jet" : "Jet / nozzle diffuser",
            distributionMode: "Industrial",
            targetCFM: clamp(settings.industrialTargetCFM || (settings.largeIndustrialHall ? 1500 : 900), 650, 2000),
            minCFMPerDiffuser: Math.max(settings.industrialMinCFM || (settings.largeIndustrialHall ? 700 : 450), 400),
            maxCFMPerDiffuser: Math.max(settings.industrialMaxCFM || (settings.largeIndustrialHall ? 2400 : 1400), 900),
            maxSpacingFactor: settings.largeIndustrialHall ? 2.6 : 2.25,
            maxSpacing: ceilingHeight * (settings.largeIndustrialHall ? 2.6 : 2.25),
            wallOffset: wallOffset,
            throwFactor: 0.8,
            verticalReachFactor: settings.largeIndustrialHall ? 0.7 : 0.6,
            throwProfile: settings.largeIndustrialHall ? "long_throw" : "industrial"
          }
        : {
            length: length,
            width: width,
            ceilingHeight: ceilingHeight,
            totalAirflowCFM: totalAirflowCFM,
            industrialMode: false,
            supplyDeviceType: "4-way ceiling diffuser",
            distributionMode: "Comfort",
            targetCFM: clamp(settings.targetCFM || 225, 180, 300),
            minCFMPerDiffuser: clamp(settings.minCFMPerDiffuser || 150, 120, 250),
            maxCFMPerDiffuser: clamp(settings.maxCFMPerDiffuser || 400, 250, 450),
            maxSpacingFactor: 1.5,
            maxSpacing: ceilingHeight * 1.5,
            wallOffset: wallOffset,
            throwFactor: 0.75,
            verticalReachFactor: 0.35,
            throwProfile: "comfort"
          };

    const minCountByAirflow = Math.max(1, Math.ceil(totalAirflowCFM / Math.max(config.maxCFMPerDiffuser, 1)));
    const maxCountWithoutUndersizing = Math.max(1, Math.floor(totalAirflowCFM / Math.max(config.minCFMPerDiffuser, 1)));
    const airflowBandFeasible = totalAirflowCFM >= config.minCFMPerDiffuser - 0.1;
    const countLowerBound = minCountByAirflow;
    const countUpperBound = airflowBandFeasible
      ? Math.max(countLowerBound, maxCountWithoutUndersizing)
      : countLowerBound;
    const baseCount = Math.max(1, Math.ceil(totalAirflowCFM / Math.max(config.targetCFM, 1)), minCountByAirflow);
    let bestPassing = null;
    let bestProtectedFallback = null;
    let bestFallback = null;

    for (let count = countLowerBound; count <= Math.max(countUpperBound, baseCount + 24); count += 1) {
      const candidate = evaluateCandidate(count, config);
      if (!bestFallback || candidate.score < bestFallback.score) {
        bestFallback = candidate;
      }
      if (count <= countUpperBound && (!bestProtectedFallback || candidate.score < bestProtectedFallback.score)) {
        bestProtectedFallback = candidate;
      }
      if (candidate.spacingPass && candidate.throwPass && candidate.cfmRangePass) {
        if (!bestPassing || candidate.score < bestPassing.score) {
          bestPassing = candidate;
        }
      }
    }

    const layout = Object.assign({}, bestPassing || bestProtectedFallback || bestFallback, {
      area: roundTo(area, 2),
      totalAirflowCFM: roundTo(totalAirflowCFM, 0),
      airflowPerArea: roundTo(airflowPerArea, 2),
      airflowPerAreaThreshold: roundTo(airflowPerAreaThreshold, 2),
      minCountWithoutOversizing: minCountByAirflow,
      maxCountWithoutUndersizing: maxCountWithoutUndersizing,
      airflowBandFeasible: airflowBandFeasible,
      isIndustrialMode: industrialMode,
      supplyDeviceType: config.supplyDeviceType,
      distributionMode: config.distributionMode,
      symbolPrefix: industrialMode ? "J" : "S"
    });

    layout.undersizingProtected = airflowBandFeasible && layout.diffuserCount <= countUpperBound + 0.01;
    layout.zoningRecommended = !!(layout.undersizingProtected && !layout.spacingPass && !layout.isIndustrialMode);
    layout.highThrowRecommended = !!(layout.undersizingProtected && !layout.throwPass);

    layout.selectionBasis = selectionBasisText(layout);
    return layout;
  }

  function mergeZoneReturns(zoneLayouts) {
    const baseReturns = zoneLayouts.map(function (zoneLayout) {
      return zoneLayout.returns || {};
    });

    return {
      count: baseReturns.reduce(function (sum, entry) { return sum + (entry.count || 0); }, 0),
      type: baseReturns[0] && baseReturns[0].type ? baseReturns[0].type : "Return grille",
      side: "Per-zone opposite-side placement",
      width: roundTo(Math.max.apply(null, baseReturns.map(function (entry) { return entry.width || 0; }).concat([0])), 2),
      height: roundTo(Math.max.apply(null, baseReturns.map(function (entry) { return entry.height || 0; }).concat([0])), 2),
      totalArea: roundTo(baseReturns.reduce(function (sum, entry) { return sum + (entry.totalArea || 0); }, 0), 3),
      maxFaceVelocity: 2.5,
      coords: zoneLayouts.reduce(function (list, zoneLayout) {
        return list.concat((zoneLayout.returns && zoneLayout.returns.coords) || []);
      }, []),
      locationNote: "Returns are distributed by zone and placed opposite the local supply field to reduce short-circuiting."
    };
  }

  function aggregateZonedLayout(settings, zoningPlan) {
    const zones = Array.isArray(zoningPlan && zoningPlan.zones) ? zoningPlan.zones : [];
    const baseLayout = computeSingleLayout(Object.assign({}, settings, { zoningPlan: null }));
    const zoneLayouts = zones.map(function (zone) {
      const localLayout = computeSingleLayout(Object.assign({}, settings, {
        zoningPlan: null,
        length: zone.length,
        width: zone.width,
        totalAirflowCFM: zone.conditionedCFM
      }));

      localLayout.zoneId = zone.id;
      localLayout.zoneName = zone.name;
      localLayout.zoneRow = zone.row;
      localLayout.zoneCol = zone.col;
      localLayout.zoneX0 = zone.x0;
      localLayout.zoneY0 = zone.y0;
      localLayout.zoneLength = zone.length;
      localLayout.zoneWidth = zone.width;
      localLayout.zoneArea = zone.area;
      localLayout.zoneConditionedCFM = zone.conditionedCFM;
      localLayout.zoneTR = zone.trFinal;
      localLayout.supplies = (localLayout.supplies || []).map(function (point) {
        return {
          x: roundTo(point.x + zone.x0, 2),
          y: roundTo(point.y + zone.y0, 2),
          zoneId: zone.id,
          zoneName: zone.name
        };
      });
      localLayout.returns = Object.assign({}, localLayout.returns, {
        coords: ((localLayout.returns && localLayout.returns.coords) || []).map(function (point) {
          return {
            x: roundTo(point.x + zone.x0, 2),
            y: roundTo(point.y + zone.y0, 2),
            zoneId: zone.id,
            zoneName: zone.name
          };
        })
      });
      return localLayout;
    });

    const representativeLayout = zoneLayouts[0] || baseLayout;
    const mergedReturns = mergeZoneReturns(zoneLayouts);
    const totalDiffuserCount = zoneLayouts.reduce(function (sum, zoneLayout) {
      return sum + (zoneLayout.diffuserCount || 0);
    }, 0);
    const totalAirflowCFM = zoneLayouts.reduce(function (sum, zoneLayout) {
      return sum + (zoneLayout.totalAirflowCFM || 0);
    }, 0);
    const worstThrowRequirement = Math.max.apply(null, zoneLayouts.map(function (zoneLayout) {
      return zoneLayout.requiredThrow || 0;
    }).concat([0]));
    const weakestThrow = Math.min.apply(null, zoneLayouts.map(function (zoneLayout) {
      return zoneLayout.throwDistance || 0;
    }).concat([baseLayout.throwDistance || 0]));

    return Object.assign({}, baseLayout, {
      isIndustrialMode: representativeLayout.isIndustrialMode,
      supplyDeviceType: representativeLayout.supplyDeviceType,
      distributionMode: representativeLayout.distributionMode,
      symbolPrefix: representativeLayout.symbolPrefix,
      minCFMPerDiffuser: representativeLayout.minCFMPerDiffuser,
      maxCFMPerDiffuser: representativeLayout.maxCFMPerDiffuser,
      airflowPerArea: roundTo(safeDiv(representativeLayout.totalAirflowCFM || 0, representativeLayout.area || 1, 0), 2),
      airflowPerAreaThreshold: representativeLayout.airflowPerAreaThreshold,
      diffuserCount: totalDiffuserCount,
      cfmPerDiffuser: roundTo(safeDiv(totalAirflowCFM, totalDiffuserCount, 0), 1),
      rows: zoneLayouts[0] ? zoneLayouts[0].rows : baseLayout.rows,
      cols: zoneLayouts[0] ? zoneLayouts[0].cols : baseLayout.cols,
      minCountWithoutOversizing: zoneLayouts.reduce(function (sum, zoneLayout) {
        return sum + (zoneLayout.minCountWithoutOversizing || 0);
      }, 0),
      maxCountWithoutUndersizing: zoneLayouts.reduce(function (sum, zoneLayout) {
        return sum + (zoneLayout.maxCountWithoutUndersizing || 0);
      }, 0),
      spacingX: roundTo(Math.max.apply(null, zoneLayouts.map(function (zoneLayout) { return zoneLayout.spacingX || 0; }).concat([0])), 2),
      spacingY: roundTo(Math.max.apply(null, zoneLayouts.map(function (zoneLayout) { return zoneLayout.spacingY || 0; }).concat([0])), 2),
      spacingPass: zoneLayouts.every(function (zoneLayout) { return zoneLayout.spacingPass; }),
      throwPass: zoneLayouts.every(function (zoneLayout) { return zoneLayout.throwPass; }),
      cfmRangePass: zoneLayouts.every(function (zoneLayout) { return zoneLayout.cfmRangePass; }),
      undersized: zoneLayouts.some(function (zoneLayout) { return zoneLayout.undersized; }),
      oversized: zoneLayouts.some(function (zoneLayout) { return zoneLayout.oversized; }),
      undersizingProtected: zoneLayouts.every(function (zoneLayout) { return zoneLayout.undersizingProtected; }),
      throwDistance: roundTo(weakestThrow, 2),
      requiredThrow: roundTo(worstThrowRequirement, 2),
      returns: mergedReturns,
      supplies: zoneLayouts.reduce(function (list, zoneLayout) {
        return list.concat(zoneLayout.supplies || []);
      }, []),
      zones: zoneLayouts.map(function (zoneLayout) {
        return {
          id: zoneLayout.zoneId,
          name: zoneLayout.zoneName,
          row: zoneLayout.zoneRow,
          col: zoneLayout.zoneCol,
          x0: zoneLayout.zoneX0,
          y0: zoneLayout.zoneY0,
          length: zoneLayout.zoneLength,
          width: zoneLayout.zoneWidth,
          area: zoneLayout.zoneArea,
          conditionedCFM: zoneLayout.zoneConditionedCFM,
          trFinal: zoneLayout.zoneTR,
          diffuserCount: zoneLayout.diffuserCount,
          spacingPass: zoneLayout.spacingPass,
          throwPass: zoneLayout.throwPass,
          cfmRangePass: zoneLayout.cfmRangePass,
          rows: zoneLayout.rows,
          cols: zoneLayout.cols
        };
      }),
      isAutoZoned: true,
      zoneCount: zoningPlan.zoneCount,
      zoneRows: zoningPlan.rows,
      zoneCols: zoningPlan.cols,
      zoneLength: zoningPlan.zoneLength,
      zoneWidth: zoningPlan.zoneWidth,
      zoneBasis: zoningPlan.basis,
      zoningRecommended: false,
      highThrowRecommended: zoneLayouts.some(function (zoneLayout) { return zoneLayout.highThrowRecommended; }),
      selectionBasis: "Auto-zoned into " + zoningPlan.zoneCount + " control zones. " + zoningPlan.basis
    });
  }

  function computeLayout(options) {
    const settings = options || {};
    const zoningPlan = settings.zoningPlan;
    if (zoningPlan && zoningPlan.zoneCount > 1 && Array.isArray(zoningPlan.zones) && zoningPlan.zones.length) {
      return aggregateZonedLayout(settings, zoningPlan);
    }
    return computeSingleLayout(settings);
  }

  function renderLayoutSvg(length, width, layout) {
    const roomLength = Math.max(length || 0, 1);
    const roomWidth = Math.max(width || 0, 1);
    const padding = 36;
    const viewWidth = 560;
    const viewHeight = 340;
    const scale = Math.min((viewWidth - padding * 2) / roomLength, (viewHeight - padding * 2) / roomWidth);
    const originX = (viewWidth - roomLength * scale) / 2;
    const originY = (viewHeight - roomWidth * scale) / 2;
    const toX = function (value) { return originX + value * scale; };
    const toY = function (value) { return originY + value * scale; };
    const supplyCount = (layout.supplies || []).length;
    const showCoverage = supplyCount <= 20;
    const labelStep = supplyCount <= 16 ? 1 : Math.ceil(supplyCount / 12);
    const supplyRadius = layout.isIndustrialMode
      ? (supplyCount > 24 ? 6.5 : 9)
      : (supplyCount > 24 ? 5.5 : 8);
    const coverageRadius = Math.max(layout.throwDistance * scale * (showCoverage ? 1 : 0.45), 10);
    const supplyFill = layout.isIndustrialMode ? "#2563eb" : "#0f766e";
    const supplyStroke = layout.isIndustrialMode ? "#1d4ed8" : "#0f766e";
    const returnFill = "#f59e0b";
    const note = layout.distributionMode + " · " + layout.supplyDeviceType;
    const zoneMarkup = (layout.zones || []).map(function (zone) {
      const x = toX(zone.x0);
      const y = toY(zone.y0);
      const zoneWidthPx = zone.length * scale;
      const zoneHeightPx = zone.width * scale;
      return '<rect x="' + x + '" y="' + y + '" width="' + zoneWidthPx + '" height="' + zoneHeightPx + '" fill="none" stroke="#94a3b8" stroke-width="1.1" stroke-dasharray="7 5" opacity="0.75"></rect>'
        + '<rect x="' + (x + zoneWidthPx / 2 - 26) + '" y="' + (y + 6) + '" width="52" height="14" rx="6" fill="rgba(255,255,255,0.88)" stroke="rgba(148,163,184,0.45)"></rect>'
        + '<text x="' + (x + zoneWidthPx / 2) + '" y="' + (y + 16) + '" text-anchor="middle" font-size="9.5" font-family="monospace" fill="#475569">' + zone.name + "</text>";
    }).join("");

    const supplyMarkup = (layout.supplies || []).map(function (point, index) {
      const x = toX(point.x);
      const y = toY(point.y);
      const label = (layout.symbolPrefix || "S") + (index + 1);
      const showLabel = index % labelStep === 0;
      const symbol = layout.isIndustrialMode
        ? '<polygon points="' + x + "," + (y - supplyRadius) + " " + (x + supplyRadius) + "," + (y + supplyRadius) + " " + (x - supplyRadius) + "," + (y + supplyRadius) + '" fill="' + supplyFill + '" stroke="' + supplyStroke + '" stroke-width="1.4"></polygon>'
        : '<circle cx="' + x + '" cy="' + y + '" r="' + supplyRadius + '" fill="' + supplyFill + '" stroke="' + supplyStroke + '" stroke-width="1.4"></circle>';
      return (showCoverage
          ? '<circle cx="' + x + '" cy="' + y + '" r="' + coverageRadius + '" fill="none" stroke="' + supplyFill + '" stroke-width="1" stroke-dasharray="5 5" opacity="0.18"></circle>'
          : '')
        + symbol
        + (showLabel
          ? '<text x="' + x + '" y="' + (y - supplyRadius - 5) + '" text-anchor="middle" font-size="8.5" font-family="monospace" fill="#0f172a">' + label + "</text>"
          : "");
    }).join("");

    const returnMarkup = (layout.returns && layout.returns.coords ? layout.returns.coords : []).map(function (point, index) {
      const x = toX(point.x);
      const y = toY(point.y);
      const widthPx = Math.max((layout.returns.width || 0.35) * scale * 0.45, 16);
      const heightPx = Math.max((layout.returns.height || 0.2) * scale * 0.55, 10);
      return '<rect x="' + (x - widthPx / 2) + '" y="' + (y - heightPx / 2) + '" width="' + widthPx + '" height="' + heightPx + '" rx="3" fill="' + returnFill + '" opacity="0.9"></rect>'
        + '<text x="' + x + '" y="' + (y + 3.5) + '" text-anchor="middle" font-size="8.5" font-family="monospace" fill="#111827">R' + (index + 1) + "</text>";
    }).join("");

    return ""
      + '<rect x="' + originX + '" y="' + originY + '" width="' + (roomLength * scale) + '" height="' + (roomWidth * scale) + '" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"></rect>'
      + '<text x="' + (originX + 8) + '" y="' + (originY - 10) + '" font-size="10" font-family="monospace" fill="#475569">Room ' + roundTo(roomLength, 1) + " m x " + roundTo(roomWidth, 1) + " m</text>"
      + '<text x="' + (viewWidth - padding) + '" y="' + (originY - 10) + '" text-anchor="end" font-size="10" font-family="monospace" fill="#475569">' + note + "</text>"
      + zoneMarkup
      + supplyMarkup
      + returnMarkup
      + '<g transform="translate(36,300)">'
      + '<circle cx="8" cy="8" r="6" fill="' + (layout.isIndustrialMode ? "#2563eb" : "#0f766e") + '"></circle>'
      + '<text x="22" y="12" font-size="9.5" font-family="monospace" fill="#334155">Supply outlets (' + (layout.symbolPrefix || "S") + ")</text>"
      + '<rect x="170" y="2" width="18" height="12" rx="3" fill="#f59e0b"></rect>'
      + '<text x="198" y="12" font-size="9.5" font-family="monospace" fill="#334155">Return grilles</text>'
      + '<line x1="332" y1="8" x2="352" y2="8" stroke="' + (layout.isIndustrialMode ? "#2563eb" : "#0f766e") + '" stroke-width="1.2" stroke-dasharray="5 5" opacity="0.5"></line>'
      + '<text x="360" y="12" font-size="9.5" font-family="monospace" fill="#334155">' + (showCoverage ? "Approx. throw envelope" : "Throw envelope simplified for dense layout") + "</text>"
      + (labelStep > 1
        ? '<text x="0" y="-8" font-size="9" font-family="monospace" fill="#64748b">Dense layout: every ' + labelStep + 'th outlet labeled</text>'
        : '')
      + "</g>";
  }

  window.DiffuserLayout = {
    computeLayout: computeLayout,
    renderLayoutSvg: renderLayoutSvg
  };
}());
