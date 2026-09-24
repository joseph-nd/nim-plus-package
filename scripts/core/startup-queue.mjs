/**
 * One GM startup task at a time on `ready`.
 *
 * The class migration and the subclass sync each run a pass for the GM after an
 * update (applied without a dialog, reported with a toast and a chat card).
 * Both are async `ready` handlers, and Foundry does not await hooks, so without
 * this they would run interleaved — and the class migration changes what the
 * subclass sync has to do. Queued tasks run in the order they were queued, each
 * after the previous one has finished, whatever it threw.
 *
 * Nothing here registers a hook, so importing it cannot disturb load order.
 */
let tail = Promise.resolve();

export function queueStartupPrompt(task) {
	const run = tail.then(task);
	tail = run.catch(() => {});
	return run;
}
