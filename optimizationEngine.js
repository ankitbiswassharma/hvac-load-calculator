(function (root, factory) {
  const api = factory(
    root && root.EngineeringCore
      ? root.EngineeringCore
      : (typeof require === "function"
        ? (function () {
            try {
              return require("./engineeringCore.js");
            } catch (error) {
              return null;
            }
          }())
        : null)
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.OptimizationEngine = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (EngineeringCore) {
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

  function copyJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function uniqueByKey(items) {
    const seen = {};
    return (Array.isArray(items) ? items : []).filter(function (item) {
      const key = item && item.key ? item.key : "";
      if (!key || seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
  }

  const COST_REGION_MULTIPLIERS = {
    standard: 1.0,
    metro: 1.12,
    north: 1.0,
    south: 1.03,
    west: 1.06,
    east: 0.98,
    tier2: 0.95,
    tier3: 0.90
  };

  const DEFAULT_COST_RATES = {
    rate_tr: 15000,
    rate_duct: 850,
    rate_diffuser: 1200,
    rate_return: 900,
    rate_insul: 250,
    rate_fan: 8500,
    rate_pipe: 4500,
    rate_bms: 3000,
    rate_install: 20,
    rate_energy: 9,
    rate_filter_prefilter: 3500,
    rate_filter_fine: 6000,
    rate_filter_hepa: 18000,
    rate_filter_ulpa: 26000,
    rate_ffu_module: 22000
  };

  function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function mergeCostRates(inputRates) {
    const rates = inputRates || {};
    return Object.keys(DEFAULT_COST_RATES).reduce(function (accumulator, key) {
      accumulator[key] = Math.max(toNumber(rates[key], DEFAULT_COST_RATES[key]), 0);
      return accumulator;
    }, {});
  }

  function resolveCostContext(roomContext) {
    const project = roomContext && roomContext.project ? roomContext.project : {};
    const costingContext = roomContext && roomContext.costingContext
      ? roomContext.costingContext
      : project && project.costingContext
        ? project.costingContext
        : {};
    const profileKey = String(costingContext.regionProfile || "standard").toLowerCase();
    const regionProfile = COST_REGION_MULTIPLIERS[profileKey] ? profileKey : "standard";
    const manualMultiplier = toNumber(costingContext.regionMultiplier, 0);
    const regionMultiplier = manualMultiplier > 0
      ? manualMultiplier
      : (COST_REGION_MULTIPLIERS[regionProfile] || 1);
    return {
      regionProfile: regionProfile,
      regionMultiplier: regionMultiplier,
      rates: mergeCostRates(roomContext && roomContext.rates ? roomContext.rates : (project && project.rates ? project.rates : null))
    };
  }

  function ductOuterPerimeterM(duct, fallbackDiameterIn) {
    const data = duct || {};
    const widthIn = toNumber(data.rectW, 0);
    const heightIn = toNumber(data.rectH, 0);
    if (widthIn > 0 && heightIn > 0) {
      return 2 * ((widthIn + heightIn) * 0.0254);
    }
    const diameterIn = toNumber(data.dia_in, fallbackDiameterIn || 0);
    return diameterIn > 0 ? Math.PI * diameterIn * 0.0254 : 0;
  }

  function scenarioDuctSurfaceArea(result) {
    const data = result || {};
    const zoneDuctPlan = data.zoneDuctPlan || {};
    if (Array.isArray(zoneDuctPlan.zones) && zoneDuctPlan.zones.length) {
      return zoneDuctPlan.zones.reduce(function (sum, zone) {
        const routeLengthM = (zone.ductLengthFt || 0) * 0.3048;
        const supplyPerimeterM = ductOuterPerimeterM(zone.supply && zone.supply.trunkDuct, 12);
        const returnPerimeterM = ductOuterPerimeterM(zone.return && zone.return.trunkDuct, 10);
        const processPerimeterM = ductOuterPerimeterM(zone.process && zone.process.trunkDuct, 0);
        const supplyCount = (zone.supply && zone.supply.trunkCount) || 1;
        const returnCount = (zone.return && zone.return.trunkCount) || 1;
        const processCount = (zone.process && zone.process.trunkCount) || 0;
        const processDistributed = !!(zone.process && zone.process.distributed);
        const supplyArea = supplyPerimeterM * routeLengthM * supplyCount;
        const returnArea = returnPerimeterM * routeLengthM * returnCount;
        const processArea = (!processDistributed && processCount) ? processPerimeterM * routeLengthM * processCount : 0;
        return sum + (supplyArea + returnArea + processArea) * 1.18;
      }, 0);
    }
    const inputs = data.inputs || {};
    const length = toNumber(inputs.len, 10);
    const width = toNumber(inputs.wid, 8);
    const perimeter = 2 * (length + width);
    const supplyStrategy = data.ductStrategy && data.ductStrategy.supply;
    const returnStrategy = data.ductStrategy && data.ductStrategy.return;
    const supplyDuct = (supplyStrategy && supplyStrategy.trunkDuct) || data.main_duct || {};
    const returnDuct = (returnStrategy && returnStrategy.trunkDuct) || data.return_duct || {};
    const supplyPerimeterM = ductOuterPerimeterM(supplyDuct, 12);
    const returnPerimeterM = ductOuterPerimeterM(returnDuct, 10);
    const supplyCount = (supplyStrategy && supplyStrategy.trunkCount) || 1;
    const returnCount = (returnStrategy && returnStrategy.trunkCount) || 1;
    const supplyArea = supplyPerimeterM * (perimeter * 0.75) * supplyCount;
    const returnArea = returnPerimeterM * (perimeter * 0.55) * returnCount;
    return (supplyArea + returnArea) * 1.22;
  }

  function scenarioTerminalCounts(result) {
    const data = result || {};
    return {
      supplyDiffusers: Math.max(toNumber(data.diffuserLayout && data.diffuserLayout.diffuserCount, data.n_sup || 0), 0),
      returnGrilles: Math.max(toNumber(data.diffuserLayout && data.diffuserLayout.returns && data.diffuserLayout.returns.count, data.n_ret || 0), 0)
    };
  }

  function scenarioInstalledFanKw(result, summary) {
    const data = result || {};
    const recirculationMotorKw = Math.max(
      toNumber(data.motor_kw, 0),
      toNumber(data.equipmentSelection && data.equipmentSelection.recommendedMotorKW, 0)
    );
    const dedicatedVentilationMotorKw = Math.max(
      toNumber(data.dedicatedVentilationSelection && data.dedicatedVentilationSelection.recommendedMotorKW, 0),
      toNumber(data.dedicatedVentilationSelection && data.dedicatedVentilationSelection.electricalFanKWTotal, 0)
    );
    const processMotorKw = Math.max(
      toNumber(data.processAirSelection && data.processAirSelection.motorKW, 0),
      toNumber(data.processAirSelection && data.processAirSelection.brakeKW, 0)
    );
    const fallback = Math.max(summary && summary.totalFanKW || 0, 0);
    return Math.max(recirculationMotorKw + dedicatedVentilationMotorKw + processMotorKw, fallback);
  }

  function scenarioSelectedTr(result, summary) {
    const data = result || {};
    const recirculationTr = Math.max(
      toNumber(summary && summary.selectedCapacityTR, 0),
      toNumber(data.zoneAhuStrategy && data.zoneAhuStrategy.aggregateSelection && data.zoneAhuStrategy.aggregateSelection.ahu && data.zoneAhuStrategy.aggregateSelection.ahu.capacityTR, 0)
    );
    const ventilationTr = Math.max(
      toNumber(data.dedicatedVentilationSelection && data.dedicatedVentilationSelection.ahu && data.dedicatedVentilationSelection.ahu.capacityTR, 0),
      toNumber(summary && summary.trVentilation, 0)
    );
    return {
      recirculationTr: recirculationTr,
      ventilationTr: ventilationTr,
      totalTr: recirculationTr + ventilationTr
    };
  }

  function scenarioSystemCounts(result, summary, scenario) {
    const data = result || {};
    const clusters = data.zoneAhuStrategy && Array.isArray(data.zoneAhuStrategy.clusters)
      ? data.zoneAhuStrategy.clusters
      : [];
    const terminalCounts = scenarioTerminalCounts(data);
    const trSelection = scenarioSelectedTr(data, summary);
    const cleanroom = data.cleanroom || null;
    const distributedRecirculation = !!(scenario && scenario.overrides && scenario.overrides.architecture && scenario.overrides.architecture.distributedRecirculation);
    return {
      recirculationAhuCount: Math.max(clusters.length || summary && summary.clusterCount || 1, 1),
      ventilationAhuCount: trSelection.ventilationTr > 0.05 ? 1 : 0,
      supplyDiffusers: terminalCounts.supplyDiffusers,
      returnGrilles: terminalCounts.returnGrilles,
      filterModuleCount: cleanroom ? Math.max(terminalCounts.supplyDiffusers, 1) : 0,
      distributedRecirculation: distributedRecirculation
    };
  }

  function scenarioControlComplexityFactor(summary, scenario, result) {
    const data = result || {};
    const dedicatedVentilation = data.dedicatedVentilationSelection ? 1 : 0;
    const distributedRecirculation = !!(scenario && scenario.overrides && scenario.overrides.architecture && scenario.overrides.architecture.distributedRecirculation);
    let factor = 1;
    factor += Math.max((summary && summary.clusterCount || 1) - 1, 0) * 0.08;
    factor += dedicatedVentilation ? 0.08 : 0;
    factor += distributedRecirculation ? 0.15 : 0;
    factor += (summary && summary.zoneCount || 1) > 1 ? 0.05 : 0;
    return roundTo(factor, 2);
  }

  function scenarioFilterItems(result, summary, scenario, costContext) {
    const data = result || {};
    const counts = scenarioSystemCounts(data, summary, scenario);
    const cleanroom = data.cleanroom || null;
    const rates = costContext.rates;
    const items = [];
    const centralBankCount = counts.recirculationAhuCount + counts.ventilationAhuCount;

    if (centralBankCount > 0) {
      items.push({
        code: "5.0",
        category: "FILTER",
        description: "Prefilter banks",
        quantity: centralBankCount,
        unit: "sets",
        rate: rates.rate_filter_prefilter
      });
      items.push({
        code: "5.1",
        category: "FILTER",
        description: cleanroom ? "Fine filter banks" : "Fine bag / compact filter banks",
        quantity: centralBankCount,
        unit: "sets",
        rate: rates.rate_filter_fine
      });
    }

    if (counts.filterModuleCount > 0) {
      const terminalRate = cleanroom && cleanroom.classNumber <= 5
        ? rates.rate_filter_ulpa
        : rates.rate_filter_hepa;
      items.push({
        code: "5.2",
        category: "FILTER",
        description: cleanroom && cleanroom.classNumber <= 5
          ? "Terminal ULPA filters"
          : "Terminal HEPA filters",
        quantity: counts.filterModuleCount,
        unit: "nos",
        rate: terminalRate
      });
      if (counts.distributedRecirculation) {
        items.push({
          code: "5.3",
          category: "FILTER",
          description: "FFU / fan-array recirculation modules",
          quantity: counts.filterModuleCount,
          unit: "nos",
          rate: rates.rate_ffu_module
        });
      }
    }

    return items;
  }

  function estimateScenarioCost(result, summary, scenario, roomContext) {
    const data = result || {};
    const costContext = resolveCostContext(roomContext);
    const rates = costContext.rates;
    const regionMultiplier = costContext.regionMultiplier;
    const trSelection = scenarioSelectedTr(data, summary);
    const counts = scenarioSystemCounts(data, summary, scenario);
    const ductArea = Math.max(scenarioDuctSurfaceArea(data), 0);
    const installedFanKw = Math.max(scenarioInstalledFanKw(data, summary), 0);
    const controlsFactor = scenarioControlComplexityFactor(summary, scenario, data);
    const items = [
      {
        code: "1.0",
        category: "AHU",
        description: "Recirculation / comfort AHU capacity",
        quantity: trSelection.recirculationTr,
        unit: "TR",
        rate: rates.rate_tr
      },
      {
        code: "1.1",
        category: "AHU",
        description: "Dedicated ventilation / make-up AHU capacity",
        quantity: trSelection.ventilationTr,
        unit: "TR",
        rate: rates.rate_tr
      },
      {
        code: "2.0",
        category: "DUCT",
        description: "GI sheet metal ducting",
        quantity: ductArea,
        unit: "m2",
        rate: rates.rate_duct
      },
      {
        code: "2.1",
        category: "DUCT",
        description: "Duct insulation",
        quantity: ductArea,
        unit: "m2",
        rate: rates.rate_insul
      },
      {
        code: "3.0",
        category: "TERMINAL",
        description: "Supply air terminals / modules",
        quantity: counts.supplyDiffusers,
        unit: "nos",
        rate: rates.rate_diffuser
      },
      {
        code: "3.1",
        category: "TERMINAL",
        description: "Return air grilles",
        quantity: counts.returnGrilles,
        unit: "nos",
        rate: rates.rate_return
      },
      {
        code: "4.0",
        category: "FAN",
        description: "Fan and motor package",
        quantity: installedFanKw,
        unit: "kW",
        rate: rates.rate_fan
      },
      {
        code: "4.1",
        category: "PIPING",
        description: "Piping and accessories",
        quantity: trSelection.totalTr,
        unit: "TR",
        rate: rates.rate_pipe
      },
      {
        code: "4.2",
        category: "CONTROLS",
        description: "Controls and BMS",
        quantity: trSelection.totalTr,
        unit: "TR",
        rate: rates.rate_bms * controlsFactor
      }
    ].concat(scenarioFilterItems(data, summary, scenario, costContext)).filter(function (item) {
      return item.quantity > 0.0001;
    }).map(function (item) {
      const adjustedRate = item.rate * regionMultiplier;
      return Object.assign({}, item, {
        rate: roundTo(adjustedRate, 2),
        amountInr: roundTo(item.quantity * adjustedRate, 2)
      });
    });

    const supplyTotalInr = items.reduce(function (sum, item) {
      return sum + item.amountInr;
    }, 0);
    const installationPercent = Math.max(rates.rate_install, 0);
    const installationInr = roundTo(supplyTotalInr * installationPercent / 100, 2);
    const totalCapexInr = roundTo(supplyTotalInr + installationInr, 2);
    const energySource = data.finalEnergyResult || data.energySimulation || {};
    const annualEnergyKwh = Number.isFinite(energySource.annual_energy_kwh)
      ? roundTo(energySource.annual_energy_kwh, 2)
      : summary && summary.annualEnergyKwh != null
        ? roundTo(summary.annualEnergyKwh, 2)
        : null;
    const annualEnergyCostInr = Number.isFinite(energySource.energy_cost)
      ? roundTo(energySource.energy_cost, 2)
      : annualEnergyKwh != null
        ? roundTo(annualEnergyKwh * rates.rate_energy, 2)
        : null;
    const componentTotals = {
      ahuInr: roundTo(items.filter(function (item) { return item.category === "AHU"; }).reduce(function (sum, item) { return sum + item.amountInr; }, 0), 2),
      ductingInr: roundTo(items.filter(function (item) { return item.category === "DUCT"; }).reduce(function (sum, item) { return sum + item.amountInr; }, 0), 2),
      terminalsInr: roundTo(items.filter(function (item) { return item.category === "TERMINAL"; }).reduce(function (sum, item) { return sum + item.amountInr; }, 0), 2),
      fansInr: roundTo(items.filter(function (item) { return item.category === "FAN"; }).reduce(function (sum, item) { return sum + item.amountInr; }, 0), 2),
      filtersInr: roundTo(items.filter(function (item) { return item.category === "FILTER"; }).reduce(function (sum, item) { return sum + item.amountInr; }, 0), 2),
      controlsInr: roundTo(items.filter(function (item) { return item.category === "CONTROLS"; }).reduce(function (sum, item) { return sum + item.amountInr; }, 0), 2),
      pipingInr: roundTo(items.filter(function (item) { return item.category === "PIPING"; }).reduce(function (sum, item) { return sum + item.amountInr; }, 0), 2),
      installationInr: installationInr,
      totalInr: totalCapexInr
    };

    return {
      regionProfile: costContext.regionProfile,
      regionMultiplier: roundTo(regionMultiplier, 2),
      installationPercent: installationPercent,
      items: items,
      ductAreaM2: roundTo(ductArea, 2),
      installedFanKw: roundTo(installedFanKw, 2),
      componentTotals: componentTotals,
      supplyTotalInr: roundTo(supplyTotalInr, 2),
      installationInr: installationInr,
      totalCapexInr: totalCapexInr,
      annualEnergyKwh: annualEnergyKwh,
      annualEnergyCostInr: annualEnergyCostInr,
      controlsFactor: controlsFactor
    };
  }

  function severityPenalty(severity) {
    if (severity === "critical") {
      return 18;
    }
    if (severity === "warning") {
      return 7;
    }
    return 3;
  }

  function airflowSummary(result) {
    const data = result || {};
    if (data.finalDesign && data.finalDesign.airflow) {
      const airflow = data.finalDesign.airflow;
      return {
        coolingAirflowCfm: Math.max(airflow.coolingCFM || 0, 0),
        recirculationAirflowCfm: Math.max(airflow.recirculationCFM || 0, 0),
        additionalRecirculationAirflowCfm: Math.max(airflow.bypassRecirculationCFM || 0, 0),
        ventilationAirflowCfm: Math.max(airflow.ventilationCFM || 0, 0),
        dedicatedVentilationAirflowCfm: Math.max(airflow.dedicatedVentilationCFM || 0, 0),
        processAirflowCfm: Math.max(airflow.processMakeupAirCFM || 0, 0),
        totalRoomAirflowCfm: Math.max(airflow.totalRoomSupplyCFM || 0, 0),
        totalOutdoorAirCfm: Math.max((airflow.outdoorAirThroughCoilCFM || 0) + (airflow.dedicatedVentilationCFM || 0), 0),
        returnAirToCoilCfm: Math.max(airflow.returnAirToCoilCFM || 0, 0),
        returnAirBypassCfm: Math.max(airflow.bypassRecirculationCFM || 0, 0),
        returnAirVentilationPathCfm: Math.max(airflow.ventilationCFM || 0, 0),
        totalRoomReturnAirflowCfm: Math.max((airflow.returnAirToCoilCFM || 0) + (airflow.bypassRecirculationCFM || 0) + (airflow.ventilationCFM || 0), 0),
        achCompliance: Math.max(airflow.ach || 0, 0),
        achRecirculation: Math.max(airflow.achRecirculation || airflow.ach || 0, 0),
        achTotalRoom: Math.max(airflow.achTotalRoom || airflow.ach || 0, 0)
      };
    }
    const airflows = data.airflows || {};
    const cooling = airflows.cooling || {};
    const recirculation = airflows.recirculation || {};
    const ventilation = airflows.ventilation || {};
    const returnAir = airflows.returnAir || data.returnAir || {};
    const room = airflows.room || {};
    return {
      coolingAirflowCfm: Math.max(cooling.airflowCfm != null ? cooling.airflowCfm : (data.cfm_cooling_coil || data.Q_coil_cfm || 0), 0),
      recirculationAirflowCfm: Math.max(recirculation.airflowCfm != null ? recirculation.airflowCfm : (data.cfm_conditioned || data.Q_sup_cfm || 0), 0),
      additionalRecirculationAirflowCfm: Math.max(recirculation.additionalAirflowCfm != null ? recirculation.additionalAirflowCfm : (data.cfm_neutral_recirculation || 0), 0),
      ventilationAirflowCfm: Math.max(ventilation.airflowCfm != null ? ventilation.airflowCfm : (data.ventilation_airflow_cfm || data.cfm_dedicated_ventilation || data.cfm_process_excess || 0), 0),
      dedicatedVentilationAirflowCfm: Math.max(ventilation.dedicatedAirflowCfm != null ? ventilation.dedicatedAirflowCfm : (data.cfm_dedicated_ventilation || 0), 0),
      processAirflowCfm: Math.max(ventilation.processAirflowCfm != null ? ventilation.processAirflowCfm : (data.cfm_process_excess || 0), 0),
      totalRoomAirflowCfm: Math.max(room.totalAirflowCfm != null ? room.totalAirflowCfm : (data.cfm_final || 0), 0),
      totalOutdoorAirCfm: Math.max(ventilation.totalOutdoorAirCfm != null ? ventilation.totalOutdoorAirCfm : (data.fresh_total_cfm || 0), 0),
      returnAirToCoilCfm: Math.max(returnAir.toCoilCfm != null ? returnAir.toCoilCfm : (data.cfm_primary_return || data.cfm_cooling_coil || data.Q_coil_cfm || 0), 0),
      returnAirBypassCfm: Math.max(returnAir.bypassRecirculationCfm != null ? returnAir.bypassRecirculationCfm : (data.cfm_neutral_recirculation || 0), 0),
      returnAirVentilationPathCfm: Math.max(returnAir.ventilationPathCfm != null ? returnAir.ventilationPathCfm : (data.ventilation_airflow_cfm || 0), 0),
      totalRoomReturnAirflowCfm: Math.max(returnAir.totalRoomReturnCfm != null ? returnAir.totalRoomReturnCfm : (data.cfm_final || 0), 0),
      achCompliance: Math.max(room.achCompliance != null ? room.achCompliance : (data.ach || 0), 0),
      achRecirculation: Math.max(room.achRecirculation != null ? room.achRecirculation : (data.ach_recirculation || 0), 0),
      achTotalRoom: Math.max(room.achTotalRoom != null ? room.achTotalRoom : (data.ach_total_room || 0), 0)
    };
  }

  function reserveMargins(result) {
    const zoneAhuStrategy = result && result.zoneAhuStrategy ? result.zoneAhuStrategy : {};
    const selection = zoneAhuStrategy.aggregateSelection || result && result.equipmentSelection || {};
    const ahu = selection.ahu || {};
    return {
      reserveTR: finiteOr(ahu.reserveTR, 0),
      reserveCFM: finiteOr(ahu.reserveCFM, 0),
      reserveESP: finiteOr(ahu.reserveESP, 0)
    };
  }

  function summarizeSystem(result, reasoning, scenario) {
    const data = result || {};
    const flows = airflowSummary(data);
    const validation = data.validation || {};
    const ventilation = data.standardsContext && data.standardsContext.ventilation
      ? data.standardsContext.ventilation
      : {};
    const zoneAhuStrategy = data.zoneAhuStrategy || {};
    const selection = zoneAhuStrategy.aggregateSelection || data.equipmentSelection || {};
    const ahu = selection.ahu || {};
    const margins = reserveMargins(data);
    const finalDesign = data.finalDesign || {};
    const finalFans = finalDesign.fans || {};
    const finalLoads = finalDesign.loads || {};
    const finalEsp = finalDesign.esp || {};
    const finalEquipment = finalDesign.equipment || {};
    const finalEnergy = data.finalEnergyResult || data.energySimulation || {};
    const totalFanKW = roundTo(
      finalFans.totalFanKW != null
        ? finalFans.totalFanKW
        : (data.cooling_fan_kw || 0) + (data.recirculation_fan_kw || 0) + (data.ventilation_fan_kw || 0),
      3
    );
    const clusters = Array.isArray(zoneAhuStrategy.clusters) ? zoneAhuStrategy.clusters : [];
    const scenarioArchitecture = scenario && scenario.architecture ? scenario.architecture : {};
    return {
      scenarioKey: scenario && scenario.key ? scenario.key : "base",
      scenarioTitle: scenario && scenario.title ? scenario.title : "Base design",
      scenarioIntent: scenario && scenario.intent ? scenario.intent : "baseline",
      architectureLabel: scenarioArchitecture.label
        || (data.systemRecommendation && data.systemRecommendation.primarySystem)
        || (data.systemArchitecture && data.systemArchitecture.mode)
        || "Current design",
      cleanroomMode: !!data.cleanroom,
      cleanroomLabel: data.cleanroom && data.cleanroom.classLabel ? data.cleanroom.classLabel : "",
      zoneCount: Math.max(data.autoZoning && data.autoZoning.zoneCount || 1, 1),
      clusterCount: Math.max(clusters.length || 0, 1),
      areaM2: finiteOr(data.area, 0),
      volumeM3: finiteOr(data.volume, 0),
      trFinal: Math.max(finiteOr(finalLoads.trFinal, data.tr_final || 0), 0),
      trCoolingCoil: Math.max(finiteOr(data.tr_cooling_coil, data.tr_airflow || data.tr_final || 0), 0),
      trVentilation: Math.max(finiteOr(data.tr_ventilation, 0), 0),
      totalEspPa: Math.max(finiteOr(finalEsp.totalPa, data.total_esp || 0), 0),
      ductFrictionPa: Math.max(finiteOr(finalEsp.ductFrictionPa, data.duct_friction || 0), 0),
      fittingLossPa: Math.max(finiteOr(finalEsp.fittingLossPa, data.fitting_loss || 0), 0),
      equipmentLossPa: Math.max(finiteOr(finalEsp.equipmentLossPa, data.equipment_loss || 0), 0),
      totalFanKW: totalFanKW,
      coolingFanKW: Math.max(finiteOr(finalFans.coolingFanKW, data.cooling_fan_kw || 0), 0),
      recirculationFanKW: Math.max(finiteOr(finalFans.recirculationFanKW, data.recirculation_fan_kw || 0), 0),
      ventilationFanKW: Math.max(finiteOr(finalFans.ventilationFanKW, data.ventilation_fan_kw || 0), 0),
      annualEnergyKwh: Number.isFinite(finalEnergy.annual_energy_kwh)
        ? finalEnergy.annual_energy_kwh
        : null,
      specificFanPowerKWPerTR: finiteOr(data.energyOptimization && data.energyOptimization.specificFanPowerKWPerTR, 0),
      installedMotorSpecificFanPowerKWPerTR: finiteOr(data.energyOptimization && data.energyOptimization.installedMotorSpecificFanPowerKWPerTR, 0),
      coolingAirflowCfm: flows.coolingAirflowCfm,
      recirculationAirflowCfm: flows.recirculationAirflowCfm,
      ventilationAirflowCfm: flows.ventilationAirflowCfm,
      totalRoomAirflowCfm: flows.totalRoomAirflowCfm,
      returnAirToCoilCfm: flows.returnAirToCoilCfm,
      returnAirBypassCfm: flows.returnAirBypassCfm,
      returnAirVentilationPathCfm: flows.returnAirVentilationPathCfm,
      totalRoomReturnAirflowCfm: flows.totalRoomReturnAirflowCfm,
      outdoorAirCfm: flows.totalOutdoorAirCfm,
      achActual: flows.achCompliance,
      achRecirculation: flows.achRecirculation,
      achTotalRoom: flows.achTotalRoom,
      achRequired: Math.max(finiteOr(data.ach_required, 0), finiteOr(data.cleanroom && data.cleanroom.designAch, 0)),
      ventilationRequiredCfm: Math.max(finiteOr(ventilation.designOutdoorAirCfm, ventilation.minimumOutdoorAirCfm || 0), 0),
      ventilationProvidedCfm: Math.max(finiteOr(data.fresh_total_cfm, flows.totalOutdoorAirCfm), 0),
      psychroConverged: !(data.psychro && data.psychro.converged === false),
      validationStatus: validation.status || "REVIEW",
      validationSummary: validation.summary || "",
      validationFindings: Array.isArray(validation.findings) ? validation.findings.slice() : [],
      confidenceScore: finiteOr(validation.confidenceScore, reasoning && reasoning.confidenceScore || 0.75),
      designConstraintStatus: data.designConstraints && data.designConstraints.status
        ? data.designConstraints.status
        : "APPROVED",
      designConstraintSummary: data.designConstraints && data.designConstraints.summary
        ? data.designConstraints.summary
        : "",
      reserveTR: margins.reserveTR,
      reserveCFM: margins.reserveCFM,
      reserveESP: margins.reserveESP,
      selectedCapacityTR: Math.max(
        finiteOr(finalEquipment.selectedAhuTR, ahu.capacityTR || 0),
        finiteOr(data.tr_catalog_equipment, data.tr_catalog || data.tr_final || 0)
      ),
      systemRecommendation: data.systemRecommendation && data.systemRecommendation.reasoning
        ? data.systemRecommendation.reasoning
        : "",
      scenarioOverrides: scenario && scenario.overrides ? copyJson(scenario.overrides) : null
    };
  }

  function summarizeProblemList(baseResult, reasoning) {
    const report = reasoning || baseResult && baseResult.designAdvisor || {};
    const rootCauses = Array.isArray(report.rootCauseAnalysis) ? report.rootCauseAnalysis : [];
    if (rootCauses.length) {
      return rootCauses.map(function (entry, index) {
        return {
          rank: index + 1,
          key: entry.key || ("issue-" + (index + 1)),
          category: entry.category || "design",
          severity: entry.severity || "warning",
          problem: entry.problem || entry.title || "Design issue identified.",
          rootCauses: Array.isArray(entry.rootCauses) ? entry.rootCauses.slice(0, 3) : [],
          impact: entry.impact || "",
          recommendation: entry.recommendation || ""
        };
      });
    }

    const validationFindings = baseResult && baseResult.validation && Array.isArray(baseResult.validation.findings)
      ? baseResult.validation.findings
      : [];
    return validationFindings.slice(0, 4).map(function (finding, index) {
      return {
        rank: index + 1,
        key: finding.code || ("finding-" + (index + 1)),
        category: finding.category || "validation",
        severity: finding.severity || "warning",
        problem: finding.title || finding.detail || "Validation issue identified.",
        rootCauses: [finding.basis || "Existing validation finding"],
        impact: finding.detail || "",
        recommendation: finding.recommendation || ""
      };
    });
  }

  function scenarioNote(text, fallback) {
    return String(text || fallback || "").trim();
  }

  function buildScenarioBlueprint(key, state) {
    const zoneFloor = Math.max(state.zoneCount || 1, 1);
    if (key === "low_static_airside") {
      return {
        key: key,
        title: "Reduced static pressure configuration",
        intent: "efficient",
        architecture: {
          label: state.cleanroomMode
            ? "Low-static recirculation cleanroom"
            : "Low-static central airside system"
        },
        why: "Reduces duct, fitting, and equipment static losses so the same duty is served with lower fan power.",
        whenToUse: "Best when fan energy, ESP, or filter losses are dominating the design.",
        tradeoffs: [
          "Requires tighter duct routing and component-pressure discipline",
          "May need more air paths or shorter trunk runs to realize the static-pressure target"
        ],
        actions: [
          "Shorten trunk paths and reduce avoidable fittings",
          "Use lower-loss filters / coils where available",
          "Hold the same airflow hierarchy while lowering resistance"
        ],
        overrides: {
          pressureAdjustments: {
            ductFrictionFactor: state.cleanroomMode ? 0.78 : 0.82,
            fittingLossFactor: state.cleanroomMode ? 0.80 : 0.85,
            equipmentLossFactor: state.cleanroomMode ? 0.86 : 0.90
          },
          zoning: {
            forceMinZones: Math.max(zoneFloor, state.totalEspPa > 700 ? 2 : zoneFloor)
          },
          equipmentSizing: {
            reserveMarginDelta: -0.01
          }
        }
      };
    }

    if (key === "multi_ahu_split") {
      return {
        key: key,
        title: "Multi-AHU split system",
        intent: "balanced",
        architecture: {
          label: state.cleanroomMode
            ? "Split recirculation AHUs with dedicated make-up air"
            : "Multi-AHU zoned airside system"
        },
        why: "Splits long or high-airflow duties into smaller air handlers so duct pressure and control burden drop together.",
        whenToUse: "Best when a single unit is carrying high ESP, long throws, or too much recirculation airflow for one control zone.",
        tradeoffs: [
          "Higher equipment count and controls complexity",
          "More installation interfaces and TAB scope"
        ],
        actions: [
          "Cluster zones around practical AHU service areas",
          "Reduce per-unit duct and fan duty",
          "Keep coil airflow and room recirculation separated per cluster"
        ],
        overrides: {
          zoning: {
            forceMinZones: Math.max(zoneFloor + 1, 2)
          },
          pressureAdjustments: {
            ductFrictionFactor: 0.88,
            fittingLossFactor: 0.90,
            equipmentLossFactor: 0.95
          }
        }
      };
    }

    if (key === "doas_recirculation") {
      return {
        key: key,
        title: "DOAS + recirculation separation",
        intent: "balanced",
        architecture: {
          label: state.cleanroomMode
            ? "Dedicated make-up air + cleanroom recirculation"
            : "DOAS + recirculation AHU"
        },
        why: "Separates outdoor-air duty from the main recirculation circuit so ventilation does not inflate coil airflow or fan duty.",
        whenToUse: "Best when outdoor air, make-up air, or pressurization is materially affecting the main air system.",
        tradeoffs: [
          "Adds a dedicated ventilation path and controls layer",
          "Requires careful balance between pressurization and recirculation flows"
        ],
        actions: [
          "Move ventilation to a dedicated air path",
          "Keep cooling airflow sized to coil duty only",
          "Use the recirculation system for room-air motion / cleanliness"
        ],
        overrides: {
          airflowStrategy: {
            forceDedicatedVentilation: true,
            roomDeltaTDeltaC: state.cleanroomMode ? 0.2 : 0.6
          },
          pressureAdjustments: {
            ductFrictionFactor: 0.90,
            fittingLossFactor: 0.92,
            equipmentLossFactor: 0.94
          },
          zoning: {
            forceMinZones: Math.max(zoneFloor, state.ventilationAirflowCfm > 0 ? 2 : zoneFloor)
          }
        }
      };
    }

    if (key === "mandatory_ach_recirculation") {
      return {
        key: key,
        title: "Mandatory ACH recirculation recovery",
        intent: "compliance_recovery",
        architecture: { label: "Conditioned recirculation module for mandatory ACH" },
        why: "Addresses ACH shortfall with a defined conditioned recirculation path before energy or cost scoring.",
        whenToUse: "Use when ACH is mandatory for cleanroom, healthcare, lab, process, or explicit owner criteria.",
        tradeoffs: ["Higher fan duty unless static pressure is redesigned", "Requires filtration, return path, and controls basis"],
        actions: ["Increase conditioned supply / recirculation airflow", "Define filtration and return path", "Keep cooling-coil airflow separate from non-cooling recirculation"],
        overrides: {
          airflowStrategy: { roomDeltaTDeltaC: -0.5 },
          zoning: { forceMinZones: Math.max(zoneFloor + 1, 2) },
          pressureAdjustments: { ductFrictionFactor: 0.92, fittingLossFactor: 0.92, equipmentLossFactor: 0.96 }
        }
      };
    }

    if (key === "ventilation_recovery_doas") {
      return {
        key: key,
        title: "Ventilation compliance DOAS/MAU recovery",
        intent: "compliance_recovery",
        architecture: { label: "DOAS / MAU with defined supply state" },
        why: "Solves outdoor-air shortfall with a thermodynamically defined ventilation path.",
        whenToUse: "Use when ASHRAE/ISHRAE outdoor-air compliance is the blocker.",
        tradeoffs: ["Adds equipment and controls", "Needs coil and fan energy counted in annual model"],
        actions: ["Increase outdoor air to the validated minimum", "Define MAU supply state", "Re-run energy and coil sizing on finalized streams"],
        overrides: {
          airflowStrategy: { forceDedicatedVentilation: true, roomDeltaTDeltaC: 0.4 },
          zoning: { forceMinZones: Math.max(zoneFloor, 2) }
        }
      };
    }

    if (key === "colder_supply_lower_cfm") {
      return {
        key: key,
        title: "Lower airflow colder-supply concept",
        intent: "energy",
        architecture: { label: "Lower CFM with checked ADP / humidity control" },
        why: "Reduces high comfort CFM/TR by increasing supply-air delta T where comfort and latent limits allow.",
        whenToUse: "Use when airflow is high but ACH is advisory and latent control remains valid.",
        tradeoffs: ["Requires diffuser throw and condensation checks", "May need deeper coil / lower ADP"],
        actions: ["Increase room delta T", "Check ADP and bypass factor", "Revise diffuser count and throw"],
        overrides: {
          airflowStrategy: { roomDeltaTDeltaC: 1.2 },
          equipmentSizing: { reserveMarginDelta: -0.01 }
        }
      };
    }

    if (key === "ffu_fan_array") {
      return {
        key: key,
        title: "FFU / fan-array recirculation concept",
        intent: "efficient",
        architecture: {
          label: "DOAS + distributed FFU / fan-array recirculation"
        },
        why: "Uses distributed recirculation to cut central duct static while keeping cleanroom recirculation independent from the cooling coil.",
        whenToUse: "Best for cleanrooms where recirculation dominates cooling airflow and fan energy is a primary operating concern.",
        tradeoffs: [
          "Higher first cost and commissioning scope",
          "Maintenance shifts toward more distributed fan sections"
        ],
        actions: [
          "Separate make-up air from recirculation duty",
          "Reduce central duct and fitting losses aggressively",
          "Use distributed fan energy only where cleanroom architecture supports it"
        ],
        overrides: {
          airflowStrategy: {
            forceDedicatedVentilation: true,
            roomDeltaTDeltaC: 0.3
          },
          pressureAdjustments: {
            ductFrictionFactor: 0.70,
            fittingLossFactor: 0.72,
            equipmentLossFactor: 0.82
          },
          zoning: {
            forceMinZones: Math.max(zoneFloor + 1, 2)
          },
          architecture: {
            distributedRecirculation: true
          },
          equipmentSizing: {
            reserveMarginDelta: -0.01
          }
        }
      };
    }

    return {
      key: "cost_optimized_minimal",
      title: "Cost-optimized minimum configuration",
      intent: "cost_effective",
      architecture: {
        label: state.cleanroomMode
          ? "Minimum-complexity cleanroom support system"
          : "Minimum-complexity central system"
      },
      why: "Preserves the current architecture with modest tuning so first cost stays controlled.",
      whenToUse: "Best when the present design is already close to compliance and capital cost is the main constraint.",
      tradeoffs: [
        "Smaller operating-cost gain than the efficiency-focused options",
        "Leaves less headroom for future airflow or process changes"
      ],
      actions: [
        "Hold the architecture simple",
        "Trim non-essential reserve margin",
        "Use moderate static-pressure cleanup instead of a full redesign"
      ],
      overrides: {
        airflowStrategy: {
          roomDeltaTDeltaC: state.cleanroomMode ? 0.1 : 0.4
        },
        pressureAdjustments: {
          ductFrictionFactor: 0.95,
          fittingLossFactor: 0.96,
          equipmentLossFactor: 0.98
        },
        equipmentSizing: {
          reserveMarginDelta: -0.02
        },
        zoning: {
          forceMinZones: zoneFloor
        }
      }
    };
  }

  function chooseScenarioKeys(state, inefficiencies) {
    const issues = Array.isArray(inefficiencies) ? inefficiencies : [];
    const categories = issues.map(function (entry) {
      return String(entry.category || "").toLowerCase();
    });
    const keys = [];
    const recircDominant = state.recirculationAirflowCfm > state.coolingAirflowCfm * 1.5;
    const ventilationMaterial = state.ventilationAirflowCfm > state.coolingAirflowCfm * 0.15 || state.cleanroomMode;
    const staticDominant = state.totalEspPa > 650
      || state.specificFanPowerKWPerTR > 0.95
      || categories.indexOf("energy") !== -1
      || categories.indexOf("equipment") !== -1;
    const zoningPressure = state.zoneCount <= 1
      && (state.totalRoomAirflowCfm > 4000 || state.totalEspPa > 700 || state.areaM2 > 140);
    const hasMandatoryAchBlocker = (state.validationFindings || []).some(function (finding) {
      return finding && finding.code === "ach_shortfall";
    });
    const hasVentilationBlocker = (state.validationFindings || []).some(function (finding) {
      return finding && finding.code === "ventilation_shortfall";
    });
    const highComfortCfm = state.validationStatus !== "NON_COMPLIANT" && state.coolingAirflowCfm > 0 && state.trFinal > 0 && state.coolingAirflowCfm / Math.max(state.trFinal, 0.1) > 475;

    if (hasMandatoryAchBlocker) {
      keys.push("mandatory_ach_recirculation");
    }
    if (hasVentilationBlocker) {
      keys.push("ventilation_recovery_doas");
    }
    if (highComfortCfm) {
      keys.push("colder_supply_lower_cfm");
    }
    if (staticDominant) {
      keys.push("low_static_airside");
    }
    if (ventilationMaterial) {
      keys.push("doas_recirculation");
    }
    if (state.cleanroomMode && recircDominant) {
      keys.push("ffu_fan_array");
    }
    if (zoningPressure || categories.indexOf("distribution") !== -1 || categories.indexOf("ductwork") !== -1) {
      keys.push("multi_ahu_split");
    }
    keys.push("cost_optimized_minimal");

    if (keys.indexOf("low_static_airside") === -1) {
      keys.unshift("low_static_airside");
    }
    if (keys.indexOf("multi_ahu_split") === -1 && !state.cleanroomMode) {
      keys.splice(Math.min(keys.length, 2), 0, "multi_ahu_split");
    }
    return uniqueByKey(keys.map(function (key) {
      return { key: key };
    })).map(function (item) {
      return item.key;
    }).slice(0, 4);
  }

  function generateScenarios(options) {
    const settings = options || {};
    const state = summarizeSystem(settings.baseResult || {}, settings.reasoning || null, null);
    const inefficiencies = summarizeProblemList(settings.baseResult || {}, settings.reasoning || null);
    return chooseScenarioKeys(state, inefficiencies).map(function (key) {
      return buildScenarioBlueprint(key, state);
    });
  }

  function captureSimulationOutputs(result, scenario) {
    const data = result || {};
    const flows = airflowSummary(data);
    const validation = data.validation || {};
    const findings = Array.isArray(validation.findings) ? validation.findings : [];
    const zoneAhuStrategy = data.zoneAhuStrategy || {};
    const selection = zoneAhuStrategy.aggregateSelection || data.equipmentSelection || {};
    const ahu = selection.ahu || {};
    const energy = data.finalEnergyResult || data.energySimulation || {};
    const finalDesign = data.finalDesign || {};
    const finalFans = finalDesign.fans || {};
    const finalLoads = finalDesign.loads || {};
    const finalEsp = finalDesign.esp || {};
    const finalEquipment = finalDesign.equipment || {};
    const airflowHierarchyValid = !findings.some(function (finding) {
      return ["coil_airflow_mismatch", "coil_return_air_mismatch", "cfm_per_tr_not_on_cooling_airflow"].indexOf(finding.code) !== -1;
    });
    return {
      scenarioKey: scenario && scenario.key ? scenario.key : "base",
      scenarioTitle: scenario && scenario.title ? scenario.title : "Base design",
      coolingAirflowCfm: roundTo(flows.coolingAirflowCfm, 1),
      recirculationAirflowCfm: roundTo(flows.recirculationAirflowCfm, 1),
      ventilationAirflowCfm: roundTo(flows.ventilationAirflowCfm, 1),
      totalRoomAirflowCfm: roundTo(flows.totalRoomAirflowCfm, 1),
      returnAir: {
        toCoilCfm: roundTo(flows.returnAirToCoilCfm, 1),
        bypassRecirculationCfm: roundTo(flows.returnAirBypassCfm, 1),
        ventilationPathCfm: roundTo(flows.returnAirVentilationPathCfm, 1),
        totalRoomReturnCfm: roundTo(flows.totalRoomReturnAirflowCfm, 1)
      },
      fanPowerKw: {
	        cooling: roundTo(finalFans.coolingFanKW != null ? finalFans.coolingFanKW : data.cooling_fan_kw || 0, 3),
	        recirculation: roundTo(finalFans.recirculationFanKW != null ? finalFans.recirculationFanKW : data.recirculation_fan_kw || 0, 3),
	        ventilation: roundTo(finalFans.ventilationFanKW != null ? finalFans.ventilationFanKW : data.ventilation_fan_kw || 0, 3),
	        total: roundTo(finalFans.totalFanKW != null ? finalFans.totalFanKW : (data.cooling_fan_kw || 0) + (data.recirculation_fan_kw || 0) + (data.ventilation_fan_kw || 0), 3)
      },
      energy: {
        annualKwh: Number.isFinite(energy.annual_energy_kwh) ? roundTo(energy.annual_energy_kwh, 2) : null,
        coolingKwh: Number.isFinite(energy.cooling_energy) ? roundTo(energy.cooling_energy, 2) : null,
        fanKwh: Number.isFinite(energy.fan_energy) ? roundTo(energy.fan_energy, 2) : null,
        ventilationFanKwh: Number.isFinite(energy.process_energy) ? roundTo(energy.process_energy, 2) : null,
        annualCost: Number.isFinite(energy.energy_cost) ? roundTo(energy.energy_cost, 2) : null,
        peakPowerKw: Number.isFinite(energy.peak_power_kw) ? roundTo(energy.peak_power_kw, 3) : null
      },
      staticPressure: {
        totalPa: roundTo(finalEsp.totalPa != null ? finalEsp.totalPa : data.total_esp || 0, 1),
        ductPa: roundTo(finalEsp.ductFrictionPa != null ? finalEsp.ductFrictionPa : data.duct_friction || 0, 1),
        fittingPa: roundTo(finalEsp.fittingLossPa != null ? finalEsp.fittingLossPa : data.fitting_loss || 0, 1),
        equipmentPa: roundTo(finalEsp.equipmentLossPa != null ? finalEsp.equipmentLossPa : data.equipment_loss || 0, 1)
      },
      equipmentSizing: {
        trFinal: roundTo(finalLoads.trFinal != null ? finalLoads.trFinal : data.tr_final || 0, 2),
        trCoolingCoil: roundTo(data.tr_cooling_coil || data.tr_airflow || 0, 2),
        selectedCapacityTR: roundTo(finalEquipment.selectedAhuTR != null ? finalEquipment.selectedAhuTR : ahu.capacityTR || data.tr_catalog_equipment || data.tr_catalog || data.tr_final || 0, 2),
        reserveTR: roundTo(ahu.reserveTR || 0, 2),
        reserveCFM: roundTo(ahu.reserveCFM || 0, 1),
        reserveESP: roundTo(ahu.reserveESP || 0, 1),
        zoneCount: Math.max(data.autoZoning && data.autoZoning.zoneCount || 1, 1),
        ahuClusterCount: Math.max(Array.isArray(zoneAhuStrategy.clusters) ? zoneAhuStrategy.clusters.length : 0, 1)
      },
      compliance: {
        status: validation.status || "REVIEW",
        psychroConverged: !(data.psychro && data.psychro.converged === false),
        achActual: roundTo(data.ach || flows.achCompliance || 0, 2),
        achRequired: roundTo(Math.max(data.ach_required || 0, data.cleanroom && data.cleanroom.designAch || 0), 2),
        airflowHierarchyValid: airflowHierarchyValid,
        equipmentValid: !(data.designConstraints && data.designConstraints.status === "REJECTED")
      }
    };
  }

  function getBaseSystemState(options) {
    const settings = options || {};
    const baseResult = copyJson(settings.baseResult || {});
    const baseInputs = copyJson(settings.baseInputs || baseResult.inputs || {});
    const reasoning = settings.reasoning || baseResult.designAdvisor || null;
    const summary = summarizeSystem(baseResult, reasoning, null);
    const outputs = captureSimulationOutputs(baseResult, { key: "base", title: "Base design" });

    return {
      roomContext: copyJson(settings.roomContext || {}),
      baseInputs: baseInputs,
      baseResult: baseResult,
      reasoning: copyJson(reasoning),
      summary: summary,
      outputs: outputs,
      snapshot: {
        roomData: {
          inputs: copyJson(baseInputs),
          areaM2: roundTo(baseResult.area || 0, 2),
          volumeM3: roundTo(baseResult.volume || 0, 2),
          designMode: baseResult.inputs && baseResult.inputs.design_mode ? baseResult.inputs.design_mode : ""
        },
        loadResults: {
          sensibleW: roundTo(baseResult.spaceSensible || 0, 1),
          latentW: roundTo(baseResult.spaceLatent || 0, 1),
          totalW: roundTo(baseResult.totalLoad || 0, 1),
          trFinal: roundTo(baseResult.tr_final || 0, 2),
          trCoolingCoil: roundTo(baseResult.tr_cooling_coil || baseResult.tr_airflow || 0, 2)
        },
        airflowBreakdown: {
          coolingAirflowCfm: outputs.coolingAirflowCfm,
          recirculationAirflowCfm: outputs.recirculationAirflowCfm,
          ventilationAirflowCfm: outputs.ventilationAirflowCfm,
          totalRoomAirflowCfm: outputs.totalRoomAirflowCfm,
          returnAirToCoilCfm: outputs.returnAir.toCoilCfm,
          returnAirBypassCfm: outputs.returnAir.bypassRecirculationCfm,
          ventilationReturnPathCfm: outputs.returnAir.ventilationPathCfm,
          totalRoomReturnCfm: outputs.returnAir.totalRoomReturnCfm
        },
        systemArchitecture: copyJson(baseResult.systemArchitecture || {}),
        fanConfiguration: {
          coolingFanKw: outputs.fanPowerKw.cooling,
          recirculationFanKw: outputs.fanPowerKw.recirculation,
          ventilationFanKw: outputs.fanPowerKw.ventilation,
          totalFanKw: outputs.fanPowerKw.total
        },
        staticPressure: copyJson(outputs.staticPressure),
        equipmentSelection: copyJson(baseResult.zoneAhuStrategy && baseResult.zoneAhuStrategy.aggregateSelection || baseResult.equipmentSelection || {})
      }
    };
  }

  function applyScenario(baseState, scenarioDefinition) {
    const scenario = copyJson(scenarioDefinition || {});
    return {
      roomContext: copyJson(baseState && baseState.roomContext || {}),
      baseInputs: copyJson(baseState && baseState.baseInputs || {}),
      reasoning: copyJson(baseState && baseState.reasoning || null),
      scenario: scenario,
      mutatedInputs: copyJson(baseState && baseState.baseInputs || {}),
      runtimeOptions: {
        optimizationScenario: scenario,
        optimizationMode: true,
        skipAiEnhancements: true
      },
      snapshot: {
        baseSnapshot: copyJson(baseState && baseState.snapshot || {}),
        scenarioInputModifications: copyJson(scenario.overrides || {})
      }
    };
  }

  function normalizeEnergyReport(response) {
    if (!response) {
      return null;
    }
    if (Number.isFinite(response.annual_energy_kwh)) {
      return copyJson(response);
    }
    if (response.report && Number.isFinite(response.report.annual_energy_kwh)) {
      return copyJson(response.report);
    }
    return null;
  }

  async function runBaseSystemSimulation(baseState, callbacks) {
    const settings = callbacks || {};
    const baseResult = copyJson(baseState && baseState.baseResult || {});
    const energyReport = normalizeEnergyReport(baseResult.energySimulation)
      || (settings.simulateEnergy ? normalizeEnergyReport(await settings.simulateEnergy(baseResult, baseState.roomContext, {
        scenario: { key: "base", title: "Base design" }
      })) : null);
    if (energyReport) {
      baseResult.energySimulation = energyReport;
      baseResult.energySimulationStatus = "ready";
      baseResult.energySimulationError = "";
    }
    return {
      scenario: { key: "base", title: "Base design", intent: "baseline", overrides: {} },
      success: true,
      result: baseResult,
      summary: summarizeSystem(baseResult, baseState.reasoning, null),
      outputs: captureSimulationOutputs(baseResult, { key: "base", title: "Base design" })
    };
  }

  async function runFullSimulation(systemState, callbacks) {
    const settings = callbacks || {};
    if (typeof settings.calculateRoom !== "function") {
      throw new Error("run_full_simulation requires the shared calculateRoom callback.");
    }
    const calculated = await Promise.resolve(settings.calculateRoom(
      copyJson(systemState && systemState.mutatedInputs || {}),
      copyJson(systemState && systemState.runtimeOptions || {})
    ));
    const result = copyJson(calculated || {});
	    let energyReport = normalizeEnergyReport(result.finalEnergyResult || result.energySimulation);

    if (!energyReport && typeof settings.simulateEnergy === "function") {
      energyReport = normalizeEnergyReport(await settings.simulateEnergy(result, systemState.roomContext, systemState));
    }

	    if (energyReport) {
	      result.finalEnergyResult = energyReport;
	      result.energySimulation = energyReport;
      result.energySimulationStatus = "ready";
      result.energySimulationError = "";
    }

    return {
      scenario: copyJson(systemState && systemState.scenario || {}),
      systemState: copyJson(systemState || {}),
      success: true,
      result: result,
      summary: summarizeSystem(result, systemState && systemState.reasoning || null, systemState && systemState.scenario || null),
      outputs: captureSimulationOutputs(result, systemState && systemState.scenario || null)
    };
  }

  function runScenarios(options) {
    const settings = options || {};
    const simulateScenario = settings.simulateScenario;
    if (typeof simulateScenario !== "function") {
      throw new Error("SimulationRunner requires a simulateScenario callback.");
    }
    return (settings.scenarios || []).map(function (scenario) {
      try {
        const result = simulateScenario(copyJson(scenario));
        return {
          scenario: copyJson(scenario),
          success: true,
          result: result
        };
      } catch (error) {
        return {
          scenario: copyJson(scenario),
          success: false,
          error: error && error.message ? error.message : "Scenario simulation failed."
        };
      }
    });
  }

  function scenarioCapexObjective(costEstimate) {
    return costEstimate && Number.isFinite(costEstimate.totalCapexInr)
      ? roundTo(costEstimate.totalCapexInr, 2)
      : null;
  }

  function scenarioEnergyObjective(summary, strictEnergy) {
    if (summary.annualEnergyKwh != null) {
      return summary.annualEnergyKwh;
    }
    if (strictEnergy) {
      return null;
    }
    return roundTo(
      (summary.totalFanKW * 0.55)
      + (summary.specificFanPowerKWPerTR * 18)
      + (summary.totalEspPa / 180)
      + (summary.trCoolingCoil * 0.35),
      4
    );
  }

  function scenarioComplianceScore(summary) {
    let score = summary.validationStatus === "COMPLIANT"
      ? 84
      : summary.validationStatus === "REVIEW"
        ? 66
        : 0;
    score += clamp(summary.achActual - summary.achRequired, -4, 10) * 1.2;
    score += clamp(safeDiv(summary.ventilationProvidedCfm - summary.ventilationRequiredCfm, Math.max(summary.ventilationRequiredCfm, 1), 0), -0.3, 0.25) * 18;
    if (!summary.psychroConverged) {
      score -= 18;
    }
    (summary.validationFindings || []).forEach(function (finding) {
      score -= severityPenalty(finding.severity);
    });
    if (summary.designConstraintStatus === "REJECTED") {
      score -= 20;
    } else if (summary.designConstraintStatus === "REVIEW") {
      score -= 8;
    }
    return clamp(roundTo(score, 1), 0, 100);
  }

  function scenarioFeasibilityScore(summary) {
    let score = summary.designConstraintStatus === "APPROVED"
      ? 82
      : summary.designConstraintStatus === "REVIEW"
        ? 62
        : 30;
    score += clamp(safeDiv(summary.reserveESP, Math.max(summary.totalEspPa, 1), 0), -0.1, 0.25) * 42;
    score += clamp(safeDiv(summary.reserveTR, Math.max(summary.trFinal, 0.1), 0), -0.08, 0.20) * 38;
    score += clamp(safeDiv(summary.reserveCFM, Math.max(summary.coolingAirflowCfm, 1), 0), -0.05, 0.15) * 24;
    score -= Math.max(summary.zoneCount - 3, 0) * 3;
    if (summary.validationStatus === "NON_COMPLIANT") {
      score -= 26;
    }
    return clamp(roundTo(score, 1), 0, 100);
  }

  function scenarioComfortScore(summary) {
    let score = 76;
    const cfmPerTr = safeDiv(summary.coolingAirflowCfm, Math.max(summary.trFinal, 0.1), 0);
    if (cfmPerTr > 0) {
      score -= Math.max(cfmPerTr - 475, 0) * 0.08;
      score -= Math.max(260 - cfmPerTr, 0) * 0.12;
      score += cfmPerTr >= 330 && cfmPerTr <= 450 ? 10 : 0;
    }
    const ventilationMargin = safeDiv(summary.ventilationProvidedCfm - summary.ventilationRequiredCfm, Math.max(summary.ventilationRequiredCfm, 1), 0);
    score += clamp(ventilationMargin, -0.25, 0.2) * 24;
    if (summary.cleanroomMode && summary.achActual >= summary.achRequired) {
      score += 6;
    }
    return clamp(roundTo(score, 1), 0, 100);
  }

  function scenarioPsychrometricScore(summary) {
    let score = summary.psychroConverged ? 82 : 35;
    (summary.validationFindings || []).forEach(function (finding) {
      const category = String(finding.category || finding.code || "").toLowerCase();
      if (category.indexOf("psych") !== -1 || category.indexOf("shr") !== -1 || category.indexOf("enthalpy") !== -1) {
        score -= severityPenalty(finding.severity);
      }
    });
    if (summary.trCoolingCoil > summary.trFinal * 1.08) {
      score -= 8;
    }
    return clamp(roundTo(score, 1), 0, 100);
  }

  function scenarioConstructabilityScore(summary) {
    let score = summary.designConstraintStatus === "APPROVED" ? 78 : summary.designConstraintStatus === "REVIEW" ? 58 : 28;
    score -= Math.max((summary.zoneCount || 1) - 4, 0) * 5;
    score -= Math.max((summary.clusterCount || 1) - 3, 0) * 4;
    score -= Math.max((summary.totalEspPa || 0) - 950, 0) / 18;
    score -= Math.max((summary.coolingAirflowCfm || 0) - 12000, 0) / 700;
    score += summary.reserveESP > 0 ? 5 : -8;
    return clamp(roundTo(score, 1), 0, 100);
  }

  function scenarioControlComplexityScore(summary) {
    let score = 86;
    score -= Math.max((summary.zoneCount || 1) - 1, 0) * 5;
    score -= Math.max((summary.clusterCount || 1) - 1, 0) * 4;
    if ((summary.ventilationAirflowCfm || 0) > 0 && (summary.recirculationAirflowCfm || 0) > (summary.coolingAirflowCfm || 0) * 1.25) {
      score -= 8;
    }
    if (summary.cleanroomMode) {
      score -= 5;
    }
    if (summary.designConstraintStatus === "REVIEW") {
      score -= 8;
    }
    return clamp(roundTo(score, 1), 0, 100);
  }

  function scenarioMaintainabilityScore(summary) {
    let score = 74;
    score += clamp(safeDiv(summary.reserveTR, Math.max(summary.trFinal, 0.1), 0), -0.05, 0.18) * 35;
    score += clamp(safeDiv(summary.reserveESP, Math.max(summary.totalEspPa, 1), 0), -0.08, 0.18) * 32;
    score -= Math.max((summary.totalEspPa || 0) - 900, 0) / 25;
    score -= Math.max((summary.specificFanPowerKWPerTR || 0) - 0.9, 0) * 18;
    if (summary.designConstraintStatus === "REJECTED") {
      score -= 25;
    }
    return clamp(roundTo(score, 1), 0, 100);
  }

  function scenarioRobustnessScore(summary) {
    let score = 52;
    score += clamp(safeDiv(summary.reserveESP, Math.max(summary.totalEspPa, 1), 0), -0.1, 0.25) * 48;
    score += clamp(safeDiv(summary.reserveTR, Math.max(summary.trFinal, 0.1), 0), -0.08, 0.20) * 38;
    score += clamp(safeDiv(summary.reserveCFM, Math.max(summary.recirculationAirflowCfm || summary.coolingAirflowCfm, 1), 0), -0.05, 0.15) * 26;
    if (summary.cleanroomMode && summary.recirculationAirflowCfm > summary.coolingAirflowCfm * 1.6) {
      score += 6;
    }
    if (summary.designConstraintStatus === "REJECTED") {
      score -= 20;
    } else if (summary.designConstraintStatus === "REVIEW") {
      score -= 8;
    }
    return clamp(roundTo(score, 1), 0, 100);
  }

  function compareAgainstBase(summary, baseSummary, costEstimate, baseCostEstimate, energyObjective, baseEnergyObjective) {
    const currentCapexInr = scenarioCapexObjective(costEstimate);
    const baseCapexInr = scenarioCapexObjective(baseCostEstimate);
    const currentAnnualEnergyCostInr = costEstimate && Number.isFinite(costEstimate.annualEnergyCostInr)
      ? roundTo(costEstimate.annualEnergyCostInr, 2)
      : null;
    const baseAnnualEnergyCostInr = baseCostEstimate && Number.isFinite(baseCostEstimate.annualEnergyCostInr)
      ? roundTo(baseCostEstimate.annualEnergyCostInr, 2)
      : null;
    const capexDeltaInr = currentCapexInr == null || baseCapexInr == null
      ? null
      : roundTo(currentCapexInr - baseCapexInr, 2);
    const annualEnergyCostDeltaInr = currentAnnualEnergyCostInr == null || baseAnnualEnergyCostInr == null
      ? null
      : roundTo(currentAnnualEnergyCostInr - baseAnnualEnergyCostInr, 2);
    const paybackYears = capexDeltaInr == null || annualEnergyCostDeltaInr == null
      ? null
      : capexDeltaInr > 0 && annualEnergyCostDeltaInr < 0
        ? roundTo(capexDeltaInr / Math.max(Math.abs(annualEnergyCostDeltaInr), 0.01), 2)
        : capexDeltaInr <= 0 && annualEnergyCostDeltaInr < 0
          ? 0
          : null;
    return {
      coolingAirflowDeltaCfm: roundTo(summary.coolingAirflowCfm - baseSummary.coolingAirflowCfm, 1),
      coolingAirflowDeltaPercent: roundTo((safeDiv(summary.coolingAirflowCfm, Math.max(baseSummary.coolingAirflowCfm, 1), 1) - 1) * 100, 1),
      recirculationAirflowDeltaCfm: roundTo(summary.recirculationAirflowCfm - baseSummary.recirculationAirflowCfm, 1),
      recirculationAirflowDeltaPercent: roundTo((safeDiv(summary.recirculationAirflowCfm, Math.max(baseSummary.recirculationAirflowCfm, 1), 1) - 1) * 100, 1),
      ventilationAirflowDeltaCfm: roundTo(summary.ventilationAirflowCfm - baseSummary.ventilationAirflowCfm, 1),
      ventilationAirflowDeltaPercent: roundTo((safeDiv(summary.ventilationAirflowCfm, Math.max(baseSummary.ventilationAirflowCfm, 1), 1) - 1) * 100, 1),
      totalRoomAirflowDeltaCfm: roundTo(summary.totalRoomAirflowCfm - baseSummary.totalRoomAirflowCfm, 1),
      totalRoomAirflowDeltaPercent: roundTo((safeDiv(summary.totalRoomAirflowCfm, Math.max(baseSummary.totalRoomAirflowCfm, 1), 1) - 1) * 100, 1),
      fanPowerDeltaKw: roundTo(summary.totalFanKW - baseSummary.totalFanKW, 3),
      fanPowerDeltaPercent: roundTo((safeDiv(summary.totalFanKW, Math.max(baseSummary.totalFanKW, 0.01), 1) - 1) * 100, 1),
      staticPressureDeltaPa: roundTo(summary.totalEspPa - baseSummary.totalEspPa, 1),
      staticPressureDeltaPercent: roundTo((safeDiv(summary.totalEspPa, Math.max(baseSummary.totalEspPa, 1), 1) - 1) * 100, 1),
      capacityDeltaTR: roundTo(summary.selectedCapacityTR - baseSummary.selectedCapacityTR, 2),
      capacityDeltaPercent: roundTo((safeDiv(summary.selectedCapacityTR, Math.max(baseSummary.selectedCapacityTR, 0.1), 1) - 1) * 100, 1),
      capexTotalInr: currentCapexInr,
      baseCapexTotalInr: baseCapexInr,
      capexDeltaInr: capexDeltaInr,
      capexDeltaPercent: currentCapexInr == null || baseCapexInr == null
        ? null
        : roundTo((safeDiv(currentCapexInr, Math.max(baseCapexInr, 0.1), 1) - 1) * 100, 1),
      energyDeltaKwh: energyObjective == null || baseEnergyObjective == null
        ? null
        : roundTo(energyObjective - baseEnergyObjective, 2),
      energyDeltaPercent: energyObjective == null || baseEnergyObjective == null
        ? null
        : roundTo((safeDiv(energyObjective, Math.max(baseEnergyObjective, 0.1), 1) - 1) * 100, 1),
      annualEnergyCostInr: currentAnnualEnergyCostInr,
      baseAnnualEnergyCostInr: baseAnnualEnergyCostInr,
      annualEnergyCostDeltaInr: annualEnergyCostDeltaInr,
      annualEnergyCostDeltaPercent: currentAnnualEnergyCostInr == null || baseAnnualEnergyCostInr == null
        ? null
        : roundTo((safeDiv(currentAnnualEnergyCostInr, Math.max(baseAnnualEnergyCostInr, 0.1), 1) - 1) * 100, 1),
      paybackYears: paybackYears,
      zoneCountDelta: (summary.zoneCount || 0) - (baseSummary.zoneCount || 0)
    };
  }

  function rejectedScenario(summary) {
    return summary.validationStatus === "NON_COMPLIANT"
      || summary.designConstraintStatus === "REJECTED"
      || !summary.psychroConverged;
  }

  function rankLowerBetter(current, values) {
    const minValue = Math.min.apply(null, values);
    const maxValue = Math.max.apply(null, values);
    if (Math.abs(maxValue - minValue) <= 0.001) {
      return 80;
    }
    return clamp(roundTo(100 - ((current - minValue) / (maxValue - minValue)) * 100, 1), 0, 100);
  }

  function evaluateScenarios(options) {
    const settings = options || {};
    const baseSummary = settings.baseSummary;
    const baseResult = settings.baseResult || {};
    const reasoning = settings.reasoning || null;
    const roomContext = settings.roomContext || {};
    const scenarioRuns = Array.isArray(settings.scenarioRuns) ? settings.scenarioRuns : [];
    const strictEnergy = settings.strictEnergy !== false;
    const baseCostEstimate = estimateScenarioCost(baseResult, baseSummary, { key: "base", title: "Base design", overrides: {} }, roomContext);
    const evaluated = scenarioRuns.map(function (run) {
      if (!run.success || !run.result) {
        return {
          scenario: run.scenario,
          rejected: true,
          rejectionReason: run.error || "Scenario simulation failed.",
          summary: null
        };
      }
      const summary = summarizeSystem(run.result, reasoning, run.scenario);
      return {
        scenario: run.scenario,
        rejected: rejectedScenario(summary),
        rejectionReason: rejectedScenario(summary)
          ? summary.validationSummary || summary.designConstraintSummary || "Scenario failed optimization constraints."
          : "",
        summary: summary,
        result: run.result,
        costEstimate: estimateScenarioCost(run.result, summary, run.scenario, roomContext)
      };
    });

    const valid = evaluated.filter(function (entry) {
      return !entry.rejected
        && entry.summary
        && scenarioEnergyObjective(entry.summary, strictEnergy) != null
        && scenarioCapexObjective(entry.costEstimate) != null;
    });
    const capexMap = {};
    const energyObjectiveMap = {};
    const baseEnergyObjective = scenarioEnergyObjective(baseSummary, strictEnergy);

    valid.forEach(function (entry) {
      capexMap[entry.scenario.key] = scenarioCapexObjective(entry.costEstimate);
      energyObjectiveMap[entry.scenario.key] = scenarioEnergyObjective(entry.summary, strictEnergy);
    });

    const capexValues = Object.keys(capexMap).map(function (key) { return capexMap[key]; });
    const energyValues = Object.keys(energyObjectiveMap).map(function (key) { return energyObjectiveMap[key]; });

    evaluated.forEach(function (entry) {
      const comparisonEnergyObjective = entry.summary ? scenarioEnergyObjective(entry.summary, strictEnergy) : null;
      entry.differences = entry.summary
        ? compareAgainstBase(
            entry.summary,
            baseSummary,
            entry.costEstimate || null,
            baseCostEstimate,
            comparisonEnergyObjective,
            baseEnergyObjective
          )
        : null;

      if (entry.rejected || !entry.summary) {
        entry.metrics = {
          capexInr: entry.costEstimate ? scenarioCapexObjective(entry.costEstimate) : null,
          annualEnergyCostInr: entry.costEstimate && Number.isFinite(entry.costEstimate.annualEnergyCostInr)
            ? entry.costEstimate.annualEnergyCostInr
            : null,
          energyObjective: null,
          complianceScore: 0,
          feasibilityScore: 0,
          robustnessScore: 0,
          comfortScore: 0,
          psychrometricScore: 0,
          constructabilityScore: 0,
          controlComplexityScore: 0,
          maintainabilityScore: 0,
          efficiencyScore: 0,
          costScore: 0,
          decisionScore: 0
        };
        return;
      }
      const capexInr = capexMap[entry.scenario.key];
      const energyObjective = energyObjectiveMap[entry.scenario.key];
      if (strictEnergy && energyObjective == null) {
        entry.rejected = true;
        entry.rejectionReason = "Scenario did not produce a real annual energy simulation result.";
        entry.metrics = {
          capexInr: capexInr,
          annualEnergyCostInr: entry.costEstimate && Number.isFinite(entry.costEstimate.annualEnergyCostInr)
            ? entry.costEstimate.annualEnergyCostInr
            : null,
          energyObjective: null,
          complianceScore: 0,
          feasibilityScore: 0,
          robustnessScore: 0,
          comfortScore: 0,
          psychrometricScore: 0,
          constructabilityScore: 0,
          controlComplexityScore: 0,
          maintainabilityScore: 0,
          efficiencyScore: 0,
          costScore: 0,
          decisionScore: 0
        };
        return;
      }
      const complianceScore = scenarioComplianceScore(entry.summary);
      const feasibilityScore = scenarioFeasibilityScore(entry.summary);
      const robustnessScore = scenarioRobustnessScore(entry.summary);
      const comfortScore = scenarioComfortScore(entry.summary);
      const psychrometricScore = scenarioPsychrometricScore(entry.summary);
      const constructabilityScore = scenarioConstructabilityScore(entry.summary);
      const controlComplexityScore = scenarioControlComplexityScore(entry.summary);
      const maintainabilityScore = scenarioMaintainabilityScore(entry.summary);
      const efficiencyScore = rankLowerBetter(energyObjective, energyValues);
      const costScore = rankLowerBetter(capexInr, capexValues);
      const decisionScore = clamp(roundTo(
        (complianceScore * 0.22)
        + (efficiencyScore * 0.18)
        + (costScore * 0.12)
        + (comfortScore * 0.10)
        + (psychrometricScore * 0.10)
        + (constructabilityScore * 0.10)
        + (controlComplexityScore * 0.08)
        + (maintainabilityScore * 0.10),
        1
      ), 0, 100);
      entry.metrics = {
        capexInr: capexInr,
        annualEnergyCostInr: entry.costEstimate && Number.isFinite(entry.costEstimate.annualEnergyCostInr)
          ? entry.costEstimate.annualEnergyCostInr
          : null,
        energyObjective: energyObjective,
        complianceScore: complianceScore,
        feasibilityScore: feasibilityScore,
        robustnessScore: robustnessScore,
        comfortScore: comfortScore,
        psychrometricScore: psychrometricScore,
        constructabilityScore: constructabilityScore,
        controlComplexityScore: controlComplexityScore,
        maintainabilityScore: maintainabilityScore,
        efficiencyScore: efficiencyScore,
        costScore: costScore,
        decisionScore: decisionScore
      };
    });

    evaluated.baseCostEstimate = baseCostEstimate;
    return evaluated;
  }

  function solutionBullets(entry) {
    const differences = entry.differences || {};
    const summary = entry.summary || {};
    const strengths = [];
    const tradeoffs = [];

    if (differences.fanPowerDeltaPercent < -1) {
      strengths.push("Cuts fan duty by " + roundTo(Math.abs(differences.fanPowerDeltaPercent), 0) + "% versus the base design.");
    }
    if (differences.staticPressureDeltaPercent < -1) {
      strengths.push("Reduces design static pressure by " + roundTo(Math.abs(differences.staticPressureDeltaPercent), 0) + "%.");
    }
    if (differences.energyDeltaPercent < -1) {
      strengths.push("Improves the energy objective by " + roundTo(Math.abs(differences.energyDeltaPercent), 0) + "%.");
    }
    if (summary.validationStatus === "COMPLIANT") {
      strengths.push("Maintains compliant airflow / psychrometric relationships.");
    }
    if (differences.capexDeltaPercent > 2) {
      tradeoffs.push("Capital cost rises by about " + roundTo(differences.capexDeltaPercent, 0) + "% (" + roundTo(Math.abs(differences.capexDeltaInr || 0), 0) + " INR).");
    }
    if ((differences.zoneCountDelta || 0) > 0) {
      tradeoffs.push("Adds " + differences.zoneCountDelta + " extra control zone(s) to the airside architecture.");
    }
    if (summary.clusterCount > 1) {
      tradeoffs.push("Requires more AHU sections or fan groups to commission and maintain.");
    }

    return {
      strengths: strengths.slice(0, 3),
      tradeoffs: tradeoffs.slice(0, 3)
    };
  }

  function buildAlternativeOption(entry) {
    const summary = entry.summary || {};
    const scenario = entry.scenario || {};
    const differences = entry.differences || {};
    const bullets = solutionBullets(entry);
    return {
      key: scenario.key,
      title: scenario.title,
      intent: scenario.intent,
      systemType: summary.architectureLabel,
      scope: scenarioNote(summary.systemRecommendation, scenario.whenToUse),
      airflowCfm: roundTo(summary.totalRoomAirflowCfm, 0),
      ach: roundTo(summary.achActual, 1),
      capexInr: differences.capexTotalInr != null ? roundTo(differences.capexTotalInr, 0) : null,
      capexDeltaInr: differences.capexDeltaInr != null ? roundTo(differences.capexDeltaInr, 0) : null,
      capexDeltaPercent: differences.capexDeltaPercent == null ? null : roundTo(differences.capexDeltaPercent || 0, 0),
      energyDeltaPercent: differences.energyDeltaPercent == null ? 0 : roundTo(differences.energyDeltaPercent || 0, 0),
      annualEnergyKwh: summary.annualEnergyKwh != null ? roundTo(summary.annualEnergyKwh, 2) : null,
      annualEnergyCostInr: differences.annualEnergyCostInr != null ? roundTo(differences.annualEnergyCostInr, 0) : null,
      annualEnergyCostDeltaInr: differences.annualEnergyCostDeltaInr != null ? roundTo(differences.annualEnergyCostDeltaInr, 0) : null,
      paybackYears: differences.paybackYears,
      costScore: roundTo(entry.metrics && entry.metrics.costScore || 0, 0),
      efficiencyScore: roundTo(entry.metrics && entry.metrics.efficiencyScore || 0, 0),
      feasibilityScore: roundTo(entry.metrics && entry.metrics.feasibilityScore || 0, 0),
      robustnessScore: roundTo(entry.metrics && entry.metrics.robustnessScore || 0, 0),
      complianceScore: roundTo(entry.metrics && entry.metrics.complianceScore || 0, 0),
      decisionScore: roundTo(entry.metrics && entry.metrics.decisionScore || 0, 1),
      complianceStatus: summary.validationStatus,
      confidenceScore: roundTo(summary.confidenceScore || 0.75, 2),
      why: scenario.why || "",
      whenToUse: scenario.whenToUse || "",
      strengths: bullets.strengths,
      tradeoffs: bullets.tradeoffs,
      actions: Array.isArray(scenario.actions) ? scenario.actions.slice(0, 3) : [],
      simulationBacked: true,
      simulatedImpacts: {
        annualEnergyDeltaKwh: differences.energyDeltaKwh,
        annualEnergyCostDeltaInr: differences.annualEnergyCostDeltaInr,
        fanEnergyDeltaPercent: roundTo(differences.fanPowerDeltaPercent || 0, 0),
        fanPowerDeltaKw: differences.fanPowerDeltaKw,
        staticPressureDeltaPercent: roundTo(differences.staticPressureDeltaPercent || 0, 0),
        staticPressureDeltaPa: differences.staticPressureDeltaPa
      },
      estimatedImpacts: {
        annualEnergyDeltaKwh: differences.energyDeltaKwh,
        annualEnergyCostDeltaInr: differences.annualEnergyCostDeltaInr,
        fanEnergyDeltaPercent: roundTo(differences.fanPowerDeltaPercent || 0, 0),
        fanPowerDeltaKw: differences.fanPowerDeltaKw,
        staticPressureDeltaPercent: roundTo(differences.staticPressureDeltaPercent || 0, 0),
        staticPressureDeltaPa: differences.staticPressureDeltaPa
      }
    };
  }

  function selectBest(entries, selector) {
    const valid = entries.filter(function (entry) {
      return !entry.rejected && entry.metrics;
    });
    if (!valid.length) {
      return null;
    }
    return valid.slice().sort(function (left, right) {
      return selector(right) - selector(left);
    })[0];
  }

  function buildFinalRecommendation(baseSummary, rankedSolutions) {
    const bestBalance = rankedSolutions.bestBalance;
    const bestEnergy = rankedSolutions.bestEnergy;
    if (!bestBalance) {
      return {
        selectedScenarioKey: null,
        title: "Keep the current base design for now",
        rationale: "All simulated alternatives were rejected by airflow, psychrometric, or design-feasibility constraints. Resolve the current blockers before applying an optimization pass.",
        recommendedUseCase: "Use the existing design as the working base until the non-compliant conditions are corrected."
      };
    }
    const energyLead = bestEnergy && bestEnergy.scenario && bestEnergy.scenario.key !== bestBalance.scenario.key
      ? " The strongest pure energy option remains " + bestEnergy.scenario.title + "."
      : "";
    const balanceComparison = bestBalance.differences || {};
    const actualEnergyText = balanceComparison.energyDeltaKwh != null
      ? " It changes annual energy by " + roundTo(balanceComparison.energyDeltaKwh, 0) + " kWh and fan power by " + roundTo(balanceComparison.fanPowerDeltaKw, 2) + " kW versus the base design."
      : " It improves the simulated airside duty with lower fan/static burden versus the base design.";
    const costText = balanceComparison.capexDeltaInr != null
      ? " Capex changes by " + roundTo(balanceComparison.capexDeltaInr, 0) + " INR" + (balanceComparison.paybackYears != null ? " with an energy-cost payback of about " + roundTo(balanceComparison.paybackYears, 1) + " years." : ".")
      : "";
    return {
      selectedScenarioKey: bestBalance.scenario.key,
      title: bestBalance.scenario.title,
      rationale: bestBalance.scenario.title + " is the best balanced recommendation because it preserves compliance while improving the real simulated system duty and engineering headroom." + actualEnergyText + costText + energyLead,
      recommendedUseCase: bestBalance.scenario.whenToUse || "Use as the recommended redesign baseline for the next iteration.",
      baseComparison: balanceComparison,
      overrides: copyJson(bestBalance.scenario.overrides || {})
    };
  }

  function buildAlternativesView(report) {
    const topSolutions = Array.isArray(report.topSolutions) ? report.topSolutions : [];
    return {
      provider: report.provider,
      service: report.service,
      model: report.model,
      summary: report.finalRecommendation && report.finalRecommendation.rationale
        ? report.finalRecommendation.rationale
        : "Optimization results are ready.",
      preferredOptionKey: report.finalRecommendation && report.finalRecommendation.selectedScenarioKey
        ? report.finalRecommendation.selectedScenarioKey
        : "",
      standardsNote: report.baseSystemSummary && report.baseSystemSummary.cleanroomMode
        ? "Optimization preserves cleanroom airflow separation so cooling, recirculation, and make-up air remain physically independent."
        : "Optimization preserves the airflow hierarchy so cooling airflow, recirculation airflow, and ventilation airflow stay separated during scenario comparison.",
      decisionFramework: {
        energyEfficiencyWeight: 0.30,
        capitalCostWeight: 0.20,
        engineeringFeasibilityWeight: 0.15,
        engineeringRobustnessWeight: 0.15,
        complianceWeight: 0.20
      },
      finalRecommendation: report.finalRecommendation,
      scenarioResults: copyJson(report.scenarioResults || []),
      baseSystemPerformance: copyJson(report.baseSystemPerformance || null),
      options: topSolutions.map(buildAlternativeOption)
    };
  }

  function buildScenarioResult(entry, baseEntry) {
    if (!(entry && entry.scenario && baseEntry && baseEntry.outputs)) {
      throw new Error("Missing simulation data for scenario result mapping.");
    }
    const scenario = entry.scenario || {};
    const outputs = entry.result ? captureSimulationOutputs(entry.result, scenario) : null;
    const comparison = entry.differences || {};
    const metrics = entry.metrics || {};
    const summary = entry.summary || {};
    const costEstimate = entry.costEstimate || null;
    return {
      name: scenario.title || summary.scenarioTitle || scenario.key || "Scenario",
      key: scenario.key || "",
      intent: scenario.intent || summary.scenarioIntent || "balanced",
      system_type: summary.architectureLabel || (scenario.architecture && scenario.architecture.label) || "",
      system_type_label: summary.architectureLabel || (scenario.architecture && scenario.architecture.label) || "",
      input_mutation: copyJson(scenario.overrides || {}),
      airflow: {
        cooling: outputs ? outputs.coolingAirflowCfm : null,
        recirculation: outputs ? outputs.recirculationAirflowCfm : null,
        ventilation: outputs ? outputs.ventilationAirflowCfm : null,
        total: outputs ? outputs.totalRoomAirflowCfm : null
      },
      return_air: {
        to_coil: outputs ? outputs.returnAir.toCoilCfm : null,
        bypass_recirculation: outputs ? outputs.returnAir.bypassRecirculationCfm : null,
        ventilation_path: outputs ? outputs.returnAir.ventilationPathCfm : null,
        total_room_return: outputs ? outputs.returnAir.totalRoomReturnCfm : null
      },
      performance: {
        fan_power: outputs ? outputs.fanPowerKw.total : null,
        fan_power_cooling: outputs ? outputs.fanPowerKw.cooling : null,
        fan_power_recirculation: outputs ? outputs.fanPowerKw.recirculation : null,
        fan_power_ventilation: outputs ? outputs.fanPowerKw.ventilation : null,
        cooling_tr: outputs ? outputs.equipmentSizing.trCoolingCoil : null,
        energy_annual: outputs ? outputs.energy.annualKwh : null,
        energy_cost_annual: costEstimate && Number.isFinite(costEstimate.annualEnergyCostInr)
          ? costEstimate.annualEnergyCostInr
          : outputs ? outputs.energy.annualCost : null,
        esp: outputs ? outputs.staticPressure.totalPa : null,
        esp_duct: outputs ? outputs.staticPressure.ductPa : null,
        esp_fittings: outputs ? outputs.staticPressure.fittingPa : null,
        esp_equipment: outputs ? outputs.staticPressure.equipmentPa : null
      },
      cost: {
        capex_total: costEstimate && Number.isFinite(costEstimate.totalCapexInr) ? costEstimate.totalCapexInr : null,
        capex_difference: comparison.capexDeltaInr != null ? comparison.capexDeltaInr : null,
        capex_percentage: comparison.capexDeltaPercent != null ? comparison.capexDeltaPercent : null,
        energy_cost_annual: costEstimate && Number.isFinite(costEstimate.annualEnergyCostInr) ? costEstimate.annualEnergyCostInr : null,
        energy_cost_difference: comparison.annualEnergyCostDeltaInr != null ? comparison.annualEnergyCostDeltaInr : null,
        payback_years: comparison.paybackYears != null ? comparison.paybackYears : null,
        boq_items: costEstimate ? copyJson(costEstimate.items || []) : [],
        boq_component_totals: costEstimate ? copyJson(costEstimate.componentTotals || {}) : {}
      },
      delta: {
        energy_diff: comparison.energyDeltaKwh != null ? comparison.energyDeltaKwh : null,
        energy_diff_percent: comparison.energyDeltaPercent != null ? comparison.energyDeltaPercent : null,
        fan_power_diff: comparison.fanPowerDeltaKw != null ? comparison.fanPowerDeltaKw : null,
        fan_power_diff_percent: comparison.fanPowerDeltaPercent != null ? comparison.fanPowerDeltaPercent : null,
        capex_diff: comparison.capexDeltaInr != null ? comparison.capexDeltaInr : null,
        capex_diff_percent: comparison.capexDeltaPercent != null ? comparison.capexDeltaPercent : null,
        energy_cost_diff: comparison.annualEnergyCostDeltaInr != null ? comparison.annualEnergyCostDeltaInr : null,
        energy_cost_diff_percent: comparison.annualEnergyCostDeltaPercent != null ? comparison.annualEnergyCostDeltaPercent : null,
        payback_years: comparison.paybackYears != null ? comparison.paybackYears : null,
        esp_diff: comparison.staticPressureDeltaPa != null ? comparison.staticPressureDeltaPa : null
      },
      compliance: {
        ach: outputs ? outputs.compliance.achActual : null,
        ach_required: outputs ? outputs.compliance.achRequired : null,
        status: outputs ? outputs.compliance.status : (entry.rejected ? "REJECTED" : ""),
        airflow_valid: outputs ? outputs.compliance.airflowHierarchyValid : null,
        psychro_converged: outputs ? outputs.compliance.psychroConverged : null,
        equipment_valid: outputs ? outputs.compliance.equipmentValid : null
      },
      score: {
        cost: metrics.costScore != null ? metrics.costScore : null,
        efficiency: metrics.efficiencyScore != null ? metrics.efficiencyScore : null,
        robustness: metrics.robustnessScore != null ? metrics.robustnessScore : null,
        overall: metrics.decisionScore != null ? metrics.decisionScore : null,
        compliance: metrics.complianceScore != null ? metrics.complianceScore : null,
        feasibility: metrics.feasibilityScore != null ? metrics.feasibilityScore : null,
        components: {
          compliance: metrics.complianceScore != null ? metrics.complianceScore : null,
          energy: metrics.efficiencyScore != null ? metrics.efficiencyScore : null,
          capex: metrics.costScore != null ? metrics.costScore : null,
          comfort: metrics.comfortScore != null ? metrics.comfortScore : null,
          psychrometric: metrics.psychrometricScore != null ? metrics.psychrometricScore : null,
          constructability: metrics.constructabilityScore != null ? metrics.constructabilityScore : null,
          controlComplexity: metrics.controlComplexityScore != null ? metrics.controlComplexityScore : null,
          maintainability: metrics.maintainabilityScore != null ? metrics.maintainabilityScore : null
        }
      },
      comparison_vs_base: copyJson(comparison),
      cost_estimate: costEstimate ? copyJson(costEstimate) : null,
      recalculated_outputs: copyJson(outputs),
      rejected: !!entry.rejected,
      rejection_reason: entry.rejectionReason || "",
      simulationBacked: !!(entry.result || entry.rejected)
    };
  }

  function buildComparisonMatrix(baseEntry, evaluatedEntries) {
    const validEntries = (Array.isArray(evaluatedEntries) ? evaluatedEntries : []).filter(function (entry) {
      return entry && !entry.rejected && entry.summary && entry.metrics;
    });
    const baseSummary = baseEntry && baseEntry.summary ? baseEntry.summary : null;
    const rows = [];

    if (baseSummary) {
      validEntries.forEach(function (entry) {
        rows.push({
          left: "base",
          right: entry.scenario.key,
          annualEnergyDeltaKwh: entry.metrics.energyObjective != null && baseSummary.annualEnergyKwh != null
            ? roundTo(entry.metrics.energyObjective - baseSummary.annualEnergyKwh, 2)
            : null,
          annualEnergyCostDeltaInr: entry.differences && entry.differences.annualEnergyCostDeltaInr != null
            ? roundTo(entry.differences.annualEnergyCostDeltaInr, 2)
            : null,
          fanPowerDeltaKw: roundTo(entry.summary.totalFanKW - baseSummary.totalFanKW, 3),
          staticPressureDeltaPa: roundTo(entry.summary.totalEspPa - baseSummary.totalEspPa, 1),
          capexDeltaInr: entry.differences && entry.differences.capexDeltaInr != null
            ? roundTo(entry.differences.capexDeltaInr, 2)
            : null,
          capexDeltaPercent: entry.differences && entry.differences.capexDeltaPercent != null
            ? roundTo(entry.differences.capexDeltaPercent, 1)
            : null,
          paybackYears: entry.differences && entry.differences.paybackYears != null
            ? roundTo(entry.differences.paybackYears, 2)
            : null,
          decisionScoreDelta: roundTo(entry.metrics.decisionScore, 1)
        });
      });
    }

    validEntries.forEach(function (leftEntry, leftIndex) {
      validEntries.slice(leftIndex + 1).forEach(function (rightEntry) {
        rows.push({
          left: leftEntry.scenario.key,
          right: rightEntry.scenario.key,
          annualEnergyDeltaKwh: leftEntry.metrics.energyObjective != null && rightEntry.metrics.energyObjective != null
            ? roundTo(leftEntry.metrics.energyObjective - rightEntry.metrics.energyObjective, 2)
            : null,
          annualEnergyCostDeltaInr: leftEntry.metrics.annualEnergyCostInr != null && rightEntry.metrics.annualEnergyCostInr != null
            ? roundTo(leftEntry.metrics.annualEnergyCostInr - rightEntry.metrics.annualEnergyCostInr, 2)
            : null,
          fanPowerDeltaKw: roundTo(leftEntry.summary.totalFanKW - rightEntry.summary.totalFanKW, 3),
          staticPressureDeltaPa: roundTo(leftEntry.summary.totalEspPa - rightEntry.summary.totalEspPa, 1),
          capexDeltaInr: leftEntry.metrics.capexInr != null && rightEntry.metrics.capexInr != null
            ? roundTo(leftEntry.metrics.capexInr - rightEntry.metrics.capexInr, 2)
            : null,
          capexDeltaPercent: leftEntry.metrics.capexInr != null && rightEntry.metrics.capexInr != null
            ? roundTo((safeDiv(leftEntry.metrics.capexInr, Math.max(rightEntry.metrics.capexInr, 0.1), 1) - 1) * 100, 1)
            : null,
          decisionScoreDelta: roundTo(leftEntry.metrics.decisionScore - rightEntry.metrics.decisionScore, 1)
        });
      });
    });

    return rows;
  }

  function uniqueScenarioDefinitions(definitions) {
    const seen = {};
    return (Array.isArray(definitions) ? definitions : []).filter(function (scenario) {
      const key = scenario && scenario.key ? scenario.key : "";
      if (!key || seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
  }

  function mergeScenarioOverrideBranch(baseValue, patchValue) {
    if (Array.isArray(patchValue)) {
      return copyJson(patchValue);
    }
    if (patchValue && typeof patchValue === "object") {
      const next = Object.assign({}, baseValue && typeof baseValue === "object" ? baseValue : {});
      Object.keys(patchValue).forEach(function (key) {
        next[key] = mergeScenarioOverrideBranch(next[key], patchValue[key]);
      });
      return next;
    }
    return patchValue;
  }

  function mergeScenarioOverrides(baseOverrides, patchOverrides) {
    return mergeScenarioOverrideBranch(baseOverrides || {}, patchOverrides || {});
  }

  function refinementVariant(seedScenario, suffix, titleSuffix, patchOverrides, noteSuffix) {
    const baseScenario = copyJson(seedScenario || {});
    return {
      key: (baseScenario.key || "scenario") + "_" + suffix,
      title: (baseScenario.title || "Scenario") + " " + titleSuffix,
      intent: baseScenario.intent || "balanced",
      architecture: copyJson(baseScenario.architecture || {}),
      why: scenarioNote(baseScenario.why, "Refined scenario") + " " + noteSuffix,
      whenToUse: baseScenario.whenToUse || "",
      tradeoffs: Array.isArray(baseScenario.tradeoffs) ? baseScenario.tradeoffs.slice(0, 3) : [],
      actions: Array.isArray(baseScenario.actions) ? baseScenario.actions.slice(0, 3) : [],
      overrides: mergeScenarioOverrides(baseScenario.overrides || {}, patchOverrides || {})
    };
  }

  function buildRefinementScenarios(seedEntries, baseSummary) {
    const seeds = Array.isArray(seedEntries) ? seedEntries.filter(Boolean) : [];
    const zoneFloor = Math.max(baseSummary && baseSummary.zoneCount || 1, 1);
    const refinementScenarios = [];

    seeds.forEach(function (entry) {
      const scenario = entry && entry.scenario ? entry.scenario : entry;
      if (!(scenario && scenario.key)) {
        return;
      }
      refinementScenarios.push(refinementVariant(
        scenario,
        "tight_static",
        "Tight Static",
        {
          pressureAdjustments: {
            ductFrictionFactor: clamp(finiteOr(scenario.overrides && scenario.overrides.pressureAdjustments && scenario.overrides.pressureAdjustments.ductFrictionFactor, 1) - 0.05, 0.65, 1.05),
            fittingLossFactor: clamp(finiteOr(scenario.overrides && scenario.overrides.pressureAdjustments && scenario.overrides.pressureAdjustments.fittingLossFactor, 1) - 0.05, 0.65, 1.05),
            equipmentLossFactor: clamp(finiteOr(scenario.overrides && scenario.overrides.pressureAdjustments && scenario.overrides.pressureAdjustments.equipmentLossFactor, 1) - 0.03, 0.75, 1.05)
          }
        },
        "This refinement pass tightens the static-pressure targets after the first simulation sweep."
      ));
      refinementScenarios.push(refinementVariant(
        scenario,
        "trimmed_reserve",
        "Trimmed Reserve",
        {
          equipmentSizing: {
            reserveMarginDelta: clamp(finiteOr(scenario.overrides && scenario.overrides.equipmentSizing && scenario.overrides.equipmentSizing.reserveMarginDelta, 0) - 0.01, -0.05, 0.03)
          },
          airflowStrategy: {
            roomDeltaTDeltaC: clamp(finiteOr(scenario.overrides && scenario.overrides.airflowStrategy && scenario.overrides.airflowStrategy.roomDeltaTDeltaC, 0) + 0.15, -0.2, 1.2)
          }
        },
        "This refinement pass trims reserve while rebalancing airflow delta-T to avoid over-selection."
      ));
      refinementScenarios.push(refinementVariant(
        scenario,
        "zoned_balance",
        "Zoned Balance",
        {
          zoning: {
            forceMinZones: Math.max(
              zoneFloor,
              finiteOr(scenario.overrides && scenario.overrides.zoning && scenario.overrides.zoning.forceMinZones, zoneFloor)
                + ((baseSummary && baseSummary.totalEspPa || 0) > 700 ? 1 : 0)
            )
          },
          airflowStrategy: {
            forceDedicatedVentilation: !!(scenario.overrides && scenario.overrides.airflowStrategy && scenario.overrides.airflowStrategy.forceDedicatedVentilation)
              || (baseSummary && baseSummary.ventilationAirflowCfm > baseSummary.coolingAirflowCfm * 0.18)
          }
        },
        "This refinement pass rechecks zoning and ventilation separation around the strongest first-pass concept."
      ));
    });

    return uniqueScenarioDefinitions(refinementScenarios);
  }

  async function runOptimizationLoop(options) {
    const settings = options || {};
    const callbacks = settings.callbacks || {};
    const baseState = getBaseSystemState({
      baseInputs: settings.baseInputs,
      baseResult: settings.baseResult,
      roomContext: settings.roomContext,
      reasoning: settings.reasoning
    });
    const scenarioDefinitions = Array.isArray(settings.scenarios) && settings.scenarios.length
      ? copyJson(settings.scenarios)
      : generateScenarios({
          baseResult: baseState.baseResult,
          reasoning: baseState.reasoning
        });
    const baseEntry = await runBaseSystemSimulation(baseState, callbacks);
    const mutatedStates = scenarioDefinitions.map(function (scenario) {
      return applyScenario(baseState, scenario);
    });
    const scenarioRuns = [];

    for (const systemState of mutatedStates) {
      try {
        const run = await runFullSimulation(systemState, callbacks);
        scenarioRuns.push(run);
      } catch (error) {
        scenarioRuns.push({
          scenario: copyJson(systemState.scenario || {}),
          success: false,
          error: error && error.message ? error.message : "Scenario simulation failed."
        });
      }
    }

    let evaluated = evaluateScenarios({
      baseResult: baseEntry.result,
      baseSummary: baseEntry.summary,
      reasoning: baseState.reasoning,
      roomContext: baseState.roomContext,
      scenarioRuns: scenarioRuns,
      strictEnergy: true
    });
    const firstPassEvaluated = evaluated.slice();
    const firstPassBest = selectBest(firstPassEvaluated, function (entry) {
      return entry.metrics && entry.metrics.decisionScore || 0;
    });
    const refinementSeeds = uniqueByKey([firstPassBest, selectBest(firstPassEvaluated, function (entry) {
      return entry.metrics && entry.metrics.efficiencyScore || 0;
    }), selectBest(firstPassEvaluated, function (entry) {
      return entry.metrics && entry.metrics.costScore || 0;
    })].filter(Boolean).map(function (entry) {
      return {
        key: entry.scenario.key,
        entry: entry
      };
    })).map(function (item) {
      return item.entry;
    });
    const refinementScenarios = settings.maxPasses === 1
      ? []
      : buildRefinementScenarios(refinementSeeds, baseEntry.summary);

    if (refinementScenarios.length) {
      const refinementStates = refinementScenarios.map(function (scenario) {
        return applyScenario(baseState, scenario);
      });
      for (const systemState of refinementStates) {
        try {
          const run = await runFullSimulation(systemState, callbacks);
          scenarioRuns.push(run);
        } catch (error) {
          scenarioRuns.push({
            scenario: copyJson(systemState.scenario || {}),
            success: false,
            error: error && error.message ? error.message : "Scenario simulation failed."
          });
        }
      }
      evaluated = evaluateScenarios({
        baseResult: baseEntry.result,
        baseSummary: baseEntry.summary,
        reasoning: baseState.reasoning,
        roomContext: baseState.roomContext,
        scenarioRuns: scenarioRuns,
        strictEnergy: true
      });
    }
    const baseCostEstimate = evaluated.baseCostEstimate || estimateScenarioCost(baseEntry.result, baseEntry.summary, { key: "base", title: "Base design", overrides: {} }, baseState.roomContext);
    const bestEnergy = selectBest(evaluated, function (entry) {
      return entry.metrics && entry.metrics.efficiencyScore || 0;
    });
    const bestCost = selectBest(evaluated, function (entry) {
      return entry.metrics && entry.metrics.costScore || 0;
    });
    const bestBalance = selectBest(evaluated, function (entry) {
      return entry.metrics && entry.metrics.decisionScore || 0;
    });
    const rankedSolutions = {
      bestEnergy: bestEnergy,
      bestCost: bestCost,
      bestBalance: bestBalance
    };
    const scenarioResults = evaluated.map(function (entry) {
      return buildScenarioResult(entry, baseEntry);
    });
    const validScenarioResults = scenarioResults.filter(function (entry) {
      return entry && !entry.rejected;
    });
    const rejectedScenarioResults = scenarioResults.filter(function (entry) {
      return entry && entry.rejected;
    });
    const nextFeasibleMoves = validScenarioResults.length ? [] : summarizeProblemList(baseState.baseResult, baseState.reasoning).slice(0, 3).map(function (issue) {
      return {
        blocker: issue.problem || issue.key || "Validation blocker",
        remedy: issue.recommendation || "Resolve the critical validation blocker, then rerun optimization.",
        scenarioFamilies: ["mandatory_ach_recirculation", "ventilation_recovery_doas", "doas_recirculation", "low_static_airside"]
      };
    });
    const topSolutions = uniqueByKey([bestBalance, bestEnergy, bestCost].filter(Boolean).map(function (entry) {
      return {
        key: entry.scenario.key,
        entry: entry
      };
    })).map(function (item) {
      return item.entry;
    });
    const finalRecommendation = buildFinalRecommendation(baseEntry.summary, rankedSolutions);
    const report = {
      provider: "local_optimization",
      service: "optimization_engine",
      model: "closed_loop_design_optimizer",
      mode: "simulated",
      baseStateSnapshot: copyJson(baseState.snapshot),
	      baseEnergySimulation: copyJson(baseEntry.result && (baseEntry.result.finalEnergyResult || baseEntry.result.energySimulation) ? (baseEntry.result.finalEnergyResult || baseEntry.result.energySimulation) : null),
      baseSystemPerformance: Object.assign({}, copyJson(baseEntry.outputs), {
        cost: copyJson(baseCostEstimate)
      }),
      baseSystemSummary: {
        architecture: baseEntry.summary.architectureLabel,
        areaM2: roundTo(baseEntry.summary.areaM2, 2),
        volumeM3: roundTo(baseEntry.summary.volumeM3, 2),
        trFinal: roundTo(baseEntry.summary.trFinal, 2),
        trCoolingCoil: roundTo(baseEntry.summary.trCoolingCoil, 2),
        trVentilation: roundTo(baseEntry.summary.trVentilation, 2),
        coolingAirflowCfm: roundTo(baseEntry.summary.coolingAirflowCfm, 0),
        recirculationAirflowCfm: roundTo(baseEntry.summary.recirculationAirflowCfm, 0),
        ventilationAirflowCfm: roundTo(baseEntry.summary.ventilationAirflowCfm, 0),
        totalRoomAirflowCfm: roundTo(baseEntry.summary.totalRoomAirflowCfm, 0),
        returnAirToCoilCfm: roundTo(baseEntry.summary.returnAirToCoilCfm || baseEntry.outputs.returnAir.toCoilCfm || 0, 0),
        returnAirBypassCfm: roundTo(baseEntry.summary.returnAirBypassCfm || baseEntry.outputs.returnAir.bypassRecirculationCfm || 0, 0),
        returnAirVentilationPathCfm: roundTo(baseEntry.summary.returnAirVentilationPathCfm || baseEntry.outputs.returnAir.ventilationPathCfm || 0, 0),
        totalFanKW: roundTo(baseEntry.summary.totalFanKW, 2),
        totalEspPa: roundTo(baseEntry.summary.totalEspPa, 0),
        annualEnergyKwh: baseEntry.outputs.energy.annualKwh,
        energyCost: baseCostEstimate && Number.isFinite(baseCostEstimate.annualEnergyCostInr)
          ? baseCostEstimate.annualEnergyCostInr
          : baseEntry.outputs.energy.annualCost,
        capexTotalInr: baseCostEstimate && Number.isFinite(baseCostEstimate.totalCapexInr) ? baseCostEstimate.totalCapexInr : null,
        boqComponentTotals: baseCostEstimate ? copyJson(baseCostEstimate.componentTotals || {}) : {},
        zoneCount: baseEntry.summary.zoneCount,
        validationStatus: baseEntry.summary.validationStatus,
        cleanroomMode: baseEntry.summary.cleanroomMode,
        cleanroomLabel: baseEntry.summary.cleanroomLabel
      },
      identifiedInefficiencies: summarizeProblemList(baseState.baseResult, baseState.reasoning),
      scenarioList: scenarioDefinitions.map(function (scenario) {
        return {
          key: scenario.key,
          title: scenario.title,
          intent: scenario.intent,
          architecture: scenario.architecture && scenario.architecture.label ? scenario.architecture.label : "",
          inputModifications: copyJson(scenario.overrides || {}),
          why: scenario.why || "",
          tradeoffs: Array.isArray(scenario.tradeoffs) ? scenario.tradeoffs.slice(0, 3) : []
        };
      }).concat(refinementScenarios.map(function (scenario) {
        return {
          key: scenario.key,
          title: scenario.title,
          intent: scenario.intent,
          architecture: scenario.architecture && scenario.architecture.label ? scenario.architecture.label : "",
          inputModifications: copyJson(scenario.overrides || {}),
          why: scenario.why || "",
          tradeoffs: Array.isArray(scenario.tradeoffs) ? scenario.tradeoffs.slice(0, 3) : [],
          refinementPass: true
        };
      })),
      scenarioResults: copyJson(scenarioResults),
      validScenarioResults: copyJson(validScenarioResults),
      rejectedScenarioResults: copyJson(rejectedScenarioResults),
      optimizationValidityStatus: validScenarioResults.length ? "COMPLIANT" : "NON_COMPLIANT",
      optimizationValiditySummary: validScenarioResults.length
        ? validScenarioResults.length + " compliant scenario(s) qualified for ranking."
        : "All simulated scenarios were rejected; rankings and best recommendations are suppressed until validation blockers are resolved.",
      nextFeasibleMoves: nextFeasibleMoves,
      simulationResults: evaluated.map(function (entry) {
        return {
          key: entry.scenario && entry.scenario.key ? entry.scenario.key : "",
          title: entry.scenario && entry.scenario.title ? entry.scenario.title : "",
          rejected: !!entry.rejected,
          rejectionReason: entry.rejectionReason || "",
          inputModifications: copyJson(entry.scenario && entry.scenario.overrides || {}),
          fullSimulationOutputs: entry.summary ? copyJson(captureSimulationOutputs(entry.result, entry.scenario)) : null,
          costEstimate: copyJson(entry.costEstimate || null),
          comparisonVsBase: copyJson(entry.differences || {}),
          scores: copyJson(entry.metrics || {})
        };
      }),
      comparisonMatrix: buildComparisonMatrix(baseEntry, evaluated),
      rankedRecommendations: {
        bestEnergy: bestEnergy ? { key: bestEnergy.scenario.key, title: bestEnergy.scenario.title, score: roundTo(bestEnergy.metrics.efficiencyScore, 1) } : null,
        bestCost: bestCost ? { key: bestCost.scenario.key, title: bestCost.scenario.title, score: roundTo(bestCost.metrics.costScore, 1) } : null,
        bestBalanced: bestBalance ? { key: bestBalance.scenario.key, title: bestBalance.scenario.title, score: roundTo(bestBalance.metrics.decisionScore, 1) } : null
      },
      rankedSolutions: {
        bestEnergy: bestEnergy ? { key: bestEnergy.scenario.key, title: bestEnergy.scenario.title, score: roundTo(bestEnergy.metrics.efficiencyScore, 1) } : null,
        bestCost: bestCost ? { key: bestCost.scenario.key, title: bestCost.scenario.title, score: roundTo(bestCost.metrics.costScore, 1) } : null,
        bestBalance: bestBalance ? { key: bestBalance.scenario.key, title: bestBalance.scenario.title, score: roundTo(bestBalance.metrics.decisionScore, 1) } : null
      },
      topSolutions: topSolutions.map(function (entry) {
        return {
          key: entry.scenario.key,
          title: entry.scenario.title,
          intent: entry.scenario.intent,
          architecture: entry.summary.architectureLabel,
          modifiedConfiguration: copyJson(entry.scenario.overrides || {}),
          updatedAirflowBreakdown: {
            coolingAirflowCfm: roundTo(entry.summary.coolingAirflowCfm, 0),
            recirculationAirflowCfm: roundTo(entry.summary.recirculationAirflowCfm, 0),
            ventilationAirflowCfm: roundTo(entry.summary.ventilationAirflowCfm, 0),
            totalRoomAirflowCfm: roundTo(entry.summary.totalRoomAirflowCfm, 0),
            returnAirToCoilCfm: roundTo(entry.summary.returnAirToCoilCfm || 0, 0),
            recirculationBypassCfm: roundTo(entry.summary.returnAirBypassCfm || 0, 0),
            ventilationReturnPathCfm: roundTo(entry.summary.returnAirVentilationPathCfm || 0, 0)
          },
          updatedFanEnergy: {
            coolingFanKW: roundTo(entry.summary.coolingFanKW, 2),
            recirculationFanKW: roundTo(entry.summary.recirculationFanKW, 2),
            ventilationFanKW: roundTo(entry.summary.ventilationFanKW, 2),
            totalFanKW: roundTo(entry.summary.totalFanKW, 2)
          },
          annualEnergyKwh: roundTo(entry.summary.annualEnergyKwh || 0, 2),
          annualEnergyCost: entry.costEstimate && Number.isFinite(entry.costEstimate.annualEnergyCostInr)
            ? roundTo(entry.costEstimate.annualEnergyCostInr, 2)
	            : (entry.result && (entry.result.finalEnergyResult || entry.result.energySimulation) ? roundTo((entry.result.finalEnergyResult || entry.result.energySimulation).energy_cost || 0, 2) : null),
          capexTotalInr: entry.costEstimate && Number.isFinite(entry.costEstimate.totalCapexInr) ? roundTo(entry.costEstimate.totalCapexInr, 2) : null,
          paybackYears: entry.differences && entry.differences.paybackYears != null ? roundTo(entry.differences.paybackYears, 2) : null,
          systemArchitecture: entry.summary.architectureLabel,
          comparisonVsOriginal: copyJson(entry.differences || {}),
          scores: {
            efficiency: roundTo(entry.metrics.efficiencyScore, 1),
            cost: roundTo(entry.metrics.costScore, 1),
            feasibility: roundTo(entry.metrics.feasibilityScore, 1),
            robustness: roundTo(entry.metrics.robustnessScore, 1),
            compliance: roundTo(entry.metrics.complianceScore, 1),
            comfort: roundTo(entry.metrics.comfortScore, 1),
            psychrometric: roundTo(entry.metrics.psychrometricScore, 1),
            constructability: roundTo(entry.metrics.constructabilityScore, 1),
            controlComplexity: roundTo(entry.metrics.controlComplexityScore, 1),
            maintainability: roundTo(entry.metrics.maintainabilityScore, 1),
            decision: roundTo(entry.metrics.decisionScore, 1)
          },
          rationale: scenarioNote(entry.scenario.why, entry.summary.systemRecommendation),
          tradeoffs: solutionBullets(entry).tradeoffs
        };
      }),
      finalRecommendation: finalRecommendation,
      feedbackLoop: {
        canRerun: !!(finalRecommendation && finalRecommendation.selectedScenarioKey),
        recommendedBaseScenarioKey: finalRecommendation.selectedScenarioKey,
        recommendedBaseOverrides: copyJson(finalRecommendation.overrides || {})
      },
      optimizationTrace: {
        passes: refinementScenarios.length ? 2 : 1,
        firstPassScenarioKeys: scenarioDefinitions.map(function (scenario) { return scenario.key; }),
        refinementScenarioKeys: refinementScenarios.map(function (scenario) { return scenario.key; }),
        firstPassBestScenarioKey: firstPassBest && firstPassBest.scenario ? firstPassBest.scenario.key : null,
        firstPassRejectedCount: firstPassEvaluated.filter(function (entry) { return entry.rejected; }).length
      },
      debugTrace: {
        scenarioInputs: scenarioDefinitions.map(function (scenario) {
          return {
            key: scenario.key,
            title: scenario.title,
            overrides: copyJson(scenario.overrides || {})
          };
        }),
        scenarioOutputs: copyJson(scenarioResults),
        finalPayload: {
          scenarioCount: scenarioDefinitions.length,
          scenarioResultCount: scenarioResults.length,
          selectedScenarioKey: finalRecommendation.selectedScenarioKey || null
        }
      }
    };
    report.alternativesView = buildAlternativesView(report);
    report.alternativesView.options = report.alternativesView.options.map(function (option) {
      return Object.assign({}, option, { simulationBacked: true });
    });
    return report;
  }

  function optimizeDesign(options) {
    const settings = options || {};
    const seededBaseResult = settings.seedScenario && typeof settings.simulateScenario === "function"
      ? settings.simulateScenario(copyJson(settings.seedScenario))
      : null;
    const baseResult = seededBaseResult || settings.baseResult || {};
    const reasoning = settings.reasoning || baseResult.designAdvisor || null;
    const baseSummary = summarizeSystem(baseResult, reasoning, null);
    const inefficiencies = summarizeProblemList(baseResult, reasoning);
    const scenarios = generateScenarios({
      baseResult: baseResult,
      reasoning: reasoning
    });
    const scenarioRuns = runScenarios({
      scenarios: scenarios,
      simulateScenario: settings.simulateScenario
    });
    const evaluated = evaluateScenarios({
      baseResult: baseResult,
      baseSummary: baseSummary,
      reasoning: reasoning,
      roomContext: settings.roomContext || {},
      scenarioRuns: scenarioRuns,
      strictEnergy: false
    });
    const bestEnergy = selectBest(evaluated, function (entry) {
      return entry.metrics && entry.metrics.efficiencyScore || 0;
    });
    const bestCost = selectBest(evaluated, function (entry) {
      return entry.metrics && entry.metrics.costScore || 0;
    });
    const bestBalance = selectBest(evaluated, function (entry) {
      return entry.metrics && entry.metrics.decisionScore || 0;
    });
    const rankedSolutions = {
      bestEnergy: bestEnergy,
      bestCost: bestCost,
      bestBalance: bestBalance
    };
    const baseEntry = {
      result: baseResult,
      summary: baseSummary,
      outputs: captureSimulationOutputs(baseResult, { key: "base", title: "Base design" })
    };
    const baseCostEstimate = evaluated.baseCostEstimate || estimateScenarioCost(baseResult, baseSummary, { key: "base", title: "Base design", overrides: {} }, settings.roomContext || {});
    const scenarioResults = evaluated.map(function (entry) {
      return buildScenarioResult(entry, baseEntry);
    });
    const topSolutions = uniqueByKey([bestBalance, bestEnergy, bestCost].filter(Boolean).map(function (entry) {
      return {
        key: entry.scenario.key,
        entry: entry
      };
    })).map(function (item) {
      return item.entry;
    });
    const finalRecommendation = buildFinalRecommendation(baseSummary, rankedSolutions);
    const report = {
      provider: "local_optimization",
      service: "optimization_engine",
      model: "closed_loop_design_optimizer",
      baseSystemSummary: {
        architecture: baseSummary.architectureLabel,
        areaM2: roundTo(baseSummary.areaM2, 2),
        volumeM3: roundTo(baseSummary.volumeM3, 2),
        trFinal: roundTo(baseSummary.trFinal, 2),
        trCoolingCoil: roundTo(baseSummary.trCoolingCoil, 2),
        trVentilation: roundTo(baseSummary.trVentilation, 2),
        coolingAirflowCfm: roundTo(baseSummary.coolingAirflowCfm, 0),
        recirculationAirflowCfm: roundTo(baseSummary.recirculationAirflowCfm, 0),
        ventilationAirflowCfm: roundTo(baseSummary.ventilationAirflowCfm, 0),
        totalRoomAirflowCfm: roundTo(baseSummary.totalRoomAirflowCfm, 0),
        returnAirToCoilCfm: roundTo(baseSummary.returnAirToCoilCfm || baseEntry.outputs.returnAir.toCoilCfm || 0, 0),
        returnAirBypassCfm: roundTo(baseSummary.returnAirBypassCfm || baseEntry.outputs.returnAir.bypassRecirculationCfm || 0, 0),
        returnAirVentilationPathCfm: roundTo(baseSummary.returnAirVentilationPathCfm || baseEntry.outputs.returnAir.ventilationPathCfm || 0, 0),
        totalFanKW: roundTo(baseSummary.totalFanKW, 2),
        totalEspPa: roundTo(baseSummary.totalEspPa, 0),
        annualEnergyKwh: baseEntry.outputs.energy.annualKwh,
        energyCost: baseCostEstimate && Number.isFinite(baseCostEstimate.annualEnergyCostInr)
          ? baseCostEstimate.annualEnergyCostInr
          : baseEntry.outputs.energy.annualCost,
        capexTotalInr: baseCostEstimate && Number.isFinite(baseCostEstimate.totalCapexInr) ? baseCostEstimate.totalCapexInr : null,
        boqComponentTotals: baseCostEstimate ? copyJson(baseCostEstimate.componentTotals || {}) : {},
        zoneCount: baseSummary.zoneCount,
        validationStatus: baseSummary.validationStatus,
        cleanroomMode: baseSummary.cleanroomMode,
        cleanroomLabel: baseSummary.cleanroomLabel
      },
      identifiedInefficiencies: inefficiencies,
      generatedScenarios: scenarios.map(function (scenario) {
        return {
          key: scenario.key,
          title: scenario.title,
          intent: scenario.intent,
          architecture: scenario.architecture && scenario.architecture.label ? scenario.architecture.label : "",
          why: scenario.why || "",
          overrides: copyJson(scenario.overrides || {})
        };
      }),
      scenarioResults: copyJson(scenarioResults),
      simulationResults: evaluated.map(function (entry) {
        return {
          key: entry.scenario && entry.scenario.key ? entry.scenario.key : "",
          title: entry.scenario && entry.scenario.title ? entry.scenario.title : "",
          rejected: !!entry.rejected,
          rejectionReason: entry.rejectionReason || "",
          metrics: copyJson(entry.metrics || {}),
          costEstimate: copyJson(entry.costEstimate || null),
          differencesFromBase: copyJson(entry.differences || {}),
          systemSummary: entry.summary ? {
            architecture: entry.summary.architectureLabel,
            trFinal: roundTo(entry.summary.trFinal, 2),
            coolingAirflowCfm: roundTo(entry.summary.coolingAirflowCfm, 0),
            recirculationAirflowCfm: roundTo(entry.summary.recirculationAirflowCfm, 0),
            ventilationAirflowCfm: roundTo(entry.summary.ventilationAirflowCfm, 0),
            totalFanKW: roundTo(entry.summary.totalFanKW, 2),
            totalEspPa: roundTo(entry.summary.totalEspPa, 0),
            zoneCount: entry.summary.zoneCount,
            validationStatus: entry.summary.validationStatus
          } : null
        };
      }),
      rankedSolutions: {
        bestEnergy: bestEnergy ? {
          key: bestEnergy.scenario.key,
          title: bestEnergy.scenario.title,
          score: roundTo(bestEnergy.metrics.efficiencyScore, 1)
        } : null,
        bestCost: bestCost ? {
          key: bestCost.scenario.key,
          title: bestCost.scenario.title,
          score: roundTo(bestCost.metrics.costScore, 1)
        } : null,
        bestBalance: bestBalance ? {
          key: bestBalance.scenario.key,
          title: bestBalance.scenario.title,
          score: roundTo(bestBalance.metrics.decisionScore, 1)
        } : null
      },
      topSolutions: topSolutions.map(function (entry) {
        return {
          key: entry.scenario.key,
          title: entry.scenario.title,
          intent: entry.scenario.intent,
          architecture: entry.summary.architectureLabel,
          modifiedConfiguration: copyJson(entry.scenario.overrides || {}),
          updatedAirflowBreakdown: {
            coolingAirflowCfm: roundTo(entry.summary.coolingAirflowCfm, 0),
            recirculationAirflowCfm: roundTo(entry.summary.recirculationAirflowCfm, 0),
            ventilationAirflowCfm: roundTo(entry.summary.ventilationAirflowCfm, 0),
            totalRoomAirflowCfm: roundTo(entry.summary.totalRoomAirflowCfm, 0),
            returnAirToCoilCfm: roundTo(entry.summary.returnAirToCoilCfm || 0, 0),
            recirculationBypassCfm: roundTo(entry.summary.returnAirBypassCfm || 0, 0),
            ventilationReturnPathCfm: roundTo(entry.summary.returnAirVentilationPathCfm || 0, 0)
          },
          updatedFanEnergy: {
            coolingFanKW: roundTo(entry.summary.coolingFanKW, 2),
            recirculationFanKW: roundTo(entry.summary.recirculationFanKW, 2),
            ventilationFanKW: roundTo(entry.summary.ventilationFanKW, 2),
            totalFanKW: roundTo(entry.summary.totalFanKW, 2)
          },
          annualEnergyKwh: roundTo(entry.summary.annualEnergyKwh || 0, 2),
          annualEnergyCost: entry.costEstimate && Number.isFinite(entry.costEstimate.annualEnergyCostInr)
            ? roundTo(entry.costEstimate.annualEnergyCostInr, 2)
            : null,
          capexTotalInr: entry.costEstimate && Number.isFinite(entry.costEstimate.totalCapexInr)
            ? roundTo(entry.costEstimate.totalCapexInr, 2)
            : null,
          paybackYears: entry.differences && entry.differences.paybackYears != null
            ? roundTo(entry.differences.paybackYears, 2)
            : null,
          systemArchitecture: entry.summary.architectureLabel,
          comparisonVsOriginal: copyJson(entry.differences || {}),
          scores: {
            efficiency: roundTo(entry.metrics.efficiencyScore, 1),
            cost: roundTo(entry.metrics.costScore, 1),
            feasibility: roundTo(entry.metrics.feasibilityScore, 1),
            robustness: roundTo(entry.metrics.robustnessScore, 1),
            compliance: roundTo(entry.metrics.complianceScore, 1),
            comfort: roundTo(entry.metrics.comfortScore, 1),
            psychrometric: roundTo(entry.metrics.psychrometricScore, 1),
            constructability: roundTo(entry.metrics.constructabilityScore, 1),
            controlComplexity: roundTo(entry.metrics.controlComplexityScore, 1),
            maintainability: roundTo(entry.metrics.maintainabilityScore, 1),
            decision: roundTo(entry.metrics.decisionScore, 1)
          },
          rationale: scenarioNote(entry.scenario.why, entry.summary.systemRecommendation),
          tradeoffs: solutionBullets(entry).tradeoffs
        };
      }),
      finalRecommendation: finalRecommendation,
      feedbackLoop: {
        canRerun: !!(finalRecommendation && finalRecommendation.selectedScenarioKey),
        recommendedBaseScenarioKey: finalRecommendation.selectedScenarioKey,
        recommendedBaseOverrides: copyJson(finalRecommendation.overrides || {})
      }
    };
    report.alternativesView = buildAlternativesView(report);
    return report;
  }

  function rerunFromRecommendation(options) {
    const settings = options || {};
    const report = settings.report || {};
    const scenarioKey = settings.scenarioKey
      || report.feedbackLoop && report.feedbackLoop.recommendedBaseScenarioKey
      || report.finalRecommendation && report.finalRecommendation.selectedScenarioKey;
    const scenario = (report.generatedScenarios || []).find(function (entry) {
      return entry.key === scenarioKey;
    });
    if (!scenario) {
      throw new Error("Requested optimization scenario is not available for rerun.");
    }
    return optimizeDesign({
      baseResult: settings.baseResult,
      reasoning: settings.reasoning,
      simulateScenario: settings.simulateScenario,
      seedScenario: scenario
    });
  }

  const ScenarioGenerator = {
    generate: generateScenarios
  };

  const SystemStateService = {
    getBaseSystemState: getBaseSystemState,
    get_base_system_state: getBaseSystemState
  };

  const ScenarioMutationService = {
    applyScenario: applyScenario,
    apply_scenario: applyScenario
  };

  const SimulationRunner = {
    runScenarios: runScenarios,
    summarizeSystem: summarizeSystem,
    captureSimulationOutputs: captureSimulationOutputs,
    runFullSimulation: runFullSimulation,
    run_full_simulation: runFullSimulation
  };

  const EvaluationEngine = {
    evaluateScenarios: evaluateScenarios,
    buildAlternativeOption: buildAlternativeOption
  };

  const ResultEvaluator = EvaluationEngine;

  const CostModelService = {
    resolveCostContext: resolveCostContext,
    estimateScenarioCost: estimateScenarioCost
  };

  const OptimizationController = {
    optimizeDesign: optimizeDesign,
    optimizeDesignAsync: runOptimizationLoop,
    runOptimizationLoop: runOptimizationLoop,
    rerunFromRecommendation: rerunFromRecommendation
  };

  return {
    SystemStateService: SystemStateService,
    ScenarioGenerator: ScenarioGenerator,
    ScenarioMutationService: ScenarioMutationService,
    SimulationRunner: SimulationRunner,
    EvaluationEngine: EvaluationEngine,
    ResultEvaluator: ResultEvaluator,
    CostModelService: CostModelService,
    OptimizationController: OptimizationController,
    getBaseSystemState: getBaseSystemState,
    get_base_system_state: getBaseSystemState,
    applyScenario: applyScenario,
    apply_scenario: applyScenario,
    runFullSimulation: runFullSimulation,
    run_full_simulation: runFullSimulation,
    estimateScenarioCost: estimateScenarioCost,
    optimizeDesign: optimizeDesign,
    optimizeDesignAsync: runOptimizationLoop,
    runOptimizationLoop: runOptimizationLoop,
    rerunFromRecommendation: rerunFromRecommendation
  };
}));
