!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!insertmacro GetFileName
!insertmacro GetParameters

Function .onVerifyInstDir
  ${GetFileName} $INSTDIR $0
  ${If} $0 != "Shell"
    StrCpy $INSTDIR "$INSTDIR\SillyTavern\Shell"
  ${EndIf}
FunctionEnd

!macro customInit
  ; Legacy upgrade (old shell kept ST inside resources) — restore to sibling dir
  IfFileExists "$TEMP\sillytavern-preserve\server.js" 0 NoPreserve
    CreateDirectory "$INSTDIR\..\SillyTavern"
    nsExec::ExecToLog 'xcopy /E /I /Y /Q "$TEMP\sillytavern-preserve" "$INSTDIR\..\SillyTavern"'
    RMDir /r "$TEMP\sillytavern-preserve"
  NoPreserve:
!macroend

!macro customInstall
  ; Full version ships ST inside resources — move it to sibling dir after install
  IfFileExists "$INSTDIR\resources\sillytavern\server.js" 0 NoST
    CreateDirectory "$INSTDIR\..\SillyTavern"
    nsExec::ExecToLog 'xcopy /E /I /Y /Q "$INSTDIR\resources\sillytavern" "$INSTDIR\..\SillyTavern"'
    RMDir /r "$INSTDIR\resources\sillytavern"
  NoST:
!macroend

!macro customUnInstall
  ; Upgrade (silent, invoked by new installer) — no dialog, nothing deleted
  ${GetParameters} $R0
  StrCpy $R1 $R0 4
  ${If} $R1 == "_?="
    Goto Done
  ${EndIf}

  ; Manual uninstall — checkbox dialog (ST & data live OUTSIDE install dir)
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 != error
    ${NSD_CreateLabel} 0 10u 100% 24u "是否同时删除 SillyTavern 本体和用户数据？$\r$\n删除后无法恢复。"
    Pop $0
    ${NSD_CreateCheckbox} 0 40u 100% 14u "删除 SillyTavern 本体和用户数据（聊天记录、角色卡）"
    Pop $1
    nsDialogs::Show
    ${NSD_GetState} $1 $2
    ${If} $2 == ${BST_CHECKED}
      RMDir /r "$INSTDIR\..\SillyTavern"
      RMDir /r "$INSTDIR\..\Data"
      RMDir /r "$APPDATA\SillyTavern"
      RMDir /r "$APPDATA\sillytavern-electron"
    ${EndIf}
  ${EndIf}
  Done:
!macroend
