import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Test-only: arranges ONLY windows that are visible, top-level, owned by one exact PID and carry an exact unique title.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name Lay -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hwnd, System.IntPtr lParam);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr hwnd, System.Text.StringBuilder text, int count);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hwnd, out RECT r);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hwnd, int cmd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hwnd, System.IntPtr after, int x, int y, int w, int h, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr MonitorFromWindow(System.IntPtr hwnd, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetMonitorInfo(System.IntPtr monitor, ref MONITORINFO info);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetDpiForWindow(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsZoomed(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(System.IntPtr hwnd, int index);
[System.Runtime.InteropServices.DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(System.IntPtr hwnd, int attr, out RECT r, int size);
'@
[void][Native.Lay]::SetProcessDPIAware()
$plan = $env:SLOPSIDIAN_LAYOUT_PLAN | ConvertFrom-Json
$owned = [uint32]$plan.pid
function Find-Window([string]$title) {
  $found = New-Object System.Collections.Generic.List[object]
  $cb = [Native.Lay+EnumProc]{
    param($hwnd, $l)
    $p = [uint32]0
    [void][Native.Lay]::GetWindowThreadProcessId($hwnd, [ref]$p)
    if ($p -eq $owned -and [Native.Lay]::IsWindowVisible($hwnd)) {
      $t = New-Object System.Text.StringBuilder 512
      [void][Native.Lay]::GetWindowText($hwnd, $t, 512)
      if ($t.ToString() -eq $title) { $found.Add($hwnd) }
    }
    return $true
  }
  [void][Native.Lay]::EnumWindows($cb, [System.IntPtr]::Zero)
  if ($found.Count -gt 1) { throw "Ambiguous window match: $($found.Count) visible windows titled '$title' owned by process $owned." }
  if ($found.Count -ne 1) { throw "Expected exactly one visible window titled '$title' owned by process $owned, found $($found.Count)." }
  $found[0]
}
function Work-Area($hwnd) {
  $info = New-Object Native.Lay+MONITORINFO
  $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
  $mon = [Native.Lay]::MonitorFromWindow($hwnd, 2)
  if (-not [Native.Lay]::GetMonitorInfo($mon, [ref]$info)) { throw 'GetMonitorInfo failed.' }
  [pscustomobject]@{ x = $info.rcWork.Left; y = $info.rcWork.Top; width = $info.rcWork.Right - $info.rcWork.Left; height = $info.rcWork.Bottom - $info.rcWork.Top }
}
function Rect-Of($hwnd) {
  $r = New-Object Native.Lay+RECT
  if (-not [Native.Lay]::GetWindowRect($hwnd, [ref]$r)) { throw "GetWindowRect failed for window $($hwnd.ToInt64())." }
  [pscustomobject]@{ x = $r.Left; y = $r.Top; width = $r.Right - $r.Left; height = $r.Bottom - $r.Top }
}
function Describe($title, $hwnd) {
  $f = New-Object Native.Lay+RECT
  $hr = [Native.Lay]::DwmGetWindowAttribute($hwnd, 9, [ref]$f, [System.Runtime.InteropServices.Marshal]::SizeOf($f))
  $frame = $null
  if ($hr -eq 0) { $frame = [pscustomobject]@{ x = $f.Left; y = $f.Top; width = $f.Right - $f.Left; height = $f.Bottom - $f.Top } }
  [pscustomobject]@{ title = $title; hwnd = $hwnd.ToInt64(); rect = (Rect-Of $hwnd); frame = $frame; dpi = [int][Native.Lay]::GetDpiForWindow($hwnd); zoomed = [Native.Lay]::IsZoomed($hwnd); iconic = [Native.Lay]::IsIconic($hwnd); workArea = (Work-Area $hwnd) }
}
function Is-Topmost($hwnd) { (([Native.Lay]::GetWindowLong($hwnd, -20) -band 0x8) -ne 0) }
function Set-Z($hwnd, [bool]$top) {
  # HWND_TOPMOST = -1, HWND_NOTOPMOST = -2; SWP_NOSIZE|NOMOVE|NOACTIVATE
  $after = if ($top) { [System.IntPtr](-1) } else { [System.IntPtr](-2) }
  if (-not [Native.Lay]::SetWindowPos($hwnd, $after, 0, 0, 0, 0, 0x0013)) { throw "SetWindowPos z-order failed for window $($hwnd.ToInt64())." }
}
function Fail-Z($errors) { if ($errors.Count -gt 0) { throw ($errors -join ' | ') } }
if ($plan.op -eq 'zstate') {
  $out = @()
  foreach ($t in $plan.titles) { $h = Find-Window $t; $out += [pscustomobject]@{ title = $t; hwnd = $h.ToInt64(); wasTopmost = (Is-Topmost $h) } }
  ConvertTo-Json -InputObject @($out) -Compress -Depth 4
} elseif ($plan.op -eq 'raise') {
  # entries are the validated prior states; every changed window is rolled back (all attempted, errors aggregated) on any failure
  $out = @(); $changed = @(); $errors = @()
  try {
    foreach ($e in $plan.entries) {
      $h = Find-Window $e.title
      if ([int64]$e.hwnd -ne $h.ToInt64()) { throw "Window '$($e.title)' changed handle since z-order state capture." }
      if (-not $e.wasTopmost) { Set-Z $h $true; $changed += ,@($e.title, $h) }
      $out += [pscustomobject]@{ title = $e.title; hwnd = $h.ToInt64(); wasTopmost = [bool]$e.wasTopmost; nowTopmost = (Is-Topmost $h) }
    }
  } catch {
    $errors += "raise failed: $($_.Exception.Message)"
    foreach ($c in $changed) { try { Set-Z $c[1] $false } catch { $errors += "rollback failed for '$($c[0])': $($_.Exception.Message)" } }
    Fail-Z $errors
  }
  ConvertTo-Json -InputObject @($out) -Compress -Depth 4
} elseif ($plan.op -eq 'restoreZ') {
  $out = @(); $errors = @()
  foreach ($e in $plan.entries) {
    try {
      $h = Find-Window $e.title
      if ([int64]$e.hwnd -ne $h.ToInt64()) { throw "Window '$($e.title)' changed handle since z-order preparation." }
      if (-not $e.wasTopmost) { Set-Z $h $false }
      $out += [pscustomobject]@{ title = $e.title; hwnd = $h.ToInt64(); topmost = (Is-Topmost $h) }
    } catch { $errors += "restore failed for '$($e.title)': $($_.Exception.Message)" }
  }
  Fail-Z $errors
  ConvertTo-Json -InputObject @($out) -Compress -Depth 4
} elseif ($plan.op -eq 'diagnose') {
  $out = @(); foreach ($t in $plan.titles) { $out += (Describe $t (Find-Window $t)) }
  ConvertTo-Json -InputObject @($out) -Compress -Depth 6
} elseif ($plan.op -eq 'workArea') {
  $h = Find-Window $plan.title
  [pscustomobject]@{ hwnd = $h.ToInt64(); workArea = (Work-Area $h) } | ConvertTo-Json -Compress -Depth 4
} else {
  $handles = @(); foreach ($p in $plan.placements) { $handles += ,(Find-Window $p.title) }
  $ids = @($handles | % { $_.ToInt64() }); if (($ids | Select-Object -Unique).Count -ne $ids.Count) { throw 'Two titles resolved to the same window.' }
  $placed = @()
  for ($i = 0; $i -lt $handles.Count; $i++) {
    $p = $plan.placements[$i]
    [void][Native.Lay]::ShowWindow($handles[$i], 9)
    # SWP_NOZORDER | SWP_NOACTIVATE
    if (-not [Native.Lay]::SetWindowPos($handles[$i], [System.IntPtr]::Zero, [int]$p.x, [int]$p.y, [int]$p.width, [int]$p.height, 0x0014)) { throw "SetWindowPos failed for '$($p.title)'." }
    $placed += (Describe $p.title $handles[$i])
  }
  $placed | ConvertTo-Json -Compress -Depth 5
}
`;

const MIN = { width: 480, height: 360 };
// Actual fixture minima: desktop/main.cjs enforces 940x650 on the main window, popout-windows.cjs 320x240 on popouts.
export const MAIN_MIN = { width: 940, height: 650 };
export const POPOUT_MIN = { width: 320, height: 240 };

function planConstrained(workArea, mins, gap) {
  const n = mins.length, W = workArea.width, H = workArea.height, ox = workArea.x, oy = workArea.y;
  const rowMin = mins.reduce((sum, m) => sum + m.width, 0) + gap * (n + 1);
  if (rowMin <= W && Math.max(...mins.map(m => m.height)) + 2 * gap <= H) {
    const extra = Math.floor((W - rowMin) / n);
    let x = ox + gap;
    return mins.map(m => { const rect = { x, y: oy + gap, width: m.width + extra, height: H - 2 * gap }; x += rect.width + gap; return rect; });
  }
  // main on the left, the remaining windows stacked on the right
  const others = mins.slice(1), avail = W - 3 * gap;
  const rightW = Math.max(...others.map(m => m.width)), mainW = avail - rightW;
  const stackH = Math.floor((H - gap * (others.length + 1)) / others.length);
  if (mainW >= mins[0].width && H - 2 * gap >= mins[0].height && stackH >= Math.max(...others.map(m => m.height))) {
    return [{ x: ox + gap, y: oy + gap, width: mainW, height: H - 2 * gap },
      ...others.map((_, i) => ({ x: ox + 2 * gap + mainW, y: oy + gap + i * (stackH + gap), width: rightW, height: stackH }))];
  }
  return null;
}

/** Tile `count` windows into the work area without overlap; honors per-window minima (`mins`) when given, else a uniform `min`. Refuses otherwise. */
export function planWindowLayout(workArea, count, { gap = 12, min = MIN, mins } = {}) {
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(workArea?.[key])) { throw new Error("The monitor work area is not a measured finite rectangle."); }
  }
  if (!Number.isInteger(count) || count < 2 || count > 4) { throw new Error("Between two and four windows can be arranged."); }
  if (mins) {
    if (mins.length !== count || mins.some(m => !(m?.width > 0) || !(m?.height > 0))) { throw new Error("Every window needs a positive minimum size."); }
    const plan = planConstrained(workArea, mins, gap);
    if (plan) { return plan; }
    throw new Error(`The monitor work area ${workArea.width}x${workArea.height} cannot fit ${count} non-overlapping windows with minimum sizes ${mins.map(m => `${m.width}x${m.height}`).join(", ")}.`);
  }
  const shapes = [{ cols: count, rows: 1 }, { cols: 2, rows: Math.ceil(count / 2) }];
  for (const { cols, rows } of shapes) {
    const width = Math.floor((workArea.width - gap * (cols + 1)) / cols), height = Math.floor((workArea.height - gap * (rows + 1)) / rows);
    if (width < min.width || height < min.height) { continue; }
    return Array.from({ length: count }, (_, i) => ({
      x: workArea.x + gap + (i % cols) * (width + gap), y: workArea.y + gap + Math.floor(i / cols) * (height + gap), width, height,
    }));
  }
  throw new Error(`The monitor work area ${workArea.width}x${workArea.height} cannot fit ${count} non-overlapping windows of at least ${min.width}x${min.height}.`);
}

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (r, w) => r.x >= w.x && r.y >= w.y && r.x + r.width <= w.x + w.width && r.y + r.height <= w.y + w.height;

/** Verifies the rectangles the OS actually reports: every window inside the work area and no two overlapping. */
export function assertArrangement(placed, workArea) {
  for (const item of placed) {
    if (!inside(item.rect, workArea)) { throw new Error(`Window '${item.title}' is not inside the monitor work area after placement.`); }
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (intersects(placed[i].rect, placed[j].rect)) { throw new Error(`Windows '${placed[i].title}' and '${placed[j].title}' overlap after placement.`); }
    }
  }
}

function assertOwned(pid, titles) {
  if (!Number.isSafeInteger(pid) || pid <= 0) { throw new Error("A positive owned Electron process id is required."); }
  if (!Array.isArray(titles) || titles.some(t => typeof t !== "string" || !t) || new Set(titles).size !== titles.length) {
    throw new Error("Every window needs a distinct non-empty unique title.");
  }
}

async function exec(plan) {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], {
    env: { ...process.env, SLOPSIDIAN_LAYOUT_PLAN: JSON.stringify(plan) }, windowsHide: true,
  });
  return JSON.parse(stdout.trim());
}

export async function queryWorkArea({ pid, title }, run1 = exec) {
  assertOwned(pid, [title]);
  return (await run1({ op: "workArea", pid, title })).workArea;
}

const validEntries = (entries, titles, fields) => {
  if (!Array.isArray(entries) || entries.length !== titles.length) { return false; }
  const hwnds = new Set();
  for (const t of titles) {
    const found = entries.filter(e => e?.title === t);
    if (found.length !== 1 || !Number.isSafeInteger(found[0].hwnd) || found[0].hwnd <= 0 || !fields(found[0])) { return false; }
    hwnds.add(found[0].hwnd);
  }
  return hwnds.size === titles.length;
};

/**
 * Raise ONLY the exact owned fixture windows to topmost (once, before OS input) so a foreign foreground window cannot cover them.
 * Prior state is captured read-only and validated BEFORE any mutation; any later failure (exec, malformed output) restores it and
 * aggregates restoration errors. Returns the prior state for restoreOwnedZOrder; the thrown error also carries it as `error.prepared`.
 */
export async function prepareOwnedZOrder({ pid, titles }, run1 = exec) {
  assertOwned(pid, titles);
  const before = [].concat(await run1({ op: "zstate", pid, titles }));
  if (!validEntries(before, titles, e => typeof e.wasTopmost === "boolean")) { throw new Error("Z-order state capture did not report exactly one valid record (unique HWND, boolean topmost) per owned window."); }
  const prepared = { pid, entries: before.map(({ title, hwnd, wasTopmost }) => ({ title, hwnd, wasTopmost })) };
  let failure;
  try {
    const after = [].concat(await run1({ op: "raise", pid, entries: prepared.entries }));
    if (!validEntries(after, titles, e => typeof e.wasTopmost === "boolean")) { throw new Error("Z-order preparation did not report exactly one valid record per owned window."); }
    for (const e of after) {
      const prior = prepared.entries.find(p => p.title === e.title);
      if (e.hwnd !== prior.hwnd || e.wasTopmost !== prior.wasTopmost) { throw new Error(`Window '${e.title}' changed during z-order preparation.`); }
      if (e.nowTopmost !== true) { throw new Error(`Window '${e.title}' is not topmost after z-order preparation.`); }
    }
    return prepared;
  } catch (error) { failure = error; }
  const errors = [failure];
  try { await restoreOwnedZOrder(prepared, run1); } catch (restoreError) { errors.push(restoreError); }
  const out = errors.length > 1 ? new AggregateError(errors, `${failure.message}; rollback also failed: ${errors[1].message}`) : failure;
  out.prepared = prepared;
  throw out;
}

/** Restore only the windows this preparation changed; verifies count, unchanged HWND and the prior topmost state of every window. */
export async function restoreOwnedZOrder(prepared, run1 = exec) {
  if (!prepared?.entries?.length) { return []; }
  const titles = prepared.entries.map(e => e.title);
  const out = [].concat(await run1({ op: "restoreZ", pid: prepared.pid, entries: prepared.entries }));
  if (!validEntries(out, titles, e => typeof e.topmost === "boolean")) { throw new Error("Z-order restore did not report exactly one valid record per owned window."); }
  for (const e of out) {
    const prior = prepared.entries.find(p => p.title === e.title);
    if (e.hwnd !== prior.hwnd) { throw new Error(`Window '${e.title}' changed handle during z-order restore.`); }
    if (e.topmost !== prior.wasTopmost) { throw new Error(`Window '${e.title}' topmost state was not restored (expected ${prior.wasTopmost}).`); }
  }
  return out;
}

/** Read-only: native rect, DWM frame bounds, DPI, state and work area of each exact owned window. */
export async function diagnoseOwnedWindows({ pid, titles }, run1 = exec) {
  assertOwned(pid, titles);
  return [].concat(await run1({ op: "diagnose", pid, titles }));
}

/** Electron minimum sizes are DIP; the work area and window rects are physical, so scale by the measured per-window DPI. */
export function physicalMinima(titles, before) {
  return titles.map((title, i) => {
    const dip = i === 0 ? MAIN_MIN : POPOUT_MIN;
    const records = Array.isArray(before) ? before.filter(w => w?.title === title) : [];
    if (records.length !== 1) { throw new Error(`Expected exactly one measured window record for '${title}', found ${records.length}.`); }
    const dpi = records[0].dpi;
    if (!Number.isFinite(dpi) || dpi <= 0) { throw new Error(`The measured DPI for '${title}' is not a positive finite number (${dpi}).`); }
    const scale = dpi / 96;
    return { width: Math.ceil(dip.width * scale), height: Math.ceil(dip.height * scale), dip, dpi, scale };
  });
}

/** Place the exact owned windows (restoring them first), then verify the OS-reported rectangles. Failures carry `error.diagnostics`. */
export async function arrangeOwnedWindows({ pid, titles }, { query = queryWorkArea, place = exec, diagnose } = {}) {
  assertOwned(pid, titles);
  const measure = diagnose ?? diagnoseOwnedWindows;
  const diagnostics = { titles };
  try {
    diagnostics.before = await measure({ pid, titles });
    diagnostics.workArea = await query({ pid, title: titles[0] });
    diagnostics.minima = physicalMinima(titles, diagnostics.before);
    const rects = diagnostics.requested = planWindowLayout(diagnostics.workArea, titles.length, { mins: diagnostics.minima });
    diagnostics.placed = [].concat(await place({ op: "place", pid, placements: titles.map((title, i) => ({ title, ...rects[i] })) }));
    if (diagnostics.placed.length !== titles.length) { throw new Error("The OS did not report every placed window."); }
    assertArrangement(diagnostics.placed, diagnostics.workArea);
    return { workArea: diagnostics.workArea, requested: rects, placed: diagnostics.placed, minima: diagnostics.minima, before: diagnostics.before };
  } catch (error) {
    error.diagnostics = diagnostics;
    throw error;
  }
}
