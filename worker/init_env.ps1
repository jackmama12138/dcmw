# ==========================================================================================
# Worker Environment Deployment Script (Windows PowerShell) - 100% Pure Offline Local Version
# ==========================================================================================

$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = "Stop"

# Local source file path (Must be placed in the same directory as this script)
$LocalNodeMsi    = Join-Path $PSScriptRoot "node-installer.msi"

# Target deployment runtime constants
$NpmRegistry     = "https://registry.npmmirror.com/"

function Log-Info ([string]$msg) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [INFO] $msg" -ForegroundColor Cyan }
function Log-Success ([string]$msg) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [SUCCESS] $msg" -ForegroundColor Green }
function Log-Warn ([string]$msg) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WARN] $msg" -ForegroundColor Yellow }
function Log-Error ([string]$msg) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [ERROR] $msg" -ForegroundColor Red }

# ==========================================
# 1. Local Node.js Verification & Installation
# ==========================================
$needsNodeInstall = $true
try {
    $nodeVer = & node -v 2>$null
    if ($nodeVer -match "v\d+\.") {
        Log-Success "Node.js is already installed globally. Version: $nodeVer (Skipping)"
        $needsNodeInstall = $false
    }
} catch {}

if ($needsNodeInstall) {
    Log-Warn "Node.js not detected in system PATH. Verifying local package..."
    
    if (Test-Path $LocalNodeMsi) {
        Log-Info "Found local package: node-installer.msi. Executing silent installation..."
        $process = Start-Process msiexec.exe -ArgumentList "/i `"$LocalNodeMsi`" /qn /norestart" -PassThru -Wait
        
        if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 1638) {
            Log-Success "Node.js offline installation completed successfully."
        } else {
            Log-Error "Node.js installation failed. MSI ExitCode: $($process.ExitCode)"
            Exit
        }
        # Dynamic path reload for current session context
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    } else {
        Log-Error "Critical Missing File: Place 'node-installer.msi' inside the script folder!"
        Exit
    }
}

# ==========================================
# 2. npm Registry Configuration
# ==========================================
Log-Info "Configuring local npm runtime registry..."
try {
    $currentRegistry = & npm config get registry
    if ($currentRegistry.TrimEnd('/') -ne $TsinghuaRegistry.TrimEnd('/')) {
        & npm config set registry $TsinghuaRegistry
        Log-Success "npm registry successfully targeted to Tsinghua mirror."
    } else {
        Log-Success "npm registry is already configured to Tsinghua mirror."
    }
} catch {
    Log-Error "Failed to access or modify npm settings: $_"
}

# ==========================================
# 3. PM2 Global Installation
# ==========================================
Log-Info "Verifying global PM2 execution context..."
$needsPm2 = $true
try {
    $pm2Path = Where-Object { $_ } (where.exe pm2 2>$null)
    if ($pm2Path) {
        Log-Success "PM2 is already active in your environment. (Skipping)"
        $needsPm2 = $false
    }
} catch {}

if ($needsPm2) {
    Log-Warn "PM2 missing. Installing globally via local mirror pipeline..."
    & npm install pm2 -g
    if ($LASTEXITCODE -eq 0) {
        Log-Success "PM2 global package deployed successfully."
    } else {
        Log-Error "Failed to install PM2 package. Review npm registry visibility."
    }
}

# ==========================================
# 4. Worker Project Dependencies Installation
# ==========================================
if (Test-Path "package.json") {
    Log-Info "Target file package.json discovered. Resolving local dependencies..."
    & npm install
    Log-Success "Worker local dependency stack synchronized."
} else {
    Log-Error "Could not find package.json in the current directory! Please check script placement."
}

Log-Success "=================================================="
Log-Success " Worker environment verified. Exiting safely."
Log-Success "=================================================="