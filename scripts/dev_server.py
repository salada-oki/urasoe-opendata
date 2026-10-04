#!/usr/bin/env python3
"""ローカル確認用の開発サーバー。ブラウザキャッシュを無効化して配信する。

使い方:
    python scripts/dev_server.py [port]  # デフォルト 8000, docs/ を配信
"""
import http.server
import sys
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind="0.0.0.0")
