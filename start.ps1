# KAM — spuštění na Windows (PowerShell).
#   .\start.ps1            spustí aplikaci na http://127.0.0.1:8000
#   .\start.ps1 -Lan       zpřístupní ji i v místní síti (test na telefonu)
#   .\start.ps1 -Refresh   znovu stáhne otevřená data
param([switch]$Lan, [switch]$Refresh)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$HostAddr = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
$Port = if ($env:KAM_PORT) { $env:KAM_PORT } else { "8000" }

$py = Get-Command py -ErrorAction SilentlyContinue
$pyArgs = @("-3")
if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue; $pyArgs = @() }
if (-not $py) { Write-Host "Chybí Python 3.10+ (https://www.python.org/downloads/)"; exit 1 }
& $py.Source @pyArgs -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) { Write-Host "Potřebujete Python 3.10 nebo novější."; exit 1 }

if (-not (Test-Path ".venv")) {
  Write-Host "› Vytvářím virtuální prostředí…"
  & $py.Source @pyArgs -m venv .venv
}
$vpy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
Write-Host "› Instaluji závislosti…"
& $vpy -m pip install --quiet --upgrade pip
& $vpy -m pip install --quiet -r requirements.txt

if (-not (Test-Path "frontend\dist\index.html")) {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { $nodeDir = Join-Path $env:LOCALAPPDATA "Programs\nodejs"; if (Test-Path "$nodeDir\npm.cmd") { $env:PATH = "$nodeDir;$env:PATH"; $npm = Get-Command npm.cmd } }
  if (-not $npm) { Write-Host "Chybí sestavený frontend a Node.js (https://nodejs.org). Nainstalujte Node.js 20+ a spusťte znovu."; exit 1 }
  Write-Host "› Sestavuji frontend…"
  Push-Location frontend; & $npm.Source ci --no-audit --no-fund; & $npm.Source run build; Pop-Location
}

if (-not (Test-Path "data\kam.db") -or $Refresh) {
  Write-Host "› Stahuji a zpracovávám otevřená data (první spuštění, několik minut)…"
  Push-Location backend; & $vpy -m kam.ingest all; Pop-Location
}

$url = "http://127.0.0.1:$Port"
Write-Host "› KAM běží na $url  (Ctrl+C ukončí)"
Start-Job -ScriptBlock { param($u) Start-Sleep -Seconds 2; Start-Process $u } -ArgumentList $url | Out-Null
& $vpy -m uvicorn kam.main:app --app-dir backend --host $HostAddr --port $Port
