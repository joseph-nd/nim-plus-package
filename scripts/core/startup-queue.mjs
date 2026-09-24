/**
 * One GM prompt at a time on `ready`.
 *
 * The subclass sync and the class migration each offer the GM a preview dialog
 * after an update. Both are async `ready` handlers, and Foundry does not await
 * hooks, so without this they would open on top of each other — and the class
 * migration can change what the subclass sync has to do. Queued prompts run in
 * the order they were queued, each after the previous one has closed, whatever
 * it threw.
 *
 * Nothing here registers a hook, so importing it cannot disturb load order.
 */
let tail = Promise.resolve();

export function queueStartupPrompt(task) {
	const run = tail.then(task);
	tail = run.catch(() => {});
	return run;
}
