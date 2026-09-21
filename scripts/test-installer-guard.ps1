$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$root=Join-Path $project ('.runtime\guard-test-'+[guid]::NewGuid().ToString())
$target=Join-Path $root "门店 O'Brien\app"
$sibling=$target+'-other'
New-Item -ItemType Directory -Path $target,$sibling | Out-Null
$compiler=Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis\nsis-3.0.4.1\makensis.exe'
$fixture=Join-Path $root 'fixture.nsi'
@"
Unicode true
SilentInstall silent
RequestExecutionLevel user
OutFile "$target\ZA-Thera.exe"
Section
Sleep 120000
SectionEnd
"@ | Set-Content -LiteralPath $fixture -Encoding utf8
& $compiler /INPUTCHARSET UTF8 $fixture | Out-Null
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
Copy-Item -LiteralPath (Join-Path $target 'ZA-Thera.exe') -Destination $sibling
$source=Get-Content -LiteralPath (Join-Path $project 'apps\client\build\process-guard.ps1') -Raw
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($source))
$ps=Join-Path $env:SystemRoot 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
$oldTarget=$env:ZA_THERA_INSTALL_EXE;$oldAction=$env:ZA_THERA_INSTALL_ACTION
$env:ZA_THERA_INSTALL_EXE=Join-Path $target 'ZA-Thera.exe'
$started=@()
function Check([string]$action,[int]$expected){
 $env:ZA_THERA_INSTALL_ACTION=$action
 & $ps -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded | Out-Null
 if($LASTEXITCODE -ne $expected){throw "$action expected $expected, received $LASTEXITCODE"}
}
try {
 Check 'check' 0
 $other=Start-Process -FilePath (Join-Path $sibling 'ZA-Thera.exe') -WindowStyle Hidden -PassThru;$started+=$other
 Check 'check' 0
 $oldMatches=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($target,'CurrentCultureIgnoreCase')})
 if(-not ($oldMatches.ProcessId -contains $other.Id)){throw 'Old prefix false positive was not reproduced'}
 $app=Start-Process -FilePath (Join-Path $target 'ZA-Thera.exe') -WindowStyle Hidden -PassThru;$started+=$app
 Check 'check' 10
 Check 'close' 0
 $other.Refresh();if($other.HasExited){throw 'Other installation was closed'}
 Check 'close' 0
 Check 'invalid-action' 20
 $env:ZA_THERA_INSTALL_EXE='relative\ZA-Thera.exe';Check 'check' 20
 $result=@{passed=7;oldPrefixFalsePositiveReproduced=$true;exactTargetClosed=$true;otherInstallationPreserved=$true;unicodeAndApostrophePath=$true;unknownFailsClosed=$true}
 $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $project '.runtime\installer-guard-tests.json')
 $result | ConvertTo-Json
} finally {
 foreach($p in $started){$p.Refresh();if(-not $p.HasExited){$actual=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)";if($actual.ExecutablePath -eq (Join-Path $target 'ZA-Thera.exe') -or $actual.ExecutablePath -eq (Join-Path $sibling 'ZA-Thera.exe')){Stop-Process -Id $p.Id}}}
 $env:ZA_THERA_INSTALL_EXE=$oldTarget;$env:ZA_THERA_INSTALL_ACTION=$oldAction
}
