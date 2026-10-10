import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/** Mirror the build-time define from tsdown.config.ts so tests see the same version. */
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string

export default defineConfig({
  define: {
    __DSH_WORKBUDDY_VERSION__: JSON.stringify(PACKAGE_VERSION),
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    /**
     * Pin `NODE_ENV` for every test file.
     *
     * React picks its build from `process.env.NODE_ENV` at import time:
     * `production` loads `react.production.min.js`, whose `act()` is a stub
     * that throws “act(...) is not supported in production builds of React”.
     * A shell that exports `NODE_ENV=production` — a container image, a CI
     * runner, an IDE launch config — therefore failed all 19 composer tests
     * for a reason that has nothing to do with the code under test.
     *
     * Pinning it here keeps the suite self-contained: the result depends on the
     * config, not on the ambient shell.
     */
    env: {
      NODE_ENV: 'test',
    },
  },
})
