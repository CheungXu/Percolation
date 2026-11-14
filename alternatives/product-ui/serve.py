#!/usr/bin/env python3
"""拾记凝境界面备选方案的本地预览：五套风格各占一个端口（3011..3015），全部用 shared/store.js 的假数据。

线上已选方案 2（nordic，双境工作区），正式版在 code/web/；这里的 nordic/ 是它接后端之前的离线原型。
常驻方式见 config/systemd/percolation-ui-previews.service。
"""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

ROOT = Path(__file__).resolve().parent
VARIANTS = {
    3011: "ink",        # 1 宋韵留白（中国风）
    3012: "nordic",     # 2 双境工作区（已上线，此为离线原型）
    3013: "editorial",  # 3 极夜聚光（暗色）
    3014: "zen",        # 4 博朗网格（瑞士功能主义）
    3015: "stream",     # 5 晨雾对话流（一体流）
}


class ReusableHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def make_handler(variant: str):
    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path: str) -> str:
            rel = path.split("?", 1)[0].split("#", 1)[0]
            if rel.startswith("/shared/"):
                target = (ROOT / "shared" / rel[len("/shared/") :]).resolve()
            elif rel in ("/_hub", "/_hub/"):
                target = ROOT / "hub" / "index.html"
            elif rel in ("/", "/index.html"):
                target = ROOT / variant / "index.html"
            else:
                target = (ROOT / variant / rel.lstrip("/")).resolve()
            return str(target)

        def end_headers(self) -> None:
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt: str, *args) -> None:
            print(f"[{variant}:{self.server.server_port}] {fmt % args}", flush=True)

    return Handler


def serve(port: int) -> None:
    variant = VARIANTS[port]
    httpd = ReusableHTTPServer(("0.0.0.0", port), make_handler(variant))
    print(f"http://0.0.0.0:{port}/  ->  {variant}/", flush=True)
    httpd.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve 5 product UI previews on ports 3011-3015")
    parser.add_argument("--ports", default="3011,3012,3013,3014,3015")
    args = parser.parse_args()
    ports = [int(x) for x in args.ports.split(",") if x.strip()]
    threads = [Thread(target=serve, args=(port,), daemon=True) for port in ports]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


if __name__ == "__main__":
    main()
