#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
show_logs_on_failure reasoning
issued="$(docker run --rm "$image" node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
docker run --detach --name reasoning --publish "$port:5555" --env DO_NOT_TRACK=1 --env API_KEYS "$image"
for attempt in $(seq 1 30); do
  curl --silent --fail http://127.0.0.1:$port/health > /dev/null && break
  sleep 1
done
call() {
  answered "$1" --header "authorization: Bearer $key" --header 'content-type: application/json' "${@:2}"
}
playbook=http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke
source="$(printf '%s\n' '---' 'model: anthropic/claude-sonnet-4-5' '---' 'Say hello to {{ input.name }}.')"
definition="$(jq --null-input --arg source "$source" '{name: "hello", source: $source, diagram: "none"}')"
test "$(call playbook.json --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
test "$(call created.json --data "$definition" "$playbook/definitions/reasoning")" = 201
test "$(call read.json "$playbook/definitions/reasoning/hello")" = 200
test "$(jq --raw-output .source read.json)" = "$source"
test "$(call ran.json --data '{"input":{"name":"CI"}}' "$playbook/definitions/reasoning/hello/run")" = 503
test "$(jq --raw-output .reason ran.json)" = unavailable
test "$(jq --raw-output .detail ran.json)" = \
  'anthropic is not configured. No model provider is configured'
docker stop reasoning
test "$(docker inspect reasoning --format '{{.State.ExitCode}}')" = 0
