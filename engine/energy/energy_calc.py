"""Annual bin energy calculation engine for HVAC systems."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, Iterable, List

from .bin_data import TemperatureBin, normalize_bins
from .equipment_model import EquipmentDesign, calc_equipment_power, calc_process_fan_energy
from .load_profile import calc_bin_load_kw, generate_load_profile


KW_PER_TR = 3.517


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


@dataclass(frozen=True)
class EnergySimulationInput:
    """Top-level system data required for annual bin simulation."""

    peak_load_kw: float
    design_outdoor_temp_c: float
    indoor_setpoint_c: float
    conditioned_airflow_cfm: float
    process_airflow_cfm: float
    peak_conditioned_fan_kw: float
    process_fan_static_pa: float
    tariff_per_kwh: float = 0.0
    process_air_schedule_ratio: float = 1.0
    min_ahu_airflow_ratio: float = 0.30
    chiller_cop_full_load: float = 3.5
    chiller_cop_half_load: float = 5.0
    process_fan_efficiency: float = 0.62
    process_motor_efficiency: float = 0.92
    option_name: str = "Base Option"

    def conditioned_equipment(self) -> EquipmentDesign:
        return EquipmentDesign(
            peak_cooling_kw=self.peak_load_kw,
            design_conditioned_airflow_cfm=self.conditioned_airflow_cfm,
            peak_conditioned_fan_kw=self.peak_conditioned_fan_kw,
            min_ahu_airflow_ratio=self.min_ahu_airflow_ratio,
            chiller_cop_full_load=self.chiller_cop_full_load,
            chiller_cop_half_load=self.chiller_cop_half_load,
        )

    @property
    def peak_tr(self) -> float:
        return self.peak_load_kw / KW_PER_TR if self.peak_load_kw > 0 else 0.0

    def as_dict(self) -> Dict[str, float]:
        payload = asdict(self)
        payload["peak_tr"] = self.peak_tr
        return payload


def _build_warnings(sim_input: EnergySimulationInput, annual_process_energy: float, annual_total_energy: float) -> List[str]:
    warnings: List[str] = []
    if sim_input.process_airflow_cfm > sim_input.conditioned_airflow_cfm * 5.0:
        warnings.append("Process air exceeds 5x conditioned cooling airflow; ventilation/process strategy dominates system energy.")

    if sim_input.peak_tr > 0:
        conditioned_fan_kw_per_tr = sim_input.peak_conditioned_fan_kw / sim_input.peak_tr
        if conditioned_fan_kw_per_tr > 1.15:
            warnings.append("Conditioned fan specific power exceeds 1.15 kW/TR; review SFP, static pressure, and fan tuning.")

    if annual_total_energy > 0 and annual_process_energy / annual_total_energy > 0.45:
        warnings.append("Process air energy is a major annual driver; consider heat recovery, staging, or production-linked fan control.")

    return warnings


def calculate_annual_energy(
    bin_data: Iterable[TemperatureBin | Dict[str, float]],
    system_data: EnergySimulationInput,
) -> Dict[str, object]:
    """Run the annual energy simulation using the ASHRAE-style bin method."""

    bins = normalize_bins(bin_data)
    design = system_data.conditioned_equipment()
    graph_data: List[Dict[str, float]] = []

    annual_cooling_energy = 0.0
    annual_conditioned_fan_energy = 0.0
    annual_process_energy = 0.0
    peak_power_kw = 0.0

    process_fan_power_kw = calc_process_fan_energy(
        cfm=system_data.process_airflow_cfm * _clamp(system_data.process_air_schedule_ratio),
        pressure_pa=system_data.process_fan_static_pa,
        fan_efficiency=system_data.process_fan_efficiency,
        motor_efficiency=system_data.process_motor_efficiency,
    )

    for temp_bin in bins:
        load_ratio = generate_load_profile(
            peak_load_kw=system_data.peak_load_kw,
            outdoor_temp=temp_bin.dry_bulb_c,
            design_temp=system_data.design_outdoor_temp_c,
            indoor_setpoint=system_data.indoor_setpoint_c,
        )
        load_ratio = _clamp(load_ratio)
        bin_load_kw = calc_bin_load_kw(
            peak_load_kw=system_data.peak_load_kw,
            outdoor_temp=temp_bin.dry_bulb_c,
            design_temp=system_data.design_outdoor_temp_c,
            indoor_setpoint=system_data.indoor_setpoint_c,
        )
        requested_conditioned_airflow_cfm = system_data.conditioned_airflow_cfm * load_ratio
        equipment = calc_equipment_power(
            load_ratio=load_ratio,
            airflow=requested_conditioned_airflow_cfm,
            design=design,
        )

        cooling_energy_kwh = equipment["chiller_power_kw"] * temp_bin.hours
        fan_energy_kwh = equipment["fan_power_kw"] * temp_bin.hours
        process_energy_kwh = process_fan_power_kw * temp_bin.hours
        total_power_kw = equipment["total_conditioned_power_kw"] + process_fan_power_kw
        total_energy_kwh = cooling_energy_kwh + fan_energy_kwh + process_energy_kwh

        annual_cooling_energy += cooling_energy_kwh
        annual_conditioned_fan_energy += fan_energy_kwh
        annual_process_energy += process_energy_kwh
        peak_power_kw = max(peak_power_kw, total_power_kw)

        graph_data.append(
            {
                "bin_temp_c": temp_bin.dry_bulb_c,
                "bin_hours": temp_bin.hours,
                "load_ratio": load_ratio,
                "bin_load_kw": bin_load_kw,
                "cooling_power_kw": equipment["chiller_power_kw"],
                "conditioned_fan_power_kw": equipment["fan_power_kw"],
                "process_fan_power_kw": process_fan_power_kw,
                "total_power_kw": total_power_kw,
                "bin_total_energy_kwh": total_energy_kwh,
            }
        )

    annual_total_energy = annual_cooling_energy + annual_conditioned_fan_energy + annual_process_energy
    system_efficiency_kw_per_tr = peak_power_kw / system_data.peak_tr if system_data.peak_tr > 0 else 0.0
    warnings = _build_warnings(
        sim_input=system_data,
        annual_process_energy=annual_process_energy,
        annual_total_energy=annual_total_energy,
    )

    return {
        "option_name": system_data.option_name,
        "annual_energy_kwh": annual_total_energy,
        "cooling_energy": annual_cooling_energy,
        "fan_energy": annual_conditioned_fan_energy,
        "process_energy": annual_process_energy,
        "peak_power_kw": peak_power_kw,
        "energy_cost": annual_total_energy * max(system_data.tariff_per_kwh, 0.0),
        "system_efficiency": system_efficiency_kw_per_tr,
        "peak_tr": system_data.peak_tr,
        "process_to_conditioned_air_ratio": (
            system_data.process_airflow_cfm / system_data.conditioned_airflow_cfm
            if system_data.conditioned_airflow_cfm > 0
            else 0.0
        ),
        "graph_data": graph_data,
        "warnings": warnings,
        "bin_count": len(bins),
        "system_input": system_data.as_dict(),
        "equipment_design": design.as_dict(),
        "future_hourly_hook": {
            "status": "ready",
            "note": "Replace bin weather input with hourly weather + schedule arrays without changing the equipment model contract.",
        },
    }
