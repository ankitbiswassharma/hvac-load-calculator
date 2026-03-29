"""Report helpers for the HVAC energy simulation module."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, Mapping

from .bin_data import sample_industrial_cooling_bins
from .cost_calc import calculate_energy_cost
from .energy_calc import EnergySimulationInput, calculate_annual_energy


def build_energy_report(
    bin_data: Iterable[Mapping[str, float]],
    system_data: EnergySimulationInput,
) -> Dict[str, object]:
    """Build the structured energy report requested by the platform."""

    report = calculate_annual_energy(bin_data, system_data)
    report["energy_cost"] = calculate_energy_cost(report["annual_energy_kwh"], system_data.tariff_per_kwh)
    return report


def compare_reports(option_a: Mapping[str, object], option_b: Mapping[str, object]) -> Dict[str, object]:
    """Compare two options and quantify energy and cost deltas."""

    energy_a = float(option_a.get("annual_energy_kwh", 0.0))
    energy_b = float(option_b.get("annual_energy_kwh", 0.0))
    cost_a = float(option_a.get("energy_cost", 0.0))
    cost_b = float(option_b.get("energy_cost", 0.0))

    energy_delta = energy_b - energy_a
    cost_delta = cost_b - cost_a
    energy_saving_pct = ((energy_a - energy_b) / energy_a * 100.0) if energy_a > 0 else 0.0

    return {
        "option_a": option_a.get("option_name", "Option A"),
        "option_b": option_b.get("option_name", "Option B"),
        "annual_energy_delta_kwh": energy_delta,
        "annual_cost_delta": cost_delta,
        "energy_saving_percent_vs_a": energy_saving_pct,
        "preferred_option": option_b.get("option_name", "Option B") if energy_b < energy_a else option_a.get("option_name", "Option A"),
    }


def export_report_json(report: Mapping[str, object], file_path: str | None = None) -> str:
    """Serialize the report to JSON and optionally persist it to disk."""

    payload = json.dumps(report, indent=2, sort_keys=True)
    if file_path:
        Path(file_path).write_text(payload, encoding="utf-8")
    return payload


def example_usage() -> Dict[str, object]:
    """Runnable example for integration tests, demos, and onboarding."""

    bins = sample_industrial_cooling_bins()
    system = EnergySimulationInput(
        option_name="Industrial AHU + Process Make-up Air",
        peak_load_kw=245.0,
        design_outdoor_temp_c=43.0,
        indoor_setpoint_c=24.0,
        conditioned_airflow_cfm=18500.0,
        process_airflow_cfm=62000.0,
        peak_conditioned_fan_kw=18.5,
        process_fan_static_pa=850.0,
        tariff_per_kwh=9.75,
        process_air_schedule_ratio=1.0,
        min_ahu_airflow_ratio=0.30,
        chiller_cop_full_load=3.5,
        chiller_cop_half_load=5.0,
        process_fan_efficiency=0.64,
        process_motor_efficiency=0.92,
    )
    return build_energy_report(bins, system)


if __name__ == "__main__":
    print(export_report_json(example_usage()))
