@echo off
rem Manual one-time install of a built release over an existing CalendarViewer folder. Keeps its data folder.
rem Usage: tools\install-local.bat [target folder] [version]
rem   defaults: target = %USERPROFILE%\Documents\CalendarViewer, version = the VERSION file of this repo
rem Needed once when the installed version cannot update itself (for example 0.0.9 with the signature check bug).
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=D:\User\Documents\CalendarViewer"
set "VER=%~2"
if "%VER%"=="" for /f "usebackq delims=" %%V in ("%ROOT%\VERSION") do set "VER=%%V"
set "ZIP=%ROOT%\dist\CalendarViewer-%VER%.zip"
if not exist "%ZIP%" ( echo Missing %ZIP%. Build it with tools\make_zip.bat first. & pause & exit /b 1 )
if not exist "%TARGET%\run.bat" ( echo %TARGET% is not a CalendarViewer folder. & pause & exit /b 1 )
echo Installing %VER% into %TARGET%. The data folder is kept.
call "%TARGET%\run.bat" stop
set "STAGE=%TEMP%\calendarviewer-install-%RANDOM%"
powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%STAGE%' -Force" || ( echo Could not unpack the zip. & pause & exit /b 1 )
set "SRC=%STAGE%"
if not exist "%SRC%\run.bat" for /d %%D in ("%STAGE%\*") do if exist "%%D\run.bat" set "SRC=%%D"
if not exist "%SRC%\run.bat" ( echo The zip has no run.bat. Nothing was changed. & rd /s /q "%STAGE%" & pause & exit /b 1 )
robocopy "%SRC%" "%TARGET%" /E /XD data /NFL /NDL /NJH /NJS /NP
if errorlevel 8 ( echo Copy failed. Close CalendarViewer and try again. & rd /s /q "%STAGE%" & pause & exit /b 1 )
rd /s /q "%STAGE%"
echo.
echo Installed version:
type "%TARGET%\VERSION"
echo Start it with run.bat.
pause
