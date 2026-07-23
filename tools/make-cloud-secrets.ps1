# Generate the Worker's local/deploy secrets. Storage credentials are added
# through the administrator UI and are never read from a personal rclone file.
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less UTF-8 as GBK
# and a non-ASCII comment here would corrupt the param() block.
param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$AppPassword = "",
  [string]$AdminPassword = "",
  [string]$SessionSecret = "",
  [string]$CompanionKey = ""
)
$ErrorActionPreference = "Stop"

function Rand-Hex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ($b | ForEach-Object { $_.ToString("x2") }) -join ""
}
if (-not $SessionSecret) { $SessionSecret = Rand-Hex 32 }
if (-not $CompanionKey)  { $CompanionKey = Rand-Hex 24 }
if (-not $AppPassword)   { $AppPassword = "mihonban-guest" }
if (-not $AdminPassword) { $AdminPassword = "mihonban-admin" }

@"
APP_PASSWORD=$AppPassword
ADMIN_PASSWORD=$AdminPassword
SESSION_SECRET=$SessionSecret
COMPANION_KEY=$CompanionKey
"@ | Out-File -FilePath $OutFile -Encoding ascii -NoNewline

Write-Output "secrets -> $OutFile"
