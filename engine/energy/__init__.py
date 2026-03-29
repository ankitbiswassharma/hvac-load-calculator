"""ASHRAE-style bin energy simulation package for the HVAC design platform."""

from .bin_data import TemperatureBin, normalize_bins, sample_industrial_cooling_bins
from .load_profile import calc_bin_load_kw, generate_load_profile
from .equipment_model import (
    EquipmentDesign,
    calc_equipment_power,
    calc_process_fan_energy,
    interpolate_chiller_cop,
)
from .energy_calc import EnergySimulationInput, calculate_annual_energy
from .cost_calc import calculate_energy_cost

__all__ = [
    "TemperatureBin",
    "normalize_bins",
    "sample_industrial_cooling_bins",
    "generate_load_profile",
    "calc_bin_load_kw",
    "EquipmentDesign",
    "calc_equipment_power",
    "calc_process_fan_energy",
    "interpolate_chiller_cop",
    "EnergySimulationInput",
    "calculate_annual_energy",
    "calculate_energy_cost",
    "build_energy_report",
    "compare_reports",
    "export_report_json",
]


def __getattr__(name):
    if name == "build_energy_report":
        from .report import build_energy_report

        return build_energy_report
    if name == "compare_reports":
        from .report import compare_reports

        return compare_reports
    if name == "export_report_json":
        from .report import export_report_json

        return export_report_json
    raise AttributeError(name)
