/**
 * The research a site brief reads: a place's shared snapshot with the account's overlay, or the per-account rows of
 * an opportunity not researched as a place yet. Shared by every builder, so a brief reads the same whoever builds it.
 */
import { revokedHubCopy } from './hub/local-cache.js'
import { mediaJunk } from './media-junk.js'
import { addReviewSources } from './review-sources.js'
import { placeViewOf } from './place-view.js'

export const opportunityOf = (opp) => ({
  id: opp.id,
  name: opp.name,
  branch: opp.branch,
  provider: opp.provider,
  providerId: opp.provider_id,
  candidate: structuredClone(opp.candidate ?? {})
})

/** Sources never collected (`pending`) are not evidence of anything yet. */
export const EVIDENCE = new Set(['complete', 'partial', 'blocked', 'failed'])
/** Sources whose `collected` holds what was read (posts included). */
export const COLLECTED = new Set(['complete', 'partial'])

const mediaOfBrief = (m) => ({
  id: m.id,
  ...(m.origin ? { origin: m.origin } : {}),
  kind: m.kind,
  category: m.category,
  sha256: m.sha256,
  mime: m.mime,
  width: m.width,
  height: m.height,
  source: m.source,
  sourceUrl: m.source_url,
  ...(['tripadvisor', 'google-maps'].includes(m.source)
    ? { postId: m.post_id, credit: m.credit ?? null }
    : {}),
  labels: m.labels ?? null,
  caption: m.caption ?? null,
  alt: m.alt ?? null,
  bytes: m.bytes ?? null,
  postedAt: m.posted_at ? new Date(m.posted_at).toISOString() : null
})

/**
 * The brand a brief carries: the website's observation, else the social one, with the logo the place's research chose and
 * the other candidates (`place-logo.js`). A place whose logo was looked for and not found carries that state, so the brief
 * says "none found" instead of saying nothing.
 */
export function briefBrand(brand) {
  const base = brand?.website ?? brand?.social ?? null
  const research = brand?.logoResearch
  if (!research) return base
  return {
    ...(base ?? { origin: 'social', official: false, colors: [], fonts: [], evidence: [] }),
    ...(research.chosen ? { logo: research.chosen.mediaId } : {}),
    logoResearch: {
      status: research.status,
      chosen: research.chosen ?? null,
      candidates: (research.candidates ?? []).slice(0, 6).map((c) => ({
        mediaId: c.mediaId,
        via: c.via,
        source: c.source,
        width: c.width ?? null,
        height: c.height ?? null,
        reading: c.reading ? { isLogo: c.reading.isLogo, kind: c.reading.kind } : null
      }))
    }
  }
}

/** The ids of the chosen logo and the candidates the model also called a logo: kept in a brief whatever their size. */
const logoIds = (brand) =>
  new Set(
    [
      brand?.logoResearch?.chosen?.mediaId,
      ...(brand?.logoResearch?.candidates ?? [])
        .filter((c) => c?.reading?.isLogo === true)
        .map((c) => c.mediaId)
    ].filter(Boolean)
  )

/** What a brief reads of a place's snapshot with the account's overlay. */
export function fromPlace(view) {
  return {
    // `updated_at` is when a source was last tried, not what it said: a Retry that changes nothing keeps the key.
    rawSources: structuredClone(view.sources.map(({ updated_at: _tried, ...source }) => source)),
    profile: view.profile,
    brand: view.brand,
    sources: view.sources
      .filter((s) => EVIDENCE.has(s.status))
      .map((s) => ({
        source: s.source,
        ref: s.ref,
        status: s.status,
        reason: s.reason,
        coverage: s.coverage ?? { fetched: 0 }
      })),
    // The restaurant's photographs and its logos: the icons, maps and spacers of its website's markup stay out (`media-junk.js`).
    media: view.media
      .filter((m) => m.status === 'stored' && (!mediaJunk(m) || logoIds(view.brand).has(m.id)))
      .map(mediaOfBrief),
    posts: view.sources
      .filter((s) => COLLECTED.has(s.status))
      .flatMap((s) => (s.collected?.posts ?? []).map((post) => ({ source: s.source, ...post })))
  }
}

/** What a brief reads of the per-account rows (no place, or a place not researched yet). */
export async function fromOpportunity(client, opp) {
  const rawSources = (
    await client.query(
      `select source, ref, status, reason, coverage, collected from wo_source where opportunity_id = $1 and status = any($2)`,
      [opp.id, [...EVIDENCE]]
    )
  ).rows.map((s) => ({ ...s, coverage: s.coverage ?? { fetched: 0 } }))
  const sources = rawSources.map(({ collected: _collected, ...source }) => source)
  const media = (
    await client.query(
      `select id, kind, category, sha256, mime, width, height, source, source_url, posted_at, status, labels, caption, alt, bytes
       from wo_media where opportunity_id = $1 and status = 'stored' order by collected_at, id`,
      [opp.id]
    )
  ).rows.map(mediaOfBrief)
  const profileRow = (
    await client.query('select profile, brand from wo_profile where opportunity_id = $1', [opp.id])
  ).rows[0]
  // The restaurant's own posts, each source's as collected: the brief makes its content from them.
  const posts = (
    await client.query(
      `select s.source, p.post from wo_source s, jsonb_array_elements(coalesce(s.collected->'posts', '[]'::jsonb)) p(post)
       where s.opportunity_id = $1 and s.status = any($2)`,
      [opp.id, [...COLLECTED]]
    )
  ).rows.map((r) => ({ source: r.source, ...r.post }))
  return {
    profile: profileRow?.profile ?? {},
    brand: profileRow?.brand ?? null,
    sources,
    media,
    posts,
    rawSources
  }
}

/**
 * Facts the place's current snapshot took from a shared hub that has since revoked them (`hub/local-cache.js`):
 * `[{hubPlaceId, source, revokedAt}]`. Empty where no hub was ever read (the table is absent on such a host).
 */
async function revokedHubUses(db, placeId) {
  const { rows } = await db.query(`select to_regclass('wo_hub_client_use') is not null as present`)
  if (!rows[0].present) return []
  return (
    await db.query(
      `select u.hub_place_id, u.source, u.revoked_at from wo_place p
         join wo_hub_client_use u on u.snapshot_id = p.current_snapshot_id
        where p.id = $1 and u.revoked_at is not null order by u.hub_place_id`,
      [placeId]
    )
  ).rows.map((r) => ({ hubPlaceId: r.hub_place_id, source: r.source, revokedAt: r.revoked_at.toISOString() }))
}

/** A read without what a revoked hub copy gave it: its source rows, and the Google facts they became. */
function withoutRevoked(read, revoked) {
  const gone = new Set(revoked.map((r) => r.source))
  const keep = (s) => !gone.has(s.source)
  const profile = { ...read.profile }
  if (gone.has('google-places')) delete profile.googlePlace
  return {
    ...read,
    profile,
    rawSources: read.rawSources.filter(keep),
    sources: read.sources.filter(keep),
    posts: read.posts.filter(keep),
    hubRevoked: revoked
  }
}

/** What a brief of this opportunity reads now: `{read, view}`, `view` null without a place. */
export async function briefResearchOf(db, opp) {
  const view = opp.place_id ? await placeViewOf(db, opp) : null
  if (!view) {
    const read = await fromOpportunity(db, opp)
    const revoked = await revokedHubCopy(db, read.profile?.googlePlace)
    return { read: revoked ? withoutRevoked(read, [{ ...revoked, source: 'google-places' }]) : read, view }
  }
  const revoked = await revokedHubUses(db, opp.place_id)
  return { read: revoked.length ? withoutRevoked(fromPlace(view), revoked) : fromPlace(view), view }
}

/** The site brief of one research read (`fromPlace`/`fromOpportunity`), with its review sources; not yet validated. */
export function makeSiteBrief(domain, read, { opportunity, madeAt }) {
  return addReviewSources(
    domain.buildBrief({
      opportunity,
      profile: read.profile,
      googlePlace: read.profile?.googlePlace ?? null,
      currentSite: read.profile?.pageSpeed ?? null,
      sources: read.sources,
      // `origin` is the manifest's (which table a picture is in), not the brief's.
      media: read.media.map(({ origin: _origin, ...m }) => m),
      posts: read.posts,
      // One observation: the website's when there is one, else the social profiles'.
      brand: briefBrand(read.brand),
      madeAt
    }),
    read.profile
  )
}
