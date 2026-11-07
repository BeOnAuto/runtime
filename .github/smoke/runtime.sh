# The HTTP assertions are shared by Docker and staged Node smokes. Docker is the
# default so the public image jobs retain their image and volume coverage.
smoke_backend=${SMOKE_BACKEND:-docker}
case "$smoke_backend" in docker | node) ;; *) echo "Unknown smoke backend: $smoke_backend" >&2; exit 1 ;; esac
smoke_helper="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/node-command.ts"
smoke_pids=()

runtime_command() {
  if [ "$smoke_backend" = docker ]; then
    docker run --label "onauto.smoke=${SMOKE_PREFIX:-}" --rm "$image" "$@"
  else
    node "$smoke_helper" "$SMOKE_APP" "$SMOKE_STATE/commands/$$/app" "$SMOKE_STATE/commands/$$/data" "$port" ${1:+--} "$@"
  fi
}

runtime_volume() {
  if [ "$smoke_backend" = docker ]; then
    docker volume create --label "onauto.smoke=${SMOKE_PREFIX:-}" "$1"
  else
    mkdir -p "$SMOKE_STATE/volumes/$1"
  fi
}

runtime_start() {
  local name=$1 volume=$2
  shift 2
  local settings=() setting
  for setting in "$@"; do
    case "$setting" in
      *=*) settings+=("$setting") ;;
      *) settings+=("$setting=${!setting}") ;;
    esac
  done
  if [ "$smoke_backend" = docker ]; then
    local options=() value
    for value in "${settings[@]}"; do options+=(--env "$value"); done
    [ -z "$volume" ] || options+=(--volume "$volume:/data")
    [ -z "${runtime_network:-}" ] || options+=(--network "$runtime_network")
    docker run --label "onauto.smoke=${SMOKE_PREFIX:-}" --detach --name "$name" --publish "$port:5555" "${options[@]}" "$image"
  else
    local instance="$SMOKE_STATE/processes/$name" data="$SMOKE_STATE/volumes/${volume:-$name}"
    mkdir -p "$instance"
    node "$smoke_helper" "$SMOKE_APP" "$instance/app" "$data" "$port" "${settings[@]}" >> "$instance/output.log" 2>&1 &
    local pid=$!
    smoke_pids+=("$pid")
    printf '%s\n' "$pid" > "$instance/pid"
  fi
}

runtime_stop() {
  if [ "$smoke_backend" = docker ]; then
    docker stop "$1"
    test "$(docker inspect "$1" --format '{{.State.ExitCode}}')" = 0
  else
    local pid status=0
    pid="$(cat "$SMOKE_STATE/processes/$1/pid")"
    kill -TERM "$pid"
    wait "$pid" || status=$?
    local index
    for index in "${!smoke_pids[@]}"; do
      if [ "${smoke_pids[$index]}" = "$pid" ]; then unset 'smoke_pids[index]'; fi
    done
    # Match the image's tini -e 143 normalization, but reject crashes.
    test "$status" = 0 || test "$status" = 143
  fi
}

runtime_logs() {
  if [ "$smoke_backend" = docker ] || [ ! -f "$SMOKE_STATE/processes/$1/output.log" ]; then
    docker logs "$1"
  else
    cat "$SMOKE_STATE/processes/$1/output.log"
  fi
}

runtime_cleanup() {
  local pid
  for pid in "${smoke_pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${smoke_pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
