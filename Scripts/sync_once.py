#!/usr/bin/python3
"""Per-user background collector. Export normalized quota only; never launch sign-in."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from collect_providers import collect_all
from usage_io import number

IDS = ("claude", "codex", "antigravity", "colab")
SOURCES = ("manual", "claudeStatusline", "claudeCli", "antigravityStatusline", "antigravityCli", "codexAppServer", "codexBar", "colabCli")


def clean_record(raw, now):
    if not isinstance(raw, dict) or raw.get("service") not in IDS or raw.get("source") not in SOURCES:
        return None
    observed = raw.get("observedAt")
    if observed is not None and number(observed, now + 60) is None:
        return None
    result = {"service": raw["service"], "source": raw["source"], "observedAt": observed,
              "balance": None, "fiveHour": None, "weekly": None}
    is_balance = raw["service"] == "colab"
    if is_balance:
        if raw.get("fiveHour") is not None or raw.get("weekly") is not None:
            return None
        balance = raw.get("balance")
        if balance is not None and number(balance, 1e9) is None:
            return None
        result["balance"] = balance
    else:
        if raw.get("balance") is not None:
            return None
        for name in ("fiveHour", "weekly"):
            win = raw.get(name)
            if win is None:
                continue
            if not isinstance(win, dict) or number(win.get("usedPercent")) is None:
                return None
            reset = win.get("resetsAt")
            if reset is not None and (number(reset, 1e12) is None or reset == 0):
                return None
            result[name] = {"usedPercent": win["usedPercent"], "resetsAt": reset}
    if observed is None and any(result[k] is not None for k in ("balance", "fiveHour", "weekly")):
        return None
    allocation = raw.get("balanceAllocation")
    if allocation is not None:
        if not isinstance(allocation, dict) or raw["service"] != "colab" or raw["source"] != "colabCli" \
            or allocation.get("basis") != "confirmedInitialGrant" or number(allocation.get("total"), 1e9) in (None, 0) \
            or result["balance"] is None or result["balance"] > allocation["total"]:
            return None
        result["balanceAllocation"] = {"total": allocation["total"], "basis": "confirmedInitialGrant"}
    credits = raw.get("resetCredits")
    if credits is not None:
        count = credits.get("count") if isinstance(credits, dict) else None
        expires = credits.get("nextExpiresAt") if isinstance(credits, dict) else None
        if raw["service"] != "codex" or raw["source"] != "codexAppServer" \
            or isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 99 \
            or (expires is not None and number(expires, now + 400 * 86400) in (None, 0)) \
            or (count == 0 and expires is not None) or observed is None:
            return None
        result["resetCredits"] = {"count": count, "nextExpiresAt": expires}
    grant = raw.get("lastGrantAt")
    if grant is not None:
        if raw["service"] != "colab" or raw["source"] != "colabCli" or number(grant, now + 60) in (None, 0):
            return None
        result["lastGrantAt"] = grant
    return result


def merge(rows, candidate, now):
    candidate = clean_record(candidate, now)
    if candidate is None:
        return
    old = rows.get(candidate["service"])
    if old is None or (candidate["observedAt"] or 0) >= (old["observedAt"] or 0):
        rows[candidate["service"]] = candidate


def read_json(path, maximum=16384):
    if path.is_symlink() or path.stat().st_size > maximum:
        raise ValueError("invalid file")
    return json.loads(path.read_bytes())


def write_json(path, data):
    if path.is_symlink():
        raise ValueError("invalid file")
    fd, tmp = tempfile.mkstemp(prefix=".usage-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(data, output, allow_nan=False)
            output.flush(); os.fsync(output.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def preference(key):
    p = subprocess.run(["/usr/bin/defaults", "read", "jp.local.aiusage.mac", key],
                       capture_output=True, text=True, timeout=5)
    return p.stdout.strip() if p.returncode == 0 else ""


def main():
    base = Path.home() / "Library/Application Support/AIUsage"
    if base.is_symlink():
        return
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (base / ".collector.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if preference("collectionEnabled") != "1":
            return
        now = time.time()
        health_path = base / "collector-health.json"
        try:
            health = read_json(health_path)
        except Exception:
            health = {}
        rows = {}
        try:
            previous = read_json(base / "snapshot.json")
            if previous.get("version") == 1 and previous.get("isDemo") is False:
                for row in previous.get("records", [])[:5]:
                    merge(rows, row, now)
        except Exception:
            pass
        for service in ("claude", "antigravity"):
            try:
                raw = read_json(base / (service + ".json"), 4096)
                if raw.get("service") == service and raw.get("source") in ("claudeStatusline", "antigravityStatusline"):
                    merge(rows, raw, now)
            except Exception:
                pass
        if now - health.get("backgroundPollStartedAt", 0) >= 600:
            health["backgroundPollStartedAt"] = now
            result = collect_all()
            for row in result["records"]:
                merge(rows, row, time.time())
            health.update(providers=result["status"], refreshFinishedAt=time.time())
        snapshot = {"version": 1, "isDemo": False, "generatedAt": time.time(), "records": list(rows.values())}
        write_json(base / "snapshot.json", snapshot)
        expected = Path.home() / "Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents"
        folder = preference("snapshotExportFolder")
        if folder == str(expected) and not expected.is_symlink():
            try:
                write_json(expected / "ai-usage-snapshot-v2.json", snapshot)
                health.update(exportedAt=time.time(), exportError=False)
            except OSError as error:
                health.update(exportError=True, exportErrorCode=error.errno)
        health["backgroundRunAt"] = time.time()
        write_json(health_path, health)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Provider output and local account data never enter launchd logs.
        raise SystemExit(1)
