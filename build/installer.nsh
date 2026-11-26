!macro customInstallMode
  ${if} $hasPerMachineInstallation != "1"
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend
