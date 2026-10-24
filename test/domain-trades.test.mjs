// Which trade a business is in (`domain/trades.mjs`), and Add site's search for any business by name and city.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as domain from '../domain/index.mjs'

test('a business is placed in its trade by its primary type, then its other types; unknown types are other', () => {
  assert.equal(domain.tradeOfPlace({ primaryType: 'dentist' }), 'health')
  assert.equal(domain.tradeOfPlace({ primaryType: 'italian_restaurant' }), 'food')
  assert.equal(domain.tradeOfPlace({ kind: 'bars' }), 'food')
  assert.equal(
    domain.tradeOfPlace({ primaryType: 'point_of_interest', types: ['establishment', 'spa'] }),
    'beauty'
  )
  assert.equal(domain.tradeOfPlace({ primaryType: 'lawyer' }), 'professional')
  assert.equal(domain.tradeOfPlace({ primaryType: 'hotel' }), 'hospitality')
  assert.equal(domain.tradeOfPlace({ primaryType: 'car_repair' }), 'auto')
  assert.equal(domain.tradeOfPlace({ primaryType: 'establishment' }), 'other')
  assert.equal(domain.tradeOfPlace(), 'other')
  assert.ok(domain.TRADES.includes('other'))
})

const KEY = 'test-key'
const resolve = async () => [{ address: '142.250.0.1', family: 4 }]
const okJson = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

test('anyKind keeps every business with its trade, asks for types, and still leaves out towns', async () => {
  const seen = []
  const places = [
    {
      id: 'smile',
      displayName: { text: 'Smile Dental' },
      primaryType: 'dentist',
      types: ['dentist', 'health'],
      location: { latitude: 1, longitude: 2 }
    },
    {
      id: 'pho',
      displayName: { text: 'Pho 24' },
      primaryType: 'vietnamese_restaurant',
      location: { latitude: 1, longitude: 2 }
    },
    {
      id: 'hanoi',
      displayName: { text: 'Hanoi' },
      primaryType: 'locality',
      location: { latitude: 1, longitude: 2 }
    }
  ]
  const fetch = async (url, init) => {
    seen.push(init)
    return okJson({ places })
  }
  const any = await domain.searchNamedPlaces(
    { query: 'Smile Dental Hanoi', anyKind: true },
    { googleKey: KEY, resolve, fetch }
  )
  assert.deepEqual(
    any.candidates.map((c) => `${c.providerId}:${c.trade}`),
    ['smile:health', 'pho:food']
  )
  assert.match(new Headers(seen[0].headers).get('x-goog-fieldmask'), /places\.types/)
  const find = await domain.searchNamedPlaces(
    { query: 'Smile Dental Hanoi' },
    { googleKey: KEY, resolve, fetch }
  )
  assert.deepEqual(
    find.candidates.map((c) => c.providerId),
    ['pho']
  )
  assert.equal(find.candidates[0].trade, undefined)
  assert.doesNotMatch(new Headers(seen[1].headers).get('x-goog-fieldmask'), /places\.types/)
})

test('the schema.org type a website states is its trade; LocalBusiness and the unknown are other', () => {
  assert.equal(domain.tradeOfSchemaType('Dentist'), 'health')
  assert.equal(domain.tradeOfSchemaType('DaySpa'), 'beauty')
  assert.equal(domain.tradeOfSchemaType('Attorney'), 'professional')
  assert.equal(domain.tradeOfSchemaType('Restaurant'), 'food')
  assert.equal(domain.tradeOfSchemaType('LocalBusiness'), 'other')
  assert.equal(domain.tradeOfSchemaType(undefined), 'other')
})
