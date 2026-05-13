$ErrorActionPreference = "SilentlyContinue"

$stdin = ($input | Out-String)
if ([string]::IsNullOrWhiteSpace($stdin)) {
  exit 0
}

try {
  $payload = $stdin | ConvertFrom-Json -Depth 100
} catch {
  exit 0
}

$toolInput = $payload.tool_input
if ($null -eq $toolInput) {
  $toolInput = $payload.toolInput
}

$command = [string]$toolInput.command
if ($command -notmatch '(?i)(^|[\s;&|])opensrc(\.cmd|\.ps1|\.exe)?\b') {
  exit 0
}

& (Join-Path $PSScriptRoot "sync_opensrc_serena.ps1") | Out-Null
