#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
show_logs_on_failure first second
wait_for_health() {
  for attempt in $(seq 1 30); do
    curl --silent --fail http://127.0.0.1:$port/health > /dev/null && return 0
    sleep 1
  done
  return 1
}
start_server() {
  docker run --detach --name "$1" --publish "$port:5555" --env DO_NOT_TRACK=1 --env API_KEYS --volume playbooks:/data "$image"
  wait_for_health
}
stop_server() {
  docker stop "$1"
  test "$(docker inspect "$1" --format '{{.State.ExitCode}}')" = 0
}
read_playbook() {
  test "$(answered "$1" --header "authorization: Bearer $key" http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke)" = 200
}
issued="$(docker run --rm "$image" node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
docker volume create playbooks
start_server first
test "$(answered created.json \
  --header "authorization: Bearer $key" --header 'content-type: application/json' \
  --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
read_playbook before-restart.json
grep --quiet '"id":"smoke"' before-restart.json
test "$(jq --compact-output 'del(.studio)' created.json)" = "$(jq --compact-output . before-restart.json)"
test "$(jq --raw-output .studio created.json)" = "https://studio.on.auto/?server=http%3A%2F%2F127.0.0.1%3A$port&src=agent&playbook=smoke"
stop_server first
start_server second
read_playbook after-restart.json
cmp before-restart.json after-restart.json
stop_server second
