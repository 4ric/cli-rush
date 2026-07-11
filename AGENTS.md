# Codex working instructions

## Product goal

CLI RUSH is a local-first Cisco IOS and IOS XE command-recall game. It should train accurate, unassisted recall while keeping rounds short and responsive.

## Current baseline

- 214 mode-specific learning objectives
- 203 distinct canonical command strings
- 9 CLI modes
- 25 topics
- A playable 60-second Command Rush
- Deterministic validation, scoring, combinations and review scheduling
- Custom command management
- Optional single-user Docker authentication and persistent custom content

Treat these figures as assertions that must remain covered by automated tests. Do not hard-code replacement figures in the UI without deriving them from the catalogue.

## Non-negotiable rules

1. Player terminal input must never be executed by a shell, JavaScript evaluator, SQL engine or real network device.
2. Scoring and command validation must remain deterministic. Generative AI must not decide whether a command is correct.
3. Preserve UK English in all player-facing text.
4. Do not add dead buttons, empty navigation, fake statistics, fabricated multiplayer data or completed-looking placeholder achievements.
5. Do not label the built-in command pack as technically reviewed until it has been checked against named IOS or IOS XE lab images.
6. Wrong answers stay hidden during a timed round. Correct answers for missed items are shown only when the full timer expires.
7. Revealed or assisted answers must not receive mastery credit.
8. Do not store plaintext passwords, session secrets or production credentials in the repository.
9. Preserve `.openai/hosting.json`. It identifies an existing ChatGPT Sites project; do not create a replacement Site.
10. Prefer one vertically complete feature over several incomplete screens.

## Required validation

Before changing code, establish the baseline:

```bash
npm ci
npm run lint
npm test
```

After a change, rerun the smallest relevant tests during development, followed by the complete commands above before handover.

For Docker-related changes, also build the image and check the service health without committing generated secrets:

```bash
docker compose build
docker compose config
```

## Implementation boundaries

- `app/page.tsx` owns the current React interface and round orchestration.
- `lib/engine.ts` owns CLI modes, parsing, deterministic validation and simulated state changes.
- `lib/expanded-catalogue.ts` owns the expanded built-in learning pack.
- `lib/gameplay.ts` owns answer-reveal policy helpers.
- `lib/scheduler.ts` owns review scheduling and scoring.
- `server/auth-server.mjs` owns Docker authentication and custom-command persistence.

Keep engine and scheduler logic independent from React. Add table-driven tests for every new built-in command and every review-scheduling rule.

## Security expectations

- Treat command text and custom content as untrusted data.
- Render it as text, never unsanitised HTML.
- Keep request-body and field-size limits.
- Preserve exact-origin checks for state-changing requests.
- Preserve `HttpOnly`, `SameSite=Strict` cookies and secure-cookie behaviour.
- Preserve the read-only container, dropped capabilities and `no-new-privileges` settings.
- Do not weaken authentication or expose port 3000/3080 publicly to make local testing easier.

## Definition of done

A change is complete only when its visible controls work, persisted state survives the expected restart or reload boundary, errors are specific, tests cover the core behaviour, documentation matches reality and the full test suite passes.
