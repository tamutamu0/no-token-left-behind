import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from doctor import checks, report, OK, WARN, FAIL  # noqa: E402
from usage_io import find_cli  # noqa: E402

NOW = 1_900_000_000


def executable(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


class FindCliTests(unittest.TestCase):
    def test_override_then_path_then_common_locations(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            on_path = executable(home / "bin-a/codex")
            pinned = executable(home / "pinned/codex")
            env = {"PATH": str(on_path.parent), "HOME": str(home)}
            self.assertEqual(find_cli("codex", env=env), str(on_path))
            self.assertEqual(find_cli("codex", env=dict(env, AIUSAGE_CODEX_PATH=str(pinned))), str(pinned))
            # A wrong override is reported as missing rather than silently falling back.
            self.assertIsNone(find_cli("codex", env=dict(env, AIUSAGE_CODEX_PATH=str(home / "nope"))))
            # The Colab override wins over the dedicated venv.
            from usage_io import colab_cli
            executable(home / "Library/Application Support/AIUsage/ColabRuntime/bin/colab")
            mine = executable(home / "custom/colab")
            self.assertEqual(colab_cli(env=dict(env, AIUSAGE_COLAB_PATH=str(mine))), str(mine))
            self.assertTrue(colab_cli(env=env).endswith("ColabRuntime/bin/colab"))
            with patch("usage_io.SEARCH_DIRS", ()):
                self.assertIsNone(find_cli("definitely-not-installed-cli", env={"PATH": ""}))


class DoctorTests(unittest.TestCase):
    def setUp(self):
        # Only the fake home counts: the machine running the tests may have real CLIs installed.
        self.no_common_dirs = patch("usage_io.SEARCH_DIRS", ())
        self.no_common_dirs.start()
        self.folder = tempfile.TemporaryDirectory()
        self.home = Path(self.folder.name)
        self.env = {"PATH": str(self.home / "bin"), "HOME": str(self.home)}

    def tearDown(self):
        self.no_common_dirs.stop()
        self.folder.cleanup()

    def by_name(self, results):
        return {(r["group"], r["name"]): r for r in results}

    def test_empty_machine_explains_every_missing_piece(self):
        results = self.by_name(checks(self.home, self.env, NOW))
        self.assertEqual(results[("Colab", "Colab CLI")]["detail"], "not found")
        for key in [("Codex", "Codex CLI"), ("Claude", "Claude Code CLI"), ("Claude", "CodexBar"),
                    ("Antigravity", "Antigravity CLI"), ("Colab", "Colab CLI"), ("iPhone", "Scriptable folder")]:
            self.assertEqual(results[key]["status"], FAIL, key)
            self.assertTrue(results[key]["fix"], key)
        self.assertEqual(results[("Mac app", "Last collection")]["status"], WARN)

    def test_ready_machine_reports_last_collection_and_fresh_export(self):
        for name in ("codex", "claude", "codexbar", "agy"):
            executable(self.home / "bin" / name)
        executable(self.home / "Library/Application Support/AIUsage/ColabRuntime/bin/colab")
        (self.home / ".config/colab-cli").mkdir(parents=True)
        (self.home / ".config/colab-cli/token.json").write_text("{}")
        (self.home / ".claude.json").write_text(json.dumps({"hasCompletedOnboarding": True}))
        support = self.home / "Library/Application Support/AIUsage"
        (support / "collector-health.json").write_text(json.dumps({"refreshFinishedAt": NOW - 120,
            "providers": {"codex": "ok", "claude": "ok", "antigravity": "sign_in_or_source_required", "colab": "ok"}}))
        cloud = self.home / "Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents"
        cloud.mkdir(parents=True)
        (cloud / "AI Usage.js").write_text("")
        snapshot = cloud / "ai-usage-snapshot-v2.json"
        snapshot.write_text("{}")
        os.utime(snapshot, (NOW - 60, NOW - 60))
        results = self.by_name(checks(self.home, self.env, NOW))
        self.assertEqual(results[("Codex", "Codex CLI")]["status"], OK)
        self.assertEqual(results[("Claude", "Collection")]["status"], OK)
        self.assertEqual(results[("Antigravity", "Collection")]["status"], FAIL)
        self.assertIn("sign_in_or_source_required", results[("Antigravity", "Collection")]["detail"])
        self.assertEqual(results[("iPhone", "Usage file")]["status"], OK)
        self.assertEqual(results[("Mac app", "Last collection")]["detail"], "2 min ago")

    def test_unfinished_claude_onboarding_is_called_out(self):
        executable(self.home / "bin/claude")
        (self.home / ".claude.json").write_text(json.dumps({"hasCompletedOnboarding": False}))
        result = self.by_name(checks(self.home, self.env, NOW))[("Claude", "Claude Code CLI")]
        self.assertEqual(result["status"], FAIL)
        self.assertIn("first-run setup", result["detail"])

    def test_report_counts_problems(self):
        class Sink:
            text = ""
            def write(self, s): self.text += s
        sink = Sink()
        failed = report(checks(self.home, self.env, NOW), sink)
        self.assertGreater(failed, 0)
        self.assertIn("problem(s)", sink.text)


if __name__ == "__main__":
    unittest.main()
