import argparse
import json
import re
import socket
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


def edited(out, state, detail):
    """Applies administrator edits, mirroring the columns PATCH /api/album/:id writes."""
    changes = state.edits.get(out["id"], {})
    for key in ("title", "year", "genres", "secondaryGenres"):
        if key in changes:
            out[key] = changes[key]
    if "artists" in changes:
        out["artists"] = changes["artists"]
        out["artist"] = credit(changes["artists"])
        out["artistSort"] = changes["artists"][0]["sort"]
    if "descriptors" in changes and out.get("rym") is not None:
        out["rym"] = dict(out["rym"], descriptors=changes["descriptors"])
    if detail and "note" in changes:
        out["note"] = changes["note"]
    out["hidden"] = out["id"] in state.hidden
    if changes:
        out["updatedAt"] = state.revision
    return out


def visible(state, include_hidden):
    return [ext for ext in FORMATS if f"network-{ext}" not in state.deleted
            and (include_hidden or f"network-{ext}" not in state.hidden)]


def clean_list(value):
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return None
    seen, out = set(), []
    for item in (item.strip() for item in value):
        if item and item.lower() not in seen:
            seen.add(item.lower())
            out.append(item)
    return out


class State:
    def __init__(self):
        self.revision = 1
        self.reset()

    def reset(self):
        # Revisions only grow, so an ETag from before a reset never matches again.
        self.revision += 1
        self.edits, self.hidden, self.deleted = {}, set(), set()
        self.favorites = {"album": ["network-mp3", "network-ogg"], "track": ["network-flac"]}


class StreamGates:
    """Hold selected audio responses until a test releases their unique token."""
    def __init__(self):
        self.lock = threading.Lock()
        self.events = {}

    def event(self, token):
        with self.lock:
            return self.events.setdefault(token, threading.Event())


class StreamRecovery:
    """Isolate deliberate connection loss and request evidence by test token."""
    def __init__(self):
        self.lock = threading.Lock()
        self.scenarios = {}
        self.interrupts = {}

    def configure(self, token, options):
        with self.lock:
            self.scenarios[token] = {
                "failures": max(0, min(8, int(options.get("failures", 1)))),
                "prefix": max(0, min(262144, int(options.get("prefix", 8192)))),
                "ignoreRange": bool(options.get("ignoreRange", False)),
                "status": int(options.get("status", 0)),
                "hold": bool(options.get("hold", False)),
                "interruptWhenRequested": bool(options.get("interruptWhenRequested", False)),
                "released": False, "attempts": [], "drops": 0,
            }
            self.interrupts[token] = threading.Event()

    def release(self, token):
        with self.lock:
            if token in self.scenarios:
                self.scenarios[token]["released"] = True
                self.interrupts[token].set()

    def interrupt(self, token):
        with self.lock:
            if token in self.interrupts:
                self.interrupts[token].set()

    def snapshot(self, token):
        with self.lock:
            value = self.scenarios.get(token)
            return None if value is None else json.loads(json.dumps(value))

    def begin(self, token, start):
        with self.lock:
            value = self.scenarios.get(token)
            if value is None:
                return None
            number = len(value["attempts"]) + 1
            failed = (value["hold"] and not value["released"]) or number <= value["failures"]
            attempt = {"start": start, "sent": 0, "finished": False, "drop": failed}
            value["attempts"].append(attempt)
            return dict(value, attempt=number - 1, drop=failed, owner=value,
                        interruptGate=self.interrupts[token])

    def finish(self, scenario, sent, dropped):
        with self.lock:
            value = scenario["owner"]
            value["attempts"][scenario["attempt"]].update(sent=sent, finished=True)
            if dropped:
                value["drops"] += 1


def flac_metadata_end(data):
    """Return the first audio-frame byte without passing any PCM to a decoder."""
    if data[:4] != b"fLaC":
        raise ValueError("The prefetch fixture requires native FLAC")
    offset = 4
    while offset + 4 <= len(data):
        last = bool(data[offset] & 0x80)
        length = int.from_bytes(data[offset + 1:offset + 4], "big")
        offset += 4 + length
        if offset > len(data):
            break
        if last and offset < len(data):
            return offset
    raise ValueError("The prefetch fixture has incomplete metadata")


class PrefetchDecoderFailures:
    """Let decoder.open finish, hold every PCM frame, then fail real reads."""
    def __init__(self):
        self.lock = threading.Lock()
        self.scenarios = {}

    def scenario(self, token):
        with self.lock:
            return self.scenarios.setdefault(token, {
                "event": threading.Event(), "failed": False, "released": False, "active": 0,
                "failuresRemaining": 0,
                "metadataSent": 0, "metadataBytes": 0, "drops": 0, "requests": [],
            })

    def fail(self, token):
        value = self.scenario(token)
        with self.lock:
            value["failed"] = True
            value["event"].set()

    def fail_then_recover(self, token):
        value = self.scenario(token)
        with self.lock:
            value["failed"] = True
            value["failuresRemaining"] = 1
            value["event"].set()

    def release(self, token):
        value = self.scenario(token)
        with self.lock:
            value["released"] = True
            value["event"].set()

    def should_fail(self, value):
        with self.lock:
            return value["failed"] or not value["released"]

    def begin(self, token, start):
        value = self.scenario(token)
        with self.lock:
            failed = value["failed"]
            if failed and value["failuresRemaining"] > 0:
                value["failuresRemaining"] -= 1
                if value["failuresRemaining"] == 0:
                    value["failed"] = False
                    value["released"] = True
            value["requests"].append({"start": start, "status": 404 if failed else 206})
            if not failed:
                value["active"] += 1
            return value, failed

    def metadata(self, value, count):
        with self.lock:
            value["metadataSent"] += 1
            value["metadataBytes"] = count

    def finished(self, value, dropped=True):
        with self.lock:
            value["active"] -= 1
            if dropped:
                value["drops"] += 1

    def snapshot(self, token):
        value = self.scenario(token)
        with self.lock:
            return {key: json.loads(json.dumps(item)) for key, item in value.items() if key != "event"}


def track_row(extension, state=None):
    detail = album(extension, detail=True)
    if state is not None:
        detail = edited(detail, state, True)
    row = dict(detail["tracks"][0])
    for key in ("titleOverride", "bitrate", "size", "path"):
        row.pop(key)
    row.update({"albumId": detail["id"], "albumTitle": detail["title"], "year": detail["year"],
                "addedAt": detail["createdAt"], "hidden": int(bool(detail["hidden"]))})
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


def mp3_with_large_tag(data, cover):
    """Add synthetic ID3v2.4 artwork and padding without using real music."""
    def synchsafe(size):
        return bytes((size >> shift) & 127 for shift in (21, 14, 7, 0))

    if data.startswith(b"ID3"):
        size = sum(value << shift for value, shift in zip(data[6:10], (21, 14, 7, 0)))
        data = data[10 + size:]
    artwork = b"\x03image/png\x00\x03\x00" + cover
    tag = b"APIC" + synchsafe(len(artwork)) + b"\x00\x00" + artwork + bytes(192 * 1024)
    return b"ID3\x04\x00\x00" + synchsafe(len(tag)) + tag + data


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

    def admin_only(self):
        if self.role() == "admin":
            return True
        self.reply(401 if self.role() is None else 403, {"error": "forbidden"})
        return False

    def known(self, album_id):
        if album_id in {f"network-{ext}" for ext in FORMATS} and album_id not in self.server.state.deleted:
            return True
        self.reply(404, {"error": "not found"})
        return False

    def do_POST(self):
        path = urlsplit(self.path).path
        state = self.server.state
        prefetch = re.fullmatch(r"/fixture/prefetch-decoder/([a-fA-F0-9-]+)/(fail|fail-recover|release)", path)
        if prefetch:
            if prefetch[2] == "fail":
                self.server.prefetch_failures.fail(prefetch[1])
            elif prefetch[2] == "fail-recover":
                self.server.prefetch_failures.fail_then_recover(prefetch[1])
            else:
                self.server.prefetch_failures.release(prefetch[1])
            return self.reply(200, {"ok": True})
        gate = re.fullmatch(r"/fixture/stream-gate/([a-fA-F0-9-]+)/release", path)
        if gate:
            self.server.stream_gates.event(gate[1]).set()
            return self.reply(200, {"ok": True})
        recovery = re.fullmatch(r"/fixture/stream-recovery/([a-fA-F0-9-]+)(/release|/interrupt)?", path)
        if recovery:
            if recovery[2] == "/release":
                self.server.stream_recovery.release(recovery[1])
            elif recovery[2] == "/interrupt":
                self.server.stream_recovery.interrupt(recovery[1])
            else:
                self.server.stream_recovery.configure(recovery[1], self.body() or {})
            return self.reply(200, {"ok": True})
        if path == "/fixture/reset":
            state.reset()
            return self.reply(200, {"ok": True})
        match = re.fullmatch(r"/api/album/(network-[a-z]+)/hide", path)
        if match:
            if not self.admin_only() or not self.known(match[1]):
                return
            hidden = (self.body() or {}).get("hidden")
            if hidden not in (True, False, 1, 0, "1", "0"):
                return self.reply(400, {"error": "hidden"})
            (state.hidden.add if hidden in (True, 1, "1") else state.hidden.discard)(match[1])
            state.revision += 1
            return self.reply(200, {"ok": True})
        if path != "/api/login":
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
        parts = urlsplit(self.path)
        match = re.fullmatch(r"/api/album/(network-[a-z]+)", parts.path)
        if not match:
            return self.write_favorite(False)
        if not self.admin_only() or not self.known(match[1]):
            return
        state = self.server.state
        state.deleted.add(match[1])
        for items in state.favorites.values():
            if match[1] in items:
                items.remove(match[1])
        state.revision += 1
        self.reply(200, {"ok": True, "filesDeleted": parts.query == "files=1"})

    # Validation follows the worker's PATCH /api/album/:id for the fields the app sends.
    def do_PATCH(self):
        match = re.fullmatch(r"/api/album/(network-[a-z]+)", urlsplit(self.path).path)
        if not match:
            return self.reply(404, {})
        if not self.admin_only() or not self.known(match[1]):
            return
        state = self.server.state
        data = self.body()
        if not isinstance(data, dict):
            return self.reply(400, {"error": "json"})
        current = edited(album(match[1].split("-", 1)[1], detail=True), state, True)
        changes = {}
        if "title" in data:
            title = data["title"].strip() if isinstance(data["title"], str) else ""
            if not title or len(title) > 1000:
                return self.reply(400, {"error": "title"})
            changes["title"] = title
        if "year" in data:
            year = data["year"]
            if year is not None and (isinstance(year, bool) or not isinstance(year, int) or not 1 <= year <= 9999):
                return self.reply(400, {"error": "year"})
            changes["year"] = year
        if "artists" in data:
            artists = data["artists"]
            if not isinstance(artists, list) or not 1 <= len(artists) <= 24:
                return self.reply(400, {"error": "artists"})
            names = [a["name"].strip() if isinstance(a, dict) and isinstance(a.get("name"), str) else ""
                     for a in artists]
            if not all(names) or len({name.lower() for name in names}) != len(names):
                return self.reply(400, {"error": "artists"})
            changes["artists"] = [{"name": name, "sort": (a.get("sort") or "").strip()}
                                  for name, a in zip(names, artists)]
        if "genres" in data or "secondaryGenres" in data:
            primary = clean_list(data["genres"]) if "genres" in data else current["genres"]
            secondary = clean_list(data["secondaryGenres"]) if "secondaryGenres" in data else current["secondaryGenres"]
            if primary is None or secondary is None:
                return self.reply(400, {"error": "genre"})
            taken = {item.lower() for item in primary}
            changes["genres"] = primary
            changes["secondaryGenres"] = [item for item in secondary if item.lower() not in taken]
        if "descriptors" in data:
            descriptors = clean_list(data["descriptors"])
            if descriptors is None:
                return self.reply(400, {"error": "descriptors"})
            changes["descriptors"] = descriptors
        if "note" in data:
            if not isinstance(data["note"], str) or len(data["note"]) > 200_000:
                return self.reply(400, {"error": "note"})
            changes["note"] = data["note"].strip()
        if not changes:
            return self.reply(400, {"error": "no fields"})
        state.edits.setdefault(match[1], {}).update(changes)
        state.revision += 1
        self.reply(200, {"ok": True})

    # Favorites writes mirror the worker: admin only, reorder takes the full list.
    def write_favorite(self, enabled):
        match = re.fullmatch(r"/api/favorites/(album|track)/([^/]+)", urlsplit(self.path).path)
        if not match:
            return self.reply(404, {})
        if self.role() != "admin":
            return self.reply(401 if self.role() is None else 403, {})
        kind, item = match[1], match[2]
        items = self.server.state.favorites[kind]
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
        prefetch = re.fullmatch(r"/fixture/prefetch-decoder/([a-fA-F0-9-]+)", path)
        if prefetch:
            return self.reply(200, self.server.prefetch_failures.snapshot(prefetch[1]))
        prefetch = re.fullmatch(r"/prefetch-decoder/([a-fA-F0-9-]+)/tone\.flac", path)
        if prefetch:
            return self.prefetch_decoder_audio(prefetch[1])
        recovery = re.fullmatch(r"/fixture/stream-recovery/([a-fA-F0-9-]+)", path)
        if recovery:
            value = self.server.stream_recovery.snapshot(recovery[1])
            return self.reply(200 if value is not None else 404, value or {})
        recovery = re.fullmatch(r"/recovery/([a-fA-F0-9-]+)/tone\.flac", path)
        if recovery:
            return self.recovery_audio(recovery[1])
        if path == "/api/health":
            return self.reply(200, {"ok": True})
        if path == "/fixture/media-cookies":
            return self.reply(200, {"cookies": self.server.media_cookies})
        if path == "/api/me":
            return self.reply(200, {"ok": self.authorized(), "role": self.role(), "guest": False})
        if path.startswith("/api/") and not self.authorized():
            return self.reply(401, {})
        state = self.server.state
        include_hidden = urlsplit(self.path).query == "hidden=1" and self.role() == "admin"
        if path in ("/api/library", "/api/tracks"):
            prefix = "fixture" if path == "/api/library" else "fixture-trk"
            tag = f'"{prefix}-{state.revision}{"-h" if include_hidden else ""}"'
            if self.headers.get("If-None-Match") == tag:
                return self.reply(304, b"", headers={"ETag": tag})
            shown = visible(state, include_hidden)
            rows = ([edited(album(ext), state, False) for ext in shown] if path == "/api/library"
                    else [track_row(ext, state) for ext in shown])
            return self.reply(200, rows, headers={"ETag": tag})
        if path == "/api/artists":
            return self.reply(200, artists())
        if path == "/api/favorites":
            pick = lambda kind: [{"id": item, "ts": 1, "order": index}
                                 for index, item in enumerate(state.favorites[kind])]
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
            album_id = f"network-{ext}"
            if ext not in FORMATS or album_id in state.deleted or (album_id in state.hidden and self.role() != "admin"):
                return self.reply(404, {})
            return self.reply(200, edited(album(ext, detail=True), state, True))
        if path.startswith("/api/artist-art/") or path.startswith("/api/image/"):
            return self.reply(302, b"", headers={"Location": "/artwork/cover.png"})
        if path.startswith("/api/stream/network-"):
            parts = path.rsplit("/", 1)[-1].split("-")
            ext = parts[1] if len(parts) > 1 else ""
            if ext not in FORMATS:
                return self.reply(404, {})
            prefetch = re.fullmatch(r"network-flac-prefetch-failure-([a-fA-F0-9-]+)", path.rsplit("/", 1)[-1])
            if prefetch:
                return self.reply(307, b"", headers={"Location": f"/prefetch-decoder/{prefetch[1]}/tone.flac"})
            recovery = re.fullmatch(r"network-flac-recovery-([a-fA-F0-9-]+)", path.rsplit("/", 1)[-1])
            if recovery:
                return self.reply(307, b"", headers={"Location": f"/recovery/{recovery[1]}/tone.flac"})
            gate = re.fullmatch(r"network-[a-z]+-held-([a-fA-F0-9-]+)", path.rsplit("/", 1)[-1])
            if gate and not self.server.stream_gates.event(gate[1]).wait(30):
                return self.reply(503, {})
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
        fragmented = re.fullmatch(r"/fragmented-mp3/([a-fA-F0-9-]+)/tone\.mp3", path)
        if fragmented:
            data = mp3_with_large_tag(data, self.server.cover.read_bytes())
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
            if fragmented:
                # Hold after a real partial body so the read test can observe
                # the decoder waiting, then release it without timing races.
                boundary = min(start + 1024, end + 1)
                self.wfile.write(data[start:boundary])
                self.wfile.flush()
                if not self.server.stream_gates.event(fragmented[1]).wait(30):
                    self.close_connection = True
                    return
                start = boundary
            for position in range(start, end + 1, 8192):
                self.wfile.write(data[position:min(position + 8192, end + 1)])
                self.wfile.flush()
                time.sleep(0.01 if fragmented else 0.002)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def recovery_audio(self, token):
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", "bytes=0-"))
        if not match:
            return self.reply(400, {})
        requested = int(match[1])
        scenario = self.server.stream_recovery.begin(token, requested)
        if scenario is None:
            return self.reply(404, {})
        index = scenario["attempt"]
        if scenario["status"]:
            self.server.stream_recovery.finish(scenario, 0, False)
            return self.reply(scenario["status"], {})
        data = (self.server.fixtures / "tone.flac").read_bytes()
        start = 0 if scenario["ignoreRange"] else requested
        if start >= len(data):
            self.server.stream_recovery.finish(scenario, 0, False)
            return self.reply(416, b"", headers={"Content-Range": f"bytes */{len(data)}"})
        self.send_response(200 if scenario["ignoreRange"] else 206)
        self.send_header("Content-Type", "audio/flac")
        self.send_header("Content-Length", str(len(data) - start))
        self.send_header("Connection", "close")
        if not scenario["ignoreRange"]:
            self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
        self.end_headers()
        # Only the first broken response provides bytes; later failures model
        # an outage without granting the decoder more data on every retry.
        end = len(data)
        if scenario["drop"]:
            end = min(len(data), start + scenario["prefix"]) if index == 0 else start
        sent = 0
        try:
            for position in range(start, end, 4096):
                chunk = data[position:min(position + 4096, end)]
                self.wfile.write(chunk)
                self.wfile.flush()
                sent += len(chunk)
                time.sleep(0.002)
            if scenario["drop"]:
                if index == 0 and scenario["interruptWhenRequested"]:
                    # A playback test decides when to cut the established
                    # stream, after the decoder has actually started playing.
                    scenario["interruptGate"].wait(15)
                # An incomplete body with a valid full Content-Length produces
                # a transport loss, not an HTTP status or decoder corruption.
                self.connection.shutdown(socket.SHUT_RDWR)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.close_connection = True
            self.server.stream_recovery.finish(scenario, sent, scenario["drop"])

    def prefetch_decoder_audio(self, token):
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", "bytes=0-"))
        if not match:
            return self.reply(400, {})
        start = int(match[1])
        scenario, failed = self.server.prefetch_failures.begin(token, start)
        if failed:
            return self.reply(404, {})
        data = (self.server.fixtures / "tone.flac").read_bytes()
        boundary = flac_metadata_end(data)
        if start >= len(data):
            self.server.prefetch_failures.finished(scenario)
            return self.reply(416, b"", headers={"Content-Range": f"bytes */{len(data)}"})
        self.send_response(206)
        self.send_header("Content-Type", "audio/flac")
        self.send_header("Content-Length", str(len(data) - start))
        self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
        self.send_header("Connection", "close")
        self.end_headers()
        dropped = True
        try:
            prefix = data[start:boundary] if start < boundary else b""
            if prefix:
                self.wfile.write(prefix)
                self.wfile.flush()
            self.server.prefetch_failures.metadata(scenario, len(prefix))
            # Releasing after renderingComplete creates a genuine decoder read
            # failure; no fake EOF callback or malformed FLAC is injected.
            scenario["event"].wait(30)
            if self.server.prefetch_failures.should_fail(scenario):
                self.server.prefetch_failures.fail(token)
                self.connection.shutdown(socket.SHUT_RDWR)
            else:
                for position in range(max(start, boundary), len(data), 8192):
                    self.wfile.write(data[position:position + 8192])
                    self.wfile.flush()
                    time.sleep(0.002)
                dropped = False
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.close_connection = True
            self.server.prefetch_failures.finished(scenario, dropped=dropped)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fixtures", type=Path)
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    root = args.fixtures.resolve()
    state = State()
    media_cookies = []
    stream_gates = StreamGates()
    stream_recovery = StreamRecovery()
    prefetch_failures = PrefetchDecoderFailures()
    servers = [ThreadingHTTPServer(("127.0.0.1", port), Handler) for port in (args.port, args.port + 1)]
    for server in servers:
        server.fixtures = root
        server.state = state
        server.media_cookies = media_cookies
        server.stream_gates = stream_gates
        server.stream_recovery = stream_recovery
        server.prefetch_failures = prefetch_failures
        server.cover = root.parent / "Resources/Assets.xcassets/Logo.imageset/logo.png"
    # The second port stands in for a storage host on a different origin.
    threading.Thread(target=servers[1].serve_forever, daemon=True).start()
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
