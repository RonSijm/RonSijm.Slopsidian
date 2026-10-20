$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$packageDirectory = Join-Path $root 'node_modules\electron'
$package = Get-Content -Raw -LiteralPath (Join-Path $packageDirectory 'package.json') | ConvertFrom-Json
$destination = Join-Path $packageDirectory 'dist'
$versionFile = Join-Path $destination 'version'
if (Test-Path -LiteralPath (Join-Path $destination 'electron.exe')) {
    if ((Get-Content -Raw -LiteralPath $versionFile).Trim() -ne $package.version) {
        throw 'Installed Electron does not match the pinned package version.'
    }
    [System.IO.File]::WriteAllText((Join-Path $packageDirectory 'path.txt'), 'electron.exe')
    Write-Output "Electron $($package.version) is ready."
    exit 0
}
$filename = "electron-v$($package.version)-win32-x64.zip"
$checksums = Get-Content -Raw -LiteralPath (Join-Path $packageDirectory 'checksums.json') | ConvertFrom-Json
$expected = $checksums.$filename
if (-not $expected) {
    throw "No package-supplied checksum exists for $filename"
}
$runtime = Join-Path $root '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$archive = Join-Path $runtime $filename
Invoke-WebRequest -Uri "https://github.com/electron/electron/releases/download/v$($package.version)/$filename" -OutFile $archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Electron archive checksum mismatch.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
if ((Get-Content -Raw -LiteralPath $versionFile).Trim() -ne $package.version) {
    throw 'Extracted Electron does not match the pinned package version.'
}
[System.IO.File]::WriteAllText((Join-Path $packageDirectory 'path.txt'), 'electron.exe')
Remove-Item -LiteralPath $archive
Write-Output "Installed checksum-verified Electron $($package.version)."
