#pragma once

#include <juce_core/juce_core.h>

/**
 * WKWebView's own interactive navigation gestures, iOS only.
 *
 * JUCE never sets `allowsBackForwardNavigationGestures`, so the swipe in from
 * the left edge does nothing on the in-app tone3000.com pages: the plugin UI
 * supplies that gesture itself in React, but React is not running once the
 * view has navigated away. Turning the platform's own gesture on gives the
 * remote pages the same swipe-back the rest of the app has, alongside the
 * visible Back button in IosBrowserChrome (the HIG rule: never a gesture
 * alone). Same platform-shim pattern as Haptics and IosAudioRoute.
 */
namespace IosWebViewGestures {

#if JUCE_IOS
/**
 * Enable back/forward swipes on the WKWebView under `nativeViewHandle` (a
 * `UIView*`, from `juce::ComponentPeer::getNativeHandle`). Walks the subview
 * tree because JUCE owns the WKWebView privately. Safe to call repeatedly and
 * before the view exists: a miss is a silent no-op.
 */
void enableBackForwardSwipes(void* nativeViewHandle);
#else
inline void enableBackForwardSwipes(void*) {}
#endif

}  // namespace IosWebViewGestures
