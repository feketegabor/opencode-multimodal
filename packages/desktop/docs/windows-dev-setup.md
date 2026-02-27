# Windows Desktop Dev Setup

This project intentionally uses a plain Tauri command (`tauri`) in `packages/desktop/package.json`.
Environment setup is expected to be done by the developer machine, not in repo wrapper scripts.

## What must be available

1. Bun (`bun --version`)
2. Rust/Cargo (`rustc -V`, `cargo -V`)
3. Tauri CLI (`tauri -V` or `bun --cwd packages/desktop tauri -V`)
4. MinGW tools on `PATH` (`windres`, `dlltool`, `gcc`)

Quick check:

```powershell
where.exe windres
where.exe gcc
```

Expected paths typically look like:

`C:\msys64\mingw64\bin\windres.exe`

## Required environment values

- `PATH` must include `C:\msys64\mingw64\bin`.
- Target should be passed explicitly as MSVC when starting Tauri dev:
  - `--target x86_64-pc-windows-msvc`
- Optional (recommended for Gemini Files API uploads with OAuth model auth):
  - `GOOGLE_FILES_API_KEY` (used only for media upload start/finalize requests)

## Setup options

### Option A: One terminal session (PowerShell)

Use this when you just want to run dev now:

```powershell
$env:PATH = "C:\msys64\mingw64\bin;$env:PATH"
bun --cwd packages/desktop tauri dev --target x86_64-pc-windows-msvc
```

### Option B: Persistent user environment (recommended)

```powershell
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
[Environment]::SetEnvironmentVariable("PATH", "C:\msys64\mingw64\bin;$userPath", "User")
```

Then open a new terminal and run:

```powershell
bun --cwd packages/desktop tauri dev --target x86_64-pc-windows-msvc
```

1) Kill stale dev processes (safe for this repo)
```powershell
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -in @('opencode-desktop.exe','opencode-cli.exe','cargo.exe','rustc.exe','bun.exe','vite.exe') -and
    $_.CommandLine -match 'opencode-multimodal'
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

2) Start with logging
```powershell
$env:Path = "C:\msys64\mingw64\bin;$env:Path"
$env:RUST_LOG = "opencode_lib=debug,opencode_desktop=debug,sidecar=debug"
bun --cwd packages/desktop tauri dev --target x86_64-pc-windows-msvc 2>&1 | Tee-Object .codex-devdesktop.log
```

cli.rs (--print-logs --log-level WARN serve)
Desktop log file setup is in logging.rs and written under:
opencode-desktop_*.log

## Common errors

### `program not found ... windres`

Cause: MinGW tools are not on `PATH`.

Fix: add `C:\msys64\mingw64\bin` to `PATH` (Option A or B above).

### `Sidecar configuration not available for Rust target '...'`

Cause: target triple does not match any configured sidecar mapping.

Fix: start with `--target x86_64-pc-windows-msvc`, and if needed set `RUST_TARGET=x86_64-pc-windows-msvc` for scripts that read it.
