#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
show_logs_on_failure ledger postgresql
issued="$(docker run --rm "$image" node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
password=ledger-smoke
DATABASE_URL="postgresql://postgres:$password@postgresql:5432/postgres"
SECRETS_KEY="$(openssl rand -base64 32)"
echo "::add-mask::$SECRETS_KEY"
export API_KEYS DATABASE_URL SECRETS_KEY
ledger_line='"message":"The ledger is kept in PostgreSQL, in the database postgres on postgresql:5432"'
kid="$(printf '%s' "$SECRETS_KEY" | base64 --decode | sha256sum | cut --characters=1-16)"
secrets_line="\"message\":\"Secrets are kept in the ledger's database, sealed under the key $kid that SECRETS_KEY holds, and 0 sealed under the previous key"
docker network create ledger
docker run --detach --name postgresql --network ledger --env POSTGRES_PASSWORD="$password" \
  postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
for attempt in $(seq 1 30); do
  docker exec postgresql pg_isready --host 127.0.0.1 --username postgres --quiet && break
  sleep 1
done
wait_for_health() {
  for attempt in $(seq 1 30); do
    curl --silent --fail --max-time 5 http://127.0.0.1:$port/health > /dev/null && return 0
    sleep 1
  done
  return 1
}
read_playbook() {
  test "$(answered "$1" --max-time 10 --header "authorization: Bearer $key" \
    http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke)" = 200
}
docker run --detach --name ledger --network ledger --publish "$port:5555" --env DO_NOT_TRACK=1 --env API_KEYS --env DATABASE_URL \
  --env SECRETS_KEY "$image"
wait_for_health
test "$(answered created.json --max-time 10 \
  --header "authorization: Bearer $key" --header 'content-type: application/json' \
  --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
read_playbook before-restart.json
test "$(jq --compact-output 'del(.studio)' created.json)" = "$(jq --compact-output . before-restart.json)"
docker stop ledger
test "$(docker inspect ledger --format '{{.State.ExitCode}}')" = 0
docker start ledger
wait_for_health
read_playbook after-restart.json
cmp before-restart.json after-restart.json
docker stop ledger
test "$(docker inspect ledger --format '{{.State.ExitCode}}')" = 0
test "$(docker logs ledger 2>&1 | grep --count --fixed-strings "$ledger_line")" = 2
test "$(docker logs ledger 2>&1 | grep --count --fixed-strings "$password")" = 0
test "$(docker logs ledger 2>&1 | grep --count --fixed-strings "$secrets_line")" = 2
test "$(docker logs ledger 2>&1 | grep --count --fixed-strings "$SECRETS_KEY")" = 0
docker stop postgresql
