#include "Haptics.h"

#include <juce_core/juce_core.h>

#if JUCE_IOS
#import <UIKit/UIKit.h>
#endif

#include <cstring>

namespace Haptics {

#if JUCE_IOS

void impact(const char* weight) {
  const auto style = std::strcmp(weight, "light") == 0 ? UIImpactFeedbackStyleLight
                                                       : UIImpactFeedbackStyleMedium;
  // Generators are cheap and one-shot; keeping one alive to `prepare` it early
  // would only matter for a gesture we do not have (a continuous scrubber).
  UIImpactFeedbackGenerator* generator =
      [[UIImpactFeedbackGenerator alloc] initWithStyle:style];
  [generator impactOccurred];
  [generator release];
}

#endif

}  // namespace Haptics
