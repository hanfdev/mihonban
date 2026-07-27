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
# Blank passwords fall back to RANDOM values, never to a well-known default:
# a fixed string in a public repo would ship as a live credential whenever an
# operator leaves a prompt empty.
if (-not $SessionSecret) { $SessionSecret = Rand-Hex 32 }
if (-not $CompanionKey)  { $CompanionKey = Rand-Hex 24 }
$GeneratedPasswords = @()
if (-not $AppPassword)   { $AppPassword = Rand-Hex 8; $GeneratedPasswords += "listener" }
if (-not $AdminPassword) { $AdminPassword = Rand-Hex 8; $GeneratedPasswords += "admin" }

@"
APP_PASSWORD=$AppPassword
ADMIN_PASSWORD=$AdminPassword
SESSION_SECRET=$SessionSecret
COMPANION_KEY=$CompanionKey
"@ | Out-File -FilePath $OutFile -Encoding ascii -NoNewline

Write-Output "secrets -> $OutFile"
if ($GeneratedPasswords.Count) {
  Write-Output ("random password(s) generated for: {0} (see {1})" -f `
    ($GeneratedPasswords -join ", "), $OutFile)
}
