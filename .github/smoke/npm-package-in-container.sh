#!/bin/sh
set -eu

missing() {
  for tool in "$@"; do
    command -v "$tool" > /dev/null || printf '%s ' "$tool"
  done
}

libraries_node_lacks() {
  for library in "$@"; do
    if ldd "$(command -v node)" 2> /dev/null | grep -qF "$library => not found"; then printf '%s ' "$library"; fi
  done
}

tools_and_libraries_added() {
  if command -v apt-get > /dev/null; then
    packages="$(missing bash curl jq)$(missing pkill | sed 's/pkill/procps/')$(libraries_node_lacks libatomic.so.1 | sed 's/libatomic\.so\.1/libatomic1/')"
    [ -z "$packages" ] || { apt-get update > /dev/null && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends $packages > /dev/null; }
  elif command -v dnf > /dev/null; then
    packages="$(missing bash curl jq)$(missing pkill | sed 's/pkill/procps-ng/')$(libraries_node_lacks libatomic.so.1 | sed 's/libatomic\.so\.1/libatomic/')"
    [ -z "$packages" ] || dnf install --assumeyes $packages > /dev/null
  elif command -v microdnf > /dev/null; then
    packages="$(missing bash curl jq)$(missing pkill | sed 's/pkill/procps-ng/')$(libraries_node_lacks libatomic.so.1 | sed 's/libatomic\.so\.1/libatomic/')"
    [ -z "$packages" ] || microdnf install --assumeyes $packages > /dev/null
  elif command -v apk > /dev/null; then
    apk add --no-cache bash coreutils curl grep jq procps > /dev/null
  else
    echo 'The image has none of apt-get, dnf, microdnf and apk, so the smoke cannot add to it bash, curl, jq, pkill or a library Node needs' >&2
    exit 1
  fi
}

system_and_architecture() {
  printf '%s, %s' "$(. /etc/os-release && echo "$PRETTY_NAME")" "$(uname -m)"
}

if [ "${1:-}" = within ]; then
  port="${2:?the port the packed runtime listens on in the container}"
  command -v node > /dev/null || PATH="/opt/node/bin:$PATH"
  export PATH
  tools_and_libraries_added
  version="$(node --version 2>&1)" || {
    printf 'Node from %s does not start on %s, so the packed runtime cannot be tried there: %s\n' \
      "$(command -v node)" "$(system_and_architecture)" "$version" >&2
    exit 1
  }
  printf 'The packed runtime starts on %s, with Node %s from %s\n' "$(system_and_architecture)" "$version" "$(command -v node)"
  mkdir -p /smoke/work
  cd /smoke/work
  RUNNER_TEMP=/smoke exec bash /repository/.github/smoke/npm-package.sh /repository "$port"
fi

repository="${1:?the repository the package was packed in}"
port="${2:?the port the packed runtime listens on in the container}"
image="${3:?the image of the system to start it on, pinned by its digest}"
node_home="$(dirname "$(dirname "$(command -v node)")")"
exec docker run --rm --init --label "onauto.smoke=${SMOKE_PREFIX:-}" \
  --volume "$repository:/repository:ro" --volume "$node_home:/opt/node:ro" \
  "$image" sh /repository/.github/smoke/npm-package-in-container.sh within "$port"
