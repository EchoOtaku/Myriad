# ============================================
# Myriad Start Script (Windows)
# ============================================
# Description: Start backend and frontend in new windows
# Usage: .\scripts\start.ps1

$ErrorActionPreference = "Stop"

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Starting Myriad Services" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Get project root
$projectRoot = Split-Path $PSScriptRoot -Parent

# Check if services are already running
$existingBackend = Get-Process -Name "myriad-backend","cargo" -ErrorAction SilentlyContinue
$existingFrontend = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        $cmd -like "*astro*" -or $cmd -like "*vite*"
    } catch {
        $false
    }
}

if ($existingBackend -or $existingFrontend) {
    Write-Host "⚠️  Warning: Some services are already running" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Do you want to stop existing services and restart? (Y/N)" -ForegroundColor Yellow
    $response = Read-Host
    if ($response -eq "Y" -or $response -eq "y") {
        Write-Host "Stopping existing services..." -ForegroundColor Yellow
        $existingBackend | Stop-Process -Force -ErrorAction SilentlyContinue
        $existingFrontend | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    } else {
        Write-Host "Cancelled. Existing services still running." -ForegroundColor Red
        exit 0
    }
}

# Start Backend
Write-Host "[1/2] Starting Backend..." -ForegroundColor Yellow
$backendPath = Join-Path $projectRoot "backend"

Start-Process powershell -ArgumentList `
    "-NoExit", `
    "-NoProfile", `
    "-Command", `
    "Write-Host '🦀 Myriad Backend' -ForegroundColor Cyan; Write-Host ''; Set-Location '$backendPath'; cargo run" `
    -WindowStyle Normal `
    -WorkingDirectory $backendPath

Write-Host "✓ Backend starting in new window" -ForegroundColor Green
Start-Sleep -Seconds 2

# Start Frontend
Write-Host "[2/2] Starting Frontend..." -ForegroundColor Yellow
$frontendPath = Join-Path $projectRoot "frontend"

Start-Process powershell -ArgumentList `
    "-NoExit", `
    "-NoProfile", `
    "-Command", `
    "Write-Host '⚡ Myriad Frontend' -ForegroundColor Cyan; Write-Host ''; Set-Location '$frontendPath'; npm run dev" `
    -WindowStyle Normal `
    -WorkingDirectory $frontendPath

Write-Host "✓ Frontend starting in new window" -ForegroundColor Green

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Services Started!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Two new windows have been opened:" -ForegroundColor White
Write-Host "  1. Backend  - Running cargo (Rust)" -ForegroundColor Cyan
Write-Host "  2. Frontend - Running npm dev (Astro)" -ForegroundColor Cyan
Write-Host ""
Write-Host "URLs (wait ~10 seconds for startup):" -ForegroundColor Yellow
Write-Host "  Frontend: http://localhost:4321" -ForegroundColor White
Write-Host "  Backend:  http://localhost:3000" -ForegroundColor White
Write-Host "  Health:   http://localhost:3000/health" -ForegroundColor White
Write-Host ""
Write-Host "To stop all services, run:" -ForegroundColor Yellow
Write-Host "  .\scripts\stop.ps1" -ForegroundColor White
Write-Host ""
Write-Host "Press Enter to close this window (services will continue)..." -ForegroundColor Gray
Read-Host
