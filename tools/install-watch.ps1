# Install the mihonban inbox watcher: autostart vbs + desktop inbox shortcut.
# Paths come from MIHONBAN_CONFIG or the standard per-user config location.
# ASCII-only comments (PowerShell 5.1 GBK pitfall).
$ErrorActionPreference = "Stop"

function Resolve-MihonbanConfig {
  if ($env:MIHONBAN_CONFIG -and (Test-Path $env:MIHONBAN_CONFIG)) { return $env:MIHONBAN_CONFIG }
  $cands = @(
    (Join-Path $PWD "mihonban.toml"),
    (Join-Path $env:APPDATA "mihonban\config.toml")
  )
  foreach ($p in $cands) { if ($p -and (Test-Path $p)) { return $p } }
  throw "MIHONBAN_CONFIG not set and no config found. Run: mihonban setup"
}

function Read-TomlPath([string]$toml, [string]$key) {
  $line = Get-Content $toml | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $v = ($line -split "=", 2)[1].Trim().Trim("'").Trim('"')
  return $v
}

$cfgPath = Resolve-MihonbanConfig
$dataDir = Read-TomlPath $cfgPath "data_dir"
$inbox   = Read-TomlPath $cfgPath "inbox"
if (-not $dataDir) { throw "data_dir missing in $cfgPath" }
if (-not $inbox)   { throw "inbox missing in $cfgPath" }

# Expand ~ if present
if ($dataDir.StartsWith("~/") -or $dataDir.StartsWith("~\")) {
  $dataDir = Join-Path $HOME $dataDir.Substring(2)
}
if ($inbox.StartsWith("~/") -or $inbox.StartsWith("~\")) {
  $inbox = Join-Path $HOME $inbox.Substring(2)
}

$py = Join-Path $dataDir "venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  $pyCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pyCmd) { $py = $pyCmd.Source }
  else { throw "Python not found. Create venv under data_dir or put python on PATH." }
}

$appsDir = Join-Path $dataDir "apps\mihonban-watch"
New-Item -ItemType Directory -Force $appsDir | Out-Null
$logsDir = Join-Path $dataDir "logs"
New-Item -ItemType Directory -Force $logsDir | Out-Null
$vbs = Join-Path $appsDir "start-mihonban-watch.vbs"

$vbsBody = @"
' mihonban watch hidden launcher. Paths injected by install-watch.ps1.
Set sh = CreateObject("WScript.Shell")
sh.Environment("PROCESS")("MIHONBAN_CONFIG") = "$($cfgPath.Replace('\','\\'))"
sh.Environment("PROCESS")("PYTHONIOENCODING") = "utf-8"
sh.Run "cmd /c """"$($py.Replace('\','\\'))"" -m mihonban watch >> ""$($logsDir.Replace('\','\\'))\watch.log"" 2>&1""", 0, False
"@
$vbsBody | Out-File $vbs -Encoding ascii

$startup = [Environment]::GetFolderPath("Startup")
Copy-Item $vbs (Join-Path $startup "start-mihonban-watch.vbs") -Force

$desktop = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop "mihonban Inbox.lnk"))
$lnk.TargetPath = $inbox
$lnk.Description = "Drop RAR here - auto-ingest into your library"
$lnk.Save()

Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match "mihonban watch" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 1
wscript.exe $vbs

Write-Output "watcher installed (config=$cfgPath, inbox=$inbox)"
