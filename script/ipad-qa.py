#!/usr/bin/env python3
"""Drive the iOS dev QA bridge on a physical iPad over the USB tunnel.

Only works against a build configured with -DT3K_DEBUG_BRIDGE=ON, which is a
local dev build and nothing else. See docs/ios-debug-bridge.md.

Usage:
  script/ipad-qa.py healthz
  script/ipad-qa.py screenshot out.png
  script/ipad-qa.py js 'document.querySelectorAll("[data-block]").length'
  script/ipad-qa.py tap 512 300
  script/ipad-qa.py log 100

Device selection: --device <udid>, else T3K_IOS_DEVICE, else the only paired
device devicectl reports.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

PORT = 9999


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def list_devices():
    with tempfile.NamedTemporaryFile(suffix=".json") as tmp:
        res = run(["xcrun", "devicectl", "list", "devices", "--json-output", tmp.name])
        if res.returncode != 0:
            sys.exit("devicectl list devices failed:\n" + res.stderr)
        data = json.load(open(tmp.name))
    return [d["identifier"] for d in data.get("result", {}).get("devices", [])]


def tunnel_address(udid):
    """Resolve the device's tunnel IP. devicectl brings the tunnel up on demand."""
    with tempfile.NamedTemporaryFile(suffix=".json") as tmp:
        res = run(
            [
                "xcrun", "devicectl", "device", "info", "details",
                "--device", udid, "--json-output", tmp.name,
            ]
        )
        if res.returncode != 0:
            sys.exit("devicectl device info details failed:\n" + res.stderr)
        data = json.load(open(tmp.name))

    result = data.get("result", {})
    addr = result.get("connectionProperties", {}).get("tunnelIPAddress")
    if not addr:
        # Tolerate layout drift across Xcode versions: find the key anywhere.
        stack = [data]
        while stack and not addr:
            node = stack.pop()
            if isinstance(node, dict):
                addr = node.get("tunnelIPAddress")
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
    if not addr:
        sys.exit("no tunnelIPAddress for %s; is the iPad plugged in and unlocked?" % udid)
    return addr


def base_url(udid):
    addr = tunnel_address(udid)
    host = "[%s]" % addr if ":" in addr else addr
    return "http://%s:%d" % (host, PORT)


def request(url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"} if data else {}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read(), resp.headers.get_content_type()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        sys.exit("HTTP %s from the bridge: %s" % (exc.code, body))
    except urllib.error.URLError as exc:
        sys.exit(
            "cannot reach the bridge at %s (%s).\n"
            "Is the dev build installed, running and in the foreground?" % (url, exc.reason)
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", default=os.environ.get("T3K_IOS_DEVICE"))
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("healthz")
    p = sub.add_parser("screenshot"); p.add_argument("out")
    p = sub.add_parser("js"); p.add_argument("code")
    p = sub.add_parser("tap"); p.add_argument("x", type=float); p.add_argument("y", type=float)
    p = sub.add_parser("log"); p.add_argument("tail", nargs="?", type=int, default=200)
    args = parser.parse_args()

    udid = args.device
    if not udid:
        found = list_devices()
        if len(found) != 1:
            sys.exit("pass --device: devicectl reports %d devices %s" % (len(found), found))
        udid = found[0]

    base = base_url(udid)

    if args.cmd == "healthz":
        body, _ = request(base + "/healthz", timeout=10)
        print(body.decode())
    elif args.cmd == "screenshot":
        body, ctype = request(base + "/screenshot")
        if ctype != "image/png":
            sys.exit("bridge did not return a PNG: " + body.decode("utf-8", "replace"))
        with open(args.out, "wb") as handle:
            handle.write(body)
        print("%s (%d bytes)" % (args.out, len(body)))
    elif args.cmd == "js":
        body, _ = request(base + "/js", {"code": args.code})
        print(json.dumps(json.loads(body), indent=2))
    elif args.cmd == "tap":
        body, _ = request(base + "/tap", {"x": args.x, "y": args.y})
        print(json.dumps(json.loads(body), indent=2))
    elif args.cmd == "log":
        body, _ = request(base + "/log?tail=%d" % args.tail)
        print(body.decode("utf-8", "replace"))


if __name__ == "__main__":
    main()
