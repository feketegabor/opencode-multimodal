$ErrorActionPreference = "Stop"

$stdin = ($input | Out-String)
if ([string]::IsNullOrWhiteSpace($stdin)) {
  exit 0
}

try {
  $payload = $stdin | ConvertFrom-Json -Depth 100
} catch {
  exit 0
}

$code = [string]$payload.tool_input.code
if ([string]::IsNullOrWhiteSpace($code)) {
  exit 0
}

$cacheChromeClient = '(?i)[\\/]plugins[\\/]cache[\\/]openai-bundled[\\/]chrome[\\/](?:latest|0\.1\.7)[\\/]scripts[\\/]browser-client\.mjs'
$browserUseExtensionBackend = '(?is)browser-use[\\/]0\.1\.0-alpha2[\\/]scripts[\\/]browser-client\.mjs.*agent\.browsers\.get\(\s*[''"]extension[''"]\s*\)'
$wrongBackend = '(?i)agent\.browsers\.get\(\s*[''"]chrome[''"]\s*\)'

if ($code -match $cacheChromeClient -or $code -match $browserUseExtensionBackend -or $code -match $wrongBackend) {
  $reason = @"
@chrome: import .codex/.tmp/bundled-marketplaces/openai-bundled/plugins/chrome/scripts/browser-client.mjs, use agent.browsers.get('extension'), screenshots via tab.cua.get_visible_screenshot().
"@

  @{
    hookSpecificOutput = @{
      hookEventName = "PreToolUse"
      permissionDecision = "deny"
      permissionDecisionReason = $reason.Trim()
    }
  } | ConvertTo-Json -Depth 10 -Compress
  exit 0
}

exit 0
