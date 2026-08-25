# Split+ — Expo / React Native build helpers.
#
# Goal: build a phone APK locally with ONE command, no Android Studio GUI.
# (Split+ is an Expo *managed* app, so the native android/ project is generated
#  on the fly with `expo prebuild` — you never have to check it into git.)
#
#   make setup      # one-time: install JDK 17 + Android SDK + NDK (Homebrew)
#   make android    # build a release APK -> outputs/split-plus.apk
#   make install    # build + adb install onto a connected device
#   make dev        # start the Expo/Metro dev server
#   make run        # build a dev build + run on device/emulator
#   make clean      # clean android build artifacts
#   make doctor     # show detected toolchain
#
# The API the app talks to is baked in at build time. Point it at your backend:
#   make android API_BASE=https://split-plus.vercel.app/api
# (or add an EXPO_PUBLIC_API_BASE=... line to mobile/.env). Defaults to the
# deployed Vercel URL below.
#
# After `make android`, install outputs/split-plus.apk on your phone (or upload
# it to a GitHub release and download it there).

SHELL := /bin/bash

APP_NAME     := split-plus
OUT_DIR      := outputs
RELEASE_APK  := android/app/build/outputs/apk/release/app-release.apk

# --- Backend URL baked into the build --------------------------------------
# Falls back to an EXPO_PUBLIC_API_BASE line in .env, then to the deployment.
API_BASE ?= $(shell grep -E '^EXPO_PUBLIC_API_BASE=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
ifeq ($(strip $(API_BASE)),)
API_BASE := https://split-plus.vercel.app/api
endif
export EXPO_PUBLIC_API_BASE := $(API_BASE)

# --- Toolchain autodetection ------------------------------------------------
BREW_PREFIX  := $(shell brew --prefix 2>/dev/null)
# Reuse a Homebrew Android SDK if present. Override with ANDROID_HOME=... .
ANDROID_HOME ?= $(BREW_PREFIX)/share/android-commandlinetools
SDKMANAGER   := $(ANDROID_HOME)/cmdline-tools/latest/bin/sdkmanager

# Expo SDK 52 / React Native 0.76 targets these exact versions.
ANDROID_API        ?= 35
ANDROID_BUILDTOOLS ?= 35.0.0
NDK_VERSION        ?= 27.1.12297006

# React Native 0.76 needs JDK 17. Prefer a system/Homebrew JDK 17; fall back 21.
JAVA_HOME ?= $(shell /usr/libexec/java_home -v 17 2>/dev/null \
	|| echo $(BREW_PREFIX)/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home)
ifeq ($(wildcard $(JAVA_HOME)/bin/java),)
JAVA_HOME := $(shell /usr/libexec/java_home -v 21 2>/dev/null \
	|| echo $(BREW_PREFIX)/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home)
endif

export ANDROID_HOME
export ANDROID_SDK_ROOT := $(ANDROID_HOME)
export JAVA_HOME

.PHONY: help setup deps prebuild prebuild-clean android install run dev clean doctor guard-debug-keystore

help:
	@echo "Split+ (Expo / React Native) build targets:"
	@echo "  make setup          One-time: install JDK 17 + Android SDK + NDK (Homebrew)"
	@echo "  make deps           Install JS dependencies (npm install)"
	@echo "  make android        Build release APK -> $(OUT_DIR)/$(APP_NAME).apk"
	@echo "  make install        Build + adb install on a connected device"
	@echo "  make dev            Start the Expo/Metro dev server"
	@echo "  make run            Build a dev build and run on device/emulator"
	@echo "  make prebuild       (Re)generate the native android/ project"
	@echo "  make clean          Clean android build artifacts"
	@echo "  make doctor         Print detected JDK / Android SDK / NDK"
	@echo ""
	@echo "Backend URL:  make android API_BASE=https://split-plus.vercel.app/api"
	@echo "(or add EXPO_PUBLIC_API_BASE=... to mobile/.env). Current: $(EXPO_PUBLIC_API_BASE)"

doctor:
	@echo "Homebrew     : $(if $(BREW_PREFIX),$(BREW_PREFIX),NOT FOUND — see https://brew.sh)"
	@printf "JDK          : "; if [ -x "$(JAVA_HOME)/bin/java" ]; then "$(JAVA_HOME)/bin/java" -version 2>&1 | head -1; else echo "NOT FOUND — run 'make setup'"; fi
	@printf "Android SDK  : "; if [ -x "$(SDKMANAGER)" ]; then echo "$(ANDROID_HOME)"; else echo "NOT FOUND — run 'make setup'"; fi
	@printf "NDK $(NDK_VERSION): "; if [ -d "$(ANDROID_HOME)/ndk/$(NDK_VERSION)" ]; then echo "found"; else echo "MISSING — run 'make setup'"; fi
	@echo "API base     : $(EXPO_PUBLIC_API_BASE)"

setup:
	@command -v brew >/dev/null || { echo "Homebrew required: https://brew.sh"; exit 1; }
	brew install openjdk@17 || true
	brew install --cask android-commandlinetools || true
	@echo ">> Accepting Android SDK licenses..."
	@yes | "$(SDKMANAGER)" --licenses >/dev/null 2>&1 || true
	@echo ">> Installing SDK packages (platform-tools, android-$(ANDROID_API), build-tools $(ANDROID_BUILDTOOLS), ndk $(NDK_VERSION), cmake)..."
	"$(SDKMANAGER)" "platform-tools" "platforms;android-$(ANDROID_API)" "build-tools;$(ANDROID_BUILDTOOLS)" "ndk;$(NDK_VERSION)" "cmake;3.22.1"
	@echo ">> Toolchain ready. Now run:  make android"

deps:
	npm install

# Generate the native android/ project from app.json (idempotent: skips if it
# already exists so your build cache is kept). Use `make prebuild-clean` to force.
prebuild:
	@if [ ! -d android ]; then \
		echo ">> Generating native android/ project via expo prebuild…"; \
		npx expo prebuild -p android --no-install; \
	else \
		echo ">> android/ already exists (run 'make prebuild-clean' to regenerate)"; \
	fi

prebuild-clean:
	rm -rf android
	npx expo prebuild -p android --no-install

# Ensure the Android debug keystore exists so `assembleRelease` (which Expo signs
# with the debug key by default) can sign without Android Studio.
guard-debug-keystore:
	@KS="$$HOME/.android/debug.keystore"; \
	 if [ ! -f "$$KS" ]; then \
	   echo ">> Creating Android debug keystore at $$KS"; \
	   mkdir -p "$$HOME/.android"; \
	   "$(JAVA_HOME)/bin/keytool" -genkeypair -v -keystore "$$KS" \
	     -storepass android -keypass android -alias androiddebugkey \
	     -keyalg RSA -keysize 2048 -validity 10000 \
	     -dname "CN=Android Debug,O=Android,C=US"; \
	 fi

android: prebuild guard-debug-keystore
	@[ -x "$(JAVA_HOME)/bin/java" ] || { echo "JDK missing — run 'make setup'"; exit 1; }
	@[ -x "$(SDKMANAGER)" ] || { echo "Android SDK missing — run 'make setup'"; exit 1; }
	@echo "sdk.dir=$(ANDROID_HOME)" > android/local.properties
	@echo "==> Building release APK (API base: $(EXPO_PUBLIC_API_BASE))"
	@echo "    First build compiles native C++/Hermes; later builds are much faster."
	cd android && ./gradlew assembleRelease
	@mkdir -p $(OUT_DIR)
	@cp "$(RELEASE_APK)" "$(OUT_DIR)/$(APP_NAME).apk"
	@echo ""
	@echo "✅ Built $(OUT_DIR)/$(APP_NAME).apk"
	@ls -lh "$(OUT_DIR)/$(APP_NAME).apk"

install: android
	adb install -r "$(OUT_DIR)/$(APP_NAME).apk"

dev:
	npx expo start

run: prebuild
	npx expo run:android

clean:
	cd android 2>/dev/null && ./gradlew clean || true
	rm -rf $(OUT_DIR)
