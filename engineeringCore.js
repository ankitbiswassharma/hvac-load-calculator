(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EngineeringCore = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CFM_TO_M3S = 0.00047194745;
  const IN_TO_M = 0.0254;
  const AIR_DENSITY = 1.2;
  const AIR_DYNAMIC_VISCOSITY = 1.85e-5;
  const GALVANIZED_STEEL_ROUGHNESS_M = 0.00015;

  const INFILTRATION_PROFILE_RANGES = {
    tight: {
      comfort: [0.10, 0.30],
      industrial: [0.18, 0.45],
      cleanroom_positive: [0.03, 0.10],
      cleanroom_neutral: [0.05, 0.14],
      cleanroom_negative: [0.06, 0.18]
    },
    normal: {
      comfort: [0.30, 0.70],
      industrial: [0.35, 0.90],
      cleanroom_positive: [0.05, 0.12],
      cleanroom_neutral: [0.08, 0.18],
      cleanroom_negative: [0.10, 0.24]
    },
    leaky: {
      comfort: [0.70, 1.50],
      industrial: [0.80, 1.80],
      cleanroom_positive: [0.08, 0.18],
      cleanroom_neutral: [0.12, 0.28],
      cleanroom_negative: [0.18, 0.40]
    }
  };

  const DEFAULT_FITTING_DATABASE = {
    elbow_90: { label: "90 deg elbow", kFactor: 0.35 },
    elbow_45: { label: "45 deg elbow", kFactor: 0.18 },
    tee_run: { label: "Through tee", kFactor: 0.25 },
    tee_branch: { label: "Branch tee", kFactor: 0.60 },
    reducer: { label: "Reducer", kFactor: 0.12 },
    transition: { label: "Transition", kFactor: 0.15 },
    splitter: { label: "Splitter", kFactor: 0.30 },
    takeoff: { label: "Take-off", kFactor: 0.45 }
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function safeDiv(numerator, denominator, fallback) {
    return denominator ? numerator / denominator : (fallback || 0);
  }

  function roundTo(value, digits) {
    const factor = Math.pow(10, digits || 0);
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function pressureAtElevation(elevationM) {
    return 101325 * Math.pow(1 - 2.25577e-5 * Math.max(0, elevationM || 0), 5.25588);
  }

  // ASHRAE Handbook of Fundamentals (2017) Ch. 1 Eq 5 (over ice, T<0 C) and
  // Eq 6 (over liquid water, T>=0 C). Replaces the prior Arden Buck form so
  // sub-zero ADP search returns physical saturation pressures.
  function saturationPressurePa(tempC) {
    const T = (tempC || 0) + 273.15;
    if (tempC < 0) {
      const c = [
        -5.6745359e3, 6.3925247, -9.677843e-3, 6.2215701e-7,
        2.0747825e-9, -9.484024e-13, 4.1635019
      ];
      return Math.exp(
        c[0] / T + c[1] + c[2] * T + c[3] * T * T + c[4] * T * T * T
        + c[5] * T * T * T * T + c[6] * Math.log(T)
      );
    }
    const c = [
      -5.8002206e3, 1.3914993, -4.8640239e-2, 4.1764768e-5,
      -1.4452093e-8, 6.5459673
    ];
    return Math.exp(
      c[0] / T + c[1] + c[2] * T + c[3] * T * T + c[4] * T * T * T
      + c[5] * Math.log(T)
    );
  }

  function humidityRatioAt(tempC, relativeHumidity, pressurePa) {
    const pressure = pressurePa || 101325;
    const pv = clamp((relativeHumidity || 0) / 100, 0, 1) * saturationPressurePa(tempC);
    return 0.621945 * pv / Math.max(pressure - pv, 1);
  }

  function saturationHumidityRatio(tempC, pressurePa) {
    return humidityRatioAt(tempC, 100, pressurePa);
  }

  function moistAirEnthalpy(tempC, humidityRatioValue) {
    return 1.006 * tempC + humidityRatioValue * (2501 + 1.86 * tempC);
  }

  function humidityRatioFromEnthalpyTemp(enthalpyValue, tempC) {
    return safeDiv(enthalpyValue - 1.006 * tempC, 2501 + 1.86 * tempC, 0);
  }

  function moistAirSpecificVolume(tempC, humidityRatioValue, pressurePa) {
    const pressure = pressurePa || 101325;
    // ASHRAE Eq 26: R_a = 287.042 J/(kg·K) (was 287.055 in legacy code).
    return 287.042 * (tempC + 273.15) * (1 + 1.607858 * humidityRatioValue) / pressure;
  }

  function calculateShrRatio(sensibleLoad, latentLoad, fallback) {
    const sensible = finiteOr(sensibleLoad, 0);
    const latent = finiteOr(latentLoad, 0);
    const total = sensible + latent;
    if (total <= 0) {
      return clamp(fallback || 0, 0, 1);
    }
    return clamp(sensible / total, 0, 1);
  }

  function psychroCp(humidityRatioValue) {
    return 1.006 + 1.86 * Math.max(humidityRatioValue || 0, 0);
  }

  function correctedCltd(options) {
    const settings = options || {};
    const baseCltd = Math.max(settings.baseCltd || 0, 0);
    const outdoorDryBulb = finiteOr(settings.outdoorDryBulb, 35);
    const indoorDryBulb = finiteOr(settings.indoorDryBulb, 24);
    const solarShgf = Math.max(settings.solarShgf || 0, 0);
    const solarAltitudeDeg = Math.max(settings.solarAltitudeDeg || 0, 0);
    // Drop the 0.55 floor: north walls correctly have orientation factor near
    // 0.25 in the ASHRAE CLTD method. Caller may pass anything >0.
    const orientationFactor = Math.max(settings.orientationFactor || 1, 0.10);
    const surfaceType = settings.surfaceType === "roof" ? "roof" : "wall";
    // ASHRAE CLTD reference conditions: T_out=35 C, T_in=25.5 C → 9.5 K.
    // Older 24 C indoor convention → 11 K. Choose whichever matches the
    // caller's design temps so the correction is consistent with their basis.
    const defaultRefDeltaT = outdoorDryBulb - indoorDryBulb;
    const referenceDeltaT = finiteOr(settings.referenceDeltaT, defaultRefDeltaT > 0 ? defaultRefDeltaT : 9.5);
    const deltaT = outdoorDryBulb - indoorDryBulb;
    const temperatureCorrection = deltaT - referenceDeltaT;
    const solarIntensityRatio = clamp(safeDiv(solarShgf, settings.referenceSolarShgf || 700, 0), 0, 1.4);
    const solarAltitudeFactor = Math.sin((Math.PI / 180) * clamp(solarAltitudeDeg, 0, 90));
    const solarCorrection = (surfaceType === "roof" ? 8 : 4) * solarIntensityRatio * (0.35 + 0.65 * solarAltitudeFactor) * orientationFactor;
    const corrected = Math.max(0, baseCltd + temperatureCorrection + solarCorrection);

    return {
      correctedCltd: roundTo(corrected, 1),
      temperatureCorrection: roundTo(temperatureCorrection, 1),
      solarCorrection: roundTo(solarCorrection, 1),
      baseCltd: roundTo(baseCltd, 1)
    };
  }

  function resolveInfiltrationProfile(settings) {
    const profile = String(settings && settings.profile || "normal").toLowerCase();
    const normalizedProfile = INFILTRATION_PROFILE_RANGES[profile] ? profile : "normal";
    const cleanroomMode = !!(settings && settings.cleanroomMode);
    const pressureMode = String(settings && settings.pressureMode || "positive").toLowerCase();
    const comfortProfile = !!(settings && settings.comfortProfile);
    const key = cleanroomMode
      ? pressureMode === "negative"
        ? "cleanroom_negative"
        : pressureMode === "neutral"
          ? "cleanroom_neutral"
          : "cleanroom_positive"
      : comfortProfile
        ? "comfort"
        : "industrial";
    return {
      profile: normalizedProfile,
      range: INFILTRATION_PROFILE_RANGES[normalizedProfile][key],
      key: key
    };
  }

  function buildInfiltrationModel(options) {
    const settings = options || {};
    const volume = Math.max(settings.volume || 0, 0);
    const area = Math.max(settings.area || 0, 0);
    const height = Math.max(settings.height || 0, 0);
    const occupants = Math.max(settings.occupants || 0, 0);
    const roofExposure = settings.roofExposure || "top_floor";
    const wallExposureRatio = Math.max(settings.wallExposureRatio || 0, 0);
    const glazingRatio = Math.max(settings.glazingRatio || 0, 0);
    const occupantDensity = Math.max(settings.occupantDensity || 0, 0);
    const oaSurplusRatio = Math.max(settings.oaSurplusRatio || 0, 0);
    const comfortProfile = settings.comfortProfile !== false;
    const cleanroomMode = !!settings.cleanroomMode;
    const pressureMode = String(settings.pressureMode || "positive").toLowerCase();
    const model = String(settings.model || "ach_profile").toLowerCase() === "crack"
      ? "crack"
      : "ach_profile";
    const assumptions = [];

    if (model === "crack") {
      const pressureDeltaPa = Math.max(settings.pressureDeltaPa || (cleanroomMode ? Math.abs(settings.pressurizationPa || 0) + 7 : 12), 3);
      const crackFlowCoefficient = Math.max(settings.crackFlowCoefficient || 0.045, 0.01);
      const effectiveLeakageAreaSqM = Math.max(
        settings.effectiveLeakageAreaSqM
          || (area * (cleanroomMode ? 0.00008 : comfortProfile ? 0.00035 : 0.00055)),
        cleanroomMode ? 0.003 : 0.01
      );
      const airflowM3S = crackFlowCoefficient * effectiveLeakageAreaSqM * Math.sqrt(pressureDeltaPa);
      const designAch = volume > 0 ? airflowM3S * 3600 / volume : 0;
      assumptions.push("Crack method uses Q = C x A x sqrt(DeltaP) with project leakage area and pressure assumptions.");
      assumptions.push("Leakage area basis: " + roundTo(effectiveLeakageAreaSqM, 4) + " m2 effective leakage area.");

      return {
        model: model,
        profile: settings.profile || "",
        designAch: roundTo(designAch, 3),
        airflowCfm: roundTo(airflowM3S / CFM_TO_M3S, 1),
        pressureDeltaPa: roundTo(pressureDeltaPa, 1),
        effectiveLeakageAreaSqM: roundTo(effectiveLeakageAreaSqM, 4),
        crackFlowCoefficient: roundTo(crackFlowCoefficient, 4),
        assumptions: assumptions,
        note: "Crack infiltration model is active. Leakage varies with pressure differential rather than a fixed ACH band."
      };
    }

    const profileSelection = resolveInfiltrationProfile({
      profile: settings.profile,
      cleanroomMode: cleanroomMode,
      pressureMode: pressureMode,
      comfortProfile: comfortProfile
    });
    const range = profileSelection.range || [0.3, 0.7];
    const baseAch = (range[0] + range[1]) / 2;
    const roofAdd = roofExposure === "top_floor" ? 0.05 : roofExposure === "ground" ? 0.02 : 0;
    const exposureAdd = clamp((wallExposureRatio - 1.1) * 0.08, 0, comfortProfile ? 0.12 : 0.16);
    const glazingAdd = clamp(glazingRatio * 0.10, 0, 0.08);
    const heightAdd = clamp((Math.max(height, 3) - 3) * (comfortProfile ? 0.02 : 0.03), 0, comfortProfile ? 0.10 : 0.18);
    const trafficAdd = clamp(occupantDensity * (comfortProfile ? 0.55 : 0.35), 0, comfortProfile ? 0.10 : 0.12);
    const pressurizationRelief = clamp(oaSurplusRatio * (cleanroomMode ? 0.10 : comfortProfile ? 0.07 : 0.05), 0, cleanroomMode ? 0.10 : 0.08);
    const designAch = clamp(
      baseAch + roofAdd + exposureAdd + glazingAdd + heightAdd + trafficAdd - pressurizationRelief,
      range[0],
      range[1]
    );
    const airflowCfm = volume > 0 ? volume * designAch / (3600 * CFM_TO_M3S) : 0;

    assumptions.push("ACH profile: " + profileSelection.profile + " (" + roundTo(range[0], 2) + "-" + roundTo(range[1], 2) + " ACH).");
    assumptions.push("Envelope, height, occupancy, and pressurization modifiers applied to the selected ACH band.");

    return {
      model: model,
      profile: profileSelection.profile,
      profileKey: profileSelection.key,
      achRange: [roundTo(range[0], 2), roundTo(range[1], 2)],
      designAch: roundTo(designAch, 3),
      airflowCfm: roundTo(airflowCfm, 1),
      assumptions: assumptions,
      note: "Profile-based infiltration model is active. ACH is selected from tight/normal/leaky bands and then corrected for exposure and pressurization."
    };
  }

  function classifyAirflowDriver(entries, fallback) {
    const drivers = Array.isArray(entries) ? entries.filter(Boolean) : [];
    const ranked = drivers.map(function (entry) {
      return {
        key: entry.key || "thermal",
        value: Math.max(finiteOr(entry.value, 0), 0)
      };
    });
    const maxValue = ranked.reduce(function (maxValueInner, entry) {
      return Math.max(maxValueInner, entry.value);
    }, 0);
    const tolerance = Math.max(25, maxValue * 0.02);
    const tied = ranked.filter(function (entry) {
      return Math.abs(entry.value - maxValue) <= tolerance;
    });

    if (tied.length > 1) {
      return "balanced";
    }
    return tied[0] ? tied[0].key : (fallback || "thermal");
  }

  function normalizeComplianceMode(value, cleanroomMode, processMode) {
    const raw = String(value || "").toLowerCase();
    const allowed = {
      comfort_ventilation: true,
      ach_driven: true,
      cleanroom: true,
      healthcare: true,
      laboratory: true,
      process_industrial: true
    };
    if (allowed[raw]) {
      return raw;
    }
    if (cleanroomMode) {
      return "cleanroom";
    }
    if (processMode) {
      return "process_industrial";
    }
    return "comfort_ventilation";
  }

  function normalizeAchRequirementMode(value, complianceMode) {
    const raw = String(value || "").toLowerCase();
    if (raw === "mandatory" || raw === "disabled" || raw === "advisory") {
      return raw;
    }
    return complianceMode === "comfort_ventilation" ? "advisory" : "mandatory";
  }

  function resolveAirflowStreams(options) {
    const settings = options || {};
    const thermalAirflowCfm = Math.max(finiteOr(settings.thermalAirflowCfm, 0), 0);
    const ventilationAirflowCfm = Math.max(finiteOr(settings.ventilationAirflowCfm, 0), 0);
    const achAirflowCfm = Math.max(finiteOr(settings.achAirflowCfm, 0), 0);
    const cleanroomAirflowCfm = Math.max(finiteOr(settings.cleanroomAirflowCfm, 0), 0);
    const cleanroomMode = !!settings.cleanroomMode;
    const complianceMode = normalizeComplianceMode(settings.complianceMode, cleanroomMode, settings.processMode);
    const achRequirementMode = normalizeAchRequirementMode(settings.achRequirementMode, complianceMode);
    const achMandatory = achRequirementMode === "mandatory";
    const forceDedicatedVentilation = !!settings.forceDedicatedVentilation;
    const allowProcessMakeupAir = !!(settings.allowProcessMakeupAir || settings.processMode || cleanroomMode);
    const decoupledVentilation = cleanroomMode || forceDedicatedVentilation;
    const dedicatedVentilationAirflowCfm = decoupledVentilation
      ? ventilationAirflowCfm
      : 0;
    const effectiveAchAirflowCfm = achMandatory ? achAirflowCfm : 0;
    const roomSupplyAirflowCfm = cleanroomMode
      ? Math.max(cleanroomAirflowCfm, thermalAirflowCfm)
      : decoupledVentilation
        ? thermalAirflowCfm
        : Math.max(thermalAirflowCfm, ventilationAirflowCfm, effectiveAchAirflowCfm);
    const processExcessAirflowCfm = cleanroomMode || !allowProcessMakeupAir
      ? 0
      : Math.max(achAirflowCfm - roomSupplyAirflowCfm - dedicatedVentilationAirflowCfm, 0);
    const coolingCoilAirflowCfm = decoupledVentilation
      ? thermalAirflowCfm
      : roomSupplyAirflowCfm;
    const recirculationAirflowCfm = roomSupplyAirflowCfm;
    const neutralRecirculationAirflowCfm = Math.max(recirculationAirflowCfm - coolingCoilAirflowCfm, 0);
    const ventilationIntoCoolingCoilAirflowCfm = decoupledVentilation
      ? 0
      : Math.min(ventilationAirflowCfm, coolingCoilAirflowCfm);
    const ventilationAirflowOutsideCoolingCoilCfm = dedicatedVentilationAirflowCfm + processExcessAirflowCfm;
    const totalDeliveredAirflowCfm = coolingCoilAirflowCfm + neutralRecirculationAirflowCfm + ventilationAirflowOutsideCoolingCoilCfm;
    const architectureMode = cleanroomMode
      ? "decoupled_cleanroom"
      : processExcessAirflowCfm > 0
        ? "cooling_plus_process_air"
        : decoupledVentilation
          ? "decoupled_ventilation"
          : "single_mixed_air";
    const roomAirflowConstraint = cleanroomMode
      ? classifyAirflowDriver([
          { key: "thermal", value: thermalAirflowCfm },
          { key: "ventilation", value: ventilationAirflowCfm },
          { key: "cleanroom", value: cleanroomAirflowCfm }
        ], "thermal")
      : classifyAirflowDriver([
          { key: "thermal", value: thermalAirflowCfm },
          { key: "ventilation", value: ventilationAirflowCfm },
          { key: "ach", value: effectiveAchAirflowCfm }
        ], "thermal");
    const coolingAirflowConstraint = classifyAirflowDriver([
      { key: "thermal", value: thermalAirflowCfm },
      { key: "ventilation", value: decoupledVentilation ? 0 : ventilationAirflowCfm }
    ], "thermal");
    const notes = [];

    if (cleanroomMode) {
      notes.push("Cleanroom airflow is treated as total room recirculation / cleanliness duty, not as the active cooling-coil control airflow.");
      notes.push("Outdoor air is treated as a dedicated make-up stream so class recirculation does not artificially inflate the cooling-coil psychrometric process.");
    } else if (processExcessAirflowCfm > 0) {
      notes.push("ACH excess is separated from the cooling coil so process / make-up airflow does not distort the comfort psychrometric process.");
    }
    if (recirculationAirflowCfm > coolingCoilAirflowCfm + 25) {
      notes.push("Recirculation airflow above the active cooling-coil airflow is tracked separately so cleanliness / room-air motion is not reported as cooling airflow.");
    }

    return {
      architectureMode: architectureMode,
      complianceMode: complianceMode,
      achRequirementMode: achRequirementMode,
      achMandatory: achMandatory,
      decoupledVentilation: decoupledVentilation,
      allowProcessMakeupAir: allowProcessMakeupAir,
      roomSupplyAirflowCfm: roundTo(roomSupplyAirflowCfm, 1),
      coolingCoilAirflowCfm: roundTo(coolingCoilAirflowCfm, 1),
      recirculationAirflowCfm: roundTo(recirculationAirflowCfm, 1),
      additionalRecirculationAirflowCfm: roundTo(neutralRecirculationAirflowCfm, 1),
      outdoorAirThroughCoilCFM: roundTo(ventilationIntoCoolingCoilAirflowCfm, 1),
      outdoorAirThroughCoilCfm: roundTo(ventilationIntoCoolingCoilAirflowCfm, 1),
      dedicatedVentilationCFM: roundTo(dedicatedVentilationAirflowCfm, 1),
      processMakeupAirCFM: roundTo(processExcessAirflowCfm, 1),
      bypassRecirculationCFM: roundTo(neutralRecirculationAirflowCfm, 1),
      totalRoomSupplyCFM: roundTo(totalDeliveredAirflowCfm, 1),
      exhaustReplacementCFM: roundTo(processExcessAirflowCfm, 1),
      ventilationAirflowCfm: roundTo(ventilationAirflowOutsideCoolingCoilCfm, 1),
      totalOutdoorAirCfm: roundTo(ventilationAirflowCfm, 1),
      dedicatedVentilationAirflowCfm: roundTo(dedicatedVentilationAirflowCfm, 1),
      ventilationIntoCoolingCoilAirflowCfm: roundTo(ventilationIntoCoolingCoilAirflowCfm, 1),
      neutralRecirculationAirflowCfm: roundTo(neutralRecirculationAirflowCfm, 1),
      processExcessAirflowCfm: roundTo(processExcessAirflowCfm, 1),
      totalDeliveredAirflowCfm: roundTo(totalDeliveredAirflowCfm, 1),
      roomAirflowConstraint: roomAirflowConstraint,
      coolingAirflowConstraint: coolingAirflowConstraint,
      notes: notes
    };
  }

  function ductAreaM2(duct) {
    const data = duct || {};
    if (data.dia_in) {
      const diameterM = Math.max(data.dia_in * IN_TO_M, 0);
      return Math.PI * diameterM * diameterM / 4;
    }
    const widthM = Math.max((data.rectW || 0) * IN_TO_M, 0);
    const heightM = Math.max((data.rectH || 0) * IN_TO_M, 0);
    return widthM * heightM;
  }

  function hydraulicDiameterM(duct) {
    const data = duct || {};
    if (data.dia_in) {
      return Math.max(data.dia_in * IN_TO_M, 0);
    }
    const widthM = Math.max((data.rectW || 0) * IN_TO_M, 0);
    const heightM = Math.max((data.rectH || 0) * IN_TO_M, 0);
    if (widthM <= 0 || heightM <= 0) {
      return 0;
    }
    return (2 * widthM * heightM) / (widthM + heightM);
  }

  function swameeJainFrictionFactor(reynolds, roughnessM, diameterM) {
    if (!(reynolds > 0) || !(diameterM > 0)) {
      return 0;
    }
    if (reynolds < 2300) {
      return 64 / reynolds;
    }
    const relativeRoughness = Math.max(roughnessM || GALVANIZED_STEEL_ROUGHNESS_M, 1e-8) / Math.max(diameterM, 1e-6);
    const term = (relativeRoughness / 3.7) + (5.74 / Math.pow(reynolds, 0.9));
    return 0.25 / Math.pow(Math.log10(term), 2);
  }

  function calculateDuctPressureLoss(options) {
    const settings = options || {};
    const cfm = Math.max(settings.cfm || 0, 0);
    const duct = settings.duct || {};
    const lengthM = Math.max(settings.lengthM || 0, 0);
    const density = Math.max(settings.density || AIR_DENSITY, 0.9);
    const areaM2 = ductAreaM2(duct);
    const diameterM = hydraulicDiameterM(duct);
    const airflowM3S = cfm * CFM_TO_M3S;
    const velocityMps = areaM2 > 0 ? airflowM3S / areaM2 : 0;
    const reynolds = diameterM > 0 ? density * velocityMps * diameterM / AIR_DYNAMIC_VISCOSITY : 0;
    const frictionFactor = swameeJainFrictionFactor(reynolds, settings.roughnessM, diameterM);
    const velocityPressurePa = 0.5 * density * velocityMps * velocityMps;
    const frictionLossPa = diameterM > 0 ? frictionFactor * (lengthM / diameterM) * velocityPressurePa : 0;

    return {
      airflowM3S: roundTo(airflowM3S, 4),
      areaM2: roundTo(areaM2, 4),
      hydraulicDiameterM: roundTo(diameterM, 4),
      velocityMps: roundTo(velocityMps, 3),
      reynolds: roundTo(reynolds, 0),
      frictionFactor: roundTo(frictionFactor, 4),
      velocityPressurePa: roundTo(velocityPressurePa, 2),
      frictionLossPa: roundTo(frictionLossPa, 2),
      lossPerMeterPa: roundTo(lengthM > 0 ? frictionLossPa / lengthM : 0, 2)
    };
  }

  function calculateFittingLoss(options) {
    const settings = options || {};
    const fittings = Array.isArray(settings.fittings) ? settings.fittings : [];
    const section = calculateDuctPressureLoss({
      cfm: settings.cfm,
      duct: settings.duct,
      density: settings.density,
      roughnessM: settings.roughnessM,
      lengthM: 1
    });
    const velocityPressurePa = section.velocityPressurePa || 0;
    const breakdown = fittings.map(function (entry) {
      const fitting = entry || {};
      const data = DEFAULT_FITTING_DATABASE[fitting.type] || {};
      const count = Math.max(fitting.count || 0, 0);
      const kFactor = Math.max(
        fitting.kFactor != null ? fitting.kFactor : data.kFactor || 0,
        0
      );
      return {
        type: fitting.type || "custom",
        label: fitting.label || data.label || "Custom fitting",
        count: count,
        kFactor: roundTo(kFactor, 3),
        lossPa: roundTo(count * kFactor * velocityPressurePa, 2)
      };
    }).filter(function (entry) {
      return entry.count > 0 && entry.lossPa > 0;
    });

    return {
      totalLossPa: roundTo(breakdown.reduce(function (sum, entry) {
        return sum + entry.lossPa;
      }, 0), 2),
      velocityPressurePa: roundTo(velocityPressurePa, 2),
      breakdown: breakdown
    };
  }

  const DUCT_CALIBRATION_PRESETS = {
    low_velocity: { targetVelocityMps: 3.0, frictionRateRangePaM: [0.25, 1.2] },
    normal_comfort: { targetVelocityMps: 4.5, frictionRateRangePaM: [0.6, 3.0] },
    compact_ceiling: { targetVelocityMps: 6.0, frictionRateRangePaM: [1.2, 5.5] },
    high_velocity: { targetVelocityMps: 8.0, frictionRateRangePaM: [2.5, 9.0] }
  };

  function equivalentDiameterM(duct) {
    const data = duct || {};
    if (data.dia_in) {
      return Math.max(data.dia_in * IN_TO_M, 0);
    }
    const widthM = Math.max((data.rectW || 0) * IN_TO_M, 0);
    const heightM = Math.max((data.rectH || 0) * IN_TO_M, 0);
    if (widthM <= 0 || heightM <= 0) {
      return 0;
    }
    return 1.30 * Math.pow(widthM * heightM, 0.625) / Math.pow(widthM + heightM, 0.25);
  }

  function calculateDuctDiagnostics(options) {
    const settings = options || {};
    const presetKey = DUCT_CALIBRATION_PRESETS[settings.calibrationPreset] ? settings.calibrationPreset : "normal_comfort";
    const friction = calculateDuctPressureLoss(settings);
    const fittings = calculateFittingLoss(settings);
    const totalEspPa = Math.max(finiteOr(settings.totalEspPa, 0), 0);
    const ductFrictionPa = Math.max(friction.frictionLossPa || 0, 0);
    const fittingLossPa = Math.max(fittings.totalLossPa || 0, 0);
    const equipmentLossPa = Math.max(finiteOr(settings.equipmentLossPa, 0), 0);
    const preset = DUCT_CALIBRATION_PRESETS[presetKey];
    const rate = friction.lossPerMeterPa || 0;
    const low = preset.frictionRateRangePaM[0];
    const high = preset.frictionRateRangePaM[1];
    const accepted = rate >= low && rate <= high;
    const oversized = rate < low && friction.velocityMps < preset.targetVelocityMps * 0.75;
    return {
      calibrationPreset: presetKey,
      airflowM3S: friction.airflowM3S,
      areaM2: friction.areaM2,
      hydraulicDiameterM: friction.hydraulicDiameterM,
      equivalentDiameterM: roundTo(equivalentDiameterM(settings.duct || {}), 4),
      velocityMps: friction.velocityMps,
      velocityPressurePa: friction.velocityPressurePa,
      reynolds: friction.reynolds,
      frictionFactor: friction.frictionFactor,
      frictionRatePaM: friction.lossPerMeterPa,
      ductFrictionPa: roundTo(ductFrictionPa, 2),
      fittingLossPa: roundTo(fittingLossPa, 2),
      equipmentLossPa: roundTo(equipmentLossPa, 2),
      ductSharePercent: roundTo(totalEspPa > 0 ? ductFrictionPa / totalEspPa * 100 : 0, 1),
      fittingSharePercent: roundTo(totalEspPa > 0 ? fittingLossPa / totalEspPa * 100 : 0, 1),
      equipmentSharePercent: roundTo(totalEspPa > 0 ? equipmentLossPa / totalEspPa * 100 : 0, 1),
      status: accepted ? "ACCEPTED" : oversized ? "OVERSIZED_LOW_FRICTION" : "REVIEW",
      explanation: accepted
        ? "Duct friction rate is inside the selected calibration band."
        : oversized
          ? "Low friction is explainable by oversized / low-velocity duct sizing."
          : "Duct friction rate is outside the selected calibration band and should be reviewed.",
      fittingBreakdown: fittings.breakdown
    };
  }

  function cfmPerTrTypicalRange(systemType) {
    const key = String(systemType || "comfort_cooling").toLowerCase();
    if (key.indexOf("latent") !== -1) return [300, 400];
    if (key.indexOf("ventilation") !== -1) return [350, 550];
    if (key.indexOf("cleanroom") !== -1 || key.indexOf("process") !== -1) return [180, 900];
    if (key.indexOf("low") !== -1) return [280, 380];
    return [350, 450];
  }

  function buildAirflowDiagnostics(options) {
    const settings = options || {};
    const systemType = settings.systemType || "comfort_cooling";
    const typical = cfmPerTrTypicalRange(systemType);
    const trFinal = Math.max(finiteOr(settings.trFinal, 0), 0);
    const coolingAirflowCfm = Math.max(finiteOr(settings.coolingAirflowCfm, 0), 0);
    const actualCfmPerTr = trFinal > 0 ? coolingAirflowCfm / trFinal : 0;
    const drivers = [
      { key: "sensible", label: "Sensible cooling airflow", value: Math.max(finiteOr(settings.sensibleAirflowCfm, 0), 0) },
      { key: "latent", label: "Latent / dehumidification constraint", value: Math.max(finiteOr(settings.latentAirflowCfm, 0), 0) },
      { key: "ventilation", label: "Ventilation airflow requirement", value: Math.max(finiteOr(settings.ventilationAirflowCfm, 0), 0) },
      { key: "ach", label: "ACH-driven airflow requirement", value: Math.max(finiteOr(settings.achAirflowCfm, 0), 0) }
    ];
    const mandatoryAch = settings.achMandatory === true;
    const selectedDriver = classifyAirflowDriver(drivers.map(function (entry) {
      return entry.key === "ach" && !mandatoryAch ? { key: entry.key, value: 0 } : entry;
    }), "sensible");
    const high = actualCfmPerTr > typical[1];
    const low = actualCfmPerTr > 0 && actualCfmPerTr < typical[0];
    const reasons = [];
    if (high) {
      if ((settings.roomDeltaTDesign || 0) < 8.5) reasons.push("low supply-air delta T");
      if ((settings.latentLoadRatio || 0) > 0.30) reasons.push("high latent requirement");
      if (mandatoryAch && selectedDriver === "ach") reasons.push("mandatory ACH");
      if (selectedDriver === "ventilation") reasons.push("high ventilation");
      if (settings.equipmentAirflowLimit) reasons.push("equipment airflow catalog limit");
      if (settings.userOverride) reasons.push("user override");
    }
    return {
      systemType: systemType,
      sensibleAirflowRequirementCfm: roundTo(drivers[0].value, 1),
      latentDehumidificationConstraintCfm: roundTo(drivers[1].value, 1),
      ventilationAirflowRequirementCfm: roundTo(drivers[2].value, 1),
      achDrivenAirflowRequirementCfm: roundTo(drivers[3].value, 1),
      selectedAirflowDriver: selectedDriver,
      achMandatory: mandatoryAch,
      actualCfmPerTr: roundTo(actualCfmPerTr, 1),
      typicalRange: typical,
      status: high ? "HIGH" : low ? "LOW" : "NORMAL",
      reasons: reasons,
      correctiveActions: high ? [
        "Increase supply-air delta T where comfort and diffuser throw allow.",
        "Use lower airflow / colder supply design with checked coil ADP and humidity control.",
        "Separate ventilation with DOAS/MAU where outdoor air is the driver.",
        "Revise diffuser count/layout and AHU module split for practical outlet CFM.",
        mandatoryAch ? "Increase conditioned recirculation or dedicated filtered module for mandatory ACH." : "Revise comfort ACH target because it is advisory."
      ] : []
    };
  }

  function solveAdpFromProcess(maTemp, maHumidity, saTemp, saHumidity, pressurePa) {
    const supplySatHumidity = saturationHumidityRatio(saTemp, pressurePa);
    const noCoolingProcess = saTemp >= maTemp - 0.05 && saHumidity >= maHumidity - 0.00002;
    if (noCoolingProcess) {
      return {
        temp: saTemp,
        humidity: Math.min(saHumidity, supplySatHumidity),
        bypassFactor: 1,
        bfTemp: 1,
        bfHumidity: 1,
        method: "no_cooling"
      };
    }

    if (saHumidity >= supplySatHumidity - 0.00002) {
      return {
        temp: saTemp,
        humidity: supplySatHumidity,
        bypassFactor: 0,
        bfTemp: 0,
        bfHumidity: 0,
        humidityError: 0,
        method: "supply_on_saturation"
      };
    }

    const lowerBound = Math.max(-5, Math.min(saTemp, maTemp) - 18);
    const upperBound = Math.min(saTemp, maTemp);
    let best = null;

    for (let temp = lowerBound; temp <= upperBound + 0.0001; temp += 0.05) {
      const satHumidity = saturationHumidityRatio(temp, pressurePa);
      if (satHumidity > saHumidity + 0.00002) {
        continue;
      }

      const tempDenominator = maTemp - temp;
      const humidityDenominator = maHumidity - satHumidity;
      if (tempDenominator <= 0.0001 || humidityDenominator <= 0.0000001) {
        continue;
      }

      const bfTemp = (saTemp - temp) / tempDenominator;
      const bfHumidity = (saHumidity - satHumidity) / humidityDenominator;
      if (!Number.isFinite(bfTemp) || !Number.isFinite(bfHumidity)) {
        continue;
      }
      if (bfTemp < -0.02 || bfTemp > 1.02 || bfHumidity < -0.02 || bfHumidity > 1.02) {
        continue;
      }

      const predictedHumidity = satHumidity + bfTemp * humidityDenominator;
      const humidityError = Math.abs(predictedHumidity - saHumidity) * 1000;
      const bypassError = Math.abs(bfTemp - bfHumidity);
      const score = humidityError * 8 + bypassError * 120 + Math.abs(saTemp - temp) * 0.02;

      if (!best || score < best.score) {
        best = {
          temp: temp,
          humidity: satHumidity,
          score: score,
          humidityError: humidityError,
          bfTemp: bfTemp,
          bfHumidity: bfHumidity
        };
      }
    }

    if (!best) {
      return {
        temp: saTemp,
        humidity: supplySatHumidity,
        bypassFactor: 0,
        bfTemp: 0,
        bfHumidity: 0,
        humidityError: 0,
        method: "fallback_supply_saturation"
      };
    }

    return {
      temp: best.temp,
      humidity: best.humidity,
      bypassFactor: clamp((best.bfTemp + best.bfHumidity) / 2, 0, 1),
      bfTemp: clamp(best.bfTemp, 0, 1),
      bfHumidity: clamp(best.bfHumidity, 0, 1),
      humidityError: roundTo(best.humidityError, 3),
      method: "bf_consistent_search"
    };
  }

  function evaluateSupplyCandidate(candidateTemp, settings, targetSupplyEnthalpy, loadShr) {
    const roomTemp = settings.roomTempC;
    const roomHumidity = settings.roomHumidityRatio;
    const roomTotalW = settings.roomTotalW;
    const supplyMassFlowDa = settings.supplyMassFlowDa;
    const pressurePa = settings.pressurePa;
    const targetHumidity = humidityRatioFromEnthalpyTemp(targetSupplyEnthalpy, candidateTemp);
    const satHumidity = saturationHumidityRatio(candidateTemp, pressurePa);
    const saturationViolation = targetHumidity - satHumidity;
    const valid = Number.isFinite(targetHumidity) && targetHumidity >= 0 && saturationViolation <= 0.00002;
    const humidity = valid ? targetHumidity : satHumidity;
    const cpAverage = psychroCp((roomHumidity + Math.max(humidity, 0)) / 2);
    const sensibleDelivered = supplyMassFlowDa * cpAverage * Math.max(roomTemp - candidateTemp, 0) * 1000;
    const shrPsychro = calculateShrRatio(sensibleDelivered, Math.max(roomTotalW - sensibleDelivered, 0), loadShr);
    const actualEnthalpy = moistAirEnthalpy(candidateTemp, humidity);
    const enthalpyError = Math.abs(targetSupplyEnthalpy - actualEnthalpy);
    const shrError = shrPsychro - loadShr;

    return {
      valid: valid,
      temp: candidateTemp,
      humidity: humidity,
      saturationViolation: roundTo(Math.max(saturationViolation, 0) * 1000, 3),
      cpAverage: cpAverage,
      sensibleDelivered: sensibleDelivered,
      shrPsychro: shrPsychro,
      shrError: shrError,
      enthalpyError: enthalpyError,
      score: Math.abs(shrError) * 100 + enthalpyError * 10 + Math.max(saturationViolation, 0) * 100000
    };
  }

  function solveRoomPsychrometrics(options) {
    const settings = options || {};
    const roomTempC = finiteOr(settings.roomTempC, 24);
    const roomHumidityRatio = Math.max(finiteOr(settings.roomHumidityRatio, 0.009), 0);
    const roomEnthalpy = finiteOr(settings.roomEnthalpy, moistAirEnthalpy(roomTempC, roomHumidityRatio));
    const roomSensibleW = Math.max(finiteOr(settings.roomSensibleW, 0), 0);
    const roomTotalW = Math.max(finiteOr(settings.roomTotalW, roomSensibleW), roomSensibleW);
    const supplyMassFlowDa = Math.max(finiteOr(settings.supplyMassFlowDa, 0), 0);
    const pressurePa = Math.max(finiteOr(settings.pressurePa, 101325), 1000);
    const mixedAirTempC = finiteOr(settings.mixedAirTempC, roomTempC);
    const mixedAirHumidityRatio = Math.max(finiteOr(settings.mixedAirHumidityRatio, roomHumidityRatio), 0);
    const mixedAirEnthalpy = finiteOr(settings.mixedAirEnthalpy, moistAirEnthalpy(mixedAirTempC, mixedAirHumidityRatio));
    const initialSupplyTempC = clamp(finiteOr(settings.initialSupplyTempC, roomTempC - 9), 4, roomTempC - 0.5);
    const toleranceShr = Math.max(finiteOr(settings.toleranceShr, 0.02), 0.001);
    const toleranceEnthalpy = Math.max(finiteOr(settings.toleranceEnthalpy, 0.5), 0.05);
    const loadShr = calculateShrRatio(roomSensibleW, Math.max(roomTotalW - roomSensibleW, 0), 0.85);
    const assumptions = [];

    if (!(supplyMassFlowDa > 0) || !(roomTotalW > 0)) {
      return {
        supplyTemp: initialSupplyTempC,
        supplyHumidity: roomHumidityRatio,
        supplyEnthalpy: roomEnthalpy,
        mixedAirTemp: mixedAirTempC,
        mixedAirHumidity: mixedAirHumidityRatio,
        mixedAirEnthalpy: mixedAirEnthalpy,
        roomShrLoad: loadShr,
        roomShrPsychro: loadShr,
        shrError: 0,
        enthalpyBalanceErrorKJkg: 0,
        roomSensibleDelivered: roomSensibleW,
        roomLatentDelivered: Math.max(roomTotalW - roomSensibleW, 0),
        coilTotalLoad: 0,
        coilSensible: 0,
        coilLatent: 0,
        adpTemp: initialSupplyTempC,
        adpHumidity: saturationHumidityRatio(initialSupplyTempC, pressurePa),
        bypassFactor: 1,
        bfTemp: 1,
        bfHumidity: 1,
        adpMethod: "no_room_load",
        adpHumidityError: 0,
        iterations: 0,
        converged: true,
        processNote: "No room load or cooling airflow was available, so the psychrometric room-process solver stayed at the return-air state.",
        assumptions: assumptions
      };
    }

    const targetSupplyEnthalpy = roomEnthalpy - roomTotalW / (supplyMassFlowDa * 1000);
    let low = Math.max(settings.minSupplyTempC == null ? roomTempC - 18 : settings.minSupplyTempC, 4);
    let high = Math.min(settings.maxSupplyTempC == null ? roomTempC - 0.5 : settings.maxSupplyTempC, roomTempC - 0.5);
    let best = null;
    let iterations = 0;
    const ranges = [
      { step: 0.5, span: [low, high] },
      { step: 0.1, span: null },
      { step: 0.02, span: null }
    ];

    ranges.forEach(function (range) {
      const start = range.span ? range.span[0] : Math.max(low, (best ? best.temp : initialSupplyTempC) - 1.0);
      const end = range.span ? range.span[1] : Math.min(high, (best ? best.temp : initialSupplyTempC) + 1.0);
      for (let temp = start; temp <= end + 0.0001; temp += range.step) {
        const candidate = evaluateSupplyCandidate(temp, {
          roomTempC: roomTempC,
          roomHumidityRatio: roomHumidityRatio,
          roomTotalW: roomTotalW,
          supplyMassFlowDa: supplyMassFlowDa,
          pressurePa: pressurePa
        }, targetSupplyEnthalpy, loadShr);
        iterations += 1;
        if (!best || candidate.score < best.score) {
          best = candidate;
        }
      }
    });

    best = best || evaluateSupplyCandidate(initialSupplyTempC, {
      roomTempC: roomTempC,
      roomHumidityRatio: roomHumidityRatio,
      roomTotalW: roomTotalW,
      supplyMassFlowDa: supplyMassFlowDa,
      pressurePa: pressurePa
    }, targetSupplyEnthalpy, loadShr);

    const adp = solveAdpFromProcess(
      mixedAirTempC,
      mixedAirHumidityRatio,
      best.temp,
      best.humidity,
      pressurePa
    );
    const coilCp = psychroCp((mixedAirHumidityRatio + best.humidity) / 2);
    const coilTotalLoad = Math.max(0, supplyMassFlowDa * (mixedAirEnthalpy - moistAirEnthalpy(best.temp, best.humidity)) * 1000);
    const coilSensible = Math.max(0, supplyMassFlowDa * coilCp * Math.max(mixedAirTempC - best.temp, 0) * 1000);
    const roomLatentDelivered = Math.max(roomTotalW - best.sensibleDelivered, 0);
    const enthalpyBalanceErrorKJkg = Math.abs(targetSupplyEnthalpy - moistAirEnthalpy(best.temp, best.humidity));
    const converged = Math.abs(best.shrError) <= toleranceShr && enthalpyBalanceErrorKJkg <= toleranceEnthalpy;

    assumptions.push("Room-process solver iterates supply DBT until room sensible/total balance converges with the load SHR.");
    if (!best.valid) {
      assumptions.push("Best available solution sat on the saturation boundary, so the room-process target is close to the practical coil limit.");
    }

    return {
      supplyTemp: roundTo(best.temp, 2),
      supplyHumidity: roundTo(best.humidity, 6),
      supplyEnthalpy: roundTo(moistAirEnthalpy(best.temp, best.humidity), 3),
      mixedAirTemp: roundTo(mixedAirTempC, 2),
      mixedAirHumidity: roundTo(mixedAirHumidityRatio, 6),
      mixedAirEnthalpy: roundTo(mixedAirEnthalpy, 3),
      roomShrLoad: roundTo(loadShr, 4),
      roomShrPsychro: roundTo(best.shrPsychro, 4),
      shrError: roundTo(best.shrError, 4),
      enthalpyBalanceErrorKJkg: roundTo(enthalpyBalanceErrorKJkg, 4),
      roomSensibleDelivered: roundTo(best.sensibleDelivered, 1),
      roomLatentDelivered: roundTo(roomLatentDelivered, 1),
      coilTotalLoad: roundTo(coilTotalLoad, 1),
      coilSensible: roundTo(coilSensible, 1),
      coilLatent: roundTo(Math.max(coilTotalLoad - coilSensible, 0), 1),
      adpTemp: roundTo(adp.temp, 2),
      adpHumidity: roundTo(adp.humidity, 6),
      bypassFactor: roundTo(adp.bypassFactor, 4),
      bfTemp: roundTo(adp.bfTemp, 4),
      bfHumidity: roundTo(adp.bfHumidity, 4),
      adpMethod: adp.method,
      adpHumidityError: roundTo(adp.humidityError || 0, 3),
      saturationMarginGkg: roundTo((saturationHumidityRatio(best.temp, pressurePa) - best.humidity) * 1000, 3),
      iterations: iterations,
      converged: converged,
      processNote: converged
        ? "Iterative room-process solution converged to the room load SHR and enthalpy balance."
        : "Iterative room-process solution reached the closest practical state but still carries a residual SHR or enthalpy mismatch.",
      assumptions: assumptions
    };
  }

  function addValidationFinding(findings, payload) {
    findings.push({
      code: payload.code || "validation",
      severity: payload.severity || "advisory",
      category: payload.category || "design",
      title: payload.title || "Validation note",
      detail: payload.detail || "",
      recommendation: payload.recommendation || "",
      basis: payload.basis || "",
      complianceStatus: payload.complianceStatus || (payload.severity === "critical" ? "NON_COMPLIANT" : payload.severity === "warning" ? "REVIEW" : "COMPLIANT")
    });
  }

  function validationSeverityRank(severity) {
    return severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
  }

  function buildDesignValidation(options) {
    const settings = options || {};
    const findings = [];
    const psychro = settings.psychro || {};
    const roomShrLoad = finiteOr(settings.roomShrLoad, psychro.roomShrLoad);
    const roomShrPsychro = finiteOr(settings.roomShrPsychro, psychro.roomShrPsychro);
    const shrDelta = Math.abs(roomShrLoad - roomShrPsychro);
    const enthalpyError = Math.abs(finiteOr(settings.enthalpyBalanceErrorKJkg, psychro.enthalpyBalanceErrorKJkg));
    const achActual = Math.max(finiteOr(settings.achActual, 0), 0);
    const achRequired = Math.max(finiteOr(settings.achRequired, 0), 0);
    const complianceMode = normalizeComplianceMode(settings.complianceMode, !!settings.cleanroomMode, !!settings.processMode);
    const achRequirementMode = normalizeAchRequirementMode(settings.achRequirementMode, complianceMode);
    const achMandatory = achRequirementMode === "mandatory" && achRequired > 0;
    const ventilationProvidedCfm = Math.max(finiteOr(settings.ventilationProvidedCfm, 0), 0);
    const ventilationRequiredCfm = Math.max(finiteOr(settings.ventilationRequiredCfm, 0), 0);
    const selectedTR = Math.max(finiteOr(settings.selectedTR, 0), 0);
    const trFinal = Math.max(finiteOr(settings.trFinal, 0), 0);
    const totalEspPa = Math.max(finiteOr(settings.totalEspPa, 0), 0);
    const supplyTempC = finiteOr(settings.supplyTempC, psychro.supplyTemp);
    const lowSupplyTempLimit = finiteOr(settings.lowSupplyTempLimit, 10.5);
    const latentLoadRatio = 1 - calculateShrRatio(
      Math.max(finiteOr(settings.spaceSensibleW, 0), 0),
      Math.max(finiteOr(settings.spaceLatentW, 0), 0),
      roomShrLoad
    );
    const dataCompleteness = Math.max(0, Math.min(1, finiteOr(settings.dataCompleteness, 1)));
    const infiltrationAch = Math.max(finiteOr(settings.infiltrationAch, 0), 0);
    const roomSupplyAirflowCfm = Math.max(finiteOr(settings.roomSupplyAirflowCfm, 0), 0);
    const coolingCoilAirflowCfm = Math.max(finiteOr(settings.coolingCoilAirflowCfm, 0), 0);
    const recirculationAirflowCfm = Math.max(finiteOr(settings.recirculationAirflowCfm, roomSupplyAirflowCfm), 0);
    const dedicatedVentilationAirflowCfm = Math.max(finiteOr(settings.dedicatedVentilationAirflowCfm, 0), 0);
    const processMakeupAirCfm = Math.max(finiteOr(settings.processMakeupAirCfm, settings.processAirflowCfm), 0);
    const bypassRecirculationCfm = Math.max(finiteOr(settings.bypassRecirculationCfm, settings.returnAirBypassCfm), 0);
    const outdoorAirThroughCoilCfm = Math.max(finiteOr(settings.outdoorAirThroughCoilCfm, settings.coilOutdoorAirCfm), 0);
    const totalRoomSupplyCfm = Math.max(finiteOr(settings.totalRoomSupplyCfm, roomSupplyAirflowCfm + dedicatedVentilationAirflowCfm + processMakeupAirCfm), 0);
    const achRequiredAirflowCfm = Math.max(finiteOr(settings.achRequiredAirflowCfm, 0), 0);
    const achDeliveredAirflowCfm = Math.max(finiteOr(settings.achDeliveredAirflowCfm, totalRoomSupplyCfm), 0);
    const cleanroomMode = complianceMode === "cleanroom" || !!settings.cleanroomMode;
    const comfortMode = complianceMode === "comfort_ventilation";
    const processStreamDefined = !!settings.processStreamDefined;
    const dedicatedStreamDefined = !!settings.dedicatedVentilationStreamDefined || dedicatedVentilationAirflowCfm <= 0.5;
    const energyConditionedAirflowCfm = Math.max(finiteOr(settings.energyConditionedAirflowCfm, recirculationAirflowCfm), 0);
    const energyProcessAirflowCfm = Math.max(finiteOr(settings.energyProcessAirflowCfm, dedicatedVentilationAirflowCfm + processMakeupAirCfm), 0);
    const selectedCatalogTR = Math.max(finiteOr(settings.catalogTR, settings.selectedCatalogTR), 0);
    const trDesign = Math.max(finiteOr(settings.trDesign, settings.tr_design), 0);
    const totalLoadW = Math.max(finiteOr(settings.totalLoadW, 0), 0);
    const sensibleW = Math.max(finiteOr(settings.sensibleW, settings.totalSensibleW), 0);
    const latentW = Math.max(finiteOr(settings.latentW, settings.totalLatentW), 0);
    const designCoolingCfmPerTr = Math.max(finiteOr(settings.designCfmPerTR, settings.cfmPerTR), 0);
    const ductFrictionPa = Math.max(finiteOr(settings.ductFrictionPa, 0), 0);
    const ductFrictionPaPerM = Math.max(finiteOr(settings.ductFrictionPaPerM, settings.ductLengthM ? ductFrictionPa / Math.max(settings.ductLengthM, 0.1) : 0), 0);
    const fittingLossPa = Math.max(finiteOr(settings.fittingLossPa, 0), 0);
    const equipmentLossPa = Math.max(finiteOr(settings.equipmentLossPa, 0), 0);
    const solarGainFactorWm2 = Math.max(finiteOr(settings.solarGainFactorWm2, 0), 0);
    const diffuserSpacingX = Math.max(finiteOr(settings.diffuserSpacingX, 0), 0);
    const diffuserSpacingY = Math.max(finiteOr(settings.diffuserSpacingY, 0), 0);
    const diffuserCount = Math.max(finiteOr(settings.diffuserCount, 0), 0);
    const diffuserOverlapCount = Math.max(finiteOr(settings.diffuserOverlapCount, 0), 0);
    const boqAhuModel = settings.boqAhuModel || "";
    const selectedAhuModel = settings.selectedAhuModel || "";
    const diversityFactor = finiteOr(settings.diversityFactor, 1);
    const projectRoomCount = Math.max(finiteOr(settings.projectRoomCount, 1), 1);
    const coilAirflowUsedCfm = Math.max(finiteOr(settings.coilAirflowUsedCfm, coolingCoilAirflowCfm), 0);
    const returnAirToCoilCfm = Math.max(finiteOr(settings.returnAirToCoilCfm, coolingCoilAirflowCfm), 0);
    const cfmPerTrAirflowCfm = Math.max(finiteOr(settings.cfmPerTrAirflowCfm, coolingCoilAirflowCfm), 0);
    const decoupledVentilation = !!settings.decoupledVentilation;
    const assumptions = Array.isArray(settings.assumptions) ? settings.assumptions.slice() : [];

    if (totalLoadW > 0 && Math.abs(totalLoadW - (sensibleW + latentW)) > Math.max(25, totalLoadW * 0.01)) {
      addValidationFinding(findings, {
        code: "load_sum_mismatch",
        severity: "critical",
        category: "load",
        title: "Total load does not equal sensible plus latent load",
        detail: "Total load is " + roundTo(totalLoadW, 0) + " W, but sensible plus latent is " + roundTo(sensibleW + latentW, 0) + " W.",
        recommendation: "Reconcile the load breakdown before using tonnage, SHR, or equipment selections.",
        basis: "Cross-module load arithmetic check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (totalLoadW > 0 && Math.abs(trDesign - totalLoadW / 3517) > 0.05) {
      addValidationFinding(findings, {
        code: "tr_design_mismatch",
        severity: "critical",
        category: "load",
        title: "TR_design is not tied to total load",
        detail: "TR_design is " + roundTo(trDesign, 2) + " TR, but total load / 3517 is " + roundTo(totalLoadW / 3517, 2) + " TR.",
        recommendation: "Calculate TR_design directly from totalLoadW / 3517 and use that value everywhere.",
        basis: "Cooling load to tonnage conversion check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (trDesign > 0 && trFinal + 0.01 < trDesign && !settings.allowUndersizedFinalTR) {
      addValidationFinding(findings, {
        code: "tr_final_below_design",
        severity: "critical",
        category: "load",
        title: "TR_final is below TR_design",
        detail: "TR_final is " + roundTo(trFinal, 2) + " TR against TR_design " + roundTo(trDesign, 2) + " TR.",
        recommendation: "Increase TR_final to at least TR_design unless a documented override is present.",
        basis: "Final design duty check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (shrDelta > 0.03) {
      addValidationFinding(findings, {
        code: "shr_mismatch",
        severity: "critical",
        category: "psychrometrics",
        title: "SHR mismatch between load and psychrometric process",
        detail: "Load SHR is " + roundTo(roomShrLoad, 3) + " while psychrometric room SHR is " + roundTo(roomShrPsychro, 3) + ".",
        recommendation: "Re-solve the supply-air state until the room process matches the load SHR before finalizing ADP, coil, and humidity-control decisions.",
        basis: "Consultant-grade room-process validation: |SHR_load - SHR_psychrometric| must stay within 0.03.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (enthalpyError > 0.5) {
      addValidationFinding(findings, {
        code: "enthalpy_mismatch",
        severity: "critical",
        category: "psychrometrics",
        title: "Psychrometric enthalpy balance is not closed",
        detail: "Supply-state enthalpy residual is " + roundTo(enthalpyError, 3) + " kJ/kg.",
        recommendation: "Iterate the room and coil process again or increase airflow so the supply state satisfies both total load and saturation constraints.",
        basis: "Psychrometric solver tolerance should stay within 0.5 kJ/kg.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (achMandatory && achActual + 0.05 < achRequired) {
      addValidationFinding(findings, {
        code: "ach_shortfall",
        severity: "critical",
        category: "airflow",
        title: "Delivered airflow does not satisfy the required ACH",
        detail: "Provided ACH is " + roundTo(achActual, 1) + " against a requirement of " + roundTo(achRequired, 1) + (achRequiredAirflowCfm > 0 ? ". Required airflow is " + roundTo(achRequiredAirflowCfm, 0) + " CFM and delivered valid airflow is " + roundTo(achDeliveredAirflowCfm, 0) + " CFM." : "."),
        recommendation: "Add " + (achRequiredAirflowCfm > 0 ? roundTo(Math.max(achRequiredAirflowCfm - achDeliveredAirflowCfm, 0), 0) + " CFM by increasing conditioned supply airflow, adding conditioned recirculation, adding DOAS/MAU with defined supply state, or lowering the ACH target if it is only a preference." : "conditioned supply airflow, conditioned recirculation, or DOAS/MAU with defined supply state until the minimum ACH basis is fully met."),
        basis: "Minimum airflow compliance check.",
        complianceStatus: "NON_COMPLIANT"
      });
    } else if (achRequired > 0 && achRequirementMode === "advisory" && achActual + 0.05 < achRequired) {
      addValidationFinding(findings, {
        code: "ach_advisory_shortfall",
        severity: "advisory",
        category: "airflow",
        title: "ACH target is below the advisory design target",
        detail: "Provided ACH is " + roundTo(achActual, 1) + " against an advisory target of " + roundTo(achRequired, 1) + ".",
        recommendation: "Do not reject the design for comfort ventilation on ACH alone. Improve air motion or revise the advisory target if comfort distribution, IAQ, or owner criteria require it.",
        basis: "Comfort ventilation mode uses outdoor-air compliance as mandatory; ACH is advisory unless explicitly marked mandatory.",
        complianceStatus: "ADVISORY"
      });
    }

    if (ventilationRequiredCfm > 0 && ventilationProvidedCfm + 0.5 < ventilationRequiredCfm) {
      addValidationFinding(findings, {
        code: "ventilation_shortfall",
        severity: "critical",
        category: "ventilation",
        title: "Outdoor air is below the design minimum",
        detail: "Provided outdoor air is " + roundTo(ventilationProvidedCfm, 0) + " CFM against a required minimum of " + roundTo(ventilationRequiredCfm, 0) + " CFM.",
        recommendation: "Increase outdoor air to at least the validated minimum before freezing coil load, fan size, and annual energy.",
        basis: "Minimum ventilation compliance check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (comfortMode && processMakeupAirCfm > 0.5) {
      addValidationFinding(findings, {
        code: "comfort_process_air_undefined",
        severity: "critical",
        category: "airflow_topology",
        title: "Comfort project contains undefined process / make-up airflow",
        detail: "Process / make-up airflow is " + roundTo(processMakeupAirCfm, 0) + " CFM in comfort mode.",
        recommendation: "Do not invent process airflow to satisfy ACH in a comfort room. Route the air through the cooling coil or change the system type to process / cleanroom with a defined supply state.",
        basis: "Airflow topology and thermodynamic path check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (processMakeupAirCfm > 0.5 && !processStreamDefined) {
      addValidationFinding(findings, {
        code: "process_stream_missing_state",
        severity: "critical",
        category: "airflow_topology",
        title: "Process / make-up stream has no defined conditioning state",
        detail: "Process / make-up airflow is " + roundTo(processMakeupAirCfm, 0) + " CFM, but no separate supply state and fan/load path was declared.",
        recommendation: "Define MAU/DOAS/process-air source state, supply state, fan, and load impact before counting this airflow as delivered ACH.",
        basis: "Every thermal/latent airflow must have a defined conditioning path.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (dedicatedVentilationAirflowCfm > 0.5 && !dedicatedStreamDefined) {
      addValidationFinding(findings, {
        code: "dedicated_ventilation_missing_state",
        severity: "critical",
        category: "airflow_topology",
        title: "Dedicated ventilation stream has no defined supply state",
        detail: "Dedicated ventilation is " + roundTo(dedicatedVentilationAirflowCfm, 0) + " CFM without an explicit MAU/DOAS state.",
        recommendation: "Define the dedicated ventilation supply state and load path, or route outdoor air through the cooling coil.",
        basis: "Dedicated airflow thermodynamic path check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (bypassRecirculationCfm > 0.5 && !(cleanroomMode || settings.allowBypassRecirculation)) {
      addValidationFinding(findings, {
        code: "bypass_recirculation_not_allowed",
        severity: "critical",
        category: "airflow_topology",
        title: "Bypass recirculation is not allowed for this system type",
        detail: "Bypass recirculation is " + roundTo(bypassRecirculationCfm, 0) + " CFM.",
        recommendation: "Route recirculation through the coil for comfort systems, or select cleanroom/process mode with a defined bypass supply state.",
        basis: "Untreated bypass airflow cannot be counted as conditioned comfort ACH.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (Math.abs((recirculationAirflowCfm + dedicatedVentilationAirflowCfm + processMakeupAirCfm) - totalRoomSupplyCfm) > 1) {
      addValidationFinding(findings, {
        code: "room_supply_stream_sum_mismatch",
        severity: "critical",
        category: "airflow_topology",
        title: "Total room supply does not match airflow stream sum",
        detail: "Room supply is " + roundTo(totalRoomSupplyCfm, 0) + " CFM, while recirculation + dedicated ventilation + process air is " + roundTo(recirculationAirflowCfm + dedicatedVentilationAirflowCfm + processMakeupAirCfm, 0) + " CFM.",
        recommendation: "Rebuild airflow totals from the explicit stream objects only.",
        basis: "Airflow continuity check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (roomSupplyAirflowCfm > 0 && coolingCoilAirflowCfm > roomSupplyAirflowCfm + 1) {
      addValidationFinding(findings, {
        code: "coil_airflow_exceeds_room_supply",
        severity: "critical",
        category: "airflow",
        title: "Cooling-coil airflow exceeds delivered room airflow",
        detail: "Cooling-coil airflow is " + roundTo(coolingCoilAirflowCfm, 0) + " CFM while room supply is only " + roundTo(roomSupplyAirflowCfm, 0) + " CFM.",
        recommendation: "Rebuild the airflow split so the active coil path never exceeds the delivered room air path.",
        basis: "Physical airflow continuity check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (Math.abs(coilAirflowUsedCfm - coolingCoilAirflowCfm) > 1) {
      addValidationFinding(findings, {
        code: "coil_airflow_mismatch",
        severity: "critical",
        category: "airflow",
        title: "Coil process is not using the dedicated cooling airflow stream",
        detail: "Cooling airflow is " + roundTo(coolingCoilAirflowCfm, 0) + " CFM, but the coil path is carrying " + roundTo(coilAirflowUsedCfm, 0) + " CFM.",
        recommendation: "Block the report and reconnect the coil / psychrometric process to cooling_airflow only.",
        basis: "Cooling-coil linkage check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (Math.abs(returnAirToCoilCfm - coolingCoilAirflowCfm) > 1) {
      addValidationFinding(findings, {
        code: "coil_return_air_mismatch",
        severity: "critical",
        category: "airflow",
        title: "Return air to the cooling coil is not closed on cooling airflow",
        detail: "Cooling airflow is " + roundTo(coolingCoilAirflowCfm, 0) + " CFM, but return air to coil is " + roundTo(returnAirToCoilCfm, 0) + " CFM.",
        recommendation: "Block the report and reconnect the coil return path so return_air.to_coil equals cooling_airflow.",
        basis: "Closed-loop cooling-coil airflow check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (Math.abs(cfmPerTrAirflowCfm - coolingCoilAirflowCfm) > 1) {
      addValidationFinding(findings, {
        code: "cfm_per_tr_not_on_cooling_airflow",
        severity: "critical",
        category: "airflow",
        title: "CFM/TR is not based on cooling airflow",
        detail: "Cooling airflow is " + roundTo(coolingCoilAirflowCfm, 0) + " CFM, but the CFM/TR numerator is using " + roundTo(cfmPerTrAirflowCfm, 0) + " CFM.",
        recommendation: "Block the CFM/TR calculation until its numerator is set to cooling_airflow only.",
        basis: "Cooling-airflow reporting check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (cleanroomMode && ventilationRequiredCfm > 0 && !decoupledVentilation && dedicatedVentilationAirflowCfm <= 0.5) {
      addValidationFinding(findings, {
        code: "cleanroom_ventilation_not_decoupled",
        severity: "warning",
        category: "cleanroom",
        title: "Cleanroom make-up air is not separated from recirculation duty",
        detail: "The current cleanroom basis does not show a distinct dedicated outdoor-air / make-up stream.",
        recommendation: "Separate the make-up air path from the cleanroom recirculation path so class airflow is not treated as mixed-air cooling airflow.",
        basis: "Cleanroom recirculation and make-up-air architecture check."
      });
    }

    if (recirculationAirflowCfm > coolingCoilAirflowCfm * 1.5 + 25 && !cleanroomMode) {
      addValidationFinding(findings, {
        code: "recirculation_mode_not_flagged",
        severity: "warning",
        category: "airflow",
        title: "Recirculation-dominant airflow is not flagged as a separated air system",
        detail: "Recirculation airflow is " + roundTo(recirculationAirflowCfm, 0) + " CFM against only " + roundTo(coolingCoilAirflowCfm, 0) + " CFM on the cooling-coil path.",
        recommendation: "Review whether this room should be handled as cleanroom / separated recirculation mode so cooling airflow is not overstated in reporting.",
        basis: "Airflow-hierarchy sanity check."
      });
    }

    if (trFinal > 0 && selectedCatalogTR > 0 && selectedCatalogTR + 0.01 < trFinal) {
      addValidationFinding(findings, {
        code: "catalog_tr_below_final",
        severity: "critical",
        category: "equipment",
        title: "Catalog AHU capacity is below TR_final",
        detail: "Catalog selection is " + roundTo(selectedCatalogTR, 2) + " TR against TR_final " + roundTo(trFinal, 2) + " TR.",
        recommendation: "Select a catalog AHU at or above TR_final, or flag the selection as an explicit undersized override.",
        basis: "AHU catalog consistency check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (trFinal > 0 && selectedTR > trFinal * 1.15) {
      addValidationFinding(findings, {
        code: "oversized_equipment",
        severity: selectedTR > trFinal * 1.3 ? "warning" : "advisory",
        category: "equipment",
        title: "Cooling equipment is oversized",
        detail: "Selected capacity is " + roundTo((selectedTR / trFinal - 1) * 100, 1) + "% above TR_final.",
        recommendation: "Trim the catalog selection or split the system so reserve stays closer to 5-15% instead of pushing part-load operation too low.",
        basis: "Consultant-grade equipment reserve check."
      });
    }

    if (trFinal > 0 && selectedTR < trFinal * 0.95) {
      addValidationFinding(findings, {
        code: "undersized_equipment",
        severity: "critical",
        category: "equipment",
        title: "Selected cooling capacity is below the required duty",
        detail: "Selected capacity is " + roundTo((1 - selectedTR / trFinal) * 100, 1) + "% below TR_final.",
        recommendation: "Increase equipment capacity or split the load. The current selection does not safely cover the design duty.",
        basis: "Equipment adequacy check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (designCoolingCfmPerTr > 0 && comfortMode && designCoolingCfmPerTr > 475) {
      addValidationFinding(findings, {
        code: "comfort_cfm_per_tr_high",
        severity: "warning",
        category: "airflow",
        title: "Comfort CFM/TR is above the normal range",
        detail: "Cooling airflow is " + roundTo(designCoolingCfmPerTr, 0) + " CFM/TR; comfort systems normally sit near 350-450 CFM/TR.",
        recommendation: "Explain the high airflow basis or revise the split so artificial ACH/process air is not distorting cooling airflow.",
        basis: "Comfort airflow realism check."
      });
    }

    if (designCoolingCfmPerTr > 0 && comfortMode && designCoolingCfmPerTr < 300) {
      addValidationFinding(findings, {
        code: "comfort_cfm_per_tr_low",
        severity: "warning",
        category: "airflow",
        title: "Comfort CFM/TR is below the normal range",
        detail: "Cooling airflow is " + roundTo(designCoolingCfmPerTr, 0) + " CFM/TR; comfort systems normally sit near 350-450 CFM/TR.",
        recommendation: "Check supply temperature, latent load, and coil ADP before accepting a low-airflow comfort design.",
        basis: "Comfort airflow realism check."
      });
    }

    if (Math.abs(energyConditionedAirflowCfm - recirculationAirflowCfm) > 1) {
      addValidationFinding(findings, {
        code: "energy_conditioned_airflow_mismatch",
        severity: "critical",
        category: "energy",
        title: "Energy model conditioned airflow does not match design airflow",
        detail: "Energy conditioned airflow is " + roundTo(energyConditionedAirflowCfm, 0) + " CFM, while design recirculation airflow is " + roundTo(recirculationAirflowCfm, 0) + " CFM.",
        recommendation: "Pass design recirculation airflow directly into the energy model. Do not sum airflow across bins.",
        basis: "Energy input contract check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (Math.abs(energyProcessAirflowCfm - (dedicatedVentilationAirflowCfm + processMakeupAirCfm)) > 1) {
      addValidationFinding(findings, {
        code: "energy_process_airflow_mismatch",
        severity: "critical",
        category: "energy",
        title: "Energy model process airflow does not match design ventilation streams",
        detail: "Energy process airflow is " + roundTo(energyProcessAirflowCfm, 0) + " CFM, while dedicated/process design airflow is " + roundTo(dedicatedVentilationAirflowCfm + processMakeupAirCfm, 0) + " CFM.",
        recommendation: "Pass only physically separate ventilation/process airflow into the process fan model.",
        basis: "Energy input contract check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (projectRoomCount <= 1 && Math.abs(diversityFactor - 1) > 0.001) {
      addValidationFinding(findings, {
        code: "single_room_diversity_applied",
        severity: "critical",
        category: "diversity",
        title: "Diversity factor was applied to a single-room project",
        detail: "Project room count is " + roundTo(projectRoomCount, 0) + " and diversity factor is " + roundTo(diversityFactor, 3) + ".",
        recommendation: "Use diversity factor 1.00 for one-room projects.",
        basis: "Project diversity rule.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (selectedAhuModel && boqAhuModel && selectedAhuModel !== boqAhuModel) {
      addValidationFinding(findings, {
        code: "boq_ahu_selection_mismatch",
        severity: "critical",
        category: "costing",
        title: "BOQ AHU does not match selected AHU",
        detail: "Selected AHU is " + selectedAhuModel + ", while BOQ uses " + boqAhuModel + ".",
        recommendation: "Build BOQ rows from the selected AHU object used by fan selection and reports.",
        basis: "Cross-module AHU source-of-truth check.",
        complianceStatus: "NON_COMPLIANT"
      });
    }

    if (solarGainFactorWm2 > 900) {
      addValidationFinding(findings, {
        code: "solar_gain_factor_high",
        severity: "warning",
        category: "solar",
        title: "Solar gain factor is above the expected design range",
        detail: "Reported solar gain factor / incident irradiance is " + roundTo(solarGainFactorWm2, 0) + " W/m2.",
        recommendation: "Verify direct beam, diffuse, ground-reflected, incidence-angle, SC/SHGC, and CLF assumptions before using the value as SHGF.",
        basis: "Solar-gain physical range check."
      });
    }

    if (diffuserCount > 1 && (diffuserSpacingX <= 0 || diffuserSpacingY <= 0)) {
      addValidationFinding(findings, {
        code: "diffuser_zero_spacing",
        severity: "warning",
        category: "distribution",
        title: "Diffuser grid has zero spacing",
        detail: "Spacing X is " + roundTo(diffuserSpacingX, 2) + " m and spacing Y is " + roundTo(diffuserSpacingY, 2) + " m for " + roundTo(diffuserCount, 0) + " outlets.",
        recommendation: "Recalculate grid spacing across both axes and validate outlet coordinates.",
        basis: "Diffuser layout geometry check."
      });
    }

    if (diffuserOverlapCount > 0) {
      addValidationFinding(findings, {
        code: "diffuser_return_overlap",
        severity: "warning",
        category: "distribution",
        title: "Supply diffusers and return grilles overlap",
        detail: roundTo(diffuserOverlapCount, 0) + " supply/return coordinate overlap(s) were detected.",
        recommendation: "Move return grilles away from supply diffuser coordinates unless intentional colocation is documented.",
        basis: "Diffuser / return placement check."
      });
    }

    if (totalEspPa > 0 && equipmentLossPa > 0 && ductFrictionPa + fittingLossPa > 0) {
      const ductShare = (ductFrictionPa + fittingLossPa) / totalEspPa;
      const equipmentShare = equipmentLossPa / totalEspPa;
      if (ductShare < 0.10) {
        addValidationFinding(findings, {
          code: "duct_esp_share_low",
          severity: "warning",
          category: "ductwork",
          title: "Duct/fitting ESP share is unusually low",
          detail: "Duct plus fitting losses are only " + roundTo(ductShare * 100, 1) + "% of total ESP.",
          recommendation: "Recheck ft/m conversion, hydraulic diameter, velocity pressure, and friction factor before accepting the ESP breakdown.",
          basis: "ESP plausibility check."
        });
      }
      if (equipmentShare > 0.80) {
        addValidationFinding(findings, {
          code: "equipment_esp_share_high",
          severity: "warning",
          category: "ductwork",
          title: "Equipment ESP share dominates the total",
          detail: "Equipment losses are " + roundTo(equipmentShare * 100, 1) + "% of total ESP.",
          recommendation: "Report coil, filter, terminal, and safety allowance separately and verify duct losses were not under-scaled.",
          basis: "ESP plausibility check."
        });
      }
    }

    if (ductFrictionPa > 0 && ductFrictionPaPerM > 0 && (ductFrictionPaPerM < 0.4 || ductFrictionPaPerM > 8)) {
      addValidationFinding(findings, {
        code: "duct_friction_rate_implausible",
        severity: "warning",
        category: "ductwork",
        title: "Duct friction rate needs engineering review",
        detail: "Calculated duct friction rate is " + roundTo(ductFrictionPaPerM, 2) + " Pa/m.",
        recommendation: "Verify CFM-to-m3/s, inch-to-m conversion, hydraulic diameter, velocity pressure, Reynolds number, and friction factor before accepting ESP.",
        basis: "Comfort duct friction plausibility check."
      });
    }

    if (supplyTempC < lowSupplyTempLimit) {
      addValidationFinding(findings, {
        code: "low_supply_temp",
        severity: "warning",
        category: "psychrometrics",
        title: "Supply air temperature is unusually low",
        detail: "Calculated supply temperature is " + roundTo(supplyTempC, 1) + " C.",
        recommendation: "Increase cooling airflow, decouple outdoor or process air, or use a deeper latent-control strategy instead of driving supply temperature lower.",
        basis: "Practical occupied-space coil check."
      });
    }

    if (totalEspPa > 850) {
      addValidationFinding(findings, {
        code: "high_esp",
        severity: totalEspPa > 1000 ? "warning" : "advisory",
        category: "ductwork",
        title: "External static pressure is high",
        detail: "Total external static pressure is " + roundTo(totalEspPa, 0) + " Pa.",
        recommendation: "Lower duct velocity, shorten critical runs, reduce fitting count, or split the air system so fan power stays practical.",
        basis: "Fan-energy and duct-practicality review."
      });
    }

    if (latentLoadRatio > 0.30) {
      addValidationFinding(findings, {
        code: "high_latent",
        severity: "advisory",
        category: "latent_control",
        title: "Latent load is a major part of the room duty",
        detail: "Latent share is " + roundTo(latentLoadRatio * 100, 1) + "% of room total load.",
        recommendation: "Evaluate lower ADP, deeper coils, DOAS, or sensible-only terminal strategies if humidity control is important.",
        basis: "Latent-load screening."
      });
    }

    if (infiltrationAch > 0.7) {
      addValidationFinding(findings, {
        code: "high_infiltration",
        severity: "warning",
        category: "envelope",
        title: "Infiltration assumption is high",
        detail: "Infiltration basis is " + roundTo(infiltrationAch, 2) + " ACH.",
        recommendation: "Check door traffic, façade sealing, vestibules, and pressurization. The load may be dominated by envelope leakage rather than room use.",
        basis: "Infiltration sanity check."
      });
    }

    findings.sort(function (left, right) {
      if (validationSeverityRank(left.severity) !== validationSeverityRank(right.severity)) {
        return validationSeverityRank(right.severity) - validationSeverityRank(left.severity);
      }
      return left.title.localeCompare(right.title);
    });

    const criticalCount = findings.filter(function (finding) { return finding.severity === "critical"; }).length;
    const warningCount = findings.filter(function (finding) { return finding.severity === "warning"; }).length;
    const advisoryCount = findings.filter(function (finding) { return finding.severity === "advisory"; }).length;
    const status = criticalCount ? "NON_COMPLIANT" : warningCount ? "REVIEW" : "COMPLIANT";
    const confidencePenalty = criticalCount * 0.12 + warningCount * 0.06 + advisoryCount * 0.025 + (1 - dataCompleteness) * 0.18;
    const confidenceScore = clamp(0.96 - confidencePenalty + (enthalpyError <= 0.5 ? 0.02 : 0), 0.25, 0.98);

    return {
      status: status,
      complianceMode: complianceMode,
      achRequirementMode: achRequirementMode,
      achMandatory: achMandatory,
      ventilationComplianceStatus: ventilationRequiredCfm > 0 && ventilationProvidedCfm + 0.5 < ventilationRequiredCfm ? "NON_COMPLIANT" : "COMPLIANT",
      achComplianceStatus: achRequired <= 0 || achRequirementMode === "disabled"
        ? "DISABLED"
        : achActual + 0.05 >= achRequired
          ? "COMPLIANT"
          : achMandatory ? "NON_COMPLIANT" : "ADVISORY",
      controllingComplianceBasis: complianceMode === "comfort_ventilation"
        ? "ASHRAE 62.1 / ISHRAE-style outdoor-air ventilation basis"
        : "Mandatory ACH / process airflow basis",
      summary: findings[0]
        ? findings[0].title
        : "No major internal engineering contradictions were found in the current design state.",
      findings: findings,
      criticalCount: criticalCount,
      warningCount: warningCount,
      advisoryCount: advisoryCount,
      confidenceScore: roundTo(confidenceScore, 2),
      assumptions: assumptions
    };
  }

  function firstFinite() {
    let index = 0;
    while (index < arguments.length) {
      if (Number.isFinite(arguments[index])) {
        return arguments[index];
      }
      index += 1;
    }
    return 0;
  }

  function uniqueStrings(list) {
    return (Array.isArray(list) ? list : []).filter(function (value, index, array) {
      return value && array.indexOf(value) === index;
    });
  }

  function stableHash(value) {
    const text = String(value || "");
    let hash = 0;
    let index = 0;
    while (index < text.length) {
      hash = ((hash * 31) + text.charCodeAt(index)) % 2147483647;
      index += 1;
    }
    return hash;
  }

  function chooseVariant(options, seed) {
    const list = Array.isArray(options) ? options.filter(Boolean) : [];
    if (!list.length) {
      return "";
    }
    return list[Math.abs(stableHash(seed)) % list.length];
  }

  function normalizeSentence(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sentenceSimilarity(left, right) {
    const leftTokens = normalizeSentence(left).split(" ").filter(Boolean);
    const rightTokens = normalizeSentence(right).split(" ").filter(Boolean);
    if (!leftTokens.length || !rightTokens.length) {
      return 0;
    }
    const leftSet = {};
    const rightSet = {};
    leftTokens.forEach(function (token) {
      leftSet[token] = true;
    });
    rightTokens.forEach(function (token) {
      rightSet[token] = true;
    });
    const union = {};
    Object.keys(leftSet).forEach(function (token) { union[token] = true; });
    Object.keys(rightSet).forEach(function (token) { union[token] = true; });
    const overlap = Object.keys(leftSet).filter(function (token) {
      return rightSet[token];
    }).length;
    return overlap / Math.max(Object.keys(union).length, 1);
  }

  function dedupeSentences(sentences) {
    return (Array.isArray(sentences) ? sentences : []).reduce(function (list, sentence) {
      const text = String(sentence || "").trim();
      if (!text) {
        return list;
      }
      if (list.some(function (existing) {
        return sentenceSimilarity(existing, text) > 0.72;
      })) {
        return list;
      }
      list.push(text);
      return list;
    }, []);
  }

  function metricPhrase(label, value, unit, digits) {
    if (!Number.isFinite(value)) {
      return "";
    }
    return label + " " + roundTo(value, digits == null ? 0 : digits) + (unit || "");
  }

  function buildNarrative(sentences) {
    return dedupeSentences(sentences).join(" ");
  }

  function scaleRelative(value, reference, fullScale) {
    const base = Math.max(reference || 0, 0.0001);
    return clamp(safeDiv(value, base, 0) / Math.max(fullScale || 1, 0.0001), 0, 1);
  }

  function describeSeverity(score, validationStatus) {
    if (validationStatus === "NON_COMPLIANT" && score > 0.72) {
      return "critical";
    }
    if (score > 0.58) {
      return "warning";
    }
    return "advisory";
  }

  function optionCompliance(optionAch, requiredAch) {
    if (requiredAch > 0 && optionAch + 0.05 < requiredAch) {
      return "NON_COMPLIANT";
    }
    return "COMPLIANT";
  }

  function extractDesignIntelligenceState(options) {
    const settings = options || {};
    const validation = settings.validation || buildDesignValidation(settings);
    const cleanroom = settings.cleanroom || null;
    const airflows = settings.airflows || {};
    const systems = settings.systems || {};
    const systemArchitecture = settings.systemArchitecture || {};
    const designConstraints = settings.designConstraints || {};
    const energyOptimization = settings.energyOptimization || {};
    const zoneDuctPlan = settings.zoneDuctPlan || {};
    const systemRecommendation = settings.systemRecommendation || {};
    const ventilationContext = settings.standardsContext && settings.standardsContext.ventilation
      ? settings.standardsContext.ventilation
      : (settings.ventilationContext || {});
    const coolingAirflowCfm = Math.max(firstFinite(
      settings.coolingAirflowCfm,
      settings.coolingCoilAirflowCfm,
      airflows.cooling && airflows.cooling.airflowCfm,
      systemArchitecture.coolingCoilAirflowCfm
    ), 0);
    const recirculationAirflowCfm = Math.max(firstFinite(
      settings.recirculationAirflowCfm,
      settings.roomSupplyAirflowCfm,
      settings.currentAirflowCfm,
      airflows.recirculation && airflows.recirculation.airflowCfm,
      systemArchitecture.recirculationAirflowCfm
    ), coolingAirflowCfm);
    const dedicatedVentilationAirflowCfm = Math.max(firstFinite(
      settings.dedicatedVentilationAirflowCfm,
      airflows.ventilation && airflows.ventilation.dedicatedAirflowCfm,
      systemArchitecture.dedicatedVentilationAirflowCfm
    ), 0);
    const processAirflowCfm = Math.max(firstFinite(
      settings.processAirflowCfm,
      airflows.ventilation && airflows.ventilation.processAirflowCfm,
      systemArchitecture.processExcessAirflowCfm
    ), 0);
    const ventilationAirflowCfm = Math.max(firstFinite(
      settings.ventilationAirflowCfm,
      airflows.ventilation && airflows.ventilation.airflowCfm,
      systemArchitecture.ventilationAirflowCfm,
      dedicatedVentilationAirflowCfm + processAirflowCfm
    ), dedicatedVentilationAirflowCfm + processAirflowCfm);
    const totalRoomAirflowCfm = Math.max(firstFinite(
      settings.totalRoomAirflowCfm,
      airflows.room && airflows.room.totalAirflowCfm,
      systemArchitecture.totalRoomAirflowCfm,
      recirculationAirflowCfm + ventilationAirflowCfm
    ), recirculationAirflowCfm + ventilationAirflowCfm);
    const outdoorAirCfm = Math.max(firstFinite(
      settings.outdoorAirCfm,
      airflows.ventilation && airflows.ventilation.totalOutdoorAirCfm,
      ventilationContext.designOutdoorAirCfm,
      settings.ventilationProvidedCfm
    ), 0);
    const volumeM3 = Math.max(firstFinite(settings.volumeM3, settings.volume, 0), 0);
    const achRequired = Math.max(firstFinite(
      settings.achRequired,
      cleanroom ? cleanroom.designAch : 0,
      airflows.room && airflows.room.achCompliance,
      0
    ), 0);
    const achActual = Math.max(firstFinite(
      settings.achActual,
      settings.currentAch,
      airflows.room && airflows.room.achCompliance,
      systemArchitecture.achCompliance
    ), 0);
    const achRecirculation = Math.max(firstFinite(
      settings.achRecirculation,
      airflows.room && airflows.room.achRecirculation,
      systemArchitecture.achRecirculation
    ), 0);
    const achTotalRoom = Math.max(firstFinite(
      settings.achTotalRoom,
      airflows.room && airflows.room.achTotalRoom,
      systemArchitecture.achTotalRoom
    ), 0);
    const trFinal = Math.max(firstFinite(settings.trFinal, 0), 0);
    const trCoolingCoil = Math.max(firstFinite(settings.trCoolingCoil, settings.tr_airflow, 0), 0);
    const trVentilation = Math.max(firstFinite(settings.trVentilation, 0), 0);
    const totalEspPa = Math.max(firstFinite(settings.totalEspPa, 0), 0);
    const ductFrictionPa = Math.max(firstFinite(settings.ductFrictionPa, 0), 0);
    const fittingLossPa = Math.max(firstFinite(settings.fittingLossPa, 0), 0);
    const equipmentLossPa = Math.max(firstFinite(settings.equipmentLossPa, 0), 0);
    const coolingFanKW = Math.max(firstFinite(settings.coolingFanKW, systems.cooling && systems.cooling.fanKW, 0), 0);
    const recirculationFanKW = Math.max(firstFinite(settings.recirculationFanKW, systems.recirculation && systems.recirculation.fanKW, 0), 0);
    const ventilationFanKW = Math.max(firstFinite(settings.ventilationFanKW, systems.ventilation && systems.ventilation.fanKW, 0), 0);
    const fanKWTotal = coolingFanKW + recirculationFanKW + ventilationFanKW;
    const zoneCount = Math.max(firstFinite(settings.zoneCount, 1), 1);
    const areaM2 = Math.max(firstFinite(settings.areaM2, 0), 0);
    const latentLoadRatio = clamp(firstFinite(settings.latentLoadRatio, 0), 0, 1);
    const ventilationFraction = Math.max(firstFinite(
      settings.ventilationFraction,
      safeDiv(outdoorAirCfm, Math.max(recirculationAirflowCfm, 1), 0),
      0
    ), 0);
    const processRatio = Math.max(firstFinite(
      settings.processRatio,
      safeDiv(processAirflowCfm, Math.max(recirculationAirflowCfm, 1), 0),
      0
    ), 0);
    const supplyTempC = firstFinite(settings.supplyTempC, settings.psychro && settings.psychro.supplyTemp, 0);
    const bypassFactor = Math.max(firstFinite(settings.bypassFactor, settings.psychro && settings.psychro.bypassFactor, 0), 0);
    const recirculationToCoolingRatio = safeDiv(recirculationAirflowCfm, Math.max(coolingAirflowCfm, 1), 0);
    const ventilationToCoolingRatio = safeDiv(ventilationAirflowCfm, Math.max(coolingAirflowCfm, 1), 0);
    const airflowComplianceBasisCfm = cleanroom ? recirculationAirflowCfm : totalRoomAirflowCfm;
    const requiredOutdoorAirCfm = Math.max(firstFinite(
      ventilationContext.designOutdoorAirCfm,
      ventilationContext.minimumOutdoorAirCfm,
      settings.ventilationRequiredCfm,
      outdoorAirCfm
    ), 0);
    const fanShares = {
      cooling: safeDiv(coolingFanKW, Math.max(fanKWTotal, 0.0001), 0),
      recirculation: safeDiv(recirculationFanKW, Math.max(fanKWTotal, 0.0001), 0),
      ventilation: safeDiv(ventilationFanKW, Math.max(fanKWTotal, 0.0001), 0)
    };

    return {
      validation: validation,
      cleanroom: cleanroom,
      cleanroomMode: !!cleanroom,
      cleanroomClass: cleanroom && cleanroom.classLabel ? cleanroom.classLabel : "",
      systemRecommendation: systemRecommendation,
      currentSystemType: settings.currentSystemType || systemRecommendation.primarySystem || "",
      architectureMode: systemArchitecture.mode || "mixed_air",
      areaM2: areaM2,
      volumeM3: volumeM3,
      zoneCount: zoneCount,
      trFinal: trFinal,
      trCoolingCoil: trCoolingCoil,
      trVentilation: trVentilation,
      coolingAirflowCfm: coolingAirflowCfm,
      recirculationAirflowCfm: recirculationAirflowCfm,
      dedicatedVentilationAirflowCfm: dedicatedVentilationAirflowCfm,
      processAirflowCfm: processAirflowCfm,
      ventilationAirflowCfm: ventilationAirflowCfm,
      totalRoomAirflowCfm: totalRoomAirflowCfm,
      airflowComplianceBasisCfm: airflowComplianceBasisCfm,
      outdoorAirCfm: outdoorAirCfm,
      requiredOutdoorAirCfm: requiredOutdoorAirCfm,
      achRequired: achRequired,
      achActual: achActual,
      achRecirculation: achRecirculation,
      achTotalRoom: achTotalRoom,
      latentLoadRatio: latentLoadRatio,
      ventilationFraction: ventilationFraction,
      processRatio: processRatio,
      supplyTempC: supplyTempC,
      bypassFactor: bypassFactor,
      totalEspPa: totalEspPa,
      ductFrictionPa: ductFrictionPa,
      fittingLossPa: fittingLossPa,
      equipmentLossPa: equipmentLossPa,
      coolingFanKW: coolingFanKW,
      recirculationFanKW: recirculationFanKW,
      ventilationFanKW: ventilationFanKW,
      fanKWTotal: fanKWTotal,
      fanShares: fanShares,
      specificFanPowerKWPerTR: Math.max(firstFinite(settings.specificFanPowerKWPerTR, energyOptimization.specificFanPowerKWPerTR, 0), 0),
      installedMotorSpecificFanPowerKWPerTR: Math.max(firstFinite(settings.installedMotorSpecificFanPowerKWPerTR, energyOptimization.installedMotorSpecificFanPowerKWPerTR, 0), 0),
      designConstraints: designConstraints,
      energyOptimization: energyOptimization,
      zoneDuctPlan: zoneDuctPlan,
      recirculationToCoolingRatio: recirculationToCoolingRatio,
      ventilationToCoolingRatio: ventilationToCoolingRatio,
      airflowMarginRatio: achRequired > 0 ? safeDiv(achActual - achRequired, achRequired, 0) : 0.15,
      coolingShareOfRoom: safeDiv(coolingAirflowCfm, Math.max(totalRoomAirflowCfm, 1), 0),
      coolingLoadShare: safeDiv(trCoolingCoil, Math.max(trFinal, 0.1), 0),
      confidenceScore: validation.confidenceScore || 0.8
    };
  }

  function interpretDesignIntelligenceState(state) {
    const architecture = state.cleanroomMode
      ? (state.cleanroomClass || "Cleanroom") + " architecture with "
        + (state.dedicatedVentilationAirflowCfm > 0 ? "separated make-up air" : "shared outdoor-air handling")
        + " and a recirculation-dominant cleanliness stream"
      : state.ventilationAirflowCfm > 0
        ? "Cooling plus parallel ventilation / make-up architecture"
        : "Cooling-led recirculation architecture";
    const airflowNarrative = state.cleanroomMode
      ? "Cooling airflow is " + roundTo(state.coolingAirflowCfm, 0) + " CFM while recirculation is " + roundTo(state.recirculationAirflowCfm, 0) + " CFM, so class air-change duty is clearly larger than coil airflow."
      : "Cooling airflow is " + roundTo(state.coolingAirflowCfm, 0) + " CFM, recirculation is " + roundTo(state.recirculationAirflowCfm, 0) + " CFM, and ventilation / make-up is " + roundTo(state.ventilationAirflowCfm, 0) + " CFM.";
    const loadNarrative = "Cooling coil duty is about " + roundTo(state.trCoolingCoil, 2) + " TR against a room design requirement of " + roundTo(state.trFinal, 2) + " TR.";
    const fanNarrative = "Fan design is distributed as " + roundTo(state.coolingFanKW, 2) + " kW cooling, " + roundTo(state.recirculationFanKW, 2) + " kW recirculation, and " + roundTo(state.ventilationFanKW, 2) + " kW ventilation.";
    const pressureNarrative = "Total ESP is about " + roundTo(state.totalEspPa, 0) + " Pa, with roughly " + roundTo(state.ductFrictionPa + state.fittingLossPa, 0) + " Pa from ducts/fittings and " + roundTo(state.equipmentLossPa, 0) + " Pa from coils, filters, and airside hardware.";
    const complianceNarrative = state.achRequired > 0
      ? "Compliance airflow is running at " + roundTo(state.achActual, 1) + " ACH against a requirement of " + roundTo(state.achRequired, 1) + " ACH."
      : "No explicit ACH requirement is active in the current state.";

    return {
      overview: architecture + ". " + airflowNarrative + " " + fanNarrative,
      systemSummary: {
        architecture: architecture,
        airflow: airflowNarrative,
        loadToCoil: loadNarrative,
        fanEnergy: fanNarrative,
        staticPressure: pressureNarrative,
        compliance: complianceNarrative
      }
    };
  }

  function addCause(list, payload) {
    const cause = payload || {};
    if (!cause.label || (cause.score || 0) <= 0.05) {
      return;
    }
    list.push({
      key: cause.key || cause.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label: cause.label,
      score: roundTo(clamp(cause.score, 0, 1), 2),
      explanation: cause.explanation || "",
      evidence: uniqueStrings(cause.evidence || []),
      category: cause.category || "system"
    });
  }

  function buildCauseRegistry(state) {
    const causes = [];
    const pressureBurdenScore = clamp(
      0.45 * scaleRelative(state.totalEspPa, state.cleanroomMode ? 950 : 800, 1)
      + 0.35 * safeDiv(state.ductFrictionPa + state.fittingLossPa, Math.max(state.totalEspPa, 1), 0)
      + 0.20 * safeDiv(state.equipmentLossPa, Math.max(state.totalEspPa, 1), 0),
      0,
      1
    );
    const recirculationExcessCfm = Math.max(state.recirculationAirflowCfm - state.coolingAirflowCfm, 0);
    const recirculationDominanceScore = recirculationExcessCfm > Math.max(state.coolingAirflowCfm * 0.1, 50)
      ? clamp(
        0.7 * scaleRelative(recirculationExcessCfm, Math.max(state.coolingAirflowCfm, 1), 1.2)
        + 0.3 * state.fanShares.recirculation,
        0,
        1
      )
      : 0;
    const ventilationParallelScore = state.ventilationAirflowCfm > Math.max(state.coolingAirflowCfm * 0.15, 100)
      ? clamp(
        0.65 * scaleRelative(state.ventilationAirflowCfm, Math.max(state.coolingAirflowCfm, 1), 0.75)
        + 0.35 * clamp(state.ventilationFraction / 0.35, 0, 1),
        0,
        1
      )
      : 0;
    const processAirScore = clamp(
      0.7 * scaleRelative(state.processAirflowCfm, Math.max(state.recirculationAirflowCfm, 1), 0.8)
      + 0.3 * clamp(state.processRatio / 0.75, 0, 1),
      0,
      1
    );
    const latentConditioningScore = clamp(
      0.45 * clamp(state.latentLoadRatio / 0.32, 0, 1)
      + 0.25 * clamp(state.ventilationFraction / 0.30, 0, 1)
      + 0.15 * clamp(((state.cleanroomMode ? 11 : 10.5) - state.supplyTempC) / 4, 0, 1)
      + 0.15 * clamp(state.bypassFactor / 0.18, 0, 1),
      0,
      1
    );
    const zoningComplexityScore = clamp(
      0.45 * clamp((state.zoneCount - 1) / (state.cleanroomMode ? 5 : 4), 0, 1)
      + 0.35 * (state.zoneDuctPlan.overallStatus === "REJECT" ? 1 : state.zoneDuctPlan.overallStatus === "WARNING" ? 0.65 : 0)
      + 0.20 * (state.designConstraints.status === "REJECTED" ? 1 : state.designConstraints.status === "REVIEW" ? 0.6 : 0),
      0,
      1
    );
    const validationRiskScore = clamp(
      0.55 * clamp(((state.validation.criticalCount || 0) * 1.0 + (state.validation.warningCount || 0) * 0.45 + (state.validation.advisoryCount || 0) * 0.15) / 3, 0, 1)
      + 0.45 * (state.validation.status === "NON_COMPLIANT" ? 1 : state.validation.status === "REVIEW" ? 0.55 : 0.15),
      0,
      1
    );
    const complianceBurdenScore = clamp(
      state.achRequired > 0
        ? 0.65 * clamp((0.12 - state.airflowMarginRatio) / 0.12, 0, 1)
          + 0.35 * (state.cleanroomMode ? clamp((state.recirculationToCoolingRatio - 1) / 1.5, 0, 1) : clamp(state.ventilationToCoolingRatio / 1.0, 0, 1))
        : 0,
      0,
      1
    );
    const filtrationHardwareScore = clamp(
      0.6 * safeDiv(state.equipmentLossPa, Math.max(state.totalEspPa, 1), 0)
      + 0.4 * (state.cleanroomMode ? 0.55 : 0.2),
      0,
      1
    );

    addCause(causes, {
      key: "recirculation_dominance",
      label: state.cleanroomMode
        ? "Cleanroom recirculation duty is much larger than the cooling-airflow stream"
        : "Room recirculation is materially larger than the cooling-airflow stream",
      score: recirculationDominanceScore,
      category: "airflow",
      explanation: "The system is being shaped by room-air-change demand rather than by the active coil path alone.",
      evidence: [
        "Cooling airflow " + roundTo(state.coolingAirflowCfm, 0) + " CFM",
        "Recirculation airflow " + roundTo(state.recirculationAirflowCfm, 0) + " CFM",
        "Recirculation/cooling ratio " + roundTo(state.recirculationToCoolingRatio, 2) + "x"
      ]
    });
    addCause(causes, {
      key: "ventilation_parallel_stream",
      label: "Ventilation / make-up air is a significant parallel stream",
      score: ventilationParallelScore,
      category: "ventilation",
      explanation: "Outdoor-air obligations are large enough to affect architecture, humidity control, and reporting clarity.",
      evidence: [
        "Ventilation airflow " + roundTo(state.ventilationAirflowCfm, 0) + " CFM",
        "Outdoor-air fraction " + roundTo(state.ventilationFraction * 100, 1) + "%",
        "Required outdoor air " + roundTo(state.requiredOutdoorAirCfm, 0) + " CFM"
      ]
    });
    addCause(causes, {
      key: "process_air_burden",
      label: "Process / exhaust replacement airflow is behaving like a separate system",
      score: processAirScore,
      category: "process_air",
      explanation: "Process make-up air is too large to be treated as a small add-on to the comfort or cleanroom recirculation circuit.",
      evidence: [
        "Process airflow " + roundTo(state.processAirflowCfm, 0) + " CFM",
        "Process/recirculation ratio " + roundTo(state.processRatio, 2) + "x"
      ]
    });
    addCause(causes, {
      key: "static_pressure_burden",
      label: "Static pressure burden is driving fan energy and controllability",
      score: pressureBurdenScore,
      category: "pressure",
      explanation: "ESP is high enough that fan power and balancing effort are being driven by the air path, not just by the cooling duty.",
      evidence: [
        "Total ESP " + roundTo(state.totalEspPa, 0) + " Pa",
        "Duct + fitting share " + roundTo(safeDiv(state.ductFrictionPa + state.fittingLossPa, Math.max(state.totalEspPa, 1), 0) * 100, 0) + "%",
        "Equipment share " + roundTo(safeDiv(state.equipmentLossPa, Math.max(state.totalEspPa, 1), 0) * 100, 0) + "%"
      ]
    });
    addCause(causes, {
      key: "filtration_hardware_burden",
      label: state.cleanroomMode
        ? "Filtration and airside hardware are contributing heavily to the pressure stack"
        : "Airside hardware losses are a meaningful share of the pressure stack",
      score: filtrationHardwareScore,
      category: "pressure",
      explanation: "Filter banks, coil sections, and terminals are taking a meaningful share of the available static pressure.",
      evidence: [
        "Equipment pressure allowance " + roundTo(state.equipmentLossPa, 0) + " Pa",
        state.cleanroomMode ? "Cleanroom filtration path is active" : "Mixed comfort / process airside hardware path"
      ]
    });
    addCause(causes, {
      key: "latent_conditioning_burden",
      label: "Latent and outdoor-air conditioning are pushing the coil process harder",
      score: latentConditioningScore,
      category: "psychrometrics",
      explanation: "Supply conditions and coil process are being influenced by latent load, outdoor air, and bypass-factor sensitivity together.",
      evidence: [
        "Latent load ratio " + roundTo(state.latentLoadRatio * 100, 1) + "%",
        "Supply temperature " + roundTo(state.supplyTempC, 1) + " C",
        "Bypass factor " + roundTo(state.bypassFactor, 3)
      ]
    });
    addCause(causes, {
      key: "zoning_distribution_complexity",
      label: "Distribution complexity is amplifying pressure and control effort",
      score: zoningComplexityScore,
      category: "distribution",
      explanation: "Zone count, duct practicality, and installation constraints are adding distribution risk on top of the pure load problem.",
      evidence: [
        "Zone count " + roundTo(state.zoneCount, 0),
        "Zone duct status " + (state.zoneDuctPlan.overallStatus || "OK"),
        "Constraint status " + (state.designConstraints.status || "APPROVED")
      ]
    });
    addCause(causes, {
      key: "validation_risk",
      label: "Existing validation findings indicate unresolved engineering risk",
      score: validationRiskScore,
      category: "validation",
      explanation: "The current state still has validation findings that should be folded into the architectural diagnosis, not treated as isolated warnings.",
      evidence: [
        "Validation status " + (state.validation.status || "COMPLIANT"),
        "Critical " + roundTo(state.validation.criticalCount || 0, 0),
        "Warning " + roundTo(state.validation.warningCount || 0, 0)
      ]
    });
    addCause(causes, {
      key: "compliance_airflow_burden",
      label: state.cleanroomMode
        ? "Cleanroom compliance margin is being carried mainly by recirculation volume"
        : "Ventilation / air-change compliance depends on delivered conditioned airflow",
      score: complianceBurdenScore,
      category: "compliance",
      explanation: "Compliance is being maintained, or threatened, by the airflow architecture itself rather than by spare load margin alone.",
      evidence: [
        "Required ACH " + roundTo(state.achRequired, 1),
        "Actual ACH " + roundTo(state.achActual, 1),
        "Airflow margin " + roundTo(state.airflowMarginRatio * 100, 1) + "%"
      ]
    });
    addCause(causes, {
      key: "recirculation_fan_energy_concentration",
      label: "Fan energy is concentrated on the recirculation path",
      score: clamp(
        0.55 * state.fanShares.recirculation
        + 0.45 * scaleRelative(state.recirculationFanKW, Math.max(state.coolingFanKW + state.ventilationFanKW, 0.25), 2.0),
        0,
        1
      ),
      category: "energy",
      explanation: "Recirculation fan duty is carrying a large share of the total airside energy.",
      evidence: [
        "Recirculation fan " + roundTo(state.recirculationFanKW, 2) + " kW",
        "Cooling fan " + roundTo(state.coolingFanKW, 2) + " kW",
        "Ventilation fan " + roundTo(state.ventilationFanKW, 2) + " kW"
      ]
    });

    causes.sort(function (left, right) {
      return right.score - left.score;
    });

    return causes;
  }

  function buildIssueDiagnostics(state, interpretation) {
    const causeRegistry = buildCauseRegistry(state);
    const causeMap = {};
    const narrativeLexicon = {
      systemDriver: [
        "The system is being governed by",
        "The system is being driven by",
        "The current architecture is being shaped by"
      ],
      distortion: [
        "That can blur coil duty, psychrometric interpretation, and CFM/TR reporting.",
        "That can distort coil sizing, supply-state interpretation, and CFM/TR reporting.",
        "That can collapse separate airflow roles into a misleading single number."
      ],
      compliance: [
        state.cleanroomMode ? "Cleanroom compliance stability" : "ACH compliance stability",
        state.cleanroomMode ? "Classification reliability" : "Delivered airflow compliance",
        "Ventilation / air-change compliance"
      ],
      dependsOn: [
        "is governed by",
        "is driven by",
        "is strongly influenced by"
      ],
      pressure: [
        "Pressure burden is absorbing a large share of the airside energy.",
        "Static pressure is taking over the fan-energy picture.",
        "ESP is now a primary energy driver rather than a background detail."
      ],
      coilStress: [
        "The cooling path is being stretched by combined latent and outdoor-air demands.",
        "The coil process is being pushed by latent duty together with outdoor or process air.",
        "The psychrometric path is being stressed by more than sensible cooling alone."
      ]
    };
    causeRegistry.forEach(function (cause) {
      causeMap[cause.key] = cause;
    });

    function issueScore(keys) {
      const selected = keys.map(function (key) { return causeMap[key]; }).filter(Boolean);
      if (!selected.length) {
        return 0;
      }
      return clamp(selected.reduce(function (sum, cause, index) {
        return sum + cause.score * (index === 0 ? 0.38 : index === 1 ? 0.27 : 0.17);
      }, 0), 0, 1);
    }

    function buildIssue(payload) {
      const selectedCauses = (payload.causeKeys || []).map(function (key) {
        return causeMap[key];
      }).filter(Boolean).sort(function (left, right) {
        return right.score - left.score;
      }).slice(0, 4);
      const score = payload.score != null ? payload.score : issueScore(payload.causeKeys || []);
      if (!selectedCauses.length || score <= 0.18) {
        return null;
      }
      const problem = payload.problemBuilder
        ? payload.problemBuilder(selectedCauses)
        : payload.problem;
      const impact = payload.impactBuilder
        ? payload.impactBuilder(selectedCauses)
        : payload.impact;
      const primaryResponse = payload.responseBuilder
        ? payload.responseBuilder(selectedCauses)
        : (payload.primaryResponse || "");
      return {
        key: payload.key,
        category: payload.category,
        severity: describeSeverity(score, state.validation.status),
        score: roundTo(score, 2),
        problem: problem,
        impact: impact,
        rootCauses: selectedCauses.map(function (cause, index) {
          return {
            rank: index + 1,
            key: cause.key,
            label: cause.label,
            score: cause.score,
            explanation: cause.explanation,
            evidence: cause.evidence
          };
        }),
        evidence: uniqueStrings(selectedCauses.reduce(function (list, cause) {
          return list.concat(cause.evidence || []);
        }, [])),
        primaryResponse: primaryResponse,
        summary: buildNarrative([problem, impact])
      };
    }

    const diagnostics = [];
    const airflowArchitectureIssue = buildIssue({
      key: "airflow_architecture",
      category: "airflow_architecture",
      causeKeys: ["recirculation_dominance", "ventilation_parallel_stream", "process_air_burden", "compliance_airflow_burden", "validation_risk"],
      problemBuilder: function () {
        return buildNarrative([
          chooseVariant(narrativeLexicon.systemDriver, "airflow-architecture-" + state.cleanroomMode),
          state.cleanroomMode
            ? "cleanliness duty, with " + metricPhrase("recirculation", state.recirculationAirflowCfm, " CFM", 0) + " versus " + metricPhrase("cooling airflow", state.coolingAirflowCfm, " CFM", 0) + "."
            : "parallel airflow roles, with " + metricPhrase("cooling airflow", state.coolingAirflowCfm, " CFM", 0) + ", " + metricPhrase("recirculation", state.recirculationAirflowCfm, " CFM", 0) + ", and " + metricPhrase("ventilation", state.ventilationAirflowCfm, " CFM", 0) + "."
        ]);
      },
      impactBuilder: function () {
        return buildNarrative([
          chooseVariant(narrativeLexicon.distortion, "airflow-impact-" + state.ventilationAirflowCfm),
          state.cleanroomMode
            ? "If the " + roundTo(state.recirculationToCoolingRatio, 2) + "x recirculation/cooling split is hidden, the cleanroom air-change stream can be misread as coil duty."
            : "If the non-cooling streams are merged back in, the " + roundTo(state.ventilationToCoolingRatio, 2) + "x ventilation/cooling split starts to blur the real coil path."
        ]);
      },
      responseBuilder: function () {
        return state.cleanroomMode
          ? "Keep MAU / make-up duty separate from recirculation duty and let the cooling-airflow path stay tied to the coil."
          : "Decouple ventilation or process air where possible so the cooling-airflow path remains thermally and psychrometrically correct.";
      }
    });
    const fanPressureIssue = buildIssue({
      key: "fan_pressure",
      category: "energy",
      causeKeys: ["static_pressure_burden", "recirculation_fan_energy_concentration", "filtration_hardware_burden", "zoning_distribution_complexity"],
      problemBuilder: function () {
        return buildNarrative([
          chooseVariant(narrativeLexicon.pressure, "fan-pressure-" + state.totalEspPa),
          metricPhrase("Total ESP", state.totalEspPa, " Pa", 0) + ", " + metricPhrase("fan power", state.fanKWTotal, " kW", 2) + "."
        ]);
      },
      impactBuilder: function () {
        return buildNarrative([
          "This narrows fan-curve margin and raises balancing effort.",
          state.cleanroomMode
            ? "Recirculation fans are carrying " + roundTo(state.fanShares.recirculation * 100, 0) + "% of total fan kW, so the pressure stack is concentrating operating cost on the cleanroom path."
            : "With " + roundTo(state.zoneCount, 0) + " zone(s) and " + roundTo(state.totalEspPa, 0) + " Pa of ESP, the distribution path is harder to turn down cleanly."
        ]);
      },
      responseBuilder: function () {
        return state.cleanroomMode
          ? "Reduce recirculation static with lower-pressure distribution, cleaner return paths, or FFU / fan-array strategies where appropriate."
          : "Lower total ESP with cleaner duct routing, lower velocities, or split AHU arrangements instead of adding fan power to the same path.";
      }
    });
    const coilConditioningIssue = buildIssue({
      key: "coil_conditioning",
      category: "psychrometrics",
      causeKeys: ["latent_conditioning_burden", "ventilation_parallel_stream", "process_air_burden", "validation_risk"],
      problemBuilder: function () {
        return buildNarrative([
          chooseVariant(narrativeLexicon.coilStress, "coil-conditioning-" + state.latentLoadRatio),
          "Current state: latent ratio " + roundTo(state.latentLoadRatio * 100, 1) + "%, supply air " + roundTo(state.supplyTempC, 1) + " C, outdoor air " + roundTo(state.outdoorAirCfm, 0) + " CFM."
        ]);
      },
      impactBuilder: function () {
        return buildNarrative([
          "That tends to push the design toward colder supply air, deeper coils, or unstable mixed-air behavior.",
          state.processAirflowCfm > 0
            ? "Process air is contributing " + roundTo(state.processAirflowCfm, 0) + " CFM, so the coil is responding to more than room sensible duty."
            : "Outdoor-air influence remains high enough to affect the coil process even though the cooling path should stay explicit."
        ]);
      },
      responseBuilder: function () {
        return state.cleanroomMode
          ? "Use the make-up-air path for dew-point and pressurization control, and let recirculation handle most of the class airflow."
          : "Evaluate DOAS or another decoupled latent-control strategy before pushing the primary coil to colder and colder supply conditions.";
      }
    });
    const complianceIssue = buildIssue({
      key: "compliance_resilience",
      category: "compliance",
      causeKeys: ["compliance_airflow_burden", "validation_risk", "recirculation_dominance"],
      problemBuilder: function () {
        return buildNarrative([
          chooseVariant(narrativeLexicon.compliance, "compliance-noun-" + state.cleanroomMode)
            + " " + chooseVariant(narrativeLexicon.dependsOn, "compliance-verb-" + state.achActual)
            + " " + (state.cleanroomMode ? "how the recirculation strategy is maintained." : "keeping the airflow roles explicit."),
          "The current margin is " + roundTo((state.achActual - state.achRequired), 1) + " ACH with required " + roundTo(state.achRequired, 1) + " and actual " + roundTo(state.achActual, 1) + "."
        ]);
      },
      impactBuilder: function () {
        return buildNarrative([
          state.cleanroomMode
            ? "Small shifts in recirculation architecture, filter loading, or pressure tuning could change how defensible the cleanroom basis looks."
            : "If airflow roles get merged again, compliance can appear better or worse than the physical system actually is.",
          state.cleanroomMode
            ? "The compliance basis is riding on a " + roundTo(state.recirculationToCoolingRatio, 2) + "x recirculation/cooling ratio."
            : "The compliance basis still depends on keeping " + roundTo(state.totalRoomAirflowCfm, 0) + " CFM total room airflow distinct from the " + roundTo(state.coolingAirflowCfm, 0) + " CFM coil stream."
        ]);
      },
      responseBuilder: function () {
        return "Keep compliance checks tied to the correct airflow role and maintain enough margin that future tuning does not erase the design basis.";
      }
    });

    [airflowArchitectureIssue, fanPressureIssue, coilConditioningIssue, complianceIssue].forEach(function (issue) {
      if (issue) {
        diagnostics.push(issue);
      }
    });

    diagnostics.sort(function (left, right) {
      if (validationSeverityRank(left.severity) !== validationSeverityRank(right.severity)) {
        return validationSeverityRank(right.severity) - validationSeverityRank(left.severity);
      }
      return right.score - left.score;
    });

    if (!diagnostics.length) {
      diagnostics.push({
        key: "stable_design",
        category: "design",
        severity: "advisory",
        score: 0.2,
        problem: "The current design state is broadly self-consistent.",
        impact: interpretation.systemSummary.compliance,
        rootCauses: [],
        evidence: ["Validation status " + (state.validation.status || "COMPLIANT")],
        primaryResponse: "Use the current architecture as the baseline and optimize commissioning, turndown, and maintainability details."
      });
    }

    return diagnostics.slice(0, 4);
  }

  function addRecommendation(list, payload) {
    const recommendation = payload || {};
    if (!recommendation.title) {
      return;
    }
    list.push({
      key: recommendation.key || recommendation.title.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      title: recommendation.title,
      category: recommendation.category || "design",
      priorityScore: roundTo(clamp(recommendation.priorityScore || 0.35, 0, 1), 2),
      whyItWorks: recommendation.whyItWorks || "",
      improves: uniqueStrings(recommendation.improves || []),
      tradeoffs: uniqueStrings(recommendation.tradeoffs || []),
      actions: uniqueStrings(recommendation.actions || []),
      useCase: recommendation.useCase || "",
      linkedIssueKey: recommendation.linkedIssueKey || ""
    });
  }

  function buildRecommendationPlan(state, diagnostics) {
    const recommendations = [];
    const issueMap = {};
    diagnostics.forEach(function (issue) {
      issueMap[issue.key] = issue;
    });

    if (issueMap.airflow_architecture) {
      addRecommendation(recommendations, {
        key: "separate_airflow_roles",
        category: "architecture",
        linkedIssueKey: "airflow_architecture",
        priorityScore: issueMap.airflow_architecture.score,
        title: state.cleanroomMode
          ? "Hold the cleanroom architecture as MAU + recirculation separation"
          : "Separate cooling airflow from ventilation / process airflow explicitly",
        whyItWorks: state.cleanroomMode
          ? "It keeps cleanroom recirculation tied to ACH and cleanliness while keeping coil airflow tied to the thermal and psychrometric process."
          : "It preserves a cooling-airflow path that represents coil duty, while ventilation or process air stays on its own architectural role.",
        improves: [
          "Cooling-airflow reporting clarity",
          "Psychrometric stability",
          "CFM/TR correctness",
          state.cleanroomMode ? "Cleanroom architecture defensibility" : "Outdoor-air control clarity"
        ],
        tradeoffs: [
          "Adds hardware and controls scope",
          "Needs clearer commissioning sequences between air paths"
        ],
        actions: state.cleanroomMode
          ? [
              "Keep make-up air sized for pressurization, occupancy, and exhaust replacement only",
              "Let recirculation air carry class airflow and room-air motion",
              "Do not let cleanroom recirculation be reported as coil airflow"
            ]
          : [
              "Use DOAS / MAU or another dedicated ventilation path when outdoor or process air is significant",
              "Keep coil sizing and psychrometrics on cooling airflow only",
              "Report recirculation and ventilation as separate airside systems"
            ],
        useCase: state.cleanroomMode
          ? "Best when cleanroom ACH is materially larger than cooling-airflow demand."
          : "Best when ventilation, process air, or compliance airflow is materially larger than the thermal airflow."
      });
    }

    if (issueMap.fan_pressure) {
      addRecommendation(recommendations, {
        key: "lower_static_architecture",
        category: "energy",
        linkedIssueKey: "fan_pressure",
        priorityScore: issueMap.fan_pressure.score,
        title: state.cleanroomMode
          ? "Reduce recirculation static with low-pressure cleanroom distribution"
          : "Lower static pressure before adding more fan power",
        whyItWorks: "Reducing the pressure stack attacks the real airside power driver directly instead of treating fan energy as a fixed consequence of airflow.",
        improves: [
          "Fan energy",
          "Fan operating margin",
          "Part-load controllability",
          "Balancing robustness"
        ],
        tradeoffs: [
          "Often increases duct or terminal coordination effort",
          "May require more air sections, fan arrays, or alternate terminal layouts"
        ],
        actions: state.cleanroomMode
          ? [
              "Review FFU or EC fan-array concepts where maintenance access allows",
              "Shorten recirculation paths and reduce filter / terminal pressure penalties",
              "Keep return paths open and symmetrical so recirculation fans do not fight avoidable pressure loss"
            ]
          : [
              "Reduce duct velocity and high-K fittings on the critical path",
              "Split the air path if one AHU is carrying too much pressure burden",
              "Use lower-static terminal strategies before selecting a stronger fan on the same path"
            ],
        useCase: "Best when recirculation fan kW and ESP are rising faster than the cooling load."
      });
    }

    if (issueMap.coil_conditioning) {
      addRecommendation(recommendations, {
        key: "decouple_latent_control",
        category: "psychrometrics",
        linkedIssueKey: "coil_conditioning",
        priorityScore: issueMap.coil_conditioning.score,
        title: state.cleanroomMode
          ? "Use the make-up-air path to manage dew point and pressurization"
          : "Use a dedicated latent / outdoor-air control strategy",
        whyItWorks: "It prevents the main cooling-airflow path from being over-driven by latent and mixed-air requirements that are better handled upstream or on a dedicated path.",
        improves: [
          "Supply-temperature stability",
          "Coil process realism",
          "Humidity-control robustness",
          "System controllability"
        ],
        tradeoffs: [
          "Adds control logic and possible reheat or deeper-coil scope",
          "Needs clearer sequence-of-operation definition"
        ],
        actions: state.cleanroomMode
          ? [
              "Control the MAU on dew point and pressurization rather than on total room airflow",
              "Keep the recirculation path focused on class airflow and sensible room response"
            ]
          : [
              "Evaluate DOAS, lower face velocity, or deeper-coil solutions before forcing colder supply air",
              "Keep latent and outdoor-air treatment explicit in the design narrative"
            ],
        useCase: "Best when latent load, outdoor air, or process air keeps pushing the coil toward colder supply conditions."
      });
    }

    if (issueMap.compliance_resilience) {
      addRecommendation(recommendations, {
        key: "protect_compliance_margin",
        category: "compliance",
        linkedIssueKey: "compliance_resilience",
        priorityScore: issueMap.compliance_resilience.score,
        title: state.cleanroomMode
          ? "Protect cleanroom compliance margin with explicit recirculation and pressure logic"
          : "Protect compliance margin with explicit airflow-role accounting",
        whyItWorks: "It keeps the compliance basis tied to the right airflow stream instead of relying on accidental excess airflow or ambiguous totals.",
        improves: [
          "Compliance transparency",
          "TAB defensibility",
          "Future tuning margin"
        ],
        tradeoffs: [
          "Requires clearer reporting and commissioning checks",
          "May keep some apparent reserve out of the cooling-airflow headline number"
        ],
        actions: [
          "Track the compliance basis on the correct airflow stream in reports and QA checks",
          "Keep enough margin that filter loading and balancing do not erase the design basis",
          "Tie final qualification to the same airflow hierarchy used in design"
        ],
        useCase: "Best when compliance is being carried by architecture and airflow discipline rather than by large spare equipment capacity."
      });
    }

    recommendations.sort(function (left, right) {
      return right.priorityScore - left.priorityScore;
    });

    return recommendations.slice(0, 4);
  }

  function estimateScenarioAch(state, airflowPlan) {
    const basisAirflow = state.cleanroomMode
      ? Math.max(airflowPlan.recirculationAirflowCfm, 0)
      : Math.max(airflowPlan.totalRoomAirflowCfm, 0);
    if (state.volumeM3 > 0) {
      return basisAirflow * CFM_TO_M3S * 3600 / state.volumeM3;
    }
    return state.achActual * safeDiv(basisAirflow, Math.max(state.airflowComplianceBasisCfm, 1), 1);
  }

  function buildScenarioTemplates(state) {
    const complianceFactor = state.achRequired > 0 && state.achActual > 0
      ? clamp(state.achRequired / state.achActual, 0.85, 1.10)
      : 1;
    if (state.cleanroomMode) {
      return [
        {
          key: "cost_effective",
          intent: "cost_effective",
          title: "Cost-effective cleanroom baseline",
          systemType: "MAU + recirculation AHU with terminal HEPA filtration",
          scope: (state.cleanroomClass || "Cleanroom") + " basis near the lowest defensible airflow edge",
          capexDeltaPercent: -6,
          pressureFactor: 0.94,
          fanFactor: 0.97,
          robustnessBias: -6,
          complianceBias: 4,
          complexityBias: -8,
          why: "It preserves the cleanroom architecture but avoids buying more recirculation hardware than the current compliance basis appears to need.",
          whenToUse: "Best when capital cost matters and the process is not expected to add future contamination or heat burden quickly.",
          strengths: [
            "Lowest first-cost cleanroom route",
            "Keeps make-up air separate from class recirculation",
            "Simpler controls than the efficiency-first concept"
          ],
          tradeoffs: [
            "Smaller compliance cushion if the room changes later",
            "Less room for future filter-loading or process growth"
          ],
          actions: [
            "Hold outdoor air close to validated make-up needs",
            "Keep recirculation dominant for class airflow"
          ],
          airflowPlan: function () {
            const recirculation = Math.max(state.recirculationAirflowCfm * Math.max(0.95, complianceFactor), state.coolingAirflowCfm);
            return {
              coolingAirflowCfm: state.coolingAirflowCfm,
              recirculationAirflowCfm: recirculation,
              ventilationAirflowCfm: Math.max(state.ventilationAirflowCfm, state.requiredOutdoorAirCfm),
              totalRoomAirflowCfm: recirculation + Math.max(state.ventilationAirflowCfm, state.requiredOutdoorAirCfm)
            };
          }
        },
        {
          key: "balanced",
          intent: "balanced",
          title: "Balanced compliance-first cleanroom scheme",
          systemType: "Dedicated MAU + recirculation AHU / cleanroom distribution field",
          scope: (state.cleanroomClass || "Cleanroom") + " architecture with explicit make-up and recirculation roles",
          capexDeltaPercent: 0,
          pressureFactor: 0.88,
          fanFactor: 0.90,
          robustnessBias: 10,
          complianceBias: 12,
          complexityBias: 2,
          why: "It keeps the architecture closest to how cleanrooms are commissioned and defended in qualification.",
          whenToUse: "Best default when compliance confidence and engineering clarity matter most.",
          strengths: [
            "Strong compliance defensibility",
            "Clear airflow-role separation",
            "Good balance of capital cost and robustness"
          ],
          tradeoffs: [
            "Not the absolute lowest first-cost option",
            "Still needs careful filter and pressure coordination"
          ],
          actions: [
            "Carry pressure sensors and filter DP monitoring into the basis",
            "Keep coil airflow, make-up air, and recirculation roles explicit"
          ],
          airflowPlan: function () {
            const recirculation = Math.max(state.recirculationAirflowCfm, state.coolingAirflowCfm * 1.05, state.airflowComplianceBasisCfm);
            return {
              coolingAirflowCfm: Math.max(state.coolingAirflowCfm, state.coolingAirflowCfm * (state.latentLoadRatio > 0.28 ? 1.03 : 1.00)),
              recirculationAirflowCfm: recirculation,
              ventilationAirflowCfm: Math.max(state.ventilationAirflowCfm, state.requiredOutdoorAirCfm),
              totalRoomAirflowCfm: recirculation + Math.max(state.ventilationAirflowCfm, state.requiredOutdoorAirCfm)
            };
          }
        },
        {
          key: "efficient",
          intent: "efficient",
          title: "Efficiency-first low-static cleanroom scheme",
          systemType: state.cleanroom && state.cleanroom.classNumber <= 6
            ? "MAU + EC-fan FFU / low-static recirculation field"
            : "MAU + low-static recirculation AHU with fan-array turndown",
          scope: (state.cleanroomClass || "Cleanroom") + " architecture optimized for lower recirculation pressure drop",
          capexDeltaPercent: 9,
          pressureFactor: 0.74,
          fanFactor: 0.79,
          robustnessBias: 7,
          complianceBias: 9,
          complexityBias: 10,
          why: "It attacks the biggest controllable operating-cost driver in cleanrooms: recirculation fan pressure.",
          whenToUse: "Best when the cleanroom runs long hours and the owner can support better controls and maintenance discipline.",
          strengths: [
            "Best operating-cost profile",
            "Lower recirculation pressure burden",
            "Supports occupied / at-rest control strategies"
          ],
          tradeoffs: [
            "Higher controls and commissioning burden",
            "Needs disciplined filter maintenance to protect the energy case"
          ],
          actions: [
            "Validate recovery time before aggressive turndown is accepted",
            "Reduce filter and distribution static before locking fan size"
          ],
          airflowPlan: function () {
            const recirculation = Math.max(state.recirculationAirflowCfm, state.airflowComplianceBasisCfm);
            return {
              coolingAirflowCfm: Math.max(state.coolingAirflowCfm, state.coolingAirflowCfm * (state.latentLoadRatio > 0.30 ? 1.02 : 1.00)),
              recirculationAirflowCfm: recirculation,
              ventilationAirflowCfm: Math.max(state.ventilationAirflowCfm, state.requiredOutdoorAirCfm),
              totalRoomAirflowCfm: recirculation + Math.max(state.ventilationAirflowCfm, state.requiredOutdoorAirCfm)
            };
          }
        }
      ];
    }

    return [
      {
        key: "cost_effective",
        intent: "cost_effective",
        title: "Cost-effective baseline",
        systemType: state.areaM2 < 100 && state.trFinal < 5 && state.zoneCount <= 1
          ? "Single-zone packaged DX / mixed-air AHU"
          : "Zoned comfort AHU / packaged DX system",
        scope: "Simplify the airside arrangement while holding only the airflow needed for compliance and room control",
        capexDeltaPercent: -8,
        pressureFactor: 0.96,
        fanFactor: 0.98,
        robustnessBias: -5,
        complianceBias: 0,
        complexityBias: -10,
        why: "It trims airside scope where the room does not appear to justify more architectural separation.",
        whenToUse: "Best when budget is primary and outdoor-air or latent demands are not dominant.",
        strengths: [
          "Lowest first cost",
          "Simple controls and maintenance",
          "Fastest path to a basic comfort solution"
        ],
        tradeoffs: [
          "Least resilient if ventilation or latent demands grow later",
          "Offers the smallest energy upside"
        ],
        actions: [
          "Do not let airflow drop below the validated compliance basis",
          "Keep duct losses contained so simplicity does not become fan penalty"
        ],
        airflowPlan: function () {
          const recirculation = Math.max(state.coolingAirflowCfm, state.recirculationAirflowCfm * Math.max(0.94, complianceFactor));
          const ventilation = Math.max(state.requiredOutdoorAirCfm, state.ventilationAirflowCfm * 0.95);
          return {
            coolingAirflowCfm: Math.max(state.coolingAirflowCfm, state.coolingAirflowCfm * (state.latentLoadRatio > 0.30 ? 1.02 : 1.00)),
            recirculationAirflowCfm: recirculation,
            ventilationAirflowCfm: ventilation,
            totalRoomAirflowCfm: recirculation + ventilation
          };
        }
      },
      {
        key: "balanced",
        intent: "balanced",
        title: "Balanced decoupled comfort architecture",
        systemType: state.ventilationFraction > 0.18 || state.latentLoadRatio > 0.28 || state.processRatio > 0.25
          ? "DOAS + sensible recirculation AHU"
          : (state.currentSystemType || "Zoned AHU comfort system"),
        scope: "Keep coil airflow tied to the cooling process and hold ventilation as an explicit parallel role",
        capexDeltaPercent: 2,
        pressureFactor: 0.89,
        fanFactor: 0.90,
        robustnessBias: 10,
        complianceBias: 10,
        complexityBias: 2,
        why: "It usually gives the cleanest compromise between architecture clarity, controllability, and implementation effort.",
        whenToUse: "Best default when the room is neither extremely budget-led nor purely energy-led.",
        strengths: [
          "Strong reporting and psychrometric clarity",
          "Better humidity and ventilation control",
          "Good balance of cost and robustness"
        ],
        tradeoffs: [
          "More hardware than the minimum baseline",
          "Needs clearer control sequencing between air paths"
        ],
        actions: [
          "Keep the outdoor-air path explicit when ventilation matters",
          "Size and report the cooling path on cooling airflow only"
        ],
        airflowPlan: function () {
          const cooling = Math.max(state.coolingAirflowCfm, state.coolingAirflowCfm * (state.latentLoadRatio > 0.30 ? 1.04 : 1.00));
          const recirculation = Math.max(state.recirculationAirflowCfm, cooling);
          const ventilation = Math.max(state.requiredOutdoorAirCfm, state.ventilationAirflowCfm);
          return {
            coolingAirflowCfm: cooling,
            recirculationAirflowCfm: recirculation,
            ventilationAirflowCfm: ventilation,
            totalRoomAirflowCfm: recirculation + ventilation
          };
        }
      },
      {
        key: "efficient",
        intent: "efficient",
        title: "Efficiency-first low-static split system",
        systemType: state.processRatio > 0.25
          ? "DOAS + low-static recirculation + separate process air"
          : "Low-static split AHU / fan-array recirculation system",
        scope: "Reduce pressure burden and recirculation fan energy without giving up airflow-role separation",
        capexDeltaPercent: 8,
        pressureFactor: 0.76,
        fanFactor: 0.81,
        robustnessBias: 7,
        complianceBias: 8,
        complexityBias: 10,
        why: "It targets the strongest airside energy levers directly: pressure drop, fan-path concentration, and part-load control.",
        whenToUse: "Best when annual run hours are high or fan power is already dominating operating cost.",
        strengths: [
          "Best operating-cost profile",
          "Lower recirculation static",
          "Improved part-load controllability"
        ],
        tradeoffs: [
          "Higher capital cost",
          "Higher controls and commissioning effort"
        ],
        actions: [
          "Reduce high-K fittings and long recirculation paths",
          "Use separate process or ventilation handling where those roles are large"
        ],
        airflowPlan: function () {
          const cooling = Math.max(state.coolingAirflowCfm, state.coolingAirflowCfm * (state.latentLoadRatio > 0.32 ? 1.03 : 1.00));
          const recirculation = Math.max(state.recirculationAirflowCfm * Math.max(0.97, complianceFactor), cooling);
          const ventilation = Math.max(state.requiredOutdoorAirCfm, state.ventilationAirflowCfm);
          return {
            coolingAirflowCfm: cooling,
            recirculationAirflowCfm: recirculation,
            ventilationAirflowCfm: ventilation,
            totalRoomAirflowCfm: recirculation + ventilation
          };
        }
      }
    ];
  }

  function buildScenarioComparison(state, diagnostics) {
    const templates = buildScenarioTemplates(state);
    const issueScores = {};
    diagnostics.forEach(function (issue) {
      issueScores[issue.key] = issue.score;
    });

    return templates.map(function (template) {
      const airflowPlan = template.airflowPlan(state);
      const ach = estimateScenarioAch(state, airflowPlan);
      const complianceStatus = optionCompliance(ach, state.achRequired);
      const estimatedPressurePa = roundTo(state.totalEspPa * template.pressureFactor, 0);
      const airflowFactor = 0.60 * safeDiv(airflowPlan.recirculationAirflowCfm, Math.max(state.recirculationAirflowCfm, 1), 1)
        + 0.20 * safeDiv(airflowPlan.coolingAirflowCfm, Math.max(state.coolingAirflowCfm, 1), 1)
        + 0.20 * safeDiv(Math.max(airflowPlan.ventilationAirflowCfm, 1), Math.max(state.ventilationAirflowCfm || 1, 1), state.ventilationAirflowCfm > 0 ? 1 : 0.9);
      const estimatedFanKW = state.fanKWTotal > 0
        ? state.fanKWTotal * template.fanFactor * airflowFactor
        : 0;
      const energyDeltaPercent = roundTo((safeDiv(estimatedFanKW, Math.max(state.fanKWTotal, 0.0001), 1) - 1) * 100, 0);
      const staticDeltaPercent = roundTo((safeDiv(estimatedPressurePa, Math.max(state.totalEspPa, 1), 1) - 1) * 100, 0);
      const costScore = clamp(86 - template.capexDeltaPercent * 1.6, 45, 96);
      const efficiencyScore = clamp(
        82 - energyDeltaPercent * 1.2 + (template.key === "efficient" ? 6 : template.key === "balanced" ? 2 : 0),
        45,
        98
      );
      const robustnessScore = clamp(
        72 + template.robustnessBias
        + (issueScores.airflow_architecture || 0) * (template.key === "balanced" ? 10 : template.key === "efficient" ? 6 : -3)
        + (issueScores.fan_pressure || 0) * (template.key === "efficient" ? 10 : template.key === "balanced" ? 5 : -2)
        + (issueScores.coil_conditioning || 0) * (template.key !== "cost_effective" ? 6 : -4)
        - Math.max(template.complexityBias, 0) * 0.6,
        45,
        97
      );
      const complianceScore = clamp(
        76 + template.complianceBias
        + (complianceStatus === "COMPLIANT" ? 8 : -26)
        + (state.cleanroomMode && template.key === "balanced" ? 4 : 0),
        35,
        98
      );
      const decisionScore = roundTo(
        efficiencyScore * 0.30
        + costScore * 0.20
        + robustnessScore * 0.25
        + complianceScore * 0.25,
        1
      );

      return {
        key: template.key,
        title: template.title,
        intent: template.intent,
        systemType: template.systemType,
        scope: template.scope,
        airflowCfm: roundTo(airflowPlan.totalRoomAirflowCfm, 0),
        ach: roundTo(ach, 1),
        capexDeltaPercent: roundTo(template.capexDeltaPercent, 0),
        energyDeltaPercent: energyDeltaPercent,
        costScore: roundTo(costScore, 0),
        efficiencyScore: roundTo(efficiencyScore, 0),
        robustnessScore: roundTo(robustnessScore, 0),
        complianceScore: roundTo(complianceScore, 0),
        decisionScore: decisionScore,
        complianceStatus: complianceStatus,
        confidenceScore: roundTo(state.confidenceScore, 2),
        airflowBreakdown: {
          coolingAirflowCfm: roundTo(airflowPlan.coolingAirflowCfm, 0),
          recirculationAirflowCfm: roundTo(airflowPlan.recirculationAirflowCfm, 0),
          ventilationAirflowCfm: roundTo(airflowPlan.ventilationAirflowCfm, 0),
          totalRoomAirflowCfm: roundTo(airflowPlan.totalRoomAirflowCfm, 0)
        },
        estimatedImpacts: {
          fanEnergyDeltaPercent: energyDeltaPercent,
          staticPressureDeltaPercent: staticDeltaPercent,
          estimatedFanKW: roundTo(estimatedFanKW, 2),
          estimatedStaticPressurePa: estimatedPressurePa,
          engineeringRobustnessScore: roundTo(robustnessScore, 0)
        },
        recommendedUseCase: template.whenToUse,
        strengths: template.strengths || [],
        tradeoffs: template.tradeoffs || [],
        actions: template.actions || [],
        why: template.why || "",
        whenToUse: template.whenToUse || ""
      };
    });
  }

  function buildFinalDecision(state, diagnostics, recommendations, scenarios) {
    const preferredScenario = scenarios.slice().sort(function (left, right) {
      if ((left.complianceStatus || "") !== (right.complianceStatus || "")) {
        return left.complianceStatus === "COMPLIANT" ? -1 : 1;
      }
      return (right.decisionScore || 0) - (left.decisionScore || 0);
    })[0] || null;
    const topIssue = diagnostics[0] || null;
    const topRecommendation = recommendations[0] || null;

    return {
      title: preferredScenario
        ? preferredScenario.title
        : "Current architecture is the defendable baseline",
      selectedScenarioKey: preferredScenario ? preferredScenario.key : "balanced",
      decisionScore: preferredScenario ? preferredScenario.decisionScore : 0,
      rationale: preferredScenario
        ? preferredScenario.title + " is preferred because it addresses "
          + (topIssue ? topIssue.problem.toLowerCase() : "the dominant system interaction")
          + " while keeping the strongest combined energy, robustness, and compliance balance."
        : "No alternative scenario outranked the current architecture.",
      recommendedUseCase: preferredScenario ? preferredScenario.recommendedUseCase : "",
      keyDrivers: uniqueStrings([
        topIssue ? topIssue.problem : "",
        topRecommendation ? topRecommendation.title : "",
        state.cleanroomMode
          ? "Keep cleanroom recirculation and make-up air on explicit, separate architectural roles."
          : "Keep the cooling-airflow path tied to the coil while non-cooling streams stay explicit."
      ]).slice(0, 3),
      actionPlan: topRecommendation ? topRecommendation.actions.slice(0, 3) : []
    };
  }

  function buildAdvisorItemsFromReport(report) {
    const diagnostics = report.rootCauseAnalysis || [];
    const recommendations = report.recommendedDesignChanges || [];
    const items = diagnostics.map(function (diagnostic) {
      const linkedRecommendation = recommendations.find(function (recommendation) {
        return recommendation.linkedIssueKey === diagnostic.key;
      }) || recommendations[0] || null;
      return {
        key: diagnostic.key,
        severity: diagnostic.severity,
        category: diagnostic.category,
        title: diagnostic.problem,
        issue: diagnostic.rootCauses && diagnostic.rootCauses.length
          ? "Root causes: " + diagnostic.rootCauses.map(function (cause) {
              return cause.rank + ". " + cause.label;
            }).join(" | ")
          : diagnostic.impact,
        impact: diagnostic.impact,
        recommendation: linkedRecommendation
          ? linkedRecommendation.title + " | " + (linkedRecommendation.actions[0] || linkedRecommendation.whyItWorks)
          : diagnostic.primaryResponse,
        basis: uniqueStrings((diagnostic.evidence || []).concat(
          linkedRecommendation ? linkedRecommendation.improves || [] : []
        )).join(" | "),
        why: linkedRecommendation ? linkedRecommendation.whyItWorks : diagnostic.primaryResponse,
        tradeoff: linkedRecommendation && linkedRecommendation.tradeoffs.length ? linkedRecommendation.tradeoffs[0] : "",
        whenToUse: linkedRecommendation ? linkedRecommendation.useCase : "",
        confidenceScore: report.confidenceScore,
        complianceStatus: report.status === "NON_COMPLIANT"
          ? "REVIEW"
          : diagnostic.severity === "critical"
            ? "NON_COMPLIANT"
            : report.status
      };
    });

    if (report.finalRecommendation && report.finalRecommendation.title) {
      items.push({
        key: "final_recommendation",
        severity: report.status === "NON_COMPLIANT" ? "warning" : "advisory",
        category: "decision",
        title: "Final recommendation",
        issue: report.finalRecommendation.rationale,
        recommendation: report.finalRecommendation.title,
        basis: uniqueStrings(report.finalRecommendation.keyDrivers || []).join(" | "),
        why: report.finalRecommendation.keyDrivers && report.finalRecommendation.keyDrivers.length
          ? report.finalRecommendation.keyDrivers.join(" | ")
          : "",
        tradeoff: "",
        whenToUse: report.finalRecommendation.recommendedUseCase || "",
        confidenceScore: report.confidenceScore,
        complianceStatus: report.status
      });
    }

    items.sort(function (left, right) {
      if (validationSeverityRank(left.severity) !== validationSeverityRank(right.severity)) {
        return validationSeverityRank(right.severity) - validationSeverityRank(left.severity);
      }
      return (left.title || "").localeCompare(right.title || "");
    });

    return items.slice(0, 6);
  }

  function buildDesignIntelligenceReport(options) {
    const state = extractDesignIntelligenceState(options);
    const interpretation = interpretDesignIntelligenceState(state);
    const diagnostics = buildIssueDiagnostics(state, interpretation);
    const recommendations = buildRecommendationPlan(state, diagnostics);
    const scenarios = buildScenarioComparison(state, diagnostics);
    const finalDecision = buildFinalDecision(state, diagnostics, recommendations, scenarios);
    const standardsNote = state.cleanroomMode
      ? (state.cleanroom && state.cleanroom.note) || "Cleanroom airflow, filtration, and pressure assumptions remain an engineering basis until qualification."
      : "Scenarios keep the current airflow hierarchy explicit so cooling, recirculation, and ventilation roles are compared without being merged.";
    const report = {
      provider: "local_reasoning",
      service: "design_intelligence",
      model: "state_reasoning_engine",
      summary: finalDecision.rationale,
      status: state.validation.status,
      confidenceScore: roundTo(state.confidenceScore, 2),
      validationSummary: state.validation.summary,
      systemSummary: interpretation.systemSummary,
      keyIssues: diagnostics.map(function (diagnostic) {
        return {
          key: diagnostic.key,
          category: diagnostic.category,
          severity: diagnostic.severity,
          score: diagnostic.score,
          problem: diagnostic.problem,
          impact: diagnostic.impact
        };
      }),
      rootCauseAnalysis: diagnostics,
      recommendedDesignChanges: recommendations,
      alternativeSystemScenarios: scenarios,
      finalRecommendation: finalDecision,
      preferredOptionKey: finalDecision.selectedScenarioKey || "balanced",
      standardsNote: standardsNote
    };
    report.items = buildAdvisorItemsFromReport(report);
    return report;
  }

  function buildReasoningAdvisor(options) {
    return buildDesignIntelligenceReport(options);
  }

  function buildReasoningAlternatives(options) {
    const report = buildDesignIntelligenceReport(options);
    return {
      provider: report.provider,
      service: report.service,
      summary: report.finalRecommendation && report.finalRecommendation.rationale
        ? report.finalRecommendation.rationale
        : report.summary,
      preferredOptionKey: report.preferredOptionKey || "balanced",
      standardsNote: report.standardsNote,
      confidenceScore: report.confidenceScore,
      systemSummary: report.systemSummary,
      decisionFramework: {
        energyEfficiencyWeight: 0.30,
        capitalCostWeight: 0.20,
        engineeringRobustnessWeight: 0.25,
        complianceWeight: 0.25
      },
      finalRecommendation: report.finalRecommendation,
      options: report.alternativeSystemScenarios || []
    };
  }

  function summarizeProjectDiversity(rooms, diversityFactor) {
    const list = Array.isArray(rooms) ? rooms : [];
    const validRooms = list.filter(function (room) {
      return room && typeof room === "object";
    });
    const totalDesignTR = validRooms.reduce(function (sum, room) {
      return sum + Math.max(room.tr_design || room.tr_calc || 0, 0);
    }, 0);
    const totalFinalTR = validRooms.reduce(function (sum, room) {
      return sum + Math.max(room.tr_final || room.tr_sf || room.tr_design || 0, 0);
    }, 0);
    const totalCatalogTR = validRooms.reduce(function (sum, room) {
      return sum + Math.max(room.tr_catalog || room.TR_sel || 0, 0);
    }, 0);
    return {
      roomCount: validRooms.length,
      diversityFactor: roundTo(diversityFactor || 1, 3),
      totalDesignTR: roundTo(totalDesignTR, 3),
      totalFinalTR: roundTo(totalFinalTR, 3),
      totalCatalogTR: roundTo(totalCatalogTR, 3),
      diversifiedTR: roundTo(totalFinalTR * (diversityFactor || 1), 3)
    };
  }

  return {
    CFM_TO_M3S: CFM_TO_M3S,
    DEFAULT_FITTING_DATABASE: DEFAULT_FITTING_DATABASE,
    clamp: clamp,
    safeDiv: safeDiv,
    roundTo: roundTo,
    pressureAtElevation: pressureAtElevation,
    humidityRatioAt: humidityRatioAt,
    saturationHumidityRatio: saturationHumidityRatio,
    moistAirEnthalpy: moistAirEnthalpy,
    humidityRatioFromEnthalpyTemp: humidityRatioFromEnthalpyTemp,
    moistAirSpecificVolume: moistAirSpecificVolume,
    calculateShrRatio: calculateShrRatio,
    correctedCltd: correctedCltd,
    buildInfiltrationModel: buildInfiltrationModel,
    resolveAirflowStreams: resolveAirflowStreams,
    ductAreaM2: ductAreaM2,
    hydraulicDiameterM: hydraulicDiameterM,
    equivalentDiameterM: equivalentDiameterM,
    calculateDuctPressureLoss: calculateDuctPressureLoss,
    calculateFittingLoss: calculateFittingLoss,
    calculateDuctDiagnostics: calculateDuctDiagnostics,
    buildAirflowDiagnostics: buildAirflowDiagnostics,
    solveAdpFromProcess: solveAdpFromProcess,
    solveRoomPsychrometrics: solveRoomPsychrometrics,
    buildDesignValidation: buildDesignValidation,
    buildDesignIntelligenceReport: buildDesignIntelligenceReport,
    buildReasoningAdvisor: buildReasoningAdvisor,
    buildReasoningAlternatives: buildReasoningAlternatives,
    summarizeProjectDiversity: summarizeProjectDiversity
  };
}));
