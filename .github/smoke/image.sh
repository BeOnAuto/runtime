#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
show_logs_on_failure smoke
test "$(docker run --rm "$image" 2>&1 | grep --count '^Auto Runtime could not start: ReachableWithoutCredentialsError: ')" = 1
docker run --detach --name smoke --publish "$port:5555" --env DO_NOT_TRACK=1 --env 'API_KEYS=[]' "$image"
for attempt in $(seq 1 30); do
  curl --silent --fail http://127.0.0.1:$port/health && break
  sleep 1
done
test "$(curl --silent --fail http://127.0.0.1:$port/health)" = '{"status":"ok"}'
test "$(docker exec smoke id -un)" = node
test "$(answered refused.json http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 401
test "$(curl --silent --include http://127.0.0.1:$port/v1/orgs/demo/playbooks | grep --ignore-case --count '^www-authenticate: Bearer')" = 1
test "$(docker run --rm "$image" node packages/identity/src/key-command.ts --org demo | grep --count --extended-regexp '^API key, shown only this once: abk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$')" = 1
docker stop smoke
test "$(docker inspect smoke --format '{{.State.ExitCode}}')" = 0
