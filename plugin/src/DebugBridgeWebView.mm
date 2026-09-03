#include "DebugBridge.h"

#if JUCE_IOS && defined(T3K_DEBUG_BRIDGE)

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

namespace {

void collectWebViews(UIView* view, NSMutableArray<WKWebView*>* out) {
  if (view == nil)
    return;
  if ([view isKindOfClass:[WKWebView class]])
    [out addObject:(WKWebView*) view];
  for (UIView* child in view.subviews)
    collectWebViews(child, out);
}

NSArray<WKWebView*>* allWebViews(UIView* root) {
  NSMutableArray<WKWebView*>* found = [NSMutableArray array];
  collectWebViews(root, found);
  return found;
}

/**
 * The editor's view tree can hold more than one WKWebView (JUCE keeps a spare
 * around, and OAuth flows add their own), and the extra ones sit on
 * about:blank. Take the biggest view that has actually loaded something, and
 * only fall back to the first one when nothing has.
 */
WKWebView* findWebView(UIView* view) {
  WKWebView* best = nil;
  CGFloat bestArea = -1;
  for (WKWebView* web in allWebViews(view)) {
    NSString* url = web.URL.absoluteString;
    const bool loaded = url.length > 0 && ! [url hasPrefix:@"about:"];
    const CGFloat area = web.bounds.size.width * web.bounds.size.height;
    if (! loaded)
      continue;
    if (area > bestArea) {
      bestArea = area;
      best = web;
    }
  }
  if (best != nil)
    return best;
  return allWebViews(view).firstObject;
}

/**
 * Run `block` on the main queue and block the calling thread until it either
 * finishes or `timeoutMs` elapses. Returns false on timeout.
 *
 * The bridge only ever calls this from its own server thread; calling it from
 * the main thread would deadlock, which is why the header says so.
 */
bool runOnMainAndWait(int timeoutMs, void (^block)(dispatch_semaphore_t done)) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  dispatch_async(dispatch_get_main_queue(), ^{
    block(done);
  });
  const dispatch_time_t deadline =
      dispatch_time(DISPATCH_TIME_NOW, (int64_t) timeoutMs * NSEC_PER_MSEC);
  return dispatch_semaphore_wait(done, deadline) == 0;
}

/** JSON-encode an arbitrary value returned by evaluateJavaScript. */
juce::String jsonify(id value) {
  if (value == nil || value == [NSNull null])
    return "null";

  if ([NSJSONSerialization isValidJSONObject:@[ value ]]) {
    NSData* data = [NSJSONSerialization dataWithJSONObject:@[ value ] options:0 error:nil];
    if (data != nil) {
      NSString* wrapped = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
      // Strip the array we wrapped it in so top-level scalars survive.
      if (wrapped.length >= 2)
        return juce::String::fromUTF8(
            [[wrapped substringWithRange:NSMakeRange(1, wrapped.length - 2)] UTF8String]);
    }
  }

  // Not JSON-serialisable (a DOM node, a function, undefined): fall back to a
  // JSON string holding its description so the caller still gets valid JSON.
  juce::var text{juce::String::fromUTF8([[value description] UTF8String])};
  return juce::JSON::toString(text);
}

}  // namespace

namespace DebugBridge {

bool hasWebView(void* rootView) {
  __block bool found = false;
  runOnMainAndWait(2000, ^(dispatch_semaphore_t done) {
    found = findWebView((__bridge UIView*) rootView) != nil;
    dispatch_semaphore_signal(done);
  });
  return found;
}

juce::StringArray webViewUrls(void* rootView) {
  __block juce::StringArray urls;
  runOnMainAndWait(2000, ^(dispatch_semaphore_t done) {
    for (WKWebView* web in allWebViews((__bridge UIView*) rootView)) {
      NSString* url = web.URL.absoluteString;
      urls.add(juce::String::fromUTF8(url != nil ? [url UTF8String] : "(none)")
               + juce::String::formatted(" [%.0fx%.0f]", web.bounds.size.width,
                                         web.bounds.size.height));
    }
    dispatch_semaphore_signal(done);
  });
  return urls;
}

bool evaluateJavaScript(void* rootView, const juce::String& code, juce::String& resultJson,
                        juce::String& error) {
  __block juce::String out;
  __block juce::String err;
  NSString* source = [NSString stringWithUTF8String:code.toRawUTF8()];

  const bool answered = runOnMainAndWait(15000, ^(dispatch_semaphore_t done) {
    WKWebView* web = findWebView((__bridge UIView*) rootView);
    if (web == nil) {
      err = "no WKWebView under the editor view";
      dispatch_semaphore_signal(done);
      return;
    }
    [web evaluateJavaScript:source
          completionHandler:^(id value, NSError* jsError) {
            if (jsError != nil)
              err = juce::String::fromUTF8([[jsError localizedDescription] UTF8String]);
            else
              out = jsonify(value);
            dispatch_semaphore_signal(done);
          }];
  });

  if (! answered) {
    error = "timed out waiting for the web view";
    return false;
  }
  if (err.isNotEmpty()) {
    error = err;
    return false;
  }
  resultJson = out;
  return true;
}

bool snapshotPng(void* rootView, juce::MemoryBlock& png, juce::String& error) {
  __block juce::MemoryBlock bytes;
  __block juce::String err;

  const bool answered = runOnMainAndWait(15000, ^(dispatch_semaphore_t done) {
    WKWebView* web = findWebView((__bridge UIView*) rootView);
    if (web == nil) {
      err = "no WKWebView under the editor view";
      dispatch_semaphore_signal(done);
      return;
    }
    WKSnapshotConfiguration* config = [[WKSnapshotConfiguration alloc] init];
    config.afterScreenUpdates = YES;
    [web takeSnapshotWithConfiguration:config
                    completionHandler:^(UIImage* image, NSError* snapError) {
                      if (snapError != nil || image == nil) {
                        err = snapError != nil
                                  ? juce::String::fromUTF8(
                                        [[snapError localizedDescription] UTF8String])
                                  : juce::String("snapshot returned no image");
                      } else if (NSData* data = UIImagePNGRepresentation(image)) {
                        bytes.append([data bytes], (size_t) [data length]);
                      } else {
                        err = "could not PNG-encode the snapshot";
                      }
                      dispatch_semaphore_signal(done);
                    }];
  });

  if (! answered) {
    error = "timed out waiting for the snapshot";
    return false;
  }
  if (err.isNotEmpty()) {
    error = err;
    return false;
  }
  png = bytes;
  return true;
}

}  // namespace DebugBridge

#endif  // JUCE_IOS && T3K_DEBUG_BRIDGE
