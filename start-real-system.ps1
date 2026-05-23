# Insurance AI Assistant - Real System Setup Script (Windows)
# This script sets up and starts the complete real multi-agent system

$rootPath = (Get-Location).Path
Write-Host "Setting up REAL Insurance AI Assistant System..." -ForegroundColor Green
Write-Host "Root Path: $rootPath" -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Green

# Check if Python is available
try {
    $pythonVersion = python --version
    Write-Host "Python found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "Python is not installed. Please install Python 3.8 or higher." -ForegroundColor Red
    exit 1
}

# Check if Node.js is available
try {
    $nodeVersion = node --version
    Write-Host "Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "Node.js is not installed. Please install Node.js 18 or higher." -ForegroundColor Red
    exit 1
}

# Install Python dependencies
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
$multiAgentPath = "$rootPath\multi-agent-system"
Set-Location -Path $multiAgentPath
pip install -r requirements.txt

# Check database
if (!(Test-Path "insurance_support.db")) {
    Write-Host "Real database not found. Creating sample database..." -ForegroundColor Yellow
    python setup_database.py
} else {
    Write-Host "Real database found" -ForegroundColor Green
}

# Install Backend dependencies
Write-Host "Installing Node.js backend dependencies..." -ForegroundColor Yellow
$backendPath = "$rootPath\insurance-ui-backend"
Set-Location -Path $backendPath
npm install

# Install Frontend dependencies
Write-Host "Installing Node.js frontend dependencies..." -ForegroundColor Yellow
$frontendPath = "$rootPath\insurance-ui-frontend"
Set-Location -Path $frontendPath
npm install --legacy-peer-deps

# Create stop script
$stopScriptPath = "$rootPath\stop-servers.ps1"
$stopScriptContent = @"
Write-Host "Stopping all servers..." -ForegroundColor Yellow
Get-Process | Where-Object {`$_.ProcessName -like "*python*" -or `$_.ProcessName -like "*flask*" -or `$_.ProcessName -like "*node*"} | Stop-Process -Force
Write-Host "All servers stopped" -ForegroundColor Green
"@

$stopScriptContent | Out-File -FilePath $stopScriptPath -Encoding UTF8

# Start Python API
Write-Host "Starting Python Multi-Agent API Server..." -ForegroundColor Green
Set-Location -Path $multiAgentPath
Start-Process -FilePath "python" -ArgumentList "api_server.py" -NoNewWindow

# Wait for Python
Start-Sleep -Seconds 5

# Start Backend
Write-Host "Starting Node.js Backend Server..." -ForegroundColor Green
Set-Location -Path $backendPath
Start-Process -FilePath "cmd" -ArgumentList "/c npm run dev" -NoNewWindow

# Wait for Backend
Start-Sleep -Seconds 5

# Start Frontend
Write-Host "Starting Frontend Server..." -ForegroundColor Green
Set-Location -Path $frontendPath
Start-Process -FilePath "cmd" -ArgumentList "/c npm start" -NoNewWindow

Write-Host ""
Write-Host "REAL INSURANCE AI ASSISTANT IS NOW RUNNING!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend API: http://localhost:3001" -ForegroundColor Cyan
Write-Host "Python Multi-Agent API: http://localhost:8002" -ForegroundColor Cyan
Write-Host ""
Write-Host "To stop all servers, run: .\stop-servers.ps1" -ForegroundColor Yellow
Write-Host ""
