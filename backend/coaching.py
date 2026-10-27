"""Dashboard coaching analytics. All figures are computed from closed trades; the AI only phrases them.

Pattern claims ("you do better on Mondays") are only made when the sample is large enough and a
two-proportion z-test says the gap is unlikely to be chance. Otherwise the output says so.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any
from urllib.parse import quote_plus

from .journal import parse_time

MIN_GROUP_TRADES = 5
MIN_STYLE_TRADES = 10
Z_THRESHOLD = 1.645  # about 95% one-sided
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _rated(trips: list[dict]) -> list[dict]:
    return [t for t in trips if t.get("closed_at") and isinstance(t.get("realized_pl"), (int, float))]


def summarize(trips: list[dict]) -> dict[str, Any]:
    pls = [t["realized_pl"] for t in trips]
    wins = [p for p in pls if p > 0]
    losses = [-p for p in pls if p < 0]
    n = len(pls)
    avg_win = sum(wins) / len(wins) if wins else None
    avg_loss = sum(losses) / len(losses) if losses else None
    return {
        "trades": n,
        "wins": len(wins),
        "win_rate_pct": round(100 * len(wins) / n, 1) if n else None,
        "total_pl": round(sum(pls), 2),
        "avg_win": round(avg_win, 2) if avg_win is not None else None,
        "avg_loss": round(avg_loss, 2) if avg_loss is not None else None,
        "payoff_ratio": round(avg_win / avg_loss, 2) if avg_win and avg_loss else None,
        "profit_factor": round(sum(wins) / sum(losses), 2) if losses and sum(losses) > 0 else None,
        "expectancy": round(sum(pls) / n, 2) if n else None,
    }


def _z_test(a: dict, b: dict) -> float:
    n1, n2 = a["trades"], b["trades"]
    p1, p2 = a["wins"] / n1, b["wins"] / n2
    pooled = (a["wins"] + b["wins"]) / (n1 + n2)
    spread = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    return 0.0 if spread == 0 else (p1 - p2) / spread


def compare_groups(groups: dict[str, list[dict]]) -> dict[str, Any]:
    """Best vs worst group by win rate, with an honest reliability verdict."""
    stats = {name: summarize(items) for name, items in groups.items() if items}
    eligible = {k: v for k, v in stats.items() if v["trades"] >= MIN_GROUP_TRADES}
    result: dict[str, Any] = {"groups": stats, "verdict": "insufficient_data", "best": None, "worst": None}
    if len(eligible) < 2:
        return result
    best = max(eligible, key=lambda k: (eligible[k]["win_rate_pct"], eligible[k]["total_pl"]))
    worst = min(eligible, key=lambda k: (eligible[k]["win_rate_pct"], eligible[k]["total_pl"]))
    z = _z_test(eligible[best], eligible[worst])
    result.update(best=best, worst=worst, z=round(z, 2), verdict="reliable" if z >= Z_THRESHOLD else "possibly_chance")
    return result


def _local(value: str, tz: timezone) -> datetime:
    return parse_time(value).astimezone(tz)


def session_name(hour: int) -> str:
    if hour < 12:
        return "Morning (before 12:00)"
    if hour < 17:
        return "Afternoon (12:00-17:00)"
    return "Evening (17:00 onward)"


def weekly_breakdown(trips: list[dict], tz_offset_minutes: int, now: datetime | None = None) -> dict[str, Any]:
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    now = now or datetime.now(timezone.utc)
    trips = _rated(trips)
    this_week = [t for t in trips if now - timedelta(days=7) <= parse_time(t["closed_at"]) <= now]
    last_week = [t for t in trips if now - timedelta(days=14) <= parse_time(t["closed_at"]) < now - timedelta(days=7)]

    by_day: dict[str, list[dict]] = defaultdict(list)
    by_session: dict[str, list[dict]] = defaultdict(list)
    for t in trips:
        local = _local(t["closed_at"], tz)
        by_day[WEEKDAYS[local.weekday()]].append(t)
        by_session[session_name(local.hour)].append(t)
    daily_last7 = []
    for offset in range(6, -1, -1):
        day = (now.astimezone(tz) - timedelta(days=offset)).date()
        items = [t for t in this_week if _local(t["closed_at"], tz).date() == day]
        daily_last7.append({"date": day.isoformat(), "weekday": WEEKDAYS[day.weekday()], "trades": len(items), "pl": round(sum(t["realized_pl"] for t in items), 2)})
    return {
        "this_week": summarize(this_week),
        "last_week": summarize(last_week),
        "daily_last7": daily_last7,
        "weekday": compare_groups(by_day),
        "session": compare_groups(by_session),
    }


def after_loss_pattern(trips: list[dict], minutes: int = 30) -> dict[str, Any]:
    """Win rate of trades opened soon after a losing trade closed, versus all other trades."""
    ordered = sorted((t for t in _rated(trips) if t.get("opened_at")), key=lambda t: parse_time(t["opened_at"]))
    quick, other = [], []
    last_loss_close: datetime | None = None
    for t in ordered:
        opened = parse_time(t["opened_at"])
        if last_loss_close and timedelta(0) <= opened - last_loss_close <= timedelta(minutes=minutes):
            quick.append(t)
        else:
            other.append(t)
        closed = parse_time(t["closed_at"])
        last_loss_close = closed if t["realized_pl"] < 0 else None
    return compare_groups({"quick_after_loss": quick, "other": other}) | {"minutes": minutes}


def max_consecutive_losses(trips: list[dict]) -> int:
    longest = current = 0
    for t in sorted(_rated(trips), key=lambda t: parse_time(t["closed_at"])):
        current = current + 1 if t["realized_pl"] < 0 else 0
        longest = max(longest, current)
    return longest


def holding_style(trips: list[dict]) -> dict[str, Any]:
    minutes = []
    for t in _rated(trips):
        if t.get("opened_at"):
            delta = (parse_time(t["closed_at"]) - parse_time(t["opened_at"])).total_seconds() / 60
            if delta >= 0:
                minutes.append(delta)
    if len(minutes) < MIN_STYLE_TRADES:
        return {"style": None, "median_minutes": round(median(minutes), 1) if minutes else None}
    mid = median(minutes)
    style = "Scalping" if mid < 60 else "Day trading" if mid < 1440 else "Swing trading"
    return {"style": style, "median_minutes": round(mid, 1)}


def strategy_profile(trips: list[dict], entries: list[dict]) -> dict[str, Any]:
    rated = _rated(trips)
    base = summarize(rated)
    symbols = Counter(t["symbol"] for t in rated)
    top = symbols.most_common(1)
    longs = sum(1 for t in rated if t.get("side") == "long")
    setups = Counter(
        (e.get("setup") or "").strip()
        for e in entries
        if e.get("source", "manual") == "manual" and (e.get("setup") or "").strip()
    )
    return {
        **base,
        **holding_style(rated),
        "long_share_pct": round(100 * longs / len(rated), 1) if rated else None,
        "max_consecutive_losses": max_consecutive_losses(rated),
        "top_symbol": top[0][0] if top else None,
        "top_symbol_share_pct": round(100 * top[0][1] / len(rated), 1) if top else None,
        "journal_setups": [{"setup": s, "count": c} for s, c in setups.most_common(5)],
    }


def _search(provider: str, query: str) -> str:
    if provider == "YouTube":
        return f"https://www.youtube.com/results?search_query={quote_plus(query)}"
    return f"https://www.investopedia.com/search?q={quote_plus(query)}"


# Search links rather than hand-picked video URLs: they never go stale and cannot point at removed content.
TOPIC_QUERIES = {
    "risk_management": "risk management for beginner traders",
    "position_sizing": "position sizing 1 percent rule",
    "price_action": "price action trading basics",
    "trend_following": "trend following pullback strategy",
    "breakout": "opening range breakout strategy",
    "mean_reversion": "support and resistance mean reversion trading",
    "swing": "swing trading strategy explained",
    "day_trading": "day trading rules for beginners",
    "psychology": "trading psychology revenge trading",
    "journaling": "how to keep a trading journal",
    "reward_risk": "risk reward ratio let winners run",
}


def resources_for(topics: list[str]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for topic in topics:
        query = TOPIC_QUERIES.get(topic)
        if not query:
            continue
        items.append({"topic": topic, "title": f"Videos: {query}", "provider": "YouTube", "url": _search("YouTube", query)})
        items.append({"topic": topic, "title": f"Articles and courses: {query}", "provider": "Investopedia", "url": _search("Investopedia", query)})
    items.append({"topic": "foundations", "title": "Free forex and trading school (BabyPips)", "provider": "BabyPips", "url": "https://www.babypips.com/learn/forex"})
    return items


def _course(title: str, provider: str, url: str, kind: str, why: str) -> dict[str, str]:
    return {"title": title, "provider": provider, "url": url, "kind": kind, "why": why}


# Hand-picked free courses (top-level pages that stay stable), keyed by what we know about the user.
FREE_COURSES = {
    "foundations": [
        _course("School of Pipsology: free trading course", "BabyPips", "https://www.babypips.com/learn/forex", "Course", "A complete free course that starts from zero."),
        _course("Stocks and bonds", "Khan Academy", "https://www.khanacademy.org/economics-finance-domain/core-finance/stock-and-bonds", "Course", "Plain-language lessons on how markets work."),
    ],
    "Forex": [_course("Forex trading basics and strategies", "BabyPips", "https://www.babypips.com/learn/forex", "Course", "Built around currency pairs.")],
    "Stocks": [_course("Trading and investing learning center", "Fidelity", "https://www.fidelity.com/learning-center/trading-investing", "Course", "Free articles and videos on stocks and options.")],
    "Crypto": [
        _course("Binance Academy", "Binance", "https://academy.binance.com/en", "Course", "Free crypto trading and security guides."),
        _course("Coinbase Learn", "Coinbase", "https://www.coinbase.com/learn", "Course", "Beginner crypto lessons."),
    ],
    "Commodities": [_course("CME Group education", "CME Group", "https://www.cmegroup.com/education.html", "Course", "Free courses on futures, gold and energy markets.")],
    "tradingview": [_course("TradingView education", "TradingView", "https://www.tradingview.com/education/", "Videos", "Chart reading and strategy ideas from other traders.")],
}

EXPERIENCE_TOPICS = {
    "New to trading": ["risk_management", "price_action", "journaling"],
    "Learning the basics": ["trend_following", "position_sizing", "psychology"],
    "Experienced": ["mean_reversion", "reward_risk", "psychology"],
}
MARKET_TOPICS = {"Forex": "swing", "Stocks": "day_trading", "Crypto": "breakout", "Commodities": "trend_following"}


def learning_for(markets: list[str], experience: str | None, topics: list[str] | None = None) -> dict[str, Any]:
    """Free courses plus strategy videos chosen from the user's markets, experience and (if known) trading-history topics."""
    chosen = list(dict.fromkeys([*(topics or []), *EXPERIENCE_TOPICS.get(experience or "", EXPERIENCE_TOPICS["New to trading"]), *(MARKET_TOPICS[m] for m in markets if m in MARKET_TOPICS)]))[:6]
    courses: list[dict[str, str]] = []
    if experience in (None, "New to trading", "Learning the basics"):
        courses += FREE_COURSES["foundations"]
    for market in markets:
        courses += FREE_COURSES.get(market, [])
    courses += FREE_COURSES["tradingview"]
    seen: set[str] = set()
    courses = [c for c in courses if not (c["url"] in seen or seen.add(c["url"]))]
    videos = [
        {"topic": t, "title": TOPIC_QUERIES[t].capitalize(), "provider": "YouTube", "url": _search("YouTube", TOPIC_QUERIES[t]), "kind": "Videos"}
        for t in chosen if t in TOPIC_QUERIES
    ]
    return {"courses": courses[:6], "videos": videos, "based_on": {"markets": markets, "experience": experience}}


NEXT_STRATEGY = {
    "Scalping": ("Opening range breakout", "Day trading", "breakout"),
    "Day trading": ("Trend-following pullbacks", "Swing trading", "trend_following"),
    "Swing trading": ("Support and resistance reversals", "Mean reversion", "mean_reversion"),
}


def suggestions(profile: dict[str, Any], patterns: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    n = profile["trades"]
    if n < MIN_STYLE_TRADES:
        out.append({
            "id": "build-sample",
            "title": "Build a reliable sample with one simple setup",
            "why": f"You have {n} closed trade{'s' if n != 1 else ''}. Patterns need about {MIN_STYLE_TRADES}+ trades before they mean anything.",
            "steps": ["Pick one setup (for example a trend pullback) and trade only that.", "Risk the same small percentage every time.", "Write why you took each trade in your journal."],
            "topics": ["price_action", "risk_management", "journaling"],
        })
        return out
    payoff, win_rate = profile["payoff_ratio"], profile["win_rate_pct"]
    if payoff is not None and payoff < 1 and win_rate is not None and win_rate < 60:
        out.append({
            "id": "let-winners-run",
            "title": "Let your winners run (fixed 2:1 targets)",
            "why": f"Your average win ({profile['avg_win']}) is smaller than your average loss ({profile['avg_loss']}), payoff {payoff}:1, with a {win_rate}% win rate. At that payoff you need a high win rate just to break even.",
            "steps": ["Set the target at least 2x your stop distance before entering.", "Do not move the stop further away.", "Review whether you close winners early out of fear."],
            "topics": ["reward_risk", "risk_management"],
        })
    quick = patterns.get("groups", {}).get("quick_after_loss")
    other = patterns.get("groups", {}).get("other")
    if quick and other and quick["trades"] >= MIN_GROUP_TRADES and quick["win_rate_pct"] + 10 <= other["win_rate_pct"]:
        out.append({
            "id": "cooldown",
            "title": "Add a cooldown after a loss",
            "why": f"Trades opened within {patterns['minutes']} minutes of a loss win {quick['win_rate_pct']}% of the time versus {other['win_rate_pct']}% otherwise ({quick['trades']} trades).",
            "steps": ["After a loss, step away for at least 30 minutes.", "Write one line about what happened before the next trade.", "Only re-enter if the setup is still valid."],
            "topics": ["psychology", "journaling"],
        })
    if profile["max_consecutive_losses"] >= 4:
        out.append({
            "id": "daily-loss-limit",
            "title": "Set a daily loss limit",
            "why": f"Your longest losing streak is {profile['max_consecutive_losses']} trades. Streaks without a circuit breaker are how small losses become large ones.",
            "steps": ["Pick a maximum daily loss (for example 2% of the account).", "Stop trading for the day when you reach it.", "Use Settings → Risk to record the limit."],
            "topics": ["risk_management", "psychology"],
        })
    share = profile.get("top_symbol_share_pct")
    if share is not None and share >= 60:
        out.append({
            "id": "diversify-markets",
            "title": "Test your setup on a second market",
            "why": f"{share}% of your trades are in {profile['top_symbol']}. Results in one instrument can hide whether your edge is the setup or just that market.",
            "steps": ["Take the same setup on one other, similar market with small size.", "Compare the results after 10 trades."],
            "topics": ["price_action", "position_sizing"],
        })
    style = profile.get("style")
    if style in NEXT_STRATEGY:
        strategy, next_style, topic = NEXT_STRATEGY[style]
        out.append({
            "id": "try-next",
            "title": f"Strategy to try next: {strategy}",
            "why": f"You currently trade like a {style.lower()} trader. {strategy} is a natural next step that builds on the same skills ({next_style.lower()} timeframe).",
            "steps": ["Paper trade it for 10 trades before using real size.", "Journal each trade so Zuri can compare it with your current style."],
            "topics": [topic],
        })
    if not out:
        out.append({
            "id": "keep-going",
            "title": "Your process looks consistent. Keep collecting data",
            "why": "No clear weaknesses stand out in your current results. More trades will make the patterns sharper.",
            "steps": ["Keep journaling every trade.", "Review your week every Friday."],
            "topics": ["journaling"],
        })
    return out[:4]


def headlines(weekly: dict[str, Any], patterns: dict[str, Any]) -> list[dict[str, str]]:
    """Plain, hedged findings that are generated directly from the numbers."""
    items: list[dict[str, str]] = []
    this, last = weekly["this_week"], weekly["last_week"]
    if this["trades"]:
        text = f"This week: {this['trades']} closed trades, {this['win_rate_pct']}% wins, P&L {this['total_pl']:+.2f}."
        if last["trades"]:
            text += f" Last week: {last['trades']} trades, {last['win_rate_pct']}% wins, P&L {last['total_pl']:+.2f}."
        items.append({"tone": "info", "text": text})
    for key, label in (("weekday", "day of the week"), ("session", "time of day")):
        cmp = weekly[key]
        if cmp["verdict"] == "reliable":
            b, w = cmp["groups"][cmp["best"]], cmp["groups"][cmp["worst"]]
            items.append({"tone": "positive", "text": f"Your results differ by {label}, and the gap is unlikely to be chance: {cmp['best']} wins {b['win_rate_pct']}% ({b['trades']} trades) versus {cmp['worst']} {w['win_rate_pct']}% ({w['trades']} trades). Consider sizing down or skipping {cmp['worst']}."})
        elif cmp["verdict"] == "possibly_chance":
            items.append({"tone": "muted", "text": f"There is a gap between your best and worst {label}, but with this many trades it could easily be chance, so Zuri is not acting on it yet."})
        else:
            items.append({"tone": "muted", "text": f"Not enough trades per {label} yet (need {MIN_GROUP_TRADES}+ in at least two) to say anything reliable."})
    quick = patterns.get("groups", {}).get("quick_after_loss")
    if quick and quick["trades"] >= MIN_GROUP_TRADES and patterns.get("verdict") == "reliable" and patterns.get("best") == "other":
        items.append({"tone": "warning", "text": f"Trades opened within {patterns['minutes']} minutes of a loss do clearly worse ({quick['win_rate_pct']}% wins). This is a common sign of revenge trading."})
    return items
