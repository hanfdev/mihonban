import argparse
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

FORMATS = ("mp3", "flac", "ogg")


def album(extension):
    return {
        "id": f"network-{extension}", "title": f"Network {extension.upper()}",
        "artist": "Test Ensemble", "year": 2026, "trackCount": 1,
        "duration": 8, "updatedAt": 1,
        "tracks": [{"id": f"network-{extension}", "title": f"Test {extension.upper()}",
                    "duration": 8, "format": extension, "disc": 1, "track": 1}],
    }


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data, mime="application/json", headers=None):
        body = json.dumps(data).encode() if isinstance(data, (dict, list)) else data
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def authorized(self):
        return "mihonban_session=fixture-session" in self.headers.get("Cookie", "")

    def do_POST(self):
        if self.path != "/api/login":
            return self.reply(404, {})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {})
        if data.get("password") != "fixture-password":
            return self.reply(401, {})
        self.reply(200, {"ok": True, "role": "user", "guest": False}, headers={
            "Set-Cookie": "mihonban_session=fixture-session; Path=/; HttpOnly; SameSite=Lax"})

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/health":
            return self.reply(200, {"ok": True})
        if path == "/api/me":
            return self.reply(200, {"ok": self.authorized(), "role": "user" if self.authorized() else None, "guest": False})
        if path.startswith("/api/") and not self.authorized():
            return self.reply(401, {})
        if path == "/api/library":
            if self.headers.get("If-None-Match") == '"fixture-1"':
                return self.reply(304, b"", headers={"ETag": '"fixture-1"'})
            return self.reply(200, [album(ext) for ext in FORMATS], headers={"ETag": '"fixture-1"'})
        if path.startswith("/api/album/network-"):
            ext = path.rsplit("-", 1)[-1]
            return self.reply(200, album(ext)) if ext in FORMATS else self.reply(404, {})
        if path.startswith("/api/stream/network-"):
            ext = path.rsplit("-", 1)[-1]
            if ext not in FORMATS:
                return self.reply(404, {})
            return self.reply(307, b"", headers={"Location": f"/media/tone.{ext}"})
        if path.startswith("/api/art/"):
            return self.reply(302, b"", headers={"Location": "/artwork/cover.png"})
        if path == "/artwork/cover.png":
            return self.reply(200, self.server.cover.read_bytes(), "image/png")
        if path == "/stall":
            time.sleep(60)
            return
        name = path.rsplit("/", 1)[-1]
        if name not in {"tone.mp3", "tone.flac", "tone.ogg"}:
            return self.reply(404, {})
        data = (self.server.fixtures / name).read_bytes()
        start, end = 0, len(data) - 1
        ranged = "Range" in self.headers and not path.startswith("/no-range/")
        if ranged:
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers["Range"])
            if not match:
                return self.reply(400, {})
            start = int(match[1])
            if match[2]:
                end = min(end, int(match[2]))
        if start >= len(data) or end < start:
            return self.reply(416, b"", headers={"Content-Range": f"bytes */{len(data)}"})
        self.send_response(206 if ranged else 200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(end - start + 1))
        if ranged:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
        self.end_headers()
        try:
            for position in range(start, end + 1, 8192):
                self.wfile.write(data[position:min(position + 8192, end + 1)])
                self.wfile.flush()
                time.sleep(0.002)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fixtures", type=Path)
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    root = args.fixtures.resolve()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.fixtures = root
    server.cover = root.parent / "Resources/Assets.xcassets/Logo.imageset/logo.png"
    server.serve_forever()


if __name__ == "__main__":
    main()
