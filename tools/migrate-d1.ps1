param(
  [string]$Source = "",
  [string]$Output = "",
  [string]$Database = "mihonban",
  [switch]$IncludeConfig,
  [switch]$IncludeCache,
  [switch]$Replace,
  [switch]$ImportRemote
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Worker = Join-Path $Repo "cloud\worker"
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) { throw "Node 22+ is required." }

if (-not $Output) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $Output = Join-Path (Join-Path $Repo "backups") "mihonban-d1-$stamp.sql"
}
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null

$exportArgs = @("scripts/export-sqlite.mjs", "--output", $Output)
if ($Source) { $exportArgs += @("--source", [IO.Path]::GetFullPath($Source)) }
if ($IncludeConfig) { $exportArgs += "--include-config" }
if ($IncludeCache) { $exportArgs += "--include-cache" }
if ($Replace) {
  Write-Warning "-Replace clears included target tables before import."
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
  Write-Host "Importing into remote D1 '$Database'..." -ForegroundColor Yellow
  npx wrangler d1 execute $Database --remote --file $Output
  if ($LASTEXITCODE -ne 0) { throw "D1 import failed." }
  Write-Host "D1 data migration completed. Restore Admin config JSON separately." -ForegroundColor Green
} finally {
  Pop-Location
}
