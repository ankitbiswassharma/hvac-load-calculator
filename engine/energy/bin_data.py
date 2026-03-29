"""Temperature bin models and helpers for ASHRAE-style bin energy analysis."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, List, Mapping, Sequence


@dataclass(frozen=True)
class TemperatureBin:
    """Single outdoor dry-bulb temperature bin."""

    dry_bulb_c: float
    hours: float
    label: str = ""

    def as_dict(self) -> dict:
        payload = asdict(self)
        payload["label"] = self.label or f"{self.dry_bulb_c:.1f}°C"
        return payload


def normalize_bins(bin_rows: Iterable[TemperatureBin | Mapping[str, float]]) -> List[TemperatureBin]:
    """Convert dict-like rows or TemperatureBin objects into validated bins."""

    normalized: List[TemperatureBin] = []
    for row in bin_rows:
        if isinstance(row, TemperatureBin):
            candidate = row
        else:
            candidate = TemperatureBin(
                dry_bulb_c=float(row["dry_bulb_c"]),
                hours=float(row["hours"]),
                label=str(row.get("label", "")).strip(),
            )
        if candidate.hours < 0:
            raise ValueError(f"Bin hours must be non-negative. Got {candidate.hours!r}")
        normalized.append(candidate)

    if not normalized:
        raise ValueError("At least one temperature bin is required.")

    return sorted(normalized, key=lambda item: item.dry_bulb_c)


def sample_industrial_cooling_bins() -> Sequence[TemperatureBin]:
    """Sample annual cooling-season bin table for demonstration and testing.

    This is intentionally simplified: it is suitable as a starter dataset for
    bin-method development, demos, and validation before a project-specific
    climate file is loaded.
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
