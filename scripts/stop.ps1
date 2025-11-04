# ============================================
# Myriad Stop Script (Windows)
# ============================================
# Description: Stop all Myriad services
# Usage: .\scripts\stop.ps1

$ErrorActionPreference = "Stop"

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Stopping Myriad Services" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Stop Backend
Write-Host "Stopping backend services..." -ForegroundColor Yellow
$backendCount = 0

# Stop myriad-backend processes
$backendProcs = Get-Process -Name "myriad-backend" -ErrorAction SilentlyContinue
if ($backendProcs) {
    $backendProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    $backendCount += $backendProcs.Count
    Write-Host "  Stopped $($backendProcs.Count) myriad-backend process(es)" -ForegroundColor Gray
}

# Stop cargo processes related to this project
$cargoProcs = Get-Process -Name "cargo" -ErrorAction SilentlyContinue
if ($cargoProcs) {
    foreach ($proc in $cargoProcs) {
        try {
            $procInfo = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
            if ($procInfo -and $procInfo.CommandLine -like "*myriad*") {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                $backendCount++
                Write-Host "  Stopped cargo process (PID: $($proc.Id))" -ForegroundColor Gray
            }
        }
        catch {
            # Ignore errors for processes we can't access
        }
    }
}

# Stop rustc processes (cargo spawns these)
$rustcProcs = Get-Process -Name "rustc" -ErrorAction SilentlyContinue
if ($rustcProcs) {
    foreach ($proc in $rustcProcs) {
        try {
            $procInfo = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
            if ($procInfo -and $procInfo.CommandLine -like "*myriad*") {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                $backendCount++
                Write-Host "  Stopped rustc process (PID: $($proc.Id))" -ForegroundColor Gray
            }
        }
        catch {
            # Ignore errors
        }
    }
}

if ($backendCount -gt 0) {
    Write-Host "✓ Backend stopped ($backendCount total processes)" -ForegroundColor Green
}
else {
    Write-Host "✓ No backend processes running" -ForegroundColor Gray
}

# Stop Frontend
Write-Host "Stopping frontend services..." -ForegroundColor Yellow
$frontendCount = 0

# Find and stop node processes running astro/vite
$nodeProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcs) {
    foreach ($proc in $nodeProcs) {
        try {
            $procInfo = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
            if ($procInfo) {
                $cmdLine = $procInfo.CommandLine
                if ($cmdLine -like "*astro*" -or $cmdLine -like "*vite*" -or $cmdLine -like "*myriad*frontend*") {
                    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                    $frontendCount++
                    Write-Host "  Stopped node process (PID: $($proc.Id))" -ForegroundColor Gray
                }
            }
        }
        catch {
            # Ignore errors for processes we can't access
        }
    }
}

if ($frontendCount -gt 0) {
    Write-Host "✓ Frontend stopped ($frontendCount processes)" -ForegroundColor Green
}
else {
    Write-Host "✓ No frontend processes running" -ForegroundColor Gray
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "  All Services Stopped" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
