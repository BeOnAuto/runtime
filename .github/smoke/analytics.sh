#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
volume="$(smoke_name workflows)"
container="$(smoke_name analytics)"
show_logs_on_failure "$container"
issued="$(runtime_command node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
runtime_start "$container" "$volume" DO_NOT_TRACK=1 API_KEYS
for attempt in $(seq 1 30); do
  curl --silent --fail --max-time 5 http://127.0.0.1:$port/health > /dev/null && break
  sleep 1
done
call() {
  answered "$1" --max-time 30 \
    --header "authorization: Bearer $key" --header 'content-type: application/json' "${@:2}"
}
playbook=http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke
source="$(printf '%s\n' '---' 'model: anthropic/claude-sonnet-4-5' '---' 'Say hello to {{ input.name }}.')"
definition="$(jq --null-input --arg source "$source" '{name: "hello", source: $source, diagram: "none"}')"
test "$(call created.json --data "$definition" "$playbook/definitions/reasoning")" = 201
test "$(call ran.json --data '{"input":{"name":"CI"}}' "$playbook/definitions/reasoning/hello/run")" = 503
test "$(call analytics.json "$playbook/analytics")" = 200
test "$(jq --compact-output '[.days, .runs.succeeded, .runs.rejected, .by_day[-1].day, .by_day[-1].runs.total]' \
  analytics.json)" = "[7,2,1,\"$(date --utc +%F)\",3]"
test "$(jq --compact-output '[.by_function[] | [.type, .name, .runs]]' analytics.json)" = \
  '[["reasoning","hello",1],["workflow","approval",1],["workflow","greet",1]]'
runtime_stop "$container"
