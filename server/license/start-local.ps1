$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$env:OIP_LICENSE_PRIVATE_KEY_FILE = Join-Path $env:LOCALAPPDATA 'OIP-License\trial-signing-key.pem'
if (!(Test-Path -LiteralPath $env:OIP_LICENSE_PRIVATE_KEY_FILE -PathType Leaf)) {
  throw 'The local trial license key was not provisioned on this computer.'
}
$env:OIP_LICENSE_ALLOWLIST = '127.0.0.1,::1'
$env:OIP_LICENSE_HOST = '127.0.0.1'
$env:OIP_LICENSE_PORT = '19190'
$env:OIP_LICENSE_MAX_SEATS = '30'
Push-Location -LiteralPath $root
try {
  $nodePath = volta which node
  if ($LASTEXITCODE -ne 0 -or !$nodePath) { throw 'Volta could not locate Node.js.' }
  & $nodePath '.\server\license\index.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'The license service could not start. Check the output.' }
} finally {
  Pop-Location
}
