import unittest
from backend import main
from backend import zuri_agent as za

AVAILABLE = ["BTCUSD", "ETHUSD", "GOLD", "AAPL"]


class ZuriAgentTests(unittest.TestCase):
    def test_symbol_alias(self):
        self.assertEqual(za.normalize_symbol("xauusd", AVAILABLE), "GOLD")

    def test_sanitize_open_chart(self):
        action = za.sanitize_action("open_chart", {"symbol": "XAUUSD", "timeframe": "1h"}, AVAILABLE)
        self.assertEqual(action["type"], "open_chart")
        self.assertEqual(action["args"]["symbol"], "GOLD")

    def test_sanitize_rejects_unknown_tool(self):
        with self.assertRaises(ValueError):
            za.sanitize_action("place_trade", {"symbol": "BTCUSD"}, AVAILABLE)

    def test_risk_limits_out_of_range_rejected(self):
        with self.assertRaises(ValueError):
            za.sanitize_action("set_risk_limits", {"max_trade_risk_percent": 50}, AVAILABLE)

    def test_trade_proposal_is_validated(self):
        action = za.sanitize_action("propose_trade", {"symbol": "XAUUSD", "side": "buy", "quantity": 0.5}, AVAILABLE)
        self.assertEqual(action["args"]["broker_symbol"], "XAUUSD")
        self.assertEqual(action["args"]["quantity"], 0.5)
        self.assertNotIn("confirmed", action["args"])

    def test_trade_proposal_rejects_bad_input(self):
        for bad in (
            {"symbol": "BTCUSD", "side": "hold", "quantity": 1},
            {"symbol": "BTCUSD", "side": "buy", "quantity": 0},
            {"symbol": "BTCUSD", "side": "buy", "quantity": 10**9},
            {"symbol": "BTCUSD", "side": "buy", "quantity": "lots"},
            {"symbol": "BTCUSD", "side": "buy", "quantity": 1, "stop_loss": 90},
            {"symbol": "NOPE", "side": "buy", "quantity": 1},
        ):
            with self.assertRaises(ValueError, msg=str(bad)):
                za.sanitize_action("propose_trade", bad, AVAILABLE)

    def test_walkthrough_has_steps(self):
        walkthrough = za.build_walkthrough("analyze_chart", {"symbol": "BTCUSD"}, AVAILABLE)
        self.assertTrue(walkthrough["steps"])
        self.assertTrue(all("target" in s and "title" in s for s in walkthrough["steps"]))

    def _trade(self, **over):
        args = {"symbol": "ETHUSD", "side": "sell", "quantity": 2, **over}
        return za.sanitize_action("propose_trade", args, AVAILABLE)

    def test_grounding_accepts_what_the_user_said(self):
        za.check_grounded(self._trade(stop_loss=4000, take_profit=3000), "Sell 2 ETHUSD with stop 4,000 and target 3000")
        za.check_grounded(self._trade(), "I want to short eth\nok 2 please")

    def test_grounding_blocks_values_the_user_never_gave(self):
        said = "Sell 2 ETHUSD"
        for action in (self._trade(quantity=5), self._trade(side="buy"), self._trade(stop_loss=4000, take_profit=3000)):
            with self.assertRaises(ValueError):
                za.check_grounded(action, said)
        with self.assertRaises(ValueError):
            za.check_grounded(za.sanitize_action("propose_trade", {"symbol": "BTCUSD", "side": "sell", "quantity": 2}, AVAILABLE), said)

    def test_grounding_blocks_swapped_risk_limits(self):
        capped = za.sanitize_action("set_risk_limits", {"max_trade_risk_percent": 3}, AVAILABLE)
        with self.assertRaises(ValueError):
            za.check_grounded(capped, "Set my max trade risk to 50% and daily loss to 2%")
        za.check_grounded(za.sanitize_action("set_risk_limits", {"max_daily_loss_percent": 2}, AVAILABLE), "daily loss to 2%")


def _reply(content="", tool_calls=None, finish="stop"):
    from types import SimpleNamespace
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=tool_calls), finish_reason=finish)])


def _call(name, args):
    import json
    from types import SimpleNamespace
    return SimpleNamespace(id="c1", function=SimpleNamespace(name=name, arguments=json.dumps(args)))


class AgentLoopTests(unittest.TestCase):
    def run_agent(self, replies, user_text):
        from unittest.mock import MagicMock, patch
        from backend import main as m
        client = MagicMock()
        client.chat.completions.create.side_effect = replies
        actions: list = []
        with patch("backend.main.get_groq_client", return_value=client):
            text = m._run_agent([{"role": "system", "content": "x"}], list(za.ACTION_TOOLS), {"id": "u"}, AVAILABLE, actions, user_text)
        return text, actions, client

    def test_substituted_limit_is_rejected_in_code(self):
        text, actions, _ = self.run_agent([
            _reply(tool_calls=[_call("set_risk_limits", {"max_trade_risk_percent": 3})]),
            _reply("That is above the cap, what would you like?"),
        ], "Set my max trade risk to 50%")
        self.assertEqual(actions, [])
        self.assertIn("cap", text)

    def test_grounded_trade_is_proposed_without_confirmation_flags(self):
        _, actions, _ = self.run_agent([
            _reply(tool_calls=[_call("propose_trade", {"symbol": "ETHUSD", "side": "sell", "quantity": 2})]),
            _reply("Lined up."),
        ], "sell 2 ETHUSD")
        self.assertEqual([a["type"] for a in actions], ["propose_trade"])
        self.assertNotIn("confirmed", actions[0]["args"])

    def test_empty_reply_after_length_cutoff_retries_with_more_room(self):
        text, _, client = self.run_agent([_reply("", finish="length"), _reply("Here is my answer.")], "hello")
        self.assertEqual(text, "Here is my answer.")
        self.assertEqual(client.chat.completions.create.call_count, 2)
        self.assertEqual(client.chat.completions.create.call_args_list[0].kwargs["reasoning_effort"], "low")

    def test_action_without_text_gets_a_fallback_sentence(self):
        text, actions, _ = self.run_agent([
            _reply(tool_calls=[_call("open_chart", {"symbol": "XAUUSD"})]), _reply(""),
        ], "open gold")
        self.assertTrue(actions)
        self.assertIn("nothing happens until you confirm", text)



class ReplyVettingTests(unittest.TestCase):
    def test_detects_false_completion_claims(self):
        for claim in ("I've opened the daily chart for you.", "I opened the chart.", "Done! Your limits are saved.",
                      "Your order was placed successfully.", "I have set your daily loss to 2%.", "I’ve placed the order."):
            self.assertTrue(za.unsupported_claims(claim), claim)

    def test_allows_honest_wording(self):
        for ok in ("I've lined up the XAUUSD chart for your approval.", "I can set that once you approve.",
                   "Here is what I'd propose.", "Nothing has been placed yet."):
            self.assertEqual(za.unsupported_claims(ok), [], ok)

    def test_strip_claims_keeps_the_rest(self):
        self.assertEqual(za.strip_claims("I've opened the chart. Gold is range bound."), "Gold is range bound.")

    def test_footer_is_written_from_facts(self):
        footer = za.status_footer([{"label": "Set your risk limits: 2.0% daily loss"}], ["The user never asked for 3% as max trade risk percent."])
        self.assertIn("Lined up for your approval", footer)
        self.assertIn("Not lined up", footer)
        self.assertEqual(za.status_footer([{"label": "x"}], []), "")


class VettedAgentTests(AgentLoopTests):
    def test_false_claim_is_rewritten_then_stripped_if_it_persists(self):
        text, actions, client = self.run_agent([
            _reply(tool_calls=[_call("open_chart", {"symbol": "XAUUSD"})]),
            _reply("I've opened the chart. Gold looks range bound."),
            _reply("I've opened the chart again. Gold looks range bound."),
        ], "open gold")
        self.assertTrue(actions)
        self.assertNotIn("opened", text)
        self.assertIn("range bound", text)

    def test_false_claim_rewrite_is_used_when_honest(self):
        text, _, _ = self.run_agent([
            _reply(tool_calls=[_call("open_chart", {"symbol": "XAUUSD"})]),
            _reply("Done, I've opened it."),
            _reply("I've lined up the chart for your approval."),
        ], "open gold")
        self.assertEqual(text, "I've lined up the chart for your approval.")

    def test_valid_limit_survives_an_invalid_one(self):
        text, actions, _ = self.run_agent([
            _reply(tool_calls=[_call("set_risk_limits", {"max_trade_risk_percent": 50, "max_daily_loss_percent": 2})]),
            _reply("I can line up the 2% daily limit; 50% is too high."),
        ], "Set my max trade risk to 50% and daily loss to 2%")
        self.assertEqual(actions[0]["args"], {"max_daily_loss_percent": 2.0})
        self.assertIn("Not lined up", text)
        self.assertIn("2.0% daily loss", text)


class IntentTests(unittest.TestCase):
    AV = ["BTCUSD", "ETHUSD", "SOLUSD", "EURUSD", "GOLD", "AAPL"]

    def test_trade_command(self):
        self.assertEqual(za.extract_intents("Sell 2 ETHUSD with stop 4000 and target 3000. Yes do it.", self.AV),
                         [("propose_trade", {"symbol": "ETHUSD", "side": "sell", "quantity": 2.0, "stop_loss": 4000.0, "take_profit": 3000.0})])
        self.assertEqual(za.extract_intents("buy 0.5 xauusd", self.AV), [("propose_trade", {"symbol": "GOLD", "side": "buy", "quantity": 0.5})])

    def test_vague_or_hedged_trades_are_not_read(self):
        for text in ("buy some gold", "Should I sell 2 ETHUSD?", "what if I buy 1 BTCUSD", "buy 2 of something"):
            self.assertEqual([i for i in za.extract_intents(text, self.AV) if i[0] == "propose_trade"], [], text)

    def test_risk_limits(self):
        self.assertEqual(za.extract_intents("Set my max trade risk to 50% and daily loss to 2%", self.AV),
                         [("set_risk_limits", {"max_trade_risk_percent": 50.0, "max_daily_loss_percent": 2.0})])
        self.assertEqual(za.extract_intents("change my daily loss limit to 3%", self.AV), [("set_risk_limits", {"max_daily_loss_percent": 3.0})])
        self.assertEqual(za.extract_intents("set 1% risk per trade", self.AV), [("set_risk_limits", {"max_trade_risk_percent": 1.0})])

    def test_open_chart(self):
        self.assertEqual(za.extract_intents("Open XAUUSD and give me a detailed analysis", self.AV), [("open_chart", {"symbol": "GOLD"})])
        self.assertEqual(za.extract_intents("show me the 4h bitcoin chart", self.AV), [("open_chart", {"symbol": "BTCUSD", "timeframe": "4h"})])
        self.assertEqual(za.extract_intents("pull up the BTCUSD weekly chart", self.AV), [("open_chart", {"symbol": "BTCUSD", "timeframe": "1W"})])


class PreprocessTests(unittest.TestCase):
    AV = IntentTests.AV

    def test_valid_limit_and_rejection_are_handled_in_code(self):
        actions, rejections, messages = [], [], []
        text = "Set my max trade risk to 50% and daily loss to 2%"
        main._preprocess_request(messages, self.AV, text, text, actions, rejections)
        self.assertEqual([a["args"] for a in actions], [{"max_daily_loss_percent": 2.0}])
        self.assertEqual(len(rejections), 1)
        self.assertIn("Refused", messages[0]["content"])

    def test_trade_is_lined_up_without_the_model(self):
        actions, rejections, messages = [], [], []
        text = "Sell 2 ETHUSD with stop 4000 and target 3000"
        main._preprocess_request(messages, self.AV, text, text, actions, rejections)
        self.assertEqual(actions[0]["type"], "propose_trade")
        self.assertEqual(rejections, [])


class CoachingTests(unittest.TestCase):
    def test_stage_rises_only_with_evidence(self):
        self.assertEqual(za.coaching_stage({})[0], 0)
        self.assertEqual(za.coaching_stage({"conversations": 3, "tenure_days": 2})[0], 0)
        mid = za.coaching_stage({"conversations": 25, "tenure_days": 70, "journal_notes": 4})[0]
        top = za.coaching_stage({"conversations": 200, "tenure_days": 400, "journal_notes": 50, "traded": True, "quiz_level": "advancing", "experience": "Experienced"})[0]
        self.assertEqual((mid, top), (1, 3))

    def test_directive_scales_and_includes_gaps(self):
        low = za.coaching_directive({})
        high = za.coaching_directive({"conversations": 200, "tenure_days": 400, "journal_notes": 50, "traded": True, "quiz_level": "advancing"}, ["position sizing"])
        self.assertIn("Foundations", low)
        self.assertIn("ONE new term", low)
        self.assertIn("Advanced", high)
        self.assertIn("sparring partner", high)
        self.assertIn("position sizing", high)
        self.assertNotIn("OPEN KNOWLEDGE GAPS", low)


class EmailLinkGateTests(unittest.TestCase):
    @staticmethod
    def _token(amr):
        import base64, json
        body = base64.urlsafe_b64encode(json.dumps({"amr": amr}).encode()).decode().rstrip("=")
        return f"Bearer h.{body}.s"

    def test_new_google_account_is_pending_until_flagged(self):
        user = {"created_at": "2026-10-28T08:00:00Z", "app_metadata": {"providers": ["google"]}}
        self.assertTrue(main.email_link_pending(user))
        self.assertFalse(main.email_link_pending({**user, "app_metadata": {"providers": ["google"], "email_link_verified": True}}))

    def test_user_editable_metadata_cannot_lift_the_gate(self):
        user = {"created_at": "2026-10-28T08:00:00Z", "app_metadata": {"providers": ["google"]}, "user_metadata": {"email_link_verified": True, "onboarding_completed": True}}
        self.assertTrue(main.email_link_pending(user))

    def test_older_and_email_accounts_are_not_gated(self):
        self.assertFalse(main.email_link_pending({"created_at": "2026-01-01T00:00:00Z", "app_metadata": {"providers": ["google"]}}))
        self.assertFalse(main.email_link_pending({"created_at": "2026-10-28T08:00:00Z", "app_metadata": {"providers": ["email"]}}))

    def test_only_an_emailed_link_sign_in_counts(self):
        self.assertTrue(main._token_signed_in_by_email_link(self._token([{"method": "otp"}])))
        self.assertFalse(main._token_signed_in_by_email_link(self._token([{"method": "oauth"}])))
        self.assertFalse(main._token_signed_in_by_email_link("Bearer garbage"))


class OnboardingTests(unittest.TestCase):
    def test_clear_done_phrases(self):
        for text in ("No", "nothing else", "That's all", "I'm good.", "let's go", "No thanks!"):
            self.assertEqual(za.onboarding_signal(text), "done", text)

    def test_sharing_is_not_done(self):
        self.assertIsNone(za.onboarding_signal("I lost money on gold last month"))
        self.assertEqual(za.onboarding_signal("x" * 150), "more")

    def test_site_tour_quick_and_detailed(self):
        quick = za.build_walkthrough("site_tour", {"detail": "quick"}, AVAILABLE)
        detailed = za.build_walkthrough("site_tour", {"detail": "detailed"}, AVAILABLE)
        self.assertGreater(len(detailed["steps"]), len(quick["steps"]))
        for step in detailed["steps"]:
            self.assertIn("target", step)

    def test_tours_cover_dashboard_features_and_broker_setup(self):
        detailed_steps = za.build_walkthrough("site_tour", {"detail": "detailed"}, AVAILABLE)["steps"]
        picker = [s for s in detailed_steps if s["target"] == "chart-welcome"]
        self.assertEqual(len(picker), 1)
        self.assertTrue(picker[0]["needs_market"])
        order = [s["target"] for s in detailed_steps]
        self.assertLess(order.index("chart-welcome"), order.index("chart-timeframes"))
        for detail in ("quick", "detailed"):
            targets = [s["target"] for s in za.build_walkthrough("site_tour", {"detail": detail}, AVAILABLE)["steps"]]
            for target in ("dash-weekly", "dash-learn"):
                self.assertIn(target, targets)
        detailed = za.build_walkthrough("site_tour", {"detail": "detailed"}, AVAILABLE)["steps"]
        for target in ("news-charts", "chart-scanners", "chart-backtest", "chart-backtest-history"):
            self.assertIn(target, [s["target"] for s in detailed])
        self.assertIn("Step 6 of 7: Paste your keys", [s["title"] for s in detailed])
        self.assertIn("trade-ticket", [s["target"] for s in detailed])
        self.assertIn("trade-convo", [s["target"] for s in detailed])
        self.assertIn("journal-insights", [s["target"] for s in detailed])
        for target in ("history-log", "history-tabs", "history-snapshots"):
            self.assertIn(target, [s["target"] for s in detailed])
        sections = [s["section"] for s in detailed]
        self.assertLess(sections.index("History"), sections.index("Journal"))
        quick = za.build_walkthrough("site_tour", {"detail": "quick"}, AVAILABLE)["steps"]
        self.assertIn("nav-History", [s["target"] for s in quick])
        for target in ("history-log", "history-tabs", "history-snapshots"):
            self.assertIn(target, [s["target"] for s in detailed])
        order = [s["section"] for s in detailed]
        self.assertLess(order.index("History"), order.index("Journal"))
        self.assertIn("nav-History", [s["target"] for s in quick])
        self.assertIn("nav-Journal", [s["target"] for s in detailed])

    def test_involvement_levels(self):
        self.assertEqual(set(za.INVOLVEMENT_LEVELS), {"side_by_side", "occasional", "on_demand"})


class MarketLayoutTests(unittest.TestCase):
    def test_single_market_is_a_plain_list(self):
        layout = za.build_market_layout({"Crypto": "learning"})
        self.assertEqual(layout["mode"], "list")
        self.assertEqual(layout["markets"][0]["detail"], "simple")

    def test_a_market_the_user_is_new_to_gets_tabs_led_by_the_one_they_know_best(self):
        layout = za.build_market_layout({"Crypto": "comfortable", "Stocks": "new"})
        self.assertEqual(layout["mode"], "tabs")
        self.assertEqual(layout["focus"], "Crypto")
        self.assertEqual([m["market"] for m in layout["markets"]], ["Crypto", "Stocks"])

    def test_markets_the_user_knows_become_sections_with_the_weaker_one_collapsed(self):
        layout = za.build_market_layout({"Crypto": "expert", "Forex": "comfortable", "Stocks": "learning"})
        self.assertEqual(layout["mode"], "sections")
        self.assertEqual({m["market"]: m["collapsed"] for m in layout["markets"]}, {"Crypto": False, "Forex": False, "Stocks": True})

    def test_unknown_markets_and_levels_are_ignored(self):
        layout = za.build_market_layout({"Bonds": "expert", "Crypto": "nonsense"})
        self.assertEqual([m["market"] for m in layout["markets"]], ["Crypto"])
        self.assertEqual(layout["markets"][0]["level"], "learning")


class JourneyStageTests(unittest.TestCase):
    base = {"broker_linked": True, "risk_limits_set": True, "watchlist_count": 2, "trades_recorded": 0, "closed_trades": None, "journal_notes": 0}

    def stage(self, **changes):
        return za.journey_stage({**self.base, **changes})["id"]

    def test_stages_follow_the_path_to_a_first_trade(self):
        self.assertEqual(self.stage(broker_linked=False), "connect")
        self.assertEqual(self.stage(risk_limits_set=False), "protect")
        self.assertEqual(self.stage(watchlist_count=0), "pick_market")
        self.assertEqual(self.stage(), "first_trade")
        self.assertEqual(self.stage(trades_recorded=2), "learn")
        self.assertEqual(self.stage(trades_recorded=30, closed_trades=12), "improve")

    def test_every_stage_has_a_valid_fallback_and_it_is_allowed(self):
        for stage_id, stage in za._STAGES.items():
            move = za.stage_fallback(stage_id, {})
            self.assertIn(move["goal"], stage["allowed"], stage_id)
            if move["goal"] != "talk":
                self.assertTrue(za.build_walkthrough(move["goal"], {}, ["BTCUSD"]), stage_id)

    def test_signals_read_from_the_snapshot_and_money_is_never_promised(self):
        signals = za.stage_signals({"broker_linked": {"name": "x"}, "risk_limits": {"max_trade_risk_percent": 1}, "watchlist": ["BTCUSD"], "activity_counts": {"order_placed": 1}})
        self.assertEqual(za.journey_stage(signals)["id"], "learn")
        self.assertEqual(za.stage_signals({"broker_linked": "no broker linked yet", "watchlist": "empty"})["broker_linked"], False)
        self.assertIn("Never promise", za.stage_directive(za.journey_stage(signals)))

    def test_first_trade_walkthrough_ends_with_the_user_pressing_send(self):
        tour = za.build_walkthrough("first_trade", {}, [])
        self.assertEqual(tour["id"], "first_trade")
        self.assertEqual(tour["steps"][-1]["title"], "You press send")

    def test_broker_walkthrough_says_where_to_go_and_what_to_click(self):
        steps = za.build_walkthrough("link_broker", {}, [])["steps"]
        links = [link["url"] for s in steps for link in s.get("links", [])]
        self.assertIn(za.ALPACA_SIGNUP, links)
        self.assertIn(za.ALPACA_PAPER, links)
        self.assertTrue(all(url.startswith("https://") for url in links))
        text = " ".join(s["title"] + s["body"] + " ".join(s.get("how", [])) for s in steps)
        for phrase in ("Generate New Keys", "Link account", "Verify and link", "Paper"):
            self.assertIn(phrase, text)
        self.assertEqual(steps[5]["target"], "broker-form")

    def test_every_walkthrough_step_says_exactly_what_to_click(self):
        for goal, params in (("open_chart", {"symbol": "BTCUSD"}), ("analyze_chart", {"symbol": "BTCUSD"}), ("add_to_watchlist", {"symbol": "BTCUSD"}),
                             ("set_risk_limits", {}), ("first_trade", {}), ("write_journal", {}), ("link_broker", {}),
                             ("site_tour", {"detail": "quick"}), ("site_tour", {"detail": "detailed"})):
            for step in za.build_walkthrough(goal, params, ["BTCUSD"])["steps"]:
                self.assertTrue(step.get("how"), f"{goal}: {step['title']} has no click-by-click steps")

    def test_tours_hand_over_to_zuri_on_the_next_move_card(self):
        for detail in ("quick", "detailed"):
            steps = za.build_walkthrough("site_tour", {"detail": detail}, [])["steps"]
            self.assertEqual(steps[-1]["target"], "zuri-next")


class NextStepTests(unittest.TestCase):
    def _decide(self, model_answer):
        from unittest import mock
        with mock.patch.object(main, "build_journey_snapshot", return_value={"broker_linked": "no broker linked yet"}), \
             mock.patch.object(main, "build_memory_context", return_value={}), \
             mock.patch.object(main, "_coaching_bundle", return_value={"status": "no_broker"}), \
             mock.patch.object(main, "_safe_rows", return_value=[]), \
             mock.patch.object(main, "_ask_json", return_value=model_answer):
            return main._decide_next_step("u", "")

    def test_model_choice_becomes_a_runnable_walkthrough(self):
        result = self._decide({"headline": "Link a practice broker", "why": "No broker yet.", "goal": "link_broker", "alternatives": [{"headline": "Look around", "goal": "site_tour"}]})
        self.assertEqual(result["primary"]["goal"], "link_broker")
        self.assertTrue(result["primary"]["walkthrough"]["steps"])
        self.assertEqual(result["alternatives"][0]["goal"], "site_tour")

    def test_talk_needs_a_chat_prompt_and_chart_goals_need_a_real_symbol(self):
        talk = self._decide({"headline": "Review your loss", "why": "x", "goal": "talk", "chat_prompt": "Help me review my last loss."})
        self.assertIsNone(talk["primary"]["walkthrough"])
        # an unusable model answer falls back to the stage's own move instead of failing
        bad = self._decide({"headline": "Chart", "why": "x", "goal": "open_chart", "symbol": "NOTREAL"})
        self.assertEqual(bad["primary"]["goal"], "link_broker")

    def test_goals_that_do_not_serve_the_stage_are_replaced(self):
        # no broker: the model's off-stage choice is overridden by the fallback
        result = self._decide({"headline": "Write", "why": "x", "goal": "write_journal"})
        self.assertEqual(result["primary"]["goal"], "link_broker")

    def test_model_outage_uses_the_stage_fallback(self):
        from unittest import mock
        with mock.patch.object(main, "build_journey_snapshot", return_value={}), mock.patch.object(main, "build_memory_context", return_value={}), \
             mock.patch.object(main, "_coaching_bundle", return_value={"status": "no_broker"}), mock.patch.object(main, "_safe_rows", return_value=[]), \
             mock.patch.object(main, "_ask_json", side_effect=main.HTTPException(status_code=502, detail="down")):
            result = main._decide_next_step("u", "")
        self.assertEqual(result["primary"]["goal"], "link_broker")
        self.assertTrue(result["primary"]["why"])

    def test_layout_and_review_rules_reach_the_prompt(self):
        from unittest import mock
        layout = '{"mode":"tabs","focus":"crypto","markets":[{"market":"crypto","level":"learning","detail":"simple","collapsed":false},{"market":"stocks","level":"new","detail":"simple","collapsed":true}]}'
        brief = main._layout_brief(layout)
        self.assertEqual(brief["focus_market"], "crypto")
        self.assertTrue(brief["markets"][1]["collapsed"])
        self.assertIsNone(main._layout_brief("not json"))
        with mock.patch.object(main, "build_journey_snapshot", return_value={}), mock.patch.object(main, "build_memory_context", return_value={}), \
             mock.patch.object(main, "_coaching_bundle", return_value={"status": "no_broker"}), mock.patch.object(main, "_safe_rows", return_value=[]), \
             mock.patch.object(main, "_ask_json", return_value={"headline": "Review", "why": "x", "goal": "talk", "chat_prompt": "Review my trades."}) as ask:
            main._decide_next_step("u", "", 0, layout)
        prompt = ask.call_args[0][0]
        self.assertIn('"focus_market": "crypto"', prompt)
        self.assertIn("CONVERSATION BEATS CHORES", prompt)


class OnboardingChatTests(unittest.TestCase):
    def test_move_decisions(self):
        move = za.decide_onboarding_move
        rich = {"level": True, "goal": True, "markets": True}
        # "nothing to add" with a good picture: act, do not interrogate.
        self.assertEqual(move("ask", "done", ["a", "nothing to add"], rich), "advance")
        # they declined before: never ask again.
        self.assertEqual(move("ask", "done", ["nothing", "no nothing really"], {}), "advance")
        # she knows almost nothing and they have not declined before: one useful question is allowed.
        self.assertEqual(move("ask", "done", ["nothing to add"], {}), "ask")
        # the model chose to act or offer choices: respected.
        self.assertEqual(move("advance", "done", ["x"], {}), "advance")
        self.assertEqual(move("choices", None, ["x"], {}), "choices")
        # a still-sharing user is never pushed to set-up.
        self.assertEqual(move("advance", "more", ["a long story..."], rich), "ask")
        # she stops questioning after enough turns, and garbage output falls back to choices.
        self.assertEqual(move("ask", None, ["a", "b", "c", "d"], {}), "choices")
        self.assertEqual(move("ask", None, ["a", "b", "c"], rich), "choices")
        self.assertEqual(move("nonsense", None, ["a"], {}), "choices")
        # "I don't know" is an answer: never follow it with another question.
        self.assertEqual(move("ask", None, ["a", "i dont know"], {}), "choices")
        self.assertEqual(move("ask", None, ["a", "idk"], {}), "choices")

    def _chat(self, user_turns, model_next):
        from unittest import mock
        from fastapi import BackgroundTasks
        messages = [{"role": "assistant", "content": "Hi"}]
        for i in range(user_turns):
            messages += [{"role": "user", "content": f"answer {i}"}] + ([{"role": "assistant", "content": "ok"}] if i < user_turns - 1 else [])
        request = main.OnboardingRequest(stage="chat", messages=messages)
        with mock.patch.object(main, "build_journey_snapshot", return_value={}), \
             mock.patch.object(main, "_ask_json", return_value={"reply": "Here is something new.", "next": model_next, "known": {}}):
            return main.zuri_onboarding(request, BackgroundTasks(), {"id": "u"}, "")

    def test_endpoint_maps_moves_to_statuses(self):
        self.assertEqual(self._chat(1, "ask")["status"], "continue")
        self.assertEqual(self._chat(3, "advance")["status"], "done")
        self.assertEqual(self._chat(1, "choices")["status"], "unsure")
        self.assertEqual(self._chat(4, "ask")["status"], "unsure")


class TradeIdeaTests(unittest.TestCase):
    def test_affirmation_is_short_and_unmistakable(self):
        for text in ("yes", "Yes please", "ok do it", "go ahead", "line it up"):
            self.assertTrue(za.is_affirmation(text), text)
        for text in ("yes but make it bigger", "no", "yes, don't do it", "maybe", "I think I would like to wait and see what happens first",
                     "buy 5 btcusd"):
            self.assertFalse(za.is_affirmation(text), text)

    def test_a_yes_grounds_a_trade_zuri_suggested_but_never_a_vague_one(self):
        action = za.sanitize_action("propose_trade", {"symbol": "BTCUSD", "side": "buy", "quantity": 0.5}, AVAILABLE)
        suggestion = "Idea: buy 0.5 BTCUSD, with a stop below the day low. Want me to line it up?"
        za.check_grounded(action, "yes\n" + suggestion)
        with self.assertRaises(ValueError):
            za.check_grounded(action, "yes")
        vague = "Idea: BTCUSD looks interesting today. Want me to line it up?"
        with self.assertRaises(ValueError):
            za.check_grounded(action, "yes\n" + vague)


class QuoteTests(unittest.TestCase):
    def setUp(self):
        main._quote_cache.clear()

    def test_unknown_symbols_are_left_out(self):
        result = main.get_quotes(symbols="NOPE", user={"id": "u"})
        self.assertEqual(result, {"quotes": {}})

    def test_failed_feed_returns_no_quote_rather_than_a_guess(self):
        from unittest import mock
        with mock.patch.object(main.requests, "get", side_effect=main.requests.RequestException("down")):
            self.assertIsNone(main._fetch_quote("BTCUSD"))

    def test_parses_real_feed_shape(self):
        from unittest import mock
        meta = {"regularMarketPrice": 110.0, "chartPreviousClose": 100.0, "regularMarketDayHigh": 111, "regularMarketDayLow": 99, "regularMarketVolume": 5, "regularMarketTime": 1}
        response = mock.Mock(status_code=200)
        response.json.return_value = {"chart": {"result": [{"meta": meta}]}}
        with mock.patch.object(main.requests, "get", return_value=response):
            quote = main._fetch_quote("AAPL")
        self.assertAlmostEqual(quote["change_percent"], 10.0)


if __name__ == "__main__":
    unittest.main()
