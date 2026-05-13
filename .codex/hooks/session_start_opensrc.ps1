$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$root = Join-Path $repoRoot "opensrc"
$sources = Join-Path $root "sources.json"

if (-not (Test-Path -LiteralPath $sources)) {
  exit 0
}

try {
  $data = Get-Content -Raw -LiteralPath $sources | ConvertFrom-Json -Depth 20
} catch {
  exit 0
}

$packageCount = @($data.packages).Count
$repoCount = @($data.repos).Count
$updatedAt = [string]$data.updatedAt

$context = "OpenSRC: local reference source in $root; sources.json has $packageCount packages, $repoCount repos; updated $updatedAt. Serena: activate the task repository; for OpenSRC work, activate that repo path; memory/onboarding tools are disabled."

@{
  hookSpecificOutput = @{
    hookEventName = "SessionStart"
    additionalContext = $context
  }
} | ConvertTo-Json -Depth 10 -Compress
