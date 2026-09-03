#include "IosWebViewGestures.h"

#if JUCE_IOS

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

namespace IosWebViewGestures {

namespace {
WKWebView* findWebView(UIView* view) {
  if (view == nil)
    return nil;
  if ([view isKindOfClass:[WKWebView class]])
    return (WKWebView*)view;
  for (UIView* child in view.subviews)
    if (WKWebView* found = findWebView(child))
      return found;
  return nil;
}
}  // namespace

void enableBackForwardSwipes(void* nativeViewHandle) {
  if (WKWebView* web = findWebView((UIView*)nativeViewHandle))
    web.allowsBackForwardNavigationGestures = YES;
}

}  // namespace IosWebViewGestures

#endif  // JUCE_IOS
