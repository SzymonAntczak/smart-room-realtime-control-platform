import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    buildVerificationPlan,
    changedPathsSince,
    handleHookEvent,
    runCommand,
    scanRepositoryState,
    stopFailureResponse,
} from './codex-verify.mjs';

function git(repositoryRoot, args) {
    execFileSync('git', args, { cwd: repositoryRoot, stdio: 'ignore' });
}

async function createRepository() {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'smart-room-codex-verify-test-'));

    git(repositoryRoot, ['init']);
    git(repositoryRoot, ['config', 'user.email', 'test@example.com']);
    git(repositoryRoot, ['config', 'user.name', 'Codex Verify Test']);
    await writeFile(join(repositoryRoot, 'tracked.ts'), 'export const value = 1;\n', 'utf8');
    git(repositoryRoot, ['add', 'tracked.ts']);
    git(repositoryRoot, ['commit', '-m', 'initial']);

    return repositoryRoot;
}

test('does not route a dirty file that was unchanged since the session baseline', async (t) => {
    const repositoryRoot = await createRepository();
    t.after(() => rm(repositoryRoot, { force: true, recursive: true }));

    await writeFile(join(repositoryRoot, 'tracked.ts'), 'export const value = 2;\n', 'utf8');
    const baseline = await scanRepositoryState(repositoryRoot);
    const unchanged = await scanRepositoryState(repositoryRoot);

    assert.deepEqual(changedPathsSince(baseline, unchanged), []);

    await writeFile(join(repositoryRoot, 'tracked.ts'), 'export const value = 3;\n', 'utf8');
    const changed = await scanRepositoryState(repositoryRoot);

    assert.deepEqual(changedPathsSince(baseline, changed), ['tracked.ts']);
});

test('accepts hook JSON from stdin when executed by Node', async (t) => {
    const repositoryRoot = await createRepository();
    t.after(() => rm(repositoryRoot, { force: true, recursive: true }));

    const sessionId = `stdin-${Date.now()}`;
    const scriptPath = join(process.cwd(), 'scripts', 'codex-verify.mjs');
    const result = execFileSync(process.execPath, [scriptPath, 'session-start'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        input: JSON.stringify({ session_id: sessionId }),
    });

    assert.deepEqual(JSON.parse(result), { continue: true });
    execFileSync(process.execPath, [scriptPath, 'session-end'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        input: JSON.stringify({ session_id: sessionId }),
    });
});

test('detects staged, untracked, and deleted changes after the session baseline', async (t) => {
    const repositoryRoot = await createRepository();
    t.after(() => rm(repositoryRoot, { force: true, recursive: true }));

    await writeFile(join(repositoryRoot, 'tracked.ts'), 'export const value = 2;\n', 'utf8');
    const baseline = await scanRepositoryState(repositoryRoot);

    git(repositoryRoot, ['add', 'tracked.ts']);
    await writeFile(join(repositoryRoot, 'new.ts'), 'export const added = true;\n', 'utf8');
    await rm(join(repositoryRoot, 'tracked.ts'));
    const changed = await scanRepositoryState(repositoryRoot);

    assert.deepEqual(changedPathsSince(baseline, changed), ['new.ts', 'tracked.ts']);
});

test('routes shared browser contracts through all affected consumers and browser checks', () => {
    const plan = buildVerificationPlan(['shared/src/realtime.ts']);
    const keys = plan.map((command) => command.key);

    assert.deepEqual(keys, [
        'format:files',
        'lint:files',
        'typecheck:@smart-room/contracts',
        'test:contracts',
        'typecheck:@smart-room/backend',
        'test:backend',
        'typecheck:@smart-room/frontend',
        'test:frontend',
        'typecheck:browser',
        'test:browser',
    ]);
});

test('routes simulator, development wiring, mock-BFF tests, and root config deterministically', () => {
    const plan = buildVerificationPlan([
        'simulator/src/index.ts',
        'frontend/src/app/dev/AppDev.tsx',
        'frontend/tests/browser-integration/mock-bff/mock-bff-contracts.test.ts',
        'package.json',
    ]);
    const keys = plan.map((command) => command.key);

    assert.deepEqual(keys, [
        'format:files',
        'lint:files',
        'typecheck:@smart-room/simulator',
        'test:simulator',
        'typecheck:@smart-room/backend',
        'test:backend',
        'typecheck:@smart-room/frontend',
        'test:frontend',
        'verify:production-bundle',
        'typecheck:browser',
        'test:browser',
        'lint',
        'typecheck',
        'test:contracts',
    ]);
});

test('routes a package-local ESLint configuration through the full safe suite', () => {
    const keys = buildVerificationPlan(['frontend/eslint.config.js']).map((command) => command.key);

    assert.deepEqual(keys, [
        'format:files',
        'lint:files',
        'lint',
        'typecheck',
        'test:contracts',
        'test:backend',
        'test:frontend',
        'test:simulator',
    ]);
});

test('does not send unsupported TOML files to Prettier', () => {
    assert.deepEqual(
        buildVerificationPlan(['.codex/agents/example.toml']).map((command) => command.key),
        [],
    );
});

test('formats repository and package instructions without runtime checks', () => {
    const paths = ['AGENTS.md', 'backend/AGENTS.md', 'frontend/AGENTS.md', 'simulator/AGENTS.md'];
    const plan = buildVerificationPlan(paths);

    assert.deepEqual(
        plan.map((command) => command.key),
        ['format:files'],
    );
    assert.deepEqual(plan[0].args, ['run', 'format:files', '--', ...paths]);
});

test('keeps affected runtime checks when code and instructions change together', () => {
    for (const path of [
        'backend/src/platform/example.ts',
        'simulator/src/example.ts',
        'shared/src/realtime.ts',
        'frontend/src/app/example.ts',
    ]) {
        const runtimePlan = buildVerificationPlan([path]);
        const mixedPlan = buildVerificationPlan([
            path,
            'AGENTS.md',
            'backend/AGENTS.md',
            'simulator/AGENTS.md',
        ]);

        assert.deepEqual(
            mixedPlan.filter((command) => command.key !== 'format:files'),
            runtimePlan.filter((command) => command.key !== 'format:files'),
        );
    }
});

test('does not format deleted instructions or schedule runtime checks for them', () => {
    assert.deepEqual(
        buildVerificationPlan(
            ['AGENTS.md', 'backend/AGENTS.md', 'simulator/AGENTS.md'],
            () => false,
        ),
        [],
    );
});

test('still verifies hooks when instructions change alongside their configuration', () => {
    assert.deepEqual(
        buildVerificationPlan(['AGENTS.md', '.codex/hooks.json']).map((command) => command.key),
        ['format:files', 'test:codex-hooks'],
    );
});

test('verifies hook implementation and test changes without unrelated workspace checks', () => {
    for (const path of ['scripts/codex-verify.mjs', 'scripts/codex-verify.test.mjs']) {
        assert.deepEqual(
            buildVerificationPlan([path]).map((command) => command.key),
            ['format:files', 'lint:files', 'test:codex-hooks'],
        );
    }
});

test('keeps the safe suite for unknown files outside the recognized instruction paths', () => {
    const keys = buildVerificationPlan(['another-package/AGENTS.md']).map((command) => command.key);

    assert.ok(keys.includes('lint'));
    assert.ok(keys.includes('typecheck'));
    assert.ok(keys.includes('test:contracts'));
    assert.ok(keys.includes('test:backend'));
    assert.ok(keys.includes('test:frontend'));
    assert.ok(keys.includes('test:simulator'));
});

test('routes backend integration and runner configuration through backend checks', () => {
    for (const path of [
        'backend/src/testing/integration/room-history.integration.test.ts',
        'backend/src/testing/integration/native-source-doubles.ts',
        'backend/vitest.config.ts',
    ]) {
        const keys = buildVerificationPlan([path]).map((command) => command.key);
        assert.ok(keys.includes('typecheck:@smart-room/backend'));
        assert.ok(keys.includes('test:backend'));
        assert.ok(!keys.includes('test:frontend'));
        assert.ok(!keys.includes('test:browser'));
    }
});

test('checks both compiler configurations and runs the compiler browser suite', () => {
    for (const path of ['frontend/vite.compiler.config.ts', 'playwright.compiler.config.ts']) {
        const keys = buildVerificationPlan([path]).map((command) => command.key);
        assert.ok(keys.includes('typecheck:frontend'));
        assert.ok(keys.includes('typecheck:browser'));
        assert.ok(keys.includes('test:browser:compiler'));
    }
});

test('verifies shared Playwright configuration with both browser suites', () => {
    const keys = buildVerificationPlan(['playwright.shared.config.ts']).map(
        (command) => command.key,
    );

    assert.ok(keys.includes('typecheck:browser'));
    assert.ok(keys.includes('test:browser'));
    assert.ok(keys.includes('test:browser:compiler'));
    assert.ok(!keys.includes('test:backend'));
});

test('runs the compiler evidence spec in the suite that discovers it', () => {
    const keys = buildVerificationPlan([
        'frontend/tests/browser-integration/react-compiler-evidence.spec.ts',
    ]).map((command) => command.key);

    assert.ok(keys.includes('typecheck:browser'));
    assert.ok(keys.includes('test:browser:compiler'));
    assert.ok(!keys.includes('test:browser'));
});

test('runs npm commands without spawning npm.cmd directly on Windows', async () => {
    const result = await runCommand(
        { args: ['--version'], key: 'npm-version', label: 'npm version' },
        process.cwd(),
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
});

test('refreshes the baseline without commands in plan mode', async () => {
    let persistedSnapshot;
    let executionCount = 0;
    const snapshot = { 'docs/guide.md': { index: null, working: 'file:current' } };
    const response = await handleHookEvent(
        'stop',
        { cwd: '/repo', permission_mode: 'plan', session_id: 'session' },
        {
            resolveRepositoryRoot: async () => '/repo',
            scanRepositoryState: async () => snapshot,
            saveBaseline: async (_path, _root, persisted) => {
                persistedSnapshot = persisted;
            },
            executeVerificationPlan: async () => {
                executionCount += 1;

                return [];
            },
        },
    );

    assert.deepEqual(response, { continue: true });
    assert.deepEqual(persistedSnapshot, snapshot);
    assert.equal(executionCount, 0);
});

test('initializes a missing baseline without claiming that checks ran', async () => {
    const snapshot = { 'docs/guide.md': { index: null, working: 'file:current' } };
    let executionCount = 0;
    let persistedSnapshot;
    const response = await handleHookEvent(
        'stop',
        { cwd: '/repo', permission_mode: 'default', session_id: 'session' },
        {
            resolveRepositoryRoot: async () => '/repo',
            scanRepositoryState: async () => snapshot,
            loadBaseline: async () => null,
            saveBaseline: async (_path, _root, persisted) => {
                persistedSnapshot = persisted;
            },
            executeVerificationPlan: async () => {
                executionCount += 1;

                return [];
            },
        },
    );

    assert.deepEqual(response, {
        continue: true,
        systemMessage: 'Verification baseline was initialized; no checks ran for this turn.',
    });
    assert.deepEqual(persistedSnapshot, snapshot);
    assert.equal(executionCount, 0);
});

test('does not format an untracked file deleted after the session baseline', async () => {
    let executionCount = 0;
    const response = await handleHookEvent(
        'stop',
        { cwd: '/repo', permission_mode: 'default', session_id: 'session' },
        {
            resolveRepositoryRoot: async () => '/repo',
            scanRepositoryState: async () => ({}),
            loadBaseline: async () => ({
                repositoryRoot: '/repo',
                snapshot: {
                    'docs/temporary.md': { index: null, working: 'file:before-deletion' },
                },
            }),
            saveBaseline: async () => {},
            executeVerificationPlan: async () => {
                executionCount += 1;

                return [];
            },
        },
    );

    assert.deepEqual(response, {
        continue: true,
        systemMessage: 'Session changes did not map to executable verification commands.',
    });
    assert.equal(executionCount, 0);
});

test('reports a SessionStart environment failure without using the Stop protocol', async () => {
    const response = await handleHookEvent(
        'session-start',
        { cwd: '/repo', session_id: 'session' },
        {
            resolveRepositoryRoot: async () => {
                throw new Error('git ownership is not trusted');
            },
        },
    );

    assert.deepEqual(response, {
        continue: true,
        systemMessage: 'Verification baseline could not be captured: git ownership is not trusted',
    });
});

test('uses the Stop protocol when an executed verification command fails', async () => {
    const baseline = { 'docs/guide.md': { index: null, working: 'file:before' } };
    const current = { 'docs/guide.md': { index: null, working: 'file:after' } };
    const executeVerificationPlan = async () => [
        {
            command: { key: 'format:files', label: 'format changed files' },
            exitCode: 1,
            stderr: 'format error',
            stdout: '',
        },
    ];
    const dependencies = {
        resolveRepositoryRoot: async () => '/repo',
        scanRepositoryState: async () => current,
        loadBaseline: async () => ({ repositoryRoot: '/repo', snapshot: baseline }),
        executeVerificationPlan,
        writeFailureLog: async () => {},
    };
    const firstResponse = await handleHookEvent(
        'stop',
        {
            cwd: '/repo',
            permission_mode: 'default',
            session_id: 'session',
            stop_hook_active: false,
        },
        dependencies,
    );
    const repeatedResponse = await handleHookEvent(
        'stop',
        { cwd: '/repo', permission_mode: 'default', session_id: 'session', stop_hook_active: true },
        dependencies,
    );

    assert.equal(firstResponse.decision, 'block');
    assert.match(firstResponse.reason, /format changed files exited 1/);
    assert.deepEqual(repeatedResponse, {
        continue: false,
        stopReason: 'Session-scoped verification remains unsuccessful.',
        systemMessage: repeatedResponse.systemMessage,
    });
    assert.match(repeatedResponse.systemMessage, /format changed files exited 1/);
});

test('continues once for a verification failure and stops further loops', () => {
    const reason = 'test:backend exited 1';

    assert.deepEqual(stopFailureResponse(reason, false), { decision: 'block', reason });
    assert.deepEqual(stopFailureResponse(reason, true), {
        continue: false,
        stopReason: 'Session-scoped verification remains unsuccessful.',
        systemMessage: reason,
    });
});
