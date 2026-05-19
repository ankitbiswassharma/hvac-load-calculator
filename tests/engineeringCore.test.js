const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../engineeringCore.js");

test("SHR consistency solver keeps load SHR and psychrometric SHR aligned", function () {
  const pressurePa = core.pressureAtElevation(216);
  const roomTempC = 24;
  const roomHumidityRatio = core.humidityRatioAt(roomTempC, 50, pressurePa);
  const roomEnthalpy = core.moistAirEnthalpy(roomTempC, roomHumidityRatio);
  const mixedAirTempC = 30;
  const mixedAirHumidityRatio = core.humidityRatioAt(30, 60, pressurePa);
  const mixedAirEnthalpy = core.moistAirEnthalpy(mixedAirTempC, mixedAirHumidityRatio);
  const supplyMassFlowDa = (2200 * core.CFM_TO_M3S) / core.moistAirSpecificVolume(roomTempC, roomHumidityRatio, pressurePa);

  const solution = core.solveRoomPsychrometrics({
    roomTempC: roomTempC,
    roomHumidityRatio: roomHumidityRatio,
    roomEnthalpy: roomEnthalpy,
    roomSensibleW: 8400,
    roomTotalW: 10500,
    supplyMassFlowDa: supplyMassFlowDa,
    pressurePa: pressurePa,
    mixedAirTempC: mixedAirTempC,
    mixedAirHumidityRatio: mixedAirHumidityRatio,
    mixedAirEnthalpy: mixedAirEnthalpy,
    initialSupplyTempC: 14
  });

  assert.equal(solution.converged, true);
  assert.ok(Math.abs(solution.roomShrLoad - solution.roomShrPsychro) <= 0.02);
  assert.ok(solution.enthalpyBalanceErrorKJkg <= 0.5);
});

test("High latent load case triggers latent-control reasoning", function () {
  const validation = core.buildDesignValidation({
    roomShrLoad: 0.64,
    roomShrPsychro: 0.65,
    enthalpyBalanceErrorKJkg: 0.08,
    achActual: 6.5,
    achRequired: 6.0,
    ventilationProvidedCfm: 450,
    ventilationRequiredCfm: 400,
    selectedTR: 8.2,
    trFinal: 7.8,
    totalEspPa: 620,
    supplyTempC: 11.3,
    spaceSensibleW: 6400,
    spaceLatentW: 3600,
    infiltrationAch: 0.35,
    assumptions: ["Unit test latent case"]
  });

  const advisor = core.buildReasoningAdvisor({
    validation: validation,
    areaM2: 85,
    trFinal: 7.8,
    zoneCount: 2,
    totalEspPa: 620,
    latentLoadRatio: 0.36,
    ventilationFraction: 0.28,
    processRatio: 0
  });

  assert.ok(advisor.items.some(function (item) {
    return /doas|lower adp|deeper cooling coil/i.test((item.recommendation || "") + " " + (item.title || ""));
  }));
});

test("Low ventilation case is marked non-compliant", function () {
  const validation = core.buildDesignValidation({
    roomShrLoad: 0.78,
    roomShrPsychro: 0.79,
    enthalpyBalanceErrorKJkg: 0.12,
    achActual: 4.2,
    achRequired: 4.0,
    ventilationProvidedCfm: 180,
    ventilationRequiredCfm: 320,
    selectedTR: 5.5,
    trFinal: 5.2,
    totalEspPa: 540,
    supplyTempC: 12.4,
    spaceSensibleW: 5400,
    spaceLatentW: 1500,
    infiltrationAch: 0.28,
    assumptions: ["Unit test ventilation shortfall"]
  });

  assert.equal(validation.status, "NON_COMPLIANT");
  assert.ok(validation.findings.some(function (finding) {
    return finding.code === "ventilation_shortfall";
  }));
});

test("Comfort ventilation does not fail solely because advisory ACH is low", function () {
  const validation = core.buildDesignValidation({
    complianceMode: "comfort_ventilation",
    achRequirementMode: "advisory",
    achActual: 2.5,
    achRequired: 6,
    ventilationProvidedCfm: 420,
    ventilationRequiredCfm: 400,
    selectedTR: 5,
    trFinal: 5,
    trDesign: 4.8,
    totalLoadW: 16881.6,
    sensibleW: 13000,
    latentW: 3881.6,
    roomShrLoad: 0.77,
    roomShrPsychro: 0.77,
    enthalpyBalanceErrorKJkg: 0.1,
    roomSupplyAirflowCfm: 1800,
    coolingCoilAirflowCfm: 1800,
    recirculationAirflowCfm: 1800,
    totalRoomSupplyCfm: 1800,
    coilAirflowUsedCfm: 1800,
    returnAirToCoilCfm: 1800,
    cfmPerTrAirflowCfm: 1800
  });
  const codes = validation.findings.map(function (finding) { return finding.code; });
  assert.equal(validation.status, "COMPLIANT");
  assert.equal(validation.achComplianceStatus, "ADVISORY");
  assert.ok(codes.includes("ach_advisory_shortfall"));
  assert.equal(codes.includes("ach_shortfall"), false);
});

test("Mandatory ACH mode fails when delivered airflow is below target", function () {
  const validation = core.buildDesignValidation({
    complianceMode: "ach_driven",
    achRequirementMode: "mandatory",
    achActual: 3,
    achRequired: 8,
    ventilationProvidedCfm: 420,
    ventilationRequiredCfm: 400,
    selectedTR: 5,
    trFinal: 5,
    trDesign: 4.8,
    totalLoadW: 16881.6,
    sensibleW: 13000,
    latentW: 3881.6,
    roomShrLoad: 0.77,
    roomShrPsychro: 0.77,
    enthalpyBalanceErrorKJkg: 0.1,
    roomSupplyAirflowCfm: 1800,
    coolingCoilAirflowCfm: 1800,
    recirculationAirflowCfm: 1800,
    totalRoomSupplyCfm: 1800,
    coilAirflowUsedCfm: 1800,
    returnAirToCoilCfm: 1800,
    cfmPerTrAirflowCfm: 1800
  });
  assert.equal(validation.status, "NON_COMPLIANT");
  assert.equal(validation.achComplianceStatus, "NON_COMPLIANT");
  assert.ok(validation.findings.some(function (finding) { return finding.code === "ach_shortfall"; }));
});

test("Airflow and duct diagnostics expose driver and ESP physics", function () {
  const airflow = core.buildAirflowDiagnostics({
    systemType: "comfort cooling",
    sensibleAirflowCfm: 1200,
    ventilationAirflowCfm: 450,
    achAirflowCfm: 2400,
    achMandatory: false,
    coolingAirflowCfm: 2400,
    trFinal: 4,
    roomDeltaTDesign: 7.5
  });
  assert.equal(airflow.selectedAirflowDriver, "sensible");
  assert.equal(airflow.status, "HIGH");
  assert.ok(airflow.reasons.includes("low supply-air delta T"));

  const duct = core.calculateDuctDiagnostics({
    cfm: 2400,
    duct: { rectW: 24, rectH: 16 },
    lengthM: 22,
    fittings: [{ type: "elbow_90", count: 3 }],
    equipmentLossPa: 245,
    totalEspPa: 520,
    calibrationPreset: "normal_comfort"
  });
  assert.ok(duct.frictionRatePaM >= 0);
  assert.ok(duct.velocityPressurePa > 0);
  assert.ok(duct.hydraulicDiameterM > 0);
  assert.ok(duct.equivalentDiameterM > 0);
  assert.ok(duct.reynolds > 0);
});

test("Cleanroom airflow streams keep cooling, recirculation, and ventilation separate", function () {
  const streams = core.resolveAirflowStreams({
    thermalAirflowCfm: 2200,
    ventilationAirflowCfm: 450,
    achAirflowCfm: 0,
    cleanroomAirflowCfm: 7200,
    cleanroomMode: true
  });

  assert.equal(streams.architectureMode, "decoupled_cleanroom");
  assert.equal(streams.coolingCoilAirflowCfm, 2200);
  assert.equal(streams.recirculationAirflowCfm, 7200);
  assert.equal(streams.additionalRecirculationAirflowCfm, 5000);
  assert.equal(streams.ventilationAirflowCfm, 450);
  assert.equal(streams.dedicatedVentilationAirflowCfm, 450);
  assert.equal(streams.ventilationIntoCoolingCoilAirflowCfm, 0);
  assert.equal(streams.totalOutdoorAirCfm, 450);
  assert.equal(streams.totalDeliveredAirflowCfm, 7650);
  assert.ok(streams.notes.some(function (note) {
    return /recirculation \/ cleanliness duty/i.test(note);
  }));
});

test("Dedicated ventilation does not inflate non-cleanroom recirculation airflow", function () {
  const streams = core.resolveAirflowStreams({
    thermalAirflowCfm: 500,
    ventilationAirflowCfm: 800,
    achAirflowCfm: 1200,
    cleanroomAirflowCfm: 0,
    cleanroomMode: false,
    forceDedicatedVentilation: true
  });

  assert.equal(streams.architectureMode, "decoupled_ventilation");
  assert.equal(streams.coolingCoilAirflowCfm, 500);
  assert.equal(streams.recirculationAirflowCfm, 500);
  assert.equal(streams.additionalRecirculationAirflowCfm, 0);
  assert.equal(streams.dedicatedVentilationAirflowCfm, 800);
  assert.equal(streams.ventilationIntoCoolingCoilAirflowCfm, 0);
  assert.equal(streams.processExcessAirflowCfm, 0);
  assert.equal(streams.totalDeliveredAirflowCfm, 1300);
});

test("Dedicated ventilation only adds process airflow for unmet ACH balance", function () {
  const streams = core.resolveAirflowStreams({
    thermalAirflowCfm: 500,
    ventilationAirflowCfm: 200,
    achAirflowCfm: 900,
    cleanroomAirflowCfm: 0,
    cleanroomMode: false,
    forceDedicatedVentilation: true,
    allowProcessMakeupAir: true,
    processMode: true
  });

  assert.equal(streams.architectureMode, "cooling_plus_process_air");
  assert.equal(streams.coolingCoilAirflowCfm, 500);
  assert.equal(streams.recirculationAirflowCfm, 500);
  assert.equal(streams.dedicatedVentilationAirflowCfm, 200);
  assert.equal(streams.processExcessAirflowCfm, 200);
  assert.equal(streams.totalDeliveredAirflowCfm, 900);
});

test("Airflow validation blocks coil and CFM/TR reporting when non-cooling airflow is used", function () {
  const validation = core.buildDesignValidation({
    roomShrLoad: 0.78,
    roomShrPsychro: 0.79,
    enthalpyBalanceErrorKJkg: 0.12,
    achActual: 18.0,
    achRequired: 12.0,
    ventilationProvidedCfm: 300,
    ventilationRequiredCfm: 250,
    selectedTR: 6.2,
    trFinal: 6.0,
    totalEspPa: 620,
    supplyTempC: 12.1,
    spaceSensibleW: 6200,
    spaceLatentW: 1700,
    infiltrationAch: 0.25,
    roomSupplyAirflowCfm: 5000,
    coolingCoilAirflowCfm: 2200,
    recirculationAirflowCfm: 5000,
    coilAirflowUsedCfm: 5000,
    returnAirToCoilCfm: 5000,
    cfmPerTrAirflowCfm: 5000,
    assumptions: ["Unit test airflow hierarchy check"]
  });

  assert.equal(validation.status, "NON_COMPLIANT");
  assert.ok(validation.findings.some(function (finding) {
    return finding.code === "coil_airflow_mismatch";
  }));
  assert.ok(validation.findings.some(function (finding) {
    return finding.code === "coil_return_air_mismatch";
  }));
  assert.ok(validation.findings.some(function (finding) {
    return finding.code === "cfm_per_tr_not_on_cooling_airflow";
  }));
});

test("Recirculation-dominant rooms are flagged when not marked as separated-air systems", function () {
  const validation = core.buildDesignValidation({
    roomShrLoad: 0.81,
    roomShrPsychro: 0.82,
    enthalpyBalanceErrorKJkg: 0.10,
    achActual: 14.0,
    achRequired: 10.0,
    ventilationProvidedCfm: 220,
    ventilationRequiredCfm: 200,
    selectedTR: 5.5,
    trFinal: 5.3,
    totalEspPa: 580,
    supplyTempC: 12.8,
    spaceSensibleW: 5600,
    spaceLatentW: 1300,
    infiltrationAch: 0.22,
    roomSupplyAirflowCfm: 6200,
    coolingCoilAirflowCfm: 2200,
    recirculationAirflowCfm: 6200,
    coilAirflowUsedCfm: 2200,
    cfmPerTrAirflowCfm: 2200,
    cleanroomMode: false,
    assumptions: ["Unit test recirculation-dominant review"]
  });

  assert.equal(validation.status, "REVIEW");
  assert.ok(validation.findings.some(function (finding) {
    return finding.code === "recirculation_mode_not_flagged";
  }));
});

test("Design intelligence report returns structured cleanroom reasoning output", function () {
  const report = core.buildDesignIntelligenceReport({
    validation: {
      status: "REVIEW",
      summary: "Recirculation airflow dominates the architecture.",
      confidenceScore: 0.88,
      criticalCount: 0,
      warningCount: 1,
      advisoryCount: 1,
      findings: []
    },
    cleanroom: {
      classLabel: "ISO 7",
      classNumber: 7,
      designAch: 45,
      note: "ISO 7 cleanroom basis."
    },
    areaM2: 120,
    volumeM3: 360,
    zoneCount: 2,
    trFinal: 8.4,
    trCoolingCoil: 6.6,
    trVentilation: 0.8,
    totalEspPa: 840,
    ductFrictionPa: 290,
    fittingLossPa: 130,
    equipmentLossPa: 420,
    coolingAirflowCfm: 2400,
    recirculationAirflowCfm: 7600,
    dedicatedVentilationAirflowCfm: 500,
    processAirflowCfm: 0,
    ventilationAirflowCfm: 500,
    totalRoomAirflowCfm: 8100,
    outdoorAirCfm: 500,
    ventilationRequiredCfm: 420,
    coolingFanKW: 2.4,
    recirculationFanKW: 7.8,
    ventilationFanKW: 0.9,
    achActual: 35.9,
    achRequired: 45,
    achRecirculation: 33.9,
    achTotalRoom: 36.2,
    latentLoadRatio: 0.22,
    ventilationFraction: 0.07,
    processRatio: 0,
    supplyTempC: 12.2,
    bypassFactor: 0.09,
    airflows: {
      cooling: { airflowCfm: 2400 },
      recirculation: { airflowCfm: 7600 },
      ventilation: { airflowCfm: 500, dedicatedAirflowCfm: 500, totalOutdoorAirCfm: 500 },
      room: { totalAirflowCfm: 8100, achCompliance: 35.9, achRecirculation: 33.9, achTotalRoom: 36.2 }
    },
    systems: {
      cooling: { fanKW: 2.4 },
      recirculation: { fanKW: 7.8 },
      ventilation: { fanKW: 0.9 }
    },
    systemArchitecture: {
      mode: "decoupled_cleanroom",
      recirculationAirflowCfm: 7600,
      coolingCoilAirflowCfm: 2400,
      ventilationAirflowCfm: 500,
      totalRoomAirflowCfm: 8100
    }
  });

  assert.equal(report.provider, "local_reasoning");
  assert.ok(report.systemSummary.architecture.includes("ISO 7"));
  assert.ok(Array.isArray(report.keyIssues) && report.keyIssues.length > 0);
  assert.ok(report.keyIssues.some(function (issue) {
    return issue.key === "airflow_architecture";
  }));
  assert.ok(Array.isArray(report.rootCauseAnalysis) && report.rootCauseAnalysis[0].rootCauses.length > 0);
  assert.ok(report.rootCauseAnalysis.every(function (issue) {
    return !/Compliance resilience depends strongly/i.test(issue.problem || "");
  }));
  assert.ok(Array.isArray(report.recommendedDesignChanges) && report.recommendedDesignChanges.length > 0);
  assert.ok(Array.isArray(report.alternativeSystemScenarios) && report.alternativeSystemScenarios.length === 3);
  assert.ok(report.finalRecommendation && report.finalRecommendation.selectedScenarioKey);
  assert.ok(Array.isArray(report.items) && report.items.length > 0);
});

test("Reasoning alternatives prefer non-cost-baseline scenarios when fan and ventilation burdens are high", function () {
  const alternatives = core.buildReasoningAlternatives({
    validation: {
      status: "REVIEW",
      summary: "Fan pressure and airflow architecture need review.",
      confidenceScore: 0.84,
      criticalCount: 0,
      warningCount: 2,
      advisoryCount: 1,
      findings: []
    },
    areaM2: 180,
    volumeM3: 630,
    zoneCount: 3,
    trFinal: 11.5,
    trCoolingCoil: 9.4,
    totalEspPa: 920,
    ductFrictionPa: 360,
    fittingLossPa: 180,
    equipmentLossPa: 380,
    coolingAirflowCfm: 3100,
    recirculationAirflowCfm: 5200,
    ventilationAirflowCfm: 1600,
    dedicatedVentilationAirflowCfm: 900,
    processAirflowCfm: 700,
    totalRoomAirflowCfm: 6800,
    outdoorAirCfm: 1600,
    ventilationRequiredCfm: 1200,
    coolingFanKW: 3.2,
    recirculationFanKW: 9.1,
    ventilationFanKW: 2.0,
    achActual: 18.2,
    achRequired: 12.0,
    latentLoadRatio: 0.31,
    ventilationFraction: 0.31,
    processRatio: 0.13,
    supplyTempC: 10.8,
    bypassFactor: 0.14,
    currentSystemType: "Single mixed-air AHU"
  });

  assert.equal(alternatives.provider, "local_reasoning");
  assert.ok(Array.isArray(alternatives.options) && alternatives.options.length === 3);
  assert.ok(alternatives.finalRecommendation);
  assert.notEqual(alternatives.preferredOptionKey, "cost_effective");
  assert.ok(alternatives.options.every(function (option) {
    return option.robustnessScore != null && option.decisionScore != null;
  }));
  assert.ok(alternatives.options.some(function (option) {
    return /DOAS|low-static|split/i.test(option.systemType || "");
  }));
});

test("Multi-room diversity summary applies the diversity factor to total final TR", function () {
  const summary = core.summarizeProjectDiversity([
    { tr_design: 4.5, tr_final: 4.8, tr_catalog: 5.0 },
    { tr_design: 3.1, tr_final: 3.4, tr_catalog: 3.5 },
    { tr_design: 2.8, tr_final: 3.0, tr_catalog: 3.0 }
  ], 0.9);

  assert.equal(summary.roomCount, 3);
  assert.equal(summary.totalFinalTR, 11.2);
  assert.equal(summary.diversifiedTR, 10.08);
});
