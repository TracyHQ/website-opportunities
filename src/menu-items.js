/**
 * The research step that turns a place's menu links into `profile.menuItems` (shared research
 * contract §5): the WO domain's `readMenus` with this app's PDF reader. Menu photos are read by
 * `menu-photo-reading.js` (only when a vision model is assigned); `mergeMenuItems` below is the ONE place where the
 * items of every source meet, and it decides which source's dish and price win.
 */
import { tradeOfPlace, tradeOfSchemaType } from '../domain/trades.mjs'
import { pdfTextPages } from './menu-pdf-text.js'

/** The research part that reads a place's menu files and pages (`document-text`), and the rule it reads them by. */
export const MENU_FILE_PART = 'menu-file'
export const MENU_FILE_VERSION = 'menu-file-1'

/** What Google Place Details says only of a place that serves food or drink. */
const SERVES = [
  'servesBreakfast',
  'servesBrunch',
  'servesLunch',
  'servesDinner',
  'servesBeer',
  'servesWine',
  'servesCocktails',
  'servesCoffee',
  'servesDessert',
  'servesVegetarianFood',
  'dineIn'
]

/**
 * Whether a place has a Menu: a food or drink business (`domain/trades.mjs` `food`, by Google's types, else the
 * website's schema.org type, else what Google says it serves, else a menu link, else Google listing menu photos), or any place whose
 * research already holds real dishes (a hotel with a restaurant). Other places have no menu parts: never due, never
 * paid for, never in Research again.
 * @param {{google?: any, profile?: any, items?: any[], menuPhotos?: number}} input
 */
export function menuApplicable({ google = null, profile = null, items = [], menuPhotos = 0 } = {}) {
  if ((items ?? []).length > 0) return true
  if (google && tradeOfPlace({ primaryType: google.primaryType ?? null, types: google.types ?? null }) === 'food')
    return true
  if (profile?.businessType && tradeOfSchemaType(profile.businessType) === 'food') return true
  // Place Details facts keep these under `amenities` (`placeFactsFromDetails`).
  if (google && SERVES.some((k) => google.amenities?.[k] === true || google[k] === true)) return true
  // Its own website (or a search) links a menu: Place Details does not name the place's types.
  if ((profile?.menus ?? []).length > 0) return true
  return menuPhotos > 0
}

/**
 * Source rank, best first (decided 23/10/2026): the place's own website (a menu page or PDF read from its site), then a link a
 * web search found, then a photo (it can be old). `searched` = the urls of menu links found by search.
 */
const rankOf = (item, searched) =>
  item?.source?.kind === 'photo' ? 2 : searched.has(item?.source?.url) ? 1 : 0

const PRICES_DIFFER = 'prices differ between sources'

/**
 * A dish's name as compared across sources: lower case, accents and punctuation gone, `&` = `and`, text in brackets
 * (allergen codes such as `(D)(G)`) dropped, and each word of 4+ letters reduced to its singular by a few English
 * rules (`ies`→`y`, `ches/shes/xes/zes/oes`→ without `es`, a final `s` unless `ss`/`us`/`is`).
 * ⚠ LIMITS: it does not match a translation, an abbreviation, another word order or a typo; two dishes that differ only
 * by such a thing stay two dishes (a duplicate is better than two dishes merged into one).
 */
export function dishKey(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .join(' ')
}

function singular(word) {
  if (word.length < 4) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(ch|sh|x|z|o)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

/** A printed price as a number to compare (`74`, `74.00`, `AED 74` equal), or null when it holds no number. */
function priceNumber(price) {
  const digits = String(price ?? '')
    .replace(/[^\d.,]/g, '')
    .replace(/,(\d{1,2})$/, '.$1')
    .replace(/,/g, '')
  const n = Number(digits)
  return digits && Number.isFinite(n) ? n : null
}

const postedAt = (item) => {
  const t = Date.parse(item?.source?.postedAt ?? '')
  return Number.isFinite(t) ? t : null
}

/**
 * One dish read several times at one rank, one size of it: its rows, never a silently chosen price. One source printing
 * several prices (a 25ml and a 50ml the reader could not label) keeps a row per price; different sources that disagree
 * leave one row with no price and `priceConflict`.
 */
function settleReadings(list) {
  const priced = list.filter((i) => priceNumber(i.price) !== null)
  if (priced.length === 0) return [list[0]]
  if (new Set(priced.map((i) => priceNumber(i.price))).size === 1) {
    // Same price on every reading that has one: the newest of them speaks, else the first.
    return [[...priced].sort((a, b) => (postedAt(b) ?? -1) - (postedAt(a) ?? -1))[0]]
  }
  if (priced.every((i) => i.source?.url) && new Set(priced.map((i) => i.source.url)).size === 1)
    return priced.filter(
      (i, n) => priced.findIndex((x) => priceNumber(x.price) === priceNumber(i.price)) === n
    )
  const dates = priced.map(postedAt)
  if (dates.every((t) => t !== null)) {
    const newest = Math.max(...dates)
    const holders = priced.filter((i) => postedAt(i) === newest)
    if (holders.length === 1 || new Set(holders.map((i) => priceNumber(i.price))).size === 1)
      return [withOtherPrices(holders[0], priced)]
  }
  // Dates unknown or equal and the sources disagree: no price, flagged, every printed price kept beside it.
  return [
    withOtherPrices(
      { ...priced[0], price: null, currency: null, priceConflict: true, priceNote: PRICES_DIFFER },
      priced
    )
  ]
}

/** The other prices photos printed for a dish, each with the photo it came from (`otherPrices`); only photo readings. */
function withOtherPrices(item, priced) {
  const kept = priceNumber(item.price)
  const others = []
  for (const i of priced) {
    const n = priceNumber(i.price)
    if (i.source?.kind !== 'photo' || n === kept || others.some((o) => priceNumber(o.price) === n)) continue
    others.push({ price: i.price, mediaId: i.source.mediaId ?? i.source.region ?? null })
  }
  return others.length ? { ...item, otherPrices: others } : item
}

/**
 * Every source's items → the list the profile carries. A dish is matched by `dishKey`. Per dish the best-ranked source
 * alone speaks and lower-ranked readings of the same dish are dropped, so a photo never overrides a website's name or price.
 * Readings of one rank settle by `settleReadings`, per size (and, for a link, per printed section): one price, or none and
 * `priceConflict` when they disagree. Only the website's own reading can stay `verified`. Dishes come out grouped by
 * section in the order the sections first appear, as on the menu. The ONE producer of the merged menu: the profile, the
 * build agent's `menu` part (`agent-demo.js`) and the fixed fill all read its output.
 * @param {any[]} items @param {{searched?: Set<string>}} [options]
 */
export function mergeMenuItems(items, { searched = new Set() } = {}) {
  const dishes = new Map()
  for (const item of items ?? []) {
    const key = dishKey(item?.name)
    if (!key) continue
    const rank = rankOf(item, searched)
    const dish = dishes.get(key) ?? { best: rank, items: [] }
    dish.best = Math.min(dish.best, rank)
    dish.items.push({ item, rank })
    dishes.set(key, dish)
  }
  const out = []
  for (const dish of dishes.values()) {
    const kept = dish.items.filter((x) => x.rank === dish.best).map((x) => x.item)
    const groups = new Map()
    for (const item of kept) {
      const key = `${dishKey(item.size)}\n${dish.best < 2 ? dishKey(item.section) : ''}`
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    for (const group of groups.values()) {
      for (const settled of settleReadings(group))
        out.push(dish.best === 0 && !settled.priceConflict ? settled : { ...settled, verified: false })
    }
  }
  const sections = new Map()
  for (const item of out)
    if (!sections.has(dishKey(item.section))) sections.set(dishKey(item.section), sections.size)
  return out.sort((a, b) => sections.get(dishKey(a.section)) - sections.get(dishKey(b.section)))
}

const SEASONAL =
  /\b(?:seasonal|season|summer|winter|spring|autumn|fall|christmas|xmas|easter|ramadan|iftar|eid|valentine|new year|tet|halloween|thanksgiving|festive|limited)\b/i
const YEAR_MS = 365 * 24 * 3600 * 1000
const SECTIONS_NAMED = 12
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /(?:sh|ch|s|x)$/.test(word) ? 'es' : 's'}`
const sourceLabel = (item, searched) =>
  item?.source?.kind === 'photo' ? 'photo' : searched.has(item?.source?.url) ? 'search result' : 'website'

/**
 * Plain facts about a merged menu (`mergeMenuItems`), for the build agent to read before the dishes: how many, the
 * sections, the price range per currency, the sources, the dishes with no price, seasonal sections and how old the photos
 * are. No model call.
 * @param {any[]} items @param {{at?: string | null, searched?: Set<string>}} [options]
 */
export function menuSummary(items, { at = null, searched = new Set(), empty = null } = {}) {
  const list = items ?? []
  if (!list.length) return empty ?? 'No menu was collected; sample dishes are a suggestion for the owner.'
  const sections = [...new Set(list.map((i) => (i.section ? String(i.section) : '(no section)')))]
  const shown =
    sections.length > SECTIONS_NAMED
      ? `${sections.slice(0, SECTIONS_NAMED).join(', ')} and ${sections.length - SECTIONS_NAMED} more`
      : sections.join(', ')
  const lines = [`${plural(list.length, 'dish')} in ${plural(sections.length, 'section')}: ${shown}.`]
  const byCurrency = new Map()
  for (const item of list) {
    const n = priceNumber(item.price)
    if (n === null) continue
    const c = item.currency ?? 'no currency'
    byCurrency.set(c, [...(byCurrency.get(c) ?? []), n])
  }
  if (byCurrency.size)
    lines.push(
      `Prices: ${[...byCurrency]
        .map(([c, ns]) => {
          const lo = Math.min(...ns)
          const hi = Math.max(...ns)
          return `${c} ${lo === hi ? lo : `${lo}–${hi}`} (${plural(ns.length, 'dish')})`
        })
        .join('; ')}.`
    )
  const unpriced = list.filter((i) => priceNumber(i.price) === null)
  const conflicts = unpriced.filter((i) => i.priceConflict).length
  if (unpriced.length)
    lines.push(
      `${plural(unpriced.length, 'dish')} ${unpriced.length === 1 ? 'has' : 'have'} no price${conflicts ? ` (${conflicts} because sources disagree)` : ''}.`
    )
  const kinds = new Map()
  for (const item of list)
    kinds.set(sourceLabel(item, searched), (kinds.get(sourceLabel(item, searched)) ?? 0) + 1)
  lines.push(`Sources: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}.`)
  const seasonal = sections.filter((s) => SEASONAL.test(s))
  if (seasonal.length) lines.push(`Seasonal sections: ${seasonal.join(', ')}.`)
  const dates = list.map(postedAt).filter((t) => t !== null)
  if (dates.length) {
    const day = (t) => new Date(t).toISOString().slice(0, 10)
    const lo = Math.min(...dates)
    const hi = Math.max(...dates)
    const old = Number.isFinite(Date.parse(at ?? '')) && Date.parse(at) - lo > YEAR_MS
    lines.push(
      `Photos dated ${lo === hi ? day(lo) : `${day(lo)} to ${day(hi)}`}${old ? '; the oldest is over a year old' : ''}.`
    )
  }
  return lines.join(' ')
}

/**
 * Why a place's research holds no dishes, for the build agent's `menu` part (`agent-demo.js`): read from what the
 * research recorded (`menuPhotoStatus`, the menu links and their readings), so the agent says "photo reading is off",
 * never "this place has no menu", and marks any dish it writes as a sample.
 * @param {any} profile the place's snapshot profile
 */
export function menuEmptyNote(profile) {
  const tail = ' Dishes and prices are unknown: any dish written is a sample for the owner, never presented as read.'
  const status = profile?.menuPhotoStatus
  if (status === 'switched_off' || status === 'not_configured' || status === 'unavailable')
    return `No dishes were read: menu photo reading is off on this site, so the place's menu photos were not read.${tail}`
  if (status === 'not_tested')
    return `No dishes were read: the vision model for menu photos has not passed its test yet, so menu photos were not read.${tail}`
  if (status === 'not_applicable')
    return `No menu was read: this place is not a food or drink business.${tail}`
  if ((profile?.menus ?? []).length)
    return `No dishes were read: the place's menu links were read but held no dishes that could be read.${tail}`
  return `No menu link or menu photo was found for this place.${tail}`
}

const linkReading = (item) => item?.source?.kind !== 'photo'

const urlsOf = (menus) =>
  [...new Set((menus ?? []).map((m) => m?.url).filter((u) => typeof u === 'string' && u))].sort().join('\n')

/**
 * @param {{domain: any, profile: {menus?: Array<{url: string}>}, previous?: {menus?: any[], menuItems?: any[],
 *   menuReads?: any[]} | null, force?: boolean, deps: {fetch?: Function, resolve?: Function}, now?: () => number,
 *   log?: {warn?: Function}}} args - `previous`: the place's last snapshot profile, reused while its menu links are the same
 * @returns {Promise<{menuItems?: any[], menuReads?: any[]}>} the fields to set on the profile; `{}` leaves the links only
 */
export async function menuItemsForProfile({
  domain,
  profile,
  previous = null,
  force = false,
  deps,
  now = Date.now,
  log
}) {
  const key = urlsOf(profile?.menus)
  if (!key) return {}
  if (!force && previous?.menuReads && urlsOf(previous.menus) === key)
    return {
      // Photo readings belong to `menu-photo-reading.js`; only the link readings are reused here.
      ...(previous.menuItems?.some(linkReading) ? { menuItems: previous.menuItems.filter(linkReading) } : {}),
      menuReads: previous.menuReads.filter((r) => r?.kind !== 'photo')
    }
  try {
    const { items, reads } = await domain.readMenus({
      menus: profile.menus,
      fetch: deps.fetch,
      resolve: deps.resolve,
      pdfText: pdfTextPages,
      now
    })
    // A link found by a web search may be another branch's menu: what it says is never a fact.
    const searched = new Set(profile.menus.filter((m) => m.source === 'search').map((m) => m.url))
    const kept = mergeMenuItems(
      items.map((item) => (searched.has(item.source?.url) ? { ...item, verified: false } : item)),
      { searched }
    )
    return { ...(kept.length ? { menuItems: kept } : {}), menuReads: reads }
  } catch (err) {
    log?.warn?.('wo menu read failed', { error: err?.message })
    return {}
  }
}

/**
 * The profile fields of every menu source together: the link readings (`menuItemsForProfile`) and the photo readings
 * (`readMenuPhotos`, null when that step did not run) through `mergeMenuItems`. With no photo step it is `docs` unchanged.
 * @param {{docs: {menuItems?: any[], menuReads?: any[]}, photos: {items: any[], reads: any[], reading: any} | null,
 *   searched?: Set<string>}} input
 */
export function menuFieldsOf({ docs, photos, searched = new Set() }) {
  if (!photos) return docs
  const menuItems = mergeMenuItems([...(docs.menuItems ?? []), ...photos.items], { searched })
  const menuReads = [...(docs.menuReads ?? []), ...photos.reads]
  return {
    ...(menuItems.length ? { menuItems } : {}),
    ...(menuReads.length ? { menuReads } : {}),
    ...(photos.reading ? { menuPhotoReading: photos.reading } : {}),
    menuPhotoStatus: photos.status
  }
}
