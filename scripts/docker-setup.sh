#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
umask 077

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Set CLI_RUSH_PUBLIC_ORIGIN before starting the app."
fi

mkdir -p data secrets

if [ "$(id -u)" -eq 0 ]; then
  run_privileged() {
    "$@"
  }
elif command -v sudo >/dev/null 2>&1; then
  run_privileged() {
    sudo "$@"
  }
else
  echo "Setup must run as root, or sudo must be installed, to set container file ownership." >&2
  exit 1
fi

if [ -f secrets/password_hash ] || [ -f secrets/session_secret ]; then
  if [ ! -f secrets/password_hash ] || [ ! -f secrets/session_secret ]; then
    echo "Only one required secret exists. Move the incomplete secrets directory aside and run setup again." >&2
    exit 1
  fi
  echo "Existing login secrets preserved."
else
  docker compose --profile setup run --rm --user "$(id -u):$(id -g)" init-secrets
fi

run_privileged chown -R 1000:1000 data
run_privileged chmod 0700 data secrets
run_privileged chown 1000:1000 secrets/password_hash secrets/session_secret
run_privileged chmod 0400 secrets/password_hash secrets/session_secret

echo "Setup complete. Review .env, then run: docker compose up -d --build"
