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

## Open issues

- The TONE3000 publishable key is a placeholder, so the catalogue and OAuth
  login are untested on iOS.
- The OAuth redirect URI on iOS is unknown. macOS uses
  `juce://juce.backend/index.html`; whether an iOS WKWebView build serves the
  same origin needs checking, and whichever origin it is has to be registered
  in TONE3000 Settings > API Keys.
- AUv3 is out of scope; the Standalone is the only iOS target.
