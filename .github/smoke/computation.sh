#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
container="$(smoke_name computation)"
show_logs_on_failure "$container"
issued="$(runtime_command node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
runtime_start "$container" "" DO_NOT_TRACK=1 API_KEYS
for attempt in $(seq 1 30); do
  curl --silent --fail http://127.0.0.1:$port/health > /dev/null && break
  sleep 1
done
call() {
  answered "$1" --max-time 30 \
    --header "authorization: Bearer $key" --header 'content-type: application/json' "${@:2}"
}
playbook=http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke
total="$(printf '%s\n' '---' 'language: typescript' 'input:' '  schema: {type: object, required: [rows]}' '---' \
  'export default function (input: any): Output {' \
  '  const total_cents = input.rows.reduce((sum: number, row: any) => sum + row.cost_cents, 0);' \
  '  return { total_cents, rows: input.rows.length };' '}')"
raising="$(printf '%s\n' '---' 'language: typescript' '---' 'export default function (input: Input): Output {' \
  "  throw new Error('no rows');" '}')"
test "$(call playbook.json --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
for name in total raising; do
  definition="$(jq --null-input --arg name "$name" --arg source "${!name}" '{name: $name, source: $source, diagram: "none"}')"
  test "$(call created.json --data "$definition" "$playbook/definitions/computation")" = 201
done
test "$(call totalled.json --data '{"input":{"rows":[{"cost_cents":1050},{"cost_cents":2075}]}}' \
  "$playbook/definitions/computation/total/run")" = 200
test "$(jq --compact-output '[.status, .output]' totalled.json)" = '["succeeded",{"total_cents":3125,"rows":2}]'
test "$(call raised.json --data '{"input":{}}' "$playbook/definitions/computation/raising/run")" = 409
test "$(jq --compact-output '[.reason, .kind, .detail]' raised.json)" = \
  '["conflict","unworkable","The program raised an error on line 5: Error: no rows"]'
runtime_stop "$container"
