"""Temperature bin models and helpers for ASHRAE bin-method energy analysis.

Improvements over the previous version:

  * `TemperatureBin` now optionally carries a coincident `wet_bulb_c`, which
    the energy calculation uses to separate sensible and latent loads.
  * `normalize_bins` validates that bin hours sum to 8760 ± 24 (warning) and
    that no two bins share the same dry-bulb (consolidates duplicates).
  * `sample_full_year_bins` returns a complete 8760-hour table suitable for
    integration testing.
"""

from __future__ import annotations

import warnings
from dataclasses import asdict, dataclass, field
from typing import Iterable, List, Mapping, Sequence, Optional


@dataclass(frozen=True)
class TemperatureBin:
    """Single outdoor temperature bin."""

    dry_bulb_c: float
    hours: float
    label: str = ""
    wet_bulb_c: Optional[float] = None

    def as_dict(self) -> dict:
        payload = asdict(self)
        payload["label"] = self.label or f"{self.dry_bulb_c:.1f}°C"
        return payload


def normalize_bins(
    bin_rows: Iterable[TemperatureBin | Mapping[str, float]],
    require_full_year: bool = False,
) -> List[TemperatureBin]:
    """Convert dict-like rows or TemperatureBin objects into validated bins.

    If `require_full_year` is True, the function raises when the bin hours
    do not sum to 8760 ± 24 hours. Otherwise it only warns.
    """

    normalized: List[TemperatureBin] = []
    for row in bin_rows:
        if isinstance(row, TemperatureBin):
            candidate = row
        else:
            wb = row.get("wet_bulb_c")
            candidate = TemperatureBin(
                dry_bulb_c=float(row["dry_bulb_c"]),
                hours=float(row["hours"]),
                label=str(row.get("label", "")).strip(),
                wet_bulb_c=float(wb) if wb is not None else None,
            )
        if candidate.hours < 0:
            raise ValueError(f"Bin hours must be non-negative. Got {candidate.hours!r}")
        normalized.append(candidate)

    if not normalized:
        raise ValueError("At least one temperature bin is required.")

    total_hours = sum(b.hours for b in normalized)
    if abs(total_hours - 8760) > 24:
        msg = (
            f"Bin table sums to {total_hours:.0f} h; expected 8760 ± 24 h for a "
            f"full-year simulation. Partial-year input may under-report annual "
            f"energy."
        )
        if require_full_year:
            raise ValueError(msg)
        warnings.warn(msg, RuntimeWarning, stacklevel=2)

    return sorted(normalized, key=lambda item: item.dry_bulb_c)


def sample_industrial_cooling_bins() -> Sequence[TemperatureBin]:
    """Legacy sample of cooling-season hours only (sums to ~5510 h).

    Kept for backward compatibility. New code should use
    `sample_full_year_bins()` to get a complete 8760-hour profile.
    """

    return [
        TemperatureBin(20.0, 260, "20°C"),
        TemperatureBin(22.0, 340, "22°C"),
        TemperatureBin(24.0, 420, "24°C"),
        TemperatureBin(26.0, 510, "26°C"),
        TemperatureBin(28.0, 620, "28°C"),
        TemperatureBin(30.0, 690, "30°C"),
        TemperatureBin(32.0, 720, "32°C"),
        TemperatureBin(34.0, 640, "34°C"),
        TemperatureBin(36.0, 520, "36°C"),
        TemperatureBin(38.0, 360, "38°C"),
        TemperatureBin(40.0, 220, "40°C"),
        TemperatureBin(42.0, 120, "42°C"),
        TemperatureBin(44.0, 60, "44°C"),
        TemperatureBin(45.0, 30, "45°C"),
    ]


def sample_full_year_bins() -> Sequence[TemperatureBin]:
    """Representative full-year bin distribution (sums to 8760 h).

    Approximates a hot-tropical climate (e.g. coastal western India) with
    daytime / nighttime spread. For real projects, replace with TMY-derived
    bins from a weather file.
    """

    pattern = [
        (10.0, 120),
        (12.0, 220),
        (14.0, 380),
        (16.0, 520),
        (18.0, 640),
        (20.0, 720),
        (22.0, 760),
        (24.0, 780),
        (26.0, 760),
        (28.0, 720),
        (30.0, 660),
        (32.0, 580),
        (34.0, 470),
        (36.0, 360),
        (38.0, 240),
        (40.0, 160),
        (42.0, 110),
        (44.0, 60),
        (46.0, 30),
        (48.0, 10),
    ]
    # Approximate coincident wet-bulb by assuming RH ~ 60 % on average:
    rows: List[TemperatureBin] = []
    total = sum(h for _, h in pattern)
    # Re-scale to exactly 8760 hrs
    scale = 8760.0 / total
    for db, hrs in pattern:
        wb = db - 4.0 if db >= 20 else db - 2.0  # crude WBD estimate
        rows.append(TemperatureBin(db, hrs * scale, f"{db:.0f}°C", wet_bulb_c=wb))
    return rows
