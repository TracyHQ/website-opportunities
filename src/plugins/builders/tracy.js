/**
 * PLANNED, NOT IMPLEMENTED. The Tracy builder for a server that is not Tracy: "Build demo with Tracy" sends the
 * brief to Tracy, which builds and hosts the demo site. This file only records how it will call Tracy; it makes no
 * network call, and `createTracyBuilder` refuses to start, so no deployment can turn it on by mistake.
 * (Tracy's own server does not use this file: it mounts its in-process builder, which shares this router's database.)
 *
 * What exists in Tracy's public API (https://tracy.ai/docs, base `/v1`, `Authorization: Bearer <API key>`):
 *   - `POST /v1/sites/{key}/contract/apply`  writes content into a site's named slots (`hero.0`, `footer.contact`);
 *     `Tracy-Apply-Id` names the receipt, `Idempotency-Key` makes a retry after a lost reply answer the stored
 *     result instead of writing twice.
 *   - `GET /v1/sites/{key}/applies/{id}` and `POST …/applies/{id}/revert`  read and undo one receipt.
 *   - `GET /v1/sites/{key}` and `…/design`  the site and its design system.
 *
 * What is missing, and blocks this adapter: a door that creates a demo site from a brief. Until Tracy publishes one,
 * this adapter cannot submit. The plan once it exists:
 *   1. submit  create the demo site from the immutable brief (`makeSiteBrief`), idempotency key = opportunity id +
 *              the brief's research hash, so a timeout never builds or charges twice → a receipt {siteKey, applyId}
 *   2. fill    `POST /v1/sites/{siteKey}/contract/apply` with the brief's copy, under that apply id
 *   3. status  `GET /v1/sites/{siteKey}` until the site answers; its address is the demo link
 *   4. cancel  `POST /v1/sites/{siteKey}/applies/{applyId}/revert`, then the site's own removal door
 * Receipts would be kept in the host's object store, as the manual builder keeps its record, and answer
 * `listedDemoOf`, `detailOf` and `demoFactsOf`.
 */
export const TRACY_BUILDER_STATUS = 'planned'

export default function createTracyBuilder() {
  throw Object.assign(new Error('The Tracy builder is planned and not available yet; use the manual builder.'), {
    code: 'BUILDER_PLANNED'
  })
}
