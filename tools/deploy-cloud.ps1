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
  [string]$RcloneRemote = "",
  [ValidateSet("", "weur", "eeur", "apac", "oc", "wnam", "enam")]
  [string]$D1Location = ""
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
$ConfiguredRclone = Read-TomlValue $Toml "rclone"
if (-not $RcloneRemote) {
  $RcloneRemote = Read-TomlValue $Toml "remote"
  if (-not $RcloneRemote) { $RcloneRemote = "mihonban:Music/Library" }
}
if ($DataDir.StartsWith("~/") -or $DataDir.StartsWith("~\")) {
  $DataDir = Join-Path $HOME $DataDir.Substring(2)
}
$Stage = if ($StageDir) { $StageDir } else { Join-Path $DataDir "tmp\cloud-build" }
$Py = Join-Path $DataDir "venv\Scripts\python.exe"
if (-not (Test-Path $Py)) {
  $pyCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pyCmd) {
    $Py = if ($pyCmd.Source) { $pyCmd.Source } else { $pyCmd.Name }
  } else {
    throw "Python not found under data_dir venv or PATH"
  }
}
$env:MIHONBAN_CONFIG = $Toml

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# PowerShell 5.1 turns native stderr redirected through 2>&1 into error records.
# With ErrorActionPreference=Stop, even a successful command that prints a
# warning can abort the wizard. Native exit codes are the source of truth.
function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory = $true)][string]$Description,
    [int[]]$SuccessCodes = @(0),
    [switch]$CaptureOutput,
    [switch]$DiscardStderr,
    [switch]$Quiet
  )
  if (-not (Get-Command $FilePath -ErrorAction SilentlyContinue)) {
    throw "$Description failed: command not found: $FilePath"
  }
  $nativeOutput = if ($DiscardStderr) {
    & {
      $ErrorActionPreference = "Continue"
      & $FilePath @ArgumentList 2>$null
    } | Out-String
  } else {
    & {
      $ErrorActionPreference = "Continue"
      & $FilePath @ArgumentList 2>&1
    } | Out-String
  }
  $nativeExitCode = $LASTEXITCODE
  if ($null -eq $nativeExitCode -or $SuccessCodes -notcontains $nativeExitCode) {
    throw "$Description failed (exit code $nativeExitCode):`n$nativeOutput"
  }
  if ($CaptureOutput) { return $nativeOutput }
  if (-not $Quiet -and $nativeOutput.Trim()) {
    Write-Host ($nativeOutput.TrimEnd())
  }
}

Step "Installing current Python pipeline"
Invoke-NativeChecked -FilePath $Py -Description "Pipeline install" `
  -ArgumentList @("-m", "pip", "install", "--disable-pip-version-check",
    "--no-input", "-e", "$Repo\pipeline") -Quiet

Step "Staging sources to $Stage (node_modules never touch OneDrive)"
Invoke-NativeChecked -FilePath "robocopy" -Description "Worker staging" `
  -ArgumentList @("$Repo\cloud\worker", "$Stage\worker", "/e", "/xd",
    "node_modules", "/njh", "/njs", "/ndl", "/nc", "/ns") `
  -SuccessCodes (0..7) -Quiet
Invoke-NativeChecked -FilePath "robocopy" -Description "Web staging" `
  -ArgumentList @("$Repo\cloud\web", "$Stage\web", "/e", "/xd",
    "node_modules", "dist", "/njh", "/njs", "/ndl", "/nc", "/ns") `
  -SuccessCodes (0..7) -Quiet

Step "Building frontend"
Push-Location "$Stage\web"
try {
  if (-not (Test-Path node_modules)) {
    Invoke-NativeChecked -FilePath "npm" -Description "Web dependency install" `
      -ArgumentList @("install", "--no-fund", "--no-audit") -Quiet
  }
  Invoke-NativeChecked -FilePath "npm" -Description "Frontend build" `
    -ArgumentList @("run", "build") -Quiet
} finally {
  Pop-Location
}

Push-Location "$Stage\worker"
try {
  if (-not (Test-Path node_modules)) {
    Invoke-NativeChecked -FilePath "npm" -Description "Worker dependency install" `
      -ArgumentList @("install", "--no-fund", "--no-audit") -Quiet
  }

  Step "Cloudflare login check"
  $who = Invoke-NativeChecked -FilePath "npx" -Description "Cloudflare login check" `
    -ArgumentList @("wrangler", "whoami") -SuccessCodes @(0, 1) `
    -CaptureOutput -DiscardStderr
  if ($who -notmatch "@|You are logged in") {
    Write-Host "A browser window will open - log in to your (free) Cloudflare account."
    Invoke-NativeChecked -FilePath "npx" -Description "Cloudflare login" `
      -ArgumentList @("wrangler", "login")
  }

  Step "Provisioning D1 database"
  $d1Json = Invoke-NativeChecked -FilePath "npx" -Description "D1 list" `
    -ArgumentList @("wrangler", "d1", "list", "--json") `
    -CaptureOutput -DiscardStderr
  $d1List = $d1Json | ConvertFrom-Json
  $db = $d1List | Where-Object { $_.name -eq "mihonban" }
  if (-not $db) {
    $d1CreateArgs = @("wrangler", "d1", "create", "mihonban")
    if ($D1Location) {
      $d1CreateArgs += @("--location", $D1Location)
    }
    Invoke-NativeChecked -FilePath "npx" -Description "D1 create" `
      -ArgumentList $d1CreateArgs -Quiet
    $d1Json = Invoke-NativeChecked -FilePath "npx" -Description "D1 list" `
      -ArgumentList @("wrangler", "d1", "list", "--json") `
      -CaptureOutput -DiscardStderr
    $db = ($d1Json | ConvertFrom-Json) | Where-Object { $_.name -eq "mihonban" }
  }
  $dbId = $db.uuid
  if ($dbId -notmatch '^[0-9a-fA-F-]{36}$') {
    throw "Could not resolve the mihonban D1 database ID."
  }
  Write-Host "    D1: $dbId"

  Step "Provisioning KV namespace"
  $kvJson = Invoke-NativeChecked -FilePath "npx" -Description "KV list" `
    -ArgumentList @("wrangler", "kv", "namespace", "list") `
    -CaptureOutput -DiscardStderr
  $kvList = $kvJson | ConvertFrom-Json
  $kv = $kvList | Where-Object {
    $_.title -in @("mihonban-kv", "mihonban.KV")
  } | Select-Object -First 1
  if (-not $kv) {
    Invoke-NativeChecked -FilePath "npx" -Description "KV create" `
      -ArgumentList @("wrangler", "kv", "namespace", "create",
        "mihonban-kv", "--binding", "KV") -Quiet
    $kvJson = Invoke-NativeChecked -FilePath "npx" -Description "KV list" `
      -ArgumentList @("wrangler", "kv", "namespace", "list") `
      -CaptureOutput -DiscardStderr
    $kv = ($kvJson | ConvertFrom-Json) |
      Where-Object { $_.title -eq "mihonban-kv" } | Select-Object -First 1
  }
  $kvId = $kv.id
  if ($kvId -notmatch '^[0-9a-fA-F]{32}$') {
    throw "Could not resolve the mihonban KV namespace ID."
  }
  Write-Host "    KV: $kvId"

  Step "Writing IDs into wrangler.jsonc"
  $cfg = Get-Content wrangler.jsonc -Raw
  $cfg = $cfg -replace '"database_id":\s*"[^"]*"', "`"database_id`": `"$dbId`""
  $cfg = $cfg -replace '"id":\s*"[0-9a-fA-F]{32}"', "`"id`": `"$kvId`""
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $PWD "wrangler.jsonc"), $cfg, $Utf8NoBom)

  Step "Applying schema to remote D1"
  Invoke-NativeChecked -FilePath "npx" -Description "Remote schema apply" `
    -ArgumentList @("wrangler", "d1", "execute", "mihonban", "--remote",
      "--file", "schema.sql") -Quiet

  Step "Secrets"
  if (-not $AppPassword) {
    $AppPassword = Read-Host "Set the LISTENER password (blank = random)"
  }
  if (-not $AdminPassword) {
    $AdminPassword = Read-Host "Set the ADMIN password (blank = random)"
  }
  # Dot-source instead of spawning a child powershell: passwords must not
  # appear on any process command line (readable via Win32_Process).
  # Blank passwords become random values inside make-cloud-secrets.ps1.
  # Dot-sourcing writes the child's param variables back into this scope,
  # so remember which prompts were blank before it runs.
  $ListenerWasBlank = -not $AppPassword
  $AdminWasBlank = -not $AdminPassword
  $tmpVars = Join-Path $env:TEMP "mihonban-secrets-$(Get-Random).env"
  $secretJson = Join-Path $env:TEMP "mihonban-secrets-$(Get-Random).json"
  try {
    . "$Repo\tools\make-cloud-secrets.ps1" `
      -OutFile $tmpVars -AppPassword $AppPassword `
      -AdminPassword $AdminPassword | Out-Null
    $vars = @{}
    Get-Content $tmpVars | ForEach-Object {
      $k, $v = $_ -split "=", 2
      if ($k) { $vars[$k] = $v }
    }
    $vars | ConvertTo-Json | Set-Content $secretJson -Encoding ascii
    Invoke-NativeChecked -FilePath "npx" -Description "Secret upload" `
      -ArgumentList @("wrangler", "secret", "bulk", $secretJson) -Quiet
  } finally {
    # An interrupted run must not leave plaintext secrets in %TEMP%.
    Remove-Item $tmpVars, $secretJson -Force -ErrorAction SilentlyContinue
  }
  Write-Host "    4 secrets uploaded (listener, admin, session, companion)"
  if ($ListenerWasBlank) {
    Write-Host ("    LISTENER password (random): {0}" -f $vars['APP_PASSWORD']) -ForegroundColor Yellow
  }
  if ($AdminWasBlank) {
    Write-Host ("    ADMIN password (random):    {0}" -f $vars['ADMIN_PASSWORD']) -ForegroundColor Yellow
  }

  Step "Deploying worker"
  $out = Invoke-NativeChecked -FilePath "npx" -Description "Worker deploy" `
    -ArgumentList @("wrangler", "deploy") -CaptureOutput
  Write-Host $out
  $url = [regex]::Match($out, "https://[A-Za-z0-9.-]+\.workers\.dev").Value
  if (-not $url) { throw "deploy output had no workers.dev URL" }

  Step "Writing [cloud] into $Toml"
  $rcloneBin = if ($ConfiguredRclone -and (Test-Path $ConfiguredRclone)) {
    $ConfiguredRclone
  } else {
    $rcCmd = Get-Command rclone -ErrorAction SilentlyContinue
    if ($rcCmd) { $rcCmd.Source } else { "" }
  }
  $rcloneEsc = $rcloneBin.Replace("\", "/")
  # PowerShell variable names are case-insensitive: `$toml` would overwrite
  # `$Toml` (the config path) and make WriteAllText treat the full document as
  # a file name. Keep content under an unambiguous name.
  $tomlContent = (Get-Content $Toml -Raw) -replace "(?ms)\r?\n\[cloud\].*?(?=(\r?\n\[)|\z)", ""
  $tomlContent += @"

[cloud]
url = "$url"
api_key = "$($vars['COMPANION_KEY'])"
rclone = "$rcloneEsc"
remote = "$RcloneRemote"
"@
  # Windows PowerShell 5.1's `-Encoding utf8` writes a BOM. Python tomllib
  # rejects a BOM at byte zero, so preserve this as BOM-less UTF-8.
  [IO.File]::WriteAllText($Toml, $tomlContent, $Utf8NoBom)

  Step "First sync (upload + register all albums)"
  $env:MIHONBAN_CONFIG = $Toml
  Invoke-NativeChecked -FilePath $Py -Description "First cloud sync" `
    -ArgumentList @("-m", "mihonban", "cloud", "sync")

  Step "Installing inbox watcher autostart + desktop shortcut"
  Invoke-NativeChecked -FilePath "powershell" -Description "Watcher install" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "$Repo\tools\install-watch.ps1")

  Write-Host ""
  Write-Host "================================================" -ForegroundColor Green
  Write-Host " mihonban cloud is LIVE: $url" -ForegroundColor Green
  if ($ListenerWasBlank -or $AdminWasBlank) {
    Write-Host " Login password: SAVE the random password(s) printed above." -ForegroundColor Yellow
  } else {
    Write-Host " Login password: the one you just set." -ForegroundColor Green
  }
  Write-Host " Phone: open the URL, 'Add to Home Screen' = app." -ForegroundColor Green
  Write-Host "================================================" -ForegroundColor Green
} finally {
  Pop-Location
}
