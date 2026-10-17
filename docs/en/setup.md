**English** · [日本語](../ja/setup.md)

# Setup guide

This guide covers every step: collect usage on the Mac, write it to iCloud Drive, and show it with Scriptable on the iPhone. For the big picture, see [How it works](how-it-works.md).

- [0. Before you start](#0-before-you-start)
- [1. Install the Mac app](#1-install-the-mac-app)
- [2. Connect your services](#2-connect-your-services)
- [3. Start collecting](#3-start-collecting)
- [4. Export to iCloud Drive](#4-export-to-icloud-drive)
- [5. Add the widgets](#5-add-the-widgets)
- [6. Colab grant day (optional)](#6-colab-grant-day-optional)
- [7. Check everything](#7-check-everything)
- [Updating](#updating) · [Uninstalling](#uninstalling) · [Troubleshooting](#troubleshooting)

## 0. Before you start

- A Mac and an iPhone signed in to the same Apple Account, with iCloud Drive turned on for both.
- Mac: macOS 14 or later and Xcode. You do not need a paid Apple Developer membership.
- iPhone: [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) (free). Lock Screen widgets need iOS 16 or later.
- The official CLI for each service you want to show, already signed in. You can skip any service you don't use.

## 1. Install the Mac app

```bash
git clone https://github.com/tamutamu0/ai-usage-widget.git
cd ai-usage-widget
make install
```

`make install` builds the app and then runs `Scripts/install_mac_startup.py`, which does three things:

- It creates a signing key that only this Mac uses, keeps it in a dedicated keychain, and signs the app with it. Because the app keeps the same identity, you don't have to choose the iCloud folder again after each update.
- It copies the app to `~/Library/Application Support/AIUsage/AIUsageMac.app` and the collector scripts to `Collector/` next to it.
- It registers `~/Library/LaunchAgents/jp.local.aiusage.collector.plist`, so the app starts when you log in.

It does not change system trust settings, Gatekeeper or sleep settings.

<details>
<summary>Without make</summary>

```bash
xcodebuild -project AIUsage.xcodeproj -scheme AIUsageMac -derivedDataPath build-mac CODE_SIGN_IDENTITY=- build
python3 Scripts/install_mac_startup.py
```

You can also open `AIUsage.xcodeproj` in Xcode and run the `AIUsageMac` scheme.
</details>

## 2. Connect your services

### Codex

Sign in to the official [Codex CLI](https://github.com/openai/codex) (`codex login`). That is all. The collector sends only the `initialize` handshake and `account/rateLimits/read`.

### Claude

1. Install the official [Claude Code](https://code.claude.com/) CLI. Launch it once to pick a theme and sign in. `/usage` does not answer until the first-run setup is finished.
2. Install [CodexBar](https://codexbar.app/). It launches the CLI and parses its output.

   ```bash
   brew install --cask codexbar
   ```

3. Also read usage from the official statusLine. If you already have a statusLine, the script leaves it alone, and it backs up your settings locally before any change.

   ```bash
   python3 Scripts/install_statuslines.py
   ```

<details>
<summary>Setting the statusLine by hand</summary>

Add this to your Claude Code settings, with the path changed to your clone:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/usr/bin/python3 \"/absolute/path/ai-usage-widget/Scripts/claude_statusline.py\""
  }
}
```
</details>

### Antigravity

1. Sign in to the official Antigravity CLI.
2. It uses CodexBar and the statusLine just like Claude. `install_statuslines.py` above sets up both.

The collector reads the Gemini model quota for 5 hours and for the week (`quota.gemini-5h`, `quota.gemini-weekly`). Context-window figures are not treated as usage.

### Google Colab

Install the official [google-colab-cli](https://github.com/googlecolab/google-colab-cli) in the location the app looks in first:

```bash
python3 -m venv "$HOME/Library/Application Support/AIUsage/ColabRuntime"
"$HOME/Library/Application Support/AIUsage/ColabRuntime/bin/pip" install google-colab-cli
"$HOME/Library/Application Support/AIUsage/ColabRuntime/bin/colab" --auth oauth2 usage
```

The last command runs the one-time OAuth consent. Read the permissions on the consent screen, and never paste the authorization code into a chat. After that, the collector only runs `usage`, which reads the balance. It never assigns VMs or runs code.

If the CLI is somewhere else, set `AIUSAGE_COLAB_PATH` (see [CLI locations](#cli-locations)).

### CLI locations

The collector looks for each CLI in this order:

1. `$AIUSAGE_<NAME>_PATH`
2. `PATH`
3. Common locations: `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/bin`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.volta/bin`, and the CodexBar app bundle

Login items do not read your shell profile. If a CLI lives somewhere unusual, pin it for launchd and restart the app:

```bash
launchctl setenv AIUSAGE_CLAUDE_PATH /path/to/claude   # names: CODEX, CLAUDE, CODEXBAR, AGY, COLAB
launchctl kickstart -k gui/$(id -u)/jp.local.aiusage.collector
```

## 3. Start collecting

Open the Mac app and click **Start collecting**. It checks all four services every 10 minutes, and **Refresh now** checks right away. A service that fails says what it is waiting for, such as a sign-in or its source.

You can also type values in by hand with **Enter Claude** (and the other **Enter…** buttons). Hand-entered values are labeled *Manual* in the widget.

## 4. Export to iCloud Drive

1. Open Scriptable on the iPhone once. After a moment, a `Scriptable` folder appears under **iCloud Drive** in the Mac's Finder.
2. Copy the widget script into it:

   ```bash
   make widget
   ```

   This is the same as copying [`Scriptable/AI Usage.js`](../../Scriptable/AI%20Usage.js) into that folder by hand.
3. In the Mac app, click **Choose Scriptable folder** and pick the `Scriptable` folder **inside iCloud Drive**. From then on, the app rewrites `ai-usage-snapshot-v2.json` there whenever the numbers change.

A local folder never reaches the iPhone. Don't choose a shared folder either.

## 5. Add the widgets

### Home Screen

1. Touch and hold an empty spot on the Home Screen, then tap **Edit** → **Add Widget**.
2. Choose **Scriptable** and add the small, medium or large size.
3. Touch and hold the new widget → **Edit Widget** → set **Script** to **AI Usage**. Leave **Parameter** empty.

### Lock Screen (iOS 16+)

1. Touch and hold the Lock Screen → **Customize** → **Lock Screen**.
2. Tap the line above the clock or the widget area below it, then add **Scriptable**.
3. Tap the new widget and set **Script** to **AI Usage**.

With an empty Parameter, the circular and inline widgets show whichever service has the least left. To pin one, enter `claude`, `codex`, `antigravity` or `colab`. For example, put three circular widgets side by side, each pinned to a different service.

### Mac desktop (optional)

On macOS 14 and later you can put iPhone widgets on the Mac desktop. Right-click the desktop → **Edit Widgets** → **Scriptable (From iPhone)**. **Use iPhone widgets** must be on in System Settings › Desktop & Dock.

### Widget language

The widget follows the iPhone's language (English, Japanese, Simplified Chinese or Korean) and falls back to English otherwise. To choose for one widget, add `lang=ja` (or `en`, `zh`, `ko`) to its Parameter.

## 6. Colab grant day (optional)

Create `ai-usage-settings.json` in iCloud Drive › Scriptable:

```json
{ "colabGrantDay": 4 }
```

On a Google AI plan, use the day of your **next payment** in Google One as a starting point. Once the Mac sees a real grant, that day takes priority. See [Colab grant detection](how-it-works.md#colab-grant-detection).

## 7. Check everything

```bash
make doctor
```

It checks each CLI and sign-in, the latest collection, whether the Mac app and its login item are installed, whether the widget script is in place, and how fresh the iCloud file is. Each problem comes with a `→` line that says how to fix it. `python3 Scripts/doctor.py --json` gives the same report as JSON. It exits with status 1 when something needs fixing.

## Updating

```bash
git pull
make install     # rebuild, re-sign and restart the app
make widget      # copy the new widget script
```

## Uninstalling

```bash
launchctl bootout gui/$(id -u)/jp.local.aiusage.collector
rm ~/Library/LaunchAgents/jp.local.aiusage.collector.plist
rm -rf ~/Library/Application\ Support/AIUsage
```

Then delete `AI Usage.js`, `ai-usage-snapshot-v2.json` and `ai-usage-settings.json` from iCloud Drive › Scriptable. Deleting `~/Library/Application Support/AIUsage` also removes the local signing keychain and the Colab venv.

## Troubleshooting

Start with `make doctor`. It usually names the exact problem.

| Symptom | What to check |
|---|---|
| The widget shows only "—" | Collection has started, the Scriptable folder is chosen, and iCloud Drive has finished syncing |
| Numbers are orange | Nothing new for 15+ minutes. Make sure the Mac is awake and online |
| One service shows "—" | You are signed in to that official CLI. For Claude, the first-run setup is finished |
| "Awaiting refresh" | The reset time has passed, but no new reading has arrived yet. The next collection clears it |
| Export stopped after updating the app | Run `make install` again. The first time, you may need to choose the Scriptable folder again |
| The widget doesn't change | iOS decides when widgets redraw. Tap the widget to open Scriptable and reload |
| The CLI is found in Terminal but not by the app | Login items don't read your shell profile. Use `launchctl setenv AIUSAGE_<NAME>_PATH …` |
| Colab says "Grant pending" | The expected day has passed without a grant being seen. Google sometimes grants late. It switches over once the balance jumps |
