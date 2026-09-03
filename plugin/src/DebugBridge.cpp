#include "DebugBridge.h"

#if JUCE_IOS && defined(T3K_DEBUG_BRIDGE)

#include "Processor.h"

#include <arpa/inet.h>
#include <atomic>
#include <memory>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

namespace DebugBridge {
namespace {

constexpr int kPort = 9999;

std::atomic<void*> rootViewHandle{nullptr};

/**
 * Only the USB tunnel and the device itself may talk to the bridge.
 *
 * devicectl's tunnel gives the Mac a unique-local IPv6 address (fd..), and
 * anything running on the iPad itself arrives on loopback. A phone on the same
 * café Wi-Fi arriving on a global address is refused. This is a dev-build
 * guard, not a security boundary: the real protection is that the option is
 * OFF everywhere but a local QA build.
 */
bool isPeerAllowed(const juce::String& host) {
  if (host.isEmpty())
    return false;
  const juce::String h = host.toLowerCase();
  return h == "::1" || h == "localhost" || h.startsWith("127.")
         || h.startsWith("fd") || h.startsWith("fe80")  // ULA / link-local (the tunnel)
         || h.startsWith("10.") || h.startsWith("192.168.")
         || h.startsWith("::ffff:127.");
}

bool writeAll(int fd, const void* data, int size) {
  auto* bytes = static_cast<const char*>(data);
  int sent = 0;
  while (sent < size) {
    const auto n = ::send(fd, bytes + sent, (size_t) (size - sent), 0);
    if (n <= 0)
      return false;
    sent += (int) n;
  }
  return true;
}

void sendResponse(int fd, const juce::String& status,
                  const juce::String& contentType, const void* body, int bodySize) {
  juce::String head;
  head << "HTTP/1.0 " << status << "\r\n"
       << "Content-Type: " << contentType << "\r\n"
       << "Content-Length: " << bodySize << "\r\n"
       << "Connection: close\r\n\r\n";
  const auto headUtf8 = head.toRawUTF8();
  if (writeAll(fd, headUtf8, (int) strlen(headUtf8)) && bodySize > 0)
    writeAll(fd, body, bodySize);
}

void sendJson(int fd, const juce::String& status, const juce::String& json) {
  const auto utf8 = json.toRawUTF8();
  sendResponse(fd, status, "application/json", utf8, (int) strlen(utf8));
}

void sendError(int fd, const juce::String& status, const juce::String& message) {
  juce::DynamicObject::Ptr obj{new juce::DynamicObject()};
  obj->setProperty("ok", false);
  obj->setProperty("error", message);
  sendJson(fd, status, juce::JSON::toString(juce::var{obj.get()}));
}

/** Read a whole HTTP/1.0 request: headers, then Content-Length bytes of body. */
bool readRequest(int fd, juce::String& head, juce::String& body) {
  juce::MemoryBlock buffer;
  char chunk[4096];
  int headerEnd = -1;

  while (headerEnd < 0) {
    const auto n = ::recv(fd, chunk, sizeof(chunk), 0);
    if (n <= 0)
      return false;
    buffer.append(chunk, (size_t) n);
    const juce::String sofar = juce::String::createStringFromData(buffer.getData(),
                                                                 (int) buffer.getSize());
    headerEnd = sofar.indexOf("\r\n\r\n");
    if (headerEnd < 0 && buffer.getSize() > 64 * 1024)
      return false;
  }

  const juce::String all =
      juce::String::createStringFromData(buffer.getData(), (int) buffer.getSize());
  head = all.substring(0, headerEnd);
  body = all.substring(headerEnd + 4);

  int contentLength = 0;
  for (const auto& line : juce::StringArray::fromLines(head))
    if (line.startsWithIgnoreCase("content-length:"))
      contentLength = line.fromFirstOccurrenceOf(":", false, false).trim().getIntValue();

  while (body.getNumBytesAsUTF8() < (size_t) contentLength) {
    const auto n = ::recv(fd, chunk, sizeof(chunk), 0);
    if (n <= 0)
      break;
    body << juce::String::createStringFromData(chunk, (int) n);
  }
  return true;
}

/** Tail the plugin's own log file. */
juce::String tailLog(int lines) {
  const juce::File logFile = TONE3000Processor::getLogFile();
  if (! logFile.existsAsFile())
    return "no log file at " + logFile.getFullPathName();
  auto all = juce::StringArray::fromLines(logFile.loadFileAsString());
  while (all.size() > lines)
    all.remove(0);
  return all.joinIntoString("\n");
}

/**
 * A tap, expressed as the event sequence a real finger produces.
 *
 * Synthesising a UIKit touch would need a private API; dispatching the events
 * in the page instead runs the app's own handlers, which is what QA needs to
 * exercise. Coordinates are CSS pixels in the web view (which fills the iPad
 * screen, so they match the screenshot's points 1:1).
 */
juce::String buildTapScript(double x, double y) {
  juce::String js;
  js << "(function(){var x=" << juce::String(x) << ",y=" << juce::String(y) << ";"
     << "var el=document.elementFromPoint(x,y);"
     << "if(!el)return {ok:false,error:'no element at point'};"
     << "var base={clientX:x,clientY:y,bubbles:true,cancelable:true,composed:true,view:window};"
     << "function pe(t){return new PointerEvent(t,Object.assign({},base,"
     << "{pointerId:1,pointerType:'touch',isPrimary:true,button:0,buttons:t==='pointerdown'?1:0}));}"
     << "function te(t){try{var tp=new Touch({identifier:1,target:el,clientX:x,clientY:y});"
     << "return new TouchEvent(t,{touches:t==='touchend'?[]:[tp],targetTouches:t==='touchend'?[]:[tp],"
     << "changedTouches:[tp],bubbles:true,cancelable:true,composed:true,view:window});}catch(e){return null;}}"
     << "function me(t){return new MouseEvent(t,Object.assign({},base,"
     << "{button:0,buttons:t==='mousedown'?1:0,detail:1}));}"
     << "el.dispatchEvent(pe('pointerdown'));var t1=te('touchstart');if(t1)el.dispatchEvent(t1);"
     << "el.dispatchEvent(me('mousedown'));"
     << "el.dispatchEvent(pe('pointerup'));var t2=te('touchend');if(t2)el.dispatchEvent(t2);"
     << "el.dispatchEvent(me('mouseup'));el.dispatchEvent(me('click'));"
     << "return {ok:true,tag:el.tagName,id:el.id||null,cls:el.className&&el.className.baseVal!==undefined"
     << "?el.className.baseVal:(el.className||null),text:(el.textContent||'').trim().slice(0,120)};})()";
  return js;
}

class BridgeServer : public juce::Thread {
public:
  BridgeServer() : juce::Thread("t3k-debug-bridge") {}
  ~BridgeServer() override { stopServer(); }

  void stopServer() {
    signalThreadShouldExit();
    const int fd = listenFd.exchange(-1);
    if (fd >= 0) {
      ::shutdown(fd, SHUT_RDWR);  // unblocks the accept() below
      ::close(fd);
    }
    stopThread(3000);
  }

  void run() override {
    // JUCE's StreamingSocket is IPv4-only (juce_Socket.cpp opens AF_INET), but
    // the address devicectl's USB tunnel gives the Mac is IPv6 (fd..::1), so a
    // JUCE listener would never see the QA harness. Open a dual-stack AF_INET6
    // socket by hand instead: still no new dependency, and it also answers on
    // IPv4 loopback via v4-mapped addresses.
    const int fd = ::socket(AF_INET6, SOCK_STREAM, 0);
    if (fd < 0) {
      juce::Logger::writeToLog("DebugBridge: socket() failed");
      return;
    }
    int on = 1;
    ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
    int off = 0;
    ::setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, sizeof(off));

    sockaddr_in6 addr{};
    addr.sin6_family = AF_INET6;
    addr.sin6_addr = in6addr_any;
    addr.sin6_port = htons((uint16_t) kPort);

    if (::bind(fd, (sockaddr*) &addr, sizeof(addr)) != 0 || ::listen(fd, 4) != 0) {
      juce::Logger::writeToLog("DebugBridge: could not listen on port " + juce::String(kPort));
      ::close(fd);
      return;
    }
    listenFd.store(fd);
    juce::Logger::writeToLog("DebugBridge: listening on port " + juce::String(kPort));

    while (! threadShouldExit()) {
      sockaddr_in6 peerAddr{};
      socklen_t peerLen = sizeof(peerAddr);
      const int conn = ::accept(fd, (sockaddr*) &peerAddr, &peerLen);
      if (conn < 0)
        continue;  // stopServer() closed the listener, or a transient error

      char host[INET6_ADDRSTRLEN] = {};
      ::inet_ntop(AF_INET6, &peerAddr.sin6_addr, host, sizeof(host));
      handleConnection(conn, juce::String::fromUTF8(host));
      ::close(conn);
    }

    const int stillOpen = listenFd.exchange(-1);
    if (stillOpen >= 0)
      ::close(stillOpen);
  }

private:
  void handleConnection(int fd, const juce::String& peer) {
    if (! isPeerAllowed(peer)) {
      sendError(fd, "403 Forbidden", "peer " + peer + " is not the USB tunnel or loopback");
      return;
    }

    juce::String head, body;
    if (! readRequest(fd, head, body))
      return;

    const juce::String requestLine = juce::StringArray::fromLines(head)[0];
    const juce::String method = requestLine.upToFirstOccurrenceOf(" ", false, false);
    const juce::String target =
        requestLine.fromFirstOccurrenceOf(" ", false, false).upToLastOccurrenceOf(" ", false, false).trim();
    const juce::String path = target.upToFirstOccurrenceOf("?", false, false);
    const juce::String query = target.fromFirstOccurrenceOf("?", false, false);

    void* view = rootViewHandle.load();

    if (method == "GET" && path == "/healthz") {
      juce::DynamicObject::Ptr obj{new juce::DynamicObject()};
      obj->setProperty("ok", true);
      obj->setProperty("app", "TONE3000");
      obj->setProperty("editor", view != nullptr);
      obj->setProperty("webview", view != nullptr && hasWebView(view));
      if (view != nullptr) {
        juce::Array<juce::var> urls;
        for (const auto& url : webViewUrls(view))
          urls.add(url);
        obj->setProperty("webviews", urls);
      }
      sendJson(fd, "200 OK", juce::JSON::toString(juce::var{obj.get()}));
      return;
    }

    if (method == "GET" && path == "/log") {
      int tail = 200;
      for (const auto& pair : juce::StringArray::fromTokens(query, "&", ""))
        if (pair.startsWith("tail="))
          tail = juce::jlimit(1, 20000, pair.fromFirstOccurrenceOf("=", false, false).getIntValue());
      // Keep the string alive: toRawUTF8() points into it, and a temporary
      // would be gone before sendResponse() reads a byte.
      const juce::String text = tailLog(tail);
      const auto* utf8 = text.toRawUTF8();
      sendResponse(fd, "200 OK", "text/plain; charset=utf-8", utf8, (int) strlen(utf8));
      return;
    }

    if (view == nullptr) {
      sendError(fd, "503 Service Unavailable", "the editor is not open yet");
      return;
    }

    if (method == "GET" && path == "/screenshot") {
      juce::MemoryBlock png;
      juce::String error;
      if (! snapshotPng(view, png, error)) {
        sendError(fd, "500 Internal Server Error", error);
        return;
      }
      sendResponse(fd, "200 OK", "image/png", png.getData(), (int) png.getSize());
      return;
    }

    if (method == "POST" && (path == "/js" || path == "/tap")) {
      const juce::var parsed = juce::JSON::parse(body);
      juce::String code;

      if (path == "/js") {
        code = parsed["code"].toString();
        if (code.isEmpty()) {
          sendError(fd, "400 Bad Request", "expected {\"code\": \"...\"}");
          return;
        }
      } else {
        if (! parsed.hasProperty("x") || ! parsed.hasProperty("y")) {
          sendError(fd, "400 Bad Request", "expected {\"x\": .., \"y\": ..}");
          return;
        }
        code = buildTapScript((double) parsed["x"], (double) parsed["y"]);
      }

      juce::String resultJson, error;
      if (! evaluateJavaScript(view, code, resultJson, error)) {
        sendError(fd, "500 Internal Server Error", error);
        return;
      }
      juce::String out;
      out << "{\"ok\":true,\"result\":" << (resultJson.isEmpty() ? "null" : resultJson) << "}";
      sendJson(fd, "200 OK", out);
      return;
    }

    // GET /screenshot etc. via the wrong verb lands here too.
    sendError(fd, "404 Not Found", "no endpoint " + method + " " + path);
  }

  std::atomic<int> listenFd{-1};
};

std::unique_ptr<BridgeServer> server;

}  // namespace

void start() {
  if (server != nullptr)
    return;
  server = std::make_unique<BridgeServer>();
  server->startThread();
}

void stop() {
  if (server == nullptr)
    return;
  server->stopServer();
  server.reset();
}

void setRootView(void* uiView) { rootViewHandle.store(uiView); }

}  // namespace DebugBridge

#endif  // JUCE_IOS && T3K_DEBUG_BRIDGE
