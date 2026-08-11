const host = '127.0.0.1';
const frontendPort = 5174;
const mockBffPort = 4311;

export const browserTestRuntime = {
    host,
    frontendPort,
    mockBffPort,
} as const;

export const browserTestUrls = {
    frontend: `http://${host}:${frontendPort}`,
    mockBff: `http://${host}:${mockBffPort}`,
} as const;

export const mockBffPaths = {
    health: '/health',
    realtime: '/room/realtime',
    commands: '/room/commands',
    reset: '/test/room/reset',
    snapshot: '/test/room/snapshot',
    scenarioRealtime: '/test/room/realtime',
} as const;

export const mockBffUrls = {
    health: `${browserTestUrls.mockBff}${mockBffPaths.health}`,
    realtime: `${browserTestUrls.mockBff}${mockBffPaths.realtime}`,
    commands: `${browserTestUrls.mockBff}${mockBffPaths.commands}`,
    reset: `${browserTestUrls.mockBff}${mockBffPaths.reset}`,
    snapshot: `${browserTestUrls.mockBff}${mockBffPaths.snapshot}`,
    scenarioRealtime: `${browserTestUrls.mockBff}${mockBffPaths.scenarioRealtime}`,
} as const;
