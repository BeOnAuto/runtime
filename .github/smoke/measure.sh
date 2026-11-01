#!/usr/bin/env bash
set -e
image="${1:?the image to measure}"
architecture="${2:?the architecture the image was built for}"
size="$(docker image inspect "$image" --format '{{.Size}}')"
{
  echo "### The image on linux/$architecture"
  echo "| Part | MiB |"
  echo "| --- | --- |"
  echo "| The whole image | $((size / 1048576)) |"
} >> "$GITHUB_STEP_SUMMARY"
