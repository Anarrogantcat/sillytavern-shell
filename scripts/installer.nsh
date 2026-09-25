!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!insertmacro GetFileName
!insertmacro GetParameters

Function .onVerifyInstDir
  ${GetFileName} $INSTDIR $0
  ${If} $0 == "Shell"
    ; 目录名已经是 Shell，保持不变
  ${ElseIf} $0 == "SillyTavern"
    ; electron-builder 默认目录已包含 SillyTavern，只追加 \Shell，避免 SillyTavern\SillyTavern\Shell
    StrCpy $INSTDIR "$INSTDIR\Shell"
  ${Else}
    StrCpy $INSTDIR "$INSTDIR\SillyTavern\Shell"
  ${EndIf}
FunctionEnd

; 确保壳装进 "\Shell" 子目录（三分离：Shell / SillyTavern / Data）。
; .onVerifyInstDir 只在用户改目录页时调用，静默安装（/S）不经过它，会落到 ...\Programs\SillyTavern 并让三分离塌陷。
; 这个宏是幂等的，由 customInstall 调用 —— 那条路径一定会执行。
!macro dshNormalizeDir base
  ; 注意：NSIS 宏参数是编译期文本替换 —— 这里只能写 $INSTDIR；写成 $base 会被当成变量名并静默失效。
  StrCpy $R1 "$INSTDIR"
  ${GetFileName} $R1 $R2
  ; 已经是 ...\Shell → 不动
  ${If} $R2 == "Shell"
    StrCpy $R1 "$INSTDIR"
  ; 是 ...\<产品名>（壳/ST 的父目录）→ 追加 \Shell
  ${ElseIf} $R2 == "${PRODUCT_NAME}"
    StrCpy $R1 "$INSTDIR\Shell"
  ; 其它 → 新建 <base>\<产品名>\Shell
  ${Else}
    StrCpy $R1 "$INSTDIR\${PRODUCT_NAME}\Shell"
  ${EndIf}
!macroend

!macro customInit
  ; B2：交互安装走 .onVerifyInstDir，静默安装（/S）不经过它 —— 这里补一次幂等归一，
  ; 之后 customInstall 的读写目标才与运行时假设（壳在 <父>\SillyTavern\Shell）一致。
  !insertmacro dshNormalizeDir "$INSTDIR"
  StrCpy $INSTDIR $R1
!macroend

!macro customInstall
  ; B2：这里再归一一次，保证静默安装与交互安装得到同一套目录结构
  !insertmacro dshNormalizeDir "$INSTDIR"
  StrCpy $INSTDIR $R1
  ; B3：写归属标记 —— 卸载器只删「能证明是自己装的」目录
  ; 注意：NSIS 的 FileOpen 不会建目录，目标目录必须先 CreateDirectory（实测：漏了它标记写不进去，且失败是静默的）
  CreateDirectory "$INSTDIR\..\Data"
  ClearErrors
  FileOpen $R2 "$INSTDIR\..\Data\.shell-owned" w
  ${If} ${Errors}
    DetailPrint "警告：无法写入 Data 归属标记，卸载时将保留 Data 目录（更安全）"
  ${Else}
    FileWrite $R2 "sillytavern-shell$\r$\n"
    FileClose $R2
  ${EndIf}
  CreateDirectory "$INSTDIR\resources"
  ClearErrors
  FileOpen $R2 "$INSTDIR\resources\.shell-owned" w
  ${If} ${Errors}
    DetailPrint "警告：无法写入 resources 归属标记"
  ${Else}
    FileWrite $R2 "sillytavern-shell$\r$\n"
    FileClose $R2
  ${EndIf}
  ; 完整版把 ST 放在 resources 里 —— 安装后移到兄弟目录
  IfFileExists "$INSTDIR\resources\sillytavern\server.js" 0 NoST
    ; B3：绝不把内置 ST 覆盖合并进「不能证明是自己的」目录
    ${If} ${FileExists} "$INSTDIR\..\server.js"
      ${IfNot} ${FileExists} "$INSTDIR\..\.shell-owned"
        ; 静默安装下模态框可能不受 SetSilent 抑制（实测在真实桌面上弹了出来）—— 这里只写诊断，不弹窗、不阻塞
        DetailPrint "内置 SillyTavern 未安装：$INSTDIR\.. 已存在不是本程序安装的 SillyTavern（无 .shell-owned 标记）。已跳过搬运，未覆盖任何文件。"
        Goto NoST
      ${EndIf}
    ${EndIf}
    ; 目标就是 <父>\SillyTavern（= $INSTDIR\..，也是运行时 defaultST 的位置）—— 再加一层 \SillyTavern 会多嵌一层目录
    nsExec::ExecToLog 'xcopy /E /I /Y /Q "$INSTDIR\resources\sillytavern" "$INSTDIR\.."'
    RMDir /r "$INSTDIR\resources\sillytavern"
    ; 只有「我们真的把 ST 放进去」时才写这两个标记 —— 否则卸载时可能删掉用户自己装的 ST
    ; .shell-owned = 通用归属标记；.shell-placed-st = 明确表示 ST 本体由本程序放入
    FileOpen $R2 "$INSTDIR\..\.shell-owned" w
    FileWrite $R2 "sillytavern-shell$\r$\n"
    FileClose $R2
    FileOpen $R2 "$INSTDIR\..\.shell-placed-st" w
    FileWrite $R2 "sillytavern-shell$\r$\n"
    FileClose $R2
  NoST:
!macroend

!macro customUnInstall
  ; B5：静默卸载（升级 / 自动更新）绝不能弹框、绝不能删用户数据。
  ; 旧写法取命令行前 4 个字符判 "_?="，而 electron-builder 传的是 "/S /KEEP_APP_DATA ... --updated _?=<dir>"，
  ; 前 4 字符恒为 "/S /"，这个守卫从来没生效过。
  ${If} ${Silent}
    Goto Done
  ${EndIf}

  ; 手动卸载 —— 勾选框（ST 与数据都在安装目录之外）
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 != error
    ${NSD_CreateLabel} 0 10u 100% 40u "是否同时删除 SillyTavern 本体和用户数据？$\r$\n$\r$\n只会删本程序安装的目录（带 .shell-owned 标记）；你自己装的 SillyTavern 不会被删。$\r$\n勾选后还会删除套壳设置（%APPDATA%\SillyTavern）与已保存的回滚包。"
    Pop $0
    ${NSD_CreateCheckbox} 0 58u 100% 14u "删除 SillyTavern 本体、聊天记录/角色卡，以及套壳设置与回滚包（不可恢复）"
    Pop $1
    nsDialogs::Show
    ${NSD_GetState} $1 $2
    ${If} $2 == ${BST_CHECKED}
      ; B3：只删有归属标记的目录
      ${If} ${FileExists} "$INSTDIR\..\.shell-placed-st"
        RMDir /r "$INSTDIR\..\SillyTavern"
      ${Else}
        DetailPrint "保留 $INSTDIR\..\SillyTavern（没有本程序的归属标记，可能是你自己装的）"
      ${EndIf}
      !ifdef PRODUCT_NAME
        ${GetFileName} "$INSTDIR\..\Data" $R1
        ${If} $R1 == "${PRODUCT_NAME}"
          ${If} ${FileExists} "$INSTDIR\..\Data\.shell-owned"
            RMDir /r "$INSTDIR\..\Data"
          ${Else}
            DetailPrint "保留 $INSTDIR\..\Data（没有本程序的归属标记）"
          ${EndIf}
        ${EndIf}
      !endif
      RMDir /r "$APPDATA\SillyTavern"
      RMDir /r "$APPDATA\sillytavern-electron"
    ${EndIf}
  ${EndIf}
  Done:
!macroend
