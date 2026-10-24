// The hub client's local cache on a real database, with a scripted hub: an expired cursor re-checks every cached
// place, a place the hub no longer serves is dropped, and one it cannot check now (quota spent) is not used.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createHubLink, factsFromHubPlace } from '../src/hub/local-cache.js'
import { migrate } from '../src/schema/index.js'
import { scratchDatabase } from './scratch-database.mjs'

const opts = { skip: process.env.TEST_DATABASE_URL ? false : 'set TEST_DATABASE_URL' }
const NOW = Date.parse('2026-10-24T12:00:00Z')
const GONE = '11111111-1111-4111-8111-111111111111'
const UNCHECKED = '22222222-2222-4222-8222-222222222222'
const KEPT = '33333333-3333-4333-8333-333333333333'

const dto = (id, name) => ({
  id,
  revision: 1,
  fields: { name: { status: 'chosen', value: name, blocksBrief: false } },
  freshness: { observedAt: '2026-10-20T10:00:00.000Z' }
})

let db
before(async () => {
  if (!process.env.TEST_DATABASE_URL) return
  db = await scratchDatabase()
  await migrate(db.pool)
})
after(async () => db?.close())

test('an expired cursor re-checks the cache before the feed is read on', opts, async () => {
  const pool = db.pool
  for (const [id, name] of [[GONE, 'Gone'], [UNCHECKED, 'Unchecked'], [KEPT, 'Kept']]) {
    await pool.query(
      `insert into wo_hub_client_place (hub_place_id, revision, etag, dto) values ($1, 1, '"e"', $2::jsonb)`,
      [id, JSON.stringify(dto(id, name))]
    )
  }
  for (const feed of ['changes', 'revocations'])
    await pool.query(`insert into wo_hub_client_cursor (feed, cursor) values ($1, 'old')`, [feed])
  const answers = {
    [GONE]: { status: 'gone', code: 'deleted' },
    [UNCHECKED]: { status: 'quota' },
    [KEPT]: { status: 'not_modified' }
  }
  const hub = {
    feed: async (_name, cursor) => (cursor === 'old' ? { status: 'cursor_expired' } : { status: 'ok', events: [], cursor: 'head', more: false }),
    place: async (id) => answers[id],
    lookup: async () => ({ status: 'not_found' }),
    contribute: async () => assert.fail('nothing is queued')
  }
  const link = createHubLink({ pool, client: hub, now: () => NOW, log: { warn() {} } })
  const tally = await link.tick()
  assert.equal(tally.revalidated, 2, 'both feeds had expired')
  const rows = Object.fromEntries(
    (await pool.query('select hub_place_id, dto, revoked_at from wo_hub_client_place')).rows.map((r) => [r.hub_place_id, r])
  )
  assert.equal(rows[GONE].dto, null)
  assert.ok(rows[GONE].revoked_at, 'the hub no longer serves it: revoked here')
  assert.equal(rows[UNCHECKED].dto, null, 'not checkable now: not used')
  assert.equal(rows[UNCHECKED].revoked_at, null, 'but not called revoked either')
  assert.equal(rows[KEPT].dto.fields.name.value, 'Kept')
  const cursors = (await pool.query('select cursor from wo_hub_client_cursor')).rows.map((r) => r.cursor)
  assert.deepEqual(cursors, ['head', 'head'])
})

test('hub facts carry only fields the hub chose and did not block for briefs', opts, () => {
  const facts = factsFromHubPlace(
    {
      id: KEPT,
      revision: 3,
      fields: {
        name: { status: 'chosen', value: 'Cafe', blocksBrief: false },
        website: { status: 'conflicted', value: null, blocksBrief: true },
        phone: { status: 'weak', value: ['+3120555'], blocksBrief: true },
        address: { status: 'chosen', value: '1 Main St', blocksBrief: false }
      },
      freshness: { observedAt: '2026-10-20T10:00:00.000Z' }
    },
    { namespace: 'google', externalId: 'ChIJ-x' }
  )
  assert.equal(facts.name, 'Cafe')
  assert.equal(facts.formattedAddress, '1 Main St')
  assert.equal(facts.website, undefined)
  assert.equal(facts.internationalPhoneNumber, undefined)
  assert.equal(facts.via, 'hub')
  assert.equal(facts.placeId, 'ChIJ-x')
})
