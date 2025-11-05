# =============================================================================
# Myriad Docker Unified Deployment Script
# =============================================================================
# Supports both local build and pre-built image deployment
# =============================================================================

param(
    [ValidateSet("build", "prebuilt")]
    [string]$Mode = "build",
    [string]$Username = "mirai-mamori",
    [string]$Tag = "latest",
    [switch]$Stop = $false,
    [switch]$Clean = $false,
    [switch]$Logs = $false,
    [switch]$Status = $false,
    [switch]$Rebuild = $false
)

$ErrorActionPreference = "Stop"

# Color output functions
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
    if ($Mode -eq "prebuilt") {
        Write-Info "   Myriad Pre-built Image Deployment"
    }
    else {
        Write-Info "      Myriad Docker Deployment Tool"
    }
    Write-Info "==========================================="
    Write-Host ""
}

# Check if Docker is installed
function Test-Docker {
    Write-Info "Checking Docker environment..."
    try {
        $null = docker --version
        if ($Mode -eq "build") {
            $null = docker-compose --version
            Write-Success "[OK] Docker and Docker Compose installed"
        }
        else {
            Write-Success "[OK] Docker is installed"
        }
        return $true
    }
    catch {
        Write-Error "[ERROR] Docker not found"
        Write-Error "Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
        return $false
    }
}

# Get compose file and command prefix
function Get-ComposeConfig {
    if ($Mode -eq "prebuilt") {
        return @{
            File        = "docker-compose.prebuilt.yml"
            EnvTemplate = ".env.prebuilt"
        }
    }
    else {
        return @{
            File        = "docker-compose.yml"
            EnvTemplate = ".env.docker"
        }
    }
}

# Check and create environment file
function Initialize-Environment {
    Write-Info "Checking environment configuration..."
    
    $config = Get-ComposeConfig
    
    if (-not (Test-Path ".env")) {
        if (Test-Path $config.EnvTemplate) {
            Write-Warning ".env file not found, creating from $($config.EnvTemplate)..."
            Copy-Item $config.EnvTemplate ".env"
            
            # For prebuilt mode, set Docker username and tag
            if ($Mode -eq "prebuilt") {
                $content = Get-Content ".env" -Raw
                $content = $content -replace 'DOCKER_USERNAME=.*', "DOCKER_USERNAME=$Username"
                $content = $content -replace 'IMAGE_TAG=.*', "IMAGE_TAG=$Tag"
                Set-Content ".env" $content
            }
            
            Write-Success "[OK] .env file created"
            Write-Warning "[IMPORTANT] Please edit .env file and change:"
            Write-Warning "  - POSTGRES_PASSWORD (database password)"
            Write-Warning "  - JWT_SECRET (JWT secret key)"
            Write-Host ""
            $response = Read-Host "Edit .env file now? (y/N)"
            if ($response -eq 'y' -or $response -eq 'Y') {
                notepad .env
                Write-Host ""
                Read-Host "Press Enter after editing to continue"
            }
        }
        else {
            Write-Error "[ERROR] $($config.EnvTemplate) template file not found"
            return $false
        }
    }
    else {
        Write-Success "[OK] .env configuration file found"
    }
    
    return $true
}

# Stop and cleanup containers
function Stop-Application {
    Write-Info "Stopping application containers..."
    $config = Get-ComposeConfig
    
    if ($config.File -eq "docker-compose.yml") {
        docker-compose down
    }
    else {
        docker-compose -f $config.File down
    }
    
    Write-Success "[OK] Containers stopped"
}

# Clean all resources (including volumes)
[System.Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '')]
function Clear-Application {
    Write-Warning "[WARNING] This will delete all containers, images and volumes (including database data)"
    $response = Read-Host "Confirm to continue? (yes/N)"
    if ($response -ne 'yes') {
        Write-Info "Cleanup cancelled"
        return
    }
    
    Write-Info "Cleaning application resources..."
    $config = Get-ComposeConfig
    
    if ($config.File -eq "docker-compose.yml") {
        docker-compose down -v --rmi all
    }
    else {
        docker-compose -f $config.File down -v
    }
    
    Write-Success "[OK] All resources cleaned"
}

# Show logs
function Show-Logs {
    Write-Info "Showing application logs (Press Ctrl+C to exit)..."
    $config = Get-ComposeConfig
    
    if ($config.File -eq "docker-compose.yml") {
        docker-compose logs -f
    }
    else {
        docker-compose -f $config.File logs -f
    }
}

# Show status
function Show-Status {
    Write-Info "Application status:"
    Write-Host ""
    
    $config = Get-ComposeConfig
    if ($config.File -eq "docker-compose.yml") {
        docker-compose ps
    }
    else {
        docker-compose -f $config.File ps
    }
    
    Write-Host ""
    
    # Check health status
    $postgres = docker inspect myriad-postgres --format='{{.State.Health.Status}}' 2>$null
    $backend = docker inspect myriad-backend --format='{{.State.Health.Status}}' 2>$null
    $frontend = docker inspect myriad-frontend --format='{{.State.Health.Status}}' 2>$null
    
    Write-Info "Service health status:"
    if ($postgres) { Write-Host "  PostgreSQL: $postgres" }
    if ($backend) { Write-Host "  Backend:    $backend" }
    if ($frontend) { Write-Host "  Frontend:   $frontend" }
    Write-Host ""
    
    Write-Info "Access URLs:"
    Write-Success "  Frontend: http://localhost:4321"
    Write-Success "  Backend:  http://localhost:3000"
    Write-Success "  Database: localhost:5432"
}

# Build and start application (local build mode)
function Start-LocalBuild {
    Write-Info "Starting Myriad application (Local Build Mode)..."
    Write-Host ""
    
    if ($Rebuild) {
        Write-Info "Building images (first build may take several minutes)..."
        docker-compose build --no-cache
        if ($LASTEXITCODE -ne 0) {
            Write-Error "[ERROR] Build failed"
            return $false
        }
        Write-Success "[OK] Image build completed"
    }
    
    Write-Info "Starting containers..."
    docker-compose up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[ERROR] Start failed"
        return $false
    }
    
    Write-Success "[OK] Containers started"
    return $true
}

# Start application (pre-built mode)
function Start-Prebuilt {
    Write-Info "Starting Myriad application (Pre-built Image Mode)..."
    Write-Info "  Docker Hub user: $Username"
    Write-Info "  Image tag: $Tag"
    Write-Host ""
    
    Write-Info "Pulling latest images..."
    docker-compose -f docker-compose.prebuilt.yml pull
    Write-Host ""
    
    Write-Info "Starting services..."
    docker-compose -f docker-compose.prebuilt.yml up -d
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[ERROR] Start failed"
        return $false
    }
    
    Write-Success "[OK] Services started"
    return $true
}

# Wait for services to be ready
function Wait-ForServices {
    Write-Info "Waiting for services to be ready..."
    $maxWait = 60
    $waited = 0
    $interval = 5
    
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds $interval
        $waited += $interval
        
        $backend = docker inspect myriad-backend --format='{{.State.Health.Status}}' 2>$null
        if ($backend -eq "healthy") {
            Write-Success "[OK] All services ready!"
            Write-Host ""
            Show-Status
            return $true
        }
        
        Write-Host "." -NoNewline
    }
    
    Write-Host ""
    Write-Warning "[WARNING] Service startup timeout, please check logs"
    Write-Info "View logs with:"
    if ($Mode -eq "prebuilt") {
        Write-Host "  docker-compose -f docker-compose.prebuilt.yml logs -f"
    }
    else {
        Write-Host "  docker-compose logs -f"
    }
    return $false
}

# Main function
function Main {
    Show-Banner
    
    # Check Docker
    if (-not (Test-Docker)) {
        exit 1
    }
    Write-Host ""
    
    # Handle command line parameters
    if ($Stop) {
        Stop-Application
        exit 0
    }
    
    if ($Clean) {
        Clear-Application
        exit 0
    }
    
    if ($Logs) {
        Show-Logs
        exit 0
    }
    
    if ($Status) {
        Show-Status
        exit 0
    }
    
    # Initialize environment
    if (-not (Initialize-Environment)) {
        exit 1
    }
    Write-Host ""
    
    # Start application based on mode
    if ($Mode -eq "prebuilt") {
        $success = Start-Prebuilt
    }
    else {
        $success = Start-LocalBuild
    }
    
    if (-not $success) {
        exit 1
    }
    
    Write-Host ""
    $success = Wait-ForServices
    if (-not $success) {
        exit 1
    }
    
    Write-Host ""
    Write-Success "==========================================="
    Write-Success "       Deployment Complete!"
    Write-Success "==========================================="
    Write-Host ""
    Write-Info "Common commands:"
    Write-Host "  Check status: .\deploy.ps1 -Mode $Mode -Status"
    Write-Host "  View logs:    .\deploy.ps1 -Mode $Mode -Logs"
    Write-Host "  Stop service: .\deploy.ps1 -Mode $Mode -Stop"
    if ($Mode -eq "build") {
        Write-Host "  Rebuild:      .\deploy.ps1 -Mode build -Rebuild"
    }
    Write-Host "  Full cleanup: .\deploy.ps1 -Mode $Mode -Clean"
    Write-Host ""
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor Cyan
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# Execute main function
Main
