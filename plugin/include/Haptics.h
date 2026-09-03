#pragma once

#include <juce_core/juce_core.h>

/**
 * Taptic feedback for the tile drag (iOS only; a no-op everywhere else).
 * UIKit has no JUCE wrapper, so this is the same platform-shim pattern as
 * AudioPermissions: one header, one ObjC++ implementation.
 */
namespace Haptics {

/** `heavy` on lift, `light` on drop. Unknown names fall back to medium. */
#if JUCE_IOS
void impact(const char* weight);
#else
// Header-only no-op: Windows and Linux never compile the .mm, and the
// desktop link needs the symbol (caught by the fork CI, 2026-09-03).
inline void impact(const char*) {}
#endif

}  // namespace Haptics
