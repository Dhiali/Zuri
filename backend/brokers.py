import json
import os
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


ADAPTERS = {"alpaca": AlpacaAdapter, "oanda": OandaAdapter, "tradier": TradierAdapter}


def get_adapter(broker: str, credentials: dict[str, str], environment: str):
    return ADAPTERS[broker](credentials, environment)

