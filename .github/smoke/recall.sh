#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
show_logs_on_failure recall
issued="$(docker run --rm "$image" node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
docker run --detach --name recall --publish "$port:5555" --env DO_NOT_TRACK=1 --env API_KEYS --volume workflows:/data "$image"
for attempt in $(seq 1 30); do
  curl --silent --fail --max-time 5 http://127.0.0.1:$port/health > /dev/null && break
  sleep 1
done
call() {
  answered "$1" --max-time 30 \
    --header "authorization: Bearer $key" --header 'content-type: application/json' "${@:2}"
}
playbook=http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke
source="$(printf '%s\n' '---' 'language: typescript' 'source:' '  events:' '    - type: run_succeeded' \
  '      subject: workflow/greet' 'view:' '  initial: []' '---' 'export function fold(view: any, event: any): any {' \
  '  return [...view, event.data.output?.greeting ?? "none"];' '}')"
definition="$(jq --null-input --arg source "$source" '{name: "greetings", source: $source, diagram: "none"}')"
test "$(call created.json --data "$definition" "$playbook/definitions/recall")" = 201
for attempt in $(seq 1 30); do
  test "$(call standing.json "$playbook/definitions/recall/greetings")" = 200
  test "$(jq --compact-output '[.standing.state, .standing.folded]' standing.json)" = '["live",1]' && break
  sleep 1
done
test "$(jq --compact-output '[.standing.state, .standing.folded]' standing.json)" = '["live",1]'
test "$(call recalled.json --data '{}' "$playbook/definitions/recall/greetings/run")" = 200
test "$(jq --compact-output '[.status, .output]' recalled.json)" = '["succeeded",["Hello, CI"]]'
test "$(call run.json "$playbook/runs/$(jq --raw-output .run_id recalled.json)")" = 200
test "$(jq --compact-output '[.record.view.version, .record.view.folded]' run.json)" = '[1,1]'
docker stop recall
test "$(docker inspect recall --format '{{.State.ExitCode}}')" = 0
