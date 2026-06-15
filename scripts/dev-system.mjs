import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const processes = [
    startNpmScript({
        name: 'backend',
        args: ['--prefix', 'backend', 'run', 'dev'],
    }),
    startNpmScript({
        name: 'frontend',
        args: ['--prefix', 'frontend', 'run', 'dev'],
    }),
];

let isShuttingDown = false;

process.on('SIGINT', () => {
    shutdown(0);
});

process.on('SIGTERM', () => {
    shutdown(0);
});

function startNpmScript({ name, args }) {
    if (process.platform !== 'win32') {
        return startProcess({
            name,
            command: 'npm',
            args,
        });
    }

    return startProcess({
        name,
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', ['npm', ...args].map(quoteShellArgument).join(' ')],
    });
}

function startProcess({ name, command, args }) {
    const child = spawn(command, args, {
        cwd: process.cwd(),
        env: createChildProcessEnv(),
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: false,
    });

    pipeOutput(name, child.stdout);
    pipeOutput(name, child.stderr);

    child.on('exit', (code, signal) => {
        if (isShuttingDown) {
            return;
        }

        const reason = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
        console.log(`[dev] ${name} stopped with ${reason}.`);
        shutdown(code ?? 1);
    });

    child.on('error', (error) => {
        if (isShuttingDown) {
            return;
        }

        console.error(`[dev] failed to start ${name}: ${error.message}`);
        shutdown(1);
    });

    return child;
}

function createChildProcessEnv() {
    if (process.platform !== 'win32') {
        return process.env;
    }

    const env = {};
    const seenKeys = new Set();

    for (const [key, value] of Object.entries(process.env)) {
        const normalizedKey = key.toLowerCase();

        if (seenKeys.has(normalizedKey)) {
            continue;
        }

        seenKeys.add(normalizedKey);
        env[key] = value;
    }

    return env;
}

function quoteShellArgument(value) {
    if (!/[\s"]/u.test(value)) {
        return value;
    }

    return `"${value.replaceAll('"', '""')}"`;
}

function pipeOutput(name, stream) {
    const lines = createInterface({
        input: stream,
        crlfDelay: Infinity,
    });

    lines.on('line', (line) => {
        console.log(`[${name}] ${line}`);
    });
}

function shutdown(exitCode) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;

    for (const child of processes) {
        if (!child.killed && child.exitCode === null) {
            child.kill();
        }
    }

    process.exitCode = exitCode;
}
