# Nasadí aplikaci na Cloud Run. Spouští se z kořene repozitáře: .\scripts\deploy.ps1
#
# Soubor musí zůstat v UTF-8 **s BOM**. Windows PowerShell 5.1 bez něj čte
# skript jako ANSI, diakritika se rozsype a parser spadne na neuzavřeném
# řetězci — chyba přitom ukazuje na řádek, kde nic špatně není.
#
# Cesty jsou tu napevno kvůli tomuhle stroji: gcloud není na PATH a bez
# CLOUDSDK_PYTHON sáhne po `python`, což na Windows spadne do zástupce
# Microsoft Store. Obojí jde přebít proměnnou prostředí, kdyby se nasazovalo
# odjinud.
#
# env.yaml zůstává mimo repozitář (je v .gitignore) a nese connection string
# k databázi i klíče. Bez něj se nenasazuje — prázdné proměnné by shodily
# běžící revizi, protože by se rozpadlo připojení k Postgresu.

$ErrorActionPreference = "Stop"

$korenn = Split-Path -Parent $PSScriptRoot
$gcloud = if ($env:GCLOUD_CMD) { $env:GCLOUD_CMD } else { "C:\gcsdk\google-cloud-sdk\bin\gcloud.cmd" }
if (-not $env:CLOUDSDK_PYTHON) { $env:CLOUDSDK_PYTHON = "C:\Users\hushkys\AppData\Local\Programs\Python\Python312\python.exe" }
$promenne = Join-Path $korenn "env.yaml"

if (-not (Test-Path $gcloud)) { throw "gcloud nenalezen: $gcloud (nastav GCLOUD_CMD)" }
if (-not (Test-Path $promenne)) { throw "Chybí env.yaml v kořeni projektu — bez něj by nasazení shodilo připojení k databázi." }

# Frontend se sice sestavuje i v kontejneru, ale sestavit ho napřed tady je
# nejlevnější kontrola: když neprojde typová kontrola, ať to praskne za pět
# vteřin a ne po pěti minutách v Cloud Buildu.
Push-Location (Join-Path $korenn "frontend")
try {
  $env:PATH = "C:\Users\hushkys\AppData\Local\Programs\nodejs;" + $env:PATH
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build selhal, nenasazuji." }
} finally { Pop-Location }

& $gcloud run deploy kam --source $korenn --region europe-west1 `
  --allow-unauthenticated --min-instances 1 --max-instances 3 `
  --cpu 1 --memory 1Gi --timeout 300 --port 8000 `
  --env-vars-file $promenne --quiet
if ($LASTEXITCODE -ne 0) { throw "Nasazení selhalo." }

Write-Output ""
Write-Output "Hotovo. Ověření:"
Write-Output "  https://hack-a-ton-hushkys.web.app"
