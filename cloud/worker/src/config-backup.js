// Configuration that may move between deployments. Authentication hashes,
// session state, heartbeats, scan status, and caches are intentionally absent.
export const CONFIG_BACKUP_SETTING_KEYS = Object.freeze([
  "r2_enabled", "r2_access_key", "r2_secret_key", "r2_endpoint",
  "r2_bucket", "r2_public_url",
  "discogs_token",
  "guest_open", "module_source", "stream_proxy", "stream_proxy_url",
  "source_url", "archive_passwords",
]);
