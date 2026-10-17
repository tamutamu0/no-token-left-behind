import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from colab_grants import note_grant, attach_last_grant, GRANT_MIN  # noqa: E402
from colab_history import append_observation  # noqa: E402
from sync_once import clean_record  # noqa: E402

NOW = 1_900_000_000


def sample(t, balance):
    return {"observedAt": t, "balance": balance, "ratePerHour": 0.0, "activeRuntimes": 0}


class ColabGrantTests(unittest.TestCase):
    def test_rise_between_observations_is_recorded_and_attached(self):
        with tempfile.TemporaryDirectory() as folder:
            for t, balance in ((NOW - 1200, 50.0), (NOW - 600, 49.5), (NOW, 249.5)):
                append_observation(sample(t, balance), folder, now=NOW)
            events = json.loads((Path(folder) / "colab-grants.json").read_text())["events"]
            self.assertEqual(events, [{"observedAt": NOW, "previousObservedAt": NOW - 600, "before": 49.5, "after": 249.5}])
            record = attach_last_grant({"service": "colab", "source": "colabCli", "balance": 249.5}, folder, now=NOW)
            self.assertEqual(record["lastGrantAt"], NOW)

    def test_small_changes_and_decreases_are_not_grants(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertFalse(note_grant(sample(NOW - 600, 100.0), sample(NOW, 100.0 + GRANT_MIN - 0.01), folder, NOW))
            self.assertFalse(note_grant(sample(NOW - 600, 100.0), sample(NOW, 20.0), folder, NOW))
            self.assertFalse(note_grant(None, sample(NOW, 300.0), folder, NOW))
            self.assertFalse((Path(folder) / "colab-grants.json").exists())
            record = {"service": "colab", "source": "colabCli", "balance": 1.0}
            self.assertEqual(attach_last_grant(record, folder, now=NOW), record)

    def test_duplicates_are_ignored_and_other_services_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertTrue(note_grant(sample(NOW - 600, 0.0), sample(NOW, 200.0), folder, NOW))
            self.assertFalse(note_grant(sample(NOW - 600, 0.0), sample(NOW, 200.0), folder, NOW))
            other = {"service": "claude", "source": "claudeCli"}
            self.assertEqual(attach_last_grant(other, folder, now=NOW), other)

    def test_corrupt_grant_file_is_preserved_and_does_not_break_history(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "colab-grants.json"
            path.write_text("{broken")
            append_observation(sample(NOW - 600, 0.0), folder, now=NOW)
            self.assertTrue(append_observation(sample(NOW, 200.0), folder, now=NOW))
            self.assertEqual(path.read_text(), "{broken")
            with self.assertRaises(ValueError):
                attach_last_grant({"service": "colab", "source": "colabCli"}, folder, now=NOW)

    def test_sync_keeps_last_grant_only_for_official_colab(self):
        base = {"service": "colab", "source": "colabCli", "observedAt": NOW, "balance": 10.0}
        self.assertEqual(clean_record(dict(base, lastGrantAt=NOW - 60), NOW)["lastGrantAt"], NOW - 60)
        self.assertNotIn("lastGrantAt", clean_record(base, NOW))
        self.assertIsNone(clean_record(dict(base, lastGrantAt=NOW + 3600), NOW))
        self.assertIsNone(clean_record(dict(base, source="manual", lastGrantAt=NOW - 60), NOW))


if __name__ == "__main__":
    unittest.main()
