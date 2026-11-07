#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
container="$(smoke_name reactions)"
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
ended_runs() {
  for attempt in $(seq 1 "$3"); do
    test "$(call runs.json "$playbook/runs?type=workflow&name=$1")" = 200
    jq --exit-status --argjson count "$2" '[.runs[] | select(.status != "started")] | length >= $count' \
      runs.json > /dev/null && return 0
    sleep 1
  done
  return 1
}
closing="$(printf '%s\n' "document: { dsl: '1.0.3', namespace: smoke, name: closing, version: '1.0.0' }" \
  'schedule: { on: { one: { with: { type: com.example.ledger.closed } } }, every: PT1M }' 'do:' \
  "  - total: { set: { input: '\${ \$data }' } }")"
test "$(call playbook.json --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
definition="$(jq --null-input --arg source "$closing" '{name: "closing", source: $source}')"
test "$(call created.json --data "$definition" "$playbook/definitions/workflow")" = 201
test "$(jq --compact-output '[.triggers[] | [.kind, .reference]]' created.json)" = \
  '[["event","/schedule/on"],["every","/schedule/every"]]'
test "$(call published.json \
  --data '{"event":{"source":"/ledger","type":"com.example.ledger.closed","data":{"month":"september"}}}' \
  "$playbook/events")" = 200
ended_runs closing 2 150
test "$(jq --compact-output '[.runs[] | [.status, .started_by]]' runs.json)" = \
  '[["succeeded",{"id":"playbook:smoke","name":"smoke"}],["succeeded",{"id":"playbook:smoke","name":"smoke"}]]'
for run in $(jq --raw-output '.runs[].run_id' runs.json); do
  test "$(call "history-$run.json" "$playbook/runs/$run/history")" = 200
  test "$(call "run-$run.json" "$playbook/runs/$run")" = 200
  case "$(jq --raw-output '.events[0].metadata.trigger.kind' "history-$run.json")" in
    event) test "$(jq --raw-output '.output.input[0].data.month' "run-$run.json")" = september ;;
    every) jq --exit-status '.output.input.schedule.due | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T")' \
      "run-$run.json" > /dev/null ;;
  esac
done
test "$(jq --slurp --compact-output 'map(.events[0] | [.metadata.trigger.kind, .summary]) | sort' history-*.json)" = \
  '[["event","A run of the workflow “closing” was started by its event trigger."],["every","A run of the workflow “closing” was started by its every schedule."]]'
runtime_stop "$container"
