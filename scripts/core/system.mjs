/**
 * Thin accessors for the host system (Nimble). Everything here is looked up at
 * call time rather than captured at import time, because module code is
 * evaluated long before `game` and `CONFIG` are populated.
 */

/** `nimble` on a stable install, `nimble-dev` on a dev build. */
export function sysId() {
	return game.system?.id ?? 'nimble';
}

/** Namespaced Nimble hook name (`nimble.useItem`, …). */
export function sysHook(name) {
	return `${sysId()}.${name}`;
}

/**
 * Nimble's `DamageRoll` class, located by capability rather than by name (the
 * shipped bundle is minified, so `cls.name` is a mangled two-letter identifier
 * while method names are preserved). Returns null if the system ever stops
 * registering a roll class with this shape — callers then simply do nothing.
 */
export function getDamageRollClass() {
	const registered = CONFIG?.Dice?.rolls;
	if (!Array.isArray(registered)) return null;
	return (
		registered.find(
			(cls) =>
				typeof cls?.prototype?._evaluate === 'function' &&
				typeof cls?.prototype?._finalizeOutcome === 'function' &&
				typeof cls?.prototype?._recalculateTotal === 'function',
		) ?? null
	);
}
