# Frontend E2E Instructions

Applies to `frontend-e2e/`, which owns mocked-BFF browser integration and its
test-only runtime. Follow root `AGENTS.md` and use
`smart-room-frontend-e2e-testing` for changes to this suite.

Read Browser Integration Tests in `docs/development/frontend-guidelines.md`,
Test Suite Boundaries and Test Quality in `docs/development/coding-guidelines.md`,
`docs/decisions/adr-playwright-frontend-integration-tests.md`,
`docs/decisions/adr-test-suite-boundaries.md` and
`docs/architecture/reliability-and-testing.md`.

Use shared contracts at the BFF boundary. Do not import application, backend or
simulator internals. Full-system E2E belongs in `e2e/`.

Commands and runtime setup are documented in this workspace's `README.md`.
Run local harness unit tests for mock-BFF changes and both browser variants for
shared runtime or runner changes.
