export const backendLogLevels = [
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
    'silent',
] as const;

export type BackendLogLevel = (typeof backendLogLevels)[number];

export interface LoggingRuntimeConfig {
    logLevel: BackendLogLevel;
}

export interface LoggingEnvironment {
    LOG_LEVEL?: string | undefined;
}

const defaultLogLevel: BackendLogLevel = 'info';
const backendLogLevelSet = new Set<string>(backendLogLevels);

export function readLoggingRuntimeConfig(environment: LoggingEnvironment): LoggingRuntimeConfig {
    const configuredValue = environment.LOG_LEVEL?.trim();

    if (!configuredValue) {
        return { logLevel: defaultLogLevel };
    }

    if (!backendLogLevelSet.has(configuredValue)) {
        throw new RangeError(`LOG_LEVEL must be one of: ${backendLogLevels.join(', ')}.`);
    }

    return { logLevel: configuredValue as BackendLogLevel };
}
