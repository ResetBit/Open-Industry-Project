const { createPublicKey, randomBytes, verify } = require('node:crypto')
const { performance } = require('node:perf_hooks')

const LEASE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/
const MAX_LEASE_MS = 300_000
const NON_RETRYABLE = new Set(['ip_denied', 'seats_full', 'lease_expired', 'invalid_request', 'invalid_assertion'])

class DesktopLicenseError extends Error {
  constructor(code, options) {
    super(code, options)
    this.code = code
  }
}

function normalizeLicenseServerUrl(value, allowInsecureHttp = false) {
  const url = new URL(value)
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || allowInsecureHttp === true))) ||
      url.username || url.password || url.search || url.hash ||
      !/^(\/[A-Za-z0-9._~-]*)*$/.test(url.pathname)) {
    throw new Error('Use HTTPS or explicitly enable remote HTTP for the license base URL')
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

function normalizeLocalLicenseServerUrl(value) {
  const url = new URL(value)
  if (!['127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Use a literal loopback address for the local license service')
  }
  return normalizeLicenseServerUrl(url)
}

function endpoint(config) {
  try {
    const baseUrl = normalizeLicenseServerUrl(config.serverUrl, config.allowInsecureHttp)
    const key = createPublicKey(config.publicKey)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected an Ed25519 public key')
    const localBaseUrl = config.localServerUrl == null ? null : normalizeLocalLicenseServerUrl(config.localServerUrl)
    return { baseUrl, localBaseUrl, key }
  } catch (cause) {
    throw new DesktopLicenseError('invalid_config', { cause })
  }
}

function acceptAssertion(assertion, challenge, key, currentToken) {
  try {
    if (typeof assertion !== 'string' || assertion.length > 4096) throw new Error('Missing assertion')
    const segments = assertion.split('.')
    if (segments.length !== 2 || !segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))) {
      throw new Error('Malformed assertion')
    }
    const [payload, signature] = segments
    if (!verify(null, Buffer.from(payload, 'ascii'), key, Buffer.from(signature, 'base64url'))) {
      throw new Error('Invalid signature')
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const duration = claims.expiresAt - claims.issuedAt
    if (claims.challenge !== challenge || !LEASE_TOKEN.test(claims.token) ||
        (currentToken && currentToken !== claims.token) ||
        !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) ||
        duration <= 0 || duration > MAX_LEASE_MS) {
      throw new Error('Invalid lease claims')
    }
    return { token: claims.token, duration }
  } catch (cause) {
    throw new DesktopLicenseError('invalid_assertion', { cause })
  }
}

function createDesktopLicense(config, { onLost, fetchImpl = globalThis.fetch } = {}) {
  const { baseUrl, localBaseUrl, key } = endpoint(config)
  const requestId = randomBytes(24).toString('base64url')
  let leaseBaseUrl = null
  let token = null
  let expires = 0
  let renewTimer
  let expiryTimer
  let stopped = false

  async function post(target, action, body, auth, timeout = 5_000) {
    const headers = { Accept: 'application/json' }
    if (body) headers['Content-Type'] = 'application/json'
    if (auth) headers.Authorization = 'Bearer ' + auth
    let response
    try {
      response = await fetchImpl(target + '/v1/licenses/' + action, {
        method: 'POST',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      })
    } catch (cause) {
      throw new DesktopLicenseError('unreachable', { cause })
    }
    if (response.status === 204 && action === 'release') return null
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new DesktopLicenseError(typeof data?.code === 'string' ? data.code : 'service_error')
      error.status = response.status
      throw error
    }
    return data
  }

  async function selectBaseUrl() {
    if (!localBaseUrl || localBaseUrl === baseUrl) return baseUrl
    try {
      // Java rejects the array before opening a lease, so probing cannot consume a seat.
      await post(localBaseUrl, 'acquire', [], null, 800)
    } catch (error) {
      if (error.status === 400 && error.code === 'invalid_request') return localBaseUrl
    }
    return baseUrl
  }

  function clearTimers() {
    clearTimeout(renewTimer)
    clearTimeout(expiryTimer)
  }

  function lose(error) {
    if (stopped) return
    stopped = true
    clearTimers()
    onLost?.(error)
  }

  async function requestLease(action, target) {
    const challenge = randomBytes(24).toString('base64url')
    const started = performance.now()
    const result = await post(target, action, action === 'acquire' ? { requestId, challenge } : { challenge }, token)
    const next = acceptAssertion(result?.assertion, challenge, key, token)
    if (stopped) return
    leaseBaseUrl = target
    token = next.token
    expires = started + next.duration
    if (expires <= performance.now()) throw new DesktopLicenseError('lease_expired')
    clearTimers()
    expiryTimer = setTimeout(() => lose(new DesktopLicenseError('lease_expired')), expires - performance.now())
    renewTimer = setTimeout(renew, Math.min(30_000, Math.max(100, (expires - performance.now()) / 3)))
  }

  async function renew() {
    if (stopped) return
    try {
      await requestLease('renew', leaseBaseUrl)
    } catch (error) {
      if (stopped) return
      if (NON_RETRYABLE.has(error.code)) lose(error)
      else if (expires > performance.now()) renewTimer = setTimeout(renew, 2_000)
    }
  }

  return {
    async acquire() {
      const target = leaseBaseUrl ?? await selectBaseUrl()
      if (!stopped) await requestLease('acquire', target)
    },
    async release() {
      stopped = true
      clearTimers()
      if (!token) return
      const releasing = token
      token = null
      await post(leaseBaseUrl, 'release', null, releasing, 1_500).catch(() => {})
    },
  }
}

module.exports = { createDesktopLicense, DesktopLicenseError, normalizeLicenseServerUrl, normalizeLocalLicenseServerUrl }
