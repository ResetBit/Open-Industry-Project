import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { normalizeLicenseServerUrl, normalizeLocalLicenseServerUrl } from '../../apps/desktop/desktopLicense.cjs'

const configFile = new URL('../../apps/desktop/license-config.json', import.meta.url)

function loadOrCreatePrivateKey(file) {
  try {
    return createPrivateKey(readFileSync(file))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const { privateKey } = generateKeyPairSync('ed25519')
  try {
    writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 })
    return privateKey
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    return createPrivateKey(readFileSync(file))
  }
}

function publicPem(key) {
  const publicKey = createPublicKey(key)
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Use an Ed25519 public key')
  return publicKey.export({ format: 'pem', type: 'spki' })
}

function prepareKeys(directory) {
  const folder = resolve(directory)
  mkdirSync(folder, { recursive: true })
  const privatePath = join(folder, 'license-private.pem')
  const publicPath = join(folder, 'license-public.pem')
  const publicKey = publicPem(loadOrCreatePrivateKey(privatePath))
  try {
    writeFileSync(publicPath, publicKey, { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (publicPem(readFileSync(publicPath)) !== publicKey) throw new Error('Existing public key does not match the private key')
  }
  console.log('Server private key: ' + privatePath)
  console.log('Desktop public key: ' + publicPath)
}

function prepareClient(serverUrl, keyFile, allowInsecureHttp = false, localUrl) {
  let publicKey
  if (serverUrl === '--local') {
    if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required for the Windows local trial')
    const dir = join(process.env.LOCALAPPDATA, 'OIP-License')
    mkdirSync(dir, { recursive: true })
    publicKey = publicPem(loadOrCreatePrivateKey(join(dir, 'trial-signing-key.pem')))
    serverUrl = 'http://127.0.0.1:19190'
  } else {
    publicKey = publicPem(readFileSync(keyFile))
  }
  const baseUrl = normalizeLicenseServerUrl(serverUrl, allowInsecureHttp)
  const config = { serverUrl: baseUrl, publicKey }
  if (localUrl !== undefined) config.localServerUrl = normalizeLocalLicenseServerUrl(localUrl)
  if (allowInsecureHttp && baseUrl.startsWith('http:')) config.allowInsecureHttp = true
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  console.log('Desktop authorization configuration set to ' + baseUrl)
}

const [mode, argument, ...options] = process.argv.slice(2)
if (mode === '--generate-keys' && argument && options.length === 0) {
  prepareKeys(argument)
} else if (mode === '--local' && !argument) {
  prepareClient(mode)
} else if (mode && !mode.startsWith('--') && argument) {
  const { values } = parseArgs({
    args: options,
    options: { 'allow-insecure-http': { type: 'boolean' }, 'local-url': { type: 'string' } },
  })
  prepareClient(mode, argument, values['allow-insecure-http'], values['local-url'])
} else {
  throw new Error('Usage: node server/license/prepare-client.mjs --generate-keys <directory> | --local | <base-url> <public-key-file> [--allow-insecure-http] [--local-url <loopback-url>]')
}
