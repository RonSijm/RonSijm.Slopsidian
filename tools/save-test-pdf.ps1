param(
    [Parameter(Mandatory = $true)][int]$BrowserProcessId,
    [string]$File,
    [string]$OutputDirectory,
    [switch]$Cancel,
    [ValidateRange(1, 30)][int]$FindTimeoutSeconds = 20,
    [ValidateRange(1, 30)][int]$CloseTimeoutSeconds = 10,
    [long]$ExpectedWindowHandle = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class SaveTestPdf
{
    private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int maximum);
    [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr window, int identifier);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] private static extern IntPtr SendText(IntPtr window, uint message, IntPtr parameter, string text);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] private static extern IntPtr ReadText(IntPtr window, uint message, IntPtr parameter, StringBuilder text);

    public static void SetFilename(IntPtr dialog, string value)
    {
        // Observed on the actual Common Item Dialog: UIA exposes this native
        // Edit 1001 as ControlType.Pane with no ValuePattern. The address toolbar
        // also has ID 1001, so require the Edit class and its ComboBox parent.
        var field = IntPtr.Zero;
        var matches = 0;
        var ready = System.Diagnostics.Stopwatch.StartNew();
        do {
            field = IntPtr.Zero; matches = 0;
            EnumChildWindows(dialog, (window, parameter) => {
                var name = new StringBuilder(256);
                GetClassName(window, name, name.Capacity);
                if (GetDlgCtrlID(window) != 1001 || name.ToString() != "Edit" || !IsWindowVisible(window) || !IsWindowEnabled(window)) return true;
                var parentName = new StringBuilder(256);
                GetClassName(GetParent(window), parentName, parentName.Capacity);
                if (parentName.ToString() != "ComboBox") return true;
                field = window; matches++; return true;
            }, IntPtr.Zero);
            if (matches != 0) break;
            System.Threading.Thread.Sleep(50);
        } while (ready.ElapsedMilliseconds < 5000);
        if (matches != 1) throw new InvalidOperationException("The owned Save dialog must have exactly one supported native filename field (Edit 1001 under ComboBox); found " + matches + ".");
        if (SendText(field, 0x000c, IntPtr.Zero, value) == IntPtr.Zero) throw new InvalidOperationException("The owned filename field refused its text.");
        var actual = new StringBuilder(32768);
        ReadText(field, 0x000d, new IntPtr(actual.Capacity), actual);
        if (!String.Equals(actual.ToString(), value, StringComparison.Ordinal)) throw new InvalidOperationException("The owned filename field did not retain the exact selected PDF path.");
    }

    public static void Press(IntPtr window, int identifier)
    {
        var button = GetDlgItem(window, identifier);
        var name = new StringBuilder(256);
        GetClassName(button, name, name.Capacity);
        if (button == IntPtr.Zero || name.ToString() != "Button")
            throw new InvalidOperationException("The owned Save dialog has no native button " + identifier + ".");
        SendMessage(button, 0x00f5, IntPtr.Zero, IntPtr.Zero);
    }
    public static IntPtr Find(int processId)
    {
        var found = IntPtr.Zero;
        EnumWindows((window, parameter) => {
            var name = new StringBuilder(256);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != "#32770" || !IsWindowVisible(window)) return true;
            for (var owner = window; owner != IntPtr.Zero; owner = GetWindow(owner, 4)) {
                GetWindowThreadProcessId(owner, out var ownerProcess);
                if (ownerProcess == processId) { found = window; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@

if (-not $Cancel) {
    if (-not $File -or -not $OutputDirectory) { throw 'A new PDF path and its existing disposable output directory are required.' }
    $pdfDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
    $pdfTarget = [IO.Path]::GetFullPath($File)
    if (-not [string]::Equals([IO.Path]::GetDirectoryName($pdfTarget), $pdfDirectory, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($pdfTarget) -ine '.pdf') {
        throw 'The test PDF must be directly inside the explicitly selected disposable output directory.'
    }
    if (Test-Path -LiteralPath $pdfTarget) { throw 'The test Save dialog requires a new filename; an existing file will not be overwritten.' }
}

$pdfDeadline = [DateTime]::UtcNow.AddSeconds($FindTimeoutSeconds)
$pdfWindow = [IntPtr]::Zero
while ([DateTime]::UtcNow -lt $pdfDeadline) {
    $pdfWindow = [SaveTestPdf]::Find($BrowserProcessId)
    if ($pdfWindow -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 100
}
if ($pdfWindow -eq [IntPtr]::Zero) { throw "Owned browser PID $BrowserProcessId did not show a Save dialog." }
if ($ExpectedWindowHandle -ne 0 -and $pdfWindow.ToInt64() -ne $ExpectedWindowHandle) { throw 'The owned Save dialog identity changed; another dialog will not be touched.' }
Write-Output ('PDF_SAVE_DIALOG_HANDLE ' + $pdfWindow.ToInt64())
if ($Cancel) {
    [SaveTestPdf]::Press($pdfWindow, 2)
} else {
    [SaveTestPdf]::SetFilename($pdfWindow, $pdfTarget)
    [SaveTestPdf]::Press($pdfWindow, 1)
}
$pdfDeadline = [DateTime]::UtcNow.AddSeconds($CloseTimeoutSeconds)
while ([DateTime]::UtcNow -lt $pdfDeadline) {
    if ([SaveTestPdf]::Find($BrowserProcessId) -eq [IntPtr]::Zero) { exit 0 }
    Start-Sleep -Milliseconds 100
}
throw 'The owned Save dialog did not close after the requested action.'
