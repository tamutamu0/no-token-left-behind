import json
import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "Scripts"))
from usage_io import claude_record, codex_record, antigravity_record, number, write_claude


class CollectorTests(unittest.TestCase):
    def test_antigravity_uses_quota_instead_of_context_and_discards_email(self):
        raw = {"product": "antigravity", "email": "fixture@example.invalid", "context_window": {"remaining_percentage": 99},
               "quota": {"gemini-weekly": {"remaining_fraction": 0.9378, "reset_time": "2030-01-01T00:00:00Z"},
                         "gemini-5h": {"remaining_fraction": 0.72}, "3p-5h": {"remaining_fraction": 0.1}}}
        result = antigravity_record(raw)
        self.assertEqual(result["fiveHour"]["usedPercent"], 28)
        self.assertAlmostEqual(result["weekly"]["usedPercent"], 6.22)
        self.assertNotIn("fixture", json.dumps(result))
        self.assertIsNone(antigravity_record({"product": "antigravity", "context_window": {"remaining_percentage": 99}}))

    def test_claude_strips_prompt_account_and_tokens(self):
        raw = {"prompt": "private fixture", "access_token": "fixture-secret", "session_id": "fixture",
               "rate_limits": {"five_hour": {"used_percentage": 0, "resets_at": 2000000000},
                               "seven_day": {"used_percentage": 42, "resets_at": 2000600000}}}
        result = claude_record(raw)
        serialized = json.dumps(result)
        self.assertNotIn("fixture", serialized)
        self.assertEqual(result["fiveHour"]["usedPercent"], 0)
        self.assertEqual(result["weekly"]["usedPercent"], 42)

    def test_missing_quota_does_not_fabricate_zero_usage(self):
        self.assertIsNone(claude_record({"rate_limits": None}))
        self.assertIsNone(claude_record({"rate_limits": {"five_hour": {"used_percentage": None}}}))
        self.assertIsNone(codex_record({})["fiveHour"])

    def test_codex_uses_explicit_window_duration_and_codex_bucket(self):
        result = codex_record({"rateLimitsByLimitId": {"codex_other": {"primary": {"usedPercent": 99, "windowDurationMins": 300}},
            "codex": {"primary": {"usedPercent": 15, "windowDurationMins": 300, "resetsAt": 2000000000},
                      "secondary": {"usedPercent": 35, "windowDurationMins": 10080, "resetsAt": 2000500000}}}})
        self.assertEqual(result["fiveHour"]["usedPercent"], 15)
        self.assertEqual(result["weekly"]["usedPercent"], 35)
        short = codex_record({"rateLimits": {"primary": {"usedPercent": 15, "windowDurationMins": 15}}})
        self.assertIsNone(short["fiveHour"])
        self.assertIsNone(short["observedAt"])

    def test_rejects_nan_bool_strings_and_out_of_range(self):
        for invalid in [True, "50", float("nan"), float("inf"), -1, 101]:
            self.assertIsNone(number(invalid))

    def test_local_export_has_only_normalized_data_and_private_permissions(self):
        result = claude_record({"rate_limits": {"five_hour": {"used_percentage": 20}}})
        with tempfile.TemporaryDirectory() as directory:
            write_claude(result, directory)
            path = pathlib.Path(directory) / "claude.json"
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text())["service"], "claude")


if __name__ == "__main__":
    unittest.main()
