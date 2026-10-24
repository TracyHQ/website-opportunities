import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentPool } from '../domain/content-pool.mjs';

// Real captions collected on the WO stand (19/10/2026), newest first, up to 40 per source.
const POSTS = JSON.parse(readFileSync(new URL('./fixtures/content-pool-posts.json', import.meta.url), 'utf8'));
const NOW = '2026-10-19T00:00:00.000Z';
const FACTS = {
  'hill-station': { phone: '+84 235 629 2999', address: '321 Nguyen Duy Hieu, Hoi An, Quang Nam' },
  passion: { phone: '+84 905 123 456', address: '159 Nguyễn Phan Vinh, Hội An' },
};
const poolOf = (place) => contentPool({ posts: POSTS[place], now: NOW, facts: FACTS[place] });

test('the footer a page repeats under its posts is cut from every body, and its links are kept as evidence', () => {
  const { items, links } = poolOf('hill-station');
  assert.ok(items.length >= 10);
  for (const it of items) {
    assert.doesNotMatch(it.body, /Reserve your table|Our Menu:|321 Nguyen Duy Hieu|\+84 235/);
  }
  assert.ok(links.some((l) => l.url === 'https://www.thehillstation.com/menu' && l.kind === 'menu'));
  assert.ok(links.some((l) => /tablecheck\.com/.test(l.url) && l.kind === 'booking'));
});

test('a post published twice (the same words on one feed or on Facebook and Instagram) is one item naming both posts', () => {
  const { items } = poolOf('hideout');
  const jazz = items.filter((it) => /LADIES JAZZ NIGHT/.test(it.body));
  assert.equal(jazz.length, 1);
  assert.ok(jazz[0].posts.length >= 2);
  const wednesday = items.filter((it) => /^Everyone’s talking about Wednesday nights/.test(it.body));
  assert.equal(wednesday.length, 1);
});

test('two posts alike in words but not in their date, price or place stay two items', () => {
  const posts = [
    { source: 'facebook', id: 'a', postedAt: '2026-09-01T00:00:00Z', caption: 'Sunday brunch with live music at the terrace, all you can eat.\n12 PM – 4 PM\nOnly AED 99' },
    { source: 'facebook', id: 'b', postedAt: '2026-10-01T00:00:00Z', caption: 'Sunday brunch with live music at the terrace, all you can eat.\n12 PM – 4 PM\nOnly AED 129' },
  ];
  assert.equal(contentPool({ posts, now: NOW }).items.length, 2);
});

test('a body keeps the post’s paragraphs and drops what speaks to the feed, not to a reader of a website', () => {
  const { items } = poolOf('les-gourmet');
  for (const it of items) {
    assert.doesNotMatch(it.body, /Tag (someone|the person)|in the comments|Save this|send it to someone|Dubai food • /i);
    assert.doesNotMatch(it.body, /ice cream Dubai, Dubai desserts|Dubai foodies, refreshing drinks/, 'keyword list left in');
  }
  const breakfast = items.find((it) => /^Sundays just got a little more delicious/.test(it.body));
  assert.ok(breakfast.body.includes('\n\n'), 'paragraphs kept');
});

const find = (items, re) => items.find((it) => re.test(it.body) || re.test(it.title ?? ''));

test('each item says what it is about — dish, story, product, event, offer — and may be more than one', () => {
  const hill = poolOf('hill-station').items;
  assert.ok(find(hill, /Eggs Benedict/).kinds.includes('dish'));
  assert.ok(find(hill, /first The Hill Station opened its doors in 2011/).kinds.includes('story'));
  assert.ok(find(hill, /Magic Blend/).kinds.includes('product'));
  const hideout = poolOf('hideout').items;
  const sushi = find(hideout, /^EVERY WEDNESDAY|Every Wednesday/);
  assert.ok(sushi.kinds.includes('event') && sushi.kinds.includes('offer'), JSON.stringify(sushi.kinds));
  const combo = find(poolOf('passion').items, /CHRISTMAS COMBO SPECIAL|Christmas Combo Special/);
  assert.ok(combo.kinds.includes('offer'));
});

test('a closure notice, a holiday greeting, a meme or a few words are never content', () => {
  const passion = poolOf('passion').items;
  assert.equal(find(passion, /temporarily closed|official reopening/), undefined);
  assert.equal(find(passion, /Thank you for celebrating a warm Christmas/), undefined);
  assert.equal(find(poolOf('hill-station').items, /years of independence|Happy Reunification Day/), undefined);
  const daddys = poolOf('daddys').items;
  assert.equal(find(daddys, /Pick me\. Choose me|Three hours of sleep/), undefined);
});

test('when an event or an offer runs is read from its words, never from the day it was posted', () => {
  const hideout = poolOf('hideout').items;
  const show = find(hideout, /Table of Absence/);
  assert.deepEqual(
    { startsAt: show.temporal.startsAt, endsAt: show.temporal.endsAt, status: show.temporal.status },
    { startsAt: '2026-10-08', endsAt: '2026-10-29', status: 'active' }
  );
  const sushi = find(hideout, /^EVERY WEDNESDAY|Every Wednesday/);
  assert.equal(sushi.temporal.recurs, 'weekly');
  assert.equal(sushi.temporal.status, 'unknown', 'a weekly night posted weeks ago is not proof it still runs');
  const combo = find(poolOf('passion').items, /Christmas Combo/i);
  assert.equal(combo.temporal.status, 'past');
  assert.equal(find(poolOf('hill-station').items, /Eggs Benedict/).temporal, null);
});

test('words the post credits to someone else are marked as not the page’s own', () => {
  const credited = contentPool({
    posts: [{ source: 'facebook', id: 'x', postedAt: '2025-12-01T00:00:00Z', caption: 'Hoi An is peaceful, the food is authentic! We loved every dish of our dinner by the beach tonight.\n\n📸: Hoian.recorder' }],
    now: NOW,
  }).items[0];
  assert.equal(credited.authorship, 'credited');
  assert.equal(find(poolOf('hill-station').items, /Eggs Benedict/).authorship, 'page');
});

test('a title is the post’s own heading line, in plain letters; otherwise its first sentence, cut at a word', () => {
  const hill = poolOf('hill-station').items;
  const door = find(hill, /The Blue Door/);
  assert.equal(door.title, 'The Blue Door');
  assert.doesNotMatch(door.body, /^The Blue Door/);
  for (const it of [...hill, ...poolOf('hideout').items]) {
    assert.ok(it.title.length > 0 && it.title.length <= 71, it.title);
    // A sentence cut at a word says so; a whole sentence or a clause does not.
    const first = it.body.split('\n')[0].replace(/\s+/g, ' ');
    if (it.title.endsWith('…')) assert.ok(first.startsWith(it.title.slice(0, -1).trim()), it.title);
    assert.doesNotMatch(it.title, /^[^a-z]*[A-Z]{4,}[^a-z]*$/, `shouting title: ${it.title}`);
  }
});

test('a first sentence too long for a title is cut at a word and ends with an ellipsis', () => {
  const long = poolOf('hill-station').items.filter((it) => it.title.endsWith('…'));
  assert.ok(long.length > 0, 'the fixture has at least one long untitled post');
  for (const it of long) assert.doesNotMatch(it.title, /\s…$/);
});

test('a job advert, a giveaway or a contest is never content', () => {
  const hill = poolOf('hill-station').items;
  assert.equal(find(hill, /tuyển dụng|Is Hiring|JOIN OUR TEAM/i), undefined);
  assert.equal(find(poolOf('les-gourmet').items, /Giveaway|up for grabs/i), undefined);
});

test('a feed written mostly in one language keeps that language: a post in another is left out', () => {
  const hill = poolOf('hill-station').items;
  assert.ok(hill.every((it) => it.lang === 'en'), hill.filter((it) => it.lang !== 'en').map((it) => it.title).join(' | '));
  const vi = contentPool({
    posts: [
      { source: 'facebook', id: '1', caption: 'Phở bò tái chín của quán được nấu từ xương ống hầm suốt mười hai tiếng, nước dùng trong và ngọt thanh vị quế hồi.' },
      { source: 'facebook', id: '2', caption: 'Bánh mì nướng giòn với pa tê gan nhà làm, chả lụa và rau thơm tươi mỗi sáng, mời cả nhà ghé ăn sáng nhé.' },
    ],
    now: NOW,
  }).items;
  assert.deepEqual(vi.map((it) => it.lang), ['vi', 'vi']);
});

test('a story is a post that tells where the place comes from, not any post that says "family" or "since"', () => {
  const hideout = poolOf('hideout').items;
  const dad = find(hideout, /Dad deserves/);
  assert.ok(!dad || !dad.kinds.includes('story'));
  assert.ok(find(poolOf('hill-station').items, /first The Hill Station opened its doors in 2011/).kinds.includes('story'));
});

test('a line that is only a handle is never a title', () => {
  for (const it of poolOf('hideout').items) assert.doesNotMatch(it.title, /^@[\w.]+$/);
});
