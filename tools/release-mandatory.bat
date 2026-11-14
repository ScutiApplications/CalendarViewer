@echo off
rem Release as a mandatory update. Same as tools\release.bat --mandatory: raises the minor version (X.Y.0), or the major one
rem (X.0.0) with: release-mandatory.bat major. A patch bump is refused, and CHANGELOG.md needs entries under Unreleased.
rem Installs older than this version then show an Update required panel that cannot be closed until they update.
rem Later releases keep the requirement unless a newer one is published.
setlocal
call "%~dp0release.bat" --mandatory %*
