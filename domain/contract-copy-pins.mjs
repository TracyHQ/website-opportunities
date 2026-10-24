// The sourced words (`pinnedCopy`) as the slot keys of one content contract: what a Joomla or WordPress build writes
// as it stands, so the model planner never writes those slots. Which slot holds which role is a hand-made map per
// template (`slot-roles/<cms>.json`), checked against a real release; a key the release being built lacks costs its
// whole group, never a half-written card.
import { readFileSync } from 'node:fs';
import { neutralDish, PLACEHOLDER, placeholderFor } from './section-fills.mjs';

const MAPS = {};

/**
 * @param {'joomla' | 'wordpress'} cms
 * @param {string} template the release's product (`tracy-base`), the first part of a contract id
 * @returns {{checked?: string, roles: Record<string, Array<Record<string, string>>>, sections?: Record<string, string>} | null}
 *   `sections`: what the hand-off asks of each section of the template's pages, by its name (`section-fills.mjs`)
 */
export function slotRolesFor(cms, template) {
  if (cms !== 'joomla' && cms !== 'wordpress') return null;
  MAPS[cms] ??= JSON.parse(readFileSync(new URL(`./slot-roles/${cms}.json`, import.meta.url), 'utf8'));
  const entry = MAPS[cms][template];
  return entry?.roles ? entry : null;
}

/**
 * Roles that are lists, and the sourced list each reads: the nth sourced value fills the nth group. A template with a menu on
 * more than one page names one role per page (`dishes:menu`), each filled from the same dishes.
 */
const listOf = (role) => (role === 'cards' ? 'cards' : role === 'dishes' || role.startsWith('dishes:') ? 'dishes' : null);
/**
 * Fields a group may lack a source for: the slot takes its placeholder (`section-fills.mjs`), the rest of the group is
 * written — a dish's description is left empty instead. A `badge` ("Hot", "Sale") is never collected: always empty.
 */
const OPTIONAL = new Set(['price', 'description', 'badge']);
/** A group's own notes, never a slot: `$item` names the block that holds the whole group (a dish item of the template). */
const isField = (field) => !field.startsWith('$');

/** The slot kind each field wants: a link's address is a url slot, every other field a line of text. */
const kindOf = (field) => (field === 'href' ? 'url' : 'text');

// Both doors take plain text and escape it themselves (a sent `&amp;` showed on the page); Joomla refuses `<`, `>`,
// control characters and `{directive}` braces outright, so they are taken out here instead of losing the line.
function plain(value, max) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the bytes the Claude Cowork plugin refuses
  // oxlint-disable-next-line no-control-regex
  let out = String(value ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')');
  out = out.replace(/\s+/g, ' ').trim();
  if (max > 0 && [...out].length > max) out = `${[...out].slice(0, max - 1).join('').replace(/\s+\S*$/, '').trimEnd()}…`;
  return out;
}

/** A link as both doors take it, or null: a phone keeps only its digits, anything but https/tel/mailto is refused. */
function link(value) {
  const href = String(value ?? '').trim();
  if (/^tel:/i.test(href)) {
    const digits = href.slice(4).replace(/[^+\d]/g, '');
    return /^\+?\d{4,}$/.test(digits) ? `tel:${digits}` : null;
  }
  if (/^https:\/\/[^\s<>"]+$/i.test(href) || /^mailto:[^\s<>"@]+@[^\s<>"]+$/i.test(href)) return href;
  return null;
}

/**
 * @param {object} input
 * @param {{roles: Record<string, Array<Record<string, string>>>}} input.map - `slotRolesFor`
 * @param {{slots: Array<{key: string, type: string, maxCharacters?: number}>}} input.contentMap - of the release being built
 * @param {Record<string, any>} input.pinned - `pinnedCopy`
 * @returns {{pins: Record<string, string>, sources: Record<string, string>, skipped: Array<{role: string, reason: string}>,
 *   placeholders: string[], dishes: Array<{name: string, description: string, price: string}>}}
 *   🔒 NOTHING IS HIDDEN (product owner, 22/10/2026): a dish item with no dish of the restaurant, a price nobody collected, a
 *   section of the template's own facts (`map.placeholders`) say the placeholder (`placeholders`: their keys, source
 *   `placeholder`), except a dish's name (a neutral name), its description and its badge: an empty pin, which no door writes — the
 *   build's sweep empties that line itself; `dishes`: the dishes as written, for the template's dish items no slot covers
 */
export function contractCopyPins({ map, contentMap, pinned }) {
  const slots = new Map();
  // A key the contract gives to two blocks is written into the first (the door's own rule): its budget is the first's.
  for (const s of contentMap?.slots ?? []) if (!slots.has(s.key)) slots.set(s.key, s);
  const pins = {};
  const sources = {};
  const skipped = [];
  const placeholders = [];
  /** A slot the research holds nothing for, written with its placeholder. */
  const stand = (key, value) => {
    pins[key] = value;
    sources[key] = 'placeholder';
    placeholders.push(key);
  };

  /** One group of slots from one sourced value: all of it, or none of it. */
  const place = (role, group, { value, source }) => {
    const fields = typeof value === 'string' ? { text: value } : (value ?? {});
    const out = {};
    const unsourced = [];
    for (const [field, key] of Object.entries(group).filter(([f]) => isField(f))) {
      const slot = slots.get(key);
      if (!slot) return `${key} is not in this release`;
      if (slot.type !== kindOf(field)) return `${key} is a ${slot.type} slot, not ${kindOf(field)}`;
      const shaped = field === 'href' ? link(fields[field]) : plain(fields[field], Number(slot.maxCharacters ?? 0));
      if (!shaped && OPTIONAL.has(field)) {
        const dish = listOf(role.replace(/\[\d+\]$/, '')) === 'dishes';
        unsourced.push([key, field === 'badge' || (field === 'description' && dish) ? '' : PLACEHOLDER]);
        continue;
      }
      if (!shaped) return field === 'href' ? `${key}: the site would refuse this link` : `${key}: no ${field} to write`;
      out[key] = shaped;
    }
    Object.assign(pins, out);
    for (const key of Object.keys(out)) sources[key] = source;
    // 🔒 A PRICE NOBODY COLLECTED SAYS "Coming soon" (product owner, 22/10/2026): never the demo's, never a guess.
    for (const [key, value] of unsourced) stand(key, value);
    return null;
  };
  /**
   * The `n`th dish item (from 0) of a list the research holds no dish for: kept under a neutral name, in turn, its body and
   * badge empty and its price the placeholder.
   */
  const standIn = (group, n) => {
    for (const [field, key] of Object.entries(group).filter(([f]) => isField(f))) {
      const slot = slots.get(key);
      if (!slot || slot.type !== 'text') continue;
      const value = field === 'name' ? neutralDish(n) : field === 'description' || field === 'badge' ? '' : PLACEHOLDER;
      stand(key, plain(value, Number(slot.maxCharacters ?? 0)));
    }
  };

  const written = new Set();
  for (const [role, groups] of Object.entries(map?.roles ?? {})) {
    if (listOf(role)) {
      const list = Array.isArray(pinned?.[listOf(role)]) ? pinned[listOf(role)] : [];
      /** The list's items with no dish so far: each list's neutral names start again from the first. */
      let spare = 0;
      groups.forEach((group, n) => {
        const reason = n < list.length ? place(`${role}[${n}]`, group, list[n]) : 'no sourced value';
        if (!reason) return written.add(role);
        if (n < list.length) skipped.push({ role: `${role}[${n}]`, reason });
        // 🔒 A DISH ITEM OF THE TEMPLATE WITH NO DISH OF THE RESTAURANT STAYS (product owner, 22/10/2026), when the map names
        // the block that holds it: a neutral name, an empty body and "Coming soon" as its price — the demo's dish and its
        // price never stay.
        if (group.$item) standIn(group, spare++);
      });
      continue;
    }
    const sourced = pinned?.[role];
    if (!sourced) continue;
    const reasons = groups.map((group) => place(role, group, sourced)).filter(Boolean);
    // A role whose every variant failed is skipped; a variant a template lacks is no loss when another was written.
    if (reasons.length === groups.length) skipped.push({ role, reason: reasons.join('; ') });
    else written.add(role);
  }
  // The template's sections of its own facts (a testimonial, a weekly special with its price, the demo's dishes no role
  // reaches): their bodies, prices and dish names take the placeholders unless the role that would make them true was
  // written. Headings, titles and pictures are left to the brief's words and the restaurant's pictures.
  /** The dish names these sections take, in turn. */
  let neutral = 0;
  for (const h of map?.placeholders ?? []) {
    if (h.unless && written.has(h.unless)) continue;
    for (const key of h.slots ?? []) {
      const slot = slots.get(key);
      if (!slot || slot.type !== 'text' || key in pins) continue;
      const value = placeholderFor(key, neutral);
      if (/dish-name/.test(key)) neutral += 1;
      if (value !== null) stand(key, plain(value, Number(slot.maxCharacters ?? 0)));
    }
  }
  const dishList = Array.isArray(pinned?.dishes) ? pinned.dishes : [];
  const dishes = dishList.map(({ value }) => ({
    name: plain(value?.name, 80),
    description: plain(value?.description, 200),
    price: plain(value?.price, 40) || PLACEHOLDER,
  })).filter((d) => d.name);
  return { pins, sources, skipped, placeholders, dishes, facts: factBlocks(map?.facts ?? [], pinned?.contact ?? {}) };
}

/** A sourced fact as a line links it: the address to a map search, a phone to a call, a mailbox to a mail. */
function factHref(kind, fact) {
  if (kind === 'maps') return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fact)}`;
  if (kind === 'tel') return link(`tel:${fact}`);
  if (kind === 'mailto') return link(`mailto:${fact}`);
  return null;
}

/**
 * 🔒 A DEMO FACT OUTSIDE THE CONTRACT'S SLOTS — the footer's phone, mailbox and hours, the hero's address link — SAYS THE
 * RESTAURANT'S, OR IS HIDDEN (manager, 22/10/2026). Each block the map names (`facts`) is written from the facts collected
 * (Google, the profiles), one line per fact; a block with none of its facts collected is hidden, never left with the demo's.
 * @param {Array<{page?: string, part?: string, block: string, nth?: number, lines: Array<{fact: string, label?: string,
 *   text?: string, link?: 'maps' | 'tel' | 'mailto'}>}>} specs
 * @param {Record<string, {value: string, source: string}>} contact - `contactOf`
 * @returns {Array<{page?: string, part?: string, block: string, nth: number, lines: Array<{label?: string, text: string,
 *   href?: string, source: string}> | null}>} `lines: null` hides the block
 */
function factBlocks(specs, contact) {
  return specs.map((spec) => {
    const lines = [];
    for (const line of spec.lines ?? []) {
      const fact = contact[line.fact];
      const value = plain(fact?.value, 0);
      if (!value) continue;
      // Opening hours are collected as one line per run of days: each is a line of its own.
      const values = line.fact === 'hours' && !line.text ? value.split(/\s*;\s*/).filter(Boolean) : [value];
      for (const v of values) {
        const href = line.link ? factHref(line.link, v) : null;
        if (line.link && !href) continue;
        lines.push({
          ...(line.label ? { label: line.label } : {}),
          text: line.text ?? v,
          ...(href ? { href } : {}),
          source: fact.source,
        });
      }
    }
    const where = spec.part ? { part: spec.part } : { page: spec.page };
    return { ...where, block: spec.block, nth: spec.nth ?? 1, lines: lines.length ? lines : null };
  });
}
