#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE="$(cd -- "$(dirname -- "$0")/.." && pwd)/deploy.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT

mkdir -p "$TEMP/bin"
cat > "$TEMP/bin/git" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >> "$TEST_LOG"
case "$1" in
  rev-parse)
    if [[ "$2" == "--show-toplevel" ]]; then printf '%s\n' "$TEST_ROOT"; else echo abcdef12; fi
    ;;
  branch) echo "$TEST_BRANCH" ;;
  status)
    if [[ "$TEST_DIRTY" == 1 ]]; then echo ' M README.md'; fi
    ;;
  fetch|merge)
    if [[ "$TEST_FAIL_PULL" == 1 ]]; then exit 24; fi
    ;;
  *) exit 2 ;;
esac
SCRIPT

cat > "$TEMP/bin/docker" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$TEST_LOG"
case "$1" in
  info|tag|stop|rm|logs) ;;
  container|volume|image)
    [[ "$2" == inspect ]] || exit 3
    ;;
  inspect)
    [[ "$2" == '-f' ]] || exit 4
    case "$3" in
      '{{.Image}}') echo sha256:previous ;;
      '{{.Config.Image}}') echo "$TEST_IMAGE" ;;
      '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}') echo "$TEST_VOLUME" ;;
      '{{.State.Health.Status}}')
        if [[ "$TEST_FAIL_HEALTH" == 1 && -f "$TEST_RUN_COUNT" ]] &&
           [[ "$(cat "$TEST_RUN_COUNT")" == 1 ]]; then
          echo unhealthy
        else
          echo healthy
        fi
        ;;
      *) exit 5 ;;
    esac
    ;;
  port) echo "$TEST_PORT" ;;
  build)
    if [[ "$TEST_FAIL_BUILD" == 1 ]]; then exit 34; fi
    ;;
  run)
    count=0
    if [[ -f "$TEST_RUN_COUNT" ]]; then count="$(cat "$TEST_RUN_COUNT")"; fi
    printf '%s\n' "$((count+1))" > "$TEST_RUN_COUNT"
    echo fake-container-id
    ;;
  *) exit 6 ;;
esac
SCRIPT

cat > "$TEMP/bin/curl" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >> "$TEST_LOG"
printf '{"ok":true}\n'
SCRIPT

chmod +x "$TEMP/bin/git" "$TEMP/bin/docker" "$TEMP/bin/curl"
export PATH="$TEMP/bin:$PATH"

run_case() {
  local name="$1"
  shift
  export TEST_ROOT="$TEMP/$name"
  export TEST_LOG="$TEST_ROOT/commands.log"
  export TEST_RUN_COUNT="$TEST_ROOT/run.count"
  mkdir -p "$TEST_ROOT"
  cp "$SOURCE" "$TEST_ROOT/deploy.sh"
  (
    export TEST_BRANCH=main TEST_DIRTY=0 TEST_FAIL_PULL=0 TEST_FAIL_BUILD=0
    export TEST_FAIL_HEALTH=0 TEST_IMAGE=wellspan:staging TEST_VOLUME=wellspan-staging-data TEST_PORT=127.0.0.1:18788
    for pair in "$@"; do export "$pair"; done
    bash "$TEST_ROOT/deploy.sh" > "$TEST_ROOT/output.log" 2>&1
  )
}

run_case success
grep -Fq 'Deployment healthy' "$TEMP/success/output.log"
grep -Fq 'git fetch --no-tags origin main' "$TEMP/success/commands.log"
grep -Fq 'git merge --ff-only FETCH_HEAD' "$TEMP/success/commands.log"
grep -Fq 'docker build --pull -t wellspan:staging-candidate ' "$TEMP/success/commands.log"
grep -Fq 'docker tag sha256:previous wellspan:staging-rollback' "$TEMP/success/commands.log"
grep -Fq 'docker run -d --name wellspan-staging' "$TEMP/success/commands.log"
grep -Fq '127.0.0.1:18788:8080' "$TEMP/success/commands.log"
grep -Fq 'wellspan-staging-data:/data' "$TEMP/success/commands.log"
grep -Fq 'curl -fsS --max-time 5 http://127.0.0.1:18788/api/v1/state' "$TEMP/success/commands.log"

if run_case build-fail TEST_FAIL_BUILD=1; then
  echo 'expected build failure' >&2
  exit 1
fi
if grep -q '^docker stop ' "$TEMP/build-fail/commands.log"; then
  echo 'build failure stopped running container' >&2
  exit 1
fi

if run_case unsafe-volume TEST_VOLUME=unexpected-data; then
  echo 'expected existing-volume rejection' >&2
  exit 1
fi
if grep -q '^git fetch ' "$TEMP/unsafe-volume/commands.log"; then
  echo 'unsafe volume reached fetch' >&2
  exit 1
fi

if run_case unsafe-port TEST_PORT=0.0.0.0:18788; then
  echo 'expected public-port rejection' >&2
  exit 1
fi
if grep -q '^docker stop ' "$TEMP/unsafe-port/commands.log"; then
  echo 'unsafe port stopped running container' >&2
  exit 1
fi

if run_case dirty TEST_DIRTY=1; then
  echo 'expected dirty-tree rejection' >&2
  exit 1
fi
if grep -q '^docker build ' "$TEMP/dirty/commands.log"; then
  echo 'dirty tree triggered build' >&2
  exit 1
fi

if run_case fetch-fail TEST_FAIL_PULL=1; then
  echo 'expected git failure' >&2
  exit 1
fi
if grep -q '^docker stop ' "$TEMP/fetch-fail/commands.log"; then
  echo 'fetch failure stopped running container' >&2
  exit 1
fi

if run_case health-fail TEST_FAIL_HEALTH=1; then
  echo 'expected new-image health failure' >&2
  exit 1
fi
grep -Fq 'Previous image restored successfully' "$TEMP/health-fail/output.log"
grep -Fq 'docker tag sha256:previous wellspan:staging' "$TEMP/health-fail/commands.log"
[[ "$(cat "$TEMP/health-fail/run.count")" == 2 ]]

if grep -Eq '^docker (volume rm|rm .* -v|system prune)' "$TEMP/success/commands.log"; then
  echo 'data-destructive command found' >&2
  exit 1
fi

printf 'Deploy script success, safeguards and automatic rollback: PASS\n'
