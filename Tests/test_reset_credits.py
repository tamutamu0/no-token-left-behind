import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "Scripts"))
from usage_io import codex_record, reset_credits
from sync_once import clean_record

NOW = 1_900_000_000


def credit(status="available", expires=NOW + 86400, **extra):
    return {"id": "RateLimitResetCredit_fixture", "resetType": "codexRateLimits", "status": status,
            "grantedAt": NOW - 86400, "expiresAt": expires, "title": "Full reset",
            "description": "fixture description", **extra}


class ResetCreditTests(unittest.TestCase):
    def test_counts_usable_credits_and_keeps_only_the_earliest_expiry(self):
        raw = {"availableCount": 9, "credits": [credit(expires=NOW + 5 * 86400), credit(expires=NOW + 86400),
                                                credit(status="redeemed"), credit(expires=NOW - 1)]}
        self.assertEqual(reset_credits(raw, NOW), {"count": 2, "nextExpiresAt": NOW + 86400})

    def test_falls_back_to_the_count_and_rejects_nonsense(self):
        self.assertEqual(reset_credits({"availableCount": 3}, NOW), {"count": 3, "nextExpiresAt": None})
        self.assertEqual(reset_credits({"credits": []}, NOW), {"count": 0, "nextExpiresAt": None})
        for raw in (None, [], {"availableCount": -1}, {"availableCount": True}, {"availableCount": "2"}):
            self.assertIsNone(reset_credits(raw, NOW))

    def test_codex_record_carries_counts_but_never_ids_or_text(self):
        raw = {"rateLimitsByLimitId": {"codex": {"secondary": {"usedPercent": 10, "windowDurationMins": 10080,
                                                               "resetsAt": NOW + 3600}}},
               "rateLimitResetCredits": {"availableCount": 1, "credits": [credit(expires=4_000_000_000)]}}
        result = codex_record(raw)
        self.assertEqual(result["resetCredits"]["count"], 1)
        self.assertNotIn("fixture", repr(result))
        self.assertNotIn("RateLimitResetCredit", repr(result))

    def test_sync_accepts_credits_only_on_the_official_codex_record(self):
        base = {"service": "codex", "source": "codexAppServer", "observedAt": NOW,
                "weekly": {"usedPercent": 10, "resetsAt": NOW + 60}}
        ok = clean_record({**base, "resetCredits": {"count": 2, "nextExpiresAt": NOW + 86400, "id": "x"}}, NOW)
        self.assertEqual(ok["resetCredits"], {"count": 2, "nextExpiresAt": NOW + 86400})
        for bad in ({**base, "service": "claude", "source": "claudeCli"}, {**base, "source": "manual"},
                    {**base, "observedAt": None, "weekly": None}):
            self.assertIsNone(clean_record({**bad, "resetCredits": {"count": 1, "nextExpiresAt": None}}, NOW))
        for credits in ({"count": -1}, {"count": 100}, {"count": True}, {"count": 0, "nextExpiresAt": NOW + 1},
                        {"count": 1, "nextExpiresAt": NOW + 500 * 86400}, "2"):
            self.assertIsNone(clean_record({**base, "resetCredits": credits}, NOW))


if __name__ == "__main__":
    unittest.main()
