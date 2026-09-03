#include "IosAppLifecycle.h"

#if JUCE_IOS

#import <UIKit/UIKit.h>

#include <vector>

namespace IosAppLifecycle {

namespace {
struct Observation {
  std::vector<id> tokens;
};
}  // namespace

void* observeBackgrounding(std::function<void()> onBackground) {
  auto* observation = new Observation();
  auto* center = [NSNotificationCenter defaultCenter];
  // Both edges: backgrounding is the one the OS always delivers before it
  // kills a suspended app, and willTerminate covers the rarer case where it
  // ends a foreground app outright.
  for (NSNotificationName name : @[ UIApplicationDidEnterBackgroundNotification,
                                    UIApplicationWillTerminateNotification ]) {
    id token = [center addObserverForName:name
                                   object:nil
                                    queue:[NSOperationQueue mainQueue]
                               usingBlock:^(NSNotification*) { onBackground(); }];
    observation->tokens.push_back(token);
  }
  return observation;
}

void stopObserving(void* token) {
  auto* observation = static_cast<Observation*>(token);
  if (observation == nullptr)
    return;
  auto* center = [NSNotificationCenter defaultCenter];
  for (id t : observation->tokens)
    [center removeObserver:t];
  delete observation;
}

}  // namespace IosAppLifecycle

#endif  // JUCE_IOS
