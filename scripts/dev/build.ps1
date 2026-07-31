# ============================================
# Myriad Build Script (Windows)
# ============================================
# Description: Build backend and frontend for production
# Usage: .\scripts\dev\build.ps1

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $projectRoot

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Myriad Production Build" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/2] Building Rust backend..." -ForegroundColor Yellow
cargo build -p myriad-backend --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "Backend built successfully" -ForegroundColor Green
Write-Host ""

Write-Host "[2/2] Building Astro frontend..." -ForegroundColor Yellow
Push-Location (Join-Path $projectRoot "frontend")
try {
    pnpm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Frontend build failed" -ForegroundColor Red
        exit 1
    }
}
finally {
    Pop-Location
}
Write-Host "Frontend built successfully" -ForegroundColor Green
Write-Host ""

Write-Host "================================" -ForegroundColor Green
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "Backend binary: target\release\myriad-backend.exe" -ForegroundColor Cyan
Write-Host "Frontend dist:  frontend\dist\" -ForegroundColor Cyan
Write-Host ""
Write-Host "For production stack, use: .\scripts\docker\deploy.ps1 up" -ForegroundColor Yellow
