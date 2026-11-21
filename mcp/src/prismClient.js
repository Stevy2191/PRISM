// A small client for PRISM's /api/v1, authenticated with an API key.
// Every call acts with the key owner's permissions: the server enforces them,
// so this client never decides what a caller may see.

export class PrismApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'PrismApiError';
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

// PRISM_URL may be the site root (https://help.example.com) or already end in
// /api/v1; both resolve to the same API base.
export function apiBase(url) {
  if (!url) throw new Error('PRISM_URL is not set (for example https://help.example.com)');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`PRISM_URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('PRISM_URL must start with https:// or http://');
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = path.endsWith('/api/v1') ? path : `${path}/api/v1`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

// Drops undefined/null/'' values; arrays become repeated keys (?status=a&status=b),
// which is how PRISM's list endpoints read several values.
export function toQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, String(v)));
    else qs.append(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export class PrismClient {
  constructor({ url, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey) throw new Error('A PRISM API key is required (PRISM_API_KEY, or a Bearer token in HTTP mode)');
    this.base = apiBase(url);
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async request(method, path, { query, body } = {}) {
    const url = `${this.base}${path}${toQuery(query)}`;
    const headers = { 'X-API-Key': this.apiKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await this.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (err) {
      const why = err && err.name === 'TimeoutError' ? 'timed out' : (err && err.message) || 'failed';
      throw new PrismApiError(0, `Could not reach PRISM at ${this.base}: ${why}`, 'NETWORK_ERROR');
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const message = (data && data.message) || `PRISM answered ${res.status} ${res.statusText}`.trim();
      throw new PrismApiError(res.status, message, (data && data.code) || `HTTP_${res.status}`);
    }
    if (data === null && text) {
      throw new PrismApiError(res.status, 'PRISM answered with something other than JSON. Is PRISM_URL right?', 'BAD_RESPONSE');
    }
    return data;
  }

  get(path, query) { return this.request('GET', path, { query }); }

  post(path, body) { return this.request('POST', path, { body: body || {} }); }

  patch(path, body) { return this.request('PATCH', path, { body: body || {} }); }
}
