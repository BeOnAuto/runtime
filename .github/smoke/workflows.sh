#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
show_logs_on_failure workflows-first workflows-second
issued="$(docker run --rm "$image" node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
wait_for_health() {
  for attempt in $(seq 1 30); do
    curl --silent --fail --max-time 5 http://127.0.0.1:$port/health > /dev/null && return 0
    sleep 1
  done
  return 1
}
start_server() {
  docker run --detach --name "$1" --publish "$port:5555" --env DO_NOT_TRACK=1 --env API_KEYS --volume workflows:/data "$image"
  wait_for_health
}
stop_server() {
  docker stop "$1"
  test "$(docker inspect "$1" --format '{{.State.ExitCode}}')" = 0
}
call() {
  answered "$1" --max-time 30 \
    --header "authorization: Bearer $key" --header 'content-type: application/json' "${@:2}"
}
playbook=http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke
settled() {
  for attempt in $(seq 1 30); do
    test "$(call "$1" "$playbook/runs/$2")" = 200
    test "$(jq --raw-output .status "$1")" != started && return 0
    sleep 1
  done
  return 1
}
greet="$(printf '%s\n' "document: { dsl: '1.0.3', namespace: smoke, name: greet, version: '1.0.0' }" 'do:' \
  "  - greet: { set: { greeting: '\${ \"Hello, \" + \$data.name }' } }")"
approval="$(printf '%s\n' "document: { dsl: '1.0.3', namespace: smoke, name: approval, version: '1.0.0' }" 'do:' \
  '  - decide: { listen: { to: { one: { with: { type: com.example.approval.decided } } } } }')"
docker volume create workflows
start_server workflows-first
test "$(docker logs workflows-first 2>&1 | grep --count '"message":"Workflows run in this server: ')" = 1
test "$(call playbook.json --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
for name in greet approval; do
  definition="$(jq --null-input --arg name "$name" --arg source "${!name}" '{name: $name, source: $source}')"
  test "$(call created.json --data "$definition" "$playbook/definitions/workflow")" = 201
done
test "$(call greeting.json --data '{"input":{"name":"CI"}}' "$playbook/definitions/workflow/greet/run")" = 200
settled greeted.json "$(jq --raw-output .run_id greeting.json)"
test "$(jq --compact-output '[.status, .output]' greeted.json)" = '["succeeded",{"greeting":"Hello, CI"}]'
test "$(call waiting.json --data '{}' "$playbook/definitions/workflow/approval/run")" = 200
waiting="$(jq --raw-output .run_id waiting.json)"
stop_server workflows-first
start_server workflows-second
test "$(call sent.json --data '{"event":{"type":"com.example.approval.decided","data":{"approved":true}}}' \
  "$playbook/runs/$waiting/events")" = 200
settled approved.json "$waiting"
test "$(jq --compact-output '[.status, .output]' approved.json)" = '["succeeded",[{"approved":true}]]'
test "$(call history.json "$playbook/runs/$waiting/history")" = 200
jq --exit-status '(.events | INDEX(.id) as $by
  | [.[] | [.type, (if .type == "run_started" then .metadata.definition.name else .data.name // .data.input.kind end),
    $by[.metadata.causation_id // ""].type]] | sort) == [
    ["run_started", "approval", null], ["run_succeeded", null, "workflow_input_applied"],
    ["step_finished", "decide", "workflow_input_applied"], ["step_waiting", "decide", "workflow_input_applied"],
    ["workflow_input_applied", "event_received", "workflow_input_applied"],
    ["workflow_input_applied", "started", "run_started"]]' history.json
stop_server workflows-second
