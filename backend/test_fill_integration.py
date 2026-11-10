"""Opt-in integration test against a disposable, explicitly labelled Docker database."""
import json
import os
import subprocess
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient


CONTAINER = os.getenv("ZURI_FILL_TEST_CONTAINER", "")
USER_ID = "00000000-0000-4000-8000-000000000101"
CONNECTION_ID = "00000000-0000-4000-8000-000000000102"
SECRET = "local-integration-secret-" + "x" * 32


def sql_literal(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


@unittest.skipUnless(CONTAINER, "Requires the isolated fill integration container")
class FillIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        label = subprocess.check_output(
            ["docker", "inspect", "--format", '{{index .Config.Labels "zuri.fill.integration"}}', CONTAINER],
            text=True,
        ).strip()
        if label != "disposable":
            raise RuntimeError("Integration database container does not have the required disposable label")
        from backend.main import app
        cls.client = TestClient(app)
        cls.sql(
            f"delete from auth.users where id = {sql_literal(USER_ID)};"
            f"insert into auth.users (id) values ({sql_literal(USER_ID)});"
            "insert into public.broker_connections "
            "(id,user_id,broker,environment,account_label,credentials_encrypted,fill_tracking_since) values "
            f"({sql_literal(CONNECTION_ID)},{sql_literal(USER_ID)},'alpaca','paper','test-account','test',"
            "'2026-01-01T00:00:00Z');"
        )

    @classmethod
    def sql(cls, statement):
        result = subprocess.run(
            ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-U", "postgres",
             "-d", "zuri_fill_integration", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
            input=statement, text=True, capture_output=True, check=True,
        )
        return result.stdout.strip()

    def setUp(self):
        self.activities = []
        self.requests = []
        self.fail_after_commit = False

    def broker_request(self, method, url, **kwargs):
        if url.endswith("/v2/account"):
            return {"account_number": "test-account"}
        if url.endswith("/v2/account/activities/FILL"):
            params = kwargs["params"]
            self.requests.append(params.copy())
            token = params.get("page_token")
            return [item for item in self.activities if token is None or item["id"] > token]
        raise AssertionError(f"Unexpected broker request: {method} {url}")

    def connections(self, method, params, **kwargs):
        if method != "GET":
            raise AssertionError("Unexpected connection operation")
        rows = self.sql(
            "select coalesce(json_agg(t), '[]'::json)::text from "
            f"(select * from public.broker_connections where id={sql_literal(CONNECTION_ID)}) t;"
        )
        return json.loads(rows)

    def storage(self, table, method, params=None, **kwargs):
        if table == "rpc/ensure_alpaca_fill_cursor" and method == "POST":
            body = kwargs["json"]
            return self.sql(
                "select public.ensure_alpaca_fill_cursor("
                f"{sql_literal(body['p_connection_id'])}::uuid,"
                f"{sql_literal(body['p_connection_revision'])}::uuid,"
                f"{sql_literal(body['p_account_number'])});"
            )
        if table == "alpaca_fill_cursors" and method == "GET":
            cursor_id = params["id"].removeprefix("eq.")
            return json.loads(self.sql(
                "select coalesce(json_agg(t), '[]'::json)::text from "
                f"(select * from public.alpaca_fill_cursors where id={sql_literal(cursor_id)}::uuid) t;"
            ))
        if table == "rpc/save_alpaca_fill_page" and method == "POST":
            body = kwargs["json"]
            inserted = int(self.sql(
                "select public.save_alpaca_fill_page("
                f"{sql_literal(body['p_cursor_id'])}::uuid,"
                f"{sql_literal(body['p_expected_cursor'])},"
                f"{sql_literal(body['p_next_cursor'])},"
                f"{sql_literal(json.dumps(body['p_fills']))}::jsonb,"
                f"{sql_literal(body['p_connection_revision'])}::uuid);"
            ))
            if self.fail_after_commit:
                from fastapi import HTTPException
                self.fail_after_commit = False
                raise HTTPException(status_code=503, detail="Simulated lost storage response")
            return inserted
        raise AssertionError(f"Unexpected storage request: {method} {table}")

    def reconcile(self):
        with patch.dict(os.environ, {"ALPACA_FILL_RECONCILIATION_SECRET": SECRET}), \
                patch("backend.main._connections_request", side_effect=self.connections), \
                patch("backend.main._service_request", side_effect=self.storage), \
                patch("backend.main.brokers.decrypt_credentials", return_value={"api_key": "test", "api_secret": "test"}), \
                patch("backend.brokers._request", side_effect=self.broker_request):
            return self.client.post("/internal/alpaca-paper/reconcile",
                                    json={"connection_id": CONNECTION_ID},
                                    headers={"Authorization": f"Bearer {SECRET}"})

    def test_pending_then_partial_fills_are_saved_and_retry_is_idempotent(self):
        response = self.reconcile()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"inserted": 0, "more": False})
        self.assertEqual(self.sql("select count(*) from public.journal_entries;"), "0")

        self.activities = [
            {"id": "fill-1", "order_id": "order-1", "activity_type": "FILL", "symbol": "AAPL",
             "side": "buy", "qty": "0.4", "price": "101.25", "transaction_time": "2026-01-02T00:00:00Z"},
            {"id": "fill-2", "order_id": "order-1", "activity_type": "FILL", "symbol": "AAPL",
             "side": "buy", "qty": "0.6", "price": "102.00", "transaction_time": "2026-01-02T00:00:01Z"},
        ]
        response = self.reconcile()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"inserted": 2, "more": False})
        self.assertEqual(self.sql("select count(*) from public.journal_entries where source='confirmed_fill';"), "2")
        self.assertEqual(self.sql("select sum(quantity) from public.alpaca_fill_records;"), "1.0")
        self.assertEqual(self.sql("select cursor from public.alpaca_fill_cursors;"), "fill-2")

        response = self.reconcile()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"inserted": 0, "more": False})
        self.assertEqual(self.sql("select count(*) from public.journal_entries;"), "2")
        self.assertEqual(self.requests[-1]["page_token"], "fill-2")

        self.activities.append(
            {"id": "fill-3", "order_id": "order-2", "activity_type": "FILL", "symbol": "AAPL",
             "side": "sell", "qty": "1", "price": "103", "transaction_time": "2026-01-02T00:01:00Z"}
        )
        self.fail_after_commit = True
        self.assertEqual(self.reconcile().status_code, 503)
        self.assertEqual(self.sql("select cursor from public.alpaca_fill_cursors;"), "fill-3")
        self.assertEqual(self.reconcile().json(), {"inserted": 0, "more": False})
        self.assertEqual(self.sql("select count(*) from public.journal_entries;"), "3")
