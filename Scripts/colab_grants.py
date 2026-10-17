"""Observed Colab grants: balance increases seen by the existing 10-minute check.

The official CLI has no grant ledger or schedule, and Google AI plan grants are
not guaranteed to land on the billing date. A rise of at least GRANT_MIN CU
between two consecutive observations is recorded as a grant event so the widget
can count down from what actually happened. Nothing here is labelled consumption.
"""
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time

from usage_io import number

GRANT_MIN = 10.0
MAX_EVENTS = 36
MAX_BYTES = 16_384


def _paths(directory):
    directory = Path(directory or Path.home() / "Library/Application Support/AIUsage")
    path, lock_path = directory / "colab-grants.json", directory / ".colab-grants.lock"
    if directory.is_symlink() or path.is_symlink() or lock_path.is_symlink():
        raise ValueError("invalid grant store")
    return directory, path, lock_path


def _read(path, now):
    if not path.exists():
        return []
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("oversized grant file preserved")
    data = json.loads(path.read_bytes())
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("events"), list):
        raise ValueError("invalid grant file preserved")
    events = []
    for raw in data["events"][-MAX_EVENTS:]:
        event = _valid(raw, now)
        if event is None or events and event["observedAt"] <= events[-1]["observedAt"]:
            raise ValueError("invalid grant file preserved")
        events.append(event)
    return events


def _valid(raw, now):
    if not isinstance(raw, dict):
        return None
    observed, previous = number(raw.get("observedAt"), now + 60), number(raw.get("previousObservedAt"), now + 60)
    before, after = number(raw.get("before"), 1e9), number(raw.get("after"), 1e9)
    if None in (observed, previous, before, after) or previous <= 0 or observed <= previous or after - before < GRANT_MIN:
        return None
    return {"observedAt": observed, "previousObservedAt": previous, "before": before, "after": after}


def note_grant(previous, sample, directory=None, now=None):
    """Record a grant if `sample` rose by GRANT_MIN or more since `previous`. Returns True if recorded."""
    now = time.time() if now is None else now
    if not previous or not sample:
        return False
    event = _valid({"observedAt": sample.get("observedAt"), "previousObservedAt": previous.get("observedAt"),
                    "before": previous.get("balance"), "after": sample.get("balance")}, now)
    if event is None:
        return False
    directory, path, lock_path = _paths(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(lock_path, os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        events = _read(path, now)
        if events and event["observedAt"] <= events[-1]["observedAt"]:
            return False
        events = (events + [event])[-MAX_EVENTS:]
        fd, temporary = tempfile.mkstemp(prefix=".colab-grants-", dir=directory)
        try:
            with os.fdopen(fd, "w") as output:
                json.dump({"version": 1, "events": events}, output, separators=(",", ":"), allow_nan=False)
                output.flush(); os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return True


def attach_last_grant(result, directory=None, now=None):
    """Add `lastGrantAt` (the first observation showing the latest grant) to a Colab CLI record."""
    if result.get("service") != "colab" or result.get("source") != "colabCli":
        return result
    now = time.time() if now is None else now
    _, path, _ = _paths(directory)
    events = _read(path, now)
    return dict(result, lastGrantAt=events[-1]["observedAt"]) if events else result
