param(
  [string]$Source = "",
  [string]$Output = "",
  [string]$Database = "mihonban",
  [string]$WranglerConfig = "",
  [switch]$IncludeConfig,
  [switch]$IncludeCache,
  [switch]$Replace,
  [switch]$ImportRemote,
  [switch]$SkipRemoteBackup
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Repo "cloud\worker"
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) { throw "Node 22+ is required." }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

if (-not $Output) {
  $Output = Join-Path (Join-Path $Repo "backups") "mihonban-d1-$stamp.sql"
}
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null

if (-not $WranglerConfig) {
  $localConfig = Join-Path $Worker "wrangler.local.jsonc"
  $WranglerConfig = if (Test-Path $localConfig) {
    $localConfig
  } else {
    Join-Path $Worker "wrangler.jsonc"
  }
}
$WranglerConfig = [IO.Path]::GetFullPath($WranglerConfig)
if (-not (Test-Path $WranglerConfig)) {
  throw "Wrangler config not found: $WranglerConfig"
}
$configArgs = @("--config", $WranglerConfig)

$exportArgs = @("scripts/export-sqlite.mjs", "--output", $Output)
if ($Source) { $exportArgs += @("--source", [IO.Path]::GetFullPath($Source)) }
if ($IncludeConfig) { $exportArgs += "--include-config" }
if ($IncludeCache) { $exportArgs += "--include-cache" }
if ($Replace) {
  Write-Warning "-Replace clears included catalog tables/config keys before import."
  $exportArgs += "--replace"
}

Push-Location $Worker
try {
  & $Node.Source @exportArgs
  if ($LASTEXITCODE -ne 0) { throw "SQLite export failed." }
  if (-not $ImportRemote) {
    Write-Host "Backup kept at $Output. Add -ImportRemote to write remote D1."
    return
  }
  if ($SkipRemoteBackup) {
    Write-Warning "Remote pre-import backup explicitly skipped."
  } else {
    $remoteBackup = Join-Path (Join-Path $Repo "backups") `
      "mihonban-remote-before-$stamp.sql"
    Write-Host "Backing up remote D1 to $remoteBackup..." -ForegroundColor Cyan
    npx wrangler d1 export $Database --remote --output $remoteBackup @configArgs
    if ($LASTEXITCODE -ne 0) { throw "Remote D1 backup failed; import aborted." }
  }
  Write-Host "Importing into remote D1 '$Database'..." -ForegroundColor Yellow
  npx wrangler d1 execute $Database --remote --file $Output @configArgs
  if ($LASTEXITCODE -ne 0) { throw "D1 import failed." }
  Write-Host "Verifying remote catalog counts..." -ForegroundColor Cyan
  $countSql = "SELECT (SELECT COUNT(*) FROM albums) AS albums, " +
    "(SELECT COUNT(*) FROM tracks) AS tracks, " +
    "(SELECT COUNT(*) FROM artists) AS artists;"
  npx wrangler d1 execute $Database --remote --command $countSql @configArgs
  if ($LASTEXITCODE -ne 0) { throw "Remote D1 verification failed." }
  Write-Host "D1 data migration completed. Restore Admin config JSON separately." -ForegroundColor Green
} finally {
  Pop-Location
}
