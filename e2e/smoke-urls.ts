export const smokePorts = { bff: 4312, frontend: 5175 } as const;

export const smokeUrls = {
    bff: `http://127.0.0.1:${smokePorts.bff}`,
    frontend: `http://127.0.0.1:${smokePorts.frontend}`,
} as const;
