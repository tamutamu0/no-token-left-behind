"""Local numerical observations, not an invented Colab consumption ledger.

Balance changes may include grants or expiration. No balance delta is labelled
as consumption, and no plan limit or subscription date is inferred here.
"""
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile
import time

from usage_io import number
from colab_grants import note_grant

MAX_POINTS = 14_400
MAX_BYTES = 2_097_152
RETENTION = 90 * 24 * 3600
FIELDS = ("observedAt", "balance", "ratePerHour", "activeRuntimes")


def observation(text, observed_at):
    patterns = {
        "balance": r"^Current balance: ([0-9]+(?:\.[0-9]+)?) compute units$",
        "ratePerHour": r"^Usage rate: ([0-9]+(?:\.[0-9]+)?)/hr$",
        "activeRuntimes": r"^Active assignments: ([0-9]+)$",
    }
    sample = {"observedAt": observed_at}
    for field, pattern in patterns.items():
        matches = re.findall(pattern, text, re.MULTILINE)
        if len(matches) != 1:
            return None
        sample[field] = int(matches[0]) if field == "activeRuntimes" else float(matches[0])
    return validate_sample(sample, observed_at)


def validate_sample(raw, now):
    if not isinstance(raw, dict) or number(raw.get("observedAt"), now + 60) is None:
        return None
    if raw["observedAt"] <= 0 or any(number(raw.get(k), 1e9) is None for k in ("balance", "ratePerHour")):
        return None
    count = raw.get("activeRuntimes")
    if type(count) is not int or not 0 <= count <= 10000:
        return None
    return {field: raw[field] for field in FIELDS}


def append_observation(sample, directory=None, now=None):
    now = time.time() if now is None else now
    sample = validate_sample(sample, now)
    if sample is None:
        raise ValueError("invalid observation")
    directory = Path(directory or Path.home() / "Library/Application Support/AIUsage")
    if directory.is_symlink():
        raise ValueError("invalid history store")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / "colab-history.json"
    lock_path = directory / ".colab-history.lock"
    if path.is_symlink() or lock_path.is_symlink():
        raise ValueError("invalid history file")
    # The GUI and headless collector may overlap during an app update.
    descriptor = os.open(lock_path, os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        points = []
        if path.exists():
            if path.stat().st_size > MAX_BYTES:
                raise ValueError("oversized history preserved")
            previous = json.loads(path.read_bytes())
            if not isinstance(previous, dict) or previous.get("version") != 1 or not isinstance(previous.get("observations"), list):
                raise ValueError("invalid history preserved")
            if len(previous["observations"]) > MAX_POINTS:
                raise ValueError("oversized history preserved")
            for raw in previous["observations"]:
                point = validate_sample(raw, now)
                if point is None or points and point["observedAt"] <= points[-1]["observedAt"]:
                    raise ValueError("invalid history preserved")
                points.append(point)
        if points and sample["observedAt"] <= points[-1]["observedAt"]:
            return False
        previous = points[-1] if points else None
        points.append(sample)
        points = [p for p in points if p["observedAt"] >= now - RETENTION][-MAX_POINTS:]
        payload = json.dumps({"version": 1, "observations": points}, separators=(",", ":"), allow_nan=False).encode()
        if len(payload) > MAX_BYTES:
            raise ValueError("oversized history preserved")
        fd, temporary = tempfile.mkstemp(prefix=".colab-history-", dir=directory)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(payload); output.flush(); os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        try:
            note_grant(previous, sample, directory, now)
        except (OSError, ValueError):
            # A grant-file problem must not undo a stored observation.
            pass
        return True
