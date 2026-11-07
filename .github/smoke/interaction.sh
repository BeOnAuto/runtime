#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
container="$(smoke_name interaction)"
show_logs_on_failure "$container"
issued="$(runtime_command node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
runtime_start "$container" "" DO_NOT_TRACK=1 API_KEYS
for attempt in $(seq 1 30); do
  curl --silent --fail --max-time 5 http://127.0.0.1:$port/health > /dev/null && break
  sleep 1
done
call() {
  answered "$1" --max-time 30 \
    --header "authorization: Bearer $key" --header 'content-type: application/json' "${@:2}"
}
playbook=http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke
source="$(printf '%s\n' '---' "to: '{{ input.owner }}'" 'expires: P1D' 'deliver: agent' 'output:' \
  '  schema: {type: object, required: [choice], properties: {choice: {type: string, enum: [approve, reject]}}}' \
  '---' 'Approve the brief for {{ input.campaign }}?')"
definition="$(jq --null-input --arg source "$source" '{name: "approve-brief", source: $source, diagram: "none"}')"
test "$(call playbook.json --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
test "$(call created.json --data "$definition" "$playbook/definitions/interaction")" = 201
test "$(call asked.json --data '{"input":{"owner":"ada","campaign":"Spring"}}' \
  "$playbook/definitions/interaction/approve-brief/run")" = 200
test "$(jq --raw-output .status asked.json)" = started
asked="$(jq --raw-output .run_id asked.json)"
test "$(call open.json "$playbook/interactions?to=ada")" = 200
test "$(jq --compact-output '[.interactions[] | [.run_id, .message]]' open.json)" = \
  "[[\"$asked\",\"Approve the brief for Spring?\"]]"
test "$(call answered.json --data '{"answer":{"choice":"approve"}}' "$playbook/runs/$asked/answer")" = 200
for attempt in $(seq 1 20); do
  test "$(call run.json "$playbook/runs/$asked")" = 200
  test "$(jq --raw-output .status run.json)" != started && break
  sleep 0.5
done
test "$(jq --compact-output '[.status, .output]' run.json)" = '["succeeded",{"choice":"approve"}]'
test "$(call again.json --data '{"answer":{"choice":"reject"}}' "$playbook/runs/$asked/answer")" = 409
runtime_stop "$container"
