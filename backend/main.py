import os
import json
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from groq import Groq

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")

app = FastAPI(
    title="Zuri Execution Engine",
    description="Flawless execution. Unbreakable discipline.",
    version="0.3.0"
)

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY")) if os.getenv("GROQ_API_KEY") else None

ALPACA_API_KEY = os.getenv("ALPACA_API_KEY")
ALPACA_SECRET_KEY = os.getenv("ALPACA_SECRET_KEY")
ALPACA_BASE_URL = "https://paper-api.alpaca.markets"
ALPACA_DATA_URL = "https://data.alpaca.markets"

MAX_RISK_PERCENTAGE_CAP = 3.0


def get_alpaca_headers():
    if not ALPACA_API_KEY or not ALPACA_SECRET_KEY:
        raise HTTPException(status_code=400, detail="Alpaca API keys missing in .env")
    return {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
        "Content-Type": "application/json"
    }


def get_groq_client():
    if groq_client is None:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY is missing. Add it to your environment or .env file.")
    return groq_client


class UserPrompt(BaseModel):
    prompt: str
    execute: bool = False


@app.get("/api/account")
def get_account_summary():
    headers = get_alpaca_headers()
    res = requests.get(f"{ALPACA_BASE_URL}/v2/account", headers=headers)
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Alpaca Error: {res.text}")
    data = res.json()
    return {
        "equity": float(data["equity"]),
        "buying_power": float(data["buying_power"]),
        "cash": float(data["cash"]),
        "currency": data["currency"]
    }


@app.get("/api/positions")
def get_open_positions():
    headers = get_alpaca_headers()
    res = requests.get(f"{ALPACA_BASE_URL}/v2/positions", headers=headers)
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Alpaca Error: {res.text}")

    positions = []
    for pos in res.json():
        positions.append({
            "symbol": pos["symbol"],
            "qty": int(pos["qty"]),
            "side": pos["side"],
            "avg_entry_price": float(pos["avg_entry_price"]),
            "current_price": float(pos["current_price"]),
            "market_value": float(pos["market_value"]),
            "unrealized_pl": float(pos["unrealized_pl"]),
            "unrealized_plpc": round(float(pos["unrealized_plpc"]) * 100, 2)
        })
    return {"positions": positions}


@app.get("/api/orders")
def get_open_orders():
    headers = get_alpaca_headers()
    res = requests.get(f"{ALPACA_BASE_URL}/v2/orders?status=open", headers=headers)
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Alpaca Error: {res.text}")

    orders = []
    for o in res.json():
        orders.append({
            "id": o["id"],
            "symbol": o["symbol"],
            "qty": int(o["qty"]),
            "side": o["side"],
            "type": o["type"],
            "status": o["status"]
        })
    return {"orders": orders}


@app.delete("/api/close-all")
def close_all_positions():
    headers = get_alpaca_headers()
    cancel_res = requests.delete(f"{ALPACA_BASE_URL}/v2/orders", headers=headers)
    close_res = requests.delete(f"{ALPACA_BASE_URL}/v2/positions?cancel_orders=true", headers=headers)

    if close_res.status_code not in (200, 207):
        raise HTTPException(status_code=500, detail=f"Liquidation Error: {close_res.text}")

    return {
        "status": "PANIC_SUCCESS",
        "message": "All pending orders cancelled and open positions liquidated.",
        "alpaca_response": close_res.json() if close_res.text else "Closed"
    }


@app.post("/api/parse-trade")
def parse_and_execute_trade(request: UserPrompt):
    system_prompt = """
    You are Zuri's execution engine parser. Extract trade details from the user prompt into raw JSON:
    {
        "action": "BUY" or "SELL",
        "ticker": "TICKER_SYMBOL",
        "risk_percentage": float,
        "stop_loss": float,
        "take_profit": float
    }
    Rules:
    - Respond strictly with valid JSON.
    - Extract numeric values only for risk_percentage, stop_loss, and take_profit.
    - Do not include conversational text or markdown blocks outside JSON.
    """

    client = get_groq_client()

    try:
        response = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": request.prompt}
            ],
            model="openai/gpt-oss-20b",
            response_format={"type": "json_object"},
            temperature=0.0
        )
        parsed = json.loads(response.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq parsing error: {str(e)}")

    action = str(parsed.get("action", "")).upper()
    ticker = str(parsed.get("ticker", "")).upper()
    requested_risk = float(parsed.get("risk_percentage", 0))
    stop_loss = float(parsed.get("stop_loss", 0))
    take_profit = float(parsed.get("take_profit", 0))

    effective_risk = min(requested_risk, MAX_RISK_PERCENTAGE_CAP)
    risk_capped_warning = None
    if requested_risk > MAX_RISK_PERCENTAGE_CAP:
        risk_capped_warning = f"Risk requested ({requested_risk}%) exceeded hard cap of {MAX_RISK_PERCENTAGE_CAP}%. Enforcing {MAX_RISK_PERCENTAGE_CAP}%."

    parsed["risk_percentage"] = effective_risk

    if not request.execute:
        return {
            "status": "parsed_only",
            "parsed_trade": parsed,
            "circuit_breaker_note": risk_capped_warning,
            "message": "Set 'execute': true to place order."
        }

    headers = get_alpaca_headers()
    acc_res = requests.get(f"{ALPACA_BASE_URL}/v2/account", headers=headers)
    equity = float(acc_res.json()["equity"])

    trade_res = requests.get(f"{ALPACA_DATA_URL}/v2/stocks/{ticker}/trades/latest", headers=headers)
    if trade_res.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Could not fetch price for ticker '{ticker}'")
    current_price = float(trade_res.json()["trade"]["p"])

    if action == "BUY":
        if not (stop_loss < current_price < take_profit):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid BUY targets: Stop loss (${stop_loss}) must be below current price (${current_price}), and take profit (${take_profit}) must be above."
            )
    elif action == "SELL":
        if not (take_profit < current_price < stop_loss):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid SHORT targets: Take profit (${take_profit}) must be below current price (${current_price}), and stop loss (${stop_loss}) must be above."
            )

    risk_amount = equity * (effective_risk / 100.0)
    stop_distance = abs(current_price - stop_loss)
    shares = int(risk_amount // stop_distance)
    if shares < 1:
        shares = 1

    order_payload = {
        "symbol": ticker,
        "qty": shares,
        "side": action.lower(),
        "type": "market",
        "time_in_force": "gtc",
        "order_class": "bracket",
        "take_profit": {"limit_price": take_profit},
        "stop_loss": {"stop_price": stop_loss}
    }

    order_res = requests.post(f"{ALPACA_BASE_URL}/v2/orders", headers=headers, json=order_payload)
    if order_res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"Alpaca Order Error: {order_res.text}")

    order_data = order_res.json()
    return {
        "status": "executed",
        "parsed_trade": parsed,
        "execution_details": {
            "calculated_shares": shares,
            "market_price_usd": current_price,
            "risk_amount_usd": round(risk_amount, 2),
            "alpaca_order_id": order_data.get("id")
        },
        "circuit_breaker_warning": risk_capped_warning
    }
