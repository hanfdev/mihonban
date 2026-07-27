// Cloudflare R2 图床（S3 API + SigV4）。凭据全部来自 DB 设置（后台可改），
// 不写死、不进 wrangler.jsonc——迁移云盘或轮换密钥都在管理后台完成。
//
// 写：PUT 走 S3 API（api endpoint + SigV4 签名）。
// 读：走公开域名（自定义域 / r2.dev），无需签名——图片字节永远不过 Worker，
//     彻底避免大库封面把 OneDrive Graph API 打爆。

import { getSetting } from "./auth.js";
import { discardResponse, fetchWithTimeout } from "./net.js";

const enc = new TextEncoder();
export const R2_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const hex = (buf) => [...new Uint8Array(buf)]
  .map((b) => b.toString(16).padStart(2, "0")).join("");

function httpUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash
      ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

async function sha256(data) {
  return crypto.subtle.digest("SHA-256",
    typeof data === "string" ? enc.encode(data) : data);
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey(
    "raw", key instanceof Uint8Array ? key : enc.encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

/** 读取 R2 配置（DB 优先，env 兜底）。缺关键项 → enabled:false。 */
export async function r2Conf(env) {
  const [ak, sk, endpoint, bucket, pub, on] = await Promise.all([
    getSetting(env, "r2_access_key"),
    getSetting(env, "r2_secret_key"),
    getSetting(env, "r2_endpoint"),
    getSetting(env, "r2_bucket"),
    getSetting(env, "r2_public_url"),
    getSetting(env, "r2_enabled"),
  ]);
  const conf = {
    accessKey: typeof (ak || env.R2_ACCESS_KEY) === "string"
      ? (ak || env.R2_ACCESS_KEY).trim() : "",
    secretKey: typeof (sk || env.R2_SECRET_KEY) === "string"
      ? (sk || env.R2_SECRET_KEY).trim() : "",
    endpoint: httpUrl(endpoint || env.R2_ENDPOINT),
    bucket: typeof (bucket || env.R2_BUCKET) === "string"
      ? (bucket || env.R2_BUCKET).trim() : "",
    publicUrl: httpUrl(pub || env.R2_PUBLIC_URL),
    enabled: on === "1",
  };
  conf.ready = !!(conf.enabled && conf.accessKey && conf.secretKey
    && conf.endpoint && conf.bucket && conf.publicUrl);
  // configured = 凭据齐全（不含 enabled）：用于「先测试再启用」
  conf.configured = !!(conf.accessKey && conf.secretKey
    && conf.endpoint && conf.bucket && conf.publicUrl);
  return conf;
}

/** 公开读地址（不签名，走 CDN）。稳定版本号可绕过浏览器缓存过的旧 404。 */
export const r2PublicUrl = (conf, key, version = null) => {
  const url = new URL(`${conf.publicUrl}/${key}`);
  if (version !== null && version !== undefined && version !== "") {
    url.searchParams.set("v", String(version));
  }
  return url.toString();
};

/** Check the public mirror without downloading it. A missing index can then
 * be rebuilt without fetching and uploading the source image again. */
export async function r2PublicObjectExists(conf, key) {
  if (!conf?.publicUrl || typeof key !== "string" || !key) {
    throw new Error("R2 public object check is not configured");
  }
  const response = await fetchWithTimeout(r2PublicUrl(conf, key), {
    method: "HEAD",
    headers: { "Cache-Control": "no-cache" },
  }, 5_000);
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new Error(`R2 public object check failed: ${response.status}`);
}

/** SigV4 上传对象到 R2。返回 true/false。 */
export async function r2Put(conf, key, bytes, contentType = "application/octet-stream") {
  const url = new URL(`${conf.endpoint}/${conf.bucket}/${key}`);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const payloadHash = hex(await sha256(bytes));

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    url.pathname.split("/").map(encodeURIComponent).join("/"),
    "", // query
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hex(await sha256(canonicalRequest)),
  ].join("\n");

  const kDate = await hmac(`AWS4${conf.secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${conf.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    "Authorization": authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "Content-Type": contentType,
  };
  if (/^image\//i.test(contentType)) {
    headers["Cache-Control"] = R2_IMAGE_CACHE_CONTROL;
  }
  const r = await fetchWithTimeout(url, {
    method: "PUT",
    headers,
    body: bytes,
  }, 60_000);
  return r.ok;
}

/** Upgrade an existing image object's HTTP metadata without downloading or
 * uploading its bytes. CopyObject runs entirely inside R2. */
export async function r2ApplyImageCacheControl(
  conf, key, contentType = "image/jpeg") {
  const url = new URL(`${conf.endpoint}/${conf.bucket}/${key}`);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const payloadHash = hex(await sha256(new Uint8Array()));
  const sourcePath = `/${encodeURIComponent(conf.bucket)}/` +
    key.split("/").map(encodeURIComponent).join("/");
  const canonicalHeaders =
    `cache-control:${R2_IMAGE_CACHE_CONTROL}\n` +
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-copy-source:${sourcePath}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-metadata-directive:REPLACE\n`;
  const signedHeaders = "cache-control;content-type;host;" +
    "x-amz-content-sha256;x-amz-copy-source;x-amz-date;x-amz-metadata-directive";
  const canonicalRequest = [
    "PUT",
    url.pathname.split("/").map(encodeURIComponent).join("/"),
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hex(await sha256(canonicalRequest)),
  ].join("\n");
  const kDate = await hmac(`AWS4${conf.secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${conf.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetchWithTimeout(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Cache-Control": R2_IMAGE_CACHE_CONTROL,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-copy-source": sourcePath,
      "x-amz-date": amzDate,
      "x-amz-metadata-directive": "REPLACE",
    },
  }, 60_000);
  return response.ok;
}

/** Delete a mirrored object with SigV4. Missing objects are already purged. */
export async function r2Delete(conf, key) {
  const url = new URL(`${conf.endpoint}/${conf.bucket}/${key}`);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const payloadHash = hex(await sha256(new Uint8Array()));
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "DELETE",
    url.pathname.split("/").map(encodeURIComponent).join("/"),
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hex(await sha256(canonicalRequest)),
  ].join("\n");
  const kDate = await hmac(`AWS4${conf.secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${conf.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  });
  return response.ok || response.status === 404;
}

/** 连通性测试：上传一个探针对象再公开读回。返回 {ok, error?}。 */
export async function r2Test(conf) {
  if (!conf.configured) return { ok: false, error: "R2 配置不完整" };
  const key = `_probe/mihonban-${Date.now().toString(36)}-` +
    `${Math.random().toString(36).slice(2)}.txt`;
  try {
    const body = enc.encode(`mihonban r2 probe ${Date.now()}`);
    const put = await r2Put(conf, key, body, "text/plain");
    if (!put) return { ok: false, error: "上传失败（检查密钥/endpoint/桶名）" };
    const readable = await fetchWithTimeout(
      r2PublicUrl(conf, key), { method: "GET" });
    // 探测只看状态码；两个分支都要取消 body，别占着子请求连接
    await discardResponse(readable);
    if (!readable.ok) {
      return { ok: false, error: `公开读失败 ${readable.status}（检查公开域名/桶公开权限）` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    await r2Delete(conf, key).catch(() => false);
  }
}
