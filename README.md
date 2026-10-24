# Website Opportunities

> **Status: pre-release.** This repository is being prepared for its first public release. The code is
> being moved out of a larger application into a standalone library and server. Anything marked
> **(planned)** below is not available yet. Please do not rely on it until it is released.

Website Opportunities finds local businesses that have **no website**, or a website that **needs
replacing**, researches them from public sources, helps you **reach out** to them, and hands a
**brief** to whatever you use to build the site.

It is for people who sell websites to small businesses: freelancers, agencies, and web sellers.

## What it does

1. **Find.** Search an area or a business name and get a list of places, with their website and
   social links when they have any.
2. **Assess.** Check each place's current web presence (is the site up, is it slow, is it served
   over HTTPS, is it mobile friendly, how old is it, how active are its social pages) and turn that
   into a score that says how much the place needs a new website.
3. **Reach.** Draft an outreach message in the business's language, and list the contact channels
   found for it (phone, email, chat links).
4. **Build (your choice).** Hand a structured brief of the business to a *builder*. The default
   builder is `manual`: it exports the brief to a file so you can build the site with any tool you
   like.

## Quickstart

The standalone server runs from this folder: Postgres, the app and local disk storage, one operator.

```sh
git clone https://github.com/TracyHQ/website-opportunities.git
cd website-opportunities
cp .env.example .env
printf 'OPERATOR_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env
# optional: put your keys in .env, e.g. GOOGLE_PLACES_API_KEY (OpenStreetMap needs no key)
docker compose up -d --build
```

Then open <http://localhost:8080> and paste the operator token from `.env` (`grep OPERATOR_TOKEN .env`). Port 8080
taken? Set `HOST_PORT` in `.env`. The same token calls the JSON API. Settings and the API in short:
[`src/standalone/README.md`](src/standalone/README.md).

### Bring your own keys

Website Opportunities does not ship with any API keys. You use your own, and you pay the provider
directly. Every provider below is optional except a way to find places; OpenStreetMap works with no
key at all.

| What for | Providers the code calls today |
|---|---|
| Finding places in an area or by name | Google Places API (New), Apify (Google Maps), OpenStreetMap (Nominatim + Overpass, no key) |
| Google reviews and menu photos | Google Places API, SerpApi (Google Maps) |
| Tripadvisor reviews | SerpApi, RapidAPI (TripAdvisor), Litescrape |
| Facebook, Instagram, TikTok pages | ScrapeCreators, RapidAPI, Apify |
| YouTube channels | YouTube Data API (Google key), RapidAPI, Apify, or the public channel page (no key) |
| Reading a website | Direct crawl (no key), Apify browser, Jina Reader, Firecrawl |
| Web search (finding a place's pages when it has no website) | ScrapeCreators (Google search), SerpApi, Jina, Firecrawl |
| Site speed and mobile checks | Google PageSpeed Insights |

For each research step you choose which providers answer and in which order, or turn the step off.
A measurement that could not be taken is shown as unknown, never guessed.

## Architecture

The project has three open layers and one interface to the outside:

```
  find  ──▶  assess  ──▶  reach  ──▶  builder (interface)
  sources     site checks     outreach        ├─ manual   (default)
  place store scoring         templates       ├─ tracy    (one adapter among others)
                                               └─ yours
```

- **find**: data sources turn an area or a name into businesses. Each business is stored once in a
  *place store*, with every value tagged by its source and the time it was fetched.
- **assess**: website checks (reachability, PageSpeed, HTTPS, mobile, copyright year), social
  activity, and an opportunity score from 0 to 100 with a grade (A, B, C) and the reasons behind it.
- **reach**: outreach drafts per channel and language, and a contact preview. Nothing is sent
  automatically: the app drafts, you send.
- **pipeline**: your own list of opportunities, research jobs and a cost ledger that records what
  each paid provider call cost you.
- **builder** (planned): a small contract for long-running work. A builder receives an immutable
  brief and an idempotency key, exposes `submit`, `status` and `cancel`, and returns a receipt. A
  timeout must never create a second build or a second charge.
  - `manual` (default): writes the brief to a file you download and lets you mark the business as
    "built elsewhere", with the link.
  - `tracy` (planned): sends the brief to [Tracy](https://tracy.ai), which builds and hosts a demo
    site. It is one adapter among others, not a requirement.
  - Anyone can write an adapter for another site builder or for their own agency workflow. See
    [CONTRIBUTING.md](CONTRIBUTING.md).

The project is a **library plus a small server**: the same router, worker and database schema run
inside a larger host application or on their own. The host supplies a small adapter (database pool,
caller identity, rate limits, object storage, cost recording). Importing the router does not start
background jobs or run migrations by itself; the worker has explicit `start`, `stop` and `drain`
and can run as its own process. The standalone server (`src/standalone/`) is one such host: one operator,
Postgres and files on disk.

### Layout

- `domain/`: plain ESM with no npm dependency and every network call injected: discovery, crawling,
  connectors, media sniffing, brand observation, brief. Import it as `website-opportunities/domain`.
- `src/`: the server layer: the Hono router (`src/route.js`), the research executor, the place store,
  the `wo_*` schema and its migrator (`src/schema/`), and the `host` contract (`src/host.js`) a host
  application implements. Import modules as `website-opportunities/src/<file>.js`.
- `test/`: the domain's tests and fixtures. Nothing under `src/` or `domain/` imports outside this
  package (`test/package-boundary.test.mjs`).

## The shared research hub

Researching a business costs money (API calls) and time. A hub lets several servers share that work: one server
pays for a place once, the hub checks what it was sent against the source itself, and every other server reads the
checked copy instead of paying again. **The hub is off by default**: with no `HUB_*` setting the server neither
serves one nor reads one, and every research call uses your own keys.

### Use a hub

Set both of these (a hub operator gives you the token; one token per account, and its quotas belong to the account):

| Variable | Default | Meaning |
|---|---|---|
| `HUB_URL` | none | The hub's address, e.g. `https://hub.example.com` |
| `HUB_TOKEN` | none | Your hub token (`woh_...`) |
| `HUB_CONTRIBUTE` | `0` | `1`: offer what your own research read from Google back to the hub |

With a hub set, before the server pays for a place's Google details it looks the place up on the hub
(`POST /hub/v1/places/lookup`, then `GET /hub/v1/places/:id` with an ETag). A copy observed in the last 30 days is
used as research input and recorded on the place's source with provenance `hub`; anything else (no copy, an old
one, a fact the hub marked conflicted, quota spent, hub unreachable) falls back to your own paid research. Every
minute the server follows the hub's `/revocations` and `/changes` feeds from cursors it stores. A revoked or removed
place leaves the local cache, its website link is dropped, the source is due for research again, and briefs made
afterwards leave its facts out. Feeds cost no read quota, so revocations arrive even when your quota is spent. When
a cursor is too old for the hub (`410 cursor_expired`), every cached place is checked again before reading on.

### What is shared and what never leaves your server

- **Sent, only with `HUB_CONTRIBUTE=1`:** after a research run, the facts Google's own record gave for that place, in
  the closed field list of `wo-contribution/v1`: its identity, name, website, phone and address, each naming Google
  as the source. Facts that came from the hub are never sent back.
- **Never sent:** your opportunities and pipeline (who you contacted, replies, notes, deal status), briefs, demos,
  outreach drafts, your keys, and anything a crawler read from a website. The hub refuses such fields anyway.
- **Read from a hub:** place snapshots and the two feeds. Nothing you read is published anywhere by your server.

### Run a hub

`HUB_SERVE=1` mounts the hub on the same server under `/hub/v1` and starts two background jobs: one verifies pending
contributions by reading the named source itself (Google Place Details with your `GOOGLE_PLACES_API_KEY`, one read per
source object, under a daily budget), the other links verified businesses to a place and publishes a snapshot for
every place whose evidence changed. A contribution alone never creates a place. Operator commands:

```sh
DATABASE_URL=... node src/hub/cli.js token issue --principal <principal id>     # prints the token once
DATABASE_URL=... node src/hub/cli.js account block --account <hub account id>   # its token stops working
DATABASE_URL=... node src/hub/cli.js contribution withdraw --id <contribution id>
DATABASE_URL=... node src/hub/cli.js place revoke --place <place id> --reason "wrong data"
DATABASE_URL=... node src/hub/cli.js place suppress --place <place id> --reason "owner asked"   # never comes back
DATABASE_URL=... node src/hub/cli.js media revoke --media <media id> --reason "not theirs"
```

The hub does not research places on request for someone else: a lookup that finds nothing answers `not_found`.

## Data and privacy

- **You are responsible for your keys.** Each provider has its own terms of service. When you use your
  own API key, you are responsible for following that provider's terms, including what you may store
  and for how long. The hub run by Tracy is responsible only for the data Tracy itself holds.
- **Public business information only.** The tool collects information that businesses publish about
  themselves (listings, websites, social pages). Your outreach pipeline is private to you.
- **Removal requests.** A hub operator removes a business at its request (`place suppress`); every identity it
  was known by is recorded so the same data is not accepted again, and readers drop their copies through the
  revocation feed.
- **Research data is untrusted.** Text collected from the web can contain instructions aimed at an AI
  model. The code treats it as data all the way to the brief; see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are small plugin files: data sources, scoring rules, outreach templates for a
language, and builder adapters. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/plugins.md](docs/plugins.md).

## License

[Apache License 2.0](LICENSE). See also [NOTICE](NOTICE).
