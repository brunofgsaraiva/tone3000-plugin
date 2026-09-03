#pragma once
#include <juce_gui_extra/juce_gui_extra.h>

// Dev-only QA bridge. Never shipped: the whole file collapses to nothing
// unless the build was configured with -DT3K_DEBUG_BRIDGE=ON (OFF by default),
// and even then only on iOS. See docs/ios-debug-bridge.md.
#if JUCE_IOS && defined(T3K_DEBUG_BRIDGE)

namespace DebugBridge {

/**
 * Start the QA HTTP server on port 9999, all interfaces, background thread.
 * Idempotent: a second call while running is a no-op.
 */
void start();

/** Stop the server and join its thread. Idempotent. */
void stop();

/**
 * Hand the bridge the editor's peer native handle (a UIView*), from which the
 * hosted WKWebView is found. Call from the message thread whenever the peer
 * appears or changes; pass nullptr when the editor goes away.
 */
void setRootView(void* uiView);

// --- Implemented in DebugBridgeWebView.mm ------------------------------------
// Both hop to the main queue and block the caller until it answers, so they
// must be called from a background thread (the server thread), never the
// message thread. Return false and fill `error` on failure.

/** Evaluate `code` in the WKWebView; `resultJson` gets the JSON-encoded value. */
bool evaluateJavaScript(void* rootView, const juce::String& code,
                        juce::String& resultJson, juce::String& error);

/** Snapshot the WKWebView into PNG bytes. */
bool snapshotPng(void* rootView, juce::MemoryBlock& png, juce::String& error);

/** True when a WKWebView can be found under `rootView`. */
bool hasWebView(void* rootView);

/** URLs of every WKWebView under `rootView`, for diagnosing which one is which. */
juce::StringArray webViewUrls(void* rootView);

}  // namespace DebugBridge

#endif  // JUCE_IOS && T3K_DEBUG_BRIDGE
