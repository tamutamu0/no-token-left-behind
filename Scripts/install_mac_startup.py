#!/usr/bin/env python3
"""Install this built app as a per-user login item; no privilege or sleep changes."""
import os
from pathlib import Path
import plistlib
import shutil
import time
import subprocess
from sign_local_app import sign_app


def install():
    project = Path(__file__).resolve().parents[1]
    built = project / "build-mac/Build/Products/Debug/AIUsageMac.app"
    sign_app(built)
    home = Path.home()
    directory = home / "Library/Application Support/AIUsage"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    app = directory / "AIUsageMac.app"
    if directory.is_symlink() or app.is_symlink():
        raise ValueError("invalid app destination")
    if app.exists():
        existing = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        if existing.get("CFBundleIdentifier") != "jp.local.aiusage.mac":
            raise ValueError("unrelated app preserved")
        app.rename(directory / f"AIUsageMac.previous-{time.time_ns()}.app")
    shutil.copytree(built, app, symlinks=True)
    collector = directory / "Collector"
    if collector.is_symlink():
        raise ValueError("invalid collector destination")
    collector.mkdir(exist_ok=True, mode=0o700)
    for filename in ("sync_once.py", "collect_providers.py", "collect_codex.py", "usage_io.py", "colab_history.py", "colab_allocation.py", "colab_grants.py"):
        target = collector / filename
        if target.is_symlink():
            raise ValueError("invalid collector file")
        shutil.copyfile(Path(__file__).parent / filename, target)
        os.chmod(target, 0o600)
    agents = home / "Library/LaunchAgents"
    agents.mkdir(parents=True, exist_ok=True)
    plist = agents / "jp.local.aiusage.collector.plist"
    if plist.is_symlink():
        raise ValueError("invalid login item")
    if plist.exists() and plistlib.loads(plist.read_bytes()).get("Label") != "jp.local.aiusage.collector":
        raise ValueError("unrelated login item preserved")
    payload = {"Label": "jp.local.aiusage.collector",
        "ProgramArguments": [str(app / "Contents/MacOS/AIUsageMac")],
        "RunAtLoad": True, "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 30, "ProcessType": "Background",
        "EnvironmentVariables": {"PATH": f"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:{home}/.local/bin"}}
    plist.write_bytes(plistlib.dumps(payload))
    os.chmod(plist, 0o600)
    subprocess.run(["/usr/bin/defaults", "write", "jp.local.aiusage.mac", "collectorMode", "-string", "native"], check=True)
    print("Installed Usage login item; collection still follows the app's Start/Stop preference.")


if __name__ == "__main__":
    install()
