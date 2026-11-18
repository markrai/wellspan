#!/usr/bin/env bash
set -euo pipefail

container="wellspan-ci-$$"
volume="wellspan-ci-data-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker rm -f "$container-restarted" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$volume" >/dev/null
docker run -d --name "$container" -p 127.0.0.1::8080 -v "$volume":/data wellspan:ci >/dev/null
port="$(docker port "$container" 8080/tcp | awk -F: '{print $NF}')"
url="http://127.0.0.1:$port"

healthy=0
for attempt in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$container")"
  if [[ "$status" == "healthy" ]]; then
    healthy=1
    break
  fi
  if [[ "$status" == "unhealthy" ]]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  docker logs "$container"
  exit 1
fi

curl --fail --silent --show-error "$url/health" | grep -q '"ok":true'
curl --fail --silent --show-error "$url/src/model.js" | grep -q 'wellspan-foodboard-v1'
curl --fail --silent --show-error "$url/api/v1/state" | grep -q '"revision":0,"state":null'
curl --fail --silent --show-error "$url/manifest.webmanifest" | grep -q 'Wellspan Foodboard'
curl --fail --silent --show-error "$url/sw.js" | grep -q 'wellspan-app-shell-v5'
curl --fail --silent --show-error "$url/src/offline-store.js" | grep -q 'class OfflineStore'
curl --fail --silent --show-error "$url/probe/" | grep -q 'LOBO M3 integration probe'
curl --fail --silent --show-error "$url/src/lobo-handoff.js" | grep -q 'lobo.handoff/v1'
curl --fail --silent --show-error "$url/src/lobo-food-editor.js" | grep -q 'prepareLabelReview'
curl --fail --silent --show-error "$url/probe/fixtures/supported-nutrition.json" | grep -q 'lobo.extract.report/v1'
curl --fail --silent --show-error "$url/api/v1/state" | grep -q '"revision":0,"state":null'
for icon in wellspan-192.png wellspan-512.png; do
  iconstatus="$(curl --silent --output /dev/null --write-out '%{http_code}' "$url/icons/$icon")"
  test "$iconstatus" = 200
done
code="$(curl --silent --output /dev/null --write-out '%{http_code}' "$url/nonexistent-page")"
test "$code" = 404

docker stop "$container" >/dev/null
docker rm "$container" >/dev/null
docker run -d --name "$container-restarted" -p 127.0.0.1::8080 -v "$volume":/data wellspan:ci >/dev/null
for attempt in $(seq 1 20); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$container-restarted")" == "healthy" ]]; then
    exit 0
  fi
  sleep 1
done
docker logs "$container-restarted"
exit 1
