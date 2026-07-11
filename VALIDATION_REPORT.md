# Validation report

Validated on 11 July 2026 after the round-integrity update.

## Commands run

```bash
npm ci
npm run lint
npm test
```

## Result

- Dependency installation: passed
- ESLint: passed with no reported problems
- Engine, catalogue, gameplay-policy and scheduler tests: 234 passed
- Authentication and persistence gateway test: 1 passed
- Rendered application check: 1 passed
- Production build and Sites artifact validation: passed
- Total automated tests: 236 passed

The package manager emitted a warning about the runtime's proxy environment and deprecation notices for transitive `@esbuild-kit` packages. These did not fail the build or tests.

No Docker secrets, `.env` file or production credentials were created during validation.
