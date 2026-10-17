import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from collect_providers import claude_setup_complete, codexbar_record, colab_record, collect_provider, collect_all, ClaudeSetupRequired
from sync_once import clean_record, merge


class ProviderTests(unittest.TestCase):
    def test_colab_history_reuses_one_probe_and_storage_failure_keeps_the_balance(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            cli = home / "Library/Application Support/AIUsage/ColabRuntime/bin/colab"
            token = home / ".config/colab-cli/token.json"
            for path in (cli, token):
                path.parent.mkdir(parents=True, exist_ok=True); path.write_text("fixture")
            output = "Current balance: 160.5 compute units\nUsage rate: 0.00/hr\nActive assignments: 0\n"
            with patch("collect_providers.Path.home", return_value=home), \
                 patch("collect_providers.run_bounded", return_value=(0, output)) as run, \
                 patch("collect_providers.append_observation", side_effect=ValueError("fixture")) as append:
                result = collect_provider("colab")
                self.assertEqual(result["balance"], 160.5)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.args[0], [str(cli), "--auth", "oauth2", "usage"])
                self.assertEqual(append.call_args.args[0]["activeRuntimes"], 0)
                self.assertNotIn("fixture", json.dumps(result))

    def test_retired_credits_cannot_invoke_a_process(self):
        with patch("collect_providers.run_bounded") as run, patch("collect_providers.collect_codex") as codex:
            self.assertIsNone(collect_provider("googleCredits"))
            run.assert_not_called()
            codex.assert_not_called()

    def test_scheduler_does_not_submit_a_credits_probe(self):
        with patch("collect_providers.collect_provider", return_value=None) as collect:
            result = collect_all()
        self.assertEqual({call.args[0] for call in collect.call_args_list}, {"codex", "claude", "antigravity", "colab"})
        self.assertNotIn("googleCredits", result["status"])

    def test_logged_in_account_does_not_imply_completed_cli_setup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            self.assertFalse(claude_setup_complete(path))
            for flag in (None, False, "true", 1, True):
                path.write_text(json.dumps({"hasCompletedOnboarding": flag,
                                            "oauthAccount": {"email": "fixture@example.invalid"}}))
                self.assertEqual(claude_setup_complete(path), flag is True)
            path.write_text("broken")
            self.assertFalse(claude_setup_complete(path))

    def test_initial_setup_has_a_specific_status_without_raw_errors(self):
        def fixture(provider):
            if provider == "claude":
                raise ClaudeSetupRequired("fixture-secret")
            return None
        with patch("collect_providers.collect_provider", side_effect=fixture):
            result = collect_all()
        self.assertEqual(result["status"]["claude"], "initial_setup_required")
        self.assertNotIn("fixture", json.dumps(result))

    def payload(self, provider="claude"):
        return {"provider": provider, "source": "claude" if provider == "claude" else "cli", "identity": {"email": "fixture@example.invalid"},
                "token": "fixture-secret", "usage": {"updatedAt": "2030-03-17T17:46:40Z",
                "primary": {"usedPercent": 0, "windowMinutes": 300},
                "secondary": {"usedPercent": 42, "windowMinutes": 10080}}}

    def test_claude_strips_private_fields_and_preserves_real_observation(self):
        result = codexbar_record(self.payload(), "claude", now=1900000000)
        self.assertEqual(result["observedAt"], 1900000000)
        self.assertEqual(result["fiveHour"]["usedPercent"], 0)
        self.assertEqual(result["weekly"]["usedPercent"], 42)
        self.assertNotIn("fixture", json.dumps(result))
        self.assertEqual(result["source"], "claudeCli")

    def test_browser_results_cannot_be_published_as_cli_quota(self):
        for provider in ("claude", "antigravity"):
            payload = self.payload(provider)
            for source in ("web", "auto", "oauth", None):
                payload["source"] = source
                self.assertIsNone(codexbar_record(payload, provider, now=1900000000))

    def test_antigravity_model_families_are_not_time_windows(self):
        p = self.payload("antigravity")
        p["usage"]["primary"]["windowMinutes"] = None
        self.assertIsNone(codexbar_record(p, "antigravity", now=1900000000))
        p["usage"]["extraRateWindows"] = [
            {"id": "gemini-weekly", "title": "Gemini", "window": {"usedPercent": 10, "windowMinutes": 10080}},
            {"id": "claude-5h", "title": "Claude", "window": {"usedPercent": 99, "windowMinutes": 300}}]
        result = codexbar_record(p, "antigravity", now=1900000000)
        self.assertIsNone(result["fiveHour"])
        self.assertEqual(result["weekly"]["usedPercent"], 10)

    def test_unknown_usage_and_ambiguous_accounts_are_rejected(self):
        p = self.payload("antigravity")
        p["usage"]["primary"]["usageKnown"] = False
        p["usage"]["extraRateWindows"] = [{"id": "gemini-5h", "usageKnown": False,
            "window": {"usedPercent": 100, "windowMinutes": 300}}]
        self.assertIsNone(codexbar_record(p, "antigravity", now=1900000000))
        self.assertIsNone(codexbar_record([self.payload(), self.payload()], "claude", now=1900000000))

    def test_future_time_unlabeled_duration_and_invalid_percent_are_rejected(self):
        self.assertIsNone(codexbar_record(self.payload(), "claude", now=1899999900))
        p = self.payload()
        p["usage"]["primary"]["windowMinutes"] = 15
        p["usage"]["secondary"]["usedPercent"] = True
        self.assertIsNone(codexbar_record(p, "claude", now=1900000000))

    def test_official_colab_label_required_and_zero_is_a_real_balance(self):
        result = colab_record("Current balance: 0.00 compute units\nUsage rate: 0/hr\n", now=1900000000)
        self.assertEqual(result["balance"], 0)
        self.assertEqual(result["observedAt"], 1900000000)
        self.assertIsNone(colab_record("Current balance: unavailable compute units"))
        self.assertIsNone(colab_record("Current balance: 5 compute units\nCurrent balance: 6 compute units"))

    def test_background_snapshot_discards_private_fields_and_rejects_mixed_units(self):
        raw = {"service": "colab", "source": "colabCli", "observedAt": 1000,
               "balance": 0, "email": "fixture@example.invalid", "token": "fixture-secret"}
        cleaned = clean_record(raw, 1000)
        self.assertEqual(cleaned["balance"], 0)
        self.assertNotIn("fixture", json.dumps(cleaned))
        raw["fiveHour"] = {"usedPercent": 5}
        self.assertIsNone(clean_record(raw, 1000))

    def test_background_merge_never_refreshes_old_observations(self):
        rows = {}
        live = {"service": "claude", "source": "codexBar", "observedAt": 1000,
                "fiveHour": {"usedPercent": 30, "resetsAt": 2000}}
        merge(rows, live, 1000)
        older = dict(live, observedAt=500, source="claudeStatusline")
        merge(rows, older, 1000)
        self.assertEqual(rows["claude"]["observedAt"], 1000)
        self.assertEqual(rows["claude"]["source"], "codexBar")

    def test_background_rejects_fake_observation_and_unknown_service(self):
        self.assertIsNone(clean_record({"service": "claude", "source": "codexBar", "observedAt": 1200}, 1000))
        self.assertIsNone(clean_record({"service": "colab", "source": "colabCli", "balance": 10}, 1000))
        self.assertIsNone(clean_record({"service": "unknown", "source": "manual"}, 1000))


if __name__ == "__main__":
    unittest.main()
