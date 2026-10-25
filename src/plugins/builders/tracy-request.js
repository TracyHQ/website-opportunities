/**
 * The body the `tracy` builder sends to `POST /v1/demos`: the public contract `website-opportunities/demo-request/v1`.
 * Facts about the business and links to its public photos, nothing else: no internal ids, no storage keys, no
 * "verified" labels. Tracy treats every string in it as untrusted data.
 *
 * `toDemoRequest(place, research)`: `place` is the saved opportunity (`opportunityOf` in `../../brief-research.js`),
 * `research` the site brief made from its research (`makeSiteBrief`). A value research did not find is left out.
 */
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../canonical-json.js'
import { DEMO_REQUEST_LIMITS, DEMO_REQUEST_SCHEMA } from '../../../domain/demo-request.mjs'

export { DEMO_REQUEST_SCHEMA }
const MAX_PHOTOS = DEMO_REQUEST_LIMITS.photos
const MAX_ITEMS = DEMO_REQUEST_LIMITS.items
const TEXT_MAX = 2000
const CMS = new Set(['wordpress', 'joomla', 'emdash'])
// The networks demo-request/v1 names; any other is left out rather than refused.
const SOCIAL = new Set(['facebook', 'instagram', 'tiktok', 'youtube', 'x'])

const text = (v, max = TEXT_MAX) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

/** An https (or, with `http`, also http) address on a public name: no credentials, no IP literal, no local name. */
export function publicHttpsUrl(value, { http = false } = {}) {
  if (typeof value !== 'string' || value.length > 2000) return undefined
  let u
  try {
    u = new URL(value)
  } catch {
    return undefined
  }
  const host = u.hostname.toLowerCase()
  if (!(u.protocol === 'https:' || (http && u.protocol === 'http:')) || u.username || u.password || u.port)
    return undefined
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return undefined
  if (/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host)) return undefined
  return u.href
}

function locationOf(candidate) {
  const lat = Number(candidate?.lat)
  const lon = Number(candidate?.lon)
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon }
    : undefined
}

function socialsOf(...sources) {
  const out = {}
  for (const source of sources)
    for (const [network, url] of Object.entries(source ?? {}))
      if (SOCIAL.has(network) && !out[network] && publicHttpsUrl(url)) out[network] = publicHttpsUrl(url)
  return Object.keys(out).length ? out : undefined
}

function descriptionOf(googlePlace) {
  const s = googlePlace?.summaries
  if (typeof s === 'string') return text(s)
  for (const key of ['editorial', 'overview', 'generative', 'description'])
    if (text(s?.[key]) ?? text(s?.[key]?.text)) return text(s[key]) ?? text(s[key].text)
  return undefined
}

function itemsOf(content) {
  const items = (content?.items ?? [])
    .filter((i) => text(i?.title))
    .slice(0, MAX_ITEMS)
    .map((i) =>
      prune({ name: text(i.title, 200), description: text(i.body, 500), section: text(i.kinds?.[0], 100) })
    )
  return items.length ? items : undefined
}

/** The brief's images, in its order, at the public address their research row was read from. */
function photosOf(assets, media) {
  const rowOf = new Map((media ?? []).map((m) => [m?.id, m]))
  const seen = new Set()
  const photos = []
  for (const a of assets ?? []) {
    const row = rowOf.get(a?.id)
    const url = a?.kind === 'image' ? publicHttpsUrl(row?.sourceUrl) : undefined
    if (!url || seen.has(url)) continue
    seen.add(url)
    photos.push(prune({ url, caption: text(a.category, 500), alt: text(a.alt ?? row?.alt, 500) }))
    if (photos.length === MAX_PHOTOS) break
  }
  return photos
}

/** The object without its undefined fields. */
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

/**
 * @param {{ name?: string, candidate?: object }} place
 * @param {object | null} research  the site brief, or null when none could be made
 * @param {{ cms?: string, template?: { quickstart?: string, design?: string } }} [choice]
 * @param {{ id: string, sourceUrl?: string }[]} [media]  the research rows behind the brief's assets (the brief keeps no address)
 */
export function toDemoRequest(place, research, choice = {}, media = []) {
  const b = research?.business ?? {}
  const c = place?.candidate ?? {}
  const name = text(b.name) ?? text(place?.name) ?? text(c.name)
  if (!name) return null
  const hours = Array.isArray(b.hours) ? b.hours.map((h) => text(h, 200)).filter(Boolean) : []
  const template = prune({
    quickstart: text(choice.template?.quickstart, 200),
    design: text(choice.template?.design, 200)
  })
  return prune({
    schema: DEMO_REQUEST_SCHEMA,
    business: prune({
      name: name.slice(0, 200),
      address: text(b.address, 500) ?? text(c.address, 500),
      location: locationOf(c),
      phone: text(b.phone, 64) ?? text(c.phone, 64),
      // The business's own site may still be plain http: it is a fact here, not something fetched.
      website: publicHttpsUrl(b.website, { http: true }) ?? publicHttpsUrl(c.website, { http: true }),
      category: text(b.trade, 64) ?? text(b.cuisine?.[0], 64),
      hours: hours.length ? hours : undefined,
      socials: socialsOf(b.socials, c.socials),
      description: descriptionOf(research?.googlePlace),
      items: itemsOf(research?.content)
    }),
    photos: photosOf(research?.assets, media),
    cms: CMS.has(choice.cms) ? choice.cms : undefined,
    template: Object.keys(template).length ? template : undefined
  })
}

/** The request's fingerprint: the same facts always give the same one, whatever the key order. */
export function demoRequestFingerprint(request) {
  return createHash('sha256').update(canonicalJson(request)).digest('hex')
}
