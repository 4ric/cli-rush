# CLI RUSH Docker deployment

Use a Git checkout or the release archive at:

```text
/data/containers/cli-rush
```

The Compose project binds the application to `127.0.0.1:3080` by default and stores custom commands in `./data`. Browser learning progress remains in that browser's local storage.

## Install from Git

For a public repository, or after configuring GitHub credentials for a private repository:

```bash
mkdir -p /data/containers
cd /data/containers
git clone https://github.com/4ric/cli-rush.git
cd cli-rush
sh scripts/docker-setup.sh
```

If the directory already exists as a checkout, use the update procedure below instead of cloning over it.

## Install from an archive

```bash
mkdir -p /data/containers
cd /data/containers
tar -xzf cli-rush-docker-<commit>.tar.gz
cd cli-rush
sh scripts/docker-setup.sh
```

The setup script creates the login secrets, then applies the host-side ownership required by the non-root application container. Run it as `root`, or from an account with `sudo`; changing ownership from a helper container is not reliable on every bind-mounted filesystem.

Edit `.env` before starting the service:

```dotenv
CLI_RUSH_USERNAME=admin
CLI_RUSH_BIND_ADDRESS=127.0.0.1
CLI_RUSH_PUBLIC_ORIGIN=https://cli-rush.example.com
CLI_RUSH_LOCAL_ORIGIN=
CLI_RUSH_TRUST_PROXY_PEERS=
CLI_RUSH_MAX_PASSWORD_CHECKS=4
```

`CLI_RUSH_PUBLIC_ORIGIN` must exactly match the final HTTPS origin, including a non-standard port when one is present. Do not add a trailing slash.

Keep `CLI_RUSH_BIND_ADDRESS=127.0.0.1` when Nginx runs on the Docker host. To permit direct access from a private LAN while configuring the proxy, replace `<server-lan-address>` below with the Docker host's address and use the matching HTTP URL.

To support both direct private-LAN access and the HTTPS hostname, set both origins explicitly:

```dotenv
CLI_RUSH_BIND_ADDRESS=<server-lan-address>
CLI_RUSH_PUBLIC_ORIGIN=https://cli-rush.example.com
CLI_RUSH_LOCAL_ORIGIN=http://<server-lan-address>:3080
CLI_RUSH_TRUST_PROXY_PEERS=
```

The two addresses receive separate, cryptographically audience-bound `SameSite=Strict`, `HttpOnly` sessions. The HTTPS session remains `Secure`; the HTTP session is accepted only from the exact configured local origin, and a token cannot be relabelled for the other boundary. Do not configure an Internet-facing HTTP origin.

Forwarded client addresses are ignored for login throttling unless the immediate proxy peer is explicitly listed in `CLI_RUSH_TRUST_PROXY_PEERS`. When the proxy has a stable private address, list only that exact address (or a comma-separated set of exact addresses). Do not enter client networks or use a catch-all value. The gateway accepts only a valid IP from the proxy-appended, right-most `X-Forwarded-For` position; configure Nginx to overwrite or append that header. The configured public and local hostnames continue to select the correct cookie security without trusting a forwarded protocol header.

`CLI_RUSH_MAX_PASSWORD_CHECKS` bounds concurrent scrypt work across all sources; the default is `4` and accepted values are clamped to `1`–`32`. Source attempts are reserved immediately before hashing so concurrent requests cannot bypass the five-attempt window. Keep an outer Nginx rate limit as an additional availability control.

Build and start:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 cli-rush
```

Wait for `cli-rush` to report `healthy`, then proxy the final HTTPS hostname to `http://127.0.0.1:3080`. An Nginx example is available at `deploy/nginx.conf.example`. Replace every occurrence of `cli-rush.example.com` with the exact hostname from `CLI_RUSH_PUBLIC_ORIGIN`; the fixed upstream `Host` value and mismatch rejection are security boundaries, not optional cosmetic settings.

If the reverse proxy is itself a container, do not publish port 3080 to the LAN. Attach both services to a private Docker network or route the proxy to the host loopback through a supported host-gateway arrangement.

## Updates

When the deployment directory is a Git checkout, preserve the host-only files and fast-forward from `main`:

```bash
cd /data/containers/cli-rush
cp .env /tmp/cli-rush.env.backup
git status --short
git fetch origin
git pull --ff-only origin main
docker compose config --quiet
docker compose up -d --build --remove-orphans
```

If `git pull` reports a local change to `compose.yaml` or another tracked file, do not overwrite it blindly. Move the local change into `.env`, back it up, restore the tracked file with `git restore <file>`, and repeat the fast-forward. `.env`, `secrets/` and `data/` are intentionally ignored and survive the update.

For an archive deployment, back up `.env`, `secrets/` and `data/`, replace the other files with the new release, then run:

```bash
docker compose up -d --build --remove-orphans
```

For either update method, wait for the new container and verify it before pruning old images:

```bash
until [ "$(docker inspect -f '{{.State.Health.Status}}' cli-rush)" = "healthy" ]; do
  docker compose ps
  sleep 2
done
curl --fail --show-error http://127.0.0.1:3080/healthz
docker compose logs --tail=100 cli-rush
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

Custom command data is validated before every API response. Its existing v1 JSON-array format is deliberately retained for rollback compatibility; the API reports the schema version and an ETag so newer clients can reject stale conditional writes. Back up `data/` before an update; the file is permission-restricted but is not encrypted at rest.

## Sensitive reference material

Production or production-derived router and switch configurations must remain outside this project directory. The Docker build context and Git ignores defensively exclude the named reference files used during private analysis, but those exclusions are not a substitute for keeping originals in a separate protected location. Run `npm run scan:sensitive` after the production build to inspect tracked source and generated text artefacts without printing matched values.

The configuration references requested for the current learning-content revision were not available in this workspace. No release note or catalogue entry should claim that they were inspected until a separate, sanitised review is completed.

## Remove

```bash
docker compose down
```

This leaves `data/` and `secrets/` intact. Delete them only when you intentionally want to destroy persisted custom commands and credentials.
