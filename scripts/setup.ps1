# Myriad Development Setup Script
# This script helps set up the development environment

Write-Host "🚀 Setting up Myriad development environment..." -ForegroundColor Cyan

# Check prerequisites
Write-Host "`n📋 Checking prerequisites..." -ForegroundColor Yellow

# Check Rust
if (Get-Command cargo -ErrorAction SilentlyContinue) {
    $rustVersion = cargo --version
    Write-Host "✓ Rust installed: $rustVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Rust not found. Please install from https://rustup.rs/" -ForegroundColor Red
    exit 1
}

# Check Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node --version
    Write-Host "✓ Node.js installed: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Node.js not found. Please install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Check PostgreSQL
if (Get-Command psql -ErrorAction SilentlyContinue) {
    $pgVersion = psql --version
    Write-Host "✓ PostgreSQL installed: $pgVersion" -ForegroundColor Green
} else {
    Write-Host "⚠ PostgreSQL not found. You can use Docker instead." -ForegroundColor Yellow
}

# Setup backend
Write-Host "`n📦 Setting up backend..." -ForegroundColor Yellow
Set-Location backend

if (-not (Test-Path ".env")) {
    Write-Host "Creating .env file from .env.example..." -ForegroundColor Cyan
    Copy-Item .env.example .env
    Write-Host "⚠ Please edit backend/.env with your configuration" -ForegroundColor Yellow
}

Write-Host "Installing Rust dependencies..." -ForegroundColor Cyan
cargo build
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Backend dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✗ Failed to install backend dependencies" -ForegroundColor Red
    exit 1
}

Set-Location ..

# Setup frontend
Write-Host "`n🎨 Setting up frontend..." -ForegroundColor Yellow
Set-Location frontend

Write-Host "Installing Node.js dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Frontend dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✗ Failed to install frontend dependencies" -ForegroundColor Red
    exit 1
}

Set-Location ..

# Database setup
Write-Host "`n🗄️ Database setup..." -ForegroundColor Yellow
Write-Host "To set up the database, run one of the following:" -ForegroundColor Cyan
Write-Host "  1. Using Docker: docker-compose up -d postgres" -ForegroundColor White
Write-Host "  2. Using local PostgreSQL: psql -U postgres -f database/schema.sql" -ForegroundColor White
Write-Host "  3. Using SeaORM migrations: cd backend; sea-orm-cli migrate up" -ForegroundColor White

Write-Host "`n✅ Setup complete!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Configure your .env file in backend/" -ForegroundColor White
Write-Host "  2. Set up the database (see options above)" -ForegroundColor White
Write-Host "  3. Run './scripts/dev.ps1' to start development servers" -ForegroundColor White
