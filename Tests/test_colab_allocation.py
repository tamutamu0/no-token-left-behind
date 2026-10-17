import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from colab_allocation import attach_allocation, MAX_CONFIRMATION_AGE
from sync_once import clean_record


class ColabAllocationTests(unittest.TestCase):
    def record(self, balance=185.5, observed=1600):
        return {"service": "colab", "source": "colabCli", "balance": balance, "observedAt": observed}

    def confirm(self, folder):
        path = Path(folder) / "colab-allocation.json"
        path.write_text(json.dumps({"version": 1, "basis": "confirmedInitialGrant", "total": 200,
                                   "confirmedAt": 1000, "lastObservedAt": 1000,
                                   "lastBalance": 185.5, "valid": True}))
        return path

    def test_plan_name_alone_does_not_create_an_allocation(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(attach_allocation(self.record(), folder), self.record())
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_confirmed_grant_is_attached_without_replacing_the_official_observation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.confirm(folder)
            result = attach_allocation(self.record(180.25), folder)
            self.assertEqual(result["balance"], 180.25)
            self.assertEqual(result["observedAt"], 1600)
            self.assertEqual(result["balanceAllocation"], {"total": 200, "basis": "confirmedInitialGrant"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_a_new_grant_closes_the_first_grant_basis_permanently(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.confirm(folder)
            self.assertNotIn("balanceAllocation", attach_allocation(self.record(190), folder))
            self.assertFalse(json.loads(path.read_text())["valid"])
            self.assertNotIn("balanceAllocation", attach_allocation(self.record(170, 2200), folder))

    def test_zero_possible_expiry_or_aged_confirmation_never_becomes_consumed_200(self):
        for balance, observed in ((0, 1600), (185.5, 1001 + MAX_CONFIRMATION_AGE), (201, 1600)):
            with tempfile.TemporaryDirectory() as folder:
                path = self.confirm(folder)
                self.assertNotIn("balanceAllocation", attach_allocation(self.record(balance, observed), folder))
                self.assertFalse(json.loads(path.read_text())["valid"])

    def test_older_wrong_source_or_corrupt_state_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.confirm(folder); original = path.read_bytes()
            self.assertNotIn("balanceAllocation", attach_allocation(self.record(observed=999), folder))
            wrong = self.record(); wrong["source"] = "manual"
            self.assertEqual(attach_allocation(wrong, folder), wrong)
            self.assertEqual(path.read_bytes(), original)
            path.write_text("broken")
            with self.assertRaises(ValueError):
                attach_allocation(self.record(), folder)
            self.assertEqual(path.read_text(), "broken")

    def test_changed_balance_after_a_long_gap_does_not_hide_a_missed_grant(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.confirm(folder)
            self.assertNotIn("balanceAllocation", attach_allocation(self.record(170, 3000), folder))
            self.assertFalse(json.loads(path.read_text())["valid"])

    def test_sync_preserves_only_the_validated_allocation_metadata(self):
        record = self.record(); record["balanceAllocation"] = {"total": 200, "basis": "confirmedInitialGrant", "token": "fixture-secret"}
        cleaned = clean_record(record, 1600)
        self.assertEqual(cleaned["balanceAllocation"], {"total": 200, "basis": "confirmedInitialGrant"})
        self.assertNotIn("fixture", json.dumps(cleaned))
        for total in (True, "200", 0, -1, 180, float("nan")):
            record["balanceAllocation"]["total"] = total
            self.assertIsNone(clean_record(record, 1600))


if __name__ == "__main__":
    unittest.main()
