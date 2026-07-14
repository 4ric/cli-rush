# CLI RUSH: Network Command Arena

CLI RUSH is a local-first Cisco IOS and IOS XE command-recall game. Player input is parsed by a deterministic simulator; it is never sent to a shell, evaluator, SQL engine or real network device.

The built-in learning pack retains the tested baseline of **214 mode-specific objectives**, **203 distinct canonical command strings**, **9 built-in CLI contexts** and **25 topics**. These are catalogue assertions, not hand-written marketing totals in the interface. The supported simulator grammar is broader than the learning pack because it also contains deliberate contextual-help distractors. Run `npm run generate:coverage` to derive both inventories from the current registry and update [`validation/command-coverage.json`](validation/command-coverage.json).

The pack is a curated CCNA-oriented subset, not an emulator of every IOS XE command. It remains a **simulator-tested draft** until the built-in commands are checked against named IOS or IOS XE lab images. CLI RUSH is an independent educational project and is not affiliated with or endorsed by Cisco.

## What is implemented

### Shared deterministic simulator

- One registry and grammar drive parsing, IOS-style keyword abbreviations, contextual `?` help, token-by-token Tab completion, learning tasks, labs and custom-command previews.
- Explicit IOS XE router and Catalyst Layer 2 switch profiles declare their interfaces and capabilities. Commands and interface names are accepted only where the selected profile supports them.
- The state graph covers User EXEC, Privileged EXEC, Global Configuration, physical-interface, router-subinterface, interface-range, VLAN, line, router, DHCP-pool, RADIUS server, AAA server-group and named ACL contexts where the profile permits them.
- IOS keywords are case-insensitive. Passwords, shared secrets and other declared secret arguments remain case-sensitive and are redacted from terminal history and persisted sessions.
- Unambiguous prefixes such as `ena`, `conf t`, `sh ip int br`, `no shut`, `wr` and `copy run start` are normal IOS input, not assisted answers.
- `?` lists the complete supported grammar for the current device profile and CLI context, including commands unrelated to the current task. It does not rank or reveal the expected answer.
- Tab uses the same grammar and completes only the current unambiguous token or common prefix. It does not append later keywords or seeded values and does not submit the line.
- Valid commands execute against simulated state even when they do not complete the current objective. Incomplete, ambiguous, wrong-context, invalid-keyword and invalid-value cases remain distinct.
- Interface state, routes, VLANs, SVIs, EtherChannel, DHCP, AAA/RADIUS, SSH, running/startup snapshots and deterministic reachability feed the relevant `show` and test output.
- Save, merge, replace, reload, erase and default-interface behaviour are modelled separately. Disruptive actions use confirmation and recovery checkpoints where the exercise could otherwise become unrecoverable.
- Keyboard and touch controls cover Tab, `?`, command history, Ctrl+A, Ctrl+E, Ctrl+U, Ctrl+W, Ctrl+C, Ctrl+Z and Ctrl+Shift+6. Terminal text can be highlighted to copy; Ctrl+V and permitted right-click clipboard access paste only into the inert simulator input.

### Learning and scheduling

- Each built-in task has an outcome, starting profile and context, rationale, progressive hints, semantic success condition, expected effect, explanation, verification, output interpretation, common failure, recovery, tags, prerequisites and a spaced-repetition concept ID.
- Success is based on parsed meaning, state, output, context or control-key events as appropriate rather than a large list of exact answer strings.
- Independent, Guided discovery, Assisted, Revealed, Incorrect and Skipped outcomes have separate review consequences. A legal IOS abbreviation does not make an answer assisted.
- Timed rounds keep missed answers hidden until the full timer expires; ending a run early or on a Hardcore strike does not reveal them. Revealed or assisted work does not receive clean mastery credit.
- The queue weights due, overdue, failed, assisted, revealed and slow items while retaining a smaller confidence sample.
- Easy, Normal, Hard and Hardcore use the same grammar and objectives. Difficulty changes timing, penalties, hints and pacing—not valid IOS syntax.
- All four modes apply an eight-question semantic cooldown when the eligible pool permits it. Cooldown compares task ID, concept ID, normalised command shape, primary command family and normalised task wording, including seeded variants and navigation equivalents.
- IPv4 remains the strongest protocol weighting; IPv6 stays in lower-frequency rotation.
- The beginner path is prerequisite-gated, Daily Recall contains only due items and local progress resumes in the same browser profile.

Current timing rules are:

- **Easy:** untimed, progressive help and deliberate answer reveal.
- **Normal:** starts at 60 seconds; a correct answer adds 3 seconds, or 5 seconds from a three-answer clean streak. Consecutive errors remove 1, 3 then 5 seconds.
- **Hard:** starts at 60 seconds; each correct answer adds 3 seconds. Consecutive errors remove 5, 10 then 15 seconds.
- **Hardcore:** starts at 60 seconds; each correct answer adds 2 seconds and the first incorrect submission ends the round.

A correct answer resets the consecutive-error penalty tier. Help, Tab and editing keys do not submit an attempt or pause the timer.

### Practical labs

All three labs are untimed, stateful and use the shared registry and parser with deterministic simulated state. Progress, CLI context and simulated state are saved locally; Continue resumes the saved step, while Restart requires a deliberate action.

1. **IPv4 field troubleshooting** follows a twenty-six-step, one-action-at-a-time observe, configure, verify, diagnose, repair, remove, recover and save cycle. It uses simple fictional RFC 1918 and RFC 5737 addresses, seeded peers and return paths, and deterministic failure causes.
2. **Router foundation** builds `R1` through identity, an enable secret, a local recovery account, simulated RADIUS with local fallback, AAA, SSH, a routed LAN, DHCP, a default route, separate authentication tests, verification and save. No real RADIUS service, RSA key or credential is created.
3. **Switch foundation** builds `SW1` through secure management, VLANs 10/20/99, FastEthernet data and phone/workstation ranges, PortFast, BPDU Guard, port security, two TenGigabitEthernet LACP members, `Port-channel1` trunking, a management SVI, unused-port shutdown, verification and save. DHCP server configuration is intentionally absent from the Layer 2 switch profile.

Lab 3 does not teach a generic fibre or FortyGigabit uplink workflow. Its current vertically complete uplink exercise is the declared two-port TenGigabitEthernet LACP bundle described above. The wider virtual switch inventory may contain additional interface families for other simulator tasks, but that does not make them part of this lab.

### Save, undo and get unstuck

The **Good to know** section is executable safety practice rather than a reference-only page. Its exercises cover:

- Inspecting and comparing running and startup configurations.
- Making and removing a harmless description with an exact `no` form.
- Verifying before saving, then using both the canonical copy flow and a common write-style alternative.
- Moving back with `exit` or directly to Privileged EXEC with `end`.
- Demonstrating the different draft behaviour of Ctrl+C and Ctrl+Z.
- Proving that `copy startup-config running-config` is a merge, not a clean rollback.
- Restoring a saved snapshot with `configure replace nvram:startup-config force` on the declared training profile and verifying the result.
- Exploring `default interface` and disruptive reload/reset decisions behind confirmation and checkpoint recovery.

### Home, practice and responsive layout

- The home screen prioritises one continuation action, then due recall, the beginner path, labs, a collapsed mode selector and the safety exercises.
- Active practice uses a task-and-terminal split on wider screens. On small screens the terminal remains the main workspace and task detail opens in a bottom sheet.
- The layout uses safe-area insets, dynamic/visual viewport height, at least 16 px terminal input, 44 px touch targets and an operating-system `prefers-reduced-motion` fallback without a manual Reduce Motion setting.
- Terminal history and command recall are bounded, and draft input lives in a memoised terminal component so ordinary typing does not parse or persist the full activity state.
- A local browser-QA harness uses the repository-pinned Playwright Chromium build to check 320×568, 375×667, 390×844, 430×932, 844×390, 768×1024, 1280×720, 1440×900 and 1920×1080 layouts, an axe WCAG scan and a 4×-CPU throttled long-terminal regression. Separate interaction, WebKit, Lighthouse and bounded 30-minute soak harnesses cover keyboard/touch behaviour, standalone resume and long-session resource growth. See the `qa:*` scripts and generated `outputs/browser-qa/` artefacts.
- The correct-command sound is a short local Web Audio sequence with deterministic streak lifts at 3, 5 and 10. The Sound setting persists, and obsolete nodes are stopped before a new reward plays.

### PWA behaviour

- The generated manifest defines `/` as its start URL and scope, standalone display, matching launch colours, 192 px and 512 px icons, a maskable icon and an Apple touch icon.
- iOS Home Screen metadata, `viewport-fit=cover`, safe-area handling, standalone detection and visual-viewport keyboard handling are included.
- The selected activity, round, lab step, CLI context and simulated state are restored from versioned local data after refresh or relaunch where that activity supports resume.
- The service worker caches only a small validated static shell and same-origin static assets whose final URL and MIME type match the request. Redirected, HTML-substituted and `no-store` responses are rejected. Login, logout, health and API traffic are always bypassed.
- A network failure shows a clear offline page or connection banner. A waiting service worker offers a controlled refresh.

This is not a claim of full offline progress synchronisation: browser learning state remains local, and Docker-backed custom content requires the service to be reachable.

## Custom commands

Use **Manage commands** from the account/administration menu. Custom content uses schema version 2 and joins the shared grammar only after deterministic validation.

The Basic authoring path asks for a device profile, CLI context, canonical command, outcome-based task and explanation. It can infer a safe read-only model for supported inspection commands. A command that changes state must use the Advanced fields to declare its deterministic effect, verification and recovery.

Advanced authoring adds command type, topic, difficulty, contextual-help copy, effect, rationale, progressive hints, reveal explanation, verification, undo guidance, tags and prerequisites. Before activation, the manager previews:

- How the command appears under `?`.
- How its current token behaves under Tab.
- Parser-proven unambiguous shorthand examples.
- Command-tree collisions, unsupported contexts and profile incompatibilities.

Version-1 flat records are retained as inactive legacy entries rather than deleted or silently assigned behaviour. An administrator must complete and revalidate them. Valid version-2 records are revalidated on load; unsafe or incomplete records stay visible but inactive.

Custom entries are inert data. They cannot contain JavaScript, regular expressions, shell actions or simulator functions. Text and field lengths are bounded, unsafe control characters are rejected and visible content is rendered as text.

Without the Docker gateway, custom records are saved in the current browser profile. With Docker authentication enabled, authorised writes use `/api/custom-commands`, optimistic ETags and atomic permission-restricted JSON replacement under `/data`. The store is not encrypted at rest. Use fictional values only; never paste a production configuration, credential, address plan or organisation identifier into the manager.

## Architecture

```text
app/page.tsx                    React interface, activity orchestration and local resume
app/custom-command-manager.tsx  Basic/Advanced custom authoring and parser preview
app/manifest.ts                 PWA manifest
app/pwa-registration.tsx        Service-worker registration, update and offline notices
public/sw.js                    Safe static-shell caching policy
lib/device-profiles.ts          Router and Catalyst Layer 2 capabilities/interfaces
lib/command-registry.ts         Shared typed command grammar and parser productions
lib/cli-assistance.ts           Registry-derived contextual help and Tab completion
lib/engine.ts                   Deterministic CLI state transitions and simulator output
lib/learning-tasks.ts           Shared semantic learning-task model
lib/expanded-catalogue.ts       Built-in learning-objective catalogue
lib/command-queue.ts            Due/weak selection and semantic repeat cooldown
lib/navigation-scheduler.ts     Seeded context-graph navigation curriculum
lib/scheduler.ts                Review intervals, mastery outcomes and scoring
lib/gameplay.ts                 Timed answer-visibility policy
lib/ipv4-scenario.ts            Twenty-six-step IPv4 troubleshooting lab
lib/lab-content.ts              Router and switch lab teaching definitions
lib/device-build-lab.ts         Stateful router/switch execution and migrations
lib/good-to-know.ts             Executable save, undo and recovery exercises
lib/custom-commands.ts          Custom schema, migration, validation and preview
lib/command-coverage.ts         Derived inventory and classification report
server/auth-server.mjs          Docker login and custom-content persistence gateway
scripts/generate-command-coverage.ts  Registry coverage report generator
scripts/browser-qa.mjs          Responsive and terminal-performance browser harness
scripts/scan-sensitive-content.mjs   Value-suppressing privacy scan
docs/catalogue-validation.md    Offline named-image evidence process
tests/                          Engine, content, security, server and package tests
```

The checked-in coverage report separates built-in learning tasks, deliberate contextual-help-only productions and active administrator additions. It also reports counts by profile and context. Incomplete legacy/custom drafts are excluded because they are not executable commands.

## Persistence and migrations

- Existing learning progress and review history remain browser-local.
- Navigation, timed rounds, the IPv4 lab, both foundation labs and Good to know exercises use bounded, versioned saved state.
- IPv4 lab saves use version 4. Valid version-2 and version-3 grouped-flow saves retain their compatible state and position in the twenty-six-step sequence; the incompatible original unversioned flow restarts safely with a visible migration notice.
- Router and switch foundation saves use device-build state version 3. Valid earlier version-1 and version-2 saves are migrated by replaying the recognised completed prefix against a fresh shared device state; malformed or impossible state is rejected rather than trusted.
- Custom commands use schema version 2. Flat version-1 source data is retained in an incomplete legacy record for administrator review, so migration does not delete the original values.
- Docker custom-command storage deliberately remains a JSON array for rollback compatibility. The API reports its semantic schema version and ETag, serialises writes and replaces the file atomically.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Run the complete project validation before handover:

```bash
npm run lint
npm test
npm run scan:sensitive
```

Useful focused checks are:

```bash
npm run test:unit
npm run test:auth
npm run test:privacy
npm run test:docker
npm run generate:coverage
npm run qa:browser
npm run qa:interaction
npm run qa:webkit
npm run qa:lighthouse
npm run qa:soak
npm run qa:serve:production
```

The browser harnesses expect a running application at `http://127.0.0.1:4173/` by default. Override that with `CLI_RUSH_QA_URL`; set `CLI_RUSH_QA_SOAK_MINUTES=30` for the release soak. `npm run qa:serve:production` starts a local production-QA gateway on port 4174 and works around vinext's Windows-only static-path issue without changing the Linux Docker runtime. Install Playwright's WebKit binary with `npx playwright install webkit` before the WebKit check. These automated checks do not replace a physical iPhone Home Screen test.

For the production QA profile, keep `npm run qa:serve:production` running in one terminal and run the harnesses against `http://127.0.0.1:4174` in another. In PowerShell:

```powershell
$env:CLI_RUSH_QA_URL = "http://127.0.0.1:4174"
npm run qa:browser
npm run qa:interaction
npm run qa:webkit
npm run qa:lighthouse
$env:CLI_RUSH_QA_SOAK_MINUTES = "30"
npm run qa:soak
```

## Docker deployment

Deployment archives are designed to extract to:

```text
/data/containers/cli-rush
```

Clone or fast-forward the project into that directory, then initialise login secrets without installing Node.js on the host:

```bash
mkdir -p /data/containers
cd /data/containers
git clone https://github.com/4ric/cli-rush.git
cd /data/containers/cli-rush
sh scripts/docker-setup.sh
```

Set the exact public HTTPS origin in `.env`, then build and start:

```bash
docker compose up -d --build
```

The default binding is `127.0.0.1:3080`, intended for a reverse proxy on the Docker host. `./data` and `./secrets` survive image rebuilds. Direct private-LAN HTTP access is optional and requires both an explicit private bind address and the exact matching `CLI_RUSH_LOCAL_ORIGIN`; do not expose port 3000 or 3080 publicly.

Before deployment, also run:

```bash
docker compose build
docker compose config
```

Then wait for the service health check and verify `/healthz` through the intended local path. See [`DOCKER-DEPLOY.md`](DOCKER-DEPLOY.md) for initial setup, Nginx, dual-origin access, updates, backup and removal.

The `Release QA` GitHub Actions workflow runs the exact dependency install, lint and test commands, builds the Compose image, starts the hardened service, waits for a healthy container and exercises the local-origin login with ephemeral generated secrets. It does not publish an image or retain the generated credentials.

The Docker gateway preserves:

- One configured username and no registration route.
- A scrypt password hash and a separate random session secret supplied through Docker secret files; plaintext credentials do not enter Git.
- Signed, audience-bound `HttpOnly`, `SameSite=Strict` cookies, using the `__Host-` prefix for the HTTPS session. Local HTTP and public HTTPS tokens cannot be replayed across those boundaries.
- Exact-origin checks for login, logout and custom-command writes.
- Login throttling reserves each source attempt before password hashing and permits at most four concurrent scrypt checks by default. Forwarded addresses count only from explicitly configured trusted proxy peers.
- Bounded request bodies and custom fields, security headers, a read-only container filesystem, dropped capabilities and `no-new-privileges`.

## Privacy of configuration references

The seven named router and switch configuration references for this revision were not present in this workspace:

- `big site router.txt`
- `big site switch1.txt`
- `big site switch2.txt`
- `big site switch3.txt`
- `small site router.txt`
- `small site switch1.txt`
- `small site switch2.txt`

No claim is made that those files were inspected, sanitised or imported. Current lab data is fictional and simulator-derived. If the references are supplied later, keep them outside Git, Docker build contexts, fixtures, browser bundles, generated artefacts, logs, screenshots and documentation; use them only as read-only pattern sources through a separate sanitised review.

The sensitive-content scanner reports only a rule and file location and suppresses matched values. It checks tracked source and available production text artefacts for named reference files, credentials, certificate material, VPN keying configuration and non-documentation public endpoints.

## Verification boundaries and known limitations

- The simulator implements a deliberate IOS/IOS XE subset. A command absent from the registry is unsupported even if a physical platform accepts it.
- The built-in pack has not been validated against named IOS or IOS XE lab images. Target assignments and the offline evidence workflow do not constitute image verification; the UI must continue to show zero image-verified objectives until authorised evidence exists.
- The seven named production-derived configuration references were unavailable, so no reference-derived workflow has been verified.
- Automated responsive, accessibility and performance checks exercise the Playwright-pinned Chromium build, and the responsive/standalone path is also exercised with Playwright WebKit. A physical iPhone Home Screen install, real software keyboard, device rotation, audio-resume, suspension and relaunch were not directly verified on this workstation.
- The service worker provides a safe launch shell and clear offline failure state, not full offline learning-data or Docker-content synchronisation.
- A local Docker CLI/engine was not available on the implementation workstation during this revision. The `Release QA` Linux runner therefore performs `docker compose config`, the image build, live container health and an authenticated login on every push to `main`; a deployment host should still verify its own bind address, volume permissions and reverse-proxy route.
- Browser learning progress is not synchronised through the Docker volume. Clearing that browser profile removes its local progress unless it is backed up separately.
- Login rate-limit memory resets when the gateway process restarts; the reverse proxy should provide an additional outer rate limit.
- Lighthouse and the 30-minute listener/DOM/heap soak are deliberately separate release harnesses rather than part of the fast unit suite; their JSON evidence is written under `outputs/browser-qa/`.

Physical iPhone release checklist: add the HTTPS site to the Home Screen in Safari; launch without Safari chrome; focus the terminal without zoom; use `?`, Tab and history controls with the keyboard open; rotate portrait/landscape; enable Sound after a gesture; suspend and relaunch to confirm exact task/context restoration; then disconnect briefly and confirm the explicit offline state.
