import streamlit as st
import requests
import json

BACKEND_URL = "http://127.0.0.1:8000"

st.set_page_config(
    page_title="Zuri Pro - TradingView Terminal",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="collapsed" # Default collapsed for maximum chart canvas
)

# -------------------------------------------------------------------
# FULL-SCREEN HIGH-DENSITY TRADINGVIEW CSS OVERRIDES
# -------------------------------------------------------------------
st.markdown("""
<style>
    /* Hide Streamlit Header, Footer & Excess Margins */
    header {visibility: hidden;}
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}

    .stApp {
        background-color: #131722 !important;
        color: #d1d4dc;
    }

    /* Remove default Streamlit padding around main block */
    .st-emotion-cache-z5fcl4, .st-emotion-cache-18ni7e3, .main .block-container {
        padding-top: 0rem !important;
        padding-bottom: 0rem !important;
        padding-left: 0.5rem !important;
        padding-right: 0.5rem !important;
        max-width: 100% !important;
    }

    /* Top Horizontal Bar (TV Style) */
    .tv-topbar {
        display: flex;
        align-items: center;
        background-color: #1e222d;
        border-bottom: 1px solid #2a2e39;
        padding: 4px 12px;
        gap: 12px;
        font-family: -apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif;
    }

    .tv-symbol {
        font-weight: bold;
        color: #f0f3fa;
        font-size: 14px;
        background: #2a2e39;
        padding: 4px 8px;
        border-radius: 3px;
    }

    .tv-badge {
        color: #26a69a;
        font-size: 11px;
        font-weight: 600;
    }

    /* TV Right Watchlist Styling */
    .wl-card {
        background-color: #1e222d;
        border-radius: 4px;
        padding: 8px;
        border: 1px solid #2a2e39;
        font-size: 12px;
    }

    .wl-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0px;
        border-bottom: 1px solid #2a2e39;
    }

    /* Floating Copilot HUD Drawer */
    [data-testid="stSidebar"] {
        background-color: #1e222d !important;
        border-right: 1px solid #2a2e39;
    }
</style>
""", unsafe_allow_html=True)


# -------------------------------------------------------------------
# TOP NAVBAR (TradingView Horizontal Style)
# -------------------------------------------------------------------
col_top_left, col_top_mid, col_top_right = st.columns([2, 4, 2])

with col_top_left:
    st.markdown("""
        <div class="tv-topbar">
            <span class="tv-symbol">NVDA</span>
            <span style="color: #8c91a0; font-size: 12px;">NVIDIA Corp • 1H • NASDAQ</span>
            <span class="tv-badge">🟢 LIVE</span>
        </div>
    """, unsafe_allow_html=True)

with col_top_mid:
    # Inline compact actions
    c1, c2, c3, c4 = st.columns([1, 1, 1.5, 2])
    c1.button("1m")
    c2.button("1H")
    c3.button("Indicators")
    if c4.button("🧠 Zuri Vision Scan"):
        st.toast("Scanning NVDA chart structure...", icon="👁️️")

with col_top_right:
    try:
        acc = requests.get(f"{BACKEND_URL}/api/account", timeout=2).json()
        st.markdown(f"<div style='text-align: right; font-size: 12px; padding-top: 6px;'>"
                    f"Equity: <b style='color:#26a69a'>${acc['equity']:,.2f}</b> | "
                    f"BP: <b>${acc['buying_power']:,.2f}</b></div>", unsafe_allow_html=True)
    except Exception:
        st.markdown("<div style='text-align: right; color:#ef5350; font-size: 12px;'>Offline</div>", unsafe_allow_html=True)

st.markdown("<div style='height: 4px;'></div>", unsafe_allow_html=True)


# -------------------------------------------------------------------
# MAIN LAYOUT: NATIVE TRADINGVIEW LIGHTWEIGHT CHART + COMPACT RIGHT SIDEBAR
# -------------------------------------------------------------------
chart_col, right_col = st.columns([4.2, 1.1], gap="small")

with chart_col:
    # Real TradingView Lightweight-Charts JavaScript Component Embedded
    tv_chart_html = """
    <!DOCTYPE html>
    <html>
    <head>
        <script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
        <style>
            body { margin: 0; padding: 0; background-color: #131722; overflow: hidden; }
            #chart-container { width: 100vw; height: 580px; }
        </style>
    </head>
    <body>
        <div id="chart-container"></div>
        <script>
            const chart = LightweightCharts.createChart(document.getElementById('chart-container'), {
                layout: {
                    backgroundColor: '#131722',
                    textColor: '#d1d4dc',
                },
                grid: {
                    vertLines: { color: '#1f2431' },
                    horzLines: { color: '#1f2431' },
                },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
                rightPriceScale: { borderColor: '#2a2e39' },
                timeScale: { borderColor: '#2a2e39', timeVisible: true },
            });

            const candleSeries = chart.addCandlestickSeries({
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350'
            });

            // Sample OHLC Data
            candleSeries.setData([
                { time: '2026-09-28', open: 220.50, high: 224.20, low: 219.80, close: 223.10 },
                { time: '2026-09-29', open: 223.10, high: 226.50, low: 222.00, close: 225.80 },
                { time: '2026-09-30', open: 225.80, high: 228.00, low: 224.50, close: 227.20 },
                { time: '2026-10-01', open: 227.20, high: 229.50, low: 226.10, close: 228.00 },
                { time: '2026-10-02', open: 228.00, high: 231.40, low: 227.80, close: 229.80 }
            ]);

            // Price Lines (Entry, SL, TP)
            candleSeries.createPriceLine({
                price: 228.00,
                color: '#26a69a',
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Solid,
                axisLabelVisible: true,
                title: 'BUY ENTRY (107 sh)',
            });

            candleSeries.createPriceLine({
                price: 210.00,
                color: '#ef5350',
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'STOP LOSS (-$1,926)',
            });

            candleSeries.createPriceLine({
                price: 260.00,
                color: '#2962ff',
                lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                axisLabelVisible: true,
                title: 'TAKE PROFIT (+$3,424)',
            });

            window.addEventListener('resize', () => {
                chart.resize(window.innerWidth, 580);
            });
        </script>
    </body>
    </html>
    """
    st.components.v1.html(tv_chart_html, height=585, scrolling=False)

    # Bottom Compact Trading Panel Tabs
    t_pos, t_ord, t_hist, t_coach = st.tabs(["💼 Active Positions", "⏳ Orders", "📜 Trade Log", "🧠 AI Advice"])
    with t_pos:
        try:
            p = requests.get(f"{BACKEND_URL}/api/positions").json().get("positions", [])
            if p: st.json(p)
            else: st.caption("No open positions.")
        except Exception: st.caption("Positions offline.")
    with t_ord:
        st.caption("No open pending bracket orders.")
    with t_hist:
        st.caption("Last Trade: NVDA +$680.52 (Closed)")
    with t_coach:
        st.caption("⚡ Zuri Advice: Consistency is high. Risk stayed within 2.0% cap across all entries.")

with right_col:
    # Compact Native Watchlist (1:1 TradingView Styling)
    st.markdown("""
        <div class="wl-card">
            <div style="font-weight: bold; padding-bottom: 6px; color: #8c91a0; border-bottom: 1px solid #2a2e39;">
                WATCHLIST
            </div>
            <div class="wl-row">
                <span><b>BTCUSD</b></span>
                <span style="color:#26a69a">85,931 <small>+1.27%</small></span>
            </div>
            <div class="wl-row">
                <span><b>NVDA</b></span>
                <span style="color:#26a69a">229.80 <small>+0.78%</small></span>
            </div>
            <div class="wl-row">
                <span><b>TSLA</b></span>
                <span style="color:#ef5350">352.50 <small>-1.10%</small></span>
            </div>
            <div class="wl-row">
                <span><b>AAPL</b></span>
                <span style="color:#26a69a">232.10 <small>+0.30%</small></span>
            </div>
        </div>
    """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    # Live Key Facts & AI Card
    st.markdown("""
        <div class="wl-card" style="border-left: 3px solid #2962ff;">
            <div style="font-weight: bold; color: #2962ff; font-size: 11px;">✨ ZURI KEY FACTS</div>
            <div style="font-size: 11px; margin-top: 4px; color: #d1d4dc;">
                Citigroup raised 12-month NVDA target. Fri macro backdrop remains friendly with higher institutional inflows expected.
            </div>
        </div>
    """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    # Ambient Sidebar Chat Input
    with st.expander("💬 Zuri AI Copilot", expanded=True):
        cmd = st.text_input("Trade Command", placeholder="Buy NVDA risk 1.5%", label_visibility="collapsed")
        if cmd:
            try:
                res = requests.post(f"{BACKEND_URL}/api/parse-trade", json={"prompt": cmd, "execute": True}).json()
                st.success(f"Executed: {res.get('parsed_trade', {}).get('ticker')}")
            except Exception as e:
                st.error("Execution failed.")