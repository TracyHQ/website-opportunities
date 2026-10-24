// Social pages a site check read off the restaurant's own website, lifted into the place's `socials`
// (council P0-1): the map may only know the website, the homepage links Facebook/Instagram.
import { parseSocialUrl } from './social-stats/handles.mjs'

const NETWORKS = ['facebook', 'instagram', 'tiktok', 'youtube']
const isUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v)
/** A link the site check found is lifted only when it is a profile of that network (not `/messages`, a post…). */
const isProfile = (v, network) => isUrl(v) && parseSocialUrl(v, { network }) !== null

/**
 * Pure: `socials` plus every profile in `siteCheck.socials` for a known network the place does not
 * already have. Returns `socials` itself (or `{}` for none) when nothing is added.
 */
export function withSiteSocials(socials, siteCheck) {
  const base = socials && typeof socials === 'object' ? socials : {}
  const found = siteCheck?.socials && typeof siteCheck.socials === 'object' ? siteCheck.socials : {}
  let out = base
  for (const n of NETWORKS) {
    if (isUrl(base[n]) || !isProfile(found[n], n)) continue
    if (out === base) out = { ...base }
    out[n] = found[n]
  }
  return out
}
