(function () {
  const CFM_TO_M3S = 0.00047194745;
  const MOTOR_EFFICIENCY = 0.92;
  const MOTOR_SIZES_KW = [0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5, 9.2, 11.0, 15.0, 18.5, 22.0, 30.0];

  const FAN_DATABASE = [
    { id: "AX-01", type: "Axial", minCFM: 1000, maxCFM: 12000, minESP: 50, maxESP: 220, ratedCFM: 5000, ratedESP: 150, efficiency: 0.57 },
    { id: "AX-02", type: "Axial", minCFM: 3000, maxCFM: 25000, minESP: 80, maxESP: 250, ratedCFM: 12000, ratedESP: 180, efficiency: 0.60 },
    { id: "FC-01", type: "Forward Curved", minCFM: 500, maxCFM: 4000, minESP: 180, maxESP: 420, ratedCFM: 1800, ratedESP: 300, efficiency: 0.60 },
    { id: "FC-02", type: "Forward Curved", minCFM: 2000, maxCFM: 9000, minESP: 220, maxESP: 520, ratedCFM: 5200, ratedESP: 360, efficiency: 0.63 },
    { id: "BC-01", type: "Backward Curved", minCFM: 1200, maxCFM: 10000, minESP: 350, maxESP: 850, ratedCFM: 4500, ratedESP: 550, efficiency: 0.76 },
    { id: "BC-02", type: "Backward Curved", minCFM: 4000, maxCFM: 22000, minESP: 450, maxESP: 1200, ratedCFM: 12000, ratedESP: 750, efficiency: 0.79 }
  ];

  const AHU_DATABASE = [
    { model: "AHU-01.5", tr: 1.5, airflowCFM: 550, espPa: 250, nominalMotorKW: 0.25 },
    { model: "AHU-02", tr: 2, airflowCFM: 750, espPa: 300, nominalMotorKW: 0.37 },
    { model: "AHU-02.5", tr: 2.5, airflowCFM: 950, espPa: 350, nominalMotorKW: 0.55 },
    { model: "AHU-03", tr: 3, airflowCFM: 1150, espPa: 375, nominalMotorKW: 0.55 },
    { model: "AHU-04", tr: 4, airflowCFM: 1500, espPa: 400, nominalMotorKW: 0.75 },
    { model: "AHU-05", tr: 5, airflowCFM: 1900, espPa: 450, nominalMotorKW: 1.1 },
    { model: "AHU-06", tr: 6, airflowCFM: 2300, espPa: 475, nominalMotorKW: 1.1 },
    { model: "AHU-07.5", tr: 7.5, airflowCFM: 2900, espPa: 500, nominalMotorKW: 1.5 },
    { model: "AHU-10", tr: 10, airflowCFM: 3800, espPa: 550, nominalMotorKW: 2.2 },
    { model: "AHU-12.5", tr: 12.5, airflowCFM: 4700, espPa: 600, nominalMotorKW: 3.0 },
    { model: "AHU-15", tr: 15, airflowCFM: 5700, espPa: 650, nominalMotorKW: 4.0 },
    { model: "AHU-20", tr: 20, airflowCFM: 7600, espPa: 700, nominalMotorKW: 5.5 },
    { model: "AHU-25", tr: 25, airflowCFM: 9500, espPa: 750, nominalMotorKW: 7.5 },
    { model: "AHU-30", tr: 30, airflowCFM: 11400, espPa: 800, nominalMotorKW: 9.2 },
    { model: "AHU-35", tr: 35, airflowCFM: 13300, espPa: 825, nominalMotorKW: 10.0 },
    { model: "AHU-40", tr: 40, airflowCFM: 15200, espPa: 850, nominalMotorKW: 11.0 },
    { model: "AHU-50", tr: 50, airflowCFM: 19000, espPa: 900, nominalMotorKW: 15.0 },
    { model: "AHU-60", tr: 60, airflowCFM: 22800, espPa: 950, nominalMotorKW: 18.5 }
  ].map(function (entry) {
    const minAirflowCFM = Math.round(Math.max(entry.airflowCFM * 0.65, entry.tr * 220));
    const maxAirflowCFM = Math.round(Math.min(entry.airflowCFM * 1.25, entry.tr * 500));
    return Object.assign({}, entry, {
      nominalAirflowCFM: entry.airflowCFM,
      minAirflowCFM: Math.min(minAirflowCFM, entry.airflowCFM),
      maxAirflowCFM: Math.max(maxAirflowCFM, entry.airflowCFM)
    });
  });

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

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function estimatedMotorKw(airflowCFM, espPa, efficiency) {
    const espInWg = Math.max(espPa || 0, 0) / 249.0889;
    const brakeHp = Math.max(airflowCFM || 0, 0) * espInWg / (6356 * Math.max(efficiency, 0.45));
    return brakeHp * 0.746;
  }

  function nextMotorKW(requiredKW) {
    const target = Math.max(requiredKW || 0, MOTOR_SIZES_KW[0]);
    const adequate = MOTOR_SIZES_KW.find(function (size) {
      return size + 0.0001 >= target;
    });
    if (adequate) {
      return adequate;
    }
    return Math.ceil(target / 5) * 5;
  }

  function preferredFanType(espPa) {
    if (espPa <= 220) {
      return "Axial";
    }
    if (espPa <= 360) {
      return "Forward Curved";
    }
    return "Backward Curved";
  }

  function nextCatalogTR(requiredTR) {
    const adequate = AHU_DATABASE.find(function (candidate) {
      return candidate.tr >= requiredTR;
    });
    if (adequate) {
      return adequate.tr;
    }
    return requiredTR > 0 ? Math.ceil(requiredTR / 5) * 5 : 0;
  }

  function fanPoint(candidate, airflowCFM, espPa) {
    const flowFraction = safeDiv(airflowCFM, candidate.ratedCFM, 0);
    const pressureFraction = safeDiv(espPa, candidate.ratedESP, 0);
    const flowRangeFraction = safeDiv(airflowCFM - candidate.minCFM, candidate.maxCFM - candidate.minCFM, 0);
    const pressureRangeFraction = safeDiv(espPa - candidate.minESP, candidate.maxESP - candidate.minESP, 0);
    const flowShortfall = airflowCFM > candidate.maxCFM ? (airflowCFM - candidate.maxCFM) / Math.max(candidate.maxCFM, 1) : 0;
    const pressureShortfall = espPa > candidate.maxESP ? (espPa - candidate.maxESP) / Math.max(candidate.maxESP, 1) : 0;
    const lowFlowPenalty = airflowCFM < candidate.minCFM ? (candidate.minCFM - airflowCFM) / Math.max(candidate.minCFM, 1) : 0;
    const lowPressurePenalty = espPa < candidate.minESP ? (candidate.minESP - espPa) / Math.max(candidate.minESP, 1) : 0;
    const preferredType = preferredFanType(espPa);
    const typePenalty = candidate.type === preferredType ? 0 : 1.0;
    const efficiencyPenalty = Math.max(0, 0.80 - candidate.efficiency) * 4.2;
    const powerPenalty = safeDiv(estimatedMotorKw(airflowCFM, espPa, candidate.efficiency), Math.max(airflowCFM, 1), 0) * 900;
    const targetFlowFraction = candidate.type === "Axial" ? 0.82 : candidate.type === "Forward Curved" ? 0.72 : 0.76;
    const targetPressureFraction = candidate.type === "Axial" ? 0.82 : candidate.type === "Forward Curved" ? 0.70 : 0.78;
    const operatingPenalty = Math.abs(flowFraction - targetFlowFraction) * 0.9
      + Math.abs(pressureFraction - targetPressureFraction) * 0.9;
    const score = flowShortfall * 40
      + pressureShortfall * 34
      + lowFlowPenalty * 8
      + lowPressurePenalty * 6
      + operatingPenalty
      + typePenalty
      + efficiencyPenalty
      + powerPenalty;

    return {
      preferredType: preferredType,
      flowFraction: flowFraction,
      pressureFraction: pressureFraction,
      flowRangeFraction: flowRangeFraction,
      pressureRangeFraction: pressureRangeFraction,
      score: score,
      withinRange: airflowCFM >= candidate.minCFM - 0.001
        && airflowCFM <= candidate.maxCFM + 0.001
        && espPa >= candidate.minESP - 0.001
        && espPa <= candidate.maxESP + 0.001,
      operatingPenalty: operatingPenalty,
      typePenalty: typePenalty,
      efficiencyPenalty: efficiencyPenalty,
      powerPenalty: powerPenalty
    };
  }

  function airflowConstraintLabel(airflowConstraint) {
    if (airflowConstraint === "ventilation") {
      return "Ventilation governs airflow";
    }
    if (airflowConstraint === "ach") {
      return "ACH minimum governs airflow";
    }
    if (airflowConstraint === "balanced") {
      return "Thermal, ventilation, and ACH duties are aligned";
    }
    return "Room sensible heat governs airflow";
  }

  function selectFan(airflowCFM, espPa) {
    const candidates = FAN_DATABASE.map(function (candidate) {
      return {
        candidate: candidate,
        point: fanPoint(candidate, airflowCFM, espPa)
      };
    });
    const adequateCandidates = candidates.filter(function (entry) {
      return entry.point.withinRange;
    });
    const bestEntry = (adequateCandidates.length ? adequateCandidates : candidates).slice().sort(function (left, right) {
      return left.point.score - right.point.score;
    })[0];
    const best = bestEntry.candidate;
    const point = bestEntry.point;
    const brakeKW = estimatedMotorKw(airflowCFM, espPa, best.efficiency);
    const motorKw = nextMotorKW(brakeKW * 1.15);

    return {
      curveId: best.id,
      type: best.type,
      minCFM: best.minCFM,
      maxCFM: best.maxCFM,
      minESP: best.minESP,
      maxESP: best.maxESP,
      ratedCFM: best.ratedCFM,
      ratedESP: best.ratedESP,
      efficiency: best.efficiency,
      brakeKW: roundTo(brakeKW, 2),
      motorKW: roundTo(Math.max(motorKw, 0.25), 2),
      preferredType: point.preferredType,
      withinRange: point.withinRange,
      flowFraction: roundTo(point.flowFraction, 2),
      pressureFraction: roundTo(point.pressureFraction, 2),
      operatingPointScore: roundTo(point.score, 3),
      selectionNote: point.withinRange
        ? "Fan operating point stays inside the available catalog window."
        : "Closest fan curve shown; design point is outside the available catalog window."
    };
  }

  function buildCoolingCandidate(baseModel, coolingUnitCount, requirements) {
    const capacityTR = baseModel.tr * coolingUnitCount;
    const coilAdequate = capacityTR + 0.001 >= requirements.catalogTR;
    const meetsMarginTarget = capacityTR + 0.001 >= requirements.targetTRWithMargin;
    const reserveTR = capacityTR - requirements.requiredTRFinal;

    return {
      baseModel: baseModel,
      coolingUnitCount: coolingUnitCount,
      capacityTR: capacityTR,
      reserveTR: reserveTR,
      coilAdequate: coilAdequate,
      meetsMarginTarget: meetsMarginTarget
    };
  }

  function scoreCoolingAdequate(candidate, requirements) {
    const targetDeviation = Math.abs(candidate.capacityTR - requirements.targetTRWithMargin) / Math.max(requirements.requiredTRFinal, 1);
    const excessOversize = Math.max(0, candidate.capacityTR - requirements.targetTRWithMargin) / Math.max(requirements.requiredTRFinal, 1);
    const reservePenalty = Math.max(0, candidate.reserveTR - requirements.requiredTRFinal * 0.10) / Math.max(requirements.requiredTRFinal, 1);
    const highMarginPenalty = Math.max(0, safeDiv(candidate.reserveTR, Math.max(requirements.requiredTRFinal, 0.1), 0) - 0.25) * 7.5;
    const unitPenalty = (candidate.coolingUnitCount - 1) * 0.85;

    return targetDeviation * 5.1
      + excessOversize * 4.0
      + reservePenalty * 4.8
      + highMarginPenalty
      + unitPenalty
      + candidate.baseModel.nominalMotorKW * candidate.coolingUnitCount * 0.03;
  }

  function scoreCoolingFallback(candidate, requirements) {
    const shortfall = Math.max(0, requirements.catalogTR - candidate.capacityTR) / Math.max(requirements.catalogTR, 1);
    const oversize = Math.max(0, candidate.capacityTR - requirements.catalogTR) / Math.max(requirements.catalogTR, 1);
    const reservePenalty = Math.max(0, candidate.reserveTR - requirements.requiredTRFinal * 0.12) / Math.max(requirements.requiredTRFinal, 1);
    const highMarginPenalty = Math.max(0, safeDiv(candidate.reserveTR, Math.max(requirements.requiredTRFinal, 0.1), 0) - 0.28) * 6.5;
    const unitPenalty = (candidate.coolingUnitCount - 1) * 0.6;

    return shortfall * 20
      + oversize * 2.6
      + reservePenalty * 3.2
      + highMarginPenalty
      + unitPenalty
      + candidate.baseModel.nominalMotorKW * candidate.coolingUnitCount * 0.03;
  }

  function selectCoolingPackage(requirements, options) {
    if (!AHU_DATABASE.length) {
      return null;
    }

    const settings = options || {};
    const normalizedRequirements = {
      catalogTR: Math.max(finiteOr(requirements && requirements.catalogTR, 0), 0),
      targetTRWithMargin: Math.max(
        finiteOr(requirements && requirements.targetTRWithMargin, requirements && requirements.catalogTR),
        Math.max(finiteOr(requirements && requirements.catalogTR, 0), 0)
      ),
      requiredTRFinal: Math.max(finiteOr(requirements && requirements.requiredTRFinal, 0), 0)
    };
    const maxCoolingUnitCount = Math.max(1, Math.floor(finiteOr(settings.maxCoolingUnitCount, 12)));
    const candidatePool = [];

    AHU_DATABASE.forEach(function (baseModel) {
      const minUnitCount = Math.max(1, Math.ceil(normalizedRequirements.catalogTR / Math.max(baseModel.tr, 0.1)));
      const maxUnitCount = Math.min(
        maxCoolingUnitCount,
        Math.max(
          minUnitCount + 2,
          Math.ceil(normalizedRequirements.targetTRWithMargin / Math.max(baseModel.tr, 0.1)) + 2
        )
      );

      for (let coolingUnitCount = Math.max(1, minUnitCount - 1); coolingUnitCount <= maxUnitCount; coolingUnitCount += 1) {
        candidatePool.push(buildCoolingCandidate(baseModel, coolingUnitCount, normalizedRequirements));
      }
    });

    if (!candidatePool.length) {
      const fallbackBase = AHU_DATABASE[AHU_DATABASE.length - 1];
      const fallbackUnits = Math.max(1, Math.min(maxCoolingUnitCount, Math.ceil(normalizedRequirements.catalogTR / Math.max(fallbackBase.tr, 0.1))));
      return buildCoolingCandidate(fallbackBase, fallbackUnits, normalizedRequirements);
    }

    const adequateCandidates = candidatePool.filter(function (candidate) {
      return candidate.coilAdequate;
    });
    const selectionPool = adequateCandidates.length ? adequateCandidates : candidatePool;

    return selectionPool.slice().sort(function (left, right) {
      const leftScore = adequateCandidates.length
        ? scoreCoolingAdequate(left, normalizedRequirements)
        : scoreCoolingFallback(left, normalizedRequirements);
      const rightScore = adequateCandidates.length
        ? scoreCoolingAdequate(right, normalizedRequirements)
        : scoreCoolingFallback(right, normalizedRequirements);
      return leftScore - rightScore;
    })[0];
  }

  function buildAirHandlingCandidate(cooling, sectionCount, requirements) {
    if (!cooling || !cooling.baseModel) {
      return null;
    }
    const baseModel = cooling.baseModel;
    const perSectionDutyCFM = requirements.airflowCFM / sectionCount;
    const operatingMinPerSection = baseModel.minAirflowCFM * 0.95;
    const operatingMaxPerSection = baseModel.maxAirflowCFM * 1.05;
    const airflowLowPenalty = perSectionDutyCFM < operatingMinPerSection
      ? (operatingMinPerSection - perSectionDutyCFM) / Math.max(operatingMinPerSection, 1)
      : 0;
    const airflowHighPenalty = perSectionDutyCFM > operatingMaxPerSection
      ? (perSectionDutyCFM - operatingMaxPerSection) / Math.max(operatingMaxPerSection, 1)
      : 0;
    const nominalDeviation = Math.abs(perSectionDutyCFM - baseModel.nominalAirflowCFM) / Math.max(baseModel.nominalAirflowCFM, 1);
    const selectedFan = selectFan(perSectionDutyCFM, requirements.espPa);
    const airflowAdequate = airflowLowPenalty === 0 && airflowHighPenalty === 0;
    const fanCurveAdequate = selectedFan.withinRange;
    const adequate = airflowAdequate && fanCurveAdequate;
    const reviewReasons = [];

    if (!airflowAdequate) {
      reviewReasons.push("design airflow falls outside the recommended airflow window for each air section");
    }
    if (!fanCurveAdequate) {
      reviewReasons.push("fan operating point falls outside the available fan curve");
    }

    return {
      sectionCount: sectionCount,
      perSectionDutyCFM: perSectionDutyCFM,
      totalMinAirflowCFM: baseModel.minAirflowCFM * sectionCount,
      totalMaxAirflowCFM: baseModel.maxAirflowCFM * sectionCount,
      totalNominalAirflowCFM: baseModel.nominalAirflowCFM * sectionCount,
      airflowAdequate: airflowAdequate,
      fanCurveAdequate: fanCurveAdequate,
      adequate: adequate,
      airflowLowPenalty: airflowLowPenalty,
      airflowHighPenalty: airflowHighPenalty,
      nominalDeviation: nominalDeviation,
      selectedFan: selectedFan,
      reviewReasons: reviewReasons
    };
  }

  function scoreAirHandlingAdequate(candidate, minimumSections) {
    const sectionPenalty = (candidate.sectionCount - minimumSections) * 0.45;
    const fanEnergyPenalty = safeDiv(candidate.selectedFan.brakeKW, Math.max(candidate.perSectionDutyCFM, 1), 0) * 650;
    const fanEfficiencyPenalty = Math.max(0, 0.80 - candidate.selectedFan.efficiency) * 6.5;

    return candidate.nominalDeviation * 2
      + candidate.selectedFan.operatingPointScore * 1.4
      + (candidate.selectedFan.type === candidate.selectedFan.preferredType ? 0 : 0.35)
      + fanEnergyPenalty
      + fanEfficiencyPenalty
      + sectionPenalty;
  }

  function scoreAirHandlingFallback(candidate, minimumSections) {
    const sectionPenalty = (candidate.sectionCount - minimumSections) * 0.3;
    const airflowPenalty = candidate.airflowLowPenalty * 18 + candidate.airflowHighPenalty * 24;
    const fanEnergyPenalty = safeDiv(candidate.selectedFan.brakeKW, Math.max(candidate.perSectionDutyCFM, 1), 0) * 700;
    const fanEfficiencyPenalty = Math.max(0, 0.80 - candidate.selectedFan.efficiency) * 7.0;

    return airflowPenalty
      + (candidate.fanCurveAdequate ? 0 : 12)
      + candidate.nominalDeviation * 1.8
      + candidate.selectedFan.operatingPointScore
      + fanEnergyPenalty
      + fanEfficiencyPenalty
      + sectionPenalty;
  }

  function selectAirHandlingArrangement(cooling, requirements, options) {
    const settings = options || {};
    const fallbackAirflow = Math.max(finiteOr(requirements && requirements.airflowCFM, 0), 0);
    const fallbackEsp = Math.max(finiteOr(requirements && requirements.espPa, 0), 0);
    if (!cooling || !cooling.baseModel) {
      return {
        sectionCount: 1,
        perSectionDutyCFM: fallbackAirflow,
        totalMinAirflowCFM: 0,
        totalMaxAirflowCFM: fallbackAirflow,
        totalNominalAirflowCFM: fallbackAirflow,
        airflowAdequate: false,
        fanCurveAdequate: false,
        adequate: false,
        airflowLowPenalty: 0,
        airflowHighPenalty: 0,
        nominalDeviation: 0,
        selectedFan: selectFan(Math.max(fallbackAirflow, 200), Math.max(fallbackEsp, 120)),
        reviewReasons: ["cooling package could not be resolved cleanly; fallback air-handling review required"]
      };
    }
    const minimumSections = Math.max(1, cooling.coolingUnitCount);
    const maximumSections = Math.min(
      Math.max(minimumSections, Math.floor(finiteOr(settings.maxAirSectionsAllowed, 6))),
      Math.max(
        minimumSections + 4,
        Math.ceil(requirements.airflowCFM / Math.max(cooling.baseModel.minAirflowCFM * 0.75, 1)) + 2
      )
    );
    const candidatePool = [];

    for (let sectionCount = minimumSections; sectionCount <= maximumSections; sectionCount += 1) {
      const candidate = buildAirHandlingCandidate(cooling, sectionCount, requirements);
      if (candidate) {
        candidatePool.push(candidate);
      }
    }

    if (!candidatePool.length) {
      return {
        sectionCount: minimumSections,
        perSectionDutyCFM: fallbackAirflow,
        totalMinAirflowCFM: 0,
        totalMaxAirflowCFM: fallbackAirflow,
        totalNominalAirflowCFM: fallbackAirflow,
        airflowAdequate: false,
        fanCurveAdequate: false,
        adequate: false,
        airflowLowPenalty: 0,
        airflowHighPenalty: 0,
        nominalDeviation: 0,
        selectedFan: selectFan(Math.max(fallbackAirflow, 200), Math.max(fallbackEsp, 120)),
        reviewReasons: ["no valid air-handling arrangement candidates were generated"]
      };
    }

    const adequateCandidates = candidatePool.filter(function (candidate) {
      return candidate.adequate;
    });
    const selectionPool = adequateCandidates.length ? adequateCandidates : candidatePool;

    return selectionPool.slice().sort(function (left, right) {
      const leftScore = adequateCandidates.length
        ? scoreAirHandlingAdequate(left, minimumSections)
        : scoreAirHandlingFallback(left, minimumSections);
      const rightScore = adequateCandidates.length
        ? scoreAirHandlingAdequate(right, minimumSections)
        : scoreAirHandlingFallback(right, minimumSections);
      return leftScore - rightScore;
    })[0];
  }

  function selectAhu(requiredTRFinal, airflowCFM, espPa, options) {
    const settings = options || {};
    const normalizedTR = Math.max(finiteOr(requiredTRFinal, 0), 0);
    const normalizedAirflow = Math.max(finiteOr(airflowCFM, 0), 0);
    const normalizedEsp = Math.max(finiteOr(espPa, 0), 0);
    const catalogTR = Math.max(finiteOr(settings.catalogTR, normalizedTR), normalizedTR);
    const designCFMPerTR = finiteOr(settings.designCFMPerTR, safeDiv(normalizedAirflow, Math.max(normalizedTR, 0.1), 400));
    const preferredMargin = clamp(settings.preferredMargin == null ? 0.09 : settings.preferredMargin, 0.06, 0.12);
    const requirements = {
      requiredTRFinal: normalizedTR,
      catalogTR: catalogTR,
      targetTRWithMargin: normalizedTR * (1 + preferredMargin),
      airflowCFM: normalizedAirflow,
      espPa: normalizedEsp,
      designCFMPerTR: designCFMPerTR
    };
    const airflowConstraint = settings.airflowConstraint || "thermal";
    const cooling = selectCoolingPackage(requirements, settings) || buildCoolingCandidate(AHU_DATABASE[0], 1, requirements);
    const airHandling = selectAirHandlingArrangement(cooling, requirements, settings);
    const effectiveEspCapability = Math.max(cooling.baseModel.espPa || 0, airHandling.selectedFan.maxESP || 0);
    const espAdequate = effectiveEspCapability + 0.001 >= requirements.espPa;
    const adequate = cooling.coilAdequate && airHandling.adequate && espAdequate;
    const reviewReasons = [];

    if (!cooling.coilAdequate) {
      reviewReasons.push("coil capacity below TR_catalog");
    }
    if (!espAdequate) {
      reviewReasons.push("selected fan / air section static-pressure capability is below required ESP");
    }
    airHandling.reviewReasons.forEach(function (reason) {
      if (reviewReasons.indexOf(reason) === -1) {
        reviewReasons.push(reason);
      }
    });

    const coolingNominalAirflowCFM = cooling.baseModel.nominalAirflowCFM * cooling.coolingUnitCount;
    const airflowMultiplier = safeDiv(airflowCFM, coolingNominalAirflowCFM, 1);
    const capacityTR = cooling.capacityTR;
    const reserveTR = capacityTR - normalizedTR;
    const reserveCFM = airHandling.totalMaxAirflowCFM - normalizedAirflow;
    const reserveESP = effectiveEspCapability - normalizedEsp;
    const marginPercent = safeDiv(reserveTR, normalizedTR, 0) * 100;
    const selectionNote = adequate
      ? (airHandling.sectionCount > cooling.coolingUnitCount
        ? "Coil capacity is selected from TR demand, while airflow and ESP are handled by additional parallel air sections and the selected fan duty."
        : "Coil capacity, airflow, and fan static all fit within a coordinated AHU arrangement.")
      : "Cooling and airflow have been checked separately. Review required for: " + reviewReasons.join("; ") + ".";

    return {
      model: cooling.coolingUnitCount > 1 ? cooling.coolingUnitCount + " x " + cooling.baseModel.model : cooling.baseModel.model,
      baseModel: cooling.baseModel.model,
      coolingUnitCount: cooling.coolingUnitCount,
      airSectionCount: airHandling.sectionCount,
      isModular: cooling.coolingUnitCount > 1 || airHandling.sectionCount > 1,
      unitCount: airHandling.sectionCount,
      perUnitTR: cooling.baseModel.tr,
      capacityTR: roundTo(capacityTR, 2),
      airflowCFM: Math.round(normalizedAirflow),
      coolingNominalAirflowCFM: Math.round(coolingNominalAirflowCFM),
      nominalAirflowCFM: Math.round(airHandling.totalNominalAirflowCFM),
      minAirflowCFM: Math.round(airHandling.totalMinAirflowCFM),
      maxAirflowCFM: Math.round(airHandling.totalMaxAirflowCFM),
      minAirflowCFMPerUnit: Math.round(cooling.baseModel.minAirflowCFM),
      maxAirflowCFMPerUnit: Math.round(cooling.baseModel.maxAirflowCFM),
      perUnitDutyCFM: Math.round(airHandling.perSectionDutyCFM),
      espPa: roundTo(effectiveEspCapability, 0),
      nominalMotorKW: roundTo(cooling.baseModel.nominalMotorKW * cooling.coolingUnitCount, 2),
      nominalMotorKWPerUnit: cooling.baseModel.nominalMotorKW,
      requiredTRFinal: roundTo(normalizedTR, 2),
      requiredCatalogTR: roundTo(catalogTR, 2),
      preferredTargetTR: roundTo(requirements.targetTRWithMargin, 2),
      designCFMPerTR: roundTo(designCFMPerTR, 0),
      reserveTR: roundTo(reserveTR, 2),
      reserveCFM: Math.round(reserveCFM),
      reserveESP: Math.round(reserveESP),
      fanCurveAdequate: airHandling.fanCurveAdequate,
      maxFanCFMAtESP: Math.round(airHandling.selectedFan.maxCFM * airHandling.sectionCount),
      marginPercent: roundTo(marginPercent, 1),
      adequate: adequate,
      coilAdequate: cooling.coilAdequate,
      airflowAdequate: airHandling.airflowAdequate,
      espAdequate: espAdequate,
      meetsMarginTarget: cooling.meetsMarginTarget,
      airflowConstraint: airflowConstraint,
      sizingBasis: "Coil sized from TR_final; air sections sized from final airflow and ESP",
      selectionNote: selectionNote,
      selectedFan: airHandling.selectedFan,
      reviewReasons: reviewReasons,
      airflowMultiplier: roundTo(airflowMultiplier, 2)
    };
  }

  function selectSystem(requiredTRFinal, airflowCFM, espPa, options) {
    const ahu = selectAhu(requiredTRFinal, airflowCFM, espPa, options);
    const perSectionDutyCFM = ahu.perUnitDutyCFM || airflowCFM;
    const airSectionCount = Math.max(ahu.airSectionCount || ahu.unitCount || 1, 1);
    const fan = Object.assign({}, ahu.selectedFan || selectFan(perSectionDutyCFM, espPa));
    const recommendedMotorKWPerUnit = fan.motorKW;
    const recommendedMotorKW = roundTo(recommendedMotorKWPerUnit * airSectionCount, 2);
    const brakeKWTotal = roundTo((fan.brakeKW || 0) * airSectionCount, 2);
    const electricalFanKWTotal = roundTo(safeDiv(brakeKWTotal, MOTOR_EFFICIENCY, 0), 2);
    const specificFanPowerKWPerTR = roundTo(safeDiv(electricalFanKWTotal, Math.max(requiredTRFinal, 0.1), 0), 2);
    const installedMotorSpecificFanPowerKWPerTR = roundTo(safeDiv(recommendedMotorKW, Math.max(requiredTRFinal, 0.1), 0), 2);
    const airflowPenaltyRatio = roundTo(safeDiv(airflowCFM, Math.max(ahu.coolingNominalAirflowCFM || airflowCFM, 1), 1), 2);
    const airflowPenaltyPercent = roundTo(Math.max(0, (airflowPenaltyRatio - 1) * 100), 1);
    const airflowDriver = ahu.airflowConstraint || "thermal";
    let optimizationNote = "Fan power is in a normal range for the selected airflow and static pressure.";

    if (airflowDriver === "ach" && airflowPenaltyRatio > 1.2) {
      optimizationNote = "Airflow is ACH-driven. Consider separating process ventilation or using a dedicated make-up / exhaust path so the cooling coil is not oversized on air quantity.";
    } else if (airflowDriver === "ventilation" && airflowPenaltyRatio > 1.15) {
      optimizationNote = "Ventilation is driving airflow. A DOAS or separate outdoor-air unit can reduce main AHU fan energy.";
    } else if (specificFanPowerKWPerTR > 1.15) {
      optimizationNote = "Specific fan power is high. Review duct static pressure, terminal losses, and zoning to reduce fan energy.";
    }

    return {
      ahu: ahu,
      fan: Object.assign({}, fan, {
        dutyCFM: perSectionDutyCFM,
        unitCount: airSectionCount,
        systemMotorKW: recommendedMotorKW,
        brakeKWTotal: brakeKWTotal,
        electricalKWTotal: electricalFanKWTotal
      }),
      recommendedMotorKWPerUnit: roundTo(recommendedMotorKWPerUnit, 2),
      recommendedMotorKW: recommendedMotorKW,
      electricalFanKWTotal: electricalFanKWTotal,
      specificFanPowerKWPerTR: specificFanPowerKWPerTR,
      installedMotorSpecificFanPowerKWPerTR: installedMotorSpecificFanPowerKWPerTR,
      airflowPenaltyRatio: airflowPenaltyRatio,
      airflowPenaltyPercent: airflowPenaltyPercent,
      optimizationNote: optimizationNote
    };
  }

  function buildAhuGroups(rooms, diversityFactor) {
    const groups = {};

    rooms.forEach(function (room) {
      if (!room.result) {
        return;
      }
      const key = (room.inputs && room.inputs.ahu_group) || room.ahuGroup || "AHU-1";
      if (!groups[key]) {
        groups[key] = {
          name: key,
          roomCount: 0,
          totalDesignTR: 0,
          totalFinalTR: 0,
          totalCatalogTR: 0,
          totalCFM: 0,
          peakESP: 0,
          preferredMargin: 0.1
        };
      }

      groups[key].roomCount += 1;
      groups[key].totalDesignTR += room.result.tr_design || room.result.tr_calc || 0;
      groups[key].totalFinalTR += room.result.tr_final || room.result.tr_sf || room.result.tr_design || room.result.TR_sel || 0;
      groups[key].totalCatalogTR += room.result.tr_catalog || room.result.TR_sel || 0;
      groups[key].totalCFM += room.result.cfm_conditioned || room.result.Q_sup_cfm || room.result.cfm_final || 0;
      groups[key].peakESP = Math.max(groups[key].peakESP, room.result.total_esp || 0);
      groups[key].preferredMargin = Math.max(groups[key].preferredMargin, (room.result.airflowBasis && room.result.airflowBasis.preferredSelectionMargin) || 0.1);
    });

    return Object.keys(groups).sort().map(function (key) {
      const group = groups[key];
      const diversifiedFinalTR = group.totalFinalTR * diversityFactor;
      const diversifiedCFM = group.totalCFM * diversityFactor;
      const diversifiedCatalogTR = nextCatalogTR(diversifiedFinalTR);
      const selection = selectSystem(diversifiedFinalTR, diversifiedCFM, group.peakESP, {
        catalogTR: diversifiedCatalogTR,
        designCFMPerTR: safeDiv(diversifiedCFM, diversifiedFinalTR, 400),
        preferredMargin: group.preferredMargin,
        airflowConstraint: diversifiedCFM > 0 && diversifiedFinalTR > 0
          ? (safeDiv(diversifiedCFM, diversifiedFinalTR, 0) < 220 ? "thermal" : "balanced")
          : "thermal"
      });

      return {
        name: group.name,
        roomCount: group.roomCount,
        totalDesignTR: group.totalDesignTR,
        totalFinalTR: group.totalFinalTR,
        totalCatalogTR: group.totalCatalogTR,
        diversifiedTR: diversifiedFinalTR,
        diversifiedCatalogTR: diversifiedCatalogTR,
        totalCFM: group.totalCFM,
        diversifiedCFM: diversifiedCFM,
        peakESP: group.peakESP,
        selection: selection
      };
    });
  }

  window.EquipmentEngine = {
    FAN_DATABASE: FAN_DATABASE,
    AHU_DATABASE: AHU_DATABASE,
    nextCatalogTR: nextCatalogTR,
    selectFan: selectFan,
    selectAhu: selectAhu,
    selectSystem: selectSystem,
    buildAhuGroups: buildAhuGroups
  };
}());
