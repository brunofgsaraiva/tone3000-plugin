# iOS debug bridge (dev only, fork local)

A tiny HTTP server inside the iOS app so a QA harness on the Mac can see and
drive the running app on a physical iPad over the devicectl USB tunnel.

This is fork-local scaffolding for our own testing. It is not upstream
material and must never reach a build anyone else runs.

## What it must never be used for

- Never turn `T3K_DEBUG_BRIDGE` on in anything shipped, shared, uploaded to
  TestFlight, or handed to another person. The server has no authentication.
- Never put it in an upstream-bound branch or pull request.
- Never use it to reach an iPad you do not own, and never expose port 9999
  beyond the USB tunnel and loopback (the bridge already refuses other peers,
  but do not lean on that as a security boundary).
- It is a QA aid, not a feature: no product behaviour may depend on it.

## Build

Everything is behind the CMake option `T3K_DEBUG_BRIDGE` (OFF by default) and
behind `#if JUCE_IOS && defined(T3K_DEBUG_BRIDGE)` in the sources, so a normal
build compiles none of it. Configure the device build with the option on, and
with a dev bundle id so it never replaces the real app:

```
cmake --preset ios-device \
  -DT3K_DEBUG_BRIDGE=ON \
  -DT3K_IOS_BUNDLE_ID=com.example.tone3000ios.dev \
  -DCMAKE_XCODE_ATTRIBUTE_DEVELOPMENT_TEAM=<team id> \
  -DCMAKE_XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY="Apple Development"

cmake --build build-ios-device --config Release --target TONE3000_Standalone \
  -- -sdk iphoneos -allowProvisioningUpdates
```

Configuring prints a warning that the bridge is on. Reconfigure before every
iOS build; a stale cache produces a build that does not match the tree.

Build the web UI first (`cd ui && npm run build`), otherwise the app launches
on a blank page: the bridge will happily tell you so via `/log`.

Then install and launch:

```
xcrun devicectl device install app --device <udid> \
  build-ios-device/plugin/TONE3000_artefacts/Release/Standalone/TONE3000.app
xcrun devicectl device process launch --device <udid> com.example.tone3000ios.dev
```

## Endpoints

The server binds all interfaces on port 9999 and starts when the editor is
first parented. It speaks HTTP/1.0 and closes each connection. Requests from
anything that is not the USB tunnel, loopback or a private address are
refused with 403.

| Endpoint | Body / query | Returns |
| --- | --- | --- |
| `GET /healthz` | | `{ok, app, editor, webview, webviews[]}`; `webviews` lists each WKWebView's URL and size, which is how you spot a blank one |
| `GET /screenshot` | | `image/png` of the WKWebView (`takeSnapshotWithConfiguration`) |
| `POST /js` | `{"code": "..."}` | `{ok, result}` where `result` is the JSON-encoded value of the expression |
| `POST /tap` | `{"x": .., "y": ..}` | `{ok, result}` describing the element that was hit |
| `GET /log` | `?tail=N` | the last N lines of TONE3000.log as `text/plain` |

`/js` is the workhorse: DOM queries, reading UI state, scrolling things into
view. `/tap` is written in terms of `/js`: it finds the element at the point
and dispatches `pointerdown`, `touchstart`, `mousedown`, `pointerup`,
`touchend`, `mouseup`, `click` with `pointerType: 'touch'`, so the app's own
touch handlers run rather than a synthetic native touch.

Coordinates are CSS pixels in the web view. The screenshot comes back at the
device's native scale (2x on the iPad), so halve screenshot pixels to get tap
coordinates, or better, ask `/js` for `getBoundingClientRect()` and tap the
centre it gives you.

## Script

`script/ipad-qa.py` resolves the device's tunnel address itself (via
`xcrun devicectl device info details`, whose `connectionProperties.tunnelIPAddress`
is an IPv6 address) and talks to the bridge:

```
script/ipad-qa.py healthz
script/ipad-qa.py screenshot out.png
script/ipad-qa.py js 'document.querySelectorAll("button").length'
script/ipad-qa.py tap 318 446
script/ipad-qa.py log 100
```

Pass `--device <udid>` or set `T3K_IOS_DEVICE`; with exactly one paired device
it picks that one.

## Implementation notes

- `plugin/src/DebugBridge.cpp` holds the server, `plugin/src/DebugBridgeWebView.mm`
  the WKWebView work (snapshot, `evaluateJavaScript`), both hopping to the main
  queue and blocking the server thread on a semaphore.
- The listener is a hand-rolled dual-stack `AF_INET6` socket rather than
  `juce::StreamingSocket`, because JUCE's socket is IPv4-only (`juce_Socket.cpp`
  opens `AF_INET`) and the tunnel address devicectl hands the Mac is IPv6. A
  JUCE listener never sees the harness at all.
- The editor's view tree can hold more than one WKWebView, and the spare sits
  on `about:blank`. The bridge picks the largest one that has actually loaded
  something; `/healthz` lists them all so a wrong pick is visible rather than
  puzzling.
