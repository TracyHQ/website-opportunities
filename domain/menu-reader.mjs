// Menus as dishes and prices, never invented (shared research contract §5): a name and a price are
// `verified` only when they sit on the same row of the extracted text; a price merely near a dish, a row with several
// prices and no size heading, and anything a model read off a photo stay suggestions (`verified: false`). Names and
// prices are kept verbatim; a currency is the one printed beside the price, never one guessed from the city.
import { fetchLimited } from './fetch-limited.mjs'
import { sha256Hex } from './media.mjs'
import { decodeEntities } from './website-crawler.mjs'

const CURRENCY_SYMBOL = '[$€£¥₫₹฿₩₺₱₪]'
// Vietnamese đồng spellings (VNĐ, đ, vnđ) as \u escapes: a currency code, not prose (gate `language`).
const CURRENCY_CODE =
  '(?:AED|USD|EUR|GBP|VND|VN\\u0110|SGD|THB|MYR|IDR|PHP|INR|AUD|NZD|CAD|CHF|JPY|KRW|CNY|HKD|SAR|QAR|KWD|BHD|OMR|EGP|TRY|ZAR|SEK|NOK|DKK|PLN|CZK|HUF|Dhs?|Rs\\.?|RM|kr|zł|Ft|Kč|\\u0111|vn\\u0111|vnd)'
const CURRENCY = `(?:${CURRENCY_SYMBOL}|${CURRENCY_CODE})`
const NUMBER = '\\d{1,3}(?:[.,\\u00a0 ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?'
const PRICE_BODY = `(?:(${CURRENCY})\\s?)?(${NUMBER})(?:\\s?(${CURRENCY}|[kK]))?`
/** A whole cell that is a price. */
const PRICE_CELL = new RegExp(`^${PRICE_BODY}$`, 'u')
/** A price at the end of a line of text, after leader dots or a printed currency. */
const TRAILING_PRICE = new RegExp(
  `^(.*?\\S)\\s*(\\.{2,}|…+|[-–—_]{2,})?\\s*(${PRICE_BODY.replace(/\((?!\?)/g, '(?:')})$`,
  'u'
)
const LEADERS = /^[\s.…·_\-–—]+$/
const SIZE_LABEL =
  /^(?:xs|s|m|l|xl|xxl|sm|md|lg|small|medium|regular|large|half|full|single|double|glass|bottle|carafe|cup|pot|mini|maxi|jumbo|nhỏ|vừa|lớn|\d+(?:[.,]\d+)?\s?(?:cm|ml|cl|l|oz|g|kg|pcs|pc|"|inch))$/i
const ITEMS_MAX = 300
const SECTION_MAX_WORDS = 5
const COLUMN_TOLERANCE = 40
const MENU_BYTES = 10 * 1024 * 1024

const clean = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** A price cell read as `{price, currency}`, or null. */
function priceOf(text) {
  const m = PRICE_CELL.exec(text)
  if (!m) return null
  const currency = m[1] ?? (m[3] && !/^k$/i.test(m[3]) ? m[3] : null)
  return { price: text, currency: currency ?? null }
}

/** `Phở bò ..... 75.000`, `Hummus AED 32`, `Tea 2.50`: a name and a price the same text carries, or null. */
function trailingPriceOf(text) {
  const m = TRAILING_PRICE.exec(text)
  if (!m) return null
  const price = priceOf(m[3])
  if (!price) return null
  // `Combo 2` is a name, not a dish at 2: a bare number counts only after leaders or with decimals.
  const decimals = /[.,]\d{1,2}$/.test(m[3]) && !/\d{1,3}[.,]\d{3}$/.test(m[3])
  if (!m[2] && !price.currency && !decimals) return null
  return { name: clean(m[1]), ...price }
}

// ---------- rows of cells → items ----------

/**
 * @param {Array<{cells: Array<{text: string, x?: number}>, heading?: boolean, page?: number}>} rows
 * @param {{source: object, collectedAt: string, columns?: boolean}} ctx - `columns`: a laid-out document (PDF), where a
 *   lone short line may head a section and a row of size labels heads the prices under it
 */
function itemsFromRows(rows, { source, collectedAt, columns = false }) {
  const items = []
  let sections = []
  let sizes = []
  let lone = null
  const sectionAt = (x = 0) =>
    sections.filter((s) => s.x <= x + COLUMN_TOLERANCE).sort((a, b) => b.x - a.x)[0]?.text ?? null
  const setSections = (cells) => {
    sections = sections.filter((s) => !cells.some((c) => Math.abs((c.x ?? 0) - s.x) < COLUMN_TOLERANCE))
    for (const c of cells) sections.push({ text: c.text, x: c.x ?? 0 })
  }
  const push = (item, page) => {
    if (items.length >= ITEMS_MAX) return
    items.push({
      name: item.name,
      price: item.price,
      currency: item.currency,
      ...(item.size ? { size: item.size } : {}),
      section: item.section ?? null,
      source: { ...source, ...(page ? { page } : {}) },
      collectedAt,
      verified: item.verified
    })
  }

  for (const row of rows) {
    const cells = row.cells
      .map((c) => ({ ...c, text: clean(c.text) }))
      .filter((c) => c.text && !LEADERS.test(c.text))
    if (!cells.length) continue
    // Site builders (Wix) set a dish name and its price each as a heading: a price heading is a price row,
    // and a short heading may still name the dish whose price follows (then the section it replaced returns).
    if (row.heading && !cells.every((c) => priceOf(c.text))) {
      const before = [...sections]
      const text = cells.map((c) => c.text).join(' ')
      lone =
        !columns && text.split(' ').length <= 8
          ? { text, section: sectionAt(0), sections: before, heading: true }
          : null
      setSections([{ text, x: 0 }])
      continue
    }
    if (
      columns &&
      cells.length >= 1 &&
      cells.some((c) => SIZE_LABEL.test(c.text)) &&
      cells.every(
        (c) => SIZE_LABEL.test(c.text) || (!priceOf(c.text) && c.text.split(' ').length <= SECTION_MAX_WORDS)
      )
    ) {
      sizes = cells.filter((c) => SIZE_LABEL.test(c.text))
      const heads = cells.filter((c) => !SIZE_LABEL.test(c.text))
      if (heads.length) setSections(heads)
      lone = null
      continue
    }
    // A row that is only a price: the dish is on the line before, so near, never on its row.
    if (cells.every((c) => priceOf(c.text))) {
      if (lone && cells.length === 1) {
        push({ name: lone.text, ...priceOf(cells[0].text), section: lone.section, verified: false }, row.page)
        if (columns || lone.heading) sections = lone.sections
      }
      lone = null
      continue
    }
    // Segments: name cells, then the prices that follow them; the next name starts the next dish (a second column).
    const segments = []
    let current = null
    for (const c of cells) {
      const price = priceOf(c.text)
      if (price && current?.name.length)
        current.prices.push({ ...price, x: c.x === undefined ? undefined : centre(c) })
      else if (!price) {
        const inline = trailingPriceOf(c.text)
        if (!current || current.prices.length) segments.push((current = { name: [], prices: [], x: c.x }))
        if (inline) {
          current.name.push(inline.name)
          current.prices.push({ price: inline.price, currency: inline.currency, x: c.x })
        } else current.name.push(c.text)
      }
    }
    const priced = segments.filter((s) => s.prices.length)
    if (!priced.length) {
      const words = cells.map((c) => c.text).join(' ')
      if (columns && words.split(' ').length <= SECTION_MAX_WORDS && !/[.:;!?]$/.test(words)) {
        lone =
          cells.length === 1
            ? { text: cells[0].text, section: sectionAt(cells[0].x), sections: [...sections] }
            : null
        setSections(cells)
      } else lone = cells.length === 1 && !columns ? { text: cells[0].text, section: sectionAt(0) } : null
      continue
    }
    lone = null
    for (const s of priced) {
      const name = clean(s.name.join(' '))
      const section = sectionAt(s.x)
      const sized = s.prices.map((p) => ({ p, size: sizeAt(sizes, p.x) }))
      // Several prices on one row are a dish's sizes only under a heading that names each; otherwise which is which is a guess.
      const known = s.prices.length === 1 || sized.every((z) => z.size)
      for (const { p, size } of sized)
        push({ name, price: p.price, currency: p.currency, size, section, verified: known }, row.page)
    }
  }
  return items
}

const centre = (cell) => (cell.x ?? 0) + (cell.w ?? 0) / 2

/** The size label right above a price (nearest centre within a column's width), or null. */
function sizeAt(sizes, x) {
  if (x === undefined) return null
  const near = sizes
    .map((z) => ({ z, d: Math.abs(centre(z) - x) }))
    .filter(({ d }) => d < COLUMN_TOLERANCE)
    .sort((a, b) => a.d - b.d)
  return near[0]?.z.text ?? null
}

// ---------- HTML ----------

const DROP = /<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi
const BLOCK =
  /<\/?(p|div|li|ul|ol|tr|table|tbody|thead|tfoot|section|article|header|footer|nav|main|aside|figure|figcaption|blockquote|form|dl|dt|dd|br|hr|caption)\b[^>]*>/gi
const CELL_END = /<\/(td|th|span|a|strong|b|em|i|small|label|sup|sub|bdi|data)\s*>/gi
const ACCENTS = { acute: '́', grave: '̀', circ: '̂', uml: '̈', tilde: '̃', cedil: '̧', ring: '̊' }

/** Named Latin accents (`&aacute;`) on top of the crawler's entities. */
function decodeHtml(s) {
  return decodeEntities(
    String(s).replace(/&([a-zA-Z])(acute|grave|circ|uml|tilde|cedil|ring);/g, (_, c, a) => c + ACCENTS[a])
  ).normalize('NFC')
}

/** The rows of a menu page: one per block, one cell per inline element, headings marked. */
function htmlRows(html) {
  const body = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, '')
    .replace(DROP, ' ')
  const marked = body
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\u0001')
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(BLOCK, '\n')
    .replace(CELL_END, '\t')
    .replace(/<[^>]+>/g, '')
  return marked.split('\n').map((line) => {
    const heading = line.startsWith('\u0001')
    return {
      heading,
      cells: line
        .replace('\u0001', '')
        .split('\t')
        .map((t) => ({ text: decodeHtml(t) }))
    }
  })
}

/**
 * The dishes and prices a menu page prints.
 * @param {string} html
 * @param {{source: {url: string, sha256: string, kind: 'page'}, collectedAt: string}} ctx
 */
export function menuItemsFromHtml(html, ctx) {
  return itemsFromRows(htmlRows(html), ctx)
}

// ---------- PDF (text laid out by the host's reader) ----------

/**
 * The rows of a laid-out page: text items on one baseline form a row, items close together one cell.
 * @param {Array<{str: string, x: number, y: number, w?: number, h?: number}>} items - PDF user space (y grows up)
 */
function layoutRows(items, page) {
  const lines = []
  for (const it of [...items].filter((i) => clean(i.str)).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const h = it.h || 10
    const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, h * 0.4))
    if (line) line.items.push(it)
    else lines.push({ y: it.y, items: [it] })
  }
  return lines.map((l) => {
    const cells = []
    for (const it of l.items.sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1]
      const gap = last ? it.x - (last.x + last.w) : Infinity
      if (last && gap < (it.h || 10) * 0.8 && !LEADERS.test(it.str) && !LEADERS.test(last.text)) {
        last.text +=
          gap > (it.h || 10) * 0.1 && !/\s$/.test(last.text) && !/^\s/.test(it.str) ? ` ${it.str}` : it.str
        last.w = it.x + (it.w ?? 0) - last.x
      } else cells.push({ text: it.str, x: it.x, w: it.w ?? 0 })
    }
    return { cells, page }
  })
}

/**
 * The dishes and prices of a menu PDF.
 * @param {Array<{page: number, items: Array<{str: string, x: number, y: number, w?: number, h?: number}>}>} pages
 * @param {{source: {url: string, sha256: string, kind: 'pdf'}, collectedAt: string}} ctx
 */
export function menuItemsFromPdfPages(pages, ctx) {
  return pages.flatMap((p) => itemsFromRows(layoutRows(p.items ?? [], p.page), { ...ctx, columns: true }))
}

// ---------- research step ----------

/**
 * Reads the menus research found into items: each menu link fetched (a page or a PDF), each menu photo through `readPhoto`
 * when the host has one. A source that fails is reported and read no further; its link stays where it was.
 * @param {{menus?: Array<{url: string}>, photos?: Array<{url: string, sha256?: string, mediaId?: string}>,
 *   fetch: Function, resolve?: Function, pdfText?: (bytes: Uint8Array) => Promise<Array<{page: number, items: any[]}>>,
 *   readPhoto?: (photo: object) => Promise<Array<{name: string, price: string|null, section?: string|null, size?: string|null}>>,
 *   now?: () => number, maxMenus?: number, maxPhotos?: number}} args
 * @returns {Promise<{items: object[], reads: Array<{url: string, kind: string, status: 'complete'|'failed'|'skipped', reason?: string, items: number}>}>}
 */
export async function readMenus({
  menus = [],
  photos = [],
  fetch,
  resolve,
  pdfText,
  readPhoto,
  now = Date.now,
  maxMenus = 6,
  maxPhotos = 10
} = {}) {
  const collectedAt = new Date(now()).toISOString()
  const items = []
  const reads = []
  const urls = [...new Set(menus.map((m) => m?.url).filter((u) => typeof u === 'string' && u))].slice(
    0,
    maxMenus
  )
  for (const url of urls) {
    try {
      const res = await fetchLimited(url, {
        fetch,
        resolve,
        maxBytes: MENU_BYTES,
        accept: ['text/html', 'application/pdf']
      })
      if (res.status >= 400) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'HTTP_ERROR' })
      const sha256 = sha256Hex(res.bytes)
      let found
      if (res.mime === 'application/pdf') {
        if (!pdfText) {
          reads.push({ url, kind: 'pdf', status: 'skipped', reason: 'no_pdf_reader', items: 0 })
          continue
        }
        found = menuItemsFromPdfPages(await pdfText(res.bytes), {
          source: { url: res.url, sha256, kind: 'pdf' },
          collectedAt
        })
      } else {
        found = menuItemsFromHtml(new TextDecoder().decode(res.bytes), {
          source: { url: res.url, sha256, kind: 'page' },
          collectedAt
        })
      }
      items.push(...found)
      reads.push({
        url,
        kind: res.mime === 'application/pdf' ? 'pdf' : 'page',
        status: 'complete',
        items: found.length
      })
    } catch (err) {
      reads.push({ url, kind: 'page', status: 'failed', reason: err?.code ?? 'read_failed', items: 0 })
    }
  }
  if (readPhoto) {
    for (const photo of photos.filter((p) => typeof p?.url === 'string').slice(0, maxPhotos)) {
      try {
        const read = (await readPhoto(photo)) ?? []
        const found = read
          .filter((r) => clean(r?.name))
          .map((r) => {
            const price = clean(r.price) || null
            return {
              name: clean(r.name),
              price,
              currency: price ? (priceOf(price)?.currency ?? null) : null,
              ...(clean(r.size) ? { size: clean(r.size) } : {}),
              section: clean(r.section) || null,
              source: {
                url: photo.url,
                sha256: photo.sha256 ?? null,
                kind: 'photo',
                ...(photo.mediaId ? { region: photo.mediaId } : {})
              },
              collectedAt,
              // A model's reading of a photo is a suggestion until a text of the restaurant's says the same.
              verified: false
            }
          })
        items.push(...found)
        reads.push({ url: photo.url, kind: 'photo', status: 'complete', items: found.length })
      } catch (err) {
        reads.push({
          url: photo.url,
          kind: 'photo',
          status: 'failed',
          reason: err?.code ?? 'read_failed',
          items: 0
        })
      }
    }
  }
  return { items: items.slice(0, ITEMS_MAX), reads }
}
