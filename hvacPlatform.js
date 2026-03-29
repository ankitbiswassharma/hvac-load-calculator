(function () {
  const CFM_TO_M3S = 0.00047194745;
  const FT2_TO_M2 = 0.092903;
  const SQM_TO_SQFT = 10.7639;
  const AIR_DENSITY = 1.2;
  const AIR_CP = 1.005;
  const SENSIBLE_W_PER_CFM_C = AIR_DENSITY * AIR_CP * CFM_TO_M3S * 1000;
  const IN_TO_MM = 25.4;
  const FPM_TO_MPS = 0.00508;
  const MAX_RECT_WIDTH_MM = 2400;
  const MAX_RECT_HEIGHT_MM = 1200;
  const ABS_MAX_RECT_WIDTH_MM = 3000;
  const ABS_MAX_RECT_HEIGHT_MM = 1500;
  const MAX_ASPECT_RATIO = 4;
  const MAX_CIRC_DIAMETER_MM = 1600;
  const ABS_MAX_CIRC_DIAMETER_MM = 2000;
  const MAX_TRUNKS_PER_AHU = 6;
  const IDEAL_MAX_TRUNKS_PER_AHU = 4;
  const MAX_VELOCITY_SUPPLY_MPS = 10;
  const MAX_VELOCITY_RETURN_MPS = 7;
  const MAX_VELOCITY_EXHAUST_MPS = 12;

  const ROOM_FIELD_IDS = [
    "len",
    "wid",
    "ht",
    "win_area",
    "win_orient",
    "wall_exp",
    "roof_exp",
    "occ",
    "occ_act",
    "fresh_cfm",
    "lighting",
    "equip",
    "out_dbt",
    "out_wbt",
    "out_rh",
    "out_mdr",
    "out_lat",
    "out_elev",
    "out_heat_dbt",
    "out_dehum_wbt",
    "in_dbt",
    "in_rh",
    "sf",
    "u_wall",
    "climate_zone",
    "koppen",
    "u_roof",
    "sc_glass",
    "clf_shade",
    "solar_day",
    "solar_hour",
    "ahu_group"
  ];

  const RATE_FIELD_IDS = [
    "rate_tr",
    "rate_duct",
    "rate_diffuser",
    "rate_return",
    "rate_insul",
    "rate_fan",
    "rate_pipe",
    "rate_bms",
    "rate_install",
    "rate_energy"
  ];

  const DEFAULT_RATES = {
    rate_tr: 15000,
    rate_duct: 850,
    rate_diffuser: 1200,
    rate_return: 900,
    rate_insul: 250,
    rate_fan: 8500,
    rate_pipe: 4500,
    rate_bms: 3000,
    rate_install: 20,
    rate_energy: 9.75
  };

  const DEFAULT_INPUTS = {
    len: "10",
    wid: "8",
    ht: "3",
    win_area: "6",
    win_orient: "SE",
    wall_exp: "2",
    roof_exp: "top_floor",
    occ: "10",
    occ_act: "seated_light",
    fresh_cfm: "15",
    lighting: "12",
    equip: "15",
    out_dbt: "40",
    out_wbt: "26",
    out_rh: "50",
    out_mdr: "10",
    out_lat: "28",
    out_elev: "216",
    out_heat_dbt: "4",
    out_dehum_wbt: "28",
    in_dbt: "24",
    in_rh: "50",
    sf: "10",
    u_wall: "0.45",
    climate_zone: "—",
    koppen: "—",
    u_roof: "0.40",
    sc_glass: "0.87",
    clf_shade: "0.55",
    solar_day: "202",
    solar_hour: "15",
    ahu_group: "AHU-1"
  };

  const platform = {
    initialized: false,
    inputListenersBound: false,
    authListenersBound: false,
    projectManagerReady: false,
    energyRequestSerial: 0,
    licensingPlans: [],
    razorpayEnabled: false,
    razorpayKeyId: "",
    razorpayLoader: null,
    licenseInvite: null,
    licenseInviteNotice: null,
    adminCompanyUsers: []
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function valueOf(id, fallback) {
    const element = byId(id);
    if (!element) {
      return fallback;
    }
    return element.value != null ? element.value : fallback;
  }

  function numberOf(id, fallback) {
    const parsed = parseFloat(valueOf(id, fallback));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function setValue(id, value) {
    const element = byId(id);
    if (element) {
      element.value = value;
    }
  }

  function setMetric(id, value, unit) {
    const element = byId(id);
    if (!element) {
      return;
    }
    if (unit) {
      element.innerHTML = value + '<span class="metric-unit">' + unit + "</span>";
      return;
    }
    element.textContent = value;
  }

  function formatInt(value) {
    return Math.round(value).toLocaleString("en-IN");
  }

  function formatNumber(value, digits) {
    const requestedDigits = digits == null ? 2 : digits;
    const displayDigits = Math.max(0, Math.min(requestedDigits, 2));
    return Number(value).toFixed(displayDigits);
  }

  function formatCurrency(value) {
    return "₹" + Math.round(value || 0).toLocaleString("en-IN");
  }

  function copyJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function setReadOnlyState(id, locked) {
    const element = byId(id);
    if (!element) {
      return;
    }
    if (element.tagName === "SELECT") {
      element.disabled = !!locked;
      return;
    }
    element.readOnly = !!locked;
    element.classList.toggle("is-readonly", !!locked);
  }

  function loadExternalScript(src) {
    return new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", function handleLoad() {
          existing.dataset.loaded = "true";
          resolve();
        }, { once: true });
        existing.addEventListener("error", function handleError() {
          reject(new Error("Unable to load script: " + src));
        }, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = function () {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = function () {
        reject(new Error("Unable to load script: " + src));
      };
      document.head.appendChild(script);
    });
  }

  async function ensureRazorpayCheckout() {
    if (window.Razorpay) {
      return true;
    }
    if (!platform.razorpayLoader) {
      platform.razorpayLoader = loadExternalScript("https://checkout.razorpay.com/v1/checkout.js").catch(function (error) {
        platform.razorpayLoader = null;
        throw error;
      });
    }
    await platform.razorpayLoader;
    return !!window.Razorpay;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundUpTo(value, increment) {
    const step = Math.max(increment || 1, 1);
    return Math.ceil(value / step) * step;
  }

  function roundTo(value, digits) {
    const factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
  }

  function safeDiv(numerator, denominator, fallback) {
    return denominator ? numerator / denominator : (fallback || 0);
  }

  function specificFanPowerTargets(airsideProfile, designEspPa) {
    const profile = airsideProfile || {};
    const esp = Math.max(designEspPa || 0, 0);
    let advisory = 0.9;
    let warning = 1.05;

    if (profile.type === "Industrial / process") {
      advisory = 1.0;
      warning = 1.15;
    }
    if (profile.largeIndustrialHall) {
      advisory = 1.05;
      warning = 1.2;
    }
    if (esp >= 700) {
      advisory += 0.05;
      warning += 0.1;
    } else if (esp >= 550) {
      advisory += 0.03;
      warning += 0.05;
    }

    return {
      advisory: roundTo(advisory, 2),
      warning: roundTo(warning, 2)
    };
  }

  function pressureAtElevation(elevationM) {
    return 101325 * Math.pow(1 - 2.25577e-5 * Math.max(0, elevationM || 0), 5.25588);
  }

  function saturationPressurePa(tempC) {
    return 611.21 * Math.exp((18.678 - tempC / 234.5) * tempC / (257.14 + tempC));
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

  function dryBulbFromEnthalpyHumidity(enthalpyValue, humidityRatioValue) {
    return safeDiv(enthalpyValue - 2501 * humidityRatioValue, 1.006 + 1.86 * humidityRatioValue, 0);
  }

  function moistAirSpecificVolume(tempC, humidityRatioValue, pressurePa) {
    const pressure = pressurePa || 101325;
    return 287.055 * (tempC + 273.15) * (1 + 1.607858 * humidityRatioValue) / pressure;
  }

  function sensibleCapacityPerCfmDeltaC(tempC, humidityRatioValue, pressurePa) {
    const specificVolume = moistAirSpecificVolume(tempC, humidityRatioValue, pressurePa);
    const dryAirMassFlowPerCfm = safeDiv(CFM_TO_M3S, specificVolume, 0);
    const moistAirCp = 1.006 + 1.86 * humidityRatioValue;
    return dryAirMassFlowPerCfm * moistAirCp * 1000;
  }

  function selectAirflowDesignBasis(indoorDryBulb, indoorRelativeHumidity, roomShr, ceilingHeight, airsideProfile) {
    const isIndustrial = airsideProfile && airsideProfile.type === "Industrial / process";
    const bounds = isIndustrial
      ? {
          baseDeltaT: 10.5,
          minDeltaT: 9,
          maxDeltaT: 13,
          minSupplyTemp: 10.5
        }
      : {
          baseDeltaT: 9,
          minDeltaT: 8,
          maxDeltaT: 11.5,
          minSupplyTemp: 11.5
        };
    const latentBias = clamp((0.9 - roomShr) * 8, -1, 2);
    const humidityBias = clamp(((indoorRelativeHumidity || 50) - 50) / 10, -0.5, 1);
    const heightBias = clamp((Math.max(ceilingHeight || 3, 2.4) - 3) * (isIndustrial ? 0.35 : 0.2), 0, isIndustrial ? 1 : 0.6);
    const preliminaryDeltaT = bounds.baseDeltaT + latentBias + humidityBias + heightBias;
    let roomDeltaTDesign = clamp(preliminaryDeltaT, bounds.minDeltaT, bounds.maxDeltaT);
    let supplyTempDesign = indoorDryBulb - roomDeltaTDesign;

    if (supplyTempDesign < bounds.minSupplyTemp) {
      supplyTempDesign = bounds.minSupplyTemp;
      roomDeltaTDesign = Math.max(indoorDryBulb - supplyTempDesign, bounds.minDeltaT);
    }

    return {
      roomDeltaTDesign: roundTo(roomDeltaTDesign, 1),
      supplyTempDesign: roundTo(supplyTempDesign, 1),
      note: isIndustrial
        ? "Industrial airflow basis uses a higher room-to-supply temperature differential for larger sensible transport."
        : "Comfort airflow basis uses a moderate room-to-supply temperature differential for occupied-zone air distribution."
    };
  }

  function selectPreferredReserveMargin(safetyPercent, airsideProfile, trDesign) {
    const baseMargin = clamp((safetyPercent || 10) / 100, 0.06, 0.12);
    if (airsideProfile && airsideProfile.largeIndustrialHall) {
      return clamp(Math.min(baseMargin, 0.08), 0.06, 0.08);
    }
    if (airsideProfile && airsideProfile.type === "Industrial / process") {
      return clamp(Math.min(baseMargin, 0.10), 0.07, 0.10);
    }
    if ((trDesign || 0) >= 20) {
      return clamp(Math.min(baseMargin, 0.09), 0.07, 0.09);
    }
    if ((trDesign || 0) <= 5) {
      return clamp(Math.max(baseMargin, 0.08), 0.08, 0.12);
    }
    return baseMargin;
  }

  function solveSaturatedTempFromEnthalpy(targetEnthalpy, pressurePa, maxTemp) {
    let best = { temp: maxTemp, error: Infinity };
    const upper = Math.min(maxTemp == null ? 30 : maxTemp, 40);
    for (let temp = 2; temp <= upper; temp += 0.1) {
      const satW = saturationHumidityRatio(temp, pressurePa);
      const satH = moistAirEnthalpy(temp, satW);
      const error = Math.abs(satH - targetEnthalpy);
      if (error < best.error) {
        best = { temp: temp, error: error };
      }
    }
    return best.temp;
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
        method: "fallback_supply_saturation"
      };
    }

    return {
      temp: best.temp,
      humidity: best.humidity,
      bypassFactor: clamp((best.bfTemp + best.bfHumidity) / 2, 0, 1),
      bfTemp: clamp(best.bfTemp, 0, 1),
      bfHumidity: clamp(best.bfHumidity, 0, 1),
      humidityError: best.humidityError,
      method: "bf_consistent_search"
    };
  }

  function nextStandardTR(requiredTR) {
    const sizes = (window.STD_TR || []).slice().sort(function (left, right) {
      return left - right;
    });
    const exact = sizes.find(function (size) {
      return size >= requiredTR;
    });
    if (exact) {
      return exact;
    }
    return requiredTR > 0 ? roundUpTo(requiredTR, 5) : 0;
  }

  function equivalentDiameterIn(areaFt2) {
    return Math.sqrt(4 * Math.max(areaFt2 || 0, 0) / Math.PI) * 12;
  }

  function ductShapeMetrics(duct) {
    const widthIn = duct && duct.rectW ? duct.rectW : 0;
    const heightIn = duct && duct.rectH ? duct.rectH : 0;
    const diameterIn = duct && duct.dia_in ? duct.dia_in : 0;
    return {
      widthIn: widthIn,
      heightIn: heightIn,
      diameterIn: diameterIn,
      widthMm: roundTo(widthIn * IN_TO_MM, 0),
      heightMm: roundTo(heightIn * IN_TO_MM, 0),
      diameterMm: roundTo(diameterIn * IN_TO_MM, 0),
      aspectRatio: roundTo(Math.max(safeDiv(widthIn, Math.max(heightIn, 0.1), 0), safeDiv(heightIn, Math.max(widthIn, 0.1), 0)), 2)
    };
  }

  function ductKindLimits(kind) {
    if (kind === "return") {
      return {
        label: "Return",
        maxVelocityMps: MAX_VELOCITY_RETURN_MPS,
        idealMaxTrunks: IDEAL_MAX_TRUNKS_PER_AHU,
        maxTrunks: MAX_TRUNKS_PER_AHU
      };
    }
    if (kind === "exhaust") {
      return {
        label: "Process / exhaust",
        maxVelocityMps: MAX_VELOCITY_EXHAUST_MPS,
        idealMaxTrunks: IDEAL_MAX_TRUNKS_PER_AHU,
        maxTrunks: MAX_TRUNKS_PER_AHU
      };
    }
    return {
      label: "Supply",
      maxVelocityMps: MAX_VELOCITY_SUPPLY_MPS,
      idealMaxTrunks: IDEAL_MAX_TRUNKS_PER_AHU,
      maxTrunks: MAX_TRUNKS_PER_AHU
    };
  }

  function mergeStatuses(left, right) {
    const rank = { OK: 0, WARNING: 1, REJECT: 2 };
    return (rank[left] || 0) >= (rank[right] || 0) ? left : right;
  }

  function buildDuctStrategy(totalCFM, velocityFpm, singleDuct, minimumTrunks, options) {
    const settings = options || {};
    const kind = settings.kind || "supply";
    const kindLimits = ductKindLimits(kind);
    const preferredTrunkCFM = clamp(settings.preferredTrunkCFM || 3500, 3000, 4000);
    const maxCFMPerTrunk = clamp(settings.maxCFMPerTrunk || preferredTrunkCFM, 3000, 4000);
    const maxEquivalentDiameterIn = settings.maxEquivalentDiameterIn || (MAX_CIRC_DIAMETER_MM / IN_TO_MM);
    const maxRectWidthIn = settings.maxRectWidthIn || (MAX_RECT_WIDTH_MM / IN_TO_MM);
    const maxRectHeightIn = settings.maxRectHeightIn || (MAX_RECT_HEIGHT_MM / IN_TO_MM);
    const absMaxEquivalentDiameterIn = settings.absMaxEquivalentDiameterIn || (ABS_MAX_CIRC_DIAMETER_MM / IN_TO_MM);
    const absMaxRectWidthIn = settings.absMaxRectWidthIn || (ABS_MAX_RECT_WIDTH_MM / IN_TO_MM);
    const absMaxRectHeightIn = settings.absMaxRectHeightIn || (ABS_MAX_RECT_HEIGHT_MM / IN_TO_MM);
    const maxAspectRatio = settings.maxAspectRatio || MAX_ASPECT_RATIO;
    const maxTrunksAllowed = settings.maxTrunksAllowed || kindLimits.maxTrunks;
    const rawEquivalentDiameterIn = equivalentDiameterIn(singleDuct && singleDuct.area_ft2);
    const singleMetrics = ductShapeMetrics(singleDuct);
    const velocityMps = roundTo((velocityFpm || 0) * FPM_TO_MPS, 2);
    const reasons = [];

    if ((minimumTrunks || 1) > 1) {
      reasons.push("parallel trunks align with the selected modular AHU arrangement");
    }
    if (totalCFM > preferredTrunkCFM) {
      reasons.push("airflow exceeds the preferred 3000-4000 CFM per trunk band");
    }
    if (rawEquivalentDiameterIn > maxEquivalentDiameterIn + 0.01) {
      reasons.push("equivalent round duct exceeds the preferred diameter limit");
    }
    if ((singleDuct && singleDuct.rectW || 0) > maxRectWidthIn) {
      reasons.push("rectangular duct width exceeds the preferred fabrication limit");
    }
    if ((singleDuct && singleDuct.rectH || 0) > maxRectHeightIn) {
      reasons.push("rectangular duct depth exceeds the preferred fabrication limit");
    }
    if (singleMetrics.aspectRatio > maxAspectRatio + 0.01) {
      reasons.push("rectangular duct aspect ratio exceeds the preferred 4:1 limit");
    }
    if (velocityMps > kindLimits.maxVelocityMps + 0.01) {
      reasons.push(kindLimits.label.toLowerCase() + " velocity exceeds the maximum practical limit");
    }

    const requiredTrunks = reasons.length
      ? Math.max(
          minimumTrunks || 1,
          Math.ceil(totalCFM / Math.max(preferredTrunkCFM, 1)),
          Math.ceil(rawEquivalentDiameterIn / Math.max(maxEquivalentDiameterIn, 1)),
          Math.ceil((singleDuct && singleDuct.rectW || 0) / Math.max(maxRectWidthIn, 1)),
          Math.ceil((singleDuct && singleDuct.rectH || 0) / Math.max(maxRectHeightIn, 1)),
          Math.ceil(singleMetrics.aspectRatio / Math.max(maxAspectRatio, 1))
        )
      : 1;
    const trunkCount = Math.max(requiredTrunks, minimumTrunks || 1);
    const perTrunkCFM = totalCFM / trunkCount;
    const trunkDuct = trunkCount > 1 ? ductSize(perTrunkCFM, velocityFpm) : singleDuct;
    const trunkMetrics = ductShapeMetrics(trunkDuct);
    const validationMessages = [];
    let validationStatus = "OK";

    if (trunkMetrics.widthIn > absMaxRectWidthIn + 0.01 || trunkMetrics.heightIn > absMaxRectHeightIn + 0.01 || trunkMetrics.diameterIn > absMaxEquivalentDiameterIn + 0.01) {
      validationStatus = "REJECT";
      validationMessages.push("duct size exceeds the absolute fabrication / transport limit");
    }
    if (trunkMetrics.aspectRatio > maxAspectRatio + 0.01) {
      validationStatus = "REJECT";
      validationMessages.push("duct aspect ratio exceeds 4:1 even after trunk splitting");
    }
    if (trunkCount > maxTrunksAllowed) {
      validationStatus = "REJECT";
      validationMessages.push("too many trunks per AHU; split the air system or add more zone AHUs");
    } else if (trunkCount > kindLimits.idealMaxTrunks) {
      validationStatus = mergeStatuses(validationStatus, "WARNING");
      validationMessages.push("trunk count is above the preferred practical range");
    }
    if (velocityMps > kindLimits.maxVelocityMps + 0.01) {
      validationStatus = mergeStatuses(validationStatus, "WARNING");
      validationMessages.push("velocity is above the ASHRAE / industry practice limit for " + kindLimits.label.toLowerCase() + " ducts");
    }
    if (trunkMetrics.widthIn > maxRectWidthIn + 0.01 || trunkMetrics.heightIn > maxRectHeightIn + 0.01 || trunkMetrics.diameterIn > maxEquivalentDiameterIn + 0.01) {
      validationStatus = mergeStatuses(validationStatus, "WARNING");
      validationMessages.push("duct size is above the recommended limit and should be coordinated carefully");
    }
    if (trunkMetrics.aspectRatio > maxAspectRatio - 0.01) {
      validationStatus = mergeStatuses(validationStatus, "WARNING");
      validationMessages.push("duct aspect ratio is at the high end of good fabrication practice");
    }

    if (perTrunkCFM > maxCFMPerTrunk + 1) {
      validationStatus = mergeStatuses(validationStatus, "WARNING");
      validationMessages.push("per-trunk airflow is above the maximum 4000 CFM design band");
    }

    const recommendedSystems = Math.max(1, Math.ceil(Math.max(requiredTrunks, trunkCount) / Math.max(maxTrunksAllowed, 1)));
    const targetSystems = validationStatus === "REJECT" ? recommendedSystems : Math.max(1, Math.ceil((trunkCount || 1) / Math.max(kindLimits.idealMaxTrunks, 1)));
    const targetSystemCFM = roundTo(safeDiv(totalCFM, targetSystems, 0), 0);
    const targetTrunksPerSystem = Math.max(1, Math.ceil((requiredTrunks || trunkCount || 1) / targetSystems));
    const targetTrunkCFM = roundTo(safeDiv(totalCFM, Math.max(targetSystems * targetTrunksPerSystem, 1), 0), 0);
    const bestAlternative = [];

    if (validationStatus === "REJECT" || validationMessages.length) {
      if ((requiredTrunks || trunkCount) > maxTrunksAllowed) {
        bestAlternative.push("Split into " + targetSystems + " AHU system(s) so each handles about " + targetSystemCFM + " CFM with up to " + targetTrunksPerSystem + " trunk(s).");
      }
      if (perTrunkCFM > maxCFMPerTrunk + 1) {
        bestAlternative.push("Increase parallel trunks or split the serving system so each trunk stays at or below 4000 CFM, ideally near 3500 CFM.");
      }
      if (trunkMetrics.widthIn > absMaxRectWidthIn + 0.01 || trunkMetrics.heightIn > absMaxRectHeightIn + 0.01 || trunkMetrics.diameterIn > absMaxEquivalentDiameterIn + 0.01 || trunkMetrics.aspectRatio > maxAspectRatio + 0.01) {
        bestAlternative.push("Use at least " + Math.max(requiredTrunks, trunkCount) + " parallel trunk(s), about " + targetTrunkCFM + " CFM per trunk, or split the serving system.");
      }
      if (velocityMps > kindLimits.maxVelocityMps + 0.01) {
        bestAlternative.push("Reduce " + kindLimits.label.toLowerCase() + " velocity to " + roundTo(kindLimits.maxVelocityMps, 1) + " m/s and re-route with more parallel trunks if needed.");
      }
    }

    return {
      isMultiple: trunkCount > 1,
      trunkCount: trunkCount,
      requiredTrunks: requiredTrunks,
      totalCFM: totalCFM,
      perTrunkCFM: perTrunkCFM,
      velocityFpm: velocityFpm,
      velocityMps: velocityMps,
      trunkDuct: trunkDuct,
      singleDuct: singleDuct,
      rawEquivalentDiameterIn: roundTo(rawEquivalentDiameterIn, 1),
      maxEquivalentDiameterIn: maxEquivalentDiameterIn,
      maxRectWidthIn: maxRectWidthIn,
      maxRectHeightIn: maxRectHeightIn,
      maxAspectRatio: maxAspectRatio,
      kind: kind,
      kindLabel: kindLimits.label,
      maxTrunksAllowed: maxTrunksAllowed,
      idealMaxTrunks: kindLimits.idealMaxTrunks,
      preferredTrunkCFM: preferredTrunkCFM,
      maxCFMPerTrunk: maxCFMPerTrunk,
      metrics: trunkMetrics,
      validationStatus: validationStatus,
      validationMessages: validationMessages,
      targetSystems: targetSystems,
      targetSystemCFM: targetSystemCFM,
      targetTrunksPerSystem: targetTrunksPerSystem,
      bestAlternative: bestAlternative.join(" "),
      reason: reasons.length
        ? reasons.join("; ")
        : "Single trunk stays inside the preferred duct size limits."
    };
  }

  function classifyAirsideProfile(inputs, area) {
    const equipmentDensity = parseFloat(inputs.equip) || 0;
    const lightingDensity = parseFloat(inputs.lighting) || 0;
    const occupants = parseFloat(inputs.occ) || 0;
    const height = parseFloat(inputs.ht) || 3;
    const occupantDensity = safeDiv(occupants, area, 0);
    const activity = inputs.occ_act || "seated_light";
    const isIndustrial = activity === "walking"
      || equipmentDensity >= 25
      || (activity === "standing_light" && equipmentDensity >= 18)
      || (activity === "standing_light" && occupantDensity >= 0.18);
    const largeIndustrialHall = isIndustrial && (area >= 1200 || height >= 7.5);
    const freshAirPerPerson = parseFloat(inputs.fresh_cfm) || 0;
    const rangeMin = largeIndustrialHall ? 1.5
      : isIndustrial ? 3
        : 6;
    const rangeMax = largeIndustrialHall ? 3
      : isIndustrial ? 5
        : 10;
    const rawLoadBias = largeIndustrialHall
      ? equipmentDensity / 22 + lightingDensity / 45 + occupantDensity * 4
      : isIndustrial
        ? equipmentDensity / 16 + lightingDensity / 28 + occupantDensity * 6
        : equipmentDensity / 20 + lightingDensity / 35 + occupantDensity * 8;
    const hallModeration = largeIndustrialHall ? 0.74 : isIndustrial ? 0.88 : 1;
    const ventilationCredit = largeIndustrialHall
      ? clamp((freshAirPerPerson - 6) / 18, 0, 0.6)
      : isIndustrial
        ? clamp((freshAirPerPerson - 8) / 24, 0, 0.4)
        : clamp((freshAirPerPerson - 8) / 30, 0, 0.2);
    const lowDensityRelief = largeIndustrialHall
      ? clamp((0.05 - occupantDensity) * 6, 0, 0.35)
      : isIndustrial
        ? clamp((0.05 - occupantDensity) * 3, 0, 0.15)
        : 0;
    const loadBias = Math.max(0, rawLoadBias * hallModeration - ventilationCredit - lowDensityRelief);
    const achRequired = roundTo(clamp(rangeMin + loadBias, rangeMin, rangeMax) * 4, 0) / 4;
    const zoneLimits = largeIndustrialHall
      ? {
          maxZoneArea: 1800,
          maxZoneLength: 32,
          maxZoneWidth: 22,
          maxZoneConditionedCFM: 16000,
          maxZoneTR: 35,
          maxZones: 6
        }
      : isIndustrial
        ? {
            maxZoneArea: 750,
            maxZoneLength: 22,
            maxZoneWidth: 16,
            maxZoneConditionedCFM: 10000,
            maxZoneTR: 25,
            maxZones: 8
          }
        : null;
    const note = largeIndustrialHall
      ? "Large industrial hall modeled with about 1.5-3 ACH general hall ventilation only; localized exhaust / process booths should be handled separately instead of full-volume hall ACH."
      : isIndustrial
        ? "Industrial ventilation uses moderated general ACH with local capture expected for contaminant-intensive processes."
        : "Office comfort ACH band selected from occupancy and equipment density.";

    return {
      type: isIndustrial ? "Industrial / process" : "Office / comfort",
      achRequired: achRequired,
      achRangeMin: rangeMin,
      achRangeMax: rangeMax,
      note: note,
      largeIndustrialHall: largeIndustrialHall,
      processVentilationStrategy: largeIndustrialHall ? "localized_capture" : isIndustrial ? "mixed_general_plus_local_capture" : "comfort_ventilation",
      heatRecoveryRecommended: !!(largeIndustrialHall || (isIndustrial && equipmentDensity >= 25)),
      processAirScheduleRatio: largeIndustrialHall ? 0.6 : isIndustrial ? 0.75 : 0.7,
      recommendedProcessStaticPa: largeIndustrialHall ? 140 : isIndustrial ? 180 : 120,
      highBayAirDistribution: !!(largeIndustrialHall || height >= 7.5),
      zoneLimits: zoneLimits
    };
  }

  function chooseZoneGrid(requiredCount, length, width) {
    const target = Math.max(1, Math.ceil(requiredCount || 1));
    const roomRatio = safeDiv(length, width, 1);
    let best = null;

    for (let rows = 1; rows <= target; rows += 1) {
      const cols = Math.ceil(target / rows);
      const actualCount = rows * cols;
      const zoneLength = safeDiv(length, cols, length);
      const zoneWidth = safeDiv(width, rows, width);
      const zoneRatio = safeDiv(zoneLength, zoneWidth, 1);
      const aspectPenalty = Math.abs(zoneRatio - roomRatio) * 2.2;
      const overshootPenalty = (actualCount - target) * 3;
      const longAxisPenalty = length >= width
        ? Math.max(0, rows - cols) * 1.8
        : Math.max(0, cols - rows) * 1.8;
      const squarenessPenalty = Math.abs(cols - rows) * 0.35;
      const score = aspectPenalty + overshootPenalty + longAxisPenalty + squarenessPenalty;

      if (!best || score < best.score) {
        best = {
          rows: rows,
          cols: cols,
          actualCount: actualCount,
          zoneLength: zoneLength,
          zoneWidth: zoneWidth,
          score: score
        };
      }
    }

    return best || {
      rows: 1,
      cols: 1,
      actualCount: 1,
      zoneLength: length,
      zoneWidth: width,
      score: 0
    };
  }

  function buildAutoZoningPlan(options) {
    const settings = options || {};
    const length = Math.max(settings.length || 0, 0);
    const width = Math.max(settings.width || 0, 0);
    const area = Math.max(length * width, 1);
    const conditionedCFM = Math.max(settings.conditionedCFM || 0, 0);
    const processCFM = Math.max(settings.processCFM || 0, 0);
    const trFinal = Math.max(settings.trFinal || 0, 0);
    const airsideProfile = settings.airsideProfile || {};
    const isIndustrial = airsideProfile.type === "Industrial / process";
    const limits = airsideProfile.zoneLimits || (isIndustrial
      ? {
          maxZoneArea: 180,
          maxZoneLength: 18,
          maxZoneWidth: 12,
          maxZoneConditionedCFM: 7000,
          maxZoneTR: 20,
          maxZones: 12
        }
      : {
          maxZoneArea: 110,
          maxZoneLength: 11,
          maxZoneWidth: 8.5,
          maxZoneConditionedCFM: 2600,
          maxZoneTR: 9.5,
          maxZones: 8
        });

    let zoneCount = 1;
    const reasons = [];
    const areaZones = Math.ceil(area / limits.maxZoneArea);
    const lengthZones = Math.ceil(length / limits.maxZoneLength);
    const widthZones = Math.ceil(width / limits.maxZoneWidth);
    const airflowZones = Math.ceil(conditionedCFM / limits.maxZoneConditionedCFM);
    const tonnageZones = Math.ceil(trFinal / limits.maxZoneTR);
    const processRatio = safeDiv(processCFM, conditionedCFM, 0);

    if (areaZones > 1) {
      zoneCount = Math.max(zoneCount, areaZones);
      reasons.push("area exceeds the preferred single-zone coverage limit");
    }
    if (lengthZones > 1) {
      zoneCount = Math.max(zoneCount, lengthZones);
      reasons.push("room length is beyond the preferred single-zone throw/control range");
    }
    if (widthZones > 1) {
      zoneCount = Math.max(zoneCount, widthZones);
      reasons.push("room width is beyond the preferred single-zone coverage range");
    }
    if (airflowZones > 1) {
      zoneCount = Math.max(zoneCount, airflowZones);
      reasons.push("conditioned airflow is high for a single control zone");
    }
    if (tonnageZones > 1) {
      zoneCount = Math.max(zoneCount, tonnageZones);
      reasons.push("cooling capacity is high for a single occupied control zone");
    }
    if (processRatio > (isIndustrial ? 0.8 : 0.5)) {
      zoneCount = Math.max(zoneCount, 2);
      reasons.push("process / ACH airflow is significant and benefits from zoning separation");
    }
    if (settings.layoutHint && (settings.layoutHint.zoningRecommended || !settings.layoutHint.spacingPass || !settings.layoutHint.throwPass)) {
      zoneCount = Math.max(zoneCount, (settings.currentZoneCount || 1) + 1);
      reasons.push("terminal coverage checks indicate that the room should be split into smaller air-distribution zones");
    }
    if (settings.forceMinZones) {
      zoneCount = Math.max(zoneCount, Math.ceil(settings.forceMinZones));
    }

    zoneCount = clamp(zoneCount, 1, limits.maxZones);
    const grid = chooseZoneGrid(zoneCount, length, width);
    const zoneLength = safeDiv(length, grid.cols, length);
    const zoneWidth = safeDiv(width, grid.rows, width);
    const zoneArea = zoneLength * zoneWidth;
    const zoneConditionedCFM = safeDiv(conditionedCFM, grid.actualCount, 0);
    const zoneProcessCFM = safeDiv(processCFM, grid.actualCount, 0);
    const zoneTR = safeDiv(trFinal, grid.actualCount, 0);
    const zones = [];

    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const zoneIndex = row * grid.cols + col + 1;
        zones.push({
          id: "zone-" + zoneIndex,
          name: "Zone " + zoneIndex,
          row: row + 1,
          col: col + 1,
          x0: roundTo(col * zoneLength, 2),
          y0: roundTo(row * zoneWidth, 2),
          length: roundTo(zoneLength, 2),
          width: roundTo(zoneWidth, 2),
          area: roundTo(zoneArea, 2),
          conditionedCFM: roundTo(zoneConditionedCFM, 1),
          processCFM: roundTo(zoneProcessCFM, 1),
          trFinal: roundTo(zoneTR, 2)
        });
      }
    }

    return {
      recommended: grid.actualCount > 1,
      zoneCount: grid.actualCount,
      rows: grid.rows,
      cols: grid.cols,
      zoneLength: roundTo(zoneLength, 2),
      zoneWidth: roundTo(zoneWidth, 2),
      zoneArea: roundTo(zoneArea, 2),
      zoneConditionedCFM: roundTo(zoneConditionedCFM, 1),
      zoneProcessCFM: roundTo(zoneProcessCFM, 1),
      zoneTR: roundTo(zoneTR, 2),
      limits: limits,
      zones: zones,
      basis: reasons.length
        ? reasons.join("; ")
        : "Single-zone layout is acceptable within the configured control and air-distribution limits."
    };
  }

  function recommendSystemType(options) {
    const settings = options || {};
    const airsideProfile = settings.airsideProfile || {};
    const zoning = settings.zoning || { zoneCount: 1 };
    const diffuserLayout = settings.diffuserLayout || {};
    const conditionedCFM = Math.max(settings.conditionedCFM || 0, 0);
    const processCFM = Math.max(settings.processCFM || 0, 0);
    const processRatio = safeDiv(processCFM, conditionedCFM, 0);
    const oaFraction = clamp(settings.oaFraction || 0, 0, 1);
    const trFinal = settings.trFinal || 0;
    const area = settings.area || 0;
    const isIndustrial = airsideProfile.type === "Industrial / process" || diffuserLayout.isIndustrialMode;
    const processAirActive = processCFM > Math.max(250, conditionedCFM * 0.05);
    const processSystemRequired = processAirActive && (airsideProfile.largeIndustrialHall || isIndustrial || processRatio > 0.8);
    const secondaries = [];
    const reasons = [];
    let primarySystem = "";
    let systemFamily = "";

    if (airsideProfile.largeIndustrialHall) {
      systemFamily = processAirActive ? "industrial_local_capture" : "industrial_hall_recirculation";
      primarySystem = processAirActive
        ? "Distributed recirculation AHUs with localized exhaust / make-up air"
        : "Distributed recirculation AHUs with general hall ventilation";
      secondaries.push("General hall ventilation only (2-4 ACH)");
      secondaries.push(diffuserLayout.supplyDeviceType || "High-bay jet / air sock distribution");
      if (processAirActive) {
        secondaries.push("Localized process exhaust / booth extraction");
      }
      if (airsideProfile.heatRecoveryRecommended && (processAirActive || oaFraction > 0.25)) {
        secondaries.push("Heat recovery on process / make-up air");
      }
      reasons.push("large industrial halls should not be treated as full-volume comfort or full-volume process ACH systems");
      reasons.push(processAirActive
        ? "local capture plus distributed recirculation minimizes airflow, duct complexity, and fan energy"
        : "distributed recirculation with controlled general hall ventilation is appropriate because no active process-air duty is currently present");
    } else if (processSystemRequired || processRatio > 0.8) {
      systemFamily = "industrial_process";
      primarySystem = "Process make-up air + exhaust with dedicated cooling recirculation zones";
      secondaries.push("Separate process / make-up air fan system");
      secondaries.push(diffuserLayout.isIndustrialMode ? "Jet / nozzle air distribution" : "High-throw industrial terminals");
      reasons.push("process or ACH airflow is too significant to be treated as a comfort-only air system");
      reasons.push("industrial load profile favors dedicated ventilation and separate cooling control");
    } else if (isIndustrial) {
      systemFamily = "industrial_recirculation";
      primarySystem = zoning.zoneCount > 1
        ? "Zoned industrial recirculation AHU system"
        : "Single-zone industrial recirculation AHU system";
      secondaries.push("General ventilation integrated with recirculated cooling air");
      secondaries.push(diffuserLayout.isIndustrialMode ? "Jet / nozzle air distribution" : "High-throw industrial terminals");
      reasons.push("the space is industrial in character, but the current load set does not include a significant separate process-air duty");
      reasons.push("recirculated cooling with controlled general ventilation is more appropriate than a full process make-up / exhaust system");
    } else if (oaFraction > 0.35) {
      systemFamily = "doas_zoned";
      primarySystem = zoning.zoneCount > 1 ? "DOAS + zoned AHU / FCU comfort system" : "DOAS + single-zone AHU comfort system";
      secondaries.push("Dedicated outdoor air pre-treatment");
      reasons.push("outdoor-air fraction is high enough to justify separating ventilation from recirculated cooling");
    } else if (trFinal <= 12 && zoning.zoneCount <= 2 && area <= 140) {
      systemFamily = "light_commercial";
      primarySystem = zoning.zoneCount > 1 ? "Zoned VRF / DX comfort system" : "Single packaged DX / AHU comfort system";
      reasons.push("moderate capacity and room scale are suitable for light-commercial comfort equipment");
    } else {
      systemFamily = "central_comfort";
      primarySystem = zoning.zoneCount > 1 ? "Multi-zone AHU comfort system" : "Single-zone AHU comfort system";
      reasons.push("load and geometry fit a central comfort-air approach");
    }

    if (zoning.zoneCount > 1) {
      secondaries.push(zoning.zoneCount + " control zones with independent balancing / dampers");
      reasons.push("room geometry or airflow scale supports multiple control zones");
    }
    if (processAirActive && processRatio > 0.5) {
      secondaries.push("Separate process-air controls and interlocks");
    }
    if (oaFraction > 0.25) {
      secondaries.push("Heat recovery / energy recovery review");
    }

    return {
      family: systemFamily,
      primarySystem: primarySystem,
      secondarySystems: secondaries.filter(Boolean),
      reasoning: reasons.join("; "),
      confidence: airsideProfile.largeIndustrialHall || processSystemRequired || processRatio > 0.8 || oaFraction > 0.35 ? "high" : isIndustrial ? "medium" : "medium",
      requiresProcessSystem: processSystemRequired || processRatio > 0.8,
      usesZoning: zoning.zoneCount > 1
    };
  }

  function evaluateDesignConstraints(options) {
    const settings = options || {};
    const diffuserLayout = settings.diffuserLayout || {};
    const zoning = settings.zoning || { zoneCount: 1, limits: {} };
    const systemRecommendation = settings.systemRecommendation || {};
    const supplyDuct = settings.supplyDuctStrategy || {};
    const returnDuct = settings.returnDuctStrategy || {};
    const processDuct = settings.processDuctStrategy || {};
    const zoneDuctPlan = settings.zoneDuctPlan || null;
    const zoneAhuStrategy = settings.zoneAhuStrategy || null;
    const conditionedCFM = settings.conditionedCFM || 0;
    const processCFM = settings.processCFM || 0;
    const processRatio = safeDiv(processCFM, conditionedCFM, 0);
    const fanSpecificPower = zoneAhuStrategy && zoneAhuStrategy.aggregateSelection
      ? (zoneAhuStrategy.aggregateSelection.specificFanPowerKWPerTR || 0)
      : 0;
    const fanPowerTargets = specificFanPowerTargets(
      settings.airsideProfile,
      zoneAhuStrategy && zoneAhuStrategy.aggregateSelection && zoneAhuStrategy.aggregateSelection.ahu
        ? zoneAhuStrategy.aggregateSelection.ahu.designESP
        : settings.totalEsp
    );
    const issues = [];
    const warnings = [];
    const actions = [];
    const isIndustrial = diffuserLayout.isIndustrialMode || (settings.airsideProfile && settings.airsideProfile.type === "Industrial / process");
    if ((settings.ceilingHeight || 0) >= 7.5 && String(diffuserLayout.supplyDeviceType || "").indexOf("4-way ceiling diffuser") !== -1) {
      issues.push("high-bay spaces cannot be served properly by standard 4-way ceiling diffusers");
      actions.push("use jet nozzles, air socks, or another high-throw industrial air-distribution strategy");
    }
    const processHandledSeparately = !!(
      settings.processHandlingMode === "distributed"
      || (zoneDuctPlan && zoneDuctPlan.processHandlingMode === "distributed")
      || (processDuct && processDuct.distributed)
    );
    const comfortSupplyTempMin = 10.5;
    const industrialSupplyTempMin = 8.5;

    if (!diffuserLayout.cfmRangePass) {
      issues.push("terminal airflow per outlet is outside the defendable operating band");
      actions.push("revise zoning or terminal family before proceeding");
    }
    if (!diffuserLayout.spacingPass || !diffuserLayout.throwPass) {
      issues.push("air-distribution coverage still fails the spacing / throw checks");
      actions.push("increase zoning density or move to higher-throw industrial terminals");
    }
    if (!isIndustrial && processRatio > 1 && !processHandledSeparately) {
      issues.push("process / ACH airflow exceeds conditioned cooling airflow, so a comfort-only single-stream design is not defensible");
      actions.push("separate make-up air / exhaust from the comfort-cooling circuit");
    }
    if ((settings.supplyTemp || 0) < (isIndustrial ? industrialSupplyTempMin : comfortSupplyTempMin)) {
      warnings.push("required supply temperature is unusually low and should be checked against coil ADP, condensation control, and occupant comfort");
      actions.push("review supply ΔT and coil selection before final issue");
    }
    if (zoneDuctPlan && zoneDuctPlan.overallStatus === "REJECT") {
      issues.push("zone-wise duct sizing exceeds the enforced fabrication, trunk-count, or velocity limits");
      actions.push("split the system or revise zone grouping before issue");
    } else if (zoneDuctPlan && zoneDuctPlan.overallStatus === "WARNING") {
      warnings.push("zone-wise duct design is workable but sits near practical size / velocity limits");
    }
    if ((supplyDuct.trunkCount || 1) > (isIndustrial ? 10 : 8)) {
      warnings.push("main supply duct strategy requires many parallel trunks");
      actions.push("consider additional zoning or alternate routing to simplify installation");
    }
    if ((returnDuct.trunkCount || 1) > (isIndustrial ? 10 : 8)) {
      warnings.push("return-air distribution is complex and may be difficult to balance");
    }
    if (processDuct && !processHandledSeparately && (processDuct.trunkCount || 1) > 8) {
      warnings.push("process / make-up air routing is extensive and should be coordinated as a dedicated system");
    }
    if (zoning.zoneCount >= (zoning.limits && zoning.limits.maxZones || 8) && (!diffuserLayout.spacingPass || !diffuserLayout.throwPass)) {
      issues.push("even the maximum practical zoning density does not make the air distribution feasible");
      actions.push("change system type or revise room process assumptions");
    }
    if (zoneAhuStrategy && zoning.zoneCount > 1 && zoneAhuStrategy.mode === "single_ahu") {
      warnings.push("multiple enforced zones are still being served by a single AHU strategy; verify controllability and balancing");
    }
    if (zoneAhuStrategy && fanSpecificPower > fanPowerTargets.warning) {
      warnings.push("specific fan power is high for the selected zone / AHU strategy");
      actions.push("reduce static pressure or split the air path more intelligently");
    }
    if (processRatio > 5) {
      warnings.push("process airflow is several times larger than conditioned airflow, so annual energy will be dominated by ventilation rather than cooling");
    }
    if (systemRecommendation.requiresProcessSystem && processRatio < 0.25) {
      warnings.push("automatic system recommendation is conservative; verify whether the room is truly process-driven");
    }

    const correctedDesignAvailable = !!(
      processHandledSeparately
      && diffuserLayout.cfmRangePass
      && diffuserLayout.spacingPass
      && diffuserLayout.throwPass
      && (!zoneDuctPlan || zoneDuctPlan.overallStatus !== "REJECT")
      && (!zoneAhuStrategy || !zoneAhuStrategy.aggregateSelection || !zoneAhuStrategy.aggregateSelection.ahu || zoneAhuStrategy.aggregateSelection.ahu.adequate)
    );

    const correctionApplied = correctedDesignAvailable && issues.length > 0;
    if (correctionApplied) {
      issues.length = 0;
      actions.length = 0;
    }

    const status = issues.length ? "REJECTED" : warnings.length ? "REVIEW" : "APPROVED";
    const summary = issues.length
      ? "Current design intent is not physically defendable without redesign."
      : warnings.length
        ? (correctedDesignAvailable
            ? "Corrected zoning and separate process-air strategy make the design physically defendable, but a few engineering notes still need review."
            : "Current design is workable, but key engineering constraints need review.")
        : (correctionApplied
            ? "Corrected zoning and separate process-air strategy now make the design physically defendable and internally consistent."
            : "Current design stays within the enforced zoning, terminal, and installation constraints.");

    return {
      status: status,
      rejected: issues.length > 0,
      issues: issues,
      warnings: warnings,
      actions: actions.filter(function (value, index, list) { return list.indexOf(value) === index; }),
      summary: summary
    };
  }

  function baseZoneList(autoZoning, length, width, conditionedCFM, processCFM, trFinal) {
    if (autoZoning && Array.isArray(autoZoning.zones) && autoZoning.zones.length) {
      return autoZoning.zones.slice();
    }
    return [{
      id: "zone-1",
      name: "Zone 1",
      row: 1,
      col: 1,
      x0: 0,
      y0: 0,
      length: roundTo(length, 2),
      width: roundTo(width, 2),
      area: roundTo(length * width, 2),
      conditionedCFM: roundTo(conditionedCFM, 1),
      processCFM: roundTo(processCFM, 1),
      trFinal: roundTo(trFinal, 2)
    }];
  }

  function buildDistributedProcessAirStrategy(zoneProcessCFM, zone, settings) {
    const localizedCapture = settings.airsideProfile && settings.airsideProfile.processVentilationStrategy === "localized_capture";
    const deviceTargetCFM = localizedCapture
      ? 18000
      : settings.airsideProfile && settings.airsideProfile.type === "Industrial / process"
        ? 12000
        : 1800;
    const deviceCount = Math.max(1, Math.ceil(Math.max(zoneProcessCFM || 0, 0) / deviceTargetCFM));
    const cfmPerDevice = roundTo(safeDiv(zoneProcessCFM, deviceCount, 0), 0);
    const deviceType = localizedCapture
      ? "Localized exhaust / roof extractor module"
      : settings.airsideProfile && settings.airsideProfile.type === "Industrial / process"
        ? "Axial fan + louver / exhaust point"
      : "Make-up air louver / exhaust fan";

    return {
      distributed: true,
      kind: "exhaust",
      kindLabel: localizedCapture ? "Localized process exhaust" : "Process / exhaust",
      trunkCount: 0,
      requiredTrunks: 0,
      totalCFM: roundTo(zoneProcessCFM, 0),
      perTrunkCFM: 0,
      velocityFpm: 0,
      velocityMps: 0,
      trunkDuct: null,
      metrics: null,
      validationStatus: "OK",
      validationMessages: ["process air is handled as distributed ventilation, not a full duct trunk network"],
      bestAlternative: "",
      targetSystems: 1,
      targetSystemCFM: roundTo(zoneProcessCFM, 0),
      targetTrunksPerSystem: 0,
      deviceType: deviceType,
      deviceCount: deviceCount,
      cfmPerDevice: cfmPerDevice,
      reason: localizedCapture
        ? "Localized exhaust strategy selected for " + zone.name + " so the hall is not treated as a full-volume process-air duct system."
        : "Distributed process-air strategy selected for " + zone.name + " to avoid impractical duct trunk counts."
    };
  }

  function buildZonewiseDuctPlan(options) {
    const settings = options || {};
    const zones = baseZoneList(settings.autoZoning, settings.length, settings.width, settings.conditionedCFM, settings.processCFM, settings.trFinal);
    const layoutById = {};
    const totalReturnCFM = settings.returnCFM == null
      ? Math.max((settings.conditionedCFM || 0) - (settings.oaCFM || 0), (settings.conditionedCFM || 0) * 0.7)
      : settings.returnCFM;
    const distributeProcessAir = !!settings.distributeProcessAir;
    ((settings.diffuserLayout && settings.diffuserLayout.zones) || []).forEach(function (zoneLayout) {
      layoutById[zoneLayout.id] = zoneLayout;
    });

    const frictionPaPerFt = FRICTION_RATE * 0.3048;
    const zonePlans = zones.map(function (zone) {
      const zoneLayout = layoutById[zone.id] || null;
      const zoneSupplyCFM = zone.conditionedCFM || 0;
      const zoneProcessCFM = zone.processCFM || 0;
      const zoneReturnCFM = settings.conditionedCFM > 0
        ? roundTo(totalReturnCFM * safeDiv(zoneSupplyCFM, settings.conditionedCFM, 0), 1)
        : Math.max(zoneSupplyCFM * 0.7, 0);
      const ductLengthFt = (zone.length + zone.width) * 3.28084 * 1.22;
      const ductFriction = frictionPaPerFt * ductLengthFt;
      const fittingLoss = ductFriction * 0.52;
      const localEquipmentLoss = settings.equipmentLoss + (zoneLayout && zoneLayout.diffuserCount > 8 ? 10 : 0);
      const totalEsp = ductFriction + fittingLoss + localEquipmentLoss;
      const supplySingle = ductSize(zoneSupplyCFM, settings.mainVelocityFpm);
      const returnSingle = ductSize(zoneReturnCFM, settings.returnVelocityFpm);
      const processSingle = zoneProcessCFM > 0 && !distributeProcessAir ? ductSize(zoneProcessCFM, settings.processVelocityFpm) : null;
      const supply = buildDuctStrategy(zoneSupplyCFM, settings.mainVelocityFpm, supplySingle, 1, Object.assign({}, settings.supplyOptions, {
        kind: "supply",
        zoneLabel: zone.name
      }));
      const returnAir = buildDuctStrategy(zoneReturnCFM, settings.returnVelocityFpm, returnSingle, 1, Object.assign({}, settings.returnOptions, {
        kind: "return",
        zoneLabel: zone.name
      }));
      const processAir = zoneProcessCFM > 0
        ? (distributeProcessAir
            ? buildDistributedProcessAirStrategy(zoneProcessCFM, zone, settings)
            : processSingle
              ? buildDuctStrategy(zoneProcessCFM, settings.processVelocityFpm, processSingle, 1, Object.assign({}, settings.processOptions, {
                  kind: "exhaust",
                  zoneLabel: zone.name
                }))
              : null)
        : null;
      const branchCFM = zoneLayout && zoneLayout.diffuserCount
        ? zoneSupplyCFM / zoneLayout.diffuserCount
        : settings.branchCFM;
      const branch = ductSize(branchCFM, settings.branchVelocityFpm);
      const validationStatus = [supply.validationStatus, returnAir.validationStatus, processAir && processAir.validationStatus].filter(Boolean).reduce(mergeStatuses, "OK");
      const validationMessages = []
        .concat(supply.validationMessages || [])
        .concat(returnAir.validationMessages || [])
        .concat(processAir ? processAir.validationMessages || [] : []);

      return {
        id: zone.id,
        name: zone.name,
        row: zone.row,
        col: zone.col,
        length: zone.length,
        width: zone.width,
        area: zone.area,
        conditionedCFM: zoneSupplyCFM,
        processCFM: zoneProcessCFM,
        returnCFM: zoneReturnCFM,
        trFinal: zone.trFinal,
        ductLengthFt: ductLengthFt,
        ductFriction: ductFriction,
        fittingLoss: fittingLoss,
        equipmentLoss: localEquipmentLoss,
        totalEsp: totalEsp,
        supply: supply,
        return: returnAir,
        process: processAir,
        branch: branch,
        branchCFM: branchCFM,
        diffuserCount: zoneLayout ? zoneLayout.diffuserCount : 0,
        validationStatus: validationStatus,
        validationMessages: validationMessages
      };
    });

    const overallStatus = zonePlans.map(function (zone) {
      return zone.validationStatus;
    }).reduce(mergeStatuses, "OK");
    const totalSupplyTrunks = zonePlans.reduce(function (sum, zone) { return sum + ((zone.supply && zone.supply.trunkCount) || 0); }, 0);
    const totalReturnTrunks = zonePlans.reduce(function (sum, zone) { return sum + ((zone.return && zone.return.trunkCount) || 0); }, 0);
    const totalProcessTrunks = distributeProcessAir ? 0 : zonePlans.reduce(function (sum, zone) { return sum + ((zone.process && zone.process.trunkCount) || 0); }, 0);
    const maxZoneESP = zonePlans.reduce(function (maxValue, zone) {
      return Math.max(maxValue, zone.totalEsp || 0);
    }, 0);
    const maxProcessESP = distributeProcessAir
      ? (settings.airsideProfile && settings.airsideProfile.recommendedProcessStaticPa
          ? settings.airsideProfile.recommendedProcessStaticPa
          : settings.airsideProfile && settings.airsideProfile.type === "Industrial / process" ? 180 : 120)
      : zonePlans.reduce(function (maxValue, zone) {
          return Math.max(maxValue, zone.process ? zone.totalEsp || 0 : 0);
        }, 0);
    const aggregateSupply = totalSupplyTrunks > 0
      ? buildDuctStrategy(settings.conditionedCFM, settings.mainVelocityFpm, ductSize(Math.max(settings.conditionedCFM, 1), settings.mainVelocityFpm), totalSupplyTrunks, Object.assign({}, settings.supplyOptions, {
          kind: "supply",
          maxTrunksAllowed: Math.max(MAX_TRUNKS_PER_AHU, totalSupplyTrunks)
        }))
      : null;
    const aggregateReturn = totalReturnTrunks > 0
      ? buildDuctStrategy(totalReturnCFM, settings.returnVelocityFpm, ductSize(Math.max(totalReturnCFM, 1), settings.returnVelocityFpm), totalReturnTrunks, Object.assign({}, settings.returnOptions, {
          kind: "return",
          maxTrunksAllowed: Math.max(MAX_TRUNKS_PER_AHU, totalReturnTrunks)
        }))
      : null;
    const aggregateProcess = settings.processCFM > 0
      ? (distributeProcessAir
          ? {
              distributed: true,
              kind: "exhaust",
              kindLabel: "Process / exhaust",
              trunkCount: 0,
              requiredTrunks: 0,
              totalCFM: roundTo(settings.processCFM, 0),
              perTrunkCFM: 0,
              velocityFpm: 0,
              velocityMps: 0,
              trunkDuct: null,
              metrics: null,
              validationStatus: "OK",
              validationMessages: ["process air is handled by distributed axial fans / louvers / exhaust points"],
              bestAlternative: "",
              targetSystems: Math.max(1, zonePlans.length),
              targetSystemCFM: roundTo(safeDiv(settings.processCFM, Math.max(zonePlans.length, 1), 0), 0),
              targetTrunksPerSystem: 0,
              deviceType: settings.airsideProfile && settings.airsideProfile.processVentilationStrategy === "localized_capture"
                ? "Localized exhaust / roof extractor modules"
                : settings.airsideProfile && settings.airsideProfile.type === "Industrial / process"
                  ? "Axial fans + wall / roof exhaust"
                : "Louvers + exhaust fans",
              deviceCount: zonePlans.reduce(function (sum, zone) {
                return sum + ((zone.process && zone.process.deviceCount) || 0);
              }, 0),
              cfmPerDevice: roundTo(safeDiv(settings.processCFM, Math.max(zonePlans.reduce(function (sum, zone) {
                return sum + ((zone.process && zone.process.deviceCount) || 0);
              }, 0), 1), 0), 0),
              reason: settings.airsideProfile && settings.airsideProfile.processVentilationStrategy === "localized_capture"
                ? "Process airflow is treated as localized capture / make-up air, not a full-volume ducted hall system."
                : "Process air is intentionally not routed as a full duct trunk network."
            }
          : totalProcessTrunks > 0
            ? buildDuctStrategy(settings.processCFM, settings.processVelocityFpm, ductSize(Math.max(settings.processCFM, 1), settings.processVelocityFpm), totalProcessTrunks, Object.assign({}, settings.processOptions, {
                kind: "exhaust",
                maxTrunksAllowed: Math.max(MAX_TRUNKS_PER_AHU, totalProcessTrunks)
              }))
            : null)
      : null;

    return {
      zones: zonePlans,
      zoneCount: zonePlans.length,
      maxZoneESP: maxZoneESP,
      maxProcessESP: maxProcessESP,
      totalSupplyTrunks: totalSupplyTrunks,
      totalReturnTrunks: totalReturnTrunks,
      totalProcessTrunks: totalProcessTrunks,
      processHandlingMode: distributeProcessAir ? "distributed" : "ducted",
      overallStatus: overallStatus,
      aggregate: {
        supply: aggregateSupply,
        return: aggregateReturn,
        process: aggregateProcess
      },
      summary: (zonePlans.length > 1
        ? zonePlans.length + " zone ducts generated from the enforced zoning plan. "
        : "Single-zone duct layout is adequate. ")
        + "Supply trunks: " + totalSupplyTrunks + ", return trunks: " + totalReturnTrunks
        + (aggregateProcess
          ? (distributeProcessAir
              ? (settings.airsideProfile && settings.airsideProfile.processVentilationStrategy === "localized_capture"
                  ? ", process air via localized exhaust / make-up modules"
                  : ", process air via distributed fans / louvers")
              : ", process trunks: " + totalProcessTrunks)
          : "")
    };
  }

  function buildZoneAhuStrategy(options) {
    const settings = options || {};
    const zones = (settings.zoneDuctPlan && settings.zoneDuctPlan.zones) || [];
    const processRatio = safeDiv(settings.processCFM, settings.conditionedCFM, 0);
    const industrial = settings.airsideProfile && settings.airsideProfile.type === "Industrial / process";
    const largeIndustrialHall = !!(settings.airsideProfile && settings.airsideProfile.largeIndustrialHall);
    const maxZonesPerCluster = largeIndustrialHall ? 6 : industrial ? 4 : 3;
    const targetMinMargin = Math.max(settings.preferredMargin || 0.1, largeIndustrialHall ? 0.12 : 0.15);
    const targetMaxMargin = 0.25;
    const targetMidMargin = (targetMinMargin + targetMaxMargin) / 2;
    const clusterSelectionCache = {};

    function clusterFromZones(zoneList) {
      return zoneList.reduce(function (cluster, zone) {
        cluster.zones.push(zone);
        cluster.trFinal += zone.trFinal || 0;
        cluster.conditionedCFM += zone.conditionedCFM || 0;
        cluster.processCFM += zone.processCFM || 0;
        cluster.peakESP = Math.max(cluster.peakESP, zone.totalEsp || 0);
        cluster.supplyTrunks += (zone.supply && zone.supply.trunkCount) || 1;
        return cluster;
      }, {
        zones: [],
        trFinal: 0,
        conditionedCFM: 0,
        processCFM: 0,
        peakESP: 0,
        supplyTrunks: 0
      });
    }

    function buildClusterSelection(cluster, index, totalClusters) {
      const cacheKey = cluster.startIndex + ":" + cluster.endIndex;
      const cached = clusterSelectionCache[cacheKey];
      if (cached) {
        return Object.assign({}, cached, {
          id: "cluster-" + (index + 1),
          name: totalClusters === 1
            ? "Primary AHU"
            : cached.zoneCount === 1
              ? cached.zoneNames[0] + " AHU"
              : "AHU Cluster " + (index + 1)
        });
      }

      const zoneNames = cluster.zones.map(function (zone) { return zone.name; });
      const clusterTR = Math.max(roundTo(cluster.trFinal || 0, 2), 0);
      const clusterCFM = Math.max(roundTo(cluster.conditionedCFM || 0, 1), 0);
      const clusterESP = Math.max(cluster.peakESP || 0, 0) + (cluster.zones.length > 1 ? 35 : 0);
      const selection = EquipmentEngine.selectSystem(clusterTR, clusterCFM, clusterESP, {
        catalogTR: nextStandardTR(clusterTR),
        designCFMPerTR: safeDiv(clusterCFM, Math.max(clusterTR, 0.1), 400),
        preferredMargin: settings.preferredMargin,
        airflowConstraint: settings.coolingAirflowConstraint,
        maxCoolingUnitCount: 1,
        maxAirSectionsAllowed: cluster.zones.length > 1 || largeIndustrialHall ? 6 : 4
      });

      const clusterSelection = {
        startIndex: cluster.startIndex,
        endIndex: cluster.endIndex,
        zoneNames: zoneNames,
        zoneCount: cluster.zones.length,
        trFinal: clusterTR,
        conditionedCFM: clusterCFM,
        processCFM: Math.max(roundTo(cluster.processCFM || 0, 1), 0),
        peakESP: clusterESP,
        supplyTrunks: cluster.supplyTrunks,
        selection: selection
      };

      clusterSelectionCache[cacheKey] = clusterSelection;

      return Object.assign({}, clusterSelection, {
        id: "cluster-" + (index + 1),
        name: totalClusters === 1
          ? "Primary AHU"
          : cluster.zones.length === 1
            ? zoneNames[0] + " AHU"
            : "AHU Cluster " + (index + 1)
      });
    }

    function evaluatePartition(clusterSet) {
      const normalizedClusters = clusterSet.map(function (cluster, index) {
        return buildClusterSelection(cluster, index, clusterSet.length);
      });
      const totalCapacityTR = normalizedClusters.reduce(function (sum, cluster) {
        return sum + (cluster.selection.ahu.capacityTR || 0);
      }, 0);
      const aggregateMargin = safeDiv(totalCapacityTR - settings.trFinal, Math.max(settings.trFinal, 0.1), 0);
      const maxClusterMargin = normalizedClusters.reduce(function (maxValue, cluster) {
        return Math.max(maxValue, safeDiv(cluster.selection.ahu.reserveTR, Math.max(cluster.trFinal, 0.1), 0));
      }, 0);
      const inadequateCount = normalizedClusters.reduce(function (sum, cluster) {
        return sum + (cluster.selection.ahu.adequate ? 0 : 1);
      }, 0);
      const outOfRangeFanCount = normalizedClusters.reduce(function (sum, cluster) {
        return sum + (cluster.selection.fan.withinRange ? 0 : 1);
      }, 0);
      const airSectionPenalty = normalizedClusters.reduce(function (sum, cluster) {
        return sum + Math.max(0, (cluster.selection.ahu.airSectionCount || 1) - 1);
      }, 0);
      const zoneSpreadPenalty = normalizedClusters.reduce(function (sum, cluster) {
        return sum + Math.max(0, cluster.zoneCount - (largeIndustrialHall ? 4 : industrial ? 3 : 2));
      }, 0);
      const highMarginPenalty = aggregateMargin > targetMaxMargin
        ? (aggregateMargin - targetMaxMargin) * 280
        : Math.abs(aggregateMargin - targetMidMargin) * 16;
      const lowMarginPenalty = aggregateMargin < targetMinMargin
        ? (targetMinMargin - aggregateMargin) * 48
        : 0;
      const clusterCountPenalty = Math.max(0, normalizedClusters.length - 1) * (largeIndustrialHall ? 0.55 : industrial ? 0.4 : 0.25);
      const extremeClusterPenalty = Math.max(0, maxClusterMargin - 0.32) * 90;
      const totalScore = highMarginPenalty
        + lowMarginPenalty
        + inadequateCount * 50
        + outOfRangeFanCount * 18
        + airSectionPenalty * 0.3
        + zoneSpreadPenalty * 0.4
        + clusterCountPenalty
        + extremeClusterPenalty;

      return {
        normalizedClusters: normalizedClusters,
        totalCapacityTR: totalCapacityTR,
        aggregateMargin: aggregateMargin,
        totalScore: totalScore
      };
    }

    if (!zones.length) {
      const fallbackSelection = EquipmentEngine.selectSystem(settings.trFinal || 0, settings.conditionedCFM || 0, settings.totalEsp || 0, {
        catalogTR: settings.trCatalog || nextStandardTR(settings.trFinal || 0),
        designCFMPerTR: safeDiv(settings.conditionedCFM || 0, Math.max(settings.trFinal || 0, 0.1), 400),
        preferredMargin: settings.preferredMargin,
        airflowConstraint: settings.coolingAirflowConstraint,
        maxCoolingUnitCount: 1,
        maxAirSectionsAllowed: 4
      });
      return {
        mode: "single_ahu",
        modeLabel: "Single AHU",
        zoneCount: 0,
        clusterCount: 1,
        maxClusterESP: settings.totalEsp || 0,
        clusters: [],
        aggregateSelection: fallbackSelection,
        summary: "Fallback AHU strategy applied because no zone duct data was available."
      };
    }
    const clusterMemo = {};

    function canCreateCluster(startIndex, endIndex) {
      if (endIndex < startIndex) {
        return false;
      }
      const zoneList = zones.slice(startIndex, endIndex + 1);
      const cluster = clusterFromZones(zoneList);
      return cluster.supplyTrunks <= MAX_TRUNKS_PER_AHU
        && zoneList.length <= maxZonesPerCluster;
    }

    function getClusterCandidate(startIndex, endIndex) {
      const key = startIndex + ":" + endIndex;
      if (Object.prototype.hasOwnProperty.call(clusterMemo, key)) {
        return clusterMemo[key];
      }
      if (!canCreateCluster(startIndex, endIndex)) {
        clusterMemo[key] = null;
        return null;
      }
      const cluster = clusterFromZones(zones.slice(startIndex, endIndex + 1));
      cluster.startIndex = startIndex;
      cluster.endIndex = endIndex;
      clusterMemo[key] = cluster;
      return cluster;
    }

    const partitions = [];

    function searchPartitions(startIndex, current) {
      if (startIndex >= zones.length) {
        partitions.push(current.slice());
        return;
      }

      for (let endIndex = startIndex; endIndex < zones.length; endIndex += 1) {
        const candidate = getClusterCandidate(startIndex, endIndex);
        if (!candidate) {
          break;
        }
        current.push(candidate);
        searchPartitions(endIndex + 1, current);
        current.pop();
      }
    }

    searchPartitions(0, []);

    const bestPartition = (partitions.length ? partitions : [[clusterFromZones(zones)]])
      .map(evaluatePartition)
      .sort(function (left, right) {
        if (left.totalScore !== right.totalScore) {
          return left.totalScore - right.totalScore;
        }
        if (left.aggregateMargin !== right.aggregateMargin) {
          return Math.abs(left.aggregateMargin - targetMidMargin) - Math.abs(right.aggregateMargin - targetMidMargin);
        }
        return left.normalizedClusters.length - right.normalizedClusters.length;
      })[0];

    const normalizedClusters = bestPartition.normalizedClusters;

    const fanTypeCounts = {};
    const modelCounts = {};
    const fanCurveIds = {};
    normalizedClusters.forEach(function (cluster) {
      const type = cluster.selection.fan.type || "Unknown";
      fanTypeCounts[type] = (fanTypeCounts[type] || 0) + 1;
      const model = cluster.selection.ahu.model || "AHU";
      modelCounts[model] = (modelCounts[model] || 0) + 1;
      if (cluster.selection.fan.curveId) {
        fanCurveIds[cluster.selection.fan.curveId] = true;
      }
    });
    const dominantFanType = Object.keys(fanTypeCounts).sort(function (left, right) {
      return fanTypeCounts[right] - fanTypeCounts[left];
    })[0] || "Forward Curved";
    const fanTypesUsed = Object.keys(fanTypeCounts);
    const deployedModels = Object.keys(modelCounts).map(function (model) {
      return modelCounts[model] > 1 ? modelCounts[model] + " x " + model : model;
    });
    const totalCapacityTR = normalizedClusters.reduce(function (sum, cluster) {
      return sum + (cluster.selection.ahu.capacityTR || 0);
    }, 0);
    const totalCoolingUnits = normalizedClusters.reduce(function (sum, cluster) {
      return sum + (cluster.selection.ahu.coolingUnitCount || 1);
    }, 0);
    const totalMotorKW = normalizedClusters.reduce(function (sum, cluster) {
      return sum + (cluster.selection.recommendedMotorKW || 0);
    }, 0);
    const totalBrakeKW = normalizedClusters.reduce(function (sum, cluster) {
      return sum + (cluster.selection.fan.brakeKWTotal || 0);
    }, 0);
    const totalElectricalFanKW = normalizedClusters.reduce(function (sum, cluster) {
      return sum + (cluster.selection.fan.electricalKWTotal || cluster.selection.recommendedMotorKW || 0);
    }, 0);
    const totalNominalAirflow = normalizedClusters.reduce(function (sum, cluster) {
      return sum + (cluster.selection.ahu.coolingNominalAirflowCFM || 0);
    }, 0);
    const totalAirSections = normalizedClusters.reduce(function (sum, cluster) {
      return sum + ((cluster.selection.ahu.airSectionCount || 1));
    }, 0);
    const totalFanUnits = normalizedClusters.reduce(function (sum, cluster) {
      return sum + ((cluster.selection.fan.unitCount || cluster.selection.ahu.airSectionCount || 1));
    }, 0);
    const maxClusterESP = normalizedClusters.reduce(function (maxValue, cluster) {
      return Math.max(maxValue, cluster.peakESP || 0);
    }, 0);
    const allAdequate = normalizedClusters.every(function (cluster) {
      return !!cluster.selection.ahu.adequate;
    });
    const allPreferred = normalizedClusters.every(function (cluster) {
      return !!cluster.selection.ahu.meetsMarginTarget;
    });
    const clusterMode = normalizedClusters.length <= 1
      ? "single_ahu"
      : normalizedClusters.length === zones.length
        ? "ahu_per_zone"
        : "clustered_multi_zone";
    const modeLabel = clusterMode === "single_ahu"
      ? "Single AHU"
      : clusterMode === "ahu_per_zone"
        ? "One AHU per zone"
        : "Clustered multi-zone AHUs";

    const aggregateSelection = {
      ahu: {
        model: normalizedClusters.length === 1
          ? normalizedClusters[0].selection.ahu.model
          : deployedModels.length
            ? deployedModels.join(" + ")
            : modeLabel,
        capacityTR: roundTo(totalCapacityTR, 2),
        coolingNominalAirflowCFM: roundTo(totalNominalAirflow, 0),
        requiredTRFinal: settings.trFinal,
        requiredCatalogTR: settings.trCatalog,
        preferredTargetTR: roundTo(settings.trFinal * (1 + settings.preferredMargin), 2),
        minAirflowCFM: roundTo(totalNominalAirflow * 0.7, 0),
        maxAirflowCFM: roundTo(totalNominalAirflow * 1.2, 0),
        minAirflowCFMPerUnit: roundTo(normalizedClusters.reduce(function (minValue, cluster) {
          return Math.min(minValue, cluster.selection.ahu.minAirflowCFMPerUnit || cluster.selection.ahu.minAirflowCFM || cluster.conditionedCFM);
        }, Infinity), 0),
        maxAirflowCFMPerUnit: roundTo(normalizedClusters.reduce(function (maxValue, cluster) {
          return Math.max(maxValue, cluster.selection.ahu.maxAirflowCFMPerUnit || cluster.selection.ahu.maxAirflowCFM || cluster.conditionedCFM);
        }, 0), 0),
        perUnitDutyCFM: roundTo(normalizedClusters.reduce(function (maxValue, cluster) {
          return Math.max(maxValue, cluster.selection.ahu.perUnitDutyCFM || cluster.conditionedCFM);
        }, 0), 0),
        reserveTR: roundTo(totalCapacityTR - settings.trFinal, 2),
        reserveCFM: roundTo(totalNominalAirflow - settings.conditionedCFM, 0),
        reserveESP: roundTo(normalizedClusters.reduce(function (minValue, cluster) {
          return Math.min(minValue, (cluster.selection.ahu.reserveESP || 0));
        }, Infinity), 0),
        adequate: allAdequate,
        meetsMarginTarget: allPreferred,
        marginPercent: roundTo(bestPartition.aggregateMargin * 100, 1),
        coolingUnitCount: totalCoolingUnits,
        airSectionCount: totalAirSections,
        unitCount: normalizedClusters.length,
        clusterCount: normalizedClusters.length,
        designCFMPerTR: roundTo(safeDiv(settings.conditionedCFM, Math.max(settings.trFinal, 0.1), 0), 0),
        designESP: roundTo(maxClusterESP, 0),
        airflowMultiplier: roundTo(safeDiv(settings.conditionedCFM, Math.max(totalNominalAirflow, 1), 1), 2),
        sizingBasis: "Zone-wise AHU deployment selected from per-zone / per-cluster airflow and ESP",
        selectionNote: modeLabel + " serving " + zones.length + " zone(s)",
        deploymentMode: clusterMode,
        deployedModels: deployedModels,
        deploymentSummary: normalizedClusters.map(function (cluster) {
          return cluster.name + " -> " + cluster.zoneNames.join(", ") + " (" + cluster.selection.ahu.model + ")";
        }).join(" | ")
      },
      fan: {
        type: fanTypesUsed.length === 1 ? dominantFanType : "Mixed",
        preferredType: dominantFanType,
        curveId: Object.keys(fanCurveIds).join(", "),
        withinRange: normalizedClusters.every(function (cluster) { return cluster.selection.fan.withinRange; }),
        dutyCFM: roundTo(normalizedClusters.reduce(function (maxValue, cluster) {
          return Math.max(maxValue, cluster.selection.fan.dutyCFM || cluster.conditionedCFM);
        }, 0), 0),
        brakeKW: roundTo(normalizedClusters.reduce(function (maxValue, cluster) {
          return Math.max(maxValue, cluster.selection.fan.brakeKW || 0);
        }, 0), 2),
        brakeKWTotal: roundTo(totalBrakeKW, 2),
        motorKW: roundTo(normalizedClusters.reduce(function (maxValue, cluster) {
          return Math.max(maxValue, cluster.selection.fan.motorKW || 0);
        }, 0), 2),
        unitCount: totalFanUnits,
        typesUsed: fanTypesUsed,
        selectionNote: normalizedClusters.length === 1
          ? normalizedClusters[0].selection.fan.selectionNote
          : modeLabel + " fan strategy based on deployed cluster duty points."
      },
      recommendedMotorKWPerUnit: roundTo(normalizedClusters.reduce(function (maxValue, cluster) {
        return Math.max(maxValue, cluster.selection.recommendedMotorKWPerUnit || 0);
      }, 0), 2),
      recommendedMotorKW: roundTo(totalMotorKW, 2),
      electricalFanKWTotal: roundTo(totalElectricalFanKW, 2),
      specificFanPowerKWPerTR: roundTo(safeDiv(totalElectricalFanKW, Math.max(settings.trFinal, 0.1), 0), 2),
      installedMotorSpecificFanPowerKWPerTR: roundTo(safeDiv(totalMotorKW, Math.max(settings.trFinal, 0.1), 0), 2),
      airflowPenaltyRatio: roundTo(safeDiv(settings.conditionedCFM, Math.max(totalNominalAirflow, 1), 1), 2),
      airflowPenaltyPercent: roundTo(Math.max(0, (safeDiv(settings.conditionedCFM, Math.max(totalNominalAirflow, 1), 1) - 1) * 100), 1),
      optimizationNote: modeLabel + " selected to align AHU deployment with zoning and duct practicality."
    };

    return {
      mode: clusterMode,
      modeLabel: modeLabel,
      zoneCount: zones.length,
      clusterCount: normalizedClusters.length,
      maxClusterESP: maxClusterESP,
      clusters: normalizedClusters,
      aggregateSelection: aggregateSelection,
      summary: modeLabel + " selected from zone count, supply trunk count, and aggregate reserve-margin optimization."
    };
  }

  function buildEnergyOptimizationPlan(options) {
    const settings = options || {};
    const suggestions = [];
    const warningMessages = [];
    const advisories = [];
    const zoneAhuStrategy = settings.zoneAhuStrategy || { mode: "single_ahu", aggregateSelection: {} };
    const zoneDuctPlan = settings.zoneDuctPlan || { overallStatus: "OK", zones: [] };
    const specificFanPower = zoneAhuStrategy.aggregateSelection.specificFanPowerKWPerTR || 0;
    const installedMotorSpecificFanPower = zoneAhuStrategy.aggregateSelection.installedMotorSpecificFanPowerKWPerTR || specificFanPower;
    const processRatio = safeDiv(settings.processCFM, settings.conditionedCFM, 0);
    const fanPowerTargets = specificFanPowerTargets(
      settings.airsideProfile,
      zoneAhuStrategy.aggregateSelection && zoneAhuStrategy.aggregateSelection.ahu
        ? zoneAhuStrategy.aggregateSelection.ahu.designESP
        : 0
    );
    const highTrunkLoading = ((zoneDuctPlan.zones || []).some(function (zone) {
      return (zone.supply && zone.supply.perTrunkCFM > 3500)
        || (zone.return && zone.return.perTrunkCFM > 3500);
    }));

    if (zoneAhuStrategy.mode !== "single_ahu") {
      suggestions.push("Use VFD control and scheduling on each zone or cluster AHU to capture part-load fan savings.");
    }
    if (specificFanPower > fanPowerTargets.warning) {
      warningMessages.push("Specific fan power is high for this duty point. Review static pressure, terminal losses, or fan operating point.");
      suggestions.push("Specific fan power is high. Reduce static pressure, shorten duct runs, or split clusters further only where trunk counts still remain practical.");
    } else if (specificFanPower > fanPowerTargets.advisory || installedMotorSpecificFanPower > fanPowerTargets.warning) {
      advisories.push("Fan energy is acceptable, but static pressure / fan tuning can still improve efficiency.");
      suggestions.push("Static pressure and fan tuning can still improve efficiency, even though the current fan energy is within an acceptable range.");
    }
    if (highTrunkLoading) {
      suggestions.push("Keep main trunks near the 3000-4000 CFM band. Lower trunk loading reduces friction, fan brake power, and balancing difficulty.");
    }
    if (processRatio > 5) {
      suggestions.push("Process airflow is more than 5x conditioned airflow. Treat this primarily as a process-ventilation energy problem, not a comfort-cooling problem.");
    } else if (processRatio > 1) {
      suggestions.push("Process / make-up air is a major energy driver. Add heat recovery or production-linked fan turndown if the process allows.");
    }
    if (settings.airsideProfile && settings.airsideProfile.processVentilationStrategy === "localized_capture") {
      suggestions.push("Large industrial halls should stay on general hall ventilation only. Use localized capture points instead of full-volume ACH for the entire floor area.");
    }
    if (settings.airsideProfile && settings.airsideProfile.heatRecoveryRecommended) {
      suggestions.push("Heat recovery is recommended on the process / make-up air path because ventilation energy is a major part of the annual load.");
    }
    if (zoneDuctPlan.overallStatus !== "OK") {
      suggestions.push("Simplify duct routing or split the system further so duct size and trunk count stay inside practical limits.");
    }
    if ((zoneDuctPlan.totalSupplyTrunks || 0) > IDEAL_MAX_TRUNKS_PER_AHU * Math.max(zoneAhuStrategy.clusterCount || 1, 1)) {
      suggestions.push("Supply trunk count is above the preferred practical range. Consider one AHU per zone or a cleaner cluster split.");
    }
    if (!suggestions.length) {
      suggestions.push("Current zone and duct strategy is already close to best practice. Focus on VFD control, commissioning, and filter management.");
    }

    const estimatedSavingsPercent = roundTo(
      (zoneAhuStrategy.mode !== "single_ahu" ? 6 : 0)
      + (specificFanPower > fanPowerTargets.warning ? 8 : specificFanPower > fanPowerTargets.advisory ? 4 : 0)
      + (highTrunkLoading ? 5 : 0)
      + (processRatio > 1 ? 10 : 0),
      0
    );

    return {
      specificFanPowerKWPerTR: roundTo(specificFanPower, 2),
      installedMotorSpecificFanPowerKWPerTR: roundTo(installedMotorSpecificFanPower, 2),
      specificFanPowerAdvisoryLimit: fanPowerTargets.advisory,
      specificFanPowerWarningLimit: fanPowerTargets.warning,
      processAirRatio: roundTo(processRatio, 2),
      estimatedSavingsPercent: estimatedSavingsPercent,
      warningMessages: warningMessages,
      advisories: advisories,
      suggestions: suggestions,
      summary: warningMessages[0] || advisories[0] || suggestions[0]
    };
  }

  function evaluateSystemSplitNeed(conditionedCFM, zoneDuctPlan, currentSystems) {
    const currentCount = Math.max(1, Math.ceil(currentSystems || 1));
    let requiredSystems = Math.max(currentCount, Math.ceil(Math.max(conditionedCFM || 0, 0) / 50000) || 1);
    const reasons = [];

    if ((conditionedCFM || 0) > 50000) {
      reasons.push("conditioned airflow exceeds 50,000 CFM");
    }

    ((zoneDuctPlan && zoneDuctPlan.zones) || []).forEach(function (zone) {
      [zone.supply, zone.return, zone.process].filter(Boolean).forEach(function (strategy) {
        const messages = strategy.validationMessages || [];
        const ductSizeExceeded = messages.some(function (message) {
          return message.indexOf("duct size exceeds the absolute") !== -1
            || message.indexOf("duct aspect ratio exceeds 4:1") !== -1
            || message.indexOf("too many trunks per AHU") !== -1;
        });
        const trunksExceeded = (strategy.trunkCount || 1) > MAX_TRUNKS_PER_AHU;

        if (ductSizeExceeded || trunksExceeded || strategy.validationStatus === "REJECT") {
          const multiplier = Math.max(2, Math.ceil((strategy.requiredTrunks || strategy.trunkCount || 1) / MAX_TRUNKS_PER_AHU));
          requiredSystems = Math.max(requiredSystems, currentCount * multiplier);
          reasons.push(ductSizeExceeded
            ? zone.name + " duct size exceeds practical fabrication limits"
            : zone.name + " needs more than " + MAX_TRUNKS_PER_AHU + " trunks");
        }
      });
    });

    return {
      redesignRequired: requiredSystems > currentCount,
      requiredSystems: requiredSystems,
      reasons: reasons.filter(function (value, index, list) {
        return list.indexOf(value) === index;
      })
    };
  }

  function airflowConstraintName(cfmThermal, cfmVent, cfmAch) {
    const maxValue = Math.max(cfmThermal, cfmVent, cfmAch);
    const tolerance = Math.max(25, maxValue * 0.02);
    const tied = [
      { key: "thermal", value: cfmThermal },
      { key: "ventilation", value: cfmVent },
      { key: "ach", value: cfmAch }
    ].filter(function (entry) {
      return Math.abs(entry.value - maxValue) <= tolerance;
    });

    if (tied.length > 1) {
      return "balanced";
    }
    return tied[0] ? tied[0].key : "thermal";
  }

  function airflowConstraintLabel(constraint) {
    if (constraint === "ventilation") {
      return "Ventilation airflow governs";
    }
    if (constraint === "ach") {
      return "ACH minimum governs";
    }
    if (constraint === "balanced") {
      return "Thermal, ventilation, and ACH duties align";
    }
    return "Thermal sensible load governs";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function ductDimensionText(duct) {
    if (!duct) {
      return "—";
    }
    if (duct.rectW && duct.rectH) {
      return duct.rectW + '" x ' + duct.rectH + '"';
    }
    if (duct.dia_in) {
      return 'Ø' + duct.dia_in + '"';
    }
    return "—";
  }

  function canvasImageMarkup(id, alt) {
    const canvas = byId(id);
    if (!canvas || typeof canvas.toDataURL !== "function") {
      return '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Graphic unavailable</p>';
    }
    try {
      const src = canvas.toDataURL("image/png");
      return '<div class="report-visual"><img src="' + src + '" alt="' + escapeHtml(alt || "Visualization") + '" style="display:block;width:100%;height:auto;border-radius:8px;"></div>';
    } catch (error) {
      return '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Graphic unavailable</p>';
    }
  }

  function currentUser() {
    return window.AuthManager ? window.AuthManager.getCurrentUser() : null;
  }

  function isAuthenticated() {
    return !!currentUser();
  }

  function isOwnerUser(user) {
    return !!(user && user.role === "owner");
  }

  function isCompanyAdminUser(user) {
    return !!(user && user.role === "admin");
  }

  function isAdminUser(user) {
    return isOwnerUser(user) || isCompanyAdminUser(user);
  }

  function userStorageScope(user) {
    return (user && user.id) || "public";
  }

  function setAuthMessage(message, state) {
    const element = byId("auth-message");
    if (!element) {
      return;
    }
    element.textContent = message || "";
    element.className = "auth-message" + (state ? " " + state : "");
  }

  function setAuthMode(mode) {
    const activeMode = mode || "login";
    document.querySelectorAll("[data-auth-mode]").forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-auth-mode") === activeMode);
    });
    [
      { id: "auth-login-form", mode: "login" },
      { id: "auth-quote-form", mode: "quote" },
      { id: "auth-demo-form", mode: "demo" },
      { id: "auth-reset-form", mode: "reset" }
    ].forEach(function (entry) {
      const form = byId(entry.id);
      if (form) {
        form.classList.toggle("active", entry.mode === activeMode);
      }
    });
  }

  function updateUserChrome(user) {
    const name = user ? user.name : "No user";
    const initials = user ? user.initials : "--";
    const sidebarCopy = user
      ? "Signed in as " + user.name + "<br>" + user.email + (user.company ? "<br>" + user.company : "")
      : "Signed out<br>Login required";

    if (byId("current-user-name")) {
      byId("current-user-name").textContent = user && user.company ? name + " · " + user.company : name;
    }
    if (byId("current-user-initials")) {
      byId("current-user-initials").textContent = initials;
    }
    if (byId("sidebar-user-copy")) {
      byId("sidebar-user-copy").innerHTML = sidebarCopy;
    }
    if (byId("logout-btn")) {
      byId("logout-btn").style.display = user ? "inline-flex" : "none";
    }
    document.body.classList.toggle("is-admin", isAdminUser(user));
    document.body.classList.toggle("is-owner", isOwnerUser(user));
    document.body.classList.toggle("is-company-admin", isCompanyAdminUser(user));
  }

  function lockWorkspace(message, state) {
    document.body.classList.add("auth-locked");
    updateUserChrome(null);
    setAuthMode("login");
    setAuthMessage(message || "Sign in to open your workspace.", state || "");
  }

  function ensureAuthenticated() {
    if (isAuthenticated()) {
      return true;
    }
    lockWorkspace("Login required to access project data.", "error");
    return false;
  }

  function captureInputs() {
    const snapshot = {};
    ROOM_FIELD_IDS.forEach(function (fieldId) {
      snapshot[fieldId] = valueOf(fieldId, DEFAULT_INPUTS[fieldId] || "");
    });
    return snapshot;
  }

  function applyInputs(snapshot) {
    const inputs = snapshot || {};
    ROOM_FIELD_IDS.forEach(function (fieldId) {
      if (inputs[fieldId] != null) {
        setValue(fieldId, inputs[fieldId]);
      } else if (DEFAULT_INPUTS[fieldId] != null) {
        setValue(fieldId, DEFAULT_INPUTS[fieldId]);
      }
    });
  }

  function readRates() {
    return {
      rate_tr: numberOf("rate_tr", DEFAULT_RATES.rate_tr),
      rate_duct: numberOf("rate_duct", DEFAULT_RATES.rate_duct),
      rate_diffuser: numberOf("rate_diffuser", DEFAULT_RATES.rate_diffuser),
      rate_return: numberOf("rate_return", DEFAULT_RATES.rate_return),
      rate_insul: numberOf("rate_insul", DEFAULT_RATES.rate_insul),
      rate_fan: numberOf("rate_fan", DEFAULT_RATES.rate_fan),
      rate_pipe: numberOf("rate_pipe", DEFAULT_RATES.rate_pipe),
      rate_bms: numberOf("rate_bms", DEFAULT_RATES.rate_bms),
      rate_install: numberOf("rate_install", DEFAULT_RATES.rate_install),
      rate_energy: numberOf("rate_energy", DEFAULT_RATES.rate_energy)
    };
  }

  function persistRateInputs(rates) {
    Object.keys(rates).forEach(function (key) {
      setValue(key, rates[key]);
    });
  }

  function deriveOutdoorRh(outdoorDryBulb, outdoorWetBulb) {
    if (typeof rhFromWBT === "function") {
      return rhFromWBT(outdoorDryBulb, outdoorWetBulb);
    }
    return numberOf("out_rh", 50);
  }

  function activePanel() {
    const current = document.querySelector(".panel.active");
    return current ? current.id.replace(/^p-/, "") : "input";
  }

  function espRowMarkup(name, qty, unit, total, category) {
    const categoryColor = category === "DUCT"
      ? "var(--accent2)"
      : category === "FITTING"
        ? "var(--accent3)"
        : "var(--accent5)";
    return '<div class="esp-row">'
      + '<div class="esp-cell">' + name + "</div>"
      + '<div class="esp-cell">' + qty + "</div>"
      + '<div class="esp-cell">' + unit + "</div>"
      + '<div class="esp-cell num">' + total + "</div>"
      + '<div class="esp-cell" style="color:" + categoryColor + ";font-size:10px;font-family:var(--mono);">' + category + "</div>"
      + "</div>";
  }

  function calculateRoom(inputs) {
    const length = parseFloat(inputs.len) || 0;
    const width = parseFloat(inputs.wid) || 0;
    const height = parseFloat(inputs.ht) || 0;
    const area = length * width;
    const volume = area * height;
    const occupants = parseFloat(inputs.occ) || 0;
    const freshAirPerPerson = parseFloat(inputs.fresh_cfm) || 0;
    const lightingLoad = parseFloat(inputs.lighting) || 0;
    const equipmentLoad = parseFloat(inputs.equip) || 0;
    const windowArea = parseFloat(inputs.win_area) || 0;
    const windowOrientation = inputs.win_orient || "SE";
    const wallExposure = parseInt(inputs.wall_exp, 10) || 2;
    const roofExposure = inputs.roof_exp || "top_floor";
    const outdoorDryBulb = parseFloat(inputs.out_dbt) || 40;
    const outdoorWetBulb = parseFloat(inputs.out_wbt) || 26;
    const outdoorRelativeHumidity = deriveOutdoorRh(outdoorDryBulb, outdoorWetBulb);
    const indoorDryBulb = parseFloat(inputs.in_dbt) || 24;
    const indoorRelativeHumidity = parseFloat(inputs.in_rh) || 50;
    const safetyFactor = parseFloat(inputs.sf) || 10;
    const wallUValue = parseFloat(inputs.u_wall) || 0.45;
    const roofUValue = parseFloat(inputs.u_roof) || 0.40;
    const shadingCoefficient = parseFloat(inputs.sc_glass) || 0.87;
    const coolingLoadFactor = parseFloat(inputs.clf_shade) || 0.55;
    const latitude = parseFloat(inputs.out_lat) || 28;
    const dayOfYear = parseInt(inputs.solar_day, 10) || 202;
    const solarHour = parseInt(inputs.solar_hour, 10) || 15;
    const elevation = parseFloat(inputs.out_elev) || 216;
    const inputSafetyFactor = parseFloat(inputs.sf) || 10;

    setValue("out_rh", outdoorRelativeHumidity.toFixed(0));

    const occupantLoad = OCCUPANT_LOADS[inputs.occ_act || "seated_light"] || OCCUPANT_LOADS.seated_light;
    const peopleSensible = occupants * occupantLoad.sensible;
    const peopleLatent = occupants * occupantLoad.latent;
    const lightingSensible = area * lightingLoad * 0.9;
    const equipmentSensible = area * equipmentLoad * 0.8;

    const solarPoint = SolarEngine.hourlySHGF(latitude, dayOfYear, solarHour, windowOrientation);
    const solarCurve = SolarEngine.hourlyCurve(latitude, dayOfYear, windowOrientation, 8, 17);
    const orientationSeries = SolarEngine.buildOrientationSeries(latitude, dayOfYear, 8, 17);
    const windowSensible = windowArea * solarPoint.shgf * shadingCoefficient * coolingLoadFactor;

    const wallPerimeter = 2 * (length + width);
    const grossWallArea = wallPerimeter * height;
    const externalWallArea = Math.max(0, grossWallArea * (wallExposure / 4) - windowArea);
    const wallCltd = CLTD_WALL[wallExposure] || CLTD_WALL[2];
    const roofCltd = CLTD_ROOF_MAP[roofExposure] || CLTD_ROOF_MAP.top_floor;
    const wallSensible = Math.max(0, wallUValue * externalWallArea * wallCltd);
    const roofSensible = Math.max(0, roofUValue * area * roofCltd);

    const pressurePa = pressureAtElevation(elevation);
    const freshAirCfm = occupants * freshAirPerPerson;
    const freshAirM3S = freshAirCfm * CFM_TO_M3S;
    const wOut = humidityRatioAt(outdoorDryBulb, outdoorRelativeHumidity, pressurePa);
    const wIn = humidityRatioAt(indoorDryBulb, indoorRelativeHumidity, pressurePa);
    const hOut = moistAirEnthalpy(outdoorDryBulb, wOut);
    const hIn = moistAirEnthalpy(indoorDryBulb, wIn);
    const svOut = moistAirSpecificVolume(outdoorDryBulb, wOut, pressurePa);
    const svIn = moistAirSpecificVolume(indoorDryBulb, wIn, pressurePa);
    const freshAirMassFlowDa = safeDiv(freshAirM3S, svOut, 0);
    const ventCp = 1.006 + 1.86 * ((wOut + wIn) / 2);
    const freshAirTotal = freshAirMassFlowDa * (hOut - hIn) * 1000;
    const freshAirSensible = freshAirMassFlowDa * ventCp * (outdoorDryBulb - indoorDryBulb) * 1000;
    const freshAirLatent = freshAirTotal - freshAirSensible;

    const spaceSensible = peopleSensible + lightingSensible + equipmentSensible + windowSensible + wallSensible + roofSensible;
    const spaceLatent = peopleLatent;
    const spaceTotal = spaceSensible + spaceLatent;
    const totalSensible = spaceSensible + freshAirSensible;
    const totalLatent = spaceLatent + freshAirLatent;
    const totalLoad = totalSensible + totalLatent;
    const shr = totalLoad > 0 ? totalSensible / totalLoad : 0.85;
    const roomShr = spaceTotal > 0 ? spaceSensible / spaceTotal : shr;

    const trDesign = totalLoad / 3517;
    const airsideProfile = classifyAirsideProfile(inputs, area);
    const preferredSelectionMargin = selectPreferredReserveMargin(inputSafetyFactor, airsideProfile, trDesign);
    const airflowDesign = selectAirflowDesignBasis(indoorDryBulb, indoorRelativeHumidity, roomShr, height, airsideProfile);
    const roomDeltaTDesign = airflowDesign.roomDeltaTDesign;
    const designSupplyTemp = airflowDesign.supplyTempDesign;
    const designAirFactorTemp = (indoorDryBulb + designSupplyTemp) / 2;
    const sensibleAirFactor = sensibleCapacityPerCfmDeltaC(designAirFactorTemp, wIn, pressurePa);
    const cfmThermal = Math.max(safeDiv(spaceSensible, sensibleAirFactor * roomDeltaTDesign, 0), 0);
    const cfmVent = Math.max(freshAirCfm, 0);
    const cfmAch = Math.max(volume > 0 ? safeDiv(volume * airsideProfile.achRequired, 3600 * CFM_TO_M3S, 0) : 0, 0);
    const cfmConditionedRequired = Math.max(cfmThermal, cfmVent);
    const cfmProcessExcessRequired = Math.max(cfmAch - cfmConditionedRequired, 0);
    const cfmConditioned = roundUpTo(cfmConditionedRequired, 25);
    const cfmProcessExcess = cfmProcessExcessRequired > 0 ? roundUpTo(cfmProcessExcessRequired, 25) : 0;
    const cfmRequired = cfmConditionedRequired + cfmProcessExcessRequired;
    const cfmFinal = cfmConditioned + cfmProcessExcess;
    const airflowConstraint = airflowConstraintName(cfmThermal, cfmVent, cfmAch);
    const coolingAirflowConstraint = airflowConstraintName(cfmThermal, cfmVent, 0);
    const dpOut = dewPoint(outdoorDryBulb, outdoorRelativeHumidity);
    const dpIn = dewPoint(indoorDryBulb, indoorRelativeHumidity);
    const wbOut = wetBulb(outdoorDryBulb, outdoorRelativeHumidity);
    const wbIn = wetBulb(indoorDryBulb, indoorRelativeHumidity);
    const supplyM3S = cfmConditioned * CFM_TO_M3S;
    const supplyMassFlowDa = safeDiv(supplyM3S, svIn, 0);
    const oaFraction = clamp(safeDiv(freshAirCfm, cfmConditioned, 0), 0, 1);
    const mixedAirHumidity = oaFraction * wOut + (1 - oaFraction) * wIn;
    const mixedAirEnthalpy = oaFraction * hOut + (1 - oaFraction) * hIn;
    const mixedAirTemp = dryBulbFromEnthalpyHumidity(mixedAirEnthalpy, mixedAirHumidity);
    const roomCp = 1.006 + 1.86 * wIn;
    const airflowDeltaT = Math.max(safeDiv(spaceSensible / 1000, Math.max(supplyMassFlowDa, 0.0001) * roomCp, 0), 0);
    let supplyTemp = indoorDryBulb - airflowDeltaT;
    let supplyEnthalpy = hIn - safeDiv(spaceTotal / 1000, Math.max(supplyMassFlowDa, 0.0001), 0);
    let supplyHumidity = humidityRatioFromEnthalpyTemp(supplyEnthalpy, supplyTemp);
    const supplySatHumidity = saturationHumidityRatio(supplyTemp, pressurePa);
    let psychroProcessNote = "";

    if (!Number.isFinite(supplyHumidity) || supplyHumidity < 0) {
      supplyHumidity = 0;
      supplyEnthalpy = moistAirEnthalpy(supplyTemp, supplyHumidity);
      psychroProcessNote = "Supply humidity ratio fell outside the physical range and was reset.";
    } else if (supplyHumidity > supplySatHumidity) {
      supplyTemp = solveSaturatedTempFromEnthalpy(supplyEnthalpy, pressurePa, indoorDryBulb);
      supplyHumidity = saturationHumidityRatio(supplyTemp, pressurePa);
      supplyEnthalpy = moistAirEnthalpy(supplyTemp, supplyHumidity);
      psychroProcessNote = "Supply state moved to the saturation curve to keep the process physically valid.";
    }

    const adpPoint = solveAdpFromProcess(mixedAirTemp, mixedAirHumidity, supplyTemp, supplyHumidity, pressurePa);
    const adpTemp = adpPoint.temp;
    const adpHumidity = adpPoint.humidity;
    const bypassFactor = adpPoint.bypassFactor;
    const coilTotalLoad = Math.max(0, supplyMassFlowDa * (mixedAirEnthalpy - supplyEnthalpy) * 1000);
    const coilCp = 1.006 + 1.86 * ((mixedAirHumidity + supplyHumidity) / 2);
    const coilSensible = supplyMassFlowDa * coilCp * (mixedAirTemp - supplyTemp) * 1000;
    const coilLatent = coilTotalLoad - coilSensible;
    const trAirflow = coilTotalLoad / 3517;
    const trFinal = Math.max(trDesign, trAirflow);
    const trCatalog = nextStandardTR(trFinal);
    const designCfmPerTR = safeDiv(cfmConditioned, trFinal, 0);
    const totalCfmPerTR = safeDiv(cfmFinal, trFinal, 0);
    const recirculationCfm = Math.max(0, cfmConditioned - freshAirCfm);
    const ach = volume > 0 ? cfmFinal * CFM_TO_M3S * 3600 / volume : 0;
    const lowCfmPerTrNote = designCfmPerTR < 200
      ? "Low CFM/TR due to low supply air temperature (high ΔT system)"
      : "";
    const airflowProcessNote = cfmProcessExcess > 0
      ? (airsideProfile.processVentilationStrategy === "localized_capture"
          ? "Large industrial hall ventilation is limited to general hall ACH only. Any remaining process airflow is treated as separate localized exhaust / make-up air outside the cooling coil."
          : "ACH excess is decoupled from the cooling coil. Psychrometric supply conditions use conditioned airflow only, while the extra ACH is treated as separate make-up / process air.")
      : cfmConditioned > cfmThermal + 1
        ? "Ventilation raises the conditioned supply volume above the thermal minimum, so the actual room ΔT is lower than the design thermal ΔT."
        : "Thermal sensible duty governs, so the actual room ΔT closely follows the design thermal ΔT.";
    const psychroSeparationNote = cfmProcessExcess > 0
      ? "Extra ACH airflow is handled outside the conditioned cooling stream, so the OA-MA-SA psychrometric process is plotted on conditioned air only."
      : "";

    let autoZoning = buildAutoZoningPlan({
      length: length,
      width: width,
      conditionedCFM: cfmConditioned,
      processCFM: cfmProcessExcess,
      trFinal: trFinal,
      airsideProfile: airsideProfile
    });

    let diffuserLayout = DiffuserLayout.computeLayout({
      length: length,
      width: width,
      ceilingHeight: height,
      totalAirflowCFM: cfmConditioned,
      targetCFM: designCfmPerTR < 220 ? 220 : 250,
      minCFMPerDiffuser: 150,
      maxCFMPerDiffuser: 400,
      industrialAirflowPerAreaThreshold: airsideProfile.type === "Industrial / process" ? 18 : 22,
      forceIndustrialTerminals: airsideProfile.highBayAirDistribution,
      largeIndustrialHall: airsideProfile.largeIndustrialHall,
      zoningPlan: autoZoning
    });

    let zoningIteration = 0;
    while ((diffuserLayout.zoningRecommended || (!diffuserLayout.spacingPass || !diffuserLayout.throwPass))
      && autoZoning.zoneCount < autoZoning.limits.maxZones
      && zoningIteration < 6) {
      const refinedZoning = buildAutoZoningPlan({
        length: length,
        width: width,
        conditionedCFM: cfmConditioned,
        processCFM: cfmProcessExcess,
        trFinal: trFinal,
        airsideProfile: airsideProfile,
        layoutHint: diffuserLayout,
        currentZoneCount: autoZoning.zoneCount
      });
      if (refinedZoning.zoneCount <= autoZoning.zoneCount) {
        break;
      }
      autoZoning = refinedZoning;
      diffuserLayout = DiffuserLayout.computeLayout({
        length: length,
        width: width,
        ceilingHeight: height,
        totalAirflowCFM: cfmConditioned,
        targetCFM: designCfmPerTR < 220 ? 220 : 250,
        minCFMPerDiffuser: 150,
        maxCFMPerDiffuser: 400,
        industrialAirflowPerAreaThreshold: airsideProfile.type === "Industrial / process" ? 18 : 22,
        forceIndustrialTerminals: airsideProfile.highBayAirDistribution,
        largeIndustrialHall: airsideProfile.largeIndustrialHall,
        zoningPlan: autoZoning
      });
      zoningIteration += 1;
    }

    const mainVelocityFpm = diffuserLayout.isIndustrialMode ? 800 : 650;
    const branchVelocityFpm = diffuserLayout.isIndustrialMode ? 650 : 450;
    const returnVelocityFpm = diffuserLayout.isIndustrialMode ? 500 : 350;
    const processVelocityFpm = airsideProfile.type === "Industrial / process" ? 850 : 700;
    const mainDuct = ductSize(cfmConditioned, mainVelocityFpm);
    let branchDuct = ductSize(diffuserLayout.cfmPerDiffuser, branchVelocityFpm);
    const returnDuct = ductSize(Math.max(recirculationCfm, cfmConditioned * 0.6), returnVelocityFpm);
    const processDuct = cfmProcessExcess > 0 ? ductSize(cfmProcessExcess, processVelocityFpm) : null;
    const ductLengthFt = (length + width) * 3.28084 * 1.5;
    const frictionPaPerFt = FRICTION_RATE * 0.3048;
    const ductFriction = frictionPaPerFt * ductLengthFt;
    const fittingLoss = ductFriction * 0.55;
    const equipmentLoss = EQUIP_PRESSURE.filter_clean + EQUIP_PRESSURE.cooling_coil + EQUIP_PRESSURE.mixing_box + EQUIP_PRESSURE.diffuser_grille + 30;
    const baseTotalEsp = ductFriction + fittingLoss + equipmentLoss;
    const supplyDuctOptions = {
      preferredTrunkCFM: diffuserLayout.isIndustrialMode ? 3800 : 3400,
      maxCFMPerTrunk: diffuserLayout.isIndustrialMode ? 4000 : 3600,
      maxEquivalentDiameterIn: diffuserLayout.isIndustrialMode ? 32 : 30,
      maxRectWidthIn: diffuserLayout.isIndustrialMode ? 42 : 36,
      maxRectHeightIn: diffuserLayout.isIndustrialMode ? 28 : 24
    };
    const returnDuctOptions = {
      preferredTrunkCFM: diffuserLayout.isIndustrialMode ? 3600 : 3200,
      maxCFMPerTrunk: diffuserLayout.isIndustrialMode ? 3900 : 3400,
      maxEquivalentDiameterIn: diffuserLayout.isIndustrialMode ? 30 : 28,
      maxRectWidthIn: diffuserLayout.isIndustrialMode ? 40 : 34,
      maxRectHeightIn: diffuserLayout.isIndustrialMode ? 28 : 24
    };
    const processDuctOptions = {
      preferredTrunkCFM: airsideProfile.type === "Industrial / process" ? 4000 : 3500,
      maxCFMPerTrunk: airsideProfile.type === "Industrial / process" ? 4000 : 3600,
      maxEquivalentDiameterIn: airsideProfile.type === "Industrial / process" ? 36 : 32,
      maxRectWidthIn: airsideProfile.type === "Industrial / process" ? 48 : 42,
      maxRectHeightIn: airsideProfile.type === "Industrial / process" ? 30 : 26
    };
    const distributeProcessAir = cfmProcessExcess > 0 && (
      airsideProfile.type === "Industrial / process"
      || cfmProcessExcess > 2000
      || safeDiv(cfmProcessExcess, cfmConditioned, 0) > 0.35
    );

    function buildCurrentZoneDuctPlan() {
      return buildZonewiseDuctPlan({
        autoZoning: autoZoning,
        diffuserLayout: diffuserLayout,
        length: length,
        width: width,
        conditionedCFM: cfmConditioned,
        processCFM: cfmProcessExcess,
        returnCFM: recirculationCfm,
        oaCFM: freshAirCfm,
        trFinal: trFinal,
        equipmentLoss: equipmentLoss,
        mainVelocityFpm: mainVelocityFpm,
        branchVelocityFpm: branchVelocityFpm,
        returnVelocityFpm: returnVelocityFpm,
        processVelocityFpm: processVelocityFpm,
        distributeProcessAir: distributeProcessAir,
        airsideProfile: airsideProfile,
        branchCFM: diffuserLayout.cfmPerDiffuser,
        supplyOptions: supplyDuctOptions,
        returnOptions: returnDuctOptions,
        processOptions: processDuctOptions
      });
    }

    let zoneDuctPlan = buildCurrentZoneDuctPlan();
    let splitDecision = evaluateSystemSplitNeed(cfmConditioned, zoneDuctPlan, autoZoning.zoneCount);
    let splitIteration = 0;

    while (splitDecision.redesignRequired
      && autoZoning.zoneCount < autoZoning.limits.maxZones
      && splitIteration < 6) {
      const nextZoneCount = Math.min(autoZoning.limits.maxZones, Math.max(autoZoning.zoneCount + 1, splitDecision.requiredSystems));
      if (nextZoneCount <= autoZoning.zoneCount) {
        break;
      }

      autoZoning = buildAutoZoningPlan({
        length: length,
        width: width,
        conditionedCFM: cfmConditioned,
        processCFM: cfmProcessExcess,
        trFinal: trFinal,
        airsideProfile: airsideProfile,
        forceMinZones: nextZoneCount
      });
      diffuserLayout = DiffuserLayout.computeLayout({
        length: length,
        width: width,
        ceilingHeight: height,
        totalAirflowCFM: cfmConditioned,
        targetCFM: designCfmPerTR < 220 ? 220 : 250,
        minCFMPerDiffuser: 150,
        maxCFMPerDiffuser: 400,
        industrialAirflowPerAreaThreshold: airsideProfile.type === "Industrial / process" ? 18 : 22,
        zoningPlan: autoZoning
      });
      zoneDuctPlan = buildCurrentZoneDuctPlan();
      splitDecision = evaluateSystemSplitNeed(cfmConditioned, zoneDuctPlan, autoZoning.zoneCount);
      splitIteration += 1;
    }

    if (splitDecision.redesignRequired) {
      zoneDuctPlan.summary += " Automatic system split reached the current zoning limit, so a manual engineering review is still required.";
    } else if (splitIteration > 0 && splitDecision.reasons.length) {
      zoneDuctPlan.summary += " System was automatically split and recalculated because " + splitDecision.reasons.join("; ") + ".";
    }
    branchDuct = ductSize(diffuserLayout.cfmPerDiffuser, branchVelocityFpm);

    const zoneAhuStrategy = buildZoneAhuStrategy({
      zoneDuctPlan: zoneDuctPlan,
      conditionedCFM: cfmConditioned,
      processCFM: cfmProcessExcess,
      trFinal: trFinal,
      trCatalog: trCatalog,
      preferredMargin: preferredSelectionMargin,
      coolingAirflowConstraint: coolingAirflowConstraint,
      airsideProfile: airsideProfile
    });

    const supplyDuctStrategy = (zoneDuctPlan.aggregate && zoneDuctPlan.aggregate.supply) || buildDuctStrategy(
      cfmConditioned,
      mainVelocityFpm,
      mainDuct,
      Math.max(1, autoZoning.zoneCount || 1),
      supplyDuctOptions
    );
    const returnDuctStrategy = (zoneDuctPlan.aggregate && zoneDuctPlan.aggregate.return) || buildDuctStrategy(
      Math.max(recirculationCfm, cfmConditioned * 0.6),
      returnVelocityFpm,
      returnDuct,
      supplyDuctStrategy.trunkCount,
      returnDuctOptions
    );
    const processDuctStrategy = (zoneDuctPlan.aggregate && zoneDuctPlan.aggregate.process) || (processDuct
      ? buildDuctStrategy(
          cfmProcessExcess,
          processVelocityFpm,
          processDuct,
          1,
          processDuctOptions
        )
      : null);
    const equipmentSelection = zoneAhuStrategy.aggregateSelection || EquipmentEngine.selectSystem(trFinal, cfmConditioned, baseTotalEsp, {
      catalogTR: trCatalog,
      designCFMPerTR: designCfmPerTR,
      preferredMargin: preferredSelectionMargin,
      airflowConstraint: coolingAirflowConstraint
    });
    const controllingZone = (zoneDuctPlan.zones || []).slice().sort(function (left, right) {
      return (right.totalEsp || 0) - (left.totalEsp || 0);
    })[0];
    const totalEsp = roundTo(zoneAhuStrategy.maxClusterESP || zoneDuctPlan.maxZoneESP || baseTotalEsp, 0);
    const ductFrictionDisplay = controllingZone ? controllingZone.ductFriction : ductFriction;
    const fittingLossDisplay = controllingZone ? controllingZone.fittingLoss : fittingLoss;
    const equipmentLossDisplay = controllingZone ? controllingZone.equipmentLoss : equipmentLoss;
    const ductLengthFtDisplay = controllingZone ? controllingZone.ductLengthFt : ductLengthFt;
    const processAirSelection = cfmProcessExcess > 0
      ? EquipmentEngine.selectFan(
          cfmProcessExcess,
          Math.min(
            Math.max(zoneDuctPlan.maxProcessESP || airsideProfile.recommendedProcessStaticPa || totalEsp * 0.55, airsideProfile.recommendedProcessStaticPa || 120),
            airsideProfile.largeIndustrialHall ? 200 : 350
          )
        )
      : null;
    const energyOptimization = buildEnergyOptimizationPlan({
      zoneAhuStrategy: zoneAhuStrategy,
      zoneDuctPlan: zoneDuctPlan,
      conditionedCFM: cfmConditioned,
      processCFM: cfmProcessExcess,
      airsideProfile: airsideProfile
    });

    const systemRecommendation = recommendSystemType({
      airsideProfile: airsideProfile,
      zoning: autoZoning,
      diffuserLayout: diffuserLayout,
      conditionedCFM: cfmConditioned,
      processCFM: cfmProcessExcess,
      oaFraction: oaFraction,
      trFinal: trFinal,
      area: area
    });
    const designConstraints = evaluateDesignConstraints({
      airsideProfile: airsideProfile,
      ceilingHeight: height,
      zoning: autoZoning,
      diffuserLayout: diffuserLayout,
      systemRecommendation: systemRecommendation,
      conditionedCFM: cfmConditioned,
      processCFM: cfmProcessExcess,
      supplyTemp: supplyTemp,
      supplyDuctStrategy: supplyDuctStrategy,
      returnDuctStrategy: returnDuctStrategy,
      processDuctStrategy: processDuctStrategy,
      zoneDuctPlan: zoneDuctPlan,
      zoneAhuStrategy: zoneAhuStrategy
    });

    const statePoints = {
      OA: { label: "Outdoor air", T: outdoorDryBulb, W: wOut },
      RA: { label: "Return air", T: indoorDryBulb, W: wIn },
      MA: { label: "Mixed air", T: mixedAirTemp, W: mixedAirHumidity },
      SA: { label: "Supply air", T: supplyTemp, W: supplyHumidity },
      ADP: { label: "Coil ADP", T: adpTemp, W: adpHumidity }
    };

    return {
      inputs: inputs,
      area: area,
      volume: volume,
      outdoorRelativeHumidity: outdoorRelativeHumidity,
      peopleSensible: peopleSensible,
      peopleLatent: peopleLatent,
      lightingSensible: lightingSensible,
      equipmentSensible: equipmentSensible,
      windowSensible: windowSensible,
      wallSensible: wallSensible,
      roofSensible: roofSensible,
      spaceSensible: spaceSensible,
      spaceLatent: spaceLatent,
      spaceTotal: spaceTotal,
      freshAirSensible: freshAirSensible,
      freshAirLatent: freshAirLatent,
      freshAirTotal: freshAirTotal,
      totalS: totalSensible,
      totalL: totalLatent,
      totalLoad: totalLoad,
      shr: shr,
      roomShr: roomShr,
      tr_calc: trDesign,
      tr_sf: trFinal,
      tr_design: trDesign,
      tr_airflow: trAirflow,
      tr_final: trFinal,
      tr_catalog: trCatalog,
      TR_sel: trCatalog,
      TR_room: trDesign,
      Q_sup_cfm: cfmConditioned,
      cfm_thermal: cfmThermal,
      cfm_vent: cfmVent,
      cfm_ach: cfmAch,
      cfm_conditioned: cfmConditioned,
      cfm_process_excess: cfmProcessExcess,
      cfm_required: cfmRequired,
      cfm_final: cfmFinal,
      fresh_total_cfm: freshAirCfm,
      recirc_cfm: recirculationCfm,
      ach: ach,
      ach_required: airsideProfile.achRequired,
      occupancy_profile: airsideProfile.type,
      main_duct: supplyDuctStrategy.trunkDuct,
      main_duct_single: mainDuct,
      branch_duct: branchDuct,
      return_duct: returnDuctStrategy.trunkDuct,
      return_duct_single: returnDuct,
      process_duct: processDuctStrategy ? processDuctStrategy.trunkDuct : null,
      ductStrategy: {
        supply: supplyDuctStrategy,
        return: returnDuctStrategy,
        process: processDuctStrategy
      },
      ductVelocity: {
        main: mainVelocityFpm,
        branch: branchVelocityFpm,
        return: returnVelocityFpm,
        process: processVelocityFpm
      },
      branch_cfm: diffuserLayout.cfmPerDiffuser,
      duct_len_ft: ductLengthFtDisplay,
      duct_friction: ductFrictionDisplay,
      fitting_loss: fittingLossDisplay,
      equipment_loss: equipmentLossDisplay,
      total_esp: totalEsp,
      equipmentSelection: equipmentSelection,
      processAirSelection: processAirSelection,
      airsideProfile: airsideProfile,
      motor_kw: equipmentSelection.recommendedMotorKW,
      fanSelection: equipmentSelection.fan,
      diffuserLayout: diffuserLayout,
      autoZoning: autoZoning,
      zoneDuctPlan: zoneDuctPlan,
      zoneAhuStrategy: zoneAhuStrategy,
      energyOptimization: energyOptimization,
      systemRecommendation: systemRecommendation,
      designConstraints: designConstraints,
      airflowBasis: {
        method: "Conditioned airflow = max(space sensible, ventilation); ACH excess above that is separate process / make-up air",
        roomTemp: indoorDryBulb,
        supplyTemp: supplyTemp,
        deltaT: airflowDeltaT,
        roomShr: roomShr,
        roomDeltaTDesign: roomDeltaTDesign,
        supplyTempDesign: designSupplyTemp,
        roomSensible: spaceSensible,
        sensibleAirFactor: sensibleAirFactor,
        cfmThermal: cfmThermal,
        cfmVent: cfmVent,
        cfmAch: cfmAch,
        cfmConditioned: cfmConditioned,
        cfmProcessExcess: cfmProcessExcess,
        cfmRequired: cfmRequired,
        cfmFinal: cfmFinal,
        airflowConstraint: airflowConstraint,
        airflowConstraintLabel: airflowConstraintLabel(airflowConstraint),
        coolingAirflowConstraint: coolingAirflowConstraint,
        coolingAirflowConstraintLabel: airflowConstraintLabel(coolingAirflowConstraint),
        designCFMPerTR: designCfmPerTR,
        totalCFMPerTR: totalCfmPerTR,
        achRequired: airsideProfile.achRequired,
        achRangeMin: airsideProfile.achRangeMin,
        achRangeMax: airsideProfile.achRangeMax,
        achProvided: ach,
        occupancyType: airsideProfile.type,
        occupancyNote: airsideProfile.note,
        processVentilationStrategy: airsideProfile.processVentilationStrategy,
        airflowDesignNote: airflowDesign.note,
        airflowProcessNote: airflowProcessNote,
        preferredSelectionMargin: preferredSelectionMargin,
        lowCfmPerTrNote: lowCfmPerTrNote
      },
      n_sup: diffuserLayout.diffuserCount,
      n_ret: diffuserLayout.returns.count,
      actual_cfm_diff: diffuserLayout.cfmPerDiffuser,
      ret_grille_area_ft2: diffuserLayout.returns.totalArea / FT2_TO_M2,
      psychro: {
        W_out: wOut,
        W_in: wIn,
        h_out: hOut,
        h_in: hIn,
        dp_out: dpOut,
        dp_in: dpIn,
        wb_out: wbOut,
        wb_in: wbIn,
        sv_out: svOut,
        sv_in: svIn,
        h_mixed: mixedAirEnthalpy,
        mixedAirTemp: mixedAirTemp,
        mixedAirHumidity: mixedAirHumidity,
        h_supply: supplyEnthalpy,
        supplyTemp: supplyTemp,
        supplyHumidity: supplyHumidity,
        adpTemp: adpTemp,
        adpHumidity: adpHumidity,
        bypassFactor: bypassFactor,
        adpMethod: adpPoint.method || "bf_consistent_search",
        bfTemp: adpPoint.bfTemp,
        bfHumidity: adpPoint.bfHumidity,
        adpHumidityError: adpPoint.humidityError || 0,
        oaFraction: oaFraction,
        coilTotalLoad: coilTotalLoad,
        coilSensibleLoad: coilSensible,
        coilLatentLoad: coilLatent,
        supplyMassFlowDa: supplyMassFlowDa,
        processNote: [psychroProcessNote, psychroSeparationNote].filter(Boolean).join(" ")
      },
      statePoints: statePoints,
      solar: {
        latitude: latitude,
        dayOfYear: dayOfYear,
        designHour: solarHour,
        point: solarPoint,
        curve: solarCurve,
        orientationSeries: orientationSeries
      }
    };
  }

  function renderCooling(result) {
    setMetric("m-sh", formatInt(result.totalS), "W");
    setMetric("m-lh", formatInt(result.totalL), "W");
    setMetric("m-total", formatInt(result.totalLoad), "W");
    setMetric("m-area", formatNumber(result.area, 1), "m2");

    byId("cooling-tbody").innerHTML =
      '<tr><td>People - sensible</td><td>' + result.inputs.occ + " x " + result.peopleSensible / Math.max(parseFloat(result.inputs.occ) || 1, 1) + ' W/person</td><td>' + result.inputs.occ + ' persons</td><td>Activity: ' + String(result.inputs.occ_act).replace(/_/g, " ") + '</td><td class="num">' + formatInt(result.peopleSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>People - latent</td><td>' + result.inputs.occ + " x " + result.peopleLatent / Math.max(parseFloat(result.inputs.occ) || 1, 1) + ' W/person</td><td>' + result.inputs.occ + ' persons</td><td>Metabolic latent</td><td class="num">-</td><td class="num">' + formatInt(result.peopleLatent) + "</td></tr>"
      + '<tr><td>Lighting</td><td>A x W/m2 x CLF 0.9</td><td>' + formatNumber(result.area, 1) + " m2</td><td>" + result.inputs.lighting + ' W/m2</td><td class="num">' + formatInt(result.lightingSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Equipment</td><td>A x W/m2 x diversity 0.8</td><td>' + formatNumber(result.area, 1) + " m2</td><td>" + result.inputs.equip + ' W/m2</td><td class="num">' + formatInt(result.equipmentSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Window solar</td><td>A x dynamic SHGF x SC x CLF</td><td>' + result.inputs.win_area + " m2</td><td>SHGF=" + Math.round(result.solar.point.shgf) + ", SC=" + result.inputs.sc_glass + ", CLF=" + result.inputs.clf_shade + '</td><td class="num">' + formatInt(result.windowSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Wall conduction</td><td>U x A x CLTD</td><td>' + formatNumber(Math.max(0, 2 * (parseFloat(result.inputs.len) + parseFloat(result.inputs.wid)) * parseFloat(result.inputs.ht) * ((parseFloat(result.inputs.wall_exp) || 2) / 4) - parseFloat(result.inputs.win_area || 0)), 1) + " m2</td><td>U=" + result.inputs.u_wall + ", CLTD=" + (CLTD_WALL[parseInt(result.inputs.wall_exp, 10)] || 0) + '</td><td class="num">' + formatInt(result.wallSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Roof / floor</td><td>U x A x CLTD</td><td>' + formatNumber(result.area, 1) + " m2</td><td>U=" + result.inputs.u_roof + ", CLTD=" + (CLTD_ROOF_MAP[result.inputs.roof_exp] || 0) + '</td><td class="num">' + formatInt(result.roofSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Fresh air - sensible</td><td>m_dot OA x c_p x dT</td><td>' + formatInt(result.fresh_total_cfm) + " CFM</td><td>dT=" + formatNumber((parseFloat(result.inputs.out_dbt) || 0) - (parseFloat(result.inputs.in_dbt) || 0), 1) + ' C</td><td class="num">' + formatInt(result.freshAirSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Fresh air - latent</td><td>Vent total - vent sensible</td><td>-</td><td>dW=' + formatNumber((result.psychro.W_out - result.psychro.W_in) * 1000, 2) + ' g/kg</td><td class="num">-</td><td class="num">' + formatInt(result.freshAirLatent) + "</td></tr>"
      + '<tr class="total-row"><td><b>Total</b></td><td colspan="3">Room sensible + latent</td><td class="num"><b>' + formatInt(result.totalS) + '</b></td><td class="num"><b>' + formatInt(result.totalL) + "</b></td></tr>"
      + '<tr class="total-row"><td><b>Grand total</b></td><td colspan="3">Before safety factor</td><td colspan="2" class="num"><b>' + formatInt(result.totalLoad) + " W</b></td></tr>";
  }

  function renderShr(result) {
    const roomShr = result.roomShr || result.shr;
    const shrPercent = roomShr * 100;
    const shrColor = roomShr > 0.85 ? "var(--accent)" : roomShr > 0.7 ? "var(--accent3)" : "var(--accent4)";
    const shrText = roomShr > 0.95
      ? "Mainly sensible load. Standard comfort cooling is adequate."
      : roomShr > 0.85
        ? "Low latent share. Standard AHU coil selection remains suitable."
        : roomShr > 0.7
          ? "Moderate latent content. Coil dehumidification matters."
          : "High latent load. Low bypass factor coil is recommended.";

    byId("shr-content").innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:16px;">'
      + '<span style="font-family:var(--mono);font-size:48px;font-weight:500;color:' + shrColor + '">' + formatNumber(shrPercent, 1) + '<span style="font-size:20px">%</span></span>'
      + '<span style="font-size:13px;color:var(--text2)">Room SHR = ' + formatInt(result.spaceSensible || result.totalS) + " W sensible / " + formatInt(result.spaceTotal || result.totalLoad) + " W total</span>"
      + "</div>"
      + '<div class="shr-bar-bg"><div class="shr-bar-fill" style="width:' + shrPercent.toFixed(1) + "%;background:" + shrColor + '"></div></div>'
      + '<div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--text3);margin-top:4px;"><span>0 - latent dominant</span><span>1.0 - sensible dominant</span></div>'
      + '<div style="margin-top:16px;padding:12px 14px;background:var(--bg3);border-left:3px solid ' + shrColor + ';border-radius:0 var(--r) var(--r) 0;font-size:12px;font-family:var(--mono);color:var(--text2);">' + shrText + "</div>";
  }

  function renderTonnage(result) {
    const basis = result.airflowBasis || {};
    setMetric("m-tr-calc", formatNumber(result.tr_design, 2), "TR");
    setMetric("m-tr-sf", formatNumber(result.tr_final, 2), "TR");
    setMetric("m-tr-sel", formatNumber(result.tr_catalog, 2), "TR");
    setMetric("m-wm2", formatNumber(result.totalLoad / Math.max(result.area, 1), 1), "W/m2");

    byId("tonnage-detail").innerHTML =
      '<table class="calc-table"><thead><tr><th>STEP</th><th>FORMULA</th><th>VALUE</th><th>UNIT</th><th>NOTE</th></tr></thead><tbody>'
      + '<tr><td>Total cooling load</td><td>Space load + ventilation load</td><td class="num">' + formatInt(result.totalLoad) + "</td><td>W</td><td>Before equipment reserve</td></tr>"
      + '<tr><td>TR_design</td><td>Total / 3517</td><td class="num">' + formatNumber(result.tr_design, 3) + "</td><td>TR</td><td>Component load based coil duty</td></tr>"
      + '<tr><td>TR_airflow</td><td>m_dot x (h_MA - h_SA) / 3517</td><td class="num">' + formatNumber(result.tr_airflow, 3) + "</td><td>TR</td><td>Psychrometric coil duty at conditioned cooling airflow</td></tr>"
      + '<tr><td>TR_final</td><td>Max(TR_design, TR_airflow)</td><td class="num">' + formatNumber(result.tr_final, 3) + "</td><td>TR</td><td>Resolved design duty after airside cross-check</td></tr>"
      + '<tr><td>Preferred reserve target</td><td>TR_final x (1 + margin)</td><td class="num">' + formatNumber(result.tr_final * (1 + (basis.preferredSelectionMargin || 0.1)), 3) + "</td><td>TR</td><td>" + formatNumber((basis.preferredSelectionMargin || 0.1) * 100, 0) + '% preferred equipment reserve</td></tr>'
      + '<tr class="total-row"><td><b>TR_catalog</b></td><td>Next standard size >= TR_final</td><td class="num"><b>' + formatNumber(result.tr_catalog, 2) + "</b></td><td>TR</td><td>Catalog reference used for AHU selection</td></tr>"
      + "</tbody></table>";

    byId("tr-sizes-ref").innerHTML = STD_TR.map(function (size) {
      const active = Number(size) === Number(result.tr_catalog);
      return '<span style="font-family:var(--mono);font-size:12px;padding:5px 12px;border-radius:var(--r);border:1px solid ' + (active ? "var(--accent)" : "var(--border)") + ";background:" + (active ? "rgba(0,201,167,0.1)" : "var(--bg3)") + ";color:" + (active ? "var(--accent)" : "var(--text2)") + ';">' + size + " TR" + (active ? " ✓" : "") + "</span>";
    }).join("");
  }

  function renderAirflow(result) {
    const basis = result.airflowBasis || {
      roomTemp: parseFloat(result.inputs.in_dbt) || 24,
      supplyTemp: result.psychro && result.psychro.supplyTemp ? result.psychro.supplyTemp : (parseFloat(result.inputs.in_dbt) || 24) - 10,
      deltaT: 10,
      roomDeltaTDesign: 10,
      supplyTempDesign: (parseFloat(result.inputs.in_dbt) || 24) - 10,
      cfmThermal: result.cfm_thermal || result.Q_sup_cfm,
      cfmVent: result.cfm_vent || result.fresh_total_cfm,
      cfmAch: result.cfm_ach || 0,
      cfmConditioned: result.cfm_conditioned || result.Q_sup_cfm,
      cfmProcessExcess: result.cfm_process_excess || 0,
      cfmRequired: result.cfm_required || result.cfm_final || result.Q_sup_cfm,
      cfmFinal: result.cfm_final || result.Q_sup_cfm,
      sensibleAirFactor: SENSIBLE_W_PER_CFM_C,
      designCFMPerTR: safeDiv(result.Q_sup_cfm, result.tr_final || result.tr_sf || 1, 0),
      totalCFMPerTR: safeDiv(result.cfm_final || result.Q_sup_cfm, result.tr_final || result.tr_sf || 1, 0),
      achRequired: result.ach_required || 0,
      achProvided: result.ach || 0,
      airflowConstraintLabel: "Thermal sensible load governs"
    };
    setMetric("m-cfm", formatInt(result.cfm_final || result.Q_sup_cfm), "CFM");
    setMetric("m-fa-cfm", formatInt(result.fresh_total_cfm), "CFM");
    setMetric("m-recirc-cfm", formatInt(result.recirc_cfm), "CFM");
    setMetric("m-ach", formatNumber(result.ach, 1), "ACH");

    byId("airflow-detail").innerHTML =
      '<table class="calc-table"><thead><tr><th>PARAMETER</th><th>FORMULA</th><th class="num">VALUE</th><th>UNIT</th><th>NOTE</th></tr></thead><tbody>'
      + '<tr><td>Design supply DBT</td><td>Room DBT - design dT</td><td class="num">' + formatNumber(basis.supplyTempDesign || basis.supplyTemp, 1) + "</td><td>C</td><td>" + escapeHtml(basis.airflowDesignNote || "Used only to establish the thermal airflow basis") + "</td></tr>"
      + '<tr><td>Design room dT</td><td>Room DBT - design supply DBT</td><td class="num">' + formatNumber(basis.roomDeltaTDesign || basis.deltaT, 1) + "</td><td>C</td><td>Thermal airflow basis before ventilation and ACH checks</td></tr>"
      + '<tr><td>Moist-air sensible factor</td><td>rho x c_p x 1 C per CFM</td><td class="num">' + formatNumber(basis.sensibleAirFactor || SENSIBLE_W_PER_CFM_C, 3) + "</td><td>W/CFM-C</td><td>Evaluated at the room/design-supply mean state instead of a fixed rule-of-thumb constant</td></tr>"
      + '<tr><td>CFM_thermal</td><td>Space sensible / (moist-air factor x design dT)</td><td class="num">' + formatInt(basis.cfmThermal) + "</td><td>CFM</td><td>Using room sensible load of " + formatInt(basis.roomSensible || result.spaceSensible || result.totalS) + " W</td></tr>"
      + '<tr><td>CFM_vent</td><td>Occupants x OA/person</td><td class="num">' + formatInt(basis.cfmVent) + "</td><td>CFM</td><td>Outdoor air ventilation minimum</td></tr>"
      + '<tr><td>CFM_ACH</td><td>Room volume x ACH, converted to CFM</td><td class="num">' + formatInt(basis.cfmAch) + "</td><td>CFM</td><td>" + escapeHtml(basis.occupancyType || "Occupancy profile") + " | ACH target " + formatNumber(basis.achRequired || 0, 1) + " (" + formatNumber(basis.achRangeMin || 0, 0) + "-" + formatNumber(basis.achRangeMax || 0, 0) + " typical)</td></tr>"
      + '<tr><td>Conditioned cooling air</td><td>Max(CFM_thermal, CFM_vent)</td><td class="num">' + formatInt(basis.cfmConditioned || basis.cfmThermal) + "</td><td>CFM</td><td>" + escapeHtml(basis.coolingAirflowConstraintLabel || "Cooling airflow basis") + "</td></tr>"
      + '<tr><td>ACH process / make-up air</td><td>Max(CFM_ACH - conditioned, 0)</td><td class="num">' + formatInt(basis.cfmProcessExcess || 0) + "</td><td>CFM</td><td>Handled outside the conditioned cooling stream</td></tr>"
      + '<tr><td>CFM_required</td><td>Conditioned + ACH excess</td><td class="num">' + formatInt(basis.cfmRequired || basis.cfmFinal) + "</td><td>CFM</td><td>" + escapeHtml(basis.airflowConstraintLabel || "Primary airflow basis") + "</td></tr>"
      + '<tr class="total-row"><td><b>Total room airflow</b></td><td>Rounded design airflow</td><td class="num"><b>' + formatInt(basis.cfmFinal) + "</b></td><td>CFM</td><td>Conditioned airflow plus any separate ACH / process air</td></tr>"
      + '<tr><td>Supply dT (actual)</td><td>Room DBT - supply DBT</td><td class="num">' + formatNumber(basis.deltaT, 1) + "</td><td>C</td><td>Back-calculated from conditioned cooling airflow</td></tr>"
      + '<tr><td>Supply air DBT</td><td>Room DBT - dT</td><td class="num">' + formatNumber(basis.supplyTemp, 1) + "</td><td>C</td><td>Used for psychrometric process line</td></tr>"
      + '<tr><td>Recirculation air</td><td>Supply - outdoor air</td><td class="num">' + formatInt(result.recirc_cfm) + "</td><td>CFM</td><td>Return air through coil</td></tr>"
      + '<tr><td>Outdoor air fraction</td><td>OA / supply x 100</td><td class="num">' + formatNumber(result.psychro.oaFraction * 100, 1) + "</td><td>%</td><td>Used for mixed air state</td></tr>"
      + '<tr><td>Cooling airflow rate</td><td>Conditioned CFM / TR_final</td><td class="num">' + formatNumber(basis.designCFMPerTR, 0) + "</td><td>CFM/TR</td><td>" + escapeHtml(basis.lowCfmPerTrNote || "Derived from conditioned airflow and final TR") + "</td></tr>"
      + '<tr><td>Total airflow rate</td><td>Total room CFM / TR_final</td><td class="num">' + formatNumber(basis.totalCFMPerTR || basis.designCFMPerTR, 0) + "</td><td>CFM/TR</td><td>Includes separate ACH / process air when present</td></tr>"
      + '<tr class="total-row"><td><b>Air changes provided</b></td><td>Supply m3/s x 3600 / room volume</td><td class="num"><b>' + formatNumber(basis.achProvided || result.ach, 1) + "</b></td><td>ACH</td><td>Required minimum: " + formatNumber(basis.achRequired || result.ach_required || 0, 1) + " ACH</td></tr>"
      + (basis.airflowProcessNote
        ? '<tr><td>Process note</td><td colspan="4">' + escapeHtml(basis.airflowProcessNote) + "</td></tr>"
        : "")
      + "</tbody></table>";
  }

  function renderDuct(result) {
    const zoneDuctPlan = result.zoneDuctPlan || null;
    const ductStrategy = result.ductStrategy || {};
    const supply = ductStrategy.supply || {
      isMultiple: false,
      trunkCount: 1,
      totalCFM: result.Q_sup_cfm,
      perTrunkCFM: result.Q_sup_cfm,
      velocityFpm: 700,
      trunkDuct: result.main_duct,
      reason: "Single trunk selected."
    };
    const returnAir = ductStrategy.return || {
      isMultiple: false,
      trunkCount: 1,
      totalCFM: result.recirc_cfm || result.Q_sup_cfm,
      perTrunkCFM: result.recirc_cfm || result.Q_sup_cfm,
      velocityFpm: 400,
      trunkDuct: result.return_duct,
      reason: "Single return selected."
    };
    const processAir = ductStrategy.process;
    const overallStatus = zoneDuctPlan ? zoneDuctPlan.overallStatus : (supply.validationStatus || "OK");
    const statusColor = overallStatus === "REJECT" ? "var(--accent4)" : overallStatus === "WARNING" ? "var(--accent3)" : "var(--accent)";
    const alternativeCards = [supply, returnAir, processAir].filter(function (strategy) {
      return strategy && strategy.bestAlternative;
    }).map(function (strategy) {
      return '<div style="padding:10px 12px;border:1px solid rgba(245,158,11,0.22);background:rgba(245,158,11,0.08);border-radius:var(--r);font-size:11px;color:var(--text2);font-family:var(--mono);">'
        + '<b style="color:var(--text);">' + escapeHtml(strategy.kindLabel || "Duct") + " best alternative:</b> "
        + escapeHtml(strategy.bestAlternative)
        + "</div>";
    }).join("");
    function ductSizeLabel(strategy) {
      if (!strategy || !strategy.trunkDuct) {
        return "N/A";
      }
      return strategy.trunkDuct.rectW + '" x ' + strategy.trunkDuct.rectH + '"';
    }
    function ductCircleLabel(strategy) {
      if (!strategy || !strategy.trunkDuct) {
        return "-";
      }
      return 'Ø' + strategy.trunkDuct.dia_in + '"';
    }
    function processCardMarkup(strategy) {
      if (!strategy) {
        return "";
      }
      if (strategy.distributed) {
        return '<div class="duct-card"><div class="duct-type">PROCESS / MAKE-UP AIR</div><div class="duct-size">Distributed ventilation</div><div class="duct-meta">'
          + escapeHtml(strategy.deviceCount + " x " + strategy.deviceType)
          + '</div><div class="duct-meta">' + formatInt(strategy.cfmPerDevice) + ' CFM per device | Total ' + formatInt(strategy.totalCFM) + ' CFM</div><div class="duct-meta">'
          + escapeHtml(strategy.reason || "Distributed ventilation is used instead of a full duct trunk network.")
          + "</div></div>";
      }
      return '<div class="duct-card"><div class="duct-type">' + (strategy.isMultiple ? "MAKE-UP AIR TRUNK NETWORK" : "PROCESS / MAKE-UP AIR DUCT") + '</div><div class="duct-size">' + (strategy.isMultiple ? strategy.trunkCount + " x " : "") + ductSizeLabel(strategy) + '</div><div class="duct-meta">' + (strategy.isMultiple ? "Parallel make-up air trunks" : "Single make-up air main") + " at " + strategy.velocityFpm + ' FPM (' + formatNumber(strategy.velocityMps || 0, 1) + ' m/s)</div><div class="duct-meta">Circular: ' + ductCircleLabel(strategy) + ' per trunk | ' + formatInt(strategy.perTrunkCFM) + ' CFM/trunk</div><div class="duct-meta">' + escapeHtml(strategy.reason) + "</div></div>";
    }
    const zoneRows = zoneDuctPlan && zoneDuctPlan.zones && zoneDuctPlan.zones.length
      ? zoneDuctPlan.zones.map(function (zone) {
          const zoneStatusColor = zone.validationStatus === "REJECT" ? "var(--accent4)" : zone.validationStatus === "WARNING" ? "var(--accent3)" : "var(--accent)";
          return '<tr><td>' + escapeHtml(zone.name) + ' supply</td><td>' + formatInt(zone.conditionedCFM) + '</td><td>' + zone.supply.velocityFpm + '</td><td>' + zone.supply.trunkDuct.rectW + "x" + zone.supply.trunkDuct.rectH + '</td><td>Ø' + zone.supply.trunkDuct.dia_in + '</td><td class="num">' + formatNumber(zone.totalEsp, 0) + ' Pa</td></tr>'
            + '<tr><td>' + escapeHtml(zone.name) + ' return</td><td>' + formatInt(zone.returnCFM) + '</td><td>' + zone.return.velocityFpm + '</td><td>' + zone.return.trunkDuct.rectW + "x" + zone.return.trunkDuct.rectH + '</td><td>Ø' + zone.return.trunkDuct.dia_in + '</td><td class="num" style="color:' + zoneStatusColor + ';">' + escapeHtml(zone.validationStatus) + '</td></tr>'
            + (zone.process
              ? (zone.process.distributed
                  ? '<tr><td>' + escapeHtml(zone.name) + ' process</td><td>' + formatInt(zone.processCFM) + '</td><td>-</td><td>Distributed ventilation</td><td>' + escapeHtml(zone.process.deviceType || "Axial fan / louver") + '</td><td class="num">' + escapeHtml(zone.process.deviceCount + " devices") + '</td></tr>'
                  : '<tr><td>' + escapeHtml(zone.name) + ' process</td><td>' + formatInt(zone.processCFM) + '</td><td>' + zone.process.velocityFpm + '</td><td>' + zone.process.trunkDuct.rectW + "x" + zone.process.trunkDuct.rectH + '</td><td>Ø' + zone.process.trunkDuct.dia_in + '</td><td class="num">Separate air</td></tr>')
              : '');
        }).join("")
      : "";

    byId("duct-cards").innerHTML =
      '<div class="duct-card"><div class="duct-type">ZONEWISE DUCT STRATEGY</div><div class="duct-size" style="color:' + statusColor + ';">' + escapeHtml(overallStatus) + '</div><div class="duct-meta">' + escapeHtml(zoneDuctPlan && zoneDuctPlan.summary ? zoneDuctPlan.summary : "Aggregate duct strategy for the active room.") + '</div><div class="duct-meta">Max zone ESP: ' + formatInt((zoneDuctPlan && zoneDuctPlan.maxZoneESP) || result.total_esp || 0) + ' Pa</div></div>'
      + '<div class="duct-card"><div class="duct-type">' + (supply.isMultiple ? "SUPPLY TRUNK NETWORK" : "MAIN SUPPLY DUCT") + '</div><div class="duct-size">' + (supply.isMultiple ? supply.trunkCount + " x " : "") + supply.trunkDuct.rectW + '" x ' + supply.trunkDuct.rectH + '"</div><div class="duct-meta">' + (supply.isMultiple ? "Parallel supply trunks" : "Single supply main") + " at " + supply.velocityFpm + ' FPM (' + formatNumber(supply.velocityMps || 0, 1) + ' m/s)</div><div class="duct-meta">Circular: Ø' + supply.trunkDuct.dia_in + '" per trunk | ' + formatInt(supply.perTrunkCFM) + ' CFM/trunk</div><div class="duct-meta">' + escapeHtml(supply.reason) + "</div></div>"
      + '<div class="duct-card"><div class="duct-type">BRANCH DUCT</div><div class="duct-size">' + result.branch_duct.rectW + '" x ' + result.branch_duct.rectH + '"</div><div class="duct-meta">Per ' + escapeHtml((result.diffuserLayout && result.diffuserLayout.supplyDeviceType) || "supply outlet") + " branch at " + ((result.ductVelocity && result.ductVelocity.branch) || 500) + ' FPM</div><div class="duct-meta">Circular: Ø' + result.branch_duct.dia_in + '" | ' + formatInt(result.branch_cfm) + " CFM</div></div>"
      + '<div class="duct-card"><div class="duct-type">' + (returnAir.isMultiple ? "RETURN TRUNK NETWORK" : "RETURN AIR DUCT") + '</div><div class="duct-size">' + (returnAir.isMultiple ? returnAir.trunkCount + " x " : "") + returnAir.trunkDuct.rectW + '" x ' + returnAir.trunkDuct.rectH + '"</div><div class="duct-meta">' + (returnAir.isMultiple ? "Parallel return trunks" : "Single return main") + " at " + returnAir.velocityFpm + ' FPM (' + formatNumber(returnAir.velocityMps || 0, 1) + ' m/s)</div><div class="duct-meta">Circular: Ø' + returnAir.trunkDuct.dia_in + '" per trunk | ' + formatInt(returnAir.perTrunkCFM) + ' CFM/trunk</div><div class="duct-meta">' + escapeHtml(returnAir.reason) + "</div></div>"
      + processCardMarkup(processAir);

    byId("duct-tbody").innerHTML =
      '<tr><td>' + (supply.isMultiple ? "Supply trunk (each of " + supply.trunkCount + ")" : "Main supply") + '</td><td>' + formatInt(supply.perTrunkCFM) + "</td><td>" + supply.velocityFpm + "</td><td>" + supply.trunkDuct.rectW + "x" + supply.trunkDuct.rectH + "</td><td>Ø" + supply.trunkDuct.dia_in + '</td><td class="num">' + formatNumber(supply.trunkDuct.area_ft2, 3) + "</td></tr>"
      + (supply.isMultiple
        ? '<tr><td>Combined supply trunks</td><td>' + formatInt(supply.totalCFM) + '</td><td>-</td><td>' + supply.trunkCount + ' trunks</td><td>-</td><td class="num">' + formatNumber(supply.trunkDuct.area_ft2 * supply.trunkCount, 3) + "</td></tr>"
        : "")
      + '<tr><td>Branch per diffuser</td><td>' + formatInt(result.branch_cfm) + "</td><td>" + ((result.ductVelocity && result.ductVelocity.branch) || 500) + "</td><td>" + result.branch_duct.rectW + "x" + result.branch_duct.rectH + "</td><td>Ø" + result.branch_duct.dia_in + '</td><td class="num">' + formatNumber(result.branch_duct.area_ft2, 3) + "</td></tr>"
      + '<tr><td>' + (returnAir.isMultiple ? "Return trunk (each of " + returnAir.trunkCount + ")" : "Return air main") + '</td><td>' + formatInt(returnAir.perTrunkCFM) + "</td><td>" + returnAir.velocityFpm + "</td><td>" + returnAir.trunkDuct.rectW + "x" + returnAir.trunkDuct.rectH + "</td><td>Ø" + returnAir.trunkDuct.dia_in + '</td><td class="num">' + formatNumber(returnAir.trunkDuct.area_ft2, 3) + "</td></tr>"
      + (returnAir.isMultiple
        ? '<tr><td>Combined return trunks</td><td>' + formatInt(returnAir.totalCFM) + '</td><td>-</td><td>' + returnAir.trunkCount + ' trunks</td><td>-</td><td class="num">' + formatNumber(returnAir.trunkDuct.area_ft2 * returnAir.trunkCount, 3) + "</td></tr>"
        : "")
      + (processAir
        ? (processAir.distributed
            ? '<tr><td>Process / make-up air</td><td>' + formatInt(processAir.totalCFM) + '</td><td>-</td><td>Distributed ventilation</td><td>' + escapeHtml(processAir.deviceType || "Axial fan / louver") + '</td><td class="num">No trunk duct network</td></tr>'
              + '<tr><td>Distributed devices</td><td>' + formatInt(processAir.cfmPerDevice) + '</td><td>-</td><td>' + escapeHtml(processAir.deviceCount + " devices") + '</td><td>-</td><td class="num">Handled outside comfort duct BOQ</td></tr>'
            : '<tr><td>' + (processAir.isMultiple ? "Make-up air trunk (each of " + processAir.trunkCount + ")" : "Process / make-up air main") + '</td><td>' + formatInt(processAir.perTrunkCFM) + "</td><td>" + processAir.velocityFpm + "</td><td>" + processAir.trunkDuct.rectW + "x" + processAir.trunkDuct.rectH + "</td><td>Ø" + processAir.trunkDuct.dia_in + '</td><td class="num">' + formatNumber(processAir.trunkDuct.area_ft2, 3) + "</td></tr>"
              + (processAir.isMultiple
                ? '<tr><td>Combined make-up air trunks</td><td>' + formatInt(processAir.totalCFM) + '</td><td>-</td><td>' + processAir.trunkCount + ' trunks</td><td>-</td><td class="num">' + formatNumber(processAir.trunkDuct.area_ft2 * processAir.trunkCount, 3) + "</td></tr>"
                : ""))
        : "")
      + zoneRows;

    if (alternativeCards) {
      byId("duct-tbody").innerHTML += '<tr><td colspan="6" style="padding:10px 0 0 0;border:none;background:transparent;">'
        + '<div style="display:grid;gap:8px;">' + alternativeCards + "</div></td></tr>";
    }
  }

  function renderEsp(result) {
    setMetric("m-esp-duct", formatInt(result.duct_friction), "Pa");
    setMetric("m-esp-fit", formatInt(result.fitting_loss), "Pa");
    setMetric("m-esp-equip", formatInt(result.equipment_loss), "Pa");
    setMetric("m-esp-total", formatInt(result.total_esp), "Pa");

    byId("esp-table-wrap").innerHTML =
      '<div class="esp-row" style="border-radius:var(--r) var(--r) 0 0;overflow:hidden;">'
      + '<div class="esp-header">COMPONENT</div><div class="esp-header">QTY / LEN</div><div class="esp-header">UNIT LOSS (Pa)</div><div class="esp-header">TOTAL (Pa)</div><div class="esp-header">CATEGORY</div>'
      + "</div>"
      + espRowMarkup("Main supply duct", formatNumber(result.duct_len_ft, 0) + " ft", formatNumber(FRICTION_RATE * 0.3048, 3) + "/ft", formatInt(result.duct_friction), "DUCT")
      + espRowMarkup("Elbows / transitions", "Equivalent length", "-", formatInt(result.fitting_loss * 0.55), "FITTING")
      + espRowMarkup("Branches / junctions", "Equivalent length", "-", formatInt(result.fitting_loss * 0.45), "FITTING")
      + espRowMarkup("Cooling coil", "1 ea", EQUIP_PRESSURE.cooling_coil, EQUIP_PRESSURE.cooling_coil, "EQUIP")
      + espRowMarkup("Filter section", "1 ea", EQUIP_PRESSURE.filter_clean, EQUIP_PRESSURE.filter_clean, "EQUIP")
      + espRowMarkup("Mixing box and terminals", "1 set", formatInt(result.equipment_loss - EQUIP_PRESSURE.cooling_coil - EQUIP_PRESSURE.filter_clean), formatInt(result.equipment_loss - EQUIP_PRESSURE.cooling_coil - EQUIP_PRESSURE.filter_clean), "EQUIP")
      + '<div class="esp-row esp-total-row"><div class="esp-cell"><b>TOTAL ESP</b></div><div class="esp-cell">-</div><div class="esp-cell">-</div><div class="esp-cell num"><b>' + formatInt(result.total_esp) + ' Pa</b></div><div class="esp-cell" style="color:var(--accent3);font-size:10px;font-family:var(--mono);">' + formatNumber(result.total_esp / 249.09, 2) + " in.w.g.</div></div>";
  }

  function renderEquipment(result) {
    const zoneAhuStrategy = result.zoneAhuStrategy || { mode: "single_ahu", modeLabel: "Single AHU", clusters: [] };
    const selection = zoneAhuStrategy.aggregateSelection || result.equipmentSelection;
    const ahu = selection.ahu;
    const fan = selection.fan;
    const systemRecommendation = result.systemRecommendation || {};
    const designConstraints = result.designConstraints || { status: "APPROVED", summary: "", actions: [] };
    const energyOptimization = result.energyOptimization || { suggestions: [], summary: selection.optimizationNote || "" };
    const ahuStatus = ahu.adequate ? (ahu.meetsMarginTarget ? "PREFERRED" : "ADEQUATE") : "REVIEW";
    const configurationLabel = (ahu.coolingUnitCount > 1 ? ahu.coolingUnitCount + " cooling modules" : "Single cooling module")
      + " | "
      + (ahu.airSectionCount > 1 ? ahu.airSectionCount + " parallel air sections" : "Single air section");
    const reserveSummary = (ahu.reserveTR >= 0 ? "+" : "") + formatNumber(ahu.reserveTR, 2)
      + " TR / "
      + (ahu.reserveCFM >= 0 ? "+" : "") + formatInt(ahu.reserveCFM)
      + " CFM / "
      + (ahu.reserveESP >= 0 ? "+" : "") + formatInt(ahu.reserveESP)
      + " Pa";
    const conditionedAirflow = result.cfm_conditioned || result.Q_sup_cfm || result.cfm_final;
    const totalRoomAirflow = result.cfm_final || conditionedAirflow;
    const processAirflow = result.cfm_process_excess || 0;
    const processAirSelection = result.processAirSelection;
    const airsideProfile = result.airsideProfile || {};
    const motorPerUnitValues = zoneAhuStrategy.clusters && zoneAhuStrategy.clusters.length
      ? zoneAhuStrategy.clusters.map(function (cluster) {
          return roundTo(cluster.selection.recommendedMotorKWPerUnit || 0, 2);
        }).filter(function (value, index, list) {
          return list.indexOf(value) === index;
        })
      : [roundTo(selection.recommendedMotorKWPerUnit || 0, 2)];
    const motorBasisText = motorPerUnitValues.length <= 1
      ? formatNumber(selection.recommendedMotorKWPerUnit, 2) + " kW per fan section x " + Math.max(fan.unitCount || ahu.airSectionCount || 1, 1)
      : "Motor sizes vary by deployed AHU cluster; see deployment schedule below";
    const deployedModelsText = ahu.deployedModels && ahu.deployedModels.length
      ? ahu.deployedModels.join(" | ")
      : ahu.model;
    const clusterMarkup = zoneAhuStrategy.clusters && zoneAhuStrategy.clusters.length
      ? zoneAhuStrategy.clusters.map(function (cluster) {
          return cluster.name + ": " + cluster.zoneNames.join(", ") + " | " + formatNumber(cluster.trFinal, 1) + " TR | "
            + formatInt(cluster.conditionedCFM) + " CFM | " + formatInt(cluster.peakESP) + " Pa";
        }).join(" || ")
      : zoneAhuStrategy.summary || "Single AHU strategy";
    const clusterSchedule = zoneAhuStrategy.clusters && zoneAhuStrategy.clusters.length > 1
      ? '<div style="margin-top:12px;"><table class="calc-table"><thead><tr><th>DEPLOYED AHU</th><th>ZONES</th><th>MODEL</th><th>TR</th><th>CFM</th><th>ESP</th><th>FAN</th><th>MOTOR</th></tr></thead><tbody>'
        + zoneAhuStrategy.clusters.map(function (cluster) {
          return '<tr><td>' + escapeHtml(cluster.name) + '</td><td>' + escapeHtml(cluster.zoneNames.join(", ")) + '</td><td>' + escapeHtml(cluster.selection.ahu.model) + '</td><td class="num">' + formatNumber(cluster.selection.ahu.capacityTR, 1) + '</td><td class="num">' + formatInt(cluster.conditionedCFM) + '</td><td class="num">' + formatInt(cluster.peakESP) + '</td><td>' + escapeHtml(cluster.selection.fan.type) + '</td><td class="num">' + formatNumber(cluster.selection.recommendedMotorKW, 2) + ' kW</td></tr>';
        }).join("")
        + "</tbody></table></div>"
      : "";
    const airflowPenaltyText = processAirflow > 0
      ? (airsideProfile.processVentilationStrategy === "localized_capture"
          ? formatInt(processAirflow) + " CFM is modeled as localized exhaust / make-up air outside the recirculation AHUs."
          : formatInt(processAirflow) + " CFM of ACH / make-up air has been separated from the cooling AHU.")
      : selection.airflowPenaltyPercent > 0
        ? "+" + formatNumber(selection.airflowPenaltyPercent, 1) + "% airflow above nominal cooling-air quantity"
        : "No airflow penalty above nominal cooling-air quantity";
    const optimizationNoteText = processAirflow > 0
      ? (airsideProfile.processVentilationStrategy === "localized_capture"
          ? "Large industrial halls should use general hall ventilation plus localized exhaust / make-up air, not full-volume process ACH. Heat recovery is recommended on that separate process-air path."
          : "ACH excess is decoupled from the cooling airflow. Use a separate make-up / exhaust path so the comfort-cooling AHU and psychrometric process stay physically valid.")
      : (selection.optimizationNote || "No additional optimization note.");

    setMetric("m-fan-cfm", formatInt(conditionedAirflow), "CFM");
    setMetric("m-fan-esp", formatInt(ahu.designESP || result.total_esp), "Pa");
    setMetric("m-fan-ahu", deployedModelsText + " / " + formatNumber(ahu.capacityTR, 1) + " TR coil");
    setMetric("m-fan-type", fan.unitCount > 1 ? fan.type + " x" + fan.unitCount : fan.type);
    setMetric("m-fan-kw", formatNumber(selection.recommendedMotorKW, 2), "kW");

    byId("fan-detail").innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px;">'
      + '<div style="padding:12px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);">'
      + '<div style="font-size:10px;font-family:var(--mono);letter-spacing:.08em;color:var(--text3);margin-bottom:6px;">AUTO SYSTEM RECOMMENDATION</div>'
      + '<div style="font-size:13px;color:var(--text);font-weight:600;margin-bottom:6px;">' + escapeHtml(systemRecommendation.primarySystem || "Awaiting recommendation") + "</div>"
      + '<div style="font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;">' + escapeHtml(systemRecommendation.reasoning || "System family will be inferred from airflow, zoning, and process-air behavior.") + "</div>"
      + (systemRecommendation.secondarySystems && systemRecommendation.secondarySystems.length
        ? '<div style="margin-top:8px;font-size:10px;color:var(--text3);font-family:var(--mono);">Secondary systems: ' + escapeHtml(systemRecommendation.secondarySystems.join(" | ")) + "</div>"
        : "")
      + "</div>"
      + '<div style="padding:12px 14px;background:var(--bg3);border:1px solid ' + (designConstraints.status === "REJECTED" ? "rgba(239,68,68,0.35)" : designConstraints.status === "REVIEW" ? "rgba(245,158,11,0.35)" : "rgba(0,201,167,0.25)") + ';border-radius:var(--r);">'
      + '<div style="font-size:10px;font-family:var(--mono);letter-spacing:.08em;color:var(--text3);margin-bottom:6px;">CONSTRAINT-BASED DESIGN CHECK</div>'
      + '<div style="font-size:13px;font-weight:600;color:' + (designConstraints.status === "REJECTED" ? "var(--accent4)" : designConstraints.status === "REVIEW" ? "var(--accent3)" : "var(--accent)") + ';">' + escapeHtml(designConstraints.status) + "</div>"
      + '<div style="font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;margin-top:6px;">' + escapeHtml(designConstraints.summary || "Constraint check complete.") + "</div>"
      + (designConstraints.actions && designConstraints.actions.length
        ? '<div style="margin-top:8px;font-size:10px;color:var(--text3);font-family:var(--mono);">Required actions: ' + escapeHtml(designConstraints.actions.join(" | ")) + "</div>"
        : "")
      + "</div>"
      + '<div style="padding:12px 14px;background:var(--bg3);border:1px solid rgba(22,102,169,0.2);border-radius:var(--r);">'
      + '<div style="font-size:10px;font-family:var(--mono);letter-spacing:.08em;color:var(--text3);margin-bottom:6px;">ENERGY OPTIMIZATION</div>'
      + '<div style="font-size:13px;font-weight:600;color:var(--text);">' + escapeHtml(energyOptimization.summary || optimizationNoteText) + "</div>"
      + '<div style="font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;margin-top:6px;">Operational SFP: ' + formatNumber(energyOptimization.specificFanPowerKWPerTR || selection.specificFanPowerKWPerTR || 0, 2) + ' kW/TR | Motor index: ' + formatNumber(energyOptimization.installedMotorSpecificFanPowerKWPerTR || selection.installedMotorSpecificFanPowerKWPerTR || selection.specificFanPowerKWPerTR || 0, 2) + ' kW/TR | Process ratio: ' + formatNumber(energyOptimization.processAirRatio || 0, 2) + 'x</div>'
      + (energyOptimization.suggestions && energyOptimization.suggestions.length
        ? '<div style="margin-top:8px;font-size:10px;color:var(--text3);font-family:var(--mono);">Actions: ' + escapeHtml(energyOptimization.suggestions.join(" | ")) + "</div>"
        : "")
      + "</div>"
      + "</div>"
      + '<table class="calc-table"><thead><tr><th>PARAMETER</th><th>VALUE</th><th>UNIT</th><th>SELECTION BASIS</th></tr></thead><tbody>'
      + '<tr><td>Suggested AHU</td><td class="num">' + escapeHtml(deployedModelsText) + "</td><td>-</td><td>" + ahu.selectionNote + "</td></tr>"
      + '<tr><td>AHU deployment</td><td class="num">' + escapeHtml(zoneAhuStrategy.modeLabel || "Single AHU") + "</td><td>-</td><td>" + escapeHtml(clusterMarkup) + "</td></tr>"
      + '<tr><td>AHU configuration</td><td class="num">' + configurationLabel + "</td><td>-</td><td>Cooling capacity is selected from TR duty; airflow is handled through zone or cluster air sections and fan duty.</td></tr>"
      + '<tr><td>TR_final duty</td><td class="num">' + formatNumber(ahu.requiredTRFinal, 2) + "</td><td>TR</td><td>" + ahu.sizingBasis + "</td></tr>"
      + '<tr><td>TR_catalog basis</td><td class="num">' + formatNumber(ahu.requiredCatalogTR, 2) + "</td><td>TR</td><td>Catalog threshold used for selection</td></tr>"
      + '<tr><td>Preferred reserve target</td><td class="num">' + formatNumber(ahu.preferredTargetTR, 2) + "</td><td>TR</td><td>10-20% reserve target for equipment check</td></tr>"
      + '<tr><td>Cooling capacity selected</td><td class="num">' + formatNumber(ahu.capacityTR, 1) + "</td><td>TR</td><td>Cooling coil selected from load, not from airflow multiplication</td></tr>"
      + '<tr><td>Cooling nominal airflow</td><td class="num">' + formatInt(ahu.coolingNominalAirflowCFM) + "</td><td>CFM</td><td>Nominal airflow associated with the selected cooling capacity</td></tr>"
      + '<tr><td>Airflow multiplier</td><td class="num">' + formatNumber(ahu.airflowMultiplier, 2) + "x</td><td>-</td><td>" + airflowPenaltyText + "</td></tr>"
      + '<tr><td>Airflow window</td><td class="num">' + formatInt(ahu.minAirflowCFM) + " - " + formatInt(ahu.maxAirflowCFM) + "</td><td>CFM</td><td>" + formatInt(ahu.minAirflowCFMPerUnit) + " - " + formatInt(ahu.maxAirflowCFMPerUnit) + " CFM per air section</td></tr>"
      + '<tr><td>Conditioned design airflow</td><td class="num">' + formatInt(conditionedAirflow) + "</td><td>CFM</td><td>" + formatInt(ahu.designCFMPerTR || 0) + " CFM/TR on cooling-air basis | " + formatInt(ahu.perUnitDutyCFM) + " CFM per air section</td></tr>"
      + '<tr><td>Total room airflow</td><td class="num">' + formatInt(totalRoomAirflow) + "</td><td>CFM</td><td>" + (processAirflow > 0 ? formatInt(processAirflow) + " CFM is separate ACH / make-up air outside the cooling coil" : "All room airflow is handled by the cooling air stream") + "</td></tr>"
      + '<tr><td>Design ESP</td><td class="num">' + formatInt(ahu.designESP || result.total_esp) + "</td><td>Pa</td><td>Controlling cluster / zone external static pressure</td></tr>"
      + '<tr><td>AHU reserve</td><td class="num">' + reserveSummary + "</td><td>-</td><td>" + (ahu.adequate ? (ahu.meetsMarginTarget ? "Positive reserve meets preferred target" : "Positive reserve available, but below preferred target") : "Nearest available database model is short on one or more criteria") + "</td></tr>"
      + '<tr><td>Reserve margin</td><td class="num">' + formatNumber(ahu.marginPercent, 1) + "</td><td>%</td><td>Coil capacity margin over TR_final</td></tr>"
      + '<tr><td>Fan type</td><td class="num">' + fan.type + "</td><td>-</td><td>" + (fan.type === fan.preferredType || fan.type === "Mixed" ? "Selected from deployed cluster duty points" : "Closest fan curve selected; pressure preference was " + fan.preferredType) + (ahu.airSectionCount > 1 ? " | selected on per-section airflow duty" : "") + (fan.typesUsed && fan.typesUsed.length > 1 ? " | fan families used: " + fan.typesUsed.join(", ") : "") + "</td></tr>"
      + '<tr><td>Curve match</td><td class="num">' + fan.curveId + "</td><td>-</td><td>" + escapeHtml(fan.selectionNote || (fan.withinRange ? "Operating point falls inside the fan catalog window" : "Closest available fan curve - verify against vendor selection")) + " | " + formatInt(fan.dutyCFM || conditionedAirflow) + " CFM per fan section</td></tr>"
      + '<tr><td>Brake power</td><td class="num">' + formatNumber(fan.brakeKWTotal || 0, 2) + "</td><td>kW</td><td>" + formatNumber(fan.brakeKW || 0, 2) + " kW per fan section before motor sizing</td></tr>"
      + '<tr><td>Installed motor</td><td class="num">' + formatNumber(selection.recommendedMotorKW, 2) + "</td><td>kW</td><td>" + escapeHtml(motorBasisText) + "</td></tr>"
      + '<tr><td>Specific fan power</td><td class="num">' + formatNumber(selection.specificFanPowerKWPerTR, 2) + "</td><td>kW/TR</td><td>Operating fan electrical power divided by TR_final duty</td></tr>"
      + '<tr><td>Installed motor index</td><td class="num">' + formatNumber(selection.installedMotorSpecificFanPowerKWPerTR || selection.specificFanPowerKWPerTR, 2) + "</td><td>kW/TR</td><td>Installed motor kW divided by TR_final duty for allowance / feeder planning</td></tr>"
      + '<tr><td>Airflow energy penalty</td><td class="num">' + formatNumber(selection.airflowPenaltyRatio, 2) + "x</td><td>-</td><td>" + airflowPenaltyText + "</td></tr>"
      + (processAirflow > 0
        ? '<tr><td>Process / make-up air</td><td class="num">' + formatInt(processAirflow) + "</td><td>CFM</td><td>" + (processAirSelection ? processAirSelection.type + " fan at approx. " + formatNumber(processAirSelection.motorKW, 2) + " kW" : "Separate ventilation path recommended") + "</td></tr>"
        : "")
      + '<tr><td>Optimization note</td><td colspan="3">' + escapeHtml(optimizationNoteText) + "</td></tr>"
      + '<tr class="total-row"><td><b>Selection status</b></td><td class="num"><b>' + ahuStatus + '</b></td><td colspan="2" style="color:' + (ahu.adequate ? "var(--accent)" : "var(--accent4)") + ';">' + formatInt(conditionedAirflow) + " conditioned CFM @ " + formatInt(ahu.designESP || result.total_esp) + " Pa</td></tr>"
      + "</tbody></table>"
      + clusterSchedule;
  }

  function renderDiffuser(result) {
    const layout = result.diffuserLayout;
    const zoning = result.autoZoning || { zoneCount: 1, rows: 1, cols: 1, basis: "" };
    const designConstraints = result.designConstraints || { status: "APPROVED" };
    setMetric("m-diff-sup", formatInt(layout.diffuserCount));
    setMetric("m-diff-ret", formatInt(layout.returns.count));
    setMetric("m-diff-cfm", formatInt(layout.cfmPerDiffuser), "CFM");
    setMetric("m-diff-area", formatNumber(layout.returns.totalArea, 3), "m2");
    const symbolPrefix = layout.symbolPrefix || "S";

    const coordinates = layout.supplies.map(function (point, index) {
      return '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;background:rgba(0,212,170,0.08);border:1px solid rgba(0,212,170,0.2);border-radius:3px;color:var(--accent);">' + symbolPrefix + (index + 1) + ": (" + point.x + ", " + point.y + ")</span>";
    }).join("");

    const returnCoordinates = layout.returns.coords.map(function (point, index) {
      return '<span style="font-family:var(--mono);font-size:9px;padding:2px 6px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:3px;color:var(--accent3);">R' + (index + 1) + ": (" + point.x + ", " + point.y + ")</span>";
    }).join("");

    byId("diffuser-detail").innerHTML =
      '<div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;align-items:start;">'
      + '<div><svg width="100%" viewBox="0 0 560 340" style="display:block;background:#fff;border:1px solid var(--border);border-radius:var(--r);">' + DiffuserLayout.renderLayoutSvg(parseFloat(result.inputs.len), parseFloat(result.inputs.wid), layout) + "</svg></div>"
      + '<div>'
      + '<table class="calc-table"><tbody>'
      + '<tr><td>Supply outlets</td><td class="num">' + formatInt(layout.diffuserCount) + " nos</td></tr>"
      + '<tr><td>Supply device type</td><td class="num">' + escapeHtml(layout.supplyDeviceType) + "</td></tr>"
      + '<tr><td>Distribution mode</td><td class="num">' + escapeHtml(layout.distributionMode) + "</td></tr>"
      + '<tr><td>Auto zoning</td><td class="num">' + (zoning.zoneCount > 1 ? zoning.zoneCount + " zones (" + zoning.rows + " x " + zoning.cols + ")" : "Single zone") + "</td></tr>"
      + '<tr><td>Zone size</td><td class="num">' + formatNumber(zoning.zoneLength || parseFloat(result.inputs.len) || 0, 2) + " x " + formatNumber(zoning.zoneWidth || parseFloat(result.inputs.wid) || 0, 2) + " m</td></tr>"
      + '<tr><td>CFM per outlet</td><td class="num">' + formatInt(layout.cfmPerDiffuser) + " CFM</td></tr>"
      + '<tr><td>Preferred airflow band</td><td class="num">' + formatInt(layout.minCFMPerDiffuser) + " - " + formatInt(layout.maxCFMPerDiffuser) + " CFM</td></tr>"
      + '<tr><td>Feasible outlet count band</td><td class="num">' + formatInt(layout.minCountWithoutOversizing) + " - " + formatInt(layout.maxCountWithoutUndersizing) + "</td></tr>"
      + '<tr><td>Airflow density</td><td class="num">' + formatNumber(layout.airflowPerArea, 1) + " CFM/m2</td></tr>"
      + '<tr><td>Industrial switch threshold</td><td class="num">' + formatNumber(layout.airflowPerAreaThreshold, 1) + " CFM/m2</td></tr>"
      + '<tr><td>' + (layout.isAutoZoned ? "Per-zone diffuser grid" : "Grid layout") + '</td><td class="num">' + layout.rows + " x " + layout.cols + "</td></tr>"
      + '<tr><td>Spacing X</td><td class="num">' + formatNumber(layout.spacingX, 2) + " m</td></tr>"
      + '<tr><td>Spacing Y</td><td class="num">' + formatNumber(layout.spacingY, 2) + " m</td></tr>"
      + '<tr><td>Max spacing (' + formatNumber(layout.maxSpacingFactor, 2) + 'H)</td><td class="num">' + formatNumber(layout.maxSpacing, 2) + " m</td></tr>"
      + '<tr><td>Wall offset</td><td class="num">' + formatNumber(layout.wallOffset, 2) + " m</td></tr>"
      + '<tr><td>Estimated throw</td><td class="num">' + formatNumber(layout.throwDistance, 2) + " m</td></tr>"
      + '<tr><td>Required throw</td><td class="num">' + formatNumber(layout.requiredThrow, 2) + " m</td></tr>"
      + '<tr><td>Airflow band check</td><td class="num" style="color:' + (layout.cfmRangePass ? "var(--accent)" : "var(--accent3)") + ';">' + (layout.cfmRangePass ? "PASS" : "REVIEW") + "</td></tr>"
      + '<tr><td>Undersizing protection</td><td class="num" style="color:' + (layout.undersizingProtected ? "var(--accent)" : "var(--accent4)") + ';">' + (layout.undersizingProtected ? "ACTIVE" : "REVIEW") + "</td></tr>"
      + '<tr><td>Spacing check</td><td class="num" style="color:' + (layout.spacingPass ? "var(--accent)" : "var(--accent4)") + ';">' + (layout.spacingPass ? "PASS" : "FAIL") + "</td></tr>"
      + '<tr><td>Throw check</td><td class="num" style="color:' + (layout.throwPass ? "var(--accent)" : "var(--accent4)") + ';">' + (layout.throwPass ? "PASS" : "FAIL") + "</td></tr>"
      + '<tr><td>Design feasibility</td><td class="num" style="color:' + (designConstraints.status === "REJECTED" ? "var(--accent4)" : designConstraints.status === "REVIEW" ? "var(--accent3)" : "var(--accent)") + ';">' + escapeHtml(designConstraints.status) + "</td></tr>"
      + '<tr><td>Return grille type</td><td class="num">' + layout.returns.type + "</td></tr>"
      + '<tr><td>Return grille size</td><td class="num">' + formatNumber(layout.returns.width, 2) + " x " + formatNumber(layout.returns.height, 2) + " m</td></tr>"
      + '<tr><td>Return total area</td><td class="num">' + formatNumber(layout.returns.totalArea, 3) + " m2</td></tr>"
      + '<tr><td>Return max face velocity</td><td class="num">' + formatNumber(layout.returns.maxFaceVelocity, 2) + " m/s</td></tr>"
      + "</tbody></table>"
      + '<div style="margin-top:10px;padding:10px 12px;background:var(--bg3);border-radius:var(--r);font-size:11px;color:var(--text2);font-family:var(--mono);">' + escapeHtml(layout.selectionBasis) + "</div>"
      + (zoning.zoneCount > 1
        ? '<div style="margin-top:10px;padding:10px 12px;background:rgba(15,118,110,0.08);border:1px solid rgba(15,118,110,0.2);border-radius:var(--r);font-size:11px;color:var(--text2);font-family:var(--mono);">' + escapeHtml(zoning.basis || "Room was automatically split into smaller zones to keep coverage, airflow, and controllability within defendable limits.") + "</div>"
        : "")
      + ((layout.zoningRecommended || layout.highThrowRecommended)
        ? '<div style="margin-top:10px;padding:10px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.22);border-radius:var(--r);font-size:11px;color:var(--text2);font-family:var(--mono);">'
          + escapeHtml(layout.zoningRecommended
            ? "Coverage spacing would require more outlets than the minimum outlet airflow allows. Split the room into zones or use a higher-throw terminal family instead of adding undersized diffusers."
            : "Required throw is not achieved inside the protected outlet-airflow band. Use a higher-throw device or revise zoning before increasing diffuser count.")
          + "</div>"
        : "")
      + '<div style="margin-top:12px;"><div style="font-size:9.5px;font-family:var(--mono);color:var(--accent);letter-spacing:.07em;margin-bottom:6px;">SUPPLY COORDINATES</div><div style="display:flex;flex-wrap:wrap;gap:4px;max-height:92px;overflow:auto;padding-right:4px;">' + coordinates + "</div></div>"
      + '<div style="margin-top:12px;"><div style="font-size:9.5px;font-family:var(--mono);color:var(--accent3);letter-spacing:.07em;margin-bottom:6px;">RETURN COORDINATES</div><div style="display:flex;flex-wrap:wrap;gap:4px;max-height:72px;overflow:auto;padding-right:4px;">' + returnCoordinates + "</div></div>"
      + "</div></div>";
  }

  function renderPsychrometrics(result) {
    if (typeof renderPsychro === "function") {
      renderPsychro("psychro-outdoor", [
        ["DBT", formatNumber(parseFloat(result.inputs.out_dbt), 1), "deg C"],
        ["WBT", formatNumber(result.psychro.wb_out, 1), "deg C"],
        ["Dew Point", formatNumber(result.psychro.dp_out, 1), "deg C"],
        ["RH", formatNumber(result.outdoorRelativeHumidity, 0), "%"],
        ["Humidity Ratio", formatNumber(result.psychro.W_out * 1000, 1), "g/kg"],
        ["Enthalpy", formatNumber(result.psychro.h_out, 1), "kJ/kg"],
        ["Specific Volume", formatNumber(result.psychro.sv_out, 2), "m3/kg"]
      ]);
      renderPsychro("psychro-indoor", [
        ["DBT", formatNumber(parseFloat(result.inputs.in_dbt), 1), "deg C"],
        ["WBT", formatNumber(result.psychro.wb_in, 1), "deg C"],
        ["Dew Point", formatNumber(result.psychro.dp_in, 1), "deg C"],
        ["RH", formatNumber(parseFloat(result.inputs.in_rh), 0), "%"],
        ["Humidity Ratio", formatNumber(result.psychro.W_in * 1000, 1), "g/kg"],
        ["Enthalpy", formatNumber(result.psychro.h_in, 1), "kJ/kg"],
        ["Specific Volume", formatNumber(result.psychro.sv_in, 2), "m3/kg"]
      ]);
    }

    byId("coil-detail").innerHTML =
      '<table class="calc-table"><thead><tr><th>PARAMETER</th><th>VALUE</th><th>UNIT</th><th>BASIS</th></tr></thead><tbody>'
      + '<tr><td>Mixed air DBT</td><td class="num">' + formatNumber(result.psychro.mixedAirTemp, 1) + "</td><td>deg C</td><td>Adiabatic mix of outdoor and return air by dry-air mass fraction</td></tr>"
      + '<tr><td>Supply air DBT</td><td class="num">' + formatNumber(result.psychro.supplyTemp, 1) + "</td><td>deg C</td><td>From room sensible balance at conditioned cooling airflow</td></tr>"
      + '<tr><td>Supply humidity ratio</td><td class="num">' + formatNumber(result.psychro.supplyHumidity * 1000, 2) + "</td><td>g/kg</td><td>From room total-load enthalpy balance</td></tr>"
      + '<tr><td>Coil ADP</td><td class="num">' + formatNumber(result.psychro.adpTemp, 1) + "</td><td>deg C</td><td>BF-consistent saturated apparatus point solved from the MA-SA coil process</td></tr>"
      + '<tr><td>Bypass factor</td><td class="num">' + formatNumber(result.psychro.bypassFactor, 3) + "</td><td>-</td><td>Average of temperature-side and humidity-side BF at the selected ADP</td></tr>"
      + '<tr><td>BF consistency</td><td class="num">' + formatNumber(Math.abs((result.psychro.bfTemp || result.psychro.bypassFactor || 0) - (result.psychro.bfHumidity || result.psychro.bypassFactor || 0)), 3) + '</td><td>-</td><td>' + escapeHtml((result.psychro.adpMethod || 'bf_consistent_search').replace(/_/g, " ")) + ' | humidity residual ' + formatNumber(result.psychro.adpHumidityError || 0, 3) + ' g/kg</td></tr>'
      + '<tr><td>OA fraction</td><td class="num">' + formatNumber(result.psychro.oaFraction * 100, 1) + "</td><td>%</td><td>Outdoor air share in mixed air, without artificial capping</td></tr>"
      + '<tr><td>Coil total load</td><td class="num">' + formatNumber(result.psychro.coilTotalLoad / 3517, 2) + "</td><td>TR</td><td>Psychrometric coil duty from MA to SA on the conditioned cooling stream</td></tr>"
      + (result.psychro.processNote
        ? '<tr><td>Process note</td><td colspan="3">' + escapeHtml(result.psychro.processNote) + "</td></tr>"
        : "")
      + '<tr class="total-row"><td><b>Recommended coil</b></td><td colspan="3"><b>' + (result.shr > 0.85 ? "Standard chilled-water / DX coil" : "Deep cooling coil with tighter bypass factor") + "</b></td></tr>"
      + "</tbody></table>";
  }

  function renderSolarPanel(result) {
    const peak = result.solar.curve.reduce(function (best, row) {
      return row.shgf > best.shgf ? row : best;
    }, result.solar.curve[0]);

    setMetric("m-solar-design", formatInt(result.solar.point.shgf), "W/m2");
    setMetric("m-solar-peak", peak.hour + ":00");
    setMetric("m-solar-alt", formatNumber(result.solar.point.altitude, 1), "deg");
    setMetric("m-solar-az", formatNumber(result.solar.point.azimuth, 1), "deg");

    SolarEngine.renderChart(byId("solar-chart"), {
      latitude: result.solar.latitude,
      dayOfYear: result.solar.dayOfYear,
      hours: result.solar.curve.map(function (row) { return row.hour; }),
      activeOrientation: result.inputs.win_orient,
      activeCurve: result.solar.curve,
      designPoint: result.solar.point,
      series: result.solar.orientationSeries
    });

    byId("solar-table").innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">'
      + result.solar.curve.map(function (row) {
        return '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:7px 10px;text-align:center;min-width:78px;">'
          + '<div style="font-size:9px;color:var(--text3);font-family:var(--mono);">' + row.hour + ':00</div>'
          + '<div style="font-family:var(--mono);font-size:14px;color:var(--accent3);">' + formatInt(row.shgf) + '</div>'
          + '<div style="font-size:9px;color:var(--text3);">' + formatNumber(row.altitude, 1) + " deg alt</div>"
          + "</div>";
      }).join("")
      + "</div>";

    byId("solar-all-tbody").innerHTML = result.solar.curve.map(function (row, index) {
      const hourlyAll = result.solar.orientationSeries.map(function (series) {
        return '<td class="num">' + formatInt(series.points[index].shgf) + "</td>";
      }).join("");
      return "<tr><td>" + row.hour + ":00</td><td>" + formatNumber(row.altitude, 1) + "</td><td>" + formatNumber(row.azimuth, 0) + "</td>" + hourlyAll + "</tr>";
    }).join("");
  }

  function renderPsychroChart(result) {
    PsychroChart.renderChart(
      byId("psychro-chart-svg"),
      byId("psychro-chart-legend"),
      byId("psychro-chart-table"),
      result.statePoints,
      {
        pressurePa: 101325 * Math.pow(1 - 2.25577e-5 * Math.max(0, parseFloat(result.inputs.out_elev) || 0), 5.25588),
        shr: result.roomShr || result.shr,
        bypassFactor: result.psychro.bypassFactor
      }
    );
  }

  function reportBlock(title, body, className) {
    return '<div class="report-block' + (className ? " " + className : "") + '"><h4>' + title + "</h4>" + body + "</div>";
  }

  function outerHtml(id) {
    const element = byId(id);
    return element ? element.outerHTML : "";
  }

  function innerHtml(id) {
    const element = byId(id);
    return element ? element.innerHTML : "";
  }

  function clonedSvgMarkup(id, viewBox, height) {
    const element = byId(id);
    if (!element) {
      return '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Graphic unavailable</p>';
    }
    return '<div class="report-visual"><svg width="100%" height="' + height + '" viewBox="' + viewBox + '" style="display:block;font-family:var(--mono);">' + element.innerHTML + "</svg></div>";
  }

  function firstResultsGridMarkup(panelId) {
    const panel = byId(panelId);
    if (!panel) {
      return "";
    }
    const grid = panel.querySelector(".results-grid");
    return grid ? grid.outerHTML : "";
  }

  function defaultEnergyBinHours() {
    return [260, 340, 420, 510, 620, 690, 720, 640, 520, 360, 220, 120, 60, 30];
  }

  function buildEnergyBinData(result) {
    const indoorSetpoint = parseFloat(result.inputs.in_dbt) || 24;
    const designOutdoor = parseFloat(result.inputs.out_dbt) || 40;
    const hoursTemplate = defaultEnergyBinHours();
    const minTemp = Math.max(indoorSetpoint - 2, designOutdoor - 25);
    const maxTemp = Math.max(indoorSetpoint + 10, designOutdoor + 2);
    const span = Math.max(maxTemp - minTemp, 8);

    return hoursTemplate.map(function (hours, index) {
      const ratio = safeDiv(index, hoursTemplate.length - 1, 0);
      const temperature = minTemp + span * ratio;
      return {
        dry_bulb_c: roundTo(temperature, 1),
        hours: hours,
        label: roundTo(temperature, 0) + "°C"
      };
    });
  }

  function buildEnergySimulationPayload(result, room) {
    const project = ProjectManager.getProject();
    const rates = readRates();
    const zoneAhuStrategy = result.zoneAhuStrategy || {};
    const zoneDuctPlan = result.zoneDuctPlan || {};
    const airsideProfile = result.airsideProfile || {};
    const selection = zoneAhuStrategy.aggregateSelection || result.equipmentSelection || {};
    const processStaticPa = result.cfm_process_excess > 0
      ? Math.min(
          Math.max(
            zoneDuctPlan.maxProcessESP || airsideProfile.recommendedProcessStaticPa || result.total_esp * 0.55,
            airsideProfile.recommendedProcessStaticPa || 120
          ),
          airsideProfile.largeIndustrialHall ? 200 : 350
        )
      : 0;
    const processScheduleRatio = result.cfm_process_excess > 0
      ? roundTo(
          airsideProfile.processAirScheduleRatio || (String(result.occupancy_profile || "").toLowerCase().indexOf("industrial") !== -1 ? 0.75 : 0.7),
          2
        )
      : 0;
    const peakLoadKw = Math.max(
      safeDiv(result.psychro && result.psychro.coilTotalLoad, 1000, 0),
      (result.tr_final || 0) * 3.517,
      safeDiv(result.totalLoad, 1000, 0)
    );
    const conditionedFanDesignKw = Math.max(
      roundTo(selection && selection.electricalFanKWTotal ? selection.electricalFanKWTotal : 0, 2),
      roundTo((selection && selection.fan && selection.fan.brakeKWTotal ? selection.fan.brakeKWTotal / 0.92 : 0), 2),
      roundTo(result.motor_kw || selection.recommendedMotorKW || (result.equipmentSelection && result.equipmentSelection.recommendedMotorKW) || 0, 2)
    );

    return {
      roomId: room ? room.id : "",
      calculationId: result.calculationId,
      projectName: project ? project.name : "HVAC Project",
      roomName: room ? room.name : "Room",
      bin_data: buildEnergyBinData(result),
      system_data: {
        option_name: (project ? project.name : "HVAC Project") + " · " + (room ? room.name : "Room"),
        peak_load_kw: roundTo(peakLoadKw, 3),
        design_outdoor_temp_c: parseFloat(result.inputs.out_dbt) || 40,
        indoor_setpoint_c: parseFloat(result.inputs.in_dbt) || 24,
        conditioned_airflow_cfm: roundTo(result.cfm_conditioned || result.Q_sup_cfm || 0, 2),
        process_airflow_cfm: roundTo(result.cfm_process_excess || 0, 2),
        peak_conditioned_fan_kw: conditionedFanDesignKw,
        process_fan_static_pa: roundTo(processStaticPa, 0),
        tariff_per_kwh: roundTo(rates.rate_energy || DEFAULT_RATES.rate_energy, 2),
        process_air_schedule_ratio: roundTo(processScheduleRatio, 2),
        min_ahu_airflow_ratio: 0.30,
        chiller_cop_full_load: 3.5,
        chiller_cop_half_load: 5.0,
        process_fan_efficiency: 0.62,
        process_motor_efficiency: 0.92
      }
    };
  }

  function aggregateProjectEnergy() {
    const project = ProjectManager.getProject();
    if (!project || !project.rooms) {
      return null;
    }

    const reports = project.rooms.map(function (room) {
      return room && room.result && room.result.energySimulation
        ? { room: room, report: room.result.energySimulation }
        : null;
    }).filter(Boolean);

    if (!reports.length) {
      return null;
    }

    const summary = reports.reduce(function (accumulator, entry) {
      const report = entry.report;
      accumulator.annualEnergy += report.annual_energy_kwh || 0;
      accumulator.coolingEnergy += report.cooling_energy || 0;
      accumulator.fanEnergy += report.fan_energy || 0;
      accumulator.processEnergy += report.process_energy || 0;
      accumulator.energyCost += report.energy_cost || 0;
      accumulator.peakPower += report.peak_power_kw || 0;
      accumulator.peakTR += report.peak_tr || 0;
      return accumulator;
    }, {
      annualEnergy: 0,
      coolingEnergy: 0,
      fanEnergy: 0,
      processEnergy: 0,
      energyCost: 0,
      peakPower: 0,
      peakTR: 0
    });

    return {
      roomCount: reports.length,
      annual_energy_kwh: summary.annualEnergy,
      cooling_energy: summary.coolingEnergy,
      fan_energy: summary.fanEnergy,
      process_energy: summary.processEnergy,
      energy_cost: summary.energyCost,
      peak_power_kw: summary.peakPower,
      peak_tr: summary.peakTR,
      system_efficiency: safeDiv(summary.peakPower, summary.peakTR, 0),
      note: "Project roll-up is the sum of room-level annual bin simulations. Diversity/coincidence is not yet applied to annual energy."
    };
  }

  function renderEnergyGraph(report) {
    const svg = byId("energy-chart-svg");
    const note = byId("energy-graph-note");
    if (!svg) {
      return;
    }

    const graphData = report && report.graph_data ? report.graph_data : [];
    if (!graphData.length) {
      svg.innerHTML = '<text x="430" y="160" text-anchor="middle" fill="var(--text3)" font-family="var(--mono)" font-size="12">Annual energy graph will appear after simulation.</text>';
      if (note) {
        note.textContent = "Bin-energy graph unavailable.";
      }
      return;
    }

    const width = 860;
    const height = 320;
    const left = 54;
    const right = 24;
    const top = 18;
    const bottom = 54;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const barWidth = chartWidth / graphData.length;
    const maxEnergy = Math.max.apply(null, graphData.map(function (row) { return row.bin_total_energy_kwh || 0; }).concat([1]));
    const maxPower = Math.max.apply(null, graphData.map(function (row) { return row.total_power_kw || 0; }).concat([1]));
    const linePath = graphData.map(function (row, index) {
      const x = left + barWidth * index + barWidth / 2;
      const y = top + chartHeight - ((row.total_power_kw || 0) / maxPower) * chartHeight;
      return (index ? "L" : "M") + formatNumber(x, 2) + " " + formatNumber(y, 2);
    }).join(" ");

    const bars = graphData.map(function (row, index) {
      const barHeight = ((row.bin_total_energy_kwh || 0) / maxEnergy) * chartHeight;
      const x = left + barWidth * index + barWidth * 0.12;
      const y = top + chartHeight - barHeight;
      return '<g>'
        + '<rect x="' + formatNumber(x, 2) + '" y="' + formatNumber(y, 2) + '" width="' + formatNumber(barWidth * 0.76, 2) + '" height="' + formatNumber(Math.max(barHeight, 2), 2) + '" rx="4" fill="rgba(22,102,169,0.84)"></rect>'
        + '<text x="' + formatNumber(left + barWidth * index + barWidth / 2, 2) + '" y="' + (top + chartHeight + 18) + '" text-anchor="middle" fill="var(--text3)" font-family="var(--mono)" font-size="10">' + escapeHtml(row.bin_temp_c + "°") + "</text>"
        + "</g>";
    }).join("");

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(function (ratio) {
      const y = top + chartHeight - chartHeight * ratio;
      const energy = maxEnergy * ratio;
      return '<g>'
        + '<line x1="' + left + '" y1="' + formatNumber(y, 2) + '" x2="' + (width - right) + '" y2="' + formatNumber(y, 2) + '" stroke="rgba(148,163,184,0.22)" stroke-width="1"></line>'
        + '<text x="' + (left - 10) + '" y="' + formatNumber(y + 4, 2) + '" text-anchor="end" fill="var(--text3)" font-family="var(--mono)" font-size="10">' + formatNumber(energy, 0) + "</text>"
        + "</g>";
    }).join("");

    svg.innerHTML =
      '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#ffffff"></rect>'
      + gridLines
      + '<line x1="' + left + '" y1="' + (top + chartHeight) + '" x2="' + (width - right) + '" y2="' + (top + chartHeight) + '" stroke="rgba(71,85,105,0.55)" stroke-width="1.2"></line>'
      + '<line x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + (top + chartHeight) + '" stroke="rgba(71,85,105,0.55)" stroke-width="1.2"></line>'
      + bars
      + '<path d="' + linePath + '" fill="none" stroke="#00a884" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>'
      + '<text x="' + left + '" y="12" fill="var(--text3)" font-family="var(--mono)" font-size="10">BIN ENERGY (kWh)</text>'
      + '<text x="' + (width - right) + '" y="12" text-anchor="end" fill="#00a884" font-family="var(--mono)" font-size="10">TOTAL POWER (kW)</text>';

    if (note) {
      note.textContent = "Blue bars show bin energy, green line shows total power at each outdoor temperature bin.";
    }
  }

  function renderEnergy(result) {
    const report = result && result.energySimulation ? result.energySimulation : null;
    const status = result && result.energySimulationStatus ? result.energySimulationStatus : (report ? "ready" : "idle");
    const energyOptimization = result && result.energyOptimization ? result.energyOptimization : null;
    const zoneAhuStrategy = result && result.zoneAhuStrategy ? result.zoneAhuStrategy : null;
    const statusNote = byId("energy-status-note");
    const summaryTable = byId("energy-summary-table");
    const projectRollup = byId("energy-project-rollup");
    const warningList = byId("energy-warning-list");
    const inputSummary = byId("energy-input-summary");
    const comparisonBox = byId("energy-comparison-note");
    const projectSummary = aggregateProjectEnergy();

    if (statusNote) {
      if (status === "loading") {
        statusNote.textContent = "Running annual bin-method energy simulation for the active room...";
      } else if (status === "error") {
        statusNote.textContent = result.energySimulationError || "Energy simulation could not be completed.";
      } else if (report) {
        const generatedAt = result.energySimulationMeta && result.energySimulationMeta.generatedAt
          ? new Date(result.energySimulationMeta.generatedAt).toLocaleString()
          : "latest run";
        statusNote.textContent = "Annual energy simulation ready. Generated " + generatedAt + ".";
      } else {
        statusNote.textContent = "Run calculations to generate annual energy simulation.";
      }
    }

    if (!report) {
      setMetric("m-energy-annual", "—");
      setMetric("m-energy-cooling", "—");
      setMetric("m-energy-fan", "—");
      setMetric("m-energy-cost", "—");
      if (summaryTable) {
        summaryTable.innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No energy result available for this room yet.</p>';
      }
      if (projectRollup) {
        projectRollup.innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Project energy roll-up will appear after room simulations complete.</p>';
      }
      if (warningList) {
        warningList.innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No active warnings.</p>';
      }
      if (inputSummary) {
        inputSummary.innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Energy inputs are built automatically from the active cooling, airflow, fan, and process-air calculation results.</p>';
      }
      if (comparisonBox) {
        comparisonBox.textContent = energyOptimization && energyOptimization.summary
          ? energyOptimization.summary
          : "Future-ready hook: compare decoupled process-air strategies or alternate fan/COP packages via the same API.";
      }
      renderEnergyGraph(null);
      return;
    }

    setMetric("m-energy-annual", formatInt(report.annual_energy_kwh), "kWh");
    setMetric("m-energy-cooling", formatInt(report.cooling_energy), "kWh");
    setMetric("m-energy-fan", formatInt((report.fan_energy || 0) + (report.process_energy || 0)), "kWh");
    setMetric("m-energy-cost", formatCurrency(report.energy_cost || 0));

    if (inputSummary) {
      const systemInput = report.system_input || {};
      inputSummary.innerHTML =
        '<table class="calc-table"><tbody>'
        + '<tr><td>Peak cooling load</td><td class="num">' + formatNumber(systemInput.peak_load_kw || 0, 1) + ' kW</td></tr>'
        + '<tr><td>Conditioned airflow</td><td class="num">' + formatInt(systemInput.conditioned_airflow_cfm || 0) + ' CFM</td></tr>'
        + '<tr><td>Process airflow</td><td class="num">' + formatInt(systemInput.process_airflow_cfm || 0) + ' CFM</td></tr>'
        + '<tr><td>Conditioned fan design</td><td class="num">' + formatNumber(systemInput.peak_conditioned_fan_kw || 0, 2) + ' kW</td></tr>'
        + '<tr><td>Process fan static</td><td class="num">' + formatNumber(systemInput.process_fan_static_pa || 0, 0) + ' Pa</td></tr>'
        + '<tr><td>AHU deployment</td><td class="num">' + escapeHtml(zoneAhuStrategy && zoneAhuStrategy.modeLabel ? zoneAhuStrategy.modeLabel : "Single AHU") + '</td></tr>'
        + '<tr><td>Tariff</td><td class="num">₹' + formatNumber(systemInput.tariff_per_kwh || 0, 2) + '/kWh</td></tr>'
        + "</tbody></table>";
    }

    if (summaryTable) {
      summaryTable.innerHTML =
        '<table class="calc-table"><tbody>'
        + '<tr><td>Total annual energy</td><td class="num">' + formatInt(report.annual_energy_kwh) + ' kWh</td></tr>'
        + '<tr><td>Cooling energy</td><td class="num">' + formatInt(report.cooling_energy) + ' kWh</td></tr>'
        + '<tr><td>Conditioned fan energy</td><td class="num">' + formatInt(report.fan_energy) + ' kWh</td></tr>'
        + '<tr><td>Process / make-up air energy</td><td class="num">' + formatInt(report.process_energy) + ' kWh</td></tr>'
        + '<tr><td>Peak electric power</td><td class="num">' + formatNumber(report.peak_power_kw || 0, 2) + ' kW</td></tr>'
        + '<tr><td>System efficiency</td><td class="num">' + formatNumber(report.system_efficiency || 0, 2) + ' kW/TR</td></tr>'
        + '<tr><td>Process / conditioned airflow</td><td class="num">' + formatNumber(report.process_to_conditioned_air_ratio || 0, 2) + ' x</td></tr>'
        + '<tr class="total-row"><td><b>Annual energy cost</b></td><td class="num"><b>' + formatCurrency(report.energy_cost || 0) + "</b></td></tr>"
        + "</tbody></table>";
    }

    if (projectRollup) {
      projectRollup.innerHTML = projectSummary
        ? '<table class="calc-table"><tbody>'
          + '<tr><td>Rooms simulated</td><td class="num">' + projectSummary.roomCount + "</td></tr>"
          + '<tr><td>Project annual energy</td><td class="num">' + formatInt(projectSummary.annual_energy_kwh) + ' kWh</td></tr>'
          + '<tr><td>Project annual cost</td><td class="num">' + formatCurrency(projectSummary.energy_cost) + "</td></tr>"
          + '<tr><td>Project peak connected load</td><td class="num">' + formatNumber(projectSummary.peak_power_kw || 0, 2) + ' kW</td></tr>'
          + '<tr><td>Project roll-up efficiency</td><td class="num">' + formatNumber(projectSummary.system_efficiency || 0, 2) + ' kW/TR</td></tr>'
          + '<tr><td colspan="2" style="color:var(--text3);font-size:11px;">' + escapeHtml(projectSummary.note) + "</td></tr>"
          + "</tbody></table>"
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Project roll-up will appear after more rooms are simulated.</p>';
    }

    if (warningList) {
      const majorWarnings = []
        .concat(report.warnings || [])
        .concat(energyOptimization && energyOptimization.warningMessages ? energyOptimization.warningMessages : []);
      const advisoryNotes = energyOptimization && energyOptimization.advisories ? energyOptimization.advisories : [];
      warningList.innerHTML = majorWarnings.length
        ? '<div style="display:grid;gap:8px;">' + majorWarnings.map(function (warning) {
          return '<div style="padding:10px 12px;border:1px solid rgba(245,176,76,0.3);background:rgba(245,176,76,0.08);border-radius:10px;font-family:var(--mono);font-size:11px;color:var(--text2);">' + escapeHtml(warning) + "</div>";
        }).join("") + "</div>"
        : advisoryNotes.length
          ? '<div style="display:grid;gap:8px;">' + advisoryNotes.map(function (note) {
            return '<div style="padding:10px 12px;border:1px solid rgba(22,102,169,0.2);background:rgba(22,102,169,0.05);border-radius:10px;font-family:var(--mono);font-size:11px;color:var(--text2);">' + escapeHtml(note) + "</div>";
          }).join("") + "</div>"
        : '<p style="color:var(--accent);font-family:var(--mono);font-size:12px;">No major energy warnings. Current fan and process-air assumptions stay inside the configured thresholds.</p>';
    }

    if (comparisonBox) {
      comparisonBox.textContent = energyOptimization && energyOptimization.summary
        ? energyOptimization.summary
        : "Next comparison step: duplicate the room, revise process-air schedule or fan static, then compare the two saved room options through the same simulation endpoint.";
    }

    renderEnergyGraph(report);
  }

  function renderSchematic3D(result) {
    const canvas = byId("schematic3d-canvas");
    const summary = byId("schematic3d-summary");
    const schedule = byId("schematic3d-schedule");
    const note = byId("schematic3d-note");
    const disclaimer = byId("schematic3d-disclaimer");
    if (!canvas || !summary || !schedule) {
      return;
    }

    if (!result) {
      setMetric("m-schematic-room", "—");
      setMetric("m-schematic-ahu", "—");
      setMetric("m-schematic-duct", "—");
      setMetric("m-schematic-zones", "—");
      summary.innerHTML = '<p class="schematic-empty">Run calculations to generate the active-room 3D schematic.</p>';
      schedule.innerHTML = '<p class="schematic-empty">AHU deployment and per-zone routing notes will appear here after calculation.</p>';
      if (note) {
        note.textContent = "Drag to rotate. Use wheel or trackpad scroll to zoom. Double-click to reset the camera. Air animation is illustrative only.";
      }
      if (disclaimer) {
        disclaimer.textContent = "Visualization only. Use this for coordination and presentation, not for IFC, shop, fabrication, or standards approval.";
      }
      if (window.Schematic3D && window.Schematic3D.render) {
        window.Schematic3D.render(canvas, null);
      }
      return;
    }

    const zoneAhuStrategy = result.zoneAhuStrategy || { clusters: [], modeLabel: "Single AHU" };
    const zoneDuctPlan = result.zoneDuctPlan || { zones: [], processHandlingMode: "ducted" };
    const ductStrategy = result.ductStrategy || {};
    const diffuserLayout = result.diffuserLayout || {};
    const autoZoning = result.autoZoning || { zoneCount: 1 };
    const len = parseFloat(result.inputs.len) || 0;
    const wid = parseFloat(result.inputs.wid) || 0;
    const ht = parseFloat(result.inputs.ht) || 0;
    const clusters = Array.isArray(zoneAhuStrategy.clusters) && zoneAhuStrategy.clusters.length
      ? zoneAhuStrategy.clusters
      : [{
          name: "Primary AHU",
          zoneNames: (zoneDuctPlan.zones || []).map(function (zone) { return zone.name; }),
          selection: result.equipmentSelection || {}
        }];
    const deployedAhuCount = clusters.reduce(function (sum, cluster) {
      const ahu = (cluster.selection && cluster.selection.ahu) || {};
      return sum + Math.max(
        ahu.unitCount || 0,
        ahu.airSectionCount || 0,
        ahu.coolingUnitCount || 0,
        1
      );
    }, 0);
    const supply = ductStrategy.supply || {};
    const returnAir = ductStrategy.return || {};
    const process = ductStrategy.process || {};
    const branchDuct = result.branch_duct;
    const zoneToCluster = {};

    clusters.forEach(function (cluster) {
      (cluster.zoneNames || []).forEach(function (zoneName) {
        zoneToCluster[zoneName] = cluster.name;
      });
    });

    setMetric("m-schematic-room", formatNumber(len, 2) + " x " + formatNumber(wid, 2) + " x " + formatNumber(ht, 2), "m");
    setMetric("m-schematic-ahu", formatInt(deployedAhuCount));
    setMetric("m-schematic-duct", formatInt(supply.trunkCount || 0) + " / " + formatInt(returnAir.trunkCount || 0));
    setMetric("m-schematic-zones", formatInt(autoZoning.zoneCount || 1));

    if (disclaimer) {
      disclaimer.textContent = "Visualization only. Room envelope, deployed AHU count, zone count, and displayed duct sections follow the active result; routing geometry, camera view, and animated air streams are illustrative and not a standards-based or fabrication-issued layout.";
    }
    if (note) {
      note.textContent = "Drag to rotate. Use wheel or trackpad scroll to zoom. Double-click to reset the camera. Blue particles show conditioned supply air; warm red particles show return air. Routing is representative, while equipment count and duct sections follow the live result.";
    }

    summary.innerHTML =
      '<table class="calc-table"><tbody>'
      + '<tr><td>Room envelope</td><td class="num">' + formatNumber(len, 2) + " x " + formatNumber(wid, 2) + " x " + formatNumber(ht, 2) + "</td><td>m</td><td>Exact active-room dimensions from the calculation input</td></tr>"
      + '<tr><td>AHU deployment mode</td><td class="num">' + escapeHtml(zoneAhuStrategy.modeLabel || "Single AHU") + "</td><td>-</td><td>" + escapeHtml((zoneAhuStrategy.aggregateSelection && zoneAhuStrategy.aggregateSelection.ahu && zoneAhuStrategy.aggregateSelection.ahu.deploymentSummary) || "Active room deployment") + "</td></tr>"
      + '<tr><td>Deployed AHU modules</td><td class="num">' + deployedAhuCount + "</td><td>nos.</td><td>Exact module count from the selected AHU deployment</td></tr>"
      + '<tr><td>Cooling capacity shown</td><td class="num">' + formatNumber((zoneAhuStrategy.aggregateSelection && zoneAhuStrategy.aggregateSelection.ahu && zoneAhuStrategy.aggregateSelection.ahu.capacityTR) || result.tr_catalog || result.tr_final || 0, 2) + "</td><td>TR</td><td>Selected coil capacity represented in the visual deployment</td></tr>"
      + '<tr><td>Main supply duct</td><td class="num">' + escapeHtml(ductDimensionText(supply.trunkDuct)) + "</td><td>-</td><td>" + formatInt(supply.perTrunkCFM || result.cfm_conditioned || 0) + " CFM per supply trunk</td></tr>"
      + '<tr><td>Main return duct</td><td class="num">' + escapeHtml(ductDimensionText(returnAir.trunkDuct)) + "</td><td>-</td><td>" + formatInt(returnAir.perTrunkCFM || result.recirc_cfm || 0) + " CFM per return trunk</td></tr>"
      + '<tr><td>Branch duct</td><td class="num">' + escapeHtml(ductDimensionText(branchDuct)) + "</td><td>-</td><td>" + formatInt(result.branch_cfm || diffuserLayout.cfmPerDiffuser || 0) + " CFM per outlet branch</td></tr>"
      + '<tr><td>Supply device family</td><td class="num">' + escapeHtml(diffuserLayout.supplyDeviceType || "Supply outlet") + "</td><td>-</td><td>" + escapeHtml(diffuserLayout.selectionBasis || "Terminal count and spacing follow the diffuser engine result.") + "</td></tr>"
      + '<tr><td>Process / exhaust path</td><td class="num">' + (result.cfm_process_excess > 0 ? escapeHtml(zoneDuctPlan.processHandlingMode === "distributed" ? "Distributed exhaust / make-up devices" : ductDimensionText(process.trunkDuct)) : "None") + "</td><td>-</td><td>" + (result.cfm_process_excess > 0
        ? escapeHtml(zoneDuctPlan.processHandlingMode === "distributed"
          ? "Visualized as distributed extract modules because process air is handled outside the comfort duct network."
          : "Process air trunk section follows the active result.")
        : "No separate process-air duty in the active room result.") + "</td></tr>"
      + '<tr class="total-row"><td><b>Visualization basis</b></td><td class="num"><b>' + formatInt(result.cfm_conditioned || 0) + " CFM</b></td><td><b>cooling air</b></td><td>Exact room size, deployed AHUs, and displayed duct sections follow the result data. Routing and motion are illustrative only.</td></tr>"
      + '</tbody></table>';

    schedule.innerHTML = clusters.length
      ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>DEPLOYMENT</th><th>ZONES</th><th>AHU MODEL</th><th class="num">TR</th><th>SUPPLY DUCT</th><th>RETURN DUCT</th><th class="num">DIFFUSERS</th></tr></thead><tbody>'
        + (zoneDuctPlan.zones || []).map(function (zone) {
          const cluster = clusters.find(function (entry) {
            return (entry.zoneNames || []).indexOf(zone.name) !== -1;
          }) || clusters[0];
          const ahu = (cluster && cluster.selection && cluster.selection.ahu) || {};
          const zoneLayout = (diffuserLayout.zones || []).find(function (entry) {
            return entry.id === zone.id || entry.zoneName === zone.name;
          });
          return '<tr><td>' + escapeHtml(zoneToCluster[zone.name] || (cluster && cluster.name) || "Primary AHU") + '</td><td>' + escapeHtml(zone.name) + '</td><td>' + escapeHtml(ahu.model || "AHU") + '</td><td class="num">' + formatNumber(zone.trFinal || 0, 2) + '</td><td>' + escapeHtml(ductDimensionText(zone.supply && zone.supply.trunkDuct)) + '</td><td>' + escapeHtml(ductDimensionText(zone.return && zone.return.trunkDuct)) + '</td><td class="num">' + formatInt((zoneLayout && zoneLayout.diffuserCount) || zone.diffuserCount || 0) + '</td></tr>';
        }).join("")
        + '</tbody></table></div>'
      : '<p class="schematic-empty">AHU deployment will appear here after calculation.</p>';

    if (window.Schematic3D && window.Schematic3D.render) {
      window.Schematic3D.render(canvas, result);
    }
  }

  async function refreshEnergySimulation(result) {
    if (!result || !platform.projectManagerReady || !window.ServerApi) {
      return;
    }

    const room = ProjectManager.getActiveRoom();
    if (!room || !room.id || !result.calculationId) {
      return;
    }

    const roomId = room.id;
    const calculationId = result.calculationId;
    const requestSerial = ++platform.energyRequestSerial;
    const payload = buildEnergySimulationPayload(result, room);

    try {
      const available = await window.ServerApi.isAvailable();
      if (!available) {
        throw new Error("Energy simulation requires the Node + Python backend server.");
      }
      if (window.ServerApi.hasCapability && !(await window.ServerApi.hasCapability("energySimulation"))) {
        throw new Error("Current backend does not expose the energy simulation route. Restart the latest Musk-IT server build.");
      }

      const response = await window.ServerApi.simulateEnergy(payload);
      if (!(response && response.ok && response.report)) {
        throw new Error(response && response.error ? response.error : "Energy simulation failed.");
      }

      const currentRoom = ProjectManager.getRoomById(roomId);
      if (!currentRoom || !currentRoom.result || currentRoom.result.calculationId !== calculationId) {
        return;
      }

      const merged = copyJson(currentRoom.result);
      merged.energySimulation = response.report;
      merged.energySimulationStatus = "ready";
      merged.energySimulationError = "";
      merged.energySimulationMeta = {
        generatedAt: response.generatedAt || new Date().toISOString(),
        requestSerial: requestSerial
      };
      ProjectManager.updateRoomResult(roomId, merged);

      if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
        window._lastCalcResult = copyJson(merged);
        renderEnergy(window._lastCalcResult);
        renderSchematic3D(window._lastCalcResult);
        const groups = renderProjectSummary();
        renderBOQ(groups);
        renderReport(window._lastCalcResult, groups);
      }
    } catch (error) {
      const currentRoom = ProjectManager.getRoomById(roomId);
      if (!currentRoom || !currentRoom.result || currentRoom.result.calculationId !== calculationId) {
        return;
      }

      const merged = copyJson(currentRoom.result);
      merged.energySimulationStatus = "error";
      merged.energySimulationError = error && error.message ? error.message : "Energy simulation failed.";
      merged.energySimulationMeta = {
        generatedAt: new Date().toISOString(),
        requestSerial: requestSerial
      };
      ProjectManager.updateRoomResult(roomId, merged);

      if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
        window._lastCalcResult = copyJson(merged);
        renderEnergy(window._lastCalcResult);
        renderSchematic3D(window._lastCalcResult);
        const groups = renderProjectSummary();
        renderBOQ(groups);
        renderReport(window._lastCalcResult, groups);
      }
    }
  }

  function buildProjectRoomSummaryTable() {
    return '<table class="calc-table"><thead><tr><th>ROOM</th><th>AREA (m²)</th><th>RSH (W)</th><th>RLH (W)</th><th>RTH (W)</th><th>W/m²</th><th>TR_design</th><th>TR_final</th><th>CFM_final</th><th>SHR</th></tr></thead><tbody>' + innerHtml("project-room-tbody") + "</tbody></table>";
  }

  function renderReport(result, groups) {
    const project = ProjectManager.getProject();
    const totalRooms = project && project.rooms ? project.rooms.length : 1;
    const activeRoom = ProjectManager.getActiveRoom();
    const boqTable = outerHtml("boq-table");
    const roomTable = buildProjectRoomSummaryTable();
    const solarFigure = clonedSvgMarkup("solar-chart", "0 0 800 260", 260);
    const psychroFigure = clonedSvgMarkup("psychro-chart-svg", "0 0 860 420", 420);
    const energyFigure = clonedSvgMarkup("energy-chart-svg", "0 0 860 320", 320);
    const energyReady = !!(result && result.energySimulation && result.energySimulationStatus === "ready");
    const reportDate = new Date();
    const reportYear = reportDate.getFullYear();
    const footerLine = reportYear + " | Ankit Biswas Sharma | Musk-IT | All Rights Reserved.";

    byId("report-content").innerHTML =
      reportBlock("PROJECT HEADER",
        '<div class="report-hero">'
        + '<div class="report-brand-row">'
        + '<div><div class="report-brand-word"><span class="report-brand-main">Musk</span><span class="report-brand-accent">-IT</span></div><div class="report-brand-tag">Professional HVAC Design Platform</div></div>'
        + '<div class="report-brand-badges"><span class="report-chip">HVAC DESIGN REPORT</span><span class="report-chip report-chip-soft">Dynamic SHGF · Psychrometrics · Multi-Room</span></div>'
        + "</div>"
        + '<div class="report-divider"></div>'
        + '<div class="report-kv">'
        + "<dt>Report date / time</dt><dd>" + reportDate.toLocaleString() + "</dd>"
        + "<dt>Project name</dt><dd>" + escapeHtml(project ? project.name : "HVAC Project") + "</dd>"
        + "<dt>Active room</dt><dd>" + escapeHtml(activeRoom ? activeRoom.name : "Room 1") + "</dd>"
        + "<dt>Prepared by</dt><dd>Ankit Biswas Sharma</dd>"
        + "<dt>Calculation method</dt><dd>ASHRAE CLTD / dynamic SHGF / psychrometric process</dd>"
        + "<dt>Prepared for</dt><dd>Musk-IT design issue / PDF package</dd>"
        + "<dt>Design location</dt><dd>" + (window._selectedCity ? window._selectedCity.city + ", " + window._selectedCity.region : "User-defined") + "</dd>"
        + "<dt>Project room count</dt><dd>" + totalRooms + "</dd>"
        + "<dt>Outdoor design</dt><dd>" + result.inputs.out_dbt + " deg C DBT / " + formatNumber(result.outdoorRelativeHumidity, 0) + "% RH</dd>"
        + "<dt>Indoor design</dt><dd>" + result.inputs.in_dbt + " deg C / " + result.inputs.in_rh + "% RH</dd>"
        + "</div>"
        + "</div>"
      )
      + reportBlock("01 · INPUT",
        '<div class="report-grid-2">'
        + '<div><div class="report-subtitle">Room Geometry & Envelope</div><div class="report-kv">'
        + "<dt>Length</dt><dd>" + result.inputs.len + " m</dd>"
        + "<dt>Width</dt><dd>" + result.inputs.wid + " m</dd>"
        + "<dt>Height</dt><dd>" + result.inputs.ht + " m</dd>"
        + "<dt>Window area</dt><dd>" + result.inputs.win_area + " m²</dd>"
        + "<dt>Window orientation</dt><dd>" + result.inputs.win_orient + "</dd>"
        + "<dt>Wall exposure</dt><dd>" + result.inputs.wall_exp + " exposed wall(s)</dd>"
        + "<dt>Roof exposure</dt><dd>" + String(result.inputs.roof_exp).replace(/_/g, " ") + "</dd>"
        + "<dt>Wall U-value</dt><dd>" + result.inputs.u_wall + " W/m²K</dd>"
        + "<dt>Roof U-value</dt><dd>" + result.inputs.u_roof + " W/m²K</dd>"
        + "</div></div>"
        + '<div><div class="report-subtitle">Loads, Climate & Solar</div><div class="report-kv">'
        + "<dt>Occupants</dt><dd>" + result.inputs.occ + " persons</dd>"
        + "<dt>Occupant activity</dt><dd>" + String(result.inputs.occ_act).replace(/_/g, " ") + "</dd>"
        + "<dt>Fresh air</dt><dd>" + result.inputs.fresh_cfm + " CFM/person</dd>"
        + "<dt>Lighting load</dt><dd>" + result.inputs.lighting + " W/m²</dd>"
        + "<dt>Equipment load</dt><dd>" + result.inputs.equip + " W/m²</dd>"
        + "<dt>Latitude</dt><dd>" + result.inputs.out_lat + " deg</dd>"
        + "<dt>Solar design day</dt><dd>Day " + result.inputs.solar_day + "</dd>"
        + "<dt>Solar design hour</dt><dd>" + result.inputs.solar_hour + ":00</dd>"
        + "<dt>Glass SC / CLF</dt><dd>" + result.inputs.sc_glass + " / " + result.inputs.clf_shade + "</dd>"
        + "<dt>AHU group</dt><dd>" + result.inputs.ahu_group + "</dd>"
        + "</div></div>"
        + "</div>"
      )
      + reportBlock("02 · COOLING LOAD",
        outerHtml("cooling-metrics")
        + '<div class="report-inline-note">Cooling load section prints the full room sensible/latent breakdown with the dynamic SHGF contribution already applied to window solar gain.</div>'
        + '<div class="table-wrap">' + outerHtml("cooling-table") + "</div>"
      )
      + reportBlock("03 · SHR", innerHtml("shr-content"))
      + reportBlock("04 · TONNAGE",
        innerHtml("tonnage-detail")
        + '<div class="report-inline-note">Catalog reference size: ' + formatNumber(result.tr_catalog, 1) + " TR | Final design duty: " + formatNumber(result.tr_final, 2) + " TR</div>"
      )
      + reportBlock("05 · AIRFLOW", innerHtml("airflow-detail"))
      + reportBlock("06 · DUCT SIZING", outerHtml("duct-cards") + '<div class="table-wrap">' + outerHtml("duct-table") + "</div>")
      + reportBlock("07 · ESP", innerHtml("esp-table-wrap"))
      + reportBlock("08 · FAN SELECTION", innerHtml("fan-detail"))
      + reportBlock("09 · DIFFUSER",
        '<div class="report-inline-note">Install-ready top view shows supply diffuser grid, coverage circles, and return grille placement opposite the supply field.</div>'
        + innerHtml("diffuser-detail")
      )
      + reportBlock("10 · PSYCHROMETRIC",
        '<div class="report-subtitle">Outdoor State</div>' + outerHtml("psychro-outdoor")
        + '<div class="report-subtitle">Indoor State</div>' + outerHtml("psychro-indoor")
        + '<div class="report-subtitle">Coil Analysis</div>' + innerHtml("coil-detail")
      )
      + reportBlock("11 · SOLAR SHGF",
        firstResultsGridMarkup("p-solar")
        + solarFigure
        + '<div class="report-subtitle">Hourly SHGF Summary</div>' + innerHtml("solar-table")
        + '<div class="report-subtitle">Orientation Matrix</div><div class="table-wrap">' + outerHtml("solar-all-table") + "</div>",
        "report-page-break"
      )
      + reportBlock("12 · PSYCHRO CHART",
        psychroFigure
        + '<div class="report-subtitle">Legend</div><div style="display:flex;flex-wrap:wrap;gap:10px;">' + innerHtml("psychro-chart-legend") + "</div>"
        + '<div class="report-subtitle">State Point Data</div>' + innerHtml("psychro-chart-table")
      )
      + reportBlock("13 · MULTI-ROOM",
        '<div class="report-grid-2">'
        + '<div><div class="report-subtitle">Project Summary</div>' + innerHtml("project-summary-table") + "</div>"
        + '<div><div class="report-subtitle">AHU Grouping</div>' + innerHtml("ahu-group-summary") + "</div>"
        + "</div>"
        + '<div class="report-subtitle">Room Schedule</div><div class="table-wrap">' + roomTable + "</div>",
        "report-page-break"
      )
      + reportBlock("14 · BOQ / COSTING",
        '<div class="table-wrap">' + boqTable + "</div>"
        + '<div class="report-subtitle">Cost Summary</div>' + innerHtml("boq-totals")
      )
      + reportBlock("15 · ENERGY SIMULATION",
        energyReady
          ? firstResultsGridMarkup("p-energy")
            + '<div class="report-grid-2">'
            + '<div><div class="report-subtitle">Active Room Annual Summary</div>' + innerHtml("energy-summary-table") + "</div>"
            + '<div><div class="report-subtitle">Project Roll-Up</div>' + innerHtml("energy-project-rollup") + "</div>"
            + "</div>"
            + '<div class="report-subtitle">Simulation Warnings</div>' + innerHtml("energy-warning-list")
            + '<div class="report-subtitle">Energy Inputs</div>' + innerHtml("energy-input-summary")
            + energyFigure
            + '<div class="report-inline-note">' + innerHtml("energy-graph-note") + "</div>"
          : '<div class="report-inline-note">' + escapeHtml((result && result.energySimulationError) || "Energy simulation is not available for this room yet. Run the live backend-enabled calculation flow to generate the annual bin-method report.") + "</div>",
        "report-page-break"
      )
      + '<div class="report-disclaimer">This PDF package is intended to capture the full design workflow from room input through costing, including psychrometric and diffuser layout visuals. Final procurement and IFC issue should still be checked against project-specific manufacturer data and site coordination constraints.</div>'
      + '<div class="report-footer">' + footerLine + "</div>";
  }

  function syncProjectStorageUI(project) {
    if (!project) {
      return;
    }
    setValue("project_name", project.name || "HVAC Project");
    setValue("project_name_panel", project.name || "HVAC Project");
    setValue("diversity_factor", project.diversityFactor || 85);

    const options = ProjectManager.listSavedProjects();
    const select = byId("saved_project_list");
    const panelSelect = byId("saved_project_list_panel");
    const optionMarkup = '<option value="">Autosave</option>' + options.map(function (item) {
      return '<option value="' + item.name + '">' + item.name + " · " + new Date(item.savedAt).toLocaleDateString() + "</option>";
    }).join("");
    if (select) {
      select.innerHTML = optionMarkup;
      select.value = project.name || "";
    }
    if (panelSelect) {
      panelSelect.innerHTML = optionMarkup;
      panelSelect.value = project.name || "";
    }

    const storageStatus = byId("project-storage-status");
    if (storageStatus) {
      storageStatus.textContent = "Last update: " + new Date(project.savedAt || Date.now()).toLocaleString();
    }
  }

  function renderRoomLists(project) {
    const activeRoom = ProjectManager.getActiveRoom();
    const markup = project.rooms.map(function (room) {
      const active = activeRoom && activeRoom.id === room.id;
      const summary = room.result
        ? formatInt(room.result.totalLoad) + " W · " + formatNumber(room.result.tr_final || room.result.tr_design || room.result.TR_sel, 1) + " TR final"
        : "not calculated";
      return '<div class="room-list-item' + (active ? " active" : "") + '">'
        + '<button type="button" class="room-list-main" onclick="selectRoom(\'' + room.id + '\')" ondblclick="renameRoom(\'' + room.id + '\');return false;" title="Double-click to rename room">'
        + '<span class="room-name">' + escapeHtml(room.name) + "</span>"
        + '<span class="room-meta">' + escapeHtml(summary) + "</span>"
        + "</button>"
        + '<button type="button" class="room-list-delete" onclick="deleteRoom(\'' + room.id + '\')">x</button>'
        + "</div>";
    }).join("");

    if (byId("sidebar-room-list")) {
      byId("sidebar-room-list").innerHTML = markup;
    }
    if (byId("room-list")) {
      byId("room-list").innerHTML = markup;
    }

    const badge = byId("active-room-badge");
    if (badge && activeRoom) {
      badge.textContent = activeRoom.name;
    }
  }

  function renameRoom(roomId) {
    if (!ensureAuthenticated()) {
      return;
    }
    const room = ProjectManager.getRoomById(roomId);
    if (!room) {
      return;
    }
    const nextName = window.prompt("Rename room", room.name);
    if (nextName == null) {
      return;
    }
    const renamed = ProjectManager.renameRoom(roomId, nextName);
    if (!renamed) {
      return;
    }
    const groups = renderProjectSummary();
    if (window._lastCalcResult) {
      renderBOQ(groups);
      renderSchematic3D(window._lastCalcResult);
      renderReport(window._lastCalcResult, groups);
    }
  }

  function renderProjectSummary() {
    const project = ProjectManager.getProject();
    if (!project) {
      return [];
    }

    const roomsWithResults = project.rooms.filter(function (room) {
      return room.result;
    });
    const diversityFactor = (parseFloat(valueOf("diversity_factor", project.diversityFactor || 85)) || 85) / 100;
    ProjectManager.setDiversityFactor(diversityFactor * 100);

    const totalDesignTR = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.tr_design || room.result.tr_calc || 0);
    }, 0);
    const totalFinalTR = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.tr_final || room.result.tr_sf || room.result.tr_design || 0);
    }, 0);
    const totalCatalogTR = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.tr_catalog || room.result.TR_sel || 0);
    }, 0);
    const diversifiedTR = totalFinalTR * diversityFactor;
    const totalConditionedCFM = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.cfm_conditioned || room.result.Q_sup_cfm || 0);
    }, 0);
    const totalProcessCFM = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.cfm_process_excess || 0);
    }, 0);
    const totalCFM = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.cfm_final || room.result.Q_sup_cfm || 0);
    }, 0);

    setMetric("m-proj-tr", formatNumber(totalFinalTR, 2), "TR");
    setMetric("m-proj-div-tr", formatNumber(diversifiedTR, 2), "TR");
    setMetric("m-proj-cfm", formatInt(totalCFM), "CFM");
    setMetric("m-proj-rooms", String(project.rooms.length));

    byId("project-room-tbody").innerHTML = roomsWithResults.length
      ? roomsWithResults.map(function (room) {
        return "<tr><td>" + escapeHtml(room.name) + "</td><td>" + formatNumber(room.result.area, 1) + "</td><td class=\"num\">" + formatInt(room.result.totalS) + "</td><td class=\"num\">" + formatInt(room.result.totalL) + "</td><td class=\"num\">" + formatInt(room.result.totalLoad) + "</td><td class=\"num\">" + formatNumber(room.result.totalLoad / Math.max(room.result.area, 1), 1) + "</td><td class=\"num\">" + formatNumber(room.result.tr_design || room.result.tr_calc || 0, 2) + "</td><td class=\"num\">" + formatNumber(room.result.tr_final || room.result.tr_sf || room.result.tr_design || 0, 2) + "</td><td class=\"num\">" + formatInt(room.result.cfm_final || room.result.Q_sup_cfm || 0) + "</td><td class=\"num\">" + formatNumber(room.result.shr, 3) + "</td></tr>";
      }).join("")
      : '<tr><td colspan="10" style="color:var(--text3);text-align:center;padding:16px;">Add rooms and run calculations to build the project</td></tr>';

    byId("project-summary-table").innerHTML =
      '<table class="calc-table"><tbody>'
      + "<tr><td>Total TR_design</td><td class=\"num\">" + formatNumber(totalDesignTR, 2) + " TR</td></tr>"
      + "<tr><td>Total TR_final</td><td class=\"num\">" + formatNumber(totalFinalTR, 2) + " TR</td></tr>"
      + "<tr><td>Total TR_catalog</td><td class=\"num\">" + formatNumber(totalCatalogTR, 2) + " TR</td></tr>"
      + "<tr><td>Diversity factor</td><td class=\"num\">" + formatNumber(diversityFactor * 100, 0) + "%</td></tr>"
      + '<tr class="total-row"><td><b>Diversified plant TR_final</b></td><td class="num"><b>' + formatNumber(diversifiedTR, 2) + " TR</b></td></tr>"
      + "<tr><td>Total conditioned airflow</td><td class=\"num\">" + formatInt(totalConditionedCFM) + " CFM</td></tr>"
      + "<tr><td>Total ACH / process airflow</td><td class=\"num\">" + formatInt(totalProcessCFM) + " CFM</td></tr>"
      + "<tr><td>Total room airflow</td><td class=\"num\">" + formatInt(totalCFM) + " CFM</td></tr>"
      + "<tr><td>Project room count</td><td class=\"num\">" + project.rooms.length + "</td></tr>"
      + "</tbody></table>";

    const groups = EquipmentEngine.buildAhuGroups(roomsWithResults, diversityFactor);
    byId("ahu-group-summary").innerHTML = groups.length
      ? '<table class="calc-table"><thead><tr><th>AHU GROUP</th><th>ROOMS</th><th>TR_design</th><th>TR_final</th><th>DIVERSIFIED TR</th><th>COND CFM</th><th>PEAK ESP</th><th>SUGGESTED AHU</th><th>FAN TYPE</th></tr></thead><tbody>'
        + groups.map(function (group) {
          return "<tr><td>" + group.name + "</td><td>" + group.roomCount + "</td><td class=\"num\">" + formatNumber(group.totalDesignTR, 1) + "</td><td class=\"num\">" + formatNumber(group.totalFinalTR, 1) + "</td><td class=\"num\">" + formatNumber(group.diversifiedTR, 1) + "</td><td class=\"num\">" + formatInt(group.totalCFM) + "</td><td class=\"num\">" + formatInt(group.peakESP) + "</td><td>" + group.selection.ahu.model + " / " + formatNumber(group.selection.ahu.capacityTR, 1) + " TR</td><td>" + group.selection.fan.type + "</td></tr>";
        }).join("")
        + "</tbody></table>"
      : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No AHU group data yet. Run at least one room calculation.</p>';

    syncProjectStorageUI(project);
    renderRoomLists(project);
    return groups;
  }

  function renderBOQ(groups) {
    const project = ProjectManager.getProject();
    if (!project) {
      return;
    }
    const items = CostingEngine.buildItems(project, groups, readRates());
    const totals = CostingEngine.summarize(items, numberOf("rate_install", 20));
    const totalArea = project.rooms.reduce(function (sum, room) {
      return sum + (room.result ? room.result.area : 0);
    }, 0);
    const totalSelectedTR = groups.reduce(function (sum, group) {
      return sum + group.selection.ahu.capacityTR;
    }, 0);

    byId("boq-tbody").innerHTML = items.length
      ? items.map(function (item) {
        return "<tr><td>" + item.code + "</td><td>" + item.description + "</td><td class=\"num\">" + formatNumber(item.quantity, 2) + "</td><td>" + item.unit + '</td><td class="num">' + formatCurrency(item.rate) + '</td><td class="num">' + formatCurrency(item.amount) + "</td></tr>";
      }).join("")
      : '<tr><td colspan="6" style="color:var(--text3);text-align:center;padding:16px;">Run calculations first</td></tr>';

    byId("boq-totals").innerHTML =
      '<table class="calc-table"><tbody>'
      + "<tr><td>Supply total</td><td class=\"num\">" + formatCurrency(totals.supplyTotal) + "</td></tr>"
      + "<tr><td>Installation and T&C</td><td class=\"num\">" + formatCurrency(totals.installationAmount) + "</td></tr>"
      + '<tr class="total-row"><td><b>Grand total</b></td><td class="num"><b>' + formatCurrency(totals.grandTotal) + "</b></td></tr>"
      + "<tr><td>Cost per TR</td><td class=\"num\">" + (totalSelectedTR > 0 ? formatCurrency(totals.grandTotal / totalSelectedTR) + "/TR" : "-") + "</td></tr>"
      + "<tr><td>Cost per m2</td><td class=\"num\">" + (totalArea > 0 ? formatCurrency(totals.grandTotal / totalArea) + "/m2" : "-") + "</td></tr>"
      + "</tbody></table>";

    setMetric("m-boq-equip", formatCurrency(totals.equipmentTotal));
    setMetric("m-boq-duct", formatCurrency(totals.ductTotal));
    setMetric("m-boq-diff", formatCurrency(totals.diffuserTotal));
    setMetric("m-boq-total", formatCurrency(totals.grandTotal));
  }

  function renderAll(result) {
    renderCooling(result);
    renderShr(result);
    renderTonnage(result);
    renderAirflow(result);
    renderDuct(result);
    renderEsp(result);
    renderEquipment(result);
    renderDiffuser(result);
    renderPsychrometrics(result);
    renderSolarPanel(result);
    renderPsychroChart(result);
    renderEnergy(result);
    renderSchematic3D(result);
    const groups = renderProjectSummary();
    renderBOQ(groups);
    renderReport(result, groups);
  }

  async function renderOwnerDashboard() {
    if (!isOwnerUser(currentUser())) {
      return;
    }
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      setMetric("m-owner-companies", "0");
      setMetric("m-owner-licenses", "0");
      setMetric("m-owner-leads", "0");
      setMetric("m-owner-users", "0");
      if (byId("owner-companies-table")) {
        byId("owner-companies-table").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Owner dashboard requires the Node backend server.</p>';
      }
      if (byId("owner-leads-table")) {
        byId("owner-leads-table").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Start the backend to load lead and licensing data.</p>';
      }
      if (byId("owner-summary-note")) {
        byId("owner-summary-note").textContent = "Backend server not detected. Start the Node server to manage licensing and leads.";
      }
      return;
    }

    const response = await window.ServerApi.getOwnerOverview();
    if (!(response && response.ok)) {
      if (byId("owner-summary-note")) {
        byId("owner-summary-note").textContent = response && response.error ? response.error : "Unable to load owner overview.";
      }
      return;
    }

    const totals = response.totals || {};
    const companies = response.companies || [];
    const leads = response.leads || [];
    const plans = response.plans || [];

    platform.licensingPlans = plans.slice();

    setMetric("m-owner-companies", String(totals.companyCount || 0));
    setMetric("m-owner-licenses", String(totals.activeLicenseCount || 0));
    setMetric("m-owner-leads", String(totals.leadCount || 0));
    setMetric("m-owner-users", String(totals.companyUserCount || 0));

    if (byId("owner-pricing-company")) {
      const previousValue = byId("owner-pricing-company").value || "";
      const companyLookup = {};
      companies.forEach(function (company) {
        const key = String(company.name || "").trim().toLowerCase();
        if (!key) {
          return;
        }
        companyLookup[key] = {
          id: company.id,
          name: company.name,
          source: "company"
        };
      });
      leads.forEach(function (lead) {
        const key = String(lead.companyName || "").trim().toLowerCase();
        if (!key || companyLookup[key]) {
          return;
        }
        companyLookup[key] = {
          id: "",
          name: String(lead.companyName || "").trim(),
          source: "lead"
        };
      });

      const ownerCompanyOptions = Object.keys(companyLookup).map(function (key) {
        return companyLookup[key];
      }).sort(function (left, right) {
        return String(left.name || "").localeCompare(String(right.name || ""));
      });

      byId("owner-pricing-company").innerHTML = '<option value="">Select company</option>' + ownerCompanyOptions.map(function (entry) {
        const optionValue = entry.id || ("lead::" + entry.name);
        const sourceLabel = entry.source === "lead" ? "Lead / Quote Prospect" : "Active Company";
        return '<option value="' + escapeHtml(optionValue) + '" data-company-id="' + escapeHtml(entry.id || "") + '" data-company-name="' + escapeHtml(entry.name) + '" data-company-source="' + escapeHtml(entry.source) + '">'
          + escapeHtml(entry.name) + " · " + escapeHtml(sourceLabel)
          + "</option>";
      }).join("");
      if (previousValue && Array.from(byId("owner-pricing-company").options).some(function (option) { return option.value === previousValue; })) {
        byId("owner-pricing-company").value = previousValue;
      } else if (ownerCompanyOptions.length) {
        byId("owner-pricing-company").selectedIndex = 1;
      }
    }

    if (byId("owner-pricing-plan")) {
      const previousPlanValue = byId("owner-pricing-plan").value || "";
      byId("owner-pricing-plan").innerHTML = plans.map(function (plan) {
        return '<option value="' + escapeHtml(plan.planCode) + '">' + escapeHtml(plan.planName) + "</option>";
      }).join("");
      if (previousPlanValue && Array.from(byId("owner-pricing-plan").options).some(function (option) { return option.value === previousPlanValue; })) {
        byId("owner-pricing-plan").value = previousPlanValue;
      }
    }

    if (byId("owner-companies-table")) {
      byId("owner-companies-table").innerHTML = companies.length
        ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>COMPANY</th><th>STATUS</th><th>ACTIVE LICENSE</th><th>USERS</th><th>LIMIT</th><th>PRICE</th><th>VALID UNTIL</th></tr></thead><tbody>'
          + companies.map(function (company) {
            return "<tr><td>" + escapeHtml(company.name) + "</td><td><span class=\"admin-chip\">" + escapeHtml(String(company.status || "").toUpperCase()) + "</span></td><td>" + escapeHtml(company.activeLicenseNumber || "-") + "</td><td class=\"num\">" + formatInt(company.userCount || 0) + "</td><td class=\"num\">" + formatInt(company.activeUserLimit || 0) + "</td><td class=\"num\">" + formatCurrency(company.activeAmountInr || 0) + "</td><td>" + (company.activeLicenseEndsAt ? new Date(company.activeLicenseEndsAt).toLocaleDateString() : "-") + "</td></tr>";
          }).join("")
          + "</tbody></table></div>"
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No licensed companies yet.</p>';
    }

    if (byId("owner-leads-table")) {
      byId("owner-leads-table").innerHTML = leads.length
        ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>TYPE</th><th>NAME</th><th>COMPANY</th><th>EMAIL</th><th>PHONE</th><th>USERS</th><th>PLAN</th><th>DATE</th></tr></thead><tbody>'
          + leads.map(function (lead) {
            return "<tr><td><span class=\"admin-chip\">" + escapeHtml(String(lead.requestType || "").toUpperCase()) + "</span></td><td>" + escapeHtml(lead.name || "-") + "</td><td>" + escapeHtml(lead.companyName || "-") + "</td><td>" + escapeHtml(lead.email || "-") + "</td><td>" + escapeHtml(lead.phone || "-") + "</td><td class=\"num\">" + formatInt(lead.requestedUsers || 0) + "</td><td>" + escapeHtml(lead.planCode || "-") + "</td><td>" + (lead.createdAt ? new Date(lead.createdAt).toLocaleString() : "-") + "</td></tr>";
          }).join("")
          + "</tbody></table></div>"
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No demo or quote leads yet.</p>';
    }

    if (byId("owner-summary-note")) {
      byId("owner-summary-note").textContent = "Owner overview loaded for " + companies.length + " company account(s) and " + leads.length + " lead(s).";
    }
  }

  async function renderAdminDashboard() {
    if (!isAdminUser(currentUser())) {
      return;
    }
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      setMetric("m-admin-users", "0");
      setMetric("m-admin-user-limit", "0");
      setMetric("m-admin-remaining-seats", "0");
      setMetric("m-admin-projects", "0");
      if (byId("admin-users-table")) {
        byId("admin-users-table").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Company admin dashboard requires the Node backend server.</p>';
      }
      if (byId("admin-projects-table")) {
        byId("admin-projects-table").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Start the backend to view company users and projects.</p>';
      }
      if (byId("admin-summary-note")) {
        byId("admin-summary-note").textContent = "Backend server not detected. Start the Node server to manage company users.";
      }
      return;
    }

    const response = await window.ServerApi.getCompanyOverview();
    if (!(response && response.ok)) {
      if (byId("admin-summary-note")) {
        byId("admin-summary-note").textContent = response && response.error ? response.error : "Unable to load company admin overview.";
      }
      return;
    }

    const users = response.users || [];
    const projects = response.projects || [];
    const seatSummary = response.seatSummary || {};
    const company = response.company || {};
    const license = response.license || {};
    platform.adminCompanyUsers = users.slice();

    setMetric("m-admin-users", String(seatSummary.usedSeats || 0));
    setMetric("m-admin-user-limit", String(seatSummary.userLimit || 0));
    setMetric("m-admin-remaining-seats", String(seatSummary.remainingSeats || 0));
    setMetric("m-admin-projects", String(projects.length || 0));

    if (byId("admin-users-table")) {
      byId("admin-users-table").innerHTML = users.length
        ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>NAME</th><th>USERNAME</th><th>EMAIL</th><th>PHONE</th><th>ROLE</th><th>LAST LOGIN</th><th>ACTIONS</th></tr></thead><tbody>'
          + users.map(function (user) {
            const actions = [
              '<button type="button" class="btn btn-secondary js-admin-edit-user" data-user-id="' + escapeHtml(user.id || "") + '">Edit</button>'
            ];
            if ((user.role || "user") !== "admin") {
              actions.push('<button type="button" class="btn btn-secondary js-admin-delete-user" data-user-id="' + escapeHtml(user.id || "") + '">Delete</button>');
            } else {
              actions.push('<span class="admin-chip">LOCKED</span>');
            }
            return "<tr><td>" + escapeHtml(user.name) + "</td><td>" + escapeHtml(user.username || "-") + "</td><td>" + escapeHtml(user.email || "-") + "</td><td>" + escapeHtml(user.phone || "-") + "</td><td><span class=\"admin-chip\">" + escapeHtml(String(user.role || "user").toUpperCase()) + "</span></td><td>" + (user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-") + "</td><td><div style=\"display:flex;gap:8px;flex-wrap:wrap;\">" + actions.join("") + "</div></td></tr>";
          }).join("")
          + "</tbody></table></div>"
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No licensed users found for this company.</p>';
    }

    if (byId("admin-projects-table")) {
      byId("admin-projects-table").innerHTML = projects.length
        ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>PROJECT</th><th>OWNER</th><th>ROOMS</th><th>TR</th><th>CFM</th><th>UPDATED</th></tr></thead><tbody>'
          + projects.map(function (project) {
            return "<tr><td>" + escapeHtml(project.name) + "</td><td>" + escapeHtml(project.ownerName || "-") + "</td><td class=\"num\">" + formatInt(project.roomCount || 0) + "</td><td class=\"num\">" + formatNumber(project.totalTR || 0, 2) + "</td><td class=\"num\">" + formatInt(project.totalCFM || 0) + "</td><td>" + (project.savedAt ? new Date(project.savedAt).toLocaleString() : "-") + "</td></tr>";
          }).join("")
          + "</tbody></table></div>"
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No named company projects saved yet.</p>';
    }

    if (byId("admin-summary-note")) {
      byId("admin-summary-note").textContent = "Company admin overview loaded for " + (company.name || "your company") + (license.licenseNumber ? " under license " + license.licenseNumber + "." : ".");
    }
  }

  function clearAuthForms() {
    [
      "auth-login-identifier",
      "auth-login-password",
      "auth-quote-name",
      "auth-quote-email",
      "auth-quote-phone",
      "auth-quote-company",
      "auth-quote-users",
      "auth-quote-note",
      "auth-demo-name",
      "auth-demo-company",
      "auth-demo-phone",
      "auth-demo-email",
      "auth-demo-note",
      "auth-reset-email",
      "auth-reset-token",
      "auth-reset-recovery",
      "auth-reset-password",
      "auth-reset-confirm"
    ].forEach(function (fieldId) {
      const element = byId(fieldId);
      if (element) {
        element.value = fieldId === "auth-quote-users" ? "5" : "";
      }
    });
    [
      "auth-quote-name",
      "auth-quote-email",
      "auth-quote-phone",
      "auth-quote-company",
      "auth-quote-plan",
      "auth-quote-users",
      "auth-quote-note"
    ].forEach(function (fieldId) {
      setReadOnlyState(fieldId, false);
    });
    platform.licenseInvite = null;
    platform.licenseInviteNotice = null;
  }

  function applyLicenseInvite(invitePayload, inviteToken) {
    const invite = Object.assign({}, invitePayload || {}, {
      token: inviteToken || ""
    });
    platform.licenseInvite = invite;
    platform.licenseInviteNotice = {
      mode: "quote",
      state: "success",
      message: "Custom company payment link loaded for " + (invite.companyName || "your company") + ". Review the locked details and click Pay with Razorpay to activate the license."
    };

    setValue("auth-quote-name", invite.contactName || "");
    setValue("auth-quote-email", invite.contactEmail || "");
    setValue("auth-quote-phone", invite.contactPhone || "");
    setValue("auth-quote-company", invite.companyName || "");
    setValue("auth-quote-plan", invite.planCode || "annual_5");
    setValue("auth-quote-users", String(invite.requestedUsers || invite.userLimit || 1));
    setValue("auth-quote-note", invite.note || "");

    [
      "auth-quote-name",
      "auth-quote-email",
      "auth-quote-phone",
      "auth-quote-company",
      "auth-quote-plan",
      "auth-quote-users",
      "auth-quote-note"
    ].forEach(function (fieldId) {
      setReadOnlyState(fieldId, true);
    });

    setAuthMode("quote");
    setAuthMessage(platform.licenseInviteNotice.message, platform.licenseInviteNotice.state);
  }

  async function loadLicenseInviteFromUrl() {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return false;
    }
    const params = new URLSearchParams(window.location.search || "");
    const inviteToken = params.get("licenseInvite") || params.get("license_invite") || "";
    if (!inviteToken) {
      return false;
    }
    const response = await window.ServerApi.getLicenseInvite(inviteToken);
    if (!(response && response.ok && response.invite)) {
      platform.licenseInviteNotice = {
        mode: "quote",
        state: "error",
        message: response && response.error ? response.error : "The license payment link is invalid or expired."
      };
      setAuthMode("quote");
      setAuthMessage(platform.licenseInviteNotice.message, platform.licenseInviteNotice.state);
      return false;
    }
    applyLicenseInvite(response.invite, inviteToken);
    return true;
  }

  async function hydrateProjectForUser(user) {
    const defaultInputs = captureInputs();

    if (!platform.projectManagerReady) {
      ProjectManager.init({
        roomFieldIds: ROOM_FIELD_IDS,
        defaultInputs: defaultInputs,
        storageScope: userStorageScope(user)
      });
      platform.projectManagerReady = true;
    } else {
      ProjectManager.setStorageScope(userStorageScope(user));
      ProjectManager.resetProject(defaultInputs);
    }

    await ProjectManager.refreshSavedProjects();
    const restored = await ProjectManager.loadProject(null);
    if (restored) {
      persistRateInputs(restored.rates || DEFAULT_RATES);
      syncProjectStorageUI(restored);
      const activeRoom = ProjectManager.getActiveRoom();
      if (activeRoom) {
        applyInputs(activeRoom.inputs || DEFAULT_INPUTS);
      }
    } else {
      persistRateInputs(DEFAULT_RATES);
      applyInputs(DEFAULT_INPUTS);
      ProjectManager.updateActiveInputs(captureInputs());
      syncProjectStorageUI(ProjectManager.getProject());
    }
  }

  async function openWorkspaceForUser(user, message) {
    document.body.classList.remove("auth-locked");
    updateUserChrome(user);
    await hydrateProjectForUser(user);
    if (!platform.inputListenersBound) {
      attachInputListeners();
    }
    renderProjectSummary();
    runAll();
    if (isOwnerUser(user)) {
      show("owner");
    } else if (isCompanyAdminUser(user)) {
      show("admin");
    } else {
      show("input");
    }
    clearAuthForms();
    setAuthMode("login");
    setAuthMessage(message || "Workspace ready.", "success");
  }

  async function loadLicensingPlans() {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return;
    }
    const response = await window.ServerApi.getLicensingPlans();
    if (!(response && response.ok)) {
      return;
    }

    platform.licensingPlans = response.plans || [];
    platform.razorpayEnabled = !!response.razorpayEnabled;
    platform.razorpayKeyId = response.razorpayKeyId || "";
    const planSelect = byId("auth-quote-plan");
    if (planSelect && platform.licensingPlans.length) {
      planSelect.innerHTML = platform.licensingPlans.map(function (plan) {
        const durationLabel = plan.licenseType === "source" ? "license" : "year";
        return '<option value="' + escapeHtml(plan.planCode) + '">'
          + escapeHtml(plan.planName) + " · " + formatCurrency(plan.annualPriceInr) + " / " + durationLabel
          + "</option>";
      }).join("");
    }
  }

  function readQuotePayload() {
    const payload = {
      name: valueOf("auth-quote-name", ""),
      companyName: valueOf("auth-quote-company", ""),
      phone: valueOf("auth-quote-phone", ""),
      email: valueOf("auth-quote-email", ""),
      planCode: valueOf("auth-quote-plan", ""),
      requestedUsers: valueOf("auth-quote-users", "5"),
      note: valueOf("auth-quote-note", "")
    };
    if (platform.licenseInvite && platform.licenseInvite.token) {
      payload.inviteToken = platform.licenseInvite.token;
    }
    return payload;
  }

  function readDemoPayload() {
    return {
      name: valueOf("auth-demo-name", ""),
      companyName: valueOf("auth-demo-company", ""),
      phone: valueOf("auth-demo-phone", ""),
      email: valueOf("auth-demo-email", ""),
      note: valueOf("auth-demo-note", "")
    };
  }

  async function handleLicensePurchase() {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      setAuthMessage("The backend server is required for licensing and payment.", "error");
      return;
    }

    if (!platform.licensingPlans.length) {
      await loadLicensingPlans();
    }

    const payload = readQuotePayload();
    if (!payload.name || !payload.companyName || !payload.phone || !payload.email) {
      setAuthMessage("Name, company, phone, and email are required before starting payment.", "error");
      return;
    }
    if (!platform.razorpayEnabled) {
      setAuthMessage("Online payment is not configured on the server yet. Please use Get Quote for now.", "error");
      return;
    }

    setAuthMessage("Creating Razorpay order...", "");
    const orderResponse = await window.ServerApi.createLicenseOrder(payload);
    if (!(orderResponse && orderResponse.ok)) {
      setAuthMessage(orderResponse && orderResponse.error ? orderResponse.error : "Unable to create the payment order.", "error");
      return;
    }

    try {
      await ensureRazorpayCheckout();
    } catch (error) {
      setAuthMessage(error && error.message ? error.message : "Razorpay checkout is not available in this browser session.", "error");
      return;
    }

    if (!window.Razorpay) {
      setAuthMessage("Razorpay checkout is not available in this browser session.", "error");
      return;
    }

    const checkout = new window.Razorpay({
      key: orderResponse.razorpayKeyId,
      amount: orderResponse.amountPaise,
      currency: orderResponse.currency || "INR",
      name: "Musk-IT HVAC Platform",
      description: orderResponse.plan && orderResponse.plan.planName ? orderResponse.plan.planName : "Company HVAC License",
      order_id: orderResponse.orderId,
      prefill: {
        name: payload.name,
        email: payload.email,
        contact: payload.phone
      },
      theme: {
        color: "#1666a9"
      },
      handler: async function (paymentResult) {
        setAuthMessage("Verifying payment and generating license...", "");
        const confirmResponse = await window.ServerApi.confirmLicensePayment({
          razorpayOrderId: paymentResult.razorpay_order_id,
          razorpayPaymentId: paymentResult.razorpay_payment_id,
          razorpaySignature: paymentResult.razorpay_signature
        });
        if (!(confirmResponse && confirmResponse.ok)) {
          setAuthMessage(confirmResponse && confirmResponse.error ? confirmResponse.error : "Payment verification failed.", "error");
          return;
        }

        const adminAccount = confirmResponse.adminAccount || {};
        const successMessage = adminAccount.emailSent
          ? "Payment successful. License activated and company admin credentials were emailed automatically."
          : "Payment successful. License activated. Email is not configured, so temporary credentials are shown below.";
        setAuthMessage(successMessage, "success");

        if (!adminAccount.emailSent && adminAccount.username) {
          setAuthMessage(
            successMessage + " Username: " + adminAccount.username + " · Password: " + adminAccount.temporaryPassword + " · Recovery Key: " + adminAccount.recoveryKey,
            "success"
          );
        }
        if (platform.licenseInvite && window.history && typeof window.history.replaceState === "function") {
          const url = new URL(window.location.href);
          url.searchParams.delete("licenseInvite");
          url.searchParams.delete("license_invite");
          window.history.replaceState({}, document.title, url.toString());
        }
        platform.licenseInvite = null;
        platform.licenseInviteNotice = null;
        setAuthMode("login");
        setValue("auth-login-identifier", adminAccount.username || payload.email || "");
      }
    });

    checkout.open();
  }

  async function saveCompanyPricingOverride() {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return;
    }
    const companySelect = byId("owner-pricing-company");
    const selectedOption = companySelect && companySelect.options
      ? companySelect.options[companySelect.selectedIndex]
      : null;
    const rawSelection = valueOf("owner-pricing-company", "");
    let companyId = selectedOption ? (selectedOption.getAttribute("data-company-id") || "") : "";
    let companyName = selectedOption ? (selectedOption.getAttribute("data-company-name") || "") : "";

    if (!companyId && rawSelection && rawSelection.indexOf("lead::") === 0) {
      companyName = rawSelection.slice(6);
    } else if (!companyId && rawSelection) {
      companyId = rawSelection;
    }

    if (!companyId && !companyName) {
      const statusEl = byId("owner-pricing-note-status");
      if (statusEl) {
        statusEl.textContent = "Select a company or lead first.";
      }
      return;
    }
    if (numberOf("owner-pricing-amount", 0) <= 0) {
      const statusEl = byId("owner-pricing-note-status");
      if (statusEl) {
        statusEl.textContent = "Enter a valid custom price before saving.";
      }
      return;
    }

    const response = await window.ServerApi.updateCompanyPricing({
      companyId: companyId,
      companyName: companyName,
      planCode: valueOf("owner-pricing-plan", ""),
      annualPriceInr: valueOf("owner-pricing-amount", ""),
      userLimit: valueOf("owner-pricing-user-limit", ""),
      note: valueOf("owner-pricing-note", "")
    });

    const statusEl = byId("owner-pricing-note-status");
    if (statusEl) {
      statusEl.textContent = response && response.ok
        ? response.message
        : (response && response.error ? response.error : "Unable to save company pricing.");
    }
    if (response && response.ok) {
      renderOwnerDashboard();
    }
  }

  async function createCompanyUserFromDashboard() {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return;
    }
    const response = await window.ServerApi.createCompanyUser({
      name: valueOf("admin-create-name", ""),
      email: valueOf("admin-create-email", ""),
      phone: valueOf("admin-create-phone", "")
    });
    const statusEl = byId("admin-create-status");
    if (statusEl) {
      if (response && response.ok) {
        statusEl.textContent = response.emailSent
          ? "User created successfully and credentials were emailed automatically."
          : "User created successfully. Email is not configured, so share the generated credentials manually: " + response.credentialsPreview.username + " / " + response.credentialsPreview.temporaryPassword;
      } else {
        statusEl.textContent = response && response.error ? response.error : "Unable to create the company user.";
      }
    }
    if (response && response.ok) {
      ["admin-create-name", "admin-create-email", "admin-create-phone"].forEach(function (fieldId) {
        setValue(fieldId, "");
      });
      renderAdminDashboard();
    }
  }

  async function editCompanyUserFromDashboard(userId) {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return;
    }
    const targetUser = (platform.adminCompanyUsers || []).find(function (user) {
      return user && user.id === userId;
    });
    if (!targetUser) {
      const statusEl = byId("admin-create-status");
      if (statusEl) {
        statusEl.textContent = "Selected company user was not found.";
      }
      return;
    }

    const nextName = window.prompt("Edit full name", targetUser.name || "");
    if (nextName == null) {
      return;
    }
    const nextEmail = window.prompt("Edit email", targetUser.email || "");
    if (nextEmail == null) {
      return;
    }
    const nextPhone = window.prompt("Edit phone number", targetUser.phone || "");
    if (nextPhone == null) {
      return;
    }

    const response = await window.ServerApi.updateCompanyUser({
      userId: userId,
      name: nextName,
      email: nextEmail,
      phone: nextPhone
    });
    const statusEl = byId("admin-create-status");
    if (statusEl) {
      statusEl.textContent = response && response.ok
        ? (response.message || "Company user updated successfully.")
        : (response && response.error ? response.error : "Unable to update the company user.");
    }
    if (response && response.ok) {
      renderAdminDashboard();
    }
  }

  async function deleteCompanyUserFromDashboard(userId) {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return;
    }
    const targetUser = (platform.adminCompanyUsers || []).find(function (user) {
      return user && user.id === userId;
    });
    if (!targetUser) {
      const statusEl = byId("admin-create-status");
      if (statusEl) {
        statusEl.textContent = "Selected company user was not found.";
      }
      return;
    }
    if (!window.confirm("Delete company user " + (targetUser.name || targetUser.email || "this user") + "? This will also remove their saved projects and active sessions.")) {
      return;
    }

    const response = await window.ServerApi.deleteCompanyUser({
      userId: userId
    });
    const statusEl = byId("admin-create-status");
    if (statusEl) {
      statusEl.textContent = response && response.ok
        ? (response.message || "Company user deleted successfully.")
        : (response && response.error ? response.error : "Unable to delete the company user.");
    }
    if (response && response.ok) {
      renderAdminDashboard();
    }
  }

  function bindAuthUi() {
    if (platform.authListenersBound) {
      return;
    }
    platform.authListenersBound = true;

    document.querySelectorAll("[data-auth-mode], [data-auth-mode-switch]").forEach(function (element) {
      element.addEventListener("click", function () {
        const mode = element.getAttribute("data-auth-mode") || element.getAttribute("data-auth-mode-switch");
        if (mode) {
          setAuthMode(mode);
          setAuthMessage(
            mode === "reset"
              ? "Use your email and recovery key, or request an emailed reset token."
              : mode === "quote"
                ? "Choose a licensing plan, request a quote, or pay to activate a company license."
                : mode === "demo"
                  ? "Share your demo request details and the owner dashboard will capture the lead."
                  : "Sign in with your email or username to open your workspace.",
            ""
          );
        }
      });
    });

    const loginForm = byId("auth-login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        setAuthMessage("Signing in...", "");
        const response = await AuthManager.login({
          identifier: valueOf("auth-login-identifier", ""),
          password: valueOf("auth-login-password", "")
        });
        if (!response.ok) {
          setAuthMessage(response.error, "error");
          return;
        }
        await openWorkspaceForUser(response.user, "Login successful.");
      });
    }

    const quoteForm = byId("auth-quote-form");
    if (quoteForm) {
      quoteForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
          setAuthMessage("The backend server is required to submit quote requests.", "error");
          return;
        }
        setAuthMessage("Submitting quote request...", "");
        const response = await window.ServerApi.submitQuoteRequest(readQuotePayload());
        if (!response.ok) {
          setAuthMessage(response.error, "error");
          return;
        }
        setAuthMessage(response.message || "Quote request submitted successfully.", "success");
      });
    }

    const demoForm = byId("auth-demo-form");
    if (demoForm) {
      demoForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
          setAuthMessage("The backend server is required to submit demo requests.", "error");
          return;
        }
        setAuthMessage("Submitting demo request...", "");
        const response = await window.ServerApi.submitDemoRequest(readDemoPayload());
        if (!response.ok) {
          setAuthMessage(response.error, "error");
          return;
        }
        setAuthMessage(response.message || "Demo request submitted successfully.", "success");
      });
    }

    const payButton = byId("auth-license-pay-btn");
    if (payButton) {
      payButton.addEventListener("click", function () {
        handleLicensePurchase();
      });
    }

    const sendResetTokenButton = byId("auth-send-reset-token-btn");
    if (sendResetTokenButton) {
      sendResetTokenButton.addEventListener("click", async function () {
        const email = valueOf("auth-reset-email", "");
        if (!email) {
          setAuthMessage("Enter your registered email address first.", "error");
          return;
        }
        setAuthMessage("Sending reset token...", "");
        const response = await AuthManager.requestResetToken({
          email: email
        });
        if (!response.ok) {
          setAuthMessage(response.error, "error");
          return;
        }
        setAuthMessage(response.message, "success");
      });
    }

    const ownerPricingButton = byId("owner-save-pricing-btn");
    if (ownerPricingButton) {
      ownerPricingButton.addEventListener("click", function () {
        saveCompanyPricingOverride();
      });
    }

    const companyUserButton = byId("admin-create-user-btn");
    if (companyUserButton) {
      companyUserButton.addEventListener("click", function () {
        createCompanyUserFromDashboard();
      });
    }

    const adminUsersTable = byId("admin-users-table");
    if (adminUsersTable) {
      adminUsersTable.addEventListener("click", function (event) {
        const editButton = event.target.closest(".js-admin-edit-user");
        if (editButton) {
          editCompanyUserFromDashboard(editButton.getAttribute("data-user-id") || "");
          return;
        }
        const deleteButton = event.target.closest(".js-admin-delete-user");
        if (deleteButton) {
          deleteCompanyUserFromDashboard(deleteButton.getAttribute("data-user-id") || "");
        }
      });
    }

    const resetForm = byId("auth-reset-form");
    if (resetForm) {
      resetForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        if (valueOf("auth-reset-password", "") !== valueOf("auth-reset-confirm", "")) {
          setAuthMessage("New password confirmation did not match.", "error");
          return;
        }
        setAuthMessage("Resetting password...", "");
        const response = await AuthManager.resetPassword({
          email: valueOf("auth-reset-email", ""),
          token: valueOf("auth-reset-token", ""),
          recoveryKey: valueOf("auth-reset-recovery", ""),
          newPassword: valueOf("auth-reset-password", "")
        });
        if (!response.ok) {
          setAuthMessage(response.error, "error");
          return;
        }
        setValue("auth-login-identifier", valueOf("auth-reset-email", ""));
        setAuthMode("login");
        setAuthMessage(response.message, "success");
      });
    }

    const logoutButton = byId("logout-btn");
    if (logoutButton) {
      logoutButton.addEventListener("click", async function () {
        if (platform.projectManagerReady && ProjectManager.getProject()) {
          autoSave();
        }
        await AuthManager.logout();
        window._lastCalcResult = null;
        window._lastStatePoints = null;
        lockWorkspace("Signed out. Please log in to continue.", "success");
      });
    }
  }

  function saveCurrentInputsToActiveRoom() {
    if (!platform.projectManagerReady || !isAuthenticated()) {
      return;
    }
    ProjectManager.updateActiveInputs(captureInputs());
  }

  function addRoom() {
    if (!ensureAuthenticated()) {
      return;
    }
    saveCurrentInputsToActiveRoom();
    const room = ProjectManager.addRoom(captureInputs());
    applyInputs(room.inputs);
    renderProjectSummary();
  }

  function selectRoom(roomIdOrIndex) {
    if (!ensureAuthenticated()) {
      return;
    }
    saveCurrentInputsToActiveRoom();
    let roomId = roomIdOrIndex;
    if (typeof roomIdOrIndex === "number") {
      const project = ProjectManager.getProject();
      roomId = project && project.rooms[roomIdOrIndex] ? project.rooms[roomIdOrIndex].id : roomIdOrIndex;
    }
    const room = ProjectManager.selectRoom(roomId);
    if (!room) {
      return;
    }
    applyInputs(room.inputs || DEFAULT_INPUTS);
    renderProjectSummary();
    runAll();
  }

  function deleteRoom(roomIdOrIndex) {
    if (!ensureAuthenticated()) {
      return;
    }
    saveCurrentInputsToActiveRoom();
    let roomId = roomIdOrIndex;
    if (typeof roomIdOrIndex === "number") {
      const project = ProjectManager.getProject();
      roomId = project && project.rooms[roomIdOrIndex] ? project.rooms[roomIdOrIndex].id : roomIdOrIndex;
    }
    const room = ProjectManager.deleteRoom(roomId);
    if (room) {
      applyInputs(room.inputs || DEFAULT_INPUTS);
    }
    renderProjectSummary();
    runAll();
  }

  async function saveProject() {
    if (!ensureAuthenticated()) {
      return;
    }
    saveCurrentInputsToActiveRoom();
    const projectName = valueOf("project_name", valueOf("project_name_panel", "HVAC Project"));
    setValue("project_name", projectName);
    setValue("project_name_panel", projectName);
    ProjectManager.getProject().rates = readRates();
    ProjectManager.setProjectName(projectName);
    const saved = await ProjectManager.saveProject(projectName);
    if (!saved) {
      return;
    }
    await ProjectManager.refreshSavedProjects();
    renderProjectSummary();
  }

  async function loadProject() {
    if (!ensureAuthenticated()) {
      return;
    }
    const selectedName = valueOf("saved_project_list_panel", valueOf("saved_project_list", ""));
    setValue("saved_project_list", selectedName);
    setValue("saved_project_list_panel", selectedName);
    await ProjectManager.refreshSavedProjects();
    const loaded = await ProjectManager.loadProject(selectedName || null);
    if (!loaded) {
      return;
    }
    persistRateInputs(loaded.rates || DEFAULT_RATES);
    syncProjectStorageUI(loaded);
    const activeRoom = ProjectManager.getActiveRoom();
    if (activeRoom) {
      applyInputs(activeRoom.inputs || DEFAULT_INPUTS);
    }
    renderProjectSummary();
    renderBOQ(EquipmentEngine.buildAhuGroups((loaded.rooms || []).filter(function (room) {
      return room.result;
    }), (loaded.diversityFactor || 85) / 100));
    runAll();
  }

  function autoSave() {
    if (!platform.projectManagerReady || !isAuthenticated()) {
      return;
    }
    saveCurrentInputsToActiveRoom();
    if (ProjectManager.getProject()) {
      ProjectManager.getProject().rates = readRates();
    }
    ProjectManager.autoSave();
  }

  function show(panel) {
    if (!ensureAuthenticated()) {
      return;
    }
    if (panel === "owner" && !isOwnerUser(currentUser())) {
      panel = "input";
    }
    if (panel === "admin" && !isCompanyAdminUser(currentUser())) {
      panel = "input";
    }
    document.querySelectorAll(".panel").forEach(function (element) {
      element.classList.remove("active");
    });
    document.querySelectorAll(".nav-item").forEach(function (element) {
      element.classList.remove("active");
    });
    const panelElement = byId("p-" + panel);
    if (panelElement) {
      panelElement.classList.add("active");
    }
    document.querySelectorAll(".nav-item").forEach(function (item) {
      const handler = item.getAttribute("onclick") || "";
      if (handler.indexOf("'" + panel + "'") !== -1) {
        item.classList.add("active");
      }
    });
    if (panel === "project") {
      const groups = renderProjectSummary();
      renderBOQ(groups);
    }
    if (panel === "solar" && window._lastCalcResult) {
      renderSolarPanel(window._lastCalcResult);
    }
    if (panel === "psychrochart" && window._lastCalcResult) {
      renderPsychroChart(window._lastCalcResult);
    }
    if (panel === "energy" && window._lastCalcResult) {
      renderEnergy(window._lastCalcResult);
    }
    if (panel === "schematic3d" && window._lastCalcResult) {
      renderSchematic3D(window._lastCalcResult);
    }
    if (panel === "owner" && isOwnerUser(currentUser())) {
      renderOwnerDashboard();
    }
    if (panel === "admin" && isAdminUser(currentUser())) {
      renderAdminDashboard();
    }
    window.scrollTo(0, 0);
  }

  function resetDefaults() {
    if (!ensureAuthenticated()) {
      return;
    }
    applyInputs(DEFAULT_INPUTS);
    saveCurrentInputsToActiveRoom();
    runAll();
    show("input");
  }

  function runAll() {
    if (!ensureAuthenticated() || !platform.projectManagerReady) {
      return null;
    }
    const currentPanel = activePanel();
    const inputs = captureInputs();
    const previousResult = ProjectManager.getActiveRoom() && ProjectManager.getActiveRoom().result
      ? copyJson(ProjectManager.getActiveRoom().result)
      : null;
    ProjectManager.updateActiveInputs(inputs);
    ProjectManager.setProjectName(valueOf("project_name", "HVAC Project"));
    ProjectManager.setDiversityFactor(numberOf("diversity_factor", 85));
    if (ProjectManager.getProject()) {
      ProjectManager.getProject().rates = readRates();
    }
    const result = calculateRoom(inputs);
    result.calculationId = "calc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    result.energySimulation = previousResult && previousResult.energySimulation
      ? copyJson(previousResult.energySimulation)
      : null;
    result.energySimulationStatus = "loading";
    result.energySimulationError = "";
    result.energySimulationMeta = previousResult && previousResult.energySimulationMeta
      ? copyJson(previousResult.energySimulationMeta)
      : null;
    ProjectManager.updateActiveResult(result);
    window._lastCalcResult = result;
    window._lastStatePoints = result.statePoints;
    renderAll(result);
    refreshEnergySimulation(result);
    autoSave();
    show(currentPanel === "input" ? "cooling" : currentPanel);
    return result;
  }

  function printReport() {
    if (!ensureAuthenticated()) {
      return;
    }
    if (!window._lastCalcResult) {
      runAll();
    } else {
      const groups = renderProjectSummary();
      renderBOQ(groups);
      renderSchematic3D(window._lastCalcResult);
      renderReport(window._lastCalcResult, groups);
    }
    show("report");
    window.setTimeout(function () {
      window.print();
    }, 120);
  }

  function attachInputListeners() {
    if (platform.inputListenersBound) {
      return;
    }
    platform.inputListenersBound = true;
    ROOM_FIELD_IDS.concat(RATE_FIELD_IDS).concat(["project_name", "project_name_panel", "diversity_factor"]).forEach(function (fieldId) {
      const element = byId(fieldId);
      if (!element) {
        return;
      }
      element.addEventListener("input", function () {
        if (fieldId === "project_name" || fieldId === "project_name_panel") {
          const projectName = valueOf(fieldId, "HVAC Project");
          setValue("project_name", projectName);
          setValue("project_name_panel", projectName);
          ProjectManager.setProjectName(projectName);
        } else if (fieldId === "diversity_factor") {
          ProjectManager.setDiversityFactor(numberOf("diversity_factor", 85));
          const groups = renderProjectSummary();
          renderBOQ(groups);
        } else {
          saveCurrentInputsToActiveRoom();
        }
        ProjectManager.autoSave();
      });
    });
  }

  async function initialize() {
    if (platform.initialized) {
      return;
    }
    platform.initialized = true;
    bindAuthUi();
    updateUserChrome(null);
    await loadLicensingPlans();
    await loadLicenseInviteFromUrl();

    const user = await AuthManager.hydrateSession();
    if (user) {
      await openWorkspaceForUser(user, "Session restored.");
      return;
    }

    lockWorkspace("Sign in, request a quote, request a demo, or activate a company license to open your workspace.");
    if (platform.licenseInviteNotice) {
      setAuthMode(platform.licenseInviteNotice.mode || "quote");
      setAuthMessage(platform.licenseInviteNotice.message, platform.licenseInviteNotice.state || "");
    }
  }

  window.addRoom = addRoom;
  window.renameRoom = renameRoom;
  window.selectRoom = selectRoom;
  window.deleteRoom = deleteRoom;
  window.saveProject = saveProject;
  window.loadProject = loadProject;
  window.autoSave = autoSave;
  window.show = show;
  window.resetDefaults = resetDefaults;
  window.runAll = runAll;
  window.printReport = printReport;
  window.logoutUser = function () {
    const button = byId("logout-btn");
    if (button) {
      button.click();
    }
  };
  if (typeof window.calcBOQ !== "function") {
    window.calcBOQ = function () {
      renderBOQ(renderProjectSummary());
    };
  } else {
    window.calcBOQ = function () {
      renderBOQ(renderProjectSummary());
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initialize().catch(function (error) {
        console.error("Initialization error", error);
      });
    });
  } else {
    initialize().catch(function (error) {
      console.error("Initialization error", error);
    });
  }
}());
