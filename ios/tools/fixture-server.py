import argparse
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("fixtures", type=Path)
args = parser.parse_args()
root = args.fixtures.resolve()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/stall":
            time.sleep(60)
            return
        name = self.path.rsplit("/", 1)[-1]
        if name not in {"tone.mp3", "tone.flac", "tone.ogg"}:
            self.send_error(404)
            return
        data = (root / name).read_bytes()
        start = 0
        ranged = "Range" in self.headers and not self.path.startswith("/no-range/")
        if ranged:
            start = int(self.headers["Range"].split("=")[1].split("-")[0])
        if start >= len(data):
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{len(data)}")
            self.end_headers()
            return
        self.send_response(206 if ranged else 200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data) - start))
        if ranged:
            self.send_header("Content-Range", f"bytes {start}-{len(data)-1}/{len(data)}")
        self.end_headers()
        try:
            for position in range(start, len(data), 8192):
                self.wfile.write(data[position:position + 8192])
                self.wfile.flush()
                time.sleep(0.002)
        except (BrokenPipeError, ConnectionResetError):
            pass


ThreadingHTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
