# Pawscope one-line installer for Windows (PowerShell 5+).
#
# Usage:
#   irm https://raw.githubusercontent.com/benjamin7007/Pawscope/master/install.ps1 | iex
#
# Optional environment variables:
#   $env:PAWSCOPE_VERSION   pin a specific tag (e.g. v1.9.1). Default: latest.
#   $env:PAWSCOPE_PREFIX    install dir. Default: $env:LOCALAPPDATA\pawscope.
#
# Requires: PowerShell 5+ (built-in on Windows 10/11).

$ErrorActionPreference = 'Stop'

$Repo = "benjamin7007/Pawscope"
$Version = if ($env:PAWSCOPE_VERSION) { $env:PAWSCOPE_VERSION } else { "latest" }
$Target = "x86_64-pc-windows-msvc"
$Asset = "pawscope-${Target}.zip"

# Resolve install prefix
$Prefix = if ($env:PAWSCOPE_PREFIX) { $env:PAWSCOPE_PREFIX } else { Join-Path $env:LOCALAPPDATA "pawscope" }
if (-not (Test-Path $Prefix)) { New-Item -ItemType Directory -Path $Prefix -Force | Out-Null }

# Build download URL
if ($Version -eq "latest") {
    $Url = "https://github.com/${Repo}/releases/latest/download/${Asset}"
    $ShaUrl = "${Url}.sha256"
} else {
    $Url = "https://github.com/${Repo}/releases/download/${Version}/${Asset}"
    $ShaUrl = "${Url}.sha256"
}

Write-Host "==> Target:  $Target" -ForegroundColor Cyan
Write-Host "==> Version: $Version" -ForegroundColor Cyan
Write-Host "==> Prefix:  $Prefix" -ForegroundColor Cyan
Write-Host "==> Asset:   $Url" -ForegroundColor Cyan

# Download
$TmpDir = Join-Path $env:TEMP "pawscope-install-$(Get-Random)"
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null
$ZipPath = Join-Path $TmpDir $Asset
$ShaPath = Join-Path $TmpDir "${Asset}.sha256"

try {
    Write-Host "==> Downloading..." -ForegroundColor Cyan
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing
    Invoke-WebRequest -Uri $ShaUrl -OutFile $ShaPath -UseBasicParsing
} catch {
    Write-Host "error: download failed - $_" -ForegroundColor Red
    exit 1
}

# Verify checksum
$Expected = (Get-Content $ShaPath -Raw).Trim().Split(' ')[0]
$Actual = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
if ($Expected -ne $Actual) {
    Write-Host "error: checksum mismatch (expected $Expected, got $Actual)" -ForegroundColor Red
    exit 1
}
Write-Host "==> Checksum OK" -ForegroundColor Cyan

# Extract
Expand-Archive -Path $ZipPath -DestinationPath $TmpDir -Force
$BinSrc = Join-Path $TmpDir "pawscope-${Target}" "pawscope.exe"
if (-not (Test-Path $BinSrc)) {
    Write-Host "error: pawscope.exe not found in archive" -ForegroundColor Red
    exit 1
}

# Install
$BinDest = Join-Path $Prefix "pawscope.exe"
Copy-Item -Path $BinSrc -Destination $BinDest -Force
Write-Host "==> Installed: $BinDest" -ForegroundColor Cyan

# Cleanup temp
Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue

# Add to PATH if needed
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$Prefix*") {
    [Environment]::SetEnvironmentVariable("Path", "$Prefix;$UserPath", "User")
    $env:Path = "$Prefix;$env:Path"
    Write-Host "==> Added $Prefix to user PATH (restart terminal to take effect)" -ForegroundColor Yellow
}

# Show version
& $BinDest --version

# Auto-start
$ServerUrl = "http://127.0.0.1:7777"
$AlreadyUp = $false
try {
    $null = Invoke-WebRequest -Uri $ServerUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    $AlreadyUp = $true
} catch {}

if ($AlreadyUp) {
    Write-Host "==> Server already running at $ServerUrl — opening browser." -ForegroundColor Cyan
    Start-Process $ServerUrl
} else {
    Write-Host "==> Starting pawscope server..." -ForegroundColor Cyan
    Start-Process -FilePath $BinDest -ArgumentList "serve", "--no-open" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    try {
        $null = Invoke-WebRequest -Uri $ServerUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        Write-Host "==> Server is up: $ServerUrl" -ForegroundColor Cyan
        Start-Process $ServerUrl
    } catch {
        Write-Host "==> Could not auto-start. Run manually: pawscope serve" -ForegroundColor Yellow
    }
}

Write-Host "==> Done!" -ForegroundColor Green
