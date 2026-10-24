// What a demo puts where the research holds nothing true, and what the hand-off asks of each section of a template's page.
//
// 🔒 A DEMO REPLACES, NEVER REMOVES (product owner, 22/10/2026). Hiding what had no source emptied the template: the menu
// tabs, the dish items, the testimonials and the specials went, and the page looked broken. Every section and every item
// of the template stays; a field with no sourced value says one of the fixed placeholders below, never an invented fact.

/**
 * The only words a demo writes without a source, in every field alike — a heading, a line, a price (product owner,
 * 22/10/2026: one placeholder, no variant). Kept here alone, so the site's other words can translate it.
 */
export const PLACEHOLDER = 'Coming soon';

/**
 * 🔒 A DISH ITEM WITH NO DISH OF THE RESTAURANT (product owner, 22/10/2026): a food picture of the restaurant under one of
 * these names, in turn, its picture's alt text the same name, its description and badge empty and its price
 * `PLACEHOLDER` — a card saying "Coming soon" three times read as broken. A badge ("Hot", "Sale") is never collected: empty
 * on every dish item, it is no missing fact. The names claim nothing about the restaurant; they are not a placeholder.
 */
export const NEUTRAL_DISHES = Object.freeze(["Chef's selection", 'Seasonal special', 'House favourite']);

/** The neutral name of the `n`th dish item (from 0) with no dish of the restaurant. */
export const neutralDish = (n) => NEUTRAL_DISHES[((n % NEUTRAL_DISHES.length) + NEUTRAL_DISHES.length) % NEUTRAL_DISHES.length];

/**
 * The placeholder a template slot takes when the research holds nothing for it, read from its key's field
 * (`homepage.menu.dish-price.3`): a price, a body or an item's own title (`title.3`) says `PLACEHOLDER`; a dish's name is
 * the `n`th neutral name, and a dish's description and badge are empty. A section's heading, a picture or a link answers null:
 * the brief's words or the restaurant's pictures go there instead.
 * @param {string} key
 * @param {number} [n] - which dish item with no dish of the restaurant this is, from 0 (`neutralDish`)
 * @returns {string | null}
 */
export function placeholderFor(key, n = 0) {
  const field = String(key).split('.').slice(2).join('.') || String(key);
  if (/dish-name/.test(field)) return neutralDish(n);
  if (/dish-desc|extra-class|badge/.test(field)) return '';
  if (/price/.test(field)) return PLACEHOLDER;
  // An item's own title (a weekly special, a testimonial's name) is a fact of the demo; a section's heading is not.
  if (/(title|heading|name)\.\d+$/.test(field)) return PLACEHOLDER;
  if (/title|heading|image|img|bg|url|href|link|icon/.test(field)) return null;
  if (/description|desc|text|intro|quote|review|testimonial|body/.test(field)) return PLACEHOLDER;
  return null;
}

/**
 * What the hand-off asks of a section, by the action a template's map gives it (`slot-roles/<cms>.json` `sections`). No
 * action takes a section off.
 */
export const SECTION_ACTIONS = Object.freeze({
  fill: "the brief's words and the restaurant's own pictures in its blocks",
  dishes: `the brief's dishes first, then every other dish item kept with a food picture of the restaurant, a neutral name (${NEUTRAL_DISHES.join(', ')}) as its name and its picture's alt text, an empty description and badge, and "${PLACEHOLDER}" as its price; a collected price as it is, never the demo's`,
  posts: `the restaurant's posts the build wrote; with none, keep the heading and say "${PLACEHOLDER}" in its body — never a demo post`,
  pictures: "the restaurant's own pictures in every picture of it",
  reviews: `real collected Google reviews per the reviews rule; with none, "${PLACEHOLDER}" and a link to the place on Google Maps when the brief has it`,
  booking: 'the third-party widget becomes a "Book a table" button to this site\'s Contact page',
  invite: "the newsletter form becomes an invitation to book or get in touch, with a button to this site's Contact page",
  facts: `real numbers only (Google rating, review count, year opened when the brief holds them); a number with no source becomes another true fact of the brief or "${PLACEHOLDER}"`,
  team: `the restaurant's own kitchen or interior pictures (never the demo's people), the heading kept, names and roles "${PLACEHOLDER}"`,
  offers: `real offers of the brief; with none, the restaurant's pictures and the text "${PLACEHOLDER}"`,
  keep: `keep it; replace the demo's words with the brief's or "${PLACEHOLDER}", the demo's pictures with the restaurant's`,
});

/**
 * The action of one section of a template's page, by its name (`<page>/<section>` first, for a section one page uses its
 * own way): a section the map does not list is kept and replaced.
 */
export function sectionAction(sections, name, page = null) {
  const action = (page && sections?.[`${page}/${name}`]) || sections?.[name];
  return action && SECTION_ACTIONS[action] ? action : 'keep';
}
