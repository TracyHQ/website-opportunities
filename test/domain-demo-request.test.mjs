import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDemoRequest,
  DEMO_REQUEST_LIMITS,
  DEMO_REQUEST_SCHEMA,
  validateDemoRequest
} from '../domain/index.mjs'

const valid = () => ({
  schema: 'website-opportunities/demo-request/v1',
  business: {
    name: 'Pho Hanoi',
    address: '12 Hang Bac, Hanoi',
    location: { lat: 21.034, lon: 105.852 },
    phone: '+84 24 1234 5678',
    website: 'https://pho-hanoi.example',
    category: 'restaurant',
    hours: ['Mon–Fri 08:00–22:00'],
    socials: { facebook: 'https://facebook.com/phohanoi' },
    description: 'Family pho shop since 1990.',
    items: [{ name: 'Pho bo', price: '50000', currency: 'VND', section: 'Soups' }]
  },
  photos: [{ url: 'https://images.example/pho.jpg', caption: 'A bowl of pho' }],
  cms: 'wordpress',
  template: { quickstart: 'ja-food/wp', design: 'ja-food' }
})

test('a full demo request passes and comes back as the request Tracy reads', () => {
  const checked = validateDemoRequest(valid())
  assert.equal(checked.ok, true)
  assert.equal(checked.request.business.name, 'Pho Hanoi')
  assert.deepEqual(checked.request.photos, [
    { url: 'https://images.example/pho.jpg', caption: 'A bowl of pho' }
  ])
  // test-quality: contract the schema name is the wire identifier every builder sends
  assert.equal(DEMO_REQUEST_SCHEMA, 'website-opportunities/demo-request/v1')
})

test('the smallest request is a schema and a business name', () => {
  const checked = validateDemoRequest({ schema: DEMO_REQUEST_SCHEMA, business: { name: 'Cafe' } })
  assert.equal(checked.ok, true)
  assert.deepEqual(checked.request.photos, [])
})

test('a field the contract does not name is refused by its path, whoever sends it', () => {
  for (const [patch, path] of [
    [(b) => (b.accountId = 'x'), 'accountId'],
    [(b) => (b.siteKey = 'x'), 'siteKey'],
    [(b) => (b.business.ownSite = true), 'business.ownSite'],
    [(b) => (b.business.items[0].verified = true), 'business.items.0.verified'],
    [(b) => (b.business.provenance = { phone: 'google' }), 'business.provenance'],
    [(b) => (b.photos[0].objectKey = 'opportunities/a/b.jpg'), 'photos.0.objectKey']
  ]) {
    const body = valid()
    patch(body)
    const checked = validateDemoRequest(body)
    assert.equal(checked.ok, false, path)
    assert.ok(
      checked.errors.some((e) => e.path === path && e.code === 'UNKNOWN_FIELD'),
      path
    )
  }
})

test('wrong schema, missing name, bad URLs, CMS and limits are each named', () => {
  const cases = [
    [(b) => (b.schema = 'tracy-wo-place-bundle/v1'), 'schema', 'SCHEMA_UNSUPPORTED'],
    [(b) => delete b.business.name, 'business.name', 'REQUIRED'],
    [(b) => (b.business.website = 'ftp://x.example'), 'business.website', 'INVALID_URL'],
    [(b) => (b.photos[0].url = 'file:///etc/passwd'), 'photos.0.url', 'INVALID_URL'],
    [(b) => (b.business.location = { lat: 200, lon: 0 }), 'business.location.lat', 'OUT_OF_RANGE'],
    [(b) => (b.cms = 'drupal'), 'cms', 'INVALID_CMS'],
    [
      (b) => (b.business.description = 'x'.repeat(DEMO_REQUEST_LIMITS.description + 1)),
      'business.description',
      'TOO_LONG'
    ],
    [
      (b) =>
        (b.photos = Array.from({ length: DEMO_REQUEST_LIMITS.photos + 1 }, (_, i) => ({
          url: `https://i.example/${i}.jpg`
        }))),
      'photos',
      'TOO_MANY'
    ]
  ]
  for (const [patch, path, code] of cases) {
    const body = valid()
    patch(body)
    const checked = validateDemoRequest(body)
    assert.equal(checked.ok, false, path)
    assert.deepEqual(
      checked.errors.find((e) => e.path === path),
      { path, code },
      `${path}: ${JSON.stringify(checked.errors)}`
    )
  }
  assert.equal(validateDemoRequest(null).ok, false)
  assert.equal(validateDemoRequest([]).ok, false)
})

test('buildDemoRequest makes a valid request from loose place facts, dropping empty fields', () => {
  const request = buildDemoRequest({
    business: {
      name: '  Pho Hanoi ',
      phone: '',
      hours: ['Mon 8–22', ''],
      socials: { instagram: 'https://instagram.com/pho', tiktok: null }
    },
    photos: ['https://images.example/1.jpg', { url: 'https://images.example/2.jpg', alt: 'Dining room' }],
    cms: 'joomla'
  })
  assert.deepEqual(request, {
    schema: 'website-opportunities/demo-request/v1',
    business: { name: 'Pho Hanoi', hours: ['Mon 8–22'], socials: { instagram: 'https://instagram.com/pho' } },
    photos: [
      { url: 'https://images.example/1.jpg' },
      { url: 'https://images.example/2.jpg', alt: 'Dining room' }
    ],
    cms: 'joomla'
  })
  assert.equal(validateDemoRequest(request).ok, true)
})

test('buildDemoRequest keeps the first photos the contract allows', () => {
  const photos = Array.from({ length: 40 }, (_, i) => `https://i.example/${i}.jpg`)
  const request = buildDemoRequest({ business: { name: 'Cafe' }, photos })
  assert.equal(request.photos.length, DEMO_REQUEST_LIMITS.photos)
  assert.equal(validateDemoRequest(request).ok, true)
})
