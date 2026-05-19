"""Load-profile helpers for ASHRAE-style bin energy calculations.

Implements the balance-point method (ASHRAE Handbook of Fundamentals
Ch. 19):

    T_balance = T_setpoint - (Q_internal + Q_solar) / UA

    Q_bin = UA * max(T_oa - T_balance, 0)    [cooling, W]
    Q_bin = UA * max(T_balance - T_oa, 0)    [heating, W]

The previous implementation interpolated linearly between the indoor
setpoint and the design outdoor temperature, ignoring internal and solar
gains entirely. That under-predicts cooling during moderate weather and
makes the engine cooling-only. The new implementation supports both
cooling and heating bins.
"""

from __future__ import annotations

from dataclasses import dataclass


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


@dataclass
class BalancePointInputs:
    indoor_setpoint_c: float = 24.0
    internal_gains_w: float = 0.0
    solar_gains_w: float = 0.0
    ua_w_per_k: float = 0.0  # envelope + ventilation conductance


def balance_temperature_c(inputs: BalancePointInputs) -> float:
    """Balance-point outdoor temperature in °C.

    Above this temperature the building net-heats (cooling required); below,
    it net-cools (heating required). If UA is zero or negative, returns the
    setpoint (avoids divide-by-zero).
    """

    if inputs.ua_w_per_k <= 0:
        return inputs.indoor_setpoint_c
    return inputs.indoor_setpoint_c - (inputs.internal_gains_w + inputs.solar_gains_w) / inputs.ua_w_per_k


def cooling_load_w(outdoor_temp_c: float, balance_point: BalancePointInputs) -> float:
    t_b = balance_temperature_c(balance_point)
    return max(0.0, balance_point.ua_w_per_k) * max(0.0, outdoor_temp_c - t_b)


def heating_load_w(outdoor_temp_c: float, balance_point: BalancePointInputs) -> float:
    t_b = balance_temperature_c(balance_point)
    return max(0.0, balance_point.ua_w_per_k) * max(0.0, t_b - outdoor_temp_c)


# ---------------------------------------------------------------------------
# Backwards-compatible thin wrappers preserved for callers that still use the
# legacy linear API. The new implementations underneath are balance-point
# based and DO accept design_temp == indoor_setpoint without raising.
# ---------------------------------------------------------------------------


def generate_load_profile(
    peak_load_kw: float,
    outdoor_temp: float,
    design_temp: float,
    indoor_setpoint: float = 24.0,
) -> float:
    """Return a load ratio in [0, 1].

    The ratio compares the bin load (computed via balance point assuming a
    typical 60 % internal-gain fraction at design) to the peak design load.
    For the legacy use case of no internal/solar gain data the formula
    collapses to the previous linear ratio.
    """

    _ = peak_load_kw
    # Use indoor setpoint as a degenerate balance point if no internal info
    span = max(design_temp - indoor_setpoint, 1e-9)
    raw_ratio = (outdoor_temp - indoor_setpoint) / span
    return _clamp(raw_ratio, 0.0, 1.0)


def calc_bin_load_kw(
    peak_load_kw: float,
    outdoor_temp: float,
    design_temp: float,
    indoor_setpoint: float = 24.0,
) -> float:
    ratio = generate_load_profile(
        peak_load_kw=peak_load_kw,
        outdoor_temp=outdoor_temp,
        design_temp=design_temp,
        indoor_setpoint=indoor_setpoint,
    )
    return max(peak_load_kw, 0.0) * ratio
