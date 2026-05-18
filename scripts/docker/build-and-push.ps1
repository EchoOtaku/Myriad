# =============================================================================
# Myriad Docker Image Build and Push Script (PowerShell)
# =============================================================================
# Build and push backend / frontend / proxy / updater images.
#
# Production releases should prefer the release.yml GitHub Actions workflow
# (push a v* tag). This script is for local Dockerfile validation, private
# registries, and offline environments.
# =============================================================================

param(
    [string]$Registry = "docker.io",
    [string]$Username = "",
    [string]$Tag = "",
    [switch]$Push = $false,
    [switch]$Backend,
    [switch]$Frontend,
    [switch]$Proxy,
    [switch]$Updater,
    [switch]$All,
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$ProxyOnly,
    [switch]$UpdaterOnly,
    [switch]$NoBuildCache = $false
)

$ErrorActionPreference = "Stop"

function Write-Color($c) { $f = $host.UI.RawUI.ForegroundColor; $host.UI.RawUI.ForegroundColor = $c; if ($args) { Write-Output $args }; $host.UI.RawUI.ForegroundColor = $f }
function Write-Success { Write-Color Green $args }
function Write-Info { Write-Color Cyan $args }
function Write-Warn { Write-Color Yellow $args }
function Write-Err { Write-Color Red $args }

function Show-Banner {
    Write-Info "==========================================="
    Write-Info "   Myriad Docker Image Build & Push Tool"
    Write-Info "==========================================="
    Write-Warn "Production releases: push a v* git tag to trigger release.yml."
    Write-Host ""
}

function Get-Version {
    if (Test-Path "backend/Cargo.toml") {
        $line = (Get-Content "backend/Cargo.toml" | Where-Object { $_ -match '^version\s*=\s*"([^"]+)"' } | Select-Object -First 1)
        if ($line -match '"([^"]+)"') {
            return "v$($matches[1])"
        }
    }
    return "v0.0.0-dev"
}

function Test-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Err "X Docker not found. Install: https://docs.docker.com/engine/install/"
        exit 1
    }
    Write-Success "Docker is available"
}

function Invoke-DockerLogin($registry, $username) {
    if (-not $username) { return $true }
    Write-Info "Logging in to $registry ..."
    docker login $registry -u $username
    if ($LASTEXITCODE -ne 0) { Write-Err "Login failed"; return $false }
    Write-Success "Login OK"; return $true
}

function Build-One($service, $dockerfile, $imageName, $myriadVersion) {
    if (-not (Test-Path $dockerfile)) {
        Write-Warn "X $dockerfile not present; skipping $service"
        return $false
    }
    Write-Info "Building $service -> $imageName"
    $args = @("build", "-f", $dockerfile, "-t", $imageName, "--build-arg", "MYRIAD_VERSION=$myriadVersion")
    if ($NoBuildCache) { $args += "--no-cache" }
    $args += "."
    docker @args
    if ($LASTEXITCODE -ne 0) { Write-Err "X $service build failed"; return $false }
    Write-Success "$service build OK"
    return $true
}

function Push-One($imageName) {
    Write-Info "Push: $imageName"
    docker push $imageName
    if ($LASTEXITCODE -ne 0) { Write-Err "X push failed"; return $false }
    Write-Success "Push OK"; return $true
}

# ---------- main ----------

Show-Banner
Test-Docker

# Resolve which targets to build.
$buildBackend  = $true
$buildFrontend = $true
$buildProxy    = $false
$buildUpdater  = $false

if ($Backend)     { $buildBackend  = $true }
if ($Frontend)    { $buildFrontend = $true }
if ($Proxy)       { $buildProxy    = $true }
if ($Updater)     { $buildUpdater  = $true }
if ($All)         { $buildBackend = $true; $buildFrontend = $true; $buildProxy = $true; $buildUpdater = $true }
if ($BackendOnly) { $buildBackend = $true; $buildFrontend = $false; $buildProxy = $false; $buildUpdater = $false }
if ($FrontendOnly) { $buildBackend = $false; $buildFrontend = $true; $buildProxy = $false; $buildUpdater = $false }
if ($ProxyOnly)   { $buildBackend = $false; $buildFrontend = $false; $buildProxy = $true; $buildUpdater = $false }
if ($UpdaterOnly) { $buildBackend = $false; $buildFrontend = $false; $buildProxy = $false; $buildUpdater = $true }

if ($Push -and -not $Username) {
    $Username = Read-Host "Registry username"
    if (-not $Username) { Write-Err "Push requires username"; exit 1 }
}

$myriadVersion = Get-Version
if (-not $Tag) { $Tag = $myriadVersion }
Write-Info "Version: $myriadVersion  Tag: $Tag"
Write-Host ""

if ($Push) {
    if (-not (Invoke-DockerLogin $Registry $Username)) { exit 1 }
    Write-Host ""
}

$targets = @(
    @{ name = "backend";  file = "docker/Dockerfile.backend";  enabled = $buildBackend  },
    @{ name = "frontend"; file = "docker/Dockerfile.frontend"; enabled = $buildFrontend },
    @{ name = "proxy";    file = "proxy/Dockerfile";           enabled = $buildProxy    },
    @{ name = "updater";  file = "updater/Dockerfile";         enabled = $buildUpdater  }
)

$built = @()
foreach ($t in $targets) {
    if (-not $t.enabled) { continue }
    $image = "$Registry/$Username/myriad-$($t.name):$Tag"
    Write-Host "========== $($t.name) =========="
    if (Build-One $t.name $t.file $image $myriadVersion) {
        $built += $image
    } else {
        Write-Err "Build failed for $($t.name)"; exit 1
    }
    Write-Host ""
}

if ($Push) {
    Write-Host "========== Push =========="
    foreach ($img in $built) {
        if (-not (Push-One $img)) { exit 1 }
    }
}

Write-Host ""
Write-Success "==========================================="
Write-Success "         Done"
Write-Success "==========================================="
foreach ($img in $built) { Write-Host "  $img" }
Write-Host ""
if (-not $Push) { Write-Info "Use -Push to push to registry" }
