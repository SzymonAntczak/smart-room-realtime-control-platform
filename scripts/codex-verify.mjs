import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readlink, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const stateDirectory = join(tmpdir(), 'smart-room-codex-verify');
const stateRetentionMs = 1000 * 60 * 60 * 24 * 7;
const textExtensions = new Set([
    '.css',
    '.cjs',
    '.cts',
    '.html',
    '.js',
    '.json',
    '.md',
    '.mjs',
    '.mts',
    '.ts',
    '.tsx',
    '.yaml',
    '.yml',
]);
const lintExtensions = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts', '.tsx']);
const browserContractPaths = new Set([
    'shared/src/commands.ts',
    'shared/src/projections.ts',
    'shared/src/realtime.ts',
    'shared/src/validation.ts',
]);
const rootVerificationPaths = new Set([
    'eslint.config.js',
    'package-lock.json',
    'package.json',
    'tsconfig.json',
]);

function extensionOf(path) {
    const dotIndex = basename(path).lastIndexOf('.');

    return dotIndex === -1 ? '' : basename(path).slice(dotIndex);
}

function normalizePath(path) {
    return path.replaceAll('\\', '/');
}

function hasPrefix(path, prefix) {
    return path === prefix.slice(0, -1) || path.startsWith(prefix);
}

function addCommand(commands, command) {
    if (!commands.some((candidate) => candidate.key === command.key)) {
        commands.push(command);
    }
}

function npmCommand(key, label, args) {
    return { key, label, args };
}

function addWorkspaceChecks(commands, workspace, testScript) {
    addCommand(
        commands,
        npmCommand(`typecheck:${workspace}`, `${workspace} typecheck`, [
            'run',
            'typecheck',
            '--workspace',
            workspace,
        ]),
    );
    addCommand(commands, npmCommand(testScript, testScript, ['run', testScript]));
}

function addFullSafeChecks(commands) {
    addCommand(commands, npmCommand('lint', 'repository lint', ['run', 'lint']));
    addCommand(commands, npmCommand('typecheck', 'repository typecheck', ['run', 'typecheck']));
    addCommand(commands, npmCommand('test:contracts', 'test:contracts', ['run', 'test:contracts']));
    addCommand(commands, npmCommand('test:backend', 'test:backend', ['run', 'test:backend']));
    addCommand(commands, npmCommand('test:frontend', 'test:frontend', ['run', 'test:frontend']));
    addCommand(commands, npmCommand('test:simulator', 'test:simulator', ['run', 'test:simulator']));
}

export function buildVerificationPlan(paths, isFilePresent = () => true) {
    const normalizedPaths = [...new Set(paths.map(normalizePath))].sort();
    const commands = [];
    const formatPaths = normalizedPaths.filter(
        (path) => isFilePresent(path) && textExtensions.has(extensionOf(path)),
    );
    const lintPaths = normalizedPaths.filter(
        (path) => isFilePresent(path) && lintExtensions.has(extensionOf(path)),
    );

    if (formatPaths.length > 0) {
        addCommand(
            commands,
            npmCommand('format:files', 'format changed files', [
                'run',
                'format:files',
                '--',
                ...formatPaths,
            ]),
        );
    }

    if (lintPaths.length > 0) {
        addCommand(
            commands,
            npmCommand('lint:files', 'lint changed files', [
                'run',
                'lint:files',
                '--',
                ...lintPaths,
            ]),
        );
    }

    const backendChanged = normalizedPaths.some((path) => hasPrefix(path, 'backend/'));
    const simulatorChanged = normalizedPaths.some((path) => hasPrefix(path, 'simulator/'));
    const sharedChanged = normalizedPaths.some((path) => hasPrefix(path, 'shared/'));
    const frontendChanged = normalizedPaths.some(
        (path) => hasPrefix(path, 'frontend/src/') || path === 'frontend/vite.config.ts',
    );
    const browserChanged = normalizedPaths.some(
        (path) =>
            hasPrefix(path, 'frontend/tests/browser-integration/') ||
            path === 'playwright.config.ts' ||
            path === 'frontend/tsconfig.browser-tests.json',
    );
    const mockBffUnitTestChanged = normalizedPaths.some(
        (path) =>
            hasPrefix(path, 'frontend/tests/browser-integration/mock-bff/') &&
            path.endsWith('.test.ts'),
    );
    const productionBoundaryChanged = normalizedPaths.some(
        (path) =>
            path === 'frontend/src/main.tsx' ||
            hasPrefix(path, 'frontend/src/app/dev/') ||
            path === 'frontend/vite.config.ts',
    );
    const browserContractChanged = normalizedPaths.some((path) => browserContractPaths.has(path));
    const rootVerificationChanged = normalizedPaths.some(
        (path) =>
            rootVerificationPaths.has(path) ||
            path.endsWith('/eslint.config.js') ||
            path.endsWith('/tsconfig.json') ||
            path.endsWith('/package.json') ||
            path.endsWith('/package-lock.json'),
    );
    const hookImplementationChanged = normalizedPaths.some(
        (path) => path === '.codex/hooks.json' || path.startsWith('scripts/codex-verify'),
    );
    const knownPathChanged = normalizedPaths.every(
        (path) =>
            hasPrefix(path, 'backend/') ||
            hasPrefix(path, 'docs/') ||
            hasPrefix(path, 'frontend/') ||
            hasPrefix(path, 'shared/') ||
            hasPrefix(path, 'simulator/') ||
            hasPrefix(path, '.agents/') ||
            hasPrefix(path, '.codex/') ||
            hasPrefix(path, 'scripts/') ||
            rootVerificationPaths.has(path) ||
            path === 'playwright.config.ts',
    );

    if (backendChanged) {
        addWorkspaceChecks(commands, '@smart-room/backend', 'test:backend');
    }

    if (simulatorChanged) {
        addWorkspaceChecks(commands, '@smart-room/simulator', 'test:simulator');
        addWorkspaceChecks(commands, '@smart-room/backend', 'test:backend');
    }

    if (sharedChanged) {
        addWorkspaceChecks(commands, '@smart-room/contracts', 'test:contracts');
        addWorkspaceChecks(commands, '@smart-room/backend', 'test:backend');
        addWorkspaceChecks(commands, '@smart-room/frontend', 'test:frontend');
    }

    if (frontendChanged) {
        addWorkspaceChecks(commands, '@smart-room/frontend', 'test:frontend');
    }

    if (productionBoundaryChanged) {
        addCommand(
            commands,
            npmCommand('verify:production-bundle', 'verify frontend production bundle', [
                'run',
                'verify:production-bundle',
                '--workspace',
                '@smart-room/frontend',
            ]),
        );
    }

    if (browserChanged || browserContractChanged) {
        addCommand(
            commands,
            npmCommand('typecheck:browser', 'typecheck:browser', ['run', 'typecheck:browser']),
        );
        addCommand(commands, npmCommand('test:browser', 'test:browser', ['run', 'test:browser']));
    }

    if (mockBffUnitTestChanged) {
        addWorkspaceChecks(commands, '@smart-room/frontend', 'test:frontend');
    }

    if (rootVerificationChanged || !knownPathChanged) {
        addFullSafeChecks(commands);
    }

    if (hookImplementationChanged) {
        addCommand(
            commands,
            npmCommand('test:codex-hooks', 'test:codex-hooks', ['run', 'test:codex-hooks']),
        );
    }

    return commands;
}

function hashValue(value) {
    return createHash('sha256').update(value).digest('hex');
}

async function fingerprintWorkingFile(path) {
    try {
        const fileStats = await lstat(path);

        if (fileStats.isSymbolicLink()) {
            return `symlink:${await readlink(path)}`;
        }

        if (!fileStats.isFile()) {
            return `other:${fileStats.mode}`;
        }

        return `file:${hashValue(await readFile(path))}`;
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

async function runGit(repositoryRoot, args) {
    const { stdout } = await execFileAsync('git', args, {
        cwd: repositoryRoot,
        encoding: 'buffer',
        maxBuffer: 10 * 1024 * 1024,
    });

    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

async function resolveRepositoryRoot(cwd) {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
    });

    return resolve(stdout.trim());
}

async function listIndexStates(repositoryRoot) {
    const output = (await runGit(repositoryRoot, ['ls-files', '--stage', '-z'])).toString('utf8');
    const indexStates = new Map();

    for (const entry of output.split('\0')) {
        if (entry.length === 0) {
            continue;
        }

        const tabIndex = entry.indexOf('\t');
        const metadata = entry.slice(0, tabIndex);
        const path = normalizePath(entry.slice(tabIndex + 1));
        const existing = indexStates.get(path) ?? [];

        existing.push(metadata);
        indexStates.set(path, existing);
    }

    return new Map(
        [...indexStates.entries()].map(([path, entries]) => [path, entries.sort().join('|')]),
    );
}

export async function scanRepositoryState(repositoryRoot) {
    const [visibleOutput, indexStates] = await Promise.all([
        runGit(repositoryRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
        listIndexStates(repositoryRoot),
    ]);
    const paths = new Set(
        visibleOutput.toString('utf8').split('\0').filter(Boolean).map(normalizePath),
    );

    for (const path of indexStates.keys()) {
        paths.add(path);
    }

    const entries = await Promise.all(
        [...paths].sort().map(async (path) => [
            path,
            {
                index: indexStates.get(path) ?? null,
                working: await fingerprintWorkingFile(join(repositoryRoot, path)),
            },
        ]),
    );

    return Object.fromEntries(entries);
}

export function changedPathsSince(baseline, current) {
    const paths = new Set([...Object.keys(baseline), ...Object.keys(current)]);

    return [...paths]
        .filter(
            (path) =>
                JSON.stringify(baseline[path] ?? null) !== JSON.stringify(current[path] ?? null),
        )
        .sort();
}

function statePath(repositoryRoot, sessionId) {
    return join(stateDirectory, `${hashValue(`${repositoryRoot}\0${sessionId}`)}.json`);
}

async function cleanupExpiredStates() {
    try {
        const entries = await readdir(stateDirectory);

        await Promise.all(
            entries.map(async (entry) => {
                const path = join(stateDirectory, entry);
                const fileStats = await stat(path);

                if (Date.now() - fileStats.mtimeMs > stateRetentionMs) {
                    await rm(path, { force: true });
                }
            }),
        );
    } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
            throw error;
        }
    }
}

async function loadBaseline(path) {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));

        if (
            !parsed ||
            typeof parsed !== 'object' ||
            !parsed.snapshot ||
            typeof parsed.snapshot !== 'object'
        ) {
            return null;
        }

        return parsed;
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
            return null;
        }

        return null;
    }
}

async function saveBaseline(path, repositoryRoot, snapshot) {
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
        path,
        JSON.stringify({ createdAt: new Date().toISOString(), repositoryRoot, snapshot }),
        'utf8',
    );
}

async function writeFailureLog(path, results) {
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path, JSON.stringify(results, null, 2), 'utf8');
}

function npmInvocation(args) {
    if (process.platform === 'win32') {
        return {
            args: [
                join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
                ...args,
            ],
            executable: process.execPath,
        };
    }

    return { args, executable: 'npm' };
}

export function runCommand(command, cwd) {
    return new Promise((resolvePromise) => {
        let settled = false;
        const settle = (result) => {
            if (!settled) {
                settled = true;
                resolvePromise(result);
            }
        };
        const invocation = npmInvocation(command.args);
        const child = execFile(
            invocation.executable,
            invocation.args,
            { cwd, encoding: 'utf8' },
            (error, stdout, stderr) => {
                settle({
                    command,
                    exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
                    stderr,
                    stdout,
                });
            },
        );

        child.on('error', (error) => {
            settle({
                command,
                exitCode: 1,
                stderr: error.message,
                stdout: '',
            });
        });
    });
}

async function executeVerificationPlan(commands, repositoryRoot) {
    const results = [];

    for (const command of commands) {
        results.push(await runCommand(command, repositoryRoot));
    }

    return results;
}

function summarizeFailures(results, logPath) {
    const failures = results.filter((result) => result.exitCode !== 0);
    const summary = failures
        .map((failure) => {
            const output = `${failure.stdout}\n${failure.stderr}`
                .trim()
                .split('\n')
                .slice(-12)
                .join('\n');

            return `${failure.command.label} exited ${failure.exitCode}${output ? `:\n${output}` : ''}`;
        })
        .join('\n\n');

    return `Session-scoped verification failed. Full logs: ${logPath}\n\n${summary}`.slice(0, 9000);
}

export function stopFailureResponse(reason, stopHookActive) {
    if (stopHookActive) {
        return {
            continue: false,
            stopReason: 'Session-scoped verification remains unsuccessful.',
            systemMessage: reason,
        };
    }

    return { decision: 'block', reason };
}

function environmentFailureResponse(error, stopHookActive) {
    return stopFailureResponse(
        `Verification environment unavailable: ${error instanceof Error ? error.message : String(error)}`,
        stopHookActive,
    );
}

function requiredSessionId(input) {
    if (typeof input.session_id !== 'string' || input.session_id.length === 0) {
        throw new Error('Hook input did not include a session_id.');
    }

    return input.session_id;
}

export async function handleHookEvent(event, input, dependencies = {}) {
    const resolveRoot = dependencies.resolveRepositoryRoot ?? resolveRepositoryRoot;
    const scanState = dependencies.scanRepositoryState ?? scanRepositoryState;
    const cleanStates = dependencies.cleanupExpiredStates ?? cleanupExpiredStates;
    const readBaseline = dependencies.loadBaseline ?? loadBaseline;
    const persistBaseline = dependencies.saveBaseline ?? saveBaseline;
    const removeBaseline = dependencies.removeBaseline ?? ((path) => rm(path, { force: true }));
    const executePlan = dependencies.executeVerificationPlan ?? executeVerificationPlan;
    const saveFailureLog = dependencies.writeFailureLog ?? writeFailureLog;
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
    let repositoryRoot;
    let baselineFile;

    try {
        repositoryRoot = await resolveRoot(cwd);
        baselineFile = statePath(repositoryRoot, requiredSessionId(input));

        if (event === 'session-end') {
            await removeBaseline(baselineFile);

            return null;
        }

        if (event === 'session-start') {
            await cleanStates();
            await persistBaseline(baselineFile, repositoryRoot, await scanState(repositoryRoot));

            return { continue: true };
        }

        if (event !== 'stop') {
            throw new Error(`Unsupported hook event: ${event}`);
        }

        const current = await scanState(repositoryRoot);

        if (input.permission_mode === 'plan') {
            await persistBaseline(baselineFile, repositoryRoot, current);

            return { continue: true };
        }

        const baseline = await readBaseline(baselineFile);

        if (!baseline || baseline.repositoryRoot !== repositoryRoot) {
            await persistBaseline(baselineFile, repositoryRoot, current);

            return {
                continue: true,
                systemMessage:
                    'Verification baseline was initialized; no checks ran for this turn.',
            };
        }

        const paths = changedPathsSince(baseline.snapshot, current);

        if (paths.length === 0) {
            return { continue: true };
        }

        const commands = buildVerificationPlan(paths, (path) => current[path]?.working != null);

        if (commands.length === 0) {
            await persistBaseline(baselineFile, repositoryRoot, current);

            return {
                continue: true,
                systemMessage: 'Session changes did not map to executable verification commands.',
            };
        }

        const results = await executePlan(commands, repositoryRoot);
        const failures = results.filter((result) => result.exitCode !== 0);

        if (failures.length === 0) {
            await persistBaseline(baselineFile, repositoryRoot, current);

            return { continue: true };
        }

        const logPath = join(
            stateDirectory,
            `${hashValue(`${repositoryRoot}\0${input.turn_id ?? 'unknown'}`)}.log.json`,
        );
        await saveFailureLog(logPath, results);

        return stopFailureResponse(
            summarizeFailures(results, logPath),
            input.stop_hook_active === true,
        );
    } catch (error) {
        if (event === 'session-end') {
            return null;
        }

        if (event === 'session-start') {
            return {
                continue: true,
                systemMessage: `Verification baseline could not be captured: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            };
        }

        return environmentFailureResponse(error, input.stop_hook_active === true);
    }
}

async function main() {
    const event = process.argv[2];

    if (event !== 'session-start' && event !== 'stop' && event !== 'session-end') {
        throw new Error('Expected one of: session-start, stop, session-end.');
    }

    let inputText = '';
    for await (const chunk of process.stdin) {
        inputText += chunk;
    }
    const input = inputText.trim().length === 0 ? {} : JSON.parse(inputText);
    const response = await handleHookEvent(event, input);

    if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
    }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;

if (invokedPath === import.meta.url) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}
