$ErrorActionPreference='Stop'
$installer=Join-Path $env:LOCALAPPDATA '@za-spaclient-updater\pending\ZA-Thera-1.0.0-rc.1-Windows-x64.exe'
$expected=(Get-Content .runtime/brand-artifact-verification.json -Raw | ConvertFrom-Json).sha256
if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Update payload hash mismatch'}
# The product deliberately opens an interactive NSIS installer. Drive that same
# verified payload through its supported silent mode for unattended QA.
$deadline=[DateTime]::UtcNow.AddSeconds(10)
do{$pending=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $installer});if($pending.Count){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $deadline)
if(-not $pending.Count){throw 'Updater did not launch the verified installer'}
foreach($process in $pending){Stop-Process -Id $process.ProcessId}
$result=Start-Process -FilePath $installer -ArgumentList @('/S','--updated') -WindowStyle Hidden -Wait -PassThru
if($result.ExitCode -ne 0){throw 'NSIS upgrade failed'}
$version=(Get-Item .runtime/installed-acceptance/ZA-Thera.exe).VersionInfo.FileVersion
if($version -ne '1.0.0-rc.1'){throw 'Installed version does not match update'}
if(-not (Test-Path -LiteralPath (Join-Path $env:APPDATA 'ZA-SPA SaaS\acceptance-retention.json'))){throw 'Update removed user data'}
Write-Output 'Verified updater handoff, NSIS upgrade, exact version and user-data retention.'
