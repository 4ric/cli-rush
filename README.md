# CLI RUSH: Network Command Arena

A local-first Cisco-style command recall game. This first vertical slice delivers one complete loop: start a 60-second Command Rush, type commands into a simulated terminal, receive deterministic feedback, build a score and combination, save progress locally, schedule weak commands for review and inspect a real end-of-round report.

This is an independent educational simulator. It is not affiliated with or endorsed by Cisco. The included IOS XE command pack is marked **simulator-tested draft**. It must receive an external technical review before being described as technically reviewed content.

## First-slice scope

- 36 deterministic command objectives across User EXEC, Privileged EXEC, Global configuration, Interface configuration and Router configuration modes.
- Cisco-style prompts, command history, state changes and simulated `show` output.
- Named validation errors for wrong mode, missing or reordered keywords, extra input, IPv4 addresses, subnet masks, wildcard-mask confusion, interface names and wrong objectives.
- A real 60-second round with pause, capped speed bonuses, combination multipliers, graduated feedback and answer reveal after three errors.
- Versioned device-local progress in `localStorage`.
- A transparent review ladder: 10 minutes, 1 day, 3 days, 7 days, 14 days and 30 days.
- A report calculated only from the completed run.
- Keyboard navigation, reduced motion and independent sound control.

There are no multiplayer claims, achievements, inactive navigation items or fabricated statistics.

## Architecture

```text
app/page.tsx          UI, round orchestration and local persistence
lib/engine.ts         command catalogue, validator, CLI modes and device simulator
lib/scheduler.ts      pure review scheduling and score calculation
tests/engine/         table-driven command and scheduler tests
```

The command validator and review scheduler do not depend on React. Player input is compared only against curated data and pure validation functions. It is never passed to a shell, evaluator, SQL query or real network session.

## Run locally

```bash
npm ci
npm run dev
```

Run the focused tests:

```bash
npm run test:unit
```

Run the full build and rendered-output check:

```bash
npm test
```

## Content model

Each command record has a stable ID, required mode, canonical command, objective, explanation, topic, difficulty and intent. Memory mode requires the full canonical form. Abbreviations are intentionally excluded until a mode-specific ambiguity tree is added and tested.

## Known limitations and next priorities

1. Add a dedicated Daily Recall session that consumes due items; this slice schedules and exposes the real due count but does not add another game mode.
2. Move the draft catalogue into schema-validated JSON packs and add a formal technical review workflow.
3. Add multi-command Syntax Chain scenarios with final state assertions.
4. Add PWA service-worker support and verified offline installation.
5. Add browser-level interaction tests once a browser test runner is part of the project.
