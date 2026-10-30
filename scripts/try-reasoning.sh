#!/usr/bin/env bash
set -euo pipefail

usage='Usage: scripts/try-reasoning.sh <base-url> <provider/model>'
base_url="${1:?$usage}"
model="${2:?$usage}"
org="${AUTO_RUNTIME_ORG:-local}"
playbook="try-$(date +%s)"
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

playbooks="$base_url/v1/orgs/$org/playbooks"
call --data "{\"playbook\": \"$playbook\", \"name\": \"Trying reasoning functions\"}" "$playbooks" > /dev/null
source="$(printf '%s\n' '---' "model: $model" 'config: {max_output_tokens: 200}' '---' \
  '{% system %}Answer in one sentence.{% endsystem %}Greet {{ input.name }} and name today, {{ today }}.')"
call --data "$(jq --null-input --arg source "$source" '{name: "greeting", source: $source}')" \
  "$playbooks/$playbook/definitions/reasoning" > /dev/null
run="$(call --data '{"input": {"name": "Ada"}}' "$playbooks/$playbook/definitions/reasoning/greeting/run")"
call "$playbooks/$playbook/runs/$(jq --raw-output .run_id <<< "$run")" | jq .
