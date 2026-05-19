(function () {
  const REGION_MULTIPLIERS = {
    standard: 1.0,
    metro: 1.12,
    north: 1.0,
    south: 1.03,
    west: 1.06,
    east: 0.98,
    tier2: 0.95,
    tier3: 0.90
  };

  const VENDOR_RANGE_FACTORS = {
    EQUIP: { low: 0.94, high: 1.12 },
    DUCT: { low: 0.92, high: 1.08 },
    DIFFUSER: { low: 0.90, high: 1.10 }
  };

  function toNumber(value, fallback) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function regionProfileFromProject(project) {
    const explicit = project && project.costingContext && project.costingContext.regionProfile
      ? String(project.costingContext.regionProfile).trim().toLowerCase()
      : "";
    if (REGION_MULTIPLIERS[explicit]) {
      return explicit;
    }
    const selectedCity = typeof window !== "undefined" && window._selectedCity ? window._selectedCity : null;
    const cityName = selectedCity && selectedCity.city ? String(selectedCity.city).toLowerCase() : "";
    if (/(mumbai|delhi|new delhi|bengaluru|bangalore|hyderabad|chennai|pune|kolkata|ahmedabad)/.test(cityName)) {
      return "metro";
    }
    return "standard";
  }

  function costingContext(project) {
    const profile = regionProfileFromProject(project);
    const manualMultiplier = project && project.costingContext && toNumber(project.costingContext.regionMultiplier, 0);
    const multiplier = manualMultiplier > 0 ? manualMultiplier : (REGION_MULTIPLIERS[profile] || 1);
    return {
      regionProfile: profile,
      regionMultiplier: multiplier
    };
  }

  function vendorRange(category) {
    return VENDOR_RANGE_FACTORS[category] || { low: 0.92, high: 1.10 };
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

  function ductSurfaceArea(room) {
    if (!room || !room.result) {
      return 0;
    }
    const zoneDuctPlan = room.result.zoneDuctPlan;
    if (zoneDuctPlan && Array.isArray(zoneDuctPlan.zones) && zoneDuctPlan.zones.length) {
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
    const length = toNumber(room.inputs.len, 10);
    const width = toNumber(room.inputs.wid, 8);
    const perimeter = 2 * (length + width);
    const supplyStrategy = room.result.ductStrategy && room.result.ductStrategy.supply;
    const returnStrategy = room.result.ductStrategy && room.result.ductStrategy.return;
    const supplyDuct = (supplyStrategy && supplyStrategy.trunkDuct) || room.result.main_duct || {};
    const returnDuct = (returnStrategy && returnStrategy.trunkDuct) || room.result.return_duct || {};
    const supplyPerimeterM = ductOuterPerimeterM(supplyDuct, 12);
    const returnPerimeterM = ductOuterPerimeterM(returnDuct, 10);
    const supplyCount = (supplyStrategy && supplyStrategy.trunkCount) || 1;
    const returnCount = (returnStrategy && returnStrategy.trunkCount) || 1;
    const supplyArea = supplyPerimeterM * (perimeter * 0.75) * supplyCount;
    const returnArea = returnPerimeterM * (perimeter * 0.55) * returnCount;
    return (supplyArea + returnArea) * 1.22;
  }

  function buildItems(project, ahuGroups, rates) {
    const rooms = (project.rooms || []).filter(function (room) {
      return room.result;
    });

    if (!rooms.length || !ahuGroups.length) {
      return [];
    }

    const totalDiffusers = rooms.reduce(function (sum, room) {
      return sum + ((room.result.diffuserLayout && room.result.diffuserLayout.diffuserCount) || room.result.n_sup || 0);
    }, 0);

    const totalReturns = rooms.reduce(function (sum, room) {
      return sum + ((room.result.diffuserLayout && room.result.diffuserLayout.returns && room.result.diffuserLayout.returns.count) || room.result.n_ret || 0);
    }, 0);

    const totalDuctArea = rooms.reduce(function (sum, room) {
      return sum + ductSurfaceArea(room);
    }, 0);

    const totalMotorKw = ahuGroups.reduce(function (sum, group) {
      return sum + group.selection.recommendedMotorKW;
    }, 0);

    const totalTR = ahuGroups.reduce(function (sum, group) {
      return sum + group.selection.ahu.capacityTR;
    }, 0);

    const costProfile = costingContext(project);
    const items = [];

    ahuGroups.forEach(function (group, index) {
      items.push({
        code: "1." + index,
        description: group.selection.ahu.model + " packaged AHU",
        quantity: group.selection.ahu.capacityTR,
        unit: "TR",
        rate: rates.rate_tr,
        category: "EQUIP"
      });
    });

    items.push(
      { code: "2.0", description: "GI sheet metal ducting", quantity: totalDuctArea, unit: "m2", rate: rates.rate_duct, category: "DUCT" },
      { code: "2.1", description: "Duct insulation", quantity: totalDuctArea, unit: "m2", rate: rates.rate_insul, category: "DUCT" },
      { code: "3.0", description: "Supply air diffusers", quantity: totalDiffusers, unit: "nos", rate: rates.rate_diffuser, category: "DIFFUSER" },
      { code: "3.1", description: "Return air grilles", quantity: totalReturns, unit: "nos", rate: rates.rate_return, category: "DIFFUSER" },
      { code: "4.0", description: "Fan and motor package", quantity: totalMotorKw, unit: "kW", rate: rates.rate_fan, category: "EQUIP" },
      { code: "4.1", description: "Piping and accessories", quantity: totalTR, unit: "TR", rate: rates.rate_pipe, category: "EQUIP" },
      { code: "4.2", description: "Controls and BMS", quantity: totalTR, unit: "TR", rate: rates.rate_bms, category: "EQUIP" }
    );

    return items.map(function (item) {
      const quantity = Number(item.quantity) || 0;
      const baseRate = Number(item.rate) || 0;
      const adjustedRate = baseRate * costProfile.regionMultiplier;
      const range = vendorRange(item.category);
      return Object.assign({}, item, {
        quantity: quantity,
        baseRate: baseRate,
        rate: adjustedRate,
        regionProfile: costProfile.regionProfile,
        regionMultiplier: costProfile.regionMultiplier,
        lowRate: adjustedRate * range.low,
        highRate: adjustedRate * range.high,
        amount: quantity * adjustedRate,
        lowAmount: quantity * adjustedRate * range.low,
        highAmount: quantity * adjustedRate * range.high
      });
    });
  }

  function summarize(items, installationPercent) {
    const supplyTotal = items.reduce(function (sum, item) {
      return sum + item.amount;
    }, 0);
    const lowSupplyTotal = items.reduce(function (sum, item) {
      return sum + (item.lowAmount || item.amount || 0);
    }, 0);
    const highSupplyTotal = items.reduce(function (sum, item) {
      return sum + (item.highAmount || item.amount || 0);
    }, 0);
    const installationAmount = supplyTotal * installationPercent / 100;
    const lowInstallationAmount = lowSupplyTotal * installationPercent / 100;
    const highInstallationAmount = highSupplyTotal * installationPercent / 100;
    const grandTotal = supplyTotal + installationAmount;
    const lowGrandTotal = lowSupplyTotal + lowInstallationAmount;
    const highGrandTotal = highSupplyTotal + highInstallationAmount;
    return {
      supplyTotal: supplyTotal,
      lowSupplyTotal: lowSupplyTotal,
      highSupplyTotal: highSupplyTotal,
      installationAmount: installationAmount,
      lowInstallationAmount: lowInstallationAmount,
      highInstallationAmount: highInstallationAmount,
      grandTotal: grandTotal,
      lowGrandTotal: lowGrandTotal,
      highGrandTotal: highGrandTotal,
      regionProfile: items[0] ? items[0].regionProfile : "standard",
      regionMultiplier: items[0] ? items[0].regionMultiplier : 1,
      equipmentTotal: items.filter(function (item) { return item.category === "EQUIP"; }).reduce(function (sum, item) { return sum + item.amount; }, 0),
      ductTotal: items.filter(function (item) { return item.category === "DUCT"; }).reduce(function (sum, item) { return sum + item.amount; }, 0),
      diffuserTotal: items.filter(function (item) { return item.category === "DIFFUSER"; }).reduce(function (sum, item) { return sum + item.amount; }, 0)
    };
  }

  const api = {
    buildItems: buildItems,
    summarize: summarize
  };
  if (typeof window !== "undefined") {
    window.CostingEngine = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
}());
