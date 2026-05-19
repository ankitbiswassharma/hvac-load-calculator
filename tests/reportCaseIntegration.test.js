const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const EngineeringCore = require("../engineeringCore.js");

function loadBrowserCalculator() {
  const repoRoot = path.resolve(__dirname, "..");
  const elements = new Map();
  const project = {
    name: "Report Case",
    rooms: [],
    activeRoomId: "report-case",
    diversityFactor: 85,
    costingContext: null
  };
  const sandbox = {
    console: console,
    module: { exports: {} },
    exports: {},
    require: require,
    __HVAC_TEST_MODE: true,
    EngineeringCore: EngineeringCore,
    STD_TR: [1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10, 12.5, 15, 20, 25, 30, 35, 40, 50, 60],
    localStorage: {
      getItem: function () { return null; },
      setItem: function () {},
      removeItem: function () {}
    },
    location: { search: "", href: "http://localhost/test", protocol: "http:" },
    history: { replaceState: function () {} },
    setTimeout: function () {},
    clearTimeout: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    scrollTo: function () {},
    print: function () {}
  };
  sandbox.window = sandbox;
  sandbox.document = {
    readyState: "complete",
    title: "Test",
    getElementById: function (id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id: id,
          value: "",
          dataset: {},
          style: {},
          innerHTML: "",
          outerHTML: "",
          textContent: "",
          disabled: false,
          readOnly: false,
          tagName: "INPUT",
          classList: { toggle: function () {}, add: function () {}, remove: function () {} },
          addEventListener: function () {},
          removeEventListener: function () {},
          querySelector: function () { return null; }
        });
      }
      return elements.get(id);
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () {
      return {
        dataset: {},
        style: {},
        setAttribute: function () {},
        addEventListener: function () {}
      };
    },
    addEventListener: function () {}
  };
	  sandbox.ProjectManager = {
	    getProject: function () {
	      return project;
	    },
	    getActiveRoom: function () {
	      return project.rooms.find(function (room) { return room.id === project.activeRoomId; }) || null;
	    },
	    setDiversityFactor: function (value) {
	      project.diversityFactor = value;
	    },
	    listSavedProjects: function () {
	      return [];
	    }
	  };
  sandbox.AuthManager = {
    hydrateSession: async function () { return null; },
    getCurrentUser: function () { return null; },
    isAuthenticated: function () { return false; }
  };
  sandbox.ServerApi = {
    isAvailable: async function () { return false; },
    hasCapability: async function () { return false; }
  };

  vm.createContext(sandbox);
  ["solarEngine.js", "diffuserLayout.js", "equipmentEngine.js", "costingEngine.js", "optimizationEngine.js", "hvacPlatform.js"].forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, file), "utf8"), sandbox, { filename: file });
  });
	  sandbox.__project = project;
	  sandbox.__elements = elements;
	  return sandbox;
}

function reportCaseInputs(overrides) {
  return Object.assign({
    len: "20",
    wid: "13",
    ht: "4",
    design_mode: "comfort",
    cleanroom_iso_class: "ISO 8",
    cleanroom_state: "operational",
    cleanroom_pressure_mode: "positive",
    window_count: "1",
    window_config: '[{"area":12,"orientation":"W"}]',
    win_area: "12",
    win_orient: "W",
    wall_count: "2",
    wall_config: '[{"area":80,"orientation":"W"},{"area":52,"orientation":"S"}]',
    wall_exp: "2",
    ceiling_area: "260",
    floor_area: "260",
    roof_exp: "ground",
    occ: "10",
    occ_act: "seated_light",
    fresh_cfm: "15",
    lighting: "12",
    equip: "15",
    out_dbt: "39.8",
    out_wbt: "24",
    out_rh: "23",
    out_lat: "18.52",
    out_elev: "560",
    in_dbt: "22",
    in_rh: "45",
    sf: "10",
    u_wall: "0.45",
    u_roof: "0.40",
    sc_glass: "0.87",
    clf_shade: "0.55",
    solar_day: "202",
    solar_hour: "15",
    ahu_group: "AHU-1"
  }, overrides || {});
}

test("Pune comfort report case keeps airflow, AHU, fan, diffuser, floor, and energy contracts consistent", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(reportCaseInputs(), { skipAiEnhancements: true });
  const payload = sandbox.HvacPlatformTest.buildEnergySimulationPayload(result, { id: "report-case", name: "Pune report case" });
  const groups = sandbox.EquipmentEngine.buildAhuGroups([{ inputs: result.inputs, result: result }], 0.85);

  assert.equal(result.cleanroom, null);
  assert.equal(result.cfm_process_excess, 0);
  assert.equal(result.processMakeupAirCFM, 0);
  assert.equal(result.airflows.ventilation.processAirflowCfm, 0);
  assert.equal(result.airflows.topology.comfortAchUsesConditionedAirOnly, true);
  assert.equal(result.airflows.topology.totalRoomSupplyCFM, result.cfm_final);
  assert.equal(result.cfm_final, result.cfm_conditioned);
  assert.equal(result.airflows.returnAir.toCoilCfm, result.cfm_cooling_coil);
  assert.equal(result.psychro.supplyMassFlowDa > 0, true);

	  assert.equal(payload.system_data.conditioned_airflow_cfm, result.airflows.recirculation.airflowCfm);
	  assert.equal(payload.system_data.conditioned_airflow_cfm < result.airflows.recirculation.airflowCfm * 1.01, true);
	  assert.equal(payload.system_data.process_airflow_cfm, 0);
	  assert.equal(payload.system_data.peak_conditioned_fan_kw, result.finalDesign.fans.recirculationFanKW);
	  assert.equal(payload.finalDesign.airflow.recirculationCFM, result.finalDesign.airflow.recirculationCFM);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].diversityFactor, 1);
  assert.equal(groups[0].diversifiedTR, groups[0].totalFinalTR);
  assert.equal(groups[0].selection.ahu.capacityTR >= groups[0].totalFinalTR, true);
  assert.equal(result.zoneAhuStrategy.aggregateSelection.ahu.capacityTR >= result.tr_final, true);

  const expectedSfp = Number((result.total_fan_kw / result.tr_final).toFixed(2));
  assert.equal(result.energyOptimization.specificFanPowerKWPerTR, expectedSfp);
  assert.equal(result.cooling_fan_kw, 0);
  assert.equal(result.total_fan_kw, result.recirculation_fan_kw + result.ventilation_fan_kw);

  assert.equal(result.diffuserLayout.spacingX > 0, true);
  assert.equal(result.diffuserLayout.spacingY > 0, true);
  assert.equal((result.diffuserLayout.overlapCount || 0), 0);

  assert.equal(result.roofSensible, 0);
  assert.equal(result.floorSensible, 0);
  assert.equal(result.cltdContext.floorLoadType, "slab_on_grade");
  assert.equal(result.cltdContext.roofLoadType, "not_exposed_roof");

	  assert.equal(result.validation.findings.some(function (finding) {
    return finding.code === "comfort_process_air_undefined"
      || finding.code === "process_stream_missing_state"
      || finding.code === "energy_conditioned_airflow_mismatch";
	  }), false);
});

test("Energy, fan, advisory, and PDF report surfaces consume finalDesign/finalEnergyResult only", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(reportCaseInputs(), { skipAiEnhancements: true });
  result.calculationId = "report-case-calc";
  result.finalDesign = sandbox.HvacPlatformTest.buildFinalDesign(result);
  const finalEnergyResult = sandbox.HvacPlatformTest.normalizeEnergyReportForFinalDesign({
    annual_energy_kwh: 9779,
    cooling_energy: 8843,
    fan_energy: 936,
    process_energy: 0,
    peak_power_kw: 4.9,
    energy_cost: 95345,
    system_efficiency: 0.87,
    peak_tr: result.tr_final,
    system_input: {
      conditioned_airflow_cfm: 15575,
      process_airflow_cfm: 150,
      peak_conditioned_fan_kw: 9
    },
    graph_data: []
  }, result);
  result.finalEnergyResult = finalEnergyResult;
  result.energySimulation = {
    annual_energy_kwh: 12999,
    cooling_energy: 5364,
    fan_energy: 7572,
    process_energy: 63,
    system_input: {
      conditioned_airflow_cfm: 15575,
      process_airflow_cfm: 150,
      peak_conditioned_fan_kw: 9
    }
  };
  result.energySimulationStatus = "ready";
  sandbox.__project.rooms = [{ id: "report-case", name: "Pune report case", inputs: result.inputs, result: result }];

  sandbox.HvacPlatformTest.renderEnergy(result);
  const energyInputs = sandbox.__elements.get("energy-input-summary").innerHTML;
  const energySummary = sandbox.__elements.get("energy-summary-table").innerHTML;
  const projectRollup = sandbox.__elements.get("energy-project-rollup").innerHTML;

  assert.match(energyInputs.replace(/,/g, ""), new RegExp(String(Math.round(result.finalDesign.airflow.recirculationCFM))));
  assert.match(energyInputs, new RegExp(result.finalDesign.fans.recirculationFanKW.toFixed(2).replace(".", "\\.")));
  assert.doesNotMatch(energyInputs, /15,?575|9\.00|150 CFM/);
  assert.match(energySummary, /9,779 kWh/);
  assert.match(projectRollup, /9,779 kWh/);
  assert.doesNotMatch(energySummary + projectRollup, /12,999|7,572|5,364/);

  const advisorText = JSON.stringify(result.designAdvisor || {});
  assert.doesNotMatch(advisorText, /cleanroom/i);
  assert.equal((advisorText.match(/significant parallel stream/g) || []).length, 0);
  assert.equal((advisorText.match(/materially larger/g) || []).length, 0);

  const css = fs.readFileSync(path.join(__dirname, "..", "contact copy 2.html"), "utf8");
  assert.match(css, /advisory-card[\s\S]*writing-mode:\s*horizontal-tb/i);
  assert.match(css, /advisory-card[\s\S]*white-space:\s*normal/i);
});

test("Report rendering blocks finalized energy divergence before PDF markup is built", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(reportCaseInputs(), { skipAiEnhancements: true });
  result.calculationId = "blocked-render-calc";
  result.finalDesign = sandbox.HvacPlatformTest.buildFinalDesign(result);
  result.finalEnergyResult = {
    annual_energy_kwh: 1000,
    cooling_energy: 800,
    fan_energy: 200,
    process_energy: 0,
    energy_cost: 9000,
    system_input: {
      conditioned_airflow_cfm: result.finalDesign.airflow.recirculationCFM + 500,
      process_airflow_cfm: result.finalDesign.airflow.ventilationCFM,
      peak_conditioned_fan_kw: result.finalDesign.fans.recirculationFanKW
    }
  };
  result.energySimulationStatus = "ready";
  sandbox.__project.rooms = [{ id: "report-case", name: "Pune report case", inputs: result.inputs, result: result }];

  assert.throws(function () {
    sandbox.HvacPlatformTest.renderReport(result, []);
  }, /Report consistency validation failed/);
});

test("Clean report package includes executive summary, all result sections, AI, and schematic summary", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(reportCaseInputs(), { skipAiEnhancements: true });
  result.calculationId = "clean-report-package";
  result.finalDesign = sandbox.HvacPlatformTest.buildFinalDesign(result);
  sandbox.__project.rooms = [{ id: "report-case", name: "Pune report case", inputs: result.inputs, result: result }];

  sandbox.HvacPlatformTest.renderReport(result, []);
  const reportHtml = sandbox.__elements.get("report-content").innerHTML;

  assert.match(reportHtml, /report-summary-grid/);
  assert.match(reportHtml, /report-cover-shell/);
  assert.match(reportHtml, /HVAC Design Calculation Report/);
  assert.match(reportHtml, /MEP Pro/);
  assert.match(reportHtml, /Report Contents/);
  [
    "COOLING LOAD",
    "AIRFLOW",
    "DUCT SIZING",
    "ESP",
    "FAN SELECTION",
    "DIFFUSER",
    "PSYCHROMETRIC",
    "DESIGN VALIDATION",
    "SOLAR / GLASS COOLING LOAD",
    "MULTI-ROOM",
    "BOQ / COSTING",
    "ENERGY SIMULATION",
    "AI DESIGN STUDIO",
    "3D SCHEMATIC SUMMARY"
  ].forEach(function (label) {
    assert.match(reportHtml, new RegExp(label.replace(/[ /]/g, "[ /]")));
  });
  assert.match(reportHtml, /AI HVAC Design Assistant/);
  assert.match(reportHtml, /report-ai-metric-grid/);
  assert.match(reportHtml, /report-ai-card-grid/);
});

test("Project summary ignores stale room airflow fields when finalDesign is present", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(reportCaseInputs(), { skipAiEnhancements: true });
  result.finalDesign = sandbox.HvacPlatformTest.buildFinalDesign(result);
  result.cfm_final = 99999;
  result.cfm_conditioned = 88888;
  result.cfm_cooling_coil = 77777;
  result.ventilation_airflow_cfm = 66666;
  sandbox.__project.rooms = [{ id: "report-case", name: "Pune report case", inputs: result.inputs, result: result }];

  sandbox.HvacPlatformTest.renderProjectSummary();
  const projectSummary = sandbox.__elements.get("project-summary-table").innerHTML;
  const roomRows = sandbox.__elements.get("project-room-tbody").innerHTML;

  assert.match(projectSummary.replace(/,/g, ""), new RegExp(String(Math.round(result.finalDesign.airflow.totalRoomSupplyCFM))));
  assert.match(roomRows.replace(/,/g, ""), new RegExp(String(Math.round(result.finalDesign.airflow.totalRoomSupplyCFM))));
  assert.doesNotMatch(projectSummary + roomRows, /99,?999|88,?888|77,?777|66,?666/);
});

test("Solar model separates incident solar from effective glass cooling load", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(reportCaseInputs(), { skipAiEnhancements: true });
  assert.ok(result.solar.point.incidentSolarOnGlassWm2 > 0);
  assert.ok(result.solar.point.coolingLoadSolarWm2 > 0);
  assert.ok(result.solar.point.incidentSolarOnGlassWm2 > result.solar.point.coolingLoadSolarWm2);
  assert.equal(result.solar.point.valueBasis, "effective_glass_cooling_load_w_m2");
});

test("Local AI assistant includes design stats and deduplicated structured sections", function () {
  const sandbox = loadBrowserCalculator();
  const result = sandbox.HvacPlatformTest.calculateRoom(reportCaseInputs(), { skipAiEnhancements: true });
  const advisor = result.designAdvisor;
  assert.ok(Array.isArray(advisor.metrics));
  assert.ok(advisor.metrics.some(function (metric) { return metric.key === "cfm_per_tr"; }));
  assert.ok(advisor.metrics.some(function (metric) { return metric.key === "esp"; }));
  assert.ok(Array.isArray(advisor.sections));
  assert.ok(advisor.sections.some(function (section) { return section.title === "Design Snapshot"; }));
  assert.ok(advisor.sections.some(function (section) { return section.title === "Recommended Design Actions"; }));
  const sectionText = advisor.sections.map(function (section) { return section.title + ":" + section.bullets.join(" "); });
  assert.equal(new Set(sectionText).size, sectionText.length);
});

test("Validation catches undefined airflow paths and single-room diversity misuse", function () {
  const validation = EngineeringCore.buildDesignValidation({
    roomShrLoad: 0.8,
    roomShrPsychro: 0.8,
    enthalpyBalanceErrorKJkg: 0.1,
    achActual: 5,
    achRequired: 4,
    ventilationProvidedCfm: 150,
    ventilationRequiredCfm: 150,
    selectedTR: 6,
    catalogTR: 5,
    trDesign: 5.6,
    trFinal: 5.6,
    totalLoadW: 19695.2,
    sensibleW: 15000,
    latentW: 4695.2,
    roomSupplyAirflowCfm: 3125,
    coolingCoilAirflowCfm: 3125,
    recirculationAirflowCfm: 3125,
    processMakeupAirCfm: 600,
    totalRoomSupplyCfm: 3725,
    processStreamDefined: false,
    cleanroomMode: false,
    processMode: false,
    diversityFactor: 0.85,
    projectRoomCount: 1,
    energyConditionedAirflowCfm: 15575,
    energyProcessAirflowCfm: 600,
    designCfmPerTR: 558
  });
  const codes = validation.findings.map(function (finding) { return finding.code; });

  assert.ok(codes.includes("comfort_process_air_undefined"));
  assert.ok(codes.includes("process_stream_missing_state"));
  assert.ok(codes.includes("single_room_diversity_applied"));
  assert.ok(codes.includes("energy_conditioned_airflow_mismatch"));
  assert.ok(codes.includes("catalog_tr_below_final"));
});
