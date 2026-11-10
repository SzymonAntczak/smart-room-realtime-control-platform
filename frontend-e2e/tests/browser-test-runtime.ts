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
    history: '/room/history/user-history',
    historyControl: '/test/room/history',
    telemetryHistory: '/room/history/telemetry',
    telemetryHistoryControl: '/test/room/history/telemetry',
    realtime: '/room/realtime',
    commands: '/room/commands',
    reset: '/test/room/reset',
    rejectNextCommand: '/test/room/commands/reject-next',
    commandControl: '/test/room/commands',
    publishAcceptedBeforeResponse: '/test/room/commands/publish-accepted-before-response',
    snapshot: '/test/room/snapshot',
    scenarioRealtime: '/test/room/realtime',
    disconnectRealtime: '/test/room/realtime/disconnect',
    resumeRealtime: '/test/room/realtime/resume',
} as const;

export const mockBffUrls = {
    health: `${browserTestUrls.mockBff}${mockBffPaths.health}`,
    historyControl: `${browserTestUrls.mockBff}${mockBffPaths.historyControl}`,
    telemetryHistory: `${browserTestUrls.mockBff}${mockBffPaths.telemetryHistory}`,
    telemetryHistoryControl: `${browserTestUrls.mockBff}${mockBffPaths.telemetryHistoryControl}`,
    realtime: `${browserTestUrls.mockBff}${mockBffPaths.realtime}`,
    commands: `${browserTestUrls.mockBff}${mockBffPaths.commands}`,
    reset: `${browserTestUrls.mockBff}${mockBffPaths.reset}`,
    rejectNextCommand: `${browserTestUrls.mockBff}${mockBffPaths.rejectNextCommand}`,
    commandControl: `${browserTestUrls.mockBff}${mockBffPaths.commandControl}`,
    publishAcceptedBeforeResponse: `${browserTestUrls.mockBff}${mockBffPaths.publishAcceptedBeforeResponse}`,
    snapshot: `${browserTestUrls.mockBff}${mockBffPaths.snapshot}`,
    scenarioRealtime: `${browserTestUrls.mockBff}${mockBffPaths.scenarioRealtime}`,
    disconnectRealtime: `${browserTestUrls.mockBff}${mockBffPaths.disconnectRealtime}`,
    resumeRealtime: `${browserTestUrls.mockBff}${mockBffPaths.resumeRealtime}`,
} as const;
