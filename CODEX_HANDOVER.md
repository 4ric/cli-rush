# CLI RUSH handover to Codex

## What this repository is

This is the working source for **CLI RUSH: Network Command Arena**. It is a fast command-recall game for Cisco IOS and IOS XE practice. The application is deliberately a simulator. It does not connect to or execute commands on real devices.

The current source contains both:

1. A browser-first game that stores learning progress locally.
2. An optional Docker gateway that adds one configured login and persists custom command content under `/data`.

## Current product state

The built-in catalogue currently contains:

| Measure | Current value |
| --- | ---: |
| Mode-specific objectives | 214 |
| Distinct canonical commands | 203 |
| CLI modes | 9 |
| Topics | 25 |

Implemented player flow:

1. Start a 60-second Command Rush.
2. Read an operational objective and Cisco-style prompt.
3. Type a full canonical command from memory.
4. Receive deterministic, specific feedback.
5. Build a score and combination for correct first-attempt recall.
6. Move on immediately after an error without seeing the answer.
7. Recover a failed item later for reduced retry credit without advancing mastery.
8. At a completed timer, review incorrect, recovered and unanswered commands.
9. Save browser progress and schedule future reviews.

Also implemented:

- User EXEC, Privileged EXEC, Global, Interface, Router, Line, VLAN, named ACL and DHCP-pool modes.
- Custom command creation and deletion.
- Local-browser custom content outside Docker.
- Docker-backed custom content when authenticated.
- Single-user authentication using scrypt password hashes and signed cookies.
- Docker Compose, a multi-stage Dockerfile and an Nginx example.
- Automated engine, scheduling, reveal-policy, authentication and rendered-output tests.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Game UI, round lifecycle, reports and custom-command management |
| `app/globals.css` / `app/extra.css` | Responsive visual system |
| `lib/engine.ts` | Parser, modes, validation and simulated device state |
| `lib/expanded-catalogue.ts` | Expanded CCNA-oriented learning content |
| `lib/gameplay.ts` | Answer-reveal and failure-feedback policy |
| `lib/scheduler.ts` | Spaced review intervals and scoring |
| `server/auth-server.mjs` | Docker HTTP gateway, login and custom-content persistence |
| `scripts/init-secrets.mjs` | Interactive password-hash and session-secret generation |
| `tests/engine/` | Command, gameplay-policy and scheduling tests |
| `tests/server/` | Authentication and API tests |
| `Dockerfile` / `compose.yaml` | Container build and runtime hardening |
| `deploy/nginx.conf.example` | HTTPS reverse-proxy starting point |
| `.openai/hosting.json` | Existing ChatGPT Sites identity |

## Important design decisions

### Deterministic validation

The application validates against curated command data and mode rules. Do not replace this with an LLM-based judge. Any accepted variant must be explicit and testable.

### Recall before reveal

During a timed round, an incorrect answer does not expose the correct command. The player moves on. Full answers for missed items appear only after the sixty-second timer completes. Ending early does not reveal them.

### Local-first progress

Scores, review state and personal records stay in the browser. Docker currently persists custom catalogue additions, not learning progress.

### Content status

The catalogue is a simulator-tested draft. It is broad and CCNA-oriented, but has not yet been formally verified against named IOS or IOS XE images. Keep that distinction visible.

## Known limitations

1. Most expanded catalogue entries validate recall but do not yet modify a detailed simulated device state.
2. The due-review scheduler exists, but there is no dedicated Daily Recall gameplay screen.
3. Learning progress does not synchronise across browsers or through the Docker data volume.
4. Login rate-limit counters reset with the container; the supplied Nginx configuration adds a second layer.
5. Platform and version metadata is not attached to every command.
6. The deployment path currently uses `/data/contrainers/cli-rush`. Confirm whether `contrainers` is intentional before deploying.
7. Abbreviation handling remains intentionally conservative. Do not accept shortened commands without a tested mode-specific ambiguity model.

## Recommended next vertical slice

The strongest next slice is a real **Daily Recall** mode using the existing scheduler.

Minimum acceptance criteria:

1. Show only due items, ordered deterministically by due time and lapse count.
2. Support a short untimed review session.
3. Preserve the same CLI-mode validation and error feedback as Command Rush.
4. Do not award mastery or advance the interval after an error or revealed answer.
5. Save each completed review immediately.
6. Show a report calculated only from that review session.
7. Provide no Daily Recall button when no review is due; show plain status text instead.
8. Add scheduler, persistence and UI-flow tests.

Do not begin this slice unless it matches the user's requested next priority.

## First actions for the receiving Codex agent

1. Read `AGENTS.md`, this file and `README.md`.
2. Inspect `git status` and preserve any user changes.
3. Run `npm ci`, `npm run lint` and `npm test`.
4. Report the exact baseline before editing.
5. Restate the requested next slice and its acceptance criteria.
6. Implement it end to end, including tests and documentation.

## Deployment notes

- For ordinary local work, follow `README.md`.
- For Docker deployment, copy `.env.example` to `.env`, set the final HTTPS origin, generate secrets with `scripts/init-secrets.mjs`, then build with Compose.
- Never commit `.env` or `secrets/`.
- `.openai/hosting.json` belongs to an existing ChatGPT Sites project. A Codex agent with access should edit that Site rather than create a new one.
