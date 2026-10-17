import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from colab_history import observation, append_observation, RETENTION


class ColabHistoryTests(unittest.TestCase):
    def sample(self, now, balance=160.5):
        return {"observedAt": now, "balance": balance, "ratePerHour": 0, "activeRuntimes": 0}

    def test_only_explicit_unique_cli_numbers_are_recorded(self):
        output = "Current balance: 160.5 compute units\nUsage rate: 0.00/hr\nActive assignments: 0\nemail: fixture@example.invalid\ntoken: fixture-secret"
        self.assertEqual(observation(output, 1000), self.sample(1000))
        for bad in (output + "\nUsage rate: 5/hr", output.replace("Usage rate:", "Rate:"), output.replace("0.00/hr", "-1/hr"), output.replace("assignments: 0", "assignments: 0.5")):
            self.assertIsNone(observation(bad, 1000))

    def test_replayed_or_older_samples_do_not_double_count(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertTrue(append_observation(self.sample(1000), folder, now=1000))
            before = (Path(folder) / "colab-history.json").read_bytes()
            self.assertFalse(append_observation(self.sample(1000), folder, now=1001))
            self.assertFalse(append_observation(self.sample(999), folder, now=1001))
            self.assertEqual((Path(folder) / "colab-history.json").read_bytes(), before)

    def test_grants_and_expiration_are_kept_as_observations_not_consumption(self):
        with tempfile.TemporaryDirectory() as folder:
            for now, balance in ((1000, 160.5), (1600, 360.5), (2200, 200)):
                append_observation(self.sample(now, balance), folder, now=now)
            path = Path(folder) / "colab-history.json"
            data = json.loads(path.read_bytes())
            self.assertEqual([p["balance"] for p in data["observations"]], [160.5, 360.5, 200])
            self.assertNotIn("consumed", path.read_text())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_corruption_symlinks_future_and_secrets_do_not_destroy_history(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "colab-history.json"
            path.write_text("broken")
            with self.assertRaises(ValueError):
                append_observation(self.sample(1000), folder, now=1000)
            self.assertEqual(path.read_text(), "broken")
            path.unlink(); target = Path(folder) / "other"; target.write_text("preserved")
            path.symlink_to(target)
            with self.assertRaises(ValueError):
                append_observation(self.sample(1000), folder, now=1000)
            self.assertEqual(target.read_text(), "preserved")
            path.unlink()
            with self.assertRaises(ValueError):
                append_observation(self.sample(1061), folder, now=1000)
            raw = self.sample(1000); raw["token"] = "fixture-secret"
            append_observation(raw, folder, now=1000)
            self.assertNotIn("fixture", path.read_text())

    def test_retention_is_bounded_without_rewriting_the_observation_time(self):
        with tempfile.TemporaryDirectory() as folder:
            append_observation(self.sample(1000), folder, now=1000)
            now = 1001 + RETENTION
            append_observation(self.sample(now), folder, now=now)
            data = json.loads((Path(folder) / "colab-history.json").read_text())
            self.assertEqual(data["observations"], [self.sample(now)])


if __name__ == "__main__":
    unittest.main()
