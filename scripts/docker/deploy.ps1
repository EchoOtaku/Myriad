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
  pull      docker compose pull
  logs      docker compose logs -f
  status    docker compose ps + image versions
  upgrade   Pull latest images per .env tags + recreate
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
        Write-Warn "scripts/migrate-to-updater.sh will fill MYRIAD_TAG / UPDATER_TAG / UPDATE_TOKEN."
        Write-Warn ""
        $r = Read-Host "Open .env in notepad? (y/N)"
        if ($r -match "^[Yy]$") {
            notepad .env
        }
    }
}

function Ensure-PgdataAndUpdater {
    $hasMyriadTag = $false
    if (Test-Path ".env") {
        $hasMyriadTag = (Select-String -Path .env -Pattern "^MYRIAD_TAG=" -Quiet)
    }
    if (-not (Test-Path "./pgdata") -or -not $hasMyriadTag) {
        Write-Info "==> Running scripts/migrate-to-updater.sh (idempotent)"
        if (Get-Command bash -ErrorAction SilentlyContinue) {
            $env:YES = "1"
            bash scripts/migrate-to-updater.sh
            Remove-Item Env:YES -ErrorAction SilentlyContinue
        } else {
            Write-Err "X bash not found. Install Git Bash or WSL, then run:"
            Write-Err "    YES=1 bash scripts/migrate-to-updater.sh"
            exit 2
        }
        Write-Host ""
    }
}

function Cmd-Up {
    Ensure-Env
    Ensure-PgdataAndUpdater
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
