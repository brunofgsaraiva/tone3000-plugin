#include "EditorWebViewSetup.h"

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

namespace EditorWebViewSetup {

// Hover states and cursor changes inside WKWebView are driven entirely by
// mouseMoved: NSEvents, and AppKit only delivers those when the hosting
// NSWindow has acceptsMouseMovedEvents enabled. JUCE turns it on for its own
// windows (which is why Standalone works), but DAW hosts own the plugin
// window and most never set it, leaving the web UI with dead :hover rules
// and a permanent arrow cursor. Clicks are unaffected, which is the telltale
// symptom. Called from the editor whenever it lands in a (possibly new)
// window; messaging a nil window is a harmless no-op.
void enableHostWindowMouseMovedEvents(void* nsViewPtr) {
  NSView* view = (__bridge NSView*)nsViewPtr;
  [[view window] setAcceptsMouseMovedEvents:YES];
}

namespace {
// Depth-first walk to the WKWebView JUCE embeds somewhere under the editor's
// NSView (the exact hierarchy is a JUCE implementation detail).
void makeWebViewsDrawNoBackground(NSView* view) {
  for (NSView* subview in [view subviews]) {
    if ([subview isKindOfClass:[WKWebView class]]) {
      WKWebView* webView = (WKWebView*)subview;
      if (@available(macOS 12.0, *))
        [webView setUnderPageBackgroundColor:[NSColor blackColor]];
      // No public pre-Monterey API for the pre-first-paint background; this
      // KVC toggle is the long-standing workaround (guarded so a future
      // WebKit that drops the key degrades to the default background rather
      // than throwing).
      @try {
        [webView setValue:@NO forKey:@"drawsBackground"];
      } @catch (NSException* exception) {
        (void)exception;
      }
    } else {
      makeWebViewsDrawNoBackground(subview);
    }
  }
}
}  // namespace

void applyBlackWebViewBackground(void* nsViewPtr) {
  NSView* view = (__bridge NSView*)nsViewPtr;
  // Until the page's first paint, WKWebView fills itself with the system
  // background (a light grey), which flashes at launch before the black UI
  // appears. Stop it drawing a background at all; the editor and window
  // behind it already paint black.
  makeWebViewsDrawNoBackground(view);
  [[view window] setBackgroundColor:[NSColor blackColor]];
}

}  // namespace EditorWebViewSetup
