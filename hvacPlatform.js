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
  const OCCUPANT_LOADS = {
    seated_rest: { sensible: 60, latent: 45 },
    seated_light: { sensible: 70, latent: 45 },
    standing_light: { sensible: 75, latent: 55 },
    walking: { sensible: 90, latent: 75 }
  };
  const CLTD_WALL = { 1: 15, 2: 18, 3: 21, 4: 24 };
  // ASHRAE 1989 HOF Table 30, Roof No. 7 (medium-mass concrete + insulation,
  // dark surface) at 16:00 solar time, latitude ~20°N: peak CLTD ≈ 40 °C.
  // The previous default of 28 °C was a non-tropical office-building value
  // and under-predicted exposed-roof load by roughly 40 % in Indian climates.
  // Middle/ground floor rooms see no direct roof gain.
  const CLTD_ROOF_MAP = { top_floor: 40, middle: 0, ground: 0 };
  const FRICTION_RATE = 1.0; // Pa/m for equal-friction baseline; converted explicitly at use sites.
  const EQUIP_PRESSURE = {
    filter_clean: 75,
    filter_loaded: 125,
    cooling_coil: 150,
    heat_coil: 40,
    mixing_box: 25,
    diffuser_grille: 20,
    sound_attenuator: 50
  };

  function engineeringCoreApi() {
    return typeof window !== "undefined" && window.EngineeringCore
      ? window.EngineeringCore
      : null;
  }

  function optimizationEngineApi() {
    return typeof window !== "undefined" && window.OptimizationEngine
      ? window.OptimizationEngine
      : null;
  }

  const ROOM_FIELD_IDS = [
    "len",
    "wid",
    "ht",
    "design_mode",
    "ach_requirement_mode",
    "cleanroom_iso_class",
    "cleanroom_state",
    "cleanroom_pressure_mode",
    "window_count",
    "window_config",
    "win_area",
    "win_orient",
    "wall_count",
    "wall_config",
    "wall_exp",
    "ceiling_area",
    "floor_area",
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
    design_mode: "comfort",
    ach_requirement_mode: "advisory",
    cleanroom_iso_class: "ISO 8",
    cleanroom_state: "operational",
    cleanroom_pressure_mode: "positive",
    window_count: "1",
    window_config: '[{"area":6,"orientation":"SE"}]',
    win_area: "6",
    win_orient: "SE",
    wall_count: "2",
    wall_config: '[{"area":30,"orientation":"S"},{"area":24,"orientation":"E"}]',
    wall_exp: "2",
    ceiling_area: "80",
    floor_area: "80",
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
    envelopeListenersBound: false,
    authListenersBound: false,
    projectManagerReady: false,
    energyRequestSerial: 0,
    designAdvisorRequestSerial: 0,
    designOptimizationRequestSerial: 0,
    designAlternativesRequestSerial: 0,
    licensingPlans: [],
    razorpayEnabled: false,
    razorpayKeyId: "",
    razorpayLoader: null,
    licenseInvite: null,
    licenseInviteNotice: null,
    ownerLoginChallenge: null,
    adminCompanyUsers: []
  };

  const ORIENTATION_SEQUENCE = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const ORIENTATION_LABELS = {
    N: "North",
    NE: "North-East",
    E: "East",
    SE: "South-East",
    S: "South",
    SW: "South-West",
    W: "West",
    NW: "North-West"
  };
  const DEFAULT_WALL_ORIENTATIONS = ["S", "E", "N", "W", "SE", "SW", "NE", "NW"];
  // Wall orientation is ALREADY captured inside correctedCltd (the solar
  // correction term scales with orientationFactor passed in), and the
  // base CLTD table is itself orientation-specific. Applying these
  // factors a second time as an outer multiplier on U·A·CLTD double-counts
  // orientation — north walls were reduced twice, west walls inflated by
  // 10–14 %. All entries are now 1.0 (no-op) so only the in-CLTD
  // orientation effect remains. Variable kept so external references
  // continue to resolve.
  const WALL_ORIENTATION_FACTORS = {
    N: 1.00, NE: 1.00, E: 1.00, SE: 1.00,
    S: 1.00, SW: 1.00, W: 1.00, NW: 1.00
  };
  const ASHRAE_OFFICE_RP_CFM_PER_PERSON = 5.0;
  const ASHRAE_OFFICE_RA_CFM_PER_SQFT = 0.06;
  const CLEANROOM_TEMPLATE_MAP = {
    9: {
      achRange: [10, 18],
      designAch: 14,
      flowRegime: "Nonunidirectional mixed dilution",
      supplyPattern: "Ceiling supply modules with perimeter returns",
      returnPattern: "High/low wall return grilles",
      finalFilter: "Fine filtration or terminal HEPA review",
      prefilterTrain: "Prefilter + bag filter + optional terminal HEPA",
      filterCoveragePercent: [5, 12],
      pressurizationPa: 5,
      pressurizationReserveCfmPerSqM: 1.6,
      targetCFM: 550,
      minCFMPerModule: 300,
      maxCFMPerModule: 850,
      maxSpacingFactor: 1.6,
      verticalReachFactor: 0.18
    },
    8: {
      achRange: [20, 30],
      designAch: 25,
      flowRegime: "Nonunidirectional cleanroom recirculation",
      supplyPattern: "Ceiling HEPA modules with low-wall returns",
      returnPattern: "Low-wall return grilles",
      finalFilter: "Terminal HEPA H13",
      prefilterTrain: "Prefilter + bag filter + terminal HEPA",
      filterCoveragePercent: [15, 25],
      pressurizationPa: 10,
      pressurizationReserveCfmPerSqM: 2.4,
      targetCFM: 500,
      minCFMPerModule: 280,
      maxCFMPerModule: 750,
      maxSpacingFactor: 1.35,
      verticalReachFactor: 0.14
    },
    7: {
      achRange: [40, 60],
      designAch: 50,
      flowRegime: "Nonunidirectional / downflow-assisted cleanroom recirculation",
      supplyPattern: "Uniform ceiling HEPA field with low-wall returns",
      returnPattern: "Low-wall return grilles",
      finalFilter: "Terminal HEPA H13/H14",
      prefilterTrain: "Prefilter + bag filter + final HEPA",
      filterCoveragePercent: [25, 40],
      pressurizationPa: 12.5,
      pressurizationReserveCfmPerSqM: 3.0,
      targetCFM: 460,
      minCFMPerModule: 260,
      maxCFMPerModule: 650,
      maxSpacingFactor: 1.2,
      verticalReachFactor: 0.12
    },
    6: {
      achRange: [80, 120],
      designAch: 100,
      flowRegime: "Low-velocity downflow cleanroom recirculation",
      supplyPattern: "Dense HEPA ceiling module field with low-wall returns",
      returnPattern: "Low-wall return grilles or return plenum",
      finalFilter: "Terminal HEPA H14 / ULPA review",
      prefilterTrain: "Prefilter + bag filter + final HEPA / ULPA review",
      filterCoveragePercent: [50, 70],
      pressurizationPa: 15,
      pressurizationReserveCfmPerSqM: 3.8,
      targetCFM: 420,
      minCFMPerModule: 220,
      maxCFMPerModule: 520,
      maxSpacingFactor: 1.05,
      verticalReachFactor: 0.08
    },
    5: {
      velocityRangeMps: [0.3, 0.45],
      designVelocityMps: 0.38,
      flowRegime: "Unidirectional vertical downflow",
      supplyPattern: "Laminar HEPA / ULPA ceiling coverage across the room or critical bay",
      returnPattern: "Low-wall or perforated-floor returns",
      finalFilter: "HEPA H14 or ULPA final filtration",
      prefilterTrain: "Prefilter + bag filter + HEPA / ULPA final filtration",
      filterCoveragePercent: [85, 100],
      pressurizationPa: 15,
      pressurizationReserveCfmPerSqM: 4.8,
      targetCFM: 360,
      minCFMPerModule: 180,
      maxCFMPerModule: 450,
      maxSpacingFactor: 0.95,
      verticalReachFactor: 0.04
    }
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

  function normalizeOrientation(value, fallback) {
    const key = String(value || fallback || "SE").toUpperCase();
    return ORIENTATION_SEQUENCE.indexOf(key) !== -1 ? key : (fallback || "SE");
  }

  function orientationLabel(value) {
    return ORIENTATION_LABELS[normalizeOrientation(value, "SE")] || value || "—";
  }

  function safeJsonParseArray(value) {
    if (!value) {
      return [];
    }
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function readEnvelopeSeed() {
    return {
      len: valueOf("len", DEFAULT_INPUTS.len),
      wid: valueOf("wid", DEFAULT_INPUTS.wid),
      ht: valueOf("ht", DEFAULT_INPUTS.ht),
      window_count: valueOf("window_count", DEFAULT_INPUTS.window_count),
      window_config: valueOf("window_config", DEFAULT_INPUTS.window_config),
      win_area: valueOf("win_area", DEFAULT_INPUTS.win_area),
      win_orient: valueOf("win_orient", DEFAULT_INPUTS.win_orient),
      wall_count: valueOf("wall_count", DEFAULT_INPUTS.wall_count),
      wall_config: valueOf("wall_config", DEFAULT_INPUTS.wall_config),
      wall_exp: valueOf("wall_exp", DEFAULT_INPUTS.wall_exp),
      ceiling_area: valueOf("ceiling_area", DEFAULT_INPUTS.ceiling_area),
      floor_area: valueOf("floor_area", DEFAULT_INPUTS.floor_area)
    };
  }

  function orientationSelectOptions(selected) {
    const active = normalizeOrientation(selected, "SE");
    return ORIENTATION_SEQUENCE.map(function (orientation) {
      return '<option value="' + orientation + '"' + (orientation === active ? " selected" : "") + ">"
        + orientationLabel(orientation)
        + "</option>";
    }).join("");
  }

  function wallDisplayFace(orientation) {
    const normalized = normalizeOrientation(orientation, "S");
    if (normalized === "E") {
      return "east";
    }
    if (normalized === "W") {
      return "west";
    }
    if (normalized === "NE" || normalized === "N" || normalized === "NW") {
      return "north";
    }
    return "south";
  }

  function suggestedWallAreaForOrientation(length, width, height, orientation) {
    const face = wallDisplayFace(orientation);
    const wallSpan = face === "east" || face === "west" ? width : length;
    return roundTo(Math.max(wallSpan, 0) * Math.max(height, 0), 2);
  }

  function buildDefaultWindowEntries(seed, count, existingEntries) {
    const safeCount = clamp(count, 0, 12);
    const totalArea = Math.max(parseFloat(seed.win_area) || 0, 0);
    const fallbackOrientation = normalizeOrientation(seed.win_orient, "SE");
    const existing = Array.isArray(existingEntries) ? existingEntries : [];
    const perWindowArea = safeCount > 0 ? roundTo(totalArea / safeCount, 2) : 0;
    const rows = [];
    for (let index = 0; index < safeCount; index += 1) {
      const existingEntry = existing[index] || {};
      rows.push({
        area: Math.max(parseFloat(existingEntry.area), 0) || perWindowArea,
        orientation: normalizeOrientation(existingEntry.orientation, fallbackOrientation)
      });
    }
    return rows;
  }

  function buildDefaultWallEntries(seed, count, existingEntries) {
    const safeCount = clamp(count, 0, 12);
    const length = parseFloat(seed.len) || 0;
    const width = parseFloat(seed.wid) || 0;
    const height = parseFloat(seed.ht) || 0;
    const existing = Array.isArray(existingEntries) ? existingEntries : [];
    const rows = [];
    for (let index = 0; index < safeCount; index += 1) {
      const existingEntry = existing[index] || {};
      const fallbackOrientation = DEFAULT_WALL_ORIENTATIONS[index] || "S";
      const orientation = normalizeOrientation(existingEntry.orientation, fallbackOrientation);
      rows.push({
        area: Math.max(parseFloat(existingEntry.area), 0) || suggestedWallAreaForOrientation(length, width, height, orientation),
        orientation: orientation
      });
    }
    return rows;
  }

  function resolveEnvelopeCount(rawCount, fallbackCount) {
    const parsed = parseInt(rawCount, 10);
    if (Number.isFinite(parsed)) {
      return clamp(parsed, 0, 12);
    }
    return clamp(fallbackCount || 0, 0, 12);
  }

  function normalizeWindowEntries(seed) {
    const parsedEntries = safeJsonParseArray(seed.window_config);
    const legacyCount = resolveEnvelopeCount(
      seed.window_count,
      parsedEntries.length || ((parseFloat(seed.win_area) || 0) > 0 ? 1 : 0)
    );
    const defaultEntries = buildDefaultWindowEntries(seed, legacyCount, parsedEntries);
    return defaultEntries.map(function (entry) {
      return {
        area: roundTo(Math.max(parseFloat(entry.area) || 0, 0), 2),
        orientation: normalizeOrientation(entry.orientation, normalizeOrientation(seed.win_orient, "SE"))
      };
    });
  }

  function normalizeWallEntries(seed) {
    const parsedEntries = safeJsonParseArray(seed.wall_config);
    const legacyCount = resolveEnvelopeCount(
      seed.wall_count,
      parsedEntries.length || (parseInt(seed.wall_exp, 10) || 0)
    );
    const defaultEntries = buildDefaultWallEntries(seed, legacyCount, parsedEntries);
    return defaultEntries.map(function (entry) {
      return {
        area: roundTo(Math.max(parseFloat(entry.area) || 0, 0), 2),
        orientation: normalizeOrientation(entry.orientation, "S")
      };
    });
  }

  function areaByOrientation(entries) {
    return entries.reduce(function (accumulator, entry) {
      const key = normalizeOrientation(entry.orientation, "SE");
      accumulator[key] = roundTo((accumulator[key] || 0) + (parseFloat(entry.area) || 0), 2);
      return accumulator;
    }, {});
  }

  function dominantOrientationFromAreas(areaMap, fallback) {
    return ORIENTATION_SEQUENCE.reduce(function (best, orientation) {
      const value = areaMap[orientation] || 0;
      if (value > best.area) {
        return { orientation: orientation, area: value };
      }
      return best;
    }, { orientation: fallback || "SE", area: -1 }).orientation;
  }

  function summarizeOrientationAreas(areaMap, unit) {
    const rows = ORIENTATION_SEQUENCE.filter(function (orientation) {
      return (areaMap[orientation] || 0) > 0.001;
    }).map(function (orientation) {
      return orientation + " " + formatNumber(areaMap[orientation], 2) + (unit ? " " + unit : "");
    });
    return rows.length ? rows.join(" · ") : "None";
  }

  function windowRowMarkup(entry, index) {
    return '<div class="envelope-row">'
      + '<div class="envelope-index">W' + (index + 1) + "</div>"
      + '<div class="field"><label>AREA (m²)</label><input type="number" class="js-window-area" value="' + formatNumber(entry.area, 2) + '" step="0.1" min="0"></div>'
      + '<div class="field"><label>ORIENTATION</label><select class="js-window-orientation">' + orientationSelectOptions(entry.orientation) + "</select></div>"
      + "</div>";
  }

  function wallRowMarkup(entry, index) {
    return '<div class="envelope-row">'
      + '<div class="envelope-index">WL' + (index + 1) + "</div>"
      + '<div class="field"><label>AREA (m²)</label><input type="number" class="js-wall-area" value="' + formatNumber(entry.area, 2) + '" step="0.1" min="0"></div>'
      + '<div class="field"><label>ORIENTATION</label><select class="js-wall-orientation">' + orientationSelectOptions(entry.orientation) + "</select></div>"
      + "</div>";
  }

  function renderEnvelopeEditors(seed) {
    const windowList = byId("window-config-list");
    const wallList = byId("wall-config-list");
    if (!windowList || !wallList) {
      return;
    }
    const windows = normalizeWindowEntries(seed || readEnvelopeSeed());
    const walls = normalizeWallEntries(seed || readEnvelopeSeed());
    windowList.innerHTML = windows.length
      ? windows.map(windowRowMarkup).join("")
      : '<div class="envelope-empty">No windows entered for this room.</div>';
    wallList.innerHTML = walls.length
      ? walls.map(wallRowMarkup).join("")
      : '<div class="envelope-empty">No external walls entered for this room.</div>';
    syncEnvelopeConfigsFromUi();
  }

  function envelopeRowCount(listId) {
    const list = byId(listId);
    return list ? list.querySelectorAll(".envelope-row").length : 0;
  }

  function commitEnvelopeCount(fieldId) {
    const element = byId(fieldId);
    if (!element) {
      return;
    }
    const listId = fieldId === "window_count" ? "window-config-list" : "wall-config-list";
    const desiredCount = clamp(parseInt(element.value, 10) || 0, 0, 12);
    element.value = String(desiredCount);
    if (desiredCount !== envelopeRowCount(listId)) {
      renderEnvelopeEditors(readEnvelopeSeed());
      return;
    }
    syncEnvelopeConfigsFromUi();
  }

  function syncEnvelopeSummaryChips(windowEntries, wallEntries) {
    const windowChip = byId("window-summary-chip");
    const wallChip = byId("wall-summary-chip");
    if (windowChip) {
      const windowAreaMap = areaByOrientation(windowEntries);
      const windowCount = windowEntries.length;
      const totalWindowArea = windowEntries.reduce(function (sum, entry) {
        return sum + (parseFloat(entry.area) || 0);
      }, 0);
      windowChip.textContent = windowCount
        ? windowCount + " window" + (windowCount > 1 ? "s" : "") + " · " + formatNumber(totalWindowArea, 2) + " m² · " + summarizeOrientationAreas(windowAreaMap, "m²")
        : "No windows entered";
    }
    if (wallChip) {
      const wallAreaMap = areaByOrientation(wallEntries);
      const wallCount = wallEntries.length;
      const totalWallArea = wallEntries.reduce(function (sum, entry) {
        return sum + (parseFloat(entry.area) || 0);
      }, 0);
      wallChip.textContent = wallCount
        ? wallCount + " wall" + (wallCount > 1 ? "s" : "") + " · " + formatNumber(totalWallArea, 2) + " m² gross · " + summarizeOrientationAreas(wallAreaMap, "m²")
        : "No external walls entered";
    }
  }

  function syncEnvelopeConfigsFromUi() {
    const windowList = byId("window-config-list");
    const wallList = byId("wall-config-list");
    if (!windowList || !wallList) {
      return;
    }

    const windows = Array.from(windowList.querySelectorAll(".envelope-row")).map(function (row) {
      return {
        area: roundTo(Math.max(parseFloat((row.querySelector(".js-window-area") || {}).value) || 0, 0), 2),
        orientation: normalizeOrientation((row.querySelector(".js-window-orientation") || {}).value, "SE")
      };
    }).filter(function (entry) {
      return entry.area > 0.001 || entry.orientation;
    });

    const walls = Array.from(wallList.querySelectorAll(".envelope-row")).map(function (row) {
      return {
        area: roundTo(Math.max(parseFloat((row.querySelector(".js-wall-area") || {}).value) || 0, 0), 2),
        orientation: normalizeOrientation((row.querySelector(".js-wall-orientation") || {}).value, "S")
      };
    }).filter(function (entry) {
      return entry.area > 0.001 || entry.orientation;
    });

    const windowAreaMap = areaByOrientation(windows);
    const totalWindowArea = windows.reduce(function (sum, entry) {
      return sum + (parseFloat(entry.area) || 0);
    }, 0);
    const dominantWindowOrientation = dominantOrientationFromAreas(windowAreaMap, valueOf("win_orient", "SE"));

    setValue("window_count", String(windows.length));
    setValue("wall_count", String(walls.length));
    setValue("window_config", JSON.stringify(windows));
    setValue("wall_config", JSON.stringify(walls));
    setValue("win_area", String(roundTo(totalWindowArea, 2)));
    setValue("win_orient", dominantWindowOrientation);
    setValue("wall_exp", String(walls.length));
    syncEnvelopeSummaryChips(windows, walls);
  }

  function syncPlanAreaFields(force) {
    ["ceiling_area", "floor_area"].forEach(function (fieldId) {
      const element = byId(fieldId);
      if (!element) {
        return;
      }
      const plannedArea = roundTo((numberOf("len", parseFloat(DEFAULT_INPUTS.len)) || 0) * (numberOf("wid", parseFloat(DEFAULT_INPUTS.wid)) || 0), 2);
      const current = parseFloat(element.value);
      const lastAuto = parseFloat(element.dataset.autoValue || "");
      const manuallyOverridden = element.dataset.manual === "true";
      if (force || !Number.isFinite(current) || current <= 0 || !manuallyOverridden || (Number.isFinite(lastAuto) && Math.abs(current - lastAuto) < 0.05)) {
        element.value = formatNumber(plannedArea, 2);
        element.dataset.autoValue = String(plannedArea);
        if (force) {
          element.dataset.manual = "false";
        }
      }
    });
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

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function safeDiv(numerator, denominator, fallback) {
    return denominator ? numerator / denominator : (fallback || 0);
  }

  function assertAirflowInvariant(condition, message) {
    if (!condition) {
      throw new Error(message || "Airflow hierarchy validation failed.");
    }
  }

  function airflowBreakdown(result) {
    const data = result || {};
    const airflows = data.airflows || {};
    const cooling = airflows.cooling || {};
    const recirculation = airflows.recirculation || {};
    const ventilation = airflows.ventilation || {};
    const returnAir = airflows.returnAir || data.returnAir || {};
    const room = airflows.room || {};
    const coolingAirflowCfm = Math.max(
      cooling.airflowCfm != null ? cooling.airflowCfm : (data.cfm_cooling_coil || data.Q_coil_cfm || data.cfm_conditioned || data.Q_sup_cfm || 0),
      0
    );
    const recirculationAirflowCfm = Math.max(
      recirculation.airflowCfm != null ? recirculation.airflowCfm : (data.cfm_conditioned || data.Q_sup_cfm || coolingAirflowCfm),
      0
    );
    const recirculationAdditionalAirflowCfm = Math.max(
      recirculation.additionalAirflowCfm != null ? recirculation.additionalAirflowCfm : (data.cfm_neutral_recirculation || Math.max(recirculationAirflowCfm - coolingAirflowCfm, 0)),
      0
    );
    const dedicatedVentilationAirflowCfm = Math.max(
      ventilation.dedicatedAirflowCfm != null ? ventilation.dedicatedAirflowCfm : (data.cfm_dedicated_ventilation || 0),
      0
    );
    const processAirflowCfm = Math.max(
      ventilation.processAirflowCfm != null ? ventilation.processAirflowCfm : (data.cfm_process_excess || 0),
      0
    );
    const ventilationAirflowCfm = Math.max(
      ventilation.airflowCfm != null ? ventilation.airflowCfm : (dedicatedVentilationAirflowCfm + processAirflowCfm),
      0
    );
    const totalOutdoorAirCfm = Math.max(
      ventilation.totalOutdoorAirCfm != null ? ventilation.totalOutdoorAirCfm : (data.fresh_total_cfm || 0),
      0
    );
    const ventilationMixedIntoCoolingAirflowCfm = Math.max(
      ventilation.mixedIntoCoolingAirflowCfm != null ? ventilation.mixedIntoCoolingAirflowCfm : ((data.psychro && data.psychro.coilOutdoorAirCfm) || 0),
      0
    );
    const totalRoomAirflowCfm = Math.max(
      room.totalAirflowCfm != null ? room.totalAirflowCfm : (data.cfm_final || (recirculationAirflowCfm + ventilationAirflowCfm)),
      0
    );
    const returnAirToCoilCfm = Math.max(
      returnAir.toCoilCfm != null ? returnAir.toCoilCfm : (data.cfm_primary_return || coolingAirflowCfm),
      0
    );
    const returnAirBypassCfm = Math.max(
      returnAir.bypassRecirculationCfm != null ? returnAir.bypassRecirculationCfm : (data.cfm_neutral_recirculation || Math.max(recirculationAirflowCfm - returnAirToCoilCfm, 0)),
      0
    );
    const returnAirVentilationPathCfm = Math.max(
      returnAir.ventilationPathCfm != null ? returnAir.ventilationPathCfm : ventilationAirflowCfm,
      0
    );
    const totalRoomReturnAirflowCfm = Math.max(
      returnAir.totalRoomReturnCfm != null ? returnAir.totalRoomReturnCfm : (returnAirToCoilCfm + returnAirBypassCfm + returnAirVentilationPathCfm),
      0
    );
    const achRecirculation = Math.max(
      room.achRecirculation != null ? room.achRecirculation : (data.ach_recirculation || 0),
      0
    );
    const achTotalRoom = Math.max(
      room.achTotalRoom != null ? room.achTotalRoom : (data.ach_total_room || data.ach || 0),
      0
    );
    const achCompliance = Math.max(
      room.achCompliance != null ? room.achCompliance : (data.ach || achTotalRoom),
      0
    );

    return {
      coolingAirflowCfm: coolingAirflowCfm,
      recirculationAirflowCfm: recirculationAirflowCfm,
      recirculationAdditionalAirflowCfm: recirculationAdditionalAirflowCfm,
      ventilationAirflowCfm: ventilationAirflowCfm,
      dedicatedVentilationAirflowCfm: dedicatedVentilationAirflowCfm,
      processAirflowCfm: processAirflowCfm,
      totalOutdoorAirCfm: totalOutdoorAirCfm,
      ventilationMixedIntoCoolingAirflowCfm: ventilationMixedIntoCoolingAirflowCfm,
      totalRoomAirflowCfm: totalRoomAirflowCfm,
      returnAirToCoilCfm: returnAirToCoilCfm,
      returnAirBypassCfm: returnAirBypassCfm,
      returnAirVentilationPathCfm: returnAirVentilationPathCfm,
      totalRoomReturnAirflowCfm: totalRoomReturnAirflowCfm,
      achRecirculation: achRecirculation,
      achTotalRoom: achTotalRoom,
      achCompliance: achCompliance
    };
  }

  function buildFinalDesign(result) {
    const data = result || {};
    const flows = airflowBreakdown(data);
    const selection = data.zoneAhuStrategy && data.zoneAhuStrategy.aggregateSelection
      ? data.zoneAhuStrategy.aggregateSelection
      : data.equipmentSelection || {};
    const ahu = selection.ahu || {};
    const validation = data.validation || {};
    const designConstraints = data.designConstraints || {};
    const zoneDuctPlan = data.zoneDuctPlan || {};
    const coolingFanKW = Math.max(finiteOr(data.cooling_fan_kw, data.systems && data.systems.cooling && data.systems.cooling.fanKW || 0), 0);
    const recirculationFanKW = Math.max(finiteOr(data.recirculation_fan_kw, data.systems && data.systems.recirculation && data.systems.recirculation.fanKW || 0), 0);
    const ventilationFanKW = flows.ventilationAirflowCfm > 0
      ? Math.max(finiteOr(data.ventilation_fan_kw, data.systems && data.systems.ventilation && data.systems.ventilation.fanKW || 0), 0)
      : 0;
    const totalFanKW = roundTo(coolingFanKW + recirculationFanKW + ventilationFanKW, 2);
    const geometryConstraintStatus = designConstraints.status || "APPROVED";
    const ductConstraintStatus = zoneDuctPlan.overallStatus === "REJECT"
      ? "REJECTED"
      : zoneDuctPlan.overallStatus === "WARNING"
        ? "REVIEW"
        : "APPROVED";
    const equipmentSelectionStatus = ahu.adequate === false || (ahu.capacityTR && data.tr_final && ahu.capacityTR < data.tr_final)
      ? "NON_COMPLIANT"
      : "APPROVED";
    const airflowComplianceStatus = validation.status || "REVIEW";
    const overallValidationStatus = [geometryConstraintStatus, ductConstraintStatus, equipmentSelectionStatus, airflowComplianceStatus].some(function (status) {
      return status === "NON_COMPLIANT" || status === "REJECTED";
    })
      ? "NON_COMPLIANT"
      : [geometryConstraintStatus, ductConstraintStatus, equipmentSelectionStatus, airflowComplianceStatus].some(function (status) {
        return status === "REVIEW" || status === "WARNING";
      })
        ? "REVIEW"
        : "COMPLIANT";

    return {
      calculationId: data.calculationId || "",
      designBasis: data.cleanroom ? "cleanroom" : normalizedDesignMode(data.inputs && data.inputs.design_mode),
      systemType: data.cleanroom ? "cleanroom" : data.airsideProfile && data.airsideProfile.type || "Comfort",
      complianceMode: data.complianceMode || "comfort_ventilation",
      achRequirementMode: data.achRequirementMode || "advisory",
      achMandatory: !!data.achMandatory,
      airflow: {
        coolingCFM: roundTo(flows.coolingAirflowCfm, 2),
        recirculationCFM: roundTo(flows.recirculationAirflowCfm, 2),
        ventilationCFM: roundTo(flows.ventilationAirflowCfm, 2),
        dedicatedVentilationCFM: roundTo(flows.dedicatedVentilationAirflowCfm, 2),
        processMakeupAirCFM: roundTo(flows.processAirflowCfm, 2),
        totalRoomSupplyCFM: roundTo(flows.totalRoomAirflowCfm, 2),
        outdoorAirThroughCoilCFM: roundTo(flows.ventilationMixedIntoCoolingAirflowCfm, 2),
        returnAirToCoilCFM: roundTo(flows.returnAirToCoilCfm, 2),
        bypassRecirculationCFM: roundTo(flows.returnAirBypassCfm, 2),
        ach: roundTo(flows.achCompliance, 2),
        achRequired: roundTo(data.ach_required || 0, 2)
      },
      fans: {
        coolingFanKW: roundTo(coolingFanKW, 2),
        recirculationFanKW: roundTo(recirculationFanKW, 2),
        ventilationFanKW: roundTo(ventilationFanKW, 2),
        totalFanKW: totalFanKW,
        specificFanPowerKWPerTR: roundTo(safeDiv(totalFanKW, Math.max(data.tr_final || 0, 0.1), 0), 2),
        installedMotorKW: roundTo(data.motor_kw || selection.recommendedMotorKW || 0, 2),
        operatingPowerBasis: "operating electrical fan kW; installed motor kW is not used for annual energy unless explicitly selected"
      },
      loads: {
        totalLoadW: roundTo(data.totalLoad || 0, 1),
        sensibleW: roundTo(data.totalS || 0, 1),
        latentW: roundTo(data.totalL || 0, 1),
        trDesign: roundTo(data.tr_design || data.tr_calc || 0, 2),
        trFinal: roundTo(data.tr_final || 0, 2)
      },
      equipment: {
        selectedAhuModel: ahu.model || "",
        selectedAhuTR: roundTo(ahu.capacityTR || data.tr_catalog_equipment || 0, 2),
        selectedFanType: selection.fan && selection.fan.type || ""
      },
      esp: {
        totalPa: roundTo(data.total_esp || 0, 1),
        ductFrictionPa: roundTo(data.duct_friction || 0, 1),
        fittingLossPa: roundTo(data.fitting_loss || 0, 1),
        equipmentLossPa: roundTo(data.equipment_loss || 0, 1),
        ductFrictionPaPerM: roundTo(safeDiv(data.duct_friction || 0, Math.max((data.duct_len_ft || 0) * 0.3048, 0.1), 0), 2)
      },
      statuses: {
        geometryConstraintStatus: geometryConstraintStatus,
        ductConstraintStatus: ductConstraintStatus,
        equipmentSelectionStatus: equipmentSelectionStatus,
        airflowComplianceStatus: airflowComplianceStatus,
        overallValidationStatus: overallValidationStatus
        ,
        ventilationComplianceStatus: data.ventilationComplianceStatus || "COMPLIANT",
        achComplianceStatus: data.achComplianceStatus || "ADVISORY"
      }
    };
  }

  function finalEnergyReport(result) {
    return result && result.finalEnergyResult || null;
  }

  function normalizeEnergyReportForFinalDesign(report, result) {
    if (!report) {
      return null;
    }
    const normalized = copyJson(report);
    const finalDesign = result && result.finalDesign ? result.finalDesign : buildFinalDesign(result || {});
    const systemInput = Object.assign({}, normalized.system_input || {});
    systemInput.conditioned_airflow_cfm = finalDesign.airflow.recirculationCFM;
    systemInput.process_airflow_cfm = finalDesign.airflow.ventilationCFM;
    systemInput.peak_conditioned_fan_kw = finalDesign.fans.recirculationFanKW;
    normalized.system_input = systemInput;
    normalized.finalDesignCalculationId = finalDesign.calculationId || "";
    normalized.peak_kw_per_tr = normalized.peak_kw_per_tr || normalized.system_efficiency || safeDiv(normalized.peak_power_kw || 0, finalDesign.loads.trFinal || 0, 0);
    normalized.annual_kwh_per_tr_year = normalized.annual_kwh_per_tr_year || safeDiv(normalized.annual_energy_kwh || 0, finalDesign.loads.trFinal || 0, 0);
    return normalized;
  }

  function validationSeverityRank(severity) {
    const normalized = String(severity || "").toUpperCase();
    return normalized === "CRITICAL" || normalized === "ERROR" ? 3
      : normalized === "WARNING" || normalized === "REVIEW" ? 2
      : normalized === "ADVISORY" || normalized === "INFO" ? 1
      : 0;
  }

  function validationStatusFromFindings(findings) {
    const list = Array.isArray(findings) ? findings : [];
    const hasCritical = list.some(function (finding) {
      return validationSeverityRank(finding.severity) >= 3;
    });
    const hasWarning = list.some(function (finding) {
      return validationSeverityRank(finding.severity) === 2;
    });
    return hasCritical ? "NON_COMPLIANT" : hasWarning ? "REVIEW" : "COMPLIANT";
  }

  function buildValidationState(result) {
    const data = result || {};
    const finalDesign = data.finalDesign || buildFinalDesign(data);
    const rawValidation = data.validation || {};
    const findings = [];

    function addFinding(category, severity, code, title, detail) {
      findings.push({
        category: category,
        severity: severity,
        code: code,
        title: title,
        detail: detail,
        complianceStatus: severity === "CRITICAL" ? "NON_COMPLIANT" : severity === "WARNING" ? "REVIEW" : "ADVISORY"
      });
    }

    (Array.isArray(rawValidation.findings) ? rawValidation.findings : []).forEach(function (finding) {
      findings.push(Object.assign({
        category: "airflow_compliance",
        severity: String(finding.severity || "advisory").toUpperCase()
      }, finding));
    });

    const statusCategories = {
      geometry: finalDesign.statuses.geometryConstraintStatus,
      duct: finalDesign.statuses.ductConstraintStatus,
      equipment: finalDesign.statuses.equipmentSelectionStatus,
      airflow: finalDesign.statuses.airflowComplianceStatus,
      psychrometric: data.psychro && data.psychro.converged === false ? "NON_COMPLIANT" : "COMPLIANT",
      energyModel: data.finalEnergyResult ? "COMPLIANT" : "REVIEW",
      optimization: data.designOptimization && data.designOptimization.optimizationValidityStatus ? data.designOptimization.optimizationValidityStatus : "ADVISORY"
    };

    Object.keys(statusCategories).forEach(function (category) {
      const status = String(statusCategories[category] || "").toUpperCase();
      if (status === "NON_COMPLIANT" || status === "REJECTED") {
        addFinding(category, "CRITICAL", category + "_non_compliant", category + " constraint is non-compliant", "The finalized design state marks " + category + " as " + status + ".");
      } else if (status === "REVIEW" || status === "WARNING") {
        addFinding(category, "WARNING", category + "_review", category + " constraint requires review", "The finalized design state marks " + category + " as " + status + ".");
      }
    });

    const normalizedStatus = validationStatusFromFindings(findings);
    return {
      status: normalizedStatus,
      summary: rawValidation.summary || (normalizedStatus === "COMPLIANT" ? "Finalized design checks are internally consistent." : "Finalized design requires engineering review before issue."),
      findings: findings,
      criticalCount: findings.filter(function (finding) { return validationSeverityRank(finding.severity) >= 3; }).length,
      warningCount: findings.filter(function (finding) { return validationSeverityRank(finding.severity) === 2; }).length,
      advisoryCount: findings.filter(function (finding) { return validationSeverityRank(finding.severity) === 1; }).length,
      confidenceScore: rawValidation.confidenceScore != null ? rawValidation.confidenceScore : 0.82,
      assumptions: Array.isArray(rawValidation.assumptions) ? rawValidation.assumptions.slice() : []
    };
  }

  function assertNearMetric(errors, label, left, right, tolerance) {
    const a = Number(left);
    const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return;
    }
    if (Math.abs(a - b) > Math.max(tolerance || 0, Math.abs(b) * 0.01)) {
      errors.push(label + " mismatch: " + roundTo(a, 2) + " vs " + roundTo(b, 2) + ".");
    }
  }

  function validateFinalizedConsistency(result) {
    const data = result || {};
    const finalDesign = data.finalDesign;
    const finalEnergy = data.finalEnergyResult || null;
    const errors = [];
    if (!finalDesign) {
      errors.push("Missing authoritative finalDesign object.");
    }
    if (!data.validationState) {
      errors.push("Missing centralized validationState object.");
    }
    if (finalEnergy) {
      const input = finalEnergy.system_input || {};
      assertNearMetric(errors, "energy conditioned airflow", input.conditioned_airflow_cfm, finalDesign.airflow.recirculationCFM, Math.max(finalDesign.airflow.recirculationCFM * 0.01, 1));
      assertNearMetric(errors, "energy process airflow", input.process_airflow_cfm, finalDesign.airflow.ventilationCFM, Math.max(finalDesign.airflow.ventilationCFM * 0.01, 1));
      assertNearMetric(errors, "energy conditioned fan kW", input.peak_conditioned_fan_kw, finalDesign.fans.recirculationFanKW, 0.05);
      if (finalEnergy.finalDesignCalculationId && finalDesign.calculationId && finalEnergy.finalDesignCalculationId !== finalDesign.calculationId) {
        errors.push("Energy result calculation id does not match finalDesign.");
      }
    }
    if (data.designOptimization && data.designOptimization.baseSystemSummary) {
      const base = data.designOptimization.baseSystemSummary;
      assertNearMetric(errors, "optimization base cooling airflow", base.coolingAirflowCfm, finalDesign.airflow.coolingCFM, Math.max(finalDesign.airflow.coolingCFM * 0.01, 1));
      assertNearMetric(errors, "optimization base recirculation airflow", base.recirculationAirflowCfm, finalDesign.airflow.recirculationCFM, Math.max(finalDesign.airflow.recirculationCFM * 0.01, 1));
      assertNearMetric(errors, "optimization base ventilation airflow", base.ventilationAirflowCfm, finalDesign.airflow.ventilationCFM, Math.max(finalDesign.airflow.ventilationCFM * 0.01, 1));
      assertNearMetric(errors, "optimization base fan kW", base.totalFanKW, finalDesign.fans.totalFanKW, 0.05);
    }
    return {
      ok: errors.length === 0,
      errors: errors,
      status: errors.length ? "FAILED" : "PASSED"
    };
  }

  function ensureFinalizedResult(result, options) {
    const settings = options || {};
    const data = result || {};
    data.finalDesign = data.finalDesign || buildFinalDesign(data);
    const preNormalizeErrors = [];
    if (settings.throwOnFailure && data.finalEnergyResult) {
      const input = data.finalEnergyResult.system_input || {};
      assertNearMetric(preNormalizeErrors, "energy conditioned airflow", input.conditioned_airflow_cfm, data.finalDesign.airflow.recirculationCFM, Math.max(data.finalDesign.airflow.recirculationCFM * 0.01, 1));
      assertNearMetric(preNormalizeErrors, "energy process airflow", input.process_airflow_cfm, data.finalDesign.airflow.ventilationCFM, Math.max(data.finalDesign.airflow.ventilationCFM * 0.01, 1));
      assertNearMetric(preNormalizeErrors, "energy conditioned fan kW", input.peak_conditioned_fan_kw, data.finalDesign.fans.recirculationFanKW, 0.05);
    }
    if (data.finalEnergyResult) {
      data.finalEnergyResult = normalizeEnergyReportForFinalDesign(data.finalEnergyResult, data);
    } else if (settings.promoteEnergySimulation && data.energySimulation) {
      data.finalEnergyResult = normalizeEnergyReportForFinalDesign(data.energySimulation, data);
    }
    if (data.finalEnergyResult) {
      data.energySimulation = data.finalEnergyResult;
    }
    data.validationState = buildValidationState(data);
    data.reportConsistency = validateFinalizedConsistency(data);
    if (preNormalizeErrors.length) {
      data.reportConsistency = {
        ok: false,
        errors: preNormalizeErrors.concat(data.reportConsistency.errors || []),
        status: "FAILED"
      };
    }
    if (settings.throwOnFailure && !data.reportConsistency.ok) {
      throw new Error("Report consistency validation failed: " + data.reportConsistency.errors.join(" "));
    }
    return data;
  }

  function calculateShrRatio(sensibleLoad, latentLoad, fallback) {
    const core = engineeringCoreApi();
    if (core && typeof core.calculateShrRatio === "function") {
      return core.calculateShrRatio(sensibleLoad, latentLoad, fallback);
    }
    const sensible = Number.isFinite(sensibleLoad) ? sensibleLoad : 0;
    const latent = Number.isFinite(latentLoad) ? latentLoad : 0;
    const total = sensible + latent;

    if (total <= 0) {
      return clamp(fallback || 0, 0, 1);
    }

    return clamp(safeDiv(sensible, total, fallback || 0), 0, 1);
  }

  function normalizedDesignMode(value) {
    const raw = String(value || "comfort").toLowerCase();
    const allowed = {
      comfort: true,
      ach_driven: true,
      cleanroom: true,
      healthcare: true,
      laboratory: true,
      process_industrial: true
    };
    return allowed[raw] ? raw : "comfort";
  }

  function complianceModeForInputs(inputs, airsideProfile) {
    const mode = normalizedDesignMode(inputs && inputs.design_mode);
    if (mode === "cleanroom" || airsideProfile && airsideProfile.cleanroomMode) {
      return "cleanroom";
    }
    if (mode === "ach_driven" || mode === "healthcare" || mode === "laboratory" || mode === "process_industrial") {
      return mode;
    }
    const profileType = String(airsideProfile && airsideProfile.type || "").toLowerCase();
    if (profileType.indexOf("industrial") !== -1 || airsideProfile && airsideProfile.processVentilationStrategy) {
      return "process_industrial";
    }
    return "comfort_ventilation";
  }

  function achRequirementModeForInputs(inputs, complianceMode) {
    const raw = String(inputs && inputs.ach_requirement_mode || inputs && inputs.achRequirementMode || "").toLowerCase();
    if (raw === "mandatory" || raw === "disabled" || raw === "advisory") {
      return raw;
    }
    return complianceMode === "comfort_ventilation" ? "advisory" : "mandatory";
  }

  function normalizeIsoClass(value) {
    const numeric = parseInt(String(value || "").replace(/[^0-9]/g, ""), 10);
    return CLEANROOM_TEMPLATE_MAP[numeric] ? numeric : 8;
  }

  function cleanroomLabel(classNumber) {
    return "ISO " + normalizeIsoClass(classNumber);
  }

  function isoParticleLimitPerM3(classNumber, particleSizeMicron) {
    const isoClass = normalizeIsoClass(classNumber);
    const size = Math.min(Math.max(Number(particleSizeMicron) || 0.5, 0.1), 5);
    return Math.round(Math.pow(10, isoClass) * Math.pow(0.1 / size, 2.08));
  }

  function cleanroomScopeSummary(cleanroom) {
    const profile = cleanroom || {};
    return profile.classLabel
      ? profile.classLabel + " (" + (profile.stateLabel || "operational") + ")"
      : "Cleanroom design mode";
  }

  function buildCleanroomDesignContext(inputs, area, height) {
    if (normalizedDesignMode(inputs && inputs.design_mode) !== "cleanroom") {
      return null;
    }

    const roomArea = Math.max(area || 0, 0);
    const roomHeight = Math.max(height || parseFloat(inputs && inputs.ht) || 3, 2.7);
    const roomVolume = roomArea * roomHeight;
    const classNumber = normalizeIsoClass(inputs && inputs.cleanroom_iso_class);
    const template = CLEANROOM_TEMPLATE_MAP[classNumber] || CLEANROOM_TEMPLATE_MAP[8];
    const state = String(inputs && inputs.cleanroom_state || "operational").toLowerCase() === "at_rest"
      ? "at_rest"
      : "operational";
    const pressureMode = String(inputs && inputs.cleanroom_pressure_mode || "positive").toLowerCase() === "negative"
      ? "negative"
      : String(inputs && inputs.cleanroom_pressure_mode || "positive").toLowerCase() === "neutral"
        ? "neutral"
        : "positive";
    const stateFactor = state === "at_rest" ? 0.88 : 1;
    const velocityRangeMps = template.velocityRangeMps
      ? template.velocityRangeMps.map(function (velocity) { return roundTo(velocity * stateFactor, 3); })
      : null;
    const achRange = velocityRangeMps
      ? velocityRangeMps.map(function (velocity) {
          return roundTo(velocity * 3600 / Math.max(roomHeight, 0.1), 0);
        })
      : template.achRange.map(function (achValue) {
          return roundTo(achValue * stateFactor, 0);
        });
    const designAch = velocityRangeMps
      ? roundTo((template.designVelocityMps || velocityRangeMps[0]) * stateFactor * 3600 / Math.max(roomHeight, 0.1), 0)
      : roundTo((template.designAch || ((achRange[0] + achRange[1]) / 2)) * stateFactor, 0);
    const designAirflowCfm = velocityRangeMps
      ? roundTo(((template.designVelocityMps || velocityRangeMps[0]) * stateFactor * roomArea) / CFM_TO_M3S, 0)
      : roundTo(roomVolume * designAch / (3600 * CFM_TO_M3S), 0);
    const pressureMagnitudePa = pressureMode === "positive"
      ? template.pressurizationPa
      : pressureMode === "negative"
        ? Math.max(8, template.pressurizationPa)
        : 0;
    const pressurizationReserveCfm = pressureMode === "neutral"
      ? 0
      : roundTo(roomArea * (template.pressurizationReserveCfmPerSqM || 0), 0);
    const coverageRange = template.filterCoveragePercent || [0, 0];
    const zoneLimits = classNumber <= 6
      ? {
          maxZoneArea: 95,
          maxZoneLength: 10,
          maxZoneWidth: 8,
          maxZoneConditionedCFM: classNumber <= 5 ? 7000 : 9000,
          maxZoneTR: 18,
          maxZones: 8
        }
      : {
          maxZoneArea: 150,
          maxZoneLength: 12,
          maxZoneWidth: 10,
          maxZoneConditionedCFM: classNumber === 7 ? 11000 : 14000,
          maxZoneTR: 22,
          maxZones: 8
        };

    return {
      enabled: true,
      classNumber: classNumber,
      classLabel: cleanroomLabel(classNumber),
      state: state,
      stateLabel: state === "at_rest" ? "At-rest" : "Operational",
      pressureMode: pressureMode,
      pressureLabel: pressureMode === "negative" ? "Negative containment" : pressureMode === "neutral" ? "Neutral" : "Positive cascade",
      pressurePa: pressureMode === "negative" ? -pressureMagnitudePa : pressureMagnitudePa,
      pressurizationReserveCfm: pressurizationReserveCfm,
      achRangeMin: roundTo(Math.min.apply(null, achRange), 0),
      achRangeMax: roundTo(Math.max.apply(null, achRange), 0),
      designAch: roundTo(designAch, 0),
      designAirflowCfm: roundTo(designAirflowCfm, 0),
      velocityRangeMps: velocityRangeMps,
      designVelocityMps: template.designVelocityMps ? roundTo(template.designVelocityMps * stateFactor, 2) : 0,
      flowRegime: template.flowRegime,
      supplyPattern: template.supplyPattern,
      returnPattern: template.returnPattern,
      finalFilter: template.finalFilter,
      prefilterTrain: template.prefilterTrain,
      filterCoverageMin: coverageRange[0],
      filterCoverageMax: coverageRange[1],
      targetCFM: template.targetCFM,
      minCFMPerModule: template.minCFMPerModule,
      maxCFMPerModule: template.maxCFMPerModule,
      maxSpacingFactor: template.maxSpacingFactor,
      verticalReachFactor: template.verticalReachFactor,
      zoneLimits: zoneLimits,
      particleLimits: {
        particles_0_5um_m3: isoParticleLimitPerM3(classNumber, 0.5),
        particles_5_0um_m3: isoParticleLimitPerM3(classNumber, 5.0)
      },
      note: "ISO 14644-1 classification is particle-concentration based. The airflow, filter coverage, and pressure values here are HVAC sizing templates for early cleanroom design, not certification by themselves.",
      complianceNote: "Plan particle count testing, HEPA integrity testing, airflow balancing, and pressure-cascade qualification before issue for construction."
    };
  }

  function specificFanPowerTargets(airsideProfile, designEspPa) {
    const profile = airsideProfile || {};
    const esp = Math.max(designEspPa || 0, 0);
    let advisory = 0.9;
    let warning = 1.05;

    if (profile.cleanroomMode) {
      advisory = 1.1;
      warning = 1.3;
    }
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

  function dewPoint(tempC, relativeHumidity) {
    const rh = clamp(relativeHumidity || 0, 1, 100);
    const a = 17.27;
    const b = 237.3;
    const gamma = Math.log(rh / 100) + (a * tempC) / (b + tempC);
    return (b * gamma) / Math.max(a - gamma, 0.001);
  }

  function wetBulb(tempC, relativeHumidity) {
    const rh = clamp(relativeHumidity || 0, 1, 100);
    return tempC * Math.atan(0.151977 * Math.pow(rh + 8.313659, 0.5))
      + Math.atan(tempC + rh)
      - Math.atan(rh - 1.676331)
      + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
      - 4.686035;
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

  function airflowDesignBounds(airsideProfile) {
    const isIndustrial = airsideProfile && airsideProfile.type === "Industrial / process";
    const isCleanroom = !!(airsideProfile && airsideProfile.cleanroomMode);
    return isIndustrial
      ? {
          baseDeltaT: 10.5,
          minDeltaT: 9,
          maxDeltaT: 13,
          minSupplyTemp: 10.5
        }
      : isCleanroom
        ? {
            baseDeltaT: 7.5,
            minDeltaT: 6,
            maxDeltaT: 9,
            minSupplyTemp: 13
          }
      : {
          baseDeltaT: 9,
          minDeltaT: 8,
          maxDeltaT: 11.5,
          minSupplyTemp: 11.5
        };
  }

  function ductSize(cfm, velocityFpm) {
    const airflow = Math.max(cfm || 0, 0);
    const velocity = Math.max(velocityFpm || 1, 1);
    const areaFt2 = airflow / velocity;
    const diaIn = Math.sqrt((4 * areaFt2) / Math.PI) * 12;
    const standards = [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48, 54, 60, 66, 72, 78];
    const selectedDiameter = standards.find(function (diameter) {
      return diameter >= diaIn;
    }) || Math.ceil(diaIn / 6) * 6;
    const rectAreaIn2 = areaFt2 * 144;
    const rectW = Math.ceil(Math.sqrt(rectAreaIn2 * 1.5) / 2) * 2;
    const rectH = Math.ceil((rectAreaIn2 / Math.max(rectW, 1)) / 2) * 2;
    return {
      area_ft2: areaFt2,
      dia_in: selectedDiameter,
      rectW: rectW,
      rectH: rectH
    };
  }

  function selectAirflowDesignBasis(indoorDryBulb, indoorRelativeHumidity, roomShr, ceilingHeight, airsideProfile) {
    const isIndustrial = airsideProfile && airsideProfile.type === "Industrial / process";
    const isCleanroom = !!(airsideProfile && airsideProfile.cleanroomMode);
    const bounds = airflowDesignBounds(airsideProfile);
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
        : isCleanroom
          ? "Cleanroom thermal airflow basis uses a lower room-to-supply differential because filtration-driven recirculation usually dominates the final air quantity."
        : "Comfort airflow basis uses a moderate room-to-supply temperature differential for occupied-zone air distribution."
    };
  }

  function selectPreferredReserveMargin(safetyPercent, airsideProfile, trDesign) {
    const baseMargin = clamp((safetyPercent || 10) / 100, 0.06, 0.12);
    if (airsideProfile && airsideProfile.cleanroomMode) {
      return clamp(Math.min(baseMargin, 0.1), 0.07, 0.1);
    }
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

  function activeOptimizationScenario(runtimeOptions) {
    return runtimeOptions && runtimeOptions.optimizationScenario
      ? runtimeOptions.optimizationScenario
      : null;
  }

  function activeOptimizationOverrides(runtimeOptions) {
    const scenario = activeOptimizationScenario(runtimeOptions);
    return scenario && scenario.overrides ? scenario.overrides : {};
  }

  function applyOptimizationAirflowStrategy(baseStrategy, indoorDryBulb, airsideProfile, runtimeOptions) {
    const scenario = activeOptimizationScenario(runtimeOptions);
    const overrides = activeOptimizationOverrides(runtimeOptions);
    const airflowStrategy = overrides.airflowStrategy || {};
    const bounds = airflowDesignBounds(airsideProfile);
    let roomDeltaTDesign = finiteOr(baseStrategy && baseStrategy.roomDeltaTDesign, bounds.baseDeltaT);
    let supplyTempDesign = finiteOr(baseStrategy && baseStrategy.supplyTempDesign, indoorDryBulb - roomDeltaTDesign);
    let designBasisOverridden = false;

    if (Number.isFinite(airflowStrategy.roomDeltaTC)) {
      roomDeltaTDesign = airflowStrategy.roomDeltaTC;
      supplyTempDesign = indoorDryBulb - roomDeltaTDesign;
      designBasisOverridden = true;
    }
    if (Number.isFinite(airflowStrategy.roomDeltaTDeltaC)) {
      roomDeltaTDesign += airflowStrategy.roomDeltaTDeltaC;
      supplyTempDesign = indoorDryBulb - roomDeltaTDesign;
      designBasisOverridden = true;
    }
    if (Number.isFinite(airflowStrategy.supplyTempC)) {
      supplyTempDesign = airflowStrategy.supplyTempC;
      roomDeltaTDesign = indoorDryBulb - supplyTempDesign;
      designBasisOverridden = true;
    }
    if (Number.isFinite(airflowStrategy.supplyTempDeltaC)) {
      supplyTempDesign += airflowStrategy.supplyTempDeltaC;
      roomDeltaTDesign = indoorDryBulb - supplyTempDesign;
      designBasisOverridden = true;
    }

    roomDeltaTDesign = clamp(roomDeltaTDesign, bounds.minDeltaT, bounds.maxDeltaT);
    supplyTempDesign = indoorDryBulb - roomDeltaTDesign;
    if (supplyTempDesign < bounds.minSupplyTemp) {
      supplyTempDesign = bounds.minSupplyTemp;
      roomDeltaTDesign = clamp(indoorDryBulb - supplyTempDesign, bounds.minDeltaT, bounds.maxDeltaT);
    }

    return {
      roomDeltaTDesign: roundTo(roomDeltaTDesign, 1),
      supplyTempDesign: roundTo(supplyTempDesign, 1),
      note: designBasisOverridden && scenario
        ? (scenario.title || "Optimization scenario") + " adjusted the supply-air strategy without changing the load or psychrometric equations."
        : baseStrategy && baseStrategy.note
    };
  }

  function applyOptimizationReserveMargin(baseMargin, runtimeOptions) {
    const overrides = activeOptimizationOverrides(runtimeOptions);
    const equipmentSizing = overrides.equipmentSizing || {};
    let margin = finiteOr(baseMargin, 0.08);

    if (Number.isFinite(equipmentSizing.reserveMargin)) {
      margin = equipmentSizing.reserveMargin;
    }
    if (Number.isFinite(equipmentSizing.reserveMarginMultiplier)) {
      margin *= equipmentSizing.reserveMarginMultiplier;
    }
    if (Number.isFinite(equipmentSizing.reserveMarginDelta)) {
      margin += equipmentSizing.reserveMarginDelta;
    }

    return clamp(margin, 0.05, 0.14);
  }

  function optimizationForceDedicatedVentilation(runtimeOptions) {
    const overrides = activeOptimizationOverrides(runtimeOptions);
    const airflowStrategy = overrides.airflowStrategy || {};
    const architecture = overrides.architecture || {};
    return !!(airflowStrategy.forceDedicatedVentilation || architecture.forceDedicatedVentilation);
  }

  function optimizationForceMinZones(runtimeOptions, fallback) {
    const overrides = activeOptimizationOverrides(runtimeOptions);
    const zoning = overrides.zoning || {};
    return Math.max(Math.ceil(finiteOr(zoning.forceMinZones, fallback || 0)), 0);
  }

  function optimizationPressureAdjustments(runtimeOptions) {
    const overrides = activeOptimizationOverrides(runtimeOptions);
    const pressureAdjustments = overrides.pressureAdjustments || {};
    return {
      ductFrictionFactor: Math.max(finiteOr(pressureAdjustments.ductFrictionFactor, 1), 0.5),
      fittingLossFactor: Math.max(finiteOr(pressureAdjustments.fittingLossFactor, 1), 0.5),
      equipmentLossFactor: Math.max(finiteOr(pressureAdjustments.equipmentLossFactor, 1), 0.5),
      ductFrictionDeltaPa: finiteOr(pressureAdjustments.ductFrictionDeltaPa, 0),
      fittingLossDeltaPa: finiteOr(pressureAdjustments.fittingLossDeltaPa, 0),
      equipmentLossDeltaPa: finiteOr(pressureAdjustments.equipmentLossDeltaPa, 0)
    };
  }

  function buildVentilationStandardsContext(inputs, area, occupants, airsideProfile) {
    const userOutdoorAirPerPersonCfm = Math.max(parseFloat(inputs.fresh_cfm) || 0, 0);
    const userOutdoorAirCfm = Math.max(occupants * userOutdoorAirPerPersonCfm, 0);
    const cleanroom = airsideProfile && airsideProfile.cleanroom ? airsideProfile.cleanroom : null;
    const comfortProfile = !airsideProfile || airsideProfile.type !== "Industrial / process";

    if (cleanroom) {
      const areaComponentCfm = Math.max(area || 0, 0) * SQM_TO_SQFT * ASHRAE_OFFICE_RA_CFM_PER_SQFT;
      const peopleComponentCfm = Math.max(occupants || 0, 0) * ASHRAE_OFFICE_RP_CFM_PER_PERSON;
      const occupancyMinimumCfm = peopleComponentCfm + areaComponentCfm;
      const minimumOutdoorAirCfm = Math.max(occupancyMinimumCfm, cleanroom.pressurizationReserveCfm || 0);
      const designOutdoorAirCfm = Math.max(userOutdoorAirCfm, minimumOutdoorAirCfm);
      const designSource = designOutdoorAirCfm > userOutdoorAirCfm + 0.5
        ? minimumOutdoorAirCfm > occupancyMinimumCfm + 0.5
          ? "cleanroom_pressurization"
          : "ashrae_minimum"
        : "user_input";

      return {
        method: "ISO cleanroom mode keeps room classification on filtered recirculation airflow. Outdoor air is set from the higher of user input, occupancy minimum, and positive-pressure makeup allowance.",
        profile: "iso_cleanroom",
        classLabel: cleanroom.classLabel,
        stateLabel: cleanroom.stateLabel,
        rpCfmPerPerson: ASHRAE_OFFICE_RP_CFM_PER_PERSON,
        raCfmPerSqFt: ASHRAE_OFFICE_RA_CFM_PER_SQFT,
        userOutdoorAirPerPersonCfm: roundTo(userOutdoorAirPerPersonCfm, 2),
        userOutdoorAirCfm: roundTo(userOutdoorAirCfm, 1),
        peopleComponentCfm: roundTo(peopleComponentCfm, 1),
        areaComponentCfm: roundTo(areaComponentCfm, 1),
        pressurizationReserveCfm: roundTo(cleanroom.pressurizationReserveCfm || 0, 1),
        minimumOutdoorAirCfm: roundTo(minimumOutdoorAirCfm, 1),
        designOutdoorAirCfm: roundTo(designOutdoorAirCfm, 1),
        designSource: designSource,
        shortfallCfm: roundTo(Math.max(minimumOutdoorAirCfm - userOutdoorAirCfm, 0), 1),
        note: designSource === "cleanroom_pressurization"
          ? "Outdoor air was lifted to cover a basic cleanroom pressurization / leakage allowance in addition to occupancy ventilation."
          : designSource === "ashrae_minimum"
            ? "Outdoor air was lifted to the occupancy-based minimum before coil sizing."
            : "User outdoor-air input already covers the current cleanroom occupancy / pressurization allowance."
      };
    }

    if (!comfortProfile) {
      return {
        method: "General hall / process ventilation remains governed by ACH and localized capture, not office VRP per-area ventilation.",
        profile: airsideProfile && airsideProfile.largeIndustrialHall ? "industrial_hall" : "industrial_process",
        userOutdoorAirPerPersonCfm: roundTo(userOutdoorAirPerPersonCfm, 2),
        userOutdoorAirCfm: roundTo(userOutdoorAirCfm, 1),
        peopleComponentCfm: roundTo(userOutdoorAirCfm, 1),
        areaComponentCfm: 0,
        minimumOutdoorAirCfm: roundTo(userOutdoorAirCfm, 1),
        designOutdoorAirCfm: roundTo(userOutdoorAirCfm, 1),
        designSource: "user_input",
        shortfallCfm: 0,
        note: airsideProfile && airsideProfile.largeIndustrialHall
          ? "Large industrial halls continue to use general hall ACH plus localized capture / make-up air as the governing ventilation basis."
          : "Process spaces continue to use user-entered outdoor air plus ACH / local-capture logic rather than office-space per-area ventilation."
      };
    }

    const areaComponentCfm = Math.max(area || 0, 0) * SQM_TO_SQFT * ASHRAE_OFFICE_RA_CFM_PER_SQFT;
    const peopleComponentCfm = Math.max(occupants || 0, 0) * ASHRAE_OFFICE_RP_CFM_PER_PERSON;
    const minimumOutdoorAirCfm = peopleComponentCfm + areaComponentCfm;
    const designOutdoorAirCfm = Math.max(userOutdoorAirCfm, minimumOutdoorAirCfm);
    const designSource = designOutdoorAirCfm > userOutdoorAirCfm + 0.5 ? "ashrae_minimum" : "user_input";

    return {
      method: "ASHRAE 62.1 style office ventilation rate procedure: Vbz = Rp x people + Ra x area, with an ISHRAE IEQ practical overlay for Indian comfort projects.",
      profile: "office_comfort",
      rpCfmPerPerson: ASHRAE_OFFICE_RP_CFM_PER_PERSON,
      raCfmPerSqFt: ASHRAE_OFFICE_RA_CFM_PER_SQFT,
      userOutdoorAirPerPersonCfm: roundTo(userOutdoorAirPerPersonCfm, 2),
      userOutdoorAirCfm: roundTo(userOutdoorAirCfm, 1),
      peopleComponentCfm: roundTo(peopleComponentCfm, 1),
      areaComponentCfm: roundTo(areaComponentCfm, 1),
      minimumOutdoorAirCfm: roundTo(minimumOutdoorAirCfm, 1),
      designOutdoorAirCfm: roundTo(designOutdoorAirCfm, 1),
      designSource: designSource,
      shortfallCfm: roundTo(Math.max(minimumOutdoorAirCfm - userOutdoorAirCfm, 0), 1),
      note: designSource === "ashrae_minimum"
        ? "User outdoor-air input was below the ASHRAE-style office minimum, so the ventilation load was lifted to the breathing-zone minimum before coil sizing."
        : "User outdoor-air input already meets or exceeds the ASHRAE-style office minimum."
    };
  }

  function buildInfiltrationContext(options) {
    const settings = options || {};
    const area = Math.max(settings.area || 0, 0);
    const volume = Math.max(settings.volume || 0, 0);
    const height = Math.max(settings.height || 0, 0);
    const occupants = Math.max(settings.occupants || 0, 0);
    const roofExposure = settings.roofExposure || "top_floor";
    const airsideProfile = settings.airsideProfile || {};
    const envelope = settings.envelope || {};
    const ventilation = settings.ventilation || {};
    const cleanroom = airsideProfile.cleanroom || null;
    const comfortProfile = airsideProfile.type !== "Industrial / process";
    const largeIndustrialHall = !!airsideProfile.largeIndustrialHall;
    const positiveCleanroom = !!(cleanroom && cleanroom.pressureMode === "positive");
    const negativeCleanroom = !!(cleanroom && cleanroom.pressureMode === "negative");
    const wallExposureRatio = safeDiv((envelope.wallGrossArea || 0) + (envelope.windowAreaTotal || 0), Math.max(area, 1), 0);
    const glazingRatio = safeDiv(envelope.windowAreaTotal || 0, Math.max((envelope.wallGrossArea || 0), 1), 0);
    const occupantDensity = safeDiv(occupants, Math.max(area, 1), 0);
    const userOutdoorAirCfm = Math.max(ventilation.userOutdoorAirCfm || 0, 0);
    const minimumOutdoorAirCfm = Math.max(ventilation.minimumOutdoorAirCfm || 0, 0);
    const oaSurplusRatio = safeDiv(Math.max(userOutdoorAirCfm - minimumOutdoorAirCfm, 0), Math.max(minimumOutdoorAirCfm, 1), 0);
    const inputs = settings.inputs || {};
    const core = engineeringCoreApi();
    const selectedModel = String(inputs.infiltration_model || "").toLowerCase() === "crack"
      ? "crack"
      : "ach_profile";
    const selectedProfile = String(inputs.infiltration_profile || "").toLowerCase() || "normal";

    if (core && typeof core.buildInfiltrationModel === "function") {
      const infiltrationModel = core.buildInfiltrationModel({
        model: selectedModel,
        profile: selectedProfile,
        area: area,
        volume: volume,
        height: height,
        occupants: occupants,
        roofExposure: roofExposure,
        wallExposureRatio: wallExposureRatio,
        glazingRatio: glazingRatio,
        occupantDensity: occupantDensity,
        oaSurplusRatio: oaSurplusRatio,
        comfortProfile: comfortProfile,
        cleanroomMode: !!cleanroom,
        pressureMode: cleanroom ? cleanroom.pressureMode : "positive",
        pressurizationPa: cleanroom ? cleanroom.pressurePa : 0,
        pressureDeltaPa: parseFloat(inputs.infiltration_pressure_pa) || 0,
        crackFlowCoefficient: parseFloat(inputs.infiltration_crack_coeff) || 0,
        effectiveLeakageAreaSqM: parseFloat(inputs.infiltration_leakage_area) || 0
      });

      return {
        method: infiltrationModel.model === "crack"
          ? "Pressure-driven crack leakage model with configurable leakage area and pressure differential."
          : "Profile-based infiltration allowance using tight / normal / leaky building bands with exposure and pressurization modifiers.",
        model: infiltrationModel.model,
        profile: infiltrationModel.profile || selectedProfile,
        designAch: roundTo(infiltrationModel.designAch || 0, 3),
        airflowCfm: roundTo(infiltrationModel.airflowCfm || 0, 1),
        pressureDeltaPa: roundTo(infiltrationModel.pressureDeltaPa || 0, 1),
        effectiveLeakageAreaSqM: roundTo(infiltrationModel.effectiveLeakageAreaSqM || 0, 4),
        assumptions: infiltrationModel.assumptions || [],
        note: infiltrationModel.note || (cleanroom
          ? positiveCleanroom
            ? "Positive cleanroom pressurization keeps uncontrolled infiltration low; remaining leakage is treated conservatively as load."
            : negativeCleanroom
              ? "Negative cleanroom / containment mode assumes higher leakage and makeup review."
              : "Neutral cleanroom mode assumes low but nonzero leakage."
          : "Infiltration basis has been calculated from the selected profile.")
      };
    }

    const baseAch = cleanroom
      ? positiveCleanroom
        ? 0.04
        : negativeCleanroom
          ? 0.10
          : 0.06
      : largeIndustrialHall
        ? 0.18
        : comfortProfile
          ? 0.30
          : 0.35;
    const roofAdd = roofExposure === "top_floor" ? 0.05 : roofExposure === "ground" ? 0.02 : 0;
    const exposureAdd = clamp((wallExposureRatio - 1.1) * 0.08, 0, largeIndustrialHall ? 0.08 : comfortProfile ? 0.12 : 0.16);
    const glazingAdd = clamp(glazingRatio * 0.10, 0, 0.08);
    const heightAdd = clamp((Math.max(height, 3) - 3) * (comfortProfile ? 0.02 : 0.03), 0, comfortProfile ? 0.10 : 0.18);
    const trafficAdd = clamp(occupantDensity * (comfortProfile ? 0.55 : 0.35), 0, comfortProfile ? 0.10 : 0.12);
    const pressurizationRelief = clamp(oaSurplusRatio * (cleanroom ? 0.10 : comfortProfile ? 0.07 : 0.05), 0, cleanroom ? 0.10 : 0.08);
    const designAch = clamp(baseAch + roofAdd + exposureAdd + glazingAdd + heightAdd + trafficAdd - pressurizationRelief, 0.1, comfortProfile ? 0.7 : 1.0);

    return {
      method: "Fallback profile-based infiltration allowance.",
      model: "ach_profile",
      profile: "normal",
      designAch: roundTo(designAch, 3),
      airflowCfm: roundTo(volume > 0 ? volume * designAch / (3600 * CFM_TO_M3S) : 0, 1),
      assumptions: ["Fallback profile-based infiltration allowance was used because the engineering core was not available."],
      note: "Infiltration allowance stays inside a conservative closed-building range."
    };
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

  function defaultDuctFittings(kind, branchCount) {
    const count = Math.max(branchCount || 1, 1);
    if (kind === "return") {
      return [
        { type: "elbow_90", count: 2 },
        { type: "tee_run", count: Math.max(count - 1, 0) },
        { type: "transition", count: 1 }
      ];
    }
    if (kind === "exhaust") {
      return [
        { type: "elbow_90", count: 2 },
        { type: "tee_branch", count: Math.max(count - 1, 0) },
        { type: "transition", count: 1 },
        { type: "reducer", count: 1 }
      ];
    }
    return [
      { type: "elbow_90", count: 3 },
      { type: "tee_run", count: Math.max(count - 1, 0) },
      { type: "transition", count: 1 },
      { type: "reducer", count: 1 }
    ];
  }

  function estimateDuctSectionLoss(cfm, duct, lengthFt, kind, branchCount) {
    const core = engineeringCoreApi();
    if (core && typeof core.calculateDuctPressureLoss === "function" && typeof core.calculateFittingLoss === "function") {
      const friction = core.calculateDuctPressureLoss({
        cfm: cfm,
        duct: duct,
        lengthM: (lengthFt || 0) * 0.3048
      });
      const fittings = core.calculateFittingLoss({
        cfm: cfm,
        duct: duct,
        fittings: defaultDuctFittings(kind, branchCount)
      });
      return {
        ductFriction: friction.frictionLossPa || 0,
        fittingLoss: fittings.totalLossPa || 0,
        velocityMps: friction.velocityMps || 0,
        lossPerMeterPa: friction.lossPerMeterPa || 0,
        fittingBreakdown: fittings.breakdown || []
      };
    }

    const frictionPaPerFt = FRICTION_RATE * 0.3048;
    const ductFriction = frictionPaPerFt * (lengthFt || 0);
    return {
      ductFriction: ductFriction,
      fittingLoss: ductFriction * 0.52,
      velocityMps: ((kind === "return" ? 350 : kind === "exhaust" ? 700 : 650) * FPM_TO_MPS),
      lossPerMeterPa: frictionPaPerFt / 0.3048,
      fittingBreakdown: []
    };
  }

  function classifyAirsideProfile(inputs, area) {
    const cleanroom = buildCleanroomDesignContext(inputs, area, parseFloat(inputs.ht) || 3);
    if (cleanroom) {
      return {
        type: "Cleanroom / " + cleanroom.classLabel,
        achRequired: cleanroom.designAch,
        achRangeMin: cleanroom.achRangeMin,
        achRangeMax: cleanroom.achRangeMax,
        note: cleanroom.classLabel + " " + cleanroom.stateLabel.toLowerCase() + " mode uses filtered recirculation airflow and terminal cleanroom supply modules as the governing airside basis.",
        cleanroomMode: true,
        cleanroom: cleanroom,
        largeIndustrialHall: false,
        processVentilationStrategy: "cleanroom_recirculation",
        heatRecoveryRecommended: cleanroom.classNumber <= 7,
        processAirScheduleRatio: 0.35,
        recommendedProcessStaticPa: 180,
        highBayAirDistribution: false,
        zoneLimits: cleanroom.zoneLimits
      };
    }

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
      reasons.push("recirculation airflow is high for a single control zone");
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
    const cleanroom = airsideProfile.cleanroom || null;
    const systemArchitecture = settings.systemArchitecture || {};
    const zoning = settings.zoning || { zoneCount: 1 };
    const diffuserLayout = settings.diffuserLayout || {};
    const conditionedCFM = Math.max(settings.conditionedCFM || 0, 0);
    const processCFM = Math.max(settings.processCFM || 0, 0);
    const processRatio = safeDiv(processCFM, conditionedCFM, 0);
    const oaFraction = clamp(settings.oaFraction || 0, 0, 1);
    const trFinal = settings.trFinal || 0;
    const trCoolingCoil = settings.trCoolingCoil || trFinal;
    const trDedicatedVentilation = settings.trDedicatedVentilation || 0;
    const coolingCoilAirflowCfm = Math.max(settings.coolingCoilAirflowCfm || conditionedCFM, 0);
    const dedicatedVentilationAirflowCfm = Math.max(settings.dedicatedVentilationAirflowCfm || 0, 0);
    const area = settings.area || 0;
    const isIndustrial = airsideProfile.type === "Industrial / process" || diffuserLayout.isIndustrialMode;
    const processAirActive = processCFM > Math.max(250, conditionedCFM * 0.05);
    const processSystemRequired = processAirActive && (airsideProfile.largeIndustrialHall || isIndustrial || processRatio > 0.8);
    const decoupledVentilation = !!systemArchitecture.decoupledVentilation || dedicatedVentilationAirflowCfm > 0;
    const secondaries = [];
    const reasons = [];
    let primarySystem = "";
    let systemFamily = "";

    if (cleanroom) {
      systemFamily = cleanroom.classNumber <= 6
        ? "cleanroom_downflow"
        : "cleanroom_recirculation";
      primarySystem = cleanroom.classNumber <= 6
        ? "Dedicated make-up air unit + recirculation AHU / FFU cleanroom system"
        : "Dedicated make-up air unit + recirculation AHU with terminal HEPA modules";
      secondaries.push(cleanroom.supplyPattern);
      secondaries.push(cleanroom.returnPattern);
      secondaries.push("Pressure regime: " + cleanroom.pressureLabel + " at about " + formatNumber(Math.abs(cleanroom.pressurePa || 0), 1) + " Pa");
      secondaries.push("Final filter: " + cleanroom.finalFilter);
      if (zoning.zoneCount > 1) {
        secondaries.push(zoning.zoneCount + " recirculation zone(s) for balancing and filter maintenance");
      }
      reasons.push(cleanroom.classLabel + " is a particle-class target, so filtered recirculation airflow governs the design more than comfort-only CFM/TR rules.");
      reasons.push("Cleanroom design should separate make-up air / pressurization from the main recirculation path and maintain a terminal HEPA-filtered supply field.");
      if (dedicatedVentilationAirflowCfm > 0) {
        secondaries.push("Dedicated make-up air stream: " + formatInt(dedicatedVentilationAirflowCfm) + " CFM");
      }
      if (coolingCoilAirflowCfm > 0 && coolingCoilAirflowCfm + 1 < conditionedCFM) {
        secondaries.push("Recirculation cooling-coil control airflow: " + formatInt(coolingCoilAirflowCfm) + " CFM");
      }
      if (trDedicatedVentilation > 0.05) {
        secondaries.push("Make-up air duty separated from recirculation coil by about " + formatNumber(trDedicatedVentilation, 1) + " TR");
      }
    } else if (airsideProfile.largeIndustrialHall) {
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
    } else if (decoupledVentilation && (oaFraction > 0.2 || trDedicatedVentilation > 0.5 || coolingCoilAirflowCfm + 1 < conditionedCFM)) {
      systemFamily = zoning.zoneCount > 1 ? "doas_zoned" : "doas_single_zone";
      primarySystem = zoning.zoneCount > 1 ? "DOAS / MAU + zoned recirculation AHUs" : "DOAS / MAU + single-zone recirculation AHU";
      secondaries.push("Dedicated outdoor-air treatment");
      secondaries.push("Recirculation airflow sized independently from outdoor air");
      reasons.push("ventilation duty is being carried separately from the active cooling-coil stream");
      reasons.push("separating outdoor air from recirculation keeps coil sizing and psychrometric control physically defendable");
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
    if (oaFraction > 0.25 && !cleanroom) {
      secondaries.push("Heat recovery / energy recovery review");
    }

    return {
      family: systemFamily,
      primarySystem: primarySystem,
      secondarySystems: secondaries.filter(Boolean),
      reasoning: reasons.join("; "),
      confidence: cleanroom || airsideProfile.largeIndustrialHall || processSystemRequired || processRatio > 0.8 || oaFraction > 0.35 ? "high" : isIndustrial ? "medium" : "medium",
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
    const cleanroom = settings.airsideProfile && settings.airsideProfile.cleanroom ? settings.airsideProfile.cleanroom : null;
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
    if (cleanroom && String(diffuserLayout.supplyDeviceType || "").toLowerCase().indexOf("hepa") === -1 && String(diffuserLayout.supplyDeviceType || "").toLowerCase().indexOf("laminar") === -1) {
      issues.push("cleanroom mode requires terminal HEPA or laminar-flow supply modules rather than a generic comfort outlet");
      actions.push("switch to HEPA ceiling modules or laminar-flow terminals that align with the selected ISO class");
    }
    if (cleanroom && String(systemRecommendation.family || "").indexOf("cleanroom") !== 0) {
      warnings.push("the current system family does not explicitly separate make-up air and recirculation the way a cleanroom typically requires");
      actions.push("review a dedicated make-up air plus recirculation cleanroom arrangement before issue");
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
      warnings.push("process airflow is several times larger than recirculation airflow, so annual energy will be dominated by ventilation rather than cooling");
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

    const zonePlans = zones.map(function (zone) {
      const zoneLayout = layoutById[zone.id] || null;
      const zoneSupplyCFM = zone.conditionedCFM || 0;
      const zoneProcessCFM = zone.processCFM || 0;
      const zoneReturnCFM = settings.conditionedCFM > 0
        ? roundTo(totalReturnCFM * safeDiv(zoneSupplyCFM, settings.conditionedCFM, 0), 1)
        : Math.max(zoneSupplyCFM * 0.7, 0);
      const ductLengthFt = (zone.length + zone.width) * 3.28084 * 1.22;
      const supplySingle = ductSize(zoneSupplyCFM, settings.mainVelocityFpm);
      const returnSingle = ductSize(zoneReturnCFM, settings.returnVelocityFpm);
      const processSingle = zoneProcessCFM > 0 && !distributeProcessAir ? ductSize(zoneProcessCFM, settings.processVelocityFpm) : null;
      const supplyLoss = estimateDuctSectionLoss(zoneSupplyCFM, supplySingle, ductLengthFt, "supply", zoneLayout && zoneLayout.diffuserCount ? zoneLayout.diffuserCount : 1);
      const returnLoss = estimateDuctSectionLoss(zoneReturnCFM, returnSingle, ductLengthFt * 0.85, "return", zoneLayout && zoneLayout.diffuserCount ? zoneLayout.diffuserCount : 1);
      const ductFriction = (supplyLoss.ductFriction || 0) + (returnLoss.ductFriction || 0);
      const fittingLoss = (supplyLoss.fittingLoss || 0) + (returnLoss.fittingLoss || 0);
      const localEquipmentLoss = settings.equipmentLoss + (zoneLayout && zoneLayout.diffuserCount > 8 ? 10 : 0);
      const totalEsp = ductFriction + fittingLoss + localEquipmentLoss;
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
    const baseMarginTarget = clamp(settings.preferredMargin == null ? 0.09 : settings.preferredMargin, 0.06, 0.12);
    const targetMinMargin = Math.max(0.05, baseMarginTarget - 0.02);
    const targetMaxMargin = Math.min(0.15, baseMarginTarget + 0.03);
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
    const cleanroom = settings.airsideProfile && settings.airsideProfile.cleanroom ? settings.airsideProfile.cleanroom : null;
    const supplementalSelections = Array.isArray(settings.supplementalSelections) ? settings.supplementalSelections.filter(Boolean) : [];
    const baseElectricalFanKW = zoneAhuStrategy.aggregateSelection.electricalFanKWTotal || 0;
    const baseMotorKW = zoneAhuStrategy.aggregateSelection.recommendedMotorKW || 0;
    const supplementalElectricalFanKW = supplementalSelections.reduce(function (sum, selection) {
      return sum + (selection.electricalFanKWTotal || 0);
    }, 0);
    const supplementalMotorKW = supplementalSelections.reduce(function (sum, selection) {
      return sum + (selection.recommendedMotorKW || 0);
    }, 0);
    const totalElectricalFanKW = baseElectricalFanKW + supplementalElectricalFanKW;
    const totalMotorKW = baseMotorKW + supplementalMotorKW;
    const specificFanPower = roundTo(safeDiv(totalElectricalFanKW, Math.max(settings.trFinal, 0.1), 0), 2);
    const installedMotorSpecificFanPower = roundTo(safeDiv(totalMotorKW, Math.max(settings.trFinal, 0.1), 0), 2);
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
    if (cleanroom) {
      suggestions.push("Keep outdoor air on a separate make-up air path and let filtered recirculation carry the ISO-class airflow duty.");
      suggestions.push("Review occupied/unoccupied airflow turndown with particle-count recovery criteria so the cleanroom does not run peak airflow all day.");
    }
    if (supplementalSelections.length) {
      suggestions.push("Review the combined recirculation plus dedicated ventilation fan energy, not just the primary AHU fan, before locking the annual energy basis.");
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
      suggestions.push("Process airflow is more than 5x recirculation airflow. Treat this primarily as a process-ventilation energy problem, not a comfort-cooling problem.");
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
      totalElectricalFanKW: roundTo(totalElectricalFanKW, 2),
      totalInstalledMotorKW: roundTo(totalMotorKW, 2),
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

  function designAdvisorSeverityRank(severity) {
    if (severity === "critical") {
      return 3;
    }
    if (severity === "warning") {
      return 2;
    }
    return 1;
  }

  function addDesignAdvisorItem(items, item) {
    const suggestion = item || {};
    if (!suggestion.title || !suggestion.recommendation) {
      return;
    }
    const categoryMap = {
      airflow: "airflow_compliance",
      ventilation: "airflow_compliance",
      compliance: "airflow_compliance",
      pressure: "fan_esp",
      ductwork: "fan_esp",
      equipment: "fan_esp",
      energy: "energy",
      process_air: "airflow_compliance",
      latent_control: "psychrometrics",
      psychrometrics: "psychrometrics",
      costing: "costing",
      optimization: "optimization"
    };
    const normalizedCategory = categoryMap[suggestion.category] || suggestion.category || "optimization";
    const key = suggestion.key || ((normalizedCategory || "advisory") + ":" + suggestion.title.toLowerCase());
    const existing = items.find(function (entry) {
      return entry.key === key;
    });

    if (existing) {
      if (designAdvisorSeverityRank(suggestion.severity) > designAdvisorSeverityRank(existing.severity)) {
        existing.severity = suggestion.severity;
      }
      if (suggestion.issue && suggestion.issue.length > (existing.issue || "").length) {
        existing.issue = suggestion.issue;
      }
      if (suggestion.recommendation && suggestion.recommendation.length > (existing.recommendation || "").length) {
        existing.recommendation = suggestion.recommendation;
      }
      if (suggestion.basis && suggestion.basis.length > (existing.basis || "").length) {
        existing.basis = suggestion.basis;
      }
      return;
    }

    items.push({
	      key: key,
	      issueCode: key,
	      severity: suggestion.severity || "advisory",
	      category: normalizedCategory,
      title: String(suggestion.title),
      issue: String(suggestion.issue || ""),
      recommendation: String(suggestion.recommendation || ""),
      basis: String(suggestion.basis || "")
    });
  }

  function buildDesignIntelligenceInputs(result) {
    const settings = result || {};
    const flows = airflowBreakdown(settings);
    const airflows = settings.airflows || {};
    const systems = settings.systems || {};
    const ventilation = settings.standardsContext && settings.standardsContext.ventilation
      ? settings.standardsContext.ventilation
      : {};

    return {
      validation: settings.validation || {},
      airflows: airflows,
      systems: systems,
      systemArchitecture: settings.systemArchitecture || {},
      designConstraints: settings.designConstraints || {},
      energyOptimization: settings.energyOptimization || {},
      standardsContext: settings.standardsContext || {},
      zoneDuctPlan: settings.zoneDuctPlan || {},
      zoneAhuStrategy: settings.zoneAhuStrategy || {},
      diffuserLayout: settings.diffuserLayout || {},
      systemRecommendation: settings.systemRecommendation || {},
      cleanroom: settings.cleanroom || null,
      currentSystemType: settings.systemRecommendation && settings.systemRecommendation.primarySystem
        ? settings.systemRecommendation.primarySystem
        : "",
      areaM2: settings.area || 0,
      volumeM3: settings.volume || 0,
      trFinal: settings.tr_final || settings.tr_sf || settings.tr_design || 0,
      trCoolingCoil: settings.tr_cooling_coil || settings.tr_airflow || 0,
      trVentilation: settings.tr_ventilation || 0,
      zoneCount: settings.autoZoning && settings.autoZoning.zoneCount ? settings.autoZoning.zoneCount : 1,
      totalEspPa: settings.total_esp || 0,
      ductFrictionPa: settings.duct_friction || 0,
      fittingLossPa: settings.fitting_loss || 0,
      equipmentLossPa: settings.equipment_loss || 0,
      latentLoadRatio: 1 - calculateShrRatio(settings.spaceSensible || 0, settings.spaceLatent || 0, settings.roomShr || 0.85),
      ventilationFraction: safeDiv(flows.totalOutdoorAirCfm || settings.fresh_total_cfm || 0, Math.max(flows.recirculationAirflowCfm || settings.cfm_conditioned || settings.Q_sup_cfm || 0, 1), 0),
      processRatio: safeDiv(flows.processAirflowCfm || settings.cfm_process_excess || 0, Math.max(flows.recirculationAirflowCfm || settings.cfm_conditioned || settings.Q_sup_cfm || 0, 1), 0),
      coolingAirflowCfm: flows.coolingAirflowCfm || settings.cfm_cooling_coil || settings.Q_coil_cfm || 0,
      recirculationAirflowCfm: flows.recirculationAirflowCfm || settings.cfm_conditioned || settings.Q_sup_cfm || 0,
      roomSupplyAirflowCfm: flows.recirculationAirflowCfm || settings.cfm_conditioned || settings.Q_sup_cfm || 0,
      ventilationAirflowCfm: flows.ventilationAirflowCfm || settings.ventilation_airflow_cfm || 0,
      totalRoomAirflowCfm: flows.totalRoomAirflowCfm || settings.total_room_airflow_cfm || settings.cfm_final || 0,
      dedicatedVentilationAirflowCfm: flows.dedicatedVentilationAirflowCfm || settings.cfm_dedicated_ventilation || 0,
      processAirflowCfm: flows.processAirflowCfm || settings.cfm_process_excess || 0,
      outdoorAirCfm: flows.totalOutdoorAirCfm || settings.fresh_total_cfm || 0,
      ventilationRequiredCfm: ventilation.designOutdoorAirCfm || ventilation.minimumOutdoorAirCfm || 0,
      coolingFanKW: settings.cooling_fan_kw || systems.cooling && systems.cooling.fanKW || 0,
      recirculationFanKW: settings.recirculation_fan_kw || systems.recirculation && systems.recirculation.fanKW || 0,
      ventilationFanKW: settings.ventilation_fan_kw || systems.ventilation && systems.ventilation.fanKW || 0,
      specificFanPowerKWPerTR: settings.energyOptimization && settings.energyOptimization.specificFanPowerKWPerTR || 0,
      installedMotorSpecificFanPowerKWPerTR: settings.energyOptimization && settings.energyOptimization.installedMotorSpecificFanPowerKWPerTR || 0,
      achActual: settings.ach || flows.achCompliance || 0,
      achRequired: Math.max(settings.ach_required || 0, settings.cleanroom ? settings.cleanroom.designAch || 0 : 0),
      achRecirculation: settings.ach_recirculation || flows.achRecirculation || 0,
      achTotalRoom: settings.ach_total_room || flows.achTotalRoom || 0,
      currentAirflowCfm: flows.recirculationAirflowCfm || settings.cfm_conditioned || settings.Q_sup_cfm || 0,
      currentAch: settings.ach || flows.achCompliance || 0,
      requiredAch: Math.max(settings.ach_required || 0, settings.cleanroom ? settings.cleanroom.designAch || 0 : 0),
      psychro: settings.psychro || {},
      supplyTempC: settings.psychro && settings.psychro.supplyTemp || 0,
      bypassFactor: settings.psychro && settings.psychro.bypassFactor || 0
    };
  }

	  function buildLocalDesignAdvisor(options) {
    const settings = options || {};
    const core = engineeringCoreApi();
    if (core && typeof core.buildReasoningAdvisor === "function") {
      return core.buildReasoningAdvisor(buildDesignIntelligenceInputs(settings));
    }
    const items = [];
    const designConstraints = settings.designConstraints || {};
    const energyOptimization = settings.energyOptimization || {};
    const standardsContext = settings.standardsContext || {};
    const ventilation = standardsContext.ventilation || {};
    const infiltration = standardsContext.infiltration || {};
    const zoneDuctPlan = settings.zoneDuctPlan || {};
    const zoneAhuStrategy = settings.zoneAhuStrategy || {};
    const equipmentSelection = zoneAhuStrategy.aggregateSelection || settings.equipmentSelection || {};
    const ahu = equipmentSelection.ahu || {};
    const fan = equipmentSelection.fan || {};
    const diffuserLayout = settings.diffuserLayout || {};
    const airflowBasis = settings.airflowBasis || {};
    const airsideProfile = settings.airsideProfile || {};
    const cleanroom = airsideProfile.cleanroom || null;
    const processAirflow = settings.cfm_process_excess || 0;
    const processRatio = energyOptimization.processAirRatio || safeDiv(processAirflow, Math.max(settings.cfm_conditioned || 0, 1), 0);
    const comfortProfile = airsideProfile.type !== "Industrial / process";
    const lowSupplyLimit = comfortProfile ? 10.5 : 8.5;

    if (cleanroom) {
      addDesignAdvisorItem(items, {
        key: "cleanroom-certification-path",
        severity: "advisory",
        category: "cleanroom",
        title: cleanroom.classLabel + " design basis has been applied",
        issue: cleanroom.classLabel + " is selected in " + (cleanroom.stateLabel || "operational") + " mode. ISO classification is particle-count based, while the HVAC engine is using template airflow, terminal filtration, and pressurization values for early sizing.",
        recommendation: "Carry the HVAC design forward with HEPA integrity testing, particle-count qualification, airflow visualization, and pressure-cascade TAB in the project deliverables.",
        basis: cleanroom.note || cleanroom.complianceNote || "ISO cleanroom design note."
      });
    }

    if (ventilation.shortfallCfm > 0.5) {
      addDesignAdvisorItem(items, {
        key: "ventilation-shortfall",
        severity: "warning",
        category: "ventilation",
        title: cleanroom
          ? "Outdoor air was below the cleanroom occupancy / pressurization allowance"
          : "Outdoor air was below the office ventilation minimum",
        issue: cleanroom
          ? "The user-entered outdoor-air rate gives " + formatInt(ventilation.userOutdoorAirCfm || 0) + " CFM, but the current cleanroom occupancy / pressurization allowance is " + formatInt(ventilation.minimumOutdoorAirCfm || 0) + " CFM."
          : "The user-entered outdoor-air rate gives " + formatInt(ventilation.userOutdoorAirCfm || 0) + " CFM, but the ASHRAE-style office minimum is " + formatInt(ventilation.minimumOutdoorAirCfm || 0) + " CFM.",
        recommendation: "Raise the outdoor-air setting to at least " + formatInt(ventilation.designOutdoorAirCfm || ventilation.minimumOutdoorAirCfm || 0) + " CFM before finalizing coil, fan, and energy sizing.",
        basis: ventilation.method || ventilation.note || "ASHRAE-style office VRP."
      });
    }

    if (infiltration.designAch > (comfortProfile ? 0.25 : 0.30)) {
      addDesignAdvisorItem(items, {
        key: "infiltration-high",
        severity: "advisory",
        category: "envelope",
        title: "Envelope infiltration is materially affecting the room load",
        issue: "The real-world infiltration allowance is " + formatNumber(infiltration.designAch || 0, 2) + " ACH, which is high enough to add both sensible and latent load.",
        recommendation: "Review vestibules, door operation, façade leakage, and slight positive pressurization so infiltration stays closer to a closed-building condition.",
        basis: infiltration.method || infiltration.note || "ASHRAE-style infiltration allowance."
      });
    }

    if (!diffuserLayout.cfmRangePass) {
      addDesignAdvisorItem(items, {
        key: "diffuser-airflow-band",
        severity: designConstraints.rejected ? "critical" : "warning",
        category: "distribution",
        title: "Outlet airflow is outside the defendable terminal range",
        issue: "Each outlet is carrying about " + formatInt(diffuserLayout.cfmPerDiffuser || 0) + " CFM versus a preferred band of " + formatInt(diffuserLayout.minCFMPerDiffuser || 0) + "-" + formatInt(diffuserLayout.maxCFMPerDiffuser || 0) + " CFM.",
        recommendation: "Revise zone count or change terminal family so each outlet stays inside the preferred airflow band before issue.",
        basis: diffuserLayout.selectionBasis || "Current diffuser sizing is outside the preferred operating band."
      });
    }

    if (!diffuserLayout.spacingPass || !diffuserLayout.throwPass) {
      addDesignAdvisorItem(items, {
        key: "air-distribution-coverage",
        severity: designConstraints.rejected ? "critical" : "warning",
        category: "distribution",
        title: "Air-distribution coverage still needs correction",
        issue: "The current layout does not satisfy the spacing / throw checks for the occupied zone.",
        recommendation: diffuserLayout.highThrowRecommended
          ? "Move to a higher-throw terminal family or reduce zone size instead of forcing extra low-CFM diffusers."
          : "Increase zoning density or revise diffuser placement until spacing and throw both pass inside the protected outlet-airflow band.",
        basis: diffuserLayout.selectionBasis || "Diffuser layout coverage checks."
      });
    }

    if (zoneDuctPlan && zoneDuctPlan.overallStatus && zoneDuctPlan.overallStatus !== "OK") {
      const supplyStrategy = zoneDuctPlan.aggregate && zoneDuctPlan.aggregate.supply ? zoneDuctPlan.aggregate.supply : null;
      addDesignAdvisorItem(items, {
        key: "duct-practicality",
        severity: zoneDuctPlan.overallStatus === "REJECT" ? "critical" : "warning",
        category: "ductwork",
        title: "Main duct network is outside the preferred practical range",
        issue: zoneDuctPlan.summary || "One or more supply / return / process duct paths exceed the preferred fabrication, trunk-count, or velocity limits.",
        recommendation: supplyStrategy && supplyStrategy.bestAlternative
          ? supplyStrategy.bestAlternative
          : "Split the serving air system or add more parallel trunks so the duct size, aspect ratio, and velocity stay inside practical limits.",
        basis: "ASHRAE / industry duct velocity and fabrication limits enforced by the zone duct planner."
      });
    }

    (ahu.reviewReasons || []).forEach(function (reason) {
      if (reason === "coil capacity below TR_catalog") {
        addDesignAdvisorItem(items, {
          key: "ahu-capacity-short",
          severity: "critical",
          category: "equipment",
          title: "Selected coil capacity is below the catalog requirement",
          issue: "The selected cooling package is " + formatNumber(ahu.capacityTR || 0, 1) + " TR against a catalog basis of " + formatNumber(ahu.requiredCatalogTR || 0, 1) + " TR.",
          recommendation: "Move the selection up to at least " + formatNumber(ahu.requiredCatalogTR || 0, 1) + " TR or split the load across more AHU clusters.",
          basis: ahu.selectionNote || ahu.sizingBasis || "Equipment selection review."
        });
      } else if (reason === "selected fan / air section static-pressure capability is below required ESP") {
        addDesignAdvisorItem(items, {
          key: "fan-static-short",
          severity: "critical",
          category: "equipment",
          title: "Fan / air-section static capability is below the design ESP",
          issue: "Required ESP is about " + formatInt(ahu.designESP || settings.total_esp || 0) + " Pa, but the current fan / air-section capability does not fully cover it.",
          recommendation: "Reduce external static pressure or select a stronger fan / extra air section so the duty point sits inside the available fan window.",
          basis: ahu.selectionNote || "Equipment fan static review."
        });
      } else if (reason === "design airflow falls outside the recommended airflow window for each air section") {
        addDesignAdvisorItem(items, {
          key: "air-section-airflow-window",
          severity: "warning",
          category: "equipment",
          title: "Per-section airflow is outside the preferred AHU operating window",
          issue: "Current duty is about " + formatInt(ahu.perUnitDutyCFM || 0) + " CFM per air section versus a preferred total window of " + formatInt(ahu.minAirflowCFM || 0) + "-" + formatInt(ahu.maxAirflowCFM || 0) + " CFM.",
          recommendation: "Adjust the number of parallel air sections or split the AHU clusters so each section runs closer to its nominal airflow band.",
          basis: ahu.selectionNote || "Air-handling arrangement review."
        });
      } else if (reason === "fan operating point falls outside the available fan curve") {
        addDesignAdvisorItem(items, {
          key: "fan-curve-window",
          severity: "warning",
          category: "equipment",
          title: "Fan operating point sits outside the current catalog curve",
          issue: "The selected fan curve does not fully cover the design point at about " + formatInt(fan.dutyCFM || ahu.perUnitDutyCFM || 0) + " CFM and " + formatInt(ahu.designESP || settings.total_esp || 0) + " Pa.",
          recommendation: "Move to a stronger fan class, reduce static losses, or split airflow so the operating point moves back into the curve window.",
          basis: fan.selectionNote || ahu.selectionNote || "Fan curve review."
        });
      }
    });

    if ((energyOptimization.specificFanPowerKWPerTR || 0) > (energyOptimization.specificFanPowerWarningLimit || 0)) {
      addDesignAdvisorItem(items, {
        key: "fan-power-high",
        severity: "warning",
        category: "energy",
        title: "Specific fan power is high for this airflow duty",
        issue: "Operational SFP is " + formatNumber(energyOptimization.specificFanPowerKWPerTR || 0, 2) + " kW/TR versus a warning band of about " + formatNumber(energyOptimization.specificFanPowerWarningLimit || 0, 2) + " kW/TR.",
        recommendation: "Reduce static pressure, shorten duct runs, or split the airflow path more cleanly before accepting the current fan power.",
        basis: energyOptimization.summary || "Energy optimization review."
      });
    }

    if (processRatio > 1) {
      addDesignAdvisorItem(items, {
        key: "process-air-dominant",
        severity: processRatio > 5 ? "warning" : "advisory",
        category: "process_air",
        title: "Process / make-up air is dominating the system behavior",
        issue: "Process airflow is running at about " + formatNumber(processRatio, 2) + "x the recirculation airflow.",
        recommendation: airsideProfile.processVentilationStrategy === "localized_capture"
          ? "Keep the hall on general ventilation and use localized exhaust / make-up modules with heat recovery where practical."
          : "Treat process air as a separate make-up / exhaust system with independent controls instead of forcing it through the comfort-cooling circuit.",
        basis: energyOptimization.summary || settings.systemRecommendation && settings.systemRecommendation.reasoning || "Process-air ratio review."
      });
    }

    if ((settings.psychro && settings.psychro.supplyTemp || 0) < lowSupplyLimit) {
      addDesignAdvisorItem(items, {
        key: "supply-temp-low",
        severity: "warning",
        category: "psychrometrics",
        title: "Required supply air temperature is unusually low",
        issue: "Supply air is being driven down to about " + formatNumber(settings.psychro && settings.psychro.supplyTemp || 0, 1) + " C, which is low for a practical occupied-space cooling coil.",
        recommendation: "Increase cooling airflow, decouple process / outdoor air, or re-check the coil ADP target before finalizing the design.",
        basis: designConstraints.summary || "Psychrometric supply-temperature review."
      });
    }

    if ((settings.psychro && settings.psychro.bypassFactor || 0) > 0.15 && (settings.roomShr || 1) < 0.8) {
      addDesignAdvisorItem(items, {
        key: "coil-bypass-latent",
        severity: "advisory",
        category: "psychrometrics",
        title: "Latent load is asking for a tighter coil process",
        issue: "Room SHR is " + formatNumber(settings.roomShr || 0, 2) + " while the estimated bypass factor is " + formatNumber(settings.psychro && settings.psychro.bypassFactor || 0, 2) + ".",
        recommendation: "Use a deeper cooling coil, lower face velocity, or a lower bypass-factor selection if humidity control is important.",
        basis: "Psychrometric MA-SA-ADP process review."
      });
    }

    if (cleanroom && (settings.cfm_conditioned || 0) > 0 && safeDiv(ventilation.designOutdoorAirCfm || 0, Math.max(settings.cfm_conditioned || 0, 1), 0) > 0.2) {
      addDesignAdvisorItem(items, {
        key: "cleanroom-oa-fraction-high",
        severity: "warning",
        category: "cleanroom",
        title: "Outdoor-air fraction is high for a recirculating cleanroom",
        issue: "The current outdoor-air setting is about " + formatNumber(safeDiv(ventilation.designOutdoorAirCfm || 0, Math.max(settings.cfm_conditioned || 0, 1), 0) * 100, 1) + "% of recirculation airflow.",
        recommendation: "Keep make-up air only high enough for pressurization, exhaust replacement, and occupancy. Let filtered recirculation provide the rest of the cleanroom airflow.",
        basis: ventilation.note || cleanroom.note || "Cleanroom recirculation review."
      });
    }

    if (!items.length) {
      addDesignAdvisorItem(items, {
        key: "design-steady",
        severity: "advisory",
        category: "design",
        title: "Current scheme is broadly aligned with the enforced checks",
        issue: "No high-priority design conflicts were found in the current load, duct, fan, and zoning pass.",
        recommendation: "Focus next on commissioning allowances, part-load control, filter pressure drop management, and project-specific code compliance.",
        basis: "Local design review assistant summary."
      });
    }

    items.sort(function (left, right) {
      if (designAdvisorSeverityRank(left.severity) !== designAdvisorSeverityRank(right.severity)) {
        return designAdvisorSeverityRank(right.severity) - designAdvisorSeverityRank(left.severity);
      }
      return left.title.localeCompare(right.title);
    });

    return {
      provider: "local_rules",
      summary: items[0] ? items[0].recommendation : "Design review assistant is ready.",
      items: items.slice(0, 6)
    };
  }

  function buildLocalDesignAlternatives(options) {
    const settings = options || {};
    const core = engineeringCoreApi();
    if (core && typeof core.buildReasoningAlternatives === "function") {
      return core.buildReasoningAlternatives(buildDesignIntelligenceInputs(settings));
    }
    const cleanroom = settings.airsideProfile && settings.airsideProfile.cleanroom ? settings.airsideProfile.cleanroom : null;
    const ventilation = settings.standardsContext && settings.standardsContext.ventilation
      ? settings.standardsContext.ventilation
      : {};
    const energyOptimization = settings.energyOptimization || {};
    const currentAirflow = Math.max(settings.cfm_conditioned || settings.Q_sup_cfm || 0, 1);
    const currentAch = Math.max(settings.ach || 0, 0);
    const currentSystem = settings.systemRecommendation || {};
    const currentZoneCount = settings.autoZoning && settings.autoZoning.zoneCount ? settings.autoZoning.zoneCount : 1;
    const optionsList = [];

    function buildOption(payload) {
      const option = payload || {};
      optionsList.push({
        key: option.key,
        title: option.title,
        intent: option.intent,
        systemType: option.systemType,
        scope: option.scope,
        airflowCfm: roundTo(option.airflowCfm || 0, 0),
        ach: roundTo(option.ach || 0, 1),
        capexDeltaPercent: roundTo(option.capexDeltaPercent || 0, 0),
        energyDeltaPercent: roundTo(option.energyDeltaPercent || 0, 0),
        costScore: roundTo(option.costScore || 0, 0),
        efficiencyScore: roundTo(option.efficiencyScore || 0, 0),
        complianceScore: roundTo(option.complianceScore || 0, 0),
        strengths: (option.strengths || []).slice(0, 3),
        tradeoffs: (option.tradeoffs || []).slice(0, 3),
        actions: (option.actions || []).slice(0, 3)
      });
    }

    if (cleanroom) {
      const lowBandAch = cleanroom.achRangeMin || cleanroom.designAch || currentAch;
      const balancedAch = cleanroom.designAch || cleanroom.achRangeMin || currentAch;
      const efficientAch = cleanroom.classNumber <= 6
        ? cleanroom.designAch || currentAch
        : Math.max(cleanroom.achRangeMin || cleanroom.designAch || currentAch, roundTo((cleanroom.designAch || currentAch) * 0.92, 0));
      const lowBandAirflow = roundTo(settings.volume * lowBandAch / (3600 * CFM_TO_M3S), 0);
      const balancedAirflow = roundTo(cleanroom.designAirflowCfm || currentAirflow, 0);
      const efficientAirflow = roundTo(settings.volume * efficientAch / (3600 * CFM_TO_M3S), 0);

      buildOption({
        key: "cost_effective",
        title: "Cost-effective full-room scheme",
        intent: "cost_effective",
        systemType: "Make-up air unit + ducted recirculation AHU with " + cleanroom.finalFilter,
        scope: "Whole-room " + cleanroomScopeSummary(cleanroom) + " at the lower airflow edge",
        airflowCfm: lowBandAirflow,
        ach: lowBandAch,
        capexDeltaPercent: -12,
        energyDeltaPercent: roundTo((safeDiv(lowBandAirflow, currentAirflow, 1) - 1) * 100 + 4, 0),
        costScore: 90,
        efficiencyScore: 68,
        complianceScore: 82,
        strengths: [
          "Lowest first-cost route that still preserves a full-room cleanroom concept",
          "Uses terminal filtration and positive-pressure control without full ceiling coverage",
          "Ducted recirculation is straightforward to service and balance"
        ],
        tradeoffs: [
          "Less resilient if process heat or contamination generation increases later",
          "Runs close to the low end of the class airflow template",
          "Energy use can rise if static pressure is not kept tight"
        ],
        actions: [
          "Keep make-up air near pressurization plus occupancy minimum instead of oversupplying OA",
          "Use low-wall returns and keep supply modules evenly distributed",
          "Freeze the process equipment layout early so the low-band airflow concept stays valid"
        ]
      });

      buildOption({
        key: "balanced",
        title: "Balanced compliance-first scheme",
        intent: "balanced",
        systemType: "Dedicated MAU + recirculation AHU / HEPA terminal field",
        scope: "Whole-room " + cleanroomScopeSummary(cleanroom) + " using the design airflow template",
        airflowCfm: balancedAirflow,
        ach: balancedAch,
        capexDeltaPercent: 0,
        energyDeltaPercent: roundTo((safeDiv(balancedAirflow, currentAirflow, 1) - 1) * 100, 0),
        costScore: 80,
        efficiencyScore: 82,
        complianceScore: 92,
        strengths: [
          "Safest starting point for validation, TAB, and future process adjustments",
          "Separates pressurization / make-up air from the main recirculation duty",
          "Supports cleaner pressure-cascade control and filter staging"
        ],
        tradeoffs: [
          "More capital cost than the minimum-band option",
          "Needs careful coordination of filter pressure drops and fan turndown",
          "Still depends on final particle-count and HEPA integrity testing"
        ],
        actions: [
          "Add differential-pressure sensors, VFDs, and filter-pressure monitoring from day one",
          "Use gowning / airlock assumptions consistently in the room data and project narrative",
          "Write qualification steps for particle count, airflow visualization, and HEPA integrity into the design package"
        ]
      });

      buildOption({
        key: "efficient",
        title: "Efficiency-first cleanroom scheme",
        intent: "efficient",
        systemType: cleanroom.classNumber <= 6
          ? "MAU + EC-fan FFU / low-static recirculation cleanroom"
          : "MAU + low-static recirculation AHU / EC fan array with airflow turndown",
        scope: "Whole-room target maintained, with optional local critical-zone boost where the process allows",
        airflowCfm: efficientAirflow,
        ach: efficientAch,
        capexDeltaPercent: 8,
        energyDeltaPercent: -12,
        costScore: 72,
        efficiencyScore: 94,
        complianceScore: cleanroom.classNumber <= 6 ? 90 : 88,
        strengths: [
          "Best operating-cost path when the room will run long hours",
          "Uses EC fans, low static pressure, and occupied/unoccupied turndown logic",
          "Can preserve whole-room cleanliness while avoiding unnecessary peak airflow hours"
        ],
        tradeoffs: [
          "Higher controls and commissioning scope",
          "Requires stronger particle-recovery logic before aggressive turndown is accepted",
          "Needs disciplined filter maintenance to protect the energy case"
        ],
        actions: [
          "Review FFU versus central recirculation based on maintenance access and fan efficiency",
          "Set a turndown strategy tied to occupancy, pressure, and recovery testing",
          "Reduce duct and HEPA static aggressively before locking the fan section"
        ]
      });

      return {
        provider: "local_rules",
        preferredOptionKey: (energyOptimization.specificFanPowerKWPerTR || 0) > (energyOptimization.specificFanPowerAdvisoryLimit || 1.1)
          ? "efficient"
          : "balanced",
        summary: cleanroom.classLabel + " design mode is active. The balanced cleanroom scheme is the safest default, while the efficiency-first concept is stronger if long operating hours and fan energy are the main concern.",
      standardsNote: cleanroom.note,
        options: optionsList
      };
    }

    buildOption({
      key: "cost_effective",
      title: "Cost-effective baseline",
      intent: "cost_effective",
      systemType: currentZoneCount > 1 ? "Zoned DX / VRF comfort system" : "Single-zone packaged DX / AHU comfort system",
      scope: "Lowest-capex practical comfort layout for the current room",
      airflowCfm: Math.max(roundTo(currentAirflow * 0.95, 0), 0),
      ach: Math.max(roundTo(currentAch * 0.95, 1), 0),
      capexDeltaPercent: -10,
      energyDeltaPercent: 7,
      costScore: 90,
      efficiencyScore: 70,
      complianceScore: 80,
      strengths: [
        "Lowest first-cost route when project budget is the main driver",
        "Simpler controls and fewer components to install",
        "Suitable when outdoor-air fraction and zoning complexity stay moderate"
      ],
      tradeoffs: [
        "Operating cost is usually higher than the other options",
        "Less resilient if ventilation or zoning needs increase later",
        "Static-pressure and throw limits must still be respected"
      ],
      actions: [
        "Keep zoning only where diffuser coverage or duct practicality requires it",
        "Avoid oversupplying outdoor air beyond the validated minimum",
        "Check fan ESP carefully so the low-capex concept does not become a high-energy system"
      ]
    });

    buildOption({
      key: "balanced",
      title: "Balanced comfort system",
      intent: "balanced",
      systemType: currentSystem.primarySystem || "Zoned AHU comfort system",
      scope: "Best overall balance of constructability, controllability, and airflow discipline",
      airflowCfm: currentAirflow,
      ach: currentAch,
      capexDeltaPercent: 0,
      energyDeltaPercent: 0,
      costScore: 80,
      efficiencyScore: 84,
      complianceScore: 90,
      strengths: [
        "Aligns closely with the current calculated system recommendation",
        "Good balance of zoning, fan energy, and duct practicality",
        "Easier to defend technically at issue stage than the cheapest route"
      ],
      tradeoffs: [
        "Not the absolute lowest capex option",
        "Not the absolute lowest operating-cost option",
        "Still requires commissioning discipline on airflow and static pressure"
      ],
      actions: [
        "Keep the current zoning and system family unless later process changes demand a different architecture",
        "Use VFDs and commissioning allowances to protect part-load performance",
        "Carry the current design advisor actions into the issued design package"
      ]
    });

    buildOption({
      key: "efficient",
      title: "Efficiency-first system",
      intent: "efficient",
      systemType: "DOAS + low-static zoned recirculation / high-dT comfort system",
      scope: "Lowest operating-cost concept without changing the room program",
      airflowCfm: roundTo(currentAirflow * 1.03, 0),
      ach: roundTo(currentAch * 1.03, 1),
      capexDeltaPercent: 9,
      energyDeltaPercent: -14,
      costScore: 70,
      efficiencyScore: 94,
      complianceScore: 88,
      strengths: [
        "Best long-run energy profile when the room sees heavy annual hours",
        "Separates ventilation from recirculated cooling and reduces control compromises",
        "Favors lower fan power through shorter duct runs and cleaner static paths"
      ],
      tradeoffs: [
        "Higher capex and controls scope",
        "Needs tighter commissioning and operating discipline",
        "May be excessive for small rooms with intermittent use"
      ],
      actions: [
        "Use a dedicated outdoor-air path when ventilation or latent control is a recurring driver",
        "Design aggressively for low static pressure before adding fan horsepower",
        "Compare this option against the balanced scheme in the annual energy page once the backend run is available"
      ]
    });

    return {
      provider: "local_rules",
      preferredOptionKey: (energyOptimization.specificFanPowerKWPerTR || 0) > (energyOptimization.specificFanPowerAdvisoryLimit || 0.9)
        ? "efficient"
        : "balanced",
      summary: "The balanced comfort system is the safest default. The cost-effective option trims first cost, while the efficiency-first option becomes more attractive when annual run hours and energy cost matter most.",
      standardsNote: "Comfort mode alternatives are derived from the live room load, airflow, zoning, and fan results already computed in the platform.",
      options: optionsList
    };
  }

  function buildLocalDesignOptimization(baseInputs, baseResult) {
    return null;
  }

  function buildOptimizationRoomContext(result, room) {
    const project = ProjectManager.getProject();
    return {
      room: room ? {
        id: room.id || "",
        name: room.name || "Room"
      } : null,
      project: project ? {
        name: project.name || "HVAC Project",
        costingContext: project.costingContext || null
      } : null,
      costingContext: project && project.costingContext ? project.costingContext : null,
      rates: readRates(),
      calculationId: result && result.calculationId ? result.calculationId : ""
    };
  }

  async function simulateEnergyReportForResult(result, roomContext) {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      throw new Error("Optimization simulation requires the Node + Python backend server.");
    }
    if (window.ServerApi.hasCapability && !(await window.ServerApi.hasCapability("energySimulation"))) {
      throw new Error("Optimization simulation requires the energy simulation backend route.");
    }
    const payload = buildEnergySimulationPayload(result, roomContext && roomContext.room ? roomContext.room : null);
    const response = await window.ServerApi.simulateEnergy(payload);
    if (!(response && response.ok && response.report)) {
      throw new Error(response && response.error ? response.error : "Energy simulation failed.");
    }
    return response.report;
  }

  function evaluateSystemSplitNeed(conditionedCFM, zoneDuctPlan, currentSystems) {
    const currentCount = Math.max(1, Math.ceil(currentSystems || 1));
    let requiredSystems = Math.max(currentCount, Math.ceil(Math.max(conditionedCFM || 0, 0) / 50000) || 1);
    const reasons = [];

    if ((conditionedCFM || 0) > 50000) {
      reasons.push("recirculation airflow exceeds 50,000 CFM");
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
    if (constraint === "cleanroom") {
      return "Cleanroom recirculation governs";
    }
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
      { id: "auth-owner-form", mode: "owner" },
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
    syncPlanAreaFields(false);
    commitEnvelopeCount("window_count");
    commitEnvelopeCount("wall_count");
    syncEnvelopeConfigsFromUi();
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
    ["ceiling_area", "floor_area"].forEach(function (fieldId) {
      const element = byId(fieldId);
      if (!element) {
        return;
      }
      const plannedArea = roundTo((parseFloat(inputs.len || DEFAULT_INPUTS.len) || 0) * (parseFloat(inputs.wid || DEFAULT_INPUTS.wid) || 0), 2);
      const current = parseFloat(element.value);
      element.dataset.autoValue = String(plannedArea);
      element.dataset.manual = Number.isFinite(current) && Math.abs(current - plannedArea) > 0.05 ? "true" : "false";
    });
    syncPlanAreaFields(false);
    renderEnvelopeEditors(inputs);
    syncDesignModeUi();
  }

  function syncDesignModeUi() {
    const designMode = normalizedDesignMode(valueOf("design_mode", DEFAULT_INPUTS.design_mode));
    const cleanroomActive = designMode === "cleanroom";
    ["cleanroom_iso_class", "cleanroom_state", "cleanroom_pressure_mode"].forEach(function (fieldId) {
      const element = byId(fieldId);
      if (!element) {
        return;
      }
      element.disabled = !cleanroomActive;
      element.style.opacity = cleanroomActive ? "1" : "0.65";
    });
    const hint = byId("design-mode-note");
    if (hint) {
      hint.textContent = cleanroomActive
        ? "ISO cleanroom mode is active. Airflow, filtration, and alternative-design concepts will now follow the selected ISO class template."
        : designMode === "comfort"
          ? "Comfort / general HVAC mode is active. Outdoor-air ventilation is mandatory; ACH is advisory unless explicitly marked mandatory."
          : "ACH or specialty compliance mode is active. Confirm whether the ACH target is mandatory, advisory, or disabled before running optimization.";
    }
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

  function buildEnvelopeBreakdown(inputs, length, width, height) {
    const seed = Object.assign({}, inputs || {});
    const windows = normalizeWindowEntries(seed).filter(function (entry) {
      return (parseFloat(entry.area) || 0) > 0.001;
    });
    const walls = normalizeWallEntries(seed).filter(function (entry) {
      return (parseFloat(entry.area) || 0) > 0.001;
    });
    const windowAreaByOrientation = areaByOrientation(windows);
    const wallGrossAreaByOrientation = areaByOrientation(walls);
    const dominantWindowOrientation = dominantOrientationFromAreas(windowAreaByOrientation, inputs.win_orient || "SE");
    const windowOrientationCount = ORIENTATION_SEQUENCE.filter(function (orientation) {
      return (windowAreaByOrientation[orientation] || 0) > 0.001;
    }).length;
    const windowAreaTotal = windows.reduce(function (sum, entry) {
      return sum + (parseFloat(entry.area) || 0);
    }, 0);
    const wallGrossArea = walls.reduce(function (sum, entry) {
      return sum + (parseFloat(entry.area) || 0);
    }, 0);

    const wallsByOrientation = walls.reduce(function (accumulator, wall) {
      const key = normalizeOrientation(wall.orientation, "S");
      if (!accumulator[key]) {
        accumulator[key] = [];
      }
      accumulator[key].push(wall);
      return accumulator;
    }, {});

    const wallNetAreaByOrientation = {};
    const detailedWalls = [];
    ORIENTATION_SEQUENCE.forEach(function (orientation) {
      const wallEntries = wallsByOrientation[orientation] || [];
      const grossOrientationArea = wallEntries.reduce(function (sum, entry) {
        return sum + (parseFloat(entry.area) || 0);
      }, 0);
      const netOrientationArea = Math.max(0, grossOrientationArea - (windowAreaByOrientation[orientation] || 0));
      wallNetAreaByOrientation[orientation] = roundTo(netOrientationArea, 2);
      wallEntries.forEach(function (entry, index) {
        const grossArea = Math.max(parseFloat(entry.area) || 0, 0);
        const share = grossOrientationArea > 0 ? grossArea / grossOrientationArea : 0;
        detailedWalls.push({
          index: detailedWalls.length + 1,
          orientation: orientation,
          grossArea: roundTo(grossArea, 2),
          netArea: roundTo(netOrientationArea * share, 2),
          orientationFactor: WALL_ORIENTATION_FACTORS[orientation] || 1
        });
      });
    });

    const ceilingArea = Math.max(parseFloat(inputs.ceiling_area) || (length * width) || 0, 0);
    const floorArea = Math.max(parseFloat(inputs.floor_area) || (length * width) || 0, 0);
    const roofExposure = inputs.roof_exp || "top_floor";
    const roofLoadArea = roofExposure === "ground" ? 0 : ceilingArea;

    return {
      windows: windows.map(function (entry, index) {
        return {
          index: index + 1,
          area: roundTo(Math.max(parseFloat(entry.area) || 0, 0), 2),
          orientation: normalizeOrientation(entry.orientation, dominantWindowOrientation)
        };
      }),
      walls: detailedWalls,
      windowAreaByOrientation: windowAreaByOrientation,
      wallGrossAreaByOrientation: wallGrossAreaByOrientation,
      wallNetAreaByOrientation: wallNetAreaByOrientation,
      dominantWindowOrientation: dominantWindowOrientation,
      activeWindowOrientationLabel: windowOrientationCount > 1 ? "Mixed windows" : orientationLabel(dominantWindowOrientation),
      windowAreaTotal: roundTo(windowAreaTotal, 2),
      wallGrossArea: roundTo(wallGrossArea, 2),
      wallNetArea: roundTo(detailedWalls.reduce(function (sum, entry) {
        return sum + entry.netArea;
      }, 0), 2),
      ceilingArea: roundTo(ceilingArea, 2),
      floorArea: roundTo(floorArea, 2),
      roofLoadArea: roundTo(roofLoadArea, 2),
      exposedFloorArea: roofExposure === "ground" ? roundTo(floorArea, 2) : 0,
      floorExposureType: roofExposure === "ground" ? "slab_on_grade" : "internal_or_buffered"
    };
  }

  function buildWeightedSolarProfile(latitude, dayOfYear, solarHour, envelope, solarOptions) {
    const options = solarOptions || {};
    const orientationSeries = SolarEngine.buildOrientationSeries(latitude, dayOfYear, 8, 17, options);
    const seriesByOrientation = {};
    orientationSeries.forEach(function (series) {
      seriesByOrientation[series.orientation] = series;
    });
    const totalWindowArea = Math.max(envelope.windowAreaTotal || 0, 0);
    const dominantOrientation = envelope.dominantWindowOrientation || "SE";
    const referenceSeries = seriesByOrientation[dominantOrientation] || orientationSeries[0];
    const activeCurve = (referenceSeries && referenceSeries.points ? referenceSeries.points : []).map(function (pointRow, index) {
      function weightedField(field) {
        return totalWindowArea > 0
          ? ORIENTATION_SEQUENCE.reduce(function (sum, orientation) {
              const orientationSeriesEntry = seriesByOrientation[orientation];
              const pointEntry = orientationSeriesEntry && orientationSeriesEntry.points[index];
              return sum + ((envelope.windowAreaByOrientation[orientation] || 0) * ((pointEntry && pointEntry[field]) || 0));
            }, 0) / totalWindowArea
          : 0;
      }
      const weightedShgf = totalWindowArea > 0
        ? ORIENTATION_SEQUENCE.reduce(function (sum, orientation) {
            const orientationSeriesEntry = seriesByOrientation[orientation];
            const pointEntry = orientationSeriesEntry && orientationSeriesEntry.points[index];
            return sum + ((envelope.windowAreaByOrientation[orientation] || 0) * ((pointEntry && pointEntry.shgf) || 0));
          }, 0) / totalWindowArea
        : 0;
      return {
        hour: pointRow.hour,
        shgf: roundTo(weightedShgf, 1),
        solarIrradianceWm2: roundTo(weightedField("solarIrradianceWm2"), 1),
        incidentSolarOnGlassWm2: roundTo(weightedField("incidentSolarOnGlassWm2"), 1),
        glassSHGC: pointRow.glassSHGC || options.glassSHGC || 0,
        coolingLoadSolarWm2: weightedShgf,
        clfAdjustedSolarLoadWm2: weightedShgf,
        valueBasis: pointRow.valueBasis || "effective_glass_cooling_load_w_m2",
        altitude: pointRow.altitude,
        azimuth: pointRow.azimuth
      };
    });
    const designPoint = activeCurve.find(function (row) {
      return row.hour === solarHour;
    }) || activeCurve[activeCurve.length - 1] || {
      hour: solarHour,
      shgf: 0,
      altitude: 0,
      azimuth: 0
    };

    return {
      point: designPoint,
      curve: activeCurve,
      orientationSeries: orientationSeries,
      activeOrientation: dominantOrientation,
      activeOrientationLabel: totalWindowArea > 0 ? envelope.activeWindowOrientationLabel : "No windows"
    };
  }

  function calculateRoom(inputs, runtimeOptions) {
    const calculationOptions = runtimeOptions || {};
    const optimizationScenario = activeOptimizationScenario(calculationOptions);
    const length = parseFloat(inputs.len) || 0;
    const width = parseFloat(inputs.wid) || 0;
    const height = parseFloat(inputs.ht) || 0;
    const area = length * width;
    const volume = area * height;
    const occupants = parseFloat(inputs.occ) || 0;
    const freshAirPerPerson = parseFloat(inputs.fresh_cfm) || 0;
    const lightingLoad = parseFloat(inputs.lighting) || 0;
    const equipmentLoad = parseFloat(inputs.equip) || 0;
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
    const envelope = buildEnvelopeBreakdown(inputs, length, width, height);
    const airsideProfile = classifyAirsideProfile(inputs, area);
    const cleanroom = airsideProfile.cleanroom || null;
    const complianceMode = complianceModeForInputs(inputs, airsideProfile);
    const achRequirementMode = achRequirementModeForInputs(inputs, complianceMode);
    const achMandatory = achRequirementMode === "mandatory";
    const ventilationStandards = buildVentilationStandardsContext(inputs, area, occupants, airsideProfile);
    const core = engineeringCoreApi();

    setValue("out_rh", outdoorRelativeHumidity.toFixed(0));

    const occupantLoad = OCCUPANT_LOADS[inputs.occ_act || "seated_light"] || OCCUPANT_LOADS.seated_light;
    const peopleSensible = occupants * occupantLoad.sensible;
    const peopleLatent = occupants * occupantLoad.latent;
    const lightingSensible = area * lightingLoad * 0.9;
    const equipmentSensible = area * equipmentLoad * 0.8;

    const solarOptions = {
      glassSHGC: shadingCoefficient,
      shadingCoefficient: shadingCoefficient,
      coolingLoadFactor: coolingLoadFactor
    };
    const solarProfile = buildWeightedSolarProfile(latitude, dayOfYear, solarHour, envelope, solarOptions);
    const solarPoint = solarProfile.point;
    const solarCurve = solarProfile.curve;
    const orientationSeries = solarProfile.orientationSeries;
    const windowSensible = envelope.windows.reduce(function (sum, windowEntry) {
      const windowPoint = SolarEngine.hourlySHGF(latitude, dayOfYear, solarHour, windowEntry.orientation, solarOptions);
      return sum + (windowEntry.area * windowPoint.coolingLoadSolarWm2);
    }, 0);

    const wallExposure = envelope.walls.length;
    const externalWallArea = envelope.wallNetArea;
    const wallCltdBase = CLTD_WALL[Math.min(Math.max(wallExposure, 1), 4)] || CLTD_WALL[2];
    const roofIsExposed = roofExposure !== "ground";
    const roofCltdBase = roofIsExposed ? (CLTD_ROOF_MAP[roofExposure] || CLTD_ROOF_MAP.top_floor) : 0;
    const wallCltdCorrections = envelope.walls.map(function (wallEntry) {
      return core && typeof core.correctedCltd === "function"
        ? core.correctedCltd({
            baseCltd: wallCltdBase,
            outdoorDryBulb: outdoorDryBulb,
            indoorDryBulb: indoorDryBulb,
            solarShgf: solarPoint.shgf,
            solarAltitudeDeg: solarPoint.altitude,
            orientationFactor: wallEntry.orientationFactor || 1,
            surfaceType: "wall"
          })
        : {
            correctedCltd: wallCltdBase,
            temperatureCorrection: 0,
            solarCorrection: 0,
            baseCltd: wallCltdBase
          };
    });
    const wallCltd = wallCltdCorrections.length
      ? wallCltdCorrections.reduce(function (sum, entry) { return sum + (entry.correctedCltd || wallCltdBase); }, 0) / wallCltdCorrections.length
      : wallCltdBase;
    const roofCltdCorrection = roofIsExposed && core && typeof core.correctedCltd === "function"
      ? core.correctedCltd({
          baseCltd: roofCltdBase,
          outdoorDryBulb: outdoorDryBulb,
          indoorDryBulb: indoorDryBulb,
          solarShgf: solarPoint.shgf,
          solarAltitudeDeg: solarPoint.altitude,
          orientationFactor: 1.08,
          surfaceType: "roof"
        })
      : {
          correctedCltd: roofCltdBase,
          temperatureCorrection: 0,
          solarCorrection: 0,
          baseCltd: roofCltdBase
        };
    const wallSensible = Math.max(0, envelope.walls.reduce(function (sum, wallEntry, index) {
      const wallCltdEntry = wallCltdCorrections[index] || { correctedCltd: wallCltdBase };
      return sum + (wallUValue * wallEntry.netArea * (wallCltdEntry.correctedCltd || wallCltdBase) * (wallEntry.orientationFactor || 1));
    }, 0));
    const roofSensible = roofIsExposed
      ? Math.max(0, roofUValue * envelope.ceilingArea * (roofCltdCorrection.correctedCltd || roofCltdBase))
      : 0;
    const floorLoadType = roofExposure === "ground" ? "slab_on_grade" : "internal_floor";
    const floorAssumption = floorLoadType === "slab_on_grade"
      ? "Slab-on-grade floor conduction is limited in cooling mode and is not treated with roof CLTD."
      : "Internal floor is assumed adjacent to conditioned or buffered space; no roof CLTD is applied.";
    const floorSensible = 0;
    const roofLoadType = roofIsExposed ? "exposed_roof_or_ceiling" : "not_exposed_roof";

    const pressurePa = pressureAtElevation(elevation);
    const freshAirCfm = ventilationStandards.designOutdoorAirCfm;
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
    const infiltration = buildInfiltrationContext({
      area: area,
      volume: volume,
      height: height,
      occupants: occupants,
      roofExposure: roofExposure,
      envelope: envelope,
      airsideProfile: airsideProfile,
      ventilation: ventilationStandards,
      inputs: inputs
    });
    const infiltrationM3S = infiltration.airflowCfm * CFM_TO_M3S;
    const infiltrationMassFlowDa = safeDiv(infiltrationM3S, svOut, 0);
    const infiltrationTotal = infiltrationMassFlowDa * (hOut - hIn) * 1000;
    const infiltrationSensible = infiltrationMassFlowDa * ventCp * (outdoorDryBulb - indoorDryBulb) * 1000;
    const infiltrationLatent = infiltrationTotal - infiltrationSensible;

    const spaceSensible = peopleSensible + lightingSensible + equipmentSensible + windowSensible + wallSensible + roofSensible + infiltrationSensible;
    const spaceLatent = peopleLatent + infiltrationLatent;
    const spaceTotal = spaceSensible + spaceLatent;
    const totalSensible = spaceSensible + freshAirSensible;
    const totalLatent = spaceLatent + freshAirLatent;
    const totalLoad = totalSensible + totalLatent;
    const systemShr = calculateShrRatio(totalSensible, totalLatent, 0.85);
    const roomShr = calculateShrRatio(spaceSensible, spaceLatent, systemShr);

    const trDesign = totalLoad / 3517;
    const preferredSelectionMarginBase = selectPreferredReserveMargin(inputSafetyFactor, airsideProfile, trDesign);
    const preferredSelectionMargin = applyOptimizationReserveMargin(preferredSelectionMarginBase, calculationOptions);
    const airflowDesignBase = selectAirflowDesignBasis(indoorDryBulb, indoorRelativeHumidity, roomShr, height, airsideProfile);
    const airflowDesign = applyOptimizationAirflowStrategy(airflowDesignBase, indoorDryBulb, airsideProfile, calculationOptions);
    const roomDeltaTDesign = airflowDesign.roomDeltaTDesign;
    const designSupplyTemp = airflowDesign.supplyTempDesign;
    const designAirFactorTemp = (indoorDryBulb + designSupplyTemp) / 2;
    const sensibleAirFactor = sensibleCapacityPerCfmDeltaC(designAirFactorTemp, wIn, pressurePa);
    const cfmThermal = Math.max(safeDiv(spaceSensible, sensibleAirFactor * roomDeltaTDesign, 0), 0);
    const cfmVent = Math.max(freshAirCfm, 0);
    const cfmAch = Math.max(volume > 0 ? safeDiv(volume * airsideProfile.achRequired, 3600 * CFM_TO_M3S, 0) : 0, 0);
    const allowProcessMakeupAir = !!(cleanroom || airsideProfile.processVentilationStrategy === "localized_capture" || airsideProfile.processVentilationStrategy === "mixed_general_plus_local_capture");
    const cfmAchForTopology = achMandatory ? cfmAch : 0;
    const cfmCleanroom = cleanroom ? Math.max(cleanroom.designAirflowCfm || cfmAch, cfmAch) : 0;
    const airflowStreams = core && typeof core.resolveAirflowStreams === "function"
      ? core.resolveAirflowStreams({
          thermalAirflowCfm: cfmThermal,
          ventilationAirflowCfm: cfmVent,
          achAirflowCfm: cfmAchForTopology,
          cleanroomAirflowCfm: cfmCleanroom,
          cleanroomMode: !!cleanroom,
          complianceMode: complianceMode,
          achRequirementMode: achRequirementMode,
          forceDedicatedVentilation: optimizationForceDedicatedVentilation(calculationOptions),
          allowProcessMakeupAir: allowProcessMakeupAir,
          processMode: allowProcessMakeupAir && !cleanroom
        })
      : {
          architectureMode: cleanroom ? "decoupled_cleanroom" : "single_mixed_air",
          decoupledVentilation: !!cleanroom,
          roomSupplyAirflowCfm: Math.max(cfmThermal, cfmVent, cfmCleanroom),
          coolingCoilAirflowCfm: cleanroom ? cfmThermal : Math.max(cfmThermal, cfmVent),
          dedicatedVentilationAirflowCfm: cleanroom ? cfmVent : 0,
          ventilationIntoCoolingCoilAirflowCfm: cleanroom ? 0 : cfmVent,
          neutralRecirculationAirflowCfm: cleanroom ? Math.max(cfmCleanroom - cfmThermal, 0) : 0,
          processExcessAirflowCfm: cleanroom || !allowProcessMakeupAir ? 0 : Math.max(cfmAch - Math.max(cfmThermal, cfmVent), 0),
          totalDeliveredAirflowCfm: cleanroom ? Math.max(cfmThermal, cfmCleanroom) : Math.max(cfmThermal, cfmVent, cfmAch),
          roomAirflowConstraint: airflowConstraintName(cfmThermal, cfmVent, cleanroom ? cfmCleanroom : cfmAch),
          coolingAirflowConstraint: airflowConstraintName(cfmThermal, cleanroom ? 0 : cfmVent, 0),
          notes: []
        };
    const coilOutdoorAirCfm = Math.max(airflowStreams.ventilationIntoCoolingCoilAirflowCfm || 0, 0);
    const cfmConditionedRequired = Math.max(airflowStreams.roomSupplyAirflowCfm || 0, 0);
    const cfmCoolingCoilRequired = Math.max(airflowStreams.coolingCoilAirflowCfm || cfmThermal, 0);
    const cfmDedicatedVentilationRequired = Math.max(airflowStreams.dedicatedVentilationAirflowCfm || 0, 0);
    const cfmNeutralRecirculationRequired = Math.max(airflowStreams.neutralRecirculationAirflowCfm || 0, 0);
    const cfmProcessExcessRequired = Math.max(airflowStreams.processExcessAirflowCfm || 0, 0);
    const cfmPrimaryReturnRequired = Math.max(cfmCoolingCoilRequired, 0);
    const cfmCoolingCoil = cfmCoolingCoilRequired > 0 ? roundUpTo(cfmCoolingCoilRequired, 25) : 0;
    const cfmDedicatedVentilation = cfmDedicatedVentilationRequired > 0 ? roundUpTo(cfmDedicatedVentilationRequired, 25) : 0;
    const cfmNeutralRecirculationBase = cfmNeutralRecirculationRequired > 0 ? roundUpTo(cfmNeutralRecirculationRequired, 25) : 0;
    const cfmConditioned = Math.max(
      roundUpTo(cfmConditionedRequired, 25),
      cfmCoolingCoil + cfmNeutralRecirculationBase
    );
    const cfmNeutralRecirculation = Math.max(cfmConditioned - cfmCoolingCoil, cfmNeutralRecirculationBase);
    const cfmPrimaryReturn = cfmPrimaryReturnRequired > 0 ? roundUpTo(cfmPrimaryReturnRequired, 25) : 0;
    const cfmProcessExcess = cfmProcessExcessRequired > 0 ? roundUpTo(cfmProcessExcessRequired, 25) : 0;
    const cfmVentilation = cfmDedicatedVentilation + cfmProcessExcess;
    const cfmRequired = cfmConditionedRequired + cfmDedicatedVentilationRequired + cfmProcessExcessRequired;
    const cfmFinal = cfmConditioned + cfmVentilation;
    const airflowConstraint = airflowStreams.roomAirflowConstraint || airflowConstraintName(cfmThermal, cfmVent, cleanroom ? cfmCleanroom : cfmAch);
    const coolingAirflowConstraint = airflowStreams.coolingAirflowConstraint || airflowConstraintName(cfmThermal, cfmVent, 0);
    const dpOut = dewPoint(outdoorDryBulb, outdoorRelativeHumidity);
    const dpIn = dewPoint(indoorDryBulb, indoorRelativeHumidity);
    const wbOut = wetBulb(outdoorDryBulb, outdoorRelativeHumidity);
    const wbIn = wetBulb(indoorDryBulb, indoorRelativeHumidity);
    const supplyM3S = cfmCoolingCoil * CFM_TO_M3S;
    const supplyMassFlowDa = safeDiv(supplyM3S, svIn, 0);
    const oaFraction = clamp(safeDiv(coilOutdoorAirCfm, Math.max(cfmCoolingCoil, 1), 0), 0, 1);
    const mixedAirHumidity = oaFraction * wOut + (1 - oaFraction) * wIn;
    const mixedAirEnthalpy = oaFraction * hOut + (1 - oaFraction) * hIn;
    const mixedAirTemp = dryBulbFromEnthalpyHumidity(mixedAirEnthalpy, mixedAirHumidity);
    const roomCp = 1.006 + 1.86 * wIn;
    const airflowDeltaT = Math.max(safeDiv(spaceSensible / 1000, Math.max(supplyMassFlowDa, 0.0001) * roomCp, 0), 0);
    let supplyTemp = indoorDryBulb - airflowDeltaT;
    let supplyEnthalpy = hIn - safeDiv(spaceTotal / 1000, Math.max(supplyMassFlowDa, 0.0001), 0);
    let supplyHumidity = humidityRatioFromEnthalpyTemp(supplyEnthalpy, supplyTemp);
    let psychroProcessNote = "";
    let roomPsychro = null;
    let adpPoint = null;

    if (core && typeof core.solveRoomPsychrometrics === "function") {
      roomPsychro = core.solveRoomPsychrometrics({
        roomTempC: indoorDryBulb,
        roomHumidityRatio: wIn,
        roomEnthalpy: hIn,
        roomSensibleW: spaceSensible,
        roomTotalW: spaceTotal,
        supplyMassFlowDa: supplyMassFlowDa,
        pressurePa: pressurePa,
        mixedAirTempC: mixedAirTemp,
        mixedAirHumidityRatio: mixedAirHumidity,
        mixedAirEnthalpy: mixedAirEnthalpy,
        initialSupplyTempC: designSupplyTemp,
        minSupplyTempC: cleanroom ? 11 : 7,
        maxSupplyTempC: indoorDryBulb - 0.5,
        toleranceShr: 0.02,
        toleranceEnthalpy: 0.5
      });
      supplyTemp = roomPsychro.supplyTemp;
      supplyHumidity = roomPsychro.supplyHumidity;
      supplyEnthalpy = roomPsychro.supplyEnthalpy;
      psychroProcessNote = roomPsychro.processNote || "";
      adpPoint = {
        temp: roomPsychro.adpTemp,
        humidity: roomPsychro.adpHumidity,
        bypassFactor: roomPsychro.bypassFactor,
        bfTemp: roomPsychro.bfTemp,
        bfHumidity: roomPsychro.bfHumidity,
        humidityError: roomPsychro.adpHumidityError,
        method: roomPsychro.adpMethod
      };
    } else {
      const supplySatHumidity = saturationHumidityRatio(supplyTemp, pressurePa);

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

      adpPoint = solveAdpFromProcess(mixedAirTemp, mixedAirHumidity, supplyTemp, supplyHumidity, pressurePa);
    }

    const adpTemp = adpPoint.temp;
    const adpHumidity = adpPoint.humidity;
    const bypassFactor = adpPoint.bypassFactor;
    const dedicatedVentilationLoad = airflowStreams.decoupledVentilation ? Math.max(freshAirTotal, 0) : 0;
    const coilTotalLoad = roomPsychro
      ? Math.max(roomPsychro.coilTotalLoad || 0, 0)
      : Math.max(0, supplyMassFlowDa * (mixedAirEnthalpy - supplyEnthalpy) * 1000);
    const coilCp = 1.006 + 1.86 * ((mixedAirHumidity + supplyHumidity) / 2);
    const coilSensible = roomPsychro
      ? Math.max(roomPsychro.coilSensible || 0, 0)
      : supplyMassFlowDa * coilCp * (mixedAirTemp - supplyTemp) * 1000;
    const coilLatent = roomPsychro
      ? Math.max(roomPsychro.coilLatent || 0, 0)
      : coilTotalLoad - coilSensible;
    const roomShrPsychro = roomPsychro ? roomPsychro.roomShrPsychro : roomShr;
    const roomShrError = roomPsychro ? roomPsychro.shrError : 0;
    const psychroEnthalpyError = roomPsychro ? roomPsychro.enthalpyBalanceErrorKJkg : 0;
    const trCoolingCoil = coilTotalLoad / 3517;
    const trDedicatedVentilation = dedicatedVentilationLoad / 3517;
    const trAirflow = trCoolingCoil;
    const trFinal = Math.max(trDesign, trAirflow);
    const trEquipmentSelection = airflowStreams.decoupledVentilation
      ? Math.max(trCoolingCoil, spaceTotal / 3517)
      : trFinal;
    const trCatalog = nextStandardTR(trFinal);
    const trCatalogEquipment = nextStandardTR(trEquipmentSelection);
    const designCfmPerTR = safeDiv(cfmCoolingCoil, Math.max(trEquipmentSelection, 0.1), 0);
    const totalCfmPerTR = safeDiv(cfmFinal, Math.max(trEquipmentSelection, 0.1), 0);
    const recirculationCfm = cfmConditioned;
    const cfmRecirculationBypass = cfmNeutralRecirculation;
    const cfmTotalRoomReturn = cfmFinal;
    const achRecirculation = volume > 0 ? cfmConditioned * CFM_TO_M3S * 3600 / volume : 0;
    const achTotalRoom = volume > 0 ? cfmFinal * CFM_TO_M3S * 3600 / volume : 0;
    const ach = cleanroom || allowProcessMakeupAir ? achTotalRoom : achRecirculation;
    const lowCfmPerTrNote = designCfmPerTR < 200
      ? "Low CFM/TR due to low supply air temperature (high ΔT system)"
      : "";
    const airflowProcessNote = cleanroom
      ? cleanroom.classLabel + " cleanroom mode keeps the room recirculation stream separate from the active cooling-coil airflow. Outdoor air is treated as dedicated make-up rather than a mixed-air override."
      : cfmProcessExcess > 0
      ? (airsideProfile.processVentilationStrategy === "localized_capture"
          ? "Large industrial hall ventilation is limited to general hall ACH only. Any remaining process airflow is treated as separate localized exhaust / make-up air outside the cooling coil."
          : "ACH excess is decoupled from the cooling coil. Psychrometric supply conditions use cooling airflow only, while the extra ACH is treated as separate make-up / process air.")
      : cfmConditioned > cfmThermal + 1
        ? "Ventilation raises the conditioned supply volume above the thermal minimum, so the actual room ΔT is lower than the design thermal ΔT."
        : "Thermal sensible duty governs, so the actual room ΔT closely follows the design thermal ΔT.";
    const psychroSeparationNote = cfmProcessExcess > 0
      ? "Extra ACH airflow is handled outside the cooling stream, so the OA-MA-SA psychrometric process is plotted on cooling airflow only."
      : airflowStreams.decoupledVentilation
        ? "Dedicated outdoor / make-up air is handled outside the recirculation cooling coil, so the OA-MA-SA psychrometric process is plotted on the active cooling stream only."
      : "";

    assertAirflowInvariant(
      Math.abs(cfmConditioned - (cfmCoolingCoil + cfmNeutralRecirculation)) <= 1,
      "Recirculation airflow must resolve to cooling airflow plus non-coil recirculation airflow."
    );
    assertAirflowInvariant(
      Math.abs(cfmFinal - (cfmConditioned + cfmVentilation)) <= 1,
      "Total room airflow must resolve to recirculation airflow plus ventilation / make-up airflow."
    );
    assertAirflowInvariant(
      Math.abs((supplyM3S / CFM_TO_M3S) - cfmCoolingCoil) <= 0.5,
      "Psychrometric mass flow must use cooling airflow only."
    );
    assertAirflowInvariant(
      Math.abs(cfmPrimaryReturn - cfmCoolingCoil) <= 1,
      "Invalid coil airflow loop."
    );

    let autoZoning = buildAutoZoningPlan({
      length: length,
      width: width,
      conditionedCFM: cfmConditioned,
      processCFM: cfmProcessExcess,
      trFinal: trEquipmentSelection,
      airsideProfile: airsideProfile,
      forceMinZones: optimizationForceMinZones(calculationOptions, 0)
    });

    let diffuserLayout = DiffuserLayout.computeLayout({
      length: length,
      width: width,
      ceilingHeight: height,
      totalAirflowCFM: cfmConditioned,
      targetCFM: cleanroom ? cleanroom.targetCFM : designCfmPerTR < 220 ? 220 : 250,
      minCFMPerDiffuser: cleanroom ? cleanroom.minCFMPerModule : 150,
      maxCFMPerDiffuser: cleanroom ? cleanroom.maxCFMPerModule : 400,
      industrialAirflowPerAreaThreshold: airsideProfile.type === "Industrial / process" ? 18 : 22,
      forceIndustrialTerminals: airsideProfile.highBayAirDistribution,
      largeIndustrialHall: airsideProfile.largeIndustrialHall,
      cleanroomMode: !!cleanroom,
      cleanroomClassNumber: cleanroom ? cleanroom.classNumber : 0,
      cleanroomSupplyDeviceType: cleanroom
        ? cleanroom.classNumber <= 5
          ? "Laminar flow HEPA module"
          : "HEPA ceiling module"
        : "",
      cleanroomDistributionMode: cleanroom
        ? cleanroom.classNumber <= 5
          ? "Cleanroom downflow"
          : "Cleanroom recirculation"
        : "",
      cleanroomMaxSpacingFactor: cleanroom ? cleanroom.maxSpacingFactor : 0,
      cleanroomVerticalReachFactor: cleanroom ? cleanroom.verticalReachFactor : 0,
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
        trFinal: trEquipmentSelection,
        airsideProfile: airsideProfile,
        layoutHint: diffuserLayout,
        currentZoneCount: autoZoning.zoneCount,
        forceMinZones: optimizationForceMinZones(calculationOptions, autoZoning.zoneCount)
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
        targetCFM: cleanroom ? cleanroom.targetCFM : designCfmPerTR < 220 ? 220 : 250,
        minCFMPerDiffuser: cleanroom ? cleanroom.minCFMPerModule : 150,
        maxCFMPerDiffuser: cleanroom ? cleanroom.maxCFMPerModule : 400,
        industrialAirflowPerAreaThreshold: airsideProfile.type === "Industrial / process" ? 18 : 22,
        forceIndustrialTerminals: airsideProfile.highBayAirDistribution,
        largeIndustrialHall: airsideProfile.largeIndustrialHall,
        cleanroomMode: !!cleanroom,
        cleanroomClassNumber: cleanroom ? cleanroom.classNumber : 0,
        cleanroomSupplyDeviceType: cleanroom
          ? cleanroom.classNumber <= 5
            ? "Laminar flow HEPA module"
            : "HEPA ceiling module"
          : "",
        cleanroomDistributionMode: cleanroom
          ? cleanroom.classNumber <= 5
            ? "Cleanroom downflow"
            : "Cleanroom recirculation"
          : "",
        cleanroomMaxSpacingFactor: cleanroom ? cleanroom.maxSpacingFactor : 0,
        cleanroomVerticalReachFactor: cleanroom ? cleanroom.verticalReachFactor : 0,
        zoningPlan: autoZoning
      });
      zoningIteration += 1;
    }

    const mainVelocityFpm = cleanroom ? 600 : diffuserLayout.isIndustrialMode ? 800 : 650;
    const branchVelocityFpm = cleanroom ? 500 : diffuserLayout.isIndustrialMode ? 650 : 450;
    const returnVelocityFpm = cleanroom ? 350 : diffuserLayout.isIndustrialMode ? 500 : 350;
    const processVelocityFpm = cleanroom ? 700 : airsideProfile.type === "Industrial / process" ? 850 : 700;
    const mainDuct = ductSize(cfmConditioned, mainVelocityFpm);
    let branchDuct = ductSize(diffuserLayout.cfmPerDiffuser, branchVelocityFpm);
    const returnDuct = ductSize(Math.max(recirculationCfm, cfmConditioned * (airflowStreams.decoupledVentilation ? 0.9 : 0.6)), returnVelocityFpm);
    const processDuct = cfmProcessExcess > 0 ? ductSize(cfmProcessExcess, processVelocityFpm) : null;
    const ductLengthFt = (length + width) * 3.28084 * 1.5;
    const supplyMainLoss = estimateDuctSectionLoss(cfmConditioned, mainDuct, ductLengthFt, "supply", diffuserLayout.diffuserCount || 1);
    const returnMainLoss = estimateDuctSectionLoss(Math.max(recirculationCfm, cfmConditioned * (airflowStreams.decoupledVentilation ? 0.9 : 0.6)), returnDuct, ductLengthFt * 0.85, "return", diffuserLayout.returns && diffuserLayout.returns.count ? diffuserLayout.returns.count : 1);
    const pressureAdjustments = optimizationPressureAdjustments(calculationOptions);
    const ductFriction = Math.max(
      ((supplyMainLoss.ductFriction || 0) + (returnMainLoss.ductFriction || 0)) * pressureAdjustments.ductFrictionFactor
      + pressureAdjustments.ductFrictionDeltaPa,
      0
    );
    const fittingLoss = Math.max(
      ((supplyMainLoss.fittingLoss || 0) + (returnMainLoss.fittingLoss || 0)) * pressureAdjustments.fittingLossFactor
      + pressureAdjustments.fittingLossDeltaPa,
      0
    );
    const equipmentLoss = Math.max(
      (EQUIP_PRESSURE.filter_clean + EQUIP_PRESSURE.cooling_coil + EQUIP_PRESSURE.mixing_box + EQUIP_PRESSURE.diffuser_grille + 30) * pressureAdjustments.equipmentLossFactor
      + pressureAdjustments.equipmentLossDeltaPa,
      0
    );
    const baseTotalEsp = ductFriction + fittingLoss + equipmentLoss;
    const dedicatedVentilationVelocityFpm = cleanroom ? 550 : 600;
    const dedicatedVentilationDuct = cfmDedicatedVentilation > 0
      ? ductSize(cfmDedicatedVentilation, dedicatedVentilationVelocityFpm)
      : null;
    const dedicatedVentilationLoss = dedicatedVentilationDuct
      ? estimateDuctSectionLoss(cfmDedicatedVentilation, dedicatedVentilationDuct, ductLengthFt, "supply", autoZoning.zoneCount || 1)
      : null;
    const dedicatedVentilationEquipmentLoss = cfmDedicatedVentilation > 0
      ? Math.max(
          (EQUIP_PRESSURE.filter_clean + (trDedicatedVentilation > 0.01 ? EQUIP_PRESSURE.cooling_coil : 0) + EQUIP_PRESSURE.diffuser_grille) * pressureAdjustments.equipmentLossFactor,
          0
        )
      : 0;
    const dedicatedVentilationEsp = dedicatedVentilationLoss
      ? roundTo(
          ((dedicatedVentilationLoss.ductFriction || 0) * pressureAdjustments.ductFrictionFactor)
          + ((dedicatedVentilationLoss.fittingLoss || 0) * pressureAdjustments.fittingLossFactor)
          + dedicatedVentilationEquipmentLoss,
          0
        )
      : 0;
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
        oaCFM: airflowStreams.decoupledVentilation ? 0 : freshAirCfm,
        trFinal: trEquipmentSelection,
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
        trFinal: trEquipmentSelection,
        airsideProfile: airsideProfile,
        forceMinZones: Math.max(nextZoneCount, optimizationForceMinZones(calculationOptions, autoZoning.zoneCount))
      });
      diffuserLayout = DiffuserLayout.computeLayout({
        length: length,
        width: width,
        ceilingHeight: height,
        totalAirflowCFM: cfmConditioned,
        targetCFM: cleanroom ? cleanroom.targetCFM : designCfmPerTR < 220 ? 220 : 250,
        minCFMPerDiffuser: cleanroom ? cleanroom.minCFMPerModule : 150,
        maxCFMPerDiffuser: cleanroom ? cleanroom.maxCFMPerModule : 400,
        industrialAirflowPerAreaThreshold: airsideProfile.type === "Industrial / process" ? 18 : 22,
        cleanroomMode: !!cleanroom,
        cleanroomClassNumber: cleanroom ? cleanroom.classNumber : 0,
        cleanroomSupplyDeviceType: cleanroom
          ? cleanroom.classNumber <= 5
            ? "Laminar flow HEPA module"
            : "HEPA ceiling module"
          : "",
        cleanroomDistributionMode: cleanroom
          ? cleanroom.classNumber <= 5
            ? "Cleanroom downflow"
            : "Cleanroom recirculation"
          : "",
        cleanroomMaxSpacingFactor: cleanroom ? cleanroom.maxSpacingFactor : 0,
        cleanroomVerticalReachFactor: cleanroom ? cleanroom.verticalReachFactor : 0,
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
      trFinal: trEquipmentSelection,
      trCatalog: trCatalogEquipment,
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
      Math.max(recirculationCfm, cfmConditioned * (airflowStreams.decoupledVentilation ? 0.9 : 0.6)),
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
    const equipmentSelection = zoneAhuStrategy.aggregateSelection || EquipmentEngine.selectSystem(trEquipmentSelection, cfmConditioned, baseTotalEsp, {
      catalogTR: trCatalogEquipment,
      designCFMPerTR: safeDiv(cfmCoolingCoil, Math.max(trEquipmentSelection, 0.1), 0),
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
    const dedicatedVentilationSelection = cfmDedicatedVentilation > 0
      ? EquipmentEngine.selectSystem(Math.max(trDedicatedVentilation, 0.1), cfmDedicatedVentilation, Math.max(dedicatedVentilationEsp, 120), {
          catalogTR: nextStandardTR(Math.max(trDedicatedVentilation, 0.1)),
          designCFMPerTR: safeDiv(cfmDedicatedVentilation, Math.max(trDedicatedVentilation, 0.1), 0),
          preferredMargin: Math.min(preferredSelectionMargin, 0.1),
          airflowConstraint: "ventilation"
        })
      : null;
    const coolingSystemSelection = cfmCoolingCoil > 0
      ? (Math.abs(cfmCoolingCoil - cfmConditioned) <= 1 && cfmNeutralRecirculation <= 1 && cfmDedicatedVentilation <= 1 && cfmProcessExcess <= 1
          ? equipmentSelection
          : EquipmentEngine.selectSystem(Math.max(trEquipmentSelection, 0.1), cfmCoolingCoil, baseTotalEsp, {
              catalogTR: trCatalogEquipment,
              designCFMPerTR: safeDiv(cfmCoolingCoil, Math.max(trEquipmentSelection, 0.1), 0),
              preferredMargin: preferredSelectionMargin,
              airflowConstraint: "thermal"
            }))
      : null;
    const recirculationSystemSelection = equipmentSelection;
    const coolingAndRecirculationShareFan = coolingSystemSelection === recirculationSystemSelection;
    const coolingFanDesignKW = coolingSystemSelection && !coolingAndRecirculationShareFan
      ? Math.max(
          coolingSystemSelection.electricalFanKWTotal || 0,
          coolingSystemSelection.recommendedMotorKW || 0
        )
      : 0;
    const recirculationFanDesignKW = recirculationSystemSelection
      ? Math.max(
          recirculationSystemSelection.electricalFanKWTotal || 0,
          recirculationSystemSelection.recommendedMotorKW || 0
        )
      : 0;
    const ventilationFanDesignKW = roundTo(
      (dedicatedVentilationSelection
        ? Math.max(dedicatedVentilationSelection.electricalFanKWTotal || 0, dedicatedVentilationSelection.recommendedMotorKW || 0)
        : 0)
      + (processAirSelection
        ? Math.max(processAirSelection.motorKW || 0, processAirSelection.brakeKW || 0)
        : 0),
      2
    );
    const energyOptimization = buildEnergyOptimizationPlan({
      zoneAhuStrategy: zoneAhuStrategy,
      zoneDuctPlan: zoneDuctPlan,
      conditionedCFM: cfmConditioned,
      processCFM: cfmProcessExcess,
      airsideProfile: airsideProfile,
      trFinal: trFinal,
      supplementalSelections: [dedicatedVentilationSelection].filter(Boolean)
    });
    const totalOperatingFanKW = roundTo(
      (coolingAndRecirculationShareFan ? 0 : coolingFanDesignKW)
      + recirculationFanDesignKW
      + ventilationFanDesignKW,
      2
    );
    energyOptimization.totalElectricalFanKW = totalOperatingFanKW;
    energyOptimization.specificFanPowerKWPerTR = roundTo(safeDiv(totalOperatingFanKW, Math.max(trFinal, 0.1), 0), 2);
    energyOptimization.fanPowerBasis = coolingAndRecirculationShareFan
      ? "Cooling coil and room recirculation share the same supply fan; cooling fan kW is not double-counted."
      : "Cooling, recirculation, and ventilation fan kW are separate physical fan paths.";

    const systemRecommendation = recommendSystemType({
      airsideProfile: airsideProfile,
      zoning: autoZoning,
      diffuserLayout: diffuserLayout,
      conditionedCFM: cfmConditioned,
      processCFM: cfmProcessExcess,
      oaFraction: oaFraction,
      trFinal: trFinal,
      area: area,
      systemArchitecture: airflowStreams,
      coolingCoilAirflowCfm: cfmCoolingCoil,
      dedicatedVentilationAirflowCfm: cfmDedicatedVentilation,
      trCoolingCoil: trCoolingCoil,
      trDedicatedVentilation: trDedicatedVentilation
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
    const engineeringAssumptions = []
      .concat(infiltration.assumptions || [])
      .concat(roomPsychro && roomPsychro.assumptions ? roomPsychro.assumptions : [])
      .concat(airflowStreams.notes || [])
      .concat([
        "Wall CLTD base " + formatNumber(wallCltdBase, 1) + " corrected to about " + formatNumber(wallCltd, 1) + " with outdoor dry-bulb and solar adjustment.",
        "Roof CLTD base " + formatNumber(roofCltdBase, 1) + " corrected to about " + formatNumber(roofCltdCorrection.correctedCltd || roofCltdBase, 1) + ".",
        "Pressure loss uses Darcy-Weisbach friction plus fitting K-factors when the engineering core is active.",
        "Annual energy uses the Python bin-method model with part-load COP and fan cube-law behavior."
      ]);
    const designValidation = core && typeof core.buildDesignValidation === "function"
      ? core.buildDesignValidation({
          psychro: roomPsychro || {
            roomShrLoad: roomShr,
            roomShrPsychro: roomShrPsychro,
            enthalpyBalanceErrorKJkg: psychroEnthalpyError,
            supplyTemp: supplyTemp
          },
          roomShrLoad: roomShr,
          roomShrPsychro: roomShrPsychro,
          enthalpyBalanceErrorKJkg: psychroEnthalpyError,
	          achActual: ach,
	          achRequired: Math.max(airsideProfile.achRequired || 0, cleanroom ? cleanroom.designAch || 0 : 0),
	          complianceMode: complianceMode,
	          achRequirementMode: achRequirementMode,
	          achRequiredAirflowCfm: cfmAch,
	          achDeliveredAirflowCfm: cfmFinal,
          ventilationProvidedCfm: freshAirCfm,
          ventilationRequiredCfm: ventilationStandards.minimumOutdoorAirCfm || 0,
          selectedTR: (equipmentSelection && equipmentSelection.ahu ? equipmentSelection.ahu.capacityTR : trCatalogEquipment)
            + (dedicatedVentilationSelection && dedicatedVentilationSelection.ahu ? dedicatedVentilationSelection.ahu.capacityTR : trDedicatedVentilation),
          trFinal: trFinal,
          totalEspPa: totalEsp,
          supplyTempC: supplyTemp,
          lowSupplyTempLimit: cleanroom ? 11 : airsideProfile.type === "Industrial / process" ? 8.5 : 10.5,
          spaceSensibleW: spaceSensible,
          spaceLatentW: spaceLatent,
          sensibleW: totalSensible,
          latentW: totalLatent,
          totalLoadW: totalLoad,
          trDesign: trDesign,
          catalogTR: trCatalogEquipment,
          designCfmPerTR: designCfmPerTR,
          infiltrationAch: infiltration.designAch || 0,
          roomSupplyAirflowCfm: cfmConditioned,
          recirculationAirflowCfm: cfmConditioned,
          coolingCoilAirflowCfm: cfmCoolingCoil,
          dedicatedVentilationAirflowCfm: cfmDedicatedVentilation,
          processMakeupAirCfm: cfmProcessExcess,
          bypassRecirculationCfm: cfmRecirculationBypass,
          outdoorAirThroughCoilCfm: coilOutdoorAirCfm,
          totalRoomSupplyCfm: cfmFinal,
          processMode: allowProcessMakeupAir && !cleanroom,
          processStreamDefined: cfmProcessExcess <= 0 || !!processAirSelection,
          dedicatedVentilationStreamDefined: cfmDedicatedVentilation <= 0 || !!dedicatedVentilationSelection,
          allowBypassRecirculation: !!cleanroom,
          energyConditionedAirflowCfm: cfmConditioned,
          energyProcessAirflowCfm: cfmVentilation,
          selectedAhuModel: equipmentSelection && equipmentSelection.ahu ? equipmentSelection.ahu.model : "",
          boqAhuModel: equipmentSelection && equipmentSelection.ahu ? equipmentSelection.ahu.model : "",
          solarGainFactorWm2: solarPoint && solarPoint.shgf ? solarPoint.shgf : 0,
          diffuserSpacingX: diffuserLayout.spacingX || 0,
          diffuserSpacingY: diffuserLayout.spacingY || 0,
          diffuserCount: diffuserLayout.diffuserCount || 0,
          diffuserOverlapCount: diffuserLayout.overlapCount || 0,
	          ductFrictionPa: ductFrictionDisplay,
	          ductFrictionPaPerM: safeDiv(ductFrictionDisplay, Math.max(ductLengthFtDisplay * 0.3048, 0.1), 0),
	          ductLengthM: ductLengthFtDisplay * 0.3048,
          fittingLossPa: fittingLossDisplay,
          equipmentLossPa: equipmentLossDisplay,
          coilAirflowUsedCfm: cfmCoolingCoil,
          returnAirToCoilCfm: cfmPrimaryReturn,
          cfmPerTrAirflowCfm: cfmCoolingCoil,
          cleanroomMode: !!cleanroom,
          decoupledVentilation: !!airflowStreams.decoupledVentilation,
          dataCompleteness: [length, width, height, outdoorDryBulb, outdoorWetBulb, indoorDryBulb, indoorRelativeHumidity].filter(function (value) {
            return Number.isFinite(value) && value !== 0;
          }).length / 7,
          assumptions: engineeringAssumptions
        })
      : {
          status: "COMPLIANT",
          summary: "Engineering core validation not available.",
          findings: [],
          confidenceScore: 0.75,
          assumptions: engineeringAssumptions
        };

    const airflowDiagnostics = core && typeof core.buildAirflowDiagnostics === "function"
      ? core.buildAirflowDiagnostics({
          systemType: cleanroom ? "cleanroom/process" : roomShr < 0.78 ? "high latent" : coilOutdoorAirCfm > cfmCoolingCoil * 0.35 ? "high ventilation" : "comfort cooling",
          sensibleAirflowCfm: cfmThermal,
          latentAirflowCfm: roomShr < 0.78 ? cfmCoolingCoil : 0,
          ventilationAirflowCfm: cfmVent,
          achAirflowCfm: cfmAch,
          selectedAirflowDriver: airflowConstraint,
          achMandatory: achMandatory,
          coolingAirflowCfm: cfmCoolingCoil,
          trFinal: trFinal,
          roomDeltaTDesign: roomDeltaTDesign,
          latentLoadRatio: 1 - roomShr,
          userOverride: !!(optimizationScenario && optimizationScenario.overrides && optimizationScenario.overrides.airflowStrategy)
        })
      : null;
    const ductDiagnostics = core && typeof core.calculateDuctDiagnostics === "function"
      ? core.calculateDuctDiagnostics({
          cfm: cfmConditioned,
          duct: supplyDuctStrategy.trunkDuct || mainDuct,
          lengthM: ductLengthFtDisplay * 0.3048,
          fittings: defaultDuctFittings("supply", supplyDuctStrategy.trunkCount || 1),
          equipmentLossPa: equipmentLossDisplay,
          totalEspPa: totalEsp,
          calibrationPreset: cleanroom ? "low_velocity" : height < 3 ? "compact_ceiling" : "normal_comfort"
        })
      : null;

    const statePoints = {
      OA: { label: "Outdoor air", T: outdoorDryBulb, W: wOut },
      RA: { label: "Return air", T: indoorDryBulb, W: wIn },
      MA: { label: "Mixed air", T: mixedAirTemp, W: mixedAirHumidity },
      SA: { label: "Supply air", T: supplyTemp, W: supplyHumidity },
      ADP: { label: "Coil ADP", T: adpTemp, W: adpHumidity }
    };

    const result = {
      inputs: inputs,
      optimizationScenario: optimizationScenario ? {
        key: optimizationScenario.key || "",
        title: optimizationScenario.title || "Optimization scenario",
        intent: optimizationScenario.intent || "balanced",
        overrides: copyJson(optimizationScenario.overrides || {})
      } : null,
      optimizationMode: !!calculationOptions.optimizationMode,
      area: area,
      volume: volume,
      envelope: envelope,
      outdoorRelativeHumidity: outdoorRelativeHumidity,
      peopleSensible: peopleSensible,
      peopleLatent: peopleLatent,
      lightingSensible: lightingSensible,
      equipmentSensible: equipmentSensible,
      windowSensible: windowSensible,
      wallSensible: wallSensible,
      roofSensible: roofSensible,
      floorSensible: floorSensible,
      cltdContext: {
        wallBase: wallCltdBase,
        wallCorrected: roundTo(wallCltd, 1),
        wallCorrections: wallCltdCorrections,
        roofBase: roofCltdBase,
        roofCorrection: roofCltdCorrection,
        roofLoadType: roofLoadType,
        floorLoadType: floorLoadType,
        floorAssumption: floorAssumption
      },
      spaceSensible: spaceSensible,
      spaceLatent: spaceLatent,
      spaceTotal: spaceTotal,
      freshAirSensible: freshAirSensible,
      freshAirLatent: freshAirLatent,
      freshAirTotal: freshAirTotal,
      infiltrationSensible: infiltrationSensible,
      infiltrationLatent: infiltrationLatent,
      infiltrationTotal: infiltrationTotal,
      totalS: totalSensible,
      totalL: totalLatent,
      totalLoad: totalLoad,
      shr: systemShr,
      systemShr: systemShr,
      roomShr: roomShr,
      tr_calc: trDesign,
      tr_sf: trFinal,
      tr_design: trDesign,
      tr_airflow: trAirflow,
      tr_cooling_coil: trCoolingCoil,
      tr_ventilation: trDedicatedVentilation,
      tr_equipment: trEquipmentSelection,
      tr_final: trFinal,
      tr_catalog: trCatalog,
      tr_catalog_equipment: trCatalogEquipment,
      TR_sel: trCatalog,
      TR_room: trDesign,
      Q_sup_cfm: cfmConditioned,
      Q_coil_cfm: cfmCoolingCoil,
      cfm_thermal: cfmThermal,
      cfm_vent: cfmVent,
      cfm_ach: cfmAch,
      cfm_cleanroom: cfmCleanroom,
      cfm_conditioned: cfmConditioned,
      cfm_cooling_coil: cfmCoolingCoil,
      cfm_dedicated_ventilation: cfmDedicatedVentilation,
      cfm_neutral_recirculation: cfmNeutralRecirculation,
      cfm_primary_return: cfmPrimaryReturn,
      cfm_process_excess: cfmProcessExcess,
      coolingCoilAirflowCFM: cfmCoolingCoil,
      recirculationAirflowCFM: cfmConditioned,
      outdoorAirThroughCoilCFM: coilOutdoorAirCfm,
      dedicatedVentilationCFM: cfmDedicatedVentilation,
      processMakeupAirCFM: cfmProcessExcess,
      bypassRecirculationCFM: cfmRecirculationBypass,
      totalRoomSupplyCFM: cfmFinal,
      exhaustReplacementCFM: cfmProcessExcess,
      cfm_required: cfmRequired,
      cfm_final: cfmFinal,
      cooling_airflow_cfm: cfmCoolingCoil,
      recirculation_airflow_cfm: cfmConditioned,
      ventilation_airflow_cfm: cfmVentilation,
      total_room_airflow_cfm: cfmFinal,
      outdoor_air_mixed_into_cooling_cfm: coilOutdoorAirCfm,
      fresh_total_cfm: freshAirCfm,
      fresh_total_cfm_user: ventilationStandards.userOutdoorAirCfm,
      recirc_cfm: recirculationCfm,
      infiltration_cfm: infiltration.airflowCfm,
      infiltration_ach: infiltration.designAch,
      ach: ach,
      ach_recirculation: achRecirculation,
      ach_total_room: achTotalRoom,
      ach_required: airsideProfile.achRequired,
      complianceMode: complianceMode,
      achRequirementMode: achRequirementMode,
      achMandatory: achMandatory,
      ventilationComplianceStatus: designValidation.ventilationComplianceStatus || "COMPLIANT",
      achComplianceStatus: designValidation.achComplianceStatus || "ADVISORY",
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
      ductDiagnostics: ductDiagnostics,
      airflowDiagnostics: airflowDiagnostics,
      total_esp: totalEsp,
      equipmentSelection: equipmentSelection,
      coolingSystemSelection: coolingSystemSelection,
      recirculationSystemSelection: recirculationSystemSelection,
      processAirSelection: processAirSelection,
      dedicatedVentilationSelection: dedicatedVentilationSelection,
      cooling_fan_kw: roundTo(coolingFanDesignKW, 2),
      recirculation_fan_kw: roundTo(recirculationFanDesignKW, 2),
      ventilation_fan_kw: roundTo(ventilationFanDesignKW, 2),
      total_fan_kw: totalOperatingFanKW,
      airsideProfile: airsideProfile,
      cleanroom: cleanroom,
      airflows: {
        cooling: {
          airflowCfm: cfmCoolingCoil,
          outdoorAirMixedCfm: coilOutdoorAirCfm,
          tr: roundTo(trCoolingCoil, 2),
          cfmPerTr: roundTo(designCfmPerTR, 1),
          cfmPerTrNumeratorCfm: cfmCoolingCoil,
          airflowConstraint: coolingAirflowConstraint,
          airflowConstraintLabel: airflowConstraintLabel(coolingAirflowConstraint)
        },
        recirculation: {
          airflowCfm: cfmConditioned,
          additionalAirflowCfm: cfmNeutralRecirculation,
          returnAirflowCfm: cfmPrimaryReturn,
          cleanroomDriven: !!cleanroom && cfmConditioned > cfmCoolingCoil + 25,
          airflowConstraint: airflowConstraint,
          airflowConstraintLabel: cleanroom && airflowConstraint === "cleanroom"
            ? cleanroom.classLabel + " cleanroom airflow governs"
            : airflowConstraintLabel(airflowConstraint)
        },
        ventilation: {
          airflowCfm: cfmVentilation,
          dedicatedAirflowCfm: cfmDedicatedVentilation,
          processAirflowCfm: cfmProcessExcess,
          totalOutdoorAirCfm: freshAirCfm,
          mixedIntoCoolingAirflowCfm: coilOutdoorAirCfm,
          tr: roundTo(trDedicatedVentilation, 2)
        },
        topology: {
          coolingCoilAirflowCFM: cfmCoolingCoil,
          recirculationAirflowCFM: cfmConditioned,
          outdoorAirThroughCoilCFM: coilOutdoorAirCfm,
          dedicatedVentilationCFM: cfmDedicatedVentilation,
          processMakeupAirCFM: cfmProcessExcess,
          bypassRecirculationCFM: cfmRecirculationBypass,
          totalRoomSupplyCFM: cfmFinal,
          exhaustReplacementCFM: cfmProcessExcess,
          comfortAchUsesConditionedAirOnly: !(cleanroom || allowProcessMakeupAir)
        },
        returnAir: {
          toCoilCfm: cfmPrimaryReturn,
          bypassRecirculationCfm: cfmRecirculationBypass,
          ventilationPathCfm: cfmVentilation,
          totalRoomReturnCfm: cfmTotalRoomReturn,
          coilInletAirflowCfm: cfmCoolingCoil,
          coilOutletAirflowCfm: cfmCoolingCoil
        },
        room: {
          requiredAirflowCfm: cfmRequired,
          totalAirflowCfm: cfmFinal,
          achCompliance: roundTo(ach, 2),
          achRecirculation: roundTo(achRecirculation, 2),
          achTotalRoom: roundTo(achTotalRoom, 2)
        }
      },
      systems: {
        cooling: {
          label: "Cooling system",
          airflowCfm: cfmCoolingCoil,
          tr: roundTo(trCoolingCoil, 2),
          fanKW: roundTo(coolingFanDesignKW, 2),
          selection: coolingSystemSelection,
          sharedWithRecirculation: coolingAndRecirculationShareFan,
          fanPowerNote: coolingAndRecirculationShareFan ? "Shared supply fan; no separate cooling fan kW counted." : "Separate cooling fan path."
        },
        recirculation: {
          label: cleanroom ? "Cleanroom recirculation system" : "Room recirculation / supply system",
          airflowCfm: cfmConditioned,
          additionalAirflowCfm: cfmNeutralRecirculation,
          returnAirflowCfm: cfmPrimaryReturn,
          fanKW: roundTo(recirculationFanDesignKW, 2),
          selection: recirculationSystemSelection
        },
        ventilation: {
          label: "Ventilation / make-up system",
          airflowCfm: cfmVentilation,
          dedicatedAirflowCfm: cfmDedicatedVentilation,
          processAirflowCfm: cfmProcessExcess,
          outdoorAirCfm: freshAirCfm,
          fanKW: roundTo(ventilationFanDesignKW, 2),
          selection: dedicatedVentilationSelection,
          processSelection: processAirSelection
        }
      },
      returnAir: {
        toCoilCfm: cfmPrimaryReturn,
        bypassRecirculationCfm: cfmRecirculationBypass,
        ventilationPathCfm: cfmVentilation,
        roomRecirculationReturnCfm: cfmConditioned,
        totalRoomReturnCfm: cfmTotalRoomReturn,
        coilInletAirflowCfm: cfmCoolingCoil,
        coilOutletAirflowCfm: cfmCoolingCoil
      },
      systemArchitecture: {
        mode: airflowStreams.architectureMode,
        decoupledVentilation: !!airflowStreams.decoupledVentilation,
        roomSupplyAirflowCfm: cfmConditioned,
        recirculationAirflowCfm: cfmConditioned,
        coolingCoilAirflowCfm: cfmCoolingCoil,
        ventilationAirflowCfm: cfmVentilation,
        totalRoomAirflowCfm: cfmFinal,
        totalOutdoorAirCfm: freshAirCfm,
        dedicatedVentilationAirflowCfm: cfmDedicatedVentilation,
        neutralRecirculationAirflowCfm: cfmNeutralRecirculation,
        primaryReturnAirflowCfm: cfmPrimaryReturn,
        processExcessAirflowCfm: cfmProcessExcess,
        coolingCoilTR: roundTo(trCoolingCoil, 2),
        dedicatedVentilationTR: roundTo(trDedicatedVentilation, 2),
        achCompliance: roundTo(ach, 2),
        achRecirculation: roundTo(achRecirculation, 2),
        achTotalRoom: roundTo(achTotalRoom, 2),
        notes: airflowStreams.notes || []
      },
      dedicatedVentilationSystem: dedicatedVentilationSelection ? {
        espPa: dedicatedVentilationEsp,
        duct: dedicatedVentilationDuct,
        ductLoss: dedicatedVentilationLoss,
        equipmentLoss: dedicatedVentilationEquipmentLoss,
        selection: dedicatedVentilationSelection
      } : null,
      validation: designValidation,
      engineeringAssumptions: designValidation.assumptions || engineeringAssumptions,
      standardsContext: {
        ventilation: ventilationStandards,
        infiltration: infiltration
      },
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
        method: cleanroom
          ? "Cooling airflow, cleanroom recirculation airflow, and ventilation / make-up airflow are tracked separately. Only cooling airflow is used for coil sizing and psychrometrics."
          : "Cooling airflow, recirculation airflow, and ventilation / make-up airflow are tracked separately so non-coil air does not distort coil sizing or reporting.",
        roomTemp: indoorDryBulb,
        supplyTemp: supplyTemp,
        deltaT: airflowDeltaT,
        roomShr: roomShr,
        roomShrPsychro: roomShrPsychro,
        roomShrError: roomShrError,
        roomDeltaTDesign: roomDeltaTDesign,
        supplyTempDesign: designSupplyTemp,
        designBasisNote: airflowDesign.note || airflowDesignBase.note,
        roomSensible: spaceSensible,
        sensibleAirFactor: sensibleAirFactor,
        cfmThermal: cfmThermal,
        cfmVent: cfmVent,
        cfmVentUser: ventilationStandards.userOutdoorAirCfm,
        cfmVentMinimum: ventilationStandards.minimumOutdoorAirCfm,
        cfmVentPressurization: ventilationStandards.pressurizationReserveCfm || 0,
        cfmAch: cfmAch,
        cfmCleanroom: cfmCleanroom,
        cfmConditioned: cfmConditioned,
        cfmCoolingCoil: cfmCoolingCoil,
        cfmRecirculation: cfmConditioned,
        cfmRecirculationAdditional: cfmNeutralRecirculation,
        cfmVentilation: cfmVentilation,
        cfmDedicatedVentilation: cfmDedicatedVentilation,
        cfmNeutralRecirculation: cfmNeutralRecirculation,
        cfmPrimaryReturn: cfmPrimaryReturn,
        cfmReturnToCoil: cfmPrimaryReturn,
        cfmReturnBypass: cfmRecirculationBypass,
        cfmReturnVentilationPath: cfmVentilation,
        cfmTotalRoomReturn: cfmTotalRoomReturn,
        cfmProcessExcess: cfmProcessExcess,
        cfmRequired: cfmRequired,
        cfmFinal: cfmFinal,
        totalOutdoorAirCfm: freshAirCfm,
        coilOutdoorAirCfm: coilOutdoorAirCfm,
        airflowConstraint: airflowConstraint,
        airflowConstraintLabel: cleanroom && airflowConstraint === "cleanroom"
          ? cleanroom.classLabel + " cleanroom airflow governs"
          : airflowConstraintLabel(airflowConstraint),
        coolingAirflowConstraint: coolingAirflowConstraint,
        coolingAirflowConstraintLabel: airflowConstraintLabel(coolingAirflowConstraint),
        systemArchitectureMode: airflowStreams.architectureMode,
        decoupledVentilation: !!airflowStreams.decoupledVentilation,
        designCFMPerTR: designCfmPerTR,
        diagnostics: airflowDiagnostics,
        cfmPerTrNumeratorCfm: cfmCoolingCoil,
        cfmPerTrTonnageBasisTr: trEquipmentSelection,
        totalCFMPerTR: totalCfmPerTR,
        achRequired: airsideProfile.achRequired,
        achRequirementMode: achRequirementMode,
        achMandatory: achMandatory,
        complianceMode: complianceMode,
        achRangeMin: airsideProfile.achRangeMin,
        achRangeMax: airsideProfile.achRangeMax,
        achProvided: ach,
        achRecirculation: achRecirculation,
        achTotalRoom: achTotalRoom,
        occupancyType: airsideProfile.type,
        occupancyNote: airsideProfile.note,
        cleanroomMode: !!cleanroom,
        cleanroomClass: cleanroom ? cleanroom.classLabel : "",
        cleanroomState: cleanroom ? cleanroom.stateLabel : "",
        cleanroomFlowRegime: cleanroom ? cleanroom.flowRegime : "",
        cleanroomSupplyPattern: cleanroom ? cleanroom.supplyPattern : "",
        cleanroomReturnPattern: cleanroom ? cleanroom.returnPattern : "",
        cleanroomFinalFilter: cleanroom ? cleanroom.finalFilter : "",
        cleanroomPressureLabel: cleanroom ? cleanroom.pressureLabel : "",
        cleanroomPressurePa: cleanroom ? cleanroom.pressurePa : 0,
        cleanroomFilterCoverageMin: cleanroom ? cleanroom.filterCoverageMin : 0,
        cleanroomFilterCoverageMax: cleanroom ? cleanroom.filterCoverageMax : 0,
        cleanroomParticles05: cleanroom && cleanroom.particleLimits ? cleanroom.particleLimits.particles_0_5um_m3 : 0,
        cleanroomParticles50: cleanroom && cleanroom.particleLimits ? cleanroom.particleLimits.particles_5_0um_m3 : 0,
        cleanroomComplianceNote: cleanroom ? cleanroom.complianceNote : "",
        ventilationMethod: ventilationStandards.method,
        ventilationDesignSource: ventilationStandards.designSource,
        ventilationNote: ventilationStandards.note,
        infiltrationCfm: infiltration.airflowCfm,
        infiltrationAch: infiltration.designAch,
        infiltrationModel: infiltration.model || "ach_profile",
        infiltrationProfile: infiltration.profile || "normal",
        infiltrationNote: infiltration.note,
        processVentilationStrategy: airsideProfile.processVentilationStrategy,
        airflowDesignNote: airflowDesign.note,
        airflowProcessNote: airflowProcessNote,
        airflowRoleNotes: airflowStreams.notes || [],
        preferredSelectionMargin: preferredSelectionMargin,
        lowCfmPerTrNote: lowCfmPerTrNote,
        validationStatus: designValidation.status,
        validationSummary: designValidation.summary,
        confidenceScore: designValidation.confidenceScore
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
        roomShrLoad: roomShr,
        roomShrPsychro: roomShrPsychro,
        shrError: roomShrError,
        enthalpyBalanceErrorKJkg: psychroEnthalpyError,
        converged: roomPsychro ? roomPsychro.converged : Math.abs(roomShrError) <= 0.02 && psychroEnthalpyError <= 0.5,
        iterations: roomPsychro ? roomPsychro.iterations : 0,
        adpTemp: adpTemp,
        adpHumidity: adpHumidity,
        bypassFactor: bypassFactor,
        adpMethod: adpPoint.method || "bf_consistent_search",
        bfTemp: adpPoint.bfTemp,
        bfHumidity: adpPoint.bfHumidity,
        adpHumidityError: adpPoint.humidityError || 0,
        oaFraction: oaFraction,
        coilOutdoorAirCfm: coilOutdoorAirCfm,
        dedicatedVentilationLoad: dedicatedVentilationLoad,
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
        orientationSeries: orientationSeries,
        activeOrientation: solarProfile.activeOrientation,
        activeOrientationLabel: solarProfile.activeOrientationLabel
      }
	    };

	    ensureFinalizedResult(result, { promoteEnergySimulation: false });

	    if (!calculationOptions.skipAiEnhancements) {
	      result.designAdvisor = normalizeAdvisoryRegistry(buildLocalDesignAdvisor(result), result);
      result.designOptimization = null;
      result.designAlternatives = buildLocalDesignAlternatives(result);
    } else {
	      result.designAdvisor = normalizeAdvisoryRegistry(null, result);
      result.designOptimization = null;
      result.designAlternatives = null;
    }
    return result;
  }

  function renderCooling(result) {
    const envelope = result.envelope || {
      windows: [],
      walls: [],
      windowAreaTotal: parseFloat(result.inputs.win_area) || 0,
      wallNetArea: Math.max(0, 2 * (parseFloat(result.inputs.len) + parseFloat(result.inputs.wid)) * parseFloat(result.inputs.ht) * ((parseFloat(result.inputs.wall_exp) || 2) / 4) - parseFloat(result.inputs.win_area || 0)),
      ceilingArea: result.area || 0,
      floorArea: result.area || 0,
      roofLoadArea: result.area || 0,
      wallCltdBase: CLTD_WALL[parseInt(result.inputs.wall_exp, 10)] || 0
    };
    const windowBreakdownRows = envelope.windows.map(function (windowEntry) {
      return '<tr class="sub-row"><td>↳ Window ' + windowEntry.index + '</td><td>Individual glazing panel</td><td>' + formatNumber(windowEntry.area, 2) + " m2</td><td>" + orientationLabel(windowEntry.orientation) + '</td><td class="num">Included</td><td class="num">-</td></tr>';
    }).join("");
    const wallBreakdownRows = envelope.walls.map(function (wallEntry) {
      return '<tr class="sub-row"><td>↳ Wall ' + wallEntry.index + '</td><td>Net external wall after glazing</td><td>' + formatNumber(wallEntry.netArea, 2) + " m2</td><td>" + orientationLabel(wallEntry.orientation) + ' · factor ' + formatNumber(wallEntry.orientationFactor || 1, 2) + '</td><td class="num">Included</td><td class="num">-</td></tr>';
    }).join("");
    setMetric("m-sh", formatInt(result.totalS), "W");
    setMetric("m-lh", formatInt(result.totalL), "W");
    setMetric("m-total", formatInt(result.totalLoad), "W");
    setMetric("m-area", formatNumber(result.area, 1), "m2");

    byId("cooling-tbody").innerHTML =
      '<tr><td>People - sensible</td><td>' + result.inputs.occ + " x " + result.peopleSensible / Math.max(parseFloat(result.inputs.occ) || 1, 1) + ' W/person</td><td>' + result.inputs.occ + ' persons</td><td>Activity: ' + String(result.inputs.occ_act).replace(/_/g, " ") + '</td><td class="num">' + formatInt(result.peopleSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>People - latent</td><td>' + result.inputs.occ + " x " + result.peopleLatent / Math.max(parseFloat(result.inputs.occ) || 1, 1) + ' W/person</td><td>' + result.inputs.occ + ' persons</td><td>Metabolic latent</td><td class="num">-</td><td class="num">' + formatInt(result.peopleLatent) + "</td></tr>"
      + '<tr><td>Lighting</td><td>A x W/m2 x CLF 0.9</td><td>' + formatNumber(result.area, 1) + " m2</td><td>" + result.inputs.lighting + ' W/m2</td><td class="num">' + formatInt(result.lightingSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Equipment</td><td>A x W/m2 x diversity 0.8</td><td>' + formatNumber(result.area, 1) + " m2</td><td>" + result.inputs.equip + ' W/m2</td><td class="num">' + formatInt(result.equipmentSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Window solar</td><td>Σ(A_window x incident solar on glass x SHGC/SC x CLF)</td><td>' + formatNumber(envelope.windowAreaTotal, 2) + " m2</td><td>" + escapeHtml(result.solar.activeOrientationLabel || orientationLabel(result.inputs.win_orient)) + " · incident=" + Math.round(result.solar.point.incidentSolarOnGlassWm2 || 0) + " W/m2, effective load=" + Math.round(result.solar.point.coolingLoadSolarWm2 || result.solar.point.shgf || 0) + " W/m2, SC/SHGC=" + result.inputs.sc_glass + ", CLF=" + result.inputs.clf_shade + '</td><td class="num">' + formatInt(result.windowSensible) + '</td><td class="num">-</td></tr>'
      + windowBreakdownRows
      + '<tr><td>Wall conduction</td><td>Σ(U x A_net x corrected CLTD x orientation factor)</td><td>' + formatNumber(envelope.wallNetArea, 2) + " m2</td><td>U=" + result.inputs.u_wall + ", CLTD(base)=" + formatNumber(result.cltdContext && result.cltdContext.wallBase || (CLTD_WALL[Math.min(Math.max((envelope.walls || []).length, 1), 4)] || 0), 1) + ', corrected≈' + formatNumber(result.cltdContext && result.cltdContext.wallCorrected || 0, 1) + '</td><td class="num">' + formatInt(result.wallSensible) + '</td><td class="num">-</td></tr>'
      + wallBreakdownRows
      + '<tr><td>Roof conduction</td><td>U x exposed roof area x corrected roof CLTD</td><td>' + formatNumber(envelope.roofLoadArea, 2) + " m2</td><td>Type=" + escapeHtml(result.cltdContext && result.cltdContext.roofLoadType || "exposed_roof") + ", CLTD(base)=" + formatNumber(result.cltdContext && result.cltdContext.roofBase || 0, 1) + ', corrected≈' + formatNumber(result.cltdContext && result.cltdContext.roofCorrection && result.cltdContext.roofCorrection.correctedCltd || 0, 1) + '</td><td class="num">' + formatInt(result.roofSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Floor / slab conduction</td><td>Separated from roof CLTD</td><td>' + formatNumber(envelope.floorArea, 2) + " m2</td><td>" + escapeHtml(result.cltdContext && result.cltdContext.floorAssumption || "Internal floor assumed buffered; roof CLTD not applied.") + '</td><td class="num">' + formatInt(result.floorSensible || 0) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Infiltration - sensible</td><td>m_dot infil x c_p x dT</td><td>' + formatInt(result.infiltration_cfm || 0) + " CFM</td><td>" + formatNumber(result.infiltration_ach || 0, 2) + ' ACH allowance</td><td class="num">' + formatInt(result.infiltrationSensible || 0) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Infiltration - latent</td><td>Infiltration total - sensible</td><td>-</td><td>Outdoor moisture load entering the space</td><td class="num">-</td><td class="num">' + formatInt(result.infiltrationLatent || 0) + "</td></tr>"
      + '<tr><td>Fresh air - sensible</td><td>m_dot OA x c_p x dT</td><td>' + formatInt(result.fresh_total_cfm) + " CFM</td><td>dT=" + formatNumber((parseFloat(result.inputs.out_dbt) || 0) - (parseFloat(result.inputs.in_dbt) || 0), 1) + ' C</td><td class="num">' + formatInt(result.freshAirSensible) + '</td><td class="num">-</td></tr>'
      + '<tr><td>Fresh air - latent</td><td>Vent total - vent sensible</td><td>-</td><td>dW=' + formatNumber((result.psychro.W_out - result.psychro.W_in) * 1000, 2) + ' g/kg</td><td class="num">-</td><td class="num">' + formatInt(result.freshAirLatent) + "</td></tr>"
      + '<tr class="total-row"><td><b>Total</b></td><td colspan="3">Room sensible + latent including infiltration and ventilation</td><td class="num"><b>' + formatInt(result.totalS) + '</b></td><td class="num"><b>' + formatInt(result.totalL) + "</b></td></tr>"
      + '<tr class="total-row"><td><b>Grand total</b></td><td colspan="3">Before safety factor</td><td colspan="2" class="num"><b>' + formatInt(result.totalLoad) + " W</b></td></tr>";
  }

  function renderShr(result) {
    const systemShr = clamp(result.systemShr || result.shr || 0.85, 0, 1);
    const roomShr = clamp(result.roomShr || systemShr, 0, 1);
    const shrPercent = systemShr * 100;
    const shrColor = systemShr > 0.85 ? "var(--accent)" : systemShr > 0.7 ? "var(--accent3)" : "var(--accent4)";
    const shrText = systemShr > 0.95
      ? "Mainly sensible load. Standard comfort cooling is adequate."
      : systemShr > 0.85
        ? "Low latent share. Standard AHU coil selection remains suitable."
        : systemShr > 0.7
          ? "Moderate latent content. Coil dehumidification matters."
          : "High latent load. Low bypass factor coil is recommended.";
    const shrShift = systemShr - roomShr;
    const shrShiftText = Math.abs(shrShift) < 0.01
      ? "Room SHR and system SHR are nearly the same, so outdoor air is not materially shifting the latent balance."
      : shrShift < 0
        ? "System SHR is lower than room SHR because outdoor air is adding latent moisture that the coil still has to remove."
        : "System SHR is slightly higher than room SHR because the current outdoor-air condition is acting as a drying credit.";

    byId("shr-content").innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:16px;">'
      + '<span style="font-family:var(--mono);font-size:48px;font-weight:500;color:' + shrColor + '">' + formatNumber(shrPercent, 1) + '<span style="font-size:20px">%</span></span>'
      + '<span style="font-size:13px;color:var(--text2)">System SHR = ' + formatInt(result.totalS) + " W sensible / " + formatInt(result.totalLoad) + " W total</span>"
      + "</div>"
      + '<div class="shr-bar-bg"><div class="shr-bar-fill" style="width:' + shrPercent.toFixed(1) + "%;background:" + shrColor + '"></div></div>'
      + '<div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--text3);margin-top:4px;"><span>0 - latent dominant</span><span>1.0 - sensible dominant</span></div>'
      + '<table class="calc-table" style="margin-top:16px;"><thead><tr><th>BASIS</th><th>FORMULA</th><th>VALUE</th><th>NOTE</th></tr></thead><tbody>'
      + '<tr><td>System SHR</td><td>Total sensible / total load</td><td class="num">' + formatNumber(systemShr, 3) + '</td><td>Includes room, infiltration, and fresh-air loads used for coil sizing.</td></tr>'
      + '<tr><td>Room SHR</td><td>Space sensible / space total</td><td class="num">' + formatNumber(roomShr, 3) + '</td><td>Based on room and infiltration load before outdoor-air ventilation is added.</td></tr>'
      + "</tbody></table>"
      + '<div style="margin-top:12px;padding:12px 14px;background:var(--bg3);border-left:3px solid var(--border);border-radius:0 var(--r) var(--r) 0;font-size:12px;font-family:var(--mono);color:var(--text2);">' + shrShiftText + "</div>"
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
      + '<tr><td>TR_airflow</td><td>m_dot x (h_MA - h_SA) / 3517</td><td class="num">' + formatNumber(result.tr_airflow, 3) + "</td><td>TR</td><td>Psychrometric coil duty at cooling airflow only</td></tr>"
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
    const flows = airflowBreakdown(result);
    const basis = result.airflowBasis || {
      roomTemp: parseFloat(result.inputs.in_dbt) || 24,
      supplyTemp: result.psychro && result.psychro.supplyTemp ? result.psychro.supplyTemp : (parseFloat(result.inputs.in_dbt) || 24) - 10,
      deltaT: 10,
      roomDeltaTDesign: 10,
      supplyTempDesign: (parseFloat(result.inputs.in_dbt) || 24) - 10,
      cfmThermal: result.cfm_thermal || result.Q_coil_cfm || result.Q_sup_cfm,
      cfmVent: result.cfm_vent || result.fresh_total_cfm,
      cfmAch: result.cfm_ach || 0,
      cfmConditioned: result.cfm_conditioned || result.Q_sup_cfm,
      cfmCoolingCoil: flows.coolingAirflowCfm,
      cfmRecirculation: flows.recirculationAirflowCfm,
      cfmRecirculationAdditional: flows.recirculationAdditionalAirflowCfm,
      cfmVentilation: flows.ventilationAirflowCfm,
      cfmDedicatedVentilation: flows.dedicatedVentilationAirflowCfm,
      cfmReturnToCoil: flows.returnAirToCoilCfm || result.cfm_primary_return || flows.coolingAirflowCfm,
      cfmReturnBypass: flows.returnAirBypassCfm || result.cfm_neutral_recirculation || Math.max((flows.recirculationAirflowCfm || 0) - (flows.coolingAirflowCfm || 0), 0),
      cfmReturnVentilationPath: flows.returnAirVentilationPathCfm || flows.ventilationAirflowCfm || result.ventilation_airflow_cfm || 0,
      cfmTotalRoomReturn: flows.totalRoomReturnAirflowCfm || result.cfm_final || flows.totalRoomAirflowCfm,
      cfmProcessExcess: result.cfm_process_excess || 0,
      cfmRequired: result.cfm_required || flows.totalRoomAirflowCfm || result.Q_sup_cfm,
      cfmFinal: result.cfm_final || flows.totalRoomAirflowCfm || result.Q_sup_cfm,
      totalOutdoorAirCfm: flows.totalOutdoorAirCfm,
      coilOutdoorAirCfm: flows.ventilationMixedIntoCoolingAirflowCfm,
      sensibleAirFactor: SENSIBLE_W_PER_CFM_C,
      designCFMPerTR: safeDiv(flows.coolingAirflowCfm || result.Q_coil_cfm || result.Q_sup_cfm, result.tr_equipment || result.tr_final || result.tr_sf || 1, 0),
      totalCFMPerTR: safeDiv(flows.totalRoomAirflowCfm || result.cfm_final || result.Q_sup_cfm, result.tr_equipment || result.tr_final || result.tr_sf || 1, 0),
      achRequired: result.ach_required || 0,
      achProvided: flows.achCompliance || result.ach || 0,
      achRecirculation: flows.achRecirculation || 0,
      achTotalRoom: flows.achTotalRoom || 0,
      airflowConstraintLabel: "Thermal sensible load governs"
    };
    const cleanroomMode = !!basis.cleanroomMode;
    const diagnostics = basis.diagnostics || result.airflowDiagnostics || {};
    const achModeText = result.achRequirementMode || basis.achRequirementMode || "advisory";
    const complianceModeText = result.complianceMode || basis.complianceMode || "comfort_ventilation";
    const airflowMinimumLabel = cleanroomMode ? "CFM_cleanroom" : "CFM_ACH";
    const airflowMinimumFormula = cleanroomMode
      ? "Room volume x cleanroom ACH template, converted to CFM"
      : "Room volume x ACH, converted to CFM";
    const airflowMinimumValue = cleanroomMode ? basis.cfmCleanroom || basis.cfmAch : basis.cfmAch;
    const airflowMinimumNote = cleanroomMode
      ? (basis.cleanroomClass || "Cleanroom") + " | " + escapeHtml(basis.cleanroomFlowRegime || "Filtered recirculation") + " | target " + formatNumber(basis.achRequired || 0, 1) + " ACH"
      : escapeHtml(basis.occupancyType || "Occupancy profile") + " | ACH target " + formatNumber(basis.achRequired || 0, 1) + " (" + formatNumber(basis.achRangeMin || 0, 0) + "-" + formatNumber(basis.achRangeMax || 0, 0) + " typical)";
    const coolingFormula = cleanroomMode
      ? "Thermal-control airflow on cooling coil"
      : "Max(CFM_thermal, OA carried through cooling coil)";
    const ventilationFormula = "Dedicated make-up / process air outside cooling coil";
    const achNote = cleanroomMode
      ? "Compliance ACH checks the cleanroom recirculation stream. Total room airflow is shown separately."
      : achModeText === "mandatory"
        ? "ACH is mandatory for this design basis and can reject the airflow selection."
        : achModeText === "disabled"
          ? "ACH target is disabled; outdoor-air ventilation is the governing comfort compliance check."
          : "Comfort ventilation compliance is based on outdoor air. ACH is advisory and does not reject the design.";
    const supplementalVentilationRows = [
      basis.cfmDedicatedVentilation > 0
        ? '<tr><td>Dedicated make-up air</td><td>Outdoor air handled outside cooling coil</td><td class="num">' + formatInt(basis.cfmDedicatedVentilation || 0) + "</td><td>CFM</td><td>Separate ventilation system duty</td></tr>"
        : "",
      basis.cfmProcessExcess > 0
        ? '<tr><td>Process / exhaust replacement air</td><td>Separate ACH or make-up airflow</td><td class="num">' + formatInt(basis.cfmProcessExcess || 0) + "</td><td>CFM</td><td>Handled outside the active cooling coil</td></tr>"
        : ""
    ].join("");
    setMetric("m-cfm", formatInt(flows.totalRoomAirflowCfm || result.cfm_final || result.Q_sup_cfm), "CFM");
    setMetric("m-fa-cfm", formatInt(flows.totalOutdoorAirCfm || result.fresh_total_cfm), "CFM");
    setMetric("m-recirc-cfm", formatInt(flows.recirculationAirflowCfm || result.cfm_conditioned || result.Q_sup_cfm), "CFM");
    setMetric("m-ach", formatNumber(flows.achCompliance || result.ach, 1), "ACH");

    byId("airflow-detail").innerHTML =
      '<table class="calc-table"><thead><tr><th>PARAMETER</th><th>FORMULA</th><th class="num">VALUE</th><th>UNIT</th><th>NOTE</th></tr></thead><tbody>'
      + '<tr><td>Design supply DBT</td><td>Room DBT - design dT</td><td class="num">' + formatNumber(basis.supplyTempDesign || basis.supplyTemp, 1) + "</td><td>C</td><td>" + escapeHtml(basis.airflowDesignNote || "Used only to establish the thermal airflow basis") + "</td></tr>"
      + '<tr><td>Design room dT</td><td>Room DBT - design supply DBT</td><td class="num">' + formatNumber(basis.roomDeltaTDesign || basis.deltaT, 1) + "</td><td>C</td><td>Thermal airflow basis before ventilation and ACH checks</td></tr>"
      + '<tr><td>Moist-air sensible factor</td><td>rho x c_p x 1 C per CFM</td><td class="num">' + formatNumber(basis.sensibleAirFactor || SENSIBLE_W_PER_CFM_C, 3) + "</td><td>W/CFM-C</td><td>Evaluated at the room/design-supply mean state instead of a fixed rule-of-thumb constant</td></tr>"
      + '<tr><td>CFM_thermal</td><td>Space sensible / (moist-air factor x design dT)</td><td class="num">' + formatInt(basis.cfmThermal) + "</td><td>CFM</td><td>Using room sensible load of " + formatInt(basis.roomSensible || result.spaceSensible || result.totalS) + " W</td></tr>"
      + '<tr><td>CFM_vent</td><td>' + (cleanroomMode ? "Max(user OA, occupancy minimum, pressurization reserve)" : "Max(user OA, ASHRAE-style minimum)") + '</td><td class="num">' + formatInt(basis.cfmVent) + "</td><td>CFM</td><td>User OA " + formatInt(basis.cfmVentUser || basis.cfmVent) + " CFM | minimum " + formatInt(basis.cfmVentMinimum || basis.cfmVent) + " CFM" + (cleanroomMode ? " | pressurization reserve " + formatInt(basis.cfmVentPressurization || 0) + " CFM" : "") + " | " + escapeHtml(basis.ventilationNote || "Outdoor air ventilation minimum") + "</td></tr>"
      + '<tr><td>' + airflowMinimumLabel + '</td><td>' + airflowMinimumFormula + '</td><td class="num">' + formatInt(airflowMinimumValue) + "</td><td>CFM</td><td>" + airflowMinimumNote + "</td></tr>"
      + '<tr><td>Infiltration load allowance</td><td>Closed-building ACH x room volume</td><td class="num">' + formatInt(basis.infiltrationCfm || 0) + "</td><td>CFM</td><td>" + formatNumber(basis.infiltrationAch || 0, 2) + " ACH | " + escapeHtml(basis.infiltrationNote || "Included as sensible + latent room load, not as ventilation credit") + "</td></tr>"
      + '<tr><td>Cooling airflow</td><td>' + coolingFormula + '</td><td class="num">' + formatInt(basis.cfmCoolingCoil || flows.coolingAirflowCfm) + "</td><td>CFM</td><td>" + escapeHtml(basis.coolingAirflowConstraintLabel || "Cooling airflow basis") + " | this is the only airflow used in coil sizing, psychrometrics, and CFM/TR.</td></tr>"
      + '<tr><td>Recirculation airflow</td><td>Room recirculation / cleanliness stream</td><td class="num">' + formatInt(basis.cfmRecirculation || flows.recirculationAirflowCfm) + "</td><td>CFM</td><td>" + (cleanroomMode ? "Cleanroom room-air-change stream" : "Room supply / recirculation stream") + "</td></tr>"
      + '<tr><td>Recirculation outside cooling coil</td><td>Recirculation - cooling airflow</td><td class="num">' + formatInt(basis.cfmRecirculationAdditional || flows.recirculationAdditionalAirflowCfm) + "</td><td>CFM</td><td>" + (cleanroomMode ? "Filtered room recirculation that does not define coil duty" : "Zero when the room uses a single mixed cooling stream") + "</td></tr>"
      + '<tr><td>Ventilation / make-up airflow</td><td>' + ventilationFormula + '</td><td class="num">' + formatInt(basis.cfmVentilation || flows.ventilationAirflowCfm) + "</td><td>CFM</td><td>Tracked separately so outdoor / process air does not distort cooling airflow</td></tr>"
      + supplementalVentilationRows
      + '<tr><td>Outdoor air entering cooling coil</td><td>OA mixed into active coil stream</td><td class="num">' + formatInt(basis.coilOutdoorAirCfm || flows.ventilationMixedIntoCoolingAirflowCfm) + "</td><td>CFM</td><td>Subset of the ventilation role carried through the coil</td></tr>"
      + '<tr><td>Total outdoor air role</td><td>Total validated OA requirement</td><td class="num">' + formatInt(basis.totalOutdoorAirCfm || flows.totalOutdoorAirCfm) + "</td><td>CFM</td><td>Fresh-air, pressurization, and exhaust-replacement requirement</td></tr>"
      + '<tr><td>CFM_required</td><td>Cooling + non-coil recirculation + ventilation / make-up</td><td class="num">' + formatInt(basis.cfmRequired || basis.cfmFinal) + "</td><td>CFM</td><td>" + escapeHtml(basis.airflowConstraintLabel || "Primary airflow basis") + "</td></tr>"
      + '<tr class="total-row"><td><b>Total room airflow</b></td><td>Cooling + recirculation outside coil + ventilation / make-up</td><td class="num"><b>' + formatInt(basis.cfmFinal || flows.totalRoomAirflowCfm) + "</b></td><td>CFM</td><td>Consultant-reporting total across the separated airflow streams</td></tr>"
      + '<tr><td>Supply dT (actual)</td><td>Room DBT - supply DBT</td><td class="num">' + formatNumber(basis.deltaT, 1) + "</td><td>C</td><td>Back-calculated from cooling airflow only</td></tr>"
      + '<tr><td>Supply air DBT</td><td>Room DBT - dT</td><td class="num">' + formatNumber(basis.supplyTemp, 1) + "</td><td>C</td><td>Used for psychrometric process line</td></tr>"
      + '<tr><td>Total return air (room basis)</td><td>Cooling-loop return + bypass recirculation + ventilation path</td><td class="num">' + formatInt(basis.cfmTotalRoomReturn) + "</td><td>CFM</td><td>Total room-side return basis across all airflow roles</td></tr>"
      + '<tr><td>Return air to coil</td><td>Closed cooling-airflow loop</td><td class="num">' + formatInt(basis.cfmReturnToCoil) + "</td><td>CFM</td><td>Return air reaching the active cooling coil path; must equal cooling airflow.</td></tr>"
      + '<tr><td>Recirculation bypass</td><td>Recirculation airflow - cooling airflow</td><td class="num">' + formatInt(basis.cfmReturnBypass) + "</td><td>CFM</td><td>Non-coil recirculation used for room air-change duty only</td></tr>"
      + '<tr><td>Ventilation return path</td><td>Ventilation / make-up role outside the coil loop</td><td class="num">' + formatInt(basis.cfmReturnVentilationPath) + "</td><td>CFM</td><td>Fresh-air, pressurization, or exhaust-replacement path tracked outside the coil loop</td></tr>"
      + '<tr><td>Outdoor air fraction</td><td>OA / supply x 100</td><td class="num">' + formatNumber(result.psychro.oaFraction * 100, 1) + "</td><td>%</td><td>Used for mixed air state</td></tr>"
      + '<tr><td>Cooling airflow rate</td><td>Cooling airflow / cooling tonnage basis</td><td class="num">' + formatNumber(basis.designCFMPerTR, 0) + "</td><td>CFM/TR</td><td>" + escapeHtml(basis.lowCfmPerTrNote || "Calculated from cooling airflow only; recirculation and ventilation are excluded.") + "</td></tr>"
      + '<tr><td>Total airflow rate</td><td>Total room airflow / cooling tonnage basis</td><td class="num">' + formatNumber(basis.totalCFMPerTR || basis.designCFMPerTR, 0) + "</td><td>CFM/TR</td><td>Supplemental room-airflow intensity only; do not use for coil sizing.</td></tr>"
      + '<tr class="total-row"><td><b>Air changes provided</b></td><td>Selected compliance airflow x 3600 / room volume</td><td class="num"><b>' + formatNumber(basis.achProvided || flows.achCompliance || result.ach, 1) + "</b></td><td>ACH</td><td>Required minimum: " + formatNumber(basis.achRequired || result.ach_required || 0, 1) + " ACH | " + achNote + "</td></tr>"
      + '<tr><td>Ventilation compliance</td><td>ASHRAE 62.1 / ISHRAE-style OA basis</td><td class="num">' + escapeHtml(result.ventilationComplianceStatus || "COMPLIANT") + '</td><td>-</td><td>Compliance mode: ' + escapeHtml(complianceModeText) + '</td></tr>'
      + '<tr><td>ACH target status</td><td>' + escapeHtml(achModeText) + '</td><td class="num">' + escapeHtml(result.achComplianceStatus || "ADVISORY") + '</td><td>-</td><td>Selected airflow driver: ' + escapeHtml(diagnostics.selectedAirflowDriver || basis.airflowConstraint || "thermal") + '</td></tr>'
      + '<tr><td>CFM/TR diagnostic</td><td>Cooling airflow / TR_final</td><td class="num">' + formatNumber(diagnostics.actualCfmPerTr || basis.designCFMPerTR || 0, 0) + '</td><td>CFM/TR</td><td>Status ' + escapeHtml(diagnostics.status || "NORMAL") + (diagnostics.reasons && diagnostics.reasons.length ? " | " + escapeHtml(diagnostics.reasons.join(", ")) : "") + '</td></tr>'
      + '<tr><td>ACH on recirculation stream</td><td>Recirculation airflow x 3600 / room volume</td><td class="num">' + formatNumber(basis.achRecirculation || flows.achRecirculation, 1) + "</td><td>ACH</td><td>Useful for cleanroom air-change verification</td></tr>"
      + '<tr><td>ACH on total room airflow</td><td>Total room airflow x 3600 / room volume</td><td class="num">' + formatNumber(basis.achTotalRoom || flows.achTotalRoom, 1) + "</td><td>ACH</td><td>Includes separate ventilation / make-up air when present</td></tr>"
      + (cleanroomMode
        ? '<tr><td>Cleanroom basis</td><td colspan="4">' + escapeHtml((basis.cleanroomClass || "Cleanroom") + " | " + (basis.cleanroomState || "Operational") + " | " + (basis.cleanroomSupplyPattern || "") + " | " + (basis.cleanroomFinalFilter || "")) + "</td></tr>"
        : "")
      + (cleanroomMode
        ? '<tr><td>Certification note</td><td colspan="4">' + escapeHtml(basis.cleanroomComplianceNote || "ISO class certification still requires particle counts, HEPA integrity testing, and pressure qualification.") + "</td></tr>"
        : "")
      + (basis.ventilationMethod
        ? '<tr><td>Standards note</td><td colspan="4">' + escapeHtml(basis.ventilationMethod) + "</td></tr>"
        : "")
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
    const diagnostics = result.ductDiagnostics || {};
    setMetric("m-esp-duct", formatInt(result.duct_friction), "Pa");
    setMetric("m-esp-fit", formatInt(result.fitting_loss), "Pa");
    setMetric("m-esp-equip", formatInt(result.equipment_loss), "Pa");
    setMetric("m-esp-total", formatInt(result.total_esp), "Pa");

    byId("esp-table-wrap").innerHTML =
      '<div class="esp-row" style="border-radius:var(--r) var(--r) 0 0;overflow:hidden;">'
      + '<div class="esp-header">COMPONENT</div><div class="esp-header">QTY / LEN</div><div class="esp-header">UNIT LOSS (Pa)</div><div class="esp-header">TOTAL (Pa)</div><div class="esp-header">CATEGORY</div>'
      + "</div>"
      + espRowMarkup("Supply + return duct friction", formatNumber(result.duct_len_ft, 0) + " ft critical path", "Darcy-Weisbach", formatInt(result.duct_friction), "DUCT")
      + espRowMarkup("Elbows / transitions", "K-factor method", "-", formatInt(result.fitting_loss * 0.55), "FITTING")
      + espRowMarkup("Branches / junctions", "K-factor method", "-", formatInt(result.fitting_loss * 0.45), "FITTING")
      + espRowMarkup("Cooling coil", "1 ea", EQUIP_PRESSURE.cooling_coil, EQUIP_PRESSURE.cooling_coil, "EQUIP")
      + espRowMarkup("Filter section", "1 ea", EQUIP_PRESSURE.filter_clean, EQUIP_PRESSURE.filter_clean, "EQUIP")
      + espRowMarkup("Mixing box and terminals", "1 set", formatInt(result.equipment_loss - EQUIP_PRESSURE.cooling_coil - EQUIP_PRESSURE.filter_clean), formatInt(result.equipment_loss - EQUIP_PRESSURE.cooling_coil - EQUIP_PRESSURE.filter_clean), "EQUIP")
      + '<div class="esp-row esp-total-row"><div class="esp-cell"><b>TOTAL ESP</b></div><div class="esp-cell">-</div><div class="esp-cell">-</div><div class="esp-cell num"><b>' + formatInt(result.total_esp) + ' Pa</b></div><div class="esp-cell" style="color:var(--accent3);font-size:10px;font-family:var(--mono);">' + formatNumber(result.total_esp / 249.09, 2) + " in.w.g.</div></div>"
      // Compute the share percentages from the SAME numbers shown in the
      // ESP table above. The duct-diagnostics object recomputes friction
      // from per-trunk straight-pipe assumptions and can disagree with the
      // ESP table (this caused the "fitting 791%" bug in earlier reports).
      + (function () {
          const ductPa = Math.max(0, Number(result.duct_friction) || 0);
          const fitPa  = Math.max(0, Number(result.fitting_loss) || 0);
          const eqPa   = Math.max(0, Number(result.equipment_loss) || 0);
          const totalPa = Math.max(1, ductPa + fitPa + eqPa);
          const dPct = (ductPa / totalPa) * 100;
          const fPct = (fitPa  / totalPa) * 100;
          const ePct = (eqPa   / totalPa) * 100;
          return '<div class="report-inline-note" style="margin-top:10px;">'
            + 'Duct diagnostic: ' + escapeHtml(diagnostics.explanation || "Duct diagnostics unavailable.")
            + ' Friction rate ' + formatNumber(diagnostics.frictionRatePaM || 0, 2) + ' Pa/m, '
            + 'velocity pressure ' + formatNumber(diagnostics.velocityPressurePa || 0, 1) + ' Pa, '
            + 'hydraulic diameter ' + formatNumber(diagnostics.hydraulicDiameterM || 0, 3) + ' m, '
            + 'equivalent diameter ' + formatNumber(diagnostics.equivalentDiameterM || 0, 3) + ' m, '
            + 'Re ' + formatInt(diagnostics.reynolds || 0) + ', '
            + 'f ' + formatNumber(diagnostics.frictionFactor || 0, 4) + '. '
            + 'Shares (of total ESP shown): '
            + 'duct ' + formatNumber(dPct, 1) + '%, '
            + 'fitting ' + formatNumber(fPct, 1) + '%, '
            + 'equipment ' + formatNumber(ePct, 1) + '%.'
            + '</div>';
        })();
  }

  function designAdvisorSeverityColor(severity) {
    if (severity === "critical") {
      return "rgba(239,68,68,0.35)";
    }
    if (severity === "warning") {
      return "rgba(245,158,11,0.35)";
    }
    return "rgba(22,102,169,0.22)";
  }

  function designAdvisorSourceLabel(provider) {
    return provider === "openai"
      ? "OpenAI-enhanced guidance"
      : provider === "local_reasoning"
        ? "Local design intelligence"
        : "Local engineering rules";
  }

  function designAdvisorStatusLabel(status, provider, errorMessage) {
    if (status === "loading") {
      return "AI enhancement in progress. Showing local engineering rules until the response arrives.";
    }
    if (status === "error") {
      return errorMessage
        ? "AI enhancement failed. Using local engineering rules. " + errorMessage
        : "AI enhancement failed. Using local engineering rules.";
    }
    if (provider === "openai") {
      return "AI enhancement is active for this calculation.";
    }
    return provider === "local_reasoning"
      ? "Local design intelligence is active. Add an OpenAI API key to upgrade these suggestions automatically."
      : "Local engineering rules are active. Add an OpenAI API key to upgrade these suggestions automatically.";
  }

  function designAdvisorTimestamp(meta) {
    if (!meta || !meta.generatedAt) {
      return "";
    }
    try {
      return new Date(meta.generatedAt).toLocaleString("en-IN");
    } catch (error) {
      return String(meta.generatedAt);
    }
  }

	  function designAdvisorCardsMarkup(items, compact) {
    const suggestions = (items || []).slice(0, compact ? 3 : 6);
    if (!suggestions.length) {
      return '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No active recommendations.</p>';
    }

	    return '<div class="advisory-card-stack" style="display:grid;gap:8px;grid-template-columns:1fr;min-width:0;">' + suggestions.map(function (item) {
	      const border = designAdvisorSeverityColor(item.severity);
	      return '<div class="advisory-card" style="padding:10px 12px;border:1px solid ' + border + ';background:rgba(15,23,42,0.02);border-radius:10px;min-width:0;overflow-wrap:break-word;white-space:normal;">'
	        + '<div class="advisory-card-head" style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;min-width:0;">'
	        + '<div style="font-size:11px;font-weight:600;color:var(--text);min-width:0;overflow-wrap:break-word;">' + escapeHtml(item.title || "Recommendation") + "</div>"
        + '<div style="font-size:9px;font-family:var(--mono);letter-spacing:.08em;color:var(--text3);text-transform:uppercase;">' + escapeHtml(item.severity || "advisory") + "</div>"
        + "</div>"
        + ((item.complianceStatus || item.confidenceScore != null)
          ? '<div style="margin-top:6px;font-size:10px;color:var(--text3);font-family:var(--mono);line-height:1.4;">'
            + (item.complianceStatus ? "Compliance: " + escapeHtml(item.complianceStatus) : "")
            + (item.confidenceScore != null ? (item.complianceStatus ? " | " : "") + "Confidence " + formatNumber(item.confidenceScore * 100, 0) + "%" : "")
            + "</div>"
          : "")
        + (item.issue
          ? '<div style="margin-top:6px;font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;">' + escapeHtml(item.issue) + "</div>"
          : "")
        + (item.impact
          ? '<div style="margin-top:6px;font-size:10px;color:var(--text2);font-family:var(--mono);line-height:1.4;">Impact: ' + escapeHtml(item.impact) + "</div>"
          : "")
        + '<div style="margin-top:6px;font-size:11px;color:var(--text);font-family:var(--mono);line-height:1.5;">Action: ' + escapeHtml(item.recommendation || "") + "</div>"
        + (item.why
          ? '<div style="margin-top:6px;font-size:10px;color:var(--text2);font-family:var(--mono);line-height:1.4;">Why: ' + escapeHtml(item.why) + "</div>"
          : "")
        + (item.tradeoff
          ? '<div style="margin-top:6px;font-size:10px;color:var(--text2);font-family:var(--mono);line-height:1.4;">Tradeoff: ' + escapeHtml(item.tradeoff) + "</div>"
          : "")
        + (item.whenToUse
          ? '<div style="margin-top:6px;font-size:10px;color:var(--text2);font-family:var(--mono);line-height:1.4;">When to use: ' + escapeHtml(item.whenToUse) + "</div>"
          : "")
        + (item.basis
          ? '<div style="margin-top:6px;font-size:10px;color:var(--text3);font-family:var(--mono);line-height:1.4;">Basis: ' + escapeHtml(item.basis) + "</div>"
          : "")
        + "</div>";
    }).join("") + "</div>";
  }

  function designAlternativesStatusLabel(status, provider, errorMessage) {
    if (status === "loading") {
      if (provider === "local_optimization") {
        return "Simulation-backed design alternatives are being generated. Showing the current reasoning-based concepts until the scenario reruns finish.";
      }
      return "AI alternatives are being generated. Showing local engineering concepts until the response arrives.";
    }
    if (status === "error") {
      return errorMessage
        ? "AI alternatives failed. Using local engineering concepts. " + errorMessage
        : "AI alternatives failed. Using local engineering concepts.";
    }
    if (provider === "openai") {
      return "AI-enhanced alternative concepts are active for this calculation.";
    }
    if (provider === "local_optimization") {
      return "Closed-loop local optimization is active for this calculation. Scenario rankings come from rerunning the live HVAC engine with structured design overrides.";
    }
    return provider === "local_reasoning"
      ? "Local design intelligence is active for the alternative-design page. Add an OpenAI API key to upgrade it automatically."
      : "Local engineering concepts are active. Add an OpenAI API key to upgrade the alternative-design page automatically.";
  }

  function designAlternativesSourceLabel(provider) {
    return provider === "openai"
      ? "OpenAI-enhanced alternative concepts"
      : provider === "local_optimization"
        ? "Local optimization engine"
      : provider === "local_reasoning"
        ? "Local design intelligence"
        : "Local engineering concepts";
  }

  function optimizationScenarioResults(result, alternatives, status) {
    const optimization = result && result.designOptimization ? result.designOptimization : null;
    const provider = alternatives && alternatives.provider
      ? alternatives.provider
      : optimization && optimization.provider
        ? optimization.provider
        : "";
    const scenarioResults = optimization && Array.isArray(optimization.scenarioResults) && optimization.scenarioResults.length
      ? optimization.scenarioResults
      : alternatives && Array.isArray(alternatives.scenarioResults)
        ? alternatives.scenarioResults
        : [];
    if (provider === "local_optimization" && status === "ready") {
      const expectedCount = optimization && Array.isArray(optimization.scenarioList)
        ? optimization.scenarioList.length
        : 0;
      if (!scenarioResults.length || (expectedCount && scenarioResults.length < expectedCount)) {
        throw new Error("Missing simulation data for optimization scenarios.");
      }
      scenarioResults.forEach(function (scenarioResult, index) {
        if (!scenarioResult) {
          throw new Error("Missing simulation data for optimization scenario #" + (index + 1) + ".");
        }
      });
    }
    return scenarioResults;
  }

  function requireScenarioNumericValue(scenarioResult, value, fieldLabel, allowNull) {
    if (value == null || value === "") {
      if (allowNull || scenarioResult && scenarioResult.rejected) {
        return null;
      }
      throw new Error("Missing simulation data for " + ((scenarioResult && (scenarioResult.name || scenarioResult.key)) || "scenario") + " -> " + fieldLabel + ".");
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      if (allowNull || scenarioResult && scenarioResult.rejected) {
        return null;
      }
      throw new Error("Invalid simulation data for " + ((scenarioResult && (scenarioResult.name || scenarioResult.key)) || "scenario") + " -> " + fieldLabel + ".");
    }
    return numeric;
  }

  function formatScenarioIntValue(scenarioResult, value, fieldLabel, allowNull) {
    const numeric = requireScenarioNumericValue(scenarioResult, value, fieldLabel, allowNull);
    return numeric == null ? "—" : formatInt(numeric);
  }

  function formatScenarioNumberValue(scenarioResult, value, digits, fieldLabel, allowNull) {
    const numeric = requireScenarioNumericValue(scenarioResult, value, fieldLabel, allowNull);
    return numeric == null ? "—" : formatNumber(numeric, digits);
  }

  function formatScenarioSignedValue(scenarioResult, value, digits, fieldLabel, suffix, allowNull) {
    const numeric = requireScenarioNumericValue(scenarioResult, value, fieldLabel, allowNull);
    if (numeric == null) {
      return "—";
    }
    return (numeric > 0 ? "+" : "") + formatNumber(numeric, digits) + (suffix || "");
  }

  function scenarioMutationSummary(inputMutation) {
    const mutation = inputMutation && typeof inputMutation === "object" ? inputMutation : {};
    const parts = [];
    Object.keys(mutation).forEach(function (groupKey) {
      const groupValue = mutation[groupKey];
      if (groupValue && typeof groupValue === "object" && !Array.isArray(groupValue)) {
        Object.keys(groupValue).forEach(function (itemKey) {
          const itemValue = groupValue[itemKey];
          parts.push(groupKey + "." + itemKey + "=" + (typeof itemValue === "number" ? formatNumber(itemValue, 2) : String(itemValue)));
        });
        return;
      }
      parts.push(groupKey + "=" + (typeof groupValue === "number" ? formatNumber(groupValue, 2) : String(groupValue)));
    });
    return parts.length ? parts.join(" | ") : "No input mutation captured.";
  }

  function optimizationScenarioCardMarkup(scenarioResult, preferredOptionKey) {
    const scenario = scenarioResult || {};
    const rejected = !!scenario.rejected;
    const preferred = !rejected && scenario.key && scenario.key === preferredOptionKey;
    const statusText = scenario && scenario.compliance && scenario.compliance.status
      ? scenario.compliance.status
      : scenario.rejected
        ? "REJECTED"
        : "READY";
    const airflowValidityText = scenario.compliance && scenario.compliance.airflow_valid != null
      ? String(scenario.compliance.airflow_valid)
      : "—";
    const psychroValidityText = scenario.compliance && scenario.compliance.psychro_converged != null
      ? String(scenario.compliance.psychro_converged)
      : "—";
    return '<div style="padding:14px;border:1px solid ' + (preferred ? "rgba(0,201,167,0.35)" : "rgba(148,163,184,0.2)") + ';background:' + (preferred ? "rgba(0,201,167,0.05)" : "rgba(15,23,42,0.02)") + ';border-radius:12px;">'
      + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">'
      + '<div>'
      + '<div style="font-size:12px;font-weight:700;color:var(--text);">' + escapeHtml(scenario.name || "Scenario") + "</div>"
      + '<div style="margin-top:4px;font-size:10px;color:var(--text3);font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;">' + escapeHtml(rejected ? "rejected" : scenario.intent || "simulation") + (preferred ? " · preferred" : "") + "</div>"
      + "</div>"
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">'
      + '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(15,23,42,0.04);border:1px solid rgba(148,163,184,0.2);color:var(--text2);">Overall ' + formatScenarioNumberValue(scenario, scenario.score && scenario.score.overall, 1, "score.overall", true) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(22,102,169,0.08);border:1px solid rgba(22,102,169,0.2);color:var(--text2);">Eff. ' + formatScenarioNumberValue(scenario, scenario.score && scenario.score.efficiency, 0, "score.efficiency", true) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);color:var(--text2);">Robust ' + formatScenarioNumberValue(scenario, scenario.score && scenario.score.robustness, 0, "score.robustness", true) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);color:var(--text2);">' + escapeHtml(statusText) + '</span>'
      + "</div>"
      + "</div>"
      + '<div style="margin-top:10px;font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.55;">'
      + '<div><b style="color:var(--text);">System:</b> ' + escapeHtml(scenario.system_type_label || scenario.system_type || "—") + "</div>"
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Changed:</b> ' + escapeHtml(scenarioMutationSummary(scenario.input_mutation)) + "</div>"
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Airflow:</b> Cooling ' + formatScenarioIntValue(scenario, scenario.airflow && scenario.airflow.cooling, "airflow.cooling", true) + ' | Recirc ' + formatScenarioIntValue(scenario, scenario.airflow && scenario.airflow.recirculation, "airflow.recirculation", true) + ' | Vent ' + formatScenarioIntValue(scenario, scenario.airflow && scenario.airflow.ventilation, "airflow.ventilation", true) + ' | Total ' + formatScenarioIntValue(scenario, scenario.airflow && scenario.airflow.total, "airflow.total", true) + ' CFM</div>'
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Return loop:</b> To coil ' + formatScenarioIntValue(scenario, scenario.return_air && scenario.return_air.to_coil, "return_air.to_coil", false) + ' | Bypass ' + formatScenarioIntValue(scenario, scenario.return_air && scenario.return_air.bypass_recirculation, "return_air.bypass_recirculation", false) + ' | Vent path ' + formatScenarioIntValue(scenario, scenario.return_air && scenario.return_air.ventilation_path, "return_air.ventilation_path", false) + ' CFM</div>'
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Performance:</b> Fan ' + formatScenarioNumberValue(scenario, scenario.performance && scenario.performance.fan_power, 2, "performance.fan_power", true) + ' kW | Energy ' + formatScenarioIntValue(scenario, scenario.performance && scenario.performance.energy_annual, "performance.energy_annual", true) + ' kWh | ESP ' + formatScenarioIntValue(scenario, scenario.performance && scenario.performance.esp, "performance.esp", true) + ' Pa | Coil ' + formatScenarioNumberValue(scenario, scenario.performance && scenario.performance.cooling_tr, 2, "performance.cooling_tr", true) + ' TR</div>'
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Cost / energy:</b> Capex INR ' + formatScenarioNumberValue(scenario, scenario.cost && scenario.cost.capex_total, 0, "cost.capex_total", false) + ' | Energy cost INR ' + formatScenarioNumberValue(scenario, scenario.cost && scenario.cost.energy_cost_annual, 0, "cost.energy_cost_annual", false) + ' | Payback ' + formatScenarioNumberValue(scenario, scenario.cost && scenario.cost.payback_years, 2, "cost.payback_years", true) + ' yr</div>'
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Comparison vs base:</b> Energy ' + formatScenarioSignedValue(scenario, scenario.delta && scenario.delta.energy_diff, 0, "delta.energy_diff", " kWh", true) + ' | Fan ' + formatScenarioSignedValue(scenario, scenario.delta && scenario.delta.fan_power_diff, 2, "delta.fan_power_diff", " kW", true) + ' | Capex INR ' + formatScenarioSignedValue(scenario, scenario.delta && scenario.delta.capex_diff, 0, "delta.capex_diff", "", false) + '</div>'
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Energy-cost delta:</b> ' + formatScenarioSignedValue(scenario, scenario.delta && scenario.delta.energy_cost_diff, 0, "delta.energy_cost_diff", " INR/yr", true) + '</div>'
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Compliance:</b> ACH ' + formatScenarioNumberValue(scenario, scenario.compliance && scenario.compliance.ach, 1, "compliance.ach", true) + ' / ' + formatScenarioNumberValue(scenario, scenario.compliance && scenario.compliance.ach_required, 1, "compliance.ach_required", true) + ' | Airflow ' + escapeHtml(airflowValidityText) + ' | Psychro ' + escapeHtml(psychroValidityText) + '</div>'
      + (scenario.rejection_reason
        ? '<div style="margin-top:8px;color:var(--accent4);"><b style="color:var(--text);">Rejection:</b> ' + escapeHtml(scenario.rejection_reason) + "</div>"
        : "")
      + "</div>"
      + "</div>";
  }

  function optimizationScenarioTableMarkup(scenarioResults, preferredOptionKey) {
    return '<div class="table-wrap"><table class="calc-table"><thead><tr><th>SCENARIO</th><th>SYSTEM</th><th>AIRFLOW SPLIT</th><th>RETURN LOOP</th><th>TOTAL CFM</th><th>ACH</th><th>FAN kW</th><th>ENERGY kWh</th><th>ESP</th><th>CAPEX INR</th><th>ENERGY COST</th><th>PAYBACK</th><th>ENERGY Δ</th><th>FAN Δ</th><th>SCORES</th><th>STATUS</th></tr></thead><tbody>'
      + scenarioResults.map(function (scenario) {
        const statusText = scenario && scenario.compliance && scenario.compliance.status
          ? scenario.compliance.status
          : scenario.rejected
            ? "REJECTED"
            : "READY";
        const scoreText = 'C ' + formatScenarioNumberValue(scenario, scenario.score && scenario.score.cost, 0, "score.cost", true)
          + ' | E ' + formatScenarioNumberValue(scenario, scenario.score && scenario.score.efficiency, 0, "score.efficiency", true)
          + ' | R ' + formatScenarioNumberValue(scenario, scenario.score && scenario.score.robustness, 0, "score.robustness", true)
          + ' | O ' + formatScenarioNumberValue(scenario, scenario.score && scenario.score.overall, 1, "score.overall", true);
        const energyDeltaText = formatScenarioSignedValue(scenario, scenario.delta && scenario.delta.energy_diff, 0, "delta.energy_diff", " kWh", true)
          + ' | '
          + formatScenarioSignedValue(scenario, scenario.delta && scenario.delta.energy_diff_percent, 1, "delta.energy_diff_percent", "%", true);
        const fanDeltaText = formatScenarioSignedValue(scenario, scenario.delta && scenario.delta.fan_power_diff, 2, "delta.fan_power_diff", " kW", true)
          + ' | '
          + formatScenarioSignedValue(scenario, scenario.delta && scenario.delta.fan_power_diff_percent, 1, "delta.fan_power_diff_percent", "%", true);
        return '<tr><td>' + escapeHtml(scenario.name || "Scenario") + (!scenario.rejected && scenario.key === preferredOptionKey ? ' <span class="admin-chip">PREFERRED</span>' : "") + '<div style="margin-top:4px;color:var(--text3);font-size:10px;">' + escapeHtml(scenarioMutationSummary(scenario.input_mutation)) + '</div></td><td>' + escapeHtml(scenario.system_type_label || scenario.system_type || "—") + '</td><td>Cool ' + formatScenarioIntValue(scenario, scenario.airflow && scenario.airflow.cooling, "airflow.cooling", true) + '<br>Recirc ' + formatScenarioIntValue(scenario, scenario.airflow && scenario.airflow.recirculation, "airflow.recirculation", true) + '<br>Vent ' + formatScenarioIntValue(scenario, scenario.airflow && scenario.airflow.ventilation, "airflow.ventilation", true) + '</td><td>To coil ' + formatScenarioIntValue(scenario, scenario.return_air && scenario.return_air.to_coil, "return_air.to_coil", false) + '<br>Bypass ' + formatScenarioIntValue(scenario, scenario.return_air && scenario.return_air.bypass_recirculation, "return_air.bypass_recirculation", false) + '<br>Vent path ' + formatScenarioIntValue(scenario, scenario.return_air && scenario.return_air.ventilation_path, "return_air.ventilation_path", false) + '</td><td class="num">' + formatScenarioIntValue(scenario, scenario.airflow && scenario.airflow.total, "airflow.total", true) + '</td><td class="num">' + formatScenarioNumberValue(scenario, scenario.compliance && scenario.compliance.ach, 1, "compliance.ach", true) + '</td><td class="num">' + formatScenarioNumberValue(scenario, scenario.performance && scenario.performance.fan_power, 2, "performance.fan_power", true) + '</td><td class="num">' + formatScenarioIntValue(scenario, scenario.performance && scenario.performance.energy_annual, "performance.energy_annual", true) + '</td><td class="num">' + formatScenarioIntValue(scenario, scenario.performance && scenario.performance.esp, "performance.esp", true) + '</td><td class="num">' + formatScenarioNumberValue(scenario, scenario.cost && scenario.cost.capex_total, 0, "cost.capex_total", false) + '</td><td class="num">' + formatScenarioNumberValue(scenario, scenario.cost && scenario.cost.energy_cost_annual, 0, "cost.energy_cost_annual", false) + '</td><td class="num">' + formatScenarioNumberValue(scenario, scenario.cost && scenario.cost.payback_years, 2, "cost.payback_years", true) + '</td><td class="num">' + energyDeltaText + '</td><td class="num">' + fanDeltaText + '</td><td class="num">' + scoreText + '</td><td>' + escapeHtml(statusText) + (scenario.rejection_reason ? '<div style="margin-top:4px;color:var(--accent4);font-size:10px;">' + escapeHtml(scenario.rejection_reason) + '</div>' : "") + '</td></tr>';
      }).join("")
      + "</tbody></table></div>";
  }

  function designAlternativeCardMarkup(option, preferredOptionKey) {
    const candidate = option || {};
    const preferred = candidate.key && candidate.key === preferredOptionKey;
    return '<div style="padding:14px;border:1px solid ' + (preferred ? "rgba(0,201,167,0.35)" : "rgba(148,163,184,0.2)") + ';background:' + (preferred ? "rgba(0,201,167,0.05)" : "rgba(15,23,42,0.02)") + ';border-radius:12px;">'
      + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">'
      + '<div>'
      + '<div style="font-size:12px;font-weight:700;color:var(--text);">' + escapeHtml(candidate.title || "Option") + "</div>"
      + '<div style="margin-top:4px;font-size:10px;color:var(--text3);font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;">' + escapeHtml(candidate.intent || "alternative") + (preferred ? " · preferred" : "") + "</div>"
      + "</div>"
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">'
      + '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(22,102,169,0.08);border:1px solid rgba(22,102,169,0.2);color:var(--text2);">Cost ' + formatInt(candidate.costScore || 0) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(0,201,167,0.08);border:1px solid rgba(0,201,167,0.2);color:var(--text2);">Eff. ' + formatInt(candidate.efficiencyScore || 0) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);color:var(--text2);">Robust ' + formatInt(candidate.robustnessScore || 0) + '</span>'
      + '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);color:var(--text2);">Compliance ' + formatInt(candidate.complianceScore || 0) + '</span>'
      + (candidate.decisionScore != null ? '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(15,23,42,0.04);border:1px solid rgba(148,163,184,0.2);color:var(--text2);">Rank ' + formatNumber(candidate.decisionScore || 0, 1) + '</span>' : "")
      + (candidate.complianceStatus ? '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.2);color:var(--text2);">' + escapeHtml(candidate.complianceStatus) + '</span>' : "")
      + (candidate.confidenceScore != null ? '<span style="font-family:var(--mono);font-size:10px;padding:4px 7px;border-radius:999px;background:rgba(15,23,42,0.04);border:1px solid rgba(148,163,184,0.2);color:var(--text2);">Confidence ' + formatNumber(candidate.confidenceScore * 100, 0) + '%</span>' : "")
      + "</div>"
      + "</div>"
      + '<div style="margin-top:10px;font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.55;">'
      + '<div><b style="color:var(--text);">System:</b> ' + escapeHtml(candidate.systemType || "—") + "</div>"
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Scope:</b> ' + escapeHtml(candidate.scope || "—") + "</div>"
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Airflow:</b> ' + formatInt(candidate.airflowCfm || 0) + ' CFM | ' + formatNumber(candidate.ach || 0, 1) + ' ACH</div>'
      + '<div style="margin-top:4px;"><b style="color:var(--text);">Delta:</b> Capex ' + (candidate.capexDeltaPercent > 0 ? "+" : "") + formatInt(candidate.capexDeltaPercent || 0) + '% | Energy ' + (candidate.energyDeltaPercent > 0 ? "+" : "") + formatInt(candidate.energyDeltaPercent || 0) + '%'
      + (candidate.annualEnergyKwh != null ? ' | Annual ' + formatInt(candidate.annualEnergyKwh || 0) + ' kWh' : "")
      + "</div>"
      + ((candidate.simulatedImpacts || candidate.estimatedImpacts)
        ? '<div style="margin-top:4px;"><b style="color:var(--text);">' + (candidate.simulationBacked ? "Simulated impact:" : "Estimated impact:") + '</b> '
          + ((candidate.simulatedImpacts || candidate.estimatedImpacts).annualEnergyDeltaKwh != null
            ? 'Energy ' + (((candidate.simulatedImpacts || candidate.estimatedImpacts).annualEnergyDeltaKwh > 0) ? "+" : "") + formatInt((candidate.simulatedImpacts || candidate.estimatedImpacts).annualEnergyDeltaKwh || 0) + ' kWh | '
            : '')
          + 'ESP ' + (((candidate.simulatedImpacts || candidate.estimatedImpacts).staticPressureDeltaPercent > 0) ? "+" : "") + formatInt((candidate.simulatedImpacts || candidate.estimatedImpacts).staticPressureDeltaPercent || 0) + '%'
          + (((candidate.simulatedImpacts || candidate.estimatedImpacts).staticPressureDeltaPa != null) ? ' (' + (((candidate.simulatedImpacts || candidate.estimatedImpacts).staticPressureDeltaPa > 0) ? "+" : "") + formatInt((candidate.simulatedImpacts || candidate.estimatedImpacts).staticPressureDeltaPa || 0) + ' Pa)' : "")
          + ' | Fan ' + (((candidate.simulatedImpacts || candidate.estimatedImpacts).fanEnergyDeltaPercent > 0) ? "+" : "") + formatInt((candidate.simulatedImpacts || candidate.estimatedImpacts).fanEnergyDeltaPercent || 0) + '%'
          + (((candidate.simulatedImpacts || candidate.estimatedImpacts).fanPowerDeltaKw != null) ? ' (' + (((candidate.simulatedImpacts || candidate.estimatedImpacts).fanPowerDeltaKw > 0) ? "+" : "") + formatNumber((candidate.simulatedImpacts || candidate.estimatedImpacts).fanPowerDeltaKw || 0, 2) + ' kW)' : "")
          + '</div>'
        : "")
      + (candidate.why ? '<div style="margin-top:4px;"><b style="color:var(--text);">Why:</b> ' + escapeHtml(candidate.why) + "</div>" : "")
      + (candidate.whenToUse ? '<div style="margin-top:4px;"><b style="color:var(--text);">When:</b> ' + escapeHtml(candidate.whenToUse) + "</div>" : "")
      + (candidate.strengths && candidate.strengths.length
        ? '<div style="margin-top:8px;"><b style="color:var(--text);">Strengths:</b> ' + escapeHtml(candidate.strengths.join(" | ")) + "</div>"
        : "")
      + (candidate.tradeoffs && candidate.tradeoffs.length
        ? '<div style="margin-top:8px;"><b style="color:var(--text);">Tradeoffs:</b> ' + escapeHtml(candidate.tradeoffs.join(" | ")) + "</div>"
        : "")
      + (candidate.actions && candidate.actions.length
        ? '<div style="margin-top:8px;"><b style="color:var(--text);">Actions:</b> ' + escapeHtml(candidate.actions.join(" | ")) + "</div>"
        : "")
      + "</div>"
      + "</div>";
  }

  function renderAiAlternatives(result) {
    const alternatives = result && result.designAlternatives ? result.designAlternatives : null;
    const status = result && result.designAlternativesStatus ? result.designAlternativesStatus : (alternatives ? "ready" : "idle");
    const meta = result && result.designAlternativesMeta ? result.designAlternativesMeta : null;
    const errorMessage = result && result.designAlternativesError ? result.designAlternativesError : "";
    const cleanroom = result && result.cleanroom ? result.cleanroom : null;
    const standardsBox = byId("ai-design-standards");
    const statusBox = byId("ai-design-status-note");
    const summaryBox = byId("ai-design-summary");
    const cardsBox = byId("ai-design-cards");
    const tableBox = byId("ai-design-table");
    if (!statusBox || !summaryBox || !cardsBox || !tableBox || !standardsBox) {
      return;
    }

    const options = alternatives && Array.isArray(alternatives.options) ? alternatives.options : [];
    const preferredOptionKey = alternatives && alternatives.preferredOptionKey ? alternatives.preferredOptionKey : "";
    const scenarioResults = optimizationScenarioResults(result, alternatives, status);
    const optimizationBacked = alternatives && alternatives.provider === "local_optimization";
    const costOption = options.find(function (option) { return option.intent === "cost_effective"; }) || options[0] || null;
    const efficiencyOption = options.find(function (option) { return option.intent === "efficient"; }) || options[options.length - 1] || null;

    const designModeLabel = cleanroom
      ? cleanroom.classLabel
      : String((result && result.complianceMode) || normalizedDesignMode(result && result.inputs && result.inputs.design_mode) || "comfort").replace(/_/g, " ");
    setMetric("m-ai-mode", designModeLabel.charAt(0).toUpperCase() + designModeLabel.slice(1));
    setMetric("m-ai-current", result && result.systemRecommendation && result.systemRecommendation.primarySystem ? result.systemRecommendation.primarySystem : "Current live design");
    setMetric("m-ai-cost", costOption ? costOption.title : "—");
    setMetric("m-ai-eff", efficiencyOption ? efficiencyOption.title : "—");

    statusBox.textContent = designAlternativesStatusLabel(status, alternatives && alternatives.provider, errorMessage)
      + (meta && designAdvisorTimestamp(meta) ? " Updated " + designAdvisorTimestamp(meta) + "." : "");

    summaryBox.innerHTML =
      '<div style="font-size:13px;font-weight:600;color:var(--text);">' + escapeHtml(alternatives && alternatives.summary ? alternatives.summary : "Run calculations to build AI-ready alternative concepts.") + "</div>"
      + (alternatives && alternatives.finalRecommendation && alternatives.finalRecommendation.title
        ? '<div style="margin-top:8px;font-size:11px;color:var(--text);font-family:var(--mono);line-height:1.5;">Final recommendation: ' + escapeHtml(alternatives.finalRecommendation.title + " | " + (alternatives.finalRecommendation.rationale || "")) + "</div>"
        : "")
      + '<div style="margin-top:8px;font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;">Source: ' + escapeHtml(designAlternativesSourceLabel(alternatives && alternatives.provider)) + "</div>"
      + (alternatives && alternatives.standardsNote
        ? '<div style="margin-top:8px;font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;">' + escapeHtml(alternatives.standardsNote) + "</div>"
        : "");

    standardsBox.innerHTML = cleanroom
      ? '<table class="calc-table"><tbody>'
        + '<tr><td>Selected cleanroom basis</td><td class="num">' + escapeHtml(cleanroom.classLabel + " · " + cleanroom.stateLabel) + '</td></tr>'
        + '<tr><td>Particle limit @ 0.5 um</td><td class="num">' + formatInt(cleanroom.particleLimits && cleanroom.particleLimits.particles_0_5um_m3 || 0) + ' /m3</td></tr>'
        + '<tr><td>Particle limit @ 5.0 um</td><td class="num">' + formatInt(cleanroom.particleLimits && cleanroom.particleLimits.particles_5_0um_m3 || 0) + ' /m3</td></tr>'
        + '<tr><td>Template airflow</td><td class="num">' + formatInt(cleanroom.designAirflowCfm || 0) + ' CFM | ' + formatNumber(cleanroom.designAch || 0, 0) + ' ACH</td></tr>'
        + '<tr><td>Flow regime</td><td class="num">' + escapeHtml(cleanroom.flowRegime || "—") + '</td></tr>'
        + '<tr><td>Final filter</td><td class="num">' + escapeHtml(cleanroom.finalFilter || "—") + '</td></tr>'
        + '<tr><td>Pressure regime</td><td class="num">' + escapeHtml(cleanroom.pressureLabel || "—") + ' @ ' + formatNumber(Math.abs(cleanroom.pressurePa || 0), 1) + ' Pa</td></tr>'
        + '<tr><td>Filter coverage template</td><td class="num">' + formatNumber(cleanroom.filterCoverageMin || 0, 0) + '-' + formatNumber(cleanroom.filterCoverageMax || 0, 0) + '%</td></tr>'
        + "</tbody></table>"
      : '<table class="calc-table"><tbody>'
        + '<tr><td>Current design basis</td><td class="num">' + escapeHtml(result && result.airsideProfile && result.airsideProfile.type ? result.airsideProfile.type : "Comfort / general HVAC") + '</td></tr>'
        + '<tr><td>Cooling airflow</td><td class="num">' + formatInt(result && result.cfm_cooling_coil || result && result.Q_coil_cfm || 0) + ' CFM</td></tr>'
        + '<tr><td>Recirculation airflow</td><td class="num">' + formatInt(result && result.cfm_conditioned || 0) + ' CFM</td></tr>'
        + '<tr><td>Ventilation / make-up</td><td class="num">' + formatInt(result && result.ventilation_airflow_cfm || result && result.cfm_dedicated_ventilation || result && result.cfm_process_excess || 0) + ' CFM</td></tr>'
        + '<tr><td>Total outdoor air</td><td class="num">' + formatInt(result && result.fresh_total_cfm || 0) + ' CFM</td></tr>'
        + '<tr><td>Current zoning</td><td class="num">' + formatInt(result && result.autoZoning && result.autoZoning.zoneCount || 1) + ' zone(s)</td></tr>'
        + '<tr><td>Current system recommendation</td><td class="num">' + escapeHtml(result && result.systemRecommendation && result.systemRecommendation.primarySystem ? result.systemRecommendation.primarySystem : "Awaiting calculation") + '</td></tr>'
        + "</tbody></table>";

    cardsBox.innerHTML = optimizationBacked && scenarioResults.length
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">' + scenarioResults.map(function (scenario) {
        return optimizationScenarioCardMarkup(scenario, preferredOptionKey);
      }).join("") + "</div>"
      : options.length
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">' + options.map(function (option) {
        return designAlternativeCardMarkup(option, preferredOptionKey);
      }).join("") + "</div>"
      : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Run calculations to generate alternative concepts.</p>';

    tableBox.innerHTML = optimizationBacked && scenarioResults.length
      ? optimizationScenarioTableMarkup(scenarioResults, preferredOptionKey)
      : options.length
      ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>OPTION</th><th>SYSTEM</th><th>CFM</th><th>ACH</th><th>CAPEX Δ</th><th>ENERGY Δ</th><th>SCORES</th><th>STATUS</th><th>SCOPE</th></tr></thead><tbody>'
        + options.map(function (option) {
          return '<tr><td>' + escapeHtml(option.title || "Option") + (option.key === preferredOptionKey ? ' <span class="admin-chip">PREFERRED</span>' : "") + '</td><td>' + escapeHtml(option.systemType || "—") + '</td><td class="num">' + formatInt(option.airflowCfm || 0) + '</td><td class="num">' + formatNumber(option.ach || 0, 1) + '</td><td class="num">' + (option.capexDeltaPercent > 0 ? "+" : "") + formatInt(option.capexDeltaPercent || 0) + '%</td><td class="num">' + (option.energyDeltaPercent > 0 ? "+" : "") + formatInt(option.energyDeltaPercent || 0) + '%</td><td class="num">C ' + formatInt(option.costScore || 0) + ' | E ' + formatInt(option.efficiencyScore || 0) + ' | R ' + formatInt(option.robustnessScore || 0) + ' | Q ' + formatInt(option.complianceScore || 0) + (option.decisionScore != null ? ' | Rank ' + formatNumber(option.decisionScore || 0, 1) : "") + '</td><td class="num">' + escapeHtml(option.complianceStatus || "COMPLIANT") + (option.confidenceScore != null ? ' | ' + formatNumber(option.confidenceScore * 100, 0) + '%' : "") + '</td><td>' + escapeHtml(option.scope || "—") + '</td></tr>';
        }).join("")
        + "</tbody></table></div>"
      : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Alternative comparison will appear here after calculation.</p>';
  }

  function renderEquipment(result) {
    const zoneAhuStrategy = result.zoneAhuStrategy || { mode: "single_ahu", modeLabel: "Single AHU", clusters: [] };
    const selection = zoneAhuStrategy.aggregateSelection || result.equipmentSelection;
    const ahu = selection.ahu;
    const fan = selection.fan;
    const systemRecommendation = result.systemRecommendation || {};
    const designConstraints = result.designConstraints || { status: "APPROVED", summary: "", actions: [] };
    const energyOptimization = result.energyOptimization || { suggestions: [], summary: selection.optimizationNote || "" };
    const designAdvisor = result.designAdvisor || { provider: "local_rules", summary: "", items: [] };
	    const designAdvisorStatus = result.designAdvisorStatus || "ready";
	    const designAdvisorMeta = result.designAdvisorMeta || null;
	    const designAdvisorError = result.designAdvisorError || "";
	    ensureFinalizedResult(result, { promoteEnergySimulation: false });
	    const finalDesign = result.finalDesign;
	    const statuses = finalDesign.statuses || {};
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
    const flows = airflowBreakdown(result);
    const coolingSystem = result.systems && result.systems.cooling ? result.systems.cooling : {};
    const recirculationSystem = result.systems && result.systems.recirculation ? result.systems.recirculation : {};
    const ventilationSystem = result.systems && result.systems.ventilation ? result.systems.ventilation : {};
    const conditionedAirflow = flows.recirculationAirflowCfm || result.cfm_conditioned || result.Q_sup_cfm || result.cfm_final;
    const coolingAirflow = flows.coolingAirflowCfm || result.cfm_cooling_coil || result.Q_coil_cfm || conditionedAirflow;
    const totalRoomAirflow = flows.totalRoomAirflowCfm || result.cfm_final || conditionedAirflow;
    const processAirflow = flows.processAirflowCfm || result.cfm_process_excess || 0;
    const ventilationAirflow = flows.ventilationAirflowCfm || 0;
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
      ? '<div style="margin-top:12px;"><table class="calc-table"><thead><tr><th>DEPLOYED AHU</th><th>ZONES</th><th>MODEL</th><th>TR</th><th>RECIRC CFM</th><th>ESP</th><th>FAN</th><th>MOTOR</th></tr></thead><tbody>'
        + zoneAhuStrategy.clusters.map(function (cluster) {
          return '<tr><td>' + escapeHtml(cluster.name) + '</td><td>' + escapeHtml(cluster.zoneNames.join(", ")) + '</td><td>' + escapeHtml(cluster.selection.ahu.model) + '</td><td class="num">' + formatNumber(cluster.selection.ahu.capacityTR, 1) + '</td><td class="num">' + formatInt(cluster.conditionedCFM) + '</td><td class="num">' + formatInt(cluster.peakESP) + '</td><td>' + escapeHtml(cluster.selection.fan.type) + '</td><td class="num">' + formatNumber(cluster.selection.recommendedMotorKW, 2) + ' kW</td></tr>';
        }).join("")
        + "</tbody></table></div>"
      : "";
    const airflowPenaltyText = conditionedAirflow > coolingAirflow + 25
      ? formatInt(Math.max(conditionedAirflow - coolingAirflow, 0)) + " CFM is room recirculation above the active cooling-coil stream."
      : processAirflow > 0
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
    setMetric("m-fan-ahu", deployedModelsText + " / " + formatNumber(ahu.capacityTR, 1) + " TR shared module");
    setMetric("m-fan-type", fan.unitCount > 1 ? fan.type + " x" + fan.unitCount : fan.type);
	    setMetric("m-fan-kw", formatNumber(finalDesign.fans.totalFanKW, 2), "kW");

    byId("fan-detail").innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:14px;">'
      + '<div style="padding:12px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);">'
      + '<div style="font-size:10px;font-family:var(--mono);letter-spacing:.08em;color:var(--text3);margin-bottom:6px;">AUTO SYSTEM RECOMMENDATION</div>'
      + '<div style="font-size:13px;color:var(--text);font-weight:600;margin-bottom:6px;">' + escapeHtml(systemRecommendation.primarySystem || "Awaiting recommendation") + "</div>"
      + '<div style="font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;">' + escapeHtml(systemRecommendation.reasoning || "System family will be inferred from airflow, zoning, and process-air behavior.") + "</div>"
      + (systemRecommendation.secondarySystems && systemRecommendation.secondarySystems.length
        ? '<div style="margin-top:8px;font-size:10px;color:var(--text3);font-family:var(--mono);">Secondary systems: ' + escapeHtml(systemRecommendation.secondarySystems.join(" | ")) + "</div>"
        : "")
      + "</div>"
	      + '<div style="padding:12px 14px;background:var(--bg3);border:1px solid ' + (statuses.overallValidationStatus === "NON_COMPLIANT" ? "rgba(239,68,68,0.35)" : statuses.overallValidationStatus === "REVIEW" ? "rgba(245,158,11,0.35)" : "rgba(0,201,167,0.25)") + ';border-radius:var(--r);">'
	      + '<div style="font-size:10px;font-family:var(--mono);letter-spacing:.08em;color:var(--text3);margin-bottom:6px;">DESIGN STATUS BREAKDOWN</div>'
	      + '<div style="font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.7;">Geometry constraints: ' + escapeHtml(statuses.geometryConstraintStatus || "APPROVED") + '<br>Duct constraints: ' + escapeHtml(statuses.ductConstraintStatus || "APPROVED") + '<br>Equipment selection: ' + escapeHtml(statuses.equipmentSelectionStatus || "APPROVED") + '<br>Airflow compliance: ' + escapeHtml(statuses.airflowComplianceStatus || "REVIEW") + '</div>'
	      + '<div style="font-size:13px;font-weight:600;margin-top:6px;color:' + (statuses.overallValidationStatus === "NON_COMPLIANT" ? "var(--accent4)" : statuses.overallValidationStatus === "REVIEW" ? "var(--accent3)" : "var(--accent)") + ';">Overall validation: ' + escapeHtml(statuses.overallValidationStatus || "REVIEW") + "</div>"
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
      + '<div style="padding:12px 14px;background:var(--bg3);border:1px solid ' + designAdvisorSeverityColor((designAdvisor.items && designAdvisor.items[0] && designAdvisor.items[0].severity) || "advisory") + ';border-radius:var(--r);">'
      + '<div style="font-size:10px;font-family:var(--mono);letter-spacing:.08em;color:var(--text3);margin-bottom:6px;">DESIGN REVIEW ASSISTANT</div>'
      + '<div style="font-size:13px;font-weight:600;color:var(--text);">' + escapeHtml(designAdvisor.summary || designConstraints.summary || "Design guidance is ready.") + "</div>"
      + '<div style="font-size:10px;color:var(--text3);font-family:var(--mono);line-height:1.5;margin-top:6px;">Source: ' + escapeHtml(designAdvisorSourceLabel(designAdvisor.provider)) + "</div>"
      + '<div style="font-size:10px;color:var(--text3);font-family:var(--mono);line-height:1.5;margin-top:4px;">' + escapeHtml(designAdvisorStatusLabel(designAdvisorStatus, designAdvisor.provider, designAdvisorError)) + "</div>"
      + (designAdvisorTimestamp(designAdvisorMeta)
        ? '<div style="font-size:10px;color:var(--text3);font-family:var(--mono);line-height:1.5;margin-top:4px;">Updated: ' + escapeHtml(designAdvisorTimestamp(designAdvisorMeta)) + "</div>"
        : "")
	      + '<div style="margin-top:8px;">' + advisoryReferencesMarkup(advisorItemsForSection(designAdvisor, ["airflow_compliance", "fan_esp"], 2)) + "</div>"
      + "</div>"
      + "</div>"
      + '<table class="calc-table"><thead><tr><th>PARAMETER</th><th>VALUE</th><th>UNIT</th><th>SELECTION BASIS</th></tr></thead><tbody>'
      + '<tr><td>Suggested recirculation AHU</td><td class="num">' + escapeHtml(deployedModelsText) + "</td><td>-</td><td>" + ahu.selectionNote + "</td></tr>"
      + '<tr><td>Recirculation deployment</td><td class="num">' + escapeHtml(zoneAhuStrategy.modeLabel || "Single AHU") + "</td><td>-</td><td>" + escapeHtml(clusterMarkup) + "</td></tr>"
      + '<tr><td>Recirculation configuration</td><td class="num">' + configurationLabel + "</td><td>-</td><td>Air-distribution hardware is selected on recirculation airflow and ESP. Cooling airflow is reported separately below.</td></tr>"
      + '<tr><td>Cooling duty basis</td><td class="num">' + formatNumber(ahu.requiredTRFinal, 2) + "</td><td>TR</td><td>" + ahu.sizingBasis + "</td></tr>"
      + '<tr><td>TR_catalog basis</td><td class="num">' + formatNumber(ahu.requiredCatalogTR, 2) + "</td><td>TR</td><td>Catalog threshold used for selection</td></tr>"
      + '<tr><td>Preferred reserve target</td><td class="num">' + formatNumber(ahu.preferredTargetTR, 2) + "</td><td>TR</td><td>10-20% reserve target for equipment check</td></tr>"
      + '<tr><td>Shared-module cooling capacity</td><td class="num">' + formatNumber(ahu.capacityTR, 1) + "</td><td>TR</td><td>Cooling module selected from load, not from recirculation airflow multiplication</td></tr>"
      + '<tr><td>Cooling nominal airflow</td><td class="num">' + formatInt(ahu.coolingNominalAirflowCFM) + "</td><td>CFM</td><td>Nominal airflow associated with the selected cooling capacity</td></tr>"
      + '<tr><td>Airflow multiplier</td><td class="num">' + formatNumber(ahu.airflowMultiplier, 2) + "x</td><td>-</td><td>" + airflowPenaltyText + "</td></tr>"
      + '<tr><td>Airflow window</td><td class="num">' + formatInt(ahu.minAirflowCFM) + " - " + formatInt(ahu.maxAirflowCFM) + "</td><td>CFM</td><td>" + formatInt(ahu.minAirflowCFMPerUnit) + " - " + formatInt(ahu.maxAirflowCFMPerUnit) + " CFM per air section</td></tr>"
      + '<tr><td>Cooling airflow</td><td class="num">' + formatInt(coolingAirflow) + "</td><td>CFM</td><td>Active airflow through the cooling coil. This is the numerator for CFM/TR and TR_airflow.</td></tr>"
      + '<tr><td>Recirculation airflow</td><td class="num">' + formatInt(conditionedAirflow) + "</td><td>CFM</td><td>Main room recirculation / supply stream handled by the deployed AHUs.</td></tr>"
      + '<tr><td>Ventilation / make-up airflow</td><td class="num">' + formatInt(ventilationAirflow) + "</td><td>CFM</td><td>Dedicated make-up plus process / exhaust-replacement airflow outside the cooling coil.</td></tr>"
      + '<tr><td>Total room airflow</td><td class="num">' + formatInt(totalRoomAirflow) + "</td><td>CFM</td><td>Cooling + recirculation outside coil + ventilation / make-up.</td></tr>"
      + '<tr><td>Design ESP</td><td class="num">' + formatInt(ahu.designESP || result.total_esp) + "</td><td>Pa</td><td>Controlling cluster / zone external static pressure</td></tr>"
      + '<tr><td>AHU reserve</td><td class="num">' + reserveSummary + "</td><td>-</td><td>" + (ahu.adequate ? (ahu.meetsMarginTarget ? "Positive reserve meets preferred target" : "Positive reserve available, but below preferred target") : "Nearest available database model is short on one or more criteria") + "</td></tr>"
      + '<tr><td>Reserve margin</td><td class="num">' + formatNumber(ahu.marginPercent, 1) + "</td><td>%</td><td>Coil capacity margin over TR_final</td></tr>"
      + '<tr><td>Recirculation fan type</td><td class="num">' + fan.type + "</td><td>-</td><td>" + (fan.type === fan.preferredType || fan.type === "Mixed" ? "Selected from deployed cluster duty points" : "Closest fan curve selected; pressure preference was " + fan.preferredType) + (ahu.airSectionCount > 1 ? " | selected on per-section airflow duty" : "") + (fan.typesUsed && fan.typesUsed.length > 1 ? " | fan families used: " + fan.typesUsed.join(", ") : "") + "</td></tr>"
      + '<tr><td>Recirculation fan curve</td><td class="num">' + fan.curveId + "</td><td>-</td><td>" + escapeHtml(fan.selectionNote || (fan.withinRange ? "Operating point falls inside the fan catalog window" : "Closest available fan curve - verify against vendor selection")) + " | " + formatInt(fan.dutyCFM || conditionedAirflow) + " CFM per fan section</td></tr>"
      + '<tr><td>Recirculation brake power</td><td class="num">' + formatNumber(fan.brakeKWTotal || 0, 2) + "</td><td>kW</td><td>" + formatNumber(fan.brakeKW || 0, 2) + " kW per fan section before motor sizing</td></tr>"
      + '<tr><td>Recirculation installed motor</td><td class="num">' + formatNumber(selection.recommendedMotorKW, 2) + "</td><td>kW</td><td>" + escapeHtml(motorBasisText) + "</td></tr>"
	      + '<tr><td>Cooling fan design</td><td class="num">' + formatNumber(finalDesign.fans.coolingFanKW || 0, 2) + "</td><td>kW</td><td>" + ((coolingSystem.sharedWithRecirculation || Math.abs(coolingAirflow - conditionedAirflow) <= 1)
        ? "Cooling fan duty is shared with the recirculation module in this configuration."
        : "Calculated on the cooling-airflow stream so coil airflow is not reported as room recirculation.") + "</td></tr>"
	      + '<tr><td>Recirculation fan design</td><td class="num">' + formatNumber(finalDesign.fans.recirculationFanKW || 0, 2) + "</td><td>kW</td><td>Main fan duty on the room recirculation stream.</td></tr>"
	      + '<tr><td>Ventilation fan design</td><td class="num">' + formatNumber(finalDesign.fans.ventilationFanKW || 0, 2) + "</td><td>kW</td><td>Dedicated make-up / process-air fan duty outside the cooling coil.</td></tr>"
	      + '<tr><td>Specific fan power</td><td class="num">' + formatNumber(finalDesign.fans.specificFanPowerKWPerTR || 0, 2) + "</td><td>kW/TR</td><td>Total operating electrical fan kW divided by TR_final; shared cooling/recirculation fans are counted once.</td></tr>"
      + '<tr><td>Installed motor index</td><td class="num">' + formatNumber(selection.installedMotorSpecificFanPowerKWPerTR || selection.specificFanPowerKWPerTR, 2) + "</td><td>kW/TR</td><td>Installed motor kW divided by TR_final duty for allowance / feeder planning</td></tr>"
	      + '<tr><td>Fan power basis</td><td class="num">' + formatNumber(finalDesign.fans.totalFanKW || 0, 2) + "</td><td>kW</td><td>Brake power is fan shaft duty; operating electrical power is brake kW / motor efficiency; installed motor kW is catalog motor allowance.</td></tr>"
      + '<tr><td>Airflow energy penalty</td><td class="num">' + formatNumber(selection.airflowPenaltyRatio, 2) + "x</td><td>-</td><td>" + airflowPenaltyText + "</td></tr>"
      + (ventilationAirflow > 0
        ? '<tr><td>Ventilation hardware</td><td class="num">' + formatInt(ventilationAirflow) + "</td><td>CFM</td><td>" + (processAirSelection ? processAirSelection.type + " process fan" : "") + ((processAirSelection && result.dedicatedVentilationSelection) ? " + " : "") + (result.dedicatedVentilationSelection && result.dedicatedVentilationSelection.fan ? escapeHtml(result.dedicatedVentilationSelection.fan.type || "Dedicated ventilation fan") : (!processAirSelection ? "Separate ventilation path recommended" : "")) + "</td></tr>"
        : "")
      + '<tr><td>Optimization note</td><td colspan="3">' + escapeHtml(optimizationNoteText) + "</td></tr>"
      + '<tr class="total-row"><td><b>Selection status</b></td><td class="num"><b>' + ahuStatus + '</b></td><td colspan="2" style="color:' + (ahu.adequate ? "var(--accent)" : "var(--accent4)") + ';">' + formatInt(conditionedAirflow) + " recirculation CFM @ " + formatInt(ahu.designESP || result.total_esp) + " Pa</td></tr>"
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
      + '<tr><td>Coordinate check</td><td class="num" style="color:' + ((layout.coordinateValidation && layout.coordinateValidation.status) === "REVIEW" ? "var(--accent3)" : "var(--accent)") + ';">' + escapeHtml((layout.coordinateValidation && layout.coordinateValidation.status) || "OK") + (layout.overlapCount ? " · " + formatInt(layout.overlapCount) + " overlap" : "") + "</td></tr>"
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
      + '<tr><td>Supply air DBT</td><td class="num">' + formatNumber(result.psychro.supplyTemp, 1) + "</td><td>deg C</td><td>From iterative room-process solution matched to load SHR</td></tr>"
      + '<tr><td>Supply humidity ratio</td><td class="num">' + formatNumber(result.psychro.supplyHumidity * 1000, 2) + "</td><td>g/kg</td><td>From room total-load enthalpy balance inside the iterative room-process solver</td></tr>"
      + '<tr><td>Coil ADP</td><td class="num">' + formatNumber(result.psychro.adpTemp, 1) + "</td><td>deg C</td><td>BF-consistent saturated apparatus point solved from the MA-SA coil process</td></tr>"
      + '<tr><td>Bypass factor</td><td class="num">' + formatNumber(result.psychro.bypassFactor, 3) + "</td><td>-</td><td>Average of temperature-side and humidity-side BF at the selected ADP</td></tr>"
      + '<tr><td>BF consistency</td><td class="num">' + formatNumber(Math.abs((result.psychro.bfTemp || result.psychro.bypassFactor || 0) - (result.psychro.bfHumidity || result.psychro.bypassFactor || 0)), 3) + '</td><td>-</td><td>' + escapeHtml((result.psychro.adpMethod || 'bf_consistent_search').replace(/_/g, " ")) + ' | humidity residual ' + formatNumber(result.psychro.adpHumidityError || 0, 3) + ' g/kg</td></tr>'
      + '<tr><td>OA fraction</td><td class="num">' + formatNumber(result.psychro.oaFraction * 100, 1) + "</td><td>%</td><td>Outdoor air share in mixed air, without artificial capping</td></tr>"
      + '<tr><td>Room SHR (load)</td><td class="num">' + formatNumber(result.roomShr || 0, 3) + '</td><td>-</td><td>Room sensible / room total from the load calculation</td></tr>'
      + '<tr><td>Room SHR (psychro)</td><td class="num">' + formatNumber(result.psychro.roomShrPsychro || result.roomShr || 0, 3) + '</td><td>-</td><td>Delivered sensible / delivered total from the room psychrometric process</td></tr>'
      + '<tr><td>SHR mismatch</td><td class="num">' + formatNumber(Math.abs(result.psychro.shrError || 0), 3) + '</td><td>-</td><td>' + (Math.abs(result.psychro.shrError || 0) > 0.03 ? 'Above tolerance - review psychrometric consistency' : 'Inside the 0.03 validation band') + '</td></tr>'
      + '<tr><td>Enthalpy residual</td><td class="num">' + formatNumber(result.psychro.enthalpyBalanceErrorKJkg || 0, 3) + "</td><td>kJ/kg</td><td>" + ((result.psychro.enthalpyBalanceErrorKJkg || 0) > 0.5 ? "Above the 0.5 kJ/kg tolerance" : "Inside the 0.5 kJ/kg tolerance") + "</td></tr>"
      + '<tr><td>Coil total load</td><td class="num">' + formatNumber(result.psychro.coilTotalLoad / 3517, 2) + "</td><td>TR</td><td>Psychrometric coil duty from MA to SA on the cooling-airflow stream</td></tr>"
      + (result.psychro.processNote
        ? '<tr><td>Process note</td><td colspan="3">' + escapeHtml(result.psychro.processNote) + "</td></tr>"
        : "")
      + '<tr class="total-row"><td><b>Recommended coil</b></td><td colspan="3"><b>' + ((result.systemShr || result.shr) > 0.85 ? "Standard chilled-water / DX coil" : "Deep cooling coil with tighter bypass factor") + "</b></td></tr>"
      + "</tbody></table>";
  }

  function renderSolarPanel(result) {
    const peak = result.solar.curve.reduce(function (best, row) {
      return row.shgf > best.shgf ? row : best;
    }, result.solar.curve[0]);

    setMetric("m-solar-design", formatInt(result.solar.point.coolingLoadSolarWm2 || result.solar.point.shgf), "W/m2");
    setMetric("m-solar-peak", peak.hour + ":00");
    setMetric("m-solar-alt", formatNumber(result.solar.point.altitude, 1), "deg");
    setMetric("m-solar-az", formatNumber(result.solar.point.azimuth, 1), "deg");

    SolarEngine.renderChart(byId("solar-chart"), {
      latitude: result.solar.latitude,
      dayOfYear: result.solar.dayOfYear,
      hours: result.solar.curve.map(function (row) { return row.hour; }),
      activeOrientation: result.solar.activeOrientation || result.inputs.win_orient,
      activeOrientationLabel: result.solar.activeOrientationLabel || orientationLabel(result.inputs.win_orient),
      activeCurve: result.solar.curve,
      designPoint: result.solar.point,
      series: result.solar.orientationSeries
    });

    byId("solar-table").innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">'
      + result.solar.curve.map(function (row) {
        return '<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:7px 10px;text-align:center;min-width:78px;">'
          + '<div style="font-size:9px;color:var(--text3);font-family:var(--mono);">' + row.hour + ':00</div>'
          + '<div style="font-family:var(--mono);font-size:14px;color:var(--accent3);">' + formatInt(row.coolingLoadSolarWm2 || row.shgf) + '</div>'
          + '<div style="font-size:9px;color:var(--text3);">incident ' + formatInt(row.incidentSolarOnGlassWm2 || 0) + '</div>'
          + '<div style="font-size:9px;color:var(--text3);">' + formatNumber(row.altitude, 1) + " deg alt</div>"
          + "</div>";
      }).join("")
      + "</div>";

    byId("solar-all-tbody").innerHTML = result.solar.curve.map(function (row, index) {
      const hourlyAll = result.solar.orientationSeries.map(function (series) {
        return '<td class="num">' + formatInt(series.points[index].coolingLoadSolarWm2 || series.points[index].shgf) + "</td>";
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
        shr: result.roomShr || result.systemShr || result.shr,
        bypassFactor: result.psychro.bypassFactor
      }
    );
  }

  function reportBlock(title, body, className) {
    const titleParts = String(title || "Report Section").split("·");
    const sectionLabel = titleParts.length > 1 ? titleParts[0].trim() : "REPORT";
    const sectionTitle = titleParts.length > 1 ? titleParts.slice(1).join("·").trim() : String(title || "Report Section");
    return '<section class="report-block' + (className ? " " + className : "") + '">'
      + '<div class="report-section-head">'
      + '<div><div class="report-section-label">' + escapeHtml(sectionLabel) + '</div><h4>' + escapeHtml(sectionTitle) + '</h4></div>'
      + '</div>'
      + '<div class="report-section-body">' + body + '</div>'
      + "</section>";
  }

  function reportSummaryCard(label, value, meta) {
    return '<div class="report-summary-card">'
      + '<div class="report-summary-label">' + escapeHtml(label || "") + '</div>'
      + '<div class="report-summary-value">' + escapeHtml(value == null || value === "" ? "—" : value) + '</div>'
      + (meta ? '<div class="report-summary-meta">' + escapeHtml(meta) + '</div>' : "")
      + '</div>';
  }

  function reportStatusPill(text) {
    return '<span class="report-status-pill">' + escapeHtml(text || "REVIEW") + '</span>';
  }

  function buildReportExecutiveSummary(result, totalRooms, energyReady) {
    const finalized = ensureFinalizedResult(result || {}, { promoteEnergySimulation: false });
    const finalDesign = finalized.finalDesign || {};
    const loads = finalDesign.loads || {};
    const airflow = finalDesign.airflow || {};
    const fans = finalDesign.fans || {};
    const esp = finalDesign.esp || {};
    const energy = finalized.finalEnergyResult || {};
    const validation = finalized.validationState || finalized.validation || {};
    const cfmPerTr = safeDiv(airflow.coolingCFM || 0, Math.max(loads.trFinal || 0, 0.1), 0);
    return '<div class="report-summary-grid">'
      + reportSummaryCard("Final capacity", formatNumber(loads.trFinal || 0, 2) + " TR", formatInt(loads.totalLoadW || 0) + " W total load")
      + reportSummaryCard("Cooling airflow", formatInt(airflow.coolingCFM || 0) + " CFM", formatNumber(cfmPerTr, 0) + " CFM/TR · " + (finalized.airflowDiagnostics && finalized.airflowDiagnostics.selectedAirflowDriver || finalized.airflowBasis && finalized.airflowBasis.airflowConstraint || "thermal"))
      + reportSummaryCard("Ventilation / ACH", (finalized.ventilationComplianceStatus || "COMPLIANT") + " / " + (finalized.achComplianceStatus || "ADVISORY"), "ACH " + formatNumber(airflow.ach || 0, 1) + " · " + (finalDesign.achRequirementMode || finalized.achRequirementMode || "advisory"))
      + reportSummaryCard("Validation", validation.status || "REVIEW", "Critical " + formatInt(validation.criticalCount || 0) + " · Warning " + formatInt(validation.warningCount || 0) + " · Advisory " + formatInt(validation.advisoryCount || 0))
      + reportSummaryCard("Fan / ESP", formatNumber(fans.totalFanKW || 0, 2) + " kW", formatInt(esp.totalPa || 0) + " Pa · " + formatNumber(fans.specificFanPowerKWPerTR || 0, 2) + " kW/TR")
      + reportSummaryCard("Energy", energyReady ? formatInt(energy.annual_energy_kwh || 0) + " kWh" : "Pending", energyReady ? formatCurrency(energy.energy_cost || 0) + " annual cost" : "Run energy simulation for annual values")
      + reportSummaryCard("Equipment", finalDesign.equipment && finalDesign.equipment.selectedAhuModel || "Selected AHU", formatNumber(finalDesign.equipment && finalDesign.equipment.selectedAhuTR || 0, 1) + " TR selected")
      + reportSummaryCard("Project scope", formatInt(totalRooms || 1) + " room(s)", "Active room result plus project roll-up")
      + '</div>';
  }

  function buildReportQualityStrip(result, energyReady) {
    const finalized = ensureFinalizedResult(result || {}, { promoteEnergySimulation: false });
    const finalDesign = finalized.finalDesign || {};
    const validation = finalized.validationState || finalized.validation || {};
    const consistency = finalized.reportConsistency || {};
    const aiReady = !!(finalized.designAdvisor && finalized.designAdvisor.assistant);
    return '<div class="report-summary-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:14px;">'
      + reportSummaryCard("Source of truth", "Finalized model", "Design " + (finalDesign.complianceMode || finalized.complianceMode || "comfort_ventilation") + " · Energy " + (energyReady ? "final" : "pending"))
      + reportSummaryCard("Report gate", consistency.ok === false ? "Blocked" : "Passed", consistency.ok === false ? "Consistency failure" : "Final-design consistency checked")
      + reportSummaryCard("Engineering status", validation.status || "REVIEW", "Confidence " + formatNumber((validation.confidenceScore || 0) * 100, 0) + "%")
      + reportSummaryCard("AI assistant", aiReady ? "Included" : "Local summary", aiReady ? "Structured design diagnostics" : "Generated from engineering facts")
      + '</div>';
  }

  function buildReportIndexMarkup() {
    const sections = [
      ["01", "Input & design basis"],
      ["02", "Cooling load"],
      ["03", "SHR"],
      ["04", "Tonnage"],
      ["05", "Airflow"],
      ["06", "Duct sizing"],
      ["07", "ESP"],
      ["08", "Fan selection"],
      ["09", "Diffuser layout"],
      ["10", "Psychrometrics"],
      ["10A", "Validation"],
      ["11", "Solar/glass load"],
      ["12", "Psychro chart"],
      ["13", "Multi-room"],
      ["14", "BOQ/costing"],
      ["15", "Energy"],
      ["16", "AI design studio"],
      ["16A", "ASHRAE engine — full sized design"],
      ["17", "3D schematic summary"]
    ];
    return '<div class="report-subtitle">Report Contents</div><div class="report-index">' + sections.map(function (section) {
      return '<div class="report-index-item"><span class="report-index-num">' + escapeHtml(section[0]) + '</span>' + escapeHtml(section[1]) + '</div>';
    }).join("") + '</div>';
  }

  function buildReportCoverMarkup(result, project, activeRoom, totalRooms, reportDate, energyReady) {
    const locationText = window._selectedCity ? window._selectedCity.city + ", " + window._selectedCity.region : "User-defined";
    return '<div class="report-cover-shell">'
      + '<div class="report-cover-top">'
      + '<div class="report-cover-title-zone">'
      + '<div class="report-cover-eyebrow">MEP Pro · AI Powered HVAC Design Engine</div>'
      + '<div class="report-cover-title">HVAC Design Calculation Report</div>'
      + '<div class="report-cover-subtitle">Enterprise engineering package with load calculation, psychrometrics, airflow-role validation, duct and ESP diagnostics, energy simulation, costing, optimization, and AI design advisory.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:22px;"><span class="report-chip">FINALIZED DESIGN MODEL</span><span class="report-chip">AI DESIGN ASSISTANT</span><span class="report-chip">CONSISTENCY CHECKED</span></div>'
      + '</div>'
      + '<div class="report-cover-brand">'
      + '<div class="report-cover-brand-card">'
      + '<div class="report-brand-word"><span class="report-brand-main">Musk</span><span class="report-brand-accent">-IT</span></div>'
      + '<div class="report-brand-tag">Professional HVAC Design Platform</div>'
      + '<div class="report-divider" style="margin:14px 0;"></div>'
      + '<div style="display:grid;gap:8px;">'
      + '<span class="report-chip report-chip-soft">HVAC DESIGN REPORT</span>'
      + '<span class="report-chip report-chip-soft">HAP-style calculation workflow</span>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="report-cover-meta">'
      + '<div class="report-kv">'
      + "<dt>Project name</dt><dd>" + escapeHtml(project ? project.name : "HVAC Project") + "</dd>"
      + "<dt>Active room</dt><dd>" + escapeHtml(activeRoom ? activeRoom.name : "Room 1") + "</dd>"
      + "<dt>Design location</dt><dd>" + escapeHtml(locationText) + "</dd>"
      + "<dt>Project room count</dt><dd>" + formatInt(totalRooms || 1) + "</dd>"
      + "<dt>Outdoor design</dt><dd>" + escapeHtml(result.inputs.out_dbt + " deg C DBT / " + formatNumber(result.outdoorRelativeHumidity, 0) + "% RH") + "</dd>"
      + "</div>"
      + '<div class="report-kv">'
      + "<dt>Report date / time</dt><dd>" + escapeHtml(reportDate.toLocaleString()) + "</dd>"
      + "<dt>Prepared by</dt><dd>Ankit Biswas Sharma</dd>"
      + "<dt>Calculation method</dt><dd>ASHRAE CLTD / effective solar cooling load / psychrometric process</dd>"
      + "<dt>Prepared for</dt><dd>Musk-IT design issue / PDF package</dd>"
      + "<dt>Indoor design</dt><dd>" + escapeHtml(result.inputs.in_dbt + " deg C / " + result.inputs.in_rh + "% RH") + "</dd>"
      + "</div>"
      + '</div>'
      + '<div class="report-exec-band">'
      + buildReportExecutiveSummary(result, totalRooms, energyReady)
      + buildReportQualityStrip(result, energyReady)
      + buildReportIndexMarkup()
      + '</div>'
      + '</div>';
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

  function validationStatusColor(status) {
    return status === "NON_COMPLIANT"
      ? "var(--accent4)"
      : status === "REVIEW"
        ? "var(--accent3)"
        : "var(--accent)";
  }

  function buildValidationReportMarkup(result) {
    ensureFinalizedResult(result || {}, { promoteEnergySimulation: false });
    const validation = result && result.validationState ? result.validationState : { status: "REVIEW", summary: "Validation not available.", findings: [], confidenceScore: 0.5, assumptions: [] };
    const findings = Array.isArray(validation.findings) ? validation.findings : [];
    const engineeringNotes = [
      result && result.designConstraints && result.designConstraints.summary ? result.designConstraints.summary : "",
      result && result.systemRecommendation && result.systemRecommendation.reasoning ? result.systemRecommendation.reasoning : "",
      result && result.energyOptimization && result.energyOptimization.summary ? result.energyOptimization.summary : ""
    ].filter(Boolean);

    return '<div class="report-grid-2">'
      + '<div>'
      + '<div class="report-subtitle">Design Validation Summary</div>'
      + '<div style="padding:12px 14px;border:1px solid rgba(148,163,184,0.22);border-left:4px solid ' + validationStatusColor(validation.status) + ';border-radius:12px;background:rgba(15,23,42,0.02);">'
      + '<div style="font-size:13px;font-weight:700;color:' + validationStatusColor(validation.status) + ';">' + escapeHtml(validation.status || "REVIEW") + '</div>'
      + '<div style="margin-top:6px;font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;">' + escapeHtml(validation.summary || "Validation summary unavailable.") + '</div>'
      + '<div style="margin-top:8px;font-size:10px;color:var(--text3);font-family:var(--mono);line-height:1.4;">Confidence ' + formatNumber((validation.confidenceScore || 0) * 100, 0) + '% | Critical ' + formatInt(validation.criticalCount || 0) + ' | Warning ' + formatInt(validation.warningCount || 0) + ' | Advisory ' + formatInt(validation.advisoryCount || 0) + '</div>'
      + "</div>"
      + '</div>'
      + '<div>'
      + '<div class="report-subtitle">Engineering Notes</div>'
      + (engineeringNotes.length
        ? '<div style="display:grid;gap:8px;">' + engineeringNotes.map(function (note) {
          return '<div class="report-inline-note">' + escapeHtml(note) + '</div>';
        }).join("") + '</div>'
        : '<div class="report-inline-note">No additional engineering notes were generated for this room.</div>')
      + '</div>'
      + '</div>'
      + '<div class="report-subtitle">Errors & Warnings</div>'
      + (findings.length
        ? designAdvisorCardsMarkup(findings.map(function (finding) {
          return {
            severity: finding.severity,
            title: finding.title,
            issue: finding.detail,
            recommendation: finding.recommendation,
            basis: finding.basis,
            complianceStatus: finding.complianceStatus,
            confidenceScore: validation.confidenceScore
          };
        }), false)
        : '<div class="report-inline-note">No active validation errors or warnings were found.</div>')
      + '<div class="report-subtitle">Assumptions Used</div>'
      + ((validation.assumptions || []).length
        ? '<div style="display:grid;gap:6px;">' + (validation.assumptions || []).slice(0, 8).map(function (assumption) {
          return '<div class="report-inline-note">' + escapeHtml(assumption) + '</div>';
        }).join("") + '</div>'
        : '<div class="report-inline-note">No explicit assumptions were captured for this run.</div>');
  }

  // -------------------------------------------------------------------
  // ASHRAE engine — full sized design report block.
  // Pulls from window.__lastAshraeDesign (set by aiDesignerUI.js when the
  // user clicks "Generate full design" or "Auto-fix"). If nothing has
  // been generated yet, emits a placeholder so the section still appears
  // in the PDF index and the user knows where to find it.
  // -------------------------------------------------------------------
  function buildAshraeDesignReportMarkup() {
    const wrap = (typeof window !== "undefined") ? window : {};
    const payload = wrap.__lastAshraeDesign || wrap.__lastAshraeAutofix || null;
    if (!payload || !payload.design) {
      return ''
        + '<div class="report-inline-note">'
        + 'No ASHRAE-engine design has been generated for this session yet. '
        + 'Open the <b>AI Design Studio</b> panel and click <b>Generate full design</b> '
        + '(or <b>Auto-fix</b>) before printing this report so the engine output is captured here.'
        + '</div>';
    }
    const design = payload.design;
    const a = design.aggregate || {};
    const fan = design.fan || {};
    const pump = design.pump;
    const rooms = design.rooms || [];

    function roundNum(value, digits) {
      const factor = Math.pow(10, digits || 0);
      return Math.round((Number(value) || 0) * factor) / factor;
    }

    const cards = ''
      + '<div class="report-summary-grid">'
      +   reportSummaryCard("Total Cooling", roundNum(a.totalLoadW / 1000, 1) + " kW", roundNum(a.totalLoadW, 0) + " W total")
      +   reportSummaryCard("Selected Tonnage", roundNum(a.selectedTR, 1) + " TR", "Diversified " + roundNum(a.diversifiedTR, 2) + " TR")
      +   reportSummaryCard("Supply Air", formatInt(a.totalCfm) + " CFM", "System type: " + (design.systemType || "—"))
      +   reportSummaryCard("Fan Motor Input", roundNum(fan.motorInputKw, 2) + " kW", roundNum(fan.shaftKw, 2) + " kW shaft")
      +   reportSummaryCard("Fan W/CFM", roundNum(fan.wPerCfm, 2),
            "ASHRAE 90.1 limit " + (fan.ashrae90_1Limit || 1.1) + " · "
            + (fan.ashrae90_1Compliant ? "COMPLIANT" : "REVIEW"))
      +   reportSummaryCard("Diversity factor", roundNum(a.diversityFactor || 1, 2),
            "Applied to load only — airflow is not discounted")
      +   reportSummaryCard("External SP", formatInt(fan.externalSpPa || 0) + " Pa",
            roundNum(fan.fanEfficiency || 0.65, 2) + " fan η")
      +   reportSummaryCard("Engine version", "v" + (design.engineVersion || "?"),
            "engine/ashrae · ASHRAE HOF psychrometrics")
      + '</div>';

    // Room rollup table
    const roomRows = rooms.map(function (r) {
      const rl = r.roomLoad || {};
      const sa = r.supplyAir || {};
      return '<tr>'
        + '<td>' + escapeHtml(r.room || "Room") + '</td>'
        + '<td class="num">' + formatInt(rl.sensibleW || 0) + '</td>'
        + '<td class="num">' + formatInt(rl.latentW || 0) + '</td>'
        + '<td class="num">' + formatInt(rl.totalW || 0) + '</td>'
        + '<td class="num">' + roundNum(rl.shr || 0, 2) + '</td>'
        + '<td class="num">' + formatInt(sa.cfm || 0) + '</td>'
        + '<td class="num">' + roundNum(r.designTR || 0, 2) + '</td>'
        + '<td class="num">' + (r.selectedTR || 0) + '</td>'
        + '</tr>';
    }).join("");
    const roomTable = ''
      + '<div class="report-subtitle">Room rollup</div>'
      + '<table style="width:100%;border-collapse:collapse;">'
      + '<thead><tr>'
      +   '<th>Room</th><th>Sens. W</th><th>Lat. W</th><th>Total W</th>'
      +   '<th>SHR</th><th>CFM</th><th>Design TR</th><th>Sel. TR</th>'
      + '</tr></thead>'
      + '<tbody>' + (roomRows || '<tr><td colspan="8">No rooms in design.</td></tr>') + '</tbody>'
      + '</table>';

    // Components for first room (assumed representative)
    const firstRoom = rooms[0] || { components: [] };
    const compRows = (firstRoom.components || []).map(function (c) {
      return '<tr>'
        + '<td>' + escapeHtml(c.kind) + '</td>'
        + '<td class="num">' + formatInt(c.sensibleW || 0) + '</td>'
        + '<td class="num">' + formatInt(c.latentW || 0) + '</td>'
        + '</tr>';
    }).join("");
    const compTable = ''
      + '<div class="report-subtitle">Load components &mdash; ' + escapeHtml(firstRoom.room || "Room") + '</div>'
      + '<table style="width:100%;border-collapse:collapse;">'
      + '<thead><tr><th>Component</th><th>Sensible W</th><th>Latent W</th></tr></thead>'
      + '<tbody>' + (compRows || '<tr><td colspan="3">No components reported.</td></tr>') + '</tbody>'
      + '</table>';

    // Pump block (optional)
    const pumpBlock = pump
      ? '<div class="report-inline-note">'
        + '<b>Chilled-water pump:</b> '
        + roundNum(pump.flowLps, 1) + ' L/s · '
        + formatInt(pump.flowGpm) + ' GPM · '
        + roundNum(pump.headM, 1) + ' m head · '
        + roundNum(pump.electricalKw, 2) + ' kW input.'
        + '</div>'
      : "";

    // Narrative
    const narr = payload.narrative;
    const narrBlock = (narr && narr.summary)
      ? '<div class="report-ai-card">'
        + '<div class="report-ai-card-title">AI engineering narrative</div>'
        + '<div class="report-ai-card-body">' + escapeHtml(narr.summary) + '</div>'
        + (Array.isArray(narr.design_decisions) && narr.design_decisions.length
            ? '<div class="report-ai-card-body"><b>Decisions:</b><ul>'
              + narr.design_decisions.map(function (d) { return '<li>' + escapeHtml(d) + '</li>'; }).join("")
              + '</ul></div>'
            : "")
        + (Array.isArray(narr.risks) && narr.risks.length
            ? '<div class="report-ai-card-body"><b>Risks:</b><ul>'
              + narr.risks.map(function (d) { return '<li>' + escapeHtml(d) + '</li>'; }).join("")
              + '</ul></div>'
            : "")
        + '</div>'
      : "";

    // Auto-fix transcript if present
    const autofix = wrap.__lastAshraeAutofix;
    const autofixBlock = (autofix && autofix.log && autofix.log.length)
      ? (function () {
          const rows = autofix.log.map(function (s) {
            return '<tr>'
              + '<td class="num">' + s.iter + '</td>'
              + '<td>' + ((s.fails || []).join(", ") || "<em>none</em>") + '</td>'
              + '<td>' + Object.entries(s.intent || {}).map(function (e) { return e[0] + "=" + e[1]; }).join("; ") + '</td>'
              + '</tr>';
          }).join("");
          return '<div class="report-subtitle">Auto-fix transcript</div>'
            + '<div>' + reportStatusPill(autofix.success
                  ? "CONVERGED in " + autofix.iterations + " step(s)"
                  : "PARTIAL — " + autofix.iterations + " step(s)")
            + '</div>'
            + '<table style="width:100%;border-collapse:collapse;margin-top:6px;">'
            + '<thead><tr><th>Iter</th><th>Failing constraints</th><th>Intent applied</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table>';
        })()
      : "";

    return ''
      + cards
      + '<div class="report-inline-note">The numbers above come from <b>engine/ashrae</b> '
      + '(SI ASHRAE psychrometrics, monthly clear-sky solar model, ASHRAE 90.1 fan power limits). '
      + 'AI narrates them but never invents values.</div>'
      + roomTable
      + compTable
      + pumpBlock
      + narrBlock
      + autofixBlock;
  }

  function buildAiReportMarkup(result) {
    const designAdvisor = result && result.designAdvisor ? result.designAdvisor : null;
    const designAdvisorStatus = result && result.designAdvisorStatus ? result.designAdvisorStatus : "ready";
    const designAdvisorMeta = result && result.designAdvisorMeta ? result.designAdvisorMeta : null;
    const designAdvisorError = result && result.designAdvisorError ? result.designAdvisorError : "";
    const optimization = result && result.designOptimization ? result.designOptimization : null;
    const alternatives = result && result.designAlternatives ? result.designAlternatives : null;
    const alternativesStatus = result && result.designAlternativesStatus ? result.designAlternativesStatus : "ready";
    const alternativesMeta = result && result.designAlternativesMeta ? result.designAlternativesMeta : null;
    const alternativesError = result && result.designAlternativesError ? result.designAlternativesError : "";
    const cleanroom = result && result.cleanroom ? result.cleanroom : null;
    const options = alternatives && Array.isArray(alternatives.options) ? alternatives.options : [];
    const preferredOptionKey = alternatives && alternatives.preferredOptionKey ? alternatives.preferredOptionKey : "";
    const scenarioResults = optimizationScenarioResults(result, alternatives, alternativesStatus);
    const optimizationBacked = alternatives && alternatives.provider === "local_optimization";
    const assistant = designAdvisor && designAdvisor.assistant ? designAdvisor.assistant : null;

    const aiStatusLine = [
      designAdvisorStatusLabel(designAdvisorStatus, designAdvisor && designAdvisor.provider, designAdvisorError),
      designAlternativesStatusLabel(alternativesStatus, alternatives && alternatives.provider, alternativesError),
      optimization && optimization.optimizationValiditySummary ? optimization.optimizationValiditySummary : ""
    ].filter(Boolean).join(" | ");

    return '<div class="report-grid-2">'
      + '<div><div class="report-subtitle">AI Design Status</div>'
      + '<div class="report-inline-note">Advisor: ' + escapeHtml(designAdvisorSourceLabel(designAdvisor && designAdvisor.provider)) + '</div>'
      + '<div class="report-inline-note">Alternatives: ' + escapeHtml(designAlternativesSourceLabel(alternatives && alternatives.provider)) + '</div>'
      + '<div class="report-inline-note">' + escapeHtml(aiStatusLine || "AI design assistant is ready.") + '</div></div>'
      + '<div><div class="report-subtitle">AI Recommendation State</div>'
      + (optimization && optimization.finalRecommendation
        ? '<div class="report-inline-note"><b>' + escapeHtml(optimization.finalRecommendation.title || "Recommendation") + ':</b> ' + escapeHtml(optimization.finalRecommendation.rationale || "") + '</div>'
        : '<div class="report-inline-note">' + escapeHtml(alternatives && alternatives.summary ? alternatives.summary : "No optimization-backed recommendation is available yet.") + '</div>')
      + '</div></div>'
      + firstResultsGridMarkup("p-ai")
      + (assistant
        ? '<div class="report-subtitle">AI HVAC Design Assistant</div>'
          + '<div class="report-ai-metric-grid">'
          + assistant.metrics.map(function (metric) {
            return '<div class="report-summary-card">'
              + '<div class="report-summary-label">' + escapeHtml(metric.label) + '</div>'
              + '<div class="report-summary-value">' + formatNumber(metric.value || 0, metric.key === "shr" || metric.key === "bypass" ? 2 : metric.key === "cfm_per_tr" ? 0 : 1) + ' ' + escapeHtml(metric.unit || "") + '</div>'
              + '<div class="report-summary-meta">' + escapeHtml(metric.status || "review") + '</div>'
              + '</div>';
          }).join("")
          + '</div>'
          + '<div class="table-wrap" style="margin-top:10px;"><table class="calc-table"><thead><tr><th>METRIC</th><th>VALUE</th><th>STATUS</th></tr></thead><tbody>'
          + assistant.metrics.map(function (metric) {
            return '<tr><td>' + escapeHtml(metric.label) + '</td><td class="num">' + formatNumber(metric.value || 0, metric.key === "shr" || metric.key === "bypass" ? 2 : metric.key === "cfm_per_tr" ? 0 : 1) + ' ' + escapeHtml(metric.unit || "") + '</td><td>' + escapeHtml(metric.status || "review") + '</td></tr>';
          }).join("")
          + '</tbody></table></div>'
          + '<div class="report-ai-card-grid">'
          + assistant.sections.map(function (section) {
            return '<div class="report-ai-card"><div class="report-ai-card-title">' + escapeHtml(section.title) + '</div><div class="report-ai-card-body">' + escapeHtml((section.bullets || []).join(" ")) + '</div></div>';
          }).join("")
          + '</div>'
        : "")
      + '<div class="report-grid-2">'
      + '<div>'
      + '<div class="report-subtitle">AI Review Assistant</div>'
      + '<div class="report-inline-note">Source: ' + escapeHtml(designAdvisorSourceLabel(designAdvisor && designAdvisor.provider)) + '</div>'
      + '<div class="report-inline-note">' + escapeHtml(designAdvisorStatusLabel(designAdvisorStatus, designAdvisor && designAdvisor.provider, designAdvisorError)) + (designAdvisorTimestamp(designAdvisorMeta) ? ' Updated ' + escapeHtml(designAdvisorTimestamp(designAdvisorMeta)) + '.' : '') + '</div>'
      + '<div class="report-inline-note" style="margin-bottom:10px;">' + escapeHtml(designAdvisor && designAdvisor.summary ? designAdvisor.summary : "No AI review summary available.") + '</div>'
      + designAdvisorCardsMarkup(designAdvisor && designAdvisor.items ? designAdvisor.items : [], false)
      + '</div>'
      + '<div>'
      + '<div class="report-subtitle">AI Alternatives Summary</div>'
      + '<div class="report-inline-note">Source: ' + escapeHtml(designAlternativesSourceLabel(alternatives && alternatives.provider)) + '</div>'
      + '<div class="report-inline-note">' + escapeHtml(designAlternativesStatusLabel(alternativesStatus, alternatives && alternatives.provider, alternativesError)) + (designAdvisorTimestamp(alternativesMeta) ? ' Updated ' + escapeHtml(designAdvisorTimestamp(alternativesMeta)) + '.' : '') + '</div>'
      + '<div class="report-inline-note">' + escapeHtml(alternatives && alternatives.summary ? alternatives.summary : "No alternative-design summary available.") + '</div>'
      + (alternatives && alternatives.standardsNote
        ? '<div class="report-inline-note">' + escapeHtml(alternatives.standardsNote) + '</div>'
        : '')
      + (cleanroom
        ? '<div class="report-inline-note"><b>Cleanroom basis:</b> ' + escapeHtml(cleanroom.classLabel + " · " + cleanroom.stateLabel + " · " + cleanroom.pressureLabel) + '</div>'
        : '')
      + '</div>'
      + '</div>'
      + (optimization && optimization.baseSystemSummary
        ? '<div class="report-subtitle">Optimization Summary</div>'
          + '<div class="report-grid-2">'
          + '<div>'
          + '<div class="report-inline-note"><b>Base system:</b> ' + escapeHtml(optimization.baseSystemSummary.architecture || "Current design") + '</div>'
          + '<div class="report-inline-note"><b>Base airflows:</b> Cooling ' + formatInt(optimization.baseSystemSummary.coolingAirflowCfm || 0) + ' CFM | Recirculation ' + formatInt(optimization.baseSystemSummary.recirculationAirflowCfm || 0) + ' CFM | Ventilation ' + formatInt(optimization.baseSystemSummary.ventilationAirflowCfm || 0) + ' CFM</div>'
          + '<div class="report-inline-note"><b>Base return loop:</b> To coil ' + formatInt(optimization.baseSystemSummary.returnAirToCoilCfm || 0) + ' CFM | Bypass ' + formatInt(optimization.baseSystemSummary.returnAirBypassCfm || 0) + ' CFM | Vent path ' + formatInt(optimization.baseSystemSummary.returnAirVentilationPathCfm || 0) + ' CFM</div>'
          + '<div class="report-inline-note"><b>Base fan / ESP:</b> ' + formatNumber(optimization.baseSystemSummary.totalFanKW || 0, 2) + ' kW | ' + formatInt(optimization.baseSystemSummary.totalEspPa || 0) + ' Pa</div>'
          + '<div class="report-inline-note"><b>Base tonnage:</b> TR_final ' + formatNumber(optimization.baseSystemSummary.trFinal || 0, 2) + ' | Coil ' + formatNumber(optimization.baseSystemSummary.trCoolingCoil || 0, 2) + '</div>'
          + '</div>'
          + '<div>'
          + '<div class="report-inline-note"><b>Best energy:</b> ' + escapeHtml(optimization.rankedSolutions && optimization.rankedSolutions.bestEnergy ? optimization.rankedSolutions.bestEnergy.title : "—") + '</div>'
          + '<div class="report-inline-note"><b>Best cost:</b> ' + escapeHtml(optimization.rankedSolutions && optimization.rankedSolutions.bestCost ? optimization.rankedSolutions.bestCost.title : "—") + '</div>'
          + '<div class="report-inline-note"><b>Recommended balance:</b> ' + escapeHtml(optimization.rankedSolutions && optimization.rankedSolutions.bestBalance ? optimization.rankedSolutions.bestBalance.title : "—") + '</div>'
          + '<div class="report-inline-note"><b>Final recommendation:</b> ' + escapeHtml(optimization.finalRecommendation && optimization.finalRecommendation.rationale ? optimization.finalRecommendation.rationale : "Optimization recommendation unavailable.") + '</div>'
          + '<div class="report-inline-note"><b>Base annual energy:</b> ' + formatInt(optimization.baseSystemSummary.annualEnergyKwh || 0) + ' kWh | <b>Energy cost:</b> INR ' + formatInt(optimization.baseSystemSummary.energyCost || 0) + '</div>'
          + '<div class="report-inline-note"><b>Base capex:</b> INR ' + formatInt(optimization.baseSystemSummary.capexTotalInr || 0) + ' | <b>Validation:</b> ' + escapeHtml(optimization.baseSystemSummary.validationStatus || "—") + '</div>'
          + '</div>'
          + '</div>'
          + (optimization.identifiedInefficiencies && optimization.identifiedInefficiencies.length
            ? '<div class="report-inline-note"><b>Identified inefficiencies:</b> ' + escapeHtml(optimization.identifiedInefficiencies.map(function (entry) {
              return entry.problem || entry.key || "Issue";
            }).slice(0, 3).join(" | ")) + '</div>'
            : '')
        : '')
      + '<div class="report-subtitle">' + (optimizationBacked ? "Simulated Scenario Results" : "Alternative Concepts") + '</div>'
      + (optimizationBacked && scenarioResults.length
        ? '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">' + scenarioResults.map(function (scenario) {
          return optimizationScenarioCardMarkup(scenario, preferredOptionKey);
        }).join("") + '</div>'
        : options.length
        ? '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">' + options.map(function (option) {
          return designAlternativeCardMarkup(option, preferredOptionKey);
        }).join("") + '</div>'
        : '<div class="report-inline-note">No alternative concepts available for this room yet.</div>')
      + '<div class="report-subtitle">' + (optimizationBacked ? "Scenario Comparison" : "Option Comparison") + '</div>'
      + (optimizationBacked && scenarioResults.length
        ? optimizationScenarioTableMarkup(scenarioResults, preferredOptionKey)
        : options.length
        ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>OPTION</th><th>SYSTEM</th><th>CFM</th><th>ACH</th><th>CAPEX Δ</th><th>ENERGY Δ</th><th>SCORES</th><th>STATUS</th><th>SCOPE</th></tr></thead><tbody>'
          + options.map(function (option) {
            return '<tr><td>' + escapeHtml(option.title || "Option") + (option.key === preferredOptionKey ? ' <span class="admin-chip">PREFERRED</span>' : "") + '</td><td>' + escapeHtml(option.systemType || "—") + '</td><td class="num">' + formatInt(option.airflowCfm || 0) + '</td><td class="num">' + formatNumber(option.ach || 0, 1) + '</td><td class="num">' + (option.capexDeltaPercent > 0 ? "+" : "") + formatInt(option.capexDeltaPercent || 0) + '%</td><td class="num">' + (option.energyDeltaPercent > 0 ? "+" : "") + formatInt(option.energyDeltaPercent || 0) + '%</td><td class="num">C ' + formatInt(option.costScore || 0) + ' | E ' + formatInt(option.efficiencyScore || 0) + ' | Q ' + formatInt(option.complianceScore || 0) + '</td><td class="num">' + escapeHtml(option.complianceStatus || "COMPLIANT") + (option.confidenceScore != null ? ' | ' + formatNumber(option.confidenceScore * 100, 0) + '%' : "") + '</td><td>' + escapeHtml(option.scope || "—") + '</td></tr>';
          }).join("")
          + '</tbody></table></div>'
        : '<div class="report-inline-note">Option-comparison table unavailable.</div>');
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
    const project = typeof ProjectManager !== "undefined" && ProjectManager && typeof ProjectManager.getProject === "function"
      ? ProjectManager.getProject()
      : null;
    const rates = readRates();
	    const zoneAhuStrategy = result.zoneAhuStrategy || {};
	    const zoneDuctPlan = result.zoneDuctPlan || {};
	    const airsideProfile = result.airsideProfile || {};
	    const finalDesign = result.finalDesign || buildFinalDesign(result);
	    const processStaticPa = finalDesign.airflow.ventilationCFM > 0
	      ? Math.min(
          Math.max(
            (result.dedicatedVentilationSystem && result.dedicatedVentilationSystem.espPa) || zoneDuctPlan.maxProcessESP || airsideProfile.recommendedProcessStaticPa || result.total_esp * 0.55,
            airsideProfile.recommendedProcessStaticPa || 120
          ),
          airsideProfile.largeIndustrialHall ? 200 : 350
        )
      : 0;
	    const processScheduleRatio = finalDesign.airflow.ventilationCFM > 0
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
	    const conditionedFanDesignKw = finalDesign.fans.recirculationFanKW;
	    const recircDelta = Math.abs(finalDesign.airflow.recirculationCFM - (result.airflows && result.airflows.recirculation ? result.airflows.recirculation.airflowCfm || 0 : finalDesign.airflow.recirculationCFM));
	    if (finalDesign.airflow.recirculationCFM > 0 && recircDelta / finalDesign.airflow.recirculationCFM > 0.01) {
	      throw new Error("Energy input recirculation airflow differs from finalDesign airflow by more than 1%.");
	    }

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
	        conditioned_airflow_cfm: roundTo(finalDesign.airflow.recirculationCFM, 2),
	        process_airflow_cfm: roundTo(finalDesign.airflow.ventilationCFM, 2),
	        peak_conditioned_fan_kw: conditionedFanDesignKw,
        process_fan_static_pa: roundTo(processStaticPa, 0),
        tariff_per_kwh: roundTo(rates.rate_energy || DEFAULT_RATES.rate_energy, 2),
        process_air_schedule_ratio: roundTo(processScheduleRatio, 2),
        min_ahu_airflow_ratio: 0.30,
        chiller_cop_full_load: 3.5,
        chiller_cop_half_load: 5.0,
        process_fan_efficiency: 0.62,
	        process_motor_efficiency: 0.92
	      },
	      finalDesign: finalDesign
	    };
	  }

  function advisorItemsForSection(advisor, categories, limit) {
    const allowed = {};
    (categories || []).forEach(function (category) {
      allowed[category] = true;
    });
    return (advisor && Array.isArray(advisor.items) ? advisor.items : []).filter(function (item) {
      return !categories || !categories.length || allowed[item.category];
    }).slice(0, limit || 4);
  }

  function advisoryReferencesMarkup(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return '<p style="color:var(--text3);font-family:var(--mono);font-size:11px;">No section-specific advisory references.</p>';
    }
    return '<div class="advisory-reference-list" style="display:grid;gap:6px;min-width:0;">' + list.map(function (item) {
      return '<div style="font-size:11px;color:var(--text2);font-family:var(--mono);line-height:1.5;overflow-wrap:break-word;white-space:normal;">' + escapeHtml((item.category || "advisory") + " · " + (item.issueCode || item.key || "") + " · " + (item.title || "Recommendation")) + "</div>";
    }).join("") + "</div>";
  }

  function classifyMetricStatus(value, goodMin, goodMax, reviewMin, reviewMax) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "review";
    }
    if (numeric >= goodMin && numeric <= goodMax) {
      return "good";
    }
    if (numeric >= reviewMin && numeric <= reviewMax) {
      return "acceptable";
    }
    return "review";
  }

  function buildAiDesignAssistant(result, advisor) {
    const finalized = ensureFinalizedResult(result || {}, { promoteEnergySimulation: false });
    const finalDesign = finalized.finalDesign;
    const finalEnergy = finalized.finalEnergyResult || {};
    const basis = finalized.airflowBasis || {};
    const psychro = finalized.psychro || {};
    const diagnostics = finalized.airflowDiagnostics || {};
    const esp = finalized.ductDiagnostics || {};
    const area = Math.max(finalized.area || 0, 1);
    const annualKwhPerTr = finalEnergy.annual_kwh_per_tr_year || safeDiv(finalEnergy.annual_energy_kwh || 0, finalDesign.loads.trFinal || 0, 0);
    const reservePercent = roundTo(safeDiv((finalDesign.equipment.selectedAhuTR || 0) - finalDesign.loads.trFinal, Math.max(finalDesign.loads.trFinal, 0.1), 0) * 100, 1);
    const metrics = [
      { key: "wm2", label: "W/m2", value: roundTo(finalDesign.loads.totalLoadW / area, 1), unit: "W/m2", status: classifyMetricStatus(finalDesign.loads.totalLoadW / area, 80, 180, 45, 260) },
      { key: "tr", label: "TR", value: finalDesign.loads.trFinal, unit: "TR", status: finalDesign.loads.trFinal > 0 ? "good" : "critical" },
      { key: "cfm_per_tr", label: "CFM/TR", value: roundTo(diagnostics.actualCfmPerTr || finalDesign.airflow.coolingCFM / Math.max(finalDesign.loads.trFinal, 0.1), 1), unit: "CFM/TR", status: diagnostics.status === "HIGH" || diagnostics.status === "LOW" ? "review" : "good" },
      { key: "shr", label: "SHR", value: roundTo(finalized.systemShr || finalized.shr || 0, 3), unit: "-", status: classifyMetricStatus(finalized.systemShr || finalized.shr || 0, 0.72, 0.92, 0.62, 0.98) },
      { key: "oa_fraction", label: "OA fraction", value: roundTo((psychro.oaFraction || 0) * 100, 1), unit: "%", status: classifyMetricStatus((psychro.oaFraction || 0) * 100, 5, 35, 0, 55) },
      { key: "ach", label: "ACH", value: finalDesign.airflow.ach, unit: "ACH", status: finalized.achComplianceStatus === "NON_COMPLIANT" ? "critical" : finalized.achComplianceStatus === "ADVISORY" ? "acceptable" : "good" },
      { key: "supply_temp", label: "Supply air", value: roundTo(psychro.supplyTemp || 0, 1), unit: "C", status: classifyMetricStatus(psychro.supplyTemp || 0, 10.5, 16.5, 7, 18) },
      { key: "adp", label: "Coil ADP", value: roundTo(psychro.adpTemp || 0, 1), unit: "C", status: classifyMetricStatus(psychro.adpTemp || 0, 6, 14, 3, 17) },
      { key: "bypass", label: "Bypass factor", value: roundTo(psychro.bypassFactor || 0, 2), unit: "-", status: classifyMetricStatus(psychro.bypassFactor || 0, 0, 0.14, 0, 0.22) },
      { key: "esp", label: "ESP", value: finalDesign.esp.totalPa, unit: "Pa", status: finalDesign.esp.totalPa > 1000 ? "review" : "acceptable" },
      { key: "fan_kw_tr", label: "Fan kW/TR", value: finalDesign.fans.specificFanPowerKWPerTR, unit: "kW/TR", status: classifyMetricStatus(finalDesign.fans.specificFanPowerKWPerTR, 0, 0.55, 0, 0.9) },
      { key: "annual_kwh", label: "Annual kWh", value: roundTo(finalEnergy.annual_energy_kwh || 0, 0), unit: "kWh", status: finalEnergy.annual_energy_kwh ? "acceptable" : "review" },
      { key: "kwh_tr_year", label: "kWh/TR-year", value: roundTo(annualKwhPerTr || 0, 0), unit: "kWh/TR-year", status: annualKwhPerTr ? classifyMetricStatus(annualKwhPerTr, 0, 1800, 0, 2600) : "review" },
      { key: "reserve", label: "Reserve margin", value: reservePercent, unit: "%", status: classifyMetricStatus(reservePercent, 4, 18, -2, 30) }
    ];
    const items = advisor && Array.isArray(advisor.items) ? advisor.items : [];
    const immediate = items.filter(function (item) { return item.severity === "critical" || item.severity === "warning"; }).slice(0, 3);
    const optional = items.filter(function (item) { return item.severity !== "critical" && item.severity !== "warning"; }).slice(0, 3);
    const actions = (immediate.length ? immediate : optional).map(function (item) { return item.recommendation; }).filter(Boolean).slice(0, 3);
    return {
      title: "AI HVAC Design Assistant",
      metrics: metrics,
      sections: [
        { title: "Design Snapshot", bullets: ["Mode: " + finalDesign.complianceMode + "; ACH " + finalDesign.achRequirementMode + ".", "Final duty " + formatNumber(finalDesign.loads.trFinal, 2) + " TR with " + formatInt(finalDesign.airflow.coolingCFM) + " CFM cooling airflow."] },
        { title: "Load Profile", bullets: ["Load intensity is " + formatNumber(finalDesign.loads.totalLoadW / area, 1) + " W/m2 and SHR is " + formatNumber(finalized.systemShr || finalized.shr || 0, 3) + ".", "The load is " + ((finalized.systemShr || finalized.shr || 0) < 0.78 ? "latent-sensitive." : "mainly sensible.")] },
        { title: "Airside Strategy", bullets: ["Airflow driver: " + (diagnostics.selectedAirflowDriver || basis.airflowConstraint || "thermal") + ".", "CFM/TR status: " + (diagnostics.status || "NORMAL") + "."] },
        { title: "Psychrometric Assessment", bullets: ["Supply " + formatNumber(psychro.supplyTemp || 0, 1) + " C, ADP " + formatNumber(psychro.adpTemp || 0, 1) + " C, bypass factor " + formatNumber(psychro.bypassFactor || 0, 2) + "."] },
        { title: "Ventilation / ACH Compliance", bullets: ["Ventilation: " + (finalized.ventilationComplianceStatus || "COMPLIANT") + "; ACH: " + (finalized.achComplianceStatus || "ADVISORY") + ".", "Comfort mode rejects on OA shortfall, not advisory ACH shortfall."] },
        { title: "Equipment Selection", bullets: ["Selected AHU " + (finalDesign.equipment.selectedAhuModel || "not selected") + " at " + formatNumber(finalDesign.equipment.selectedAhuTR || 0, 1) + " TR.", "Reserve margin " + formatNumber(reservePercent, 1) + "%."] },
        { title: "Duct / ESP Review", bullets: ["ESP " + formatInt(finalDesign.esp.totalPa) + " Pa; duct friction " + formatNumber(esp.frictionRatePaM || finalDesign.esp.ductFrictionPaPerM || 0, 2) + " Pa/m.", esp.explanation || "Duct pressure diagnostics are available in the ESP section."] },
        { title: "Energy Performance", bullets: [finalEnergy.annual_energy_kwh ? "Annual energy " + formatInt(finalEnergy.annual_energy_kwh) + " kWh; " + formatInt(annualKwhPerTr) + " kWh/TR-year." : "Run annual simulation to complete energy performance."] },
        { title: "Cost / BOQ Summary", bullets: ["BOQ roll-up supplies cost/TR and cost/m2 after project costing is rendered."] },
        { title: "Recommended Design Actions", bullets: actions.length ? actions : ["No critical action was found; verify manufacturer data, controls, and commissioning basis before issue."] },
        { title: "Optimization Opportunities", bullets: (diagnostics.correctiveActions || []).slice(0, 2).concat(["Compare DOAS, colder supply, AHU split, and low-static duct variants where applicable."]).slice(0, 3) },
        { title: "Consultant Notes", bullets: ["Before IFC/procurement, verify controls sequence, filter pressure drops, manufacturer coil data, fan curve, and TAB/commissioning basis."] }
      ]
    };
  }

  function normalizeAdvisoryRegistry(advisor, result) {
    const source = advisor || { provider: "local_rules", summary: "", items: [] };
    const finalized = ensureFinalizedResult(result || {}, { promoteEnergySimulation: false });
    const finalDesign = finalized.finalDesign;
    const comfortMode = finalDesign.designBasis !== "cleanroom";
    const categoryMap = {
      airflow: "airflow_compliance",
      ventilation: "airflow_compliance",
      compliance: "airflow_compliance",
      pressure: "fan_esp",
      ductwork: "fan_esp",
      equipment: "fan_esp",
      energy: "energy",
      process_air: "airflow_compliance",
      latent_control: "psychrometrics",
      psychrometrics: "psychrometrics",
      costing: "costing",
      optimization: "optimization",
      cleanroom: "airflow_compliance",
      design: "optimization"
    };
    const seen = {};
    const items = (Array.isArray(source.items) ? source.items : []).map(function (item) {
      const clone = Object.assign({}, item);
      clone.category = categoryMap[clone.category] || clone.category || "optimization";
      clone.issueCode = clone.issueCode || clone.key || clone.title || clone.category;
      if (comfortMode) {
        ["title", "issue", "recommendation", "basis"].forEach(function (field) {
          clone[field] = String(clone[field] || "")
            .replace(/cleanroom compliance/gi, "ACH compliance")
            .replace(/cleanroom/gi, "comfort");
        });
      }
      return clone;
    }).filter(function (item) {
      const text = [item.title, item.issue, item.recommendation, item.basis].join(" ").toLowerCase();
      if (comfortMode && text.indexOf("cleanroom") !== -1) {
        return false;
      }
      if (finalDesign.airflow.ventilationCFM <= 0.5 && text.indexOf("significant parallel stream") !== -1) {
        return false;
      }
      if (Math.abs(finalDesign.airflow.coolingCFM - finalDesign.airflow.recirculationCFM) <= Math.max(finalDesign.airflow.coolingCFM * 0.03, 25) && text.indexOf("materially larger") !== -1) {
        return false;
      }
      const key = item.category + ":" + item.issueCode;
      if (seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
    const normalized = Object.assign({}, source, {
      summary: comfortMode ? String(source.summary || "").replace(/cleanroom compliance/gi, "ACH compliance").replace(/cleanroom/gi, "comfort") : source.summary,
      advisoryRegistry: items.reduce(function (registry, item) {
        registry[item.category] = registry[item.category] || {};
        registry[item.category][item.issueCode] = item;
        return registry;
      }, {}),
      items: items
    });
    normalized.assistant = buildAiDesignAssistant(result || {}, normalized);
    normalized.metrics = normalized.assistant.metrics;
    normalized.sections = normalized.assistant.sections;
    return normalized;
  }

  function buildDesignAdvisorPayload(result, room) {
    const finalized = ensureFinalizedResult(result || {}, { promoteEnergySimulation: false });
    const finalDesign = finalized.finalDesign;
    const selection = result && result.zoneAhuStrategy && result.zoneAhuStrategy.aggregateSelection
      ? result.zoneAhuStrategy.aggregateSelection
      : result && result.equipmentSelection ? result.equipmentSelection : {};
    const standardsContext = result && result.standardsContext ? result.standardsContext : {};

    return {
      calculationId: result && result.calculationId ? result.calculationId : "",
      room: {
        id: room && room.id ? room.id : "",
        name: room && room.name ? room.name : "Room",
        area_m2: roundTo(result && result.area ? result.area : 0, 2),
        volume_m3: roundTo(result && result.volume ? result.volume : 0, 2)
      },
      loads: {
        total_load_w: roundTo(result && result.totalLoad ? result.totalLoad : 0, 1),
        space_sensible_w: roundTo(result && result.spaceSensible ? result.spaceSensible : 0, 1),
        space_latent_w: roundTo(result && result.spaceLatent ? result.spaceLatent : 0, 1),
        cooling_cfm: roundTo(flows.coolingAirflowCfm || 0, 1),
        recirculation_cfm: roundTo(flows.recirculationAirflowCfm || 0, 1),
        ventilation_cfm: roundTo(flows.ventilationAirflowCfm || 0, 1),
        outdoor_air_cfm: roundTo(flows.totalOutdoorAirCfm || 0, 1),
        total_room_cfm: roundTo(flows.totalRoomAirflowCfm || 0, 1),
        infiltration_cfm: roundTo(result && result.infiltration_cfm ? result.infiltration_cfm : 0, 1),
        conditioned_cfm: roundTo(result && result.cfm_conditioned ? result.cfm_conditioned : 0, 1),
        process_cfm: roundTo(result && result.cfm_process_excess ? result.cfm_process_excess : 0, 1),
        tr_final: roundTo(result && result.tr_final ? result.tr_final : 0, 2),
        total_esp_pa: roundTo(result && result.total_esp ? result.total_esp : 0, 0)
      },
      psychrometrics: {
        room_shr_load: roundTo(result && result.roomShr ? result.roomShr : 0, 4),
        room_shr_psychro: roundTo(result && result.psychro && result.psychro.roomShrPsychro ? result.psychro.roomShrPsychro : 0, 4),
        shr_error: roundTo(result && result.psychro && result.psychro.shrError ? result.psychro.shrError : 0, 4),
        enthalpy_error_kjkg: roundTo(result && result.psychro && result.psychro.enthalpyBalanceErrorKJkg ? result.psychro.enthalpyBalanceErrorKJkg : 0, 4),
        supply_temp_c: roundTo(result && result.psychro && result.psychro.supplyTemp ? result.psychro.supplyTemp : 0, 2),
        adp_temp_c: roundTo(result && result.psychro && result.psychro.adpTemp ? result.psychro.adpTemp : 0, 2),
        bypass_factor: roundTo(result && result.psychro && result.psychro.bypassFactor ? result.psychro.bypassFactor : 0, 4)
      },
      standards: standardsContext,
      cleanroom: result && result.cleanroom ? result.cleanroom : null,
      validation: result && result.validation ? result.validation : {},
      airflows: result && result.airflows ? result.airflows : {},
      airflowBasis: result && result.airflowBasis ? result.airflowBasis : {},
      designConstraints: result && result.designConstraints ? result.designConstraints : {},
      energyOptimization: result && result.energyOptimization ? result.energyOptimization : {},
      systemRecommendation: result && result.systemRecommendation ? result.systemRecommendation : {},
      systems: result && result.systems ? result.systems : {},
      equipment: {
        ahu: selection && selection.ahu ? selection.ahu : {},
        fan: selection && selection.fan ? selection.fan : {}
      },
      localAdvisor: result && result.designAdvisor ? result.designAdvisor : null
    };
  }

  function buildDesignAlternativesPayload(result, room) {
    const flows = airflowBreakdown(result);
    const selection = result && result.zoneAhuStrategy && result.zoneAhuStrategy.aggregateSelection
      ? result.zoneAhuStrategy.aggregateSelection
      : result && result.equipmentSelection ? result.equipmentSelection : {};

    return {
      calculationId: result && result.calculationId ? result.calculationId : "",
      room: {
        id: room && room.id ? room.id : "",
        name: room && room.name ? room.name : "Room",
        area_m2: roundTo(result && result.area ? result.area : 0, 2),
        volume_m3: roundTo(result && result.volume ? result.volume : 0, 2)
      },
      designMode: normalizedDesignMode(result && result.inputs && result.inputs.design_mode),
      cleanroom: result && result.cleanroom ? result.cleanroom : null,
      loads: {
        total_load_w: roundTo(result && result.totalLoad ? result.totalLoad : 0, 1),
        tr_final: roundTo(finalDesign.loads.trFinal || 0, 2),
        cooling_cfm: roundTo(finalDesign.airflow.coolingCFM || 0, 1),
        recirculation_cfm: roundTo(finalDesign.airflow.recirculationCFM || 0, 1),
        conditioned_cfm: roundTo(finalDesign.airflow.recirculationCFM || 0, 1),
        ventilation_cfm: roundTo(finalDesign.airflow.ventilationCFM || 0, 1),
        outdoor_air_cfm: roundTo(finalDesign.airflow.outdoorAirThroughCoilCFM + finalDesign.airflow.dedicatedVentilationCFM || 0, 1),
        total_room_cfm: roundTo(finalDesign.airflow.totalRoomSupplyCFM || 0, 1),
        ach: roundTo(finalDesign.airflow.ach || 0, 1),
        total_esp_pa: roundTo(finalDesign.esp.totalPa || 0, 0)
      },
      psychrometrics: {
        room_shr_load: roundTo(result && result.roomShr ? result.roomShr : 0, 4),
        room_shr_psychro: roundTo(result && result.psychro && result.psychro.roomShrPsychro ? result.psychro.roomShrPsychro : 0, 4),
        shr_error: roundTo(result && result.psychro && result.psychro.shrError ? result.psychro.shrError : 0, 4),
        enthalpy_error_kjkg: roundTo(result && result.psychro && result.psychro.enthalpyBalanceErrorKJkg ? result.psychro.enthalpyBalanceErrorKJkg : 0, 4)
      },
      validation: result && result.validation ? result.validation : {},
      airflows: result && result.airflows ? result.airflows : {},
      airflowBasis: result && result.airflowBasis ? result.airflowBasis : {},
      systemRecommendation: result && result.systemRecommendation ? result.systemRecommendation : {},
      designConstraints: result && result.designConstraints ? result.designConstraints : {},
      energyOptimization: result && result.energyOptimization ? result.energyOptimization : {},
      systems: result && result.systems ? result.systems : {},
      equipment: {
        ahu: selection && selection.ahu ? selection.ahu : {},
        fan: selection && selection.fan ? selection.fan : {}
      },
      localAlternatives: result && result.designAlternatives ? result.designAlternatives : null
    };
  }

  function aggregateProjectEnergy() {
    const project = ProjectManager.getProject();
    if (!project || !project.rooms) {
      return null;
    }

    const reports = project.rooms.map(function (room) {
	      if (!room || !room.result) {
	        return null;
	      }
	      ensureFinalizedResult(room.result, { promoteEnergySimulation: false });
	      return finalEnergyReport(room.result)
	        ? { room: room, report: finalEnergyReport(room.result) }
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
      peak_kw_per_tr: safeDiv(summary.peakPower, summary.peakTR, 0),
      annual_kwh_per_tr_year: safeDiv(summary.annualEnergy, summary.peakTR, 0),
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
	    ensureFinalizedResult(result || {}, { promoteEnergySimulation: false });
	    const report = finalEnergyReport(result);
    const status = result && result.energySimulationStatus ? result.energySimulationStatus : (report ? "ready" : "idle");
    const energyOptimization = result && result.energyOptimization ? result.energyOptimization : null;
    const designAdvisor = result && result.designAdvisor ? result.designAdvisor : null;
    const designAdvisorStatus = result && result.designAdvisorStatus ? result.designAdvisorStatus : "ready";
    const designAdvisorMeta = result && result.designAdvisorMeta ? result.designAdvisorMeta : null;
    const designAdvisorError = result && result.designAdvisorError ? result.designAdvisorError : "";
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
	      warningList.innerHTML = designAdvisor && designAdvisor.items && designAdvisor.items.length
	        ? advisoryReferencesMarkup(advisorItemsForSection(designAdvisor, ["energy", "fan_esp"], 4))
          : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No active warnings.</p>';
      }
      if (inputSummary) {
        inputSummary.innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Energy inputs are built automatically from the active cooling, recirculation, and ventilation-air calculations.</p>';
      }
      if (comparisonBox) {
        comparisonBox.textContent = designAdvisor && designAdvisor.summary
          ? designAdvisor.summary
          : energyOptimization && energyOptimization.summary
          ? energyOptimization.summary
          : "Future-ready hook: compare decoupled process-air strategies or alternate fan/COP packages via the same API.";
        if (designAdvisor) {
          comparisonBox.textContent += " " + designAdvisorStatusLabel(designAdvisorStatus, designAdvisor.provider, designAdvisorError);
          if (designAdvisorTimestamp(designAdvisorMeta)) {
            comparisonBox.textContent += " Updated " + designAdvisorTimestamp(designAdvisorMeta) + ".";
          }
        }
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
	      const finalDesign = result.finalDesign;
	      inputSummary.innerHTML =
	        '<table class="calc-table"><tbody>'
	        + '<tr><td>Peak cooling load</td><td class="num">' + formatNumber(systemInput.peak_load_kw || 0, 1) + ' kW</td></tr>'
	        + '<tr><td>Cooling airflow</td><td class="num">' + formatInt(finalDesign.airflow.coolingCFM || 0) + ' CFM</td></tr>'
	        + '<tr><td>Recirculation airflow</td><td class="num">' + formatInt(finalDesign.airflow.recirculationCFM || 0) + ' CFM</td></tr>'
	        + '<tr><td>Ventilation / make-up airflow</td><td class="num">' + formatInt(finalDesign.airflow.ventilationCFM || 0) + ' CFM</td></tr>'
	        + '<tr><td>Cooling fan design</td><td class="num">' + formatNumber(finalDesign.fans.coolingFanKW || 0, 2) + ' kW</td></tr>'
	        + '<tr><td>Recirculation fan design</td><td class="num">' + formatNumber(finalDesign.fans.recirculationFanKW || 0, 2) + ' kW</td></tr>'
	        + '<tr><td>Total fan power basis</td><td class="num">' + formatNumber(finalDesign.fans.totalFanKW || 0, 2) + ' kW</td></tr>'
        + '<tr><td>Ventilation fan static</td><td class="num">' + formatNumber(systemInput.process_fan_static_pa || 0, 0) + ' Pa</td></tr>'
        + '<tr><td>Recirculation AHU deployment</td><td class="num">' + escapeHtml(zoneAhuStrategy && zoneAhuStrategy.modeLabel ? zoneAhuStrategy.modeLabel : "Single AHU") + '</td></tr>'
        + '<tr><td>Tariff</td><td class="num">₹' + formatNumber(systemInput.tariff_per_kwh || 0, 2) + '/kWh</td></tr>'
        + "</tbody></table>";
    }

    if (summaryTable) {
      summaryTable.innerHTML =
        '<table class="calc-table"><tbody>'
        + '<tr><td>Total annual energy</td><td class="num">' + formatInt(report.annual_energy_kwh) + ' kWh</td></tr>'
        + '<tr><td>Cooling energy</td><td class="num">' + formatInt(report.cooling_energy) + ' kWh</td></tr>'
        + '<tr><td>Recirculation fan energy</td><td class="num">' + formatInt(report.fan_energy) + ' kWh</td></tr>'
        + '<tr><td>Ventilation / make-up fan energy</td><td class="num">' + formatInt(report.process_energy) + ' kWh</td></tr>'
        + '<tr><td>Peak electric power</td><td class="num">' + formatNumber(report.peak_power_kw || 0, 2) + ' kW</td></tr>'
        + '<tr><td>Peak electric index</td><td class="num">' + formatNumber(report.peak_kw_per_tr || report.system_efficiency || 0, 2) + ' kW/TR</td></tr>'
        + '<tr><td>Annual energy intensity</td><td class="num">' + formatInt(report.annual_kwh_per_tr_year || safeDiv(report.annual_energy_kwh, report.peak_tr, 0)) + ' kWh/TR-year</td></tr>'
        + '<tr><td>Ventilation / recirculation airflow</td><td class="num">' + formatNumber(report.process_to_conditioned_air_ratio || 0, 2) + ' x</td></tr>'
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
          + '<tr><td>Project peak electric index</td><td class="num">' + formatNumber(projectSummary.peak_kw_per_tr || projectSummary.system_efficiency || 0, 2) + ' kW/TR</td></tr>'
          + '<tr><td>Project annual energy intensity</td><td class="num">' + formatInt(projectSummary.annual_kwh_per_tr_year || 0) + ' kWh/TR-year</td></tr>'
          + '<tr><td colspan="2" style="color:var(--text3);font-size:11px;">' + escapeHtml(projectSummary.note) + "</td></tr>"
          + "</tbody></table>"
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Project roll-up will appear after more rooms are simulated.</p>';
    }

    if (warningList) {
      const majorWarnings = []
        .concat(report.warnings || [])
        .concat(energyOptimization && energyOptimization.warningMessages ? energyOptimization.warningMessages : []);
      const advisoryNotes = energyOptimization && energyOptimization.advisories ? energyOptimization.advisories : [];
	      warningList.innerHTML = designAdvisor && designAdvisor.items && designAdvisor.items.length
	        ? advisoryReferencesMarkup(advisorItemsForSection(designAdvisor, ["energy", "fan_esp"], 4))
        : majorWarnings.length
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
      comparisonBox.textContent = designAdvisor && designAdvisor.summary
        ? designAdvisor.summary
        : energyOptimization && energyOptimization.summary
        ? energyOptimization.summary
        : "Next comparison step: duplicate the room, revise process-air schedule or fan static, then compare the two saved room options through the same simulation endpoint.";
      if (designAdvisor) {
        comparisonBox.textContent += " " + designAdvisorStatusLabel(designAdvisorStatus, designAdvisor.provider, designAdvisorError);
        if (designAdvisorTimestamp(designAdvisorMeta)) {
          comparisonBox.textContent += " Updated " + designAdvisorTimestamp(designAdvisorMeta) + ".";
        }
      }
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
        note.textContent = "Drag to rotate. Use wheel or trackpad scroll to zoom. Double-click to reset the camera. Use Outside View for an uncluttered duct overview and Inside View to turn the ceiling on and look into the room.";
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
      note.textContent = "Drag to rotate. Use wheel or trackpad scroll to zoom. Double-click to reset the camera. Outside View hides the ceiling for clearer duct layouts; Inside View turns the ceiling on and places the camera within the room. Blue particles show the recirculation / supply stream; warm red particles show return air.";
    }

    summary.innerHTML =
      '<table class="calc-table"><tbody>'
      + '<tr><td>Room envelope</td><td class="num">' + formatNumber(len, 2) + " x " + formatNumber(wid, 2) + " x " + formatNumber(ht, 2) + "</td><td>m</td><td>Exact active-room dimensions from the calculation input</td></tr>"
      + '<tr><td>Window schedule</td><td class="num">' + (((result.envelope && result.envelope.windows && result.envelope.windows.length) || 0)) + "</td><td>nos.</td><td>" + escapeHtml(result.envelope ? summarizeOrientationAreas(result.envelope.windowAreaByOrientation, "m²") : "No windows") + "</td></tr>"
      + '<tr><td>Ceiling / floor</td><td class="num">' + formatNumber((result.envelope && result.envelope.ceilingArea) || (len * wid), 2) + " / " + formatNumber((result.envelope && result.envelope.floorArea) || (len * wid), 2) + "</td><td>m²</td><td>Envelope surfaces shown in the visual room shell</td></tr>"
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
      + '<tr class="total-row"><td><b>Visualization basis</b></td><td class="num"><b>' + formatInt(result.cfm_conditioned || 0) + " CFM</b></td><td><b>recirculation air</b></td><td>Exact room size, deployed AHUs, and displayed duct sections follow the result data. Routing and motion are illustrative only.</td></tr>"
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
    if (!result || !platform.projectManagerReady || !window.ServerApi || !isAuthenticated()) {
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
	      ensureFinalizedResult(merged, { promoteEnergySimulation: false });
	      merged.finalEnergyResult = normalizeEnergyReportForFinalDesign(response.report, merged);
	      ensureFinalizedResult(merged, { promoteEnergySimulation: false, throwOnFailure: true });
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

  async function refreshDesignOptimization(result) {
    if (!result || !platform.projectManagerReady || !window.ServerApi || !isAuthenticated()) {
      return;
    }

    const optimizer = optimizationEngineApi();
    if (!(optimizer && typeof optimizer.runOptimizationLoop === "function")) {
      return;
    }

    const room = ProjectManager.getActiveRoom();
    if (!room || !room.id || !result.calculationId) {
      return;
    }

    const roomId = room.id;
    const calculationId = result.calculationId;
    const requestSerial = ++platform.designOptimizationRequestSerial;

    try {
      const available = await window.ServerApi.isAvailable();
      if (!available) {
        throw new Error("Optimization simulation requires the Node + Python backend server.");
      }
      if (window.ServerApi.hasCapability && !(await window.ServerApi.hasCapability("energySimulation"))) {
        throw new Error("Optimization simulation requires the energy simulation backend route.");
      }

      const preflightRoom = ProjectManager.getRoomById(roomId);
      if (preflightRoom && preflightRoom.result && preflightRoom.result.calculationId === calculationId) {
        const loadingSnapshot = copyJson(preflightRoom.result);
        loadingSnapshot.designOptimizationStatus = "loading";
        loadingSnapshot.designOptimizationError = "";
        loadingSnapshot.designOptimizationMeta = {
          provider: "local_optimization",
          generatedAt: new Date().toISOString(),
          requestSerial: requestSerial
        };
        loadingSnapshot.designAlternativesStatus = "loading";
        loadingSnapshot.designAlternativesError = "";
        ProjectManager.updateRoomResult(roomId, loadingSnapshot);
        if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
          window._lastCalcResult = copyJson(loadingSnapshot);
          renderAll(window._lastCalcResult);
        }
      }

      const workingRoom = ProjectManager.getRoomById(roomId);
      if (!workingRoom || !workingRoom.result || workingRoom.result.calculationId !== calculationId) {
        return;
      }

      const roomContext = buildOptimizationRoomContext(workingRoom.result, room);
      const report = await optimizer.runOptimizationLoop({
        baseInputs: copyJson(workingRoom.inputs || workingRoom.result.inputs || result.inputs || {}),
        baseResult: copyJson(workingRoom.result),
        roomContext: roomContext,
        reasoning: workingRoom.result.designAdvisor ? copyJson(workingRoom.result.designAdvisor) : null,
        callbacks: {
          calculateRoom: function (simulatedInputs, runtimeOptions) {
            return calculateRoom(copyJson(simulatedInputs), runtimeOptions);
          },
          simulateEnergy: function (simulatedResult, simulationRoomContext) {
            return simulateEnergyReportForResult(simulatedResult, simulationRoomContext || roomContext);
          }
        }
      });
      if (!(report && Array.isArray(report.scenarioResults) && report.scenarioResults.length)) {
        throw new Error("Missing simulation data for optimization scenarios.");
      }
      if (window.console && typeof window.console.debug === "function") {
        window.console.debug("[Optimization] Scenario inputs", report.scenarioList || []);
        window.console.debug("[Optimization] Scenario outputs", report.scenarioResults || report.simulationResults || []);
        window.console.debug("[Optimization] Final report payload", report);
      }

      const currentRoom = ProjectManager.getRoomById(roomId);
      if (!currentRoom || !currentRoom.result || currentRoom.result.calculationId !== calculationId) {
        return;
      }

      const merged = copyJson(currentRoom.result);
      merged.designOptimization = report;
      merged.designOptimizationStatus = "ready";
      merged.designOptimizationError = "";
      merged.designOptimizationMeta = {
        provider: report && report.provider ? report.provider : "local_optimization",
        generatedAt: new Date().toISOString(),
        requestSerial: requestSerial
      };
      if (report && report.alternativesView) {
        merged.designAlternatives = report.alternativesView;
        merged.designAlternativesStatus = "ready";
        merged.designAlternativesError = "";
        merged.designAlternativesMeta = {
          provider: report.alternativesView.provider || report.provider || "local_optimization",
          generatedAt: new Date().toISOString(),
          requestSerial: requestSerial
        };
      }
	      if (report && report.baseEnergySimulation) {
	        ensureFinalizedResult(merged, { promoteEnergySimulation: false });
	        merged.finalEnergyResult = normalizeEnergyReportForFinalDesign(report.baseEnergySimulation, merged);
	        ensureFinalizedResult(merged, { promoteEnergySimulation: false, throwOnFailure: true });
        merged.energySimulationStatus = "ready";
        merged.energySimulationError = "";
        merged.energySimulationMeta = {
          generatedAt: new Date().toISOString(),
          requestSerial: requestSerial
        };
      }
      ProjectManager.updateRoomResult(roomId, merged);

      if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
        window._lastCalcResult = copyJson(merged);
        renderAll(window._lastCalcResult);
      }
    } catch (error) {
      const currentRoom = ProjectManager.getRoomById(roomId);
      if (currentRoom && currentRoom.result && currentRoom.result.calculationId === calculationId) {
        const merged = copyJson(currentRoom.result);
        merged.designOptimizationStatus = "error";
        merged.designOptimizationError = error && error.message ? error.message : "Optimization simulation failed.";
        merged.designOptimizationMeta = {
          provider: "local_optimization",
          generatedAt: new Date().toISOString(),
          requestSerial: requestSerial
        };
        merged.designAlternativesStatus = "error";
        merged.designAlternativesError = merged.designOptimizationError;
        ProjectManager.updateRoomResult(roomId, merged);
        if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
          window._lastCalcResult = copyJson(merged);
          renderAll(window._lastCalcResult);
        }
      }
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("design optimization enhancement skipped:", error);
      }
    }
  }

  async function refreshDesignAlternatives(result) {
    if (!result || !platform.projectManagerReady || !window.ServerApi || !isAuthenticated()) {
      return;
    }
    if (result.designAlternatives && result.designAlternatives.provider === "local_optimization") {
      return;
    }

    const room = ProjectManager.getActiveRoom();
    if (!room || !room.id || !result.calculationId) {
      return;
    }

    const roomId = room.id;
    const calculationId = result.calculationId;
    const requestSerial = ++platform.designAlternativesRequestSerial;

    try {
      const available = await window.ServerApi.isAvailable();
      if (!available) {
        return;
      }
      if (window.ServerApi.hasCapability && !(await window.ServerApi.hasCapability("aiDesignAlternatives"))) {
        return;
      }

      const preflightRoom = ProjectManager.getRoomById(roomId);
      if (preflightRoom && preflightRoom.result && preflightRoom.result.calculationId === calculationId) {
        const loadingSnapshot = copyJson(preflightRoom.result);
        loadingSnapshot.designAlternativesStatus = "loading";
        loadingSnapshot.designAlternativesError = "";
        ProjectManager.updateRoomResult(roomId, loadingSnapshot);
        if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
          window._lastCalcResult = copyJson(loadingSnapshot);
          renderAll(window._lastCalcResult);
        }
      }

      const response = await window.ServerApi.generateDesignAlternatives(buildDesignAlternativesPayload(result, room));
      if (!(response && response.ok && response.alternatives)) {
        throw new Error(response && response.error ? response.error : "AI design alternatives request failed.");
      }

      const currentRoom = ProjectManager.getRoomById(roomId);
      if (!currentRoom || !currentRoom.result || currentRoom.result.calculationId !== calculationId) {
        return;
      }

      const merged = copyJson(currentRoom.result);
      merged.designAlternatives = response.alternatives;
      merged.designAlternativesStatus = "ready";
      merged.designAlternativesError = "";
      merged.designAlternativesMeta = {
        provider: response.provider || (response.alternatives && response.alternatives.provider) || "openai",
        generatedAt: response.generatedAt || new Date().toISOString(),
        requestSerial: requestSerial
      };
      ProjectManager.updateRoomResult(roomId, merged);

      if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
        window._lastCalcResult = copyJson(merged);
        renderAll(window._lastCalcResult);
      }
    } catch (error) {
      const currentRoom = ProjectManager.getRoomById(roomId);
      if (currentRoom && currentRoom.result && currentRoom.result.calculationId === calculationId) {
        const merged = copyJson(currentRoom.result);
        merged.designAlternativesStatus = "error";
        merged.designAlternativesError = error && error.message ? error.message : "AI design alternatives request failed.";
        ProjectManager.updateRoomResult(roomId, merged);

        if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
          window._lastCalcResult = copyJson(merged);
          renderAll(window._lastCalcResult);
        }
      }
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("design alternatives enhancement skipped:", error);
      }
    }
  }

  async function refreshDesignAdvisor(result) {
    if (!result || !platform.projectManagerReady || !window.ServerApi || !isAuthenticated()) {
      return;
    }

    const room = ProjectManager.getActiveRoom();
    if (!room || !room.id || !result.calculationId) {
      return;
    }

    const roomId = room.id;
    const calculationId = result.calculationId;
    const requestSerial = ++platform.designAdvisorRequestSerial;

    try {
      const available = await window.ServerApi.isAvailable();
      if (!available) {
        return;
      }
      if (window.ServerApi.hasCapability && !(await window.ServerApi.hasCapability("aiDesignAdvisor"))) {
        return;
      }

      const preflightRoom = ProjectManager.getRoomById(roomId);
      if (preflightRoom && preflightRoom.result && preflightRoom.result.calculationId === calculationId) {
        const loadingSnapshot = copyJson(preflightRoom.result);
        loadingSnapshot.designAdvisorStatus = "loading";
        loadingSnapshot.designAdvisorError = "";
        ProjectManager.updateRoomResult(roomId, loadingSnapshot);
        if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
          window._lastCalcResult = copyJson(loadingSnapshot);
          renderAll(window._lastCalcResult);
        }
      }

      const response = await window.ServerApi.generateDesignAdvisor(buildDesignAdvisorPayload(result, room));
      if (!(response && response.ok && response.advisor)) {
        throw new Error(response && response.error ? response.error : "Design advisor enhancement failed.");
      }

      const currentRoom = ProjectManager.getRoomById(roomId);
      if (!currentRoom || !currentRoom.result || currentRoom.result.calculationId !== calculationId) {
        return;
      }

      const merged = copyJson(currentRoom.result);
	      merged.finalDesign = merged.finalDesign || buildFinalDesign(merged);
	      merged.designAdvisor = normalizeAdvisoryRegistry(response.advisor, merged);
      merged.designAdvisorStatus = "ready";
      merged.designAdvisorError = "";
      merged.designAdvisorMeta = {
        provider: response.provider || (response.advisor && response.advisor.provider) || "openai",
        generatedAt: response.generatedAt || new Date().toISOString(),
        requestSerial: requestSerial
      };
      ProjectManager.updateRoomResult(roomId, merged);

      if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
        window._lastCalcResult = copyJson(merged);
        renderAll(window._lastCalcResult);
      }
    } catch (error) {
      const currentRoom = ProjectManager.getRoomById(roomId);
      if (currentRoom && currentRoom.result && currentRoom.result.calculationId === calculationId) {
        const merged = copyJson(currentRoom.result);
        merged.designAdvisorStatus = "error";
        merged.designAdvisorError = error && error.message ? error.message : "AI design advisor request failed.";
        ProjectManager.updateRoomResult(roomId, merged);

        if (ProjectManager.getProject() && ProjectManager.getProject().activeRoomId === roomId) {
          window._lastCalcResult = copyJson(merged);
          renderAll(window._lastCalcResult);
        }
      }
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("design advisor enhancement skipped:", error);
      }
    }
  }

  function buildProjectRoomSummaryTable() {
    return '<table class="calc-table"><thead><tr><th>ROOM</th><th>AREA (m²)</th><th>RSH (W)</th><th>RLH (W)</th><th>RTH (W)</th><th>W/m²</th><th>TR_design</th><th>TR_final</th><th>CFM_final</th><th>System SHR</th></tr></thead><tbody>' + innerHtml("project-room-tbody") + "</tbody></table>";
  }

  function renderReport(result, groups) {
    ensureFinalizedResult(result || {}, { promoteEnergySimulation: false, throwOnFailure: true });
    renderAiAlternatives(result);
    if (typeof renderSchematic3D === "function") {
      renderSchematic3D(result);
    }
    const project = ProjectManager.getProject();
    const totalRooms = project && project.rooms ? project.rooms.length : 1;
    const activeRoom = ProjectManager.getActiveRoom();
    const boqTable = outerHtml("boq-table");
    const roomTable = buildProjectRoomSummaryTable();
    const solarFigure = clonedSvgMarkup("solar-chart", "0 0 800 260", 260);
    const psychroFigure = clonedSvgMarkup("psychro-chart-svg", "0 0 860 420", 420);
    const energyFigure = clonedSvgMarkup("energy-chart-svg", "0 0 860 320", 320);
    const energyReady = !!(result && result.finalEnergyResult && result.energySimulationStatus === "ready");
    const reportDate = new Date();
    const reportYear = reportDate.getFullYear();
    const footerLine = reportYear + " | Ankit Biswas Sharma | Musk-IT | All Rights Reserved.";

    byId("report-content").innerHTML =
      reportBlock("PROJECT HEADER",
        buildReportCoverMarkup(result, project, activeRoom, totalRooms, reportDate, energyReady),
        "report-cover"
      )
      + reportBlock("01 · INPUT",
        '<div class="report-grid-2">'
        + '<div><div class="report-subtitle">Room Geometry & Envelope</div><div class="report-kv">'
        + "<dt>Length</dt><dd>" + result.inputs.len + " m</dd>"
        + "<dt>Width</dt><dd>" + result.inputs.wid + " m</dd>"
        + "<dt>Height</dt><dd>" + result.inputs.ht + " m</dd>"
        + "<dt>Window count</dt><dd>" + ((result.envelope && result.envelope.windows && result.envelope.windows.length) || 0) + "</dd>"
        + "<dt>Total window area</dt><dd>" + formatNumber((result.envelope && result.envelope.windowAreaTotal) || parseFloat(result.inputs.win_area) || 0, 2) + " m²</dd>"
        + "<dt>Window schedule</dt><dd>" + escapeHtml(result.envelope ? summarizeOrientationAreas(result.envelope.windowAreaByOrientation, "m²") : result.inputs.win_orient) + "</dd>"
        + "<dt>External walls</dt><dd>" + ((result.envelope && result.envelope.walls && result.envelope.walls.length) || parseInt(result.inputs.wall_exp, 10) || 0) + "</dd>"
        + "<dt>Wall schedule</dt><dd>" + escapeHtml(result.envelope ? summarizeOrientationAreas(result.envelope.wallGrossAreaByOrientation, "m²") : (result.inputs.wall_exp + " exposed wall(s)")) + "</dd>"
        + "<dt>Ceiling area</dt><dd>" + formatNumber((result.envelope && result.envelope.ceilingArea) || result.area || 0, 2) + " m²</dd>"
        + "<dt>Floor area</dt><dd>" + formatNumber((result.envelope && result.envelope.floorArea) || result.area || 0, 2) + " m²</dd>"
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
        + "<dt>Compliance mode</dt><dd>" + escapeHtml(result.complianceMode || result.finalDesign && result.finalDesign.complianceMode || "comfort_ventilation") + "</dd>"
        + "<dt>ACH requirement</dt><dd>" + escapeHtml(result.achRequirementMode || result.finalDesign && result.finalDesign.achRequirementMode || "advisory") + "</dd>"
        + "</div></div>"
        + "</div>"
      )
      + reportBlock("02 · COOLING LOAD",
        outerHtml("cooling-metrics")
        + '<div class="report-inline-note">Cooling load section prints the full room sensible/latent breakdown with incident solar converted through SHGC/SC and CLF into effective window cooling load.</div>'
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
      + reportBlock("10A · DESIGN VALIDATION",
        buildValidationReportMarkup(result)
      )
      + reportBlock("11 · SOLAR / GLASS COOLING LOAD",
        firstResultsGridMarkup("p-solar")
        + solarFigure
        + '<div class="report-subtitle">Hourly Effective Solar Load Summary</div>' + innerHtml("solar-table")
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
      + reportBlock("16 · AI DESIGN STUDIO",
        buildAiReportMarkup(result),
        "report-page-break"
      )
      + reportBlock("16A · ASHRAE ENGINE — FULL SIZED DESIGN",
        buildAshraeDesignReportMarkup(),
        "report-page-break"
      )
      + reportBlock("17 · 3D SCHEMATIC SUMMARY",
        firstResultsGridMarkup("p-schematic3d")
        + '<div class="report-grid-2">'
        + '<div><div class="report-subtitle">Schematic Basis</div>' + innerHtml("schematic3d-summary") + '</div>'
        + '<div><div class="report-subtitle">AHU / Zone Schedule</div>' + innerHtml("schematic3d-schedule") + '</div>'
        + '</div>'
        + '<div class="report-inline-note">' + escapeHtml(byId("schematic3d-disclaimer") ? byId("schematic3d-disclaimer").textContent : "3D schematic is a coordination visual and not a fabrication drawing.") + '</div>'
      )
      + '<div class="report-disclaimer">This PDF package is intended to capture the full design workflow from room input through costing, including psychrometric and diffuser layout visuals. Final procurement and IFC issue should still be checked against project-specific manufacturer data and site coordination constraints.</div>'
      + '<div class="report-footer">' + footerLine + "</div>";
  }

  function printableReportDocument(reportHtml) {
    const styleMarkup = Array.prototype.slice.call(document.querySelectorAll("style")).map(function (style) {
      return style.outerHTML;
    }).join("\n");
    // ----------------------------------------------------------------
    // PDF / print stylesheet — applied AFTER the existing styles so it
    // overrides them. Goal: an engineering-report look with branded
    // header on every page, KPI tiles, section ribbons, zebra tables,
    // and footer page numbers. We do NOT modify the live UI panel.
    // ----------------------------------------------------------------
    const pdfStyle = ''
      + '@page {'
      +   'size: A4;'
      +   'margin: 18mm 14mm 22mm 14mm;'
      +   '@top-left {'
      +     'content: "Musk-IT  ·  HVAC Design Calculation Report";'
      +     'font-family: \"Inter\", \"Segoe UI\", Arial, sans-serif;'
      +     'font-size: 9pt; color: #475569; letter-spacing: .04em;'
      +   '}'
      +   '@top-right {'
      +     'content: "hvac.muskit.in"; font-family: \"Inter\", Arial, sans-serif;'
      +     'font-size: 9pt; color: #475569;'
      +   '}'
      +   '@bottom-left {'
      +     'content: "Generated " counter(page) " · Confidential — for project use only";'
      +     'font-family: \"Inter\", Arial, sans-serif; font-size: 8.5pt; color: #64748b;'
      +   '}'
      +   '@bottom-right {'
      +     'content: "Page " counter(page) " of " counter(pages);'
      +     'font-family: \"Inter\", Arial, sans-serif; font-size: 8.5pt; color: #64748b;'
      +   '}'
      + '}'
      + 'html, body {'
      +   'background: #ffffff !important;'
      +   '-webkit-print-color-adjust: exact;'
      +   'print-color-adjust: exact;'
      +   'color: #0f172a;'
      +   'font-family: \"Inter\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif;'
      +   'font-size: 10.5pt;'
      +   'line-height: 1.55;'
      + '}'
      + '.shell, .main { display: block !important; overflow: visible !important; padding: 0 !important; }'
      + '#p-report { display: block !important; padding: 0 !important; background: #fff !important; }'
      + '#report-content { max-width: none !important; padding: 0 !important; }'
      + '.btn-row, .section-note, .btn { display: none !important; }'

      // ---- Cover ----
      // Keep the existing 2-column grid in the markup; we only restyle the
      // background and typography. The earlier override forced flex-column
      // and squashed the grid, producing the messy split-text cover.
      + '.report-cover-shell {'
      +   'page-break-after: always;'
      +   'background: linear-gradient(135deg, #0b1e3a 0%, #173a73 55%, #1e40af 100%) !important;'
      +   'color: #f8fafc !important;'
      +   'border-radius: 0 !important;'
      +   'min-height: 0;'
      +   'overflow: hidden;'
      + '}'
      + '.report-cover-shell::before { display: none !important; }'
      + '.report-cover-top {'
      +   'display: grid !important;'
      +   'grid-template-columns: 1.15fr 0.85fr !important;'
      +   'gap: 0 !important;'
      + '}'
      + '.report-cover-title-zone {'
      +   'padding: 34px 38px !important; color: #f8fafc !important;'
      + '}'
      + '.report-cover-eyebrow {'
      +   'font-family: \"JetBrains Mono\", \"Consolas\", monospace;'
      +   'font-size: 8.5pt; letter-spacing: .20em; text-transform: uppercase;'
      +   'color: #93c5fd !important; margin-bottom: 14px;'
      +   'white-space: normal;'
      + '}'
      + '.report-cover-title {'
      +   'font-size: 32pt; font-weight: 800; line-height: 1.08; letter-spacing: -0.02em;'
      +   'color: #ffffff !important; margin: 0 0 14px 0;'
      + '}'
      + '.report-cover-subtitle {'
      +   'color: #cfe0f8 !important; font-size: 10.5pt; line-height: 1.55;'
      +   'max-width: 100%;'
      + '}'
      + '.report-chip {'
      +   'display: inline-block; padding: 5px 12px; border-radius: 999px;'
      +   'background: rgba(255,255,255,.12) !important;'
      +   'color: #ffffff !important;'
      +   'font-family: \"JetBrains Mono\", monospace; font-size: 7.5pt;'
      +   'letter-spacing: .14em; text-transform: uppercase;'
      +   'border: 1px solid rgba(255,255,255,.25);'
      + '}'
      + '.report-cover-brand,'
      + '.report-cover-brand-card {'
      +   'background: rgba(255,255,255,0.06) !important;'
      +   'border-left: 1px solid rgba(255,255,255,0.10) !important;'
      +   'border-radius: 0 !important;'
      +   'padding: 34px 30px !important;'
      +   'color: #f8fafc !important;'
      + '}'
      + '.report-brand-word { color: #ffffff !important; font-size: 26pt; font-weight: 800; letter-spacing: -0.01em; }'
      + '.report-brand-main { color: #ffffff !important; }'
      + '.report-brand-accent { color: #60a5fa !important; }'
      + '.report-brand-tag { color: #cbd5f5 !important; font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; margin-top: 6px; }'

      // ---- Section blocks ----
      // page-break-inside: avoid keeps short sections together, but for long
      // sections the browser still breaks naturally between rows because of
      // the tr-level avoid above.
      + '.report-block {'
      +   'background: #ffffff !important;'
      +   'box-shadow: none !important;'
      +   'border: none !important;'
      +   'border-radius: 0 !important;'
      +   'padding: 6px 0 !important;'
      +   'margin: 0 0 14px 0 !important;'
      +   'page-break-inside: auto !important;'
      + '}'
      + '.report-block.report-page-break { page-break-before: always; }'
      + '.report-section-head {'
      +   'display: flex; align-items: flex-end; gap: 16px;'
      +   'border-bottom: 2px solid #0f172a !important;'
      +   'padding: 0 0 10px 0; margin: 0 0 14px 0;'
      + '}'
      + '.report-section-label {'
      +   'display: inline-block; font-family: \"JetBrains Mono\", \"Consolas\", monospace;'
      +   'font-size: 8.5pt !important; letter-spacing: .22em !important; text-transform: uppercase !important;'
      +   'color: #ffffff !important; background: #0f172a !important;'
      +   'padding: 4px 10px; border-radius: 3px; line-height: 1;'
      + '}'
      + '.report-block h4 {'
      +   'font-size: 15.5pt !important; font-weight: 700 !important; color: #0f172a !important;'
      +   'margin: 8px 0 0 0 !important; letter-spacing: -0.01em;'
      +   'background: transparent !important; padding: 0 !important;'
      + '}'
      + '.report-section-body { color: #1f2937 !important; font-size: 10.5pt; }'

      // ---- Summary grid / KPI tiles ----
      + '.report-summary-grid {'
      +   'display: grid !important;'
      +   'grid-template-columns: repeat(4, minmax(0, 1fr)) !important;'
      +   'gap: 8px !important;'
      +   'margin-top: 10px !important;'
      + '}'
      + '.report-summary-card {'
      +   'background: #f8fafc !important;'
      +   'border: 1px solid #e2e8f0 !important;'
      +   'border-left: 4px solid #1d4ed8 !important;'
      +   'border-radius: 6px !important;'
      +   'padding: 10px 12px !important;'
      +   'box-shadow: none !important;'
      + '}'
      + '.report-summary-card:nth-child(2) { border-left-color: #16a34a !important; }'
      + '.report-summary-card:nth-child(3) { border-left-color: #ea580c !important; }'
      + '.report-summary-card:nth-child(4) { border-left-color: #9333ea !important; }'
      + '.report-summary-card:nth-child(5) { border-left-color: #0891b2 !important; }'
      + '.report-summary-card:nth-child(6) { border-left-color: #db2777 !important; }'
      + '.report-summary-card:nth-child(7) { border-left-color: #ca8a04 !important; }'
      + '.report-summary-card:nth-child(8) { border-left-color: #475569 !important; }'
      + '.report-summary-label {'
      +   'font-family: \"JetBrains Mono\", monospace !important;'
      +   'font-size: 7.5pt !important; letter-spacing: .12em; text-transform: uppercase;'
      +   'color: #475569 !important; margin: 0 0 4px 0 !important;'
      + '}'
      + '.report-summary-value {'
      +   'font-size: 16pt !important; font-weight: 700 !important;'
      +   'color: #0f172a !important; letter-spacing: -0.01em;'
      +   'margin: 0 !important; line-height: 1.15 !important;'
      + '}'
      + '.report-summary-meta {'
      +   'font-family: \"JetBrains Mono\", monospace !important;'
      +   'font-size: 8.5pt !important; color: #64748b !important;'
      +   'margin-top: 3px !important;'
      + '}'

      // ---- Tables ----
      + '#report-content table {'
      +   'border-collapse: collapse !important; width: 100% !important;'
      +   'font-size: 9pt !important; margin: 6px 0 !important;'
      +   'background: #ffffff !important;'
      +   'table-layout: auto !important;'
      +   'page-break-inside: auto !important;'
      + '}'
      + '#report-content tr { page-break-inside: avoid !important; }'
      + '#report-content th {'
      +   'background: #0f172a !important; color: #ffffff !important;'
      +   'text-align: left; padding: 6px 8px !important;'
      +   'font-weight: 600 !important; font-size: 8.5pt !important;'
      +   'letter-spacing: .04em; text-transform: uppercase;'
      +   'border-bottom: none !important;'
      + '}'
      + '#report-content td {'
      +   'padding: 5px 8px !important;'
      +   'border-bottom: 1px solid #e2e8f0 !important;'
      +   'vertical-align: top;'
      +   'word-break: break-word;'
      + '}'
      + '#report-content td.num { text-align: right; font-family: \"JetBrains Mono\", monospace; }'
      + '#report-content tbody tr:nth-child(even) td { background: #f8fafc !important; }'
      + '#report-content tbody tr:last-child td { border-bottom: 1px solid #cbd5e1 !important; }'

      // ---- KV definition lists ----
      + '.report-kv {'
      +   'display: grid; grid-template-columns: max-content 1fr; column-gap: 12px; row-gap: 4px;'
      +   'font-size: 10pt;'
      + '}'
      + '.report-kv dt { color: #64748b !important; font-weight: 500; letter-spacing: .02em; }'
      + '.report-kv dd { color: #0f172a !important; font-weight: 600; margin: 0; font-family: \"JetBrains Mono\", monospace; }'

      // ---- Index ----
      + '.report-index {'
      +   'display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 18px;'
      +   'margin-top: 10px;'
      + '}'
      + '.report-index-item {'
      +   'display: flex; align-items: center; gap: 10px;'
      +   'padding: 6px 10px;'
      +   'background: #f8fafc !important; border: 1px solid #e2e8f0 !important;'
      +   'border-radius: 4px;'
      +   'font-size: 9.5pt; color: #0f172a !important;'
      + '}'
      + '.report-index-num {'
      +   'font-family: \"JetBrains Mono\", monospace !important;'
      +   'background: #1e40af !important; color: #fff !important;'
      +   'padding: 2px 8px; border-radius: 3px;'
      +   'font-size: 8pt; letter-spacing: .08em;'
      + '}'

      // ---- Pills, notes, AI cards ----
      + '.report-status-pill {'
      +   'display: inline-block; padding: 3px 10px; border-radius: 999px;'
      +   'background: #dcfce7 !important; color: #166534 !important;'
      +   'font-family: \"JetBrains Mono\", monospace !important;'
      +   'font-size: 8.5pt; letter-spacing: .08em;'
      + '}'
      + '.report-inline-note {'
      +   'background: #fef9c3 !important; border-left: 3px solid #ca8a04 !important;'
      +   'padding: 8px 12px; border-radius: 0 4px 4px 0;'
      +   'font-size: 9.5pt; color: #713f12 !important;'
      +   'margin: 10px 0;'
      + '}'
      + '.report-ai-card {'
      +   'background: #eff6ff !important; border: 1px solid #bfdbfe !important;'
      +   'border-radius: 8px; padding: 12px 14px; margin: 8px 0;'
      + '}'
      + '.report-ai-card-title { color: #1e3a8a !important; font-weight: 700; font-size: 11pt; }'
      + '.report-ai-card-body { color: #1f2937 !important; font-size: 10pt; line-height: 1.55; }'

      // ---- Subtitles ----
      + '.report-subtitle {'
      +   'font-family: \"JetBrains Mono\", monospace !important;'
      +   'font-size: 8.5pt !important; letter-spacing: .18em !important;'
      +   'text-transform: uppercase !important; color: #475569 !important;'
      +   'margin: 12px 0 6px 0 !important;'
      + '}'

      // ---- Disclaimer / footer ----
      + '.report-disclaimer {'
      +   'margin: 18px 0; padding: 12px 14px;'
      +   'background: #f1f5f9 !important; border-left: 4px solid #475569 !important;'
      +   'border-radius: 0 4px 4px 0; font-size: 9pt; color: #334155 !important;'
      + '}'
      + '.report-footer {'
      +   'margin-top: 22px; padding-top: 10px;'
      +   'border-top: 1px solid #cbd5e1 !important;'
      +   'font-family: \"JetBrains Mono\", monospace !important;'
      +   'font-size: 8.5pt; color: #64748b !important; text-align: center;'
      + '}'

      // ---- Hide screen-only controls ----
      + 'button, .btn, .nav, .top-bar, .left-rail, .panel-tabs { display: none !important; }';

    return '<!doctype html><html><head><meta charset="utf-8">'
      + '<title>HVAC Design Report — Musk-IT</title>'
      + styleMarkup
      + '<style>' + pdfStyle + '</style>'
      + '</head><body>'
      + '<main class="main"><section class="panel active" id="p-report"><div id="report-content">'
      + reportHtml
      + '</div></section></main>'
      + '</body></html>';
  }

  function printRenderedReport() {
    const reportContent = byId("report-content");
    const reportHtml = reportContent ? reportContent.innerHTML : "";
    if (!reportHtml) {
      window.print();
      return;
    }
    const printWindow = window.open("", "_blank", "width=1100,height=900");
    if (!printWindow) {
      window.print();
      return;
    }
    printWindow.document.open();
    printWindow.document.write(printableReportDocument(reportHtml));
    printWindow.document.close();
    printWindow.setTimeout(function () {
      printWindow.focus();
      printWindow.print();
    }, 350);
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
      if (!room.result) {
        return false;
      }
      ensureFinalizedResult(room.result, { promoteEnergySimulation: false });
      return true;
    });
    const requestedDiversityFactor = (parseFloat(valueOf("diversity_factor", project.diversityFactor || 85)) || 85) / 100;
    const diversityFactor = roomsWithResults.length <= 1 ? 1 : requestedDiversityFactor;
    ProjectManager.setDiversityFactor(diversityFactor * 100);

    const totalDesignTR = roomsWithResults.reduce(function (sum, room) {
      return sum + ((room.result.finalDesign && room.result.finalDesign.loads.trDesign) || 0);
    }, 0);
    const totalFinalTR = roomsWithResults.reduce(function (sum, room) {
      return sum + ((room.result.finalDesign && room.result.finalDesign.loads.trFinal) || 0);
    }, 0);
    const totalCatalogTR = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.tr_catalog || room.result.TR_sel || 0);
    }, 0);
    const diversifiedTR = totalFinalTR * diversityFactor;
    const totalCoolingCFM = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.finalDesign.airflow.coolingCFM || 0);
    }, 0);
    const totalRecirculationCFM = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.finalDesign.airflow.recirculationCFM || 0);
    }, 0);
    const totalVentilationCFM = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.finalDesign.airflow.ventilationCFM || 0);
    }, 0);
    const totalCFM = roomsWithResults.reduce(function (sum, room) {
      return sum + (room.result.finalDesign.airflow.totalRoomSupplyCFM || 0);
    }, 0);

    setMetric("m-proj-tr", formatNumber(totalFinalTR, 2), "TR");
    setMetric("m-proj-div-tr", formatNumber(diversifiedTR, 2), "TR");
    setMetric("m-proj-cfm", formatInt(totalCFM), "CFM");
    setMetric("m-proj-rooms", String(project.rooms.length));

    byId("project-room-tbody").innerHTML = roomsWithResults.length
      ? roomsWithResults.map(function (room) {
        const finalDesign = room.result.finalDesign;
        return "<tr><td>" + escapeHtml(room.name) + "</td><td>" + formatNumber(room.result.area, 1) + "</td><td class=\"num\">" + formatInt(finalDesign.loads.sensibleW) + "</td><td class=\"num\">" + formatInt(finalDesign.loads.latentW) + "</td><td class=\"num\">" + formatInt(finalDesign.loads.totalLoadW) + "</td><td class=\"num\">" + formatNumber(finalDesign.loads.totalLoadW / Math.max(room.result.area, 1), 1) + "</td><td class=\"num\">" + formatNumber(finalDesign.loads.trDesign || 0, 2) + "</td><td class=\"num\">" + formatNumber(finalDesign.loads.trFinal || 0, 2) + "</td><td class=\"num\">" + formatInt(finalDesign.airflow.totalRoomSupplyCFM || 0) + "</td><td class=\"num\">" + formatNumber(room.result.systemShr || room.result.shr, 3) + "</td></tr>";
      }).join("")
      : '<tr><td colspan="10" style="color:var(--text3);text-align:center;padding:16px;">Add rooms and run calculations to build the project</td></tr>';

    byId("project-summary-table").innerHTML =
      '<table class="calc-table"><tbody>'
      + "<tr><td>Total TR_design</td><td class=\"num\">" + formatNumber(totalDesignTR, 2) + " TR</td></tr>"
      + "<tr><td>Total TR_final</td><td class=\"num\">" + formatNumber(totalFinalTR, 2) + " TR</td></tr>"
      + "<tr><td>Total TR_catalog</td><td class=\"num\">" + formatNumber(totalCatalogTR, 2) + " TR</td></tr>"
      + "<tr><td>Diversity factor</td><td class=\"num\">" + formatNumber(diversityFactor * 100, 0) + "%</td></tr>"
      + (roomsWithResults.length <= 1 ? '<tr><td>Diversity note</td><td class="num">Single room uses 100%</td></tr>' : "")
      + '<tr class="total-row"><td><b>Diversified plant TR_final</b></td><td class="num"><b>' + formatNumber(diversifiedTR, 2) + " TR</b></td></tr>"
      + "<tr><td>Total cooling airflow</td><td class=\"num\">" + formatInt(totalCoolingCFM) + " CFM</td></tr>"
      + "<tr><td>Total recirculation airflow</td><td class=\"num\">" + formatInt(totalRecirculationCFM) + " CFM</td></tr>"
      + "<tr><td>Total ventilation / make-up</td><td class=\"num\">" + formatInt(totalVentilationCFM) + " CFM</td></tr>"
      + "<tr><td>Total room airflow</td><td class=\"num\">" + formatInt(totalCFM) + " CFM</td></tr>"
      + "<tr><td>Project room count</td><td class=\"num\">" + project.rooms.length + "</td></tr>"
      + "</tbody></table>";

    const groups = EquipmentEngine.buildAhuGroups(roomsWithResults, diversityFactor);
    byId("ahu-group-summary").innerHTML = groups.length
      ? '<table class="calc-table"><thead><tr><th>AHU GROUP</th><th>ROOMS</th><th>TR_design</th><th>TR_final</th><th>DIVERSIFIED TR</th><th>RECIRC CFM</th><th>COOL CFM</th><th>VENT CFM</th><th>PEAK ESP</th><th>SUGGESTED AHU</th><th>FAN TYPE</th></tr></thead><tbody>'
        + groups.map(function (group) {
          return "<tr><td>" + group.name + "</td><td>" + group.roomCount + "</td><td class=\"num\">" + formatNumber(group.totalDesignTR, 1) + "</td><td class=\"num\">" + formatNumber(group.totalFinalTR, 1) + "</td><td class=\"num\">" + formatNumber(group.diversifiedTR, 1) + "</td><td class=\"num\">" + formatInt(group.totalRecirculationCFM || group.totalCFM) + "</td><td class=\"num\">" + formatInt(group.totalCoolingCFM || 0) + "</td><td class=\"num\">" + formatInt(group.totalVentilationCFM || 0) + "</td><td class=\"num\">" + formatInt(group.peakESP) + "</td><td>" + group.selection.ahu.model + " / " + formatNumber(group.selection.ahu.capacityTR, 1) + " TR</td><td>" + group.selection.fan.type + "</td></tr>";
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
      + "<tr><td>Cost region multiplier</td><td class=\"num\">" + escapeHtml(String(totals.regionProfile || "standard")) + " x " + formatNumber(totals.regionMultiplier || 1, 2) + "</td></tr>"
      + "<tr><td>Supply total</td><td class=\"num\">" + formatCurrency(totals.supplyTotal) + "</td></tr>"
      + "<tr><td>Installation and T&C</td><td class=\"num\">" + formatCurrency(totals.installationAmount) + "</td></tr>"
      + '<tr class="total-row"><td><b>Grand total</b></td><td class="num"><b>' + formatCurrency(totals.grandTotal) + "</b></td></tr>"
      + "<tr><td>Vendor range</td><td class=\"num\">" + formatCurrency(totals.lowGrandTotal) + " to " + formatCurrency(totals.highGrandTotal) + "</td></tr>"
      + "<tr><td>Cost per TR</td><td class=\"num\">" + (totalSelectedTR > 0 ? formatCurrency(totals.grandTotal / totalSelectedTR) + "/TR" : "-") + "</td></tr>"
      + "<tr><td>Cost per m2</td><td class=\"num\">" + (totalArea > 0 ? formatCurrency(totals.grandTotal / totalArea) + "/m2" : "-") + "</td></tr>"
      + "</tbody></table>";

    setMetric("m-boq-equip", formatCurrency(totals.equipmentTotal));
    setMetric("m-boq-duct", formatCurrency(totals.ductTotal));
    setMetric("m-boq-diff", formatCurrency(totals.diffuserTotal));
    setMetric("m-boq-total", formatCurrency(totals.grandTotal));
  }

  function renderAll(result) {
    ensureFinalizedResult(result || {}, { promoteEnergySimulation: false, throwOnFailure: true });
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
    renderAiAlternatives(result);
    renderSchematic3D(result);
    const groups = renderProjectSummary();
    renderBOQ(groups);
    renderReport(result, groups);
  }

  async function renderOwnerDashboard() {
    if (!isAuthenticated() || !isOwnerUser(currentUser())) {
      return;
    }
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      setMetric("m-owner-companies", "0");
      setMetric("m-owner-licenses", "0");
      setMetric("m-owner-leads", "0");
      setMetric("m-owner-demos", "0");
      setMetric("m-owner-quotes", "0");
      setMetric("m-owner-users", "0");
      setMetric("m-owner-dau", "0");
      if (byId("owner-companies-table")) {
        byId("owner-companies-table").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Owner dashboard requires the Node backend server.</p>';
      }
      if (byId("owner-leads-table")) {
        byId("owner-leads-table").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Start the backend to load lead and licensing data.</p>';
      }
      if (byId("owner-users-table")) {
        byId("owner-users-table").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Start the backend to load owner user management.</p>';
      }
      if (byId("owner-dau-table")) {
        byId("owner-dau-table").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Start the backend to load DAU analytics.</p>';
      }
      if (byId("owner-dau-trend")) {
        byId("owner-dau-trend").innerHTML = '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">Start the backend to load DAU trend.</p>';
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
    const users = response.users || [];
    const dailyActive = response.dailyActive || {};
    const pricingOverrides = response.pricingOverrides || [];

    platform.licensingPlans = plans.slice();

    setMetric("m-owner-companies", String(totals.companyCount || 0));
    setMetric("m-owner-licenses", String(totals.activeLicenseCount || 0));
    setMetric("m-owner-leads", String(totals.leadCount || 0));
    setMetric("m-owner-demos", String(totals.demoCount || 0));
    setMetric("m-owner-quotes", String(totals.quoteCount || 0));
    setMetric("m-owner-users", String(totals.companyUserCount || 0));
    setMetric("m-owner-dau", String(dailyActive.activeUserCount || 0));

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
      syncOwnerPricingAmountToPlan();
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

    if (byId("owner-users-table")) {
      byId("owner-users-table").innerHTML = users.length
        ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>USER</th><th>ROLE</th><th>COMPANY</th><th>EMAIL</th><th>LAST LOGIN</th></tr></thead><tbody>'
          + users.map(function (user) {
            const role = user.isOwner ? "OWNER" : (user.isCompanyAdmin ? "ADMIN" : String(user.role || "USER").toUpperCase());
            return "<tr><td>" + escapeHtml(user.name || "-") + "</td><td><span class=\"admin-chip\">" + escapeHtml(role) + "</span></td><td>" + escapeHtml(user.companyName || user.company || "-") + "</td><td>" + escapeHtml(user.email || "-") + "</td><td>" + (user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never") + "</td></tr>";
          }).join("")
          + "</tbody></table></div>"
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No platform users found.</p>';
    }

    if (byId("owner-dau-table")) {
      byId("owner-dau-table").innerHTML = '<div class="table-wrap"><table class="calc-table"><thead><tr><th>METRIC</th><th class="num">COUNT</th></tr></thead><tbody>'
        + "<tr><td>Daily active users (" + escapeHtml(dailyActive.date || "today") + ")</td><td class=\"num\">" + formatInt(dailyActive.activeUserCount || 0) + "</td></tr>"
        + "<tr><td>7-day active users</td><td class=\"num\">" + formatInt(dailyActive.active7DayUserCount || 0) + "</td></tr>"
        + "<tr><td>Active companies today</td><td class=\"num\">" + formatInt(dailyActive.activeCompanyCount || 0) + "</td></tr>"
        + "<tr><td>Owner active today</td><td class=\"num\">" + formatInt(dailyActive.ownerActiveCount || 0) + "</td></tr>"
        + "<tr><td>Company admins active today</td><td class=\"num\">" + formatInt(dailyActive.adminActiveCount || 0) + "</td></tr>"
        + "<tr><td>Company users active today</td><td class=\"num\">" + formatInt(dailyActive.regularActiveCount || 0) + "</td></tr>"
        + "</tbody></table></div>";
    }

    if (byId("owner-dau-trend")) {
      const trend = Array.isArray(dailyActive.trend) ? dailyActive.trend : [];
      const maxValue = Math.max(1, ...trend.map(function (point) {
        return point.activeUserCount || 0;
      }));
      byId("owner-dau-trend").innerHTML = trend.length
        ? '<div class="table-wrap"><div style="display:flex;align-items:flex-end;gap:10px;height:220px;padding:12px 8px 4px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg3);">'
          + trend.map(function (point) {
            const value = point.activeUserCount || 0;
            const height = Math.max(8, Math.round((value / maxValue) * 170));
            const label = point.date ? point.date.slice(5) : "-";
            return '<div style="flex:1;min-width:0;text-align:center;font-family:var(--mono);font-size:10px;color:var(--text3);">'
              + '<div style="height:176px;display:flex;align-items:flex-end;justify-content:center;"><div title="' + escapeHtml(label + ': ' + value + ' active users') + '" style="width:100%;max-width:34px;height:' + height + 'px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--accent),#20b486);box-shadow:0 8px 18px rgba(79,164,255,0.18);"></div></div>'
              + '<div style="margin-top:7px;color:var(--text2);font-weight:700;">' + formatInt(value) + '</div>'
              + '<div style="margin-top:3px;">' + escapeHtml(label) + '</div>'
              + '</div>';
          }).join("")
          + '</div></div>'
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No DAU trend points are available yet.</p>';
    }

    if (byId("owner-pricing-overrides-table")) {
      byId("owner-pricing-overrides-table").innerHTML = pricingOverrides.length
        ? '<div class="table-wrap"><table class="calc-table"><thead><tr><th>COMPANY</th><th>PLAN</th><th class="num">PRICE</th><th class="num">USERS</th><th>STATUS</th><th>UPDATED</th></tr></thead><tbody>'
          + pricingOverrides.map(function (override) {
            return "<tr><td>" + escapeHtml(override.companyName || override.companyId || "-") + "</td><td>" + escapeHtml(override.planName || override.planCode || "-") + "</td><td class=\"num\">" + formatCurrency(override.annualPriceInr || 0) + "</td><td class=\"num\">" + (override.userLimit == null ? "-" : formatInt(override.userLimit)) + "</td><td><span class=\"admin-chip\">" + (override.isActive ? "ACTIVE" : "INACTIVE") + "</span></td><td>" + (override.updatedAt ? new Date(override.updatedAt).toLocaleString() : "-") + "</td></tr>";
          }).join("")
          + "</tbody></table></div>"
        : '<p style="color:var(--text3);font-family:var(--mono);font-size:12px;">No company pricing overrides have been saved yet.</p>';
    }

    if (byId("owner-summary-note")) {
      byId("owner-summary-note").textContent = "Owner overview loaded for " + companies.length + " company account(s), " + leads.length + " lead(s), " + users.length + " user record(s), and " + formatInt(dailyActive.activeUserCount || 0) + " daily active user(s).";
    }
  }

  async function renderAdminDashboard() {
    if (!isAuthenticated() || !isAdminUser(currentUser())) {
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
      "auth-owner-email",
      "auth-owner-password",
      "auth-owner-otp",
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
    platform.ownerLoginChallenge = null;
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
    if (isOwnerUser(user)) {
      show("owner");
      clearAuthForms();
      setAuthMode("login");
      setAuthMessage(message || "Owner dashboard ready.", "success");
      return;
    }
    await hydrateProjectForUser(user);
    if (!platform.inputListenersBound) {
      attachInputListeners();
    }
    if (!platform.envelopeListenersBound) {
      attachEnvelopeListeners();
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
    renderAuthPlanCards();
    const planSelect = byId("auth-quote-plan");
    if (planSelect && platform.licensingPlans.length) {
      planSelect.innerHTML = platform.licensingPlans.map(function (plan) {
        const durationLabel = plan.licenseType === "source" ? "license" : "year";
        return '<option value="' + escapeHtml(plan.planCode) + '">'
          + escapeHtml(plan.planName) + " · " + formatCurrency(plan.annualPriceInr) + " / " + durationLabel
          + "</option>";
      }).join("");
    }
    syncOwnerPricingAmountToPlan();
  }

  function planDescription(plan) {
    if (!plan) {
      return "";
    }
    if (plan.licenseType === "source") {
      return "Source access / enterprise route with custom deployment scope.";
    }
    const upperLimit = plan.userLimit || plan.userMax || 1;
    return "Company license with 1 admin + up to " + formatInt(upperLimit) + " total users.";
  }

  function renderAuthPlanCards() {
    const grid = byId("auth-plan-grid");
    if (!grid || !platform.licensingPlans.length) {
      return;
    }
    grid.innerHTML = platform.licensingPlans.map(function (plan) {
      const durationLabel = plan.licenseType === "source" ? "license" : "year";
      return '<button type="button" class="auth-plan-card" data-plan-code="' + escapeHtml(plan.planCode) + '">'
        + '<strong>' + escapeHtml(plan.planName) + '</strong>'
        + '<span>' + escapeHtml(formatCurrency(plan.annualPriceInr) + " / " + durationLabel) + '<br>'
        + escapeHtml(planDescription(plan)) + '</span>'
        + '</button>';
    }).join("");
  }

  function syncOwnerPricingAmountToPlan() {
    const planCode = valueOf("owner-pricing-plan", "");
    const amountEl = byId("owner-pricing-amount");
    if (!planCode || !amountEl || amountEl.dataset.manual === "true") {
      return;
    }
    const plan = (platform.licensingPlans || []).find(function (entry) {
      return entry.planCode === planCode;
    });
    if (plan && plan.annualPriceInr > 0) {
      amountEl.value = String(plan.annualPriceInr);
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

  async function saveLicensingPlanPrice() {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return;
    }
    const planCode = valueOf("owner-pricing-plan", "");
    const annualPriceInr = numberOf("owner-pricing-amount", 0);
    const statusEl = byId("owner-pricing-note-status");

    if (!planCode || annualPriceInr <= 0) {
      if (statusEl) {
        statusEl.textContent = "Choose a package and enter a valid price before saving.";
      }
      return;
    }

    const response = await window.ServerApi.updateLicensingPlanPrice({
      planCode: planCode,
      annualPriceInr: annualPriceInr
    });

    if (response && response.ok) {
      platform.licensingPlans = response.plans || platform.licensingPlans;
      const amountEl = byId("owner-pricing-amount");
      if (amountEl) {
        amountEl.dataset.manual = "";
      }
      renderAuthPlanCards();
      await loadLicensingPlans();
      if (statusEl) {
        statusEl.textContent = response.message;
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = response && response.error ? response.error : "Unable to save package price.";
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

    window.addEventListener("hvac-auth-unauthorized", function (event) {
      const detail = event && event.detail ? event.detail : {};
      const baseMessage = detail && detail.error
        ? detail.error
        : "Your session expired. Please log in again.";

      if (platform.projectManagerReady && ProjectManager.getProject()) {
        ProjectManager.getProject().rates = readRates();
        ProjectManager.autoSave();
      }

      window._lastCalcResult = null;
      window._lastStatePoints = null;
      lockWorkspace(baseMessage + " Local project data has been preserved in this browser.", "error");
    });

    document.querySelectorAll("[data-auth-mode], [data-auth-mode-switch]").forEach(function (element) {
      element.addEventListener("click", function () {
        const mode = element.getAttribute("data-auth-mode") || element.getAttribute("data-auth-mode-switch");
        if (mode) {
          setAuthMode(mode);
          setAuthMessage(
            mode === "reset"
              ? "Use your email and recovery key, or request an emailed reset token."
              : mode === "owner"
                ? "Owner access is separate and requires email, password, and an emailed one-time password."
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

    const ownerOtpButton = byId("auth-owner-send-otp-btn");
    if (ownerOtpButton) {
      ownerOtpButton.addEventListener("click", async function () {
        const email = valueOf("auth-owner-email", "");
        const password = valueOf("auth-owner-password", "");
        platform.ownerLoginChallenge = null;

        if (!email || !password) {
          setAuthMessage("Enter owner email and password before requesting OTP.", "error");
          return;
        }

        setAuthMessage("Verifying owner password and sending OTP...", "");
        const response = await AuthManager.requestOwnerOtp({
          email: email,
          password: password
        });
        if (!response.ok) {
          setAuthMessage(response.error || "Owner OTP could not be sent.", "error");
          return;
        }

        platform.ownerLoginChallenge = {
          challengeId: response.challengeId,
          email: response.email || email,
          expiresAt: response.expiresAt
        };
        setValue("auth-owner-otp", "");
        setAuthMessage(
          "Owner OTP sent to " + (response.email || email) + ". Enter the 6-digit code to complete login.",
          "success"
        );
      });
    }

    const ownerForm = byId("auth-owner-form");
    if (ownerForm) {
      ownerForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const challenge = platform.ownerLoginChallenge || {};
        const email = valueOf("auth-owner-email", "");
        const otp = valueOf("auth-owner-otp", "");

        if (!challenge.challengeId) {
          setAuthMessage("Request an owner OTP before verifying login.", "error");
          return;
        }
        if (!otp) {
          setAuthMessage("Enter the owner email OTP.", "error");
          return;
        }

        setAuthMessage("Verifying owner OTP...", "");
        const response = await AuthManager.verifyOwnerOtp({
          challengeId: challenge.challengeId,
          email: challenge.email || email,
          otp: otp
        });
        if (!response.ok) {
          setAuthMessage(response.error || "Owner OTP verification failed.", "error");
          return;
        }

        platform.ownerLoginChallenge = null;
        await openWorkspaceForUser(response.user, "Owner login successful.");
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

    const planGrid = byId("auth-plan-grid");
    if (planGrid) {
      planGrid.addEventListener("click", function (event) {
        const card = event.target.closest(".auth-plan-card");
        if (!card) {
          return;
        }
        const planCode = card.getAttribute("data-plan-code") || "";
        if (planCode) {
          setValue("auth-quote-plan", planCode);
        }
        if (valueOf("auth-quote-name", "") && valueOf("auth-quote-company", "") && valueOf("auth-quote-phone", "") && valueOf("auth-quote-email", "")) {
          handleLicensePurchase();
        } else {
          setAuthMessage("Package selected. Fill name, email, phone, and company, then click Pay with Razorpay.", "");
        }
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

    const ownerPlanPriceButton = byId("owner-save-plan-price-btn");
    if (ownerPlanPriceButton) {
      ownerPlanPriceButton.addEventListener("click", function () {
        saveLicensingPlanPrice();
      });
    }

    const ownerPricingPlan = byId("owner-pricing-plan");
    if (ownerPricingPlan) {
      ownerPricingPlan.addEventListener("change", function () {
        const amountEl = byId("owner-pricing-amount");
        if (amountEl) {
          amountEl.dataset.manual = "";
        }
        syncOwnerPricingAmountToPlan();
      });
    }

    const ownerPricingAmount = byId("owner-pricing-amount");
    if (ownerPricingAmount) {
      ownerPricingAmount.addEventListener("input", function () {
        ownerPricingAmount.dataset.manual = "true";
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
    const ownerPanels = ["owner", "owner-users", "owner-dau", "owner-pricing"];
    if (isOwnerUser(currentUser()) && ownerPanels.indexOf(panel) === -1) {
      panel = "owner";
    }
    if (ownerPanels.indexOf(panel) !== -1 && !isOwnerUser(currentUser())) {
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
    if (panel === "ai" && window._lastCalcResult) {
      renderAiAlternatives(window._lastCalcResult);
    }
    if (panel === "schematic3d" && window._lastCalcResult) {
      renderSchematic3D(window._lastCalcResult);
    }
    if (ownerPanels.indexOf(panel) !== -1 && isOwnerUser(currentUser())) {
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
	    result.finalDesign = buildFinalDesign(result);
    result.designAdvisorStatus = "ready";
    result.designAdvisorError = "";
    result.designAdvisorMeta = {
      provider: result.designAdvisor && result.designAdvisor.provider ? result.designAdvisor.provider : "local_rules",
      generatedAt: new Date().toISOString()
    };
    result.designOptimizationStatus = "loading";
    result.designOptimizationError = "";
    result.designOptimizationMeta = {
      provider: "local_optimization",
      generatedAt: new Date().toISOString()
    };
    result.designAlternativesStatus = "loading";
    result.designAlternativesError = "";
    result.designAlternativesMeta = {
      provider: result.designAlternatives && result.designAlternatives.provider ? result.designAlternatives.provider : "local_rules",
      generatedAt: new Date().toISOString()
    };
    result.finalEnergyResult = null;
    result.energySimulation = null;
    result.energySimulationStatus = "loading";
    result.energySimulationError = "";
    result.energySimulationMeta = previousResult && previousResult.energySimulationMeta
      ? copyJson(previousResult.energySimulationMeta)
      : null;
    ensureFinalizedResult(result, { promoteEnergySimulation: false });
    ProjectManager.updateActiveResult(result);
    window._lastCalcResult = result;
    window._lastStatePoints = result.statePoints;
    renderAll(result);
    refreshDesignAdvisor(result);
    refreshDesignOptimization(result);
    refreshEnergySimulation(result);
    autoSave();
    show(currentPanel === "input" ? "cooling" : currentPanel);
    return result;
  }

  function printReport() {
    if (!ensureAuthenticated()) {
      return;
    }
    const result = window._lastCalcResult || runAll();
    const activeResult = result || window._lastCalcResult;
    if (activeResult) {
      const groups = renderProjectSummary();
      renderBOQ(groups);
      renderAiAlternatives(activeResult);
      renderSchematic3D(activeResult);
      renderReport(activeResult, groups);
    }
    show("report");
    window.setTimeout(function () {
      printRenderedReport();
    }, 250);
  }

  function attachInputListeners() {
    if (platform.inputListenersBound) {
      return;
    }
    platform.inputListenersBound = true;
    ROOM_FIELD_IDS.concat(RATE_FIELD_IDS).concat(["project_name", "project_name_panel", "diversity_factor"]).forEach(function (fieldId) {
      if (fieldId === "window_count" || fieldId === "wall_count") {
        return;
      }
      const element = byId(fieldId);
      if (!element) {
        return;
      }
      function handleFieldUpdate() {
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
          if (fieldId === "design_mode" || fieldId === "cleanroom_iso_class" || fieldId === "cleanroom_state" || fieldId === "cleanroom_pressure_mode") {
            syncDesignModeUi();
          }
          saveCurrentInputsToActiveRoom();
        }
        ProjectManager.autoSave();
      }
      element.addEventListener("input", handleFieldUpdate);
      element.addEventListener("change", handleFieldUpdate);
    });
  }

  function attachEnvelopeListeners() {
    if (platform.envelopeListenersBound) {
      return;
    }
    platform.envelopeListenersBound = true;

    const windowCount = byId("window_count");
    if (windowCount) {
      windowCount.addEventListener("change", function () {
        commitEnvelopeCount("window_count");
        saveCurrentInputsToActiveRoom();
        ProjectManager.autoSave();
      });
      windowCount.addEventListener("blur", function () {
        commitEnvelopeCount("window_count");
        saveCurrentInputsToActiveRoom();
        ProjectManager.autoSave();
      });
    }

    const wallCount = byId("wall_count");
    if (wallCount) {
      wallCount.addEventListener("change", function () {
        commitEnvelopeCount("wall_count");
        saveCurrentInputsToActiveRoom();
        ProjectManager.autoSave();
      });
      wallCount.addEventListener("blur", function () {
        commitEnvelopeCount("wall_count");
        saveCurrentInputsToActiveRoom();
        ProjectManager.autoSave();
      });
    }

    const windowList = byId("window-config-list");
    if (windowList) {
      windowList.addEventListener("input", function () {
        syncEnvelopeConfigsFromUi();
        saveCurrentInputsToActiveRoom();
        ProjectManager.autoSave();
      });
      windowList.addEventListener("change", function () {
        syncEnvelopeConfigsFromUi();
        saveCurrentInputsToActiveRoom();
        ProjectManager.autoSave();
      });
    }

    const wallList = byId("wall-config-list");
    if (wallList) {
      wallList.addEventListener("input", function () {
        syncEnvelopeConfigsFromUi();
        saveCurrentInputsToActiveRoom();
        ProjectManager.autoSave();
      });
      wallList.addEventListener("change", function () {
        syncEnvelopeConfigsFromUi();
        saveCurrentInputsToActiveRoom();
        ProjectManager.autoSave();
      });
    }

    ["len", "wid"].forEach(function (fieldId) {
      const element = byId(fieldId);
      if (!element) {
        return;
      }
      element.addEventListener("input", function () {
        syncPlanAreaFields(false);
      });
    });

    ["ceiling_area", "floor_area"].forEach(function (fieldId) {
      const element = byId(fieldId);
      if (!element) {
        return;
      }
      element.addEventListener("input", function () {
        const plannedArea = roundTo((numberOf("len", parseFloat(DEFAULT_INPUTS.len)) || 0) * (numberOf("wid", parseFloat(DEFAULT_INPUTS.wid)) || 0), 2);
        const current = parseFloat(element.value);
        element.dataset.manual = Number.isFinite(current) && Math.abs(current - plannedArea) > 0.05 ? "true" : "false";
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
  window.HvacPlatformTest = {
    calculateRoom: function (inputs, runtimeOptions) {
      return calculateRoom(copyJson(inputs || DEFAULT_INPUTS), runtimeOptions || { skipAiEnhancements: true });
    },
    buildEnergySimulationPayload: buildEnergySimulationPayload,
    buildFinalDesign: buildFinalDesign,
    ensureFinalizedResult: ensureFinalizedResult,
    validateFinalizedConsistency: validateFinalizedConsistency,
    normalizeEnergyReportForFinalDesign: normalizeEnergyReportForFinalDesign,
    renderEnergy: renderEnergy,
    renderReport: renderReport,
    airflowBreakdown: airflowBreakdown,
    renderProjectSummary: renderProjectSummary
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

  if (window.__HVAC_TEST_MODE) {
    return;
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
