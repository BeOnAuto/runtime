#!/usr/bin/env bash
set -euo pipefail

usage='Usage: scripts/try-workflows.sh <base-url> <provider/model>'
base_url="${1:?$usage}"
model="${2:?$usage}"
org="${AUTO_RUNTIME_ORG:-local}"
playbook="try-$(date +%s)-$RANDOM$RANDOM"
headers=(--header 'content-type: application/json')
if [ -n "${AUTO_RUNTIME_KEY:-}" ]; then
  headers+=(--header "authorization: Bearer $AUTO_RUNTIME_KEY")
fi

call() {
  local response
  if ! response="$(curl --silent --show-error --fail-with-body "${headers[@]}" "$@")"; then
    printf '%s\n' "$response" >&2
    return 1
  fi
  printf '%s\n' "$response"
}

settled() {
  local run
  for _ in $(seq 1 60); do
    run="$(call "$playbooks/$playbook/runs/$1")"
    if [ "$(jq --raw-output .status <<< "$run")" != started ]; then
      printf '%s\n' "$run"
      return 0
    fi
    sleep 1
  done
  printf 'The run %s was still started after a minute\n' "$1" >&2
  return 1
}

playbooks="$base_url/v1/orgs/$org/playbooks"
call --data "{\"playbook\": \"$playbook\", \"name\": \"Trying workflows\"}" "$playbooks" > /dev/null
greeting="$(printf '%s\n' '---' "model: $model" 'config: {max_output_tokens: 200}' '---' \
  '{% system %}Answer in one sentence.{% endsystem %}Greet {{ input.name }} and name today, {{ today }}.')"
call --data "$(jq --null-input --arg source "$greeting" '{name: "greeting", source: $source}')" \
  "$playbooks/$playbook/definitions/reasoning" > /dev/null
welcome="$(cat << 'YAML'
document:
  dsl: '1.0.3'
  namespace: demo
  name: welcome
  version: '1.0.0'
  summary: Greets a customer, then waits for their reply.
do:
  - greet:
      call: run_definition
      with:
        type: reasoning
        name: greeting
        input:
          name: ${ $data.name }
      output:
        as: '${ ({ greeting: $data }) }'
  - await:
      listen:
        to:
          one:
            with: { type: com.example.customer.replied }
      output:
        as: '${ ({ ...$input, reply: $data[0] }) }'
YAML
)"
call --data "$(jq --null-input --arg source "$welcome" '{name: "welcome", source: $source}')" \
  "$playbooks/$playbook/definitions/workflow" > /dev/null
started="$(call --data '{"input": {"name": "Ada"}}' "$playbooks/$playbook/definitions/workflow/welcome/run")"
run_id="$(jq --raw-output .run_id <<< "$started")"
if ! call --data '{"event": {"type": "com.example.customer.replied", "data": "Thank you!"}}' \
  "$playbooks/$playbook/runs/$run_id/events" > /dev/null; then
  printf 'The workflow ended before it could take the reply; it ended so:\n' >&2
fi
run="$(settled "$run_id")"
jq . <<< "$run"
test "$(jq --raw-output .status <<< "$run")" = succeeded
