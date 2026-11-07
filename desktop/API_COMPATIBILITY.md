# Native client compatibility contract

[English](API_COMPATIBILITY.md) · [简体中文](API_COMPATIBILITY.zh.md) · [繁體中文](API_COMPATIBILITY.zh-Hant.md) · [日本語](API_COMPATIBILITY.ja.md) · [한국어](API_COMPATIBILITY.ko.md) · [Français](API_COMPATIBILITY.fr.md) · [Español](API_COMPATIBILITY.es.md)

The native client is separate from `cloud/web`. Mihonban server releases can change the web interface and deploy independently as long as the following API behavior remains compatible.

## Session and catalog

The client preserves session cookies between requests. A configured guest session can browse without a password; protected deployments require login. Hidden albums and shared-favorite changes remain subject to server permissions.

- `GET /api/health` returns any successful response.
- `GET /api/me` returns the current session object. A `401` means the client should show the password flow.
- `POST /api/login` accepts `{ "password": "..." }` and returns `{ "ok": true, "role": "user|admin" }`.
- `GET /api/library` returns the visible album array.
- `GET /api/tracks` returns the visible track array.
- `GET /api/album/:id` returns an album object with a `tracks` array.
- `GET /api/artists` returns artist metadata.
- `GET /api/favorites` returns an object containing `albums` and `tracks` arrays of entries with an `id`.
- `PUT /api/favorites/:kind/:id` adds a shared favorite and `DELETE` on the same path removes it; `kind` is `album` or `track`. These writes require administrator permission.

The album and track lists accept `?hidden=1` for an authorized administrator. Album details may also include `note`, `images` and `similar`. Artist names and item IDs are URL-encoded in request paths.

## Artwork and audio

- `GET /api/art/:albumId?s=480` returns an image body.
- `GET /api/image/:id?s=:size` returns an album gallery image.
- `GET /api/artist-bio/:name` returns an object containing the `bio` string.
- `GET /api/artist-art/:name` returns artist artwork; the client adds `?v=c` for a custom avatar.
- `GET /api/stream/:trackId` returns the original audio bytes or a successful redirect to them.

The desktop client downloads a complete audio file for local decoding and seeking; it does not require the Web player's streaming layout. Artwork downloads are limited to 32 MiB per response. See [`src/api.rs`](src/api.rs) for the exact request paths and deserialization defaults.

## Compatibility and client updates

The client ignores unknown JSON fields and provides defaults for optional fields defined in its models. Required fields such as album IDs, artist names and titles must retain compatible types; adding unknown fields does not make existing required fields optional. The client does not access the Mihonban database, storage credentials or deployment files. Server migrations, storage backends and client releases can therefore evolve independently within this API contract.

Client releases can use a separately hosted JSON manifest with `latest`, `download_url`, `sha256` and `notes`. Publish a SHA-256 checksum: the current client checks it only when the field is nonempty. Downloads are staged for manual executable replacement, not automatic installation or server updates. See the [desktop guide](README.md) for configuration, build and playback details.
