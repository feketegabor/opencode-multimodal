$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$opensrcRoot = Join-Path $repoRoot "opensrc"
$sourcesPath = Join-Path $opensrcRoot "sources.json"
$globalConfigPath = Join-Path $env:USERPROFILE ".serena\serena_config.yml"

if (-not (Test-Path -LiteralPath $sourcesPath)) {
  exit 0
}

function Get-ProjectName($name, $path) {
  $raw = if ([string]::IsNullOrWhiteSpace($name)) { $path } else { $name }
  $raw = $raw -replace '^github\.com/', ''
  $safe = ($raw -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($safe)) {
    $safe = "reference"
  }
  "opensrc-$safe"
}

function Get-Languages($root) {
  $files = @(& rg --files $root 2>$null | Select-Object -First 20000)
  $langs = [ordered]@{}

  foreach ($file in $files) {
    $lower = $file.ToLowerInvariant()
    switch -Regex ($lower) {
      '\.(al|dal)$' { $langs["al"] = $true; continue }
      '\.(ads|adb|ada)$' { $langs["ada"] = $true; continue }
      '\.(bsl|os)$' { $langs["bsl"] = $true; continue }
      '\.(sh|bash)$' { $langs["bash"] = $true; continue }
      '\.clj[sc]?$|\.edn$' { $langs["clojure"] = $true; continue }
      '\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$' { $langs["cpp"] = $true; continue }
      '\.cs$' { $langs["csharp"] = $true; continue }
      '\.cr$' { $langs["crystal"] = $true; continue }
      '\.dart$' { $langs["dart"] = $true; continue }
      '\.elm$' { $langs["elm"] = $true; continue }
      '\.(ex|exs)$' { $langs["elixir"] = $true; continue }
      '\.(erl|hrl|escript|config|app|app\.src)$' { $langs["erlang"] = $true; continue }
      '\.(fs|fsx|fsi)$' { $langs["fsharp"] = $true; continue }
      '\.(f90|f95|f03|f08|f|for|fpp)$' { $langs["fortran"] = $true; continue }
      '\.go$' { $langs["go"] = $true; continue }
      '\.(groovy|gvy)$' { $langs["groovy"] = $true; continue }
      '\.(hs|lhs)$' { $langs["haskell"] = $true; continue }
      '\.hx$' { $langs["haxe"] = $true; continue }
      '\.(html|htm)$' { $langs["html"] = $true; continue }
      '\.(hlsl|hlsli|fx|fxh|cginc|compute|shader|glsl|vert|frag|geom|tesc|tese|comp|wgsl)$' { $langs["hlsl"] = $true; continue }
      '\.java$' { $langs["java"] = $true; continue }
      '\.jl$' { $langs["julia"] = $true; continue }
      '\.(kt|kts)$' { $langs["kotlin"] = $true; continue }
      '\.lean$' { $langs["lean4"] = $true; continue }
      '\.lua$' { $langs["lua"] = $true; continue }
      '\.luau$' { $langs["luau"] = $true; continue }
      '\.(m|mlx|mlapp)$' { $langs["matlab"] = $true; continue }
      '\.(md|mdx|markdown)$' { $langs["markdown"] = $true; continue }
      '\.mrc$' { $langs["msl"] = $true; continue }
      '\.nix$' { $langs["nix"] = $true; continue }
      '\.(ml|mli|re|rei)$' { $langs["ocaml"] = $true; continue }
      '\.(pas|pp|lpr|dpr|dpk|inc)$' { $langs["pascal"] = $true; continue }
      '\.php$' { $langs["php"] = $true; continue }
      '\.(pl|pm|t)$' { $langs["perl"] = $true; continue }
      '\.(ps1|psm1|psd1)$' { $langs["powershell"] = $true; continue }
      '\.pyi?$' { $langs["python"] = $true; continue }
      '\.(r|rmd|rnw)$' { $langs["r"] = $true; continue }
      '\.rego$' { $langs["rego"] = $true; continue }
      '\.rb$|\.erb$' { $langs["ruby"] = $true; continue }
      '\.rs$' { $langs["rust"] = $true; continue }
      '\.(scala|sbt)$' { $langs["scala"] = $true; continue }
      '\.(scss|sass|css)$' { $langs["scss"] = $true; continue }
      '\.sol$' { $langs["solidity"] = $true; continue }
      '\.(sv|svh|v|vh)$' { $langs["systemverilog"] = $true; continue }
      '\.swift$' { $langs["swift"] = $true; continue }
      '\.(tf|tfvars|tfstate)$' { $langs["terraform"] = $true; continue }
      '\.(ts|tsx|js|jsx|mts|mjs|cts|cjs|svelte|astro)$' { $langs["typescript"] = $true; continue }
      '\.vue$' { $langs["vue"] = $true; continue }
      '\.(yaml|yml)$' { $langs["yaml"] = $true; continue }
      '\.(zig|zon)$' { $langs["zig"] = $true; continue }
      '\.(json|jsonc)$' { $langs["json"] = $true; continue }
      '\.toml$' { $langs["toml"] = $true; continue }
    }
  }

  if ($langs.Count -eq 0) {
    $langs["markdown"] = $true
  }

  @($langs.Keys)
}

function Write-SerenaProject {
  param(
    [string]$projectRoot,
    [string]$projectName,
    [string[]]$languages
  )

  $serenaDir = Join-Path $projectRoot ".serena"
  $projectPath = Join-Path $serenaDir "project.yml"
  New-Item -ItemType Directory -Force -Path $serenaDir | Out-Null

  $languageLines = ($languages | ForEach-Object { "- $_" }) -join "`n"
  $content = @"
project_name: "$projectName"
languages:
$languageLines
encoding: "utf-8"
ignored_paths: []
read_only: true
excluded_tools:
- check_onboarding_performed
- delete_memory
- edit_memory
- list_memories
- onboarding
- open_dashboard
- read_memory
- rename_memory
- write_memory
included_optional_tools: []
initial_prompt: ""
project_name_placeholder: ""
default_modes:
- interactive
- no-memories
- no-onboarding
read_only_memory_patterns: []
ignored_memories: []
"@

  Set-Content -LiteralPath $projectPath -Value $content -Encoding UTF8
}

function Add-GlobalSerenaProjects($paths) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $globalConfigPath) | Out-Null
  if (-not (Test-Path -LiteralPath $globalConfigPath)) {
    Set-Content -LiteralPath $globalConfigPath -Value "projects:" -Encoding UTF8
  }

  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in Get-Content -LiteralPath $globalConfigPath) {
    $lines.Add($line)
  }

  $projectIndex = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^projects:\s*$') {
      $projectIndex = $i
      break
    }
  }

  if ($projectIndex -lt 0) {
    $lines.Add("")
    $lines.Add("projects:")
    $projectIndex = $lines.Count - 1
  }

  $insertAt = $projectIndex + 1
  while ($insertAt -lt $lines.Count -and $lines[$insertAt] -match '^- ') {
    $insertAt++
  }

  foreach ($path in $paths) {
    $entry = "- $path"
    if (-not ($lines | Where-Object { $_ -eq $entry })) {
      $lines.Insert($insertAt, $entry)
      $insertAt++
    }
  }

  Set-Content -LiteralPath $globalConfigPath -Value $lines -Encoding UTF8
}

$sources = Get-Content -LiteralPath $sourcesPath -Raw | ConvertFrom-Json
$items = @()
if ($sources.packages) { $items += @($sources.packages) }
if ($sources.repos) { $items += @($sources.repos) }

$paths = [System.Collections.Generic.List[string]]::new()
$seen = @{}

foreach ($item in $items) {
  if ([string]::IsNullOrWhiteSpace($item.path)) {
    continue
  }

  $projectRoot = Join-Path $opensrcRoot $item.path
  if (-not (Test-Path -LiteralPath $projectRoot)) {
    continue
  }

  $resolved = (Resolve-Path -LiteralPath $projectRoot).Path
  if ($seen.ContainsKey($resolved)) {
    continue
  }
  $seen[$resolved] = $true

  $name = Get-ProjectName $item.name $item.path
  $languages = Get-Languages $resolved
  Write-SerenaProject -projectRoot $resolved -projectName $name -languages $languages
  $paths.Add($resolved)
}

Add-GlobalSerenaProjects $paths
