#!/bin/bash
# Запуск на VPS: bash server/deploy/setup-gateway-vps.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

if [ ! -f server/flow-mobile-gateway.js ]; then
  echo "Запусти из /opt/nexory после git clone NexoryND"
  exit 1
fi

if [ -z "${FLOW_MOBILE_GATEWAY_SECRET:-}" ] && [ -f server/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source server/.env
  set +a
fi

if [ -z "${FLOW_MOBILE_GATEWAY_SECRET:-}" ]; then
  echo "Создай server/.env с FLOW_MOBILE_GATEWAY_SECRET=..."
  exit 1
fi
if echo "${FLOW_MOBILE_GATEWAY_SECRET}" | grep -qiE 'вставь|secret_из|example|changeme'; then
  echo "В server/.env нужен реальный SECRET (64 hex), не текст из инструкции."
  exit 1
fi

npm ci --omit=dev 2>/dev/null || npm install --omit=dev

systemctl disable --now flow-mobile-gateway 2>/dev/null || true

cat > /etc/systemd/system/nexory-gateway.service << EOF
[Unit]
Description=Nexory Mobile Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
EnvironmentFile=${ROOT}/server/.env
ExecStart=/usr/bin/node server/flow-mobile-gateway.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nexory-gateway
systemctl restart nexory-gateway
sleep 1

if ! curl -sf http://127.0.0.1:3950/health | grep -q '"ok":true'; then
  echo "Ошибка: gateway не отвечает на 127.0.0.1:3950"
  journalctl -u nexory-gateway -n 30 --no-pager
  exit 1
fi
echo "OK: nexory-gateway на :3950 (localhost)"

if command -v nginx >/dev/null 2>&1; then
  cp "${ROOT}/server/deploy/nginx-nexory-gateway.conf" /etc/nginx/sites-available/nexory-gateway
  rm -f /etc/nginx/sites-enabled/nexory-gateway /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/nexory-gateway /etc/nginx/sites-enabled/nexory-gateway
  test -f /etc/nginx/sites-enabled/nexory-gateway || { echo "nginx: не создался symlink"; exit 1; }
  nginx -t
  systemctl reload nginx
  if curl -sf http://127.0.0.1/health | grep -q '"ok":true'; then
    echo "OK: nginx проксирует /health на :80"
    echo ""
    echo "В Nexory Gateway URL: http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
    echo "(без :3950)"
  else
    echo "nginx есть, но /health не проксируется — проверь sites-enabled"
  fi
else
  echo "nginx не установлен — открой TCP 3950 в Timeweb Firewall"
  echo "Gateway URL: http://IP:3950"
fi
