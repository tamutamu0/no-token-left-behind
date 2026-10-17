#!/usr/bin/env python3
"""Use as a Claude Code statusLine command. Never retain the full stdin."""
import json
import sys
from usage_io import claude_record, write_claude


def main():
    try:
        text = sys.stdin.read(131073)
        if len(text) > 131072:
            return
        result = claude_record(json.loads(text))
        if result is None:
            print("AI残量: 取得待ち")
            return
        write_claude(result)
        labels = []
        for name, key in (("5h", "fiveHour"), ("週", "weekly")):
            if result[key] is not None:
                labels.append(f"{name} 残り{100 - result[key]['usedPercent']:.0f}%")
        print("Claude · " + " / ".join(labels))
    except Exception:
        # Never echo payloads, filesystem paths, OAuth data or exception strings.
        print("AI残量: 取得待ち")


if __name__ == "__main__":
    main()
