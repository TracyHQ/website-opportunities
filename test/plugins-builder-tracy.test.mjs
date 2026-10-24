// The `tracy` builder in the standalone server, end to end against a fake Tracy: the operator connects on the
// Operator page, then one press builds a demo, its status is followed to `ready`, a limit is surfaced, a cancel
// reaches Tracy, and a timeout never makes a second demo.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { migrate } from '../src/schema/index.js'
import { readStandaloneConfig } from '../src/standalone/config.js'
import { ensureOperatorPrincipal } from '../src/standalone/operator-principal.js'
import { createStandaloneApp } from '../src/standalone/server.js'
import { scratchDatabase } from './scratch-database.mjs'
import { startFakeTracy } from './tracy-fake.mjs'

const opts = { skip: process.env.TEST_DATABASE_URL ? false : 'set TEST_DATABASE_URL' }
const BASE = '/api/website-opportunities'
const OP = `${BASE}/operator`
const TOKEN = 'operator-token-for-the-tracy-builder-tests'
const quiet = { info() {}, warn() {}, error() {}, log() {} }

let scratch
let dataDir
let tracy
let app
let ticks
let principal
const clock = { t: Date.now() }

before(async () => {
  if (!process.env.TEST_DATABASE_URL) return
  scratch = await scratchDatabase()
  await migrate(scratch.pool)
  principal = (await ensureOperatorPrincipal(scratch.pool)).id
  dataDir = await mkdtemp(join(tmpdir(), 'wo-tracy-builder-'))
  tracy = await startFakeTracy()
  const config = readStandaloneConfig({
    DATABASE_URL: scratch.url,
    DATA_DIR: dataDir,
    OPERATOR_TOKEN: TOKEN,
    TRACY_URL: tracy.url
  })
  const made = createStandaloneApp({
    config,
    pool: scratch.pool,
    // Research and crawls stay offline; only the Tracy calls go out (to the fake).
    fetchImpl: async () => new Response('offline', { status: 404 }),
    tracyFetch: fetch,
    tracyTimeoutMs: 300,
    now: () => clock.t,
    log: quiet
  })
  app = made.app
  ticks = made.ticks
})

after(async () => {
  await tracy?.close()
  await scratch?.close()
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

async function call(method, path, body) {
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  )
  return { status: res.status, body: await res.json().catch(() => null) }
}

const tick = () => ticks.find((t) => t.name === 'tracy').run()

async function newOpportunity(name) {
  const { rows } = await scratch.pool.query(
    `insert into wo_opportunity (account_id, name, provider, provider_id, candidate)
     values ($1, $2, 'osm', $3, $4) returning id`,
    [
      principal,
      name,
      `node/${Math.random()}`,
      { name, address: '1 Main Street, Springfield', phone: '+1 555 0100', lat: 40.7, lon: -74 }
    ]
  )
  return rows[0].id
}

test('the Operator page has a Tracy tab', opts, async () => {
  const me = await call('GET', `${OP}/me`)
  assert.equal(me.body.tracy, true)
})

test('Build before connecting answers TRACY_NOT_CONNECTED and sends nothing', opts, async () => {
  const id = await newOpportunity('Early Bird')
  const out = await call('POST', `${BASE}/${id}/tracy/demo`, {})
  assert.equal(out.status, 409)
  assert.equal(out.body.code, 'TRACY_NOT_CONNECTED')
  assert.equal(tracy.state.demos.size, 0)
  assert.equal((await call('GET', `${BASE}/${id}`)).body.demo, null)
})

test('connect and disconnect need a JSON body', opts, async () => {
  const res = await app.fetch(
    new Request(`http://localhost${OP}/tracy/connect`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'text/plain' },
      body: '{}'
    })
  )
  assert.equal(res.status, 415)
})

test('the operator connects: code and link, then Connected as the account, never a token', opts, async () => {
  const pending = await call('POST', `${OP}/tracy/connect`, {})
  assert.equal(pending.status, 200)
  assert.equal(pending.body.state, 'pending')
  assert.match(pending.body.userCode, /^[0-9A-F]{4}-[0-9A-F]{4}$/)
  assert.ok(pending.body.verificationUriComplete.startsWith(tracy.url))
  tracy.decide(pending.body.userCode)
  const done = await call('GET', `${OP}/tracy`)
  assert.equal(done.body.state, 'connected')
  assert.equal(done.body.account.email, 'seller@example.com')
  assert.equal(JSON.stringify(done.body).includes('tra_'), false)
  assert.equal((await call('GET', `${BASE}/tracy/connection`)).body.state, 'connected')
})

let built
test('Build it with Tracy sends the place, then the tick follows the demo to ready', opts, async () => {
  built = await newOpportunity('Corner Cafe')
  const sent = await call('POST', `${BASE}/${built}/tracy/demo`, {})
  assert.equal(sent.status, 202, JSON.stringify(sent.body))
  assert.equal(sent.body.demo.status, 'queued')
  const [demo] = [...tracy.state.demos.values()]
  assert.equal(demo.body.schema, 'website-opportunities/demo-request/v1')
  assert.equal(demo.body.business.name, 'Corner Cafe')
  assert.deepEqual(demo.body.business.location, { lat: 40.7, lon: -74 })

  const again = await call('POST', `${BASE}/${built}/tracy/demo`, {})
  assert.equal(again.status, 200, 'a second press answers the same demo')
  assert.equal(tracy.state.demos.size, 1)

  tracy.advance(demo.id, 'building')
  clock.t += 15_000
  await tick()
  assert.equal((await call('GET', `${BASE}/${built}`)).body.demo.status, 'building')

  tracy.advance(demo.id, 'ready')
  clock.t += 15_000
  await tick()
  const detail = (await call('GET', `${BASE}/${built}`)).body.demo
  assert.equal(detail.status, 'ready')
  assert.equal(detail.url, 'https://corner-cafe.example')
  assert.equal(detail.editUrl, 'https://tracy.example/s/corner-cafe')
  assert.equal(detail.expiresAt, demo.expiresAt)
  // A ready demo moves the row to the Outreach stage with a draft carrying its link.
  const listed = (await call('GET', `${BASE}?ids=${built}`)).body.opportunities[0]
  assert.equal(listed.stage, 'outreach')
  assert.match(listed.outreach.message.auto, /corner-cafe\.example/)
})

test('the tick waits as long as Retry-After says', opts, async () => {
  const id = await newOpportunity('Slow Bakery')
  await call('POST', `${BASE}/${id}/tracy/demo`, {})
  const demo = [...tracy.state.demos.values()].at(-1)
  tracy.state.retryAfter = 120
  try {
    clock.t += 15_000
    await tick()
    const polls = demo.polls
    clock.t += 60_000
    await tick()
    assert.equal(demo.polls, polls, 'not asked again inside Retry-After')
    clock.t += 61_000
    await tick()
    assert.equal(demo.polls, polls + 1)
  } finally {
    tracy.state.retryAfter = null
  }
})

test('cancel reaches Tracy', opts, async () => {
  const id = await newOpportunity('Cancel Corner')
  await call('POST', `${BASE}/${id}/tracy/demo`, {})
  const out = await call('POST', `${BASE}/${id}/tracy/demo/cancel`, {})
  assert.equal(out.status, 200, JSON.stringify(out.body))
  assert.equal(out.body.demo.status, 'cancelled')
  assert.equal([...tracy.state.demos.values()].at(-1).status, 'cancelled')
})

test('a timeout never makes a second demo: the retry sends the same key and body', opts, async () => {
  const id = await newOpportunity('Timeout Tavern')
  const before = tracy.state.demos.size
  tracy.state.stallNextCreateMs = 1_000
  const sent = await call('POST', `${BASE}/${id}/tracy/demo`, {})
  assert.equal(sent.status, 202)
  assert.equal(sent.body.demo.status, 'submitting', 'not confirmed yet')
  assert.equal(tracy.state.demos.size, before + 1, 'Tracy made it anyway')
  await new Promise((r) => setTimeout(r, 1_100))
  clock.t += 60_000
  await tick()
  assert.equal(tracy.state.demos.size, before + 1, 'the retry found the same demo')
  assert.equal((await call('GET', `${BASE}/${id}`)).body.demo.status, 'queued')
})

test('the live demo limit comes back with its numbers', opts, async () => {
  const id = await newOpportunity('Full House')
  tracy.state.limit = 2
  try {
    const out = await call('POST', `${BASE}/${id}/tracy/demo`, {})
    assert.equal(out.status, 409)
    assert.equal(out.body.code, 'DEMO_LIMIT_REACHED')
    assert.equal(out.body.limit, 2)
    assert.ok(out.body.live >= 2)
    const demo = (await call('GET', `${BASE}/${id}`)).body.demo
    assert.equal(demo.status, 'refused')
    assert.equal(demo.error.code, 'DEMO_LIMIT_REACHED')
  } finally {
    tracy.state.limit = 20
  }
  // Room again: the same place can be sent.
  const retry = await call('POST', `${BASE}/${id}/tracy/demo`, {})
  assert.equal(retry.status, 202, JSON.stringify(retry.body))
})

test('the sponsor budget refusal is surfaced as it is', opts, async () => {
  const id = await newOpportunity('Budget Bistro')
  tracy.state.budgetExhausted = true
  try {
    const out = await call('POST', `${BASE}/${id}/tracy/demo`, {})
    assert.equal(out.status, 503)
    assert.equal(out.body.code, 'SPONSOR_BUDGET_EXHAUSTED')
  } finally {
    tracy.state.budgetExhausted = false
  }
})

test('revoked in Tracy: the page shows Reconnect, Build says so', opts, async () => {
  tracy.revokeAll()
  const id = await newOpportunity('After Revoke')
  const out = await call('POST', `${BASE}/${id}/tracy/demo`, {})
  assert.equal(out.status, 409)
  assert.equal(out.body.code, 'TRACY_RECONNECT')
  assert.equal((await call('GET', `${OP}/tracy`)).body.state, 'reconnect')
  // Disconnect still works and leaves a clean slate.
  const off = await call('POST', `${OP}/tracy/disconnect`, {})
  assert.equal(off.body.state, 'disconnected')
})
