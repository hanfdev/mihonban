import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

FORMATS = ("mp3", "flac", "ogg")
ENSEMBLE = {"name": "Test Ensemble", "sort": "Ensemble, Test"}
GUEST = {"name": "Guest Singer", "sort": "Singer, Guest"}
SESSION = {"name": "Session Player", "sort": ""}
# Response shapes follow cloud/worker/src/index.js, including SQLite 0/1 flags.
META = {
    "mp3": {"year": 1984, "genres": ["City Pop"], "secondaryGenres": ["Jazz-Funk"], "rating": 3.9, "votes": 420,
            "artists": [ENSEMBLE], "createdAt": 3},
    "flac": {"year": 1979, "genres": ["City Pop"], "secondaryGenres": [], "rating": 4.1, "votes": 3,
             "artists": [ENSEMBLE, GUEST], "createdAt": 2},
    "ogg": {"year": 1991, "genres": ["Ambient"], "secondaryGenres": ["New Age"], "rating": None, "votes": None,
            "artists": [ENSEMBLE], "createdAt": 1},
}


def credit(artists):
    return " & ".join(a["name"] for a in artists)


def album(extension, detail=False):
    meta = META[extension]
    rym = None if meta["rating"] is None else {
        "rating": meta["rating"], "votes": meta["votes"], "rank": "", "rymUrl": "https://rateyourmusic.com/",
        "genres": meta["genres"], "secondaryGenres": meta["secondaryGenres"],
        "descriptors": ["warm", "nocturnal"]}
    out = {
        "id": f"network-{extension}", "title": f"Network {extension.upper()}",
        "artist": credit(meta["artists"]), "artistSort": meta["artists"][0]["sort"], "artists": meta["artists"],
        "year": meta["year"], "folder": f"Test/{extension}", "storageId": None, "hidden": False, "rym": rym,
        "genres": meta["genres"], "secondaryGenres": meta["secondaryGenres"],
        "trackCount": 1, "duration": 8, "createdAt": meta["createdAt"], "updatedAt": 1,
    }
    if detail:
        own = [ENSEMBLE, SESSION] if extension == "ogg" else meta["artists"]
        out["tracks"] = [{"id": f"network-{extension}", "disc": 1, "track": 1,
                          "title": f"Test {extension.upper()}", "titleOverride": False, "duration": 8,
                          "format": extension, "bitrate": 192000, "size": 200000, "path": f"Test/{extension}/01",
                          "artists": own, "artist": credit(own), "artistSort": own[0]["sort"],
                          "hasCustomArtists": extension == "ogg"}]
        out["note"] = "Recorded **live** for the fixture." if extension == "mp3" else ""
        out["images"] = ["booklet-1", "booklet-2"] if extension == "mp3" else []
        out["similar"] = [{"id": f"network-{other}", "artist": "Test Ensemble", "title": f"Network {other.upper()}",
                           "year": META[other]["year"], "rating": META[other]["rating"], "votes": META[other]["votes"]}
                          for other in FORMATS if other != extension]
    return out


def track_row(extension):
    detail = album(extension, detail=True)
    row = dict(detail["tracks"][0])
    for key in ("titleOverride", "bitrate", "size", "path"):
        row.pop(key)
    row.update({"albumId": detail["id"], "albumTitle": detail["title"], "year": detail["year"],
                "addedAt": detail["createdAt"], "hidden": 0})
    return row


def artists():
    return [
        {"name": "Guest Singer", "hasAvatar": False, "note": "", "hasBio": False, "sort": "Singer, Guest",
         "featuredTrackCount": 0, "visibleFeaturedTrackCount": 0},
        {"name": "Session Player", "hasAvatar": False, "note": "", "hasBio": False, "sort": "",
         "featuredTrackCount": 1, "visibleFeaturedTrackCount": 1},
        {"name": "Test Ensemble", "hasAvatar": True, "note": "A *fixture* ensemble.", "hasBio": True,
         "sort": "Ensemble, Test", "aliases": ["The Test Ensemble"],
         "featuredTrackCount": 0, "visibleFeaturedTrackCount": 0},
    ]


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

    def role(self):
        cookie = self.headers.get("Cookie", "")
        if "mihonban_session=fixture-admin" in cookie:
            return "admin"
        return "user" if "mihonban_session=fixture-session" in cookie else None

    def authorized(self):
        return self.role() is not None

    def body(self):
        try:
            return json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None

    def do_POST(self):
        if self.path != "/api/login":
            return self.reply(404, {})
        data = self.body()
        if data is None:
            return self.reply(400, {})
        sessions = {"fixture-password": ("user", "fixture-session"), "fixture-admin": ("admin", "fixture-admin")}
        if data.get("password") not in sessions:
            return self.reply(401, {})
        role, token = sessions[data["password"]]
        self.reply(200, {"ok": True, "role": role, "guest": False}, headers={
            "Set-Cookie": f"mihonban_session={token}; Path=/; HttpOnly; SameSite=Lax"})

    def do_PUT(self):
        self.write_favorite(True)

    def do_DELETE(self):
        self.write_favorite(False)

    # Favorites writes mirror the worker: admin only, reorder takes the full list.
    def write_favorite(self, enabled):
        match = re.fullmatch(r"/api/favorites/(album|track)/([^/]+)", urlsplit(self.path).path)
        if not match:
            return self.reply(404, {})
        if self.role() != "admin":
            return self.reply(401 if self.role() is None else 403, {})
        kind, item = match[1], match[2]
        items = self.server.favorites[kind]
        if item == "reorder" and enabled:
            ids = (self.body() or {}).get("ids")
            if not isinstance(ids, list) or sorted(ids) != sorted(items):
                return self.reply(400, {})
            items[:] = ids
            return self.reply(200, {"ok": True})
        if item in items:
            items.remove(item)
        if enabled:
            items.insert(0, item)
        self.reply(200, {"ok": True})

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/health":
            return self.reply(200, {"ok": True})
        if path == "/fixture/media-cookies":
            return self.reply(200, {"cookies": self.server.media_cookies})
        if path == "/api/me":
            return self.reply(200, {"ok": self.authorized(), "role": self.role(), "guest": False})
        if path.startswith("/api/") and not self.authorized():
            return self.reply(401, {})
        if path == "/api/library":
            if self.headers.get("If-None-Match") == '"fixture-1"':
                return self.reply(304, b"", headers={"ETag": '"fixture-1"'})
            return self.reply(200, [album(ext) for ext in FORMATS], headers={"ETag": '"fixture-1"'})
        if path == "/api/tracks":
            if self.headers.get("If-None-Match") == '"fixture-trk-1"':
                return self.reply(304, b"", headers={"ETag": '"fixture-trk-1"'})
            return self.reply(200, [track_row(ext) for ext in FORMATS], headers={"ETag": '"fixture-trk-1"'})
        if path == "/api/artists":
            return self.reply(200, artists())
        if path == "/api/favorites":
            pick = lambda kind: [{"id": item, "ts": 1, "order": index}
                                 for index, item in enumerate(self.server.favorites[kind])]
            return self.reply(200, {"albums": pick("album"), "tracks": pick("track")})
        match = re.fullmatch(r"/api/artists/([^/]+)/tracks", path)
        if match:
            name = unquote(match[1])
            return self.reply(200, [dict(track_row("ogg"), hasCustomArtists=True)] if name == "Session Player" else [])
        if path.startswith("/api/artist-bio/"):
            name = unquote(path.rsplit("/", 1)[-1])
            return self.reply(200, {"bio": "Formed for **testing**." if name == "Test Ensemble" else ""})
        if path.startswith("/api/album/network-"):
            ext = path.rsplit("-", 1)[-1]
            return self.reply(200, album(ext, detail=True)) if ext in FORMATS else self.reply(404, {})
        if path.startswith("/api/artist-art/") or path.startswith("/api/image/"):
            return self.reply(302, b"", headers={"Location": "/artwork/cover.png"})
        if path.startswith("/api/stream/network-"):
            parts = path.rsplit("/", 1)[-1].split("-")
            ext = parts[1] if len(parts) > 1 else ""
            if ext not in FORMATS:
                return self.reply(404, {})
            # "-remote" ids redirect to another origin (the next port), like a storage backend.
            if parts[-1] == "remote":
                port = self.server.server_address[1] + 1
                return self.reply(307, b"", headers={"Location": f"http://127.0.0.1:{port}/media/tone.{ext}"})
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
        # Records which host received a session cookie on a storage request.
        if path.startswith("/media/"):
            self.server.media_cookies.append({"port": self.server.server_address[1],
                                              "cookie": "mihonban_session" in self.headers.get("Cookie", "")})
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
    favorites = {"album": ["network-mp3", "network-ogg"], "track": ["network-flac"]}
    media_cookies = []
    servers = [ThreadingHTTPServer(("127.0.0.1", port), Handler) for port in (args.port, args.port + 1)]
    for server in servers:
        server.fixtures = root
        server.favorites = favorites
        server.media_cookies = media_cookies
        server.cover = root.parent / "Resources/Assets.xcassets/Logo.imageset/logo.png"
    # The second port stands in for a storage host on a different origin.
    threading.Thread(target=servers[1].serve_forever, daemon=True).start()
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
