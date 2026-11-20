#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
CONTAINER="wellspan-staging"
IMAGE="wellspan:staging"
CANDIDATE="wellspan:staging-candidate"
ROLLBACK_IMAGE="wellspan:staging-rollback"
VOLUME="wellspan-staging-data"
BIND="127.0.0.1:18788:8080"
DISCOVERY_DIR="/var/lib/wellspan-lobo"
BASE_URL="http://127.0.0.1:18788"
replacement_started=0
deployment_complete=0
previous_image=""

log() {
  printf '[wellspan-deploy] %s\n' "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

for command in git docker curl flock; do
  command -v "$command" >/dev/null 2>&1 || die "Required command unavailable: $command"
done

cd "$ROOT"
[[ "$(git rev-parse --show-toplevel 2>/dev/null)" == "$ROOT" ]] || die "deploy.sh must run in the root of the Wellspan checkout"
[[ "$(git branch --show-current)" == "main" ]] || die "Switch to the main branch before deploying"
[[ -z "$(git status --porcelain)" ]] || die "Working tree has local changes; commit or stash them before deploying"

docker info >/dev/null 2>&1 || die "Docker daemon is unavailable to this user"
docker container inspect "$CONTAINER" >/dev/null 2>&1 || die "Expected existing staging container $CONTAINER was not found"
docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "Expected existing SQLite volume $VOLUME was not found"

mounted_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$CONTAINER")"
[[ "$mounted_volume" == "$VOLUME" ]] || die "Container /data volume differs from $VOLUME; refusing to replace it"
published="$(docker port "$CONTAINER" 8080/tcp)"
[[ "$published" == "127.0.0.1:18788" ]] || die "Container port mapping differs from $BIND; refusing to replace it"
configured_image="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
[[ "$configured_image" == "$IMAGE" ]] || die "Container image is $configured_image rather than $IMAGE; refusing to replace it"

mkdir -p "$ROOT/.tmp"
exec 9>"$ROOT/.tmp/deploy.lock"
flock -n 9 || die "Another Wellspan deployment is running"

wait_healthy() {
  local status
  for ((attempt=0; attempt<60; attempt++)); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)" || return 1
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" ]]; then
      return 1
    fi
    sleep 2
  done
  return 1
}

start_container() {
  local -a discovery_mount=()
  if [[ -d "$DISCOVERY_DIR" && ! -L "$DISCOVERY_DIR" ]]; then
    discovery_mount=(-v "$DISCOVERY_DIR:/discovery:ro")
  fi
  docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --security-opt no-new-privileges \
    --cap-drop ALL \
    -p "$BIND" \
    -v "$VOLUME:/data" \
    "${discovery_mount[@]}" \
    "$IMAGE"
}

recover_on_exit() {
  local status="$?"
  trap - EXIT
  if [[ "$replacement_started" == 1 && "$deployment_complete" != 1 ]]; then
    log "New container failed; attempting to restore the previous image and the same SQLite volume"
    docker logs --tail 60 "$CONTAINER" >&2 || true
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    if docker tag "$previous_image" "$IMAGE" && start_container >/dev/null && wait_healthy &&
      curl -fsS --max-time 5 "$BASE_URL/health" >/dev/null; then
      log "Previous image restored successfully; SQLite volume preserved"
    else
      log "CRITICAL: Automatic rollback failed; inspect Docker and $VOLUME before taking further action" >&2
    fi
  fi
  exit "$status"
}

trap recover_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log "Fetching origin/main (fast-forward only)"
git fetch --no-tags origin main
git merge --ff-only FETCH_HEAD

log "Building new Wellspan image before stopping the running service"
docker build --pull -t "$CANDIDATE" "$ROOT"
docker image inspect "$CANDIDATE" >/dev/null

previous_image="$(docker inspect -f '{{.Image}}' "$CONTAINER")"
docker tag "$previous_image" "$ROLLBACK_IMAGE"
docker tag "$CANDIDATE" "$IMAGE"

log "Replacing $CONTAINER while preserving $VOLUME and $BIND"
replacement_started=1
docker stop --time 20 "$CONTAINER" >/dev/null
docker rm "$CONTAINER" >/dev/null
start_container >/dev/null

if ! wait_healthy; then
  die "New staging container did not become healthy"
fi

curl -fsS --max-time 5 "$BASE_URL/health" >/dev/null || die "New service did not pass HTTP health check"
curl -fsS --max-time 5 "$BASE_URL/api/v1/state" >/dev/null || die "New service did not pass SQLite state read check"

deployment_complete=1
log "Deployment healthy at $BASE_URL"
log "Commit: $(git rev-parse --short HEAD)"
log "SQLite volume retained: $VOLUME"
log "Previous image retained as: $ROLLBACK_IMAGE"
log "Existing Tailscale Serve configuration was not changed"
