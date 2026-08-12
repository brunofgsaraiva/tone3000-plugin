#include "EditorWebViewSetup.h"

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

#include <objc/runtime.h>

namespace {

// Depth-first walk to the WKWebView JUCE embeds somewhere under the editor's
// NSView (the exact hierarchy is a JUCE implementation detail).
WKWebView* findWKWebView(NSView* view) {
  for (NSView* subview in [view subviews]) {
    if ([subview isKindOfClass:[WKWebView class]])
      return (WKWebView*)subview;
    if (WKWebView* nested = findWKWebView(subview))
      return nested;
  }
  return nil;
}

}  // namespace

// Tracking-area owner that revives hover when the cursor re-enters the
// plugin while another window (a DAW control the user just clicked) is key.
// AppKit generates responder-chain mouseMoved: events for the key window
// only, but a tracking area with NSTrackingActiveAlways delivers them to its
// owner in any window of the active app. On entry, try to become key (hover
// then works natively); until that happens, hand every tracked mouseMoved:
// to the WKWebView, whose :hover rules and cursor updates are driven by
// exactly these events.
@interface T3KHoverForwarder : NSObject {
 @public
  NSView* webView;  // unretained; the forwarder dies with the view
}
@end

@implementation T3KHoverForwarder

- (void)mouseEntered:(NSEvent*)event {
  (void)event;
  NSWindow* window = [webView window];
  if (window == nil)
    return;
  // Hosts can reset the mouse-moved flag at any point; entry is the cheapest
  // place to re-arm it.
  [window setAcceptsMouseMovedEvents:YES];
  if (![window isKeyWindow] && [window canBecomeKeyWindow])
    [window makeKeyWindow];
}

- (void)mouseMoved:(NSEvent*)event {
  NSWindow* window = [webView window];
  if (window == nil || [window isKeyWindow])
    return;  // key window: AppKit already routes moves to the webview
  [webView mouseMoved:event];
}

- (void)mouseExited:(NSEvent*)event {
  (void)event;
}

@end

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

void installHoverMouseForwarding(void* nsViewPtr) {
  NSView* view = (__bridge NSView*)nsViewPtr;
  static const char kForwarderKey = 0;
  if (view == nil)
    return;
  // The area goes on the WKWebView, not the peer view: JUCE's
  // NSViewComponentPeer wipes foreign tracking areas from its view on every
  // updateTrackingAreas pass, while WebKit leaves areas it didn't create
  // alone.
  WKWebView* webView = findWKWebView(view);
  // Reparents can hand us the same webview again; one installation is
  // enough (the tracking area and forwarder live until the view dies).
  if (webView == nil || objc_getAssociatedObject(webView, &kForwarderKey) != nil)
    return;

  T3KHoverForwarder* forwarder = [[T3KHoverForwarder alloc] init];
  forwarder->webView = webView;
  NSTrackingArea* area = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:(NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved |
                    NSTrackingActiveAlways | NSTrackingInVisibleRect)
             owner:forwarder
          userInfo:nil];
  [webView addTrackingArea:area];
  [area release];
  // Pin the owner to the view's lifetime.
  objc_setAssociatedObject(webView, &kForwarderKey, forwarder, OBJC_ASSOCIATION_RETAIN);
  [forwarder release];
}

void applyBlackWebViewBackground(void* nsViewPtr) {
  NSView* view = (__bridge NSView*)nsViewPtr;
  // Until the page's first paint, WKWebView fills itself with the system
  // background (a light grey), which flashes at launch before the black UI
  // appears. Stop it drawing a background at all; the editor and window
  // behind it already paint black.
  if (WKWebView* webView = findWKWebView(view)) {
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
  }
  // Blacken the window behind the webview too, but only when the window is
  // ours (standalone, where the peer view is the window's content view). DAW
  // hosts own the plugin window, and some (LUNA) keep a transparent margin
  // around their chrome; painting it black frames the whole window.
  NSWindow* window = [view window];
  if ([window contentView] == view)
    [window setBackgroundColor:[NSColor blackColor]];
}

}  // namespace EditorWebViewSetup
