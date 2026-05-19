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
    const inputs = (result && result.inputs) || {};
    const area = Number(inputs.area || result.area || 25);
    const height = Number(inputs.height || result.ceilingHeight || 3.0);

    // Climate — use whatever is in the inputs; fall back to Mumbai design day.
    const climate = {
      latitudeDeg:      Number(inputs.latitude || 19.0),
      longitudeDeg:     Number(inputs.longitude || 72.8),
      stdMeridianDeg:   Number(inputs.std_meridian_deg || 82.5),
      designOutdoorDbC: Number(inputs.outdoor_db || 35),
      designOutdoorWbC: Number(inputs.outdoor_wb || 28),
      designDayOfYear:  Number(inputs.design_day_of_year || 172),
      designClockHour:  Number(inputs.design_clock_hour || 15),
      elevationM:       Number(inputs.elevation_m || 14)
    };

    // Walls — if the form has per-orientation areas, use them; otherwise
    // distribute envelope evenly across S and W (worst-case exposure).
    const perimeter = 2 * (Math.sqrt(area) + Math.sqrt(area));
    const wallArea = perimeter * height;
    const walls = [
      { area: wallArea * 0.5, U: Number(inputs.u_wall || 0.5), orientation: "S", alpha: 0.6 },
      { area: wallArea * 0.5, U: Number(inputs.u_wall || 0.5), orientation: "W", alpha: 0.6 }
    ];

    const project = {
      name: (room && room.name) || "Active room",
      climate: climate,
      rooms: [{
        name: (room && room.name) || "Room 1",
        areaM2: area, ceilingHeightM: height,
        occupants: Number(inputs.occupants || result.occupants || 4),
        activity: inputs.activity_level || "seated_office",
        lpd: Number(inputs.lpd_w_per_m2 || 10),
        epd: Number(inputs.epd_w_per_m2 || 12),
        equipmentUsage: Number(inputs.equipment_usage || 0.7),
        walls: walls,
        roof: inputs.is_top_floor !== false
          ? { area: area, U: Number(inputs.u_roof || 0.3), alpha: 0.85, dR: 63 }
          : null,
        windows: inputs.window_area_m2 ? [{
          area: Number(inputs.window_area_m2),
          U: Number(inputs.u_window || 2.8),
          shgcN: Number(inputs.shgc || 0.4),
          orientation: inputs.window_orientation || "S"
        }] : [],
        infiltrationAch: Number(inputs.infiltration_ach || result.infiltrationAch || 0.4),
        ventilationCfmPerPerson: Number(inputs.vent_cfm_per_person || 5),
        ventilationCfmPerM2: Number(inputs.vent_cfm_per_m2 || 0.6),
        supplyTempC: Number(inputs.supply_temp_c || 13),
        setpointC: Number(inputs.indoor_db || 24),
        setpointRhPct: Number(inputs.indoor_rh || 50),
        safetyFactor: Number(inputs.safety_factor || 1.10)
      }],
      designIntent: {
        systemType:      inputs.system_type || "vrf",
        fanEfficiency:   Number(inputs.fan_efficiency || 0.65),
        motorEfficiency: 0.92,
        externalSpPa:    Number(inputs.total_esp_pa || 500),
        diversityFactor: 1.0
      }
    };
    return project;
  }

  // -----------------------------------------------------------------
  // Renderers
  // -----------------------------------------------------------------
  function chip(text, tone) {
    const bg = tone === "ok" ? "#dcfce7" : tone === "warn" ? "#fef3c7" : tone === "bad" ? "#fee2e2" : "#e0e7ff";
    const fg = tone === "ok" ? "#166534" : tone === "warn" ? "#92400e" : tone === "bad" ? "#991b1b" : "#3730a3";
    return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-family:var(--mono);font-size:11px;background:${bg};color:${fg};font-weight:600;">${text}</span>`;
  }

  function metricTile(label, value, unit, accent) {
    const color = accent || "#3b82f6";
    return `<div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:8px;padding:10px 14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:#64748b;text-transform:uppercase;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:2px;">${value}<span style="font-size:13px;font-weight:500;color:#64748b;margin-left:4px;">${unit || ""}</span></div>
    </div>`;
  }

  function renderDesign(design, narrative) {
    const a = design.aggregate || {};
    const fan = design.fan || {};
    const pump = design.pump;
    const fanCompliant = fan.ashrae90_1Compliant === true;
    const tiles = [
      metricTile("Total Cooling", fmt(a.totalLoadW / 1000, 1), "kW", "#3b82f6"),
      metricTile("Selected Tonnage", fmt(a.selectedTR, 1), "TR", "#22c55e"),
      metricTile("Total Supply Air", fmtInt(a.totalCfm), "CFM", "#f59e0b"),
      metricTile("Fan Motor Input", fmt(fan.motorInputKw, 2), "kW", "#a855f7"),
      metricTile("Fan W/CFM", fmt(fan.wPerCfm, 2), `≤ ${fan.ashrae90_1Limit}`, fanCompliant ? "#22c55e" : "#ef4444"),
      metricTile("Diversified TR", fmt(a.diversifiedTR, 1), "TR", "#0ea5e9")
    ].join("");

    const roomRows = (design.rooms || []).map(r =>
      `<tr>
        <td style="padding:6px 8px;">${r.room}</td>
        <td style="padding:6px 8px;text-align:right;">${fmtInt(r.roomLoad.sensibleW)}</td>
        <td style="padding:6px 8px;text-align:right;">${fmtInt(r.roomLoad.latentW)}</td>
        <td style="padding:6px 8px;text-align:right;">${fmtInt(r.roomLoad.totalW)}</td>
        <td style="padding:6px 8px;text-align:right;">${fmt(r.roomLoad.shr, 2)}</td>
        <td style="padding:6px 8px;text-align:right;">${fmtInt(r.supplyAir.cfm)}</td>
        <td style="padding:6px 8px;text-align:right;">${fmt(r.designTR, 2)}</td>
      </tr>`
    ).join("");

    const compRows = ((design.rooms[0] && design.rooms[0].components) || []).map(c =>
      `<tr>
        <td style="padding:4px 8px;">${c.kind}</td>
        <td style="padding:4px 8px;text-align:right;">${fmtInt(c.sensibleW)}</td>
        <td style="padding:4px 8px;text-align:right;">${fmtInt(c.latentW)}</td>
      </tr>`
    ).join("");

    const pumpBlock = pump ? `
      <div style="margin-top:12px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <strong style="font-size:13px;color:#0f172a;">Chilled-water pump</strong>
        <div style="font-family:var(--mono);font-size:12px;color:#475569;margin-top:4px;">
          ${fmt(pump.flowLps, 1)} L/s · ${fmtInt(pump.flowGpm)} GPM · ${fmt(pump.headM, 1)} m head · ${fmt(pump.electricalKw, 2)} kW input
        </div>
      </div>` : "";

    const narrativeBlock = narrative && narrative.summary ? `
      <div style="margin-top:14px;padding:12px 16px;background:#eff6ff;border-left:4px solid #3b82f6;border-radius:6px;">
        <strong style="color:#1e40af;font-size:13px;">AI engineering narrative</strong>
        <p style="margin:6px 0 8px 0;font-size:13px;color:#1f2937;line-height:1.5;">${narrative.summary}</p>
        ${Array.isArray(narrative.design_decisions) && narrative.design_decisions.length ?
          `<div style="font-size:12px;color:#1e3a8a;"><strong>Decisions:</strong><ul style="margin:4px 0 0 18px;">${narrative.design_decisions.map(d=>`<li>${d}</li>`).join("")}</ul></div>` : ""}
        ${Array.isArray(narrative.risks) && narrative.risks.length ?
          `<div style="font-size:12px;color:#b91c1c;margin-top:6px;"><strong>Risks:</strong><ul style="margin:4px 0 0 18px;">${narrative.risks.map(d=>`<li>${d}</li>`).join("")}</ul></div>` : ""}
      </div>` : "";

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;">${tiles}</div>

      <div style="margin-bottom:10px;">
        ${chip(`System: ${design.systemType}`, "")}
        ${chip(`Diversity: ${(a.diversityFactor||1).toFixed(2)}`, "")}
        ${chip(`Fan: ${fanCompliant ? "ASHRAE 90.1 ✓" : "ASHRAE 90.1 ✗"}`, fanCompliant ? "ok" : "bad")}
        ${chip(`Engine v${design.engineVersion || "?"}`, "")}
      </div>

      <h4 style="margin:14px 0 6px 0;font-size:13px;color:#0f172a;">Room rollup</h4>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;">
        <thead style="background:#f1f5f9;">
          <tr>
            <th style="padding:8px;text-align:left;">Room</th>
            <th style="padding:8px;text-align:right;">Sens. W</th>
            <th style="padding:8px;text-align:right;">Lat. W</th>
            <th style="padding:8px;text-align:right;">Total W</th>
            <th style="padding:8px;text-align:right;">SHR</th>
            <th style="padding:8px;text-align:right;">CFM</th>
            <th style="padding:8px;text-align:right;">TR</th>
          </tr>
        </thead><tbody>${roomRows}</tbody></table></div>

      <h4 style="margin:14px 0 6px 0;font-size:13px;color:#0f172a;">Load components (first room)</h4>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;">
        <thead style="background:#f1f5f9;"><tr><th style="padding:6px 8px;text-align:left;">Component</th><th style="padding:6px 8px;text-align:right;">Sensible W</th><th style="padding:6px 8px;text-align:right;">Latent W</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table></div>

      ${pumpBlock}
      ${narrativeBlock}
    `;
  }

  function renderVariants(payload) {
    const options = payload.options || [];
    if (!options.length) {
      return `<p style="color:var(--text3);">No variants returned.</p>`;
    }
    return `
      <h4 style="margin:0 0 8px 0;font-size:13px;color:#0f172a;">Ranked alternatives (preferred → least)</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">
        ${options.map((opt, i) => `
          <div style="border:2px solid ${i===0 ? "#22c55e" : "#e2e8f0"};border-radius:10px;padding:12px;background:#fff;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong style="font-size:14px;color:#0f172a;">${opt.label}</strong>
              ${chip(`Score ${opt.score}`, i===0 ? "ok" : "")}
            </div>
            <div style="font-family:var(--mono);font-size:11px;color:#64748b;margin-bottom:8px;">${opt.design.systemType}</div>
            <div style="font-size:12px;color:#334155;line-height:1.7;">
              <div>Tonnage: <strong>${fmt(opt.design.aggregate.selectedTR,1)} TR</strong></div>
              <div>Airflow: <strong>${fmtInt(opt.design.aggregate.totalCfm)} CFM</strong></div>
              <div>Fan kW: <strong>${fmt(opt.design.fan.motorInputKw,2)}</strong></div>
              <div>Fan W/CFM: <strong>${fmt(opt.design.fan.wPerCfm,2)}</strong>
                ${chip(opt.design.fan.ashrae90_1Compliant ? "90.1 ✓" : "90.1 ✗", opt.design.fan.ashrae90_1Compliant ? "ok" : "bad")}</div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderAutofix(payload) {
    const ok = payload.success;
    const log = payload.log || [];
    const logRows = log.map(step =>
      `<tr>
        <td style="padding:4px 8px;">${step.iter}</td>
        <td style="padding:4px 8px;">${(step.fails || []).join(", ") || "<em>none</em>"}</td>
        <td style="padding:4px 8px;font-family:var(--mono);font-size:11px;">${Object.entries(step.intent || {}).map(([k,v])=>`${k}=${v}`).join("; ")}</td>
      </tr>`
    ).join("");
    return `
      <div style="margin-bottom:8px;">
        ${ok ? chip(`Converged in ${payload.iterations} iterations`, "ok")
             : chip(`Did not converge in ${payload.iterations} iterations`, "warn")}
      </div>
      ${renderDesign(payload.design, null)}
      <h4 style="margin:14px 0 6px 0;font-size:13px;color:#0f172a;">Auto-fix transcript</h4>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;">
        <thead style="background:#f1f5f9;"><tr><th style="padding:6px 8px;text-align:left;">Iter</th><th style="padding:6px 8px;text-align:left;">Failing constraints</th><th style="padding:6px 8px;text-align:left;">Intent applied</th></tr></thead>
        <tbody>${logRows}</tbody>
      </table></div>
    `;
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
