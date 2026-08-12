#include "EditorWebViewSetup.h"

// Windows and Linux implementations of forwardSpaceKeyToHost; the macOS one
// lives in WindowKeyEvents.mm. Same shape on every platform: hand keyboard
// focus back to the host's top-level window (so follow-up presses and real
// key repeats reach it without us), then deliver a synthesized Space
// press/release to it.

#if JUCE_WINDOWS

#include <windows.h>

namespace EditorWebViewSetup {

void forwardSpaceKeyToHost(void* nativeHandle) {
  HWND host = GetAncestor(static_cast<HWND>(nativeHandle), GA_ROOT);
  if (host == nullptr)
    return;

  // Fails (harmlessly) if the host window lives on another thread; the
  // posted messages below still deliver this press.
  SetFocus(host);

  // Posted, not sent: hosts pick their transport shortcut out of their
  // message loop (TranslateAccelerator/hotkey handling), which only sees
  // queued messages.
  const auto scanCode = static_cast<LPARAM>(MapVirtualKeyW(VK_SPACE, MAPVK_VK_TO_VSC));
  const LPARAM down = 1 | (scanCode << 16);
  const LPARAM up = down | (LPARAM{1} << 30) | (LPARAM{1} << 31);
  PostMessageW(host, WM_KEYDOWN, VK_SPACE, down);
  PostMessageW(host, WM_KEYUP, VK_SPACE, up);
}

}  // namespace EditorWebViewSetup

#elif JUCE_LINUX

#include <X11/Xlib.h>
#include <X11/keysym.h>

#include <cstdint>

namespace {

// Walk up to the host's top-level window (the direct child of the root).
::Window topLevelWindowOf(Display* display, ::Window window) {
  for (;;) {
    ::Window root = 0;
    ::Window parent = 0;
    ::Window* children = nullptr;
    unsigned int childCount = 0;
    if (XQueryTree(display, window, &root, &parent, &children, &childCount) == 0)
      return window;
    if (children != nullptr)
      XFree(children);
    if (parent == 0 || parent == root)
      return window;
    window = parent;
  }
}

}  // namespace

namespace EditorWebViewSetup {

void forwardSpaceKeyToHost(void* nativeHandle) {
  // A private connection: the peer's Display is JUCE-internal, and one
  // round-trip per Space press is nothing.
  Display* display = XOpenDisplay(nullptr);
  if (display == nullptr)
    return;

  const auto pluginWindow = static_cast<::Window>(reinterpret_cast<uintptr_t>(nativeHandle));
  const ::Window host = topLevelWindowOf(display, pluginWindow);
  XSetInputFocus(display, host, RevertToParent, CurrentTime);

  // Synthetic (send_event) key events; toolkits that ignore those drop the
  // press, but the focus handoff above already lets the next real press
  // through.
  XKeyEvent key = {};
  key.display = display;
  key.window = host;
  key.root = DefaultRootWindow(display);
  key.same_screen = True;
  key.keycode = XKeysymToKeycode(display, XK_space);
  key.time = CurrentTime;

  key.type = KeyPress;
  XSendEvent(display, host, True, KeyPressMask, reinterpret_cast<XEvent*>(&key));
  key.type = KeyRelease;
  XSendEvent(display, host, True, KeyReleaseMask, reinterpret_cast<XEvent*>(&key));

  XCloseDisplay(display);  // flushes the queue
}

}  // namespace EditorWebViewSetup

#endif
