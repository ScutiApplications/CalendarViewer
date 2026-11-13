@echo off
rem Release as a mandatory update. Same as tools\release.bat --mandatory, including the version bump.
rem Installs older than this version then show an Update required panel that cannot be closed until they update.
rem Later releases keep the requirement unless a newer one is published.
setlocal
call "%~dp0release.bat" --mandatory %*
