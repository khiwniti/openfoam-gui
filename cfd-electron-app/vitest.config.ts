import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * V1.27 -- minimal vitest config. The unit tests target pure Zod schemas
 *  in `src/shared/`, so the config only needs an `@shared` alias (matching
 *  the renderer/main resolution in `electron.vite.config.ts`) and the
 *  default node environment. React/Electron entry-points are excluded
 *  from the test-graph because they're not unit-testable without a DOM
 *  mock stack — earning that coverage is a future V.x (renderer
 *  components + IPC handlers).
 *
 *  ESM caveat: `cfd-electron-app/package.json` sets `"type": "module"`,
 *  so the config file is loaded as ESM by vite's config loader. ESM
 *  does NOT define `__dirname` (a CommonJS global), so we synthesize
 *  it from `import.meta.url` via `fileURLToPath` + `dirname`.
 */
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(here, 'src/shared'),
      // V1.36a — add @main/* alias so test files can import from
      //  electron-free helpers modules like @main/ipc/helpers
      //  without pulling the IPC barrel's electron imports into the
      //  vitest node env. Mirrors the alias block in
      //  electron.vite.config.ts#main.resolve.alias.
      '@main': resolve(here, 'src/main'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
