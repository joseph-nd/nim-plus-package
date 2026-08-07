/* eslint-disable no-console */
/**
 * Smoke test: load the whole `scripts/` module tree under stubbed Foundry
 * globals and report what it registered.
 *
 * There is no bundler, so a mistyped import path or a name that no module
 * exports is not a syntax error — it is a module that silently fails to load,
 * and the first sign of it is the module doing nothing in Foundry. This catches
 * both in about a second:
 *
 *   - unresolvable specifiers throw ERR_MODULE_NOT_FOUND
 *   - `import { x }` where nothing exports `x` throws a SyntaxError at link time
 *   - anything thrown by top-level module code surfaces here
 *
 * It does not execute hook handlers, so it proves the tree loads — not that any
 * feature works.
 *
 *   pnpm check
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installFoundryStubs, hookLog } from './foundry-stub.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'scripts', 'main.mjs');

installFoundryStubs();

try {
	await import(pathToFileURL(ENTRY).href);
} catch (error) {
	console.error('[FAIL] - scripts/main.mjs did not load.\n');
	console.error(error);
	process.exit(1);
}

const counts = new Map();
for (const entry of hookLog) counts.set(entry, (counts.get(entry) ?? 0) + 1);

console.log(`[INFO] - Loaded scripts/main.mjs — ${hookLog.length} hook registrations`);
for (const name of [...counts.keys()].sort()) {
	console.log(`         ${String(counts.get(name)).padStart(3)}  ${name}`);
}
