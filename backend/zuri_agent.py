"""Pure logic behind Zuri's agent abilities: tool definitions, action validation, chart digests,
proactive nudges, guided walkthroughs and memory ranking. No network or database access lives here."""

import math
import re
from datetime import datetime, timedelta, timezone

SECTIONS = ("Charts", "Dashboard", "Trade", "History", "Journal", "Settings")
TIMEFRAMES = ("1m", "5m", "15m", "1h", "4h", "1D", "1W")
SYMBOL_ALIASES = {
    "XAUUSD": "GOLD", "XAU": "GOLD", "BTC": "BTCUSD", "BITCOIN": "BTCUSD", "XBTUSD": "BTCUSD",
    "ETH": "ETHUSD", "ETHEREUM": "ETHUSD", "SOL": "SOLUSD", "SOLANA": "SOLUSD", "EUR": "EURUSD", "APPLE": "AAPL",
}
BROKER_SYMBOLS = {"GOLD": "XAUUSD"}
RISK_LIMITS = {"max_trade_risk_percent": (0.05, 3.0), "max_daily_loss_percent": (0.1, 10.0)}
FACT_CATEGORIES = ("goal", "worry", "preference", "knowledge_gap", "trading_style", "milestone", "risk_habit", "personal_context", "lesson", "general")

READ_TOOL_NAMES = ("recall_memory", "get_trading_history", "get_chart_data")
ACTION_TOOL_NAMES = ("open_chart", "add_to_watchlist", "remove_from_watchlist", "set_risk_limits", "navigate", "start_walkthrough", "look_at_screen", "propose_trade")
MAX_TRADE_QUANTITY = 100000

WALKTHROUGH_GOALS = ("analyze_chart", "open_chart", "add_to_watchlist", "set_risk_limits", "place_paper_trade", "write_journal", "link_broker", "site_tour")

INVOLVEMENT_LEVELS = {
    "side_by_side": "Side-by-side buddy: I stay close, comment on what they do and check in often.",
    "occasional": "Occasional buddy: I step in for meaningful moments and otherwise leave them to it.",
    "on_demand": "Need-to-know buddy: I stay quiet unless they ask me or something important needs their attention.",
}
TOUR_DETAILS = ("none", "quick", "detailed")

MARKET_NAMES = ("Stocks", "Crypto", "Forex", "Commodities")
MARKET_LEVELS = {"new": 0, "learning": 1, "comfortable": 2, "expert": 3}


def build_market_layout(levels: dict, markets: list[str] | None = None) -> dict:
    """Turns how well the user knows each market into how the Quotes panel is laid out, so several markets never crowd the screen.

    One market: a plain list. Several markets with at least one the user is new to: show one market at a time (tabs), starting with the one
    they know best. Several markets they all know: grouped sections, with the markets they know least collapsed. 'simple' detail hides
    day range and volume for markets the user is still learning."""
    chosen = [m for m in dict.fromkeys(list(markets or []) + list(levels or {})) if m in MARKET_NAMES]
    rank = {m: MARKET_LEVELS.get(str((levels or {}).get(m, "learning")).lower(), 1) for m in chosen}
    order = sorted(chosen, key=lambda m: (-rank[m], chosen.index(m)))
    entries = [{"market": m, "level": next(k for k, v in MARKET_LEVELS.items() if v == rank[m]), "detail": "simple" if rank[m] <= 1 else "full"} for m in order]
    if len(order) <= 1:
        mode = "list"
    elif any(rank[m] == 0 for m in order) or len(order) >= 4 and any(rank[m] <= 1 for m in order):
        mode = "tabs"
    else:
        mode = "sections"
    for entry in entries:
        entry["collapsed"] = mode == "sections" and entry["level"] in ("new", "learning")
    return {"mode": mode, "focus": order[0] if order else None, "markets": entries}

_DONE_PHRASES = re.compile(
    r"^\s*(no|nope|nah|nothing|nothing else|nothing more|that'?s (all|it|everything)|i'?m (good|done|set|ready)|all good|all done|that is all|"
    r"let'?s (go|start|move on|continue)|move on|continue|ready|lets go|no thanks|no thank you)\W*\s*$", re.IGNORECASE)
_MORE_CUES = re.compile(r"\b(also|and|but|oh|wait|one more|another thing|actually|i want to|i also|let me)\b", re.IGNORECASE)


def onboarding_signal(text: str) -> str | None:
    """'done' when the user clearly says they have nothing more to add, 'more' when they clearly are not finished, else None (the model decides)."""
    clean = (text or "").strip()
    if _DONE_PHRASES.match(clean):
        return "done"
    if len(clean) > 120 or _MORE_CUES.search(clean[:60]) and clean.endswith(("...", "…", ",")):
        return "more"
    return None


def _tool(name: str, description: str, properties: dict | None = None, required: list[str] | None = None) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties or {}, "required": required or []},
    }}


_SYMBOL = {"type": "string", "description": "Instrument symbol, e.g. GOLD (XAUUSD works too), BTCUSD, EURUSD, AAPL."}
_TIMEFRAME = {"type": "string", "enum": list(TIMEFRAMES)}

READ_TOOLS = [
    _tool("recall_memory", "Search EVERYTHING Zuri has ever stored about this user (facts, summaries and every past message since sign-up). "
          "Use it whenever the user refers to the past or you need a detail you do not see in your memory notes.",
          {"query": {"type": "string", "description": "Words to look for, e.g. 'stop loss gold revenge trade'."}}, ["query"]),
    _tool("get_trading_history", "Lifetime trading and journal statistics from the user's first activity until now (trades, win rate, habits, journal discipline)."),
    _tool("get_chart_data", "Recent real candles for a symbol from the user's linked broker, summarised into trend, momentum, volatility and key levels. "
          "Use this before giving a chart analysis.", {"symbol": _SYMBOL, "timeframe": _TIMEFRAME}, ["symbol"]),
]

ACTION_TOOLS = [
    _tool("open_chart", "Propose opening a symbol's chart (optionally on a timeframe) on the user's screen. The user must approve it.",
          {"symbol": _SYMBOL, "timeframe": _TIMEFRAME}, ["symbol"]),
    _tool("add_to_watchlist", "Propose adding a symbol to the user's watchlist. The user must approve it.", {"symbol": _SYMBOL}, ["symbol"]),
    _tool("remove_from_watchlist", "Propose removing a symbol from the user's watchlist. The user must approve it.", {"symbol": _SYMBOL}, ["symbol"]),
    _tool("set_risk_limits", "Propose new risk limits. The user must approve it. Per-trade 0.05-3 percent, daily loss 0.1-10 percent of equity.",
          {"max_trade_risk_percent": {"type": "number"}, "max_daily_loss_percent": {"type": "number"}}),
    _tool("navigate", "Propose switching the screen to a section. The user must approve it.", {"section": {"type": "string", "enum": list(SECTIONS)}}, ["section"]),
    _tool("start_walkthrough", "Propose taking over the screen to walk the user through a task step by step, highlighting each control. "
          "Only after the user said they want the step-by-step breakdown. The user must approve it.",
          {"goal": {"type": "string", "enum": list(WALKTHROUGH_GOALS)}, "symbol": _SYMBOL, "timeframe": _TIMEFRAME,
           "side": {"type": "string", "enum": ["buy", "sell"]}, "detail": {"type": "string", "enum": ["quick", "detailed"]}, "max_trade_risk_percent": {"type": "number"}, "max_daily_loss_percent": {"type": "number"}},
          ["goal"]),
    _tool("propose_trade", "Propose ONE market order on the user's linked broker. This only creates a confirmation card; the user must review it and press a separate confirm button "
          "(and type CONFIRM LIVE on a live account). Use it ONLY after the user has clearly said which symbol, which side (buy or sell) and what quantity they want and wants you to line it up, "
          "or after the user clearly said yes to a trade you suggested with that exact symbol, side and quantity in your previous message. "
          "Never invent or round up a size, never propose a trade nobody agreed to, and never propose more than one.",
          {"symbol": _SYMBOL, "side": {"type": "string", "enum": ["buy", "sell"]}, "quantity": {"type": "number", "description": "Units/lots exactly as the user asked."},
           "stop_loss": {"type": "number", "description": "Price. Only if the user gave one; must be set together with take_profit."},
           "take_profit": {"type": "number", "description": "Price. Only if the user gave one; must be set together with stop_loss."}},
          ["symbol", "side", "quantity"]),
    _tool("look_at_screen", "Ask the user to let you look at an actual picture of their screen (the browser asks for their permission). "
          "Use when you need to see the chart itself."),
]


def normalize_symbol(raw: object, available: list[str] | None = None) -> str | None:
    """Maps what a person typed (XAUUSD, btc/usd, Bitcoin) to a symbol that exists in the workspace."""
    if not isinstance(raw, str):
        return None
    cleaned = re.sub(r"[^A-Za-z0-9.]", "", raw).upper()
    if not cleaned:
        return None
    symbol = SYMBOL_ALIASES.get(cleaned, cleaned)
    if available is None:
        return symbol
    allowed = {s.upper() for s in available}
    return symbol if symbol in allowed else None


def validate_risk_limits(args: dict) -> dict:
    clean: dict = {}
    for key, (low, high) in RISK_LIMITS.items():
        if args.get(key) is None:
            continue
        try:
            value = float(args[key])
        except (TypeError, ValueError):
            raise ValueError(f"{key} must be a number.")
        if not math.isfinite(value) or value < low or value > high:
            raise ValueError(f"{key} must be between {low} and {high} percent.")
        clean[key] = round(value, 2)
    if not clean:
        raise ValueError("Give at least one limit to change.")
    return clean


_DONE_VERBS = r"opened|placed|sent|executed|submitted|set|added|removed|switched|changed|saved|filled|bought|sold|closed|navigated|updated|applied|taken|started"
_CLAIM_PATTERNS = (
    re.compile(rf"\b(?:i|we)(?:[’']ve|\s+have)?\s+(?:just\s+|already\s+|now\s+|successfully\s+)?(?:{_DONE_VERBS})\b", re.I),
    re.compile(rf"\b(?:order|trade|limits?|watchlist|chart)\b[^.!?\n]{{0,40}}\b(?:has been|have been|was|were|is now|are now)\s+(?:{_DONE_VERBS})\b", re.I),
    re.compile(r"^\W*(?:done|all set|it'?s done)\b", re.I),
)


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def unsupported_claims(reply: str) -> list[str]:
    """Sentences claiming something was already done. In Zuri nothing is ever done by her: actions only happen after the user's own click,
    and the app (not the model) reports that. So any such claim in a model reply is false by construction."""
    return [s.strip() for s in _sentences(reply) if any(p.search(s) for p in _CLAIM_PATTERNS)]


def strip_claims(reply: str) -> str:
    bad = set(unsupported_claims(reply))
    return " ".join(s.strip() for s in _sentences(reply) if s.strip() not in bad)


def status_footer(actions: list[dict], rejections: list[str]) -> str:
    """Server-written, always-true summary of what is lined up and what was refused."""
    if not rejections:
        return ""
    lines = []
    if actions:
        lines.append("Lined up for your approval (nothing has happened yet):\n" + "\n".join(f"• {a['label']}" for a in actions))
    lines.append("Not lined up:\n" + "\n".join(f"• {r}" for r in dict.fromkeys(rejections)))
    return "\n\n" + "\n\n".join(lines)


_AFFIRM = re.compile(
    r"^\s*(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|let'?s do it|set it up|line it up|sounds good|that works|i agree|agreed|"
    r"yes please|yes do it|yes set it up|yes line it up|ok do it|okay do it|ok set it up|okay set it up|ok line it up|okay line it up)(\s+(please|thanks|thank you|then))?\W*\s*$",
    re.IGNORECASE)


def is_affirmation(text: str) -> bool:
    """True only for a short, unmistakable yes. Anything longer or with a negation is not an agreement to a trade."""
    clean = (text or "").strip()
    return len(clean.split()) <= 6 and bool(_AFFIRM.match(clean)) and not re.search(r"\b(no|not|don'?t|dont|never|wait|stop|cancel|but)\b", clean, re.IGNORECASE)


def _numbers_in(text: str) -> list[float]:
    found = []
    for raw in re.findall(r"\d[\d,]*\.?\d*|\.\d+", text):
        try:
            found.append(float(raw.replace(",", "")))
        except ValueError:
            pass
    return found


def check_grounded(action: dict, user_text: str) -> None:
    """Deterministic guard: money-affecting proposals must repeat what the user actually wrote.
    The model cannot swap in its own symbol, side, size, price or limit. Raises ValueError with a message the model can read."""
    if action["type"] not in ("propose_trade", "set_risk_limits"):
        return
    numbers = _numbers_in(user_text)

    def said(value: float) -> bool:
        return any(math.isclose(value, n, rel_tol=1e-9, abs_tol=1e-9) for n in numbers)

    args = action["args"]
    if action["type"] == "set_risk_limits":
        for key, value in args.items():
            if not said(value):
                raise ValueError(f"The user never asked for {value}% as {key.replace('_', ' ')}. Only use numbers the user wrote; ask them what they want.")
        return
    squashed = re.sub(r"[^A-Z0-9]", "", user_text.upper())
    symbol, broker_symbol = args["symbol"], args["broker_symbol"]
    names = {symbol, broker_symbol} | {alias for alias, target in SYMBOL_ALIASES.items() if target == symbol}
    if not any(name in squashed for name in names):
        raise ValueError(f"The user has not named {broker_symbol}. Ask which instrument they want to trade.")
    words = set(re.findall(r"[a-z]+", user_text.lower()))
    side_words = {"buy": {"buy", "long", "bought", "buying"}, "sell": {"sell", "short", "sold", "selling"}}[args["side"]]
    if not words & side_words:
        raise ValueError(f"The user has not said whether to {args['side']}. Ask them: buy or sell?")
    for key, label in (("quantity", "quantity"), ("stop_loss", "stop-loss"), ("take_profit", "take-profit")):
        if key in args and not said(args[key]):
            raise ValueError(f"The user never gave {args[key]:g} as the {label}. Only use numbers the user wrote; ask them for it.")


def sanitize_action(name: str, args: dict, available: list[str]) -> dict:
    """Validates a model-proposed action. Returns {type, args, label} or raises ValueError with a message the model can read."""
    if name in ("open_chart", "add_to_watchlist", "remove_from_watchlist"):
        symbol = normalize_symbol(args.get("symbol"), available)
        if not symbol:
            raise ValueError(f"'{args.get('symbol')}' is not available in this workspace. Available symbols: {', '.join(available)}.")
        timeframe = args.get("timeframe") if args.get("timeframe") in TIMEFRAMES else None
        if name == "open_chart":
            return {"type": name, "args": {"symbol": symbol, **({"timeframe": timeframe} if timeframe else {})},
                    "label": f"Open the {symbol} chart" + (f" on {timeframe}" if timeframe else "")}
        verb = "Add" if name == "add_to_watchlist" else "Remove"
        return {"type": name, "args": {"symbol": symbol}, "label": f"{verb} {symbol} {'to' if verb == 'Add' else 'from'} your watchlist"}
    if name == "set_risk_limits":
        limits = validate_risk_limits(args)
        parts = []
        if "max_trade_risk_percent" in limits:
            parts.append(f"{limits['max_trade_risk_percent']}% per trade")
        if "max_daily_loss_percent" in limits:
            parts.append(f"{limits['max_daily_loss_percent']}% daily loss")
        return {"type": name, "args": limits, "label": "Set your risk limits: " + " and ".join(parts)}
    if name == "navigate":
        if args.get("section") not in SECTIONS:
            raise ValueError(f"section must be one of {', '.join(SECTIONS)}.")
        return {"type": name, "args": {"section": args["section"]}, "label": f"Go to {args['section']}"}
    if name == "start_walkthrough":
        walkthrough = build_walkthrough(str(args.get("goal")), args, available)
        if walkthrough is None:
            raise ValueError(f"goal must be one of {', '.join(WALKTHROUGH_GOALS)} (and symbols must exist in the workspace).")
        return {"type": name, "args": {"walkthrough": walkthrough}, "label": f"Take me through it: {walkthrough['title']}"}
    if name == "propose_trade":
        symbol = normalize_symbol(args.get("symbol"), available)
        if not symbol:
            raise ValueError(f"'{args.get('symbol')}' is not available in this workspace. Available symbols: {', '.join(available)}.")
        side = str(args.get("side", "")).lower()
        if side not in ("buy", "sell"):
            raise ValueError("side must be buy or sell.")
        try:
            quantity = float(args.get("quantity"))
        except (TypeError, ValueError):
            raise ValueError("quantity must be a number the user asked for.")
        if not math.isfinite(quantity) or quantity <= 0 or quantity > MAX_TRADE_QUANTITY:
            raise ValueError(f"quantity must be above 0 and at most {MAX_TRADE_QUANTITY}.")
        stop, target = args.get("stop_loss"), args.get("take_profit")
        if (stop is None) != (target is None):
            raise ValueError("Set stop_loss and take_profit together, or neither.")
        clean: dict = {"symbol": symbol, "broker_symbol": BROKER_SYMBOLS.get(symbol, symbol), "side": side, "quantity": quantity}
        if stop is not None:
            try:
                stop, target = float(stop), float(target)
            except (TypeError, ValueError):
                raise ValueError("stop_loss and take_profit must be prices.")
            if not (math.isfinite(stop) and math.isfinite(target) and stop > 0 and target > 0):
                raise ValueError("stop_loss and take_profit must be positive prices.")
            clean.update(stop_loss=stop, take_profit=target)
        label = f"{side.upper()} {quantity:g} {clean['broker_symbol']} at market"
        if stop is not None:
            label += f" · stop {stop:g} · target {target:g}"
        return {"type": name, "args": clean, "label": label}
    if name == "look_at_screen":
        return {"type": name, "args": {}, "label": "Let Zuri look at my screen"}
    raise ValueError(f"Unknown action '{name}'.")


def _step(section: str, target: str, title: str, body: str, **extra) -> dict:
    return {"section": section, "target": target, "title": title, "body": body, **extra}


def build_walkthrough(goal: str, params: dict, available: list[str]) -> dict | None:
    """A guided, spotlight-by-spotlight tour. Every target is a data-zuri-target in the frontend."""
    symbol = normalize_symbol(params.get("symbol"), available) if params.get("symbol") else None
    timeframe = params.get("timeframe") if params.get("timeframe") in TIMEFRAMES else None
    if params.get("symbol") and not symbol:
        return None
    name = symbol or "the chart"

    if goal == "open_chart":
        steps = [
            _step("Charts", "nav-Charts", "Open Charts", f"I've switched to Charts{f' and loaded {symbol}' if symbol else ''}. This is where you read the market.", symbol=symbol, timeframe=timeframe),
            _step("Charts", "chart-timeframes", "Pick your timeframe", "Short timeframes (1m-15m) show noise and fast moves; 1h-1D show the bigger structure. Choose the one that matches how long you want to hold."),
        ]
        return {"id": goal, "title": f"Open {name}", "steps": steps}

    if goal == "analyze_chart":
        steps = [
            _step("Charts", "nav-Charts", "Open the chart", f"I've opened {name}{f' on {timeframe}' if timeframe else ''} for you.", symbol=symbol, timeframe=timeframe),
            _step("Charts", "chart-timeframes", "Start with the bigger picture", "Look at a higher timeframe first (1D or 4h) to see the main trend, then step down to find your entry."),
            _step("Charts", "chart-panel", "Read the structure", "Mark the last swing highs and lows: those are your support and resistance. Note if price sits above or below the EMA 20 and whether highs and lows are rising or falling."),
            _step("Charts", "ai-takeaway", "Check Zuri's read", "This card shows the real day move for the symbol. Treat it as a cue to verify on the chart, not a signal."),
            _step("Charts", "journal-actions", "Write the plan before you act", "Use Long plan or Short plan to record entry, stop and target. Deciding the exit first is what keeps risk under control."),
        ]
        return {"id": goal, "title": f"Analyse {name}", "steps": steps}

    if goal == "add_to_watchlist":
        if not symbol:
            return None
        return {"id": goal, "title": f"Add {symbol} to your watchlist", "steps": [
            _step("Charts", "quotes-rail", "Your quotes", "This rail is your watchlist. Everything you follow lives here."),
            _step("Charts", "market-search", "Search the symbol", f"I typed {symbol} into the search box for you. Click the result to add it.", prefill={"field": "search", "value": symbol}),
        ]}

    if goal == "set_risk_limits":
        try:
            limits = validate_risk_limits(params)
        except ValueError:
            limits = {}
        trade = limits.get("max_trade_risk_percent")
        daily = limits.get("max_daily_loss_percent")
        steps = [
            _step("Settings", "nav-Settings", "Open Settings", "Risk limits live in Settings, under the Risk tab.", settings_tab="Risk"),
            _step("Settings", "settings-tabs", "The Risk tab", "These tabs group your settings. I've opened Risk."),
            _step("Settings", "risk-max-trade", "Max trade risk", f"This caps how much of your account one trade may lose. {f'I set it to {trade}%.' if trade is not None else 'A common guideline is 1-2% or less.'}",
                  **({"prefill": {"field": "max_trade_risk_percent", "value": trade}} if trade is not None else {})),
            _step("Settings", "risk-max-daily", "Max daily loss", f"This is your stop-for-the-day line. {f'I set it to {daily}%.' if daily is not None else 'Hitting it means you stop trading until tomorrow.'}",
                  **({"prefill": {"field": "max_daily_loss_percent", "value": daily}} if daily is not None else {})),
            _step("Settings", "settings-panel", "Saved automatically", "Changes save by themselves a moment after you edit them. You can adjust the numbers any time."),
        ]
        return {"id": goal, "title": "Set your risk limits", "steps": steps}

    if goal == "place_paper_trade":
        side = "sell" if params.get("side") == "sell" else "buy"
        return {"id": goal, "title": f"Place a practice {side} order" + (f" on {symbol}" if symbol else ""), "steps": [
            _step("Trade", "nav-Trade", "Open the Trade tab", "Orders are placed here.", symbol=symbol),
            _step("Trade", "trade-ticket", "Fill the ticket", f"Choose {side.upper()}, check the symbol, and size the order so a stop-out stays within your per-trade risk limit."),
            _step("Trade", "trade-ticket", "Add a stop and a target", "Enter both a stop-loss and a take-profit so the exit is decided before you enter."),
            _step("Trade", "trade-ticket", "You press send", "Tick the confirmation and send the order yourself. I never place trades for you."),
        ]}

    if goal == "write_journal":
        return {"id": goal, "title": "Write a journal note", "steps": [
            _step("Charts", "journal-actions", "Capture the idea", "Use Note, Long plan or Short plan to record what you see and why."),
            _step("Journal", "nav-Journal", "Review it later", "Your entries collect here. Re-reading them is how patterns in your own behaviour show up."),
        ]}

    if goal == "site_tour":
        detailed = params.get("detail") == "detailed"
        steps = [
            _step("Dashboard", "nav-Dashboard", "Your dashboard", "Home base: your account, open positions, today's news and your next steps with me."),
            _step("Charts", "nav-Charts", "Charts", "This is where you read the market. Pick a symbol on the right and a timeframe on top."),
            _step("Trade", "nav-Trade", "Trade", "Orders are placed here. Everything asks you to confirm first, and live-money orders need an extra safety phrase."),
            _step("Journal", "nav-Journal", "Journal", "Write why you take a trade. Reviewing it later is the fastest way to improve."),
            _step("Settings", "nav-Settings", "Settings", "Your broker link, risk limits and how involved I am all live here.", settings_tab="Broker"),
        ]
        if detailed:
            steps = [
                steps[0],
                _step("Charts", "nav-Charts", "Charts", "This is where you read the market."),
                _step("Charts", "chart-timeframes", "Timeframes", "Short timeframes (1m-15m) show noise and fast moves; 1h-1D show the bigger structure. Choose what matches how long you want to hold."),
                _step("Charts", "chart-panel", "The chart and price", "The headline price and its daily change sit here. Learn to read trend, support and resistance before anything else."),
                _step("Charts", "journal-actions", "Plans and notes", "Use Note, Long plan or Short plan to record entry, stop and target before you act."),
                _step("Charts", "quotes-rail", "Your watchlist", "Everything you follow lives in this rail. Search to add more."),
                steps[2],
                _step("Trade", "trade-ticket", "The order ticket", "Choose a side, size the order so a stop-out stays within your risk limit, and always set a stop and a target."),
                steps[3],
                _step("Settings", "nav-Settings", "Settings", "Broker connection, risk limits and account details.", settings_tab="Risk"),
                _step("Settings", "risk-max-trade", "Max trade risk", "This caps how much of your account one trade may lose. 1-2% or less is a common guideline."),
                _step("Settings", "risk-max-daily", "Max daily loss", "Your stop-for-the-day line. Hitting it means you stop trading until tomorrow."),
            ]
        return {"id": goal, "title": "A tour of Zuri" if detailed else "A quick look around", "steps": steps}

    if goal == "link_broker":
        return {"id": goal, "title": "Link your broker", "steps": [
            _step("Settings", "nav-Settings", "Open Settings", "Broker connections live in Settings.", settings_tab="Broker"),
            _step("Settings", "settings-panel", "Connect your account", "Choose a broker, paste the Key ID and Secret (trading permissions only, never withdrawals), and start with a paper account."),
        ]}
    return None


def chart_digest(bars: list[dict]) -> dict:
    """Trend, momentum, volatility and key levels computed from real candles, so the analysis rests on numbers."""
    closes = [float(b["c"]) for b in bars]
    highs = [float(b["h"]) for b in bars]
    lows = [float(b["l"]) for b in bars]
    if len(closes) < 5:
        return {"error": "Not enough candles to analyse."}

    def sma(values: list[float], n: int) -> float | None:
        return sum(values[-n:]) / n if len(values) >= n else None

    def rsi(values: list[float], n: int = 14) -> float | None:
        if len(values) <= n:
            return None
        gains = losses = 0.0
        for prev, cur in zip(values[-n - 1:-1], values[-n:]):
            change = cur - prev
            gains += max(change, 0)
            losses += max(-change, 0)
        if losses == 0:
            return 100.0
        return 100 - 100 / (1 + gains / losses)

    def atr(n: int = 14) -> float | None:
        if len(closes) <= n:
            return None
        ranges = [max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])) for i in range(len(closes) - n, len(closes))]
        return sum(ranges) / n

    last = closes[-1]
    sma20, sma50 = sma(closes, 20), sma(closes, 50)
    window = min(len(bars), 30)
    swing_highs = [highs[i] for i in range(len(highs) - window + 1, len(highs) - 1) if highs[i] >= highs[i - 1] and highs[i] >= highs[i + 1]]
    swing_lows = [lows[i] for i in range(len(lows) - window + 1, len(lows) - 1) if lows[i] <= lows[i - 1] and lows[i] <= lows[i + 1]]
    resistance = sorted({round(h, 5) for h in swing_highs if h > last})[:3]
    support = sorted({round(l, 5) for l in swing_lows if l < last}, reverse=True)[:3]
    if sma20 is not None and sma50 is not None:
        trend = "uptrend" if last > sma20 > sma50 else "downtrend" if last < sma20 < sma50 else "mixed / ranging"
    elif sma20 is not None:
        trend = "above its 20-bar average" if last > sma20 else "below its 20-bar average"
    else:
        trend = "too little data for a trend"
    rsi14, atr14 = rsi(closes), atr()

    def r(value: float | None) -> float | None:
        return None if value is None else round(value, 5)

    return {
        "candles": len(bars), "from": bars[0]["t"], "to": bars[-1]["t"], "last_close": r(last),
        "change_over_period_pct": round((last - closes[0]) / closes[0] * 100, 2) if closes[0] else None,
        "period_high": r(max(highs)), "period_low": r(min(lows)),
        "sma20": r(sma20), "sma50": r(sma50), "trend": trend,
        "rsi14": None if rsi14 is None else round(rsi14, 1),
        "rsi_reading": None if rsi14 is None else "overbought" if rsi14 >= 70 else "oversold" if rsi14 <= 30 else "neutral",
        "atr14": r(atr14), "atr_pct_of_price": None if atr14 is None else round(atr14 / last * 100, 2),
        "nearest_support_levels": support, "nearest_resistance_levels": resistance,
        "last_5_closes": [r(c) for c in closes[-5:]],
    }


def lookback_for(timeframe: str, bars: int = 160) -> timedelta:
    minutes = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1D": 1440 * 1.5, "1W": 10080 * 1.2}[timeframe]
    return timedelta(minutes=minutes * bars)


_STOPWORDS = {"this", "that", "with", "have", "what", "when", "your", "from", "about", "would", "could", "should", "there", "their", "them", "then", "than", "into", "just", "like", "also", "been", "were", "will", "does", "dont", "zuri"}


def keywords(text: str) -> list[str]:
    return list(dict.fromkeys(w for w in re.findall(r"[a-z0-9]{3,}", text.lower()) if w not in _STOPWORDS))[:12]


def rank_facts(facts: list[dict], query: str, limit: int = 60) -> list[dict]:
    """Importance first, then relevance to what is being discussed, then recency. Nothing is deleted; this only chooses what fits in the prompt."""
    words = keywords(query)
    total = max(len(facts), 1)
    scored = []
    for index, fact in enumerate(facts):  # facts arrive newest first
        text = str(fact.get("fact", "")).lower()
        score = int(fact.get("importance") or 3) * 2 + 6 * sum(1 for w in words if w in text) + (total - index) / total
        scored.append((score, index, fact))
    best = sorted(scored, key=lambda item: (-item[0], item[1]))[:limit]
    return [fact for _, _, fact in sorted(best, key=lambda item: item[1], reverse=True)]


def _parse_ts(value: object) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def compute_nudges(positions: list[dict], equity: float | None, limits: dict, events: list[dict], entries: list[dict], now: datetime | None = None) -> list[dict]:
    """Things a good mentor would notice unprompted. Every nudge has a stable dedupe key so it fires once."""
    now = now or datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    nudges: list[dict] = []
    trade_limit = float(limits.get("max_trade_risk_percent") or 0)
    daily_limit = float(limits.get("max_daily_loss_percent") or 0)

    if equity and equity > 0:
        for position in positions:
            pl = position.get("unrealized_pl")
            if not isinstance(pl, (int, float)) or pl >= 0 or not trade_limit:
                continue
            loss_pct = -pl / equity * 100
            if loss_pct > trade_limit:
                symbol = str(position.get("symbol", "")).upper()
                nudges.append({
                    "kind": "risk_breach", "dedupe_key": f"risk:{symbol}:{today}", "severity": "alert", "symbol": symbol,
                    "title": f"{symbol} has gone past your per-trade risk limit",
                    "body": f"This position is down about {loss_pct:.2f}% of your account, and your limit is {trade_limit}% per trade. "
                            "Let's decide calmly: is the original reason for the trade still valid, or is it time to cut it?",
                })
        total = sum(p["unrealized_pl"] for p in positions if isinstance(p.get("unrealized_pl"), (int, float)))
        if daily_limit and total < 0:
            used = -total / equity * 100
            if used >= daily_limit:
                nudges.append({
                    "kind": "daily_loss", "dedupe_key": f"daily:{today}:limit", "severity": "alert", "symbol": None,
                    "title": "You've hit your daily loss limit",
                    "body": f"Your open positions are down about {used:.2f}% of your account today, past your {daily_limit}% daily limit. "
                            "This is exactly the moment your rules were made for. Want to talk through what to do next?",
                })
            elif used >= daily_limit * 0.8:
                nudges.append({
                    "kind": "daily_loss", "dedupe_key": f"daily:{today}:warning", "severity": "warning", "symbol": None,
                    "title": "You're close to your daily loss limit",
                    "body": f"You're about {used:.2f}% down against a {daily_limit}% daily limit. Slow down before the next decision.",
                })

    latest_by_symbol: dict[str, dict] = {}
    for event in events:
        if event.get("kind") not in ("order_placed", "position_detected"):
            continue
        symbol = str(event.get("symbol") or "").upper()
        created = _parse_ts(event.get("created_at"))
        if not symbol or created is None or now - created > timedelta(hours=72) or now - created < timedelta(minutes=5):
            continue
        if symbol not in latest_by_symbol or created > latest_by_symbol[symbol]["created"]:
            latest_by_symbol[symbol] = {"created": created, "event": event}
    for symbol, item in latest_by_symbol.items():
        has_note = any(
            str(e.get("symbol") or "").upper() == symbol and (_parse_ts(e.get("created_at")) or now) >= item["created"] - timedelta(hours=2)
            for e in entries
        )
        if not has_note:
            key = item["event"].get("id") or item["created"].isoformat()
            nudges.append({
                "kind": "journal_missing", "dedupe_key": f"journal:{symbol}:{key}", "severity": "info", "symbol": symbol,
                "title": f"Your {symbol} trade has no journal note",
                "body": "A trade you took has no note yet. Two minutes now (why you entered, how you felt, what you'd change) is worth more than it looks. Want me to help you write it?",
            })
    return nudges


# --- Coaching depth: how hard Zuri pushes, driven by evidence of what the user has actually done -----------------

COACHING_STAGES = ("Foundations", "Developing", "Proficient", "Advanced")


def coaching_stage(signals: dict) -> tuple[int, int]:
    """Returns (stage index, score). The score only rises with real activity, so Zuri never pushes harder than the user has earned.
    Expected signals: tenure_days, conversations, journal_notes, traded, quiz_level, experience."""
    def num(key: str) -> float:
        try:
            return float(signals.get(key) or 0)
        except (TypeError, ValueError):
            return 0.0

    score = sum(1 for bar in (5, 20, 60, 150) if num("conversations") >= bar)
    score += sum(1 for bar in (14, 60, 180) if num("tenure_days") >= bar)
    score += sum(1 for bar in (3, 15, 40) if num("journal_notes") >= bar)
    score += 1 if signals.get("traded") else 0
    score += {"building": 1, "advancing": 2}.get(str(signals.get("quiz_level")), 0)
    score += 1 if signals.get("experience") == "Experienced" else 0
    stage = 0 if score <= 2 else 1 if score <= 5 else 2 if score <= 8 else 3
    return stage, score


_STAGE_RULES = (
    "TERMINOLOGY: use the proper trading term every time, but pair each NEW term with a one-line plain definition and one example (from their own recorded activity only if it truly appears in their verified data; otherwise a clearly generic example). Introduce at most ONE new term per answer. "
    "CHALLENGE: ask ONE small question that makes them reason (for example 'what would make this setup wrong?'), then help them reach the answer instead of handing it over. Keep it encouraging and short.",
    "TERMINOLOGY: use standard terms (R-multiple, risk-reward, drawdown, liquidity, support/resistance, confluence, invalidation) without defining ones you already taught; define only genuinely new ones. Up to two new terms per answer. "
    "CHALLENGE: before revealing your read, ask them to predict or commit to a view (direction, invalidation level, size versus their risk limit), then compare. End with one probing question about their reasoning or risk.",
    "TERMINOLOGY: speak like a colleague: expectancy, position sizing, correlation, regime, volatility clustering, slippage, structure, order flow, skew. Define only what is rare. "
    "CHALLENGE: push their reasoning hard but kindly: ask for the thesis, the invalidation, the scenario that loses, and how the idea fits their own recorded habits and past mistakes. Ask for a trade plan before you comment on it, point out inconsistencies, and make them defend choices.",
    "TERMINOLOGY: use professional vocabulary freely and precisely (edge, expectancy, tail risk, Kelly-style sizing caveats, MAE/MFE, drawdown recovery maths, regime shifts, process versus outcome). Do not simplify. "
    "CHALLENGE: act as a demanding sparring partner: stress-test every idea with a counter-thesis, quantify with their own journal and stats, ask them to review their own process before you do, and set a concrete skill to work on next.",
)


def coaching_directive(signals: dict, open_gaps: list[str] | None = None) -> str:
    stage, score = coaching_stage(signals)
    gaps = [g for g in (open_gaps or []) if g][:4]
    text = (
        f"\n<coaching_plan stage=\"{COACHING_STAGES[stage]}\" evidence_score=\"{score}\">\n"
        "Your job is to make this person a better trader every time they use Zuri, not just to answer. This plan OVERRIDES the generic style of any earlier instruction. "
        "Every reply must contain real teaching: at least one concept, mechanism or rule of thumb explained in the vocabulary of the stage below, tied to what they just said, BEFORE any questions. Questions alone are never a complete reply. "
        "If you need clarification, ask at most two questions and phrase them in stage vocabulary (for example 'was your stop inside the average true range?', not 'how far is your stop?'). "
        + _STAGE_RULES[stage] + " "
        "ALWAYS: (a) teach the reasoning behind a conclusion, not only the conclusion; (b) tie lessons to THEIR own trades, journal, limits and remembered mistakes, naming them specifically, but ONLY ones that really appear in their verified data or memory; never invent a trade, journal entry or habit, and if there is no data say so and use a generic example; "
        "(c) never give a buy/sell call or promise outcomes, so make them form the view; (d) if they struggle or look frustrated, step back one level and be supportive; "
        "(e) praise real, specific improvement you can see in their data, and do not flatter; (f) if they ask for a quick answer or an action, do it first, then add the coaching in one or two lines. "
    )
    if gaps:
        text += (
            "OPEN KNOWLEDGE GAPS you noted earlier (revisit one naturally when relevant, by asking them to explain it back in their own words, and when they get it right, say so): " + " | ".join(gaps) + ". "
        )
    return text + "</coaching_plan>"


# --- Deterministic reading of explicit commands -------------------------------------------------
# The model is unreliable at deciding WHEN to call a tool. When the user's latest message is an unambiguous
# command, code reads it directly. The results still go through sanitize_action + check_grounded and still
# need the user's own click, so this can only line up exactly what was written.

_NUM = r"(\d[\d,]*(?:\.\d+)?)"
_HEDGE = re.compile(r"\?|\b(?:should|would|could|might|maybe|what if|how (?:do|would|about)|thinking|wondering|do you think|if i)\b", re.I)
_TRADE_VERB = re.compile(r"\b(buy|sell|long|short)\b", re.I)
_STOP = re.compile(rf"\b(?:stop(?:[\s-]*loss)?|sl)\b\s*(?:at|of|@|:|=|to)?\s*{_NUM}", re.I)
_TARGET = re.compile(rf"\b(?:target|take[\s-]*profit|tp)\b\s*(?:at|of|@|:|=|to)?\s*{_NUM}", re.I)
_SET_VERB = re.compile(r"\b(?:set|change|make|update|adjust|raise|lower|increase|decrease|put|cap|limit)\b", re.I)
_TRADE_LIMIT = (
    re.compile(rf"(?:trade\s+risk|risk\s+(?:per|a|each)\s+trade|per[\s-]*trade(?:\s+risk)?)(?:(?!daily)[^\d]){{0,30}}{_NUM}", re.I),
    re.compile(rf"{_NUM}\s*%?\s*(?:as\s+|for\s+)?(?:my\s+)?(?:max(?:imum)?\s+)?(?:risk\s+per\s+trade|per[\s-]*trade\s+risk|trade\s+risk)", re.I),
)
_DAILY_LIMIT = (
    re.compile(rf"(?:daily\s+(?:loss|drawdown)(?:\s+limit)?|daily\s+limit)(?:(?!trade)[^\d]){{0,30}}{_NUM}", re.I),
    re.compile(rf"{_NUM}\s*%?\s*(?:as\s+|for\s+)?(?:my\s+)?(?:max(?:imum)?\s+)?daily\s+(?:loss|drawdown|limit)", re.I),
)
_OPEN_VERB = re.compile(r"\b(?:open|show|pull\s+up|bring\s+up|load|go\s+to|switch\s+to|look\s+at|analy[sz]e|analysis|chart)\b", re.I)
_TIMEFRAME_WORDS = (
    (re.compile(r"\b(?:1\s*m(?:in)?|one\s+minute)\b", re.I), "1m"), (re.compile(r"\b(?:5\s*m(?:in)?|five\s+minute)\b", re.I), "5m"),
    (re.compile(r"\b(?:15\s*m(?:in)?|fifteen\s+minute)\b", re.I), "15m"), (re.compile(r"\b(?:4\s*h(?:r|our)?|four\s+hour)\b", re.I), "4h"),
    (re.compile(r"\b(?:1\s*h(?:r|our)?|hourly|one\s+hour)\b", re.I), "1h"), (re.compile(r"\b(?:1\s*d|daily|day\s+chart)\b", re.I), "1D"),
    (re.compile(r"\b(?:1\s*w|weekly)\b", re.I), "1W"),
)


def _to_float(raw: str) -> float:
    return float(raw.replace(",", ""))


def _symbols_in(text: str, available: list[str]) -> list[str]:
    found: list[str] = []
    for token in re.findall(r"[A-Za-z0-9./]+", text):
        symbol = normalize_symbol(token, available)
        if symbol and symbol not in found:
            found.append(symbol)
    return found


def extract_intents(text: str, available: list[str]) -> list[tuple[str, dict]]:
    """Reads the user's latest message and returns the (tool, args) calls it explicitly asks for. Hedged or incomplete requests return nothing."""
    text = (text or "").strip()
    if not text:
        return []
    verb = _TRADE_VERB.search(text)
    symbols = _symbols_in(text, available)
    if verb and len(symbols) == 1 and not _HEDGE.search(text):
        args: dict = {"symbol": symbols[0], "side": "buy" if verb.group(1).lower() in ("buy", "long") else "sell"}
        stop, target = _STOP.search(text), _TARGET.search(text)
        rest = _TARGET.sub(" ", _STOP.sub(" ", text[verb.end():]))
        quantity = re.search(_NUM, rest)
        if quantity:
            args["quantity"] = _to_float(quantity.group(1))
            if stop:
                args["stop_loss"] = _to_float(stop.group(1))
            if target:
                args["take_profit"] = _to_float(target.group(1))
            return [("propose_trade", args)]
    if _SET_VERB.search(text) and not _HEDGE.search(text):
        limits: dict = {}
        for key, patterns in (("max_trade_risk_percent", _TRADE_LIMIT), ("max_daily_loss_percent", _DAILY_LIMIT)):
            for pattern in patterns:
                match = pattern.search(text)
                if match:
                    limits[key] = _to_float(match.group(1))
                    break
        if limits:
            return [("set_risk_limits", limits)]
    if len(symbols) == 1 and _OPEN_VERB.search(text) and not (verb and verb.group(1).lower() != 'short'):
        args = {"symbol": symbols[0]}
        for pattern, timeframe in _TIMEFRAME_WORDS:
            if pattern.search(text):
                args["timeframe"] = timeframe
                break
        return [("open_chart", args)]
    return []
