#!/usr/bin/env python3
"""Consumes Google's documented statusLine stdin. Does not read credentials."""
import json
import sys
from usage_io import antigravity_record, write_record


def main():
    try:
        text = sys.stdin.read(131073)
        if len(text) > 131072:
            return
        result = antigravity_record(json.loads(text))
        if result is None:
            print("Antigravity · usage pending")
            return
        write_record(result)
        labels = []
        for label, key in (("5h", "fiveHour"), ("wk", "weekly")):
            if result[key] is not None:
                labels.append(f"{label} {100 - result[key]['usedPercent']:.0f}% left")
        print("Antigravity · " + " / ".join(labels))
    except Exception:
        print("Antigravity · usage pending")


if __name__ == "__main__":
    main()
