// Minimal HTTP helper with timeout, retry, UA rotation, and logging.

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
];

const DEFAULT_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sk,cs;q=0.9,en;q=0.6',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeoutMs = 15000,
    retries = 2,
    backoffMs = 1000,
    label = url,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent': pickUA(),
          ...DEFAULT_HEADERS,
          ...headers,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        if ([429, 502, 503, 504].includes(res.status) && attempt < retries) {
          await sleep(backoffMs * (attempt + 1));
          continue;
        }
        throw new Error(`HTTP ${res.status} on ${label}`);
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(backoffMs * (attempt + 1));
    }
  }
  throw lastErr;
}

async function fetchText(url, opts) {
  const res = await fetchWithRetry(url, opts);
  return res.text();
}

async function fetchJson(url, opts) {
  const res = await fetchWithRetry(url, opts);
  return res.json();
}

module.exports = { fetchWithRetry, fetchText, fetchJson, pickUA, sleep };
