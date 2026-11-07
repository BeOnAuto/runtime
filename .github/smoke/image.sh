#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
container="$(smoke_name smoke)"
show_logs_on_failure "$container"
test "$(runtime_command 2>&1 | grep --count '^Auto Runtime could not start: ReachableWithoutCredentialsError: ')" = 1
runtime_start "$container" "" DO_NOT_TRACK=1 'API_KEYS=[]'
for attempt in $(seq 1 30); do
  curl --silent --fail http://127.0.0.1:$port/health && break
  sleep 1
done
test "$(curl --silent --fail http://127.0.0.1:$port/health)" = '{"status":"ok"}'
if [ "$smoke_backend" = docker ]; then test "$(docker exec "$container" id -un)" = node; fi
test "$(answered refused.json http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 401
test "$(curl --silent --include http://127.0.0.1:$port/v1/orgs/demo/playbooks | grep --ignore-case --count '^www-authenticate: Bearer')" = 1
test "$(runtime_command node packages/identity/src/key-command.ts --org demo | grep --count --extended-regexp '^API key, shown only this once: abk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$')" = 1
runtime_stop "$container"
