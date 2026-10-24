import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertPublicUrl, isBlockedAddress } from '../domain/url-guard.mjs'

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }]
const dnsOf = (map) => async (host) => map[host] ?? []

async function blocked(url, deps = { resolve: publicDns }, opts) {
  await assert.rejects(
    assertPublicUrl(url, deps, opts),
    (err) => {
      assert.equal(err.code, 'URL_BLOCKED')
      assert.equal(typeof err.reason, 'string')
      return true
    },
    url
  )
}

test('a public https URL passes and comes back as a URL object', async () => {
  const u = await assertPublicUrl('https://example.com/menu', { resolve: publicDns })
  assert.ok(u instanceof URL)
  assert.equal(u.href, 'https://example.com/menu')
})

test('blocks non-http schemes, credentials and odd ports', async () => {
  await blocked('file:///etc/passwd')
  await blocked('ftp://example.com/')
  await blocked('javascript:alert(1)')
  await blocked('https://user:pass@example.com/')
  await blocked('http://example.com:8080/')
  await blocked('not a url')
})

test('a non-default port passes only when explicitly allowed', async () => {
  const u = await assertPublicUrl('http://example.com:8080/', { resolve: publicDns }, { allowPorts: [8080] })
  assert.equal(u.port, '8080')
})

test('blocks IPv4 literals in every private and reserved range', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.254',
    '0.0.0.0',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255'
  ]) {
    await blocked(`http://${ip}/`)
  }
})

test('blocks IPv4 written in decimal, hex or short forms (URL parser normalises them)', async () => {
  await blocked('http://2130706433/') // 127.0.0.1
  await blocked('http://0x7f.0.0.1/')
  await blocked('http://127.1/')
})

test('blocks IPv6 loopback, ULA, link-local and IPv4-mapped private addresses', async () => {
  for (const ip of [
    '[::1]',
    '[fc00::1]',
    '[fd12:3456::1]',
    '[fe80::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:a9fe:a9fe]',
    '[::]',
    '[ff02::1]'
  ]) {
    await blocked(`http://${ip}/`)
  }
})

test('public addresses on the edges of blocked ranges are allowed', () => {
  for (const ip of [
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '8.8.8.8',
    '2606:4700::1111'
  ]) {
    assert.equal(isBlockedAddress(ip), false, ip)
  }
})

test('resolver answers in dotted IPv4-mapped, NAT64 or 6to4 form are judged by the embedded IPv4', () => {
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true)
  assert.equal(isBlockedAddress('::ffff:169.254.169.254'), true)
  assert.equal(isBlockedAddress('64:ff9b::10.0.0.1'), true)
  assert.equal(isBlockedAddress('2002:c0a8:0101::1'), true)
  assert.equal(isBlockedAddress('::ffff:8.8.8.8'), false)
  assert.equal(isBlockedAddress('garbage'), true)
})

test('rejects when ANY resolved address is private (DNS rebinding with mixed answers)', async () => {
  await blocked('https://evil.test/', {
    resolve: dnsOf({
      'evil.test': [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ]
    })
  })
})

test('rejects a hostname that resolves to the metadata address', async () => {
  await blocked('http://meta.test/', {
    resolve: dnsOf({ 'meta.test': [{ address: '169.254.169.254', family: 4 }] })
  })
})

test('rejects a hostname that resolves to nothing or whose lookup throws', async () => {
  await blocked('https://nowhere.test/', { resolve: dnsOf({}) })
  await blocked('https://boom.test/', {
    resolve: async () => {
      throw new Error('ENOTFOUND')
    }
  })
})

test('blocks localhost names without asking DNS', async () => {
  let asked = false
  await blocked('http://localhost/', {
    resolve: async () => {
      asked = true
      return [{ address: '93.184.216.34', family: 4 }]
    }
  })
  await blocked('http://api.localhost/', { resolve: publicDns })
  assert.equal(asked, false)
})
