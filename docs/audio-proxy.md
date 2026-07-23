# Optional Cloudflare audio proxy

[English](audio-proxy.md) · [简体中文](audio-proxy.zh.md) · [繁體中文](audio-proxy.zh-Hant.md) · [日本語](audio-proxy.ja.md) · [한국어](audio-proxy.ko.md) · [Français](audio-proxy.fr.md) · [Español](audio-proxy.es.md)

`cloud/proxy-worker` is a standalone Worker that relays temporary audio URLs for the main mihonban app. It is useful when a second Worker route or custom domain gives a better path to the storage CDN.

It does not cache audio and cannot guarantee higher speed. Measure before and after.

## Security model

- Main Worker signs the source URL and a five-minute expiry with `STREAM_PROXY_SECRET`.
- Proxy verifies the same value as `PROXY_SECRET`.
- Only GET, HEAD, and OPTIONS are accepted.
- Only HTTPS upstreams in `ALLOWED_HOSTS` are accepted.
- Every upstream redirect is checked against the allowlist.
- Range and conditional headers are forwarded; cookies and authorization headers are not.
- Responses are private/no-store.

Do not enable unsigned mode in production and do not set an unrestricted host wildcard.

## 1. Configure and deploy the proxy

Edit `cloud/proxy-worker/wrangler.jsonc`:

- `ALLOWED_HOSTS`: comma-separated exact hosts or suffixes beginning with a dot.
- `ALLOWED_ORIGINS`: your main mihonban origin; `*` works but a specific origin is preferable.

The default OneDrive suffixes are a starting point. Microsoft may redirect to a tenant or regional download domain; add only the exact suffix observed in a failed request.

```bash
cd cloud/proxy-worker
npm ci
npm test
npx wrangler login
npx wrangler secret put PROXY_SECRET
npx wrangler deploy
```

Use at least 32 random characters; a hex string generated from 32 random bytes is recommended. Retain it temporarily so the exact same value can be added to the main Worker.

## 2. Configure the main Worker

```bash
cd ../worker
npx wrangler secret put STREAM_PROXY_SECRET
npx wrangler deploy
```

Paste the exact same secret used for `PROXY_SECRET`.

In the mihonban Admin modules panel:

1. Enable audio proxy.
2. Set custom proxy URL to:

```text
https://mihonban-audio-proxy.<account>.workers.dev/?url={url}
```

3. Save and play a OneDrive-backed track.

The main Worker appends `expires` and `sig` automatically. Never put the shared secret in the URL.

## 3. Verify

```bash
curl https://mihonban-audio-proxy.<account>.workers.dev/healthz
```

Then use browser network tools while playing:

- Main `/api/stream/<id>` returns 302 to the proxy.
- Proxy returns 200 or 206.
- Seeking sends `Range` and receives `Content-Range`.
- An unsigned `?url=...` request returns 401.
- A disallowed host returns 403.

## Scope

The external proxy is used only when the main Worker can obtain a temporary download URL, currently OneDrive-style backends. WebDAV, Google Drive, and Node local storage require private credentials and remain behind the main Worker.

## Troubleshooting

| Status | Meaning/action |
|---|---|
| 401 | Secrets differ, signature expired, or main Worker was not redeployed |
| 403 | Initial source host is not allowlisted |
| 502 with host message | A redirect reached another host; review it before adding the suffix |
| 416 | Upstream rejected the requested byte range |
| Playback is slower | Disable external URL and use direct/main-Worker path |

Rotate both secrets together if the signing value is exposed. Existing signed URLs expire within five minutes.
