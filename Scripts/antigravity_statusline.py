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
            print("Antigravity · 残量取得待ち")
            return
        write_record(result)
        labels = []
        for label, key in (("5h", "fiveHour"), ("週", "weekly")):
            if result[key] is not None:
                labels.append(f"{label} 残り{100 - result[key]['usedPercent']:.0f}%")
        print("Antigravity · " + " / ".join(labels))
    except Exception:
        print("Antigravity · 残量取得待ち")


if __name__ == "__main__":
    main()
