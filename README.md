# CLI RUSH: Network Command Arena

A local-first Cisco-style command recall game. The current pack contains **214 mode-specific objectives**, **203 distinct canonical command strings**, **9 CLI modes** and **25 topics**.

The pack is a curated CCNA-oriented IOS/IOS XE practice set, not every command in IOS XE. IOS XE has thousands of platform-, release-, licence- and feature-specific commands. The content is marked **simulator-tested draft** until it is checked against named IOS/IOS XE lab images by a networking subject-matter expert.

This is an independent educational simulator. It is not affiliated with or endorsed by Cisco.

## Current behaviour

- Four game modes: Easy, Normal, Hard and Hardcore.
- Responsive layouts for full-screen, windowed, tablet, portrait-mobile and short landscape play.
- Untimed Easy practice with staged strategies, command shapes and voluntary reveals.
- Easy attempts earn learning points but never advance mastery; a full reveal earns zero points.
- IOS-style `Tab` completion expands only unique prefixes in the current CLI mode.
- Inline `?` help lists deterministic next-token options without submitting the command or directly changing score or time.
- A correct CLI-assisted answer keeps its normal score and time reward but cannot advance mastery.
- Physical `Tab` and `?` keep focus and the caret at the end of the simulated command line; equivalent touch controls remain available.
- PuTTY-style clipboard flow: selecting terminal output copies it, Ctrl+V pastes, and right-click pastes directly when browser clipboard permission is available.
- Every run uses a weighted random queue that cannot repeat the previous opening command string.
- IPv4 receives the strongest protocol weighting; IPv6 remains in lower-frequency rotation.
- Correct, assisted and fully revealed commands receive progressively higher revisit weight.
- Normal starts with sixty seconds, adds three seconds for a correct command or five seconds from a three-answer clean streak, and removes one, three then five seconds across consecutive errors.
- Hard starts with sixty seconds, always adds three seconds for a correct command, and removes five, ten then fifteen seconds across consecutive errors.
- Hardcore starts with sixty seconds, adds two seconds for a correct command and ends immediately after one incorrect submission.
- A correct answer resets the consecutive-error penalty tier.
- User EXEC, Privileged EXEC, Global, Interface, Router, Line, VLAN, named ACL and DHCP-pool modes.
- Deterministic local validation. Player input is never executed.
- Specific error feedback during the round.
- Explanation and practical use-case feedback after both correct and incorrect submissions; timed mistakes do not leak hidden canonical text.
- Wrong answers move on without revealing the correct command.
- A later retry earns reduced score and does not advance mastery.
- An objective left unanswered when time expires is added to the missed review.
- Correct commands and explanations for missed items appear only after the timer reaches zero.
- Combination scoring and capped speed bonuses.
- Local progress and spaced-review scheduling.
- Custom question, answer and explanation management.
- Docker persistence for custom commands under `/data`.
- One configured login account with no registration route.

## Architecture

```text
app/page.tsx                 Responsive game, report and custom-command UI
lib/engine.ts                Parser, CLI modes and simulator
lib/expanded-catalogue.ts    Curated built-in command pack
lib/cli-assistance.ts        Deterministic Tab completion and question-mark menus
lib/command-queue.ts         Weighted adaptive random command ordering
lib/game-modes.ts            Deterministic game-mode time rules
lib/learning.ts              Deterministic Easy-mode learning aids
lib/scheduler.ts             Review scheduling and score calculation
server/auth-server.mjs       Docker authentication and persistence gateway
scripts/init-secrets.mjs     Interactive password and session-secret setup
tests/engine/                Command, scheduler and reveal-policy tests
```

The Docker gateway uses:

- A scrypt password hash; the plaintext password is never stored.
- A single username configured at runtime.
- Signed, `HttpOnly`, `SameSite=Strict` session cookies.
- The `__Host-` cookie prefix when HTTPS mode is enabled.
- Five failed logins per IP within fifteen minutes before lockout.
- Exact origin checks for login, logout and custom-command writes.
- Security headers and a read-only container filesystem.
- Docker secret files instead of secrets in Compose or Git.

## Local development

```bash
npm ci
npm run dev
```

Validation:

```bash
npm run lint
npm test
```

## Docker deployment

The requested deployment directory is written exactly as supplied:

```text
/data/contrainers/cli-rush
```

If `contrainers` was a typo, change both the directory and the volume path in `compose.yaml` before deploying.

### 1. Clone and enter the repository

```bash
mkdir -p /data/contrainers
cd /data/contrainers
git clone <repository-url> cli-rush
cd cli-rush
```

### 2. Configure the public address

```bash
cp .env.example .env
```

Edit `.env` and set the final HTTPS address used through Nginx:

```dotenv
CLI_RUSH_USERNAME=ignas
CLI_RUSH_PUBLIC_ORIGIN=https://cli-rush.example.com
```

### 3. Create the login secrets

Run this from an interactive terminal. The password is not placed in shell history. If Node.js 24 is installed on the host:

```bash
node scripts/init-secrets.mjs
```

Or use Docker itself, without installing Node.js on the host:

```bash
docker run --rm -it -v "$PWD:/app" -w /app node:24-alpine node scripts/init-secrets.mjs
```

The generated `secrets/` directory is ignored by Git. Back it up securely. Rotating `session_secret` signs every existing session out.

### 4. Build and start

```bash
docker compose up -d --build
docker compose ps
```

The application listens only on `127.0.0.1:3080`. It is not directly exposed to the network.

### 5. Configure Nginx

Use `deploy/nginx.conf.example` as the starting point. Replace the hostname and add the existing TLS certificate directives. The important controls are:

- HTTPS only.
- Proxy to `http://127.0.0.1:3080`.
- Overwrite forwarded IP and scheme headers.
- Do not expose port 3080 through the firewall.
- Rate-limit `/login`.

After Nginx is active, open the configured HTTPS URL and sign in with the single configured username and password.

## Persistent data

`compose.yaml` mounts:

```text
/data/contrainers/cli-rush/data -> /data
```

Custom command content survives container rebuilds. Learning progress remains local to the browser, preserving the original local-first model.

## Custom commands

Use **Manage commands** from the application header. Each custom entry contains:

- Question or operational objective
- Correct command
- Explanation or memory note, shown after successful Easy recall or when a timed round reaches zero
- CLI mode
- Verification, configuration or navigation type
- Topic and difficulty

Custom entries are data only. They cannot contain JavaScript, regular expressions, shell actions or simulator functions.

## Known limitations

- The expanded pack prioritises CCNA-level recall. It is not a complete command reference.
- Most expanded commands are deterministic recall items rather than full stateful emulation.
- Platform differences still need formal lab-image review and content metadata.
- Local learning progress is not yet synchronised through the Docker volume.
- Login rate limits reset when the container restarts; Nginx provides a second rate-limit layer.
