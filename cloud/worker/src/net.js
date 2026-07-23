// Small fetch guard shared by storage backends.  Fetch resolves when response
// headers arrive, so this protects token/metadata/PUT handshakes without
// imposing a short deadline on the subsequent audio or upload body stream.
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export async function discardResponse(response) {
  try { await response?.body?.cancel(); } catch { /* best effort */ }
}

export async function fetchWithTimeout(input, init = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(input, init);
  }
  const controller = new AbortController();
  let parentAbort;
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason);
    else {
      parentAbort = () => controller.abort(init.signal.reason);
      init.signal.addEventListener("abort", parentAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (parentAbort) init.signal.removeEventListener("abort", parentAbort);
  }
}
