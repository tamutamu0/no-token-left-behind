"""Only normalized quota numbers leave collectors. No credential handling."""
import json
import math
import os
import pathlib
import tempfile
import time
from datetime import datetime


def number(value, maximum=100):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or not 0 <= value <= maximum:
        return None
    return value


def window(raw, percent_key, reset_key):
    if not isinstance(raw, dict):
        return None
    used = number(raw.get(percent_key))
    if used is None:
        return None
    reset = number(raw.get(reset_key), 1e12)
    if reset == 0:
        reset = None
    return {"usedPercent": used, "resetsAt": reset}


def record(service, source, five_hour=None, weekly=None):
    return {"service": service, "source": source,
            "observedAt": time.time() if five_hour is not None or weekly is not None else None,
            "fiveHour": five_hour, "weekly": weekly, "balance": None}


def claude_record(raw):
    rate = raw.get("rate_limits") if isinstance(raw, dict) else None
    if not isinstance(rate, dict):
        return None
    result = record("claude", "claudeStatusline",
                    window(rate.get("five_hour"), "used_percentage", "resets_at"),
                    window(rate.get("seven_day"), "used_percentage", "resets_at"))
    return result if result["observedAt"] is not None else None


def codex_record(raw):
    buckets = raw.get("rateLimitsByLimitId")
    if isinstance(buckets, dict):
        bucket = buckets.get("codex")
    else:
        bucket = raw.get("rateLimits")
        if isinstance(bucket, dict) and bucket.get("limitId") not in (None, "codex"):
            bucket = None
    five_hour = weekly = None
    if isinstance(bucket, dict):
        for key in ("primary", "secondary"):
            entry = bucket.get(key)
            if not isinstance(entry, dict):
                continue
            quota = window(entry, "usedPercent", "resetsAt")
            duration = entry.get("windowDurationMins")
            # Never label a 15m, daily or unknown window as a 5h / weekly quota.
            if duration == 300:
                five_hour = quota
            elif duration == 10080:
                weekly = quota
    return record("codex", "codexAppServer", five_hour, weekly)


def antigravity_record(raw):
    if not isinstance(raw, dict) or raw.get("product") != "antigravity":
        return None
    quotas = raw.get("quota")
    if not isinstance(quotas, dict):
        return None

    def quota(key):
        value = quotas.get(key)
        if not isinstance(value, dict):
            return None
        fraction = number(value.get("remaining_fraction"), 1)
        if fraction is None:
            return None
        reset = None
        text = value.get("reset_time")
        if isinstance(text, str):
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
                if parsed.tzinfo is not None:
                    reset = parsed.timestamp()
            except ValueError:
                pass
        return {"usedPercent": round(100 * (1 - fraction), 6), "resetsAt": reset}

    # Only explicitly identified Gemini buckets; never combine third-party model quotas.
    result = record("antigravity", "antigravityStatusline", quota("gemini-5h"), quota("gemini-weekly"))
    return result if result["observedAt"] is not None else None


def write_record(result, directory=None):
    directory = pathlib.Path(directory or pathlib.Path.home() / "Library/Application Support/AIUsage")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink():
        raise ValueError("invalid store")
    os.chmod(directory, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=".claude-", dir=directory)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(result, output, allow_nan=False)
        filename = {"claude": "claude.json", "antigravity": "antigravity.json"}.get(result.get("service"))
        if filename is None:
            raise ValueError("unsupported service")
        os.replace(temporary, directory / filename)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


write_claude = write_record
