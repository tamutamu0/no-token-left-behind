#!/usr/bin/env python3
"""Read-only provider adapters. Only validated quota fields reach stdout."""
import concurrent.futures
from datetime import datetime
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time

from collect_codex import collect as collect_codex
from usage_io import number, record
from colab_history import append_observation, observation
from colab_allocation import attach_allocation
from colab_grants import attach_last_grant


class ClaudeSetupRequired(Exception):
    """The CLI's first-run UI must be completed by its owner, never automated."""


def claude_setup_complete(config=None):
    # This is a readiness flag, not a credential. Never retain or expose the other keys.
    root = Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude")))
    config = Path(config) if config is not None else root.parent / (root.name + ".json")
    try:
        if config.stat().st_size > 524288:
            return False
        value = json.loads(config.read_text())
        return isinstance(value, dict) and value.get("hasCompletedOnboarding") is True
    except (OSError, ValueError):
        return False


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp() if parsed.tzinfo is not None else None
    except ValueError:
        return None


def codexbar_record(payload, provider, now=None):
    """Do not equate Antigravity's Gemini/Claude families with time windows."""
    now = time.time() if now is None else now
    entries = payload if isinstance(payload, list) else [payload]
    entries = [p for p in entries if isinstance(p, dict) and p.get("provider") == provider and not p.get("error")]
    # Multiple accounts require an explicit selection, never silently combine them.
    if len(entries) != 1 or provider not in ("claude", "antigravity"):
        return None
    usage = entries[0].get("usage")
    if not isinstance(usage, dict):
        return None
    observed = timestamp(usage.get("updatedAt"))
    if observed is None or observed > now + 60:
        return None
    candidates = []
    for name in ("primary", "secondary"):
        win = usage.get(name)
        if isinstance(win, dict):
            candidates.append((name, win))
    extra = usage.get("extraRateWindows")
    if isinstance(extra, list):
        for item in extra:
            if isinstance(item, dict) and item.get("usageKnown") is not False and isinstance(item.get("window"), dict):
                candidates.append((str(item.get("id", "")) + " " + str(item.get("title", "")), item["window"]))
    windows = {}
    for label, win in candidates:
        used = number(win.get("usedPercent"))
        if used is None or win.get("usageKnown") is False:
            continue
        duration = win.get("windowMinutes")
        if isinstance(duration, bool) or duration not in (300, 10080):
            continue
        if provider == "antigravity":
            # Primary is the Gemini family. Secondary is Claude/GPT, NOT weekly.
            if label == "secondary" or label != "primary" and "gemini" not in label.lower():
                continue
        q = {"usedPercent": used, "resetsAt": timestamp(win.get("resetsAt"))}
        previous = windows.get(duration)
        if previous is None or used > previous["usedPercent"]:
            windows[duration] = q
    if not windows:
        return None
    allowed_sources = ("claude", "cli") if provider == "claude" else ("cli",)
    if entries[0].get("source") not in allowed_sources:
        return None
    result = record(provider, "claudeCli" if provider == "claude" else "codexBar", windows.get(300), windows.get(10080))
    result["observedAt"] = observed
    return result


def colab_record(text, now=None):
    """Parse only the official CLI's explicitly labeled balance line."""
    matches = re.findall(r"^Current balance: ([0-9]+(?:\.[0-9]+)?) compute units$", text, re.MULTILINE)
    if len(matches) != 1:
        return None
    balance = number(float(matches[0]), 1e9)
    if balance is None:
        return None
    result = record("colab", "colabCli")
    result.update(balance=balance, observedAt=time.time() if now is None else now)
    return result


def credits_record(payload, now=None):
    """Only the official CLI's structured, zero-turn /credits report is accepted."""
    if not isinstance(payload, dict) or payload.get("status") != "SUCCESS":
        return None
    turns = payload.get("num_turns")
    if type(turns) is not int or turns != 0:
        return None
    usage = payload.get("usage")
    if not isinstance(usage, dict) or any(
        type(usage.get(k)) not in (int, float) or usage[k] != 0
        for k in ("input_tokens", "output_tokens", "thinking_tokens", "cache_read_tokens", "total_tokens")
    ):
        return None
    command = payload.get("command")
    if not isinstance(command, dict) or command.get("name") != "credits":
        return None
    data = command.get("data")
    if not isinstance(data, dict):
        return None
    balance = number(data.get("remaining_credits"), 1e9)
    if balance is None:
        return None
    result = record("googleCredits", "antigravityCli")
    result.update(balance=balance, observedAt=time.time() if now is None else now)
    return result


def run_bounded(command, seconds=40, env=None, cwd=None):
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, start_new_session=True,
                             cwd=str(cwd or Path.home()), env=env)
    try:
        data, _ = child.communicate(timeout=seconds)
        if len(data) > 131072:
            raise ValueError("oversized response")
        return child.returncode, data.decode("utf-8")
    finally:
        # Kill only the process group created for this particular probe.
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=2)


def collect_provider(provider):
    if provider not in ("codex", "claude", "antigravity", "colab"):
        return None
    if provider == "codex":
        result = collect_codex()
        return result if result["observedAt"] is not None else None
    if provider == "colab":
        cli = Path.home() / "Library/Application Support/AIUsage/ColabRuntime/bin/colab"
        # A scheduled check must never initiate consent or echo an OAuth URL.
        token = Path.home() / ".config/colab-cli/token.json"
        if not cli.is_file() or not token.is_file():
            return None
        code, output = run_bounded([str(cli), "--auth", "oauth2", "usage"], seconds=25)
        result = colab_record(output) if code == 0 else None
        if result is not None:
            sample = observation(output, result["observedAt"])
            if sample is not None:
                try:
                    append_observation(sample)
                except (OSError, ValueError):
                    # History trouble must not discard a valid official balance.
                    pass
            try:
                result = attach_allocation(result)
            except (OSError, ValueError):
                pass
            try:
                result = attach_last_grant(result)
            except (OSError, ValueError):
                pass
        return result
    if provider in ("claude", "antigravity"):
        # CLI access only. Browser consent never enables a quota source here.
        options = Path.home() / "Library/Application Support/AIUsage/collector-options.json"
        key = "claudeCLI" if provider == "claude" else "antigravityCLI"
        try:
            if options.stat().st_size > 4096 or json.loads(options.read_text()).get(key) is not True:
                return None
        except (OSError, ValueError, AttributeError):
            return None
        if provider == "claude" and not claude_setup_complete():
            # Auth status can be logged in while /usage is blocked by onboarding.
            # Do not repeatedly send commands into theme/login/consent screens.
            raise ClaudeSetupRequired()
    cli = "/opt/homebrew/bin/codexbar"
    if not Path(cli).is_file():
        return None
    environment = os.environ.copy()
    agy = Path.home() / ".local/bin/agy"
    if provider == "antigravity" and agy.is_file():
        environment["ANTIGRAVITY_CLI_PATH"] = str(agy)
    # An isolated config also blocks optional Web enrichment, cached cookies and Auto fallback.
    with tempfile.TemporaryDirectory(prefix="usage-cli-") as folder:
        config = Path(folder) / "config.json"
        config.write_text(json.dumps({"version": 1, "providers": [
            {"id": "claude", "enabled": True, "source": "cli", "cookieSource": "off", "extrasEnabled": False},
            {"id": "antigravity", "enabled": True, "source": "cli", "extrasEnabled": False}]}))
        os.chmod(config, 0o600)
        environment["CODEXBAR_CONFIG"] = str(config)
        environment["CLAUDE_CLI_PATH"] = "/opt/homebrew/bin/claude"
        code, output = run_bounded([cli, "usage", "--provider", provider, "--source", "cli", "--no-credits",
                                    "--format", "json", "--json-only"], seconds=40, env=environment)
    return codexbar_record(json.loads(output), provider) if code == 0 else None


def collect_all():
    records, status = [], {}
    providers = ("codex", "claude", "antigravity", "colab")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {p: pool.submit(collect_provider, p) for p in providers}
        for provider, future in futures.items():
            try:
                result = future.result()
                if result:
                    records.append(result)
                status[provider] = "ok" if result else "sign_in_or_source_required"
            except ClaudeSetupRequired:
                status[provider] = "initial_setup_required"
            except Exception:
                status[provider] = "unavailable"
    return {"records": records, "status": status}


if __name__ == "__main__":
    print(json.dumps(collect_all(), allow_nan=False))
