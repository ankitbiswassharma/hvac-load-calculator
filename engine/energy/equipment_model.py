"""Part-load equipment models for simplified HVAC bin energy simulation."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict


CFM_TO_M3S = 0.00047194745
KW_PER_TR = 3.517


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


@dataclass(frozen=True)
class EquipmentDesign:
    """Design-point data for the conditioned air system."""

    peak_cooling_kw: float
    design_conditioned_airflow_cfm: float
    peak_conditioned_fan_kw: float
    min_ahu_airflow_ratio: float = 0.30
    chiller_cop_full_load: float = 3.5
    chiller_cop_half_load: float = 5.0

    @property
    def peak_tr(self) -> float:
        return self.peak_cooling_kw / KW_PER_TR if self.peak_cooling_kw > 0 else 0.0

    def as_dict(self) -> Dict[str, float]:
        payload = asdict(self)
        payload["peak_tr"] = self.peak_tr
        return payload


def fan_cube_law_power(peak_fan_kw: float, airflow_ratio: float, minimum_ratio: float = 0.30) -> float:
    """Fan part-load power using the cube law.

    Fan power varies with airflow cubed. The AHU is limited to a minimum
    controllable airflow fraction when it is in operation.
    """

    if airflow_ratio <= 0.0 or peak_fan_kw <= 0.0:
        return 0.0

    active_ratio = max(_clamp(airflow_ratio), minimum_ratio)
    return peak_fan_kw * (active_ratio ** 3)


def interpolate_chiller_cop(
    load_ratio: float,
    cop_full_load: float = 3.5,
    cop_half_load: float = 5.0,
) -> float:
    """Piecewise-linear COP curve with part-load improvement.

    Reference points:
    - 100% load -> COP 3.5
    - 50% load -> COP 5.0

    Below 50% load, the model keeps the COP benefit but avoids unrealistic
    runaway improvement by anchoring 30% load at a moderate value.
    """

    ratio = _clamp(load_ratio)
    if ratio <= 0.0:
        return 0.0

    low_load_ratio = 0.30
    low_load_cop = cop_half_load - 0.4

    if ratio <= 0.5:
        span = 0.5 - low_load_ratio
        if span <= 0:
            return cop_half_load
        limited_ratio = max(ratio, low_load_ratio)
        return low_load_cop + (limited_ratio - low_load_ratio) * (cop_half_load - low_load_cop) / span

    return cop_half_load + (ratio - 0.5) * (cop_full_load - cop_half_load) / 0.5


def calc_equipment_power(
    load_ratio: float,
    airflow: float,
    design: EquipmentDesign,
) -> Dict[str, float]:
    """Calculate conditioned-system power at a given bin.

    Returns chiller, fan, airflow ratio, and total conditioned-system power.
    """

    ratio = _clamp(load_ratio)
    requested_airflow_ratio = 0.0
    if design.design_conditioned_airflow_cfm > 0:
        requested_airflow_ratio = airflow / design.design_conditioned_airflow_cfm

    if ratio <= 0.0:
        active_airflow_ratio = 0.0
    else:
        active_airflow_ratio = max(_clamp(requested_airflow_ratio), design.min_ahu_airflow_ratio)

    cooling_load_kw = max(design.peak_cooling_kw, 0.0) * ratio
    cop = interpolate_chiller_cop(
        ratio,
        cop_full_load=design.chiller_cop_full_load,
        cop_half_load=design.chiller_cop_half_load,
    )
    chiller_power_kw = cooling_load_kw / cop if cop > 0 and cooling_load_kw > 0 else 0.0
    fan_power_kw = fan_cube_law_power(
        peak_fan_kw=design.peak_conditioned_fan_kw,
        airflow_ratio=active_airflow_ratio,
        minimum_ratio=design.min_ahu_airflow_ratio,
    )

    return {
        "load_ratio": ratio,
        "cooling_load_kw": cooling_load_kw,
        "requested_airflow_ratio": _clamp(requested_airflow_ratio),
        "active_airflow_ratio": active_airflow_ratio,
        "cop": cop,
        "chiller_power_kw": chiller_power_kw,
        "fan_power_kw": fan_power_kw,
        "total_conditioned_power_kw": chiller_power_kw + fan_power_kw,
    }


def calc_process_fan_energy(
    cfm: float,
    pressure_pa: float,
    fan_efficiency: float = 0.62,
    motor_efficiency: float = 0.92,
) -> float:
    """Process or make-up air fan power in kW.

    Fan shaft power basis:
    Q * delta_P / efficiency
    where Q is m³/s and delta_P is Pa.
    """

    airflow_m3s = max(cfm, 0.0) * CFM_TO_M3S
    total_efficiency = max(fan_efficiency * motor_efficiency, 0.05)
    return (airflow_m3s * max(pressure_pa, 0.0)) / (total_efficiency * 1000.0)
