#include "EditorWebViewSetup.h"

#import <AppKit/AppKit.h>

namespace EditorWebViewSetup {

// The WKWebView is first responder once the user has clicked the plugin UI,
// so every keypress lands in web content and the host DAW never sees it,
// most painfully Space, the universal play/stop shortcut. The UI swallows
// Space itself (preventDefault, so no caret scroll or system beep) and calls
// this to hand the press to the host instead.
void forwardSpaceKeyToHost(void* nsViewPtr) {
  NSView* view = (__bridge NSView*)nsViewPtr;
  NSWindow* window = [view window];
  if (window == nil)
    return;

  // Focus the host's own content view (our peer view is a subview of it):
  // the same state as a click on the host's plugin-window chrome, where
  // Space works natively. Follow-up presses and key repeats then reach the
  // host without us. Don't target [NSApp mainWindow] instead: hosts can make
  // the plugin window main (LUNA does), which would send the key right back
  // into the chain we just emptied.
  NSView* hostView = [window contentView];
  if (hostView == nil || ![window makeFirstResponder:hostView])
    [window makeFirstResponder:nil];

  NSEvent* (^spaceEvent)(NSEventType) = ^(NSEventType type) {
    return [NSEvent keyEventWithType:type
                            location:NSZeroPoint
                       modifierFlags:0
                           timestamp:[[NSProcessInfo processInfo] systemUptime]
                        windowNumber:[window windowNumber]
                             context:nil
                          characters:@" "
         charactersIgnoringModifiers:@" "
                           isARepeat:NO
                             keyCode:49];  // kVK_Space
  };
  // postEvent, not sendEvent: only queued events flow through the app's
  // run-loop dispatch, where local event monitors live, and hosts commonly
  // hang their transport shortcut off one.
  [NSApp postEvent:spaceEvent(NSEventTypeKeyDown) atStart:NO];
  [NSApp postEvent:spaceEvent(NSEventTypeKeyUp) atStart:NO];
}

}  // namespace EditorWebViewSetup
