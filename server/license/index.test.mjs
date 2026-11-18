import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import { createLicenseServer } from './index.mjs'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const nonce = () => randomBytes(24).toString('base64url')

async function harness(t, options = {}) {
  const server = createLicenseServer({ privateKey, allowedIps: '127.0.0.0/8', ...options })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  })
  const base = 'http://127.0.0.1:' + server.address().port + '/v1/licenses/'
  return async (action, { data, token, headers } = {}) => {
    const response = await fetch(base + action, {
      method: 'POST',
      headers: {
        ...(data === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return {
      status: response.status,
      body: response.status === 204 ? undefined : await response.json(),
    }
  }
}

function claims(result, challenge) {
  assert.equal(result.status, 200)
  const parts = result.body.assertion.split('.')
  assert.equal(parts.length, 2)
  const [payload, signature] = parts
  assert(verify(null, Buffer.from(payload, 'ascii'), publicKey, Buffer.from(signature, 'base64url')))
  const signed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  assert.equal(signed.challenge, challenge)
  assert.equal(signed.ip, '127.0.0.1')
  assert.match(signed.token, /^[A-Za-z0-9_-]{43}$/)
  return signed
}

test('30 simultaneous authorized clients hold separate seats, 31st waits for release or expiry', async (t) => {
  let now = 1_000_000
  const call = await harness(t, { allowedIps: '::ffff:127.0.0.0/104', now: () => now, ttlMs: 1000 })
  const requests = Array.from({ length: 30 }, () => ({ challenge: nonce(), requestId: nonce() }))
  const results = await Promise.all(requests.map((data) => call('acquire', { data })))
  const active = results.map((result, i) => claims(result, requests[i].challenge))
  assert.equal(new Set(active.map((lease) => lease.token)).size, 30)
  assert(active.every((lease) => lease.issuedAt === now && lease.expiresAt === now + 1000))

  const challenge = nonce()
  const duplicate = await call('acquire', { data: { ...requests[0], challenge } })
  assert.equal(claims(duplicate, challenge).token, active[0].token)

  const extra = { challenge: nonce(), requestId: nonce() }
  assert.deepEqual(await call('acquire', { data: extra }), { status: 409, body: { code: 'seats_full' } })

  now += 500
  const renewal = await call('renew', { token: active[0].token, data: { challenge } })
  assert.equal(claims(renewal, challenge).expiresAt, now + 1000)

  assert.deepEqual(await call('release', { token: active[1].token }), { status: 204, body: undefined })
  assert.equal((await call('release', { token: active[1].token })).status, 204)
  assert.equal((await call('acquire', { data: extra })).status, 200)

  now += 501
  const expired = await call('renew', { token: active[2].token, data: { challenge } })
  assert.deepEqual(expired, { status: 410, body: { code: 'lease_expired' } })
  assert.equal((await call('renew', { token: active[0].token, data: { challenge } })).status, 200)
  assert.equal((await call('acquire', { data: { challenge, requestId: nonce() } })).status, 200)
})

test('actual unauthorized IP stays denied despite forwarding headers', async (t) => {
  const call = await harness(t, { allowedIps: '192.0.2.0/24,2001:db8::/32' })
  const denied = await call('acquire', {
    data: { challenge: nonce(), requestId: nonce() },
    headers: { 'x-forwarded-for': '192.0.2.8', 'x-real-ip': '192.0.2.8', forwarded: 'for=192.0.2.8' },
  })
  assert.deepEqual(denied, { status: 403, body: { code: 'ip_denied' } })
})

test('malformed requests and configuration are rejected', async (t) => {
  assert.throws(() => createLicenseServer({ privateKey, allowedIps: '' }), /allowlist/i)
  assert.throws(() => createLicenseServer({ privateKey, allowedIps: '127.0.0.1/33' }), /CIDR prefix/)
  assert.throws(() => createLicenseServer({ privateKey: publicKey, allowedIps: '127.0.0.1' }), /private key/)
  assert.throws(() => createLicenseServer({ privateKey, allowedIps: '127.0.0.1', maxSeats: 24 }), /maxSeats/)
  const call = await harness(t)
  assert.deepEqual(await call('acquire', { data: { challenge: nonce() } }), {
    status: 400, body: { code: 'invalid_request' },
  })
  assert.equal((await call('acquire', { data: { challenge: nonce(), requestId: 'x'.repeat(3000) } })).status, 400)
  assert.equal((await call('renew', { data: { challenge: nonce() } })).status, 400)
})
