// The body sent to Tracy's POST /v1/demos: public facts and public photo links only.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEMO_REQUEST_SCHEMA,
  demoRequestFingerprint,
  toDemoRequest
} from '../src/plugins/builders/tracy-request.js'
import { validateDemoRequest } from '../domain/demo-request.mjs'

const PLACE = {
  name: 'Corner Cafe',
  candidate: { name: 'Corner Cafe', address: '1 Main Street', phone: '+1 555 0100', lat: 40.7, lon: -74 }
}
const BRIEF = {
  business: {
    name: 'Corner Cafe',
    address: '1 Main Street, Springfield',
    phone: '+1 555 0100',
    hours: ['Monday: 8 AM to 4 PM'],
    trade: 'cafe',
    website: 'http://corner-cafe.example',
    socials: {
      facebook: 'https://www.facebook.com/cornercafe',
      linkedin: 'https://www.linkedin.com/company/cornercafe',
      myspace: 'https://myspace.example/x'
    }
  },
  googlePlace: { summaries: { editorial: 'A small cafe on the corner.' } },
  content: {
    items: [
      { id: 'a', kinds: ['dish'], title: 'Flat white', body: 'Double shot.', authorship: 'page', posts: [] }
    ]
  },
  assets: [
    {
      id: '1',
      kind: 'image',
      category: 'food',
      sha256: 'a',
      sourceUrl: 'https://cdn.example/a.jpg',
      alt: 'Coffee'
    },
    { id: '2', kind: 'image', category: 'space', sha256: 'b', sourceUrl: 'https://cdn.example/a.jpg' },
    { id: '3', kind: 'image', category: 'space', sha256: 'c', sourceUrl: 'http://cdn.example/plain.jpg' },
    { id: '4', kind: 'image', category: 'space', sha256: 'd', sourceUrl: 'https://10.0.0.0/x.jpg' },
    { id: '5', kind: 'image', category: 'space', sha256: 'e', sourceUrl: 'https://printer.local/x.jpg' },
    { id: '6', kind: 'image', category: 'space', sha256: 'f', objectKey: 'places/abc' },
    { id: '7', kind: 'video', category: 'space', sha256: 'g', sourceUrl: 'https://cdn.example/v.mp4' }
  ]
}

test('a researched place: business facts, items and only public https photos', () => {
  assert.deepEqual(toDemoRequest(PLACE, BRIEF, { cms: 'wordpress' }), {
    schema: DEMO_REQUEST_SCHEMA,
    business: {
      name: 'Corner Cafe',
      address: '1 Main Street, Springfield',
      location: { lat: 40.7, lon: -74 },
      phone: '+1 555 0100',
      website: 'http://corner-cafe.example/',
      category: 'cafe',
      hours: ['Monday: 8 AM to 4 PM'],
      socials: { facebook: 'https://www.facebook.com/cornercafe' },
      description: 'A small cafe on the corner.',
      items: [{ name: 'Flat white', description: 'Double shot.', section: 'dish' }]
    },
    photos: [{ url: 'https://cdn.example/a.jpg', caption: 'food', alt: 'Coffee' }],
    cms: 'wordpress'
  })
})

test('an unresearched place still sends its saved name, address and location', () => {
  const out = toDemoRequest(PLACE, null, { cms: 'not-a-cms' })
  assert.equal(out.business.name, 'Corner Cafe')
  assert.equal(out.business.address, '1 Main Street')
  assert.deepEqual(out.photos, [])
  assert.equal('cms' in out, false)
})

test('no name, no request', () => {
  assert.equal(toDemoRequest({ candidate: {} }, null), null)
})

test('the fingerprint ignores key order and follows every fact', () => {
  const a = toDemoRequest(PLACE, BRIEF)
  const b = JSON.parse(JSON.stringify(a))
  const reordered = Object.fromEntries(Object.entries(b).reverse())
  assert.equal(demoRequestFingerprint(a), demoRequestFingerprint(reordered))
  b.business.phone = '+1 555 0199'
  assert.notEqual(demoRequestFingerprint(a), demoRequestFingerprint(b))
})

test('every body the builder makes passes the contract Tracy validates (demo-request/v1)', () => {
  for (const [place, brief, choice] of [
    [PLACE, BRIEF, { cms: 'wordpress' }],
    [PLACE, null, {}],
    [PLACE, BRIEF, { cms: 'emdash', template: { quickstart: 'tracy-business', design: 'warm' } }]
  ]) {
    const body = toDemoRequest(place, brief, choice)
    const checked = validateDemoRequest(body)
    assert.equal(checked.ok, true, JSON.stringify(checked.errors))
  }
})
