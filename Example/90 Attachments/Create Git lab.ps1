[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
$demoExampleRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$demoDestination = [IO.Path]::GetFullPath($Destination)
$demoBundle = Join-Path $PSScriptRoot 'Workshop history.bundle'
if ($demoDestination.Equals($demoExampleRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $demoDestination.StartsWith($demoExampleRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a new folder outside the Example vault so the lab is a separate repository.'
}
if (Test-Path -LiteralPath $demoDestination) {
    throw "Destination already exists: $demoDestination"
}
if (-not (Test-Path -LiteralPath $demoBundle -PathType Leaf)) {
    throw "Missing demo bundle: $demoBundle"
}

& git -c core.fsmonitor=false -c init.templateDir= clone --quiet -- $demoBundle $demoDestination
if ($LASTEXITCODE -ne 0) { throw 'Could not clone the local demo bundle.' }
& git -C $demoDestination branch --no-track indoor-route refs/remotes/origin/indoor-route
if ($LASTEXITCODE -ne 0) { throw 'Could not preserve the alternate demo branch.' }
& git -C $demoDestination remote remove origin
if ($LASTEXITCODE -ne 0) { throw 'Could not remove the local bundle origin.' }
& git -C $demoDestination config core.fsmonitor false
if ($LASTEXITCODE -ne 0) { throw 'Could not configure the demo repository.' }
$demoGitInfo = Join-Path $demoDestination '.git/info'
$null = New-Item -ItemType Directory -Path $demoGitInfo -Force
$demoExclude = Join-Path $demoGitInfo 'exclude'
if (-not (Test-Path -LiteralPath $demoExclude -PathType Leaf)) {
    '# Local exclusions for the standalone workshop lab.' | Set-Content -LiteralPath $demoExclude -Encoding utf8NoBOM
}

$demoConfig = Join-Path $demoDestination '.obsidian'
$demoPluginDestination = Join-Path $demoConfig 'plugins/obsidian-git'
$null = New-Item -ItemType Directory -Path $demoPluginDestination -Force
$demoPluginSource = Join-Path $demoExampleRoot '.obsidian/plugins/obsidian-git'
foreach ($demoFile in @('main.js', 'manifest.json', 'styles.css')) {
    $demoSource = Join-Path $demoPluginSource $demoFile
    if (Test-Path -LiteralPath $demoSource -PathType Leaf) {
        Copy-Item -LiteralPath $demoSource -Destination (Join-Path $demoPluginDestination $demoFile)
    }
}
$demoGitSettings = @{
    disablePush = $true
    autoSaveInterval = 0
    autoPushInterval = 0
    autoPullInterval = 0
    autoPullOnBoot = $false
    autoBackupAfterFileChange = $false
    refreshSourceControl = $false
    showStatusBar = $true
}
$demoGitSettings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $demoPluginDestination 'data.json') -Encoding utf8NoBOM
'[]' | Set-Content -LiteralPath (Join-Path $demoConfig 'community-plugins.json') -Encoding utf8NoBOM

Write-Output "Created local Git lab: $demoDestination"
Write-Output 'Open this folder as a separate vault, then enable its included Git plugin if supported.'
Write-Output 'The lab has fictional commit history, no remotes, push disabled and automatic Git routines off.'
