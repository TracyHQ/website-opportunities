/**
 * `website-opportunities/demo-request/v1`: what a builder sends to ask a host (Tracy's `POST /v1/demos`) for a
 * demo site of one business. Plain facts and picture URLs only, nothing a host should trust: no account, no
 * site, no credential, no `verified` or provenance claim, no stored-object key. A field the contract does not
 * name is refused by its path, so a sender that adds one learns it at once instead of having it ignored.
 */
import { CMS } from './cms.mjs'

export const DEMO_REQUEST_SCHEMA = 'website-opportunities/demo-request/v1'
export const DEMO_REQUEST_LIMITS = Object.freeze({
  name: 200,
  text: 500,
  description: 2000,
  url: 2048,
  hours: 14,
  items: 100,
  photos: 24
})
const SOCIALS = ['facebook', 'instagram', 'tiktok', 'youtube', 'x']
const TOP = ['schema', 'business', 'photos', 'cms', 'template']
const BUSINESS = [
  'name',
  'address',
  'location',
  'phone',
  'website',
  'category',
  'hours',
  'socials',
  'description',
  'items'
]
const ITEM = ['name', 'price', 'currency', 'section', 'description']
const PHOTO = ['url', 'caption', 'alt']
const MAX_ERRORS = 20

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isHttpUrl = (v) => {
  if (typeof v !== 'string' || v.length > DEMO_REQUEST_LIMITS.url) return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * @returns {{ ok: true, request: object } | { ok: false, errors: { path: string, code: string }[] }}
 *   `request` holds only the fields sent, `photos` always a list.
 */
export function validateDemoRequest(raw) {
  const errors = []
  const fail = (path, code) => errors.length < MAX_ERRORS && errors.push({ path, code })
  const only = (value, keys, path) => {
    for (const k of Object.keys(value))
      if (!keys.includes(k)) fail(path ? `${path}.${k}` : k, 'UNKNOWN_FIELD')
  }
  const text = (v, path, max, required = false) => {
    if (v === undefined || v === null) {
      if (required) fail(path, 'REQUIRED')
      return undefined
    }
    if (typeof v !== 'string') return void fail(path, 'NOT_TEXT')
    if (required && !v.trim()) return void fail(path, 'REQUIRED')
    if (v.length > max) return void fail(path, 'TOO_LONG')
    return v
  }
  const url = (v, path) => {
    if (v === undefined || v === null) return undefined
    if (!isHttpUrl(v)) return void fail(path, 'INVALID_URL')
    return v
  }
  const list = (v, max, path) => {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v)) {
      fail(path, 'NOT_A_LIST')
      return []
    }
    if (v.length > max) {
      fail(path, 'TOO_MANY')
      return []
    }
    return v
  }
  const set = (out, key, value) => {
    if (value !== undefined) out[key] = value
  }

  if (!isObject(raw)) return { ok: false, errors: [{ path: '', code: 'NOT_AN_OBJECT' }] }
  only(raw, TOP, '')
  if (raw.schema !== DEMO_REQUEST_SCHEMA) fail('schema', 'SCHEMA_UNSUPPORTED')
  const request = { schema: DEMO_REQUEST_SCHEMA }

  const b = raw.business
  if (!isObject(b)) fail('business', 'REQUIRED')
  else {
    only(b, BUSINESS, 'business')
    const business = {}
    set(business, 'name', text(b.name, 'business.name', DEMO_REQUEST_LIMITS.name, true))
    set(business, 'address', text(b.address, 'business.address', DEMO_REQUEST_LIMITS.text))
    set(business, 'phone', text(b.phone, 'business.phone', 64))
    set(business, 'website', url(b.website, 'business.website'))
    set(business, 'category', text(b.category, 'business.category', 64))
    set(business, 'description', text(b.description, 'business.description', DEMO_REQUEST_LIMITS.description))
    if (b.location !== undefined && b.location !== null) {
      if (!isObject(b.location)) fail('business.location', 'NOT_AN_OBJECT')
      else {
        only(b.location, ['lat', 'lon'], 'business.location')
        const { lat, lon } = b.location
        const inRange = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max
        if (!inRange(lat, 90)) fail('business.location.lat', 'OUT_OF_RANGE')
        if (!inRange(lon, 180)) fail('business.location.lon', 'OUT_OF_RANGE')
        business.location = { lat, lon }
      }
    }
    const hours = list(b.hours, DEMO_REQUEST_LIMITS.hours, 'business.hours')
    hours.forEach((h, i) => text(h, `business.hours.${i}`, 200, true))
    if (b.hours !== undefined) business.hours = hours
    if (b.socials !== undefined && b.socials !== null) {
      if (!isObject(b.socials)) fail('business.socials', 'NOT_AN_OBJECT')
      else {
        only(b.socials, SOCIALS, 'business.socials')
        business.socials = {}
        for (const k of SOCIALS) set(business.socials, k, url(b.socials[k], `business.socials.${k}`))
      }
    }
    const items = list(b.items, DEMO_REQUEST_LIMITS.items, 'business.items')
    business.items = items.map((item, i) => {
      const at = `business.items.${i}`
      if (!isObject(item)) return void fail(at, 'NOT_AN_OBJECT')
      only(item, ITEM, at)
      const out = {}
      set(out, 'name', text(item.name, `${at}.name`, DEMO_REQUEST_LIMITS.name, true))
      set(out, 'price', text(item.price, `${at}.price`, 40))
      set(out, 'currency', text(item.currency, `${at}.currency`, 8))
      set(out, 'section', text(item.section, `${at}.section`, 100))
      set(out, 'description', text(item.description, `${at}.description`, DEMO_REQUEST_LIMITS.text))
      return out
    })
    if (b.items === undefined) delete business.items
    request.business = business
  }

  const photos = list(raw.photos, DEMO_REQUEST_LIMITS.photos, 'photos')
  request.photos = photos.map((p, i) => {
    const at = `photos.${i}`
    if (!isObject(p)) return void fail(at, 'NOT_AN_OBJECT')
    only(p, PHOTO, at)
    const out = {}
    if (p.url === undefined || p.url === null) fail(`${at}.url`, 'REQUIRED')
    set(out, 'url', url(p.url, `${at}.url`))
    set(out, 'caption', text(p.caption, `${at}.caption`, DEMO_REQUEST_LIMITS.text))
    set(out, 'alt', text(p.alt, `${at}.alt`, DEMO_REQUEST_LIMITS.text))
    return out
  })

  if (raw.cms !== undefined && raw.cms !== null) {
    if (!CMS.includes(raw.cms)) fail('cms', 'INVALID_CMS')
    else request.cms = raw.cms
  }
  if (raw.template !== undefined && raw.template !== null) {
    if (!isObject(raw.template)) fail('template', 'NOT_AN_OBJECT')
    else {
      only(raw.template, ['quickstart', 'design'], 'template')
      const template = {}
      set(template, 'quickstart', text(raw.template.quickstart, 'template.quickstart', 200, true))
      set(template, 'design', text(raw.template.design, 'template.design', 200))
      if (request.cms === undefined && raw.cms === undefined) fail('cms', 'REQUIRED')
      request.template = template
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, request }
}

/**
 * A demo request from loose facts of one place: text trimmed, empty values and lists dropped, photos given as
 * URLs or `{url, caption, alt}`, at most `DEMO_REQUEST_LIMITS.photos` of them. Validate before sending.
 */
export function buildDemoRequest({ business = {}, photos = [], cms, template } = {}) {
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const out = { schema: DEMO_REQUEST_SCHEMA, business: {} }
  const put = (target, key, value) => {
    if (value !== undefined) target[key] = value
  }
  for (const key of ['name', 'address', 'phone', 'website', 'category', 'description'])
    put(out.business, key, clean(business[key]))
  if (Number.isFinite(business.location?.lat) && Number.isFinite(business.location?.lon))
    out.business.location = { lat: business.location.lat, lon: business.location.lon }
  const hours = (Array.isArray(business.hours) ? business.hours : [])
    .map(clean)
    .filter(Boolean)
    .slice(0, DEMO_REQUEST_LIMITS.hours)
  if (hours.length) out.business.hours = hours
  const socials = {}
  for (const k of SOCIALS) put(socials, k, clean(business.socials?.[k]))
  if (Object.keys(socials).length) out.business.socials = socials
  const items = (Array.isArray(business.items) ? business.items : [])
    .filter((i) => clean(i?.name))
    .slice(0, DEMO_REQUEST_LIMITS.items)
    .map((i) => {
      const item = {}
      for (const key of ITEM) put(item, key, clean(i[key]))
      return item
    })
  if (items.length) out.business.items = items
  out.photos = (Array.isArray(photos) ? photos : [])
    .map((p) => (typeof p === 'string' ? { url: p } : p))
    .filter((p) => clean(p?.url))
    .slice(0, DEMO_REQUEST_LIMITS.photos)
    .map((p) => {
      const photo = { url: p.url.trim() }
      put(photo, 'caption', clean(p.caption))
      put(photo, 'alt', clean(p.alt))
      return photo
    })
  put(out, 'cms', clean(cms))
  if (template && clean(template.quickstart)) {
    out.template = { quickstart: template.quickstart.trim() }
    put(out.template, 'design', clean(template.design))
  }
  return out
}
