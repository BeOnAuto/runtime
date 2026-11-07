#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
container="$(smoke_name ledger)"
postgresql="$(smoke_name postgresql)"
network="$(smoke_name ledger)"
show_logs_on_failure "$container" "$postgresql"
issued="$(runtime_command node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p')]"
password=ledger-smoke

SECRETS_KEY="$(openssl rand -base64 32)"
echo "::add-mask::$SECRETS_KEY"
export API_KEYS DATABASE_URL SECRETS_KEY

kid="$(printf '%s' "$SECRETS_KEY" | base64 --decode | sha256sum | cut --characters=1-16)"
secrets_line="\"message\":\"Secrets are kept in the ledger's database, sealed under the key $kid that SECRETS_KEY holds, and 0 sealed under the previous key"
postgres_options=()
if [ "$smoke_backend" = docker ]; then
  docker network create --label "onauto.smoke=${SMOKE_PREFIX:-}" "$network"
  runtime_network=$network
  postgres_options+=(--network-alias postgresql --network "$network")
else
  postgres_options+=(--publish 127.0.0.1::5432)
fi
docker run --label "onauto.smoke=${SMOKE_PREFIX:-}" --detach --name "$postgresql" "${postgres_options[@]}" --tmpfs /var/lib/postgresql:rw,size=512m --env POSTGRES_PASSWORD="$password" \
  postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
for attempt in $(seq 1 30); do
  docker exec "$postgresql" pg_isready --host 127.0.0.1 --username postgres --quiet && break
  sleep 1
done
database_host=postgresql:5432
if [ "$smoke_backend" = node ]; then database_host="$(docker port "$postgresql" 5432/tcp)"; fi
DATABASE_URL="postgresql://postgres:$password@$database_host/postgres"
ledger_line="\"message\":\"The ledger is kept in PostgreSQL, in the database postgres on $database_host\""
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
runtime_start "$container" "" DO_NOT_TRACK=1 API_KEYS DATABASE_URL SECRETS_KEY
wait_for_health
test "$(answered created.json --max-time 10 \
  --header "authorization: Bearer $key" --header 'content-type: application/json' \
  --data '{"playbook":"smoke","name":"Smoke test"}' http://127.0.0.1:$port/v1/orgs/demo/playbooks)" = 201
read_playbook before-restart.json
test "$(jq --compact-output 'del(.studio)' created.json)" = "$(jq --compact-output . before-restart.json)"
runtime_stop "$container"
if [ "$smoke_backend" = docker ]; then
  docker start "$container"
else
  runtime_start "$container" "" DO_NOT_TRACK=1 API_KEYS DATABASE_URL SECRETS_KEY
fi
wait_for_health
read_playbook after-restart.json
cmp before-restart.json after-restart.json
runtime_stop "$container"
test "$(runtime_logs "$container" 2>&1 | grep --count --fixed-strings "$ledger_line")" = 2
test "$(runtime_logs "$container" 2>&1 | grep --count --fixed-strings "$password")" = 0
test "$(runtime_logs "$container" 2>&1 | grep --count --fixed-strings "$secrets_line")" = 2
test "$(runtime_logs "$container" 2>&1 | grep --count --fixed-strings "$SECRETS_KEY")" = 0
docker stop "$postgresql"
