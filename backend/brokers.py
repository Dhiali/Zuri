import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

TIMEOUT = 10

BROKERS: dict[str, dict[str, Any]] = {
    "alpaca": {
        "name": "Alpaca",
        "fields": ["api_key", "api_secret"],
        "environments": ["paper", "live"],
        "asset_class": "Stocks",
    },
    "oanda": {
        "name": "OANDA",
        "fields": ["api_token", "account_id"],
        "environments": ["paper", "live"],
        "asset_class": "Forex",
    },
    "tradier": {
        "name": "Tradier",
        "fields": ["access_token", "account_id"],
        "environments": ["paper", "live"],
        "asset_class": "Stocks",
    },
}


def _fernet() -> Fernet:
    key = os.getenv("BROKER_ENCRYPTION_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="BROKER_ENCRYPTION_KEY is not configured on the backend.")
    try:
        return Fernet(key.encode())
    except ValueError as e:
        raise HTTPException(status_code=503, detail="BROKER_ENCRYPTION_KEY is invalid.") from e


def encrypt_credentials(credentials: dict[str, str]) -> str:
    return _fernet().encrypt(json.dumps(credentials).encode()).decode()


def decrypt_credentials(token: str) -> dict[str, str]:
    try:
        return json.loads(_fernet().decrypt(token.encode()))
    except InvalidToken as e:
        raise HTTPException(status_code=500, detail="Stored broker credentials could not be decrypted.") from e


def _request(method: str, url: str, **kwargs):
    try:
        response = requests.request(method, url, timeout=TIMEOUT, **kwargs)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail="The broker could not be reached. Please try again.") from e
    if response.status_code in (401, 403):
        raise HTTPException(status_code=400, detail="The broker rejected these credentials.")
    if response.status_code >= 400:
        try:
            detail = response.json().get("message") or response.json().get("errorMessage")
        except (ValueError, AttributeError):
            detail = None
        raise HTTPException(status_code=502, detail=f"Broker error: {detail or response.status_code}")
    try:
        return response.json()
    except ValueError as e:
        raise HTTPException(status_code=502, detail="The broker returned an invalid response.") from e


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class AlpacaAdapter:
    def __init__(self, creds: dict[str, str], environment: str):
        host = "api.alpaca.markets" if environment == "live" else "paper-api.alpaca.markets"
        self.base = f"https://{host}"
        self.headers = {"APCA-API-KEY-ID": creds["api_key"], "APCA-API-SECRET-KEY": creds["api_secret"]}

    def account(self):
        data = _request("GET", f"{self.base}/v2/account", headers=self.headers)
        return {
            "currency": data.get("currency", "USD"),
            "equity": _num(data.get("equity")),
            "cash": _num(data.get("cash")),
            "buying_power": _num(data.get("buying_power")),
            "label": data.get("account_number"),
        }

    def positions(self):
        data = _request("GET", f"{self.base}/v2/positions", headers=self.headers)
        return [
            {
                "symbol": p.get("symbol"),
                "quantity": _num(p.get("qty")),
                "side": p.get("side"),
                "avg_entry_price": _num(p.get("avg_entry_price")),
                "current_price": _num(p.get("current_price")),
                "market_value": _num(p.get("market_value")),
                "unrealized_pl": _num(p.get("unrealized_pl")),
                "unrealized_plpc": _num(p.get("unrealized_plpc")),
            }
            for p in data
        ]

    def price(self, symbol: str) -> float:
        data = _request("GET", f"https://data.alpaca.markets/v2/stocks/{symbol}/trades/latest", headers=self.headers)
        price = _num((data.get("trade") or {}).get("p"))
        if price is None:
            raise HTTPException(status_code=502, detail=f"Could not fetch price for {symbol}.")
        return price

    def place_order(self, symbol: str, side: str, quantity: float, stop_loss: float | None = None, take_profit: float | None = None):
        payload = {"symbol": symbol, "qty": str(quantity), "side": side, "type": "market", "time_in_force": "day"}
        if stop_loss is not None and take_profit is not None:
            payload.update(
                time_in_force="gtc",
                order_class="bracket",
                take_profit={"limit_price": str(take_profit)},
                stop_loss={"stop_price": str(stop_loss)},
            )
        data = _request("POST", f"{self.base}/v2/orders", headers=self.headers, json=payload)
        return {"order_id": data.get("id"), "status": data.get("status")}

    def open_orders(self):
        data = _request("GET", f"{self.base}/v2/orders", headers=self.headers, params={"status": "open"})
        return [
            {"id": o.get("id"), "symbol": o.get("symbol"), "quantity": _num(o.get("qty")), "side": o.get("side"), "type": o.get("type"), "status": o.get("status")}
            for o in data
        ]

    def history(self, limit: int = 200):
        data = _request("GET", f"{self.base}/v2/orders", headers=self.headers, params={"status": "closed", "limit": limit, "direction": "desc"})
        fills = []
        for o in data:
            qty, price = _num(o.get("filled_qty")), _num(o.get("filled_avg_price"))
            if not qty or price is None or not o.get("filled_at"):
                continue
            fills.append({"id": o.get("id"), "symbol": o.get("symbol"), "side": o.get("side"), "quantity": qty, "price": price, "time": o.get("filled_at")})
        return {"fills": fills, "round_trips": None}

    def candles(self, symbol: str, count: int = 80):
        start = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
        data = _request(
            "GET", f"https://data.alpaca.markets/v2/stocks/{symbol}/bars", headers=self.headers,
            params={"timeframe": "15Min", "start": start, "limit": 1000, "feed": "iex", "adjustment": "raw"},
        )
        return [{"t": b["t"], "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"]} for b in (data.get("bars") or [])][-count:]

    def historical_candles(self, symbol: str, timeframe: str, start: datetime, end: datetime):
        timeframes = {"1m": "1Min", "5m": "5Min", "15m": "15Min", "1h": "1Hour", "1D": "1Day", "1W": "1Week"}
        if timeframe == "4h":
            source_timeframe = "1Hour"
        else:
            source_timeframe = timeframes.get(timeframe)
        if source_timeframe is None:
            raise HTTPException(status_code=400, detail=f"{timeframe} history is not supported by Alpaca.")

        params = {
            "timeframe": source_timeframe,
            "start": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "end": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "limit": 10000,
            "feed": "iex",
            "adjustment": "raw",
        }
        bars = []
        while len(bars) < 10000:
            data = _request(
                "GET", f"https://data.alpaca.markets/v2/stocks/{symbol}/bars",
                headers=self.headers, params=params,
            )
            bars.extend(data.get("bars") or [])
            token = data.get("next_page_token")
            if not token or len(bars) >= 10000:
                break
            params["page_token"] = token

        candles = [{"t": bar["t"], "o": bar["o"], "h": bar["h"], "l": bar["l"], "c": bar["c"]}
                   for bar in bars[:10000]]
        if timeframe != "4h":
            return candles
        return _aggregate_candles(candles, 4)

    def close_all(self):
        _request("DELETE", f"{self.base}/v2/orders", headers=self.headers)
        _request("DELETE", f"{self.base}/v2/positions", headers=self.headers, params={"cancel_orders": "true"})


class OandaAdapter:
    def __init__(self, creds: dict[str, str], environment: str):
        host = "api-fxtrade.oanda.com" if environment == "live" else "api-fxpractice.oanda.com"
        self.base = f"https://{host}/v3/accounts/{creds['account_id']}"
        self.headers = {"Authorization": f"Bearer {creds['api_token']}"}
        self.account_id = creds["account_id"]

    def account(self):
        data = _request("GET", f"{self.base}/summary", headers=self.headers).get("account", {})
        return {
            "currency": data.get("currency"),
            "equity": _num(data.get("NAV")),
            "cash": _num(data.get("balance")),
            "buying_power": _num(data.get("marginAvailable")),
            "label": self.account_id,
        }

    def positions(self):
        data = _request("GET", f"{self.base}/openPositions", headers=self.headers).get("positions", [])
        result = []
        for p in data:
            long_leg, short_leg = p.get("long", {}), p.get("short", {})
            long_units = _num(long_leg.get("units")) or 0.0
            leg = long_leg if long_units else short_leg
            units = long_units or (_num(short_leg.get("units")) or 0.0)
            result.append({
                "symbol": p.get("instrument"),
                "quantity": abs(units),
                "side": "long" if units > 0 else "short",
                "avg_entry_price": _num(leg.get("averagePrice")),
                "current_price": None,
                "market_value": None,
                "unrealized_pl": _num(p.get("unrealizedPL")),
                "unrealized_plpc": None,
            })
        return result

    def price(self, symbol: str) -> float:
        data = _request("GET", f"{self.base}/pricing", headers=self.headers, params={"instruments": symbol})
        prices = data.get("prices") or []
        bid = _num(prices[0].get("closeoutBid")) if prices else None
        ask = _num(prices[0].get("closeoutAsk")) if prices else None
        if bid is None or ask is None:
            raise HTTPException(status_code=502, detail=f"Could not fetch price for {symbol}.")
        return (bid + ask) / 2

    def place_order(self, symbol: str, side: str, quantity: float, stop_loss: float | None = None, take_profit: float | None = None):
        units = int(quantity) if side == "buy" else -int(quantity)
        order = {"type": "MARKET", "instrument": symbol, "units": str(units), "timeInForce": "FOK", "positionFill": "DEFAULT"}
        if stop_loss is not None:
            order["stopLossOnFill"] = {"price": str(stop_loss)}
        if take_profit is not None:
            order["takeProfitOnFill"] = {"price": str(take_profit)}
        data = _request("POST", f"{self.base}/orders", headers=self.headers, json={"order": order})
        fill = data.get("orderFillTransaction") or data.get("orderCreateTransaction") or {}
        return {"order_id": fill.get("id"), "status": "filled" if data.get("orderFillTransaction") else "submitted"}

    def history(self, limit: int = 100):
        trades = _request("GET", f"{self.base}/trades", headers=self.headers, params={"state": "CLOSED", "count": limit}).get("trades", [])
        round_trips, fills = [], []
        for t in trades:
            units = _num(t.get("initialUnits")) or 0.0
            entry, exit_price = _num(t.get("price")), _num(t.get("averageClosePrice"))
            if not units or entry is None or not t.get("closeTime"):
                continue
            side = "long" if units > 0 else "short"
            round_trips.append({
                "id": t.get("id"), "symbol": t.get("instrument"), "side": side, "quantity": abs(units),
                "entry_price": entry, "exit_price": exit_price, "opened_at": t.get("openTime"),
                "closed_at": t.get("closeTime"), "realized_pl": _num(t.get("realizedPL")),
            })
            fills.append({"id": f"{t.get('id')}-open", "symbol": t.get("instrument"), "side": "buy" if units > 0 else "sell", "quantity": abs(units), "price": entry, "time": t.get("openTime")})
            fills.append({"id": f"{t.get('id')}-close", "symbol": t.get("instrument"), "side": "sell" if units > 0 else "buy", "quantity": abs(units), "price": exit_price, "time": t.get("closeTime")})
        return {"fills": fills, "round_trips": round_trips}

    def candles(self, symbol: str, count: int = 80):
        host = self.base.split("/v3/")[0]
        data = _request("GET", f"{host}/v3/instruments/{symbol}/candles", headers=self.headers, params={"granularity": "M15", "count": count, "price": "M"})
        result = []
        for c in data.get("candles", []):
            mid = c.get("mid") or {}
            values = [_num(mid.get(k)) for k in ("o", "h", "l", "c")]
            if None not in values:
                result.append({"t": c.get("time"), "o": values[0], "h": values[1], "l": values[2], "c": values[3]})
        return result

    def historical_candles(self, symbol: str, timeframe: str, start: datetime, end: datetime):
        granularities = {"1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4", "1D": "D", "1W": "W"}
        granularity = granularities.get(timeframe)
        if granularity is None:
            raise HTTPException(status_code=400, detail=f"{timeframe} history is not supported by OANDA.")
        host = self.base.split("/v3/")[0]
        data = _request(
            "GET", f"{host}/v3/instruments/{symbol}/candles",
            headers=self.headers,
            params={
                "granularity": granularity,
                "from": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "to": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "price": "M",
            },
        )
        result = []
        for candle in data.get("candles", [])[:5000]:
            mid = candle.get("mid") or {}
            values = [_num(mid.get(key)) for key in ("o", "h", "l", "c")]
            if candle.get("time") and all(value is not None for value in values):
                result.append({"t": candle["time"], "o": values[0], "h": values[1], "l": values[2], "c": values[3]})
        return result


class TradierAdapter:
    def __init__(self, creds: dict[str, str], environment: str):
        host = "api.tradier.com" if environment == "live" else "sandbox.tradier.com"
        self.base = f"https://{host}/v1/accounts/{creds['account_id']}"
        self.headers = {"Authorization": f"Bearer {creds['access_token']}", "Accept": "application/json"}
        self.account_id = creds["account_id"]

    def account(self):
        data = _request("GET", f"{self.base}/balances", headers=self.headers).get("balances", {})
        return {
            "currency": "USD",
            "equity": _num(data.get("total_equity")),
            "cash": _num(data.get("total_cash")),
            "buying_power": _num((data.get("margin") or {}).get("stock_buying_power")),
            "label": self.account_id,
        }

    def positions(self):
        positions = (_request("GET", f"{self.base}/positions", headers=self.headers).get("positions") or {})
        items = positions.get("position", []) if isinstance(positions, dict) else []
        if isinstance(items, dict):
            items = [items]
        result = []
        for p in items:
            qty = _num(p.get("quantity")) or 0.0
            cost = _num(p.get("cost_basis"))
            result.append({
                "symbol": p.get("symbol"),
                "quantity": abs(qty),
                "side": "long" if qty >= 0 else "short",
                "avg_entry_price": abs(cost / qty) if cost is not None and qty else None,
                "current_price": None,
                "market_value": None,
                "unrealized_pl": None,
                "unrealized_plpc": None,
            })
        return result

    def price(self, symbol: str) -> float:
        host = self.base.split("/v1/")[0]
        data = _request("GET", f"{host}/v1/markets/quotes", headers=self.headers, params={"symbols": symbol})
        price = _num(((data.get("quotes") or {}).get("quote") or {}).get("last"))
        if price is None:
            raise HTTPException(status_code=502, detail=f"Could not fetch price for {symbol}.")
        return price

    def place_order(self, symbol: str, side: str, quantity: float, stop_loss: float | None = None, take_profit: float | None = None):
        if stop_loss is not None or take_profit is not None:
            raise HTTPException(status_code=501, detail="Stop-loss/take-profit orders are not supported for Tradier yet.")
        data = _request(
            "POST",
            f"{self.base}/orders",
            headers=self.headers,
            data={"class": "equity", "symbol": symbol, "side": side, "quantity": int(quantity), "type": "market", "duration": "day"},
        )
        order = data.get("order", {})
        return {"order_id": order.get("id"), "status": order.get("status")}

    def history(self, limit: int = 200):
        orders = (_request("GET", f"{self.base}/orders", headers=self.headers).get("orders") or {})
        items = orders.get("order", []) if isinstance(orders, dict) else []
        if isinstance(items, dict):
            items = [items]
        fills = []
        for o in items:
            qty = _num(o.get("exec_quantity")) or _num(o.get("quantity"))
            price = _num(o.get("avg_fill_price"))
            when = o.get("transaction_date") or o.get("create_date")
            if o.get("status") != "filled" or not qty or price is None or not when:
                continue
            fills.append({"id": str(o.get("id")), "symbol": o.get("symbol"), "side": "buy" if str(o.get("side")).startswith("buy") else "sell", "quantity": qty, "price": price, "time": when})
        return {"fills": fills[:limit], "round_trips": None}

    def candles(self, symbol: str, count: int = 80):
        host = self.base.split("/v1/")[0]
        start = (datetime.now(timezone.utc) - timedelta(days=6)).strftime("%Y-%m-%d %H:%M")
        data = _request("GET", f"{host}/v1/markets/timesales", headers=self.headers, params={"symbol": symbol, "interval": "15min", "start": start, "session_filter": "open"})
        rows = ((data.get("series") or {}).get("data")) or []
        if isinstance(rows, dict):
            rows = [rows]
        return [{"t": r.get("time"), "o": r.get("open"), "h": r.get("high"), "l": r.get("low"), "c": r.get("close")} for r in rows][-count:]

    def historical_candles(self, symbol: str, timeframe: str, start: datetime, end: datetime):
        host = self.base.split("/v1/")[0]
        if timeframe in {"1m", "5m", "15m"}:
            data = _request(
                "GET", f"{host}/v1/markets/timesales",
                headers=self.headers,
                params={
                    "symbol": symbol,
                    "interval": {"1m": "1min", "5m": "5min", "15m": "15min"}[timeframe],
                    "start": start.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M"),
                    "end": end.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M"),
                    "session_filter": "open",
                },
            )
            rows = ((data.get("series") or {}).get("data")) or []
            if isinstance(rows, dict):
                rows = [rows]
            return [
                {
                    "t": row.get("time"),
                    "o": _num(row.get("open")),
                    "h": _num(row.get("high")),
                    "l": _num(row.get("low")),
                    "c": _num(row.get("close")),
                }
                for row in rows[:10000]
                if row.get("time") and all(_num(row.get(key)) is not None for key in ("open", "high", "low", "close"))
            ]
        if timeframe in {"1h", "4h"}:
            raise HTTPException(
                status_code=400,
                detail=f"{timeframe} history is not supported by Tradier. Choose 1m, 5m, 15m, 1D, or 1W.",
            )
        interval = {"1D": "daily", "1W": "weekly"}.get(timeframe)
        if interval is None:
            raise HTTPException(status_code=400, detail=f"{timeframe} history is not supported by Tradier.")
        data = _request(
            "GET", f"{host}/v1/markets/history",
            headers=self.headers,
            params={
                "symbol": symbol,
                "interval": interval,
                "start": start.astimezone(timezone.utc).strftime("%Y-%m-%d"),
                "end": end.astimezone(timezone.utc).strftime("%Y-%m-%d"),
            },
        )
        history = data.get("history") or {}
        rows = history.get({"1D": "day", "1W": "week"}[timeframe]) or history.get("day") or []
        if isinstance(rows, dict):
            rows = [rows]
        return [
            {
                "t": row.get("date"),
                "o": _num(row.get("open")),
                "h": _num(row.get("high")),
                "l": _num(row.get("low")),
                "c": _num(row.get("close")),
            }
            for row in rows[:10000]
            if row.get("date") and all(_num(row.get(key)) is not None for key in ("open", "high", "low", "close"))
        ]


ADAPTERS = {"alpaca": AlpacaAdapter, "oanda": OandaAdapter, "tradier": TradierAdapter}


def _aggregate_candles(candles: list[dict], hours: int):
    buckets: dict[datetime, list[dict]] = {}
    for candle in candles:
        timestamp = datetime.fromisoformat(candle["t"].replace("Z", "+00:00")).astimezone(timezone.utc)
        bucket = timestamp.replace(hour=(timestamp.hour // hours) * hours, minute=0, second=0, microsecond=0)
        buckets.setdefault(bucket, []).append(candle)
    aggregated = []
    for timestamp, group in sorted(buckets.items()):
        aggregated.append({
            "t": timestamp.isoformat().replace("+00:00", "Z"),
            "o": group[0]["o"],
            "h": max(candle["h"] for candle in group),
            "l": min(candle["l"] for candle in group),
            "c": group[-1]["c"],
        })
    return aggregated


def get_adapter(broker: str, credentials: dict[str, str], environment: str):
    return ADAPTERS[broker](credentials, environment)
