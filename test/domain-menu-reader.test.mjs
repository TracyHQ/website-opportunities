import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { menuItemsFromHtml, menuItemsFromPdfPages, readMenus } from '../domain/menu-reader.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/menu/${name}`, import.meta.url), 'utf8');
const AT = '2026-10-23T10:00:00.000Z';
const SRC = { url: 'https://phin.test/menu', sha256: 'a'.repeat(64), kind: 'page' };
const brief = (items) => items.map(({ name, price, currency, section, verified }) => ({ name, price, currency, section, verified }));

test('an HTML menu page: each dish with the price on its own row, verbatim, under its heading', () => {
  const items = menuItemsFromHtml(fixture('menu-page.html'), { source: SRC, collectedAt: AT });
  assert.deepEqual(brief(items), [
    { name: 'Cà phê sữa đá', price: '45.000đ', currency: 'đ', section: 'Coffee', verified: true },
    { name: 'Egg coffee', price: '55.000đ', currency: 'đ', section: 'Coffee', verified: true },
    { name: 'Bánh mì Phin', price: '65.000', currency: null, section: 'Food', verified: true },
    { name: 'Combo 2', price: '120.000', currency: null, section: 'Food', verified: true },
    { name: 'Phở bò', price: '75.000', currency: null, section: 'Food', verified: true },
  ]);
  assert.deepEqual(items[0].source, SRC);
  assert.equal(items[0].collectedAt, AT);
});

test('a price on the line after a dish, not on its row, stays a suggestion', () => {
  const items = menuItemsFromHtml(fixture('menu-near-price.html'), { source: SRC, collectedAt: AT });
  assert.deepEqual(brief(items), [
    { name: 'Grilled sea bass', price: 'AED 95', currency: 'AED', section: 'Specials', verified: false },
    { name: 'Lamb ouzi', price: '120', currency: null, section: 'Specials', verified: false },
    { name: 'Hummus Beiruti', price: 'AED 32', currency: 'AED', section: 'Specials', verified: true },
  ]);
});

test('a site builder that sets each dish name and price as its own heading still yields suggestions', () => {
  // Wix: `<h6>English Breakfast</h6><h6>AED 71</h6><p>…</p>` under a section heading.
  const html = `<h2>All-Day Breakfast</h2>
    <div><h6><span>English Breakfast</span></h6></div><div><h6><span>AED 71</span></h6></div>
    <p>Eggs, beef bacon, sausages, hash browns.</p>
    <div><h6><span>Lemon Ricotta Pancake</span></h6></div><div><h6><span>AED 42</span></h6></div>`;
  const items = menuItemsFromHtml(html, { source: SRC, collectedAt: AT });
  assert.deepEqual(
    items.map((i) => [i.name, i.price, i.currency, i.section, i.verified]),
    [
      ['English Breakfast', 'AED 71', 'AED', 'All-Day Breakfast', false],
      ['Lemon Ricotta Pancake', 'AED 42', 'AED', 'All-Day Breakfast', false]
    ]
  );
});

test('a two-column PDF menu with prices by size: each size its own item, each column its own section', () => {
  const pages = JSON.parse(fixture('two-column-sizes.layout.json'));
  const pdf = { url: 'https://phin.test/menu.pdf', sha256: 'b'.repeat(64), kind: 'pdf' };
  const items = menuItemsFromPdfPages(pages, { source: pdf, collectedAt: AT });
  assert.deepEqual(
    items.map(({ name, price, currency, size, section, verified, source }) => [name, price, currency, size ?? null, section, verified, source.page]),
    [
      ['Margherita', '8.50', null, 'Small', 'PIZZA', true, 1],
      ['Margherita', '12.00', null, 'Large', 'PIZZA', true, 1],
      ['Espresso', '2.50', null, null, 'DRINKS', true, 1],
      ['Quattro formaggi', '10.00', null, 'Small', 'PIZZA', true, 1],
      ['Quattro formaggi', '14.50', null, 'Large', 'PIZZA', true, 1],
      ['Lemonade', '€ 3.80', '€', null, 'DRINKS', true, 1],
      // The price sits on the line under the dish: near it, not on its row.
      ['Tiramisu', '6.00', null, null, 'PIZZA', false, 1],
      // Two prices and no heading saying which size each is: which is which would be a guess.
      ['House wine', '7.00', null, null, null, false, 2],
      ['House wine', '28.00', null, null, null, false, 2],
    ],
  );
  assert.equal(items[0].source.url, pdf.url);
});

test('reading the menus research found: pages and PDFs become items, a broken source is reported and keeps its link', async () => {
  const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
  const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake');
  const bodies = {
    'https://phin.test/menu': new Response(fixture('menu-page.html'), { headers: { 'content-type': 'text/html' } }),
    'https://phin.test/menu.pdf': new Response(pdfBytes, { headers: { 'content-type': 'application/pdf' } }),
    'https://phin.test/gone.pdf': new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }),
  };
  const fetch = async (url) => {
    if (url === 'https://phin.test/down') throw new Error('ECONNRESET');
    return bodies[url];
  };
  const pdfText = async (bytes) => {
    assert.equal(new TextDecoder().decode(bytes), '%PDF-1.4 fake');
    return JSON.parse(fixture('two-column-sizes.layout.json'));
  };
  const menus = ['menu', 'menu.pdf', 'gone.pdf', 'down', 'menu'].map((p) => ({ url: `https://phin.test/${p}`, source: 'website' }));
  const { items, reads } = await readMenus({ menus, fetch, resolve, pdfText, now: () => Date.parse(AT) });
  assert.deepEqual(reads.map(({ url, kind, status, items: n }) => [url.slice(18), kind, status, n]), [
    ['menu', 'page', 'complete', 5],
    ['menu.pdf', 'pdf', 'complete', 9],
    ['gone.pdf', 'page', 'failed', 0],
    ['down', 'page', 'failed', 0],
  ]);
  assert.equal(items.length, 14);
  assert.deepEqual(items[0].source, { url: 'https://phin.test/menu', sha256: items[0].source.sha256, kind: 'page' });
  assert.match(items[0].source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(items[5].source.kind, 'pdf');
  assert.equal(items[0].collectedAt, AT);
});

test('a PDF with no reader on the host is skipped, not guessed', async () => {
  const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
  const fetch = async () => new Response(new TextEncoder().encode('%PDF-1.4'), { headers: { 'content-type': 'application/pdf' } });
  const { items, reads } = await readMenus({ menus: [{ url: 'https://phin.test/m.pdf' }], fetch, resolve });
  assert.deepEqual(items, []);
  assert.deepEqual(reads.map((r) => [r.status, r.reason]), [['skipped', 'no_pdf_reader']]);
});

test('a menu photo read by a model is a suggestion only, with the printed currency and nothing else added', async () => {
  const photos = [{ url: 'https://maps.test/menu-1.jpg', sha256: 'c'.repeat(64), mediaId: 'm1' }, { url: 'https://maps.test/menu-2.jpg' }];
  const readPhoto = async (photo) => {
    if (photo.url.endsWith('2.jpg')) throw Object.assign(new Error('model down'), { code: 'provider_error' });
    return [{ name: ' Shawarma plate ', price: 'AED 38', section: 'Mains' }, { name: 'Mint tea', price: '12' }, { name: '', price: '5' }];
  };
  const { items, reads } = await readMenus({ photos, readPhoto, fetch: async () => { throw new Error('no fetch'); }, now: () => Date.parse(AT) });
  assert.deepEqual(items.map(({ name, price, currency, section, verified, source }) => [name, price, currency, section, verified, source.kind]), [
    ['Shawarma plate', 'AED 38', 'AED', 'Mains', false, 'photo'],
    ['Mint tea', '12', null, null, false, 'photo'],
  ]);
  assert.deepEqual(reads.map((r) => [r.kind, r.status, r.reason ?? null]), [['photo', 'complete', null], ['photo', 'failed', 'provider_error']]);
});
