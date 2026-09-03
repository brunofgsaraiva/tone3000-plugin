#pragma once

/**
 * Taptic feedback for the tile drag (iOS only; a no-op everywhere else).
 * UIKit has no JUCE wrapper, so this is the same platform-shim pattern as
 * AudioPermissions: one header, one ObjC++ implementation.
 */
namespace Haptics {

/** `heavy` on lift, `light` on drop. Unknown names fall back to medium. */
void impact(const char* weight);

}  // namespace Haptics
