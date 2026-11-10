import unittest
from unittest.mock import Mock, patch

from backend.fill_tracking import ingest_fill_pages, reconcile_paper_cursor


def activity(index: int) -> dict:
    return {
        "id": f"fill-{index}", "order_id": "order-1", "symbol": "AAPL",
        "side": "buy", "quantity": 0.1, "price": 100.0,
        "time": "2026-11-10T12:00:00Z",
    }


class FillPageIngestionTests(unittest.TestCase):
    def test_saves_each_page_before_reading_the_next(self):
        calls = []

        class Adapter:
            def fill_activities(self, page_token=None, after=None):
                calls.append(("fetch", page_token, after))
                return [activity(i) for i in range(100)] if page_token is None else [activity(100)]

        def save(expected, next_cursor, fills):
            calls.append(("save", expected, next_cursor))
            return len(fills)

        self.assertEqual(ingest_fill_pages(Adapter(), None, "start", save), (101, False))
        self.assertEqual(calls, [
            ("fetch", None, "start"), ("save", None, "fill-99"),
            ("fetch", "fill-99", "start"), ("save", "fill-99", "fill-100"),
        ])

    def test_stops_on_failed_save_without_reading_next_page(self):
        adapter = Mock()
        adapter.fill_activities.return_value = [activity(i) for i in range(100)]
        save = Mock(side_effect=RuntimeError("storage unavailable"))
        with self.assertRaisesRegex(RuntimeError, "storage unavailable"):
            ingest_fill_pages(adapter, None, "start", save)
        adapter.fill_activities.assert_called_once()

    def test_bounded_pages_and_non_advancing_cursor(self):
        adapter = Mock()
        adapter.fill_activities.return_value = [activity(i) for i in range(100)]
        self.assertEqual(ingest_fill_pages(adapter, None, "start", lambda *_: 100, max_pages=1), (100, True))
        adapter.fill_activities.return_value = [activity(99)]
        with self.assertRaisesRegex(ValueError, "non-advancing"):
            ingest_fill_pages(adapter, "fill-99", "start", lambda *_: 1)

    def test_empty_page_and_invalid_page_limit(self):
        adapter = Mock()
        adapter.fill_activities.return_value = []
        save = Mock()
        self.assertEqual(ingest_fill_pages(adapter, "last", "start", save), (0, False))
        save.assert_not_called()
        with self.assertRaises(ValueError):
            ingest_fill_pages(adapter, None, "start", save, max_pages=0)


class PaperCursorReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.connection = {"id": "connection-1", "user_id": "user-1", "broker": "alpaca", "environment": "paper"}
        self.cursor = {
            "id": "cursor-1", "connection_id": "connection-1", "user_id": "user-1",
            "account_number": "paper-account", "starts_at": "start", "cursor": "previous",
        }
        self.adapter = Mock()
        self.adapter.account.return_value = {"label": "paper-account"}
        self.adapter.fill_activities.return_value = [activity(1)]
        self.save = Mock(return_value=1)

    def test_saves_for_the_matching_paper_account(self):
        self.assertEqual(reconcile_paper_cursor(self.connection, self.cursor, self.adapter, self.save), (1, False))
        self.adapter.fill_activities.assert_called_once_with(page_token="previous", after="start")
        self.save.assert_called_once_with("cursor-1", "previous", "fill-1", [activity(1)])

    def test_rejects_live_and_other_brokers_before_reading_account(self):
        for changes in ({"environment": "live"}, {"broker": "oanda"}):
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(ValueError, "Alpaca paper"):
                    reconcile_paper_cursor({**self.connection, **changes}, self.cursor, self.adapter, self.save)
        self.adapter.account.assert_not_called()
        self.adapter.fill_activities.assert_not_called()
        self.save.assert_not_called()

    def test_rejects_detached_or_other_users_cursors(self):
        for changes in ({"connection_id": None}, {"connection_id": "other"}, {"user_id": "other"}):
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(ValueError, "does not belong"):
                    reconcile_paper_cursor(self.connection, {**self.cursor, **changes}, self.adapter, self.save)
        self.adapter.account.assert_not_called()
        self.save.assert_not_called()

    def test_rejects_missing_or_changed_broker_account(self):
        for label in (None, "", " ", "different-account"):
            with self.subTest(label=label):
                self.adapter.account.return_value = {"label": label}
                with self.assertRaisesRegex(ValueError, "does not match"):
                    reconcile_paper_cursor(self.connection, self.cursor, self.adapter, self.save)
        self.adapter.fill_activities.assert_not_called()
        self.save.assert_not_called()

    def test_broker_or_storage_failure_is_not_reported_as_success(self):
        self.adapter.account.side_effect = RuntimeError("broker unavailable")
        with self.assertRaisesRegex(RuntimeError, "broker unavailable"):
            reconcile_paper_cursor(self.connection, self.cursor, self.adapter, self.save)
        self.adapter.account.side_effect = None
        self.save.side_effect = RuntimeError("storage unavailable")
        with self.assertRaisesRegex(RuntimeError, "storage unavailable"):
            reconcile_paper_cursor(self.connection, self.cursor, self.adapter, self.save)


class StoredCursorReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.cursor_id = "8c88cc87-84de-4e16-ad50-c16b5d920722"
        self.cursor = {
            "id": self.cursor_id, "connection_id": "connection-1", "user_id": "user-1",
            "account_number": "paper-account", "starts_at": "start", "cursor": None,
        }
        self.connection = {
            "id": "connection-1", "user_id": "user-1", "broker": "alpaca",
            "environment": "paper", "fill_revision": "revision-1",
        }
        self.adapter = Mock()
        self.adapter.account.return_value = {"label": "paper-account"}
        self.adapter.fill_activities.return_value = [activity(1)]

    def test_reads_broker_and_commits_page_with_connection_revision(self):
        from backend.main import reconcile_stored_alpaca_paper_cursor

        with patch("backend.main._service_request", side_effect=[[self.cursor], 1]) as storage, \
                patch("backend.main._load_connection", return_value=(self.connection, self.adapter)):
            self.assertEqual(reconcile_stored_alpaca_paper_cursor(self.cursor_id), (1, False))
        storage.assert_any_call("rpc/save_alpaca_fill_page", "POST", json={
            "p_cursor_id": self.cursor_id, "p_expected_cursor": None, "p_next_cursor": "fill-1",
            "p_fills": [activity(1)], "p_connection_revision": "revision-1",
        })

    def test_disconnected_or_wrong_account_never_commits(self):
        from backend.main import reconcile_stored_alpaca_paper_cursor

        for cursor, connection in [
            ({**self.cursor, "connection_id": None}, self.connection),
            (self.cursor, {**self.connection, "id": "other"}),
        ]:
            with self.subTest(cursor=cursor, connection=connection), \
                    patch("backend.main._service_request", return_value=[cursor]) as storage, \
                    patch("backend.main._load_connection", return_value=(connection, self.adapter)):
                with self.assertRaises(ValueError):
                    reconcile_stored_alpaca_paper_cursor(self.cursor_id)
                self.assertEqual(storage.call_count, 1)

    def test_storage_and_invalid_results_fail_explicitly(self):
        from backend.main import reconcile_stored_alpaca_paper_cursor

        for response in (None, True, -1, 2):
            with self.subTest(response=response), \
                    patch("backend.main._service_request", side_effect=[[self.cursor], response]), \
                    patch("backend.main._load_connection", return_value=(self.connection, self.adapter)):
                with self.assertRaisesRegex(ValueError, "invalid inserted count"):
                    reconcile_stored_alpaca_paper_cursor(self.cursor_id)
        with patch("backend.main._service_request", side_effect=[[self.cursor], RuntimeError("storage unavailable")]), \
                patch("backend.main._load_connection", return_value=(self.connection, self.adapter)):
            with self.assertRaisesRegex(RuntimeError, "storage unavailable"):
                reconcile_stored_alpaca_paper_cursor(self.cursor_id)

    def test_provisions_only_the_verified_linked_paper_account(self):
        from backend.main import ensure_alpaca_paper_cursor

        connection = {**self.connection, "account_label": "paper-account"}
        with patch("backend.main._service_request", return_value=self.cursor_id) as storage:
            self.assertEqual(ensure_alpaca_paper_cursor(connection, self.adapter), self.cursor_id)
        storage.assert_called_once_with("rpc/ensure_alpaca_fill_cursor", "POST", json={
            "p_connection_id": "connection-1", "p_connection_revision": "revision-1",
            "p_account_number": "paper-account",
        })

    def test_provisioning_fails_before_storage_for_invalid_connections(self):
        from backend.main import ensure_alpaca_paper_cursor

        connection = {**self.connection, "account_label": "paper-account"}
        with patch("backend.main._service_request") as storage:
            for changes in ({"environment": "live"}, {"broker": "oanda"}, {"account_label": "other"}):
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    ensure_alpaca_paper_cursor({**connection, **changes}, self.adapter)
            self.adapter.account.return_value = {"label": ""}
            with self.assertRaises(ValueError):
                ensure_alpaca_paper_cursor(connection, self.adapter)
            storage.assert_not_called()

    def test_invalid_provision_result_is_not_success(self):
        from backend.main import ensure_alpaca_paper_cursor

        connection = {**self.connection, "account_label": "paper-account"}
        for result in (None, "not-a-uuid"):
            with self.subTest(result=result), patch("backend.main._service_request", return_value=result):
                with self.assertRaises(ValueError):
                    ensure_alpaca_paper_cursor(connection, self.adapter)


class ReconciliationEndpointTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from backend.main import app

        self.client = TestClient(app)
        self.connection_id = "8c88cc87-84de-4e16-ad50-c16b5d920722"
        self.secret = "a" * 40

    def test_requires_configured_secret_and_valid_authorization(self):
        for secret, authorization, expected in [
            ("", None, 503), ("short", "Bearer short", 503),
            (self.secret, None, 401), (self.secret, "Bearer wrong", 401),
        ]:
            with self.subTest(expected=expected), \
                    patch.dict("os.environ", {"ALPACA_FILL_RECONCILIATION_SECRET": secret}), \
                    patch("backend.main._connections_request") as lookup:
                headers = {"Authorization": authorization} if authorization else {}
                response = self.client.post("/internal/alpaca-paper/reconcile",
                                            json={"connection_id": self.connection_id}, headers=headers)
                self.assertEqual(response.status_code, expected)
                lookup.assert_not_called()

    def test_only_selects_paper_alpaca_and_reports_progress(self):
        row = {"id": self.connection_id, "credentials_encrypted": "encrypted"}
        with patch.dict("os.environ", {"ALPACA_FILL_RECONCILIATION_SECRET": self.secret}), \
            patch("backend.main._connections_request", return_value=[row]) as lookup, \
            patch("backend.main.brokers.decrypt_credentials", return_value={}), \
            patch("backend.main.brokers.get_adapter") as adapter, \
            patch("backend.main.ensure_alpaca_paper_cursor", return_value=self.connection_id) as provision, \
            patch("backend.main.reconcile_stored_alpaca_paper_cursor", return_value=(2, True)):
            response = self.client.post("/internal/alpaca-paper/reconcile", json={"connection_id": self.connection_id},
                                    headers={"Authorization": f"Bearer {self.secret}"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"inserted": 2, "more": True})
        lookup.assert_called_once_with("GET", {
            "select": "*", "id": f"eq.{self.connection_id}", "broker": "eq.alpaca",
            "environment": "eq.paper", "limit": "1",
        })
        provision.assert_called_once_with(row, adapter.return_value)

    def test_errors_are_not_reported_as_success(self):
        with patch.dict("os.environ", {"ALPACA_FILL_RECONCILIATION_SECRET": self.secret}), \
            patch("backend.main._connections_request", return_value=[]):
            response = self.client.post("/internal/alpaca-paper/reconcile", json={"connection_id": self.connection_id},
                                    headers={"Authorization": f"Bearer {self.secret}"})
            self.assertEqual(response.status_code, 404)
        with patch.dict("os.environ", {"ALPACA_FILL_RECONCILIATION_SECRET": self.secret}), \
            patch("backend.main._connections_request", return_value=[{"credentials_encrypted": "encrypted"}]), \
            patch("backend.main.brokers.decrypt_credentials", return_value={}), \
            patch("backend.main.brokers.get_adapter"), \
            patch("backend.main.ensure_alpaca_paper_cursor", side_effect=ValueError("account changed")):
            response = self.client.post("/internal/alpaca-paper/reconcile", json={"connection_id": self.connection_id},
                                    headers={"Authorization": f"Bearer {self.secret}"})
            self.assertEqual(response.status_code, 409)


class ConfirmedFillJournalSwitchTests(unittest.TestCase):
    def test_accepted_paper_order_does_not_create_a_journal_record(self):
        from fastapi.testclient import TestClient
        from backend.main import app, require_authenticated_user

        app.dependency_overrides[require_authenticated_user] = lambda: {"id": "test-user"}
        self.addCleanup(app.dependency_overrides.pop, require_authenticated_user, None)
        adapter = Mock()
        adapter.account.return_value = {"equity": 1000}
        adapter.price.return_value = 10
        adapter.positions.return_value = []
        adapter.place_order.return_value = {"order_id": "pending", "status": "accepted"}
        adapter.market_clock.return_value = {"is_open": False}
        with patch.dict("os.environ", {"ALPACA_CONFIRMED_FILL_JOURNAL": "true"}), \
                patch("backend.main._load_connection", return_value=({"environment": "paper"}, adapter)), \
                patch("backend.main._safe_rows", return_value=[{}]), \
                patch("backend.main._service_request") as storage:
            response = TestClient(app).post("/api/brokers/alpaca/orders", json={
                "symbol": "AAPL", "side": "buy", "quantity": 1, "confirmed": True,
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "accepted")
        storage.assert_not_called()

    def test_only_enabled_alpaca_paper_skips_legacy_trade_capture(self):
        from backend.main import _capture_trade

        for flag, broker, environment, expected_calls in [
            ("", "alpaca", "paper", 2),
            ("true", "alpaca", "paper", 0),
            ("true", "alpaca", "live", 2),
            ("true", "oanda", "paper", 2),
        ]:
            with self.subTest(flag=flag, broker=broker, environment=environment), \
                    patch.dict("os.environ", {"ALPACA_CONFIRMED_FILL_JOURNAL": flag}), \
                    patch("backend.main._service_request", return_value=[{"id": "entry"}]) as storage:
                _capture_trade("user", "order_placed", "AAPL", "buy", 1, broker, environment, {})
                self.assertEqual(storage.call_count, expected_calls)

    def test_paper_sync_reads_confirmed_fills_not_positions(self):
        from backend.main import sync_journal

        connection = {"broker": "alpaca", "environment": "paper"}
        adapter = Mock()
        with patch.dict("os.environ", {"ALPACA_CONFIRMED_FILL_JOURNAL": "true"}), \
                patch("backend.main._active_connection", return_value=(connection, adapter)), \
                patch("backend.main.ensure_alpaca_paper_cursor", return_value="cursor"), \
                patch("backend.main.reconcile_stored_alpaca_paper_cursor", return_value=(2, True)) as reconcile, \
                patch("backend.main._capture_trade") as capture:
            self.assertEqual(sync_journal({"id": "user-1"}), {"created": 2, "closed": 0, "more": True})
            reconcile.assert_called_once_with("cursor")
            adapter.positions.assert_not_called()
            capture.assert_not_called()

    def test_paper_sync_surfaces_failures(self):
        from fastapi import HTTPException
        from backend.main import sync_journal

        connection = {"broker": "alpaca", "environment": "paper"}
        for failure, status in [(ValueError("account changed"), 503), (HTTPException(status_code=404, detail="missing"), 404)]:
            with self.subTest(status=status), \
                    patch.dict("os.environ", {"ALPACA_CONFIRMED_FILL_JOURNAL": "true"}), \
                    patch("backend.main._active_connection", return_value=(connection, Mock())), \
                    patch("backend.main.ensure_alpaca_paper_cursor", side_effect=failure):
                with self.assertRaises(HTTPException) as raised:
                    sync_journal({"id": "user-1"})
                self.assertEqual(raised.exception.status_code, status)
