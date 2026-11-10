smoke_name() {
  printf '%s%s\n' "${SMOKE_PREFIX:-}" "$1"
}

. "$(dirname "${BASH_SOURCE[0]}")/runtime.sh"

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

failed_where=''
failed_command=''

noted_failure() {
  failed_command=$1
  failed_where="${BASH_SOURCE[1]##*/} line $2"
  if [ "${#FUNCNAME[@]}" -gt 2 ]; then
    failed_where+=", in ${FUNCNAME[1]}, called from ${BASH_SOURCE[-1]##*/} line ${BASH_LINENO[-2]}"
  fi
}

say_what_failed() {
  local status=$1
  echo "::error::The smoke failed at ${failed_where:-a line its shell did not name}, status $status: ${failed_command:-unknown}"
  if [[ "$failed_where" == *", in runtime_stop,"* ]] && [ -n "${stopped_status:-}" ]; then
    printf 'The runtime %s, sent SIG%s, ended with status %s' "$stopped_runtime" "$stop_signal" "$stopped_status"
    if [ "$stopped_status" -gt 128 ]; then printf ', which means it was ended by SIG%s' "$(kill -l $((stopped_status - 128)))"; fi
    printf '\n'
  fi
}

show_what_failed() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    say_what_failed "$status"
  fi
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
      runtime_logs "$container" 2>&1 | tail --lines 200 || true
      echo '::endgroup::'
    done
  fi
  runtime_cleanup
  exit "$status"
}

set -E
trap 'noted_failure "$BASH_COMMAND" "$LINENO"' ERR
trap show_what_failed EXIT
