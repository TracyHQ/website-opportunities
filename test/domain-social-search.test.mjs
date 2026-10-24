import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findSocialPages,
  matchSocialPage,
  searchPlaceOf,
  scrapeCreatorsGoogleSearch
} from '../domain/social-search.mjs'

const PLACE = {
  placeId: 'ChIJsansationJBR',
  name: 'Sansation Café',
  address: 'Shop 12, The Walk, Jumeirah Beach Residence, Dubai, United Arab Emirates',
  street: 'Shop 12, The Walk',
  locality: 'Dubai',
  phone: '+971 4 123 4567',
  socials: {}
}

const FB = 'https://www.facebook.com/sansationjbr'

/** A search provider that answers once with `links`, recording each query. */
function searcher(links, seen = []) {
  return async (query) => {
    seen.push(query)
    return links
  }
}

test('searchPlaceOf: Google facts and the search seed give name, street, locality and phone', () => {
  const p = searchPlaceOf(
    {
      placeId: 'ChIJx',
      name: 'Pho Ba',
      website: 'https://www.facebook.com/phoba',
      addressComponents: [
        { longText: '14', types: ['street_number'] },
        { longText: 'Al Wasl Road', types: ['route'] },
        { longText: 'Dubai', types: ['locality', 'political'] }
      ]
    },
    { phone: '+971 4 555 0101', address: '14 Al Wasl Road, Dubai' }
  )
  assert.equal(p.name, 'Pho Ba')
  assert.equal(p.street, '14 Al Wasl Road')
  assert.equal(p.locality, 'Dubai')
  assert.equal(p.phone, '+971 4 555 0101')
  assert.deepEqual(
    p.socials,
    { facebook: 'https://www.facebook.com/phoba' },
    'a social "website" is a known social page'
  )
  assert.equal(p.website, undefined)
})

test('match: name + locality + the branch address on the page → confirmed, with its evidence', () => {
  const m = matchSocialPage(PLACE, { name: 'Sansation Cafe JBR', address: 'Shop 12, The Walk, JBR, Dubai' })
  assert.equal(m.verdict, 'confirmed')
  assert.deepEqual(m.proofs, ['address'])
})

test('match: the branch phone on the page is a branch proof', () => {
  const m = matchSocialPage(PLACE, { name: 'Sansation Café', city: 'Dubai', phone: '04 123 4567' })
  assert.equal(m.verdict, 'confirmed')
  assert.deepEqual(m.proofs, ['phone'])
})

test('match: a page linking the Maps entry of exactly this place is a branch proof', () => {
  const m = matchSocialPage(PLACE, {
    name: 'Sansation Café',
    city: 'Dubai',
    links: ['https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJsansationJBR']
  })
  assert.equal(m.verdict, 'confirmed')
  assert.deepEqual(m.proofs, ['link'])
})

test('match: same name in the same city with no branch proof → pending, never confirmed', () => {
  const m = matchSocialPage(PLACE, { name: 'Sansation Café', city: 'Dubai' })
  assert.equal(m.verdict, 'pending')
  assert.ok(m.reasons.includes('no_branch_proof'))
})

test('match: same name, same city, another branch address → pending (another branch)', () => {
  const m = matchSocialPage(PLACE, { name: 'Sansation Café', address: 'Unit 3, Dubai Mall, Downtown, Dubai' })
  assert.equal(m.verdict, 'pending')
})

test("match: the chain's shared hotline only → pending", () => {
  const chain = { ...PLACE, phone: '+971 600 522 522' }
  const m = matchSocialPage(chain, { name: 'Sansation Café', city: 'Dubai', phone: '600 522 522' })
  assert.equal(m.verdict, 'pending')
  assert.ok(m.reasons.includes('shared_phone'))
  const shared = { ...PLACE, sharedPhones: ['+971 4 123 4567'] }
  assert.equal(
    matchSocialPage(shared, { name: 'Sansation Café', city: 'Dubai', phone: '04 123 4567' }).verdict,
    'pending'
  )
})

test("match: the chain's shared domain is not a branch link", () => {
  const m = matchSocialPage(
    { ...PLACE, website: 'https://sansation.ae/' },
    {
      name: 'Sansation Café',
      city: 'Dubai',
      website: 'https://sansation.ae'
    }
  )
  assert.equal(m.verdict, 'pending')
})

test('match: a page in another city → rejected', () => {
  assert.equal(matchSocialPage(PLACE, { name: 'Sansation Café', city: 'Abu Dhabi' }).verdict, 'rejected')
  const m = matchSocialPage(PLACE, {
    name: 'Sansation Café',
    address: 'Shop 12, The Walk, Al Reem Island, Abu Dhabi'
  })
  assert.equal(m.verdict, 'rejected')
  assert.ok(m.reasons.includes('locality_mismatch'))
})

test('match: another name → rejected; a contradicting phone blocks confirmation', () => {
  assert.equal(matchSocialPage(PLACE, { name: 'Burger Palace', city: 'Dubai' }).verdict, 'rejected')
  const m = matchSocialPage(PLACE, {
    name: 'Sansation Café',
    address: 'Shop 12, The Walk, Dubai',
    phone: '04 999 0000'
  })
  assert.equal(m.verdict, 'pending')
  assert.ok(m.reasons.includes('phone_differs'))
})

test('find: a place without a website finds its Facebook page with branch evidence', async () => {
  const seen = []
  const out = await findSocialPages(PLACE, {
    order: ['scrapecreators'],
    searchers: {
      scrapecreators: searcher(
        [
          { title: 'Sansation Café JBR | Facebook', url: `${FB}/`, description: 'Sansation Café, The Walk' },
          { title: 'Sansation menu', url: 'https://www.zomato.com/dubai/sansation/menu', description: '' }
        ],
        seen
      )
    },
    networks: ['facebook'],
    pageFacts: async (network, url) => {
      assert.equal(network, 'facebook')
      assert.equal(url, FB)
      return { name: 'Sansation Café JBR', address: 'Shop 12, The Walk, JBR, Dubai', followers: 4000 }
    }
  })
  assert.equal(seen.length, 1)
  assert.match(seen[0], /Sansation Café/)
  assert.match(seen[0], /Dubai/)
  assert.equal(out.confirmed.length, 1)
  const [hit] = out.confirmed
  assert.equal(hit.network, 'facebook')
  assert.equal(hit.url, FB)
  assert.equal(hit.provider, 'scrapecreators')
  assert.deepEqual(hit.evidence.proofs, ['address'])
  assert.equal(hit.evidence.query, seen[0])
  assert.deepEqual(out.pending, [])
})

test('find: a search snippet alone (no page facts) is pending, not a confirmed source', async () => {
  const out = await findSocialPages(PLACE, {
    order: ['jina'],
    searchers: {
      jina: searcher([
        { title: 'Sansation Café Dubai', url: FB, description: 'Shop 12, The Walk, Dubai +971 4 123 4567' }
      ])
    },
    networks: ['facebook']
  })
  assert.deepEqual(out.confirmed, [])
  assert.equal(out.pending.length, 1)
  assert.ok(out.pending[0].evidence.reasons.includes('no_page_facts'))
})

test('find: a page in another city is dropped; the same name in the same city stays pending', async () => {
  const facts = {
    'https://www.facebook.com/sansationad': { name: 'Sansation Café', city: 'Abu Dhabi' },
    'https://www.facebook.com/sansationdubai': { name: 'Sansation Café', city: 'Dubai' }
  }
  const out = await findSocialPages(PLACE, {
    order: ['scrapecreators'],
    searchers: {
      scrapecreators: searcher(Object.keys(facts).map((url) => ({ title: 'Sansation', url })))
    },
    networks: ['facebook'],
    pageFacts: async (_n, url) => facts[url]
  })
  assert.deepEqual(out.confirmed, [])
  assert.deepEqual(
    out.pending.map((p) => p.url),
    ['https://www.facebook.com/sansationdubai']
  )
  assert.deepEqual(
    out.rejected.map((p) => p.url),
    ['https://www.facebook.com/sansationad']
  )
})

test('find: networks the place already has are not searched; non-profile links are ignored', async () => {
  const seen = []
  const out = await findSocialPages(
    { ...PLACE, socials: { facebook: FB } },
    {
      order: ['scrapecreators'],
      searchers: {
        scrapecreators: searcher(
          [{ url: 'https://www.instagram.com/p/Cabc123/' }, { url: 'https://www.facebook.com/other' }],
          seen
        )
      },
      networks: ['facebook', 'instagram'],
      pageFacts: async () => ({ name: 'Sansation Café', address: 'Shop 12, The Walk, Dubai' })
    }
  )
  assert.ok(seen.length >= 1 && seen.every((q) => /instagram/i.test(q)), 'only instagram is searched')
  assert.deepEqual([...out.confirmed, ...out.pending, ...out.rejected], [])
})

test('find: falls to the next provider on credential/quota/error, not on not_found', async () => {
  const fail = (code) => async () => {
    throw Object.assign(new Error(code), { code })
  }
  const out = await findSocialPages(PLACE, {
    order: ['deepseek', 'jina', 'missing', 'scrapecreators', 'firecrawl'],
    searchers: {
      deepseek: fail('CREDENTIAL_INVALID'),
      jina: fail('QUOTA'),
      scrapecreators: async () => [],
      firecrawl: async () => {
        throw new Error('must not be called after not_found')
      }
    },
    networks: ['facebook'],
    pageFacts: async () => null
  })
  assert.deepEqual(
    out.tried
      .filter((t) => t.query === out.tried[0].query)
      .map((t) => [t.provider, t.status, t.reason ?? null]),
    [
      ['deepseek', 'skipped', 'credential_invalid'],
      ['jina', 'skipped', 'quota'],
      ['missing', 'skipped', 'credential_missing'],
      ['scrapecreators', 'not_found', null]
    ]
  )
})

test('find: an empty order searches nothing', async () => {
  const out = await findSocialPages(PLACE, {
    order: [],
    searchers: {
      jina: async () => {
        throw new Error('no')
      }
    }
  })
  assert.deepEqual(out.tried, [])
  assert.deepEqual(out.confirmed, [])
})

test('scrapeCreatorsGoogleSearch: one GET with the key in a header, links mapped', async () => {
  let call
  const links = await scrapeCreatorsGoogleSearch('Sansation Café Dubai facebook', {
    key: 'sk-test',
    fetch: async (url, init) => {
      call = { url: String(url), init }
      return new Response(
        JSON.stringify({ success: true, results: [{ title: 'T', url: FB, description: 'D' }, { url: 7 }] }),
        { status: 200 }
      )
    }
  })
  assert.equal(new URL(call.url).pathname, '/v1/google/search')
  assert.equal(new URL(call.url).searchParams.get('query'), 'Sansation Café Dubai facebook')
  assert.equal(call.init.headers['x-api-key'], 'sk-test')
  assert.deepEqual(links, [{ title: 'T', url: FB, description: 'D' }])
})

test('scrapeCreatorsGoogleSearch: errors carry contract codes', async () => {
  const at = (status, body = {}) =>
    scrapeCreatorsGoogleSearch('q', {
      key: 'k',
      fetch: async () => new Response(JSON.stringify(body), { status })
    }).then(
      () => null,
      (e) => e.code
    )
  assert.equal(
    await scrapeCreatorsGoogleSearch('q', {}).then(
      () => null,
      (e) => e.code
    ),
    'CREDENTIAL_MISSING'
  )
  assert.equal(await at(401), 'CREDENTIAL_INVALID')
  assert.equal(await at(402), 'QUOTA')
  assert.equal(await at(429), 'QUOTA')
  assert.equal(await at(500), 'PROVIDER_ERROR')
})

test('find: an error deps.rethrow claims (the budget running out) stops the search instead of falling through', async () => {
  class Spent extends Error {}
  const run = (pageFacts, search = async () => [{ url: FB }]) =>
    findSocialPages(PLACE, {
      order: ['scrapecreators', 'jina'],
      searchers: {
        scrapecreators: search,
        jina: async () => {
          throw new Error('must not be reached')
        }
      },
      networks: ['facebook'],
      pageFacts,
      rethrow: (e) => e instanceof Spent
    })
  await assert.rejects(
    run(
      async () => null,
      async () => {
        throw new Spent('budget')
      }
    ),
    Spent
  )
  await assert.rejects(
    run(async () => {
      throw new Spent('budget')
    }),
    Spent
  )
})

// The Oishii case (dev, 24/10/2026): Instagram writes the name one letter short and drops the cuisine word.
const OISHII = {
  placeId: 'ChIJoishii',
  name: 'Oishii Sushi Bar',
  street: 'Sarab 1B',
  locality: 'Dubai',
  phone: '+971 56 666 4608',
  socials: {}
}

test('match: a name one letter off with the branch phone → confirmed, marked name_near', () => {
  const m = matchSocialPage(OISHII, { name: 'Oishi • Dubai', city: 'Dubai', phone: '056 666 4608' })
  assert.equal(m.verdict, 'confirmed')
  assert.deepEqual(m.proofs, ['phone'])
  assert.ok(m.reasons.includes('name_near'))
})

test('match: a name one letter off with no branch proof → pending, not rejected', () => {
  const m = matchSocialPage(OISHII, { name: 'Oishi • Dubai', city: 'Dubai' })
  assert.equal(m.verdict, 'pending')
  assert.ok(m.reasons.includes('name_near'))
})

test('match: a name one letter off with only a short phone tail → pending', () => {
  const m = matchSocialPage(OISHII, { name: 'Oishi • Dubai', city: 'Dubai', phone: '4608' })
  assert.equal(m.verdict, 'pending')
})

test('match: two letters off, or a short word one letter off → rejected', () => {
  assert.equal(
    matchSocialPage(OISHII, { name: 'Oish Dubai', city: 'Dubai', phone: '056 666 4608' }).verdict,
    'rejected'
  )
  const pho = { ...OISHII, name: 'Pho Ba' }
  assert.equal(
    matchSocialPage(pho, { name: 'Pho Bo', city: 'Dubai', phone: '056 666 4608' }).verdict,
    'rejected'
  )
})

test('match: a page that says it is closed is never confirmed', () => {
  const m = matchSocialPage(OISHII, {
    name: 'Oishii Sushi Bar',
    city: 'Dubai',
    phone: '056 666 4608',
    bio: 'TEMPORARILY CLOSED 🍣 Sushi & rolls'
  })
  assert.equal(m.verdict, 'pending')
  assert.ok(m.reasons.includes('page_closed'))
})

test("searchPlaceOf: the seed's shared phones reach the matcher", () => {
  const p = searchPlaceOf({ name: 'X' }, { phone: '+971 4 123 4567', sharedPhones: ['+971 4 123 4567'] })
  assert.deepEqual(p.sharedPhones, ['+971 4 123 4567'])
})

test('find: the first query finds nothing → the phone query finds the page', async () => {
  const seen = []
  const out = await findSocialPages(OISHII, {
    order: ['scrapecreators'],
    networks: ['instagram'],
    searchers: {
      scrapecreators: async (q) => {
        seen.push(q)
        return q.includes('666') ? [{ url: 'https://www.instagram.com/oishidubai/' }] : []
      }
    },
    pageFacts: async () => ({ name: 'Oishi • Dubai', city: 'Dubai', phone: '056 666 4608' })
  })
  assert.equal(seen.length, 2)
  assert.match(seen[0], /Oishii Sushi Bar Dubai instagram/)
  assert.match(seen[1], /666/)
  assert.equal(out.confirmed.length, 1)
  assert.equal(out.confirmed[0].evidence.query, seen[1])
})

test('find: a confirmed page on the first query runs no other query', async () => {
  const seen = []
  await findSocialPages(OISHII, {
    order: ['scrapecreators'],
    networks: ['facebook'],
    searchers: {
      scrapecreators: async (q) => (seen.push(q), [{ url: 'https://www.facebook.com/oishiisushibar' }])
    },
    pageFacts: async () => ({ name: 'Oishii Sushi Bar | Dubai', city: 'Dubai', phone: '056 666 4608' })
  })
  assert.equal(seen.length, 1)
})

test('find: at most three queries a network, each a priced search', async () => {
  const seen = []
  const out = await findSocialPages(OISHII, {
    order: ['scrapecreators'],
    networks: ['instagram'],
    searchers: { scrapecreators: async (q) => (seen.push(q), []) },
    pageFacts: async () => null
  })
  assert.equal(seen.length, 3)
  assert.equal(new Set(seen).size, 3)
  assert.deepEqual(out.searched, { instagram: { status: 'not_found', queries: 3 } })
})

test('find: every provider failing a network reports it failed, not not_found', async () => {
  const out = await findSocialPages(OISHII, {
    order: ['scrapecreators'],
    networks: ['facebook', 'instagram'],
    searchers: {
      scrapecreators: async (q) => {
        if (q.includes('instagram')) throw Object.assign(new Error('t'), { code: 'TIMEOUT' })
        return []
      }
    },
    pageFacts: async () => null
  })
  assert.equal(out.searched.facebook.status, 'not_found')
  assert.equal(out.searched.instagram.status, 'failed')
  assert.equal(out.searched.instagram.reason, 'timeout')
})

// Barb Wire Saigon (stand, 24/10/2026): one ScrapeCreators search got no answer, the same query 2 s later found the page.
test('find: a search that got no answer is asked once more before the network is reported failed', async () => {
  const IG_PAGE = 'https://www.instagram.com/oishidubai'
  const noAnswer = Object.assign(new Error('scrapecreators: request failed'), {
    code: 'PROVIDER_ERROR',
    noAnswer: true
  })
  for (const first of [noAnswer, Object.assign(new Error('t'), { code: 'TIMEOUT' })]) {
    const seen = []
    const out = await findSocialPages(OISHII, {
      order: ['scrapecreators'],
      networks: ['instagram'],
      searchers: {
        scrapecreators: async (q) => {
          seen.push(q)
          if (seen.length === 1) throw first
          return [{ url: IG_PAGE }]
        }
      },
      pageFacts: async () => ({ name: 'Oishi • Dubai', city: 'Dubai', phone: '056 666 4608' })
    })
    assert.deepEqual(seen, [seen[0], seen[0]], 'the same query, twice')
    assert.equal(out.searched.instagram.status, 'confirmed', first.code)
    assert.equal(out.searched.instagram.queries, 1)
  }
})

test('find: a second silence fails the network; an answered refusal is never asked twice', async () => {
  const calls = { timeout: 0, quota: 0 }
  const out = await findSocialPages(OISHII, {
    order: ['scrapecreators'],
    networks: ['instagram'],
    searchers: {
      scrapecreators: async () => {
        calls.timeout += 1
        throw Object.assign(new Error('t'), { code: 'TIMEOUT' })
      }
    },
    pageFacts: async () => null
  })
  assert.equal(calls.timeout, 2)
  assert.deepEqual(out.searched.instagram, { status: 'failed', queries: 0, reason: 'timeout' })
  for (const code of ['QUOTA', 'CREDENTIAL_INVALID', 'PROVIDER_ERROR']) {
    calls.quota = 0
    await findSocialPages(OISHII, {
      order: ['scrapecreators'],
      networks: ['instagram'],
      searchers: {
        scrapecreators: async () => {
          calls.quota += 1
          throw Object.assign(new Error('x'), { code })
        }
      },
      pageFacts: async () => null
    })
    assert.equal(calls.quota, 1, code)
  }
})

test('scrapeCreatorsGoogleSearch: a request that got no HTTP answer says so', async () => {
  const e = await scrapeCreatorsGoogleSearch('q', {
    key: 'k',
    fetch: async () => {
      throw new TypeError('fetch failed')
    }
  }).catch((x) => x)
  assert.equal(e.code, 'PROVIDER_ERROR')
  assert.equal(e.noAnswer, true)
  const http = await scrapeCreatorsGoogleSearch('q', {
    key: 'k',
    fetch: async () => new Response('{}', { status: 500 })
  }).catch((x) => x)
  assert.equal(http.noAnswer, undefined)
})

// Oishii Sushi Bar (dev, place f0e9664d…, 24/10/2026): Google Place Details as fetched, the city in Arabic.
const OISHII_FACTS = {
  placeId: 'ChIJ_fi9rf9vXz4R7GqMi3aXBzM',
  name: 'Oishii Sushi Bar',
  addressComponents: [
    { longText: 'Emirates Accommodation Sarab 1B', languageCode: 'ar-Latn' },
    {
      types: ['neighborhood', 'political'],
      longText: 'Al Barari',
      shortText: 'Al Barari',
      languageCode: 'en'
    },
    {
      types: ['sublocality_level_1', 'sublocality', 'political'],
      longText: 'وادي الصفا 3',
      languageCode: 'ar'
    },
    { types: ['locality', 'political'], longText: 'دبي', shortText: 'دبي', languageCode: 'ar' },
    {
      types: ['administrative_area_level_1', 'political'],
      longText: 'دبي',
      shortText: 'دبي',
      languageCode: 'ar'
    },
    { types: ['country', 'political'], longText: 'United Arab Emirates', shortText: 'AE', languageCode: 'en' }
  ]
}
const OISHII_SEED = {
  address: 'Emirates Accommodation Sarab 1B - وادي الصفا 3 - Al Barari - دبي - United Arab Emirates',
  phone: '056 666 4608'
}
// The page as ScrapeCreators read it on 24/10/2026.
const OISHII_FB_PAGE = {
  name: 'Oishii Sushi Bar',
  address: 'Emirates Accommodation Sarab 1B, Al Barari, Dubai, United Arab Emirates',
  phone: '+971 56 666 4608',
  website: 'http://www.oishiisushibar.ae/'
}

test('searchPlaceOf: a city in another script than the name is left out; the Latin areas and the country stay', () => {
  const p = searchPlaceOf(OISHII_FACTS, OISHII_SEED)
  assert.equal(p.locality, undefined)
  assert.deepEqual(p.localities, ['Al Barari'])
  assert.equal(p.country, 'AE')
})

test('searchPlaceOf: a name and city in the same non-Latin script keep the city', () => {
  const p = searchPlaceOf({
    name: 'すし処 銀座',
    addressComponents: [
      { types: ['locality', 'political'], longText: '中央区' },
      { types: ['country', 'political'], longText: '日本', shortText: 'JP' }
    ]
  })
  assert.equal(p.locality, '中央区')
  assert.equal(p.country, 'JP')
})

test('match: a page naming one of the Latin areas (the neighbourhood) matches the locality', () => {
  const m = matchSocialPage(searchPlaceOf(OISHII_FACTS, OISHII_SEED), OISHII_FB_PAGE)
  assert.equal(m.verdict, 'confirmed')
  assert.deepEqual(m.proofs, ['phone'])
})

test("find: every search carries the place's country, and no query carries a city in another script", async () => {
  const seen = []
  const found = await findSocialPages(searchPlaceOf(OISHII_FACTS, OISHII_SEED), {
    order: ['serp'],
    networks: ['facebook'],
    searchers: {
      serp: async (query, where) => {
        seen.push({ query, where })
        return [{ title: 'Oishii Sushi Bar | Dubai', url: 'https://www.facebook.com/oishiisushibar.ae/' }]
      }
    },
    pageFacts: async () => OISHII_FB_PAGE
  })
  assert.deepEqual(seen, [{ query: 'Oishii Sushi Bar facebook', where: { country: 'AE' } }])
  assert.equal(found.searched.facebook.status, 'confirmed')
  assert.equal(found.confirmed[0].url, 'https://www.facebook.com/oishiisushibar.ae')
})

test('scrapeCreatorsGoogleSearch: a country becomes the region parameter', async () => {
  let call
  await scrapeCreatorsGoogleSearch('q', {
    key: 'k',
    country: 'ae',
    fetch: async (url) => {
      call = new URL(String(url))
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }
  })
  assert.equal(call.searchParams.get('region'), 'AE')
})
