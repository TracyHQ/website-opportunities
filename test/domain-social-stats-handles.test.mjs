import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSocialUrl } from '../domain/social-stats/handles.mjs';

test('facebook: page slug, numeric page, profile.php and the new /p/ form', () => {
  assert.deepEqual(parseSocialUrl('https://www.facebook.com/PassionHoiAn'), { network: 'facebook', pageSlug: 'PassionHoiAn', url: 'https://www.facebook.com/PassionHoiAn' });
  assert.deepEqual(parseSocialUrl('http://m.facebook.com/PassionHoiAn/?ref=page_internal'), { network: 'facebook', pageSlug: 'PassionHoiAn', url: 'https://www.facebook.com/PassionHoiAn' });
  assert.deepEqual(parseSocialUrl('https://fb.com/morningglory.hoian/about'), { network: 'facebook', pageSlug: 'morningglory.hoian', url: 'https://www.facebook.com/morningglory.hoian' });
  assert.deepEqual(parseSocialUrl('https://www.facebook.com/profile.php?id=100065459470566'), { network: 'facebook', pageId: '100065459470566', url: 'https://www.facebook.com/profile.php?id=100065459470566' });
  assert.deepEqual(parseSocialUrl('https://www.facebook.com/pages/Passion-Restaurant/100065459470566'), { network: 'facebook', pageId: '100065459470566', url: 'https://www.facebook.com/profile.php?id=100065459470566' });
  assert.deepEqual(parseSocialUrl('https://www.facebook.com/p/Passion-Restaurant-100065459470566/'), { network: 'facebook', pageId: '100065459470566', url: 'https://www.facebook.com/profile.php?id=100065459470566' });
});

test('facebook: share, photo, group and login links are not pages', () => {
  for (const u of [
    'https://www.facebook.com/sharer/sharer.php?u=x',
    'https://www.facebook.com/photo/?fbid=1',
    'https://www.facebook.com/groups/123',
    'https://www.facebook.com/reel/123',
    'https://www.facebook.com/login',
    'https://www.facebook.com/',
    'https://www.facebook.com/profile.php',
  ]) assert.equal(parseSocialUrl(u), null, u);
});

test('instagram: username, lower-cased; posts and reels are not profiles', () => {
  assert.deepEqual(parseSocialUrl('https://www.instagram.com/Passion.HoiAn/'), { network: 'instagram', handle: 'passion.hoian', url: 'https://www.instagram.com/passion.hoian/' });
  assert.deepEqual(parseSocialUrl('instagram.com/phincoffeehoian?igsh=abc'), { network: 'instagram', handle: 'phincoffeehoian', url: 'https://www.instagram.com/phincoffeehoian/' });
  for (const u of ['https://www.instagram.com/p/C8MtnQGv4i9/', 'https://www.instagram.com/reel/abc/', 'https://www.instagram.com/explore/tags/x', 'https://www.instagram.com/']) {
    assert.equal(parseSocialUrl(u), null, u);
  }
});

test('tiktok: @user only; short links and videos alone are not resolvable offline', () => {
  assert.deepEqual(parseSocialUrl('https://www.tiktok.com/@phin.coffee'), { network: 'tiktok', handle: 'phin.coffee', url: 'https://www.tiktok.com/@phin.coffee' });
  assert.deepEqual(parseSocialUrl('https://www.tiktok.com/@Phin.Coffee/video/7125734702652572677?lang=en'), { network: 'tiktok', handle: 'phin.coffee', url: 'https://www.tiktok.com/@phin.coffee' });
  assert.equal(parseSocialUrl('https://vm.tiktok.com/ZMabc123/'), null);
  assert.equal(parseSocialUrl('https://www.tiktok.com/discover/hoi-an'), null);
});

test('youtube: @handle, /channel/UC…, and the legacy /c/ and /user/ forms', () => {
  assert.deepEqual(parseSocialUrl('https://www.youtube.com/@MrBeast/videos'), { network: 'youtube', handle: 'mrbeast', url: 'https://www.youtube.com/@mrbeast' });
  assert.deepEqual(parseSocialUrl('https://m.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA'), { network: 'youtube', channelId: 'UCX6OQ3DkcsbYNE6H8uQQuVA', url: 'https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA' });
  assert.deepEqual(parseSocialUrl('https://www.youtube.com/c/GoogleDevelopers'), { network: 'youtube', legacy: 'c', name: 'GoogleDevelopers', url: 'https://www.youtube.com/c/GoogleDevelopers' });
  assert.deepEqual(parseSocialUrl('https://www.youtube.com/user/GoogleDevelopers/about'), { network: 'youtube', legacy: 'user', name: 'GoogleDevelopers', url: 'https://www.youtube.com/user/GoogleDevelopers' });
  for (const u of ['https://youtu.be/RE3_PGwDwhw', 'https://www.youtube.com/watch?v=RE3_PGwDwhw', 'https://www.youtube.com/channel/notanid', 'https://www.youtube.com/']) {
    assert.equal(parseSocialUrl(u), null, u);
  }
});

test('a bare handle needs the network; junk and other hosts give null', () => {
  assert.deepEqual(parseSocialUrl('@phin.coffee', { network: 'tiktok' }), { network: 'tiktok', handle: 'phin.coffee', url: 'https://www.tiktok.com/@phin.coffee' });
  assert.deepEqual(parseSocialUrl('passion.hoian', { network: 'instagram' }), { network: 'instagram', handle: 'passion.hoian', url: 'https://www.instagram.com/passion.hoian/' });
  assert.equal(parseSocialUrl('@phin.coffee'), null);
  for (const v of [null, undefined, '', '   ', 42, 'not a url', 'https://example.com/PassionHoiAn', 'javascript:alert(1)', 'https://evil-facebook.com/x']) {
    assert.equal(parseSocialUrl(v), null, String(v));
  }
  // A network hint never overrides the URL's own host.
  assert.equal(parseSocialUrl('https://www.instagram.com/passion.hoian/', { network: 'tiktok' }), null);
});

test('facebook: account features (messages, settings, marketplace…) are not pages (dev round L4)', () => {
  for (const seg of ['messages', 'messenger', 'me', 'friends', 'settings', 'notifications', 'bookmarks', 'marketplace', 'groups', 'events', 'watch', 'gaming']) {
    assert.equal(parseSocialUrl(`https://www.facebook.com/${seg}`), null, seg);
    assert.equal(parseSocialUrl(`https://www.facebook.com/${seg[0].toUpperCase()}${seg.slice(1)}/`), null, `${seg}, capitalised`);
    assert.equal(parseSocialUrl(seg, { network: 'facebook' }), null, `bare ${seg}`);
  }
  assert.equal(parseSocialUrl('https://www.facebook.com/messages/t/123456'), null);
  assert.equal(parseSocialUrl('https://www.facebook.com/messagesbistro')?.pageSlug, 'messagesbistro', 'only the whole segment is reserved');
});
