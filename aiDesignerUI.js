/**
 * Front-end glue for the ASHRAE engine endpoints:
 *
 *   /api/ai/design          → full sized design
 *   /api/ai/design-variants → 3 ranked variants
 *   /api/ai/design-autofix  → iterate until constraints satisfied
 *
 * Self-contained: requires only window.ServerApi (already loaded) and
 * window.ProjectManager (already loaded). Listens on three buttons added
 * to the AI panel of contact copy 2.html.
 *
 * Project payload is reconstructed from the active room's calculation
 * inputs/results. Where rich envelope geometry is not yet captured in
 * the form, we fall back to reasonable defaults (this is documented in
 * the rendered output so the engineer knows what to refine).
 */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function fmt(n, digits) {
    if (!Number.isFinite(Number(n))) return "—";
    return Number(n).toLocaleString(undefined, {
      maximumFractionDigits: digits == null ? 1 : digits
    });
  }
  function fmtInt(n) { return fmt(n, 0); }
  function setStatus(text, tone) {
    const el = $("ai-engine-status");
    if (!el) return;
    el.textContent = text;
    el.style.color = tone === "error" ? "var(--danger, #ef4444)"
      : tone === "busy" ? "var(--warn, #f59e0b)"
      : tone === "ok" ? "var(--ok, #22c55e)"
      : "var(--text2)";
  }
  function getActiveRoomResult() {
    if (!window.ProjectManager) return { room: null, result: null };
    const room = window.ProjectManager.getActiveRoom && window.ProjectManager.getActiveRoom();
    return { room: room, result: room && room.result ? room.result : null };
  }

  // -----------------------------------------------------------------
  // Build an ASHRAE engine project from the active room's inputs.
  // -----------------------------------------------------------------
  function buildProjectFromRoom(room, result) {
    // IMPORTANT: the calculator form uses short input ids (len, wid, ht, occ,
    // out_dbt, in_dbt, win_area, ...). The previous version of this mapper
    // read long names (inputs.height, inputs.occupants, inputs.outdoor_db)
    // that never existed, so every AI design request silently used generic
    // defaults instead of the user's actual room. All reads below use the
    // real ids first, with the legacy names kept as fallbacks.
    const inputs = (result && result.inputs) || {};
    const numOr = function (value, fallback) {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const length = numOr(inputs.len, 0);
    const width = numOr(inputs.wid, 0);
    const area = (length > 0 && width > 0) ? length * width : numOr(inputs.area, numOr(result && result.area, 25));
    const height = numOr(inputs.ht, numOr(inputs.height, 3.0));

    // Climate — from the actual form fields; fall back to Indian design day.
    const climate = {
      latitudeDeg:      numOr(inputs.out_lat, numOr(inputs.latitude, 19.0)),
      longitudeDeg:     numOr(inputs.out_long, numOr(inputs.longitude, 72.8)),
      stdMeridianDeg:   numOr(inputs.std_meridian_deg, 82.5),
      designOutdoorDbC: numOr(inputs.out_dbt, numOr(inputs.outdoor_db, 35)),
      designOutdoorWbC: numOr(inputs.out_wbt, numOr(inputs.outdoor_wb, 28)),
      designDayOfYear:  numOr(inputs.solar_day, numOr(inputs.design_day_of_year, 172)),
      designClockHour:  numOr(inputs.solar_hour, numOr(inputs.design_clock_hour, 15)),
      elevationM:       numOr(inputs.out_elev, numOr(inputs.elevation_m, 14))
    };

    // Occupant activity: form ids → engine activity keys (nearest ASHRAE
    // Ch.18 Table 1 rate).
    const activityMap = {
      seated_rest: "seated_quiet",     // 100 W
      seated_light: "seated_office",   // 115 W
      standing_light: "seated_eating", // ~130→145 W nearest
      walking: "light_industry"        // ~165→220 W nearest (walking/light bench)
    };
    const activity = activityMap[inputs.occ_act] || inputs.activity_level || "seated_office";

    // Walls — use the real room perimeter and the exposed-wall count from
    // the form (wall_exp: 1–4 exposed walls), net of glazing.
    const perimeter = (length > 0 && width > 0)
      ? 2 * (length + width)
      : 4 * Math.sqrt(area);
    const exposedFraction = Math.min(Math.max(numOr(inputs.wall_exp, 2), 1), 4) / 4;
    const windowArea = Math.max(numOr(inputs.win_area, numOr(inputs.window_area_m2, 0)), 0);
    const wallArea = Math.max(perimeter * height * exposedFraction - windowArea, 0);
    const wallU = numOr(inputs.u_wall, 0.5);
    const walls = [
      { area: wallArea * 0.5, U: wallU, orientation: "S", alpha: 0.6 },
      { area: wallArea * 0.5, U: wallU, orientation: "W", alpha: 0.6 }
    ];

    // Safety factor: the form stores sf as a PERCENT (e.g. 10), the engine
    // expects a multiplier (e.g. 1.10).
    const sfPercent = numOr(inputs.sf, NaN);
    const safetyFactor = Number.isFinite(sfPercent) && sfPercent >= 1
      ? 1 + Math.min(Math.max(sfPercent, 0), 50) / 100
      : numOr(inputs.safety_factor, 1.10);

    const roofExposed = String(inputs.roof_exp || "top_floor") !== "ground"
      && inputs.is_top_floor !== false;

    const project = {
      name: (room && room.name) || "Active room",
      climate: climate,
      rooms: [{
        name: (room && room.name) || "Room 1",
        areaM2: area, ceilingHeightM: height,
        occupants: numOr(inputs.occ, numOr(inputs.occupants, 4)),
        activity: activity,
        lpd: numOr(inputs.lighting, numOr(inputs.lpd_w_per_m2, 10)),
        epd: numOr(inputs.equip, numOr(inputs.epd_w_per_m2, 12)),
        equipmentUsage: numOr(inputs.div_equip, numOr(inputs.equipment_usage, 0.8)),
        walls: walls,
        roof: roofExposed
          ? { area: area, U: numOr(inputs.u_roof, 0.3), alpha: 0.85, dR: 63 }
          : null,
        windows: windowArea > 0 ? [{
          area: windowArea,
          U: numOr(inputs.u_window, 2.8),
          // form captures a shading coefficient (sc_glass); engine converts
          // SC → SHGC internally when shgcN is not supplied.
          sc: numOr(inputs.sc_glass, NaN) || undefined,
          shgcN: Number.isFinite(parseFloat(inputs.shgc)) ? parseFloat(inputs.shgc) : undefined,
          orientation: inputs.win_orient || inputs.window_orientation || "S"
        }] : [],
        infiltrationAch: numOr(inputs.infiltration_ach, numOr(result && result.infiltration_ach, 0.4)),
        ventilationCfmPerPerson: numOr(inputs.fresh_cfm, numOr(inputs.vent_cfm_per_person, 5)),
        ventilationCfmPerM2: numOr(inputs.vent_cfm_per_m2, 0.3),
        supplyTempC: numOr(
          result && result.airflowBasis && result.airflowBasis.supplyTempDesign,
          numOr(inputs.supply_temp_c, 13)
        ),
        setpointC: numOr(inputs.in_dbt, numOr(inputs.indoor_db, 24)),
        setpointRhPct: numOr(inputs.in_rh, numOr(inputs.indoor_rh, 50)),
        safetyFactor: safetyFactor
      }],
      designIntent: {
        systemType:      inputs.system_type || "vrf",
        fanEfficiency:   numOr(inputs.fan_efficiency, 0.65),
        motorEfficiency: 0.92,
        externalSpPa:    numOr(result && result.total_esp, numOr(inputs.total_esp_pa, 500)),
        diversityFactor: 1.0
      }
    };
    return project;
  }

  // -----------------------------------------------------------------
  // Renderers
  // -----------------------------------------------------------------
  function chip(text, tone) {
    // Dark-theme chips — semitransparent fills over var(--bg3)
    const bg = tone === "ok"   ? "rgba(0,201,167,0.16)"
             : tone === "warn" ? "rgba(245,158,11,0.18)"
             : tone === "bad"  ? "rgba(239,68,68,0.18)"
             :                   "rgba(0,144,255,0.18)";
    const fg = tone === "ok"   ? "#22d3a3"
             : tone === "warn" ? "#fbbf24"
             : tone === "bad"  ? "#f87171"
             :                   "#60a5fa";
    const border = tone === "ok"   ? "rgba(0,201,167,0.35)"
                 : tone === "warn" ? "rgba(245,158,11,0.4)"
                 : tone === "bad"  ? "rgba(239,68,68,0.4)"
                 :                   "rgba(0,144,255,0.4)";
    return '<span style="display:inline-block;padding:2px 10px;border-radius:9999px;'
      + 'font-family:var(--mono);font-size:10.5px;letter-spacing:.04em;'
      + 'background:' + bg + ';color:' + fg + ';border:1px solid ' + border + ';">' + text + '</span>';
  }

  function metricTile(label, value, unit, accent) {
    const color = accent || "var(--accent2)";
    return '<div style="background:var(--bg3);border:1px solid var(--border);'
      + 'border-left:3px solid ' + color + ';border-radius:8px;padding:10px 14px;">'
      + '<div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.10em;'
      + 'color:var(--text3);text-transform:uppercase;">' + label + '</div>'
      + '<div style="font-size:22px;font-weight:600;color:var(--text);margin-top:4px;'
      + 'font-family:var(--mono);">' + value
      + '<span style="font-size:12px;font-weight:400;color:var(--text2);margin-left:6px;">'
      + (unit || "") + '</span></div></div>';
  }

  function renderDesign(design, narrative) {
    const a = design.aggregate || {};
    const fan = design.fan || {};
    const pump = design.pump;
    const fanCompliant = fan.ashrae90_1Compliant === true;
    const tiles = [
      metricTile("Total Cooling",    fmt(a.totalLoadW / 1000, 1), "kW",  "var(--accent2)"),
      metricTile("Selected Tonnage", fmt(a.selectedTR, 1),        "TR",  "var(--accent)"),
      metricTile("Total Supply Air", fmtInt(a.totalCfm),          "CFM", "var(--accent3)"),
      metricTile("Fan Motor Input",  fmt(fan.motorInputKw, 2),    "kW",  "var(--accent5)"),
      metricTile("Fan W/CFM",        fmt(fan.wPerCfm, 2), "≤ " + fan.ashrae90_1Limit,
                                                                   fanCompliant ? "var(--accent)" : "var(--accent4)"),
      metricTile("Diversified TR",   fmt(a.diversifiedTR, 1),     "TR",  "var(--accent2)")
    ].join("");

    const tdBase = 'padding:7px 10px;color:var(--text);font-family:var(--mono);border-bottom:1px solid var(--border);';
    const tdR = tdBase + 'text-align:right;';
    const thBase = 'padding:8px 10px;text-align:left;color:var(--text3);font-family:var(--mono);'
      + 'font-size:10px;letter-spacing:.10em;text-transform:uppercase;border-bottom:1px solid var(--border2);';
    const thR = thBase + 'text-align:right;';
    const tableBase = 'width:100%;border-collapse:collapse;font-size:12px;background:var(--bg3);'
      + 'border:1px solid var(--border);border-radius:8px;overflow:hidden;';

    const roomRows = (design.rooms || []).map(r =>
      '<tr>'
      + '<td style="' + tdBase + '">' + r.room + '</td>'
      + '<td style="' + tdR + '">' + fmtInt(r.roomLoad.sensibleW) + '</td>'
      + '<td style="' + tdR + '">' + fmtInt(r.roomLoad.latentW) + '</td>'
      + '<td style="' + tdR + '">' + fmtInt(r.roomLoad.totalW) + '</td>'
      + '<td style="' + tdR + '">' + fmt(r.roomLoad.shr, 2) + '</td>'
      + '<td style="' + tdR + '">' + fmtInt(r.supplyAir.cfm) + '</td>'
      + '<td style="' + tdR + '">' + fmt(r.designTR, 2) + '</td>'
      + '</tr>'
    ).join("");

    const compRows = ((design.rooms[0] && design.rooms[0].components) || []).map(c =>
      '<tr>'
      + '<td style="' + tdBase + '">' + c.kind + '</td>'
      + '<td style="' + tdR + '">' + fmtInt(c.sensibleW) + '</td>'
      + '<td style="' + tdR + '">' + fmtInt(c.latentW) + '</td>'
      + '</tr>'
    ).join("");

    const pumpBlock = pump
      ? '<div style="margin-top:12px;padding:10px 14px;background:var(--bg3);'
        + 'border:1px solid var(--border);border-left:3px solid var(--accent5);border-radius:8px;">'
        + '<div style="font-family:var(--mono);font-size:10px;color:var(--text3);'
        + 'letter-spacing:.08em;text-transform:uppercase;">Chilled-water pump</div>'
        + '<div style="font-family:var(--mono);font-size:12.5px;color:var(--text);margin-top:5px;">'
        + fmt(pump.flowLps, 1) + ' L/s · '
        + fmtInt(pump.flowGpm) + ' GPM · '
        + fmt(pump.headM, 1) + ' m head · '
        + fmt(pump.electricalKw, 2) + ' kW input</div></div>'
      : "";

    const narrativeBlock = (narrative && narrative.summary)
      ? '<div style="margin-top:14px;padding:12px 16px;background:rgba(0,144,255,0.08);'
        + 'border-left:3px solid var(--accent2);border-radius:6px;">'
        + '<div style="color:var(--accent2);font-size:11px;font-family:var(--mono);'
        + 'letter-spacing:.10em;text-transform:uppercase;">AI engineering narrative</div>'
        + '<p style="margin:6px 0 8px 0;font-size:13px;color:var(--text);line-height:1.55;">'
        + narrative.summary + '</p>'
        + (Array.isArray(narrative.design_decisions) && narrative.design_decisions.length
            ? '<div style="font-size:12px;color:var(--text2);"><strong style="color:var(--text);">Decisions:</strong>'
              + '<ul style="margin:4px 0 0 18px;color:var(--text);">'
              + narrative.design_decisions.map(function (d) { return '<li>' + d + '</li>'; }).join("")
              + '</ul></div>'
            : "")
        + (Array.isArray(narrative.risks) && narrative.risks.length
            ? '<div style="font-size:12px;color:var(--accent4);margin-top:6px;"><strong>Risks:</strong>'
              + '<ul style="margin:4px 0 0 18px;">'
              + narrative.risks.map(function (d) { return '<li>' + d + '</li>'; }).join("")
              + '</ul></div>'
            : "")
        + '</div>'
      : "";

    const sectionTitle = function (label) {
      return '<div style="margin:18px 0 8px 0;font-family:var(--mono);font-size:10.5px;'
        + 'letter-spacing:.16em;text-transform:uppercase;color:var(--text3);">' + label + '</div>';
    };

    return ''
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));'
      + 'gap:10px;margin-bottom:14px;">' + tiles + '</div>'

      + '<div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;">'
      + chip('System: ' + design.systemType, "")
      + chip('Diversity: ' + (a.diversityFactor || 1).toFixed(2), "")
      + chip('Fan: ' + (fanCompliant ? 'ASHRAE 90.1 ✓' : 'ASHRAE 90.1 ✗'), fanCompliant ? "ok" : "bad")
      + chip('Engine v' + (design.engineVersion || "?"), "")
      + '</div>'

      + sectionTitle('Room rollup')
      + '<div style="overflow-x:auto;"><table style="' + tableBase + '">'
      + '<thead><tr>'
      +   '<th style="' + thBase + '">Room</th>'
      +   '<th style="' + thR + '">Sens. W</th>'
      +   '<th style="' + thR + '">Lat. W</th>'
      +   '<th style="' + thR + '">Total W</th>'
      +   '<th style="' + thR + '">SHR</th>'
      +   '<th style="' + thR + '">CFM</th>'
      +   '<th style="' + thR + '">TR</th>'
      + '</tr></thead>'
      + '<tbody>' + roomRows + '</tbody></table></div>'

      + sectionTitle('Load components (first room)')
      + '<div style="overflow-x:auto;"><table style="' + tableBase + '">'
      + '<thead><tr>'
      +   '<th style="' + thBase + '">Component</th>'
      +   '<th style="' + thR + '">Sensible W</th>'
      +   '<th style="' + thR + '">Latent W</th>'
      + '</tr></thead>'
      + '<tbody>' + compRows + '</tbody></table></div>'

      + pumpBlock
      + narrativeBlock;
  }

  function renderVariants(payload) {
    const options = payload.options || [];
    if (!options.length) {
      return '<p style="color:var(--text3);">No variants returned.</p>';
    }
    const sectionTitle = '<div style="margin:0 0 8px 0;font-family:var(--mono);font-size:10.5px;'
      + 'letter-spacing:.16em;text-transform:uppercase;color:var(--text3);">Ranked alternatives (preferred → least)</div>';
    const cards = options.map(function (opt, i) {
      const borderColor = i === 0 ? 'var(--accent)' : 'var(--border2)';
      return '<div style="border:1px solid ' + borderColor + ';border-radius:10px;padding:14px;'
        + 'background:var(--bg3);' + (i === 0 ? 'box-shadow:0 0 0 1px rgba(0,201,167,0.18);' : '') + '">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;">'
        +   '<strong style="font-size:14px;color:var(--text);">' + opt.label + '</strong>'
        +   chip('Score ' + opt.score, i === 0 ? 'ok' : '')
        + '</div>'
        + '<div style="font-family:var(--mono);font-size:10.5px;color:var(--text3);'
        +   'letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;">'
        +   opt.design.systemType + '</div>'
        + '<div style="font-size:12.5px;color:var(--text2);line-height:1.8;font-family:var(--mono);">'
        +   '<div>Tonnage: <span style="color:var(--text);">' + fmt(opt.design.aggregate.selectedTR, 1) + ' TR</span></div>'
        +   '<div>Airflow: <span style="color:var(--text);">' + fmtInt(opt.design.aggregate.totalCfm) + ' CFM</span></div>'
        +   '<div>Fan kW: <span style="color:var(--text);">' + fmt(opt.design.fan.motorInputKw, 2) + '</span></div>'
        +   '<div>Fan W/CFM: <span style="color:var(--text);">' + fmt(opt.design.fan.wPerCfm, 2) + '</span> '
        +     chip(opt.design.fan.ashrae90_1Compliant ? '90.1 ✓' : '90.1 ✗',
                   opt.design.fan.ashrae90_1Compliant ? 'ok' : 'bad')
        +   '</div>'
        + '</div></div>';
    }).join("");
    return sectionTitle
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">'
      + cards + '</div>';
  }

  function renderAutofix(payload) {
    const ok = payload.success;
    const log = payload.log || [];
    const tdBase = 'padding:6px 10px;color:var(--text);font-family:var(--mono);'
      + 'border-bottom:1px solid var(--border);';
    const thBase = 'padding:8px 10px;text-align:left;color:var(--text3);font-family:var(--mono);'
      + 'font-size:10px;letter-spacing:.10em;text-transform:uppercase;border-bottom:1px solid var(--border2);';
    const logRows = log.map(function (step) {
      return '<tr>'
        + '<td style="' + tdBase + '">' + step.iter + '</td>'
        + '<td style="' + tdBase + '">' + ((step.fails || []).join(", ") || '<em style="color:var(--text3);">none</em>') + '</td>'
        + '<td style="' + tdBase + 'font-size:11px;">'
        + Object.entries(step.intent || {}).map(function (e) { return e[0] + '=' + e[1]; }).join("; ")
        + '</td></tr>';
    }).join("");
    return ''
      + '<div style="margin-bottom:8px;">'
      + (ok
          ? chip('Converged in ' + payload.iterations + ' iterations', 'ok')
          : chip('Did not converge in ' + payload.iterations + ' iterations', 'warn'))
      + '</div>'
      + renderDesign(payload.design, null)
      + '<div style="margin:18px 0 8px 0;font-family:var(--mono);font-size:10.5px;'
      + 'letter-spacing:.16em;text-transform:uppercase;color:var(--text3);">Auto-fix transcript</div>'
      + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;'
      + 'background:var(--bg3);border:1px solid var(--border);border-radius:8px;overflow:hidden;">'
      + '<thead><tr>'
      +   '<th style="' + thBase + '">Iter</th>'
      +   '<th style="' + thBase + '">Failing constraints</th>'
      +   '<th style="' + thBase + '">Intent applied</th>'
      + '</tr></thead>'
      + '<tbody>' + logRows + '</tbody></table></div>';
  }

  // -----------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------
  async function runFullDesign() {
    const { room, result } = getActiveRoomResult();
    if (!result) { setStatus("Run a room calculation first.", "error"); return; }
    setStatus("Generating full ASHRAE design…", "busy");
    try {
      const project = buildProjectFromRoom(room, result);
      const r = await window.ServerApi.generateFullDesign({ project: project });
      if (!r || !r.ok) throw new Error((r && r.error) || "Design API failed.");
      $("ai-engine-result").innerHTML = renderDesign(r.design, r.narrative);
      setStatus("Design ready · provider: " + r.provider + " · engine v" + r.engineVersion, "ok");
      window.__lastAshraeDesign = r;
    } catch (err) {
      setStatus(err.message || "Design failed.", "error");
      console.error("ashrae design", err);
    }
  }

  async function runVariants() {
    const { room, result } = getActiveRoomResult();
    if (!result) { setStatus("Run a room calculation first.", "error"); return; }
    setStatus("Building 3 alternatives…", "busy");
    try {
      const project = buildProjectFromRoom(room, result);
      const r = await window.ServerApi.generateDesignVariants({ project: project });
      if (!r || !r.ok) throw new Error((r && r.error) || "Variants API failed.");
      $("ai-engine-result").innerHTML = renderVariants(r.alternatives);
      setStatus(`Preferred option: ${r.alternatives.preferredKey} · engine v${r.engineVersion}`, "ok");
      window.__lastAshraeVariants = r;
    } catch (err) {
      setStatus(err.message || "Variants failed.", "error");
    }
  }

  async function runAutoFix() {
    const { room, result } = getActiveRoomResult();
    if (!result) { setStatus("Run a room calculation first.", "error"); return; }
    setStatus("Auto-fixing until ASHRAE 90.1 compliant…", "busy");
    try {
      const project = buildProjectFromRoom(room, result);
      const r = await window.ServerApi.autoFixDesign({
        project: project,
        constraints: { maxFanWPerCfm: 1.1, maxTROversizingPct: 15 }
      });
      if (!r || !r.ok) throw new Error((r && r.error) || "Auto-fix API failed.");
      $("ai-engine-result").innerHTML = renderAutofix(r);
      setStatus(r.success
        ? `Auto-fix converged in ${r.iterations} step(s).`
        : `Auto-fix could not converge (${r.iterations} steps). Best-effort design shown.`,
        r.success ? "ok" : "warn");
      window.__lastAshraeAutofix = r;
    } catch (err) {
      setStatus(err.message || "Auto-fix failed.", "error");
    }
  }

  // -----------------------------------------------------------------
  // Bind on DOMContentLoaded
  // -----------------------------------------------------------------
  function bind() {
    const b1 = $("btn-ai-full-design");
    const b2 = $("btn-ai-design-variants");
    const b3 = $("btn-ai-autofix");
    if (b1) b1.addEventListener("click", runFullDesign);
    if (b2) b2.addEventListener("click", runVariants);
    if (b3) b3.addEventListener("click", runAutoFix);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  // Expose for programmatic use (e.g., PDF report can call into it).
  window.AshraeDesignerUI = {
    runFullDesign: runFullDesign,
    runVariants: runVariants,
    runAutoFix: runAutoFix,
    buildProjectFromRoom: buildProjectFromRoom,
    renderDesign: renderDesign
  };
})();
