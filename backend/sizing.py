"""Deterministic trade maths. The AI never calculates sizes; it only proposes direction and levels."""
from __future__ import annotations

import math
from typing import Any

FOREX_LOT_UNITS = 100_000


def average_range(candles: list[dict], period: int = 14) -> float | None:
    ranges = [c["h"] - c["l"] for c in candles[-period:] if isinstance(c.get("h"), (int, float)) and isinstance(c.get("l"), (int, float))]
    ranges = [r for r in ranges if r > 0]
    return sum(ranges) / len(ranges) if ranges else None


def levels_valid(side: str, price: float, stop: float | None, target: float | None) -> bool:
    if stop is None or target is None or stop <= 0 or target <= 0:
        return False
    if side == "buy":
        return stop < price < target
    return target < price < stop


def suggest_levels(side: str, price: float, avg_range: float | None, reward_ratio: float = 2.0) -> tuple[float, float]:
    """Stop 1.5 average candle ranges away (fallback 1% of price), target at reward_ratio times the risk."""
    distance = 1.5 * avg_range if avg_range else price * 0.01
    distance = max(distance, price * 0.0005)
    direction = 1 if side == "buy" else -1
    decimals = 5 if price < 10 else 2
    return round(price - direction * distance, decimals), round(price + direction * reward_ratio * distance, decimals)


def size_position(
    *,
    equity: float,
    price: float,
    stop: float,
    risk_percent: float,
    max_notional: float | None = None,
    forex: bool = False,
) -> dict[str, Any]:
    stop_distance = abs(price - stop)
    if equity <= 0 or price <= 0 or stop_distance <= 0 or risk_percent <= 0:
        return {"units": 0, "warnings": ["Zuri could not size this trade from the numbers available."]}
    risk_amount = equity * risk_percent / 100
    units = math.floor(round(risk_amount / stop_distance, 6))
    capped_by = "risk"
    warnings: list[str] = []
    if max_notional is not None and units * price > max_notional:
        units = math.floor(max_notional / price)
        capped_by = "buying_power"
        warnings.append("Size reduced to fit your buying power, so you are risking less than planned.")
    if units < 1:
        return {"units": 0, "risk_amount": round(risk_amount, 2), "stop_distance": stop_distance,
                "warnings": warnings + ["Your account is too small to take this trade at this stop distance. Try a tighter stop or a smaller instrument."]}
    result: dict[str, Any] = {
        "units": units,
        "risk_amount": round(risk_amount, 2),
        "actual_risk": round(units * stop_distance, 2),
        "stop_distance": round(stop_distance, 6),
        "notional": round(units * price, 2),
        "capped_by": capped_by,
        "warnings": warnings,
    }
    if forex:
        result["lots"] = round(units / FOREX_LOT_UNITS, 2)
    return result
