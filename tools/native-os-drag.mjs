import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Test-only: drives the real Windows mouse (SetCursorPos + mouse_event) against windows owned by one exact
// Electron PID. It never dispatches DOM events or injects a drag payload.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name Drag -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hwnd, System.IntPtr lParam);
public struct POINT { public int X; public int Y; }
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr hwnd, System.Text.StringBuilder text, int count);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ClientToScreen(System.IntPtr hwnd, ref POINT p);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr hwnd, out RECT r);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(POINT p);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr hwnd, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extra);
'@
[void][Native.Drag]::SetProcessDPIAware()
$plan = $env:SLOPSIDIAN_DRAG_PLAN | ConvertFrom-Json
$owned = [uint32]$plan.pid
function Find-Window([string]$title) {
  $found = New-Object System.Collections.Generic.List[object]
  $cb = [Native.Drag+EnumProc]{
    param($hwnd, $l)
    $p = [uint32]0
    [void][Native.Drag]::GetWindowThreadProcessId($hwnd, [ref]$p)
    if ($p -eq $owned -and [Native.Drag]::IsWindowVisible($hwnd)) {
      $t = New-Object System.Text.StringBuilder 512
      [void][Native.Drag]::GetWindowText($hwnd, $t, 512)
      if ($t.ToString() -eq $title) { $found.Add($hwnd) }
    }
    return $true
  }
  [void][Native.Drag]::EnumWindows($cb, [System.IntPtr]::Zero)
  if ($found.Count -ne 1) { throw "Expected exactly one visible window titled '$title' owned by process $owned, found $($found.Count)." }
  $found[0]
}
function Client-Origin($hwnd) {
  $p = New-Object Native.Drag+POINT
  [void][Native.Drag]::ClientToScreen($hwnd, [ref]$p)
  $r = New-Object Native.Drag+RECT
  [void][Native.Drag]::GetClientRect($hwnd, [ref]$r)
  [pscustomobject]@{ x = $p.X; y = $p.Y; width = $r.Right - $r.Left; height = $r.Bottom - $r.Top }
}
function Pid-Of($h) { $q = [uint32]0; if ($h -ne [System.IntPtr]::Zero) { [void][Native.Drag]::GetWindowThreadProcessId($h, [ref]$q) }; [int]$q }
function Assert-Over($hwnd, [int]$x, [int]$y, [string]$label) {
  $pt = New-Object Native.Drag+POINT; $pt.X = $x; $pt.Y = $y
  $hit = [Native.Drag]::WindowFromPoint($pt)
  $top = [Native.Drag]::GetAncestor($hit, 2)
  $fg = [Native.Drag]::GetForegroundWindow()
  $d = [ordered]@{ label = $label; point = @($x, $y); expectedHwnd = $hwnd.ToInt64(); expectedPid = (Pid-Of $hwnd); hitHwnd = $hit.ToInt64(); hitPid = (Pid-Of $hit); rootHwnd = $top.ToInt64(); rootPid = (Pid-Of $top); foregroundHwnd = $fg.ToInt64(); foregroundPid = (Pid-Of $fg); focusReturn = $script:focusReturn }
  $script:overChecks += ,$d
  if ($top -ne $hwnd) { throw "Screen point $x,$y ($label) is not over the expected owned window: expected hwnd $($hwnd.ToInt64()), hit root hwnd $($top.ToInt64()) pid $(Pid-Of $top)." }
}
$script:overChecks = @(); $script:focusReturn = $null
$result = [ordered]@{ pid = [int]$owned }
$down = $false
$ok = $false
$cancelPt = $null
try {
  $src = Find-Window $plan.sourceTitle
  $dst = Find-Window $plan.targetTitle
  $result.sourceHwnd = $src.ToInt64(); $result.targetHwnd = $dst.ToInt64()
  $result.sourceClient = Client-Origin $src; $result.targetClient = Client-Origin $dst
  $dims = @($result.sourceClient, $result.targetClient)
  $expect = @($plan.sourceInner, $plan.targetInner)
  for ($i = 0; $i -lt 2; $i++) {
    $e = $expect[$i]
    if ([math]::Abs($dims[$i].width - $e.width * $e.dpr) -gt 2 + $e.dpr -or [math]::Abs($dims[$i].height - $e.height * $e.dpr) -gt 2 + $e.dpr) {
      throw "Native client size does not match the page's measured innerSize*dpr (DPI/zoom mismatch); refusing to guess coordinates."
    }
  }
  $script:focusReturn = [Native.Drag]::SetForegroundWindow($src)
  $result.focusReturn = $script:focusReturn
  Start-Sleep -Milliseconds 150
  $sx = $result.sourceClient.x + [int]$plan.from.x; $sy = $result.sourceClient.y + [int]$plan.from.y
  $tx = $result.targetClient.x + [int]$plan.to.x; $ty = $result.targetClient.y + [int]$plan.to.y
  $result.measurements = [ordered]@{ sourcePoint = @($sx, $sy); targetPoint = @($tx, $ty); sourceInner = $plan.sourceInner; targetInner = $plan.targetInner; from = $plan.from; to = $plan.to }
  $cancelPt = @($sx, $sy)
  # both owned endpoints are checked before any button press
  Assert-Over $src $sx $sy 'source'
  Assert-Over $dst $tx $ty 'target'
  [void][Native.Drag]::SetCursorPos($sx, $sy)
  Start-Sleep -Milliseconds 80
  [Native.Drag]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero); $down = $true
  foreach ($pt in $plan.path) {
    $px = $result.targetClient.x + [int]$pt.x; $py = $result.targetClient.y + [int]$pt.y
    if ($pt.local -eq 'source') { $px = $result.sourceClient.x + [int]$pt.x; $py = $result.sourceClient.y + [int]$pt.y }
    [void][Native.Drag]::SetCursorPos($px, $py)
    Start-Sleep -Milliseconds ([int]$plan.stepMs)
  }
  Assert-Over $dst $tx $ty 'target-before-release'
  [void][Native.Drag]::SetCursorPos($tx, $ty)
  Start-Sleep -Milliseconds 200
  [Native.Drag]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero); $down = $false
  $result.dropped = $true
  $ok = $true
} catch {
  $result.failed = $true
  $result.error = $_.Exception.Message
} finally {
  $result.overChecks = $script:overChecks
  if ($down) {
    # failure path: cancel the OLE drag with Escape and return over the source before releasing, so nothing can drop elsewhere
    if (-not $ok) {
      [Native.Drag]::keybd_event(0x1B, 0, 0, [System.UIntPtr]::Zero); [Native.Drag]::keybd_event(0x1B, 0, 2, [System.UIntPtr]::Zero)
      Start-Sleep -Milliseconds 100
      if ($cancelPt) { [void][Native.Drag]::SetCursorPos($cancelPt[0], $cancelPt[1]) }
    }
    [Native.Drag]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
    $result.releasedInFinally = $true; $result.cancelled = (-not $ok)
  }
}
$result | ConvertTo-Json -Compress -Depth 5
`;

export function assertPlanInputs({ pid, sourceTitle, targetTitle }) {
  if (!Number.isSafeInteger(pid) || pid <= 0) { throw new Error("A positive owned Electron process id is required."); }
  for (const t of [sourceTitle, targetTitle]) {
    if (typeof t !== "string" || !t) { throw new Error("Unique native window titles are required."); }
  }
}

function finitePoint(p, label) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { throw new Error(`${label} must be a measured finite point.`); }
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function finiteInner(g, label) {
  if (!g || ![g.width, g.height, g.dpr].every(Number.isFinite) || !(g.width > 0 && g.width <= 16384) || !(g.height > 0 && g.height <= 16384) || !(g.dpr >= 0.25 && g.dpr <= 8)) { throw new Error(`${label} needs measured innerWidth/innerHeight/devicePixelRatio.`); }
  return { width: g.width, height: g.height, dpr: g.dpr };
}

/** Convert a CSS-pixel point inside a page to a native client-pixel point, rejecting points outside the viewport. */
export function cssToClient(point, inner, label = "point") {
  const p = finitePoint(point, label);
  const i = finiteInner(inner, `${label} window`);
  if (p.x < 0 || p.y < 0 || p.x >= i.width || p.y >= i.height) { throw new Error(`${label} lies outside the measured viewport.`); }
  return { x: Math.round(p.x * i.dpr), y: Math.round(p.y * i.dpr) };
}

/** A drag path that leaves the source slowly enough to start a native drag, then glides to the target in target-window client pixels. */
export function planPath(from, to, steps = 8) {
  const path = [{ local: "source", x: from.x + 12, y: from.y + 12 }, { local: "source", x: from.x + 24, y: from.y + 24 }];
  for (let i = 1; i <= steps; i += 1) {
    path.push({ local: "target", x: Math.round(to.x * i / steps), y: Math.round(to.y * i / steps) });
  }
  return path;
}

export function buildDragPlan({ pid, sourceTitle, targetTitle, from, to, sourceInner, targetInner, stepMs = 40 }) {
  assertPlanInputs({ pid, sourceTitle, targetTitle });
  if (sourceTitle === targetTitle) {
    // same-window drags are not a cross-window move and would also make title lookup ambiguous
    throw new Error("Source and target must be different uniquely titled windows.");
  }
  const f = cssToClient(from, sourceInner, "from");
  const t = cssToClient(to, targetInner, "to");
  if (!Number.isInteger(stepMs) || stepMs < 10 || stepMs > 500) { throw new Error("stepMs must be an integer from 10 to 500."); }
  return { pid, sourceTitle, targetTitle, from: f, to: t, path: planPath(f, t), sourceInner: finiteInner(sourceInner, "source"), targetInner: finiteInner(targetInner, "target"), stepMs };
}

/** Real OS mouse drag. Throws if either window is not exactly one owned visible window or a point is covered. */
export async function osMouseDrag(options, exec = defaultExec) {
  const plan = buildDragPlan(options);
  let out;
  try { out = await exec(plan); }
  catch (error) {
    const parsed = error?.diagnostics ?? parseDiagnostics(error?.stdout);
    const stderr = String(error?.stderr ?? "").trim();
    const diagnostics = parsed && typeof parsed === "object" ? { ...parsed } : {};
    if (stderr) { diagnostics.stderr = stderr; }
    const wrapped = new Error(`The native drag failed: ${error?.message ?? error}`, { cause: error });
    wrapped.diagnostics = diagnostics;
    throw wrapped;
  }
  if (out?.failed) {
    const error = new Error(`The native drag refused before completing: ${out.error}`);
    error.diagnostics = out;
    throw error;
  }
  if (!out || out.dropped !== true) {
    const error = new Error("The native drag did not reach the drop.");
    error.diagnostics = out ?? null;
    throw error;
  }
  return out;
}

function parseDiagnostics(text) {
  try { return text ? JSON.parse(String(text).trim()) : undefined; } catch { return { rawStdout: String(text) }; }
}

async function defaultExec(plan) {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], {
    env: { ...process.env, SLOPSIDIAN_DRAG_PLAN: JSON.stringify(plan) },
    windowsHide: true,
  });
  return JSON.parse(stdout.trim());
}
