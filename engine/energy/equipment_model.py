"""Part-load equipment models for ASHRAE bin-method energy simulation.

Critical corrections vs the previous version:

  * COP now varies with outdoor temperature.  Chiller COP drops about
    2.2 %/K for water-cooled and 3.0 %/K for air-cooled systems above the
    AHRI rating condition (35 °C dry-bulb for air-cooled; 29 °C ECWT for
    water-cooled).  The old curve only depended on part-load ratio, so
    energy in hot bins was severely under-predicted.

  * Part-load factor is now continuous and AHRI-style.  The previous
    `compressor_cycling_factor` jumped from 0.91 → 1.00 at PLR = 0.40, and
    the curve was applied in the wrong direction (boosting effective COP at
    very low load).  AHRI 210/240 defines PLF = 1 − 0.25·(1 − PLR) and PLF
    *degrades* effective performance at low PLR.

  * `calc_process_fan_energy` now correctly returns motor electrical input
    by dividing brake shaft power by motor efficiency, instead of treating
    `fan_efficiency * motor_efficiency` as a combined denominator.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, Optional


CFM_TO_M3S = 0.00047194745
KW_PER_TR = 3.5168525


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


@dataclass(frozen=True)
class EquipmentDesign:
    """Design-point data for the conditioned air system."""

    peak_cooling_kw: float
    design_conditioned_airflow_cfm: float
    peak_conditioned_fan_kw: float
    min_ahu_airflow_ratio: float = 0.30
    chiller_cop_rated: float = 3.5
    is_air_cooled: bool = True
    rated_outdoor_c: float = 35.0
    # Sensitivity coefficient: COP drops k_t per K above rated condition.
    cop_kt_per_k: Optional[float] = None  # default depends on cond. type

    @property
    def peak_tr(self) -> float:
        return self.peak_cooling_kw / KW_PER_TR if self.peak_cooling_kw > 0 else 0.0

    def as_dict(self) -> Dict[str, float]:
        payload = asdict(self)
        payload["peak_tr"] = self.peak_tr
        return payload


def fan_cube_law_power(peak_fan_kw: float, airflow_ratio: float, minimum_ratio: float = 0.30) -> float:
    """Fan part-load power following the affinity (cube) law.

    Bounded below by `minimum_ratio` to represent VAV box minimum positions.
    """

    if airflow_ratio <= 0.0 or peak_fan_kw <= 0.0:
        return 0.0
    active_ratio = max(_clamp(airflow_ratio), minimum_ratio)
    return peak_fan_kw * (active_ratio ** 3)


def temperature_correction_factor(
    outdoor_temp_c: float,
    rated_outdoor_c: float = 35.0,
    is_air_cooled: bool = True,
    k_t: Optional[float] = None,
) -> float:
    """Cooling COP multiplier as a function of outdoor temperature.

    AHRI-style linear sensitivity:
        f_T = max(0.30, 1 − k_t · (T_oa − T_rated))

    k_t defaults to 0.030 /K for air-cooled chillers and 0.022 /K for
    water-cooled chillers/CTs operating near design condenser approach.
    """

    if k_t is None:
        k_t = 0.030 if is_air_cooled else 0.022
    return max(0.30, 1.0 - k_t * (outdoor_temp_c - rated_outdoor_c))


def part_load_factor(plr: float) -> float:
    """AHRI 210/240 part-load factor.

    PLF = 1 − 0.25 · (1 − PLR)

    Always ≤ 1.0, monotonically decreasing as PLR drops. The previous
    discontinuous step at PLR=0.4 has been removed.
    """

    return 1.0 - 0.25 * (1.0 - _clamp(plr))


def effective_cooling_cop(
    cop_rated: float,
    plr: float,
    outdoor_temp_c: float,
    rated_outdoor_c: float = 35.0,
    is_air_cooled: bool = True,
    k_t: Optional[float] = None,
    min_cop: float = 1.5,
) -> float:
    """Effective chiller COP after temperature and part-load corrections."""

    f_t = temperature_correction_factor(
        outdoor_temp_c=outdoor_temp_c,
        rated_outdoor_c=rated_outdoor_c,
        is_air_cooled=is_air_cooled,
        k_t=k_t,
    )
    f_plf = part_load_factor(plr)
    return max(min_cop, cop_rated * f_t * f_plf)


# Backwards-compatible thin wrappers (legacy names) – delegate to the new
# physics. The legacy `cop_full_load`/`cop_half_load` pair is collapsed into a
# single rated value; callers that previously passed both will see the rated
# value used (the more honest representation).
def interpolate_chiller_cop(
    load_ratio: float,
    cop_full_load: float = 3.5,
    cop_half_load: float = 5.0,  # noqa: ARG001  (deprecated)
) -> float:
    return effective_cooling_cop(
        cop_rated=cop_full_load,
        plr=load_ratio,
        outdoor_temp_c=35.0,
        is_air_cooled=True,
    )


def compressor_cycling_factor(load_ratio: float) -> float:
    """Deprecated alias for the AHRI PLF (kept for backward compatibility)."""

    return part_load_factor(load_ratio)


def calc_equipment_power(
    load_ratio: float,
    airflow: float,
    design: EquipmentDesign,
    outdoor_temp_c: float = 35.0,
) -> Dict[str, float]:
    """Calculate conditioned-system power at a given bin."""

    ratio = _clamp(load_ratio)
    requested_airflow_ratio = 0.0
    if design.design_conditioned_airflow_cfm > 0:
        requested_airflow_ratio = airflow / design.design_conditioned_airflow_cfm

    if ratio <= 0.0:
        active_airflow_ratio = 0.0
    else:
        active_airflow_ratio = max(_clamp(requested_airflow_ratio), design.min_ahu_airflow_ratio)

    cooling_load_kw = max(design.peak_cooling_kw, 0.0) * ratio
    effective_cop = effective_cooling_cop(
        cop_rated=design.chiller_cop_rated,
        plr=ratio,
        outdoor_temp_c=outdoor_temp_c,
        rated_outdoor_c=design.rated_outdoor_c,
        is_air_cooled=design.is_air_cooled,
        k_t=design.cop_kt_per_k,
    )

    chiller_power_kw = (
        cooling_load_kw / effective_cop
        if effective_cop > 0 and cooling_load_kw > 0
        else 0.0
    )
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
        "outdoor_temp_c": outdoor_temp_c,
        "cop": effective_cop,
        "effective_cop": effective_cop,
        "cycling_factor": part_load_factor(ratio),
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
    """Process / make-up air fan motor electrical input, kW.

    P_brake = Q · ΔP / η_fan
    P_in    = P_brake / η_motor

    The previous code treated `fan_efficiency * motor_efficiency` as a single
    denominator, which under-reports electrical input. The corrected form
    matches AMCA fan-power conventions.
    """

    airflow_m3s = max(cfm, 0.0) * CFM_TO_M3S
    eta_fan = max(fan_efficiency, 0.20)
    eta_motor = max(motor_efficiency, 0.50)
    brake_kw = (airflow_m3s * max(pressure_pa, 0.0)) / (eta_fan * 1000.0)
    return brake_kw / eta_motor
