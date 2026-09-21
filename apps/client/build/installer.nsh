!include "${BUILD_RESOURCES_DIR}\process-guard.generated.nsh"
Var theraGuardCode
Var theraGuardOutput

!macro TheraCheckProcess ACTION
  System::Call 'kernel32::SetEnvironmentVariable(t "ZA_THERA_INSTALL_EXE", t "$INSTDIR\ZA-Thera.exe") i.r0'
  System::Call 'kernel32::SetEnvironmentVariable(t "ZA_THERA_INSTALL_ACTION", t "${ACTION}") i.r0'
  nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -EncodedCommand ${THERA_PROCESS_GUARD}'
  Pop $theraGuardCode
  Pop $theraGuardOutput
  System::Call 'kernel32::SetEnvironmentVariable(t "ZA_THERA_INSTALL_EXE", p 0)'
  System::Call 'kernel32::SetEnvironmentVariable(t "ZA_THERA_INSTALL_ACTION", p 0)'
!macroend

!macro customCheckAppRunning
theraCheck:
  !insertmacro TheraCheckProcess "check"
  StrCmp $theraGuardCode "0" theraReady
  StrCmp $theraGuardCode "10" theraRunning theraError
theraRunning:
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "安装前需要关闭当前目录的澜序。请先保存工作，点击确定后关闭程序并继续安装。" /SD IDOK IDOK theraClose
  SetErrorLevel 2
  Quit
theraClose:
  !insertmacro TheraCheckProcess "close"
  StrCmp $theraGuardCode "0" theraReady
  StrCmp $theraGuardCode "10" theraStillRunning theraError
theraStillRunning:
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "目标目录的澜序仍在运行。请手动退出后重试。" /SD IDCANCEL IDRETRY theraCheck
  SetErrorLevel 2
  Quit
theraError:
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法检查或关闭目标目录的澜序。安装已暂停，请检查权限后重试。错误代码：$theraGuardCode" /SD IDCANCEL IDRETRY theraCheck
  SetErrorLevel 2
  Quit
theraReady:
!macroend
