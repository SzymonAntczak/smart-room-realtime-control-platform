import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const compilerEvents = new Map<string, Set<string>>();

const evidencePlugin: Plugin = {
    name: 'history-react-compiler-test-evidence',
    configureServer(server) {
        server.middlewares.use('/__test/react-compiler-evidence', (_request, response) => {
            response.setHeader('content-type', 'application/json');
            response.end(
                JSON.stringify(
                    Object.fromEntries(
                        [...compilerEvents].map(([filename, events]) => [filename, [...events]]),
                    ),
                ),
            );
        });
    },
};

export default defineConfig({
    plugins: [
        react(),
        babel({
            presets: [
                reactCompilerPreset({
                    compilationMode: 'infer',
                    logger: {
                        logEvent(filename, event) {
                            if (filename === null) {
                                return;
                            }

                            const normalizedFilename = filename.replaceAll('\\', '/');

                            if (
                                normalizedFilename.endsWith('/HistoryFeed.tsx') ||
                                normalizedFilename.endsWith('/useHistoryVirtualizer.ts')
                            ) {
                                const name = normalizedFilename.slice(
                                    normalizedFilename.lastIndexOf('/') + 1,
                                );
                                const events = compilerEvents.get(name) ?? new Set<string>();
                                events.add(JSON.stringify(event));
                                compilerEvents.set(name, events);
                            }
                        },
                    },
                }),
            ],
        }),
        evidencePlugin,
    ],
});
