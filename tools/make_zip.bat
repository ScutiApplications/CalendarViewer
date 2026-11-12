@echo off
rem Build dist\CalendarViewer-<VERSION>.zip, select it in Explorer, and open GitHub's new-release page for that tag
rem so the zip can be dragged onto it. Run it after the release is tagged (see Releasing in README.md).
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
uv run "%ROOT%\tools\make_zip.py" || (echo ZIP creation failed. & pause & exit /b 1)
set /p VER=<"%ROOT%\VERSION"
start "" explorer /select,"%ROOT%\dist\CalendarViewer-%VER%.zip"
start "" "https://github.com/ScutiApplications/CalendarViewer/releases/new?tag=v%VER%"
echo.
echo Drag dist\CalendarViewer-%VER%.zip onto the release page, paste the notes, and publish.
pause
