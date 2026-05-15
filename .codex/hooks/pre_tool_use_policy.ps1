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

$toolName = [string]$payload.tool_name
if ([string]::IsNullOrWhiteSpace($toolName)) {
  $toolName = [string]$payload.toolName
}
if ($toolName -notmatch '(?i)(shell_command|functions\.shell_command|^shell$|^bash$)') {
  exit 0
}

$toolInput = $payload.tool_input
if ($null -eq $toolInput) {
  $toolInput = $payload.toolInput
}

$command = [string]$toolInput.command
if ([string]::IsNullOrWhiteSpace($command)) {
  exit 0
}

function New-Deny($reason) {
  @{
    hookSpecificOutput = @{
      hookEventName = "PreToolUse"
      permissionDecision = "deny"
      permissionDecisionReason = $reason
    }
  } | ConvertTo-Json -Depth 10 -Compress
}

$hasRg = $command -match '(?i)(^|[\s;&|])rg(\.exe)?\b'
if ($hasRg) {
  $isCountOnly = $command -match '(?i)(^|[\s])(--count|--count-matches|-c)([\s]|$)'
  $hasOutputLimit = $command -match '(?i)(\|\s*(Select-Object|select)\s+-(First|Last)\s+\d+\b|\|\s*head(\.exe)?\s+-n\s+\d+\b)'
  $redirectsOutput = $command -match '(?i)(^|[\s])(--output(=|\s+)\S+|>\s*\S+|\|\s*(Out-File|Set-Content|Add-Content)\b)'
  $isHelpOrVersion = $command -match '(?i)(^|[\s])(--help|-h|--version|-V)([\s]|$)'
  $allowBroadRg = [Environment]::GetEnvironmentVariable("OPENCODE_ALLOW_BROAD_RG") -eq "1" -or
    $command -match 'OPENCODE_ALLOW_BROAD_RG\s*=\s*[''"]?1'

  if (-not ($isCountOnly -or $hasOutputLimit -or $redirectsOutput -or $isHelpOrVersion -or $allowBroadRg)) {
    New-Deny "Use Serena for structure; bound rg search output. Explorer: OPENCODE_ALLOW_BROAD_RG=1."
    exit 0
  }

  if ($command -match '(?i)(^|[\s;&|])rg(\.exe)?\s+--files\b' -and -not ($hasOutputLimit -or $redirectsOutput -or $allowBroadRg)) {
    New-Deny "Bound rg --files or redirect. Explorer: OPENCODE_ALLOW_BROAD_RG=1."
    exit 0
  }
}

$checks = @(
  @{
    Pattern = '(?i)(^|[\s;&|])(Select-String|sls)\b'
    Reason = 'Use bounded rg for search.'
    AllowEnv = 'OPENCODE_ALLOW_SELECT_STRING'
    AllowRg = $true
  },
  @{
    Pattern = '(?i)(^|[\s;&|])(Get-Content|gc|cat|type|more)(\.exe)?\b'
    Reason = 'Use Serena for structure; bound reads except SKILL.md.'
    AllowEnv = 'OPENCODE_ALLOW_FULL_READ'
    AllowRg = $true
    AllowPattern = '(?i)(^|[\s;&|])rg(\.exe)?\b|-TotalCount\b|-Tail\b|(^|[\s;&|])(Select-Object|select)\s+-(First|Last)\b|(^|[\s''"]|\\)SKILL\.md([\s''"]|$)'
  },
  @{
    Pattern = '(?i)(^|[\s;&|])Get-ChildItem\b'
    Reason = 'Use bounded rg --files, not GCI.'
    AllowEnv = 'OPENCODE_ALLOW_GCI'
    AllowRg = $true
  },
  @{
    Pattern = '(?i)(^|[\s;&|])(gci|ls|dir)(\.exe)?(?=\s|$)'
    Reason = 'Use bounded rg --files, not listing aliases.'
    AllowEnv = 'OPENCODE_ALLOW_LISTING'
    AllowRg = $true
  },
  @{
    Pattern = '(?i)(^|[\s;&|])findstr(\.exe)?\b'
    Reason = 'Use bounded rg, not findstr.'
    AllowEnv = 'OPENCODE_ALLOW_FINDSTR'
    AllowRg = $true
  },
  @{
    Pattern = '(?i)(^|[\s;&|])find(\.exe)?\b'
    Reason = 'Use bounded rg, not find.'
    AllowEnv = 'OPENCODE_ALLOW_FIND'
    AllowRg = $true
  },
  @{
    Pattern = '(?i)(^|[\s;&|])where(\.exe)?\s+/r\b'
    Reason = 'Use bounded rg --files, not where /r.'
    AllowEnv = 'OPENCODE_ALLOW_WHERE_R'
    AllowRg = $true
  },
  @{
    Pattern = '(?i)(^|[\s;&|])cmd(\.exe)?\s+/c\s+dir\b.*\s/s\b'
    Reason = 'Use bounded rg --files, not dir /s.'
    AllowEnv = 'OPENCODE_ALLOW_CMD_DIR_S'
    AllowRg = $true
  },
  @{
    Pattern = '(?i)(^|[\s;&|])grep(\.exe)?\b'
    Reason = 'Use bounded rg, not grep.'
    AllowEnv = 'OPENCODE_ALLOW_GREP'
    AllowRg = $true
  },
  @{
    Pattern = '(?i)(^|[\s;&|])git(\.exe)?\s+worktree\b'
    Reason = 'No worktrees. Override: OPENCODE_ALLOW_WORKTREE=1.'
    AllowEnv = 'OPENCODE_ALLOW_WORKTREE'
    AllowRg = $false
  },
  @{
    Pattern = '(?i)(^|[\s;&|])git(\.exe)?\s+clone\b'
    Reason = 'Use opensrc. Override: OPENCODE_ALLOW_GIT_CLONE=1.'
    AllowEnv = 'OPENCODE_ALLOW_GIT_CLONE'
    AllowRg = $false
  }
)

foreach ($check in $checks) {
  $allowEnv = [string]$check["AllowEnv"]
  $isAllowedByEnv = -not [string]::IsNullOrWhiteSpace($allowEnv) -and (
    [Environment]::GetEnvironmentVariable($allowEnv) -eq "1" -or
    $command -match ([regex]::Escape($allowEnv) + '\s*=\s*[''"]?1')
  )
  $isAllowedByRg = [bool]$check["AllowRg"] -and $command -match '(?i)(^|[\s;&|])rg(\.exe)?\b'
  $allowPattern = [string]$check["AllowPattern"]
  $isAllowedByPattern = -not [string]::IsNullOrWhiteSpace($allowPattern) -and $command -match $allowPattern
  if ($command -match $check["Pattern"] -and -not $isAllowedByRg -and -not $isAllowedByEnv -and -not $isAllowedByPattern) {
    New-Deny $check["Reason"]
    exit 0
  }
}

exit 0
