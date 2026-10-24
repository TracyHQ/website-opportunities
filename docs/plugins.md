# Plugins

Website Opportunities is extended through four kinds of small plugin. Each kind has an interface, a
loader and one working example in this repository. This page gives one section per kind.

| Kind | Interface and loader | Example |
|---|---|---|
| Source | `src/plugins/sources.js` | `src/plugins/sources/osm.js` |
| Scoring rule | `domain/opportunity-score.mjs`, loader in `src/plugins/scoring.js` | `domain/scoring/no-website.mjs` |
| Outreach template | `src/plugins/outreach.js` | `src/plugins/outreach/en/demo.json` |
| Builder | `src/plugins/builders.js` | `src/plugins/builders/manual.js` |

Every plugin file is a module whose **default export** is the plugin (a plain object, or for a builder
a factory). A loader reads a folder in file-name order and checks each plugin; a malformed one stops
the load with a `TypeError` that names what is wrong.

General rules for every plugin:

- **No hidden network access.** Take `fetch` from `deps`; never import a global HTTP client.
- **Unknown is `null`.** Never return a guessed value.
- **Keep the source.** Every value you return says where it came from.
- **English** for code, comments and identifiers.

## 1. Sources (`src/plugins/sources/`)

A source answers one or more *capability groups* (`domain/capabilities.mjs`): a question research can
ask, such as "Find places in an area" (`map-discovery`), "Web search" or "Tripadvisor reviews". A
discovery source finds businesses in an area; an evidence source collects what is public about one
business.

**Interface** (`defineSource` checks it):

```js
export default {
  id: 'osm',                 // kebab-case; the provider id the operator orders
  label: 'OpenStreetMap',    // what the settings page shows
  credential: null,          // the key it needs (a PROVIDER_CREDENTIALS name), or null
  groups: ['map-discovery'], // capability groups it answers
  discover: async ({ lat, lon, radiusM, limit }, deps) => [/* candidates */], // for map-discovery
  // collect: async (place, deps) => evidence                                  // for any other group
}
```

`deps` carries `fetch` (plus `resolve` and `timeoutMs`), and `key` when the source has a credential.
Throw on a provider failure; set `code` or `status` on the error (`TIMEOUT`, `QUOTA` or 429, 401/403,
5xx) so the next provider can be tried. Fetch untrusted URLs only through `fetchLimited`
(`domain/fetch-limited.mjs`) and the URL guard (`domain/url-guard.mjs`).

A candidate has this shape (fields you do not have are left out, not set to empty strings):

```js
{
  provider: 'example',         // your source id
  providerId: 'abc123',        // the id of this place at the provider
  name: 'Corner Cafe',
  address: '1 Main Street, Springfield',
  phone: '+1 555 0100',
  lat: 40.0,
  lon: -74.0,
  website: 'https://corner-cafe.example',
  socials: { facebook: 'https://www.facebook.com/cornercafe' }
}
```

**Loader and runner:**

- `sourceRegistry(sources)` checks a list (built-in: `BUILT_IN_SOURCES`) and answers `get(id)`,
  `list()` and `forGroup(groupId)`.
- `loadSources(dir)` adds every source file of a folder to the built-in ones.
- `discoverInOrder(registry, order, area, { keys, fetch, ... })` asks the discovery sources in the
  operator's order (`resolveOrder(providerOrder, 'map-discovery')`) through `runInOrder`: the first
  with candidates answers, one with none ends the search as `not_found`, a missing key or a failure
  falls to the next.

**Example:** `src/plugins/sources/osm.js` wraps the OpenStreetMap search (`searchRestaurants` in
`domain/discovery-osm.mjs`) without changing it. Test: `test/plugins-sources.test.mjs`.

**The other built-in providers** still run through their own code: the Find search calls
`discoverRestaurants` (`domain/discovery-gmaps.mjs`), which tries Google Places, then Apify Google
Maps, then OpenStreetMap; research calls the evidence providers of each group in
`src/place-executor.js`. Each would register the same way as `osm`, for example:

```js
// Google Places as a source (not registered yet)
import { searchRestaurantsGplaces } from '../../../domain/discovery-gplaces.mjs'
export default {
  id: 'google', label: 'Google Places API', credential: 'google', groups: ['map-discovery'],
  discover: (area, deps) => searchRestaurantsGplaces(area, { ...deps, googleKey: deps.key })
}
```

Moving the Find search and research onto the registry is the next step; until then a new source is
used by code that calls `discoverInOrder` or the registry directly. For the operator to order a new
provider on the settings page, add it to its group in `domain/capabilities.mjs` too.

## 2. Scoring rules (`domain/scoring/`)

The opportunity score runs from 0 to 100 with a grade (A from 75, B from 50, else C) and the list of
reasons behind it. It is the sum of what each rule gives, halved once for a chain and once for a
place marked temporarily closed (those two are fixed, not rules).

The engine and the built-in rules live in `domain/` because the browser client bundles them; files
there import nothing outside `domain/` and no npm package.

**Interface** (`defineScoringRule` checks it):

```js
export default {
  id: 'no-website',  // kebab-case, unique
  weight: 40,        // the most points it can give; more is cut to the weight, less than 0 to 0
  holdsScore: false, // optional: true makes the score `pending` while this rule answers `points: null`
  score({ candidate, siteCheck, social, slowSiteThreshold, now }) {
    if (candidate.website) return null              // does not apply: no reason is listed
    return { points: 40, reason: 'web.none' }       // reason = the translation key the UI shows
  }
}
```

`points: null` means the data the rule needs is still being checked (the UI shows a spinner); `0`
means "checked, no points". A rule is pure: no clock but `now`, no network.

**Built-in rules, in order:** `no-website` (40), `website-health` (40: down, slow, insecure, not
mobile-friendly or dated), `demand` (30: reviews and rating), `marketing` (20: the last social post),
`contact` (10). `scoreOpportunity` is `scoreWithRules(BUILT_IN_SCORING_RULES, input)`.

**Loader:** `loadScoringRules(dir)` (`src/plugins/scoring.js`) returns the built-in rules followed by
every rule file of a folder; pass the result to `scoreWithRules`. A rule the project accepts is added
to `domain/scoring/` and to `BUILT_IN_SCORING_RULES`. Find still scores with the built-in rules;
letting an operator add a folder of rules is not wired yet.

**Example:** `domain/scoring/no-website.mjs`. Test: `test/plugins-scoring.test.mjs`, which also checks
that the built-in rules give byte-identical scores to the single function they replaced.

## 3. Outreach templates (`src/plugins/outreach/<lang>/`)

An outreach template is the text of a first message in one language. The app never sends it: it
drafts it, and the user copies or sends it.

**Interface:** one folder per language (`en`, `pt`, `pt-BR`), one JSON file per kind of message. The
only kind today is `demo.json`, the offer of a demo website. Five strings with three placeholders:
`{place}` (the business name), `{url}` (the demo link) and `{expires}` (the date the demo is kept
until, formatted for the language).

| Key | Used for |
|---|---|
| `greeting` | First line |
| `body` | The offer, must contain `{url}` |
| `expiry` | Closing line when the demo has an end date, must contain `{expires}` |
| `kept` | Closing line when the demo has no end date |
| `subject` | Email subject |

```json
{
  "greeting": "Hello {place} team,",
  "body": "I made a free demo website for {place}: {url}",
  "expiry": "Have a look. The demo is available until {expires}.",
  "kept": "Have a look at the demo.",
  "subject": "A demo website for {place}"
}
```

**Loader:** `src/plugins/outreach.js` reads the built-in file `src/outreach-templates.json` (keyed by
language) and every `outreach/<lang>/` folder when the server starts. A language defined in both
places is refused, and English is required (it is the fallback). Every language with a template is a
language a message can be drafted in (`MESSAGE_LANGUAGES`). `src/outreach-countries.json` maps a
country (and a phone prefix) to the language a message should use; add your country there when you
add a language.

**Example:** `src/plugins/outreach/en/demo.json`, the English template moved out of the built-in
file. Test: `test/plugins-outreach.test.mjs`. To move another language to a folder, delete its entry
from `outreach-templates.json` in the same change.

Write the text as a native speaker would. Keep it short, polite and free of claims you cannot back up.

## 4. Builders (`src/plugins/builders/`)

A builder turns an opportunity's research into a website, somewhere else. The router takes one
(`deps.builder`); without one, nothing builds and the demo fields are left out of every answer.

**Interface** (`defineBuilder` checks it): exactly the members the router calls.

| Member | Called for |
|---|---|
| `id` | kebab-case name |
| `routes(app, ctx)` | mounts the builder's own doors on the router's Hono app; `ctx` holds the router's helpers (`caller`, `refuse`, `notFound`, `featureOn`, `featureOff`, `domainOr`, `domainDeps`, `runtime`, `body`, `candidateFields`, `urlFields`, `jobShape`, `startResearch`, `UUID`, `REQUEST_ID`) |
| `settingsOf(domain, accountId)` | `GET /settings` |
| `saveSettings(domain, accountId, sent)` | `PUT /settings`, returns `{ status, body }` |
| `templateChoicesOf(settings)` | `templates` of `GET /capabilities` |
| `listedDemoOf(accountId, ids)` | a `Map` of the demo columns of listed rows |
| `detailOf(opp, accountId)` | the demo half of `GET /:id` |
| `demoFactsOf(accountId, ids)` | a `Map` of `{ built, liveSiteKey, queuedActionId }` for Find |
| `demoJourneySql` | `null`, or SQL fragments that move a row to the Demo and Outreach stages |

A list of ids may hold ids that are not the account's: answer only for the account's own. A builder
file's default export is a factory, `(deps) => builder`; `loadBuilderFactories(dir)` returns them by
file name.

**Builders in this repository:**

- **`manual`** (`src/plugins/builders/manual.js`, the example): "Build demo" makes the site brief
  from the current research and keeps it as `brief.json` and `brief.md` in the host's file store;
  the person downloads the Markdown, gives it to whoever builds the site, then records the link of
  the demo built elsewhere. Doors: `POST /:id/manual/brief`, `GET /:id/manual/brief.md`,
  `PUT /:id/manual/built` (`{ "url", "note"? }`), `DELETE /:id/manual/built`. It calls no other
  service. Outreach drafts are made only for demos that passed a quality check, so a demo recorded
  here does not get one yet. Test: `test/plugins-builders.test.mjs`.
- **`tracy`** (`src/plugins/builders/tracy.js`, **planned**): records how the adapter will call
  Tracy's public API; it makes no network call and refuses to start. It needs a door that creates a
  demo site from a brief, which Tracy's API does not have yet.

The brief both builders hand over is made by `makeSiteBrief` (`src/brief-research.js`) from the same
research read, so a brief does not depend on which builder made it.

**Skeleton** of an adapter for another service:

```js
// src/plugins/builders/example-builder.js
import { defineBuilder } from '../builders.js'

export default function createExampleBuilder({ pool, objects }) {
  return defineBuilder({
    id: 'example-builder',
    routes(app, ctx) { /* POST /api/website-opportunities/:id/example/build … */ },
    settingsOf: async () => ({}),
    saveSettings: async () => ({ status: 404, body: { code: 'NO_SETTINGS', next: 'Nothing to set.' } }),
    templateChoicesOf: async () => ({}),
    listedDemoOf: async () => new Map(),
    detailOf: async () => ({ demo: null }),
    demoFactsOf: async () => new Map(),
    demoJourneySql: null
  })
}
```

A builder that calls a remote service sends the brief as an immutable snapshot with an idempotency
key, so a retry after a timeout never builds or charges twice.
