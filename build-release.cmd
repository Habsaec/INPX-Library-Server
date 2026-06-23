@echo off
cd /d "%~dp0"
title INPX Library Server - Release Build
echo.

if exist "runtime\node.exe" set "PATH=%~dp0runtime;%PATH%"
node -v >nul 2>&1
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

node scripts/build-release.js
if errorlevel 1 goto :fail
echo.
echo  Release archive is in the release\ folder.
goto :end

:fail
echo.
echo  ERROR: Release build failed.
goto :end

:end
echo.
pause
