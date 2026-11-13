@echo off
rem The calling launcher's setlocal keeps these settings scoped to this run.
if not exist "%~dp0..\.runtime\dotnet\dotnet.exe" goto :node
set "DOTNET_ROOT=%~dp0..\.runtime\dotnet"
set "DOTNET_CLI_HOME=%~dp0..\.runtime\dotnet-home"
set "NUGET_PACKAGES=%~dp0..\.runtime\nuget-packages"
set "DOTNET_ADD_GLOBAL_TOOLS_TO_PATH=0"
set "PATH=%DOTNET_ROOT%;%PATH%"

:node
where node.exe >nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
exit /b 0
