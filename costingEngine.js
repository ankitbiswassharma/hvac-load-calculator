(function () {
  function toNumber(value, fallback) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function ductSurfaceArea(room) {
    if (!room || !room.result) {
      return 0;
    }
    const zoneDuctPlan = room.result.zoneDuctPlan;
    if (zoneDuctPlan && Array.isArray(zoneDuctPlan.zones) && zoneDuctPlan.zones.length) {
      return zoneDuctPlan.zones.reduce(function (sum, zone) {
        const routeLengthM = (zone.ductLengthFt || 0) * 0.3048;
        const supplyDiameterM = (((zone.supply && zone.supply.trunkDuct && zone.supply.trunkDuct.dia_in) || 12) * 0.0254);
        const returnDiameterM = (((zone.return && zone.return.trunkDuct && zone.return.trunkDuct.dia_in) || 10) * 0.0254);
        const processDiameterM = (((zone.process && zone.process.trunkDuct && zone.process.trunkDuct.dia_in) || 0) * 0.0254);
        const supplyCount = (zone.supply && zone.supply.trunkCount) || 1;
        const returnCount = (zone.return && zone.return.trunkCount) || 1;
        const processCount = (zone.process && zone.process.trunkCount) || 0;
        const processDistributed = !!(zone.process && zone.process.distributed);
        const supplyArea = Math.PI * supplyDiameterM * routeLengthM * supplyCount;
        const returnArea = Math.PI * returnDiameterM * routeLengthM * returnCount;
        const processArea = (!processDistributed && processCount) ? Math.PI * processDiameterM * routeLengthM * processCount : 0;
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
    const supplyDiameterM = (supplyDuct.dia_in || 12) * 0.0254;
    const returnDiameterM = (returnDuct.dia_in || 10) * 0.0254;
    const supplyCount = (supplyStrategy && supplyStrategy.trunkCount) || 1;
    const returnCount = (returnStrategy && returnStrategy.trunkCount) || 1;
    const supplyArea = Math.PI * supplyDiameterM * (perimeter * 0.75) * supplyCount;
    const returnArea = Math.PI * returnDiameterM * (perimeter * 0.55) * returnCount;
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
      return sum + ((room.result.diffuserLayout && room.result.diffuserLayout.returns.count) || room.result.n_ret || 0);
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
      return Object.assign({}, item, {
        quantity: Number(item.quantity) || 0,
        amount: (Number(item.quantity) || 0) * (Number(item.rate) || 0)
      });
    });
  }

  function summarize(items, installationPercent) {
    const supplyTotal = items.reduce(function (sum, item) {
      return sum + item.amount;
    }, 0);
    const installationAmount = supplyTotal * installationPercent / 100;
    const grandTotal = supplyTotal + installationAmount;
    return {
      supplyTotal: supplyTotal,
      installationAmount: installationAmount,
      grandTotal: grandTotal,
      equipmentTotal: items.filter(function (item) { return item.category === "EQUIP"; }).reduce(function (sum, item) { return sum + item.amount; }, 0),
      ductTotal: items.filter(function (item) { return item.category === "DUCT"; }).reduce(function (sum, item) { return sum + item.amount; }, 0),
      diffuserTotal: items.filter(function (item) { return item.category === "DIFFUSER"; }).reduce(function (sum, item) { return sum + item.amount; }, 0)
    };
  }

  window.CostingEngine = {
    buildItems: buildItems,
    summarize: summarize
  };
}());
