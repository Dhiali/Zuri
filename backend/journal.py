"""Journey tracking analytics for the Zuri trading journal.

Everything here is computed from recorded events, so the numbers handed to the AI
(and shown to the user) are facts, not model guesses.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

TRADE_KINDS = {"order_placed", "position_detected", "position_closed"}
INTEREST_KINDS = {"watchlist_add", "symbol_viewed"}
REVENGE_WINDOW = timedelta(minutes=30)


def parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _details(event: dict) -> dict:
    details = event.get("details")
    return details if isinstance(details, dict) else {}


def _is_entry(event: dict) -> bool:
    return event["kind"] in TRADE_KINDS and _details(event).get("action", "entry") == "entry"


def tracked_positions(events: list[dict[str, Any]]) -> tuple[dict[str, float], dict[str, datetime]]:
    """Net signed quantity Zuri believes is open per symbol, and when each was last entered."""
    net: dict[str, float] = defaultdict(float)
    last_entry: dict[str, datetime] = {}
    for event in sorted(events, key=lambda e: e["created_at"]):
        if event["kind"] not in TRADE_KINDS or not event.get("symbol"):
            continue
        details = _details(event)
        quantity = details.get("quantity")
        if not isinstance(quantity, (int, float)):
            continue
        net[event["symbol"]] += quantity if details.get("side") == "buy" else -quantity
        if _is_entry(event):
            last_entry[event["symbol"]] = parse_time(event["created_at"])
    return dict(net), last_entry


def compute_stats(
    events: list[dict[str, Any]],
    entries: list[dict[str, Any]],
    positions: list[dict[str, Any]],
    equity: float | None,
    tz_offset_minutes: int = 0,
) -> dict[str, Any]:
    """events/entries use ISO `created_at`; positions come from the broker adapter."""
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    events = sorted(events, key=lambda e: e["created_at"])
    trade_events = [e for e in events if e["kind"] in TRADE_KINDS]
    entry_trades = [e for e in trade_events if _is_entry(e)]
    exits = [e for e in trade_events if not _is_entry(e)]
    manual_entries = [e for e in entries if e.get("source", "manual") == "manual"]

    first_interest: dict[str, datetime] = {}
    for event in events:
        if event["kind"] in INTEREST_KINDS and event.get("symbol"):
            first_interest.setdefault(event["symbol"], parse_time(event["created_at"]))
    first_trade: dict[str, datetime] = {}
    for event in entry_trades:
        first_trade.setdefault(event["symbol"], parse_time(event["created_at"]))

    lags = []
    for symbol, traded_at in first_trade.items():
        interest_at = first_interest.get(symbol)
        if interest_at and interest_at <= traded_at:
            lags.append((traded_at - interest_at).total_seconds() / 3600)

    def has_note(trade: dict, require_stop: bool = False) -> bool:
        traded_at = parse_time(trade["created_at"])
        for entry in manual_entries:
            if entry["symbol"] != trade["symbol"]:
                continue
            if require_stop and not entry.get("stop_price"):
                continue
            if abs((parse_time(entry["created_at"]) - traded_at).total_seconds()) <= 86400:
                return True
        return False

    noted = sum(1 for t in entry_trades if has_note(t))
    planned = sum(1 for t in entry_trades if has_note(t, require_stop=True))
    unprotected = sum(1 for t in entry_trades if not _details(t).get("stop_loss"))

    per_day: Counter[str] = Counter()
    by_hour: Counter[int] = Counter()
    for trade in entry_trades:
        local = parse_time(trade["created_at"]).astimezone(tz)
        per_day[local.date().isoformat()] += 1
        by_hour[local.hour] += 1

    sizes = []
    for trade in entry_trades:
        details = _details(trade)
        notional, trade_equity = details.get("notional"), details.get("equity")
        if notional and trade_equity:
            sizes.append(100 * notional / trade_equity)

    by_symbol = Counter(t["symbol"] for t in entry_trades)
    top_symbol, top_count = (by_symbol.most_common(1)[0] if by_symbol else (None, 0))

    realized = [_details(e).get("realized_pl") for e in exits if _details(e).get("realized_pl") is not None]
    wins = [value for value in realized if value > 0]
    losses = [value for value in realized if value < 0]

    open_pl = [(p["symbol"], p.get("unrealized_pl")) for p in positions if p.get("unrealized_pl") is not None]
    worst_open = min(open_pl, key=lambda item: item[1]) if open_pl else None

    # A new entry soon after a losing exit is the classic "trading to win it back" pattern.
    revenge = 0
    for trade in entry_trades:
        opened = parse_time(trade["created_at"])
        if any(
            _details(e).get("realized_pl") is not None and _details(e)["realized_pl"] < 0
            and timedelta(0) <= opened - parse_time(e["created_at"]) <= REVENGE_WINDOW
            for e in exits
        ):
            revenge += 1

    blocked = [e for e in events if e["kind"] == "order_blocked"]
    blocked_by_reason = Counter(_details(e).get("category", "other") for e in blocked)
    plans = [e for e in events if e["kind"] == "plan_proposed"]
    closed_outside = [e for e in exits if e["kind"] == "position_closed"]

    return {
        "first_event_at": events[0]["created_at"] if events else None,
        "blocked_orders": len(blocked),
        "blocked_orders_by_reason": dict(blocked_by_reason),
        "plans_discussed_with_zuri": len(plans),
        "closed_outside_zuri": len(closed_outside),
        "trades_soon_after_a_loss": revenge,
        "symbols_of_interest": len(first_interest),
        "symbols_traded": len(first_trade),
        "interest_to_trade_rate_pct": round(100 * len(first_trade) / len(first_interest), 1) if first_interest else None,
        "median_hours_interest_to_first_trade": round(sorted(lags)[len(lags) // 2], 1) if lags else None,
        "entry_trades": len(entry_trades),
        "exits": len(exits),
        "trades_with_journal_note_pct": round(100 * noted / len(entry_trades), 1) if entry_trades else None,
        "trades_with_written_plan_and_stop_pct": round(100 * planned / len(entry_trades), 1) if entry_trades else None,
        "trades_without_stop_loss": unprotected,
        "max_trades_in_one_day": max(per_day.values()) if per_day else 0,
        "active_trading_days": len(per_day),
        "busiest_hours_local": [hour for hour, _ in by_hour.most_common(3)],
        "avg_position_pct_of_equity": round(sum(sizes) / len(sizes), 1) if sizes else None,
        "max_position_pct_of_equity": round(max(sizes), 1) if sizes else None,
        "most_traded_symbol": top_symbol,
        "most_traded_symbol_share_pct": round(100 * top_count / len(entry_trades), 1) if entry_trades else None,
        "closed_trades_with_pl": len(realized),
        "win_rate_pct": round(100 * len(wins) / len(realized), 1) if realized else None,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else None,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else None,
        "total_realized_pl_estimate": round(sum(realized), 2) if realized else None,
        "open_positions": len(positions),
        "worst_open_position": {"symbol": worst_open[0], "unrealized_pl": worst_open[1]} if worst_open else None,
        "equity": equity,
    }


def timeline(events: list[dict[str, Any]], limit: int = 60) -> list[dict[str, Any]]:
    ordered = sorted(events, key=lambda e: e["created_at"])[-limit:]
    return [
        {
            "at": e["created_at"],
            "kind": e["kind"],
            "symbol": e.get("symbol"),
            **{k: v for k, v in _details(e).items() if k in {"side", "quantity", "price", "action", "realized_pl", "stop_loss", "environment", "broker", "reason", "take_profit", "risk_percent", "idea", "category"}},
        }
        for e in ordered
    ]


def group_by_symbol(events: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        if event.get("symbol"):
            grouped[event["symbol"]].append(event)
    return grouped


def pair_fills(fills: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """FIFO-pairs broker fills into closed round trips (long and short) with realized P&L."""
    books: dict[str, list[list[Any]]] = defaultdict(list)  # symbol -> [[signed_qty, price, time], ...]
    trips: list[dict[str, Any]] = []
    for fill in sorted(fills, key=lambda f: parse_time(f["time"])):
        qty = fill["quantity"] if fill["side"] == "buy" else -fill["quantity"]
        book = books[fill["symbol"]]
        remaining = qty
        while remaining and book and (book[0][0] > 0) != (remaining > 0):
            lot = book[0]
            matched = min(abs(lot[0]), abs(remaining))
            direction = 1 if lot[0] > 0 else -1
            trips.append({
                "id": f"{fill['symbol']}-{len(trips) + 1}",
                "symbol": fill["symbol"],
                "side": "long" if direction > 0 else "short",
                "quantity": matched,
                "entry_price": lot[1],
                "exit_price": fill["price"],
                "opened_at": lot[2],
                "closed_at": fill["time"],
                "realized_pl": round(direction * (fill["price"] - lot[1]) * matched, 2),
            })
            lot[0] -= direction * matched
            remaining += direction * matched
            if abs(lot[0]) < 1e-9:
                book.pop(0)
        if abs(remaining) > 1e-9:
            book.append([remaining, fill["price"], fill["time"]])
    return sorted(trips, key=lambda t: parse_time(t["closed_at"]), reverse=True)


def compact_candles(candles: list[dict[str, Any]]) -> list[list[float]]:
    return [[index, round(c["o"], 5), round(c["h"], 5), round(c["l"], 5), round(c["c"], 5)] for index, c in enumerate(candles)]


ANNOTATION_KINDS = {"support", "resistance", "entry", "exit", "risk", "note"}


def sanitize_annotations(raw: Any, candle_count: int, low: float, high: float) -> list[dict[str, Any]]:
    """The AI output is untrusted: keep only well-formed annotations anchored inside the chart."""
    if not isinstance(raw, list):
        return []
    span = max(high - low, 1e-9)
    clean = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()[:140]
        if not text:
            continue
        index = item.get("index")
        index = index if isinstance(index, int) and not isinstance(index, bool) and 0 <= index < candle_count else None
        price = item.get("price")
        price = float(price) if isinstance(price, (int, float)) and not isinstance(price, bool) and low - span <= price <= high + span else None
        if index is None and price is None:
            continue
        kind = item.get("kind") if item.get("kind") in ANNOTATION_KINDS else "note"
        clean.append({"kind": kind, "index": index, "price": price, "text": text})
        if len(clean) == 6:
            break
    return clean
