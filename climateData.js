(function () {
  const legacy = {
    filterCities: window.filterCities,
    liveSearchCities: window.liveSearchCities,
    selectCityByIdx: window.selectCityByIdx,
    applyCity: window.applyCity,
    fillCityData: window.fillCityData
  };

  let stations = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTemp(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—";
  }

  function flashField(element) {
    if (!element) {
      return;
    }
    element.style.transition = "border-color .2s, background .2s";
    element.style.borderColor = "var(--accent)";
    element.style.background = "rgba(0,201,167,0.07)";
    window.setTimeout(function () {
      element.style.borderColor = "";
      element.style.background = "";
    }, 1400);
  }

  function availableStations() {
    return stations.length ? stations : null;
  }

  function setCountPills(count, suffix) {
    const pillA = byId("city-count-pill");
    const pillB = byId("city-count-pill2");
    if (pillA) {
      pillA.textContent = count + " " + suffix;
    }
    if (pillB) {
      pillB.textContent = count + " " + suffix;
    }
  }

  function updateRegionOptions(list) {
    const regionSelect = byId("sel_region");
    if (!regionSelect) {
      return;
    }
    const selected = regionSelect.value;
    const regions = Array.from(new Set(list.map(function (station) {
      return station.region || "Global";
    }).filter(Boolean))).sort();

    regionSelect.innerHTML = '<option value="">— All Regions —</option>' + regions.map(function (region) {
      return '<option value="' + escapeHtml(region) + '">' + escapeHtml(region) + "</option>";
    }).join("");

    if (regions.indexOf(selected) !== -1) {
      regionSelect.value = selected;
    }
  }

  function filteredStations() {
    const list = availableStations();
    if (!list) {
      return null;
    }
    const region = (byId("sel_region") && byId("sel_region").value) || "";
    return region
      ? list.filter(function (station) { return station.region === region; })
      : list.slice();
  }

  function selectStation(station) {
    if (!station) {
      return;
    }
    const derivedRh = typeof window.rhFromWBT === "function"
      ? window.rhFromWBT(Number(station.dbt04), Number(station.wbt_c))
      : station.rh;
    const outdoorRh = Number.isFinite(Number(station.rh)) ? Number(station.rh) : derivedRh;
    const fields = {
      out_dbt: station.dbt04,
      out_wbt: station.wbt_c,
      out_rh: outdoorRh,
      out_mdr: station.mdr,
      out_lat: station.lat,
      out_elev: station.elev,
      out_heat_dbt: station.heat99,
      out_dehum_wbt: station.wbt04,
      climate_zone: station.zone,
      koppen: station.koppen
    };

    Object.keys(fields).forEach(function (id) {
      const element = byId(id);
      if (!element || fields[id] == null || fields[id] === "") {
        return;
      }
      element.value = fields[id];
      flashField(element);
    });

    const badge = byId("city-info-badge");
    if (badge) {
      badge.innerHTML =
        '<span class="status-dot ok" style="flex-shrink:0;"></span>'
        + '<span style="color:var(--accent);font-weight:500;">' + escapeHtml(station.city) + "</span>"
        + '<span style="color:var(--text3);margin-left:4px;">' + escapeHtml(station.region || "") + "</span>"
        + '<span style="color:var(--text3);margin-left:4px;">' + escapeHtml(station.sourceVersion || station.source || "ASHRAE") + "</span>";
    }

    window._selectedCity = station;
    window._selectedCityRH = outdoorRh;
  }

  function renderFilteredCities() {
    const list = filteredStations();
    if (!list) {
      if (typeof legacy.filterCities === "function") {
        legacy.filterCities();
      }
      return;
    }

    const citySelect = byId("sel_city");
    const badge = byId("city-info-badge");
    if (!citySelect) {
      return;
    }

    citySelect.disabled = false;
    citySelect.innerHTML = '<option value="">— Select City —</option>' + list.map(function (station) {
      const index = stations.indexOf(station);
      return '<option value="' + index + '" data-idx="' + index + '">' + escapeHtml(station.city) + "</option>";
    }).join("");

    setCountPills(list.length, "stations");
    if (badge) {
      badge.innerHTML = '<span style="color:var(--text3);">' + list.length + " stations in database</span>";
    }

    const search = byId("city_search");
    const dropdown = byId("city_dropdown");
    if (search) {
      search.value = "";
    }
    if (dropdown) {
      dropdown.style.display = "none";
    }
  }

  function liveSearch() {
    const list = availableStations();
    if (!list) {
      if (typeof legacy.liveSearchCities === "function") {
        legacy.liveSearchCities();
      }
      return;
    }

    const input = byId("city_search");
    const dropdown = byId("city_dropdown");
    if (!input || !dropdown) {
      return;
    }

    const query = input.value.trim().toLowerCase();
    if (query.length < 1) {
      dropdown.style.display = "none";
      return;
    }

    const matches = list.filter(function (station) {
      return (station.city || "").toLowerCase().indexOf(query) !== -1
        || (station.region || "").toLowerCase().indexOf(query) !== -1
        || (station.country || "").toLowerCase().indexOf(query) !== -1
        || (station.zone || "").toLowerCase().indexOf(query) !== -1;
    }).slice(0, 24);

    if (!matches.length) {
      dropdown.style.display = "none";
      return;
    }

    dropdown.innerHTML = matches.map(function (station) {
      const index = stations.indexOf(station);
      return '<div onclick="selectCityByIdx(' + index + ')" style="padding:9px 14px;cursor:pointer;font-family:var(--mono);font-size:12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;transition:background .1s;"'
        + ' onmouseover="this.style.background=\'rgba(0,201,167,0.06)\'" onmouseout="this.style.background=\'\'">'
        + '<span style="color:var(--text);">' + escapeHtml(station.city) + "</span>"
        + '<span style="color:var(--text3);font-size:10px;">' + escapeHtml(station.region || "") + " · " + formatTemp(station.dbt04) + "°C DBT · " + formatTemp(station.wbt_c) + "°C WBT</span>"
        + "</div>";
    }).join("");
    dropdown.style.display = "block";
  }

  function selectByIndex(index) {
    const list = availableStations();
    if (!list) {
      if (typeof legacy.selectCityByIdx === "function") {
        legacy.selectCityByIdx(index);
      }
      return;
    }

    const station = list[index];
    if (!station) {
      return;
    }

    const regionSelect = byId("sel_region");
    if (regionSelect) {
      regionSelect.value = station.region || "";
    }
    renderFilteredCities();

    const citySelect = byId("sel_city");
    if (citySelect) {
      citySelect.value = String(index);
    }

    const dropdown = byId("city_dropdown");
    const search = byId("city_search");
    if (dropdown) {
      dropdown.style.display = "none";
    }
    if (search) {
      search.value = "";
    }
    selectStation(station);
  }

  function applySelectedCity() {
    const list = availableStations();
    if (!list) {
      if (typeof legacy.applyCity === "function") {
        legacy.applyCity();
      }
      return;
    }

    const select = byId("sel_city");
    if (!select || !select.value) {
      return;
    }
    selectStation(list[parseInt(select.value, 10)]);
  }

  async function loadStationsFromServer() {
    if (!(window.ServerApi && await window.ServerApi.isAvailable())) {
      return false;
    }

    const response = await window.ServerApi.listClimateStations({ limit: 20000 });
    if (!(response && response.ok && Array.isArray(response.stations) && response.stations.length)) {
      return false;
    }

    stations = response.stations.slice();
    window.__climateStations = stations;
    updateRegionOptions(stations);
    renderFilteredCities();
    return true;
  }

  window.filterCities = renderFilteredCities;
  window.liveSearchCities = liveSearch;
  window.selectCityByIdx = selectByIndex;
  window.applyCity = applySelectedCity;
  window.fillCityData = selectStation;

  async function initializeClimateData() {
    try {
      const loaded = await loadStationsFromServer();
      if (!loaded) {
        return;
      }
      const searchLabel = byId("city-count-pill");
      if (searchLabel) {
        searchLabel.textContent = stations.length + " stations";
      }
    } catch (error) {
      console.warn("Climate data initialization failed", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initializeClimateData();
    });
  } else {
    initializeClimateData();
  }
}());
