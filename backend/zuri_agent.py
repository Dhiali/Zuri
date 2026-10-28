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
_DONT_KNOW = re.compile(r"\b(i\s*don'?t\s*know|dont\s*know|idk|no\s*idea|not\s*sure|i\s*know\s*(nothing|very little))\b", re.IGNORECASE)
_MORE_CUES = re.compile(r"\b(also|and|but|oh|wait|one more|another thing|actually|i want to|i also|let me)\b", re.IGNORECASE)


def onboarding_signal(text: str) -> str | None:
    """'done' when the user clearly says they have nothing more to add, 'more' when they clearly are not finished, else None (the model decides)."""
    clean = (text or "").strip()
    if _DONE_PHRASES.match(clean):
        return "done"
    if len(clean) > 120 or _MORE_CUES.search(clean[:60]) and clean.endswith(("...", "…", ",")):
        return "more"
    return None


def decide_onboarding_move(model_next: str, signal: str | None, user_turns: list[str], known: dict) -> str:
    """Turns the model's read of the user's last message into a move, with guards so she never nags or stalls.
    Returns 'advance' (start setting them up), 'ask', 'reply' or 'choices'."""
    move = model_next if model_next in ("advance", "ask", "reply", "choices") else "choices"
    declined_before = sum(1 for turn in user_turns[:-1] if onboarding_signal(turn) == "done")
    knows_enough = bool(known.get("level") or known.get("goal")) and sum(1 for key in ("level", "goal", "markets", "time", "risk", "worries") if known.get(key) is True) >= 3
    if signal == "done":
        # They said they have nothing to add: one useful question is fine only if she knows very little and they have not declined before.
        return "advance" if (knows_enough or declined_before or move != "ask") else "ask"
    if signal == "more" and move == "advance":
        return "ask"
    if move in ("ask", "reply") and len(user_turns) >= 4:
        return "choices"
    if move == "ask" and user_turns and _DONT_KNOW.search(user_turns[-1]):
        # "I don't know" is an answer; asking another question just feels like an interrogation.
        return "choices"
    if move == "ask" and knows_enough and len(user_turns) >= 3:
        return "choices"
    return move


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


ALPACA_SIGNUP = "https://app.alpaca.markets/signup"
ALPACA_PAPER = "https://app.alpaca.markets/paper/dashboard/overview"


def _broker_steps() -> list[dict]:
    """Alpaca is the recommended first broker (free paper account, no money needed). Each step says exactly where to click and what to do."""
    return [
        _step("Settings", "nav-Settings", "Step 1 of 7: Open Settings", "A broker is the company that carries out your trades; Zuri never holds your money. We'll connect a free practice account with pretend money. You'll work in two places: this app and Alpaca's website.", settings_tab="Broker",
                  how=["Click Settings at the bottom of the menu on the left.", "Make sure the Broker tab is selected at the top of Settings.", "Keep this tab open: you'll open Alpaca's website in a new tab and come back here."]),
        _step("Settings", "broker-list", "Step 2 of 7: Create your free Alpaca account", "Alpaca's site opens in a new tab, so Zuri stays here for you to come back to.",
              how=["Click the button below to open Alpaca's sign-up page.", "Sign up with your email and a password (choose a paper-trading account if it asks; practice money only).", "Confirm your email if Alpaca sends you a verification link."],
              links=[{"label": "Open Alpaca sign-up", "url": ALPACA_SIGNUP}]),
        _step("Settings", "broker-list", "Step 3 of 7: Switch to your Paper account", "Alpaca has a real-money and a paper side. You want paper, so nothing real is ever at risk.",
              how=["Click the button below to open your Alpaca paper dashboard.", "Look at the account number in the top left corner. A paper account is the one you want; click that number to switch between accounts if you have more than one."],
              links=[{"label": "Open Alpaca paper dashboard", "url": ALPACA_PAPER}]),
        _step("Settings", "broker-list", "Step 4 of 7: Generate your API keys", "API keys are like a password that lets Zuri send orders to your practice account without ever seeing your login.",
              how=["On the paper dashboard, find the API Keys section on the right sidebar of the overview page.", "Click Generate New Keys.", "Copy the Key ID and the Secret Key. The secret is shown only once, so keep that tab open until you've pasted both into Zuri."]),
        _step("Settings", "broker-list", "Step 5 of 7: Come back and click Link account", "Return to this tab (Zuri).",
              how=["Find the Alpaca row in the list.", "Click its Link account button. A short form opens."]),
        _step("Settings", "broker-form", "Step 6 of 7: Paste your keys", "These fields are hidden as you type, which is normal.",
              how=["Paste the Key ID into API key ID.", "Paste the Secret Key into API secret key.", "Leave Environment on Paper / practice.", "Click Verify and link. Zuri checks the keys with Alpaca and stores them encrypted."]),
        _step("Settings", "broker-list", "Step 7 of 7: You're linked", "The Alpaca row should now say Paper account and show your practice balance. If you see an error, the usual causes are a key copied with a missing character, keys from the Live side, or an old key you regenerated. Generate fresh paper keys and try again, and ask me if you get stuck. Prefer another broker? OANDA (forex) and Tradier (stocks) also work and need their own token and account ID.",
              how=["Look at the Alpaca row. It should say Paper account and show your practice balance.", "Next, click Dashboard in the left menu and press Do it with me on the next-move card."]),
    ]


TOUR_HOW: dict[str, list[str]] = {
    "nav-Dashboard": ["Click Dashboard in the menu on the left. This is where you land each time you sign in."],
    "dash-weekly": ["Scroll to Weekly breakdown on the Dashboard.", "Read this week against last week, then the bars for each day.", "Press Ask Zuri for my weekly review once you have a few closed trades."],
    "dash-learn": ["Find Strategies and free learning on the Dashboard.", "Read the strategy ideas first, then click any video or course. Each opens in a new tab, so Zuri stays open here."],
    "nav-Charts": ["Click Charts in the menu on the left."],
    "chart-welcome": ["Click any market card to add it to your watchlist and open its chart.", "Then press Next. If you'd rather skip, I'll open a starter market for you."],
    "chart-timeframes": ["Find the row of timeframe buttons above the chart.", "Click one: 1m-15m for short trades, 1h-1D for the bigger picture."],
    "chart-panel": ["Look at the price and its move at the top of the chart.", "Follow the candles from left to right and see whether they're climbing, falling or sideways."],
    "journal-actions": ["Click Note, Long plan or Short plan under the chart.", "Write your entry, stop and target, then save. It appears in your Journal."],
    "quotes-rail": ["Look at the Quotes panel on the right.", "Click a symbol to open its chart, or type in Search quotes to add another market."],
    "news-charts": ["Scroll to the news list for your symbol.", "Click Ask Zuri on a story to get it explained, or send it to the backtest."],
    "chart-scanners": ["Find AI scanners below the chart.", "Describe a condition in your own words, for example: alert me when RSI drops below 30.", "Read the rule I draft, then click Activate."],
    "chart-backtest": ["Find Backtest a setup below the chart.", "Choose a setup, a date range and a timeframe, then click Run.", "Read the results: average return and the share of positive outcomes."],
    "chart-backtest-history": ["Look at the list of past runs under the backtest.", "Click View signals on one, Run again to repeat it, or Delete to remove it."],
    "nav-Trade": ["Click Trade in the menu on the left."],
    "trade-convo": ["Scroll below the ticket to the chat with me.", "Tell me your trade idea in your own words and answer my questions.", "Press the button that fills the ticket when we agree on a plan."],
    "trade-ticket": ["Check the symbol, Buy/Sell side, quantity, stop-loss and take-profit.", "Tick the confirmation, then click the order button yourself. Live orders also need the CONFIRM LIVE phrase."],
    "nav-History": ["Click History in the menu on the left."],
    "history-log": ["Choose a period from the date picker.", "Click Export CSV to download the log."],
    "history-tabs": ["Click Closed trades to see results.", "Click Orders to see every order sent, or Open positions to see what you hold now."],
    "history-snapshots": ["Click Snapshots.", "Open any trade to see the annotated chart I saved for it."],
    "nav-Journal": ["Click Journal in the menu on the left."],
    "journal-insights": ["Click Journal in the menu on the left.", "Find Zuri's journal and press Analyse my journey.", "Read each leak with its figures and the suggested fix."],
    "nav-Settings": ["Click Settings at the bottom of the menu on the left."],
    "settings-tabs": ["Click Risk in the tabs across the top of Settings."],
    "risk-max-trade": ["Find Max trade risk and type a percentage (1 means 1%)."],
    "risk-max-daily": ["Find Max daily loss and type a percentage (3 is a common choice).", "It saves by itself a moment later."],
    "zuri-next": ["Look at the Your best next move card at the top of the Dashboard.", "Click Do it with me and I'll walk you through it, one click at a time."],
}


def build_walkthrough(goal: str, params: dict, available: list[str]) -> dict | None:
    """A guided, spotlight-by-spotlight tour. Every target is a data-zuri-target in the frontend."""
    symbol = normalize_symbol(params.get("symbol"), available) if params.get("symbol") else None
    timeframe = params.get("timeframe") if params.get("timeframe") in TIMEFRAMES else None
    if params.get("symbol") and not symbol:
        return None
    name = symbol or "the chart"

    if goal == "open_chart":
        steps = [
            _step("Charts", "nav-Charts", "Open Charts", f"I've switched to Charts{f' and loaded {symbol}' if symbol else ''}. This is where you read the market.", symbol=symbol, timeframe=timeframe,
                  how=["Click Charts in the menu on the left.", "The chart for your market loads in the middle of the page."]),
            _step("Charts", "chart-timeframes", "Pick your timeframe", "Short timeframes (1m-15m) show noise and fast moves; 1h-1D show the bigger structure. Choose the one that matches how long you want to hold.",
                  how=["Find the row of timeframe buttons above the chart (1m, 5m, 15m, 1h, 4h, 1D).", "Click one. Day traders usually start with 15m or 1h; swing traders with 4h or 1D."]),
        ]
        return {"id": goal, "title": f"Open {name}", "steps": steps}

    if goal == "analyze_chart":
        steps = [
            _step("Charts", "nav-Charts", "Open the chart", f"I've opened {name}{f' on {timeframe}' if timeframe else ''} for you.", symbol=symbol, timeframe=timeframe,
                  how=["Click Charts in the menu on the left if you're not already there."]),
            _step("Charts", "chart-timeframes", "Start with the bigger picture", "Look at a higher timeframe first (1D or 4h) to see the main trend, then step down to find your entry.",
                  how=["Click 1D above the chart and note whether price has mostly climbed, fallen or moved sideways.", "Then click 1h or 15m to look for your entry."]),
            _step("Charts", "chart-panel", "Read the structure", "Mark the last swing highs and lows: those are your support and resistance. Note if price sits above or below the EMA 20 and whether highs and lows are rising or falling.",
                  how=["Find the most recent peaks and dips on the chart: peaks are resistance, dips are support.", "Check whether each peak and dip is higher than the one before (uptrend) or lower (downtrend)."]),
            _step("Charts", "ai-takeaway", "Check Zuri's read", "This card shows the real day move for the symbol. Treat it as a cue to verify on the chart, not a signal.",
                  how=["Scroll below the chart to the Zuri card.", "Read today's move, then click Ask Zuri for a full analysis if you want me to go deeper."]),
            _step("Charts", "journal-actions", "Write the plan before you act", "Use Long plan or Short plan to record entry, stop and target. Deciding the exit first is what keeps risk under control.",
                  how=["Click Long plan if you expect a rise, or Short plan if you expect a fall.", "Fill in entry, stop and target, then save it. It goes into your journal."]),
        ]
        return {"id": goal, "title": f"Analyse {name}", "steps": steps}

    if goal == "add_to_watchlist":
        if not symbol:
            return None
        return {"id": goal, "title": f"Add {symbol} to your watchlist", "steps": [
            _step("Charts", "quotes-rail", "Your quotes", "This rail is your watchlist. Everything you follow lives here.",
                  how=["Look at the Quotes panel on the right side of the screen.", "If it's collapsed, click the small arrow at its top to open it."]),
            _step("Charts", "market-search", "Search the symbol", f"I typed {symbol} into the search box for you. Click the result to add it.", prefill={"field": "search", "value": symbol},
                  how=[f"Check the Search quotes box shows {symbol}.", f"Click {symbol} in the results. It's added to your watchlist and its chart opens."]),
        ]}

    if goal == "set_risk_limits":
        try:
            limits = validate_risk_limits(params)
        except ValueError:
            limits = {}
        trade = limits.get("max_trade_risk_percent")
        daily = limits.get("max_daily_loss_percent")
        steps = [
            _step("Settings", "nav-Settings", "Open Settings", "Risk limits live in Settings, under the Risk tab.", settings_tab="Risk",
                  how=["Click Settings at the bottom of the menu on the left."]),
            _step("Settings", "settings-tabs", "The Risk tab", "These tabs group your settings. I've opened Risk.",
                  how=["Look at the tabs across the top of Settings.", "Click Risk if it isn't already selected."]),
            _step("Settings", "risk-max-trade", "Max trade risk", f"This caps how much of your account one trade may lose. {f'I set it to {trade}%.' if trade is not None else 'A common guideline is 1-2% or less.'}",
                  how=["Find the Max trade risk box.", "Type the percentage you're comfortable losing on one trade (1 means 1%)."],
                  **({"prefill": {"field": "max_trade_risk_percent", "value": trade}} if trade is not None else {})),
            _step("Settings", "risk-max-daily", "Max daily loss", f"This is your stop-for-the-day line. {f'I set it to {daily}%.' if daily is not None else 'Hitting it means you stop trading until tomorrow.'}",
                  how=["Find the Max daily loss box.", "Type the percentage of your account at which you stop trading for the day (3 is a common choice)."],
                  **({"prefill": {"field": "max_daily_loss_percent", "value": daily}} if daily is not None else {})),
            _step("Settings", "settings-panel", "Saved automatically", "Changes save by themselves a moment after you edit them. You can adjust the numbers any time.",
                  how=["There's no Save button: wait a second after typing.", "Come back here any time to change the numbers."]),
        ]
        return {"id": goal, "title": "Set your risk limits", "steps": steps}

    if goal in ("place_paper_trade", "first_trade"):
        side = "sell" if params.get("side") == "sell" else "buy"
        first = goal == "first_trade"
        return {"id": goal, "title": "Your first practice trade" if first else f"Place a practice {side} order" + (f" on {symbol}" if symbol else ""), "steps": [
            _step("Trade", "nav-Trade", "Open the Trade tab", "Orders are placed here. Practice money only, so this is the safest way to learn." if first else "Orders are placed here.", symbol=symbol,
                  how=["Click Trade in the menu on the left.", "You'll see a chat on the left and the order ticket on the right."]),
            _step("Trade", "trade-ticket", "Fill in the ticket yourself", "You can place a trade on your own, with no chat needed. Choose the symbol, the side and a small quantity.",
                  how=["Click the Symbol box and type or pick the market.", "Click Buy / Long if you expect a rise, or Sell / Short if you expect a fall.", "Type a small number in the Quantity box. Check the Estimated value under it."]),
            _step("Trade", "trade-ticket", "Add a stop and a target", "Enter both a stop-loss and a take-profit so the exit is decided before you enter. This is the one place I can fill in for you.",
                  how=["Find the Stop loss and Take profit boxes.", "Type your own prices, or click Ask Zuri to fill the stop loss and take profit and I'll suggest them from recent price swings.", "For a Buy the stop sits below the current price and the target above. For a Sell it's the other way round."]),
            _step("Trade", "trade-convo", "Optional: talk it through with me", "Not sure about your idea? Chat with me below the ticket and I can fill it in for you.",
                  how=["Scroll below the ticket to the chat with me.", "Type your idea, for example: I think BTCUSD will go up, I want to try a small practice trade.", "When we agree on a plan, press the button that fills the ticket."]),
            _step("Trade", "trade-ticket", "You press send", "Tick the confirmation and send the order yourself. I never place trades for you.",
                  how=["Tick the confirmation box under the ticket.", "Click the Buy or Sell button at the bottom of the ticket.", "Wait for the green success message. Your trade now shows under History and in Open positions on the Dashboard."]),
        ]}

    if goal == "write_journal":
        return {"id": goal, "title": "Write a journal note", "steps": [
            _step("Charts", "journal-actions", "Capture the idea", "Use Note, Long plan or Short plan to record what you see and why.",
                  how=["Go to Charts and open the market you're thinking about.", "Under the chart, click Note (or Long plan / Short plan if you have a trade idea).", "Write why you like the idea and what would prove you wrong, then save."]),
            _step("Journal", "nav-Journal", "Review it later", "Your entries collect here. Re-reading them is how patterns in your own behaviour show up.",
                  how=["Click Journal in the menu on the left.", "Your notes are listed newest first. I also add my own entries for trades and plans I notice.", "Press Analyse my journey to see the leaks I've found."]),
        ]}

    if goal == "site_tour":
        detailed = params.get("detail") == "detailed"
        steps = [
            _step("Dashboard", "nav-Dashboard", "Your dashboard", "Home base: your account, open positions, today's news and your next steps with me."),
            _step("Dashboard", "dash-weekly", "Your weekly breakdown", "Your week at a glance: trades, wins, profit and loss by day, with Zuri's insights on what is working and what to try next. It fills in once a broker is linked and you've closed trades."),
            _step("Dashboard", "dash-learn", "Videos and free courses", "Strategy videos and free courses picked from your experience level, your markets and your trading history."),
            _step("Charts", "nav-Charts", "Charts", "Read the market here: pick a symbol and timeframe, then use the news, AI scanners and backtests with saved history below the chart."),
            _step("Trade", "nav-Trade", "Trade", "Orders are placed here. Everything asks you to confirm first, and live-money orders need an extra safety phrase."),
            _step("History", "nav-History", "History", "Every closed trade, order and open position from your broker, with profit and loss and a CSV export. Zuri also saves an annotated chart snapshot of each trade here to study later."),
            _step("Journal", "nav-Journal", "Journal", "Write why you take a trade, but you don't have to do it alone: I keep a journal for you too, recording your trades, positions closed elsewhere, orders your limits stopped and plans we talk through, so I can find your leaks."),
            _step("Settings", "nav-Settings", "Settings", "Your broker link, risk limits and how involved I am all live here.", settings_tab="Broker"),
        ]
        if detailed:
            steps = [
                steps[0],
                steps[1],
                steps[2],
                _step("Charts", "nav-Charts", "Charts", "This is where you read the market."),
                _step("Charts", "chart-welcome", "Pick your first market", "Charts show one market at a time, so your desk starts empty. Click any card here to add it to your watchlist and open its chart, then press Next. If you skip this I'll open a starter market for you.", needs_market=True),
                _step("Charts", "chart-timeframes", "Timeframes", "Short timeframes (1m-15m) show noise and fast moves; 1h-1D show the bigger structure. Choose what matches how long you want to hold."),
                _step("Charts", "chart-panel", "The chart and price", "The live price and its move sit at the top of the chart. Learn to read trend, support and resistance before anything else."),
                _step("Charts", "journal-actions", "Plans and notes", "Use Note, Long plan or Short plan to record entry, stop and target before you act."),
                _step("Charts", "quotes-rail", "Your watchlist", "Everything you follow lives in this rail. Search to add more."),
                _step("Charts", "news-charts", "News for this symbol", "Headlines relevant to the symbol on your chart. Ask me about a story, or send it to the backtest as event context."),
                _step("Charts", "chart-scanners", "AI scanners", "Describe a condition in plain words, review the rule I draft, then activate it. Scanners are saved to your account and check broker candles every minute while Zuri is open."),
                _step("Charts", "chart-backtest", "Backtest a setup", "Replay a breakout, moving-average cross or RSI rule over real broker candles for a date range, with average return and the share of positive outcomes."),
                _step("Charts", "chart-backtest-history", "Backtest history", "Every run is saved here. View the signals, run a setup again with its settings, or delete runs you don't need."),
                steps[4],
                _step("Trade", "trade-ticket", "The order ticket", "You can place a trade entirely on your own here: choose the symbol, side and quantity, add a stop and target, tick to confirm, then send. Live-money orders also need the CONFIRM LIVE phrase. I never place trades for you."),
                _step("Trade", "trade-convo", "Need help? Talk it through with me", "Optional. Tell me your idea in your own words and I'll ask what would prove you wrong, then fill in the size, stop and target from your risk limit. The 'Ask Zuri to fill the stop loss and take profit' button on the ticket does just that part."),
                _step("History", "nav-History", "History", "Your trade log lives here, pulled straight from your broker."),
                _step("History", "history-log", "Your trade log and export", "Pick a period and export it to CSV. Closed-trade profit and loss is estimated from filled orders. Link a broker in Settings and this fills in by itself."),
                _step("History", "history-tabs", "Closed trades, orders and open positions", "Switch between finished trades with their result, every order sent, and what you hold right now with floating profit and loss."),
                _step("History", "history-snapshots", "Chart snapshots", "For every trade I save a chart with my own annotations: support, resistance, your entry and exit, and how your stop fit the recent range. Re-read them to see what you did well."),
                steps[6],
                _step("Journal", "journal-insights", "Zuri's own journal and leak finder", "From your very first watched symbol and first trade, I record everything automatically: orders, positions opened or closed outside Zuri, trades placed soon after a loss, orders your own limits stopped, and plans we discussed. Press Analyse my journey for the leaks, with the exact figures and a fix for each."),
                *_broker_steps(),
                _step("Settings", "settings-tabs", "Risk limits", "Next, the Risk tab: these limits protect your account.", settings_tab="Risk"),
                _step("Settings", "risk-max-trade", "Max trade risk", "This caps how much of your account one trade may lose. 1-2% or less is a common guideline."),
                _step("Settings", "risk-max-daily", "Max daily loss", "Your stop-for-the-day line. Hitting it means you stop trading until tomorrow."),
            ]
        steps.append(_step("Dashboard", "zuri-next", "That's the tour. Now it's us", "From here I'll guide you. This card always shows the one best next move for you, starting with getting you set up and to your first practice trade, then helping you improve with every trade. Ask me anything in the chat at any time."))
        for step in steps:
            step.setdefault("how", TOUR_HOW.get(step["target"]) or None)
            if not step["how"]:
                del step["how"]
        return {"id": goal, "title": "Your full Zuri tour, including broker setup" if detailed else "A quick look around", "steps": steps}

    if goal == "link_broker":
        return {"id": goal, "title": "Link your broker", "steps": _broker_steps()}
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


# --- Where the user is on their journey, and what Zuri is working toward with them ------------------------------
# Computed from verified facts (never from the model), so the guidance after the tour cannot drift or stall.

MONEY_GUARDRAIL = (
    "Zuri's goal is to help the user grow their account steadily by becoming a better trader every day: protect capital, cut the leaks found in their own journal, repeat what demonstrably works. "
    "Never promise or imply profit, never push bigger size, leverage, more frequent trading or chasing losses to 'make money faster', and never call a trade a sure thing. Consistent profit is a result of process."
)

_STAGES: dict[str, dict] = {
    "connect": {
        "title": "Get connected",
        "objective": "No broker is linked, so nothing else can happen yet. Your one job is to get them to open and link a free paper (practice) broker account, step by step, removing every obstacle. Offer to do it with them. "
                     "Be concrete about WHERE to go and WHAT to click, using only these facts: sign up at https://app.alpaca.markets/signup (paper account, practice money), confirm the email, open https://app.alpaca.markets/paper/dashboard/overview and check the top-left switcher says Paper, click Generate New Keys in the API Keys box, copy the Key ID and Secret Key (the secret is shown once), then in Zuri go to Settings, Broker, click Link account on the Alpaca row, paste both, leave Environment on Paper, click Verify and link. Never ask them to enable withdrawals, and never ask them to paste keys into the chat.",
        "allowed": ("link_broker", "site_tour", "talk"),
    },
    "protect": {
        "title": "Set the safety rails",
        "objective": "Their broker is linked but they have not set risk limits. Before any trade, get them to set a per-trade and a daily loss limit they are comfortable with.",
        "allowed": ("set_risk_limits", "talk", "site_tour"),
    },
    "pick_market": {
        "title": "Choose a first market",
        "objective": "Their desk is empty. Help them choose one market that fits their experience and interests and put it on the chart, so a first trade is possible.",
        "allowed": ("add_to_watchlist", "open_chart", "analyze_chart", "set_risk_limits", "talk"),
    },
    "first_trade": {
        "title": "Place your first trade",
        "objective": "Everything is ready. YOUR MAIN FOCUS NOW is getting them to place their first practice trade, in a calm, well-planned way: talk the idea through, let the app size it, stop and target included, then they confirm it themselves. The Trade page also works without any chat: they can fill the ticket themselves, and a step-by-step guide there stays on each step until they say they are done with it. When they ask for help mid-trade, stay on their current step, do not jump ahead, and check they are finished before moving on. Remove hesitation, answer doubts, keep it small and safe. Do not let them drift into endless studying.",
        "allowed": ("first_trade", "analyze_chart", "open_chart", "set_risk_limits", "talk"),
    },
    "learn": {
        "title": "Learn from your first trades",
        "objective": "They have started trading. Every trade is a lesson: help them write down why they took it, review each result (win or loss) calmly, and keep risk small while a few trades build a base of evidence about their habits.",
        "allowed": ("first_trade", "write_journal", "talk", "analyze_chart", "open_chart", "set_risk_limits", "add_to_watchlist"),
    },
    "improve": {
        "title": "Improve every day",
        "objective": "They have a real track record. Work on getting more from it each day: find the leaks in their own data, pick ONE measurable experiment, reinforce what is working, and keep drawdowns inside their limits.",
        "allowed": ("first_trade", "write_journal", "talk", "analyze_chart", "open_chart", "set_risk_limits", "add_to_watchlist"),
    },
}


def journey_stage(signals: dict) -> dict:
    """signals: broker_linked, risk_limits_set, watchlist_count, trades_recorded, closed_trades (None when unknown), journal_notes."""
    def num(key: str) -> int:
        try:
            return int(signals.get(key) or 0)
        except (TypeError, ValueError):
            return 0

    if not signals.get("broker_linked"):
        stage = "connect"
    elif not signals.get("risk_limits_set"):
        stage = "protect"
    elif num("watchlist_count") == 0:
        stage = "pick_market"
    elif num("trades_recorded") == 0:
        stage = "first_trade"
    else:
        closed = signals.get("closed_trades")
        closed = num("trades_recorded") // 2 if closed is None else num("closed_trades")
        stage = "improve" if closed >= 10 else "learn"
    return {"id": stage, **_STAGES[stage]}


def stage_fallback(stage: str, signals: dict) -> dict:
    """The move Zuri makes when the model is unavailable or picks something that does not serve the stage."""
    moves = {
        "connect": {"headline": "Link a free practice broker", "why": "Nothing else can happen until a broker is linked, and a practice account risks no real money. I'll walk you through it.", "goal": "link_broker"},
        "protect": {"headline": "Set your safety limits", "why": "Before your first trade, decide the most you're willing to lose per trade and per day. It takes a minute and protects everything else.", "goal": "set_risk_limits"},
        "pick_market": {"headline": "Pick your first market", "why": "Your desk is empty. Tell me what interests you and I'll help you choose one market to start with.", "goal": "talk", "chat_prompt": "My chart desk is empty. Which market should I start with, and can you open it for me?"},
        "first_trade": {"headline": "Place your first practice trade", "why": "You're set up. The fastest way to learn is one small, planned practice trade. We'll talk the idea through and I'll size it for you.", "goal": "first_trade"},
        "learn": (
            {"headline": "Write why you took your trade", "why": "A short note on your reasoning is what turns a trade into a lesson.", "goal": "write_journal"}
            if not signals.get("journal_notes") else
            {"headline": "Review your latest trade with me", "why": "Each trade is data. Let's look at what you did well and one thing to change next time.", "goal": "talk", "chat_prompt": "Let's review my latest trade together. What did I do well and what should I change?"}
        ),
        "improve": {"headline": "Find your biggest leak", "why": "You have enough trades for real patterns. Let's find the one habit that costs you most and set an experiment for tomorrow.", "goal": "talk", "chat_prompt": "Look at my trading so far and find my biggest leak. Give me one experiment for tomorrow."},
    }
    return moves[stage]


def stage_directive(stage: dict) -> str:
    return (
        f"\n<journey_stage id=\"{stage['id']}\">{stage['objective']} "
        "Steer gently toward this, ending with ONE concrete next step when it fits, but answer what they asked first and never nag. "
        "When you tell them how to do anything in Zuri or on another site, write it as numbered click-by-click steps: where to go, the exact button or field name, what to type or copy, and what they should see when it worked. Never assume they know where something is. "
        "Never promise profit or push size, leverage or more trading; steady risk-managed improvement is the goal.</journey_stage>"
    )


def stage_signals(snapshot: dict, closed_trades: int | None = None) -> dict:
    """Reads the verified journey snapshot into the signals journey_stage needs."""
    activity = snapshot.get("activity_counts")
    activity = activity if isinstance(activity, dict) else {}
    limits = snapshot.get("risk_limits")
    watchlist = snapshot.get("watchlist")
    recorded = sum(activity.get(kind, 0) for kind in ("order_placed", "position_detected", "position_closed"))
    return {
        "broker_linked": isinstance(snapshot.get("broker_linked"), dict),
        "risk_limits_set": isinstance(limits, dict) and any(value is not None for value in limits.values()),
        "watchlist_count": len(watchlist) if isinstance(watchlist, list) else 0,
        "trades_recorded": recorded or (1 if snapshot.get("open_positions") else 0),
        "closed_trades": closed_trades,
        "journal_notes": snapshot.get("journal_entries_with_notes") or 0,
    }


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
