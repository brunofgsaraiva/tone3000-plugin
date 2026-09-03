#pragma once

#include <functional>
#include <juce_core/juce_core.h>

/**
 * App-backgrounding notification, iOS only.
 *
 * The standalone wrapper saves its plugin state from `systemRequestedQuit`,
 * which iOS never sends: the OS backgrounds an app and then kills it whenever
 * it likes, and `shutdown()` does not save. So on iPad nothing was ever
 * written and every relaunch started on an empty chain, local blocks and
 * catalogue blocks alike. UIKit has no JUCE wrapper for the lifecycle
 * notifications, so this is the same platform-shim pattern as Haptics and
 * IosAudioRoute: one header, one ObjC++ implementation, header-only no-op
 * everywhere else.
 */
namespace IosAppLifecycle {

#if JUCE_IOS
/**
 * Call `onBackground` on the message thread whenever the app enters the
 * background or is told it will terminate. Returns an opaque token that must
 * be passed to `stopObserving` before the callback's captures die.
 */
void* observeBackgrounding(std::function<void()> onBackground);
void stopObserving(void* token);
#else
inline void* observeBackgrounding(std::function<void()>) { return nullptr; }
inline void stopObserving(void*) {}
#endif

}  // namespace IosAppLifecycle
