@echo off
rem One-command deploy of mihonban cloud (Cloudflare Workers + D1 + OneDrive).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-cloud.ps1" %*
