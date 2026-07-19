@echo off
cd /d "%~dp0"
set "NODE_EXE=node"
if exist "%~dp0runtime\node.exe" (
  set "NODE_EXE=%~dp0runtime\node.exe"
  set "PATH=%~dp0runtime;%PATH%"
)
"%NODE_EXE%" scripts\server-control.js stop %1
pause
