**English** · [日本語](../ja/security.md)

# Security and limitations

This project lets you see your own account usage on your own devices. This page covers the design rules, what they protect, and what they don't.

To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## Credentials

- All queries go through the **official CLIs** you signed in to. Code in this project never reads, stores or passes on passwords, cookies or OAuth tokens.
- The Claude and Antigravity CLIs are launched through CodexBar, a third-party tool. It runs with a dedicated temporary config that pins the source to the CLI and turns off cookie import and extensions. Any answer whose source isn't the CLI is discarded.
- Only `initialize`, `initialized` and `account/rateLimits/read` are sent to the Codex app-server. No code path starts a thread, sends a message, buys anything or resets a limit.
- Colab runs only the official CLI's `usage`. The official CLI's one-time OAuth consent may ask for broader access than reading usage, so read the consent screen.

You are trusting the official CLIs and CodexBar from wherever you installed them.

## What goes to iCloud

The app writes a single file, `ai-usage-snapshot-v2.json`, to the iCloud Drive folder you choose. It contains only:

- fixed service IDs and source kinds
- used percent, reset times and balance
- observation times, the time a Colab grant was observed, and a confirmed total
- the number of banked Codex resets and the earliest expiry (no credit IDs or text)
- the schema version and whether the data is a demo

There are no account names, email addresses, conversations, raw CLI output or error messages. Any extra fields in the collected JSON are dropped when it is re-encoded into the validated model.

These numbers are stored in Apple's iCloud. If your Apple Account is compromised, someone could read your usage. Don't use a shared folder as the destination.

The file is not signed. Anyone who can write to that iCloud folder could plant false numbers.

## What stays on the Mac

`~/Library/Application Support/AIUsage/` (folder 0700, files 0600):

| File | Contents |
|---|---|
| `snapshot.json` | Latest collection (same fields as the sync file) |
| `colab-history.json` | Colab balance, burn rate, runtimes and times (90 days) |
| `colab-grants.json` | Observed Colab grants (times and balances before and after, latest 36) |
| `colab-allocation.json` | A Colab total you confirmed (optional) |
| `collector-health.json` | Collection times and outcomes, sync error codes |

None of these go to iCloud or Git. The repository's `.gitignore` also excludes real data, keys and connection files. Writes are atomic (write to a temporary file, then rename), and the Colab files refuse symbolic links.

## The Scriptable script

- It uses no networking APIs such as `Request`. It only reads the iCloud file.
- It checks the schema, service IDs, sources, value ranges, observation times and file size before using anything. Only allow-listed fields are cached in Scriptable's local storage.
- A broken file or a demo file never overwrites the cache of validated real data.

## `doctor.py`

The diagnostics are read-only. They look up CLIs, check sign-in files exist without reading them, read `collector-health.json` and the snapshot's age, and check that the app and its login item are installed. They don't call any service and print no secrets.

## Mac app signing

`Scripts/install_mac_startup.py` creates a signing key used only by this Mac, so the iCloud folder survives updates.

- The key lives in a dedicated keychain and can't be exported. Only `codesign` may use it.
- The designated requirement checks both the bundle ID and the certificate fingerprint, so an app signed by anyone else isn't treated as the same app.
- It doesn't change system trust settings, TCC or Gatekeeper. The keychain search list is restored after signing.
- The key never goes into Git or iCloud.

## The preview

The Mac app's widget preview runs in a non-persistent WebKit view that gets only the bundled drawing code and validated numbers. A Content Security Policy blocks network requests, images and frames, and navigation is refused.

## Native direct connection

- It uses TLS-PSK from Apple's Network.framework (TLS 1.2 / PSK-AES-128-GCM-SHA256) for encryption and mutual authentication. The 32-byte random key comes from CryptoKit. There is no plaintext fallback.
- The Mac listens only on the private IP you enter (10/8, 172.16/12, 192.168/16, or Tailscale's 100.64/10). Public IPs and host names are refused.
- PSK has no forward secrecy. If the key leaks, revoke it on the Mac and pair again.
- The connection file contains the key. Give it only to your own iPhone, and keep it out of Git, chats and shared drives.

## Limitations

- The Mac app launches official CLIs, so App Sandbox is off. Its access isn't limited by the OS. Safety rests on the implementation being small and open.
- There has been no third-party security audit.
- It can't protect you if the device itself is compromised or the app is modified.
