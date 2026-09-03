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
| tile menu, **Duplicate** | clone the block (desktop: option-drag) |
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

## The in-app tone3000.com pages

The OAuth flows (Login, Browse) navigate the one main webview away from the
plugin UI to tone3000.com. Desktop keeps its window title bar and asks the
site for its own `menubar=true` strip, which carries a close button, so
backing out is always one click away. An iPad has neither, and the site's
strip is a ~24 px target that is not on every step of the sign-in flow, so
the login page was a one-way door: the plugin UI was gone until the app was
relaunched.

The app therefore draws its own strip rather than relying on the site's, and
does not ask for `menubar` on iOS (two navigation bars would stack):

| control | does |
| ------- | ---- |
| `‹` `›` | the webview's own back / forward |
| `↻` | reload |
| **Close** | back to the plugin UI |
| swipe in from the left edge | back, through WKWebView's own gesture |

Every button is 44 pt. The strip appears only while the view is off the
plugin UI: `GuardedWebView::onRemotePageChanged` reports both edges of that
transition and nothing attaches to it off iOS.

Close navigates home with **no** OAuth query. The site's cancel redirect
carries the flow's `state`, and forging one fails the callback's state check
(`state_mismatch`); a plain load mounts React fresh, which is the `idle`
phase by construction, so no busy overlay hangs. Chain state lives natively
and tokens in localStorage, so the reload costs nothing, the same reasoning
as `pageLoadHadNetworkError`'s recovery.

The left-edge swipe here is the platform's, not the app's: React is not
running once the view has navigated away, so `useEdgeSwipeBack` cannot cover
these pages. `IosWebViewGestures` sets `allowsBackForwardNavigationGestures`
on the WKWebView instead, which JUCE never does.

**The login page's pre-filled email and auto-sent code are the site's, not
ours.** The app sets neither `otp_only` nor `login_hint`; both come from the
tone3000.com session on that device. Signed out on the Simulator the page
opens with an empty field and a disabled **Send Code**. The account pill is
one button opening one menu (Settings, Gestures, Login/Logout), so no single
tap enters a login.

### The six-box code entry, fork-local mitigation

**This is a workaround in our app for a bug in the site. The proper fix
belongs on tone3000.com and should replace this the moment it lands.**

The code step of the email sign-in renders the six digits as six separate
single-character inputs. A desktop keyboard types into them one by one and
they behave. On iOS the keyboard's one-time-code suggestion, and pasting the
code out of the mail app, deliver all six characters to whichever box has
focus, so only the first fills and the login cannot be completed on the iPad.

`EditorWebViewSetup.cpp` therefore injects a second iOS-only user script,
guarded at runtime by `location.hostname` so it only ever runs on
tone3000.com. It finds a run of four to eight single-character inputs sharing
a parent, and on a paste, or on a single input event carrying more than one
digit, spreads the digits across the boxes in order, writing each through the
native `HTMLInputElement.value` setter and dispatching `input` and `change`
so the site's React state sees a real edit. It also tags the first box with
`autocomplete="one-time-code"` and `inputmode="numeric"` so iOS offers the
suggestion at all, and re-tags after re-renders through a cheap
`MutationObserver`. The whole script is wrapped in `try`/`catch` and sets
`window.__t3kOtpHelper` once, so it can neither throw into the page nor
double-install.

Two constraints shape it. JUCE joins every `withUserScript` into one
`WKUserScript` at document start, main frame only, so the script defers its
own DOM work to `DOMContentLoaded` rather than asking for an injection time
JUCE does not expose; and it sits last in the chain so its marker log passes
through the console-forwarding shim. That marker,
`t3k: otp paste helper active on <host>`, is the cheapest confirmation that
it is live: open avatar > Login on the Simulator and grep the app log for it.

The distributing logic is covered by `ui/test/otpPaste.test.ts`, which
extracts the script from the C++ between its `__T3K_OTP_HELPER_*` markers and
runs that exact source against a small fake DOM, so the test cannot drift
from what ships. Not proved here: the real OTP page's DOM was never seen
(reaching it needs a real address and a real code), so the selector is
written against the shape the owner described and the owner validates it on
the device.

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

## Factory presets

Desktop gets the seven `.t3kpreset` files from its installer, into a shared
read-only directory `PresetManager` scans as the factory section. iOS has no
installer and no shared directory, so a fresh install showed "No presets yet".

The app bundle carries them instead: the Standalone target copies
`resources/factory-presets` into `Resources/FactoryPresets` and
`defaultSystemFactoryDir` points there under `JUCE_IOS`. Read-only, which is
the contract that directory already had, and a user `Factory` folder still
overlays it exactly as on desktop. They embed their model bytes, so they load
signed out and offline.

## Session restore

iOS never sends `systemRequestedQuit`, which is the standalone wrapper's only
`savePluginState` call site: the OS backgrounds an app and kills it whenever
it likes, and `shutdown()` saves only the audio-device settings. So nothing
was ever written and every relaunch opened on an empty chain, local blocks and
catalogue blocks alike. It read like local models being dropped on restore;
it was no restore at all.

`IosAppLifecycle` observes `UIApplicationDidEnterBackground` and
`UIApplicationWillTerminate`, and the editor saves through the wrapper's own
`savePluginState` on either, then flushes the `PropertiesFile`: its auto-save
timer will not fire on a process the OS is about to suspend.

The serialization was never the problem. `captureChainSnapshot(true)` embeds
the model bytes for local and catalogue blocks alike, and the round trip is
already covered by the state tests; only the trigger was missing.

Known limit: a kill with no background transition first (a debugger stop, a
foreground crash) still loses the session, because there is no notification
to hang the save on.

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
| In-app browser chrome | Login opens with the 44 pt strip; **Close** returns to the plugin UI with no error overlay |
| Factory presets | the TONE3000 section lists all seven; Matchless Crunch loads both blocks and processes, signed out |
| Tile menu **Duplicate** | clones a loaded block; undo removes the clone |
| Session restore | local `.nam` block, Home, `simctl terminate`, relaunch: the block comes back loaded |
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
- The info bar's stale-hint fix is proved only in the negative: after the
  change the bar is empty on the screen you navigate to, but the original
  stale pin could not be forced on the Simulator, which cannot reliably
  produce the interrupted drag that strands it.
- Dragging a `.nam` from Files onto a tile is untested. The receiving code is
  the same HTML5 drop path the desktop uses, and the app does window alongside
  Files, but the drag could not be driven from the automation.

## Desktop CI evidence

The upstream `Build Plugin` workflow was dispatched on the fork at `331e3bc`: macOS Universal, Windows x64 and Linux x64 all green (run 33705530505). The first run at `956cb81` failed on Windows and Linux with an unresolved `Haptics::impact`; the no-op is now header-only for non-iOS builds.
