#!/usr/bin/env python3
"""Keep this private Mac app's signing identity stable across local builds.

The dedicated keychain is never trusted as a system root, uploaded, or packaged.
It contains only this app's new signing key; no existing keychain items are read.
"""
import hashlib
import os
from pathlib import Path
import plistlib
import re
import secrets
import subprocess
import tempfile


IDENTIFIER = "jp.local.aiusage.mac"


def command(args, *, data=None, step="signing"):
    result = subprocess.run(args, input=data, capture_output=True, text=True, timeout=30)
    if result.returncode:
        # Passwords and key material must not reach errors or installation logs.
        raise RuntimeError(f"Local {step} failed (exit {result.returncode}).")
    return result.stdout


def security(commands):
    # Keep keychain passwords out of process arguments and shell history.
    command(["/usr/bin/security", "-i"], data="\n".join(commands) + "\n", step="keychain operation")


def quoted(value):
    value = str(value)
    if any(c in value for c in ("\n", "\r", "\0")):
        raise ValueError("invalid signing path")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def signing_identity():
    base = Path.home() / "Library/Application Support/AIUsage/Signing"
    if base.is_symlink() or base.parent.is_symlink():
        raise ValueError("invalid signing directory")
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(base, 0o700)
    keychain = base / "Usage.keychain-db"
    password_file = base / "keychain-password"
    certificate = base / "Usage.crt"
    fingerprint = base / "certificate-sha1"
    files = (keychain, password_file, certificate, fingerprint)
    if any(file.is_symlink() for file in files):
        raise ValueError("invalid signing file")
    existing = [file.exists() for file in files]
    if any(existing) and not all(existing):
        raise RuntimeError("Incomplete local signing identity; existing files preserved.")
    if not any(existing):
        password = secrets.token_hex(32)
        with password_file.open("x") as file:
            os.chmod(password_file, 0o600)
            file.write(password)
        # Preserve the user's keychain search list. The new keychain is addressed explicitly.
        search = command(["/usr/bin/security", "list-keychains", "-d", "user"])
        previous = re.findall(r'"([^"\n]+)"', search)
        try:
            security([f"create-keychain -p {password} {quoted(keychain)}",
                      f"set-keychain-settings -lut 3600 {quoted(keychain)}"])
        finally:
            command(["/usr/bin/security", "list-keychains", "-d", "user", "-s", *previous])
        with tempfile.TemporaryDirectory(prefix="usage-signing-", dir=base) as folder:
            folder = Path(folder)
            key = folder / "private-key.pem"
            config = folder / "certificate.cnf"
            bundle = folder / "identity.p12"
            config.write_text("""[req]
distinguished_name = subject
x509_extensions = signing
prompt = no
[subject]
CN = Usage Local Signing
[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
""")
            command(["/usr/bin/openssl", "req", "-new", "-newkey", "rsa:3072", "-nodes", "-x509",
                     "-sha256", "-days", "3650", "-config", str(config), "-keyout", str(key),
                     "-out", str(certificate)], step="certificate generation")
            key.chmod(0o600)
            command(["/usr/bin/openssl", "pkcs12", "-export", "-inkey", str(key), "-in", str(certificate),
                     "-out", str(bundle), "-passout", "stdin"], data=password + "\n", step="certificate import preparation")
            security([f"unlock-keychain -p {password} {quoted(keychain)}",
                      f"import {quoted(bundle)} -k {quoted(keychain)} -f pkcs12 -x -P {password} -T /usr/bin/codesign",
                      f"set-key-partition-list -S apple-tool: -s -k {password} {quoted(keychain)}"])
        der = subprocess.run(["/usr/bin/openssl", "x509", "-in", str(certificate), "-outform", "der"],
                             capture_output=True, check=True, timeout=10).stdout
        fingerprint.write_text(hashlib.sha1(der).hexdigest().upper())
        for file in files:
            os.chmod(file, 0o600)
    password = password_file.read_text().strip()
    digest = fingerprint.read_text().strip()
    if not re.fullmatch(r"[a-f0-9]{64}", password) or not re.fullmatch(r"[A-F0-9]{40}", digest):
        raise ValueError("invalid local signing metadata")
    security([f"unlock-keychain -p {password} {quoted(keychain)}"])
    return keychain, digest


def sign_app(app):
    app = Path(app)
    if app.is_symlink() or plistlib.loads((app / "Contents/Info.plist").read_bytes()).get("CFBundleIdentifier") != IDENTIFIER:
        raise ValueError("Only the Usage Mac app may be signed by this installer.")
    keychain, digest = signing_identity()
    # Pin both the app identifier and this exact signing certificate. Unlike a cdhash,
    # this remains valid across code changes, and another signer cannot impersonate it.
    requirement = f'designated => identifier "{IDENTIFIER}" and certificate leaf = H"{digest}"'
    previous = re.findall(r'"([^"\n]+)"', command(["/usr/bin/security", "list-keychains", "-d", "user"]))
    try:
        # SecIdentity also looks up the associated key using the search list even with
        # --keychain. Include only our chain temporarily, then restore that list.
        command(["/usr/bin/security", "list-keychains", "-d", "user", "-s", *previous, str(keychain)])
        command(["/usr/bin/codesign", "--force", "--sign", digest, "--keychain", str(keychain),
                 "--timestamp=none", "--requirements", "=" + requirement, str(app)])
    finally:
        command(["/usr/bin/security", "list-keychains", "-d", "user", "-s", *previous])
    command(["/usr/bin/codesign", "--verify", "--strict", str(app)], step="signature verification")
    return digest


if __name__ == "__main__":
    project = Path(__file__).resolve().parents[1]
    sign_app(project / "build-mac/Build/Products/Debug/AIUsageMac.app")
    print("Usage signed with its persistent local identity; system trust unchanged.")
