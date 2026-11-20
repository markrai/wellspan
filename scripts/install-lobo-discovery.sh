#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
if [[ "$(id -u)" -ne 0 ]]; then
  printf 'Run with sudo: sudo ./scripts/install-lobo-discovery.sh\n' >&2
  exit 1
fi
for command in python3 avahi-browse systemctl install; do
  command -v "$command" >/dev/null || { printf 'Missing dependency: %s\n' "$command" >&2; exit 1; }
done

install -D -m 0755 "$ROOT/scripts/lobo_discover.py" /usr/local/libexec/wellspan/lobo_discover.py
install -D -m 0644 "$ROOT/deploy/systemd/wellspan-lobo-discovery.service" /etc/systemd/system/wellspan-lobo-discovery.service
install -D -m 0644 "$ROOT/deploy/systemd/wellspan-lobo-discovery.timer" /etc/systemd/system/wellspan-lobo-discovery.timer

systemctl daemon-reload
systemctl enable --now wellspan-lobo-discovery.timer
systemctl start wellspan-lobo-discovery.service

printf 'Discovery snapshot: /var/lib/wellspan-lobo/devices.json\n'
printf 'Re-run ./deploy.sh after installation to mount the snapshot read-only into Wellspan.\n'
