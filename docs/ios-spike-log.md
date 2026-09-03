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

## Handoff

State as of commit `5193cf1` on `ios-spike`. **Superseded**: P7 items 3 and
4 landed after it, so the table below is a snapshot, not current state. The
newest Handoff section at the end of this file is the live one.

### Done

| Item | State |
| ---- | ----- |
| M0 macOS baseline | green |
| M1 iOS configure | green (`cmake --preset ios-simulator`) |
| M2 Simulator compile | green |
| M3 Run on Simulator | green, UI boots from embedded resources |
| M4 Local `.nam` load | green (see the hotfix below; M4's own test was flawed) |
| M5 Physical iPad | green: signs, installs, launches, opens audio at 48 kHz |
| Hotfix: security-scoped URLs | green, tested across the real sandbox boundary |
| P1 Fill the screen + 44 pt hit areas | green |
| P2 Touch reorder | green, superseded by P7 item 2's gesture rule |
| P7 item 1a `...` button + menu rules | green |
| P7 item 1b On this iPad | green |
| P7 item 2 hold-to-lift, Move rows | green except haptics |

### Not started

- **P7 item 2, haptics.** Optional in the spec. Needs a small native bridge:
  a `#if JUCE_IOS` native function calling `UIImpactFeedbackGenerator`
  (`.medium` on lift, `.light` on drop), called from `ChainView`'s
  `onDragStart` / `onDragEnd`. Cheap; simply not reached.
- **P7 item 3.** Touch help in the info bar (`pointerdown` shows a control's
  help, release clears it) and a value bubble on knobs while dragging, plus
  double-tap to reset and a 44 pt knob hit area.
- **P7 item 4.** 44 pt for everything outside the two icon-button primitives
  (gear chips, stream tabs, preset arrows, slot `+`, account menu rows), safe
  areas (faceplate above the home indicator), left-edge swipe back, swipe
  down to dismiss the Settings and Tuner sheets, search field above the iOS
  keyboard.
- **P7 item 5.** Confirm no system gesture is intercepted (3-finger
  undo/redo, 4-finger app switch, edge swipes).
- **Tile-row scaling** (owner request). The lane fills the screen after P1
  but the tiles stay 224 design px, leaving black above and below the row.
  Scale the tile row and its `+` glyph to fill the lane with the design's
  margins, capped so four tiles still fit across 1366 pt with horizontal
  scroll, and keep BLOCK / SELECT TONE filling the same area.
- **P3** Files import parity: drag-and-drop of `.nam` / `.wav` from Files in
  Split View onto a tile, if WKWebView receives the drop. Folder import is
  already answered: iOS cannot enumerate a security-scoped directory, so
  Load Folder is multi-select there.
- **P4** Audio device settings through AVAudioSession: route, input channel,
  buffer size, sample rate. Verify the settings page renders and does not
  crash on the Simulator. The physical Scarlett test stays with the owner.
- **P5** Presets, tuner, undo/redo, stereo toggle, spread/align under touch.
  Partly done incidentally: the tuner opens, per-block power works.
- **P6** Bluetooth MIDI: enable `BluetoothMidiDevicePairingDialogue` from
  MIDI settings on iOS and confirm it opens on the Simulator.
- **OAuth sign-in check** (folded into P3/P4 by the coordinator): on the
  Simulator, account menu > Sign in should open the TONE3000 authorize page
  inside the same WebView and the `juce://` redirect should return to the
  app. Stop at the login page and screenshot; the login is a magic link to
  the owner. The real publishable key is already in `ui/.env` and the live
  Trending catalogue loads, so the key and network path are known good.

### Commands

```sh
cd /Users/bruno.saraiva/Developer/tone3000-plugin-ios
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

# UI (always rebuild after touching ui/, then rebuild the app)
cd ui && npx tsc --noEmit -p tsconfig.app.json && npx eslint src && npm run build && cd ..

# iOS Simulator, Release (Debug points the WebView at localhost:5173)
cmake --build build-ios --config Release --target TONE3000_Standalone -- -sdk iphonesimulator -quiet

# macOS regression, required after every item
cmake --build build --target TONE3000_Standalone -j 8

# install + launch
UD=332D5E88-B221-4285-A706-2895AF6CBD8C     # "QA-iPadPro12.9-6th", keep ONE simulator booted
xcrun simctl terminate $UD com.bsaraiva.tone3000ios
xcrun simctl install $UD build-ios/plugin/TONE3000_artefacts/Release/Standalone/TONE3000.app
xcrun simctl launch $UD com.bsaraiva.tone3000ios

# the app's log (the single most useful debugging channel)
DATA=$(xcrun simctl get_app_container $UD com.bsaraiva.tone3000ios data)
tail -30 "$DATA/Library/TONE3000/TONE3000.log"

# screenshots come out portrait; the app is landscape
xcrun simctl io $UD screenshot shot.png && sips -r 90 shot.png --out shot.png

# device (install only unless told otherwise; Documents must survive)
cmake --build build-ios-device --config Release --target TONE3000_Standalone -- \
  -sdk iphoneos -allowProvisioningUpdates
xcrun devicectl device install app --device 499F7A19-3719-5E37-972C-F7DF0CA30DC6 \
  build-ios-device/plugin/TONE3000_artefacts/Release/Standalone/TONE3000.app
xcrun devicectl device info files --device 499F7A19-3719-5E37-972C-F7DF0CA30DC6 \
  --domain-type appDataContainer --domain-identifier com.bsaraiva.tone3000ios --username mobile
```

### Driving the Simulator

The iPad is in the portrait device frame while the app renders landscape, so
tap coordinates need converting. With the screen 1366 x 1024 pt landscape and
the device frame 1024 x 1366 pt portrait, and a screenshot rotated 90 degrees
clockwise for reading:

```
portrait_x = landscape_y
portrait_y = 1366 - landscape_x
```

A long press is `control` with `action: touch_path` and two points at the same
coordinate separated by `dt_ms`.

### Traps already paid for

- **"Looks unchanged" is not evidence.** Two results were misread this way.
  M4 passed only because the `.nam` sat inside the app container, so the
  sandbox never had to be crossed; the device then failed. P2's first drag
  looked like a no-op but had worked, because both tiles held the same model
  and local tone tiles render an identical file glyph. **Mark state
  explicitly** before testing: bypass one block (dimmed glyph, lit power
  chip) so a reorder is visible, and put test files *outside* the app
  container when testing the picker.
- **Debug iOS builds load `http://localhost:5173/`.** Always build Release on
  the Simulator or you get a dead page and a confusing "navigation failed".
- **Pointer capture hides `pointerup`.** See P7 item 2 above.
- **`xcrun simctl privacy grant microphone` does not suppress the prompt**;
  `AVAudioSession.requestRecordPermission` still asks. Tap it once.
- **Never commit `ui/.env`.** It holds the real publishable key, is
  gitignored, and must not appear in reports or docs either.
- **Keep one simulator booted** and do not touch simulators you did not
  create.

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
