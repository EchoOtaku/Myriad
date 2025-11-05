# =============================================================================
# Myriad Docker Image Build and Push Script
# =============================================================================
# Build Docker images and push to Docker Hub or other registries
# =============================================================================

param(
    [string]$Registry = "docker.io",
    [string]$Username = "",
    [string]$Tag = "latest",
    [switch]$Push = $false,
    [switch]$SkipBackend = $false,
    [switch]$SkipFrontend = $false,
    [switch]$NoBuildCache = $false
)

$ErrorActionPreference = "Stop"

# Color output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Success { Write-ColorOutput Green $args }
function Write-Info { Write-ColorOutput Cyan $args }
function Write-Warning { Write-ColorOutput Yellow $args }
function Write-Error { Write-ColorOutput Red $args }

# Show banner
function Show-Banner {
    Write-Info "==========================================="
    Write-Info "   Myriad Docker Image Build & Push Tool"
    Write-Info "==========================================="
    Write-Host ""
}

# Get version info
function Get-Version {
    # Read version from Cargo.toml
    if (Test-Path "backend/Cargo.toml") {
        $cargoContent = Get-Content "backend/Cargo.toml" -Raw
        if ($cargoContent -match 'version\s*=\s*"([^"]+)"') {
            return $Matches[1]
        }
    }
    return "latest"
}

# Check Docker
function Test-Docker {
    Write-Info "Checking Docker environment..."
    try {
        $null = docker --version
        Write-Success "[OK] Docker is installed"
        return $true
    }
    catch {
        Write-Error "[ERROR] Docker not found"
        Write-Error "Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
        return $false
    }
}

# Docker login
function Connect-Registry {
    param([string]$registry, [string]$username)
    
    if ([string]::IsNullOrEmpty($username)) {
        Write-Warning "Username not provided, skipping login"
        return $true
    }
    
    Write-Info "Logging in to $registry..."
    try {
        docker login $registry -u $username
        if ($LASTEXITCODE -eq 0) {
            Write-Success "[OK] Login successful"
            return $true
        }
    }
    catch {
        Write-Error "[ERROR] Login failed"
        return $false
    }
    return $false
}

# Build image
function Invoke-ImageBuild {
    param(
        [string]$service,
        [string]$dockerfile,
        [string]$imageName,
        [bool]$noCache
    )
    
    Write-Info "Building $service image..."
    Write-Info "  Image name: $imageName"
    Write-Info "  Dockerfile: $dockerfile"
    
    $buildArgs = @(
        "build",
        "-f", $dockerfile,
        "-t", $imageName,
        "."
    )
    
    if ($noCache) {
        $buildArgs += "--no-cache"
    }
    
    Write-Host ""
    & docker $buildArgs
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[ERROR] $service build failed"
        return $false
    }
    
    Write-Success "[OK] $service build completed"
    return $true
}

# Push image
function Push-Image {
    param([string]$imageName)
    
    Write-Info "Pushing image: $imageName"
    docker push $imageName
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[ERROR] Push failed"
        return $false
    }
    
    Write-Success "[OK] Push completed"
    return $true
}

# Main function
function Main {
    Show-Banner
    
    # Check Docker
    if (-not (Test-Docker)) {
        exit 1
    }
    Write-Host ""
    
    # Get or validate username
    if ([string]::IsNullOrEmpty($Username)) {
        $Username = Read-Host "Please enter Docker Hub username (or registry username)"
        if ([string]::IsNullOrEmpty($Username)) {
            Write-Error "Username is required"
            exit 1
        }
    }
    
    # Get version
    $version = Get-Version
    Write-Info "Detected version: $version"
    Write-Host ""
    
    # Image names
    $backendImage = "$Registry/$Username/myriad-backend:$Tag"
    $frontendImage = "$Registry/$Username/myriad-frontend:$Tag"
    
    # Login if push is needed
    if ($Push) {
        if (-not (Connect-Registry -registry $Registry -username $Username)) {
            exit 1
        }
        Write-Host ""
    }
    
    $success = $true
    
    # Build backend
    if (-not $SkipBackend) {
        Write-Info "========== Building Backend Image =========="
        if (-not (Invoke-ImageBuild -service "Backend" -dockerfile "docker/Dockerfile.backend" -imageName $backendImage -noCache $NoBuildCache)) {
            $success = $false
        }
        Write-Host ""
        
        # Also tag with version
        if ($Tag -ne $version -and $Tag -ne "latest") {
            $versionImage = "$Registry/$Username/myriad-backend:$version"
            docker tag $backendImage $versionImage
            Write-Info "  Also tagged as: $versionImage"
        }
    }
    
    # Build frontend
    if (-not $SkipFrontend) {
        Write-Info "========== Building Frontend Image =========="
        if (-not (Invoke-ImageBuild -service "Frontend" -dockerfile "docker/Dockerfile.frontend" -imageName $frontendImage -noCache $NoBuildCache)) {
            $success = $false
        }
        Write-Host ""
        
        # Also tag with version
        if ($Tag -ne $version -and $Tag -ne "latest") {
            $versionImage = "$Registry/$Username/myriad-frontend:$version"
            docker tag $frontendImage $versionImage
            Write-Info "  Also tagged as: $versionImage"
        }
    }
    
    if (-not $success) {
        Write-Error "Build process encountered errors"
        exit 1
    }
    
    # Push images
    if ($Push) {
        Write-Info "========== Pushing Images =========="
        
        if (-not $SkipBackend) {
            if (-not (Push-Image -imageName $backendImage)) {
                $success = $false
            }
            
            # Also push version tag if exists
            if ($Tag -ne $version -and $Tag -ne "latest") {
                $versionImage = "$Registry/$Username/myriad-backend:$version"
                Push-Image -imageName $versionImage
            }
        }
        
        if (-not $SkipFrontend) {
            if (-not (Push-Image -imageName $frontendImage)) {
                $success = $false
            }
            
            # Also push version tag if exists
            if ($Tag -ne $version -and $Tag -ne "latest") {
                $versionImage = "$Registry/$Username/myriad-frontend:$version"
                Push-Image -imageName $versionImage
            }
        }
        
        if (-not $success) {
            Write-Error "Push process encountered errors"
            exit 1
        }
    }
    
    # Display summary
    Write-Host ""
    Write-Success "==========================================="
    Write-Success "         Build Complete!"
    Write-Success "==========================================="
    Write-Host ""
    Write-Info "Built images:"
    if (-not $SkipBackend) {
        Write-Host "  Backend:  $backendImage"
    }
    if (-not $SkipFrontend) {
        Write-Host "  Frontend: $frontendImage"
    }
    Write-Host ""
    
    if ($Push) {
        Write-Success "[OK] Images pushed to registry"
        Write-Host ""
        Write-Info "Users can pull with:"
        if ($BuildBackend) {
            Write-Host "  docker pull $backendImage"
        }
        if ($BuildFrontend) {
            Write-Host "  docker pull $frontendImage"
        }
    }
    else {
        Write-Info "Local build complete, use -Push parameter to push to registry"
        Write-Host ""
        Write-Info "Push command:"
        Write-Host "  .\build-and-push.ps1 -Username $Username -Tag $Tag -Push"
    }
    
    Write-Host ""
    Write-Info "View images:"
    Write-Host "  docker images | grep myriad"
    Write-Host ""
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor Cyan
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# Execute main function
Main
