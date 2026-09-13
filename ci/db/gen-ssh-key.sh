#!/usr/bin/env bash
# Generate the throwaway keypair the SSH tunnel smoke test uses.
#
# Generated rather than committed: a private key in the repository is a private
# key in the repository, whatever the comment next to it says. It is also
# pointless here -- the key only ever authenticates to a container that exists
# for the length of a test run.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dir="$root/ci/ssh"
key="$dir/id_ed25519"

mkdir -p "$dir"
if [ -f "$key" ]; then
  echo "reusing existing key at $key"
  exit 0
fi

ssh-keygen -t ed25519 -N '' -C 'db-smoke-bastion' -f "$key" >/dev/null
chmod 600 "$key"
echo "generated $key"
