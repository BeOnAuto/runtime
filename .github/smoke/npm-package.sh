#!/usr/bin/env bash
set -e
repository="${1:?the repository the package was packed in}"
port="${2:?the port the packed runtime listens on}"
tarball="$(ls "$repository"/dist/on.auto-runtime-*.tgz)"
export XDG_CACHE_HOME="$RUNNER_TEMP/cache" LEDGER_FILE="$RUNNER_TEMP/ledger.db" DO_NOT_TRACK=1 PORT="$port"
runtime() {
  npx --yes --package="$tarball" auto-runtime "$@"
}
test "$(runtime --version)" = "$(jq --raw-output .version "$repository/package.json")"
test "$(runtime key --org demo | grep --count --extended-regexp '^API key, shown only this once: abk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$')" = 1
runtime > runtime.log 2>&1 &
started=$!
for attempt in $(seq 1 60); do
  curl --silent --fail http://127.0.0.1:$port/health > /dev/null && break
  sleep 1
done
test "$(curl --silent --fail http://127.0.0.1:$port/health)" = '{"status":"ok"}'
test "$(grep --count 'Ready in' runtime.log)" = 1
call() {
  curl --silent --max-time 30 --output "$1" --write-out '%{http_code}' --header 'content-type: application/json' "${@:2}"
}
playbook=http://127.0.0.1:$port/v1/orgs/local/playbooks/smoke
test "$(call playbook.json --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/local/playbooks)" = 201
total="$(printf '%s\n' '---' 'language: typescript' 'input:' '  schema: {type: object, required: [rows]}' '---' \
  'export default function (input: any): Output {' \
  '  const total_cents = input.rows.reduce((sum: number, row: any) => sum + row.cost_cents, 0);' \
  '  return { total_cents, rows: input.rows.length };' '}')"
test "$(call created.json --data "$(jq --null-input --arg source "$total" '{name: "total", source: $source, diagram: "none"}')" \
  "$playbook/definitions/computation")" = 201
test "$(call totalled.json --data '{"input":{"rows":[{"cost_cents":1050},{"cost_cents":2075}]}}' \
  "$playbook/definitions/computation/total/run")" = 200
test "$(jq --compact-output '[.status, .output]' totalled.json)" = '["succeeded",{"total_cents":3125,"rows":2}]'
greet="$(printf '%s\n' "document: { dsl: '1.0.3', namespace: smoke, name: greet, version: '1.0.0' }" 'do:' \
  "  - greet: { set: { greeting: '\${ \"Hello, \" + \$data.name }' } }")"
test "$(call created.json --data "$(jq --null-input --arg source "$greet" '{name: "greet", source: $source}')" \
  "$playbook/definitions/workflow")" = 201
test "$(call greeting.json --data '{"input":{"name":"npx"}}' "$playbook/definitions/workflow/greet/run")" = 200
run_id="$(jq --raw-output .run_id greeting.json)"
for attempt in $(seq 1 30); do
  test "$(call greeted.json "$playbook/runs/$run_id")" = 200
  test "$(jq --raw-output .status greeted.json)" != started && break
  sleep 1
done
test "$(jq --compact-output '[.status, .output]' greeted.json)" = '["succeeded",{"greeting":"Hello, npx"}]'
pkill -TERM -f "$XDG_CACHE_HOME/auto-runtime/.*/packages/server/auto-runtime.ts"
wait "$started"
cat runtime.log
