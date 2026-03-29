"""CLI bridge for the HVAC energy simulation package.

This module lets the Node server invoke the Python energy engine using a
simple JSON-over-stdin contract.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Iterable, Mapping

from .bin_data import sample_industrial_cooling_bins
from .energy_calc import EnergySimulationInput
from .report import build_energy_report, compare_reports


def _read_stdin_json() -> Dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON payload: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Top-level JSON payload must be an object.")
    return payload


def _normalize_bins(payload: Mapping[str, Any]) -> Iterable[Mapping[str, float]]:
    provided_bins = payload.get("bin_data") or payload.get("binData")
    if provided_bins:
        return provided_bins
    return [item.as_dict() for item in sample_industrial_cooling_bins()]


def _build_system_data(system_payload: Mapping[str, Any]) -> EnergySimulationInput:
    normalized = dict(system_payload or {})
    if "optionName" in normalized and "option_name" not in normalized:
        normalized["option_name"] = normalized.pop("optionName")
    return EnergySimulationInput(**normalized)


def simulate(payload: Mapping[str, Any]) -> Dict[str, Any]:
    system_payload = payload.get("system_data") or payload.get("systemData") or {}
    report = build_energy_report(
        bin_data=_normalize_bins(payload),
        system_data=_build_system_data(system_payload),
    )
    return {
        "ok": True,
        "report": report,
    }


def compare(payload: Mapping[str, Any]) -> Dict[str, Any]:
    option_a = payload.get("option_a") or payload.get("optionA")
    option_b = payload.get("option_b") or payload.get("optionB")
    if not isinstance(option_a, dict) or not isinstance(option_b, dict):
        raise ValueError("compare requires option_a and option_b report objects.")
    return {
        "ok": True,
        "comparison": compare_reports(option_a, option_b),
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    command = args[0] if args else "simulate"

    try:
        payload = _read_stdin_json()
        if command == "compare":
            result = compare(payload)
        else:
            result = simulate(payload)
        sys.stdout.write(json.dumps(result))
        return 0
    except Exception as exc:  # pragma: no cover - CLI guardrail
        sys.stderr.write(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
