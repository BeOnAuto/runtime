rm -f last-response
containers_shown_on_failure=()

answered() {
  local body="$1"
  shift
  local status
  status="$(curl --silent --output "$body" --write-out '%{http_code}' "$@")" || true
  printf '%s %s\n' "$status" "$body" > last-response
  printf '%s' "$status"
}

show_logs_on_failure() {
  containers_shown_on_failure=("$@")
}

show_what_failed() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -f last-response ]; then
    read -r answered_status body < last-response
    echo "::group::The last response, $answered_status, kept in $body"
    cat "$body" 2> /dev/null || true
    echo
    echo '::endgroup::'
  fi
  if [ "$status" -ne 0 ]; then
    for container in "${containers_shown_on_failure[@]}"; do
      echo "::group::The log of the container $container"
      docker logs "$container" 2>&1 | tail --lines 200 || true
      echo '::endgroup::'
    done
  fi
  exit "$status"
}

trap show_what_failed EXIT
