"""Attach an owner's confirmed first grant to official Colab balances.

The CLI does not return a grant ledger. Never invent monthly resets or assume
that the plan's monthly allowance is the account's current total allocation.
"""
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time

from usage_io import number

MAX_CONFIRMATION_AGE = 30 * 86400


def attach_allocation(result, directory=None):
    if result.get("service") != "colab" or result.get("source") != "colabCli":
        return result
    directory = Path(directory or Path.home() / "Library/Application Support/AIUsage")
    path = directory / "colab-allocation.json"
    lock_path = directory / ".colab-allocation.lock"
    if directory.is_symlink() or path.is_symlink() or lock_path.is_symlink() or not path.exists():
        return result
    observed = number(result.get("observedAt"), time.time() + 60)
    balance = number(result.get("balance"), 1e9)
    if observed is None or balance is None:
        return result
    descriptor = os.open(lock_path, os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.stat().st_size > 4096:
            return result
        state = json.loads(path.read_bytes())
        if not isinstance(state, dict) or state.get("version") != 1 or state.get("basis") != "confirmedInitialGrant":
            return result
        total = number(state.get("total"), 1e9)
        confirmed = number(state.get("confirmedAt"), observed + 60)
        previous_time = number(state.get("lastObservedAt"), observed)
        previous_balance = number(state.get("lastBalance"), 1e9)
        if total is None or total <= 0 or confirmed is None or previous_time is None or previous_balance is None:
            return result
        if state.get("valid") is not True or observed < confirmed - 60:
            return result
        # A new grant, unexplained increase, possible expiration, or an aged
        # confirmation closes this first-grant calculation. Never reset to 200.
        gap_change = observed - previous_time > 900 and abs(balance - previous_balance) > 0.005
        valid = balance <= total and balance <= previous_balance + 0.005 and balance > 0 \
            and observed - confirmed <= MAX_CONFIRMATION_AGE and not gap_change
        next_state = {"version": 1, "basis": "confirmedInitialGrant", "total": total,
                      "confirmedAt": confirmed, "lastObservedAt": observed,
                      "lastBalance": balance, "valid": valid}
        fd, temporary = tempfile.mkstemp(prefix=".colab-allocation-", dir=directory)
        try:
            with os.fdopen(fd, "w") as output:
                json.dump(next_state, output, allow_nan=False)
                output.flush(); os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        if valid:
            return dict(result, balanceAllocation={"total": total, "basis": "confirmedInitialGrant"})
    return result
