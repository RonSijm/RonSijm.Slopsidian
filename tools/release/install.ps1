#requires -Version 5.1
<#
Per-user installer for the unsigned Slopsidian Windows package.
Defaults install to %LOCALAPPDATA%\Programs\Slopsidian, add a Start Menu shortcut and an HKCU Uninstall entry.
Disposable/test use: -InstallDir <temp> [-NoShortcuts] [-NoRegistration]; a test registry entry must be
HKCU:\Software\SlopsidianPackagingTest\<name>. Environment equivalents (for the self-extracting Setup.exe):
SLOPSIDIAN_INSTALL_DIR, SLOPSIDIAN_NO_SHORTCUTS=1, SLOPSIDIAN_NO_REGISTRATION=1, SLOPSIDIAN_REGISTRY_PATH, SLOPSIDIAN_SHORTCUT_DIR.
The whole payload is validated and extracted to a sibling staging directory first; an existing install is only
replaced by renaming, and is restored if anything fails. User data and vaults are never touched.
It never writes protocol/file-association handlers.
#>
[CmdletBinding()]
param(
    [string]$PackageZip = (Join-Path $PSScriptRoot 'payload.zip'),
    [string]$InstallDir = $env:SLOPSIDIAN_INSTALL_DIR,
    [switch]$NoShortcuts,
    [switch]$NoRegistration,
    [string]$RegistryPath = $env:SLOPSIDIAN_REGISTRY_PATH,
    [string]$ShortcutDir = $env:SLOPSIDIAN_SHORTCUT_DIR
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

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
function Assert-NoReparsePoints([string]$Directory) {
    $item = Get-Item -LiteralPath $Directory -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing a link/reparse point: $Directory" }
    $link = Get-ChildItem -LiteralPath $Directory -Recurse -Force -Attributes ReparsePoint | Select-Object -First 1
    if ($link) { throw "Refusing a tree containing a link/reparse point: $($link.FullName)" }
}

if ($env:SLOPSIDIAN_NO_SHORTCUTS -eq '1') { $NoShortcuts = $true }
if ($env:SLOPSIDIAN_NO_REGISTRATION -eq '1') { $NoRegistration = $true }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Slopsidian' }
if (-not $RegistryPath) { $RegistryPath = $DefaultRegistryPath }
if (-not $ShortcutDir) { $ShortcutDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Slopsidian' }
if (-not $NoRegistration -and -not (Test-OwnedRegistryPath $RegistryPath)) { throw "Refusing a registry location other than the Slopsidian uninstall entry or HKCU:\Software\SlopsidianPackagingTest\<name>: $RegistryPath" }

$InstallDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$root = [System.IO.Path]::GetPathRoot($InstallDir)
if ($InstallDir -eq $root.TrimEnd('\') -or $InstallDir.Length -lt 12) { throw "Refusing to install into a drive root or very short path: $InstallDir" }
if (-not (Test-Path -LiteralPath $PackageZip -PathType Leaf)) { throw "Package archive not found: $PackageZip" }
$PackageZip = (Resolve-Path -LiteralPath $PackageZip).Path
$ShortcutDir = [System.IO.Path]::GetFullPath($ShortcutDir).TrimEnd('\')
if (-not $NoShortcuts -and ($ShortcutDir -eq [System.IO.Path]::GetPathRoot($ShortcutDir).TrimEnd('\') -or $ShortcutDir.Length -lt 12)) { throw "Refusing a drive root or very short shortcut directory: $ShortcutDir" }

$manifestName = 'install-manifest.json'
$manifestPath = Join-Path $InstallDir $manifestName
$previousExists = Test-Path -LiteralPath $InstallDir
if ($previousExists) {
    if (-not (Test-Path -LiteralPath $InstallDir -PathType Container)) { throw "Install path is not a directory: $InstallDir" }
    $existing = @(Get-ChildItem -LiteralPath $InstallDir -Force)
    if ($existing.Count -eq 0) { $previousExists = $false }
    elseif (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Refusing to install over a non-empty directory that Slopsidian did not create: $InstallDir" }
    else {
        Assert-NoReparsePoints $InstallDir
        $previous = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        if ($previous.product -ne 'Slopsidian' -or [System.IO.Path]::GetFullPath($previous.installDir).TrimEnd('\') -ne $InstallDir) { throw 'The existing install manifest does not describe this directory; refusing to replace it.' }
        $known = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in @($previous.files)) { [void]$known.Add(([string]$entry.path).Replace('/', '\')) }
        [void]$known.Add($manifestName)
        $prefix = $InstallDir + '\'
        $extras = @(Get-ChildItem -LiteralPath $InstallDir -Recurse -File -Force | Where-Object { -not $known.Contains($_.FullName.Substring($prefix.Length)) })
        if ($extras.Count -gt 0) { throw "Refusing to replace an install containing files Slopsidian did not install (first: $($extras[0].FullName)). Move or remove them first." }
    }
}

New-Item -ItemType Directory -Path (Split-Path -Parent $InstallDir) -Force | Out-Null
$staging = "$InstallDir.staging-$([guid]::NewGuid().ToString('N'))"
$backup = "$InstallDir.previous-$([guid]::NewGuid().ToString('N'))"
$swapped = $false; $movedPrevious = $false; $createdShortcut = $null; $createdRegistry = $null
$records = New-Object System.Collections.Generic.List[object]
try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    $archive = [System.IO.Compression.ZipFile]::OpenRead($PackageZip)
    try {
        $seen = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            if (-not (Test-SafeRelativePath $entry.FullName)) { throw "Unsafe archive entry: $($entry.FullName)" }
            if ($entry.FullName -eq 'portable.txt') { continue }
            if ($entry.FullName -ieq $manifestName -or $entry.FullName -ieq 'uninstall.ps1') { throw "Archive entry collides with installer metadata: $($entry.FullName)" }
            if (-not $seen.Add($entry.FullName)) { throw "Duplicate archive entry: $($entry.FullName)" }
            $destination = [System.IO.Path]::GetFullPath((Join-Path $staging $entry.FullName.Replace('/', '\')))
            if (-not $destination.StartsWith($staging + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Archive entry escapes the install directory: $($entry.FullName)" }
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
            $records.Add([ordered]@{ path = $entry.FullName; sha256 = (Get-Sha256 $destination) })
        }
    } finally { $archive.Dispose() }

    $uninstallSource = Join-Path $PSScriptRoot 'uninstall.ps1'
    if (-not (Test-Path -LiteralPath $uninstallSource -PathType Leaf)) { throw 'uninstall.ps1 is missing next to the installer.' }
    Copy-Item -LiteralPath $uninstallSource -Destination (Join-Path $staging 'uninstall.ps1')
    $records.Add([ordered]@{ path = 'uninstall.ps1'; sha256 = (Get-Sha256 (Join-Path $staging 'uninstall.ps1')) })

    if (-not (Test-Path -LiteralPath (Join-Path $staging 'Slopsidian.exe') -PathType Leaf)) { throw 'The package did not contain Slopsidian.exe.' }
    $versionFile = Join-Path $staging 'resources\app\package.json'
    if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) { throw 'The package did not contain resources\app\package.json.' }
    $version = (Get-Content -Raw -LiteralPath $versionFile | ConvertFrom-Json).version
    $shortcutPath = if ($NoShortcuts) { $null } else { Join-Path $ShortcutDir 'Slopsidian.lnk' }
    $registryRecorded = if ($NoRegistration) { $null } else { $RegistryPath }
    [ordered]@{
        schemaVersion = 2; product = 'Slopsidian'; version = $version; installedUtc = [DateTime]::UtcNow.ToString('o')
        installDir = $InstallDir; shortcut = $shortcutPath; registryPath = $registryRecorded
        files = @($records | Sort-Object { $_.path })
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $staging $manifestName) -Encoding UTF8
    Assert-NoReparsePoints $staging

    # Commit: both steps are renames, so a locked or failing replacement leaves the previous install intact.
    if ($previousExists) { Move-Item -LiteralPath $InstallDir -Destination $backup; $movedPrevious = $true }
    Move-Item -LiteralPath $staging -Destination $InstallDir
    $swapped = $true

    $executable = Join-Path $InstallDir 'Slopsidian.exe'
    if ($shortcutPath) {
        New-Item -ItemType Directory -Path $ShortcutDir -Force | Out-Null
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut($shortcutPath)
        $link.TargetPath = $executable; $link.WorkingDirectory = $InstallDir; $link.Description = 'Slopsidian (unsigned build)'
        $link.Save()
        $createdShortcut = $shortcutPath
    }
    if ($registryRecorded) {
        $uninstall = '"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}"' -f (Join-Path $PSHOME 'powershell.exe'), (Join-Path $InstallDir 'uninstall.ps1')
        $size = [int](($records | ForEach-Object { (Get-Item -LiteralPath (Join-Path $InstallDir $_.path.Replace('/', '\'))).Length } | Measure-Object -Sum).Sum / 1KB)
        New-Item -Path $RegistryPath -Force | Out-Null
        $createdRegistry = $RegistryPath
        $values = @{ DisplayName = 'Slopsidian'; DisplayVersion = $version; Publisher = 'Slopsidian (unsigned build)'; InstallLocation = $InstallDir; DisplayIcon = $executable; UninstallString = $uninstall; QuietUninstallString = $uninstall + ' -Quiet' }
        foreach ($name in $values.Keys) { Set-ItemProperty -Path $RegistryPath -Name $name -Value $values[$name] }
        Set-ItemProperty -Path $RegistryPath -Name EstimatedSize -Value $size -Type DWord
        Set-ItemProperty -Path $RegistryPath -Name NoModify -Value 1 -Type DWord
        Set-ItemProperty -Path $RegistryPath -Name NoRepair -Value 1 -Type DWord
    }
    # The new install and its registration are committed. Old-file cleanup can fail partway through,
    # so its partially removed backup must never become the source of a rollback.
    if ($movedPrevious) {
        try { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction Stop }
        catch { Write-Warning "Slopsidian is installed, but some previous-install files remain at '$backup': $($_.Exception.Message)" }
    }
    Write-Output "Installed Slopsidian $version to $InstallDir ($($records.Count + 1) files; shortcut: $([bool]$shortcutPath); registry: $([bool]$registryRecorded))."
} catch {
    $failure = $_
    $problems = @()
    try {
        if ($createdShortcut -and -not $movedPrevious) { Remove-Item -LiteralPath $createdShortcut -Force -ErrorAction Stop }
        if ($createdRegistry -and -not $movedPrevious -and (Test-OwnedRegistryPath $createdRegistry)) { Remove-Item -Path $createdRegistry -Force -ErrorAction Stop }
        if ($swapped) { Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction Stop }
        if ($movedPrevious) { Move-Item -LiteralPath $backup -Destination $InstallDir -ErrorAction Stop }
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction Stop }
    } catch { $problems += "Rollback incomplete: $($_.Exception.Message)" }
    throw ("Install failed and was rolled back: " + $failure.Exception.Message + $(if ($problems) { ' ' + ($problems -join ' ') } else { '' }))
}
