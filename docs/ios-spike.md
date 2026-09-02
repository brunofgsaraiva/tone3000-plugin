# iOS Standalone spike

Tracking issue: [tone-3000/tone3000-plugin#55](https://github.com/tone-3000/tone3000-plugin/issues/55)

Goal of the spike: get the TONE3000 Standalone target building and running as an
iOS app, first on the iPad Simulator and then on a physical iPad Pro 12.9.
AUv3 is explicitly out of scope. Nothing here changes macOS, Windows or Linux
behaviour: every change is either behind `#if JUCE_IOS` / `#if JUCE_MAC` in the
sources, or behind a `T3K_IOS` CMake variable that is only true when
`CMAKE_SYSTEM_NAME` is `iOS`.

Branch: `ios-spike` on the fork `brunofgsaraiva/tone3000-plugin`.

## Environment

| Item | Value |
| ---- | ----- |
| Xcode | `/Applications/Xcode.app` (`DEVELOPER_DIR` set on every command) |
| CMake | 4.3.4 |
| Node / npm | 26.3.0 / 11.16.0 |
| JUCE | 9.0.1 (fetched by CPM into `libs/juce`) |
| iOS deployment target | 16.0 |
| iOS bundle id | `com.bsaraiva.tone3000ios` |

## Milestones

### M0 Baseline: macOS Standalone

The spike cannot start from a red baseline, so the reference build was run
first, unchanged.

```sh
cd /Users/bruno.saraiva/Developer/tone3000-plugin-ios
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake -B build -S . -DCMAKE_BUILD_TYPE=Release
cd ui && npm install && npm approve-scripts esbuild fsevents && npm run build && cd ..
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake -B build -S . -DCMAKE_BUILD_TYPE=Release      # re-run so plugin/webview/ is picked up
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake --build build --target TONE3000_Standalone -j 8
```

Result: green. All 13 JUCE text patches applied, and the app links to
`build/plugin/TONE3000_artefacts/Release/Standalone/TONE3000.app`.

Notes:

- `ui/.env` holds `VITE_T3K_PUBLISHABLE_KEY` and is gitignored
  (`ui/.gitignore` line 16). For the spike it carries a placeholder value, so
  the UI boots but the TONE3000 catalogue login does not work. That is
  accepted for now; see Open items.
- npm 11 needs the esbuild postinstall approved explicitly
  (`npm approve-scripts esbuild fsevents`). That writes an `allowScripts` block
  into `ui/package.json`; it is a local machine concern and is not committed.

### M1 iOS configure

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake -B build-ios -G Xcode -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0
```

or, equivalently, `cmake --preset ios-simulator`.

Result: green. The Xcode project generates with a single `TONE3000_Standalone`
target and no VST3 / AU / AAX / LV2 / CLAP targets.

What had to change, and why:

- **Deployment target.** `CMAKE_OSX_DEPLOYMENT_TARGET` is shared between macOS
  and iOS, so the existing 10.15 default is meaningless on iOS. Both the root
  and the plugin CMakeLists now set `T3K_IOS` from `CMAKE_SYSTEM_NAME` before
  `project()` and floor the iOS build at 16.0 instead.
- **Plugin formats.** On iOS the format list starts empty and `BUILD_AAX`,
  `BUILD_LV2` and `BUILD_CLAP` are forced off, so only `Standalone` is added.
  AU is skipped too: JUCE's `AU` format is the desktop v2 wrapper.
- **NeuralAmpModelerCore.** The submodule's own CMakeLists hard-fails with
  `Unrecognized Platform!` on anything that is not Darwin, Linux or Windows.
  `add_subdirectory(NeuralAmpModelerCore)` is skipped on iOS. Nothing is lost:
  the `NAM` static library is already compiled here from `NAM_SRC` (explicitly,
  to keep the submodule pristine), the include paths and `NAM_ENABLE_A2_FAST`
  are set on the targets directly, and the only other thing the submodule
  contributes is its dev tools, which this build excludes anyway.
- **NAM whole-archive link.** The `-force_load` link flag was gated on
  `$<PLATFORM_ID:Darwin>`, and `PLATFORM_ID` is `iOS` when cross-compiling, so
  the iOS link would have dropped every self-registering model architecture and
  failed at model load with "No config parser registered". Changed to
  `$<PLATFORM_ID:Darwin,iOS>`.
- **Info.plist keys.** `BUNDLE_ID` (`com.bsaraiva.tone3000ios`, so it cannot
  collide with the desktop `com.TONE3000.TONE3000`),
  `BACKGROUND_AUDIO_ENABLED`, `FILE_SHARING_ENABLED`,
  `DOCUMENT_BROWSER_ENABLED`, `REQUIRES_FULL_SCREEN`, and landscape-only
  `IPAD_SCREEN_ORIENTATIONS` / `IPHONE_SCREEN_ORIENTATIONS`.
  `MICROPHONE_PERMISSION_ENABLED` and `BLUETOOTH_PERMISSION_ENABLED` were
  already `TRUE` in the shared block and are the same keys iOS wants, so they
  were left alone.
- **`PLIST_TO_MERGE`.** `LSMinimumSystemVersion` is a macOS Launch Services
  key, so it is not merged on iOS.
- **Kiosk mode.** `JUCE_STANDALONE_FILTER_WINDOW_USE_KIOSK_MODE=0` exists to
  get a native macOS title bar. iOS has no title bar and no resizable window,
  so the define is not applied there and JUCE's default (kiosk on) stands.
- **App icon.** iOS masks the icon itself, so it gets the full-bleed
  `icon/icon.png` rather than the macOS artwork with baked-in margins.
- **DSP test suite.** `add_subdirectory(test)` is skipped on iOS: it is a
  host-run console binary driven by `script/test-dsp.sh` that reads assets off
  the build machine's disk.

#### The JUCE text patches

The 13 configure-time text patches in the root CMakeLists edit files in
`libs/juce`, which is a single tree shared by the macOS and iOS build
directories. They are idempotent and applied once, so the two builds never
diverge. Each was reviewed for AppKit-only assumptions:

| Patch | File | Compiles on iOS? | Action |
| ----- | ---- | ---------------- | ------ |
| `T3K_WEBVIEW_NO_FLASH` | `juce_WebBrowserComponent_mac.mm` | yes (WKWebView is shared mac/iOS) | none: the patch body already ships inside a `#if JUCE_MAC` guard |
| `T3K_RT_START_STALE_HANDLE` | `juce_Threads_mac.mm` | yes | none: plain C++, no AppKit |
| `T3K_WEBKIT_SONAME` | `juce_WebBrowserComponent_linux.cpp` | not compiled | none |
| `T3K_WEBKIT_PERSISTENT_STORAGE` | `juce_WebBrowserComponent_linux.cpp` | not compiled | none |
| `T3K_NO_MUTE_BANNER` | `juce_StandaloneFilterWindow.h` | yes | none |
| `T3K_DARK_MUTE_BANNER` | `juce_StandaloneFilterWindow.h` | yes | none |
| `T3K_AUDIO_SAFE_RESTORE` | `juce_StandaloneFilterWindow.h` | yes | none: the anchor already straddles JUCE's own `#if ! (JUCE_IOS || JUCE_ANDROID)` guard and the added code is `PropertiesFile` / `File` only |
| `T3K_SETTINGS_IN_APP_FOLDER` | `juce_audio_plugin_client_Standalone.cpp` | yes | none |
| `T3K_AUDIO_DEFAULT_SETUP` | `juce_AudioDeviceManager.cpp` | yes | none |
| `T3K_ALSA_CLOSE_STUCK_TIMEOUT` | `juce_ALSA_linux.cpp` | not compiled | none |
| `T3K_ALSA_INPUT_CHANS_SYNC` | `juce_ALSA_linux.cpp` | not compiled | none |
| `T3K_CALLBACK_ENFORCER_NULL_SAFE` | `juce_AudioDeviceManager.cpp` | yes | none |
| `T3K_ZOOM_TOGGLE` | `juce_NSViewComponentPeer_mac.mm` | not compiled (iOS uses `juce_UIViewComponentPeer_ios.mm`) | none |

No patch had to be changed or newly guarded for iOS.

### M2 Compile for the iOS Simulator

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake --build build-ios --target TONE3000_Standalone -- -sdk iphonesimulator
```

See the source changes section below.

### M5 Device (blocked, not attempted)

Signing for the physical iPad is not currently possible on this Mac: Xcode has
no Apple account signed in, so automatic signing fails with "No Accounts: Add a
new account in Accounts settings" even though the `Apple Development` identity
exists in the keychain and the provisioning profile folders are empty. This was
proved separately and M5 was not attempted here.

Once the owner has signed in to Xcode with the Apple ID belonging to team
`H9RD544ZD4`, this is the exact sequence to run:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake -B build-ios-device -G Xcode \
    -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0 \
    -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY="Apple Development" \
    -DCMAKE_XCODE_ATTRIBUTE_DEVELOPMENT_TEAM=H9RD544ZD4

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake --build build-ios-device --target TONE3000_Standalone -- \
    -sdk iphoneos -allowProvisioningUpdates

xcrun devicectl device install app \
  --device 499F7A19-3719-5E37-972C-F7DF0CA30DC6 \
  build-ios-device/plugin/TONE3000_artefacts/Debug/Standalone/TONE3000.app

xcrun devicectl device process launch \
  --device 499F7A19-3719-5E37-972C-F7DF0CA30DC6 \
  com.bsaraiva.tone3000ios
```

The `ios-device` CMake preset wraps the configure step; it reads the team id
from the `TONE3000_DEVELOPMENT_TEAM` environment variable so no personal team
id is committed.

## Open issues

- The TONE3000 publishable key is a placeholder, so the catalogue and OAuth
  login are untested on iOS.
- The OAuth redirect URI on iOS is unknown. macOS uses
  `juce://juce.backend/index.html`; whether an iOS WKWebView build serves the
  same origin needs checking, and whichever origin it is has to be registered
  in TONE3000 Settings > API Keys.
- AUv3 is out of scope; the Standalone is the only iOS target.
