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
  (`ui/.gitignore` line 16). It started as a placeholder; from P7 onward it
  carries the owner's real key, and the live Trending catalogue and the
  TONE3000 login page both load on iOS. Never commit, print or quote it.
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

### M5 Device: physical iPad Pro 12.9

Signing was blocked earlier in the session (Xcode had no Apple account, so
automatic signing failed with "No Accounts"). Once the owner signed in with the
Apple ID of team `H9RD544ZD4` this ran green on the first attempt.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake -B build-ios-device -G Xcode \
    -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0 \
    -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY="Apple Development" \
    -DCMAKE_XCODE_ATTRIBUTE_DEVELOPMENT_TEAM=H9RD544ZD4

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  cmake --build build-ios-device --config Release --target TONE3000_Standalone -- \
    -sdk iphoneos -allowProvisioningUpdates

xcrun devicectl device install app \
  --device 499F7A19-3719-5E37-972C-F7DF0CA30DC6 \
  build-ios-device/plugin/TONE3000_artefacts/Release/Standalone/TONE3000.app

xcrun devicectl device process launch \
  --device 499F7A19-3719-5E37-972C-F7DF0CA30DC6 \
  com.bsaraiva.tone3000ios
```

The `ios-device` CMake preset wraps the configure step and reads the team id
from the `TONE3000_DEVELOPMENT_TEAM` environment variable, so no personal team
id is committed.

Result: green. The bundle is signed by `Apple Development: saraiva69@gmail.com
(5C5HXWUVR9)` with `TeamIdentifier=H9RD544ZD4` and
`Identifier=com.bsaraiva.tone3000ios`; install and launch both reported
success.

`devicectl` has no screenshot command, so the proof is the app's own log,
pulled back off the device:

```sh
xcrun devicectl device copy from \
  --device 499F7A19-3719-5E37-972C-F7DF0CA30DC6 \
  --domain-type appDataContainer --domain-identifier com.bsaraiva.tone3000ios \
  --source Library/TONE3000/TONE3000.log --destination ./m5-device-launch.log
```

Saved as `docs/ios-spike/m5-device-launch.log`. It shows the real-hardware
audio device opening and the UI booting from embedded resources:

```
[Processor] prepareToPlay: sampleRate=48000, samplesPerBlock=256
[Processor] prepareToPlay: sampleRate=48000, samplesPerBlock=128
Release mode: loading from embedded resources
[webview:log] Main WebView: JUCE C++ Backend loaded
[webview:log] TONE3000 UI booted
```

Not proved on the device: the on-screen layout (no screenshot channel), the
long-press menu, the document picker, and audio through the Scarlett. Audio is
deliberately the owner's step.

## Parity phase

Goal changed after M5: a 1:1 replica of the desktop app on the iPad, not a
spike. Same branch, one commit per item.

### P1 Fill the screen

**Before:** the UI occupied 1366 x 813 pt of the 1366 x 1024 pt screen, with a
211 pt dead black band along the bottom (`docs/ios-spike/p1-before.png`).

Worth being precise about why, because the obvious reading of the symptom is
wrong. The width was already correct: `useUiScale` fits the 1024 x 578 design
box with `min(clientWidth / 1024, clientHeight / designHeight)`, and on a
1366 x 1024 screen the width term (1.334) is already the smaller one, so the
box was *already* as wide as the screen. The band was pure aspect mismatch:
the design is 1.772:1, the iPad screen is 1.334:1, and letterboxing is what
fitting one into the other means. "Fill the height while keeping the aspect"
is not achievable as stated. Forcing it is exactly the bug fixed in M5's
commit, where the aspect lock resolved by height and clipped the width.

**Fix:** stop fitting the height at all on iOS. `fitScale` returns the width
fit alone, and the root box in `Plugin.tsx` takes `100dvh` instead of a
design-space height. The root is already `display: flex; flexDirection:
column` with fixed strips (banner, hint bar, faceplate) and a flexible middle,
so the extra 211 pt goes where it should: the signal chain lane. Every length
in the UI is still exactly one rem per design px, so nothing is stretched,
squashed or distorted; there is simply more room between the header and the
faceplate, and the tone tiles are correspondingly taller.

**After:** the UI fills 1366 x 1024 pt with zero letterbox
(`docs/ios-spike/p1-after.png`).

The iOS switch is a native-injected flag, not a user-agent sniff: a
`#if JUCE_IOS` user script in `EditorWebViewSetup.cpp` sets
`window.__T3K_PLATFORM__ = 'ios'` at document start, and `useUiScale` exports
`IS_IOS` from it. Every desktop build's injected script is byte-identical to
before.

#### Touch targets

This is where the acceptance criterion was actually failing, and it was
failing before P1 as much as after: P1 does not change the scale (it was
already width-limited at 1.334), only how the spare height is distributed.

Measured from the design tokens rather than guessed: `ICON_BOX_SIZE` is 20
design px and the top bar passes 28, which at 1.334 real px per design px are
**26.7 pt and 37.4 pt** - both under Apple's 44 pt HIG floor.

Rather than redraw the chrome bigger on one platform, the glyph keeps its size
and an invisible child (`IosTouchTarget` in `ChromeIconButton.tsx`) stretches
the *hit* area to 44 pt, centred, on `IconButton` and `ChromeIconButton`. The
expander is sized in `px`, not `rem`: the page is served `initial-scale=1`, so
one CSS px is exactly one point, and the value is therefore correct at any
scale without dividing by it. It renders `null` off iOS, so no extra node is
mounted on desktop and no desktop layout changes.

Verified rather than asserted: a tap 20 pt below the tuner glyph's centre -
outside the old 37 pt box, inside the new 44 pt target - opens the tuner
(icon highlights, hint bar reads "Tuner: chromatic tuner. Click again:
back."). That incidentally also confirms the tuner works under touch, which is
part of P5.

Where the design packs boxes closer together than 44 pt the expanders overlap
slightly. That is the accepted trade in every native toolkit that does this: a
tap in the gap picks the nearer of two buttons rather than missing both.

macOS Release regression build after this item: green, 0 errors.

### Hotfix: security-scoped picker results

Found by the owner on the physical iPad, not by the Simulator test in M4. The
device log:

```
[LocalLoad] /private/var/mobile/Containers/Shared/AppGroup/.../File Provider Storage/Downloads/Deluxe Reverb 2.nam: Couldn't read the file
```

M4 passed for the wrong reason. The `.nam` it loaded had been copied into the
app's own Documents folder, so reading it by path was legal. Everything a real
user picks from the Files app lives outside the app sandbox, in an iCloud or
file-provider container, and is readable only through the security scope
iOS grants for that one pick. `pickLocalToneFile` used
`FileChooser::getResults()`, which flattens those picks to raw paths, and fed
them to `loadLocalTonePath`, whose `stashLocalFileFromDisk` opens a plain
`FileInputStream`. The sandbox refuses that open, and the failure surfaces as
the exact string above.

JUCE says as much in its own header: "on mobile platforms, you should call
getURLResults() instead" (`juce_FileChooser.h`), and
`juce_FileChooser_ios.mm` bookmarks each pick with
`startAccessingSecurityScopedResource`.

The fix, all under `#if JUCE_IOS`:

- `pickLocalToneFile` reads `chooser.getURLResults()` and calls a new
  `TONE3000Processor::loadLocalToneUrls`.
- That takes 1..N `juce::URL`s and reads each through
  `juce::URL::createInputStream`, which goes through the bookmark and the
  scope, then feeds the bytes into the existing `stashLocalBytes` and
  `finishLocalToneLoad` pipeline. No base64 round trip: the bytes go straight
  into the same stash the drag-and-drop path fills.
- macOS, Windows and Linux keep the path route (`loadLocalTonePath`)
  unchanged.

**Folders.** iOS has no usable folder route, so "Load Folder" becomes
multi-select there. The picker can return a folder URL, but a security-scoped
directory cannot be enumerated through `juce::URL` (there is no listing API
behind the bookmark), so a picked folder would be an unreadable handle. The
iOS chooser therefore asks for the files themselves
(`canSelectMultipleItems`) and runs the same many-models-at-once path on the
result, sorted by natural name order like the folder and drop routes.

**Test.** Deliberately reproduced across the sandbox boundary rather than
inside the app container. A `.nam` was written to the Simulator's
file-provider storage:

```sh
UD=332D5E88-B221-4285-A706-2895AF6CBD8C
BASE=~/Library/Developer/CoreSimulator/Devices/$UD/data/Containers/Shared/AppGroup
cp some.nam "$BASE"/*/"File Provider Storage"/Downloads/SANDBOX-TEST.nam
```

That is `Containers/Shared/AppGroup/...`, while the app's own container is
`Containers/Data/Application/...` - the same split as the device failure. It
appears in the picker as **On My iPad > Descargas**, and picking it now logs:

```
[LocalLoad] Loaded 'SANDBOX-TEST' into block a82556f28bd443a98d21e12b86dbee87 (1 of 1 file(s))
[ModelLoader] Preparing NAM model: SANDBOX-TEST.nam (295049 bytes)
[ModelLoader] NAM model prepared, model sample rate: 48000
```

Screenshot: `docs/ios-spike/hotfix-sandboxed-load.png`.

macOS Release regression build after this item: green, 0 errors.

### P2 Touch reorder

Green, and it needed one real fix plus a corrected test.

**The gesture rule, and why the two gestures do not fight.** The lane's
`PointerSensor` is configured distance-only (`ChainView`), deliberately: the
stock constraints add a 200 ms hold that would turn a slow click-to-open into
a drag. It engages at `GALLERY_DRAG_DISTANCE_PX` (6) design px of travel. The
long-press menu added earlier used a flat 10 real px slop, which is *larger*
than the 6-design-px (~8 real px) drag threshold, leaving a window where a
drag had engaged with the menu timer still armed: pausing mid-drag popped the
menu open over a moving tile.

The slop now derives from the drag constant instead of being an independent
magic number, which makes the gestures disjoint by construction:

| travel | behaviour |
| ------ | --------- |
| 0 to 4 design px | menu timer runs, no drag |
| 4 to 6 design px | menu abandoned, drag not yet engaged |
| 6 design px and up | drag; the menu timer is already dead, so it cannot fire mid-drag |

`GALLERY_DRAG_DISTANCE_PX` moved from `ChainView` to `GalleryBlock` so both
consumers share it. Importing it the other way would have cycled
(`ChainView -> GalleryLane -> GalleryBlock`).

**`touch-action` turned out to be a non-issue.** The worry was that WKWebView
would claim horizontal finger drags for panning the lane instead of delivering
pointermove. It does not: dnd-kit engages normally and the lane still scrolls.
No CSS change was needed.

**A correction to how this was first tested.** The first drag looked like it
did nothing. It had in fact worked: both tiles held the *same* model and local
tone tiles render an identical file glyph, so a swap was invisible. Re-run with
one block bypassed (dimmed glyph, lit power chip) as a marker, the swap is
obvious. Worth recording because the same trap swallowed the M4 result.

Verified on the Simulator, all three behaviours:

- **Drag a tile** - press and drag the bypassed tile rightward past its
  neighbour: the two swap (`docs/ios-spike/p2-reorder-before.png`,
  `docs/ios-spike/p2-reorder-after.png`).
- **Swipe the lane background** - a quick horizontal swipe on empty lane still
  scrolls the chain (`docs/ios-spike/p2-lane-scroll.png`).
- **Pause mid-drag** - a drag with a deliberate 1200 ms hold in the middle
  completes as a reorder and shows no menu, which is exactly the regression
  the slop fix prevents.

Tapping a block's power button also works under touch, which is part of P5.

**Known gap, deferred to P7 item 2.** Because activation is distance-only, a
swipe that *starts on a tile* reorders rather than scrolls; only swipes
starting on the lane background scroll. Apple's HIG wants touch-and-hold then
drag, which would let a plain swipe over a tile scroll instead. dnd-kit's own
default for `pointerType === 'touch'` is exactly that
(`Delay({ value: 250, tolerance: 5 })`), but the project's `activationConstraints`
override ignores its arguments and so drops it for touch as well as mouse.
Restoring it collides head-on with the 500 ms long-press menu (the drag would
start at 250 ms and the menu could never fire), so the two cannot simply
coexist. P7 item 1 resolves this by putting a visible "..." button on each
tile, at which point the hidden long-press is no longer the only way to reach
the menu and hold-to-drag can take over.

macOS Release regression build after this item: green, 0 errors.

## P7 Touch navigation

Spec: "Navegacao por toque TONE3000 iPad" (owner, 2026-09-02), from Apple's
HIG pages Gestures, Context menus, and Drag and drop.

### P7 item 1: never only a hidden gesture

HIG: *"Always make context menu items available in the main interface, too."*
The long-press menu added in M4 was the only route to Load File / Load Folder
on iOS, which is exactly what that rule forbids.

- **Visible `...` button on every tone tile** (touch only). It sits in the
  tile's top chrome bar between the power button and the swap/trash cluster,
  and opens the same sheet the long press does, anchored to the button's own
  bottom-left rather than to a pointer position the user never sees on touch.
  Desktop passes no `onMore`, so no extra button is mounted and the tile is
  unchanged.
- **Unavailable rows hidden, not dimmed** (touch only). `TileMenu` filters
  `disabled` rows when `IS_IOS`. On an empty slot with nothing copied, Paste
  now simply is not there; desktop keeps the dimmed row, which is the
  platform convention and the behaviour that menu has always had.
- **Destructive row last and red.** `TileMenuItem` gained a `destructive`
  flag rendering the label in `BRAND_RED`, and the tone tile's sheet gets a
  `Remove` row at the end on touch. Desktop does not add the row: its trash
  button is one hover away, and changing a menu every existing user knows is
  not this spike's business.

Evidence: `docs/ios-spike/p7-tile-more-menu.png` (the `...` button and the
sheet with Copy / Load File / Load Folder / **Remove** in red),
`docs/ios-spike/p7-paste-hidden.png` (empty slot, Paste absent rather than
greyed).

Two findings worth recording, because they change what later items have to do:

- **The tile chrome already handles touch.** `.tile-chrome` is hover-revealed
  in `index.css`, but there is already an `@media (hover: none)` block that
  pins it visible on touch devices. Power, swap and trash were never
  unreachable on iPad; only the context-menu rows were.
- **`touchAction: 'none'` is already set on the tile face**, with a comment
  stating the intent plainly: "Drag wins on the tile face; lanes still pan
  from the gaps around it." So P2's observed behaviour (a swipe starting on a
  tile reorders, a swipe on the lane background scrolls) is a deliberate
  upstream decision, not an oversight. Item 2's plan - hold-to-drag so a
  plain swipe over a tile scrolls - therefore means *reversing* that decision
  on iOS, not filling a gap.

### OAuth redirect URI (question 3 of issue #55)

Answered for this account: the owner's TONE3000 account has no redirect URI
restrictions ("If no URIs are set, any redirect URI will be accepted"), so
`juce://juce.backend/index.html` needs no registration here. Upstream may
still want the URI documented for accounts that do restrict it. The real
publishable key now lives in `ui/.env`, which is gitignored and never
committed.

macOS Release regression build after this item: green, 0 errors.

### P7 item 1b: On this iPad

Select Tone now opens with an **On this iPad** section (Load file / Load
files) above the gear filters, iOS only. It reads the same pending-target
sessionStorage keys `handleToneSelected` consumes, so a local pick lands in
exactly the slot or swap target that opened the browser; the targets are
consumed only after a successful load, so a cancelled picker leaves the slot
armed. Screenshot: `docs/ios-spike/p7-on-this-ipad.png`.

### P7 item 2: hold to lift, swipe to scroll

The gesture rule on iPad, as implemented:

| gesture | result |
| ------- | ------ |
| tap a tile | open the block |
| swipe over a tile | scroll the lane |
| hold (250 ms), then drag | reorder |
| hold, release without moving | open the tile menu at that point |
| `...` button | the same menu, explicitly |
| menu: Move left / Move right | the same reorder, without any gesture |

Three pieces made that work. dnd-kit's touch activation went back to its own
default, `Delay({ value: 250, tolerance: 5 })`. The tile face opts back into
panning on iOS (`touch-action: pan-x`), so a quick swipe reaches the browser
and dnd-kit stands down on `pointercancel`, while a 250 ms hold elapses
before any pan begins and the sensor captures the pointer instead. And the
menu opens on *release after a hold*, not on a timer, which would have raced
the lift and opened a sheet over a tile already travelling.

**The trap worth knowing:** that release has to be watched on `window` in the
capture phase, not on the tile. Once the hold elapses the sensor takes
pointer capture and no `pointerup` reaches the element at all. The first
version listened on the tile: the menu never opened, and the click fell
through and opened the block's detail view instead.

Move left / Move right commit the whole lane order through `reorderBlocks`,
the same action a drop uses. Undo therefore covers them identically:
`reorderChainBlocks` calls `pushChainHistory()` (`ProcessorChain.cpp:680`),
confirmed at the source rather than assumed.

Screenshot: `docs/ios-spike/p7-hold-release-menu.png`.

#### Note for the upstream reviewer

Desktop keeps `touch-action: none` on the tile face and drags straight off
it. That is right for a mouse: nothing else competes for the gesture on that
element, and the lane still pans from the gaps around the tiles. Apple's HIG
asks for the opposite on iPad, where a swipe anywhere is expected to scroll
and reordering is a touch-and-hold. So the two platforms genuinely want
different rules here, and the `IS_IOS` split in `TileSurface` and
`ChainView`'s activation constraints is a deliberate platform divergence
rather than a fix to the desktop behaviour.

### P7 item 3: touch help, and the knob under a finger

Three things the desktop UI gets from a mouse and iPad has no equivalent for:
hover help, a modifier-click reset, and a value readout you can see while you
adjust it.

**The info bar follows the finger.** `helpText.ts` already resolved a hint on
`pointerdown` as well as `mouseover`, so a tap did caption the control. What
it never did was stop: the caption stayed on whatever was last touched, which
on a mouse is correct (the pointer really is still there) and on touch is
simply a wrong label sitting under an idle screen. A touch release now clears
it, so the bar mirrors the finger exactly as it mirrors a mouse.

Two traps, both paid for:

- The release must be watched on `window` in the capture phase. A knob takes
  pointer capture on press, and its `pointerup` never bubbles to `document`.
  This is the same trap item 2 hit with the tile menu.
- **WebKit replays a mouse event pair after every touch** (`mouseover`,
  `mousemove`, `mousedown`, `mouseup`, `click`), aimed at the element just
  tapped, and it lands *after* `pointerup`. The first version cleared the
  hint on release and the replayed `mouseover` put it straight back: the bar
  looked untouched, and would have been reported as "no change" if the state
  had not been marked before the test. Mouseover is now ignored for 700 ms
  after a touch release, which is narrower than dropping `mouseover` on iOS
  and keeps the genuine hover an iPad trackpad produces.

**The copy says what the gesture is.** The knob legend and the two EQ ones
branch by hand, because their gestures genuinely differ; every other line
goes through one `touchify` pass that rewrites `Right-click` to `Touch and
hold` and `click` to `tap`, so the two platforms cannot drift apart line by
line. Knobs read `drag up or down: adjust - double tap: reset` on iOS instead
of the Shift/double-click/Alt legend.

**"Touch and hold: advanced" had to be made true first.** WKWebView never
fires `contextmenu` for a long press, so the Spread and Align advanced decks,
which open on `onContextMenu`, had no route at all on iPad. New hook
`ui/src/hooks/useTouchHold.ts` spreads onto the same element and fires the
same toggle after a 500 ms hold, and swallows the click that follows so the
hold does not also enable the feature. It renders nothing off iOS. It is
deliberately not the tile's gesture: a tile competes with the lift and with
lane scrolling and must wait for the release, while nothing competes here.

**Knobs.** On iOS a double tap resets to the default, recognised from the
pointer stream (300 ms, 24 px) rather than from `dblclick`, which WKWebView
ties to its own double-tap handling; `onDoubleClick` is unbound there, so the
type-in editor cannot also open and put the iOS keyboard over the knob being
edited. Every one of the 16 `KnobControl` instances declares a
`defaultValue`, so no knob loses a gesture. A value bubble sits above the
knob while dragging, showing the same string as the label readout, which on
touch is under the finger. `IosTouchTarget` now also mounts inside the knob:
at the iPad's scale the 48 px primary and 36 px secondary knobs are already
64 pt and 48 pt, so it changes nothing there, but the 44 pt floor now holds
by construction rather than by arithmetic coincidence.

**A bug the test found.** The first double-tap recogniser armed on every
`pointerdown`, including the one that starts a drag. Dragging a knob and then
tapping it inside the 300 ms window read as a pair and threw the drag away:
the knob snapped back to its default the moment you touched it again. A press
that travels past the slop now withdraws its own tap candidate.

Evidence:

- `docs/ios-spike/p7-i3-touch-help-and-bubble.png`: mid-drag on Middle. The
  bubble reads `5.4` above the knob and the info bar reads "Middle: tone
  stack mids, 0-10: +/-15 dB bell at 425 Hz. drag up or down: adjust - double
  tap: reset".
- `docs/ios-spike/p7-i3-release-clears-bar.png`: the same screen after
  release. Bar empty, bubble gone, knob left at its new value.
- `docs/ios-spike/p7-i3-hold-advanced-deck.png`: a 1.3 s hold on the SPREAD
  advert button opens the Wobble / Crossover / Diffuse deck, and Spread is
  still off, so the suppressed click worked.

**Not proved on the Simulator: the double tap itself.** Two taps cannot be
driven closer than about a second through the automation bridge, which is
outside the 300 ms window. It was proved instead against the same built
bundle running with `__T3K_PLATFORM__ = 'ios'` in a browser, driving real
`pointerType: 'touch'` events: drag to 10.0, two lone taps 600 ms apart leave
it at 10.0, a pair 140 ms apart returns it to 5.0, and the sequence repeats.
That exercises the recogniser but not WKWebView; the Simulator run above
proves WKWebView delivers touch pointer events to the same handler. The
owner should confirm the double tap on the device.

macOS Release regression build after this item: green, exit 0.

### P7 item 4: reach, safe areas, navigation gestures

**44 pt floor: one CSS rule, not per-component edits.** `html.t3k-ios` (set
on `<html>` only in the iOS app) gives every `button`, `[role=button|switch|
tab|radio]` and `a[href]` an invisible `::after` expander at
`max(100%, 44px)`, centred and out of flow, so nothing moves. Text fields
cannot carry a pseudo-element, so those opt in with `.t3k-touch-field`
(preset name / save / search, MIDI CC); the inline editors inside a fixed
chrome slot (knob label, EQ band chip) deliberately do not, since a 44 px box
would spill out of the slot.

Measured against the built bundle at the iPad's exact viewport (1366 x 1024,
root font-size 1.334, so 1 CSS px = 1 pt):

| screen | controls under 44 pt before | after |
| ------ | --------------------------- | ----- |
| chain + faceplate | 5 (preset prev/next 29.3 wide, preset name 32.5 high, Save 37.3, info-bar X 26.7) | 0 |
| Settings | 8 (close X 37.3, six toggles 53.4x32, "Reveal log file" 18.5 high) | 0 |

An expander can steal taps from a neighbour, so the same harness checks every
pair: one real collision, the Next Preset chevron reaching 7.3 pt into the
preset name. Fixed by raising the name above the chevrons on iOS
(`position: relative; z-index: 1`), which leaves the chevrons the room outside
the pill. Both screens now report zero collisions.

**Safe areas: nothing to do, and measured rather than assumed.** A boot probe
on the iPad Pro 12.9 (6th gen) logged `env(safe-area-inset-*)` as `0px` on all
four sides, with `innerHeight` 999 in a 1024 pt screen: the WKWebView is
already inset by 25 pt and the page has nothing left to avoid. The faceplate
and info bar therefore already clear the home indicator. `padding-bottom:
env(safe-area-inset-bottom, 0px)` is on the root anyway, a no-op today that
stays correct if the webview is ever made full-bleed. Not proved on the
device: whether iPadOS draws the indicator over the app there.

**Navigation gestures** (`ui/src/hooks/useTouchGestures.ts`): left-edge swipe
goes back from SELECT TONE and BLOCK, swipe down dismisses the Tuner and
Settings sheets. Each screen keeps its visible 44 pt control, so the gesture
is never the only route.

**Touch events, not pointer events.** The page opts into panning
(`touch-action: manipulation`), so WKWebView takes a swipe over and ends it
with a `pointercancel` **reported at 0,0**, with no usable `pointermove` and
no `pointerup`. Two pointer-based versions failed on this before the log
showed it (`[swipe] pointercancel dxdy=-683,-300`). `touchend` is delivered
either way and carries the real end position in `changedTouches`.

**The keyboard needs no help.** Focusing a field on the TONE3000 page inside
the WebView scrolls it clear of the keyboard by itself
(`p7-i4-keyboard-clears-field.png`). The Browse *search* field sits behind the
TONE3000 login, so it is not reachable until the owner completes the magic
link; the field tested is the login page's own, in the same WebView with the
same keyboard.

Evidence: `p7-i4-select-tone.png` then `p7-i4-edge-swipe-back.png` (open, then
back on the chain); `p7-i4-tuner-open.png` then
`p7-i4-swipe-down-dismissed.png`. Settings dismissal was driven the same way
and returned to the chain.

**Second bite from the same glob.** A scratch `iostest.html` written into
`plugin/webview` for the touch-target audit got baked into the configure-time
asset list; deleting the file then broke the *macOS* build with "No rule to
make target .../iostest.html". Never put scratch files in `plugin/webview`,
and reconfigure after removing one.

**Trap found, and it invalidates "I rebuilt, so I tested the new UI".**
`plugin/CMakeLists.txt` collects the webview with `file(GLOB_RECURSE)`, which
runs at **configure** time. Vite's asset names are content-hashed, so any CSS
change produces a new filename the stale glob does not include, and the app
keeps serving the previously embedded bundle: two rounds of gesture testing
here ran against an old UI, which the on-disk log exposed by still printing a
`console.log` that had been deleted. Always `cmake --preset ios-simulator`
before building after a UI change, and check the requested asset name in
`TONE3000.log`.

macOS Release regression after this item: green.

### P7 item 5: system gestures are not intercepted

Answered at the source, because the automation bridge can only drive one and
two finger paths, so 3 and 4 finger gestures cannot be tested here.

What could intercept them, and what the code does:

| mechanism | state |
| --------- | ----- |
| `preventDefault` on a touch, pointer or gesture event | never. The only two call sites in the UI are a dnd-kit `DragOverEvent` (a library event, not DOM) and a `wheel` listener, and a wheel does not exist on touch. |
| `preferredScreenEdgesDeferringSystemGestures` | not used, by this app or by JUCE. This is the only API that can hold off a system edge swipe, so edge swipes always win. |
| custom `UIGestureRecognizer` | none added by the app. JUCE adds a hover recognizer and a pan recognizer, and the pan one is configured for indirect input (`allowedScrollTypesMask`, `maximumNumberOfTouches: 0`, trackpad scroll) with `cancelsTouchesInView: NO`, so it never takes finger touches from the system. |
| `touch-action` | `manipulation` on html/body. It steers what the *page* does with a gesture and cannot affect a system one. |

3 finger undo/redo and 4 finger app switching are recognised by UIKit above
the app; with nothing deferring or cancelling, they reach the system
unchanged.

Live check of the one system gesture that can be driven: a swipe from the
interface bottom edge with the app in the foreground opened the iPad Dock
over it (`p7-i5-system-dock-over-app.png`).

Related, found while reading: JUCE returns `prefersHomeIndicatorAutoHidden`
for a kiosk-mode view, which the iOS Standalone is. The home indicator
therefore auto-hides over this app, which is why it never appears in the
screenshots. That hides the indicator; it does not defer its gesture.

**Not proved:** the 3 and 4 finger gestures themselves. The owner should run
them once on the iPad.

### Evidence: the desktop build really is untouched

The macOS Standalone's generated `Info.plist` from a `main` worktree and from
`ios-spike`, both configured with the same generator and build type:

```
6e99dbaffc01acf35da4c84a615ca09baeb8e19f  <main>/build/.../TONE3000_Standalone/Info.plist
6e99dbaffc01acf35da4c84a615ca09baeb8e19f  <branch>/build/.../TONE3000_Standalone/Info.plist
```

Identical SHA-1, and `diff` of `plutil -p` on both is empty. The branch's own
copy was not even rewritten by the reconfigure, which is CMake saying the
inputs produced the same bytes. Every iOS plist key lives inside
`if (T3K_IOS)`, which no macOS configure sets.

### Tile-row scaling (owner request)

**Decision: keep three tiles fully visible and grow into the lane** (owner,
after the measurements below). `monoTileSize` in `ChainView` takes the lane
band's real size from a `ResizeObserver` (the width left over is whatever the
two dB meter columns do not take, so it is measured, not derived), converts to
design px, and picks the smaller of the width three tiles allow and the lane
height less a 40 px margin, floored at the design's own 224 so it can only
grow. `plusIconSize` already scales off the tile, so the `+` glyph follows.
Stereo, BLOCK and SELECT TONE are untouched. `IS_IOS`-gated: desktop keeps a
flat 224.

Measured from Simulator screenshots, in points off the drawn borders:

| | before | after |
| --- | --- | --- |
| tile pitch | 331 | 364 |
| tile | 299 (224 design px) | 332 (**249 design px**) |
| gaps between tiles at | 152, 483, 814, 1144 | 482, 846, 1210 |
| fully visible | 3 | 3 |

Screenshots: `p7-tile-row-before.png`, `p7-tile-row-after.png`.

The growth is 11 percent because the *width* cap binds, not the height: the
lane band is 560 design px tall but three tiles across only allow 249. Filling
the height would mean roughly 500 design px and two tiles per screen. The
numbers that led to the decision:

#### The two constraints as originally written contradict each other

Measured off a Simulator screenshot of the iPad Pro 12.9 (points, from the
drawn borders, not from the source):

| thing | value |
| ----- | ----- |
| header bottom border | y = 84.5 |
| faceplate top border | y = 832 |
| lane band height | 747.5 |
| tile pitch (tile + gap) | 331 |
| tile | 299 (224 design px at scale 1.334) |
| first tile left edge | 149 |
| tiles fully visible | 3, the 4th is clipped by the output meter |

So the row uses 299 of 747.5 pt: about 450 pt of the lane is empty, which is
the owner's complaint and is real.

The cap as written cannot be met at the same time. Four tiles across need
`4t + 3 gaps` inside the width left between the two dB meter columns, roughly
1068 pt: `4t + 96 <= 1068`, so `t <= 243 pt` = **182 design px**. The tile is
224 design px today, so "four across" requires making the tiles *smaller*,
while "fill the lane height" requires making them much larger. Four across is
already not true today.

Options put to the owner, who chose 2 with N=3:

1. **Height wins.** Grow the tile toward the lane height (up to roughly 500
   design px) and accept two per screen with horizontal scroll. Biggest
   visual change, closest to "fill the lane".
2. **A number-visible floor wins.** Keep a minimum of N fully visible and
   grow to whatever that allows: N=3 gives about 330 pt (247 design px), a
   small growth; N=4 shrinks the tiles.
3. **Split the difference.** Grow the tile to the lane height minus a margin
   but cap it at a fraction of the width so at least three stay visible.

### P7 item 2, haptics

`Haptics.h` / `Haptics.mm` are the same platform-shim pattern as
`AudioPermissions`: `impact("medium"|"light")` drives
`UIImpactFeedbackGenerator` under `#if JUCE_IOS` and compiles to an empty
function everywhere else. Registered as the `haptic` native function on every
platform so the UI can probe once, and called from `ChainView`'s
`handleDragStart` (medium, lift) and `handleDragEnd` (light, drop).

Proved on the Simulator with a temporary log, since a simulator has no Taptic
Engine:

```
[haptic] medium ios=true registered=true
[haptic] light  ios=true registered=true
```

That is the bridge end to end: the native function is registered, the UI
calls it at both ends of a real touch-and-hold drag, and the ObjC++ side runs
without taking the app down. **The buzz itself is unproved** and only the
owner can confirm it, on the iPad.

Getting a draggable tile at all is worth recording: **tapping a Trending card
opens the login page**, so nothing loads from the catalogue while signed out.
Local files do: SELECT TONE > On this iPad > Load file > the Files picker.
Two tiles loaded that way in `p7-haptics-two-local-tiles.png`.

Careful with the tile glow as a marker: it tracks the *slot's* signal, not the
block, so it does not move with a reordered tile. Mark a block by bypassing
it, not by its glow.

## P3 Files import parity

Two of the three questions are answered; the drag itself is not, and the
reason is the harness, not the app.

**Folder import: already settled.** iOS cannot enumerate a security-scoped
directory, so Load Folder is a multi-select there. Unchanged.

**The scenario is reachable, and REQUIRES_FULL_SCREEN no longer prevents it.**
Dragging Files out of the Dock put it in a window beside the running app
(`p3-files-window-alongside.png`) **even though the plist sets
`REQUIRES_FULL_SCREEN TRUE`**. On iPadOS 26 that key no longer opts an app out
of multitasking. Two consequences:

- The P3 scenario can be set up on a device today.
- The key is not protecting the layout, so the review's "keep it until Split
  View is tried" is weaker than it looked. Note the app was *not* resized: the
  second app floats over it rather than splitting the width, so the
  narrow-width layout risk did not materialise here.

**The receiving side already exists and is platform-neutral.** `GalleryBlock`
arms on `dragover` when `dataTransfer.types` includes `Files` (dashed border
plus an upload glyph, the `dropArmed` state) and on `drop` hands
`dataTransfer.items[0]` to `loadLocalFile`, the same call the tile menu's Load
File uses. Nothing in that path is desktop-specific.

**Not proved: the drag.** Three attempts at three dwell times (380 ms, 620 ms,
1000 ms before moving) failed to lift the file out of Files. The long dwell
opened Files' own context menu instead; the short ones did nothing. UIKit's
drag lift wants a press-and-move that the synthetic touch path does not
reproduce, and the automation offers no drag-and-drop primitive. Stopped after
three rather than keep guessing at timings.

**Owner action:** one finger-drag of a `.nam` from Files onto a tile settles
it. If the tile shows a dashed drop border while the file is over it, the
whole path works; if it does not, WKWebView is not delivering the drag and the
Load File rows stay the only route, which is already the supported one.

## P4 Audio device settings, and the OAuth check

### The settings page renders, and it is the real AVAudioSession stack

Settings > System Settings on the Simulator
(`p4-system-settings-audio.png`) shows, with no crash and no placeholder:

- **Hear Yourself** toggle.
- **AUDIO INTERFACE > Device**: `iOS Audio`, described as "This driver handles
  input and output together", which is AVAudioSession's single-route model
  rather than the separate in/out devices macOS shows.
- **Input Channel**: a Mono / Stereo segmented control, with channels `1 Left`
  and `2 Right` as radio rows, each with its own live level meter.
- **Output Device** with a **Test** button.
- **Buffer Size**, with the usual latency-versus-crackle copy.

So the page is not a desktop leftover: it reflects what iOS actually exposes.

### What the owner should see with a Scarlett attached

Plug the Scarlett into the iPad (USB-C, or Lightning plus a powered hub) and
open Settings > System Settings. AVAudioSession replaces the built-in route
with the interface, so:

- **Device** should stop saying just `iOS Audio` and name the Scarlett, or at
  least stay on the single combined driver while the *channels* below change.
  It is the channel list that proves the route, not the driver name.
- **Input Channel** should offer the interface's inputs, so a 2i2 gives two,
  and picking `1 Left` should make that meter move when you play into input 1
  and leave `2 Right` still. That per-channel meter is the fastest check that
  the right jack is armed.
- **Output Device** should follow the interface; **Test** should come out of
  its monitors or headphones, not the iPad speaker.
- **Buffer Size** should offer the interface's supported sizes. The iPad's own
  route tends to sit at 48 kHz; the log line `prepareToPlay: sampleRate=...`
  in `TONE3000.log` says what was actually opened, and is worth checking after
  plugging in, since a mismatch there is what usually explains crackle.

With a USB interface the expected setup is the product default, **48 kHz and
128 samples**, the same first-contact policy as desktop, so the log should say
`prepareToPlay: sampleRate=48000`. A rate of 16000 or 24000 there is not the
interface, it is a Bluetooth headset holding the route (see the Bluetooth note
in `docs/ios.md`); disconnect it and reopen the device.

If the mic permission prompt has never been answered, input is silent with no
error: the Settings banner covers that case (see AudioPermissions).

Not verifiable here: the Simulator has no audio interface, so everything above
is what the code and AVAudioSession imply, not something seen.

### OAuth: the sign-in page opens inside the app's WebView

Account menu > **Login** loads the TONE3000 "Log In or Create Account" page in
the app's own in-app browser, with its back / reload / close chrome around it
(`p4-signin-page-in-webview.png`, the account slug blacked out). No external
Safari, no bounce out of the app.

The flow stops there on purpose: TONE3000 signs in with a magic link emailed
to the owner, so only the owner can finish it. Everything behind the login is
therefore still untested on iOS: the Browse catalogue and its search field,
Favorites, Created, and **loading a tone from Trending, which opens this same
login page while signed out**.

The redirect URI question is already answered for this account: no URI
restrictions are set, so `juce://juce.backend/index.html` needs no
registration. An account that does restrict URIs would have to register
whichever origin the iOS build serves.

Note the screenshots were taken with the app in an iPadOS 26 window rather
than full screen; the simulator reboots into windowed mode and the app follows.
That is presentation only, and unrelated to the plist change.

## P5 Presets, tuner, undo/redo, stereo, spread/align under touch

### The blocker found first: every tap on a chain tile was dead

Not on the P5 list, but nothing else on it could be tested until it was fixed.
On the Simulator, at the tip of `ios-spike`, a loaded chain tile answered
**nothing**: tapping the face did not open the block, and power, `...`, swap
and trash all did nothing. An *empty* slot's `+` still opened SELECT TONE, and
press-and-hold on a tile still opened the tile menu, which is what made it
confusing.

Diagnosed with a temporary global listener logging every pointer/mouse/click
event into `TONE3000.log` (the same trick the haptics bridge used). The click
was firing, was not `defaultPrevented`, and its target was a `DIV` - never the
`BUTTON` under the finger, even with the tap landing on the power glyph's
measured centre.

**Cause.** dnd-kit stamps `role="button"` on a draggable activator that is not
already a `<button>` - i.e. on the chain tile's wrapper. P7 item 4's 44 pt rule
matches `[role='button']` and hangs a `::after` hit expander on it. On a tile
that pseudo-element is `width: max(100%, 44px)` = the whole 249 px tile, it is
last in tree order, and it therefore paints over the tile's own chrome and
takes every tap. `pointerdown` still reaches the wrapper, which is why the
long-press menu survived and hid the regression through P7.

**Fix**, in `index.css`, one rule:

```css
html.t3k-ios [role='button'][aria-roledescription='draggable']::after {
  content: none;
}
```

Both attributes, not one: dnd-kit adds `aria-roledescription="draggable"` to
every activator but adds `role` only when the activator is not a `<button>`,
so the pair matches exactly the elements that were pulled into the rule by
accident and leaves a real drag handle that is a button - the preset rows'
14 px grip - its expander. A tile is 249 px, so the expander was never adding
reach there in the first place.

Evidence: `docs/ios-spike/p5-tile-tap-fix.png` (block 1 bypassed from its tile
power button: filled chip, glyph at 0.35) and `docs/ios-spike/p5-block-detail.png`
(a tap on block 2 opens BLOCK, which also gives the model name - the marker
this file said the tile glow could not provide).

macOS Release regression build after this item: green, 0 errors.

### Preset drag reorder on touch, and the two hint strings

Verified on the Simulator with a 12-preset list (ten clones written straight
into `Library/TONE3000/Presets`, so the list overflows its `362rem` box):

- A swipe anywhere in the list **scrolls** it and reorders nothing
  (`p5-preset-list-scroll.png`). Structural, not luck: `PresetRow` passes
  dnd-kit a `handleRef`, so the sensor binds `pointerdown` to the grip button
  alone - `source.handle ?? source.element` in `PointerSensor.bind` - and the
  row is never an activator.
- Reorder mode on, **touch and hold the grip, then drag** moves the row
  (`p5-preset-reorder-before.png` -> `p5-preset-reorder-after.png`:
  AlphaBeta goes from first to third). No sensor change was needed:
  `PresetBar` uses `DragDropProvider`'s stock sensors, and dnd-kit's own
  default for `pointerType === 'touch'` is already
  `Delay({ value: 250, tolerance: 5 })` - the same rule `ChainView` had to
  restore by hand only because it overrides `activationConstraints`.

So the gesture is exactly what the HIG asks for, and the two hint strings that
still said "drag" now say so on iOS: `presetReorder` and `presetDrag` are
branched by hand (like `addTile`), because `touchify` only swaps the noun for
"press this" and a blanket `drag` -> `touch and hold, then drag` would also
rewrite the knob legend, where a plain drag is correct.

### Stereo: the tiles scale too, under the same three-across rule

`STEREO_TILE_SIZE` stayed at 160 when the mono tile grew to 249, so the two
stereo lanes floated in the same black band the mono row had before P7.

`monoTileSize` became `laneTileSize(lane, rows, design)`: the same width cap
(three across, minus the edge fades and the gaps) and the same height budget,
divided by the number of lanes sharing it, with the lane gap taken out first.
Mono passes `rows: 1, design: TILE_SIZE`, stereo `rows: 2,
design: STEREO_TILE_SIZE`, so both can only grow from their design size and
desktop is untouched (the function returns `design` when not iOS).

`StereoPanRail` hardcoded `STEREO_TILE_SIZE * 2 + LANE_GAP` for its own
height, so it now takes `tileSize` like every other consumer.

Measured off the drawn borders on the Simulator, in design px:

| | before | after |
| --- | --- | --- |
| mono tile | 249 | 249 (unchanged) |
| stereo tile | 160 | 209 |
| two-lane stack | 344 | 442 |

Stereo lands at 209 rather than mono's 249 because the width cap binds and the
pan rail takes ~123 px out of the band; the height would have allowed 228.
Three tiles fully visible per lane, the fourth peeking, exactly as in mono
(`p5-stereo-two-lanes.png` before, `p5-stereo-tiles-after.png` after).

macOS Release regression build after this item: green, 0 errors.

### The P5 table, row by row

Simulator `332D5E88-B221-4285-A706-2895AF6CBD8C`, Release build, three local
`.nam` models from `On this iPad > Load file` (`Load files` puts all three into
*one* block, which is the Load Folder shape, so the other two blocks were
loaded one file at a time). Screenshots are `docs/ios-spike/p5-*.png`.

| Row | Verdict | Evidence |
| --- | ------- | -------- |
| Tap a tile / its chrome | **was broken, fixed** | `p5-tile-tap-fix.png`, `p5-block-detail.png` |
| Preset prev | passes, wraps Alpha -> AlphaBeta | `p5-preset-prev.png` |
| Preset next | passes, loads the chain | `p5-preset-next.png` |
| Preset name popover | passes; sits under the pill, the keyboard it raises covers only the lane below | `p5-preset-popover-keyboard.png` |
| Save popover vs the keyboard | passes; field and Save button both above the keyboard | `p5-preset-save-popover.png`, `p5-preset-saved-alpha.png` |
| New | passes; clears the chain and greys itself out (it resets directly, there is no popover to check) | `p5-preset-new.png` |
| Preset list scroll on touch | passes; a swipe moves the list and reorders nothing | `p5-preset-list-long.png`, `p5-preset-list-scroll.png` |
| Preset reorder on touch | passes; hold the grip, then drag | `p5-preset-reorder-before.png`, `p5-preset-reorder-after.png` |
| The two "drag" hint strings | fixed | see the section above |
| Tuner open | passes | `p5-tuner-open.png` |
| Tuner close | passes, both `X` and swipe down | `p5-tuner-swipe-dismiss.png` |
| Chain reorder on touch | passes; bypassed block moves slot 1 -> 2 | `p5-chain-reorder-before.png`, `p5-chain-reorder-after.png` |
| Swipe over a tile scrolls the lane | passes | `p5-lane-scroll.png` |
| Undo / redo a reorder | passes both ways | `p5-undo-reorder.png`, `p5-redo-reorder.png` |
| Remove, then undo | passes for a block loaded this run | `p5-block-remove.png`, `p5-undo-remove.png` |
| Copy / paste, then undo | passes; Paste appears in the slot menu only once the clipboard holds a block | `p5-tile-menu.png`, `p5-slot-menu-paste.png`, `p5-paste.png`, `p5-undo-paste.png` |
| Mono / stereo toggle | passes; two lanes, pan rail, ALIGN and Balance | `p5-stereo-two-lanes.png` |
| Stereo two-lane layout | fixed, tiles now scale | `p5-stereo-tiles-after.png` |
| Spread advanced deck on hold | passes | `p5-spread-advanced.png` |
| Align advanced deck on hold | passes | `p5-align-advanced.png` |
| Per-block EQ faders | passes; drag lifts the 100 Hz band and the response redraws | `p5-block-eq.png`, `p5-block-eq-drag.png` |
| Per-block EQ curve | passes; dragging a dot selects the band and sets its gain | `p5-block-eq-curve.png` |
| Block swap | passes; opens SELECT TONE for that block | `p5-block-swap.png` |
| Block remove | passes (row above) | `p5-block-remove.png` |
| Block info / share | **not tested** | both are `{!isLocal && ...}` in `ChainBlock`, so they exist only for a catalogue tone, which needs the sign-in |

**One more thing worth writing down.** Undo of a *remove* first came back as
"Download failed / Retry". The log said
`Local model file missing or unreadable: file:///.../Application/1060BB2C-.../LocalModels/...`
while the app was by then running out of `5890C095-...`: the reinstall had
rotated the data container, and the preset carried an absolute path into the
old one. The cached `.nam` was present under the new container. Re-run with a
block loaded in the same session, undo restores it intact. Recorded in
`docs/ios.md` under Known gaps; it is not a touch problem and not P5's to fix.

## P6 Bluetooth MIDI

**No code was needed: the feature is already there, and it predates the
spike.** `MidiInputsSection` renders a **Bluetooth MIDI** button under the
input list whenever `state.btMidiAvailable`; that flag is
`BluetoothMidiDevicePairingDialogue::isAvailable()`, set in
`StandaloneAudioSettings::getState`, and the button calls the
`openBluetoothMidiPairing` native function, which is exactly

```cpp
if (!juce::BluetoothMidiDevicePairingDialogue::isAvailable())
  return makeResult("Bluetooth MIDI isn't available on this system.");
juce::BluetoothMidiDevicePairingDialogue::open();
```

`git log -S` puts all three pieces in `259a018`, the initial open-source push,
so there is nothing iOS-specific to add and nothing to gate: iOS is
Standalone-only, which is the only build that renders this section at all.

**The plist strings are present**, and were already:
`plugin/CMakeLists.txt` sets `BLUETOOTH_PERMISSION_ENABLED TRUE` with
`BLUETOOTH_PERMISSION_TEXT`, and the built app carries both keys -

```
$ PlistBuddy -c Print build-ios/.../TONE3000.app/Info.plist | grep -i blue
    NSBluetoothAlwaysUsageDescription = TONE3000 uses Bluetooth to find and pair Bluetooth MIDI controllers.
    NSBluetoothPeripheralUsageDescription = TONE3000 uses Bluetooth to find and pair Bluetooth MIDI controllers.
```

**The dialogue cannot be opened on the Simulator, and the button cannot even
appear there.** `juce_BluetoothMidiDevicePairingDialogue_ios.mm` opens with
`#if ! TARGET_IPHONE_SIMULATOR` and the simulator branch is

```cpp
bool BluetoothMidiDevicePairingDialogue::isAvailable()  { return false; }
```

so `btMidiAvailable` is false there and `MidiInputsSection` hides the button by
design. Confirmed on the Simulator: System Settings > MIDI Inputs lists
"Rede Session 1" (the network session) and shows no Bluetooth row
(`p6-midi-settings.png`). This is JUCE's decision, not ours, and there is no
way around it short of shimming a fake dialogue, which would be new code that
proves nothing.

What *is* proved is that the real implementation compiles into the device
build, where `TARGET_IPHONE_SIMULATOR` is 0 and `isAvailable()` becomes
`NSClassFromString(@"CABTMIDICentralViewController") != nil`: the device
Release build below is green with `juce_audio_utils` linking CoreAudioKit.
Whether the sheet actually draws over the WKWebView, and pairing itself, are
for the owner on the iPad.

## Handoff

State as of the tip of `ios-spike`. Everything below is either done and
verified as described, or explicitly not started. The two older Handoff
sections above this one are historical snapshots and are superseded.

**Read `docs/ios.md` first.** It is the PR-facing document: build, install,
touch rules, the touch verification table, the platform traps, known gaps.
This file is the working diary and must not go upstream; it carries machine
paths and device identifiers.

### Done

| Item | State |
| ---- | ----- |
| M0-M5, hotfix, P1, P2 | green (see the milestone sections above) |
| P3 Files import | answered except the drag itself |
| P4 audio settings + OAuth page | green as far as sign-out allows |
| P7 items 1-5, tile-row scaling, haptics bridge | green (the buzz itself is unverified) |
| G6 review fixes | all 14 done |
| **P5** | green, one blocker fixed; see the row table in this file and the short table in `docs/ios.md` |
| **P6 Bluetooth MIDI** | already implemented upstream, plist confirmed, **not verifiable on the Simulator** |

### What P5 actually changed

1. **The blocker.** Every tap on a loaded chain tile was dead - the block did
   not open and power / `...` / swap / trash did nothing - because dnd-kit
   marks the tile wrapper `role="button"` and P7 item 4's 44 pt `::after`
   expander therefore covered the whole 249 px tile and took the tap. Only
   `pointerdown` reached the wrapper, so the press-and-hold menu still worked
   and hid it through all of P7. One CSS rule now excludes
   `[role='button'][aria-roledescription='draggable']`.
2. **Stereo tiles scale** under the same three-across rule as mono
   (`laneTileSize(lane, rows, design)`): 160 -> 209 design px, mono unchanged
   at 249. `StereoPanRail` takes `tileSize` instead of hardcoding it.
3. **The two preset hint strings** say "touch and hold, then drag" on iOS.

Everything else on the P5 list was verified, not changed. `PresetBar` needed
no sensor work: it gives dnd-kit a `handleRef`, so only the grip activates a
drag and a swipe in the list scrolls, and the stock touch constraint is
already `Delay(250 ms, 5 px)`.

### Not proved, and by whom

**Needs the owner, on the iPad** (unchanged from the last handoff, plus two):

1. The haptic buzz on tile lift and drop.
2. 3-finger undo/redo and 4-finger app switching.
3. Knob double-tap reset (proved in a browser against the same bundle).
4. Dragging a `.nam` from Files onto a tile.
5. Whether iPadOS draws the home indicator over the app.
6. Sign-in, which unblocks Browse, its search field, Favorites, Created,
   loading any tone from the catalogue - **and with it the block info and
   share buttons, which `ChainBlock` renders only when `!isLocal`**.
7. A Scarlett in Settings > System Settings (see the P4 section).
8. **Bluetooth MIDI**: that the button appears at all, that the sheet draws
   over the WKWebView, and pairing. JUCE compiles the dialogue out under
   `TARGET_IPHONE_SIMULATOR`, so none of it can be seen here.

**Known fragility, not chased:** undo of a *remove* reloads the cached model
through an absolute path under the app data container. A reinstall rotates
that container, so a preset saved before one comes back as "Download failed /
Retry" even though the cached `.nam` is present under the new container. Not a
touch problem; recorded in `docs/ios.md` under Known gaps.

### Device state

Device `499F7A19-3719-5E37-972C-F7DF0CA30DC6` (owner's iPad Pro 12.9 6th gen)
holds the Release build of this tip, installed with `devicectl` and **not
launched** - launching is the owner's, since only the owner can complete the
magic-link sign-in. The three `.nam` files in `Documents` were listed before
and after the install and are byte-identical:

```
Documents/tone3000-66412-fender-vibroverb-1964-over-2-model-428320.nam           288 KB
Documents/tone3000-66413-two-rock-prototipo-signature-83-boost-model-428321.nam  288 KB
Documents/tone3000-66416-dumble-steel-string-singer-002-boost-model-428324.nam   288 KB
```

```sh
xcrun devicectl device info files --device 499F7A19-3719-5E37-972C-F7DF0CA30DC6 \
  --domain-type appDataContainer --domain-identifier com.bsaraiva.tone3000ios \
  --username mobile | grep Documents
```

### How to work on this safely

- **Reconfigure before every iOS build after a UI change**, and after every
  `npm run build`: `cmake --preset ios-simulator -DT3K_IOS_BUNDLE_ID=com.bsaraiva.tone3000ios`.
  The webview is collected by a configure-time glob and Vite hashes asset
  names, so without it you silently run the previous bundle. Confirm with the
  `Requested URL: /assets/main-*.css` line in `TONE3000.log`. **The macOS tree
  needs the same reconfigure** (`cmake -B build -S . -DCMAKE_BUILD_TYPE=Release`)
  or the regression build fails with "No rule to make target .../main-*.css".
- **Keep the bundle id override** on both device and simulator builds, or the
  iPad gets a second, empty app and the owner's Documents appear to vanish.
- **Never write scratch files into `plugin/webview`.**
- **Check the build's own exit line**, not the task notification.
- **Mark state before testing a gesture.** The tile glow follows the slot, not
  the block. Two markers that do work: bypass a block from its tile power
  button (filled chip, glyph at 0.35), or open the block, whose BLOCK view
  shows the model's file name.
- **A local `.nam` tile has no title and no artwork**, so two of them look
  identical. `Load files` puts every file into *one* block (that is the Load
  Folder shape); load one at a time to get separate blocks.
- Keep one simulator booted; do not touch simulators you did not create.
- When a gesture "does nothing" and you cannot see why, the fastest tool is a
  temporary global listener logging `pointerdown/up/mousedown/up/click` with
  the target tag and `clientX/Y` through `console.log`, which the native side
  forwards into `TONE3000.log`. That is what found the P5 blocker. Remove it
  again before committing.

### Commands

See `docs/ios.md` for build, install and log. Simulator udid for this work:
`332D5E88-B221-4285-A706-2895AF6CBD8C`.

Screenshots: the app is landscape-only, so on a portrait simulator it renders
into a 1366x999 CSS band scaled to the 1024 pt width and letterboxed. A raw
`simctl io screenshot` is 2048x2732; a centred `sips -c 1530 2048` crop is
exactly the app.

### Next

Nothing on the numbered plan is outstanding. What is left is the owner's list
above, and then the PR: `docs/ios.md` is the document that goes with it, and
this file does not.


## P8 The rotating container (the last Known gap)

**Root cause.** `stashLocalBytes` writes the stash copy's *absolute* path into
the model's `model_url`, and that tone JSON is what gets persisted: in
`.t3kpreset` files, in `getStateInformation`, and in every undo snapshot. On
iOS the app data container's UUID rotates on every reinstall **and every app
update**, so all of those paths name a directory that no longer exists.

Presets and project state survive it anyway, because they embed the model
bytes (`ModelCache`) and the restore seeds `block->modelCache` from them.
Undo snapshots are settings-only (`captureChainSnapshot()` defaults to
`includeModelData = false`), so undo of a *remove* is the one path that has
to go back to the file - and it was the one that broke. Same for a Retry, and
for switching to a local model whose bytes were never loaded.

**Fix.** One pure function, `TONE3000Processor::resolveLocalModelFile(root,
url)`: a stored path that still exists is returned untouched; otherwise the
file *name* is re-rooted under the current stash folder. Stash names are
content hashes in a flat directory, so the name is the stable token and the
re-root is exact, not a guess. Two callers, `fetchModelFromUrl` and
`refreshLocalStashCopy`. **Not gated on `JUCE_IOS`**: on desktop the root
never moves, so the fallback yields the path that was just probed and the
outcome is unchanged. The persisted form is untouched (still an absolute
`file://` URL), which is what keeps old presets working and leaves the UI's
`model_url.startsWith('file:')` and the loader's `.nam` extension sniff alone.

**Proof, on the Simulator.** The container had already rotated twice between
sessions, which is the real-user shape: presets on disk name container
`1060BB2C-F324-4E27-AEA3-37BE921A3204`, and the run happened under
`F3B3E9B8-...` and then `694EC1AE-...` after an `uninstall` / `install` with
`Documents` and `Library` copied into the new container.

Before, on the tip build - load preset "Alpha", remove a block, undo:

```
[Restore] Block f606df9f... tone 0 model 1162749454 (needs fetch) queued for load
[ModelLoader] Local model file missing or unreadable: file:///.../Application/1060BB2C-.../LocalModels/a3dd5e40b5d8ad01-294666.nam
[ModelLoader] Load failed for block f606df9f..., showing retry
```

with `a3dd5e40b5d8ad01-294666.nam` present under the current container all
along. After, same steps, one more rotation:

```
[Restore] Block f606df9f... tone 0 model 1162749454 (needs fetch) queued for load
[ModelLoader] Preparing NAM model: tone3000-65976-fender-vibroverb-1964-model-443383.nam (294666 bytes)
[ModelLoader] NAM model prepared, model sample rate: 48000
```

Three tiles back, no retry badge, CPU 2.7% -> 4.1%. The preset itself loaded
in both builds (`(cached)` - the embedded bytes), which narrows the original
Known gap's wording: it was never the preset, it was the undo.

Evidence: `docs/ios-spike/p8-preset-alpha-loaded-before.png`,
`p8-undo-remove-retry-before.png`, `p8-before-unfixed.log`,
`p8-undo-remove-restored-after.png`, `p8-after-fixed.log`.

Unit test: `LocalLoadTest.StashUrlResolvesUnderTheCurrentRoot`. Full suite
130/130 green, macOS Release regression build exit 0.

**Not proved.** A fresh `.nam` load and preset *save* followed by a rotation
was not re-run; the proof used presets already on disk from two container
generations back, which exercises the same resolver on the harder (legacy
absolute) input. The Retry button itself was not tapped, and none of this was
run on the owner's iPad. The mic prompt returns after a reinstall and was
declined, which adds the "Microphone access is off" banner to the after
screenshots and shifts the layout ~44 pt down.

## Open issues

- The redirect URI needs no registration on this account (no restrictions
  set), so the `juce://` origin question is moot here. An account that does
  restrict URIs would still have to register whichever origin the iOS
  WKWebView build serves.
- Sign-in stops at the magic-link email, which only the owner can complete,
  so nothing behind the login is tested on iOS: the Browse catalogue, its
  search field, Favorites and Created.
- AUv3 is out of scope; the Standalone is the only iOS target.
- This file is the working diary. It carries machine paths and device
  identifiers and must not go into the upstream PR; `docs/ios.md` is the
  PR-facing document.
