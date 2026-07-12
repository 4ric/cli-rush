# CLI RUSH Docker deployment

The release archive extracts to `cli-rush/`. Place that directory at:

```text
/data/containers/cli-rush
```

The Compose project binds the application only to `127.0.0.1:3080` and stores custom commands in `./data`. Browser learning progress remains in that browser's local storage.

## Install

```bash
mkdir -p /data/containers
cd /data/containers
tar -xzf cli-rush-docker-<commit>.tar.gz
cd cli-rush
sh scripts/docker-setup.sh
```

Edit `.env` before starting the service:

```dotenv
CLI_RUSH_USERNAME=ignas
CLI_RUSH_BIND_ADDRESS=127.0.0.1
CLI_RUSH_PUBLIC_ORIGIN=https://cli-rush.example.com
```

`CLI_RUSH_PUBLIC_ORIGIN` must exactly match the final HTTPS origin, including a non-standard port when one is present. Do not add a trailing slash.

Keep `CLI_RUSH_BIND_ADDRESS=127.0.0.1` when Nginx runs on the Docker host. To permit direct access from a private LAN while configuring the proxy, set it to the server address, for example `192.168.1.6`, and use `http://192.168.1.6:3080`.

Build and start:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 cli-rush
```

Wait for `cli-rush` to report `healthy`, then proxy the final HTTPS hostname to `http://127.0.0.1:3080`. An Nginx example is available at `deploy/nginx.conf.example`.

If the reverse proxy is itself a container, do not publish port 3080 to the LAN. Attach both services to a private Docker network or route the proxy to the host loopback through a supported host-gateway arrangement.

## Updates

Back up `.env`, `secrets/` and `data/`, replace the other files with the new release, then run:

```bash
docker compose up -d --build --remove-orphans
docker image prune -f
```

Do not overwrite `secrets/` during an update. Replacing `session_secret` signs every browser out; replacing `password_hash` changes the login password.

## Backup and restore

The minimum backup set is:

```text
.env
secrets/password_hash
secrets/session_secret
data/custom-commands.json
```

Stop the service before restoring these files, preserve restrictive permissions on `secrets/`, then start it again and verify the health check.

## Remove

```bash
docker compose down
```

This leaves `data/` and `secrets/` intact. Delete them only when you intentionally want to destroy persisted custom commands and credentials.
