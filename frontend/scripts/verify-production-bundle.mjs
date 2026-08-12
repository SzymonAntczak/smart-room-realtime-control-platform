import { readFile, readdir } from 'node:fs/promises';

const bundleDirectory = new URL('../dist/', import.meta.url);
const developmentOnlyMarkers = ['/dev/devices/', 'Scenariusze programistyczne', 'VITE_BFF_URL'];

const bundleFiles = await collectFiles(bundleDirectory);
const bundle = await Promise.all(bundleFiles.map((file) => readFile(file, 'utf8')));

for (const marker of developmentOnlyMarkers) {
    if (bundle.some((content) => content.includes(marker))) {
        throw new Error(`Production bundle contains development-only marker: ${marker}`);
    }
}

async function collectFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
        entries.map((entry) => {
            const path = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory);

            return entry.isDirectory() ? collectFiles(path) : [path];
        }),
    );

    return files.flat();
}
