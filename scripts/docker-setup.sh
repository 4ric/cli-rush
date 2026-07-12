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
docker compose --profile setup run --rm init-storage

if [ -f secrets/password_hash ] || [ -f secrets/session_secret ]; then
  if [ ! -f secrets/password_hash ] || [ ! -f secrets/session_secret ]; then
    echo "Only one required secret exists. Move the incomplete secrets directory aside and run setup again." >&2
    exit 1
  fi
  echo "Existing login secrets preserved."
else
  docker compose --profile setup run --rm init-secrets
fi

echo "Setup complete. Review .env, then run: docker compose up -d --build"
