import { createPrivateKey, randomBytes, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'

const REQUEST_ID = /^[A-Za-z0-9_-]{16,128}$/
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/i
const MAX_BODY_BYTES = 2048
const SERVER_OPTIONS = { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 2000 }

function ipv4Value(text) {
  return text.split('.').reduce((value, octet) => (value << 8n) | BigInt(octet), 0n)
}

function ipv6Value(text) {
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':')
    const value = ipv4Value(text.slice(lastColon + 1))
    text = text.slice(0, lastColon + 1) + (value >> 16n).toString(16) + ':' + (value & 0xffffn).toString(16)
  }
  const halves = text.split('::').map((half) => (half ? half.split(':') : []))
  const groups = halves.length === 1
    ? halves[0]
    : [...halves[0], ...Array(8 - halves[0].length - halves[1].length).fill('0'), ...halves[1]]
  return groups.reduce((value, group) => (value << 16n) | BigInt('0x' + group), 0n)
}

function parseAddress(text) {
  const family = isIP(text)
  if (family === 4) return { bits: 32, value: ipv4Value(text), text }
  if (family !== 6 || text.includes('%')) return null
  const value = ipv6Value(text)
  if (value >> 32n !== 0xffffn) return { bits: 128, value, text }
  const ipv4 = value & 0xffffffffn
  const dotted = [24n, 16n, 8n, 0n].map((shift) => Number((ipv4 >> shift) & 255n)).join('.')
  return { bits: 32, value: ipv4, text: dotted, mapped: true }
}

function parseRule(rule) {
  const parts = rule.split('/')
  const address = parseAddress(parts[0])
  if (!address || parts.length > 2) throw new Error('Invalid IP allowlist entry: ' + rule)
  if (parts.length === 2 && !/^\d{1,3}$/.test(parts[1])) throw new Error('Invalid CIDR prefix: ' + rule)
  const prefix = parts.length === 1 ? address.bits : Number(parts[1]) - (address.mapped ? 96 : 0)
  if (prefix < 0 || prefix > address.bits) throw new Error('Invalid CIDR prefix: ' + rule)
  const shift = BigInt(address.bits - prefix)
  return { bits: address.bits, network: address.value >> shift, shift }
}

function allowlistFrom(value) {
  const entries = value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? []
  if (!entries.length) throw new Error('OIP_LICENSE_ALLOWLIST must contain at least one IP or CIDR')
  return entries.map(parseRule)
}

function boundedInt(value, name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(name + ' must be an integer between ' + min + ' and ' + max)
  }
  return number
}

function isLoopback(host) {
  if (host === 'localhost') return true
  const address = parseAddress(host)
  return address?.bits === 32 ? address.value >> 24n === 127n : address?.value === 1n
}

function configFrom(env) {
  const host = env.OIP_LICENSE_HOST || '127.0.0.1'
  if (!env.OIP_LICENSE_PRIVATE_KEY_FILE) throw new Error('Set OIP_LICENSE_PRIVATE_KEY_FILE to an Ed25519 private key PEM file')
  const tlsKey = env.OIP_LICENSE_TLS_KEY_FILE
  const tlsCert = env.OIP_LICENSE_TLS_CERT_FILE
  if (Boolean(tlsKey) !== Boolean(tlsCert)) throw new Error('Set both OIP_LICENSE_TLS_KEY_FILE and OIP_LICENSE_TLS_CERT_FILE')
  if (!tlsKey && !isLoopback(host)) throw new Error('A non-loopback license listener requires TLS')
  return {
    host,
    port: boundedInt(env.OIP_LICENSE_PORT, 'OIP_LICENSE_PORT', 19190, 1, 65535),
    allowedIps: env.OIP_LICENSE_ALLOWLIST,
    maxSeats: boundedInt(env.OIP_LICENSE_MAX_SEATS, 'OIP_LICENSE_MAX_SEATS', 30, 25),
    ttlMs: boundedInt(env.OIP_LICENSE_TTL_MS, 'OIP_LICENSE_TTL_MS', 90000, 1000, 300000),
    privateKey: createPrivateKey(readFileSync(env.OIP_LICENSE_PRIVATE_KEY_FILE)),
    tls: tlsKey ? { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) } : undefined,
  }
}

function reply(res, status, body, close = false) {
  res.setHeader('Cache-Control', 'no-store')
  if (close) res.setHeader('Connection', 'close')
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return null
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) return null
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) return null
      chunks.push(chunk)
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function createAssertion(key, lease, challenge, issuedAt) {
  const payload = Buffer.from(JSON.stringify({
    token: lease.token, challenge, expiresAt: lease.expiresAt, issuedAt, ip: lease.ip,
  })).toString('base64url')
  return payload + '.' + sign(null, Buffer.from(payload, 'ascii'), key).toString('base64url')
}

/** One process owns the active leases. The socket address determines the authorization scope. */
export function createLicenseServer({ allowedIps, privateKey, maxSeats = 30, ttlMs = 90000, tls, now = Date.now }) {
  const allowlist = allowlistFrom(allowedIps)
  if (privateKey?.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The license signing key must be an Ed25519 private key')
  }
  maxSeats = boundedInt(String(maxSeats), 'maxSeats', 30, 25)
  ttlMs = boundedInt(String(ttlMs), 'ttlMs', 90000, 1000, 300000)
  const leases = new Map()
  const requestTokens = new Map()

  function forget(lease) {
    leases.delete(lease.token)
    requestTokens.delete(lease.requestKey)
  }

  async function handle(req, res) {
    const address = parseAddress(req.socket.remoteAddress ?? '')
    if (!address || !allowlist.some((rule) => rule.bits === address.bits && (address.value >> rule.shift) === rule.network)) {
      return reply(res, 403, { code: 'ip_denied' }, true)
    }
    const acquire = req.url === '/v1/licenses/acquire'
    const renew = req.url === '/v1/licenses/renew'
    const release = req.url === '/v1/licenses/release'
    if (!acquire && !renew && !release) return reply(res, 404, { code: 'not_found' }, true)
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return reply(res, 405, { code: 'method_not_allowed' }, true)
    }

    const token = BEARER.exec(req.headers.authorization ?? '')?.[1]
    if (!acquire && !token) return reply(res, 400, { code: 'invalid_request' }, true)

    const body = release ? null : await readJson(req)
    const challenge = body?.challenge
    const requestId = body?.requestId
    if (!release && (typeof challenge !== 'string' || !REQUEST_ID.test(challenge))) {
      return reply(res, 400, { code: 'invalid_request' }, true)
    }
    if (acquire && (typeof requestId !== 'string' || !REQUEST_ID.test(requestId))) {
      return reply(res, 400, { code: 'invalid_request' }, true)
    }

    // Parse the request before touching the lease maps so concurrent acquires have one
    // synchronous check-and-insert. Browser-controlled forwarding headers are ignored.
    const issuedAt = now()
    for (const lease of leases.values()) {
      if (lease.expiresAt <= issuedAt) forget(lease)
    }
    const ipKey = address.bits + '/' + address.value
    if (acquire) {
      const requestKey = ipKey + '/' + requestId
      let lease = leases.get(requestTokens.get(requestKey))
      if (!lease) {
        if (leases.size >= maxSeats) return reply(res, 409, { code: 'seats_full' })
        lease = { token: randomBytes(32).toString('base64url'), expiresAt: issuedAt + ttlMs, ip: address.text, ipKey, requestKey }
        leases.set(lease.token, lease)
        requestTokens.set(requestKey, lease.token)
      }
      return reply(res, 200, { assertion: createAssertion(privateKey, lease, challenge, issuedAt) })
    }
    const lease = leases.get(token)
    if (release && !lease) return reply(res, 204, undefined, true)
    if (!lease || lease.ipKey !== ipKey) return reply(res, 410, { code: 'lease_expired' }, true)
    if (release) {
      forget(lease)
      return reply(res, 204, undefined, true)
    }
    lease.expiresAt = issuedAt + ttlMs
    return reply(res, 200, { assertion: createAssertion(privateKey, lease, challenge, issuedAt) })
  }

  const listener = (req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent && !res.destroyed) reply(res, 500, { code: 'server_error' }, true)
      else res.destroy()
    })
  }
  return tls
    ? createHttpsServer({ ...SERVER_OPTIONS, ...tls }, listener)
    : createServer(SERVER_OPTIONS, listener)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = configFrom(process.env)
    const server = createLicenseServer(config)
    server.on('error', (err) => {
      console.error('License server failed: ' + err.message)
      process.exitCode = 1
    })
    server.listen(config.port, config.host, () => {
      console.log('License server on ' + config.host + ':' + config.port + ' (' + config.maxSeats + ' seats)')
    })
  } catch (err) {
    console.error('License server configuration error: ' + err.message)
    process.exitCode = 1
  }
}
