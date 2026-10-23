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

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Sign in to use this endpoint.")

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
            params={"select": "primary_markets", "id": "eq.user-123"},
            headers={
                "apikey": "public-anon-key",
                "Authorization": "Bearer user-token",
            },
            timeout=5,
        )

    @patch("backend.main.get_groq_client")
    @patch("backend.main.get_user_primary_markets", return_value=["Crypto"])
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
        self.assertEqual(response.json(), {"reply": "Consider defining your risk first."})
        call = get_client.return_value.chat.completions.create.call_args
        self.assertIn("symbol=BTCUSD", call.kwargs["messages"][0]["content"])
        self.assertIn("cannot execute trades", call.kwargs["messages"][0]["content"])
        self.assertIn("saved market interests are: Crypto", call.kwargs["messages"][0]["content"])
        get_markets.assert_called_once_with("test-user", "Bearer test-token")

    @patch("backend.main.get_groq_client")
    def test_chat_includes_selected_news_as_untrusted_source_context(self, get_client):
        from backend.main import AssistantChatRequest, chat_with_assistant

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

        with patch("backend.main.get_user_primary_markets", return_value=[]):
            result = chat_with_assistant(request, {"id": "test-user"}, "Bearer test-token")

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
    @patch("backend.main.get_user_primary_markets", return_value=["Crypto", "Stocks"])
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


if __name__ == "__main__":
    unittest.main()
