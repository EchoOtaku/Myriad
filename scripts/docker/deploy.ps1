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
  doctor    Read-only topology / security checks (docker-guard, sock mounts, cosign)
  upgrade   Pull images pinned by .env tags + recreate
  help      Show this help

Notes:
  - Optional host audit (privileged / docker.sock binds):
      bash scripts/security/docker-audit-example.sh scan

Examples:
  .\deploy.ps1                 # Bootstrap + start
  .\deploy.ps1 down            # Stop
  .\deploy.ps1 status          # See running versions
  .\deploy.ps1 doctor          # Topology security checks
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
    Ensure-Key "MYRIAD_TAG" "v0.2.3"
    Ensure-Key "PROXY_TAG" "v0.2.3"
    Ensure-Key "UPDATER_TAG" "v0.2.3"
    Ensure-Key "COMPOSE_PROJECT_NAME" "myriad"
    Ensure-Key "CHANNEL" "stable"
    Ensure-Key "MYRIAD_GITHUB_REPO" "Myriad-You/Myriad"
    Ensure-Key "CHECK_INTERVAL_SECS" "3600"
    Ensure-Key "PROXY_ALLOW_DIRECT_UPDATER" "false"
    Ensure-UpdateToken
}

# Backend runs as uid 1000 (USER myriad). Named volumes are root-owned on first
# create; chown so /app/cache and /app/data stay writable without forcing root.
function Ensure-BackendVolumePerms {
    $project = "myriad"
    $match = Select-String -Path .env -Pattern "^COMPOSE_PROJECT_NAME=(.+)$" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
        $project = $match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
    }
    if ([string]::IsNullOrWhiteSpace($project)) { $project = "myriad" }

    $cacheVol = "${project}_backend_cache"
    $dataVol = "${project}_backend_data"

    Write-Info "==> Ensuring backend named volumes writable by uid 1000 (myriad)"
    docker volume create $cacheVol | Out-Null
    docker volume create $dataVol | Out-Null
    docker run --rm `
        -v "${cacheVol}:/app/cache" `
        -v "${dataVol}:/app/data" `
        alpine:3.20 `
        chown -R 1000:1000 /app/cache /app/data
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Could not chown backend volumes. If backend cannot write cache/data, run:"
        Write-Warn "  docker run --rm -v ${cacheVol}:/app/cache -v ${dataVol}:/app/data alpine:3.20 chown -R 1000:1000 /app/cache /app/data"
    }
}

# Soft (warn-only) topology check after successful up/upgrade. Never fails deploy.
function Cmd-SoftDoctor {
    Write-Info "==> Post-deploy topology soft-check (warn-only)"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        # Run doctor logic without exiting the process on FAIL.
        $fail = 0
        $skip = 0
        if (Test-ContainerExists "myriad-docker-guard") {
            if (-not (Test-ContainerMountsSock "myriad-docker-guard")) { $fail++ }
        } else {
            $fail++
        }
        if (Test-ContainerExists "myriad-updater") {
            if (Test-ContainerMountsSock "myriad-updater") { $fail++ }
        } else {
            $skip++
        }
        if ($fail -gt 0) {
            Write-Warn "Topology soft-check reported issues; run: .\deploy.ps1 doctor  for details"
        } else {
            Write-Ok "Topology soft-check passed (skip=$skip)."
        }
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Cmd-Up {
    Ensure-Env
    Ensure-CurrentLayout
    Ensure-BackendVolumePerms
    Write-Info "==> docker compose up -d"
    Invoke-Compose up -d
    Write-Host ""
    Write-Ok "Stack started. Admin UI: http://localhost/ -> Settings -> About -> Update Management"
    Cmd-SoftDoctor
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

function Test-ContainerExists([string]$Name) {
    docker inspect $Name 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-ContainerMountsSock([string]$Name) {
    $mounts = docker inspect -f '{{range .Mounts}}{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' $Name 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    return ($mounts -match 'docker\.sock')
}

function Get-ContainerHealth([string]$Name) {
    $h = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($h)) { return "unknown" }
    return $h.Trim()
}

function Get-EnvValue([string]$Key) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Select-String -Path .env -Pattern "^$Key=(.*)$" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $line) { return $null }
    return $line.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Test-EnvTruthy([string]$Key) {
    $v = Get-EnvValue $Key
    if ($null -eq $v) { return $false }
    return @("true", "1", "yes", "on") -contains $v.ToLowerInvariant()
}

# Read-only topology checks. Does not migrate or restart services.
function Cmd-Doctor {
    $fail = 0
    $skip = 0
    Write-Info "==> Deploy topology doctor (read-only)"

    if (Test-ContainerExists "myriad-docker-guard") {
        Write-Ok "PASS  myriad-docker-guard container exists"
        $gh = Get-ContainerHealth "myriad-docker-guard"
        if ($gh -eq "healthy" -or $gh -eq "running") {
            Write-Ok "PASS  docker-guard status=$gh"
        } else {
            Write-Err "FAIL  docker-guard status=$gh (expected healthy or running)"
            $fail++
        }
        if (Test-ContainerMountsSock "myriad-docker-guard") {
            Write-Ok "PASS  docker-guard mounts docker.sock"
        } else {
            Write-Err "FAIL  docker-guard does not mount docker.sock"
            $fail++
        }
    } else {
        Write-Err "FAIL  myriad-docker-guard not found (stack down or legacy pre-guard topology)"
        $fail++
    }

    if (Test-ContainerExists "myriad-updater") {
        Write-Ok "PASS  myriad-updater container exists"
        if (Test-ContainerMountsSock "myriad-updater") {
            Write-Err "FAIL  myriad-updater mounts docker.sock (legacy layout — sock should only be on docker-guard)"
            $fail++
        } else {
            Write-Ok "PASS  myriad-updater does not mount docker.sock"
        }
    } else {
        Write-Warn "SKIP  myriad-updater not running"
        $skip++
    }

    if (Test-Path ".env") {
        $cosign = Get-EnvValue "COSIGN_VERIFY"
        if ([string]::IsNullOrWhiteSpace($cosign)) { $cosign = "strict" }
        switch ($cosign.ToLowerInvariant()) {
            { $_ -in @("off", "false", "0") } {
                if ((Test-EnvTruthy "UPDATER_ALLOW_INSECURE_COSIGN") -or (Test-EnvTruthy "COSIGN_INSECURE_OK")) {
                    Write-Warn "WARN  COSIGN_VERIFY=$cosign with insecure allow key set (supply-chain risk)"
                } else {
                    Write-Err "FAIL  COSIGN_VERIFY=$cosign without UPDATER_ALLOW_INSECURE_COSIGN=true (updater refuses to start)"
                    $fail++
                }
            }
            { $_ -in @("soft", "warn") } {
                Write-Warn "WARN  COSIGN_VERIFY=$cosign (prefer strict for production)"
            }
            default {
                Write-Ok "PASS  COSIGN_VERIFY=$cosign"
            }
        }

        $direct = Get-EnvValue "PROXY_ALLOW_DIRECT_UPDATER"
        if ([string]::IsNullOrWhiteSpace($direct)) { $direct = "false" }
        if (@("true", "1", "yes", "on") -contains $direct.ToLowerInvariant()) {
            Write-Warn "WARN  PROXY_ALLOW_DIRECT_UPDATER=$direct (rescue path; keep false for normal ops)"
        } else {
            Write-Ok "PASS  PROXY_ALLOW_DIRECT_UPDATER=$direct"
        }
    } else {
        Write-Warn "SKIP  .env not found (cosign / direct-updater checks)"
        $skip++
    }

    Write-Host ""
    Write-Info "Optional host audit (not run automatically):"
    Write-Info "  bash scripts/security/docker-audit-example.sh scan"
    Write-Host ""
    if ($fail -gt 0) {
        Write-Err "Doctor: $fail check(s) failed (skip=$skip). Fix topology; this command does not auto-migrate."
        exit 1
    }
    Write-Ok "Doctor: all checks passed (skip=$skip)."
}

function Cmd-Upgrade {
    Ensure-Env
    Ensure-BackendVolumePerms
    Write-Info "==> docker compose pull"
    Invoke-Compose pull
    Write-Info "==> docker compose up -d (recreate with new tags)"
    Invoke-Compose up -d
    Write-Ok "Upgrade complete."
    Cmd-SoftDoctor
}

switch ($Command.ToLower()) {
    "up"      { Cmd-Up }
    "down"    { Cmd-Down }
    "restart" { Cmd-Restart }
    "pull"    { Cmd-Pull }
    "logs"    { Cmd-Logs }
    "status"  { Cmd-Status }
    "doctor"  { Cmd-Doctor }
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
