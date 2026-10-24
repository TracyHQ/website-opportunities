// Types of site-socials.mjs for the TypeScript client, which imports it by relative path.
export function withSiteSocials<T extends Record<string, string | null | undefined>>(
  socials: T | null | undefined,
  siteCheck: { socials?: Record<string, unknown> | null } | null | undefined
): T
