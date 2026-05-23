﻿Write-Host "Stopping all servers..." -ForegroundColor Yellow
Get-Process | Where-Object {$_.ProcessName -like "*python*" -or $_.ProcessName -like "*flask*" -or $_.ProcessName -like "*node*"} | Stop-Process -Force
Write-Host "All servers stopped" -ForegroundColor Green
