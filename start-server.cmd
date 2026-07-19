@echo off
cd /d "%~dp0"
title INPX Library Server
echo.

:: --- Bundled Node.js (always prefer runtime over system Node 22+) ---
set "NODE_EXE=node"
set "NPM_CMD=npm"
if exist "%~dp0runtime\node.exe" (
  set "NODE_EXE=%~dp0runtime\node.exe"
  set "PATH=%~dp0runtime;%PATH%"
)
if exist "%~dp0runtime\npm.cmd" set "NPM_CMD=%~dp0runtime\npm.cmd"

"%NODE_EXE%" -v >nul 2>&1
if errorlevel 1 (
  echo  Node.js not found.
  echo  Run install.cmd first.
  goto :fail
)
for /f "tokens=*" %%V in ('"%NODE_EXE%" -v') do echo   Node.js %%V

:: --- Check dependencies ---
if not exist "node_modules\" (
  echo  Dependencies not installed.
  echo  Run install.cmd first.
  goto :fail
)

:: --- Rebuild native modules if broken (e.g. after npm with system Node) ---
setlocal enabledelayedexpansion
set "PREV_VER="
if exist "node_modules\.node_version" set /p PREV_VER=<"node_modules\.node_version"
for /f "tokens=*" %%V in ('"%NODE_EXE%" -v') do set "CUR_VER=%%V"
set "NEED_REBUILD=0"
if not "!PREV_VER!"=="!CUR_VER!" set "NEED_REBUILD=1"
"%NODE_EXE%" -e "const D=require('better-sqlite3');const d=new D(':memory:');d.close()" >nul 2>&1
if errorlevel 1 set "NEED_REBUILD=1"
if "!NEED_REBUILD!"=="1" (
  if not "!PREV_VER!"=="!CUR_VER!" (
    echo  Node.js version changed (!PREV_VER! -^> !CUR_VER!^), rebuilding native modules...
  ) else (
    echo  better-sqlite3 needs rebuild for !CUR_VER!...
    echo  ^(often happens after npm install with system Node 22^)
  )
  call "%NPM_CMD%" rebuild better-sqlite3
  if errorlevel 1 (
    echo  ERROR: npm rebuild failed. Run install.cmd again.
    goto :fail
  )
  "%NODE_EXE%" -e "const D=require('better-sqlite3');const d=new D(':memory:');d.close()" >nul 2>&1
  if errorlevel 1 (
    echo  ERROR: better-sqlite3 still broken after rebuild.
    echo  Run install.cmd — do not use system Node/npm in this folder.
    goto :fail
  )
  "%NODE_EXE%" -e "require('fs').writeFileSync('node_modules/.node_version',process.version)"
  echo  Native modules OK
  echo.
)
endlocal

:: --- Detect port ---
set "SERVER_PORT=3000"
if exist ".env" for /f "usebackq tokens=1,* delims==" %%A in (".env") do if /i "%%A"=="PORT" set "SERVER_PORT=%%B"

:: --- Start server ---
"%NODE_EXE%" scripts/server-control.js start
if errorlevel 1 goto :err_start
echo.
echo  ======================================
echo   INPX Library Server is running
echo   http://localhost:%SERVER_PORT%
echo.
echo   Stop:    stop-server.cmd
echo   Restart: restart-server.cmd
echo  ======================================
start "" "http://localhost:%SERVER_PORT%"
goto :end

:err_start
echo.
echo  ERROR: Server failed to start.
echo  Try: stop-server.cmd  then  start-server.cmd
echo  Log:  data\server.log
echo.
echo  If log shows NODE_MODULE_VERSION — run install.cmd, avoid system npm here.
goto :end

:fail
echo.
pause
exit /b 1

:end
echo.
pause
