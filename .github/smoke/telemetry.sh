#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
container="$(smoke_name telemetry)"
show_logs_on_failure "$container"
runtime_start "$container" "" DO_NOT_TRACK=1 'API_KEYS=[]' OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:9
for attempt in $(seq 1 30); do
  curl --silent --fail http://127.0.0.1:$port/health && break
  sleep 1
done
test "$(curl --silent --fail http://127.0.0.1:$port/health)" = '{"status":"ok"}'
test "$(runtime_logs "$container" 2>&1 | grep --count 'Telemetry is on, exported over OTLP')" = 1
runtime_stop "$container"
