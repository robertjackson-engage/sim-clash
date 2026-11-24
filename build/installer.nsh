; Additions to electron-builder's NSIS installer for the game (build/electron-builder.cjs,
; nsis.include). See docs/dev/packaging.md.
;
; electron-builder keeps a copy of the whole installer in
;   %LOCALAPPDATA%\<package name>-updater\installer.exe
; for its auto-updater's differential downloads, and its uninstaller leaves that copy
; behind. This app has no auto-updater, so the copy is about 150 MB of nothing: it is
; removed at the end of the install, and the folder again on uninstall.
; The player's own data (%APPDATA%\<product>) is never touched here.

!macro customInstall
  !ifdef APP_INSTALLER_STORE_FILE
    Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  !endif
  !ifdef APP_PACKAGE_STORE_FILE
    Delete "$LOCALAPPDATA\${APP_PACKAGE_STORE_FILE}"
  !endif
  ; only when it is empty
  RMDir "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
!macroend

!macro customUnInstall
  RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
!macroend
