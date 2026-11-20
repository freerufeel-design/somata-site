#!/usr/bin/env python3
"""Local server for Somata.

Same as `python -m http.server`, with two differences:
  * .js is always sent as text/javascript. Browsers refuse ES modules served with another type,
    and `python -m http.server` on Windows often sends .js as text/plain (it takes types from the
    registry). That is why the app may not start with the plain command.
  * Cache-Control: no-store, so the browser never keeps an old copy of a module after an update.

Usage:  python serve.py [port] [--no-browser]      (default port 8000; the next free one if busy)
On Windows you can double-click start.bat, on macOS start.command.
"""
import functools
import http.server
import os
import sys
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".plist": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webp": "image/webp",
        ".wasm": "application/wasm",
    }

    def translate_path(self, path):
        file = super().translate_path(path)
        if file in (os.path.join(ROOT, "project-defaults.js"), os.path.join(ROOT, "default.plist")):
            return os.path.join(os.path.dirname(ROOT), os.path.basename(file))
        return file

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8000
    handler = functools.partial(Handler, directory=ROOT)
    for candidate in range(port, port + 20):
        try:
            server = http.server.ThreadingHTTPServer(("", candidate), handler)
            break
        except OSError:
            continue
    else:
        sys.exit(f"No free port in {port}..{port + 19}")
    url = f"http://localhost:{candidate}/"
    print(f"Somata: {url}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
