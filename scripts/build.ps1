# Myriad Build Script
# Builds both frontend and backend for production

Write-Host "🔨 Building Myriad for production..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Build frontend
Write-Host "`n⚡ Building frontend..." -ForegroundColor Yellow
Set-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Frontend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Frontend built successfully" -ForegroundColor Green
Set-Location ..

# Build backend
Write-Host "`n🦀 Building backend..." -ForegroundColor Yellow
Set-Location backend
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Backend build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Backend built successfully" -ForegroundColor Green
Set-Location ..

Write-Host "`n✅ Build complete!" -ForegroundColor Green
Write-Host "`nBuild artifacts:" -ForegroundColor Cyan
Write-Host "  Frontend: frontend/dist/" -ForegroundColor White
Write-Host "  Backend: backend/target/release/myriad-backend.exe" -ForegroundColor White

Write-Host "`nTo run the production build:" -ForegroundColor Cyan
Write-Host "  cd backend; .\target\release\myriad-backend.exe" -ForegroundColor White
