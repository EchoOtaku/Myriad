# ========================================
#   Myriad 鍏ㄦ湇鍔￠噸鍚剼鏈?
# ========================================
# 鍔熻兘: 閲嶅惎鏁版嵁搴撱€佸悗绔€佸墠绔墍鏈夋湇鍔?
# 浣跨敤: .\restart-all.ps1

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   Myriad 鍏ㄦ湇鍔￠噸鍚? -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

# ========================================
# 1. 鍋滄鎵€鏈夋湇鍔?
# ========================================
Write-Host "[ 1/4 ] 鍋滄鐜版湁鏈嶅姟..." -ForegroundColor Yellow

# 鍋滄鍓嶇 (绔彛 4321)
$frontendProcess = Get-NetTCPConnection -LocalPort 4321 -ErrorAction SilentlyContinue
if ($frontendProcess) {
    $frontendPid = $frontendProcess.OwningProcess | Select-Object -First 1
    Write-Host "  鈫?鍋滄鍓嶇鏈嶅姟 (PID: $($frontendPid))" -ForegroundColor Gray
    Stop-Process -Id $frontendPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 鍋滄鍚庣 (绔彛 3000)
$backendProcess = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($backendProcess) {
    $backendPid = $backendProcess.OwningProcess | Select-Object -First 1
    Write-Host "  鈫?鍋滄鍚庣鏈嶅姟 (PID: $($backendPid))" -ForegroundColor Gray
    Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 鍋滄鏁版嵁搴撳鍣?
Write-Host "  鈫?鍋滄鏁版嵁搴撳鍣? -ForegroundColor Gray
docker compose down 2>$null
Start-Sleep -Seconds 3

Write-Host "  鉁?鎵€鏈夋湇鍔″凡鍋滄`n" -ForegroundColor Green

# ========================================
# 2. 鍚姩鏁版嵁搴?
# ========================================
Write-Host "[ 2/4 ] 鍚姩鏁版嵁搴?.." -ForegroundColor Yellow

Set-Location "C:\Users\Think\Documents\GitHub\Myriad"
docker compose up -d postgres

Write-Host "  鈫?绛夊緟鏁版嵁搴撳氨缁?(10绉?..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 楠岃瘉鏁版嵁搴?
$dbCheck = docker ps --filter "name=myriad-postgres" --format "{{.Names}}"
if ($dbCheck -match "myriad-postgres") {
    Write-Host "  鉁?鏁版嵁搴撳惎鍔ㄦ垚鍔焋n" -ForegroundColor Green
}
else {
    Write-Host "  鉁?鏁版嵁搴撳惎鍔ㄥけ璐ワ紒`n" -ForegroundColor Red
    exit 1
}

# ========================================
# 3. 鍚姩鍚庣
# ========================================
Write-Host "[ 3/4 ] 鍚姩鍚庣鏈嶅姟..." -ForegroundColor Yellow

Set-Location "C:\Users\Think\Documents\GitHub\Myriad"

# 璁剧疆鐜鍙橀噺
$env:DATABASE_URL = "postgresql://myriad:password@localhost:5432/myriad"

# 鍦ㄦ柊绐楀彛鍚姩鍚庣
$backendScript = @"
`$env:DATABASE_URL='postgresql://myriad:password@localhost:5432/myriad'
Set-Location 'C:\Users\Think\Documents\GitHub\Myriad\backend'
cargo run
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendScript

Write-Host "  鈫?绛夊緟鍚庣灏辩华 (15绉?..." -ForegroundColor Gray
Start-Sleep -Seconds 15

# 楠岃瘉鍚庣
try {
    $backendHealth = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
    if ($backendHealth.StatusCode -eq 200) {
        Write-Host "  鉁?鍚庣鍚姩鎴愬姛 (http://localhost:3000)`n" -ForegroundColor Green
    }
}
catch {
    Write-Host "  鈿?鍚庣鍙兘杩樺湪鍚姩涓?.." -ForegroundColor Yellow
    Write-Host "  鈫?璇风瓑寰呭嚑绉掑悗鎵嬪姩妫€鏌? http://localhost:3000/health`n" -ForegroundColor Gray
}

# ========================================
# 4. 鍚姩鍓嶇
# ========================================
Write-Host "[ 4/4 ] 鍚姩鍓嶇鏈嶅姟..." -ForegroundColor Yellow

Set-Location "C:\Users\Think\Documents\GitHub\Myriad\frontend"

# 鍦ㄦ柊绐楀彛鍚姩鍓嶇
$frontendScript = @"
Set-Location 'C:\Users\Think\Documents\GitHub\Myriad\frontend'
npm run dev
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendScript

Write-Host "  鈫?绛夊緟鍓嶇灏辩华 (10绉?..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 楠岃瘉鍓嶇
try {
    $frontendHealth = Invoke-WebRequest -Uri "http://localhost:4321/" -UseBasicParsing -TimeoutSec 5
    if ($frontendHealth.StatusCode -eq 200) {
        Write-Host "  鉁?鍓嶇鍚姩鎴愬姛 (http://localhost:4321)`n" -ForegroundColor Green
    }
}
catch {
    Write-Host "  鈿?鍓嶇鍙兘杩樺湪鍚姩涓?.." -ForegroundColor Yellow
    Write-Host "  鈫?璇风瓑寰呭嚑绉掑悗鍒锋柊娴忚鍣╜n" -ForegroundColor Gray
}

# ========================================
# 5. 鏈€缁堢姸鎬佹姤鍛?
# ========================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   閲嶅惎瀹屾垚锛? -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "馃摝 鏈嶅姟鐘舵€?" -ForegroundColor White
Write-Host ""

# 妫€鏌ユ暟鎹簱
$dbStatus = docker ps --filter "name=myriad-postgres" --format "{{.Status}}"
if ($dbStatus) {
    Write-Host "  鉁?鏁版嵁搴?(PostgreSQL)" -ForegroundColor Green
    Write-Host "    绔彛: localhost:5432" -ForegroundColor Gray
    Write-Host "    鐘舵€? $($dbStatus)" -ForegroundColor Gray
}
else {
    Write-Host "  鉁?鏁版嵁搴撴湭杩愯" -ForegroundColor Red
}

Write-Host ""

# 妫€鏌ュ悗绔?
try {
    $backendCheck = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "  鉁?鍚庣 (Rust/Axum)" -ForegroundColor Green
    Write-Host "    鍦板潃: http://localhost:3000" -ForegroundColor Gray
    Write-Host "    鐘舵€? $($backendCheck.StatusCode) OK" -ForegroundColor Gray
}
catch {
    Write-Host "  鈿?鍚庣 (鍚姩涓?..)" -ForegroundColor Yellow
    Write-Host "    鍦板潃: http://localhost:3000" -ForegroundColor Gray
}

Write-Host ""

# 妫€鏌ュ墠绔?
try {
    $frontendCheck = Invoke-WebRequest -Uri "http://localhost:4321/" -UseBasicParsing -TimeoutSec 3
    Write-Host "  鉁?鍓嶇 (Astro)" -ForegroundColor Green
    Write-Host "    鍦板潃: http://localhost:4321" -ForegroundColor Gray
    Write-Host "    鐘舵€? $($frontendCheck.StatusCode) OK" -ForegroundColor Gray
}
catch {
    Write-Host "  鈿?鍓嶇 (鍚姩涓?..)" -ForegroundColor Yellow
    Write-Host "    鍦板潃: http://localhost:4321" -ForegroundColor Gray
}

Write-Host "`n馃寪 璁块棶鍦板潃:" -ForegroundColor White
Write-Host "  涓婚〉:   http://localhost:4321/" -ForegroundColor Cyan
Write-Host "  閰嶇疆:   http://localhost:4321/config" -ForegroundColor Cyan
Write-Host "  API:    http://localhost:3000/health" -ForegroundColor Cyan

Write-Host "`n馃挕 鎻愮ず:" -ForegroundColor Yellow
Write-Host "  - 鍚庣鍜屽墠绔湪鐙珛鐨?PowerShell 绐楀彛涓繍琛? -ForegroundColor Gray
Write-Host "  - 濡傞渶鍋滄鏈嶅姟锛岃鍏抽棴瀵瑰簲鐨勭獥鍙? -ForegroundColor Gray
Write-Host "  - 鏌ョ湅鏃ュ織璇峰垏鎹㈠埌瀵瑰簲鐨勭獥鍙? -ForegroundColor Gray
Write-Host "  - 濡傛灉鏈嶅姟鏈氨缁紝璇风瓑寰呭嚑绉掑悗鍒锋柊`n" -ForegroundColor Gray

# 杩斿洖鍘熷鐩綍
Set-Location "C:\Users\Think\Documents\GitHub\Myriad"
