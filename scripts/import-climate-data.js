const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createPostgresStore } = require("../postgresStore");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--legacy-inline") {
      args.legacyInline = true;
      continue;
    }
    if (item.indexOf("--") !== 0) {
      continue;
    }
    const eq = item.indexOf("=");
    if (eq !== -1) {
      args[item.slice(2, eq)] = item.slice(eq + 1);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.indexOf("--") === 0) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function extractLegacyStations(htmlPath) {
  const text = fs.readFileSync(htmlPath, "utf8");
  const startMarker = "const ASHRAE_CITIES = [";
  const endMarker = "// ── LOOKUP TABLES ──";
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Unable to locate ASHRAE_CITIES array in contact copy 2.html");
  }

  const block = text.slice(start, end);
  const arrayStart = block.indexOf("[");
  const arrayEnd = block.lastIndexOf("];");
  if (arrayStart === -1 || arrayEnd === -1) {
    throw new Error("Unable to parse ASHRAE_CITIES array literal.");
  }

  const arrayLiteral = block.slice(arrayStart, arrayEnd + 1);
  const stations = vm.runInNewContext(arrayLiteral, {});
  if (!Array.isArray(stations)) {
    throw new Error("Legacy ASHRAE city table did not evaluate to an array.");
  }
  return stations;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      value = "";
      if (row.some(function (cell) { return String(cell).trim() !== ""; })) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    value += char;
  }

  if (value || row.length) {
    row.push(value);
    if (row.some(function (cell) { return String(cell).trim() !== ""; })) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows.shift().map(function (header) {
    return String(header || "").trim();
  });
  return rows.map(function (cells) {
    const record = {};
    headers.forEach(function (header, index) {
      record[header] = cells[index] == null ? "" : cells[index];
    });
    return record;
  });
}

function loadFileRecords(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const text = fs.readFileSync(filePath, "utf8");
  if (ext === ".json") {
    const payload = JSON.parse(text);
    return Array.isArray(payload) ? payload : (Array.isArray(payload.stations) ? payload.stations : []);
  }
  if (ext === ".csv") {
    return parseCsv(text);
  }
  throw new Error("Unsupported climate data file format. Use JSON or CSV.");
}

function firstValue(record, aliases) {
  for (const alias of aliases) {
    if (record[alias] != null && String(record[alias]).trim() !== "") {
      return record[alias];
    }
  }
  return "";
}

function toNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedStation(record, defaults) {
  const source = String((record.source || defaults.source || "ashrae")).trim();
  const sourceVersion = String((record.sourceVersion || defaults.sourceVersion || "")).trim();
  const region = String(firstValue(record, ["region", "continent", "world_region"]) || "").trim();
  const city = String(firstValue(record, ["city", "location", "station", "station_name"]) || "").trim();
  const country = String(firstValue(record, ["country", "nation"]) || "").trim();
  const stationKey = String(record.stationKey || [source, sourceVersion || "default", region || "global", city || "station", country || ""].join("|")).trim().toLowerCase();

  return {
    stationKey: stationKey,
    source: source,
    sourceVersion: sourceVersion,
    region: region,
    city: city,
    country: country,
    wmoCode: String(firstValue(record, ["wmoCode", "wmo", "wmo_code", "station_id"]) || "").trim(),
    lat: toNumber(firstValue(record, ["lat", "latitude"])),
    lon: toNumber(firstValue(record, ["lon", "lng", "longitude"])),
    elev: toNumber(firstValue(record, ["elev", "elevation", "elevation_m"])),
    zone: String(firstValue(record, ["zone", "climate_zone", "ashrae_zone"]) || "").trim(),
    koppen: String(firstValue(record, ["koppen", "koppen_zone"]) || "").trim(),
    dbt04: toNumber(firstValue(record, ["dbt04", "dbt_04_c", "cooling_dbt_0_4_c", "dry_bulb_0_4_c"])),
    wbt_c: toNumber(firstValue(record, ["wbt_c", "wbt_coincident", "wbt_mc_c", "mean_coincident_wb_0_4_c", "coincident_wb_c"])),
    wbt04: toNumber(firstValue(record, ["wbt04", "wbt_04_c", "dehumid_wbt_0_4_c", "wet_bulb_0_4_c"])),
    mdr: toNumber(firstValue(record, ["mdr", "mean_daily_range_c", "daily_range_c"])),
    heat99: toNumber(firstValue(record, ["heat99", "heating_99_6_c", "db_99_6_c"])),
    rh: toNumber(firstValue(record, ["rh", "rh_percent", "outdoor_rh"])),
    metadata: Object.assign({}, record.metadata || {})
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = String(args.source || (args.legacyInline ? "ashrae-legacy-inline" : "ashrae")).trim();
  const sourceVersion = String(args.version || (args.legacyInline ? "inline-230" : "")).trim();
  const replaceSource = args.replace === true || String(args.replace || "").toLowerCase() === "true";

  let records;
  if (args.legacyInline) {
    records = extractLegacyStations(path.join(__dirname, "..", "contact copy 2.html"));
  } else if (args.file) {
    records = loadFileRecords(path.resolve(process.cwd(), String(args.file)));
  } else {
    throw new Error("Provide either --legacy-inline or --file /path/to/climate-data.(json|csv)");
  }

  const stations = records.map(function (record) {
    return normalizedStation(record, {
      source: source,
      sourceVersion: sourceVersion
    });
  }).filter(function (station) {
    return station.city;
  });

  const store = createPostgresStore();
  try {
    const result = await store.importClimateStations(stations, {
      source: source,
      sourceVersion: sourceVersion,
      replaceSource: replaceSource
    });
    const stats = await store.climateStationStats();
    console.log("Imported climate stations:", result.imported);
    console.log("Climate station total:", stats.total);
    console.log("Sources:", stats.sources.map(function (item) {
      return item.source + (item.sourceVersion ? "@" + item.sourceVersion : "") + "=" + item.count;
    }).join(", "));
  } finally {
    await store.close();
  }
}

main().catch(function (error) {
  console.error(error.message || error);
  process.exit(1);
});
