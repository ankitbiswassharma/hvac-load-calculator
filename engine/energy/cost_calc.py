"""Energy cost helpers."""

from __future__ import annotations


def calculate_energy_cost(total_kwh: float, tariff: float) -> float:
    """Return annual energy cost based on total consumption and tariff."""

    return max(total_kwh, 0.0) * max(tariff, 0.0)
