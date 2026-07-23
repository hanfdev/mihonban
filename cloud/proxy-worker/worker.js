// Stateless Cloudflare Worker proxy for mihonban audio streams.
// It validates short-lived HMAC hand-offs, restricts upstream hosts, forwards
// byte ranges, and validates each redirect hop so it cannot become an SSRF or
// public open-proxy endpoint.

const encoder = new TextEncoder();
const MIN_PROXY_SECRET_LENGTH = 32;

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(hostname, patterns) {
  const host = hostname.toLowerCase();
  return patterns.some((pattern) => pattern.startsWith(".")
    ? host.endsWith(pattern) && host !== pattern.slice(1)
    : host === pattern);
}

function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signature(source, expires, secret) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
  const bytes = await crypto.subtle.sign(
    "HMAC", key, encoder.encode(`${expires}\n${source}`));
  return base64url(bytes);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = csv(env.ALLOWED_ORIGINS);
  const allowOrigin = !allowed.length || allowed.includes("*") ? "*"
    : (origin && allowed.includes(origin.toLowerCase()) ? origin : "");
  const headers = {
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers":
      "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified",
    "Vary": "Origin",
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}

function response(request, env, body, status, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(request, env),
      ...extra,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function fail(request, env, status, message) {
  return response(request, env, JSON.stringify({ error: message }), status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

async function verify(request, env, source) {
  const secret = String(env.PROXY_SECRET || "");
  if (secret.length < MIN_PROXY_SECRET_LENGTH && env.ALLOW_UNSIGNED !== "1") {
    return "proxy secret is not configured securely";
  }
  if (!secret) return null;
  const params = new URL(request.url).searchParams;
  const expires = Number(params.get("expires"));
  const sig = params.get("sig") || "";
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires < now - 30 || expires > now + 600) {
    return "signed URL expired";
  }
  const expected = await signature(source, expires, secret);
  if (!sameBytes(expected, sig)) return "invalid signature";
  return null;
}

function upstreamHeaders(request) {
  const headers = new Headers();
  for (const name of ["Range", "If-Range", "If-None-Match",
    "If-Modified-Since", "Accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function fetchUpstream(source, request, env) {
  let current = new URL(source);
  const allowed = csv(env.ALLOWED_HOSTS);
  for (let hop = 0; hop < 4; hop++) {
    if (current.protocol !== "https:" && env.ALLOW_HTTP !== "1") {
      return { error: "upstream must use HTTPS" };
    }
    if (!hostAllowed(current.hostname, allowed)) {
      return { error: "upstream host is not allowed" };
    }
    let upstream;
    try {
      upstream = await fetch(current, {
        method: request.method,
        headers: upstreamHeaders(request),
        redirect: "manual",
      });
    } catch {
      return { error: "upstream connection failed" };
    }
    if (upstream.status < 300 || upstream.status >= 400) return { upstream };
    const location = upstream.headers.get("Location");
    if (!location) return { error: "upstream redirect has no location" };
    try { current = new URL(location, current); }
    catch { return { error: "upstream redirect is invalid" }; }
  }
  return { error: "too many upstream redirects" };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (url.pathname === "/healthz") {
      return response(request, env, "ok\n", 200, { "Content-Type": "text/plain" });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return fail(request, env, 405, "method not allowed");
    }
    const source = url.searchParams.get("url");
    if (!source) return fail(request, env, 400, "missing url");
    let parsed;
    try { parsed = new URL(source); } catch { return fail(request, env, 400, "invalid url"); }
    if (!hostAllowed(parsed.hostname, csv(env.ALLOWED_HOSTS))) {
      return fail(request, env, 403, "upstream host is not allowed");
    }
    const authError = await verify(request, env, source);
    if (authError) return fail(request, env, 401, authError);
    const result = await fetchUpstream(source, request, env);
    if (result.error) return fail(request, env, 502, result.error);
    const upstream = result.upstream;
    const headers = new Headers(corsHeaders(request, env));
    for (const name of ["Content-Type", "Content-Length", "Content-Range",
      "Accept-Ranges", "ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Content-Disposition", "inline");
    headers.set("Cache-Control", "private, no-store");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};

export { hostAllowed, signature };
