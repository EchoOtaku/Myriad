# ========================================
#   Myriad 全服务重启脚本
# ========================================
# 功能: 重启数据库、后端、前端所有服务
# 使用: .\restart-all.ps1

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   Myriad 全服务重启" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

# ========================================
# 1. 停止所有服务
# ========================================
Write-Host "[ 1/4 ] 停止现有服务..." -ForegroundColor Yellow

# 停止前端 (端口 4321)
$frontendProcess = Get-NetTCPConnection -LocalPort 4321 -ErrorAction SilentlyContinue
if ($frontendProcess) {
    $pid = $frontendProcess.OwningProcess | Select-Object -First 1
    Write-Host "  → 停止前端服务 (PID: $pid)" -ForegroundColor Gray
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 停止后端 (端口 3000)
$backendProcess = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($backendProcess) {
    $pid = $backendProcess.OwningProcess | Select-Object -First 1
    Write-Host "  → 停止后端服务 (PID: $pid)" -ForegroundColor Gray
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 停止数据库容器
Write-Host "  → 停止数据库容器" -ForegroundColor Gray
docker compose down 2>$null
Start-Sleep -Seconds 3

Write-Host "  ✓ 所有服务已停止`n" -ForegroundColor Green

# ========================================
# 2. 启动数据库
# ========================================
Write-Host "[ 2/4 ] 启动数据库..." -ForegroundColor Yellow

Set-Location "C:\Users\Think\Documents\GitHub\Myriad"
docker compose up -d postgres

Write-Host "  → 等待数据库就绪 (10秒)..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 验证数据库
$dbCheck = docker ps --filter "name=myriad-postgres" --format "{{.Names}}"
if ($dbCheck -match "myriad-postgres") {
    Write-Host "  ✓ 数据库启动成功`n" -ForegroundColor Green
} else {
    Write-Host "  ✗ 数据库启动失败！`n" -ForegroundColor Red
    exit 1
}

# ========================================
# 3. 启动后端
# ========================================
Write-Host "[ 3/4 ] 启动后端服务..." -ForegroundColor Yellow

Set-Location "C:\Users\Think\Documents\GitHub\Myriad"

# 设置环境变量
$env:DATABASE_URL = "postgresql://myriad:password@localhost:5432/myriad"

# 在新窗口启动后端
$backendScript = @"
`$env:DATABASE_URL='postgresql://myriad:password@localhost:5432/myriad'
Set-Location 'C:\Users\Think\Documents\GitHub\Myriad'
cargo run
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendScript

Write-Host "  → 等待后端就绪 (15秒)..." -ForegroundColor Gray
Start-Sleep -Seconds 15

# 验证后端
try {
    $backendHealth = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
    if ($backendHealth.StatusCode -eq 200) {
        Write-Host "  ✓ 后端启动成功 (http://localhost:3000)`n" -ForegroundColor Green
    }
} catch {
    Write-Host "  ⚠ 后端可能还在启动中..." -ForegroundColor Yellow
    Write-Host "  → 请等待几秒后手动检查: http://localhost:3000/health`n" -ForegroundColor Gray
}

# ========================================
# 4. 启动前端
# ========================================
Write-Host "[ 4/4 ] 启动前端服务..." -ForegroundColor Yellow

Set-Location "C:\Users\Think\Documents\GitHub\Myriad\frontend"

# 在新窗口启动前端
$frontendScript = @"
Set-Location 'C:\Users\Think\Documents\GitHub\Myriad\frontend'
npm run dev
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendScript

Write-Host "  → 等待前端就绪 (10秒)..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 验证前端
try {
    $frontendHealth = Invoke-WebRequest -Uri "http://localhost:4321/" -UseBasicParsing -TimeoutSec 5
    if ($frontendHealth.StatusCode -eq 200) {
        Write-Host "  ✓ 前端启动成功 (http://localhost:4321)`n" -ForegroundColor Green
    }
} catch {
    Write-Host "  ⚠ 前端可能还在启动中..." -ForegroundColor Yellow
    Write-Host "  → 请等待几秒后刷新浏览器`n" -ForegroundColor Gray
}

# ========================================
# 5. 最终状态报告
# ========================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   重启完成！" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "📦 服务状态:" -ForegroundColor White
Write-Host ""

# 检查数据库
$dbStatus = docker ps --filter "name=myriad-postgres" --format "{{.Status}}"
if ($dbStatus) {
    Write-Host "  ✓ 数据库 (PostgreSQL)" -ForegroundColor Green
    Write-Host "    端口: localhost:5432" -ForegroundColor Gray
    Write-Host "    状态: $dbStatus" -ForegroundColor Gray
} else {
    Write-Host "  ✗ 数据库未运行" -ForegroundColor Red
}

Write-Host ""

# 检查后端
try {
    $backendCheck = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "  ✓ 后端 (Rust/Axum)" -ForegroundColor Green
    Write-Host "    地址: http://localhost:3000" -ForegroundColor Gray
    Write-Host "    状态: $($backendCheck.StatusCode) OK" -ForegroundColor Gray
} catch {
    Write-Host "  ⚠ 后端 (启动中...)" -ForegroundColor Yellow
    Write-Host "    地址: http://localhost:3000" -ForegroundColor Gray
}

Write-Host ""

# 检查前端
try {
    $frontendCheck = Invoke-WebRequest -Uri "http://localhost:4321/" -UseBasicParsing -TimeoutSec 3
    Write-Host "  ✓ 前端 (Astro)" -ForegroundColor Green
    Write-Host "    地址: http://localhost:4321" -ForegroundColor Gray
    Write-Host "    状态: $($frontendCheck.StatusCode) OK" -ForegroundColor Gray
} catch {
    Write-Host "  ⚠ 前端 (启动中...)" -ForegroundColor Yellow
    Write-Host "    地址: http://localhost:4321" -ForegroundColor Gray
}

Write-Host "`n🌐 访问地址:" -ForegroundColor White
Write-Host "  主页:   http://localhost:4321/" -ForegroundColor Cyan
Write-Host "  配置:   http://localhost:4321/config" -ForegroundColor Cyan
Write-Host "  API:    http://localhost:3000/health" -ForegroundColor Cyan

Write-Host "`n💡 提示:" -ForegroundColor Yellow
Write-Host "  - 后端和前端在独立的 PowerShell 窗口中运行" -ForegroundColor Gray
Write-Host "  - 如需停止服务，请关闭对应的窗口" -ForegroundColor Gray
Write-Host "  - 查看日志请切换到对应的窗口" -ForegroundColor Gray
Write-Host "  - 如果服务未就绪，请等待几秒后刷新`n" -ForegroundColor Gray

# 返回原始目录
Set-Location "C:\Users\Think\Documents\GitHub\Myriad"
