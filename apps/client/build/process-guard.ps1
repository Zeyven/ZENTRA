$ErrorActionPreference = 'Stop'
try {
  $target = $env:ZA_THERA_INSTALL_EXE
  if (-not [IO.Path]::IsPathRooted($target) -or [IO.Path]::GetFileName($target) -ne 'ZA-Thera.exe') { throw 'Invalid target' }
  $target = [IO.Path]::GetFullPath($target)
  function Find-Target {
    @(Get-CimInstance Win32_Process -Filter "Name='ZA-Thera.exe'" | Where-Object {
      if (-not $_.ExecutablePath) { throw 'Cannot determine process path' }
      [string]::Equals($_.ExecutablePath, $target, [StringComparison]::OrdinalIgnoreCase)
    })
  }
  $matches = @(Find-Target)
  if ($env:ZA_THERA_INSTALL_ACTION -eq 'close') {
    foreach ($entry in $matches) {
      $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
      if ($process) { [void]$process.CloseMainWindow() }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (@(Find-Target).Count -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    foreach ($entry in @(Find-Target)) {
      $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
      if ($process -and [string]::Equals($process.Path, $target, [StringComparison]::OrdinalIgnoreCase)) {
        $process.Kill()
        if (-not $process.WaitForExit(3000)) { throw 'Process did not exit' }
      }
    }
  } elseif ($env:ZA_THERA_INSTALL_ACTION -ne 'check') { throw 'Invalid action' }
  if (@(Find-Target).Count) { exit 10 }
  exit 0
} catch {
  Write-Output 'Unable to inspect or close the target application. Installation has not continued.'
  exit 20
}
