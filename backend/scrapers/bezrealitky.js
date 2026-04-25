// Bezrealitky.sk scraper
//
// Strategy: fetch HTML listing pages, parse __NEXT_DATA__ Apollo cache.
// (Direct GraphQL endpoint at api.bezrealitky.cz is firewalled for non-browser origins.)
//
// Returns raw listing objects matching backend/db/migrations/001 schema for
// listing_sources (one row per scraped listing).

const { fetchText } = require('../lib/http');

const BASE = 'https://www.bezrealitky.sk';

// Map our internal type → bezrealitky URL slug
const TYPE_MAP = {
  byt:     'byt',
  dom:     'dum',
  pozemok: 'pozemek',
};

// Map our internal location → bezrealitky regionOsmIds isn't used in URL — use ?location=
function locationParam(loc) {
  if (!loc) return '';
  return loc
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-');
}

function extractNextData(html) {
  const m = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// Walk the Apollo cache to find listings
function extractAdverts(nextData) {
  const cache = nextData?.props?.pageProps?.apolloCache || nextData?.props?.pageProps;
  if (!cache) return [];

  const root = cache.ROOT_QUERY || cache;
  let listKey = null;
  // Prefer the main grid listAdverts (skip the small "discountedOnly" rail)
  for (const key of Object.keys(root)) {
    if (!key.startsWith('listAdverts')) continue;
    if (/discountedOnly/i.test(key)) continue;
    listKey = key;
    break;
  }
  if (!listKey) {
    // Fallback: any listAdverts
    listKey = Object.keys(root).find(k => k.startsWith('listAdverts'));
  }
  if (!listKey) return [];

  const listObj = root[listKey];
  const list = (listObj && (listObj.list || listObj['list({})'])) || [];

  // Resolve refs
  const resolved = list.map(item => {
    if (item && item.__ref) return cache[item.__ref] || item;
    return item;
  });

  return resolved;
}

/**
 * Scrape one page of bezrealitky listings.
 *
 * @param {Object} opts
 * @param {string} opts.location  Slovak city name e.g. "Bratislava"
 * @param {string} opts.type      'byt' | 'dom' | 'pozemok'
 * @param {string} opts.operation 'predaj' | 'prenajom'
 * @param {number} [opts.priceMin]
 * @param {number} [opts.priceMax]
 * @param {number} [opts.page]    1-based
 * @returns {Promise<{listings:Array, totalCount:number, raw:Object}>}
 */
async function scrapePage(opts) {
  const {
    location = '',
    type = 'byt',
    operation = 'predaj',
    priceMin,
    priceMax,
    page = 1,
  } = opts;

  const cat = TYPE_MAP[type] || 'byt';
  const opSlug = operation === 'prenajom' ? 'prenajom' : 'predaj';
  const path = `/vypis/ponuka-${opSlug}/${cat}`;
  const params = new URLSearchParams();
  if (location) params.set('location', locationParam(location));
  if (priceMin) params.set('priceFrom', priceMin);
  if (priceMax) params.set('priceTo', priceMax);
  if (page > 1) params.set('page', page);

  const url = `${BASE}${path}${params.toString() ? '?' + params.toString() : ''}`;

  const html = await fetchText(url, { timeoutMs: 20000, retries: 2, label: `bezrealitky p${page}` });
  const nextData = extractNextData(html);
  if (!nextData) {
    return { listings: [], totalCount: 0, raw: { error: 'no __NEXT_DATA__', url } };
  }

  const adverts = extractAdverts(nextData);

  const listings = adverts.map(a => normaliseAdvert(a, type, operation)).filter(Boolean);

  // Try to extract totalCount from cache
  const cache = nextData?.props?.pageProps?.apolloCache?.ROOT_QUERY || {};
  let totalCount = 0;
  for (const k of Object.keys(cache)) {
    if (k.startsWith('listAdverts') && cache[k]?.totalCount != null) {
      totalCount = cache[k].totalCount;
      break;
    }
  }

  return { listings, totalCount, raw: { url, page } };
}

function normaliseAdvert(a, defaultType, defaultOperation) {
  if (!a || !a.uri) return null;

  const id = String(a.id || a.uri);
  const url = a.publicUrl || `${BASE}/nehnutelnosti-byty-domy/${a.uri}`;
  const title = a.title || a.advertHeading || `Nehnuteľnosť ${a.uri}`;

  const price =
    typeof a.price === 'number' ? a.price :
    typeof a.priceFrom === 'number' ? a.priceFrom : null;

  const surface =
    typeof a.surface === 'number' ? a.surface :
    typeof a.area === 'number' ? a.area : null;

  let imageUrl = null;
  if (a.mainImage && typeof a.mainImage === 'object') {
    imageUrl = a.mainImage.url || null;
  } else if (typeof a.imageUrl === 'string') {
    imageUrl = a.imageUrl;
  }

  // Address — bezrealitky often has nested location object
  let address = '';
  let city = '';
  if (typeof a.address === 'string') address = a.address;
  if (a.address && typeof a.address === 'object') {
    address = a.address.street || a.address.formatted || '';
    city = a.address.city || a.address.municipality || '';
  }
  if (!city && a.locality) city = a.locality;

  return {
    external_id: id,
    url,
    source_title: title,
    source_price: price,
    source_seller_name: null,           // bezrealitky claims no agencies
    raw_payload: a,                     // store full advert object for later AI extraction
    derived: {
      type: defaultType,
      operation: defaultOperation,
      price,
      size_m2: surface,
      title,
      city,
      address,
      image_url: imageUrl,
      // bezrealitky's whole pitch is "no agencies" — assume private until proven otherwise
      seller_type: 'private',
    },
  };
}

module.exports = { scrapePage };
