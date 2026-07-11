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

1. Follow a prerequisite-gated beginner path, run due-only Daily Recall, launch the stateful IPv4 field lab, or choose Easy, Normal, Hard or Hardcore rules.
2. Learn commands without time pressure using retrieval strategy, semantic structure, command-family and reveal stages.
3. Move into sixty-second time-bank modes: correct commands add time, Normal and Hard errors remove time, and one Hardcore error ends the run.
4. Read an operational objective and Cisco-style prompt.
5. Type a full canonical command from memory.
6. Use physical or on-screen IOS-style `Tab` completion for the current token or grammar-based `?` help when spelling or syntax is uncertain.
7. Receive deterministic, specific feedback, a practical use case and visible time changes after either a correct or incorrect submission.
8. Build an operational score and clean-recall streak; assisted answers retain their operational reward but use a separate Field CLI record and do not advance mastery.
9. Recover a failed item later for reduced retry credit without advancing mastery.
10. At a completed timer, review incorrect, recovered and unanswered commands.
11. Save browser progress, schedule future reviews and return through the bounded Daily Recall queue when they become due.
12. Apply IPv4 knowledge in a manual multi-step lab that requires configuration, output interpretation, diagnosis, verification, persistence and rollback.

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
| `app/page.tsx` | Game UI, responsive round lifecycle, reports and custom-command management |
| `app/globals.css` / `app/extra.css` | Responsive visual system |
| `lib/engine.ts` | Parser, modes, validation and simulated device state |
| `lib/expanded-catalogue.ts` | Expanded CCNA-oriented learning content |
| `lib/cli-grammar.ts` | Mode-specific deterministic keyword and argument grammar |
| `lib/cli-assistance.ts` | Deterministic IOS-style Tab completion and `?` option lookup |
| `lib/command-queue.ts` | Due/weak/new/retained adaptive sessions and Daily Recall |
| `lib/curriculum.ts` | Prerequisite-gated beginner chapters |
| `lib/gameplay.ts` | Answer-reveal and failure-feedback policy |
| `lib/game-modes.ts` | Easy, Normal, Hard and Hardcore timing rules |
| `lib/learning.ts` | Faded semantic aids, reveals and post-answer mnemonics |
| `lib/scheduler.ts` | Spaced review intervals and scoring |
| `lib/command-teaching.ts` | Purpose, syntax, verification, trap, rollback and risk teaching data |
| `lib/ipv4-scenario.ts` | Stateful IPv4 configuration and troubleshooting lab |
| `lib/platform-validation.ts` | Named CML target assignments and validation status |
| `docs/catalogue-validation.md` | Offline image-evidence procedure and current trust boundary |
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

During a timed round, an incorrect answer does not expose the correct command. The player moves on. Full answers for missed items appear only when the time bank reaches zero. Ending early or failing a Hardcore run does not reveal them.

`Tab` and `?` are deterministic grammar operations, not generative hints. Tab touches only the current token and never guesses a blank or value. Using either is neutral at the moment it is requested. A subsequently correct answer keeps its operational score and time reward, but belongs to the Field CLI record and does not advance clean mastery, streaks or review intervals.

Every new session is bounded. It excludes the previous opening canonical command and draws roughly sixty per cent due/weak material, twenty per cent new material and twenty per cent retained confidence work when those pools exist. Due status, errors, assistance, reveals and slow recall increase priority; repeated correctness does not. Incorrect timed feedback uses concept-only explanation text so this adaptation never weakens the answer-reveal policy.

The simulated terminal follows the common PuTTY clipboard model: selecting output attempts to copy it, Ctrl+V pastes sanitised text into the input, and right-click attempts direct paste through the browser Clipboard API. Clipboard content remains plain untrusted text and is never executed.

### Local-first progress

Scores, review state and personal records stay in the browser. Docker currently persists custom catalogue additions, not learning progress.

### Content status

The catalogue is a simulator-tested draft. It is broad and CCNA-oriented, but has not yet been formally verified against named IOS or IOS XE images. Keep that distinction visible.

## Known limitations

1. Most expanded catalogue entries validate recall rather than modifying detailed state; the IPv4 field lab is the first complete stateful scenario.
2. Learning progress does not synchronise across browsers or through the Docker data volume.
3. Login rate-limit counters reset with the container; the supplied Nginx configuration adds a second layer.
4. Every command has a named CML target assignment, but zero commands are labelled image-verified until real licensed-image evidence is captured and reviewed.
5. The deployment path currently uses `/data/contrainers/cli-rush`. Confirm whether `contrainers` is intentional before deploying.
6. Field CLI abbreviations are accepted only through the deterministic mode grammar; exact task values remain mandatory.

## Recommended next vertical slice

Use the implemented evidence workflow in `docs/catalogue-validation.md` with an authorised CML lab. Validate the highest-use beginner and IPv4 scenario commands first, preserve target-specific evidence, and do not promote the whole pack from simulator-tested draft based on a partial sample.

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
