#!/usr/bin/env python3
"""Install local quota-only statuslines while preserving unrelated settings."""
import json
import os
from pathlib import Path
import shlex
import shutil
import tempfile
import time


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".aiusage-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(service, home=None):
    home = Path(home or Path.home())
    if service not in ("claude", "antigravity"):
        raise ValueError("unsupported service")
    folder = home / "Library/Application Support/AIUsage/Collectors"
    config = home / (".claude/settings.json" if service == "claude" else ".gemini/antigravity-cli/settings.json")
    for path in [folder, config, *config.parents, *folder.parents]:
        if (path == home or home in path.parents) and path.is_symlink():
            raise ValueError("symlink configuration requires manual setup")
    settings = json.loads(config.read_text()) if config.exists() else {}
    if not isinstance(settings, dict):
        raise ValueError("invalid settings")
    script = folder / (service + "_statusline.py")
    command = "/usr/bin/python3 " + shlex.quote(str(script))
    existing = settings.get("statusLine")
    if existing is not None:
        if isinstance(existing, dict) and existing.get("command") == command:
            return "already_installed"
        return "existing_statusline_preserved"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    source = Path(__file__).resolve().parent
    for name in ["usage_io.py", service + "_statusline.py"]:
        destination = folder / name
        if destination.exists() and destination.read_bytes() != (source / name).read_bytes():
            raise ValueError("existing collector requires manual review")
        shutil.copyfile(source / name, destination)
        os.chmod(destination, 0o600)
    config.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if config.exists():
        backup = config.with_name("settings.aiusage-backup-" + str(time.time_ns()) + ".json")
        shutil.copyfile(config, backup)
        os.chmod(backup, 0o600)
    statusline = {"type": "command", "command": command}
    if service == "antigravity":
        statusline["stack_with_default"] = True
    settings["statusLine"] = statusline
    atomic_json(config, settings)
    return "installed"


if __name__ == "__main__":
    for service in ("claude", "antigravity"):
        try:
            print(service + ": " + install(service))
        except Exception:
            print(service + ": manual_setup_required")
