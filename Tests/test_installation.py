import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from install_statuslines import install


class InstallationTests(unittest.TestCase):
    def test_existing_statusline_is_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory); config = home / ".claude/settings.json"
            config.parent.mkdir()
            original = '{"statusLine":{"type":"command","command":"original"},"keep":true}\n'
            config.write_text(original)
            self.assertEqual(install("claude", home), "existing_statusline_preserved")
            self.assertEqual(config.read_text(), original)

    def test_preserves_unrelated_settings_and_private_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory); config = home / ".claude/settings.json"
            config.parent.mkdir(); config.write_text('{"keep":{"nested":true}}')
            self.assertEqual(install("claude", home), "installed")
            self.assertEqual(json.loads(config.read_text())["keep"], {"nested": True})
            backup = next(config.parent.glob("settings.aiusage-backup-*.json"))
            self.assertEqual(json.loads(backup.read_text()), {"keep": {"nested": True}})
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            self.assertEqual(install("claude", home), "already_installed")

    def test_stacks_antigravity_and_rejects_symlink_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.assertEqual(install("antigravity", home), "installed")
            config = home / ".gemini/antigravity-cli/settings.json"
            self.assertTrue(json.loads(config.read_text())["statusLine"]["stack_with_default"])
            claude = home / ".claude"; claude.mkdir()
            (claude / "settings.json").symlink_to(config)
            with self.assertRaises(ValueError):
                install("claude", home)


if __name__ == "__main__":
    unittest.main()
