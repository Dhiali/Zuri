import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient


class GroqConfigTests(unittest.TestCase):
    def test_import_without_groq_key_does_not_crash(self):
        os.environ.pop("GROQ_API_KEY", None)
        import backend.main
        self.assertTrue(hasattr(backend.main, "app"))


class AssistantChatTests(unittest.TestCase):
    def setUp(self):
        from backend.main import app

        self.client = TestClient(app)

    @patch("backend.main.get_groq_client")
    def test_chat_returns_ai_reply_with_workspace_context(self, get_client):
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


if __name__ == "__main__":
    unittest.main()
