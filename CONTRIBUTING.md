# Contributing

Thanks for helping. Bug reports, translations, new services and documentation fixes are all welcome.

## Ground rules

- **Numbers only.** Nothing may leave the Mac except the allow-listed fields described in [How it works](docs/en/how-it-works.md#the-sync-file). No cookies, tokens, account names or raw CLI output, ever.
- **Official sources only.** Collectors talk to a service's official CLI and only read usage. No scraping, no browser automation, and nothing that starts a chat, runs a model, buys something or resets a limit.
- **Standard library only.** The Python collectors and the Scriptable widget have no dependencies. Please keep it that way.
- **Don't guess.** If a value can't be read reliably, show it as unavailable rather than inventing it.

## Getting started

```bash
git clone https://github.com/tamutamu0/no-token-left-behind.git
cd no-token-left-behind
make test          # Python + JavaScript + Swift
make build         # the Mac app
```

You need Xcode 16 or later, Python 3.9+ and Node 20+. [XcodeGen](https://github.com/yonaskolb/XcodeGen) is needed only if you change `project.yml` or add files (`make project`).

See [Development](docs/en/development.md) for the code layout, the preview shim and the layout rules.

## Making a change

1. Fork and create a branch.
2. Add or update tests next to your change:
   - Widget: `Tests/scriptable.test.cjs`
   - Collectors: `Tests/test_*.py`
   - Swift models: `Tests/UsageCoreTests.swift`
3. Run `make test`. If you changed how the widget looks, run `make screenshots` and include the images in your PR.
4. Use made-up data only. Never commit real usage numbers, account details or files from `~/Library/Application Support/AIUsage`.
5. Open a pull request using the template.

## Adding a language

The widget supports English, Japanese, Simplified Chinese and Korean, and the apps support English and Japanese. Steps for adding another language are in [Development › Adding a language](docs/en/development.md#adding-a-language). Partial translations of the README are welcome too.

## Adding a service

A service can be added once its official CLI reports usage. The checklist is in [Development › Adding a service](docs/en/development.md#adding-a-service).

## Reporting bugs

Please include the output of:

```bash
python3 Scripts/doctor.py --json
```

It has no secrets in it, but look it over before you paste it. Security issues go to [SECURITY.md](SECURITY.md), not to public issues.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
