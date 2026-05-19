const test = require("node:test");
const assert = require("node:assert/strict");

const optimization = require("../optimizationEngine.js");

function buildBaseResult(overrides) {
  const base = {
    area: 160,
    volume: 480,
    tr_final: 12.0,
    tr_cooling_coil: 11.2,
    tr_ventilation: 0.8,
    total_esp: 920,
    duct_friction: 320,
    fitting_loss: 180,
    equipment_loss: 420,
    cooling_fan_kw: 5.6,
    recirculation_fan_kw: 5.6,
    ventilation_fan_kw: 0.9,
    cfm_cooling_coil: 4200,
    cfm_conditioned: 4200,
    ventilation_airflow_cfm: 900,
    cfm_final: 5100,
    fresh_total_cfm: 900,
    ach: 7.5,
    ach_required: 6,
    autoZoning: {
      zoneCount: 1
    },
    zoneAhuStrategy: {
      clusters: [
        { name: "AHU-1" }
      ],
      aggregateSelection: {
        ahu: {
          capacityTR: 13.0,
          reserveTR: 1.1,
          reserveCFM: 420,
          reserveESP: 85
        }
      }
    },
    equipmentSelection: {
      ahu: {
        capacityTR: 13.0,
        reserveTR: 1.1,
        reserveCFM: 420,
        reserveESP: 85
      }
    },
    validation: {
      status: "COMPLIANT",
      summary: "Base design is compliant.",
      confidenceScore: 0.9,
      findings: []
    },
    designConstraints: {
      status: "APPROVED",
      summary: "Base constraints approved."
    },
    energyOptimization: {
      specificFanPowerKWPerTR: 1.22,
      installedMotorSpecificFanPowerKWPerTR: 1.28
    },
    systemRecommendation: {
      primarySystem: "Single AHU",
      reasoning: "Single AHU is carrying the current room."
    },
    standardsContext: {
      ventilation: {
        minimumOutdoorAirCfm: 750,
        designOutdoorAirCfm: 900
      }
    },
    psychro: {
      converged: true
    },
    cleanroom: null
  };
  return Object.assign({}, base, overrides || {});
}

test("Scenario generator adds cleanroom-specific optimizer concepts", function () {
  const baseResult = buildBaseResult({
    tr_final: 8.4,
    tr_cooling_coil: 6.6,
    total_esp: 840,
    cooling_fan_kw: 2.4,
    recirculation_fan_kw: 7.8,
    ventilation_fan_kw: 0.9,
    cfm_cooling_coil: 2400,
    cfm_conditioned: 7600,
    ventilation_airflow_cfm: 500,
    cfm_final: 8100,
    fresh_total_cfm: 500,
    ach: 35.9,
    ach_required: 30,
    autoZoning: { zoneCount: 2 },
    zoneAhuStrategy: {
      clusters: [{ name: "CR-1" }, { name: "CR-2" }],
      aggregateSelection: {
        ahu: {
          capacityTR: 10.5,
          reserveTR: 1.0,
          reserveCFM: 500,
          reserveESP: 120
        }
      }
    },
    validation: {
      status: "REVIEW",
      summary: "Recirculation fan energy dominates the cleanroom architecture.",
      confidenceScore: 0.88,
      findings: [{ severity: "warning", code: "recirc_fan_high", title: "Recirculation fan burden is high." }]
    },
    designConstraints: {
      status: "REVIEW",
      summary: "Static pressure remains high."
    },
    energyOptimization: {
      specificFanPowerKWPerTR: 1.34
    },
    systemRecommendation: {
      primarySystem: "Dedicated MAU + recirculation AHU",
      reasoning: "Cleanroom recirculation is much larger than cooling airflow."
    },
    cleanroom: {
      classLabel: "ISO 7",
      designAch: 45
    }
  });

  const scenarios = optimization.ScenarioGenerator.generate({
    baseResult: baseResult,
    reasoning: {
      rootCauseAnalysis: [
        {
          key: "fan_energy",
          category: "energy",
          severity: "warning",
          problem: "Recirculation fan energy dominates."
        }
      ]
    }
  });

  const keys = scenarios.map(function (scenario) { return scenario.key; });
  assert.ok(keys.includes("ffu_fan_array"));
  assert.ok(keys.includes("doas_recirculation"));
  assert.ok(keys.includes("low_static_airside"));
});

test("Optimization controller ranks valid scenarios and rejects invalid ones", function () {
  const baseResult = buildBaseResult();
  const scenarioResults = {
    low_static_airside: buildBaseResult({
      total_esp: 660,
      duct_friction: 220,
      fitting_loss: 120,
      equipment_loss: 320,
      cooling_fan_kw: 3.9,
      recirculation_fan_kw: 3.9,
      ventilation_fan_kw: 0.7,
      energyOptimization: {
        specificFanPowerKWPerTR: 0.86,
        installedMotorSpecificFanPowerKWPerTR: 0.92
      },
      validation: {
        status: "COMPLIANT",
        summary: "Low-static concept is compliant.",
        confidenceScore: 0.92,
        findings: []
      }
    }),
    multi_ahu_split: buildBaseResult({
      total_esp: 720,
      cooling_fan_kw: 4.2,
      recirculation_fan_kw: 4.4,
      ventilation_fan_kw: 0.7,
      autoZoning: { zoneCount: 2 },
      zoneAhuStrategy: {
        clusters: [{ name: "AHU-1" }, { name: "AHU-2" }],
        aggregateSelection: {
          ahu: {
            capacityTR: 13.4,
            reserveTR: 1.3,
            reserveCFM: 520,
            reserveESP: 140
          }
        }
      },
      energyOptimization: {
        specificFanPowerKWPerTR: 0.95,
        installedMotorSpecificFanPowerKWPerTR: 1.01
      },
      validation: {
        status: "COMPLIANT",
        summary: "Split-system concept is compliant.",
        confidenceScore: 0.9,
        findings: []
      }
    }),
    doas_recirculation: buildBaseResult({
      validation: {
        status: "NON_COMPLIANT",
        summary: "Outdoor-air split did not satisfy a constraint.",
        confidenceScore: 0.81,
        findings: [{ severity: "critical", code: "ventilation_shortfall", title: "Ventilation shortfall" }]
      },
      designConstraints: {
        status: "REJECTED",
        summary: "Scenario rejected by design constraints."
      }
    }),
    cost_optimized_minimal: buildBaseResult({
      total_esp: 810,
      cooling_fan_kw: 4.8,
      recirculation_fan_kw: 4.9,
      ventilation_fan_kw: 0.8,
      energyOptimization: {
        specificFanPowerKWPerTR: 1.05,
        installedMotorSpecificFanPowerKWPerTR: 1.11
      },
      zoneAhuStrategy: {
        clusters: [{ name: "AHU-1" }],
        aggregateSelection: {
          ahu: {
            capacityTR: 12.4,
            reserveTR: 0.8,
            reserveCFM: 260,
            reserveESP: 45
          }
        }
      },
      equipmentSelection: {
        ahu: {
          capacityTR: 12.4,
          reserveTR: 0.8,
          reserveCFM: 260,
          reserveESP: 45
        }
      }
    })
  };

  const report = optimization.optimizeDesign({
    baseResult: baseResult,
    reasoning: {
      rootCauseAnalysis: [
        {
          key: "fan_power",
          category: "energy",
          severity: "warning",
          problem: "Fan power is high because static pressure is elevated."
        },
        {
          key: "distribution",
          category: "distribution",
          severity: "advisory",
          problem: "Single-zone layout is stretching the airside path."
        }
      ]
    },
    simulateScenario: function (scenario) {
      return scenarioResults[scenario.key] || baseResult;
    }
  });

  assert.equal(report.rankedSolutions.bestEnergy.key, "low_static_airside");
  assert.ok(report.rankedSolutions.bestCost && report.rankedSolutions.bestCost.key);
  assert.equal(report.finalRecommendation.selectedScenarioKey, "low_static_airside");
  assert.ok(report.scenarioResults.some(function (entry) {
    return entry.key === "low_static_airside"
      && entry.performance
      && entry.performance.esp === 660
      && entry.return_air
      && entry.return_air.to_coil === entry.airflow.cooling
      && entry.cost
      && entry.cost.capex_total != null
      && entry.delta
      && entry.delta.capex_diff != null;
  }));
  assert.ok(report.simulationResults.some(function (entry) {
    return entry.key === "doas_recirculation" && entry.rejected === true;
  }));
  assert.ok(report.topSolutions.length >= 1);
  assert.equal(report.alternativesView.provider, "local_optimization");
});

test("Scenario cost model uses rectangular duct perimeter for duct surface area", function () {
  const result = buildBaseResult({
    zoneDuctPlan: {
      zones: [
        {
          ductLengthFt: 100,
          supply: {
            trunkDuct: { rectW: 24, rectH: 12, dia_in: 19 },
            trunkCount: 1
          },
          return: {
            trunkDuct: { rectW: 20, rectH: 10, dia_in: 16 },
            trunkCount: 1
          },
          process: {
            trunkDuct: { rectW: 12, rectH: 8, dia_in: 11 },
            trunkCount: 1,
            distributed: false
          }
        }
      ]
    },
    diffuserLayout: {
      diffuserCount: 4,
      returns: { count: 2 }
    },
    cfm_process_excess: 200
  });

  const cost = optimization.estimateScenarioCost(result, {
    selectedCapacityTR: 12,
    trVentilation: 0,
    totalFanKW: 5,
    clusterCount: 1,
    zoneCount: 1
  }, {
    key: "rectangular_duct_cost"
  }, {
    rates: {
      rate_duct: 100,
      rate_insul: 0,
      rate_tr: 0,
      rate_diffuser: 0,
      rate_return: 0,
      rate_fan: 0,
      rate_pipe: 0,
      rate_bms: 0,
      rate_install: 0
    }
  });

  const routeLengthM = 100 * 0.3048;
  const expectedArea = (
    (2 * ((24 + 12) * 0.0254) * routeLengthM)
    + (2 * ((20 + 10) * 0.0254) * routeLengthM)
    + (2 * ((12 + 8) * 0.0254) * routeLengthM)
  ) * 1.18;

  assert.equal(cost.ductAreaM2, Number(expectedArea.toFixed(2)));
});

test("System state snapshot and scenario mutation keep resimulation inputs isolated", function () {
  const baseResult = buildBaseResult({
    inputs: {
      len: "10",
      wid: "8",
      ht: "3",
      design_mode: "comfort"
    }
  });

  const baseState = optimization.getBaseSystemState({
    baseInputs: baseResult.inputs,
    baseResult: baseResult,
    roomContext: {
      room: { id: "room-1", name: "Test Room" }
    }
  });
  const scenario = optimization.applyScenario(baseState, {
    key: "low_static_airside",
    title: "Reduced static pressure configuration",
    overrides: {
      pressureAdjustments: {
        ductFrictionFactor: 0.82
      }
    }
  });

  assert.equal(baseState.snapshot.roomData.inputs.len, "10");
  assert.equal(baseState.snapshot.airflowBreakdown.coolingAirflowCfm, 4200);
  assert.equal(scenario.runtimeOptions.optimizationScenario.key, "low_static_airside");
  assert.equal(scenario.runtimeOptions.skipAiEnhancements, true);
  assert.equal(scenario.mutatedInputs.len, "10");
  assert.equal(baseState.baseInputs.len, "10");
});

test("Async optimization loop reruns scenario calculations and captures real energy outputs", async function () {
  const baseInputs = {
    len: "10",
    wid: "8",
    ht: "3",
    design_mode: "comfort"
  };
  const baseResult = buildBaseResult({
    inputs: baseInputs
  });
  const scenarioResults = {
    low_static_airside: buildBaseResult({
      inputs: baseInputs,
      total_esp: 660,
      duct_friction: 220,
      fitting_loss: 120,
      equipment_loss: 320,
      cooling_fan_kw: 3.9,
      recirculation_fan_kw: 3.9,
      ventilation_fan_kw: 0.7,
      energyOptimization: {
        specificFanPowerKWPerTR: 0.86,
        installedMotorSpecificFanPowerKWPerTR: 0.92
      }
    }),
    multi_ahu_split: buildBaseResult({
      inputs: baseInputs,
      total_esp: 720,
      cooling_fan_kw: 4.2,
      recirculation_fan_kw: 4.4,
      ventilation_fan_kw: 0.7,
      autoZoning: { zoneCount: 2 },
      zoneAhuStrategy: {
        clusters: [{ name: "AHU-1" }, { name: "AHU-2" }],
        aggregateSelection: {
          ahu: {
            capacityTR: 13.4,
            reserveTR: 1.3,
            reserveCFM: 520,
            reserveESP: 140
          }
        }
      },
      energyOptimization: {
        specificFanPowerKWPerTR: 0.95,
        installedMotorSpecificFanPowerKWPerTR: 1.01
      }
    }),
    doas_recirculation: buildBaseResult({
      inputs: baseInputs,
      validation: {
        status: "NON_COMPLIANT",
        summary: "Outdoor-air split did not satisfy a constraint.",
        confidenceScore: 0.81,
        findings: [{ severity: "critical", code: "ventilation_shortfall", title: "Ventilation shortfall" }]
      },
      designConstraints: {
        status: "REJECTED",
        summary: "Scenario rejected by design constraints."
      }
    }),
    cost_optimized_minimal: buildBaseResult({
      inputs: baseInputs,
      total_esp: 810,
      cooling_fan_kw: 4.8,
      recirculation_fan_kw: 4.9,
      ventilation_fan_kw: 0.8,
      energyOptimization: {
        specificFanPowerKWPerTR: 1.05,
        installedMotorSpecificFanPowerKWPerTR: 1.11
      }
    })
  };
  const energyReports = {
    base: {
      annual_energy_kwh: 54000,
      cooling_energy: 36000,
      fan_energy: 12000,
      process_energy: 6000,
      energy_cost: 486000,
      peak_power_kw: 28.5
    },
    low_static_airside: {
      annual_energy_kwh: 46500,
      cooling_energy: 33200,
      fan_energy: 9300,
      process_energy: 4000,
      energy_cost: 418500,
      peak_power_kw: 24.7
    },
    multi_ahu_split: {
      annual_energy_kwh: 48900,
      cooling_energy: 34100,
      fan_energy: 10300,
      process_energy: 4500,
      energy_cost: 440100,
      peak_power_kw: 25.8
    },
    doas_recirculation: {
      annual_energy_kwh: 52000,
      cooling_energy: 35000,
      fan_energy: 11000,
      process_energy: 6000,
      energy_cost: 468000,
      peak_power_kw: 27.4
    },
    cost_optimized_minimal: {
      annual_energy_kwh: 50500,
      cooling_energy: 34700,
      fan_energy: 10800,
      process_energy: 5000,
      energy_cost: 454500,
      peak_power_kw: 26.8
    }
  };
  let calculationCalls = 0;
  let energyCalls = 0;

  const report = await optimization.runOptimizationLoop({
    baseInputs: baseInputs,
    baseResult: baseResult,
    roomContext: {
      room: { id: "room-1", name: "Room 1" }
    },
    callbacks: {
      calculateRoom: function (simulatedInputs, runtimeOptions) {
        calculationCalls += 1;
        const scenarioKey = runtimeOptions && runtimeOptions.optimizationScenario && runtimeOptions.optimizationScenario.key;
        return scenarioResults[scenarioKey];
      },
      simulateEnergy: function (simulatedResult, roomContext, systemState) {
        energyCalls += 1;
        const key = systemState && systemState.scenario && systemState.scenario.key
          ? systemState.scenario.key
          : "base";
        return energyReports[key];
      }
    }
  });

  assert.equal(report.mode, "simulated");
  assert.equal(report.baseSystemPerformance.energy.annualKwh, 54000);
  assert.equal(report.baseSystemSummary.returnAirToCoilCfm, report.baseSystemSummary.coolingAirflowCfm);
  assert.ok(report.baseSystemSummary.capexTotalInr > 0);
  assert.equal(report.rankedSolutions.bestEnergy.key, "low_static_airside");
  assert.equal(report.finalRecommendation.selectedScenarioKey, "low_static_airside");
  assert.ok(report.scenarioResults.some(function (entry) {
    return entry.key === "low_static_airside"
      && entry.performance
      && entry.performance.energy_annual === 46500
      && entry.performance.energy_cost_annual === 418500
      && entry.return_air
      && entry.return_air.to_coil === entry.airflow.cooling
      && entry.cost
      && entry.cost.capex_total != null
      && entry.delta
      && entry.delta.energy_diff === -7500
      && entry.delta.energy_cost_diff != null;
  }));
  assert.ok(report.scenarioResults.some(function (entry) {
    return entry.key === "doas_recirculation"
      && entry.rejected === true
      && entry.compliance
      && entry.compliance.status === "NON_COMPLIANT";
  }));
  assert.ok(report.simulationResults.some(function (entry) {
    return entry.key === "low_static_airside"
      && entry.fullSimulationOutputs
      && entry.fullSimulationOutputs.energy.annualKwh === 46500;
  }));
  assert.ok(report.comparisonMatrix.some(function (entry) {
    return entry.left === "base" && entry.right === "low_static_airside" && entry.annualEnergyDeltaKwh === -7500;
  }));
  assert.ok(report.alternativesView.options.every(function (option) {
    return option.simulationBacked === true;
  }));
  assert.equal(calculationCalls, report.scenarioList.length);
  assert.equal(energyCalls, report.scenarioList.length + 1);
});

test("Async optimization loop adds a refinement pass around the strongest first-pass concept", async function () {
  const baseResult = buildBaseResult({
    total_esp: 900,
    duct_friction: 320,
    fitting_loss: 180,
    equipment_loss: 400,
    cooling_fan_kw: 5.4,
    recirculation_fan_kw: 5.4,
    ventilation_fan_kw: 0.8,
    energySimulation: {
      annual_energy_kwh: 62000,
      energy_cost: 558000
    }
  });

  function simulatedResultFor(runtimeOptions) {
    const scenario = runtimeOptions && runtimeOptions.optimizationScenario ? runtimeOptions.optimizationScenario : null;
    if (!scenario) {
      return baseResult;
    }
    const overrides = scenario.overrides || {};
    const pressure = overrides.pressureAdjustments || {};
    const airflow = overrides.airflowStrategy || {};
    const equipment = overrides.equipmentSizing || {};
    const zoning = overrides.zoning || {};
    const ductFactor = pressure.ductFrictionFactor == null ? 1 : pressure.ductFrictionFactor;
    const fittingFactor = pressure.fittingLossFactor == null ? 1 : pressure.fittingLossFactor;
    const equipmentFactor = pressure.equipmentLossFactor == null ? 1 : pressure.equipmentLossFactor;
    const reserveMarginDelta = equipment.reserveMarginDelta || 0;
    const zoneCount = Math.max(zoning.forceMinZones || 1, 1);
    const totalEsp = Math.round((320 * ductFactor) + (180 * fittingFactor) + (400 * equipmentFactor));
    const fanScale = Math.max(totalEsp / 900, 0.72);
    const annualEnergy = Math.round(62000 * (fanScale * 0.85 + 0.15) - (reserveMarginDelta < 0 ? Math.abs(reserveMarginDelta) * 9000 : 0) - ((airflow.roomDeltaTDeltaC || 0) * 1200));

    return buildBaseResult({
      total_esp: totalEsp,
      duct_friction: Math.round(320 * ductFactor),
      fitting_loss: Math.round(180 * fittingFactor),
      equipment_loss: Math.round(400 * equipmentFactor),
      cooling_fan_kw: Number((5.4 * fanScale).toFixed(2)),
      recirculation_fan_kw: Number((5.1 * fanScale).toFixed(2)),
      ventilation_fan_kw: 0.8,
      autoZoning: { zoneCount: zoneCount },
      zoneAhuStrategy: {
        clusters: Array.from({ length: zoneCount }, function (_, index) { return { name: "AHU-" + (index + 1) }; }),
        aggregateSelection: {
          ahu: {
            capacityTR: Number((12.8 + Math.max(reserveMarginDelta, -0.03) * 8).toFixed(1)),
            reserveTR: Number((1.0 + reserveMarginDelta * 8).toFixed(2)),
            reserveCFM: 420,
            reserveESP: Math.max(40, 140 - (900 - totalEsp))
          }
        }
      },
      equipmentSelection: {
        ahu: {
          capacityTR: Number((12.8 + Math.max(reserveMarginDelta, -0.03) * 8).toFixed(1)),
          reserveTR: Number((1.0 + reserveMarginDelta * 8).toFixed(2)),
          reserveCFM: 420,
          reserveESP: Math.max(40, 140 - (900 - totalEsp))
        }
      },
      energySimulation: {
        annual_energy_kwh: annualEnergy,
        energy_cost: annualEnergy * 9
      },
      energyOptimization: {
        specificFanPowerKWPerTR: Number((1.2 * fanScale).toFixed(2)),
        installedMotorSpecificFanPowerKWPerTR: Number((1.28 * fanScale).toFixed(2))
      },
      validation: {
        status: "COMPLIANT",
        summary: "Scenario is compliant.",
        confidenceScore: 0.91,
        findings: []
      },
      designConstraints: {
        status: "APPROVED",
        summary: "Scenario approved."
      }
    });
  }

  const report = await optimization.runOptimizationLoop({
    baseInputs: {
      len: "14",
      wid: "11",
      ht: "3.2"
    },
    baseResult: baseResult,
    roomContext: {
      room: { id: "room-refined", name: "Refined room" }
    },
    callbacks: {
      calculateRoom: function (simulatedInputs, runtimeOptions) {
        return simulatedResultFor(runtimeOptions);
      },
      simulateEnergy: function (simulatedResult) {
        return simulatedResult.energySimulation;
      }
    }
  });

  assert.equal(report.optimizationTrace.passes, 2);
  assert.ok(report.optimizationTrace.refinementScenarioKeys.length > 0);
  assert.ok(report.scenarioResults.some(function (entry) {
    return /_(tight_static|trimmed_reserve|zoned_balance)$/.test(entry.key);
  }));
  assert.ok(report.topSolutions.some(function (entry) {
    return /_(tight_static|trimmed_reserve|zoned_balance)$/.test(entry.key);
  }));
});

test("Async optimization suppresses rankings when every scenario is rejected", async function () {
  const baseResult = buildBaseResult({
    energySimulation: {
      annual_energy_kwh: 62000,
      energy_cost: 558000
    }
  });
  const scenarios = [
    { key: "bad_energy", title: "Bad energy concept", intent: "efficient", overrides: {} },
    { key: "bad_cost", title: "Bad cost concept", intent: "balanced", overrides: {} }
  ];

  const report = await optimization.runOptimizationLoop({
    baseInputs: {
      len: "14",
      wid: "11",
      ht: "3.2"
    },
    baseResult: baseResult,
    scenarios: scenarios,
    maxPasses: 1,
    roomContext: {
      room: { id: "room-rejected", name: "Rejected room" }
    },
    callbacks: {
      calculateRoom: function (simulatedInputs, runtimeOptions) {
        const key = runtimeOptions.optimizationScenario.key;
        return buildBaseResult({
          validation: {
            status: "NON_COMPLIANT",
            summary: key + " failed airflow validation.",
            confidenceScore: 0.91,
            findings: [{ severity: "critical", code: "airflow_invalid", title: "Airflow invalid." }]
          },
          designConstraints: {
            status: "REJECTED",
            summary: key + " violates design constraints."
          },
          psychro: {
            converged: false
          },
          energySimulation: {
            annual_energy_kwh: 70000,
            energy_cost: 630000
          }
        });
      },
      simulateEnergy: function (simulatedResult) {
        return simulatedResult.energySimulation;
      }
    }
  });

  assert.equal(report.optimizationValidityStatus, "NON_COMPLIANT");
  assert.equal(report.validScenarioResults.length, 0);
  assert.equal(report.rejectedScenarioResults.length, 2);
  assert.equal(report.rankedSolutions.bestEnergy, null);
  assert.equal(report.rankedSolutions.bestCost, null);
  assert.equal(report.rankedSolutions.bestBalance, null);
  assert.equal(report.rankedRecommendations.bestEnergy, null);
  assert.equal(report.rankedRecommendations.bestCost, null);
  assert.equal(report.rankedRecommendations.bestBalanced, null);
  assert.equal(report.finalRecommendation.selectedScenarioKey, null);
  assert.equal(report.alternativesView.preferredOptionKey, "");
  assert.deepEqual(report.alternativesView.options, []);
  assert.ok(report.scenarioResults.every(function (entry) {
    return entry.rejected === true
      && entry.score.overall === 0
      && entry.score.efficiency === 0
      && entry.score.cost === 0;
  }));
});

test("Optimization does not reject comfort scenarios solely due to advisory ACH", async function () {
  const baseResult = buildBaseResult({
    complianceMode: "comfort_ventilation",
    achRequirementMode: "advisory",
    ach: 2.5,
    ach_required: 6,
    energySimulation: {
      annual_energy_kwh: 52000,
      energy_cost: 468000
    }
  });
  const report = await optimization.runOptimizationLoop({
    baseInputs: { len: "14", wid: "11", ht: "3.2", ach_requirement_mode: "advisory" },
    baseResult: baseResult,
    scenarios: [{ key: "comfort_advisory", title: "Comfort advisory ACH scenario", intent: "balanced", overrides: {} }],
    maxPasses: 1,
    roomContext: { room: { id: "room-comfort", name: "Comfort room" } },
    callbacks: {
      calculateRoom: function () {
        return buildBaseResult({
          complianceMode: "comfort_ventilation",
          achRequirementMode: "advisory",
          ach: 2.4,
          ach_required: 6,
          validation: {
            status: "COMPLIANT",
            summary: "Comfort ventilation compliant; ACH is advisory.",
            confidenceScore: 0.9,
            findings: [{ severity: "advisory", code: "ach_advisory_shortfall", title: "ACH advisory shortfall." }]
          },
          energySimulation: {
            annual_energy_kwh: 50000,
            energy_cost: 450000
          }
        });
      },
      simulateEnergy: function (simulatedResult) {
        return simulatedResult.energySimulation;
      }
    }
  });
  assert.equal(report.validScenarioResults.length, 1);
  assert.equal(report.scenarioResults[0].rejected, false);
  assert.equal(report.rankedSolutions.bestBalance.key, "comfort_advisory");
  assert.ok(report.rankedSolutions.bestBalance.score != null);
  assert.ok(Number.isFinite(report.scenarioResults[0].score.components.compliance));
  assert.ok(Number.isFinite(report.scenarioResults[0].score.components.comfort));
  assert.ok(Number.isFinite(report.scenarioResults[0].score.components.psychrometric));
  assert.ok(Number.isFinite(report.scenarioResults[0].score.components.constructability));
  assert.ok(Number.isFinite(report.scenarioResults[0].score.components.controlComplexity));
  assert.ok(Number.isFinite(report.scenarioResults[0].score.components.maintainability));
  assert.ok(Number.isFinite(report.topSolutions[0].scores.comfort));
  assert.ok(Number.isFinite(report.topSolutions[0].scores.constructability));
});
