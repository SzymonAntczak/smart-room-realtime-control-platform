# Frontend E2E

Private `@smart-room/frontend-e2e` npm workspace for browser integration of the
real frontend against a test-local mocked BFF. Full-system E2E with the real
backend and required sources belongs in `../e2e/`.

Install dependencies from the repository root with `npm install`, then install
Chromium once with `npm run install:frontend-e2e`.

From the repository root:

```bash
npm run test:frontend-e2e
npm run test:frontend-e2e:compiler
npm run test:frontend-e2e:unit
npm run typecheck:frontend-e2e
```

From `frontend-e2e/`, use `npm test`, `npm run test:compiler`,
`npm run test:unit`, `npm run typecheck`, `npm run lint` and `npm run format`.
Append `-- --list` to a browser test command to inspect discovery.

Playwright specs live in `tests/`, with page objects in `tests/page-objects/`
and the mocked BFF, scenario controls, fixtures and colocated Vitest tests in
`tests/mock-bff/`. Vitest discovers only `tests/**/*.test.ts` in Node and does
not load the application's jsdom setup. Application unit, component and hook
tests remain in `frontend/` and run with root `npm run test:frontend`.

Both browser variants start only Vite on `127.0.0.1:5174` and the mocked BFF on
`127.0.0.1:4311`, then stop those processes on completion. They use headless
Chromium, one worker and locale `pl-PL`. The compiler variant additionally runs
the React Compiler evidence spec, which is excluded from the standard variant.
The production backend and simulator are not started.

Failed tests retain traces, screenshots and videos under the repository root:
`test-results/frontend-integration` for the standard variant and
`test-results/frontend-integration-compiler` for the compiler variant.

See [browser test conventions](../docs/development/frontend-guidelines.md#browser-integration-tests)
and [the Playwright decision](../docs/decisions/adr-playwright-frontend-integration-tests.md).
