!include "LogicLib.nsh"
!include "FileFunc.nsh"
!insertmacro GetFileName
!insertmacro GetParameters

Function .onVerifyInstDir
  ${GetFileName} $INSTDIR $0
  ${If} $0 != "SillyTavern"
    StrCpy $INSTDIR "$INSTDIR\SillyTavern"
  ${EndIf}
FunctionEnd

!macro customInit
  ; Restore preserved SillyTavern (recursive) to avoid re-download
  IfFileExists "$TEMP\sillytavern-preserve\server.js" 0 NoPreserve
    CreateDirectory "$INSTDIR\resources\sillytavern"
    nsExec::ExecToLog 'xcopy /E /I /Y /Q "$TEMP\sillytavern-preserve" "$INSTDIR\resources\sillytavern"'
    RMDir /r "$TEMP\sillytavern-preserve"
  NoPreserve:
!macroend

!macro customUnInstall
  ; Move SillyTavern (recursive) out of $INSTDIR so uninstaller won't delete it
  RMDir /r "$TEMP\sillytavern-preserve"
  IfFileExists "$INSTDIR\resources\sillytavern\server.js" 0 NoMove
    CreateDirectory "$TEMP\sillytavern-preserve"
    nsExec::ExecToLog 'xcopy /E /I /Y /Q "$INSTDIR\resources\sillytavern" "$TEMP\sillytavern-preserve"'
  NoMove:
  
  ${GetParameters} $R0
  StrCpy $R1 $R0 4
  ${If} $R1 == "_?="
    Goto Done
  ${EndIf}
  
  MessageBox MB_YESNO|MB_ICONQUESTION "是否删除所有用户数据？$\n$\n将删除：$\n- $INSTDIR\Data$\n- $APPDATA\SillyTavern\Data (旧版残留)$\n- $APPDATA\sillytavern-electron" IDNO Done
  RMDir /r "$INSTDIR\Data"
  RMDir /r "$APPDATA\SillyTavern\Data"
  RMDir /r "$APPDATA\SillyTavern"
  RMDir /r "$APPDATA\sillytavern-electron"
  Done:
!macroend
