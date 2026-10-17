#!/usr/bin/env python3
"""Read-only RPC via the user's official Codex CLI. No auth-file reads."""
import json
import os
import selectors
import subprocess
import sys
import time
from usage_io import codex_record, find_cli

ALLOWED = {"initialize", "initialized", "account/rateLimits/read"}


def collect():
    cli = find_cli("codex")
    if not cli:
        raise RuntimeError("cli unavailable")
    child = subprocess.Popen([cli, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, cwd=os.path.expanduser("~"), start_new_session=True)
    selector = selectors.DefaultSelector()
    try:
        selector.register(child.stdout, selectors.EVENT_READ)
        pending = bytearray()
        deadline = time.monotonic() + 15

        def send(method, identifier=None, params=None):
            if method not in ALLOWED:
                raise RuntimeError("unsupported method")
            request = {"method": method}
            if identifier is not None:
                request["id"] = identifier
            if params is not None:
                request["params"] = params
            child.stdin.write((json.dumps(request) + "\n").encode())
            child.stdin.flush()

        def response(identifier):
            nonlocal pending
            while time.monotonic() < deadline:
                while b"\n" in pending:
                    line, _, pending = pending.partition(b"\n")
                    if not line:
                        continue
                    message = json.loads(line)
                    if message.get("id") == identifier:
                        if "error" in message:
                            raise RuntimeError("rpc unavailable")
                        return message["result"]
                if not selector.select(max(0, deadline - time.monotonic())):
                    continue
                chunk = os.read(child.stdout.fileno(), 65536)
                if not chunk:
                    raise RuntimeError("rpc closed")
                pending.extend(chunk)
                if len(pending) > 262144:
                    raise RuntimeError("oversized rpc")
            raise RuntimeError("rpc timeout")

        send("initialize", 1, {"clientInfo": {"name": "ai_usage_private_widget", "version": "0.1.0"}})
        response(1)
        send("initialized", params={})
        send("account/rateLimits/read", 2)
        return codex_record(response(2))
    finally:
        selector.close()
        child.terminate()
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=2)


if __name__ == "__main__":
    try:
        result = collect()
        print(json.dumps(result, allow_nan=False))
    except Exception:
        print("Can’t read Codex usage. Check that the official Codex CLI is signed in.", file=sys.stderr)
        sys.exit(1)
