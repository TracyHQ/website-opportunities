/**
 * The Tracy builder: "Build it with Tracy" sends one place to Tracy (https://tracy.ai), which builds and hosts a demo
 * site in the operator's Tracy account. The operator connects this server to that account once, on the Operator page
 * (`../../tracy-connection.js`, OAuth device flow); every call here uses that connection.
 *
 * Tracy's doors it calls (base `TRACY_API_URL`, default `TRACY_URL`):
 *   POST /v1/demos              body `website-opportunities/demo-request/v1` (`./tracy-request.js`), `Idempotency-Key`
 *                               → 202 {id, status, statusUrl, demos: {live, limit}}; 409 DEMO_LIMIT_REACHED {live, limit};
 *                               503 SPONSOR_BUDGET_EXHAUSTED
 *   GET  /v1/demos/:id          → {status, site?: {key, url, editUrl}, expiresAt, frozenAt, deletedAt, error?}
 *   POST /v1/demos/:id/cancel
 *
 * Each request is a row of `wo_tracy_demo` (`../../schema/0006-tracy-demo.sql`) written BEFORE it is sent, with its
 * exact body and idempotency key: a reply lost to a timeout leaves the row `submitting`, and the tick sends the same
 * bytes under the same key, so Tracy answers the demo it already made instead of building a second one. The tick
 * also follows every demo not finished yet, as often as Tracy's `Retry-After` allows.
 *
 * Doors (under /api/website-opportunities), beside the manual builder's, which stay for any other tool:
 *   GET  /tracy/connection       → {state, tracyUrl}: whether Build can send (no account details, no token)
 *   POST /:id/tracy/demo         {cms?, template?: {quickstart?, design?}} → 202 {demo} sent, 200 {demo} already one
 *   POST /:id/tracy/demo/cancel  → {demo}
 */
import { briefResearchOf, makeSiteBrief, opportunityOf as briefOpportunityOf } from '../../brief-research.js'
import { opportunityOf } from '../../store.js'
import { defineBuilder } from '../builders.js'
import { demoRequestFingerprint, toDemoRequest } from './tracy-request.js'

const BASE = '/api/website-opportunities'
const STATUSES = new Set(['queued', 'building', 'needs-review', 'ready', 'failed', 'cancelled'])
const ACTIVE = ['submitting', 'queued', 'building', 'needs-review']
// How soon the tick asks again, by status; a Retry-After longer than this wins.
const NEXT_POLL_MS = {
  submitting: 30_000,
  queued: 10_000,
  building: 10_000,
  'needs-review': 300_000,
  // A live demo is checked now and then for its expiry and removal.
  ready: 6 * 3_600_000
}
const TICK_BATCH = 20
const CONNECTION_REFUSALS = {
  TRACY_NOT_CONNECTED: 'Connect Tracy first: Operator, Tracy, Connect.',
  TRACY_RECONNECT: 'Tracy no longer accepts this server: reconnect it on the Operator page, Tracy tab.'
}

/** Seconds of a Retry-After header (a number or an HTTP date), as milliseconds; 0 when absent. */
function retryAfterMs(res, now) {
  const raw = res.headers.get('retry-after')
  if (!raw) return 0
  if (/^\d+$/.test(raw.trim())) return Number(raw) * 1000
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - now) : 0
}

const iso = (v) => (v ? new Date(v).toISOString() : null)

/** A row as the page and the router see it. */
function demoOf(row) {
  return {
    builder: 'tracy',
    id: row.id,
    demoId: row.demo_id,
    status: row.status,
    url: row.site?.url ?? null,
    editUrl: row.site?.editUrl ?? null,
    // Tracy answers `ready` only after its own quality check passed; outreach drafts read this.
    qa: row.status === 'ready' ? 'passed' : null,
    expiresAt: iso(row.expires_at),
    frozenAt: iso(row.frozen_at),
    deletedAt: iso(row.deleted_at),
    error: row.error ?? null,
    requestedAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  }
}

/**
 * @param {{ pool: { query: Function }, connection: ReturnType<import('../../tracy-connection.js').createTracyConnection>,
 *   manual?: ReturnType<import('../builders.js').defineBuilder> | null, now?: () => number, log?: Console }} deps
 *   `manual`: the manual builder, whose brief and built-elsewhere doors stay mounted beside these.
 */
export default function createTracyBuilder({
  pool,
  connection,
  manual = null,
  now = Date.now,
  log = console
}) {
  if (!pool || !connection) throw new TypeError('the tracy builder needs pool and connection')
  const at = (ms = 0) => new Date(now() + ms)

  async function latestOf(accountId, ids) {
    if (!accountId || !ids.length) return new Map()
    const { rows } = await pool.query(
      `select distinct on (opportunity_id) * from wo_tracy_demo
       where account_id = $1 and opportunity_id = any($2::uuid[])
       order by opportunity_id, created_at desc, id desc`,
      [accountId, ids]
    )
    return new Map(rows.map((r) => [r.opportunity_id, r]))
  }

  async function activeOf(opportunityId) {
    const { rows } = await pool.query(
      `select * from wo_tracy_demo where opportunity_id = $1
         and (status = any($2::text[]) or (status = 'ready' and deleted_at is null))
       order by created_at desc limit 1`,
      [opportunityId, ACTIVE]
    )
    return rows[0] ?? null
  }

  async function update(row, fields) {
    const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`)
    const { rows } = await pool.query(
      `update wo_tracy_demo set ${sets.join(', ')}, updated_at = $${sets.length + 2} where id = $1 returning *`,
      [row.id, ...Object.values(fields), at()]
    )
    return rows[0] ?? row
  }

  /** Tracy's answer about a demo, onto its row. */
  function apply(row, body, waitMs = 0) {
    const status = STATUSES.has(body?.status) ? body.status : row.status
    const deletedAt = body?.deletedAt ?? null
    const base = deletedAt ? null : NEXT_POLL_MS[status]
    return update(row, {
      status,
      demo_id: typeof body?.id === 'string' ? body.id : row.demo_id,
      site: body?.site && typeof body.site === 'object' ? body.site : row.site,
      expires_at: body?.expiresAt ?? row.expires_at,
      frozen_at: body?.frozenAt ?? null,
      deleted_at: deletedAt,
      error: body?.error ?? (status === 'failed' ? { code: 'BUILD_FAILED' } : null),
      next_poll_at: base === undefined || base === null ? null : at(Math.max(base, waitMs))
    })
  }

  /**
   * Sends a `submitting` row to Tracy. Returns `{row, refusal?}`; a refusal is Tracy's own `{status, body}` before it
   * took the job. Connection errors are thrown; Tracy unreachable leaves the row for the tick.
   */
  async function submit(row) {
    let res
    try {
      res = await connection.call('/v1/demos', {
        method: 'POST',
        body: row.request,
        headers: { 'idempotency-key': row.idempotency_key }
      })
    } catch (error) {
      if (error?.code !== 'TRACY_UNAVAILABLE') throw error
      return { row: await update(row, { attempts: row.attempts + 1, next_poll_at: at(backoff(row)) }) }
    }
    const body = await res.json().catch(() => null)
    if (res.status === 202 || res.status === 200 || res.status === 201)
      return { row: await apply({ ...row, attempts: row.attempts + 1 }, body, retryAfterMs(res, now())) }
    if (res.status >= 500 && res.status !== 503) {
      return { row: await update(row, { attempts: row.attempts + 1, next_poll_at: at(backoff(row)) }) }
    }
    const code = typeof body?.code === 'string' ? body.code : `HTTP_${res.status}`
    const error = { code, ...(code === 'DEMO_LIMIT_REACHED' ? { live: body.live, limit: body.limit } : {}) }
    return {
      row: await update(row, { status: 'refused', error, next_poll_at: null }),
      refusal: { status: res.status, body: { ...body, code } }
    }
  }

  const backoff = (row) => Math.min(30_000 * 2 ** Math.min(row.attempts, 6), 3_600_000)

  /** Asks Tracy where a sent demo is. */
  async function follow(row) {
    const res = await connection.call(`/v1/demos/${encodeURIComponent(row.demo_id)}`)
    if (res.status === 404)
      return row.status === 'ready'
        ? update(row, { deleted_at: at(), next_poll_at: null })
        : update(row, { status: 'failed', error: { code: 'NOT_FOUND' }, next_poll_at: null })
    if (!res.ok) return update(row, { attempts: row.attempts + 1, next_poll_at: at(backoff(row)) })
    return apply(row, await res.json().catch(() => null), retryAfterMs(res, now()))
  }

  /** One pass over the demos due for a look. */
  async function tick() {
    const { rows } = await pool.query(
      `select * from wo_tracy_demo where next_poll_at is not null and next_poll_at <= $1
       order by next_poll_at limit ${TICK_BATCH}`,
      [at()]
    )
    for (const row of rows) {
      try {
        if (row.status === 'submitting') await submit(row)
        else if (row.demo_id) await follow(row)
        else await update(row, { next_poll_at: null })
      } catch (error) {
        // Not connected (any more): look again later, the operator may reconnect.
        await update(row, { next_poll_at: at(NEXT_POLL_MS['needs-review']) })
        if (!CONNECTION_REFUSALS[error?.code]) log.error?.('[wo] tracy demo tick failed', error)
      }
    }
  }

  async function newRow(accountId, opp, request) {
    const body = JSON.stringify(request)
    const { rows: count } = await pool.query(
      'select count(*)::int as n from wo_tracy_demo where opportunity_id = $1',
      [opp.id]
    )
    // Stable for this row (a retry reuses the row), new for a later request of the same place.
    const key = `wo-${opp.id}-${demoRequestFingerprint(request).slice(0, 32)}-${count[0].n + 1}`
    const { rows } = await pool.query(
      `insert into wo_tracy_demo (account_id, opportunity_id, idempotency_key, request, status, next_poll_at)
       values ($1, $2, $3, $4, 'submitting', $5)
       on conflict do nothing returning *`,
      [accountId, opp.id, key, body, at(NEXT_POLL_MS.submitting)]
    )
    return rows[0] ?? null
  }

  function routes(app, ctx) {
    const { caller, refuse, notFound, featureOn, featureOff, domainOr, body, UUID } = ctx
    manual?.routes(app, ctx)

    async function own(c, { create = false } = {}) {
      const who = await caller(c, { create })
      if (who instanceof Response) return who
      if (!(await featureOn())) return featureOff(c)
      const id = c.req.param('id')
      const opp = who.accountId && UUID.test(id) ? await opportunityOf(pool, who.accountId, id) : null
      return opp ? { who, opp } : notFound(c, 'opportunity')
    }
    const jsonOnly = (c) =>
      /^application\/json\b/i.test(c.req.header('content-type') ?? '')
        ? null
        : refuse(c, 415, 'JSON_REQUIRED', 'Send the body as application/json.')
    const connectionRefusal = (c, error) =>
      CONNECTION_REFUSALS[error?.code]
        ? refuse(c, 409, error.code, CONNECTION_REFUSALS[error.code], { tracyUrl: connection.tracyUrl })
        : null

    app.get(`${BASE}/tracy/connection`, async (c) => {
      const who = await caller(c)
      if (who instanceof Response) return who
      const { state, tracyUrl } = await connection.status()
      return c.json({ state, tracyUrl })
    })

    app.post(`${BASE}/:id/tracy/demo`, async (c) => {
      const notJson = jsonOnly(c)
      if (notJson) return notJson
      const mine = await own(c, { create: true })
      if (mine instanceof Response) return mine
      const existing = await activeOf(mine.opp.id)
      if (existing) return c.json({ demo: demoOf(existing) }, 200)
      const { state } = await connection.status()
      if (state !== 'connected')
        return connectionRefusal(c, {
          code: state === 'reconnect' ? 'TRACY_RECONNECT' : 'TRACY_NOT_CONNECTED'
        })
      const domain = await domainOr(c)
      if (domain instanceof Response) return domain
      const sent = (await body(c)) ?? {}
      let brief = null
      try {
        const { read } = await briefResearchOf(pool, mine.opp)
        brief = makeSiteBrief(domain, read, {
          opportunity: briefOpportunityOf(mine.opp),
          madeAt: new Date(now()).toISOString()
        })
      } catch (error) {
        // An unresearched place still has its name and address: send what there is.
        log.warn?.('[wo] no brief for a Tracy demo; sending the saved place only', error?.message)
      }
      const request = toDemoRequest(briefOpportunityOf(mine.opp), brief, {
        cms: sent.cms,
        template: sent.template
      })
      if (!request) return refuse(c, 422, 'PLACE_INCOMPLETE', 'This place has no name to build a demo for.')
      const row = await newRow(mine.who.accountId, mine.opp, request)
      // Lost the race to a second press: answer the demo that won.
      if (!row) {
        const won = await activeOf(mine.opp.id)
        return won ? c.json({ demo: demoOf(won) }, 200) : refuse(c, 409, 'TRY_AGAIN', 'Press Build again.')
      }
      try {
        const out = await submit(row)
        if (out.refusal) return c.json({ ...out.refusal.body, demo: demoOf(out.row) }, out.refusal.status)
        return c.json({ demo: demoOf(out.row) }, 202)
      } catch (error) {
        // Nothing reached Tracy: forget the row so the next press starts clean.
        await pool.query('delete from wo_tracy_demo where id = $1', [row.id])
        const refused = connectionRefusal(c, error)
        if (refused) return refused
        throw error
      }
    })

    app.post(`${BASE}/:id/tracy/demo/cancel`, async (c) => {
      const notJson = jsonOnly(c)
      if (notJson) return notJson
      const mine = await own(c)
      if (mine instanceof Response) return mine
      let row = await activeOf(mine.opp.id)
      if (!row || row.status === 'ready')
        return refuse(c, 409, 'NOTHING_TO_CANCEL', 'No demo is being built for this place.')
      try {
        // Not confirmed yet: send it again under its key first, to learn its id.
        if (row.status === 'submitting') row = (await submit(row)).row
        if (!row.demo_id)
          return refuse(c, 503, 'TRACY_UNAVAILABLE', 'Tracy did not answer; try again in a moment.')
        const res = await connection.call(`/v1/demos/${encodeURIComponent(row.demo_id)}/cancel`, {
          method: 'POST',
          body: {}
        })
        if (!res.ok)
          return refuse(c, 502, 'CANCEL_FAILED', 'Tracy did not cancel it; try again.', {
            status: res.status
          })
        const answer = await res.json().catch(() => null)
        row = await apply(row, { status: 'cancelled', ...answer })
        return c.json({ demo: demoOf(row) })
      } catch (error) {
        const refused = connectionRefusal(c, error)
        if (refused) return refused
        if (error?.code === 'TRACY_UNAVAILABLE')
          return refuse(c, 503, 'TRACY_UNAVAILABLE', 'Tracy did not answer; try again in a moment.')
        throw error
      }
    })
  }

  return defineBuilder({
    id: 'tracy',
    routes,
    settingsOf: async () => ({ builder: 'tracy', tracyUrl: connection.tracyUrl }),
    saveSettings: async () => ({
      status: 404,
      body: {
        code: 'NO_SETTINGS',
        next: 'The Tracy builder has nothing to set here; connect it on the Operator page.'
      }
    }),
    templateChoicesOf: async () => ({}),
    async listedDemoOf(accountId, ids) {
      const [mine, elsewhere] = await Promise.all([
        latestOf(accountId, ids),
        manual ? manual.listedDemoOf(accountId, ids) : new Map()
      ])
      const out = new Map(elsewhere)
      for (const [id, row] of mine) out.set(id, { demo: demoOf(row) })
      return out
    },
    async detailOf(opp, accountId) {
      const row = (await latestOf(accountId, [opp.id])).get(opp.id)
      if (row) return { demo: demoOf(row) }
      return manual ? manual.detailOf(opp, accountId) : { demo: null }
    },
    async demoFactsOf(accountId, ids) {
      const [mine, elsewhere] = await Promise.all([
        latestOf(accountId, ids),
        manual ? manual.demoFactsOf(accountId, ids) : new Map()
      ])
      const out = new Map(elsewhere)
      for (const [id, row] of mine) {
        if (row.status === 'refused') continue
        out.set(id, {
          built: row.status === 'ready' && !row.deleted_at,
          liveSiteKey: row.status === 'ready' && !row.deleted_at ? (row.site?.key ?? null) : null,
          queuedActionId: ACTIVE.includes(row.status) ? row.id : null
        })
      }
      return out
    },
    // Demo once Tracy has the request; Outreach once its demo is ready and still up.
    demoJourneySql: (where) => ({
      joins: `
  left join (select distinct on (d.opportunity_id) d.opportunity_id, d.status, d.deleted_at, d.frozen_at
             from wo_tracy_demo d where ${where('d')} and d.status <> 'refused'
             order by d.opportunity_id, d.created_at desc, d.id desc) td
    on td.opportunity_id = o.id`,
      outreach: `coalesce(td.status = 'ready' and td.deleted_at is null and td.frozen_at is null, false)`,
      demo: 'td.opportunity_id is not null',
      attention: `coalesce(td.status in ('failed', 'needs-review'), false)`
    }),
    tick
  })
}
