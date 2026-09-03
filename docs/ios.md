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

## Touch verification

Everything below was driven on the iPad Simulator against a Release build.
Local `.nam` models only: the catalogue needs a sign-in the port cannot
complete (see Known gaps).

| Area | Verdict |
| ---- | ------- |
| Tap a chain tile; power / `...` / swap / trash on it | fixed and passing. A 44 pt hit expander was landing on the tile wrapper, which dnd-kit marks `role="button"`, and swallowing every tap |
| Preset prev / next | steps and wraps |
| Preset name popover | opens under the pill, above the keyboard it raises |
| Save preset | popover and its field stay clear of the keyboard; saves |
| New | clears the chain, greys out once at the default |
| Preset reorder on touch | swipe scrolls the list; hold the grip, then drag, moves the row |
| Tuner | opens; closes by `X` and by swipe down |
| Undo / redo | covers reorder (both ways), remove and paste |
| Mono / stereo toggle | switches; two lanes, pan rail, ALIGN and Balance appear |
| Stereo two-lane layout | tiles scale with the same three-across rule as mono |
| Spread / Align, hold for the advanced deck | both decks open on a touch and hold |
| Per-block EQ | faders and curve dots both drag; the response redraws |
| Block swap / remove | swap opens SELECT TONE for that block; remove takes it out |
| Block info / share | **not tested**: both controls exist only for a catalogue tone |
| Bluetooth MIDI pairing | **not testable on the Simulator**: JUCE compiles the dialogue out under `TARGET_IPHONE_SIMULATOR`, so the button is hidden there. It is wired (System Settings → MIDI Inputs → **Bluetooth MIDI** → `BluetoothMidiDevicePairingDialogue::open()`) and the app carries `NSBluetoothAlwaysUsageDescription` |

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
- **`UIRequiresFullScreen` no longer opts an app out of multitasking** on
  iPadOS 26: a second app dragged from the Dock windows itself over this one
  regardless. The key is therefore not set. The app is not resized by it (the
  other app floats), so the layout is unaffected.

## Known gaps

- Load Folder is a multi-select on iOS: a security-scoped *directory* cannot
  be enumerated, so the picker returns files instead.
- The double-tap knob reset is proved in a browser against the same bundle,
  not on a device: two taps cannot be driven inside 300 ms through the
  Simulator automation bridge.
- Undoing a *remove* restores the block by reloading its cached model from an
  absolute path under the app container. Reinstalling the app rotates that
  container, so a preset saved before a reinstall comes back as "Download
  failed / Retry" even though the cached file is there under the new
  container. Seen on the Simulator across reinstalls; not seen for a block
  loaded in the same run.
- Dragging a `.nam` from Files onto a tile is untested. The receiving code is
  the same HTML5 drop path the desktop uses, and the app does window alongside
  Files, but the drag could not be driven from the automation.
