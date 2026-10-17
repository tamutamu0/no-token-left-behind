#!/usr/bin/python3
"""Chrome Native Messaging: accept quota numbers only, never browser credentials."""
import json
import time
from usage_io import number, record


def normalize(raw, now=None):
    now = time.time() if now is None else now
    if not isinstance(raw, dict):
        return None
    balance = number(raw.get("balance"), 1e9)
    observed = number(raw.get("observedAt"), 1e12)
    if balance is None or observed is None or not now - 60 <= observed <= now + 60:
        return None
    result = record("googleCredits", "browserPage")
    result.update(balance=balance, observedAt=observed)
    return result


def main():
    # Browser bridge retired. Old extensions cannot save or forward quota observations.
    return


if __name__ == "__main__":
    main()
