# ============================================
# Myriad Development Script (Windows)
# ============================================
# Unified script for all development operations
# Usage: .\dev.ps1 <command> [options]

param(
    [Parameter(Position = 0, Mandatory = $false)]
    [ValidateSet("start", "stop", "restart", "clean", "status", "logs", "help")]
    [string]$Command = "help",
    
    [ValidateSet("backend", "frontend", "all")]
    [string]$Service = "all",
    
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Get project root
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# Helper functions
function Write-Header {
    param([string]$Title)
    Write-Host "`n================================" -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "================================`n" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "→ $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

# ====================
# START Command
# ====================
function Start-Services {
    Write-Header "Starting Myriad Services"
    
    # Check if services are already running
    $existingBackend = Get-Process -Name "myriad-backend", "cargo" -ErrorAction SilentlyContinue
    $existingFrontend = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try {
            $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
            $cmd -like "*astro*" -or $cmd -like "*vite*"
        }
        catch { $false }
    }

    if (($existingBackend -and ($Service -eq "all" -or $Service -eq "backend")) -or 
        ($existingFrontend -and ($Service -eq "all" -or $Service -eq "frontend"))) {
        
        if (-not $Force) {
            Write-Host "⚠️  Warning: Some services are already running" -ForegroundColor Yellow
            Write-Host "Use -Force to stop and restart them" -ForegroundColor Yellow
            return
        }
        
        Write-Info "Stopping existing services..."
        Stop-Services
        Start-Sleep -Seconds 2
    }

    # Start Backend
    if ($Service -eq "all" -or $Service -eq "backend") {
        Write-Info "Starting Backend..."
        $backendPath = Join-Path $projectRoot "backend"
        
        Start-Process powershell -ArgumentList `
            "-NoExit", "-NoProfile", "-Command", `
            "Write-Host '🦀 Myriad Backend' -ForegroundColor Cyan; Write-Host ''; Set-Location '$backendPath'; cargo run" `
            -WindowStyle Normal -WorkingDirectory $backendPath
        
        Write-Success "Backend starting in new window"
        Start-Sleep -Seconds 2
    }

    # Start Frontend
    if ($Service -eq "all" -or $Service -eq "frontend") {
        Write-Info "Starting Frontend..."
        $frontendPath = Join-Path $projectRoot "frontend"
        
        Start-Process powershell -ArgumentList `
            "-NoExit", "-NoProfile", "-Command", `
            "Write-Host '⚡ Myriad Frontend' -ForegroundColor Cyan; Write-Host ''; Set-Location '$frontendPath'; npm run dev" `
            -WindowStyle Normal -WorkingDirectory $frontendPath
        
        Write-Success "Frontend starting in new window"
    }

    Write-Host "`n" -NoNewline
    Write-Success "Services Started!"
    Write-Host "`nURLs (wait ~10 seconds for startup):"
    Write-Host "  Frontend: http://localhost:4321" -ForegroundColor White
    Write-Host "  Backend:  http://localhost:3000" -ForegroundColor White
    Write-Host "  Health:   http://localhost:3000/health" -ForegroundColor White
    Write-Host ""
}

# ====================
# STOP Command
# ====================
function Stop-Services {
    Write-Header "Stopping Myriad Services"
    
    $stoppedCount = 0

    # Stop Backend
    if ($Service -eq "all" -or $Service -eq "backend") {
        Write-Info "Stopping backend services..."
        
        $cargoProcesses = Get-Process -Name "cargo" -ErrorAction SilentlyContinue
        if ($cargoProcesses) {
            $cargoProcesses | Stop-Process -Force
            $stoppedCount += $cargoProcesses.Count
        }
        
        $backendProcesses = Get-Process -Name "myriad-backend" -ErrorAction SilentlyContinue
        if ($backendProcesses) {
            $backendProcesses | Stop-Process -Force
            $stoppedCount += $backendProcesses.Count
        }
        
        Write-Success "Backend stopped"
    }

    # Stop Frontend
    if ($Service -eq "all" -or $Service -eq "frontend") {
        Write-Info "Stopping frontend services..."
        
        $nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
            try {
                $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
                $cmd -like "*astro*" -or $cmd -like "*vite*"
            }
            catch { $false }
        }
        
        if ($nodeProcesses) {
            $nodeProcesses | Stop-Process -Force
            $stoppedCount += $nodeProcesses.Count
        }
        
        Write-Success "Frontend stopped"
    }

    Write-Host ""
    if ($stoppedCount -gt 0) {
        Write-Success "Stopped $stoppedCount process(es)"
    }
    else {
        Write-Host "No services were running" -ForegroundColor Gray
    }
    Write-Host ""
}

# ====================
# RESTART Command
# ====================
function Restart-Services {
    Write-Header "Restarting Myriad Services"
    Stop-Services
    Start-Sleep -Seconds 2
    Start-Services
}

# ====================
# CLEAN Command
# ====================
function Clear-Project {
    [System.Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '')]
    param()
    
    Write-Header "Myriad Clean Tool"
    
    Write-Host "WARNING: This will delete:" -ForegroundColor Yellow
    Write-Host "  - Database data (drop all tables)" -ForegroundColor Yellow
    Write-Host "  - Backend build files (target/)" -ForegroundColor Yellow
    Write-Host "  - Frontend build files (frontend/dist/)" -ForegroundColor Yellow
    Write-Host "  - Cache files (backend/cache/)" -ForegroundColor Yellow
    Write-Host "  - Environment config (backend/.env)" -ForegroundColor Yellow
    Write-Host ""
    
    if (-not $Force) {
        $confirmation = Read-Host "Type 'yes' to continue"
        if ($confirmation -ne "yes") {
            Write-Info "Operation cancelled"
            return
        }
    }
    
    Write-Host "`nStarting cleanup..." -ForegroundColor Cyan

    # 1. Clear database
    Write-Info "[1/5] Clearing database..."
    $dbRunning = docker ps --filter "name=myriad-postgres" --format "{{.Names}}" 2>$null
    if ($dbRunning -eq "myriad-postgres") {
        $dropSQL = @"
DO `$`$ DECLARE r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END `$`$;
"@
        docker exec myriad-postgres psql -U myriad -d myriad -c $dropSQL 2>&1 | Out-Null
        Write-Success "Database tables dropped"
    }
    else {
        Write-Host "  Database not running" -ForegroundColor Gray
    }

    # 2. Delete backend build files
    Write-Info "[2/5] Deleting backend build files..."
    $backendTarget = Join-Path $projectRoot "backend\target"
    if (Test-Path $backendTarget) {
        Remove-Item -Path $backendTarget -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success "Backend build files deleted"
    }
    else {
        Write-Host "  No backend build files" -ForegroundColor Gray
    }

    # 3. Delete frontend build files
    Write-Info "[3/5] Deleting frontend build files..."
    $frontendDist = Join-Path $projectRoot "frontend\dist"
    if (Test-Path $frontendDist) {
        Remove-Item -Path $frontendDist -Recurse -Force
        Write-Success "Frontend build files deleted"
    }
    else {
        Write-Host "  No frontend build files" -ForegroundColor Gray
    }

    # 4. Delete cache files
    Write-Info "[4/5] Deleting cache files..."
    $cacheDir = Join-Path $projectRoot "backend\cache"
    if (Test-Path $cacheDir) {
        Get-ChildItem -Path $cacheDir -Filter "*.json" -ErrorAction SilentlyContinue | Remove-Item -Force
        Write-Success "Cache files deleted"
    }
    else {
        Write-Host "  No cache files" -ForegroundColor Gray
    }

    # 5. Delete environment config
    Write-Info "[5/5] Deleting environment config..."
    $envFile = Join-Path $projectRoot "backend\.env"
    if (Test-Path $envFile) {
        Remove-Item -Path $envFile -Force
        Write-Success ".env file deleted"
    }
    else {
        Write-Host "  No .env file" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Success "Cleanup Complete!"
    Write-Host "`nNext steps:"
    Write-Host "  1. Run '.\dev.ps1 start' to start services" -ForegroundColor White
    Write-Host "  2. Complete setup wizard at http://localhost:4321/setup" -ForegroundColor White
    Write-Host ""
}

# ====================
# STATUS Command
# ====================
function Show-Status {
    Write-Header "Myriad Services Status"
    
    # Backend status
    $backendProcesses = Get-Process -Name "cargo", "myriad-backend" -ErrorAction SilentlyContinue
    if ($backendProcesses) {
        Write-Host "Backend:  " -NoNewline
        Write-Host "RUNNING" -ForegroundColor Green
        Write-Host "  Processes: $($backendProcesses.Count)" -ForegroundColor Gray
    }
    else {
        Write-Host "Backend:  " -NoNewline
        Write-Host "STOPPED" -ForegroundColor Red
    }
    
    # Frontend status
    $frontendProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try {
            $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
            $cmd -like "*astro*" -or $cmd -like "*vite*"
        }
        catch { $false }
    }
    if ($frontendProcesses) {
        Write-Host "Frontend: " -NoNewline
        Write-Host "RUNNING" -ForegroundColor Green
        Write-Host "  Processes: $($frontendProcesses.Count)" -ForegroundColor Gray
    }
    else {
        Write-Host "Frontend: " -NoNewline
        Write-Host "STOPPED" -ForegroundColor Red
    }
    
    Write-Host ""
}

# ====================
# LOGS Command
# ====================
function Show-Logs {
    Write-Header "Myriad Service Logs"
    Write-Host "Logs are displayed in service windows" -ForegroundColor Yellow
    Write-Host "Check the PowerShell windows opened by the start command" -ForegroundColor Gray
    Write-Host ""
}

# ====================
# HELP Command
# ====================
function Show-Help {
    Write-Host "Myriad Development Script" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage: .\dev.ps1 <command> [options]" -ForegroundColor White
    Write-Host ""
    Write-Host "Commands:" -ForegroundColor Yellow
    Write-Host "  start [-Service <service>]   - Start services (default: all)" -ForegroundColor White
    Write-Host "  stop [-Service <service>]    - Stop services (default: all)" -ForegroundColor White
    Write-Host "  restart [-Service <service>] - Restart services (default: all)" -ForegroundColor White
    Write-Host "  clean [-Force]               - Clean build files and database" -ForegroundColor White
    Write-Host "  status                       - Show service status" -ForegroundColor White
    Write-Host "  logs                         - Show logs info" -ForegroundColor White
    Write-Host "  help                         - Show this help" -ForegroundColor White
    Write-Host ""
    Write-Host "Services: backend, frontend, all (default)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host "  .\dev.ps1 start                    # Start all services" -ForegroundColor Gray
    Write-Host "  .\dev.ps1 start -Service backend   # Start backend only" -ForegroundColor Gray
    Write-Host "  .\dev.ps1 stop                     # Stop all services" -ForegroundColor Gray
    Write-Host "  .\dev.ps1 restart -Service frontend # Restart frontend" -ForegroundColor Gray
    Write-Host "  .\dev.ps1 clean -Force             # Clean without prompt" -ForegroundColor Gray
    Write-Host "  .\dev.ps1 status                   # Show status" -ForegroundColor Gray
    Write-Host ""
}

# ====================
# Interactive Menu
# ====================
function Show-InteractiveMenu {
    while ($true) {
        Write-Host ""
        Write-Host "================================" -ForegroundColor Cyan
        Write-Host "  Myriad Development Menu" -ForegroundColor Cyan
        Write-Host "================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "1. Start all services" -ForegroundColor White
        Write-Host "2. Start backend only" -ForegroundColor White
        Write-Host "3. Start frontend only" -ForegroundColor White
        Write-Host "4. Stop all services" -ForegroundColor White
        Write-Host "5. Restart all services" -ForegroundColor White
        Write-Host "6. Show status" -ForegroundColor White
        Write-Host "7. Clean project" -ForegroundColor White
        Write-Host "8. Show logs info" -ForegroundColor White
        Write-Host "0. Exit" -ForegroundColor Gray
        Write-Host ""
        
        $choice = Read-Host "Select an option (0-8)"
        
        switch ($choice) {
            "1" {
                $script:Service = "all"
                Start-Services
            }
            "2" {
                $script:Service = "backend"
                Start-Services
            }
            "3" {
                $script:Service = "frontend"
                Start-Services
            }
            "4" {
                $script:Service = "all"
                Stop-Services
            }
            "5" {
                $script:Service = "all"
                Restart-Services
            }
            "6" {
                Show-Status
            }
            "7" {
                Clear-Project
            }
            "8" {
                Show-Logs
            }
            "0" {
                Write-Host ""
                Write-Host "Goodbye! 👋" -ForegroundColor Cyan
                return
            }
            default {
                Write-Host ""
                Write-Host "Invalid option. Please select 0-8" -ForegroundColor Red
            }
        }
        
        Write-Host ""
        Write-Host "Press any key to continue..." -ForegroundColor Gray
        try {
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }
}

# ====================
# Main Execution
# ====================

# If no command provided or help requested, show interactive menu
if ($Command -eq "help" -and $PSBoundParameters.Count -eq 0) {
    Show-InteractiveMenu
}
else {
    switch ($Command) {
        "start" { Start-Services }
        "stop" { Stop-Services }
        "restart" { Restart-Services }
        "clean" { Clear-Project }
        "status" { Show-Status }
        "logs" { Show-Logs }
        "help" { Show-Help }
    }
    
    # Only wait for key press if running interactively and not from VS Code terminal
    if ($Host.Name -eq "ConsoleHost" -and -not $env:TERM_PROGRAM) {
        Write-Host ""
        Write-Host "Press any key to exit..." -ForegroundColor Gray
        try {
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        }
        catch {
            # Ignore errors if not in interactive mode
        }
    }
}
