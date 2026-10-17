# AI Usage — common tasks. Run `make help` for the list.
SCRIPTABLE := $(HOME)/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents
APP := build-mac/Build/Products/Debug/AIUsageMac.app

.PHONY: help build install widget doctor test test-python test-js test-swift project screenshots clean

help:            ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-12s %s\n", $$1, $$2}'

build:           ## Build the Mac app (no paid Apple Developer account needed)
	xcodebuild -project AIUsage.xcodeproj -scheme AIUsageMac -derivedDataPath build-mac CODE_SIGN_IDENTITY=- build -quiet

install: build   ## Build, sign locally and register the Mac app as a login item
	python3 Scripts/install_mac_startup.py
	-launchctl kickstart -k gui/$$(id -u)/jp.local.aiusage.collector

widget:          ## Copy the Scriptable widget script to iCloud Drive › Scriptable
	@test -d "$(SCRIPTABLE)" || { echo "iCloud Drive › Scriptable not found. Install Scriptable on your iPhone and open it once."; exit 1; }
	cp "Scriptable/AI Usage.js" "$(SCRIPTABLE)/AI Usage.js"
	@echo "Copied. On the iPhone, open Scriptable once so the widget picks up the new script."

doctor:          ## Check CLIs, sign-ins, the Mac app and the iCloud export
	@python3 Scripts/doctor.py

test: test-python test-js test-swift ## Run every test suite

test-python:
	python3 -m unittest discover -s Tests -p 'test_*.py'

test-js:
	node --test Tests/*.test.cjs

test-swift:
	swift test

project:         ## Regenerate AIUsage.xcodeproj from project.yml (needs XcodeGen)
	xcodegen generate

screenshots:     ## Re-render README screenshots from demo data (needs Google Chrome)
	node Tools/render-screenshots.cjs . docs/images

clean:           ## Remove build output
	rm -rf build build-mac .build
