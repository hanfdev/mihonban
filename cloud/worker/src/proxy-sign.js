// Signed hand-off for the optional external audio proxy Worker.
// The source URL is short-lived, so sign it together with a separate expiry.

const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function signProxyTarget(target, sourceUrl, secret, ttlSeconds = 300) {
  if (!secret) return target;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("proxy signing secret must contain at least 32 characters");
  }
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
  const signature = base64url(await crypto.subtle.sign(
    "HMAC", key, encoder.encode(`${expires}\n${sourceUrl}`)));
  const out = new URL(target);
  out.searchParams.set("expires", String(expires));
  out.searchParams.set("sig", signature);
  return out.toString();
}
