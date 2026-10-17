# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through GitHub's [private vulnerability reporting](https://github.com/tamutamu0/no-token-left-behind/security/advisories/new) (Security tab → *Report a vulnerability*).

Include what you found, how to reproduce it, and the impact you expect. You'll get a reply within 7 days. Once a fix is ready, we'll agree on a disclosure date together.

## Scope

Reports are especially welcome about:

- data other than the allow-listed numbers reaching iCloud Drive or leaving the Mac
- a way for a collector to send anything beyond a usage read to a service
- validation bypasses in `sync_once.py`, `UsageModels.swift` or `AI Usage.js`
- problems with local signing, the keychain, or the TLS-PSK direct connection

Out of scope: weaknesses in the official CLIs, CodexBar, Scriptable or iCloud themselves (please report those upstream), and attacks that need a device that is already compromised.

## Design

The threat model and its known limits are documented in [Security and limitations](docs/en/security.md).

## Supported versions

Only the latest commit on `main` gets fixes.
