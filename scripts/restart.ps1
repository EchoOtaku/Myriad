# ============================================
# Myriad Restart Script (Windows)
# ============================================
# Description: Restart backend and frontend services
# Usage: .\scripts\restart.ps1 [backend|frontend|all]

param(
    [ValidateSet("backend", "frontend", "all")]
    [string]$Service = "all"
)

$ErrorActionPreference = "Stop"

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Myriad Restart Service" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

function Stop-Backend {
    Write-Host "Stopping backend services..." -ForegroundColor Yellow

    # Stop cargo processes
    $cargoProcesses = Get-Process -Name "cargo" -ErrorAction SilentlyContinue
    if ($cargoProcesses) {
        $cargoProcesses | Stop-Process -Force
        Write-Host "  Stopped $($cargoProcesses.Count) cargo process(es)" -ForegroundColor Gray
    }

    # Stop myriad-backend processes
    $backendProcesses = Get-Process -Name "myriad-backend" -ErrorAction SilentlyContinue
    if ($backendProcesses) {
        $backendProcesses | Stop-Process -Force
        Write-Host "  Stopped $($backendProcesses.Count) backend process(es)" -ForegroundColor Gray
    }

    Write-Host "✓ Backend stopped" -ForegroundColor Green
}

function Stop-Frontend {
    Write-Host "Stopping frontend services..." -ForegroundColor Yellow

    # Find and stop node processes running astro
    $nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if ($nodeProcesses) {
        foreach ($proc in $nodeProcesses) {
            try {
                $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
                if ($cmdLine -like "*astro*" -or $cmdLine -like "*vite*") {
                    Stop-Process -Id $proc.Id -Force
                    Write-Host "  Stopped node process (PID: $($proc.Id))" -ForegroundColor Gray
                }
            } catch {
                # Ignore errors for processes we can't access
            }
        }
    }

    Write-Host "✓ Frontend stopped" -ForegroundColor Green
}

function Start-Backend {
    Write-Host "Starting backend..." -ForegroundColor Yellow

    $backendPath = Join-Path $PSScriptRoot "..\backend"
    $scriptBlock = "Set-Location '$backendPath'; cargo run"

    Start-Process powershell -ArgumentList `
        "-NoExit", `
        "-NoProfile", `
        "-Command", `
        $scriptBlock `
        -WindowStyle Normal

    Write-Host "✓ Backend starting in new window..." -ForegroundColor Green
    Write-Host "  Window title: Backend - cargo run" -ForegroundColor Gray
}

function Start-Frontend {
    Write-Host "Starting frontend..." -ForegroundColor Yellow

    $frontendPath = Join-Path $PSScriptRoot "..\frontend"
    $scriptBlock = "Set-Location '$frontendPath'; npm run dev"

    Start-Process powershell -ArgumentList `
        "-NoExit", `
        "-NoProfile", `
        "-Command", `
        $scriptBlock `
        -WindowStyle Normal

    Write-Host "✓ Frontend starting in new window..." -ForegroundColor Green
    Write-Host "  Window title: Frontend - npm run dev" -ForegroundColor Gray
}

# Execute restart based on service parameter
switch ($Service) {
    "backend" {
        Stop-Backend
        Start-Sleep -Seconds 1
        Start-Backend
    }
    "frontend" {
        Stop-Frontend
        Start-Sleep -Seconds 1
        Start-Frontend
    }
    "all" {
        Stop-Backend
        Stop-Frontend
        Start-Sleep -Seconds 2
        Start-Backend
        Start-Sleep -Seconds 1
        Start-Frontend
    }
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Restart Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Services restarted: $Service" -ForegroundColor White
Write-Host ""
Write-Host "URLs:" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:3000" -ForegroundColor White
Write-Host "  Frontend: http://localhost:4321" -ForegroundColor White
Write-Host ""
Write-Host "Logs:" -ForegroundColor Cyan
Write-Host "  Backend logs will appear in the new window" -ForegroundColor Gray
Write-Host "  Frontend logs will appear in the new window" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C in this window to close (services will continue running)" -ForegroundColor Yellow
