# =============================================================================
# Myriad Docker Unified Deployment Script (PowerShell)
# =============================================================================
# Brings up the full stack (proxy + frontend + backend + postgres + updater)
# defined in docker-compose.yml.
#
# After bootstrap, normal day-to-day updates run through the admin UI:
#   Settings -> About -> Update Management
# See docs/UPDATER_QUICKSTART.md.
# =============================================================================

param(
    [Parameter(Position = 0)]
    [string]$Command = "up"
)

$ErrorActionPreference = "Stop"

function Write-Color($c) { $f = $host.UI.RawUI.ForegroundColor; $host.UI.RawUI.ForegroundColor = $c; if ($args) { Write-Output $args }; $host.UI.RawUI.ForegroundColor = $f }
function Write-Ok    { Write-Color Green $args }
function Write-Info  { Write-Color Cyan $args }
function Write-Warn  { Write-Color Yellow $args }
function Write-Err   { Write-Color Red $args }

# Change to repo root.
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

function Show-Usage {
    @"
Usage: deploy.ps1 [command]

Commands:
  up        (default) Initialise .env / pgdata if needed, then `docker compose up -d`
  down      Stop and remove containers (volumes preserved)
  restart   docker compose restart
  pull      Pull images pinned by .env tags
  logs      docker compose logs -f
  status    docker compose ps + image versions
  upgrade   Pull images pinned by .env tags + recreate
  help      Show this help

Examples:
  .\deploy.ps1                 # Bootstrap + start
  .\deploy.ps1 down            # Stop
  .\deploy.ps1 status          # See running versions
"@ | Write-Host
}

function Get-ComposeCmd {
    docker compose version 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return "docker compose" }
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) { return "docker-compose" }
    Write-Err "X Neither 'docker compose' nor 'docker-compose' is available"
    exit 2
}

function Invoke-Compose {
    $cmd = (Get-ComposeCmd) -split " "
    & $cmd[0] @($cmd[1..($cmd.Count - 1)]) @args
}

function New-Secret {
    $bytes = New-Object byte[] 36
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Ensure-Key($key, $default) {
    if (-not (Select-String -Path .env -Pattern "^$key=" -Quiet -ErrorAction SilentlyContinue)) {
        Add-Content -Path .env -Value "$key=$default"
        Write-Info "  + appended $key"
    }
}

function Ensure-UpdateToken {
    if (Select-String -Path .env -Pattern "^UPDATE_TOKEN=.+" -Quiet -ErrorAction SilentlyContinue) {
        return
    }

    $token = New-Secret
    if (Select-String -Path .env -Pattern "^UPDATE_TOKEN=" -Quiet -ErrorAction SilentlyContinue) {
        $lines = Get-Content .env
        $replaced = $false
        $lines = $lines | ForEach-Object {
            if (-not $replaced -and $_ -match "^UPDATE_TOKEN=") {
                $replaced = $true
                "UPDATE_TOKEN=$token"
            } else {
                $_
            }
        }
        Set-Content -Path .env -Value $lines
        Write-Info "  + filled empty UPDATE_TOKEN"
    } else {
        Add-Content -Path .env -Value "UPDATE_TOKEN=$token"
        Write-Info "  + appended UPDATE_TOKEN"
    }
}

function Ensure-Env {
    if (-not (Test-Path ".env")) {
        if (-not (Test-Path ".env.production.example")) {
            Write-Err "X Missing both .env and .env.production.example"
            exit 2
        }
        Write-Warn ".env not found - copying from .env.production.example"
        Copy-Item ".env.production.example" ".env"
        Write-Warn ""
        Write-Warn "Edit .env now and set at minimum:"
        Write-Warn "  - POSTGRES_PASSWORD"
        Write-Warn "  - JWT_SECRET"
        Write-Warn "  - CORS_ORIGINS"
        Write-Warn ""
        Write-Warn "This script will create pgdata/state/backups and fill an empty UPDATE_TOKEN."
        Write-Warn ""
        $r = Read-Host "Open .env in notepad? (y/N)"
        if ($r -match "^[Yy]$") {
            notepad .env
        }
    }
}

function Ensure-CurrentLayout {
    Write-Info "==> Ensuring current proxy + updater layout"
    New-Item -ItemType Directory -Force -Path pgdata, state, state/snapshots, state/cache, backups | Out-Null
    Ensure-Key "MYRIAD_TAG" "v0.2.2"
    Ensure-Key "PROXY_TAG" "v0.2.2"
    Ensure-Key "UPDATER_TAG" "v0.2.2"
    Ensure-Key "COMPOSE_PROJECT_NAME" "myriad"
    Ensure-Key "CHANNEL" "stable"
    Ensure-Key "MYRIAD_GITHUB_REPO" "Myriad-You/Myriad"
    Ensure-Key "CHECK_INTERVAL_SECS" "3600"
    Ensure-Key "PROXY_ALLOW_DIRECT_UPDATER" "false"
    Ensure-UpdateToken
}

function Cmd-Up {
    Ensure-Env
    Ensure-CurrentLayout
    Write-Info "==> docker compose up -d"
    Invoke-Compose up -d
    Write-Host ""
    Write-Ok "Stack started. Admin UI: http://localhost/ -> Settings -> About -> Update Management"
}

function Cmd-Down     { Write-Info "==> docker compose down"; Invoke-Compose down }
function Cmd-Restart  { Write-Info "==> docker compose restart"; Invoke-Compose restart }
function Cmd-Pull     { Write-Info "==> docker compose pull"; Invoke-Compose pull }
function Cmd-Logs     { Invoke-Compose logs -f --tail=200 }
function Cmd-Status {
    Invoke-Compose ps
    Write-Host ""
    Write-Info "Image versions in use:"
    Invoke-Compose images 2>$null
    if ($LASTEXITCODE -ne 0) { Invoke-Compose ps --format "table {{.Service}}`t{{.Image}}" }
}
function Cmd-Upgrade {
    Ensure-Env
    Write-Info "==> docker compose pull"
    Invoke-Compose pull
    Write-Info "==> docker compose up -d (recreate with new tags)"
    Invoke-Compose up -d
    Write-Ok "Upgrade complete."
}

switch ($Command.ToLower()) {
    "up"      { Cmd-Up }
    "down"    { Cmd-Down }
    "restart" { Cmd-Restart }
    "pull"    { Cmd-Pull }
    "logs"    { Cmd-Logs }
    "status"  { Cmd-Status }
    "upgrade" { Cmd-Upgrade }
    "help"    { Show-Usage }
    "-h"      { Show-Usage }
    "--help"  { Show-Usage }
    default {
        Write-Err "Unknown command: $Command"
        Show-Usage
        exit 1
    }
}
