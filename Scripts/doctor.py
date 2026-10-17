#!/usr/bin/env python3
"""Check every piece of the AI Usage setup and say how to fix what is missing.

Read-only: it looks for CLIs and files and reads the Mac app's own health record.
It never runs a sign-in, never reads credentials, and never contacts a service.

    python3 Scripts/doctor.py          # human-readable report
    python3 Scripts/doctor.py --json   # machine-readable, for bug reports
"""
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from usage_io import colab_cli, find_cli  # noqa: E402
from collect_providers import claude_setup_complete  # noqa: E402

OK, WARN, FAIL = "ok", "warn", "fail"
SYMBOL = {OK: "✓", WARN: "!", FAIL: "✗"}
STALE_AFTER = 15 * 60


def checks(home=None, env=None, now=None):
    home = Path(home or Path.home())
    env = dict(os.environ if env is None else env)
    env.setdefault("HOME", str(home))
    now = time.time() if now is None else now
    support = home / "Library/Application Support/AIUsage"
    cloud = home / "Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents"
    health = {}
    try:
        health = json.loads((support / "collector-health.json").read_text())
    except (OSError, ValueError):
        pass
    providers = health.get("providers") if isinstance(health.get("providers"), dict) else {}
    results = []

    def add(group, name, status, detail, fix=""):
        results.append({"group": group, "name": name, "status": status, "detail": detail, "fix": fix})

    def last_run(service):
        state = providers.get(service)
        if state is None:
            return WARN, "not collected yet", "Start collecting in the Mac app."
        if state == "ok":
            return OK, "last collection succeeded", ""
        return FAIL, f"last collection: {state}", ""

    # Python itself
    add("System", "Python", OK if sys.version_info >= (3, 9) else FAIL,
        sys.version.split()[0], "Install Python 3.9 or newer.")

    # Sources
    codex = find_cli("codex", env=env)
    if not codex:
        add("Codex", "Codex CLI", FAIL, "not found", "Install the official Codex CLI and run `codex login`.")
    else:
        status, detail, fix = last_run("codex")
        add("Codex", "Codex CLI", status, f"{codex} · {detail}", fix or "Run `codex login`, then refresh in the Mac app.")

    claude, codexbar = find_cli("claude", env=env), find_cli("codexbar", "CodexBarCLI", env=env)
    if not claude:
        add("Claude", "Claude Code CLI", FAIL, "not found", "Install Claude Code (https://code.claude.com).")
    elif not claude_setup_complete(Path(env.get("CLAUDE_CONFIG_DIR", str(home / ".claude"))).with_suffix(".json")):
        add("Claude", "Claude Code CLI", FAIL, f"{claude} · first-run setup not finished",
            "Run `claude` once and finish the theme and sign-in steps.")
    else:
        add("Claude", "Claude Code CLI", OK, claude)
    add("Claude", "CodexBar", OK if codexbar else FAIL, codexbar or "not found", "brew install --cask codexbar")
    if claude and codexbar:
        add("Claude", "Collection", *last_run("claude"))

    agy = find_cli("agy", env=env)
    add("Antigravity", "Antigravity CLI", OK if agy else FAIL, agy or "not found",
        "Install the official Antigravity CLI and sign in.")
    if agy and codexbar:
        add("Antigravity", "Collection", *last_run("antigravity"))

    colab = colab_cli(env=env)
    token = home / ".config/colab-cli/token.json"
    if not colab:
        add("Colab", "Colab CLI", FAIL, "not found",
            'python3 -m venv "$HOME/Library/Application Support/AIUsage/ColabRuntime" && '
            '"$HOME/Library/Application Support/AIUsage/ColabRuntime/bin/pip" install google-colab-cli')
    elif not token.is_file():
        add("Colab", "Colab CLI", FAIL, f"{colab} · not authorized", f'"{colab}" --auth oauth2 usage')
    else:
        add("Colab", "Colab CLI", OK, colab)
        add("Colab", "Collection", *last_run("colab"))

    # Mac app
    app = support / "AIUsageMac.app"
    agent = home / "Library/LaunchAgents/jp.local.aiusage.collector.plist"
    add("Mac app", "Installed", OK if app.is_dir() else WARN, str(app) if app.is_dir() else "not installed",
        "make install   (or: python3 Scripts/install_mac_startup.py)")
    add("Mac app", "Starts at login", OK if agent.is_file() else WARN, "login item registered" if agent.is_file() else "no login item",
        "make install")
    finished = health.get("refreshFinishedAt")
    if not isinstance(finished, (int, float)):
        add("Mac app", "Last collection", WARN, "never", "Open the Mac app and press “Start collecting”.")
    else:
        minutes = int((now - finished) / 60)
        add("Mac app", "Last collection", OK if now - finished <= STALE_AFTER else WARN, f"{minutes} min ago",
            "Is the Mac app running and collecting? Is the Mac awake?")

    # iCloud / Scriptable
    add("iPhone", "Scriptable folder", OK if cloud.is_dir() else FAIL,
        "iCloud Drive › Scriptable" if cloud.is_dir() else "not found",
        "Install Scriptable on the iPhone, open it once and wait for iCloud Drive to sync.")
    if cloud.is_dir():
        script = cloud / "AI Usage.js"
        add("iPhone", "Widget script", OK if script.is_file() else FAIL, "AI Usage.js" if script.is_file() else "missing",
            "make widget   (copies Scriptable/AI Usage.js to iCloud Drive › Scriptable)")
        snapshot = cloud / "ai-usage-snapshot-v2.json"
        if not snapshot.is_file():
            add("iPhone", "Usage file", FAIL, "not exported yet",
                "In the Mac app choose the Scriptable folder in iCloud Drive.")
        else:
            age = int((now - snapshot.stat().st_mtime) / 60)
            add("iPhone", "Usage file", OK if now - snapshot.stat().st_mtime <= STALE_AFTER else WARN,
                f"updated {age} min ago", "Check the Mac app’s iCloud export and that the Mac is awake.")
        if health.get("exportError") is True or health.get("requiresFolderSelection") is True:
            add("iPhone", "Export", FAIL, "the Mac app could not write to iCloud",
                "Choose the Scriptable folder again in the Mac app.")
        settings = cloud / "ai-usage-settings.json"
        add("iPhone", "Colab grant day", OK if settings.is_file() else WARN,
            "configured" if settings.is_file() else "not set (optional)",
            'echo \'{"colabGrantDay": 4}\' > ~/Library/Mobile\\ Documents/iCloud~dk~simonbs~Scriptable/Documents/ai-usage-settings.json')
    return results


def report(results, stream=sys.stdout):
    group = None
    for r in results:
        if r["group"] != group:
            group = r["group"]
            stream.write(f"\n{group}\n")
        stream.write(f"  {SYMBOL[r['status']]} {r['name']:<18} {r['detail']}\n")
        if r["status"] != OK and r["fix"]:
            stream.write(f"      → {r['fix']}\n")
    failed = sum(r["status"] == FAIL for r in results)
    warned = sum(r["status"] == WARN for r in results)
    stream.write(f"\n{len(results) - failed - warned} ok · {warned} warning(s) · {failed} problem(s)\n")
    return failed


def main(argv):
    results = checks()
    if "--json" in argv:
        json.dump(results, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0
    return 1 if report(results) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
