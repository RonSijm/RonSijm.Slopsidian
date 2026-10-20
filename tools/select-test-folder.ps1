param(
    [Parameter(Mandatory = $true)][int]$BrowserProcessId,
    [string]$Folder,
    [switch]$Cancel
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WasmFolderPicker
{
    private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int maximum);
    [DllImport("user32.dll")] private static extern IntPtr GetDlgItem(IntPtr window, int identifier);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, IntPtr data);

    public static void Press(IntPtr window, int identifier)
    {
        var button = GetDlgItem(window, identifier);
        var name = new StringBuilder(256);
        GetClassName(button, name, name.Capacity);
        if (button == IntPtr.Zero || name.ToString() != "Button")
        {
            throw new InvalidOperationException("The owned folder dialog has no native button " + identifier + ".");
        }

        SendMessage(button, 0x00f5, IntPtr.Zero, IntPtr.Zero);
    }

    public static IntPtr Find(int processId)
    {
        var found = IntPtr.Zero;
        EnumWindows((window, parameter) =>
        {
            var name = new StringBuilder(256);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != "#32770" || !IsWindowVisible(window))
            {
                return true;
            }

            for (var owner = window; owner != IntPtr.Zero; owner = GetWindow(owner, 4))
            {
                GetWindowThreadProcessId(owner, out var ownerProcess);
                if (ownerProcess == processId)
                {
                    found = window;
                    return false;
                }
            }

            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
if (-not $Cancel -and (-not $Folder -or -not (Test-Path -LiteralPath $Folder -PathType Container))) {
    throw 'Select an existing, disposable test folder.'
}
function Find-OwnedDialog {
    $window = [WasmFolderPicker]::Find($BrowserProcessId)
    if ($window -eq [IntPtr]::Zero) { return $null }
    return [System.Windows.Automation.AutomationElement]::FromHandle($window)
}
$deadline = [DateTime]::UtcNow.AddSeconds(15)
$dialog = $null
while ([DateTime]::UtcNow -lt $deadline) {
    $dialog = Find-OwnedDialog
    if ($null -ne $dialog) { break }
    Start-Sleep -Milliseconds 100
}
if ($null -eq $dialog) {
    throw "The owned browser PID $BrowserProcessId did not show a folder picker."
}
if ($Cancel) {
    [WasmFolderPicker]::Press([WasmFolderPicker]::Find($BrowserProcessId), 2)
    exit 0
}
$name = Split-Path -Leaf $Folder
$itemCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $name)
)
$item = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $itemCondition)
if ($null -eq $item) {
    throw "The disposable test folder '$name' is not visible in the owned picker."
}
([System.Windows.Automation.SelectionItemPattern]$item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
([System.Windows.Automation.InvokePattern]$item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
$deadline = [DateTime]::UtcNow.AddSeconds(5)
do {
    Start-Sleep -Milliseconds 50
    $dialog = Find-OwnedDialog
    if ($null -eq $dialog) { throw 'The owned folder picker closed before entering the requested folder.' }
    $item = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $itemCondition)
} while ($null -ne $item -and [DateTime]::UtcNow -lt $deadline)
if ($null -ne $item) { throw "The owned picker did not enter '$name'." }
[WasmFolderPicker]::Press([WasmFolderPicker]::Find($BrowserProcessId), 1)
