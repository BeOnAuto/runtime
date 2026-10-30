#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

for summary in .turbo/runs/*.json; do
  jq '.globalCacheInputs | del(.rootKey)' "$summary"
  jq --raw-output '.tasks[] | [.taskId, .cache.status, (.cache.source // "-"), .hash,
    ((.execution // {}) | ((.endTime // 0) - (.startTime // 0)) / 100 | floor / 10 | tostring) + " s"] | @tsv' \
    "$summary"
done
