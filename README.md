# CLI RUSH: Network Command Arena

A local-first Cisco-style command recall game. The current pack contains **214 mode-specific objectives**, **203 distinct canonical command strings**, **9 CLI modes** and **25 topics**.

The pack is a curated CCNA-oriented IOS/IOS XE practice set, not every command in IOS XE. IOS XE has thousands of platform-, release-, licence- and feature-specific commands. The content is marked **simulator-tested draft** until it is checked against named IOS/IOS XE lab images by a networking subject-matter expert.

This is an independent educational simulator. It is not affiliated with or endorsed by Cisco.

## Current behaviour

- Four game modes: Easy, Normal, Hard and Hardcore.
- Responsive layouts for full-screen, windowed, tablet, portrait-mobile and short landscape play.
- A prerequisite-gated beginner path in chapters of at most six commands, progressing from CLI navigation through verification, interfaces and IPv4, VLANs, routing, access control, DHCP and NAT.
- Untimed Easy practice with a faded ladder: retrieval strategy, semantic structure, command family and voluntary full reveal.
- Clean, first-attempt Easy recall enters the spaced-review schedule; assisted or revealed answers do not advance memory mastery, and a full reveal earns zero points.
- A bounded Daily Recall session containing only commands whose review time is due.
- IOS-style `Tab` completes only the keyword at the caret, preserving earlier abbreviations and never guessing a variable value or blank token.
- Inline `?` help displays deterministic grammar such as `A.B.C.D`, `INTERFACE`, ranges and `<cr>` without exposing the task's literal answer.
- A correct CLI-assisted answer keeps its normal operational score and time reward but cannot extend a clean streak, clean personal best or mastery interval.
- Clean Recall and Field CLI personal records are stored separately; deterministic unique IOS keyword abbreviations are accepted as Field CLI success while task values remain exact.
- Physical `Tab` and `?` keep focus and the caret at the end of the simulated command line; equivalent touch controls remain available.
- PuTTY-style clipboard flow: selecting terminal output copies it, Ctrl+V pastes, and right-click pastes directly when browser clipboard permission is available.
- Adaptive sessions are bounded and cannot repeat the previous opening command string.
- IPv4 receives the strongest protocol weighting; IPv6 remains in lower-frequency rotation.
- Due, overdue, failed, assisted, revealed and slow commands drive the queue; retained commands remain a smaller confidence sample, and repeated correctness no longer increases urgency.
- Normal starts with sixty seconds, adds three seconds for a correct command or five seconds from a three-answer clean streak, and removes one, three then five seconds across consecutive errors.
- Hard starts with sixty seconds, always adds three seconds for a correct command, and removes five, ten then fifteen seconds across consecutive errors.
- Hardcore starts with sixty seconds, adds two seconds for a correct command and ends immediately after one incorrect submission.
- A correct answer resets the consecutive-error penalty tier.
- User EXEC, Privileged EXEC, Global, Interface, Router, Line, VLAN, named ACL and DHCP-pool modes.
- Deterministic local validation. Player input is never executed.
- Specific error feedback during the round.
- Structured post-answer teaching covers purpose, use, syntax, expected state or output, verification, common traps, rollback and operational risk; timed mistakes do not leak hidden canonical text.
- Wrong answers move on without revealing the correct command.
- A later retry earns reduced score and does not advance mastery.
- An objective left unanswered when time expires is added to the missed review.
- Correct commands and explanations for missed items appear only after the timer reaches zero.
- Combination scoring and capped speed bonuses.
- Local progress, due-led spaced review and a visible beginner curriculum.
- An accessible three-lab library with local resume and restart controls.
- Lab 1 is a complete stateful IPv4 field lab using short interface aliases and simple private addressing: manual prompt navigation, interface configuration, output interpretation, seeded route diagnosis, repair, reachability verification, save and verified rollback.
- Lab 2 builds a branch router from defaults through hostname, secrets, local fallback, simulated RADIUS, AAA, SSH, DNS, DHCP, routed interfaces, verification and save.
- Lab 3 builds an access switch from defaults through the same secure management foundation, then VLANs, Fast/Gigabit/FortyGigabit interfaces, copper/fibre uplinks, edge protection, management SVI, verification and save. DHCP server configuration is intentionally omitted.
- IOS command keywords are accepted without regard to capitalisation; password and shared-secret values remain case-sensitive.
- Named Cisco CML image targets and an integrity-checked offline evidence workflow. The UI continues to show zero image-verified objectives until real licensed-image evidence exists.
- Custom question, answer and explanation management.
- Docker persistence for custom commands under `/data`.
- One configured login account with no registration route.

## Architecture

```text
app/page.tsx                 Responsive game, report and custom-command UI
lib/engine.ts                Parser, CLI modes and simulator
lib/expanded-catalogue.ts    Curated built-in command pack
lib/cli-grammar.ts           Deterministic keyword and argument grammar
lib/cli-assistance.ts        Deterministic Tab completion and question-mark menus
lib/command-queue.ts         Due/weak/new/retained adaptive sessions and Daily Recall
lib/curriculum.ts            Prerequisite-gated beginner chapters
lib/game-modes.ts            Deterministic game-mode time rules
lib/learning.ts              Deterministic Easy-mode learning aids
lib/scheduler.ts             Review scheduling and score calculation
lib/command-teaching.ts      Structured instructional metadata
lib/ipv4-scenario.ts         Stateful configuration and troubleshooting lab
lib/device-build-lab.ts      Deterministic router and switch foundation labs
lib/platform-validation.ts   Named target assignments and trust status
docs/catalogue-validation.md Offline named-image evidence process
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
- Most expanded commands remain deterministic recall items. The IPv4 troubleshooting lab and guided router/switch builds provide vertically complete practical workflows.
- All objectives have named CML target assignments, but no objective is labelled image-verified because no authorised CML image or captured lab evidence was available in this workspace. See `docs/catalogue-validation.md`.
- Local learning progress is not yet synchronised through the Docker volume.
- Login rate limits reset when the container restarts; Nginx provides a second rate-limit layer.
