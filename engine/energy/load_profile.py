"""Load-profile helpers for simplified ASHRAE-style bin energy calculations."""

from __future__ import annotations


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def generate_load_profile(
    peak_load_kw: float,
    outdoor_temp: float,
    design_temp: float,
    indoor_setpoint: float = 24.0,
) -> float:
    """Return a load ratio between 0 and 1 using linear interpolation.

    Engineering basis:
    - Load is zero when outdoor dry bulb falls to the indoor setpoint.
    - Load reaches unity at the project design outdoor temperature.
    - The peak load itself is not used in the ratio, but is kept in the
      signature to match the requested API and future-proof the hook for more
      detailed non-linear load models.
    """

    _ = peak_load_kw
    if design_temp <= indoor_setpoint:
        raise ValueError("Design temperature must be higher than indoor setpoint for cooling simulation.")

    raw_ratio = (outdoor_temp - indoor_setpoint) / (design_temp - indoor_setpoint)
    return _clamp(raw_ratio, 0.0, 1.0)


def calc_bin_load_kw(
    peak_load_kw: float,
    outdoor_temp: float,
    design_temp: float,
    indoor_setpoint: float = 24.0,
) -> float:
    """Convert the linear load ratio into a bin load in kW."""

    ratio = generate_load_profile(
        peak_load_kw=peak_load_kw,
        outdoor_temp=outdoor_temp,
        design_temp=design_temp,
        indoor_setpoint=indoor_setpoint,
    )
    return max(peak_load_kw, 0.0) * ratio
