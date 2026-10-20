import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hwnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr hwnd, System.Text.StringBuilder text, int count);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hwnd, uint message, System.IntPtr wParam, System.IntPtr lParam);
'@
$owned = [uint32]$env:SLOPSIDIAN_CLOSE_PID
$title = $env:SLOPSIDIAN_CLOSE_TITLE
$found = New-Object System.Collections.Generic.List[object]
$callback = [Native.Win+EnumProc]{
  param($hwnd, $lParam)
  $windowPid = [uint32]0
  [void][Native.Win]::GetWindowThreadProcessId($hwnd, [ref]$windowPid)
  if ($windowPid -eq $owned -and [Native.Win]::IsWindowVisible($hwnd)) {
    $text = New-Object System.Text.StringBuilder 512
    [void][Native.Win]::GetWindowText($hwnd, $text, 512)
    if ($text.ToString() -eq $title) { $found.Add($hwnd.ToInt64()) }
  }
  return $true
}
[void][Native.Win]::EnumWindows($callback, [System.IntPtr]::Zero)
if ($found.Count -ne 1) { throw "Expected exactly one visible window titled '$title' owned by process $owned, found $($found.Count)." }
if (-not [Native.Win]::PostMessage([System.IntPtr]$found[0], 0x0010, [System.IntPtr]::Zero, [System.IntPtr]::Zero)) { throw 'PostMessage(WM_CLOSE) failed.' }
[pscustomobject]@{ pid = [int]$owned; hwnd = $found[0]; title = $title; message = 'WM_CLOSE' } | ConvertTo-Json -Compress
`;

/** Post a real WM_CLOSE (the window's close button path) to the one visible top-level window of `pid` with exactly `title`. */
export async function postNativeUserClose(pid, title) {
  if (!Number.isSafeInteger(pid) || pid <= 0) { throw new Error("A positive owned process id is required."); }
  if (typeof title !== "string" || !title) { throw new Error("A unique native window title is required."); }
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], {
    env: { ...process.env, SLOPSIDIAN_CLOSE_PID: String(pid), SLOPSIDIAN_CLOSE_TITLE: title },
    windowsHide: true,
  });
  return JSON.parse(stdout.trim());
}
