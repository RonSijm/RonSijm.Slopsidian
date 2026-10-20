param(
    [Parameter(Mandatory = $true)][string] $FixtureRoot,
    [string] $ImagePath,
    [string] $TextBase64
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
if ($ImagePath) {
    $clipboardFixture = Get-Item -LiteralPath $FixtureRoot
    $clipboardImage = Get-Item -LiteralPath $ImagePath
    $clipboardPrefix = $clipboardFixture.FullName.TrimEnd('\') + '\'
    if (-not $clipboardFixture.PSIsContainer -or $clipboardImage.PSIsContainer -or -not $clipboardImage.FullName.StartsWith($clipboardPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Clipboard image must be an ordinary file inside the disposable fixture.'
    }
    $clipboardEntry = $clipboardImage
    while ($clipboardEntry -and $clipboardEntry.FullName -ne $clipboardFixture.FullName) {
        if ($clipboardEntry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Clipboard fixture links are not supported.' }
        $clipboardEntry = if ($clipboardEntry.PSIsContainer) { $clipboardEntry.Parent } else { $clipboardEntry.Directory }
    }
    Add-Type -AssemblyName System.Drawing
    $clipboardBitmap = [Drawing.Image]::FromFile($clipboardImage.FullName)
    try { [Windows.Forms.Clipboard]::SetImage($clipboardBitmap) }
    finally { $clipboardBitmap.Dispose() }
} elseif ($TextBase64) {
    $clipboardText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
    if ($clipboardText.Length -gt 4096) { throw 'Test clipboard text is too long.' }
    [Windows.Forms.Clipboard]::SetText($clipboardText)
} else {
    throw 'Supply one image path or Base64 text for the test clipboard.'
}
