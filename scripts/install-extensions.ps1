# VSCode Extensions Installation Script
# Run this script to install all recommended extensions for Myriad project

Write-Host "🔧 Installing VSCode extensions for Myriad..." -ForegroundColor Cyan

$extensions = @(
    "rust-lang.rust-analyzer",
    "tamasfe.even-better-toml",
    "serayuzgur.crates",
    "astro-build.astro-vscode",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-azuretools.vscode-docker"
)

foreach ($ext in $extensions) {
    Write-Host "Installing $ext..." -ForegroundColor Yellow
    code --install-extension $ext
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ $ext installed successfully" -ForegroundColor Green
    } else {
        Write-Host "✗ Failed to install $ext" -ForegroundColor Red
    }
}

Write-Host "`n✅ Extension installation complete!" -ForegroundColor Green
Write-Host "Please restart VSCode for changes to take effect." -ForegroundColor Cyan
