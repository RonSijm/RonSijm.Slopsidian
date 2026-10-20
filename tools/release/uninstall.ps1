#requires -Version 5.1
<#
Removes only the files recorded (with SHA-256) by install.ps1, plus its exact shortcut and registry entry.
User data (%APPDATA%\Slopsidian or a portable Data folder) and vaults are ALWAYS preserved; this script has no
option to delete them. Records are validated before anything is removed; a tampered manifest is refused.
Files modified since installation are kept and reported.
#>
[CmdletBinding()]
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'

$DefaultRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Slopsidian'
function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try { return ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($stream)) -replace '-', '').ToLowerInvariant() } finally { $stream.Dispose() }
}
function Test-OwnedRegistryPath([string]$Path) {
    return ($Path -ieq $DefaultRegistryPath) -or ($Path -match '^HKCU:\\Software\\SlopsidianPackagingTest\\[A-Za-z0-9._-]+$')
}
function Test-SafeRelativePath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.StartsWith('/') -or $Path.Contains('\') -or $Path.Contains(':')) { return $false }
    $invalid = [System.IO.Path]::GetInvalidFileNameChars()
    foreach ($part in $Path.Split('/')) {
        if ($part -eq '' -or $part -eq '.' -or $part -eq '..' -or $part.IndexOfAny($invalid) -ge 0 -or $part.EndsWith(' ') -or $part.EndsWith('.')) { return $false }
    }
    return $true
}
function Test-Linked([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return [bool]($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint))
}

$InstallDir = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$manifestPath = Join-Path $InstallDir 'install-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "No Slopsidian install manifest in $InstallDir; refusing to delete anything." }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.product -ne 'Slopsidian' -or $manifest.schemaVersion -ne 2 -or [System.IO.Path]::GetFullPath([string]$manifest.installDir).TrimEnd('\') -ne $InstallDir) {
    throw 'The install manifest does not describe this directory; refusing to delete anything.'
}
if (Test-Linked $InstallDir) { throw "Refusing to uninstall through a link: $InstallDir" }

# Validate every record before removing anything.
$plan = New-Object System.Collections.Generic.List[object]
foreach ($entry in @($manifest.files)) {
    $relative = [string]$entry.path
    if (-not (Test-SafeRelativePath $relative) -or [string]$entry.sha256 -notmatch '^[0-9a-f]{64}$') { throw "Tampered manifest entry: $relative" }
    $target = [System.IO.Path]::GetFullPath((Join-Path $InstallDir $relative.Replace('/', '\')))
    if (-not $target.StartsWith($InstallDir + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Manifest entry escapes the install directory: $relative" }
    $cursor = $target
    while ($cursor.Length -gt $InstallDir.Length) {
        if (Test-Linked $cursor) { throw "Refusing to remove through a link: $cursor" }
        $cursor = Split-Path -Parent $cursor
    }
    $plan.Add([pscustomobject]@{ Target = $target; Hash = [string]$entry.sha256 })
}
$executable = Join-Path $InstallDir 'Slopsidian.exe'
$shortcut = $null
if ($manifest.shortcut) {
    $shortcut = [System.IO.Path]::GetFullPath([string]$manifest.shortcut)
    if ((Split-Path -Leaf $shortcut) -ne 'Slopsidian.lnk' -or -not [System.IO.Path]::IsPathRooted($shortcut)) { throw "Tampered shortcut record: $shortcut" }
}
$registry = $null
if ($manifest.registryPath) {
    $registry = [string]$manifest.registryPath
    if (-not (Test-OwnedRegistryPath $registry)) { throw "Tampered registry record: $registry" }
}

$problems = New-Object System.Collections.Generic.List[string]
$kept = New-Object System.Collections.Generic.List[string]
$directories = New-Object System.Collections.Generic.HashSet[string]
$self = [System.IO.Path]::GetFullPath($PSCommandPath)
foreach ($item in $plan) {
    [void]$directories.Add((Split-Path -Parent $item.Target))
    if (-not (Test-Path -LiteralPath $item.Target -PathType Leaf)) { continue }
    if ((Get-Sha256 $item.Target) -ne $item.Hash) { $kept.Add($item.Target); continue }
    try { Remove-Item -LiteralPath $item.Target -Force -ErrorAction Stop } catch { $problems.Add("Could not remove $($item.Target): $($_.Exception.Message)") }
}
try { Remove-Item -LiteralPath $manifestPath -Force -ErrorAction Stop } catch { $problems.Add("Could not remove the install manifest: $($_.Exception.Message)") }
foreach ($directory in $directories | Sort-Object Length -Descending) {
    $current = $directory
    while ($current.Length -gt $InstallDir.Length -and (Test-Path -LiteralPath $current -PathType Container) -and -not (Get-ChildItem -LiteralPath $current -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $current -Force
        $current = Split-Path -Parent $current
    }
}

if ($shortcut -and (Test-Path -LiteralPath $shortcut -PathType Leaf)) {
    $targetPath = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if ($targetPath -ieq $executable) {
        try {
            Remove-Item -LiteralPath $shortcut -Force -ErrorAction Stop
            $shortcutDirectory = Split-Path -Parent $shortcut
            if ((Split-Path -Leaf $shortcutDirectory) -eq 'Slopsidian' -and -not (Get-ChildItem -LiteralPath $shortcutDirectory -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $shortcutDirectory -Force }
        } catch { $problems.Add("Could not remove the shortcut: $($_.Exception.Message)") }
    } else { $kept.Add($shortcut + ' (not a shortcut to this install)') }
}
if ($registry -and (Test-Path -Path $registry)) {
    $location = (Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue).InstallLocation
    if ($location -and [System.IO.Path]::GetFullPath($location).TrimEnd('\') -ieq $InstallDir -and -not (Get-ChildItem -Path $registry -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        try { Remove-Item -Path $registry -Force -ErrorAction Stop } catch { $problems.Add("Could not remove $registry : $($_.Exception.Message)") }
    } else { $kept.Add($registry + ' (not owned by this install)') }
}

# This script is removed with the other manifest entries only when its recorded hash matches; a modified or unrecorded copy is retained.
if ((Test-Path -LiteralPath $self -PathType Leaf) -and -not ($kept -contains $self)) { $kept.Add($self + ' (not an unmodified recorded file)') }
if (-not (Get-ChildItem -LiteralPath $InstallDir -Force | Select-Object -First 1)) {
    try { Remove-Item -LiteralPath $InstallDir -Force -ErrorAction Stop } catch { $problems.Add("Could not remove the install directory: $($_.Exception.Message)") }
}
if (-not $Quiet) {
    Write-Output "Removed Slopsidian from $InstallDir. User data and vaults were preserved."
    foreach ($path in $kept) { Write-Output "Kept (modified or not owned): $path" }
}
if ($problems.Count -gt 0) { throw ("Uninstall incomplete:`n" + ($problems -join "`n")) }
