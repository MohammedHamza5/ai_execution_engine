# Start local PostgreSQL instance for AI-Execution-Engine
$dataDir = "$env:USERPROFILE\scoop\apps\postgresql\current\data"
if (-not (Test-Path $dataDir)) {
    $dataDir = "$env:USERPROFILE\scoop\apps\postgresql\18.1\data"
}

if (-not (Test-Path $dataDir)) {
    Write-Host "[Postgres] Data directory not found at $dataDir. Trying docker..." -ForegroundColor Yellow
    docker compose up -d postgres
    exit 0
}

$pgProc = Get-Process postgres -ErrorAction SilentlyContinue
if ($pgProc) {
    Write-Host "[Postgres] PostgreSQL is already running (PID: $($pgProc[0].Id))." -ForegroundColor Green
    exit 0
}

Write-Host "[Postgres] Starting PostgreSQL from $dataDir..." -ForegroundColor Cyan
Start-Process "postgres.exe" -ArgumentList "-D `"$dataDir`"" -WindowStyle Hidden
Start-Sleep -Seconds 2

$check = Get-Process postgres -ErrorAction SilentlyContinue
if ($check) {
    Write-Host "[Postgres] PostgreSQL started successfully (PID: $($check[0].Id))." -ForegroundColor Green
} else {
    Write-Host "[Postgres] Failed to start PostgreSQL. Check data directory permissions." -ForegroundColor Red
}
