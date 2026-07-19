@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
title INPX Library Server - Release Build
echo.

set "NODE_EXE=node"
if exist "runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"

"%NODE_EXE%" -v >nul 2>&1
if errorlevel 1 (
  echo  Node.js not found.
  echo  Run install.cmd first, or install Node.js manually.
  goto :fail
)

if not exist "node_modules\" (
  echo  Dependencies not installed.
  echo  Run install.cmd first.
  goto :fail
)

"%NODE_EXE%" scripts/build-release.js
if errorlevel 1 goto :fail
echo.
echo  Release archive is in the release\ folder.
goto :success

:fail
echo.
echo  ERROR: Release build failed.
echo.
pause
exit /b 1

:success
echo.
pause
exit /b 0
