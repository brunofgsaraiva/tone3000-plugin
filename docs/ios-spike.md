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

Result: green on the first attempt, zero errors. The bundle lands at
`build-ios/plugin/TONE3000_artefacts/Debug/Standalone/TONE3000.app`
(`x86_64 arm64`, `CFBundleIdentifier com.bsaraiva.tone3000ios`,
`MinimumOSVersion 16.0`). The generated Info.plist carries `UIBackgroundModes
[audio]`, `UIFileSharingEnabled`, `UISupportsDocumentBrowser`,
`UIRequiresFullScreen`, landscape-only `UISupportedInterfaceOrientations`,
`NSMicrophoneUsageDescription` and `NSBluetoothAlwaysUsageDescription`.

Three source files needed iOS branches. Every `#else` branch is the existing
code, unchanged:

- `plugin/src/WindowMouseEvents.mm` is AppKit end to end (NSEvent injection,
  the `NSTrackingArea` hover revival, the `NSWindow` background paint, the
  `WKWebView` context-menu guard). Its entry points are already declared under
  `#if JUCE_MAC` in `EditorWebViewSetup.h`, so the whole file is wrapped in
  `#if JUCE_MAC` and compiles to an empty translation unit on iOS rather than
  being deleted.
- `plugin/src/WindowKeyEvents.mm` gets an iOS no-op for `forwardKeyToHost`.
  There is no host DAW to hand a transport key to on iOS and no AppKit event
  queue to post one into. Keeping the symbol means the UI does not need a
  second platform check.
- `plugin/src/AudioPermissions.mm` gets an iOS branch on `AVAudioSession`
  (`recordPermission` / `requestRecordPermission:`) instead of macOS's
  `AVCaptureDevice`, and `openMicSettings` opens
  `UIApplicationOpenSettingsURLString` since iOS has no per-pane privacy URL.

### M3 Run on the Simulator

```sh
UD=332D5E88-B221-4285-A706-2895AF6CBD8C     # "QA-iPadPro12.9-6th"
xcrun simctl install $UD build-ios/plugin/TONE3000_artefacts/Release/Standalone/TONE3000.app
xcrun simctl launch $UD com.bsaraiva.tone3000ios
xcrun simctl io $UD screenshot docs/ios-spike/m3-simulator-ui.png
```

Build the **Release** configuration for this. The Debug build points the
WebView at the Vite dev server (`Editor.cpp` has an `#ifdef JUCE_DEBUG` branch
loading `http://localhost:5173/`), which is not running, so a Debug build shows
a failed navigation. Release loads the embedded resources:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake --build build-ios --config Release --target TONE3000_Standalone -- -sdk iphonesimulator
```

Result: green. Proof from the app's own log:

```
Release mode: loading from embedded resources
Requested URL: /index.html
Returning resource: index_html (text/html)
[webview:log] Main WebView: JUCE C++ Backend loaded
Requested URL: /main.js
[webview:log] TONE3000 UI booted
```

**Where the log goes on iOS.** `FileLogger::getSystemLogFileFolder()` resolves
inside the app container rather than `~/Library/Logs/TONE3000/`:

```sh
xcrun simctl get_app_container $UD com.bsaraiva.tone3000ios data
# -> <container>/Library/TONE3000/TONE3000.log
```

The iOS microphone permission prompt fires on first launch with the plugin's
own usage string, which confirms the `AVAudioSession` path and the plist key
end to end. `xcrun simctl privacy $UD grant microphone com.bsaraiva.tone3000ios`
does not suppress it (`requestRecordPermission:` still prompts), so the dialog
has to be tapped once.

#### Layout, and the one real bug this found

The iPad Pro 12.9 is 1366 x 1024 pt in landscape, not 1024 x 768. The first run
clipped roughly a third of the UI off the right edge: the header's menu and
account buttons, the output meter rail and the Output knob were all off-screen.

The cause is native, not CSS. The editor installs an aspect-locked constrainer
(`setFixedAspectRatio(1024.0 / 578.0)` in `updateResizeConstraints`) so desktop
corner drags scale the whole window. JUCE's iOS standalone window runs in kiosk
mode and hands the editor the screen bounds; the 1024:578 lock then resolves by
height, making the editor about 1814 pt wide inside a 1366 pt screen, and the
window clips the overflow. The web UI never saw a problem because its own
letterbox fit (`useUiScale`, `min(clientWidth / 1024, clientHeight / designHeight)`)
was being handed a 1814 pt viewport that the design box fits exactly.

The fix is four small `#if JUCE_IOS` branches in `plugin/src/Editor.cpp`, all of
which take the position "the window is the screen":

- the constructor does not install the constrainer or the persisted scale, and
  calls `setResizable(false, false)`;
- `parentHierarchyChanged` skips the native-title-bar dance, which has nothing
  to correct in kiosk mode;
- `setExtraContentHeight` records the height but does not try to grow a window
  that cannot grow, letting the web UI shrink to fit exactly as it already does
  for a host that refuses a resize;
- `resized()` does not persist a scale, since no user or host chose one.

No CSS root scale and no WebView zoom were needed: with the editor at the real
1366 x 1024, the web UI's existing letterbox fit does the right thing on its
own (scale 1.334, a 1366 x 771 design box with black above/below).

After the fix everything is on screen and legible: full header (Presets, save,
add, mono/stereo, tuner, undo/redo, menu, account), both meter rails, all
faceplate knobs including Output, SPREAD, and the CPU readout. Screenshots:
`docs/ios-spike/m3-simulator-boot.png` (first launch, mic prompt) and
`docs/ios-spike/m3-simulator-ui.png` (after the fix).

### M4 Local `.nam` load on the Simulator

Two problems stood between an iPad and a local model, and only one of them
needed code.

**Reaching the menu.** The Load File / Load Folder rows live in the tile's
`TileMenu`, which only opens on `contextmenu`. There is no right-click on an
iPad, and WKWebView does not synthesize `contextmenu` from a long press on a
plain div, so those rows were unreachable. The fix is entirely in the web UI
(`ui/src/components/GalleryBlock.tsx`): `useTileMenu` grows a `longPressProps`
bundle (pointerdown starts a 500 ms timer, a 10 px drift or an early pointerup
cancels it) that opens the same menu at the same anchor, and sets the same
click-suppression flag the ctrl-click path uses. It is gated on
`e.pointerType === 'touch'`, so mouse and trackpad behaviour on macOS, Windows
and Linux is untouched. 500 ms matches UIKit's own long-press default and
stays under dnd-kit's drag threshold, so a deliberate tile drag still drags.

**The picker.** No native change was needed. JUCE's `FileChooser` already maps
to `UIDocumentPickerViewController` on iOS, and the existing
`*.nam;*.wav` wildcard survives the trip: `juce_FileChooser_ios.mm` turns each
extension into a `UTType` via `typeWithFilenameExtension:`, and iOS gives `.nam`
a dynamic type rather than nil, so `.nam` files are listed and selectable
rather than greyed out.

Test procedure (the picker was driven with taps rather than headlessly):

```sh
UD=332D5E88-B221-4285-A706-2895AF6CBD8C
DATA=$(xcrun simctl get_app_container $UD com.bsaraiva.tone3000ios data)
cp "<some>.nam" "$DATA/Documents/"
xcrun simctl launch $UD com.bsaraiva.tone3000ios
# long press a tile -> Load File -> On My iPad -> TONE3000 -> the .nam
```

Because `FILE_SHARING_ENABLED` and `DOCUMENT_BROWSER_ENABLED` are set, the
app's Documents folder shows up in the picker as **On My iPad > TONE3000**,
which is also how a real user will get captures onto the device (drop them into
that folder from the Files app).

Result: green. From the app log:

```
[LocalLoad] Loaded 'tone3000-65976-fender-vibroverb-1964-model-443383' into block d3f305e1c2d64bcba448898916735165 (1 of 1 file(s))
[ModelLoader] Preparing NAM model: tone3000-65976-fender-vibroverb-1964-model-443383.nam (294666 bytes)
[ModelLoader] NAM model prepared, model sample rate: 48000
```

The block appears in the chain as a local-file tile and the CPU readout goes
from 0.4% to 2.1%, so the model is genuinely running on the audio thread. That
also confirms the `-force_load` link fix from M1: without it the A2 config
parser would not have registered and the load would have failed with "No config
parser registered for architecture".

Screenshots: `docs/ios-spike/m4-longpress-tilemenu.png`,
`docs/ios-spike/m4-document-picker.png`, `docs/ios-spike/m4-nam-loaded.png`.

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
