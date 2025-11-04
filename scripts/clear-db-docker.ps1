# Database cleanup script using Docker
param(
    [string]$Container = "myriad-postgres",
    [switch]$ClearAll,
    [switch]$DropAll,
    [switch]$Help
)

if ($Help) {
    Write-Host "Database Cleanup Script (Docker)" -ForegroundColor Cyan
    Write-Host "  -ClearAll    Clear all table data"
    Write-Host "  -DropAll     Drop all tables"
    Write-Host "  -Help        Show help"
    exit 0
}

$tables = @("reports", "fetch_jobs", "api_keys", "configurations", "analysis_results", "user_activities", "user_profiles", "users", "platforms")

if ($DropAll) {
    Write-Host "Dropping all tables..." -ForegroundColor Yellow
    foreach ($table in $tables) {
        docker exec -i $Container psql -U myriad -d myriad -c "DROP TABLE IF EXISTS $table CASCADE;" 2>&1 | Out-Null
    }
    Write-Host "Done!" -ForegroundColor Green
    exit 0
}

if ($ClearAll) {
    Write-Host "Clearing all tables..." -ForegroundColor Yellow
    foreach ($table in $tables) {
        docker exec -i $Container psql -U myriad -d myriad -c "TRUNCATE TABLE $table CASCADE;" 2>&1 | Out-Null
    }
    Write-Host "Done!" -ForegroundColor Green
    exit 0
}

Write-Host "Use -Help for usage" -ForegroundColor Yellow
