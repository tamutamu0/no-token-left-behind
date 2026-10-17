# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Ring style for Home Screen widgets, now the default: outer ring 5-hour, inner ring weekly, both percentages inside and reset times below, in colors that evoke each tool. The table style stays available with `table` in the Parameter or `"style": "table"` in `ai-usage-settings.json`. The Mac app preview can switch between them.
- New name: **No Token Left Behind** (formerly AI Usage Widget). Hero banner and social preview image for every language.
- English is now the default. The widget is available in English, Japanese, Simplified Chinese and Korean, following the iPhone's language or `lang=` in the Parameter. The Mac and iOS apps are available in English and Japanese through String Catalogs.
- `make doctor` (`Scripts/doctor.py`): read-only diagnostics with fix suggestions and `--json` output.
- A `Makefile` for build, install, widget deployment, tests and screenshots.
- CLI discovery that checks `$AIUSAGE_<NAME>_PATH`, `PATH`, then common install locations, so Intel Macs and non-Homebrew installs work.
- Colab grant learning: increases of 10 CU or more are recorded, and the observed day drives the "next grant" countdown, with a "Grant pending" state when Google is late.
- Lock Screen circular widgets automatically show the most constrained service, and draw rings for 5-hour (outer) and weekly (inner) usage.
- GitHub Actions CI covering Python, JavaScript, Swift and unsigned Mac and iOS builds.
- Multilingual README, setup, architecture, security and development docs.

### Changed
- Readers skip records for unknown services instead of rejecting the whole file, so older widgets keep working with newer Mac apps.

### Removed
- The experimental browser-based Google credits source.

## [0.1.0]

- First version: home-screen widgets for Claude, Codex, Antigravity and Colab, the Mac collector app, and the native app with a direct connection.
