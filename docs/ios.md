# iOS (iPad) build

Standalone-only iPad port of the plugin: the same C++ and the same React UI,
with every difference behind `#if JUCE_IOS` (C++) or
`window.__T3K_PLATFORM__ === 'ios'` / `pointerType === 'touch'` (UI). Desktop
behaviour is unchanged. AUv3 is out of scope; iPhone is untested.

Deployment target iOS 16. Landscape only.

## Build

The UI is embedded as JUCE binary data, so it is built first.

```sh
cd ui && npm ci && npm run build && cd ..

# Simulator
cmake --preset ios-simulator
cmake --build build-ios --config Release --target TONE3000_Standalone -- -sdk iphonesimulator

# Device
cmake --preset ios-device
cmake --build build-ios-device --config Release --target TONE3000_Standalone -- \
  -sdk iphoneos -allowProvisioningUpdates
```

Build **Release** on the Simulator. A Debug iOS build points the WebView at
`http://localhost:5173/`, so it shows a dead page and logs "navigation failed".

`-DT3K_IOS_BUNDLE_ID=<id>` signs under your own identity. Changing it on a
device that already holds the app gives a fresh, empty Documents folder, so
keep it stable once models are loaded. Add
`-DCMAKE_XCODE_ATTRIBUTE_DEVELOPMENT_TEAM=<id>` if Xcode cannot pick your team.

**Reconfigure after every UI change.** `plugin/CMakeLists.txt` collects the
webview with `file(GLOB_RECURSE)`, which runs at configure time, and Vite's
asset filenames are content-hashed. Without a reconfigure the app keeps
serving the previously embedded bundle and looks like your change did nothing.
The requested asset name in the app's log tells you which bundle is running.

## Install and log

```sh
xcrun simctl install <udid> build-ios/plugin/TONE3000_artefacts/Release/Standalone/TONE3000.app
xcrun simctl launch <udid> <bundle-id>

# The app's own log: console.* from the WebView is forwarded into it, which
# is the most useful debugging channel on both Simulator and device.
tail -f "$(xcrun simctl get_app_container <udid> <bundle-id> data)/Library/TONE3000/TONE3000.log"
```

Simulator screenshots come out portrait while the app renders landscape.

## Touch rules

| gesture | result |
| ------- | ------ |
| tap a tile | open the block |
| swipe over a tile | scroll the chain lane |
| hold 250 ms, then drag | reorder |
| hold, release without moving | tile menu at that point |
| `...` on a tile | the same menu, visibly |
| hold on the Spread / Align group | the advanced deck (desktop: right-click) |
| press a control | its help in the info bar; release clears it |
| drag a knob | adjust, with the value in a bubble above it |
| double tap a knob | reset to default |
| swipe in from the left edge | back, on BLOCK and SELECT TONE |
| swipe down | dismiss the Tuner and Settings |

No gesture is the only route to anything: every action above also has a
visible control, per the HIG.

Every touch target meets 44 pt through one rule in `index.css` under
`html.t3k-ios`: an invisible `::after` at `max(100%, 44px)`, centred and out
of flow, so no layout changes.

## Platform notes worth knowing

- **Picker results must be read through security-scoped URLs.** A file chosen
  outside the app container is unreadable without
  `startAccessingSecurityScopedResource`. A test with the file *inside* the
  container passes and proves nothing.
- **WebKit replays a mouse event pair after every touch**, aimed at the
  element just tapped and landing after `pointerup`. Anything that clears
  state on release has to ignore that replay.
- **`pointercancel` is reported at 0,0.** The page opts into panning, so
  WKWebView takes swipes over and ends them with a cancel carrying no useful
  position, and no `pointerup`. Swipe gestures use touch events instead.
- **A control that takes pointer capture retargets its release**, so a release
  that must be seen regardless is watched on `window` in the capture phase.
- **`env(safe-area-inset-*)` is 0 on all sides** here: the WKWebView is
  already inset (1366x999 in a 1024 pt screen), so the faceplate clears the
  home indicator without the page doing anything.
- `xcrun simctl privacy grant microphone` does not suppress the prompt;
  `AVAudioSession` still asks once.

## Known gaps

- Load Folder is a multi-select on iOS: a security-scoped *directory* cannot
  be enumerated, so the picker returns files instead.
- The double-tap knob reset is proved in a browser against the same bundle,
  not on a device: two taps cannot be driven inside 300 ms through the
  Simulator automation bridge.
- Split View is untried; `REQUIRES_FULL_SCREEN` stays until it is.
