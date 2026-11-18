const assert = require('node:assert/strict')
const { generateKeyPairSync, sign } = require('node:crypto')
const test = require('node:test')
const { createDesktopLicense } = require('./desktopLicense.cjs')

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const token = 'a_long_opaque_seat_token'
const config = {
  serverUrl: 'http://127.0.0.1:19190',
  publicKey: publicKey.export({ format: 'pem', type: 'spki' }),
}

function signed(challenge, key = privateKey, duration = 90_000) {
  const issuedAt = Date.now()
  const payload = Buffer.from(JSON.stringify({ token, challenge, issuedAt, expiresAt: issuedAt + duration })).toString('base64url')
  return payload + '.' + sign(null, Buffer.from(payload, 'ascii'), key).toString('base64url')
}

test('acquires a signed lease and releases its authenticated seat', async () => {
  const calls = []
  const client = createDesktopLicense(config, {
    fetchImpl: async (url, options) => {
      calls.push(url)
      if (url.endsWith('/release')) {
        assert.equal(options.headers.Authorization, 'Bearer ' + token)
        return new Response(null, { status: 204 })
      }
      const { requestId, challenge } = JSON.parse(options.body)
      assert.match(requestId, /^[A-Za-z0-9_-]{32}$/)
      return Response.json({ assertion: signed(challenge) })
    },
  })
  try {
    await client.acquire()
  } finally {
    await client.release()
  }
  assert.deepEqual(calls, [
    'http://127.0.0.1:19190/v1/licenses/acquire',
    'http://127.0.0.1:19190/v1/licenses/release',
  ])
})

test('refuses both a substituted service and a replayed assertion', async () => {
  const foreignKey = generateKeyPairSync('ed25519').privateKey
  const forged = createDesktopLicense(config, {
    fetchImpl: async (_url, options) => Response.json({
      assertion: signed(JSON.parse(options.body).challenge, foreignKey),
    }),
  })
  await assert.rejects(forged.acquire(), { code: 'invalid_assertion' })
  const replay = createDesktopLicense(config, {
    fetchImpl: async () => Response.json({ assertion: signed('earlier-request-challenge') }),
  })
  await assert.rejects(replay.acquire(), { code: 'invalid_assertion' })
})

test('keeps a Spring Boot or reverse proxy context prefix in desktop license requests', async () => {
  const calls = []
  const client = createDesktopLicense({ ...config, serverUrl: 'https://license.example.test/office-api/' }, {
    fetchImpl: async (url, options) => {
      calls.push(url)
      if (url.endsWith('/release')) return new Response(null, { status: 204 })
      return Response.json({ assertion: signed(JSON.parse(options.body).challenge) })
    },
  })
  try {
    await client.acquire()
  } finally {
    await client.release()
  }
  assert.deepEqual(calls, [
    'https://license.example.test/office-api/v1/licenses/acquire',
    'https://license.example.test/office-api/v1/licenses/release',
  ])
  assert.throws(
    () => createDesktopLicense({ ...config, serverUrl: 'http://192.0.2.9/office-api' }),
    { code: 'invalid_config' },
  )
})

test('uses remote HTTP only when explicitly enabled', async () => {
  const serverUrl = 'http://biteam.f1.luyouxia.net:19091'
  assert.throws(() => createDesktopLicense({ ...config, serverUrl }), { code: 'invalid_config' })
  assert.throws(
    () => createDesktopLicense({ ...config, serverUrl, allowInsecureHttp: 'true' }),
    { code: 'invalid_config' },
  )

  const calls = []
  const client = createDesktopLicense({ ...config, serverUrl, allowInsecureHttp: true }, {
    fetchImpl: async (url, options) => {
      calls.push(url)
      assert.equal(options.redirect, 'error')
      if (url.endsWith('/release')) {
        assert.equal(options.headers.Authorization, 'Bearer ' + token)
        return new Response(null, { status: 204 })
      }
      assert.equal(options.headers.Authorization, undefined)
      return Response.json({ assertion: signed(JSON.parse(options.body).challenge) })
    },
  })
  try {
    await client.acquire()
  } finally {
    await client.release()
  }
  assert.deepEqual(calls, [
    serverUrl + '/v1/licenses/acquire',
    serverUrl + '/v1/licenses/release',
  ])
})

const localConfig = {
  ...config,
  serverUrl: 'https://license.example.test/wx',
  localServerUrl: 'http://127.0.0.1:8082/wx',
}

test('probes local Java without acquiring a seat and keeps the lease on that endpoint', { timeout: 3000 }, async () => {
  const calls = []
  let finishRenew
  const renewal = new Promise(resolve => { finishRenew = resolve })
  const client = createDesktopLicense(localConfig, {
    fetchImpl: async (url, options) => {
      calls.push(url)
      if (url.endsWith('/release')) {
        assert.equal(options.headers.Authorization, 'Bearer ' + token)
        return new Response(null, { status: 204 })
      }
      const body = JSON.parse(options.body)
      if (Array.isArray(body)) {
        assert.equal(options.headers.Authorization, undefined)
        return Response.json({ code: 'invalid_request' }, { status: 400 })
      }
      if (url.endsWith('/renew')) {
        assert.equal(options.headers.Authorization, 'Bearer ' + token)
        finishRenew()
      }
      return Response.json({ assertion: signed(body.challenge, privateKey, 900) })
    },
  })
  try {
    await client.acquire()
    await renewal
  } finally {
    await client.release()
  }
  assert.deepEqual(calls, ['acquire', 'acquire', 'renew', 'release'].map(action => localConfig.localServerUrl + '/v1/licenses/' + action))
})

test('uses the configured public endpoint if no local authorization service responds', async () => {
  const calls = []
  const client = createDesktopLicense(localConfig, {
    fetchImpl: async (url, options) => {
      calls.push(url)
      if (url.startsWith(localConfig.localServerUrl)) throw new Error('local connection refused')
      if (url.endsWith('/release')) return new Response(null, { status: 204 })
      return Response.json({ assertion: signed(JSON.parse(options.body).challenge) })
    },
  })
  try {
    await client.acquire()
  } finally {
    await client.release()
  }
  assert.deepEqual(calls, [
    localConfig.localServerUrl + '/v1/licenses/acquire',
    localConfig.serverUrl + '/v1/licenses/acquire',
    localConfig.serverUrl + '/v1/licenses/release',
  ])
})

test('does not bypass a local service denial or accept a non-loopback local address', async () => {
  const calls = []
  const client = createDesktopLicense(localConfig, {
    fetchImpl: async (url, options) => {
      calls.push(url)
      return Array.isArray(JSON.parse(options.body))
        ? Response.json({ code: 'invalid_request' }, { status: 400 })
        : Response.json({ code: 'ip_denied' }, { status: 403 })
    },
  })
  await assert.rejects(client.acquire(), { code: 'ip_denied' })
  assert.deepEqual(calls, Array(2).fill(localConfig.localServerUrl + '/v1/licenses/acquire'))
  assert.throws(
    () => createDesktopLicense({ ...localConfig, localServerUrl: 'https://192.0.2.1/wx' }),
    { code: 'invalid_config' },
  )
})
