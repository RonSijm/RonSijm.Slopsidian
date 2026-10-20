param(
  [Parameter(Mandatory = $true)][string]$Stage
)

$ErrorActionPreference = 'Stop'
$allowed = 'C:\Users\Ron\.copilot\repos\copilot-worktrees\RonSijm.Slopsidian\ronsijm-studious-system\.runtime\original-reference-captures'
$full = [IO.Path]::GetFullPath($Stage)
if ((Split-Path $full -Parent) -ne $allowed -or (Split-Path $full -Leaf) -notmatch '^\d{14}-[a-f0-9]{6}$') {
  throw 'Only an explicitly reviewed owned capture directory is allowed.'
}
$review = Get-Content -LiteralPath (Join-Path $full 'parent-review.json') -Raw | ConvertFrom-Json
if (-not $review.flagsVerified -or -not $review.allInputHashesVerified -or -not $review.allAncestorsOrdinary -or $review.stage -ne $full) {
  throw 'The independent parent review is missing or incomplete.'
}
$config = Join-Path $full 'capture.wsb'
if ((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash.ToLowerInvariant() -ne $review.wsbSha256) {
  throw 'The reviewed configuration changed.'
}
$existing = @(Get-CimInstance Win32_Process -Filter "Name='WindowsSandbox.exe' OR Name='WindowsSandboxClient.exe'")
if ($existing.Count -ne 0) { throw 'An existing Sandbox client must not be reused or disturbed.' }
$output = Join-Path $full 'output'
if (@(Get-ChildItem -LiteralPath $output -Force).Count -ne 0) { throw 'Capture output is not empty.' }

$locks = [Collections.Generic.List[IO.FileStream]]::new()
$start = Get-Date
$record = [ordered]@{
  schema = 'sandbox-host-attempt/1'
  startedAt = [DateTime]::UtcNow.ToString('o')
  configSha256 = $review.wsbSha256
  nonce = $review.nonce
  hostOriginalExecuted = $false
  launcherPid = $null
  resultAvailable = $false
  clients = @()
}
try {
  foreach ($file in @((Get-Item -LiteralPath $config)) + @(Get-ChildItem -LiteralPath (Join-Path $full 'input') -Recurse -File)) {
    $locks.Add([IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read))
  }
  foreach ($binding in @(
    @($config, $review.wsbSha256),
    @((Join-Path $full 'input\manifest.json'), $review.manifestSha256),
    @((Join-Path $full 'input\guest\guest-capture.mjs'), $review.guestScriptSha256),
    @((Join-Path $full 'input\node\node.exe'), $review.nodeSha256)
  )) {
    if ((Get-FileHash -LiteralPath $binding[0] -Algorithm SHA256).Hash.ToLowerInvariant() -ne $binding[1]) {
      throw 'An immutable reviewed input changed before the capture.'
    }
  }
  $launcher = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsSandbox.exe') -ArgumentList "`"$config`"" -PassThru
  $record.launcherPid = $launcher.Id
  "SANDBOX_LAUNCHER_PID $($launcher.Id)"
  $deadline = [DateTime]::UtcNow.AddSeconds(300)
  $result = Join-Path $output 'result.json'
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $result) {
      try {
        $guest = Get-Content -LiteralPath $result -Raw | ConvertFrom-Json
        if ($guest.nonce -ne $review.nonce) { throw 'The guest returned the wrong nonce.' }
        $record.resultAvailable = $true
        "SANDBOX_RESULT_READY ok=$($guest.ok)"
        break
      } catch {
        if ($_.Exception.Message -like '*wrong nonce*') { throw }
        $record.resultReadError = $_.Exception.Message
      }
    }
    if ($launcher.HasExited -and $launcher.ExitCode -ne 0) {
      throw "Windows Sandbox launcher exited with code $($launcher.ExitCode)."
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $record.resultAvailable) { throw 'No complete guest result appeared within the bounded Sandbox attempt.' }
} catch {
  $record.error = $_.Exception.Message
  throw
} finally {
  foreach ($stream in $locks) { $stream.Dispose() }
  $record.clients = @(Get-CimInstance Win32_Process -Filter "Name='WindowsSandbox.exe' OR Name='WindowsSandboxClient.exe'" |
    Where-Object { $_.CreationDate -ge $start } |
    Select-Object ProcessId, ParentProcessId, CreationDate, Name)
  $record.finishedAt = [DateTime]::UtcNow.ToString('o')
  $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $full 'host-attempt.json') -Encoding utf8
  $record | ConvertTo-Json -Depth 6
}
