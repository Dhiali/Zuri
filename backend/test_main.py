import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import requests
from fastapi.testclient import TestClient


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        from backend.main import app, require_authenticated_user

        self.app = app
        self.require_authenticated_user = require_authenticated_user
        self.client = TestClient(app)
        app.dependency_overrides[require_authenticated_user] = lambda: {"id": "test-user"}

    def tearDown(self):
        self.app.dependency_overrides.pop(self.require_authenticated_user, None)

    def test_protected_endpoints_reject_requests_without_a_bearer_token(self):
        self.app.dependency_overrides.pop(self.require_authenticated_user, None)

        response = self.client.get("/api/account")
        history_response = self.client.get(
            "/api/market-history?symbol=AAPL&timeframe=1D&start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z"
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Sign in to use this endpoint.")
        self.assertEqual(history_response.status_code, 401)

    def test_account_deletion_rejects_unauthenticated_requests(self):
        self.app.dependency_overrides.pop(self.require_authenticated_user, None)

        response = self.client.delete("/api/user/account")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Sign in to use this endpoint.")

    @patch("backend.main.requests.get")
    def test_bearer_token_is_verified_with_supabase(self, get):
        from backend.main import require_authenticated_user

        get.return_value = SimpleNamespace(status_code=200, json=lambda: {"id": "user-123"})
        with patch("backend.main.SUPABASE_URL", "https://example.supabase.co"), patch(
            "backend.main.SUPABASE_ANON_KEY", "public-anon-key"
        ):
            user = require_authenticated_user("Bearer valid-session-token")

        self.assertEqual(user["id"], "user-123")
        get.assert_called_once_with(
            "https://example.supabase.co/auth/v1/user",
            headers={
                "apikey": "public-anon-key",
                "Authorization": "Bearer valid-session-token",
            },
            timeout=5,
        )

    @patch("backend.main.requests.delete")
    def test_account_deletion_only_targets_the_authenticated_user(self, delete):
        delete.return_value = SimpleNamespace(status_code=200)
        with patch("backend.main.SUPABASE_URL", "https://example.supabase.co"), patch(
            "backend.main.SUPABASE_SERVICE_ROLE_KEY", "server-only-key"
        ):
            response = self.client.delete("/api/user/account", headers={"Authorization": "Bearer user-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True})
        delete.assert_called_once_with(
            "https://example.supabase.co/auth/v1/admin/users/test-user",
            headers={
                "apikey": "server-only-key",
                "Authorization": "Bearer server-only-key",
            },
            timeout=10,
        )

    @patch("backend.main.requests.delete")
    def test_account_deletion_requires_a_server_only_service_role_key(self, delete):
        with patch("backend.main.SUPABASE_SERVICE_ROLE_KEY", ""):
            response = self.client.delete("/api/user/account", headers={"Authorization": "Bearer user-token"})

        self.assertEqual(response.status_code, 503)
        self.assertIn("not configured", response.json()["detail"])
        delete.assert_not_called()

    def test_account_deletion_allows_frontend_cors_preflight(self):
        response = self.client.options(
            "/api/user/account",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers": "authorization",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:3000")
        self.assertIn("DELETE", response.headers["access-control-allow-methods"])


class GroqConfigTests(unittest.TestCase):
    def test_import_without_groq_key_does_not_crash(self):
        os.environ.pop("GROQ_API_KEY", None)
        import backend.main
        self.assertTrue(hasattr(backend.main, "app"))


class AssistantChatTests(unittest.TestCase):
    def setUp(self):
        from backend.main import app, require_authenticated_user

        self.app = app
        self.client = TestClient(app)
        app.dependency_overrides[require_authenticated_user] = lambda: {"id": "test-user"}
        patcher = patch("backend.main._linked_account_context", return_value="")
        patcher.start()
        self.addCleanup(patcher.stop)
        journey_patcher = patch("backend.main.get_zuri_journey", return_value=None)
        journey_patcher.start()
        self.addCleanup(journey_patcher.stop)
        remember_patcher = patch("backend.main.remember_exchange")
        remember_patcher.start()
        self.addCleanup(remember_patcher.stop)
        snapshot_patcher = patch("backend.main.build_journey_snapshot", return_value={})
        snapshot_patcher.start()
        self.addCleanup(snapshot_patcher.stop)
        memory_patcher = patch("backend.main.build_memory_context", return_value={"lifetime_profile": "not written yet"})
        memory_patcher.start()
        self.addCleanup(memory_patcher.stop)

    def tearDown(self):
        from backend.main import require_authenticated_user

        self.app.dependency_overrides.pop(require_authenticated_user, None)

    @patch("backend.main.requests.get")
    def test_assistant_interests_are_loaded_for_the_authenticated_user(self, get):
        from backend.main import get_user_primary_markets

        get.return_value = SimpleNamespace(
            status_code=200,
            json=lambda: [{"primary_markets": ["Crypto", "Stocks"]}],
        )
        with patch("backend.main.SUPABASE_URL", "https://example.supabase.co"), patch(
            "backend.main.SUPABASE_ANON_KEY", "public-anon-key"
        ):
            markets = get_user_primary_markets("user-123", "Bearer user-token")

        self.assertEqual(markets, ["Crypto", "Stocks"])
        get.assert_called_once_with(
            "https://example.supabase.co/rest/v1/profiles",
            params={"select": "primary_markets,trading_experience", "id": "eq.user-123"},
            headers={
                "apikey": "public-anon-key",
                "Authorization": "Bearer user-token",
            },
            timeout=5,
        )

    @patch("backend.main.get_groq_client")
    @patch("backend.main.get_user_profile_traits", return_value=(["Crypto"], "New to trading"))
    def test_chat_returns_ai_reply_with_workspace_context_and_market_interests(self, get_markets, get_client):
        completion = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="Consider defining your risk first.")
                )
            ]
        )
        get_client.return_value.chat.completions.create.return_value = completion

        response = self.client.post(
            "/api/assistant/chat",
            headers={"Authorization": "Bearer test-token"},
            json={
                "messages": [{"role": "user", "content": "Help me review my plan."}],
                "context": {
                    "section": "Charts",
                    "symbol": "BTCUSD",
                    "timeframe": "15m",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"reply": "Consider defining your risk first.", "actions": []})
        call = get_client.return_value.chat.completions.create.call_args
        self.assertIn("symbol=BTCUSD", call.kwargs["messages"][0]["content"])
        self.assertIn("cannot execute trades", call.kwargs["messages"][0]["content"])
        self.assertIn("saved market interests are: Crypto", call.kwargs["messages"][0]["content"])
        get_markets.assert_called_once_with("test-user", "Bearer test-token")

    @patch("backend.main.get_groq_client")
    def test_chat_includes_selected_news_as_untrusted_source_context(self, get_client):
        from backend.main import AssistantChatRequest, chat_with_assistant
        from fastapi import BackgroundTasks

        get_client.return_value.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="The excerpt reports a rate decision."))]
        )
        request = AssistantChatRequest.model_validate({
            "messages": [{"role": "user", "content": "What could this mean?"}],
            "context": {
                "section": "Charts",
                "symbol": "AAPL",
                "timeframe": "1h",
                "news_article": {
                    "title": "Central bank holds rates",
                    "summary": "The bank left its policy rate unchanged.",
                    "source": "BBC Business",
                    "published_at": "2026-10-16T08:00:00Z",
                    "url": "https://www.bbc.co.uk/news/articles/example",
                },
            },
        })

        with patch("backend.main.get_user_profile_traits", return_value=([], None)):
            result = chat_with_assistant(request, BackgroundTasks(), {"id": "test-user"}, "Bearer test-token")

        self.assertEqual(result["reply"], "The excerpt reports a rate decision.")
        prompt = get_client.return_value.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("untrusted source material", prompt)
        self.assertIn("Central bank holds rates", prompt)
        self.assertIn("lack of signal into a confirmed policy decision", prompt)
        self.assertIn("BBC Business", prompt)

    def test_chat_requires_final_message_from_user(self):
        response = self.client.post(
            "/api/assistant/chat",
            json={
                "messages": [{"role": "assistant", "content": "Hello."}],
                "context": {
                    "section": "Charts",
                    "symbol": "BTCUSD",
                    "timeframe": "15m",
                },
            },
        )

        self.assertEqual(response.status_code, 400)

    @patch("backend.main.get_groq_client")
    @patch("backend.main.get_user_profile_traits", return_value=(["Crypto", "Stocks"], "Experienced"))
    def test_chat_personalizes_to_saved_markets_without_claiming_expertise(self, get_markets, get_client):
        get_client.return_value.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Here is a balanced overview."))]
        )
        response = self.client.post(
            "/api/assistant/chat",
            headers={"Authorization": "Bearer test-token"},
            json={
                "messages": [{"role": "user", "content": "Explain this market move."}],
                "context": {
                    "section": "Charts",
                    "symbol": "BTCUSD",
                    "timeframe": "15m",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        prompt = get_client.return_value.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("saved market interests are: Crypto, Stocks", prompt)
        self.assertIn("not proof of expertise", prompt)
        self.assertIn("do not claim exhaustive expertise", prompt)
        self.assertIn("The user is experienced: be concise and technical", prompt)
        get_markets.assert_called_once_with("test-user", "Bearer test-token")


class MarketNewsTests(unittest.TestCase):
    def setUp(self):
        from backend.main import app, require_authenticated_user

        self.app = app
        self.client = TestClient(app)
        app.dependency_overrides[require_authenticated_user] = lambda: {"id": "test-user"}

    def tearDown(self):
        from backend.main import require_authenticated_user

        self.app.dependency_overrides.pop(require_authenticated_user, None)

    @patch("backend.main._get_cached_news")
    def test_news_endpoint_returns_matching_and_market_wide_stories(self, get_news):
        get_news.return_value = (
            [
                {
                    "id": "apple",
                    "title": "Apple shares slide after earnings update",
                    "summary": "Investors weigh Apple's outlook.",
                    "source": "CNBC",
                    "published_at": "2026-10-16T08:00:00Z",
                    "url": "https://www.cnbc.com/2026/10/16/apple.html",
                },
                {
                    "id": "macro",
                    "title": "Central bank signals rate change as inflation eases",
                    "summary": "Markets react to the policy outlook.",
                    "source": "BBC Business",
                    "published_at": "2026-10-16T07:00:00Z",
                    "url": "https://www.bbc.co.uk/news/articles/macro",
                },
                {
                    "id": "unrelated",
                    "title": "TV and cheap booze blamed for landlord quitting",
                    "summary": "Some call for action against cheap supermarket booze.",
                    "source": "BBC World",
                    "published_at": "2026-10-16T06:00:00Z",
                    "url": "https://www.bbc.co.uk/news/articles/film",
                },
            ],
            [],
        )

        response = self.client.get("/api/market-news?symbols=AAPL")

        self.assertEqual(response.status_code, 200)
        articles = response.json()["articles"]
        self.assertEqual([article["id"] for article in articles], ["apple", "macro"])
        self.assertEqual(articles[0]["related_symbols"], ["AAPL"])
        self.assertEqual(articles[0]["category"], "trading")
        self.assertTrue(articles[1]["market_wide"])

    def test_news_endpoint_rejects_invalid_symbol_filters(self):
        response = self.client.get("/api/market-news?symbols=AAPL%2C%3Cscript%3E")

        self.assertEqual(response.status_code, 400)

    @patch("backend.main.requests.get")
    def test_feed_parser_extracts_publisher_content_and_rejects_offsite_links(self, get):
        from backend.main import _fetch_news_feed

        response = SimpleNamespace(
            content=b"""<rss><channel>
            <item><title>Apple earnings update</title><link>https://www.cnbc.com/apple</link>
            <description><![CDATA[<p>Investors weigh the <b>outlook</b>.</p>]]></description>
            <pubDate>Fri, 16 Oct 2026 08:00:00 GMT</pubDate></item>
            <item><title>Offsite link</title><link>https://example.com/story</link>
            <description>Not a publisher link</description></item>
            </channel></rss>""",
        )
        response.raise_for_status = lambda: None
        get.return_value = response

        articles, warning = _fetch_news_feed({
            "name": "CNBC",
            "url": "https://www.cnbc.com/rss.xml",
            "domains": ("cnbc.com",),
        })

        self.assertIsNone(warning)
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["source"], "CNBC")
        self.assertEqual(articles[0]["category"], "trading")
        self.assertEqual(articles[0]["summary"], "Investors weigh the outlook.")
        self.assertEqual(articles[0]["published_at"], "2026-10-16T08:00:00Z")

    @patch("backend.main.requests.get", side_effect=requests.Timeout("publisher timeout"))
    def test_feed_failure_is_reported_as_a_partial_source_warning(self, get):
        from backend.main import _fetch_news_feed

        articles, warning = _fetch_news_feed({
            "name": "CNBC",
            "url": "https://www.cnbc.com/rss.xml",
            "domains": ("cnbc.com",),
        })

        self.assertEqual(articles, [])
        self.assertEqual(warning, "CNBC")


class BrokerTests(unittest.TestCase):
    def setUp(self):
        from backend.main import app, require_authenticated_user

        self.app = app
        self.client = TestClient(app)
        app.dependency_overrides[require_authenticated_user] = lambda: {"id": "test-user"}
        self.capture = patch("backend.main._capture_trade")
        self.capture_mock = self.capture.start()
        self.addCleanup(self.capture.stop)

    def tearDown(self):
        from backend.main import require_authenticated_user

        self.app.dependency_overrides.pop(require_authenticated_user, None)

    def test_order_is_captured_in_the_journal_automatically(self):
        adapter = SimpleNamespace(
            place_order=lambda *a: {"order_id": "1", "status": "accepted"},
            account=lambda: {"equity": 1000.0},
            price=lambda s: 10.0,
            positions=lambda: [{"symbol": "AAPL", "side": "long", "quantity": 5.0, "avg_entry_price": 8.0}],
        )
        with patch("backend.main._load_connection", return_value=({"environment": "paper"}, adapter)):
            body = {"symbol": "aapl", "side": "sell", "quantity": 2, "confirmed": True}
            self.assertEqual(self.client.post("/api/brokers/alpaca/orders", json=body).status_code, 200)
        args = self.capture_mock.call_args.args
        self.assertEqual(args[1:4], ("order_placed", "AAPL", "sell"))
        context = args[-1]
        self.assertEqual(context["action"], "exit")
        self.assertEqual(context["pl_per_unit"], 2.0)

    def _order(self, rules, held, body=None):
        adapter = SimpleNamespace(
            place_order=lambda *a: {"order_id": "1", "status": "accepted"},
            account=lambda: {"equity": 1000.0},
            price=lambda s: 10.0,
            positions=lambda: held,
        )
        body = body or {"symbol": "AAPL", "side": "buy", "quantity": 5, "confirmed": True}
        with patch("backend.main._load_connection", return_value=({"environment": "paper"}, adapter)), \
             patch("backend.main._safe_rows", return_value=[rules]):
            return self.client.post("/api/brokers/alpaca/orders", json=body)

    def test_settings_limits_are_enforced_on_orders(self):
        held = [{"symbol": "TSLA", "side": "long", "quantity": 1.0}, {"symbol": "MSFT", "side": "long", "quantity": 1.0}]
        self.assertEqual(self._order({"max_open_positions": 2}, held).status_code, 400)
        self.assertEqual(self._order({"max_open_positions": 3}, held).status_code, 200)
        # risk: 5 units, stop 1.0 below a price of 10 = 5 at risk on a 1000 account is 0.5%
        risky = {"symbol": "AAPL", "side": "buy", "quantity": 5, "confirmed": True, "stop_loss": 9.0, "take_profit": 12.0}
        self.assertEqual(self._order({"max_trade_risk_percent": 0.1}, [], risky).status_code, 400)
        self.assertEqual(self._order({"max_trade_risk_percent": 1.0}, [], risky).status_code, 200)
        # closing a position is never blocked by the open-position cap
        sell = {"symbol": "TSLA", "side": "sell", "quantity": 1, "confirmed": True}
        self.assertEqual(self._order({"max_open_positions": 2}, held, sell).status_code, 200)

    def test_journal_analytics_find_leaks(self):
        from backend.journal import compute_stats

        def event(kind, symbol, at, **details):
            return {"kind": kind, "symbol": symbol, "created_at": at, "details": details}

        events = [
            event("watchlist_add", "AAPL", "2026-10-01T08:00:00+00:00"),
            event("order_placed", "AAPL", "2026-10-02T08:00:00+00:00", action="entry", notional=500, equity=1000, stop_loss=None),
            event("order_placed", "AAPL", "2026-10-02T09:00:00+00:00", action="exit", realized_pl=-20.0),
            event("order_placed", "TSLA", "2026-10-02T10:00:00+00:00", action="entry", notional=100, equity=1000, stop_loss=90),
        ]
        stats = compute_stats(events, [], [], 1000.0)
        self.assertEqual(stats["entry_trades"], 2)
        self.assertEqual(stats["trades_without_stop_loss"], 1)
        self.assertEqual(stats["max_position_pct_of_equity"], 50.0)
        self.assertEqual(stats["median_hours_interest_to_first_trade"], 24.0)
        self.assertEqual(stats["win_rate_pct"], 0.0)
        self.assertEqual(stats["trades_with_journal_note_pct"], 0.0)

    def test_analysis_without_activity_does_not_call_the_ai(self):
        with patch("backend.main._load_journey_data", return_value=([], [], [], None, None)), patch("backend.main.get_groq_client") as groq:
            response = self.client.post("/api/journal/analyze", json={})
        self.assertEqual(response.status_code, 200)
        groq.assert_not_called()

    def _row(self, environment):
        from cryptography.fernet import Fernet
        from backend import brokers

        with patch.dict(os.environ, {"BROKER_ENCRYPTION_KEY": Fernet.generate_key().decode()}):
            token = brokers.encrypt_credentials({"api_key": "k", "api_secret": "s"})
            return {"environment": environment, "credentials_encrypted": token}, os.environ["BROKER_ENCRYPTION_KEY"]

    def test_credentials_round_trip_encrypted(self):
        from backend import brokers

        row, key = self._row("paper")
        self.assertNotIn("api_secret", row["credentials_encrypted"])
        with patch.dict(os.environ, {"BROKER_ENCRYPTION_KEY": key}):
            self.assertEqual(brokers.decrypt_credentials(row["credentials_encrypted"])["api_key"], "k")

    def test_order_requires_confirmation(self):
        adapter = SimpleNamespace(place_order=lambda *a: {"order_id": "1", "status": "accepted"}, positions=lambda: [])
        with patch("backend.main._load_connection", return_value=({"environment": "paper"}, adapter)), patch("backend.main._safe_rows", return_value=[]):
            body = {"symbol": "AAPL", "side": "buy", "quantity": 1}
            self.assertEqual(self.client.post("/api/brokers/alpaca/orders", json=body).status_code, 400)
            self.assertEqual(self.client.post("/api/brokers/alpaca/orders", json={**body, "confirmed": True}).status_code, 200)

    def test_account_uses_the_users_linked_broker(self):
        adapter = SimpleNamespace(
            account=lambda: {"equity": 1000.0, "currency": "USD"},
            positions=lambda: [{"symbol": "AAPL", "quantity": 2.0}],
        )
        with patch("backend.main._active_connection", return_value=({"broker": "alpaca", "environment": "live"}, adapter)):
            body = self.client.get("/api/account").json()
        self.assertEqual(body["environment"], "live")
        self.assertEqual(body["account"]["equity"], 1000.0)
        self.assertEqual(body["positions"][0]["symbol"], "AAPL")

    def test_account_requires_a_linked_broker(self):
        from fastapi import HTTPException

        with patch("backend.main._active_connection", side_effect=HTTPException(status_code=404, detail="Link a broker")):
            self.assertEqual(self.client.get("/api/account").status_code, 404)

    def test_assistant_context_includes_linked_account(self):
        from backend.main import _linked_account_context

        adapter = SimpleNamespace(
            account=lambda: {"equity": 1000.0, "currency": "USD", "cash": 500.0, "buying_power": 900.0},
            positions=lambda: [{"symbol": "AAPL", "side": "long", "quantity": 2.0}],
        )
        with patch("backend.main._active_connection", return_value=({"broker": "alpaca", "environment": "paper"}, adapter)):
            context = _linked_account_context("test-user")
        self.assertIn("equity=1000.0", context)
        self.assertIn("AAPL long x2.0", context)
        with patch("backend.main._active_connection", side_effect=RuntimeError("down")):
            self.assertEqual(_linked_account_context("test-user"), "")

    def test_journey_prompt_reflects_mode_level_and_missing_broker(self):
        from backend.main import _journey_prompt

        prompt = _journey_prompt({"mode": "coach", "level": "foundations"}, "")
        self.assertIn("Foundations", prompt)
        self.assertIn("training buddy", prompt)
        self.assertIn("Alpaca paper", prompt)
        self.assertNotIn("Alpaca paper", _journey_prompt({"mode": "assistant", "level": "advancing"}, " linked"))
        self.assertIn("Alpaca paper", _journey_prompt(None, ""))

    def test_live_order_requires_phrase(self):
        adapter = SimpleNamespace(place_order=lambda *a: {"order_id": "1", "status": "accepted"}, positions=lambda: [])
        with patch("backend.main._load_connection", return_value=({"environment": "live"}, adapter)), patch("backend.main._safe_rows", return_value=[]):
            body = {"symbol": "AAPL", "side": "buy", "quantity": 1, "confirmed": True}
            self.assertEqual(self.client.post("/api/brokers/alpaca/orders", json=body).status_code, 400)
            ok = self.client.post(
                "/api/brokers/alpaca/orders", json={**body, "confirmation_phrase": "CONFIRM LIVE"}
            )
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(ok.json()["environment"], "live")

    def test_history_pairs_fills_into_round_trips(self):
        fills = [
            {"id": "1", "symbol": "AAPL", "side": "buy", "quantity": 10, "price": 100.0, "time": "2026-10-01T10:00:00Z"},
            {"id": "2", "symbol": "AAPL", "side": "sell", "quantity": 4, "price": 110.0, "time": "2026-10-02T10:00:00Z"},
        ]
        adapter = SimpleNamespace(history=lambda: {"fills": fills, "round_trips": None})
        with patch("backend.main._active_connection", return_value=({"broker": "alpaca", "environment": "paper"}, adapter)):
            body = self.client.get("/api/history").json()
        self.assertEqual(len(body["round_trips"]), 1)
        self.assertEqual(body["round_trips"][0]["realized_pl"], 40.0)
        self.assertEqual(body["round_trips"][0]["quantity"], 4)


class ChartResearchTests(unittest.TestCase):
    def setUp(self):
        from backend.main import app, require_authenticated_user

        self.app = app
        self.client = TestClient(app)
        self.require_authenticated_user = require_authenticated_user
        app.dependency_overrides[require_authenticated_user] = lambda: {"id": "test-user"}
        capture = patch("backend.main._capture_trade")
        capture.start()
        self.addCleanup(capture.stop)

    def tearDown(self):
        self.app.dependency_overrides.pop(self.require_authenticated_user, None)

    @patch("backend.main._active_connection")
    def test_market_history_uses_the_authenticated_users_broker_and_normalizes_oanda_pairs(self, active_connection):
        bars = [{"t": "2026-01-01T00:00:00Z", "o": 1.1, "h": 1.2, "l": 1.0, "c": 1.15}]
        adapter = SimpleNamespace(historical_candles=lambda *args: bars)
        active_connection.return_value = ({"broker": "oanda"}, adapter)

        response = self.client.get(
            "/api/market-history?symbol=EURUSD&timeframe=1h&start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["symbol"], "EUR_USD")
        self.assertEqual(response.json()["bars"], bars)
        self.assertFalse(response.json()["truncated"])
        active_connection.assert_called_once_with("test-user", None)

    @patch("backend.main._active_connection")
    def test_market_history_rejects_invalid_ranges_before_fetching(self, active_connection):
        response = self.client.get(
            "/api/market-history?symbol=AAPL&timeframe=1D&start=2026-01-03T00:00:00Z&end=2026-01-02T00:00:00Z"
        )

        self.assertEqual(response.status_code, 400)
        active_connection.assert_not_called()

    @patch("backend.main._active_connection")
    def test_market_history_rejects_unsupported_symbols(self, active_connection):
        adapter = SimpleNamespace(historical_candles=lambda *args: [])
        active_connection.return_value = ({"broker": "oanda"}, adapter)

        response = self.client.get(
            "/api/market-history?symbol=EUR_USD%2FUSD&timeframe=1D&start=2026-01-01T00:00:00Z&end=2026-01-02T00:00:00Z"
        )

        self.assertEqual(response.status_code, 400)

    @patch("backend.brokers._request")
    def test_alpaca_aggregates_historical_hourly_bars_for_four_hour_reviews(self, request):
        from datetime import datetime, timezone
        from backend.brokers import AlpacaAdapter

        request.return_value = {
            "bars": [
                {"t": f"2026-01-01T0{hour}:00:00Z", "o": 10 + hour, "h": 12 + hour, "l": 9 + hour, "c": 11 + hour}
                for hour in range(4)
            ],
            "next_page_token": None,
        }
        adapter = AlpacaAdapter({"api_key": "test-key", "api_secret": "test-secret"}, "paper")

        result = adapter.historical_candles(
            "AAPL", "4h",
            datetime(2026, 1, 1, tzinfo=timezone.utc),
            datetime(2026, 1, 2, tzinfo=timezone.utc),
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0], {"t": "2026-01-01T00:00:00Z", "o": 10, "h": 15, "l": 9, "c": 14})
        self.assertEqual(request.call_args.kwargs["params"]["timeframe"], "1Hour")

    @patch("backend.brokers._request")
    def test_oanda_historical_candles_parse_mid_prices(self, request):
        from datetime import datetime, timezone
        from backend.brokers import OandaAdapter

        request.return_value = {
            "candles": [{
                "time": "2026-01-01T00:00:00Z",
                "mid": {"o": "1.1", "h": "1.2", "l": "1.0", "c": "1.15"},
            }],
        }
        adapter = OandaAdapter({"api_token": "test-token", "account_id": "123"}, "paper")

        result = adapter.historical_candles(
            "EUR_USD", "1h",
            datetime(2026, 1, 1, tzinfo=timezone.utc),
            datetime(2026, 1, 2, tzinfo=timezone.utc),
        )

        self.assertEqual(result[0]["c"], 1.15)
        self.assertEqual(request.call_args.kwargs["params"]["granularity"], "H1")

    @patch("backend.brokers._request")
    def test_tradier_daily_history_returns_numeric_candles(self, request):
        from datetime import datetime, timezone
        from backend.brokers import TradierAdapter

        request.return_value = {
            "history": {"day": {"date": "2026-01-01", "open": "10.0", "high": "12.0", "low": "9.0", "close": "11.5"}},
        }
        adapter = TradierAdapter({"access_token": "test-token", "account_id": "123"}, "paper")

        result = adapter.historical_candles(
            "AAPL", "1D",
            datetime(2026, 1, 1, tzinfo=timezone.utc),
            datetime(2026, 1, 2, tzinfo=timezone.utc),
        )

        self.assertEqual(result[0], {"t": "2026-01-01", "o": 10.0, "h": 12.0, "l": 9.0, "c": 11.5})

    @patch("backend.main.get_groq_client")
    def test_ai_scanner_configuration_returns_a_validated_rule(self, get_client):
        from backend.main import ScannerDefinition

        content = '{"name":"20-candle breakout","condition":"breakout","direction":"up","lookback":20}'
        completion = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
        get_client.return_value = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: completion))
        )

        response = self.client.post(
            "/api/scanners/configure",
            json={"prompt": "Find a close above the last 20 candles", "symbol": "AAPL", "timeframe": "1h"},
        )

        self.assertEqual(response.status_code, 200)
        scanner = response.json()["scanner"]
        self.assertEqual(scanner["symbol"], "AAPL")
        self.assertEqual(scanner["condition"], "breakout")
        self.assertIsInstance(ScannerDefinition.model_validate(scanner), ScannerDefinition)

    @patch("backend.main.get_groq_client")
    def test_ai_scanner_configuration_rejects_invalid_model_output(self, get_client):
        completion = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"condition":"send_trade"}'))])
        get_client.return_value = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: completion))
        )

        response = self.client.post(
            "/api/scanners/configure",
            json={"prompt": "Make a scanner", "symbol": "AAPL", "timeframe": "1h"},
        )

        self.assertEqual(response.status_code, 502)

    def test_position_sizing_is_exact_and_capped(self):
        from backend import sizing

        sized = sizing.size_position(equity=10000, price=100, stop=98, risk_percent=1)
        self.assertEqual(sized["units"], 50)
        self.assertEqual(sized["actual_risk"], 100.0)
        capped = sizing.size_position(equity=10000, price=100, stop=98, risk_percent=1, max_notional=2000)
        self.assertEqual(capped["units"], 20)
        self.assertEqual(capped["capped_by"], "buying_power")
        self.assertEqual(sizing.size_position(equity=100, price=100, stop=50, risk_percent=1)["units"], 0)
        forex = sizing.size_position(equity=10000, price=1.1, stop=1.095, risk_percent=1, forex=True)
        self.assertEqual(forex["units"], 20000)
        self.assertEqual(forex["lots"], 0.2)

    def test_suggested_levels_sit_on_the_correct_sides(self):
        from backend import sizing

        for side in ("buy", "sell"):
            stop, target = sizing.suggest_levels(side, 100.0, 1.0)
            self.assertTrue(sizing.levels_valid(side, 100.0, stop, target))
        self.assertFalse(sizing.levels_valid("buy", 100.0, 101.0, 105.0))

    def test_trade_conversation_returns_server_calculated_plan(self):
        import json as _json

        adapter = SimpleNamespace(
            account=lambda: {"equity": 10000.0, "currency": "USD", "buying_power": 40000.0},
            positions=lambda: [],
            price=lambda s: 100.0,
            candles=lambda s: [{"t": "x", "o": 100, "h": 101, "l": 99, "c": 100}] * 20,
        )
        reply = {"reply": "Sounds good, I prepared the numbers.", "emote": "🎯", "proposal": {"symbol": "aapl", "side": "buy", "stop_loss": None, "take_profit": None}}
        completion = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=_json.dumps(reply)))])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: completion)))
        with patch("backend.main._active_connection", return_value=({"broker": "alpaca", "environment": "paper"}, adapter)), \
             patch("backend.main.get_user_profile_traits", return_value=([], None)), \
             patch("backend.main.get_zuri_journey", return_value=None), \
             patch("backend.main.get_groq_client", return_value=client):
            response = self.client.post("/api/trade/converse", headers={"Authorization": "Bearer t"}, json={"messages": [{"role": "user", "content": "I want to buy AAPL"}], "risk_percent": 1})
        self.assertEqual(response.status_code, 200)
        plan = response.json()["plan"]
        self.assertEqual(plan["symbol"], "AAPL")
        self.assertGreater(plan["units"], 0)
        self.assertLess(plan["stop_loss"], 100.0)
        self.assertGreater(plan["take_profit"], 100.0)
        self.assertLessEqual(plan["actual_risk"], 100.0)

    def test_order_with_levels_on_wrong_side_is_rejected(self):
        adapter = SimpleNamespace(
            place_order=lambda *a: {"order_id": "1"}, account=lambda: {"equity": 1000.0},
            price=lambda s: 10.0, positions=lambda: [],
        )
        with patch("backend.main._load_connection", return_value=({"environment": "paper"}, adapter)):
            response = self.client.post("/api/brokers/alpaca/orders", json={"symbol": "AAPL", "side": "buy", "quantity": 1, "confirmed": True, "stop_loss": 11.0, "take_profit": 12.0})
        self.assertEqual(response.status_code, 400)

    def test_short_round_trip_profits_when_price_falls(self):
        from backend.journal import pair_fills

        trips = pair_fills([
            {"id": "1", "symbol": "X", "side": "sell", "quantity": 2, "price": 50.0, "time": "2026-10-01T10:00:00Z"},
            {"id": "2", "symbol": "X", "side": "buy", "quantity": 2, "price": 45.0, "time": "2026-10-01T11:00:00Z"},
        ])
        self.assertEqual(trips[0]["side"], "short")
        self.assertEqual(trips[0]["realized_pl"], 10.0)

    def test_annotations_are_sanitised(self):
        from backend.journal import sanitize_annotations

        raw = [
            {"kind": "support", "index": 3, "price": 101.0, "text": "x" * 300},
            {"kind": "bogus", "index": 999, "price": 5000, "text": "outside the chart"},
            "not a dict",
        ] + [{"kind": "note", "index": 1, "price": 100.5, "text": "n"}] * 10
        clean = sanitize_annotations(raw, 20, 99.0, 105.0)
        self.assertLessEqual(len(clean), 6)
        self.assertTrue(all(len(a["text"]) <= 140 for a in clean))
        self.assertTrue(all(a["index"] is None or a["index"] < 20 for a in clean))

    def test_screenshot_must_be_a_jpeg_data_url(self):
        snapshot = {"id": "11111111-1111-1111-1111-111111111111", "symbol": "AAPL"}
        with patch("backend.main._own_snapshot", return_value=snapshot), patch("backend.main._service_request") as service:
            bad = self.client.post(f"/api/snapshots/{snapshot['id']}/screenshot", json={"image": "data:text/html;base64," + "A" * 200})
            self.assertEqual(bad.status_code, 400)
            good = self.client.post(f"/api/snapshots/{snapshot['id']}/screenshot", json={"image": "data:image/jpeg;base64," + "A" * 200})
            self.assertEqual(good.status_code, 200)
            service.assert_called_once()


class CoachingTests(unittest.TestCase):
    @staticmethod
    def trip(day: str, pl: float, hour: int = 10, opened: str | None = None, symbol: str = "AAPL"):
        return {"symbol": symbol, "side": "long", "realized_pl": pl, "closed_at": f"{day}T{hour:02d}:00:00Z", "opened_at": opened}

    def test_weekday_gap_is_reliable_only_with_enough_evidence(self):
        from backend import coaching

        mondays = [self.trip("2026-09-14", 10) for _ in range(7)] + [self.trip("2026-09-21", -5)]
        wednesdays = [self.trip("2026-09-16", -10) for _ in range(7)] + [self.trip("2026-09-23", 5)]
        strong = coaching.compare_groups({"Monday": mondays, "Wednesday": wednesdays})
        self.assertEqual(strong["verdict"], "reliable")
        self.assertEqual((strong["best"], strong["worst"]), ("Monday", "Wednesday"))
        weak = coaching.compare_groups({"Monday": mondays[:5], "Wednesday": wednesdays[:3]})
        self.assertEqual(weak["verdict"], "insufficient_data")
        close = coaching.compare_groups({"Monday": mondays[:3] + wednesdays[:2], "Wednesday": mondays[:2] + wednesdays[:3]})
        self.assertEqual(close["verdict"], "possibly_chance")

    def test_weekly_breakdown_uses_the_users_timezone(self):
        from datetime import datetime, timezone
        from backend import coaching

        trips = [self.trip("2026-09-14", 10, hour=23)]  # 23:00 UTC Monday is Tuesday 01:00 in SAST
        weekly = coaching.weekly_breakdown(trips, 120, now=datetime(2026, 9, 15, tzinfo=timezone.utc))
        self.assertIn("Tuesday", weekly["weekday"]["groups"])
        self.assertEqual(weekly["this_week"]["trades"], 1)

    def test_revenge_trading_pattern_and_cooldown_advice(self):
        from backend import coaching

        trips = []
        for i in range(6):
            day = f"2026-09-{10 + i:02d}"
            trips.append({"symbol": "X", "side": "long", "realized_pl": -10, "opened_at": f"{day}T09:00:00Z", "closed_at": f"{day}T09:30:00Z"})
            trips.append({"symbol": "X", "side": "long", "realized_pl": -10, "opened_at": f"{day}T09:40:00Z", "closed_at": f"{day}T10:00:00Z"})
            trips.append({"symbol": "X", "side": "long", "realized_pl": 25, "opened_at": f"{day}T14:00:00Z", "closed_at": f"{day}T15:00:00Z"})
        patterns = coaching.after_loss_pattern(trips)
        self.assertEqual(patterns["groups"]["quick_after_loss"]["win_rate_pct"], 0.0)
        profile = coaching.strategy_profile(trips, [])
        ids = [s["id"] for s in coaching.suggestions(profile, patterns)]
        self.assertIn("cooldown", ids)

    def test_small_samples_get_foundation_advice_not_patterns(self):
        from backend import coaching

        profile = coaching.strategy_profile([self.trip("2026-09-14", 5)], [])
        advice = coaching.suggestions(profile, {"groups": {}})
        self.assertEqual([a["id"] for a in advice], ["build-sample"])
        self.assertTrue(all(r["url"].startswith("https://") for r in coaching.resources_for(advice[0]["topics"])))


class CommunityTests(unittest.TestCase):
    def setUp(self):
        from backend.main import app, require_authenticated_user

        self.app = app
        self.client = TestClient(app)
        app.dependency_overrides[require_authenticated_user] = lambda: {"id": "11111111-1111-1111-1111-111111111111"}
        self.addCleanup(lambda: app.dependency_overrides.pop(require_authenticated_user, None))

    def test_posts_with_links_or_contact_details_are_rejected(self):
        profile = {"user_id": "u", "handle": "kim", "strategies": ["Day trading"], "bio": ""}
        with patch("backend.main._my_community_profile", return_value=profile), patch("backend.main._service_request", return_value=[]):
            for body in ("join my group t.me/x https://evil.com", "mail me at a@b.com", "visit scam.io now"):
                response = self.client.post("/api/community/posts", json={"body": body, "strategy": "Day trading"})
                self.assertEqual(response.status_code, 400, body)
            ok = self.client.post("/api/community/posts", json={"body": "I wait for the first pullback after the open.", "strategy": "Day trading"})
            self.assertEqual(ok.status_code, 200)

    def test_posting_requires_joining_and_own_strategy(self):
        with patch("backend.main._my_community_profile", return_value=None):
            self.assertEqual(self.client.post("/api/community/posts", json={"body": "hi", "strategy": "Scalping"}).status_code, 403)
        profile = {"user_id": "u", "handle": "kim", "strategies": ["Day trading"], "bio": ""}
        with patch("backend.main._my_community_profile", return_value=profile), patch("backend.main._service_request", return_value=[]):
            self.assertEqual(self.client.post("/api/community/posts", json={"body": "hi", "strategy": "Scalping"}).status_code, 400)

    def test_daily_post_limit(self):
        profile = {"user_id": "u", "handle": "kim", "strategies": ["Day trading"], "bio": ""}
        with patch("backend.main._my_community_profile", return_value=profile), patch("backend.main._service_request", return_value=[{"id": str(i)} for i in range(10)]):
            self.assertEqual(self.client.post("/api/community/posts", json={"body": "hi", "strategy": "Day trading"}).status_code, 429)

    def test_taken_handle_is_rejected(self):
        with patch("backend.main._service_request", return_value=[{"user_id": "other"}]):
            response = self.client.put("/api/community/profile", json={"handle": "kim_t", "strategies": ["Scalping"], "bio": ""})
        self.assertEqual(response.status_code, 409)

    def test_overview_never_exposes_user_ids(self):
        me = {"user_id": "11111111-1111-1111-1111-111111111111", "handle": "me", "strategies": ["Scalping"], "bio": ""}
        other = "22222222-2222-2222-2222-222222222222"

        def fake(table, method, params=None, **kw):
            if table == "community_profiles":
                return [{"user_id": other, "handle": "pat", "strategies": ["Scalping", "Breakouts"], "bio": "hi"}]
            if table == "community_posts" and params.get("parent_id") == "is.null":
                return [{"id": "33333333-3333-3333-3333-333333333333", "author_id": other, "strategy": "Scalping", "body": "tip", "created_at": "2026-10-01T00:00:00Z"}]
            return []

        with patch("backend.main._my_community_profile", return_value=me), patch("backend.main._service_request", side_effect=fake):
            body = self.client.get("/api/community").json()
        self.assertNotIn(other, str(body))
        self.assertEqual(body["traders"][0]["shared"], ["Scalping"])
        self.assertEqual(body["posts"][0]["handle"], "pat")


if __name__ == "__main__":
    unittest.main()
