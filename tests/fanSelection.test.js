const test = require("node:test");
const assert = require("node:assert");

const EquipmentEngine = require("../equipmentEngine.js");
const designer = require("../engine/ashrae/designer.js");

const IN_WG_PER_PA = 1 / 249.0889;

function expectedBrakeKw(cfm, espPa, efficiency) {
  // BHP = CFM · TP(in.wg) / (6356 · η);  kW = BHP · 0.746
  return (cfm * espPa * IN_WG_PER_PA) / (6356 * efficiency) * 0.746;
}

test("selectFan brake kW matches AMCA fan-power formula", () => {
  const fan = EquipmentEngine.selectFan(4500, 550);
  const expected = expectedBrakeKw(4500, 550, fan.efficiency);
  assert.ok(Math.abs(fan.brakeKW - expected) < 0.02,
    `brakeKW ${fan.brakeKW} should be ~${expected.toFixed(3)}`);
});

test("selectFan power chain: brake ≤ electrical ≤ installed motor", () => {
  const points = [
    [600, 200], [1500, 300], [3000, 450], [4500, 550],
    [8000, 700], [12000, 850], [20000, 1000]
  ];
  for (const [cfm, esp] of points) {
    const fan = EquipmentEngine.selectFan(cfm, esp);
    assert.ok(fan.brakeKW > 0, `brakeKW > 0 at ${cfm}/${esp}`);
    assert.ok(fan.electricalKW >= fan.brakeKW - 0.01,
      `electrical ${fan.electricalKW} ≥ brake ${fan.brakeKW} at ${cfm}/${esp}`);
    assert.ok(fan.motorKW >= fan.electricalKW - 0.01,
      `installed motor ${fan.motorKW} ≥ electrical ${fan.electricalKW} at ${cfm}/${esp}`);
  }
});

test("selectFan picks an in-range curve whenever one exists", () => {
  // Points chosen inside known catalog windows (see FAN_DATABASE).
  const inRangePoints = [
    [2000, 150],  // AX-01
    [1800, 300],  // FC-01
    [4500, 550],  // BC-01
    [12000, 750]  // BC-02
  ];
  for (const [cfm, esp] of inRangePoints) {
    const fan = EquipmentEngine.selectFan(cfm, esp);
    assert.strictEqual(fan.withinRange, true, `expected in-range fan at ${cfm} CFM / ${esp} Pa, got ${fan.curveId}`);
    assert.ok(cfm >= fan.minCFM && cfm <= fan.maxCFM, "CFM inside selected curve window");
    assert.ok(esp >= fan.minESP && esp <= fan.maxESP, "ESP inside selected curve window");
  }
});

test("selectFan flags out-of-catalog duty instead of pretending it fits", () => {
  const fan = EquipmentEngine.selectFan(40000, 1600);
  assert.strictEqual(fan.withinRange, false);
  assert.match(fan.selectionNote, /outside the available catalog window/);
});

test("selectFan brake kW is monotonic in ESP and CFM", () => {
  let previous = 0;
  for (const esp of [200, 350, 500, 650, 800]) {
    const fan = EquipmentEngine.selectFan(5000, esp);
    assert.ok(fan.brakeKW >= previous - 0.05,
      `brakeKW should not drop as ESP rises (${esp} Pa → ${fan.brakeKW} kW)`);
    previous = fan.brakeKW;
  }
  previous = 0;
  for (const cfm of [1000, 2500, 5000, 9000, 15000]) {
    const fan = EquipmentEngine.selectFan(cfm, 500);
    assert.ok(fan.brakeKW >= previous - 0.05,
      `brakeKW should not drop as CFM rises (${cfm} CFM → ${fan.brakeKW} kW)`);
    previous = fan.brakeKW;
  }
});

test("selectSystem: operating electrical kW is below installed motor kW", () => {
  const system = EquipmentEngine.selectSystem(12, 4800, 520, { catalogTR: 12.5 });
  assert.ok(system.electricalFanKWTotal > 0);
  assert.ok(system.recommendedMotorKW >= system.electricalFanKWTotal,
    "installed motor must be ≥ operating electrical input");
  const impliedSfp = system.electricalFanKWTotal / 12;
  assert.ok(Math.abs(system.specificFanPowerKWPerTR - impliedSfp) < 0.02,
    "specific fan power must be computed from operating electrical kW, not installed motor kW");
});

test("selectSystem coil capacity covers catalog TR when adequate", () => {
  for (const [tr, cfm, esp] of [[3, 1200, 380], [7.5, 2900, 500], [15, 5700, 650], [30, 11400, 800]]) {
    const system = EquipmentEngine.selectSystem(tr, cfm, esp, { catalogTR: tr });
    if (system.ahu.adequate) {
      assert.ok(system.ahu.capacityTR + 0.001 >= tr,
        `capacity ${system.ahu.capacityTR} TR must cover required ${tr} TR`);
    }
    assert.ok(system.ahu.capacityTR > 0);
  }
});

test("selectFan and selectSystem are deterministic across repeated iterations", () => {
  const fanBaseline = JSON.stringify(EquipmentEngine.selectFan(4200, 480));
  const systemBaseline = JSON.stringify(EquipmentEngine.selectSystem(10, 3800, 550, { catalogTR: 10 }));
  for (let i = 0; i < 50; i += 1) {
    assert.strictEqual(JSON.stringify(EquipmentEngine.selectFan(4200, 480)), fanBaseline);
    assert.strictEqual(JSON.stringify(EquipmentEngine.selectSystem(10, 3800, 550, { catalogTR: 10 })), systemBaseline);
  }
});

function sampleProject() {
  return {
    name: "Iteration check",
    climate: {
      latitudeDeg: 26.9, longitudeDeg: 75.8, stdMeridianDeg: 82.5,
      designOutdoorDbC: 42, designOutdoorWbC: 24,
      designDayOfYear: 202, designClockHour: 15, elevationM: 216
    },
    rooms: [{
      name: "Office", areaM2: 120, ceilingHeightM: 3.5,
      occupants: 25, activity: "seated_office",
      lpd: 9, epd: 20, equipmentUsage: 0.8,
      walls: [
        { area: 51, U: 0.42, orientation: "S", alpha: 0.6 },
        { area: 51, U: 0.42, orientation: "W", alpha: 0.6 }
      ],
      roof: { area: 120, U: 0.35, alpha: 0.85, dR: 63 },
      windows: [{ area: 14, U: 2.8, sc: 0.65, orientation: "W" }],
      infiltrationAch: 0.5, ventilationCfmPerPerson: 10, ventilationCfmPerM2: 0.3,
      supplyTempC: 13.5, setpointC: 23, setpointRhPct: 55, safetyFactor: 1.10
    }],
    designIntent: {
      systemType: "vrf", fanEfficiency: 0.65, motorEfficiency: 0.92,
      externalSpPa: 480, diversityFactor: 1.0
    }
  };
}

function stableJson(design) {
  // generatedAt is a wall-clock timestamp — exclude it from determinism checks.
  return JSON.stringify(Object.assign({}, design, { generatedAt: null }));
}

test("designProject is deterministic and physically sane across 25 iterations", () => {
  const baseline = designer.designProject(sampleProject());
  const baselineJson = stableJson(baseline);
  for (let i = 0; i < 25; i += 1) {
    assert.strictEqual(stableJson(designer.designProject(sampleProject())), baselineJson,
      "identical inputs must produce identical designs on every iteration");
  }
  const a = baseline.aggregate;
  assert.ok(a.totalLoadW > 0 && a.totalCfm > 0 && a.selectedTR > 0);
  assert.ok(a.selectedTR * 3517 + 1 >= a.totalLoadW * 0.9,
    "selected tonnage must be in the same order as the computed load");
  const room = baseline.rooms[0];
  assert.ok(room.roomLoad.shr > 0.5 && room.roomLoad.shr <= 1, "SHR must be physical");
  assert.ok(baseline.fan.motorInputKw > 0, "fan motor input must be positive");
  assert.ok(baseline.fan.motorInputKw >= baseline.fan.shaftKw,
    "motor electrical input must be ≥ shaft power");
});

test("designProject responds monotonically to load drivers", () => {
  const base = designer.designProject(sampleProject());

  const hotter = sampleProject();
  hotter.climate.designOutdoorDbC = 46;
  const hotterDesign = designer.designProject(hotter);
  assert.ok(hotterDesign.aggregate.totalLoadW > base.aggregate.totalLoadW,
    "higher outdoor temperature must increase total load");

  const crowded = sampleProject();
  crowded.rooms[0].occupants = 60;
  const crowdedDesign = designer.designProject(crowded);
  assert.ok(crowdedDesign.aggregate.totalLoadW > base.aggregate.totalLoadW,
    "more occupants must increase total load");

  const higherEsp = sampleProject();
  higherEsp.designIntent.externalSpPa = 900;
  const higherEspDesign = designer.designProject(higherEsp);
  assert.ok(higherEspDesign.fan.motorInputKw > base.fan.motorInputKw,
    "higher static pressure must increase fan power");
});

test("autoFix converges and stays converged when re-run on the same project", () => {
  const constraints = { maxFanWPerCfm: 1.1, maxTROversizingPct: 20 };
  const first = designer.autoFix(sampleProject(), constraints);
  assert.ok(first.iterations >= 1);
  if (first.success) {
    assert.ok(first.design.fan.wPerCfm <= 1.1 + 0.01,
      "converged design must satisfy the fan W/CFM constraint");
    const second = designer.autoFix(sampleProject(), constraints);
    assert.strictEqual(second.success, true, "re-running autoFix must converge again");
    assert.strictEqual(stableJson(second.design), stableJson(first.design),
      "autoFix must be deterministic across repeated runs");
  }
});
