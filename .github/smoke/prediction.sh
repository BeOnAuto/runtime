#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
show_logs_on_failure prediction
issued="$(docker run --rm "$image" node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
docker run --detach --name prediction --publish "$port:5555" --env DO_NOT_TRACK=1 --env API_KEYS "$image"
for attempt in $(seq 1 30); do
  curl --silent --fail --max-time 5 http://127.0.0.1:$port/health > /dev/null && break
  sleep 1
done
call() {
  answered "$1" --max-time 30 \
    --header "authorization: Bearer $key" --header 'content-type: application/json' "${@:2}"
}
playbook=http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke
now="$(date --utc +%s)"
day_of() {
  date --utc --date "@$((now - $1 * 86400))" +%F
}
source="$(printf '%s\n' '---' 'predicts:' '  target: visits' '  period: day' '  horizons: [1, 2]' \
  '  unit: visits' 'data:' '  events:' '    - type: visit.made' '  time: event' '  series: /store' \
  '  target: { of: /visits, as: sum }' '  window: 24' '---')"
definition="$(jq --null-input --arg source "$source" '{name: "daily-visits", source: $source, diagram: "none"}')"
test "$(call playbook.json --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
test "$(call created.json --data "$definition" "$playbook/definitions/prediction")" = 201
published=0
for store in north east; do
  days=$([ "$store" = north ] && echo 8 || echo 3)
  for ago in $(seq "$days" -1 1); do
    event="$(jq --null-input --arg store "$store" --argjson visits "$((10 + ago % 3))" \
      --arg time "$(day_of "$ago")T10:00:00Z" \
      '{event: {source: "/stores", type: "visit.made", time: $time, data: {store: $store, visits: $visits}}}')"
    test "$(call published.json --data "$event" "$playbook/events")" = 200
    published=$((published + 1))
  done
done
for attempt in $(seq 1 30); do
  test "$(call function.json "$playbook/definitions/prediction/daily-visits")" = 200
  test "$(jq --raw-output '[.standing.dataset.phase, .standing.dataset.events_folded] | join(" ")' function.json)" = \
    "live $published" && break
  sleep 1
done
test "$(jq --raw-output .standing.dataset.events_folded function.json)" = "$published"
test "$(call question.json --data '{"input":{"series":"north","horizon":1}}' \
  "$playbook/definitions/prediction/daily-visits/run")" = 200
test "$(jq --compact-output '[.status, (.output.lines[] | select(.name == "predicted") | .points[0] | .value, .low, .high), .record.method, .record.coverage, .output_shape]' question.json)" = \
  '["succeeded",11,10,13,"persistence",0.8,"series"]'
test "$(call refused.json --data '{"input":{"series":"east","horizon":1}}' \
  "$playbook/definitions/prediction/daily-visits/run")" = 409
test "$(jq --raw-output '[.reason, .kind, .detail] | join(" | ")' refused.json)" = \
  "conflict | history_too_short | The series \"east\" has 3 periods of history up to $(day_of 1), too few for the forecaster to backtest an answer; ask again from $(day_of -2)"
docker stop prediction
test "$(docker inspect prediction --format '{{.State.ExitCode}}')" = 0
