# mihonban cloud one-command deploy wizard.
# ASCII-only comments (PowerShell 5.1 reads BOM-less UTF-8 as GBK).
# Steps: stage -> build -> wrangler login -> D1/KV provision -> schema ->
#        random secrets -> deploy -> write [cloud] into mihonban.toml ->
#        first sync -> install watcher autostart.
param(
  [string]$AppPassword = "",
  [string]$AdminPassword = "",
  [string]$ConfigPath = "",
  [string]$StageDir = "",
  [string]$RcloneRemote = "mihonban:Music/Library"
)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

function Resolve-MihonbanConfig {
  if ($ConfigPath -and (Test-Path $ConfigPath)) { return (Resolve-Path $ConfigPath).Path }
  if ($env:MIHONBAN_CONFIG -and (Test-Path $env:MIHONBAN_CONFIG)) { return $env:MIHONBAN_CONFIG }
  foreach ($p in @(
    (Join-Path $PWD "mihonban.toml"),
    (Join-Path $env:APPDATA "mihonban\config.toml")
  )) { if ($p -and (Test-Path $p)) { return $p } }
  throw "No mihonban config found. Run: mihonban setup   or pass -ConfigPath"
}

function Read-TomlValue([string]$toml, [string]$key) {
  $line = Get-Content $toml | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return (($line -split "=", 2)[1].Trim().Trim("'").Trim('"'))
}

$Toml = Resolve-MihonbanConfig
$DataDir = Read-TomlValue $Toml "data_dir"
if (-not $DataDir) { throw "data_dir missing in $Toml" }
if ($DataDir.StartsWith("~/") -or $DataDir.StartsWith("~\")) {
  $DataDir = Join-Path $HOME $DataDir.Substring(2)
}
$Stage = if ($StageDir) { $StageDir } else { Join-Path $DataDir "tmp\cloud-build" }
$Py = Join-Path $DataDir "venv\Scripts\python.exe"
if (-not (Test-Path $Py)) {
  $pyCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pyCmd) { $Py = $pyCmd.Source } else { throw "Python not found under data_dir venv or PATH" }
}
$env:MIHONBAN_CONFIG = $Toml

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

Step "Staging sources to $Stage (node_modules never touch OneDrive)"
robocopy "$Repo\cloud\worker" "$Stage\worker" /e /xd node_modules /njh /njs /ndl /nc /ns | Out-Null
robocopy "$Repo\cloud\web" "$Stage\web" /e /xd node_modules dist /njh /njs /ndl /nc /ns | Out-Null

Step "Building frontend"
Push-Location "$Stage\web"
if (-not (Test-Path node_modules)) { npm install --no-fund --no-audit | Out-Null }
npm run build | Out-Null
Pop-Location

Push-Location "$Stage\worker"
try {
  if (-not (Test-Path node_modules)) { npm install --no-fund --no-audit | Out-Null }

  Step "Cloudflare login check"
  $who = npx wrangler whoami 2>&1 | Out-String
  if ($who -notmatch "@|You are logged in") {
    Write-Host "A browser window will open - log in to your (free) Cloudflare account."
    npx wrangler login
  }

  Step "Provisioning D1 database"
  $d1List = npx wrangler d1 list --json 2>$null | ConvertFrom-Json
  $db = $d1List | Where-Object { $_.name -eq "mihonban" }
  if (-not $db) {
    $null = npx wrangler d1 create mihonban 2>&1
    $db = (npx wrangler d1 list --json | ConvertFrom-Json) |
      Where-Object { $_.name -eq "mihonban" }
  }
  $dbId = $db.uuid
  Write-Host "    D1: $dbId"

  Step "Provisioning KV namespace"
  $kvList = npx wrangler kv namespace list --json 2>$null | ConvertFrom-Json
  $kv = $kvList | Where-Object { $_.title -match "mihonban.KV$" }
  if (-not $kv) {
    $null = npx wrangler kv namespace create KV 2>&1
    $kv = (npx wrangler kv namespace list --json | ConvertFrom-Json) |
      Where-Object { $_.title -match "mihonban.KV$" }
  }
  $kvId = $kv.id
  Write-Host "    KV: $kvId"

  Step "Writing IDs into wrangler.jsonc"
  $cfg = Get-Content wrangler.jsonc -Raw
  $cfg = $cfg -replace '"database_id":\s*"[^"]*"', "`"database_id`": `"$dbId`""
  $cfg = $cfg -replace '"id":\s*"0{32}"', "`"id`": `"$kvId`""
  Set-Content wrangler.jsonc $cfg -Encoding utf8

  Step "Applying schema to remote D1"
  npx wrangler d1 execute mihonban --remote --file schema.sql | Out-Null

  Step "Secrets"
  if (-not $AppPassword) {
    $AppPassword = Read-Host "Set the LISTENER password (share with friends)"
  }
  if (-not $AdminPassword) {
    $AdminPassword = Read-Host "Set the ADMIN password (yours only)"
  }
  $tmpVars = Join-Path $env:TEMP "mihonban-secrets-$(Get-Random).env"
  & powershell -NoProfile -ExecutionPolicy Bypass `
    -File "$Repo\tools\make-cloud-secrets.ps1" `
    -OutFile $tmpVars -AppPassword $AppPassword `
    -AdminPassword $AdminPassword | Out-Null
  $vars = @{}
  Get-Content $tmpVars | ForEach-Object {
    $k, $v = $_ -split "=", 2
    if ($k) { $vars[$k] = $v }
  }
  Remove-Item $tmpVars -Force
  $secretJson = Join-Path $env:TEMP "mihonban-secrets-$(Get-Random).json"
  $vars | ConvertTo-Json | Set-Content $secretJson -Encoding ascii
  npx wrangler secret bulk $secretJson | Out-Null
  Remove-Item $secretJson -Force
  Write-Host "    4 secrets uploaded (listener, admin, session, companion)"

  Step "Deploying worker"
  $out = npx wrangler deploy 2>&1 | Out-String
  Write-Host $out
  $url = [regex]::Match($out, "https://\S+\.workers\.dev").Value
  if (-not $url) { throw "deploy output had no workers.dev URL" }

  Step "Writing [cloud] into $Toml"
  $rcloneBin = ""
  $rcCmd = Get-Command rclone -ErrorAction SilentlyContinue
  if ($rcCmd) { $rcloneBin = $rcCmd.Source }
  $rcloneEsc = $rcloneBin.Replace("\", "/")
  $toml = (Get-Content $Toml -Raw) -replace "(?ms)\r?\n\[cloud\].*?(?=(\r?\n\[)|\z)", ""
  $toml += @"

[cloud]
url = "$url"
api_key = "$($vars['COMPANION_KEY'])"
rclone = "$rcloneEsc"
remote = "$RcloneRemote"
"@
  Set-Content $Toml $toml -Encoding utf8

  Step "First sync (upload + register all albums)"
  $env:MIHONBAN_CONFIG = $Toml
  & $Py -m mihonban cloud sync

  Step "Installing inbox watcher autostart + desktop shortcut"
  & powershell -NoProfile -ExecutionPolicy Bypass `
    -File "$Repo\tools\install-watch.ps1"

  Write-Host ""
  Write-Host "================================================" -ForegroundColor Green
  Write-Host " mihonban cloud is LIVE: $url" -ForegroundColor Green
  Write-Host " Login password: the one you just set." -ForegroundColor Green
  Write-Host " Phone: open the URL, 'Add to Home Screen' = app." -ForegroundColor Green
  Write-Host "================================================" -ForegroundColor Green
} finally {
  Pop-Location
}
