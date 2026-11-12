#!/usr/bin/env python3
"""Serve three static console previews on 3001 / 3002 / 3003."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

ROOT = Path(__file__).resolve().parent
VARIANTS = {3001: "a", 3002: "b", 3003: "c", 3004: "merged"}


def make_handler(variant: str):
    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path: str) -> str:
            rel = path.split("?", 1)[0].split("#", 1)[0]
            if rel.startswith("/shared/"):
                target = (ROOT / "shared" / rel[len("/shared/") :]).resolve()
            elif rel in ("/", "/index.html"):
                target = ROOT / variant / "index.html"
            else:
                target = (ROOT / variant / rel.lstrip("/")).resolve()
            return str(target)

        def log_message(self, fmt: str, *args) -> None:
            print(f"[{variant}:{self.server.server_port}] {fmt % args}")

    return Handler


def serve(port: int) -> None:
    variant = VARIANTS[port]
    httpd = ThreadingHTTPServer(("0.0.0.0", port), make_handler(variant))
    print(f"http://0.0.0.0:{port}/  →  {variant}/")
    httpd.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ports", default="3001,3002,3003,3004")
    args = parser.parse_args()
    ports = [int(x) for x in args.ports.split(",") if x.strip()]
    threads = [Thread(target=serve, args=(port,), daemon=True) for port in ports]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


if __name__ == "__main__":
    main()
