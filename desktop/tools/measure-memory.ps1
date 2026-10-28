# measure-memory.ps1 - Samples the Mihonban client's memory footprint over time.
#
# Usage (PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\measure-memory.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\measure-memory.ps1 `
#       -ProcessName mihonban_desktop -IntervalSeconds 0.5 -DurationSeconds 0 -OutFile C:\Temp\mem.csv
#
# DurationSeconds 0 samples until Ctrl+C, so a scenario can be driven by hand
# (connect -> browse -> play -> tray). Every sample is appended to the CSV so
# phases can be correlated afterwards by timestamp.

param(
    [string]$ProcessName = "mihonban_desktop",
    [double]$IntervalSeconds = 0.5,
    [int]$DurationSeconds = 0,
    [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutFile = Join-Path $env:TEMP "mihonban-mem-$stamp.csv"
}

# Pure-ASCII CSV keeps PowerShell 5.1 append semantics simple (no BOM churn).
"seconds,timestamp_local,state,working_set_mb,private_mb" | Set-Content -Path $OutFile -Encoding Ascii

$start = Get-Date
$peakWorkingSet = 0.0
$peakPrivate = 0.0

Write-Host "Sampling '$ProcessName' every $IntervalSeconds s into $OutFile"
Write-Host "Duration: $(if ($DurationSeconds -gt 0) { "$DurationSeconds s" } else { 'until Ctrl+C' })"

while ($true) {
    Start-Sleep -Milliseconds ([int][Math]::Max(50, $IntervalSeconds * 1000))
    $elapsed = ((Get-Date) - $start).TotalSeconds

    $process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
        Sort-Object -Property WorkingSet64 -Descending |
        Select-Object -First 1

    if ($null -eq $process) {
        $state = "not-running"
        $workingSetMb = ""
        $privateMb = ""
        Write-Host ("`r[{0,7:N1}s] {1}                                        " -f $elapsed, $state) -NoNewline
    } else {
        $state = "running"
        $workingSetMb = [Math]::Round($process.WorkingSet64 / 1MB, 1)
        $privateMb = [Math]::Round($process.PrivateMemorySize64 / 1MB, 1)
        if ($workingSetMb -gt $peakWorkingSet) { $peakWorkingSet = $workingSetMb }
        if ($privateMb -gt $peakPrivate) { $peakPrivate = $privateMb }
        Write-Host ("`r[{0,7:N1}s] working set {1,7:N1} MB | private {2,7:N1} MB | peaks {3,7:N1} / {4,7:N1} MB" -f $elapsed, $workingSetMb, $privateMb, $peakWorkingSet, $peakPrivate) -NoNewline
    }

    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $seconds = $elapsed.ToString("0.0", [System.Globalization.CultureInfo]::InvariantCulture)
    Add-Content -Path $OutFile -Value ("{0},{1},{2},{3},{4}" -f $seconds, $timestamp, $state, $workingSetMb, $privateMb) -Encoding Ascii

    if ($DurationSeconds -gt 0 -and $elapsed -ge $DurationSeconds) { break }
}

Write-Host ""
if ($peakWorkingSet -gt 0) {
    Write-Host ("Peak working set {0:N1} MB, peak private {1:N1} MB" -f $peakWorkingSet, $peakPrivate)
}
Write-Host "CSV written to $OutFile"
