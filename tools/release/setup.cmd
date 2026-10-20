@echo off
rem Entry point extracted by the IExpress self-extracting Setup.exe. Configuration is read from SLOPSIDIAN_* variables.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -PackageZip "%~dp0payload.zip"
exit /b %errorlevel%
