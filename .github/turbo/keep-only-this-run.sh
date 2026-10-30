#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

summaries=(.turbo/runs/*.json)
test "${#summaries[@]}" -gt 0 || exit 0
test -d .turbo/cache || exit 0
hashes="$(mktemp)"
jq --raw-output '.tasks[].hash' "${summaries[@]}" | sort --unique > "$hashes"
for entry in .turbo/cache/*; do
  name="$(basename "$entry")"
  grep --quiet --fixed-strings --line-regexp "${name%%[-.]*}" "$hashes" || rm "$entry"
done
du --summarize --human-readable .turbo/cache
