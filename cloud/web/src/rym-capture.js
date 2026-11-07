// Self-contained so the extension can execute it in an isolated world on the active tab.
export function readRymPage(doc = document, pageUrl = location.href, observedAt = Date.now()) {
  const canonical = value => {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || !['rateyourmusic.com', 'www.rateyourmusic.com'].includes(u.hostname)
        || u.port || u.username || u.password || /%2f|%5c/i.test(u.pathname)
        || !/^\/release\/[a-z-]+\/[^/]+\/[^/]+(?:\/[^/]+)*\/?$/i.test(u.pathname)) return null;
      return `https://rateyourmusic.com${u.pathname.replace(/\/+$/, '')}/`;
    } catch { return null; }
  };
  const actual = pageUrl ? canonical(pageUrl) : null;
  if (pageUrl && !actual) throw new Error('invalidUrl');
  if (/just a moment|access denied|captcha|attention required/i.test(doc.title || '')
    || doc.querySelector('#challenge-running, #challenge-form, #cf-challenge-running')) throw new Error('challenge');
  const declared = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
    || doc.querySelector('meta[property="og:url"]')?.getAttribute('content');
  const rymUrl = declared ? canonical(new URL(declared, actual || 'https://rateyourmusic.com').href) : actual;
  if (!rymUrl || (actual && actual !== rymUrl)) throw new Error('invalidUrl');
  const text = selector => doc.querySelector(selector)?.textContent?.trim() || '';
  const album = [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap(el => {
    try { const v = JSON.parse(el.textContent); return Array.isArray(v) ? v : v['@graph'] || [v]; } catch { return []; }
  }).find(v => [v?.['@type']].flat().includes('MusicAlbum'));
  const titleEl = doc.querySelector('.album_title');
  let title = titleEl ? [...titleEl.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : '';
  title ||= album?.name || '';
  const artist = text('.album_info a.artist') || text('a.artist') || album?.byArtist?.name || '';
  if (!title || !artist || title.length > 1000 || artist.length > 1000) throw new Error('invalidPage');
  const snapshot = { title, artist, rymUrl, source: observedAt ? 'browser' : 'file', observedAt: observedAt || null };
  const ratingText = text('.avg_rating') || album?.aggregateRating?.ratingValue;
  const votesText = text('.num_ratings b') || text('.num_ratings') || album?.aggregateRating?.ratingCount;
  const rating = Number(String(ratingText ?? '').replace(',', '.'));
  const votes = Number(String(votesText ?? '').replace(/[^\d]/g, ''));
  if (ratingText != null && String(ratingText).trim() && Number.isFinite(rating) && rating >= 0 && rating <= 5) snapshot.rating = rating;
  if (votesText != null && /\d/.test(String(votesText)) && Number.isSafeInteger(votes) && votes >= 0) snapshot.votes = votes;
  for (const th of doc.querySelectorAll('th.info_hdr')) {
    const label = th.textContent.trim();
    const value = th.parentElement?.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim();
    if (label === 'Ranked' && value && value.length <= 500) snapshot.rank = value;
    if (label === 'Released') { const match = value?.match(/(?:19|20)\d\d/); if (match) snapshot.year = Number(match[0]); }
  }
  const selectors = { genres: '.release_pri_genres', secondaryGenres: '.release_sec_genres', descriptors: '.release_pri_descriptors' };
  for (const [field, selector] of Object.entries(selectors)) {
    const element = doc.querySelector(selector);
    if (!element) continue;
    const values = field === 'descriptors' ? element.textContent.split(',') : [...element.querySelectorAll('a.genre')].map(a => a.textContent);
    snapshot[field] = [...new Set(values.map(v => v.trim()).filter(v => v && v.length <= 200))].slice(0, 200);
  }
  if (!('rating' in snapshot) && !('votes' in snapshot) && !['genres', 'secondaryGenres', 'descriptors'].some(k => snapshot[k]?.length)) throw new Error('emptySnapshot');
  if (JSON.stringify(snapshot).length > 24_000) throw new Error('invalidPage');
  return snapshot;
}

export function encodeCapture(snapshot) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(snapshot))))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCapture(encoded) {
  if (encoded.length > 100_000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('invalidSnapshot');
  const bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  validateIncoming(result);
  return result;
}

export function validateIncoming(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || JSON.stringify(result).length > 24_000) throw new Error('invalidSnapshot');
  for (const k of ['title', 'artist', 'rymUrl']) if (typeof result[k] !== 'string' || !result[k] || result[k].length > 2000) throw new Error('invalidSnapshot');
  const url = new URL(result.rymUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'rateyourmusic.com' || !url.pathname.startsWith('/release/') || url.username || url.password || url.port) throw new Error('invalidUrl');
  for (const k of ['rating', 'votes', 'observedAt', 'year']) if (result[k] != null && (typeof result[k] !== 'number' || !Number.isFinite(result[k]))) throw new Error('invalidSnapshot');
  for (const k of ['genres', 'secondaryGenres', 'descriptors']) if (result[k] != null && (!Array.isArray(result[k]) || result[k].length > 200 || result[k].some(v => typeof v !== 'string' || v.length > 200))) throw new Error('invalidSnapshot');
  if (!['browser', 'file'].includes(result.source)) throw new Error('invalidSnapshot');
  if (result.rank != null && (typeof result.rank !== 'string' || result.rank.length > 500)) throw new Error('invalidSnapshot');
  return result;
}

export const CAPTURE_KEY = 'mihonban_rym_capture';
export function receiveCapture() {
  const prefix = '#/rym/inbox/';
  if (!location.hash.startsWith(prefix)) return;
  try { sessionStorage.setItem(CAPTURE_KEY, JSON.stringify(decodeCapture(location.hash.slice(prefix.length)))); }
  catch { try { sessionStorage.removeItem(CAPTURE_KEY); } catch { /* Storage may be unavailable. */ } }
  history.replaceState(history.state, '', location.pathname + location.search + '#/rym');
}
