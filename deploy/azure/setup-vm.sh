#!/usr/bin/env bash
# Jednorázová příprava čistého stroje Ubuntu 24.04 v Azure. Pouští ji
# scripts/deploy_azure.sh přes SSH; je idempotentní, druhý běh nic nerozbije.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "== Instaluji Docker"
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
fi

# Odkládací prostor: build frontendu (Vite) si na menším stroji sáhne na
# paměť a bez swapu ho jádro umí zabít uprostřed sestavení.
if ! swapon --show | grep -q /swapfile; then
  echo "== Zakládám 4 GB swap"
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
fi

sudo mkdir -p /srv/kam/app /srv/kam/data
# Kontejner běží pod uživatelem kam (uid 10001) — data musí patřit jemu.
sudo chown -R 10001:10001 /srv/kam/data
sudo chown -R "$USER":"$USER" /srv/kam/app

# Noční obnova dat (katalog, statistiky ČSÚ, vrstvy kraje; jednou týdně
# kontrola odkazů). Běží jako samostatný proces v kontejneru; servery si
# změny všimnou do deseti minut a vyprázdní mezipaměti.
CRON=/etc/cron.d/kam-obnova
echo "30 3 * * * $USER cd /srv/kam/app/deploy/azure && docker compose exec -T kam sh -c 'cd backend && python -m kam.ingest refresh' >> /srv/kam/obnova.log 2>&1" \
  | sudo tee "$CRON" >/dev/null
sudo chmod 644 "$CRON"

echo "== Stroj připraven"
