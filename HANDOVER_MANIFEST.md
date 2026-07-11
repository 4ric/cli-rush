# Handover manifest

## Files Codex should read first

1. `AGENTS.md` — repository rules and definition of done.
2. `CODEX_HANDOVER.md` — current product state, architecture and limitations.
3. `README.md` — setup, Docker deployment and operational instructions.
4. `CODEX_START_PROMPT.txt` — ready-to-paste opening prompt.

## Essential application files

- `app/` — application interface and styling.
- `lib/` — command engine, catalogue, gameplay policy and scheduler.
- `server/` — Docker authentication and persistent custom-content API.
- `tests/` — automated engine, scheduling, gameplay, server and render checks.
- `public/` — static assets.

## Build and deployment files

- `package.json` and `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- `next.config.ts`
- `Dockerfile`
- `compose.yaml`
- `.dockerignore`
- `.env.example`
- `deploy/nginx.conf.example`
- `scripts/`
- `.openai/hosting.json`

## Deliberately excluded

- `node_modules/` — recreate with `npm ci`.
- `dist/` — recreate with `npm run build`.
- `.env` — contains environment-specific values.
- `secrets/` — generated locally and must never be shared or committed.
- `.git/` — the handover is source-only; initialise or connect Git separately.

The ZIP contains everything required to install dependencies, run tests, continue development and build the application.
