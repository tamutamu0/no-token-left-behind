**English** · [日本語](../ja/development.md)

# Development

## Layout

| Path | Contents |
|---|---|
| `Scriptable/AI Usage.js` | The iPhone widget (Scriptable, no dependencies). Home and Lock Screen layouts, the string table, sync-file validation and cache |
| `Scripts/` | Mac collectors (Python 3, standard library only). `collect_providers.py` calls each CLI and `sync_once.py` validates and merges the results |
| `Scripts/usage_io.py` | Shared parsing, `find_cli`, and atomic writes |
| `Scripts/colab_history.py` / `colab_grants.py` / `colab_allocation.py` | Colab balance history, grant detection, confirmed total |
| `Scripts/doctor.py` | Read-only diagnostics (`make doctor`) |
| `Scripts/install_*.py` / `sign_local_app.py` | Login item, statusLine setup, local signing |
| `Mac/` | The Mac menu-bar app (SwiftUI): start and stop collection, export to iCloud, widget preview |
| `Mac/WidgetPreview.html` | A small shim that renders Scriptable primitives as HTML and SVG. Used by the preview, the tests and the screenshots |
| `Shared/` | Swift models and validation (`UsageModels.swift`), storage, direct connection |
| `iOS/`, `Widget/` | The native iPhone app and WidgetKit widget |
| `Resources/` | String Catalogs (`Localizable.xcstrings`, `InfoPlist.xcstrings`) |
| `Tests/` | Python (unittest), JavaScript (node:test) and Swift (XCTest) tests |
| `Tools/render-screenshots.cjs` | Renders the README images from demo data |
| `project.yml` | XcodeGen project definition |

## Tests

```bash
make test            # everything
make test-python     # python3 -m unittest discover -s Tests -p 'test_*.py'
make test-js         # node --test Tests/*.test.cjs
make test-swift      # swift test
```

- The JavaScript tests swap Scriptable's classes (`ListWidget`, `Color`, `Font`, `DrawContext`…) for small fakes and run `buildWidget`. They check the text shown, the number and width of bars, colors, Lock Screen rings and every language.
- `Tests/preview.test.cjs` checks that the Mac preview draws every size, in English and Japanese, with no network or file access.
- All tests use made-up data and never touch a real account.

CI (`.github/workflows/ci.yml`) runs the Python and JavaScript tests on Ubuntu, and `swift test` plus unsigned Mac and iOS builds on macOS.

## Build

```bash
make build           # the Mac app
make project         # regenerate AIUsage.xcodeproj after editing project.yml or adding files

# native app (simulator)
xcodebuild -project AIUsage.xcodeproj -scheme AIUsage -sdk iphonesimulator -derivedDataPath build CODE_SIGN_IDENTITY=- build
```

`Scripts/` is bundled into the app as resources, but the Xcode project is generated. **After adding a file to `Scripts/`, run `make project`.** Otherwise the new file is missing from the app and collection fails.

## Previewing the widget

- **Mac app:** the **Widget** pane switches between small, medium and large, and between auto, light and dark. **Sample data** switches to made-up numbers. It runs the drawing functions from the bundled `AI Usage.js`.
- **iPhone:** put `demo` in the widget's Parameter.
- **Screenshots:** `make screenshots` writes `docs/images/<lang>/{light,dark,lock,anatomy}.png` for every language with headless Chrome (`CHROME=/path/to/chrome` to override).

The preview only approximates Scriptable, so text widths differ a little on a device. Scriptable shrinks text that doesn't fit according to `minimumScaleFactor`, so the device is usually less cramped.

## Layout principles

- Widths are fixed to fit the smallest iPhone widgets (small 155, medium 329×155, large 329×345). Flexible spacers soak up extra width on bigger phones.
- Windows that refill over time (Claude, Codex, Antigravity) are rows. The balance (Colab) sits under a divider.
- A window the plan doesn't have draws nothing, not even "—". Only a window that failed to load shows "—".
- The Lock Screen is drawn in white at different opacities, because iOS tints it.

## Adding a language

1. **Widget:** add a block to `I18N` in `Scriptable/AI Usage.js` with every key that `en` has, and add the language code to `resolveLanguage`. The tests fail if a key is missing.
2. **Apps:** open `Resources/Localizable.xcstrings` and `InfoPlist.xcstrings` in Xcode, add the language and translate every string. Run `make project` so the new region is picked up.
3. **Screenshots:** add callout text to `CALLOUTS` in `Tools/render-screenshots.cjs` and the code to `languages`, then run `make screenshots`.
4. **README:** copy `README.md` to `README.<code>.md`, translate it, and add it to the language bar of every README.

## Adding a service

1. Add a collector to `Scripts/collect_providers.py` that returns only allow-listed fields.
2. Update `IDS` / `SOURCES` and validation in `Scripts/sync_once.py`, and `ServiceID` / `UsageSource` in `Shared/UsageModels.swift`.
3. Add it to `SERVICE_IDS` / `SOURCES`, validation and drawing in `Scriptable/AI Usage.js`.
4. Add a check to `Scripts/doctor.py`.
5. Add tests and run `make project`.

Thanks to lenient decoding, a widget that doesn't know the new service yet simply skips it.

## Native app

A SwiftUI iPhone app (`iOS/`) and a WidgetKit widget (`Widget/`) for iOS 17 and later. They connect straight to the Mac app over TLS-PSK.

1. In `project.yml`, set the bundle IDs, `APP_GROUP` and `KEYCHAIN_GROUP` to values your team can use, then run `make project`.
2. In Xcode's Signing & Capabilities, give the app and the widget the same App Group and Keychain Sharing. Which capabilities you can use depends on your Apple Developer membership.
3. Put the Mac and iPhone on the same private network (for example Tailscale).
4. In the Mac app, enter the Mac's private IPv4, click **Start connection**, then **Save connection file**.
5. AirDrop the connection file to the iPhone and load it from **Connect to Mac** in the iOS app. Delete the file afterwards.

The Mac listens only on TCP 49731 on the private IP you entered. No port forwarding or public server is needed.
