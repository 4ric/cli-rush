# Validation report

Validated on 11 July 2026 after the IOS-style CLI assistance update.

## Commands run

```bash
npm ci
npm run lint
npm test
```

## Result

- Dependency installation: passed
- ESLint: passed with no reported problems
- Engine, catalogue, CLI-assistance, gameplay-policy, learning and scheduler tests: 249 passed
- Authentication and persistence gateway test: 1 passed
- Rendered application check: 1 passed
- Production build and Sites artifact validation: passed
- Total automated tests: 251 passed

## Browser checks

The hydrated game was also exercised in Microsoft Edge through the browser debugging protocol:

- Easy: untimed clock, staged shape and reveal help, zero points after a full reveal, and unchanged mastery scheduling.
- Normal: consecutive errors produced 59, 56 and 51 seconds; a correct answer reset the tier; three clean answers produced 63, 66 and 71 seconds.
- Hard: consecutive errors produced 55, 45 and 30 seconds; the next correct answer produced 33 seconds.
- Hardcore: a correct answer added two seconds; one error ended the run without revealing the answer and saved the result as a completed run.
- Pause: the clock and response-speed scoring both excluded paused time, with focus restored to the command input.
- Responsive geometry: no horizontal overflow at 390×844 mobile, 844×390 landscape, 768×1024 tablet, 1024×700 windowed and 1440×900 full-screen viewports.
- CLI assistance: keyboard `?` produced context options without changing score/time or ending Hardcore; `Tab` expanded an abbreviated command; the assisted correct answer kept its full point/time reward while leaving mastery unchanged.
- Mobile CLI assistance: the on-screen Tab and `?` controls introduced no horizontal overflow and left a 148px command-entry field at 390×844.

The package manager emitted a warning about the runtime's proxy environment and deprecation notices for transitive `@esbuild-kit` packages. These did not fail the build or tests.

No Docker secrets, `.env` file or production credentials were created during validation.
