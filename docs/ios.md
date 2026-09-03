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

The player-facing wording of this table lives in
`ui/src/components/gestureGuide.ts` and is what the Gestures sheet renders
(see Onboarding). Reword a rule in both places or in neither.

Every touch target meets 44 pt through one rule in `index.css` under
`html.t3k-ios`: an invisible `::after` at `max(100%, 44px)`, centred and out
of flow, so no layout changes.

## Onboarding

The gestures above are not discoverable on their own, so the app explains them
once. One sheet, no per-screen overlays: **Gestures** lists every touch rule as
a glyph and one sentence in the player's own language, in the same black
takeover shell as Settings, dismissed by the `X` or by swiping down.

Three ways in, all `IS_IOS` only, so desktop renders nothing and grows no menu
item:

- automatically, the first time the UI boots on a device with no stored flag;
- **Gestures** in the account menu, next to Settings;
- **Show gestures** in Settings > Plugin Settings.

The flag is `t3k.gesturesSeen` in the webview's localStorage, through the same
`uiPreferences` store as the other per-machine view preferences, so it never
rides presets, undo or automation. It is set when the sheet opens, not when it
closes: a sheet swiped away or killed with the app has still been shown. The
**Show on next launch** toggle inside the sheet clears it again.

The decision to auto-open is the pure `shouldAutoOpenGestures(isIos, seen)` in
`ui/src/components/gestureGuide.ts`, covered by `ui/test/gestureGuide.test.ts`.

## Local import

One entry, not two. Desktop offers **Load File** and **Load Folder**; iOS
offers **Load files**, in both places local loading is reachable from: the
**On this iPad** section in SELECT TONE and the tile's `...` menu.

The collapse is not a simplification, it is what the platform gives. iOS has a
single document picker and it is multi-select, so the two desktop entries are
the same picker with the multi-select flag on or off. With it on, both desktop
outcomes are already reachable:

| picked | result | desktop equivalent |
| ------ | ------ | ------------------ |
| one file | a tone with one model, titled after the file | Load File |
| several files | one tone with a model each, natural-name ordered | Load Folder |

A separate "Load file" row would therefore open the same sheet with a
restriction and no new capability, and the HIG's shortest-sheet rule argues
against carrying it.

A folder cannot be the unit here: the picker can return a folder URL, but a
security-scoped directory has no listing API behind its bookmark, so a picked
folder is an unreadable handle. Native already reflects this: on iOS
`pickLocalToneFile(pickFolder = true)` asks for files with multi-select and
`loadLocalToneUrls` titles the result from the single file's name when exactly
one comes back. Only the UI changed; desktop's two entries are untouched,
behind `IS_IOS`.

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
- **`100vh` is not the viewport, and the document scrolled because of it.**
  The owner reported an unwanted vertical scroll that hurt navigation. It was
  real and it was global. This WKWebView lays out in a 1366x999 box, but
  `100vh`, `100dvh`, `innerHeight` and `visualViewport.height` all report 1024,
  the screen height: measured in the running app,
  `documentElement.clientHeight` was 999 against a `scrollHeight` of 1024. So
  `#root { height: 100vh }` built a root 25 px taller than the box holding it,
  html and body kept `overflow: visible`, and the whole document became
  scrollable by exactly that 25 px, on every screen: a vertical swipe anywhere
  shifted the entire UI, header and faceplate included. `overscroll-behavior:
  none` did not stop it and could not, because it only suppresses rubber-band
  on a scroll with nowhere to go and this scroll had somewhere to go. The fix
  is `height: 100%` (which chains from the initial containing block, i.e. the
  999 the engine actually laid out) plus `overflow: hidden` on html and body,
  so a document scroll is impossible rather than merely unnecessary. Inner
  containers keep their own scrollers and the swipe gestures are window-level
  touch listeners, so neither is affected. Verified on the Simulator with a
  vertical swipe on the chain, BLOCK, SELECT TONE with results, Settings and
  the Tuner: `scrollHeight` now equals `clientHeight` at 999, zero document
  scroll events fired on any screen, the Select Tone and Settings lists still
  scroll on their own, and swipe down still dismisses the Tuner.

- **The app data container's UUID rotates on every reinstall and every app
  update.** Any absolute path the plugin persisted then names a directory
  that no longer exists, and the only path it persists is a local model's
  stash URL, in the tone JSON that rides presets, the saved app state and
  undo snapshots. Undoing a *remove* was the visible casualty: it reloads
  the model from that URL (undo snapshots carry no embedded bytes) and came
  back "Download failed / Retry" with the file sitting there under the new
  container. Stash names are content hashes in one flat folder, so
  `resolveLocalModelFile` re-roots the stored file name under the current
  stash folder; a path that still exists is used as-is, which is every
  desktop case. Presets and project state were never affected: they embed
  the model bytes.
- **Bluetooth headphones cap the whole session at 16 or 24 kHz.** The owner
  hit this on the iPad with AirPods: `prepareToPlay: sampleRate=24000` and a
  sample-rate warning in Settings with nothing saying why. JUCE opens the iOS
  session as `PlayAndRecord` with `AllowBluetoothHFP`
  (`juce_Audio_ios.cpp`, `setAudioSessionCategory`), so a headset with a
  microphone wins the route and iOS refuses the requested 48 kHz. Two answers
  ship together, both in `IosAudioRoute` (the Haptics / AudioPermissions
  shim pattern, header-only no-op off iOS):
  - `disallowBluetoothHfp()` re-sets the session category without that one
    option, keeping every other option JUCE asked for, `AllowBluetoothA2DP`
    included, so Bluetooth output-only listening still works and only the
    low-rate headset *mic* route goes away. It is not a JUCE text patch:
    JUCE sets the category when it *opens* a device and never on its own
    route-change `restart()` path, so re-applying it on every device-manager
    change is enough and the JUCE tree stays untouched.
  - `isBluetoothRoute()` feeds `bluetoothRoute` in the settings state, and
    the UI turns that (or any session under 44.1 kHz) into one plain tip in
    Settings > System Settings, next to Sample Rate: use wired headphones,
    the iPad speaker, or a USB audio interface. The generic "runs lightest
    at 48 kHz" note is suppressed while it shows, so there is one
    explanation instead of two.
- `xcrun simctl privacy grant microphone` does not suppress the prompt;
  `AVAudioSession` still asks once.
- **`UIRequiresFullScreen` no longer opts an app out of multitasking** on
  iPadOS 26: a second app dragged from the Dock windows itself over this one
  regardless. The key is therefore not set. The app is not resized by it (the
  other app floats), so the layout is unaffected.

## Known gaps

- There is no folder import on iOS: a security-scoped *directory* cannot be
  enumerated, so the one **Load files** entry multi-selects the files instead
  (see Local import).
- The double-tap knob reset is proved in a browser against the same bundle,
  not on a device: two taps cannot be driven inside 300 ms through the
  Simulator automation bridge.
- Dragging a `.nam` from Files onto a tile is untested. The receiving code is
  the same HTML5 drop path the desktop uses, and the app does window alongside
  Files, but the drag could not be driven from the automation.

## Desktop CI evidence

The upstream `Build Plugin` workflow was dispatched on the fork at `331e3bc`: macOS Universal, Windows x64 and Linux x64 all green (run 33705530505). The first run at `956cb81` failed on Windows and Linux with an unresolved `Haptics::impact`; the no-op is now header-only for non-iOS builds.
