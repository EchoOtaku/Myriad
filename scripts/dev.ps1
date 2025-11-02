# Myriad Development Server Script
# Starts both frontend and backend servers concurrently

Write-Host "🚀 Starting Myriad development servers..." -ForegroundColor Cyan

# Check if .env exists in backend
if (-not (Test-Path "backend\.env")) {
    Write-Host "⚠ backend/.env not found. Creating from .env.example..." -ForegroundColor Yellow
    Copy-Item backend\.env.example backend\.env
    Write-Host "⚠ Please edit backend/.env with your configuration before continuing" -ForegroundColor Yellow
    Read-Host "Press Enter to continue or Ctrl+C to exit"
}

# Create jobs array
$jobs = @()

# Start backend server
Write-Host "`n🦀 Starting Rust backend on http://localhost:3000..." -ForegroundColor Yellow
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    Set-Location backend
    cargo run
}
$jobs += $backendJob
Write-Host "Backend job started (ID: $($backendJob.Id))" -ForegroundColor Green

# Wait a bit for backend to start
Start-Sleep -Seconds 2

# Start frontend server
Write-Host "`n⚡ Starting Astro frontend on http://localhost:4321..." -ForegroundColor Yellow
$frontendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    Set-Location frontend
    npm run dev
}
$jobs += $frontendJob
Write-Host "Frontend job started (ID: $($frontendJob.Id))" -ForegroundColor Green

Write-Host "`n✅ Both servers are starting..." -ForegroundColor Green
Write-Host "`nAccess the application at:" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:4321" -ForegroundColor White
Write-Host "  Backend API: http://localhost:3000" -ForegroundColor White
Write-Host "  Health Check: http://localhost:3000/health" -ForegroundColor White

Write-Host "`nPress Ctrl+C to stop all servers" -ForegroundColor Yellow

try {
    # Monitor jobs and display output
    while ($true) {
        foreach ($job in $jobs) {
            $output = Receive-Job -Job $job
            if ($output) {
                Write-Host $output
            }
            
            if ($job.State -eq "Failed") {
                Write-Host "Job $($job.Id) failed!" -ForegroundColor Red
                throw "A server job failed"
            }
        }
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host "`n🛑 Stopping servers..." -ForegroundColor Yellow
    $jobs | Stop-Job
    $jobs | Remove-Job
    Write-Host "All servers stopped" -ForegroundColor Green
}
