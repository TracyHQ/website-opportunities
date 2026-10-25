export { CMS, DEFAULT_CMS, parseCms, resolveCms } from './cms.mjs'
export { assertPublicUrl, isBlockedAddress, UrlBlockedError } from './url-guard.mjs'
export { fetchLimited, FetchLimitedError, USER_AGENT } from './fetch-limited.mjs'
export {
  geocode,
  searchRestaurants,
  candidateFromOsm,
  normaliseSocial,
  socialNetworkOf
} from './discovery-osm.mjs'
export { crawlWebsite, extractPage } from './website-crawler.mjs'
export { readMenus, menuItemsFromHtml, menuItemsFromPdfPages } from './menu-reader.mjs'
export { renderAgentPrompt, HANDOFF_FOLDER } from './agent-prompt.mjs'
export { answersFromBrief, contactFacts } from './site-answers.mjs'
export { pageRole } from './page-plan.mjs'
export { pinnedCopy } from './pinned-copy.mjs'
export { contractCopyPins, slotRolesFor } from './contract-copy-pins.mjs'
export {
  NEUTRAL_DISHES,
  neutralDish,
  PLACEHOLDER,
  SECTION_ACTIONS,
  sectionAction,
  placeholderFor
} from './section-fills.mjs'
export { approxLocationOf, isLocatableAddress, GEOIP_PROVIDERS } from './geoip.mjs'
export {
  discoverRestaurants,
  searchRestaurantsGmaps,
  candidateFromGmaps,
  GMAPS_ACTOR
} from './discovery-gmaps.mjs'
export { TRADES, tradeOfPlace, tradeOfSchemaType } from './trades.mjs'
export {
  SEARCH_TRADES,
  TRADE_SEARCH,
  ANY_GOOGLE_TYPES,
  searchTradeOf,
  tradeOfOsmTags
} from './trade-search.mjs'
export {
  searchRestaurantsGplaces,
  searchPlacesText,
  searchAreaGplaces,
  searchNamedPlaces,
  suggestPlaces,
  SUGGEST_PRIMARY_TYPES,
  GPLACES_AUTOCOMPLETE_URL,
  candidateFromGplaces,
  textCandidateFromGplaces,
  GPLACES_FIELDS,
  GPLACES_TEXT_FIELDS,
  GPLACES_URL,
  GPLACES_TEXT_URL
} from './discovery-gplaces.mjs'
export {
  KINDS,
  CUISINES,
  SEARCH_PRIMARY_TYPES,
  kindOfPrimaryType,
  cuisineOfPrimaryType,
  primaryTypesOfKinds,
  primaryTypeOfCuisine
} from './place-kinds.mjs'
export { markChains, CHAIN_BRANDS } from './chains.mjs'
export { scoreOpportunity } from './opportunity-score.mjs'
export { withSiteSocials } from './site-socials.mjs'
export {
  buildDemoRequest,
  DEMO_REQUEST_LIMITS,
  DEMO_REQUEST_SCHEMA,
  validateDemoRequest
} from './demo-request.mjs'
export { siteLabelFor, nextSiteLabel } from './site-label.mjs'
export { detectStack, STACK_PACK_NAMES } from './site-stack.mjs'
export {
  GPLACES_DETAIL_FIELDS,
  PLACE_LOCATION_FIELDS,
  PLACE_VERIFICATION_FIELDS,
  fetchPlaceDetails,
  fetchPlaceLocation,
  fetchPlaceVerification,
  fetchPlaceWebsite,
  placeFactsFromDetails,
  placePhotoUrl,
  placePhotoUri,
  fetchPlacePhoto
} from './gplaces-details.mjs'
export {
  crawlWebsiteWithFallback,
  crawlWithBrowser,
  needsBrowser,
  renderedPagesResult,
  BROWSER_ACTOR,
  THIN_TEXT_CHARS
} from './website-browser.mjs'
export { readWithJina, readWithFirecrawl } from './website-readers.mjs'
export { connectorsFor, SOURCES } from './connectors.mjs'
export {
  apifyCollect,
  apifyRunUrl,
  apifyStartUrl,
  APIFY_ACTORS,
  DEFAULT_MAX_CHARGE_USD,
  RECENT_DAYS,
  redactToken
} from './apify.mjs'
export { FACEBOOK_APIFY, facebookApifyInput, facebookApifyStats } from './social-stats/facebook-apify.mjs'
export { collectYoutubePublic, channelVideosUrl } from './youtube-public.mjs'
export { upgradeFacebookPhotos, facebookPictureSize, facebookPhotoPageUrl } from './facebook-photos.mjs'
export { sniffMime, sha256Hex, classifyMedia } from './media.mjs'
export { dedupeCandidates, normaliseName, distanceM } from './dedupe.mjs'
export { brandFromSocial } from './brand-social.mjs'
export {
  buildBrief,
  briefForBuild,
  validateBrief,
  renderBriefMarkdown,
  BRIEF_SCHEMA_VERSION,
  BRIEF_REQUIRED
} from './brief.mjs'
export { slotMap, SLOT_MAP_VERSION } from './pictures/slot-map.mjs'
export {
  labelPicture,
  nearCopies,
  hammingDistance,
  looksGraphic,
  LABELS_VERSION
} from './pictures/picture-labels.mjs'
export {
  planPlacement,
  drawPlan,
  outputSize,
  cropBox,
  ROLES,
  PLANNER_VERSION,
  MAX_SCALE,
  DRAW_MAX
} from './pictures/placement.mjs'
export { collectSocialProfile, PROFILE_TIERS } from './social-profile.mjs'
export {
  fetchSocialStats,
  statsTiersOf,
  SOCIAL_CHAINS,
  SOCIAL_PROVIDERS,
  ADVANCE_CODES as SOCIAL_STATS_ADVANCE_CODES
} from './social-stats/chain.mjs'
export {
  SocialStatsError,
  SOCIAL_STATS_ERROR_CODES,
  RAPIDAPI_HOSTS,
  postsCadence
} from './social-stats/providers.mjs'
export { parseSocialUrl } from './social-stats/handles.mjs'
export {
  CAPABILITY_GROUPS,
  CAPABILITY_GROUP_IDS,
  PROVIDER_CREDENTIALS,
  ATTEMPT_STATUSES,
  FALLBACK_REASONS,
  capabilityGroup,
  defaultOrderOf,
  resolveOrder,
  parseProviderOrder,
  providerAnswer,
  runInOrder
} from './capabilities.mjs'
export {
  findSocialPages,
  matchSocialPage,
  searchPlaceOf,
  scrapeCreatorsGoogleSearch,
  SEARCH_NETWORKS
} from './social-search.mjs'
export { jinaSearch, firecrawlSearch, serpapiGoogleSearch } from './web-search.mjs'
export { findMenuLinks, menuLinksFromResults, menuSearchQuery } from './menu-search.mjs'

// Hosts check these before running a job; bump `version` on any breaking change to the API above.
export const CONTRACT = Object.freeze({
  name: 'tracy-website-opportunities',
  version: 1,
  capabilities: Object.freeze([
    'cms.resolve',
    'url.guard',
    'fetch.limited',
    'discovery.osm',
    'discovery.google-maps',
    'discovery.google-places',
    'discovery.google-places.text',
    'discovery.google-places.autocomplete',
    'collect.google-places.details',
    'collect.google-places.photos',
    'location.approx-ip',
    'dedupe.candidates',
    'collect.website',
    'collect.menu-items',
    'collect.website.browser-fallback',
    'collect.facebook',
    'collect.instagram',
    'collect.tiktok',
    'collect.youtube',
    'media.sniff',
    'media.classify',
    'brand.social',
    'brief.v1',
    'brief.markdown',
    'handoff.prompt',
    'site.answers',
    'pictures.plan.v1',
    'pictures.draw.v1',
    'score.opportunity.v1',
    'site.stack',
    'site.label',
    'social-stats',
    'provider-order'
  ])
})
