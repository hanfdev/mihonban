# Native client compatibility contract

The native client is separate from `cloud/web`. Mihonban server releases can change the web interface and deploy independently as long as the following API behavior remains compatible.

Required endpoints:

- `GET /api/health` returns any successful response.
- `GET /api/me` returns the current session object. A `401` means the client should show the password flow.
- `POST /api/login` accepts `{ "password": "..." }` and returns `{ "ok": true, "role": "user|admin" }`.
- `GET /api/library` returns the visible album array.
- `GET /api/tracks` returns the visible track array.
- `GET /api/album/:id` returns an album object with a `tracks` array.
- `GET /api/art/:albumId?s=480` returns an image body.
- `GET /api/stream/:trackId` returns the original audio bytes or a successful redirect to them.

The client treats newer JSON fields as optional and ignores fields it does not know. It does not access the Mihonban database, storage credentials, or deployment files. This keeps server migrations, storage backends, and the client release train independent.

Client releases use a separately hosted JSON manifest with a version, download URL, SHA-256 checksum, and release notes.
