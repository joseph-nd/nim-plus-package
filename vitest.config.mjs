import { defineConfig } from 'vitest/config';

/**
 * Unit/integration tests for the module scripts, run under Node with mocked
 * Foundry globals (see tests/README.md and tests/harness/).
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.mjs'],
		// Every test file gets its own module registry, so module-level state in
		// scripts/ (the supersede cache, patched prototypes) never leaks between files.
		isolate: true,
		// Loading the real pack data (~2k JSON files) takes a moment on a cold cache.
		testTimeout: 20000,
		hookTimeout: 30000,
		// Tests mutate globalThis (game, Hooks, CONFIG…) — keep a file's tests sequential.
		sequence: { concurrent: false },
		reporters: ['default'],
		// The scripts' informational console.log lines ("nim-plus-package | …") are
		// noise in test output; warnings and errors still show.
		onConsoleLog(log, type) {
			if (type === 'stdout' && log.startsWith('nim-plus-package |')) return false;
			return undefined;
		},
	},
});
