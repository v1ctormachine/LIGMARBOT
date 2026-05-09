# build.ps1 — Concatenates bot/modules/*.js (sorted by filename) into bot/bot.user.js.
# Run from the repo root or from anywhere; resolves paths relative to this script.
# Usage:   pwsh ./bot/build.ps1
#          (or)   powershell -File .\bot\build.ps1

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$modulesDir = Join-Path $here "modules"
$outFile = Join-Path $here "bot.user.js"

if (-not (Test-Path $modulesDir)) {
    throw "Module directory not found: $modulesDir"
}

$files = Get-ChildItem -Path $modulesDir -Filter "*.js" -File | Sort-Object Name
if (-not $files -or $files.Count -eq 0) {
    throw "No module files found in $modulesDir"
}

$parts = New-Object System.Collections.Generic.List[string]
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
foreach ($f in $files) {
    # Force UTF-8 read so non-ASCII characters (em dashes, etc.) survive concat unchanged.
    $text = [System.IO.File]::ReadAllText($f.FullName, $utf8NoBom)
    if ($null -eq $text) { $text = "" }
    # Normalize: ensure exactly one trailing newline so concat doesn't smash files together.
    $text = $text.TrimEnd("`r", "`n") + "`n"
    $parts.Add($text)
}

$bundle = [string]::Join("", $parts)
# Write UTF-8 without BOM to match the original artifact and keep Tampermonkey happy.
[System.IO.File]::WriteAllText($outFile, $bundle, $utf8NoBom)

$bytes = (Get-Item $outFile).Length
Write-Host "Built $outFile from $($files.Count) modules ($bytes bytes)"
foreach ($f in $files) {
    Write-Host "  + $($f.Name)"
}
