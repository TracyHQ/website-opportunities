import { fetchLimited } from './fetch-limited.mjs';
import { apifyRunUrl, redactToken } from './apify.mjs';
import { searchRestaurants, socialNetworkOf } from './discovery-osm.mjs';
import { searchRestaurantsGplaces, searchPlacesText } from './discovery-gplaces.mjs';

export const GMAPS_ACTOR = 'compass~crawler-google-places';
const RUN_SECS = 120;
const MAX_BYTES = 16 * 1024 * 1024;
export const DEFAULT_PLACES = 40;

// Chat links Google lists as a "website"; they are a way to reach the owner, not a site to crawl.
const MESSAGING_HOSTS = { zalo: ['zalo.me'], whatsapp: ['wa.me', 'whatsapp.com'], messenger: ['m.me'], line: ['line.me'] };

export function messagingNetworkOf(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const [net, hosts] of Object.entries(MESSAGING_HOSTS)) if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return net;
  return null;
}

export function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

export function candidateFromGmaps(p) {
  const name = typeof p?.title === 'string' ? p.title.trim() : '';
  if (!name || !p.placeId || p.permanentlyClosed) return null;
  const lat = Number(p.location?.lat);
  const lon = Number(p.location?.lng);
  // Google lists a Facebook page as the "website" of many small restaurants.
  const net = p.website ? socialNetworkOf(p.website) : null;
  const chat = p.website && !net ? messagingNetworkOf(p.website) : null;
  return compact({
    provider: 'google-maps',
    providerId: p.placeId,
    name,
    address: p.address,
    phone: p.phone,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    website: net || chat ? undefined : p.website,
    socials: net ? { [net]: p.website } : {},
    contacts: chat ? { [chat]: p.website } : undefined,
    category: p.categoryName,
    rating: Number.isFinite(p.totalScore) ? p.totalScore : undefined,
    reviews: Number.isFinite(p.reviewsCount) ? p.reviewsCount : undefined,
    imageUrl: p.imageUrl,
    mapsUrl: p.url,
    temporarilyClosed: p.temporarilyClosed === true ? true : undefined,
  });
}

/** Google Maps places around a point, through Apify. Throws {code} so the caller can fall back. */
export async function searchRestaurantsGmaps({ lat, lon, radiusM, limit = DEFAULT_PLACES }, deps = {}) {
  const { token } = deps;
  if (!token) throw Object.assign(new Error('no token'), { code: 'CREDENTIAL_MISSING' });
  let res;
  try {
    res = await fetchLimited(apifyRunUrl(GMAPS_ACTOR, { runSecs: RUN_SECS, maxChargeUsd: deps.maxChargeUsd }), {
      fetch: deps.fetch,
      resolve: deps.resolve,
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        searchStringsArray: ['restaurant'],
        customGeolocation: { type: 'Point', coordinates: [Number(lon), Number(lat)], radiusKm: Math.max(0.1, Number(radiusM) / 1000) },
        maxCrawledPlacesPerSearch: limit,
        language: 'en',
        skipClosedPlaces: true,
        scrapePlaceDetailPage: false,
      }),
      maxBytes: MAX_BYTES,
      timeoutMs: deps.timeoutMs ?? (RUN_SECS + 20) * 1000,
    });
  } catch (err) {
    throw Object.assign(new Error(redactToken(err?.message, token)), { code: err?.code === 'TIMEOUT' ? 'TIMEOUT' : 'PROVIDER_ERROR' });
  }
  if (res.status === 402) throw Object.assign(new Error('quota'), { code: 'QUOTA', status: 402 });
  if (res.status < 200 || res.status >= 300) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'PROVIDER_ERROR', status: res.status });
  let items;
  try {
    items = JSON.parse(new TextDecoder().decode(res.bytes));
  } catch {
    throw Object.assign(new Error('invalid JSON from provider'), { code: 'PROVIDER_ERROR' });
  }
  return (Array.isArray(items) ? items : []).map(candidateFromGmaps).filter(Boolean);
}

// Paid tiers in order; `key` names the credential a tier needs, and auto skips a tier without it.
const TIERS = {
  google: { provider: 'google-places', key: 'googleKey', search: searchRestaurantsGplaces },
  apify: { provider: 'google-maps', key: 'token', search: searchRestaurantsGmaps },
};
const CHAINS = { auto: ['google', 'apify'], google: ['google'], apify: ['apify'], osm: [] };

/**
 * deps.provider picks the chain: 'auto' (default) = Places → Apify → OSM, skipping tiers without a key;
 * 'google' / 'apify' = that tier then OSM; 'osm' = OSM only.
 * deps.filters ({kinds, cuisines, minRating, priceLevels, openNow}) switches the Places tier to Text Search, which adds `pages`.
 * Returns {provider, candidates, pages?, fallbackFrom?}; fallbackFrom names the first tier that failed.
 */
export async function discoverRestaurants(area, deps = {}) {
  const choice = Object.hasOwn(CHAINS, deps.provider ?? '') ? deps.provider : 'auto';
  const query = deps.limit === undefined ? area : { ...area, limit: deps.limit };
  let fallbackFrom;
  for (const id of CHAINS[choice]) {
    const tier = TIERS[id];
    if (choice === 'auto' && !deps[tier.key]) continue;
    try {
      // Find places v2: with filters, Places runs Text Search (paged, billed per page) instead of Nearby.
      const found = id === 'google' && deps.filters ? await searchPlacesText({ ...deps.filters, ...query }, deps) : { candidates: await tier.search(query, deps) };
      return { provider: tier.provider, ...found, ...(fallbackFrom ? { fallbackFrom } : {}) };
    } catch (err) {
      fallbackFrom ??= { provider: tier.provider, code: err?.code ?? 'PROVIDER_ERROR' };
    }
  }
  const candidates = await searchRestaurants(query, deps);
  return fallbackFrom ? { provider: 'osm', candidates, fallbackFrom } : { provider: 'osm', candidates };
}
