from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Scripts"))
from sign_local_app import sign_app


class SigningTests(unittest.TestCase):
    def test_unrelated_apps_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "Other.app"
            (app / "Contents").mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": "other.app"}))
            with patch("sign_local_app.signing_identity") as identity:
                with self.assertRaises(ValueError):
                    sign_app(app)
                identity.assert_not_called()

    def test_failed_signing_restores_search_list_and_requirement_pins_the_certificate(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "Usage.app"
            (app / "Contents").mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": "jp.local.aiusage.mac"}))
            calls = []
            def command(args, **kwargs):
                calls.append(args)
                if args[0] == "/usr/bin/codesign":
                    self.assertIn('=designated => identifier "jp.local.aiusage.mac" and certificate leaf = H"' + 'A' * 40 + '"', args)
                    raise RuntimeError("fixture failure")
                return '    "/fixture/login.keychain-db"\n'
            with patch("sign_local_app.signing_identity", return_value=(Path('/fixture/Usage.keychain-db'), 'A' * 40)), \
                 patch("sign_local_app.command", side_effect=command):
                with self.assertRaises(RuntimeError):
                    sign_app(app)
            self.assertEqual(calls[-1], ["/usr/bin/security", "list-keychains", "-d", "user", "-s", "/fixture/login.keychain-db"])


if __name__ == '__main__':
    unittest.main()
